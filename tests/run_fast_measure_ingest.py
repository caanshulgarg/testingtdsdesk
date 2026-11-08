"""python3 run_fast_measure_ingest.py - FinCom Bridge 2.5.9 / migration 148 (the owner's decision of 08-Nov-2026: the
fast read measured on a REAL client company open in Tally, ZZ TEST too): tally-ingest {kind: "fast_measure"}
(server/tally-cloud/index.ts under Deno, against the stand-in for Supabase, fake_supabase.py; never a real database).
Checks:
  A. {check: true} for a company linked to a client of this firm, named in this computer's heartbeat, with the book's
     GUID: {ok, linked}; nothing kept;
  B. not linked / another firm's company: notLinked; a GUID that is not the book's, or none: otherGuid; a company this
     computer never named: notMine; each refused, nothing kept (with or without check);
  C. a result for the real client company: one row of tally_fast_measures with the book, the computer and the pass
     decided again; only the known fields kept (an entry's data sent along is dropped);
  D. ZZ TEST, linked, is taken too;
  E. a cloud without migration 148: "not set up yet" (503).
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, hashlib, subprocess, threading, urllib.request, urllib.error, shutil, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, OTHER = "99999999-9999-9999-9999-999999999259", "88888888-8888-8888-8888-888888888259"
BOOK, ZBOOK = "11111111-1111-1111-1111-111111111259", "22222222-2222-2222-2222-222222222259"
DEV, KEY = "d1000000-0000-0000-0000-000000000259", "fcd_" + "e" * 48
CG, ZG = "a2f776bd-4a48-4f7d-9c73-48a8f087b259", "b3f776bd-4a48-4f7d-9c73-48a8f087b259"
REAL, ZZ = "Sharma Traders 2026-27", "ZZ TEST"
GO = {"id": "go-aaaaaa259259", "computer": "PC-F", "user": "user-f", "mode": "main", "runMode": "user", "version": "2.5.9"}
FS.T["clients"] += [{"id": "c1", "firm_id": FIRM, "name": "SHARMA TRADERS", "tally_name": REAL, "gstin": "", "deleted": False},
                    {"id": "c2", "firm_id": FIRM, "name": "TEST CLIENT", "tally_name": ZZ, "gstin": "", "deleted": False},
                    {"id": "c9", "firm_id": OTHER, "name": "ELSEWHERE", "tally_name": "Elsewhere Co", "gstin": "", "deleted": False}]
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": REAL, "client_id": "c1", "book_id": BOOK, "device_id": DEV, "last_seen": "2026-11-08T00:00:00Z"},
                            {"firm_id": FIRM, "company": ZZ, "client_id": "c2", "book_id": ZBOOK, "device_id": DEV, "last_seen": "2026-11-08T00:00:00Z"},
                            {"firm_id": OTHER, "company": "Elsewhere Co", "client_id": "c9", "book_id": "33333333-3333-3333-3333-333333333259", "device_id": "x", "last_seen": "2026-11-08T00:00:00Z"}]
FS.T["tally_books"] += [{"book_id": BOOK, "firm_id": FIRM, "client_id": "c1", "company": REAL, "from_date": "2026-04-01", "open_as_on": "2026-03-31"},
                        {"book_id": ZBOOK, "firm_id": FIRM, "client_id": "c2", "company": ZZ, "from_date": "2026-04-01", "open_as_on": "2026-03-31"}]
OPEN = [REAL, ZZ, "Unlinked Co", "Elsewhere Co"]
FS.T["tally_devices"].append({"id": DEV, "firm_id": FIRM, "name": "NWS144", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False,
                              "info": {"beat": {"open": OPEN}, "bridges": {GO["id"]: {"open": OPEN}}}, "version": "2.5.9", "wake_token": "tok259"})
FS.T["tally_sync_cursor"] = [{"book_id": BOOK, "company_guid": CG}, {"book_id": ZBOOK, "company_guid": ZG}]
FS.T["tally_fast_measures"] = []
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body):
    h = {"Content-Type": "application/json", "x-fincom-device": KEY}
    body = dict({"version": "2.5.9", "bridge": GO}, **body)
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=h)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
RESULT = {"ok": True, "state": "done", "at": "2026-11-08T10:00:00Z", "bridge": "2.5.9", "tallyVersion": "7.1.0.0", "plan": "9b", "watched": True, "pass": True,
          "busiestDay": 120, "busiest31": 175, "worstMs": 900, "worstHoldMs": 200, "compared": 50, "differ": 0, "line": "PASS: worst 0.90 s",
          "results": [{"kind": "locate", "days": 7, "rows": 30, "ms": 40, "holdMs": 0}, {"kind": "W1", "days": 31, "rows": 175, "ms": 900, "holdMs": 200},
                      {"kind": "W2", "days": 3, "asked": 50, "rows": 50, "ms": 700, "holdMs": 100, "objectMs": 30, "objectHoldMs": 0, "compare": {"same": 50, "differ": 0, "left": 0, "fields": []}}]}
def fm(co, guid, **k): return call(dict({"kind": "fast_measure", "company": co, "company_guid": guid}, **k))
try:
    for _ in range(120):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=2)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    print("== A. the link check")
    c, r = fm(REAL, CG, check=True)
    ok(c == 200 and r.get("ok") is True and r.get("linked") is True and FS.T["tally_fast_measures"] == [], "A. a linked client company, its GUID: linked, nothing kept (%s %s)" % (c, r))
    print("== B. the refusals")
    for what, args, flag in [("not linked", ("Unlinked Co", CG), "notLinked"), ("another firm's company", ("Elsewhere Co", CG), "notLinked"),
                             ("another GUID", (REAL, ZG), "otherGuid"), ("no GUID", (REAL, ""), "otherGuid")]:
        for chk in (True, False):
            extra = {"check": True} if chk else {"result": RESULT}
            c, r = fm(*args, **extra)
            ok(c in (403, 409) and r.get("ok") is False and r.get(flag) is True and FS.T["tally_fast_measures"] == [],
               "B. %s (%s): refused, nothing kept (%s %s)" % (what, "check" if chk else "result", c, r))
    # a company this computer never named in its heartbeat
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DEV)
    dev["info"] = {"beat": {"open": [ZZ]}, "bridges": {GO["id"]: {"open": [ZZ]}}}
    c, r = fm(REAL, CG, check=True)
    ok(c == 403 and r.get("notMine") is True, "B. a company this computer never named: notMine (%s %s)" % (c, r))
    dev["info"] = {"beat": {"open": OPEN}, "bridges": {GO["id"]: {"open": OPEN}}}
    print("== C. a result for the real client company")
    sneaky = json.loads(json.dumps(RESULT))
    sneaky["results"][2]["narration"] = "Paid rent"; sneaky["entries"] = [{"party": "Mr X", "amount": "500.00"}]
    c, r = fm(REAL, CG, result=sneaky)
    rows = FS.T["tally_fast_measures"]
    ok(c == 200 and r.get("ok") is True and len(rows) == 1 and rows[0].get("book_id") == BOOK and rows[0].get("device_id") == DEV and rows[0].get("pass") is True,
       "C. kept: one row for the client's book, this computer, the pass decided again (%s %s %s)" % (c, r, rows))
    txt = json.dumps(rows)
    ok(rows[0]["result"].get("company") == REAL, "C. the book's company kept with the result, for the page")
    ok("Paid rent" not in txt and "Mr X" not in txt and "500.00" not in txt, "C. an entry's data sent along is dropped")
    print("== D. ZZ TEST")
    c, r = fm(ZZ, ZG, result=RESULT)
    ok(c == 200 and len(FS.T["tally_fast_measures"]) == 2 and FS.T["tally_fast_measures"][1].get("book_id") == ZBOOK, "D. ZZ TEST, linked: kept (%s %s)" % (c, r))
    print("== E. without migration 148")
    FS.FAIL_INSERT["tally_fast_measures"] = {"message": 'relation "public.tally_fast_measures" does not exist', "code": "42P01"}
    c, r = fm(REAL, CG, result=RESULT)
    ok(c == 503 and "migration 148" in str(r.get("error")), "E. not set up yet (%s %s)" % (c, r))
finally:
    fn.terminate()
print()
if fails:
    print("".join(log[-30:]))
    print("FAILED: %d" % len(fails)); raise SystemExit(1)
print("PASSED: 0 failures")
