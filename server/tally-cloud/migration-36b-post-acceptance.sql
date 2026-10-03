-- Posting acceptance, 03-Oct-2026 (round 4; the real-books fault of the day). The bridge reported a posting failed although
-- Tally had replied CREATED with LASTVCHID 26298; tally_post_ids_sync then set the entry's id live = false, so the same bill
-- could have been posted again (a duplicate in Tally). Guards on the cloud side, independent of the bridge fix:
--
--   tally_post_ids.accepted_at, accepted_vch   set through tally_post_id_accept(job, id, vch) by tally-ingest (posts_update)
--                                   when any result or item for an entry carries an acceptance by Tally (ok, a voucher
--                                   number / master id / GUID, or CREATED / ALTERED with a voucher id in Tally's words).
--                                   tally_post_ids_sync never frees an id with accepted_at set, whatever the posting's
--                                   status becomes; only the owner's tally_post_id_release_owner (below) frees it. The
--                                   bridge's tally_post_id_release (migration 37) never frees an accepted id either.
--   tally_post_ids.released_at, released_by, released_why   (also added by migration 37, the same columns) an id set free
--                                   per entry: 'bridge' (37) or 'owner' (below). The sync never turns a released id live
--                                   again; a stamp (tally_post_id_accept, the owner's mark) clears a release.
--   tally_post_marks                append-only: who marked which entry of which posting, when, with the voucher and a
--                                   note (action 'posted' or 'released'). Never updated or deleted.
--   tally_post_id_release_owner(job, id, why)   an owner looked in Tally and the entry is not there: its id is freed (live
--                                   false, released_by 'owner', the reason), accepted_at kept as history; the entry says
--                                   notfound in results and items; a posting held open only for it ends failed, so Retry
--                                   and Post again are offered. A reason is required. A row in tally_post_marks.
--   ids                             accept, release and the mark match the entry's id as the tag spells it (INV-2026.07), as
--                                   the bridge stamps it (letters and digits: INV202607) or by FinCom's entry id.
--   NEVER SENT AGAIN (the real-books fault of 03-Oct, job 3b03cc5e: Tally answered CREATED 26298, the bridge reported the
--   posting failed, the cloud parked it 'running' for checking, tally_post_requeue (migration 13, every minute) moved the
--   30-minute-old 'running' job back to 'waiting', the wake trigger fired, the bridge took it again and Tally answered
--   CREATED 26299: a second copy in the real books):
--   tally_post_job_accepted(job, results, items)   the entries of a posting Tally accepted and the owner has not released:
--                                   an id stamped accepted_at (not released), or an entry whose result / item carries an
--                                   acceptance (accepted, lastVchId, a voucher number / master id / GUID, CREATED / ALTERED
--                                   with a voucher id) and whose id is not released. Null when none.
--   tally_post_jobs_resend_guard    BEFORE UPDATE OF status: a posting with such an entry is never set 'waiting' again (the
--                                   only status tally_post_take hands to a bridge): Retry (tally_post_enqueue), the requeue,
--                                   a hand update all stop with the entry named. The owner marks it posted or releases it
--                                   first; the other bills are posted again from their own rows (a new posting).
--   tally_post_requeue              as migration 13, and it skips such a posting (so the cron never raises either).
--   tally-ingest (posts_update)     parks a posting held for an accepted, unconfirmed entry as 'done' with checking = true,
--                                   never 'running' or 'taken' (the requeue never looks at 'done'); the app treats a job
--                                   with checking as still going on, as before.
--   tally_post_job_mark_posted(job, id, vch, note)   an owner of the firm marks an entry posted after seeing it in Tally:
--                                   results and items say in_tally, verified, with the voucher number; the id stays live
--                                   with accepted_at; a row in tally_post_marks; the posting is done when every entry is
--                                   posted. Nothing is deleted or re-sent.
--
-- Order: 36 (ledger rename) -> 36b (this) -> 37. Add-only: columns and a table added if missing, the trigger function
-- replaced, three functions created; safe to run again. Shown to the owner before it runs.

begin;

alter table public.tally_post_ids add column if not exists accepted_at timestamptz;
alter table public.tally_post_ids add column if not exists accepted_vch text;
alter table public.tally_post_ids add column if not exists released_at timestamptz;
alter table public.tally_post_ids add column if not exists released_by text;              -- 'bridge' (migration 37) | 'owner'
alter table public.tally_post_ids add column if not exists released_why text;

create table if not exists public.tally_post_marks (
  id         bigint generated always as identity primary key,
  firm_id    uuid not null references public.firms(id) on delete cascade,
  job_id     uuid not null references public.tally_post_jobs(id) on delete cascade,
  entry_id   text not null,
  action     text not null,                     -- 'posted' | 'released'
  vch        text,
  note       text,
  by_user    uuid,
  at         timestamptz not null default now()
);
create index if not exists tally_post_marks_job on public.tally_post_marks (job_id, at);
alter table public.tally_post_marks enable row level security;
drop policy if exists tally_post_marks_read on public.tally_post_marks;
create policy tally_post_marks_read on public.tally_post_marks for select to authenticated using (firm_id = my_firm());
grant select on public.tally_post_marks to authenticated;
revoke insert, update, delete, truncate on public.tally_post_marks from anon, authenticated;

-- the sync (migration-32), with two changes: an id Tally accepted stays live; a released id never turns live again
-- (the same text as migration 37's, which runs after this file)
create or replace function public.tally_post_ids_sync() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if tg_op = 'INSERT' then
    insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live)
    select distinct on (tally_fincom_id(v)) new.firm_id, new.client_id, tally_fincom_id(v), new.id, v->>'id', new.status not in ('failed', 'cancelled')
      from jsonb_array_elements(coalesce(new.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) is not null;
  elsif new.status is distinct from old.status then
    -- failed or cancelled: the ids may be queued again; waiting again (Retry): live again, unless another posting has them.
    -- An id Tally accepted (accepted_at) is never freed here: the voucher is in Tally, and posting it again would double it.
    -- A released id (the bridge said not in Tally, or the owner did) is never revived here.
    update tally_post_ids set live = (accepted_at is not null and released_at is null) or (new.status not in ('failed', 'cancelled') and released_at is null) where job_id = new.id;
  end if;
  return new;
exception when unique_violation then
  raise exception 'This bill is already being posted to Tally in another posting (its FinCom id is taken); wait for that posting to finish.' using errcode = '23505';
end $function$;

-- does Tally's text say it accepted the entry? CREATED / ALTERED with a voucher id ("CREATED 0" is not one)
create or replace function public.tally_post_accept_text(p text) returns boolean language sql immutable as $function$
  select coalesce(p, '') ~* '\m(CREATED|ALTERED)\M' and (coalesce(p, '') ~* '\m(LASTVCHID|VCHID|MASTERID|voucher( no\.?| number| id)?)\D{0,6}[1-9]\d*' or coalesce(p, '') ~* '\m(CREATED|ALTERED)\M\D{0,4}[1-9]\d*')
$function$;

-- the entries of a posting Tally accepted that the owner has not released, as one text (their ids), or null when none
create or replace function public.tally_post_job_accepted(p_job uuid, p_results jsonb, p_items jsonb) returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with ids as (select fincom_id, entry_id, regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') k, accepted_at, released_at from tally_post_ids where job_id = p_job),
  sig as (select r->>'id' id from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
           where r->>'id' is not null and ((r->>'accepted')::boolean or coalesce(r->>'lastVchId', '') <> '' or coalesce(r->>'vchNumber', '') <> '' or coalesce(r->>'masterId', '') <> ''
                  or coalesce(r->>'guid', '') <> '' or tally_post_accept_text(r->>'message') or tally_post_accept_text(r->>'reason'))
          union select i->>'id' from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where i->>'id' is not null and tally_post_accept_text(i->>'reason')),
  hits as (select coalesce(entry_id, fincom_id) id from ids where accepted_at is not null and released_at is null
           union select s.id from sig s where not exists (select 1 from ids i where i.released_at is not null and (i.fincom_id = s.id or i.entry_id = s.id or i.k = regexp_replace(s.id, '[^A-Za-z0-9]', '', 'g'))))
  select nullif(string_agg(distinct id, ', ' order by id), '') from hits
$function$;

-- a posting Tally accepted (an entry at least, not released by the owner) is never set 'waiting' again by any route
create or replace function public.tally_post_jobs_resend_guard() returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare who text;
begin
  if new.status = 'waiting' and old.status is distinct from 'waiting' then
    who := tally_post_job_accepted(new.id, coalesce(new.results, old.results), coalesce(new.items, old.items));
    if who is not null then
      raise exception 'This posting is not sent to Tally again: Tally accepted % of it (%). An owner marks it posted or releases it (Not in Tally) first; the other bills are posted again from their own rows.',
        case when position(',' in who) > 0 then 'entries' else 'an entry' end, who using errcode = 'P0001';
    end if;
  end if;
  return new;
end $function$;
drop trigger if exists tally_post_jobs_resend_guard on public.tally_post_jobs;
create trigger tally_post_jobs_resend_guard before update of status on public.tally_post_jobs for each row execute function public.tally_post_jobs_resend_guard();

-- the requeue of migration 13 (every minute, cron 'tally-post-requeue'), with one change: a posting Tally accepted is
-- never moved back to 'waiting' (the guard above would stop it, and an exception here would stop the whole minute)
create or replace function public.tally_post_requeue() returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare n integer;
begin
  update tally_post_jobs set status = case when attempts >= 5 then 'failed' else 'waiting' end, attempts = attempts + 1, updated_at = now(),
         message = case when attempts >= 5 then 'The Tally computer did not finish this posting after 5 tries. Check Tally on that computer, then post again.'
                        else 'Sent to the Tally computer again: it had not answered for a while.' end
   where ((status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes')
      or (status = 'running' and updated_at < now() - interval '30 minutes'))
     and tally_post_job_accepted(id, results, items) is null;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.tally_post_requeue() from public, anon, authenticated;
revoke all on function public.tally_post_job_accepted(uuid, jsonb, jsonb) from public, anon, authenticated;

-- tally-ingest saw Tally accept an entry: the id is stamped (and made live again if the sync had freed it); a release
-- (bridge or owner) is cleared: Tally has the voucher after all. Service role. p_id: the tag's spelling, the bridge's
-- (letters and digits) or FinCom's entry id; stamped 0 when none of the posting's ids matches (tally-ingest logs it).
create or replace function public.tally_post_id_accept(p_job uuid, p_id text, p_vch text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare fid text := regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g'); n int;
begin
  if auth.role() <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  if fid = '' then return jsonb_build_object('ok', false, 'error', 'no id'); end if;
  begin
    update tally_post_ids set accepted_at = coalesce(accepted_at, now()), accepted_vch = coalesce(nullif(left(btrim(coalesce(p_vch, '')), 60), ''), accepted_vch), live = true,
           released_at = null, released_by = null, released_why = null
     where job_id = p_job and (fincom_id = p_id or entry_id = p_id or regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') = fid);
    get diagnostics n = row_count;
  exception when unique_violation then
    -- another posting holds the id live: stamped all the same, so that it is never freed here either
    update tally_post_ids set accepted_at = coalesce(accepted_at, now()), accepted_vch = coalesce(nullif(left(btrim(coalesce(p_vch, '')), 60), ''), accepted_vch),
           released_at = null, released_by = null, released_why = null
     where job_id = p_job and (fincom_id = p_id or entry_id = p_id or regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') = fid);
    get diagnostics n = row_count;
  end;
  return jsonb_build_object('ok', true, 'stamped', n);
end $function$;
revoke all on function public.tally_post_id_accept(uuid, text, text) from public, anon, authenticated;

-- the owner saw the entry in Tally: mark it posted. p_id is the entry's id (or its FinCom id: letters and digits).
create or replace function public.tally_post_job_mark_posted(p_job uuid, p_id text, p_vch text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  f uuid := my_firm(); j tally_post_jobs%rowtype; fid text := regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g');
  eid text; vch text := left(btrim(coalesce(p_vch, '')), 60); note text := left(btrim(coalesce(p_note, '')), 300);
  stamp jsonb; res jsonb; its jsonb; total int; posted int; st text;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can mark an entry posted' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if fid = '' then raise exception 'which entry? give its id'; end if;
  -- the entry: in the posting's payload, by its id in letters and digits
  select v->>'id' into eid from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v
   where regexp_replace(coalesce(tally_fincom_id(v), ''), '[^A-Za-z0-9]', '', 'g') = fid or v->>'id' = p_id limit 1;
  if eid is null then raise exception 'the entry % is not in this posting', p_id; end if;
  stamp := jsonb_build_object('ok', true, 'verified', true, 'state', 'in_tally', 'outcomeUnknown', false, 'reason', '', 'message', 'Marked posted by the owner on ' || to_char(now(), 'DD-Mon-YYYY') || ': in Tally' || case when vch <> '' then ' as voucher ' || vch else '' end || case when note <> '' then ' (' || note || ')' else '' end)
           || case when vch <> '' then jsonb_build_object('vchNumber', vch) else '{}'::jsonb end;
  -- results: the entry's element updated, or added
  select coalesce(jsonb_agg(case when regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then r || stamp else r end), '[]'::jsonb) into res from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r;
  if not exists (select 1 from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r where regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid)
    then res := res || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher') || stamp); end if;
  -- items (2.1.x bridges): the same
  select coalesce(jsonb_agg(case when regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then i || jsonb_build_object('state', 'in_tally', 'reason', '') else i end), '[]'::jsonb) into its from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) i;
  if not exists (select 1 from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) i where regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid)
    then its := its || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher', 'state', 'in_tally', 'reason', '')); end if;
  -- done when every entry of the payload is posted (a result ok, or an item in_tally)
  select count(*), count(*) filter (where exists (select 1 from jsonb_array_elements(res) r where regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = regexp_replace(tally_fincom_id(v), '[^A-Za-z0-9]', '', 'g') and (r->>'ok')::boolean)
                                        or exists (select 1 from jsonb_array_elements(its) i where regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = regexp_replace(tally_fincom_id(v), '[^A-Za-z0-9]', '', 'g') and i->>'state' = 'in_tally'))
    into total, posted from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) is not null;
  st := case when posted >= total then 'done' else j.status end;
  -- the id stays live, accepted, a release cleared (another posting holding it live is a conflict the owner must clear
  -- first: cancel that one)
  begin
    update tally_post_ids set live = true, accepted_at = coalesce(accepted_at, now()), accepted_vch = coalesce(nullif(vch, ''), accepted_vch), released_at = null, released_by = null, released_why = null
     where job_id = p_job and (fincom_id = p_id or entry_id = p_id or regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') = fid);
  exception when unique_violation then
    raise exception 'the entry % is live in another posting; cancel that posting first, then mark this one', p_id;
  end;
  insert into tally_post_marks (firm_id, job_id, entry_id, action, vch, note, by_user) values (f, p_job, eid, 'posted', nullif(vch, ''), nullif(note, ''), auth.uid());
  update tally_post_jobs set results = res, items = its, status = st, checking = case when posted >= total or not exists (select 1 from jsonb_array_elements(its) i where i->>'state' = 'unknown') then false else checking end,
         done = greatest(done, posted), message = case when st = 'done' then 'Marked posted by the owner' || case when note <> '' then ': ' || note else '' end else message end, updated_at = now()
   where id = p_job;
  return jsonb_build_object('ok', true, 'job', p_job, 'id', eid, 'vch', vch, 'posted', posted, 'of', total, 'status', st);
end $function$;
revoke all on function public.tally_post_job_mark_posted(uuid, text, text, text) from public, anon;
grant execute on function public.tally_post_job_mark_posted(uuid, text, text, text) to authenticated;

-- the owner looked in Tally and the entry is not there: its id is set free with the reason (live false, released_by
-- 'owner'); accepted_at stays as history (Tally once said CREATED); the sync never revives it; the entry says notfound in
-- results and items (reason: released by the owner); a posting held open for checking with nothing else unknown ends
-- failed, checking off, so Retry is offered; a row in tally_post_marks (action 'released'). Nothing is deleted or re-sent.
create or replace function public.tally_post_id_release_owner(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  f uuid := my_firm(); j tally_post_jobs%rowtype; fid text := regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g');
  eid text; why text := left(btrim(coalesce(p_why, '')), 500); stamp jsonb; res jsonb; its jsonb; n int; others int; st text; chk boolean;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can release an entry' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if fid = '' then raise exception 'which entry? give its id'; end if;
  if why = '' then raise exception 'say why: what you saw in Tally (kept with the entry)'; end if;
  select v->>'id' into eid from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v
   where regexp_replace(coalesce(tally_fincom_id(v), ''), '[^A-Za-z0-9]', '', 'g') = fid or v->>'id' = p_id limit 1;
  if eid is null then raise exception 'the entry % is not in this posting', p_id; end if;
  update tally_post_ids set live = false, released_at = now(), released_by = 'owner', released_why = why
   where job_id = p_job and (fincom_id = p_id or entry_id = p_id or regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') = fid);
  get diagnostics n = row_count;
  stamp := jsonb_build_object('ok', false, 'verified', false, 'state', 'notfound', 'outcomeUnknown', false,
                              'reason', 'Not in Tally: released by the owner on ' || to_char(now(), 'DD-Mon-YYYY') || ' (' || why || ')');
  select coalesce(jsonb_agg(case when regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then r || stamp else r end), '[]'::jsonb) into res from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r;
  if not exists (select 1 from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r where regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid)
    then res := res || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher') || stamp); end if;
  select coalesce(jsonb_agg(case when regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then i || jsonb_build_object('state', 'notfound', 'reason', stamp->>'reason', 'outcomeUnknown', false) else i end), '[]'::jsonb) into its from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) i;
  if not exists (select 1 from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) i where regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid)
    then its := its || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher', 'state', 'notfound', 'reason', stamp->>'reason')); end if;
  -- a posting held open for checking (round 4: an entry Tally accepted that the bridge could not confirm) with no other
  -- entry still unknown: its outcome is known now, it ends failed; otherwise the status stays as it is
  select count(*) into others from jsonb_array_elements(its) i where i->>'state' = 'unknown';
  st := j.status; chk := j.checking;
  if coalesce(j.checking, false) and others = 0 then st := 'failed'; chk := false; end if;
  insert into tally_post_marks (firm_id, job_id, entry_id, action, vch, note, by_user) values (f, p_job, eid, 'released', null, why, auth.uid());
  update tally_post_jobs set results = res, items = its, status = st, checking = chk,
         message = case when st <> j.status then 'Released by the owner: not in Tally (' || why || ')' else message end, updated_at = now()
   where id = p_job;
  return jsonb_build_object('ok', true, 'job', p_job, 'id', eid, 'released', n > 0, 'n', n, 'status', st);
end $function$;
revoke all on function public.tally_post_id_release_owner(uuid, text, text) from public, anon;
grant execute on function public.tally_post_id_release_owner(uuid, text, text) to authenticated;

commit;
