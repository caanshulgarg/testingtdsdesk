-- Sync guard, 02-Oct-2026. At 18:35:26 UTC on 01-Oct a browser that had reloaded with no clients in its local storage
-- sent all three clients of a firm as deleted, with name, GSTIN, PAN, Tally name and data blanked. The app no longer
-- infers a delete from absence; this guard makes the server refuse the same mistake from any app or old build.
--
--   clients, records  + deleted_at, deleted_by, delete_reason, restored_at, restored_by
--   sync_refused      what the guard refused or kept: when, who, which row, what (read by the firm; never deleted)
--   sync_guard_*      BEFORE UPDATE triggers:
--     * a row marked deleted keeps its name, GSTIN, PAN, Tally name and data; deleted_at, deleted_by and the reason are set
--     * a row not deleted can't have its name, GSTIN, PAN, Tally name or data changed to empty: the old value is kept
--       and the attempt is written to sync_refused
--     * the firm record (records, kind 'firm'): a filled field (firm name, address, logo, rules, …) is never replaced by
--       an empty one
--     * a deleted row brought back sets restored_at and restored_by
-- Adds only: columns, one table, functions and triggers. Nothing is dropped or deleted.

begin;

alter table public.clients add column if not exists deleted_at timestamptz;
alter table public.clients add column if not exists deleted_by uuid;
alter table public.clients add column if not exists delete_reason text;
alter table public.clients add column if not exists restored_at timestamptz;
alter table public.clients add column if not exists restored_by uuid;
alter table public.records add column if not exists deleted_at timestamptz;
alter table public.records add column if not exists deleted_by uuid;
alter table public.records add column if not exists delete_reason text;
alter table public.records add column if not exists restored_at timestamptz;
alter table public.records add column if not exists restored_by uuid;

create table if not exists public.sync_refused (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  firm_id   uuid,
  user_id   uuid,
  tbl       text not null,
  kind      text,
  row_id    text not null,
  what      text not null
);
create index if not exists sync_refused_firm on public.sync_refused (firm_id, at desc);
alter table public.sync_refused enable row level security;
drop policy if exists sync_refused_read on public.sync_refused;
create policy sync_refused_read on public.sync_refused for select to authenticated using ((firm_id = my_firm()) or is_superadmin());
revoke all on public.sync_refused from anon, authenticated;
grant select on public.sync_refused to authenticated;

-- empty: null, '', {}, [], "" and JSON null
create or replace function public.sync_empty(v jsonb) returns boolean language sql immutable as $$
  select v is null or v = 'null'::jsonb or v = '{}'::jsonb or v = '[]'::jsonb or v = '""'::jsonb
$$;
create or replace function public.sync_empty(v text) returns boolean language sql immutable as $$
  select coalesce(btrim(v), '') = ''
$$;

create or replace function public.sync_guard_clients() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare kept text[] := '{}';
begin
  if not sync_empty(old.name)       and sync_empty(new.name)       then new.name := old.name;             kept := kept || 'name'::text; end if;
  if not sync_empty(old.gstin)      and sync_empty(new.gstin)      then new.gstin := old.gstin;           kept := kept || 'gstin'::text; end if;
  if not sync_empty(old.pan)        and sync_empty(new.pan)        then new.pan := old.pan;               kept := kept || 'pan'::text; end if;
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

create or replace function public.sync_guard_records() returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare kept text[] := '{}'; k text;
begin
  if old.kind = 'firm' and not sync_empty(old.data) then
    -- the firm record: each filled field is kept when the new copy has it empty or missing
    for k in select jsonb_object_keys(old.data) loop
      if not sync_empty(old.data -> k) and sync_empty(new.data -> k) then
        new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object(k, old.data -> k); kept := kept || k;
      end if;
    end loop;
  elsif not sync_empty(old.data) and sync_empty(new.data) then
    new.data := old.data; kept := kept || 'data'::text;
  end if;
  if new.deleted and not old.deleted then
    new.deleted_at := now(); new.deleted_by := auth.uid();
    new.delete_reason := coalesce(nullif(btrim(new.delete_reason), ''), 'deleted in the app');
  elsif old.deleted and not new.deleted then
    new.restored_at := now(); new.restored_by := auth.uid();
  end if;
  if array_length(kept, 1) > 0 then
    insert into sync_refused (firm_id, user_id, tbl, kind, row_id, what)
    values (old.firm_id, auth.uid(), 'records', old.kind, old.id,
            case when new.deleted then 'deleted: kept ' else 'empty refused, kept ' end || array_to_string(kept, ', '));
  end if;
  return new;
end $function$;

drop trigger if exists sync_guard on public.clients;
create trigger sync_guard before update on public.clients for each row execute function public.sync_guard_clients();
drop trigger if exists sync_guard on public.records;
create trigger sync_guard before update on public.records for each row execute function public.sync_guard_records();

revoke all on function public.sync_guard_clients(), public.sync_guard_records() from public, anon, authenticated;

commit;
