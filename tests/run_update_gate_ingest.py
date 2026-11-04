"""python3 run_update_gate_ingest.py - migration 139's gated rollout of FinCom Bridge updates in tally-ingest: the real
cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py); the gate's
SQL (tally_bridge_update_gate) is tested on pg_stand by run_migration139.py, here it answers as scripted and its
arguments are checked. Made-up computers and bridges only. Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno).
Checks:
  1. a cloud without 139 (no such function): the release as before ({newest, allowed: true, held: []}).
  2. {gate: false} (no gate version): the release as before.
  3. a first beat, no Tally of its own, no request today: asked ready (its time: 2 minutes after this start), the
     computer's name and version passed; the function's allowed: true / false is the answer's release.allowed; the
     beat's record (info.updGate: start, quiet since) kept.
  4. busy with Tally (busySince; reading; a request in the last 3 minutes): asked not ready with the reason; 3 minutes
     with the request count unchanged: ready.
  5. a posting waiting for this bridge: not ready.
  6. not its time (its start an hour ago): not ready, "not its time".
  7. the owner's rollback: no gate (the rollback as before); an error of the function: not allowed this time.
  8. a bridge in test mode: never let through (asked not ready).
  9. a bridge whose time is not known gives way to another bridge of its computer near its known time."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "f-139"
K1, K2 = "fcd_" + "1" * 48, "fcd_" + "2" * 48
D1, D2 = "d1390000-0000-0000-0000-000000000001", "d1390000-0000-0000-0000-000000000002"
def device(i, key, version):
    F.T["tally_devices"].append({"id": i, "firm_id": FIRM, "name": "MADEUP-PC", "key_hash": hashlib.sha256(key.encode()).hexdigest(), "revoked": False, "info": {},
                                 "wake_token": "w" * 64, "version": version, "want_update_at": None, "want_sent_at": None, "main_bridge": None})
    return F.T["tally_devices"][-1]
dev1, dev2 = device(D1, K1, "2.5.1"), device(D2, K2, "2.4.7")
F.T["tally_read_stops"], F.T["tally_bridge_releases"], F.T["tally_bridge_rollbacks"] = [], [], []
GATE = {"answer": None, "calls": [], "error": None}
real = F.rpc
def rpc(name, a):
    if name == "tally_bridge_update_gate":
        GATE["calls"].append(a)
        if GATE["error"]: raise RuntimeError(GATE["error"])
        return GATE["answer"]
    return real(name, a)
F.rpc = rpc
_post = F.H.do_POST
def do_POST(self):
    if self.path.startswith("/realtime/v1/api/broadcast"):
        self.body(); return self.send(200, {})
    return _post(self)
F.H.do_POST = do_POST
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
G1 = {"id": "go-aaaa13900001", "computer": "MADEUP-PC", "user": "madeup1", "mode": "main", "runMode": "user", "version": "2.5.1"}
G2 = {"id": "go-aaaa13900002", "computer": "MADEUP-PC", "user": "madeup2", "mode": "main", "runMode": "user", "version": "2.4.7"}
R0 = {"day": "2026-11-04", "n": 0, "last": None, "longest": None, "over20": 0}
R5 = {"day": "2026-11-04", "n": 5, "last": {"kind": "TDSDeskCompanies", "ms": 120, "at": "2026-11-04T10:30:00"}, "longest": None, "over20": 0}
def beat(key, br, **kw):
    b = {"kind": "beat", "version": br["version"], "bridge": br, "tally": False, "tallyState": "closed", "every": 30, "reqs": R0, "busySince": "", "updating": False}
    b.update(kw); return call(key, b)
NEWEST = {"newest": True, "allowed": True, "held": []}
def last(): return GATE["calls"][-1] if GATE["calls"] else {}
def gate_info(dev): return (dev.get("info") or {}).get("updGate") or {}
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)

    # 1. a cloud without 139
    F.NO_FN.add("tally_bridge_update_gate")
    c, r = beat(K1, G1)
    ok(c == 200 and r.get("release") == NEWEST, "1. without 139: the release as before (%s %s)" % (c, r.get("release")))
    F.NO_FN.discard("tally_bridge_update_gate")
    # 2. no gate version
    GATE["answer"] = {"gate": False}
    c, r = beat(K1, G1)
    ok(r.get("release") == NEWEST, "2. gate false: the release as before (%s)" % r.get("release"))
    # 3. a first beat of the second bridge (no Tally of its own, nothing asked today): ready
    GATE["answer"] = {"gate": True, "allowed": True, "until": iso(600)}
    n0 = len(GATE["calls"])
    c, r = beat(K2, G2)
    a = last()
    ok(len(GATE["calls"]) == n0 + 1 and a.get("p_ready") is True and a.get("p_device") == D2 and a.get("p_firm") == FIRM and a.get("p_computer") == "MADEUP-PC" and a.get("p_version") == "2.4.7",
       "3. first beat, idle: asked ready with the computer and version (%s)" % a)
    ok("its time to look for an update" in str(a.get("p_why")), "3. its time: 2 minutes after this start (%s)" % a.get("p_why"))
    ok(r.get("release") == NEWEST, "3. allowed: true from the gate: released (%s)" % r.get("release"))
    g = gate_info(dev2)
    ok(g.get("startAt") and g.get("quietSince") and g.get("startHow") == "first beat", "3. info.updGate kept (%s)" % g)
    GATE["answer"] = {"gate": True, "allowed": False, "why": "another bridge of this computer updates first"}
    c, r = beat(K2, G2)
    ok(r.get("release") == dict(NEWEST, allowed=False), "3. allowed: false from the gate: not allowed (%s)" % r.get("release"))
    # 4. busy
    c, r = beat(K2, G2, busySince="2026-11-04T10:00:00", tallyState="busy", tally=True)
    ok(last().get("p_ready") is False and "busy" in str(last().get("p_why")), "4. Tally busy: not ready (%s)" % last())
    c, r = beat(K2, G2, updating=True)
    ok(last().get("p_ready") is False and "reading" in str(last().get("p_why")), "4. reading Tally: not ready (%s)" % last().get("p_why"))
    c, r = beat(K2, G2, reqs=R5, tally=True, tallyState="open")
    ok(last().get("p_ready") is False and "3 minutes" in str(last().get("p_why")), "4. a request just now: not ready (%s)" % last().get("p_why"))
    dev2["info"]["updGate"]["quietSince"] = iso(-200)   # 3 minutes 20 s with the same count
    c, r = beat(K2, G2, reqs=R5, tally=True, tallyState="open")
    ok(last().get("p_ready") is True, "4. 3 minutes with the count unchanged: ready (%s)" % last().get("p_why"))
    # 5. a posting waiting for this bridge
    F.T["tally_post_jobs"].append({"id": "j-139", "device_id": D2, "status": "waiting", "target_bridge": G2["id"], "company": "Made-up Co", "payload": {}, "created_at": iso(-60)})
    c, r = beat(K2, G2)
    ok(last().get("p_ready") is False and "posting" in str(last().get("p_why")), "5. a posting waiting: not ready (%s)" % last().get("p_why"))
    F.T["tally_post_jobs"][-1]["status"] = "done"
    # 6. not its time
    dev2["info"]["updGate"]["startAt"] = iso(-3600); dev2["info"]["updGate"]["starts"] = [iso(-3600)]
    c, r = beat(K2, G2)
    ok(last().get("p_ready") is False and "not its time" in str(last().get("p_why")), "6. an hour after its start: not its time (%s)" % last().get("p_why"))
    # 7. the owner's rollback: no gate; a function error: not allowed
    F.T["tally_bridge_rollbacks"].append({"firm_id": FIRM, "version": "2.4.7", "set_at": iso(-60), "cleared_at": None})
    n0 = len(GATE["calls"])
    c, r = beat(K1, G1)
    ok(len(GATE["calls"]) == n0 and r.get("release") == {"version": "2.4.7", "allowed": True, "rollback": True}, "7. a rollback: no gate (%s)" % r.get("release"))
    F.T["tally_bridge_rollbacks"].clear()
    GATE["error"] = "the database is busy (test)"
    c, r = beat(K1, G1)
    ok(c == 200 and r.get("release") == dict(NEWEST, allowed=False), "7. the gate fails: not allowed this time, the beat answered (%s %s)" % (c, r.get("release")))
    GATE["error"] = None
    # 8. test mode
    GATE["answer"] = {"gate": True, "allowed": False, "why": "not ready"}
    n0 = len(GATE["calls"])
    c, r = call(K1, {"kind": "beat", "version": "2.5.1", "bridge": G1, "tally": False, "shadow": True})
    tm = GATE["calls"][n0:]
    ok(c == 200 and r.get("shadow") is True and len(tm) == 1 and tm[0].get("p_ready") is False and tm[0].get("p_why") == "no beat" and r.get("release", {}).get("allowed") is False,
       "8. a beat in test mode: never ready (%s, %s)" % (tm, r.get("release")))
    # 9. the unknown time gives way
    F.T["tally_bridge_update_target"] = [{"id": 1, "version": "2.5.3"}]
    GATE["answer"] = {"gate": True, "allowed": True, "until": iso(600)}
    dev2["info"]["computer"] = "MADEUP-PC"
    dev2["info"]["updGate"]["starts"] = [iso(-6 * 3600 - 60)]; dev2["info"]["updGate"]["startAt"] = iso(-6 * 3600 - 60)   # its check in a minute
    dev2["info"]["beat"]["at"] = iso(-20)
    dev1["info"].setdefault("updGate", {})["starts"] = []; dev1["info"]["updGate"]["startAt"] = ""; dev1["info"]["updGate"]["quietSince"] = iso(-600)
    c, r = beat(K1, G1)
    ok(last().get("p_device") == D1 and last().get("p_ready") is False and "near its time" in str(last().get("p_why")), "9. unknown time, a peer near its check: gives way (%s)" % last().get("p_why"))
    dev2["info"]["updGate"]["starts"] = [iso(-3 * 3600)]; dev2["info"]["updGate"]["startAt"] = iso(-3 * 3600)              # its check in 3 hours
    c, r = beat(K1, G1)
    ok(last().get("p_ready") is True and "not known" in str(last().get("p_why")), "9. the peer's check far away: the unknown one asks for a slot (%s)" % last().get("p_why"))
finally:
    fn.terminate()
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
if fails: print("".join(log[-30:]))
sys.exit(1 if fails else 0)
