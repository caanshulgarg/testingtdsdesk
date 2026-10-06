-- Migration 56 (06-Oct-2026, FinCom Bridge 2.3.0: a recorder line keeps the fields its request does not fetch). Runs AFTER 55
-- (fresh database: ... -> 54 -> 55 -> 56; staging: after 55). ADD-ONLY: no table, column, row or function removed; no
-- statement in this file removes rows, not even in a comment; safe to run twice; one transaction (lock_timeout 10 s).
-- Functions are created or replaced; one table (the repair's log) added if missing. Nothing is repaired by running it.
--
--   THE FAULT (live in 2.3.0). A recorder line (the live route: tally_recorder_line -> 48's tally_ingest_entries) applied to
--   an entry already loaded from a Day Book upload wrote the entry afresh from what the live request fetched. That request
--   does not fetch the party's GSTIN, the place of supply, the reference no. / date, the company's GSTIN, or a line's HSN /
--   rate, so 48's upsert (gstin = excluded.gstin, ...) blanked them and the re-inserted lines came without HSN / rate. The
--   old values are on the entry's earlier tally_voucher_versions row.
--
--   1. KEEP (the recorder only). tally_ingest_entries(p_book, p_vouchers, p_lines, p_rebuild, p_keep boolean): with p_keep
--      false it is exactly 48's 4-argument form (it calls it with the same arguments). With p_keep true, before calling it:
--        - each sent entry already stored: a blank gstin / pos / ref / cmp, or a missing refDate, is filled with the stored
--          non-blank value (tally_recorder_keep_vouchers); a non-blank value sent always wins (a NEW value updates it);
--        - each sent line with a blank HSN or no rate takes it from the entry's stored line with the same ledger: the one
--          with the same amount when several, else the one at the same place among that ledger's lines
--          (tally_recorder_keep_lines). A value sent always wins.
--      48's 4-argument and 44's 3-argument forms are not touched: the Day Book days path (tally_ingest_day -> the
--      3-argument form) and every other caller keep today's behaviour exactly: a full Day Book is authoritative.
--      tally_recorder_line: 53's text, the one call changed to tally_ingest_entries(p_book, vs, p_line->'lines', not once,
--      true). Every caller of the line (tally_recorder_apply, the drain, the releases, the short retry) is a recorder path.
--   2. REPAIR (not run here). tally_recorder_restore_fields(p_book uuid) returns jsonb, the service role's / the owner's
--      (tally_service_or_owner()). For the book's live entries the recorder applied (a tally_recorder_lines row, state
--      'applied', event created / altered / imported, its object_guid the entry): a field blank NOW (gstin, pos, ref,
--      ref_date, cmp_gstin; a line's hsn / rate) is restored from the LATEST version row at or below the entry's AlterID
--      that has it, when every later version row of the entry is one the recorder applied (its AlterID is an applied
--      line's) and the entry's day was not read from a Day Book after the recorder's last apply (tally_days.at: a Day Book
--      read after it is authoritative). Lines: by ledger; the same amount first, else the same place among the ledger's
--      lines. It writes only blank fields (the update itself re-checks blank), never a non-blank one, and logs every
--      field it writes in tally_recorder_restore_log (book, entry, field, line ledger / amount, old, new, the version's
--      AlterID, who, when). A second run finds nothing to do.
--      tally_recorder_blanked(p_book uuid): the same rules, read-only: the entries and fields the repair would write.
--      The plain read-only query (runs before this migration too): tests/check_recorder_blanked.sql.
--   Every function: security definer, search_path = public, pg_temp. tally_recorder_keep_vouchers / _lines, the 5-argument
--   tally_ingest_entries and tally_recorder_line granted to nobody (run as the owner by the line); the repair and the
--   read-only list the service role's. Tested by tests/run_migration56.py (pg_stand) and tests/run_migration_order.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- 1. keep: the entries' fields
-- p_vouchers as sent, each entry already stored given back its stored non-blank gstin / pos / ref / refDate / cmp where the
-- sent one is blank; a sent value always wins; the order and every other key unchanged
create or replace function public.tally_recorder_keep_vouchers(p_book uuid, p_vouchers jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
begin
  if jsonb_typeof(p_vouchers) is distinct from 'array' then return p_vouchers; end if;
  return (
    select coalesce(jsonb_agg(
             case when v.guid is null then x
                  else x
                    || case when btrim(coalesce(x->>'gstin', '')) = '' and btrim(coalesce(v.gstin, '')) <> '' then jsonb_build_object('gstin', v.gstin) else '{}'::jsonb end
                    || case when btrim(coalesce(x->>'pos', '')) = '' and btrim(coalesce(v.pos, '')) <> '' then jsonb_build_object('pos', v.pos) else '{}'::jsonb end
                    || case when btrim(coalesce(x->>'ref', '')) = '' and btrim(coalesce(v.ref, '')) <> '' then jsonb_build_object('ref', v.ref) else '{}'::jsonb end
                    || case when tally_d8(x->>'refDate') is null and v.ref_date is not null then jsonb_build_object('refDate', to_char(v.ref_date, 'YYYYMMDD')) else '{}'::jsonb end
                    || case when btrim(coalesce(x->>'cmp', '')) = '' and btrim(coalesce(v.cmp_gstin, '')) <> '' then jsonb_build_object('cmp', v.cmp_gstin) else '{}'::jsonb end
             end order by o), '[]'::jsonb)
      from jsonb_array_elements(p_vouchers) with ordinality as t(x, o)
      left join tally_vouchers v on v.book_id = p_book and v.guid = x->>'guid' and coalesce(x->>'guid', '') <> ''
  );
end $function$;
revoke all on function public.tally_recorder_keep_vouchers(uuid, jsonb) from public, anon, authenticated, service_role;

-- p_lines as sent ([guid, ledger, amount, hsn, rate, bills]), a line with a blank hsn or no rate given the stored line's of
-- the same entry and ledger: the same amount first, else the same place among that ledger's lines (by amount); a sent
-- value always wins; a line with both sent, or with no stored line of its ledger, is passed as sent
create or replace function public.tally_recorder_keep_lines(p_book uuid, p_lines jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
begin
  if jsonb_typeof(p_lines) is distinct from 'array' then return p_lines; end if;
  return (
    with inc as (
      select x, o, x->>0 as guid, tally_nm(x->>1) as ledger, case when coalesce(x->>2, '') ~ '^-?[0-9]+(\.[0-9]+)?$' then (x->>2)::numeric end as amount,
             btrim(coalesce(x->>3, '')) = '' as no_hsn, nullif(btrim(coalesce(x->>4, '')), '') is null as no_rate
        from jsonb_array_elements(p_lines) with ordinality as t(x, o)
       where jsonb_typeof(x) = 'array'
    ), inc_r as (
      select i.*, row_number() over (partition by i.guid, i.ledger order by i.amount, i.o) as rk from inc i
    ), old as (
      select l.guid, l.ledger, l.amount, l.hsn, l.rate, row_number() over (partition by l.guid, l.ledger order by l.amount, l.ctid) as rk
        from tally_lines l where l.book_id = p_book and l.guid in (select guid from inc where no_hsn or no_rate)
    ), pick as (
      select i.o, i.x, i.no_hsn, i.no_rate, m.hsn, m.rate
        from inc_r i
        left join lateral (
          select o2.hsn, o2.rate from old o2 where o2.guid = i.guid and o2.ledger = i.ledger
           order by (o2.amount = i.amount) desc nulls last, abs(o2.rk - i.rk), o2.rk limit 1) m on (i.no_hsn or i.no_rate)
    )
    select coalesce(jsonb_agg(
             case when p.o is null then a.x
                  when (p.no_hsn and btrim(coalesce(p.hsn, '')) <> '') or (p.no_rate and p.rate is not null) then
                    jsonb_build_array(p.x->0, p.x->1, p.x->2,
                      case when p.no_hsn and btrim(coalesce(p.hsn, '')) <> '' then to_jsonb(p.hsn) else p.x->3 end,
                      case when p.no_rate and p.rate is not null then to_jsonb(p.rate) else p.x->4 end)
                    || coalesce((select jsonb_agg(e order by k) from jsonb_array_elements(p.x) with ordinality as z(e, k) where k > 5), '[]'::jsonb)
                  else p.x end order by a.o), '[]'::jsonb)
      from jsonb_array_elements(p_lines) with ordinality as a(x, o)
      left join pick p on p.o = a.o
  );
end $function$;
revoke all on function public.tally_recorder_keep_lines(uuid, jsonb) from public, anon, authenticated, service_role;

-- the entry path with the recorder's keep: p_keep false is 48's 4-argument form exactly (the same arguments passed on)
create or replace function public.tally_ingest_entries(p_book uuid, p_vouchers jsonb, p_lines jsonb, p_rebuild boolean, p_keep boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare vs jsonb := p_vouchers; ls jsonb := p_lines;
begin
  if not tally_service_or_owner() and coalesce(current_setting('fincom.recorder_release', true), '') !~ '^[0-9]+$' then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(p_keep, false) then
    perform pg_advisory_xact_lock(hashtext(p_book::text));     -- the stored values read under the lock the entry path takes (re-entrant)
    vs := tally_recorder_keep_vouchers(p_book, p_vouchers);
    ls := tally_recorder_keep_lines(p_book, p_lines);
  end if;
  return tally_ingest_entries(p_book, vs, ls, p_rebuild);
end $function$;
revoke all on function public.tally_ingest_entries(uuid, jsonb, jsonb, boolean, boolean) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- 1. 53's line: its entry path keeps (the one call changed)
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

-- ---------------------------------------------------------------- 2. the repair's log (kept: no row is ever removed)
create table if not exists public.tally_recorder_restore_log (
  id          bigserial primary key,
  firm_id     uuid not null,
  book_id     uuid not null,
  guid        text not null,
  field       text not null check (field in ('gstin', 'pos', 'ref', 'ref_date', 'cmp_gstin', 'hsn', 'rate')),
  ledger      text,
  amount      numeric,
  old_value   text not null default '',
  new_value   text not null,
  from_alter  bigint,
  by_user     uuid,
  by_role     text not null default '',
  at          timestamptz not null default now()
);
create index if not exists tally_recorder_restore_log_book on public.tally_recorder_restore_log (book_id, at desc);
alter table public.tally_recorder_restore_log enable row level security;
revoke insert, update, delete on public.tally_recorder_restore_log from anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_recorder_restore_log' and policyname = 'tally_recorder_restore_log_read') then
    create policy tally_recorder_restore_log_read on public.tally_recorder_restore_log for select to authenticated using (firm_id = my_firm());
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tally_recorder_restore_log_kept' and tgrelid = 'public.tally_recorder_restore_log'::regclass) then
    create trigger tally_recorder_restore_log_kept before delete on public.tally_recorder_restore_log for each row execute function public.tally_control_kept();
  end if;
end $$;

-- ---------------------------------------------------------------- 3. read-only: what the recorder blanked (the repair's rules)
-- one row per field to restore: the entry, the field ('gstin', 'pos', 'ref', 'ref_date', 'cmp_gstin'; a line's 'hsn' / 'rate'
-- with its ledger and amount), the value now (blank) and the value the version row had, that version's AlterID; line_at is
-- the line's row (the repair's own use)
create or replace function public.tally_recorder_blanked(p_book uuid)
returns table (guid text, vtype text, vno text, day date, alter_id bigint, field text, ledger text, amount numeric, old_value text, new_value text, from_alter bigint, line_at tid)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
#variable_conflict use_column
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
  with rec as (
    -- the entries the recorder applied: the AlterIDs it applied and when it last did
    select r.object_guid as g, array_agg(distinct r.alter_id) filter (where r.alter_id is not null) as alters, max(r.alter_id) as max_alter, max(r.applied_at) as last_at
      from tally_recorder_lines r
     where r.book_id = p_book and r.state = 'applied' and r.event in ('created', 'altered', 'imported') and r.object_guid is not null
     group by r.object_guid
  ), ent as (
    select v.*, rec.alters, rec.max_alter
      from tally_vouchers v join rec on rec.g = v.guid
     where v.book_id = p_book and v.deleted_at is null
       -- a Day Book read of the entry's day after the recorder's last apply is authoritative: nothing restored
       and not exists (select 1 from tally_days d where d.book_id = v.book_id and d.day = v.day and d.at > rec.last_at)
  ), fld as (
    select e.guid, e.vtype, e.vno, e.day, e.alter_id, k.f, coalesce(to_jsonb(e)->>k.f, '') as now_v, e.alters, e.max_alter
      from ent e cross join (values ('gstin'), ('pos'), ('ref'), ('ref_date'), ('cmp_gstin')) as k(f)
     where btrim(coalesce(to_jsonb(e)->>k.f, '')) = ''
  ), fsrc as (
    select f.*, s.payload->>f.f as src_v, s.alter_id as src_alter
      from fld f
      join lateral (select ver.payload, ver.alter_id from tally_voucher_versions ver
                     where ver.book_id = p_book and ver.tally_guid = f.guid and ver.alter_id <= coalesce(f.alter_id, 0)
                       and btrim(coalesce(ver.payload->>f.f, '')) <> ''
                     order by ver.alter_id desc limit 1) s on true
  ), lns as (
    select e.guid, e.vtype, e.vno, e.day, e.alter_id, l.ledger, l.amount, l.hsn, l.rate, l.ctid as at_,
           row_number() over (partition by l.guid, l.ledger order by l.amount, l.ctid) as rk, e.alters, e.max_alter
      from ent e join tally_lines l on l.book_id = p_book and l.guid = e.guid
  ), lfld as (
    select n.*, k.f from lns n cross join (values ('hsn'), ('rate')) as k(f)
     where (k.f = 'hsn' and btrim(coalesce(n.hsn, '')) = '') or (k.f = 'rate' and n.rate is null)
  ), lsrc as (
    select n.*, s.v as src_v, s.alter_id as src_alter
      from lfld n
      join lateral (
        select case when n.f = 'hsn' then z.el->>2 else z.el->>3 end as v, ver.alter_id
          from tally_voucher_versions ver
          cross join lateral (select el, row_number() over (order by case when el->>1 ~ '^-?[0-9]+(\.[0-9]+)?$' then (el->>1)::numeric end, ord) as rk
                                from jsonb_array_elements(case when jsonb_typeof(ver.lines) = 'array' then ver.lines else '[]'::jsonb end) with ordinality as w(el, ord)
                               where jsonb_typeof(el) = 'array' and el->>0 = n.ledger) z
         where ver.book_id = p_book and ver.tally_guid = n.guid and ver.alter_id <= coalesce(n.alter_id, 0)
           and btrim(coalesce(case when n.f = 'hsn' then z.el->>2 else z.el->>3 end, '')) <> ''
         order by ver.alter_id desc, (z.el->>1 = n.amount::text or (case when z.el->>1 ~ '^-?[0-9]+(\.[0-9]+)?$' then (z.el->>1)::numeric end) = n.amount) desc, abs(z.rk - n.rk), z.rk
         limit 1) s on true
  ), allf as (
    select x.guid, x.vtype, x.vno, x.day, x.alter_id, x.f, null::text as ledger, null::numeric as amount, x.now_v, x.src_v, x.src_alter, null::tid as at_, x.alters, x.max_alter from fsrc x
    union all
    select y.guid, y.vtype, y.vno, y.day, y.alter_id, y.f, y.ledger, y.amount, coalesce(case when y.f = 'hsn' then y.hsn else y.rate::text end, ''), y.src_v, y.src_alter, y.at_, y.alters, y.max_alter from lsrc y
  )
  select a.guid, a.vtype, a.vno, a.day, a.alter_id, a.f, a.ledger, a.amount, a.now_v, a.src_v, a.src_alter, a.at_
    from allf a
   -- the recorder applied at or after the version that had it, and every later version row is one the recorder applied
   where a.max_alter >= a.src_alter
     and not exists (select 1 from tally_voucher_versions w where w.book_id = p_book and w.tally_guid = a.guid
                        and w.alter_id > a.src_alter and w.alter_id <= coalesce(a.alter_id, 0) and not (w.alter_id = any(coalesce(a.alters, '{}'))))
   order by a.day, a.vno, a.guid, a.f, a.ledger;
end $function$;
revoke all on function public.tally_recorder_blanked(uuid) from public, anon, authenticated;
grant execute on function public.tally_recorder_blanked(uuid) to service_role;

-- ---------------------------------------------------------------- 4. the repair (not run here)
create or replace function public.tally_recorder_restore_fields(p_book uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; r record; o record; n int; nv int := 0; nl int := 0; sh boolean; sr boolean; who uuid := auth.uid(); rl text := coalesce(auth.role(), session_user::text);
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext(p_book::text));
  select firm_id into f from tally_books where book_id = p_book;
  if f is null then raise exception 'no such book'; end if;
  -- the entries' fields: each written only while blank
  for r in select * from tally_recorder_blanked(p_book) x where x.field not in ('hsn', 'rate') order by x.guid, x.field loop
    n := 0;
    if r.field = 'gstin' then update tally_vouchers v set gstin = left(upper(r.new_value), 15) where v.book_id = p_book and v.guid = r.guid and btrim(coalesce(v.gstin, '')) = '';
    elsif r.field = 'pos' then update tally_vouchers v set pos = left(r.new_value, 60) where v.book_id = p_book and v.guid = r.guid and btrim(coalesce(v.pos, '')) = '';
    elsif r.field = 'ref' then update tally_vouchers v set ref = left(r.new_value, 60) where v.book_id = p_book and v.guid = r.guid and btrim(coalesce(v.ref, '')) = '';
    elsif r.field = 'ref_date' then update tally_vouchers v set ref_date = r.new_value::date where v.book_id = p_book and v.guid = r.guid and v.ref_date is null;
    elsif r.field = 'cmp_gstin' then update tally_vouchers v set cmp_gstin = left(upper(r.new_value), 15) where v.book_id = p_book and v.guid = r.guid and btrim(coalesce(v.cmp_gstin, '')) = '';
    end if;
    get diagnostics n = row_count;
    if n > 0 then
      nv := nv + n;
      insert into tally_recorder_restore_log (firm_id, book_id, guid, field, ledger, amount, old_value, new_value, from_alter, by_user, by_role)
      values (f, p_book, r.guid, r.field, null, null, coalesce(r.old_value, ''), r.new_value, r.from_alter, who, rl);
    end if;
  end loop;
  -- the lines: one update a line (its HSN and rate together), each written only while blank
  for r in select x.line_at, x.guid, x.ledger, x.amount, max(x.new_value) filter (where x.field = 'hsn') as h, max(x.new_value) filter (where x.field = 'rate') as rt,
                  max(x.from_alter) filter (where x.field = 'hsn') as ha, max(x.from_alter) filter (where x.field = 'rate') as ra
             from tally_recorder_blanked(p_book) x where x.field in ('hsn', 'rate') group by x.line_at, x.guid, x.ledger, x.amount order by x.guid, x.ledger, x.amount loop
    select l.hsn, l.rate into o from tally_lines l where l.ctid = r.line_at and l.book_id = p_book and l.guid = r.guid and l.ledger = r.ledger for update;
    if not found then continue; end if;
    sh := r.h is not null and btrim(coalesce(o.hsn, '')) = '';
    sr := r.rt is not null and o.rate is null;
    if not (sh or sr) then continue; end if;
    update tally_lines l set hsn = case when sh then left(r.h, 20) else l.hsn end, rate = case when sr then r.rt::numeric else l.rate end
     where l.ctid = r.line_at and l.book_id = p_book and l.guid = r.guid and l.ledger = r.ledger;
    get diagnostics n = row_count;
    if n > 0 then
      if sh then
        nl := nl + 1;
        insert into tally_recorder_restore_log (firm_id, book_id, guid, field, ledger, amount, old_value, new_value, from_alter, by_user, by_role)
        values (f, p_book, r.guid, 'hsn', r.ledger, r.amount, coalesce(o.hsn, ''), r.h, r.ha, who, rl);
      end if;
      if sr then
        nl := nl + 1;
        insert into tally_recorder_restore_log (firm_id, book_id, guid, field, ledger, amount, old_value, new_value, from_alter, by_user, by_role)
        values (f, p_book, r.guid, 'rate', r.ledger, r.amount, '', r.rt, r.ra, who, rl);
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'book', p_book, 'entryFields', nv, 'lineFields', nl);
end $function$;
revoke all on function public.tally_recorder_restore_fields(uuid) from public, anon, authenticated;
grant execute on function public.tally_recorder_restore_fields(uuid) to service_role;

commit;
