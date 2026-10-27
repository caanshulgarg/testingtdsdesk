"""python3 run_bridge_1146_server.py - (10-Oct-2026, docs/GO-LIVE.md) the PowerShell bridge 1.14.6 that live's computers run
(Build 199) against tally-ingest as it is in this repository (staging's v43): every call 1.14.6 makes, with the body
it sends (bridge/cloud.ps1 at commit f447539fe: Invoke-Cloud adds only "version"; no "bridge" object, no "shadow"), and
the fields of each answer that 1.14.6 reads. The real cloud function (server/tally-cloud/index.ts) under Deno against the
stand-in for Supabase (fake_supabase.py). Needs Deno (DENO, default: the deno on the PATH).
Calls: hello (connect), companies (links), ledgers, days (gz), state, beat (updateNow, posts), posts_take (job: id,
company, payload.masters / vouchers / ledger), posts_update (running, then done with results)."""
import os, sys, json, time, gzip, base64, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
V = "1.14.6"
FIRM, BOOK, CID = "f-1", "b-1", "c-1"; KEY = "fcd_" + "e" * 48

F.T["clients"].append({"id": CID, "firm_id": FIRM, "name": "ZZ TEST", "tally_name": "ZZ CO", "gstin": "", "deleted": False})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-01T00:00:00Z"})
F.T["tally_books"].append({"book_id": BOOK, "firm_id": FIRM, "client_id": CID, "company": "ZZ CO", "from_date": None})
F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "w" * 64,
                             "version": V, "want_update_at": "2026-10-10T10:00:00Z", "want_sent_at": None})
VCH = {"id": "e-1", "xml": "<VOUCHER><NARRATION>Rent | TDSDesk:e1</NARRATION></VOUCHER>"}
F.T["tally_post_jobs"].append({"id": "p-1", "firm_id": FIRM, "device_id": "d-1", "client_id": CID, "company": "ZZ CO", "status": "waiting",
                               "payload": {"vouchers": [VCH], "masters": [], "ledger": ""}, "created_at": "2026-10-10T10:00:00Z"})
# tally_ingest_state (server/tally-cloud/migration.sql, Build 199) is not in the stand-in: it keeps the state on the book
_rpc = F.rpc
def rpc(fn, a):
    if fn == "tally_ingest_state":
        b = next((x for x in F.T["tally_books"] if x["book_id"] == a["p_book"]), None)
        if b is not None: b["state"], b["state_at"] = a["p_state"], time.strftime("%Y-%m-%dT%H:%M:%SZ")
        return None
    return _rpc(fn, a)
F.rpc = rpc
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    body = dict(body, version=V)          # Invoke-Cloud: $body['version'] = $BridgeVersion, nothing else added
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def gz(t): return base64.b64encode(gzip.compress(t.encode())).decode()
DAY = ("<ENVELOPE><TALLYMESSAGE><VOUCHER REMOTEID=\"g-1\" VCHTYPE=\"Sales\"><DATE>20261009</DATE><GUID>g-1</GUID><ALTERID>7</ALTERID>"
       "<VOUCHERNUMBER>1</VOUCHERNUMBER><PARTYLEDGERNAME>Alpha Traders</PARTYLEDGERNAME>"
       "<ALLLEDGERENTRIES.LIST><LEDGERNAME>Alpha Traders</LEDGERNAME><AMOUNT>-1180.00</AMOUNT></ALLLEDGERENTRIES.LIST>"
       "<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>1180.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE></ENVELOPE>")
