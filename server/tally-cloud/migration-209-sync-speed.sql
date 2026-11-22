-- Migration 209 (22-Nov-2026, branch next-fix-audit-sync-speed-tally): DRAFT, written, NOT run. The owner reads it and
-- runs it on staging first. Add-only: new functions replaced in place, one new table, two triggers; no row of an existing
-- table changed or dropped. After 204/205 (it replaces 204's gst_share_books_due).
-- What it does, from the audit of 22-Nov-2026 (findings speed-db.json, tally-pages.json):
--
--   1. gst-share-sweep (job 25, every minute) anti-joined EVERY voucher of EVERY book against calc_seen on every run
--      (63 ms at 38k vouchers on staging, growing with the whole database, not with what changed). Now a book is marked
--      when a voucher is written into it, or when a gst-share entry mark of it is removed (gst_share_unseen, by two
--      statement triggers); gst_share_books_due looks for unseen entries only in the marked books, and
--      gst_share_unseen_settle (run by the job first) unmarks a book with nothing unseen left. The same books come out:
--      a voucher is unseen only after one of those two writes, and every such write marks its book.
--   2. Every pg_cron call of gst-run read vault.decrypted_secrets twice (pg_stat_statements' first statement by total
--      time: 1,600 s over 6,322 calls). gst_run_post reads both secrets in ONE query, only when there is a book to send,
--      and posts each book's call. Jobs gst-share-sweep and gst-share-parity are rescheduled through it (same names, same
--      times). Jobs 28, 33 and 34 are not in this repository's migrations: the owner moves them the same way (one line).
--   3. tally_tb had no ORDER BY, so its pages (limit/offset, TCloud.rpcAll) were not stable between calls: a ledger
--      could come twice or not at all at a page boundary. Now ordered by ledger, as tally_period and tally_balances_on.
--      (The app also reads such a list again when a row comes on two pages: src/js/49 rpcAll.)
--   4. tally_post_own_words named the poster's computer and Windows login ("your FinCom Bridge (PC · user)"): the
--      owner's rule is no computer or login name in these words. Now "your FinCom Bridge", and "on the Tally computer".
--      (tests/run_migration54.py checks migration 54's own words and is left as it is: it runs 54 alone.)
--
-- How to apply: as one query (one transaction; lock_timeout 3 s; safe twice):  sbq.sh server/tally-cloud/migration-209-sync-speed.sql
-- Check after: select count(*) from gst_share_unseen;  select jobname, command from cron.job where jobname like 'gst-share-%';

begin;
set local lock_timeout = '3s';

-- ---------------------------------------------------------------- 1. the books with a voucher gst-share has not seen
create table if not exists public.gst_share_unseen (
  book_id uuid primary key references public.tally_books (book_id) on delete cascade,
  at      timestamptz not null default now()
);
alter table public.gst_share_unseen enable row level security;      -- no policy: the service and the jobs only
revoke all on public.gst_share_unseen from public, anon, authenticated;

create or replace function public.gst_share_unseen_mark()
 returns trigger language plpgsql security definer set search_path = public, pg_temp
as $function$
begin
  if tg_table_name = 'tally_vouchers' then
    insert into gst_share_unseen (book_id) select distinct n.book_id from new_rows n
      on conflict (book_id) do update set at = now();
  else
    insert into gst_share_unseen (book_id) select distinct o.book_id from old_rows o where o.calc = 'gst-share' and o.kind = 'entry'
      on conflict (book_id) do update set at = now();
  end if;
  return null;
end $function$;
revoke all on function public.gst_share_unseen_mark() from public, anon, authenticated;

drop trigger if exists gst_share_unseen_ins on public.tally_vouchers;
create trigger gst_share_unseen_ins after insert on public.tally_vouchers
  referencing new table as new_rows for each statement execute function public.gst_share_unseen_mark();
drop trigger if exists gst_share_unseen_del on public.calc_seen;
create trigger gst_share_unseen_del after delete on public.calc_seen
  referencing old table as old_rows for each statement execute function public.gst_share_unseen_mark();

-- the books unseen now, once (the anti-join 204 ran every minute)
insert into public.gst_share_unseen (book_id)
  select distinct v.book_id from public.tally_vouchers v
   where not exists (select 1 from public.calc_seen s where s.book_id = v.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid)
  on conflict (book_id) do nothing;

-- a marked book with nothing unseen left: unmarked (a mark newer than 5 minutes stays: a write still being committed may
-- not be visible yet; the book is then only looked at again, never missed)
create or replace function public.gst_share_unseen_settle()
 returns integer language sql volatile security definer set search_path = public, pg_temp
as $function$
  with gone as (
    delete from gst_share_unseen u
     where u.at < now() - interval '5 minutes'
       and not exists (select 1 from tally_vouchers v where v.book_id = u.book_id
                         and not exists (select 1 from calc_seen s where s.book_id = v.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid))
    returning 1)
  select count(*)::integer from gone;
$function$;
revoke all on function public.gst_share_unseen_settle() from public, anon, authenticated;
grant execute on function public.gst_share_unseen_settle() to service_role;

create or replace function public.gst_share_books_due(p_n integer default 3)
 returns table(book_id uuid)
 language sql stable security definer set search_path = public, pg_temp
as $function$
  -- 209: the books with an entry gst-share has not seen, looked for only among the books marked since (gst_share_unseen:
  -- a voucher written, an entry mark removed); 204 anti-joined every voucher of every book. The same books, same order
  with unseen as materialized (
    select u.book_id from gst_share_unseen u
     where exists (select 1 from tally_vouchers v where v.book_id = u.book_id
                     and not exists (select 1 from calc_seen s where s.book_id = v.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid)))
  select b.book_id from tally_books b
   cross join lateral (select min(d.changed_at) w from tally_calc_dirty d
                         left join calc_seen s on s.book_id = d.book_id and s.calc = 'gst-share' and s.kind = 'day' and s.key = d.day::text
                        where d.book_id = b.book_id and s.stamp is distinct from d.changed_at::text) dd
   where b.client_id is not null
     and (dd.w is not null
          or exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.due)
          or (not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'ctx')
              and exists (select 1 from tally_vouchers v where v.book_id = b.book_id))
          or b.book_id in (select u.book_id from unseen u)
          or exists (select 1 from calc_seen s join gst_share_engine e on e.one
                      where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book' and s.key = 'ctx'
                        and s.data->>'engine' is distinct from e.engine))
     and not exists (select 1 from calc_seen s where s.book_id = b.book_id and s.calc = 'gst-share' and s.kind = 'book'
                      and s.key in ('lease', 'backoff:ctx') and (s.data->>'until')::timestamptz > clock_timestamp())
   order by dd.w nulls last, b.book_id
   limit greatest(1, least(coalesce(p_n, 3), 5));
