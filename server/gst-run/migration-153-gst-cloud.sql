-- Migration 153 (09-Nov-2026, branch next-cloud-gst; written, NOT run: the owner reads it and runs it).
-- A month's GSTR-3B worked out in the cloud (the gst-run function) by the browser's own engine (server/_shared/gst3b.js,
-- the same file the app is built from), kept until something it is worked out from changes. The page never waits on it:
-- it reads what is kept (gst_calc_cached) and, when nothing current is kept, works the month out itself as today. The
-- store is filled in the background, a month or two per run of gst-run, each run starting from the credit carried in
-- that the month before left (kept).
--
-- Needs migration 151 (branch next-cloud-calc1) first: it reuses 151's table and functions, as they are:
--   tally_calc_results   one row per book, kind and arguments: here kind 'gst-3b', args '<state code>|<YYYYMM>' (e.g.
--                        '07|202510'), the result (every 3B box, the credit carried in and out, and the fingerprint of
--                        the inputs it was worked out from), the version, and how long it took. RLS on, members read
--                        their own firm's rows, written by the service role only (all in 151).
--   tally_calc_version   the book's own version (its days and ledgers times, entries, deletions, FinCom's ledger list).
-- What this adds (nothing dropped, deleted or altered; safe to run twice):
--   gst_calc_queue                    one row per client whose 3B store is to be filled: asked by a member (a miss), or by
--                                     a change (the triggers below); taken by gst-run's "warm" runs, one at a time; ran_at
--                                     keeps a client from being worked out again within 20 seconds. RLS on; no member
--                                     reads or writes it (service role only).
--   gst_calc_book(firm, client, ym)   the book a month is worked out on: tally_pick's rule (the latest book whose copy
--                                     starts by the month's last day), for a firm given. gst-run and gst_calc_cached both
--                                     use it, so they pick the same book.
--   gst_calc_rows(book)               the book's entries, lines and bill allocations in one compact answer (for gst-run's
--                                     reading: a third of the bytes, no ledger name repeated on every line)
--   gst_calc_gstins(book, client)     the client's GSTINs: its entries' own GSTINs and the client's record. The 2B runs and
--                                     decisions gst-run reads and the version counts are those of these GSTINs.
--   gst_calc_version(book, client)    the version of everything a 3B is worked out from: the book's (tally_calc_version),
--                                     and the client's work in FinCom: every item of its books (client_book_items: the 2B
--                                     months and their matching, the IMS decisions, the figures typed into 3B, the returns
--                                     marked filed, the GST settings, rules 37, 42 and 43, advances, the opening credit,
--                                     the ledger list), the client's record (clients), its marketplace sales (records, kind
--                                     'sales', not deleted), and the 2B matching gst-2b-match kept for its GSTINs
--                                     (gst_2b_runs done, gst_2b_decisions). Service role only.
--   gst_calc_cached(client, reg, ym)  for a member of the client's firm: the 3B kept for that month on the month's book,
--                                     only while the version is the same ({book, version, result: null when not, at}).
--   gst_calc_want / gst_calc_take     queue a client / take the next one (service role only)
--   triggers on client_book_items and tally_vouchers (statement-level, one per event, transition tables): a change
--                                     queues its clients. They only queue; nothing is worked out in the database.
-- The result's own "engine" says which engine worked it out; gst-run works a month out again when it differs.

begin;
set local lock_timeout = '10s';

do $$ begin
  if to_regclass('public.tally_calc_results') is null or to_regprocedure('public.tally_calc_version(uuid)') is null then
    raise exception 'migration 153 needs migration 151 (tally_calc_results, tally_calc_version) to be run first';
  end if;
end $$;

create table if not exists public.gst_calc_queue (
  firm_id   uuid not null,
  client_id text not null,
  why       text not null default 'asked',
  wanted_at timestamptz not null default now(),
  taken_at  timestamptz,
  ran_at    timestamptz,
  primary key (firm_id, client_id)
);
alter table public.gst_calc_queue enable row level security;
revoke all on public.gst_calc_queue from public, anon, authenticated;
grant all on public.gst_calc_queue to service_role;