try:
    for i in range(240):   # up to 120 s: Deno may still be fetching the function's imports on a fresh machine
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    dev = F.T["tally_devices"][0]
    print("== bridge %s: connect and send the books" % V)
    c, r = call({"kind": "hello", "info": {"computer": "OFFICE-PC", "user": "accounts"}})
    ok(c == 200 and r.get("device") == "OFFICE-PC" and "firm" in r, "hello (Connect): 200 with firm and device, as Connect-Cloud reads (%s %s)" % (c, r))
    c, r = call({"kind": "companies", "companies": [{"name": "ZZ CO", "gstin": ""}, {"name": "NOT LINKED", "gstin": ""}]})
    ok(c == 200 and isinstance(r.get("links"), dict) and r["links"].get("ZZ CO") is True, "companies: 200 with links, ZZ CO linked (%s %s)" % (c, r))
    c, r = call({"kind": "ledgers", "company": "ZZ CO", "from": "20260401", "openAsOn": "20260331", "ledgers": [["Alpha Traders", "Sundry Debtors", "0"], ["Sales", "Sales Accounts", "0"]]})
    ok(c == 200, "ledgers (no groups, as 1.14.6 sends): 200 (%s %s)" % (c, r))
    c, r = call({"kind": "days", "company": "ZZ CO", "days": [{"day": "20261009", "gz": gz(DAY)}]})
    ok(c == 200 and [str(x) for x in r.get("done", [])] == ["20261009"] and not r.get("bad"), "days (gz): 200, done lists the day, nothing bad (%s %s)" % (c, r))
    c, r = call({"kind": "state", "company": "ZZ CO", "state": {"phase": "in step", "at": "2026-10-10T10:00:00Z"}})
    ok(c == 200 and (F.T["tally_books"][0].get("state") or {}).get("phase") == "in step", "state: 200, kept on the book (%s %s)" % (c, r))
    print("== the heartbeat and the posting queue")
    c, r = call({"kind": "beat", "tally": True, "open": ["ZZ CO"], "companies": [{"name": "ZZ CO", "open": True, "at": "2026-10-10T10:00:00Z", "phase": "in step", "waiting": 0}],
                 "updating": False, "dailyAt": "19:00", "lastRun": "2026-10-09T19:00:00Z"})
    ok(c == 200 and int(r.get("posts") or 0) == 1, "beat: 200, posts = 1 (the waiting posting) (%s %s)" % (c, r))
    ok(r.get("updateNow") is True, "beat: updateNow true (Update now was pressed) (%s)" % r.get("updateNow"))
    ok(dev.get("version") == V and dev.get("last_seen"), "the computer's version and last seen are kept (%s)" % dev.get("version"))
    c, r = call({"kind": "posts_take"})
    j = r.get("job") or {}
    ok(c == 200 and j.get("id") == "p-1" and j.get("company") == "ZZ CO", "posts_take: 200 with the job, its id and company (%s %s)" % (c, json.dumps(r)[:300]))
    ok(isinstance(j.get("payload"), dict) and [v.get("id") for v in j["payload"].get("vouchers", [])] == ["e-1"], "the job's payload carries the vouchers 1.14.6 posts (%s)" % json.dumps(j.get("payload"))[:200])
    job = F.T["tally_post_jobs"][0]
    ok(job["status"] == "taken", "the posting is taken (%s)" % job["status"])
    c, r = call({"kind": "posts_update", "id": "p-1", "status": "running", "done": 0, "message": "Checking Tally for FinCom's IDs", "results": [], "checking": True})
    ok(c == 200 and job["status"] == "running", "posts_update running: 200, the job running (%s %s %s)" % (c, r, job["status"]))
    res = [{"id": "e-1", "kind": "voucher", "ok": True, "verified": True, "message": "", "vchNumber": "26301", "vchType": "Journal", "guid": "g-77", "masterId": "901",
            "vchDate": "20261009", "optional": False, "alreadyThere": False}]
    c, r = call({"kind": "posts_update", "id": "p-1", "status": "done", "done": 1, "message": "1 of 1 posted", "results": res, "checking": False})
    ok(c == 200 and job["status"] == "done", "posts_update done with 1.14.6's result fields: 200, the job done (%s %s %s)" % (c, r, job["status"]))
    c, r = call({"kind": "beat", "tally": True, "open": ["ZZ CO"], "companies": [], "updating": False, "dailyAt": "19:00", "lastRun": ""})
    ok(c == 200 and int(r.get("posts") or 0) == 0, "the next beat: nothing waiting (%s %s)" % (c, r))
finally:
    fn.terminate()
    errs = [l for l in log if "error" in l.lower() or "uncaught" in l.lower()]
    if errs: print("  (function log: %s)" % " | ".join(x.strip() for x in errs[:8]))
print("\n%d check(s) failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
