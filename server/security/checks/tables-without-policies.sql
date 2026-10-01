-- Review item 23: four tables have row level security on and no policies, so the app's users (anon, authenticated)
-- cannot read or change a single row of them; only the service role (edge functions) and SECURITY DEFINER functions
-- reach them. This check signs in as each of those roles and tries. It changes nothing: it ends by raising an error
-- carrying the results, which undoes everything it did.
-- Three of the four were empty on staging on 01-Oct-2026, so "0 rows" alone proves little; the first lines therefore
-- read the catalog: row level security on, and no policy at all that lets anon or authenticated in.
--   Run on staging (SQL editor or the Supabase MCP). Expected: "RLS on, 0 policies" for each table, then every
--   line "0 rows" or "no select right", and "insert refused".
do $$
declare
  t text; r text; out text := ''; n bigint; jwt text;
begin
  foreach t in array array['drop_keys', 'gst_sessions', 'support_tickets', 'support_messages'] loop
    select out || format('%s: RLS %s, %s policies for anon or authenticated', t, case when c.relrowsecurity then 'on' else 'OFF' end,
      (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t and p.roles && array['public', 'anon', 'authenticated']::name[])) || E'\n'
      into out from pg_class c where c.oid = format('public.%I', t)::regclass;
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    -- a signed-in user of some firm, as PostgREST would set it
    jwt := json_build_object('role', r, 'sub', '00000000-0000-0000-0000-0000000000a1')::text;
    perform set_config('request.jwt.claims', jwt, true);
    execute format('set local role %I', r);
    foreach t in array array['drop_keys', 'gst_sessions', 'support_tickets', 'support_messages'] loop
      begin
        execute format('select count(*) from public.%I', t) into n;
        out := out || format('%s %s: %s rows', r, t, n);
      exception when insufficient_privilege then out := out || format('%s %s: no select right', r, t);
      end;
      begin
        execute format('insert into public.%I default values', t);
        out := out || ', INSERT WENT THROUGH' || E'\n';
      exception when others then out := out || ', insert refused (' || sqlstate || ')' || E'\n';
      end;
    end loop;
    reset role;
  end loop;
  raise exception E'check done (nothing kept):\n%', out;
end $$;
