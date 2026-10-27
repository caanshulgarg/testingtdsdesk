-- FinCom Console, phase 1 "Foundation" (27-Oct-2026, branch next-console-p1; docs/CONSOLE-SETUP.md; the plan:
-- console-plan.md sections 2.4, 3.14, 4 and 5). NOT run on staging by the console's builder: the owner runs it.
-- Number: 118 (116 is the last in the repo; 117 is left for the plan's fix-first work). Needs nothing newer than
-- migration 112 (auth_rate_hit, which the console-admin function calls for its rate limits).
--
-- What it adds (add-only; nothing dropped or rewritten; one transaction, lock_timeout 10 s; safe to run twice):
--   console_admins   who may use console.fincom.live: one row per Supabase login (user_id), its role (owner, billing,
--                    support, viewer), active, who added it and when. Removing an admin switches the row off (kept).
--                    A trigger refuses any change that would leave no active owner (demote, switch off, delete).
--   console_audit    the change history: one row per console action, views of a person's data included: who, their
--                    role, the action, the target (type and id), before and after (jsonb), the reason, IP, browser,
--                    when. Append-only: a trigger refuses update, delete and truncate, for every role.
--   console_*()      functions the console-admin edge function calls with the service role (nobody else may):
--                    console_audit_add, console_admins_list, console_admin_add / _set_role / _remove (the change and
--                    its audit row in one transaction; each re-checks that the caller is an active owner and that
--                    nobody changes their own role), console_dashboard, console_firms, console_firm, console_users,
--                    console_user, console_audit_list (read-only: account data, counts and sums; never a client's
--                    name, books or activity text), console_signout_all (ends a login's sessions).
--   switching off and on (the owner's ask of 27-Oct-2026; nothing is ever deleted):
--     firms.status (active, suspended, closed) + status_reason / status_by / status_at. A suspended or closed firm is
--       READ-ONLY: its members still read everything (my_firm() is unchanged), but can_write() answers false (wrapped,
--       its own text kept, with firm_is_writable()), so every RPC and policy that asks can_write() refuses; no posting
--       to Tally is queued, and the bridge takes none of the waiting ones (trigger console_post_guard).
--       my_firm_status() (signed-in people) gives the app the status and reason for its "paused" page.
--     members.console_off_at: the member rows the console switched off with the person (restored exactly on reactivate).
--     clients.status (active, deactivated) + status_reason / status_by / status_at: no posting to Tally for it.
--     console_user_set_active, console_firm_set_status, console_company_set_status (the change and its audit row in
--     one transaction, each re-checking the caller's role), console_companies, console_company.
-- Grants: RLS on with no policy, and the service role only (console_audit: select and insert, never update or delete).
-- anon and authenticated get nothing: the console's browser reads everything through the console-admin function.
-- No seed row. The owner's own admin row is a separate statement (docs/CONSOLE-SETUP.md, step D).
-- Tested on pg_stand: tests/run_migration118.py (RED_WITHOUT_118=1 shows the checks fail without it).

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- tables
create table if not exists public.console_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('owner', 'billing', 'support', 'viewer')),
  active     boolean not null default true,
  added_by   uuid,
  added_at   timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.console_admins enable row level security;
revoke all on public.console_admins from public, anon, authenticated;
grant select, insert, update, delete on public.console_admins to service_role;

create table if not exists public.console_audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  who         uuid,
  role        text,
  action      text not null check (action ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$' and length(action) <= 64),
  target_type text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  reason      text check (reason is null or length(reason) <= 1000),
  ip          text,
  user_agent  text
);
create index if not exists console_audit_at on public.console_audit (at desc);
create index if not exists console_audit_who on public.console_audit (who, at desc);
create index if not exists console_audit_target on public.console_audit (target_type, target_id, at desc);
alter table public.console_audit enable row level security;
revoke all on public.console_audit from public, anon, authenticated;
grant select, insert on public.console_audit to service_role;

-- ---------------------------------------------------------------- guards
-- the change history can only be added to
create or replace function public.console_audit_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'console_audit is append-only (% refused)', tg_op using errcode = '42501';
end $$;
drop trigger if exists console_audit_no_change on public.console_audit;
create trigger console_audit_no_change before update or delete on public.console_audit
  for each row execute function public.console_audit_guard();
drop trigger if exists console_audit_no_truncate on public.console_audit;
create trigger console_audit_no_truncate before truncate on public.console_audit
  for each statement execute function public.console_audit_guard();

-- there is always one active owner: a change that would leave none is refused (by the functions and by direct SQL)
create or replace function public.console_admins_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active) then
    perform pg_advisory_xact_lock(hashtextextended('console_admins:last_owner', 0));
    if not exists (select 1 from public.console_admins a
                    where a.role = 'owner' and a.active and a.user_id <> old.user_id) then
      raise exception 'console: last_owner' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists console_admins_last_owner on public.console_admins;
create trigger console_admins_last_owner before update or delete on public.console_admins
  for each row execute function public.console_admins_guard();

-- ---------------------------------------------------------------- audit
create or replace function public.console_audit_add(p_who uuid, p_role text, p_action text, p_target_type text, p_target_id text,
  p_before jsonb, p_after jsonb, p_reason text, p_ip text, p_ua text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  insert into public.console_audit (who, role, action, target_type, target_id, before, after, reason, ip, user_agent)
  values (p_who, p_role, p_action, left(p_target_type, 40), left(p_target_id, 200), p_before, p_after,
          nullif(left(p_reason, 1000), ''), left(p_ip, 64), left(p_ua, 300))
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- admins (owner only; the change and its audit row together)
create or replace function public.console_admin_owner_check(p_by uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.console_admins where user_id = p_by and active and role = 'owner') then
    raise exception 'console: not_owner' using errcode = '42501';
  end if;
end $$;

create or replace function public.console_admins_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', a.user_id, 'email', u.email, 'role', a.role, 'active', a.active,
           'added_by', a.added_by, 'added_by_email', b.email, 'added_at', a.added_at, 'updated_at', a.updated_at,
           'last_sign_in_at', u.last_sign_in_at,
           'mfa', exists (select 1 from auth.mfa_factors f where f.user_id = a.user_id and f.status = 'verified'))
         order by a.active desc, a.role, u.email), '[]'::jsonb)
    from public.console_admins a
    left join auth.users u on u.id = a.user_id
    left join auth.users b on b.id = a.added_by
