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
--   Round 7 (the review of round 5): tally_post_id_match (an id as the tag, the bridge or FinCom spells it: a bank line's
--   abc-1 with a hash tag matches 'abc1'); tally_post_id_accept carries p_at (the bridge's time of Tally's reply) and keeps
--   an owner's release made after it; tally_post_job_accepted leaves confirmed entries out (Retry of a posting with one
--   confirmed and one refused entry is allowed) and reads the 2.1.5 bridge's words ("replied 'created'"); the requeue holds
--   a stale accepted posting (done + checking, a message) instead of skipping it; the owner's mark (voucher number
--   required) and release settle a running or taken posting (tally_post_job_settle) and stamp byOwner so tally-ingest
--   never writes over them; tally_post_jobs.seq (a late update is ignored); tally_post_enqueue's Retry refuses while an
--   id of the posting is live in another posting; the backfill at the end stamps accepted_at on the ids already here.
--   tally_post_job_mark_posted(job, id, vch, note)   an owner of the firm marks an entry posted after seeing it in Tally:
--                                   results and items say in_tally, verified, with the voucher number; the id stays live
--                                   with accepted_at; a row in tally_post_marks; the posting is done when every entry is
--                                   posted. Nothing is deleted or re-sent.
--
-- Order: 36 (ledger rename) -> 36b (this) -> 37. Add-only: columns and a table added if missing, the trigger function
-- replaced, functions created or replaced, one backfill of accepted_at; safe to run again. Shown to the owner before it runs.

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

alter table public.tally_post_jobs add column if not exists seq integer;              -- F4: the bridge's per-posting update counter; a lower one is late and ignored

-- an id as the bridge, FinCom or the tag spells it: the tag's text (INV-2026.07, or a hash for a bank line), FinCom's
-- entry id (abc-1), or either in letters and digits (INV202607, abc1)
create or replace function public.tally_post_id_match(p_fincom text, p_entry text, p_id text) returns boolean language sql immutable as $function$
  select coalesce(p_id, '') <> '' and (p_fincom = p_id or p_entry = p_id
      or regexp_replace(coalesce(p_fincom, ''), '[^A-Za-z0-9]', '', 'g') = nullif(regexp_replace(p_id, '[^A-Za-z0-9]', '', 'g'), '')
      or regexp_replace(coalesce(p_entry, ''), '[^A-Za-z0-9]', '', 'g') = nullif(regexp_replace(p_id, '[^A-Za-z0-9]', '', 'g'), ''))
