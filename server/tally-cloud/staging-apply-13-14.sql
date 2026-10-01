-- FinCom staging (qbocskaiewaxqcvaunzc) only. Paste the whole block into the Supabase SQL editor of the STAGING
-- project and run it. Safe to run more than once: everything is "if not exists" / "create or replace" / guarded, and
-- cron.schedule replaces a job of the same name. Adds only; nothing is dropped or deleted (a "drop trigger if exists" /
-- "drop policy if exists" is followed by the same trigger or policy made again). All of it, or nothing (one transaction).
-- It ends with a check that lists what is in place.
-- Source: server/tally-cloud/migration-13-fast-sync.sql and migration-14-reports.sql (branch fast-sync).

begin;
set local lock_timeout = '15s';      -- waits at most 15 s for a table instead of hanging

-- ======================================================================== migration-13: fast sync
-- ---------- 1. waking the bridge
alter table public.tally_devices add column if not exists wake_token text;
update public.tally_devices set wake_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') where wake_token is null;
alter table public.tally_devices alter column wake_token set default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

create or replace function public.tally_wake(p_device uuid, p_what text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare t text;
begin
  select wake_token into t from tally_devices where id = p_device and not coalesce(revoked, false);
  if t is null then return; end if;
  perform realtime.send(jsonb_build_object('what', p_what, 'at', now()), p_what, 'tb-' || t, false);
exception when others then
  null;      -- the heartbeat still carries it, as before
end $function$;
revoke all on function public.tally_wake(uuid, text) from public, anon, authenticated;

create or replace function public.tally_post_jobs_wake() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.status = 'waiting' and new.device_id is not null and (tg_op = 'INSERT' or old.status is distinct from 'waiting') then perform tally_wake(new.device_id, 'post'); end if;
  return new;
end $function$;
drop trigger if exists tally_post_jobs_wake on public.tally_post_jobs;
create trigger tally_post_jobs_wake after insert or update of status on public.tally_post_jobs for each row execute function public.tally_post_jobs_wake();

create or replace function public.tally_devices_wake() returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.want_update_at is distinct from old.want_update_at and new.want_update_at is not null then perform tally_wake(new.id, 'update'); end if;
  return new;
end $function$;
drop trigger if exists tally_devices_wake on public.tally_devices;
create trigger tally_devices_wake after update of want_update_at on public.tally_devices for each row execute function public.tally_devices_wake();

-- ---------- 2. work done by the server
create extension if not exists pgmq;
select pgmq.create('tally_work') where not exists (select 1 from pgmq.list_queues() where queue_name = 'tally_work');

create table if not exists public.tally_jobs (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id),
  client_id  text not null,
  book_id    uuid,
  kind       text not null check (kind in ('daybook', 'reparse')),
  status     text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  total      integer not null default 0,
  done       integer not null default 0,
  sealed     boolean not null default false,          -- every piece handed over (the total is final)
  bad        jsonb not null default '[]'::jsonb,
  message    text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tally_jobs_client on public.tally_jobs (firm_id, client_id, created_at desc);
alter table public.tally_jobs enable row level security;
drop policy if exists tally_jobs_read on public.tally_jobs;
create policy tally_jobs_read on public.tally_jobs for select to authenticated using ((firm_id = my_firm()) or is_superadmin());
revoke all on public.tally_jobs from anon, authenticated;
grant select on public.tally_jobs to authenticated;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tally_jobs') then
    alter publication supabase_realtime add table public.tally_jobs;
  end if;
end $$;

create or replace function public.tally_work_send(p_msg jsonb) returns bigint language sql security definer set search_path to 'public' as $function$
  select * from pgmq.send('tally_work', p_msg);
$function$;
create or replace function public.tally_work_read(p_vt integer, p_n integer)
returns table (msg_id bigint, read_ct integer, message jsonb) language sql security definer set search_path to 'public' as $function$
  select r.msg_id, r.read_ct, r.message from pgmq.read('tally_work', p_vt, p_n) r;
$function$;
create or replace function public.tally_work_done(p_msg bigint) returns boolean language sql security definer set search_path to 'public' as $function$
  select pgmq.archive('tally_work', p_msg);
$function$;
-- a piece done (or given up): the job's count moves on; done when every piece of a sealed job is in
create or replace function public.tally_job_step(p_job uuid, p_done integer, p_bad jsonb, p_failed text default null)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  update tally_jobs set done = done + coalesce(p_done, 0), bad = bad || coalesce(p_bad, '[]'::jsonb),
         status = case when p_failed is not null then 'failed' when sealed and done + coalesce(p_done, 0) >= total then 'done' else 'running' end,
         message = case when p_failed is not null then left(p_failed, 300) else message end, updated_at = now()
   where id = p_job;
end $function$;
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'tally_work_key') then
    perform vault.create_secret(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'tally_work_key', 'the timer''s key for tally-ingest''s queue worker');
  end if;
