-- migration-194-call-private-channels.sql (13-Nov-2026, branch next-sec-db; the database review of 13-Nov-2026, item M5).
-- Written, NOT run yet: the owner reads it and runs it. Needs migrations 102 and 106 (call_rooms, call_participants).
-- Why: a call's signalling, presence and "working together" go over Supabase Realtime channels (broadcast and presence).
-- They were public channels: who may listen or speak rested on the channel's name alone (made from the room's key and
-- epoch, given by fincom-call to the people in the call, moved on when someone is removed). A private channel is
-- joined with a sign-in, and Realtime asks the policies of realtime.messages whether that person may listen or speak.
-- realtime.messages had no policy, so no private channel could be joined.
-- What it adds:
--   call_topic(key, epoch, part)   the channel's name as fincom-call makes it (app/src/calls/rules.js topicFor: part,
--                                  ':', the first 40 hex characters of sha256(key:part:epoch)). The owner only.
--   call_lobby_topic(firm)         the firm's lobby channel as fincom-call makes it (from the guests' signing secret in
--                                  platform_secrets; null while there is none). The owner only.
--   call_channel_ok(topic)         may the caller be on this channel?
--                                    a member (signed in, two-step done, active in a firm: my_firm()):
--                                      call:<...>    a room of their firm they are in (admitted; or away too long and
--                                                    not yet back, as fincom-call lets them return), not ended, whose
--                                                    name now is this one
--                                      cowork:<...>  the same, while the host has working together on
--                                      lobby:<...>   their own firm's lobby
--                                    a guest (no sign-in; the channel pass fincom-call signs for one room and one
--                                    participant, claim fincom_call): call:<...> of that room while that guest is
--                                    admitted (or away too long) and the name is the room's name now; never cowork or
--                                    a lobby
--                                    anything else: no.
--   realtime.messages              two policies (listen: select; speak: insert) for broadcast and presence on a channel
--                                  call_channel_ok says yes to. Nothing else of Realtime is given to anyone.
-- A person removed from a call fails both ways: their row says removed, and the room's name has moved on.
-- By itself this changes nothing for a call: public channels do not ask these policies. The channels become private
-- when fincom-call is given the project's JWT secret (CALLS_CHANNEL_JWT_SECRET) and the app of this branch is out;
-- then "Allow public access" can be switched off in the project's Realtime settings (docs/MIGRATION-ORDER.md, 194).
-- Add-only: three new functions, two new policies; no table, column or row changed. One transaction, lock_timeout 10 s;
-- safe twice. Tested by tests/run_migration194.py (pg_stand; the names against rules.js itself).
begin;
set local lock_timeout = '10s';

create or replace function public.call_topic(p_key text, p_epoch integer, p_part text default 'call')
returns text language sql immutable set search_path = '' as $$
  select p_part || ':' || left(encode(sha256(convert_to(p_key || ':' || p_part || ':' || p_epoch::text, 'UTF8')), 'hex'), 40)
$$;

create or replace function public.call_lobby_topic(p_firm uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare s text;
begin
  if p_firm is null or to_regclass('public.platform_secrets') is null then return null; end if;
  execute 'select value from public.platform_secrets where name = ''call_guest_secret''' into s;
  if s is null or length(s) < 32 then return null; end if;
  return 'lobby:' || left(encode(sha256(convert_to(s || ':lobby:' || p_firm::text, 'UTF8')), 'hex'), 40);
end $$;

create or replace function public.call_channel_ok(p_topic text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); f uuid; part text; g jsonb;
begin
  if p_topic is null or p_topic !~ '^(call|cowork|lobby):[0-9a-f]{40}$' then return false; end if;
  part := split_part(p_topic, ':', 1);
  if uid is null then
    -- a guest: the pass fincom-call signed (Realtime has checked its signature and its end)
    if part <> 'call' then return false; end if;
    g := nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'fincom_call';
    if g is null or jsonb_typeof(g) <> 'object' then return false; end if;
    return exists (select 1 from public.call_participants p join public.call_rooms r on r.id = p.room_id
                    where p.id = (g ->> 'participant')::uuid and r.id = (g ->> 'room')::uuid and p.role = 'guest'
                      and (p.state = 'admitted' or (p.state = 'left' and p.left_why = 'stale' and p.admitted_at is not null))
                      and r.status <> 'ended' and public.call_topic(r.chan_key, r.chan_epoch, 'call') = p_topic);
  end if;
  f := public.my_firm();
  if f is null then return false; end if;
  if part = 'lobby' then return coalesce(p_topic = public.call_lobby_topic(f), false); end if;
  return exists (select 1 from public.call_rooms r join public.call_participants p on p.room_id = r.id and p.user_id = uid
                  where r.firm_id = f and r.status <> 'ended'
                    and (p.state = 'admitted' or (p.state = 'left' and p.left_why = 'stale' and p.admitted_at is not null))
                    and case part when 'call' then public.call_topic(r.chan_key, r.chan_epoch, 'call') = p_topic
                                  else coalesce(r.cowork_on, false) and public.call_topic(r.chan_key, r.cowork_epoch, 'cowork') = p_topic end);
exception when invalid_text_representation or data_exception then
  return false;
end $$;

revoke all on function public.call_topic(text, integer, text), public.call_lobby_topic(uuid) from public, anon, authenticated, service_role;
revoke all on function public.call_channel_ok(text) from public;
grant execute on function public.call_channel_ok(text) to anon, authenticated, service_role;

do $pol$
begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise notice 'migration 194: Realtime (realtime.messages, realtime.topic()) is not on this database; no policy made';
    return;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'fincom_call_listen') then
    create policy fincom_call_listen on realtime.messages for select to anon, authenticated
      using (extension in ('broadcast', 'presence') and public.call_channel_ok((select realtime.topic())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'fincom_call_speak') then
    create policy fincom_call_speak on realtime.messages for insert to anon, authenticated
      with check (extension in ('broadcast', 'presence') and public.call_channel_ok((select realtime.topic())));
  end if;
end $pol$;

commit;
