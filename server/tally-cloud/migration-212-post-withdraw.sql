-- Migration 212 (23-Nov-2026, branch next-payroll). A DRAFT: written and tested here (tests/run_migration212.py on
-- pg_stand, after 32 -> 203); NOT run anywhere. The owner runs it on staging after its own review. docs/PAYROLL.md
-- (ninth review; its SQL review and re-review). Two steps: this file (one transaction), then migration-212-indexes.sql
-- with tools/apply_concurrent_indexes.py (its two indexes built CONCURRENTLY, then tally_post_withdraw_arm() makes the
-- three guard triggers); until they are there and enabled, tally_post_withdraw refuses, so no entry is marked withdrawn
-- without its guards.
--
-- A Tally Payroll part proven not in Tally (its day read from Tally at least 5 minutes after the send, its FinCom id not
-- there) is retired by Daily Check's Approve and its people are posted under a fresh part id. The old part's posting
-- stays failed or done, and nothing in 32 -> 203 stops it going again: a Retry (tally_post_enqueue with its id) re-queues
-- a failed or cancelled posting, and a posting of the old id would reach a bridge with no record of it: those people
-- paid twice. So a Tally Payroll entry of a posting can be WITHDRAWN (a part's id carries its client:
-- dc-tp-<yyyymm>-<client>-p<n>; an older one dc-tp-<yyyymm>-<n>; each matched within its client):
--   tally_post_ids.withdrawn_at / _by / _why, undone_at / _by / _why   the mark on the posting's own id row, and its undo
--   tally_post_withdraw(p_job, p_id, p_why)   a member who may post (can_write) withdraws one Tally Payroll entry of a
--                         posting of the firm, with a reason. Refused (busy) while the posting is waiting, taken or
--                         running, held for checking (done + checking: its bridge went silent and may still post), held by
--                         its bridge (tally_post_bridge_holds), owing or reserving an entry to send again
--                         (tally_post_resend_reserved), or with a check of Tally for one of its entries not settled
--                         (waiting, or not seen in Tally and not confirmed)
--   tally_post_withdraw_undo(p_job, p_id, p_why)   the firm's OWNER takes a withdrawal back (who and why kept)
--   (triggers, made by tally_post_withdraw_arm from the second step)
--   tally_post_withdrawn_guard   a posting never becomes waiting, taken or running again when an entry it would send is
--                         withdrawn (its whole payload, or its resend_only list: a hand-back of another entry goes on),
--                         nor when it has nothing to send at all.
--                         A trigger can only refuse by raising: its words come back as the call's error
--   tally_post_jobs_withdrawn_filter   a QUEUED posting (status waiting, not a record of a posting already made:
--                         tally_post_record's rows are done or failed, payload.recorded) leaves a withdrawn id of its
--                         client out (as 184 leaves out an entry another posting holds), its result saying so (kept by
--                         tally-ingest's merge: byItself); a posting of nothing else is not queued: refused in words
--                         (a trigger refuses only by raising; the enqueue then answers with that error)
--   tally_post_checks_withdrawn_guard   a check of Tally is never asked or confirmed for a withdrawn entry (else the
--                         posting would owe it for ever and the cron try it every minute)
-- The hand-out (tally_post_take_for) takes waiting postings only, so a withdrawn entry is never handed out again.
-- Grants: the trigger functions and tally_post_withdraw_arm to nobody (a trigger needs none; the owner's runner calls arm);
-- tally_post_withdraw and tally_post_withdraw_undo to authenticated (each checks the member itself). ADD-ONLY: six columns
-- (made only when absent), seven functions; nothing dropped or replaced, no row changed. Safe to run twice. One
-- transaction, lock_timeout 3 s.
begin;
set local lock_timeout = '3s';

-- the queue of 32 -> 203 first; then the names: every function, column and index this migration makes must be absent or
-- be its own
do $names$
declare f text; c text; bad text[] := '{}';
begin
  if to_regclass('public.tally_post_ids') is null or to_regclass('public.tally_post_jobs') is null
     or to_regprocedure('public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text)') is null
     or to_regprocedure('public.tally_post_resend_reserved(uuid)') is null or to_regprocedure('public.tally_post_bridge_holds(uuid)') is null
     or to_regclass('public.tally_post_checks') is null then
    raise exception 'migration 212: run the posting queue''s migrations (32 -> 203) first';
  end if;
  foreach f in array array['tally_post_withdraw', 'tally_post_withdraw_undo', 'tally_post_withdraw_busy', 'tally_post_withdraw_arm', 'tally_post_withdrawn_guard', 'tally_post_jobs_withdrawn_filter', 'tally_post_checks_withdrawn_guard', 'tally_post_withdrawn_words'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f
                and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'posting withdrawn (migration 212)') then bad := bad || ('function ' || f); end if;
  end loop;
  foreach c in array array['withdrawn_at:timestamp with time zone', 'withdrawn_by:uuid', 'withdrawn_why:text', 'undone_at:timestamp with time zone', 'undone_by:uuid', 'undone_why:text'] loop
    if exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = 'tally_post_ids' and k.column_name = split_part(c, ':', 1)
                and k.data_type <> split_part(c, ':', 2)) then bad := bad || ('column tally_post_ids.' || split_part(c, ':', 1)); end if;
  end loop;
  foreach c in array array['tally_post_ids_withdrawn', 'tally_post_ids_withdrawn_job'] loop
    if exists (select 1 from pg_class i join pg_index x on x.indexrelid = i.oid where i.relname = c and i.relnamespace = 'public'::regnamespace and x.indrelid <> 'public.tally_post_ids'::regclass)
       or exists (select 1 from pg_class i where i.relname = c and i.relnamespace = 'public'::regnamespace and i.relkind <> 'i') then bad := bad || ('index ' || c); end if;
  end loop;
  if exists (select 1 from pg_trigger t where t.tgname in ('tally_post_jobs_withdrawn', 'tally_post_jobs_withdrawn_filter', 'tally_post_checks_withdrawn') and not t.tgisinternal
              and coalesce(obj_description(t.tgfoid, 'pg_proc'), '') <> 'posting withdrawn (migration 212)') then bad := bad || 'a trigger of the same name'::text; end if;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 212: these names are already used by something else: %. Nothing was changed.', array_to_string(bad, ', ');
  end if;
end $names$;

-- the columns, each only when absent (a second run takes no lock on the table)
do $cols$
declare c text;
begin
  foreach c in array array['withdrawn_at timestamptz', 'withdrawn_by uuid', 'withdrawn_why text', 'undone_at timestamptz', 'undone_by uuid', 'undone_why text'] loop
    if not exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = 'tally_post_ids' and k.column_name = split_part(c, ' ', 1)) then
      execute 'alter table public.tally_post_ids add column ' || c;
    end if;
  end loop;
end $cols$;

-- a posting whose bridge may still send it, or that owes another entry: words, else null
create or replace function public.tally_post_withdraw_busy(p_job uuid) returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select case
    when j.status in ('waiting', 'taken', 'running') then 'This posting is still being sent to Tally; wait for it to finish.'
    when j.status = 'done' and coalesce(j.checking, false) then 'This posting is held while FinCom checks whether it reached Tally; wait for that to finish.'
    when tally_post_bridge_holds(j.id) then 'The FinCom Bridge that took this posting still holds it; wait for it to report.'
    when exists (select 1 from tally_post_resend_reserved(j.firm_id) rv where rv.job_id = j.id) then 'This posting still has an entry to send again; wait for that to finish.'
    when exists (select 1 from tally_post_checks k where k.job_id = j.id and k.state in ('waiting', 'notseen')) then 'A check of Tally for an entry of this posting is not settled yet (waiting, or not seen in Tally and not confirmed); settle it first.'
  end from tally_post_jobs j where j.id = p_job
$function$;

-- one Tally Payroll entry of a posting withdrawn: never queued, retried or handed out again
create or replace function public.tally_post_withdraw(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); why text := left(btrim(coalesce(p_why, '')), 400); j tally_post_jobs%rowtype; n int; busy text;
begin
  if f is null or not can_write() then
    raise exception 'only a member of the firm who may post (an owner or staff) can withdraw an entry' using errcode = '42501'; end if;
  if coalesce(p_id, '') !~ '^dc-tp-\d{6}-(([a-z0-9]{1,40}|h\.[a-z0-9]{1,16})-p)?\d+$' then raise exception 'only a Tally Payroll part (dc-tp-<yyyymm>-<client>-p<n>) can be withdrawn'; end if;
  if why = '' then raise exception 'say why the entry is withdrawn (kept with your name and the time)'; end if;
  -- (re-review 6) the three guards there AND enabled
  if (select count(*) from pg_trigger t where not t.tgisinternal and t.tgenabled in ('O', 'A')
        and ((t.tgname in ('tally_post_jobs_withdrawn', 'tally_post_jobs_withdrawn_filter') and t.tgrelid = 'public.tally_post_jobs'::regclass)
             or (t.tgname = 'tally_post_checks_withdrawn' and t.tgrelid = 'public.tally_post_checks'::regclass))) < 3 then
    return jsonb_build_object('ok', false, 'error', 'FinCom''s cloud cannot withdraw an entry yet (migration 212''s second step is not run).');
  end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f for update;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  busy := tally_post_withdraw_busy(p_job);
  if busy is not null then return jsonb_build_object('ok', false, 'busy', true, 'error', busy); end if;
  update tally_post_ids set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_why = why, undone_at = null, undone_by = null, undone_why = null
   where job_id = p_job and withdrawn_at is null and tally_post_id_match(fincom_id, entry_id, p_id);
  get diagnostics n = row_count;
  if n = 0 and not exists (select 1 from tally_post_ids where job_id = p_job and withdrawn_at is not null and tally_post_id_match(fincom_id, entry_id, p_id)) then
    return jsonb_build_object('ok', false, 'error', 'the entry ' || p_id || ' is not in this posting'); end if;
  return jsonb_build_object('ok', true, 'job', p_job, 'id', p_id, 'withdrawn', n, 'status', j.status);
end $function$;

-- the owner takes a withdrawal back (who, when and why kept on the row)
create or replace function public.tally_post_withdraw_undo(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); why text := left(btrim(coalesce(p_why, '')), 400); n int;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true)) then
    raise exception 'only the firm''s owner can take a withdrawal back' using errcode = '42501'; end if;
  if why = '' then raise exception 'say why the withdrawal is taken back (kept with your name and the time)'; end if;
  if not exists (select 1 from tally_post_jobs where id = p_job and firm_id = f) then raise exception 'this posting is not in your firm (or not found)'; end if;
  update tally_post_ids set withdrawn_at = null, undone_at = now(), undone_by = auth.uid(), undone_why = why
   where job_id = p_job and withdrawn_at is not null and tally_post_id_match(fincom_id, entry_id, p_id);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', n > 0, 'job', p_job, 'id', p_id, 'undone', n) || case when n = 0 then jsonb_build_object('error', 'the entry ' || coalesce(p_id, '') || ' is not withdrawn in this posting') else '{}'::jsonb end;
