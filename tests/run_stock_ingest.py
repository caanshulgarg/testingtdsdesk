"""python3 run_stock_ingest.py - FinCom Bridge 2.5.1 / migration 134 (the owner's decision of 30-Oct-2026, "1": the stock from
Tally ONLY when a person clicks): tally-ingest (server/tally-cloud/index.ts under Deno, against the stand-in for Supabase,
fake_supabase.py; never a real database). The migration's two functions are stood in for here as the SQL does them
(tests/run_migration134.py tests the SQL itself on pg_stand). Written before the code. Checks:
  A. the click ({kind:"wake", what:"stock", client, from, to}) from a signed-in member: tally_stock_ask with the book and the
     period; ONE computer, the company's own, woken on its own channel ("stock", {company, from, to, at, again}) and the
     click kept in its record for the heartbeat; the answer {asked, at}; no computer at all: said at once, nothing asked;
  B. a second click while it is on its way (60 s): nothing woken; a kept answer: {cached, read} with the figures, nothing woken;
     "Ask Tally again" (again): woken once more with again;
  C. the bridge's answer ({kind:"stock"}) reaches tally_stock_answer with the click's time, the figures as numbers, the
     status and words; an ok without figures, an unknown status, another company GUID, a company the computer never named:
     refused before the database;
  D. the heartbeat's answer carries the click (10 minutes), not an older one; a beat without a click carries no "stock";
  E. no period, a client not linked: plain words, nothing asked; a cloud without migration 134: "not set up yet".
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK = "99999999-9999-9999-9999-999999999251", "11111111-1111-1111-1111-111111111251"
DEV, KEY, CG = "d1000000-0000-0000-0000-000000000251", "fcd_" + "f" * 48, "a2f776bd-4a48-4f7d-9c73-48a8f087b251"
GO = {"id": "go-aaaaaa251251", "computer": "PC-S", "user": "user-s", "mode": "main", "runMode": "user", "version": "2.5.1"}
FS.USERS["tok-staff"] = {"id": "u-staff", "email": "staff@zz.test"}
FS.T["members"] += [{"user_id": "u-staff", "firm_id": FIRM, "role": "staff", "active": True}]
FS.T["clients"] += [{"id": "c1", "firm_id": FIRM, "name": "STOCK CO", "tally_name": "STOCK CO", "gstin": "", "deleted": False}, {"id": "c2", "firm_id": FIRM, "name": "LONE CO", "deleted": False}]
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "STOCK CO", "client_id": "c1", "book_id": BOOK, "device_id": DEV, "last_seen": "2026-10-30T00:00:00Z"}]
FS.T["tally_books"] += [{"book_id": BOOK, "firm_id": FIRM, "client_id": "c1", "company": "STOCK CO", "from_date": "2026-04-01", "open_as_on": "2026-03-31"}]
FS.T["tally_devices"].append({"id": DEV, "firm_id": FIRM, "name": "NWS144", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False,
                              "info": {"beat": {"open": ["STOCK CO"], "companies": [{"name": "STOCK CO", "open": True, "guid": CG}]}}, "version": "2.5.1", "wake_token": "tok251"})
# another of the firm's computers: the clicking person's own key, with the company open too (one click wakes ONE computer)
DEV2, KEY2 = "d2000000-0000-0000-0000-000000000251", "fcd_" + "9" * 48
FS.T["tally_devices"].append({"id": DEV2, "firm_id": FIRM, "name": "OFFICE", "key_hash": hashlib.sha256(KEY2.encode()).hexdigest(), "revoked": False, "created_by": "u-staff",
                              "info": {"beat": {"open": ["STOCK CO"]}}, "version": "2.5.1", "wake_token": "tok251b"})
FS.T["tally_sync_cursor"] = [{"book_id": BOOK, "company_guid": CG}]
# the migration's functions, as the SQL does them (run_migration134.py)
ROWS, MISSING = {}, {"on": False}
def now(): return datetime.datetime.now(datetime.timezone.utc)
real = FS.rpc
def rpc(fn, a):
    if fn.startswith("tally_stock_"):
        FS.ARGS.setdefault(fn, []).append(a)
        if MISSING["on"]: raise LookupError("PGRST202 Could not find the function public.%s" % fn)
    if fn == "tally_stock_ask":
        k = (a["p_book"], a["p_from"], a["p_to"])
        r = ROWS.setdefault(k, {"status": "asked", "click_at": "", "asked_at": now() - datetime.timedelta(hours=1), "period_from": a["p_from"], "period_to": a["p_to"]})
        if r["status"] == "ok" and not a["p_again"]: return {"ok": True, "ask": False, "cached": True, "row": dict(r, asked_at=str(r["asked_at"]))}
        if r["click_at"] and r["status"] == "asked" and r["asked_at"] > now() - datetime.timedelta(seconds=60): return {"ok": True, "ask": False, "pending": True, "row": dict(r, asked_at=str(r["asked_at"]))}
        at = now().strftime("%Y-%m-%dT%H:%M:%S.%fZ"); r.update(status="asked", words="", asked_at=now(), click_at=at)
        return {"ok": True, "ask": True, "at": at, "row": dict(r, asked_at=str(r["asked_at"]))}
    if fn == "tally_stock_answer":
        r = ROWS.get((a["p_book"], a["p_from"], a["p_to"]))
        if not r or r["click_at"] != a["p_at"]: return {"ok": False, "unknown": True, "error": "no such click from FinCom"}
        if r["status"] != "asked" and not (a["p_status"] == "ok" and r["status"] in ("notopen", "busy")): return {"ok": False, "unknown": True, "answered": True, "error": "this click was answered already"}
        if a["p_status"] == "ok": r.update(status="ok", opening=a["p_opening"], closing=a["p_closing"], read_at=a["p_read_at"])
        else: r.update(status=a["p_status"], words=a["p_words"])
        return {"ok": True}
    return real(fn, a)
FS.rpc = rpc
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, device=True):
    h = {"Content-Type": "application/json"}
    if device: h["x-fincom-device"] = KEY; body = dict({"version": "2.5.1", "bridge": GO}, **body)
    else: h["Authorization"] = "Bearer tok-staff"
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=h)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def wakes(): return [m for b in FS.BCAST for m in (b.get("messages") or [b]) if m.get("event") == "stock"]
def info(): return next(d for d in FS.T["tally_devices"] if d["id"] == DEV).get("info") or {}
click = lambda **k: call(dict({"kind": "wake", "what": "stock", "client": "c1", "from": "20260401", "to": "20261031"}, **k), device=False)
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    print("== A. the click")
    c, r = click()
    ask = (FS.ARGS.get("tally_stock_ask") or [{}])[-1]
    ok(c == 200 and r.get("asked") is True and r.get("at") and ask.get("p_book") == BOOK and ask.get("p_from") == "2026-04-01" and ask.get("p_to") == "2026-10-31" and ask.get("p_again") is False and ask.get("p_user") == "u-staff",
       "A. tally_stock_ask with the book, the period and who clicked (%s; %s)" % (r, ask))
    W = wakes()
    ok(len(W) == 1 and W[0].get("topic") == "tb-tok251" and W[0].get("payload") == {"company": "STOCK CO", "from": "20260401", "to": "20261031", "at": r.get("at"), "again": False}, "A. the computer woken on its own channel with the click (%s)" % W)
    ok((info().get("stock") or {}).get("STOCK CO") == {"from": "20260401", "to": "20261031", "at": r.get("at"), "again": False}, "A. the click kept in the computer's record for the heartbeat (%s)" % info().get("stock"))
    d2 = next(d for d in FS.T["tally_devices"] if d["id"] == DEV2)
    ok(not [m for m in W if m.get("topic") == "tb-tok251b"] and not (d2.get("info") or {}).get("stock") and r.get("woken") == 1 and r.get("told") == 1, "A. ONE computer woken (the company's own), not the person's other computer with it open (%s)" % r)
    at1 = r.get("at")

    print("== B. once per period")
    c, r = click()
    ok(c == 200 and r.get("asked") is False and r.get("pending") is True and len(wakes()) == 1, "B. a second click on its way: nothing woken (%s)" % r)

    print("== C. the bridge's answer")
    ans = {"kind": "stock", "company": "STOCK CO", "company_guid": CG, "from": "20260401", "to": "20261031", "at": at1, "status": "ok", "opening": 908443072.58, "closing": 2182130465.82,
           "readAt": "2026-10-30T10:12:00Z", "ms": 412, "holdMs": 160, "again": False}
    for why, b in (("an ok without figures", dict(ans, closing=None)), ("an unknown status", dict(ans, status="great")), ("figures as text", dict(ans, opening="908443072.58"))):
        n = len(FS.ARGS.get("tally_stock_answer") or [])
        c, r = call(b)
        ok(c == 400 and len(FS.ARGS.get("tally_stock_answer") or []) == n, "C. %s: refused before the database (%s %s)" % (why, c, r))
    c, r = call(dict(ans, company_guid="other-guid"))
    ok(c == 409 and r.get("otherGuid") is True, "C. another company GUID: refused (%s)" % r)
    c, r = call(dict(ans, company="NOT NAMED CO"))
    ok(c in (403, 409), "C. a company this computer is not linked to or never named: refused (%s %s)" % (c, r))
    c, r = call(ans)
    a = (FS.ARGS.get("tally_stock_answer") or [{}])[-1]
    ok(c == 200 and a.get("p_at") == at1 and a.get("p_opening") == 908443072.58 and a.get("p_closing") == 2182130465.82 and a.get("p_status") == "ok" and a.get("p_read_at", "").startswith("2026-10-30T10:12:00")
       and a.get("p_ms") == 412 and a.get("p_hold") == 160 and a.get("p_from") == "2026-04-01", "C. taken against the click, the figures as numbers (%s; %s)" % (r, a))
    c, r = call(dict(ans, status="slow", opening=None, closing=None, readAt=None, words="late"))
    ok(c == 409 and r.get("unknown") is True, "C. a second answer to the same click: refused (%s)" % r)
    c, r = call(dict(ans, at="2026-01-01T00:00:00.000000Z"))
    ok(c == 409 and r.get("unknown") is True, "C. an answer to a click FinCom never sent: refused (%s)" % r)
    c, r = click()
    ok(r.get("asked") is False and r.get("cached") is True and (r.get("read") or {}).get("opening") == 908443072.58 and (r.get("read") or {}).get("status") == "ok" and len(wakes()) == 1,
       "B. a kept answer: given back, nothing woken (%s)" % r)
    c, r = click(again=True)
    W = wakes()
    ok(r.get("asked") is True and len(W) == 2 and W[-1]["payload"]["again"] is True and r.get("at") != at1, "B. Ask Tally again: woken once more, with again (%s)" % r)
    at2 = r.get("at")
    c, r = call(dict(ans, at=at2, status="slow", opening=None, closing=None, readAt=None, words="Tally took too long; type the stock or try again later"))
    a = (FS.ARGS.get("tally_stock_answer") or [{}])[-1]
    ok(c == 200 and a.get("p_status") == "slow" and a.get("p_words") == "Tally took too long; type the stock or try again later" and a.get("p_opening") is None, "C. slow: the owner's words (%s)" % a)

    print("== D. the heartbeat")
    beat = {"kind": "beat", "tally": True, "open": ["STOCK CO"], "companies": [{"name": "STOCK CO", "open": True, "guid": CG}]}
    c, r = click(again=True); at3 = r.get("at")
    c, r = call(beat)
    ok(c == 200 and at3 and (r.get("stock") or {}).get("STOCK CO", {}).get("at") == at3 and r["stock"]["STOCK CO"].get("again") is True, "D. the beat carries a click not yet answered (%s)" % r.get("stock"))
    d = next(x for x in FS.T["tally_devices"] if x["id"] == DEV)
    d["info"] = dict(d["info"], stock={"STOCK CO": {"from": "20260401", "to": "20261031", "at": (now() - datetime.timedelta(minutes=11)).strftime("%Y-%m-%dT%H:%M:%S.%fZ"), "again": False}})
    c, r = call(beat)
    ok(c == 200 and "stock" not in r, "D. a click older than 10 minutes: not carried (%s)" % r.get("stock"))

    print("== E. plain words")
    c, r = click(**{"from": ""})
    ok(c == 400 and "period" in r.get("error", ""), "E. no period: plain words (%s)" % r)
    c, r = click(**{"from": "20260230"})
    ok(c == 400 and "period" in r.get("error", ""), "E. a day that is not one (30-Feb): plain words, not a failure (%s %s)" % (c, r))
    n = len(FS.ARGS.get("tally_stock_ask") or [])
    c, r = click(client="c2")
    ok(c == 200 and r.get("notLinked") is True and len(FS.ARGS.get("tally_stock_ask") or []) == n, "E. a client not linked: said, nothing asked (%s)" % r)
    for d in FS.T["tally_devices"]: d["revoked"] = True
    n = len(FS.ARGS.get("tally_stock_ask") or [])
    c, r = click(**{"from": "20261101", "to": "20261130"})
    ok(r.get("noComputer") is True and len(FS.ARGS.get("tally_stock_ask") or []) == n, "A. no computer of the firm: said at once, nothing asked (%s)" % r)
    for d in FS.T["tally_devices"]: d["revoked"] = False
    MISSING["on"] = True
    c, r = click(**{"from": "20261001"})
    ok(r.get("notSetUp") is True and "not set up" in r.get("error", ""), "E. a cloud without migration 134: not set up yet (%s)" % r)
finally:
    fn.terminate()
if fails: print("".join(log[-40:]))
print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
raise SystemExit(1 if fails else 0)
