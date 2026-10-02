"""python3 run_main_bridge_server.py - (02-Oct-2026) every bridge tally-ingest hears from on a computer key, and the main
bridge: FinCom Bridge 2.x (test mode, beside 1.15.0) and bridge 1.15.0 are both listed with computer, Windows user, version
and mode; once 2.x is made the main bridge, only it is given postings and 1.15.0 is refused; the bridge's install log
(support pack, also in test mode) and an install log dropped on the Tally page are kept for FinCom support.
Based on run_shadow_server.py: - tally-ingest's shadow calls (branch go-bridge): FinCom Bridge 2.0.0 in test mode, beside
bridge 1.15.0 with the same computer key, sends marked shadow, and nothing it sends changes what 1.15.0 keeps:
its days are compared with the kept ones (same / differ / new) and not stored; its heartbeat is noted apart and does not
take "Update now"; it is never handed a posting. The real cloud function (server/tally-cloud/index.ts) under Deno against
the stand-in for Supabase (fake_supabase.py). Needs Deno (DENO, default: the deno on the PATH)."""
import os, sys, json, time, gzip, base64, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
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

GO = {"id": "go-3fa9c1d2e4b7", "computer": "NWS144", "user": "anshul", "mode": "test", "runMode": "user", "version": "2.1.0"}
F.USERS["tok-owner"] = {"id": "u-1", "email": "o@x"}
F.T["members"].append({"user_id": "u-1", "firm_id": FIRM, "active": True, "role": "owner"})
def web(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "Authorization": "Bearer tok-owner"})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
try:
    for i in range(60):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    dev = F.T["tally_devices"][0]
    c, r = call({"kind": "hello", "version": "1.15.0", "info": {"computer": "NWS144", "user": "anshul"}})
    c, r = call({"kind": "beat", "version": "1.15.0", "tally": False, "open": []})
    c, r = call({"kind": "hello", "version": "1.15.0", "info": {"computer": "NWS144", "user": "anshul"}})
    ok("beat" in dev["info"] and dev["info"].get("computer") == "NWS144", "a hello keeps the heartbeat beside the computer's name (it used to replace it)")
    c, r = call({"kind": "beat", "shadow": True, "version": "2.0.0", "tally": True})
    ok(set(dev["info"].get("bridges", {})) == {"v1"} and dev["info"]["bridges"]["v1"]["mode"] == "main" and dev["info"]["shadow"]["version"] == "2.0.0",
       "a bridge 2.0.0 in test mode (no name of its own) is kept apart, never in 1.15.0's place")
    c, r = call({"kind": "beat", "shadow": True, "version": "2.1.0", "bridge": GO, "tally": True, "tallyState": "open", "open": ["ZZ CO"]})
    b = dev["info"].get("bridges", {})
    ok(c == 200 and r.get("makeMain") is False and set(b) == {"v1", GO["id"]}, "both bridges listed: 1.15.0 (v1) and 2.1.0 (%s)" % sorted(b))
    g, v = b.get(GO["id"], {}), b.get("v1", {})
    ok([g.get(k) for k in ("computer", "user", "version", "mode", "runMode", "tally")] == ["NWS144", "anshul", "2.1.0", "test", "user", True] and g.get("open") == ["ZZ CO"],
       "2.1.0: NWS144, anshul, 2.1.0, test mode, just for this user, sees Tally with ZZ CO open (%s)" % g)
    ok([v.get(k) for k in ("computer", "user", "version", "mode", "tally")] == ["NWS144", "anshul", "1.15.0", "main", False], "1.15.0: NWS144, anshul, main, Tally not seen (%s)" % v)
    c, r = call({"kind": "beat", "version": "1.15.0", "tally": True})
    ok(c == 200 and r.get("posts") == 1 and not r.get("notMain"), "with no main bridge chosen, 1.15.0 is given the posting as before")
    # made the main bridge on the Tally page (migration-22's function sets the column; the stand-in sets it the same way)
    dev["main_bridge"] = GO["id"]
    c, r = call({"kind": "beat", "shadow": True, "version": "2.1.0", "bridge": GO, "tally": True})
    ok(c == 200 and r.get("makeMain") is True, "2.1.0's heartbeat is told it is the main bridge now (makeMain)")
    c, r = call({"kind": "beat", "version": "1.15.0", "tally": True})
    ok(c == 200 and r.get("posts") == 0 and r.get("notMain") is True, "1.15.0's heartbeat: no postings, told another bridge is the main one")
    c, r = call({"kind": "posts_take", "version": "1.15.0"})
    ok(c == 403 and r.get("notMain") and F.T["tally_post_jobs"][0]["status"] == "waiting", "1.15.0 asking for the posting is refused; it still waits")
    c, r = call({"kind": "posts_update", "version": "1.15.0", "id": "p-1", "status": "done"})
    ok(c == 403 and F.T["tally_post_jobs"][0]["status"] == "waiting", "nor can 1.15.0 report one")
    main = dict(GO, mode="main")
    c, r = call({"kind": "beat", "version": "2.1.0", "bridge": main, "tally": True})
    ok(c == 200 and r.get("posts") == 1 and not r.get("notMain") and dev["info"]["bridges"][GO["id"]]["mode"] == "main", "2.1.0 switched over (no longer shadow): given the posting, listed as main")
    c, r = call({"kind": "posts_take", "version": "2.1.0", "bridge": main})
    ok(c == 200, "and may take it (%s)" % c)
    # the bridge's menu: Switch to main bridge (a second Go install takes over)
    dev["main_bridge"] = None
    other = dict(GO, id="go-aaaaaaaaaaaa", user="tally2")
    c, r = call({"kind": "make_main", "shadow": True, "version": "2.1.0", "bridge": other})
    ok(c == 200 and dev.get("main_bridge") == "go-aaaaaaaaaaaa", "Switch to main bridge from a bridge's menu records it as the main one")
    c, r = call({"kind": "make_main", "version": "1.15.0"})
    ok(c == 400 and dev.get("main_bridge") == "go-aaaaaaaaaaaa", "1.15.0 cannot make itself the main bridge")
    c, r = call({"kind": "beat", "version": "2.1.0", "bridge": main, "tally": True})
    ok(r.get("notMain") is True and r.get("posts") == 0, "and the first 2.1.0 is then told it is not the main one")
    # posting updates (02-Oct-2026): each entry's state kept; a cancelled or vanished posting is told to the bridge
    dev["main_bridge"] = None
    c, r = call({"kind": "posts_update", "version": "2.1.0", "bridge": main, "id": "p-1", "status": "taken", "done": 0, "message": "Waiting for Tally: ZZ CO is not open",
                 "items": [{"id": "v1", "kind": "voucher", "state": "waiting", "reason": ""}, {"id": "v2", "state": "bogus"}]})
    job = F.T["tally_post_jobs"][0]
    ok(c == 200 and job.get("items") == [{"id": "v1", "kind": "voucher", "state": "waiting", "reason": ""}, {"id": "v2", "kind": "", "state": "waiting", "reason": ""}], "each entry's state is kept (an unknown state is read as waiting)")
    job["status"] = "cancelled"
    c, r = call({"kind": "posts_update", "version": "2.1.0", "bridge": main, "id": "p-1", "status": "taken", "message": "x"})
    ok(c == 200 and r.get("cancelled") is True and job["status"] == "cancelled", "a posting cancelled in FinCom: the bridge is told (cancelled), nothing changes")
    c, r = call({"kind": "posts_update", "version": "2.1.0", "bridge": main, "id": "no-such", "status": "taken"})
    ok(c == 200 and r.get("gone") is True, "a posting no longer there: the bridge is told (gone)")
    dev["main_bridge"] = "go-aaaaaaaaaaaa"
    # install logs
    import zipfile, io
    zb = io.BytesIO(); zipfile.ZipFile(zb, "w").writestr("install.log", "2026-10-02 10:00:00  Install: test"); zb = base64.b64encode(zb.getvalue()).decode()
    c, r = call({"kind": "support", "shadow": True, "version": "2.1.0", "bridge": GO, "zip": zb, "note": "install log"})
    ok(c == 200 and any(k.startswith("tally-support/%s/d-1/" % FIRM) for k in F.FILES), "Send install log to FinCom from a bridge in test mode: kept (%s)" % r.get("path"))
    c, r = web({"kind": "install_log", "name": "install.log", "text": "2026-10-02 10:00:00  Install: the folder could not be written"})
    ok(c == 200 and any(k.startswith("tally-support/%s/web/" % FIRM) and k.endswith("-install.log") for k in F.FILES), "an install log dropped on the Tally page: kept (%s)" % r.get("path"))
    c, r = web({"kind": "install_log", "text": " "})
    ok(c == 413, "an empty one is refused")
finally:
    fn.kill()
    if fails: print("".join(log[-30:]))
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
