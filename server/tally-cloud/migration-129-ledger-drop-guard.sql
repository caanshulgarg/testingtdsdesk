-- Migration 129 (29-Oct-2026, next-fix-ledger-drop): FinCom never quietly marks many ledgers gone. NOT run on staging by
-- this branch; the owner runs it. One transaction, add-only (one table, its index, row security and grants; one function
-- replaced with the same arguments; three new functions), safe to run twice. Needs migrations 34/36 (the ledger-list
-- rounds) and 47 (tally_alerts, the bell's table).
--
-- WHAT HAPPENED (staging, book 3d36a836, IMPETUS INSURANCE BROKERS PRIVATE LIMITED): Ranjeet's bridge read 440 ledgers at
-- 08:30 UTC; Anshul's bridge on the same computer read 404 at 13:42 from the same shared data folder. Migration 36's
-- tally_ledgers_mark_gone held the 36 missing for "a second read", and took as that second read the next complete round:
-- the same bridge 2 minutes later (round 13d701ce...), which marked all 36 deleted. Nobody was told.
--
-- THE RULE NOW (tally_ledgers_mark_gone(p_book, p_round), the function tally-ingest calls on a round's last batch):
--   - a complete round (every batch arrived) missing at most greatest(10, 5% of the live ledgers): marked at once, as before
--     (the floor was 25; 11 to 25 missing are now asked about too)
--   - missing more: NOTHING is marked. The names are held in tally_ledger_drops (one pending hold a book) and ONE alert row
--     goes to the bell (tally_alerts, kind 'summary', data.what 'ledger_drop', as the console's notices are):
--       "<company>: Tally on NWS144 · anshul lists 404 ledgers, 36 fewer than before (A, B, C, …). If they were deleted
--        in Tally, press Confirm; otherwise nothing changes."
--   - the hold is settled by the first of:
--       a second read that counts: from ANOTHER bridge or computer, or from the same one at least 30 minutes after the
--         read that held them, missing at least the same names: those names marked (each mark says "twice"), the alert
--         says so (unread, for the owner to see)
--       a read that sees them all again: the hold cleared, nothing marked, the alert closed
--       a read missing other names: the hold renewed with those names (the same alert row, words and data replaced)
--       the owner's Confirm (tally_ledger_drop_confirm): marked, his name on each mark; the guard of migration 34 still keeps
--         a ledger with entries, an opening or a recent rename; a ledger seen again since the hold is not marked
--       the owner's Keep (tally_ledger_drop_keep): nothing marked; those names missing again are not asked about again
--         until a read sees them (then missing again is a new question)
--     the same bridge asking again within 30 minutes with the same names: nothing marked, nothing new written
--   - incomplete rounds, rounds with a batch missing, rounds that read no ledgers: unchanged (nothing marked, held, logged)
--
-- WHO: tally_ledgers_mark_gone and tally_ledger_drop_words the service role only (tally-ingest); tally_ledger_drop_confirm
-- and tally_ledger_drop_keep signed-in people (authenticated) with an active-owner check inside, and the service role; the
-- holds readable by the firm's members (row security), written only by these functions, never deleted. Every function:
-- security definer, search_path public, pg_temp.

begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.tally_alerts') is null then raise exception 'migration 129 needs tally_alerts (migration 47)'; end if;
  if to_regclass('public.tally_ledger_rounds') is null or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_ledgers' and column_name = 'seen_at')
    then raise exception 'migration 129 needs the ledger-list rounds (migrations 34 and 36)'; end if;
end $$;

-- ---------------------------------------------------------------- the holds
create table if not exists public.tally_ledger_drops (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references public.tally_books (book_id) on delete restrict,
  firm_id        uuid not null,
  state          text not null default 'pending' check (state in ('pending', 'marked', 'confirmed', 'kept', 'cleared', 'superseded')),
  names          text[] not null,                     -- the ledgers missing (live, with a GUID, not seen by the round)
  n_live         integer not null,                    -- live ledgers before (the "before" of "36 fewer than before")
  n_listed       integer,                             -- what the round listed (its rowsRead)
  lim            integer not null,                    -- greatest(10, 5% of n_live)
  round_id       text not null,                       -- the read that held them
  device_id      uuid,
  bridge         text,
  first_at       timestamptz not null,                -- that read's start (the 30 minutes count from here)
  last_round     text,                                -- the latest read that missed the same names
  last_at        timestamptz,
  second_round   text,                                -- the read that confirmed them (state 'marked')
  second_device  uuid,
  second_bridge  text,
  alert_id       bigint,                              -- the one tally_alerts row
  marked         integer,                             -- how many were marked (the guard may keep some)
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid,
  note           text
);
create unique index if not exists tally_ledger_drops_pending on public.tally_ledger_drops (book_id) where state = 'pending';
create index if not exists tally_ledger_drops_book on public.tally_ledger_drops (book_id, created_at desc);
alter table public.tally_ledger_drops enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_ledger_drops' and policyname = 'tally_ledger_drops_read') then
    create policy tally_ledger_drops_read on public.tally_ledger_drops for select to authenticated using (firm_id = my_firm());
  end if;
  -- kept, never deleted (migration 34's tally_control_kept, as tally_ledger_rounds)
  if not exists (select 1 from pg_trigger where tgname = 'tally_ledger_drops_kept' and tgrelid = 'public.tally_ledger_drops'::regclass) then
    create trigger tally_ledger_drops_kept before delete on public.tally_ledger_drops for each row execute function public.tally_control_kept();
  end if;
end $$;
revoke all on public.tally_ledger_drops from public, anon, authenticated;
grant select on public.tally_ledger_drops to authenticated;
grant select, insert, update on public.tally_ledger_drops to service_role;

-- ---------------------------------------------------------------- the words
-- the alert's words for a hold, by its state. "Tally on <computer> · <Windows user>" from tally_devices (info.computer,
-- info.user without its domain), "Tally on a computer" when not known; three names (alphabetical) and "…"
create or replace function public.tally_ledger_drop_words(p_drop uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare d tally_ledger_drops%rowtype; co text; who text; who2 text; n int; sample text;
begin
  select * into d from tally_ledger_drops where id = p_drop;
  if d.id is null then return null; end if;
  select nullif(btrim(company), '') into co from tally_books where book_id = d.book_id;
  co := coalesce(co, 'A company');
  select 'Tally on ' || coalesce(nullif(btrim(t.info->>'computer'), ''), nullif(btrim(split_part(t.name, ' · ', 1)), ''), 'a computer')
         || coalesce(' · ' || nullif(btrim(regexp_replace(coalesce(t.info->>'user', ''), '^.*\\', '')), ''), '')
    into who from tally_devices t where t.id = d.device_id;
  who := coalesce(who, 'Tally on a computer');
  select 'Tally on ' || coalesce(nullif(btrim(t.info->>'computer'), ''), nullif(btrim(split_part(t.name, ' · ', 1)), ''), 'a computer')
         || coalesce(' · ' || nullif(btrim(regexp_replace(coalesce(t.info->>'user', ''), '^.*\\', '')), ''), '')
    into who2 from tally_devices t where t.id = d.second_device;
  who2 := coalesce(who2, 'Tally on a computer');
  n := coalesce(cardinality(d.names), 0);
  select string_agg(x, ', ' order by lower(x), x) into sample from (select x from unnest(d.names) x order by lower(x), x limit 3) s;
  sample := coalesce(sample, '') || case when n > 3 then ', …' else '' end;
  return case d.state
    when 'pending' then format('%s: %s lists %s ledgers, %s fewer than before (%s). If they were deleted in Tally, press Confirm; otherwise nothing changes.',
                               co, who, coalesce(d.n_listed::text, '?'), n, sample)
    when 'marked' then format('%s: %s ledgers marked deleted (%s): %s listed %s fewer, and %s, read again, missed the same ones.',
                              co, coalesce(d.marked, n), sample, who, n, case when who2 = who then 'the same bridge' else who2 end)
    when 'confirmed' then format('%s: %s ledgers marked deleted, as you confirmed (%s).', co, coalesce(d.marked, n), sample)
    when 'kept' then format('%s: %s ledgers kept, as you chose (%s); nothing changed.', co, n, sample)
    when 'cleared' then format('%s: the %s ledgers %s did not list were listed again (%s); nothing changed.', co, n, who, sample)
    else format('%s: %s ledgers were missing in one read (%s); a later read listed others missing, asked again.', co, n, sample) end;
end $function$;

-- ---------------------------------------------------------------- the rule
-- migration 36's function (the same arguments, what tally-ingest calls on the last batch of a round), with the rule above
-- in place of "the previous complete round missed them too". Everything before the bulk decision is 36's text
create or replace function public.tally_ledgers_mark_gone(p_book uuid, p_round text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; rid text := left(btrim(coalesce(p_round, '')), 80); r tally_ledger_rounds%rowtype; unseen text[]; n_gone int; live int; lim int; outcome text;
  to_mark text[] := '{}'; to_hold text[] := '{}'; n_marked int := 0; n_held int := 0; lst jsonb; done boolean := false; n_logged int := 0;
  miss text[] := '{}'; kept text[] := '{}'; rest text[] := '{}'; twice text[] := '{}'; pend tally_ledger_drops%rowtype; nd uuid; alert bigint;
  second boolean; n_wait int := 0; n_twice int := 0; cid text; dat jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id, client_id into f, cid from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select * into r from tally_ledger_rounds where book_id = p_book and round_id = rid;
  select coalesce(array_agg(name order by name), '{}') into unseen from tally_ledgers
   where book_id = p_book and deleted_at is null and merged_into is null and tally_guid is not null and seen_round is distinct from rid;
  n_gone := coalesce(array_length(unseen, 1), 0);
  select count(*) into live from tally_ledgers where book_id = p_book and deleted_at is null and merged_into is null;
  lst := jsonb_strip_nulls(jsonb_build_object('source', 'bridge ledger_list', 'round', rid, 'at', now(), 'device', r.device_id, 'bridge', r.bridge));
  if r.book_id is null then
    outcome := 'no such round: nothing marked';
    return jsonb_build_object('ok', true, 'marked', 0, 'held', 0, 'gone', n_gone, 'note', outcome);
  end if;
  done := r.complete is true and coalesce(r.rows_read, 0) > 0 and r.seen_n = r.rows_read;
  if not done and n_gone = 0 then
    outcome := 'nothing to mark: the round saw every live ledger with a GUID';
  elsif r.complete is distinct from true then
    outcome := format('round not complete: nothing marked (%s not seen, held)', n_gone); to_hold := unseen;
  elsif coalesce(r.rows_read, 0) <= 0 then
    outcome := format('the bridge read no ledgers (rowsRead 0): nothing marked (%s not seen, held)', n_gone); to_hold := unseen;
  elsif not done then
    outcome := format('%s of %s GUIDs seen (a batch missing): nothing marked (%s not seen, held)', r.seen_n, r.rows_read, n_gone); to_hold := unseen;
  else
    -- migration 129: a complete read. The bulk limit greatest(10, 5% of the live ledgers)
    lim := greatest(10, live / 20);
    -- the names the owner chose to keep (a 'kept' hold), not seen by any read since he chose: never marked or asked again
    select coalesce(array_agg(distinct x.n), '{}') into kept
      from tally_ledger_drops d cross join lateral unnest(d.names) as x(n)
      join tally_ledgers l on l.book_id = p_book and l.name = x.n
     where d.book_id = p_book and d.state = 'kept' and x.n = any(unseen) and (l.seen_at is null or l.seen_at <= d.decided_at);
    select coalesce(array_agg(n order by n), '{}') into miss from unnest(unseen) n where not (n = any(kept));
    rest := miss;
    select * into pend from tally_ledger_drops where book_id = p_book and state = 'pending' order by created_at desc limit 1 for update;
    if pend.id is not null then
      alert := pend.alert_id;
      -- a second read counts when it comes from another bridge or computer, or from the same one 30 minutes later
      second := (r.device_id is not null and pend.device_id is not null and r.device_id <> pend.device_id)
             or (nullif(r.bridge, '') is not null and nullif(pend.bridge, '') is not null and r.bridge <> pend.bridge)
             or (r.started_at >= pend.first_at + interval '30 minutes');
      if pend.names <@ miss and second then
        -- missing twice, the second read independent of the first: marked below (each mark says so)
        twice := pend.names; alert := null;      -- its alert row says what was marked; others missing get a row of their own
        rest := array(select n from unnest(miss) n where not (n = any(pend.names)) order by n);
        update tally_ledger_drops set state = 'marked', second_round = rid, second_device = r.device_id, second_bridge = r.bridge, last_round = rid, last_at = now(), decided_at = now()
         where id = pend.id;
      elsif not (pend.names && miss) then
        -- listed again: the hold cleared, nothing marked, the alert closed
        update tally_ledger_drops set state = 'cleared', last_round = rid, last_at = now(), decided_at = now(), note = 'listed again by round ' || rid where id = pend.id;
        update tally_alerts set words = coalesce(public.tally_ledger_drop_words(pend.id), words), data = data || jsonb_build_object('state', 'cleared', 'by_round', rid), read_at = coalesce(read_at, now())
         where id = alert;
        outcome := format('the %s ledgers held since round %s listed again: nothing marked, the alert closed', cardinality(pend.names), pend.round_id);
        alert := null;
      elsif pend.names <@ miss and miss <@ pend.names then
        -- the same names, not yet a second read that counts: still nothing marked, nothing new written
        update tally_ledger_drops set last_round = rid, last_at = now() where id = pend.id;
        rest := '{}'; n_wait := cardinality(pend.names);
        outcome := format('%s not seen again, more than %s at once: still nothing marked; the owner is asked (alert %s), or a second read from another bridge or computer, or from this one after %s IST, decides',
                          n_wait, lim, coalesce(alert::text, '-'), to_char((pend.first_at + interval '30 minutes') at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI'));
      else
        -- other names missing: asked again with those (the same alert row)
        update tally_ledger_drops set state = 'superseded', last_round = rid, last_at = now(), decided_at = now(), note = 'other names missing in round ' || rid where id = pend.id;
        outcome := format('round %s held %s; this round misses %s, not the same names: asked again', pend.round_id, cardinality(pend.names), cardinality(miss));
      end if;
    end if;
    if cardinality(rest) > lim then
      -- too many at once: nothing marked; held, and the owner asked in ONE alert row
      insert into tally_ledger_drops (book_id, firm_id, names, n_live, n_listed, lim, round_id, device_id, bridge, first_at, last_round, last_at, alert_id)
      values (p_book, f, rest, live, r.rows_read, lim, rid, r.device_id, r.bridge, r.started_at, rid, now(), alert)
      returning id into nd;
      dat := jsonb_strip_nulls(jsonb_build_object('what', 'ledger_drop', 'drop', nd, 'state', 'pending', 'names', to_jsonb(rest[1:500]), 'count', cardinality(rest),
               'listed', r.rows_read, 'live', live, 'round', rid, 'device', r.device_id, 'bridge', r.bridge));
      if alert is not null and exists (select 1 from tally_alerts where id = alert) then
        update tally_alerts set words = public.tally_ledger_drop_words(nd), data = dat, at = now(), read_at = null, read_by = null where id = alert;
      else
        insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
        values (f, nullif(cid, ''), p_book, nd, 'summary', (now() at time zone 'Asia/Kolkata')::date, public.tally_ledger_drop_words(nd), dat)
        returning id into alert;
        update tally_ledger_drops set alert_id = alert where id = nd;
      end if;
      to_hold := rest;
      outcome := coalesce(outcome || '; ', '') || format('%s not seen, more than %s at once: nothing marked; the owner is asked (alert %s), or a second read from another bridge or computer, or from this one after %s IST, decides',
                 cardinality(rest), lim, alert, to_char((r.started_at + interval '30 minutes') at time zone 'Asia/Kolkata', 'DD-Mon HH24:MI'));
    elsif cardinality(rest) > 0 then
      to_mark := rest;           -- a few: marked at once, as before
    end if;
    if nd is null and pend.id is not null and pend.alert_id is not null and exists (select 1 from tally_ledger_drops where id = pend.id and state = 'superseded') then
      -- renewed with nothing left to ask (few or none missing now): the alert closed
      update tally_alerts set words = coalesce(public.tally_ledger_drop_words(pend.id), words), data = data || jsonb_build_object('state', 'superseded'), read_at = coalesce(read_at, now()) where id = pend.alert_id;
    end if;
    if cardinality(kept) > 0 then outcome := coalesce(outcome || '; ', '') || format('%s kept by the owner, not marked', cardinality(kept)); end if;
    if outcome is null and n_gone = 0 then outcome := 'nothing to mark: the round saw every live ledger with a GUID'; end if;
  end if;
  if cardinality(twice) > 0 then
    perform set_config('fincom.ledger_list', jsonb_build_object('reason', format('not seen in Tally''s ledger list twice (FinCom Bridge, rounds %s and %s)', pend.round_id, rid), 'list', lst || jsonb_build_object('first_round', pend.round_id, 'drop', pend.id))::text, true);
    update tally_ledgers set deleted_at = now() where book_id = p_book and name = any(twice) and deleted_at is null;
    perform set_config('fincom.ledger_list', '', true);
    select count(*) into n_twice from tally_ledgers where book_id = p_book and name = any(twice) and deleted_at is not null and deleted_by_list->>'round' = rid;
    update tally_ledger_drops set marked = n_twice where id = pend.id;
    update tally_alerts set words = coalesce(public.tally_ledger_drop_words(pend.id), words), data = data || jsonb_build_object('state', 'marked', 'marked', n_twice, 'by_round', rid),
           at = now(), read_at = null, read_by = null where id = pend.alert_id;
    outcome := format('%s not seen twice (rounds %s and %s): %s marked', cardinality(twice), pend.round_id, rid, n_twice)
            || case when n_twice < cardinality(twice) then format('; %s kept by the guard (entries, an opening or a recent rename)', cardinality(twice) - n_twice) else '' end
            || coalesce('; ' || outcome, '');
  end if;
  if array_length(to_mark, 1) > 0 then
    perform set_config('fincom.ledger_list', jsonb_build_object('reason', 'not seen in Tally''s ledger list (FinCom Bridge, round ' || rid || ')', 'list', lst)::text, true);
    update tally_ledgers set deleted_at = now() where book_id = p_book and name = any(to_mark) and deleted_at is null;
    perform set_config('fincom.ledger_list', '', true);
    -- the guard may have kept some (logged 'held' by it)
    select count(*) into n_marked from tally_ledgers where book_id = p_book and name = any(to_mark) and deleted_at is not null;
    n_held := array_length(to_mark, 1) - n_marked;
    if n_held > 0 then outcome := coalesce(outcome || '; ', '') || format('%s kept by the guard (entries, an opening or a recent rename)', n_held); end if;
  end if;
  -- the held ones logged once per round and ledger (a round asked again writes nothing more; a hold asked again by the
  -- same bridge logs nothing at all)
  insert into tally_ledger_marks (book_id, firm_id, ledger, action, reason, source, device_id, bridge, list, parent, open_sent)
  select p_book, f, l.name, 'held', coalesce(outcome, 'held'), 'bridge ledger_list', r.device_id, r.bridge, lst, l.parent, coalesce(l.open_sent, l.open)
    from tally_ledgers l where l.book_id = p_book and l.name = any(to_hold)
     and not exists (select 1 from tally_ledger_marks m where m.book_id = p_book and m.ledger = l.name and m.action = 'held' and m.list->>'round' = rid);
  get diagnostics n_logged = row_count;
  n_held := n_held + coalesce(array_length(to_hold, 1), 0) + n_wait + (cardinality(twice) - n_twice);
  update tally_ledger_rounds set note = left(outcome, 300), last_seen_at = now() where book_id = p_book and round_id = rid;
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'marked', n_marked + n_twice, 'held', n_held, 'gone', n_gone, 'logged', n_logged, 'note', outcome,
                                              'pending', coalesce(nd, case when n_wait > 0 then pend.id end), 'alert', alert));
end $function$;

-- ---------------------------------------------------------------- the owner's answer
-- Confirm: the held names marked deleted (his name on each mark), except a ledger listed again since the hold; the guard
-- keeps a ledger with entries, an opening or a recent rename. Keep: nothing marked. Either closes the alert as read by him
create or replace function public.tally_ledger_drop_confirm(p_drop uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); uid uuid := auth.uid(); b uuid; d tally_ledger_drops%rowtype; seen text[]; n_try int := 0; n_marked int := 0; lst jsonb;
begin
  if f is null or not exists (select 1 from members m where m.user_id = uid and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can confirm ledgers deleted in Tally' using errcode = '42501'; end if;
  select book_id into b from tally_ledger_drops where id = p_drop and firm_id = f;
  if b is null then raise exception 'no such question about ledgers in your firm' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext(b::text));
  select * into d from tally_ledger_drops where id = p_drop for update;
  if d.state <> 'pending' then return jsonb_build_object('ok', true, 'already', d.state, 'marked', 0); end if;
  select coalesce(array_agg(name), '{}') into seen from tally_ledgers where book_id = d.book_id and name = any(d.names) and seen_at > d.created_at;
  lst := jsonb_build_object('source', 'owner confirmed (FinCom)', 'by', uid, 'drop', d.id, 'round', d.round_id, 'at', now());
  perform set_config('fincom.ledger_list', jsonb_build_object('reason', 'deleted in Tally: confirmed by the owner (not listed by Tally''s ledger list, round ' || d.round_id || ')', 'list', lst)::text, true);
  update tally_ledgers set deleted_at = now() where book_id = d.book_id and name = any(d.names) and not (name = any(seen)) and deleted_at is null and merged_into is null;
  get diagnostics n_try = row_count;
  perform set_config('fincom.ledger_list', '', true);
  select count(*) into n_marked from tally_ledgers where book_id = d.book_id and name = any(d.names) and deleted_at is not null and deleted_by_list->>'drop' = d.id::text;
  update tally_ledger_drops set state = 'confirmed', marked = n_marked, decided_at = now(), decided_by = uid where id = d.id;
  update tally_alerts set words = coalesce(public.tally_ledger_drop_words(d.id), words), data = data || jsonb_build_object('state', 'confirmed', 'marked', n_marked),
         read_at = now(), read_by = uid where id = d.alert_id;
  return jsonb_build_object('ok', true, 'drop', d.id, 'marked', n_marked, 'kept', n_try - n_marked, 'seenAgain', cardinality(seen));
end $function$;

create or replace function public.tally_ledger_drop_keep(p_drop uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); uid uuid := auth.uid(); b uuid; d tally_ledger_drops%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = uid and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can keep these ledgers' using errcode = '42501'; end if;
  select book_id into b from tally_ledger_drops where id = p_drop and firm_id = f;
  if b is null then raise exception 'no such question about ledgers in your firm' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext(b::text));
  select * into d from tally_ledger_drops where id = p_drop for update;
  if d.state <> 'pending' then return jsonb_build_object('ok', true, 'already', d.state); end if;
  update tally_ledger_drops set state = 'kept', decided_at = now(), decided_by = uid where id = d.id;
  update tally_alerts set words = coalesce(public.tally_ledger_drop_words(d.id), words), data = data || jsonb_build_object('state', 'kept'),
         read_at = now(), read_by = uid where id = d.alert_id;
  return jsonb_build_object('ok', true, 'drop', d.id, 'kept', cardinality(d.names));
end $function$;

-- ---------------------------------------------------------------- who may call
revoke all on function public.tally_ledgers_mark_gone(uuid, text), public.tally_ledger_drop_words(uuid) from public, anon, authenticated;
grant execute on function public.tally_ledgers_mark_gone(uuid, text), public.tally_ledger_drop_words(uuid) to service_role;
revoke all on function public.tally_ledger_drop_confirm(uuid), public.tally_ledger_drop_keep(uuid) from public, anon;
grant execute on function public.tally_ledger_drop_confirm(uuid), public.tally_ledger_drop_keep(uuid) to authenticated, service_role;

commit;