$$;

create or replace function public.console_admin_add(p_by uuid, p_email text, p_role text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_old public.console_admins; v_new public.console_admins;
begin
  perform public.console_admin_owner_check(p_by);
  if p_role is null or p_role not in ('owner', 'billing', 'support', 'viewer') then
    raise exception 'console: bad_role' using errcode = '22023';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email)) order by created_at limit 1;
  if v_user is null then raise exception 'console: no_login' using errcode = 'P0002'; end if;
  select * into v_old from public.console_admins where user_id = v_user for update;
  if found and v_old.active then raise exception 'console: already_admin' using errcode = '23505'; end if;
  if found then
    update public.console_admins set role = p_role, active = true, updated_by = p_by where user_id = v_user returning * into v_new;
  else
    insert into public.console_admins (user_id, role, active, added_by, updated_by) values (v_user, p_role, true, p_by, p_by) returning * into v_new;
  end if;
  perform public.console_audit_add(p_by, 'owner', 'admins.add', 'admin', v_user::text,
    case when v_old.user_id is null then null else jsonb_build_object('role', v_old.role, 'active', v_old.active) end,
    jsonb_build_object('role', v_new.role, 'active', v_new.active, 'email', lower(trim(p_email))), p_reason, p_ip, p_ua);
  return jsonb_build_object('user_id', v_user, 'role', v_new.role, 'active', v_new.active);
end $$;

