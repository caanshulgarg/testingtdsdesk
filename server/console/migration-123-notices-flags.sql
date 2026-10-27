-- FinCom Console, phase 5 "Firm communication": announcements to firms and feature flags (27-Oct-2026, branch
-- next-console-ops; console-plan.md 3.10 and 3.12). NOT run on staging by the console's builder: the owner runs it.
-- Number: 123. Needs migration 118 (console_audit_add, console_role_check) and the base schema's my_firm().
--
-- What it adds (add-only; nothing dropped or rewritten; one transaction, lock_timeout 10 s; safe to run twice):
--   announcements            a title, a text, a severity (info, warning, urgent), an audience (all firms, the firms on
--                            chosen plans, or chosen firms), a start and an optional end, dismissible or not, and its
--                            state (draft, live, ended). Made and changed only by the console (Owner or Support).
--   announcement_dismissals  who dismissed which (one row per person and announcement).
--   feature_flags            a key, what it does, and its default (on or off).
--   feature_flag_rules       a plan's or a firm's own value for a flag, with an optional end date and a note. A firm's
--                            rule beats its plan's, which beats the default; an ended rule counts for nothing.
-- For the user app (signed-in people; each reads only what concerns the caller's own firm, worked out here):
--   announcements_active()   the live announcements for the caller's firm that the caller has not dismissed, most severe
--                            first (at most 5). The app shows the first as one bar.
--   announcement_dismiss(id) the caller dismisses one (a dismissible one that is shown to them); true when recorded.
--   flags_for_me()           {flag: true|false} for the caller's firm, every flag; the app reads it once and keeps it.
-- For the console (the service role only; each change and its audit row in one transaction):
--   console_announcements_list, console_announcement_save, console_announcement_end,
--   console_flags_list, console_flag_save, console_flag_rule_set, console_flag_rule_remove, console_flags_for_firm,
--   console_notice_choices (plans and firms, id and name, for the forms).
-- Grants: the four tables RLS on, no policy, the service role only; the user app's three functions to authenticated
-- (and the service role); every console_* function the service role only. Tested on pg_stand: tests/run_migration123.py.

begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- tables
create table if not exists public.announcements (
  id          uuid primary key default gen_random_uuid(),
  title       text not null check (length(btrim(title)) between 3 and 120),
  body        text not null default '' check (length(body) <= 1000),
  severity    text not null default 'info' check (severity in ('info', 'warning', 'urgent')),
  audience    text not null default 'all' check (audience in ('all', 'plans', 'firms')),
  plan_ids    uuid[] not null default '{}',
  firm_ids    uuid[] not null default '{}',
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,
  dismissible boolean not null default true,
  status      text not null default 'draft' check (status in ('draft', 'live', 'ended')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check (audience <> 'plans' or cardinality(plan_ids) > 0),
  check (audience <> 'firms' or cardinality(firm_ids) > 0)
);
create index if not exists announcements_live on public.announcements (status, starts_at desc);
create table if not exists public.announcement_dismissals (
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id         uuid not null,
  firm_id         uuid,
  at              timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

create table if not exists public.feature_flags (
  key         text primary key check (key ~ '^[a-z][a-z0-9_.]{1,60}$'),
  description text not null default '' check (length(description) <= 500),
  default_on  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_by  uuid,
  updated_at  timestamptz not null default now()
);
create table if not exists public.feature_flag_rules (
  id         bigint generated always as identity primary key,
  flag_key   text not null references public.feature_flags (key) on update cascade,
  scope      text not null check (scope in ('plan', 'firm')),
  target_id  uuid not null,
  value      boolean not null,
  until      timestamptz,
  note       text not null default '' check (length(note) <= 500),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (flag_key, scope, target_id)
);

do $$
declare t text;
begin
  foreach t in array array['announcements', 'announcement_dismissals', 'feature_flags', 'feature_flag_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
revoke all on sequence public.feature_flag_rules_id_seq from public, anon, authenticated;
grant usage, select on sequence public.feature_flag_rules_id_seq to service_role;

-- ---------------------------------------------------------------- the user app (signed-in people)
-- the caller's firm and its plan (null firm: no announcement, every flag at its default)
create or replace function public.notice_my_firm_plan(out firm_id uuid, out plan_id uuid)
language sql stable security definer set search_path = '' as $$
  select f.id, f.plan_id from public.firms f where f.id = public.my_firm()
$$;

create or replace function public.announcements_active()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_firm uuid; v_plan uuid;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select firm_id, plan_id into v_firm, v_plan from public.notice_my_firm_plan();
  if v_firm is null then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title, 'body', a.body, 'severity', a.severity,
            'dismissible', a.dismissible, 'starts_at', a.starts_at, 'ends_at', a.ends_at)
            order by case a.severity when 'urgent' then 0 when 'warning' then 1 else 2 end, a.starts_at desc), '[]'::jsonb)
    from (select * from public.announcements a
           where a.status = 'live' and a.starts_at <= now() and (a.ends_at is null or a.ends_at > now())
             and (a.audience = 'all' or (a.audience = 'plans' and v_plan = any (a.plan_ids)) or (a.audience = 'firms' and v_firm = any (a.firm_ids)))
             and not (a.dismissible and exists (select 1 from public.announcement_dismissals d where d.announcement_id = a.id and d.user_id = auth.uid()))
           order by case a.severity when 'urgent' then 0 when 'warning' then 1 else 2 end, a.starts_at desc
           limit 5) a);
