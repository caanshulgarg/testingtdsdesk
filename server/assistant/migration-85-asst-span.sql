-- Migration 85 (14-Oct-2026, branch next-fix-asst-turn; Sentry FINCOM-CLOUD-STAGING-1). Staging only until the owner says
-- otherwise. Number 85: 84 is the assistant-upload branch's.
--
-- Why: every FinCom Assistant book tool failed on staging with "permission denied for function tally_pick". The book tools
-- run as the signed-in user (SECURITY INVOKER) and all find the client's book through asst_span (migration 77), which
-- called tally_pick; the security review's migration-3-phase2 had revoked EXECUTE on tally_pick from signed-in users
-- (it was then called only from SECURITY DEFINER functions). The question "Which suppliers crossed 30,000 under 194C
-- without TDS this year?" therefore never reached its table: the tool's error sent it on to the model, which then failed too.
--
-- What it changes: ONE function, asst_span, replaced with the same arguments, result and rules, picking the book with
-- tally_pick's own query inline instead of calling it. It stays SECURITY INVOKER and STABLE (as every asst_* reader):
-- the read of tally_books is under its row-level security AND filtered to firm_id = my_firm() as tally_pick did, so a
-- member of another firm still gets no book. tally_pick's privileges are not touched (the security review stands).
-- No table, column, row or grant is changed; safe to run twice; one transaction (lock_timeout 10 s).
-- Tested: tests/run_assistant_sql.py and tests/run_assistant_agent.py (the stand now revokes tally_pick as staging does).
begin;
set local lock_timeout = '10s';

create or replace function public.asst_span(p_client text, p_from date, p_to date, out bk uuid, out d_from date, out d_to date, out company text)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare b public.tally_books%rowtype; last date; f uuid := my_firm(); on_day date := coalesce(p_to, p_from);
begin
  -- the book for the last date asked for (tally_pick's rule: the caller's firm only, a book with a start, open by that
  -- date, the latest that starts on or before it), else the client's latest book
  select t.book_id into bk from tally_books t
   where t.client_id = p_client and t.firm_id = f and t.from_date is not null and (on_day is null or t.open_as_on <= on_day)
   order by (t.from_date <= coalesce(on_day, t.from_date)) desc, t.from_date desc limit 1;
  if bk is null then
    select t.book_id into bk from tally_books t
     where t.client_id = p_client and t.firm_id = f and t.from_date is not null
     order by t.from_date desc limit 1;
  end if;
  if bk is null then return; end if;
  select * into b from tally_books t where t.book_id = bk;
  select max(v.day) into last from tally_vouchers v where v.book_id = bk;
  d_to := coalesce(p_to, last, (now() at time zone 'Asia/Kolkata')::date);
  d_from := coalesce(p_from, make_date(extract(year from d_to)::int - case when extract(month from d_to) < 4 then 1 else 0 end, 4, 1));
  if b.from_date is not null and d_from < b.from_date then d_from := b.from_date; end if;
  company := b.company;
end $$;

commit;