create or replace function public.console_admin_set_role(p_by uuid, p_user uuid, p_role text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old public.console_admins;
begin
  perform public.console_admin_owner_check(p_by);
  if p_by = p_user then raise exception 'console: own_role' using errcode = '42501'; end if;
  if p_role is null or p_role not in ('owner', 'billing', 'support', 'viewer') then
    raise exception 'console: bad_role' using errcode = '22023';
  end if;
  select * into v_old from public.console_admins where user_id = p_user and active for update;
  if not found then raise exception 'console: not_admin' using errcode = 'P0002'; end if;
  update public.console_admins set role = p_role, updated_by = p_by where user_id = p_user;
  perform public.console_audit_add(p_by, 'owner', 'admins.set_role', 'admin', p_user::text,
    jsonb_build_object('role', v_old.role), jsonb_build_object('role', p_role), p_reason, p_ip, p_ua);
  return jsonb_build_object('user_id', p_user, 'role', p_role);
end $$;

create or replace function public.console_admin_remove(p_by uuid, p_user uuid, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old public.console_admins;
begin
  perform public.console_admin_owner_check(p_by);
  if p_by = p_user then raise exception 'console: own_role' using errcode = '42501'; end if;
  select * into v_old from public.console_admins where user_id = p_user and active for update;
  if not found then raise exception 'console: not_admin' using errcode = 'P0002'; end if;
  update public.console_admins set active = false, updated_by = p_by where user_id = p_user;
  perform public.console_audit_add(p_by, 'owner', 'admins.remove', 'admin', p_user::text,
    jsonb_build_object('role', v_old.role, 'active', true), jsonb_build_object('role', v_old.role, 'active', false), p_reason, p_ip, p_ua);
  return jsonb_build_object('user_id', p_user, 'active', false);
end $$;

-- ---------------------------------------------------------------- read-only views (account data, counts and sums)
create or replace function public.console_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_from timestamptz := ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata';
  v jsonb; n bigint; m bigint;
begin
  select jsonb_build_object(
    'firms', (select count(*) from public.firms),
    'firms_active', (select count(*) from public.firms where coalesce(active, true)),
    'people', (select count(*) from public.members where active),
    'active_7d', (select count(distinct m.user_id) from public.members m join auth.users u on u.id = m.user_id
                   where m.active and u.last_sign_in_at > now() - interval '7 days'),
    'active_30d', (select count(distinct m.user_id) from public.members m join auth.users u on u.id = m.user_id
                    where m.active and u.last_sign_in_at > now() - interval '30 days'),
    'signups_7d', (select count(*) from public.firms where created_at > now() - interval '7 days'),
    'credit_held', (select coalesce(sum(balance), 0) from public.firms),
    'low_balance', (select count(*) from public.firms where coalesce(active, true) and balance <= coalesce(low_balance_warn, 0)),
    'by_plan', (select coalesce(jsonb_agg(jsonb_build_object('plan', x.plan, 'n', x.n) order by x.n desc, x.plan), '[]'::jsonb)
                  from (select coalesce(p.name, 'No plan') as plan, count(*) as n
                          from public.firms f left join public.plans p on p.id = f.plan_id group by 1) x),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'created_at', x.created_at, 'plan', x.plan)
                                         order by x.created_at desc), '[]'::jsonb)
                 from (select f.id, f.name, f.created_at, p.name as plan from public.firms f left join public.plans p on p.id = f.plan_id
                        order by f.created_at desc nulls last limit 8) x),
    'as_of', now()) into v;
  -- the optional parts: tables another feature's migration made (left out where it is missing)
  n := 0; m := 0;
  if to_regclass('public.tally_devices') is not null then
    execute 'select count(*) filter (where last_seen > now() - interval ''5 minutes''), count(*) from public.tally_devices where not coalesce(revoked, false)' into n, m;
  end if;
  v := v || jsonb_build_object('bridges_online', n, 'bridges', m);
  n := 0;
  if to_regclass('public.tally_post_jobs') is not null then
    execute 'select count(*) from public.tally_post_jobs where status = ''failed'' and updated_at >= $1' into n using v_from;
  end if;
  v := v || jsonb_build_object('failed_jobs_today', n);
  n := 0;
  if to_regclass('public.assistant_usage') is not null then
    execute 'select coalesce(sum(calls), 0) from public.assistant_usage where day = $1' into n using v_day;
  end if;
  select n + count(*) into n from public.wallet_entries where kind = 'charge' and code in ('claude', 'vision') and at >= v_from;
  v := v || jsonb_build_object('ai_calls_today', n);
  return v;
