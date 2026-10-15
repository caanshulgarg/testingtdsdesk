-- Migration 89 (15-Oct-2026, branch next-ledger-fetch; the owner's decision of 15-Oct-2026). Cloud only: FinCom Bridge 2.4.4
-- is not changed and asks Tally nothing new (its existing FinComLedgerByName for the beat's ledgersWanted, and its existing
-- "ledgers" run for the beat's ledgers answer).
--
--   1. The ledgers the book's live entries use that FinCom's ledger list does not hold (the "unknown ledger" lines the owner
--      sees): tally_ledger_fetch_plan(book, company, paused, room, now) answers, for tally-ingest's beat, the names to put in
--      ledgersWanted (at most `room`, at most 20), or that the full ledger list should be asked for instead (full: true).
--      A name is held by FinCom (not wanted) as the app's Rec.unkGroups / the ledger check match it: the same name; else
--      the same name without capitals and spaces (tally_ledger_loose) when exactly one live ledger of the book has it; else a
--      name Tally gave a ledger FinCom holds (tally_ledger_aliases, not ended) whose FinCom ledger is found so. Live: the
--      ledger not marked deleted and not a merged twin; the entry not deleted. The names come from tally_lines.ledger (what
--      the "unknown ledger" lines read; an entry's party and a bill's ledger are a line's ledger too), read through the
--      index tally_lines_ledger (book_id, ledger, day) one distinct name at a time (no scan of the book's lines), at most
--      21 missing names kept (one over 20 is enough to know).
--   2. The full list instead: more than 20 names missing, or the same names still missing after 3 rounds by name (a round:
--      10 minutes, the bridge's own gap between two asks of one name), asks the existing "ledgers" wake at most once in 30
--      minutes per book (company), never while the computer's reading is paused or stopped (p_paused: nothing answered,
--      nothing recorded). The state is one row a book in tally_ledger_fetch (add-only table).
--   3. A ledger renamed in Tally: tally_ledger_rename_from_tally(book, guid, from, to) renames FinCom's ledger (found by its
--      Tally GUID under the old name, live; the new name not another ledger's) with the existing tally_ledger_rename
--      (migrations 36 / 41: the lines, bills, entries' party, twins and day cache follow; the trial balance must not change)
--      and keeps the old name as an alias (tally_ledger_aliases: old name -> new name, the same GUID, confirmed); aliases
--      that pointed at the old name follow; the 2.3.1 alias of the new name (new -> old) is ended. All of it or nothing
--      (one subtransaction): when the rename is refused (the trial balance would change, or any error) nothing changes and
--      the case is kept with words in tally_ledger_rename_holds (one open row per book, GUID and new name). This replaces
--      bridge 2.3.2's rule "a ledger change renames nothing" (changed by the owner's decision of 15-Oct-2026).
--
-- Runs AFTER 88 in both orders (staging and a fresh database: ... -> 74 -> ... -> 88 -> 89). Needs 32 (tally_ledgers.
-- deleted_at / tally_guid, tally_vouchers.deleted_at), 36 + 39 + 41 (tally_ledger_rename as it stands) and 59
-- (tally_ledger_aliases); independent of 60-88. ADD-ONLY: two tables added (read by the firm's members, written by these
-- functions only), three functions added; nothing removed, no statement in this file removes rows, no existing function
-- replaced; safe to run twice; one transaction (lock_timeout 10 s). Tested on pg_stand only: tests/run_migration89.py,
-- tests/run_ledger_fetch_server.py (through tally-ingest) and tests/run_migration_order.py. Deploy order: run this file
-- BEFORE deploying the tally-ingest of next-ledger-fetch (without it tally-ingest adds nothing to the beat and keeps 2.3.1's
-- alias for a renamed ledger, as before).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- 1. the state of the automatic fetch, one row a book
create table if not exists public.tally_ledger_fetch (
  book_id uuid primary key references public.tally_books (book_id) on delete restrict,
  firm_id uuid not null,
  company text not null default '',
  missing_n integer not null default 0,        -- the names missing at the last look (21: more than 20)
  names_key text not null default '',          -- md5 of the missing names (the same names: the same key)
  names jsonb not null default '[]'::jsonb,    -- those names, at most 21
  rounds integer not null default 0,           -- rounds by name for these names (one a 10 minutes at most)
  round_at timestamptz,                        -- when the last round began
  full_at timestamptz,                         -- the last time the full ledger list was asked for
  full_n integer not null default 0,
  full_why text,
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.tally_ledger_fetch enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_ledger_fetch' and policyname = 'tally_ledger_fetch_read') then
    create policy tally_ledger_fetch_read on public.tally_ledger_fetch for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
end $$;
revoke all on public.tally_ledger_fetch from public, anon, authenticated;
grant select on public.tally_ledger_fetch to authenticated;
grant all on public.tally_ledger_fetch to service_role;

-- ---------------------------------------------------------------- 2. a rename from Tally that was refused, kept with words
create table if not exists public.tally_ledger_rename_holds (
  id bigserial primary key,
  book_id uuid not null references public.tally_books (book_id) on delete restrict,
  firm_id uuid not null,
  tally_guid text not null,
  from_name text not null,
  to_name text not null,
  words text not null,
  tries integer not null default 1,
  held_at timestamptz not null default now(),
  settled_at timestamptz                       -- a later rename of the same GUID made it
);
create unique index if not exists tally_ledger_rename_holds_open on public.tally_ledger_rename_holds (book_id, tally_guid, to_name) where settled_at is null;
alter table public.tally_ledger_rename_holds enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_ledger_rename_holds' and policyname = 'tally_ledger_rename_holds_read') then
    create policy tally_ledger_rename_holds_read on public.tally_ledger_rename_holds for select to authenticated using (firm_id = (select public.my_firm()));
  end if;
end $$;
revoke all on public.tally_ledger_rename_holds from public, anon, authenticated;
grant select on public.tally_ledger_rename_holds to authenticated;
grant all on public.tally_ledger_rename_holds to service_role;
grant usage, select on sequence public.tally_ledger_rename_holds_id_seq to service_role;

-- ---------------------------------------------------------------- 3. the matching key: the app's unkLoose (ledNm, no capitals, no spaces)
create or replace function public.tally_ledger_loose(p text) returns text language sql immutable set search_path = public, pg_temp as $function$
  select lower(regexp_replace(public.tally_nm(p), '\s+', '', 'g'))
$function$;
grant execute on function public.tally_ledger_loose(text) to authenticated, service_role;

-- ---------------------------------------------------------------- 4. the names to fetch, or the full list
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
  -- the book's distinct line ledgers, one index probe each (tally_lines_ledger: book_id, ledger, day); a book with no ledger
  -- list yet has every name missing: more than 20, the full list
  with recursive used(ledger, i) as (
      (select l.ledger, 1 from tally_lines l where l.book_id = p_book and l.ledger is not null order by l.ledger limit 1)
      union all
      select (select l.ledger from tally_lines l where l.book_id = p_book and l.ledger > u.ledger order by l.ledger limit 1), u.i + 1
        from used u where u.ledger is not null and u.i < 20000),
    live as (select tl.name, public.tally_ledger_loose(tl.name) as lk from tally_ledgers tl where tl.book_id = p_book and tl.deleted_at is null and tl.merged_into is null),
    keys as (select live.lk, count(*) as cnt from live group by live.lk)
  select array_agg(x.ledger order by x.ledger) into v_miss from (
    select u.ledger from used u
     where u.ledger is not null and btrim(u.ledger) <> ''
       and not exists (select 1 from live where live.name = u.ledger or public.tally_nm(live.name) = u.ledger)
       and coalesce((select keys.cnt from keys where keys.lk = public.tally_ledger_loose(u.ledger)), 0) <> 1
       and not exists (select 1 from tally_ledger_aliases a join keys on keys.lk = public.tally_ledger_loose(a.fincom_name) and keys.cnt = 1
                        where a.book_id = p_book and a.tally_name = u.ledger and a.ended_at is null)
       and exists (select 1 from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid and v.deleted_at is null
                    where l.book_id = p_book and l.ledger = u.ledger)
     order by u.ledger limit 21) x;
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

-- ---------------------------------------------------------------- 5. a ledger renamed in Tally: renamed in FinCom, the old name kept
create or replace function public.tally_ledger_rename_from_tally(p_book uuid, p_guid text, p_from text, p_to text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); frm text := left(btrim(coalesce(p_from, '')), 300); dst text := left(btrim(coalesce(p_to, '')), 300);
  res jsonb; msg text; v_words text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return jsonb_build_object('ok', false, 'renamed', false, 'note', 'no such book'); end if;
  if g is null or frm = '' or dst = '' or frm = dst then return jsonb_build_object('ok', true, 'renamed', false, 'note', 'nothing to rename'); end if;
  -- only FinCom's live ledger with this Tally GUID under the old name, and only onto a name no ledger of FinCom's has
  if not exists (select 1 from tally_ledgers where book_id = p_book and tally_guid = g and name = frm and deleted_at is null and merged_into is null) then
    return jsonb_build_object('ok', true, 'renamed', false, 'note', format('no live ledger %s with that Tally GUID', frm));
  end if;
  if exists (select 1 from tally_ledgers where book_id = p_book and name = dst) then
    return jsonb_build_object('ok', true, 'renamed', false, 'refused', true, 'note', format('%s: that name is another ledger''s in FinCom; the name stays', dst));
  end if;
  begin
    res := public.tally_ledger_rename(p_book, g, frm, dst);
    if coalesce((res->>'renamed')::boolean, false) is not true then
      raise exception 'not renamed: %', coalesce(res->>'note', 'no reason given') using errcode = 'P0001';
    end if;
    -- the old name kept: an entry Tally still names so goes to the renamed ledger
    insert into tally_ledger_aliases (book_id, firm_id, tally_name, fincom_name, tally_guid, seen_at, confirmed_at, ended_at)
    values (p_book, f, frm, dst, g, now(), now(), null)
    on conflict (book_id, tally_name) do update set fincom_name = excluded.fincom_name, tally_guid = excluded.tally_guid, seen_at = excluded.seen_at,
      confirmed_at = excluded.confirmed_at, ended_at = null;
    -- names that pointed at the old name follow it; the 2.3.1 alias of the new name (new -> old) has done its work
    update tally_ledger_aliases set fincom_name = dst where book_id = p_book and fincom_name = frm and tally_name <> frm and ended_at is null;
    update tally_ledger_aliases set ended_at = now() where book_id = p_book and tally_name = dst and ended_at is null;
    update tally_ledger_rename_holds set settled_at = now() where book_id = p_book and tally_guid = g and settled_at is null;
  exception when others then
    -- the block is rolled back as one: the ledger, its entries, the day cache and the aliases as they were
    get stacked diagnostics msg = message_text;
    v_words := left(format('%s is named %s in Tally now; FinCom did not rename it (%s); nothing was changed, the name stays until this is looked at', frm, dst, msg), 300);
    insert into tally_ledger_rename_holds as h (book_id, firm_id, tally_guid, from_name, to_name, words)
    values (p_book, f, g, frm, dst, v_words)
    on conflict (book_id, tally_guid, to_name) where settled_at is null do update set from_name = excluded.from_name, words = excluded.words, tries = h.tries + 1, held_at = now();
    return jsonb_build_object('ok', false, 'renamed', false, 'refused', true, 'held', true, 'from', frm, 'to', dst, 'words', v_words);
  end;
  return res || jsonb_build_object('aliasKept', frm);
end $function$;
revoke all on function public.tally_ledger_rename_from_tally(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.tally_ledger_rename_from_tally(uuid, text, text, text) to service_role;

commit;
