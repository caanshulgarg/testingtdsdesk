-- after an independent review of the cloud copy (applied on staging as tally_cloud_hardening):
-- a company is linked only once a computer has reported it; its GSTIN (the PAN part) must be the client's, when linking
-- and every time data is sent; one ingest at a time per book; answers in a fixed order (pages cannot overlap);
-- a ledger within its book's period; the support bucket only for platform admins who have signed in with two steps

create or replace function public.tally_company_link(p_company text, p_client text)
returns void language plpgsql security definer set search_path = public as $$
declare f uuid := my_firm(); cg text; tg text;
begin
  if f is null or not can_write() then raise exception 'not allowed' using errcode = '42501'; end if;
  if not exists (select 1 from tally_companies where firm_id = f and company = p_company) then
    raise exception 'no computer has reported % yet; open it in Tally on a connected computer first', p_company;
  end if;
  if p_client is not null then
    select gstin into cg from clients where id = p_client and firm_id = f and not coalesce(deleted, false);
    if not found then raise exception 'no such client'; end if;
    select gstin into tg from tally_companies where firm_id = f and company = p_company;
    if coalesce(cg, '') <> '' and coalesce(tg, '') <> '' and upper(substr(cg, 3, 10)) <> upper(substr(tg, 3, 10)) then
      raise exception 'the GSTIN of % in Tally (%) is not this client''s (%)', p_company, tg, cg;
    end if;
  end if;
  update tally_companies set client_id = p_client, linked_at = now(), linked_by = auth.uid() where firm_id = f and company = p_company;
  update tally_books b set client_id = coalesce(p_client, '') from tally_companies c where c.firm_id = f and c.company = p_company and b.book_id = c.book_id;
end $$;

create or replace function public.tally_book_for(p_firm uuid, p_company text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c tally_companies%rowtype; cg text;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from tally_companies where firm_id = p_firm and company = p_company;
  if not found or c.client_id is null then return null; end if;
  select gstin into cg from clients where id = c.client_id and firm_id = p_firm and not coalesce(deleted, false);
  if not found then return null; end if;
  -- the company's GSTIN changed to someone else's since it was linked: nothing goes into this client
  if coalesce(cg, '') <> '' and coalesce(c.gstin, '') <> '' and upper(substr(cg, 3, 10)) <> upper(substr(c.gstin, 3, 10)) then return null; end if;
  insert into tally_books (book_id, firm_id, client_id, company) values (c.book_id, p_firm, c.client_id, p_company)
  on conflict (book_id) do update set client_id = excluded.client_id;
  return c.book_id;
end $$;

-- tally_ingest_day and tally_ingest_ledgers: as in migration.sql, with at the start
--   perform pg_advisory_xact_lock(hashtext(p_book::text));
-- and a repeated GUID (or ledger name) in one call taken once (distinct on, the highest change number)
-- tally_tb: order by the ledger; tally_ledger: returns 'to' (the book's last day), lines ordered by day, number, guid;
-- tally_monthly: from the book's own start, ordered
-- (the full text of these is in the staging migration tally_cloud_hardening)

drop policy if exists tally_support_admin_read on storage.objects;
create policy tally_support_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'tally-support' and public.is_superadmin());
