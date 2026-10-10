-- Migration 48 (04-Oct-2026, round 20 part c; docs/cloud-recorder-plan.md 1, "the database fix"). Runs AFTER 47 (fresh
-- database: ... -> 46 -> 47 -> 48; staging: after 47). Functions created or replaced (one new 4-argument form; three with the
-- same arguments; round 21: tally_recorder_archive_trim and its pg_cron job); no table, column or row removed (one grant taken
-- back: review L10); safe to run twice.
-- IT CONTAINS "delete from": the text of tally_ingest_entries (44's, carried here byte for byte but the rebuild switch and
-- round 21's caller check) replaces a re-sent entry's lines and bills ("delete from tally_bills ... / delete from tally_lines
-- ... where guid = any(sent)"), tally_ledger_day_rebuild (44's, unchanged, not in this file) clears the days it rebuilds, and
-- round 21's tally_recorder_archive_trim removes the queue's archive and settled pending rows older than 90 days (pg_cron,
-- daily). Nothing runs at migration time. So
-- this file is POSTED WHOLE FOR THE OWNER to run in the SQL Editor (the rule: a file with "delete from" is the owner's to run).
--
--   THE DAY CACHE REBUILT ONCE PER CALL. tally_recorder_apply rebuilt the ledger-day cache (tally_ledger_day) once per LINE:
--   40 % of the 5.5 ms a full line costs, and 9.5 s for a 500-line request on one day (docs/cloud-recorder-plan.md 1).
--     tally_ingest_entries(p_book, p_vouchers, p_lines, p_rebuild boolean) returns jsonb: 44's text; with p_rebuild false it
--       does not rebuild the days it touched, it only answers them ('touched', as before; 'rebuilt' false). The service role's.
--     tally_ingest_entries(p_book, p_vouchers, p_lines): stays (tally_ingest_day, an owner's release and every other caller use
--       it) and calls the 4-argument form with true: the same behaviour as 44's.
--     tally_recorder_line: 47's text; inside tally_recorder_apply (the transaction-local setting fincom.day_rebuild_once = 'on',
--       set by tally_recorder_apply alone) an entry line calls tally_ingest_entries(..., false) and returns the days in
--       'touched'; everywhere else (tally_recorder_release_held, tally_recorder_short_retry) it rebuilds per line as before.
--     tally_recorder_apply: 44's text; sets the setting, collects every applied entry line's days, and after the loop rebuilds
--       them ONCE (tally_ledger_day_rebuild over the distinct days), then clears the setting. A ledger line (rename, delete,
--       create / alter) reads the balances (a rename's trial-balance check, the guard's reasons), so before it the days
--       collected so far are rebuilt; a delete or cancel (tally_ingest_delete) rebuilds its own day as before and reads no
--       cache. A failed line's work is undone with its savepoint, and its days are not collected.
--   THE OWNER'S CONDITION (04-Oct): for the test book the trial balance (sum of tally_ledger_day.amount per ledger and in
--   total) and the md5 of the full tally_ledger_day (every row: book, ledger, day, amount, dr, cr, n; ordered) are IDENTICAL
--   old (47) against new (48) for three sends: a single entry, 500 lines on one day, a send spanning 30 days
--   (tests/run_migration48.py, which fails otherwise; the numbers are in its output).
--   ROUND 21 (docs/reviews/migration-47-48-review.md): M8 tally_recorder_line carries 47's ledger_altered rule (renamed only
--   above the ledger's AlterID seen, never merged); L6 the apply and the 4-argument entry path pass a caller without a JWT
--   only for the owner's own logins (47's tally_service_or_owner); L9 the apply trims the event before its ledger test; L10
--   the 4-argument tally_ingest_entries is granted to nobody (only the 3-argument form and tally_recorder_line, both run as
--   the owner, reach it, so no caller can skip the rebuild); M6 tally_recorder_archive_trim (pg_cron daily,
--   'tally-recorder-archive-trim'): the queue's archive (pgmq.a_tally_recorder: full voucher bodies) and the settled rows of
--   tally_recorder_pending kept 90 days. These two "delete from" statements are the only ones besides 44's entry path.
--   Every function: security definer, search_path = public, pg_temp; tally_ingest_entries (3 arguments) and
--   tally_recorder_apply the service role's (revoked from public, anon, authenticated); the 4-argument form,
--   tally_recorder_line and the trim granted to nobody (pg_cron runs the trim as the owner).

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