end $$;

create or replace function public.announcement_dismiss(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or p_id is null then return false; end if;
  -- only one that is shown to the caller now, and that may be dismissed
  if not exists (select 1 from jsonb_array_elements(public.announcements_active()) x where (x->>'id')::uuid = p_id and (x->>'dismissible')::boolean) then
    return false;
  end if;
  insert into public.announcement_dismissals (announcement_id, user_id, firm_id) values (p_id, auth.uid(), public.my_firm())
  on conflict (announcement_id, user_id) do nothing;
  return true;
end $$;

-- every flag, resolved for one firm: the firm's rule, else its plan's, else the default (an ended rule counts for nothing)
create or replace function public.flags_resolve(p_firm uuid, p_plan uuid)
returns table (key text, value boolean, why text, until timestamptz)
language sql stable security definer set search_path = '' as $$
  select f.key,
         coalesce(fr.value, pr.value, f.default_on),
         case when fr.value is not null then 'firm' when pr.value is not null then 'plan' else 'default' end,
         coalesce(case when fr.value is not null then fr.until end, case when fr.value is null and pr.value is not null then pr.until end)
    from public.feature_flags f
    left join public.feature_flag_rules fr on fr.flag_key = f.key and fr.scope = 'firm' and p_firm is not null and fr.target_id = p_firm and (fr.until is null or fr.until > now())
    left join public.feature_flag_rules pr on pr.flag_key = f.key and pr.scope = 'plan' and p_plan is not null and pr.target_id = p_plan and (pr.until is null or pr.until > now())
$$;

create or replace function public.flags_for_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_firm uuid; v_plan uuid;
begin
  if auth.uid() is not null then select firm_id, plan_id into v_firm, v_plan from public.notice_my_firm_plan(); end if;
  return (select coalesce(jsonb_object_agg(r.key, r.value), '{}'::jsonb) from public.flags_resolve(v_firm, v_plan) r);
end $$;

revoke all on function public.notice_my_firm_plan(), public.announcements_active(), public.announcement_dismiss(uuid),
  public.flags_resolve(uuid, uuid), public.flags_for_me() from public, anon;
revoke all on function public.notice_my_firm_plan(), public.flags_resolve(uuid, uuid) from authenticated;
grant execute on function public.notice_my_firm_plan(), public.flags_resolve(uuid, uuid) to service_role;
grant execute on function public.announcements_active(), public.announcement_dismiss(uuid), public.flags_for_me() to authenticated, service_role;

-- ---------------------------------------------------------------- the console: announcements (Owner or Support)
create or replace function public.console_announcement_json(a public.announcements)
returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(a) || jsonb_build_object(
    'state', case when a.status <> 'live' then a.status when a.starts_at > now() then 'scheduled' when a.ends_at is not null and a.ends_at <= now() then 'ended' else 'live' end,
    'dismissed', (select count(*) from public.announcement_dismissals d where d.announcement_id = a.id),
    'firms_reached', case a.audience when 'all' then (select count(*) from public.firms)
                                     when 'plans' then (select count(*) from public.firms f where f.plan_id = any (a.plan_ids))
                                     else cardinality(a.firm_ids) end,
    'plans', (select coalesce(jsonb_agg(p.name order by p.name), '[]'::jsonb) from public.plans p where p.id = any (a.plan_ids)),
    'firms', (select coalesce(jsonb_agg(f.name order by f.name), '[]'::jsonb) from public.firms f where f.id = any (a.firm_ids)),
    'created_by_email', (select u.email from auth.users u where u.id = a.created_by),
    'updated_by_email', (select u.email from auth.users u where u.id = a.updated_by))
$$;

create or replace function public.console_announcements_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(public.console_announcement_json(a) order by a.created_at desc), '[]'::jsonb)
    from (select * from public.announcements order by created_at desc limit 5000) a
