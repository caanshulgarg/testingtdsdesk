"""python3 run_migration61.py - migration-61-privileges (06-Oct-2026): the public tables' privileges cleaned up. Staging
(after 58) had 67 public tables, all with row security on; 32 still granted TRUNCATE to anon and authenticated (row
security does not cover it: the public key could empty a table) and 26 granted anon INSERT, UPDATE and DELETE.
On throwaway PostgreSQL (pg_stand, port 30610; never a real database) with Supabase's default grants emulated (every new
public table, sequence and function granted to anon, authenticated and service_role), built in staging's order
32 -> ... -> 56, plus the tables staging has that the stand lacks (by name, row security on), clients / records /
activity as on staging (columns, keys, the activity_id_seq default, row security and the policies) and 32's view
tally_balances (security invoker, as on staging). Then 61, twice. Checks:
  0. the file: one transaction (begin; set local lock_timeout; ... commit;), no 'delete from' (comments included), no
     drop, TRUNCATE only inside a revoke, service_role / postgres never revoked from, no real database named.
  1. before 61 (red): anon and authenticated hold TRUNCATE; anon holds INSERT, UPDATE, DELETE.
  2. it runs twice; no row changed (an md5 of every public table's rows, before and after).
  3. after: on every public relation neither role holds TRUNCATE, REFERENCES or TRIGGER; anon holds no INSERT / UPDATE /
     DELETE; authenticated holds INSERT + UPDATE on clients and records, INSERT on activity, and no other write; SELECT of
     both roles exactly as before (the column grants too); service_role and postgres exactly as before.
  4. sequences: anon none; authenticated only usage + select on activity_id_seq (activity.id's default); service_role as
     before.
  5. a table created after 61 (by postgres) starts without TRUNCATE / REFERENCES / TRIGGER for anon and authenticated.
  6. what the app does, as authenticated under row security, in the SQL PostgREST sends: the clients upsert (insert ... on
     conflict do update), the merged-setup PATCH (update ... where updated_at = ... returning), the deleted flag PATCH,
     the records upsert and deleted flag, the activity POST (id from activity_id_seq, user_id auth.uid()); a security
     definer function writing a table (tally_device_trial_tools). All work.
  7. refused: anon TRUNCATE / INSERT; authenticated TRUNCATE, an INSERT into tally_vouchers, a DELETE on clients.
  8. members and platform_secrets, with staging's policies (members_self; secrets_write / secrets_update; no SELECT policy
     on platform_secrets) and admin_set_secret / admin_secrets() as granted on staging (bodies: the stand's own). Before
     AND after 61: anon and authenticated (a member, a platform administrator) read no row of platform_secrets;
     admin_secrets() is refused to both; the service role reads (admin_secrets() and the table), postgres reads. Before 61
     the policies let a member update their own row and a platform administrator write a key directly (rolled back);
     after 61 those direct writes are refused, and what the pages send (tests/run_perms61_pages.py) works: the key saved
     through admin_set_secret as the platform administrator (refused to a firm owner who is not one), and the admin edge
     function's members upsert (invite / add) and update (role, switch off) as the service role.
RED: before the file exists it stops at the first check."""
import os, re, sys, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
FILES = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-33-ledger-lists.sql", "migration-35-bridge-control.sql")] + \
        [os.path.join(HERE, "fixtures", "migration-34-as-run-on-staging.sql")] + \
        [os.path.join(SQLDIR, f) for f in ("migration-36b-post-acceptance.sql", "migration-37-follow-ups.sql", "migration-36-ledger-rename.sql", "migration-38-post-followups.sql",
                                           "migration-39-rename-map-empty-day.sql", "migration-40-states-carried.sql", "migration-41-day-counts.sql", "migration-42-empty-day-second-read.sql",
                                           "migration-43-posting-reply.sql", "migration-44-recorder.sql", "migration-45-bulk-posting.sql", "migration-46-trial-tools.sql",
                                           "migration-47-recorder-queue-alerts.sql", "migration-48-day-cache-once.sql", "migration-49-post-row-flags.sql", "migration-50-recorder-held.sql",
                                           "migration-51-recorder-ids-mismatch.sql", "migration-52-recorder-duplicate-needs-same-entry.sql", "migration-53-recorder-placeholder-settled.sql",
                                           "migration-54-post-target-bridge.sql", "migration-55-settle-and-lease.sql", "migration-56-keep-fields.sql")]
