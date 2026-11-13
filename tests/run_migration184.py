"""python3 run_migration184.py - server/tally-cloud/migration-184-post-dupes.sql (13-Nov-2026, branch
next-post-queue-anyway; item C of the posting reliability plan, approved by the owner). On a throwaway PostgreSQL
(post_queue_stand: pg_stand, port 31184 unless PG184_PORT; never a real database; built as run_migration174.py with 174
run), made-up firms, logins and companies only. Checks:
  0. the file: one transaction, lock_timeout 10 s; add-only (no table, column, index; no drop, delete or truncate); only
     tally_post_enqueue_core replaced, from its latest text (161) with only the lines counted changed; service_role only,
     granted explicitly; names no real database; md5; runs twice
  1. a posting of new entries: queued as before (no dupes in the answer)
  2. partly held: {V2, V3, V4} while {V1, V2} waits: only V3, V4 queued (n 2), V2 answered with the posting that holds it
     and its status; each id live once
  3. wholly held: nothing inserted, ok false, none true, every entry named with its posting; the words an older page shows
  4. held by a posting taken (status taken), and by one done whose id is live (in Tally): left out, the others queued
     (before: the id's unique index refused them all)
  5. an id set free (its posting failed) is queued again; the masters go with the new entries
  6. Retry (the same posting id) as before
  7. at the same moment: two overlapping postings, the first's transaction still open: the second waits (the advisory lock),
     then queues only what the first did not; 4 rounds started together: every id in exactly one live posting, none lost
RED_WITHOUT_184=1: the same checks without the file (2-5 and 7 fail)."""
import os, re, sys, json, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import post_queue_stand as PS
from post_queue_stand import q, F, OWNER, STAFF, DA, DB, BA, BB, CO
M184 = os.path.join(PS.SQLDIR, "migration-184-post-dupes.sql")
RED = os.environ.get("RED_WITHOUT_184") == "1"
EC_ADD, EC_GONE = 29, 6   # enqueue_core against 161: the lock, the held entries left out and named
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
text = open(M184).read() if os.path.exists(M184) else ""
print("  md5 of %s: %s (%d bytes)" % (os.path.basename(M184), hashlib.md5(text.encode()).hexdigest(), len(text.encode())))
code = "\n".join(l.split("--")[0] for l in text.lower().splitlines())
print("== 0. the file")
ok(re.search(r"^begin;\s*\nset local lock_timeout = '10s';", text, re.M) is not None and text.rstrip().endswith("commit;") and code.count("\nbegin;") == 1, "one transaction, lock_timeout 10 s")
ok(bool(text) and "delete from" not in code and not re.search(r"\b(drop|truncate)\s", code) and "alter table" not in code and "create table" not in code and "create index" not in code and "create trigger" not in code,
   "add-only: no table, column, index or trigger; nothing dropped, deleted or truncated")
ok(bool(text) and not re.search(r"supabase\.co|https?://|qbocskai|nrtczu|project[_ ]ref", text.lower()), "names no real database")
ok(sorted(set(re.findall(r"create or replace function public\.(\w+)\(", code))) == ["tally_post_enqueue_core"], "replaces only tally_post_enqueue_core")
SIG = "public.tally_post_enqueue_core(uuid, text, jsonb, uuid, text)"
ok(("revoke all on function %s from public, anon, authenticated;" % SIG) in text and ("grant execute on function %s to service_role;" % SIG) in text, "service_role only, granted explicitly")
m161 = open(os.path.join(PS.SQLDIR, "migration-161-split-tally.sql")).read()
if text:
    a, b = PS.fbody(text, "tally_post_enqueue_core"), PS.fbody(m161, "tally_post_enqueue_core")
    added, gone = [l for l in a if l not in b], [l for l in b if l not in a]
    ok(len(added) == EC_ADD and len(gone) == EC_GONE, "tally_post_enqueue_core: the latest text (161) with %d line(s) added, %d changed (%d / %d): %s" % (EC_ADD, EC_GONE, len(added), len(gone), gone))
else: ok(False, "tally_post_enqueue_core: no file")

st = PS.Stand(int(os.environ.get("PG184_PORT") or 31184)); db = st.db
J = lambda n: "%08d-0000-0000-0000-000000000184" % n
V = lambda *ids: [{"id": i, "xml": "<VOUCHER/>"} for i in ids]
def enq(n, ids, client="c1", masters=None, uid=STAFF):
    return st.rpc(uid, "select tally_post_enqueue_to(%s::uuid, %s, %s::jsonb, null, null)::text" % (q(J(n)), q(client), q(json.dumps({"masters": masters or [], "vouchers": V(*ids)}))))
