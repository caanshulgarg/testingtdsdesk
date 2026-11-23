-- Migration 209 (22-Nov-2026, branch next-fix-audit-sync-speed-tally; review fixes 23-Nov-2026, branch next-fix-209):
-- DRAFT, written, NOT run. The owner reads it and runs it on staging first. Add-only: functions replaced in place, one
-- new table, two new triggers; no row of an existing table changed or dropped; nothing dropped. After 164/170/204/205
-- (it replaces 204's gst_share_books_due). Tested by tests/run_migration209.py, against staging's own text of the four
-- functions it touches (tests/fixtures/staging-209-funcs.sql, copied read-only from staging on 23-Nov-2026).
-- What it does, from the audit of 22-Nov-2026 (findings speed-db.json, tally-pages.json):
--
--   1. gst-share-sweep (job 25, every minute) anti-joined EVERY voucher of EVERY book against calc_seen on every run
--      (63 ms at 38k vouchers on staging, growing with the whole database, not with what changed). Now a book is marked
--      when a voucher is written into it, or when a gst-share entry mark of it is removed (gst_share_unseen, by two
--      statement triggers); gst_share_books_due looks for unseen entries only in the marked books, and
--      gst_share_unseen_settle (run by the job first) unmarks a book with nothing unseen left. A deleted book takes its
--      mark with it (the foreign key cascades, and the triggers mark only books that still exist: deleting a book or a
--      firm works as before).
--      Limits (what the marks do NOT cover): a mark comes only from those two triggers, so rows written with triggers
--      off (session_replication_role = replica, a disabled trigger, a restore) and calc_seen rows removed by TRUNCATE
--      mark nothing; and a mark is settled 5 minutes after its last write, so a writer whose transaction stays open
--      longer than that is covered only while it still holds the mark's row (SKIP LOCKED below). After any such bulk
--      work, mark every book once by hand (the sweep's settle unmarks the seen ones after 5 minutes):
--        insert into gst_share_unseen (book_id) select book_id from tally_books on conflict do nothing;
--   2. Every pg_cron call of gst-run read vault.decrypted_secrets twice (pg_stat_statements' first statement by total
--      time: 1,600 s over 6,322 calls). gst_run_post reads both secrets in ONE query, only when there is a book to send,
--      and posts each book's call; only pg_cron (postgres) runs it: no API role may. Jobs gst-share-sweep and
--      gst-share-parity are rescheduled through it (same names, same times as 164/168). Jobs 28, 33 and 34 are not in
--      this repository's migrations: the owner moves them the same way (one line).
--   3. tally_tb had no ORDER BY, so its pages (limit/offset, TCloud.rpcAll) were not stable between calls: a ledger could
--      come twice or not at all at a page boundary (the app then reads again, and says "try again" the second time).
--      Now ordered by ledger, as tally_period and tally_balances_on. (tally_monthly is NOT in 209: staging's own text
--      already orders by ledger, month and starts at the book's own first day.)
--   4. tally_post_own_words named the poster's computer and Windows login ("your FinCom Bridge (PC · user)"): the
--      owner's rule is no computer or login name in these words. Now "your FinCom Bridge", and "on the Tally computer",
--      as the app's own words (src/js/49 noTargetWords). (tests/run_migration54.py checks migration 54's own words and
--      is left as it is: it runs 54 alone.)
-- Names: every table, function and trigger 209 makes is marked by its comment ('gst share sweep (migration 209)'); a
-- same-named one that is not 209's stops the migration before anything is changed.
--
-- How to apply: as one query (one transaction; lock_timeout 3 s; safe twice):  sbq.sh server/tally-cloud/migration-209-sync-speed.sql
-- Check after: select count(*) from gst_share_unseen;  select jobname, command from cron.job where jobname like 'gst-share-%';

begin;
set local lock_timeout = '3s';

-- ---------------------------------------------------------------- 0. what 209 needs, and its names free (or its own)
do $names$
declare t text; f text; bad text[] := '{}'; tag constant text := 'gst share sweep (migration 209)';
begin
  if to_regclass('public.calc_seen') is null or to_regclass('public.tally_calc_dirty') is null or to_regclass('public.gst_share_engine') is null
     or to_regprocedure('public.gst_share_books_all(integer)') is null or to_regprocedure('public.gst_share_books_due(integer)') is null then
    raise exception 'migration 209: run migrations 164, 170 and 204 first (calc_seen, tally_calc_dirty, gst_share_engine, gst_share_books_due/all)';
  end if;
  if to_regclass('public.gst_share_unseen') is not null and coalesce(obj_description(to_regclass('public.gst_share_unseen'), 'pg_class'), '') <> tag then
    bad := bad || 'table gst_share_unseen'::text;
  end if;
  foreach f in array array['gst_share_unseen_mark', 'gst_share_unseen_settle', 'gst_run_post'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = f and coalesce(obj_description(p.oid, 'pg_proc'), '') <> tag) then
      bad := bad || ('function ' || f);
    end if;
  end loop;
  foreach t in array array['gst_share_unseen_ins', 'gst_share_unseen_del'] loop
    if exists (select 1 from pg_trigger g where g.tgname = t and g.tgrelid in ('public.tally_vouchers'::regclass, 'public.calc_seen'::regclass)
                and coalesce(obj_description(g.oid, 'pg_trigger'), '') <> tag) then
      bad := bad || ('trigger ' || t);
    end if;
  end loop;
  if array_length(bad, 1) > 0 then
    raise exception 'migration 209: these names are already used by something else: %. Nothing was changed.', array_to_string(bad, ', ');
  end if;
end $names$;

-- ---------------------------------------------------------------- 1. the books with a voucher gst-share has not seen
do $t$
begin
  if to_regclass('public.gst_share_unseen') is null then
    create table public.gst_share_unseen (
      book_id uuid primary key references public.tally_books (book_id) on delete cascade,
      at      timestamptz not null default clock_timestamp()
    );
    perform set_config('fincom.m209_first', 'yes', true);       -- the backfill below runs on this first install only
  end if;
end $t$;
alter table public.gst_share_unseen enable row level security;      -- no policy: the service and the jobs only
revoke all on public.gst_share_unseen from public, anon, authenticated, service_role;
grant select on public.gst_share_unseen to service_role;              -- (written only by 209's own functions)

create or replace function public.gst_share_unseen_mark()
 returns trigger language plpgsql security definer set search_path = public, pg_temp
as $function$
begin
  -- only books that still exist: a book (or its firm) being deleted removes its calc_seen rows by cascade, and must not
  -- be marked again (its mark goes with it). One row per book (a "distinct" over the book and clock_timestamp() would
  -- give one per voucher, and the upsert would refuse a statement of several vouchers of one book). Ordered: two writers
  -- upsert the same books in the same order
  if tg_table_name = 'tally_vouchers' then
    insert into gst_share_unseen (book_id, at)
      select x.book_id, clock_timestamp() from (select distinct n.book_id from new_rows n join tally_books b on b.book_id = n.book_id) x order by 1
      on conflict (book_id) do update set at = clock_timestamp();
  else
    insert into gst_share_unseen (book_id, at)
      select x.book_id, clock_timestamp() from (select distinct o.book_id from old_rows o join tally_books b on b.book_id = o.book_id
                                                  where o.calc = 'gst-share' and o.kind = 'entry') x order by 1
      on conflict (book_id) do update set at = clock_timestamp();
  end if;
  return null;
end $function$;
revoke all on function public.gst_share_unseen_mark() from public, anon, authenticated, service_role;

-- a marked book with nothing unseen left: unmarked. A mark newer than 5 minutes stays (a write still being committed may
-- not be visible yet), and a mark a write still holds (its upsert not committed) is skipped (SKIP LOCKED), never
-- deleted on a re-check against a snapshot that cannot see that write's vouchers; the next minute looks at it again.
-- The mark is stamped with the write's own time (clock_timestamp(), not the start of its transaction). See the limits
-- at the top. Only books the sweep can take (a client: gst_share_books_due's own rule) are looked at;
-- tally_books.client_id is NOT NULL on staging, so this leaves none out today
create or replace function public.gst_share_unseen_settle()
 returns integer language sql volatile security definer set search_path = public, pg_temp
as $function$
  with pick as (
    select u.book_id from gst_share_unseen u join tally_books b on b.book_id = u.book_id and b.client_id is not null
     where u.at < now() - interval '5 minutes'
       and not exists (select 1 from tally_vouchers v where v.book_id = u.book_id
                         and not exists (select 1 from calc_seen s where s.book_id = v.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid))
     order by u.book_id
     for update of u skip locked),
  gone as (delete from gst_share_unseen u using pick p where u.book_id = p.book_id returning 1)
  select count(*)::integer from gone;
$function$;
revoke all on function public.gst_share_unseen_settle() from public, anon, authenticated;
grant execute on function public.gst_share_unseen_settle() to service_role;

-- staging's text (204, 170), with only the "unseen" part changed
CREATE OR REPLACE FUNCTION public.gst_share_books_due(p_n integer DEFAULT 3)
 RETURNS TABLE(book_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- 209: the books with an entry gst-share has not seen, looked for only among the books marked since (gst_share_unseen:
  -- a voucher written, an entry mark removed); 204 anti-joined every voucher of every book. The same books, same order
  with unseen as materialized (
    select u.book_id from gst_share_unseen u join tally_books bu on bu.book_id = u.book_id and bu.client_id is not null
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
          -- 170: the context made by another engine than the one gst-run runs now
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
-- only pg_cron (as postgres) calls it: no API role, service_role included
revoke all on function public.gst_run_post(jsonb[]) from public, anon, authenticated, service_role;

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
-- staging's text, with "order by 1" only
CREATE OR REPLACE FUNCTION public.tally_tb(p_client text, p_as_on date)
 RETURNS TABLE(ledger text, parent text, open numeric, movement numeric, closing numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
-- staging's text, without the bridge's words (computer · login) and with "on the Tally computer"
CREATE OR REPLACE FUNCTION public.tally_post_own_words(p_firm uuid, p_company text, p_user uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
              else 'your FinCom Bridge does not have '
                     || p_company || ' open in Tally. Open ' || p_company || ' in Tally on the Tally computer, then post again.' end
$function$;
revoke all on function public.tally_post_own_words(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 1b. the two triggers, last (they lock tally_vouchers and
-- calc_seen against writes until commit: kept to the end of the transaction). create or replace: no drop, no
-- ACCESS EXCLUSIVE lock
create or replace trigger gst_share_unseen_ins after insert on public.tally_vouchers
  referencing new table as new_rows for each statement execute function public.gst_share_unseen_mark();
create or replace trigger gst_share_unseen_del after delete on public.calc_seen
  referencing old table as old_rows for each statement execute function public.gst_share_unseen_mark();

-- the books unseen now, once, on the first install only (the anti-join 204 ran every minute; after the triggers, so a
-- write committed meanwhile is either seen here or marked by them)
insert into public.gst_share_unseen (book_id)
  select distinct v.book_id from public.tally_vouchers v
   where current_setting('fincom.m209_first', true) = 'yes'
     and not exists (select 1 from public.calc_seen s where s.book_id = v.book_id and s.calc = 'gst-share' and s.kind = 'entry' and s.key = v.guid)
   order by 1
  on conflict (book_id) do nothing;

-- ---------------------------------------------------------------- 209's names, marked as its own
comment on table public.gst_share_unseen is 'gst share sweep (migration 209)';
comment on function public.gst_share_unseen_mark() is 'gst share sweep (migration 209)';
comment on function public.gst_share_unseen_settle() is 'gst share sweep (migration 209)';
comment on function public.gst_run_post(jsonb[]) is 'gst share sweep (migration 209)';
comment on trigger gst_share_unseen_ins on public.tally_vouchers is 'gst share sweep (migration 209)';
comment on trigger gst_share_unseen_del on public.calc_seen is 'gst share sweep (migration 209)';

commit;
