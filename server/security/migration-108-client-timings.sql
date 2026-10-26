-- migration 108: client_timings (branch next-timings, 26-Oct-2026; NOT RUN). Add-only, safe twice.
-- The owner: "measure FinCom's REAL round-trip latency from the office to the cloud, so we know which improvement
-- matters". The app (app/src/lib/timings.js) keeps, in the browser, how long each KIND of request took (rest/<table>
-- read|save, rpc/<fn>, fn/<function>, storage/<op>, auth/<step>, realtime/<what>, site/<file type>, open/<step>,
-- books/<step> of a client's books opening) and every 15 minutes, when something new happened, sends ONE summary row
-- here: per kind the count, median, 95th percentile, max, average and a histogram on fixed bounds (below), bytes when the
-- browser gives them. Never an address, an id, a query, a body or anything typed; the browser and system in a few words.
-- Who: a member inserts rows for themself and their own firm only; the firm's owner and a platform administrator read
-- them; anon nothing. Kept 30 days (pg_cron, where the database has it; else client_timings_sweep() by hand).
-- client_timings_report(hours) / the view client_timings_summary: per kind, p50 / p95 over the last 24 h and 7 days.
-- Deploy order: this, then the app build (until it runs, the app's rows are refused and it stops trying after three).
begin;
set local lock_timeout = '10s';

create table if not exists public.client_timings (
  id bigserial primary key,
  firm_id uuid not null default public.my_firm(),
  user_id uuid not null default auth.uid(),
  at timestamptz not null default now(),
  browser text check (browser is null or length(browser) <= 60),
  net_type text check (net_type is null or net_type ~ '^[a-z0-9-]{1,10}$'),
  net_rtt integer check (net_rtt is null or net_rtt between 0 and 600000),
  net_down numeric check (net_down is null or net_down between 0 and 100000),
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and jsonb_typeof(summary -> 'k') = 'object' and pg_column_size(summary) <= 32768)
);
create index if not exists client_timings_firm_at on public.client_timings (firm_id, at desc);
create index if not exists client_timings_at on public.client_timings (at);
alter table public.client_timings enable row level security;
do $do$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_timings' and policyname = 'client_timings_insert_own') then
    create policy client_timings_insert_own on public.client_timings for insert to authenticated
      with check (user_id = auth.uid() and firm_id = public.my_firm() and at > now() - interval '5 minutes' and at < now() + interval '5 minutes');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'client_timings' and policyname = 'client_timings_read_owner') then
    create policy client_timings_read_owner on public.client_timings for select to authenticated
      using (public.is_superadmin() or (firm_id = public.my_firm() and exists (select 1 from public.members m
        where m.user_id = auth.uid() and m.firm_id = client_timings.firm_id and m.role = 'owner' and coalesce(m.active, true))));
  end if;
end $do$;
revoke all on public.client_timings from public, anon, authenticated;
grant select, insert on public.client_timings to authenticated;
grant all on public.client_timings to service_role;
revoke all on sequence public.client_timings_id_seq from public, anon, authenticated;
grant usage on sequence public.client_timings_id_seq to authenticated;
grant all on sequence public.client_timings_id_seq to service_role;

-- per kind over the last p_hours: rows, people, requests, p50 / p95 (from the summed histograms, linear within a bucket),
-- max, average, and the functions' calls after idle (a cold start). Security invoker: the caller's rows only (RLS);
-- in the SQL editor (postgres) every firm's
create or replace function public.client_timings_report(p_hours integer default 24)
returns table (kind text, rows bigint, users bigint, n bigint, p50_ms integer, p95_ms integer, max_ms integer, avg_ms integer, idle_n bigint, idle_max_ms integer, kb bigint)
language sql stable security invoker set search_path = public, pg_temp as $fn$
  with b as (select array[25,50,75,100,150,200,300,400,500,700,1000,1500,2000,3000,5000,8000,15000,30000] as ub),
  r as (
    select t.id, t.user_id, k.key as kind, k.value as v
      from public.client_timings t, jsonb_each(t.summary -> 'k') k
     where t.at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 24 * 31))) and jsonb_typeof(k.value) = 'object'
  ),
  tot as (
    select kind, count(distinct id) as rows, count(distinct user_id) as users, sum((v ->> 'n')::bigint) as n,
           max((v ->> 'max')::numeric)::integer as max_ms,
           round(sum((v ->> 'avg')::numeric * (v ->> 'n')::numeric) / nullif(sum((v ->> 'n')::numeric), 0))::integer as avg_ms,
           sum(coalesce((v -> 'i' ->> 'n')::bigint, 0)) as idle_n, max((v -> 'i' ->> 'max')::numeric)::integer as idle_max_ms,
           (sum(coalesce((v ->> 'rx')::numeric, 0)) / 1024)::bigint as kb
      from r group by kind
  ),
  h as (
    select r.kind, e.i::integer - 1 as bucket, sum(e.c::bigint) as c
      from r, jsonb_array_elements_text(case when jsonb_typeof(r.v -> 'h') = 'array' then r.v -> 'h' else '[]'::jsonb end) with ordinality e(c, i)
     group by r.kind, e.i
  ),
  cum as (
    select h.kind, h.bucket, h.c, sum(h.c) over (partition by h.kind order by h.bucket) as upto, sum(h.c) over (partition by h.kind) as all_n,
           case when h.bucket = 0 then 0 else (select ub[h.bucket] from b) end as lo,
           coalesce((select ub[h.bucket + 1] from b), greatest((select max_ms from tot where tot.kind = h.kind), 30000)) as hi
      from h where h.c > 0
  ),
  q as (
    select kind,
      (select round(c.lo + (c.hi - c.lo) * (0.5 * c.all_n - (c.upto - c.c)) / c.c) from cum c where c.kind = k.kind and c.upto >= 0.5 * c.all_n order by c.bucket limit 1)::integer as p50,
      (select round(c.lo + (c.hi - c.lo) * (0.95 * c.all_n - (c.upto - c.c)) / c.c) from cum c where c.kind = k.kind and c.upto >= 0.95 * c.all_n order by c.bucket limit 1)::integer as p95
    from (select distinct kind from cum) k
  )
  select tot.kind, tot.rows, tot.users, tot.n, q.p50, q.p95, tot.max_ms, tot.avg_ms, tot.idle_n, tot.idle_max_ms, tot.kb
    from tot left join q using (kind)
   order by q.p95 desc nulls last, tot.kind
$fn$;
revoke all on function public.client_timings_report(integer) from public, anon;
grant execute on function public.client_timings_report(integer) to authenticated, service_role;

create or replace view public.client_timings_summary with (security_invoker = true) as
  select '24 h'::text as span, s.* from public.client_timings_report(24) s
  union all
  select '7 days'::text, s.* from public.client_timings_report(168) s;
revoke all on public.client_timings_summary from public, anon, authenticated;
grant select on public.client_timings_summary to authenticated, service_role;

-- 30 days kept
create or replace function public.client_timings_sweep() returns integer
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare n integer;
begin
  delete from public.client_timings where at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function public.client_timings_sweep() from public, anon, authenticated;
grant execute on function public.client_timings_sweep() to service_role;
do $do$ begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('client-timings-retention', '41 21 * * *', 'select public.client_timings_sweep()');
  end if;
end $do$;

commit;