-- the book a month is worked out on (tally_pick's rule, for a firm given)
create or replace function public.gst_calc_book(p_firm uuid, p_client text, p_ym text)
returns uuid language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with d as (select (to_date(p_ym || '01', 'YYYYMMDD') + interval '1 month' - interval '1 day')::date as on_day)
  select b.book_id from tally_books b, d
   where b.client_id = p_client and b.firm_id = p_firm and b.from_date is not null and b.open_as_on <= d.on_day
   order by (b.from_date <= d.on_day) desc, b.from_date desc limit 1;
$function$;

-- the client's GSTINs: its entries' own (cmp_gstin) and its record's
create or replace function public.gst_calc_gstins(p_book uuid, p_client text)
returns text[] language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  select coalesce(array_agg(distinct g order by g), '{}'::text[]) from (
    select upper(v.cmp_gstin) g from tally_vouchers v where v.book_id = p_book and coalesce(v.cmp_gstin, '') <> ''
    union select upper(c.data->>'gstin') from tally_books b join clients c on c.firm_id = b.firm_id and c.id = p_client
     where b.book_id = p_book and coalesce(c.data->>'gstin', '') <> '') x
   where g ~ '^\d{2}[A-Z0-9]{13}$';
$function$;

-- the book's entries for gst-run in one answer, compact: each ledger's name once (ledgers), each entry as a list of its
-- columns (data.ts HEADS, in that order) with its lines [ledger, amount, hsn, rate] and bill allocations [ledger, name,
-- type, amount, credit days] inside it; in the order the app reads them (entries by day and GUID, lines and bills as
-- kept). About a third of the bytes of the same rows read page by page, and no name repeated on every line.
create or replace function public.gst_calc_rows(p_book uuid)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with led as (select x.ledger, (row_number() over (order by x.ledger)) - 1 as i
                 from (select l.ledger from tally_lines l where l.book_id = p_book union select b.ledger from tally_bills b where b.book_id = p_book) x where x.ledger is not null),
  ln as (select l.guid, jsonb_agg(jsonb_build_array(d.i, l.amount, l.hsn, l.rate) order by l.id) a
           from tally_lines l join led d on d.ledger = l.ledger where l.book_id = p_book group by l.guid),
  bl as (select b.guid, jsonb_agg(jsonb_build_array(d.i, b.name, b.type, b.amount, b.credit_days) order by b.id) a
           from tally_bills b join led d on d.ledger = b.ledger where b.book_id = p_book group by b.guid)
  select jsonb_build_object(
    'ledgers', (select coalesce(jsonb_agg(led.ledger order by led.i), '[]'::jsonb) from led),
    'heads', (select coalesce(jsonb_agg(jsonb_build_array(v.guid, v.day, v.alter_id, v.vtype, v.vno, v.party, v.narration, v.cancelled, v.optional, v.deleted_at,
                v.gstin, v.pos, v.ref, v.ref_date, v.cmp_gstin, v.irn, v.irn_ack_date, v.gst_reg_type, v.gst_country, v.gst_rcm, v.gst_nature, v.gst_taxability,
                v.gst_supply, v.gst_ineligible, v.gst_mixed, v.gst_alter_id, coalesce(ln.a, '[]'::jsonb), coalesce(bl.a, '[]'::jsonb)) order by v.day, v.guid), '[]'::jsonb)
                from tally_vouchers v left join ln on ln.guid = v.guid left join bl on bl.guid = v.guid where v.book_id = p_book));
$function$;

-- the version of everything a client's 3B reads (see above); the book's firm decides whose rows count
create or replace function public.gst_calc_version(p_book uuid, p_client text)
returns text language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  with g as (select unnest(gst_calc_gstins(p_book, p_client)) as gstin)
  select md5(concat_ws('|', 'gst-3b',
           tally_calc_version(b.book_id),
           (select concat_ws(':', count(*), max(i.seq), max(i.updated_at), count(*) filter (where i.deleted))
              from client_book_items i where i.firm_id = b.firm_id and i.client_id = p_client),
           (select concat_ws(':', count(*), max(c.updated_at), md5(coalesce(max(c.data::text), '')), bool_or(c.deleted))
              from clients c where c.firm_id = b.firm_id and c.id = p_client),
           (select concat_ws(':', count(*), max(r.updated_at))
              from records r where r.firm_id = b.firm_id and r.client_id = p_client and r.kind = 'sales' and r.deleted is not true),
           (select concat_ws(':', count(*), max(r.id)) from gst_2b_runs r
             where r.firm_id = b.firm_id and r.status = 'done' and r.gstin in (select gstin from g)),
           (select concat_ws(':', count(*), max(d.at), md5(coalesce(string_agg(d.pair_id || '=' || d.decision, ',' order by d.gstin, d.fy, d.pair_id), '')))
              from gst_2b_decisions d where d.firm_id = b.firm_id and d.gstin in (select gstin from g))))
    from tally_books b where b.book_id = p_book and b.client_id = p_client;
$function$;

-- a member: the 3B kept for its client's month (on the month's book), only while it is current
create or replace function public.gst_calc_cached(p_client text, p_reg text, p_ym text)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare f uuid := my_firm(); bk uuid; v text; r tally_calc_results%rowtype;
begin
  if f is null or coalesce(p_ym, '') !~ '^20\d{2}(0[1-9]|1[0-2])$' or coalesce(p_reg, '') !~ '^\d{2}$' then return jsonb_build_object('none', true); end if;
  bk := gst_calc_book(f, p_client, p_ym);
  if bk is null then return jsonb_build_object('none', true); end if;
  v := gst_calc_version(bk, p_client);
  select * into r from tally_calc_results x where x.book_id = bk and x.kind = 'gst-3b' and x.args = p_reg || '|' || p_ym and x.firm_id = f;
  return jsonb_build_object('book', bk, 'version', v, 'result', case when r.version = v then r.result end, 'at', case when r.version = v then r.at end);
