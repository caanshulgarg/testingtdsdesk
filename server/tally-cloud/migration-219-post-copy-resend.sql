-- migration-219-post-copy-resend.sql (24-Nov-2026, branch next-fix-reupload-posted). Written, NOT run: the owner reads it and
-- runs it after its own review.
-- Why (staging, 24-Nov-2026, a sales invoice posted by FinCom as an Optional voucher on 18-Nov, deleted in Tally, then
-- posted again): the queue (184's tally_post_enqueue_core) found its FinCom id still live for the posting that sent it,
-- queued nothing and the page took that posting's old answer for a new one. The owner: "Cloud also deletes the entry the
-- moment we delete entry in tally ... dont read from tally". So FinCom decides from its own copy of Tally (tally_vouchers),
-- never by asking Tally, and does what is needed on the Post press itself.
-- What 219 does. One new function, tally_post_copy_resend(p_job, p_id), for a member who may post (can_write()):
--   * the posting (p_job, of the member's firm) must be settled (done or failed, not checking, not stopped), posting into
--     its company still allowed (200's tally_post_job_blocked), and hold the entry (p_id, as 36b matches ids);
--   * the entry's FinCom id must not be live in any OTHER posting (it is never sent twice);
--   * FinCom's copy of the client's company (tally_vouchers of its book, by the entry's FinCom id) decides:
--       a live regular voucher (not deleted, not cancelled, not Optional): 'there', nothing changes;
--       no voucher at all: 'none', nothing changes (the copy cannot tell);
--       only deleted, Optional or cancelled vouchers: the id released (36b's tally_post_release_core, released_by
--       'owner', with the copy's state as the reason: tally-ingest hands that release with the posting, so the posting
--       computer's own record of having sent it lets it go ONCE) and the posting handed back to send that entry alone
--       (resend_only, as 200's tally_post_settle_resend does), unless 36b's guard (tally_post_job_accepted) holds it.
-- An ordinary new posting of the id is never released by this: a Tally that drops FinCom's mark from the narration (the
-- posting computer of 03-Oct-2026) still gets no duplicate from an ordinary repost. Nothing is asked of Tally here.
-- Add-only: one function made (no table, column, index, row or policy changed; nothing dropped or deleted); granted to
-- authenticated (not public, anon). Stops at the start, changing nothing, when the name is taken by another function or a
-- helper it needs is missing. One transaction, lock_timeout 10 s; safe twice. Tested by tests/run_migration219.py
-- (pg_stand). Runs after 36b, 184 and 200.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 0. the name guard
do $names$
declare bad text[] := '{}'; h text;
begin
  -- (by the function's name, whatever its arguments: any tally_post_copy_resend that is not this migration's stops it)
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'tally_post_copy_resend'
               and coalesce(obj_description(p.oid, 'pg_proc'), '') <> 'tally post copy resend (migration 219)') then
    bad := bad || 'a function named tally_post_copy_resend exists that is not 219''s'::text;
  end if;
  foreach h in array array['public.my_firm()', 'public.can_write()', 'public.tally_fincom_id(jsonb)', 'public.tally_post_id_match(text, text, text)',
                           'public.tally_post_release_core(uuid, uuid, uuid, text, text)', 'public.tally_post_job_blocked(uuid)',
                           'public.tally_post_job_accepted(uuid, jsonb, jsonb)', 'public.tally_nm(text)'] loop
    if to_regprocedure(h) is null then bad := bad || ('function ' || h || ' is missing'); end if;
  end loop;
  foreach h in array array['public.tally_post_jobs', 'public.tally_post_ids', 'public.tally_vouchers', 'public.tally_companies'] loop
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
declare f uuid := my_firm(); j tally_post_jobs%rowtype; v jsonb; eid text; fid text; bk uuid; n_all int; n_live int; n_del int; n_opt int;
  r record; st text; why text; rel jsonb; held text;
begin
  if f is null or not can_write() then
    raise exception 'only a member of the firm who may post (an owner or staff) can post this again' using errcode = '42501'; end if;
  select * into j from tally_post_jobs where id = p_job and firm_id = f for update;
  if not found then raise exception 'this posting is not in your firm (or not found)'; end if;
  if j.status not in ('done', 'failed') or coalesce(j.checking, false) or j.stop_reason is not null then
    return jsonb_build_object('ok', false, 'state', 'busy', 'job', p_job, 'error', 'That posting is still being sent or settled; nothing was changed.');
  end if;
  select x into v from jsonb_array_elements(coalesce(j.payload->'vouchers', '[]'::jsonb)) x where tally_post_id_match(tally_fincom_id(x), x->>'id', p_id) limit 1;
  if v is null then raise exception 'the entry % is not in this posting', p_id; end if;
  eid := v->>'id'; fid := tally_fincom_id(v);
  if exists (select 1 from tally_post_ids o where o.firm_id = f and o.fincom_id = fid and o.live and o.job_id <> p_job) then
    return jsonb_build_object('ok', false, 'state', 'elsewhere', 'job', p_job, 'id', eid, 'error', 'Another posting holds this entry; it is not sent twice. Nothing was changed.');
  end if;
  held := tally_post_job_blocked(p_job);
  if held is not null then
    return jsonb_build_object('ok', false, 'state', 'blocked', 'job', p_job, 'id', eid, 'error', left('Posting into Tally is not allowed for this posting now: ' || held, 500));
  end if;
  -- FinCom's copy of the posting's company (the client's book of that company name)
  select t.book_id into bk from tally_companies t where t.firm_id = f and t.client_id = j.client_id and lower(tally_nm(t.company)) = lower(tally_nm(j.company)) limit 1;
  if bk is null then
    return jsonb_build_object('ok', false, 'state', 'none', 'job', p_job, 'id', eid, 'error', 'FinCom keeps no copy of this company''s Tally books, so it cannot tell. Nothing was sent.');
  end if;
  select count(*), count(*) filter (where vv.deleted_at is null and not coalesce(vv.cancelled, false) and not coalesce(vv.optional, false)),
         count(*) filter (where vv.deleted_at is not null), count(*) filter (where vv.deleted_at is null and coalesce(vv.optional, false) and not coalesce(vv.cancelled, false))
    into n_all, n_live, n_del, n_opt
    from tally_vouchers vv where vv.book_id = bk and vv.fincom_id = fid;
  if n_all = 0 then
    return jsonb_build_object('ok', false, 'state', 'none', 'job', p_job, 'id', eid, 'error', 'FinCom''s copy of Tally has no entry carrying this FinCom id, so it cannot tell whether it is in Tally. Nothing was sent.');
  end if;
  if n_live > 0 then
    select vv.vtype, vv.vno, vv.day into r from tally_vouchers vv
     where vv.book_id = bk and vv.fincom_id = fid and vv.deleted_at is null and not coalesce(vv.cancelled, false) and not coalesce(vv.optional, false) order by vv.day desc limit 1;
    return jsonb_build_object('ok', false, 'state', 'there', 'job', p_job, 'id', eid, 'vtype', r.vtype, 'vno', r.vno, 'day', r.day,
      'error', 'FinCom''s copy of Tally has it as a regular entry; nothing was sent.');
  end if;
  st := case when n_del > 0 then 'deleted' when n_opt > 0 then 'optional' else 'cancelled' end;
  why := 'FinCom''s copy of Tally shows it ' || case st when 'deleted' then 'deleted in Tally' when 'optional' then 'only as an Optional voucher' else 'only as a cancelled voucher' end
         || ' (' || to_char(now() at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST): posted again';
  rel := tally_post_release_core(f, auth.uid(), p_job, p_id, why);
  -- 36b's guard: an entry Tally accepted that nobody settled keeps the posting from the bridge (the release stays; the
  -- entry may then be posted again by a person once that is settled)
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