end $$;

create or replace function public.console_firms(p_q text, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat text; v_total bigint; v_rows jsonb;
begin
  v_pat := case when nullif(trim(p_q), '') is null then null
                else '%' || replace(replace(replace(lower(trim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  with hit as (
    select f.* from public.firms f
     where v_pat is null or lower(f.name) like v_pat
        or exists (select 1 from public.members m where m.firm_id = f.id and lower(coalesce(m.email, '')) like v_pat))
  select count(*) into v_total from hit;
  with hit as (
    select f.* from public.firms f
     where v_pat is null or lower(f.name) like v_pat
        or exists (select 1 from public.members m where m.firm_id = f.id and lower(coalesce(m.email, '')) like v_pat)
     order by f.created_at desc nulls last, f.name
     limit least(greatest(coalesce(p_limit, 50), 1), 5000) offset greatest(coalesce(p_offset, 0), 0))
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id, 'name', h.name, 'active', coalesce(h.active, true), 'status', h.status, 'status_reason', h.status_reason, 'plan', p.name, 'balance', h.balance,
           'low_balance_warn', h.low_balance_warn, 'created_at', h.created_at,
           'owner_email', (select min(m.email) from public.members m where m.firm_id = h.id and m.active and m.role = 'owner'),
           'members', (select count(*) from public.members m where m.firm_id = h.id and m.active),
           'clients', (select count(*) from public.clients c where c.firm_id = h.id and not coalesce(c.deleted, false)),
           'last_activity', (select max(a.at) from public.activity a where a.firm_id = h.id))
         order by h.created_at desc nulls last, h.name), '[]'::jsonb)
    into v_rows
    from hit h left join public.plans p on p.id = h.plan_id;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.console_firm(p_firm uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; n bigint := 0;
begin
  select jsonb_build_object(
    'id', f.id, 'name', f.name, 'active', coalesce(f.active, true), 'status', f.status, 'status_reason', f.status_reason, 'status_at', f.status_at,
    'status_by', (select x.email from auth.users x where x.id = f.status_by), 'plan', p.name, 'plan_id', f.plan_id,
    'balance', f.balance, 'low_balance_warn', f.low_balance_warn, 'period_start', f.period_start, 'created_at', f.created_at,
    'clients', (select count(*) from public.clients c where c.firm_id = f.id and not coalesce(c.deleted, false)),
    'clients_off', (select count(*) from public.clients c where c.firm_id = f.id and not coalesce(c.deleted, false) and c.status <> 'active'),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                  'user_id', m.user_id, 'name', m.name, 'email', coalesce(u.email, m.email), 'role', m.role, 'active', m.active,
                  'last_sign_in_at', u.last_sign_in_at,
                  'mfa', exists (select 1 from auth.mfa_factors x where x.user_id = m.user_id and x.status = 'verified'))
                  order by m.active desc, m.role, m.name), '[]'::jsonb)
                  from public.members m left join auth.users u on u.id = m.user_id where m.firm_id = f.id),
    -- what and when only: an activity row's text can name a client, so it is never sent
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'what', a.what, 'user_id', a.user_id) order by a.at desc), '[]'::jsonb)
                 from (select at, what, user_id from public.activity where firm_id = f.id order by at desc limit 20) a))
    into v
    from public.firms f left join public.plans p on p.id = f.plan_id where f.id = p_firm;
  if v is null then return null; end if;
  if to_regclass('public.tally_devices') is not null then
    execute 'select count(*) from public.tally_devices where firm_id = $1 and not coalesce(revoked, false)' into n using p_firm;
  end if;
  return v || jsonb_build_object('bridges', n);
