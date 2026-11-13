"""python3 run_day_retry_ingest.py - tally-ingest (server/tally-cloud/index.ts under Deno, against the stand-in for Supabase,
fake_supabase.py) for FinCom Bridge 2.5.16, item 2 (migration 197; the owner's YES of 13-Nov-2026: stops lift by themselves).
Checks:
  1. period_day_stop: tally_period_day_stop(book, day, why); the answer passed on ({ok, fails, upload, words on the 3rd day});
     a cloud without 197: 503 notReady (the bridge then stops the period as before); not a day: 400.
  2. a day held (tally_period_retry_days) is never handed out (period, check or gap day), and the period's and the check's
     lists are asked for that many more days; a cloud without 197: as before (asked again after 10 minutes).
  1b. a period_heads list read by type (via split) answers done false and partial.
  3. a pick-up refused with code dayRetry keeps FinCom's own words.
  4. the beat's tallyPortNotSaved (bridge 2.5.16) kept on the computer's beat, cleaned.
Needs Deno (DENO). Made-up books only."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
INDEX = os.environ.get("INDEX_TS") or os.path.join(SQLDIR, "index.ts")
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK = "99999999-9999-9999-9999-999999999182", "11111111-1111-1111-1111-111111111182"
DA, KA = "d1000000-0000-0000-0000-000000000160", "fcd_" + "f" * 48
CG = "a2f776bd-4a48-4f7d-9c73-48a8f087b160"
GA = {"id": "go-aaaaaa160160", "computer": "MADEUP-PC", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.10"}
CA = "2026-11-11T13:14:55.486421+00:00"
NEXT = [{"day": "20250831", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"},
        {"day": "20250830", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"},
        {"day": "20250831", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"},
        {"day": "20250901", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"}]
HELD = [[]]
GAPF = [[{"day": "20250831", "fetch": True, "chosenAt": CA, "check": True, "gap": True}]]
CHECK = [{"day": "20250831", "fetch": True, "chosenAt": CA, "check": True}, {"day": "20261111", "fetch": True, "chosenAt": CA, "check": True}]
ORDER = []
HELDD = [["20250831"]]
FAILS = [1]
NIGHT_MISSING = [False]     # a cloud with 160 but without 182 (no tally_gap_front with p_idle)
real = FS.rpc
def rpc(name, a):
    if name.startswith("tally_period") or name.startswith("tally_check") or name.startswith("tally_held") or name.startswith("tally_gap") or name.startswith("tally_period_retry") or name.startswith("tally_period_day"):
        FS.ARGS.setdefault(name, []).append(a); ORDER.append(name)
        if name in FS.NO_FN: raise LookupError("PGRST202")
        if name == "tally_gap_front" and "p_idle" in a and NIGHT_MISSING[0]: raise LookupError("PGRST202")
        if name in ("tally_period_next", "tally_period_next_paced"): return NEXT[: a["p_max"]]
        if name in ("tally_check_next", "tally_check_next_open"): return CHECK[: a["p_max"]]
        if name == "tally_period_gate": return True
        if name == "tally_held_front": return HELD[0][: a["p_max"]]
        if name == "tally_gap_front": return GAPF[0][: a["p_max"]]
        if name == "tally_period_retry_days": return HELDD[0]
        if name == "tally_period_day_stop": return {"ok": True, "fails": FAILS[0], "upload": FAILS[0] >= 3, "retryAt": "2026-11-14T10:00:00+00:00", "words": "Tally could not send 31-Aug-2025 in time on 3 days. Upload that day's Day Book to finish it." if FAILS[0] >= 3 else None}
        return {"ok": True}
    return real(name, a)
FS.rpc = rpc
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "MADE UP CO", "client_id": "c1", "book_id": BOOK}]
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "MADEUP-PC", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.10", "period_fetch": True})
FS.T["tally_books"] += [{"book_id": BOOK, "firm_id": FIRM, "client_id": "c1", "company": "MADE UP CO", "from_date": "2025-04-01", "open_as_on": "2025-03-31"}]
FS.T["clients"] += [{"id": "c1", "firm_id": FIRM, "name": "MADE UP CO", "tally_name": "MADE UP CO", "gstin": "", "deleted": False}]
FS.T["tally_sync_cursor"] = [{"book_id": BOOK, "company_guid": CG}]
FS.T.setdefault("tally_days", []); FS.T.setdefault("tally_jobs", [])
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", INDEX], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=SQLDIR)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA):
    h = {"Content-Type": "application/json", "x-fincom-device": key}
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=h)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except ValueError: return e.code, {}
TYPES6 = ["Sales", "Purchase", "Receipt", "Payment", "Journal", "Contra"]
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    base = {"version": "2.5.16", "bridge": GA}
    beat = dict(base, kind="beat", tally=True, open=["MADE UP CO"], companies=[{"name": "MADE UP CO", "open": True, "guid": CG}])
    days_of = lambda r: [x.get("day") for x in (r.get("periodDays") or [])]
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    h0 = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour
    dev.update(period_night_from=(h0 + 2) % 24, period_night_to=(h0 + 4) % 24, period_night_sunday=False)     # office hours now
    call(beat)                                                                                                 # the computer names its company
    print("== 1. period_day_stop")
    c, r = call(dict(base, kind="period_day_stop", company="MADE UP CO", company_guid=CG, day="20250831", why="over2s", words="w", chosenAt=CA))
    a = (FS.ARGS.get("tally_period_day_stop") or [{}])[-1]
    ok(c == 200 and r.get("ok") is True and r.get("fails") == 1 and r.get("upload") is False and "words" not in r, "1. the first: held (%s)" % r)
    ok(a.get("p_book") == BOOK and a.get("p_day") == "2025-08-31" and a.get("p_why") == "over2s", "1. tally_period_day_stop's arguments (%s)" % a)
    FAILS[0] = 3
    c, r = call(dict(base, kind="period_day_stop", company="MADE UP CO", company_guid=CG, day="20250831", why="window", chosenAt=CA))
    ok(c == 200 and r.get("upload") is True and "on 3 days" in str(r.get("words")), "1. the 3rd day: to upload, its words (%s)" % r)
    c, r = call(dict(base, kind="period_day_stop", company="MADE UP CO", company_guid=CG, day="2025-08-31", why="over2s", chosenAt=CA))
    ok(c == 400, "1. not a day: 400 (%s)" % r)
    FS.NO_FN.add("tally_period_day_stop")
    c, r = call(dict(base, kind="period_day_stop", company="MADE UP CO", company_guid=CG, day="20250831", why="over2s", chosenAt=CA))
    ok(c == 503 and r.get("notReady") is True, "1. a cloud without 197: 503 notReady (%s)" % r)
    FS.NO_FN.discard("tally_period_day_stop")
    for why in ("dates", "split"):
        c, r = call(dict(base, kind="period_day_stop", company="MADE UP CO", company_guid=CG, day="20250831", why=why, chosenAt=CA))
        a = (FS.ARGS.get("tally_period_day_stop") or [{}])[-1]
        ok(c == 200 and a.get("p_why") == why, "1. why %s passed on (%s)" % (why, a))
    print("== 1b. a list read type by type never closes the day")
    c, r = call(dict(base, kind="period_heads", company="MADE UP CO", company_guid=CG, day="20250831", via="split", partial=True, n=1, heads=[["g-1", 11, 5, "Sales"]], fetch=True))
    ph = (FS.ARGS.get("tally_period_heads") or [{}])[-1]
    ok(c == 200 and r.get("done") is False and r.get("partial") is True and ph.get("p_via") == "split", "1b. via split: done false, partial (%s; %s)" % (r, ph.get("p_via")))
    print("== 2. a held day is not handed out")
    time.sleep(5.2)
    np, nc = len(FS.ARGS.get("tally_period_next_paced") or []), len(FS.ARGS.get("tally_check_next_open") or [])
    c, r = call(beat)
    d = days_of(r)
    ok(c == 200 and "20250831" not in d and len(d) == 3, "2. 31-Aug held: not listed, 3 others are (%s)" % d)
    pa = (FS.ARGS.get("tally_period_next_paced") or [{}])[-1]
    ok(len(FS.ARGS.get("tally_period_next_paced") or []) > np and pa.get("p_max") == 4, "2. the period asked for one more day (%s)" % pa)
    un = (FS.ARGS.get("tally_period_unstamp") or [{}])[-1]
    ok(un.get("p_book") == BOOK and "2025-08-31" in (un.get("p_days") or []), "2. the held day a list handed back: its hand-out undone (%s)" % un)
    FS.NO_FN.add("tally_period_retry_days")
    time.sleep(5.2); c, r = call(beat)
    ok(c == 200 and "20250831" in days_of(r), "2. a cloud without 197: as before (%s)" % days_of(r))
    FS.NO_FN.discard("tally_period_retry_days")
    print("== 3. the dayRetry reason")
    pk = [{"company": "MADE UP CO", "guid": CG, "kind": "period", "chosenAt": CA, "takenAt": "2026-11-13T10:00:00Z", "state": "refused", "day": "20250831", "login": "madeup",
           "code": "dayRetry", "words": "anything", "at": "2026-11-13T10:00:01Z"}]
    time.sleep(5.2); c, r = call(dict(beat, pickups=pk))
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    got = ((dev.get("info") or {}).get("beat") or {}).get("pickups") or []
    ok(any(x.get("code") == "dayRetry" and x.get("words") == "Tally was slow for this day; FinCom Bridge tries it again by itself after a day (no action needed)" for x in got), "3. kept with FinCom's words (%s)" % got)
    print("== 4. bridge 2.5.16: Tally port not saved, kept on the beat")
    time.sleep(5.2); c, r = call(dict(beat, tallyPortNotSaved={"port": 9050, "iniPort": 9000, "words": "Tally port not saved: x" * 40, "extra": "dropped"}))
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    ns = ((dev.get("info") or {}).get("beat") or {}).get("tallyPortNotSaved") or {}
    ok(ns.get("port") == 9050 and ns.get("iniPort") == 9000 and len(ns.get("words", "")) == 400 and "extra" not in ns, "4. kept, cleaned (%s)" % {k: ns.get(k) for k in ("port", "iniPort")})
    time.sleep(5.2); c, r = call(dict(beat, tallyPortNotSaved=None))
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    ok("tallyPortNotSaved" not in ((dev.get("info") or {}).get("beat") or {}), "4. none said: none kept")
finally:
    fn.terminate()
    FS.stop() if hasattr(FS, "stop") else None
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
