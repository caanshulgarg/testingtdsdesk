-- Sign-in attempts: counted where the password is checked; a wait that belongs to one email from one address
-- (13-Nov-2026, branch next-sec-server). NOT run on staging by the app's builders: the owner runs it.
-- Runs after 182 (183 to 188 are other branches'; it needs nothing of theirs). Needs migration 3 (public.auth_lockout
-- and its functions) and nothing else.
--
--   auth_signin_fails   one row per wrong password: the email (as a SHA-256) and the address it came from (as the
--                       SHA-256 the sign-in function sends; '' when Supabase Auth's own hook counted it), and when.
--   auth_signin_pass    the sign-in function's pass for one email and address: it lasts ten seconds and serves one
--                       password check.
--   auth_signin_begin(email, ip_key)   asked by the function before the password goes to Supabase Auth: whether this
--                       email may be tried from this address now ({allowed, fails, wait_s, until}); when it may, the
--                       pair's pass is written. Wrong passwords of one email from one address within 15 minutes: the
--                       first four cost nothing, then the wait after each is 30 s, 60 s, 2 min, 5 min and 15 min at
--                       most. A try during a wait is refused and not counted. Another address is not held by it.
--                       One call at a time for a pair (an advisory lock, as auth_rate_hit of migration 112 takes).
--   auth_signin_fail(email, ip_key)    a wrong password: counted for the pair, its pass ended; answers the wait.
--   auth_signin_ok(email, ip_key)      a right password: the pair's count and pass ended.
--   auth_password_attempt_hook(event)  Supabase Auth's "password verification attempt" hook ({user_id, valid}), run
--                       at every password check, whichever way it reached Auth. A wrong password is counted for the
--                       account. A check uses up one pass of the account (the oldest that is still good; Auth tells
--                       the hook the account, not the address). A check with no pass, on an account that had 10 wrong
--                       passwords within 15 minutes, is refused with one message, the password right or wrong; that
--                       ends by itself as the wrong ones age. Switched on in the dashboard:
--                       Authentication -> Hooks -> Password Verification Attempt -> public.auth_password_attempt_hook
--                       Every page that signs people in goes through the sign-in function (the app and the console).
--   auth_lockout_clear(email, by)      the owner's unlock, from migration 3 (its latest definition), which also ends
--                       the email's waits, counts and passes here.
--   auth_signin_sweep()                removes rows older than 2 days; pg_cron runs it hourly where it is installed.
-- The functions: service role only; the hook: Supabase Auth only. anon and authenticated nothing. Grants explicit.
-- Add-only: two new tables, seven new functions, one function replaced from its latest definition with its grants
-- restated, one cron job made when missing. The only deletes are of these two tables' own rows. One transaction,
-- lock_timeout 10 s. Safe to run twice.

begin;
set local lock_timeout = '10s';

create table if not exists public.auth_signin_fails (
  id        bigserial primary key,
  email_key text not null check (email_key ~ '^[0-9a-f]{64}$'),
  ip_key    text not null default '' check (ip_key ~ '^([0-9a-f]{64})?$'),
  at        timestamptz not null default now()
);
create index if not exists auth_signin_fails_key on public.auth_signin_fails (email_key, ip_key, at);
create index if not exists auth_signin_fails_at on public.auth_signin_fails (at);
alter table public.auth_signin_fails enable row level security;
revoke all on public.auth_signin_fails from public, anon, authenticated;
grant select, insert, delete on public.auth_signin_fails to service_role;
revoke all on sequence public.auth_signin_fails_id_seq from public, anon, authenticated;
grant usage, select on sequence public.auth_signin_fails_id_seq to service_role;

create table if not exists public.auth_signin_pass (
  email_key text not null check (email_key ~ '^[0-9a-f]{64}$'),
  ip_key    text not null check (ip_key ~ '^[0-9a-f]{64}$'),
  until     timestamptz not null,
  primary key (email_key, ip_key)
);
alter table public.auth_signin_pass enable row level security;
revoke all on public.auth_signin_pass from public, anon, authenticated;
grant select, insert, update, delete on public.auth_signin_pass to service_role;

-- the email as it is kept here
create or replace function public.auth_signin_key(p_email text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to('signin-account:' || lower(btrim(coalesce(p_email, ''))), 'UTF8')), 'hex');
$$;

-- the wait (seconds) after the n-th wrong password of one email from one address within 15 minutes
create or replace function public.auth_signin_wait(p_fails integer)
returns integer language sql immutable set search_path = '' as $$
  select case when coalesce(p_fails, 0) < 5 then 0 when p_fails = 5 then 30 when p_fails = 6 then 60 when p_fails = 7 then 120 when p_fails = 8 then 300 else 900 end;
$$;

