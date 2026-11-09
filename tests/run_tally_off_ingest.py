"""python3 run_tally_off_ingest.py - FinCom Bridge 2.5.11's tallyOff in tally-ingest (server/tally-cloud/index.ts under
Deno, against the stand-in for Supabase, fake_supabase.py). Made-up computer, bridge and Windows users only. Checks:
  1. tallyOff kept with tallyWhy "connection off", cleaned: a known reason, the folder names only (no path, 60 letters),
     a known tally.ini kind and mode, ports 1-65535, ISO times only, iniAfterStart true only when true, a known holder,
     another user's short name (40 letters at most) only for another user's Tally, ownPort, lastPort / lastAt;
     anything else dropped;
  2. an unknown reason, not an object, or tallyWhy not "connection off": no tallyOff.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "99999999-9999-9999-9999-999999992511"
DA, KA = "d2511000-0000-0000-0000-000000002511", "fcd_" + "e" * 48
GA = {"id": "go-aaaaaa251125", "computer": "PC-MADEUP", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.11"}
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.11"})
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
    base = {"version": "2.5.11", "bridge": GA, "kind": "beat", "tally": False, "open": [], "companies": [], "tallyWhy": "connection off"}
    print("== 1. kept, cleaned")
    off = {"reason": "clash", "folder": "TallyPrime", "iniKind": "virtualStore", "iniFolder": "TallyPrime", "mode": "Both", "port": 9000, "want": 9000,
           "iniAt": "2026-11-01T10:00:00Z", "startedAt": "2026-11-09T03:00:00Z", "iniAfterStart": False, "heldBy": "otherUser", "heldUser": "made-up-b" + "q" * 60,
           "ownPort": 9039, "lastPort": 9039, "lastAt": "2026-11-08T09:30:00Z", "secret": "x"}
    c, r = call(dict(base, tallyOff=off, tallyConnectSay="Your TallyPrime's port 9000 is used by made-up-b's Tally"))
    o = kept().get("tallyOff") or {}
    ok(c == 200 and o.get("reason") == "clash" and o.get("folder") == "TallyPrime" and o.get("iniKind") == "virtualStore" and o.get("mode") == "Both"
       and o.get("port") == 9000 and o.get("want") == 9000 and o.get("iniAt") == "2026-11-01T10:00:00Z" and o.get("startedAt") == "2026-11-09T03:00:00Z"
       and o.get("iniAfterStart") is False and o.get("heldBy") == "otherUser" and o.get("heldUser", "").startswith("made-up-b") and len(o["heldUser"]) == 40
       and o.get("ownPort") == 9039 and o.get("lastPort") == 9039 and o.get("lastAt") == "2026-11-08T09:30:00Z" and "secret" not in o, "1. kept (%s)" % o)
    c, r = call(dict(base, tallyOff={"reason": "reopen", "folder": "C:\\Users\\made-up-a\\TallyPrime" + "z" * 100, "iniKind": "made up", "mode": "<b>", "port": 70000, "want": "9000",
                                     "iniAt": "yesterday", "startedAt": 5, "iniAfterStart": "yes", "heldBy": "program", "heldUser": "made-up-b", "ownPort": -1, "lastPort": 0, "lastAt": "2026-11-08T09:30:00Z"}))
    o = kept().get("tallyOff") or {}
    ok(o.get("reason") == "reopen" and o.get("folder", "").startswith("TallyPrimez") and "Users" not in o.get("folder", "") and len(o.get("folder", "")) == 60 and o.get("iniKind") == "none" and o.get("mode") == ""
       and o.get("port") == 0 and o.get("want") == 0 and "iniAt" not in o and "startedAt" not in o and o.get("iniAfterStart") is False and o.get("heldBy") == "program"
       and "heldUser" not in o and "ownPort" not in o and "lastPort" not in o and "lastAt" not in o, "1. cleaned (%s)" % o)
    print("== 2. none")
    c, r = call(dict(base, tallyOff={"reason": "made up"}))
    ok("tallyOff" not in kept(), "2. an unknown reason: none (%s)" % kept().get("tallyOff"))
    c, r = call(dict(base, tallyOff="clash"))
    ok("tallyOff" not in kept(), "2. not an object: none (%s)" % kept().get("tallyOff"))
    c, r = call(dict(base, tallyWhy="another user", tallyOff={"reason": "mode"}))
    ok("tallyOff" not in kept() and kept().get("tallyWhy") == "another user", "2. not connection off: none (%s)" % kept().get("tallyOff"))
finally:
    fn.terminate()
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
