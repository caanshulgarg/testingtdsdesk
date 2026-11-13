"""python3 run_post_ok_ingest.py - FinCom Bridge 2.5.15 (item 1, the owner's approval of 13-Nov-2026) in tally-ingest:
post_ok, the bridge's read-only question before it sends each part of a posting it took to Tally, and offlineSends
(the parts it sent while the cloud could not be reached) kept with posts_update's timing. tally-ingest
(server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py). Made-up names only. Checks:
  1. a posting taken by this bridge, running: post true; nothing of the row written;
  2. stopped (stop_reason, migration 174): post false, stop "stopped", the reason as the words;
  3. cancelled; done / failed (nothing being checked): settled; not there (or another key's): gone;
  4. taken by another bridge, or queued for another bridge of this computer: notYours;
  5. done and being checked (checking): post false, stop "checking" (review L2: an owner may release or post it
     again), unless handed back to send some entries again (resend_only): post true; waiting (put back for this same
     bridge): post true;
  6. not the main bridge any more (another of the same Windows user chosen): notMain;
  7. a cloud without 174 (no stop_reason): read without it, as before;
  8. posts_update with offlineSends: kept in the timing; without it the timing as before;
  9. (review L3) posts_update of a posting another FinCom Bridge took (taken_by): answered cancelled (notYours), its
     acceptances stamped first, nothing of the row written.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, urllib.error, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "f-2515"; KEY = "fcd_" + "c" * 48
ME = {"id": "go-aaaa002515", "computer": "PC-MADEUP", "user": "PC-MADEUP\\madeup", "mode": "main", "runMode": "user", "version": "2.5.15", "port": 9101}
OTHER = "go-bbbb002515"
F.T["tally_devices"].append({"id": "d-2515", "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {"bridges": {ME["id"]: {"at": "2026-11-13T10:00:00Z"}}}, "version": "2.5.15"})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ HERON CO", "client_id": "c1", "device_id": "d-2515", "book_id": "bk-2515"})
def job(i, status, **kw):
    return dict({"id": i, "firm_id": FIRM, "device_id": "d-2515", "company": "ZZ HERON CO", "status": status, "checking": False, "seq": 1, "message": "as the cloud has it",
                 "results": [], "items": [], "target_bridge": ME["id"], "taken_by": ME["id"], "row_version": 0, "stop_reason": None,
                 "payload": {"vouchers": [{"id": "K1", "xml": "<VOUCHER/>"}]}}, **kw)
row = lambda i: next(j for j in F.T["tally_post_jobs"] if j["id"] == i)
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def ask(i): return call({"kind": "post_ok", "version": "2.5.15", "bridge": ME, "id": i})
patches = lambda: sum(1 for m, p in F.CALLS if m == "PATCH" and p.endswith("/tally_post_jobs"))
try:
    for _ in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    print("== 1. this bridge's, running")
    F.T["tally_post_jobs"].append(job("p1", "running"))
    n0 = patches(); c, r = ask("p1")
    ok(c == 200 and r == {"ok": True, "post": True}, "post true (%s %s)" % (c, r))
    ok(patches() == n0 and row("p1")["status"] == "running", "read only: nothing written")
    print("== 2. stopped")
    WHY = "Not posted: posting into Tally was stopped for ZZ Heron after this was queued. Allow it on the Tally page, then post again."
    F.T["tally_post_jobs"].append(job("p2", "running", stop_reason=WHY))
    c, r = ask("p2")
    ok(c == 200 and r.get("post") is False and r.get("stop") == "stopped" and r.get("error") == WHY, "post false, stopped, the reason (%s %s)" % (c, r))
    print("== 3. cancelled, settled, gone")
    for jid, st, chk, want in (("p31", "cancelled", False, "cancelled"), ("p32", "done", False, "settled"), ("p33", "failed", False, "settled")):
        F.T["tally_post_jobs"].append(job(jid, st, checking=chk))
        c, r = ask(jid)
        ok(c == 200 and r.get("post") is False and r.get("stop") == want, "%s (%s): %s (%s)" % (jid, st, want, r))
    F.T["tally_post_jobs"].append(job("p34", "running", device_id="d-another"))
    for jid in ("p-none", "p34"):
        c, r = ask(jid)
        ok(c == 200 and r.get("post") is False and r.get("stop") == "gone", "%s: gone (%s)" % (jid, r))
    print("== 4. another bridge's")
    F.T["tally_post_jobs"].append(job("p41", "running", taken_by=OTHER, target_bridge=None))
    F.T["tally_post_jobs"].append(job("p42", "taken", target_bridge=OTHER, taken_by=None))
    for jid in ("p41", "p42"):
        c, r = ask(jid)
        ok(c == 200 and r.get("post") is False and r.get("stop") == "notYours", "%s: notYours (%s)" % (jid, r))
    print("== 5. being checked; put back for this bridge")
    F.T["tally_post_jobs"].append(job("p51", "done", checking=True))
    c, r = ask("p51")
    ok(c == 200 and r.get("post") is False and r.get("stop") == "checking", "p51 held for checking: stop (%s)" % r)
    F.T["tally_post_jobs"].append(job("p53", "done", checking=True, resend_only=["K1"]))
    F.T["tally_post_jobs"].append(job("p52", "waiting", attempts=1, taken_at="2026-11-13T09:00:00Z"))
    for jid in ("p53", "p52"):
        c, r = ask(jid)
        ok(c == 200 and r.get("post") is True, "%s: post true (%s)" % (jid, r))
    print("== 6. not the main bridge any more")
    dev = F.T["tally_devices"][0]
    dev["main_bridge"] = OTHER; dev["info"]["bridges"][OTHER] = {"at": "2026-11-13T10:00:00Z", "user": ME["user"]}
    c, r = ask("p1")
    ok(c == 200 and r.get("post") is False and r.get("stop") == "notMain", "notMain (%s)" % r)
    dev.pop("main_bridge"); dev["info"]["bridges"].pop(OTHER, None)
    print("== 7. a cloud without 174")
    j7 = job("p7", "running"); j7.pop("stop_reason"); F.T["tally_post_jobs"].append(j7)
    F.NO_COL["tally_post_jobs"] = {"stop_reason"}
    c, r = ask("p7")
    ok(c == 200 and r.get("post") is True, "read without stop_reason: post true (%s %s)" % (c, r))
    F.NO_COL.pop("tally_post_jobs", None)
    print("== 8. offlineSends kept with the timing")
    F.T["tally_post_jobs"].append(job("p8", "taken"))
    c, r = call({"kind": "posts_update", "version": "2.5.15", "bridge": ME, "id": "p8", "status": "running", "done": 1, "message": "Posting 1 entry", "seq": 2, "updatedAt": "2026-11-13T10:00:00Z",
                 "results": [{"id": "K1", "ok": True, "byReply": True, "state": "posted"}], "items": [{"id": "K1", "kind": "voucher", "state": "posted"}], "checking": False,
                 "reqs": [{"n": 1, "seconds": 0.2, "created": 1}], "secondsTotal": 0.2, "offlineSends": 1})
    tm = row("p8").get("timing") or {}
    ok(c == 200 and tm.get("offlineSends") == 1 and tm.get("secondsTotal") == 0.2, "kept in the timing (%s %s %s)" % (c, r, tm))
    ok(any("could not be reached" in l for l in log), "logged")
    F.T["tally_post_jobs"].append(job("p81", "taken"))
    c, r = call({"kind": "posts_update", "version": "2.5.15", "bridge": ME, "id": "p81", "status": "running", "done": 0, "message": "Posting", "seq": 2, "results": [], "items": [], "reqs": [], "secondsTotal": 0})
    tm = row("p81").get("timing") or {}
    ok(c == 200 and "offlineSends" not in tm, "without it: the timing as before (%s)" % tm)
    print("== 9. posts_update of another bridge's posting")
    F.T["tally_post_jobs"].append(job("p9", "running", taken_by=OTHER))
    n0 = patches()
    c, r = call({"kind": "posts_update", "version": "2.5.15", "bridge": ME, "id": "p9", "status": "running", "done": 1, "message": "Posting", "seq": 2,
                 "results": [{"id": "K1", "ok": False, "accepted": True, "lastVchId": "91", "message": "Tally replied CREATED 1 LASTVCHID 91"}], "items": [{"id": "K1", "state": "unknown"}]})
    st = [a for a in F.ARGS.get("tally_post_id_accept", []) if a.get("p_job") == "p9"]
    ok(c == 200 and r.get("cancelled") is True and r.get("notYours") is True and st and row("p9")["status"] == "running" and row("p9")["taken_by"] == OTHER and patches() == n0,
       "answered cancelled, stamped first, nothing written (%s %s, %d stamps)" % (c, r, len(st)))
finally:
    fn.terminate()
    try: fn.wait(10)
    except Exception: fn.kill()
if fails: print("".join(log[-40:]))
print("\n%s: %d" % ("FAILED" if fails else "ALL PASSED", len(fails)))
raise SystemExit(1 if fails else 0)
