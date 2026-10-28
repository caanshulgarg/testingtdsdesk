-- migration-127-tally-place-real-folder (28-Oct-2026, branch next-tally-linknow; written, NOT run: the owner applies it)
-- A false "the same company in two places" on staging: Salesify Marketing LLP 2026-27 (book cf45de08…) showed
--   ① NWS144 · NW144\anshul · Data:  (FinCom reads this one)   ② NWS144 · NW144\anshul
-- for ONE computer, ONE bridge (go-6b1ba45fbb1d) and ONE Windows user. tally_link_loc (migration 110) made the data
-- location from the bridge's beat: its data folder when it named one, else its Tally port, else the computer key alone.
--   place 1  data_folder "Data:"  port 9006  -> 'f' || md5(computer | folder)   (13:16, Tally open)
--   place 2  no folder, no port              -> 'd' || md5(device)              (13:46, Tally closed: the beat had none)
-- "Data:" is not a folder: it is TallyPrime's own word in tally.ini for "the Data folder beside this TallyPrime"
-- (bridge-go ports.go myTallyFor reads tally.ini's data line as it is), the same text for every TallyPrime. And a beat
-- with Tally closed names no folder or port at all. So one place became two, and everything the bridge sent after Tally
-- was closed (its outbox) was refused by tally_link_place_check as "from another place".
-- Now only a REAL folder (an absolute path: C:\…, \\server\…, or /…) is a data location. A beat without one (Tally
-- closed, "Data:", a port only) is no location: nothing is refused, no place is made for it. Two places need two real
-- folders (or the same folder on two computers), as migration 110 meant.
-- Kept, nothing deleted: a place row whose folder is not real is marked not_used (it was never a second place); a link
-- record whose location came from such a folder forgets it (data_loc null), so the first real folder is taken as before.
-- Add-only: replaces tally_link_loc (the same signature and grants), adds tally_real_folder.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. a real folder
create or replace function public.tally_real_folder(p text)
returns boolean language sql immutable set search_path = public, pg_temp as $function$
  select coalesce(btrim(p), '') ~ '^([A-Za-z]:[\\/]|\\\\[^\\/]+[\\/]|/)'
$function$;
revoke all on function public.tally_real_folder(text) from public, anon, authenticated;
grant execute on function public.tally_real_folder(text) to service_role;

-- ---------------------------------------------------------------- 2. the data location: a real folder only
create or replace function public.tally_link_loc(p_device uuid, p_bridge text, p_company text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  with d as (select x.id, x.name, x.info from tally_devices x where x.id = p_device),
  e as (
    select d.id, d.name, d.info, coalesce(
      case when coalesce(p_bridge, '') <> '' and jsonb_typeof(d.info -> 'bridges' -> p_bridge) = 'object' then d.info -> 'bridges' -> p_bridge end,
      (select b.value from jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) b
        where p_company is not null and jsonb_typeof(b.value -> 'open') = 'array'
          and exists (select 1 from jsonb_array_elements_text(b.value -> 'open') o where lower(tally_nm(o)) = lower(tally_nm(p_company)))
        order by b.value ->> 'at' desc nulls last limit 1),
      case when jsonb_typeof(d.info -> 'beat') = 'object' then d.info -> 'beat' || jsonb_build_object('user', d.info -> 'beat' ->> 'windowsUser') end) as b
    from d),
  v as (
    select e.id, case when public.tally_real_folder(e.b ->> 'dataFolder') then btrim(e.b ->> 'dataFolder') end as folder,
           coalesce(nullif(btrim(e.b ->> 'computer'), ''), nullif(btrim(e.info ->> 'computer'), ''), e.name) as computer,
           nullif(btrim(coalesce(e.b ->> 'user', '')), '') as usr,
           case when coalesce(e.b ->> 'tallyPort', '') ~ '^[0-9]{1,5}$' and (e.b ->> 'tallyPort')::int > 0 then (e.b ->> 'tallyPort')::int end as port
    from e)
  -- loc null: no real folder known now (Tally closed, "Data:", a port only): not a data location of its own
  select jsonb_build_object('loc', case when v.folder is not null then 'f' || left(md5(lower(coalesce(v.computer, '')) || '|' || lower(v.folder)), 20) end,
                            'folder', v.folder, 'computer', v.computer, 'user', v.usr, 'port', v.port)
  from v
$function$;
revoke all on function public.tally_link_loc(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tally_link_loc(uuid, text, text) to service_role;

-- ---------------------------------------------------------------- 3. the false places already made (kept, marked)
-- a place whose folder is not real was never a place of its own: not_used (a person's choice of one stays as it was
-- only when it was chosen BY a person; the record is told below)
update public.tally_link_places set state = 'not_used'
 where not public.tally_real_folder(data_folder) and state in ('waiting', 'chosen') and chosen_by is null;
-- a link record whose location came from no real folder forgets it: the first real folder is taken (migration 110's rule)
update public.tally_links set data_loc = null, data_folder = null
 where data_loc is not null and not public.tally_real_folder(data_folder)
   and not exists (select 1 from public.tally_link_places p where p.firm_id = tally_links.firm_id and p.book_id = tally_links.book_id
                     and p.data_loc = tally_links.data_loc and p.chosen_by is not null);

do $$
declare n_places int; n_links int;
begin
  select count(*) into n_places from public.tally_link_places where not public.tally_real_folder(data_folder) and state = 'not_used';
  select count(*) into n_links from public.tally_links where data_loc is null and state = 'linked';
  raise notice 'migration 127: places without a real folder (not used) %, linked records without a data location %', n_places, n_links;
end $$;

commit;
