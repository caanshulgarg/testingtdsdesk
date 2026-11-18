-- migration-199-post-match-fast.sql (18-Nov-2026, branch next-fix-posttimeout)
--
-- A big posting's report could not be stored. When the bridge's report changes a posting's status, the sync trigger
-- (tally_post_ids_sync, 40) and tally_post_job_accepted (43) compare each id of the posting with each id of its results
-- and items through tally_post_id_match, which spells both sides in letters and digits (regexp_replace) on every pair:
-- for a posting of 660 entries about a million regexps, past the 8 s statement timeout. The update was cancelled, the
-- posting stayed as it was, and the bridge reported again every few seconds until it stopped.
--
-- The same rule, worked out once per id: each side is spelt in letters and digits once, and the ids are matched by
-- equality (hashed), never pair by pair. tally_post_id_match(f, e, x) is true when x is not empty and x is f or e, or
-- x in letters and digits (not empty) is f or e in letters and digits; that is what is matched here.
--
-- The owner's aim (18-Nov-2026): a posting of 20,000 entries never stuck. So every step of the posting path that was
-- quadratic or row by row is made linear, with the same answers: tally_post_job_accepted (43), tally_post_ids_sync (40),
-- tally_post_job_settle (43), tally_post_id_accept (36b) and tally_post_id_accept_reply (43) (found through indexes of the
-- posting's own ids), tally_post_register_judged (174: lookups by key instead of joins the planner made row by row,
-- materialized steps, voucher fields read without a regular expression where the pattern's tag is plain),
-- tally_post_register_apply_row and tally_post_register_queued (111: one pass instead of a put per entry). In
-- tally_post_job_accepted and the sync, tally_post_result_accepted / _taken / tally_post_accept_text / tally_post_bool are
-- written out word for word (each has its own search_path since 44, so it is never inlined: called per entry, seconds at
-- 20,000). New (service_role): tally_post_id_accept_many (a report's acceptances in one call, by the posting's ids read once)
-- and tally_post_id_stamp_fids (its stamp by primary key). Three indexes of tally_post_ids. tally_post_id_match stays for
-- its other callers.
--
-- Add-only, one transaction, lock_timeout 10 s, safe twice; service_role only, granted explicitly (tally_post_job_settle:
-- any role, as on staging). Tested by tests/run_migration199.py (300 made-up postings: the old answers, register rows,
-- history and stamps; 20,000 entries timed).
begin;
set local lock_timeout = '10s';

-- 43's tally_post_job_accepted: the same answer; the ids matched by their spellings worked out once
create or replace function public.tally_post_job_accepted(p_job uuid, p_results jsonb, p_items jsonb) returns text
language sql stable security definer set search_path = public, pg_temp as $function$
  with ids as (select fincom_id, entry_id, accepted_at, released_at,
                      regexp_replace(coalesce(fincom_id, ''), '[^A-Za-z0-9]', '', 'g') fan, regexp_replace(coalesce(entry_id, ''), '[^A-Za-z0-9]', '', 'g') ean
                 from tally_post_ids where job_id = p_job),
  -- 199: tally_post_result_accepted, tally_post_result_taken, tally_post_accept_text and tally_post_bool (36b/40/43/44) written
  -- out, word for word: each is a function with its own search_path (44), so never inlined, and called per entry it cost some
  -- 0.05 ms (20,000 entries: seconds of the 8)
  res as (select r->>'id' id, (not (lower(coalesce(r->>'postOnly', '')) in ('true', 't', '1')) and ((lower(coalesce(r->>'accepted', '')) in ('true', 't', '1')) or (lower(coalesce(r->>'held', '')) in ('true', 't', '1')) or (coalesce(r->>'created', '') ~ '^\d+$' and (r->>'created')::int > 0) or (coalesce(r->>'altered', '') ~ '^\d+$' and (r->>'altered')::int > 0) or coalesce(r->>'lastVchId', '') <> '' or coalesce(r->>'vchNumber', '') <> '' or coalesce(r->>'masterId', '') <> '' or coalesce(r->>'guid', '') <> '' or ((coalesce(r->>'message', '') ~* '\m(CREATED|ALTERED)\M' and (coalesce(r->>'message', '') ~* '\m(LASTVCHID|VCHID|MASTERID|voucher( no\.?| number| id)?)\D{0,6}[1-9]\d*' or coalesce(r->>'message', '') ~* '\m(CREATED|ALTERED)\M\D{0,4}[1-9]\d*')) or coalesce(r->>'message', '') ~* 'replied ''(created|altered)''') or ((coalesce(r->>'reason', '') ~* '\m(CREATED|ALTERED)\M' and (coalesce(r->>'reason', '') ~* '\m(LASTVCHID|VCHID|MASTERID|voucher( no\.?| number| id)?)\D{0,6}[1-9]\d*' or coalesce(r->>'reason', '') ~* '\m(CREATED|ALTERED)\M\D{0,4}[1-9]\d*')) or coalesce(r->>'reason', '') ~* 'replied ''(created|altered)'''))) acc, (((lower(coalesce(r->>'verified', '')) in ('true', 't', '1')) or coalesce(r->>'state', '') in ('in_tally', 'sent') or ((lower(coalesce(r->>'byReply', '')) in ('true', 't', '1')) and (lower(coalesce(r->>'ok', '')) in ('true', 't', '1'))) or ((lower(coalesce(r->>'needsReview', '')) in ('true', 't', '1')) and (lower(coalesce(r->>'accepted', '')) in ('true', 't', '1')))) and not (lower(coalesce(r->>'needsReview', '')) in ('true', 't', '1'))) conf from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where r->>'id' is not null),
  its as (select i->>'id' id, (not (lower(coalesce(i->>'postOnly', '')) in ('true', 't', '1')) and ((lower(coalesce(i->>'accepted', '')) in ('true', 't', '1')) or (lower(coalesce(i->>'held', '')) in ('true', 't', '1')) or ((coalesce(i->>'reason', '') ~* '\m(CREATED|ALTERED)\M' and (coalesce(i->>'reason', '') ~* '\m(LASTVCHID|VCHID|MASTERID|voucher( no\.?| number| id)?)\D{0,6}[1-9]\d*' or coalesce(i->>'reason', '') ~* '\m(CREATED|ALTERED)\M\D{0,4}[1-9]\d*')) or coalesce(i->>'reason', '') ~* 'replied ''(created|altered)'''))) acc, ((lower(coalesce(i->>'verified', '')) in ('true', 't', '1')) or coalesce(i->>'state', '') in ('in_tally', 'sent') or ((lower(coalesce(i->>'byReply', '')) in ('true', 't', '1')) and (lower(coalesce(i->>'ok', '')) in ('true', 't', '1'))) or ((lower(coalesce(i->>'needsReview', '')) in ('true', 't', '1')) and (lower(coalesce(i->>'accepted', '')) in ('true', 't', '1')))) conf from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where i->>'id' is not null),
  conf as (select id from res where conf union select id from its where conf),
  -- the confirmed ids as tally_post_id_match reads them: not empty, and in letters and digits (an empty spelling matches nothing)
  ck as (select id, nullif(regexp_replace(id, '[^A-Za-z0-9]', '', 'g'), '') an from conf where id <> ''),
  sig as (select id from res where acc union select id from its where acc),
  rel as (select fincom_id, entry_id, fan, ean from ids where released_at is not null),
  hits as (select coalesce(entry_id, fincom_id) id from ids i where accepted_at is not null and released_at is null
             and not (coalesce(i.fincom_id in (select id from ck), false) or coalesce(i.entry_id in (select id from ck), false)
                   or coalesce(i.fan in (select an from ck where an is not null), false) or coalesce(i.ean in (select an from ck where an is not null), false))
           union select s.id from sig s where not exists (select 1 from conf c where c.id = s.id)
             and not (s.id <> '' and (coalesce(s.id in (select fincom_id from rel where fincom_id is not null), false) or coalesce(s.id in (select entry_id from rel where entry_id is not null), false)
                   or coalesce(nullif(regexp_replace(s.id, '[^A-Za-z0-9]', '', 'g'), '') in (select fan from rel), false) or coalesce(nullif(regexp_replace(s.id, '[^A-Za-z0-9]', '', 'g'), '') in (select ean from rel), false))))
  select nullif(string_agg(distinct id, ', ' order by id), '') from hits
$function$;
revoke all on function public.tally_post_job_accepted(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.tally_post_job_accepted(uuid, jsonb, jsonb) to service_role;

-- 40's tally_post_ids_sync: the same rule; an id kept live by the posting's words is matched by its spellings worked out once
create or replace function public.tally_post_ids_sync() returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare acc text[]; acc_an text[];
begin
  if tg_op = 'INSERT' then
    insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live)
    select distinct on (tally_fincom_id(v)) new.firm_id, new.client_id, tally_fincom_id(v), new.id, v->>'id', new.status not in ('failed', 'cancelled')
      from jsonb_array_elements(coalesce(new.payload->'vouchers', '[]'::jsonb)) v where tally_fincom_id(v) is not null;
  elsif new.status is distinct from old.status then
    -- failed or cancelled: the ids may be queued again; waiting again (Retry): live again, unless another posting has them.
    -- An id Tally accepted is never freed here: stamped (accepted_at, 36b), said by the posting's own results / items as
    -- accepted and not confirmed (tally_post_job_accepted, 38), or confirmed / ok in a result or item (39); a released id
    -- is never revived
    select coalesce(array_agg(distinct id), '{}') into acc from (
      select unnest(string_to_array(coalesce(tally_post_job_accepted(new.id, new.results, new.items), ''), ', ')) id
      -- (199: tally_post_result_taken and tally_post_bool written out, word for word, as in tally_post_job_accepted above)
      union select x->>'id' from jsonb_array_elements(coalesce(new.results, '[]'::jsonb)) x where x->>'id' is not null and (((lower(coalesce(x->>'verified', '')) in ('true', 't', '1')) or coalesce(x->>'state', '') in ('in_tally', 'sent') or ((lower(coalesce(x->>'byReply', '')) in ('true', 't', '1')) and (lower(coalesce(x->>'ok', '')) in ('true', 't', '1'))) or ((lower(coalesce(x->>'needsReview', '')) in ('true', 't', '1')) and (lower(coalesce(x->>'accepted', '')) in ('true', 't', '1')))) or (lower(coalesce(x->>'ok', '')) in ('true', 't', '1')))
      union select x->>'id' from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x where x->>'id' is not null and ((lower(coalesce(x->>'verified', '')) in ('true', 't', '1')) or coalesce(x->>'state', '') in ('in_tally', 'sent') or ((lower(coalesce(x->>'byReply', '')) in ('true', 't', '1')) and (lower(coalesce(x->>'ok', '')) in ('true', 't', '1'))) or ((lower(coalesce(x->>'needsReview', '')) in ('true', 't', '1')) and (lower(coalesce(x->>'accepted', '')) in ('true', 't', '1'))))) s where id <> '';
    -- the same ids in letters and digits, each worked out once (an empty spelling matches nothing, as in tally_post_id_match)
    select coalesce(array_agg(distinct an), '{}') into acc_an from (select regexp_replace(a, '[^A-Za-z0-9]', '', 'g') an from unnest(acc) a) s where an <> '';
    update tally_post_ids i set live = (i.accepted_at is not null and i.released_at is null)
        or (new.status not in ('failed', 'cancelled') and i.released_at is null)
        or (i.released_at is null and coalesce(i.fincom_id = any(acc) or i.entry_id = any(acc)
              or regexp_replace(coalesce(i.fincom_id, ''), '[^A-Za-z0-9]', '', 'g') = any(acc_an) or regexp_replace(coalesce(i.entry_id, ''), '[^A-Za-z0-9]', '', 'g') = any(acc_an), false))
     where i.job_id = new.id;
  end if;
  return new;
exception when unique_violation then
  raise exception 'This bill is already being posted to Tally in another posting (its FinCom id is taken); wait for that posting to finish.' using errcode = '23505';
end $function$;
revoke all on function public.tally_post_ids_sync() from public, anon, authenticated;
grant execute on function public.tally_post_ids_sync() to service_role;

-- 43's tally_post_job_settle (what an owner's Mark posted / Not in Tally and the register's mark run, through
-- tally_post_mark_core / tally_post_release_core): the same answer. Each voucher's ids and each result's and item's id are
-- spelt once, as keys ('x' the id as it is, 'a' in letters and digits, never empty), and joined by equality; an item's
-- state is the first matching item's, in the items' order, as before
create or replace function public.tally_post_job_settle(p_status text, p_checking boolean, p_payload jsonb, p_results jsonb, p_items jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $function$
declare total int; posted int; pending int; unknown int; review int; st text := p_status; chk boolean := coalesce(p_checking, false);
begin
  with v as (select o vid, tally_fincom_id(x) fk, x->>'id' ek from jsonb_array_elements(coalesce(p_payload->'vouchers', '[]'::jsonb)) with ordinality t(x, o) where tally_fincom_id(x) is not null),
  vk as (select vid, 'x' k, fk key from v union all select vid, 'x', ek from v where ek is not null
         union all select vid, 'a', regexp_replace(fk, '[^A-Za-z0-9]', '', 'g') from v union all select vid, 'a', regexp_replace(coalesce(ek, ''), '[^A-Za-z0-9]', '', 'g') from v),
  r as (select x->>'id' id, tally_post_bool(x->>'ok') ok, tally_post_bool(x->>'needsReview') nr from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) x where coalesce(x->>'id', '') <> ''),
  rk as (select 'x' k, id key, ok, nr from r union all select 'a', an, ok, nr from (select regexp_replace(id, '[^A-Za-z0-9]', '', 'g') an, ok, nr from r) s where an <> ''),
  i as (select o, x->>'id' id, x->>'state' state from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality t(x, o) where coalesce(x->>'id', '') <> ''),
  ik as (select 'x' k, id key, o, state from i union all select 'a', an, o, state from (select regexp_replace(id, '[^A-Za-z0-9]', '', 'g') an, o, state from i) s where an <> ''),
  rm as (select vk.vid, bool_or(rk.ok) ok, bool_or(rk.nr) nr from vk join rk on rk.k = vk.k and rk.key = vk.key group by vk.vid),
  im as (select vk.vid, bool_or(ik.state = 'in_tally') in_tally, min(ik.o) first_o from vk join ik on ik.k = vk.k and ik.key = vk.key group by vk.vid),
  e as (select coalesce(rm.ok, false) or coalesce(im.in_tally, false) is_posted, coalesce(rm.nr, false) needs_review, i.state, rm.vid is not null has_result
          from v left join rm on rm.vid = v.vid left join im on im.vid = v.vid left join i on i.o = im.first_o)
  select count(*), count(*) filter (where is_posted),
         count(*) filter (where not is_posted and (state in ('waiting', 'sending', 'sent') or (state is null and not has_result))),
         count(*) filter (where not is_posted and state = 'unknown' and not needs_review),
         count(*) filter (where not is_posted and needs_review)
    into total, posted, pending, unknown, review from e;
  if posted >= total then st := 'done'; chk := false;
  elsif p_status in ('running', 'taken') or coalesce(p_checking, false) then
    if pending > 0 then null;
    elsif unknown > 0 then st := 'done'; chk := true;
    elsif review > 0 then st := 'done'; chk := false;
    else st := 'failed'; chk := false; end if;
  end if;
  return jsonb_build_object('status', st, 'checking', chk, 'posted', posted, 'total', total, 'review', review,
    'message', format('Posted %s of %s', posted, total) || case when review > 0 then format('; %s need review', review) else '' end);
