"""python3 run_migration76.py - migration-76-db-speed (13-Oct-2026, branch db-speed; the owner's "Database speed up" of
13-Oct-2026). On throwaway PostgreSQL (pg_stand, port 30776; never a real database): the cloud migrations in a fresh
database's order (run_migration_order.py's, 32 ... 74), the platform tables as staging has them (PLATFORM below: plans,
modules, firm_modules, drop_keys, firms.plan_id, tally_companies.device_id, activity, the members policies, each policy text
as read from staging's pg_policies on 13-Oct-2026), rows of two firms, then 76 three times. Checks:
  0. the file: one transaction (begin; set local lock_timeout = '10s'; ... commit;), no 'delete from', no truncate, nothing
     dropped but the six policies it makes again (drop policy if exists), no CONCURRENTLY, no real database named; runs
     three times; no row removed.
  1. an index on each of the 16 foreign keys (<table>_<col>_idx, its only column); 75's two Zoho ones only where 75's
     tables are (first without them: none made, no error; then 75's
     two tables are made and a fourth run makes the two).
  2. the six policies: the same table, command, role, permissive; qual and with_check equal to the text before with each
     auth.uid() as (select auth.uid()), and no bare auth.uid() left; and what each user reads and writes is the SAME
     before and after 76: a firm-A owner, a firm-A staff member and a firm-B owner, every read counted (all rows, firm A's
     rows, firm B's rows) and every write tried (each in a transaction rolled back), both with the stand's own grants and
     with every table right granted to authenticated (so the policy alone decides); the firm-B owner sees none of firm A's
     rows and writes none.
  3. tally_lines and tally_bills: an `id` identity column (generated always) and the primary key on it; the rows there
     before keep their values and get ids; the entry path (tally_ingest_entries, which names its columns) still writes
     lines and bills, with new ids; a second and third run add nothing; the identity sequences are not anon's or
     authenticated's.
  4. no index dropped (the count of indexes only grows).
RED: before the file exists it stops at the first check."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand, members_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M76 = os.environ.get("M76_FILE") or os.path.join(SQLDIR, "migration-76-db-speed.sql")
PORT = 30776
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def js(o): return q(json.dumps(o)) + "::jsonb"
FA, FB = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
A_OWNER, A_STAFF, B_OWNER = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "66666666-6666-6666-6666-666666666666"
BOOK = "11111111-1111-1111-1111-111111111111"
FKS = [("drop_keys", "firm_id"), ("firm_modules", "code"), ("firms", "plan_id"), ("tally_alerts", "book_id"), ("tally_bridge_alerts", "device_id"),
       ("tally_bridge_alerts", "firm_id"), ("tally_bridge_ids", "device_id"), ("tally_bridge_prefs", "firm_id"), ("tally_bridge_release_log", "firm_id"),
       ("tally_companies", "device_id"), ("tally_company_lease", "firm_id"), ("tally_member_bridges", "device_id"), ("tally_post_checks", "firm_id"),
       ("tally_post_marks", "firm_id"), ("tally_sync_cursor", "firm_id"), ("tally_tieouts", "book_id")]
# the six policies as staging's pg_policies printed them on 13-Oct-2026 (before 76): (table, cmd, qual, with_check)
BEFORE = {"members_self": ("members", "UPDATE", "(user_id = auth.uid())", "((user_id = auth.uid()) AND (firm_id = my_firm()))"),
          "members_read": ("members", "SELECT", "((user_id = auth.uid()) OR (firm_id = my_firm()) OR is_superadmin())", None),
          "activity_write": ("activity", "INSERT", None, "((firm_id = my_firm()) AND (user_id = auth.uid()))"),
          "tally_post_row_flags_read": ("tally_post_row_flags", "SELECT", "((firm_id = my_firm()) AND ((kind = 'remove'::text) OR (user_id = auth.uid())))", None),
          "app_alert_dismissals_read_own": ("app_alert_dismissals", "SELECT", "((user_id = auth.uid()) AND (firm_id = my_firm()))", None),
          "app_alert_dismissals_add_own": ("app_alert_dismissals", "INSERT", None, "((user_id = auth.uid()) AND (firm_id = my_firm()) AND (undone_at IS NULL))")}
WRAP = lambda s: None if s is None else s.replace("auth.uid()", "( SELECT auth.uid() AS uid)")
# the platform tables 76 indexes or whose policies it makes again, as on staging (13-Oct-2026), beyond what the cloud
# migrations make; also read by run_migration_order.py (which runs 76 last in both orders)
PLATFORM = r"""
create table if not exists public.plans (id uuid primary key default gen_random_uuid(), name text not null, monthly_fee numeric(12,2) not null default 0,
  includes jsonb not null default '{}'::jsonb, note text not null default '', active boolean not null default true, created_at timestamptz not null default now());
