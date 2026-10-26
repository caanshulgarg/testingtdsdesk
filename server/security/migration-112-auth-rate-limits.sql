-- Rate limits for sign-in and sign-up that hold across the functions' running copies (26-Oct-2026, branch next-sec-pkce,
-- the owner: "Security of sign in and sign up page should be better"). NOT run on staging by the app's builders: the
-- owner runs it. Runs after 111 (107-111 are taken by or assigned to other branches; staging ... -> 111 -> 112;
-- a fresh database the same; it needs nothing of the others).
--
-- The signin and signup functions each kept their counts in memory only (signup's RateLimiter, per running copy): a bot
-- spread over the function's copies, or simply waiting for a new one, was not slowed. Now they also count here:
--   auth_rate_hits   one row per counted try: the bucket ('signup-ip', 'signup-email', 'signin-fail-ip') and the key's
--                    SHA-256 (the functions hash the address or email before sending it: no address or email is kept
--                    here in the clear), and when. Rows older than 2 days are of no use and are swept.
--   auth_rate_hit(bucket, key, max, window_s)   counts a try and answers whether it is allowed: false (and nothing
--                    counted) when the key already has max tries within the window. One key at a time (a lock per key),
--                    so two copies of a function cannot both take the last try.
--   auth_rate_count(bucket, key, window_s)      the tries within the window (sign-in failures from one address)
--   auth_rate_add(bucket, key)                  counts one (a failed sign-in)
--   auth_rate_sweep()                           removes rows older than 2 days; pg_cron runs it every hour where the
--                    extension is present (job 'auth-rate-sweep'), else the functions' own calls keep their keys short
-- Service role only (the functions); anon and authenticated nothing. Grants explicit.
-- Add-only: one new table, four new functions, one cron job made when missing. Nothing dropped or changed; the only
-- "delete" is the sweep's, of this table's own old rows. One transaction, lock_timeout 10 s. Safe to run twice.

begin;
set local lock_timeout = '10s';

create table if not exists public.auth_rate_hits (
  id     bigserial primary key,
  bucket text not null check (bucket ~ '^[a-z0-9-]{1,40}$'),
  key    text not null check (key ~ '^[0-9a-f]{64}$'),
  at     timestamptz not null default now()
);
create index if not exists auth_rate_hits_key on public.auth_rate_hits (bucket, key, at);
create index if not exists auth_rate_hits_at on public.auth_rate_hits (at);
alter table public.auth_rate_hits enable row level security;
revoke all on public.auth_rate_hits from public, anon, authenticated;
grant select, insert, delete on public.auth_rate_hits to service_role;
grant usage, select on sequence public.auth_rate_hits_id_seq to service_role;
revoke all on sequence public.auth_rate_hits_id_seq from public, anon, authenticated;

create or replace function public.auth_rate_hit(p_bucket text, p_key text, p_max integer, p_window_s integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_max < 1 or p_window_s < 1 or p_window_s > 172800 then raise exception 'auth_rate_hit: max >= 1, window 1 s to 2 days'; end if;
  perform pg_advisory_xact_lock(hashtextextended('auth_rate:' || p_bucket || ':' || p_key, 0));
  select count(*) into n from public.auth_rate_hits
   where bucket = p_bucket and key = p_key and at > now() - make_interval(secs => p_window_s);
  if n >= p_max then return false; end if;
  insert into public.auth_rate_hits (bucket, key) values (p_bucket, p_key);
  return true;
end $$;

create or replace function public.auth_rate_count(p_bucket text, p_key text, p_window_s integer)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.auth_rate_hits
   where bucket = p_bucket and key = p_key and at > now() - make_interval(secs => least(greatest(p_window_s, 1), 172800));
$$;

create or replace function public.auth_rate_add(p_bucket text, p_key text)
returns void language sql security definer set search_path = '' as $$
  insert into public.auth_rate_hits (bucket, key) values (p_bucket, p_key);
$$;

create or replace function public.auth_rate_sweep()
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.auth_rate_hits where at < now() - interval '2 days';
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.auth_rate_hit(text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.auth_rate_count(text, text, integer) from public, anon, authenticated;
revoke execute on function public.auth_rate_add(text, text) from public, anon, authenticated;
revoke execute on function public.auth_rate_sweep() from public, anon, authenticated;
grant execute on function public.auth_rate_hit(text, text, integer, integer) to service_role;
grant execute on function public.auth_rate_count(text, text, integer) to service_role;
grant execute on function public.auth_rate_add(text, text) to service_role;
grant execute on function public.auth_rate_sweep() to service_role;

-- the hourly sweep, where pg_cron is installed (staging has it); made once
do $$
begin
  if to_regclass('cron.job') is not null and to_regprocedure('cron.schedule(text,text,text)') is not null then
    if not exists (select 1 from cron.job where jobname = 'auth-rate-sweep') then
      perform cron.schedule('auth-rate-sweep', '23 * * * *', 'select public.auth_rate_sweep()');
    end if;
  end if;
end $$;

commit;
