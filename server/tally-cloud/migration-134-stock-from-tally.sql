-- Migration 134 (30-Oct-2026, branch bridge-stock-2411, with FinCom Bridge 2.5.1; NOT run on staging: the owner reads it
-- and runs it). The stock from Tally, only when a person clicks (the owner's decision of 30-Oct-2026, "1").
--
-- On the Financial statements' stock panel a person clicks "Bring stock from Tally" (or "Ask Tally again"): tally-ingest
-- ({kind:"wake", what:"stock", client, from, to, again}) records the click here and wakes the Tally computer; the bridge asks
-- Tally once (FinComStockInHand: the Stock-in-Hand group's opening and closing for the period, 2 s at most) and sends the
-- answer ({kind:"stock", ...}), kept here per book and period. The panel reads it: "Opening stock Rs X . Closing stock
-- Rs Y . from Tally at 15:42". At most one request per book and period: a kept answer is shown again without asking
-- Tally; "Ask Tally again" asks once more; a click while one is on its way (60 s) asks nothing more.
--
-- ADD-ONLY: one new table and two new functions; no table altered, nothing dropped, no row deleted; safe to run twice; one
-- transaction, lock_timeout 10 s. Grants explicit: service_role (tally-ingest) reads and writes the table and runs the two
-- functions; authenticated reads its own firm's rows only (row security, my_firm()); anon nothing.
--
--   tally_stock_reads: one row per book and period: the last click (asked_at, by, its time as sent to the bridge), what
--     came of it (status: asked, ok, slow, busy, notopen, none, failed; the plain words), and Tally's last answer (opening
--     and closing stock as positive figures, read_at, its time and Tally's window hold); a later failure keeps the last
--     answer's figures and time.
--   tally_stock_ask(firm, book, from, to, again, user): the click: {ask: true, at} when the bridge is to be woken; {ask:
--     false, cached: true} when an answer is kept and again is not asked; {ask: false, pending: true} while a click is on
--     its way (60 s); the row in each answer.
--   tally_stock_answer(firm, book, from, to, at, status, opening, closing, read_at, ms, hold_ms, words): the bridge's
--     answer to that click (its time must be the row's, the row still waiting for it): kept; an answer to no click FinCom
--     sent, or a second answer to the same click, is refused.
--
-- Deploy: this file first, then tally-ingest (it answers "not set up yet" for a stock click until this has run), then the
-- app. Tested on pg_stand: tests/run_migration134.py; tally-ingest: tests/run_stock_ingest.py.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. the stock read from Tally, per book and period
create table if not exists public.tally_stock_reads (
  book_id     uuid not null references public.tally_books(book_id) on delete restrict,
  firm_id     uuid not null,
  period_from date not null,
  period_to   date not null,
  status      text not null default 'asked' check (status in ('asked', 'ok', 'slow', 'busy', 'notopen', 'none', 'failed')),
  words       text not null default '',
  opening     numeric(18,2),
  closing     numeric(18,2),
  read_at     timestamptz,
  ms          integer,
  hold_ms     integer,
  asked_at    timestamptz not null default now(),
  asked_by    uuid,
  click_at    text not null default '',
  updated_at  timestamptz not null default now(),
  primary key (book_id, period_from, period_to),
  check (period_from <= period_to)
);
alter table public.tally_stock_reads enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tally_stock_reads' and policyname = 'tally_stock_reads_read') then
    create policy tally_stock_reads_read on public.tally_stock_reads for select to authenticated using (firm_id = public.my_firm());
  end if;
end $$;
revoke all on public.tally_stock_reads from public, anon, authenticated;
grant select on public.tally_stock_reads to authenticated;
grant select, insert, update on public.tally_stock_reads to service_role;

-- ---------------------------------------------------------------- 2. the click
create or replace function public.tally_stock_ask(p_firm uuid, p_book uuid, p_from date, p_to date, p_again boolean, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r public.tally_stock_reads; at text;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 731 then return jsonb_build_object('ok', false, 'error', 'Choose a period of two years at most.'); end if;
  if not exists (select 1 from public.tally_books b where b.book_id = p_book and b.firm_id = p_firm) then
    return jsonb_build_object('ok', false, 'error', 'no such book in this firm');
  end if;
  insert into public.tally_stock_reads (book_id, firm_id, period_from, period_to, status, asked_at)
    values (p_book, p_firm, p_from, p_to, 'asked', now() - interval '1 hour') on conflict do nothing;
  select * into r from public.tally_stock_reads where book_id = p_book and period_from = p_from and period_to = p_to for update;
  if r.status = 'ok' and not coalesce(p_again, false) then
    return jsonb_build_object('ok', true, 'ask', false, 'cached', true, 'row', to_jsonb(r));
  end if;
  if r.click_at <> '' and r.status = 'asked' and r.asked_at > now() - interval '60 seconds' then
    return jsonb_build_object('ok', true, 'ask', false, 'pending', true, 'row', to_jsonb(r));
  end if;
  at := to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
  update public.tally_stock_reads set status = 'asked', words = '', asked_at = now(), asked_by = p_user, click_at = at, updated_at = now()
   where book_id = p_book and period_from = p_from and period_to = p_to returning * into r;
  return jsonb_build_object('ok', true, 'ask', true, 'at', at, 'row', to_jsonb(r));
end $function$;
revoke all on function public.tally_stock_ask(uuid, uuid, date, date, boolean, uuid) from public, anon, authenticated;
grant execute on function public.tally_stock_ask(uuid, uuid, date, date, boolean, uuid) to service_role;

-- ---------------------------------------------------------------- 3. the bridge's answer to that click
create or replace function public.tally_stock_answer(p_firm uuid, p_book uuid, p_from date, p_to date, p_at text, p_status text,
  p_opening numeric, p_closing numeric, p_read_at timestamptz, p_ms integer, p_hold integer, p_words text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare r public.tally_stock_reads;
begin
  if auth.role() <> 'service_role' then raise exception 'not allowed' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('ok', 'slow', 'busy', 'notopen', 'none', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'not an answer FinCom takes');
  end if;
  if p_status = 'ok' and (p_opening is null or p_closing is null or p_read_at is null) then
    return jsonb_build_object('ok', false, 'error', 'an answer without its figures');
  end if;
  select * into r from public.tally_stock_reads where book_id = p_book and firm_id = p_firm and period_from = p_from and period_to = p_to for update;
  if not found or r.click_at = '' or r.click_at <> coalesce(p_at, '') then
    return jsonb_build_object('ok', false, 'unknown', true, 'error', 'no such click from FinCom');
  end if;
  if r.status <> 'asked' then
    return jsonb_build_object('ok', false, 'unknown', true, 'answered', true, 'error', 'this click was answered already');
  end if;
  if p_status = 'ok' then
    update public.tally_stock_reads set status = 'ok', words = '', opening = round(p_opening, 2), closing = round(p_closing, 2), read_at = p_read_at,
      ms = p_ms, hold_ms = p_hold, updated_at = now()
     where book_id = p_book and period_from = p_from and period_to = p_to returning * into r;
  else
    update public.tally_stock_reads set status = p_status, words = left(coalesce(p_words, ''), 300), ms = p_ms, hold_ms = p_hold, updated_at = now()
     where book_id = p_book and period_from = p_from and period_to = p_to returning * into r;
  end if;
  return jsonb_build_object('ok', true, 'row', to_jsonb(r));
end $function$;
revoke all on function public.tally_stock_answer(uuid, uuid, date, date, text, text, numeric, numeric, timestamptz, integer, integer, text) from public, anon, authenticated;
grant execute on function public.tally_stock_answer(uuid, uuid, date, date, text, text, numeric, numeric, timestamptz, integer, integer, text) to service_role;

commit;