end $$;

create or replace function public.console_users(p_q text, p_firm uuid, p_role text, p_mfa boolean, p_active boolean, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat text; v_total bigint; v_rows jsonb;
begin
  v_pat := case when nullif(trim(p_q), '') is null then null
                else '%' || replace(replace(replace(lower(trim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  with u as (
    select m.user_id, m.name, coalesce(u.email, m.email) as email, m.firm_id, f.name as firm, m.role, m.active, u.last_sign_in_at,
           m.console_off_at is not null as switched_off, f.status as firm_status,
           exists (select 1 from auth.mfa_factors x where x.user_id = m.user_id and x.status = 'verified') as mfa
      from public.members m
      left join auth.users u on u.id = m.user_id
      left join public.firms f on f.id = m.firm_id
     where (v_pat is null or lower(coalesce(m.name, '')) like v_pat or lower(coalesce(u.email, m.email, '')) like v_pat or lower(coalesce(f.name, '')) like v_pat)
       and (p_firm is null or m.firm_id = p_firm)
       and (p_role is null or m.role = p_role)
       and (p_active is null or m.active = p_active)),
  hit as (select * from u where p_mfa is null or u.mfa = p_mfa),
  page as (select * from hit order by last_sign_in_at desc nulls last, email
            limit least(greatest(coalesce(p_limit, 50), 1), 5000) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from hit),
         coalesce((select jsonb_agg(to_jsonb(t) order by t.last_sign_in_at desc nulls last, t.email) from page t), '[]'::jsonb)
    into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.console_user(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'user_id', u.id, 'email', u.email, 'created_at', u.created_at, 'last_sign_in_at', u.last_sign_in_at,
    'email_confirmed', u.email_confirmed_at is not null, 'banned_until', u.banned_until,
    'switched_off', exists (select 1 from public.members x where x.user_id = u.id and x.console_off_at is not null), 'provider', coalesce(u.raw_app_meta_data ->> 'provider', 'email'),
    'name', m.name, 'firm_id', m.firm_id, 'firm', f.name, 'role', m.role, 'active', m.active,
    'console_role', (select a.role from public.console_admins a where a.user_id = u.id and a.active),
    'sessions', (select count(*) from auth.sessions s where s.user_id = u.id),
    'factors', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'type', x.factor_type, 'status', x.status,
                                  'name', x.friendly_name, 'created_at', x.created_at) order by x.created_at), '[]'::jsonb)
                  from auth.mfa_factors x where x.user_id = u.id),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'what', a.what) order by a.at desc), '[]'::jsonb)
                 from (select at, what from public.activity where user_id = u.id order by at desc limit 20) a))
    into v
    from auth.users u
    left join public.members m on m.user_id = u.id
    left join public.firms f on f.id = m.firm_id
   where u.id = p_user
   limit 1;
  return v;
end $$;

