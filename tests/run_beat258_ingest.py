"""python3 run_beat258_ingest.py - FinCom Bridge 2.5.8's new port fields in tally-ingest (server/tally-cloud/index.ts
under Deno, against the stand-in for Supabase, fake_supabase.py). Made-up computer and bridge only. Checks:
  1. each port's askedAt (when Tally last answered the company list, the bridge's local time) and list ("named",
     "empty", "emptyHeld", "kept", "never") kept;
  2. anything else in them dropped (a made-up list, a time not in the bridge's form), and an older bridge's port
     (without them) as before.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "99999999-9999-9999-9999-999999992580"
DA, KA = "d2580000-0000-0000-0000-000000000258", "fcd_" + "c" * 48
GA = {"id": "go-aaaaaa258258", "computer": "PC-MADEUP", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.8"}
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.8"})
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def kept():
    d = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    return ((d.get("info") or {}).get("beat") or {})
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    base = {"version": "2.5.8", "bridge": GA, "kind": "beat", "tally": True, "open": [], "companies": []}
    port = {"port": 9041, "ok": True, "skipped": False, "n": 0, "error": "", "state": "open", "reason": "open"}
    print("== 1. askedAt and list kept")
    c, r = call(dict(base, ports=[dict(port, askedAt="2026-11-08T07:16:03", list="empty"), dict(port, port=9042, askedAt="", list="never")]))
    ps = kept().get("ports") or []
    ok(c == 200 and len(ps) == 2 and ps[0].get("askedAt") == "2026-11-08T07:16:03" and ps[0].get("list") == "empty" and ps[1].get("list") == "never" and "askedAt" not in ps[1], "1. kept (%s)" % ps)
    for l in ("named", "kept", "emptyHeld"):
        call(dict(base, ports=[dict(port, askedAt="2026-11-08T07:27:00", list=l)]))
        ok((kept().get("ports") or [{}])[0].get("list") == l, "1. list %s kept" % l)
    print("== 2. anything else dropped")
    c, r = call(dict(base, ports=[dict(port, askedAt="<b>07:16</b>", list="made up")]))
    p = (kept().get("ports") or [{}])[0]
    ok("askedAt" not in p and "list" not in p and p.get("reason") == "open", "2. dropped (%s)" % p)
    c, r = call(dict(base, ports=[port]))
    p = (kept().get("ports") or [{}])[0]
    ok("askedAt" not in p and "list" not in p and p.get("port") == 9041 and p.get("n") == 0, "2. an older bridge's port as before (%s)" % p)
finally:
    fn.terminate()
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