create or replace function public.auth_signin_begin(p_email text, p_ip_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text := public.auth_signin_key(p_email); n integer; last timestamptz; w integer;
begin
  if coalesce(p_ip_key, '') !~ '^[0-9a-f]{64}$' then raise exception 'auth_signin_begin: the address as a SHA-256'; end if;
  perform pg_advisory_xact_lock(hashtextextended('auth_signin:' || k || ':' || p_ip_key, 0));
  select count(*), max(at) into n, last from public.auth_signin_fails
   where email_key = k and ip_key = p_ip_key and at > now() - interval '15 minutes';
  w := public.auth_signin_wait(n);
  if w > 0 and last + make_interval(secs => w) > now() then
    return jsonb_build_object('allowed', false, 'fails', n, 'wait_s', ceil(extract(epoch from last + make_interval(secs => w) - now()))::integer,
                              'until', last + make_interval(secs => w));
  end if;
  insert into public.auth_signin_pass as p (email_key, ip_key, until) values (k, p_ip_key, now() + interval '10 seconds')
  on conflict (email_key, ip_key) do update set until = excluded.until;
  return jsonb_build_object('allowed', true, 'fails', n);
end $$;

create or replace function public.auth_signin_fail(p_email text, p_ip_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare k text := public.auth_signin_key(p_email); n integer; w integer;
begin
  if coalesce(p_ip_key, '') !~ '^[0-9a-f]{64}$' then raise exception 'auth_signin_fail: the address as a SHA-256'; end if;
  perform pg_advisory_xact_lock(hashtextextended('auth_signin:' || k || ':' || p_ip_key, 0));
  delete from public.auth_signin_pass where email_key = k and ip_key = p_ip_key;
  delete from public.auth_signin_fails where email_key = k and at < now() - interval '2 days';
  insert into public.auth_signin_fails (email_key, ip_key) values (k, p_ip_key);
  select count(*) into n from public.auth_signin_fails
   where email_key = k and ip_key = p_ip_key and at > now() - interval '15 minutes';
  w := public.auth_signin_wait(n);
  return jsonb_build_object('fails', n, 'wait_s', w, 'until', case when w > 0 then now() + make_interval(secs => w) end);
end $$;

create or replace function public.auth_signin_ok(p_email text, p_ip_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare k text := public.auth_signin_key(p_email);
begin
  delete from public.auth_signin_pass where email_key = k and ip_key = coalesce(p_ip_key, '');
  delete from public.auth_signin_fails where email_key = k and ip_key = coalesce(p_ip_key, '') and ip_key <> '';
end $$;

-- Supabase Auth's hook. Payload {user_id, valid}; answer {decision: continue} or {decision: reject, message,
-- should_logout_user} (Supabase Auth docs, auth-hooks/password-verification-hook).
-- One pass serves one check: the oldest good pass of the account is removed here, the password right or wrong. A check
-- without one, on an account with 10 wrong passwords in 15 minutes, gets the same refusal either way.
create or replace function public.auth_password_attempt_hook(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid; em text; k text; n integer; right_one boolean := coalesce(event->>'valid', '') = 'true'; had boolean;
begin
  begin uid := nullif(event->>'user_id', '')::uuid; exception when others then uid := null; end;
  if uid is not null then select lower(u.email) into em from auth.users u where u.id = uid; end if;
  if em is null or em = '' then return jsonb_build_object('decision', 'continue'); end if;
  k := public.auth_signin_key(em);
  with one as (select p.email_key, p.ip_key from public.auth_signin_pass p
                where p.email_key = k and p.until > now() order by p.until limit 1 for update skip locked)
  delete from public.auth_signin_pass p using one where p.email_key = one.email_key and p.ip_key = one.ip_key
  returning true into had;
  select count(*) into n from public.auth_signin_fails where email_key = k and ip_key = '' and at > now() - interval '15 minutes';
  if not right_one then insert into public.auth_signin_fails (email_key, ip_key) values (k, ''); end if;
  if had is not true and n >= 10 then
    return jsonb_build_object('decision', 'reject', 'should_logout_user', false,
      'message', 'Too many wrong passwords for this account. Sign in from FinCom''s own sign-in page, or try again in 15 minutes.');
  end if;
  return jsonb_build_object('decision', 'continue');
end $$;

-- the owner's unlock: as migration 3 has it, and the waits, counts and passes of this file
create or replace function public.auth_lockout_clear(p_email text, p_by uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.auth_lockout set fails = 0, first_fail_at = null, locked_until = null, unlocked_by = p_by, updated_at = now()
   where email = lower(btrim(p_email));
  -- an unlock by a person (p_by): every address's wait and the account's count end. The sign-in function's own call
  -- after a right password (p_by null) ends only its own pair, with auth_signin_ok
  if p_by is not null then
    delete from public.auth_signin_fails where email_key = public.auth_signin_key(p_email);
    delete from public.auth_signin_pass where email_key = public.auth_signin_key(p_email);
  end if;
end $$;

create or replace function public.auth_signin_sweep()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.auth_signin_pass where until < now() - interval '1 hour';
  delete from public.auth_signin_fails where at < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.auth_signin_key(text) from public, anon, authenticated;
revoke execute on function public.auth_signin_wait(integer) from public, anon, authenticated;
revoke execute on function public.auth_signin_begin(text, text) from public, anon, authenticated;
revoke execute on function public.auth_signin_fail(text, text) from public, anon, authenticated;
revoke execute on function public.auth_signin_ok(text, text) from public, anon, authenticated;
revoke execute on function public.auth_password_attempt_hook(jsonb) from public, anon, authenticated;
revoke execute on function public.auth_lockout_clear(text, uuid) from public, anon, authenticated;
revoke execute on function public.auth_signin_sweep() from public, anon, authenticated;
grant execute on function public.auth_signin_key(text) to service_role;
grant execute on function public.auth_signin_wait(integer) to service_role;
grant execute on function public.auth_signin_begin(text, text) to service_role;
grant execute on function public.auth_signin_fail(text, text) to service_role;
grant execute on function public.auth_signin_ok(text, text) to service_role;
grant execute on function public.auth_lockout_clear(text, uuid) to service_role;
grant execute on function public.auth_signin_sweep() to service_role;
-- the hook is Supabase Auth's alone
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.auth_password_attempt_hook(jsonb) to supabase_auth_admin;
  end if;
end $$;

-- the hourly sweep, where pg_cron is installed; made once
do $$
begin
  if to_regclass('cron.job') is not null and to_regprocedure('cron.schedule(text,text,text)') is not null then
    if not exists (select 1 from cron.job where jobname = 'auth-signin-sweep') then
      perform cron.schedule('auth-signin-sweep', '37 * * * *', 'select public.auth_signin_sweep()');
    end if;
  end if;
end $$;

commit;
