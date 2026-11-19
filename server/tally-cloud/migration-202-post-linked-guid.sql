-- Migration 202 (19-Nov-2026, branch next-fix-linkedguid; written, NOT run: the owner reads it and runs it).
-- The owner's hard rule: FinCom Bridge posts an entry only into the Tally company the client is linked to, known by the
-- company's GUID (tally_links.company_guid, migration 110: the link record is already keyed by the GUID, so no second
-- GUID column is added); an entry never lands in another company. Found: a posting was queued and handed out by the
-- company's NAME; the beat named each open company once by name (two open companies of one name were one); the GUID a
-- link took (110's tally_link_guid, 155's fill) could be either of two same-name companies.
--
--   1. tally_post_jobs.company_guid (new, lower case): the linked GUID the posting is for, stamped when it is queued
--      (a BEFORE INSERT trigger, tally_post_jobs_guid: no enqueue function is replaced) and again when it is handed out;
--      posts_take hands it to the bridge, which posts only into the open company with that GUID (bridge linkguid.go).
--   2. tally_post_link_guid(firm, client, company): the GUID of the client's linked company of that name; null when the
--      link has none, or two linked books of that name disagree. Service role only.
--   3. tally_post_guid_wait(job, device, bridge) -> null (may be handed out) or the plain words why it waits: the link has
--      no GUID (or "pick which company" is waiting for an owner); the link's GUID changed since it was queued; the
--      bridge not heard for 3 minutes; the linked GUID not among the companies this bridge's latest beat says open
--      ("Open <company> in Tally to post"); another open company of that bridge has the same name. Service role only.
--   4. tally_post_take_for (185's text): every hand-out also needs tally_post_guid_wait null, and stamps company_guid.
--      A posting that may not be handed out stays waiting (never failed).
--   5. tally_post_take_wait(device, bridge) -> the words of the first posting this bridge could take that waits for the
--      company (null: none); each of its own never taken has those words as its message (one queued for no computer
--      keeps 185's words). posts_take answers {job: null, wait}.
--   6. tally_links.guid_pick (new, jsonb): a link with no GUID whose name a bridge's beat shows open twice with two GUIDs
--      is never given one by itself: marked {at, guids, device, bridge} for an owner to pick (tally_link_guid_pick, owners
--      only: one of the GUIDs marked, never one another linked book holds). tally_link_guid_fill (155's text, one line
--      added) marks and clears it after each fill (tally_link_guid_pick_mark).
--   7. tally_link_guid (110's text): a link made from the beats takes a GUID only when every beat that names the company
--      gives the same one (two companies of that name open: none; then 6.).
-- ADD-ONLY: two columns (if not exists), one trigger (if not there), new functions, four replaced with the same
-- arguments and grants restated. Nothing dropped, no row changed. One transaction, lock_timeout 10 s, safe twice.
-- Needs 110, 155, 174, 185. Deploy: 202, then tally-ingest of this branch (posts_take sends guid and wait; the beat keeps
-- two same-name companies apart), then the bridge. A bridge before this branch keeps posting by name as before, but is
-- handed a posting only while its beat names the linked GUID open. Tested on a throwaway stand: tests/run_migration202.py.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the columns
alter table public.tally_post_jobs add column if not exists company_guid text check (company_guid is null or company_guid ~ '^[0-9a-z-]{1,100}$');
alter table public.tally_links add column if not exists guid_pick jsonb;

-- ---------------------------------------------------------------- 2. the linked GUID of a client's company
create or replace function public.tally_post_link_guid(p_firm uuid, p_client text, p_company text)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select case when count(distinct lower(btrim(l.company_guid))) = 1 and bool_and(nullif(btrim(coalesce(l.company_guid, '')), '') is not null)
              then min(lower(btrim(l.company_guid))) end
    from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
   where l.firm_id = p_firm and l.client_id = p_client and l.state = 'linked' and lower(tally_nm(tc.company)) = lower(tally_nm(p_company))
$function$;
revoke all on function public.tally_post_link_guid(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tally_post_link_guid(uuid, text, text) to service_role;

-- stamped as it is queued (whatever function queued it)
create or replace function public.tally_post_jobs_guid()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if new.company_guid is null then
    new.company_guid := tally_post_link_guid(new.firm_id, new.client_id, new.company);
  end if;
  return new;
end $function$;
revoke all on function public.tally_post_jobs_guid() from public, anon, authenticated;
grant execute on function public.tally_post_jobs_guid() to service_role;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_guid' and tgrelid = 'public.tally_post_jobs'::regclass) then
    create trigger tally_post_jobs_guid before insert on public.tally_post_jobs for each row execute function public.tally_post_jobs_guid();
  end if;
end $$;

-- ---------------------------------------------------------------- 3. may this bridge be handed it now?
-- the companies the bridge's latest beat says open, each [name, guid]: its own list (info.bridges[id].cos, 146; every
-- open company, two of one name kept apart from this branch on), else its key's beat (info.beat.companies, open ones)
create or replace function public.tally_post_beat_cos(p_device uuid, p_bridge text)
returns table (name text, guid text) language sql stable security definer set search_path = public, pg_temp as $function$
  select lower(regexp_replace(tally_nm(x ->> 0), '^[\s\x01-\x1f]+|[\s\x01-\x1f]+$', '', 'g')), lower(btrim(coalesce(x ->> 1, '')))
    from tally_devices d, jsonb_array_elements(case when jsonb_typeof(d.info -> 'bridges' -> p_bridge -> 'cos') = 'array' then d.info -> 'bridges' -> p_bridge -> 'cos' else '[]'::jsonb end) x
   where d.id = p_device and jsonb_typeof(d.info -> 'bridges' -> p_bridge -> 'cos') = 'array' and jsonb_typeof(x) = 'array'
  union all
  select lower(regexp_replace(tally_nm(x ->> 'name'), '^[\s\x01-\x1f]+|[\s\x01-\x1f]+$', '', 'g')), lower(btrim(coalesce(x ->> 'guid', '')))
    from tally_devices d, jsonb_array_elements(case when jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array' then d.info -> 'beat' -> 'companies' else '[]'::jsonb end) x
   where d.id = p_device and jsonb_typeof(d.info -> 'bridges' -> p_bridge -> 'cos') is distinct from 'array'
     and jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array' and jsonb_typeof(x) = 'object' and coalesce(x ->> 'open', 'true') <> 'false'
$function$;
revoke all on function public.tally_post_beat_cos(uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_beat_cos(uuid, text) to service_role;

create or replace function public.tally_post_guid_wait(p_job uuid, p_device uuid, p_bridge text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare j record; lg text; pick jsonb; heard text; hts timestamptz; nm text; co text;
begin
  select * into j from tally_post_jobs where id = p_job;
  if not found then return 'This posting is no longer in FinCom.'; end if;
  co := coalesce(nullif(btrim(j.company), ''), 'the company');
  lg := tally_post_link_guid(j.firm_id, j.client_id, j.company);
  if lg is null then
    select l.guid_pick into pick from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
     where l.firm_id = j.firm_id and l.client_id = j.client_id and l.state = 'linked' and lower(tally_nm(tc.company)) = lower(tally_nm(j.company)) and l.guid_pick is not null limit 1;
    if pick is not null then
      return left('Waiting: two open companies in Tally are named ' || co || '; an owner picks which one is the client''s on the Tally page, then it posts by itself', 300);
    end if;
    return left('Waiting: FinCom does not know yet which Tally company ' || co || ' is (the link has no Tally GUID). Open ' || co || ' in Tally to post', 300);
  end if;
  if j.company_guid is not null and j.company_guid <> lg then
    return left('Waiting: the link of ' || co || ' changed to another Tally company after this posting was queued; it is not posted (cancel it, or post it again)', 300);
  end if;
  select d.info -> 'bridges' -> p_bridge ->> 'at' into heard from tally_devices d where d.id = p_device;
  begin hts := heard::timestamptz; exception when others then hts := null; end;
  if hts is null or hts < now() - interval '3 minutes' then
    return left('Open ' || co || ' in Tally to post (FinCom Bridge on that computer has not been heard for 3 minutes)', 300);
  end if;
  select c.name into nm from tally_post_beat_cos(p_device, p_bridge) c where c.guid = lg limit 1;
  if nm is null then
    return left('Open ' || co || ' in Tally to post', 300);
  end if;
  if exists (select 1 from tally_post_beat_cos(p_device, p_bridge) c where c.name = nm and c.guid <> lg) then
    return left('Open ' || co || ' in Tally to post: two open companies in Tally are named ' || co || '; close the one that is not the client''s', 300);
  end if;
  return null;
end $function$;
revoke all on function public.tally_post_guid_wait(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_guid_wait(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- 4. the hand-out (185's text)
-- 185's tally_post_take_for; changed: each of its three looks also needs tally_post_guid_wait null (the linked GUID open
-- in this bridge's latest beat, no other open company of that name), and the posting handed out carries company_guid
create or replace function public.tally_post_take_for(p_device uuid, p_bridge text, p_main boolean)
returns setof public.tally_post_jobs language plpgsql security definer set search_path = public, pg_temp as $function$
declare jid uuid; fm uuid; i integer;
begin
  -- 174: the posting about to be handed out is checked (tally_post_job_blocked); one that may no longer be posted is held
  -- (tally_post_hold_job: failed when never taken, else the stop flag) and the next is looked at; a stop-flagged one never
  select d.firm_id into fm from tally_devices d where d.id = p_device;
  -- 54's text: the bridge's own postings first (4a.: a go- bridge only for a company its own beat has open)
  for i in 1..20 loop
    select j.id into jid from tally_post_jobs j
     where j.device_id = p_device and j.status = 'waiting' and tally_post_mine_ok(j.id, p_device, p_bridge, p_main) and tally_post_guid_wait(j.id, p_device, p_bridge) is null
       and j.firm_id = fm and j.stop_reason is null
       and (j.taken_by = p_bridge or (j.taken_by is null and ((j.taken_at is null and j.first_taken_at is null) or p_bridge !~ '^go-[0-9a-f]{6,32}$')))   -- once taken: only by the bridge that took it (H2a; a v1 take, by its history too: a v1 bridge, LOW 6 / fourth review LOW 1)
     order by j.created_at limit 1 for update skip locked;
    exit when jid is null;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', company_guid = coalesce(company_guid, tally_post_link_guid(firm_id, client_id, company)), taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, message = 'Taken by the Tally computer',
             taken_by = case when p_bridge ~ '^go-[0-9a-f]{6,32}$' then p_bridge else taken_by end   -- final review M1: the bridge that took it
       where id = jid
      returning *;
      return;
    end if;
    perform tally_post_hold_job(jid);
  end loop;
  -- 142: a posting of the firm never taken, whose bridge does not have the company open now while this one does
  for i in 1..20 loop
    select j.id into jid from tally_post_jobs j join tally_devices me on me.id = p_device
     where j.firm_id = me.firm_id and j.status = 'waiting' and j.taken_by is null and tally_post_pickable_ok(j.id, p_device, p_bridge) and tally_post_guid_wait(j.id, p_device, p_bridge) is null
       and j.stop_reason is null
     order by j.created_at limit 1 for update of j skip locked;
    exit when jid is null;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', company_guid = coalesce(company_guid, tally_post_link_guid(firm_id, client_id, company)), taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, device_id = p_device, target_bridge = p_bridge, taken_by = p_bridge,
             message = left('Taken by the FinCom Bridge that has ' || company || ' open now (the one it was queued for did not have it open)', 300)
       where id = jid and status = 'waiting' and taken_by is null and taken_at is null
      returning *;
      return;
    end if;
    perform tally_post_hold_job(jid);
  end loop;
  -- 185: a posting queued for no computer (device_id null), never taken: the first FinCom Bridge 2.x that has that very
  -- company open (tally_post_unrouted_ok: the link's GUID in its beat and the link's data location) takes it. The row is
  -- locked (skip locked: a second bridge asking at the same moment is handed nothing) and taken in ONE update that holds
  -- only while it is still waiting, for no computer and never taken: it then belongs to this bridge and its key
  -- (device_id, target_bridge, taken_by), as a posting picked up (142) does. An older bridge (no "go-" id) never comes here
  if coalesce(p_bridge, '') !~ '^go-[0-9a-f]{6,32}$' then return; end if;
  for i in 1..20 loop
    select j.id into jid from tally_post_jobs j
     where j.firm_id = fm and j.status = 'waiting' and j.device_id is null and j.stop_reason is null and tally_post_unrouted_ok(j.id, p_device, p_bridge) and tally_post_guid_wait(j.id, p_device, p_bridge) is null
     order by j.created_at limit 1 for update of j skip locked;
    if jid is null then return; end if;
    if tally_post_job_blocked(jid) is null then
      return query
      update tally_post_jobs set status = 'taken', company_guid = coalesce(company_guid, tally_post_link_guid(firm_id, client_id, company)), taken_at = now(), first_taken_at = coalesce(first_taken_at, now()), updated_at = now(), seq = null, device_id = p_device, target_bridge = p_bridge, taken_by = p_bridge,
             message = left('Taken by the FinCom Bridge that has ' || company || ' open now (it was queued for whichever computer opens it)', 300)
       where id = jid and status = 'waiting' and device_id is null and taken_by is null and taken_at is null and first_taken_at is null
      returning *;
      return;
    end if;
    perform tally_post_hold_job(jid);
  end loop;
end $function$;
revoke all on function public.tally_post_take_for(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.tally_post_take_for(uuid, text, boolean) to service_role;

-- ---------------------------------------------------------------- 5. why nothing was handed out
-- the bridge's own postings waiting for the company: the first one's words (null: none waits for it); each never taken
-- has them as its message (status stays waiting)
create or replace function public.tally_post_take_wait(p_device uuid, p_bridge text)
returns text language plpgsql security definer set search_path = public, pg_temp as $function$
declare r record; w text; first text;
begin
  -- its own, and those queued for no computer (185: their own words stay; only the answer names why)
  for r in select j.id, j.device_id from tally_post_jobs j
            where (j.device_id = p_device or (j.device_id is null and j.firm_id = (select d.firm_id from tally_devices d where d.id = p_device)))
              and j.status = 'waiting' and j.stop_reason is null and (j.taken_by is null or j.taken_by = p_bridge)
            order by (j.device_id is null), j.created_at limit 20 loop
    w := tally_post_guid_wait(r.id, p_device, p_bridge);
    if w is null then continue; end if;
    first := coalesce(first, w);
    if r.device_id is not null then
      update tally_post_jobs set message = w where id = r.id and status = 'waiting' and taken_at is null and message is distinct from w;
    end if;
  end loop;
  return first;
end $function$;
revoke all on function public.tally_post_take_wait(uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_take_wait(uuid, text) to service_role;

-- ---------------------------------------------------------------- 6. "pick which company"
-- a linked company with no GUID that this bridge's beat shows open under its name with two (or more) GUIDs: marked for an
-- owner to pick (never filled by itself); a link that has its GUID: the mark cleared. Returns the number marked
create or replace function public.tally_link_guid_pick_mark(p_firm uuid, p_device uuid, p_bridge text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare n integer := 0; c record;
begin
  update tally_links set guid_pick = null where firm_id = p_firm and guid_pick is not null and (company_guid is not null or state <> 'linked');
  for c in
    select l.book_id, array_agg(distinct b.guid order by b.guid) as guids
      from tally_links l join tally_post_beat_cos(p_device, p_bridge) b
        on b.name = lower(regexp_replace(tally_nm(l.company_name), '^[\s\x01-\x1f]+|[\s\x01-\x1f]+$', '', 'g'))
     where l.firm_id = p_firm and l.state = 'linked' and l.company_guid is null and b.guid ~ '^[0-9a-z-]{1,100}$'
     group by l.book_id having count(distinct b.guid) > 1
  loop
    update tally_links set guid_pick = jsonb_build_object('at', now(), 'guids', to_jsonb(c.guids), 'device', p_device, 'bridge', p_bridge)
     where firm_id = p_firm and book_id = c.book_id and company_guid is null
       and (guid_pick is null or guid_pick -> 'guids' is distinct from to_jsonb(c.guids));
    if found then n := n + 1; end if;
  end loop;
  return n;
end $function$;
revoke all on function public.tally_link_guid_pick_mark(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_guid_pick_mark(uuid, uuid, text) to service_role;

-- an owner picks which of the marked GUIDs is the client's company (members who are owners only, as 110's
-- tally_link_place_choose); never a GUID another linked book of the firm holds
create or replace function public.tally_link_guid_pick(p_book uuid, p_guid text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); r tally_links%rowtype; g text := lower(btrim(coalesce(p_guid, '')));
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true)) then
    raise exception 'only an owner of the firm picks which Tally company is the client''s' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || f::text));
  select * into r from tally_links where firm_id = f and book_id = p_book and state = 'linked' for update;
  if not found then raise exception 'this Tally company is not linked to a client' using errcode = 'P0001'; end if;
  if r.company_guid is not null then raise exception 'this link already has its Tally company' using errcode = 'P0001'; end if;
  if r.guid_pick is null or not (r.guid_pick -> 'guids') ? g then raise exception 'not one of the companies to pick from' using errcode = 'P0001'; end if;
  if exists (select 1 from tally_links x where x.firm_id = f and x.state = 'linked' and lower(btrim(x.company_guid)) = g) then
    raise exception 'that Tally company is already linked to another client' using errcode = 'P0001';
  end if;
  update tally_links set company_guid = g, guid_pick = null, updated_by = auth.uid(), updated_at = now(), version = version + 1
   where firm_id = f and book_id = p_book returning * into r;
  return to_jsonb(r);
end $function$;
revoke all on function public.tally_link_guid_pick(uuid, text) from public, anon;
grant execute on function public.tally_link_guid_pick(uuid, text) to authenticated, service_role;

-- 155's tally_link_guid_fill; added: one line, the marks after the fill
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
  perform tally_link_guid_pick_mark(p_firm, p_device, p_bridge);   -- 202: two open companies of the name: an owner picks
  return n;
end $function$;
revoke all on function public.tally_link_guid_fill(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_guid_fill(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------- 7. the GUID a new link takes (110's tally_link_guid)
-- 110's text; changed: a GUID from the beats only when every beat naming the company gives the same one
create or replace function public.tally_link_guid(p_firm uuid, p_company text, p_book uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select coalesce(
    (select lower(btrim(s.company_guid)) from tally_sync_cursor s where s.book_id = p_book and lower(btrim(s.company_guid)) ~ '^[0-9a-z-]{1,100}$' limit 1),
    (select case when count(distinct g) = 1 then min(g) end from (
       select lower(btrim(x ->> 'guid')) as g from tally_devices d,
              jsonb_array_elements(case when jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array' then d.info -> 'beat' -> 'companies' else '[]'::jsonb end) x
        where d.firm_id = p_firm and not coalesce(d.revoked, false) and lower(tally_nm(x ->> 'name')) = lower(tally_nm(p_company))) b
      where g ~ '^[0-9a-z-]{1,100}$'))
$function$;
revoke all on function public.tally_link_guid(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.tally_link_guid(uuid, text, uuid) to service_role;

commit;
