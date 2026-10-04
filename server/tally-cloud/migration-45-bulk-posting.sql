-- Migration 45 (04-Oct-2026: bulk posting with the recorder loaded; docs/recorder-bulk-posting.md sections 3 and 4).
-- Runs after 44 (fresh database: ... -> 43 -> 44 -> 45; staging: after 44; docs/MIGRATION-ORDER.md). Add-only but for the owner's
-- RESTRICT swap below (a table and columns added if missing; functions created or replaced with the same arguments; nothing
-- deleted), safe to run twice. Shown to the owner, who runs it in the SQL editor.
--
--   3. NO FALSE ALARM AFTER A BULK POSTING. Tally may not fire the add-on's import events for entries arriving through its
--      HTTP port, so 2,000 posted entries raise ALTVCHID by 2,000 with no recorder line. FinCom's postings are accounted from
--      their own record:
--      (a) tally_post_windows (RLS: the firm reads, nobody writes directly): one row per posting job (firm, book, job, device,
--          a0 = ALTVCHID before the job (the company check), a1 = after it, created_vch / created_mst = the vouchers and masters
--          Tally's replies said it created, at). tally_post_window_save(p_firm, p_job, p_device, p_a0, p_a1, p_vch, p_mst)
--          (service role; tally-ingest's posts_update when the job's last update carries window {a0, a1, vouchersCreated,
--          mastersCreated}): whole numbers 0..10^15 (below), a1 not below a0, the job of this firm and of this computer, its
--          company's book; a later save of the same job updates the row. Refusals are answered {ok: false, error}, never raised.
--      (b) tally_recorder_gap_check (44's, replaced with the same arguments): baseline as 44 (the starting point, the recorder's
--          highest AlterID, the day books' highest), and also the number of the last check that matched while the same
--          starting point stood (tally_sync_cursor.match_alter / match_start: everything up to it was accounted, so the next
--          check starts there; a new starting point drops it; below the start clears it). Then
--            missing = ALTVCHID - baseline - accounted
--          accounted = for each window above the baseline (a1 > baseline; the part above it counted when a0 is below it): a
--          window is FULLY ACCOUNTED when a1 - a0 = created_vch + created_mst, and counts its part above the baseline; one that
--          is not counts at most what Tally created and leaves the words 'up to K changes not received during the posting of
--          <time IST>' (K = a1 - a0 - created: a real possible gap, still an upper bound). Never subtract twice: a posted entry
--          a recorder line matched carries its AlterID into recorder_max_alter, so it is inside the baseline already; the
--          window's matched entries counted there are taken off the window's part (an empty set by construction, kept as the
--          guard). The FALLBACK, for a posted job without a window (2.1.x bridges, a1 not read): the vouchers FinCom's postings
--          had accepted after the last match (else the starting point), whose tally_post_ids row has no matched_at and whose
--          entry the copy does not hold (a day read or a line brought it: inside the baseline), are subtracted; masters those
--          postings created are named 'of which up to k may be FinCom's own new ledgers'. The main words stay 'up to N changes
--          not received since <time>'; missing stays an upper bound. Everything else of 44 is kept (0 unknown, below the start
--          needs_baseline, the start recorded, the gap object's fields; added: accounted, posted, windows, ledgers).
--   4. NO DOUBLING: A POSTED ENTRY LANDS ON FINCOM'S ENTRY. tally_post_ids.matched_guid / matched_mid / matched_alter (added).
--      A SHORT LINE (the add-on's line for an entry whose narration carries "TDSDesk:<id>": company GUID, voucher GUID, MasterID,
--      AlterID, the FinCom id as fid (or the narration), event and time; no ledger lines) is matched to the LIVE, ACCEPTED
--      tally_post_ids row of the firm whose job's company is this book's (tally_post_live_for, internal): matched_at,
--      matched_vch (the line's voucher number, else the body's), matched_guid, matched_mid, matched_alter are stamped. The
--      copy's entry is built once, by GUID, through 44's entry path: from the body tally-ingest built from FinCom's own posted
--      XML (tally_post_xml_for(p_firm, p_book, p_fids), service role: the payload XML of the matched ids; parse.js reads it,
--      the line's GUID and AlterID override). A later arrival (the same line again, from a second PC, a full line, a day book
--      through tally_ingest_day) has the same GUID: duplicate or updated in place, never a second entry. A short line whose
--      FinCom id matches no posting of this firm is held 'FinCom id <id> matches no posting of this firm' (never a new entry,
--      never a guess); one matched without a body is stamped and held; one whose FinCom id is matched to another Tally GUID
--      already is held. A full line keeps 44's rule (its FinCom id stamps matched_at / matched_vch), now with the GUID,
--      MasterID and AlterID too. tally_recorder_line is 44's text with these additions.
--   R. REALTIME. tally_recorder_lines is added to the supabase_realtime publication when the publication exists and the table
--      is not in it yet (the app's Sync activity listens live; RLS limits what each firm receives).
--   D. NOTHING IS DELETED (the owner, 04-Oct). The foreign keys to tally_books of tally_recorder_lines and tally_month_locks
--      (ON DELETE CASCADE) and tally_tieouts (ON DELETE SET NULL) become ON DELETE RESTRICT, as migration 38 did for
--      tally_post_marks: each found in pg_constraint by its table and column, dropped and added again with the same name;
--      a second run finds none left to change. tally_post_windows references tally_books and tally_post_jobs ON DELETE RESTRICT.
--   Every function here: security definer, search_path = public, pg_temp; the service role's revoked from public, anon and
--   authenticated and granted to service_role; the internal ones (tally_recorder_line, tally_post_live_for) granted to nobody.
--   The new table: RLS on, a read-only firm_id = my_firm() select policy, no insert / update / delete.

begin;

-- ---------------------------------------------------------------- A. table and columns
create table if not exists public.tally_post_windows (
  id           bigserial primary key,
  firm_id      uuid not null,
  book_id      uuid not null references public.tally_books(book_id) on delete restrict,
  job_id       uuid not null references public.tally_post_jobs(id) on delete restrict,
  device_id    uuid,
  a0           bigint not null check (a0 >= 0 and a0 < 1000000000000000),     -- ALTVCHID before the job (the company check)
  a1           bigint not null check (a1 >= 0 and a1 < 1000000000000000),     -- ALTVCHID after the job
  created_vch  bigint not null default 0 check (created_vch >= 0 and created_vch < 1000000000000000),
  created_mst  bigint not null default 0 check (created_mst >= 0 and created_mst < 1000000000000000),
  at           timestamptz not null default now(),
  unique (job_id),
  check (a1 >= a0)
);
create index if not exists tally_post_windows_book on public.tally_post_windows (book_id, a1);
alter table public.tally_post_windows enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_post_windows' and policyname = 'tally_post_windows_read') then
    create policy tally_post_windows_read on public.tally_post_windows for select to authenticated using (firm_id = my_firm());
  end if;
end $$;
grant select on public.tally_post_windows to authenticated;
revoke insert, update, delete, truncate on public.tally_post_windows from anon, authenticated;

alter table public.tally_post_ids add column if not exists matched_guid text;       -- 4. the Tally entry a recorder line matched (its GUID, MasterID, AlterID)
alter table public.tally_post_ids add column if not exists matched_mid text;
alter table public.tally_post_ids add column if not exists matched_alter bigint;
alter table public.tally_sync_cursor add column if not exists match_alter bigint;       -- 3. the ALTVCHID of the last check that matched
alter table public.tally_sync_cursor add column if not exists match_start timestamptz;  -- the starting point (start_at) it was matched under

-- ---------------------------------------------------------------- D. nothing is deleted: the foreign keys to tally_books restrict
do $$
declare c record;
begin
  for c in select con.conname, con.conrelid::regclass::text as t, a.attname as col
             from pg_constraint con join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
            where con.conrelid in ('public.tally_recorder_lines'::regclass, 'public.tally_month_locks'::regclass, 'public.tally_tieouts'::regclass)
              and con.contype = 'f' and con.confrelid = 'public.tally_books'::regclass and con.confdeltype <> 'r' loop
    execute format('alter table %s drop constraint %I', c.t, c.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references public.tally_books(book_id) on delete restrict', c.t, c.conname, c.col);
    raise notice 'migration 45: %.% -> tally_books: ON DELETE RESTRICT', c.t, c.col;
  end loop;
end $$;

-- ---------------------------------------------------------------- R. realtime
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tally_recorder_lines') then
    alter publication supabase_realtime add table public.tally_recorder_lines;
  end if;
end $$;

-- ---------------------------------------------------------------- 3. the posting window
create or replace function public.tally_post_window_save(p_firm uuid, p_job uuid, p_device uuid, p_a0 bigint, p_a1 bigint, p_vch bigint, p_mst bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare j tally_post_jobs%rowtype; bk uuid; lim constant bigint := 1000000000000000; w tally_post_windows%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_a0 is null or p_a1 is null or p_a0 < 0 or p_a1 < 0 or p_a0 >= lim or p_a1 >= lim
     or coalesce(p_vch, 0) < 0 or coalesce(p_mst, 0) < 0 or coalesce(p_vch, 0) >= lim or coalesce(p_mst, 0) >= lim then
    return jsonb_build_object('ok', false, 'error', 'the posting window needs whole numbers from 0 to below 10^15: not kept');
  end if;
  if p_a1 < p_a0 then
    return jsonb_build_object('ok', false, 'error', format('Tally''s change number went back during the posting (%s to %s: a restore?): not kept', p_a0, p_a1));
  end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = p_firm;
  if j.id is null then return jsonb_build_object('ok', false, 'error', 'no such posting of this firm'); end if;
  if p_device is not null and j.device_id is distinct from p_device then return jsonb_build_object('ok', false, 'error', 'not a posting of this computer'); end if;
  select b.book_id into bk from tally_books b where b.firm_id = p_firm and b.company = j.company order by (b.client_id = j.client_id) desc limit 1;
  if bk is null then return jsonb_build_object('ok', false, 'error', 'the posting''s company has no book'); end if;
  insert into tally_post_windows (firm_id, book_id, job_id, device_id, a0, a1, created_vch, created_mst)
  values (p_firm, bk, p_job, p_device, p_a0, p_a1, coalesce(p_vch, 0), coalesce(p_mst, 0))
  on conflict (job_id) do update set book_id = excluded.book_id, device_id = excluded.device_id, a0 = excluded.a0, a1 = excluded.a1,
     created_vch = excluded.created_vch, created_mst = excluded.created_mst, at = now()
  returning * into w;
  return jsonb_build_object('ok', true, 'book', w.book_id, 'job', w.job_id, 'a0', w.a0, 'a1', w.a1, 'createdVch', w.created_vch, 'createdMst', w.created_mst,
    'full', w.a1 - w.a0 = w.created_vch + w.created_mst);
end $function$;
revoke all on function public.tally_post_window_save(uuid, uuid, uuid, bigint, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.tally_post_window_save(uuid, uuid, uuid, bigint, bigint, bigint, bigint) to service_role;

-- ---------------------------------------------------------------- 4. the live, accepted posting of a FinCom id for this book
-- the firm's live tally_post_ids row Tally accepted (not released) for this FinCom id, of a job whose company is this book's;
-- the exact id first, else the spelling rule of 36b (tally_post_id_match). Internal: granted to nobody
create or replace function public.tally_post_live_for(p_firm uuid, p_book uuid, p_fid text)
returns table(post_job uuid, post_fid text, post_entry text, post_guid text)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
begin
  if coalesce(p_fid, '') = '' then return; end if;
  return query
    select p.job_id, p.fincom_id, p.entry_id, p.matched_guid from tally_post_ids p join tally_post_jobs j on j.id = p.job_id
      join tally_books bk on bk.book_id = p_book and bk.firm_id = j.firm_id and bk.company = j.company
     where p.firm_id = p_firm and j.firm_id = p_firm and p.live and p.accepted_at is not null and p.released_at is null and p.fincom_id = p_fid
     order by p.accepted_at desc limit 1;
  if found then return; end if;
  return query
    select p.job_id, p.fincom_id, p.entry_id, p.matched_guid from tally_post_ids p join tally_post_jobs j on j.id = p.job_id
      join tally_books bk on bk.book_id = p_book and bk.firm_id = j.firm_id and bk.company = j.company
     where p.firm_id = p_firm and j.firm_id = p_firm and p.live and p.accepted_at is not null and p.released_at is null and tally_post_id_match(p.fincom_id, p.entry_id, p_fid)
     order by p.accepted_at desc limit 1;
end $function$;
revoke all on function public.tally_post_live_for(uuid, uuid, text) from public, anon, authenticated, service_role;

-- the posted XML of these FinCom ids (the live, accepted posting of each for this book): tally-ingest reads it with parse.js
-- into the entry of a short line. Service role. {ok, posts: [{fid (as asked), job, fincomId, xml}]}
create or replace function public.tally_post_xml_for(p_firm uuid, p_book uuid, p_fids text[])
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare out_ jsonb;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if coalesce(array_length(p_fids, 1), 0) > 1000 then raise exception 'at most 1000 ids a call (% given)', array_length(p_fids, 1); end if;
  if not exists (select 1 from tally_books where book_id = p_book and firm_id = p_firm) then return jsonb_build_object('ok', true, 'posts', '[]'::jsonb); end if;
  with m as (select distinct on (f.fid) f.fid, r.post_job, r.post_fid from unnest(p_fids) f(fid) cross join lateral tally_post_live_for(p_firm, p_book, f.fid) r where coalesce(f.fid, '') <> ''),
       pv as materialized (select j.id as job_id, tally_fincom_id(v) as fk, v->>'xml' as xml from tally_post_jobs j, jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) v
                            where j.id in (select post_job from m) and j.firm_id = p_firm)
  select coalesce(jsonb_agg(jsonb_build_object('fid', m.fid, 'job', m.post_job, 'fincomId', m.post_fid, 'xml', x.xml)), '[]'::jsonb) into out_
    from m join lateral (select pv.xml from pv where pv.job_id = m.post_job and pv.fk = m.post_fid and coalesce(pv.xml, '') <> '' limit 1) x on true;
  return jsonb_build_object('ok', true, 'posts', out_);
end $function$;
revoke all on function public.tally_post_xml_for(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.tally_post_xml_for(uuid, uuid, text[]) to service_role;

-- ---------------------------------------------------------------- 4. the recorder's line (44's text, with the short line)
create or replace function public.tally_recorder_line(p_book uuid, p_device uuid, p_line jsonb, p_row bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b tally_books%rowtype; rid bigint := p_row; ev text := left(btrim(coalesce(p_line->>'event', '')), 40);
  og text := nullif(left(btrim(coalesce(p_line->>'object_guid', '')), 100), '');
  alt bigint := case when coalesce(p_line->>'alter_id', '') ~ '^[0-9]{1,15}$' then (p_line->>'alter_id')::bigint end;     -- below 10^15 (review L9)
  vd date := tally_d8(replace(coalesce(p_line->>'vch_date', ''), '-', ''));
  sa timestamptz; pl jsonb; pltxt text; bd jsonb; stt text; wy text; t text; res jsonb; vs jsonb; lk date;
  c_found boolean := false; c_alter bigint; c_day date; c_del timestamptz; c_fid text;
  frm text; dst text; l_name text; l_del timestamptz;
  -- 45: the FinCom id of a short line (fid, else "TDSDesk:<id>" in the narration it carries) and its posting
  lf text := coalesce(case when coalesce(p_line->>'fid', '') ~ '^[A-Za-z0-9._-]{1,80}$' then p_line->>'fid' end,
                      substring(coalesce(p_line->>'narration', '') from 'TDSDesk:([A-Za-z0-9._-]{1,80})'));
  is_short boolean; m_job uuid; m_fid text; m_guid text; m_done boolean := false;
  vno text := nullif(left(btrim(coalesce(p_line->>'vch_no', '')), 60), ''); mid text := nullif(left(btrim(coalesce(p_line->>'master_id', '')), 40), '');
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
            stt := 'held'; wy := case when m_done then format('FinCom posting %s matched; no entry body (its posted XML could not be read): the next day read applies it', m_fid)
                                      else 'no entry body on the line: the next day read applies it' end;
          else
            res := tally_ingest_entries(p_book, vs, p_line->'lines');
            if coalesce((res->>'locked')::boolean, false) then stt := 'held'; wy := res->>'refused';
            else
              stt := 'applied';
              if m_done then wy := format('FinCom posting %s matched', m_fid);
              else
                -- a FinCom posting coming back in a full line: matched by its FinCom id (43's columns, 45's GUID, MasterID, AlterID)
                select v.fincom_id into c_fid from tally_vouchers v where v.book_id = p_book and v.guid = og;
                if c_fid is not null then
                  update tally_post_ids p set matched_at = coalesce(p.matched_at, now()), matched_vch = coalesce(vno, p.matched_vch),
                         matched_guid = coalesce(p.matched_guid, og), matched_mid = coalesce(mid, p.matched_mid),
                         matched_alter = case when alt is null then p.matched_alter else greatest(coalesce(p.matched_alter, alt), alt) end
                   where p.firm_id = b.firm_id and p.fincom_id = c_fid;
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
revoke all on function public.tally_recorder_line(uuid, uuid, jsonb, bigint) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------- 3. the gap check (44's, with FinCom's postings accounted)
create or replace function public.tally_recorder_gap_check(p_book uuid, p_device uuid, p_altvchid bigint, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; bk tally_books%rowtype; c tally_sync_cursor%rowtype; dmax bigint; base bigint; g jsonb; byd jsonb; at_ timestamptz := coalesce(p_at, now()); missing bigint;
  mbase bigint; since_ timestamptz; w record; lo bigint; above bigint; made bigint; dup bigint; cr bigint; credit bigint := 0; ww text := ''; wins jsonb := '[]'::jsonb;
  fb bigint := 0; fbm bigint := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
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
  base := greatest(coalesce(c.last_voucher_alterid, 0), coalesce(c.recorder_max_alter, 0), coalesce(dmax, 0), coalesce(mbase, 0));
  since_ := coalesce(c.last_match_at, c.start_at);
  missing := p_altvchid - base;
  if missing > 0 then
    -- (a) the posting windows above the baseline
    for w in select pw.job_id, pw.a0, pw.a1, pw.created_vch, pw.created_mst, coalesce(j.taken_at, j.created_at, pw.at) as posted_at
               from tally_post_windows pw left join tally_post_jobs j on j.id = pw.job_id
              where pw.book_id = p_book and pw.a1 > base and pw.a1 >= pw.a0 order by pw.a0, pw.id loop
      lo := greatest(w.a0, base); above := w.a1 - lo; made := w.created_vch + w.created_mst;
      -- never subtract twice: the window's entries matched by a recorder line whose AlterID recorder_max_alter counts
      select count(*) into dup from tally_post_ids p where p.job_id = w.job_id and p.matched_at is not null and p.matched_alter > lo and p.matched_alter <= w.a1
         and p.matched_alter <= coalesce(c.recorder_max_alter, 0);
      cr := greatest(least(above, made) - dup, 0);
      if w.a1 - w.a0 > made then     -- not fully accounted: someone else changed something while it ran
        ww := ww || format('; up to %s changes not received during the posting of %s', w.a1 - w.a0 - made, to_char(w.posted_at at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI'));
      end if;
      credit := credit + cr;
      wins := wins || jsonb_build_array(jsonb_build_object('job', w.job_id, 'a0', w.a0, 'a1', w.a1, 'created', made, 'full', w.a1 - w.a0 = made, 'counted', cr));
    end loop;
    -- (c) the fallback: the vouchers of FinCom's postings without a window, accepted after the last match (else the starting
    -- point), not matched by a recorder line and not in the copy (a day read or a line brought them: inside the baseline)
    select count(*) into fb from tally_post_ids p join tally_post_jobs j on j.id = p.job_id
     where p.firm_id = f and j.firm_id = f and j.company = bk.company
       and not exists (select 1 from tally_post_windows pw where pw.job_id = j.id)
       and p.accepted_at is not null and p.accepted_at > since_ and p.released_at is null and p.matched_at is null
       and not exists (select 1 from tally_vouchers v where v.book_id = p_book and v.fincom_id = p.fincom_id and v.deleted_at is null);
    if fb > 0 then
      select coalesce(sum((select count(*) from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) r
                            where r->>'kind' = 'master' and tally_post_result_accepted(r))), 0) into fbm
        from tally_post_jobs j
       where j.firm_id = f and j.company = bk.company and not exists (select 1 from tally_post_windows pw where pw.job_id = j.id)
         and exists (select 1 from tally_post_ids p where p.job_id = j.id and p.accepted_at > since_);
    end if;
    missing := p_altvchid - base - credit - fb;
  end if;
  if missing > 0 then
    -- an UPPER bound: each create, alter or delete raises ALTVCHID by at least one, so the changes missed are at most this
    select jsonb_object_agg(s.device_id::text, jsonb_build_object('max', s.mx, 'lastAt', s.la)) into byd
      from (select r.device_id, max(r.alter_id) mx, max(r.received_at) la from tally_recorder_lines r
             where r.book_id = p_book and r.device_id is not null and r.event in ('created', 'altered', 'deleted', 'cancelled', 'imported') group by r.device_id) s;
    g := jsonb_build_object('tally_altvchid', p_altvchid, 'recorder_max', c.recorder_max_alter, 'day_max', dmax, 'start_point', c.last_voucher_alterid, 'missing', missing, 'missingMax', missing,
           'since', since_, 'last_match_at', c.last_match_at, 'by_device', coalesce(byd, '{}'::jsonb), 'device', p_device, 'at', at_,
           'accounted', credit, 'posted', fb, 'windows', wins, 'ledgers', fbm,
           'words', format('up to %s changes not received since %s', missing, to_char(since_ at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI')) || ww
                    || case when fbm > 0 then format('; of which up to %s may be FinCom''s own new ledgers', least(fbm, missing)) else '' end);
    update tally_sync_cursor set gap = g, gap_at = coalesce(gap_at, now()), updated_at = now() where book_id = p_book;
    return jsonb_build_object('ok', true, 'gap', g, 'missing', missing, 'missingMax', missing);
  end if;
  update tally_sync_cursor set gap = null, gap_at = null, last_match_at = at_, match_alter = greatest(coalesce(mbase, 0), p_altvchid), match_start = c.start_at, updated_at = now() where book_id = p_book;
  return jsonb_build_object('ok', true, 'gap', null, 'matched', true, 'lastMatchAt', at_, 'accounted', credit + fb);
end $function$;
revoke all on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_recorder_gap_check(uuid, uuid, bigint, timestamptz) to service_role;

commit;