-- the change history. p_scope_role null: every row (Owner). Otherwise only the viewer's own rows and their role's
-- (Billing: own and billing; Support: own and support; plan 2.4)
create or replace function public.console_audit_list(p_scope_who uuid, p_scope_role text, p_action text, p_who uuid, p_target text,
  p_from timestamptz, p_to timestamptz, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat text; v_total bigint; v_rows jsonb;
begin
  v_pat := case when nullif(trim(p_action), '') is null then null
                else replace(replace(replace(lower(trim(p_action)), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  select count(*) into v_total from public.console_audit c
   where (p_scope_role is null or c.who = p_scope_who or c.role = p_scope_role)
     and (v_pat is null or c.action like v_pat) and (p_who is null or c.who = p_who)
     and (p_target is null or c.target_id = p_target) and (p_from is null or c.at >= p_from) and (p_to is null or c.at < p_to);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'at', x.at, 'who', x.who, 'who_email', u.email, 'role', x.role,
           'action', x.action, 'target_type', x.target_type, 'target_id', x.target_id, 'before', x.before, 'after', x.after,
           'reason', x.reason, 'ip', x.ip, 'user_agent', x.user_agent) order by x.id desc), '[]'::jsonb)
    into v_rows
    from (select * from public.console_audit c
           where (p_scope_role is null or c.who = p_scope_who or c.role = p_scope_role)
             and (v_pat is null or c.action like v_pat) and (p_who is null or c.who = p_who)
             and (p_target is null or c.target_id = p_target) and (p_from is null or c.at >= p_from) and (p_to is null or c.at < p_to)
           order by c.id desc
           limit least(greatest(coalesce(p_limit, 50), 1), 5000) offset greatest(coalesce(p_offset, 0), 0)) x
    left join auth.users u on u.id = x.who;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------- Support's write: sign out everywhere
-- ends every session of the login (its refresh tokens go with them); an access token already issued lasts until it
-- expires (at most the project's JWT expiry, 1 hour by default)
create or replace function public.console_signout_all(p_user uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- switching off and on (nothing is ever deleted)
-- firms: a status beside the old on/off (firms.active, which charging reads). suspended or closed = read-only: members
-- still read everything; can_write() answers false (so every RPC and policy that asks it refuses), no new posting to
-- Tally is queued and the bridge takes none of the waiting ones (they stay waiting).
alter table public.firms add column if not exists status text not null default 'active';
alter table public.firms add column if not exists status_reason text;
alter table public.firms add column if not exists status_by uuid;
alter table public.firms add column if not exists status_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'firms_status_check' and conrelid = 'public.firms'::regclass) then
    alter table public.firms add constraint firms_status_check check (status in ('active', 'suspended', 'closed'));
  end if;
end $$;
-- members: which member rows the console switched off (so switching the person on again restores exactly those)
alter table public.members add column if not exists console_off_at timestamptz;
-- clients (a firm's companies): switched off by the console; hidden from lists, no posting to Tally, no per-client fee
alter table public.clients add column if not exists status text not null default 'active';
alter table public.clients add column if not exists status_reason text;
alter table public.clients add column if not exists status_by uuid;
alter table public.clients add column if not exists status_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clients_status_check' and conrelid = 'public.clients'::regclass) then
    alter table public.clients add constraint clients_status_check check (status in ('active', 'deactivated'));
  end if;
end $$;

-- the signed-in person's firm takes changes (false while it is suspended or closed). Called by can_write().
create or replace function public.firm_is_writable()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.members m join public.firms f on f.id = m.firm_id
                      where m.user_id = auth.uid() and m.active and f.status <> 'active')
$$;
-- for the user app's "Your firm's FinCom account is paused" page: the caller's own firm's status and reason only
create or replace function public.my_firm_status()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('status', f.status, 'reason', f.status_reason, 'at', f.status_at)
                     from public.members m join public.firms f on f.id = m.firm_id
                    where m.user_id = auth.uid() and m.active limit 1), jsonb_build_object('status', null))
$$;
revoke all on function public.firm_is_writable() from public, anon;
revoke all on function public.my_firm_status() from public, anon;
grant execute on function public.firm_is_writable() to authenticated, service_role;
grant execute on function public.my_firm_status() to authenticated, service_role;

