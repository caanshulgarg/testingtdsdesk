-- Migration 67 (08-Oct-2026, next-renumber: the owner's decision "renumbering yes"). Runs AFTER 60 (fresh database and
-- staging: ... -> 57 -> 58 -> 60 -> 67). NOTE: 63 (next-outbox) and 69 (next-push) replace tally_recorder_line as well; whichever
-- lands later must carry the other's marked lines. ADD-ONLY: no table, column, row or function removed; no statement in this file
-- removes rows; safe to run twice; one transaction (lock_timeout 10 s). One function replaced: tally_recorder_line (same arguments,
-- security definer, search_path = public, pg_temp, granted to nobody as before), 60's text with the lines marked "67" changed:
--   A voucher inserted or deleted in Tally, of a voucher type that renumbers, makes Tally renumber every later voucher of that
--   type; their AlterIDs do not move (tally-versions P9r, TallyPrime 3.0 and 7.1, runs 37734533866 and 37754251128: every
--   renumbered receipt kept its AlterID). FinCom Bridge (next-renumber) reads each such entry again from Tally and sends it as an
--   altered line WITH Tally's entry. Before 67 such a line was 'duplicate' (the copy holds that AlterID already, or the same change
--   came as another line at that AlterID) and the copy kept the old number. 67: an altered line with Tally's entry (its own GUID,
--   ids together) at exactly the AlterID the copy holds, whose number differs from the copy's, is applied (the copy takes Tally's
--   number), its words "renumbered in Tally: <type> <old> is <type> <new> now (the same AlterID n)". Every other line as under 60.
-- Nothing else is touched; no row is changed by running it. Tested on pg_stand only: tests/run_migration67.py.

