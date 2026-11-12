"""python3 run_post_cas_ingest.py - migration 174 (item 3, next-fix-post-jobs) in tally-ingest: posts_update writes the
posting back as a compare-and-set on the version it read (tally_post_jobs.row_version), so an owner's settlement or the
cron's requeue made while the report was being worked on is never written over. tally-ingest
(server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py); the "meanwhile" is made
inside the report's own awaits (its stamp of an accepted entry, tally_post_id_accept). Made-up names only. Checks:
  1. the normal path: nobody else wrote: the report is written once (status, results, seq), as before;
  2. the owner settles the posting (done, Mark posted) meanwhile: the report's write misses, the posting is read again
     and is settled: answered settled / cancelled, the owner's settlement kept as it was;
  3. the owner marks one entry meanwhile while the posting goes on: read again, merged again: the owner's entry kept,
     the bridge's other entries written;
  4. the cron puts the posting back (waiting) meanwhile: not written over, answered requeued;
  5. a posting already waiting (handed back) takes no report of the bridge's old copy;
  6. a cloud without 174 (no row_version): written as before, once;
  7. a posting handed to another bridge of the same computer (taken_by it): this bridge is told to stop (cancelled).
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, urllib.error, shutil, threading, copy
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "f-174"; KEY = "fcd_" + "b" * 48
ME = {"id": "go-aaaa000174", "computer": "PC-MADEUP", "user": "PC-MADEUP\\madeup", "mode": "main", "runMode": "user", "version": "2.5.5", "port": 9101}
OTHER = "go-bbbb000174"
F.T["tally_devices"].append({"id": "d-174", "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {"bridges": {ME["id"]: {"at": "2026-11-12T10:00:00Z"}}}, "version": "2.5.5"})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ OSPREY CO", "client_id": "c1", "device_id": "d-174", "book_id": "bk-174"})
def job(i, status, **kw):
    return dict({"id": i, "firm_id": FIRM, "device_id": "d-174", "company": "ZZ OSPREY CO", "status": status, "checking": False, "seq": 1, "message": "as the cloud has it",
                 "results": [], "items": [], "target_bridge": ME["id"], "taken_by": ME["id"], "row_version": 0,
                 "payload": {"vouchers": [{"id": "K1", "xml": "<VOUCHER/>"}, {"id": "K2", "xml": "<VOUCHER/>"}]}}, **kw)
row = lambda i: next(j for j in F.T["tally_post_jobs"] if j["id"] == i)
# the "meanwhile": run once, inside the report, at its stamp of an accepted entry (between its read and its write)
MEANWHILE = {}
orig_rpc = F.rpc
def hooked(fn, a):
    if fn == "tally_post_id_accept" and a.get("p_job") in MEANWHILE:
        MEANWHILE.pop(a["p_job"])(row(a["p_job"]))
    return orig_rpc(fn, a)
F.rpc = hooked
PATCHES = []
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
RES = [{"id": "K1", "ok": True, "verified": True, "state": "in_tally", "vchNumber": "11"}, {"id": "K2", "ok": True, "verified": True, "state": "in_tally", "vchNumber": "12"}]
ITEMS = [{"id": "K1", "kind": "vch", "state": "in_tally"}, {"id": "K2", "kind": "vch", "state": "in_tally"}]
def update(i, status="running", seq=2, results=RES, items=ITEMS):
    return call({"kind": "posts_update", "version": "2.5.5", "bridge": ME, "id": i, "status": status, "done": 1, "message": "Posting 2 entries", "results": results, "items": items, "checking": False, "seq": seq,
                 "updatedAt": "2026-11-12T10:00:00Z"})
patches = lambda i: sum(1 for m, p in F.CALLS if m == "PATCH" and p.endswith("/tally_post_jobs"))
try:
    for _ in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    print("== 1. the normal path")
    F.T["tally_post_jobs"].append(job("j1", "taken"))
    n0 = patches("j1"); c, r = update("j1")
    x = row("j1")
    ok(c == 200 and r == {"ok": True} and x["status"] == "running" and x["seq"] == 2 and [e["id"] for e in x["results"]] == ["K1", "K2"], "written: running, seq 2, the results (%s %s %s)" % (c, r, x["status"]))
    ok(patches("j1") - n0 == 1, "once")

    print("== 2. the owner settles the posting meanwhile")
    OWNER_RES = [{"id": "K1", "ok": True, "byOwner": True, "byOwnerAt": "2026-11-12T10:30:00Z", "state": "in_tally", "message": "Marked posted by the owner"},
                 {"id": "K2", "ok": True, "byOwner": True, "byOwnerAt": "2026-11-12T10:30:00Z", "state": "in_tally", "message": "Marked posted by the owner"}]
    F.T["tally_post_jobs"].append(job("j2", "running", checking=True, status_note=None))
    def settle(j): j.update(status="done", checking=False, results=copy.deepcopy(OWNER_RES), message="Settled by the owner", row_version=j["row_version"] + 1)
    MEANWHILE["j2"] = settle
    c, r = update("j2", status="failed", results=[{"id": "K1", "ok": False, "accepted": True, "lastVchId": "77", "message": "Tally replied CREATED 1 LASTVCHID 77"}, {"id": "K2", "ok": False, "message": "refused"}],
                  items=[{"id": "K1", "state": "failed", "reason": "x"}, {"id": "K2", "state": "failed", "reason": "refused"}])
    x = row("j2")
    ok(not MEANWHILE and x["status"] == "done" and x["message"] == "Settled by the owner" and x["results"] == OWNER_RES, "the owner's settlement kept as it was (%s / %s)" % (x["status"], x["message"]))
    ok(c == 200 and r.get("settled") is True and r.get("cancelled") is True, "the bridge told it is settled (stops its copy) (%s %s)" % (c, r))
    ok(any("changed since it was read" in l for l in log), "the lost race is logged")

    print("== 3. the owner marks one entry meanwhile; the posting goes on")
    F.T["tally_post_jobs"].append(job("j3", "running"))
    MARK = {"id": "K1", "ok": True, "byOwner": True, "byOwnerAt": "2026-11-12T11:00:00Z", "state": "in_tally", "message": "Marked posted by the owner"}
    def mark(j): j.update(results=[dict(MARK)], items=[{"id": "K1", "state": "in_tally", "byOwner": True, "byOwnerAt": "2026-11-12T11:00:00Z"}], row_version=j["row_version"] + 1)
    MEANWHILE["j3"] = mark
    c, r = update("j3", results=[{"id": "K1", "ok": False, "accepted": True, "lastVchId": "78", "message": "Tally replied CREATED 1 LASTVCHID 78"}, {"id": "K2", "ok": True, "verified": True, "state": "in_tally", "vchNumber": "13"}],
                  items=[{"id": "K1", "state": "unknown"}, {"id": "K2", "state": "in_tally"}])
    x = row("j3")
    k1 = next((e for e in x["results"] if e["id"] == "K1"), {}); k2 = next((e for e in x["results"] if e["id"] == "K2"), {})
    ok(c == 200 and r.get("ok") is True and k1.get("byOwner") is True and k1.get("message") == "Marked posted by the owner" and k2.get("vchNumber") == "13" and x["seq"] == 2,
       "read again, merged again: the owner's K1 kept, the bridge's K2 written (%s %s | %s | %s)" % (c, r, k1, k2))

    print("== 4. the cron puts it back meanwhile")
    F.T["tally_post_jobs"].append(job("j4", "taken"))
    def requeued(j): j.update(status="waiting", taken_by=None, taken_at=None, attempts=1, message="Sent to the Tally computer again: it had not answered for a while.", row_version=j["row_version"] + 1)
    MEANWHILE["j4"] = requeued
    c, r = update("j4")
    x = row("j4")
    ok(x["status"] == "waiting" and x["taken_by"] is None and x["seq"] == 1 and x["message"].startswith("Sent to the Tally computer again"), "the requeue not written over (%s / %s)" % (x["status"], x["message"]))
    ok(c == 200 and r.get("requeued") is True and r.get("stale") is True, "answered requeued (%s %s)" % (c, r))

    print("== 5. already waiting (handed back): no report of the old copy")
    F.T["tally_post_jobs"].append(job("j5", "waiting", resend_only=["K2"], message="Handed back: K2 to be sent again"))
    n0 = patches("j5"); c, r = update("j5", status="done")
    ok(c == 200 and r.get("requeued") is True and row("j5")["status"] == "waiting" and row("j5")["message"] == "Handed back: K2 to be sent again" and patches("j5") == n0, "nothing written (%s %s)" % (c, r))

    print("== 6. a cloud without 174")
    j6 = job("j6", "taken"); j6.pop("row_version"); F.T["tally_post_jobs"].append(j6)
    n0 = patches("j6"); c, r = update("j6")
    ok(c == 200 and r == {"ok": True} and row("j6")["status"] == "running" and patches("j6") - n0 == 1, "written as before, once (%s %s)" % (c, r))

    print("== 7. handed to another bridge of this computer")
    F.T["tally_post_jobs"].append(job("j7", "taken", target_bridge=OTHER, taken_by=OTHER))
    n0 = patches("j7"); c, r = update("j7")
    ok(c == 403 and r.get("cancelled") is True and r.get("handedOver") is True and row("j7")["status"] == "taken" and patches("j7") == n0, "this bridge told to stop its copy; nothing written (%s %s)" % (c, r))
    F.T["tally_post_jobs"].append(job("j8", "waiting", target_bridge=OTHER, taken_by=None))
    c, r = update("j8")
    ok(c == 403 and not r.get("cancelled"), "a posting for the other bridge it never took: refused as before (%s %s)" % (c, r))
finally:
    fn.terminate()
    try: fn.wait(10)
    except Exception: fn.kill()
if fails: print("".join(log[-40:]))
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
