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
--   WHAT THE APP WRITES DIRECTLY (src/js, app/src, server/, 06-Oct-2026), and the columns each request sends. Every other
--   write goes through a security definer function (owner postgres) or an edge function using the service role, neither
--   of which needs these grants:
--     clients   authenticated  POST clients?on_conflict=firm_id,id (merge-duplicates upsert = insert ... on conflict do
--                              update set <every column sent>): firm_id, id, name, gstin, pan, tally_name, data, deleted;
--                              PATCH (the merged setup): name, gstin, pan, tally_name, data, deleted;
--                              PATCH (the deleted flag): deleted, delete_reason (27-firm-account.js)
--     records   authenticated  POST records?on_conflict=firm_id,kind,id (upsert): firm_id, kind, id, client_id, data,
--                              deleted; PATCH (the deleted flag): deleted, delete_reason (27-firm-account.js,
--                              19-document-inbox.js)
--     activity  authenticated  POST activity: firm_id, client_id, what, detail (43-two-step.js; id, user_id and at are
--                              the defaults: nextval, auth.uid(), now())
--   Before sign-in (anon) the app writes no table: sign-up and sign-in go through the edge functions signup / signin
--   (service role); signup_info is a function. Cloud.api refuses to run without a session. So no table keeps an anon
--   write privilege. (Row security already refuses every anon write: no policy on staging names anon for a write.)
--   No delete is ever sent (a removal is the deleted flag), activity is append-only (activity_append_only), so DELETE on
--   clients / records and UPDATE / DELETE on activity go too; staging has no policy that would allow them.
--   COLUMNS. On those three tables authenticated keeps INSERT / UPDATE on exactly the columns above, no more: the columns
--   the server fills (updated_at / updated_by, deleted_at / deleted_by, restored_at / restored_by: sync_guard_* and the
--   defaults) can no longer be written by a member (a member could otherwise set deleted_by or restored_by to someone else
--   on a row whose flag does not change), and activity's id, user_id and at come only from their defaults (a member
--   could otherwise back-date an audit row, or take an id ahead of the sequence). firm_id stays writable on clients and
--   records because the upsert sends it (on conflict it sets it again, to the same value); moving a row to another firm
--   is refused by the policies' WITH CHECK (firm_id = my_firm()), tested.
--   members and platform_secrets: no page writes either directly, although staging has policies for it (members_self:
--   UPDATE of one's own row; secrets_write / secrets_update: INSERT / UPDATE by a platform administrator). Inviting or
--   adding a person, switching one off or on (and a role, which only the admin function can change: the page shows it,
--   not editable) go to the edge function admin (POST /functions/v1/admin), which writes members as the service role
--   after checking that the caller is an active owner of the firm or a platform administrator; a platform key is saved
--   through admin_set_secret (POST rpc/admin_set_secret, security definer, is_superadmin()). The app's code has read
--   members only (GET members?select=...) and saved keys through admin_set_secret since the first commit of this
--   repository (24-Sep-2026); the policies are not in any SQL file here (made before it).
--   THE OWNER'S FINDING (06-Oct-2026): members_self plus authenticated's UPDATE on every column of members let a staff
--   member set their own role to 'owner' with one PATCH (audit_members only logs it). With UPDATE revoked here the policy
--   is inert: a member changes no column of their own row (role, active, firm_id, email, user_id), tested. No page edits a
--   member's own details, so no column of members is granted back. tests/run_perms61_pages.py records what the pages
--   send. Should a page be refused on staging:
--     grant update on public.members to authenticated;
--     grant insert, update on public.platform_secrets to authenticated;
--   No security invoker function in public writes a table, and the triggers on clients / records that write
--   (sync_guard_clients, sync_guard_records) are security definer.
--
--   1. TRUNCATE, REFERENCES, TRIGGER: revoked from anon and authenticated on every public table, partitioned table, view,
--      materialized view and foreign table (read from pg_class at run time: tables added later are covered by 4).
--   2. INSERT, UPDATE, DELETE: revoked from anon on every one of them (no exception, see above), and from authenticated
--      on every one; then, on clients, records and activity only, granted back to authenticated on exactly the columns
--      above (columns the table has; a revoke on the table also clears earlier column grants, so a second run ends the
--      same). SELECT is never touched (row security decides what a member reads; the column grants of tally_devices and
--      tally_post_jobs are select only and stay).
--   3. Sequences in public: all revoked from anon; UPDATE (setval) revoked from authenticated; USAGE and SELECT revoked
--      from authenticated except on a sequence that a column default of a table authenticated may still insert into
--      calls (activity_id_seq: activity.id = nextval(...)).
--   4. Default privileges of the role running this file (postgres) in public: TRUNCATE, REFERENCES and TRIGGER revoked
--      from anon and authenticated, so a table created later starts without them. (A table created by supabase_admin
--      follows supabase_admin's defaults, which only that role can change.)
-- At the end it checks: no public table grants TRUNCATE, REFERENCES or TRIGGER to anon or authenticated, anon holds no
-- write privilege on any public table or column, members and platform_secrets take no write from authenticated, and the
-- kept columns are there where the table is.
-- Tested by tests/run_migration61.py.

begin;
set local lock_timeout = '10s';     -- never queue long behind a session holding a table here (a timeout rolls the whole file back: run it again)

do $$
declare
  r record;
  -- what the app sends, table by table (see above); granted back to authenticated on the columns the table has
  keep jsonb := '{"clients":  {"insert": ["firm_id", "id", "name", "gstin", "pan", "tally_name", "data", "deleted"],
                               "update": ["firm_id", "id", "name", "gstin", "pan", "tally_name", "data", "deleted", "delete_reason"]},
                  "records":  {"insert": ["firm_id", "kind", "id", "client_id", "data", "deleted"],
                               "update": ["firm_id", "kind", "id", "client_id", "data", "deleted", "delete_reason"]},
                  "activity": {"insert": ["firm_id", "client_id", "what", "detail"]}}';
  p text;
  cols text;
  n int := 0;