end $$;
create or replace function public.tally_work_key_ok(p_key text) returns boolean language sql security definer set search_path to 'public' as $function$
  select coalesce(p_key, '') <> '' and exists (select 1 from vault.decrypted_secrets where name = 'tally_work_key' and decrypted_secret = p_key);
$function$;
revoke all on function public.tally_work_send(jsonb), public.tally_work_read(integer, integer), public.tally_work_done(bigint),
  public.tally_job_step(uuid, integer, jsonb, text), public.tally_work_key_ok(text) from public, anon, authenticated;
grant execute on function public.tally_work_send(jsonb), public.tally_work_read(integer, integer), public.tally_work_done(bigint),
  public.tally_job_step(uuid, integer, jsonb, text), public.tally_work_key_ok(text) to service_role;

select cron.schedule('tally-work', '30 seconds', $cron$
  select net.http_post(
    url := 'https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/tally-ingest',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-fincom-work', (select decrypted_secret from vault.decrypted_secrets where name = 'tally_work_key')),
    body := '{"kind":"work"}'::jsonb)
  where exists (select 1 from pgmq.q_tally_work where vt <= now())
$cron$);

-- ---------- 3. postings tried again
alter table public.tally_post_jobs add column if not exists attempts integer not null default 0;
create or replace function public.tally_post_requeue() returns integer language plpgsql security definer set search_path to 'public' as $function$
declare n integer;
begin
  update tally_post_jobs set status = case when attempts >= 5 then 'failed' else 'waiting' end, attempts = attempts + 1, updated_at = now(),
         message = case when attempts >= 5 then 'The Tally computer did not finish this posting after 5 tries. Check Tally on that computer, then post again.'
                        else 'Sent to the Tally computer again: it had not answered for a while.' end
   where (status = 'taken' and coalesce(updated_at, taken_at) < now() - interval '10 minutes')
      or (status = 'running' and updated_at < now() - interval '30 minutes');
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.tally_post_requeue() from public, anon, authenticated;
select cron.schedule('tally-post-requeue', '* * * * *', 'select public.tally_post_requeue()');

-- ======================================================================== migration-14: reports in the database
create index if not exists tally_lines_book_day on public.tally_lines (book_id, day);

-- the MIS head of a ledger, from its chain of groups (FinCom's MIS.head, src/js/07-mis.js)
create or replace function public.tally_mis_head(p_name text, p_chain text[])
returns text language sql immutable set search_path to 'public' as $function$
  select case
    when exists (select 1 from unnest(p_chain) g where lower(g) in ('sales accounts', 'direct incomes')) then 'rev'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'indirect incomes') then 'oth'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'purchase accounts') then 'pur'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'direct expenses') then 'dir'
    when exists (select 1 from unnest(p_chain) g where lower(g) = 'indirect expenses') then
      case when p_name ~* '(SALAR|WAGES|BONUS|STAFF|GRATUITY|\yPF\y|\yESI\y|EMPLOYEE|INCENTIVE|LEAVE)' then 'emp'
           when p_name ~* '(INTEREST|FINANCE CHARGE|PROCESSING FEE|LOAN CHARGE)' and p_name !~* 'INTEREST ON (TDS|GST|INCOME TAX)' then 'fin'
           when p_name ~* '(DEPRECIATION|AMORTI)' then 'dep'
           when p_name ~* '(INCOME TAX|PROVISION FOR TAX|DEFERRED TAX)' then 'tax'
           else 'exp' end
    else '' end
$function$;

