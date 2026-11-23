-- Migration 218 (23-Nov-2026, branch next-fix-fbooks-setup). A DRAFT: written and tested here (tests/run_migration220.py
-- on pg_stand, made-up books only); NOT run anywhere. Run it AFTER migration 220 (FinCom Books P1), and again after any
-- re-run of 220 (220 would put back the three functions below as they were).
--
-- "Set up FinCom Books" timed out for a client with about 7,300 entries ("canceling statement due to statement timeout"):
-- fb_enroll built the book inside the person's click (every group and ledger, the openings, and up to 2,000 entries
-- through the edit log), past the 8-second limit of the signed-in role. Nothing was left behind (the click's one
-- transaction rolled back). Now:
--   fb_enroll            only enrols: the book ('setting_up', "being built"), its books mode and its mirror state. It
--                        answers at once, whatever the size of the book. A book switched on again gets a 'missed' row, so
--                        the catch-up compares every entry (the sweep); nothing else changes for books already built
--   fb_mirror_catchup    220's text with ONE step added at the top: a book being built whose masters are not there yet
--                        (no seeded group) gets its groups, ledgers and openings first, in the timer's run (pg_cron, no
--                        8-second limit); its entries then follow a chunk at a time (fb_mirror_catchup_run takes books
--                        being built first, at most 5,000 entries a run, one transaction per book and chunk)
--   fb_status            220's text with ONE field added: 'build' {done, of} while a book is being built (entries in
--                        FinCom Books of the copy's entries in the window), so the page shows "Building: 2,400 of 7,300
--                        entries" and finishes by itself
-- ADD-ONLY in effect: no table, column, index, trigger or grant is added or removed; three functions are replaced with
-- the same arguments, result, SECURITY DEFINER, search_path (public, pg_temp), comment and grants. Each is replaced only
-- when its text is migration 220's (as on staging, prosrc md5 below) or already this migration's; anything else stops the
-- migration, naming it. One transaction, lock_timeout 10 s; safe to run twice.
begin;
set local lock_timeout = '10s';

do $names$
declare bad text[] := '{}'; f text; m text; cm text;
begin
  if to_regclass('public.fb_books') is null or to_regclass('public.fb_mirror_state') is null or to_regprocedure('public.fb_mirror_masters(uuid)') is null then
    raise exception 'migration 218: FinCom Books (migration 220) is not on this database. Nothing was changed.';
  end if;
  foreach f in array array['fb_enroll(text)', 'fb_mirror_catchup(uuid,integer)', 'fb_status(text)'] loop
    select md5(p.prosrc), coalesce(obj_description(p.oid, 'pg_proc'), '') into m, cm from pg_proc p where p.oid = to_regprocedure('public.' || f);
    if m is null then bad := bad || ('function ' || f || ' (not here)');
    elsif cm <> 'fincom books (migration 220)' then bad := bad || ('function ' || f || ' (not FinCom Books'')');
    elsif m <> all (case f
        when 'fb_enroll(text)'                 then array['cbeb231b1b4846581866430f9be899b8', 'a6e39f901386b3bcdf8b6b2f11ac5b23']   -- 220's (staging, 23-Nov-2026); this migration's
        when 'fb_mirror_catchup(uuid,integer)' then array['c08a2e81784d0a250d59397847984d05', 'b2648d09d55954465ba1fb5331bd23c3']
        else                                        array['63b397d0c426d0b6ef79c8ec381b03e1', '8e4a2800499720852f410a169d563268'] end) then
      bad := bad || ('function ' || f || ' (changed since migration 220)');
    end if;
  end loop;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 218: these are not as migration 220 left them: %. Nothing was changed.', array_to_string(bad, ', ');
  end if;
end $names$;

