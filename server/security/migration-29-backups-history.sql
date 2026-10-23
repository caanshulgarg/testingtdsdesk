-- Backups and a history of client settings, request of 02-Oct-2026. On 01-Oct at 18:35 UTC an old open tab blanked and
-- soft-deleted the three clients of "Garg Shekhar& Company"; the nightly backup an hour later skipped deleted clients, so
-- it held none, and the newest usable copy (30-Sep) was a day older: a day of Client setup changes was lost.
--   1. take_backup: every client and record, soft-deleted ones too, each with all its columns (deleted, deleted_at,
--      delete_reason...), so a restore can tell them apart; counts of the deleted ones beside the others.
--   2. Backups kept: the newest 30 of a firm, and all of the last 31 days (a backup taken by hand never pushes a nightly
--      one out early).
--   3. client_settings_history: one row per changed setting of a client (who, when, old value, new value), written by
--      a trigger after every insert, update and delete of public.clients, the app's saves and SQL alike. Counters that
--      change with every bill (stats, readCounts, hashes, keys) are left out. Members of the firm can read their own
--      firm's rows; nobody can change or delete them.
--   4. client_settings_history(client, limit): the newest changes of one client, for Client setup.
-- Adds and replaces only; nothing is dropped or deleted. Safe to run again.

begin;

-- 1 and 2 ---------------------------------------------------------------------------------------------------------------
alter table public.backups add column if not exists clients_deleted integer not null default 0;
alter table public.backups add column if not exists records_deleted integer not null default 0;

create or replace function public.take_backup(p_firm uuid default null::uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare r record; v_data jsonb; v_n int := 0;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') and not public.is_superadmin() then
    if p_firm is null or p_firm is distinct from public.my_firm()
       or not exists (select 1 from public.members m where m.user_id = auth.uid() and m.active and m.role = 'owner') then
      return jsonb_build_object('ok', false, 'reason', 'Only the firm owner can take a backup of their own firm.');
    end if;
  end if;
  for r in select id, name from public.firms where p_firm is null or id = p_firm loop
    select jsonb_build_object(
      'version', 2,
      'firm', to_jsonb(f) - 'balance',
      'clients', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]'::jsonb) from public.clients c where c.firm_id = r.id),
      'records', (select coalesce(jsonb_agg(to_jsonb(x) order by x.id), '[]'::jsonb) from public.records x where x.firm_id = r.id),
      'client_books', (select coalesce(jsonb_agg(to_jsonb(k)), '[]'::jsonb) from public.client_books k where k.firm_id = r.id),
      'members', (select coalesce(jsonb_agg(jsonb_build_object('name', m.name, 'email', m.email, 'role', m.role, 'active', m.active)), '[]'::jsonb) from public.members m where m.firm_id = r.id)
    ) into v_data from public.firms f where f.id = r.id;
    insert into public.backups (firm_id, clients, records, clients_deleted, records_deleted, bytes, data)
    values (r.id,
            (select count(*) from jsonb_array_elements(v_data -> 'clients') c where not coalesce((c ->> 'deleted')::boolean, false)),
            (select count(*) from jsonb_array_elements(v_data -> 'records') x where not coalesce((x ->> 'deleted')::boolean, false)),
            (select count(*) from jsonb_array_elements(v_data -> 'clients') c where coalesce((c ->> 'deleted')::boolean, false)),
            (select count(*) from jsonb_array_elements(v_data -> 'records') x where coalesce((x ->> 'deleted')::boolean, false)),
            octet_length(v_data::text), v_data);
    v_n := v_n + 1;
    delete from public.backups b
     where b.firm_id = r.id and b.taken_at < now() - interval '31 days'
       and b.id not in (select id from public.backups where firm_id = r.id order by taken_at desc, id desc limit 30);
  end loop;
  return jsonb_build_object('ok', true, 'firms', v_n);
end $function$;

