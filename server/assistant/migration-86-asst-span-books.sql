-- Migration 86 (14-Oct-2026, branch next-fix-asst-turn; Sentry FINCOM-CLOUD-STAGING-1, after 85). Staging only until the
-- owner says otherwise. Number 86: 84 is the assistant-upload branch's, 85 this branch's.
--
-- Why: after 85 the book tools ran on staging, but asst_span kept tally_pick's rule "from_date is not null". A book the
-- bridge filled without a start date (GB TEXCOAT: 863 entries) was invisible to every tool, and a book with nothing in it
-- (Master Cad: no entries, no ledgers) was taken as books held, so a tool answered an empty table as "checked".
--
-- What it changes: ONE function, asst_span, replaced with the same arguments and result:
--   1. the book: as before, the latest book with a start date open by the last date asked for; failing that, the client's
--      book with entries or ledgers, start date or not (the latest start first, then the latest entry);
--   2. a book with no entries and no ledgers is no book (bk null: the tools answer "none");
--   3. the dates: as asked; else to the last entry and from the start of its financial year; never before the book's
--      start date (as before), or, when it has none, its first entry.
-- Still SECURITY INVOKER and STABLE, the read of tally_books under its row-level security and filtered to
-- firm_id = my_firm(), so another firm's member gets no book. No table, column, row or grant is changed; safe to run
-- twice; one transaction (lock_timeout 10 s). Tested: tests/run_assistant_sql.py, tests/run_assistant_agent.py.
begin;
set local lock_timeout = '10s';

create or replace function public.asst_span(p_client text, p_from date, p_to date, out bk uuid, out d_from date, out d_to date, out company text)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare b public.tally_books%rowtype; first date; last date; f uuid := my_firm(); on_day date := coalesce(p_to, p_from);
begin
  -- the book for the last date asked for: the caller's firm only, a book with a start, open by that date, the latest
  -- that starts on or before it (tally_pick's rule)
  select t.book_id into bk from tally_books t
   where t.client_id = p_client and t.firm_id = f and t.from_date is not null and (on_day is null or t.open_as_on <= on_day)
   order by (t.from_date <= coalesce(on_day, t.from_date)) desc, t.from_date desc limit 1;
  -- the fallback: the client's book with entries or ledgers, with or without a start date
  if bk is null then
    select t.book_id into bk from tally_books t
     where t.client_id = p_client and t.firm_id = f
       and (exists (select 1 from tally_vouchers v where v.book_id = t.book_id) or exists (select 1 from tally_ledgers l where l.book_id = t.book_id))
     order by t.from_date desc nulls last, (select max(v.day) from tally_vouchers v where v.book_id = t.book_id) desc nulls last limit 1;
  end if;
  if bk is null then return; end if;
  select min(v.day), max(v.day) into first, last from tally_vouchers v where v.book_id = bk;
  -- an empty book is no book: the tools answer "none", never an empty table
  if last is null and not exists (select 1 from tally_ledgers l where l.book_id = bk) then bk := null; return; end if;
  select * into b from tally_books t where t.book_id = bk;
  d_to := coalesce(p_to, last, (now() at time zone 'Asia/Kolkata')::date);
  d_from := coalesce(p_from, make_date(extract(year from d_to)::int - case when extract(month from d_to) < 4 then 1 else 0 end, 4, 1));
  if coalesce(b.from_date, first) is not null and d_from < coalesce(b.from_date, first) then d_from := coalesce(b.from_date, first); end if;
  company := b.company;
end $$;

commit;