end $function$;

-- the queue: a client wanted (kept once; asked again it stays where it is in the line)
create or replace function public.gst_calc_want(p_firm uuid, p_client text, p_why text default 'asked')
returns void language sql volatile security definer set search_path to 'public', 'pg_temp' as $function$
  insert into gst_calc_queue (firm_id, client_id, why, wanted_at) values (p_firm, p_client, coalesce(p_why, 'asked'), now())
  on conflict (firm_id, client_id) do update set why = excluded.why, wanted_at = least(gst_calc_queue.wanted_at, excluded.wanted_at), taken_at = null;
$function$;
-- the next client to work on: wanted, not taken in the last 2 minutes, not run in the last 20 seconds
create or replace function public.gst_calc_take()
returns table (firm_id uuid, client_id text, why text) language sql volatile security definer set search_path to 'public', 'pg_temp' as $function$
  update gst_calc_queue q set taken_at = now()
   where (q.firm_id, q.client_id) = (select x.firm_id, x.client_id from gst_calc_queue x
                                      where (x.taken_at is null or x.taken_at < now() - interval '2 minutes')
                                        and (x.ran_at is null or x.ran_at < now() - interval '20 seconds')
                                      order by x.wanted_at limit 1 for update skip locked)
  returning q.firm_id, q.client_id, q.why;
$function$;
-- a run done: the client leaves the queue unless more is to be done (then it waits its 20 seconds)
create or replace function public.gst_calc_done(p_firm uuid, p_client text, p_more boolean)
returns void language sql volatile security definer set search_path to 'public', 'pg_temp' as $function$
  update gst_calc_queue set ran_at = now(), taken_at = null where firm_id = p_firm and client_id = p_client and p_more;
  delete from gst_calc_queue where firm_id = p_firm and client_id = p_client and not p_more;
$function$;

