-- Migration 213 (23-Nov-2026, branch next-optional-off). A DRAFT: written and tested here (tests/run_migration213.py on
-- pg_stand); NOT run anywhere. The coordinator runs it on staging after the review, AFTER the build with
-- next-optional-off is live (that build stamps a deliberate tick, src/js/27 clientOptKeep, so an old open tab cannot put
-- the old "on" back).
--
-- The owner, 23-Nov-2026: "optional entries to be defaulted off in every client". New clients start off in the app
-- (src/js/00-core.js newCompany); this turns it off in the clients that hold it on today:
--   public.clients.data.createOptional = true  ->  false, with data.createOptionalAt = the time of this run (UTC, ISO, as
--   the app writes it) and updated_at = now(), so every browser pulls the new copy and treats it as newer than its own.
--   A client whose data already holds createOptionalAt was ticked on deliberately with the new build: left as it is.
--   public.optional_off_213  one row per client changed: firm_id, client_id, the old value of createOptional and of
--                            createOptionalAt, changed_at. The undo, at the foot, puts those back.
-- ADD-ONLY: one new table (no policy: nobody reads it through the API; the SQL editor does); one UPDATE of clients.data,
-- only of the key createOptional (and createOptionalAt) of the clients that have it true. Nothing is dropped or deleted.
-- Safe to run twice: a client already in optional_off_213 is never changed again (an "on" chosen after this run stays).
-- Supabase gives anon and authenticated every right on a new table by default: all taken back, public and service_role
-- too. One transaction, lock_timeout 10 s.
begin;
set local lock_timeout = '10s';

-- the names: public.clients as the app has it, and optional_off_213 absent or this migration's own (its comment)
do $names$
begin
  if to_regclass('public.clients') is null then raise exception 'migration 213: public.clients is not on this database. Nothing was changed.'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'data' and data_type = 'jsonb')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'updated_at')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'firm_id') then
    raise exception 'migration 213: public.clients has no data (jsonb), firm_id or updated_at column. Nothing was changed.';
  end if;
  if to_regclass('public.optional_off_213') is not null and coalesce(obj_description(to_regclass('public.optional_off_213'), 'pg_class'), '') <> 'optional vouchers off (migration 213)' then
    raise exception 'migration 213: a table public.optional_off_213 already exists and is not this migration''s. Nothing was changed.';
  end if;
end $names$;

create table if not exists public.optional_off_213 (
  firm_id     uuid not null,
  client_id   text not null,
  old_value   jsonb,                       -- data.createOptional before (true)
  old_at      jsonb,                       -- data.createOptionalAt before (none: null)
  changed_at  timestamptz not null default now(),
  primary key (firm_id, client_id)
);
comment on table public.optional_off_213 is 'optional vouchers off (migration 213)';
alter table public.optional_off_213 enable row level security;
revoke all on table public.optional_off_213 from public, anon, authenticated, service_role;

-- the change: each client on (and not ticked on deliberately with the new build), logged first, then turned off
do $off$
declare n_on int; n_kept int; n int; at_iso text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select count(*) filter (where c.data -> 'createOptional' = 'true'::jsonb),
         count(*) filter (where c.data -> 'createOptional' = 'true'::jsonb and c.data ? 'createOptionalAt')
    into n_on, n_kept
    from public.clients c where jsonb_typeof(c.data) = 'object';
  with picked as (
    insert into public.optional_off_213 (firm_id, client_id, old_value, old_at)
    select c.firm_id, c.id, c.data -> 'createOptional', c.data -> 'createOptionalAt'
      from public.clients c
     where jsonb_typeof(c.data) = 'object' and c.data -> 'createOptional' = 'true'::jsonb and not (c.data ? 'createOptionalAt')
       and not exists (select 1 from public.optional_off_213 a where a.firm_id = c.firm_id and a.client_id = c.id)
    on conflict (firm_id, client_id) do nothing
    returning firm_id, client_id
  )
  update public.clients c
     set data = c.data || jsonb_build_object('createOptional', false, 'createOptionalAt', at_iso), updated_at = now()
    from picked p
   where c.firm_id = p.firm_id and c.id = p.client_id;
  get diagnostics n = row_count;
  raise notice 'migration 213: % client(s) had Optional vouchers on; % turned off; % left on (ticked on deliberately since the new build)', n_on, n, n_kept;
end $off$;

commit;

-- UNDO (by hand, only if the owner asks): each client changed here gets its old value back, unless it was changed
-- again since (createOptionalAt no longer this run's). createOptionalAt goes back to its old value, or JSON null where
-- there was none (a key left out would be kept by the trigger clients_keep_keys, migration 30).
--   begin;
--   set local lock_timeout = '10s';
--   update public.clients c
--      set data = c.data || jsonb_build_object('createOptional', a.old_value, 'createOptionalAt', coalesce(a.old_at, 'null'::jsonb)),
--          updated_at = now()
--     from public.optional_off_213 a
--    where c.firm_id = a.firm_id and c.id = a.client_id
--      and c.data -> 'createOptional' = 'false'::jsonb
--      and c.data ->> 'createOptionalAt' = to_char(a.changed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
--   commit;
