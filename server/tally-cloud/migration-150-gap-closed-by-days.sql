-- migration-150-gap-closed-by-days (09-Nov-2026, branch next-gap-close). Written, NOT run yet: the owner reads it and runs it.
-- Why: the page's "Bring missing days" (needDays -> Rec.gapFor) comes from tally_sync_cursor.gap, which
-- tally_recorder_gap_check (migration 47's text, the live one) closes only when the starting point, the recorder's lines
-- or tally_days.alter_max (Day Book uploads only) reach Tally's ALTVCHID. When the bridge brings the missing days
-- (tally_fill_request, 135: tally_check_days source 'fill') and finds FinCom holds every entry, none of those three
-- moves, so the gap never closes and the button keeps coming back though Tally was asked and nothing was missing.
-- The fix (truthful, not a guess): the gap also closes when Tally WAS asked: every day from the gap's first day (India's
-- day of gap.since = coalesce(last_match_at, start_at), the day needDays starts the list at) through India's day of this
-- check has a tally_check_days row of the book done (done_at) at or after the gap began (gap_at), any source ('fill',
-- the regular check, 'held', 'upload'), none of them open (done_at null) or left to upload / refused (upload_at set: a
-- locked month, six lists without finishing). Supporting only, never alone: FinCom's copy holds an entry at Tally's
-- highest voucher AlterID now (max tally_vouchers.alter_id >= ALTVCHID read now and the gap's), so a change made after
-- the days were read keeps the gap open; and no queued send failed for good (47's lost = 0). A gap seen for the first
-- time (gap_at null) is never closed this way. Closed, it is recorded as the match it is (last_match_at, match_alter =
-- Tally's number), so the next check starts from there.
-- How: one new small function, tally_recorder_gap_asked (read-only), and tally_recorder_gap_check replaced with 47's
-- text unchanged but the one line that decides a gap (`if missing > 0 then` -> `... and not (lost = 0 and asked)`),
-- same arguments, same grants (service_role only). No table created, altered or emptied. Safe to run twice; one
-- transaction, lock_timeout 10 s. Tested on pg_stand: tests/run_migration150.py.

begin;
set local lock_timeout = '10s';

-- true when every day of the book from India's day of p_since through India's day of p_at was listed by Tally and done at
-- or after p_gap_at (none open, none left to upload), and the copy holds an entry at p_altvchid or above
create or replace function public.tally_recorder_gap_asked(p_book uuid, p_gap_at timestamptz, p_since timestamptz, p_at timestamptz, p_altvchid bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp as $function$
  select p_gap_at is not null and p_since is not null and p_at is not null and p_altvchid is not null and p_since <= p_at
     and coalesce((select max(v.alter_id) from tally_vouchers v where v.book_id = p_book), 0) >= p_altvchid
     and not exists (select 1 from generate_series((p_since at time zone 'Asia/Kolkata')::date, (p_at at time zone 'Asia/Kolkata')::date, interval '1 day') s(d)
                      where not exists (select 1 from tally_check_days k where k.book_id = p_book and k.day = s.d::date
                                          and k.done_at is not null and k.done_at >= p_gap_at and k.upload_at is null))
$function$;
revoke all on function public.tally_recorder_gap_asked(uuid, timestamptz, timestamptz, timestamptz, bigint) from public, anon, authenticated;
grant execute on function public.tally_recorder_gap_asked(uuid, timestamptz, timestamptz, timestamptz, bigint) to service_role;

-- 47's tally_recorder_gap_check, its text unchanged but the line marked 150
create or replace function public.tally_recorder_gap_check(p_book uuid, p_device uuid, p_altvchid bigint, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; bk tally_books%rowtype; c tally_sync_cursor%rowtype; dmax bigint; base bigint; g jsonb; byd jsonb; at_ timestamptz := coalesce(p_at, now()); missing bigint;
  mbase bigint; since_ timestamptz; w record; lo bigint; hi bigint; above bigint; kk bigint; dup bigint; cr bigint; credit bigint := 0; ww text := ''; wins jsonb := '[]'::jsonb;
  fb bigint := 0; fbm bigint := 0; wm bigint := 0; since_fb timestamptz; cg text; lost bigint := 0; lost_w text := '';
begin
  if not tally_service_or_owner() then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into bk from tally_books where book_id = p_book;
  f := bk.firm_id;
  if f is null then raise exception 'no such book'; end if;
  if p_altvchid is null or p_altvchid >= 1000000000000000 then raise exception 'the check needs Tally''s highest voucher AlterID'; end if;
  -- 0 or less is unknown (the bridge read no ALTVCHID): never a starting point, never a rewind; the cursor untouched (review M2)
  if p_altvchid <= 0 then return jsonb_build_object('ok', true, 'gap', null, 'unknown', true); end if;
  perform pg_advisory_xact_lock(hashtext('cursor' || p_book::text));
  insert into tally_sync_cursor (book_id, firm_id) values (p_book, f) on conflict (book_id) do nothing;
  select * into c from tally_sync_cursor where book_id = p_book;
  -- no starting point yet: this number is it (7.), and there is no gap
  if c.start_at is null then
    update tally_sync_cursor set last_voucher_alterid = p_altvchid, start_at = now(), start_device = p_device, start_guid = coalesce(start_guid, company_guid), gap = null, gap_at = null, updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'startRecorded', true, 'gap', null, 'startVoucher', p_altvchid);
  end if;
  -- below the starting point: a backup restored or the data rewritten - needs_baseline as today, never a gap (45: the last
  -- match's number cleared too)
  if p_altvchid < coalesce(c.last_voucher_alterid, 0) then
    update tally_sync_cursor set state = 'needs_baseline', state_at = now(), gap = null, gap_at = null, match_alter = null, match_start = null, updated_at = now(),
           state_why = format('Tally''s highest voucher AlterID (%s) is below the starting point (%s): a backup restored or the data rewritten', p_altvchid, c.last_voucher_alterid)
     where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', null, 'needsBaseline', true, 'why', format('below the starting point (%s < %s)', p_altvchid, c.last_voucher_alterid));
  end if;
  select max(d.alter_max) into dmax from tally_days d where d.book_id = p_book;
  -- 45: the last check that matched under this starting point accounted everything up to its number
  mbase := case when c.match_start is not distinct from c.start_at then c.match_alter end;
  -- review L10: below that number, read after that match, is a restore as below the start (needs_baseline as 44, never
  -- matched); a reading older than the match (two beats crossing) changes nothing and says nothing
  if mbase is not null and p_altvchid < mbase then
    if c.last_match_at is null or at_ > c.last_match_at then
      update tally_sync_cursor set state = 'needs_baseline', state_at = now(), gap = null, gap_at = null, updated_at = now(),
             state_why = format('Tally''s highest voucher AlterID (%s) is below the last matched check''s (%s): a backup restored or the data rewritten', p_altvchid, mbase)
       where book_id = p_book;
      return jsonb_build_object('ok', true, 'gap', null, 'needsBaseline', true, 'why', format('below the last match (%s < %s)', p_altvchid, mbase));
    end if;
    return jsonb_build_object('ok', true, 'gap', null, 'behind', true, 'why', format('a reading older than the last match (%s < %s)', p_altvchid, mbase));
  end if;
  base := greatest(coalesce(c.last_voucher_alterid, 0), coalesce(c.recorder_max_alter, 0), coalesce(dmax, 0), coalesce(mbase, 0));
  since_ := coalesce(c.last_match_at, c.start_at);
  missing := p_altvchid - base;
  if missing > 0 then
    -- (a) the posting windows above the baseline and below Tally's number now (review M1), of this book's company GUID
    cg := coalesce(c.start_guid, c.company_guid);
    for w in select pw.job_id, pw.a0, pw.a1, pw.created_vch, pw.created_mst, pw.company_guid, coalesce(j.taken_at, j.created_at, pw.at) as posted_at
               from tally_post_windows pw left join tally_post_jobs j on j.id = pw.job_id
              where pw.book_id = p_book and pw.a1 > base and pw.a0 < p_altvchid and pw.a1 >= pw.a0 order by pw.a0, pw.id loop
      if w.company_guid is null or cg is null or w.company_guid <> cg then
        ww := ww || format('; FinCom''s posting of %s not counted (made in company GUID %s; this book''s is %s)', to_char(w.posted_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'),
                           coalesce(w.company_guid, 'not sent'), coalesce(cg, 'not known yet'));
        wins := wins || jsonb_build_array(jsonb_build_object('job', w.job_id, 'a0', w.a0, 'a1', w.a1, 'created', w.created_vch, 'counted', 0, 'otherCompany', true));
        continue;
      end if;
      lo := greatest(w.a0, base); hi := least(w.a1, p_altvchid); above := greatest(hi - lo, 0);
      -- the changes in the window that are not FinCom's vouchers (a person's, or its masters'): at most kk; of the part above
      -- the baseline at least above - kk is FinCom's (review M1), and only vouchers raise ALTVCHID's count here (review M2)
      kk := greatest(w.a1 - w.a0 - w.created_vch, 0); wm := wm + w.created_mst;
      -- never subtract twice: the window's entries a recorder line matched carry their AlterID into recorder_max_alter, so they
      -- are inside the baseline already; counted here they are taken off (review L7: empty by construction, kept as the guard)
      select count(*) into dup from tally_post_ids p where p.job_id = w.job_id and p.matched_at is not null and p.matched_alter > lo and p.matched_alter <= w.a1
         and p.matched_alter <= coalesce(c.recorder_max_alter, 0);
      cr := greatest(least(above, w.created_vch, above - kk) - dup, 0);
      if kk > 0 then     -- not fully accounted: someone else changed something while it ran (or it made ledgers)
        ww := ww || format('; up to %s changes not received during the posting of %s', kk, to_char(w.posted_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'));
      end if;
      credit := credit + cr;
      wins := wins || jsonb_build_array(jsonb_build_object('job', w.job_id, 'a0', w.a0, 'a1', w.a1, 'created', w.created_vch, 'masters', w.created_mst, 'full', kk = 0, 'counted', cr));
    end loop;
    -- (c) the fallback: the vouchers of FinCom's postings without a window, accepted after the last match (else the starting
    -- point), not matched by a recorder line and not in the copy (a day read or a line brought them: inside the baseline;
    -- review L1: also when the copy marked it deleted since). Review H1: "after" is the SERVER's time of the latest thing that
    -- set the baseline: the last match (match_at, the server's clock), the last recorder line that raised recorder_max_alter
    -- (recorder_last_at), the day read that brought the highest AlterID. A posting accepted before it has its changes under
    -- the baseline already; no posting is subtracted at two checks. Residual: these are the times acceptances REACHED the
    -- cloud, not Tally's; a batch reported seconds after a later person's line still counts (at most one request; closed by
    -- 2.2.0's windows; docs/reviews/migration-45-review.md, Fixed)
    since_fb := greatest(coalesce(case when c.match_start is not distinct from c.start_at then coalesce(c.match_at, c.last_match_at) end, c.start_at),
                         case when coalesce(c.recorder_max_alter, 0) > coalesce(c.last_voucher_alterid, 0) then c.recorder_last_at end,
                         (select max(d.at) from tally_days d where d.book_id = p_book and d.alter_max >= base));
    select count(*) into fb from tally_post_ids p join tally_post_jobs j on j.id = p.job_id
     where p.firm_id = f and j.firm_id = f and j.company = bk.company
       and not exists (select 1 from tally_post_windows pw where pw.job_id = j.id)
       and p.accepted_at is not null and p.accepted_at > since_fb and p.released_at is null and p.matched_at is null
       and not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.fincom_id = p.fincom_id);
    if fb > 0 then
      select coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) r
                            where r->>'kind' = 'master' and tally_post_result_accepted(r))), 0) into fbm
        from tally_post_jobs j
       where j.firm_id = f and j.company = bk.company and not exists (select 1 from tally_post_windows pw where pw.job_id = j.id)
         and exists (select 1 from tally_post_ids p where p.job_id = j.id and p.accepted_at > since_fb);
    end if;
    missing := p_altvchid - base - credit - fb;
    fbm := fbm + wm;
  end if;
  -- 47 (review H1): the lines of a queued send that failed for good are NOT received, though later lines raised the
  -- recorder's highest AlterID above them: each one not brought since (a later line of that entry at its AlterID or above,
  -- or the copy holding the entry so: a day read) is counted, so the check is never fooled into a match
  select count(*) into lost from tally_recorder_lines r
   where r.book_id = p_book and r.state = 'failed' and r.held_why like 'queued send failed%'
     and r.event in ('created', 'altered', 'imported', 'deleted', 'cancelled') and r.object_guid is not null and r.alter_id is not null
     and not exists (select 1 from tally_recorder_lines r2 where r2.book_id = p_book and r2.object_guid = r.object_guid and r2.alter_id >= r.alter_id and r2.state in ('applied', 'duplicate', 'stale'))
     and case when r.event = 'deleted' then exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and v.deleted_at is null and coalesce(v.alter_id, 0) < r.alter_id)
              when r.event = 'cancelled' then exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and v.deleted_at is null and not coalesce(v.cancelled, false) and coalesce(v.alter_id, 0) < r.alter_id)
              else not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.guid = r.object_guid and coalesce(v.alter_id, 0) >= r.alter_id) end;
  if lost > 0 then
    missing := greatest(coalesce(missing, 0), 0) + lost;
    lost_w := format('; %s of them in a queued send that failed (Sync activity: failed): send them again or read those days again', lost);
  end if;
  -- 150: a gap Tally was asked about day by day since it began, with nothing found missing, is closed (the match below)
  if missing > 0 and not (lost = 0 and tally_recorder_gap_asked(p_book, c.gap_at, since_, at_, greatest(p_altvchid, coalesce((c.gap->>'tally_altvchid')::bigint, 0)))) then
    -- an UPPER bound: each create, alter or delete raises ALTVCHID by at least one, so the changes missed are at most this
    select jsonb_object_agg(s.device_id::text, jsonb_build_object('max', s.mx, 'lastAt', s.la)) into byd
      from (select r.device_id, max(r.alter_id) mx, max(r.received_at) la from tally_recorder_lines r
             where r.book_id = p_book and r.device_id is not null and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported') group by r.device_id) s;
    g := jsonb_build_object('tally_altvchid', p_altvchid, 'recorder_max', c.recorder_max_alter, 'day_max', dmax, 'start_point', c.last_voucher_alterid, 'missing', missing, 'missingMax', missing,
           'since', since_, 'last_match_at', c.last_match_at, 'by_device', coalesce(byd, '{}'::jsonb), 'device', p_device, 'at', at_,
           'accounted', credit, 'posted', fb, 'windows', wins, 'ledgers', fbm, 'lost', lost,
           'words', format('up to %s changes not received since %s', missing, to_char(since_ at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI')) || ww || lost_w
                    || case when fbm > 0 then format('; of which up to %s may be FinCom''s own new ledgers', least(fbm, missing)) else '' end);
    update tally_sync_cursor set gap = g, gap_at = coalesce(gap_at, now()), updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', g, 'missing', missing, 'missingMax', missing);
  end if;
  update tally_sync_cursor set gap = null, gap_at = null, last_match_at = at_, match_at = now(), match_alter = greatest(coalesce(mbase, 0), p_altvchid), match_start = c.start_at, updated_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'gap', null, 'matched', true, 'lastMatchAt', at_, 'accounted', credit + fb);
end $function$;
revoke all on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) to service_role;

commit;
