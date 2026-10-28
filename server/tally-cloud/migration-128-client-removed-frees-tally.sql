-- Migration 128 (28-Oct-2026, branch next-fix-clientremove; NOT run on staging: the owner reads it and runs it). A client
-- removed keeps no Tally company. Staging that day: the owner removed "Salesify Marketing LLP 2026-27" (clients.deleted)
-- and made a new client of the same name; the Tally company "Salesify Marketing LLP 2026-27" stayed linked to the removed
-- client (tally_companies.client_id, tally_links state linked), so the new client was never offered it and the Tally page
-- said "Linked to a client not on this computer".
--
-- ADD-ONLY: one new table, three new functions, one new trigger on public.clients; tally_link_set replaced with the same
-- arguments and grants (migration 110's text, one line added: the firm's links of removed clients are released first).
-- Nothing dropped, no row deleted, safe to run twice, one transaction, lock_timeout 10 s. Grants explicit: service_role
-- always; authenticated only select on the history (RLS: the member's own firm); anon nothing.
--
--   1. public.tally_link_history: every release (who, when, why, the company, the client it left, its name), kept.
--   2. tally_link_release_client(p_firm, p_client, p_by, p_why) (service role): every Tally company linked to the client
--      (the record tally_links, and tally_companies.client_id) is unlinked through tally_link_write (its mirror and books
--      follow; posting stopped), one history row each. The company is then free: any live client may link it (one click).
--   3. clients_release_tally (AFTER UPDATE OF deleted on public.clients): a client marked removed releases its companies
--      (who: auth.uid(); why: "client removed: <reason>"). Restoring the client links nothing by itself: the app offers the
--      companies it held (the history) for a one-click link again.
--   4. tally_link_release_removed(p_firm) (service role): every company still linked to a removed client of the firm is
--      released; tally_link_set calls it before a link, so a company held by a removed client is always free to link.
--   5. The data as it is: each firm's companies linked to removed clients are released now (why: "client removed earlier
--      (migration 128)"); the count in a NOTICE.
-- Deploy: this file only (tally-ingest and the app need no deploy for it; the app build of next-fix-clientremove shows
-- the same without it). Tested on pg_stand: tests/run_migration128.py.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the history
create table if not exists public.tally_link_history (
  id           bigserial primary key,
  firm_id      uuid not null references public.firms(id) on delete cascade,
  book_id      uuid,
  company_name text not null,
  client_id    text,
  client_name  text,
  action       text not null check (action in ('released')),
  why          text,
  by_user      uuid,
  at           timestamptz not null default now()
);
create index if not exists tally_link_history_client on public.tally_link_history (firm_id, client_id, at desc);
alter table public.tally_link_history enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_link_history' and policyname = 'tally_link_history_read') then
    create policy tally_link_history_read on public.tally_link_history for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_link_history from public, anon, authenticated;
grant select on public.tally_link_history to authenticated;
grant all on public.tally_link_history to service_role;
grant usage, select on sequence public.tally_link_history_id_seq to service_role;

-- ---------------------------------------------------------------- 2. release a client's companies
create or replace function public.tally_link_release_client(p_firm uuid, p_client text, p_by uuid, p_why text)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare b record; n integer := 0; nm text;
begin
  if p_firm is null or coalesce(p_client, '') = '' then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || p_firm::text));
  select cl.name into nm from clients cl where cl.firm_id = p_firm and cl.id = p_client;
  for b in
    select c.book_id, c.company from tally_companies c
     where c.firm_id = p_firm and (c.client_id = p_client
       or exists (select 1 from tally_links l where l.firm_id = p_firm and l.book_id = c.book_id and l.state = 'linked' and l.client_id = p_client))
     order by c.company
  loop
    perform tally_link_write(p_firm, b.book_id, null, p_by, 'person');
    insert into tally_link_history (firm_id, book_id, company_name, client_id, client_name, action, why, by_user)
    values (p_firm, b.book_id, b.company, p_client, nm, 'released', left(coalesce(nullif(btrim(p_why), ''), 'client removed'), 300), p_by);
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.tally_link_release_client(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.tally_link_release_client(uuid, text, uuid, text) to service_role;

-- ---------------------------------------------------------------- 4. every company of a removed client of the firm
create or replace function public.tally_link_release_removed(p_firm uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $function$
declare c record; n integer := 0;
begin
  for c in
    select distinct x.client_id from (
      select tc.client_id from tally_companies tc where tc.firm_id = p_firm and tc.client_id is not null
      union select l.client_id from tally_links l where l.firm_id = p_firm and l.state = 'linked'
    ) x join clients cl on cl.firm_id = p_firm and cl.id = x.client_id and coalesce(cl.deleted, false)
  loop
    n := n + tally_link_release_client(p_firm, c.client_id, null, 'client removed earlier (migration 128)');
  end loop;
  return n;
end $function$;
revoke all on function public.tally_link_release_removed(uuid) from public, anon, authenticated;
grant execute on function public.tally_link_release_removed(uuid) to service_role;

-- ---------------------------------------------------------------- 3. a client removed releases its companies
create or replace function public.clients_release_tally()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
begin
  if coalesce(new.deleted, false) and not coalesce(old.deleted, false) then
    perform tally_link_release_client(new.firm_id, new.id, auth.uid(),
      'client removed: ' || coalesce(nullif(btrim(to_jsonb(new) ->> 'delete_reason'), ''), 'removed in the app'));
  end if;
  return null;
end $function$;
revoke all on function public.clients_release_tally() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgrelid = 'public.clients'::regclass and tgname = 'clients_release_tally' and not tgisinternal) then
    create trigger clients_release_tally after update of deleted on public.clients for each row execute function public.clients_release_tally();
  end if;
end $$;

-- ---------------------------------------------------------------- tally_link_set: a removed client's company is free
create or replace function public.tally_link_set(p_company text, p_client text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); c tally_companies%rowtype; cg text; r tally_links%rowtype;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || f::text));
  -- migration 128: a company (or the same GUID) still held by a removed client is released first, so it is free to link
  perform tally_link_release_removed(f);
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

-- ---------------------------------------------------------------- 5. the data as it is
do $$
declare f record; n integer := 0;
begin
  for f in select distinct firm_id from tally_companies where client_id is not null
           union select distinct firm_id from tally_links where state = 'linked' loop
    n := n + tally_link_release_removed(f.firm_id);
  end loop;
  raise notice 'migration 128: % Tally compan(ies) released from removed clients', n;
end $$;

commit;
