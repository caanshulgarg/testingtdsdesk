"""python3 run_beat_history.py - tally-ingest keeps each computer's connection history for 24 hours (go-bridge, review of
01-Oct-2026), from its heartbeats: a gap of three missed beats or more is "offline from - to", a shorter one is not;
Tally's state changes (open / busy / closed) and the companies opened and closed are noted; older than a day is dropped.
The real function under Deno against fake_supabase.py; the time between beats is made by moving the last beat back."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
KEY = "fcd_" + "a" * 48
F.T["tally_devices"].append({"id": "d-1", "firm_id": "f-1", "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "w" * 64})
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
threading.Thread(target=lambda: [None for l in fn.stdout], daemon=True).start()
def beat(**b):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(dict({"kind": "beat", "version": "2.0.0", "every": 30, "tally": True, "tallyState": "open", "open": ["ZZ CO"]}, **b)).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    return json.loads(urllib.request.urlopen(rq, timeout=30).read())
dev = F.T["tally_devices"][0]
def back(sec):   # the last beat moved back in time, as if the next one came that much later
    t = datetime.datetime.fromisoformat(dev["info"]["beat"]["at"].replace("Z", "+00:00")) - datetime.timedelta(seconds=sec)
    dev["info"]["beat"]["at"] = t.isoformat().replace("+00:00", "Z")
def hist(): return dev["info"].get("history", [])
try:
    for i in range(60):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    beat()
    ok([e["kind"] + ":" + e["state"] for e in hist()] == ["bridge:online"], "the first beat: the bridge online")
    back(150); beat()          # 2.5 minutes between beats of 30 s: five missed: offline
    ok(any(e["kind"] == "bridge" and e["state"] == "offline" and e.get("to") for e in hist()), "a gap of 2.5 minutes (beats every 30 s): offline from - to")
    n = len(hist()); back(80); beat()    # 80 s: less than three missed beats and a little
    ok(len(hist()) == n, "a gap of 80 s: not offline (reconnecting at most)")
    beat(tallyState="busy", busySince="2026-10-01T12:00:00")
    ok(hist()[-1]["kind"] == "tally" and hist()[-1]["state"] == "busy" and dev["info"]["beat"]["tallyState"] == "busy", "Tally busy: noted, and kept in the beat")
    beat(tallyState="open"); beat(tallyState="closed", tally=False, open=[])
    ok([e["state"] for e in hist() if e["kind"] == "tally"][-2:] == ["open", "closed"], "Tally open again, then closed")
    ok(any(e["kind"] == "company" and e["state"] == "closed" and e["name"] == "ZZ CO" for e in hist()), "the company closed in Tally")
    beat(open=["ZZ CO"])
    ok(any(e["kind"] == "company" and e["state"] == "open" for e in hist()), "and opened again")
    old = {"kind": "tally", "state": "busy", "at": "2020-01-01T00:00:00Z"}; dev["info"]["history"].insert(0, old); beat()
    ok(old not in hist(), "what is older than 24 hours is dropped")
    beat(every=None, version="1.15.0")
    ok(dev["info"]["beat"]["every"] == 60, "a bridge that does not say how often it beats (1.15.0): every 60 s")
finally:
    fn.kill()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
