"""python3 run_beat_light_ingest.py - next-db-load-2 (migration 216): tally-ingest's heartbeat reads its held lines in ONE
light call (tally_held_light) instead of up to ~8 reads of tally_recorder_lines with every line's body and payload; the
same fingerprint as the last heartbeat's: nothing more is read or worked out (at most 2 minutes). Through the real cloud
function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py), whose
tally_held_light stands for migration 216's (its SQL: run_migration216.py). Made-up lines only.
  1. the light call failing (the database busy): the reads as before (the baseline: heldLines, refetch, ledgersWanted);
     a cloud without 216 is every other ingest test (the stand-in has it off by default)
  2. with 216: the same answer, from one call and no read of tally_recorder_lines
  3. the next heartbeat, nothing changed: one call, answered {same} (seen = the fingerprint); no read of the month locks,
     the ledgers, the links or the claims; the same answer
  4. a line comes: listed at the next heartbeat
  5. a line waiting for a ledger: never kept from the last heartbeat (worked out each time), the ledger wanted as before
Run it in a network namespace of its own: unshare -n sh -c 'python3 -I loup.py && python3 tests/run_beat_light_ingest.py'.
Needs Deno (DENO). LIGHT_OFF=1: the cloud function before the change (the checks of 2-3 fail)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
FN = os.environ.get("INGEST_FILE") or os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, DA = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111111", "d1000000-0000-0000-0000-000000000001"
KA = "fcd_" + "a" * 48
GA = {"id": "go-aaaaaa111111", "computer": "MADEUP-PC", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.19"}
SLOW = "FinCom does not ask Tally for this company's entries: finding one entry took Tally longer than 2 s. Upload that day's Day Book to settle it."
WAIT = "waiting: Tally took longer than 2 s; FinCom asks again at 10:42"
def ago(days): return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() - days * 86400))
n = [0]
BIG = {"vouchers": [{"guid": "cg-1-0000%04d" % i, "narr": "MADE UP " * 50} for i in range(20)]}
def row(lid, days, why, state="held", body=None, mid="25689", event="created", payload=None):
    n[0] += 1
    return {"id": n[0], "line_id": lid, "company": "ZZ MADE UP CO", "company_guid": "cg-1", "event": event, "master_id": mid, "alter_id": None,
            "vch_type": "Journal", "vch_no": "", "vch_date": "2026-10-06", "book_id": BOOK, "firm_id": FIRM, "device_id": DA, "bridge": GA["id"], "state": state,
            "held_why": why, "object_guid": None, "body": body, "payload": payload, "received_at": ago(days)}
FS.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ MADE UP CO", "client_id": "c1", "book_id": BOOK})
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "MADEUP-PC", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.19"})
FS.T["tally_recorder_lines"] = [
    row("R1", 1, WAIT, mid="1001"), row("R2", 2, WAIT, state="fetching", mid="1002", body=BIG, payload={"fid": "B-1", "big": "x" * 4000}),
    row("R3", 3, "", mid="1003", body=BIG), row("R3:resolved", 2, "the entry's details from Tally are incomplete", mid="1003"),
    row("S1", 10, SLOW, mid="1004"), row("D1", 2, WAIT, event="deleted", mid="1005"),
    row("A1", 1, "", state="applied", mid="1006"), row("R4", 2, WAIT, mid="1007"), row("R4:resolved", 1, "", state="applied", body=BIG, mid="1007"),
]
FS.T["tally_month_locks"] = []
FS.T["tally_ledgers"] = [{"book_id": BOOK, "firm_id": FIRM, "name": "Cash"}]
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", FN], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def beat():
    q0, a0 = len(FS.QUERIES), len(FS.ARGS.get("tally_held_light", []))
    c, r = call({"kind": "beat", "version": GA["version"], "bridge": GA, "tally": True, "open": []})
    q = FS.QUERIES[q0:]
    reads = lambda t: len([x for x in q if x[0] in ("GET", "HEAD") and x[1].endswith("/rest/v1/" + t)])
    return c, {k: r.get(k) for k in ("heldLines", "refetch", "ledgersWanted")}, {"lines": reads("tally_recorder_lines"), "locks": reads("tally_month_locks"), "ledgers": reads("tally_ledgers"),
        "light": FS.ARGS.get("tally_held_light", [])[a0:], "claims": len([x for x in q if x[1].endswith("/rpc/tally_work_claim")])}
ids = lambda o: {k: [x.get("line_id") or x.get("name") for x in (o.get(k) or [])] for k in o}
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    print("== 1. the light call failing")
    FS.HELD_LIGHT[0] = True
    OFF = lambda: FS.FAIL_RPC.__setitem__("tally_held_light", {"message": "canceling statement due to statement timeout (test)", "code": "57014"})
    ON = lambda: FS.FAIL_RPC.pop("tally_held_light", None) if not os.environ.get("LIGHT_OFF") else None
    OFF()
    c, base, k = beat()
    ok(c == 200 and set(ids(base)["heldLines"]) >= {"R1", "R2", "R3", "S1"} and "R4" not in ids(base)["heldLines"] and "D1" not in ids(base)["heldLines"], "the beat as before (%s)" % ids(base))
    ok(k["lines"] >= 4, "...reading tally_recorder_lines %d times, the bodies with them" % k["lines"])
    print("== 2. with 216")
    ON()
    c, two, k = beat()
    ok(c == 200 and two == base, "the same answer (%s)" % ids(two))
    ok(len(k["light"]) == 1 and k["lines"] == 0 and k["light"][0].get("p_seen") == "", "one light call, no read of tally_recorder_lines (%d calls, %d reads)" % (len(k["light"]), k["lines"]))
    print("== 3. the next heartbeat, nothing changed")
    fp = None
    c, three, k = beat()
    seen = (k["light"] or [{}])[0].get("p_seen")
    ok(c == 200 and three == base, "the same answer")
    ok(len(k["light"]) == 1 and seen and FS.held_light(dict(k["light"][0])).get("same") is True, "one call, answered {same} (the last fingerprint sent)")
    ok(k["lines"] == 0 and k["locks"] == 0 and k["ledgers"] == 0 and k["claims"] == 0, "nothing else read: lines %d, month locks %d, ledgers %d, claims %d" % (k["lines"], k["locks"], k["ledgers"], k["claims"]))
    print("== 4. a line comes")
    FS.T["tally_recorder_lines"].append(row("R5", 0.01, WAIT, mid="1008"))
    c, four, k = beat()
    ok(c == 200 and "R5" in ids(four)["heldLines"], "listed at the next heartbeat (%s)" % ids(four)["heldLines"])
    print("== 5. a line waiting for a ledger")
    FS.T["tally_recorder_lines"].append(row("W1", 0.01, "waiting for the ledger 'ZZ New Party' (not in FinCom's ledger list yet)", mid="1009", payload={"waitLedgers": ["ZZ New Party"]}))
    OFF(); c, wb, _ = beat()
    ON(); c, w1, k1 = beat(); c, w2, k2 = beat()
    ok(w1 == wb and w2 == wb, "the same answer as the reads give (%s)" % ids(w1))
    ok(any(x.get("name") == "ZZ New Party" for x in (w2.get("ledgersWanted") or [])), "the ledger wanted (%s)" % w2.get("ledgersWanted"))
    ok(k2["ledgers"] >= 1 or k2["lines"] == 0, "worked out again while a line waits for a ledger (the ledger list read: %d)" % k2["ledgers"])
finally:
    fn.terminate()
    if fails: print("".join(log[-40:]))
print("%d failed" % len(fails) if fails else "all ok")
sys.exit(1 if fails else 0)
