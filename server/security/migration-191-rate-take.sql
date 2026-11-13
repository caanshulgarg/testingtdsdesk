-- A shared count taken in one step (13-Nov-2026, branch next-sec-server).
-- NOT run on staging by the app's builders: the owner runs it. Runs after 190 (it needs nothing of 183 to 190).
-- Needs migration 112 (public.auth_rate_hits, the shared counts' table).
--
--   auth_rate_take(bucket, key, n, max, window_s)   "may n more be counted, and if so count them": under the same
--                       advisory lock as auth_rate_hit (migration 112), the rows of the bucket and key within the
--                       window are counted; when they and n come to max or less, n rows are written and the answer is
--                       true; otherwise nothing is written and the answer is false. The check and the writing are one
--                       call, so two callers at once cannot both be given the last places.
-- Used by the emails FinCom sends for a firm (server/_shared/mailrules.ts: mis-run's scheduled report, fincom-call's
-- invites; bucket mail-firm, 200 people a day for a firm). The places are taken before the email goes out.
-- Service role only; anon and authenticated nothing. Grants explicit.
-- Add-only: one new function. One transaction, lock_timeout 10 s. Safe to run twice.

begin;
set local lock_timeout = '10s';

create or replace function public.auth_rate_take(p_bucket text, p_key text, p_n integer, p_max integer, p_window_s integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare had integer;
begin
  if p_bucket is null or p_key is null then raise exception 'auth_rate_take: a bucket and a key'; end if;
  if p_n is null or p_n < 1 or p_n > 1000 or p_max is null or p_max < 1 or p_window_s is null or p_window_s < 1 or p_window_s > 172800 then
    raise exception 'auth_rate_take: n 1 to 1000, max >= 1, window 1 s to 2 days';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('auth_rate:' || p_bucket || ':' || p_key, 0));
  select count(*) into had from public.auth_rate_hits
   where bucket = p_bucket and key = p_key and at > now() - make_interval(secs => p_window_s);
  if had + p_n > p_max then return false; end if;
  insert into public.auth_rate_hits (bucket, key) select p_bucket, p_key from generate_series(1, p_n);
  return true;
end $$;

revoke execute on function public.auth_rate_take(text, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.auth_rate_take(text, text, integer, integer, integer) to service_role;

commit;
