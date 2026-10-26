"""python3 run_readonly_server.py - the evening security audit of 26-Oct-2026, M4 (the owner's approval of 26-Oct-2026): a
read-only member cannot write books through tally-ingest's signed-in path. The real cloud function
(server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py); never a real database.
  ATTACK: a read-only member's upload_new (which would also link a Tally company to the client), upload_done, upload_days,
    upload_ledgers, stage_days, reparse_queue and reparse are refused with words (403), and nothing is written (no company
    linked, no job, no day).
  Normal use: the same member may still wake the Tally computer and read a month's day files (month_days); staff and the
    owner upload as before; a session without the two-step is refused as before; the bridge's computer key path (hello)
    is untouched.
RED: run on the function before the fix (git stash) and the ATTACK lines fail.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, shutil, hashlib, threading, subprocess, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111111"
DEV, KEY = "d1000000-0000-0000-0000-000000000001", "fcd_" + "c" * 48
for t, u in (("tok-owner", "u-owner"), ("tok-staff", "u-staff"), ("tok-ro", "u-ro"), ("tok-aal1", "u-staff2")):
    FS.USERS[t] = {"id": u, "email": u + "@zz.test"}
FS.AAL1.add("tok-aal1")
FS.T["members"] += [{"user_id": "u-owner", "firm_id": FIRM, "role": "owner", "active": True}, {"user_id": "u-staff", "firm_id": FIRM, "role": "staff", "active": True},
                    {"user_id": "u-ro", "firm_id": FIRM, "role": "readonly", "active": True}, {"user_id": "u-staff2", "firm_id": FIRM, "role": "staff", "active": True}]
FS.T["clients"] += [{"id": "c-new", "firm_id": FIRM, "name": "NEW CO", "tally_name": "NEW CO", "gstin": "", "deleted": False},
                    {"id": "c-1", "firm_id": FIRM, "name": "ZZ UP", "tally_name": "ZZ UP", "gstin": "", "deleted": False}]
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "ZZ UP", "client_id": "c-1", "book_id": BOOK, "device_id": DEV, "last_seen": "2026-10-01T00:00:00Z"}]
FS.T["tally_books"] += [{"book_id": BOOK, "firm_id": FIRM, "client_id": "c-1", "company": "ZZ UP", "from_date": "2026-04-01", "open_as_on": "2026-03-31", "ledgers_at": None}]
FS.T["tally_devices"].append({"id": DEV, "firm_id": FIRM, "name": "PC1", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.4.4", "wake_token": None})
FS.T.setdefault("tally_ledgers", []); FS.T.setdefault("tally_groups", [])
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, tok="tok-owner", device=False):
    h = {"Content-Type": "application/json"}
    if device: h["x-fincom-device"] = KEY
    else: h["Authorization"] = "Bearer " + tok
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=h)
    try:
        r = urllib.request.urlopen(rq, timeout=60); b = r.read() or b"{}"
        try: return r.status, json.loads(b)
        except ValueError: return r.status, {"_binary": len(b)}          # month_days answers a packed month (binary)
    except urllib.error.HTTPError as e:
        b = e.read() or b"{}"
        try: return e.code, json.loads(b)
        except ValueError: return e.code, {"_raw": b[:200].decode("utf-8", "replace")}
WORDS = "Read-only members cannot upload or change the books"
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    n_jobs, n_days = len(FS.T["tally_jobs"]), len(FS.DAYS)
    # ---- ATTACK: a read-only member writing the books
    c, r = call({"kind": "upload_new", "client": "c-new", "name": "DayBook.xml", "size": 5, "from": "20260401", "to": "20260430"}, "tok-ro")
    linked = [x for x in FS.T["tally_companies"] if x.get("client_id") == "c-new"]
    ok(c == 403 and WORDS in r.get("error", "") and not linked and len(FS.T["tally_jobs"]) == n_jobs, "ATTACK: upload_new refused with words; no Tally company linked, no job (%s %s; linked %s)" % (c, r, linked))
    kinds = [("upload_done", {"job": "j-x", "path": FIRM + "/j-x.xml"}), ("upload_days", {"days": [{"day": "20260402", "gz": ""}]}),
             ("upload_ledgers", {"from": "20260401", "openAsOn": "20260331", "ledgers": [["Cash", "Cash-in-Hand", 0]]}), ("stage_days", {"job": "j-x", "days": []}),
             ("reparse_queue", {}), ("reparse", {"month": "202604"}), ("job_new", {})]
    res = {k: call(dict({"kind": k, "client": "c-1"}, **b), "tok-ro") for k, b in kinds}
    ok(all(c == 403 and WORDS in r.get("error", "") for c, r in res.values()) and len(FS.DAYS) == n_days and len(FS.T["tally_jobs"]) == n_jobs,
       "ATTACK: upload_done, upload_days, upload_ledgers, stage_days, reparse_queue, reparse, job_new refused; nothing written (%s)" % {k: v[0] for k, v in res.items()})
    # ---- normal use
    c, r = call({"kind": "wake", "what": "active"}, "tok-ro")
    ok(c != 403 and WORDS not in json.dumps(r), "normal use: a read-only member still wakes the Tally computer (%s)" % c)
    c, r = call({"kind": "month_days", "book": BOOK, "month": "202604"}, "tok-ro")
    ok(c != 403 and WORDS not in json.dumps(r), "normal use: and reads a month's day files (month_days: %s)" % c)
    c, r = call({"kind": "upload_new", "client": "c-1", "name": "DayBook.xml", "size": 5, "from": "20260401", "to": "20260430"}, "tok-staff")
    ok(c == 200 and r.get("job") and len(FS.T["tally_jobs"]) == n_jobs + 1, "normal use: staff upload_new as before (a job) (%s %s)" % (c, r))
    c, r = call({"kind": "upload_ledgers", "client": "c-1", "from": "20260401", "openAsOn": "20260331", "ledgers": [["Cash", "Cash-in-Hand", 0]]}, "tok-owner")
    ok(c == 200 and r.get("ok"), "normal use: the owner's ledgers as before (%s %s)" % (c, r))
    c, r = call({"kind": "upload_new", "client": "c-1", "name": "DayBook.xml", "size": 5, "from": "20260401", "to": "20260430"}, "tok-aal1")
    ok(c == 403 and "two-step" in r.get("error", ""), "a session without the two-step is refused as before (%s %s)" % (c, r))
    c, r = call({"kind": "hello", "computer": "PC1"}, device=True)
    ok(c == 200 and r.get("ok") is not False, "the bridge's computer key path is untouched (hello: %s %s)" % (c, str(r)[:120]))
finally:
    fn.kill()
    if fails: print("".join(log[-30:]))
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); sys.exit(1 if fails else 0)
