-- Migration 212 (23-Nov-2026, branch next-payroll). A DRAFT: written and tested here (tests/run_migration212.py on
-- pg_stand, after 32 -> 203); NOT run anywhere. The owner runs it on staging after its own review. docs/PAYROLL.md
-- (ninth review).
--
-- A Tally Payroll part proven not in Tally (its day read from Tally at least 5 minutes after the send, its FinCom id not
-- there) is retired by Daily Check's Approve and its people are posted under a fresh part id. The old part's posting in
-- the cloud's queue stays failed or done, and nothing in 32 -> 203 stops it going again: a Retry (tally_post_enqueue with
-- its id) re-queues a failed or cancelled posting, and a posting of the old id would reach a bridge with no record of it:
-- those people paid twice. So an entry of a posting can be WITHDRAWN:
--   tally_post_ids.withdrawn_at / withdrawn_by / withdrawn_why   the mark, on the posting's own id row
--   tally_post_withdraw(p_job, p_id, p_why)   a member who may post (can_write) withdraws one entry of a posting of the
--                         firm that is not waiting, taken or running (else: 'still being sent'); a reason required
--   tally_post_withdrawn_guard (trigger, tally_post_jobs before update of status): a posting holding a withdrawn entry
--                         never becomes waiting, taken or running again (Retry, the requeue, a reroute): refused in words
--   tally_post_ids_withdrawn_guard (trigger, tally_post_ids before insert): a withdrawn FinCom id of the firm is never
--                         queued in another posting (the insert of tally_post_jobs fails in words)
-- The hand-out (tally_post_take_for) takes waiting postings only, so a withdrawn entry is never handed out again.
-- Grants: the trigger functions to nobody; tally_post_withdraw to authenticated. ADD-ONLY: three columns (if not
-- exists), one function, two trigger functions and their triggers (made if not there); nothing dropped or replaced, no
-- row changed. Safe to run twice. One transaction, lock_timeout 10 s.
begin;
set local lock_timeout = '10s';

-- the queue of 32 -> 203 first; then the names: every function this migration makes must be absent or be its own
do $names$
declare f text; bad text[] := '{}';
begin
  if to_regclass('public.tally_post_ids') is null or to_regclass('public.tally_post_jobs') is null
     or to_regprocedure('public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text)') is null then
    raise exception 'migration 212: run the posting queue''s migrations (32 -> 203) first';
  end if;
  foreach f in array array['tally_post_withdraw', 'tally_post_withdrawn_guard', 'tally_post_ids_withdrawn_guard'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f
                and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'posting withdrawn (migration 212)') then bad := bad || ('function ' || f); end if;
  end loop;
  if exists (select 1 from pg_trigger t where t.tgname in ('tally_post_jobs_withdrawn', 'tally_post_ids_withdrawn') and not t.tgisinternal
              and coalesce(obj_description(t.tgfoid, 'pg_proc'), '') <> 'posting withdrawn (migration 212)') then bad := bad || 'a trigger of the same name'::text; end if;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 212: these names are already used by something else: %. Nothing was changed.', array_to_string(bad, ', ');
  end if;
end $names$;

alter table public.tally_post_ids add column if not exists withdrawn_at timestamptz;
alter table public.tally_post_ids add column if not exists withdrawn_by uuid;
alter table public.tally_post_ids add column if not exists withdrawn_why text;
create index if not exists tally_post_ids_withdrawn on public.tally_post_ids (firm_id, fincom_id) where withdrawn_at is not null;

-- one entry of a posting withdrawn: never queued, retried or handed out again
create or replace function public.tally_post_withdraw(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); why text := left(btrim(coalesce(p_why, '')), 400); j tally_post_jobs%rowtype; n int;
begin
  if f is null or not can_write() then
    raise exception 'only a member of the firm who may post (an owner or staff) can withdraw an entry' using errcode = '42501'; end if;
  if why = '' then raise exception 'say why the entry is withdrawn (kept with your name and the time)'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f for update;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if j.status in ('waiting', 'taken', 'running') then
    return jsonb_build_object('ok', false, 'busy', true, 'error', 'This posting is still being sent to Tally; wait for it to finish.');
  end if;
  update tally_post_ids set withdrawn_at = coalesce(withdrawn_at, now()), withdrawn_by = coalesce(withdrawn_by, auth.uid()), withdrawn_why = coalesce(withdrawn_why, why)
   where job_id = p_job and tally_post_id_match(fincom_id, entry_id, p_id);
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'the entry ' || coalesce(p_id, '') || ' is not in this posting'); end if;
  return jsonb_build_object('ok', true, 'job', p_job, 'id', p_id, 'withdrawn', n, 'status', j.status);
end $function$;

-- a posting holding a withdrawn entry never waits, is taken or runs again
create or replace function public.tally_post_withdrawn_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare w text;
begin
  select coalesce(i.entry_id, i.fincom_id) into w from tally_post_ids i where i.job_id = new.id and i.withdrawn_at is not null limit 1;
  if w is not null then
    raise exception 'Not queued again: the entry % of this posting was withdrawn (it was replaced by another posting; sending it again could pay twice).', w using errcode = 'P0001';
  end if;
  return new;
end $function$;

-- a withdrawn FinCom id is never queued in another posting
create or replace function public.tally_post_ids_withdrawn_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if exists (select 1 from tally_post_ids i where i.firm_id = new.firm_id and i.fincom_id = new.fincom_id and i.withdrawn_at is not null and i.job_id <> new.job_id) then
    raise exception 'Not queued: the entry % was withdrawn (it was replaced by another posting; sending it again could pay twice).', coalesce(new.entry_id, new.fincom_id) using errcode = 'P0001';
  end if;
  return new;
end $function$;

do $trg$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_withdrawn' and tgrelid = 'public.tally_post_jobs'::regclass) then
    create trigger tally_post_jobs_withdrawn before update of status on public.tally_post_jobs for each row
      when (new.status in ('waiting', 'taken', 'running') and old.status is distinct from new.status)
      execute function public.tally_post_withdrawn_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_ids_withdrawn' and tgrelid = 'public.tally_post_ids'::regclass) then
    create trigger tally_post_ids_withdrawn before insert on public.tally_post_ids for each row
      execute function public.tally_post_ids_withdrawn_guard();
  end if;
end $trg$;

-- ---------------------------------------------------------------- function grants (explicit)
revoke all on function public.tally_post_withdraw(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tally_post_withdraw(uuid, text, text) to authenticated, service_role;
revoke all on function public.tally_post_withdrawn_guard() from public, anon, authenticated;
revoke all on function public.tally_post_ids_withdrawn_guard() from public, anon, authenticated;
grant execute on function public.tally_post_withdrawn_guard(), public.tally_post_ids_withdrawn_guard() to service_role;

comment on function public.tally_post_withdraw(uuid, text, text) is 'posting withdrawn (migration 212)';
comment on function public.tally_post_withdrawn_guard() is 'posting withdrawn (migration 212)';
comment on function public.tally_post_ids_withdrawn_guard() is 'posting withdrawn (migration 212)';

commit;
