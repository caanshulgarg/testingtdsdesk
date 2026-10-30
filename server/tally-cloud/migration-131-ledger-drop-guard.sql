-- Migration 131 (30-Oct-2026, next-fix-ledger-drop): FinCom never quietly marks many ledgers gone. NOT run on staging by
-- this branch; the owner runs it. One transaction, add-only (one table, its indexes, row security and grants; two functions
-- replaced with the same arguments; four new functions), safe to run twice. Needs migrations 34/36 (the ledger-list
-- rounds) and 47 (tally_alerts, the bell's table). (129 is server/console fs-aimap; 130 a branch in progress.)
--
-- WHAT HAPPENED (staging, 29-Oct-2026, book 3d36a836, IMPETUS INSURANCE BROKERS PRIVATE LIMITED): one bridge read 440
-- ledgers at 08:30 UTC; another bridge on the same computer read 404 at 13:42. Migration 36's tally_ledgers_mark_gone held
-- the 36 missing for "a second read", and took as that second read the same bridge 2 minutes later (round 13d701ce...),
-- which marked all 36 deleted. Nobody was told. (The owner has since said the 36 were really deleted in Tally: they stay
-- marked; nothing here changes them.)
--
-- THE RULE NOW, one decision (tally_ledger_drop_decide) for both ways ledgers are marked gone: a bridge round
-- (tally_ledgers_mark_gone(p_book, p_round), what tally-ingest calls on a round's last batch) and a full list declared
-- complete (tally_ingest_ledgers_list, 7 arguments: an uploaded Master.xml, tally-ingest upload_ledgers):
--   - a complete round (every batch arrived) or a declared list missing at most greatest(10, 5% of the live ledgers): marked
--     at once, as before (the floor was 25; 11 to 25 missing are now asked about too)
--   - missing more: NOTHING is marked, by this read or any later one. The names are held "to confirm" in tally_ledger_drops
--     (one pending hold a book) and ONE alert row goes to the bell (tally_alerts, kind 'summary', data.what 'ledger_drop',
--     data.names the list), in plain words and no computer's name:
--       "<company>: Tally lists 404 ledgers, 36 fewer than before (A, B, C, …). If they were deleted in Tally, press
--        Confirm; otherwise nothing changes."
--   - the hold is settled by the first of:
--       Confirm (tally_ledger_drop_confirm, the firm's owner or staff): marked, the person on each mark; the guard of
--         migration 34 still keeps a ledger with entries, an opening or a recent rename; one seen again since is not marked
--       Keep (tally_ledger_drop_keep, the firm's owner or staff): nothing marked; those names missing again are not asked
--         about again until a read sees them (then missing again is a new question)
--       a read that lists them all again: the hold cleared, nothing marked, the alert closed
--       a read missing other names: the hold renewed with those names (the same alert row, words and data replaced)
--     a later read missing the same names (any bridge, any time): nothing marked, nothing new written; still asked
--   - incomplete rounds, rounds with a batch missing, rounds that read no ledgers: unchanged (nothing marked, held, logged)
--
-- WHO: tally_ledgers_mark_gone, tally_ingest_ledgers_list, tally_ledger_drop_decide and tally_ledger_drop_words: the
-- service role only (tally-ingest). tally_ledger_drop_confirm and tally_ledger_drop_keep: signed-in people (authenticated)
-- with an active owner-or-staff check inside (as Post to Tally's settle), and the service role. The holds readable by the
-- firm's members (row security), written only by these functions, never deleted. Every function: security definer,
-- search_path public, pg_temp.

begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.tally_alerts') is null then raise exception 'migration 131 needs tally_alerts (migration 47)'; end if;
  if to_regclass('public.tally_ledger_rounds') is null or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_ledgers' and column_name = 'seen_at')
    then raise exception 'migration 131 needs the ledger-list rounds (migrations 34 and 36)'; end if;
end $$;

-- ---------------------------------------------------------------- the holds
create table if not exists public.tally_ledger_drops (
  id             uuid primary key default gen_random_uuid(),
  book_id        uuid not null references public.tally_books (book_id) on delete restrict,
  firm_id        uuid not null,
  state          text not null default 'pending' check (state in ('pending', 'confirmed', 'kept', 'cleared', 'superseded')),
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
-- the alert's words for a hold, by its state: the company, how many, three names (alphabetical) and "…"; no computer's
-- name, no Windows login
create or replace function public.tally_ledger_drop_words(p_drop uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare d tally_ledger_drops%rowtype; co text; n int; sample text;
begin
  select * into d from tally_ledger_drops where id = p_drop;
  if d.id is null then return null; end if;
  select nullif(btrim(company), '') into co from tally_books where book_id = d.book_id;
  co := coalesce(co, 'A company');
  n := coalesce(cardinality(d.names), 0);
  select string_agg(x, ', ' order by lower(x), x) into sample from (select x from unnest(d.names) x order by lower(x), x limit 3) s;
  sample := coalesce(sample, '') || case when n > 3 then ', …' else '' end;
  return case d.state
    when 'pending' then format('%s: Tally lists %s ledgers, %s fewer than before (%s). If they were deleted in Tally, press Confirm; otherwise nothing changes.',
                               co, coalesce(d.n_listed::text, '?'), n, sample)
    when 'confirmed' then format('%s: %s ledgers marked deleted, as confirmed (%s).', co, coalesce(d.marked, n), sample)
    when 'kept' then format('%s: %s ledgers kept (%s); nothing changed.', co, n, sample)
    when 'cleared' then format('%s: the %s ledgers missing from Tally''s list were listed again (%s); nothing changed.', co, n, sample)
    else format('%s: %s ledgers were missing from one read of Tally (%s); a later read missed others, asked again.', co, n, sample) end;
end $function$;

-- ---------------------------------------------------------------- the decision (one place for a bridge round and a list)
-- p_unseen: the live ledgers this read did not list. Returns {mark: the few marked at once, hold: the names held to
-- confirm, wait, pending, alert, note}; writes the hold and its one alert row. The caller holds the book's lock, marks
-- what "mark" says and logs what "hold" says. p_round names the read ("r-…" a bridge round, "list …" an uploaded list)
create or replace function public.tally_ledger_drop_decide(p_book uuid, p_unseen text[], p_live integer, p_listed integer, p_round text, p_device uuid, p_bridge text, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; cid text; rid text := left(btrim(coalesce(p_round, '')), 80); lim int; outcome text; mark text[] := '{}'; hold text[] := '{}';
  miss text[] := '{}'; kept text[] := '{}'; rest text[] := '{}'; pend tally_ledger_drops%rowtype; nd uuid; alert bigint;
  n_wait int := 0; dat jsonb; ask_all boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id, client_id into f, cid from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  lim := greatest(10, coalesce(p_live, 0) / 20);
  -- the names kept (a 'kept' hold), not seen by any read since: never marked or asked again
  select coalesce(array_agg(distinct x.n), '{}') into kept
    from tally_ledger_drops d cross join lateral unnest(d.names) as x(n)
    join tally_ledgers l on l.book_id = p_book and l.name = x.n
   where d.book_id = p_book and d.state = 'kept' and x.n = any(p_unseen) and (l.seen_at is null or l.seen_at <= d.decided_at);
  select coalesce(array_agg(n order by n), '{}') into miss from unnest(p_unseen) n where not (n = any(kept));
  rest := miss;
  select * into pend from tally_ledger_drops where book_id = p_book and state = 'pending' order by created_at desc limit 1 for update;
  if pend.id is not null then
    alert := pend.alert_id;
    if not (pend.names && miss) then
      -- listed again: the hold cleared, nothing marked, the alert closed
      update tally_ledger_drops set state = 'cleared', last_round = rid, last_at = now(), decided_at = now(), note = 'listed again by ' || rid where id = pend.id;
      update tally_alerts set words = coalesce(public.tally_ledger_drop_words(pend.id), words), data = data || jsonb_build_object('state', 'cleared', 'by_round', rid), read_at = coalesce(read_at, now())
       where id = alert;
      outcome := format('the %s ledgers held since %s listed again: nothing marked, the alert closed', cardinality(pend.names), pend.round_id);
      alert := null;
    elsif pend.names <@ miss and miss <@ pend.names then
      -- the same names missing again (any bridge, any time): still nothing marked, nothing new written; only Confirm marks
      update tally_ledger_drops set last_round = rid, last_at = now() where id = pend.id;
      rest := '{}'; n_wait := cardinality(pend.names);
      outcome := format('%s not seen again, more than %s at once: still nothing marked; asked to confirm (alert %s)', n_wait, lim, coalesce(alert::text, '-'));
    else
      -- other names missing: asked again with those (the same alert row). Only some of the held names missing now (the
      -- rest listed again): still asked, however few, as they came from a read that missed too many
      ask_all := miss <@ pend.names;
      update tally_ledger_drops set state = 'superseded', last_round = rid, last_at = now(), decided_at = now(), note = 'other names missing in ' || rid where id = pend.id;
      outcome := format('%s held %s; this read misses %s, not the same names: asked again', pend.round_id, cardinality(pend.names), cardinality(miss));
    end if;
  end if;
  if cardinality(rest) > lim or (ask_all and cardinality(rest) > 0) then
    -- too many at once: nothing marked; held to confirm, asked in ONE alert row
    insert into tally_ledger_drops (book_id, firm_id, names, n_live, n_listed, lim, round_id, device_id, bridge, first_at, last_round, last_at, alert_id)
    values (p_book, f, rest, p_live, p_listed, lim, rid, p_device, p_bridge, coalesce(p_at, now()), rid, now(), alert)
    returning id into nd;
    dat := jsonb_strip_nulls(jsonb_build_object('what', 'ledger_drop', 'drop', nd, 'state', 'pending', 'names', to_jsonb(rest[1:500]), 'count', cardinality(rest),
             'listed', p_listed, 'live', p_live, 'round', rid, 'device', p_device, 'bridge', p_bridge));
    if alert is not null and exists (select 1 from tally_alerts where id = alert) then
      update tally_alerts set words = public.tally_ledger_drop_words(nd), data = dat, at = now(), read_at = null, read_by = null where id = alert;
    else
      insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
      values (f, nullif(cid, ''), p_book, nd, 'summary', (now() at time zone 'Asia/Kolkata')::date, public.tally_ledger_drop_words(nd), dat)
      returning id into alert;
      update tally_ledger_drops set alert_id = alert where id = nd;
    end if;
    hold := rest;
    outcome := coalesce(outcome || '; ', '') || format('%s not seen, %s: nothing marked; asked to confirm (alert %s)', cardinality(rest),
               case when cardinality(rest) > lim then 'more than ' || lim || ' at once' else 'left of an earlier read that missed more' end, alert);
  elsif cardinality(rest) > 0 then
    mark := rest;           -- a few: marked at once, as before
  end if;
  if nd is null and pend.id is not null and pend.alert_id is not null and exists (select 1 from tally_ledger_drops where id = pend.id and state = 'superseded') then
    -- renewed with nothing left to ask (few or none missing now): the alert closed
    update tally_alerts set words = coalesce(public.tally_ledger_drop_words(pend.id), words), data = data || jsonb_build_object('state', 'superseded'), read_at = coalesce(read_at, now()) where id = pend.alert_id;
  end if;
  if cardinality(kept) > 0 then outcome := coalesce(outcome || '; ', '') || format('%s kept (Keep), not marked', cardinality(kept)); end if;
  return jsonb_strip_nulls(jsonb_build_object('mark', to_jsonb(mark), 'hold', to_jsonb(hold), 'wait', n_wait, 'lim', lim, 'note', outcome,
                                              'pending', coalesce(nd, case when n_wait > 0 then pend.id end), 'alert', alert));
end $function$;

-- ---------------------------------------------------------------- the rule
-- migration 36's function (the same arguments, what tally-ingest calls on the last batch of a round), with the rule above
-- in place of "the previous complete round missed them too". Everything before the bulk decision is 36's text
create or replace function public.tally_ledgers_mark_gone(p_book uuid, p_round text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; rid text := left(btrim(coalesce(p_round, '')), 80); r tally_ledger_rounds%rowtype; unseen text[]; n_gone int; live int; outcome text;
  to_mark text[] := '{}'; to_hold text[] := '{}'; n_marked int := 0; n_held int := 0; lst jsonb; done boolean := false; n_logged int := 0;
  n_wait int := 0; cid text; dec jsonb := '{}';
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
    -- migration 131: a complete read. Few missing: marked at once; many: held to confirm (tally_ledger_drop_decide)
    dec := public.tally_ledger_drop_decide(p_book, unseen, live, r.rows_read, rid, r.device_id, r.bridge, r.started_at);
    select coalesce(array_agg(x), '{}') into to_mark from jsonb_array_elements_text(dec->'mark') x;
    select coalesce(array_agg(x), '{}') into to_hold from jsonb_array_elements_text(dec->'hold') x;
    n_wait := coalesce((dec->>'wait')::int, 0); outcome := dec->>'note';
    if outcome is null and n_gone = 0 then outcome := 'nothing to mark: the round saw every live ledger with a GUID'; end if;
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
  n_held := n_held + coalesce(array_length(to_hold, 1), 0) + n_wait;
  update tally_ledger_rounds set note = left(outcome, 300), last_seen_at = now() where book_id = p_book and round_id = rid;
  return jsonb_strip_nulls(jsonb_build_object('ok', true, 'marked', n_marked, 'held', n_held, 'gone', n_gone, 'logged', n_logged, 'note', outcome,
                                              'pending', dec->'pending', 'alert', dec->'alert'));
end $function$;

-- ---------------------------------------------------------------- the same for a full list (an uploaded Master.xml)
-- migration 34's function (the same arguments; the older signatures delegate here), with the decision above in place of
-- "the last full list held them too". Everything else is 34's text
create or replace function public.tally_ingest_ledgers_list(p_book uuid, p_from date, p_open_as_on date, p_ledgers jsonb, p_list jsonb, p_complete boolean, p_count integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; fd date; lid uuid := gen_random_uuid(); lst jsonb; src text; usr uuid; dev uuid; brg text;
  names text[]; listed int; live_before int; gone text[]; pend text[]; to_mark text[]; to_hold text[]; lim int;
  n_marked int := 0; n_unmarked int := 0; note text; declared boolean; dec jsonb := '{}';
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id, from_date into f, fd from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  -- a list never removes entries: one starting after entries already kept is refused, nothing changed
  if fd is not null and p_from > fd and exists (select 1 from tally_vouchers where book_id = p_book and day < p_from) then
    raise exception 'This ledger list starts on % but the copy has entries before it; nothing was changed.', p_from using errcode = '22023';
  end if;
  src := left(coalesce(nullif(btrim(p_list->>'source'), ''), 'unknown'), 60);
  usr := case when p_list->>'by' ~* '^[0-9a-f-]{36}$' then (p_list->>'by')::uuid end;
  dev := case when p_list->>'device' ~* '^[0-9a-f-]{36}$' then (p_list->>'device')::uuid end;
  brg := left(nullif(p_list->>'bridge', ''), 40);
  lst := jsonb_strip_nulls(jsonb_build_object('list_id', lid, 'source', src, 'at', now(), 'by', usr, 'device', dev, 'bridge', brg,
           'computer', left(p_list->>'computer', 60), 'user', left(p_list->>'user', 60), 'file', left(p_list->>'file', 200),
           'complete', coalesce(p_complete, false), 'count', p_count));
  select count(*) into live_before from tally_ledgers where book_id = p_book and deleted_at is null;
  update tally_books set from_date = p_from, open_as_on = p_open_as_on, ledgers_at = now() where book_id = p_book;

  -- the ledgers listed: added, or brought up to date as a fresh row would be (the year's openings work out the rest);
  -- one marked before is un-marked (the trigger logs it)
  perform set_config('fincom.ledger_list', jsonb_build_object('unreason', 'listed again in a full list', 'list', lst)::text, true);
  insert into tally_ledgers as t (book_id, firm_id, name, parent, open, chain, primary_group, open_sent, merged_into, deleted_at)
  select p_book, f, nm,
         coalesce((array_agg(par order by (raw = nm) desc, raw) filter (where par <> ''))[1], ''),
         sum(op), '{}'::text[], '', null, null, null
    from (select distinct on (x->>0) x->>0 as raw, tally_nm(x->>0) as nm, tally_nm(x->>1) as par, coalesce(nullif(x->>2, '')::numeric, 0) as op
            from jsonb_array_elements(coalesce(p_ledgers, '[]'::jsonb)) x order by x->>0) s
   where nm <> ''
   group by nm
  on conflict (book_id, name) do update set parent = excluded.parent, open = excluded.open, chain = '{}'::text[], primary_group = '',
     open_sent = null, merged_into = null, deleted_at = null;
  select coalesce(array_agg(distinct tally_nm(x->>0)) filter (where tally_nm(x->>0) <> ''), '{}') into names from jsonb_array_elements(coalesce(p_ledgers, '[]'::jsonb)) x;
  listed := coalesce(array_length(names, 1), 0);
  select count(*) into n_unmarked from tally_ledger_marks where list_id = lid and action = 'unmarked';

  -- the live ledgers missing from the list (not FinCom's own Profit & Loss A/c, made by the year's openings)
  select coalesce(array_agg(name order by name), '{}') into gone from tally_ledgers
   where book_id = p_book and deleted_at is null and name <> all(names) and name <> 'Profit & Loss A/c';
  lim := greatest(25, live_before / 20);
  -- migration-34: a list marks nothing unless its sender declares it complete with a count equal to the names listed
  declared := coalesce(p_complete, false) and p_count is not null and p_count = listed;
  if listed = 0 then
    to_mark := '{}'; to_hold := gone; note := 'an empty list: nothing marked';
  elsif not declared then
    to_mark := '{}'; to_hold := gone;
    note := case when not coalesce(p_complete, false) then 'list not declared complete: nothing marked'
                 else format('list declared complete with %s ledgers but %s names listed (count mismatch): nothing marked', p_count, listed) end;
  else
    -- migration 131: a few missing marked at once; many held to confirm (one alert), never marked by a later list
    dec := public.tally_ledger_drop_decide(p_book, gone, live_before, listed, 'list ' || lid, dev, brg, now());
    to_mark := array(select jsonb_array_elements_text(coalesce(dec->'mark', '[]'::jsonb)));
    to_hold := array(select jsonb_array_elements_text(coalesce(dec->'hold', '[]'::jsonb)));
    lim := coalesce((dec->>'lim')::int, lim); note := dec->>'note';
  end if;

  if array_length(to_mark, 1) > 0 then
    perform set_config('fincom.ledger_list', jsonb_build_object('reason', 'missing from full list', 'list', lst)::text, true);
    update tally_ledgers set deleted_at = now() where book_id = p_book and name = any(to_mark) and deleted_at is null;
    -- the guard (migration-34) keeps a row with entries or an opening, logged 'held' by it
    select count(*) into n_marked from tally_ledgers where book_id = p_book and name = any(to_mark) and deleted_at is not null;
    if n_marked < array_length(to_mark, 1) then note := coalesce(note || '; ', '') || format('%s kept by the guard (entries or an opening)', array_length(to_mark, 1) - n_marked); end if;
  end if;
  insert into tally_ledger_marks (book_id, firm_id, ledger, action, reason, list_id, source, by_user, device_id, bridge, list, parent, open_sent)
  select p_book, f, l.name, 'held', coalesce(note, 'held'), lid, src, usr, dev, brg, lst, l.parent, coalesce(l.open_sent, l.open)
    from tally_ledgers l where l.book_id = p_book and l.name = any(to_hold);
  perform set_config('fincom.ledger_list', '', true);

  insert into tally_ledger_lists (list_id, book_id, firm_id, source, by_user, device_id, bridge, info, listed, live_before, missing, bulk_limit, marked, unmarked, held, note)
  values (lid, p_book, f, src, usr, dev, brg, lst, listed, live_before, coalesce(array_length(gone, 1), 0), lim, n_marked, n_unmarked, coalesce(array_length(to_hold, 1), 0), note);
  return jsonb_build_object('ok', true, 'ledgers', jsonb_array_length(coalesce(p_ledgers, '[]'::jsonb)), 'list', lid, 'marked', n_marked, 'unmarked', n_unmarked,
                            'held', coalesce(array_length(to_hold, 1), 0), 'missing', coalesce(array_length(gone, 1), 0), 'note', note,
                            'pending', dec->'pending', 'alert', dec->'alert');
end $function$;

-- ---------------------------------------------------------------- the answer (the firm's owner or staff)
-- Confirm: the held names marked deleted (his name on each mark), except a ledger listed again since the hold; the guard
-- keeps a ledger with entries, an opening or a recent rename. Keep: nothing marked. Either closes the alert as read by him
create or replace function public.tally_ledger_drop_confirm(p_drop uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); uid uuid := auth.uid(); b uuid; d tally_ledger_drops%rowtype; seen text[]; n_try int := 0; n_marked int := 0; lst jsonb;
begin
  if f is null or not exists (select 1 from members m where m.user_id = uid and m.firm_id = f and m.role in ('owner', 'staff') and coalesce(m.active, true))
    then raise exception 'only the firm''s owner or staff can confirm ledgers deleted in Tally' using errcode = '42501'; end if;
  select book_id into b from tally_ledger_drops where id = p_drop and firm_id = f;
  if b is null then raise exception 'no such question about ledgers in your firm' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext(b::text));
  select * into d from tally_ledger_drops where id = p_drop for update;
  if d.state <> 'pending' then return jsonb_build_object('ok', true, 'already', d.state, 'marked', 0); end if;
  select coalesce(array_agg(name), '{}') into seen from tally_ledgers where book_id = d.book_id and name = any(d.names) and seen_at > d.created_at;
  lst := jsonb_build_object('source', 'confirmed in FinCom', 'by', uid, 'drop', d.id, 'round', d.round_id, 'at', now());
  perform set_config('fincom.ledger_list', jsonb_build_object('reason', 'deleted in Tally: confirmed in FinCom (not listed by Tally''s ledger list, round ' || d.round_id || ')', 'list', lst)::text, true);
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
  if f is null or not exists (select 1 from members m where m.user_id = uid and m.firm_id = f and m.role in ('owner', 'staff') and coalesce(m.active, true))
    then raise exception 'only the firm''s owner or staff can keep these ledgers' using errcode = '42501'; end if;
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
revoke all on function public.tally_ledgers_mark_gone(uuid, text), public.tally_ledger_drop_words(uuid), public.tally_ledger_drop_decide(uuid, text[], integer, integer, text, uuid, text, timestamptz),
  public.tally_ingest_ledgers_list(uuid, date, date, jsonb, jsonb, boolean, integer) from public, anon, authenticated;
grant execute on function public.tally_ledgers_mark_gone(uuid, text), public.tally_ledger_drop_words(uuid), public.tally_ledger_drop_decide(uuid, text[], integer, integer, text, uuid, text, timestamptz),
  public.tally_ingest_ledgers_list(uuid, date, date, jsonb, jsonb, boolean, integer) to service_role;
revoke all on function public.tally_ledger_drop_confirm(uuid), public.tally_ledger_drop_keep(uuid) from public, anon;
grant execute on function public.tally_ledger_drop_confirm(uuid), public.tally_ledger_drop_keep(uuid) to authenticated, service_role;

commit;
