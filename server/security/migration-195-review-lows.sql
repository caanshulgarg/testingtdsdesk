-- migration-195-review-lows.sql (13-Nov-2026, branch next-sec-db; the database review of 13-Nov-2026, items L1, L2, L4,
-- L7, L10, L11 and the performance notes). Written, NOT run yet: the owner reads it and runs it.
-- Needs migrations 1, 47, 77, 101, 108, 118 and 119 (the functions and policies it restates).
-- What it does, each small:
--   A. autopost_claim, autopost_mark (101's text, replaced with the same arguments): they also ask what every other
--      writing function asks: the two-step sign-in done (my_firm()) and the firm takes changes (can_write(): not
--      read-only, paused or closed). The answers are {ok: false, error} as their other refusals.
--   B. charge_usage (1's text, same arguments): a look-only member is answered {ok: false, reason: "look_only"} (the app
--      says so: src/js/27-firm-account.js); everything else goes to charge_for as before.
--   C. post_inbox (the document inbox's function for a drop key; its text is on the database, not in the repo, so it
--      is kept as it is, word for word, under the name post_inbox_base, and post_inbox, same arguments and grants,
--      checks the document's addresses first and then calls it): p_data.url, when given, must be https://...;
--      p_data.filePath, when given, a plain path (no scheme, no leading slash, no ".." step). As refresh_inbox_link
--      asks already. A post_inbox that is not of the expected form is left alone and this says so.
--   D. Storage: the policies that let a member add a file to the firm's folder of doc-inbox and tally-uploads also ask
--      can_write() (each policy's own text kept, "and can_write()" added; the other buckets' policies ask it already).
--   E. trigger functions of public: EXECUTE taken back from public, anon and authenticated (a trigger runs whatever
--      the caller may execute; nothing calls these by name).
--   F. search_path fixed (public, pg_temp) on tally_post_jobs_undismiss_on_retry, firms_guard, asst_none, asst_col and
--      asst_tds_rule. Left as they are, on purpose: the procedures tally_recorder_drain_run and cron_run_details_trim
--      (they commit, which a procedure with a fixed setting may not: migrations 47 and 157) and tally_nm and
--      sync_empty (one-line SQL the planner writes into the calling query; a fixed setting would stop that on the
--      busiest reads). All four use only built-in functions and run with the caller's own rights.
--   G. four policies ask auth.uid() once a query, not once a row: "(select auth.uid())" (assistant_mismatches,
--      assistant_mismatch_status, client_timings twice; each rewritten from its own text as migration 87 did; the
--      rows each lets through are the same).
--   H. two indexes on foreign keys that are read or cascaded by: assistant_notice_events (notice_id) and
--      firm_signals (firm_id).
-- Add-only: one function added (post_inbox_base, a copy), four replaced with the same arguments, two indexes; policies
-- altered in place (never dropped); no table, column or row changed; grants restated. One transaction, lock_timeout
-- 10 s; safe twice. Tested by tests/run_migration195.py (pg_stand).
begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.autopost_claims') is null or to_regprocedure('public.charge_for(uuid, uuid, text, numeric, text, text)') is null
     or to_regprocedure('public.can_write()') is null or to_regprocedure('public.my_firm()') is null then
    raise exception 'migration 195 needs migrations 101 (autopost_claims), 119 (charge_for) and the base schema (my_firm, can_write) to be there first';
  end if;
end $$;

-- ---------------------------------------------------------------- A. Post automatically
-- claim entries for a run: [{id, kind, amount, rule}] -> {ok, taken: [id], refused: [{id, why}], day_used, per_day}
create or replace function public.autopost_claim(p_client text, p_run uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  uid uuid := auth.uid(); f uuid; r text; cfg jsonb; per_entry numeric; per_day numeric; d date := (now() at time zone 'Asia/Kolkata')::date;
  used numeric; it jsonb; eid text; k text; amt numeric; c autopost_claims%rowtype; taken text[] := '{}'; refused jsonb := '[]';
begin
  select m.firm_id, m.role into f, r from members m where m.user_id = uid and coalesce(m.active, true) limit 1;
  if f is null then return jsonb_build_object('ok', false, 'error', 'Not a member of a firm.'); end if;
  if r not in ('owner', 'staff') then return jsonb_build_object('ok', false, 'error', 'Only the owner or staff may post.'); end if;
  -- 195: the two-step sign-in done (my_firm() says the firm only then) and the firm takes changes (can_write())
  if public.my_firm() is distinct from f then return jsonb_build_object('ok', false, 'error', 'Finish the two-step sign-in first.'); end if;
  if not public.can_write() then return jsonb_build_object('ok', false, 'error', 'This firm''s FinCom account is read-only now: nothing is posted.'); end if;
  if p_run is null or jsonb_typeof(p_items) <> 'array' then return jsonb_build_object('ok', false, 'error', 'Nothing to claim.'); end if;
  select public.autopost_cfg(cl.data #> '{choices,autopost,value}') into cfg from clients cl where cl.firm_id = f and cl.id = p_client and not coalesce(cl.deleted, false);
  if cfg is null then return jsonb_build_object('ok', false, 'error', 'No such client.'); end if;
  if not public.autopost_bool(cfg->'on') then return jsonb_build_object('ok', false, 'error', 'Post automatically is off for this client.'); end if;
  per_entry := public.autopost_lim(cfg->'perEntry'); if per_entry = 'infinity' then per_entry := 50000; end if;
  per_day := nullif(public.autopost_lim(cfg->'perDay'), 'infinity');
  perform pg_advisory_xact_lock(hashtextextended('autopost:' || f::text || ':' || p_client, 0));
  select coalesce(sum(x.amount), 0) into used from autopost_claims x where x.firm_id = f and x.client_id = p_client and x.day = d and x.status in ('claimed', 'queued', 'posted')
    and not (x.status = 'claimed' and x.lease_until <= now());
  for it in select value from jsonb_array_elements(p_items) loop
    eid := it->>'id'; k := it->>'kind';
    amt := case when coalesce(it->>'amount', '') ~ '^[0-9]+(\.[0-9]+)?$' then (it->>'amount')::numeric else null end;
    if eid is null or eid = '' or k not in ('bank', 'bill') or amt is null then refused := refused || jsonb_build_object('id', eid, 'why', 'not readable'); continue; end if;
    if (k = 'bank' and not public.autopost_bool(cfg->'bank')) or (k = 'bill' and not public.autopost_bool(cfg->'bills')) then refused := refused || jsonb_build_object('id', eid, 'why', 'switched off for ' || k); continue; end if;
    if amt > per_entry then refused := refused || jsonb_build_object('id', eid, 'why', 'over the limit per entry'); continue; end if;
    select * into c from autopost_claims x where x.firm_id = f and x.client_id = p_client and x.entry_id = eid for update;
    if found and (c.status in ('posted', 'queued', 'undone') or (c.status = 'claimed' and c.lease_until > now() and c.run_id <> p_run)) then
      refused := refused || jsonb_build_object('id', eid, 'why', 'already taken (' || c.status || ')'); continue;
    end if;
    if found and c.status = 'claimed' and c.day = d and c.lease_until > now() then used := used - c.amount; end if;
    if per_day is not null and used + amt > per_day then refused := refused || jsonb_build_object('id', eid, 'why', 'daily limit'); continue; end if;
    insert into autopost_claims (firm_id, client_id, entry_id, run_id, kind, amount, rule, day, status, claimed_by, claimed_at, lease_until, updated_at, updated_by)
    values (f, p_client, eid, p_run, k, amt, left(it->>'rule', 20), d, 'claimed', uid, now(), now() + interval '10 minutes', now(), uid)
    on conflict (firm_id, client_id, entry_id) do update set run_id = excluded.run_id, kind = excluded.kind, amount = excluded.amount, rule = excluded.rule, day = excluded.day,
      status = 'claimed', job_id = null, claimed_by = excluded.claimed_by, claimed_at = now(), lease_until = excluded.lease_until, updated_at = now(), updated_by = excluded.updated_by;
    used := used + amt; taken := taken || eid;
  end loop;
  return jsonb_build_object('ok', true, 'taken', to_jsonb(taken), 'refused', refused, 'day_used', used, 'per_day', per_day, 'day', d);
end $$;

-- where the run's entries went: queued, posted, failed, released (and undone, as "who may undo" allows)
create or replace function public.autopost_mark(p_client text, p_run uuid, p_ids text[], p_status text, p_job uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); f uuid; r text; cfg jsonb; n int;
begin
  select m.firm_id, m.role into f, r from members m where m.user_id = uid and coalesce(m.active, true) limit 1;
  if f is null or r not in ('owner', 'staff') then return jsonb_build_object('ok', false, 'error', 'Only the owner or staff may.'); end if;
  -- 195: as autopost_claim
  if public.my_firm() is distinct from f then return jsonb_build_object('ok', false, 'error', 'Finish the two-step sign-in first.'); end if;
  if not public.can_write() then return jsonb_build_object('ok', false, 'error', 'This firm''s FinCom account is read-only now: nothing is changed.'); end if;
  if p_status not in ('queued', 'posted', 'failed', 'undone', 'released') then return jsonb_build_object('ok', false, 'error', 'Not a state.'); end if;
  if p_status = 'undone' then
    select public.autopost_cfg(cl.data #> '{choices,autopost,value}') into cfg from clients cl where cl.firm_id = f and cl.id = p_client;
    if coalesce(cfg->>'whoUndo', '') = 'owner' and r <> 'owner' then return jsonb_build_object('ok', false, 'error', 'Only the owner may undo an automatic entry.'); end if;
  end if;
  update autopost_claims x set status = p_status, job_id = coalesce(p_job, x.job_id), updated_at = now(), updated_by = uid,
    lease_until = case when p_status in ('posted', 'queued', 'undone') then 'infinity'::timestamptz else x.lease_until end
   where x.firm_id = f and x.client_id = p_client and x.entry_id = any(p_ids)
     and (x.run_id = p_run or p_status = 'undone') and not (x.status = 'undone');
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- ---------------------------------------------------------------- B. a charge by the app
create or replace function public.charge_usage(p_code text, p_qty numeric, p_ref text default '', p_note text default '')
returns jsonb language sql security definer set search_path to 'public' as $$
  select case when coalesce(p_qty, 0) <= 0 or p_qty > 1000 then jsonb_build_object('ok', false, 'reason', 'bad_qty')
              when public.my_firm() is not null and not exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role in ('owner', 'staff'))
                then jsonb_build_object('ok', false, 'reason', 'look_only')
              else public.charge_for(public.my_firm(), auth.uid(), p_code, p_qty, p_ref, p_note) end
$$;

-- ---------------------------------------------------------------- C. the document inbox
-- the addresses of a waiting document: a link over https, a plain path
create or replace function public.inbox_data_ok(p_data jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select (coalesce(p_data ->> 'url', '') = '' or (p_data ->> 'url') ~* '^https://[^/\s]+')
     and (coalesce(p_data ->> 'filePath', '') = ''
          or ((p_data ->> 'filePath') !~ '^[/\\]' and (p_data ->> 'filePath') !~ '^[A-Za-z][A-Za-z0-9+.-]*:' and (p_data ->> 'filePath') !~ '(^|[/\\])\.\.([/\\]|$)'))
$$;
do $wrap$
declare f record; def text; args text; names text;
begin
  select p.oid, p.prosrc, p.proretset, p.proargnames, p.pronargs, p.proargmodes, pg_get_function_result(p.oid) as res, pg_get_function_arguments(p.oid) as args, p.prosecdef
    into f from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'post_inbox';
  if not found then
    raise notice 'migration 195: public.post_inbox is not on this database; nothing to do for it';
  elsif (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'post_inbox') <> 1 then
    raise notice 'migration 195: more than one public.post_inbox; left as they are';
  elsif position('post_inbox_base' in f.prosrc) > 0 then
    null;                                     -- done before
  elsif f.proretset or f.proargmodes is not null or f.proargnames is null or not ('p_data' = any(f.proargnames)) or f.res = 'void'
        or (select t.typname from pg_proc p join pg_type t on t.oid = p.proargtypes[array_position(p.proargnames, 'p_data') - 1] where p.oid = f.oid) <> 'jsonb' then
    raise notice 'migration 195: public.post_inbox is not of the expected form (one answer, an argument p_data jsonb); left as it is';
  else
    -- its own text under another name, then post_inbox in front of it
    def := pg_get_functiondef(f.oid);
    if position('FUNCTION public.post_inbox(' in def) = 0 then raise exception 'migration 195: post_inbox''s definition is not readable'; end if;
    execute replace(def, 'FUNCTION public.post_inbox(', 'FUNCTION public.post_inbox_base(');
    select string_agg(quote_ident(a), ', ' order by o) into names from unnest(f.proargnames) with ordinality x(a, o);
    execute format($f$create or replace function public.post_inbox(%s) returns %s language plpgsql security definer set search_path = '' as $body$
begin
  -- 195: the document's addresses first (post_inbox_base is this function's text before 195, unchanged)
  if not public.inbox_data_ok(p_data) then
    raise exception 'The document''s link must be an https:// address and its file path a plain path.' using errcode = '22023';
  end if;
  return public.post_inbox_base(%s);
end $body$$f$, f.args, f.res, names);
  end if;
  if to_regproc('public.post_inbox_base') is not null then
    execute format('revoke all on function %s from public, anon, authenticated, service_role', to_regproc('public.post_inbox_base')::oid::regprocedure);
  end if;
end $wrap$;
revoke all on function public.inbox_data_ok(jsonb) from public, anon, authenticated;
grant execute on function public.inbox_data_ok(jsonb) to service_role;

-- ---------------------------------------------------------------- D. adding a file to the firm's folder
do $pol$
declare p record;
begin
  if to_regclass('storage.objects') is null then raise notice 'migration 195: Storage is not on this database; no policy changed'; return; end if;
  for p in select policyname, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'
            and policyname in ('doc inbox: add to own firm', 'tally_uploads_add') and with_check is not null and with_check !~* 'can_write\(\)' loop
    execute format('alter policy %I on storage.objects with check ((%s) and (select public.can_write()))', p.policyname, p.with_check);
  end loop;
end $pol$;

-- ---------------------------------------------------------------- E. trigger functions; F. search_path
do $fn$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prorettype = 'trigger'::regtype loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and not p.prosecdef
            and p.proname in ('tally_post_jobs_undismiss_on_retry', 'firms_guard', 'asst_none', 'asst_col', 'asst_tds_rule')
            and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $fn$;

-- ---------------------------------------------------------------- G. auth.uid() once a query
do $pol$
declare p record; q text; c text;
begin
  for p in select tablename, policyname, qual, with_check from pg_policies where schemaname = 'public'
            and (tablename, policyname) in (('assistant_mismatches', 'assistant_mismatches_owner_read'), ('assistant_mismatch_status', 'assistant_mismatch_status_owner_read'),
                                            ('client_timings', 'client_timings_insert_own'), ('client_timings', 'client_timings_read_owner')) loop
    if coalesce(p.qual, '') ~* 'select\s+auth\.uid\(\)' or coalesce(p.with_check, '') ~* 'select\s+auth\.uid\(\)' then continue; end if;
    q := regexp_replace(p.qual, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    c := regexp_replace(p.with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g');
    if q is not null and q is distinct from p.qual then execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, q); end if;
    if c is not null and c is distinct from p.with_check then execute format('alter policy %I on public.%I with check (%s)', p.policyname, p.tablename, c); end if;
  end loop;
end $pol$;

-- ---------------------------------------------------------------- H. foreign keys read or cascaded by
do $ix$
begin
  if to_regclass('public.assistant_notice_events') is not null then
    create index if not exists assistant_notice_events_notice on public.assistant_notice_events (notice_id);
  end if;
  if to_regclass('public.firm_signals') is not null then
    create index if not exists firm_signals_firm on public.firm_signals (firm_id) where firm_id is not null;
  end if;
end $ix$;

-- ---------------------------------------------------------------- who may call (restated)
revoke all on function public.autopost_claim(text, uuid, jsonb), public.autopost_mark(text, uuid, text[], text, uuid) from public, anon;
grant execute on function public.autopost_claim(text, uuid, jsonb), public.autopost_mark(text, uuid, text[], text, uuid) to authenticated, service_role;
revoke all on function public.charge_usage(text, numeric, text, text) from public, anon;
grant execute on function public.charge_usage(text, numeric, text, text) to authenticated;

commit;
