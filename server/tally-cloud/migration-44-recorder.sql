-- Migration 44 (04-Oct-2026, phase 2: the Tally change recorder). Runs AFTER 43 (fresh database: 41 -> 42 -> 43 -> 44;
-- staging: after 43, run by the owner on 04-Oct; docs/MIGRATION-ORDER.md). Add-only (three tables and columns added if
-- missing; functions created or replaced with the same arguments; ten functions given a search_path by ALTER FUNCTION,
-- their text unchanged; nothing dropped or deleted), safe to run twice. Shown to the owner before it runs.
--
-- The key of an entry is Tally's voucher GUID per book (tally_vouchers (book_id, guid), as since migration 32), whichever
-- path brings it: a day book (tally_ingest_day, the bridge's days or an uploaded file) or a recorder line. A FinCom
-- posting is matched by its FinCom id (the "TDSDesk:<id>" its narration carries, tally_vouchers.fincom_id) on top of that.
--
--   1. ONE ENTRY PATH (owner item 95). tally_ingest_entries(p_book uuid, p_vouchers jsonb, p_lines jsonb) returns jsonb
--      (service role) is the part of tally_ingest_day that takes entries: the versions of the entries sent get their
--      lines first (tally_voucher_version_lines), the entries are inserted or brought up to date in place (deleted_at
--      cleared, the FinCom id and origin as 37), a version row for each AlterID, their lines and bills replaced, the
--      ledger-day cache rebuilt for every day touched (the days they had and the days they have now). Each voucher
--      carries its own date ("day": yyyy-mm-dd or yyyymmdd; one without is refused); p_vouchers [{guid, alter, type, no,
--      party, narr, cancel, opt, gstin, pos, ref, refDate, cmp, fid, day}], p_lines [[guid, ledger, amount, hsn, rate,
--      bills]] as parse.js makes them. A line whose entry is not among p_vouchers is not stored (43 stored it under the
--      day; parse.js never makes one). The answer: ok, touched (the days rebuilt), sent; or ok false, locked, refused
--      'month locked: YYYY-MM' (5.) storing nothing.
--      THE 8-ARGUMENT tally_ingest_day HERE SUPERSEDES 43's: the same day rules byte for byte in behaviour (the month lock
--      of 5. aside): the role check, the lock, the versions of the day's entries, the short read, the empty read (the
--      second consecutive empty read for a day with live entries, the cap of 10 pending days however old), tally_days
--      (empty_at, note, n never zeroed by a read that marked nothing), days_at and the answer; it marks the day's
--      entries not in the file BEFORE it hands the entries to tally_ingest_entries (43 marked after its upsert; the two
--      touch disjoint rows, and the live count decides only when the file has no entries), then rebuilds the day's cache
--      when tally_ingest_entries did not. The 7-argument wrapper of 41 stays as it is. tally_ledger_day_rebuild(book,
--      days) is the one text of the cache rebuild (internal: no grant).
--      tally_voucher_version_lines (37) is re-created with one change: besides the service role, it runs for an owner's
--      release of a held line (5.: the setting fincom.recorder_release, set only by tally_recorder_release_held, a
--      security definer function; the function stays ungranted to signed-in people). tally_ingest_entries and
--      tally_ingest_delete take the same.
--   2. tally_ingest_delete(p_book uuid, p_guid text, p_alter bigint, p_cancel boolean, p_source text) returns jsonb (service
--      role): one entry deleted in Tally (soft: deleted_at = now()) or cancelled (cancelled = true, NOT deleted). Its
--      versions get their lines first, its AlterID goes up to p_alter (a version row for it), the cache of its day is
--      rebuilt. An AlterID older than the one held: 'stale', nothing changes. An unknown GUID (or none): 'held', never an
--      error, never a new row. A month locked: 'held'. Answer {ok, state applied|stale|held, why, guid, day, action}.
--   3. tally_recorder_lines (RLS on, the firm reads its rows, nobody writes them directly): every line the add-on wrote and
--      a bridge sent, one row per ARRIVAL: id, firm, client, book, device, bridge, pc, tally_user, company_guid, company,
--      line_id (the PC's own number or hash), event (created|altered|deleted|cancelled|imported|ledger_created|
--      ledger_altered|ledger_renamed|ledger_deleted; anything else is kept as sent and 'failed'), object_guid, master_id,
--      alter_id, vch_type, vch_no, vch_date, saved_at (Tally's side), received_at, applied_at, state (received|applied|
--      duplicate|stale|held|failed), held_why (the words for every state but applied), ledgers (names + GUIDs touched, at
--      most 50), payload (the line as sent, cut to 8000 bytes), body (what applies it: vouchers, lines, name, from, to;
--      dropped from a duplicate), save_ms (the delay added to saving), released_at / released_by.
--      THE SAME CHANGE ONCE (owner items 26, 102): every arrival is a row (the same change from two PCs: two rows) and
--      a PARTIAL UNIQUE index on (book_id, object_guid, alter_id, event) over the APPLIED rows keeps it applied once; the
--      apply (under the book's lock) stores a second arrival 'duplicate' with the line it repeats. A line is also
--      'duplicate' when the copy already holds that entry, live, at that very AlterID (a day book read first: owner item
--      8). Indexes (firm_id, received_at desc), (book_id, state), (book_id, object_guid).
--   4. tally_recorder_apply(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb) returns jsonb (service role; at most
--      1000 lines a call): each line in order is stored, then applied in its own savepoint (a line that fails is 'failed'
--      with the database's words; the batch goes on): created / altered / imported -> tally_ingest_entries with the line's
--      vouchers (only the one whose guid is the line's object_guid; its day from the line's vch_date when it has none) and
--      lines, in the shape of the days path (tally-ingest makes them from the add-on's XML with parse.js); no body ->
--      'held' (the next day read applies it); no GUID -> 'held', never a new row; an older AlterID than held -> 'stale';
--      a FinCom posting coming back stamps tally_post_ids.matched_at / matched_vch (43's columns) for its FinCom id.
--      deleted / cancelled -> tally_ingest_delete. ledger_renamed -> tally_ledger_rename(book, guid, from, to), the
--      existing function (owner item 92: the entries follow the name); a refusal or a roll-back -> 'held' with its words.
--      ledger_created / ledger_altered -> 'held' with 'ledger lines applied by the next ledger list' (no SQL function
--      upserts one ledger: the ledger list's upsert is tally-ingest's applyLedgerList). ledger_deleted -> deleted_at set
--      through the guard of 34/36 (tally_ledgers_a_guard, the reason 'deleted in Tally (recorder line N)'); kept live by
--      the guard -> 'held' with tally_ledger_hold_reason's words; an unknown ledger -> 'held'. The month lock of 5. holds
--      entry lines (never ledger lines: a ledger has no month). Answer {ok, results: [{line_id, state, why}], applied,
--      held, duplicate, stale, failed}.
--   5. MONTH LOCKS. tally_month_locks (RLS; firm, client, book_id, month (the first of the month), locked_at, locked_by,
--      note, unlocked_at, unlocked_by; a lock is unlocked, never deleted; one live lock per book and month). The owner's
--      tally_month_lock(p_client, p_month, p_note) locks the month on every book of the client (the owner check of
--      tally_read_stop, migration 35; again: 'already'); tally_month_unlock(p_client, p_month, p_note) stamps unlocked_at
--      / unlocked_by; tally_recorder_release_held(p_line) applies a held line now (refused while its month is still
--      locked: it stays held, with the words; a ledger line is the ledger list's). THE RULE IS SHARED: tally_month_locked
--      (book, days) is read by tally_ingest_entries (so every path through it honours it), by tally_ingest_delete, and by
--      tally_ingest_day BEFORE it marks anything: a day of a locked month (or an entry moving in or out of one) stores
--      nothing and is answered refused 'month locked: YYYY-MM' (locked: true); an empty read the same.
--   6. TIE-OUTS. tally_tieouts (RLS; firm, client, book_id, month, receivables, payables, cash_bank, profit, tb_total (the
--      figures a person typed from Tally), fincom jsonb (FinCom's five figures at the time), saved_at / saved_by,
--      ticked_at, ticked_by, note; one row per client and month). tally_tieout_save(p_client, p_month, p_figures, p_fincom,
--      p_tick): a member who may write (owner or staff) saves (figures: numbers or null under those five names, and a
--      note); ticking or unticking (p_tick true / false) is the owner's; a ticked month's figures are changed by the owner
--      alone (doing so without ticking again clears the tick).
--   7. THE STARTING POINT (the owner's change of 04-Oct: reading is prospective; the bridge never reads old months).
--      tally_sync_cursor's unused last_voucher_alterid / last_master_alterid hold the bridge's starting point, with
--      start_guid / start_at / start_device (added): tally_start_point(p_firm, p_book, p_guid, p_altvch, p_altmst,
--      p_device, p_bridge) (service role; tally-ingest's kind "start_point") checks the GUID through tally_sync_guard as
--      today (another GUID: needs_baseline) and stores the point ONCE per book and company GUID: a later point, lower or
--      higher, never changes it; a new company GUID resets it.
--   8. FIXED search_path (the security audit): tally_fincom_id, tally_post_bool, tally_post_accept_text,
--      tally_post_id_match, tally_post_result_accepted, tally_post_result_taken, tally_post_result_confirmed,
--      tally_post_job_settle, tally_ledger_marks_frozen and tally_control_kept had none (checked on a database built in
--      staging's order): ALTER FUNCTION ... SET search_path = public, pg_temp, their text unchanged. (A later CREATE OR
--      REPLACE of any of them must carry the SET.) And the '%' fix: tally_device_post_settings' two batch-size RAISE texts
--      read '(% given)' (PL/pgSQL's placeholder is %; 43 had '%s', read "(600s given)"); the function otherwise as 43.
--   9. A PC WITHOUT THE ADD-ON (the owner, 04-Oct). tally_sync_cursor.recorder_max_alter / recorder_last_at: the highest
--      AlterID any PC's recorder line carried for the book (entry events with an AlterID; tally_recorder_apply, never
--      lowered); gap jsonb / gap_at / last_match_at. tally_recorder_gap_check(p_book, p_device, p_altvchid, p_at) (service
--      role; tally-ingest's beat, per company that carries altvchid): no starting point yet -> this number is it, no gap;
--      below the starting point -> needs_baseline as today (a restore), never a gap; else baseline = greatest(the starting
--      point, recorder_max_alter, the highest AlterID a day book read brought (tally_days.alter_max: an uploaded day closes
--      the gap too)); above it -> gap {tally_altvchid, recorder_max, day_max, start_point, missing (an UPPER bound: each
--      create, alter or delete raises ALTVCHID by at least one, so the changes missed are at most N: 'up to N changes not
--      received since <time>'; missingMax the same number under its plain name), since (the last match, else the
--      starting point's time), last_match_at, by_device {device: {max, lastAt}}, device, at, words}, gap_at the first time
--      seen; else the gap cleared and last_match_at = p_at. Never reads entries. tally_recorder_silent(p_firm) (members of
--      the firm, the app; no cron now): the computers whose beat says Tally was open today (IST) and whose last recorder
--      line is older than one working day (10 working hours, Mon-Sat 09:00-19:00 IST: tally_working_hours) ->
--      {silent: [{device, name, lastLineAt, tallyOpenAt, workingHours}]}.
--   Every function here: security definer, search_path = public, pg_temp; the service role's functions revoked from
--   public, anon and authenticated and granted to service_role; the owner's and members' granted to authenticated (the
--   checks are inside); the internal ones (tally_recorder_line, tally_ledger_day_rebuild, tally_month_locked) granted to
--   nobody. Every new table: RLS on, a read-only firm_id = my_firm() select policy, no insert / update / delete.

begin;

-- ---------------------------------------------------------------- A. tables
create table if not exists public.tally_recorder_lines (
  id            bigserial primary key,
  firm_id       uuid not null,
  client_id     text,
  book_id       uuid not null references public.tally_books(book_id) on delete cascade,
  device_id     uuid,
  bridge        text,
  pc            text,
  tally_user    text,
  company_guid  text,
  company       text,
  line_id       text,                                  -- the PC's own line number or hash
  event         text not null,                         -- created|altered|deleted|cancelled|imported|ledger_created|ledger_altered|ledger_renamed|ledger_deleted
  object_guid   text,
  master_id     text,
  alter_id      bigint,
  vch_type      text,
  vch_no        text,
  vch_date      date,
  saved_at      timestamptz,                           -- Tally's side
  received_at   timestamptz not null default now(),
  applied_at    timestamptz,
  state         text not null default 'received' check (state in ('received', 'applied', 'duplicate', 'stale', 'held', 'failed')),
  held_why      text,
  ledgers       jsonb,                                 -- [{name, guid}] touched, at most 50
  payload       jsonb,                                 -- the line as sent, cut to 8000 bytes
  body          jsonb,                                 -- what applies it: vouchers, lines, name, from, to
  save_ms       numeric,                               -- the delay the add-on added to saving
  released_at   timestamptz,
  released_by   uuid
);
-- the same change applied once (owner items 26, 102): every arrival is a row, only one of them applied
create unique index if not exists tally_recorder_lines_applied_once on public.tally_recorder_lines (book_id, object_guid, alter_id, event) where state = 'applied' and object_guid is not null;
create index if not exists tally_recorder_lines_firm on public.tally_recorder_lines (firm_id, received_at desc);
create index if not exists tally_recorder_lines_state on public.tally_recorder_lines (book_id, state);
create index if not exists tally_recorder_lines_guid on public.tally_recorder_lines (book_id, object_guid);

create table if not exists public.tally_month_locks (
  id           bigserial primary key,
  firm_id      uuid not null,
  client_id    text not null,
  book_id      uuid not null references public.tally_books(book_id) on delete cascade,
  month        date not null check (extract(day from month) = 1),
  locked_at    timestamptz not null default now(),
  locked_by    uuid,
  note         text not null default '',
  unlocked_at  timestamptz,
  unlocked_by  uuid
);
create unique index if not exists tally_month_locks_live on public.tally_month_locks (book_id, month) where unlocked_at is null;
create index if not exists tally_month_locks_firm on public.tally_month_locks (firm_id, client_id, month);

create table if not exists public.tally_tieouts (
  id           bigserial primary key,
  firm_id      uuid not null,
  client_id    text not null,
  book_id      uuid references public.tally_books(book_id) on delete set null,
  month        date not null check (extract(day from month) = 1),
  receivables  numeric,
  payables     numeric,
  cash_bank    numeric,
  profit       numeric,
  tb_total     numeric,
  fincom       jsonb,                                  -- FinCom's five figures at the time
  saved_at     timestamptz not null default now(),
  saved_by     uuid,
  ticked_at    timestamptz,
  ticked_by    uuid,
  note         text not null default '',
  unique (firm_id, client_id, month)
);

alter table public.tally_sync_cursor add column if not exists start_guid text;        -- 7. the company GUID the starting point is for
alter table public.tally_sync_cursor add column if not exists start_at timestamptz;
alter table public.tally_sync_cursor add column if not exists start_device uuid;
alter table public.tally_sync_cursor add column if not exists recorder_max_alter bigint;   -- 9. the highest AlterID any PC's recorder line carried (never lowered)
alter table public.tally_sync_cursor add column if not exists recorder_last_at timestamptz;
alter table public.tally_sync_cursor add column if not exists gap jsonb;                   -- 9. {tally_altvchid, recorder_max, day_max, start_point, missing / missingMax (up to: an upper bound), since, last_match_at, by_device, device, at, words}
alter table public.tally_sync_cursor add column if not exists gap_at timestamptz;          -- when the gap was first seen
alter table public.tally_sync_cursor add column if not exists last_match_at timestamptz;   -- the last check whose number the lines reached

-- the firm reads them; nobody writes them directly
alter table public.tally_recorder_lines enable row level security;
alter table public.tally_month_locks enable row level security;
alter table public.tally_tieouts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_recorder_lines' and policyname = 'tally_recorder_lines_read') then
    create policy tally_recorder_lines_read on public.tally_recorder_lines for select to authenticated using (firm_id = my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_month_locks' and policyname = 'tally_month_locks_read') then
    create policy tally_month_locks_read on public.tally_month_locks for select to authenticated using (firm_id = my_firm());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_tieouts' and policyname = 'tally_tieouts_read') then
    create policy tally_tieouts_read on public.tally_tieouts for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
grant select on public.tally_recorder_lines, public.tally_month_locks, public.tally_tieouts to authenticated;
revoke insert, update, delete, truncate on public.tally_recorder_lines, public.tally_month_locks, public.tally_tieouts from anon, authenticated;

-- ---------------------------------------------------------------- B. the shared pieces
-- the first locked month among these days of the book (null: none)
create or replace function public.tally_month_locked(p_book uuid, p_days date[]) returns date
language sql stable security definer set search_path = public, pg_temp as $function$
  select min(k.month) from tally_month_locks k
   where k.book_id = p_book and k.unlocked_at is null
     and k.month = any(array(select date_trunc('month', d)::date from unnest(p_days) d where d is not null))
$function$;

-- the ledger-day cache of these days, from live entries only (the one text: tally_ingest_entries, tally_ingest_day, tally_ingest_delete)
create or replace function public.tally_ledger_day_rebuild(p_book uuid, p_days date[]) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; n int;
begin
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  delete from tally_ledger_day t where t.book_id = p_book and t.day = any(p_days);
  insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n)
  select p_book, f, l.ledger, l.day, sum(l.amount), sum(case when l.amount < 0 then -l.amount else 0 end), sum(case when l.amount > 0 then l.amount else 0 end), count(*)
    from tally_lines l join tally_vouchers v on v.book_id = l.book_id and v.guid = l.guid
   where l.book_id = p_book and l.day = any(p_days) and v.deleted_at is null and not v.cancelled and not v.optional
   group by l.ledger, l.day;
  get diagnostics n = row_count;
  return n;
end $function$;

-- 37's text; the role check also lets an owner's release of a held line through (fincom.recorder_release, set by
-- tally_recorder_release_held alone; this function is granted to the service role only)
create or replace function public.tally_voucher_version_lines(p_book uuid, p_guids text[]) returns integer
language plpgsql security definer set search_path = public, pg_temp as $function$
declare n int;
begin
  if auth.role() <> 'service_role' and coalesce(current_setting('fincom.recorder_release', true), '') !~ '^[0-9]+$' then raise exception 'not allowed' using errcode = '42501'; end if;
  update tally_voucher_versions ver set lines = coalesce(x.lines, '[]'::jsonb)
    from tally_vouchers v
    left join lateral (
      select jsonb_agg(jsonb_build_array(l.ledger, l.amount, l.hsn, l.rate,
               coalesce((select jsonb_agg(jsonb_build_array(b.name, b.type, b.amount, b.credit_days) order by b.name, b.type, b.amount) from tally_bills b
                          where b.book_id = l.book_id and b.guid = l.guid and b.ledger = l.ledger), '[]'::jsonb)) order by l.ledger, l.amount) as lines
        from tally_lines l where l.book_id = v.book_id and l.guid = v.guid) x on true
   where v.book_id = p_book and v.guid = any(p_guids)
     and ver.book_id = v.book_id and ver.tally_guid = v.guid and ver.alter_id = coalesce(v.alter_id, 0) and ver.lines is null;
  get diagnostics n = row_count;
  return n;
end $function$;

-- ---------------------------------------------------------------- 1. one entry path
create or replace function public.tally_ingest_entries(p_book uuid, p_vouchers jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; sent text[]; touched date[]; lk date;
begin
  if auth.role() <> 'service_role' and coalesce(current_setting('fincom.recorder_release', true), '') !~ '^[0-9]+$' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  select coalesce(array_agg(distinct x->>'guid'), '{}') into sent from jsonb_array_elements(p_vouchers) x where coalesce(x->>'guid', '') <> '';
  if exists (select 1 from jsonb_array_elements(p_vouchers) x where tally_d8(replace(coalesce(x->>'day', ''), '-', '')) is null) then
    raise exception 'an entry without its date (%)', (select x->>'guid' from jsonb_array_elements(p_vouchers) x where tally_d8(replace(coalesce(x->>'day', ''), '-', '')) is null limit 1);
  end if;
  -- the days touched: the ones the entries have now and the ones they had
  select coalesce(array_agg(distinct d), '{}') into touched from (
    select tally_d8(replace(x->>'day', '-', '')) as d from jsonb_array_elements(p_vouchers) x where coalesce(x->>'guid', '') <> ''
    union select v.day from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  ) q;
  -- 5. a locked month: nothing stored
  lk := tally_month_locked(p_book, touched);
  if lk is not null then
    return jsonb_build_object('ok', false, 'locked', true, 'month', to_char(lk, 'YYYY-MM'), 'refused', format('month locked: %s', to_char(lk, 'YYYY-MM')), 'sent', 0, 'touched', '[]'::jsonb);
  end if;
  -- the lines these entries hold now go on their current version rows before anything is replaced
  perform tally_voucher_version_lines(p_book, sent);
  -- inserted, or brought up to date in place (deleted_at cleared); a version row for each AlterID
  insert into tally_vouchers (book_id, firm_id, guid, day, alter_id, vtype, vno, party, narration, cancelled, optional, gstin, pos, ref, ref_date, cmp_gstin, fincom_id, deleted_at)
  select distinct on (x->>'guid') p_book, f, x->>'guid', tally_d8(replace(x->>'day', '-', '')), coalesce((x->>'alter')::bigint, 0), coalesce(x->>'type', ''), coalesce(x->>'no', ''),
         tally_nm(x->>'party'), left(coalesce(x->>'narr', ''), 300), coalesce((x->>'cancel')::boolean, false), coalesce((x->>'opt')::boolean, false),
         left(upper(coalesce(x->>'gstin', '')), 15), left(coalesce(x->>'pos', ''), 60),
         left(coalesce(x->>'ref', ''), 60), tally_d8(x->>'refDate'), left(upper(coalesce(x->>'cmp', '')), 15),
         case when coalesce(x->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then x->>'fid' end, null
    from jsonb_array_elements(p_vouchers) x
   where coalesce(x->>'guid', '') <> ''
   order by x->>'guid', coalesce((x->>'alter')::bigint, 0) desc
  on conflict (book_id, guid) do update set
     day = excluded.day, alter_id = excluded.alter_id, vtype = excluded.vtype, vno = excluded.vno, party = excluded.party, narration = excluded.narration,
     cancelled = excluded.cancelled, optional = excluded.optional, gstin = excluded.gstin, pos = excluded.pos, ref = excluded.ref, ref_date = excluded.ref_date,
     cmp_gstin = excluded.cmp_gstin, deleted_at = null,
     fincom_id = coalesce(excluded.fincom_id, substring(excluded.narration from 'TDSDesk:([A-Za-z0-9._-]+)'), tally_vouchers.fincom_id),
     origin = case when excluded.fincom_id is not null or excluded.narration ~ 'TDSDesk:[A-Za-z0-9]' then 'fincom' else tally_vouchers.origin end;
  insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload)
  select v.book_id, v.firm_id, v.guid, coalesce(v.alter_id, 0), to_jsonb(v) from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  on conflict (book_id, tally_guid, alter_id) do nothing;
  -- a re-sent entry's lines and bills are replaced (its old ones are on its old version row); each under its entry's day
  delete from tally_bills b where b.book_id = p_book and b.guid = any(sent);
  delete from tally_lines l where l.book_id = p_book and l.guid = any(sent);
  insert into tally_lines (book_id, firm_id, guid, day, ledger, amount, hsn, rate)
  select p_book, f, x->>0, v.day, tally_nm(x->>1), (x->>2)::numeric, left(coalesce(x->>3, ''), 20), nullif(x->>4, '')::numeric
    from jsonb_array_elements(p_lines) x join tally_vouchers v on v.book_id = p_book and v.guid = x->>0
   where v.guid = any(sent);
  insert into tally_bills (book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due)
  select p_book, f, x->>0, v.day, tally_nm(x->>1), left(coalesce(b->>0, ''), 200), left(coalesce(b->>1, ''), 20), (b->>2)::numeric,
         case when b->>1 in ('New Ref', 'Advance') then v.day end,
         nullif(b->>3, '')::integer,
         case when b->>1 = 'New Ref' and nullif(b->>3, '') is not null then v.day + (b->>3)::integer end
    from jsonb_array_elements(p_lines) x join tally_vouchers v on v.book_id = p_book and v.guid = x->>0,
         jsonb_array_elements(case when jsonb_typeof(x->5) = 'array' then x->5 else '[]'::jsonb end) b
   where v.guid = any(sent) and coalesce(b->>2, '') <> '';
  perform tally_voucher_version_lines(p_book, sent);
  -- the day cache, from live entries only
  perform tally_ledger_day_rebuild(p_book, touched);
  return jsonb_build_object('ok', true, 'touched', to_jsonb(touched), 'sent', coalesce(array_length(sent, 1), 0));
end $function$;
revoke all on function public.tally_ingest_entries(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tally_ingest_entries(uuid, jsonb, jsonb) to service_role;

-- 43's tally_ingest_day: the same day rules; the entries through tally_ingest_entries; a locked month stores nothing
create or replace function public.tally_ingest_day(p_book uuid, p_day date, p_vouchers jsonb, p_lines jsonb, p_n integer, p_alter bigint, p_bytes integer, p_empty boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare touched date[]; f uuid; sent text[]; marked int := 0; n_in int := case when jsonb_typeof(p_vouchers) = 'array' then jsonb_array_length(p_vouchers) else 0 end; short text; emptied boolean := false; live_n int; prev_empty timestamptz; d_empty timestamptz; d_note text; pend int; capped boolean := false; lk date; ent jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  select coalesce(array_agg(distinct x->>'guid'), '{}') into sent from jsonb_array_elements(p_vouchers) x where coalesce(x->>'guid', '') <> '';
  select array_agg(distinct d) into touched from (
    select p_day as d
    union select v.day from tally_vouchers v where v.book_id = p_book and v.guid = any(sent)
  ) q;
  -- migration 44: a day of a locked month (or an entry moving out of one) stores nothing: no entry, no mark, no record
  lk := tally_month_locked(p_book, touched);
  if lk is not null then
    return jsonb_build_object('ok', true, 'day', p_day, 'touched', '[]'::jsonb, 'marked', 0, 'sent', 0, 'locked', true,
      'refused', format('month locked: %s (locked by the owner; nothing stored, nothing marked)', to_char(lk, 'YYYY-MM')));
  end if;
  -- 8: the lines these entries hold now go on their current version rows before anything is replaced
  perform tally_voucher_version_lines(p_book, array(select v.guid from tally_vouchers v where v.book_id = p_book and (v.day = p_day or v.guid = any(sent))));
  -- the day's entries not in the file: marked, kept (lines and bills kept too) - but NEVER on a short read (migration 38,
  -- item 9): a file with no entries, or fewer than the bridge counted for the day (p_n), upserts what came and marks
  -- nothing; the answer says refused: 'short read: n of p_n' and tally-ingest logs it. Migration 44: marked before the
  -- entries are taken (the marked rows are never the file's), the cache of the day rebuilt after both
  select d.empty_at into prev_empty from tally_days d where d.book_id = p_book and d.day = p_day;
  select count(*) into live_n from tally_vouchers v where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
  if n_in = 0 and coalesce(p_n, 0) = 0 and p_empty is true then
    -- migration 39: the bridge positively read the day and Tally listed no entries. Migration 42: a day that still has
    -- live entries is emptied only on the SECOND consecutive empty read (the first is recorded in tally_days.empty_at
    -- and refused); a day with no live entries has nothing to mark and is recorded as empty at once. Decided by
    -- empty_at and the live count alone, never by tally_days.n. A later file with entries un-marks them and clears the record
    -- the cap (migration 43): the book's days still PENDING a second empty read, however old (a first empty read never
    -- confirmed), plus the days an empty read MARKED in the last 24 hours; days with nothing to mark never count
    select count(*) into pend from tally_days d where d.book_id = p_book and d.empty_at is not null
       and (d.note like 'empty day with%' or (d.empty_at >= now() - interval '24 hours' and d.note ~ '^\d+ entries marked deleted on the second empty read'));
    if live_n = 0 then
      emptied := true; d_empty := now(); d_note := 'empty day, nothing to mark';
    elsif pend >= 10 then
      short := format('%s days of this book read empty within 24 hours: a read fault; this day is not emptied and not recorded; nothing marked', pend);
      capped := true;
    elsif prev_empty is null then
      short := format('empty day with %s live entries: confirm by a second empty read', live_n);
      d_empty := now(); d_note := short;
    else
      update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null;
      get diagnostics marked = row_count; emptied := true;
      d_empty := now(); d_note := format('%s entries marked deleted on the second empty read (the first at %s)', marked, to_char(prev_empty at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS "UTC"'));
    end if;
  elsif n_in = 0 or n_in < coalesce(p_n, 0) then
    short := format('short read: %s of %s', n_in, coalesce(p_n, 0));
  else
    update tally_vouchers v set deleted_at = now() where v.book_id = p_book and v.day = p_day and v.deleted_at is null and not (v.guid = any(sent));
    get diagnostics marked = row_count;
  end if;
  -- the entries in the file, each dated the day: the one entry path (owner item 95), which replaces their lines and
  -- bills and rebuilds the cache of the days they had and have
  ent := tally_ingest_entries(p_book, (select coalesce(jsonb_agg(x || jsonb_build_object('day', p_day) order by o), '[]'::jsonb) from jsonb_array_elements(p_vouchers) with ordinality as t(x, o)), p_lines);
  if not (p_day = any(array(select jsonb_array_elements_text(coalesce(ent->'touched', '[]'::jsonb))::date))) then perform tally_ledger_day_rebuild(p_book, array[p_day]); end if;
  -- the day's bookkeeping. An empty read is recorded (empty_at, note); a file with entries clears the record. Migration 42:
  -- an empty file that marked nothing (a refused first empty read, a short read) keeps the n the day had, so the day's
  -- count is never zeroed by a read that changed nothing
  insert into tally_days (book_id, firm_id, day, n, alter_max, bytes, at, empty_at, note) values (p_book, f, p_day, p_n, p_alter, p_bytes, now(), d_empty, d_note)
  on conflict (book_id, day) do update set
     n = case when n_in = 0 and not emptied then tally_days.n else excluded.n end,
     alter_max = excluded.alter_max, bytes = excluded.bytes, at = now(),
     empty_at = case when n_in > 0 then null else coalesce(excluded.empty_at, tally_days.empty_at) end,
     note = case when n_in > 0 then null else coalesce(excluded.note, tally_days.note) end;
  update tally_books set days_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'day', p_day, 'touched', to_jsonb(touched), 'marked', marked, 'sent', coalesce(array_length(sent, 1), 0)) || case when short is null then '{}'::jsonb else jsonb_build_object('refused', short) end || case when emptied then jsonb_build_object('empty', true) else '{}'::jsonb end || case when d_empty is not null and not emptied then jsonb_build_object('emptyPending', true) else '{}'::jsonb end || case when capped then jsonb_build_object('emptyCapped', true) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) from public, anon, authenticated;
grant execute on function public.tally_ingest_day(uuid, date, jsonb, jsonb, integer, bigint, integer, boolean) to service_role;

-- ---------------------------------------------------------------- 2. one entry deleted or cancelled in Tally
create or replace function public.tally_ingest_delete(p_book uuid, p_guid text, p_alter bigint, p_cancel boolean, p_source text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); act text := case when p_cancel then 'cancelled' else 'deleted' end;
  src text := left(coalesce(p_source, ''), 80); v_day date; v_alter bigint; v_del timestamptz; v_can boolean; lk date;
begin
  if auth.role() <> 'service_role' and coalesce(current_setting('fincom.recorder_release', true), '') !~ '^[0-9]+$' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if g is null then return jsonb_build_object('ok', true, 'state', 'held', 'why', 'no entry GUID: nothing ' || act, 'action', act); end if;
  select v.day, coalesce(v.alter_id, 0), v.deleted_at, v.cancelled into v_day, v_alter, v_del, v_can from tally_vouchers v where v.book_id = p_book and v.guid = g;
  if not found then
    return jsonb_build_object('ok', true, 'state', 'held', 'guid', g, 'action', act, 'why', 'unknown entry: not in the copy (the next day read decides)');
  end if;
  lk := tally_month_locked(p_book, array[v_day]);
  if lk is not null then
    return jsonb_build_object('ok', true, 'state', 'held', 'guid', g, 'day', v_day, 'action', act, 'locked', true, 'why', format('month locked: %s', to_char(lk, 'YYYY-MM')));
  end if;
  if p_alter is not null and p_alter < v_alter then
    return jsonb_build_object('ok', true, 'state', 'stale', 'guid', g, 'day', v_day, 'action', act, 'why', format('AlterID %s is older than the %s held: not %s', p_alter, v_alter, act));
  end if;
  if (p_cancel and v_can) or (not coalesce(p_cancel, false) and v_del is not null) then
    return jsonb_build_object('ok', true, 'state', 'applied', 'guid', g, 'day', v_day, 'action', act, 'already', true, 'why', 'already ' || act);
  end if;
  -- the versions first: the lines it holds now go on its current version row
  perform tally_voucher_version_lines(p_book, array[g]);
  update tally_vouchers set cancelled = case when p_cancel then true else cancelled end,
         deleted_at = case when p_cancel then deleted_at else now() end,
         alter_id = greatest(coalesce(alter_id, 0), coalesce(p_alter, 0))
   where book_id = p_book and guid = g;
  insert into tally_voucher_versions (book_id, firm_id, tally_guid, alter_id, payload)
  select v.book_id, v.firm_id, v.guid, coalesce(v.alter_id, 0), to_jsonb(v) from tally_vouchers v where v.book_id = p_book and v.guid = g
  on conflict (book_id, tally_guid, alter_id) do nothing;
  perform tally_voucher_version_lines(p_book, array[g]);
  perform tally_ledger_day_rebuild(p_book, array[v_day]);
  return jsonb_build_object('ok', true, 'state', 'applied', 'guid', g, 'day', v_day, 'action', act, 'source', src);
end $function$;
revoke all on function public.tally_ingest_delete(uuid, text, bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.tally_ingest_delete(uuid, text, bigint, boolean, text) to service_role;

-- ---------------------------------------------------------------- 4. the recorder's lines
-- one line: stored (p_row null) or taken again (an owner's release, p_row its id), then applied in its own savepoint.
-- Internal: granted to nobody (tally_recorder_apply and tally_recorder_release_held call it)
create or replace function public.tally_recorder_line(p_book uuid, p_device uuid, p_line jsonb, p_row bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; rid bigint := p_row; ev text := left(btrim(coalesce(p_line->>'event', '')), 40);
  og text := nullif(left(btrim(coalesce(p_line->>'object_guid', '')), 100), '');
  alt bigint := case when coalesce(p_line->>'alter_id', '') ~ '^[0-9]{1,18}$' then (p_line->>'alter_id')::bigint end;
  vd date := tally_d8(replace(coalesce(p_line->>'vch_date', ''), '-', ''));
  sa timestamptz; pl jsonb; pltxt text; bd jsonb; stt text; wy text; t text; res jsonb; vs jsonb; lk date;
  c_found boolean := false; c_alter bigint; c_day date; c_del timestamptz; c_fid text;
  frm text; dst text; l_name text; l_del timestamptz;
  known constant text[] := array['created', 'altered', 'deleted', 'cancelled', 'imported', 'ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted'];
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
  if rid is null then
    begin sa := (p_line->>'saved_at')::timestamptz; exception when others then sa := null; end;
    pl := coalesce(p_line->'payload', p_line - 'vouchers' - 'lines'); pltxt := pl::text;
    if length(pltxt) > 8000 then pl := jsonb_build_object('cut', true, 'bytes', length(pltxt), 'head', left(pltxt, 8000)); end if;
    bd := jsonb_strip_nulls(jsonb_build_object('vouchers', case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' end,
            'lines', case when jsonb_typeof(p_line->'lines') = 'array' then p_line->'lines' end,
            'name', left(p_line->>'name', 300), 'from', left(p_line->>'from', 300), 'to', left(p_line->>'to', 300)));
    insert into tally_recorder_lines (firm_id, client_id, book_id, device_id, bridge, pc, tally_user, company_guid, company, line_id, event, object_guid, master_id, alter_id,
                                      vch_type, vch_no, vch_date, saved_at, state, ledgers, payload, body, save_ms)
    values (b.firm_id, b.client_id, p_book, p_device, left(p_line->>'bridge', 80), left(p_line->>'pc', 60), left(p_line->>'user', 60), left(p_line->>'company_guid', 100), left(p_line->>'company', 200),
            left(p_line->>'line_id', 80), ev, og, left(p_line->>'master_id', 40), alt, left(p_line->>'vch_type', 60), left(p_line->>'vch_no', 60), vd, sa, 'received',
            case when jsonb_typeof(p_line->'ledgers') = 'array' then (select jsonb_agg(e) from (select e from jsonb_array_elements(p_line->'ledgers') e limit 50) s) end,
            pl, bd, case when coalesce(p_line->>'save_ms', '') ~ '^[0-9]{1,9}(\.[0-9]{1,3})?$' then (p_line->>'save_ms')::numeric end)
    returning id into rid;
  end if;
  begin
    if not (ev = any(known)) then
      stt := 'failed'; wy := 'unknown event: ' || ev;
    elsif og is null and ev <> 'ledger_renamed' then
      stt := 'held'; wy := 'no GUID on the line: held, never a new row';
    end if;
    -- the same change already here: another arrival applied or held (owner items 26, 102)
    if stt is null and og is not null then
      select 'line ' || r.id || ' (' || r.state || coalesce(', from ' || nullif(r.pc, ''), '') || ')' into t from tally_recorder_lines r
       where r.book_id = p_book and r.object_guid = og and r.alter_id is not distinct from alt and r.event = ev and r.state in ('applied', 'held') and r.id <> rid order by r.id limit 1;
      if t is not null then stt := 'duplicate'; wy := 'the same change already came as ' || t; end if;
    end if;
    if stt is null and ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') then
      select true, coalesce(v.alter_id, 0), v.day, v.deleted_at into c_found, c_alter, c_day, c_del from tally_vouchers v where v.book_id = p_book and v.guid = og;
      c_found := coalesce(c_found, false);
      if ev in ('deleted', 'cancelled') then
        res := tally_ingest_delete(p_book, og, alt, ev = 'cancelled', 'recorder ' || coalesce(left(p_line->>'pc', 60), ''));
        stt := res->>'state'; wy := res->>'why';
      else
        -- the entry's body: the voucher of this GUID alone, dated by the line when it has no date of its own
        select coalesce(jsonb_agg(case when tally_d8(replace(coalesce(x->>'day', ''), '-', '')) is null then x || jsonb_build_object('day', vd) else x end), '[]'::jsonb) into vs
          from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where x->>'guid' = og;
        lk := tally_month_locked(p_book, array(select tally_d8(replace(coalesce(x->>'day', ''), '-', '')) from jsonb_array_elements(vs) x) || array[c_day, vd]);
        if lk is not null then
          stt := 'held'; wy := format('month locked: %s', to_char(lk, 'YYYY-MM'));
        elsif c_found and alt is not null and alt < c_alter then
          stt := 'stale'; wy := format('AlterID %s is older than the %s held', alt, c_alter);
        elsif c_found and alt is not null and alt = c_alter and c_del is null then
          stt := 'duplicate'; wy := format('the copy holds this entry at AlterID %s already (a day read or another line)', alt);
        elsif jsonb_array_length(vs) = 0 then
          stt := 'held'; wy := 'no entry body on the line: the next day read applies it';
        else
          res := tally_ingest_entries(p_book, vs, p_line->'lines');
          if coalesce((res->>'locked')::boolean, false) then stt := 'held'; wy := res->>'refused';
          else
            stt := 'applied';
            -- a FinCom posting coming back: matched by its FinCom id (43's columns)
            select v.fincom_id into c_fid from tally_vouchers v where v.book_id = p_book and v.guid = og;
            if c_fid is not null then
              update tally_post_ids p set matched_at = coalesce(p.matched_at, now()), matched_vch = coalesce(nullif(left(p_line->>'vch_no', 60), ''), p.matched_vch)
               where p.firm_id = b.firm_id and p.fincom_id = c_fid;
              wy := format('FinCom posting %s matched', c_fid);
            end if;
          end if;
        end if;
      end if;
    elsif stt is null and ev = 'ledger_renamed' then
      frm := left(btrim(coalesce(p_line->>'from', '')), 300); dst := left(btrim(coalesce(p_line->>'to', '')), 300);
      if dst = '' then stt := 'failed'; wy := 'a rename without the new name';
      elsif coalesce(current_setting('fincom.recorder_release', true), '') ~ '^[0-9]+$' then stt := 'held'; wy := 'a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it';
      else
        begin
          res := tally_ledger_rename(p_book, og, frm, dst);
          if coalesce((res->>'renamed')::boolean, false) or coalesce((res->>'merged')::boolean, false) then stt := 'applied'; wy := res->>'note';
          elsif res->>'note' = 'already named so' then stt := 'applied'; wy := 'already named so';
          else stt := 'held'; wy := coalesce(res->>'note', 'not renamed');
          end if;
        exception when others then stt := 'held'; wy := left('rename not made: ' || sqlerrm, 300);
        end;
      end if;
    elsif stt is null and ev in ('ledger_created', 'ledger_altered') then
      stt := 'held'; wy := 'ledger lines applied by the next ledger list';
    elsif stt is null and ev = 'ledger_deleted' then
      select l.name, l.deleted_at into l_name, l_del from tally_ledgers l where l.book_id = p_book and l.tally_guid = og order by (l.deleted_at is null) desc limit 1;
      if l_name is null then stt := 'held'; wy := 'unknown ledger: not in the copy';
      elsif l_del is not null then stt := 'applied'; wy := 'already marked deleted';
      else
        perform set_config('fincom.ledger_list', jsonb_build_object('reason', format('deleted in Tally (recorder line %s)', rid),
          'list', jsonb_build_object('source', 'recorder', 'at', now(), 'device', p_device, 'bridge', left(p_line->>'bridge', 80), 'line', rid))::text, true);
        update tally_ledgers set deleted_at = now() where book_id = p_book and name = l_name;
        perform set_config('fincom.ledger_list', '', true);
        if exists (select 1 from tally_ledgers where book_id = p_book and name = l_name and deleted_at is null) then
          select 'kept by the guard: ' || coalesce(tally_ledger_hold_reason(l), 'unknown reason') into wy from tally_ledgers l where l.book_id = p_book and l.name = l_name;
          stt := 'held';
        else stt := 'applied'; end if;
      end if;
    end if;
  exception when others then
    stt := 'failed'; wy := left(sqlerrm, 300);
  end;
  update tally_recorder_lines set state = stt, held_why = wy,
         applied_at = case when stt = 'applied' then now() else applied_at end,
         body = case when stt = 'duplicate' then null else body end
   where id = rid;
  return jsonb_build_object('id', rid, 'line_id', p_line->>'line_id', 'state', stt, 'why', wy);
end $function$;
revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint) from public, anon, authenticated;

create or replace function public.tally_recorder_apply(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare x jsonb; res jsonb := '[]'::jsonb; one jsonb; mx bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  if p_device is not null and not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = p_firm) then raise exception 'not a computer of this firm'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'the lines must be a list'; end if;
  if jsonb_array_length(p_lines) > 1000 then raise exception 'at most 1000 lines a call (% given)', jsonb_array_length(p_lines); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  for x in select e from jsonb_array_elements(p_lines) with ordinality as t(e, o) order by o loop
    if jsonb_typeof(x) is distinct from 'object' then
      res := res || jsonb_build_array(jsonb_build_object('line_id', null, 'state', 'failed', 'why', 'not a line'));
      continue;
    end if;
    one := tally_recorder_line(p_book, p_device, x, null);
    res := res || jsonb_build_array(one - 'id');
  end loop;
  -- 9. the highest change number received from every PC's lines (entry events with an AlterID), never lowered
  select max(case when coalesce(e->>'alter_id', '') ~ '^[0-9]{1,18}$' then (e->>'alter_id')::bigint end) into mx from jsonb_array_elements(p_lines) e
   where jsonb_typeof(e) = 'object' and e->>'event' in ('created', 'altered', 'deleted', 'cancelled', 'imported') and coalesce(e->>'object_guid', '') <> '';
  if mx is not null then
    insert into tally_sync_cursor (book_id, firm_id) values (p_book, p_firm) on conflict (book_id) do nothing;
    update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), mx), recorder_last_at = now(), updated_at = now() where book_id = p_book;
  end if;
  return jsonb_build_object('ok', true, 'results', res,
    'applied', (select count(*) from jsonb_array_elements(res) r where r->>'state' = 'applied'),
    'held', (select count(*) from jsonb_array_elements(res) r where r->>'state' = 'held'),
    'duplicate', (select count(*) from jsonb_array_elements(res) r where r->>'state' = 'duplicate'),
    'stale', (select count(*) from jsonb_array_elements(res) r where r->>'state' = 'stale'),
    'failed', (select count(*) from jsonb_array_elements(res) r where r->>'state' = 'failed'));
end $function$;
revoke all on function public.tally_recorder_apply(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_recorder_apply(uuid, uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------- 5. month locks (the owner's)
create or replace function public.tally_month_lock(p_client text, p_month date, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); m date := date_trunc('month', p_month)::date; n int := 0; had int := 0; bk uuid;
begin
  if f is null or not exists (select 1 from members x where x.user_id = auth.uid() and x.firm_id = f and x.role = 'owner' and coalesce(x.active, true))
    then raise exception 'only an owner of the firm can lock a month' using errcode = '42501'; end if;
  if m is null then raise exception 'which month?'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_month_locks:' || f::text));
  for bk in select b.book_id from tally_books b where b.firm_id = f and b.client_id = p_client loop
    if exists (select 1 from tally_month_locks k where k.book_id = bk and k.month = m and k.unlocked_at is null) then had := had + 1;
    else
      insert into tally_month_locks (firm_id, client_id, book_id, month, locked_by, note) values (f, p_client, bk, m, auth.uid(), left(btrim(coalesce(p_note, '')), 300));
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'month', to_char(m, 'YYYY-MM'), 'books', n + had, 'locked', n, 'already', n = 0 and had > 0);
end $function$;

create or replace function public.tally_month_unlock(p_client text, p_month date, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); m date := date_trunc('month', p_month)::date; n int;
begin
  if f is null or not exists (select 1 from members x where x.user_id = auth.uid() and x.firm_id = f and x.role = 'owner' and coalesce(x.active, true))
    then raise exception 'only an owner of the firm can unlock a month' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_month_locks:' || f::text));
  -- unlocked, never deleted
  update tally_month_locks k set unlocked_at = now(), unlocked_by = auth.uid(),
         note = left(k.note || case when btrim(coalesce(p_note, '')) <> '' then ' | unlocked: ' || btrim(p_note) else '' end, 1000)
   where k.firm_id = f and k.client_id = p_client and k.month = m and k.unlocked_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'month', to_char(m, 'YYYY-MM'), 'unlocked', n);
end $function$;

-- an owner applies a held line now (its month unlocked first); a ledger line is the ledger list's
create or replace function public.tally_recorder_release_held(p_line bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); r tally_recorder_lines%rowtype; one jsonb;
begin
  if f is null or not exists (select 1 from members x where x.user_id = auth.uid() and x.firm_id = f and x.role = 'owner' and coalesce(x.active, true))
    then raise exception 'only an owner of the firm can release a held line' using errcode = '42501'; end if;
  select * into r from tally_recorder_lines where id = p_line and firm_id = f;
  if r.id is null then raise exception 'not a line of your firm'; end if;
  if r.state <> 'held' then raise exception 'line % is %, not held', p_line, r.state; end if;
  if r.event in ('ledger_created', 'ledger_altered', 'ledger_renamed') then
    return jsonb_build_object('ok', false, 'id', p_line, 'line_id', r.line_id, 'state', 'held', 'why', 'a ledger line is applied by the bridge''s next ledger list, not by a release');
  end if;
  perform pg_advisory_xact_lock(hashtext(r.book_id::text));
  perform set_config('fincom.recorder_release', p_line::text, true);
  one := tally_recorder_line(r.book_id, r.device_id, jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id,
           'vch_date', r.vch_date, 'vch_no', r.vch_no, 'pc', r.pc, 'bridge', r.bridge) || coalesce(r.body, '{}'::jsonb), p_line);
  perform set_config('fincom.recorder_release', '', true);
  update tally_recorder_lines set released_at = now(), released_by = auth.uid() where id = p_line;
  return jsonb_build_object('ok', true) || one;
end $function$;
revoke all on function public.tally_month_lock(text, date, text), public.tally_month_unlock(text, date, text), public.tally_recorder_release_held(bigint) from public, anon;
grant execute on function public.tally_month_lock(text, date, text), public.tally_month_unlock(text, date, text), public.tally_recorder_release_held(bigint) to authenticated;
revoke all on function public.tally_month_locked(uuid, date[]), public.tally_ledger_day_rebuild(uuid, date[]) from public, anon, authenticated;
revoke all on function public.tally_voucher_version_lines(uuid, text[]) from public, anon, authenticated;
grant execute on function public.tally_voucher_version_lines(uuid, text[]) to service_role;

-- ---------------------------------------------------------------- 6. tie-outs
create or replace function public.tally_tieout_save(p_client text, p_month date, p_figures jsonb, p_fincom jsonb, p_tick boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); m date := date_trunc('month', p_month)::date; is_owner boolean; fig jsonb := coalesce(p_figures, '{}'::jsonb); k text; bk uuid; t tally_tieouts%rowtype; changed boolean;
begin
  if f is null or not exists (select 1 from members x where x.user_id = auth.uid() and x.firm_id = f and x.role in ('owner', 'staff') and coalesce(x.active, true))
    then raise exception 'only a member of the firm who may write can save a tie-out' using errcode = '42501'; end if;
  is_owner := exists (select 1 from members x where x.user_id = auth.uid() and x.firm_id = f and x.role = 'owner' and coalesce(x.active, true));
  if p_tick is not null and not is_owner then raise exception 'only an owner of the firm can tick a tie-out' using errcode = '42501'; end if;
  if m is null then raise exception 'which month?'; end if;
  if not exists (select 1 from clients c where c.firm_id = f and c.id = p_client) then raise exception 'no such client'; end if;
  if jsonb_typeof(fig) <> 'object' then raise exception 'the figures must be an object: receivables, payables, cash_bank, profit, tb_total'; end if;
  for k in select jsonb_object_keys(fig) loop
    if k = 'note' then
      if jsonb_typeof(fig->k) not in ('string', 'null') then raise exception 'the note must be words'; end if;
    elsif k not in ('receivables', 'payables', 'cash_bank', 'profit', 'tb_total') then raise exception 'not a figure of a tie-out: %', k;
    elsif jsonb_typeof(fig->k) not in ('number', 'null') then raise exception 'the figure % must be a number', k;
    end if;
  end loop;
  if p_fincom is not null and (jsonb_typeof(p_fincom) <> 'object' or length(p_fincom::text) > 4000) then raise exception 'FinCom''s figures must be an object (at most 4000 bytes)'; end if;
  changed := fig <> '{}'::jsonb;
  bk := tally_pick(p_client, (m + interval '1 month' - interval '1 day')::date);
  perform pg_advisory_xact_lock(hashtext('tally_tieouts:' || f::text || ':' || p_client));
  select * into t from tally_tieouts x where x.firm_id = f and x.client_id = p_client and x.month = m;
  if t.id is not null and t.ticked_at is not null and changed and not is_owner then
    raise exception 'this month is ticked by the owner; its figures change only after the owner unticks it' using errcode = '42501';
  end if;
  insert into tally_tieouts (firm_id, client_id, book_id, month, receivables, payables, cash_bank, profit, tb_total, fincom, saved_at, saved_by, note)
  values (f, p_client, bk, m, (fig->>'receivables')::numeric, (fig->>'payables')::numeric, (fig->>'cash_bank')::numeric, (fig->>'profit')::numeric, (fig->>'tb_total')::numeric,
          p_fincom, now(), auth.uid(), left(coalesce(fig->>'note', ''), 300))
  on conflict (firm_id, client_id, month) do update set
     receivables = case when fig ? 'receivables' then excluded.receivables else tally_tieouts.receivables end,
     payables = case when fig ? 'payables' then excluded.payables else tally_tieouts.payables end,
     cash_bank = case when fig ? 'cash_bank' then excluded.cash_bank else tally_tieouts.cash_bank end,
     profit = case when fig ? 'profit' then excluded.profit else tally_tieouts.profit end,
     tb_total = case when fig ? 'tb_total' then excluded.tb_total else tally_tieouts.tb_total end,
     note = case when fig ? 'note' then excluded.note else tally_tieouts.note end,
     fincom = coalesce(excluded.fincom, tally_tieouts.fincom), book_id = coalesce(excluded.book_id, tally_tieouts.book_id),
     saved_at = now(), saved_by = auth.uid();
  -- the tick: the owner's; figures changed without ticking again clear it
  update tally_tieouts x set
     ticked_at = case when p_tick is true then now() when p_tick is false then null when changed then null else x.ticked_at end,
     ticked_by = case when p_tick is true then auth.uid() when p_tick is false then null when changed then null else x.ticked_by end
   where x.firm_id = f and x.client_id = p_client and x.month = m;
  select * into t from tally_tieouts x where x.firm_id = f and x.client_id = p_client and x.month = m;
  return jsonb_build_object('ok', true) || to_jsonb(t);
end $function$;
revoke all on function public.tally_tieout_save(text, date, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.tally_tieout_save(text, date, jsonb, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------- 7. the starting point
create or replace function public.tally_start_point(p_firm uuid, p_book uuid, p_guid text, p_altvch bigint, p_altmst bigint, p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); c tally_sync_cursor%rowtype; done boolean := false;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_altvch is null or p_altvch < 0 or (p_altmst is not null and p_altmst < 0) then raise exception 'the starting point needs the highest voucher AlterID (0 or more)'; end if;
  -- the GUID as today: another company GUID marks the book needs_baseline (tally_sync_guard, migration 32)
  perform tally_sync_guard(p_firm, p_book, g, null, null, p_device, p_bridge);
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  select * into c from tally_sync_cursor where book_id = p_book;
  -- once per book and company GUID: a later point (lower or higher) never changes it; a new GUID starts again
  if c.start_at is null or (g is not null and c.start_guid is distinct from g) then
    update tally_sync_cursor set last_voucher_alterid = p_altvch, last_master_alterid = p_altmst, start_guid = coalesce(g, start_guid), start_at = now(), start_device = p_device, updated_at = now()
     where book_id = p_book;
    done := true;
  end if;
  select * into c from tally_sync_cursor where book_id = p_book;
  return jsonb_build_object('ok', true, 'set', done, 'startVoucher', c.last_voucher_alterid, 'startMaster', c.last_master_alterid, 'guid', c.start_guid, 'at', c.start_at, 'state', c.state, 'why', c.state_why);
end $function$;
revoke all on function public.tally_start_point(uuid, uuid, text, bigint, bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_start_point(uuid, uuid, text, bigint, bigint, uuid, text) to service_role;

-- ---------------------------------------------------------------- 9. a PC without the add-on: the gap, and a silent PC
-- a bridge's beat says Tally's highest voucher AlterID for a company (FinComCompany's ALTVCHID): compared with what the
-- recorder lines of every PC (and the day books read) reached. Never reads entries. Service role (tally-ingest's beat)
create or replace function public.tally_recorder_gap_check(p_book uuid, p_device uuid, p_altvchid bigint, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; c tally_sync_cursor%rowtype; dmax bigint; base bigint; g jsonb; byd jsonb; at_ timestamptz := coalesce(p_at, now()); missing bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if p_altvchid is null or p_altvchid < 0 then raise exception 'the check needs Tally''s highest voucher AlterID'; end if;
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  insert into tally_sync_cursor (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  select * into c from tally_sync_cursor where book_id = p_book;
  -- no starting point yet: this number is it (7.), and there is no gap
  if c.start_at is null then
    update tally_sync_cursor set last_voucher_alterid = p_altvchid, start_at = now(), start_device = p_device, start_guid = coalesce(start_guid, company_guid), gap = null, gap_at = null, updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'startRecorded', true, 'gap', null, 'startVoucher', p_altvchid);
  end if;
  -- below the starting point: a backup restored or the data rewritten - needs_baseline as today, never a gap
  if p_altvchid < coalesce(c.last_voucher_alterid, 0) then
    update tally_sync_cursor set state = 'needs_baseline', state_at = now(), gap = null, gap_at = null, updated_at = now(),
           state_why = format('Tally''s highest voucher AlterID (%s) is below the starting point (%s): a backup restored or the data rewritten', p_altvchid, c.last_voucher_alterid)
     where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', null, 'needsBaseline', true, 'why', format('below the starting point (%s < %s)', p_altvchid, c.last_voucher_alterid));
  end if;
  select max(d.alter_max) into dmax from tally_days d where d.book_id = p_book;
  base := greatest(coalesce(c.last_voucher_alterid, 0), coalesce(c.recorder_max_alter, 0), coalesce(dmax, 0));
  if p_altvchid > base then
    missing := p_altvchid - base;     -- an UPPER bound: each create, alter or delete raises ALTVCHID by at least one, so the changes missed are at most this
    select jsonb_object_agg(s.device_id::text, jsonb_build_object('max', s.mx, 'lastAt', s.la)) into byd
      from (select r.device_id, max(r.alter_id) mx, max(r.received_at) la from tally_recorder_lines r
             where r.book_id = p_book and r.device_id is not null and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported') group by r.device_id) s;
    g := jsonb_build_object('tally_altvchid', p_altvchid, 'recorder_max', c.recorder_max_alter, 'day_max', dmax, 'start_point', c.last_voucher_alterid, 'missing', missing, 'missingMax', missing,
           'since', coalesce(c.last_match_at, c.start_at), 'last_match_at', c.last_match_at, 'by_device', coalesce(byd, '{}'::jsonb), 'device', p_device, 'at', at_,
           'words', format('up to %s changes not received since %s', missing, to_char(coalesce(c.last_match_at, c.start_at) at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI')));
    update tally_sync_cursor set gap = g, gap_at = coalesce(gap_at, now()), updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', g, 'missing', missing, 'missingMax', missing);
  end if;
  update tally_sync_cursor set gap = null, gap_at = null, last_match_at = at_, updated_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'gap', null, 'matched', true, 'lastMatchAt', at_);
end $function$;
revoke all on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) to service_role;

-- working hours between two moments: Monday to Saturday, 09:00 to 19:00 India time (at most the last 60 days)
create or replace function public.tally_working_hours(p_from timestamptz, p_to timestamptz) returns numeric
language sql stable set search_path = public, pg_temp as $function$
  with w as (select greatest(p_from, p_to - interval '60 days') at time zone 'Asia/Kolkata' as f, p_to at time zone 'Asia/Kolkata' as t)
  select coalesce(sum(greatest(0, extract(epoch from (least(w.t, d + interval '19 hours') - greatest(w.f, d + interval '9 hours'))))), 0) / 3600
    from w, generate_series(date_trunc('day', w.f), date_trunc('day', w.t), interval '1 day') d
   where w.f < w.t and extract(isodow from d) between 1 and 6
$function$;

-- J64: the firm's computers whose beat says Tally was open today (India time) but whose last recorder line (any book) is
-- older than one working day (10 working hours, Mon-Sat 09:00-19:00 IST; never a line: since the computer was added).
-- Members of the firm (the app) or the service role; no cron (the app asks when it shows the Tally page)
create or replace function public.tally_recorder_silent(p_firm uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare out_ jsonb;
begin
  if auth.role() <> 'service_role' and (p_firm is null or p_firm is distinct from my_firm()) then raise exception 'not a member of this firm' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('device', s.id, 'name', s.name, 'lastLineAt', s.last_line, 'tallyOpenAt', s.beat_at, 'workingHours', round(s.wh, 1)) order by s.name), '[]'::jsonb) into out_
    from (select d.id, d.name, l.last_line, (d.info->'beat'->>'at') as beat_at,
                 tally_working_hours(coalesce(l.last_line, d.created_at), now()) as wh
            from tally_devices d
            left join lateral (select max(r.received_at) as last_line from tally_recorder_lines r where r.device_id = d.id) l on true
           where d.firm_id = p_firm and not coalesce(d.revoked, false)
             and (d.info->'beat'->>'tally')::boolean is true
             and ((d.info->'beat'->>'at')::timestamptz at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date) s
   where s.wh >= 10;
  return jsonb_build_object('ok', true, 'silent', out_);
end $function$;
revoke all on function public.tally_recorder_silent(uuid) from public, anon;
grant execute on function public.tally_recorder_silent(uuid) to authenticated, service_role;
revoke all on function public.tally_working_hours(timestamptz, timestamptz) from public, anon;

-- ---------------------------------------------------------------- 8. fixed search_path (their text unchanged) and the '%' fix
alter function public.tally_fincom_id(jsonb) set search_path = public, pg_temp;
alter function public.tally_post_bool(text) set search_path = public, pg_temp;
alter function public.tally_post_accept_text(text) set search_path = public, pg_temp;
alter function public.tally_post_id_match(text, text, text) set search_path = public, pg_temp;
alter function public.tally_post_result_accepted(jsonb) set search_path = public, pg_temp;
alter function public.tally_post_result_taken(jsonb) set search_path = public, pg_temp;
alter function public.tally_post_result_confirmed(jsonb) set search_path = public, pg_temp;
alter function public.tally_post_job_settle(text, boolean, jsonb, jsonb, jsonb) set search_path = public, pg_temp;
alter function public.tally_ledger_marks_frozen() set search_path = public, pg_temp;
alter function public.tally_control_kept() set search_path = public, pg_temp;

create or replace function public.tally_device_post_settings(p_device uuid, p_post_only jsonb, p_bills integer, p_bank integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); po jsonb; d tally_devices%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can change a computer''s posting settings' using errcode = '42501'; end if;
  if p_device is null or not exists (select 1 from tally_devices x where x.id = p_device and x.firm_id = f and not coalesce(x.revoked, false))
    then raise exception 'not a computer of your firm'; end if;
  if p_bills is not null and (p_bills < 1 or p_bills > 500) then raise exception 'the batch size for bills must be between 1 and 500 (% given)', p_bills; end if;
  if p_bank is not null and (p_bank < 1 or p_bank > 500) then raise exception 'the batch size for bank lines must be between 1 and 500 (% given)', p_bank; end if;
  -- post_only: a SQL null leaves it; the JSON null clears it; an array of names is cleaned; anything else is refused
  if p_post_only is not null and jsonb_typeof(p_post_only) not in ('null', 'array') then raise exception 'post_only must be a list of company names, [] for any company, or null for no restriction'; end if;
  if p_post_only is not null and jsonb_typeof(p_post_only) = 'array' then
    if exists (select 1 from jsonb_array_elements(p_post_only) e where jsonb_typeof(e) <> 'string') then raise exception 'post_only must be a list of company names (strings)'; end if;
    select coalesce(jsonb_agg(n), '[]'::jsonb) into po from (select left(btrim(e.val #>> '{}'), 200) n from jsonb_array_elements(p_post_only) with ordinality as e(val, ord) where btrim(e.val #>> '{}') <> '' order by e.ord limit 20) s;
  end if;
  perform pg_advisory_xact_lock(hashtext('tally_device_post_settings:' || p_device::text));
  update tally_devices set
     post_only = case when p_post_only is null then post_only when jsonb_typeof(p_post_only) = 'null' then null else po end,
     post_batch_bills = coalesce(p_bills, post_batch_bills), post_batch_bank = coalesce(p_bank, post_batch_bank),
     post_settings_at = now(), post_settings_by = auth.uid()
   where id = p_device and firm_id = f;
  select * into d from tally_devices where id = p_device;
  return jsonb_build_object('ok', true, 'device', p_device, 'postOnly', d.post_only, 'postBatchBills', d.post_batch_bills, 'postBatchBank', d.post_batch_bank, 'at', d.post_settings_at);
end $function$;
revoke all on function public.tally_device_post_settings(uuid, jsonb, integer, integer) from public, anon;
grant execute on function public.tally_device_post_settings(uuid, jsonb, integer, integer) to authenticated;

commit;
