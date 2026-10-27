"""python3 run_upload_roles.py - security fix batch 1 (verify-browser-known.md item 5, 27-Oct-2026): a person signed in to
FinCom writes the firm's Tally books through tally-ingest only as the firm's owner or staff. A member who may only look
(role 'readonly') is refused with 403 "Only the firm's owner or staff can upload books or link Tally." on every kind that
writes: linking a client's Tally company, job_new, stage_days, upload_new, upload_fail, upload_done, upload_days,
upload_ledgers, reparse, reparse_queue and install_log; nothing is written for them (no tally_companies row, no job, no
queue message, no file). What only reads stays open to them: month_days and wake. Staff and the owner work as before;
the database's timer (x-fincom-work) and a computer's key (x-fincom-device) are not touched by the check.
The real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py).
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, gzip, base64, copy, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
REFUSED = "Only the firm's owner or staff can upload books or link Tally."
FIRM, BOOK, CID, NEWCID = "f-1", "b-1", "c-1", "c-2"
KEY = "fcd_" + "e" * 48
F.USERS.update({"tok-owner": {"id": "u-owner", "email": "o@zz.test"}, "tok-staff": {"id": "u-staff", "email": "s@zz.test"},
                "tok-look": {"id": "u-look", "email": "l@zz.test"}, "tok-off": {"id": "u-off", "email": "x@zz.test"}})
F.T["members"] += [{"user_id": "u-owner", "firm_id": FIRM, "role": "owner", "active": True},
                   {"user_id": "u-staff", "firm_id": FIRM, "role": "staff", "active": True},
                   {"user_id": "u-look", "firm_id": FIRM, "role": "readonly", "active": True},
                   {"user_id": "u-off", "firm_id": FIRM, "role": "staff", "active": False}]
F.T["clients"] += [{"id": CID, "firm_id": FIRM, "name": "ZZ ROLES", "tally_name": "ZZ ROLES", "gstin": "", "deleted": False},
                   {"id": NEWCID, "firm_id": FIRM, "name": "ZZ NEW", "tally_name": "ZZ NEW", "gstin": "", "deleted": False}]
F.T["tally_companies"] += [{"firm_id": FIRM, "company": "ZZ ROLES", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-01T00:00:00Z"}]
F.T["tally_books"] += [{"book_id": BOOK, "firm_id": FIRM}]
F.T.setdefault("tally_days", [])
F.T["tally_devices"] += [{"id": "d-1", "firm_id": FIRM, "key_hash": __import__("hashlib").sha256(KEY.encode()).hexdigest(), "revoked": False, "name": "PC", "info": {}, "created_by": "u-owner"}]
# an upload already started by the owner (upload_fail / upload_done by someone who may only look)
F.T["tally_jobs"] += [{"id": "job-up", "firm_id": FIRM, "client_id": CID, "book_id": BOOK, "kind": "upload", "sealed": False, "status": "queued", "total": 30, "done": 0,
                       "upload": {"path": FIRM + "/job-up.xml", "from": "20260401", "to": "20260430", "size": 5, "name": "DayBook.xml"}},
                      {"id": "job-db", "firm_id": FIRM, "client_id": CID, "book_id": BOOK, "kind": "daybook", "sealed": False, "status": "queued", "total": 1, "done": 0}]
F.FILES["tally-uploads/" + FIRM + "/job-up.xml"] = b"<x/>\n"
srv = F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, tok=None, headers=None):
    h = {"Content-Type": "application/json"}; h.update(headers or {})
    if tok: h["Authorization"] = "Bearer " + tok
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=h)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except ValueError: return e.code, {}
gz = lambda s: base64.b64encode(gzip.compress(s.encode())).decode()
DAY = {"day": "20260402", "gz": gz("<ENVELOPE></ENVELOPE>")}
WRITES = [
    ("link a company (upload_new for a client with none)", {"kind": "upload_new", "client": NEWCID, "company": "ZZ NEW", "name": "D.xml", "size": 10, "from": "20260401", "to": "20260430"}),
    ("job_new", {"kind": "job_new", "client": CID, "total": 3, "name": "DayBook.xml"}),
    ("stage_days", {"kind": "stage_days", "client": CID, "job": "job-db", "days": [DAY], "last": True}),
    ("upload_new", {"kind": "upload_new", "client": CID, "name": "D.xml", "size": 10, "from": "20260401", "to": "20260430"}),
    ("upload_fail", {"kind": "upload_fail", "client": CID, "job": "job-up", "reason": "test"}),
    ("upload_done", {"kind": "upload_done", "client": CID, "job": "job-up", "path": FIRM + "/job-up.xml"}),
    ("upload_days", {"kind": "upload_days", "client": CID, "days": [DAY]}),
    ("upload_ledgers", {"kind": "upload_ledgers", "client": CID, "ledgers": [{"name": "Cash", "parent": "Cash-in-Hand"}], "groups": []}),
    ("reparse", {"kind": "reparse", "client": CID, "month": "202604"}),
    ("reparse_queue", {"kind": "reparse_queue", "client": CID}),
    ("install_log", {"kind": "install_log", "text": "setup log", "name": "install.log"}),
]
def state():
    return json.dumps({"T": {k: F.T.get(k) for k in ("tally_companies", "tally_jobs", "tally_books", "tally_devices")}, "Q": F.QUEUE,
                       "files": sorted(F.FILES), "days": F.DAYS, "args": {k: len(v) for k, v in F.ARGS.items() if k not in ("mfa_ok", "tally_book_for", "tally_work_key_ok")}}, sort_keys=True, default=str)
try:
    t0 = time.time()
    while time.time() - t0 < 120 and not any("Listening" in l for l in log): time.sleep(0.2)
    ok(any("Listening" in l for l in log), "tally-ingest started under Deno")

    print("-- a member who may only look: every write refused, nothing written")
    for name, body in WRITES:
        before = state()
        c, r = call(body, "tok-look")
        ok(c == 403 and r.get("error") == REFUSED, "%s: refused 403 with the plain message (%s %s)" % (name, c, r.get("error")))
        ok(state() == before, "%s: nothing written for them" % name)
    ok(not any(x.get("client_id") == NEWCID for x in F.T["tally_companies"]), "no Tally company linked for the look-only member")
    print("-- what only reads stays open to them")
    c, r = call({"kind": "month_days", "book": "00000000-0000-0000-0000-000000000001", "month": "202604"}, "tok-look")
    ok(c == 404 and "No such book" in str(r.get("error")), "month_days: answered as for anyone in the firm (%s %s)" % (c, r))
    c, r = call({"kind": "wake", "what": "active"}, "tok-look")
    ok(c == 200 and r.get("ok") is True, "wake: open (%s %s)" % (c, r))
    c, r = call({"kind": "job_new", "client": CID, "total": 1}, "tok-off")
    ok(c == 403 and "not part of a firm" in str(r.get("error")), "a switched-off member: refused as before (%s)" % c)

    print("-- staff and the owner work as before")
    for tok in ("tok-staff", "tok-owner"):
        c, r = call({"kind": "job_new", "client": CID, "total": 2, "name": "DayBook.xml"}, tok)
        ok(c == 200 and r.get("job"), "%s: job_new made a job (%s %s)" % (tok, c, r))
        c, r = call({"kind": "upload_new", "client": CID, "name": "D.xml", "size": 10, "from": "20260401", "to": "20260430"}, tok)
        ok(c == 200 and r.get("job") and r.get("path"), "%s: upload_new started an upload (%s %s)" % (tok, c, r.get("error")))
        c, r = call({"kind": "upload_ledgers", "client": CID, "ledgers": [{"name": "Cash", "parent": "Cash-in-Hand"}], "groups": []}, tok)
        ok(c != 403, "%s: upload_ledgers not refused (%s %s)" % (tok, c, r.get("error")))
        c, r = call({"kind": "install_log", "text": "log of " + tok, "name": "i.log"}, tok)
        ok(c == 200 and r.get("path"), "%s: install_log kept (%s)" % (tok, c))
    c, r = call({"kind": "upload_new", "client": NEWCID, "company": "ZZ NEW", "name": "D.xml", "size": 10, "from": "20260401", "to": "20260430"}, "tok-staff")
    ok(any(x.get("client_id") == NEWCID and x.get("linked_by") == "u-staff" for x in F.T["tally_companies"]), "staff: a client's Tally company linked (%s %s)" % (c, r.get("error")))
    c, r = call({"kind": "reparse_queue", "client": CID}, "tok-staff")
    ok(c == 403 and "owner" in str(r.get("error")) and r.get("error") != REFUSED, "staff: reparse_queue still the owner's alone (%s)" % c)
    c, r = call({"kind": "reparse_queue", "client": CID}, "tok-owner")
    ok(c == 200 and r.get("job"), "owner: reparse_queue works (%s %s)" % (c, r.get("error")))

    print("-- the database's timer and a computer's key are not touched by the check")
    c, r = call({"kind": "work"}, None, {"x-fincom-work": F.WORK_KEY})
    ok(c == 200 and r.get("ok") is True, "x-fincom-work: the queue's worker runs (%s)" % c)
    c, r = call({"kind": "work"}, None, {"x-fincom-work": "nope"})
    ok(c == 401, "x-fincom-work: a wrong key refused as before (%s)" % c)
    c, r = call({"kind": "hello", "version": "2.4.7", "info": {"computer": "PC"}}, None, {"x-fincom-device": KEY})
    ok(c == 200 and r.get("ok") is not False, "x-fincom-device: a computer's hello answered (%s %s)" % (c, r.get("error")))
finally:
    fn.terminate()
    try: fn.wait(10)
    except Exception: fn.kill()
    srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
if fails: print("\n".join(log[-30:]))
sys.exit(1 if fails else 0)