create or replace function public.tally_mis(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with led as (
    select l.name, coalesce(l.open, 0) as open, tally_mis_head(l.name, l.chain) as hd,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sales accounts') as sales,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sundry debtors') as deb,
           exists (select 1 from unnest(l.chain) g where lower(g) = 'sundry creditors') as cred,
           exists (select 1 from unnest(l.chain) g where lower(g) in ('bank accounts', 'cash-in-hand', 'bank od a/c', 'bank occ a/c')) as cash
      from tally_ledgers l where l.book_id = bk and l.merged_into is null),
  mv as (select d.ledger, to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as a from tally_ledger_day d
          where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by 1, 2),
  sg as (select * from (values ('rev', 1), ('oth', 1), ('pur', -1), ('dir', -1), ('emp', -1), ('exp', -1), ('fin', -1), ('dep', -1), ('tax', -1)) s(hd, sign)),
  hm as (select l.hd, m.ym, round(sum(m.a * s.sign), 2) as v from mv m join led l on l.name = m.ledger join sg s on s.hd = l.hd group by 1, 2),
  ht as (select hd, round(sum(v), 2) as t, jsonb_object_agg(ym, v) as m from hm group by hd),
  hl as (select l.hd, m.ledger, round(sum(m.a * s.sign), 2) as t from mv m join led l on l.name = m.ledger join sg s on s.hd = l.hd group by 1, 2),
  tops as (select hd, jsonb_agg(jsonb_build_object('l', ledger, 't', t) order by abs(t) desc, ledger) as led from (select *, row_number() over (partition by hd order by abs(t) desc, ledger) as r from hl) z where r <= 15 group by hd),
  months as (select to_char(gs, 'YYYYMM') as ym from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs),
  tot as (select mo.ym,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) as income,
           coalesce(sum(hm.v) filter (where hm.hd = 'rev'), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir')), 0) as gross,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp')), 0) as ebitda,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp', 'fin', 'dep')), 0) as pbt,
           coalesce(sum(hm.v) filter (where hm.hd in ('rev', 'oth')), 0) - coalesce(sum(hm.v) filter (where hm.hd in ('pur', 'dir', 'emp', 'exp', 'fin', 'dep', 'tax')), 0) as pat
         from months mo left join hm on hm.ym = mo.ym group by mo.ym),
  -- sales by customer: the Sales Accounts lines of each entry, under the entry's party (else its debtor line)
  sl as (select coalesce(nullif(v.party, ''), (select x.ledger from tally_lines x join led dl on dl.name = x.ledger and dl.deb where x.book_id = bk and x.guid = v.guid limit 1), '') as party, sum(t.amount) as a
           from tally_lines t join led l on l.name = t.ledger and l.sales join tally_vouchers v on v.book_id = t.book_id and v.guid = t.guid
          where t.book_id = bk and t.day between greatest(p_from, b.from_date) and p_to and not v.cancelled and not v.optional group by 1),
  -- balances on the last date
  bal as (select l.name, l.deb, l.cred, l.cash, l.open + coalesce((select sum(d.amount) from tally_ledger_day d where d.book_id = bk and d.ledger = l.name and d.day between b.from_date and p_to), 0) as c
            from led l where l.deb or l.cred or l.cash)
  select jsonb_build_object(
    'from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'), 'company', b.company,
    'months', (select jsonb_agg(ym order by ym) from months),
    'heads', coalesce((select jsonb_object_agg(ht.hd, jsonb_build_object('t', ht.t, 'm', ht.m, 'led', coalesce(tops.led, '[]'::jsonb))) from ht left join tops on tops.hd = ht.hd), '{}'::jsonb),
    'income', (select jsonb_build_object('t', round(sum(income), 2), 'm', jsonb_object_agg(ym, round(income, 2))) from tot),
    'gross', (select jsonb_build_object('t', round(sum(gross), 2), 'm', jsonb_object_agg(ym, round(gross, 2))) from tot),
    'ebitda', (select jsonb_build_object('t', round(sum(ebitda), 2), 'm', jsonb_object_agg(ym, round(ebitda, 2))) from tot),
    'pbt', (select jsonb_build_object('t', round(sum(pbt), 2), 'm', jsonb_object_agg(ym, round(pbt, 2))) from tot),
    'pat', (select jsonb_build_object('t', round(sum(pat), 2), 'm', jsonb_object_agg(ym, round(pat, 2))) from tot),
    'sales', jsonb_build_object('total', coalesce((select round(sum(a), 2) from sl), 0),
       'other', coalesce((select round(sum(m.a), 2) from mv m join led l on l.name = m.ledger where l.hd in ('rev', 'oth') and not l.sales), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', party, 't', round(a, 2)) order by a desc) from (select * from sl order by a desc limit 20) z), '[]'::jsonb)),
    'recv', jsonb_build_object('owed', coalesce((select round(sum(greatest(-c, 0)), 2) from bal where deb), 0), 'advance', coalesce((select round(sum(greatest(c, 0)), 2) from bal where deb), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', name, 'owed', round(-c, 2)) order by c) from (select * from bal where deb and c < 0 order by c limit 20) z), '[]'::jsonb)),
    'pay', jsonb_build_object('owe', coalesce((select round(sum(greatest(c, 0)), 2) from bal where cred), 0), 'advance', coalesce((select round(sum(greatest(-c, 0)), 2) from bal where cred), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('party', name, 'owe', round(c, 2)) order by c desc) from (select * from bal where cred and c > 0 order by c desc limit 20) z), '[]'::jsonb)),
    'cash', jsonb_build_object('total', coalesce((select round(sum(-c), 2) from bal where cash), 0),
       'rows', coalesce((select jsonb_agg(jsonb_build_object('l', name, 'bal', round(-c, 2)) order by name) from bal where cash), '[]'::jsonb)),
    'grouped', exists (select 1 from led where hd <> '' limit 1),
    'at', now())
  into res;
  return res;
end $function$;

-- the ledgers FinCom's ledger list says are of a kind (client_book_items, key "map"; the caller's firm only)
create or replace function public.tally_led_kinds(p_client text)
returns table (ledger text, kind text, side text, tax text, what text) language sql stable security definer set search_path to 'public' as $function$
  select substr(i.item, 2), coalesce(i.data->>'kind', ''), coalesce(i.data->>'side', ''), coalesce(i.data->>'tax', ''), coalesce(i.data->>'what', '')
    from client_book_items i where i.firm_id = my_firm() and i.client_id = p_client and i.key = 'map' and i.item like '.%' and not i.deleted;