end $function$;
-- as on staging: a pure calculation over its arguments, for any role (it reads no table)
grant execute on function public.tally_post_job_settle(text, boolean, jsonb, jsonb, jsonb) to public, service_role;

-- ---------------------------------------------------------------- the acceptances stamped, one entry at a time or many
-- an id of a posting found by its spellings through an index of the posting's own ids (each stamp, release and mark looked
-- at every id of the posting, spelling each: a posting of 20,000 entries stamped one by one was 20,000 x 20,000)
create index if not exists tally_post_ids_job_entry on public.tally_post_ids (job_id, entry_id);
create index if not exists tally_post_ids_job_fid_an on public.tally_post_ids (job_id, (regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g')));
create index if not exists tally_post_ids_job_entry_an on public.tally_post_ids (job_id, (regexp_replace(coalesce(entry_id, ''), '[^A-Za-z0-9]', '', 'g')));

-- 36b's tally_post_id_accept: the same; the entry found by tally_post_id_match's rule written out, so the indexes serve it
-- (p_id has letters or digits here: the function answers 'no id' first otherwise)
create or replace function public.tally_post_id_accept(p_job uuid, p_id text, p_vch text, p_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare n int; vch text := nullif(left(btrim(coalesce(p_vch, '')), 60), ''); retaken timestamptz; k text := regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g');
begin
  if auth.role() <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  if regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g') = '' then return jsonb_build_object('ok', false, 'error', 'no id'); end if;
  select taken_at into retaken from tally_post_jobs where id = p_job;
  begin
    update tally_post_ids set accepted_at = coalesce(accepted_at, now()), accepted_vch = coalesce(vch, accepted_vch),
           live = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then live else true end,
           released_at = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_at end,
           released_by = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_by end,
           released_why = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_why end
     where job_id = p_job and (fincom_id = p_id or entry_id = p_id or regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') = k
            or regexp_replace(coalesce(entry_id, ''), '[^A-Za-z0-9]', '', 'g') = k);
    get diagnostics n = row_count;
  exception when unique_violation then
    -- another posting holds the id live: stamped all the same, so that it is never freed here either
    update tally_post_ids set accepted_at = coalesce(accepted_at, now()), accepted_vch = coalesce(vch, accepted_vch),
           released_at = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_at end,
           released_by = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_by end,
           released_why = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_why end
     where job_id = p_job and (fincom_id = p_id or entry_id = p_id or regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') = k
            or regexp_replace(coalesce(entry_id, ''), '[^A-Za-z0-9]', '', 'g') = k);
    get diagnostics n = row_count;
  end;
  return jsonb_build_object('ok', true, 'stamped', n);
end $function$;
revoke all on function public.tally_post_id_accept(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_post_id_accept(uuid, text, text, timestamptz) to service_role;

-- 43's tally_post_id_accept_reply: the same, found so too
create or replace function public.tally_post_id_accept_reply(p_job uuid, p_id text, p_vch text, p_batch_end text, p_batch_n integer)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare one boolean := p_batch_n = 1; v text := nullif(left(btrim(coalesce(p_vch, '')), 60), ''); acc jsonb; n int; k text := regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g');
begin
  if auth.role() <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  if regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9]', '', 'g') = '' then return jsonb_build_object('ok', false, 'error', 'no id'); end if;
  acc := tally_post_id_accept(p_job, p_id, case when one then v end);
  update tally_post_ids set reply_vch = case when one then coalesce(v, reply_vch) else reply_vch end,
         batch_end = nullif(left(btrim(coalesce(p_batch_end, '')), 60), ''), batch_n = p_batch_n
   where job_id = p_job and (fincom_id = p_id or entry_id = p_id or regexp_replace(fincom_id, '[^A-Za-z0-9]', '', 'g') = k
            or regexp_replace(coalesce(entry_id, ''), '[^A-Za-z0-9]', '', 'g') = k);
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'stamped', n, 'batchN', p_batch_n, 'accept', acc);
end $function$;
revoke all on function public.tally_post_id_accept_reply(uuid, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.tally_post_id_accept_reply(uuid, text, text, text, integer) to service_role;

-- new (service_role, internal): tally_post_id_accept's stamp for the ids of a posting found already (by
-- tally_post_id_accept_many's maps), by the posting's primary key: the same columns, the same rule, the same fallback
create or replace function public.tally_post_id_stamp_fids(p_job uuid, p_fids text[], p_vch text, p_retaken timestamptz)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare n int; vch text := nullif(left(btrim(coalesce(p_vch, '')), 60), ''); retaken timestamptz := p_retaken;
begin
  if auth.role() <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  begin
    update tally_post_ids set accepted_at = coalesce(accepted_at, now()), accepted_vch = coalesce(vch, accepted_vch),
           live = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then live else true end,
           released_at = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_at end,
           released_by = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_by end,
           released_why = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_why end
     where job_id = p_job and fincom_id = any(p_fids);
    get diagnostics n = row_count;
  exception when unique_violation then
    -- another posting holds the id live: stamped all the same, so that it is never freed here either
    update tally_post_ids set accepted_at = coalesce(accepted_at, now()), accepted_vch = coalesce(vch, accepted_vch),
           released_at = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_at end,
           released_by = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_by end,
           released_why = case when released_by = 'owner' and (accepted_at is null or released_at >= accepted_at) and (retaken is null or retaken <= released_at) then released_why end
     where job_id = p_job and fincom_id = any(p_fids);
    get diagnostics n = row_count;
  end;
  return n;
end $function$;
revoke all on function public.tally_post_id_stamp_fids(uuid, text[], text, timestamptz) from public, anon, authenticated;
grant execute on function public.tally_post_id_stamp_fids(uuid, text[], text, timestamptz) to service_role;

-- new (service_role): a report's acceptances stamped in one call, each exactly as tally_post_id_accept_reply (an entry posted
-- by Tally's reply: reply true) or tally_post_id_accept stamps it, in the order given. p_list: [{id, vch, reply, vchId,
-- batchEnd, batchN}]. The answer: {ok, n (entries), stamped (ids), zero: [the ids that stamped none of the posting's ids]}.
-- The posting's ids are read once into two maps (the id as it is; in letters and digits) and each entry's ids stamped by the
-- primary key: one entry at a time through tally_post_id_match's rule made a plan that read every id of the posting for each
-- entry when the table's statistics expect a few ids a posting (20,000 x 1,000 a report: past the 8 s)
create or replace function public.tally_post_id_accept_many(p_job uuid, p_list jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare x jsonb; n int := 0; s int := 0; zero jsonb := '[]'::jsonb; me jsonb; ma jsonb; retaken timestamptz; id_ text; k text; fids text[]; c int;
        one boolean; v text; bn integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role only' using errcode = '42501'; end if;
  if jsonb_typeof(p_list) is distinct from 'array' then return jsonb_build_object('ok', false, 'error', 'a list of entries'); end if;
  select taken_at into retaken from tally_post_jobs where id = p_job;
  select coalesce(jsonb_object_agg(z.key, z.f), '{}'::jsonb) into me from (
    select t.key, jsonb_agg(distinct t.fincom_id) f from (select i.fincom_id, i.fincom_id key from tally_post_ids i where i.job_id = p_job
                                                           union all select i.fincom_id, i.entry_id from tally_post_ids i where i.job_id = p_job and i.entry_id is not null) t
     group by t.key) z;
  select coalesce(jsonb_object_agg(z.key, z.f), '{}'::jsonb) into ma from (
    select t.key, jsonb_agg(distinct t.fincom_id) f from (select i.fincom_id, regexp_replace(i.fincom_id, '[^A-Za-z0-9]', '', 'g') key from tally_post_ids i where i.job_id = p_job
                                                           union all select i.fincom_id, regexp_replace(coalesce(i.entry_id, ''), '[^A-Za-z0-9]', '', 'g') from tally_post_ids i where i.job_id = p_job) t
     where t.key <> '' group by t.key) z;
  for x in select e from jsonb_array_elements(p_list) e where jsonb_typeof(e) = 'object' loop
    n := n + 1; id_ := x->>'id'; k := regexp_replace(coalesce(id_, ''), '[^A-Za-z0-9]', '', 'g');
    continue when k = '';     -- 'no id' (not ok): counted, never in zero, as tally_post_id_accept answers
    select coalesce(array_agg(distinct f), '{}') into fids from (select jsonb_array_elements_text(coalesce(me -> id_, '[]'::jsonb) || coalesce(ma -> k, '[]'::jsonb)) f) z;
    if tally_post_bool(x->>'reply') then
      -- tally_post_id_accept_reply: the stamp (the exact voucher id when the request held it alone), then the reply's columns
      bn := case when x->>'batchN' ~ '^\d{1,6}$' then (x->>'batchN')::int end; one := bn = 1; v := nullif(left(btrim(coalesce(x->>'vchId', '')), 60), '');
      c := tally_post_id_stamp_fids(p_job, fids, case when one then v end, retaken);
      update tally_post_ids set reply_vch = case when one then coalesce(v, reply_vch) else reply_vch end,
             batch_end = nullif(left(btrim(coalesce(x->>'batchEnd', '')), 60), ''), batch_n = bn
       where job_id = p_job and fincom_id = any(fids);
    else
      c := tally_post_id_stamp_fids(p_job, fids, x->>'vch', retaken);
    end if;
    s := s + coalesce(c, 0);
    if coalesce(c, 0) = 0 then zero := zero || to_jsonb(id_); end if;
  end loop;
  return jsonb_build_object('ok', true, 'n', n, 'stamped', s, 'zero', zero);
end $function$;
revoke all on function public.tally_post_id_accept_many(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.tally_post_id_accept_many(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------- the posting register's judge
-- 174's tally_post_register_judged: the same rows; a voucher's result, item and mark found once per spelling (above)
create or replace function public.tally_post_register_judged(j public.tally_post_jobs)
returns table (fincom_id text, entry_id text, ord integer, state text, source text, master_id text, id_inferred boolean, words text,
               by_user uuid, at timestamptz, vch_type text, vch_no text, vch_date date, amount numeric)
language sql stable security definer set search_path = public, pg_temp as $judge$
with vs as (
  select tally_fincom_id(t.v) as fid, t.v->>'id' as eid, coalesce(t.v->>'xml', '') as xml, t.o::int as ord
    from jsonb_array_elements(case when jsonb_typeof((j).payload->'vouchers') = 'array' then (j).payload->'vouchers' else '[]'::jsonb end) with ordinality as t(v, o)
   where jsonb_typeof(t.v) = 'object' and tally_fincom_id(t.v) is not null),
v1 as (
  select distinct on (vs.fid) vs.fid, vs.eid, vs.xml, vs.ord, regexp_replace(vs.fid, '[^A-Za-z0-9]', '', 'g') as kf, regexp_replace(coalesce(vs.eid, ''), '[^A-Za-z0-9]', '', 'g') as ke
    from vs order by vs.fid, vs.ord),
rs as (
  select t.r, t.o::int as ord, regexp_replace(t.r->>'id', '[^A-Za-z0-9]', '', 'g') as k,
         (row_number() over (partition by t.r->>'sentAt', t.r->>'batchEnd', t.r->>'batchN' order by t.o))::int - 1 as pos,
         (count(*) over (partition by t.r->>'sentAt', t.r->>'batchEnd', t.r->>'batchN'))::int as gn
    from jsonb_array_elements(case when jsonb_typeof((j).results) = 'array' then (j).results else '[]'::jsonb end) with ordinality as t(r, o)
   where jsonb_typeof(t.r) = 'object' and coalesce(t.r->>'id', '') <> '' and coalesce(t.r->>'kind', '') <> 'master'),
its as (
  select t.i, regexp_replace(t.i->>'id', '[^A-Za-z0-9]', '', 'g') as k, t.o::int as ord
    from jsonb_array_elements(case when jsonb_typeof((j).items) = 'array' then (j).items else '[]'::jsonb end) with ordinality as t(i, o)
   where jsonb_typeof(t.i) = 'object' and coalesce(t.i->>'id', '') <> ''),
-- 199: per spelling, the last result, the first item and the last mark, each found once; a voucher takes the later
-- result (the earlier item, the later mark) of its two spellings, by equality, as the pair-by-pair scan chose them
rl as (select distinct on (rs.k) rs.k, rs.r, rs.pos, rs.gn, rs.ord from rs where rs.k <> '' order by rs.k, rs.ord desc),
il as (select distinct on (its.k) its.k, its.i, its.ord from its where its.k <> '' order by its.k, its.ord),
ml as (select distinct on (k) regexp_replace(m.entry_id, '[^A-Za-z0-9]', '', 'g') as k, m.action, m.vch, m.note, m.by_user, m.at, m.id
         from tally_post_marks m where m.job_id = (j).id order by k, m.at desc, m.id desc),
-- each kept as one object keyed by spelling and looked up by key (a join of these to the vouchers was planned row by row:
-- the planner takes jsonb_array_elements for 100 rows); b to e materialized: inlined, each later use of a column recomputed
-- its whole expression (20,000 entries took some 100 s)
rm as materialized (select coalesce(jsonb_object_agg(rl.k, jsonb_build_object('r', rl.r, 'pos', rl.pos, 'gn', rl.gn, 'ord', rl.ord)), '{}'::jsonb) as m from rl),
im as materialized (select coalesce(jsonb_object_agg(il.k, jsonb_build_object('i', il.i, 'ord', il.ord)), '{}'::jsonb) as m from il),
mm as materialized (select coalesce(jsonb_object_agg(ml.k, jsonb_build_object('action', ml.action, 'vch', ml.vch, 'note', ml.note, 'by_user', ml.by_user, 'at', ml.at, 'id', ml.id)), '{}'::jsonb) as m from ml),
b as materialized (
  select v1.fid, v1.eid, v1.ord, v1.xml, r.r, r.pos, r.gn, it.i,
         mk.action as mk_action, mk.vch as mk_vch, mk.note as mk_note, mk.by_user as mk_by, mk.at as mk_at,
         pid.accepted_at, pid.released_at, pid.released_by, pid.matched_at, pid.matched_mid, pid.live as pid_live,
         ((j).status in ('waiting', 'taken', 'running') and (jsonb_typeof((j).resend_only) is distinct from 'array' or jsonb_array_length((j).resend_only) = 0
            or (j).resend_only ? coalesce(v1.eid, '') or (j).resend_only ? v1.fid)) as in_scope
    from v1
    -- (each map an uncorrelated subquery: worked out once; a join to it copied the whole map for every voucher)
    cross join lateral (select (select rm.m from rm) -> v1.kf as ra, (select rm.m from rm) -> v1.ke as rb, (select im.m from im) -> v1.kf as ia,
                               (select im.m from im) -> v1.ke as ib, (select mm.m from mm) -> v1.kf as ma, (select mm.m from mm) -> v1.ke as mb) z
    cross join lateral (select case when z.rb is not null and (z.ra is null or (z.rb->>'ord')::int > (z.ra->>'ord')::int) then z.rb else z.ra end as x) rx
    cross join lateral (select rx.x->'r' as r, (rx.x->>'pos')::int as pos, (rx.x->>'gn')::int as gn) r
    cross join lateral (select case when z.ib is not null and (z.ia is null or (z.ib->>'ord')::int < (z.ia->>'ord')::int) then z.ib else z.ia end -> 'i' as i) it
    left join lateral (select x.action, x.vch, x.note, x.by_user, x.at from (values (z.ma->>'action', z.ma->>'vch', z.ma->>'note', (z.ma->>'by_user')::uuid, (z.ma->>'at')::timestamptz, (z.ma->>'id')::bigint),
                                                                                (z.mb->>'action', z.mb->>'vch', z.mb->>'note', (z.mb->>'by_user')::uuid, (z.mb->>'at')::timestamptz, (z.mb->>'id')::bigint))
                                 as x(action, vch, note, by_user, at, id) where x.id is not null order by x.at desc, x.id desc limit 1) mk on true
    left join lateral (select p.accepted_at, p.released_at, p.released_by, p.matched_at, p.matched_mid, p.live from tally_post_ids p
                        where p.job_id = (j).id and p.fincom_id = v1.fid limit 1) pid on true),
c as materialized (
  select b.*,
         (b.r is not null and lower(coalesce(b.r->>'byOwner', '')) in ('true', 't', '1')) or (b.i is not null and lower(coalesce(b.i->>'byOwner', '')) in ('true', 't', '1')) as own,
         case when b.r->>'batchN' ~ '^\d{1,6}$' then (b.r->>'batchN')::int else 0 end as n,
         case when b.r->>'created' ~ '^\d{1,9}$' then (b.r->>'created')::int else 0 end as created,
         case when b.r->>'altered' ~ '^\d{1,9}$' then (b.r->>'altered')::int else 0 end as altered,
         case when b.r->>'errors' ~ '^\d{1,9}$' then (b.r->>'errors')::int else 0 end as errs,
         case when b.r->>'exceptions' ~ '^\d{1,9}$' then (b.r->>'exceptions')::int else 0 end as excs,
         case when jsonb_typeof(b.r->'lineError') = 'array' then (select nullif(string_agg(x.t, '; '), '') from jsonb_array_elements_text(b.r->'lineError') as x(t) where x.t <> '')
              else nullif(b.r->>'lineError', '') end as le,
         coalesce(nullif(b.r->>'batchEnd', ''), nullif(b.r->>'lastVchId', '')) as lv,
         (tally_post_bool(b.r->>'byReply') or tally_post_bool(b.r->>'needsReview')) as has_reply
    from b),
d as materialized (
  select c.*,
         (c.has_reply and c.errs = 0 and c.excs = 0 and c.le is null and c.altered = 0 and c.n >= 1 and c.created = c.n) as clean,
         case when c.r is null then null
              when tally_post_bool(c.r->>'alreadySent') then 'needs_review'                                    -- the bridge's own record: sent before
              when tally_post_bool(c.r->>'refused') and tally_post_bool(c.r->>'postOnly') then 'refused'       -- refused by the bridge, nothing sent
              when c.has_reply and c.errs = 0 and c.excs = 0 and c.le is null and c.altered = 0 and c.n = 1 and c.created = 1 and coalesce(c.lv, '') ~ '^\d+$' then 'in_tally'
              when c.has_reply and c.errs = 0 and c.excs = 0 and c.le is null and c.altered = 0 and c.n > 1 and c.created = c.n then 'in_tally'
              when c.has_reply and c.created = 0 and c.altered = 0 and (c.errs + c.excs > 0 or c.le is not null) then 'refused'
              when c.has_reply then 'needs_review'                                                             -- the proof's rule: never in_tally
              when tally_post_bool(c.r->>'outcomeUnknown') or c.r->>'state' in ('unknown', 'sent') or tally_post_bool(c.r->>'sent') then
                   case when tally_post_bool(c.r->>'ok') and tally_post_bool(c.r->>'verified') then 'in_tally' else 'needs_review' end
              when tally_post_bool(c.r->>'ok') and (tally_post_bool(c.r->>'verified') or c.r->>'state' = 'in_tally' or tally_post_bool(c.r->>'already') or tally_post_bool(c.r->>'alreadyThere')) then 'in_tally'
              when tally_post_bool(c.r->>'ok') then 'needs_review'                                             -- an older bridge: posted, not read back
              when tally_post_bool(c.r->>'already') or coalesce(c.r->>'message', '') ~* '^Already in Tally \(voucher no\.' then 'in_tally'
              when tally_post_result_accepted(c.r) then 'needs_review'                                        -- Tally accepted it, unconfirmed
              else 'refused' end as rstate
    from c),
e as materialized (
  select d.*,
         case
           -- a person's word on this posting (Mark posted, Not in Tally): the mark, unless the bridge reported the entry again since
           when d.own or (d.r is null and d.mk_action is not null and not d.in_scope) then
             case when d.mk_action = 'posted' then 'in_tally' when d.mk_action = 'released' then 'released'
                  when coalesce(d.r->>'state', d.i->>'state') = 'in_tally' then 'in_tally' when coalesce(d.r->>'state', d.i->>'state') = 'notfound' then 'released' else 'needs_review' end
           when d.rstate is not null then d.rstate
           when d.i is not null and d.i->>'state' in ('in_tally', 'posted') then 'in_tally'
           when d.i is not null and d.i->>'state' in ('needs_review', 'unknown') then 'needs_review'
           when d.i is not null and d.i->>'state' in ('failed', 'notfound') then case when tally_post_accept_text(d.i->>'reason') then 'needs_review' else 'refused' end
           when (j).status = 'waiting' then 'queued'
           when (j).status in ('taken', 'running') then 'sent'
           -- (174, fifth review H1) cancelled after its bridge had it, the id kept live (tally_post_cancel): it may be in Tally
           when (j).status = 'cancelled' and coalesce(d.pid_live, false) and d.released_at is null then 'needs_review'
           when (j).status = 'cancelled' and (j).taken_at is null then 'released'
           when (j).status in ('failed', 'cancelled') and (j).taken_at is null then 'refused'
           else 'needs_review' end as s0,
         case when d.own or (d.r is null and d.mk_action is not null and not d.in_scope) then 'owner'
              when d.rstate is not null or (d.i is not null and d.i->>'state' in ('in_tally', 'posted', 'needs_review', 'unknown', 'failed', 'notfound')) then 'reply'
              else 'status' end as src0
    from d),
f as (
  select e.*,
         case when e.in_scope and (j).status = 'waiting' and e.s0 not in ('in_tally', 'needs_review') then 'queued'
              when e.in_scope and (j).status in ('taken', 'running') and e.s0 in ('released', 'queued') then 'sent'
              when e.matched_at is not null and e.s0 in ('needs_review', 'refused', 'sent', 'in_tally') and e.src0 <> 'owner' then 'in_tally'
              when e.accepted_at is not null and e.released_at is null and e.s0 = 'refused' and e.src0 <> 'owner' then 'needs_review'
              when e.released_by = 'owner' and e.released_at is not null and e.mk_action is null and e.src0 <> 'owner' and e.s0 <> 'in_tally' and not e.in_scope then 'released'
              else e.s0 end as st
    from e)
-- 199: each voucher field read from its XML at the tag's first place with plain string functions (what the pattern captures
-- there: the text up to the next '<' or '"', of the pattern's length, then its closing tag); anything else by the pattern over
-- the whole XML as before: the same answer (each pattern begins with its tag), without a regular expression for every
-- voucher (20,000 vouchers: some 6 s)
select f.fid, f.eid, f.ord, f.st,
       case when f.in_scope and f.st in ('queued', 'sent') and f.s0 <> f.st then 'status'
            when f.matched_at is not null and f.st = 'in_tally' and f.src0 <> 'owner' then 'recorder'
            when f.src0 = 'owner' and coalesce(f.mk_note, '') like 'Found in % by the FinCom Bridge%' then 'bridge'
            when f.released_by = 'owner' and f.st = 'released' and f.src0 <> 'owner' and f.s0 <> 'released' then 'owner'
            else f.src0 end,
       case when f.st <> 'in_tally' then null
            when f.src0 = 'owner' then coalesce(nullif(btrim(f.mk_vch), ''), nullif(f.r->>'vchNumber', ''))
            when f.matched_at is not null and nullif(f.matched_mid, '') is not null then f.matched_mid
            when f.has_reply and f.n = 1 then coalesce(nullif(f.r->>'vchId', ''), f.lv)
            when f.has_reply and f.n > 1 and f.gn = f.n and coalesce(f.lv, '') ~ '^\d{1,18}$' then (f.lv::bigint - (f.n - 1 - f.pos))::text
            when f.has_reply then null
            else coalesce(nullif(f.r->>'masterId', ''), nullif(f.matched_mid, '')) end,
       (f.st = 'in_tally' and f.src0 = 'reply' and f.has_reply and f.n > 1 and f.matched_at is null),
       case when f.src0 = 'owner' and f.st in ('in_tally', 'released', 'needs_review') then left(coalesce(nullif(f.mk_note, ''), nullif(f.r->>'reason', ''), nullif(f.i->>'reason', '')), 1000)
            when f.st in ('in_tally', 'queued', 'sent') then null
            else left(coalesce(nullif(f.r->>'message', ''), f.le, nullif(f.r->>'reason', ''), nullif(f.i->>'reason', ''),
                               case when f.st = 'released' and f.released_why is not null then f.released_why end, nullif((j).message, '')), 1000) end,
       case when f.src0 = 'owner' then f.mk_by end,
       case when f.src0 = 'owner' then f.mk_at end,
       coalesce(nullif(f.r->>'vchType', ''), nullif(case when strpos(f.xml, '<VOUCHERTYPENAME>') = 0 then null when length(split_part(substr(f.xml, strpos(f.xml, '<VOUCHERTYPENAME>') + 17, 101), '<', 1)) between 1 and 100 and substr(f.xml, strpos(f.xml, '<VOUCHERTYPENAME>') + 17 + length(split_part(substr(f.xml, strpos(f.xml, '<VOUCHERTYPENAME>') + 17, 101), '<', 1)), 18) = '</VOUCHERTYPENAME>' then split_part(substr(f.xml, strpos(f.xml, '<VOUCHERTYPENAME>') + 17, 101), '<', 1) else substring(f.xml from '<VOUCHERTYPENAME>([^<]{1,100})</VOUCHERTYPENAME>') end, ''), nullif(case when strpos(f.xml, 'VCHTYPE="') = 0 then null when length(split_part(substr(f.xml, strpos(f.xml, 'VCHTYPE="') + 9, 101), '"', 1)) between 1 and 100 and substr(f.xml, strpos(f.xml, 'VCHTYPE="') + 9 + length(split_part(substr(f.xml, strpos(f.xml, 'VCHTYPE="') + 9, 101), '"', 1)), 1) = '"' then split_part(substr(f.xml, strpos(f.xml, 'VCHTYPE="') + 9, 101), '"', 1) else substring(f.xml from 'VCHTYPE="([^"]{1,100})"') end, '')),
       coalesce(nullif(f.r->>'vchNumber', ''), nullif(f.r->>'vchNo', ''), nullif(case when strpos(f.xml, '<VOUCHERNUMBER>') = 0 then null when length(split_part(substr(f.xml, strpos(f.xml, '<VOUCHERNUMBER>') + 15, 61), '<', 1)) between 1 and 60 and substr(f.xml, strpos(f.xml, '<VOUCHERNUMBER>') + 15 + length(split_part(substr(f.xml, strpos(f.xml, '<VOUCHERNUMBER>') + 15, 61), '<', 1)), 16) = '</VOUCHERNUMBER>' then split_part(substr(f.xml, strpos(f.xml, '<VOUCHERNUMBER>') + 15, 61), '<', 1) else substring(f.xml from '<VOUCHERNUMBER>([^<]{1,60})</VOUCHERNUMBER>') end, '')),
       case when coalesce(nullif(f.r->>'vchDate', ''), case when strpos(f.xml, '<DATE>') = 0 then null when length(substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8)) = 8 and translate(substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8), '0123456789', '') = '' and substr(f.xml, strpos(f.xml, '<DATE>') + 14, 7) = '</DATE>' then substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8) else substring(f.xml from '<DATE>(\d{8})</DATE>') end) ~ '^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$'
            then to_date(coalesce(nullif(f.r->>'vchDate', ''), case when strpos(f.xml, '<DATE>') = 0 then null when length(substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8)) = 8 and translate(substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8), '0123456789', '') = '' and substr(f.xml, strpos(f.xml, '<DATE>') + 14, 7) = '</DATE>' then substr(f.xml, strpos(f.xml, '<DATE>') + 6, 8) else substring(f.xml from '<DATE>(\d{8})</DATE>') end), 'YYYYMMDD') end,
       (select max(abs(m.a[1]::numeric)) from regexp_matches(f.xml, '<AMOUNT>\s*(-?\d{1,15}(?:\.\d{1,4})?)\s*</AMOUNT>', 'g') as m(a))
  from (select f0.*, (select p.released_why from tally_post_ids p where p.job_id = (j).id and p.fincom_id = f0.fid limit 1) as released_why from f f0) f
 order by f.ord
$judge$;
revoke all on function public.tally_post_register_judged(public.tally_post_jobs) from public, anon, authenticated;
grant execute on function public.tally_post_register_judged(public.tally_post_jobs) to service_role;

-- ---------------------------------------------------------------- the posting register written in one pass
-- 111's tally_post_register_apply_row: the same records and history. It wrote each entry with its own calls
-- (tally_post_register_put per entry: a select, two updates, a history row), inside the very statement that changes a
-- posting's status: a posting of 20,000 entries took some 25 s there, past the 8 s statement timeout, and its status
-- change was cancelled again. Now: the posting's entries judged once; tally_post_register_put's rule (p_force false, no
-- note) applied to all of them in one update (only rows it really changes), its history rows in one insert; the records
-- missing made in one insert, as before (one moved on to a later posting is left alone)
create or replace function public.tally_post_register_apply_row(j public.tally_post_jobs, p_by uuid default null)
returns integer language plpgsql security definer set search_path = public, pg_temp as $fn$
declare xs jsonb; xm jsonb; n integer := 0; k integer; bk uuid := tally_post_register_book(j.firm_id, j.company);
begin
  -- the judged rows, and the same keyed by FinCom id (looked up by key: a join to the rows was planned row by row)
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb), coalesce(jsonb_object_agg(t.fincom_id, to_jsonb(t)), '{}'::jsonb) into xs, xm from tally_post_register_judged(j) t;
  -- the records this posting holds, locked in one order (j.id is never null: the posting's own records, by its index)
  perform 1 from tally_post_register r
   where r.job_id = j.id and r.firm_id = j.firm_id and xm ? r.fincom_id
   order by r.id for update;
  -- put's first step: the voucher's own details fill what is missing, whatever the state (only where a value changes)
  with x as (select r.id, xm -> r.fincom_id as more, r.vch_type, r.vch_no, r.vch_date, r.amount, r.kind from tally_post_register r
              where r.job_id = j.id and r.firm_id = j.firm_id and xm ? r.fincom_id and (r.vch_type is null or r.vch_no is null or r.vch_date is null or r.amount is null or r.kind is null)),
  v as (select x.id, coalesce(x.vch_type, nullif(x.more->>'vch_type', '')) a1, coalesce(x.vch_no, nullif(x.more->>'vch_no', '')) a2,
               coalesce(x.vch_date, case when x.more->>'vch_date' ~ '^\d{4}-\d\d-\d\d$' then (x.more->>'vch_date')::date end) a3,
               coalesce(x.amount, case when x.more->>'amount' ~ '^-?\d+(\.\d+)?$' then (x.more->>'amount')::numeric end) a4,
               coalesce(x.kind, nullif(tally_post_register_kind(x.more->>'vch_type'), '')) a5
          from x)
  update tally_post_register r set vch_type = v.a1, vch_no = v.a2, vch_date = v.a3, amount = v.a4, kind = v.a5
    from v where r.id = v.id
     and (r.vch_type is distinct from v.a1 or r.vch_no is distinct from v.a2 or r.vch_date is distinct from v.a3 or r.amount is distinct from v.a4 or r.kind is distinct from v.a5);
  -- put's rule: allowed (a new attempt replaces only queued, sent, refused, released; else the stronger source), and only
  -- when something changes; then the record and its history row
  with x as (select t.fincom_id, t.state, t.source, coalesce(t.by_user, p_by) as by_, nullif(left(btrim(coalesce(t.master_id, '')), 60), '') as m,
                    t.id_inferred, nullif(left(btrim(coalesce(t.words, '')), 1000), '') as w
               from jsonb_to_recordset(xs) as t(fincom_id text, state text, source text, by_user uuid, master_id text, id_inferred boolean, words text)),
  c as (select r.id, r.state as gstate, x.*
          from tally_post_register r join x on r.firm_id = j.firm_id and r.fincom_id = x.fincom_id
         where r.job_id is not distinct from j.id
           and case when x.state in ('queued', 'sent') then r.state in ('queued', 'sent', 'refused', 'released')
                    when r.state in ('queued', 'sent') then true
                    else tally_post_register_rank(x.source) >= tally_post_register_rank(r.source) end
           and not (r.state = x.state and r.master_id is not distinct from coalesce(x.m, case when x.state = 'in_tally' then r.master_id end) and r.id_inferred = coalesce(x.id_inferred, false)
                    and r.tally_words is not distinct from x.w and r.job_id is not distinct from coalesce(j.id, r.job_id)
                    and (r.source = x.source or tally_post_register_rank(x.source) <= tally_post_register_rank(r.source)))),
  u as (update tally_post_register r set state = c.state, source = c.source, changed_by = c.by_, changed_at = now(),
               master_id = case when c.state = 'in_tally' then coalesce(c.m, case when r.state = 'in_tally' then r.master_id end) when c.state in ('queued') then null else coalesce(c.m, r.master_id) end,
               id_inferred = case when c.state = 'in_tally' then coalesce(c.id_inferred, false) and not (c.m is null and r.state = 'in_tally' and not r.id_inferred and r.master_id is not null) else false end,
               tally_words = c.w, job_id = coalesce(j.id, r.job_id),
               sent_at = case when c.state = 'sent' then coalesce(r.sent_at, now()) else r.sent_at end,
               settled_at = case when c.state in ('in_tally', 'refused', 'released') then now() else null end
          from c where r.id = c.id
        returning r.id, r.firm_id, r.fincom_id, r.state, r.job_id, r.master_id, r.id_inferred, r.tally_words, c.by_, c.source as src, c.gstate)
  insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, master_id, id_inferred, words, note)
  select u.id, u.firm_id, u.fincom_id, u.by_, u.src, u.gstate, u.state, u.job_id, u.master_id, u.id_inferred, u.tally_words, null from u order by u.id;
  get diagnostics k = row_count; n := n + k;
  -- a record missing (an entry FinCom has no record of yet): made, with its history row
  with t as (select * from jsonb_to_recordset(xs) as t(fincom_id text, entry_id text, ord integer, state text, source text, master_id text, id_inferred boolean, words text,
                                                       by_user uuid, vch_type text, vch_no text, vch_date date, amount numeric)),
  ins as (insert into tally_post_register (firm_id, client_id, fincom_id, entry_id, kind, company, book_id, state, master_id, id_inferred, vch_type, vch_no, vch_date, amount, tally_words,
                                           job_id, source, changed_by, queued_by, queued_at, sent_at, settled_at)
          select j.firm_id, j.client_id, t.fincom_id, t.entry_id, tally_post_register_kind(t.vch_type), j.company, bk, t.state, t.master_id, coalesce(t.id_inferred, false), t.vch_type, t.vch_no, t.vch_date, t.amount, t.words,
                 j.id, t.source, coalesce(t.by_user, p_by), j.created_by, j.created_at, case when t.state <> 'queued' then coalesce(j.taken_at, j.updated_at) end,
                 case when t.state in ('in_tally', 'refused', 'released') then now() end
            from t where not exists (select 1 from tally_post_register r where r.firm_id = j.firm_id and r.fincom_id = t.fincom_id)
           order by t.ord
          on conflict (firm_id, fincom_id) do nothing returning *)
  insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, master_id, id_inferred, words, note)
  select ins.id, ins.firm_id, ins.fincom_id, ins.changed_by, ins.source, null, ins.state, ins.job_id, ins.master_id, ins.id_inferred, ins.tally_words, 'recorded from posting ' || j.id
    from ins order by ins.id;
  get diagnostics k = row_count; n := n + k;
  return n;