end $function$;

-- (trigger) a posting never waits, is taken or runs again when an entry it would send is withdrawn: its whole payload, or
-- only its resend_only list (a hand-back of another entry goes on)
create or replace function public.tally_post_withdrawn_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare w text;
begin
  -- (212's approval) a posting with nothing to send (every entry left out as withdrawn) never waits again
  if coalesce(jsonb_array_length(case when jsonb_typeof(new.payload -> 'vouchers') = 'array' then new.payload -> 'vouchers' end), 0) = 0
     and coalesce(jsonb_array_length(case when jsonb_typeof(new.payload -> 'masters') = 'array' then new.payload -> 'masters' end), 0) = 0 then
    raise exception 'Not queued again: this posting has nothing to send (its entries were withdrawn).' using errcode = 'P0001';
  end if;
  select coalesce(i.entry_id, i.fincom_id) into w from tally_post_ids i
   where i.job_id = new.id and i.withdrawn_at is not null
     and (jsonb_typeof(new.resend_only) is distinct from 'array'
          or exists (select 1 from jsonb_array_elements_text(new.resend_only) r(eid) where tally_post_id_match(i.fincom_id, i.entry_id, r.eid)))
   limit 1;
  if w is not null then
    raise exception 'Not queued again: %', tally_post_withdrawn_words(new.id, w) using errcode = 'P0001';
  end if;
  return new;
end $function$;

-- the words for a withdrawn entry: who withdrew it and why (never a reason it does not have)
create or replace function public.tally_post_withdrawn_words(p_job uuid, p_entry text) returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select 'the entry ' || coalesce(p_entry, '') || ' was withdrawn' || coalesce(' (' || nullif(btrim(i.withdrawn_why), '') || ')', '') || '; sending it again could pay twice.'
    from (select 1) one left join lateral (select w.withdrawn_why from tally_post_ids w where w.job_id = p_job and w.withdrawn_at is not null
                                            and tally_post_id_match(w.fincom_id, w.entry_id, p_entry) limit 1) i on true
$function$;

-- (trigger) a withdrawn FinCom id of the same client is left out of a QUEUED posting, its result saying so; nothing else
-- in it: not queued, in words
create or replace function public.tally_post_jobs_withdrawn_filter()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare out_ jsonb; gone_ jsonb; n_ int; at_ text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  -- (re-review B2) only a posting queued to be sent: never a record of one already made (tally_post_record: done or failed,
  -- payload.recorded), nor any other row
  if new.status is distinct from 'waiting' or coalesce(new.payload ->> 'recorded', '') = 'true' or jsonb_typeof(new.payload -> 'vouchers') is distinct from 'array'
     or not exists (select 1 from tally_post_ids w where w.firm_id = new.firm_id and w.client_id = new.client_id and w.withdrawn_at is not null) then return new; end if;
  -- (re-review small 1, 5) by tally_post_id_match's own keys (the same text, or the same letters and digits, case kept): a
  -- withdrawn key starts "dctp", so only an entry whose id has "dc" in it, or whose XML has the tag "TDSDesk:dc" (found
  -- case-sensitively, before anything is spelled), can be one
  with w as materialized (select distinct y.s as k from tally_post_ids w cross join lateral (values (w.fincom_id), (w.entry_id), (regexp_replace(coalesce(w.fincom_id, ''), '[^A-Za-z0-9]', '', 'g')),
                                                   (regexp_replace(coalesce(w.entry_id, ''), '[^A-Za-z0-9]', '', 'g'))) y(s)
                           where w.firm_id = new.firm_id and w.client_id = new.client_id and w.withdrawn_at is not null and coalesce(y.s, '') <> ''),
       c as (select t.x, t.o from jsonb_array_elements(new.payload -> 'vouchers') with ordinality t(x, o)),
       v as (select c.x, c.o, (strpos(coalesce(c.x ->> 'id', ''), 'dc') > 0
                               and ((c.x ->> 'id') in (select k from w) or regexp_replace(c.x ->> 'id', '[^A-Za-z0-9]', '', 'g') in (select k from w)))
                           or (strpos(coalesce(c.x ->> 'xml', ''), 'TDSDesk:dc') > 0
                               and (tally_fincom_id(c.x) in (select k from w) or regexp_replace(coalesce(tally_fincom_id(c.x), ''), '[^A-Za-z0-9]', '', 'g') in (select k from w))) as gone
               from c)
  select coalesce(jsonb_agg(x order by o) filter (where not gone), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id', 'kind', 'voucher', 'ok', false, 'withdrawn', true, 'state', 'failed',
                  'byItself', true, 'byItselfAt', at_, 'by', 'FinCom (by itself)', 'message', 'Not queued: this entry was withdrawn; sending it again could pay twice.') order by o) filter (where gone), '[]'::jsonb)
    into out_, gone_ from v;
  n_ := jsonb_array_length(gone_);
  if n_ = 0 then return new; end if;
  new.payload := jsonb_set(new.payload, '{vouchers}', out_);
  new.n := jsonb_array_length(out_) + coalesce(jsonb_array_length(new.payload -> 'masters'), 0);
  new.results := coalesce(case when jsonb_typeof(new.results) = 'array' then new.results end, '[]'::jsonb) || gone_;
  if new.n = 0 then
    -- (212's approval) nothing else in it: not queued, in words (the enqueue answers with an error, never {ok: true})
    raise exception '%', left('Not queued: ' || (select string_agg(g ->> 'id', ', ') from jsonb_array_elements(gone_) g) || case when n_ = 1 then ' was' else ' were' end
                        || ' withdrawn; sending ' || case when n_ = 1 then 'it' else 'them' end || ' again could pay twice.', 500) using errcode = 'P0001';
  else
    new.message := left(coalesce(new.message || ' ', '') || 'Left out: ' || (select string_agg(g ->> 'id', ', ') from jsonb_array_elements(gone_) g) || case when n_ = 1 then ' was' else ' were' end || ' withdrawn.', 500);
  end if;
  return new;
end $function$;

-- (trigger, re-review 4) a check of Tally is never asked or confirmed for a withdrawn entry of its posting
create or replace function public.tally_post_checks_withdrawn_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if new.state in ('waiting', 'confirmed') and exists (select 1 from tally_post_ids i where i.job_id = new.job_id and i.withdrawn_at is not null and tally_post_id_match(i.fincom_id, i.entry_id, new.entry_id)) then
    raise exception 'Not possible: %', tally_post_withdrawn_words(new.job_id, new.entry_id) using errcode = 'P0001';
  end if;
  return new;
end $function$;

-- the three guard triggers made, each only when absent (lock_timeout 3 s): called by migration-212-indexes.sql once its
-- indexes are valid (that file runs one statement per call)
create or replace function public.tally_post_withdraw_arm()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare made text[] := '{}';
begin
  perform set_config('lock_timeout', '3s', true);
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_withdrawn' and tgrelid = 'public.tally_post_jobs'::regclass) then
    create trigger tally_post_jobs_withdrawn before update of status, resend_only on public.tally_post_jobs for each row
      when (new.status in ('waiting', 'taken', 'running') and (old.status is distinct from new.status or old.resend_only is distinct from new.resend_only))
      execute function public.tally_post_withdrawn_guard();
    made := made || 'tally_post_jobs_withdrawn'::text;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_withdrawn_filter' and tgrelid = 'public.tally_post_jobs'::regclass) then
    create trigger tally_post_jobs_withdrawn_filter before insert on public.tally_post_jobs for each row execute function public.tally_post_jobs_withdrawn_filter();
    made := made || 'tally_post_jobs_withdrawn_filter'::text;
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_checks_withdrawn' and tgrelid = 'public.tally_post_checks'::regclass) then
    create trigger tally_post_checks_withdrawn before insert or update of state on public.tally_post_checks for each row execute function public.tally_post_checks_withdrawn_guard();
    made := made || 'tally_post_checks_withdrawn'::text;
  end if;
  return jsonb_build_object('ok', true, 'made', to_jsonb(made));
end $function$;

-- ---------------------------------------------------------------- function grants (explicit)
revoke all on function public.tally_post_withdraw(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.tally_post_withdraw(uuid, text, text) to authenticated;
revoke all on function public.tally_post_withdraw_undo(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.tally_post_withdraw_undo(uuid, text, text) to authenticated;
revoke all on function public.tally_post_withdraw_busy(uuid) from public, anon, authenticated, service_role;
revoke all on function public.tally_post_withdrawn_guard() from public, anon, authenticated, service_role;
revoke all on function public.tally_post_jobs_withdrawn_filter() from public, anon, authenticated, service_role;
revoke all on function public.tally_post_withdraw_arm() from public, anon, authenticated, service_role;
revoke all on function public.tally_post_checks_withdrawn_guard() from public, anon, authenticated, service_role;
revoke all on function public.tally_post_withdrawn_words(uuid, text) from public, anon, authenticated, service_role;

comment on function public.tally_post_withdraw(uuid, text, text) is 'posting withdrawn (migration 212)';
comment on function public.tally_post_withdraw_undo(uuid, text, text) is 'posting withdrawn (migration 212)';
comment on function public.tally_post_withdraw_busy(uuid) is 'posting withdrawn (migration 212)';
comment on function public.tally_post_withdrawn_guard() is 'posting withdrawn (migration 212)';
comment on function public.tally_post_jobs_withdrawn_filter() is 'posting withdrawn (migration 212)';
comment on function public.tally_post_withdraw_arm() is 'posting withdrawn (migration 212)';
comment on function public.tally_post_checks_withdrawn_guard() is 'posting withdrawn (migration 212)';
comment on function public.tally_post_withdrawn_words(uuid, text) is 'posting withdrawn (migration 212)';

commit;
