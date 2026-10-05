-- Migration 50 (05-Oct-2026, the owner's blocker on staging: book f79e4bc3, GARG SHEKHAR & COMPANY, four recorder lines held
-- with words promising "the next day read", which never comes: reading is prospective only, the bridge never reads old days).
-- Runs AFTER 49 (fresh database: ... -> 48 -> 49 -> 50; staging: after 49). ADD-ONLY: no table, column, row or function
-- removed; no statement that removes rows anywhere in this file, not even in a comment (the functions whose text holds one,
-- tally_ingest_entries and tally_ledger_day_rebuild, and tally_ingest_day, are NOT touched); safe to run twice.
--
--   THE CAUSE. Bridge 2.2.0's add-on writes a line as Tally saves; for Receipt 191 and 192 it wrote before Tally had saved
--   them: event "altered", AlterID 0, the placeholder GUID "<company GUID>-00000000", no body. 44/48 held such a line "no
--   entry body on the line: the next day read applies it", and a delete / cancel of an entry the copy does not hold "unknown
--   entry: not in the copy (the next day read decides)" (the copy holds nothing after 31-Mar-2026). Both promised a day read;
--   since 04-Oct reading is prospective only, so nothing would ever release them.
--
--   1. THE WORDS (every held line says what releases it, truthfully). tally_recorder_line (48's text, byte for byte but the
--      lines marked "50:"): no body / no GUID on an entry line -> "waiting for the entry's details from FinCom Bridge (it asks
--      Tally again on its next run); or upload this day's Day Book"; FinCom's posting matched without a body -> the same after
--      its "FinCom posting <id> matched; no entry body (...)"; a delete / cancel of an entry not in the copy -> "the entry is
--      not in FinCom's copy yet; it is applied by itself once the Day Book for <DD-Mon-YYYY> is uploaded"; a delete / cancel
--      without a GUID -> "no entry GUID on the line: FinCom cannot tell which entry was deleted (cancelled), so this line is
--      never applied by itself; uploading the Day Book for <date> brings that day up to date" (review L3: the rows 48 held so
--      get these words too); an unknown ledger deleted -> "... the next ledger list from FinCom Bridge brings the ledgers up
--      to date"; a duplicate "(from a Day Book or another line)" (was "a day read"); a month locked -> as before.
--      tally_ingest_delete (44's text but its two held words; it also answers unknown: true for an entry not in the copy). The
--      rows already held with the old words get the new ones (an UPDATE of held_why on held rows only: nothing removed).
--   2. NOTHING TO DELETE (review H1). A delete of an entry not in the copy is applied ("nothing to delete: the Day Book for
--      <date>, complete and made after this change (its AlterIDs reach N), does not hold the entry") ONLY when the stored day
--      was complete (tally_days.n, the count the bridge or the upload vouched for, equals the entries the copy holds live for
--      the day: never a short, unconfirmed empty or capped read) AND its highest AlterID (tally_days.alter_max) is at or above
--      the delete's (a re-read of an older file fails); else it stays held with the words of 1. A cancel so: held, "the Day Book
--      for <date>, complete and made after this change, does not hold this entry; it is applied by itself once a Day Book
--      holding it is uploaded". A delete applied for a GUID makes any later entry line of that GUID with a LOWER AlterID
--      'stale' (a late create from another computer never revives a deleted entry); and when an entry line brings the entry
--      into the copy, a delete / cancel of it held "not in FinCom's copy yet" at a higher AlterID is applied with it.
--   3. RELEASE BY ITSELF. (a) tally_recorder_line: an entry line (created / altered / imported) with a real GUID that ends
--      applied marks 'replaced' ("replaced by line <id> (the entry's details arrived)") the HELD entry lines it stands for: the
--      same GUID at an AlterID not above its own; a placeholder / GUID-less line (review M1) whose MasterID makes this GUID
--      ("<company GUID>-" + 8-hex MasterID; the company GUID from the placeholder, else the line's, never guessed); with
--      MasterID 0, the same type, number and date under the same known company GUID, and only when this entry is the ONE live
--      entry of the company that fits. Bridge 2.2.1 sends such a line for 191 and 192 (line_id = the original's + ":resolved",
--      event created, the real GUID, AlterID, body). A placeholder line is never applied (never an entry under that GUID),
--      never the "same change" of another; it is 'duplicate' when the copy holds its entry, found the same way (MasterID, else
--      exactly one by type, number and date), and for an 'altered' line only when the copy shows the change (an AlterID above
--      the line's, a Day Book of that day stored after the line came, or a later line of that entry applied); its AlterID is
--      never counted received (tally_recorder_apply: 48's text, one condition added; review L4). A new state 'replaced': the
--      state CHECK swapped for the same name with it added, chosen by its EXACT text as 44 made it (as 47 did for
--      tally_jobs.kind); anything else stops the file with words.
--      (b) A Day Book day stored: two STATEMENT-level triggers on tally_days (after insert, after update; the transition table
--      new_days; review L6: one release per (book, day) a statement stored; tally_ingest_day writes the day's row last, after
--      its entries, on every path: the bridge's days, an upload, a re-read) call tally_recorder_release_day(book, day), which
--      runs again, through tally_recorder_line as an owner's release does, only the held lines the day CAN release (review
--      M2): those whose GUID is one of the day's entries (an entry line without a body only when the day's version is not older
--      than it), a placeholder / GUID-less line whose MasterID makes one of them or whose type and number match one of them
--      (dated that day), and a delete / cancel of that day; found through 44's (book_id, object_guid) index and two new partial
--      indexes on the held lines ((book_id, vch_date), (book_id, master_id)); all of them, oldest first (no window: none
--      starves); each locked and re-checked still held first (review L5); a line whose state and words do not change is not
--      rewritten; a re-run that errors keeps the line held, its words kept and the error said once (review L2), never
--      'failed'; not one held for a locked month (still the owner's release), not one held "FinCom id ..."
--      (tally_recorder_short_retry's). An applied one raises the book's recorder_max_alter as a release does. An error or a
--      cancel (a statement timeout) inside the release is caught and logged, its work undone, the day kept (review L1).
--      Measured on pg_stand (tests/run_migration50.py; M50_PERF=1 for the year): one day of 20 entries with 3,000 held lines
--      it cannot change: 23-24 ms a store with the triggers, 16-18 ms without (the review's row trigger: 2.9-3.1 s); 365 days of
--      20 entries with 3,000 held lines: 33.7 ms a day stored again with the triggers, 22.9 ms without.
--   Functions replaced: tally_recorder_line (48's), tally_recorder_apply (48's), tally_ingest_delete (44's), same arguments.
--   New: tally_recorder_release_day(uuid, date) and the trigger function tally_days_recorder_release(). Every one security
--   definer, search_path = public, pg_temp; tally_ingest_delete and tally_recorder_apply the service role's (revoked from
--   public, anon, authenticated); tally_recorder_line, tally_recorder_release_day and the trigger function granted to nobody.
--   tally-ingest (index.ts) is not changed: the triggers cover every path that stores a day. The review of 50:
--   docs/reviews/migration-50-review.md (H1, M1, M2, L1-L6 fixed here).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- the state 'replaced'
-- tally_recorder_lines.state: the one CHECK swapped for the same name with 'replaced' added, in one statement, only while it
-- lacks it; chosen by its EXACT text as migration 44 made it. Anything else (a state added by hand, no such check) stops the
-- file with words rather than replacing a rule blindly
do $$
declare old_def constant text := 'CHECK ((state = ANY (ARRAY[''received''::text, ''applied''::text, ''duplicate''::text, ''stale''::text, ''held''::text, ''failed''::text])))';
  new_def constant text := 'CHECK ((state = ANY (ARRAY[''received''::text, ''applied''::text, ''duplicate''::text, ''stale''::text, ''held''::text, ''failed''::text, ''replaced''::text])))';
  c text; n int; found text;
begin
  if exists (select 1 from pg_constraint con where con.conrelid = 'public.tally_recorder_lines'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) = new_def) then return; end if;
  select count(*), min(con.conname) into n, c from pg_constraint con
   where con.conrelid = 'public.tally_recorder_lines'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) = old_def;
  if n = 1 then
    execute format('alter table public.tally_recorder_lines drop constraint %I, add constraint %I check (state in (''received'', ''applied'', ''duplicate'', ''stale'', ''held'', ''failed'', ''replaced''))', c, c);
    raise notice 'migration 50: tally_recorder_lines.% takes the state replaced', c;
  else
    select string_agg(con.conname || ' ' || pg_get_constraintdef(con.oid), '; ') into found from pg_constraint con
     where con.conrelid = 'public.tally_recorder_lines'::regclass and con.contype = 'c' and pg_get_constraintdef(con.oid) ~ '\mstate\M';
    raise exception 'migration 50 stopped, nothing changed: tally_recorder_lines has no CHECK on state exactly as migration 44 made it (received, applied, duplicate, stale, held, failed), so it is not replaced blindly (found: %). Widen it by hand to take replaced, then run 50 again', coalesce(found, 'none');
  end if;
end $$;

-- ---------------------------------------------------------------- 48's line: the words, the placeholder, replaced
create or replace function public.tally_recorder_line(p_book uuid, p_device uuid, p_line jsonb, p_row bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; rid bigint := p_row; ev text := left(btrim(coalesce(p_line->>'event', '')), 40);
  og text := nullif(left(btrim(coalesce(p_line->>'object_guid', '')), 100), '');
  alt bigint := case when coalesce(p_line->>'alter_id', '') ~ '^[0-9]{1,15}$' then (p_line->>'alter_id')::bigint end;     -- below 10^15 (review L9)
  vd date := tally_d8(replace(coalesce(p_line->>'vch_date', ''), '-', ''));
  sa timestamptz; pl jsonb; pltxt text; bd jsonb; stt text; wy text; t text; res jsonb; vs jsonb; lk date;
  c_found boolean := false; c_alter bigint; c_day date; c_del timestamptz; c_fid text;
  frm text; dst text; l_name text; l_del timestamptz; l_alt bigint;
  -- 45: the FinCom id of a short line (fid, else "TDSDesk:<id>" in the narration it carries) and its posting
  lf text := coalesce(case when coalesce(p_line->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then p_line->>'fid' end,
                      substring(coalesce(p_line->>'narration', '') from 'TDSDesk:([A-Za-z0-9._-]{1,80})'));
  is_short boolean; m_job uuid; m_fid text; m_guid text; m_done boolean := false; sh_changed boolean := false;
  vno text := nullif(left(btrim(coalesce(p_line->>'vch_no', '')), 60), ''); mid text := nullif(left(btrim(coalesce(p_line->>'master_id', '')), 40), '');
  -- 48: inside tally_recorder_apply (fincom.day_rebuild_once on) an entry's days are not rebuilt here but returned in 'touched'
  once boolean := coalesce(current_setting('fincom.day_rebuild_once', true), '') = 'on'; tch jsonb;
  -- 50: the add-on's placeholder GUID ("<company GUID>-00000000": written before Tally saved the entry) is no entry's GUID;
  -- the line's entry by its MasterID, or its type, number and date under its company; a held line run again: its row's time
  ph boolean := coalesce(og ~ '-0{8}$', false); lt text := nullif(left(btrim(coalesce(p_line->>'vch_type', '')), 60), ''); lno text := vno;
  lcg text := nullif(left(btrim(coalesce(p_line->>'company_guid', '')), 100), ''); r_at timestamptz := now(); dt text; d_hit text; d_alt bigint; d_day date;
  nfit int; pref text; dg text; del_alt bigint; hd record; res2 jsonb;
  known constant text[] := array['created', 'altered', 'deleted', 'cancelled', 'imported', 'ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted'];
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
  -- 50: a held line run again (an owner's release, a Day Book day stored): its own type, company, MasterID and arrival time
  if rid is not null then
    select coalesce(lt, r.vch_type), coalesce(lcg, r.company_guid), r.received_at, coalesce(mid, nullif(r.master_id, '')) into lt, lcg, r_at, mid from tally_recorder_lines r where r.id = rid;
  end if;
  -- 50 (review M1): the company's GUID prefix (the placeholder's, else the line's company GUID; never guessed) and, for a line
  -- without its entry's real GUID, the GUID its MasterID makes: "<company GUID>-<MasterID in 8 hex digits>"
  pref := coalesce(substring(og from '^(.+)-0{8}$'), nullif(lcg, ''));
  dg := case when (og is null or ph) and pref is not null and (case when coalesce(mid, '') ~ '^[0-9]{1,10}$' then mid::bigint else 0 end) between 1 and 4294967295
             then pref || '-' || lpad(to_hex(mid::bigint), 8, '0') end;
  -- a short line: FinCom's own entry, its FinCom id and no body of its own (tally-ingest marks it short when it built the body
  -- from the posting)
  is_short := lf is not null and (coalesce(p_line->>'short', '') = 'true' or jsonb_typeof(p_line->'vouchers') is distinct from 'array' or jsonb_array_length(p_line->'vouchers') = 0);
  if rid is null then
    begin sa := (p_line->>'saved_at')::timestamptz; exception when others then sa := null; end;
    pl := coalesce(p_line->'payload', p_line - 'vouchers' - 'lines'); pltxt := pl::text;
    if length(pltxt) > 8000 then pl := jsonb_build_object('cut', true, 'bytes', length(pltxt), 'head', left(pltxt, 8000)); end if;
    -- the body: the line's own voucher (its GUID) and that voucher's lines alone, never the rest of the add-on's XML (review L1)
    bd := jsonb_strip_nulls(jsonb_build_object(
            'vouchers', (select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where og is not null and x->>'guid' = og),
            'lines', (select jsonb_agg(x) from jsonb_array_elements(case when jsonb_typeof(p_line->'lines') = 'array' then p_line->'lines' else '[]'::jsonb end) x where og is not null and x->>0 = og),
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
      -- 50: what releases it, in words (a later line with the entry's GUID replaces it; a Day Book holding it makes it a duplicate)
      stt := 'held'; wy := case when ev in ('created', 'altered', 'imported') then 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book'
                                when ev in ('deleted', 'cancelled') then format('no entry GUID on the line: FinCom cannot tell which entry was %s, so this line is never applied by itself; uploading the Day Book for %s brings that day up to date', ev, coalesce(to_char(vd, 'DD-Mon-YYYY'), 'its date'))
                                else 'no GUID on the line: held, never a new row' end;
    end if;
    -- the same change already here: another arrival applied or held (owner items 26, 102)
    if stt is null and og is not null and not ph then     -- 50: the placeholder GUID is no entry's: never the same change by it
      select 'line ' || r.id || ' (' || r.state || coalesce(', from ' || nullif(r.pc, ''), '') || ')' into t from tally_recorder_lines r
       where r.book_id = p_book and r.object_guid = og and r.alter_id is not distinct from alt and r.event = ev and r.id <> rid
         -- a held arrival is the original only when a release can apply it (review M1): an entry line with its body, a
         -- delete / cancel held for a locked month; a held line without a body never swallows the same change sent with one
         and (r.state = 'applied' or (r.state = 'held' and case when ev in ('created', 'altered', 'imported') then coalesce(r.body ? 'vouchers', false)
                                                                when ev in ('deleted', 'cancelled') then coalesce(r.held_why, '') like 'month locked%'
                                                                else true end))
       order by r.id limit 1;
      if t is not null then stt := 'duplicate'; wy := 'the same change already came as ' || t; end if;
    end if;
    if stt is null and ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') then
      select true, coalesce(v.alter_id, 0), v.day, v.deleted_at into c_found, c_alter, c_day, c_del from tally_vouchers v where v.book_id = p_book and v.guid = og;
      c_found := coalesce(c_found, false);
      if ev in ('deleted', 'cancelled') then
        res := tally_ingest_delete(p_book, og, alt, ev = 'cancelled', 'recorder ' || coalesce(left(p_line->>'pc', 60), ''));
        stt := res->>'state'; wy := res->>'why';
        -- 50: an entry not in the copy: what releases it, by the line's date. Review H1: only a COMPLETE Day Book of that day (the
        -- count the bridge or the upload vouched for, tally_days.n, equals the entries the copy holds live for the day: never a
        -- short, unconfirmed empty or capped read) made AFTER this change (its highest AlterID at or above the line's: a re-read of
        -- an older file fails) proves the entry gone from Tally: a delete has nothing left to do; a cancel waits for a Day Book
        -- that holds it
        if stt = 'held' and coalesce((res->>'unknown')::boolean, false) then
          dt := coalesce(to_char(vd, 'DD-Mon-YYYY'), 'its date');
          select d.alter_max into d_alt from tally_days d
           where d.book_id = p_book and d.day = vd and alt > 0 and d.alter_max >= alt
             and d.n = (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = vd and v.deleted_at is null);
          if found then
            if ev = 'deleted' then stt := 'applied'; wy := format('nothing to delete: the Day Book for %s, complete and made after this change (its AlterIDs reach %s), does not hold the entry', dt, d_alt);
            else wy := format('the Day Book for %s, complete and made after this change, does not hold this entry; it is applied by itself once a Day Book holding it is uploaded', dt);
            end if;
          else wy := format('the entry is not in FinCom''s copy yet; it is applied by itself once the Day Book for %s is uploaded', dt);
          end if;
        end if;
      else
        -- the entry's body: the voucher of this GUID alone, dated by the line when it has no date of its own
        select coalesce(jsonb_agg(case when tally_d8(replace(coalesce(x->>'day', ''), '-', '')) is null then x || jsonb_build_object('day', vd) else x end), '[]'::jsonb) into vs
          from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where x->>'guid' = og;
        -- review H2: a short line builds the entry from FinCom's posted XML only when it is FinCom's creation: never for an
        -- 'altered' line, never for an entry the copy holds (a person changed it in Tally after the posting: the posted
        -- content is not Tally's now). Such a line is matched, held, and its AlterID is not received (the gap check shows it)
        sh_changed := is_short and (ev = 'altered' or c_found);
        if sh_changed then vs := '[]'::jsonb; end if;
        if ph then vs := '[]'::jsonb; end if;     -- 50: never an entry under the placeholder GUID
        -- 45: a short line lands on FinCom's posting (the live, accepted one of this firm for this book) or is held
        if is_short then
          select r.post_job, r.post_fid, r.post_guid into m_job, m_fid, m_guid from tally_post_live_for(b.firm_id, p_book, lf) r;
          if m_job is null then
            stt := 'held'; wy := format('FinCom id %s matches no posting of this firm', lf);
          elsif m_guid is not null and m_guid <> og then
            stt := 'held'; wy := format('FinCom id %s is matched to another Tally entry (GUID %s) already: held, never a second entry', lf, m_guid);
          else
            update tally_post_ids p set matched_at = coalesce(p.matched_at, now()),
                   matched_vch = coalesce(vno, nullif(left(btrim(coalesce(vs->0->>'no', '')), 60), ''), p.matched_vch),
                   matched_guid = og, matched_mid = coalesce(mid, p.matched_mid),
                   matched_alter = case when alt is null then p.matched_alter else greatest(coalesce(p.matched_alter, alt), alt) end
             where p.job_id = m_job and p.fincom_id = m_fid;
            m_done := true;
          end if;
        end if;
        -- 50 (review H1): the highest AlterID at which a delete of this GUID was applied
        select max(r.alter_id) into del_alt from tally_recorder_lines r where r.book_id = p_book and r.object_guid = og and r.event = 'deleted' and r.state = 'applied';
        if stt is null then
          lk := tally_month_locked(p_book, array(select tally_d8(replace(coalesce(x->>'day', ''), '-', '')) from jsonb_array_elements(vs) x) || array[c_day, vd]);
          if lk is not null then
            stt := 'held'; wy := format('month locked: %s', to_char(lk, 'YYYY-MM'));
          elsif c_found and alt is not null and alt < c_alter then
            stt := 'stale'; wy := format('AlterID %s is older than the %s held', alt, c_alter);
          -- 50 (review H1): a delete of this entry applied at a higher AlterID (gone from Tally, perhaps never in the copy): an older
          -- line of it, late from another computer, never revives it
          elsif alt is not null and del_alt > alt then
            stt := 'stale'; wy := format('AlterID %s is older than the delete applied at AlterID %s: an older change, not applied', alt, del_alt);
          elsif c_found and alt is not null and alt = c_alter and c_del is null then
            stt := 'duplicate'; wy := format('the copy holds this entry at AlterID %s already (from a Day Book or another line)', alt);
          elsif jsonb_array_length(vs) = 0 then
            stt := 'held'; wy := case when m_done and sh_changed then format('FinCom posting %s matched; changed in Tally after posting: the next full line or Day Book upload applies it', m_fid)
                                      when m_done then format('FinCom posting %s matched; no entry body (its posted XML could not be read): waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book', m_fid)
                                      else 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book' end;     -- 50: what releases it
          else
            res := tally_ingest_entries(p_book, vs, p_line->'lines', not once);
            if coalesce((res->>'locked')::boolean, false) then stt := 'held'; wy := res->>'refused';
            else
              stt := 'applied';
              if once then tch := res->'touched'; end if;
              if m_done then wy := format('FinCom posting %s matched', m_fid);
              else
                -- a FinCom posting coming back in a full line: matched by its FinCom id (43's columns, 45's GUID, MasterID, AlterID);
                -- review L4: only the firm's LIVE row of that id whose posting's company is this book's (never an old failed
                -- posting's or another company's row of the same id)
                select v.fincom_id into c_fid from tally_vouchers v where v.book_id = p_book and v.guid = og;
                if c_fid is not null then
                  update tally_post_ids p set matched_at = coalesce(p.matched_at, now()), matched_vch = coalesce(vno, p.matched_vch),
                         matched_guid = coalesce(p.matched_guid, og), matched_mid = coalesce(mid, p.matched_mid),
                         matched_alter = case when alt is null then p.matched_alter else greatest(coalesce(p.matched_alter, alt), alt) end
                   where p.firm_id = b.firm_id and p.fincom_id = c_fid and p.live
                     and exists (select 1 from tally_post_jobs j where j.id = p.job_id and j.firm_id = b.firm_id and j.company = b.company);
                  wy := format('FinCom posting %s matched', c_fid);
                end if;
              end if;
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
          -- round 21 (review M8): the ledger's AlterID seen, so an older ledger_altered never undoes this rename
          if stt = 'applied' and alt is not null and og is not null then
            update tally_ledgers set alter_id = greatest(coalesce(alter_id, 0), alt) where book_id = p_book and tally_guid = og and deleted_at is null;
          end if;
        exception when others then stt := 'held'; wy := left('rename not made: ' || sqlerrm, 300);
        end;
      end if;
    elsif stt is null and ev = 'ledger_altered' and og is not null and left(btrim(coalesce(p_line->>'name', '')), 300) <> ''
          and exists (select 1 from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null and l.name <> left(btrim(p_line->>'name'), 300)) then
      -- 47: a ledger_altered line whose GUID the copy holds (live) under another name is a rename: tally_ledger_rename, as
      -- ledger_renamed. Round 21 (review M8): only with an AlterID above the last one seen for that ledger (an older line
      -- arriving late never undoes a newer rename: 'stale'), and never a merge (a name another ledger holds is left to the
      -- next ledger list); a line without an AlterID is held for the ledger list
      select l.name, l.alter_id into frm, l_alt from tally_ledgers l where l.book_id = p_book and l.tally_guid = og and l.deleted_at is null order by l.name limit 1;
      dst := left(btrim(p_line->>'name'), 300);
      if alt is null then stt := 'held'; wy := 'a ledger change without its AlterID: the next ledger list applies it';
      elsif l_alt is not null and alt <= l_alt then stt := 'stale'; wy := format('ledger AlterID %s is not above the %s seen: an older change, not applied', alt, l_alt);
      elsif exists (select 1 from tally_ledgers l where l.book_id = p_book and l.name = dst) then
        stt := 'held'; wy := format('a ledger named %s is in the copy already: a merge is left to the next ledger list', dst);
      elsif coalesce(current_setting('fincom.recorder_release', true), '') ~ '^[0-9]+$' then stt := 'held'; wy := 'a rename is applied by the bridge (tally_ledger_rename), not by a release: the next ledger list makes it';
      else
        begin
          res := tally_ledger_rename(p_book, og, frm, dst);
          if coalesce((res->>'renamed')::boolean, false) or coalesce((res->>'merged')::boolean, false) then stt := 'applied'; wy := res->>'note';
          elsif res->>'note' = 'already named so' then stt := 'applied'; wy := 'already named so';
          else stt := 'held'; wy := coalesce(res->>'note', 'not renamed');
          end if;
          if stt = 'applied' then
            update tally_ledgers set alter_id = greatest(coalesce(alter_id, 0), alt) where book_id = p_book and tally_guid = og and deleted_at is null;
          end if;
        exception when others then stt := 'held'; wy := left('rename not made: ' || sqlerrm, 300);
        end;
      end if;
    elsif stt is null and ev in ('ledger_created', 'ledger_altered') then
      stt := 'held'; wy := 'ledger lines applied by the next ledger list';
    elsif stt is null and ev = 'ledger_deleted' then
      select l.name, l.deleted_at into l_name, l_del from tally_ledgers l where l.book_id = p_book and l.tally_guid = og order by (l.deleted_at is null) desc limit 1;
      if l_name is null then stt := 'held'; wy := 'unknown ledger: not in the copy, so nothing to mark deleted; the next ledger list from FinCom Bridge brings the ledgers up to date';
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
    -- 50 (review M1): a line without its entry's real GUID whose entry the copy holds now: by the GUID its MasterID makes; with
    -- no MasterID, by type, number and date only when exactly ONE live entry of its company fits (the prefix known: never null =
    -- null). An 'altered' line only when the copy shows the change: an AlterID above the line's, a Day Book of that day stored
    -- after the line came, or a later line of that entry applied
    if stt = 'held' and ev in ('created', 'altered', 'imported') and (og is null or ph) then
      if dg is not null then
        select v.guid, coalesce(v.alter_id, 0), v.day into d_hit, d_alt, d_day from tally_vouchers v where v.book_id = p_book and v.guid = dg and v.deleted_at is null;
      elsif pref is not null and lt is not null and lno is not null and vd is not null then
        select count(*), min(v.guid) into nfit, d_hit from tally_vouchers v
         where v.book_id = p_book and v.day = vd and v.vtype = lt and v.vno = lno and v.deleted_at is null and v.guid like pref || '-%' and v.guid !~ '-0{8}$';
        if nfit = 1 then select coalesce(v.alter_id, 0), v.day into d_alt, d_day from tally_vouchers v where v.book_id = p_book and v.guid = d_hit;
        else d_hit := null; end if;
      end if;
      if d_hit is not null and (ev <> 'altered' or (coalesce(alt, 0) > 0 and d_alt > alt)
           or exists (select 1 from tally_days d where d.book_id = p_book and d.day = d_day and d.at > r_at and coalesce(d.alter_max, 0) > 0)
           or exists (select 1 from tally_recorder_lines a where a.book_id = p_book and a.object_guid = d_hit and a.state = 'applied' and a.received_at > r_at)) then
        stt := 'duplicate'; wy := format('the copy holds %s %s of %s already (GUID %s, AlterID %s: from a Day Book or a later line)', lt, lno, to_char(d_day, 'DD-Mon-YYYY'), d_hit, d_alt);
      end if;
    end if;
    if stt = 'applied' and ev in ('created', 'altered', 'imported') and og is not null and not ph then
      -- 50: a line that entered its entry replaces the held lines it stands for: the same GUID at an AlterID not above its own;
      -- the placeholder / no GUID by the GUID its MasterID makes; with no MasterID, the same type, number and date under the same
      -- company GUID (known on both sides) when this entry is the ONE live entry of the company that fits (review M1)
      update tally_recorder_lines r set state = 'replaced', held_why = format('replaced by line %s (the entry''s details arrived)', rid)
       where r.book_id = p_book and r.state = 'held' and r.id <> rid and r.event in ('created', 'altered', 'imported')
         and ((r.object_guid = og and coalesce(r.alter_id, 0) <= coalesce(alt, 0))
           or ((r.object_guid is null or r.object_guid ~ '-0{8}$')
               and case when (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                        then coalesce(substring(r.object_guid from '^(.+)-0{8}$'), nullif(r.company_guid, '')) || '-' || lpad(to_hex(r.master_id::bigint), 8, '0') = og
                        else coalesce(substring(r.object_guid from '^(.+)-0{8}$'), nullif(r.company_guid, '')) = substring(og from '^(.+)-[0-9A-Fa-f]{8}$')
                             and r.vch_type = coalesce(lt, vs->0->>'type') and r.vch_no = coalesce(lno, vs->0->>'no')
                             and r.vch_date = coalesce(vd, tally_d8(replace(coalesce(vs->0->>'day', ''), '-', '')))
                             and (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = r.vch_date and v.vtype = r.vch_type and v.vno = r.vch_no
                                    and v.deleted_at is null and v.guid like substring(og from '^(.+)-[0-9A-Fa-f]{8}$') || '-%' and v.guid !~ '-0{8}$') = 1 end));
      -- 50 (review H1): the entry is in the copy now: a delete or cancel of it held "not in FinCom's copy yet" at a higher AlterID
      -- (it came first, from another computer) is applied with it, so the entry is never live while Tally has it gone
      for hd in select r.id, r.event, r.alter_id, r.pc from tally_recorder_lines r
                 where r.book_id = p_book and r.state = 'held' and r.object_guid = og and r.event in ('deleted', 'cancelled')
                   and r.alter_id > coalesce(alt, 0) and coalesce(r.held_why, '') not like 'month locked%' order by r.alter_id, r.id loop
        res2 := tally_ingest_delete(p_book, og, hd.alter_id, hd.event = 'cancelled', 'recorder ' || coalesce(hd.pc, ''));
        if res2->>'state' = 'applied' and not exists (select 1 from tally_recorder_lines a where a.book_id = p_book and a.object_guid = og and a.alter_id = hd.alter_id and a.event = hd.event and a.state = 'applied') then
          update tally_recorder_lines set state = 'applied', held_why = format('applied when line %s brought the entry', rid), applied_at = now() where id = hd.id;
          insert into tally_sync_cursor (book_id, firm_id) values (p_book, b.firm_id) on conflict (book_id) do nothing;
          update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), hd.alter_id), recorder_last_at = now(), updated_at = now() where book_id = p_book;
        end if;
      end loop;
    end if;
  exception when others then
    stt := 'failed'; wy := left(sqlerrm, 300);
  end;
  update tally_recorder_lines set state = stt, held_why = wy,
         applied_at = case when stt = 'applied' then now() else applied_at end,
         body = case when stt = 'duplicate' then null else body end
   where id = rid and (state is distinct from stt or held_why is distinct from wy);     -- 50 (review M2): a line whose state and words stay is not rewritten
  return jsonb_build_object('id', rid, 'line_id', p_line->>'line_id', 'state', stt, 'why', wy)
      || case when once and stt = 'applied' and jsonb_typeof(tch) = 'array' then jsonb_build_object('touched', tch) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- 44's tally_ingest_delete: the words (and unknown: true)
create or replace function public.tally_ingest_delete(p_book uuid, p_guid text, p_alter bigint, p_cancel boolean, p_source text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; g text := nullif(left(btrim(coalesce(p_guid, '')), 100), ''); act text := case when p_cancel then 'cancelled' else 'deleted' end;
  src text := left(coalesce(p_source, ''), 80); v_day date; v_alter bigint; v_del timestamptz; v_can boolean; lk date;
begin
  if auth.role() <> 'service_role' and coalesce(current_setting('fincom.recorder_release', true), '') !~ '^[0-9]+$' then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  if g is null then return jsonb_build_object('ok', true, 'state', 'held', 'why', 'no entry GUID: nothing can be ' || act || ' by it; the Day Book for its date, once uploaded, brings that day up to date', 'action', act); end if;
  select v.day, coalesce(v.alter_id, 0), v.deleted_at, v.cancelled into v_day, v_alter, v_del, v_can from tally_vouchers v where v.book_id = p_book and v.guid = g;
  if not found then
    return jsonb_build_object('ok', true, 'state', 'held', 'guid', g, 'action', act, 'unknown', true,
      'why', 'the entry is not in FinCom''s copy yet; it is applied by itself once the Day Book for its date is uploaded');     -- 50: what releases it
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

-- ---------------------------------------------------------------- 48's apply: a placeholder never raises the AlterID received (review L4)
create or replace function public.tally_recorder_apply(p_firm uuid, p_book uuid, p_device uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare x jsonb; res jsonb := '[]'::jsonb; one jsonb; mx bigint; pend date[] := '{}';
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  if p_device is not null and not exists (select 1 from tally_devices d where d.id = p_device and d.firm_id = p_firm) then raise exception 'not a computer of this firm'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'the lines must be a list'; end if;
  if jsonb_array_length(p_lines) > 1000 then raise exception 'at most 1000 lines a call (% given)', jsonb_array_length(p_lines); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  -- 48: the entry lines' days are rebuilt once, after the loop (tally_recorder_line returns them in 'touched')
  perform set_config('fincom.day_rebuild_once', 'on', true);
  for x in select e from jsonb_array_elements(p_lines) with ordinality as t(e, o) order by o loop
    if jsonb_typeof(x) is distinct from 'object' then
      res := res || jsonb_build_array(jsonb_build_object('line_id', null, 'state', 'failed', 'why', 'not a line'));
      continue;
    end if;
    -- a ledger line reads the balances (a rename's trial-balance check, the guard): the days collected so far are rebuilt first
    if left(btrim(coalesce(x->>'event', '')), 7) = 'ledger_' and cardinality(pend) > 0 then     -- review L9: trimmed, as the line trims it
      perform tally_ledger_day_rebuild(p_book, array(select distinct d from unnest(pend) d));
      pend := '{}';
    end if;
    one := tally_recorder_line(p_book, p_device, x, null);
    if jsonb_typeof(one->'touched') = 'array' then
      pend := pend || array(select e::date from jsonb_array_elements_text(one->'touched') e);
    end if;
    res := res || jsonb_build_array(one - 'id' - 'touched');
    -- 9. the highest change number received from every PC's lines (entry events with an AlterID, below 10^15), never
    -- lowered; only from a line that ended applied, duplicate or stale: a held or failed line never raises it (review L2)
    if one->>'state' in ('applied', 'duplicate', 'stale') and x->>'event' in ('created', 'altered', 'deleted', 'cancelled', 'imported')
       and coalesce(x->>'object_guid', '') <> '' and coalesce(x->>'alter_id', '') ~ '^[0-9]{1,15}$'
       and x->>'object_guid' !~ '-0{8}$' then     -- 50 (review L4): the add-on's placeholder GUID is no entry's: its AlterID is never received
      mx := greatest(mx, (x->>'alter_id')::bigint);
    end if;
  end loop;
  perform set_config('fincom.day_rebuild_once', '', true);
  if cardinality(pend) > 0 then
    perform tally_ledger_day_rebuild(p_book, array(select distinct d from unnest(pend) d));
  end if;
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

-- ---------------------------------------------------------------- a Day Book day stored: the held lines that day can release run again
-- review M2: the held lines are found through these two partial indexes (and 44's (book_id, object_guid)); a held line is few
create index if not exists tally_recorder_lines_held_day on public.tally_recorder_lines (book_id, vch_date) where state = 'held';
create index if not exists tally_recorder_lines_held_master on public.tally_recorder_lines (book_id, master_id) where state = 'held';

-- internal: granted to nobody (the triggers on tally_days call it). Review M2: only the held lines the stored day CAN release:
-- those whose GUID is one of the day's entries (an entry line without a body only when the day's version is not older than it),
-- a placeholder / GUID-less line whose MasterID makes one of them or whose type and
-- number match one of them (dated that day), and a delete / cancel of that day (a complete Day Book can show the entry gone);
-- every one of them, oldest first (no window: none starves). Review L5: each is locked and re-checked still held. Review L2: a
-- re-run that errors keeps the line held, its words kept and the error said once
create or replace function public.tally_recorder_release_day(p_book uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_recorder_lines%rowtype; one jsonb; prev text := coalesce(current_setting('fincom.recorder_release', true), ''); n int := 0; a int := 0; f uuid; st text;
begin
  if p_book is null or p_day is null then return jsonb_build_object('ok', true, 'ran', 0, 'applied', 0); end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return jsonb_build_object('ok', true, 'ran', 0, 'applied', 0); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  for r in
    with dv as (select v.guid, v.vtype, v.vno, coalesce(v.alter_id, 0) as alter_id,
                       case when v.guid ~ '-[0-9A-Fa-f]{8}$' then (('x' || right(v.guid, 8))::bit(32)::bigint)::text end as mid
                  from tally_vouchers v where v.book_id = p_book and v.day = p_day),
    cand as (
      select l.id from dv join tally_recorder_lines l on l.book_id = p_book and l.object_guid = dv.guid and l.state = 'held'
       -- an entry line without a body whose AlterID is above the day's version of it stays held whatever: not run
       where l.event in ('deleted', 'cancelled') or coalesce(l.body ? 'vouchers', false) or coalesce(l.alter_id, 0) <= dv.alter_id
      union
      select l.id from dv join tally_recorder_lines l on l.book_id = p_book and l.master_id = dv.mid and l.state = 'held'
       where l.object_guid is null or l.object_guid ~ '-0{8}$'
      union
      select l.id from tally_recorder_lines l
       where l.book_id = p_book and l.state = 'held' and l.vch_date = p_day
         and ((l.event in ('deleted', 'cancelled') and l.object_guid is not null)
              or ((l.object_guid is null or l.object_guid ~ '-0{8}$') and exists (select 1 from dv where dv.vtype = l.vch_type and dv.vno = l.vch_no))))
    select l.* from tally_recorder_lines l join cand c on c.id = l.id
     where l.event in ('created', 'altered', 'imported', 'deleted', 'cancelled')
       and coalesce(l.held_why, '') not like 'month locked%' and coalesce(l.held_why, '') not like 'FinCom id %'
     order by l.id
  loop
    begin
      select l.state into st from tally_recorder_lines l where l.id = r.id for update;
      if st is distinct from 'held' then continue; end if;
      -- as an owner's release runs it (tally_recorder_release_held): the stored line and its body, the row given
      perform set_config('fincom.recorder_release', r.id::text, true);
      one := tally_recorder_line(r.book_id, r.device_id, jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id,
               'vch_date', r.vch_date, 'vch_no', r.vch_no, 'vch_type', r.vch_type, 'company_guid', r.company_guid, 'master_id', r.master_id, 'pc', r.pc, 'bridge', r.bridge) || coalesce(r.body, '{}'::jsonb), r.id);
      n := n + 1;
      if one->>'state' = 'failed' then
        update tally_recorder_lines set state = 'held',
               held_why = regexp_replace(coalesce(r.held_why, ''), ' \(a try to apply it by itself met an error: .*\)$', '') || ' (a try to apply it by itself met an error: ' || coalesce(one->>'why', 'unknown') || ')'
         where id = r.id;
        raise log 'tally_recorder_release_day: line % of book % kept held: %', r.id, p_book, one->>'why';
      -- applied now: its AlterID counts for the gap check as any applied line's
      elsif one->>'state' = 'applied' then
        a := a + 1;
        if r.alter_id is not null and r.alter_id < 1000000000000000 and coalesce(r.object_guid, '') !~ '-0{8}$' then
          insert into tally_sync_cursor (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
          update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), r.alter_id), recorder_last_at = now(), updated_at = now() where book_id = p_book;
        end if;
      end if;
    exception when others then
      raise log 'tally_recorder_release_day: line % of book % not run again: % %', r.id, p_book, sqlstate, sqlerrm;
    end;
  end loop;
  perform set_config('fincom.recorder_release', prev, true);
  return jsonb_build_object('ok', true, 'ran', n, 'applied', a);
end $function$;
revoke all on function public.tally_recorder_release_day(uuid, date) from public, anon, authenticated, service_role;

-- the triggers (review L6): STATEMENT level, one release per (book, day) a statement stored, from the transition table new_days
-- (tally_ingest_day's upsert fires the insert one or the update one). Review L1: a release never fails the day: an error or a
-- cancel (a statement timeout) inside it is caught and logged, its work undone, the day kept
create or replace function public.tally_days_recorder_release() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $function$
declare d record;
begin
  for d in select distinct n.book_id, n.day from new_days n
            where exists (select 1 from tally_recorder_lines l where l.book_id = n.book_id and l.state = 'held')
            order by n.book_id, n.day loop
    begin
      perform tally_recorder_release_day(d.book_id, d.day);
    exception when others then
      raise log 'tally_days_recorder_release: book % day %: % %', d.book_id, d.day, sqlstate, sqlerrm;
    end;
  end loop;
  return null;
exception when query_canceled or others then
  raise log 'tally_days_recorder_release: stopped (the days stored, the held lines left for the next store): % %', sqlstate, sqlerrm;
  return null;
end $function$;
revoke all on function public.tally_days_recorder_release() from public, anon, authenticated, service_role;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_days'::regclass and tgname = 'tally_days_recorder_release_ins' and not tgisinternal) then
    create trigger tally_days_recorder_release_ins after insert on public.tally_days referencing new table as new_days
      for each statement execute function public.tally_days_recorder_release();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_days'::regclass and tgname = 'tally_days_recorder_release_upd' and not tgisinternal) then
    create trigger tally_days_recorder_release_upd after update on public.tally_days referencing new table as new_days
      for each statement execute function public.tally_days_recorder_release();
  end if;
end $$;

-- ---------------------------------------------------------------- the rows already held: the new words (held_why only)
update public.tally_recorder_lines set held_why = case
    when held_why = 'unknown entry: not in the copy (the next day read decides)'
      then format('the entry is not in FinCom''s copy yet; it is applied by itself once the Day Book for %s is uploaded', coalesce(to_char(vch_date, 'DD-Mon-YYYY'), 'its date'))
    when held_why like 'FinCom posting % matched; no entry body (its posted XML could not be read): the next day read applies it'
      then replace(held_why, 'the next day read applies it', 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book')
    when held_why = 'unknown ledger: not in the copy'
      then 'unknown ledger: not in the copy, so nothing to mark deleted; the next ledger list from FinCom Bridge brings the ledgers up to date'
    when held_why = 'no GUID on the line: held, never a new row' and event in ('deleted', 'cancelled')     -- review L3
      then format('no entry GUID on the line: FinCom cannot tell which entry was %s, so this line is never applied by itself; uploading the Day Book for %s brings that day up to date', event, coalesce(to_char(vch_date, 'DD-Mon-YYYY'), 'its date'))
    else 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book' end
 where state = 'held'
   and (held_why in ('no entry body on the line: the next day read applies it', 'unknown entry: not in the copy (the next day read decides)', 'unknown ledger: not in the copy')
        or held_why like 'FinCom posting % matched; no entry body (its posted XML could not be read): the next day read applies it'
        or (held_why = 'no GUID on the line: held, never a new row' and event in ('created', 'altered', 'imported', 'deleted', 'cancelled')));

commit;
