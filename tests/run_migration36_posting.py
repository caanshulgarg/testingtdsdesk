"""python3 run_migration36_posting.py - migration-36-post-acceptance (03-Oct-2026, round 4, the real-books fault of the
day: the bridge reported a posting failed although Tally had replied CREATED with LASTVCHID 26298, and tally_post_ids_sync
then set the id live = false, so the same bill could be posted twice). On a throwaway PostgreSQL (pg_stand) with the
cloud tables as on staging (the schema of run_migration32.py, then migration-32 itself), then this file twice.
Checks: the file runs twice and deletes nothing; tally_post_ids gets accepted_at (set by tally-ingest when it sees an
acceptance) and confirmed_at / by / note / vch (the owner's mark); tally_post_ids_sync never frees an id with accepted_at
set, whatever the job's status becomes (failed, cancelled) — only tally_post_id_release (migration 37) may; an id without
an acceptance is freed as before; tally_post_job_mark_posted(job, id, vch, note) is owner-only (a staff member and an
owner of another firm are refused), marks the entry posted and verified in results and items with the voucher number,
keeps the id live with accepted_at and records who / when / note, and sets the job done only when every entry is posted;
nothing is deleted or re-sent."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M32, M36 = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-36-post-acceptance.sql")]
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def q(s): return "'" + str(s).replace("'", "''") + "'"
def part(path, name):
    s = open(path).read(); i = s.index(name + ' = """'); i = s.index('"""', i) + 3; return s[i:s.index('"""', i)]
SCHEMA32 = part(os.path.join(HERE, "run_migration32.py"), "SCHEMA")
F, F2 = "99999999-9999-9999-9999-999999999999", "88888888-8888-8888-8888-888888888888"
OWNER, STAFF, OTHER = "55555555-5555-5555-5555-555555555555", "44444444-4444-4444-4444-444444444444", "33333333-3333-3333-3333-333333333333"
B = "11111111-1111-1111-1111-111111111111"
J = lambda n: "%08d-0000-0000-0000-000000000000" % n
def vch(i): return {"id": i, "xml": "<VOUCHER><NARRATION>Bill | TDSDesk:%s</NARRATION></VOUCHER>" % i}
def job(jid, vs, status="running", firm=F):
    return "insert into tally_post_jobs (id, firm_id, client_id, company, payload, n, status) values (%s, %s, 'c1', 'ZZ CO', %s, %d, %s);" % (q(jid), q(firm), q(json.dumps({"vouchers": vs})), len(vs), q(status))