$$;

-- make (p_id null) or change one. p jsonb: title, body, severity, audience, plan_ids[], firm_ids[], starts_at, ends_at,
-- dismissible, status (draft | live). Ending is console_announcement_end.
create or replace function public.console_announcement_save(p_by uuid, p_id uuid, p jsonb, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old public.announcements; v_new public.announcements; v_plans uuid[]; v_firms uuid[];
begin
  v_role := public.console_role_check(p_by, array['owner', 'support']);
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'console: bad_value' using errcode = '22023'; end if;
  if coalesce(p->>'status', 'draft') not in ('draft', 'live') then raise exception 'console: bad_status' using errcode = '22023'; end if;
  begin
    v_plans := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'plan_ids', '[]'::jsonb)) x), '{}');
    v_firms := coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p->'firm_ids', '[]'::jsonb)) x), '{}');
  exception when others then raise exception 'console: bad_value' using errcode = '22023';
  end;
  if cardinality(v_firms) > 500 or cardinality(v_plans) > 50 then raise exception 'console: bad_value' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_firms) x where not exists (select 1 from public.firms f where f.id = x)) then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  if p_id is not null then
    select * into v_old from public.announcements where id = p_id for update;
    if not found then raise exception 'console: no_announcement' using errcode = 'P0002'; end if;
    if v_old.status = 'ended' then raise exception 'console: same_status' using errcode = '22023'; end if;
  end if;
  begin
    if p_id is null then
      insert into public.announcements (title, body, severity, audience, plan_ids, firm_ids, starts_at, ends_at, dismissible, status, created_by, updated_by)
      values (btrim(coalesce(p->>'title', '')), btrim(coalesce(p->>'body', '')), coalesce(p->>'severity', 'info'), coalesce(p->>'audience', 'all'),
              v_plans, v_firms, coalesce((p->>'starts_at')::timestamptz, now()), (p->>'ends_at')::timestamptz,
              coalesce((p->>'dismissible')::boolean, true), coalesce(p->>'status', 'draft'), p_by, p_by)
      returning * into v_new;
    else
      update public.announcements set title = btrim(coalesce(p->>'title', title)), body = btrim(coalesce(p->>'body', body)),
        severity = coalesce(p->>'severity', severity), audience = coalesce(p->>'audience', audience), plan_ids = v_plans, firm_ids = v_firms,
        starts_at = coalesce((p->>'starts_at')::timestamptz, starts_at), ends_at = (p->>'ends_at')::timestamptz,
        dismissible = coalesce((p->>'dismissible')::boolean, dismissible), status = coalesce(p->>'status', status), updated_by = p_by, updated_at = now()
       where id = p_id returning * into v_new;
    end if;
  exception
    when check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'console: bad_value' using errcode = '22023';
  end;
  perform public.console_audit_add(p_by, v_role, 'announcements.save', 'announcement', v_new.id::text,
    case when v_old.id is null then null else to_jsonb(v_old) - 'created_at' - 'updated_at' end,
    to_jsonb(v_new) - 'created_at' - 'updated_at', p_reason, p_ip, p_ua);
  return public.console_announcement_json(v_new);
