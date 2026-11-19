"""python3 run_migration201a.py - server/tally-cloud/migration-201a-post-grants.sql (19-Nov-2026, branch next-fix-posttimeout).
Found while applying 199-202 on staging: Supabase's default privileges give anon and authenticated every privilege on a new
table of the public schema. 201 revokes insert, update, delete, truncate, references and trigger from authenticated on
tally_post_register_pending and grants it 11 columns; the table-level SELECT the default gave stayed, so a member read every
column of the firm's rows (the vouchers' XML, the maps). And PostgreSQL 17's MAINTAIN stayed on the new tables of 199-202.
On a throwaway PostgreSQL (post_queue_stand, port 31206 unless PG201A_PORT; never a real database) with Supabase's default
privileges set first, then 184, 185 as on staging, 199, 200, 201:
  0. the file: one transaction, lock_timeout 10 s, add-only (no drop, delete, truncate), refuses to run without 201
  1. before it (as staging is): a member may select every column of tally_post_register_pending
  2. after it: only the 11 columns of 201 (job_id, firm_id, since, cursor, total, dirty, passes, last_at, done_at, words,
     failed_at); a member of the firm reads them through row security, not vlist / maps / jsnap / queue / qcursor / rec /
     by_q; anon nothing; service_role all
  3. runs twice; again after 202 (its tables too); the other new tables' grants unchanged (MAINTAIN: PostgreSQL 17 only,
     a no-op on 16, read back on staging)
RED_WITHOUT_201A=1: the same checks without the file (fails)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, STAFF
RED = os.environ.get("RED_WITHOUT_201A") == "1"
P = os.path.join(PS.SQLDIR, "migration-201a-post-grants.sql")
M = [os.path.join(PS.SQLDIR, f) for f in ("migration-199-post-match-fast.sql", "migration-200-post-settle-itself.sql", "migration-201-post-register-async.sql")]
M202 = os.path.join(PS.SQLDIR, "migration-202-post-recheck.sql")
X = tuple(os.path.join(PS.SQLDIR, f) for f in ("migration-184-post-dupes.sql", "migration-185-post-unrouted.sql"))
COLS = ["job_id", "firm_id", "since", "cursor", "total", "dirty", "passes", "last_at", "done_at", "words", "failed_at"]
HIDDEN = ["vlist", "maps", "jsnap", "queue", "qcursor", "rec", "by_q"]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
text = open(P).read() if os.path.exists(P) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(P), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and "create table" not in code and "create or replace function" not in code, "add-only: grants only; nothing dropped, deleted, made or replaced")
ok("raise exception 'migration 201a runs after 201" in text, "never runs without 201")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|project[_ ]ref", text.lower()), "names no real database")

st = PS.Stand(int(os.environ.get("PG201A_PORT") or 31206), extra=X); db = st.db
priv = lambda role, col=None: db.one(("select has_column_privilege(%s, 'public.tally_post_register_pending', %s, 'select')::text" % (q(role), q(col))) if col
                                     else "select has_table_privilege(%s, 'public.tally_post_register_pending', 'select')::text" % q(role))
def tacl(t): return db.one("select coalesce(relacl::text, '') from pg_class where oid = to_regclass(%s)" % q("public." + t))
try:
    m182 = open(os.path.join(PS.SQLDIR, "migration-182-gap-after-post.sql")).read()
    t0_ = m182.index("create table if not exists public.tally_light_days ("); t1_ = m182.index(");", t0_) + 2
    f0_ = m182.index("create or replace function public.tally_post_job_read_back()"); f1_ = m182.index("end $$;", f0_) + len("end $$;")
    db.sql(m182[t0_:t1_] + "\n" + m182[f0_:f1_])
    r = st.psql_text(text)
    ok(r.returncode != 0 and "runs after 201" in (r.stderr or ""), "without 201 first: refused (%s)" % (r.stderr or "").strip()[-100:])
    # Supabase's default privileges for new tables of the public schema (as staging has them), then 199-201 as on staging
    db.sql("alter default privileges in schema public grant all on tables to anon, authenticated, service_role")
    r = st.psql_text("\n".join(open(p).read() for p in M)); ok(r.returncode == 0, "199, 200, 201 applied %s" % (r.stderr or "")[-200:])
    st.grants()
    print("== 1. before it (as staging is)")
    ok(priv("authenticated") == "true" and priv("authenticated", "vlist") == "true", "a member may select every column, vlist among them (as on staging)")
    other0 = {t: tacl(t) for t in ("tally_post_self_settle", "tally_post_register_wants", "tally_post_work_errors")}
    print("== 2. after it")
    if not RED:
        r = st.psql_text(text); ok(r.returncode == 0, "applied %s" % (r.stderr or "")[-200:])
    ok(priv("authenticated") == "false" and all(priv("authenticated", c) == "true" for c in COLS) and not any(priv("authenticated", c) == "true" for c in HIDDEN),
       "a member: the 11 columns only (%s)" % ",".join(c for c in HIDDEN if priv("authenticated", c) == "true"))
    ok(priv("anon") == "false" and not any(priv("anon", c) == "true" for c in COLS + HIDDEN), "anon: nothing")
    ok(priv("service_role") == "true" and all(priv("service_role", c) == "true" for c in COLS + HIDDEN), "service_role: everything")
    # a member of the firm reads the 11 columns of the firm's rows through row security; the others refused
    jid = "00000001-0000-0000-0000-00000000201a"
    db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload, created_by) values (%s, %s, 'c1', 'Made-up Heron Traders', 'failed', 0, '{}', %s)" % (q(jid), q(F), q(STAFF)))
    db.sql("insert into tally_post_register_pending (job_id, firm_id, vlist) values (%s, %s, '[[1, \"made-up\"]]') on conflict (job_id) do nothing" % (q(jid), q(F)))
    a = st.rpc(STAFF, "select coalesce(json_agg(json_build_object('job', job_id, 'words', words)), '[]')::text from tally_post_register_pending")
    b = st.rpc(STAFF, "select coalesce(json_agg(vlist), '[]')::text from tally_post_register_pending")
    ok(isinstance(a, list) and len(a) >= 1 and "permission denied" in str(b.get("_error", "")) if isinstance(b, dict) else False,
       "the firm's member reads the 11 columns (%s), not vlist (%s)" % (str(a)[:60], str(b)[:80]))
    print("== 3. runs twice; again after 202")
    if not RED:
        r = st.psql_text(text); ok(r.returncode == 0, "runs twice %s" % (r.stderr or "")[-200:])
    ok(all(tacl(t) == other0[t] for t in other0) or db.one("select (current_setting('server_version_num')::int >= 170000)::text") == "true",
       "the other new tables' grants unchanged on PostgreSQL 16 (%s)" % {t: tacl(t) for t in other0})
    r = st.psql_text(open(M202).read()); ok(r.returncode == 0, "202 applied %s" % (r.stderr or "")[-200:])
    if not RED:
        r = st.psql_text(text); ok(r.returncode == 0, "again after 202 %s" % (r.stderr or "")[-200:])
    ok(priv("authenticated") == "false" and priv("authenticated", "words") == "true" and priv("authenticated", "vlist") == "false", "after 202: still the 11 columns")
    ok(db.one("select has_table_privilege('authenticated', 'public.tally_post_rechecks', 'select')::text") == "true"
       and db.one("select has_table_privilege('authenticated', 'public.tally_post_recheck_plans', 'select')::text") == "false",
       "202's grants as 202 made them (the rechecks read by the firm; the plans by the service only)")
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
