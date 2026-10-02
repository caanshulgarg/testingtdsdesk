"""python3 run_bridge_control_server.py - (02-Oct-2026, plan items 10-12) tally-ingest's beat and the bridge control of
migration-35: the real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase
(fake_supabase.py). Needs Deno (DENO, default: the deno on the PATH, or /opt/deno/deno).
Checks: the beat keeps the bridge's request timings (reqs) and its own stop (readStopped), cleaned, in info.beat and in
the bridge's entry (info.bridges), and passes them on the firm's broadcast when they change; the answer carries readStop
(Stop reading from FinCom, for this computer or for all of the firm's, never another firm's) and the device's info keeps
it for the app; Resume: readStop gone and readResume once per bridge (also for a bridge that stopped itself); release:
none without a row, the pilot computer allowed, the others not until the version is approved, an older approved version
for the others meanwhile; the pilot computer's beats on the version are recorded as evidence (and a self-stop on it);
a cloud without migration-35 answers as before; bridge 1.15.0 and a bridge in test mode keep working."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, FIRM2 = "f-1", "f-2"
K1, K2, K3 = "fcd_" + "a" * 48, "fcd_" + "b" * 48, "fcd_" + "c" * 48
D1, D2, D3 = "d1000000-0000-0000-0000-000000000001", "d2000000-0000-0000-0000-000000000002", "d3000000-0000-0000-0000-000000000003"
def device(i, firm, name, key, version):
    F.T["tally_devices"].append({"id": i, "firm_id": firm, "name": name, "key_hash": hashlib.sha256(key.encode()).hexdigest(), "revoked": False, "info": {},
                                 "wake_token": "w" * 64, "version": version, "want_update_at": None, "want_sent_at": None, "main_bridge": None})
    return F.T["tally_devices"][-1]
dev1, dev2, dev3 = device(D1, FIRM, "NWS144", K1, "2.1.5"), device(D2, FIRM, "OFFICE-2", K2, "2.1.4"), device(D3, FIRM2, "THEIRS", K3, "2.1.4")
F.T["tally_read_stops"], F.T["tally_bridge_releases"] = [], []

# the firm's broadcasts (Realtime's broadcast API), caught; and a cloud without migration-35 (its tables unknown)
SENT, NO35 = [], {"on": False}
_post, _get, _patch = F.H.do_POST, F.H.do_GET, F.H.do_PATCH
def do_POST(self):
    if self.path.startswith("/realtime/v1/api/broadcast"):
        SENT.append(json.loads(self.body() or b"{}")); return self.send(200, {})
    return _post(self)
def no35(self):
    t = self.path.split("?")[0].rsplit("/", 1)[-1]
    if NO35["on"] and t in ("tally_read_stops", "tally_bridge_releases"):
        self.body(); self.send(404, {"code": "42P01", "message": 'relation "public.%s" does not exist' % t}); return True
    return False
def do_GET(self):
    if not no35(self): _get(self)
def do_PATCH(self):
    if not no35(self): _patch(self)
F.H.do_POST, F.H.do_GET, F.H.do_PATCH = do_POST, do_GET, do_PATCH
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(key, body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def iso(off=0): return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + off))
GO1 = {"id": "go-3fa9c1d2e4b7", "computer": "NWS144", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.1.5"}
GO2 = {"id": "go-0000aaaa1111", "computer": "OFFICE-2", "user": "accounts", "mode": "main", "runMode": "service", "version": "2.1.4"}
def beat(key, br, **kw):
    b = {"kind": "beat", "version": br["version"], "bridge": br, "tally": True, "tallyState": "open", "every": 30}
    b.update(kw); return call(key, b)
REQS = {"day": "2026-10-02", "last": {"kind": "daybook", "ms": 812, "at": "2026-10-02T10:01:02Z"}, "longest": {"kind": "ledgers", "ms": 19350, "at": "2026-10-02T09:30:00Z"}, "over20": 0, "n": 214}
try:
    for i in range(60):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)

    # 1. a cloud without migration-35: the beat answers as before
    NO35["on"] = True
    c, r = beat(K1, GO1)
    ok(c == 200 and r.get("ok") and "updateNow" in r and "posts" in r and "readStop" not in r and "release" not in r and "readResume" not in r,
       "without migration-35: answered as before, no readStop, readResume or release (%s %s)" % (c, sorted(r)))
    NO35["on"] = False

    # 2. the request timings and the bridge's own stop, cleaned and kept
    SENT.clear()
    c, r = beat(K1, GO1, reqs=REQS, readStopped=None)
    b1 = dev1["info"].get("beat", {})
    ok(c == 200 and b1.get("reqs") == REQS and b1.get("readStopped") is None, "the beat's request timings kept in info.beat (%s)" % b1.get("reqs"))
    ok(dev1["info"]["bridges"][GO1["id"]].get("reqs") == REQS and dev1["info"]["bridges"][GO1["id"]].get("readStopped") is None, "and in the bridge's own entry (info.bridges)")
    ok("readStop" in r and r["readStop"] is None and "release" not in r and not r.get("readResume"), "no stop from FinCom: readStop null; no release row: no release (%s)" % {k: r.get(k) for k in ("readStop", "release", "readResume")})
    ok(dev1["info"].get("readStop", "missing") is None, "the device's info says it is not stopped from FinCom (for the app)")
    got = [m["payload"]["beat"] for s in SENT for m in s.get("messages", []) if m.get("event") == "beat" and m["payload"].get("device") == D1]
    ok(got and got[-1].get("reqs") == REQS and "readStopped" in got[-1] and "readStop" in got[-1], "the timings go out on the firm's broadcast (%s)" % (got[-1] if got else SENT))
    SENT.clear()
    beat(K1, GO1, reqs=REQS, readStopped=None)
    ok(not [s for s in SENT if any(m["payload"].get("device") == D1 for m in s.get("messages", []))], "the same again: no broadcast")
    junk = {"day": "2026-10-02" * 30, "last": {"kind": "x" * 500, "ms": "9e99", "at": 5, "evil": "<script>"}, "longest": "nope", "over20": -4, "n": 1.7e12, "more": {"a": 1}}
    c, r = beat(K1, GO1, reqs=junk, readStopped={"by": "self", "reason": "a request took 31 s " + "y" * 900, "at": "2026-10-02T10:05:00Z", "x": 1})
    rq, rs = dev1["info"]["beat"].get("reqs") or {}, dev1["info"]["beat"].get("readStopped") or {}
    ok(set(rq) == {"day", "last", "longest", "over20", "n"} and len(rq["day"]) <= 10 and set(rq["last"]) == {"kind", "ms", "at"} and len(rq["last"]["kind"]) <= 40
       and 0 <= rq["last"]["ms"] <= 3600000 and rq["last"]["at"] == "" and rq["longest"] is None and rq["over20"] == 0 and isinstance(rq["n"], int) and rq["n"] <= 1e9,
       "the timings cleaned: known fields only, of the right kind, cut to length, numbers bounded (%s)" % rq)
    ok(rs.get("by") == "self" and len(rs.get("reason", "")) <= 300 and rs.get("at") == "2026-10-02T10:05:00Z" and set(rs) == {"by", "reason", "at"},
       "the bridge stopped itself: kept, the reason cut to 300 (%s...)" % str(rs)[:80])
    ok(dev1["info"]["bridges"][GO1["id"]].get("readStopped", {}).get("by") == "self", "also on its entry")
    beat(K1, GO1, reqs="garbage", readStopped={"by": "hacker", "reason": "x"})
    ok(dev1["info"]["beat"].get("reqs") is None and dev1["info"]["beat"].get("readStopped") is None, "timings that are not an object, a stop by someone unknown: not kept")

    # 3. Stop reading from FinCom: this computer, then all of the firm's
    F.T["tally_read_stops"].append({"id": 1, "firm_id": FIRM, "device_id": D1, "action": "stop", "reason": "Tally hung on 02-Oct", "stopped_by": "u-1", "stopped_at": iso(-60), "cleared_by": None, "cleared_at": None})
    SENT.clear()
    c, r = beat(K1, GO1, reqs=REQS)
    ok(c == 200 and r.get("readStop") == {"by": "fincom", "reason": "Tally hung on 02-Oct", "at": iso(-60)}, "NWS144 stopped from FinCom: readStop in its answer (%s)" % r.get("readStop"))
    ok(dev1["info"].get("readStop", {}).get("by") == "fincom", "and in the device's info for the app (%s)" % dev1["info"].get("readStop"))
    got = [m["payload"]["beat"] for s in SENT for m in s.get("messages", []) if m["payload"].get("device") == D1]
    ok(got and (got[-1].get("readStop") or {}).get("by") == "fincom", "the stop goes out on the firm's broadcast")
    c, r = beat(K2, GO2)
    ok(c == 200 and r.get("readStop") is None, "OFFICE-2 is not stopped (%s)" % r.get("readStop"))
    F.T["tally_read_stops"].append({"id": 2, "firm_id": FIRM, "device_id": None, "action": "stop", "reason": "all", "stopped_by": "u-1", "stopped_at": iso(-30), "cleared_by": None, "cleared_at": None})
    F.T["tally_read_stops"].append({"id": 3, "firm_id": FIRM2, "device_id": None, "action": "stop", "reason": "theirs", "stopped_by": "u-9", "stopped_at": iso(-30), "cleared_by": None, "cleared_at": None})
    c, r = beat(K2, GO2)
    ok((r.get("readStop") or {}).get("reason") == "all", "Stop on all computers: OFFICE-2 told too (%s)" % r.get("readStop"))
    c, r = beat(K1, GO1)
    ok((r.get("readStop") or {}).get("by") == "fincom", "and NWS144 still (%s)" % r.get("readStop"))
    c, r = call(K3, {"kind": "beat", "version": "2.1.4", "tally": True})
    ok(c == 200 and (r.get("readStop") or {}).get("reason") == "theirs", "another firm's stop only for its own computers (%s)" % r.get("readStop"))
    F.T["tally_read_stops"][-1]["cleared_at"] = iso(-1)
    # a bridge in test mode (shadow) and bridge 1.15.0 on the stopped computer
    c, r = call(K1, {"kind": "beat", "shadow": True, "version": "2.1.5", "bridge": dict(GO1, id="go-bbbbbbbbbbbb", mode="test"), "tally": True, "reqs": REQS})
    ok(c == 200 and (r.get("readStop") or {}).get("by") == "fincom" and dev1["info"]["bridges"]["go-bbbbbbbbbbbb"].get("reqs") == REQS,
       "a bridge in test mode is told the stop too, and its timings kept on its entry (%s)" % r.get("readStop"))
    c, r = call(K1, {"kind": "beat", "version": "1.15.0", "tally": True})
    ok(c == 200 and "updateNow" in r and "posts" in r and dev1["info"]["beat"].get("reqs") is None, "bridge 1.15.0 (no timings) beats as before")

    # 4. Resume: cleared, then readResume once per bridge
    for s in F.T["tally_read_stops"][:2]: s["cleared_at"], s["cleared_by"] = iso(-5), "u-1"
    F.T["tally_read_stops"].append({"id": 4, "firm_id": FIRM, "device_id": None, "action": "resume", "reason": "", "stopped_by": "u-1", "stopped_at": iso(-5), "cleared_by": None, "cleared_at": None})
    c, r = beat(K1, GO1)
    ok(r.get("readStop") is None and r.get("readResume") is True, "after Resume all: readStop gone and readResume (%s)" % {k: r.get(k) for k in ("readStop", "readResume")})
    ok(dev1["info"].get("readStop", "missing") is None, "the device's info: not stopped any more")
    c, r = beat(K1, GO1)
    ok(not r.get("readResume"), "readResume only once (%s)" % r.get("readResume"))
    c, r = beat(K2, GO2)
    ok(r.get("readResume") is True and r.get("readStop") is None, "OFFICE-2 told once too")
    c, r = beat(K2, GO2)
    ok(not r.get("readResume"), "and only once")
    c, r = call(K1, {"kind": "beat", "shadow": True, "version": "2.1.5", "bridge": dict(GO1, id="go-bbbbbbbbbbbb", mode="test"), "tally": True})
    ok(r.get("readResume") is True, "each bridge on the computer is told once (the test-mode one too)")
    # a bridge that stopped itself, resumed from FinCom (a resume row with no stop cleared)
    beat(K1, GO1, readStopped={"by": "self", "reason": "Tally silent for 2 minutes", "at": iso(-100)})
    F.T["tally_read_stops"].append({"id": 5, "firm_id": FIRM, "device_id": D1, "action": "resume", "reason": "", "stopped_by": "u-1", "stopped_at": iso(), "cleared_by": None, "cleared_at": None})
    c, r = beat(K1, GO1, readStopped={"by": "self", "reason": "Tally silent for 2 minutes", "at": iso(-100)})
    ok(r.get("readResume") is True and r.get("readStop") is None, "a self-stop resumed from FinCom: readResume (%s)" % r.get("readResume"))
    c, r = beat(K2, GO2)
    ok(not r.get("readResume"), "a resume for NWS144 is not passed to OFFICE-2")
    F.T["tally_read_stops"].append({"id": 7, "firm_id": FIRM, "device_id": D1, "action": "resume", "reason": "", "stopped_by": "u-1", "stopped_at": iso(-9 * 86400), "cleared_by": None, "cleared_at": None})
    c, r = beat(K1, GO1)
    ok(not r.get("readResume"), "a resume older than a week is not passed on")

    # 5. the staged release
    c, r = beat(K1, GO1)
    ok("release" not in r, "no release row: no release (the bridge never updates)")
    F.T["tally_bridge_releases"].append({"firm_id": FIRM, "version": "2.1.6", "pilot_device": D1, "pilot_started_at": None, "pilot_by": None, "pilot_seen_at": None, "pilot_last_seen_at": None,
                                         "pilot_beats": 0, "pilot_self_stop": None, "approved_at": None, "approved_by": None, "note": ""})
    rel = F.T["tally_bridge_releases"][-1]
    c, r = beat(K1, GO1)
    ok(r.get("release") == {"version": "2.1.6", "allowed": False}, "a pilot computer named but its pilot not started: not allowed (%s)" % r.get("release"))
    rel["pilot_started_at"], rel["pilot_by"] = iso(-3600), "u-1"
    c, r = beat(K1, GO1)
    ok(r.get("release") == {"version": "2.1.6", "allowed": True}, "the pilot computer is allowed 2.1.6 (%s)" % r.get("release"))
    c, r = beat(K2, GO2)
    ok(r.get("release") == {"version": "2.1.6", "allowed": False}, "OFFICE-2 is not, until approved (%s)" % r.get("release"))
    c, r = beat(K3, dict(GO2, id="go-cccccccccccc"))
    ok("release" not in r, "another firm's computer: nothing (its firm has no release row)")
    ok(rel["pilot_seen_at"] is None and rel["pilot_beats"] == 0, "the pilot's beats on 2.1.5 are not evidence for 2.1.6 (%s)" % rel["pilot_beats"])
    GO16 = dict(GO1, version="2.1.6")
    c, r = beat(K1, GO16)
    ok(rel.get("pilot_seen_at") and rel.get("pilot_last_seen_at") and rel["pilot_beats"] == 1, "the pilot computer beating on 2.1.6: seen, kept as evidence (%s)" % {k: rel.get(k) for k in ("pilot_seen_at", "pilot_beats")})
    first = rel["pilot_seen_at"]
    beat(K1, GO16)
    ok(rel["pilot_seen_at"] == first and rel["pilot_beats"] == 1, "beats within 5 minutes not written again")
    rel["pilot_last_seen_at"] = iso(-600)
    beat(K1, GO16)
    ok(rel["pilot_seen_at"] == first and rel["pilot_beats"] == 2 and rel["pilot_last_seen_at"] > iso(-60), "a later beat moves the last seen on (%s)" % rel["pilot_beats"])
    beat(K1, GO16, readStopped={"by": "self", "reason": "a request took 31 s", "at": iso()})
    ok((rel.get("pilot_self_stop") or {}).get("reason") == "a request took 31 s", "the pilot stopping itself on 2.1.6 is kept (approval then refused) (%s)" % rel.get("pilot_self_stop"))
    rel["pilot_self_stop"] = None
    beat(K2, dict(GO2, version="2.1.6"))
    ok(rel["pilot_beats"] == 2, "another computer on 2.1.6 is no evidence for the pilot")
    F.T["tally_bridge_releases"].append({"firm_id": FIRM, "version": "2.1.5", "pilot_device": D1, "pilot_started_at": iso(-90000), "pilot_by": "u-1", "pilot_seen_at": iso(-89000),
                                         "pilot_last_seen_at": iso(-100), "pilot_beats": 300, "pilot_self_stop": None, "approved_at": iso(-50), "approved_by": "u-1", "note": ""})
    c, r = beat(K2, GO2)
    ok(r.get("release") == {"version": "2.1.5", "allowed": True}, "2.1.5 approved, 2.1.6 in pilot: OFFICE-2 may take 2.1.5 (%s)" % r.get("release"))
    c, r = beat(K1, GO16)
    ok(r.get("release") == {"version": "2.1.6", "allowed": True}, "the pilot keeps 2.1.6 (%s)" % r.get("release"))
    rel["approved_at"], rel["approved_by"] = iso(), "u-1"
    c, r = beat(K2, GO2)
    ok(r.get("release") == {"version": "2.1.6", "allowed": True}, "2.1.6 approved: every computer allowed (%s)" % r.get("release"))
    n = rel["pilot_beats"]; rel["pilot_last_seen_at"] = iso(-3600)
    beat(K1, GO16)
    ok(rel["pilot_beats"] == n, "after approval the pilot's beats are no longer written")
    # the rest of the answer as before
    c, r = beat(K1, GO1)
    ok(all(k in r for k in ("updateNow", "posts", "wake", "opened", "ledgers", "activityAt")), "the rest of the answer unchanged (%s)" % sorted(r))
finally:
    fn.kill()
    if fails: print("".join(log[-30:]))
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
