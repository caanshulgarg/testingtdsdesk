"""python3 run_beat254_ingest.py - FinCom Bridge 2.5.4's new beat fields in tally-ingest (server/tally-cloud/index.ts
under Deno, against the stand-in for Supabase, fake_supabase.py). Made-up computer and bridge only. Checks:
  1. the beat's update (why a bridge did or did not update) kept, cleaned: checked, message (200 letters at most),
     offered (a version only), applying, checking, noAutoUpdate, next; anything else dropped; not an object: none;
  2. tallyWhy "connection off" kept (an unknown reason still dropped), tallyConnectSay with it;
  3. tallyIni[].connect "off; shared by every user of this computer, not changed" and connectWhy (300 letters at most) kept;
     (2.5.16) the state "shared" kept with its words.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "99999999-9999-9999-9999-999999992540"
DA, KA = "d2540000-0000-0000-0000-000000000254", "fcd_" + "c" * 48
GA = {"id": "go-aaaaaa254254", "computer": "PC-MADEUP", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.4"}
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.4"})
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
SHARED = "off; shared by every user of this computer, not changed"
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    base = {"version": "2.5.4", "bridge": GA, "kind": "beat", "tally": False, "open": [], "companies": []}
    print("== 1. update")
    c, r = call(dict(base, update={"checked": "2026-11-04T10:00:00", "message": "Version 2.5.5 is available but not approved for this computer yet" + "x" * 400,
                                   "offered": "2.5.5", "applying": False, "checking": True, "noAutoUpdate": True, "next": "2026-11-04T16:02:00Z", "secret": "y"}))
    u = kept().get("update") or {}
    ok(c == 200 and u.get("checked") == "2026-11-04T10:00:00" and u.get("offered") == "2.5.5" and u.get("checking") is True and u.get("noAutoUpdate") is True
       and u.get("applying") is False and u.get("next") == "2026-11-04T16:02:00Z" and len(u.get("message", "")) == 200 and "secret" not in u, "1. kept, cleaned (%s)" % u)
    c, r = call(dict(base, update={"offered": "<script>", "applying": "yes"}))
    u = kept().get("update") or {}
    ok(u.get("offered") == "" and u.get("applying") is False, "1. a version only, true only when true (%s)" % u)
    c, r = call(dict(base, update="2.5.5"))
    ok("update" not in kept(), "1. not an object: none (%s)" % kept().get("update"))
    print("== 2. tallyWhy connection off")
    say = "Your Tally's connection is off. In TallyPrime: F1 Help > Settings > Connectivity > TallyPrime acts as: Both, then close and reopen Tally."
    c, r = call(dict(base, tallyWhy="connection off", tallyConnectSay=say))
    ok(kept().get("tallyWhy") == "connection off" and kept().get("tallyConnectSay") == say, "2. kept (%s)" % {k: kept().get(k) for k in ("tallyWhy", "tallyConnectSay")})
    c, r = call(dict(base, tallyWhy="made up"))
    ok("tallyWhy" not in kept(), "2. an unknown reason dropped (%s)" % kept().get("tallyWhy"))
    print("== 3. tally.ini")
    why = "Tally's connection is off. Every user of this computer shares this TallyPrime's settings, so FinCom does not change them: ask the computer's administrator to give each user's Tally its own port."
    c, r = call(dict(base, tallyIni=[{"path": r"C:\Program Files\TallyPrime\tally.ini", "state": "already", "connect": SHARED, "connectWhy": why + "z" * 400, "why": why, "serverPort": 9000},
                                     {"path": r"C:\Program Files\TallyPrime7\tally.ini", "state": "already", "connect": "made up"}]))
    ti = kept().get("tallyIni") or []
    ok(len(ti) == 2 and ti[0].get("connect") == SHARED and ti[0].get("connectWhy", "").startswith("Tally's connection is off") and len(ti[0]["connectWhy"]) == 300
       and ti[0].get("serverPort") == 9000 and "connect" not in ti[1] and "connectWhy" not in ti[1], "3. kept, cleaned (%s)" % ti)
    # bridge 2.5.16: "shared" (a tally.ini every user shares, FinCom's add-on line not added) kept with its words
    c, r = call(dict(base, tallyIni=[{"path": r"C:\Program Files\TallyPrime\tally.ini", "state": "shared", "why": "load it in your own Tally"}]))
    ti = kept().get("tallyIni") or []
    ok(len(ti) == 1 and ti[0].get("state") == "shared" and ti[0].get("why") == "load it in your own Tally", "3. 2.5.16 shared kept (%s)" % ti)
finally:
    fn.terminate()
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