-- can_write() (the base schema's: owner or staff, active) gains "and the firm takes changes". Its own text is kept as
-- it is on the database (it is not in the repo): wrapped, not rewritten. Done once (a second run sees the wrap); a
-- can_write that is not a one-statement SQL function is left alone with a notice (then only the posting guard holds).
do $$
declare v_oid oid; v_src text; v_lang text; v_def text; v_body text;
begin
  select p.oid, p.prosrc, l.lanname into v_oid, v_src, v_lang
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
   where n.nspname = 'public' and p.proname = 'can_write' and p.pronargs = 0;
  if v_oid is null then
    raise notice 'console 118: public.can_write() not found; left as it is';
  elsif position('firm_is_writable' in v_src) > 0 then
    null;
  else
    v_body := regexp_replace(btrim(v_src, E' \n\t\r'), ';\s*$', '');
    if v_lang <> 'sql' or position(';' in v_body) > 0 or v_body !~* '^select\s' then
      raise notice 'console 118: public.can_write() is not a one-statement SQL function; left as it is';
    else
      v_def := pg_get_functiondef(v_oid);
      v_def := replace(v_def, v_src, E'\n  select (' || v_body || E') and public.firm_is_writable()\n');
      execute v_def;
    end if;
  end if;
end $$;

-- posting to Tally: none queued for a paused firm or a switched-off company; a waiting one is not taken (it waits)
create or replace function public.console_post_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_off boolean;
begin
  select exists (select 1 from public.firms f where f.id = new.firm_id and f.status <> 'active')
      or exists (select 1 from public.clients c where c.firm_id = new.firm_id and c.id::text = new.client_id::text and c.status <> 'active')
    into v_off;
  if not v_off then return new; end if;
  if tg_op = 'INSERT' then
    raise exception 'This firm''s FinCom account is paused, or this company is switched off: nothing can be posted to Tally.' using errcode = '42501';
  end if;
  if old.status = 'waiting' and new.status in ('taken', 'running') then return null; end if;
  return new;
end $$;
do $$ begin
  if to_regclass('public.tally_post_jobs') is not null then
    execute 'drop trigger if exists console_post_guard on public.tally_post_jobs';
    execute 'create trigger console_post_guard before insert or update on public.tally_post_jobs for each row execute function public.console_post_guard()';
  end if;
end $$;

-- the caller's console role, when it is one of p_roles (the functions' own check, beside the router's)
create or replace function public.console_role_check(p_by uuid, p_roles text[])
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text;
begin
  select role into v from public.console_admins where user_id = p_by and active;
  if v is null or not (v = any (p_roles)) then raise exception 'console: not_allowed' using errcode = '42501'; end if;
  return v;
end $$;

-- a person (Support or Owner): switched off in every firm they belong to and signed out (the edge function also bans
-- the login in Supabase Auth), or on again: exactly the member rows the console switched off. A console admin's
-- login only by an Owner; nobody their own.
create or replace function public.console_user_set_active(p_by uuid, p_user uuid, p_active boolean, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_before jsonb; n integer := 0; s integer := 0;
begin
  v_role := public.console_role_check(p_by, array['owner', 'support']);
  if p_by = p_user then raise exception 'console: own_role' using errcode = '42501'; end if;
  if v_role <> 'owner' and exists (select 1 from public.console_admins where user_id = p_user and active) then
    raise exception 'console: admin_target' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'console: no_user' using errcode = 'P0002'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('firm_id', firm_id, 'active', active, 'console_off', console_off_at is not null) order by firm_id), '[]'::jsonb)
    into v_before from public.members where user_id = p_user;
  if p_active then
    update public.members set active = true, console_off_at = null where user_id = p_user and console_off_at is not null;
    get diagnostics n = row_count;
  else
    update public.members set active = false, console_off_at = now() where user_id = p_user and active;
    get diagnostics n = row_count;
    delete from auth.sessions where user_id = p_user;
    get diagnostics s = row_count;
  end if;
  perform public.console_audit_add(p_by, v_role, case when p_active then 'user.reactivate' else 'user.deactivate' end, 'user', p_user::text,
    jsonb_build_object('members', v_before), jsonb_build_object('members_changed', n, 'sessions_ended', s, 'active', p_active), p_reason, p_ip, p_ua);
  return jsonb_build_object('user_id', p_user, 'active', p_active, 'members_changed', n, 'sessions_ended', s);
end $$;

