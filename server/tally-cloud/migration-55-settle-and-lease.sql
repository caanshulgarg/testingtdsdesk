-- Migration 55 (05-Oct-2026, the owner's decisions B and D). Runs AFTER 54 (fresh database: ... -> 53 -> 54 -> 55; staging:
-- after 54). ADD-ONLY: no table, column, row or function removed; no statement in this file removes rows, not even in a
-- comment; safe to run twice; one transaction. Functions are created or replaced; tables and columns added if missing.
--
-- B. Any member of the firm who may write (owner or staff: can_write()) settles a posting whose result is uncertain; a
--    reason is required; the name and time are kept (tally_post_marks, by_user; the entry's stamp names the person).
--    The bridge reads ONE voucher only (the owner's rule for entry reads): FinComVoucherByNumber (type, number, the
--    entry's date), else FinComVoucherByMaster (Tally's id from its reply); never a day's list.
--    1. tally_post_job_mark_posted(job, id, vch, note): as 36b's, for any member who may write, the note (the reason)
--       required; the stamp says who marked it (by, byUser). tally_post_mark_core holds 36b's text, granted to nobody.
--    2. "Not in Tally - post again": tally_post_settle_ask(job, id, why) records a check (tally_post_checks) for the
--       posting's own bridge; nothing is released and nothing is sent. The bridge reads the one voucher the entry may be
--       (by its type, number and date; else by Tally's id from its reply) and looks for the entry's FinCom id,
--       TDSDesk:<id>, in its narration, then reports (tally_post_check_report, the service role: tally-ingest):
--         found     -> the entry is marked posted with the voucher found (in the asker's name); nothing is sent again;
--         notfound  -> ONLY when the company it looked in is the posting's own company and the bridge is the posting's
--                      bridge: the id is released (tally_post_release_core, 36b's release text, in the asker's name) and
--                      the posting waits to be sent again (once; the resend guard of 36b still applies);
--         unable    -> Tally could not be asked (the bridge offline, Tally busy or closed, the company not open, the 2-second
--                      stop), or the voucher is there with another FinCom id or none (a person must look), or the entry
--                      cannot be asked for (no number and no Tally id, a date the read rules do not allow): the check
--                      keeps waiting with the bridge's words and is asked again by itself; never released, never sent.
--    3. tally_post_id_release_owner(job, id, why): for any member who may write, and refused unless the posting's bridge
--       has reported "checked, not found" for that entry (the release itself is then already done: said, not repeated).
--    4. tally_post_checks_for(device, bridge, main): the waiting checks a bridge may answer (the service role), with
--       Tally's own voucher id from its reply when the result has one (for an entry with no voucher number).
-- D. Two bridges, one company: the lease (tally_company_lease, 32/37) marks its purpose ('post' or 'read'). A posting
--    that finds the lease held by another bridge's READ records "want to post" (want_post_*); the reader sees it on its
--    renewal (between two requests, never cutting one) and yields: the lease is handed to the posting bridge at once. A
--    posting never yields, to a read or to another posting (two postings serialize as before). A lease the reader gives
--    up while a posting wants it is kept for that posting (another read does not take it first). An older bridge (the
--    6-argument tally_lease_take, no purpose) is never asked to yield (it would not see the want).
--    tally_lease_take(firm, book, holder, device, ttl, info, purpose) is the new call; the 6-argument one calls it with
--    no purpose. tally_lease_release is unchanged (37's).
-- Tested on pg_stand only: tests/run_migration55.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- B. the checks the bridge answers
create table if not exists public.tally_post_checks (
  id              bigserial primary key,
  firm_id         uuid not null references public.firms(id),
  job_id          uuid not null references public.tally_post_jobs(id),
  entry_id        text not null,
  company         text not null,
  asked_by        uuid not null,
  asked_at        timestamptz not null default now(),
  why             text not null,
  state           text not null default 'waiting',      -- waiting | found | notfound | refused
  tries           integer not null default 0,
  last_try_at     timestamptz,
  last_words      text,
  checked_at      timestamptz,
  checked_bridge  text,
  checked_company text,
  found_vch       text,
  found_master    text,
  words           text,
  resent          boolean
);
create unique index if not exists tally_post_checks_waiting on public.tally_post_checks (job_id, entry_id) where state = 'waiting';
create index if not exists tally_post_checks_job on public.tally_post_checks (job_id, asked_at);
alter table public.tally_post_checks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_post_checks' and policyname = 'tally_post_checks_read') then
    create policy tally_post_checks_read on public.tally_post_checks for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
revoke insert, update on public.tally_post_checks from anon, authenticated;
grant select on public.tally_post_checks to authenticated;

-- a member's name, for the words kept with an entry
create or replace function public.tally_member_name(p_firm uuid, p_user uuid) returns text
language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select coalesce((select nullif(btrim(m.name), '') from members m where m.firm_id = p_firm and m.user_id = p_user limit 1), 'a member of the firm')
$function$;
revoke all on function public.tally_member_name(uuid, uuid) from public, anon, authenticated;

-- 36b's mark, in a member's name (internal: granted to nobody)
create or replace function public.tally_post_mark_core(p_firm uuid, p_user uuid, p_job uuid, p_id text, p_vch text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  j tally_post_jobs%rowtype; fid text := regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g');
  eid text; vch text := left(btrim(coalesce(p_vch, '')), 60); note text := left(btrim(coalesce(p_note, '')), 300);
  who text := tally_member_name(p_firm, p_user); stamp jsonb; res jsonb; its jsonb; o jsonb;
begin
  select * into j from tally_post_jobs where id = p_job and firm_id = p_firm;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if fid = '' then raise exception 'which entry? give its id'; end if;
  if vch = '' then raise exception 'give the voucher number as Tally shows it'; end if;
  select v->>'id' into eid from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where tally_post_id_match(tally_fincom_id(v), v->>'id', p_id) limit 1;
  if eid is null then raise exception 'the entry % is not in this posting', p_id; end if;
  stamp := jsonb_build_object('ok', true, 'verified', true, 'state', 'in_tally', 'outcomeUnknown', false, 'reason', '', 'vchNumber', vch, 'byOwner', true, 'byOwnerAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                              'by', who, 'byUser', p_user,
                              'message', 'Marked posted by ' || who || ' on ' || to_char(now(), 'DD-Mon-YYYY') || ': in Tally as voucher ' || vch || case when note <> '' then ' (' || note || ')' else '' end);
  select coalesce(jsonb_agg(case when tally_post_id_match(r->>'id', r->>'id', eid) or regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then r || stamp else r end), '[]'::jsonb) into res from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r;
  if not exists (select 1 from jsonb_array_elements(res) r where tally_post_bool(r->>'byOwner') and (r->>'id' = eid or regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid))
    then res := res || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher') || stamp); end if;
  select coalesce(jsonb_agg(case when tally_post_id_match(i->>'id', i->>'id', eid) or regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then i || jsonb_build_object('state', 'in_tally', 'reason', '', 'byOwner', true, 'byOwnerAt', stamp->>'byOwnerAt', 'by', who, 'byUser', p_user) else i end), '[]'::jsonb) into its from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) i;
  if not exists (select 1 from jsonb_array_elements(its) i where tally_post_bool(i->>'byOwner') and (i->>'id' = eid or regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid))
    then its := its || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher', 'state', 'in_tally', 'reason', '', 'byOwner', true, 'byOwnerAt', stamp->>'byOwnerAt', 'by', who, 'byUser', p_user)); end if;
  o := tally_post_job_settle(j.status, j.checking, j.payload, res, its);
  begin
    update tally_post_ids set live = true, accepted_at = coalesce(accepted_at, now()), accepted_vch = coalesce(nullif(vch, ''), accepted_vch), released_at = null, released_by = null, released_why = null
     where job_id = p_job and tally_post_id_match(fincom_id, entry_id, p_id);
  exception when unique_violation then
    raise exception 'the entry % is live in another posting; cancel that posting first, then mark this one', p_id;
  end;
  insert into tally_post_marks (firm_id, job_id, entry_id, action, vch, note, by_user) values (p_firm, p_job, eid, 'posted', vch, nullif(note, ''), p_user);
  update tally_post_jobs set results = res, items = its, status = o->>'status', checking = (o->>'checking')::boolean, done = greatest(done, (o->>'posted')::int),
         message = case when o->>'status' = 'done' and not (o->>'checking')::boolean then left('Marked posted by ' || who || case when note <> '' then ': ' || note else '' end, 500)
                        when o->>'status' <> j.status or (o->>'checking')::boolean <> coalesce(j.checking, false) then 'Settled by the mark of ' || eid || ' (' || who || '); ' || case when (o->>'checking')::boolean then 'another entry is still being checked' else 'the rest did not go through' end
                        else message end, updated_at = now()
   where id = p_job;
  return jsonb_build_object('ok', true, 'job', p_job, 'id', eid, 'vch', vch, 'by', who, 'posted', (o->>'posted')::int, 'of', (o->>'total')::int, 'status', o->>'status');
end $function$;
revoke all on function public.tally_post_mark_core(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;

-- 36b's release, in a member's name (internal: granted to nobody; reached only through the bridge's "not found")
create or replace function public.tally_post_release_core(p_firm uuid, p_user uuid, p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare
  j tally_post_jobs%rowtype; fid text := regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g');
  eid text; why text := left(btrim(coalesce(p_why, '')), 500); who text := tally_member_name(p_firm, p_user); stamp jsonb; res jsonb; its jsonb; n int; o jsonb;
begin
  select * into j from tally_post_jobs where id = p_job and firm_id = p_firm;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if fid = '' then raise exception 'which entry? give its id'; end if;
  if why = '' then raise exception 'say why: what you saw in Tally (kept with the entry)'; end if;
  select v->>'id' into eid from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where tally_post_id_match(tally_fincom_id(v), v->>'id', p_id) limit 1;
  if eid is null then raise exception 'the entry % is not in this posting', p_id; end if;
  -- released_by stays 'owner' (a person's release: the sync of 36b/37 and tally-ingest's hand-out read that value); the
  -- person is in tally_post_marks.by_user and in the entry's words
  update tally_post_ids set live = false, released_at = now(), released_by = 'owner', released_why = why
   where job_id = p_job and tally_post_id_match(fincom_id, entry_id, p_id);
  get diagnostics n = row_count;
  stamp := jsonb_build_object('ok', false, 'verified', false, 'state', 'notfound', 'outcomeUnknown', false, 'byOwner', true, 'byOwnerAt', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                              'by', who, 'byUser', p_user,
                              'reason', left('Not in Tally: released by ' || who || ' on ' || to_char(now(), 'DD-Mon-YYYY') || ' (' || why || ')', 700));
  select coalesce(jsonb_agg(case when r->>'id' = eid or regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then r || stamp else r end), '[]'::jsonb) into res from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r;
  if not exists (select 1 from jsonb_array_elements(res) r where tally_post_bool(r->>'byOwner') and (r->>'id' = eid or regexp_replace(coalesce(r->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid))
    then res := res || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher') || stamp); end if;
  select coalesce(jsonb_agg(case when i->>'id' = eid or regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid then i || jsonb_build_object('state', 'notfound', 'reason', stamp->>'reason', 'outcomeUnknown', false, 'byOwner', true, 'byOwnerAt', stamp->>'byOwnerAt', 'by', who, 'byUser', p_user) else i end), '[]'::jsonb) into its from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) i;
  if not exists (select 1 from jsonb_array_elements(its) i where tally_post_bool(i->>'byOwner') and (i->>'id' = eid or regexp_replace(coalesce(i->>'id', ''), '[^A-Za-z0-9]', '', 'g') = fid))
    then its := its || jsonb_build_array(jsonb_build_object('id', eid, 'kind', 'voucher', 'state', 'notfound', 'reason', stamp->>'reason', 'byOwner', true, 'byOwnerAt', stamp->>'byOwnerAt', 'by', who, 'byUser', p_user)); end if;
  o := tally_post_job_settle(j.status, j.checking, j.payload, res, its);
  insert into tally_post_marks (firm_id, job_id, entry_id, action, vch, note, by_user) values (p_firm, p_job, eid, 'released', null, why, p_user);
  update tally_post_jobs set results = res, items = its, status = o->>'status', checking = (o->>'checking')::boolean,
         message = case when o->>'status' <> j.status or (o->>'checking')::boolean <> coalesce(j.checking, false) then left('Released by ' || who || ': not in Tally (' || why || ')', 500) else message end, updated_at = now()
   where id = p_job;
  return jsonb_build_object('ok', true, 'job', p_job, 'id', eid, 'released', n > 0, 'n', n, 'by', who, 'status', o->>'status');
end $function$;
revoke all on function public.tally_post_release_core(uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- 1. Mark posted: any member who may write; a reason required
create or replace function public.tally_post_job_mark_posted(p_job uuid, p_id text, p_vch text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm();
begin
  if f is null or not can_write() then raise exception 'only a member of the firm who may post can mark an entry posted' using errcode = '42501'; end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'give a reason: where you saw the entry in Tally (kept with the entry, with your name)'; end if;
  return tally_post_mark_core(f, auth.uid(), p_job, p_id, p_vch, p_note);
end $function$;
revoke all on function public.tally_post_job_mark_posted(uuid, text, text, text) from public, anon;
grant execute on function public.tally_post_job_mark_posted(uuid, text, text, text) to authenticated;

-- 3. a release by hand: only after the posting's bridge looked in Tally and reported "not found" (then it is done already)
create or replace function public.tally_post_id_release_owner(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); why text := left(btrim(coalesce(p_why, '')), 500); c record; d record;
begin
  if f is null or not can_write() then raise exception 'only a member of the firm who may post can release an entry' using errcode = '42501'; end if;
  if why = '' then raise exception 'say why: what you saw in Tally (kept with the entry)'; end if;
  select * into c from tally_post_checks k where k.firm_id = f and k.job_id = p_job and k.state = 'notfound' and tally_post_id_match(k.entry_id, k.entry_id, p_id) order by k.id desc limit 1;
  if c.id is null then
    raise exception 'Not released: Tally has not been checked for this entry. Press "Not in Tally - post again": the bridge looks in Tally first, and FinCom frees the entry only when the bridge reports it is not there.' using errcode = '42501';
  end if;
  select i.live, i.released_at into d from tally_post_ids i where i.job_id = p_job and tally_post_id_match(i.fincom_id, i.entry_id, p_id) limit 1;
  if d.released_at is not null and not coalesce(d.live, false) then
    return jsonb_build_object('ok', true, 'job', p_job, 'id', c.entry_id, 'released', true, 'already', true, 'check', c.id);
  end if;
  return tally_post_release_core(f, auth.uid(), p_job, p_id, why) || jsonb_build_object('check', c.id);
end $function$;
revoke all on function public.tally_post_id_release_owner(uuid, text, text) from public, anon;
grant execute on function public.tally_post_id_release_owner(uuid, text, text) to authenticated;

-- 2. "Not in Tally - post again": a check for the posting's bridge; nothing released, nothing sent
create or replace function public.tally_post_settle_ask(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); why text := left(btrim(coalesce(p_why, '')), 500); j tally_post_jobs%rowtype; eid text; had record; nid bigint;
begin
  if f is null or not can_write() then raise exception 'only a member of the firm who may post can ask for this' using errcode = '42501'; end if;
  if why = '' then raise exception 'give a reason: what you saw in Tally (kept with the entry, with your name)'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f for update;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  select v->>'id' into eid from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where tally_post_id_match(tally_fincom_id(v), v->>'id', p_id) limit 1;
  if eid is null then raise exception 'the entry % is not in this posting', p_id; end if;
  if j.status in ('waiting', 'taken', 'running') and not coalesce(j.checking, false) then
    return jsonb_build_object('ok', false, 'error', 'This posting is still being sent to Tally; wait for it to finish, then settle the entry.');
  end if;
  -- an entry marked posted (deleted in Tally by hand since) is asked about the same way: found, it stays posted; not
  -- there, it is released and sent again
  select * into had from tally_post_checks k where k.job_id = p_job and k.entry_id = eid and k.state = 'waiting' limit 1;
  if had.id is not null then
    return jsonb_build_object('ok', true, 'check', had.id, 'state', 'waiting', 'again', true, 'company', j.company);
  end if;
  insert into tally_post_checks (firm_id, job_id, entry_id, company, asked_by, why, last_words)
  values (f, p_job, eid, j.company, auth.uid(), why, 'Waiting for the FinCom Bridge to look in ' || j.company || ' in Tally')
  returning id into nid;
  return jsonb_build_object('ok', true, 'check', nid, 'state', 'waiting', 'company', j.company,
    'words', 'The FinCom Bridge looks in ' || j.company || ' in Tally first. Only when the entry is not there is it sent again; when it is there, it is marked posted.');
end $function$;
revoke all on function public.tally_post_settle_ask(uuid, text, text) from public, anon;
grant execute on function public.tally_post_settle_ask(uuid, text, text) to authenticated;

-- 4. the checks a bridge may answer: those of its computer's postings that name it (or name none, when it is the main one)
create or replace function public.tally_post_checks_for(p_device uuid, p_bridge text, p_main boolean)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select coalesce(jsonb_agg(x.o order by x.id), '[]'::jsonb) from (
    select c.id, jsonb_build_object('check', c.id, 'job', c.job_id, 'entry', c.entry_id, 'company', j.company, 'why', c.why, 'askedAt', c.asked_at, 'tries', c.tries,
             'xml', (select v->>'xml' from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v where v->>'id' = c.entry_id limit 1),
             -- Tally's own voucher id for the entry from its reply (vchId; LASTVCHID only when the request held this one
             -- entry): the bridge asks Tally for that one voucher when the entry has no number (FinComVoucherByMaster)
             'vchId', (select coalesce(nullif(regexp_replace(coalesce(r->>'vchId', ''), '\D', '', 'g'), ''),
                                       case when coalesce(nullif(regexp_replace(coalesce(r->>'batchN', ''), '\D', '', 'g'), ''), '1')::bigint <= 1
                                            then nullif(regexp_replace(coalesce(r->>'lastVchId', ''), '\D', '', 'g'), '') end)
                         from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) r where r->>'id' = c.entry_id limit 1)) o
      from tally_post_checks c join tally_post_jobs j on j.id = c.job_id
     where c.state = 'waiting' and j.device_id = p_device
       and (j.target_bridge = p_bridge or (j.target_bridge is null and coalesce(p_main, false)))
     order by c.id limit 20) x
$function$;
revoke all on function public.tally_post_checks_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_checks_for(uuid, text, boolean) to service_role;

-- 2. the bridge's answer
create or replace function public.tally_post_check_report(p_check bigint, p_device uuid, p_bridge text, p_main boolean, p_company text, p_result text, p_vch text, p_master text, p_words text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare c tally_post_checks%rowtype; j tally_post_jobs%rowtype; res text := lower(btrim(coalesce(p_result, ''))); v_words text := left(btrim(coalesce(p_words, '')), 500);
        v text; r jsonb; v_resent boolean := false; said text;
begin
  select * into c from tally_post_checks where id = p_check for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such check'); end if;
  if c.state <> 'waiting' then return jsonb_build_object('ok', true, 'state', c.state, 'already', true); end if;
  select * into j from tally_post_jobs where id = c.job_id for update;
  if j.device_id is distinct from p_device or not (coalesce(j.target_bridge = p_bridge, false) or (j.target_bridge is null and coalesce(p_main, false))) then
    return jsonb_build_object('ok', false, 'error', 'This check is for the bridge that posts this posting, not this one.');
  end if;
  if res = 'unable' then
    update tally_post_checks set tries = tries + 1, last_try_at = now(), last_words = coalesce(nullif(v_words, ''), 'Tally could not be asked just now; it is asked again by itself') where id = c.id;
    return jsonb_build_object('ok', true, 'state', 'waiting');
  end if;
  if res not in ('found', 'notfound') then return jsonb_build_object('ok', false, 'error', 'found, notfound or unable'); end if;
  -- that exact company: what the bridge looked in is the posting's own company
  if lower(tally_nm(coalesce(p_company, ''))) <> lower(tally_nm(j.company)) then
    update tally_post_checks set tries = tries + 1, last_try_at = now(), last_words = left('The bridge looked in ' || coalesce(nullif(p_company, ''), 'another company') || ', not in ' || j.company || '; asked again', 500) where id = c.id;
    return jsonb_build_object('ok', false, 'error', 'The check is for ' || j.company || ', not ' || coalesce(nullif(p_company, ''), 'another company') || '.');
  end if;
  if res = 'found' then
    v := coalesce(nullif(left(btrim(coalesce(p_vch, '')), 60), ''), nullif(left(btrim(coalesce(p_master, '')), 60), ''));
    if v is null then return jsonb_build_object('ok', false, 'error', 'found, but no voucher number or id given'); end if;
    begin
      r := tally_post_mark_core(c.firm_id, c.asked_by, c.job_id, c.entry_id, v, left('Found in ' || j.company || ' by the FinCom Bridge''s check (' || c.why || ')', 300));
    exception when others then
      update tally_post_checks set state = 'refused', checked_at = now(), checked_bridge = p_bridge, checked_company = p_company, words = left(sqlerrm, 500) where id = c.id;
      return jsonb_build_object('ok', false, 'state', 'refused', 'error', sqlerrm);
    end;
    update tally_post_checks set state = 'found', checked_at = now(), checked_bridge = p_bridge, checked_company = p_company, found_vch = nullif(btrim(coalesce(p_vch, '')), ''),
           found_master = nullif(btrim(coalesce(p_master, '')), ''), words = nullif(v_words, ''), resent = false where id = c.id;
    return jsonb_build_object('ok', true, 'state', 'found', 'vch', v, 'job', c.job_id, 'entry', c.entry_id);
  end if;
  -- checked, not found: released in the asker's name, then the posting waits to be sent again (once)
  r := tally_post_release_core(c.firm_id, c.asked_by, c.job_id, c.entry_id,
         left(c.why || ' (the FinCom Bridge looked in ' || j.company || ' on ' || to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST: not there)', 500));
  select * into j from tally_post_jobs where id = c.job_id;
  if j.status in ('failed', 'done') and not coalesce(j.checking, false) then
    begin
      update tally_post_jobs set status = 'waiting', message = 'Not in Tally (the FinCom Bridge looked): sent again', taken_at = null, updated_at = now(),
             attempts = coalesce(attempts, 0) + 1 where id = c.job_id;
      v_resent := true;
    exception when others then
      said := sqlerrm;
    end;
  else
    said := 'released; it is sent again when the posting''s other entries are settled';
  end if;
  update tally_post_checks set state = 'notfound', checked_at = now(), checked_bridge = p_bridge, checked_company = p_company, words = left(coalesce(nullif(v_words, ''), '') || case when said is not null then ' ' || said else '' end, 500),
         resent = v_resent where id = c.id;
  return jsonb_build_object('ok', true, 'state', 'notfound', 'resent', v_resent, 'job', c.job_id, 'entry', c.entry_id, 'words', said);
end $function$;
revoke all on function public.tally_post_check_report(bigint, uuid, text, boolean, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.tally_post_check_report(bigint, uuid, text, boolean, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------- D. the lease: its purpose, and "want to post"
alter table public.tally_company_lease add column if not exists purpose text;             -- 'post' | 'read'; null: an older bridge
alter table public.tally_company_lease add column if not exists want_post_by text;        -- a posting bridge waiting for a reader to yield
alter table public.tally_company_lease add column if not exists want_post_at timestamptz;
alter table public.tally_company_lease add column if not exists want_post_device uuid;
alter table public.tally_company_lease add column if not exists want_post_info jsonb;
alter table public.tally_company_lease add column if not exists want_post_ttl integer;

create or replace function public.tally_lease_take(p_firm uuid, p_book uuid, p_holder text, p_device uuid, p_ttl integer, p_info jsonb, p_purpose text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare l tally_company_lease%rowtype; ttl int := greatest(30, least(coalesce(p_ttl, 120), 900));
        pp text := case when p_purpose in ('post', 'read') then p_purpose end; live boolean; fresh boolean;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  perform pg_advisory_xact_lock(hashtext('lease' || p_book::text));
  select * into l from tally_company_lease where book_id = p_book;
  live := l.book_id is not null and l.released_at is null and l.until > now();
  fresh := l.want_post_by is not null and l.want_post_at > now() - interval '2 minutes';
  if live and l.holder <> p_holder then
    -- held by another bridge. A posting finding it held for a read: its want is recorded (the first posting's, while fresh)
    if pp = 'post' and l.purpose = 'read' then
      if not fresh or l.want_post_by = p_holder then
        update tally_company_lease set want_post_by = p_holder, want_post_at = now(), want_post_device = p_device, want_post_info = coalesce(p_info, '{}'::jsonb), want_post_ttl = ttl where book_id = p_book;
      end if;
      return jsonb_build_object('ok', true, 'held', true, 'wanted', true, 'purpose', 'read', 'holder', jsonb_build_object('bridge', l.holder, 'computer', l.info->>'computer', 'user', l.info->>'user',
        'until', to_char(l.until at time zone 'Asia/Kolkata', 'HH24:MI'), 'untilAt', l.until));
    end if;
    return jsonb_build_object('ok', true, 'held', true, 'purpose', coalesce(l.purpose, ''), 'holder', jsonb_build_object('bridge', l.holder, 'computer', l.info->>'computer', 'user', l.info->>'user',
      'until', to_char(l.until at time zone 'Asia/Kolkata', 'HH24:MI'), 'untilAt', l.until));
  end if;
  -- the reader's own renewal while a posting wants the company: it yields, the lease handed to the posting bridge
  if live and l.holder = p_holder and pp = 'read' and l.purpose = 'read' and fresh and l.want_post_by <> p_holder then
    update tally_company_lease set holder = l.want_post_by, device_id = l.want_post_device, info = coalesce(l.want_post_info, '{}'::jsonb), purpose = 'post', taken_at = now(),
           until = now() + make_interval(secs => greatest(30, least(coalesce(l.want_post_ttl, 120), 900))), released_at = null,
           want_post_by = null, want_post_at = null, want_post_device = null, want_post_info = null, want_post_ttl = null
     where book_id = p_book;
    return jsonb_build_object('ok', true, 'held', true, 'yield', true, 'purpose', 'post', 'holder', jsonb_build_object('bridge', l.want_post_by, 'computer', l.want_post_info->>'computer', 'user', l.want_post_info->>'user'));
  end if;
  -- free (released or expired) while a posting wants it: kept for that posting; a read waits
  if not live and fresh and l.want_post_by <> p_holder and pp is distinct from 'post' then
    return jsonb_build_object('ok', true, 'held', true, 'reserved', true, 'purpose', 'post', 'holder', jsonb_build_object('bridge', l.want_post_by, 'computer', l.want_post_info->>'computer', 'user', l.want_post_info->>'user'));
  end if;
  insert into tally_company_lease (book_id, firm_id, holder, device_id, info, taken_at, until, released_at, purpose)
  values (p_book, p_firm, p_holder, p_device, coalesce(p_info, '{}'::jsonb), now(), now() + make_interval(secs => ttl), null, pp)
  on conflict (book_id) do update set holder = excluded.holder, device_id = excluded.device_id, info = excluded.info,
     taken_at = case when tally_company_lease.holder = excluded.holder and tally_company_lease.released_at is null and tally_company_lease.until > now() then tally_company_lease.taken_at else now() end,
     until = excluded.until, released_at = null, purpose = excluded.purpose,
     want_post_by = null, want_post_at = null, want_post_device = null, want_post_info = null, want_post_ttl = null;
  return jsonb_build_object('ok', true, 'held', false, 'purpose', coalesce(pp, ''), 'lease', jsonb_build_object('until', now() + make_interval(secs => ttl), 'ttl', ttl));
end $function$;
revoke all on function public.tally_lease_take(uuid, uuid, text, uuid, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.tally_lease_take(uuid, uuid, text, uuid, integer, jsonb, text) to service_role;

-- the 6-argument call (an older bridge, or tally-ingest without 55's knowledge): no purpose, never asked to yield
create or replace function public.tally_lease_take(p_firm uuid, p_book uuid, p_holder text, p_device uuid, p_ttl integer, p_info jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return tally_lease_take(p_firm, p_book, p_holder, p_device, p_ttl, p_info, null::text);
end $function$;
revoke all on function public.tally_lease_take(uuid, uuid, text, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.tally_lease_take(uuid, uuid, text, uuid, integer, jsonb) to service_role;

commit;
