-- migration-127-tally-place-real-folder (28-Oct-2026, branch next-tally-linknow; written, NOT run: the owner applies it)
-- A false "the same company in two places" on staging: Salesify Marketing LLP 2026-27 (book cf45de08…) showed
--   ① NWS144 · NW144\anshul · Data:  (FinCom reads this one)   ② NWS144 · NW144\anshul
-- for ONE computer, ONE bridge (go-6b1ba45fbb1d) and ONE Windows user. tally_link_loc (migration 110) made the data
-- location from the bridge's beat: its data folder when it named one, else its Tally port, else the computer key alone.
--   place 1  data_folder "Data:"  port 9006  -> 'f' || md5(computer | folder)   (13:16, Tally open)
--   place 2  no folder, no port              -> 'd' || md5(device)              (13:46, Tally closed: the beat had none)
-- "Data:" is not a folder: it is TallyPrime's own word in tally.ini for "the Data folder beside this TallyPrime"
-- (bridge-go ports.go myTallyFor reads tally.ini's data line as it is), the same text for every TallyPrime. A beat with
-- Tally closed names no folder or port at all. So one place became two, and everything the bridge sent after Tally was
-- closed (its outbox) was refused by tally_link_place_check as "from another place".
-- The owner: "I don't want false alarms at all, use a proper system." Now:
--   - a data location is a REAL, complete folder only (an absolute path: C:\…, \\server\share\…, /…), compared
--     normalised (case, / or \, repeated and trailing separators): tally_folder_norm. Anything else (blank, "Data:" or
--     another label, a port only, Tally closed) is no location of its own: applied, no place made, nothing said.
--   - a place records when entries were seen from it and its last entry's date (tally_link_place_seen, from tally-ingest's
--     days call; the app's card shows the folder, computer, Windows login and last entry of each place, and only when two
--     places with different real folders have each sent entries: src/js/98-link-record.js twoPlaces).
--   - every waiting place already made that does not meet that bar is marked merged (state not_used, merged_at,
--     merged_why), never deleted. A merged place that is a real other folder and keeps sending comes back as waiting.
--   - a link record whose location came from no real folder forgets it (the first real folder is taken, as in 110); one
--     with a real folder spelled oddly gets the normalised location (the same one for every spelling).
-- Add-only: new columns (if not exists), new functions tally_folder_norm, tally_real_folder, tally_link_place_seen;
-- tally_link_loc and tally_link_place_check replaced (same signatures and grants).
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. a real folder, normalised
-- C:\Users\A\TallyPrime\Data\ , c:/users/a/tallyprime/data , C:\\Users\A\TallyPrime\Data -> c:\users\a\tallyprime\data;
-- \\SERVER\Share\Data -> \\server\share\data; /home/t/data -> \home\t\data. Not a complete absolute path: null
create or replace function public.tally_folder_norm(p text)
returns text language sql immutable set search_path = public, pg_temp as $function$
  with a as (select lower(replace(btrim(coalesce(p, '')), '/', '\')) as s),
  b as (select case when s ~ '^\\\\[^\\]+\\[^\\]+' then '\\' || regexp_replace(substr(s, 3), '\\+', '\', 'g')
                    else regexp_replace(s, '\\+', '\', 'g') end as s from a),
  c as (select regexp_replace(s, '\\+$', '') as s from b)
  -- a path starting \\ must be a whole \\server\share (never read as a root folder)
  select case when ((select s from a) !~ '^\\\\' or (select s from b) ~ '^\\\\[^\\]+\\[^\\]+')
               and (select s from b) ~ '^([a-z]:\\[^\\]|\\\\[^\\]+\\[^\\]+|\\[^\\])' then nullif((select s from c), '') end
$function$;
create or replace function public.tally_real_folder(p text)
returns boolean language sql immutable set search_path = public, pg_temp as $function$
  select public.tally_folder_norm(p) is not null
$function$;
revoke all on function public.tally_folder_norm(text) from public, anon, authenticated;
revoke all on function public.tally_real_folder(text) from public, anon, authenticated;
grant execute on function public.tally_folder_norm(text) to service_role;
grant execute on function public.tally_real_folder(text) to service_role;

-- ---------------------------------------------------------------- 2. what a place records (add-only)
alter table public.tally_link_places add column if not exists entries_at timestamptz;   -- entries last seen from this place
alter table public.tally_link_places add column if not exists last_entry date;          -- the latest entry date seen from it
alter table public.tally_link_places add column if not exists merged_at timestamptz;    -- not a place of its own (127)
alter table public.tally_link_places add column if not exists merged_why text;

-- ---------------------------------------------------------------- 3. the data location: a real folder only
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
    select e.id, public.tally_folder_norm(e.b ->> 'dataFolder') as norm,
           case when public.tally_real_folder(e.b ->> 'dataFolder') then btrim(e.b ->> 'dataFolder') end as folder,
           coalesce(nullif(btrim(e.b ->> 'computer'), ''), nullif(btrim(e.info ->> 'computer'), ''), e.name) as computer,
           nullif(btrim(coalesce(e.b ->> 'user', '')), '') as usr,
           case when coalesce(e.b ->> 'tallyPort', '') ~ '^[0-9]{1,5}$' and (e.b ->> 'tallyPort')::int > 0 then (e.b ->> 'tallyPort')::int end as port
    from e)
  -- loc null: no real folder known now (Tally closed, "Data:", a port only): not a data location of its own. A plain
  -- Windows path gives the same location as migration 110 did (lower(folder) = its normalised form)
  select jsonb_build_object('loc', case when v.norm is not null then 'f' || left(md5(lower(coalesce(v.computer, '')) || '|' || v.norm), 20) end,
                            'folder', v.folder, 'computer', v.computer, 'user', v.usr, 'port', v.port)
  from v
$function$;
revoke all on function public.tally_link_loc(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tally_link_loc(uuid, text, text) to service_role;

-- ---------------------------------------------------------------- 4. the place check (as 110; a merged place that is a
-- real other folder and keeps sending is waiting again; a place's folder is kept as the bridge spelled it)
create or replace function public.tally_link_place_check(p_firm uuid, p_book uuid, p_device uuid, p_bridge text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $function$
declare r tally_links%rowtype; co text; x jsonb; loc text;
begin
  select * into r from tally_links where firm_id = p_firm and book_id = p_book and state = 'linked';
  if not found then return true; end if;
  select company into co from tally_companies where firm_id = p_firm and book_id = p_book;
  x := tally_link_loc(p_device, p_bridge, co); loc := x ->> 'loc';
  if loc is null then return true; end if;
  if r.data_loc is null then
    perform pg_advisory_xact_lock(hashtext('tally_links:' || p_firm::text));
    select * into r from tally_links where firm_id = p_firm and book_id = p_book and state = 'linked';
    if r.data_loc is null then
      update tally_links set data_loc = loc, data_folder = x ->> 'folder', windows_user = x ->> 'user', tally_port = (x ->> 'port')::int,
             computer = coalesce(x ->> 'computer', computer), device_id = coalesce(p_device, device_id)
       where firm_id = p_firm and book_id = p_book;
      r.data_loc := loc;
    end if;
  end if;
  insert into tally_link_places as p (firm_id, book_id, data_loc, data_folder, computer, windows_user, tally_port, device_id, bridge_id, state)
  values (p_firm, p_book, loc, x ->> 'folder', x ->> 'computer', x ->> 'user', (x ->> 'port')::int, p_device, nullif(p_bridge, ''), case when r.data_loc = loc then 'chosen' else 'waiting' end)
  on conflict (firm_id, book_id, data_loc) do update set last_seen = now(), data_folder = coalesce(excluded.data_folder, p.data_folder), computer = coalesce(excluded.computer, p.computer),
    windows_user = coalesce(excluded.windows_user, p.windows_user), tally_port = coalesce(excluded.tally_port, p.tally_port), device_id = excluded.device_id, bridge_id = coalesce(excluded.bridge_id, p.bridge_id),
    state = case when r.data_loc = excluded.data_loc then 'chosen' when p.state = 'chosen' then 'waiting'
                 when p.state = 'not_used' and p.merged_at is not null then 'waiting' else p.state end,
    merged_at = case when p.state = 'not_used' and p.merged_at is not null and r.data_loc <> excluded.data_loc then null else p.merged_at end;
  return r.data_loc = loc;
end $function$;
revoke all on function public.tally_link_place_check(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_place_check(uuid, uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- 5. entries seen from a place (tally-ingest, days)
create or replace function public.tally_link_place_seen(p_firm uuid, p_book uuid, p_device uuid, p_bridge text, p_last date)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $function$
declare co text; loc text;
begin
  if p_last is null then return false; end if;
  select company into co from tally_companies where firm_id = p_firm and book_id = p_book;
  loc := tally_link_loc(p_device, p_bridge, co) ->> 'loc';
  if loc is null then return false; end if;
  update tally_link_places set entries_at = now(), last_entry = greatest(coalesce(last_entry, p_last), p_last)
   where firm_id = p_firm and book_id = p_book and data_loc = loc;
  return found;
end $function$;
revoke all on function public.tally_link_place_seen(uuid, uuid, uuid, text, date) from public, anon, authenticated;
grant execute on function public.tally_link_place_seen(uuid, uuid, uuid, text, date) to service_role;

-- ---------------------------------------------------------------- 6. the places and records already made
-- a link record whose location came from no real folder forgets it (unless a person chose that place)
update public.tally_links set data_loc = null, data_folder = null
 where data_loc is not null and not public.tally_real_folder(data_folder)
   and not exists (select 1 from public.tally_link_places p where p.firm_id = tally_links.firm_id and p.book_id = tally_links.book_id
                     and p.data_loc = tally_links.data_loc and p.chosen_by is not null);
-- one with a real folder: the normalised location (the same for every spelling of that folder)
update public.tally_links l set data_loc = 'f' || left(md5(lower(coalesce(l.computer, '')) || '|' || public.tally_folder_norm(l.data_folder)), 20)
 where l.data_loc is not null and public.tally_real_folder(l.data_folder)
   and l.data_loc <> 'f' || left(md5(lower(coalesce(l.computer, '')) || '|' || public.tally_folder_norm(l.data_folder)), 20);
-- places without a real folder: never a place of their own (kept, marked merged)
update public.tally_link_places set state = 'not_used', merged_at = now(),
       merged_why = 'no real data folder (' || coalesce(nullif(btrim(data_folder), ''), 'none') || '): the same place as the one FinCom reads'
 where merged_at is null and state in ('waiting', 'chosen') and chosen_by is null and not public.tally_real_folder(data_folder);
-- waiting places that are the place FinCom reads spelled differently (the same computer and normalised folder)
update public.tally_link_places w set state = 'not_used', merged_at = now(), merged_why = 'the same folder as the place FinCom reads'
 where w.merged_at is null and w.state = 'waiting'
   and exists (select 1 from public.tally_links l where l.firm_id = w.firm_id and l.book_id = w.book_id and public.tally_real_folder(l.data_folder)
                 and lower(coalesce(l.computer, '')) = lower(coalesce(w.computer, '')) and public.tally_folder_norm(l.data_folder) = public.tally_folder_norm(w.data_folder));
-- every other waiting place: no entries were ever recorded from it (the column is new), so it does not meet the bar now;
-- merged, and waiting again (with its card) once it really sends entries from another real folder
update public.tally_link_places set state = 'not_used', merged_at = now(), merged_why = 'no entries seen from it yet'
 where merged_at is null and state = 'waiting';

do $$
declare n_merged int; n_nolocs int;
begin
  select count(*) into n_merged from public.tally_link_places where merged_at is not null;
  select count(*) into n_nolocs from public.tally_links where data_loc is null and state = 'linked';
  raise notice 'migration 127: places merged (kept, not_used) %, linked records without a data location yet %', n_merged, n_nolocs;
end $$;

commit;