alter table public.firms add column if not exists plan_id uuid references public.plans (id);
create table if not exists public.modules (code text primary key, title text not null, unit text not null, price numeric(10,2) not null default 0,
  billing text not null default 'per_unit', active boolean not null default true, sort integer not null default 0);
create table if not exists public.firm_modules (firm_id uuid not null references public.firms (id), code text not null references public.modules (code),
  enabled boolean not null default true, price numeric(10,2), primary key (firm_id, code));
create table if not exists public.drop_keys (id uuid primary key default gen_random_uuid(), firm_id uuid not null references public.firms (id),
  label text not null default 'Agent', key_hash text not null, key_hint text not null, active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid, last_used timestamptz, uses integer not null default 0);
create table if not exists public.tally_companies (firm_id uuid not null references public.firms (id) on delete cascade, company text not null, client_id text, gstin text,
  device_id uuid references public.tally_devices (id) on delete set null, first_seen timestamptz not null default now(), last_seen timestamptz, linked_at timestamptz,
  linked_by uuid, book_id uuid not null unique default gen_random_uuid(), primary key (firm_id, company));
alter table public.tally_companies add column if not exists device_id uuid references public.tally_devices (id) on delete set null;
create table if not exists public.activity (id bigserial primary key, firm_id uuid not null, user_id uuid default auth.uid(), client_id text not null default '',
  what text not null, detail text not null default '', at timestamptz not null default now());
