-- migration-95-gst-2b-match (17-Oct-2026, branch next-2b-automatch; round 72b): GSTR-2B matched against the books by itself,
-- on the server, after a 2B is fetched or brought in and when the purchases of the year change; the rules first, then ONE
-- Claude call for what is left (server/gst-2b-match). Add-only: three new tables and two new functions, nothing changed or
-- removed. Safe to run twice. Runs after 94 (and after 77, whose asst_cap_take / asst_cost_add / asst_log_add the function
-- calls, and gst-taxpro's schema.sql, whose gst_cron_ok it calls).
--   gst_2b_inputs     what the last match read: the purchases as FinCom's rules read them from the books (one row per GSTIN
--                     and year, sent by the app) and the 2B documents brought into the app (one row per return period).
--                     A 2B fetched on the server (gst_returns) is read from there. Only the fields the matching reads.
--   gst_2b_runs       every run, kept: why it ran, the counts and line shown, the pairs (keys and ids, never figures), what
--                     the AI did (used / off / over the cap / failed), its tokens and cost. Queued runs are its queue.
--   gst_2b_decisions  a person's accept or reject of a probable pair; every later run keeps to it.
-- Members read their firm's rows; only the function (service role) writes.
begin;
set local lock_timeout = '10s';

create table if not exists public.gst_2b_inputs (
  firm_id uuid not null references public.firms(id) on delete cascade,
  gstin text not null check (gstin ~ '^\d{2}[A-Z0-9]{13}$'),
  fy text not null check (fy ~ '^20\d{2}-\d{2}$'),
  side text not null check (side in ('books', '2b')),
  period text not null default '' check ((side = 'books' and period = '') or (side = '2b' and period ~ '^(0[1-9]|1[0-2])20\d{2}$')),
  client_id text not null,
  rows jsonb not null default '[]'::jsonb,
  n integer not null default 0,
  ai_allowed boolean not null default false,
  by_user uuid,
  at timestamptz not null default now(),
  primary key (firm_id, gstin, fy, side, period)
);
alter table public.gst_2b_inputs enable row level security;
revoke all on public.gst_2b_inputs from anon, authenticated;
grant select on public.gst_2b_inputs to authenticated;
do $$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_2b_inputs' and policyname = 'gst_2b_inputs_read') then
  create policy gst_2b_inputs_read on public.gst_2b_inputs for select to authenticated using ((firm_id = (select my_firm())) or (select is_superadmin())); end if; end $$;

create table if not exists public.gst_2b_runs (
  id bigint generated always as identity primary key,
  firm_id uuid not null references public.firms(id) on delete cascade,
  client_id text not null,
  gstin text not null check (gstin ~ '^\d{2}[A-Z0-9]{13}$'),
  fy text not null check (fy ~ '^20\d{2}-\d{2}$'),
  why text not null check (why in ('fetched', 'uploaded', 'new entries', 'opened', 'match again', 'decided')),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  by_user uuid,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  done_at timestamptz,
  inputs_hash text,
  counts jsonb,
  line text,
  result jsonb,
  ai jsonb,
  error text
);
create index if not exists gst_2b_runs_year on public.gst_2b_runs (firm_id, gstin, fy, id desc);
-- one waiting run per GSTIN and year: a second 2B fetched before the first run starts joins it
create unique index if not exists gst_2b_runs_one_queued on public.gst_2b_runs (firm_id, gstin, fy) where status = 'queued';
alter table public.gst_2b_runs enable row level security;
revoke all on public.gst_2b_runs from anon, authenticated;
grant select on public.gst_2b_runs to authenticated;
do $$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_2b_runs' and policyname = 'gst_2b_runs_read') then
  create policy gst_2b_runs_read on public.gst_2b_runs for select to authenticated using ((firm_id = (select my_firm())) or (select is_superadmin())); end if; end $$;

create table if not exists public.gst_2b_decisions (
  firm_id uuid not null references public.firms(id) on delete cascade,
  gstin text not null check (gstin ~ '^\d{2}[A-Z0-9]{13}$'),
  fy text not null check (fy ~ '^20\d{2}-\d{2}$'),
  pair_id text not null check (length(pair_id) between 3 and 4000 and position('>' in pair_id) > 1),
  decision text not null check (decision in ('accept', 'reject')),
  by_user uuid,
  at timestamptz not null default now(),
  primary key (firm_id, gstin, fy, pair_id)
);
alter table public.gst_2b_decisions enable row level security;
revoke all on public.gst_2b_decisions from anon, authenticated;
grant select on public.gst_2b_decisions to authenticated;
do $$ begin if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'gst_2b_decisions' and policyname = 'gst_2b_decisions_read') then
  create policy gst_2b_decisions_read on public.gst_2b_decisions for select to authenticated using ((firm_id = (select my_firm())) or (select is_superadmin())); end if; end $$;

-- a 2B fetched on the server (gst-taxpro): queue a run for the GSTIN and the financial year of the period (MMYYYY), for the
-- client whose purchases the app last sent; nothing to match before the app has sent them once. One waiting run per year.
create or replace function public.gst2b_enqueue(p_firm uuid, p_gstin text, p_period text, p_why text default 'fetched')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare m integer; y integer; f text; c text; rid bigint;
begin
  if p_firm is null or coalesce(p_gstin, '') !~ '^\d{2}[A-Z0-9]{13}$' or coalesce(p_period, '') !~ '^(0[1-9]|1[0-2])20\d{2}$' then
    return jsonb_build_object('queued', false, 'why', 'bad request');
  end if;
  m := substr(p_period, 1, 2)::integer; y := substr(p_period, 3, 4)::integer;
  if m < 4 then y := y - 1; end if;
  f := y::text || '-' || lpad(((y + 1) % 100)::text, 2, '0');
  select i.client_id into c from gst_2b_inputs i where i.firm_id = p_firm and i.gstin = p_gstin and i.fy = f and i.side = 'books';
  if c is null then return jsonb_build_object('queued', false, 'fy', f, 'why', 'the purchases of this year have not been sent by the app yet'); end if;
  insert into gst_2b_runs (firm_id, client_id, gstin, fy, why) values (p_firm, c, p_gstin, f, coalesce(nullif(p_why, ''), 'fetched'))
  on conflict (firm_id, gstin, fy) where status = 'queued' do nothing returning id into rid;
  if rid is null then
    select r.id into rid from gst_2b_runs r where r.firm_id = p_firm and r.gstin = p_gstin and r.fy = f and r.status = 'queued';
    return jsonb_build_object('queued', true, 'joined', true, 'id', rid, 'fy', f);
  end if;
  return jsonb_build_object('queued', true, 'id', rid, 'fy', f);
end $$;

-- the function takes waiting runs (and runs left 'running' for over 15 minutes by a function that stopped), oldest first
create or replace function public.gst2b_take(p_n integer default 5)
returns setof public.gst_2b_runs language sql security definer set search_path = public, pg_temp as $$
  update gst_2b_runs r set status = 'running', started_at = now()
   where r.id in (select x.id from gst_2b_runs x
                   where x.status = 'queued' or (x.status = 'running' and x.started_at < now() - interval '15 minutes')
                   order by x.id limit greatest(1, least(coalesce(p_n, 5), 20)) for update skip locked)
  returning r.*
$$;

revoke all on function public.gst2b_enqueue(uuid, text, text, text), public.gst2b_take(integer) from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then
  grant execute on function public.gst2b_enqueue(uuid, text, text, text), public.gst2b_take(integer) to service_role; end if; end $$;

commit;
