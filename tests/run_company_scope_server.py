"""python3 run_company_scope_server.py - release-240 security review S-M1 (09-Oct-2026): tally-ingest's kinds "selfcheck"
and "renumber_list" answer a computer only for a company IT named: in its own last heartbeat (the beat's open companies,
or its company list; any of its bridges' entries), or one it has sent recorder lines for before. Any other company of
the firm: a plain refusal, nothing listed, nothing recorded. A database error: generic words only (dbFail, S-L4).
The real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase (fake_supabase.py).
  1. computer B naming ZZ CO (open only on computer A): renumber_list refused, no entries; selfcheck compare and record
     refused, the database not asked, nothing recorded;
  2. computer A, its own company: as before;
  3. computer B, once it has sent recorder lines for ZZ CO: answered;
  4. an error: generic words only, never the database's own text.
Needs Deno (DENO, default: on the PATH)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "f-1"; KA, KB = "fcd_" + "1" * 48, "fcd_" + "2" * 48
CG = "7c5fd9b3-7235-4cbb-b4cd-1124be599189"
F.HONOR_LIMIT[0] = True
F.T["clients"] += [{"id": "c-1", "firm_id": FIRM, "name": "ZZ TEST", "tally_name": "ZZ CO", "gstin": "", "deleted": False},
                   {"id": "c-2", "firm_id": FIRM, "name": "YY TEST", "tally_name": "YY CO", "gstin": "", "deleted": False}]
F.T["tally_companies"] += [{"firm_id": FIRM, "company": "ZZ CO", "client_id": "c-1", "book_id": "b-1", "last_seen": "2026-10-01T00:00:00Z"},
                           {"firm_id": FIRM, "company": "YY CO", "client_id": "c-2", "book_id": "b-2", "last_seen": "2026-10-01T00:00:00Z"}]
def dev(i, key, name, beat): return {"id": i, "firm_id": FIRM, "name": name, "key_hash": hashlib.sha256(key.encode()).hexdigest(), "revoked": False,
                                     "info": {"beat": beat}, "version": "2.4.0"}
F.T["tally_devices"] += [dev("d-a", KA, "OFFICE-PC", {"open": ["ZZ CO"], "companies": [{"name": "ZZ CO"}]}),
                         dev("d-b", KB, "OTHER-PC", {"open": ["YY CO"], "companies": [{"name": "YY CO"}]})]
F.T.setdefault("tally_vouchers", []).extend([{"book_id": "b-1", "firm_id": FIRM, "guid": "%s-%08x" % (CG, m), "day": d, "alter_id": a, "vtype": "Receipt", "vno": n,
                                              "party": "", "narration": "", "cancelled": False, "optional": False, "deleted_at": None}
                                             for m, d, n, a in [(26311, "2026-10-05", "191", 54391), (26313, "2026-10-06", "193", 54393)]])
F.T.setdefault("tally_recorder_lines", [])
GOT = {}
real = F.rpc
BOOM = [False]
def rpc(fn, a):
    if fn in ("tally_selfcheck_compare", "tally_selfcheck_record"):
        GOT.setdefault(fn, []).append(a)
        if BOOM[0]: raise RuntimeError("SECRET-DETAIL duplicate key value violates unique constraint xyz")
        return {"ok": True, "n": 1, "missing": [], "received": 2} if fn.endswith("compare") else {"ok": True, "id": 7, "result": "ok", "words": "Checked."}
    return real(fn, a)
F.rpc = rpc
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
BR = {"id": "go-aaaaaa111111", "computer": "OFFICE-PC", "user": "u", "mode": "main", "runMode": "user", "version": "2.4.0"}
BRB = dict(BR, id="go-bbbbbb222222", computer="OTHER-PC")
REN = {"kind": "renumber_list", "version": "2.4.0", "company": "ZZ CO", "company_guid": CG, "vtype": "Receipt", "from": "20261005", "no": "191", "mid": "0", "limit": 500}
def sc(step, br, **kw): return dict({"kind": "selfcheck", "step": step, "version": "2.4.0", "bridge": br, "company": "ZZ CO", "company_guid": CG}, **kw)
REC = dict(night="20261006", ran_at="2026-10-06T23:10:00+05:30", altvchid=40, altmstid=9, after=1, listed=3, missing=0, fetched=0, still=0, deleted=0, mastersBehind=0, stopped="", fetchOff="", gapDays=[], since="")
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    # 1. computer B naming ZZ CO, which only computer A has open
    c, r = call(REN, KB)
    ok(c == 403 and r.get("ok") is False and "entries" not in r and r.get("error"), "1. B: renumber_list for A's company refused, nothing listed (%s %s)" % (c, r))
    c, r = call(sc("compare", BRB, entries=[[CG + "-00006667", 1]]), KB)
    ok(c == 403 and "missing" not in r and not GOT.get("tally_selfcheck_compare"), "1. B: selfcheck compare refused, the database not asked (%s %s)" % (c, r))
    c, r = call(sc("record", BRB, **REC), KB)
    ok(c == 403 and not GOT.get("tally_selfcheck_record"), "1. B: selfcheck record refused, nothing recorded (%s %s)" % (c, r))
    # 2. computer A, its own company
    c, r = call(REN, KA)
    ok(c == 200 and [e["no"] for e in r.get("entries") or []] == ["191", "193"], "2. A: renumber_list for its own company as before (%s %s)" % (c, r))
    c, r = call(sc("compare", BR, entries=[[CG + "-00006667", 1]]), KA)
    ok(c == 200 and len(GOT.get("tally_selfcheck_compare") or []) == 1, "2. A: selfcheck compare as before (%s)" % c)
    c, r = call(sc("record", BR, **REC), KA)
    ok(c == 200 and len(GOT.get("tally_selfcheck_record") or []) == 1, "2. A: selfcheck record as before (%s %s)" % (c, r))
    # 3. computer B once it has sent recorder lines for ZZ CO
    F.T["tally_recorder_lines"].append({"id": 91, "book_id": "b-1", "device_id": "d-b", "object_guid": CG + "-00006677", "master_id": "26231", "state": "applied", "event": "created"})
    c, r = call(REN, KB)
    ok(c == 200 and r.get("ok") is True, "3. B, with recorder lines for ZZ CO sent before: answered (%s)" % c)
    # 4. a database error: generic words only
    BOOM[0] = True
    c, r = call(sc("compare", BR, entries=[[CG + "-00006667", 1]]), KA)
    ok(c >= 500 and "SECRET-DETAIL" not in json.dumps(r) and r.get("error"), "4. a database error: generic words only (%s %s)" % (c, r))
    BOOM[0] = False
    F.FAIL_SELECT["tally_vouchers"] = {"message": "SECRET-DETAIL column vno does not exist", "code": "42703"}
    c, r = call(REN, KA)
    ok(c >= 500 and "SECRET-DETAIL" not in json.dumps(r), "4. renumber_list, a database error: generic words only (%s %s)" % (c, r))
    F.FAIL_SELECT.pop("tally_vouchers", None)
finally:
    fn.terminate()
    try: fn.wait(timeout=10)
    except Exception: fn.kill()
print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
if fails: print("".join(log[-30:]))
sys.exit(1 if fails else 0)
