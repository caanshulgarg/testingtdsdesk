"""python3 run_migration36b.py - migration-36b-post-acceptance (03-Oct-2026, round 4, the real-books fault of the
day: the bridge reported a posting failed although Tally had replied CREATED with LASTVCHID 26298, and tally_post_ids_sync
then set the id live = false, so the same bill could be posted twice). On a throwaway PostgreSQL (pg_stand) with the
cloud tables as on staging (the schema of run_migration32.py, then migration-32 itself), then this file twice.
Checks: the file runs twice and deletes nothing; tally_post_ids gets accepted_at and accepted_vch, set through
tally_post_id_accept(job, id, vch) (service role only; tally-ingest calls it when it sees an acceptance); tally_post_ids_sync
never frees an id with accepted_at set, whatever the job's status becomes (failed, cancelled) — only tally_post_id_release
(migration 37) may; an id without an acceptance is freed as before; tally_post_job_mark_posted(job, id, vch, note) is
owner-only (a staff member and an owner of another firm are refused), marks the entry posted and verified in results and
items with the voucher number, keeps the id live with accepted_at, records who / when / note / voucher in the append-only
tally_post_marks, and sets the job done only when every entry is posted; nothing is deleted or re-sent.
Round 5 (03-Oct, the review of round 4): ids with '.' and '-' matched in letters and digits (S4); the owner's
tally_post_id_release_owner(job, id, why) frees a pinned id with a reason (a 'released' mark; accepted_at kept as history; the
sync never revives it); a stamp (accept, mark_posted) clears a release (S2)."""
import os, re, sys, json, subprocess
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
M32, M36 = [os.path.join(SQLDIR, f) for f in ("migration-32-sync-safety.sql", "migration-36b-post-acceptance.sql")]
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
        ok(r.returncode == 0, "migration-36b-post-acceptance runs (%d) %s" % (i, (r.stderr or "").strip()[-600:] if r.returncode else ""))
    if not os.path.exists(M36) or r.returncode: raise SystemExit("cannot go on without the migration")
    ok(counts() == before, "nothing deleted by the migration (%s)" % counts())
    body = open(M36).read().lower(); code = " ".join(l for l in body.split("\n") if not l.strip().startswith("--"))
    ok(not any(w in code for w in ["drop table", "drop view", "drop function", "drop column", "delete from"]) and not re.search(r"truncate\s+(table\s+)?(public\.)?tally_", code), "the file drops and deletes nothing")
    ok(code.strip().startswith("begin;") and code.strip().endswith("commit;"), "one transaction (begin; ... commit;)")
    cols = {r["column_name"] for r in db.rows("select column_name from information_schema.columns where table_name = 'tally_post_ids'")}
    ok({"accepted_at", "accepted_vch"} <= cols, "tally_post_ids: accepted_at and accepted_vch (%s)" % sorted(cols))
    ok(db.one("select count(*) from information_schema.tables where table_name = 'tally_post_marks'") == "1", "tally_post_marks exists")

    # 2. an accepted id is never freed by the sync
    ok(live(J(1), "A1") == "t" and live(J(1), "A2") == "t", "both ids of the running posting live")
    good, out = as_user(STAFF, "select tally_post_id_accept(%s::uuid, 'A1', '26298')::text" % q(J(1)))
    ok(not good and ("42501" in out or "service role" in out or "permission denied" in out), "tally_post_id_accept is the service role's, not a person's (%s)" % out[-80:])
    acc = json.loads(db.one("select tally_post_id_accept(%s::uuid, 'A-1', '26298')::text" % q(J(1))))     # what tally-ingest does on an acceptance (the id in letters and digits, as stamped)
    ok(acc.get("ok") is True and acc.get("stamped") == 1 and col(J(1), "A1", "accepted_vch") == "26298" and col(J(1), "A1", "accepted_at"), "tally_post_id_accept stamps accepted_at and the voucher (%s)" % acc)
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
    mk = db.rows("select entry_id, action, vch, note, by_user, at from tally_post_marks where job_id = %s order by id" % q(J(1)))
    ok(live(J(1), "A1") == "t" and col(J(1), "A1", "accepted_at") and len(mk) == 1 and mk[0]["entry_id"] == "A1" and mk[0]["action"] == "posted" and mk[0]["vch"] == "26298" and mk[0]["by_user"] == OWNER and mk[0]["note"].startswith("Tally replied") and mk[0]["at"],
       "tally_post_ids: A1 live with accepted_at; tally_post_marks: who / when / note / voucher (%s)" % mk)
    good, out = as_user(OWNER, "update tally_post_marks set note = 'x'"); good2, out2 = as_user(OWNER, "delete from tally_post_marks")
    ok(not good and not good2 and db.one("select count(*) from tally_post_marks") == "1", "the marks are append-only: a person can neither change nor delete one")
    good, out = mark(OWNER, J(1), "a-2"); ok(not good, "an id is matched exactly in letters and digits: 'a-2' is not A2 (%s)" % out[-80:])
    good, out = mark(OWNER, J(1), "A2", "26299", "")
    ok(not good and "another posting" in out, "A2 is live in another posting: refused until that one is cancelled (%s)" % out[-120:])
    db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(3)))
    good, out = mark(OWNER, J(1), "A2", "26299", ""); res = json.loads(out) if good else {}
    ok(good and res.get("posted") == 2 and res.get("status") == "done" and db.one("select status from tally_post_jobs where id = %s" % q(J(1))) == "done", "every entry posted: the posting is done (%s)" % out[-200:])
    ok(live(J(1), "A2") == "t" and col(J(1), "A2", "accepted_at") and col(J(1), "A2", "accepted_vch") == "26299" and db.one("select count(*) from tally_post_marks") == "2", "A2 live with accepted_at, voucher 26299, a second mark")
    good, out = mark(OWNER, J(1), "A1"); ok(good and db.one("select count(*) from tally_post_marks") == "3", "marking again does no harm; a third mark is appended (%s)" % out[-100:])
    ok(all(int(counts()[t]) >= int(before[t]) for t in before) and db.one("select count(*) from tally_post_ids where job_id = %s" % q(J(1))) == "2", "nothing deleted: the test added a posting, no row went (%s)" % counts())
    fn = db.one("select pg_get_functiondef('tally_post_job_mark_posted'::regproc)")
    ok("SECURITY DEFINER" in fn and "search_path" in fn and "pg_temp" in fn, "the function is security definer with search_path = public, pg_temp")
    ok(db.one("select has_function_privilege('anon', 'tally_post_job_mark_posted(uuid, text, text, text)', 'execute')") == "f", "anon cannot call it")
    ok(db.one("select has_function_privilege('authenticated', 'tally_post_id_accept(uuid, text, text)', 'execute')") == "f", "a signed-in person cannot call tally_post_id_accept")

    # 4. round 5 (S4): an id with '.' and '-' in it. The narration tag keeps them (tally_fincom_id: INV-2026.07), the bridge
    # stamps the id in letters and digits (INV202607): accept, release and the owner's mark match either spelling, or the
    # entry's own id, never a different id
    rel = lambda uid, jid, fid, why="not in Tally after a look": as_user(uid, "select tally_post_id_release_owner(%s::uuid, %s, %s)::text" % (q(jid), q(fid), q(why)))
    db.sql(job(J(4), [vch("INV-2026.07"), vch("B-2"), vch("C3")]))
    ok(db.one("select fincom_id from tally_post_ids where job_id = %s and entry_id = 'INV-2026.07'" % q(J(4))) == "INV-2026.07", "the tag keeps '.' and '-' in the FinCom id (INV-2026.07)")
    acc = json.loads(db.one("select tally_post_id_accept(%s::uuid, 'INV202607', '26301')::text" % q(J(4))))
    ok(acc.get("stamped") == 1 and col(J(4), "INV-2026.07", "accepted_vch") == "26301", "S4. tally_post_id_accept('INV202607') stamps the row whose id is INV-2026.07 (%s)" % acc)
    acc = json.loads(db.one("select tally_post_id_accept(%s::uuid, 'inv202607', '1')::text" % q(J(4))))
    ok(acc.get("stamped") == 0, "S4. a different spelling in case is a different id: stamped 0 (%s)" % acc)
    ok(json.loads(db.one("select tally_post_id_accept(%s::uuid, 'B-2', '2')::text" % q(J(4)))).get("stamped") == 1 and col(J(4), "B-2", "accepted_at"), "S4. the entry's own id (B-2) stamps its row")

    # 5. round 5 (S3): the owner frees an id that is pinned (Tally accepted it, or it is held live) after looking in Tally
    good, out = rel(STAFF, J(4), "C3"); ok(not good and ("42501" in out or "only an owner" in out), "S3. a staff member cannot release an id (%s)" % out[-80:])
    good, out = rel(OTHER, J(4), "C3"); ok(not good and ("your firm" in out or "not found" in out), "S3. an owner of another firm cannot (%s)" % out[-80:])
    good, out = rel(OWNER, J(4), "C3", ""); ok(not good and "why" in out.lower(), "S3. a reason is needed (%s)" % out[-80:])
    good, out = rel(OWNER, J(4), "no-such"); ok(not good and "not in this posting" in out, "S3. an id not in the posting is refused (%s)" % out[-80:])
    good, out = rel(OWNER, J(4), "C3"); res = json.loads(out) if good else {}
    row = db.rows("select live, released_at, released_by, released_why, accepted_at from tally_post_ids where job_id = %s and fincom_id = 'C3'" % q(J(4)))[0]
    ok(good and res.get("ok") is True and res.get("released") is True and row["live"] == "f" and row["released_by"] == "owner" and row["released_why"] == "not in Tally after a look" and row["released_at"],
       "S3. the owner releases C3: live false, released_at/by 'owner'/why (%s | %s)" % (out[-120:], row))
    mk = db.rows("select entry_id, action, note, by_user from tally_post_marks where job_id = %s order by id" % q(J(4)))
    ok(len(mk) == 1 and mk[0]["action"] == "released" and mk[0]["entry_id"] == "C3" and mk[0]["note"] == "not in Tally after a look" and mk[0]["by_user"] == OWNER, "S3. a tally_post_marks row, action 'released', with who and why (%s)" % mk)
    j4 = db.rows("select results::text as r, items::text as i from tally_post_jobs where id = %s" % q(J(4)))[0]
    I4 = {x["id"]: x for x in json.loads(j4["i"] or "[]")}; R4 = {x["id"]: x for x in json.loads(j4["r"] or "[]")}
    ok(I4.get("C3", {}).get("state") == "notfound" and "owner" in I4["C3"].get("reason", "") and R4.get("C3", {}).get("ok") is False and R4["C3"].get("outcomeUnknown") is False, "S3. the entry says notfound, released by the owner, in items and results (%s)" % I4.get("C3"))
    db.sql(job(J(5), [vch("C3")]))
    ok(live(J(5), "C3") == "t", "S3. C3 may be queued again in a new posting")
    # the released id stays released whatever the posting's status does; the accepted one stays live (S1's rule in 36b)
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(4)))
    ok(live(J(4), "INV-2026.07") == "t" and live(J(4), "B-2") == "t" and live(J(4), "C3") == "f", "failed: the accepted ids stay live, the released one stays free")
    # NEVER SENT AGAIN (the owner's interrupt, job 3b03cc5e): a posting Tally accepted cannot be set 'waiting' by any route
    try: db.sql("update tally_post_jobs set status = 'waiting' where id = %s" % q(J(4))); ok(False, "route (a): Retry set the accepted posting waiting")
    except RuntimeError as e: ok("not sent to Tally again" in str(e) and "INV-2026.07" in str(e) and "B-2" in str(e), "route (a) Retry (tally_post_enqueue sets status 'waiting'): refused, the accepted entries named (%s)" % str(e)[-160:])
    ok(db.one("select status from tally_post_jobs where id = %s" % q(J(4))) == "failed" and live(J(4), "C3") == "f", "the posting stays failed; the released id is not revived")
    db.sql("update tally_post_jobs set status = 'running' where id = %s" % q(J(4)))
    # an accepted id released by the owner (not in Tally after all): accepted_at kept as history, released set, live false
    good, out = rel(OWNER, J(4), "INV202607", "looked in Tally on 03-Oct: not there")
    row = db.rows("select live, released_by, accepted_at from tally_post_ids where job_id = %s and fincom_id = 'INV-2026.07'" % q(J(4)))[0]
    ok(good and row["live"] == "f" and row["released_by"] == "owner" and row["accepted_at"], "S3. an accepted id released by the owner (by its stamped spelling): live false, accepted_at kept as history (%s)" % row)
    db.sql("update tally_post_jobs set status = 'failed' where id = %s; update tally_post_jobs set status = 'cancelled' where id = %s; update tally_post_jobs set status = 'running' where id = %s" % (q(J(4)), q(J(4)), q(J(4))))
    ok(live(J(4), "INV-2026.07") == "f" and live(J(4), "B-2") == "t", "S3. the sync never revives it: accepted but released is not live (B-2, accepted, stays live)")
    # the owner marks it posted after all: live again, the release cleared (S2's rule for a stamp)
    good, out = mark(OWNER, J(4), "INV-2026.07", "26301", "found it after all")
    row = db.rows("select live, released_at, released_by, released_why from tally_post_ids where job_id = %s and fincom_id = 'INV-2026.07'" % q(J(4)))[0]
    ok(good and row["live"] == "t" and row["released_at"] == "" and row["released_by"] == "" and row["released_why"] == "", "S2/S4. mark_posted by the tag's spelling: live again, released_at/by/why cleared (%s)" % row)
    # the bridge sees Tally accept an id the owner had released: the stamp clears the release (S2)
    db.sql("update tally_post_jobs set status = 'cancelled' where id = %s" % q(J(5)))
    acc = json.loads(db.one("select tally_post_id_accept(%s::uuid, 'C3', '26302')::text" % q(J(4))))
    row = db.rows("select live, released_at, accepted_vch from tally_post_ids where job_id = %s and fincom_id = 'C3'" % q(J(4)))[0]
    ok(acc.get("stamped") == 1 and row["live"] == "t" and row["released_at"] == "" and row["accepted_vch"] == "26302", "S2. tally_post_id_accept clears released_at/by/why and makes the id live (%s)" % row)
    # a posting held open for checking (one entry unknown): the owner's release of that entry lets it end failed
    db.sql(job(J(6), [vch("H1")]))
    db.sql("update tally_post_jobs set status = 'running', checking = true, results = %s, items = %s where id = %s" % (q(json.dumps([{"id": "H1", "ok": False, "outcomeUnknown": True, "state": "unknown"}])), q(json.dumps([{"id": "H1", "state": "unknown", "reason": "Tally accepted it; being checked"}])), q(J(6))))
    good, out = rel(OWNER, J(6), "H1", "not in the Day Book")
    j6 = db.rows("select status, checking, message from tally_post_jobs where id = %s" % q(J(6)))[0]
    ok(good and j6["status"] == "failed" and j6["checking"] == "f" and "not in the Day Book" in j6["message"] and live(J(6), "H1") == "f", "S3. a posting held open only for this entry ends failed, checking off, the reason in its message (%s)" % j6)
    # route (c): tally_post_requeue (migration 13, every minute) never moves an accepted posting back to 'waiting'; a plain
    # stale one goes as before; a posting parked 'done' + checking (tally-ingest's hold) is never looked at; nothing for the
    # bridge to take (tally_post_take, migration 5, as on staging)
    db.sql("""create or replace function public.tally_post_take(p_device uuid) returns setof public.tally_post_jobs language sql security definer set search_path = public as $$
      update tally_post_jobs set status = 'taken', taken_at = now(), updated_at = now(), message = 'Taken by the Tally computer'
       where id = (select id from tally_post_jobs where device_id = p_device and status = 'waiting' order by created_at limit 1 for update skip locked) returning *; $$;""")
    DEV = "d1000000-0000-0000-0000-000000000001"
    db.sql(job(J(17), [vch("Q1")]) + job(J(18), [vch("Q2")]) + job(J(19), [vch("Q3")]))
    db.sql("update tally_post_jobs set device_id = %s where id in (%s, %s, %s)" % (q(DEV), q(J(17)), q(J(18)), q(J(19))))
    db.sql("update tally_post_jobs set status = 'running' where id in (%s, %s)" % (q(J(17)), q(J(18))))
    db.sql("update tally_post_jobs set status = 'done', checking = true, results = %s, items = %s where id = %s" % (q(json.dumps([{"id": "Q3", "ok": False, "accepted": True, "lastVchId": "26298", "state": "unknown"}])), q(json.dumps([{"id": "Q3", "state": "unknown"}])), q(J(19))))
    db.one("select tally_post_id_accept(%s::uuid, 'Q1', '26298')::text" % q(J(17)))        # the bridge said CREATED for Q1; Q2 is a plain stale posting
    db.sql("update tally_post_jobs set updated_at = now() - interval '31 minutes', taken_at = now() - interval '40 minutes' where id in (%s, %s, %s)" % (q(J(17)), q(J(18)), q(J(19))))
    n = int(db.one("select tally_post_requeue()"))
    rows = {r["id"]: r for r in db.rows("select id, status, attempts, checking, message, updated_at > now() - interval '1 minute' as touched from tally_post_jobs where id in (%s, %s, %s)" % (q(J(17)), q(J(18)), q(J(19))))}
    ok(n == 1 and rows[J(17)]["status"] == "running" and rows[J(17)]["attempts"] == "0" and rows[J(17)]["touched"] == "f", "route (c) requeue: the accepted posting left for 31 minutes is not re-queued (status unchanged, not touched) (%s)" % rows[J(17)])
    ok(rows[J(18)]["status"] == "waiting" and rows[J(18)]["attempts"] == "1" and "again" in rows[J(18)]["message"], "a plain stale posting is re-queued as before (%s)" % rows[J(18)]["status"])
    ok(rows[J(19)]["status"] == "done" and rows[J(19)]["checking"] == "t" and rows[J(19)]["touched"] == "f", "a posting parked 'done' + checking (tally-ingest's hold) is never touched")
    taken = db.rows("select id from tally_post_take(%s::uuid)" % q(DEV))
    ok([r["id"] for r in taken] == [J(18)] and db.rows("select id from tally_post_take(%s::uuid)" % q(DEV)) == [], "the bridge is handed the plain posting only; the accepted ones never (nothing more to take)")
    # an acceptance only in Tally's words (the id never stamped: an older cloud, or stamped 0): the guard reads results and items too
    db.sql(job(J(20), [vch("W1")]) + "update tally_post_jobs set status = 'failed', results = %s where id = %s" % (q(json.dumps([{"id": "W1", "ok": False, "message": "Tally replied CREATED 1 LASTVCHID 26299; not found on read-back"}])), q(J(20))))
    try: db.sql("update tally_post_jobs set status = 'waiting' where id = %s" % q(J(20))); ok(False, "a posting with CREATED in its results was set waiting")
    except RuntimeError as e: ok("W1" in str(e), "an acceptance in Tally's words alone (no stamp) also stops a re-send (%s)" % str(e)[-100:])
    ok(json.loads(db.one("select tally_post_id_accept(%s::uuid, 'W1', '26299')::text" % q(J(20)))).get("stamped") == 1, "(and its id can be stamped)")
    good, out = rel(OWNER, J(20), "W1", "checked the Day Book: not there")
    db.sql("update tally_post_jobs set status = 'waiting' where id = %s" % q(J(20)))
    ok(good and db.one("select status from tally_post_jobs where id = %s" % q(J(20))) == "waiting", "once the owner has released it (not in Tally), Retry is allowed again")
    db.sql("update tally_post_jobs set status = 'cancelled' where id in (%s, %s)" % (q(J(18)), q(J(20))))
    # route (d): a new posting for the same bill while the id is accepted and not released: refused (tally_post_ids_sync)
    try: db.sql(job(J(21), [vch("Q1")])); ok(False, "route (d): Q1 queued again")
    except RuntimeError as e: ok("already being posted" in str(e), "route (d) a new posting (Post again) for an accepted id: refused")
    fn = db.one("select pg_get_functiondef('tally_post_id_release_owner'::regproc)")
    ok("SECURITY DEFINER" in fn and "pg_temp" in fn and db.one("select has_function_privilege('anon', 'tally_post_id_release_owner(uuid, text, text)', 'execute')") == "f", "tally_post_id_release_owner: security definer, search_path public, pg_temp; anon cannot call it")
    ok(db.one("select count(*) from tally_post_marks") == "8", "every mark kept: 3 posted, 4 released, 1 posted again (%s)" % db.one("select count(*) from tally_post_marks"))
    r = psql_file(M36); ok(r.returncode == 0, "migration-36b runs a third time over used tables %s" % ((r.stderr or "").strip()[-300:] if r.returncode else ""))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
