-- Migration 90 (15-Oct-2026, branch next-ledger-fetch; the coordinator's finding on staging the same day). Migration 89's
-- tally_ledger_fetch_plan took 5,251 ms on GARG SHEKHAR (10,326 lines, 1,112 live ledgers) and 580 ms on GB TEXCOAT (2,960
-- lines, 224 ledgers): for each name the book's entries use it compared the cleaned name and the loose key of every live
-- ledger (used x live tally_nm / regexp calls, quadratic). tally-ingest asks it on every beat (30 s) for each open company.
-- This file replaces that ONE function (same arguments, same result, same rules, same grants) with a set-based pass: the
-- live ledgers' names, cleaned names and loose keys are worked out once and met by hash joins; the aliases likewise; only
-- the names still missing are looked up for a live entry. Measured on pg_stand (tests/run_migration90.py): see
-- docs/MIGRATION-ORDER.md.
--
-- Runs AFTER 89 (89 is on staging). ADD-ONLY: no table, column, row or function removed; one function replaced (create or
-- replace, the same signature); no statement in this file removes rows; safe to run twice; one transaction (lock_timeout
-- 10 s). Tested on pg_stand only: tests/run_migration90.py (run_migration89.py's checks again with 90 in force, and the
-- timing on generated books of 1,100 ledgers / 10,000 lines and 4,006 ledgers / 100,000 lines),
-- tests/run_ledger_fetch_server.py (through tally-ingest) and tests/run_migration_order.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

create or replace function public.tally_ledger_fetch_plan(p_book uuid, p_company text, p_paused boolean default false, p_room integer default 20, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_firm uuid; v_miss text[]; v_n int; v_key text; v_st public.tally_ledger_fetch; v_had boolean; v_rounds int; v_round_at timestamptz;
  v_want boolean := false; v_full boolean := false; v_why text; v_names text[] := '{}'; v_room int := greatest(0, least(20, coalesce(p_room, 20)));
  v_now timestamptz := coalesce(p_now, now());
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select b.firm_id into v_firm from tally_books b where b.book_id = p_book;
  if v_firm is null then return jsonb_build_object('ok', false, 'note', 'no such book', 'names', '[]'::jsonb, 'full', false); end if;
  -- reading paused in the tray or stopped (by the bridge or from FinCom): nothing asked, nothing recorded
  if coalesce(p_paused, false) then return jsonb_build_object('ok', true, 'paused', true, 'names', '[]'::jsonb, 'full', false); end if;
  perform pg_advisory_xact_lock(hashtext('tally_ledger_fetch:' || p_book::text));
  -- 90: one set-based pass, linear in the book's size, with no index assumed beyond the books' keys. The names the book's
  -- LIVE entries use: the book's lines met with its live entries by a hash join, made distinct once (89 walked
  -- tally_lines_ledger one name at a time and looked each missing name up again: without that index, a scan each time).
  -- The live ledgers' names, cleaned names and loose keys worked out ONCE, then hash joins: a used name held by its exact or
  -- cleaned name, by the one live ledger of its loose key, or by an alias (not ended) whose FinCom ledger is held so, is
  -- left out. No per-pair tally_nm / regexp (89: used x live calls)
  with used as materialized (
      select distinct l.ledger from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
       where l.book_id = p_book and v.book_id = p_book and v.deleted_at is null and l.ledger is not null and btrim(l.ledger) <> ''),
    live as materialized (
      select tl.name, public.tally_nm(tl.name) as nm, public.tally_ledger_loose(tl.name) as lk
        from tally_ledgers tl where tl.book_id = p_book and tl.deleted_at is null and tl.merged_into is null),
    have as materialized (select live.name as n from live union select live.nm from live),
    keys as materialized (select live.lk, count(*) as cnt from live group by live.lk),
    aka as materialized (
      select distinct a.tally_name from tally_ledger_aliases a join keys k on k.lk = public.tally_ledger_loose(a.fincom_name) and k.cnt = 1
       where a.book_id = p_book and a.ended_at is null),
    cand as materialized (
      select u.ledger, public.tally_ledger_loose(u.ledger) as lk from used u
       where not exists (select 1 from have where have.n = u.ledger)
         and not exists (select 1 from aka where aka.tally_name = u.ledger))
  select array_agg(x.ledger order by x.ledger) into v_miss from (
    select c.ledger from cand c left join keys k on k.lk = c.lk where coalesce(k.cnt, 0) <> 1
     order by c.ledger limit 21) x;
  v_n := coalesce(array_length(v_miss, 1), 0);
  select * into v_st from tally_ledger_fetch s where s.book_id = p_book for update;
  v_had := found;
  if v_n = 0 then
    if v_had and (v_st.missing_n <> 0 or v_st.names_key <> '' or v_st.rounds <> 0) then
      update tally_ledger_fetch s set missing_n = 0, names_key = '', names = '[]'::jsonb, rounds = 0, round_at = null, checked_at = v_now, updated_at = now() where s.book_id = p_book;
    end if;
    return jsonb_build_object('ok', true, 'names', '[]'::jsonb, 'full', false, 'missing', 0);
  end if;
  v_key := md5(array_to_string(v_miss, chr(31)));
  v_rounds := coalesce(v_st.rounds, 0); v_round_at := v_st.round_at;
  if v_n > 20 then
    v_want := true; v_why := 'more than 20 ledgers the entries use are not in FinCom';
  else
    -- a round: the names sent (room for them), one a 10 minutes at most (the bridge asks a name at most once in 10 minutes)
    if not v_had or v_st.names_key is distinct from v_key then
      v_rounds := case when v_room > 0 then 1 else 0 end; v_round_at := case when v_room > 0 then v_now end;
    elsif v_room > 0 and (v_round_at is null or v_now - v_round_at >= interval '10 minutes' or v_round_at > v_now + interval '1 minute') then
      v_rounds := v_rounds + 1; v_round_at := v_now;
    end if;
    if v_rounds > 3 then v_want := true; v_why := 'the same ledgers still missing after 3 rounds asked by name'; end if;
  end if;
  if v_want then
    -- at most once in 30 minutes a book; while it waits, nothing is asked by name (the full list brings them)
    if v_st.full_at is null or v_now - v_st.full_at >= interval '30 minutes' or v_st.full_at > v_now + interval '1 minute' then v_full := true; end if;
  else
    -- a name a TDL string cannot hold (the bridge's ledNameOK: spaces around it, a quote mark, a control character, over 200
    -- characters) is never named: it stays missing, and after 3 rounds the full list brings it
    select coalesce(array_agg(z.m order by z.m), '{}') into v_names from (
      select m from unnest(v_miss) m where m = btrim(m) and char_length(m) <= 200 and position('"' in m) = 0 and m !~ '[[:cntrl:]]' order by m limit v_room) z;
  end if;
  insert into tally_ledger_fetch as s (book_id, firm_id, company, missing_n, names_key, names, rounds, round_at, full_at, full_n, full_why, checked_at, updated_at)
  values (p_book, v_firm, left(coalesce(p_company, ''), 200), v_n, v_key, to_jsonb(v_miss), v_rounds, v_round_at, case when v_full then v_now end, case when v_full then 1 else 0 end, case when v_full then v_why end, v_now, now())
  on conflict (book_id) do update set company = excluded.company, missing_n = excluded.missing_n, names_key = excluded.names_key, names = excluded.names,
    rounds = excluded.rounds, round_at = excluded.round_at, checked_at = excluded.checked_at, updated_at = excluded.updated_at,
    full_at = case when v_full then v_now else s.full_at end, full_n = s.full_n + case when v_full then 1 else 0 end, full_why = case when v_full then v_why else s.full_why end;
  return jsonb_build_object('ok', true, 'names', to_jsonb(v_names), 'full', v_full, 'missing', v_n, 'rounds', v_rounds)
    || case when v_want then jsonb_build_object('why', v_why, 'fullAt', case when v_full then v_now else v_st.full_at end) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_ledger_fetch_plan(uuid, text, boolean, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_ledger_fetch_plan(uuid, text, boolean, integer, timestamptz) to service_role;

commit;
