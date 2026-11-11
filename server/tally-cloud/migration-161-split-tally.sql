-- Migration 161 (11-Nov-2026, branch next-split-years; written, NOT run: the owner reads it and runs it).
-- A SPLIT Tally: the same business's books cut into two Tally companies by date ("X PVT LTD - (from 1-Apr-2021)" holding
-- the years up to 2024-25, "X PVT LTD - (from 1-Apr-25)" from 2025-26; on staging both keep the same Tally company GUID).
-- They are ONE FinCom client: the client keeps its CURRENT company (linked as before, the only one posted into) and may
-- have ONE earlier-years company beside it, with the day its years end. FinCom's browser joins the two books (src/js/49,
-- app/src/lib/splitBooks.js); nothing here reads or changes an entry.
--
-- Why not tally_link_set: the two companies share one GUID, and a GUID is linked once (tally_links_guid_once); linking the
-- earlier company the usual way is taken for a rename of the current one (tally_link_move_name, refused because the
-- earlier company holds books of its own). So the earlier company gets its own record here, written like
-- tally_link_write writes one: posting never allowed, the GUID left off when the current company holds it, the mirror
-- (tally_companies.client_id, tally_books.client_id) set so tally-ingest reads it as any linked company (tally_book_for):
-- its days come only when a person asks for a year (tally_period_choose on its book, as for any book).
--
--   1. public.tally_split_links (firm_id, book_id) primary key: client_id, current_book (the client's current company
--      when linked), ends_on (the earlier company's last day), state linked | unlinked, who and when, version. One live
--      row a client (a unique index). RLS: members read their firm's rows; no direct writes.
--   2. tally_split_link(p_company, p_client, p_ends) -> jsonb (members who may write, can_write()): the client must
--      have a current company linked; the company must have been reported by a computer of the firm, be the client's
--      (GSTIN's PAN as tally_link_set), not linked to another client, not the current company itself, not another live
--      link of a GUID another client holds; a client has at most one earlier-years company (another one: refused until it
--      is unlinked). The same company again: its end day changed. A row whose company is no longer linked to its client
--      (unlinked the usual way, or its client removed: migration 128) has ended: marked unlinked here, never shown.
--   3. tally_split_unlink(p_book) -> jsonb (members who may write): the earlier company unlinked (tally_link_write with
--      no client: the record, its mirror), the row unlinked; the client is back to its current company alone.
--   4. tally_split_of(p_client) -> jsonb (any member): the client's earlier-years company while its record is linked to
--      the client: {book, company, ends, from, currentBook, currentCompany, curFrom, live (the current company still
--      linked to the client), version}; null when none. (Its body, tally_split_of_firm, for the service role only.)
--   5. tally_post_enqueue_core (migration 116's text, the same arguments and grants): the company a posting is checked
--      against is the client's most recently seen company that is NOT its earlier-years one.
-- ADD-ONLY: one table, one index, four new functions; one existing function replaced with the same arguments and grants
-- (tally_post_enqueue_core: one line added); no table, row or policy changed; safe to run twice;
-- one transaction, lock_timeout 10 s. Grants explicit: service_role all; authenticated select on the table (RLS) and
-- execute on the three member functions; anon nothing. Tested on pg_stand: tests/run_migration161.py.
-- Deploy order: this file, then the app build of next-split-years (without it the app offers no "Earlier years").
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the earlier-years companies
create table if not exists public.tally_split_links (
  firm_id      uuid not null references public.firms(id) on delete cascade,
  book_id      uuid not null,
  client_id    text not null,
  current_book uuid not null,
  ends_on      date not null,
  state        text not null default 'linked' check (state in ('linked', 'unlinked')),
  linked_by    uuid,
  linked_at    timestamptz not null default now(),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  version      bigint not null default 1,
  primary key (firm_id, book_id)
);
create unique index if not exists tally_split_links_one on public.tally_split_links (firm_id, client_id) where state = 'linked';
alter table public.tally_split_links enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_split_links' and policyname = 'tally_split_links_read') then
    create policy tally_split_links_read on public.tally_split_links for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_split_links from public, anon, authenticated;
grant select on public.tally_split_links to authenticated;
grant all on public.tally_split_links to service_role;

-- ---------------------------------------------------------------- 2. link the earlier-years company
create or replace function public.tally_split_link(p_company text, p_client text, p_ends date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); c tally_companies%rowtype; cg text; cur tally_links%rowtype; o tally_links%rowtype; s tally_split_links%rowtype;
        g text; gg text; nm text; pc text; r tally_links%rowtype; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || f::text));
  if p_ends is null or p_ends < date '2000-04-01' or p_ends >= today then
    return jsonb_build_object('ok', false, 'error', 'Give the last day of the earlier company''s years (a day before today).');
  end if;
  select * into c from tally_companies where firm_id = f and company = p_company;
  if not found then return jsonb_build_object('ok', false, 'error', 'No computer has reported ' || coalesce(p_company, '') || ' yet; open it in Tally on a connected computer first.'); end if;
  select cl.gstin into cg from clients cl where cl.id = p_client and cl.firm_id = f and not coalesce(cl.deleted, false);
  if not found then return jsonb_build_object('ok', false, 'error', 'No such client.'); end if;
  if coalesce(cg, '') <> '' and coalesce(c.gstin, '') <> '' and upper(substr(cg, 3, 10)) <> upper(substr(c.gstin, 3, 10)) then
    return jsonb_build_object('ok', false, 'error', 'The GSTIN of ' || p_company || ' in Tally (' || c.gstin || ') is not this client''s (' || cg || ').');
  end if;
  -- the client's current company: its linked company that is not an earlier-years one, the latest books first
  select l.* into cur from tally_links l left join tally_books b on b.book_id = l.book_id
   where l.firm_id = f and l.client_id = p_client and l.state = 'linked' and l.book_id <> c.book_id
     and not exists (select 1 from tally_split_links x where x.firm_id = f and x.book_id = l.book_id and x.state = 'linked')
   order by l.posting_allowed desc, b.from_date desc nulls last, l.linked_at desc nulls last limit 1;
  if cur.book_id is null then return jsonb_build_object('ok', false, 'error', 'Link the client''s current company in Tally first; then add its earlier years.'); end if;
  -- never another client's company
  select * into o from tally_links where firm_id = f and book_id = c.book_id and state = 'linked';
  if o.book_id is not null and o.client_id <> p_client then
    select cl.name into nm from clients cl where cl.firm_id = f and cl.id = o.client_id;
    return jsonb_build_object('ok', false, 'error', p_company || ' is linked to ' || coalesce(nm, 'another client') || '.');
  end if;
  -- a row whose company is no longer linked to its client (unlinked, moved, or the client removed: migration 128) has ended
  update tally_split_links x set state = 'unlinked', updated_by = auth.uid(), updated_at = now(), version = x.version + 1
   where x.firm_id = f and x.client_id = p_client and x.state = 'linked'
     and not exists (select 1 from tally_links l where l.firm_id = f and l.book_id = x.book_id and l.state = 'linked' and l.client_id = x.client_id);
  -- one earlier-years company a client
  select * into s from tally_split_links where firm_id = f and client_id = p_client and state = 'linked' and book_id <> c.book_id limit 1;
  if s.book_id is not null then
    select company_name into nm from tally_links where firm_id = f and book_id = s.book_id;
    return jsonb_build_object('ok', false, 'error', 'This client''s earlier years come from ' || coalesce(nm, 'another company') || ' already; unlink that first.');
  end if;
  -- the GUID: kept on this record unless another linked company holds it (the split's current company does, on staging);
  -- a GUID another CLIENT holds: refused, as tally_link_write
  g := tally_link_guid(f, c.company, c.book_id); gg := g;
  if g is not null then
    o := null;
    select * into o from tally_links where firm_id = f and state = 'linked' and company_guid = g and book_id <> c.book_id limit 1;
    if o.book_id is not null and o.client_id <> p_client then
      select cl.name into nm from clients cl where cl.firm_id = f and cl.id = o.client_id;
      return jsonb_build_object('ok', false, 'error', 'The same company in Tally is linked to ' || coalesce(nm, 'another client') || '.');
    end if;
    if o.book_id is not null then gg := null; end if;
  end if;
  select coalesce(nullif(d.info ->> 'computer', ''), d.name) into pc from tally_devices d where d.id = c.device_id;
  insert into tally_links as l (firm_id, book_id, client_id, company_guid, company_name, gstin, device_id, computer, posting_allowed, state,
                                linked_by, linked_at, updated_by, updated_at, version, how)
  values (f, c.book_id, p_client, gg, c.company, nullif(c.gstin, ''), c.device_id, pc, false, 'linked', auth.uid(), now(), auth.uid(), now(), 1, 'person')
  on conflict (firm_id, book_id) do update set
    company_guid = excluded.company_guid, company_name = excluded.company_name, gstin = coalesce(excluded.gstin, l.gstin),
    device_id = coalesce(excluded.device_id, l.device_id), computer = coalesce(excluded.computer, l.computer),
    posting_allowed = false,
    linked_by = case when l.state = 'linked' and l.client_id = excluded.client_id then l.linked_by else excluded.linked_by end,
    linked_at = case when l.state = 'linked' and l.client_id = excluded.client_id then l.linked_at else excluded.linked_at end,
    data_loc = case when l.state = 'linked' and l.client_id = excluded.client_id then l.data_loc end,
    data_folder = case when l.state = 'linked' and l.client_id = excluded.client_id then l.data_folder end,
    client_id = excluded.client_id, state = 'linked', how = 'person', updated_by = excluded.updated_by, updated_at = now(), version = l.version + 1
  returning * into r;
  -- the mirror, as tally_link_write writes it (the triggers of migration 110 told it is the link functions' own write)
  perform set_config('fincom.tally_link', 'on', true);
  update tally_companies set client_id = p_client, linked_at = coalesce(case when client_id = p_client then linked_at end, now()), linked_by = coalesce(case when client_id = p_client then linked_by end, auth.uid())
   where firm_id = f and book_id = c.book_id;
  insert into tally_books (book_id, firm_id, client_id, company) values (c.book_id, f, p_client, c.company)
  on conflict (book_id) do update set client_id = excluded.client_id;
  perform set_config('fincom.tally_link', 'off', true);
  insert into tally_split_links as x (firm_id, book_id, client_id, current_book, ends_on, state, linked_by, linked_at, updated_by, updated_at, version)
  values (f, c.book_id, p_client, cur.book_id, p_ends, 'linked', auth.uid(), now(), auth.uid(), now(), 1)
  on conflict (firm_id, book_id) do update set client_id = excluded.client_id, current_book = excluded.current_book, ends_on = excluded.ends_on, state = 'linked',
    linked_by = case when x.state = 'linked' and x.client_id = excluded.client_id then x.linked_by else excluded.linked_by end,
    linked_at = case when x.state = 'linked' and x.client_id = excluded.client_id then x.linked_at else excluded.linked_at end,
    updated_by = excluded.updated_by, updated_at = now(), version = x.version + 1;
  return jsonb_build_object('ok', true, 'split', tally_split_of_firm(f, p_client));
end $function$;

-- ---------------------------------------------------------------- 3. unlink it: the client is back to its current company alone
create or replace function public.tally_split_unlink(p_book uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm(); s tally_split_links%rowtype; l tally_links%rowtype;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('tally_links:' || f::text));
  select * into s from tally_split_links where firm_id = f and book_id = p_book and state = 'linked' for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'This company is not linked as a client''s earlier years.'); end if;
  select * into l from tally_links where firm_id = f and book_id = p_book;
  -- the record and its mirror unlinked only while they are still this client's (a link made since stays)
  if l.book_id is not null and l.state = 'linked' and l.client_id = s.client_id then
    perform tally_link_write(f, p_book, null, auth.uid(), 'person');
  end if;
  update tally_split_links set state = 'unlinked', updated_by = auth.uid(), updated_at = now(), version = version + 1 where firm_id = f and book_id = p_book;
  return jsonb_build_object('ok', true, 'client', s.client_id);
end $function$;

-- ---------------------------------------------------------------- 4. a client's earlier-years company
-- the row while its earlier company's record is still linked to the client; live: the current company is linked to the
-- client too (only then are the two joined)
create or replace function public.tally_split_of_firm(p_firm uuid, p_client text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select jsonb_build_object('book', s.book_id, 'company', e.company_name, 'ends', to_char(s.ends_on, 'YYYYMMDD'),
           'from', (select to_char(b.from_date, 'YYYYMMDD') from tally_books b where b.book_id = s.book_id),
           'currentBook', s.current_book, 'currentCompany', c.company_name,
           'curFrom', (select to_char(b.from_date, 'YYYYMMDD') from tally_books b where b.book_id = s.current_book),
           'live', coalesce(c.state = 'linked' and c.client_id = s.client_id, false), 'version', s.version)
    from tally_split_links s
    join tally_links e on e.firm_id = s.firm_id and e.book_id = s.book_id and e.state = 'linked' and e.client_id = s.client_id
    left join tally_links c on c.firm_id = s.firm_id and c.book_id = s.current_book
   where s.firm_id = p_firm and s.client_id = p_client and s.state = 'linked'
   limit 1
$function$;
create or replace function public.tally_split_of(p_client text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare f uuid := my_firm();
begin
  if f is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return tally_split_of_firm(f, p_client);
end $function$;

-- ---------------------------------------------------------------- 5. the posting check: the CURRENT company only
-- migration 116's tally_post_enqueue_core (as on staging), one line added: the company a posting is checked against is
-- the client's most recently seen company that is not its earlier-years one (opening the earlier company in Tally last
-- must not make every posting "may post only to <current>, but its books come from <earlier>"); every other line and
-- grant as 116's
create or replace function public.tally_post_enqueue_core(p_id uuid, p_client text, p_payload jsonb, p_device uuid, p_target text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); c record; n int; dup text; allowed text; cname text; j record; dev uuid; rr jsonb;
begin
  if f is null then raise exception 'not allowed'; end if;
  if not can_write() then raise exception 'Only the firm''s owner or staff can post to Tally.' using errcode = '42501'; end if;
  select t.company, t.device_id into c from tally_companies t
   where t.firm_id = f and t.client_id = p_client and t.device_id is not null
     and not exists (select 1 from tally_split_links x where x.firm_id = f and x.book_id = t.book_id and x.client_id = p_client and x.state = 'linked')
   order by t.last_seen desc nulls last limit 1;
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

revoke all on function public.tally_split_link(text, text, date), public.tally_split_unlink(uuid), public.tally_split_of(text) from public, anon;
grant execute on function public.tally_split_link(text, text, date), public.tally_split_unlink(uuid), public.tally_split_of(text) to authenticated, service_role;
revoke all on function public.tally_split_of_firm(uuid, text) from public, anon, authenticated;
grant execute on function public.tally_split_of_firm(uuid, text) to service_role;

commit;