alter table public.activity enable row level security;
alter table public.members enable row level security;
do $p$ begin
  if not exists (select 1 from pg_policies where tablename = 'activity' and policyname = 'activity_write') then
    create policy activity_write on public.activity for insert to authenticated with check (((firm_id = my_firm()) and (user_id = auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'members' and policyname = 'members_read') then
    create policy members_read on public.members for select to authenticated using (((user_id = auth.uid()) or (firm_id = my_firm()) or is_superadmin()));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'members' and policyname = 'members_self') then
    create policy members_self on public.members for update to authenticated using ((user_id = auth.uid())) with check (((user_id = auth.uid()) and (firm_id = my_firm())));
  end if;
end $p$;
"""

text = open(M76).read() if os.path.exists(M76) else ""
ok(bool(text), "the migration file is there (%s)" % os.path.basename(M76))
if not text:
    print("\nFAILED: %d" % len(fails)); raise SystemExit(1)
low = text.lower()
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;"), "0. begin; set local lock_timeout = '10s'; ... commit; (one transaction)")
ok(low.count("delete from") == 0 and not re.search(r"\btruncate\b", low), "0. no 'delete from', no truncate")
drops = re.findall(r"^\s*drop\s+(\w+)(?:\s+if exists)?\s+(\w+)", low, re.M)
ok(sorted(n for k, n in drops if k == "policy") == sorted(BEFORE) and all(k == "policy" for k, n in drops) and len(re.findall(r"\bdrop\b", re.sub(r"--[^\n]*", "", low))) == 6,
   "0. nothing dropped but the six policies made again (%s)" % drops)
ok("concurrently" not in re.sub(r"--[^\n]*", "", low), "0. no CONCURRENTLY (inside a transaction)")
ok(not re.search(r"supabase\.co|\.supabase\.|project[_ ]ref|qbocsk", low), "0. names no real database")

src = open(os.path.join(HERE, "run_migration_order.py")).read(); ns = {"__file__": os.path.join(HERE, "run_migration_order.py")}
exec(src[:src.index("\ndef run_order")], ns)        # its ORDERS and its stand schema (SCHEMA33, ...), without running it
db = pg_stand.start(PORT)
def psql(sql, quiet=True):
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(PORT), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A", "-f", "-"], input=sql, capture_output=True, text=True)
def try_as(uid, stmt, grant_all):
    """stmt run as authenticated with auth.uid() = uid, in a transaction rolled back; 'ok:<last line>' or 'err:<sqlstate-ish words>'"""
    g = "grant all on public.members, public.activity, public.app_alert_dismissals, public.tally_post_row_flags to authenticated; grant usage on all sequences in schema public to authenticated;\n" if grant_all else ""
    r = psql("begin;\n%sset local fincom.uid = '%s'; set local role authenticated;\n%s\nrollback;\n" % (g, uid, stmt))
    if r.returncode:
        e = r.stderr.strip().splitlines()[0] if r.stderr.strip() else "?"
        return "err:" + re.sub(r"^.*?ERROR:\s*", "", e)[:90]
    out = [l for l in r.stdout.strip().splitlines() if l.strip()]
    return "ok:" + (out[-1] if out else "")
def cnt(sql): return "select count(*) from (%s) x;" % sql
def ins_ret(sql): return "with i as (%s returning 1) select count(*) from i;" % sql
def upd(sql): return "with u as (%s returning 1) select count(*) from u;" % sql
def cases():
    """every read and write the six policies decide, for one user (the same list before and after 76)"""
    c = {}
    for t in ("members", "app_alert_dismissals", "tally_post_row_flags"):
        c["read %s all" % t] = cnt("select 1 from public.%s" % t)
        c["read %s firm A" % t] = cnt("select 1 from public.%s where firm_id = %s" % (t, q(FA)))
        c["read %s firm B" % t] = cnt("select 1 from public.%s where firm_id = %s" % (t, q(FB)))
    c["read tally_post_row_flags kinds"] = "select coalesce(string_agg(kind || '/' || row_key, ',' order by row_key, kind), '-') from public.tally_post_row_flags;"
    c["update own member row (name)"] = upd("update public.members set name = name || '!' where user_id = auth.uid()")
    c["update own row into another firm"] = upd("update public.members set firm_id = case when firm_id = %s then %s::uuid else %s::uuid end where user_id = auth.uid()" % (q(FA), q(FB), q(FA)))
    c["update another member's row"] = upd("update public.members set name = 'x' where user_id <> auth.uid()")
    c["update every member row"] = upd("update public.members set name = name")
    for f, fl in ((FA, "A"), (FB, "B")):
        c["activity insert firm %s, own user" % fl] = ins_ret("insert into public.activity (firm_id, user_id, what) values (%s, auth.uid(), 't')" % q(f))
        c["activity insert firm %s, another user" % fl] = ins_ret("insert into public.activity (firm_id, user_id, what) values (%s, %s, 't')" % (q(f), q(A_STAFF)))
        c["activity insert firm %s, user default" % fl] = ins_ret("insert into public.activity (firm_id, what) values (%s, 't')" % q(f))
        c["dismissal insert firm %s, own" % fl] = ins_ret("insert into public.app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, batch) values (%s, auth.uid(), 'k', 'f', gen_random_uuid())" % q(f))
        c["dismissal insert firm %s, another user" % fl] = ins_ret("insert into public.app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, batch) values (%s, %s, 'k', 'f', gen_random_uuid())" % (q(f), q(A_OWNER)))
        c["dismissal insert firm %s, undone" % fl] = ins_ret("insert into public.app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, batch, undone_at) values (%s, auth.uid(), 'k', 'f', gen_random_uuid(), now())" % q(f))
    c["row flag insert (no insert policy)"] = ins_ret("insert into public.tally_post_row_flags (firm_id, row_key, kind, user_id) values (%s, 'zz-new', 'hide', auth.uid())" % q(FA))
    return c
def run_all():
    out = {}
    for who, uid in (("A owner", A_OWNER), ("A staff", A_STAFF), ("B owner", B_OWNER)):
        for grant_all in (False, True):
            for name, stmt in cases().items():
                out["%s | %s | %s" % (who, "all rights" if grant_all else "stand rights", name)] = try_as(uid, stmt, grant_all)
    return out
def policies():
    return {r["policyname"]: (r["tablename"], r["cmd"], r["roles"], r["permissive"], r["qual"] or None, r["with_check"] or None)
            for r in db.rows("select tablename, policyname, cmd, roles::text as roles, permissive, qual, with_check from pg_policies where schemaname = 'public' and policyname in (%s)" % ",".join(q(p) for p in BEFORE))}
try:
    for s in ("SCHEMA33", "SCHEMA35", "BILLS", "SCHEMA37", "SCHEMA47"): db.sql(ns[s])
    for n, f in ns["ORDERS"]["fresh"]:
        r = psql(open(os.path.normpath(os.path.join(SQLDIR, f))).read())
        if r.returncode: ok(False, "setup: migration-%s runs %s" % (n, r.stderr[-300:])); raise SystemExit("cannot go on")
    db.sql(PLATFORM)
    # staging's helper bodies (security definer my_firm / is_superadmin, as members_stand.py has them): the stand's plain
    # my_firm() would recurse through members_read
    db.sql("create table if not exists public.platform_admins (user_id uuid primary key);" + members_stand.HELPERS)
    db.sql("""insert into firms (id, name) values (%(FA)s, 'Firm A'), (%(FB)s, 'Firm B') on conflict do nothing;
      insert into members (user_id, firm_id, name, role, active) values (%(AO)s, %(FA)s, 'A owner', 'owner', true), (%(AS)s, %(FA)s, 'A staff', 'staff', true), (%(BO)s, %(FB)s, 'B owner', 'owner', true);
      insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%(BK)s, %(FA)s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');
      insert into app_alert_dismissals (firm_id, user_id, alert_key, fingerprint, batch) values
        (%(FA)s, %(AO)s, 'a1', 'f', gen_random_uuid()), (%(FA)s, %(AO)s, 'a2', 'f', gen_random_uuid()), (%(FA)s, %(AS)s, 'a3', 'f', gen_random_uuid()), (%(FB)s, %(BO)s, 'b1', 'f', gen_random_uuid());
      insert into tally_post_row_flags (firm_id, row_key, kind, user_id) values
        (%(FA)s, 'ra-hide-owner', 'hide', %(AO)s), (%(FA)s, 'ra-hide-staff', 'hide', %(AS)s), (%(FA)s, 'ra-remove', 'remove', %(AS)s), (%(FB)s, 'rb-hide', 'hide', %(BO)s), (%(FB)s, 'rb-remove', 'remove', %(BO)s);
      insert into activity (firm_id, user_id, what) values (%(FA)s, %(AO)s, 'seed'), (%(FB)s, %(BO)s, 'seed');
      grant usage on schema public, auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;
      grant select on members, firms to authenticated;""" % {"FA": q(FA), "FB": q(FB), "AO": q(A_OWNER), "AS": q(A_STAFF), "BO": q(B_OWNER), "BK": q(BOOK)})
    ent = lambda g, day, amt: ({"guid": g, "alter": 1, "type": "Sales", "no": g.upper(), "party": "", "narr": "", "cancel": False, "opt": False, "gstin": "", "pos": "", "ref": "", "refDate": "", "cmp": "", "fid": None, "day": day},
                               [[g, "Sales", amt, "998311", 18, [["INV-" + g, "New Ref", amt, "30"]]], [g, "Cash", -amt, "", None, []]])
    def ingest(*es):
        return json.loads(db.one("select tally_ingest_entries(%s, %s, %s, true, false)::text" % (q(BOOK), js([e[0] for e in es]), js([l for e in es for l in e[1]]))))
    r0 = ingest(ent("e1", "2026-05-01", 100), ent("e2", "2026-05-02", 200))
    ok(r0.get("ok", True) is not False and db.one("select count(*) from tally_lines") == "4" and db.one("select count(*) from tally_bills") == "2", "setup: the entry path writes lines and bills before 76 (%s)" % str(r0)[:120])
    pol0 = policies()
    ok(all(pol0.get(p) == (t, c, "{authenticated}", "PERMISSIVE", qu, wc) for p, (t, c, qu, wc) in BEFORE.items()), "setup: the six policies as on staging before 76 (%s)" % [p for p in BEFORE if pol0.get(p) != (BEFORE[p][0], BEFORE[p][1], "{authenticated}", "PERMISSIVE", BEFORE[p][2], BEFORE[p][3])])
    before = run_all()
    ok(before["B owner | all rights | read members firm A"] == "ok:0" and before["A owner | all rights | read members firm A"] == "ok:2", "setup: the cases run (firm A owner sees 2 of firm A's members, firm B's owner none)")
    lines0 = db.rows("select book_id, firm_id, guid, day, ledger, amount, hsn, rate from tally_lines order by guid, ledger")
    bills0 = db.rows("select book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due from tally_bills order by guid, ledger")
    tabs = "select relname::text as t from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace"
    counts = lambda: {r["t"]: db.one("select count(*) from public.%s" % r["t"]) for r in db.rows(tabs)}
    n_rows0, n_idx0 = counts(), int(db.one("select count(*) from pg_indexes where schemaname = 'public'"))
    for rnd in (1, 2, 3):
        r = psql(text)
        ok(r.returncode == 0, "0. pass %d: migration 76 runs %s" % (rnd, (r.stderr or "").strip()[-400:] if r.returncode else ""))
        if r.returncode: raise SystemExit("cannot go on")
        if rnd == 1: ids1 = db.rows("select guid, ledger, id from tally_lines order by id")
    n_rows1 = counts()
    ok(n_rows1 == n_rows0, "0. no row removed or added by 76 (%d tables, %d rows)" % (len(n_rows0), sum(int(v) for v in n_rows0.values())))
    # 1. the indexes
    idx = {(r["t"], r["c"]): r["i"] for r in db.rows("""select t.relname::text as t, a.attname::text as c, i.relname::text as i from pg_index x join pg_class i on i.oid = x.indexrelid join pg_class t on t.oid = x.indrelid
                                                          join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0] where x.indnatts = 1 and t.relnamespace = 'public'::regnamespace""")}
    miss = [(t, c) for t, c in FKS if idx.get((t, c)) != "%s_%s_idx" % (t, c)]
    ok(not miss, "1. the 16 foreign keys each have their index <table>_<col>_idx (%s)" % (miss or "all 16"))
    fk_unindexed = db.rows("""select c.conrelid::regclass::text as t, c.conname as n from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and c.conrelid::regclass::text in (%s) and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)""" % ",".join(q(t) for t in sorted({t for t, c in FKS})))
    ok(not fk_unindexed, "1. no foreign key on those tables left without a covering index (%s)" % fk_unindexed)
    ok(db.one("select count(*) from pg_class where relname in ('zoho_connections_grant_id_idx', 'zoho_post_jobs_connection_id_idx')") == "0", "1. without 75's tables, the two Zoho indexes are not made (and 76 runs)")
    ok(int(db.one("select count(*) from pg_indexes where schemaname = 'public'")) == n_idx0 + 16 + 2, "4. no index dropped: %d before, %d after (16 indexes and 2 primary keys added)" % (n_idx0, int(db.one("select count(*) from pg_indexes where schemaname = 'public'"))))
    # 2. the policies
    pol1 = policies()
    for p, (t, c, qu, wc) in BEFORE.items():
        want = (t, c, "{authenticated}", "PERMISSIVE", WRAP(qu), WRAP(wc))
        bare = re.sub(r"\( SELECT auth\.uid\(\) AS uid\)", "", (pol1[p][4] or "") + (pol1[p][5] or ""))
        ok(pol1.get(p) == want and "auth.uid()" not in bare, "2. %s: same table, command, role, permissive; qual %r, with_check %r" % (p, pol1.get(p, [None] * 6)[4], pol1.get(p, [None] * 6)[5]))
    after = run_all()
    diff = [(k, before[k], after[k]) for k in before if before[k] != after[k]]
    ok(not diff and len(before) == len(after), "2. every read and write the same before and after 76: %d cases (3 users x 2 sets of rights x %d) %s" % (len(before), len(cases()), diff[:5]))
    nob = {k: v for k, v in after.items() if k.startswith("B owner") and ("firm A" in k)}
    ok(all(v == "ok:0" for k, v in nob.items() if k.split(" | ")[2].startswith("read")) and all(v.startswith("err:") for k, v in nob.items() if "insert" in k),
       "2. firm B's owner reads none of firm A's rows and writes none into firm A (%s)" % {k.split(" | ", 1)[1]: v for k, v in nob.items()})
    ok(after["B owner | all rights | read tally_post_row_flags kinds"] == "ok:hide/rb-hide,remove/rb-remove" and after["A staff | all rights | read tally_post_row_flags kinds"] == "ok:hide/ra-hide-staff,remove/ra-remove"
       and after["A owner | all rights | update own row into another firm"].startswith("err:") and after["A owner | all rights | update another member's row"] == "ok:0"
       and after["A staff | all rights | dismissal insert firm A, own"] == "ok:1" and after["A staff | all rights | dismissal insert firm A, undone"].startswith("err:")
       and after["A owner | all rights | activity insert firm A, own user"] == "ok:1" and after["A owner | all rights | activity insert firm A, another user"].startswith("err:"),
       "2. spot checks after 76: own hides and the firm's removes; no move to another firm; another's row untouched; own dismissal yes, undone no; activity as oneself only")
    # 3. the primary keys
    for t in ("tally_lines", "tally_bills"):
        pk = db.rows("""select c.conname as n, a.attname as col, a.attidentity as ident, format_type(a.atttypid, a.atttypmod) as typ from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
                        where c.conrelid = 'public.%s'::regclass and c.contype = 'p' and array_length(c.conkey, 1) = 1""" % t)
        ok(pk == [{"n": t + "_pkey", "col": "id", "ident": "a", "typ": "bigint"}], "3. %s: primary key %s_pkey on id bigint generated always as identity (%s)" % (t, t, pk))
        ok(db.one("select count(*) from information_schema.columns where table_name = %s and column_name = 'id'" % q(t)) == "1" and db.one("select count(*) from %s where id is null" % t) == "0", "3. %s: one id column, every row has one" % t)
        seq = t + "_id_seq"
        ok(all(db.one("select has_sequence_privilege(%s, %s, %s)::text" % (q(role), q("public." + seq), q(p))) == "false" for role in ("anon", "authenticated") for p in ("USAGE", "SELECT", "UPDATE")),
           "3. %s: not anon's or authenticated's" % seq)
    ok(db.rows("select book_id, firm_id, guid, day, ledger, amount, hsn, rate from tally_lines order by guid, ledger") == lines0 and db.rows("select book_id, firm_id, guid, day, ledger, name, type, amount, bill_date, credit_days, due from tally_bills order by guid, ledger") == bills0,
       "3. the rows there before keep every value")
    ok(db.rows("select guid, ledger, id from tally_lines order by id") == ids1, "3. the second and third runs change no id (%s)" % [r["id"] for r in ids1])
    r1 = ingest(ent("e3", "2026-05-03", 300), ent("e1", "2026-05-01", 150))
    ok(r1.get("ok", True) is not False and db.one("select count(*) from tally_lines") == "6" and db.one("select count(*) from tally_bills") == "3"
       and db.one("select string_agg(amount::text, ',' order by guid, ledger) from tally_lines where ledger = 'Sales'") == "150,200,300"
       and int(db.one("select min(id) from tally_lines where guid in ('e1', 'e3')")) > max(int(x["id"]) for x in ids1)
       and db.one("select string_agg(name || ':' || amount || ':' || coalesce(due::text, '-'), ',' order by name) from tally_bills") == "INV-e1:150:2026-05-31,INV-e2:200:2026-06-01,INV-e3:300:2026-06-02",
       "3. after 76 the entry path (tally_ingest_entries) re-sends e1 and adds e3: lines and bills written with new ids, e2 kept (%s)" % db.one("select string_agg(guid || ':' || ledger || ':' || amount || ':' || id, ',' order by id) from tally_lines"))
    # 1b. where 75 has run: its two tables (the foreign-key columns as 75 makes them), then 76 again makes their indexes
    db.sql("""create table if not exists public.zoho_grants (id uuid primary key default gen_random_uuid());
      create table if not exists public.zoho_connections (id uuid primary key default gen_random_uuid(), firm_id uuid, grant_id uuid references public.zoho_grants (id));
      create table if not exists public.zoho_post_jobs (id uuid primary key default gen_random_uuid(), firm_id uuid, connection_id uuid references public.zoho_connections (id));""")
    r = psql(text)
    zi = {x["i"]: x["d"] for x in db.rows("select indexname as i, indexdef as d from pg_indexes where indexname in ('zoho_connections_grant_id_idx', 'zoho_post_jobs_connection_id_idx')")}
    ok(r.returncode == 0 and len(zi) == 2 and "(grant_id)" in zi.get("zoho_connections_grant_id_idx", "") and "(connection_id)" in zi.get("zoho_post_jobs_connection_id_idx", ""),
       "1b. with 75's tables, a fourth run makes the two Zoho indexes (%s)" % (zi or r.stderr[-200:]))
    r = psql("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values (%s, %s, 'x', '2026-05-01', 'Cash', 1) returning id;" % (q(BOOK), q(FA)))
    ok(r.returncode == 0 and r.stdout.strip().isdigit(), "3. an insert that names its columns gets an id (%s)" % (r.stdout.strip() or r.stderr.strip()[-120:]))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