end $$;

create or replace function public.console_announcement_end(p_by uuid, p_id uuid, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old public.announcements; v_new public.announcements;
begin
  v_role := public.console_role_check(p_by, array['owner', 'support']);
  select * into v_old from public.announcements where id = p_id for update;
  if not found then raise exception 'console: no_announcement' using errcode = 'P0002'; end if;
  if v_old.status = 'ended' then raise exception 'console: same_status' using errcode = '22023'; end if;
  update public.announcements set status = 'ended', ends_at = case when ends_at is null or ends_at > now() then greatest(now(), starts_at + interval '1 second') else ends_at end,
    updated_by = p_by, updated_at = now() where id = p_id returning * into v_new;
  perform public.console_audit_add(p_by, v_role, 'announcements.end', 'announcement', p_id::text,
    jsonb_build_object('status', v_old.status, 'ends_at', v_old.ends_at), jsonb_build_object('status', 'ended', 'ends_at', v_new.ends_at), p_reason, p_ip, p_ua);
  return public.console_announcement_json(v_new);
end $$;

-- ---------------------------------------------------------------- the console: feature flags (Owner changes them)
create or replace function public.console_flags_list()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', f.key, 'description', f.description, 'default_on', f.default_on, 'updated_at', f.updated_at,
           'updated_by_email', (select u.email from auth.users u where u.id = f.updated_by),
           'rules', (select count(*) from public.feature_flag_rules r where r.flag_key = f.key and (r.until is null or r.until > now())),
           'firms_on', (select count(*) from public.firms x where (select v.value from public.flags_resolve(x.id, x.plan_id) v where v.key = f.key)),
           'firms', (select count(*) from public.firms),
           'rule_list', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'scope', r.scope, 'target_id', r.target_id,
                            'target', case r.scope when 'plan' then (select p.name from public.plans p where p.id = r.target_id) else (select x.name from public.firms x where x.id = r.target_id) end,
                            'value', r.value, 'until', r.until, 'ended', r.until is not null and r.until <= now(), 'note', r.note, 'updated_at', r.updated_at,
                            'updated_by_email', (select u.email from auth.users u where u.id = r.updated_by)) order by r.scope, r.updated_at desc), '[]'::jsonb)
                          from public.feature_flag_rules r where r.flag_key = f.key))
         order by f.key), '[]'::jsonb)
    from public.feature_flags f
$$;

