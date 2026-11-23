-- Migration 213 (23-Nov-2026, branch next-optional-off). A DRAFT: written and tested here (tests/run_migration213.py on
-- pg_stand); NOT run anywhere. The coordinator runs it on staging after the review, AFTER the build with
-- next-optional-off is live (that build stamps a deliberate tick and lets the newer stamp decide, src/js/27
-- clientOptKeep, so an old open tab cannot put the old "on" back).
--
-- The owner, 23-Nov-2026: "optional entries to be defaulted off in every client". New clients start off in the app
-- (src/js/00-core.js newCompany); this turns Optional vouchers for bills, sales and journals off in the live clients
-- that hold it on today (it was on by default for every client until now):
--   data.createOptional = true (Client setup)  ->  false, data.createOptionalAt = this run's time
--   The time is UTC ISO with milliseconds and Z, as the app writes it; updated_at = now(), so every browser pulls the new
--   copy. A client whose stamp (createOptionalAt) is already there chose it deliberately with the new build: left as it is.
--   Bank entries (data.bankOptional) are NOT changed: they were never on by default, so a client with them on ticked
--   them on purpose; only new clients start off there (the app).
--   Soft-deleted clients are left out. updated_by: staging's trigger clients_touch sets it to auth.uid(), which is NULL
--   when this runs from the SQL editor, so the changed clients' updated_by becomes NULL (accepted: the change is in
--   optional_off_213 and in client_settings_history); any trigger on clients that mentions updated_by is named in a notice.
--   public.optional_off_213  one row per client changed: firm_id, client_id, setting, the old value and the old stamp,
--                            changed_at. The undo, at the foot, puts the value back with a stamp of its own.
-- ADD-ONLY: one new table (no policy: nobody reads it through the API; the SQL editor does); UPDATEs of clients.data,
-- only of createOptional and its stamp, only where it is JSON true. Nothing is dropped or deleted.
-- Safe to run twice: a client already in optional_off_213 is never changed again (an "on" chosen after this run stays).
-- Supabase gives anon and authenticated every right on a new table by default: all taken back, public and service_role
-- too. One transaction, lock_timeout 10 s.
begin;
set local lock_timeout = '10s';

-- the names: public.clients as the app has it, and optional_off_213 absent or this migration's own (its comment)
do $names$
begin
  if to_regclass('public.clients') is null then raise exception 'migration 213: public.clients is not on this database. Nothing was changed.'; end if;
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clients'
       and ((column_name = 'data' and data_type = 'jsonb') or column_name in ('firm_id', 'id', 'updated_at', 'deleted'))) <> 5 then
    raise exception 'migration 213: public.clients has no data (jsonb), firm_id, id, updated_at or deleted column. Nothing was changed.';
  end if;
  if to_regclass('public.optional_off_213') is not null and coalesce(obj_description(to_regclass('public.optional_off_213'), 'pg_class'), '') <> 'optional vouchers off (migration 213)' then
    raise exception 'migration 213: a table public.optional_off_213 already exists and is not this migration''s. Nothing was changed.';
  end if;
end $names$;

create table if not exists public.optional_off_213 (
  firm_id     uuid not null,
  client_id   text not null,
  setting     text not null check (setting in ('createOptional')),
  old_value   jsonb,                       -- data.<setting> before (true)
  old_at      jsonb,                       -- data.<setting>At before (none: null)
  changed_at  timestamptz not null default now(),
  primary key (firm_id, client_id, setting)
);
comment on table public.optional_off_213 is 'optional vouchers off (migration 213)';
alter table public.optional_off_213 enable row level security;
revoke all on table public.optional_off_213 from public, anon, authenticated, service_role;

-- the change: each live client's setting that is on (and not chosen deliberately with the new build), logged first,
-- then turned off with this run's stamp
do $off$
declare k text; n_on int; n_kept int; n int; trg text; at_iso text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select string_agg(t.tgname, ', ') into trg from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.clients'::regclass and not t.tgisinternal and p.prosrc ilike '%updated_by%';
  if trg is not null then raise notice 'migration 213: these triggers on clients may set updated_by: %', trg; end if;
  foreach k in array array['createOptional'] loop
    select count(*) filter (where c.data -> k = 'true'::jsonb),
           count(*) filter (where c.data -> k = 'true'::jsonb and c.data ? (k || 'At'))
      into n_on, n_kept
      from public.clients c where jsonb_typeof(c.data) = 'object' and not coalesce(c.deleted, false);
    with picked as (
      insert into public.optional_off_213 (firm_id, client_id, setting, old_value, old_at)
      select c.firm_id, c.id, k, c.data -> k, c.data -> (k || 'At')
        from public.clients c
       where jsonb_typeof(c.data) = 'object' and not coalesce(c.deleted, false)
         and c.data -> k = 'true'::jsonb and not (c.data ? (k || 'At'))
         and not exists (select 1 from public.optional_off_213 a where a.firm_id = c.firm_id and a.client_id = c.id and a.setting = k)
      on conflict (firm_id, client_id, setting) do nothing
      returning firm_id, client_id
    )
    update public.clients c
       set data = c.data || jsonb_build_object(k, false, k || 'At', at_iso), updated_at = now()
      from picked p
     where c.firm_id = p.firm_id and c.id = p.client_id;
    get diagnostics n = row_count;
    raise notice 'migration 213: %: % live client(s) had it on; % turned off; % left on (chosen deliberately since the new build)', k, n_on, n, n_kept;
  end loop;
end $off$;

commit;

-- UNDO (by hand, only if the owner asks): each client changed here gets its old value back, unless it was changed
-- again since (its stamp no longer this run's). The stamp is the undo's own time (the same format), so the restored
-- value is newer than the copy of this run that a browser may still hold (src/js/27 clientOptKeep).
--   begin;
--   set local lock_timeout = '10s';
--   update public.clients c
--      set data = c.data || jsonb_build_object(a.setting, a.old_value, a.setting || 'At', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
--          updated_at = now()
--     from public.optional_off_213 a
--    where c.firm_id = a.firm_id and c.id = a.client_id and a.setting = 'createOptional'
--      and c.data -> a.setting = 'false'::jsonb
--      and c.data ->> (a.setting || 'At') = to_char(a.changed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
--   commit;
