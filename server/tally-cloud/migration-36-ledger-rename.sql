-- Migration 36 (03-Oct-2026, round 4 items 4-6): a rename in Tally carries the ledger's entries with it, and the first
-- ledger-list round on a copy whose rows had no GUID yet marks nothing. Runs AFTER migration 34 (order on a fresh
-- database: 32 -> 33 -> 35 -> 34 -> 36; docs/MIGRATION-ORDER.md). Adds only: columns (if missing) and functions replaced
-- with the same arguments, plus one new function. Nothing is dropped, deleted or revoked from what is there; safe to run
-- again. To be shown to the owner before it runs.
--
--   A. the rename        tally_ledger_rename(book, guid, from, to), migration-34's arguments and rules (the row by GUID,
--                        else by the old name, which takes the GUID; the new name held by another GUID: refused with a
--                        note; renamed_at; the old name kept in before_clean.renamed), and now, in the same transaction,
--                        the entries follow the name: tally_lines.ledger, tally_bills.ledger, tally_vouchers.party and
--                        tally_ledgers.merged_into (a twin pointing at the old name) take the new name; tally_ledger_day
--                        gets a new-name row per day (added into one already there: on conflict amount, dr, cr and n
--                        are summed) and the old-name rows are KEPT with nil amounts, merged_into the new name (the
--                        migration-31 twin pattern: nothing deleted, the day's rebuild by tally_ingest_day puts them
--                        right). raw_ledger / raw_party stay as Tally sent them (history).
--                        The new name a row of its own (no GUID, or the same): the entries and the opening are carried
--                        to that row, which keeps the name and takes the GUID; the old row is marked merged
--                        (deleted_at, its GUID moved, opening nil) - it has no entries now, so the guard allows it;
--                        a row with the new name marked deleted earlier is un-marked (Tally uses the name again).
--                        Then the check: the sum of closing balances over tally_balances for the book, before and
--                        after; when they differ, or the sum is not 0, the whole rename is raised and rolled back in
--                        plain words. A book whose trial balance does not tie cannot rename until it does.
--   B. the guard         tally_ledger_hold_reason no longer counts a nil twin day row (merged_into set) as an entry:
--                        the old-name rows left by a rename do not hold the row for ever
--   C. the first round   tally_ledger_round_batch (the same arguments) keeps the counts (batches, rows, rowsRead,
--                        complete, seen_n) but no longer stamps the rows: stamping by GUID BEFORE tally-ingest's upsert
--                        missed every row that had no GUID yet (on staging: a first 2.1.5 round stamped nothing and
--                        logged ~1,100 'held' marks). New tally_ledger_round_seen(book, round, seen) stamps seen_round /
--                        seen_at by GUID; tally-ingest calls it AFTER the upsert with the same seen array, then
--                        tally_ledgers_mark_gone on the last batch - which then finds nothing unseen
--   D. grants            the service role only (tally-ingest); every function security definer, public, pg_temp

begin;

-- the columns the twin pattern uses (migration-31 added them on staging; here too, if missing)
alter table public.tally_ledger_day add column if not exists raw_ledger text;
alter table public.tally_ledger_day add column if not exists merged_into text;
alter table public.tally_ledger_day add column if not exists before_clean jsonb;
alter table public.tally_ledgers add column if not exists renamed_at timestamptz;
alter table public.tally_ledgers add column if not exists seen_round text;
alter table public.tally_ledgers add column if not exists seen_at timestamptz;

-- ---------------------------------------------------------------- B. the guard: a nil twin day row is not an entry
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

-- ---------------------------------------------------------------- A. the rename carries the entries
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

-- ---------------------------------------------------------------- C. the first round: counts first, the stamp after the upsert
-- migration-34's function, the same arguments: the batch recorded (batches, rows, seen_n, and the bridge's complete /
-- rowsRead when sent); the rows are NOT stamped here any more (tally_ledger_round_seen, after the upsert)
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

-- ---------------------------------------------------------------- D. who may call: the service role only (tally-ingest)
revoke all on function public.tally_ledger_rename(uuid, text, text, text), public.tally_ledger_carry(uuid, text, text), public.tally_ledger_hold_reason(public.tally_ledgers),
  public.tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text, jsonb), public.tally_ledger_round_seen(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.tally_ledger_rename(uuid, text, text, text), public.tally_ledger_round_batch(uuid, text, integer, integer, boolean, uuid, text, jsonb),
  public.tally_ledger_round_seen(uuid, text, jsonb) to service_role;

commit;
