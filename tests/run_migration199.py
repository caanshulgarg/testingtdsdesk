"""python3 run_migration199.py - server/tally-cloud/migration-199-post-match-fast.sql (18-Nov-2026, branch
next-fix-posttimeout). A big posting's final report timed out: the bridge's update of the posting's status ran the sync
trigger (tally_post_ids_sync) and tally_post_job_accepted, which compared every id of the posting with every id of its
results and items through tally_post_id_match (four regexp_replace per pair): about a million regexps for 660 entries,
over the 8 s statement timeout, so the update was rolled back and the bridge reported again every few seconds.
On a throwaway PostgreSQL (post_queue_stand: pg_stand, port 31199 unless PG199_PORT; never a real database), made-up
firms, companies and entries only. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (no table, column, index or trigger; nothing dropped, deleted
     or truncated); only tally_post_job_accepted and tally_post_ids_sync replaced, from their latest text (43 and 40, the
     text staging runs: md5 of prosrc before the file), with only the matching lines changed; service_role only, granted
     explicitly; names no real database; runs twice
  1. the same answers: 300 made-up postings (every spelling of an id: the tag, FinCom's entry id, either in letters and
     digits, empty, punctuation only, unrelated; accepted, confirmed, released, needs review, post-only, held, Tally's
     words): tally_post_job_accepted gives exactly what the old text (kept here as a reference copy) gives, and the sync
     leaves exactly the ids live that the old rule leaves, on failed, cancelled, done and waiting
  2. a big posting (1500 entries, every one accepted and posted by Tally's reply): the bridge's report that moves it to
     done is written under an 8 s statement timeout, in well under 2 s; tally_post_job_accepted on it in under 1 s
RED_WITHOUT_199=1: the same checks without the file (2 fails: the update is cancelled by the statement timeout)."""
import os, re, sys, json, random, time, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, CO
M199 = os.path.join(PS.SQLDIR, "migration-199-post-match-fast.sql")
RED = os.environ.get("RED_WITHOUT_199") == "1"
STAGING_MD5 = {"tally_post_job_accepted": "cccf0ec96605cc42d4067c78660ac3de", "tally_post_ids_sync": "143549d21a03db906a977abdde772098"}   # read on staging 18-Nov-2026
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M199).read() if os.path.exists(M199) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M199), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and "alter table" not in code and "create table" not in code and "create index" not in code and "create trigger" not in code,
   "add-only: no table, column, index or trigger; nothing dropped, deleted or truncated")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == ["tally_post_ids_sync", "tally_post_job_accepted"], "replaces only tally_post_job_accepted and tally_post_ids_sync")
SIGS = ["public.tally_post_job_accepted(uuid, jsonb, jsonb)", "public.tally_post_ids_sync()"]
ok(all(("revoke all on function %s from public, anon, authenticated;" % s) in text and ("grant execute on function %s to service_role;" % s) in text for s in SIGS), "service_role only, granted explicitly")
m43, m40 = open(os.path.join(PS.SQLDIR, "migration-43-posting-reply.sql")).read(), open(os.path.join(PS.SQLDIR, "migration-40-states-carried.sql")).read()
for name, src, n_add, n_gone in (("tally_post_job_accepted", m43, 10, 3), ("tally_post_ids_sync", m40, 5, 2)):
    if text:
        a, b = PS.fbody(text, name), PS.fbody(src, name)
        added, gone = [l for l in a if l not in b], [l for l in b if l not in a]
        ok(len(added) == n_add and len(gone) == n_gone, "%s: the latest text with %d line(s) added, %d changed (%d / %d): %s" % (name, n_add, n_gone, len(added), len(gone), gone))
    else: ok(False, "%s: no file" % name)

