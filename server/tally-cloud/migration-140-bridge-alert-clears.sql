-- Migration 140 (04-Nov-2026, first numbered 139 (139 is the bridge update gate), branch next-tally-connectfix): a "this computer key cannot use bridge …" alert is cleared
-- once the computer the bridge is bound to reports from it again.
--
-- Why (staging, 29-Oct, 31-Oct and 03-Nov-2026): the Tally page's Connect made a second computer key for a bridge that was
-- already this firm's (app/src/lib/tallyConnect.js connectNow rekeyed whenever the heartbeat was not fresh). The bridge is
-- bound to its first computer key (migration 54, tally_bridge_ids), so the new key was refused and tally_bridge_bind kept
-- ONE alert for the owners. The bridge went on reporting with its first key, yet each alert stayed uncleared for days
-- (only an owner's "release this bridge's identity" or a move to a new key cleared one). The page no longer makes such a
-- key; this migration clears the alerts it left, through the bind itself:
--
--   tally_bridge_bind(p_device, p_bridge): as migration 54, and when the call comes from the computer the id is bound to,
--   the firm's uncleared alerts for that id raised by ANOTHER computer key, not raised again in the last 10 minutes, are
--   marked cleared (cleared_at now, cleared_why says so). An alert still being raised (a second bridge really using the
--   id: it is refused every beat, so its last_at stays fresh) is kept.
--
-- ADD-ONLY: one column added (tally_bridge_alerts.cleared_why, null for every row so far), one function replaced with the
-- same signature, result and grants; no row deleted (alerts are marked, never removed; computer keys are not touched).
-- The live function must be migration 54's text (md5 of prosrc f8a4dd53741a3aa2de2d8f03c3d5c5a0) or already this one,
-- else nothing changes. Safe to run twice; one transaction, lock_timeout 10 s. Grants explicit: the function is internal
-- (tally-ingest's service role only), as before.
-- Tested on pg_stand: tests/run_tally_connect_norekey.py (the clear) and the page's rules.

begin;
set local lock_timeout = '10s';

do $$
declare m text; src text;
begin
  select md5(p.prosrc), p.prosrc into m, src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'tally_bridge_bind' and pg_get_function_identity_arguments(p.oid) = 'p_device uuid, p_bridge text';
  if m is null then raise exception 'migration 140: tally_bridge_bind(uuid, text) is missing (needs migration 54)'; end if;
  if m <> 'f8a4dd53741a3aa2de2d8f03c3d5c5a0' and position('migration 140' in src) = 0 then
    raise exception 'migration 140: tally_bridge_bind is not migration 54''s text (md5 %); nothing changed', m;
  end if;
end $$;

alter table public.tally_bridge_alerts add column if not exists cleared_why text;

create or replace function public.tally_bridge_bind(p_device uuid, p_bridge text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare b text := left(btrim(coalesce(p_bridge, '')), 40); bound uuid; w text; me record; f uuid;
begin
  if b !~ '^go-[0-9a-f]{6,32}$' then return jsonb_build_object('own', true); end if;   -- bridge 1.15.0 ("v1") has no id of its own
  select d.firm_id into f from tally_devices d where d.id = p_device;
  if f is null then return jsonb_build_object('own', true); end if;
  insert into tally_bridge_ids (bridge_id, device_id, firm_id) values (b, p_device, f)
    on conflict (firm_id, bridge_id) where reset_at is null do nothing;
  select i.device_id into bound from tally_bridge_ids i where i.firm_id = f and i.bridge_id = b and i.reset_at is null;
  if bound = p_device then
    update tally_devices set info = info - 'idRefused' where id = p_device and info ? 'idRefused' and info -> 'idRefused' ->> 'bridge' = b;
    -- migration 140: the bridge reports with the key it is bound to again: another key's alert for it that is not being
    -- raised any more (a key made by mistake and refused once) is cleared
    update tally_bridge_alerts set cleared_at = now(), cleared_why = 'the bridge reports with its own computer key again'
     where firm_id = f and bridge_id = b and cleared_at is null and device_id <> p_device and last_at < now() - interval '10 minutes';
    return jsonb_build_object('own', true);
  end if;
  w := 'This computer key cannot use bridge ' || b || ': it belongs to ' || tally_bridge_words(bound, b) || '. Ask the firm''s owner.';
  select d.firm_id, d.info -> 'bridges' -> b ->> 'computer' as c, d.info -> 'bridges' -> b ->> 'user' as u, d.name into me from tally_devices d where d.id = p_device;
  insert into tally_bridge_alerts (firm_id, bridge_id, device_id, owner_device_id, tried_computer, tried_user, words)
    values (me.firm_id, b, p_device, bound, coalesce(nullif(me.c, ''), me.name, ''), coalesce(me.u, ''), w)
    on conflict (bridge_id, device_id) where cleared_at is null do update set last_at = now();
  update tally_devices set info = info || jsonb_build_object('idRefused', jsonb_build_object('bridge', b, 'words', w, 'at', now())) where id = p_device;
  return jsonb_build_object('own', false, 'words', w);
end $function$;
revoke all on function public.tally_bridge_bind(uuid, text) from public, anon, authenticated;
grant execute on function public.tally_bridge_bind(uuid, text) to service_role;
grant select on public.tally_bridge_alerts to authenticated;

commit;
