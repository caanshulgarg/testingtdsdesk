-- migration-183-default-grants.sql (13-Nov-2026, branch next-sec-db; the database review of 13-Nov-2026, item M1).
-- Written, NOT run yet: the owner reads it and runs it.
-- Why: a table or sequence made in schema public was given to anon and authenticated by the default privileges of the
-- role that made it, so a table's row-level security was its only protection; eleven tables that only the server uses
-- (row security on, no policy) still held those privileges, and anon held SELECT on the tables of migration 97.
-- Nothing reads a table as anon: the app signs in first (Cloud.api refuses without a session), the public pages call
-- functions only (signup_info, post_inbox, refresh_inbox_link) and the edge functions use the person's token or the
-- service key.
-- What it does:
--   1. default privileges: tables and sequences made from now on by postgres (and supabase_admin, where this role may
--      say so) in public give nothing to anon or authenticated. Every migration grants what its tables need in its own
--      file (docs/MIGRATION-ORDER.md, the rule since migration 97).
--   2. the server's own tables (row security on, no policy; today tally_check_asks, tally_check_days, tally_check_runs,
--      tally_fetch_log, tally_gap_closes, tally_gap_numbers, tally_gap_retries, tally_held_reads, tally_light_days,
--      tally_light_pace, tally_period_skips): nothing for public, anon or authenticated. Their functions are SECURITY DEFINER
--      and are not touched.
--   3. anon: no privilege on any table or sequence of public. authenticated: MAINTAIN taken back (PostgreSQL 17), and
--      its sequences cut to USAGE on the ones behind a table it may insert into (activity, client_timings,
--      tds_challan_allocations, the assistant's tables, ...).
-- What it does not change: any policy, any function's grants, authenticated's SELECT / INSERT / UPDATE / DELETE on a
-- table with a policy, anything service_role holds.
-- Order: after every other migration, and again after any later run of migration 97 (97 gives anon its SELECTs back).
-- Add-only in the sense of the house rule: no table, column, row, policy or function is dropped or changed; privileges
-- are taken back and restated. One transaction, lock_timeout 10 s; safe twice. Tested by tests/run_migration183.py.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------- 1. tables and sequences made from now on
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
do $do$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    begin
      alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated;
      alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated;
    exception when insufficient_privilege then
      raise notice 'migration 183: this role may not change supabase_admin''s default privileges (no table of public is made by it); left as they are';
    end;
  end if;
end $do$;

-- ---------------------------------------------------------------- 2. the server's own tables
do $do$
declare t record;
begin
  for t in select c.oid::regclass as rel from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relrowsecurity
              and not exists (select 1 from pg_policy p where p.polrelid = c.oid) order by c.relname loop
    execute format('revoke all on table %s from public, anon, authenticated', t.rel);
  end loop;
end $do$;

-- ---------------------------------------------------------------- 3. anon; MAINTAIN; sequences
revoke all on all tables in schema public from anon;
do $do$
declare c record;
begin
  -- a column given to anon by name (none on staging today)
  for c in select distinct a.attrelid::regclass as rel, a.attname from pg_attribute a join pg_class k on k.oid = a.attrelid
            cross join lateral aclexplode(a.attacl) x join pg_roles g on g.oid = x.grantee
            where k.relnamespace = 'public'::regnamespace and a.attnum > 0 and not a.attisdropped and g.rolname = 'anon' loop
    execute format('revoke all (%I) on table %s from anon', c.attname, c.rel);
  end loop;
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from authenticated';
  end if;
end $do$;

revoke all on all sequences in schema public from anon, authenticated;
do $do$
declare s record;
begin
  -- restated: the sequence behind a column of a table authenticated may insert into (the table as a whole or a column)
  for s in select q.oid::regclass as seq from pg_class q join pg_depend d on d.classid = 'pg_class'::regclass and d.objid = q.oid
            and d.refclassid = 'pg_class'::regclass and d.deptype in ('a', 'i')
            join pg_class t on t.oid = d.refobjid
            where q.relnamespace = 'public'::regnamespace and q.relkind = 'S' and t.relkind in ('r', 'p')
              and has_any_column_privilege('authenticated', t.oid, 'INSERT') order by q.relname loop
    execute format('grant usage on sequence %s to authenticated', s.seq);
  end loop;
end $do$;

commit;
