-- Migration 61 (06-Oct-2026, privileges clean-up on the public tables). Runs after 58 (staging; any order after 56 on a
-- fresh database: it touches privileges only). ADD-ONLY: no table, column, row, policy or function removed; no statement
-- here removes rows, not even in a comment; it only revokes privileges from anon and authenticated; safe to run twice;
-- one transaction (lock_timeout 10 s). The service role and postgres are never named in a revoke.
--
--   THE FAULT (staging, 06-Oct-2026 12:05 IST, after 58): 67 public tables, all with row security on; 32 of them still
--   grant TRUNCATE to anon and authenticated, and 26 grant anon INSERT, UPDATE and DELETE (Supabase's default grants on
--   every new public table). TRUNCATE is not covered by row security: anyone holding the public key could empty such a
--   table in one request.
--
--   WHAT THE APP WRITES DIRECTLY (src/js, app/src, server/, 06-Oct-2026). Every other write goes through a security
--   definer function (owner postgres) or an edge function using the service role, neither of which needs these grants:
--     clients   authenticated  INSERT + UPDATE  cloudPush: POST clients?on_conflict=firm_id,id (merge-duplicates
--                                               upsert = insert ... on conflict do update), PATCH for the merged setup
--                                               and for the deleted flag (27-firm-account.js)
--     records   authenticated  INSERT + UPDATE  POST records?on_conflict=firm_id,kind,id (upsert), PATCH for the deleted
--                                               flag (27-firm-account.js, 19-document-inbox.js)
--     activity  authenticated  INSERT          POST activity (sign-in, sign-out, Tally writes; 43-two-step.js)
--   Before sign-in (anon) the app writes no table: sign-up and sign-in go through the edge functions signup / signin
--   (service role); signup_info is a function. Cloud.api refuses to run without a session. So no table keeps an anon
--   write privilege. (Row security already refuses every anon write: no policy on staging names anon for a write.)
--   No delete is ever sent (a removal is the deleted flag), activity is append-only (activity_append_only), so DELETE on
--   clients / records and UPDATE / DELETE on activity go too; staging has no policy that would allow them.
--   No security invoker function in public writes a table, and the triggers on clients / records that write
--   (sync_guard_clients, sync_guard_records) are security definer.
--
--   1. TRUNCATE, REFERENCES, TRIGGER: revoked from anon and authenticated on every public table, partitioned table, view,
--      materialized view and foreign table (read from pg_class at run time: tables added later are covered by 3).
--   2. INSERT, UPDATE, DELETE: revoked from anon on every one of them (no exception, see above); from authenticated on
--      every one except the privileges kept above (clients insert + update, records insert + update, activity insert).
--      SELECT is never touched (row security decides what a member reads; the column grants of tally_devices and
--      tally_post_jobs are select only and stay).
--   3. Sequences in public: all revoked from anon; UPDATE (setval) revoked from authenticated; USAGE and SELECT revoked
--      from authenticated except on a sequence that a column default of a table authenticated may still insert into
--      calls (activity_id_seq: activity.id = nextval(...)).
--   4. Default privileges of the role running this file (postgres) in public: TRUNCATE, REFERENCES and TRIGGER revoked
--      from anon and authenticated, so a table created later starts without them. (A table created by supabase_admin
--      follows supabase_admin's defaults, which only that role can change.)
-- At the end it checks: no public table grants TRUNCATE, REFERENCES or TRIGGER to anon or authenticated, anon holds no
-- write privilege on any public table, and the kept privileges are still there where the table is.
-- Tested by tests/run_migration61.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

do $$
declare
  r record;
  keep jsonb := '{"clients": ["insert", "update"], "records": ["insert", "update"], "activity": ["insert"]}';
  p text;
  n int := 0;
begin
  for r in select c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
            order by c.relname loop
    execute format('revoke truncate, references, trigger on table public.%I from anon, authenticated', r.relname);
    execute format('revoke insert, update, delete on table public.%I from anon', r.relname);
    foreach p in array array['insert', 'update', 'delete'] loop
      if not coalesce((keep -> r.relname) ? p, false) then
        execute format('revoke %s on table public.%I from authenticated', p, r.relname);
      end if;
    end loop;
    n := n + 1;
  end loop;
  raise notice 'Migration 61: privileges revoked on % public relations', n;
end $$;

do $$
declare
  s record;
  n int := 0;
begin
  for s in select c.oid, c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' order by c.relname loop
    execute format('revoke all on sequence public.%I from anon', s.relname);
    execute format('revoke update on sequence public.%I from authenticated', s.relname);
    if not exists (select 1 from pg_depend d join pg_attrdef ad on d.classid = 'pg_attrdef'::regclass and d.objid = ad.oid
                    where d.refclassid = 'pg_class'::regclass and d.refobjid = s.oid
                      and has_table_privilege('authenticated', ad.adrelid, 'insert')) then
      execute format('revoke usage, select on sequence public.%I from authenticated', s.relname);
    else
      n := n + 1;
    end if;
  end loop;
  raise notice 'Migration 61: % sequence(s) keep usage for authenticated (a default of a table it inserts into)', n;
end $$;

alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;

do $$
declare bad text;
begin
  select string_agg(c.relname || ' (' || rl || ': ' || pr || ')', ', ' order by c.relname) into bad
    from pg_class c cross join unnest(array['anon', 'authenticated']) rl cross join unnest(array['truncate', 'references', 'trigger']) pr
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege(rl, c.oid, pr);
  if bad is not null then raise exception 'Migration 61: still granted: %', bad; end if;
  select string_agg(c.relname || ' (' || pr || ')', ', ' order by c.relname) into bad
    from pg_class c cross join unnest(array['insert', 'update', 'delete']) pr
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege('anon', c.oid, pr);
  if bad is not null then raise exception 'Migration 61: anon still writes: %', bad; end if;
  select string_agg(t || ' ' || pr, ', ') into bad
    from (values ('clients', 'insert'), ('clients', 'update'), ('records', 'insert'), ('records', 'update'), ('activity', 'insert')) k(t, pr)
   where to_regclass('public.' || t) is not null and not has_table_privilege('authenticated', ('public.' || t)::regclass, pr);
  if bad is not null then raise notice 'Migration 61: authenticated lacks (it lacked it before this file too): %', bad; end if;
end $$;

commit;
