-- migration-219-post-copy-resend.sql (24-Nov-2026, branch next-fix-reupload-posted). Written, NOT run: the owner reads it and
-- runs it after its own review.
-- Why (staging, 24-Nov-2026, a sales invoice posted by FinCom as an Optional voucher on 18-Nov, deleted in Tally, then
-- posted again): the queue (184's tally_post_enqueue_core) found its FinCom id still live for the posting that sent it,
-- queued nothing and the page took that posting's old answer for a new one. The owner: "Cloud also deletes the entry the
-- moment we delete entry in tally ... dont read from tally". So FinCom decides from its own copy of Tally (tally_vouchers),
-- never by asking Tally, and does what is needed on the Post press itself.
-- What 219 does. One new function, tally_post_copy_resend(p_job, p_id), for a member who may post (can_write()), under
-- enqueue_core's advisory lock for the firm and client (taken before the posting's row lock, the same order as 184):
--   * the posting (p_job, of the member's firm) must be done (not checking, not stopped; a failed or cancelled one is
--     refused with its own words: handing one back would re-arm its other entries), posting into its company still allowed
--     (200's tally_post_job_blocked), and hold the entry: a LIVE tally_post_ids row of p_job matching p_id;
--   * the entry's FinCom id not live in any other posting, and not reserved for another posting's hand-back
--     (201's tally_post_resend_reserved);
--   * FinCom's copy of Tally (tally_vouchers, by the entry's FinCom id) decides:
--       a live regular voucher (not deleted, cancelled or Optional) in ANY book of the client's company of that name:
--         'there', nothing changes;
--       the linked book (tally_links) has no voucher of it, or the company has no linked book: 'none', nothing changes;
--       only deleted, Optional or cancelled vouchers: released and handed back ONLY when all of these hold, else 'unsure'
--         and nothing changes (the reviews of 24-Nov-2026: never on a copy that may be stale):
--           - the copy is fresh for that book: a recorder line of the book APPLIED to the copy, or a Day Book read of the
--             voucher's day, after the posting's last send of the entry (its acceptance, its own sentAt, the posting's
--             taking); and no recorder line of this voucher (its GUID or its day) still held or fetching;
--           - Tally's acceptance of this entry (its id row's accepted_at), when there is one, is older than the copy's
--             deletion of it (an Optional-only or cancelled-only copy carries no time: refused when accepted);
--           - no earlier release of this entry in this posting (tally_post_marks 'released') newer than the copy's last
--             report of the voucher (its deletion, or its newest version);
--         then the id is released (36b's tally_post_release_core, released_by 'owner', the copy's state as the reason:
--         tally-ingest hands that release with the posting, so the posting computer's record lets it go ONCE) and the
--         posting handed back to send that entry alone (resend_only, as 200's tally_post_settle_resend), unless 36b's
--         guard (tally_post_job_accepted) holds it.
-- An ordinary new posting of the id is never released by this: a Tally that drops FinCom's mark from the narration (the
-- posting computer of 03-Oct-2026) still gets no duplicate from an ordinary repost. Nothing is asked of Tally here.
-- Add-only: one function made (no table, column, index, row or policy changed; nothing dropped or deleted); granted to
-- authenticated (not public, anon). Stops at the start, changing nothing, when the name is taken by another function (any
-- arguments, also one marked 219's with other arguments) or a helper it needs is missing. One transaction, lock_timeout
-- 10 s; safe twice. Tested by tests/run_migration219.py (pg_stand). Runs after 36b, 184, 200 and 201.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 0. the name guard
do $names$
declare bad text[] := '{}'; h text;
begin
  -- (by the function's name: any tally_post_copy_resend that is not this migration's, or this one's name with other
  -- arguments, stops it)
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tally_post_copy_resend'
               and (coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'tally post copy resend (migration 219)'
                    or pg_get_function_identity_arguments(p.oid) <> 'p_job uuid, p_id text')) then
    bad := bad || 'a function named tally_post_copy_resend exists that is not 219''s'::text;
  end if;
  foreach h in array array['public.my_firm()', 'public.can_write()', 'public.tally_fincom_id(jsonb)', 'public.tally_post_id_match(text, text, text)',
                           'public.tally_post_release_core(uuid, uuid, uuid, text, text)', 'public.tally_post_job_blocked(uuid)',
                           'public.tally_post_job_accepted(uuid, jsonb, jsonb)', 'public.tally_nm(text)', 'public.tally_post_resend_reserved(uuid)'] loop
    if to_regprocedure(h) is null then bad := bad || ('function ' || h || ' is missing'); end if;
  end loop;
  foreach h in array array['public.tally_post_jobs', 'public.tally_post_ids', 'public.tally_post_marks', 'public.tally_vouchers', 'public.tally_voucher_versions',
                           'public.tally_companies', 'public.tally_links', 'public.tally_recorder_lines', 'public.tally_days'] loop
    if to_regclass(h) is null then bad := bad || ('table ' || h || ' is missing'); end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_vouchers' and column_name = 'fincom_id')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_post_jobs' and column_name = 'resend_only') then
    bad := bad || 'tally_vouchers.fincom_id or tally_post_jobs.resend_only is missing'::text;
  end if;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 219: %. Nothing was changed.', array_to_string(bad, '; ');
  end if;