$function$;
revoke all on function public.gst_share_books_due(integer) from public, anon, authenticated;
grant execute on function public.gst_share_books_due(integer) to service_role;

-- ---------------------------------------------------------------- 2. gst-run's calls from pg_cron: the secrets read once
create or replace function public.gst_run_post(p_bodies jsonb[])
 returns integer language plpgsql volatile security definer set search_path = public, pg_temp
as $function$
declare u text; k text; b jsonb; n integer := 0;
begin
  if coalesce(array_length(p_bodies, 1), 0) = 0 then return 0; end if;      -- nothing to send: the vault is not read
  select max(s.decrypted_secret) filter (where s.name = 'fincom_project_url'), max(s.decrypted_secret) filter (where s.name = 'gst_cron_key')
    into u, k from vault.decrypted_secrets s where s.name in ('fincom_project_url', 'gst_cron_key');
  if u is null or k is null then raise notice 'gst_run_post: Vault has no fincom_project_url or gst_cron_key'; return 0; end if;
  foreach b in array p_bodies loop
    perform net.http_post(url := u || '/functions/v1/gst-run', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', k), body := b);
    n := n + 1;
  end loop;
  return n;
end $function$;
revoke all on function public.gst_run_post(jsonb[]) from public, anon, authenticated;

do $cron$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null or to_regnamespace('net') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'migration 209: pg_cron, pg_net or Vault is not here: the jobs are left as they are';
  else
    perform cron.schedule('gst-share-sweep', '* * * * *', $job$
      select public.gst_share_unseen_settle();
      select public.gst_run_post(array(select jsonb_build_object('action', 'share_sweep', 'book_id', d.book_id) from public.gst_share_books_due(3) d));
    $job$);
    perform cron.schedule('gst-share-parity', '*/5 20-23 * * *', $job$
      select public.gst_run_post(array(select jsonb_build_object('action', 'share_parity', 'book_id', d.book_id) from public.gst_share_books_all(200) d));
    $job$);
  end if;
end $cron$;

-- ---------------------------------------------------------------- 3. tally_tb in a steady order (its pages)
create or replace function public.tally_tb(p_client text, p_as_on date)
returns table(ledger text, parent text, open numeric, movement numeric, closing numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare bk uuid := tally_pick(p_client, p_as_on); b tally_books%rowtype;
begin
  if bk is null then return; end if;
  select * into b from tally_books where book_id = bk;
  return query
    with lg as (select tally_nm(t.name) as name, max(t.parent) as parent, sum(t.open) as open from tally_ledgers t
                 where t.book_id = bk and t.merged_into is null group by 1),
    mv as (select tally_nm(d.ledger) as ledger, sum(d.amount) m from tally_ledger_day d where d.book_id = bk and d.merged_into is null and d.day between b.from_date and p_as_on group by 1)
    select coalesce(lg.name, mv.ledger), coalesce(lg.parent, ''), coalesce(lg.open, 0)::numeric, coalesce(mv.m, 0)::numeric, (coalesce(lg.open, 0) + coalesce(mv.m, 0))::numeric
      from lg full join mv on mv.ledger = lg.name
     order by 1;                                                          -- 209: a steady order for its pages
end $function$;

-- ---------------------------------------------------------------- 4. the poster's words without a computer or login name
create or replace function public.tally_post_own_words(p_firm uuid, p_company text, p_user uuid)
returns text language sql stable security definer set search_path = public, pg_temp as $function$
  with own as (select tally_bridge_may_post(d.id, k.key) as may, tally_bridge_has_open(d.id, k.key, p_company) as has
                 from tally_devices d, jsonb_each(case when jsonb_typeof(d.info -> 'bridges') = 'object' then d.info -> 'bridges' else '{}'::jsonb end) k
                where d.firm_id = p_firm and not coalesce(d.revoked, false) and tally_bridge_is_own(p_firm, p_user, d.id, k.key))
  select 'Nobody can post into ' || p_company || ' from your sign-in just now: '
      || case when not exists (select 1 from own)
                then 'FinCom has not heard from a FinCom Bridge of yours. Install FinCom Bridge on the computer where you use Tally, as your own Windows user ("Just for me"), and connect it to FinCom; then open '
                     || p_company || ' in Tally there and post again.'
              when exists (select 1 from own where has)
                then 'your FinCom Bridge has it open but is set to Changes only or only reads Tally. '
                     || 'Ask the firm''s owner to switch Changes only off for it (Tally page), then post again.'
              else 'your FinCom Bridge does not have ' || p_company || ' open in Tally. Open ' || p_company || ' in Tally on the Tally computer, then post again.' end
$function$;
revoke all on function public.tally_post_own_words(uuid, text, uuid) from public, anon, authenticated;

commit;
