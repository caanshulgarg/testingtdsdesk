-- Migration 155 (10-Nov-2026, branch next-link-guid; written, NOT run: the owner reads it and runs it).
-- The owner's rule (10-Nov-2026): a link belongs to the company and the firm, never to a person or a bridge; whoever
-- opens the company in Tally, on any computer, serves it. Found on staging: a linked book whose link had no Tally GUID
-- (tally_links.company_guid null: linked by name before any bridge said the GUID) was served by no bridge, because
-- migration 146 counts a bridge as serving a book only when its own record lists the company with the link's GUID.
--
-- One function, add-only (nothing created but it, nothing dropped, altered or emptied; safe to run twice):
--   tally_link_guid_fill(firm, device, bridge): for each LINKED row of the firm whose company_guid is null and whose
--   company the bridge's OWN record (tally_devices.info.bridges[bridge].cos: [[name, guid]] of the companies that bridge's
--   beat says open, kept by tally-ingest since migration 146) lists by the same name once cleaned (tally_nm, case
--   folded, the exact name otherwise), the GUID is filled in, lower case. Never over a GUID already there; never a GUID
--   another linked book of the firm holds (tally_links_guid_once); never for a name the record lists twice with two
--   GUIDs. device_id, computer, client and state are not touched. Returns the number of links filled.
-- tally-ingest calls it after each beat's record is kept (a cloud without it: the call fails quietly, nothing changes).
begin;
set local lock_timeout = '10s';

create or replace function public.tally_link_guid_fill(p_firm uuid, p_device uuid, p_bridge text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare n integer := 0; c record;
begin
  if p_firm is null or p_device is null or coalesce(p_bridge, '') = '' then return 0; end if;
  for c in
    with rec as (
      select x ->> 0 as name, lower(btrim(x ->> 1)) as g
        from tally_devices d,
             jsonb_array_elements(case when jsonb_typeof(d.info -> 'bridges' -> p_bridge -> 'cos') = 'array' then d.info -> 'bridges' -> p_bridge -> 'cos' else '[]'::jsonb end) x
       where d.id = p_device and d.firm_id = p_firm and not coalesce(d.revoked, false) and jsonb_typeof(x) = 'array'),
    one as (
      select lower(tally_nm(name)) as k, min(g) as g from rec
       where g ~ '^[0-9a-z-]{1,100}$' and coalesce(name, '') <> ''
       group by lower(tally_nm(name)) having count(distinct g) = 1)
    select l.book_id, one.g from tally_links l join one on one.k = lower(tally_nm(l.company_name))
     where l.firm_id = p_firm and l.state = 'linked' and l.company_guid is null
  loop
    perform pg_advisory_xact_lock(hashtext('tally_links:' || p_firm::text));
    update tally_links l set company_guid = c.g
     where l.firm_id = p_firm and l.book_id = c.book_id and l.state = 'linked' and l.company_guid is null
       and not exists (select 1 from tally_links x where x.firm_id = p_firm and x.state = 'linked' and x.company_guid = c.g);
    if found then n := n + 1; end if;
  end loop;
  return n;
end $function$;
revoke all on function public.tally_link_guid_fill(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_guid_fill(uuid, uuid, text) to service_role;

commit;