st = PS.Stand(int(os.environ.get("PG199_PORT") or 31199)); db = st.db
md5 = lambda name: db.one("select md5(prosrc) from pg_proc where proname = %s" % q(name))
J = lambda n: "%08d-0000-0000-0000-000000000199" % n
try:
    print("== 0. the stand runs staging's text")
    for name, want in STAGING_MD5.items(): ok(md5(name) == want, "%s before the file: md5 %s (staging %s)" % (name, md5(name), want))
    # the old text, kept as the reference: tally_post_job_accepted under another name, and the sync's old rule as a query
    old = db.one("select pg_get_functiondef('public.tally_post_job_accepted(uuid, jsonb, jsonb)'::regprocedure)")
    db.sql(old.replace("public.tally_post_job_accepted(", "public.ref199_job_accepted(", 1))
    REF_LIVE = """select coalesce(string_agg(i.fincom_id || '=' || ((i.accepted_at is not null and i.released_at is null)
                        or (%(st)s not in ('failed', 'cancelled') and i.released_at is null)
                        or (i.released_at is null and exists (select 1 from unnest(a.acc) x where tally_post_id_match(i.fincom_id, i.entry_id, x))))::text, ',' order by i.fincom_id), '')
                    from tally_post_ids i, (select coalesce(array_agg(distinct s.id), '{}') acc from tally_post_jobs j, lateral (
                        select unnest(string_to_array(coalesce(ref199_job_accepted(j.id, j.results, j.items), ''), ', ')) id
                        union select x->>'id' from jsonb_array_elements(coalesce(j.results, '[]'::jsonb)) x where x->>'id' is not null and (tally_post_result_taken(x) or tally_post_bool(x->>'ok'))
                        union select x->>'id' from jsonb_array_elements(coalesce(j.items, '[]'::jsonb)) x where x->>'id' is not null and tally_post_result_taken(x)) s
                      where j.id = %(j)s and s.id <> '') a where i.job_id = %(j)s"""
    LIVE = "select coalesce(string_agg(fincom_id || '=' || live::text, ',' order by fincom_id), '') from tally_post_ids where job_id = %s"
    print("== 0. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_199: not run)" % n); continue
        r = st.psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    st.grants()
    if not RED:
        priv = lambda role, s: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(s)))
        ok(all(priv("authenticated", s) == "false" and priv("anon", s) == "false" and priv("service_role", s) == "true" for s in SIGS), "not for anon or authenticated; service_role may")
        print("  read-back md5(prosrc): tally_post_job_accepted %s, tally_post_ids_sync %s" % (md5("tally_post_job_accepted"), md5("tally_post_ids_sync")))

    def new_job(n, status="running"):
        db.sql("insert into tally_post_jobs (id, firm_id, client_id, company, status, n, payload) values (%s, %s, 'c1', %s, %s, 0, '{\"vouchers\": []}')" % (q(J(n)), q(F), q(CO), q(status)))
    def put_ids(n, rows):   # [(fincom_id, entry_id, accepted, released)]
        if rows: db.sql("insert into tally_post_ids (firm_id, client_id, fincom_id, job_id, entry_id, live, accepted_at, released_at) values " + ", ".join(
            "(%s, 'c1', %s, %s, %s, true, %s, %s)" % (q(F), q(f), q(J(n)), q(e) if e is not None else "null", "now()" if a else "null", "now()" if r else "null") for f, e, a, r in rows))

    print("== 1. the same answers")
    rnd = random.Random(199)
    WORDS = ["", "CREATED 1 LASTVCHID 52", "CREATED 0", "ALTERED 3 VCHID 7", "Tally replied 'created', but the entry cannot be found in 'X'", "line error", None]
    def spell(f, e):   # an id as the bridge, FinCom or the tag may spell it, or none of the posting's
        c = rnd.randrange(9)
        if c == 0: return f
        if c == 1 and e: return e
        if c == 2: return re.sub(r"[^A-Za-z0-9]", "", f)
        if c == 3 and e: return re.sub(r"[^A-Za-z0-9]", "", e)
        if c == 4: return rnd.choice(["", "--", ".", " "])
        if c == 5: return f.lower()
        if c == 6: return "other-%d" % rnd.randrange(5)
        return rnd.choice([f, e or f])
    def entry(i_d):
        x = {"id": i_d}
        for k in ("ok", "verified", "byReply", "needsReview", "accepted", "held", "postOnly"):
            if rnd.random() < 0.3: x[k] = rnd.choice([True, False, "true", "yes", 1])
        if rnd.random() < 0.4: x["state"] = rnd.choice(["in_tally", "sent", "failed", "unknown", "waiting", "posted"])
        w = rnd.choice(WORDS)
        if w is not None: x[rnd.choice(["reason", "message"])] = w
        if rnd.random() < 0.2: x["created"] = rnd.choice(["1", "0", "x", 2])
        if rnd.random() < 0.2: x["lastVchId"] = rnd.choice(["", "77"])
        return x
    bad_acc, bad_live, shown, cases = [], [], 0, 0
    for n in range(1, 301):
        st0 = rnd.choice(["running", "taken", "done"]); new_job(n, st0)
        rows = []
        for k in range(rnd.randrange(1, 9)):
            f = rnd.choice(["J%d-INV-26.%02d" % (n, k), "J%d:bank#%d" % (n, k), "j%d inv %d" % (n, k)])
            e = rnd.choice([None, "j%d-abc-%d" % (n, k), "J%dINV26%02d" % (n, k), ""])
            rows.append((f, e, rnd.random() < 0.5, rnd.random() < 0.25))
        put_ids(n, rows)
        res = [entry(spell(f, e)) for f, e, _, _ in rows for _ in range(rnd.randrange(0, 3))]
        its = [entry(spell(f, e)) for f, e, _, _ in rows for _ in range(rnd.randrange(0, 2))]
        if rnd.random() < 0.15: res.append({"ok": True})   # a result without an id
        db.sql("update tally_post_jobs set results = %s, items = %s where id = %s" % (q(json.dumps(res)), q(json.dumps(its)), q(J(n))))
        a_ref = db.one("select coalesce(ref199_job_accepted(id, results, items), '<null>') from tally_post_jobs where id = %s" % q(J(n)))
        a_new = db.one("select coalesce(tally_post_job_accepted(id, results, items), '<null>') from tally_post_jobs where id = %s" % q(J(n)))
        if a_ref != a_new: bad_acc.append((n, a_ref, a_new))
        to = rnd.choice([x for x in ["failed", "cancelled", "done", "failed", "waiting"] if x != st0])   # a change of status (the sync runs on one)
        want = db.one(REF_LIVE % {"st": q(to), "j": q(J(n))})
        try: db.sql("update tally_post_jobs set status = %s where id = %s" % (q(to), q(J(n))))
        except RuntimeError as e:   # Retry of a posting Tally accepted: refused by the resend guard, as before; nothing changed
            if "not sent to Tally again" not in str(e) and "needs review" not in str(e): bad_live.append((n, "error " + str(e)[-200:])); continue
            want = db.one(LIVE % q(J(n)))
        got = db.one(LIVE % q(J(n)))
        if got != want: bad_live.append((n, st0, to, want, got))
        cases += 1; shown += a_ref != "<null>"
    ok(not bad_acc, "tally_post_job_accepted: the old answer for all %d postings (%d with entries accepted, not confirmed) %s" % (cases, shown, bad_acc[:3]))
    ok(not bad_live, "the sync: the same ids live as the old rule after each status change %s" % bad_live[:3])

    print("== 2. a big posting")
    N = 1500
    new_job(1000)
    put_ids(1000, [("TDS:big-%04d" % k, "bigentry-%04d" % k, True, False) for k in range(N)])
    res = [{"id": "bigentry-%04d" % k, "ok": True, "byReply": True, "vchId": str(9000 + k), "state": "posted", "message": "CREATED 1 LASTVCHID %d" % (9000 + k)} for k in range(N)]
    its = [{"id": "bigentry-%04d" % k, "state": "posted"} for k in range(N)] + [{"id": "led:made-up ledger", "state": "posted"}]
    t0 = time.time(); a = db.one("select coalesce(tally_post_job_accepted(%s::uuid, %s::jsonb, %s::jsonb), '<null>')" % (q(J(1000)), q(json.dumps(res)), q(json.dumps(its)))); t1 = time.time() - t0
    ok(a == "<null>" and t1 < 1.0, "tally_post_job_accepted on %d entries: every one confirmed (%s), %.2f s" % (N, a[:60], t1))
    upd = ("set role service_role; set statement_timeout = '8s'; update tally_post_jobs set status = 'done', done = %d, results = %s, items = %s, seq = 35 where id = %s and status <> 'cancelled'"
           % (N, q(json.dumps(res)), q(json.dumps(its)), q(J(1000))))
    t0 = time.time()
    try: db.sql(upd); err = ""
    except RuntimeError as e: err = str(e)[-200:]
    t2 = time.time() - t0
    ok(not err and t2 < 2.0, "the bridge's report moving it to done is written under an 8 s statement timeout: %.2f s %s" % (t2, err))
    ok(db.one("select status from tally_post_jobs where id = %s" % q(J(1000))) == ("done" if not err else "running") and db.one("select count(*) filter (where live)::text from tally_post_ids where job_id = %s" % q(J(1000))) == str(N),
       "stored done, every id live (Tally took them)")
    t0 = time.time()
    try: db.sql("set role service_role; set statement_timeout = '8s'; update tally_post_jobs set status = 'failed' where id = %s" % q(J(1000))); err = ""
    except RuntimeError as e: err = str(e)[-200:]
    ok(not err and time.time() - t0 < 2.0 and db.one("select count(*) filter (where live)::text from tally_post_ids where job_id = %s" % q(J(1000))) == str(N),
       "set failed by hand: in under 2 s, and no id Tally took is freed (%.2f s) %s" % (time.time() - t0, err))
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
