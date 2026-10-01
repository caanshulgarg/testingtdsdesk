"""python3 run_shadow_server.py - tally-ingest's shadow calls (branch go-bridge): FinCom Bridge 2.0.0 in test mode, beside
bridge 1.15.0 with the same computer key, sends marked shadow, and nothing it sends changes what 1.15.0 keeps:
its days are compared with the kept ones (same / differ / new) and not stored; its heartbeat is noted apart and does not
take "Update now"; it is never handed a posting. The real cloud function (server/tally-cloud/index.ts) under Deno against
the stand-in for Supabase (fake_supabase.py). Needs Deno (DENO, default: the deno on the PATH)."""
import os, sys, json, time, gzip, base64, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F, make_fake_books
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, CID = "f-1", "b-1", "c-1"; KEY = "fcd_" + "a" * 48
F.T["clients"].append({"id": CID, "firm_id": FIRM, "name": "ZZ TEST", "tally_name": "ZZ CO", "gstin": "", "deleted": False})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-01T00:00:00Z"})
F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "w" * 64,
                             "version": "1.15.0", "want_update_at": "2026-10-01T10:00:00Z", "want_sent_at": None})
F.T["tally_post_jobs"].append({"id": "p-1", "firm_id": FIRM, "device_id": "d-1", "company": "ZZ CO", "status": "waiting", "payload": {"vouchers": []}, "created_at": "2026-10-01T10:00:00Z"})
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def gz(t): return base64.b64encode(gzip.compress(t.encode())).decode()
data = make_fake_books.main(os.path.join(HERE, "out", "fakebooks"))
text = open(os.path.join(data, "DayBook.xml"), encoding="utf-16").read()
import re
def day(d):
    return "".join("<TALLYMESSAGE>" + m + "</TALLYMESSAGE>" for m in re.findall(r"<VOUCHER\b[\s\S]*?</VOUCHER>", text) if "<DATE>%s</DATE>" % d in m)
D1, D2, D3 = "20260302", "20260303", "20260304"
try:
    for i in range(60):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    c, r = call({"kind": "days", "company": "ZZ CO", "days": [{"day": D1, "gz": gz(day(D1))}, {"day": D2, "gz": gz(day(D2))}], "version": "1.15.0"})
    ok(c == 200 and r["done"] == [D1, D2], "bridge 1.15.0 sends two days: kept (%s)" % r.get("done"))
    kept, n_days = dict(F.FILES), len(F.DAYS)
    c, r = call({"kind": "days", "company": "ZZ CO", "shadow": True, "version": "2.0.0", "days": [{"day": D1, "gz": gz(day(D1))}, {"day": D2, "b64": base64.b64encode(day(D2).replace("<AMOUNT>", "<AMOUNT>1").encode()).decode()}, {"day": D3, "gz": gz(day(D3))}]})
    ok(c == 200 and r.get("shadow") and r["same"] == [D1] and r["differ"] == [D2] and r["new"] == [D3], "the Go bridge's days (shadow): one the same, one different, one not kept yet (%s)" % json.dumps({k: r.get(k) for k in ("same", "differ", "new")}))
    ok(F.FILES == kept and len(F.DAYS) == n_days, "and nothing is stored or read into the copy: the kept days are 1.15.0's")
    dev = F.T["tally_devices"][0]
    ok(dev.get("version") == "1.15.0", "the computer's version stays 1.15.0's (%s)" % dev.get("version"))
    c, r = call({"kind": "beat", "shadow": True, "version": "2.0.0", "tally": True, "open": ["ZZ CO"]})
    ok(c == 200 and r.get("updateNow") is False and r.get("posts") == 0 and r.get("wake", {}).get("topic") == "tb-" + "w" * 64, "its heartbeat: no Update now and no postings for it, the same wake-up channel")
    ok(dev["info"].get("shadow", {}).get("version") == "2.0.0" and "beat" not in dev["info"] and not dev.get("want_sent_at"), "noted apart (info.shadow); 1.15.0's heartbeat and Update now untouched")
    c, r = call({"kind": "posts_take", "shadow": True})
    ok(c == 403 and F.T["tally_post_jobs"][0]["status"] == "waiting", "it is never handed a posting (403); the posting still waits for 1.15.0")
    c, r = call({"kind": "posts_update", "shadow": True, "id": "p-1", "status": "done"})
    ok(c == 403 and F.T["tally_post_jobs"][0]["status"] == "waiting", "nor can it report one")
    c, r = call({"kind": "beat", "version": "1.15.0", "tally": True})
    ok(c == 200 and r.get("updateNow") is True and r.get("posts") == 1, "1.15.0's own heartbeat then gets Update now and the posting")
    c, r = call({"kind": "ledgers", "shadow": True, "company": "ZZ CO", "from": "20260301", "openAsOn": "20260228", "ledgers": [["X", "Y", "0"]]})
    ok(c == 200 and r.get("shadow"), "its ledgers: answered, not kept")
    c, r = call({"kind": "state", "shadow": True, "company": "ZZ CO", "state": {"phase": "live"}})
    ok(c == 200 and r.get("shadow"), "its state: answered, not kept")
    c, r = call({"kind": "companies", "shadow": True, "companies": [{"name": "ZZ CO"}, {"name": "OTHER"}]})
    ok(c == 200 and r["links"] == {"ZZ CO": True, "OTHER": False} and not any(x["company"] == "OTHER" for x in F.T["tally_companies"]), "its companies: told which are linked, nothing recorded")
finally:
    fn.kill()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
