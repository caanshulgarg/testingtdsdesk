-- migration 162 (next-gst-big, 11-Nov-2026): a large book's entries made once for gst-run.
-- Why: gst-run (server/gst-run) works a client's GSTR-3B out in the cloud a month or two a run, within an edge function's
-- 2 s of CPU. On a book of 40,000 entries reading its rows (gst_calc_rows, migration 153) and making the entries of them
-- took 1.3 to 1.7 s, so every run gave up ("too big") and the page worked the months out in the browser. Now a run that
-- passes its budget on the book's rows keeps the entries it made of them (BookSrc.fromCopy's list, as JSON text) here,
-- on the book's version (tally_calc_version, migration 152) and gst-run's engine; the next runs read that one answer
-- instead of the rows (about 0.3 s) and have the time for a month. Any change to the book moves its version, and a new
-- engine has another name: the entries kept are then not given (null) and a run makes them again.
--   gst_calc_prep                      one row a book: version, engine, the entries (text). RLS on, no member grant.
--   gst_calc_prep_get(book, version, engine)   the entries as kept (json, the text unchanged), only on that version and
--                                      engine; else null. Service role only.
--   gst_calc_prep_put(book, version, engine, entries)   keep them (the book's own firm), replacing the book's earlier
--                                      ones; false when the book is not there or the text is not a JSON list. Service role
--                                      only.
-- Add-only: one new table and two functions; nothing dropped, altered or deleted. Needs migrations 152 and 153 (stops
-- and says so otherwise). A book deleted takes its row with it.
begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regprocedure('public.tally_calc_version(uuid)') is null or to_regclass('public.gst_calc_queue') is null then
    raise exception 'migration 162 needs migrations 152 and 153 (tally_calc_version, gst_calc_queue) to be run first';
  end if;
end $$;

create table if not exists public.gst_calc_prep (
  book_id  uuid primary key references public.tally_books (book_id) on delete cascade,
  firm_id  uuid not null,
  version  text not null,
  engine   text not null,
  vouchers text not null,
  at       timestamptz not null default now()
);
alter table public.gst_calc_prep enable row level security;
revoke all on public.gst_calc_prep from public, anon, authenticated;
grant select, insert, update, delete on public.gst_calc_prep to service_role;

create or replace function public.gst_calc_prep_get(p_book uuid, p_version text, p_engine text)
returns json language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select p.vouchers::json from gst_calc_prep p where p.book_id = p_book and p.version = p_version and p.engine = p_engine;
$function$;

create or replace function public.gst_calc_prep_put(p_book uuid, p_version text, p_engine text, p_vouchers text)
returns boolean language plpgsql volatile security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid;
begin
  select b.firm_id into f from tally_books b where b.book_id = p_book;
  if f is null or coalesce(p_version, '') = '' or coalesce(p_engine, '') = '' or left(ltrim(coalesce(p_vouchers, '')), 1) <> '[' then return false; end if;
  insert into gst_calc_prep (book_id, firm_id, version, engine, vouchers, at) values (p_book, f, p_version, p_engine, p_vouchers::json::text, now())
    on conflict (book_id) do update set firm_id = excluded.firm_id, version = excluded.version, engine = excluded.engine, vouchers = excluded.vouchers, at = now();
  return true;
end;
$function$;

revoke all on function public.gst_calc_prep_get(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gst_calc_prep_get(uuid, text, text) to service_role;
revoke all on function public.gst_calc_prep_put(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.gst_calc_prep_put(uuid, text, text, text) to service_role;

commit;
