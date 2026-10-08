"""python3 run_selfcheck_server.py - (07-Oct-2026, next release, item e: the nightly self-check; migration 65) tally-ingest's
kind "selfcheck" through the real cloud function (server/tally-cloud/index.ts) under Deno against the stand-in for Supabase
(fake_supabase.py); the database's tally_selfcheck_compare / tally_selfcheck_record are answered by the stand-in here (what
reaches them is checked; their SQL is tests/run_migration65.py's). Needs Deno (DENO).
Checks: compare passes the book and the entries [guid, alter] (cut to size, a bad AlterID null, rows without a GUID dropped)
and answers the database's {missing, received}; more than 5000 entries 413; record passes firm, book, the computer key, the
bridge id and the result with every number a whole number in range (else null) and texts cut; an unknown step 400; an
unlinked company 409 notLinked; a cloud without migration 65 answers 503 notReady for both steps; at most 30 calls a minute
from one computer (429).
RED (before the change): every call answers 400 'unknown kind'."""
import os, sys, json, time, hashlib, subprocess, urllib.request, shutil, threading
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as F
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, CID = "f-1", "b-1", "c-1"; KEY, KEY2 = "fcd_" + "e" * 48, "fcd_" + "f" * 48
CG = "78257d7a-c68a-4ffc-a253-148c60566464"
F.T["clients"].append({"id": CID, "firm_id": FIRM, "name": "ZZ TEST", "tally_name": "ZZ CO", "gstin": "", "deleted": False})
F.T["tally_companies"].append({"firm_id": FIRM, "company": "ZZ CO", "client_id": CID, "book_id": BOOK, "last_seen": "2026-10-06T00:00:00Z"})
F.T["tally_devices"].append({"id": "d-1", "firm_id": FIRM, "name": "OFFICE-PC", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.3.1"})
F.T["tally_devices"].append({"id": "d-2", "firm_id": FIRM, "name": "OTHER-PC", "key_hash": hashlib.sha256(KEY2.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.3.1"})
GOT = {}
real = F.rpc
def rpc(fn, a):
    if fn == "tally_selfcheck_compare":
        GOT.setdefault(fn, []).append(a)
        return {"ok": True, "n": len(a["p_entries"]), "missing": [{"guid": a["p_entries"][0][0], "why": "absent", "alter": a["p_entries"][0][1], "have": None}], "received": 30}
    if fn == "tally_selfcheck_record":
        GOT.setdefault(fn, []).append(a)
        return {"ok": True, "id": 7, "result": "fetched", "words": "Checked on the night of 06-Oct-2026 at 23:10 IST: 1 entry missing from FinCom; fetched from Tally.", "copy": {"ok": True}}
    return real(fn, a)
F.rpc = rpc
F.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % F.PORT, SUPABASE_SERVICE_ROLE_KEY=F.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KEY):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
BR = {"id": "go-aaaaaa111111", "computer": "OFFICE-PC", "user": "u", "mode": "main", "runMode": "user", "version": "2.3.2"}
BR2 = dict(BR, id="go-bbbbbb222222", computer="OTHER-PC")    # a bridge id belongs to one computer key
def sc(step, **kw): return dict({"kind": "selfcheck", "step": step, "version": "2.3.2", "bridge": BR, "company": "ZZ CO", "company_guid": CG}, **kw)
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    print("== compare")
    ents = [[CG + "-00000002", 2, 2, "20261006"], [" " + CG + "-00000003 ", "x", 3, "20261006"], ["", 4, 4, "20261006"], "junk", [CG + "-00000005", -1, 5, "20261006"], ["g" * 300, 1e16, 1, "20261006"]]
    c, r = call(sc("compare", after=1, altvchid=6, entries=ents))
    a = (GOT.get("tally_selfcheck_compare") or [{}])[-1]
    ok(c == 200 and r.get("received") == 30 and r.get("missing", [{}])[0].get("why") == "absent", "compare answers the database's answer (%s %s)" % (c, r))
    ok(a.get("p_book") == BOOK and a.get("p_entries") == [[CG + "-00000002", 2], [CG + "-00000003", None], [CG + "-00000005", None], ["g" * 100, None]],
       "the book and the entries [guid, alter] cut to size, a bad AlterID null, no GUID dropped (%s)" % a.get("p_entries"))
    c, r = call(sc("compare", entries=[["g", 1]] * 5001))
    ok(c == 413 and len(GOT.get("tally_selfcheck_compare") or []) == 1, "more than 5000 entries: 413, the database not asked (%s)" % c)
    c, r = call(sc("compare", entries="nope"))
    ok(c == 400, "entries not a list: 400 (%s)" % c)
    print("== record")
    c, r = call(sc("record", night="20261006", ran_at="2026-10-06T23:10:00+05:30", altvchid=40, altmstid=9, after=1, listed=3, missing=1, fetched=1, still=0, deleted=0,
                   mastersBehind=0, stopped="", fetchOff="x" * 400, gapDays=["20261003", "bad", 5, "20261005"], since="20261005"))
    a = (GOT.get("tally_selfcheck_record") or [{}])[-1]
    p = a.get("p_r") or {}
    ok(c == 200 and r.get("result") == "fetched" and r.get("words", "").startswith("Checked on the night"), "record answers the result and its words (%s %s)" % (c, r))
    ok(a.get("p_firm") == FIRM and a.get("p_book") == BOOK and a.get("p_device") == "d-1" and a.get("p_bridge") == "go-aaaaaa111111", "firm, book, the computer key and the bridge id passed (%s)" % {k: a.get(k) for k in ("p_firm", "p_book", "p_device", "p_bridge")})
    ok(p.get("listed") == 3 and p.get("missing") == 1 and p.get("fetched") == 1 and p.get("altvchid") == 40 and p.get("night") == "20261006" and p.get("since") == "20261005"
       and p.get("gapDays") == ["20261003", "20261005"] and len(p.get("fetchOff", "")) == 300 and p.get("company_guid") == CG, "the result's fields, cut and checked (%s)" % p)
    c, r = call(sc("record", listed=-1, missing=1.5, altvchid=1e16, night="2026-10-06"))
    p = (GOT.get("tally_selfcheck_record") or [{}])[-1].get("p_r") or {}
    ok(c == 200 and p.get("listed") is None and p.get("missing") is None and p.get("altvchid") is None and p.get("night") == "", "numbers out of range null, a night not yyyymmdd empty (%s)" % p)
    c, r = call(sc("other"))
    ok(c == 400 and "step" in r.get("error", ""), "an unknown step: 400 (%s %s)" % (c, r))
    c, r = call(dict(sc("compare", entries=[]), company="NOT LINKED"))
    ok(c == 409 and r.get("notLinked") is True, "an unlinked company: 409 notLinked (%s)" % c)
    print("== a cloud without migration 65")
    F.NO_FN.update({"tally_selfcheck_compare", "tally_selfcheck_record"})
    c1, r1 = call(sc("compare", entries=[[CG + "-00000002", 2]], bridge=BR2), key=KEY2)
    c2, r2 = call(sc("record", listed=0, bridge=BR2), key=KEY2)
    ok(c1 == 503 and r1.get("notReady") is True and c2 == 503 and r2.get("notReady") is True and "migration 65" in r1.get("error", ""), "503 notReady for both steps (%s %s)" % (c1, c2))
    F.NO_FN.difference_update({"tally_selfcheck_compare", "tally_selfcheck_record"})
    print("== at most 30 a minute from one computer")
    codes = [call(sc("record", listed=0))[0] for _ in range(30)]
    # this computer sent 5 counted calls above (2 compares and a refused one, 2 records): 25 more go, then 429
    ok(codes.count(200) == 25 and codes[25:] == [429] * 5, "429 once the computer has sent thirty in a minute (%s)" % codes)
    ok(call(sc("record", listed=0, bridge=BR2), key=KEY2)[0] == 200, "another computer is not held by it")
finally:
    fn.terminate()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