-- a change queues its clients (statement-level, from the transition table: one row per client, whatever the statement;
-- an insert or update reads the new rows, a delete the old)
create or replace function public.gst_calc_items_changed()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if tg_op = 'DELETE' then
    insert into gst_calc_queue (firm_id, client_id, why) select distinct o.firm_id, o.client_id, 'work' from changed_old o
    on conflict (firm_id, client_id) do update set taken_at = null;
  else
    insert into gst_calc_queue (firm_id, client_id, why) select distinct n.firm_id, n.client_id, 'work' from changed_new n
    on conflict (firm_id, client_id) do update set taken_at = null;
  end if;
  return null;
end $function$;
create or replace function public.gst_calc_vouchers_changed()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
begin
  if tg_op = 'DELETE' then
    insert into gst_calc_queue (firm_id, client_id, why)
      select distinct b.firm_id, b.client_id, 'books' from (select distinct book_id from changed_old) x join tally_books b on b.book_id = x.book_id
       where b.client_id is not null
    on conflict (firm_id, client_id) do update set taken_at = null;
  else
    insert into gst_calc_queue (firm_id, client_id, why)
      select distinct b.firm_id, b.client_id, 'books' from (select distinct book_id from changed_new) x join tally_books b on b.book_id = x.book_id
       where b.client_id is not null
    on conflict (firm_id, client_id) do update set taken_at = null;
  end if;
  return null;
end $function$;
do $$ begin
  -- one trigger per table and event (a transition table serves one event); each made once
  if not exists (select 1 from pg_trigger where tgname = 'gst_calc_items_ins') then
    create trigger gst_calc_items_ins after insert on public.client_book_items referencing new table as changed_new for each statement execute function public.gst_calc_items_changed(); end if;
  if not exists (select 1 from pg_trigger where tgname = 'gst_calc_items_upd') then
    create trigger gst_calc_items_upd after update on public.client_book_items referencing new table as changed_new for each statement execute function public.gst_calc_items_changed(); end if;
  if not exists (select 1 from pg_trigger where tgname = 'gst_calc_items_del') then
    create trigger gst_calc_items_del after delete on public.client_book_items referencing old table as changed_old for each statement execute function public.gst_calc_items_changed(); end if;
  if not exists (select 1 from pg_trigger where tgname = 'gst_calc_vouchers_ins') then
    create trigger gst_calc_vouchers_ins after insert on public.tally_vouchers referencing new table as changed_new for each statement execute function public.gst_calc_vouchers_changed(); end if;
  if not exists (select 1 from pg_trigger where tgname = 'gst_calc_vouchers_upd') then
    create trigger gst_calc_vouchers_upd after update on public.tally_vouchers referencing new table as changed_new for each statement execute function public.gst_calc_vouchers_changed(); end if;
  if not exists (select 1 from pg_trigger where tgname = 'gst_calc_vouchers_del') then
    create trigger gst_calc_vouchers_del after delete on public.tally_vouchers referencing old table as changed_old for each statement execute function public.gst_calc_vouchers_changed(); end if;
end $$;
-- the trigger functions run only as triggers
revoke all on function public.gst_calc_items_changed() from public, anon, authenticated;
revoke all on function public.gst_calc_vouchers_changed() from public, anon, authenticated;

revoke all on function public.gst_calc_book(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gst_calc_book(uuid, text, text) to service_role;
revoke all on function public.gst_calc_rows(uuid) from public, anon, authenticated;
grant execute on function public.gst_calc_rows(uuid) to service_role;
revoke all on function public.gst_calc_gstins(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_calc_gstins(uuid, text) to service_role;
revoke all on function public.gst_calc_version(uuid, text) from public, anon, authenticated;
grant execute on function public.gst_calc_version(uuid, text) to service_role;
revoke all on function public.gst_calc_want(uuid, text, text) from public, anon, authenticated;
grant execute on function public.gst_calc_want(uuid, text, text) to service_role;
revoke all on function public.gst_calc_take() from public, anon, authenticated;
grant execute on function public.gst_calc_take() to service_role;
revoke all on function public.gst_calc_done(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.gst_calc_done(uuid, text, boolean) to service_role;
revoke all on function public.gst_calc_cached(text, text, text) from public, anon;
grant execute on function public.gst_calc_cached(text, text, text) to authenticated, service_role;

commit;