-- release-240 (FinCom Bridge 2.4.0, 08-Oct-2026): 63 (next-outbox) and 67 (next-renumber) both replace tally_recorder_line on
-- 60's text. Each now carries the SAME combined text: 60's with the lines marked "63" (a repeat of a line FinCom has) AND the
-- lines marked "67" (a renumbered entry applied), so whichever of the two runs last leaves the same function and neither
-- one's behaviour is lost, in either order (tests/run_migration_order.py runs staging 63 -> 67 and a fresh database
-- 67 -> 63 and compares the texts). Each also makes 63's look-up index (if not there), so either file alone is complete.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- the repeat look-up's index (63's; release-240: in 67 too)
create index if not exists tally_recorder_lines_line on public.tally_recorder_lines (book_id, line_id);

-- ---------------------------------------------------------------- 60's line with the renumbered entry (lines marked "67") and the repeat check (lines marked "63")
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
  nfit int; pref text; dg text; del_alt bigint; del_ev text; hd record; res2 jsonb; d_at timestamptz; d_n int; d_live int; twin bigint;
  known constant text[] := array['created', 'altered', 'deleted', 'cancelled', 'imported', 'ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted'];
  -- 51: FinCom Bridge 2.2.2's idsMismatch / lineGuid / heldWhy (the line's own fields; a held line run again: its stored payload's)
  rp jsonb; r_why text; mm boolean := false; hb boolean := false; hw text; lg text; mdv bigint;
  -- 52: the entry the line names (type, number, date) against the copy's entry at its GUID (cx_*) and the entry sent with it (b_*);
  -- the entry an applied line brought (a_*)
  lw text; cx_found boolean := false; cx_t text; cx_n text; cx_d date; bv jsonb; b_t text; b_n text; b_d date; dif_c boolean := false; dif_b boolean := false;
  a_t text; a_n text; a_d date; cx_a bigint; sh boolean := false;
  -- 53: the book's starting point; the one live entry of the line's type, number and date (s_*); a FinCom id on the line or its row
  sp bigint; s_n int; s_g text; s_a bigint; s_t text; s_no text; s_d date; fc boolean;
  -- 53 (review M1): an altered line: the highest AlterID of the book's lines settled before it came
  s_m bigint;
  -- 60 (migration-50 review R3-L2): a create late after a cancel applied above it: applied, then cancelled again
  then_cancel boolean := false; res3 jsonb;
  -- 63: a repeat of a line this computer sent before (the same line id, and the same "again" marker when the bridge sends one)
  lid text := nullif(left(coalesce(p_line->>'line_id', ''), 80), ''); ag text := case when p_line ? 'again' then left(coalesce(p_line->>'again', ''), 20) end;     -- 63
  rp_id bigint; rp_st text;     -- 63
  -- 67 (next-renumber): Tally renumbered the entry (an insert or delete before it, the voucher type renumbering): its body under
  -- the same AlterID with another number than the copy's
  renum boolean := false;     -- 67
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
  -- 63 (next-outbox): a line FinCom has already, sent again by the same computer (its answer lost, the bridge restarted): the
  -- same book, computer and line id, and the same "again" marker when the line carries one (a bridge after 2.3.1 marks its
  -- deliberate resends "items" / "ledger"; a line without the key is an older bridge's). Never stored or applied twice:
  -- answered 'duplicate' with already: true and the first arrival's state (was), so the bridge marks it sent. Not a repeat:
  -- a row ended 'failed' (sent again on purpose, e.g. after a failed queued send); and, for a bridge that does not mark (no
  -- "again" key), a ":resolved" line whose last row is 'held' (2.3.1 sends it once more on purpose: FinCom held it waiting
  -- for a ledger, or its body was incomplete). A held row run again (p_row) is never a repeat
  if rid is null and lid is not null then     -- 63
    select r.id, r.state into rp_id, rp_st from tally_recorder_lines r     -- 63
     where r.book_id = p_book and r.line_id = lid and r.device_id is not distinct from p_device and r.state <> 'failed'     -- 63
       and (ag is null or coalesce(left(r.payload->>'again', 20), '') = ag)     -- 63
     order by r.id desc limit 1;     -- 63
    if rp_id is not null and not (ag is null and lid like '%:resolved' and rp_st = 'held') then     -- 63
      return jsonb_build_object('id', rp_id, 'line_id', lid, 'state', 'duplicate', 'already', true, 'was', rp_st,     -- 63
        'why', format('already have this line (row %s, %s): the same line sent again, not stored or applied again', rp_id, rp_st));     -- 63
    end if;     -- 63
  end if;     -- 63
  -- 50: a held line run again (an owner's release, a Day Book day stored): its own type, company, MasterID and arrival time
  if rid is not null then
    select coalesce(lt, r.vch_type), coalesce(lcg, r.company_guid), r.received_at, coalesce(mid, nullif(r.master_id, '')), r.payload, r.held_why
      into lt, lcg, r_at, mid, rp, r_why from tally_recorder_lines r where r.id = rid;     -- 51: its payload and words too
  end if;
  -- 51: the bridge's plain reason for a line without the entry's body, and the add-on's GUID (words only, never looked up)
  hw := nullif(left(btrim(coalesce(p_line->>'heldWhy', p_line->'payload'->>'heldWhy', rp->>'heldWhy', '')), 300), '');
  lg := nullif(left(btrim(coalesce(p_line->>'lineGuid', p_line->'payload'->>'lineGuid', rp->>'lineGuid', '')), 100), '');
  -- 51: the line carries its entry (Tally's own, under the line's GUID)
  hb := og is not null and not ph and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where x->>'guid' = og);
  -- 51: the ids did not belong together: the bridge says so (idsMismatch), or a line without a body whose GUID is not the GUID its
  -- MasterID makes (its last 8 hex digits are not the MasterID in hex; an older bridge's line, or a row 51 held again). Review M:
  -- inferred only for a GUID under the line's own company GUID: an entry from Tally sync or an XML import keeps another
  -- company's prefix and that company's MasterID, a genuine Tally GUID
  mdv := case when coalesce(mid, '') ~ '^[0-9]{1,10}$' then mid::bigint else 0 end;
  mm := ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') and coalesce(
          'true' in (lower(coalesce(p_line->>'idsMismatch', '')), lower(coalesce(p_line->'payload'->>'idsMismatch', '')), lower(coalesce(rp->>'idsMismatch', '')))
          or (ev in ('created', 'altered', 'imported') and not hb and not ph and og ~ '-[0-9A-Fa-f]{8}$' and mdv between 1 and 4294967295
              and lcg is not null and lower(left(og, length(lcg) + 1)) = lower(lcg) || '-'
              and lower(right(og, 8)) <> lpad(to_hex(mdv), 8, '0')), false);
  -- 52: a line is never 'duplicate' of, applied as an alteration of, deleted / cancelled against, or replaced by an entry whose
  -- type, date or number (each only when both have one) differ from the line's: the add-on's pre line of an entry made by
  -- duplicating another carries the source's GUID, MasterID and AlterID, all consistent with each other
  lw := concat_ws(' ', lt, lno, 'of ' || to_char(vd, 'DD-Mon-YYYY'));
  if og is not null and not ph and ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') then
    select true, nullif(btrim(v.vtype), ''), nullif(left(btrim(v.vno), 60), ''), v.day, coalesce(v.alter_id, 0) into cx_found, cx_t, cx_n, cx_d, cx_a from tally_vouchers v where v.book_id = p_book and v.guid = og;
    cx_found := coalesce(cx_found, false);
    -- the decision on 52: a line WITH a body (Tally's entry under the line's own GUID, naming what the line names) is the
    -- alteration of that GUID, whatever date or number the copy had; only a line without one is checked against the copy.
    -- Review of 52 (M1, M2, M3): only when the copy is not newer than the line (a late old line is 'stale' as in 51; an
    -- intermediate change is replaced by the later one); a delete / cancel only when its AlterID is not above the copy's (one
    -- above carries the entry's newer number / date: applied as in 51). L1: types in any case; L2: numbers cut as stored (60)
    dif_c := cx_found and not hb
             and case when ev in ('deleted', 'cancelled') then alt is null or alt <= cx_a else alt is null or alt >= cx_a end
             and ((lt is not null and cx_t is not null and lower(lt) <> lower(cx_t)) or (vd is not null and cx_d is not null and vd <> cx_d) or (lno is not null and cx_n is not null and lno <> cx_n));
  end if;
  if hb then
    select x into bv from jsonb_array_elements(p_line->'vouchers') x where x->>'guid' = og limit 1;
    b_t := nullif(btrim(coalesce(bv->>'type', '')), ''); b_n := nullif(left(btrim(coalesce(bv->>'no', '')), 60), ''); b_d := tally_d8(replace(coalesce(bv->>'day', ''), '-', ''));
    -- review of 52 (H): a FinCom short line's body is built from the posting, with the POSTED number, while Tally numbers the
    -- entry itself: its number is not compared (type and date are)
    sh := coalesce(lf, nullif(rp->>'fid', '')) is not null and 'true' in (lower(coalesce(p_line->>'short', '')), lower(coalesce(rp->>'short', '')));
    dif_b := (lt is not null and b_t is not null and lower(lt) <> lower(b_t)) or (vd is not null and b_d is not null and vd <> b_d) or (not sh and lno is not null and b_n is not null and lno <> b_n);
  end if;
  -- 67: an altered line WITH Tally's entry at the AlterID the copy holds, numbered otherwise than the copy: Tally renumbered it
  -- (no AlterID moves for that: tally-versions P9r, runs 37734533866 and 37754251128). Never 'duplicate': applied, the copy
  -- taking Tally's number
  renum := ev = 'altered' and hb and not mm and coalesce(cx_found, false) and alt is not null and alt = cx_a and b_n is not null and cx_n is not null and b_n <> cx_n;     -- 67
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
    if length(pltxt) > 8000 then pl := jsonb_build_object('cut', true, 'bytes', length(pltxt), 'head', left(pltxt, 8000), 'again', pl->'again'); end if;     -- 63: the marker kept on a cut payload
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
    elsif mm and not hb then
      -- 51: the ids did not belong together and the line has no entry of Tally's: never looked up by its GUID, MasterID, or type,
      -- number and date (each could name another entry); held, in the bridge's words when it gave them. A row 51 held again
      -- keeps its own words
      stt := 'held'; wy := coalesce(case when r_why like 'marked duplicate on %' then r_why end, hw,
        format('the add-on''s ids did not belong together (GUID %s is another entry''s); held until FinCom Bridge 2.2.2 sends the entry as Tally gives it', coalesce(lg, og, 'unknown')));
    elsif ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') and (dif_c or dif_b) then
      -- 52: the GUID is another entry's (in the copy, or in the body sent): held, never looked up further; the bridge's words after
      stt := 'held';
      wy := format('the add-on named entry %s, but GUID %s is %s %s; held until FinCom Bridge sends this entry as Tally gives it', lw, og,
                   case when dif_c then concat_ws(' ', cx_t, cx_n, 'of ' || to_char(cx_d, 'DD-Mon-YYYY')) else concat_ws(' ', b_t, b_n, 'of ' || to_char(b_d, 'DD-Mon-YYYY')) end,
                   case when dif_c then 'in the copy' else 'in the entry sent with the line' end) || coalesce('; ' || hw, '');
    elsif ph and ev in ('deleted', 'cancelled') then
      -- 60 (migration-50 review R3-L1): a delete / cancel under the add-on's placeholder GUID names no entry: held as a GUID-less
      -- one is (before 60 it went on to tally_ingest_delete as an entry not in the copy - since 57 "nothing to remove", applied -
      -- and a second arrival, never the same change by the placeholder, broke the line's call on applied_once)
      stt := 'held'; wy := format('no entry GUID on the line (only the add-on''s placeholder): FinCom cannot tell which entry was %s, so this line is never applied by itself; %s', ev,
                                  case when vd is null then 'no date on the line either: it stays held, and nothing in FinCom''s books changes for it' else format('uploading the Day Book for %s brings that day up to date', to_char(vd, 'DD-Mon-YYYY')) end);
    elsif og is null and ev <> 'ledger_renamed' then
      -- 50: what releases it, in words (a later line with the entry's GUID replaces it; a Day Book holding it makes it a duplicate)
      stt := 'held'; wy := case when ev in ('created', 'altered', 'imported') then coalesce(hw, 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book')     -- 51: the bridge's words when given
                                when ev in ('deleted', 'cancelled') then format('no entry GUID on the line: FinCom cannot tell which entry was %s, so this line is never applied by itself; %s', ev, case when vd is null then 'no date on the line either: it stays held, and nothing in FinCom''s books changes for it' else format('uploading the Day Book for %s brings that day up to date', to_char(vd, 'DD-Mon-YYYY')) end)     -- 60 (R3-L3 i): no date, no Day Book promised
                                else 'no GUID on the line: held, never a new row' end;
    end if;
    -- the same change already here: another arrival applied or held (owner items 26, 102)
    if stt is null and og is not null and not ph and not mm then     -- 50: the placeholder GUID is no entry's: never the same change by it; 51: nor a line whose ids did not belong together
      select 'line ' || r.id || ' (' || r.state || coalesce(', from ' || nullif(r.pc, ''), '') || ')' into t from tally_recorder_lines r
       where r.book_id = p_book and r.object_guid = og and r.alter_id is not distinct from alt and r.event = ev and r.id <> rid
         -- a held arrival is the original only when a release can apply it (review M1): an entry line with its body, a
         -- delete / cancel held for a locked month; a held line without a body never swallows the same change sent with one
         and (r.state = 'applied' or (r.state = 'held' and case when ev in ('created', 'altered', 'imported') then coalesce(r.body ? 'vouchers', false)
                                                                when ev in ('deleted', 'cancelled') then coalesce(r.held_why, '') like 'month locked%'
                                                                else true end))
       order by r.id limit 1;
      if t is not null and not renum then stt := 'duplicate'; wy := 'the same change already came as ' || t; end if;     -- 67: not a renumbering
    end if;
    if stt is null and ev in ('created', 'altered', 'imported', 'deleted', 'cancelled') then
      select true, coalesce(v.alter_id, 0), v.day, v.deleted_at into c_found, c_alter, c_day, c_del from tally_vouchers v where v.book_id = p_book and v.guid = og;
      c_found := coalesce(c_found, false);
      if ev in ('deleted', 'cancelled') then
        res := tally_ingest_delete(p_book, og, alt, ev = 'cancelled', 'recorder ' || coalesce(left(p_line->>'pc', 60), ''));
        stt := res->>'state'; wy := res->>'why';
        -- 50: an entry not in the copy: what releases it, by the line's date. Review H1 and round 2 (N1): a COMPLETE Day Book of
        -- that day (tally_days.n, the count the bridge or the upload vouched for, equals the entries the copy holds live for the
        -- day: never a short, unconfirmed empty or capped read) stored AFTER this line came, not holding the entry, proves it gone
        -- from Tally: a delete or a cancel has nothing left to do. An older kept file read again later cannot bring the entry back:
        -- tally_recorder_release_day deletes (cancels) again an entry whose applied delete (cancel) is above its version
        if stt = 'held' and coalesce((res->>'unknown')::boolean, false) then
          dt := coalesce(to_char(vd, 'DD-Mon-YYYY'), 'its date');
          select d.at, d.n, (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = vd and v.deleted_at is null) into d_at, d_n, d_live
            from tally_days d where d.book_id = p_book and d.day = vd and d.at > r_at;
          if d_at is not null and d_n = d_live then
            stt := 'applied'; wy := format('nothing to %s: the Day Book for %s, complete and stored after this change arrived, does not hold the entry', case when ev = 'deleted' then 'delete' else 'cancel' end, dt);
          elsif d_at is not null then
            wy := format('the Day Book for %s stored after this change was not complete (%s of %s entries); the entry is not in FinCom''s copy, and this line is applied by itself once a complete Day Book for that day is uploaded', dt, d_live, d_n);
          else wy := format('the entry is not in FinCom''s copy yet; it is applied by itself once a complete Day Book for %s is uploaded', dt);
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
        -- 50 (review H1; round 2: a cancel too, "nothing to cancel" leaves the entry out of the copy): the highest AlterID at which
        -- a delete or cancel of this GUID was applied
        select r.alter_id, r.event into del_alt, del_ev from tally_recorder_lines r where r.book_id = p_book and r.object_guid = og and r.event in ('deleted', 'cancelled') and r.state = 'applied'
         order by r.alter_id desc nulls last limit 1;
        then_cancel := alt is not null and del_alt > alt and del_ev = 'cancelled';     -- 60 (R3-L2)
        if stt is null then
          lk := tally_month_locked(p_book, array(select tally_d8(replace(coalesce(x->>'day', ''), '-', '')) from jsonb_array_elements(vs) x) || array[c_day, vd]);
          if lk is not null then
            stt := 'held'; wy := format('month locked: %s', to_char(lk, 'YYYY-MM'));
          elsif c_found and alt is not null and alt < c_alter then
            stt := 'stale'; wy := format('AlterID %s is older than the %s held', alt, c_alter);
          -- 50 (review H1): a delete of this entry applied at a higher AlterID (gone from Tally, perhaps never in the copy): an older
          -- line of it, late from another computer, never revives it
          elsif alt is not null and del_alt > alt and not then_cancel then     -- 60 (R3-L2): a delete only; below a cancel, see below
            stt := 'stale'; wy := format('AlterID %s is older than the %s applied at AlterID %s: an older change, not applied', alt, case when del_ev = 'deleted' then 'delete' else 'cancel' end, del_alt);
          elsif c_found and alt is not null and alt = c_alter and c_del is null and not mm and not renum then     -- 51: a line whose ids did not belong together is applied by Tally's entry, never 'duplicate'; 67: nor a renumbered one
            stt := 'duplicate'; wy := format('the copy holds this entry at AlterID %s already (from a Day Book or another line)', alt);
          elsif jsonb_array_length(vs) = 0 then
            stt := 'held'; wy := case when m_done and sh_changed then format('FinCom posting %s matched; changed in Tally after posting: the next full line or Day Book upload applies it', m_fid)
                                      when m_done then format('FinCom posting %s matched; no entry body (its posted XML could not be read): waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book', m_fid)
                                      else 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book' end;     -- 50: what releases it
            -- 51: the bridge's plain reason when it gave one (the release rules stay 50's); review L4: after 50's words of a matched
            -- short line, never instead of them
            if hw is not null then wy := case when m_done then wy || '; ' || hw else hw end; end if;
          else
            res := tally_ingest_entries(p_book, vs, p_line->'lines', not once, true);     -- 56: the recorder keeps what its request does not fetch
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
    if stt = 'held' and ev in ('created', 'altered', 'imported') and (og is null or ph) and not mm then     -- 51: never for a line whose ids did not belong together
      if dg is not null then
        select v.guid, coalesce(v.alter_id, 0), v.day, nullif(btrim(v.vtype), ''), nullif(left(btrim(v.vno), 60), '') into d_hit, d_alt, d_day, cx_t, cx_n from tally_vouchers v where v.book_id = p_book and v.guid = dg and v.deleted_at is null;
        -- 52: the entry its MasterID makes is another entry (type, date or number differ): never a duplicate of it
        if d_hit is not null and ((lt is not null and cx_t is not null and lower(lt) <> lower(cx_t)) or (vd is not null and d_day is not null and vd <> d_day) or (lno is not null and cx_n is not null and lno <> cx_n)) then
          wy := format('the add-on named entry %s, but GUID %s is %s in the copy; held until FinCom Bridge sends this entry as Tally gives it', lw, d_hit,
                       concat_ws(' ', cx_t, cx_n, 'of ' || to_char(d_day, 'DD-Mon-YYYY'))) || coalesce('; ' || hw, '');
          d_hit := null;
        end if;
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
    -- 53: a held entry line WITHOUT a body whose GUID is the placeholder or none, with a type, a number and a date (the owner's
    -- finding of 05-Oct-2026, staging's line 1: an altered line, MasterID 0, AlterID 0, which 50's rule above never takes as the
    -- change): 'duplicate' when the copy holds EXACTLY ONE live entry of the book under its company with the same type (any case,
    -- trimmed), number (trimmed, cut to 60) and date, at an AlterID above the book's starting point (tally_sync_cursor's
    -- last_voucher_alterid, recorded at start_at: the entry was saved after the bridge started recording, so the copy holds that
    -- change). No starting point recorded: never. Never an unnumbered line, a line whose ids did not belong together, a line
    -- carrying a FinCom id (its posting's own rules, 45), or a line whose MasterID makes another GUID than that entry's
    if stt = 'held' and ev in ('created', 'altered', 'imported') and (og is null or ph) and not mm and not hb     -- 53
       and jsonb_array_length(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) = 0     -- 53: no body
       and pref is not null and lt is not null and lno is not null and vd is not null then     -- 53
      fc := coalesce(lf, case when coalesce(rp->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then rp->>'fid' end, substring(coalesce(rp->>'narration', '') from 'TDSDesk:([A-Za-z0-9._-]{1,80})')) is not null;     -- 53
      select c.last_voucher_alterid into sp from tally_sync_cursor c where c.book_id = p_book and c.start_at is not null;     -- 53
      if not fc and sp is not null then     -- 53
        select count(*), min(v.guid) into s_n, s_g from tally_vouchers v     -- 53
         where v.book_id = p_book and v.day = vd and lower(btrim(v.vtype)) = lower(lt) and left(btrim(v.vno), 60) = lno and v.deleted_at is null     -- 53
           and lower(v.guid) like lower(pref) || '-%' and v.guid !~ '-0{8}$';     -- 53
        if s_n = 1 then     -- 53
          select coalesce(v.alter_id, 0), btrim(v.vtype), left(btrim(v.vno), 60), v.day into s_a, s_t, s_no, s_d from tally_vouchers v where v.book_id = p_book and v.guid = s_g;     -- 53
          -- 53 (review M1): an 'altered' line only when the entry is ABOVE the highest AlterID of any line of the book that settled
          -- (applied / duplicate / stale) and came before this one: else the copy may hold an older version of the entry (an
          -- alteration applied with its body, then altered again with the add-on's placeholder line). None such: as for created
          if ev = 'altered' then     -- 53
            select max(z.alter_id) into s_m from tally_recorder_lines z     -- 53
             where z.book_id = p_book and z.state in ('applied', 'duplicate', 'stale') and z.received_at < r_at and z.id <> rid     -- 53
               and z.event in ('created', 'altered', 'deleted', 'cancelled', 'imported') and z.alter_id < 1000000000000000;     -- 53
          end if;     -- 53
          if s_a > sp and (dg is null or lower(dg) = lower(s_g)) and (ev <> 'altered' or s_m is null or s_a > s_m) then     -- 53
            stt := 'duplicate'; wy := format('the copy holds %s %s of %s already (GUID %s, AlterID %s, from a Day Book or another line)', s_t, s_no, to_char(s_d, 'DD-Mon-YYYY'), s_g, s_a);     -- 53
          end if;     -- 53
        end if;     -- 53
      end if;     -- 53
    end if;     -- 53
    if stt = 'applied' and ev in ('created', 'altered', 'imported') and og is not null and not ph then
      -- 52: the entry this line brought
      a_t := coalesce(nullif(btrim(coalesce(vs->0->>'type', '')), ''), lt); a_n := coalesce(nullif(left(btrim(coalesce(vs->0->>'no', '')), 60), ''), lno);
      a_d := coalesce(tally_d8(replace(coalesce(vs->0->>'day', ''), '-', '')), vd);
      -- 50: a line that entered its entry replaces the held lines it stands for: the same GUID at an AlterID not above its own;
      -- the placeholder / no GUID by the GUID its MasterID makes; with no MasterID, the same type, number and date under the same
      -- company GUID (known on both sides) when this entry is the ONE live entry of the company that fits (review M1)
      update tally_recorder_lines r set state = 'replaced', held_why = format('replaced by line %s (the entry''s details arrived)', rid)
       where r.book_id = p_book and r.state = 'held' and r.id <> rid and r.event in ('created', 'altered', 'imported')
         -- 51: the line that carries the held line's entry (2.2.2: its line_id + ":resolved")
         and (r.line_id || ':resolved' = p_line->>'line_id'
         -- 51: a held line whose ids did not belong together (the bridge said so, or its stored GUID is not its MasterID's) is
         -- replaced by its ":resolved" line only, never by its GUID, MasterID, or type, number and date
         or (lower(coalesce(r.payload->>'idsMismatch', '')) <> 'true'     -- review L3: in any case
             and not coalesce(r.object_guid ~ '-[0-9A-Fa-f]{8}$' and r.object_guid !~ '-0{8}$'
                              and nullif(r.company_guid, '') is not null and lower(left(r.object_guid, length(r.company_guid) + 1)) = lower(r.company_guid) || '-'     -- review M
                              and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                              and lower(right(r.object_guid, 8)) <> lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0'), false)
         -- 52: by GUID or MasterID only a held line naming this same entry (type, date, number where both have one)
         -- review of 52 (M1): except a held intermediate change of this entry (its AlterID above the copy's before this line and
         -- below this line's): the later version replaces it
         and ((not (((nullif(btrim(r.vch_type), '') is not null and a_t is not null and lower(btrim(r.vch_type)) <> lower(a_t)) or (r.vch_date is not null and a_d is not null and r.vch_date <> a_d) or (nullif(btrim(r.vch_no), '') is not null and a_n is not null and left(btrim(r.vch_no), 60) <> a_n)) and not (coalesce(r.alter_id, 0) > coalesce(c_alter, 0) and coalesce(r.alter_id, 0) < coalesce(alt, 0)))
               and ((r.object_guid = og and coalesce(r.alter_id, 0) <= coalesce(alt, 0))
           or ((r.object_guid is null or r.object_guid ~ '-0{8}$')
               and case when (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                        then coalesce(substring(r.object_guid from '^(.+)-0{8}$'), nullif(r.company_guid, '')) || '-' || lpad(to_hex(r.master_id::bigint), 8, '0') = og
                        else coalesce(substring(r.object_guid from '^(.+)-0{8}$'), nullif(r.company_guid, '')) = substring(og from '^(.+)-[0-9A-Fa-f]{8}$')
                             and r.vch_type = coalesce(lt, vs->0->>'type') and r.vch_no = coalesce(lno, vs->0->>'no')
                             and r.vch_date = coalesce(vd, tally_d8(replace(coalesce(vs->0->>'day', ''), '-', '')))
                             and (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = r.vch_date and v.vtype = r.vch_type and v.vno = r.vch_no
                                    and v.deleted_at is null and v.guid like substring(og from '^(.+)-[0-9A-Fa-f]{8}$') || '-%' and v.guid !~ '-0{8}$') = 1 end)))
           -- 52: a numbered held line whose stored GUID is another entry in the copy (another type, date or number): by its own type,
           -- number and date under the same company, when this entry is the ONE live entry of the company that fits (50's rule)
           or (r.object_guid is not null and r.object_guid !~ '-0{8}$' and r.object_guid <> og and nullif(btrim(r.vch_no), '') is not null
               and lower(btrim(r.vch_type)) = lower(a_t) and left(btrim(r.vch_no), 60) = a_n and r.vch_date = a_d
               and exists (select 1 from tally_vouchers c where c.book_id = p_book and c.guid = r.object_guid
                            and ((nullif(btrim(c.vtype), '') is not null and lower(btrim(c.vtype)) <> lower(btrim(r.vch_type))) or (c.day is not null and c.day <> r.vch_date)
                                 or (nullif(btrim(c.vno), '') is not null and left(btrim(c.vno), 60) <> left(btrim(r.vch_no), 60))))
               and lower(coalesce(nullif(r.company_guid, ''), substring(r.object_guid from '^(.+)-[0-9A-Fa-f]{8}$'))) = lower(substring(og from '^(.+)-[0-9A-Fa-f]{8}$'))
               and (select count(*) from tally_vouchers v where v.book_id = p_book and v.day = a_d and lower(btrim(v.vtype)) = lower(a_t) and left(btrim(v.vno), 60) = a_n
                      and v.deleted_at is null and v.guid like substring(og from '^(.+)-[0-9A-Fa-f]{8}$') || '-%' and v.guid !~ '-0{8}$') = 1)
           -- 52: an unnumbered one (no number to find it by): besides its ":resolved" line, only by the GUID its MasterID makes under its
           -- company, naming this same entry
           or (r.object_guid is not null and r.object_guid !~ '-0{8}$' and nullif(btrim(r.vch_no), '') is null and nullif(r.company_guid, '') is not null
               and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
               and lower(r.company_guid) || '-' || lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0') = lower(og)
               and not ((nullif(btrim(r.vch_type), '') is not null and a_t is not null and lower(btrim(r.vch_type)) <> lower(a_t)) or (r.vch_date is not null and a_d is not null and r.vch_date <> a_d) or (nullif(btrim(r.vch_no), '') is not null and a_n is not null and left(btrim(r.vch_no), 60) <> a_n))))));
      -- 50 (review H1): the entry is in the copy now: a delete or cancel of it held "not in FinCom's copy yet" at a higher AlterID
      -- (it came first, from another computer) is applied with it, so the entry is never live while Tally has it gone
      for hd in select r.id, r.event, r.alter_id, r.pc from tally_recorder_lines r
                 where r.book_id = p_book and r.state = 'held' and r.object_guid = og and r.event in ('deleted', 'cancelled')
                   and r.alter_id > coalesce(alt, 0) and coalesce(r.held_why, '') not like 'month locked%' order by r.alter_id, r.id loop
        res2 := tally_ingest_delete(p_book, og, hd.alter_id, hd.event = 'cancelled', 'recorder ' || coalesce(hd.pc, ''));
        twin := null;
        select a.id into twin from tally_recorder_lines a where a.book_id = p_book and a.object_guid = og and a.alter_id = hd.alter_id and a.event = hd.event and a.state = 'applied' order by a.id limit 1;
        if res2->>'state' = 'applied' and twin is null then
          update tally_recorder_lines set state = 'applied', held_why = format('applied when line %s brought the entry', rid), applied_at = now() where id = hd.id;
          if tally_recorder_ids_together(hd.id) then     -- 53: only a line whose ids belong together raises the AlterID received
          insert into tally_sync_cursor (book_id, firm_id) values (p_book, b.firm_id) on conflict (book_id) do nothing;
          update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), hd.alter_id), recorder_last_at = now(), updated_at = now() where book_id = p_book;
          end if;     -- 53
        elsif res2->>'state' = 'applied' then     -- round 2 (L8): the same change from another computer, applied already
          update tally_recorder_lines set state = 'duplicate', held_why = format('the same change already came as line %s (applied)', twin), body = null where id = hd.id;
        end if;
      end loop;
    end if;
    -- 60 (migration-50 review R3-L2): a create (alter, import) late from another computer below a cancel applied for its GUID
    -- ("nothing to remove" when the cancel came first, 57): the entry is applied, then cancelled again at the cancel's AlterID, as
    -- Tally holds it (cancelled), instead of 'stale' and left out of the copy until its Day Book. 57's entry path re-applies
    -- the cancel itself when the body is stored; this call makes it sure whatever ran before (then "already cancelled")
    if stt = 'applied' and renum then     -- 67
      wy := concat_ws('; ', wy, format('renumbered in Tally: %s %s is %s %s now (the same AlterID %s)', coalesce(cx_t, lt, 'entry'), cx_n, coalesce(b_t, lt, 'entry'), b_n, alt));     -- 67
    end if;     -- 67
    if stt = 'applied' and then_cancel then
      res3 := tally_ingest_delete(p_book, og, del_alt, true, 'recorder ' || coalesce(left(p_line->>'pc', 60), ''));
      wy := concat_ws('; ', wy, format('then cancelled, as the cancel applied at AlterID %s says (%s)', del_alt, coalesce(res3->>'state', 'not done')));
    end if;
    -- 51: the line carrying the held line's entry (its line_id + ":resolved") that ends 'duplicate' (the copy holds Tally's entry
    -- already) or, review L1, 'stale' (the copy holds a newer version): the entry is in, so the held line is replaced as by an
    -- applied one
    if stt in ('duplicate', 'stale') and ev in ('created', 'altered', 'imported') and og is not null and not ph and coalesce(p_line->>'line_id', '') like '%:resolved' then
      update tally_recorder_lines r set state = 'replaced', held_why = format('replaced by line %s (the entry''s details arrived)', rid)
       where r.book_id = p_book and r.state = 'held' and r.id <> rid and r.event in ('created', 'altered', 'imported') and r.line_id || ':resolved' = p_line->>'line_id';
    end if;
    -- 51 (review L2): a held delete / cancel whose ids did not belong together (no GUID of its own) is never applied by a guess (no
    -- Day Book release: which entry it meant is not known for sure). It is replaced once the same change is applied under Tally's
    -- own GUID: its ":resolved" line, or a delete (cancel) of the GUID its MasterID makes under its company GUID; that line did
    -- the deletion (cancellation) itself
    if stt = 'applied' and ev in ('deleted', 'cancelled') and og is not null and not ph then
      update tally_recorder_lines r set state = 'replaced',
             held_why = format('replaced by line %s (the %s came with the entry''s own GUID)', rid, case when ev = 'deleted' then 'deletion' else 'cancellation' end)
       where r.book_id = p_book and r.state = 'held' and r.id <> rid and r.event = ev
         and (r.line_id || ':resolved' = p_line->>'line_id'
              or (lower(coalesce(r.payload->>'idsMismatch', '')) = 'true' and r.object_guid is null and nullif(r.company_guid, '') is not null
                  and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                  and lower(r.company_guid) || '-' || lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0') = lower(og)));
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

commit;