end $names$;

-- ---------------------------------------------------------------- 1. the entry, by FinCom's copy of Tally
create or replace function public.tally_post_copy_resend(p_job uuid, p_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); cl text; j tally_post_jobs%rowtype; v jsonb; eid text; fid text; bk uuid; n_all int; n_del int; n_opt int;
  r record; st text; why text; held text; acc timestamptz; last_send timestamptz; max_del timestamptz; rep timestamptz; fresh boolean;
  unsure constant text := 'FinCom''s copy of Tally is not up to date for this company, so it cannot tell whether this entry is still in Tally. Nothing was sent.';
begin
  if f is null or not can_write() then
    raise exception 'only a member of the firm who may post (an owner or staff) can post this again' using errcode = '42501'; end if;
  -- enqueue_core's lock for the firm and client first (184's order), then the posting's row
  select x.client_id into cl from tally_post_jobs x where x.id = p_job and x.firm_id = f;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_post_enqueue'), hashtext(f::text || ':' || coalesce(cl, '')));
  select * into j from tally_post_jobs where id = p_job and firm_id = f for update;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if j.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'state', 'cancelled', 'job', p_job, 'error', 'That posting was cancelled, so it is not sent again from here. Nothing was changed.');
  end if;
  if j.status = 'failed' then
    return jsonb_build_object('ok', false, 'state', 'failed', 'job', p_job, 'error', 'That posting did not finish. Use Retry on it on the Post page. Nothing was changed.');
  end if;
  if j.status <> 'done' or coalesce(j.checking, false) or j.stop_reason is not null then
    return jsonb_build_object('ok', false, 'state', 'busy', 'job', p_job, 'error', 'That posting is still being sent or settled; nothing was changed.');
  end if;
  select x into v from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) x where tally_post_id_match(tally_fincom_id(x), x->>'id', p_id) limit 1;
  if v is null then raise exception 'the entry % is not in this posting', p_id; end if;
  eid := v->>'id'; fid := tally_fincom_id(v);
  -- the posting must hold the entry now (its own live id row)
  select i.accepted_at into acc from tally_post_ids i where i.job_id = p_job and i.live and tally_post_id_match(i.fincom_id, i.entry_id, p_id) limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'state', 'notheld', 'job', p_job, 'id', eid, 'error', 'That posting does not hold this entry any more, so there is nothing to release. Nothing was changed.');
  end if;
  if exists (select 1 from tally_post_ids o where o.firm_id = f and o.fincom_id = fid and o.live and o.job_id <> p_job)
     or exists (select 1 from tally_post_resend_reserved(f) rr where rr.fincom_id = fid and rr.job_id <> p_job) then
    return jsonb_build_object('ok', false, 'state', 'elsewhere', 'job', p_job, 'id', eid, 'error', 'Another posting holds this entry; it is not sent twice. Nothing was changed.');
  end if;
  held := tally_post_job_blocked(p_job);
  if held is not null then
    return jsonb_build_object('ok', false, 'state', 'blocked', 'job', p_job, 'id', eid, 'error', left('Posting into Tally is not allowed for this posting now: ' || held, 500));
  end if;
  -- a live regular voucher in any book of the client's company of that name: there
  select vv.vtype, vv.vno, vv.day into r from tally_vouchers vv join tally_companies t on t.book_id = vv.book_id
   where t.firm_id = f and t.client_id = j.client_id and lower(tally_nm(t.company)) = lower(tally_nm(j.company))
     and vv.fincom_id = fid and vv.deleted_at is null and not coalesce(vv.cancelled, false) and not coalesce(vv.optional, false)
   order by vv.day desc, vv.vno limit 1;
  if found then
    return jsonb_build_object('ok', false, 'state', 'there', 'job', p_job, 'id', eid, 'vtype', r.vtype, 'vno', r.vno, 'day', r.day,
      'error', 'FinCom''s copy of Tally has it as a regular entry; nothing was sent.');
  end if;
  -- the linked book decides the rest
  select l.book_id into bk from tally_links l where l.firm_id = f and l.client_id = j.client_id and l.state = 'linked'
     and lower(tally_nm(l.company_name)) = lower(tally_nm(j.company)) order by l.linked_at desc nulls last, l.book_id limit 1;
  if bk is null then
    return jsonb_build_object('ok', false, 'state', 'none', 'job', p_job, 'id', eid, 'error', 'This company is not linked to a Tally company in FinCom, so FinCom''s copy cannot tell. Nothing was sent.');
  end if;
  select count(*), count(*) filter (where vv.deleted_at is not null),
         count(*) filter (where vv.deleted_at is null and coalesce(vv.optional, false) and not coalesce(vv.cancelled, false)), max(vv.deleted_at)
    into n_all, n_del, n_opt, max_del
    from tally_vouchers vv where vv.book_id = bk and vv.fincom_id = fid;
  if n_all = 0 then
    return jsonb_build_object('ok', false, 'state', 'none', 'job', p_job, 'id', eid, 'error', 'FinCom''s copy of Tally has no entry carrying this FinCom id, so it cannot tell whether it is in Tally. Nothing was sent.');
  end if;
  st := case when n_del > 0 then 'deleted' when n_opt > 0 then 'optional' else 'cancelled' end;
  -- the posting's last send of the entry: Tally's acceptance, the entry's own sentAt, the posting's taking
  select greatest(acc, j.taken_at, j.first_taken_at,
                  (select case when x->>'sentAt' ~ '^\d{4}-\d\d-\d\dT' then (x->>'sentAt')::timestamptz end
                     from jsonb_array_elements(case when jsonb_typeof(j.results) = 'array' then j.results else '[]'::jsonb end) x where x->>'id' = eid limit 1))
    into last_send;
  -- (1) Tally took it and the copy has nothing newer for it (an Optional-only or cancelled-only copy carries no time)
  if acc is not null and (max_del is null or max_del <= acc) then
    return jsonb_build_object('ok', false, 'state', 'unsure', 'copy', st, 'job', p_job, 'id', eid, 'error', unsure);
  end if;
  -- (1) an earlier release of it in this posting newer than the copy's last report of the voucher
  select greatest(max_del, (select max(w.seen_at) from tally_voucher_versions w where w.book_id = bk and w.tally_guid in (select vv.guid from tally_vouchers vv where vv.book_id = bk and vv.fincom_id = fid)))
    into rep;
  if exists (select 1 from tally_post_marks m where m.job_id = p_job and m.entry_id = eid and m.action = 'released' and m.at > coalesce(rep, '-infinity'::timestamptz)) then
    return jsonb_build_object('ok', false, 'state', 'unsure', 'copy', st, 'job', p_job, 'id', eid, 'error', unsure);
  end if;
  -- (4) the copy fresh for that book since the last send: a recorder line, or a Day Book read of the voucher's day
  -- (the re-review: a recorder line counts only once applied to the copy; and never while a line of this voucher, by its
  -- GUID or its day, is still held or fetching, whichever read made the copy fresh)
  fresh := last_send is not null and (
             exists (select 1 from tally_recorder_lines rl where rl.book_id = bk and rl.state = 'applied' and coalesce(rl.applied_at, rl.received_at) > last_send)
          or exists (select 1 from tally_days d where d.book_id = bk and d.at > last_send and d.day in (select vv.day from tally_vouchers vv where vv.book_id = bk and vv.fincom_id = fid)))
       and not exists (select 1 from tally_recorder_lines h where h.book_id = bk and h.state in ('held', 'fetching')
                         and (h.object_guid in (select vv.guid from tally_vouchers vv where vv.book_id = bk and vv.fincom_id = fid)
                              or h.vch_date in (select vv.day from tally_vouchers vv where vv.book_id = bk and vv.fincom_id = fid)));
  if not fresh then
    return jsonb_build_object('ok', false, 'state', 'unsure', 'copy', st, 'job', p_job, 'id', eid, 'error', unsure);
  end if;
  why := 'FinCom''s copy of Tally shows it ' || case st when 'deleted' then 'deleted in Tally' when 'optional' then 'only as an Optional voucher' else 'only as a cancelled voucher' end
         || ' (' || to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST): posted again';
  perform tally_post_release_core(f, auth.uid(), p_job, p_id, why);
  -- 36b's guard: an entry Tally accepted that nobody settled keeps the posting from the bridge
  select * into j from tally_post_jobs where id = p_job;
  if tally_post_job_accepted(p_job, j.results, j.items) is not null then
    return jsonb_build_object('ok', true, 'state', st, 'job', p_job, 'id', eid, 'released', true, 'resent', false, 'review', true,
      'error', 'Released, but another entry of that posting needs a person first, so it was not sent yet.');
  end if;
  update tally_post_jobs set resend_only = jsonb_build_array(eid), status = 'waiting', checking = false, taken_at = null,
         attempts = coalesce(attempts, 0) + 1, updated_at = now(), message = left(why || ' (this entry alone)', 500)
   where id = p_job;
  return jsonb_build_object('ok', true, 'state', st, 'job', p_job, 'id', eid, 'released', true, 'resent', true, 'why', why);
end $function$;
comment on function public.tally_post_copy_resend(uuid, text) is 'tally post copy resend (migration 219)';
revoke all on function public.tally_post_copy_resend(uuid, text) from public, anon;
grant execute on function public.tally_post_copy_resend(uuid, text) to authenticated;

commit;
