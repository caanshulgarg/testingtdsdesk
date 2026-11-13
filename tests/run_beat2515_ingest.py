"""python3 run_beat2515_ingest.py - FinCom Bridge 2.5.15's beat fields in tally-ingest (server/tally-cloud/index.ts under
Deno, against the stand-in for Supabase, fake_supabase.py). Made-up computer and bridge only. Checks:
  1. item 5: the beat's update.failed (the update the bridge could not put in place) kept, cleaned: version and from
     (versions only), step (download, sha, signature, apply; else other), words (300 letters at most), at, tries;
     anything else dropped; without a version: none; without failed: the update as before (no failed).
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "99999999-9999-9999-9999-999999992515"
DA, KA = "d2515000-0000-0000-0000-000000002515", "fcd_" + "d" * 48
GA = {"id": "go-aaaaaa251525", "computer": "PC-MADEUP", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.15"}
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.15"})
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
    base = {"version": "2.5.15", "bridge": GA, "kind": "beat", "tally": False, "open": [], "companies": []}
    up = {"checked": "2026-11-13T10:00:00", "message": "The update could not be put in place", "offered": "2.5.16", "applying": False, "checking": False, "noAutoUpdate": False, "next": "2026-11-13T10:04:00Z"}
    print("== 1. update.failed")
    c, r = call(dict(base, update=dict(up, failed={"version": "2.5.16", "from": "2.5.15", "step": "apply", "words": "the program file is held by another program" + "w" * 400,
                                                   "at": "2026-11-13T10:00:01Z", "tries": 3, "secret": "y"})))
    f = (kept().get("update") or {}).get("failed") or {}
    ok(c == 200 and f.get("version") == "2.5.16" and f.get("from") == "2.5.15" and f.get("step") == "apply" and len(f.get("words", "")) == 300 and f.get("tries") == 3
       and f.get("at") == "2026-11-13T10:00:01Z" and "secret" not in f, "kept, cleaned (%s)" % f)
    c, r = call(dict(base, update=dict(up, failed={"version": "2.5.16", "from": "<b>", "step": "made up", "tries": "many"})))
    f = (kept().get("update") or {}).get("failed") or {}
    ok(f.get("step") == "other" and f.get("from") == "" and f.get("tries") == 0, "a step it does not know: other; versions only (%s)" % f)
    c, r = call(dict(base, update=dict(up, failed={"version": "<script>", "step": "apply"})))
    ok("failed" not in (kept().get("update") or {}), "without a version: none (%s)" % kept().get("update"))
    c, r = call(dict(base, update=up))
    u = kept().get("update") or {}
    ok("failed" not in u and u.get("offered") == "2.5.16", "without failed: as before (%s)" % u)
finally:
    fn.terminate()
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
