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
--   GUIDs; never when more than one linked book of the firm has that name (review B2); never against the book's own
--   recorded GUID (tally_sync_cursor.company_guid, which 110's tally_link_guid prefers): a book whose cursor names
--   another GUID is left (review B1). device_id, computer, client and state are not touched. Returns the number filled.
--   After staging-next's link chooser (next-link-choose) and coTrim: the name is cleaned as tally-ingest's coTrim keeps it
--   (spaces and control characters such as Tally's chr(4) off both ends), then tally_nm, case folded; never when another
--   bridge or beat of the firm lists that name with another GUID, or when a company of another name that LOOKS ALIKE
--   (a key coarser than tallyLookKey) is anywhere in the firm: a person chooses; never a GUID another book's cursor
--   records; GUIDs compared case folded; one fill of a firm at a time, a GUID taken meanwhile left.
-- tally-ingest calls it after each beat's record is kept (a cloud without it: the call fails quietly, nothing changes).
begin;
set local lock_timeout = '10s';

create or replace function public.tally_link_guid_fill(p_firm uuid, p_device uuid, p_bridge text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare n integer := 0; c record;
begin
  if p_firm is null or p_device is null or coalesce(p_bridge, '') = '' then return 0; end if;
  -- one fill of the firm's links at a time (taken before the links are read)
  perform pg_advisory_xact_lock(hashtext('tally_links:' || p_firm::text));
  for c in
    with src as (
      -- t: l the firm's links (any state), c the firm's company list, m this bridge's own record, r every other bridge's
      -- record of the firm's live computers, b their last beats' companies (what 110's tally_link_guid reads)
      select 'l'::text as t, l.book_id, l.company_name as name, null::text as g, l.state, l.company_guid as cg
        from tally_links l where l.firm_id = p_firm
      union all
      select 'c', null, tc.company, null, null, null from tally_companies tc where tc.firm_id = p_firm
      union all
      select case when d.id = p_device and br.key = p_bridge then 'm' else 'r' end, null, x ->> 0, lower(btrim(x ->> 1)), null, null
        from tally_devices d,
             jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) br,
             jsonb_array_elements(case when jsonb_typeof(br.value -> 'cos') = 'array' then br.value -> 'cos' else '[]'::jsonb end) x
       where d.firm_id = p_firm and not coalesce(d.revoked, false) and jsonb_typeof(x) = 'array'
      union all
      select 'b', null, x ->> 'name', lower(btrim(x ->> 'guid')), null, null
        from tally_devices d,
             jsonb_array_elements(case when jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array' then d.info -> 'beat' -> 'companies' else '[]'::jsonb end) x
       where d.firm_id = p_firm and not coalesce(d.revoked, false) and jsonb_typeof(x) = 'object'),
    k1 as (
      -- the cleaned name: tally_nm, then tally-ingest's coTrim (spaces and control characters such as Tally's chr(4) off
      -- both ends), case folded
      select src.*, lower(regexp_replace(tally_nm(src.name), '^[\s\x01-\x1f]+|[\s\x01-\x1f]+$', '', 'g')) as nk
        from src where coalesce(src.name, '') <> ''),
    k as (
      -- the look-alike key, kept coarser than link-choose's tallyLookKey (server/_shared/tallyname.js) so that two names
      -- it calls alike are alike here too: "(P)" as pvt, bracketed words, digits and punctuation, single letters, the
      -- forms of Pvt/Ltd/LLP/Co, "and"/"the", and the words of a period (from, FY, months) taken off
      select k1.*, btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(k1.nk,
               '\(\s*p\s*\)', ' pvt ', 'g'), '[(\[{][^()\[\]{}]*[)\]}]', ' ', 'g'), '[^a-z]+', ' ', 'g'),
               '\m([a-z]|pvt|private|ltd|limited|llp|co|company|and|the|fy|from|for|year|st|nd|rd|th|onwards|jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\M', ' ', 'g'),
               '\s+', ' ', 'g')) as lk
        from k1),
    mine as (
      select k.nk, min(k.g) as g from k where k.t = 'm'
       group by k.nk having count(distinct k.g) = 1 and bool_and(coalesce(k.g, '') ~ '^[0-9a-z-]{1,100}$'))
    select l.book_id, mine.g from k l join mine on mine.nk = l.nk
     where l.t = 'l' and l.state = 'linked' and l.cg is null
       -- review B2: exactly one linked book of the firm has that cleaned name
       and (select count(*) from k y where y.t = 'l' and y.state = 'linked' and y.nk = mine.nk) = 1
       -- another bridge or beat of the firm names a company of that name with another GUID: two companies, a person chooses
       and not exists (select 1 from k y where y.t in ('r', 'b') and y.nk = mine.nk and coalesce(y.g, '') ~ '^[0-9a-z-]{1,100}$' and y.g <> mine.g)
       -- link-choose's rule: a company of another name that looks alike, anywhere in the firm (its links, its list, any
       -- bridge's record or beat): never filled, a person chooses
       and not exists (select 1 from k y where y.lk = l.lk and y.nk <> l.nk)
       -- review B1: the book's own recorded GUID (110's tally_link_guid prefers it) names another: left
       and not exists (select 1 from tally_sync_cursor s where s.book_id = l.book_id
                        and nullif(lower(btrim(coalesce(s.company_guid, ''))), '') is not null and lower(btrim(s.company_guid)) <> mine.g)
       -- another book of the firm records that GUID as its own: left
       and not exists (select 1 from tally_sync_cursor s where s.firm_id = p_firm and s.book_id <> l.book_id
                        and lower(btrim(coalesce(s.company_guid, ''))) = mine.g)
  loop
    begin
      update tally_links l set company_guid = c.g
       where l.firm_id = p_firm and l.book_id = c.book_id and l.state = 'linked' and l.company_guid is null
         and not exists (select 1 from tally_links x where x.firm_id = p_firm and x.state = 'linked' and lower(btrim(x.company_guid)) = c.g);
      if found then n := n + 1; end if;
    exception when unique_violation then null;     -- another link took that GUID meanwhile: left as it is
    end;
  end loop;
  return n;
end $function$;
revoke all on function public.tally_link_guid_fill(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_guid_fill(uuid, uuid, text) to service_role;

commit;