-- Set up: enrol only (the person's click; the signed-in role's 8-second limit)
create or replace function public.fb_enroll(p_client text) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare f uuid := my_firm(); t record; bk uuid; was_on boolean; out jsonb := '[]'::jsonb; mf date; src text; act text := coalesce(current_setting('fincom.fb_actor', true), '');
begin
  if f is null or not can_write() then raise exception 'You can look at this client but cannot set up FinCom Books (the firm''s owner or staff can).' using errcode = '42501'; end if;
  perform set_config('fincom.fb_actor', 'system:mirror', true);
  for t in select x.book_id, x.client_id, x.company, x.from_date, to_jsonb(x) ->> 'source' as source from tally_books x where x.firm_id = f and x.client_id = p_client order by x.from_date nulls last loop
    src := case when t.source = 'zoho' then 'zoho' else 'tally' end;
    bk := null; was_on := null;
    select k.book_id, k.mirror_on into bk, was_on from fb_books k where k.source_book_id = t.book_id;
    if bk is null then
      bk := gen_random_uuid();
      perform pg_advisory_xact_lock(hashtextextended('fb_mirror:' || bk::text, 0));   -- the mirror lock first, as everywhere (a new book's: free)
      mf := greatest(coalesce(t.from_date, date '1900-04-01'), fb_fy_start(current_date) - interval '1 year')::date;
      insert into fb_books (book_id, firm_id, client_id, source, source_book_id, company, mirror_on, mirror_from, books_begin, state, created_by)
      values (bk, f, t.client_id, src, t.book_id, coalesce(t.company, ''), true, mf, t.from_date, 'setting_up', auth.uid());
      insert into client_books_mode (firm_id, client_id, source, effective_from, book_id, set_by)
      values (f, t.client_id, src, mf, bk, auth.uid()) on conflict (firm_id, client_id, effective_from) do nothing;
      insert into fb_mirror_state (book_id, missed_seen) values (bk, (select case when q.is_called then q.last_value else 0 end from fb_missed_seq q)) on conflict do nothing;
    elsif not was_on then
      -- switched on again: changes made while it was off were not noted, so the next catch-up compares every entry (the
      -- sweep, which also compares the masters and the openings)
      perform pg_advisory_xact_lock(hashtextextended('fb_mirror:' || bk::text, 0));
      update fb_books set mirror_on = true where book_id = bk and not mirror_on;
      insert into fb_mirror_errors (book_id, kind, key, error) values (bk, 'missed', 'resumed', 'FinCom Books was switched on again: every entry is compared');
    end if;
    out := out || jsonb_build_object('book', bk, 'company', t.company, 'state', (select k.state from fb_books k where k.book_id = bk));
  end loop;
  if jsonb_array_length(out) = 0 then raise exception 'This client has no books in FinCom''s cloud copy yet.' using errcode = '22023'; end if;
  perform set_config('fincom.fb_actor', act, true);
  return jsonb_build_object('books', out);
end $f$;

-- the catch-up: a book being built gets its masters and openings in the timer's run
create or replace function public.fb_mirror_catchup(p_book uuid, p_max int default 2000) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; st record; g record; n int := 0; res text; cnt jsonb := '{}'::jsonb; left_n int; act text := coalesce(current_setting('fincom.fb_actor', true), '');
  lim int := greatest(1, least(p_max, 20000)); od boolean := false; last_g text; got int := 0; avail int; swept boolean; failed int := 0;
  dk text[] := '{}'; dkey text[] := '{}'; dseq bigint[] := '{}'; covers bigint[]; nk text[]; nkey text[]; nseq bigint[]; rs text[]; gl text[]; i int; okn int := 0;
begin
  select k.book_id, k.source_book_id, k.mirror_from, k.mirror_on, k.state into b from fb_books k where k.book_id = p_book;
  if b.book_id is null or not b.mirror_on then return jsonb_build_object('skipped', true); end if;
  perform pg_advisory_xact_lock(hashtextextended('fb_mirror:' || p_book::text, 0));
  perform set_config('fincom.fb_actor', 'system:mirror', true);
  insert into fb_mirror_state (book_id, missed_seen) values (p_book, (select case when q.is_called then q.last_value else 0 end from fb_missed_seq q)) on conflict do nothing;
  select * into st from fb_mirror_state s where s.book_id = p_book;
  -- 218: a book set up but not built yet (its seeded groups not there): the masters and openings first, in this run of the
  -- timer, not in the person's click (fb_enroll only enrols it); then its entries below, a chunk at a time
  if b.state = 'setting_up' and not exists (select 1 from fb_groups sg where sg.book_id = p_book and sg.is_system) then
    perform fb_mirror_masters(p_book);
    perform fb_mirror_openings(p_book);
  end if;
  -- 1. the notes, one chunk in one subtransaction
  select array_agg(z.kind order by z.o), array_agg(z.key order by z.o), array_agg(z.seq order by z.o) into nk, nkey, nseq
    from (select d.kind, d.key, d.seq, row_number() over (order by d.kind <> 'g', d.kind <> 'l', d.first_at, d.key) as o
            from fb_mirror_dirty d where d.book_id = p_book
             and not exists (select 1 from fb_mirror_errors e where e.book_id = p_book and e.kind = 'catchup' and e.key = d.kind || ':' || d.key and e.resolved_at is null and e.retry_at > now())
           order by 4 limit lim) z;
  if nkey is not null then
    rs := fb_mirror_list(p_book, nk, nkey);
    for i in 1 .. array_length(nkey, 1) loop
      if rs[i] like 'failed: %' then
        failed := failed + 1; perform fb_mirror_failed(p_book, nk[i], nkey[i], substr(rs[i], 9));
      else
        okn := okn + 1;
        if nk[i] = 'v' then
          n := n + 1; cnt := jsonb_set(cnt, array[rs[i]], to_jsonb(coalesce((cnt ->> rs[i])::int, 0) + 1));
          if rs[i] = 'before' then od := true; end if;
        elsif nk[i] = 'l' then od := true;
        end if;
        dk := dk || nk[i]; dkey := dkey || nkey[i]; dseq := dseq || nseq[i];
      end if;
    end loop;
  end if;
  if od then perform fb_mirror_openings(p_book); end if;
  -- the notes mirrored are removed at once (only if not noted again since they were read: seq), before the scans below,
  -- so a copy write on the same entry seldom meets this row lock (and waits 200 ms at most if it does)
  delete from fb_mirror_dirty d using unnest(dk, dkey, dseq) u(kind, key, seq) where d.book_id = p_book and d.kind = u.kind and d.key = u.key and d.seq = u.seq;
  -- 2. by AlterID, and gone from the copy
  if n < lim then
    select array_agg(z.guid) into gl from (
      select v.guid from tally_vouchers v left join fb_vouchers f on f.book_id = p_book and f.source_ref = v.guid
       where v.book_id = b.source_book_id and v.day >= b.mirror_from and v.deleted_at is null and (f.id is null or f.source_alter is distinct from v.alter_id or f.source_gone)
         and not exists (select 1 from fb_mirror_errors e where e.book_id = p_book and e.kind = 'catchup' and e.key = 'v:' || v.guid and e.resolved_at is null and e.retry_at > now())
      union all
      select f.source_ref from fb_vouchers f left join tally_vouchers v on v.book_id = b.source_book_id and v.guid = f.source_ref
       where f.book_id = p_book and f.source_ref is not null and not f.source_gone and (v.guid is null or v.deleted_at is not null)
         and not exists (select 1 from fb_mirror_errors e where e.book_id = p_book and e.kind = 'catchup' and e.key = 'v:' || f.source_ref and e.resolved_at is null and e.retry_at > now())
      limit lim - n) z;
    if gl is not null then
      rs := fb_mirror_list(p_book, array_fill('v'::text, array[array_length(gl, 1)]), gl);
      for i in 1 .. array_length(gl, 1) loop
        n := n + 1;
        if rs[i] like 'failed: %' then failed := failed + 1; perform fb_mirror_failed(p_book, 'v', gl[i], substr(rs[i], 9));
        else okn := okn + 1; cnt := jsonb_set(cnt, array[rs[i]], to_jsonb(coalesce((cnt ->> rs[i])::int, 0) + 1)); end if;
      end loop;
    end if;
  end if;
  -- 3. the sweep
  if st.sweep_after is null then
    select array_agg(e.id order by e.id) into covers from fb_mirror_errors e where e.book_id = p_book and e.kind = 'missed' and e.resolved_at is null;
    if covers is not null then
      -- a change may have been missed: the masters are compared too (once per sweep, not every run)
      perform fb_mirror_masters(p_book); perform fb_mirror_openings(p_book);
      update fb_mirror_state set sweep_after = '', sweep_covers = covers, sweep_started = now() where book_id = p_book;
      st.sweep_after := ''; st.sweep_covers := covers;
    end if;
  end if;
  swept := st.sweep_after is null;
  if not swept and n < lim then
    avail := lim - n;
    select array_agg(z.guid order by z.guid) into gl from (select v.guid from tally_vouchers v where v.book_id = b.source_book_id and v.day >= b.mirror_from and v.guid > st.sweep_after order by v.guid limit avail) z;
    got := coalesce(array_length(gl, 1), 0);
    if got > 0 then
      last_g := gl[got];
      -- (an entry waiting for its retry time is passed over here; it stays noted and is tried at that time)
      gl := array(select x from unnest(gl) x where not exists (select 1 from fb_mirror_errors e where e.book_id = p_book and e.kind = 'catchup' and e.key = 'v:' || x and e.resolved_at is null and e.retry_at > now()) order by x);
      if coalesce(array_length(gl, 1), 0) > 0 then
        rs := fb_mirror_list(p_book, array_fill('v'::text, array[array_length(gl, 1)]), gl);
        for i in 1 .. array_length(gl, 1) loop
          n := n + 1;
          if rs[i] like 'failed: %' then failed := failed + 1; perform fb_mirror_failed(p_book, 'v', gl[i], substr(rs[i], 9));
          else okn := okn + 1; cnt := jsonb_set(cnt, array['swept_' || rs[i]], to_jsonb(coalesce((cnt ->> ('swept_' || rs[i]))::int, 0) + 1)); end if;
        end loop;
      end if;
    end if;
    swept := got < avail;
    if swept then
      update fb_mirror_errors set resolved_at = now() where id = any (st.sweep_covers) and resolved_at is null;
      update fb_mirror_state set sweep_after = null, sweep_covers = null, sweep_started = null where book_id = p_book;
      perform fb_mirror_openings(p_book);
    else
      update fb_mirror_state set sweep_after = last_g where book_id = p_book;
    end if;
  end if;
  update fb_mirror_errors e set resolved_at = now() where e.book_id = p_book and e.kind = 'catchup' and e.key <> 'run' and e.resolved_at is null
     and not exists (select 1 from fb_mirror_dirty d where d.book_id = p_book and d.kind || ':' || d.key = e.key);
  select count(*) into left_n from tally_vouchers v left join fb_vouchers f on f.book_id = p_book and f.source_ref = v.guid
   where v.book_id = b.source_book_id and v.day >= b.mirror_from and v.deleted_at is null and (f.id is null or f.source_alter is distinct from v.alter_id);
  left_n := left_n + (select count(*) from fb_mirror_dirty d where d.book_id = p_book);
  if left_n = 0 and swept then
    update fb_mirror_errors set resolved_at = now() where book_id = p_book and resolved_at is null and kind in ('catchup', 'tieout');
    if b.state = 'setting_up' then update fb_books set state = 'live' where book_id = p_book; end if;
  end if;
  if failed = 0 then update fb_mirror_state set mirrored_at = now() where book_id = p_book; end if;
  -- this call for the book worked: an earlier run's failure for it ('run') is over, even if entries are still waiting
  update fb_mirror_errors set resolved_at = now() where book_id = p_book and kind = 'catchup' and key = 'run' and resolved_at is null;
  perform set_config('fincom.fb_actor', act, true);
  -- done: entries actually mirrored (a failed one is not progress)
  return jsonb_build_object('done', okn, 'tried', n, 'left', left_n, 'failed', failed, 'by', cnt, 'sweep', case when st.sweep_after is not null then (case when swept then 'done' else 'going' end) end);
end $f$;

-- the page's status: how far a book being built is
create or replace function public.fb_status(p_client text) returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $f$
begin
  return jsonb_build_object('owner', fb_is_owner(), 'can_set_up', coalesce(can_write(), false), 'books', coalesce((
    select jsonb_agg(jsonb_build_object('book', b.book_id, 'source', b.source, 'company', b.company, 'state', b.state, 'read_only_why', b.read_only_why,
      'mirror_on', b.mirror_on, 'from', b.mirror_from, 'in_step', b.in_step, 'checked_at', b.in_step_at, 'since', b.not_in_step_since, 'why', b.not_in_step_why,
      'opening_signoff', b.opening_signoff,
      -- 218: while a book is being built, how far: entries in FinCom Books of the copy's entries in the window
      'build', case when b.state = 'setting_up' then jsonb_build_object('done', (select count(*) from fb_vouchers v where v.book_id = b.book_id),
                'of', (select count(*) from tally_vouchers t where t.book_id = b.source_book_id and t.day >= b.mirror_from and t.deleted_at is null)) end,
      -- how far behind the copy (owner decision 23-Nov-2026: FinCom Books follows within 10 minutes): within 10 minutes the
      -- page says "Updating"; beyond, "Not in step"
      'behind_since', fb_behind_since(b.book_id),
      'behind_minutes', floor(extract(epoch from (now() - fb_behind_since(b.book_id))) / 60),
      'late', coalesce(fb_behind_since(b.book_id) < now() - interval '10 minutes', false),
      'mirrored_at', (select st.mirrored_at from fb_mirror_state st where st.book_id = b.book_id),
      'counts', (select jsonb_build_object('posted', count(*) filter (where v.status = 'posted' and not v.memo), 'memo', count(*) filter (where v.memo and v.status = 'posted'),
                  'held', count(*) filter (where v.status = 'held'), 'sent', count(*) filter (where v.status = 'sent'), 'cancelled', count(*) filter (where v.status = 'cancelled'),
                  'last', max(v.date), 'waiting', (select count(*) from fb_mirror_dirty d where d.book_id = b.book_id and d.kind = 'v'))
                  from fb_vouchers v where v.book_id = b.book_id),
      'tieout', (select jsonb_build_object('at', t.at, 'kind', t.kind, 'in_step', t.in_step, 'words', t.words, 'source_read', t.source_figures is not null,
                  'differences', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(t.differences) e limit 20) z),
                  'n', jsonb_array_length(t.differences)) from fb_tieouts t where t.id = b.last_tieout_id))
      order by b.mirror_from desc nulls last)
      from fb_books b where b.client_id = p_client and b.book_id in (select fb_my_books())), '[]'::jsonb));
end $f$;

-- the same comment and grants as 220 gave them (CREATE OR REPLACE keeps both; said again so that a re-run is exact)
do $g$
declare f text;
begin
  foreach f in array array['fb_enroll(text)', 'fb_mirror_catchup(uuid,integer)', 'fb_status(text)'] loop
    execute format('comment on routine %s is %L', to_regprocedure('public.' || f), 'fincom books (migration 220)');
    execute format('revoke all on routine %s from public, anon, authenticated, service_role', to_regprocedure('public.' || f));
  end loop;
  grant execute on function public.fb_enroll(text) to authenticated;
  grant execute on function public.fb_status(text) to authenticated, service_role;
  grant execute on function public.fb_mirror_catchup(uuid, integer) to service_role;
end $g$;

commit;
