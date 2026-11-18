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
-- Replaces, from their latest text and with the same arguments and answers: 43's tally_post_job_accepted and 40's
-- tally_post_ids_sync. Nothing else changes: tally_post_id_match stays for its other callers. Add-only, one transaction,
-- lock_timeout 10 s, safe twice; service_role only, as before, granted explicitly. Tested by tests/run_migration199.py.
begin;
set local lock_timeout = '10s';

-- 43's tally_post_job_accepted: the same answer; the ids matched by their spellings worked out once
create or replace function public.tally_post_job_accepted(p_job uuid, p_results jsonb, p_items jsonb) returns text
language sql stable security definer set search_path = public, pg_temp as $function$
  with ids as (select fincom_id, entry_id, accepted_at, released_at,
                      regexp_replace(coalesce(fincom_id, ''), '[^A-Za-z0-9]', '', 'g') fan, regexp_replace(coalesce(entry_id, ''), '[^A-Za-z0-9]', '', 'g') ean
                 from tally_post_ids where job_id = p_job),
  res as (select r->>'id' id, tally_post_result_accepted(r) acc, (tally_post_result_taken(r) and not tally_post_bool(r->>'needsReview')) conf from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r where r->>'id' is not null),
  its as (select i->>'id' id, (not tally_post_bool(i->>'postOnly') and (tally_post_bool(i->>'accepted') or tally_post_bool(i->>'held') or tally_post_accept_text(i->>'reason'))) acc, tally_post_result_taken(i) conf from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i where i->>'id' is not null),
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
      union select x->>'id' from jsonb_array_elements(coalesce(new.results, '[]'::jsonb)) x where x->>'id' is not null and (tally_post_result_taken(x) or tally_post_bool(x->>'ok'))
      union select x->>'id' from jsonb_array_elements(coalesce(new.items, '[]'::jsonb)) x where x->>'id' is not null and tally_post_result_taken(x)) s where id <> '';
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

commit;