enq_sql = lambda n, ids: "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text;" % (q(J(n)), q(json.dumps({"vouchers": V(*ids)})))
AS = "set role authenticated; set fincom.uid = '%s';" % STAFF
job = lambda n: (db.rows("select status, n::text n, coalesce((select string_agg(v->>'id', ',' order by o) from jsonb_array_elements(payload->'vouchers') with ordinality t(v, o)), '') ids, jsonb_array_length(payload->'masters')::text masters from tally_post_jobs where id = %s" % q(J(n))) or [None])[0]
def holders(ids):   # each id -> the postings (waiting, taken, running) whose payload holds it
    return {i: (db.one("select coalesce(string_agg(j.id::text, ',' order by j.id), '') from tally_post_jobs j where j.firm_id = %s and j.status in ('waiting', 'taken', 'running') and exists (select 1 from jsonb_array_elements(j.payload->'vouchers') v where v->>'id' = %s)" % (q(F), q(i))) or "") for i in ids}
def clear(): db.sql("update tally_post_jobs set status = 'failed' where status in ('waiting', 'taken', 'running')")   # never taken: their ids are free again
try:
    print("== 0. runs twice")
    for n in (1, 2):
        if RED: ok(False, "run %d (RED_WITHOUT_184: not run)" % n); continue
        r = st.psql_text(text); ok(r.returncode == 0, "run %d %s" % (n, (r.stderr or "").strip()[-500:] if r.returncode else ""))
    st.grants()
    if not RED:
        priv = lambda role: db.one("select has_function_privilege(%s, %s, 'execute')::text" % (q(role), q(SIG)))
        ok(priv("authenticated") == "false" and priv("anon") == "false" and priv("service_role") == "true", "not for anon or authenticated; service_role may")
        print("  read-back tally_post_enqueue_core md5(prosrc)=%s" % db.one("select md5(prosrc) from pg_proc where proname = 'tally_post_enqueue_core'"))

    print("== 1. a posting of new entries")
    r = enq(1, ["V1", "V2"])
    ok(r.get("ok") is True and r.get("id") == J(1) and "dupes" not in r and "none" not in r, "queued as before (%s)" % r)
    x = job(1); ok(x is not None and x["status"] == "waiting" and x["n"] == "2" and x["ids"] == "V1,V2", "the posting holds both, waiting (%s)" % x)

    print("== 2. partly held")
    r = enq(2, ["V2", "V3", "V4"])
    ok(r.get("ok") is True and r.get("id") == J(2), "the others are queued, not refused (%s)" % (r.get("error") or r.get("_error") or "ok"))
    ok(r.get("dupes") == [{"id": "V2", "job": J(1), "status": "waiting"}], "the held entry answered with its posting and status (%s)" % r.get("dupes"))
    x = job(2); ok(x is not None and x["ids"] == "V3,V4" and x["n"] == "2", "the new posting holds only the new entries (%s)" % x)
    h = holders(["V1", "V2", "V3", "V4"]); ok(h == {"V1": J(1), "V2": J(1), "V3": J(2), "V4": J(2)}, "each entry in exactly one posting (%s)" % h)
    ok(db.one("select count(*)::text || '/' || count(distinct fincom_id)::text from tally_post_ids where firm_id = %s and live" % q(F)) == "4/4", "each FinCom id live once")

    print("== 3. wholly held")
    n0 = db.one("select count(*) from tally_post_jobs")
    r = enq(3, ["V1", "V2", "V4"])
    ok(r.get("ok") is False and r.get("none") is True and "_error" not in r, "nothing queued: ok false, none true (%s)" % r)
    ok(r.get("dupes") == [{"id": "V1", "job": J(1), "status": "waiting"}, {"id": "V2", "job": J(1), "status": "waiting"}, {"id": "V4", "job": J(2), "status": "waiting"}], "every entry named with the posting that holds it (%s)" % r.get("dupes"))
    ok(db.one("select count(*) from tally_post_jobs") == n0 and job(3) is None, "no posting inserted")
    ok("already waiting to be posted" in str(r.get("error")) and "Nothing was queued again" in str(r.get("error")), "the words an older page shows (%s)" % r.get("error"))

    print("== 4. held by a posting taken, and by one done whose id is live")
    t = db.rows("select id::text from tally_post_take_for(%s::uuid, %s, true)" % (q(DA), q(BA)))
    ok(bool(t) and t[0]["id"] == J(1), "A takes the first posting")
    r = enq(4, ["V1", "V5"])
    ok(r.get("ok") is True and r.get("dupes") == [{"id": "V1", "job": J(1), "status": "taken"}] and (job(4) or {}).get("ids") == "V5", "taken: V1 left out with status taken, V5 queued (%s)" % r)
    db.sql("update tally_post_jobs set status = 'done', done = 2, results = %s where id = %s" % (q(json.dumps([{"id": "V1", "ok": True, "verified": True}, {"id": "V2", "ok": True, "verified": True}])), q(J(1))))
    ok(db.one("select string_agg(live::text, ',') from tally_post_ids where job_id = %s" % q(J(1))) == "true,true", "a posting done keeps its ids live (they are in Tally)")
    r = enq(5, ["V2", "V6"])
    ok(r.get("ok") is True and r.get("dupes") == [{"id": "V2", "job": J(1), "status": "done"}] and (job(5) or {}).get("ids") == "V6", "done, id live: V2 left out with status done, V6 queued; never refused whole (%s)" % r)
    r = enq(6, ["V1", "V2"])
    ok(r.get("ok") is False and r.get("none") is True and "not sent twice" in str(r.get("error")) and job(6) is None, "wholly in a posting done: nothing queued, the words say not sent twice (%s)" % (r.get("error") or r))

    print("== 5. an id set free; the masters")
    clear()
    r = enq(7, ["V5", "V6"])
    ok(r.get("ok") is True and "dupes" not in r and (job(7) or {}).get("ids") == "V5,V6", "their postings failed (ids free): queued again whole (%s)" % r)
    r = enq(8, ["V6", "V8"], masters=[{"id": "M1", "xml": "<LEDGER/>"}])
    x = job(8); ok(r.get("ok") is True and x is not None and x["ids"] == "V8" and x["masters"] == "1" and x["n"] == "2", "partly held with a master: the master goes with the new entry, n counts both (%s)" % x)
    r = st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', %s::jsonb, null, null)::text" % (q(J(9)), q(json.dumps({"masters": [{"id": "M2", "xml": "<LEDGER/>"}], "vouchers": []}))))
    ok(r.get("ok") is True and "dupes" not in r and (job(9) or {}).get("n") == "1", "masters alone: queued as before (%s)" % r)

    print("== 6. Retry as before")
    db.sql("update tally_post_jobs set status = 'failed' where id = %s" % q(J(8)))
    r = st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', '{}'::jsonb, null, null)::text" % q(J(8)))
    ok(r.get("ok") is True and r.get("retry") is True and (job(8) or {}).get("status") == "waiting", "a failed posting queued again under its id (%s)" % r)
    r = st.rpc(STAFF, "select tally_post_enqueue_to(%s::uuid, 'c1', '{}'::jsonb, null, null)::text" % q(J(8)))
    ok(r.get("ok") is True and r.get("again") is True, "the same id while it waits: as it is (%s)" % r)

    print("== 7. at the same moment")
    clear()
    a, b = st.pair(enq_sql(71, ["W1", "W2", "W3"]), enq_sql(72, ["W2", "W3", "W4"]), hold=1.5, gap=0.5, pre_a=AS, pre_b=AS)
    ra = json.loads(a) if a.startswith("{") else {"_error": a}; rb = json.loads(b) if b.startswith("{") else {"_error": b}
    ok(ra.get("ok") is True and "dupes" not in ra, "the first (its transaction open 1.5 s) queues its three (%s)" % ra)
    ok(rb.get("ok") is True and [d["id"] for d in rb.get("dupes", [])] == ["W2", "W3"] and all(d["job"] == J(71) for d in rb.get("dupes", [])), "the second waited for it, then left out what the first holds (%s)" % rb)
    h = holders(["W1", "W2", "W3", "W4"]); ok(h == {"W1": J(71), "W2": J(71), "W3": J(71), "W4": J(72)}, "every entry in exactly one posting, none lost (%s)" % h)
    good = True; seen = ""
    for k in range(4):
        ids_a, ids_b = ["X%d_%d" % (k, i) for i in (1, 2, 3)], ["X%d_%d" % (k, i) for i in (3, 2, 4)]
        a, b = st.pair(enq_sql(80 + 2 * k, ids_a), enq_sql(81 + 2 * k, ids_b), hold=0, pre_a=AS, pre_b=AS)
        h = holders(sorted(set(ids_a + ids_b)))
        if not all(v in (J(80 + 2 * k), J(81 + 2 * k)) for v in h.values()) or a.startswith("ERROR") or b.startswith("ERROR"): good = False; seen = "%s / %s / %s" % (a[:200], b[:200], h)
    ok(good, "4 rounds started together: every entry in exactly one posting, no error %s" % seen)
    ok(db.one("select coalesce(max(c), 0)::text from (select count(*) c from tally_post_ids where firm_id = %s and live group by fincom_id) s" % q(F)) == "1", "no FinCom id live in two postings")
finally:
    st.stop()
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
