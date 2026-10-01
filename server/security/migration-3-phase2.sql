-- Review of 30 Sep 2026, Phase 2 (security). Staging first (tds-desk-staging); live only after the firm has checked it.
-- Adds only: nothing is dropped or deleted.

-- 1. The 4 functions without a fixed search_path (advisor warning). None of them reads a table by an unqualified
--    name (touch_row uses auth.uid(), fully qualified), so the safest setting, an empty path, is used.
alter function public.touch_row() set search_path = '';
alter function public.inbox_guard() set search_path = '';
alter function public.activity_append_only() set search_path = '';
alter function public.support_sla(text, timestamptz, text) set search_path = '';

-- 2. EXECUTE only where the app needs it. PUBLIC and anon were already revoked (migration-1); these are the
--    functions signed-in users could still call although the app never does: trigger functions (a trigger runs
--    without EXECUTE), helpers called only from inside SECURITY DEFINER functions (which run as their owner), and
--    functions nothing calls. Kept for signed-in users: everything the app or an edge function calls, and the
--    helpers used inside row-level-security policies (my_firm, can_write, is_superadmin) and mfa_ok, and the cloud
--    posting queue of build 199 (tally_post_enqueue, tally_post_cancel, tally_vouchers_in: src/js/51-tally-queue.js on main).
revoke execute on function public.touch_row() from authenticated;
revoke execute on function public.inbox_guard() from authenticated;
revoke execute on function public.support_sla(text, timestamptz, text) from authenticated;
revoke execute on function public.support_can(uuid) from authenticated;
revoke execute on function public.support_row(public.support_tickets) from authenticated;
revoke execute on function public.mfa_required() from authenticated;
revoke execute on function public.admin_firms() from authenticated;
revoke execute on function public.admin_secrets() from authenticated;
revoke execute on function public.admin_price(text, numeric, text, text) from authenticated;
revoke execute on function public.tally_pick(text, date) from authenticated;
-- New functions are no longer callable by signed-in users until granted by name (migration-1 already did this for
-- PUBLIC and anon).
alter default privileges for role postgres in schema public revoke execute on functions from authenticated;

-- 3. Lockout after 5 wrong passwords in 15 minutes, for 15 minutes.
--    The sign-in edge function (server/security/functions/signin) counts the failures here; the access-token hook
--    below refuses a token to a locked account, so the lock holds whichever way the sign-in comes in, and a session
--    already open is refused at its next refresh. Reachable only by the service role and by Supabase Auth.
create table if not exists public.auth_lockout (
  email text primary key,
  fails integer not null default 0,
  first_fail_at timestamptz,
  locked_until timestamptz,
  unlocked_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.auth_lockout enable row level security;
revoke all on public.auth_lockout from public, anon, authenticated;

create or replace function public.auth_lockout_fail(p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.auth_lockout;
begin
  insert into public.auth_lockout as a (email, fails, first_fail_at, updated_at)
  values (lower(p_email), 1, now(), now())
  on conflict (email) do update set
    fails = case when a.first_fail_at is null or a.first_fail_at < now() - interval '15 minutes' then 1 else a.fails + 1 end,
    first_fail_at = case when a.first_fail_at is null or a.first_fail_at < now() - interval '15 minutes' then now() else a.first_fail_at end,
    updated_at = now()
  returning * into r;
  if r.fails >= 5 and (r.locked_until is null or r.locked_until < now()) then
    update public.auth_lockout set locked_until = now() + interval '15 minutes' where email = r.email returning * into r;
  end if;
  return jsonb_build_object('fails', r.fails, 'locked_until', r.locked_until);
end $$;

create or replace function public.auth_lockout_clear(p_email text, p_by uuid default null)
returns void language sql security definer set search_path = '' as $$
  update public.auth_lockout set fails = 0, first_fail_at = null, locked_until = null, unlocked_by = p_by, updated_at = now()
  where email = lower(p_email);
$$;

create or replace function public.auth_lockout_until(p_email text)
returns timestamptz language sql stable security definer set search_path = '' as $$
  select locked_until from public.auth_lockout where email = lower(p_email) and locked_until > now();
$$;

revoke execute on function public.auth_lockout_fail(text) from public, anon, authenticated;
revoke execute on function public.auth_lockout_clear(text, uuid) from public, anon, authenticated;
revoke execute on function public.auth_lockout_until(text) from public, anon, authenticated;
grant execute on function public.auth_lockout_fail(text) to service_role;
grant execute on function public.auth_lockout_clear(text, uuid) to service_role;
grant execute on function public.auth_lockout_until(text) to service_role;

-- Custom access token hook: no token for a locked account. Switched on in the dashboard:
-- Authentication -> Hooks -> Customize Access Token -> public.lockout_access_token_hook
create or replace function public.lockout_access_token_hook(event jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare until timestamptz;
begin
  select l.locked_until into until
  from public.auth_lockout l join auth.users u on lower(u.email) = l.email
  where u.id = (event->>'user_id')::uuid and l.locked_until > now();
  if until is not null then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403,
      'message', 'Too many wrong passwords. Try again after ' || to_char(until at time zone 'Asia/Kolkata', 'HH24:MI') || ', or ask the firm''s owner to unlock you.'));
  end if;
  return event;
end $$;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.lockout_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.lockout_access_token_hook(jsonb) from public, anon, authenticated;
grant select on public.auth_lockout to supabase_auth_admin;
create policy auth_lockout_hook_read on public.auth_lockout for select to supabase_auth_admin using (true);