create or replace function public.my_backups()
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'taken_at', b.taken_at, 'clients', b.clients, 'records', b.records,
           'clients_deleted', b.clients_deleted, 'records_deleted', b.records_deleted, 'bytes', b.bytes) order by b.taken_at desc), '[]'::jsonb)
  from public.backups b where b.firm_id = public.my_firm()
$function$;

-- 3 ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.client_settings_history (
  id          bigserial primary key,
  firm_id     uuid not null,
  client_id   text not null,
  changed_at  timestamptz not null default now(),
  changed_by  uuid,                 -- the signed-in person; null = FinCom itself (a server job, SQL)
  by_name     text,                 -- their name or email when the change was made
  op          text not null,        -- 'insert' | 'update' | 'delete'
  setting     text not null,        -- a column (name, gstin, pan, tally_name, deleted, delete_reason) or 'data.<key>'
  old_value   jsonb,
  new_value   jsonb
);
create index if not exists client_settings_history_client on public.client_settings_history (firm_id, client_id, changed_at desc);

alter table public.client_settings_history enable row level security;
revoke all on public.client_settings_history from anon, authenticated;
grant select on public.client_settings_history to authenticated;
drop policy if exists client_settings_history_read on public.client_settings_history;
create policy client_settings_history_read on public.client_settings_history for select to authenticated
  using (firm_id = public.my_firm() or public.is_superadmin());

create or replace function public.clients_log_settings()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  skip constant text[] := array['stats', 'readCounts', 'hashes', 'keys'];
  o jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  n jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  od jsonb := coalesce(case when jsonb_typeof(o -> 'data') = 'object' then o -> 'data' end, '{}'::jsonb);
  nd jsonb := coalesce(case when jsonb_typeof(n -> 'data') = 'object' then n -> 'data' end, '{}'::jsonb);
  who uuid := auth.uid();
  nm text;
  f uuid := coalesce((n ->> 'firm_id')::uuid, (o ->> 'firm_id')::uuid);
  cid text := coalesce(n ->> 'id', o ->> 'id');
begin
  if who is not null then
    select coalesce(nullif(m.name, ''), m.email) into nm from public.members m where m.user_id = who and m.firm_id = f limit 1;
  end if;
  insert into public.client_settings_history (firm_id, client_id, changed_by, by_name, op, setting, old_value, new_value)
  select f, cid, who, nm, lower(tg_op), s.setting, s.ov, s.nv
    from (
      select c as setting, o -> c as ov, n -> c as nv
        from unnest(array['name', 'gstin', 'pan', 'tally_name', 'deleted', 'delete_reason']) c
      union all
      select 'data.' || k, od -> k, nd -> k
        from (select jsonb_object_keys(od) k union select jsonb_object_keys(nd)) ks
       where k <> all (skip)
    ) s
   where s.ov is distinct from s.nv;
  return null;
end $function$;

drop trigger if exists clients_log_settings on public.clients;
create trigger clients_log_settings after insert or update or delete on public.clients
  for each row execute function public.clients_log_settings();

-- 4 ---------------------------------------------------------------------------------------------------------------------
create or replace function public.client_settings_history(p_client text, p_limit integer default 200)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('at', h.changed_at, 'by', coalesce(h.by_name, case when h.changed_by is null then 'FinCom' end),
           'op', h.op, 'setting', h.setting, 'old', h.old_value, 'new', h.new_value) order by h.changed_at desc, h.id desc), '[]'::jsonb)
    from (select * from public.client_settings_history
           where firm_id = public.my_firm() and client_id = p_client
           order by changed_at desc, id desc limit least(greatest(coalesce(p_limit, 200), 1), 2000)) h
$function$;
revoke all on function public.client_settings_history(text, integer) from public, anon;
grant execute on function public.client_settings_history(text, integer) to authenticated;

commit;

-- check: the nightly job is unchanged (19:30 UTC, select public.take_backup()); take one now and see the counts
--   select public.take_backup('efe13a47-f0fa-43be-a18c-bf32caa448ca');
--   select id, taken_at, clients, clients_deleted, records, records_deleted from public.backups order by id desc limit 3;
