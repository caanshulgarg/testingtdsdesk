"""python3 run_cloud_lows_server.py - bridge 2.3.1: the deferred cloud Lows of the 2.3.0 reviews in tally-ingest
(server/tally-cloud/index.ts), the real function under Deno against the stand-in for Supabase (fake_supabase.py). Each
section was written first (red before its fix). Needs Deno (DENO).
  A. round 1 bridge L1: the bridge-id bind check let a beat through on ANY database error; it now goes on only when the
     function is not there (PGRST202 / missing: a cloud without migration 54); any other error refuses the call (503, the
     bridge asks again) and is logged.
  B. cloud Lows: errors at the changes-only read and the posting-target check are logged (were swallowed); a cloud without
     the table or column says nothing, as before.
  C. cloud Lows: the beat wrote back info.idRefused from the computer's row as read before the bind, so a refusal the bind
     had just cleared (the id is this computer's own again) came back; it now stays cleared. Another bridge's refusal on
     the same computer is kept.
  D. cloud Lows: guidsFromRecord read FinCom's record with .limit(2000) and filtered the company in JS, so 2,000 newer rows
     of another company with the same MasterID hid the entry; the company is filtered in the query, MasterIDs in chunks.
  E. round 3 L2: the refetch's ":resolved" lookup put up to 400 ids in one URL; past the gateway's limit it failed quietly
     to an empty list. It now asks in chunks of 60 (and logs a failure)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, CID = "f-1", "b-1", "c-1"; KEY = "fcd_" + "f" * 48
CG = "78257d7a-c68a-4ffc-a253-148c60566464"
BRID, OTHERB = "go-aaaaaa111111", "go-bbbbbb222222"
F.T["clients"].append({"id": CID, "firm_id": FIRM, "name": "ZZ TEST", "tally_name": "ZZ CO", "gstin": "", "deleted": False})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-05T00:00:00Z"})
F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.3.1", "wake_token": "w" * 64})
BIND_FAIL = [False]
SENT = []
real = F.rpc
def rpc(fn, a):
    if fn == "tally_bridge_bind":
        if BIND_FAIL[0]: raise RuntimeError("canceling statement due to statement timeout")
        out = real(fn, a)
        if out.get("own"):     # as migration 54's tally_bridge_bind: the computer that is the id's own again loses its idRefused
            d = next((x for x in F.T["tally_devices"] if x["id"] == a["p_device"]), {})
            if ((d.get("info") or {}).get("idRefused") or {}).get("bridge") == a["p_bridge"]: d["info"].pop("idRefused", None)
        return out
    if fn == "tally_recorder_send":
        SENT.extend(a["p_lines"]); return {"results": [{"line_id": l["line_id"], "state": "held" if not l.get("object_guid") else "applied", "why": None} for l in a["p_lines"]]}
    return real(fn, a)
F.rpc = rpc
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": KEY})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def logged(s, since=0):
    time.sleep(0.3); return any(s in l for l in log[since:])
BR = {"id": BRID, "computer": "OFFICE-PC", "user": "u", "mode": "main", "runMode": "user", "version": "2.3.1"}
BEAT = {"kind": "beat", "version": "2.3.1", "bridge": BR, "tally": True, "tallyState": "open", "open": ["ZZ CO"], "windowsUser": "u", "bridgePort": 9100, "tallyPort": 9000, "dataFolder": "D:\\T"}
dev = F.T["tally_devices"][0]
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    # A. the bind check
    c, r = call(BEAT)
    ok(c == 200, "A. a beat with the bind working: 200 (%s %s)" % (c, r.get("error")))
    BIND_FAIL[0] = True; n = len(log); before = json.dumps(dev.get("info", {}).get("bridges", {}).get(BRID, {}).get("at"))
    c, r = call(dict(BEAT, open=["SOMETHING NEW"]))
    ok(c == 503 and r.get("ok") is False and not r.get("idRefused"), "A. the bind check failing (a database error, not a missing function): refused 503, ask again (%s %s)" % (c, r))
    ok(json.dumps(dev.get("info", {}).get("bridges", {}).get(BRID, {}).get("at")) == before, "A. nothing of that beat is kept")
    ok(logged("tally_bridge_bind", n), "A. the error is logged (%s)" % [l.strip() for l in log[n:]][:3])
    BIND_FAIL[0] = False
    F.NO_FN.add("tally_bridge_bind")
    c, r = call(BEAT)
    ok(c == 200, "A. a cloud without tally_bridge_bind (migration 54 not run): as before (%s)" % c)
    F.NO_FN.discard("tally_bridge_bind")

    # B. changes only and the posting-target check: errors logged
    F.FAIL_SELECT["tally_bridge_prefs"] = {"message": "canceling statement due to statement timeout", "code": "57014"}; n = len(log)
    c, r = call(BEAT)
    ok(c == 200 and logged("tally_bridge_prefs", n), "B. the changes-only read failing: the beat goes on, the error logged (%s %s)" % (c, [l.strip() for l in log[n:]][:3]))
    F.FAIL_SELECT["tally_bridge_prefs"] = {"message": "Could not find the table 'public.tally_bridge_prefs' in the schema cache", "code": "PGRST205"}; n = len(log)
    c, r = call(BEAT)
    ok(c == 200 and not logged("tally_bridge_prefs", n), "B. a cloud without the table: as before, nothing logged (%s)" % [l.strip() for l in log[n:]][:3])
    F.FAIL_SELECT.pop("tally_bridge_prefs")
    F.T["tally_post_jobs"].append({"id": "p-1", "firm_id": FIRM, "device_id": "d-1", "company": "ZZ CO", "status": "taken", "payload": {"vouchers": []}, "created_at": "2026-10-05T10:00:00Z", "target_bridge": BRID})
    F.FAIL_SELECT["tally_post_jobs"] = {"message": "canceling statement due to statement timeout", "code": "57014"}; n = len(log)
    c, r = call({"kind": "posts_update", "version": "2.3.1", "bridge": BR, "id": "p-1", "status": "running", "windowsUser": "u"})
    ok(logged("target", n), "B. the posting-target check failing: logged (%s %s)" % (c, [l.strip() for l in log[n:]][:3]))
    F.FAIL_SELECT.pop("tally_post_jobs")

    # C. idRefused cleared by the bind stays cleared
    dev["info"]["idRefused"] = {"bridge": BRID, "words": "This computer key cannot use bridge %s." % BRID, "at": "2026-10-05T10:00:00Z"}
    c, r = call(BEAT)
    ok(c == 200 and "idRefused" not in dev["info"], "C. the id is this computer's own again: idRefused stays cleared after the beat (%s %s)" % (c, dev["info"].get("idRefused")))
    dev["info"]["idRefused"] = {"bridge": OTHERB, "words": "This computer key cannot use bridge %s." % OTHERB, "at": "2026-10-05T10:00:00Z"}
    c, r = call(BEAT)
    ok(c == 200 and (dev["info"].get("idRefused") or {}).get("bridge") == OTHERB, "C. another bridge's refusal on this computer is kept (%s)" % dev["info"].get("idRefused"))
    dev["info"].pop("idRefused", None)

    # D. guidsFromRecord: the company in the query
    F.HONOR_LIMIT[0] = True
    def row(i, mid, guid, cg):
        return {"id": i, "book_id": BOOK, "firm_id": FIRM, "device_id": "d-1", "bridge": BRID, "line_id": "s%d" % i, "event": "created", "state": "applied", "object_guid": guid,
                "master_id": str(mid), "company_guid": cg, "vch_type": "Receipt", "vch_no": str(i), "vch_date": "2026-10-02", "payload": {}, "body": {"vouchers": [{"guid": guid}]}}
    F.T["tally_recorder_lines"] = [row(5, 21, CG + "-00000015", CG)] + [row(1000 + i, 21, "other-co-%08x" % i, "11111111-2222-3333-4444-555555555555") for i in range(2100)]
    line = {"line_id": "D21", "event": "deleted", "object_guid": "", "master_id": "21", "alter_id": None, "vch_type": "Receipt", "vch_no": "5", "vch_date": "20261002",
            "saved_at": "2026-10-05T13:56:00Z", "pc": "PC", "user": "TALLY User", "company_guid": CG.upper(), "ledgers": [], "narration": "", "fid": "", "xml": "", "source": "addon",
            "heldWhy": "deleted in Tally; FinCom could not tell which entry: upload that day's Day Book to settle it"}
    c, r = call({"kind": "recorder_lines", "version": "2.3.1", "bridge": BR, "company": "ZZ CO", "company_guid": CG, "lines": [line]})
    got = {l["line_id"]: l for l in SENT}
    ok(c == 200 and got.get("D21", {}).get("object_guid") == CG + "-00000015",
       "D. 2,100 newer rows of another company with the same MasterID do not hide the entry (the company GUID in any case) (%s)" % got.get("D21", {}).get("object_guid"))
    F.HONOR_LIMIT[0] = False

    # E. the refetch's ":resolved" lookup in chunks
    now = datetime.datetime.now(datetime.timezone.utc)
    F.T["tally_recorder_lines"] = [{"id": 10000 + i, "firm_id": FIRM, "device_id": "d-1", "bridge": BRID, "book_id": BOOK, "line_id": "refetch-line-%04d-%s" % (i, "x" * 30), "state": "held", "event": "created",
                                    "company": "ZZ CO", "company_guid": CG, "master_id": str(100 + i), "vch_type": "Receipt", "vch_no": str(i), "vch_date": "2026-10-02", "object_guid": "",
                                    "body": None, "received_at": (now - datetime.timedelta(minutes=300 - i)).isoformat()} for i in range(300)]
    F.MAX_URL[0] = 6000; n = len(log)
    c, r = call(BEAT)
    rf = r.get("refetch") or []
    ok(c == 200 and len(rf) == 20, "E. 300 held lines, the gateway's URL limit at 6,000: the refetch still lists 20 (%s %d)" % (c, len(rf)))
    F.MAX_URL[0] = 0
finally:
    fn.terminate()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
