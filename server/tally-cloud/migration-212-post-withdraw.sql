-- Migration 212 (23-Nov-2026, branch next-payroll). A DRAFT: written and tested here (tests/run_migration212.py on
-- pg_stand, after 32 -> 203); NOT run anywhere. The owner runs it on staging after its own review. docs/PAYROLL.md
-- (ninth review; its SQL review). Two steps: this file (one transaction), then migration-212-indexes.sql with
-- tools/apply_concurrent_indexes.py (its two indexes built CONCURRENTLY, then the two guard triggers made); until the
-- triggers are there, tally_post_withdraw refuses, so no entry is marked withdrawn without its guards.
--
-- A Tally Payroll part proven not in Tally (its day read from Tally at least 5 minutes after the send, its FinCom id not
-- there) is retired by Daily Check's Approve and its people are posted under a fresh part id. The old part's posting
-- stays failed or done, and nothing in 32 -> 203 stops it going again: a Retry (tally_post_enqueue with its id) re-queues
-- a failed or cancelled posting, and a posting of the old id would reach a bridge with no record of it: those people
-- paid twice. So a Tally Payroll entry of a posting can be WITHDRAWN:
--   tally_post_ids.withdrawn_at / _by / _why, undone_at / _by / _why   the mark on the posting's own id row, and its undo
--   tally_post_withdraw(p_job, p_id, p_why)   a member who may post (can_write) withdraws one Tally Payroll entry
--                         (dc-tp-<yyyymm>-<n>) of a posting of the firm, with a reason. Refused (busy) while the posting
--                         is waiting, taken or running, held for checking (done + checking: its bridge went silent and may
--                         still post), held by its bridge (tally_post_bridge_holds), or while it owes or reserves an entry
--                         to send again (tally_post_resend_reserved: its hand-back must stay possible)
--   tally_post_withdraw_undo(p_job, p_id, p_why)   the firm's OWNER takes a withdrawal back (who and why kept)
--   tally_post_withdrawn_guard (trigger, migration-212-indexes.sql): a posting never becomes waiting, taken or running
--                         again when an entry it would send is withdrawn (its whole payload, or its resend_only list)
--   tally_post_jobs_withdrawn_filter (trigger, the same): a withdrawn FinCom id is left out of a new posting (as 184
--                         leaves out an entry another posting holds), its result saying so; a posting of nothing else is
--                         refused in words
-- The hand-out (tally_post_take_for) takes waiting postings only, so a withdrawn entry is never handed out again.
-- Grants: the trigger functions and tally_post_withdraw_arm to nobody (a trigger needs none; the owner's runner calls arm); tally_post_withdraw and tally_post_withdraw_undo to
-- authenticated (each checks the member itself). ADD-ONLY: six columns (made only when absent), six functions (the triggers made by tally_post_withdraw_arm, from the second step);
-- nothing dropped or replaced, no row changed. Safe to run twice. One transaction, lock_timeout 3 s.
begin;
set local lock_timeout = '3s';

-- the queue of 32 -> 203 first; then the names: every function, column and index this migration makes must be absent or
-- be its own
do $names$
declare f text; c text; bad text[] := '{}';
begin
  if to_regclass('public.tally_post_ids') is null or to_regclass('public.tally_post_jobs') is null
     or to_regprocedure('public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text)') is null
     or to_regprocedure('public.tally_post_resend_reserved(uuid)') is null or to_regprocedure('public.tally_post_bridge_holds(uuid)') is null then
    raise exception 'migration 212: run the posting queue''s migrations (32 -> 203) first';
  end if;
  foreach f in array array['tally_post_withdraw', 'tally_post_withdraw_undo', 'tally_post_withdraw_busy', 'tally_post_withdraw_arm', 'tally_post_withdrawn_guard', 'tally_post_jobs_withdrawn_filter'] loop
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
  if exists (select 1 from pg_trigger t where t.tgname in ('tally_post_jobs_withdrawn', 'tally_post_jobs_withdrawn_filter') and not t.tgisinternal
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
  end from tally_post_jobs j where j.id = p_job
$function$;

-- one Tally Payroll entry of a posting withdrawn: never queued, retried or handed out again
create or replace function public.tally_post_withdraw(p_job uuid, p_id text, p_why text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); why text := left(btrim(coalesce(p_why, '')), 400); j tally_post_jobs%rowtype; n int; busy text;
begin
  if f is null or not can_write() then
    raise exception 'only a member of the firm who may post (an owner or staff) can withdraw an entry' using errcode = '42501'; end if;
  if coalesce(p_id, '') !~ '^dc-tp-\d{6}-\d+$' then raise exception 'only a Tally Payroll part (dc-tp-<yyyymm>-<n>) can be withdrawn'; end if;
  if why = '' then raise exception 'say why the entry is withdrawn (kept with your name and the time)'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_withdrawn' and tgrelid = 'public.tally_post_jobs'::regclass)
     or not exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_withdrawn_filter' and tgrelid = 'public.tally_post_jobs'::regclass) then
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
  select coalesce(i.entry_id, i.fincom_id) into w from tally_post_ids i
   where i.job_id = new.id and i.withdrawn_at is not null
     and (jsonb_typeof(new.resend_only) is distinct from 'array'
          or exists (select 1 from jsonb_array_elements_text(new.resend_only) r(eid) where tally_post_id_match(i.fincom_id, i.entry_id, r.eid)))
   limit 1;
  if w is not null then
    raise exception 'Not queued again: the entry % of this posting was withdrawn (it was replaced by another posting; sending it again could pay twice).', w using errcode = 'P0001';
  end if;
  return new;
end $function$;

-- (trigger) a withdrawn FinCom id is left out of a new posting, its result saying why; nothing else in it: refused
create or replace function public.tally_post_jobs_withdrawn_filter()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare out_ jsonb; gone_ jsonb;
begin
  if jsonb_typeof(new.payload -> 'vouchers') is distinct from 'array'
     or not exists (select 1 from tally_post_ids w where w.firm_id = new.firm_id and w.withdrawn_at is not null) then return new; end if;
  -- (each spelling by key, letters and digits in small letters: the withdrawn ids few, a hashed look per entry; only an
  -- entry whose id or tag names a Tally Payroll part can be one, so the rest are not spelled at all)
  with w as materialized (select distinct z.k from tally_post_ids w cross join lateral (values (w.fincom_id), (w.entry_id)) y(s)
                            cross join lateral (select lower(regexp_replace(coalesce(y.s, ''), '[^A-Za-z0-9]', '', 'g')) k) z
                           where w.firm_id = new.firm_id and w.withdrawn_at is not null and z.k <> ''),
       v as (select t.x, t.o, (strpos(lower(coalesce(t.x ->> 'id', '')), 'tp') > 0 or strpos(lower(coalesce(t.x ->> 'xml', '')), 'tdsdesk:dc') > 0)
                    and (lower(regexp_replace(coalesce(tally_fincom_id(t.x), ''), '[^A-Za-z0-9]', '', 'g')) in (select k from w)
                         or lower(regexp_replace(coalesce(t.x ->> 'id', ''), '[^A-Za-z0-9]', '', 'g')) in (select k from w)) as gone
               from jsonb_array_elements(new.payload -> 'vouchers') with ordinality t(x, o))
  select coalesce(jsonb_agg(x order by o) filter (where not gone), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('id', x ->> 'id', 'kind', 'voucher', 'ok', false, 'withdrawn', true, 'state', 'failed',
                  'message', 'Not queued: this entry was withdrawn (it was replaced by another posting; sending it again could pay twice).') order by o) filter (where gone), '[]'::jsonb)
    into out_, gone_ from v;
  if jsonb_array_length(gone_) = 0 then return new; end if;
  if jsonb_array_length(out_) = 0 and coalesce(jsonb_array_length(new.payload -> 'masters'), 0) = 0 then
    raise exception 'Not queued: % was withdrawn (it was replaced by another posting; sending it again could pay twice).', (select string_agg(g ->> 'id', ', ') from jsonb_array_elements(gone_) g) using errcode = 'P0001';
  end if;
  new.payload := jsonb_set(new.payload, '{vouchers}', out_);
  new.n := jsonb_array_length(out_) + coalesce(jsonb_array_length(new.payload -> 'masters'), 0);
  new.results := coalesce(case when jsonb_typeof(new.results) = 'array' then new.results end, '[]'::jsonb) || gone_;
  return new;
end $function$;

-- the two guard triggers made, each only when absent (lock_timeout 3 s): called by migration-212-indexes.sql once its
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

comment on function public.tally_post_withdraw(uuid, text, text) is 'posting withdrawn (migration 212)';
comment on function public.tally_post_withdraw_undo(uuid, text, text) is 'posting withdrawn (migration 212)';
comment on function public.tally_post_withdraw_busy(uuid) is 'posting withdrawn (migration 212)';
comment on function public.tally_post_withdrawn_guard() is 'posting withdrawn (migration 212)';
comment on function public.tally_post_jobs_withdrawn_filter() is 'posting withdrawn (migration 212)';
comment on function public.tally_post_withdraw_arm() is 'posting withdrawn (migration 212)';

commit;
