-- Migration 36 (rewritten 03-Oct-2026, round 9; first written round 4 items 4-6): the ledger-list design after review and the
-- rename cascade, written AGAINST WHAT STAGING REALLY HAS. One transaction, add-only (columns if missing, functions created
-- or replaced with the arguments tally-ingest calls, one trigger replaced by name), safe to run twice. Shown to the owner.
--
-- WHAT STAGING HAD ON 03-Oct (read with pg_get_functiondef / information_schema, read-only; project qbocskaiewaxqcvaunzc):
--   migration 34 as FIRST written (commit 2105b2d, 02-Oct), NOT the reviewed one (0aaaf23); 36b and 37 run on 03-Oct; this
--   file held. So: tally_ledgers = book_id, firm_id, name, parent, open, chain, primary_group, open_sent, merged_into, gstin,
--   pan, tally_guid, alter_id, deleted_at, origin, deleted_reason, deleted_by_list (NO renamed_at / seen_round / seen_at /
--   before_clean); tally_ledger_rounds = book_id, round_id, firm_id, started_at, last_seen_at, batches, rows_received,
--   rows_read, complete, device_id, bridge, note (NO seen_n); tally_ledger_day = book_id, firm_id, ledger, day, amount, dr,
--   cr, n (NO raw_ledger / merged_into / before_clean). Functions: tally_ledger_round_batch with 7 arguments (no p_seen);
--   tally_ledgers_mark_gone(p_book, p_round, p_gone jsonb) working from the bridge's gone list; tally_ledgers_a_guard with
--   the rule inline (any tally_ledger_day row for the name = has entries; coalesce(open_sent, open) <> 0); NO
--   tally_ledger_hold_reason; tally_ledger_rename(book, guid, from, to) in the first-34 text (no cascade, before_clean
--   guarded by information_schema); NO tally_ledger_round_seen. tally-ingest (index.ts) calls the 8-argument batch,
--   tally_ledger_round_seen and the 2-argument mark_gone: on staging today those calls fail and the notes say so.
--
-- WHAT THIS FILE DOES (on staging: first 34 -> 36b -> 37 -> this; on a fresh database: reviewed 34 -> this -> 36b -> 37;
-- both orders end with the same function texts, asserted by tests/run_migration_order.py):
--   A. columns if missing   tally_ledgers.renamed_at, seen_round, seen_at, before_clean jsonb; tally_ledger_rounds.seen_n
--                           int not null default 0; tally_ledger_day.raw_ledger, merged_into, before_clean (the migration-31
--                           twin pattern). Nothing below reads a column this file does not add or staging does not have.
--   B. the guard            tally_ledger_hold_reason(l tally_ledgers): entries under its name (a nil twin day row,
--                           merged_into set, is NOT an entry), entries under an old name (before_clean.renamed, the twins
--                           left out too), a non-zero opening, a rename in the last 30 days; tally_ledgers_a_guard() calls it
--                           (the reviewed text); the trigger replaced by name.
--   C. rounds               tally_ledger_round_batch with 8 arguments (p_seen; counts only: batches, rows, rowsRead,
--                           complete, seen_n summed; at most 50 new rounds a day per book) AND the 7-argument one kept as a
--                           wrapper calling it with '[]'; tally_ledger_round_seen(p_book, p_round, p_seen) stamps seen_round
--                           / seen_at by GUID (tally-ingest calls it AFTER its upsert, so a first round on a copy whose rows
--                           had no GUID yet stamps every row); tally_ledgers_mark_gone(p_book, p_round), the reviewed
--                           seen-based design, beside the live 3-argument one (left as it is).
--   D. the rename           tally_ledger_rename(book, guid, from, to) with the full cascade: tally_lines.ledger,
--                           tally_bills.ledger, tally_vouchers.party, tally_ledgers.merged_into take the new name;
--                           tally_ledger_day gets a new-name row per day (summed into one already there) and the old-name
--                           rows are KEPT nil, merged_into the new name (nothing deleted); the trial balance (tally_balances)
--                           before and after must be the same and 0, else the whole rename is raised and rolled back; a
--                           rename onto an existing name is a merge: entries and opening carried to the row that keeps the
--                           name (and takes the GUID), the old row marked merged - it holds nothing now and the twins do
--                           not count, so the guard lets it through; a row marked deleted that takes the name is un-marked.
--   E. the readers          every function that lists ledger names from tally_ledger_day reads `d.merged_into is null`, so
--                           the twins are hidden there: tally_tb, tally_period, tally_mis, tally_gst_summary, tally_ledger,
--                           tally_balances_on - the six texts copied from migration 37 (which ran before this file on
--                           staging) with that one filter; 37's file carries the same filter, so either order ends identical.
--                           Not listed from tally_ledger_day and so untouched: tally_tds_summary, tally_find,
--                           tally_vouchers_in, tally_ledgers_list (tally_ledgers.merged_into already hides a twin row there).
--   F. grants               tally-ingest's functions: the service role only; the readers: members and the service role.
--   Not in this file: tally_ingest_ledgers_* (the first 34's hold), tally_control_kept (the first 34 has it), 38's items.

begin;

-- ---------------------------------------------------------------- A. columns
alter table public.tally_ledgers add column if not exists renamed_at timestamptz;    -- the last rename (tally_ledger_rename)
alter table public.tally_ledgers add column if not exists seen_round text;           -- the last ledger-list round that read the row's GUID
alter table public.tally_ledgers add column if not exists seen_at timestamptz;
alter table public.tally_ledgers add column if not exists before_clean jsonb;        -- {renamed: [{from, at}], merged: [...]} (migration-31's name on staging's other tables)
alter table public.tally_ledger_rounds add column if not exists seen_n integer not null default 0;   -- GUIDs seen, summed over the batches
create index if not exists tally_ledger_rounds_book on public.tally_ledger_rounds (book_id, started_at desc);
alter table public.tally_ledger_day add column if not exists raw_ledger text;
alter table public.tally_ledger_day add column if not exists merged_into text;       -- a nil twin row left under an old name by a rename
alter table public.tally_ledger_day add column if not exists before_clean jsonb;

-- ---------------------------------------------------------------- B. the guard
-- why a row may not be marked deleted (null: it may): entries under its name (a nil twin day row is not one), entries
-- under an old name of its (before_clean.renamed), a non-zero opening, or a rename in the last 30 days
create or replace function public.tally_ledger_hold_reason(l public.tally_ledgers) returns text language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare olds text[];
begin
  if exists (select 1 from tally_ledger_day d where d.book_id = l.book_id and d.ledger = l.name and d.merged_into is null) then return 'has entries'; end if;
  begin
    select coalesce(array_agg(x->>'from'), '{}') into olds from jsonb_array_elements(coalesce(to_jsonb(l)->'before_clean'->'renamed', '[]'::jsonb)) x where x->>'from' is not null;
  exception when others then olds := '{}'; end;
  if coalesce(array_length(olds, 1), 0) > 0 and exists (select 1 from tally_ledger_day d where d.book_id = l.book_id and d.ledger = any(olds) and d.merged_into is null) then return 'has entries under an old name'; end if;
  if coalesce(l.open_sent, l.open, 0) <> 0 then return 'non-zero opening'; end if;
  if l.renamed_at is not null and l.renamed_at > now() - interval '30 days' then return 'renamed recently'; end if;
  return null;
end $function$;

create or replace function public.tally_ledgers_a_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare why text; ctx jsonb; lst jsonb; uid uuid; dev uuid;
begin
  if old.deleted_at is not null or new.deleted_at is null then return new; end if;
  why := public.tally_ledger_hold_reason(new);
  if why is null then return new; end if;
  -- the mark undone; the row stays as it was
  new.deleted_at := null; new.deleted_reason := old.deleted_reason; new.deleted_by_list := old.deleted_by_list;
  begin ctx := nullif(current_setting('fincom.ledger_list', true), '')::jsonb; exception when others then ctx := null; end;
  lst := coalesce(ctx->'list', jsonb_build_object('source', 'bridge ledger_list', 'at', now()));
  uid := case when lst->>'by' ~* '^[0-9a-f-]{36}$' then (lst->>'by')::uuid end;
  dev := case when lst->>'device' ~* '^[0-9a-f-]{36}$' then (lst->>'device')::uuid end;
  insert into tally_ledger_marks (book_id, firm_id, ledger, action, reason, list_id, source, by_user, device_id, bridge, list, parent, open_sent)
  values (new.book_id, new.firm_id, new.name, 'held', why || ': not marked' || coalesce(' (' || (ctx->>'reason') || ')', ''),
          case when lst->>'list_id' ~* '^[0-9a-f-]{36}$' then (lst->>'list_id')::uuid end, lst->>'source', uid, dev, lst->>'bridge', lst, new.parent, coalesce(new.open_sent, new.open));
  return new;
end $function$;
-- named to run before tally_ledgers_mark_log (triggers fire in name order): the log then sees no mark
create or replace trigger tally_ledgers_a_guard before update of deleted_at on public.tally_ledgers
  for each row when (old.deleted_at is null and new.deleted_at is not null) execute function public.tally_ledgers_a_guard();

-- ---------------------------------------------------------------- C. rounds: counts first, the stamp after the upsert, marking by what was seen
-- the batch recorded (batches, rows, seen_n, and the bridge's complete / rowsRead when sent); the rows are NOT stamped here
-- (tally_ledger_round_seen, after the upsert); at most 50 new rounds a day per book
create or replace function public.tally_ledger_round_batch(p_book uuid, p_round text, p_rows integer, p_rows_read integer, p_complete boolean, p_device uuid, p_bridge text, p_seen jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; rid text := left(btrim(coalesce(p_round, '')), 80); r tally_ledger_rounds%rowtype; n_seen int := 0; n_day int;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if rid = '' then raise exception 'a round id is needed' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  if not exists (select 1 from tally_ledger_rounds where book_id = p_book and round_id = rid) then
    select count(*) into n_day from tally_ledger_rounds where book_id = p_book and started_at > now() - interval '24 hours';
    if n_day > 50 then raise exception 'this book has had % ledger-list rounds in the last 24 hours; no new round until tomorrow', n_day using errcode = '54000'; end if;
  end if;
  if jsonb_typeof(p_seen) = 'array' then n_seen := jsonb_array_length(p_seen); end if;
  insert into tally_ledger_rounds (book_id, round_id, firm_id, batches, rows_received, rows_read, complete, device_id, bridge, seen_n)
  values (p_book, rid, f, 1, greatest(0, coalesce(p_rows, 0)), p_rows_read, p_complete, p_device, left(nullif(p_bridge, ''), 40), n_seen)
  on conflict (book_id, round_id) do update set last_seen_at = now(), batches = tally_ledger_rounds.batches + 1,
     rows_received = tally_ledger_rounds.rows_received + greatest(0, coalesce(p_rows, 0)), seen_n = tally_ledger_rounds.seen_n + excluded.seen_n,
     rows_read = coalesce(excluded.rows_read, tally_ledger_rounds.rows_read), complete = coalesce(excluded.complete, tally_ledger_rounds.complete),
     device_id = coalesce(excluded.device_id, tally_ledger_rounds.device_id), bridge = coalesce(excluded.bridge, tally_ledger_rounds.bridge)
  returning * into r;
  return jsonb_build_object('ok', true, 'round', r.round_id, 'batches', r.batches, 'rows', r.rows_received, 'rowsRead', r.rows_read, 'complete', r.complete, 'seen', r.seen_n);
end $function$;
-- the 7-argument call (staging's first 34, and any caller without seen): the same, with nothing seen
create or replace function public.tally_ledger_round_batch(p_book uuid, p_round text, p_rows integer, p_rows_read integer, p_complete boolean, p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return public.tally_ledger_round_batch(p_book, p_round, p_rows, p_rows_read, p_complete, p_device, p_bridge, '[]'::jsonb);
end $function$;

-- the rows whose GUID this batch read, stamped with the round: called by tally-ingest AFTER its upsert of the batch's
-- rows (which gives a row its GUID when it had none), with the batch's seen array as sent to tally_ledger_round_batch
create or replace function public.tally_ledger_round_seen(p_book uuid, p_round text, p_seen jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; rid text := left(btrim(coalesce(p_round, '')), 80); seen text[] := '{}'; n int := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if rid = '' then raise exception 'a round id is needed' using errcode = '22023'; end if;
  if jsonb_typeof(p_seen) = 'array' then
    select coalesce(array_agg(distinct g), '{}') into seen from (select nullif(btrim(x #>> '{}'), '') as g from jsonb_array_elements(p_seen) x) s where g is not null;
  end if;
  if array_length(seen, 1) > 0 then
    update tally_ledgers set seen_round = rid, seen_at = now() where book_id = p_book and tally_guid = any(seen) and seen_round is distinct from rid;
    get diagnostics n = row_count;
  end if;
  update tally_ledger_rounds set last_seen_at = now() where book_id = p_book and round_id = rid;
  return jsonb_build_object('ok', true, 'round', rid, 'stamped', n, 'seen', coalesce(array_length(seen, 1), 0));
end $function$;

-- the ledgers a round did not see: the live rows with a GUID (deleted_at null, merged_into null) whose seen_round is
-- not this round, marked by GUID only when the round is complete, the bridge read ledgers and every batch arrived
-- (seen_n = rows_read); else all held with the note (one 'held' mark per round and ledger; none at all for a round
-- never recorded). Over the bulk limit greatest(25, 5% of the live ledgers): only the rows the book's previous
-- complete round did not see either are marked (missing twice), the rest held. The guard keeps each row with
-- entries, an opening or a recent rename. The 3-argument tally_ledgers_mark_gone(book, round, gone) of the first 34
-- stays as it is on staging (tally-ingest calls this one)
create or replace function public.tally_ledgers_mark_gone(p_book uuid, p_round text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; rid text := left(btrim(coalesce(p_round, '')), 80); r tally_ledger_rounds%rowtype; names text[]; n_gone int; live int; lim int; outcome text;
  to_mark text[] := '{}'; to_hold text[] := '{}'; prev text; n_marked int := 0; n_held int := 0; lst jsonb; done boolean := false; n_logged int := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select * into r from tally_ledger_rounds where book_id = p_book and round_id = rid;
  select coalesce(array_agg(name order by name), '{}') into names from tally_ledgers
   where book_id = p_book and deleted_at is null and merged_into is null and tally_guid is not null and seen_round is distinct from rid;
  n_gone := coalesce(array_length(names, 1), 0);
  select count(*) into live from tally_ledgers where book_id = p_book and deleted_at is null and merged_into is null;
  lst := jsonb_strip_nulls(jsonb_build_object('source', 'bridge ledger_list', 'round', rid, 'at', now(), 'device', r.device_id, 'bridge', r.bridge));
  if r.book_id is null then
    outcome := 'no such round: nothing marked';
    return jsonb_build_object('ok', true, 'marked', 0, 'held', 0, 'gone', n_gone, 'note', outcome);
  end if;
  done := r.complete is true and coalesce(r.rows_read, 0) > 0 and r.seen_n = r.rows_read;
  if n_gone = 0 then
    outcome := 'nothing to mark: the round saw every live ledger with a GUID';
  elsif r.complete is distinct from true then
    outcome := format('round not complete: nothing marked (%s not seen, held)', n_gone); to_hold := names;
  elsif coalesce(r.rows_read, 0) <= 0 then
    outcome := format('the bridge read no ledgers (rowsRead 0): nothing marked (%s not seen, held)', n_gone); to_hold := names;
  elsif not done then
    outcome := format('%s of %s GUIDs seen (a batch missing): nothing marked (%s not seen, held)', r.seen_n, r.rows_read, n_gone); to_hold := names;
  else
    lim := greatest(25, live / 20);
    if n_gone > lim then
      -- too many at once: marked only those the previous complete round did not see either; the rest held
      select round_id into prev from tally_ledger_rounds where book_id = p_book and round_id <> rid and started_at < r.started_at
        and complete is true and coalesce(rows_read, 0) > 0 and seen_n = rows_read order by started_at desc limit 1;
      if prev is not null then
        select coalesce(array_agg(l.name order by l.name), '{}') into to_mark from tally_ledgers l where l.book_id = p_book and l.name = any(names) and l.seen_round is distinct from prev;
      end if;
      select coalesce(array_agg(g), '{}') into to_hold from unnest(names) g where not (g = any(to_mark));
      outcome := format('%s not seen, more than %s at once: held for a second read (the next complete round)', n_gone, lim)
              || case when array_length(to_mark, 1) > 0 then format('; %s not seen by the round before (%s) either, marked', array_length(to_mark, 1), prev) else '' end;
    else
      to_mark := names;
    end if;
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
  -- the held ones logged once per round and ledger (a round asked again writes nothing more)
  insert into tally_ledger_marks (book_id, firm_id, ledger, action, reason, source, device_id, bridge, list, parent, open_sent)
  select p_book, f, l.name, 'held', coalesce(outcome, 'held'), 'bridge ledger_list', r.device_id, r.bridge, lst, l.parent, coalesce(l.open_sent, l.open)
    from tally_ledgers l where l.book_id = p_book and l.name = any(to_hold)
     and not exists (select 1 from tally_ledger_marks m where m.book_id = p_book and m.ledger = l.name and m.action = 'held' and m.list->>'round' = rid);
  get diagnostics n_logged = row_count;
  n_held := n_held + coalesce(array_length(to_hold, 1), 0);
  update tally_ledger_rounds set note = left(outcome, 300), last_seen_at = now() where book_id = p_book and round_id = rid;
  return jsonb_build_object('ok', true, 'marked', n_marked, 'held', n_held, 'gone', n_gone, 'logged', n_logged, 'note', outcome);
end $function$;

-- ---------------------------------------------------------------- D. the rename carries the entries
-- the entries under one name moved to another, in this transaction: lines, bills, the party on entries, twins pointing
-- at it, and the ready day totals (a new-name row per day, added into one already there; the old-name rows kept nil and
-- pointed). Returns what moved
create or replace function public.tally_ledger_carry(p_book uuid, p_from text, p_to text) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare n_lines int; n_bills int; n_vch int; n_twins int; n_days int;
begin
  update tally_lines set ledger = p_to where book_id = p_book and ledger = p_from;
  get diagnostics n_lines = row_count;
  update tally_bills set ledger = p_to where book_id = p_book and ledger = p_from;
  get diagnostics n_bills = row_count;
  update tally_vouchers set party = p_to where book_id = p_book and party = p_from;
  get diagnostics n_vch = row_count;
  update tally_ledgers set merged_into = p_to where book_id = p_book and merged_into = p_from;
  get diagnostics n_twins = row_count;
  -- the day totals: the new-name row per day (summed into one already there), then the old rows kept nil and pointed
  insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
  select d.book_id, d.firm_id, p_to, d.day, d.amount, d.dr, d.cr, d.n from tally_ledger_day d where d.book_id = p_book and d.ledger = p_from and d.merged_into is null
  on conflict (book_id, ledger, day) do update set amount = tally_ledger_day.amount + excluded.amount, dr = tally_ledger_day.dr + excluded.dr,
     cr = tally_ledger_day.cr + excluded.cr, n = tally_ledger_day.n + excluded.n, merged_into = null;
  get diagnostics n_days = row_count;
  update tally_ledger_day d
     set before_clean = coalesce(d.before_clean, jsonb_build_object('amount', d.amount, 'dr', d.dr, 'cr', d.cr, 'n', d.n)),
         raw_ledger = coalesce(d.raw_ledger, d.ledger), merged_into = p_to, amount = 0, dr = 0, cr = 0, n = 0
   where d.book_id = p_book and d.ledger = p_from and d.merged_into is null;
  update tally_ledger_day set merged_into = p_to where book_id = p_book and merged_into = p_from and ledger <> p_from;
  return jsonb_build_object('lines', n_lines, 'bills', n_bills, 'vouchers', n_vch, 'twins', n_twins, 'days', n_days);
end $function$;

create or replace function public.tally_ledger_rename(p_book uuid, p_guid text, p_from text, p_to text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); frm text := left(btrim(coalesce(p_from, '')), 300); dst text := left(btrim(coalesce(p_to, '')), 300);
  row_name text; row_guid text; other_name text; other_guid text; other_gone boolean; hist boolean; kept boolean; why text;
  tb_before numeric; tb_after numeric; moved jsonb; o_open numeric; o_sent numeric; lst jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if dst = '' then return jsonb_build_object('ok', true, 'renamed', false, 'note', 'no new name'); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  -- the row: by its GUID (a live row first), else by the old name where no GUID is held yet
  if g is not null then
    select name, tally_guid into row_name, row_guid from tally_ledgers where book_id = p_book and tally_guid = g order by (deleted_at is null) desc limit 1;
  end if;
  if row_name is null and frm <> '' then
    select name, tally_guid into row_name, row_guid from tally_ledgers where book_id = p_book and name = frm and tally_guid is null;
  end if;
  if row_name is null then return jsonb_build_object('ok', true, 'renamed', false, 'note', 'no such ledger: ' || frm); end if;
  if row_name = dst then return jsonb_build_object('ok', true, 'renamed', false, 'note', 'already named so'); end if;
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_ledgers' and column_name = 'before_clean') into hist;
  select name, tally_guid, deleted_at is not null into other_name, other_guid, other_gone from tally_ledgers where book_id = p_book and name = dst;
  if other_name is not null and other_guid is not null and g is not null and other_guid <> g then
    return jsonb_build_object('ok', true, 'renamed', false, 'refused', true, 'from', row_name, 'to', dst,
      'note', format('rename %s -> %s: that name is another ledger''s (GUID %s); left', row_name, dst, other_guid));
  end if;
  -- the trial balance before: the sum of closing balances over the book (0 when it ties)
  select round(coalesce(sum(closing), 0), 2) into tb_before from tally_balances where book_id = p_book;
  if tb_before <> 0 then
    raise exception 'the trial balance of this book does not tie (the closing balances add up to %, not 0); % cannot be renamed until it does', tb_before, row_name using errcode = 'P0001';
  end if;
  lst := jsonb_build_object('source', 'bridge ledger_list', 'at', now(), 'renamed', jsonb_build_object('from', row_name, 'to', dst, 'guid', g));
  if other_name is not null then
    -- a merge: the entries and the opening go to the row that keeps the name (and takes the GUID); the old row, now
    -- empty, is marked merged. A row with the new name marked deleted earlier is un-marked: Tally uses the name again
    moved := public.tally_ledger_carry(p_book, row_name, dst);
    select open, open_sent into o_open, o_sent from tally_ledgers where book_id = p_book and name = row_name;
    update tally_ledgers set open = coalesce(open, 0) + coalesce(o_open, 0),
           open_sent = case when open_sent is null and o_sent is null then null else coalesce(open_sent, open, 0) + coalesce(o_sent, o_open, 0) end
     where book_id = p_book and name = dst;
    if other_gone then
      perform set_config('fincom.ledger_list', jsonb_build_object('unreason', format('named again in Tally (%s renamed to it)', row_name), 'list', lst)::text, true);
      update tally_ledgers set deleted_at = null where book_id = p_book and name = dst;
    end if;
    update tally_ledgers set open = 0, open_sent = case when open_sent is null then null else 0 end, renamed_at = null where book_id = p_book and name = row_name;
    perform set_config('fincom.ledger_list', jsonb_build_object('reason', format('renamed in Tally to %s (merged into the row with that name)', dst), 'list', lst)::text, true);
    update tally_ledgers set deleted_at = now() where book_id = p_book and name = row_name;
    perform set_config('fincom.ledger_list', '', true);
    select deleted_at is null into kept from tally_ledgers where book_id = p_book and name = row_name;
    if kept then
      select public.tally_ledger_hold_reason(l) into why from tally_ledgers l where l.book_id = p_book and l.name = row_name;
      raise exception 'rename % -> %: the old row is kept live by the guard (%); the merge was rolled back', row_name, dst, coalesce(why, 'unknown reason') using errcode = 'P0001';
    end if;
    update tally_ledgers set tally_guid = null where book_id = p_book and name = row_name;
    if g is not null and other_guid is null then update tally_ledgers set tally_guid = g where book_id = p_book and name = dst; end if;
    if hist then
      execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''renamed'', coalesce(before_clean->''renamed'', ''[]''::jsonb) || $1) where book_id = $2 and name = $3'
        using jsonb_build_object('from', row_name, 'to', dst, 'at', now(), 'merged', true, 'guid', g, 'open', o_open, 'moved', moved), p_book, row_name;
      -- on the row that stays: what came in (under 'merged', not 'renamed': the merged name is not an old name of this row)
      execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''merged'', coalesce(before_clean->''merged'', ''[]''::jsonb) || $1) where book_id = $2 and name = $3'
        using jsonb_build_object('from', row_name, 'at', now(), 'guid', g, 'open', o_open, 'moved', moved), p_book, dst;
    end if;
  else
    -- a plain rename: the row keeps everything under the new name; its entries follow
    update tally_ledgers set name = dst, tally_guid = coalesce(tally_guid, g), renamed_at = now() where book_id = p_book and name = row_name;
    moved := public.tally_ledger_carry(p_book, row_name, dst);
    if hist then
      execute 'update tally_ledgers set before_clean = coalesce(before_clean, ''{}''::jsonb) || jsonb_build_object(''renamed'', coalesce(before_clean->''renamed'', ''[]''::jsonb) || $1) where book_id = $2 and name = $3'
        using jsonb_build_object('from', row_name, 'at', now(), 'moved', moved), p_book, dst;
    end if;
  end if;
  -- the trial balance after: the same sum, and 0; else everything above is rolled back
  select round(coalesce(sum(closing), 0), 2) into tb_after from tally_balances where book_id = p_book;
  if tb_after <> tb_before or tb_after <> 0 then
    raise exception 'the trial balance would not tie after the rename % -> %: before %, after %; nothing was changed', row_name, dst, tb_before, tb_after using errcode = 'P0001';
  end if;
  if other_name is not null then
    return jsonb_build_object('ok', true, 'renamed', false, 'merged', true, 'from', row_name, 'to', dst, 'tb', tb_after,
      'note', format('%s -> %s: the entries and the opening carried to the row with the new name, which takes the GUID; the old row marked merged', row_name, dst)) || moved;
  end if;
  return jsonb_build_object('ok', true, 'renamed', true, 'from', row_name, 'to', dst, 'guid', coalesce(row_guid, g), 'tb', tb_after) || moved;
end $function$;

-- ---------------------------------------------------------------- E. the readers hide the twins (migration 37's texts + `d.merged_into is null`)
create or replace function public.tally_tb(p_client text, p_as_on date)
returns table(ledger text, parent text, open numeric, movement numeric, closing numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_as_on); b tally_books%rowtype;
begin
  if bk is null then return; end if;
  select * into b from tally_books where book_id = bk;
  return query
    with lg as (select tally_nm(t.name) as name, max(t.parent) as parent, sum(t.open) as open from tally_ledgers t
                 where t.book_id = bk and t.merged_into is null group by 1),
    mv as (select tally_nm(d.ledger) as ledger, sum(d.amount) m from tally_ledger_day d where d.book_id = bk and d.merged_into is null and d.day between b.from_date and p_as_on group by 1)
    select coalesce(lg.name, mv.ledger), coalesce(lg.parent, ''), coalesce(lg.open, 0)::numeric, coalesce(mv.m, 0)::numeric, (coalesce(lg.open, 0) + coalesce(mv.m, 0))::numeric
      from lg full join mv on mv.ledger = lg.name;
end $function$;

create or replace function public.tally_period(p_client text, p_from date, p_to date)
returns table(ledger text, parent text, open numeric, dr numeric, cr numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_from); b tally_books%rowtype;
begin
  if bk is null then return; end if;
  select * into b from tally_books where book_id = bk;
  return query
  with names as (select l.name as n from tally_ledgers l where l.book_id = bk union select d.ledger from tally_ledger_day d where d.book_id = bk and d.merged_into is null),
  before as (select d.ledger as n, sum(d.amount) as a from tally_ledger_day d where d.book_id = bk and d.merged_into is null and d.day >= b.from_date and d.day < p_from group by d.ledger),
  inside as (select d.ledger as n, sum(d.dr) as dr, sum(d.cr) as cr from tally_ledger_day d where d.book_id = bk and d.merged_into is null and d.day between greatest(p_from, b.from_date) and p_to group by d.ledger)
  select x.n, t.parent, coalesce(t.open, 0) + coalesce(be.a, 0), coalesce(i.dr, 0), coalesce(i.cr, 0)
    from names x left join tally_ledgers t on t.book_id = bk and t.name = x.n left join before be on be.n = x.n left join inside i on i.n = x.n
   order by x.n;
end $function$;

create or replace function public.tally_mis(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with led as (
    select l.name, coalesce(l.open, 0) as open, tally_mis_head(l.name, l.chain) as hd,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sales accounts') as sales,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sundry debtors') as deb,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sundry creditors') as cred,
           exists (select 1 from unnest(l.chain) g where lower(g) in ('bank accounts', 'cash-in-hand', 'bank od a/c', 'bank occ a/c')) as cash
      from tally_ledgers l where l.book_id = bk and l.merged_into is null),
  mv as (select d.ledger, to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as a from tally_ledger_day d
          where d.book_id = bk and d.merged_into is null and d.day between greatest(p_from, b.from_date) and p_to group by 1, 2),
  sg as (select * from (values ('rev', 1), ('oth', 1), ('pur', -1), ('dir', -1), ('emp', -1), ('exp', -1), ('fin', -1), ('dep', -1), ('tax', -1)) s(hd, sign)),
  hm as (select l.hd, m.ym, round(sum(m.a * s.sign), 2) as v from mv m join led l on l.name = m.ledger join sg s on s.hd = l.hd group by 1, 2),
  ht as (select hd, round(sum(v), 2) as t, jsonb_object_agg(ym, v) as m from hm group by hd),
  hl as (select l.hd, m.ledger, round(sum(m.a * s.sign), 2) as t from mv m join led l on l.name = m.ledger join sg s on s.hd = l.hd group by 1, 2),
  tops as (select hd, jsonb_agg(jsonb_build_object('l', ledger, 't', t) order by abs(t) desc, ledger) as led from (select *, row_number() over (partition by hd order by abs(t) desc, ledger) as r from hl) z where r <= 15 group by hd),
  months as (select to_char(gs, 'YYYYMM') as ym from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs),
  tot as (select mo.ym,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) as income,
           coalesce(sum(hm.v) filter (where hm.hd = 'rev'), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir')), 0) as gross,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp')), 0) as ebitda,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp', 'fin', 'dep')), 0) as pbt,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp', 'fin', 'dep', 'tax')), 0) as pat
         from months mo left join hm on hm.ym = mo.ym group by mo.ym),
  -- sales by customer: the Sales Accounts lines of each entry, under the entry's party (else its debtor line)
  sl as (select coalesce(nullif(v.party, ''), (select x.ledger from tally_lines x join led dl on dl.name = x.ledger and dl.deb where x.book_id = bk and x.guid = v.guid limit 1), '') as party, sum(t.amount) as a
           from tally_lines t join led l on l.name = t.ledger and l.sales join tally_vouchers v on v.book_id = t.book_id and v.guid = t.guid
          where t.book_id = bk and t.day between greatest(p_from, b.from_date) and p_to and v.deleted_at is null and not v.cancelled and not v.optional group by 1),
  -- balances on the last date
  bal as (select l.name, l.deb, l.cred, l.cash, l.open + coalesce((select sum(d.amount) from tally_ledger_day d where d.book_id = bk and d.merged_into is null and d.ledger = l.name and d.day between b.from_date and p_to), 0) as c
            from led l where l.deb or l.cred or l.cash)
  select jsonb_build_object(
    'from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'), 'company', b.company,
    'months', (select jsonb_agg(ym order by ym) from months),
    'heads', coalesce((select jsonb_object_agg(ht.hd, jsonb_build_object('t', ht.t, 'm', ht.m, 'led', coalesce(tops.led, '[]'::jsonb))) from ht left join tops on tops.hd = ht.hd), '{}'::jsonb),
    'income', (select jsonb_build_object('t', round(sum(income), 2), 'm', jsonb_object_agg(ym, round(income, 2))) from tot),
    'gross', (select jsonb_build_object('t', round(sum(gross), 2), 'm', jsonb_object_agg(ym, round(gross, 2))) from tot),
    'ebitda', (select jsonb_build_object('t', round(sum(ebitda), 2), 'm', jsonb_object_agg(ym, round(ebitda, 2))) from tot),
    'pbt', (select jsonb_build_object('t', round(sum(pbt), 2), 'm', jsonb_object_agg(ym, round(pbt, 2))) from tot),
    'pat', (select jsonb_build_object('t', round(sum(pat), 2), 'm', jsonb_object_agg(ym, round(pat, 2))) from tot),
    'sales', jsonb_build_object('total', coalesce((select round(sum(a), 2) from sl), 0),
       'other', coalesce((select round(sum(m.a), 2) from mv m join led l on l.name = m.ledger where l.hd in ('rev', 'oth') and not l.sales), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', party, 't', round(a, 2)) order by a desc) from (select * from sl order by a desc limit 20) z), '[]'::jsonb)),
    'recv', jsonb_build_object('owed', coalesce((select round(sum(greatest(-c, 0)), 2) from bal where deb), 0), 'advance', coalesce((select round(sum(greatest(c, 0)), 2) from bal where deb), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', name, 'owed', round(-c, 2)) order by c) from (select * from bal where deb and c < 0 order by c limit 20) z), '[]'::jsonb)),
    'pay', jsonb_build_object('owe', coalesce((select round(sum(greatest(c, 0)), 2) from bal where cred), 0), 'advance', coalesce((select round(sum(greatest(-c, 0)), 2) from bal where cred), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', name, 'owe', round(c, 2)) order by c desc) from (select * from bal where cred and c > 0 order by c desc limit 20) z), '[]'::jsonb)),
    'cash', jsonb_build_object('total', coalesce((select round(sum(-c), 2) from bal where cash), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('l', name, 'bal', round(-c, 2)) order by name) from bal where cash), '[]'::jsonb)),
    'grouped', exists (select 1 from led where hd <> '' limit 1),
    'at', now())
  into res;
  return res;
end $function$;

create or replace function public.tally_gst_summary(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with k as (select * from tally_led_kinds(p_client) where kind = 'gst' and what in ('gst', 'gst_rcm', 'gst_import')),
  sales as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null and exists (select 1 from unnest(l.chain) g where lower(g) = 'sales accounts')),
  months as (select to_char(gs, 'YYYYMM') as ym from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs),
  -- the tax on documents only (review: the month's set-off and payment entries moved the tax ledgers too): output tax on
  -- entries with a sales or income line, input tax on entries with an expense, purchase or fixed-asset line
  nom as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null
            and exists (select 1 from unnest(l.chain) g where lower(g) in ('sales accounts', 'direct incomes', 'indirect incomes', 'purchase accounts', 'direct expenses', 'indirect expenses', 'fixed assets'))),
  inc as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null
            and exists (select 1 from unnest(l.chain) g where lower(g) in ('sales accounts', 'direct incomes', 'indirect incomes'))),
  docs as (select v.guid,
             exists (select 1 from tally_lines x join inc on inc.name = x.ledger where x.book_id = bk and x.guid = v.guid) as outward,
             exists (select 1 from tally_lines x join nom on nom.name = x.ledger where x.book_id = bk and x.guid = v.guid) as doc
             from tally_vouchers v where v.book_id = bk and v.day between greatest(p_from, b.from_date) and p_to and v.deleted_at is null and not v.cancelled and not v.optional),
  tx as (select to_char(t.day, 'YYYYMM') as ym, k.side, k.what, upper(k.tax) as tax, sum(t.amount) as net
           from tally_lines t join k on k.ledger = t.ledger join docs on docs.guid = t.guid
          where t.book_id = bk and t.day between greatest(p_from, b.from_date) and p_to
            and ((k.side = 'output' and docs.outward) or (k.side <> 'output' and docs.doc)) group by 1, 2, 3, 4),
  sv as (select to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as v from tally_ledger_day d join sales s on s.name = d.ledger
          where d.book_id = bk and d.merged_into is null and d.day between greatest(p_from, b.from_date) and p_to group by 1),
  heads as (select * from (values ('CGST'), ('SGST'), ('IGST'), ('CESS')) h(tax)),
  per as (select mo.ym,
    (select jsonb_object_agg(h.tax, coalesce((select round(sum(net), 2) from tx where tx.ym = mo.ym and side = 'output' and what = 'gst' and (tx.tax = h.tax or (h.tax = 'SGST' and tx.tax = 'UTGST'))), 0)) from heads h) as out_tax,
    (select jsonb_object_agg(h.tax, coalesce((select round(-sum(net), 2) from tx where tx.ym = mo.ym and side = 'input' and what in ('gst', 'gst_import') and (tx.tax = h.tax or (h.tax = 'SGST' and tx.tax = 'UTGST'))), 0)) from heads h) as in_tax,
    coalesce((select round(sum(net), 2) from tx where tx.ym = mo.ym and what = 'gst_rcm' and side = 'output'), 0) as rcm_out,
    coalesce((select round(-sum(net), 2) from tx where tx.ym = mo.ym and what = 'gst_rcm' and side = 'input'), 0) as rcm_in,
    coalesce((select round(v, 2) from sv where sv.ym = mo.ym), 0) as taxable_sales
    from months mo)
  select jsonb_build_object('from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'), 'mapped', (select count(*) from k),
    'months', coalesce(jsonb_agg(jsonb_build_object('ym', ym, 'out', out_tax, 'in', in_tax, 'rcmOut', rcm_out, 'rcmIn', rcm_in, 'taxableSales', taxable_sales) order by ym), '[]'::jsonb), 'at', now())
  into res from per;
  return res;
end $function$;

create or replace function public.tally_ledger(p_client text, p_ledger text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_from); b tally_books%rowtype; ob numeric; lines jsonb; nm text := tally_nm(p_ledger);
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  select coalesce((select sum(t.open) from tally_ledgers t where t.book_id = bk and t.merged_into is null and tally_nm(t.name) = nm), 0)
       + coalesce((select sum(d.amount) from tally_ledger_day d where d.book_id = bk and d.merged_into is null and tally_nm(d.ledger) = nm and d.day >= b.from_date and d.day < p_from), 0)
    into ob;
  select coalesce(jsonb_agg(jsonb_build_array(to_char(l.day, 'YYYYMMDD'), v.vtype, v.vno, v.party, v.narration, l.amount, l.guid) order by l.day, v.vno), '[]'::jsonb)
    into lines
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = bk and tally_nm(l.ledger) = nm and l.day between greatest(p_from, b.from_date) and p_to and v.deleted_at is null and not v.cancelled and not v.optional;
  return jsonb_build_object('open', ob, 'lines', lines, 'from', b.from_date, 'company', b.company, 'daysAt', b.days_at);
end $function$;

create or replace function public.tally_balances_on(p_book uuid, p_as_on date)
returns table(ledger text, parent text, primary_group text, open numeric, movement numeric, closing numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype;
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null or b.firm_id is distinct from my_firm() then raise exception 'not a company of your firm' using errcode = '42501'; end if;
  return query
    with lg as (select l.name, l.parent, l.primary_group, coalesce(l.open, 0) as open from tally_ledgers l
                 where l.book_id = p_book and l.merged_into is null and l.deleted_at is null),
    mv as (select d.ledger as name, sum(d.amount) as m from tally_ledger_day d where d.book_id = p_book and d.merged_into is null and d.day >= b.from_date and d.day <= p_as_on group by d.ledger)
    select coalesce(lg.name, mv.name), coalesce(lg.parent, ''), coalesce(lg.primary_group, ''), coalesce(lg.open, 0)::numeric, coalesce(mv.m, 0)::numeric, (coalesce(lg.open, 0) + coalesce(mv.m, 0))::numeric
      from lg full join mv on mv.name = lg.name
     where lg.name is not null
        or not exists (select 1 from tally_ledgers x where x.book_id = p_book and x.name = mv.name)   -- a day row under a name the masters lack: shown, as tally_tb does
     order by 1;
end $function$;

-- ---------------------------------------------------------------- F. who may call
revoke all on function public.tally_ledger_rename(uuid, text, text, text), public.tally_ledger_carry(uuid, text, text), public.tally_ledger_hold_reason(public.tally_ledgers),
  public.tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text, jsonb), public.tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text),
  public.tally_ledger_round_seen(uuid, text, jsonb), public.tally_ledgers_mark_gone(uuid, text) from public, anon, authenticated;
grant execute on function public.tally_ledger_rename(uuid, text, text, text), public.tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text, jsonb),
  public.tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text), public.tally_ledger_round_seen(uuid, text, jsonb), public.tally_ledgers_mark_gone(uuid, text) to service_role;
revoke all on function public.tally_tb(text, date), public.tally_period(text, date, date), public.tally_mis(text, date, date), public.tally_gst_summary(text, date, date),
  public.tally_ledger(text, text, date, date), public.tally_balances_on(uuid, date) from public, anon;
grant execute on function public.tally_tb(text, date), public.tally_period(text, date, date), public.tally_mis(text, date, date), public.tally_gst_summary(text, date, date),
  public.tally_ledger(text, text, date, date), public.tally_balances_on(uuid, date) to authenticated, service_role;

commit;
