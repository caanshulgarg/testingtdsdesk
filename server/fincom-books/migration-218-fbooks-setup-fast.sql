-- Migration 218 (23-Nov-2026, branch next-fix-fbooks-setup). A DRAFT: written and tested here (tests/run_migration220.py
-- on pg_stand, made-up books only); NOT run anywhere. Run it AFTER migration 220 (FinCom Books P1), and again after any
-- re-run of 220 (220 would put back the six functions below as they were).
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
--                        8-second limit), and that call ends there, so the timer commits them on their own: a later
--                        failure does not undo them and a retry does not write them again; its entries then follow a
--                        chunk at a time (fb_mirror_catchup_run takes books being built first, at most 5,000 entries a run,
--                        one transaction per book and chunk). When the book goes live, a check stored while it was half
--                        built (before this migration) is cleared: "Not checked yet" until the next check
--   fb_status            220's text with ONE field added: 'build' {done, of, failed, stuck} while a book is being built:
--                        entries in FinCom Books of the copy's entries in the window (cancelled and deleted entries in
--                        neither), so the page shows "Building: 2,400 of 7,300 entries" and finishes by itself; failed
--                        {at (the last try), since, tries, why} when the catch-up's last run for the book failed, and
--                        stuck: entries it could not copy yet (each tried again later)
--   fb_tieout            220's text with ONE step added at the top (review of 24-Nov-2026): a book being built is not
--                        tied out. It answers "being built" and stores nothing, so no half-built "Not in step" is kept,
--                        and it calls no catch-up, so "Check now" builds nothing inside the person's click
--   fb_tieout_all        220's text, passing over books being built (the nightly check; fb_tieout_ask and
--                        fb_opening_signoff go through fb_tieout and get "being built")
--   fb_mirror_run_failed 220's text, also noting the next try (retry_at, the next 3-minute run), so fb_status can say
--                        when the last try was
-- ADD-ONLY in effect: no table, column, index, trigger or grant is added or removed; six functions are replaced with
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
  foreach f in array array['fb_enroll(text)', 'fb_mirror_catchup(uuid,integer)', 'fb_status(text)', 'fb_tieout(uuid,text,uuid)', 'fb_tieout_all()', 'fb_mirror_run_failed(uuid,text)'] loop
    select md5(p.prosrc), coalesce(obj_description(p.oid, 'pg_proc'), '') into m, cm from pg_proc p where p.oid = to_regprocedure('public.' || f);
    if m is null then bad := bad || ('function ' || f || ' (not here)');
    elsif cm <> 'fincom books (migration 220)' then bad := bad || ('function ' || f || ' (not FinCom Books'')');
    elsif m <> all (case f
        when 'fb_enroll(text)'                 then array['cbeb231b1b4846581866430f9be899b8', 'a6e39f901386b3bcdf8b6b2f11ac5b23']   -- 220's (staging, 23-Nov-2026); this migration's
        when 'fb_mirror_catchup(uuid,integer)' then array['c08a2e81784d0a250d59397847984d05', '05aab91850f5003ab0a32501be322446']
        when 'fb_status(text)'                 then array['63b397d0c426d0b6ef79c8ec381b03e1', 'f45656f07abdf17cbd21511ff875e391']
        when 'fb_tieout(uuid,text,uuid)'       then array['da56dade7636bfc089d04b60a82d47a4', '5fcefe6319a621b601fa2ec8773c719f']
        when 'fb_tieout_all()'                 then array['a27208d85731f73f146ae65af37b4006', '8190e5a5e1c6a652e8ca5fd3bdb860f3']
        else                                        array['a7128ef21b04bec3ffe40a76aac22941', '50be4fd96b4e584977315184cef95291'] end) then
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
    -- this call ends here (review of 24-Nov-2026): the timer commits the masters on their own, so a failure in the entries
    -- after them does not undo them, and a retry finds them there and does not write them again. It counts as one step
    -- done ('done' 1), so the timer gives the book its first chunk of entries in this same run, in a call of its own
    select count(*) into left_n from tally_vouchers v where v.book_id = b.source_book_id and v.day >= b.mirror_from and v.deleted_at is null;
    perform set_config('fincom.fb_actor', act, true);
    return jsonb_build_object('done', 1, 'tried', 0, 'left', left_n, 'failed', 0, 'by', '{}'::jsonb, 'masters', true);
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
    -- built: live. A check stored while it was half built (by 220's fb_tieout, before this migration) is not kept:
    -- "Not checked yet" until the next one
    if b.state = 'setting_up' then
      update fb_books set state = 'live', in_step = null, in_step_at = null, last_tieout_id = null, not_in_step_since = null, not_in_step_why = '' where book_id = p_book;
    end if;
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
      -- 218: while a book is being built, how far: entries in FinCom Books of the copy's entries in the window, counted
      -- alike (an entry cancelled in the copy, or deleted from it and kept here as cancelled, is in neither); failed: the
      -- catch-up's last run for this book failed ('at' the last try; the next run tries again); stuck: entries it could
      -- not copy yet (each tried again later)
      'build', case when b.state = 'setting_up' then jsonb_build_object(
                'done', (select count(*) from fb_vouchers v where v.book_id = b.book_id and v.source_ref is not null and not v.source_gone and v.status <> 'cancelled' and v.date >= b.mirror_from),
                'of', (select count(*) from tally_vouchers t where t.book_id = b.source_book_id and t.day >= b.mirror_from and t.deleted_at is null and not coalesce(t.cancelled, false)),
                'failed', (select jsonb_build_object('at', coalesce(e.retry_at - interval '3 minutes', e.at), 'since', e.at, 'tries', e.tries, 'why', left(e.error, 160))
                             from fb_mirror_errors e where e.book_id = b.book_id and e.kind = 'catchup' and e.key = 'run' and e.resolved_at is null order by e.id desc limit 1),
                'stuck', (select count(*) from fb_mirror_errors e where e.book_id = b.book_id and e.kind = 'catchup' and e.key <> 'run' and e.resolved_at is null)) end,
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

-- the tie-out: a book being built is not tied out (nothing stored, nothing built)
create or replace function public.fb_tieout(p_book uuid, p_kind text default 'nightly', p_by uuid default null) returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; diffs jsonb := '[]'::jsonb; d jsonb; ins boolean; words text := ''; tid bigint; opsum numeric; sf record; held int; errs int; sent int;
  copy_fig jsonb; fb_fig jsonb; grp record; ndiff int := 0; src_fig jsonb; word text; act text := coalesce(current_setting('fincom.fb_actor', true), '');
begin
  select k.* into b from fb_books k where k.book_id = p_book;
  if b.book_id is null then raise exception 'no such book'; end if;
  word := case when b.source = 'zoho' then 'Zoho' else 'Tally' end;
  -- 218 (review of 24-Nov-2026): a book still being built is not tied out. Its figures are half there, and a result
  -- stored now ("Not in step", with wrong differences) would stay after the build. Nothing is stored, and no catch-up is
  -- called (asked, it would build the book inside the person's click): the 3-minute catch-up builds it
  if b.state = 'setting_up' then
    return jsonb_build_object('in_step', null, 'updating', true, 'building', true, 'words', 'FinCom Books is still being built from ' || word || '. It is checked once it is built.');
  end if;
  -- what the copy changed in the last minutes is mirrored first, so the check compares like with like. Asked by a member
  -- (or with an opening sign-off), at most 500 entries, so the request stays short; still behind then: "Updating", and
  -- nothing is stored (the book's step stays as it was)
  if fb_behind_since(p_book) is not null or exists (select 1 from fb_mirror_state st where st.book_id = p_book and st.sweep_after is not null) then
    perform fb_mirror_catchup(p_book, case when p_kind = 'asked' then 500 else 20000 end);
    if p_kind = 'asked' and (fb_behind_since(p_book) is not null or exists (select 1 from fb_mirror_state st where st.book_id = p_book and st.sweep_after is not null)) then
      perform set_config('fincom.fb_actor', act, true);
      return jsonb_build_object('in_step', null, 'updating', true, 'words', 'FinCom Books is still bringing in the latest changes from ' || word || '. Check again in a few minutes.');
    end if;
  end if;
  perform set_config('fincom.fb_actor', 'system:tieout', true);
  -- 1. ledger by day: the copy against FinCom Books (to the paisa)
  with c as (select w.ledger, w.day, sum(w.amount) as a from fb_copy_window(p_book) w group by 1, 2),
  f as (select g.name as ledger, l.date as day, sum(l.amount) as a from fb_lines l join fb_vouchers v on v.id = l.voucher_id and v.version = l.version
          join fb_ledgers g on g.id = l.ledger_id where l.book_id = p_book and v.status = 'posted' and not v.memo and l.date >= b.mirror_from group by 1, 2),
  x as (select coalesce(c.ledger, f.ledger) as ledger, coalesce(c.day, f.day) as day, coalesce(c.a, 0) as copy, coalesce(f.a, 0) as fb
          from c full join f on f.ledger = c.ledger and f.day = c.day where coalesce(c.a, 0) <> coalesce(f.a, 0))
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'ledger_day', 'ledger', x.ledger, 'day', x.day, 'copy', x.copy, 'fincom', x.fb, 'diff', x.fb - x.copy,
           'group', coalesce((select coalesce(nullif(gg.reserved, ''), gg.name) from fb_ledgers lg join fb_groups gg on gg.id = lg.group_id where lg.book_id = p_book and lg.name = x.ledger), '')) order by x.ledger, x.day), '[]'::jsonb)
    into d from x;
  -- a day's difference that is exactly the held entries of that ledger and day is named as their cause
  select coalesce(jsonb_agg(case when h.a is not null and h.a = -(e ->> 'diff')::numeric then e || jsonb_build_object('cause', 'held') else e end), '[]'::jsonb) into d
    from jsonb_array_elements(d) e
    left join lateral (select sum(-l.amount) as a from fb_vouchers v join tally_lines l on l.book_id = b.source_book_id and l.guid = v.source_ref
                        where v.book_id = p_book and v.status = 'held' and v.date = (e ->> 'day')::date and l.ledger = e ->> 'ledger') h on true;
  diffs := diffs || d;
  -- 2. entries by type and month (every entry not deleted in the source)
  with c as (select v.vtype, to_char(v.day, 'YYYY-MM') as m, count(*) as n from tally_vouchers v where v.book_id = b.source_book_id and v.deleted_at is null and v.day >= b.mirror_from group by 1, 2),
  f as (select coalesce(t.name, '') as vtype, to_char(v.date, 'YYYY-MM') as m, count(*) as n from fb_vouchers v left join fb_vtypes t on t.id = v.vtype_id
         where v.book_id = p_book and v.source_ref is not null and not v.source_gone group by 1, 2)
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'count', 'vtype', coalesce(c.vtype, f.vtype), 'month', coalesce(c.m, f.m), 'copy', coalesce(c.n, 0), 'fincom', coalesce(f.n, 0))), '[]'::jsonb)
    into d from c full join f on f.vtype = c.vtype and f.m = c.m where coalesce(c.n, 0) <> coalesce(f.n, 0);
  diffs := diffs || d;
  -- 3. openings (Tally's opening plus the older entries, D20)
  with c as (select w.name, w.amount as a from fb_copy_openings(p_book) w),
  f as (select g.name, o.amount as a from fb_openings o join fb_ledgers g on g.id = o.ledger_id where o.book_id = p_book and o.as_on = b.mirror_from)
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'opening', 'ledger', coalesce(c.name, f.name), 'copy', coalesce(c.a, 0), 'fincom', coalesce(f.a, 0))), '[]'::jsonb)
    into d from c full join f on f.name = c.name where coalesce(c.a, 0) <> coalesce(f.a, 0);
  diffs := diffs || d;
  -- 4. D7: a difference in opening balances keeps the book Not in step until the owner signs it off (that amount)
  select coalesce(sum(o.amount), 0) into opsum from fb_openings o where o.book_id = p_book and o.as_on = b.mirror_from;
  if opsum <> 0 and ((b.opening_signoff ->> 'amount') is null or (b.opening_signoff ->> 'amount')::numeric <> opsum) then
    diffs := diffs || jsonb_build_array(jsonb_build_object('kind', 'opening_difference', 'amount', opsum));
  end if;
  -- 5. entries held (Dr and Cr differ in the copy) and changes the mirror could not apply
  select count(*) into held from fb_vouchers v where v.book_id = p_book and v.status = 'held';
  if held > 0 then
    diffs := diffs || coalesce((select jsonb_agg(jsonb_build_object('kind', 'held', 'guid', v.source_ref, 'number', v.number, 'date', v.date, 'why', v.mirror_note) order by v.date)
                                  from (select * from fb_vouchers v where v.book_id = p_book and v.status = 'held' order by v.date limit 50) v), '[]'::jsonb);
  end if;
  select count(*) into errs from fb_mirror_errors e where e.book_id = p_book and e.resolved_at is null;
  if errs > 0 then diffs := diffs || jsonb_build_array(jsonb_build_object('kind', 'mirror_error', 'n', errs)); end if;
  -- 6. Tally's own figures, once read (TODO D16 / bridge 2.5.19): each primary group's closing at the date read
  select * into sf from fb_source_figures s where s.book_id = p_book and s.kind = 'group_closing' order by s.at desc limit 1;
  if sf.id is not null then
    with f as (select g.primary_name as grp, sum(c.bal) as a from fb_closing(p_book, sf.as_on) c join fb_ledgers l on l.id = c.ledger_id join fb_groups g on g.id = l.group_id group by 1),
    s as (select key as grp, value::numeric as a from jsonb_each_text(sf.figures))
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'source_group', 'group', coalesce(s.grp, f.grp), 'as_on', sf.as_on, 'source', coalesce(s.a, 0), 'fincom', coalesce(f.a, 0),
             'diff', coalesce(f.a, 0) - coalesce(s.a, 0)) order by coalesce(s.grp, f.grp)), '[]'::jsonb)
      into d from s full join f on f.grp = s.grp where coalesce(s.a, 0) <> coalesce(f.a, 0);
    diffs := diffs || d;
    src_fig := jsonb_build_object('as_on', sf.as_on, 'read_at', sf.at, 'groups', sf.figures);
  end if;
  select count(*) into sent from fb_vouchers v where v.book_id = p_book and v.status = 'sent';
  ins := jsonb_array_length(diffs) = 0;
  -- the words: the biggest group difference first ("Sundry Debtors differs by ₹4,200.00")
  if not ins then
    select x.g, sum(x.d) as s, count(*) over () as n into grp from (
      select coalesce(nullif(e ->> 'group', ''), e ->> 'ledger') as g, (e ->> 'diff')::numeric as d from jsonb_array_elements(diffs) e where e ->> 'kind' = 'ledger_day' and e ->> 'cause' is null
      union all select e ->> 'group', (e ->> 'diff')::numeric from jsonb_array_elements(diffs) e where e ->> 'kind' = 'source_group') x
     group by x.g having sum(x.d) <> 0
     -- the biggest first; of equal ones, the balance sheet's group (Sundry Debtors before Sales Accounts)
     order by abs(sum(x.d)) desc, coalesce((select sg.sort from fb_seed_groups sg where sg.name = x.g), 1000), x.g limit 1;
    select count(*) into ndiff from jsonb_array_elements(diffs);
    words := case
      when grp.g is not null then grp.g || ' differs by ' || fb_inr(abs(grp.s)) || case when grp.n > 1 then ' (and ' || (grp.n - 1) || ' more)' else '' end
      when exists (select 1 from jsonb_array_elements(diffs) e where e ->> 'kind' = 'opening_difference') then 'Difference in opening balances in ' || word || ': ' || fb_inr(abs(opsum)) || ' (the owner may accept it with a reason)'
      when held > 0 then held || case when held = 1 then ' entry is' else ' entries are' end || ' held: Dr and Cr differ in the copy'
      when errs > 0 then 'A change from ' || word || ' could not be applied (FinCom is looking into it)'
      when exists (select 1 from jsonb_array_elements(diffs) e where e ->> 'kind' = 'count') then 'The number of entries differs (FinCom Books is still being built, or an entry is missing)'
      else 'An opening balance differs' end;
  end if;
  select jsonb_build_object('ledgers', count(distinct w.ledger), 'entries', count(distinct w.guid), 'total_dr', coalesce(sum(w.amount) filter (where w.amount > 0), 0)) into copy_fig from fb_copy_window(p_book) w;
  select jsonb_build_object('entries', count(*) filter (where v.status = 'posted' and not v.memo), 'memo', count(*) filter (where v.memo), 'held', held, 'sent', sent,
           'cancelled', count(*) filter (where v.status = 'cancelled'), 'opening_total', opsum,
           'alter_max', max(v.source_alter), 'copy_alter_max', (select max(t.alter_id) from tally_vouchers t where t.book_id = b.source_book_id))
    into fb_fig from fb_vouchers v where v.book_id = p_book;
  insert into fb_tieouts (book_id, firm_id, kind, asked_by, window_from, window_to, in_step, copy_figures, fb_figures, source_figures, differences, words)
  values (p_book, b.firm_id, p_kind, p_by, b.mirror_from, current_date, ins, copy_fig, fb_fig, src_fig,
          (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(diffs) e limit 200) z), words)
  returning id into tid;
  update fb_books set in_step = ins, in_step_at = now(), last_tieout_id = tid,
    not_in_step_since = case when ins then null else coalesce(not_in_step_since, now()) end,
    not_in_step_why = case when ins then '' else words end
   where book_id = p_book;
  perform set_config('fincom.fb_actor', act, true);
  return jsonb_build_object('id', tid, 'in_step', ins, 'words', words, 'differences', jsonb_array_length(diffs), 'source_read', sf.id is not null, 'sent', sent);