-- make or change a flag: its description and default
create or replace function public.console_flag_save(p_by uuid, p_key text, p_description text, p_default_on boolean, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old public.feature_flags; v_new public.feature_flags;
begin
  v_role := public.console_role_check(p_by, array['owner']);
  if p_key is null or p_key !~ '^[a-z][a-z0-9_.]{1,60}$' then raise exception 'console: bad_key' using errcode = '22023'; end if;
  if length(coalesce(p_description, '')) > 500 or p_default_on is null then raise exception 'console: bad_value' using errcode = '22023'; end if;
  select * into v_old from public.feature_flags where key = p_key for update;
  insert into public.feature_flags as f (key, description, default_on, updated_by) values (p_key, btrim(coalesce(p_description, '')), p_default_on, p_by)
  on conflict (key) do update set description = excluded.description, default_on = excluded.default_on, updated_by = p_by, updated_at = now()
  returning * into v_new;
  perform public.console_audit_add(p_by, v_role, 'flags.save', 'flag', p_key,
    case when v_old.key is null then null else jsonb_build_object('description', v_old.description, 'default_on', v_old.default_on) end,
    jsonb_build_object('description', v_new.description, 'default_on', v_new.default_on), p_reason, p_ip, p_ua);
  return to_jsonb(v_new);
end $$;

-- a plan's or a firm's own value (one per flag and target; set again: changed)
create or replace function public.console_flag_rule_set(p_by uuid, p_key text, p_scope text, p_target uuid, p_value boolean, p_until timestamptz, p_note text,
  p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old public.feature_flag_rules; v_new public.feature_flag_rules;
begin
  v_role := public.console_role_check(p_by, array['owner']);
  if not exists (select 1 from public.feature_flags where key = p_key) then raise exception 'console: no_flag' using errcode = 'P0002'; end if;
  if p_scope is null or p_scope not in ('plan', 'firm') or p_value is null or length(coalesce(p_note, '')) > 500 then raise exception 'console: bad_value' using errcode = '22023'; end if;
  if p_until is not null and p_until <= now() then raise exception 'console: bad_value' using errcode = '22023'; end if;
  if p_scope = 'firm' and not exists (select 1 from public.firms where id = p_target) then raise exception 'console: no_firm' using errcode = 'P0002'; end if;
  if p_scope = 'plan' and not exists (select 1 from public.plans where id = p_target) then raise exception 'console: no_plan' using errcode = 'P0002'; end if;
  select * into v_old from public.feature_flag_rules where flag_key = p_key and scope = p_scope and target_id = p_target for update;
  insert into public.feature_flag_rules as r (flag_key, scope, target_id, value, until, note, updated_by)
  values (p_key, p_scope, p_target, p_value, p_until, btrim(coalesce(p_note, '')), p_by)
  on conflict (flag_key, scope, target_id) do update set value = excluded.value, until = excluded.until, note = excluded.note, updated_by = p_by, updated_at = now()
  returning * into v_new;
  perform public.console_audit_add(p_by, v_role, 'flags.rule_set', 'flag', p_key,
    case when v_old.id is null then null else jsonb_build_object('scope', v_old.scope, 'target_id', v_old.target_id, 'value', v_old.value, 'until', v_old.until) end,
    jsonb_build_object('scope', v_new.scope, 'target_id', v_new.target_id, 'value', v_new.value, 'until', v_new.until, 'note', v_new.note), p_reason, p_ip, p_ua);
  return to_jsonb(v_new);
end $$;

create or replace function public.console_flag_rule_remove(p_by uuid, p_rule bigint, p_reason text, p_ip text, p_ua text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_role text; v_old public.feature_flag_rules;
begin
  v_role := public.console_role_check(p_by, array['owner']);
  delete from public.feature_flag_rules where id = p_rule returning * into v_old;
  if v_old.id is null then raise exception 'console: no_rule' using errcode = 'P0002'; end if;
  perform public.console_audit_add(p_by, v_role, 'flags.rule_remove', 'flag', v_old.flag_key,
    jsonb_build_object('scope', v_old.scope, 'target_id', v_old.target_id, 'value', v_old.value, 'until', v_old.until, 'note', v_old.note), null, p_reason, p_ip, p_ua);
  return jsonb_build_object('removed', v_old.id);
end $$;

-- every flag for one firm, with why (firm rule, plan rule or default)
create or replace function public.console_flags_for_firm(p_firm uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not exists (select 1 from public.firms where id = p_firm) then null else
    (select coalesce(jsonb_agg(jsonb_build_object('key', r.key, 'value', r.value, 'why', r.why, 'until', r.until) order by r.key), '[]'::jsonb)
       from public.firms f, public.flags_resolve(f.id, f.plan_id) r where f.id = p_firm) end
$$;

-- the choices the console's forms offer: plans and firms (id and name only)
create or replace function public.console_notice_choices()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::jsonb) from public.plans p),
    'firms', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name) order by f.name), '[]'::jsonb) from public.firms f))
$$;

-- ---------------------------------------------------------------- grants: console_* the service role only
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