$function$;

create or replace function public.tally_tds_summary(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with k as (select * from tally_led_kinds(p_client) where kind in ('tds_payable', 'tds_receivable', 'tcs_payable', 'tcs_receivable', 'tds_clearing')),
  op as (select k.ledger, coalesce((select l.open from tally_ledgers l where l.book_id = bk and l.name = k.ledger), 0)
           + coalesce((select sum(d.amount) from tally_ledger_day d where d.book_id = bk and d.ledger = k.ledger and d.day >= b.from_date and d.day < p_from), 0) as open from k),
  mm as (select d.ledger, to_char(d.day, 'YYYYMM') as ym, sum(d.cr) as cr, sum(d.dr) as dr from tally_ledger_day d join k on k.ledger = d.ledger
          where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by 1, 2),
  per as (select k.ledger, k.kind, op.open, coalesce(sum(mm.cr), 0) as cr, coalesce(sum(mm.dr), 0) as dr,
            coalesce(jsonb_object_agg(mm.ym, jsonb_build_object('cr', round(mm.cr, 2), 'dr', round(mm.dr, 2))) filter (where mm.ym is not null), '{}'::jsonb) as m
            from k join op on op.ledger = k.ledger left join mm on mm.ledger = k.ledger group by 1, 2, 3)
  select jsonb_build_object('from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'),
    'ledgers', coalesce(jsonb_agg(jsonb_build_object('l', ledger, 'kind', kind, 'open', round(-open, 2), 'deducted', round(cr, 2), 'paid', round(dr, 2), 'close', round(-(open + cr - dr), 2), 'm', m) order by kind, ledger), '[]'::jsonb),
    'deducted', coalesce(round(sum(cr) filter (where kind in ('tds_payable', 'tcs_payable')), 2), 0),
    'paid', coalesce(round(sum(dr) filter (where kind in ('tds_payable', 'tcs_payable')), 2), 0),
    'receivable', coalesce(round(sum(dr - cr) filter (where kind in ('tds_receivable', 'tcs_receivable')), 2), 0),
    'mapped', (select count(*) from k), 'at', now())
  into res from per;
  return res;
end $function$;

