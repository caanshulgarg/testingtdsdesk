-- migration-98-zoho-rolling-minute (21-Oct-2026, branch next-fix-zoho-take; NOT run on staging: the owner runs it)
--
-- zoho_api_take (75) counted calls per wall-clock minute: the count started again at :00, so 90 calls at 10:00:59 and 90
-- more at 10:01:00 were all let through - up to 180 within one second, where Zoho allows 100 a minute per organisation
-- (two runs of the same organisation, a sync and a posting run, each pacing itself, could meet there). CI showed it as a
-- test failing now and then (run 39637004551; staging-next 74d33fc0e on 15-Oct): 91 calls that crossed :00 were all let
-- through.
-- Now the 90 count any 60 seconds: each call taken is kept (its time, now() in milliseconds, and how many) in the new
-- column zoho_api_usage.recent, only those of the last 60 seconds (the day before's row is read, not changed, just
-- after midnight IST); a call that would make more than p_minute in the 60
-- seconds before it waits, 'wait' being the seconds until the oldest call there is a minute old. The day's cap (95%),
-- the answer's keys and zoho_api_block (Zoho's own 429 closes the minute: minute_calls 100000) are as in 75; the
-- wall-clock minute count is still kept (zoho_api_block uses it).
--
-- Add-only: one new column (default '[]', nothing else in the table changes), zoho_api_take replaced with the same
-- arguments, result, SECURITY DEFINER, search_path and grants (service role only, as 75). One transaction, lock_timeout
-- 10 s, safe to run twice. Runs after 75. Tested on pg_stand: tests/run_migration98.py.
begin;
set local lock_timeout = '10s';

alter table public.zoho_api_usage add column if not exists recent jsonb not null default '[]'::jsonb;

create or replace function public.zoho_api_take(p_conn uuid, p_n integer, p_minute integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare d date := (now() at time zone 'Asia/Kolkata')::date; m timestamptz := date_trunc('minute', now()); u zoho_api_usage%rowtype; cap int; n int := greatest(1, coalesce(p_n, 1));
  lim int := greatest(1, coalesce(p_minute, 90)); t bigint := floor(extract(epoch from now()) * 1000)::bigint; live jsonb; inmin int; oldest bigint;
begin
  select daily_cap into cap from zoho_connections where id = p_conn;
  if cap is null then raise exception 'no such connection'; end if;
  insert into zoho_api_usage (connection_id, day, calls, minute, minute_calls) values (p_conn, d, 0, m, 0) on conflict do nothing;
  select * into u from zoho_api_usage where connection_id = p_conn and day = d for update;
  if u.minute is distinct from m then u.minute := m; u.minute_calls := 0; end if;
  -- the calls of the last 60 seconds, [[ms, n], ...]: this day's row keeps its own; just after midnight (IST) the last
  -- minute of the day before is read from that day's row, and counted, not copied
  select coalesce(jsonb_agg(e order by (e->>0)::bigint), '[]'::jsonb) into live
    from jsonb_array_elements(coalesce(u.recent, '[]'::jsonb)) e where (e->>0)::bigint > t - 60000 and (e->>0)::bigint <= t;
  select coalesce(sum((e->>1)::int), 0), min((e->>0)::bigint) into inmin, oldest
    from (select e from jsonb_array_elements(live) e
          union all
          select e from zoho_api_usage y, jsonb_array_elements(coalesce(y.recent, '[]'::jsonb)) e
           where y.connection_id = p_conn and y.day = d - 1 and (e->>0)::bigint > t - 60000 and (e->>0)::bigint <= t) x;
  if u.calls + n > floor(cap * 0.95) then
    update zoho_api_usage set minute = u.minute, minute_calls = u.minute_calls, recent = live where connection_id = p_conn and day = d;
    return jsonb_build_object('ok', false, 'daily', true, 'used', u.calls, 'cap', cap,
      'wait', ceil(extract(epoch from (((d + 1)::timestamp at time zone 'Asia/Kolkata') - now()))));
  end if;
  if u.minute_calls + n > lim then   -- the wall-clock minute (Zoho's 429 closes it through zoho_api_block)
    update zoho_api_usage set minute = u.minute, minute_calls = u.minute_calls, recent = live where connection_id = p_conn and day = d;
    return jsonb_build_object('ok', false, 'daily', false, 'used', u.calls, 'cap', cap, 'wait', ceil(extract(epoch from (m + interval '1 minute' - now()))));
  end if;
  if inmin + n > lim then             -- any 60 seconds: wait until the oldest call of them is a minute old
    update zoho_api_usage set minute = u.minute, minute_calls = u.minute_calls, recent = live where connection_id = p_conn and day = d;
    return jsonb_build_object('ok', false, 'daily', false, 'used', u.calls, 'cap', cap, 'wait', greatest(1, ceil((oldest + 60000 - t) / 1000.0)));
  end if;
  update zoho_api_usage set calls = u.calls + n, minute = u.minute, minute_calls = u.minute_calls + n, recent = live || jsonb_build_array(jsonb_build_array(t, n))
   where connection_id = p_conn and day = d;
  return jsonb_build_object('ok', true, 'used', u.calls + n, 'cap', cap);
end $$;

-- the same grants as 75's
revoke all on function public.zoho_api_take(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.zoho_api_take(uuid, integer, integer) to service_role;

commit;
