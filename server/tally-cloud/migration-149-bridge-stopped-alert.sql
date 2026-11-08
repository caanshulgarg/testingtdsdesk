-- migration-149-bridge-stopped-alert (08-Nov-2026, bridge 2.5.10; the owner: "Bridge should work every time except when
-- Tally itself is unavailable"). Written, NOT run yet.
-- A firm whose FinCom Bridges have all been silent for more than 10 minutes (the newest heartbeat of its computers,
-- tally_devices.info.beat.at, kept by tally-ingest) gets one line in the bell (migration 47's tally_alerts, kind
-- 'summary', as the book-start line): "FinCom Bridge on the office Tally computer stopped answering at HH:MM IST. ...".
-- Once per stop: one row per computer and India's day of the stop; a later stop of the same computer that day makes the
-- line unread again with its new time. Review of 2.5.10 (5): only a stop inside the office day, 09:30 to 18:30 India
-- time, Monday to Saturday (a computer switched off at the end of the day, or before it starts, is not a stop), of a
-- computer that had been beating at least 30 minutes earlier that day (tally-ingest's info.dayFirst: its first
-- heartbeat of India's day); scanned within migration 47's working hours (09:00 to 19:00). No computer's name in the
-- words (the page names it under Advanced only). Nothing else changes.
-- Add-only: one function, its grants, and a pg_cron job every 5 minutes where pg_cron is there (cron.schedule
-- replaces a job of the same name); no table is created, altered or emptied. Safe to run twice.
begin;
set local lock_timeout = '10s';

do $$
begin
  if to_regclass('public.tally_alerts') is null or to_regprocedure('public.tally_alert_working_now(timestamptz)') is null then
    raise exception 'migration 149 needs migration 47 (tally_alerts, tally_alert_working_now)';
  end if;
  if to_regclass('public.tally_devices') is null then raise exception 'migration 149 needs tally_devices'; end if;
end $$;

create or replace function public.tally_alert_scan_stopped(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare f uuid; dev uuid; last_at timestamptz; first_at timestamptz; first_day text; n int := 0; k int; bad int := 0; w text; t time;
begin
  if not tally_alert_working_now(p_now) then
    return jsonb_build_object('ok', true, 'written', 0, 'skipped', 'outside Monday to Saturday, 09:00 to 19:00 India time');
  end if;
  for f in select distinct x.firm_id from tally_devices x where not coalesce(x.revoked, false) and x.firm_id is not null order by 1 loop
  begin                                  -- each firm in its own block (as migration 47's scans)
    dev := null; last_at := null; first_at := null; first_day := null;
    select s.id, s.at, s.fday, s.fat into dev, last_at, first_day, first_at
      from (select x.id, (x.info->'beat'->>'at')::timestamptz as at, x.info->'dayFirst'->>'day' as fday,
                   case when coalesce(x.info->'dayFirst'->>'at', '') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d' then (x.info->'dayFirst'->>'at')::timestamptz end as fat
              from tally_devices x
             where x.firm_id = f and not coalesce(x.revoked, false)
               and coalesce(x.info->'beat'->>'at', '') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d') s
     order by s.at desc limit 1;
    continue when dev is null or last_at > p_now - interval '10 minutes' or last_at < p_now - interval '24 hours';
    t := (last_at at time zone 'Asia/Kolkata')::time;
    continue when extract(isodow from (last_at at time zone 'Asia/Kolkata')) not between 1 and 6 or t < time '09:30' or t > time '18:30';
    continue when first_at is null or first_day is distinct from to_char(last_at at time zone 'Asia/Kolkata', 'YYYY-MM-DD')
               or first_at > last_at - interval '30 minutes';
    w := 'FinCom Bridge on the office Tally computer stopped answering at ' || to_char(last_at at time zone 'Asia/Kolkata', 'HH24:MI')
         || ' IST. Check that the computer is on and signed in to Windows; FinCom Bridge starts again by itself within 5 minutes of that.';
    insert into tally_alerts (firm_id, client_id, book_id, device_id, kind, day, words, data)
    values (f, null, null, dev, 'summary', (last_at at time zone 'Asia/Kolkata')::date, w,
            jsonb_build_object('bridgeStopped', jsonb_build_object('at', to_char(last_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))
    on conflict (firm_id, kind, (coalesce(book_id, '00000000-0000-0000-0000-000000000000'::uuid)), (coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid)), day)
    do update set words = excluded.words, data = tally_alerts.data || excluded.data, at = now(), read_at = null, read_by = null
     where tally_alerts.data ? 'bridgeStopped'
       and tally_alerts.data->'bridgeStopped'->>'at' is distinct from excluded.data->'bridgeStopped'->>'at';
    get diagnostics k = row_count;
    n := n + k;
  exception when others then
    bad := bad + 1; raise log 'tally_alert_scan_stopped: firm %: % %', f, sqlstate, sqlerrm;
  end;
  end loop;
  return jsonb_build_object('ok', true, 'written', n) || case when bad > 0 then jsonb_build_object('firmsFailed', bad) else '{}'::jsonb end;
end $function$;
revoke all on function public.tally_alert_scan_stopped(timestamptz) from public, anon, authenticated;

do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('tally-alert-stopped', '*/5 3-13 * * 1-6', 'select public.tally_alert_scan_stopped()');
  end if;
end $$;

commit;