$function$;
-- a JSON flag read without raising (a text 'yes' is not true; a cast error here would stop the requeue's whole minute)
create or replace function public.tally_post_bool(p text) returns boolean language sql immutable as $function$
  select coalesce(lower(coalesce(p, '')) in ('true', 't', '1'), false)
$function$;
-- does Tally's text say it accepted the entry? CREATED / ALTERED with a voucher id ("CREATED 0" is not one), or the
-- bridge's own words for it: "Tally replied 'created', but the entry cannot be found in '…'" (2.1.5, the build on NWS144)
create or replace function public.tally_post_accept_text(p text) returns boolean language sql immutable as $function$
  select (coalesce(p, '') ~* '\m(CREATED|ALTERED)\M' and (coalesce(p, '') ~* '\m(LASTVCHID|VCHID|MASTERID|voucher( no\.?| number| id)?)\D{0,6}[1-9]\d*' or coalesce(p, '') ~* '\m(CREATED|ALTERED)\M\D{0,4}[1-9]\d*'))
      or coalesce(p, '') ~* 'replied ''(created|altered)'''
      or (coalesce(p, '') ~* '\m(CREATED|ALTERED)\M' and coalesce(p, '') ~* 'cannot be found')
$function$;
-- a result of the bridge carries an acceptance by Tally: accepted, created / altered > 0, a voucher id / number, a master
-- id, a GUID, or Tally's / the bridge's words
create or replace function public.tally_post_result_accepted(r jsonb) returns boolean language sql immutable as $function$
  select tally_post_bool(r->>'accepted')
      or (coalesce(r->>'created', '') ~ '^\d+$' and (r->>'created')::int > 0) or (coalesce(r->>'altered', '') ~ '^\d+$' and (r->>'altered')::int > 0)
      or coalesce(r->>'lastVchId', '') <> '' or coalesce(r->>'vchNumber', '') <> '' or coalesce(r->>'masterId', '') <> '' or coalesce(r->>'guid', '') <> ''
      or tally_post_accept_text(r->>'message') or tally_post_accept_text(r->>'reason')
$function$;
-- a result or item says the entry is confirmed in Tally (verified, in_tally, or sent and read back): the bridge never
-- re-sends such an entry, so it holds no posting back
create or replace function public.tally_post_result_confirmed(r jsonb) returns boolean language sql immutable as $function$
  select tally_post_bool(r->>'verified') or coalesce(r->>'state', '') in ('in_tally', 'sent')
$function$;

-- the entries of a posting Tally accepted that nobody has confirmed and the owner has not released, as one text (their
-- ids), or null when none: an id stamped accepted_at (not released, not confirmed by a result or item), or a result /
-- item with an acceptance whose id is neither confirmed nor released
create or replace function public.tally_post_job_accepted(p_job uuid, p_results jsonb, p_items jsonb) returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with ids as (select fincom_id, entry_id, accepted_at, released_at from tally_post_ids where job_id = p_job),
  res as (select r->>'id' id, tally_post_result_accepted(r) acc, tally_post_result_confirmed(r) conf from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where r->>'id' is not null),
  its as (select i->>'id' id, (tally_post_bool(i->>'accepted') or tally_post_accept_text(i->>'reason')) acc, tally_post_result_confirmed(i) conf from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where i->>'id' is not null),
  conf as (select id from res where conf union select id from its where conf),
  sig as (select id from res where acc union select id from its where acc),
  hits as (select coalesce(entry_id, fincom_id) id from ids i where accepted_at is not null and released_at is null
             and not exists (select 1 from conf c where tally_post_id_match(i.fincom_id, i.entry_id, c.id))
           union select s.id from sig s where not exists (select 1 from conf c where c.id = s.id)
             and not exists (select 1 from ids i where i.released_at is not null and tally_post_id_match(i.fincom_id, i.entry_id, s.id)))
  select nullif(string_agg(distinct id, ', ' order by id), '') from hits
$function$;

-- a posting Tally accepted (an entry at least, not confirmed, not released by the owner) is never set 'waiting' again by
-- any route: Retry (tally_post_enqueue), the requeue, a hand update
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

-- the requeue of migration 13 (every minute, cron 'tally-post-requeue'), with one change: a stale posting Tally accepted
-- (its bridge gone quiet) is HELD — status 'done' with checking = true and a message — never moved back to 'waiting'
-- (the fault of 03-Oct: that is how job 3b03cc5e was sent twice). The owner settles it: Mark posted or Not in Tally.
create or replace function public.tally_post_requeue() returns integer language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare n integer;
begin
  update tally_post_jobs j set status = 'done', checking = true, updated_at = now(),
         message = left('Held: Tally accepted ' || who || ' of this posting but nobody has confirmed it; being checked, not sent again. An owner marks it posted or releases it.', 500)
    from (select id, tally_post_job_accepted(id, results, items) who from tally_post_jobs
           where (status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes') or (status = 'running' and updated_at < now() - interval '30 minutes')) a
   where j.id = a.id and a.who is not null;
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
-- is cleared — Tally has the voucher after all — unless an OWNER released it after the acceptance (p_at: the bridge's
-- time of Tally's reply; the bridge's memory of a first send must not undo what the owner saw later). Service role.
-- p_id: the tag's spelling, the bridge's (letters and digits) or FinCom's entry id; stamped 0 when none of the posting's
-- ids matches (tally-ingest logs it).
create or replace function public.tally_post_id_accept(p_job uuid, p_id text, p_vch text, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare n int; at timestamptz := coalesce(p_at, now()); vch text := nullif(left(btrim(coalesce(p_vch, '')), 60), '');
begin
  if auth.role() <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  if regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g') = '' then return jsonb_build_object('ok', false, 'error', 'no id'); end if;
  begin
    update tally_post_ids set accepted_at = coalesce(accepted_at, at), accepted_vch = coalesce(vch, accepted_vch),
           live = case when released_by = 'owner' and released_at >= at then live else true end,
           released_at = case when released_by = 'owner' and released_at >= at then released_at end,
           released_by = case when released_by = 'owner' and released_at >= at then released_by end,
           released_why = case when released_by = 'owner' and released_at >= at then released_why end
     where job_id = p_job and tally_post_id_match(fincom_id, entry_id, p_id);
    get diagnostics n = row_count;
  exception when unique_violation then
    -- another posting holds the id live: stamped all the same, so that it is never freed here either
    update tally_post_ids set accepted_at = coalesce(accepted_at, at), accepted_vch = coalesce(vch, accepted_vch),
           released_at = case when released_by = 'owner' and released_at >= at then released_at end,
           released_by = case when released_by = 'owner' and released_at >= at then released_by end,
           released_why = case when released_by = 'owner' and released_at >= at then released_why end
     where job_id = p_job and tally_post_id_match(fincom_id, entry_id, p_id);
    get diagnostics n = row_count;
  end;
  return jsonb_build_object('ok', true, 'stamped', n);
end $function$;
revoke all on function public.tally_post_id_accept(uuid, text, text, timestamptz) from public, anon, authenticated;

-- what a posting becomes after the owner's mark or release: {status, checking, posted, total}. Done when every entry is
-- posted. A posting still with the bridge (running, taken) or held for checking is settled by the entries left: one still
-- on its way (no word yet, waiting, sending) leaves it to the bridge; one still unknown holds it (done + checking); else
-- it is failed. Finished postings (done, failed, cancelled, waiting) keep their status.
create or replace function public.tally_post_job_settle(p_status text, p_checking boolean, p_payload jsonb, p_results jsonb, p_items jsonb)
returns jsonb language plpgsql immutable as $function$
declare total int; posted int; pending int; unknown int; st text := p_status; chk boolean := coalesce(p_checking, false);
begin
  -- each entry of the payload, its result and item matched by the tag's id or FinCom's entry id (a bank line's result
  -- carries the entry id, its tag a hash)
  with v as (select tally_fincom_id(x) fk, x->>'id' ek from jsonb_array_elements(coalesce(p_payload->'vouchers', '[]'::jsonb)) x where tally_fincom_id(x) is not null),
  e as (select fk,
          exists (select 1 from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where tally_post_id_match(fk, ek, r->>'id') and tally_post_bool(r->>'ok'))
            or exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where tally_post_id_match(fk, ek, i->>'id') and i->>'state' = 'in_tally') is_posted,
          (select i->>'state' from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where tally_post_id_match(fk, ek, i->>'id') limit 1) state,
          exists (select 1 from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where tally_post_id_match(fk, ek, r->>'id')) has_result
        from v)
  select count(*), count(*) filter (where is_posted),
         count(*) filter (where not is_posted and (state in ('waiting', 'sending') or (state is null and not has_result))),
         count(*) filter (where not is_posted and state = 'unknown')
    into total, posted, pending, unknown from e;
  if posted >= total then st := 'done'; chk := false;
  elsif p_status in ('running', 'taken') or coalesce(p_checking, false) then
    if pending > 0 then null;
    elsif unknown > 0 then st := 'done'; chk := true;
    else st := 'failed'; chk := false; end if;
  end if;
  return jsonb_build_object('status', st, 'checking', chk, 'posted', posted, 'total', total);
end $function$;

-- the owner saw the entry in Tally: mark it posted, with the voucher number (required) and a note. p_id: the entry's id as
-- the tag, the bridge or FinCom spells it. The stamp carries byOwner so tally-ingest never writes over it.
create or replace function public.tally_post_job_mark_posted(p_job uuid, p_id text, p_vch text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  f uuid := my_firm(); j tally_post_jobs%rowtype; fid text := regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g');
  eid text; vch text := left(btrim(coalesce(p_vch, '')), 60); note text := left(btrim(coalesce(p_note, '')), 300);
  stamp jsonb; res jsonb; its jsonb; o jsonb;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can mark an entry posted' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if fid = '' then raise exception 'which entry? give its id'; end if;
  if vch = '' then raise exception 'give the voucher number as Tally shows it'; end if;
  select v->>'id' into eid from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where tally_post_id_match(tally_fincom_id(v), v->>'id', p_id) limit 1;
  if eid is null then raise exception 'the entry % is not in this posting', p_id; end if;
  stamp := jsonb_build_object('ok', true, 'verified', true, 'state', 'in_tally', 'outcomeUnknown', false, 'reason', '', 'vchNumber', vch, 'byOwner', true,
                              'message', 'Marked posted by the owner on ' || to_char(now(), 'DD-Mon-YYYY') || ': in Tally as voucher ' || vch || case when note <> '' then ' (' || note || ')' else '' end);
  -- results and items (2.1.x bridges): the entry's element updated, or added
  select coalesce(jsonb_agg(case when tally_post_id_match(r->>'id', r->>'id', eid) or regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then r || stamp else r end), '[]'::jsonb) into res from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r;
  if not exists (select 1 from jsonb_array_elements(res) r where tally_post_bool(r->>'byOwner') and (r->>'id' = eid or regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid))
    then res := res || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher') || stamp); end if;
  select coalesce(jsonb_agg(case when tally_post_id_match(i->>'id', i->>'id', eid) or regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then i || jsonb_build_object('state', 'in_tally', 'reason', '', 'byOwner', true) else i end), '[]'::jsonb) into its from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) i;
  if not exists (select 1 from jsonb_array_elements(its) i where tally_post_bool(i->>'byOwner') and (i->>'id' = eid or regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid))
    then its := its || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher', 'state', 'in_tally', 'reason', '', 'byOwner', true)); end if;
  o := tally_post_job_settle(j.status, j.checking, j.payload, res, its);
  -- the id stays live, accepted, a release cleared (another posting holding it live is a conflict the owner must clear
  -- first: cancel that one)
  begin
    update tally_post_ids set live = true, accepted_at = coalesce(accepted_at, now()), accepted_vch = coalesce(nullif(vch, ''), accepted_vch), released_at = null, released_by = null, released_why = null
     where job_id = p_job and tally_post_id_match(fincom_id, entry_id, p_id);
  exception when unique_violation then
    raise exception 'the entry % is live in another posting; cancel that posting first, then mark this one', p_id;
  end;
  insert into tally_post_marks (firm_id, job_id, entry_id, action, vch, note, by_user) values (f, p_job, eid, 'posted', vch, nullif(note, ''), auth.uid());
  update tally_post_jobs set results = res, items = its, status = o->>'status', checking = (o->>'checking')::boolean, done = greatest(done, (o->>'posted')::int),
         message = case when o->>'status' = 'done' and not (o->>'checking')::boolean then 'Marked posted by the owner' || case when note <> '' then ': ' || note else '' end
                        when o->>'status' <> j.status or (o->>'checking')::boolean <> coalesce(j.checking, false) then 'Settled by the owner''s mark of ' || eid || '; ' || case when (o->>'checking')::boolean then 'another entry is still being checked' else 'the rest did not go through' end
                        else message end, updated_at = now()
   where id = p_job;
  return jsonb_build_object('ok', true, 'job', p_job, 'id', eid, 'vch', vch, 'posted', (o->>'posted')::int, 'of', (o->>'total')::int, 'status', o->>'status');
end $function$;
revoke all on function public.tally_post_job_mark_posted(uuid, text, text, text) from public, anon;
grant execute on function public.tally_post_job_mark_posted(uuid, text, text, text) to authenticated;

-- the owner looked in Tally and the entry is not there: its id is set free with the reason (live false, released_by
-- 'owner'); accepted_at stays as history (Tally once said CREATED); the sync never revives it; the entry says notfound in
-- results and items (reason: released by the owner, byOwner so tally-ingest never writes over it); the posting is settled
-- (tally_post_job_settle: failed when nothing else is pending or unknown); a row in tally_post_marks (action 'released').
-- Nothing is deleted or re-sent.
create or replace function public.tally_post_id_release_owner(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  f uuid := my_firm(); j tally_post_jobs%rowtype; fid text := regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g');
  eid text; why text := left(btrim(coalesce(p_why, '')), 500); stamp jsonb; res jsonb; its jsonb; n int; o jsonb;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can release an entry' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if fid = '' then raise exception 'which entry? give its id'; end if;
  if why = '' then raise exception 'say why: what you saw in Tally (kept with the entry)'; end if;
  select v->>'id' into eid from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where tally_post_id_match(tally_fincom_id(v), v->>'id', p_id) limit 1;
  if eid is null then raise exception 'the entry % is not in this posting', p_id; end if;
  update tally_post_ids set live = false, released_at = now(), released_by = 'owner', released_why = why
   where job_id = p_job and tally_post_id_match(fincom_id, entry_id, p_id);
  get diagnostics n = row_count;
  stamp := jsonb_build_object('ok', false, 'verified', false, 'state', 'notfound', 'outcomeUnknown', false, 'byOwner', true,
                              'reason', 'Not in Tally: released by the owner on ' || to_char(now(), 'DD-Mon-YYYY') || ' (' || why || ')');
  select coalesce(jsonb_agg(case when r->>'id' = eid or regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then r || stamp else r end), '[]'::jsonb) into res from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r;
  if not exists (select 1 from jsonb_array_elements(res) r where tally_post_bool(r->>'byOwner') and (r->>'id' = eid or regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid))
    then res := res || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher') || stamp); end if;
  select coalesce(jsonb_agg(case when i->>'id' = eid or regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then i || jsonb_build_object('state', 'notfound', 'reason', stamp->>'reason', 'outcomeUnknown', false, 'byOwner', true) else i end), '[]'::jsonb) into its from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) i;
  if not exists (select 1 from jsonb_array_elements(its) i where tally_post_bool(i->>'byOwner') and (i->>'id' = eid or regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid))
    then its := its || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher', 'state', 'notfound', 'reason', stamp->>'reason', 'byOwner', true)); end if;
  o := tally_post_job_settle(j.status, j.checking, j.payload, res, its);
  insert into tally_post_marks (firm_id, job_id, entry_id, action, vch, note, by_user) values (f, p_job, eid, 'released', null, why, auth.uid());
  update tally_post_jobs set results = res, items = its, status = o->>'status', checking = (o->>'checking')::boolean,
         message = case when o->>'status' <> j.status or (o->>'checking')::boolean <> coalesce(j.checking, false) then left('Released by the owner: not in Tally (' || why || ')', 500) else message end, updated_at = now()
   where id = p_job;
  return jsonb_build_object('ok', true, 'job', p_job, 'id', eid, 'released', n > 0, 'n', n, 'status', o->>'status');
end $function$;
revoke all on function public.tally_post_id_release_owner(uuid, text, text) from public, anon;
grant execute on function public.tally_post_id_release_owner(uuid, text, text) to authenticated;

-- tally_post_enqueue as migration 24, with one change in its Retry branch (L2): a failed or cancelled posting is not
-- queued again while one of its ids is live in another posting (the bill would be sent from two postings); the id named.
-- The resend guard above stops a Retry of a posting Tally accepted.
create or replace function public.tally_post_enqueue(p_id uuid, p_client text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); c record; n int; dup text; allowed text; cname text; j record;
begin
  if f is null then raise exception 'not allowed'; end if;
  select t.company, t.device_id into c from tally_companies t
   where t.firm_id = f and t.client_id = p_client and t.device_id is not null order by t.last_seen desc nulls last limit 1;
  if c.company is null then return jsonb_build_object('ok', false, 'error', 'No Tally computer keeps this client''s company yet.'); end if;
  -- the one Tally company this client may post to
  select nullif(btrim(cl.data->>'postTo'), ''), cl.name into allowed, cname from clients cl where cl.firm_id = f and cl.id = p_client;
  if allowed is null then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', 'Choose the Tally company ' || coalesce(cname, 'this client') || ' may post to (Client setup → Tally). Its books in FinCom''s cloud come from ' || c.company || '.'); end if;
  if lower(tally_nm(allowed)) <> lower(tally_nm(c.company)) then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', coalesce(cname, 'This client') || ' may post only to ' || allowed || ', but its books in FinCom''s cloud come from ' || c.company || '. Nothing was posted.'); end if;
  -- the same posting again (Retry, by its id alone): a failed or cancelled one waits again, under the same id
  select * into j from tally_post_jobs where id = p_id;
  if found then
    if j.firm_id <> f or j.client_id <> p_client then raise exception 'not allowed'; end if;
    if j.status in ('failed', 'cancelled') then
      select coalesce(i.entry_id, i.fincom_id) into dup from tally_post_ids i
       where i.job_id = p_id and exists (select 1 from tally_post_ids o where o.firm_id = i.firm_id and o.fincom_id = i.fincom_id and o.job_id <> p_id and o.live) limit 1;
      if dup is not null then return jsonb_build_object('ok', false, 'error', 'Not queued again: the entry ' || dup || ' is being posted in another posting; wait for that one to finish (or cancel it).'); end if;
      update tally_post_jobs set status = 'waiting', message = 'Retry: waiting for the Tally computer', taken_at = null, updated_at = now(),
             attempts = coalesce(attempts, 0) + 1 where id = p_id;
      return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'retry', true);
    end if;
    return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'again', true);
  end if;
  if octet_length(p_payload::text) > 8 * 1024 * 1024 then return jsonb_build_object('ok', false, 'error', 'Too many entries in one go; post fewer at a time.'); end if;
  n := coalesce(jsonb_array_length(p_payload->'vouchers'), 0) + coalesce(jsonb_array_length(p_payload->'masters'), 0);
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'Nothing to post.'); end if;
  select v->>'id' into dup from tally_post_jobs j2, jsonb_array_elements(j2.payload->'vouchers') v
   where j2.firm_id = f and j2.client_id = p_client and j2.status in ('waiting', 'taken', 'running')
     and v->>'id' in (select x->>'id' from jsonb_array_elements(coalesce(p_payload->'vouchers', '[]'::jsonb)) x) limit 1;
  if dup is not null then return jsonb_build_object('ok', false, 'error', 'Some of these entries are already waiting to be posted; wait for that posting to finish.'); end if;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n)
    values (p_id, f, p_client, c.company, c.device_id, jsonb_build_object('masters', coalesce(p_payload->'masters', '[]'::jsonb), 'vouchers', coalesce(p_payload->'vouchers', '[]'::jsonb), 'ledger', coalesce(p_payload->>'ledger', '')), n);
  return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company);
