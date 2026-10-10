-- A save of a client never drops a setting it does not mention, request of 02-Oct-2026. Testing AAD's "posting allowed
-- to company" (data.postTo), set at about 05:30 UTC, was wiped at 06:02 by a browser that sent its whole older copy of
-- the client, which had no postTo. The app now merges a save into the server's copy (src/js/27-firm-account.js,
-- cloudPushClient); this guard covers a tab still running an older build until it is reloaded.
--   clients.data: a top-level setting missing from an update keeps its server value. A setting is cleared by sending
--   it empty ("" or null), as Client setup does ("Stop posting" sends postTo = ""), never by leaving it out.
-- Runs before sync_guard_clients (trigger names sort "clients_keep_keys" < "sync_guard"), so the empty-data guard
-- there is unchanged. Adds and replaces only; nothing is dropped or deleted. Safe to run again.

begin;

create or replace function public.clients_keep_keys()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if jsonb_typeof(old.data) = 'object' and jsonb_typeof(new.data) = 'object' and old.data is distinct from new.data then
    new.data := old.data || new.data;     -- keys only in old.data are kept; new.data wins for every key it has
  end if;
  return new;
end $function$;

drop trigger if exists clients_keep_keys on public.clients;
create trigger clients_keep_keys before update on public.clients
  for each row execute function public.clients_keep_keys();

commit;
