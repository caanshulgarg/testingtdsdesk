-- Migration 110 (26-Oct-2026, branch next-link-record; NOT run on staging: the owner reads it and runs it): ONE cloud
-- link record per client <-> Tally company, public.tally_links. Stage 1 of "Stable Tally linking"
-- (reports/Stable Tally linking for FinCom.md, item 2). A client's Tally connection lived in four places that drifted
-- (tally_companies.client_id, clients.data postTo / tallyName / choices, each browser's copy, the bridge's files). From
-- here the link, and whether the client may post into that company, is this one record, kept in the cloud only:
--   - a browser never writes it as part of a client's settings (it is not in clients.data), so an older copy of a client
--     sent by another browser cannot undo a link or a posting permission;
--   - it changes only through the functions below, each checking the member's firm and role exactly as
--     tally_company_link does (my_firm(), can_write()), under one lock per firm, with who and when, and a version a
--     change of the posting permission must name (a change made from an out-of-date view is refused);
--   - it is keyed by the Tally company's GUID, which the bridge already sends (its beat's companies, kept by
--     tally-ingest in tally_devices.info.beat.companies[].guid, and with a linked book in tally_sync_cursor.company_guid):
--     a company renamed in Tally keeps its link; the name is for display only;
--   - and by the DATA LOCATION it is read from (the TallyPrime 7.1/7.2 proof of 26-Oct-2026, docs/tally-72-proof.md: a
--     copied data folder keeps the company's GUID): the computer and Tally's data folder, else the computer and Tally's
--     port, from what bridge 2.4.7 already sends in its beat (info.bridges[id].computer, .user, .tallyPort, .dataFolder;
--     info.beat.dataFolder, .tallyPort, .windowsUser; no bridge change). The first place data comes from after a link is
--     the chosen one; another place with the same GUID is "the same company in two places" (round 35): kept in
--     tally_link_places as waiting, nothing from it applied (tally-ingest asks tally_link_place_check), until an owner
--     chooses (tally_link_place_choose). Two places are never merged into one link;
--   - a GUID linked to one client of the firm is never linked to another: "already linked to <client>".
-- Why a table of its own and not more columns on tally_companies: tally_companies is keyed by the company's NAME (a
-- rename makes a second row) and is written by tally-ingest at every companies call (seen, last seen, GSTIN, computer,
-- the auto-link), for every company any computer reported, linked or not. The record needs another key (the GUID), its
-- own version and audit, and writers that are only the link functions. tally_companies.client_id and
-- tally_books.client_id stay as the record's mirror, so the books keep flowing (tally_book_for, tally-ingest) unchanged.
-- One record per Tally company's book: a client normally has one; a client that keeps one company a year in Tally has
-- one a year ("New year of <client>"), each linked to it.
--
-- ADD-ONLY: one new table, new functions and one trigger; two existing functions replaced with the same arguments and
-- grants (tally_company_link: it now goes through the record; tally_post_enqueue_core / tally_post_enqueue_to: the
-- posting guard reads the record instead of clients.data postTo). Nothing removed, no row deleted, safe to run twice,
-- one transaction, lock_timeout 10 s. Grants explicit (ROUND 101): service_role always; authenticated only what
-- PostgREST needs (select on the table under RLS, execute on the three member functions); anon nothing.
--
--   1. public.tally_links (firm_id, book_id) primary key: client_id, company_guid (lower case), company_name (display),
--      gstin, device_id, computer, posting_allowed, state linked | unlinked, linked_by / linked_at, updated_by /
--      updated_at, version, how (person | auto | backfill), and the data location read (data_loc, data_folder,
--      windows_user, tally_port). One live link per GUID in a firm (a unique index). RLS on: members read their own
--      firm's records; no direct writes. public.tally_link_places (firm, book, data location: folder, computer, Windows
--      user, port, computer key, bridge; chosen | waiting | not_used; first / last seen; who chose, when): RLS the same.
--   2. tally_link_set(p_company, p_client) -> the record (jsonb): link (p_client null: unlink). Members who may write.
--      As tally_company_link: the company must have been reported by a computer of the firm; the client must be the
--      firm's and not deleted; its GSTIN's PAN must be the company's. New: the GUID linked to another client of the firm
--      -> refused "already linked to <client>" (hint: open that client, or merge the two); the same GUID under an earlier
--      name linked to this same client (the company renamed in Tally) -> that link follows the new name, its books with it.
--      Linking allows posting (the owner's decision of 26-Oct-2026); the same client linked again keeps what was set.
--   3. tally_link_posting(p_book, p_allowed, p_version) -> the record: allow or stop posting into that company. Members
--      who may write; the record must be linked; p_version (when given) must be the record's version.
--   4. tally_company_link(p_company, p_client) (the older pages' call) -> through tally_link_set.
--   5. Two triggers on tally_companies (insert or update of client_id): a link written there by anything but these
--      functions (tally-ingest's auto-link, a client's upload) is put into the record (tally_link_mirror, after the row
--      is written); a GUID linked to another client is not linked there, the row left as it was (tally_link_guard, before).
--   6. tally_link_follow(p_firm, p_company, p_guid, p_device, p_bridge) -> the client id or null, for tally-ingest
--      (service role): a company reported under a new name with the GUID of a linked company, from the data location
--      FinCom reads, takes over that link and its books once the old name has not been reported for 15 minutes (a copy
--      elsewhere is never a rename). tally_link_place_check(p_firm, p_book, p_device, p_bridge) -> may this data be
--      applied (service role, each data call); tally_link_place_choose(p_book, p_loc) (owners): which place is the books.
--      A link of a new name with a linked GUID from another data location is refused ("the same company ... in another
--      data location").
--   7. The posting guard (tally_post_enqueue_core and tally_post_enqueue_to, migration 54's text, every check kept):
--      the company a client may post to is the record's (tally_link_post_to), not clients.data postTo.
--   8. Backfill: a record for every company linked today (tally_companies.client_id, its client not deleted), posting
--      allowed (the owner's decision: linking allows posting), how = backfill; nothing deleted. The counts, and where
--      the old places disagreed (clients.data postTo), are said in a NOTICE and kept in public.tally_links_backfill.
-- Deploy order: this file; then tally-ingest of next-link-record (the rename follow in its companies call; until then a
-- renamed company's books wait for a person's Link, and data from a second place is applied as before); then the app
-- build. Tested on pg_stand: tests/run_migration110.py.
-- After running, the counts again (read only):
--   select * from public.tally_links_backfill order by at desc limit 1;

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the record
create table if not exists public.tally_links (
  firm_id          uuid not null references public.firms(id) on delete cascade,
  book_id          uuid not null,
  client_id        text,
  company_guid     text check (company_guid is null or company_guid ~ '^[0-9a-z-]{1,100}$'),
  company_name     text not null,
  gstin            text,
  device_id        uuid,
  computer         text,
  posting_allowed  boolean not null default false,
  state            text not null default 'linked' check (state in ('linked', 'unlinked')),
  linked_by        uuid,
  linked_at        timestamptz,
  updated_by       uuid,
  updated_at       timestamptz not null default now(),
  version          bigint not null default 1,
  how              text not null default 'person' check (how in ('person', 'auto', 'backfill')),
  -- the data location FinCom reads this company from (a copied data folder keeps the company's GUID): computer + Tally's
  -- data folder, else computer + port; null until the first data arrives (that place is then the chosen one)
  data_loc         text,
  data_folder      text,
  windows_user     text,
  tally_port       integer,
  primary key (firm_id, book_id),
  constraint tally_links_linked_has_client check (state = 'unlinked' or client_id is not null),
  constraint tally_links_post_only_linked check (state = 'linked' or not posting_allowed)
);
create unique index if not exists tally_links_guid_once on public.tally_links (firm_id, company_guid) where state = 'linked' and company_guid is not null;
create index if not exists tally_links_client on public.tally_links (firm_id, client_id) where state = 'linked';
alter table public.tally_links enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_links' and policyname = 'tally_links_read') then
    create policy tally_links_read on public.tally_links for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_links from public, anon, authenticated;
grant select on public.tally_links to authenticated;
grant all on public.tally_links to service_role;

-- every data location a linked company's data came from: the chosen one, and any other (the same company in two places)
-- that waits for a person's choice; nothing from a waiting place is applied
create table if not exists public.tally_link_places (
  firm_id      uuid not null references public.firms(id) on delete cascade,
  book_id      uuid not null,
  data_loc     text not null,
  data_folder  text,
  computer     text,
  windows_user text,
  tally_port   integer,
  device_id    uuid,
  bridge_id    text,
  state        text not null default 'waiting' check (state in ('chosen', 'waiting', 'not_used')),
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  chosen_by    uuid,
  chosen_at    timestamptz,
  primary key (firm_id, book_id, data_loc)
);
alter table public.tally_link_places enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_link_places' and policyname = 'tally_link_places_read') then
    create policy tally_link_places_read on public.tally_link_places for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_link_places from public, anon, authenticated;
grant select on public.tally_link_places to authenticated;
grant all on public.tally_link_places to service_role;

-- what the backfill found, each run (read by the owner after running; nobody else)
create table if not exists public.tally_links_backfill (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  counts  jsonb not null
);
alter table public.tally_links_backfill enable row level security;
revoke all on public.tally_links_backfill from public, anon, authenticated;
grant all on public.tally_links_backfill to service_role;
grant usage, select on sequence public.tally_links_backfill_id_seq to service_role;

-- ---------------------------------------------------------------- helpers (nobody but the service role calls them)
-- the Tally company's GUID, lower case: its linked book's (tally_sync_cursor), else the one a computer of the firm says
-- in its beat for that name (bridge 2.4.5 and later); null when not known yet
create or replace function public.tally_link_guid(p_firm uuid, p_company text, p_book uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select g from (
    select lower(btrim(s.company_guid)) as g, 1 as o from tally_sync_cursor s where s.book_id = p_book
    union all
    select lower(btrim(x ->> 'guid')), 2 from tally_devices d,
           jsonb_array_elements(case when jsonb_typeof(d.info -> 'beat' -> 'companies') = 'array' then d.info -> 'beat' -> 'companies' else '[]'::jsonb end) x
     where d.firm_id = p_firm and not coalesce(d.revoked, false) and lower(tally_nm(x ->> 'name')) = lower(tally_nm(p_company))
  ) s where g ~ '^[0-9a-z-]{1,100}$' order by o limit 1
$function$;
revoke all on function public.tally_link_guid(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.tally_link_guid(uuid, text, uuid) to service_role;

-- where a computer's bridge reads Tally (bridge 2.4.7's beat, kept in tally_devices.info: bridges[id].computer, .user,
-- .tallyPort, .dataFolder, else info.beat's): {loc, folder, computer, user, port}. p_bridge null: the bridge that has
-- p_company open, else the computer's last beat. loc: md5 of the computer and the data folder (case-folded), else of the
-- computer and the port, else the computer key; null when nothing is known
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
    select e.id, nullif(btrim(coalesce(e.b ->> 'dataFolder', '')), '') as folder,
           coalesce(nullif(btrim(e.b ->> 'computer'), ''), nullif(btrim(e.info ->> 'computer'), ''), e.name) as computer,
           nullif(btrim(coalesce(e.b ->> 'user', '')), '') as usr,
           case when coalesce(e.b ->> 'tallyPort', '') ~ '^[0-9]{1,5}$' and (e.b ->> 'tallyPort')::int > 0 then (e.b ->> 'tallyPort')::int end as port
    from e)
  select jsonb_build_object('loc', case when v.folder is not null then 'f' || left(md5(lower(coalesce(v.computer, '')) || '|' || lower(v.folder)), 20)
                                        when v.port is not null then 'p' || left(md5(lower(coalesce(v.computer, '')) || '|' || v.port::text), 20)
                                        else 'd' || left(md5(v.id::text), 20) end,
                            'folder', v.folder, 'computer', v.computer, 'user', v.usr, 'port', v.port)
  from v
$function$;
revoke all on function public.tally_link_loc(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tally_link_loc(uuid, text, text) to service_role;

-- the company of a renamed company's link takes the new name: the new name's row (made when missing, as tally-ingest
-- would) takes the book, the link and its time; the old name's row keeps an unused book, unlinked by a person (so it is
-- never linked again by itself). Refused when the new name's row already holds books of its own.
create or replace function public.tally_link_move_name(p_firm uuid, p_book uuid, p_company text)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
declare o tally_companies%rowtype; n tally_companies%rowtype; spare uuid;
begin
  select * into o from tally_companies where firm_id = p_firm and book_id = p_book for update;
  if not found or o.company = p_company then return; end if;
  insert into tally_companies (firm_id, company, gstin, device_id, last_seen) values (p_firm, p_company, o.gstin, o.device_id, o.last_seen)
  on conflict (firm_id, company) do nothing;
  select * into n from tally_companies where firm_id = p_firm and company = p_company for update;
  if n.client_id is not null and n.client_id is distinct from o.client_id then
    raise exception '% is linked to another client', p_company using errcode = 'P0001';
  end if;
  if exists (select 1 from tally_books b where b.book_id = n.book_id) then
    raise exception '% already holds books in FinCom; it cannot take the books of %', p_company, o.company using errcode = 'P0001';
  end if;
  spare := n.book_id;
  perform set_config('fincom.tally_link', 'on', true);
  update tally_companies set book_id = gen_random_uuid() where firm_id = p_firm and company = p_company;
  update tally_companies set book_id = spare, client_id = null, linked_at = now(), linked_by = null where firm_id = p_firm and company = o.company;
  update tally_companies set book_id = p_book, client_id = o.client_id, linked_at = o.linked_at, linked_by = o.linked_by,
         gstin = coalesce(n.gstin, o.gstin), device_id = coalesce(n.device_id, o.device_id), last_seen = greatest(n.last_seen, o.last_seen)
   where firm_id = p_firm and company = p_company;
  update tally_books set company = p_company where book_id = p_book;
  update tally_links set company_name = p_company, updated_at = now(), version = version + 1 where firm_id = p_firm and book_id = p_book;
end $function$;
revoke all on function public.tally_link_move_name(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_move_name(uuid, uuid, text) to service_role;

-- the one writer of a link: the record, and its mirror (tally_companies.client_id, tally_books.client_id). p_client
-- null: unlinked (posting stopped with it). Callers hold the firm's lock.
create or replace function public.tally_link_write(p_firm uuid, p_book uuid, p_client text, p_by uuid, p_how text)
returns public.tally_links language plpgsql security definer set search_path = public, pg_temp as $function$
declare c tally_companies%rowtype; g text; o tally_links%rowtype; r tally_links%rowtype; nm text; pc text;
begin
  select * into c from tally_companies where firm_id = p_firm and book_id = p_book;
  if not found then raise exception 'no such Tally company' using errcode = 'P0001'; end if;
  if p_client is null then
    update tally_links set state = 'unlinked', client_id = null, posting_allowed = false, updated_by = p_by, updated_at = now(), version = version + 1
     where firm_id = p_firm and book_id = p_book and state = 'linked' returning * into r;
    if r.book_id is null then select * into r from tally_links where firm_id = p_firm and book_id = p_book; end if;
  else
    g := tally_link_guid(p_firm, c.company, p_book);
    if g is not null then
      select * into o from tally_links where firm_id = p_firm and state = 'linked' and company_guid = g and book_id <> p_book limit 1;
    end if;
    if o.book_id is not null and o.client_id is distinct from p_client then
      select cl.name into nm from clients cl where cl.firm_id = p_firm and cl.id = o.client_id;
      raise exception 'already linked to %', coalesce(nm, 'another client') using errcode = 'P0001',
        hint = 'The same company in Tally is linked to ' || coalesce(nm, 'another client') || ': open that client, or merge the two clients.';
    end if;
    if o.book_id is not null and o.data_loc is not null
       and coalesce(tally_link_loc(c.device_id, null, c.company) ->> 'loc', o.data_loc) <> o.data_loc then
      -- the same company (its GUID) in another data location: two places are never one link
      raise exception '% is the same company as % in another data location; FinCom reads % only (choose which on the Tally page)', c.company, o.company_name, o.company_name
        using errcode = 'P0001', hint = 'the same company in two places';
    end if;
    if o.book_id is not null then
      -- the same company under an earlier name (renamed in Tally), linked to this client: its link follows the name
      perform tally_link_move_name(p_firm, o.book_id, c.company);
      perform set_config('fincom.tally_link', 'off', true);
      select * into r from tally_links where firm_id = p_firm and book_id = o.book_id;
      return r;
    end if;
    select coalesce(nullif(d.info ->> 'computer', ''), d.name) into pc from tally_devices d where d.id = c.device_id;
    insert into tally_links as l (firm_id, book_id, client_id, company_guid, company_name, gstin, device_id, computer, posting_allowed, state,
                                  linked_by, linked_at, updated_by, updated_at, version, how)
    values (p_firm, p_book, p_client, g, c.company, nullif(c.gstin, ''), c.device_id, pc, true, 'linked', p_by, now(), p_by, now(), 1, p_how)
    on conflict (firm_id, book_id) do update set
      company_guid = coalesce(excluded.company_guid, l.company_guid), company_name = excluded.company_name, gstin = coalesce(excluded.gstin, l.gstin),
      device_id = coalesce(excluded.device_id, l.device_id), computer = coalesce(excluded.computer, l.computer),
      -- the same client linked again keeps what was set; a new client (or a link after an unlink) may post
      posting_allowed = case when l.state = 'linked' and l.client_id = excluded.client_id then l.posting_allowed else true end,
      linked_by = case when l.state = 'linked' and l.client_id = excluded.client_id then l.linked_by else excluded.linked_by end,
      linked_at = case when l.state = 'linked' and l.client_id = excluded.client_id then l.linked_at else excluded.linked_at end,
      how = case when l.state = 'linked' and l.client_id = excluded.client_id then l.how else excluded.how end,
      data_loc = case when l.state = 'linked' and l.client_id = excluded.client_id then l.data_loc end,
      data_folder = case when l.state = 'linked' and l.client_id = excluded.client_id then l.data_folder end,
      client_id = excluded.client_id, state = 'linked', updated_by = excluded.updated_by, updated_at = now(), version = l.version + 1
    returning * into r;
  end if;
  perform set_config('fincom.tally_link', 'on', true);
  update tally_companies set client_id = p_client, linked_at = now(), linked_by = p_by where firm_id = p_firm and book_id = p_book;
  update tally_books set client_id = coalesce(p_client, '') where book_id = p_book;
  perform set_config('fincom.tally_link', 'off', true);
  return r;
end $function$;
revoke all on function public.tally_link_write(uuid, uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_write(uuid, uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------- 2. link or unlink (members who may write)
create or replace function public.tally_link_set(p_company text, p_client text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); c tally_companies%rowtype; cg text; r tally_links%rowtype;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || f::text));
  select * into c from tally_companies where firm_id = f and company = p_company;
  if not found then raise exception 'no computer has reported % yet; open it in Tally on a connected computer first', p_company using errcode = 'P0001'; end if;
  if nullif(p_client, '') is not null then
    select cl.gstin into cg from clients cl where cl.id = p_client and cl.firm_id = f and not coalesce(cl.deleted, false);
    if not found then raise exception 'no such client' using errcode = 'P0001'; end if;
    -- a company whose GSTIN is not the client's is never linked (someone else's books must not land in this client)
    if coalesce(cg, '') <> '' and coalesce(c.gstin, '') <> '' and upper(substr(cg, 3, 10)) <> upper(substr(c.gstin, 3, 10)) then
      raise exception 'the GSTIN of % in Tally (%) is not this client''s (%)', p_company, c.gstin, cg using errcode = 'P0001';
    end if;
  end if;
  r := tally_link_write(f, c.book_id, nullif(p_client, ''), auth.uid(), 'person');
  return to_jsonb(r);
end $function$;
revoke all on function public.tally_link_set(text, text) from public, anon;
grant execute on function public.tally_link_set(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 3. allow or stop posting (members who may write)
create or replace function public.tally_link_posting(p_book uuid, p_allowed boolean, p_version bigint default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); r tally_links%rowtype;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_allowed is null then raise exception 'say whether posting is allowed' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || f::text));
  select * into r from tally_links where firm_id = f and book_id = p_book for update;
  if not found or r.state <> 'linked' then raise exception 'this Tally company is not linked to a client' using errcode = 'P0001'; end if;
  if p_version is not null and p_version <> r.version then
    raise exception 'changed by someone else since you looked; look again' using errcode = 'P0001', hint = 'version ' || r.version;
  end if;
  if r.posting_allowed = p_allowed then return to_jsonb(r); end if;
  update tally_links set posting_allowed = p_allowed, updated_by = auth.uid(), updated_at = now(), version = version + 1
   where firm_id = f and book_id = p_book returning * into r;
  return to_jsonb(r);
end $function$;
revoke all on function public.tally_link_posting(uuid, boolean, bigint) from public, anon;
grant execute on function public.tally_link_posting(uuid, boolean, bigint) to authenticated, service_role;

-- ---------------------------------------------------------------- 4. the older pages' call, through the record
create or replace function public.tally_company_link(p_company text, p_client text)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  perform tally_link_set(p_company, p_client);
end $function$;
revoke all on function public.tally_company_link(text, text) from public, anon;
grant execute on function public.tally_company_link(text, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 5. a link written straight into tally_companies
-- (tally-ingest's auto-link and a client's upload; nothing else writes there). Before the row is written: a GUID linked
-- to another client is not linked here (the row is left as it was). After it is written (an upsert that became an
-- update fires only the update's): the record follows.
create or replace function public.tally_link_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare g text; o tally_links%rowtype;
begin
  if coalesce(current_setting('fincom.tally_link', true), '') = 'on' or new.client_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id then return new; end if;
  g := tally_link_guid(new.firm_id, new.company, new.book_id);
  if g is null then return new; end if;
  select * into o from tally_links where firm_id = new.firm_id and state = 'linked' and company_guid = g and book_id <> new.book_id limit 1;
  if o.book_id is not null and o.client_id is distinct from new.client_id then
    if tg_op = 'UPDATE' then new.client_id := old.client_id; new.linked_at := old.linked_at; new.linked_by := old.linked_by;
    else new.client_id := null; end if;
  end if;
  return new;
end $function$;
revoke all on function public.tally_link_guard() from public, anon, authenticated;

create or replace function public.tally_link_mirror()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare g text; o tally_links%rowtype; pc text;
begin
  if coalesce(current_setting('fincom.tally_link', true), '') = 'on' then return null; end if;
  if tg_op = 'INSERT' and new.client_id is null then return null; end if;
  if tg_op = 'UPDATE' and new.client_id is not distinct from old.client_id then return null; end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || new.firm_id::text));
  if new.client_id is null then
    update tally_links set state = 'unlinked', client_id = null, posting_allowed = false, updated_by = auth.uid(), updated_at = now(), version = version + 1
     where firm_id = new.firm_id and book_id = new.book_id and state = 'linked';
    return null;
  end if;
  g := tally_link_guid(new.firm_id, new.company, new.book_id);
  if g is not null then
    select * into o from tally_links where firm_id = new.firm_id and state = 'linked' and company_guid = g and book_id <> new.book_id limit 1;
  end if;
  -- (another client's GUID: tally_link_guard left the row unlinked, so it never comes here.) The same client under an
  -- earlier name: this row is linked without the GUID (the earlier one keeps it)
  if o.book_id is not null then g := null; end if;
  select coalesce(nullif(d.info ->> 'computer', ''), d.name) into pc from tally_devices d where d.id = new.device_id;
  insert into tally_links as l (firm_id, book_id, client_id, company_guid, company_name, gstin, device_id, computer, posting_allowed, state,
                                linked_by, linked_at, updated_by, updated_at, version, how)
  values (new.firm_id, new.book_id, new.client_id, g, new.company, nullif(new.gstin, ''), new.device_id, pc, true, 'linked',
          new.linked_by, coalesce(new.linked_at, now()), auth.uid(), now(), 1, case when new.linked_by is null then 'auto' else 'person' end)
  on conflict (firm_id, book_id) do update set
    company_guid = coalesce(excluded.company_guid, l.company_guid), company_name = excluded.company_name, gstin = coalesce(excluded.gstin, l.gstin),
    device_id = coalesce(excluded.device_id, l.device_id), computer = coalesce(excluded.computer, l.computer),
    posting_allowed = case when l.state = 'linked' and l.client_id = excluded.client_id then l.posting_allowed else true end,
    linked_by = excluded.linked_by, linked_at = excluded.linked_at, how = excluded.how,
    client_id = excluded.client_id, state = 'linked', updated_by = excluded.updated_by, updated_at = now(), version = l.version + 1;
  return null;
end $function$;
revoke all on function public.tally_link_mirror() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_companies'::regclass and tgname = 'tally_link_guard' and not tgisinternal) then
    create trigger tally_link_guard before insert or update of client_id on public.tally_companies for each row execute function public.tally_link_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.tally_companies'::regclass and tgname = 'tally_link_mirror' and not tgisinternal) then
    create trigger tally_link_mirror after insert or update of client_id on public.tally_companies for each row execute function public.tally_link_mirror();
  end if;
end $$;

-- ---------------------------------------------------------------- 6. a company renamed in Tally (tally-ingest)
create or replace function public.tally_link_follow(p_firm uuid, p_company text, p_guid text, p_device uuid, p_bridge text)
returns text language plpgsql security definer set search_path = public, pg_temp as $function$
declare g text := lower(btrim(coalesce(p_guid, ''))); l tally_links%rowtype; o tally_companies%rowtype; here text;
begin
  if g !~ '^[0-9a-z-]{1,100}$' or coalesce(btrim(p_company), '') = '' then return null; end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || p_firm::text));
  select * into l from tally_links where firm_id = p_firm and state = 'linked' and company_guid = g limit 1;
  if l.book_id is null then return null; end if;
  select * into o from tally_companies where firm_id = p_firm and book_id = l.book_id;
  if not found then return null; end if;
  if o.company = p_company then return l.client_id; end if;
  -- reported from another data location than the one FinCom reads: the same company in two places, never a rename
  here := tally_link_loc(p_device, p_bridge, p_company) ->> 'loc';
  if l.data_loc is not null and here is distinct from l.data_loc then return null; end if;
  -- the earlier name still reported lately (two copies of one company under two names): nothing moves
  if o.last_seen > now() - interval '15 minutes' then return null; end if;
  begin
    perform tally_link_move_name(p_firm, l.book_id, p_company);
  exception when others then
    return null;
  end;
  perform set_config('fincom.tally_link', 'off', true);
  return l.client_id;
end $function$;
revoke all on function public.tally_link_follow(uuid, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_follow(uuid, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------- 6b. the data location (tally-ingest, each data call)
-- may data for this book from this computer's bridge be applied? The record's data location is the one FinCom reads;
-- the first place data comes from after a link is chosen by itself (today's setups unchanged); another place is kept
-- as waiting (the same company in two places) and nothing from it is applied until a person chooses
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
    state = case when r.data_loc = excluded.data_loc then 'chosen' when p.state = 'chosen' then 'waiting' else p.state end;
  return r.data_loc = loc;
end $function$;
revoke all on function public.tally_link_place_check(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_place_check(uuid, uuid, uuid, text) to service_role;

-- which place is the client's books: an owner of the firm chooses (round 35); recorded with who and when
create or replace function public.tally_link_place_choose(p_book uuid, p_loc text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); r tally_links%rowtype; p tally_link_places%rowtype;
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true)) then
    raise exception 'only an owner of the firm chooses which data is the books' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || f::text));
  select * into r from tally_links where firm_id = f and book_id = p_book and state = 'linked' for update;
  if not found then raise exception 'this Tally company is not linked to a client' using errcode = 'P0001'; end if;
  select * into p from tally_link_places where firm_id = f and book_id = p_book and data_loc = p_loc;
  if not found then raise exception 'no such data location for this company' using errcode = 'P0001'; end if;
  update tally_links set data_loc = p.data_loc, data_folder = p.data_folder, computer = coalesce(p.computer, computer), windows_user = p.windows_user, tally_port = p.tally_port,
         device_id = coalesce(p.device_id, device_id), updated_by = auth.uid(), updated_at = now(), version = version + 1
   where firm_id = f and book_id = p_book returning * into r;
  update tally_link_places set state = case when data_loc = p_loc then 'chosen' else 'not_used' end, chosen_by = auth.uid(), chosen_at = now()
   where firm_id = f and book_id = p_book;
  return to_jsonb(r);
end $function$;
revoke all on function public.tally_link_place_choose(uuid, text) from public, anon;
grant execute on function public.tally_link_place_choose(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------- 7. the posting guard reads the record
-- the company a client may post to: of its linked companies whose record allows posting, p_company when it is one,
-- else the latest seen; null when none (not linked, or posting stopped). clients.data postTo is not read
create or replace function public.tally_link_post_to(p_firm uuid, p_client text, p_company text)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  select tc.company from tally_links l join tally_companies tc on tc.firm_id = l.firm_id and tc.book_id = l.book_id
   where l.firm_id = p_firm and l.client_id = p_client and l.state = 'linked' and l.posting_allowed
   order by (lower(tally_nm(tc.company)) = lower(tally_nm(coalesce(p_company, '')))) desc, tc.last_seen desc nulls last limit 1
$function$;
revoke all on function public.tally_link_post_to(uuid, text, text) from public, anon, authenticated;
grant execute on function public.tally_link_post_to(uuid, text, text) to service_role;

-- migration 54's text, every check kept; only the company allowed is the record's (tally_link_post_to)
create or replace function public.tally_post_enqueue_core(p_id uuid, p_client text, p_payload jsonb, p_device uuid, p_target text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); c record; n int; dup text; allowed text; cname text; j record; dev uuid; rr jsonb;
begin
  if f is null then raise exception 'not allowed'; end if;
  select t.company, t.device_id into c from tally_companies t
   where t.firm_id = f and t.client_id = p_client and t.device_id is not null order by t.last_seen desc nulls last limit 1;
  if c.company is null then return jsonb_build_object('ok', false, 'error', 'No Tally computer keeps this client''s company yet.'); end if;
  -- the one Tally company this client may post to: its link record's (migration 110), never clients.data postTo
  select tally_link_post_to(f, p_client, c.company), cl.name into allowed, cname from clients cl where cl.firm_id = f and cl.id = p_client;
  if allowed is null then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', case when exists (select 1 from tally_links l where l.firm_id = f and l.client_id = p_client and l.state = 'linked')
        then 'Posting into Tally is stopped for ' || coalesce(cname, 'this client') || ': allow it on the Tally page (the company''s ⋯ Post entries here). Nothing was posted.'
        else 'Link ' || coalesce(cname, 'this client') || ' to its company in Tally first (the Tally page). Its books in FinCom''s cloud come from ' || c.company || '.' end); end if;
  if lower(tally_nm(allowed)) <> lower(tally_nm(c.company)) then return jsonb_build_object('ok', false, 'notAllowed', true, 'company', c.company,
      'error', coalesce(cname, 'This client') || ' may post only to ' || allowed || ', but its books in FinCom''s cloud come from ' || c.company || '. Nothing was posted.'); end if;
  -- the same posting again (Retry, by its id alone): a failed or cancelled one waits again, under the same id (and on the
  -- same computer as before: never moved to another computer key, review M2; its bridge no longer able to post: that
  -- computer's bridge that may post, else refused in plain words, review M-B)
  select * into j from tally_post_jobs where id = p_id;
  if found then
    if j.firm_id <> f or j.client_id <> p_client then raise exception 'not allowed'; end if;
    if j.status in ('failed', 'cancelled') then
      select coalesce(i.entry_id, i.fincom_id) into dup from tally_post_ids i
       where i.job_id = p_id and exists (select 1 from tally_post_ids o where o.firm_id = i.firm_id and o.fincom_id = i.fincom_id and o.job_id <> p_id and o.live) limit 1;
      if dup is not null then return jsonb_build_object('ok', false, 'error', 'Not queued again: the entry ' || dup || ' is being posted in another posting; wait for that one to finish (or cancel it).'); end if;
      rr := tally_post_reroute(p_id, false);
      if rr ->> 'state' = 'stranded' then return jsonb_build_object('ok', false, 'company', j.company, 'error', 'Not queued again for ' || j.company || ': ' || (rr ->> 'words')); end if;
      update tally_post_jobs set status = 'waiting', message = 'Retry: waiting for the Tally computer', taken_at = null, updated_at = now(),
             attempts = coalesce(attempts, 0) + 1, resend_only = null where id = p_id;     -- final review M1: a person's Retry is a whole Retry
      return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'retry', true);
    end if;
    -- still waiting for a bridge that can no longer post: moved, or failed in plain words (review M-B)
    if j.status = 'waiting' then
      rr := tally_post_reroute(p_id, true);
      if rr ->> 'state' = 'stranded' then return jsonb_build_object('ok', false, 'company', j.company, 'error', 'Not posted into ' || j.company || ': ' || (rr ->> 'words')); end if;
    end if;
    return jsonb_build_object('ok', true, 'id', p_id, 'company', j.company, 'again', true);
  end if;
  if octet_length(p_payload::text) > 8 * 1024 * 1024 then return jsonb_build_object('ok', false, 'error', 'Too many entries in one go; post fewer at a time.'); end if;
  n := coalesce(jsonb_array_length(p_payload->'vouchers'), 0) + coalesce(jsonb_array_length(p_payload->'masters'), 0);
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'Nothing to post.'); end if;
  select v->>'id' into dup from tally_post_jobs j2, jsonb_array_elements(j2.payload->'vouchers') v
   where j2.firm_id = f and j2.client_id = p_client and j2.status in ('waiting', 'taken', 'running')
     and v->>'id' in (select x->>'id' from jsonb_array_elements(coalesce(p_payload->'vouchers', '[]'::jsonb)) x) limit 1;
  if dup is not null then return jsonb_build_object('ok', false, 'error', 'Some of these entries are already waiting to be posted; wait for that posting to finish.'); end if;
  -- review M4: the computer: the target's; else the newest that may post and has the company open
  dev := coalesce(p_device, tally_post_device_for(f, c.company, c.device_id));
  if dev is null then return jsonb_build_object('ok', false, 'company', c.company, 'error', tally_post_nobody_words(f, c.company)); end if;
  insert into tally_post_jobs (id, firm_id, client_id, company, device_id, payload, n, target_bridge)
    values (p_id, f, p_client, c.company, dev, jsonb_build_object('masters', coalesce(p_payload->'masters', '[]'::jsonb), 'vouchers', coalesce(p_payload->'vouchers', '[]'::jsonb), 'ledger', coalesce(p_payload->>'ledger', '')), n,
            case when p_device is null then null else p_target end);
  return jsonb_build_object('ok', true, 'id', p_id, 'company', c.company);
end $function$;
revoke all on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text) to service_role;

create or replace function public.tally_post_enqueue_to(p_id uuid, p_client text, p_payload jsonb, p_target text default null, p_device uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); t text := nullif(left(btrim(coalesce(p_target, '')), 40), ''); own record; tdev uuid; is_owner boolean; r jsonb; seen record; co text;
        allowed text; pick jsonb; lk boolean; mine boolean := true; note text;
begin
  if f is null then raise exception 'not allowed'; end if;
  -- the same posting again: the core decides, by 36b's rules, and never moves it to another computer key
  if exists (select 1 from tally_post_jobs j where j.id = p_id) then
    r := tally_post_enqueue_core(p_id, p_client, p_payload, null, null);
    return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
  end if;
  -- no Tally company for the client, or not the one it may post to: the core's own words (nothing queued)
  select t2.company into co from tally_companies t2 where t2.firm_id = f and t2.client_id = p_client and t2.device_id is not null order by t2.last_seen desc nulls last limit 1;
  allowed := tally_link_post_to(f, p_client, co);
  if co is null or allowed is null or lower(tally_nm(allowed)) <> lower(tally_nm(co)) then
    return tally_post_enqueue_core(p_id, p_client, p_payload, null, null) || jsonb_build_object('target', null); end if;
  is_owner := exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true));
  select mb.device_id, mb.bridge_id into own from tally_member_bridges mb where mb.firm_id = f and mb.user_id = auth.uid() and mb.bridge_id is not null;
  if t is null then
    -- 9a: the poster's own bridge: the linked one (when it may post, is still bound to the linked computer, and has the
    -- company open or no other own bridge has it), else the newest of their own that may post with the company open
    lk := own.bridge_id is not null and own.device_id is not null and tally_bridge_device(f, own.bridge_id) is not distinct from own.device_id
          and tally_bridge_may_post(own.device_id, own.bridge_id);
    pick := tally_post_own_bridge(f, co, auth.uid());
    if lk and (pick is null or tally_bridge_has_open(own.device_id, own.bridge_id, co)) then
      t := own.bridge_id; tdev := own.device_id;
    elsif pick is not null then
      tdev := (pick ->> 'device')::uuid; t := pick ->> 'bridge';
    else
      return jsonb_build_object('ok', false, 'company', co, 'error', tally_post_own_words(f, co, auth.uid()));
    end if;
  else
    tdev := tally_bridge_device(f, t);
    mine := tally_bridge_is_own(f, auth.uid(), tdev, t);
    if not mine and not is_owner then
      return jsonb_build_object('ok', false, 'error', 'Only an owner of the firm can post through another bridge than your own.'); end if;
    if tdev is null then
      return jsonb_build_object('ok', false, 'error', 'FinCom has not heard from that bridge on any of the firm''s computers; nothing was queued.'); end if;
    -- review M3: named with its computer, the one the bridge id is bound to
    if p_device is null or p_device <> tdev then
      return jsonb_build_object('ok', false, 'error', 'That bridge is not on the computer named; nothing was queued. Refresh the Tally page and choose it again.'); end if;
    if tally_bridge_changes_only_on(tdev, t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge is set to changes only: it reads Tally''s changes and never posts. Nothing was queued.'); end if;
    if not tally_bridge_may_post(tdev, t) then
      return jsonb_build_object('ok', false, 'error', 'That bridge only reads Tally: another bridge of the same Windows user is the main one on its computer. Nothing was queued.'); end if;
  end if;
  -- 9b: not heard from for more than 3 minutes: queued all the same; the bridge takes it when it is back
  if t is not null then
    select d.info -> 'bridges' -> t ->> 'at' as at, d.info -> 'bridges' -> t ->> 'user' as u into seen from tally_devices d where d.id = tdev;
    if coalesce(seen.at, '') !~ '^\d{4}-\d\d-\d\dT' or seen.at::timestamptz < now() - interval '3 minutes' then
      note := 'Queued: waits for ' || case when mine then 'your' else 'the' end || ' FinCom Bridge on ' || tally_bridge_words(tdev, t) || ' (not heard from since '
        || coalesce(to_char(case when coalesce(seen.at, '') ~ '^\d{4}-\d\d-\d\dT' then seen.at::timestamptz end at time zone 'Asia/Kolkata', 'DD-Mon-YYYY HH24:MI') || ' IST', 'it was set up')
        || '); it is posted as soon as that bridge is back. If it does not come back by itself, start it there (sign in to Windows' || coalesce(' as ' || nullif(seen.u, ''), '') || ').';
    end if;
  end if;
  r := tally_post_enqueue_core(p_id, p_client, p_payload, tdev, t);
  if note is not null and coalesce((r ->> 'ok')::boolean, false) then
    update tally_post_jobs set message = left(note, 300) where id = p_id and firm_id = f and status = 'waiting';
    r := r || jsonb_build_object('note', note);
  end if;
  return r || jsonb_build_object('target', (select j.target_bridge from tally_post_jobs j where j.id = p_id and j.firm_id = f));
end $function$;
revoke all on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) from public, anon;
grant execute on function public.tally_post_enqueue_to(uuid, text, jsonb, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- 8. backfill: today's links into the record
-- every company linked today (tally_companies.client_id) to a client of the firm that is not deleted: one record,
-- posting allowed (the owner's decision of 26-Oct-2026: linking allows posting), how = backfill. A GUID two linked
-- companies share is kept on the latest seen only (the other keeps its link without a GUID; counted). Nothing deleted;
-- a record already there is left as it is (a second run adds nothing). What the old places said is counted: clients
-- whose clients.data postTo was not confirmed (now allowed), stopped by a person (now allowed), naming a company not
-- linked to them, or set with no link at all (nothing to post into; unchanged)
do $$
declare n0 bigint; k jsonb;
begin
  select count(*) into n0 from tally_links;
  with src as (
    select c.firm_id, c.book_id, c.client_id, c.company, nullif(c.gstin, '') as gstin, c.device_id, c.linked_by,
           coalesce(c.linked_at, c.first_seen, now()) as linked_at, c.last_seen, tally_link_guid(c.firm_id, c.company, c.book_id) as g
      from tally_companies c join clients cl on cl.firm_id = c.firm_id and cl.id = c.client_id and not coalesce(cl.deleted, false)
     where c.client_id is not null
  ), ranked as (
    select s.*, row_number() over (partition by s.firm_id, s.g order by s.last_seen desc nulls last, s.company) as rn from src s
  )
  insert into tally_links (firm_id, book_id, client_id, company_guid, company_name, gstin, device_id, computer, posting_allowed, state,
                           linked_by, linked_at, updated_by, updated_at, version, how)
  select r.firm_id, r.book_id, r.client_id,
         case when r.g is not null and r.rn = 1
               and not exists (select 1 from tally_links x where x.firm_id = r.firm_id and x.company_guid = r.g and x.state = 'linked') then r.g end,
         r.company, r.gstin, r.device_id, (select coalesce(nullif(d.info ->> 'computer', ''), d.name) from tally_devices d where d.id = r.device_id),
         true, 'linked', r.linked_by, r.linked_at, null, now(), 1, 'backfill'
    from ranked r
  on conflict (firm_id, book_id) do nothing;

  with lk as (select l.firm_id, l.client_id, l.company_name from tally_links l where l.state = 'linked'),
       cl as (select c.firm_id, c.id, coalesce(c.data -> 'choices' -> 'postTo' ->> 'state', case when coalesce(btrim(c.data ->> 'postTo'), '') <> '' then 'old' else '' end) as st,
                     btrim(coalesce(c.data -> 'choices' -> 'postTo' ->> 'value', c.data ->> 'postTo', '')) as val
                from clients c where not coalesce(c.deleted, false))
  select jsonb_build_object(
    'linked_in_tally_companies', (select count(*) from tally_companies where client_id is not null),
    'linked_to_deleted_or_missing_client', (select count(*) from tally_companies c where c.client_id is not null
        and not exists (select 1 from clients x where x.firm_id = c.firm_id and x.id = c.client_id and not coalesce(x.deleted, false))),
    'records_added_now', (select count(*) from tally_links) - n0,
    'records_linked', (select count(*) from tally_links where state = 'linked'),
    'records_with_guid', (select count(*) from tally_links where state = 'linked' and company_guid is not null),
    'records_without_guid', (select count(*) from tally_links where state = 'linked' and company_guid is null),
    'records_sharing_a_guid_kept_without', (select count(*) from (select firm_id, tally_link_guid(firm_id, company_name, book_id) as g from tally_links where state = 'linked' and company_guid is null) z
        where z.g is not null and exists (select 1 from tally_links y where y.firm_id = z.firm_id and y.company_guid = z.g and y.state = 'linked')),
    'clients_linked', (select count(distinct (firm_id, client_id)) from lk),
    'clients_posting_allowed', (select count(distinct (firm_id, client_id)) from tally_links where state = 'linked' and posting_allowed),
    'postto_not_confirmed_now_allowed', (select count(*) from cl where exists (select 1 from lk where lk.firm_id = cl.firm_id and lk.client_id = cl.id) and cl.st <> 'confirmed'),
    'postto_stopped_by_a_person_now_allowed', (select count(*) from cl where exists (select 1 from lk where lk.firm_id = cl.firm_id and lk.client_id = cl.id) and cl.st = 'confirmed' and cl.val = ''),
    'postto_names_a_company_not_linked', (select count(*) from cl where cl.val <> '' and exists (select 1 from lk where lk.firm_id = cl.firm_id and lk.client_id = cl.id)
        and not exists (select 1 from lk where lk.firm_id = cl.firm_id and lk.client_id = cl.id and lower(tally_nm(lk.company_name)) = lower(tally_nm(cl.val)))),
    'postto_set_without_any_link', (select count(*) from cl where cl.val <> '' and not exists (select 1 from lk where lk.firm_id = cl.firm_id and lk.client_id = cl.id))
  ) into k;
  insert into tally_links_backfill (counts) values (k);
  raise notice 'tally_links backfill: %', k;
end $$;

commit;