end $fn$;
revoke all on function public.tally_post_register_apply_row(public.tally_post_jobs, uuid) from public, anon, authenticated;
grant execute on function public.tally_post_register_apply_row(public.tally_post_jobs, uuid) to service_role;

-- 111's tally_post_register_queued (the trigger on tally_post_ids: a posting queued), with THE DUPLICATE GUARD the same:
-- the first entry (by posting, then FinCom id) whose record is queued, sent, in Tally or waiting for review in another
-- posting refuses the whole statement, in the same words; an entry queued again after a refusal or a release is put back
-- to queued (tally_post_register_put, forced) as before; a new entry's record and history made in one insert. Ids of more
-- than one posting in one statement (never the sync's own insert, one posting at a time): one by one, as before
create or replace function public.tally_post_register_queued() returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
declare x record; g tally_post_register%rowtype; j tally_post_jobs%rowtype; rec boolean; jobs uuid[] := '{}'; bad record; one boolean;
begin
  select count(distinct nw.job_id) <= 1 and count(*) = count(distinct (nw.firm_id, nw.fincom_id)) into one from nw;
  if one then
    select * into j from tally_post_jobs where id = (select nw.job_id from nw limit 1);
    if not found then return null; end if;
    rec := coalesce(j.payload->>'recorded', '') = 'true' or j.status in ('done', 'failed');
    -- the records of these ids, locked in one order (the loop locked each in turn)
    perform 1 from tally_post_register r join nw on r.firm_id = nw.firm_id and r.fincom_id = nw.fincom_id order by r.id for update of r;
    if not rec then
      select nw.entry_id, nw.fincom_id, g2.state, g2.job_id into bad
        from nw join tally_post_register g2 on g2.firm_id = nw.firm_id and g2.fincom_id = nw.fincom_id
       where g2.job_id is distinct from nw.job_id and g2.state in ('queued', 'sent', 'in_tally', 'needs_review')
       order by nw.job_id, nw.fincom_id limit 1;
      if found then
        raise exception 'Not queued: % is already % in FinCom''s posting register (posting %). %', coalesce(bad.entry_id, bad.fincom_id),
          case bad.state when 'in_tally' then 'in Tally' when 'needs_review' then 'waiting for review' when 'sent' then 'with the Tally computer' else 'waiting to be sent' end,
          left(coalesce(bad.job_id::text, '?'), 8),
          case bad.state when 'in_tally' then 'It is not posted twice.' when 'needs_review' then 'Settle it first: Mark posted, or Not in Tally.' else 'Wait for that posting to finish.' end
          using errcode = 'P0001';
      end if;
    end if;
    -- queued again (a refusal, a release, or a posting recorded after the fact): back to queued, forced, as before
    for x in select nw.*, g2.id as gid from nw join tally_post_register g2 on g2.firm_id = nw.firm_id and g2.fincom_id = nw.fincom_id
              where g2.job_id is distinct from nw.job_id order by nw.job_id, nw.fincom_id loop
      perform tally_post_register_put(x.gid, 'queued', 'queue', coalesce(auth.uid(), j.created_by), x.job_id, null, false, null,
        case when rec then 'recorded posting ' else 'queued again in posting ' end || x.job_id, true,
        jsonb_build_object('company', j.company, 'book_id', tally_post_register_book(j.firm_id, j.company), 'client_id', j.client_id, 'entry_id', x.entry_id));
    end loop;
    -- new: the record and its history row
    with ins as (insert into tally_post_register (firm_id, client_id, fincom_id, entry_id, company, book_id, state, job_id, source, changed_by, queued_by, queued_at)
                 select nw.firm_id, nw.client_id, nw.fincom_id, nw.entry_id, j.company, tally_post_register_book(j.firm_id, j.company), 'queued', nw.job_id, 'queue',
                        coalesce(auth.uid(), j.created_by), coalesce(auth.uid(), j.created_by), now()
                   from nw where not exists (select 1 from tally_post_register r where r.firm_id = nw.firm_id and r.fincom_id = nw.fincom_id)
                  order by nw.job_id, nw.fincom_id
                 on conflict (firm_id, fincom_id) do nothing returning *)
    insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, note)
    select ins.id, ins.firm_id, ins.fincom_id, ins.changed_by, 'queue', null, 'queued', ins.job_id, 'queued in posting ' || ins.job_id from ins order by ins.id;
    perform tally_post_register_apply_row(j, coalesce(auth.uid(), j.created_by));
    return null;
  end if;
  -- (111's loop, unchanged) ids of several postings in one statement
  for x in select nw.* from nw order by nw.job_id, nw.fincom_id loop
    select * into j from tally_post_jobs where id = x.job_id;
    if not found then continue; end if;
    rec := coalesce(j.payload->>'recorded', '') = 'true' or j.status in ('done', 'failed');
    select * into g from tally_post_register where firm_id = x.firm_id and fincom_id = x.fincom_id for update;
    if found then
      if g.job_id is not distinct from x.job_id then
        null;
      elsif g.state in ('queued', 'sent', 'in_tally', 'needs_review') and not rec then
        raise exception 'Not queued: % is already % in FinCom''s posting register (posting %). %', coalesce(x.entry_id, x.fincom_id),
          case g.state when 'in_tally' then 'in Tally' when 'needs_review' then 'waiting for review' when 'sent' then 'with the Tally computer' else 'waiting to be sent' end,
          left(coalesce(g.job_id::text, '?'), 8),
          case g.state when 'in_tally' then 'It is not posted twice.' when 'needs_review' then 'Settle it first: Mark posted, or Not in Tally.' else 'Wait for that posting to finish.' end
          using errcode = 'P0001';
      else
        perform tally_post_register_put(g.id, 'queued', 'queue', coalesce(auth.uid(), j.created_by), x.job_id, null, false, null,
          case when rec then 'recorded posting ' else 'queued again in posting ' end || x.job_id, true,
          jsonb_build_object('company', j.company, 'book_id', tally_post_register_book(j.firm_id, j.company), 'client_id', j.client_id, 'entry_id', x.entry_id));
      end if;
    else
      insert into tally_post_register (firm_id, client_id, fincom_id, entry_id, company, book_id, state, job_id, source, changed_by, queued_by, queued_at)
      values (x.firm_id, x.client_id, x.fincom_id, x.entry_id, j.company, tally_post_register_book(j.firm_id, j.company), 'queued', x.job_id, 'queue',
              coalesce(auth.uid(), j.created_by), coalesce(auth.uid(), j.created_by), now())
      on conflict (firm_id, fincom_id) do nothing returning * into g;
      if g.id is not null then
        insert into tally_post_register_history (register_id, firm_id, fincom_id, by_user, source, from_state, to_state, job_id, note)
        values (g.id, g.firm_id, g.fincom_id, g.changed_by, 'queue', null, 'queued', g.job_id, 'queued in posting ' || x.job_id);
      end if;
    end if;
    if not (x.job_id = any(jobs)) then jobs := jobs || x.job_id; end if;
  end loop;
  for j in select * from tally_post_jobs where id = any(jobs) loop
    perform tally_post_register_apply_row(j, coalesce(auth.uid(), j.created_by));
  end loop;
  return null;
end $fn$;
revoke all on function public.tally_post_register_queued() from public, anon, authenticated;
grant execute on function public.tally_post_register_queued() to service_role;

commit;