-- ---------------------------------------------------------------- the entry path: rebuild or not
create or replace function public.tally_ingest_entries(p_book uuid, p_vouchers jsonb, p_lines jsonb, p_rebuild boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; sent text[]; touched date[]; lk date;
begin
  if not tally_service_or_owner() and coalesce(current_setting('fincom.recorder_release', true), '') !~ '^[0-9]+$' then raise exception 'not allowed' using errcode = '42501'; end if;
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
  -- the day cache, from live entries only; 48: not when the caller rebuilds the days it touched once for a whole call (p_rebuild
  -- false: tally_recorder_apply), which it collects from 'touched'
  if coalesce(p_rebuild, true) then perform tally_ledger_day_rebuild(p_book, touched); end if;
  return jsonb_build_object('ok', true, 'touched', to_jsonb(touched), 'sent', coalesce(array_length(sent, 1), 0), 'rebuilt', coalesce(p_rebuild, true));
end $function$;
-- review L10: nobody's (the 3-argument form and tally_recorder_line call it as the owner); a second run takes back an earlier grant
revoke all on function public.tally_ingest_entries(uuid, jsonb, jsonb, boolean) from public, anon, authenticated, service_role;

-- 44's 3-argument form: the same behaviour (rebuild), through the 4-argument one
create or replace function public.tally_ingest_entries(p_book uuid, p_vouchers jsonb, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  return tally_ingest_entries(p_book, p_vouchers, p_lines, true);
end $function$;
revoke all on function public.tally_ingest_entries(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tally_ingest_entries(uuid, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------- 47's line: the days returned inside tally_recorder_apply
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
  known constant text[] := array['created', 'altered', 'deleted', 'cancelled', 'imported', 'ledger_created', 'ledger_altered', 'ledger_renamed', 'ledger_deleted'];
begin
  select * into b from tally_books where book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
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
      stt := 'held'; wy := 'no GUID on the line: held, never a new row';
    end if;
    -- the same change already here: another arrival applied or held (owner items 26, 102)
    if stt is null and og is not null then
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
      else
        -- the entry's body: the voucher of this GUID alone, dated by the line when it has no date of its own
        select coalesce(jsonb_agg(case when tally_d8(replace(coalesce(x->>'day', ''), '-', '')) is null then x || jsonb_build_object('day', vd) else x end), '[]'::jsonb) into vs
          from jsonb_array_elements(case when jsonb_typeof(p_line->'vouchers') = 'array' then p_line->'vouchers' else '[]'::jsonb end) x where x->>'guid' = og;
        -- review H2: a short line builds the entry from FinCom's posted XML only when it is FinCom's creation: never for an
        -- 'altered' line, never for an entry the copy holds (a person changed it in Tally after the posting: the posted
        -- content is not Tally's now). Such a line is matched, held, and its AlterID is not received (the gap check shows it)
        sh_changed := is_short and (ev = 'altered' or c_found);
        if sh_changed then vs := '[]'::jsonb; end if;
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
        if stt is null then
          lk := tally_month_locked(p_book, array(select tally_d8(replace(coalesce(x->>'day', ''), '-', '')) from jsonb_array_elements(vs) x) || array[c_day, vd]);
          if lk is not null then
            stt := 'held'; wy := format('month locked: %s', to_char(lk, 'YYYY-MM'));
          elsif c_found and alt is not null and alt < c_alter then
            stt := 'stale'; wy := format('AlterID %s is older than the %s held', alt, c_alter);
          elsif c_found and alt is not null and alt = c_alter and c_del is null then
            stt := 'duplicate'; wy := format('the copy holds this entry at AlterID %s already (a day read or another line)', alt);
          elsif jsonb_array_length(vs) = 0 then
            stt := 'held'; wy := case when m_done and sh_changed then format('FinCom posting %s matched; changed in Tally after posting: the next full line or Day Book upload applies it', m_fid)
                                      when m_done then format('FinCom posting %s matched; no entry body (its posted XML could not be read): the next day read applies it', m_fid)
                                      else 'no entry body on the line: the next day read applies it' end;
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
  return jsonb_build_object('id', rid, 'line_id', p_line->>'line_id', 'state', stt, 'why', wy)
      || case when once and stt = 'applied' and jsonb_typeof(tch) = 'array' then jsonb_build_object('touched', tch) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- the apply: the days rebuilt once per call
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
       and coalesce(x->>'object_guid', '') <> '' and coalesce(x->>'alter_id', '') ~ '^[0-9]{1,15}$' then
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

-- ---------------------------------------------------------------- review M6: the recorder queue's retention (90 days)
create or replace function public.tally_recorder_archive_trim()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare a int; p int;
begin
  delete from pgmq.a_tally_recorder where archived_at < now() - interval '90 days';
  get diagnostics a = row_count;
  delete from tally_recorder_pending where state <> 'pending' and done_at < now() - interval '90 days';
  get diagnostics p = row_count;
  return jsonb_build_object('ok', true, 'archive', a, 'pending', p);
end $function$;
revoke all on function public.tally_recorder_archive_trim() from public, anon, authenticated, service_role;
select cron.schedule('tally-recorder-archive-trim', '17 21 * * *', 'select public.tally_recorder_archive_trim()');     -- 02:47 IST, daily

commit;
