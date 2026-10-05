"""python3 run_post_target_server.py - FinCom Bridge 2.3.0 (one bridge for each Windows user on a shared server; migration 54):
tally-ingest hands a posting only to the bridge it names (tally_post_jobs.target_bridge), and a posting naming none to the
computer's main bridge as before. The real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for
Supabase (fake_supabase.py). Needs Deno (DENO, default: the deno on the PATH).
  1. the beat keeps each bridge's Windows user, its own port, its Tally's port and data folder (info.bridges[id]); it counts
     the postings this bridge may take (for it, or naming none), not those for another bridge;
  2. posts_take hands out the posting for this bridge first (the oldest), then one naming none; never one for another bridge;
  3. a posting for another bridge cannot be reported by this one (posts_update refused);
  4. "Changes only" (tally_bridge_prefs): the beat says notMain + changesOnly and counts none; posts_take is refused and the
     posting waits (a posting it took before the switch is still reported);
  5. a cloud without migration 54 (no tally_post_take_for): the hand-out as before (tally_post_take);
  6. review M3: a bridge id belongs to the first computer key that reported it: another key reporting it (an id copied from
     another user's settings) is refused, and nothing it says is kept; a cloud without tally_bridge_bind: as before."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "f-1"; KEY = "fcd_" + "b" * 48
RAVI = {"id": "go-bbbb000002", "computer": "NW144", "user": "NW144\\ravi", "mode": "main", "runMode": "user", "version": "2.3.0", "port": 9101}
OTHER = "go-cccc000003"
F.T["tally_devices"].append({"id": "d-2", "firm_id": FIRM, "name": "NW144 · ravi", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "w" * 64, "version": "2.3.0"})
def job(i, target, at): F.T["tally_post_jobs"].append({"id": i, "firm_id": FIRM, "device_id": "d-2", "company": "ZZ CO", "status": "waiting", "payload": {"vouchers": []}, "created_at": at, "target_bridge": target})
job("p-none", None, "2026-10-05T10:00:00Z")          # an older posting: the computer's main bridge
job("p-ravi", RAVI["id"], "2026-10-05T10:01:00Z")    # for ravi's bridge
job("p-other", OTHER, "2026-10-05T09:00:00Z")        # for another bridge (the oldest)
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
st = lambda i: next(j["status"] for j in F.T["tally_post_jobs"] if j["id"] == i)
BEAT = {"kind": "beat", "version": "2.3.0", "bridge": RAVI, "tally": True, "tallyState": "open", "open": ["ZZ CO"], "windowsUser": "NW144\\ravi", "bridgePort": 9101, "tallyPort": 9001, "dataFolder": "D:\\TallyData\\Ravi"}
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    dev = F.T["tally_devices"][0]
    c, r = call(BEAT)
    e = dev["info"].get("bridges", {}).get(RAVI["id"], {})
    ok(c == 200 and [e.get(k) for k in ("computer", "user", "port", "tallyPort", "dataFolder")] == ["NW144", "NW144\\ravi", 9101, 9001, "D:\\TallyData\\Ravi"],
       "1. the bridge's line: NW144 · NW144\\ravi, its port 9101, Tally on 9001, data folder D:\\TallyData\\Ravi (%s)" % {k: e.get(k) for k in ("computer", "user", "port", "tallyPort", "dataFolder")})
    b = dev["info"].get("beat", {})
    ok(b.get("tallyPort") == 9001 and b.get("dataFolder") == "D:\\TallyData\\Ravi" and b.get("windowsUser") == "NW144\\ravi", "1. the beat record says the same (%s)" % {k: b.get(k) for k in ("tallyPort", "dataFolder", "windowsUser")})
    ok(r.get("posts") == 2 and not r.get("notMain"), "1. the beat counts 2 postings for this bridge (its own and the one naming none), not the one for another bridge (%s)" % r.get("posts"))
    c, r = call({"kind": "posts_take", "version": "2.3.0", "bridge": RAVI})
    ok(c == 200 and (r.get("job") or {}).get("id") == "p-none", "2. the oldest it may take first: the posting naming none (%s)" % (r.get("job") or {}).get("id"))
    c, r = call({"kind": "posts_take", "version": "2.3.0", "bridge": RAVI})
    ok(c == 200 and (r.get("job") or {}).get("id") == "p-ravi", "2. then the posting for it (%s)" % (r.get("job") or {}).get("id"))
    c, r = call({"kind": "posts_take", "version": "2.3.0", "bridge": RAVI})
    ok(c == 200 and r.get("job") is None and st("p-other") == "waiting", "2. never the posting for another bridge: it waits (%s)" % st("p-other"))
    ok(any(x.get("p_bridge") == RAVI["id"] for x in F.ARGS.get("tally_post_take_for", [])), "2. through tally_post_take_for, naming the bridge")
    c, r = call({"kind": "posts_update", "version": "2.3.0", "bridge": RAVI, "id": "p-other", "status": "done"})
    ok(c == 403 and st("p-other") == "waiting", "3. a posting for another bridge cannot be reported by this one (%s %s)" % (c, r.get("error")))
    c, r = call({"kind": "posts_update", "version": "2.3.0", "bridge": RAVI, "id": "p-ravi", "status": "running", "done": 0, "results": []})
    ok(c == 200, "3. its own posting is reported as before (%s %s)" % (c, r.get("error")))
    # 4. changes only
    job("p-ravi2", RAVI["id"], "2026-10-05T11:00:00Z")
    F.T.setdefault("tally_bridge_prefs", []).append({"device_id": "d-2", "bridge_id": RAVI["id"], "firm_id": FIRM, "changes_only": True})
    c, r = call(BEAT)
    ok(c == 200 and r.get("posts") == 0 and r.get("notMain") is True and r.get("changesOnly") is True and "changes only" in r.get("error", "").lower(),
       "4. changes only: the beat counts none and says so (notMain, changesOnly: %s)" % r.get("error"))
    ok(dev["info"]["bridges"][RAVI["id"]].get("changesOnly") is True, "4. the bridge's line says changes only")
    c, r = call({"kind": "posts_take", "version": "2.3.0", "bridge": RAVI})
    ok(c == 403 and r.get("changesOnly") and r.get("notMain") and st("p-ravi2") == "waiting", "4. posts_take refused, the posting waits (%s)" % r.get("error"))
    c, r = call({"kind": "posts_update", "version": "2.3.0", "bridge": RAVI, "id": "p-ravi", "status": "running", "done": 0, "results": []})
    ok(c == 200, "4. a posting it took before the switch is still reported (not left running) (%s)" % c)
    F.T["tally_bridge_prefs"][0]["changes_only"] = False
    # 5. an older cloud: no tally_post_take_for
    F.NO_FN.add("tally_post_take_for")
    c, r = call({"kind": "posts_take", "version": "2.3.0", "bridge": RAVI})
    ok(c == 200 and (r.get("job") or {}).get("id") in ("p-other", "p-ravi2"), "5. without migration 54 the hand-out is as before (tally_post_take: %s)" % (r.get("job") or {}).get("id"))
    # 6. review M3: anshul's key (another tally_devices row) reporting ravi's bridge id
    KEY2 = "fcd_" + "c" * 48
    F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "NW144 · anshul", "key_hash": hashlib.sha256(KEY2.encode()).hexdigest(), "revoked": False, "info": {}, "wake_token": "v" * 64, "version": "2.3.0"})
    def call2(body):
        rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY2})
        try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
    F.NO_FN.discard("tally_post_take_for")
    job("p-ravi3", RAVI["id"], "2026-10-05T12:00:00Z")
    c, r = call2(dict(BEAT, bridge=dict(RAVI, user="NW144\\anshul")))
    d1 = next(d for d in F.T["tally_devices"] if d["id"] == "d-1")
    ok(c == 409 and RAVI["id"] not in (d1.get("info") or {}).get("bridges", {}), "6. another key reporting ravi's bridge id: refused (%s %s), not kept on its line" % (c, r.get("error")))
    c, r = call2({"kind": "posts_take", "version": "2.3.0", "bridge": RAVI})
    ok(c == 409 and st("p-ravi3") == "waiting", "6. nor given ravi's postings (%s)" % c)
    c, r = call(BEAT)
    ok(c == 200, "6. ravi's own key still beats (%s)" % c)
    F.NO_FN.add("tally_bridge_bind")
    c, r = call2(dict(BEAT, bridge=dict(RAVI, id="go-dddd00000d")))
    ok(c == 200, "6. a cloud without tally_bridge_bind: as before (%s)" % c)
finally:
    fn.kill()
    if fails: print("".join(log[-40:]))
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