end $function$;
revoke all on function public.tally_post_enqueue(uuid, text, jsonb) from public, anon;
grant execute on function public.tally_post_enqueue(uuid, text, jsonb) to authenticated;

-- F12, the backfill (an update of accepted_at where it is null, nothing else): the ids of the postings already here whose
-- results or items carry an acceptance by Tally, unless an owner released the id. Job 3b03cc5e gets accepted_at (its id
-- stays live, its status untouched). The count is said in the log. Running the file again stamps nothing new.
do $$
declare n int;
begin
  update tally_post_ids i set accepted_at = now(), accepted_vch = coalesce(i.accepted_vch, nullif(left(a.vch, 60), ''))
    from tally_post_jobs j, lateral (
      select r->>'id' id, coalesce(nullif(r->>'lastVchId', ''), nullif(r->>'vchNumber', ''), nullif(r->>'masterId', ''),
                                   substring(coalesce(r->>'message', '') || ' ' || coalesce(r->>'reason', '') from '(?i)(?:LASTVCHID|VCHID|MASTERID)\D{0,6}([1-9]\d*)')) vch
        from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r where r->>'id' is not null and tally_post_result_accepted(r)
      union all
      select x->>'id', substring(coalesce(x->>'reason', '') from '(?i)(?:LASTVCHID|VCHID|MASTERID)\D{0,6}([1-9]\d*)')
        from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) x where x->>'id' is not null and (tally_post_bool(x->>'accepted') or tally_post_accept_text(x->>'reason'))) a
   where i.job_id = j.id and i.accepted_at is null and i.released_by is distinct from 'owner' and tally_post_id_match(i.fincom_id, i.entry_id, a.id);
  get diagnostics n = row_count;
  raise notice 'migration 36b backfill: % id(s) stamped accepted_at', n;
end $$;

commit;