end $f$;

-- the nightly tie-out of every book: books being built are passed over
create or replace function public.fb_tieout_all() returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare b record; n int := 0; bad int := 0; r jsonb;
begin
  -- 218: a book being built is passed over (fb_tieout would answer "being built" for it too)
  for b in select k.book_id from fb_books k where k.mirror_on and k.state <> 'setting_up' order by k.book_id loop
    begin
      r := fb_tieout(b.book_id, 'nightly'); n := n + 1; if not (r ->> 'in_step')::boolean then bad := bad + 1; end if;
    exception when others then
      insert into fb_mirror_errors (book_id, kind, error) values (b.book_id, 'tieout', left(sqlerrm, 500)); bad := bad + 1;
    end;
  end loop;
  return jsonb_build_object('books', n, 'not_in_step', bad, 'being_built', (select count(*) from fb_books k where k.mirror_on and k.state = 'setting_up'));
end $f$;

-- a catch-up run that failed for a book: the next try noted (fb_status gives the last try)
create or replace function public.fb_mirror_run_failed(p_book uuid, p_err text) returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  -- 218: retry_at is the next try (the timer's next run, 3 minutes on), so fb_status can say when the last try was
  update fb_mirror_errors e set tries = e.tries + 1, error = left(p_err, 500), retry_at = now() + interval '3 minutes'
   where e.book_id = p_book and e.kind = 'catchup' and e.key = 'run' and e.resolved_at is null;
  if not found then insert into fb_mirror_errors (book_id, kind, key, error, retry_at) values (p_book, 'catchup', 'run', left(p_err, 500), now() + interval '3 minutes'); end if;
end $f$;

-- the same comment and grants as 220 gave them (CREATE OR REPLACE keeps both; said again so that a re-run is exact)
do $g$
declare f text;
begin
  foreach f in array array['fb_enroll(text)', 'fb_mirror_catchup(uuid,integer)', 'fb_status(text)', 'fb_tieout(uuid,text,uuid)', 'fb_tieout_all()', 'fb_mirror_run_failed(uuid,text)'] loop
    execute format('comment on routine %s is %L', to_regprocedure('public.' || f), 'fincom books (migration 220)');
    execute format('revoke all on routine %s from public, anon, authenticated, service_role', to_regprocedure('public.' || f));
  end loop;
  grant execute on function public.fb_enroll(text) to authenticated;
  grant execute on function public.fb_status(text) to authenticated, service_role;
  grant execute on function public.fb_mirror_catchup(uuid, integer) to service_role;
  grant execute on function public.fb_tieout(uuid, text, uuid) to service_role;
  grant execute on function public.fb_tieout_all() to service_role;
end $g$;

commit;