M61 = os.environ.get("M61_FILE") or os.path.join(SQLDIR, "migration-61-privileges.sql")
# staging's 67 public tables (06-Oct-2026 12:05 IST)
STAGING = """activity app_settings auth_lockout backups client_book_items client_book_items_history client_books client_books_history clients drop_keys
fincom_migration_text firm_modules firms gst_einv_accounts gst_einvoices gst_returns gst_sessions members modules plans platform_admins platform_secrets
records support_messages support_tickets sync_refused tally_alerts tally_bills tally_books tally_bridge_alerts tally_bridge_ids tally_bridge_prefs
tally_bridge_release_log tally_bridge_releases tally_bridge_rollbacks tally_companies tally_company_lease tally_days tally_devices tally_groups tally_jobs
tally_ledger_day tally_ledger_lists tally_ledger_marks tally_ledger_rounds tally_ledgers tally_lines tally_member_bridges tally_month_locks tally_post_checks
tally_post_ids tally_post_jobs tally_post_marks tally_post_row_flags tally_post_windows tally_read_stops tally_recorder_failures tally_recorder_lines
tally_recorder_pending tally_recorder_restore_log tally_sync_cursor tally_sync_reads tally_tieouts tally_voucher_versions tally_vouchers usage_period
wallet_entries""".split()
KEEP = {"clients": {"INSERT", "UPDATE"}, "records": {"INSERT", "UPDATE"}, "activity": {"INSERT"}}
PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]
ROLES = ["anon", "authenticated", "service_role", "postgres"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = r"""') if (name + ' = r"""') in s else s.index(name + ' = """')
    i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
F, OWNER, D1 = "99999999-9999-9999-9999-999999999999", "55555555-5555-5555-5555-555555555555", "d1000000-0000-0000-0000-000000000001"
ADMIN, STAFF = "77777777-7777-7777-7777-777777777777", "66666666-6666-6666-6666-666666666666"     # a platform administrator; a new staff member

text = open(M61).read() if os.path.exists(M61) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M61))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
code = re.sub(r"(?m)--.*$", "", low)
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and low.count("\nbegin;") == 1 and low.count("commit;") == 1,
   "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0, "0. no 'delete from' anywhere in the file (comments included)")
ok(not re.search(r"\bdrop\b", low), "0. add-only (no drop)")
ok(all(re.search(r"revoke\s+(truncate|'truncate'|[a-z, ]*truncate)", code[max(0, m.start() - 40):m.end()]) or "array['truncate'" in code[max(0, m.start() - 20):m.end() + 2]
       for m in re.finditer(r"\btruncate\b", code)), "0. TRUNCATE only named in a revoke (or the end check's list), never run")
ok(not re.search(r"from[^;]*\b(service_role|postgres)\b", " ".join(l for l in code.splitlines() if "revoke" in l)), "0. no revoke names service_role or postgres")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocs", low), "0. names no real database")

db = pg_stand.start(30610)
def psql_text(sql):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
                          input=sql, capture_output=True, text=True)
def rels(): return [r["n"] for r in db.rows("select relname as n from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p', 'v', 'm', 'f') order by 1")]
def tables(): return [r["n"] for r in db.rows("select relname as n from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r', 'p') order by 1")]
def seqs(): return [r["n"] for r in db.rows("select relname as n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'S' order by 1")]
def grid():
    """{(role, relation): set of privileges} for every public relation, in one query"""
    out = {}
    sql = "select r.rolname as ro, c.relname as t, p as pr from pg_class c cross join (select rolname from pg_roles where rolname in (%s)) r cross join unnest(array[%s]) p " \
          "where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege(r.rolname, c.oid, p)" % (",".join(map(q, ROLES)), ",".join(map(q, PRIVS)))
    for x in db.rows(sql): out.setdefault((x["ro"], x["t"]), set()).add(x["pr"])
    return out
def seqgrid():
    out = {}
    sql = "select r.rolname as ro, c.relname as s, p as pr from pg_class c cross join (select rolname from pg_roles where rolname in (%s)) r cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p " \
          "where c.relnamespace = 'public'::regnamespace and c.relkind = 'S' and has_sequence_privilege(r.rolname, c.oid, p)" % ",".join(map(q, ROLES))
    for x in db.rows(sql): out.setdefault((x["ro"], x["s"]), set()).add(x["pr"])
    return out
def colacl(): return db.rows("select c.relname as t, a.attname as a, a.attacl::text as acl from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace and a.attacl is not null order by 1, 2")
def fingerprint():
    """an md5 of each public table's rows (every column, sorted), so a changed row shows, not only a count"""
    parts = ["select %s as t, md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as m, count(*) as n from public.%s x" % (q(t), '"%s"' % t) for t in tables()]
    return {r["t"]: (r["m"], r["n"]) for r in db.rows(" union all ".join(parts))}
def as_role(role, sql, uid=None):
    pre = "\\pset tuples_only on\n\\pset format unaligned\nset role %s;\n" % role + ("set fincom.uid = '%s';\n" % uid if uid else "")
    return psql_text(pre + sql)
try:
    # Supabase's default grants, before anything is made: every new public table, sequence and function to the three roles
    db.sql("""do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if; end $$;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
      grant usage on schema public, auth to anon, authenticated, service_role;
      grant all on all tables in schema public to anon, authenticated, service_role;
      grant all on all sequences in schema public to anon, authenticated, service_role;""")
    db.sql(part(os.path.join(HERE, "run_migration33.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration35.py"), "SCHEMA")); db.sql(part(os.path.join(HERE, "run_migration37.py"), "SCHEMA_X"))
    db.sql(part(os.path.join(HERE, "run_migration47.py"), "SCHEMA47"))
    # clients, records and activity as on staging (columns, keys, the sequence default, row security, the policies)
    db.sql("""
      drop table if exists public.clients;
      create table public.clients (id text not null, firm_id uuid not null, name text not null default '', gstin text not null default '', pan text not null default '',
        tally_name text not null default '', data jsonb not null default '{}', updated_at timestamptz not null default now(), updated_by uuid, deleted boolean not null default false,
        deleted_at timestamptz, deleted_by uuid, delete_reason text, restored_at timestamptz, restored_by uuid, primary key (firm_id, id));
      create table if not exists public.records (firm_id uuid not null, client_id text not null default '', kind text not null, id text not null, data jsonb not null default '{}',
        updated_at timestamptz not null default now(), updated_by uuid, deleted boolean not null default false, deleted_at timestamptz, deleted_by uuid, delete_reason text,
        restored_at timestamptz, restored_by uuid, primary key (firm_id, kind, id));
      create sequence if not exists public.activity_id_seq;
      create table if not exists public.activity (id bigint not null default nextval('activity_id_seq') primary key, firm_id uuid not null, user_id uuid default auth.uid(),
        client_id text not null default '', what text not null, detail text not null default '', at timestamptz not null default now());
      alter sequence public.activity_id_seq owned by public.activity.id;
      alter table public.clients enable row level security; alter table public.records enable row level security; alter table public.activity enable row level security;
      create policy clients_read on public.clients for select to authenticated using ((firm_id = my_firm()) or is_superadmin());
      create policy clients_write on public.clients for insert to authenticated with check (((firm_id = my_firm()) and can_write()) or is_superadmin());
      create policy clients_update on public.clients for update to authenticated using (((firm_id = my_firm()) and can_write()) or is_superadmin()) with check ((firm_id = my_firm()) or is_superadmin());
      create policy records_read on public.records for select to authenticated using ((firm_id = my_firm()) or is_superadmin());
      create policy records_write on public.records for insert to authenticated with check (((firm_id = my_firm()) and can_write()) or is_superadmin());
      create policy records_update on public.records for update to authenticated using (((firm_id = my_firm()) and can_write()) or is_superadmin()) with check ((firm_id = my_firm()) or is_superadmin());
      create policy activity_read on public.activity for select to authenticated using ((firm_id = my_firm()) or is_superadmin());
      create policy activity_write on public.activity for insert to authenticated with check ((firm_id = my_firm()) and (user_id = auth.uid()));
      create policy members_read on public.members for select to authenticated using (true);
      alter table public.members enable row level security;
      create sequence if not exists public.book_item_seq;""")
    # members, platform_admins, platform_secrets with staging's write policies (06-Oct-2026: members_self; secrets_write,
    # secrets_update; no SELECT policy on platform_secrets). admin_set_secret (security definer, is_superadmin(), executable by
    # authenticated) and admin_secrets() (the service role's) as staging has them by signature and grant; their bodies here
    # are the stand's own (an upsert by name; the names and times). members' key user_id: the admin function's upsert key.
    db.sql("""
      alter table public.members add column if not exists email text; alter table public.members add primary key (user_id);
      create policy members_self on public.members for update to authenticated using (user_id = auth.uid()) with check ((user_id = auth.uid()) and (firm_id = my_firm()));
      create table public.platform_admins (user_id uuid primary key);
      alter table public.platform_admins enable row level security;
      create or replace function public.is_superadmin() returns boolean language sql stable security definer set search_path = public as $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;
      create table public.platform_secrets (name text primary key, value text not null, set_at timestamptz not null default now(), set_by uuid);
      alter table public.platform_secrets enable row level security;
      create policy secrets_write on public.platform_secrets for insert to authenticated with check (is_superadmin());
      create policy secrets_update on public.platform_secrets for update to authenticated using (is_superadmin()) with check (is_superadmin());
      create or replace function public.admin_set_secret(p_name text, p_value text) returns void language plpgsql security definer set search_path = public, pg_temp as $f$
      begin
        if not is_superadmin() then raise exception 'not allowed' using errcode = '42501'; end if;
        insert into platform_secrets (name, value, set_at, set_by) values (p_name, p_value, now(), auth.uid())
          on conflict (name) do update set value = excluded.value, set_at = excluded.set_at, set_by = excluded.set_by;
      end $f$;
      revoke all on function public.admin_set_secret(text, text) from public, anon; grant execute on function public.admin_set_secret(text, text) to authenticated, service_role;
      create or replace function public.admin_secrets() returns table (name text, set_at timestamptz) language sql stable security definer set search_path = public, pg_temp as $f$ select name, set_at from platform_secrets order by name $f$;
      revoke all on function public.admin_secrets() from public, anon, authenticated; grant execute on function public.admin_secrets() to service_role;""")
    db.sql("""insert into firms values (%(F)s, 'Firm') on conflict do nothing;
      insert into members (user_id, firm_id, name, role, active, email) values (%(O)s, %(F)s, 'Anshul', 'owner', true, 'a@b.in'), (%(A)s, %(F)s, 'Platform', 'owner', true, 'p@b.in');
      insert into platform_admins values (%(A)s);
      insert into platform_secrets (name, value) values ('claude_api_key', 'sk-old'), ('google_vision_key', 'gv-old');
      insert into tally_devices (id, firm_id, name, key_hash, version, info) values (%(D1)s, %(F)s, 'NW144', 'h1', '2.3.0', '{}');
      insert into clients (id, firm_id, name, data) values ('c1', %(F)s, 'Client One', '{"name": "Client One"}');
      insert into records (firm_id, client_id, kind, id, data) values (%(F)s, 'c1', 'bill', 'b1', '{"no": "1"}');""" % {"F": q(F), "O": q(OWNER), "D1": q(D1), "A": q(ADMIN)})
    for path in FILES:
        r = psql_text(open(path).read())
        if r.returncode: ok(False, "%s runs: %s" % (os.path.basename(path), r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql("alter view public.tally_balances set (security_invoker = true);")      # made by 32; on staging a security invoker view
    # the rest of staging's tables, by name (Supabase's default grants on them), row security on, one row each where it can
    have = set(tables())
    for t in STAGING:
        if t not in have: db.sql("create table public.%s (id bigserial primary key, note text); insert into public.%s (note) values ('stand');" % (t, t))
    for t in STAGING: db.sql("alter table public.%s enable row level security;" % t)
    ok(set(STAGING) <= set(tables()), "the stand has staging's 67 public tables (%d public tables in all)" % len(tables()))

    g0, s0, c0 = grid(), seqgrid(), colacl()
    trunc = [t for t in tables() if "TRUNCATE" in g0.get(("anon", t), set()) and "TRUNCATE" in g0.get(("authenticated", t), set())]
    anonw = [t for t in tables() if {"INSERT", "UPDATE", "DELETE"} <= g0.get(("anon", t), set())]
    ok(len(trunc) >= 32 and len(anonw) >= 26, "1. before 61 (red): %d tables grant TRUNCATE to anon and authenticated, %d grant anon INSERT, UPDATE and DELETE" % (len(trunc), len(anonw)))
    def secrets_reads(when):
        """8. platform_secrets: anon and authenticated (a member, a platform administrator) read no row (no SELECT policy);
        admin_secrets() refused to both; the service role reads (admin_secrets() and directly, bypassing row security, as the
        gateway function does); postgres reads"""
        n = {}
        for role, uid, key in (("anon", None, "anon"), ("authenticated", OWNER, "member"), ("authenticated", ADMIN, "platform admin")):
            r = as_role(role, "select 'n=' || count(*) from public.platform_secrets;", uid)
            n[key] = (r.stdout.strip() or r.stderr.strip()[-80:])
        ok(all(v == "n=0" or "permission denied" in v for v in n.values()), "8. %s: platform_secrets: anon and authenticated read no row (%s)" % (when, n))
        refused = [as_role(r, "select * from public.admin_secrets();", u) for r, u in (("anon", None), ("authenticated", ADMIN))]
        ok(all(x.returncode != 0 and "permission denied for function admin_secrets" in x.stderr for x in refused), "8. %s: admin_secrets() refused to anon and to authenticated (a platform administrator too)" % when)
        sv = as_role("service_role", "select 'f=' || (select count(*) from public.admin_secrets()) || ',t=' || (select count(*) from public.platform_secrets);")
        ok(sv.returncode == 0 and sv.stdout.strip() == "f=2,t=2" and db.one("select count(*) from public.platform_secrets") == "2",
           "8. %s: the service role reads them (admin_secrets() and the table: %s); postgres reads them" % (when, sv.stdout.strip() or sv.stderr.strip()[-100:]))
    def tried(role, sql, uid):
        """a write tried and always rolled back: 'ok' when it worked, else the error"""
        r = as_role(role, "begin;\n%s\nrollback;" % sql, uid)
        return "ok" if r.returncode == 0 else r.stderr.strip()[-90:]
    secrets_reads("before 61")
    SELF = "update public.members set name = 'Anshul G' where user_id = %s;" % q(OWNER)
    SEC_INS = "insert into public.platform_secrets (name, value) values ('gst_key', 'x');"
    SEC_UPD = "update public.platform_secrets set value = 'sk-new' where name = 'claude_api_key';"
    b = {"members self update": tried("authenticated", SELF, OWNER), "secrets insert (platform admin)": tried("authenticated", SEC_INS, ADMIN), "secrets update (platform admin)": tried("authenticated", SEC_UPD, ADMIN)}
    ok(b["members self update"] == "ok" and b["secrets insert (platform admin)"] == "ok", "8. before 61: staging's policies let a member update their own row and a platform administrator write a key directly (%s; rolled back)" % b)
    fp0 = fingerprint()
    for rnd in (1, 2):
        r = psql_text(text)
        ok(r.returncode == 0, "2. pass %d: migration 61 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
    fp1 = fingerprint()
    ok(fp1 == fp0, "2. no row changed: the md5 of every public table's rows is the same (%d tables, %d rows)" % (len(fp0), sum(int(v[1]) for v in fp0.values())))

    g1, s1, c1 = grid(), seqgrid(), colacl()
    bad = {t: (sorted(g1.get(("anon", t), set()) & {"TRUNCATE", "REFERENCES", "TRIGGER"}), sorted(g1.get(("authenticated", t), set()) & {"TRUNCATE", "REFERENCES", "TRIGGER"}))
           for t in rels() if (g1.get(("anon", t), set()) | g1.get(("authenticated", t), set())) & {"TRUNCATE", "REFERENCES", "TRIGGER"}}
    ok(not bad, "3. no public relation grants TRUNCATE, REFERENCES or TRIGGER to anon or authenticated (%d relations) %s" % (len(rels()), bad or ""))
    bad = {t: sorted(g1.get(("anon", t), set()) & {"INSERT", "UPDATE", "DELETE"}) for t in rels() if g1.get(("anon", t), set()) & {"INSERT", "UPDATE", "DELETE"}}
    ok(not bad, "3. anon holds no INSERT, UPDATE or DELETE anywhere %s" % (bad or ""))
    writes = {t: g1.get(("authenticated", t), set()) & {"INSERT", "UPDATE", "DELETE"} for t in rels()}
    writes = {t: v for t, v in writes.items() if v}
    ok(writes == KEEP, "3. authenticated writes only clients (insert, update), records (insert, update), activity (insert): %s" % {t: sorted(v) for t, v in writes.items()})
    ok(all((g0.get((ro, t), set()) & {"SELECT"}) == (g1.get((ro, t), set()) & {"SELECT"}) for ro in ("anon", "authenticated") for t in rels()) and c0 == c1,
       "3. SELECT of anon and authenticated exactly as before, the column grants (tally_devices, tally_post_jobs) too")
    ok(all(g0.get((ro, t)) == g1.get((ro, t)) for ro in ("service_role", "postgres") for t in rels()) and all(len(g1.get(("service_role", t), set())) == 7 for t in tables()),
       "3. service_role and postgres exactly as before (service_role all seven on every table)")
    keepseq = {k: v for k, v in s1.items() if k[0] in ("anon", "authenticated")}
    ok(keepseq == {("authenticated", "activity_id_seq"): {"USAGE", "SELECT"}}, "4. sequences: anon none; authenticated only usage + select on activity_id_seq (%s)" % {k: sorted(v) for k, v in keepseq.items()})
    ok(all(s0.get(("service_role", s)) == s1.get(("service_role", s)) for s in seqs()) and len(seqs()) >= 10, "4. service_role's sequence privileges as before (%d sequences)" % len(seqs()))
    db.sql("create table public.zz_after_61 (id int primary key);")
    ok(all(not db.one("select has_table_privilege(%s, 'public.zz_after_61', %s)::text" % (q(ro), q(p))) == "true" for ro in ("anon", "authenticated") for p in ("TRUNCATE", "REFERENCES", "TRIGGER"))
       and db.one("select has_table_privilege('service_role', 'public.zz_after_61', 'TRUNCATE')::text") == "true",
       "5. a table created after 61 starts without TRUNCATE / REFERENCES / TRIGGER for anon and authenticated (service_role keeps them)")

    # 6. the app's own writes, as PostgREST sends them, as authenticated under row security
    app = [
        ("clients upsert (POST clients?on_conflict=firm_id,id, merge-duplicates)",
         "insert into public.clients (firm_id, id, name, gstin, pan, tally_name, data, deleted) values (%s, 'c2', 'Client Two', '', '', '', '{}', false) "
         "on conflict (firm_id, id) do update set name = excluded.name, gstin = excluded.gstin, pan = excluded.pan, tally_name = excluded.tally_name, data = excluded.data, deleted = excluded.deleted;" % q(F)),
        ("clients upsert of an existing client (the update half)",
         "insert into public.clients (firm_id, id, name, data, deleted) values (%s, 'c1', 'Client One Ltd', '{\"name\": \"Client One Ltd\"}', false) "
         "on conflict (firm_id, id) do update set name = excluded.name, data = excluded.data, deleted = excluded.deleted;" % q(F)),
        ("clients merged-setup PATCH (where updated_at = ..., return=representation)",
         "update public.clients set name = 'Client One (merged)', data = '{\"a\": 1}', deleted = false where firm_id = %s and id = 'c1' and updated_at = (select updated_at from public.clients where firm_id = %s and id = 'c1') returning id;" % (q(F), q(F))),
        ("clients deleted flag PATCH", "update public.clients set deleted = true, delete_reason = 'removed in the app' where firm_id = %s and id = 'c2';" % q(F)),
        ("records upsert (POST records?on_conflict=firm_id,kind,id)",
         "insert into public.records (firm_id, kind, id, client_id, data, deleted) values (%s, 'bill', 'b1', 'c1', '{\"no\": \"1A\"}', false), (%s, 'bill', 'b2', 'c1', '{}', false) "
         "on conflict (firm_id, kind, id) do update set client_id = excluded.client_id, data = excluded.data, deleted = excluded.deleted;" % (q(F), q(F))),
        ("records deleted flag PATCH", "update public.records set deleted = true, delete_reason = 'removed in the app' where firm_id = %s and kind = 'bill' and id = 'b2';" % q(F)),
        ("activity POST (id from activity_id_seq, user_id auth.uid())", "insert into public.activity (firm_id, what, detail) values (%s, 'signin', 'test');" % q(F)),
        ("a security definer function writing a table (tally_device_trial_tools)", "select public.tally_device_trial_tools(%s, true);" % q(D1)),
    ]
    for w, sql in app:
        r = as_role("authenticated", sql, OWNER)
        ok(r.returncode == 0, "6. authenticated: %s works %s" % (w, (r.stderr or "").strip()[-300:]))
    ok(db.one("select string_agg(id || ':' || deleted::text || ':' || name, ',' order by id) from clients") == "c1:false:Client One (merged),c2:true:Client Two"
       and db.one("select string_agg(id || ':' || deleted::text, ',' order by id) from records") == "b1:false,b2:true"
       and db.one("select count(*) from activity where user_id = %s and what = 'signin'" % q(OWNER)) == "1"
       and db.one("select trial_tools::text from tally_devices where id = %s" % q(D1)) == "true", "6. the rows are as the app wrote them")
    r = as_role("service_role", "update public.tally_devices set version = version where id = %s; update public.tally_jobs set status = status where false;" % q(D1))
    ok(r.returncode == 0, "6. service_role still writes (tally_devices, tally_jobs) %s" % (r.stderr or "").strip()[-300:])

    # 8. members and platform_secrets after 61: nothing the pages send is refused; the direct writes the policies allowed are
    secrets_reads("after 61")
    a = {"members self update": tried("authenticated", SELF, OWNER), "secrets insert (platform admin)": tried("authenticated", SEC_INS, ADMIN), "secrets update (platform admin)": tried("authenticated", SEC_UPD, ADMIN)}
    ok(all("permission denied" in v for v in a.values()), "8. after 61: the direct writes the policies allowed are refused: no page sends them (%s)" % a)
    r = as_role("authenticated", "select public.admin_set_secret('claude_api_key', 'sk-new'); select public.admin_set_secret('google_vision_key', 'gv-new');", ADMIN)
    ok(r.returncode == 0 and db.one("select string_agg(name || '=' || value || ':' || (set_by = %s)::text, ',' order by name) from platform_secrets" % q(ADMIN)) == "claude_api_key=sk-new:true,google_vision_key=gv-new:true",
       "8. Settings -> Platform -> Keys -> Save (POST rpc/admin_set_secret) as the platform administrator: saved %s" % (r.stderr or "").strip()[-200:])
    r = as_role("authenticated", "select public.admin_set_secret('claude_api_key', 'sk-x');", OWNER)
    ok(r.returncode != 0 and "not allowed" in r.stderr, "8. admin_set_secret refuses a firm's owner who is not a platform administrator")
    # the service role, as the admin edge function writes members (invite_person / add_person: upsert by user_id; set_person: update)
    r = as_role("service_role", """insert into public.members (user_id, firm_id, name, email, role, active) values (%(S)s, %(F)s, 'Chetan', 'c@b.in', 'readonly', true)
        on conflict (user_id) do update set firm_id = excluded.firm_id, name = excluded.name, email = excluded.email, role = excluded.role, active = excluded.active;
      insert into public.members (user_id, firm_id, name, email, role, active) values (%(S)s, %(F)s, 'Chetan', 'c@b.in', 'staff', true)
        on conflict (user_id) do update set firm_id = excluded.firm_id, name = excluded.name, email = excluded.email, role = excluded.role, active = excluded.active;
      update public.members set role = 'readonly' where user_id = %(S)s; update public.members set active = false where user_id = %(S)s;""" % {"S": q(STAFF), "F": q(F)})
    ok(r.returncode == 0 and db.one("select role || ':' || active::text from members where user_id = %s" % q(STAFF)) == "readonly:false",
       "8. Settings -> People: invite / add (the admin function's members upsert), the role and switch-off (its update) work as the service role %s" % (r.stderr or "").strip()[-200:])
    # 7. refused
    for role, sql, w in [("anon", "truncate public.clients;", "anon TRUNCATE clients"), ("anon", "truncate public.tally_vouchers;", "anon TRUNCATE tally_vouchers"),
                         ("anon", "insert into public.clients (firm_id, id) values (%s, 'x');" % q(F), "anon INSERT into clients"),
                         ("anon", "update public.firms set name = name;", "anon UPDATE firms"),
                         ("authenticated", "truncate public.records;", "authenticated TRUNCATE records"),
                         ("authenticated", "truncate public.platform_secrets;", "authenticated TRUNCATE platform_secrets"),
                         ("authenticated", "insert into public.tally_vouchers (book_id, firm_id, guid, day) values (%s, %s, 'x', '2026-05-01');" % (q("11111111-1111-1111-1111-111111111111"), q(F)), "authenticated INSERT into tally_vouchers"),
                         ("authenticated", "update public.members set name = name;", "authenticated UPDATE members (the app never writes it)")]:
        r = as_role(role, sql, OWNER)
        ok(r.returncode != 0 and "permission denied" in r.stderr, "7. refused: %s (%s)" % (w, (r.stderr or "").strip()[-120:]))
    r = as_role("authenticated", "do $$ begin execute 'dele' || 'te from public.clients where id = ''c2'''; end $$;", OWNER)
    ok(r.returncode != 0 and "permission denied" in r.stderr, "7. refused: authenticated DELETE on clients (%s)" % (r.stderr or "").strip()[-120:])
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
