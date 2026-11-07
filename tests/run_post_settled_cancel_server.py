"""python3 run_post_settled_cancel_server.py - next-fix-first-read (07-Nov-2026, staging): a posting the cloud has settled
(done or failed, nothing being checked) is answered in posts_update with cancelled: true as well, so the bridge stops its
own copy of it. Staging: a posting failed in the cloud on 05-Nov ("did not finish after 5 tries") lived on the computer,
resumed by itself and waiting for Tally, and held that computer's ledger read behind it for days ("a posting into Tally
is going on"); bridge 2.5.5 stops a job only on cancelled or gone. tally-ingest (server/tally-cloud/index.ts) under Deno
against the stand-in for Supabase (fake_supabase.py). Made-up names only. Checks:
  1. failed in the cloud: the bridge's update answered {stale, settled, status failed, cancelled}; the row unchanged;
  2. done in the cloud: answered cancelled too; the row stays done, its results and message unchanged (never re-sent,
     never marked otherwise), whatever the bridge says (failed, running);
  3. done but being checked: not settled, not cancelled; the update is taken as before;
  4. a posting still going in the cloud (taken): the update taken as before, no cancelled;
  5. cancelled in FinCom and gone: as before.
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
FIRM = "f-1"; KEY = "fcd_" + "d" * 48
ME = {"id": "go-aaaa000077", "computer": "PC-MADEUP", "user": "PC-MADEUP\\madeup", "mode": "main", "runMode": "user", "version": "2.5.5", "port": 9101}
F.T["tally_devices"].append({"id": "d-77", "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {"bridges": {ME["id"]: {"at": "2026-11-07T10:00:00Z"}}}, "version": "2.5.5"})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ MADEUP CO", "client_id": "c1", "device_id": "d-77", "book_id": "bk-77"})
DONE_RES = [{"id": "K1", "ok": True, "byReply": True, "vchId": "501"}]
def job(i, status, **kw):
    return dict({"id": i, "firm_id": FIRM, "device_id": "d-77", "company": "ZZ MADEUP CO", "status": status, "checking": False, "seq": 3, "message": "as the cloud has it",
                 "results": [], "items": [], "payload": {"vouchers": [{"id": "K1", "xml": "<VOUCHER><NARRATION>TDSDesk:K1</NARRATION></VOUCHER>"}]}}, **kw)
F.T["tally_post_jobs"] += [job("j-failed", "failed", message="The Tally computer did not finish this posting after 5 tries."),
                           job("j-done", "done", message="Posted 1 of 1", results=copy.deepcopy(DONE_RES), items=[{"id": "K1", "state": "posted"}]),
                           job("j-checking", "done", checking=True), job("j-going", "taken"), job("j-cancel", "cancelled")]
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def row(i): return next(j for j in F.T["tally_post_jobs"] if j["id"] == i)
def upd(i, status, **kw):
    return call(dict({"kind": "posts_update", "version": "2.5.5", "bridge": ME, "id": i, "status": status, "done": 0, "message": "Waiting for Tally: ZZ MADEUP CO is not open",
                      "results": [], "items": [{"id": "K1", "state": "waiting"}], "seq": 9, "updatedAt": "2026-11-07T11:40:00Z"}, **kw))
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    print("== 1. failed in the cloud")
    before = copy.deepcopy(row("j-failed"))
    c, r = upd("j-failed", "taken")
    ok(c == 200 and r.get("cancelled") is True and r.get("settled") is True and r.get("status") == "failed", "1. answered settled and cancelled (%s)" % r)
    ok(row("j-failed") == before, "1. the row unchanged (%s)" % {k: row("j-failed").get(k) for k in ("status", "message", "seq")})
    print("== 2. done in the cloud")
    before = copy.deepcopy(row("j-done"))
    for st in ("failed", "running", "done"):
        c, r = upd("j-done", st, results=[{"id": "K1", "ok": False, "message": "not sent"}])
        ok(c == 200 and r.get("cancelled") is True and r.get("status") == "done", "2. a %s update of a done posting: cancelled, said done (%s)" % (st, r))
    ok(row("j-done") == before, "2. the done row unchanged: status, results, message (%s)" % {k: row("j-done").get(k) for k in ("status", "results", "message")})
    print("== 3. done, being checked")
    c, r = upd("j-checking", "done", done=1, message="Posted 1 of 1", results=[{"id": "K1", "ok": True, "byReply": True, "vchId": "502"}])
    ok(c == 200 and not r.get("cancelled") and not r.get("settled"), "3. not cancelled (%s)" % r)
    print("== 4. still going")
    c, r = upd("j-going", "taken")
    ok(c == 200 and not r.get("cancelled") and row("j-going").get("message", "").startswith("Waiting for Tally"), "4. taken as before (%s | %s)" % (r, row("j-going").get("message")))
    print("== 5. cancelled, gone")
    c, r = upd("j-cancel", "taken")
    ok(r.get("cancelled") is True, "5. cancelled in FinCom: cancelled (%s)" % r)
    c, r = upd("j-none", "taken")
    ok(r.get("gone") is True, "5. no such posting: gone (%s)" % r)
finally:
    fn.terminate()
if fails: print("".join(log[-30:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