begin
  for r in select c.oid, c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
            order by c.relname loop
    execute format('revoke truncate, references, trigger on table public.%I from anon, authenticated', r.relname);
    execute format('revoke insert, update, delete on table public.%I from anon', r.relname);
    execute format('revoke insert, update, delete on table public.%I from authenticated', r.relname);
    if keep ? r.relname then
      for p in select jsonb_object_keys(keep -> r.relname) loop
        select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
          from pg_attribute a
         where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
           and a.attname in (select jsonb_array_elements_text(keep -> r.relname -> p));
        if cols is not null then
          execute format('grant %s (%s) on table public.%I to authenticated', p, cols, r.relname);
        end if;
      end loop;
    end if;
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
                      and has_any_column_privilege('authenticated', ad.adrelid, 'insert')) then
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
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') and case when pr = 'delete' then has_table_privilege('anon', c.oid, pr) else has_any_column_privilege('anon', c.oid, pr) end;
  if bad is not null then raise exception 'Migration 61: anon still writes: %', bad; end if;
  select string_agg(t || ' (' || pr || ')', ', ') into bad
    from unnest(array['members', 'platform_secrets']) t cross join unnest(array['insert', 'update', 'delete']) pr
   where to_regclass('public.' || t) is not null and case when pr = 'delete' then has_table_privilege('authenticated', ('public.' || t)::regclass, pr) else has_any_column_privilege('authenticated', ('public.' || t)::regclass, pr) end;
  if bad is not null then raise exception 'Migration 61: authenticated still writes: %', bad; end if;
  select string_agg(t || '.' || c || ' ' || pr, ', ') into bad
    from (values ('clients', 'id', 'insert'), ('clients', 'data', 'update'), ('records', 'id', 'insert'), ('records', 'data', 'update'), ('activity', 'what', 'insert')) k(t, c, pr)
   where to_regclass('public.' || t) is not null
     and exists (select 1 from pg_attribute where attrelid = ('public.' || t)::regclass and attname = c and not attisdropped)
     and not has_column_privilege('authenticated', ('public.' || t)::regclass, c, pr);
  if bad is not null then raise exception 'Migration 61: authenticated lacks what the app sends: %', bad; end if;
end $$;

commit;