db = pg_stand.start(55447)
def psql_file(path):
    if not os.path.exists(path): return subprocess.CompletedProcess([], 1, "", "no such file: " + path)
    return subprocess.run(["runuser", "-u", "postgres", "--", pg_stand.BIN + "/psql", "-h", "127.0.0.1", "-p", str(db.port), "-U", "postgres", "-d", "postgres",
                           "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], input=open(path).read(), capture_output=True, text=True)
def as_user(uid, stmt):
    """runs stmt as a signed-in person (role authenticated, auth.uid() = uid); returns (ok, output or error)"""
    try: return True, db.one("set role authenticated; " + stmt, uid)
    except RuntimeError as e: return False, str(e)
live = lambda jid, fid: db.one("select live from tally_post_ids where job_id = %s and fincom_id = %s" % (q(jid), q(fid)))
col = lambda jid, fid, c: db.one("select %s from tally_post_ids where job_id = %s and fincom_id = %s" % (c, q(jid), q(fid)))
mark = lambda uid, jid, fid, vch_no="26298", note="Tally replied CREATED; seen in Tally": as_user(uid, "select tally_post_job_mark_posted(%s::uuid, %s, %s, %s)::text" % (q(jid), q(fid), q(vch_no), q(note)))
try:
    db.sql(SCHEMA32 + "grant usage on schema public, auth to authenticated, anon; grant select on members to authenticated;")
    db.sql("insert into firms values (%s, 'Firm'), (%s, 'Other') on conflict do nothing; insert into members values (%s, %s, 'Owner', 'owner', true), (%s, %s, 'Staff', 'staff', true), (%s, %s, 'Them', 'owner', true);"
           % (q(F), q(F2), q(OWNER), q(F), q(STAFF), q(F), q(OTHER), q(F2)))
    db.sql("insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, 'c1', 'ZZ CO', '2026-04-01', '2026-03-31');" % (q(B), q(F)))
    r = psql_file(M32); ok(r.returncode == 0, "migration-32 (as on staging) runs %s" % ((r.stderr or "").strip()[-300:] if r.returncode else ""))
    db.sql(job(J(1), [vch("A1"), vch("A2")]) + job(J(9), [vch("Z1")], firm=F2))
    counts = lambda: {t: db.one("select count(*) from %s" % t) for t in ["tally_post_jobs", "tally_post_ids", "tally_books", "members"]}
    before = counts()
    # 1. the file as the owner runs it (psql, stop at the first error), twice
    for i in (1, 2):
        r = psql_file(M36)
        ok(r.returncode == 0, "migration-36-post-acceptance runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if not os.path.exists(M36) or r.returncode: raise SystemExit("cannot go on without the migration")
    ok(counts() == before, "nothing deleted by the migration (%s)" % counts())
    body = open(M36).read().lower(); code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    ok(not any(w in code for w in ["drop table", "drop view", "drop function", "drop column", "delete from"]) and not re.search(r"truncate\s", code), "the file drops and deletes nothing")
    ok(code.strip().startswith("begin;") and code.strip().endswith("commit;"), "one transaction (begin; ... commit;)")
    cols = {r["column_name"] for r in db.rows("select column_name from information_schema.columns where table_name = 'tally_post_ids'")}
    ok({"accepted_at", "confirmed_at", "confirmed_by", "confirmed_note", "confirmed_vch"} <= cols, "tally_post_ids: accepted_at and the owner's confirmed_at / by / note / vch (%s)" % sorted(cols))

    # 2. an accepted id is never freed by the sync
    ok(live(J(1), "A1") == "t" and live(J(1), "A2") == "t", "both ids of the running posting live")
    db.sql("update tally_post_ids set accepted_at = now() where job_id = %s and fincom_id = 'A1'" % q(J(1)))     # what tally-ingest does on an acceptance
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(1)))
    ok(live(J(1), "A1") == "t" and live(J(1), "A2") == "f", "the posting reported failed: A1 (Tally accepted it) stays live, A2 is freed")
    try:
        db.sql(job(J(2), [vch("A1")])); ok(False, "A1 was queued again")
    except RuntimeError as e: ok("already being posted" in str(e), "A1 cannot be queued again (no duplicate in Tally)")
    db.sql(job(J(3), [vch("A2")]))
    ok(live(J(3), "A2") == "t", "A2, not accepted, may be queued again")
    db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(1)))
    ok(live(J(1), "A1") == "t", "cancelled in FinCom: A1 still live (only tally_post_id_release may free it)")
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(1)))

    # 3. the owner marks the entry posted
    good, out = mark(STAFF, J(1), "A1"); ok(not good and ("42501" in out or "only an owner" in out), "a staff member cannot mark an entry posted (%s)" % out[-80:])
    good, out = mark(OTHER, J(1), "A1"); ok(not good and ("your firm" in out or "not found" in out), "an owner of another firm cannot (%s)" % out[-80:])
    good, out = mark(OWNER, J(1), "no-such"); ok(not good and "not in this posting" in out, "an id that is not in the posting is refused (%s)" % out[-80:])
    good, out = mark(OWNER, J(1), "A1"); res = json.loads(out) if good else {}
    ok(good and res.get("ok") is True and res.get("posted") == 1 and res.get("of") == 2 and res.get("status") == "failed", "the owner marks A1 posted: 1 of 2, the posting not done yet (%s)" % out[-200:])
    j1 = db.rows("select status, checking, results::text as r, items::text as i, message from tally_post_jobs where id = %s" % q(J(1)))[0]
    R = {x["id"]: x for x in json.loads(j1["r"] or "[]")}; I = {x["id"]: x for x in json.loads(j1["i"] or "[]")}
    ok(R.get("A1", {}).get("ok") is True and R["A1"].get("verified") is True and R["A1"].get("vchNumber") == "26298" and R["A1"].get("state") == "in_tally", "results: A1 ok, verified, voucher 26298, in_tally (%s)" % R.get("A1"))
    ok(I.get("A1", {}).get("state") == "in_tally" and "A2" not in R, "items: A1 in_tally; A2 untouched (%s)" % I)
    ok(j1["status"] == "failed" and j1["checking"] == "f", "the posting stays as it was while A2 is not posted (%s)" % j1["status"])
    ok(live(J(1), "A1") == "t" and col(J(1), "A1", "confirmed_by") == OWNER and col(J(1), "A1", "confirmed_vch") == "26298" and col(J(1), "A1", "confirmed_note").startswith("Tally replied") and col(J(1), "A1", "confirmed_at") and col(J(1), "A1", "accepted_at"),
       "tally_post_ids: A1 live, who / when / note / voucher recorded, accepted_at kept")
    good, out = mark(OWNER, J(1), "a-2"); ok(not good, "an id is matched exactly in letters and digits: 'a-2' is not A2 (%s)" % out[-80:])
    good, out = mark(OWNER, J(1), "A2", "26299", "")
    ok(not good and "another posting" in out, "A2 is live in another posting: refused until that one is cancelled (%s)" % out[-120:])
    db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(3)))
    good, out = mark(OWNER, J(1), "A2", "26299", ""); res = json.loads(out) if good else {}
    ok(good and res.get("posted") == 2 and res.get("status") == "done" and db.one("select status from tally_post_jobs where id = %s" % q(J(1))) == "done", "every entry posted: the posting is done (%s)" % out[-200:])
    ok(live(J(1), "A2") == "t" and col(J(1), "A2", "accepted_at") and col(J(1), "A2", "confirmed_vch") == "26299", "A2 live with accepted_at, voucher 26299")
    good, out = mark(OWNER, J(1), "A1"); ok(good, "marking again does no harm (%s)" % out[-100:])
    ok(all(int(counts()[t]) >= int(before[t]) for t in before) and db.one("select count(*) from tally_post_ids where job_id = %s" % q(J(1))) == "2", "nothing deleted: the test added a posting, no row went (%s)" % counts())
    fn = db.one("select pg_get_functiondef('tally_post_job_mark_posted'::regproc)")
    ok("SECURITY DEFINER" in fn and "search_path" in fn and "pg_temp" in fn, "the function is security definer with search_path = public, pg_temp")
    ok(db.one("select has_function_privilege('anon', 'tally_post_job_mark_posted(uuid, text, text, text)', 'execute')") == "f", "anon cannot call it")
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