create or replace function public.tally_gst_summary(p_client text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare bk uuid := tally_pick(p_client, p_to); b tally_books%rowtype; res jsonb;
begin
  if bk is null then return jsonb_build_object('none', true); end if;
  select * into b from tally_books where book_id = bk;
  with k as (select * from tally_led_kinds(p_client) where kind = 'gst' and what in ('gst', 'gst_rcm', 'gst_import')),
  sales as (select l.name from tally_ledgers l where l.book_id = bk and l.merged_into is null and exists (select 1 from unnest(l.chain) g where lower(g) = 'sales accounts')),
  months as (select to_char(gs, 'YYYYMM') as ym from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') gs),
  tx as (select to_char(d.day, 'YYYYMM') as ym, k.side, k.what, upper(k.tax) as tax, sum(d.cr - d.dr) as net from tally_ledger_day d join k on k.ledger = d.ledger
          where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by 1, 2, 3, 4),
  sv as (select to_char(d.day, 'YYYYMM') as ym, sum(d.amount) as v from tally_ledger_day d join sales s on s.name = d.ledger
          where d.book_id = bk and d.day between greatest(p_from, b.from_date) and p_to group by 1),
  heads as (select * from (values ('CGST'), ('SGST'), ('IGST'), ('CESS')) h(tax)),
  per as (select mo.ym,
    (select jsonb_object_agg(h.tax, coalesce((select round(sum(net), 2) from tx where tx.ym = mo.ym and side = 'output' and what = 'gst' and (tx.tax = h.tax or (h.tax = 'SGST' and tx.tax = 'UTGST'))), 0)) from heads h) as out_tax,
    (select jsonb_object_agg(h.tax, coalesce((select round(-sum(net), 2) from tx where tx.ym = mo.ym and side = 'input' and what in ('gst', 'gst_import') and (tx.tax = h.tax or (h.tax = 'SGST' and tx.tax = 'UTGST'))), 0)) from heads h) as in_tax,
    coalesce((select round(sum(net), 2) from tx where tx.ym = mo.ym and what = 'gst_rcm' and side = 'output'), 0) as rcm_out,
    coalesce((select round(-sum(net), 2) from tx where tx.ym = mo.ym and what = 'gst_rcm' and side = 'input'), 0) as rcm_in,
    coalesce((select round(v, 2) from sv where sv.ym = mo.ym), 0) as taxable_sales
    from months mo)
  select jsonb_build_object('from', to_char(greatest(p_from, b.from_date), 'YYYYMMDD'), 'to', to_char(p_to, 'YYYYMMDD'), 'mapped', (select count(*) from k),
    'months', coalesce(jsonb_agg(jsonb_build_object('ym', ym, 'out', out_tax, 'in', in_tax, 'rcmOut', rcm_out, 'rcmIn', rcm_in, 'taxableSales', taxable_sales) order by ym), '[]'::jsonb), 'at', now())
  into res from per;
  return res;
end $function$;

revoke all on function public.tally_mis(text, date, date), public.tally_tds_summary(text, date, date), public.tally_gst_summary(text, date, date), public.tally_led_kinds(text) from public, anon;
grant execute on function public.tally_mis(text, date, date), public.tally_tds_summary(text, date, date), public.tally_gst_summary(text, date, date), public.tally_led_kinds(text) to authenticated;

commit;

-- ======================================================================== the check: every line should say true
select x.what, x.applied from (values
  ('13 tally_devices.wake_token',          exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_devices' and column_name = 'wake_token')),
  ('13 function tally_wake',               to_regprocedure('public.tally_wake(uuid,text)') is not null),
  ('13 trigger tally_post_jobs_wake',      exists (select 1 from pg_trigger where tgname = 'tally_post_jobs_wake' and tgrelid = 'public.tally_post_jobs'::regclass)),
  ('13 trigger tally_devices_wake',        exists (select 1 from pg_trigger where tgname = 'tally_devices_wake' and tgrelid = 'public.tally_devices'::regclass)),
  ('13 extension pgmq',                    exists (select 1 from pg_extension where extname = 'pgmq')),
  ('13 queue tally_work',                  exists (select 1 from pg_tables where schemaname = 'pgmq' and tablename = 'q_tally_work')),
  ('13 table tally_jobs',                  to_regclass('public.tally_jobs') is not null),
  ('13 tally_jobs in Realtime',            exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'tally_jobs')),
  ('13 tally_jobs row security on',        coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.tally_jobs')), false)),
  ('13 queue functions (5)',               (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('tally_work_send', 'tally_work_read', 'tally_work_done', 'tally_job_step', 'tally_work_key_ok')) = 5),
  ('13 vault secret tally_work_key',       exists (select 1 from vault.secrets where name = 'tally_work_key')),
  ('13 cron tally-work',                   exists (select 1 from cron.job where jobname = 'tally-work')),
  ('13 tally_post_jobs.attempts',          exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tally_post_jobs' and column_name = 'attempts')),
  ('13 function tally_post_requeue',       to_regprocedure('public.tally_post_requeue()') is not null),
  ('13 cron tally-post-requeue',           exists (select 1 from cron.job where jobname = 'tally-post-requeue')),
  ('14 index tally_lines_book_day',        to_regclass('public.tally_lines_book_day') is not null),
  ('14 report functions (5)',              (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('tally_mis_head', 'tally_mis', 'tally_led_kinds', 'tally_tds_summary', 'tally_gst_summary')) = 5),
  ('14 anon cannot run tally_mis',         case when to_regprocedure('public.tally_mis(text,date,date)') is null then false else not has_function_privilege('anon', 'public.tally_mis(text,date,date)', 'execute') end),
  ('14 signed-in users can run tally_mis', case when to_regprocedure('public.tally_mis(text,date,date)') is null then false else has_function_privilege('authenticated', 'public.tally_mis(text,date,date)', 'execute') end)
) as x(what, applied);