-- a firm (Owner only): active, suspended or closed, with the reason, who and when
create or replace function public.console_firm_set_status(p_by uuid, p_firm uuid, p_status text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old record;
begin
  v_role := public.console_role_check(p_by, array['owner']);
  if p_status is null or p_status not in ('active', 'suspended', 'closed') then raise exception 'console: bad_status' using errcode = '22023'; end if;
  select status, status_reason into v_old from public.firms where id = p_firm for update;
  if not found then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  if v_old.status = p_status then raise exception 'console: same_status' using errcode = '22023'; end if;
  update public.firms set status = p_status, status_reason = nullif(left(p_reason, 1000), ''), status_by = p_by, status_at = now() where id = p_firm;
  perform public.console_audit_add(p_by, v_role, case when p_status = 'active' then 'firm.reactivate' else 'firm.deactivate' end, 'firm', p_firm::text,
    jsonb_build_object('status', v_old.status, 'reason', v_old.status_reason), jsonb_build_object('status', p_status), p_reason, p_ip, p_ua);
  return jsonb_build_object('firm_id', p_firm, 'status', p_status);
end $$;

-- a company, i.e. one of a firm's clients (Support or Owner)
create or replace function public.console_company_set_status(p_by uuid, p_firm uuid, p_client text, p_status text, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old text;
begin
  v_role := public.console_role_check(p_by, array['owner', 'support']);
  if p_status is null or p_status not in ('active', 'deactivated') then raise exception 'console: bad_status' using errcode = '22023'; end if;
  select status into v_old from public.clients where firm_id = p_firm and id::text = p_client for update;
  if not found then raise exception 'console: no_company' using errcode = 'P0002'; end if;
  if v_old = p_status then raise exception 'console: same_status' using errcode = '22023'; end if;
  update public.clients set status = p_status, status_reason = nullif(left(p_reason, 1000), ''), status_by = p_by, status_at = now()
   where firm_id = p_firm and id::text = p_client;
  perform public.console_audit_add(p_by, v_role, case when p_status = 'active' then 'company.reactivate' else 'company.deactivate' end, 'company',
    p_firm::text || '/' || p_client, jsonb_build_object('status', v_old), jsonb_build_object('status', p_status), p_reason, p_ip, p_ua);
  return jsonb_build_object('firm_id', p_firm, 'client_id', p_client, 'status', p_status);
end $$;

-- companies across firms: name, GSTIN, firm, status (never the books: no data column)
create or replace function public.console_companies(p_q text, p_firm uuid, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_pat text; v_total bigint; v_rows jsonb;
begin
  v_pat := case when nullif(trim(p_q), '') is null then null
                else '%' || replace(replace(replace(lower(trim(p_q)), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  with hit as (
    select c.id::text as id, c.firm_id, f.name as firm, c.name, c.gstin, c.status, c.status_reason, c.status_at, coalesce(c.deleted, false) as deleted
      from public.clients c join public.firms f on f.id = c.firm_id
     where (p_firm is null or c.firm_id = p_firm)
       and (v_pat is null or lower(coalesce(c.name, '')) like v_pat or lower(coalesce(c.gstin, '')) like v_pat or lower(f.name) like v_pat)),
  page as (select * from hit order by firm, name limit least(greatest(coalesce(p_limit, 50), 1), 5000) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from hit), coalesce((select jsonb_agg(to_jsonb(t) order by t.firm, t.name) from page t), '[]'::jsonb) into v_total, v_rows;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

create or replace function public.console_company(p_firm uuid, p_client text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; n bigint := 0;
begin
  select jsonb_build_object('id', c.id::text, 'firm_id', c.firm_id, 'firm', f.name, 'firm_status', f.status, 'name', c.name, 'gstin', c.gstin,
           'status', c.status, 'status_reason', c.status_reason, 'status_at', c.status_at, 'status_by', u.email, 'deleted', coalesce(c.deleted, false))
    into v
    from public.clients c join public.firms f on f.id = c.firm_id left join auth.users u on u.id = c.status_by
   where c.firm_id = p_firm and c.id::text = p_client;
  if v is null then return null; end if;
  if to_regclass('public.tally_post_jobs') is not null then
    execute 'select count(*) from public.tally_post_jobs where firm_id = $1 and client_id::text = $2 and status = ''waiting''' into n using p_firm, p_client;
  end if;
  return v || jsonb_build_object('postings_waiting', n);
end $$;

-- ---------------------------------------------------------------- grants: the service role only
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'console\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

commit;
