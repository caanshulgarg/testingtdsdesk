"""python3 run_keepwait_ingest.py - the beat's keepWait in tally-ingest (server/tally-cloud/index.ts under Deno, against
the stand-in for Supabase, fake_supabase.py). next-fix-read-any-bridge: a bridge whose Update now waits (someone working
in Tally, a posting, FinCom reading) says why in its beat; FinCom keeps it and passes it on. Made-up computer and bridge only.
Checks:
  1. keepWait kept, cleaned: reason (a known one only), words and queued (300 letters at most), since (an ISO time only);
     anything else dropped; not an object, or an unknown reason: none;
  2. a change of keepWait is passed on at once on the firm's broadcast channel (the page shows it beside Update now);
  3. the bridge's Update now answer is unchanged by it (updateNow once, as before).
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "99999999-9999-9999-9999-999999992550"
DA, KA = "d2550000-0000-0000-0000-000000000255", "fcd_" + "e" * 48
GA = {"id": "go-aaaaaa255255", "computer": "PC-MADEUP", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.5"}
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.5",
                              "want_update_at": "2026-11-07T05:44:43.000Z"})
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
WORDS = "Waiting: someone is working in Tally on this computer. Reading starts once Tally has had no typing or clicks for 15 s."
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    base = {"version": "2.5.5", "bridge": GA, "kind": "beat", "tally": True, "open": ["MADEUP CO"], "companies": [{"name": "MADEUP CO", "open": True, "guid": "g-madeup"}]}
    print("== 1. keepWait kept, cleaned")
    c, r = call(dict(base, updating=True, keepWait={"reason": "userInTally", "words": WORDS + "x" * 400, "since": "2026-11-07T05:44:50Z",
                                                   "queued": "Update now is queued: " + WORDS, "secret": "y"}))
    kw = kept().get("keepWait") or {}
    ok(c == 200 and kw.get("reason") == "userInTally" and kw.get("words", "").startswith(WORDS) and len(kw.get("words", "")) == 300
       and kw.get("since") == "2026-11-07T05:44:50Z" and kw.get("queued", "").startswith("Update now is queued: ") and "secret" not in kw, "1. kept, cleaned (%s)" % kw)
    ok(r.get("updateNow") is True, "3. the Update now still goes to the bridge (%s)" % r.get("updateNow"))
    c, r = call(dict(base, keepWait={"reason": "made up", "words": "x"}))
    ok("keepWait" not in kept(), "1. an unknown reason: none (%s)" % kept().get("keepWait"))
    ok(r.get("updateNow") is False, "3. Update now said once only (%s)" % r.get("updateNow"))
    c, r = call(dict(base, keepWait={"reason": "posting", "words": "Waiting: a posting into Tally is going on.", "since": "<script>"}))
    kw = kept().get("keepWait") or {}
    ok(kw.get("reason") == "posting" and kw.get("since") == "" and "queued" not in kw, "1. since an ISO time only, queued only when said (%s)" % kw)
    c, r = call(dict(base, keepWait="waiting"))
    ok("keepWait" not in kept(), "1. not an object: none (%s)" % kept().get("keepWait"))
    print("== 2. passed on at once")
    FS.BCAST.clear()
    call(dict(base, keepWait={"reason": "fincomReading", "words": "Waiting: FinCom is reading from Tally on this computer.", "since": "2026-11-07T05:50:00Z"}))
    sent = [m for b in FS.BCAST for m in (b.get("messages") or []) if m.get("event") == "beat"]
    ok(sent and (sent[-1].get("payload", {}).get("beat", {}).get("keepWait") or {}).get("reason") == "fincomReading", "2. broadcast with keepWait (%s)" % sent[-1:] )
finally:
    fn.terminate()
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
