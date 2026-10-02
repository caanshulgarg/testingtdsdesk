-- Clearing a wrong GSTIN or PAN on purpose, 02-Oct-2026. The sync guard (migration-19) keeps a client's GSTIN and PAN
-- when anything tries to empty them, so a wrong one could not be removed. Now an owner of the firm can clear them, with a
-- reason, through client_clear_ids; the guard lets only that through, and the clearing is kept in sync_refused (what,
-- the old value, who, why) like every other change the guard watches.
--   client_clear_ids(client, what[], reason)   what: 'gstin' and/or 'pan'
--   sync_guard_clients                          lets a cleared field through while client_clear_ids runs
-- Replaces two functions; nothing is dropped or deleted.

begin;

create or replace function public.sync_guard_clients() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare kept text[] := '{}'; allow text := coalesce(current_setting('fincom.clear_ids', true), '');
begin
  if not sync_empty(old.name)       and sync_empty(new.name)       then new.name := old.name;             kept := kept || 'name'::text; end if;
  if not sync_empty(old.gstin)      and sync_empty(new.gstin)      and position('gstin' in allow) = 0 then new.gstin := old.gstin; kept := kept || 'gstin'::text; end if;
  if not sync_empty(old.pan)        and sync_empty(new.pan)        and position('pan' in allow) = 0   then new.pan := old.pan;     kept := kept || 'pan'::text; end if;
  if not sync_empty(old.tally_name) and sync_empty(new.tally_name) then new.tally_name := old.tally_name; kept := kept || 'tally_name'::text; end if;
  if not sync_empty(old.data)       and sync_empty(new.data)       then new.data := old.data;             kept := kept || 'data'::text; end if;
  if new.deleted and not old.deleted then
    new.deleted_at := now(); new.deleted_by := auth.uid();
    new.delete_reason := coalesce(nullif(btrim(new.delete_reason), ''), 'deleted in the app');
  elsif old.deleted and not new.deleted then
    new.restored_at := now(); new.restored_by := auth.uid();
  end if;
  if array_length(kept, 1) > 0 then
    insert into sync_refused (firm_id, user_id, tbl, kind, row_id, what)
    values (old.firm_id, auth.uid(), 'clients', 'client', old.id,
            case when new.deleted then 'deleted: kept ' else 'empty refused, kept ' end || array_to_string(kept, ', '));
  end if;
  return new;
end $function$;

create or replace function public.client_clear_ids(p_client text, p_what text[], p_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f uuid := my_firm(); c record; w text[] := array(select distinct x from unnest(coalesce(p_what, '{}')) x where x in ('gstin', 'pan'));
        why text := left(btrim(coalesce(p_reason, '')), 300);
begin
  if f is null or not exists (select 1 from members m where m.user_id = auth.uid() and m.firm_id = f and m.role = 'owner' and coalesce(m.active, true))
    then raise exception 'only an owner of the firm can clear a GSTIN or PAN' using errcode = '42501'; end if;
  if array_length(w, 1) is null then raise exception 'say what to clear: gstin or pan'; end if;
  if why = '' then raise exception 'a reason is needed'; end if;
  select * into c from clients where firm_id = f and id = p_client;
  if not found then raise exception 'no such client in this firm'; end if;
  perform set_config('fincom.clear_ids', array_to_string(w, ','), true);
  update clients set
      gstin = case when 'gstin' = any(w) then '' else gstin end,
      pan   = case when 'pan' = any(w) then '' else pan end,
      data  = case when data is null then data else
                (case when 'gstin' = any(w) then jsonb_set(data, '{gstin}', '""') else data end)
                || (case when 'pan' = any(w) then jsonb_build_object('pan', '') else '{}'::jsonb end) end
    where firm_id = f and id = p_client;
  perform set_config('fincom.clear_ids', '', true);
  insert into sync_refused (firm_id, user_id, tbl, kind, row_id, what)
  values (f, auth.uid(), 'clients', 'client', p_client, 'cleared by an owner: ' ||
          concat_ws(', ', case when 'gstin' = any(w) then 'GSTIN ' || coalesce(nullif(c.gstin, ''), '(none)') end,
                          case when 'pan' = any(w) then 'PAN ' || coalesce(nullif(c.pan, ''), '(none)') end) || ' — ' || why);
  return jsonb_build_object('ok', true, 'cleared', to_jsonb(w));
end $function$;
revoke all on function public.client_clear_ids(text, text[], text) from public, anon;
grant execute on function public.client_clear_ids(text, text[], text) to authenticated;

commit;
