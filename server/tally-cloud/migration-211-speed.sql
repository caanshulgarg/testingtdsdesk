-- Migration 211 (23-Nov-2026, branch next-speed-2): DRAFT, written, NOT run. The owner reads it and runs it on staging first.
-- Add-only: one function replaced in place with the same name, arguments, answer and rights; no table, column or row
-- changed. (If another branch has taken the number 211 by then, renumber this file; it depends on nothing after 2.)
-- What it does (the speed plan of 22-Nov-2026, #14):
--   tally_book_for (migration-2-hardening; the live staging text checked 23-Nov-2026 is the same) wrote its company's
--   tally_books row on EVERY call: "on conflict (book_id) do update set client_id = excluded.client_id", even when
--   client_id was already that. tally-ingest asks it on bridge beats (bookForBeat, at most every 5 minutes a company and
--   worker), and tally_books is in the Realtime publication, so each such no-change write went to every open FinCom page of
--   the firm as an UPDATE (the page then does nothing with it: days_at and ledgers_at are unchanged), plus a dead row and
--   WAL. Now the row is written only when client_id really changes ("where ... is distinct from"): the same book id comes
--   back, the same row is made when there is none, and a relinked client is written as before.
--
-- How to apply: as one query (one transaction; lock_timeout 3 s; safe twice):  sbq.sh server/tally-cloud/migration-211-speed.sql
-- Check after:  select pg_get_functiondef('public.tally_book_for(uuid,text)'::regprocedure) ~ 'is distinct from';

begin;
set local lock_timeout = '3s';

-- the guard: tally_book_for must be the function this file replaces (migration 2's, or this file's own on a second run);
-- anything else under that name stops the file before a change
do $names$
declare d text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tally_book_for' and p.oid = 'public.tally_book_for(uuid,text)'::regprocedure;
  if d is null then raise exception 'migration 211: public.tally_book_for(uuid, text) is not there. Nothing was changed.'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'tally_book_for') <> 1
     or position('insert into tally_books (book_id, firm_id, client_id, company)' in d) = 0
     or position('on conflict (book_id) do update set client_id = excluded.client_id' in d) = 0 then
    raise exception 'migration 211: public.tally_book_for is not the function this file replaces. Nothing was changed.';
  end if;
end $names$;

create or replace function public.tally_book_for(p_firm uuid, p_company text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare c tally_companies%rowtype; cg text;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  select * into c from tally_companies where firm_id = p_firm and company = p_company;
  if not found or c.client_id is null then return null; end if;
  select gstin into cg from clients where id = c.client_id and firm_id = p_firm and not coalesce(deleted, false);
  if not found then return null; end if;
  -- the company's GSTIN changed to someone else's since it was linked: nothing goes into this client
  if coalesce(cg, '') <> '' and coalesce(c.gstin, '') <> '' and upper(substr(cg, 3, 10)) <> upper(substr(c.gstin, 3, 10)) then return null; end if;
  -- migration 211: written only when the client really changes (a write with nothing new went to every open page)
  insert into tally_books (book_id, firm_id, client_id, company) values (c.book_id, p_firm, c.client_id, p_company)
  on conflict (book_id) do update set client_id = excluded.client_id where tally_books.client_id is distinct from excluded.client_id;
  return c.book_id;
end $$;
revoke all on function public.tally_book_for(uuid, text) from public, anon, authenticated;
grant execute on function public.tally_book_for(uuid, text) to service_role;
comment on function public.tally_book_for(uuid, text) is 'tally-ingest: the book of a linked company (migration 211: no write without a change)';

commit;
