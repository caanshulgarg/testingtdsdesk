-- Migration 53 (05-Oct-2026, the owner's finding on staging, book f79e4bc3): recorder line 1 (event altered, Receipt 191 of
-- 05-Oct-2026, GUID "<company GUID>-00000000": the add-on's placeholder, MasterID 0, AlterID 0, no body) stays held "waiting for
-- the entry's details ..." although FinCom's copy holds exactly one live Receipt 191 of 05-Oct-2026 (GUID ...000066c6, AlterID
-- 54391, from a Day Book): 50's rule takes an 'altered' placeholder line as settled only when the copy shows the change after
-- the line came (an AlterID above the line's 0 does not count as such, a Day Book stored before it neither). And
-- tally_sync_cursor.recorder_max_alter of that book stands at 51986, raised by lines that 51 / 52 later put back to 'held'.
-- Runs AFTER 52 (fresh database: ... -> 51 -> 52 -> 53; staging: after 52). ADD-ONLY: no table, column, row or function
-- removed; no statement that removes rows anywhere in this file, not even in a comment; safe to run twice; one transaction.
--
--   1. THE RULE. tally_recorder_line (52's text, every line kept; the lines added marked "53"): a held created / altered /
--      imported line WITHOUT a body whose GUID is the placeholder (ends -00000000) or none, with a type AND a number AND a date,
--      is 'duplicate' - "the copy holds <type> <no> of <date> already (GUID <g>, AlterID <a>, from a Day Book or another line)",
--      the copy's own type and number - when the copy holds EXACTLY ONE live entry of the same book under the line's company
--      (its GUID prefix) with the same type (any case, trimmed), number (trimmed, cut to 60) and date, AND that entry's AlterID
--      is above the book's starting point (tally_sync_cursor.last_voucher_alterid, recorded at start_at by tally_start_point or
--      the first gap check, 44 / 46 / 47). No starting point recorded: never. Never an unnumbered line; never a line whose ids
--      did not belong together (idsMismatch, 51); never a line carrying a FinCom id (fid / "TDSDesk:" narration: its posting's
--      own rules, 45); never when the line's MasterID makes another GUID than that entry's. Applied in tally_recorder_line, so
--      new lines and held lines run again (the owner's release, a Day Book day stored: tally_recorder_release_day) get it.
--      tally_recorder_release_day (50's text but the lines marked "53") finds such a line by its type in any case and its number
--      trimmed (as the line compares them), so a Day Book stored later holding the entry settles it.
--      THE CORRECTION (no row removed): held rows of that kind received before 06-Oct-2026 00:00 India time -> 'duplicate' with
--      the same words (body, payload, released_at untouched). On staging: line 1 only (line 4, Receipt 192, has no entry in the
--      copy; line 17, Receipt 212, none yet).
--   2. recorder_max_alter (the highest AlterID received, which the gap check counts as received). Recomputed once: per book, the
--      highest AlterID (below 10^15) of its entry lines (created / altered / deleted / cancelled / imported) that ended applied,
--      duplicate or stale and whose ids belong together - the GUID is no placeholder and its last 8 hex digits are the line's
--      MasterID in hex, or the body is Tally's entry under that GUID (tally_recorder_ids_together, new, granted to nobody);
--      null when none. An UPDATE of that column alone, only where it differs. From now on the functions raise it only from such
--      lines: tally_recorder_apply (50's), tally_recorder_release_day (50's), tally_recorder_release_held (44's),
--      tally_recorder_short_retry (45's) and tally_recorder_line's held delete applied with its entry (52's) each check
--      tally_recorder_ids_together on the stored line before raising it. CONFIRMED (51's review L2): every raise already
--      required a line that ended applied / duplicate / stale, and no function puts such a line back to 'held' (only held
--      lines are run again: the owner's release refuses another state, the day release and the short retry select held ones;
--      every other update of a line is held -> replaced / applied / duplicate); only 51's and 52's corrections re-held settled
--      lines, which is what left 51986 behind. So no recompute on re-hold is needed in the functions.
--   Functions replaced (same arguments, security definer, search_path = public, pg_temp, grants as before): tally_recorder_line
--   (nobody), tally_recorder_apply (service role), tally_recorder_release_day (nobody), tally_recorder_release_held
--   (authenticated), tally_recorder_short_retry (service role). Added: tally_recorder_ids_together (nobody). Nothing else is
--   touched. Tested on pg_stand only: tests/run_migration53.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- 2. whose ids belong together (internal: granted to nobody)
create or replace function public.tally_recorder_ids_together(p_line bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  -- a recorder line whose ids belong together: a GUID that is no placeholder, and its last 8 hex digits are its MasterID in hex,
  -- or its body carries Tally's entry under that GUID
  select coalesce((select nullif(r.object_guid, '') is not null and r.object_guid !~ '-0{8}$'
                          and (exists (select 1 from jsonb_array_elements(case when jsonb_typeof(r.body->'vouchers') = 'array' then r.body->'vouchers' else '[]'::jsonb end) e where e->>'guid' = r.object_guid)
                               or (r.object_guid ~ '-[0-9A-Fa-f]{8}$'
                                   and (case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end) between 1 and 4294967295
                                   and lower(right(r.object_guid, 8)) = lpad(to_hex(case when coalesce(r.master_id, '') ~ '^[0-9]{1,10}$' then r.master_id::bigint else 0 end), 8, '0')))
                     from tally_recorder_lines r where r.id = p_line), false)
$function$;
revoke all on function public.tally_recorder_ids_together(bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- 1. 52's line: a placeholder line whose entry the copy holds is settled
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
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
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
    elsif og is null and ev <> 'ledger_renamed' then
      -- 50: what releases it, in words (a later line with the entry's GUID replaces it; a Day Book holding it makes it a duplicate)
      stt := 'held'; wy := case when ev in ('created', 'altered', 'imported') then coalesce(hw, 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book')     -- 51: the bridge's words when given
                                when ev in ('deleted', 'cancelled') then format('no entry GUID on the line: FinCom cannot tell which entry was %s, so this line is never applied by itself; uploading the Day Book for %s brings that day up to date', ev, coalesce(to_char(vd, 'DD-Mon-YYYY'), 'its date'))
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
      if t is not null then stt := 'duplicate'; wy := 'the same change already came as ' || t; end if;
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
        if stt is null then
          lk := tally_month_locked(p_book, array(select tally_d8(replace(coalesce(x->>'day', ''), '-', '')) from jsonb_array_elements(vs) x) || array[c_day, vd]);
          if lk is not null then
            stt := 'held'; wy := format('month locked: %s', to_char(lk, 'YYYY-MM'));
          elsif c_found and alt is not null and alt < c_alter then
            stt := 'stale'; wy := format('AlterID %s is older than the %s held', alt, c_alter);
          -- 50 (review H1): a delete of this entry applied at a higher AlterID (gone from Tally, perhaps never in the copy): an older
          -- line of it, late from another computer, never revives it
          elsif alt is not null and del_alt > alt then
            stt := 'stale'; wy := format('AlterID %s is older than the %s applied at AlterID %s: an older change, not applied', alt, case when del_ev = 'deleted' then 'delete' else 'cancel' end, del_alt);
          elsif c_found and alt is not null and alt = c_alter and c_del is null and not mm then     -- 51: a line whose ids did not belong together is applied by Tally's entry, never 'duplicate'
            stt := 'duplicate'; wy := format('the copy holds this entry at AlterID %s already (from a Day Book or another line)', alt);
          elsif jsonb_array_length(vs) = 0 then
            stt := 'held'; wy := case when m_done and sh_changed then format('FinCom posting %s matched; changed in Tally after posting: the next full line or Day Book upload applies it', m_fid)
                                      when m_done then format('FinCom posting %s matched; no entry body (its posted XML could not be read): waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book', m_fid)
                                      else 'waiting for the entry''s details from FinCom Bridge (it asks Tally again on its next run); or upload this day''s Day Book' end;     -- 50: what releases it
            -- 51: the bridge's plain reason when it gave one (the release rules stay 50's); review L4: after 50's words of a matched
            -- short line, never instead of them
            if hw is not null then wy := case when m_done then wy || '; ' || hw else hw end; end if;
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
          if s_a > sp and (dg is null or lower(dg) = lower(s_g)) then     -- 53
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

-- ---------------------------------------------------------------- 2. 50's apply: the AlterID received only from lines whose ids belong together
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
       and left(btrim(x->>'object_guid'), 100) !~ '-0{8}$'     -- 50 (review L4): the add-on's placeholder GUID is no entry's: its AlterID is never received
       -- 53: and only a line whose ids belong together (its GUID's last 8 hex digits are its MasterID, or its body is Tally's entry
       -- under its GUID): a line 51 / 52 would hold today never leaves the number raised
       and tally_recorder_ids_together((one->>'id')::bigint) then
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

-- ---------------------------------------------------------------- 1. and 2. 50's day release: the type / number as the line compares them; the raise as above
create or replace function public.tally_recorder_release_day(p_book uuid, p_day date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_recorder_lines%rowtype; one jsonb; prev text := coalesce(current_setting('fincom.recorder_release', true), ''); n int := 0; a int := 0; f uuid; st text;
  x record; redone int := 0;
begin
  if p_book is null or p_day is null then return jsonb_build_object('ok', true, 'ran', 0, 'applied', 0); end if;
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then return jsonb_build_object('ok', true, 'ran', 0, 'applied', 0); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  -- round 2 (N1): a Day Book read again (an older kept file) never brings back an entry that a delete (cancel) line applied at a
  -- higher AlterID than the day's version of it took away: deleted (cancelled) again at once, through tally_ingest_delete
  perform set_config('fincom.recorder_release', '0', true);
  for x in select v.guid, l.event, max(l.alter_id) as alt from tally_vouchers v
             join tally_recorder_lines l on l.book_id = p_book and l.object_guid = v.guid and l.state = 'applied' and l.event in ('deleted', 'cancelled')
            where v.book_id = p_book and v.day = p_day and v.deleted_at is null and coalesce(l.alter_id, 0) > coalesce(v.alter_id, 0)
              and (l.event = 'deleted' or not v.cancelled)
            group by v.guid, l.event order by v.guid, l.event
  loop
    begin
      perform tally_ingest_delete(p_book, x.guid, x.alt, x.event = 'cancelled', 'recorder: an older Day Book read again');
      redone := redone + 1;
    exception when others then
      raise log 'tally_recorder_release_day: entry % of book % not %: % %', x.guid, p_book, x.event, sqlstate, sqlerrm;
    end;
  end loop;
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
              -- 53: the type in any case, the number trimmed and cut to 60, as tally_recorder_line compares them
              or ((l.object_guid is null or l.object_guid ~ '-0{8}$') and exists (select 1 from dv where lower(btrim(dv.vtype)) = lower(btrim(l.vch_type)) and left(btrim(dv.vno), 60) = left(btrim(l.vch_no), 60)))))
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
        if r.alter_id is not null and r.alter_id < 1000000000000000 and coalesce(r.object_guid, '') !~ '-0{8}$'
           and tally_recorder_ids_together(r.id) then     -- 53: only a line whose ids belong together
          insert into tally_sync_cursor (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
          update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), r.alter_id), recorder_last_at = now(), updated_at = now() where book_id = p_book;
        end if;
      end if;
    exception when others then
      raise log 'tally_recorder_release_day: line % of book % not run again: % %', r.id, p_book, sqlstate, sqlerrm;
    end;
  end loop;
  perform set_config('fincom.recorder_release', prev, true);
  return jsonb_build_object('ok', true, 'ran', n, 'applied', a, 'redone', redone);
end $function$;
revoke all on function public.tally_recorder_release_day(uuid, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- 2. 44's owner's release: the raise as above
create or replace function public.tally_recorder_release_held(p_line bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); r tally_recorder_lines%rowtype; one jsonb;
begin
  if f is null or not exists (select 1 from members x where x.user_id = auth.uid() and x.firm_id = f and x.role = 'owner' and coalesce(x.active, true))
    then raise exception 'only an owner of the firm can release a held line' using errcode = '42501'; end if;
  select * into r from tally_recorder_lines where id = p_line and firm_id = f;
  if r.id is null then raise exception 'not a line of your firm'; end if;
  if r.state <> 'held' then raise exception 'line % is %, not held', p_line, r.state; end if;
  if r.event in ('ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted') then     -- every ledger line (review L4)
    return jsonb_build_object('ok', false, 'id', p_line, 'line_id', r.line_id, 'state', 'held', 'why', 'a ledger line is applied by the bridge''s next ledger list, not by a release');
  end if;
  perform pg_advisory_xact_lock(hashtext(r.book_id::text));
  perform set_config('fincom.recorder_release', p_line::text, true);
  one := tally_recorder_line(r.book_id, r.device_id, jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id,
           'vch_date', r.vch_date, 'vch_no', r.vch_no, 'pc', r.pc, 'bridge', r.bridge) || coalesce(r.body, '{}'::jsonb), p_line);
  perform set_config('fincom.recorder_release', '', true);
  -- stamped released only when the release applied it; one that stays held (its month still locked) is not (review L3)
  if one->>'state' = 'applied' then
    update tally_recorder_lines set released_at = now(), released_by = auth.uid() where id = p_line;
    -- applied now: its AlterID counts for the gap check as any applied line's (review L2)
    if r.alter_id is not null and r.alter_id < 1000000000000000 and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported')
       and tally_recorder_ids_together(p_line) then     -- 53: only a line whose ids belong together
      insert into tally_sync_cursor (book_id, firm_id) values (r.book_id, f) on conflict (book_id) do nothing;
      update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), r.alter_id), recorder_last_at = now(), updated_at = now() where book_id = r.book_id;
    end if;
  end if;
  return jsonb_build_object('ok', true) || one;
end $function$;
revoke all on function public.tally_recorder_release_held(bigint) from public, anon;
grant execute on function public.tally_recorder_release_held(bigint) to authenticated;

-- ---------------------------------------------------------------- 2. 45's short retry: the raise as above
create or replace function public.tally_recorder_short_retry(p_firm uuid, p_book uuid, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare x jsonb; r tally_recorder_lines%rowtype; res jsonb := '[]'::jsonb; one jsonb; mx bigint; rw bigint;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then raise exception 'no such book'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'the lines must be a list'; end if;
  if jsonb_array_length(p_lines) > 1000 then raise exception 'at most 1000 lines a call (% given)', jsonb_array_length(p_lines); end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  for x in select e from jsonb_array_elements(p_lines) with ordinality as t(e, o) order by o loop
    rw := case when coalesce(x->>'row', '') ~ '^[0-9]{1,18}$' then (x->>'row')::bigint end;
    r := null;
    select * into r from tally_recorder_lines l where l.id = rw and l.book_id = p_book and l.firm_id = p_firm and l.state = 'held'
       and l.held_why like 'FinCom id % matches no posting of this firm' and l.event in ('created', 'imported') and coalesce(l.payload->>'fid', '') <> '';
    if r.id is null then
      res := res || jsonb_build_array(jsonb_build_object('row', rw, 'line_id', x->>'line_id', 'state', 'skipped', 'why', 'not a held short line of this book'));
      continue;
    end if;
    one := tally_recorder_line(p_book, r.device_id, jsonb_build_object('line_id', r.line_id, 'event', r.event, 'object_guid', r.object_guid, 'alter_id', r.alter_id,
             'master_id', r.master_id, 'vch_no', r.vch_no, 'vch_date', r.vch_date, 'pc', r.pc, 'bridge', r.bridge, 'fid', r.payload->>'fid', 'short', true,
             'vouchers', case when jsonb_typeof(x->'vouchers') = 'array' then x->'vouchers' else '[]'::jsonb end,
             'lines', case when jsonb_typeof(x->'lines') = 'array' then x->'lines' else '[]'::jsonb end), r.id);
    res := res || jsonb_build_array(jsonb_build_object('row', r.id) || (one - 'id'));
    if one->>'state' in ('applied', 'duplicate', 'stale') and r.alter_id is not null and r.alter_id < 1000000000000000 and coalesce(r.object_guid, '') <> ''
       and tally_recorder_ids_together(r.id) then     -- 53: only a line whose ids belong together
      mx := greatest(mx, r.alter_id);
    end if;
  end loop;
  if mx is not null then
    insert into tally_sync_cursor (book_id, firm_id) values (p_book, p_firm) on conflict (book_id) do nothing;
    update tally_sync_cursor set recorder_max_alter = greatest(coalesce(recorder_max_alter, 0), mx), recorder_last_at = now(), updated_at = now() where book_id = p_book;
  end if;
  return jsonb_build_object('ok', true, 'results', res,
    'applied', (select count(*) from jsonb_array_elements(res) e where e->>'state' = 'applied'),
    'held', (select count(*) from jsonb_array_elements(res) e where e->>'state' = 'held'),
    'skipped', (select count(*) from jsonb_array_elements(res) e where e->>'state' = 'skipped'));
end $function$;
revoke all on function public.tally_recorder_short_retry(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_recorder_short_retry(uuid, uuid, jsonb) to service_role;

-- ---------------------------------------------------------------- 1. the held placeholder lines whose entry the copy holds: 'duplicate'
update public.tally_recorder_lines r set state = 'duplicate',
       held_why = format('the copy holds %s %s of %s already (GUID %s, AlterID %s, from a Day Book or another line)',
                         btrim(v.vtype), left(btrim(v.vno), 60), to_char(v.day, 'DD-Mon-YYYY'), v.guid, coalesce(v.alter_id, 0))
  from public.tally_vouchers v, public.tally_sync_cursor c
 where r.state = 'held' and r.event in ('created', 'altered', 'imported')
   and r.received_at < timestamptz '2026-10-06 00:00:00+05:30'     -- bounded to the rows received on or before 05-Oct-2026 (India time)
   and (r.object_guid is null or r.object_guid ~ '-0{8}$')
   and jsonb_array_length(case when jsonb_typeof(r.body->'vouchers') = 'array' then r.body->'vouchers' else '[]'::jsonb end) = 0     -- no body
   and lower(coalesce(r.payload->>'idsMismatch', '')) <> 'true'
   and not (coalesce(r.payload->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' or coalesce(r.payload->>'narration', '') ~ 'TDSDesk:[A-Za-z0-9._-]')
   and nullif(btrim(r.vch_type), '') is not null and nullif(btrim(r.vch_no), '') is not null and r.vch_date is not null
   and nullif(btrim(coalesce(substring(r.object_guid from '^(.+)-0{8}$'), r.company_guid, '')), '') is not null
   -- the book's starting point, recorded
   and c.book_id = r.book_id and c.start_at is not null and c.last_voucher_alterid is not null
   -- the one live entry of the line's company with its type, number and date, above the starting point
   and v.book_id = r.book_id and v.day = r.vch_date and lower(btrim(v.vtype)) = lower(btrim(r.vch_type)) and left(btrim(v.vno), 60) = left(btrim(r.vch_no), 60)
   and v.deleted_at is null and v.guid !~ '-0{8}$'
   and lower(v.guid) like lower(coalesce(substring(r.object_guid from '^(.+)-0{8}$'), btrim(r.company_guid))) || '-%'
   and coalesce(v.alter_id, 0) > c.last_voucher_alterid
   and (select count(*) from public.tally_vouchers w
         where w.book_id = r.book_id and w.day = r.vch_date and lower(btrim(w.vtype)) = lower(btrim(r.vch_type)) and left(btrim(w.vno), 60) = left(btrim(r.vch_no), 60)
           and w.deleted_at is null and w.guid !~ '-0{8}$' and lower(w.guid) like lower(coalesce(substring(r.object_guid from '^(.+)-0{8}$'), btrim(r.company_guid))) || '-%') = 1
   -- a MasterID, when the line has one, makes that entry's GUID
   and case when (case when coalesce(btrim(r.master_id), '') ~ '^[0-9]{1,10}$' then btrim(r.master_id)::bigint else 0 end) between 1 and 4294967295
            then lower(v.guid) = lower(coalesce(substring(r.object_guid from '^(.+)-0{8}$'), btrim(r.company_guid)) || '-' || lpad(to_hex(btrim(r.master_id)::bigint), 8, '0'))
            else true end;

-- ---------------------------------------------------------------- 2. recorder_max_alter recomputed from the settled lines whose ids belong together
update public.tally_sync_cursor c set recorder_max_alter = s.mx
  from (select k.book_id,
               (select max(r.alter_id) from public.tally_recorder_lines r
                 where r.book_id = k.book_id and r.state in ('applied', 'duplicate', 'stale') and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported')
                   and r.alter_id is not null and r.alter_id < 1000000000000000 and public.tally_recorder_ids_together(r.id)) as mx
          from public.tally_sync_cursor k) s
 where s.book_id = c.book_id and c.recorder_max_alter is distinct from s.mx;

commit;
