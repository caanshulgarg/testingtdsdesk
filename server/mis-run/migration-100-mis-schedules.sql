-- migration-100-mis-schedules (22-Oct-2026, ROUND 105 B6, branch next-mis-schedule). NOT run on staging yet.
-- My MIS sent on a schedule: a saved report (client_book_items key misCustom) worked out in the cloud by the mis-run
-- function, its Excel and PDF kept in a private bucket, a bell notice, and an email when the email service is set up.
--   mis_schedules   one row a schedule: the client, the report, the rule (daily / weekly on a weekday / monthly on a day,
--                   at a time in IST), the period it covers (last month, month / quarter / year to date), the recipients
--                   (firm members and typed addresses), the next run, on or off. Members of the firm read them; owners and
--                   staff add and change them (look-only members read only); nothing is deleted: a schedule is turned off.
--   mis_runs        what each run did: the period, the files, to whom it was sent, ok or failed and why, the attempt. Only
--                   the function writes them (service role); the firm reads its own.
--   mis_next_run(rule, after)   the next time a rule falls due after a moment (IST).
--   mis_cloud_gst   the server's GST working for a schedule's client, read as a member of its firm (service role only).
--   mis_take(n)     the function takes up to n schedules that are due, each moved on to its next time at once (a timer
--                   that fires twice, or two copies of the function, never send a report twice).
--   mis-reports     a private Storage bucket; files under <firm>/<client>/...; a member reads only the firm's folder.
--   the timer       every 15 minutes, only when a schedule is due and the address is set (app_settings name 'mis_run',
--                   value {"url": ".../functions/v1/mis-run"}), with the platform's cron key (Vault gst_cron_key, which
--                   mis-run checks with gst_cron_ok, as gst-2b-match does).
-- Add-only: two new tables, their functions, policies and grants (explicit: Supabase gives none by default from
-- 30-Oct-2026); the bucket and its policy and the timer only where Storage and pg_cron are there. Safe to run twice.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- the checks
create or replace function public.mis_rule_ok(r jsonb) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(r) = 'object'
     and r->>'freq' in ('daily', 'weekly', 'monthly')
     and coalesce(r->>'time', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and (r->>'freq' <> 'weekly' or coalesce(r->>'weekday', '') ~ '^[0-6]$')
     and (r->>'freq' <> 'monthly' or (coalesce(r->>'day', '') ~ '^[0-9]{1,2}$' and (r->>'day')::int between 1 and 31))
$$;
create or replace function public.mis_recipients_ok(r jsonb) returns boolean language sql immutable set search_path = public, pg_temp as $$
  select jsonb_typeof(r) = 'object'
     and jsonb_typeof(coalesce(r->'members', '[]')) = 'array' and jsonb_typeof(coalesce(r->'emails', '[]')) = 'array'
     and jsonb_array_length(coalesce(r->'members', '[]')) <= 50 and jsonb_array_length(coalesce(r->'emails', '[]')) <= 20
     and not exists (select 1 from jsonb_array_elements_text(coalesce(r->'emails', '[]')) e where e !~* '^[^@\s,;<>]+@[^@\s,;<>]+\.[a-z]{2,}$')
     and not exists (select 1 from jsonb_array_elements_text(coalesce(r->'members', '[]')) m where m !~ '^[0-9a-f-]{36}$')
$$;

-- the next time a rule falls due strictly after `after` (the rule's time is IST: Asia/Kolkata, no summer time)
create or replace function public.mis_next_run(r jsonb, after timestamptz) returns timestamptz language plpgsql stable set search_path = public, pg_temp as $$
declare loc timestamp := after at time zone 'Asia/Kolkata'; t time; d date; cand timestamp; i int; dim int; want int;
begin
  if not mis_rule_ok(r) then return null; end if;
  t := (r->>'time')::time; d := loc::date;
  if r->>'freq' = 'daily' then
    cand := d + t; if cand <= loc then cand := cand + interval '1 day'; end if;
  elsif r->>'freq' = 'weekly' then
    want := (r->>'weekday')::int;                                   -- 0 Sunday .. 6 Saturday
    for i in 0..7 loop
      cand := (d + i) + t;
      exit when extract(dow from d + i)::int = want and cand > loc;
    end loop;
  else
    want := (r->>'day')::int;                                       -- a day past the month's end is its last day
    for i in 0..2 loop
      dim := extract(day from (date_trunc('month', d) + make_interval(months => i + 1) - interval '1 day'))::int;
      cand := (date_trunc('month', d) + make_interval(months => i))::date + (least(want, dim) - 1) + t;
      exit when cand > loc;
    end loop;
  end if;
  return cand at time zone 'Asia/Kolkata';
end $$;

-- ---------------------------------------------------------------- the tables
create table if not exists public.mis_schedules (
  id          uuid primary key default gen_random_uuid(),
  firm_id     uuid not null default public.my_firm() references public.firms(id),
  client_id   text not null check (length(client_id) between 1 and 120),
  report_id   text not null check (length(report_id) between 1 and 80),
  report_name text not null default '' check (length(report_name) <= 200),
  rule        jsonb not null check (public.mis_rule_ok(rule)),
  period      text not null default 'lastMonth' check (period in ('lastMonth', 'mtd', 'qtd', 'ytd')),
  recipients  jsonb not null default '{"members": [], "emails": []}'::jsonb check (public.mis_recipients_ok(recipients)),
  next_run    timestamptz,
  enabled     boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_run_at timestamptz
);
create index if not exists mis_schedules_due on public.mis_schedules (next_run) where enabled;
create index if not exists mis_schedules_client on public.mis_schedules (firm_id, client_id);

create table if not exists public.mis_runs (
  id          bigserial primary key,
  firm_id     uuid not null references public.firms(id),
  client_id   text not null,
  schedule_id uuid references public.mis_schedules(id),
  report_id   text not null default '',
  report_name text not null default '',
  period      jsonb not null default '{}'::jsonb,
  files       jsonb not null default '[]'::jsonb,
  sent_to     jsonb not null default '[]'::jsonb,
  email       text not null default '' check (email in ('', 'sent', 'not set up', 'failed', 'no recipients')),
  status      text not null check (status in ('ok', 'failed')),
  error       text not null default '' check (length(error) <= 2000),
  attempt     int not null default 1 check (attempt between 1 and 5),
  by_whom     text not null default 'timer' check (by_whom in ('timer', 'person')),
  at          timestamptz not null default now()
);
create index if not exists mis_runs_firm on public.mis_runs (firm_id, client_id, at desc);
create index if not exists mis_runs_schedule on public.mis_runs (schedule_id, at desc);

-- a change by a person: the next run worked out again from the rule (off: none); when it was changed
create or replace function public.mis_schedule_touch() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.rule is distinct from old.rule or new.enabled is distinct from old.enabled then
    new.next_run := case when new.enabled then public.mis_next_run(new.rule, now()) else null end;
  end if;
  if tg_op = 'UPDATE' and (new.firm_id <> old.firm_id or new.client_id <> old.client_id) then raise exception 'a schedule stays with its firm and client'; end if;
  return new;
end $$;
drop trigger if exists mis_schedule_touch on public.mis_schedules;
create trigger mis_schedule_touch before insert or update of rule, enabled, period, recipients, report_name, firm_id, client_id on public.mis_schedules
  for each row execute function public.mis_schedule_touch();

-- the function (service role): take the schedules that are due, each moved on to its next time in the same statement
create or replace function public.mis_take(p_n int default 5, p_now timestamptz default now()) returns setof public.mis_schedules
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  return query
  with due as (select s.id from public.mis_schedules s where s.enabled and s.next_run is not null and s.next_run <= p_now
                order by s.next_run limit greatest(1, least(coalesce(p_n, 5), 20)) for update skip locked)
  update public.mis_schedules s set next_run = public.mis_next_run(s.rule, p_now), last_run_at = p_now
    from due where s.id = due.id
  returning s.*;
end $$;

-- the function (service role): a schedule's GST by month, the server's own working (tally_gst_summary), read as a member
-- of the schedule's firm who may change it (the one who made it while still owner or staff, else an owner): that working
-- reads the client's book through the firm's checks (my_firm()), which a call with the service role alone does not pass
create or replace function public.mis_cloud_gst(p_schedule uuid, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.mis_schedules%rowtype; u uuid; res jsonb;
begin
  select * into s from public.mis_schedules where id = p_schedule;
  if not found then return jsonb_build_object('error', 'no such schedule'); end if;
  select m.user_id into u from public.members m where m.firm_id = s.firm_id and m.active and m.role in ('owner', 'staff')
   order by (m.user_id = s.created_by) desc, (m.role = 'owner') desc, m.user_id limit 1;
  if u is null then return jsonb_build_object('error', 'the firm has no owner or staff member'); end if;
  if to_regprocedure('public.tally_gst_summary(text,date,date)') is null then return jsonb_build_object('none', true); end if;
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'select public.tally_gst_summary($1, $2, $3)' into res using s.client_id, p_from, p_to;
  return res;
end $$;

-- ---------------------------------------------------------------- who reads and writes what
alter table public.mis_schedules enable row level security;
alter table public.mis_runs enable row level security;
drop policy if exists mis_schedules_read on public.mis_schedules;
create policy mis_schedules_read on public.mis_schedules for select to authenticated using ((firm_id = (select public.my_firm())) or (select public.is_superadmin()));
drop policy if exists mis_schedules_add on public.mis_schedules;
create policy mis_schedules_add on public.mis_schedules for insert to authenticated with check (firm_id = (select public.my_firm()) and (select public.can_write()));
drop policy if exists mis_schedules_change on public.mis_schedules;
create policy mis_schedules_change on public.mis_schedules for update to authenticated using (firm_id = (select public.my_firm()) and (select public.can_write()))
  with check (firm_id = (select public.my_firm()) and (select public.can_write()));
drop policy if exists mis_runs_read on public.mis_runs;
create policy mis_runs_read on public.mis_runs for select to authenticated using ((firm_id = (select public.my_firm())) or (select public.is_superadmin()));

revoke all on public.mis_schedules, public.mis_runs from public, anon, authenticated;
grant select, insert, update on public.mis_schedules to authenticated;
grant select on public.mis_runs to authenticated;
grant select, insert, update, delete on public.mis_schedules, public.mis_runs to service_role;
revoke all on sequence public.mis_runs_id_seq from public, anon, authenticated;
grant usage, select on sequence public.mis_runs_id_seq to service_role;

revoke all on function public.mis_take(int, timestamptz) from public, anon, authenticated;
grant execute on function public.mis_take(int, timestamptz) to service_role;
revoke all on function public.mis_cloud_gst(uuid, date, date) from public, anon, authenticated;
grant execute on function public.mis_cloud_gst(uuid, date, date) to service_role;
revoke all on function public.mis_schedule_touch() from public, anon, authenticated;
revoke all on function public.mis_next_run(jsonb, timestamptz), public.mis_rule_ok(jsonb), public.mis_recipients_ok(jsonb) from public, anon;
grant execute on function public.mis_next_run(jsonb, timestamptz), public.mis_rule_ok(jsonb), public.mis_recipients_ok(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- the bucket (where Storage is) and the timer (where pg_cron is)
do $do$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit) values ('mis-reports', 'mis-reports', false, 20971520) on conflict (id) do nothing;
    execute 'drop policy if exists mis_reports_read on storage.objects';
    execute $p$create policy mis_reports_read on storage.objects for select to authenticated
      using (bucket_id = 'mis-reports' and (storage.foldername(name))[1] = (select public.my_firm())::text)$p$;
  end if;
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('mis-run-due', '*/15 * * * *', $c$
      select net.http_post(
        url := (select value->>'url' from public.app_settings where name = 'mis_run'),
        headers := jsonb_build_object('Content-Type', 'application/json',
          'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'gst_cron_key')),
        body := '{"action":"due"}'::jsonb,
        timeout_milliseconds := 30000)
      where exists (select 1 from public.mis_schedules where enabled and next_run <= now())
        and exists (select 1 from public.app_settings where name = 'mis_run' and coalesce(value->>'url', '') <> '')
    $c$);
  end if;
end $do$;

commit;
