"""python3 run_autoday_ingest.py - FinCom brings the days it needs from Tally by itself (the owner's decision of 24-Nov-2026:
"There should be proper way to tell and auto import of tally days into fincom"; the plan tally-tell-autoday, B.1-B.3, against
migration 222's contract). tally-ingest (server/tally-cloud/index.ts under Deno, against the stand-in for Supabase,
fake_supabase.py). Checks:
  1. the beat asks tally_autoday_queue(p_book) for each linked company it says open, before the book's days are handed
     out, once a book per 10 minutes; a company without a starting point too (its days are queued, not handed)
  2. a day FinCom queued by itself (tally_check_days.source held, delete, gap, future) goes to a bridge of 2.5.16 or later
     that serves the book (tally_days_claim) as an ordinary check day: no new kind, nothing else in it (no new Tally request)
  3. a bridge older than 2.5.16: none of those days, nor the held deletes' or the gap's days; a person's days as before
  4. a bridge not serving the book (no claim): no check day at all (with 222 only by claim), nor the held deletes' or the
     gap's days
  6. the check's days before the period's (a stuck line's day never waits behind older days)
  7. each new pick-up word of this bridge for a check day told to tally_autoday_pickup, once
  8. a day read in bands: 222's 5-argument tally_check_heads with the bands; the held deletes and the period's count only
     for whole bands; bands without their ranges (2.5.19-2.5.21): today's whole-day mapping; without 222: as before
  5. a cloud without 222: everything as before (asked again after 10 minutes)
Needs Deno (DENO). Made-up books only."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "99999999-9999-9999-9999-999999992220"
DA, KA = "d2220000-0000-0000-0000-000000002220", "fcd_" + "e" * 48
GA = {"id": "go-aaaaaa222022", "computer": "PC-MADEUP", "user": "madeup-a", "mode": "main", "runMode": "user", "version": "2.5.16"}
GB = {"id": "go-bbbbbb222022", "computer": "PC-MADEUP", "user": "madeup-b", "mode": "main", "runMode": "user", "version": "2.5.10"}
CA = "2026-11-24T05:00:00.123456+00:00"
BOOKS = {}     # company -> (book, guid)
for i, co in enumerate(["SERVED CO", "LONELY CO", "NOSTART CO", "OLDCLOUD CO"]):
    BOOKS[co] = ("1111111%d-1111-1111-1111-111111112220" % i, "a2f776bd-4a48-4f7d-9c73-48a8f08722%02d" % i)
BOOK_OF = {b: co for co, (b, g) in BOOKS.items()}
SERVE = {BOOKS["SERVED CO"][0]: [GA["id"], GB["id"]], BOOKS["NOSTART CO"][0]: [GA["id"]], BOOKS["OLDCLOUD CO"][0]: [GA["id"], GB["id"]]}
DAYS = {"20260410": "held", "20260411": "delete", "20260412": "future", "20260413": "gap", "20260414": "upload", "20260415": "fill"}
ORDER = []
PERIOD = [[]]
NO5 = [False]     # a cloud without 222's 5-argument tally_check_heads
real = FS.rpc
def rpc(name, a):
    if name.startswith("tally_period") or name.startswith("tally_check") or name.startswith("tally_held_front") or name.startswith("tally_gap_front") or name in ("tally_days_claim", "tally_autoday_queue", "tally_autoday_pickup"):
        FS.ARGS.setdefault(name, []).append(a); ORDER.append((name, a.get("p_book"), a.get("p_kind")))
        if name in FS.NO_FN: raise LookupError("PGRST202")
        if name == "tally_autoday_queue": return 2
        if name == "tally_autoday_pickup": return {"ok": True, "mine": True, "tries": 1, "retryAt": None}
        if name == "tally_check_heads" and "p_bands" in a and NO5[0]: raise LookupError("PGRST202")
        if name == "tally_check_heads": return {"ok": True, "mine": True, "n": len(a.get("p_heads") or []), "want": [], "done": a.get("p_via") != "split"}
        if name == "tally_period_heads": return {"ok": True, "n": len(a.get("p_heads") or []), "want": [], "done": a.get("p_via") != "split"}
        if name == "tally_period_gate": return True
        if name in ("tally_period_next", "tally_period_next_paced") or (name == "tally_days_claim" and a["p_kind"] == "period"): return PERIOD[0][: a["p_max"]]
        if name in ("tally_check_next", "tally_check_next_open") or name == "tally_days_claim":
            return [{"day": d, "fetch": True, "chosenAt": CA, "check": True} for d in sorted(DAYS, reverse=True)][: a["p_max"]]
        if name == "tally_held_front": return [{"day": "20260401", "chosenAt": CA}]
        if name == "tally_gap_front": return [{"day": "20260402", "chosenAt": CA}]
        if name == "tally_period_retry_days": return []
        return {"ok": True}
    if name == "tally_held_delete_by_heads":
        FS.ARGS.setdefault(name, []).append(a); return {"ok": True, "removed": 0}
    if name == "tally_read_serving_many":
        FS.ARGS.setdefault(name, []).append(a)
        return {b: [{"device": DA, "bridge": x, "guid": BOOKS[BOOK_OF[b]][1]} for x in SERVE.get(b, [])] for b in a["p_books"]}
    return real(name, a)
FS.rpc = rpc
FS.T["tally_sync_cursor"] = []
FS.T["tally_check_days"] = []
for i, (co, (book, guid)) in enumerate(BOOKS.items()):
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": co, "client_id": "c%d" % i, "book_id": book})
    FS.T["tally_books"].append({"book_id": book, "firm_id": FIRM, "client_id": "c%d" % i, "company": co, "from_date": "2026-04-01", "open_as_on": "2026-03-31"})
    FS.T["clients"].append({"id": "c%d" % i, "firm_id": FIRM, "name": co, "tally_name": co, "gstin": "", "deleted": False})
    FS.T["tally_sync_cursor"].append({"book_id": book, "company_guid": guid})
    for d, src in DAYS.items(): FS.T["tally_check_days"].append({"book_id": book, "firm_id": FIRM, "day": d[:4] + "-" + d[4:6] + "-" + d[6:], "source": src})
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.16", "period_fetch": True})
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
KEYS = {"company", "company_guid", "day", "fetch", "types", "chosenAt", "check", "kind"}
def beat(co, bridge=GA, **more):
    book, guid = BOOKS[co]
    ORDER.clear()
    c, r = call(dict({"version": bridge["version"], "bridge": bridge, "kind": "beat", "tally": True, "open": [co],
                      "companies": [{"name": co, "open": True, "guid": guid, "altvchid": 100, "altmstid": 50}], "lastKeySec": 600,
                      "reqs": {"day": "2026-11-24", "n": 3, "last": {"kind": "FinComCompany", "ms": 120, "at": "2026-11-24T10:00:00"}}}, **more))
    pd = [d for d in (r.get("periodDays") or []) if d.get("company") == co]
    return c, r, pd, sorted(d["day"] for d in pd)
def asked(name): return [x for x in ORDER if x[0] == name]
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    h0 = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour
    dev.update(period_night_from=h0, period_night_to=(h0 + 2) % 24, period_night_sunday=True)     # night: room for 30 days an answer
    SB = BOOKS["SERVED CO"][0]

    print("== 1 + 2. a 2.5.16 bridge serving the book")
    c, r, pd, days = beat("SERVED CO")
    q = asked("tally_autoday_queue")
    ok(c == 200 and q == [("tally_autoday_queue", SB, None)], "1. tally_autoday_queue asked for the book (%s)" % q)
    at = lambda n: next((i for i, x in enumerate(ORDER) if x[0] == n), 99)
    ok(at("tally_autoday_queue") < min(at("tally_days_claim"), at("tally_held_front"), at("tally_gap_front")), "1. before the book's days are handed out (%s)" % [x[0] for x in ORDER[:5]])
    want = sorted(list(DAYS) + ["20260401", "20260402"])
    ok(days == want, "2. every day handed: FinCom's own, the person's, the held delete and the gap's (%s)" % days)
    ok(all(d.get("kind") in ("check", "fill") for d in pd) and {d["day"]: d["kind"] for d in pd}.get("20260415") == "fill", "2. as check days (a fill as fill): no new kind (%s)" % {d["day"]: d["kind"] for d in pd})
    ok(all(set(d) <= KEYS for d in pd) and all(d.get("types") == ["Sales", "Purchase", "Receipt", "Payment", "Journal", "Contra"] for d in pd), "2. nothing else in a day: the bridge's existing day read (%s)" % pd[:1])
    c, r, pd, days = beat("SERVED CO")
    ok(not asked("tally_autoday_queue") and days == want, "1. a beat a moment later: not asked again (10 minutes), the days handed as before (%s)" % ORDER[:2])

    print("== 3. a bridge older than 2.5.16")
    c, r, pd, days = beat("SERVED CO", GB)
    ok(c == 200 and days == ["20260414", "20260415"], "3. only the person's days (upload, fill) (%s)" % days)
    ok(not asked("tally_held_front") and not asked("tally_gap_front"), "3. the held deletes' and the gap's days not asked for it (%s)" % [x[0] for x in ORDER])
    ok(r.get("ok") is True and "posts" in r, "3. the beat answered as ever (posting untouched)")

    print("== 4. a bridge not serving the book (no claim)")
    LB = BOOKS["LONELY CO"][0]
    c, r, pd, days = beat("LONELY CO")
    ok(asked("tally_autoday_queue") == [("tally_autoday_queue", LB, None)], "4. its days queued all the same (%s)" % asked("tally_autoday_queue"))
    ok(not [x for x in asked("tally_days_claim") if x[1] == LB] and days == [], "4. not by claim: no check day at all (222 hands them only by claim) (%s)" % days)
    ok(not asked("tally_check_next_open") and not asked("tally_check_next"), "4. the plain list not asked (%s)" % [x[0] for x in ORDER])
    ok(not asked("tally_held_front") and not asked("tally_gap_front"), "4. the held deletes' and the gap's days not asked")

    print("== 1b. a company without a starting point: queued, not handed")
    NB = BOOKS["NOSTART CO"][0]
    c, r, pd, days = beat("NOSTART CO", companies=[{"name": "NOSTART CO", "open": True, "guid": BOOKS["NOSTART CO"][1]}, {"name": "OTHER", "open": False, "altvchid": 4}])
    ok(asked("tally_autoday_queue") == [("tally_autoday_queue", NB, None)] and days == [], "1b. queued, none handed (%s, %s)" % (asked("tally_autoday_queue"), days))
    info = next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}
    t = ((info.get("bridges") or {}).get(GA["id"]) or {}).get("tell") or {}
    ok((t.get("unstarted") or {}).get("NOSTART CO", {}).get("why") == "noNumbers", "1b. the drop recorded on the bridge's tell (%s)" % t)

    print("== 6. the check's days before the period's")
    PERIOD[0] = [{"day": "2026050%d" % i, "fetch": True, "types": ["Sales"], "chosenAt": CA} for i in range(1, 10)]
    dev.update(period_night_from=(h0 + 2) % 24, period_night_to=(h0 + 4) % 24, period_night_sunday=False)     # by day: 3 an answer
    c, r, pd, days = beat("SERVED CO", lastKeySec=600)
    ok(len(pd) == 3 and all(d["kind"] in ("check", "fill") for d in pd) and asked("tally_days_claim")[0][2] == "check", "6. by day (3 an answer): the check's days fill it first (%s)" % [(d["day"], d["kind"]) for d in pd])
    PERIOD[0] = []
    dev.update(period_night_from=h0, period_night_to=(h0 + 2) % 24, period_night_sunday=True)

    print("== 7. pick-up words told to tally_autoday_pickup")
    def pk(day, state, code=None, kind="check", taken="2026-11-24T05:00:02Z"):
        x = {"company": "SERVED CO", "guid": BOOKS["SERVED CO"][1], "kind": kind, "chosenAt": "2026-11-24T05:00:00Z", "takenAt": taken, "state": state, "day": day, "at": "2026-11-24T05:00:03Z", "login": "madeup-a"}
        if state == "started": x.update(pickedUtc="2026-11-24T05:00:03Z", pickedAt="2026-11-24T05:00:03Z")
        else: x["code"] = code
        return x
    FS.ARGS.pop("tally_autoday_pickup", None)
    beat("SERVED CO", pickups=[pk("20260410", "refused", "slow"), pk("20260411", "started", kind="fill"), pk("20260412", "refused", "typing", kind="period")])
    said = sorted((x["p_day"], x["p_code"]) for x in FS.ARGS.get("tally_autoday_pickup") or [])
    ok(said == [("2026-04-10", "slow"), ("2026-04-11", "started")] and all(x["p_book"] == SB for x in FS.ARGS["tally_autoday_pickup"]), "7. this bridge's check days: slow and started; a period day's not (%s)" % said)
    beat("SERVED CO", pickups=[pk("20260410", "refused", "slow"), pk("20260411", "started", kind="fill")])
    ok(len(FS.ARGS.get("tally_autoday_pickup") or []) == 2, "7. the same words in the next beat: not told again (%d)" % len(FS.ARGS.get("tally_autoday_pickup") or []))
    beat("SERVED CO", pickups=[pk("20260410", "refused", "slow", taken="2026-11-24T06:00:02Z")])
    ok(len(FS.ARGS.get("tally_autoday_pickup") or []) == 3, "7. handed again, refused again: told again (%s; kept %s)" % (FS.ARGS.get("tally_autoday_pickup"), [(x.get("day"), x.get("takenAt"), x.get("state")) for x in ((next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}).get("beat") or {}).get("pickups") or []]))

    print("== 8. a day read in bands")
    H = [["g-%d" % m, m, 400 + m, "Payment"] for m in (5, 120)]
    def heads(**more):
        for k in ("tally_check_heads", "tally_held_delete_by_heads", "tally_period_heads"): FS.ARGS.pop(k, None)
        return call(dict({"version": "2.5.22", "bridge": GA, "kind": "period_heads", "company": "SERVED CO", "company_guid": BOOKS["SERVED CO"][1], "day": "20260410", "heads": H}, **more))
    c, r = heads(via="bands", bands=[[1, 100], [101, None]])
    ch = (FS.ARGS.get("tally_check_heads") or [{}])[-1]
    ok(c == 200 and ch.get("p_via") == "bands" and ch.get("p_bands") == [[1, 100], [101, None]], "8. whole bands: 222's call with the bands as they came (%s)" % ch)
    ok(FS.ARGS.get("tally_held_delete_by_heads") and (FS.ARGS.get("tally_period_heads") or [{}])[-1].get("p_via") == "day", "8. whole: the held deletes asked, the period's count as a whole day")
    c, r = heads(via="bands", bands=[[1, 100], [150, None]])
    ch = (FS.ARGS.get("tally_check_heads") or [{}])[-1]
    ok(ch.get("p_via") == "bands" and not FS.ARGS.get("tally_held_delete_by_heads") and (FS.ARGS.get("tally_period_heads") or [{}])[-1].get("p_via") == "split" and r.get("partial") is True,
       "8. a hole: no held delete, the period's count partial (%s)" % r)
    c, r = heads(via="bands")
    ch = (FS.ARGS.get("tally_check_heads") or [{}])[-1]
    ok(ch.get("p_via") == "day" and "p_bands" not in ch and FS.ARGS.get("tally_held_delete_by_heads") and r.get("partial") is not True and (FS.ARGS.get("tally_period_heads") or [{}])[-1].get("p_via") == "day",
       "8. bands without their ranges (bridges 2.5.19-2.5.21): as today, a whole day (4 arguments), so heavy days still close (%s)" % ch)
    c, r = heads(via="day")
    ok(len(FS.ARGS.get("tally_check_heads") or []) == 1 and "p_bands" not in FS.ARGS["tally_check_heads"][-1] and FS.ARGS.get("tally_held_delete_by_heads"), "8. a whole day: as before (4 arguments)")

    print("== 5. a cloud without 222")
    FS.NO_FN.update({"tally_autoday_queue"})
    OB = BOOKS["OLDCLOUD CO"][0]
    c, r, pd, days = beat("OLDCLOUD CO", GB)
    ok(c == 200 and days == want, "5. an older bridge: every day as before (%s)" % days)
    c, r, pd, days = beat("SERVED CO", GB)
    ok(days == want and not asked("tally_autoday_queue"), "5. not asked again for 10 minutes; as before (%s)" % days)
    c, r, pd, days = beat("LONELY CO")
    ok(asked("tally_check_next_open") and days == ["20260401", "20260402", "20260410", "20260411", "20260412", "20260413", "20260414", "20260415"], "5. a bridge not serving: the plain list as before (%s)" % days)
    NO5[0] = True
    c, r = heads(via="bands")
    ch = FS.ARGS.get("tally_check_heads") or []
    ok(c == 200 and ch and ch[-1].get("p_via") == "day" and "p_bands" not in ch[-1] and r.get("partial") is not True, "5. bands without 222: a whole day, as before (%s)" % ch[-1:])
    NO5[0] = False
    FS.NO_FN.discard("tally_autoday_queue")
finally:
    fn.terminate()
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
