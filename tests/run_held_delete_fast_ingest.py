"""python3 run_held_delete_fast_ingest.py - tally-ingest (server/tally-cloud/index.ts under Deno, against the stand-in for
Supabase, fake_supabase.py) for next-fast-delete (migration 158). Staging, 11-Nov-2026: an entry deleted in Tally reached
FinCom as a recorder line without the entry's GUID (held); the day check removed it 3.5 minutes later (133: a second
whole-day list a minute or more after the first). No new Tally request: the day goes through the older-entries path the
bridge already has (periodDays -> period_heads). Made-up books only. Written before the code. Checks:
  1. the beat: the day of a held delete from THIS bridge (tally_held_front: the book, this computer, this bridge, the room
     of the answer) comes FIRST in periodDays, before the period's days, as a check day (fetch, Tally's six standard types,
     its choice time, the company and its GUID), and is never listed twice (the check's own list naming it again);
     tally_held_front returning nothing: the order as before; a cloud without 158: as before (and not asked again at once).
  2. period_heads: a whole-day list (via day) first goes to tally_held_delete_by_heads (the book, the day, the heads as
     four columns, this computer and bridge), BEFORE tally_check_heads; a split list or an empty one: not; its failure never fails the call; a cloud
     without 158: as before.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno). INDEX_TS: another index.ts (the red run)."""
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
FIRM, BOOK = "99999999-9999-9999-9999-999999999158", "11111111-1111-1111-1111-111111111158"
DA, KA = "d1000000-0000-0000-0000-000000000158", "fcd_" + "e" * 48
CG = "a2f776bd-4a48-4f7d-9c73-48a8f087b158"
GA = {"id": "go-aaaaaa158158", "computer": "MADEUP-PC", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.10"}
CA = "2026-11-11T13:14:55.486421+00:00"
TODAY8 = "20261111"
NEXT = [{"day": "20250830", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"},
        {"day": "20250831", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"},
        {"day": "20250901", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"}]
FRONT = [[{"day": TODAY8, "fetch": True, "chosenAt": CA, "check": True, "held": True}]]
CHECK = [{"day": TODAY8, "fetch": True, "chosenAt": CA, "check": True}, {"day": "20261110", "fetch": True, "chosenAt": CA, "check": True}]
ORDER = []
BOOM = [False]
real = FS.rpc
def rpc(name, a):
    if name.startswith("tally_period") or name.startswith("tally_check") or name.startswith("tally_held"):
        FS.ARGS.setdefault(name, []).append(a); ORDER.append(name)
        if name in FS.NO_FN: raise LookupError("PGRST202")
        if name in ("tally_period_next", "tally_period_next_paced"): return NEXT[: a["p_max"]]
        if name in ("tally_check_next", "tally_check_next_open"): return CHECK[: a["p_max"]]
        if name == "tally_period_gate": return True
        if name == "tally_held_front": return FRONT[0][: a["p_max"]]
        if name == "tally_held_delete_by_heads":
            if BOOM[0]: raise RuntimeError("the database is busy (test)")
            return {"ok": True, "mine": True, "removed": 1, "guids": [CG + "-0000679c"]}
        if name == "tally_check_heads": return {"ok": True, "mine": True, "n": len(a["p_heads"]), "want": [], "done": True, "removed": 0}
        if name == "tally_period_heads": return {"ok": True, "n": len(a["p_heads"]), "held": 0, "done": True, "want": []}
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
    base = {"version": "2.5.10", "bridge": GA}
    beat = dict(base, kind="beat", tally=True, open=["MADE UP CO"], companies=[{"name": "MADE UP CO", "open": True, "guid": CG}])
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    h0 = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour
    dev.update(period_night_from=(h0 + 2) % 24, period_night_to=(h0 + 4) % 24, period_night_sunday=False)
    def days_of(r): return [x.get("day") for x in (r.get("periodDays") or [])]
    def beat_gap():      # at most one list of days every 5 s a computer is the database's own gate; the fake lets each through
        time.sleep(0.1)

    print("== 1. the beat: a held delete's day first")
    c, r = call(beat)
    pd = r.get("periodDays") or []
    hf = (FS.ARGS.get("tally_held_front") or [{}])[-1]
    ok(c == 200 and hf.get("p_book") == BOOK and hf.get("p_device") == DA and hf.get("p_bridge") == GA["id"] and hf.get("p_max") == 3,
       "1. tally_held_front asked for the book, this computer and this bridge, the answer's room (%s)" % hf)
    ok(days_of(r)[:1] == [TODAY8], "1. the held delete's day FIRST, before the period's days (%s)" % days_of(r))
    ok(pd and pd[0].get("kind") == "check" and pd[0].get("fetch") is True and pd[0].get("types") == TYPES6 and pd[0].get("chosenAt") == CA
       and pd[0].get("company") == "MADE UP CO" and pd[0].get("company_guid") == CG, "1. as a check day: fetch, the six types, its choice time, the company and GUID (%s)" % (pd[:1],))
    ok(len(pd) == 3 and days_of(r) == [TODAY8, "20250830", "20250831"], "1. then the period's days in the room left; the check's list naming the day again never lists it twice (%s)" % days_of(r))
    i_front = ORDER.index("tally_held_front") if "tally_held_front" in ORDER else 99
    i_per = next((i for i, n in enumerate(ORDER) if n.startswith("tally_period_next")), -1)
    ok(i_front < i_per, "1. asked before the period's days (%s)" % ORDER[:6])
    FRONT[0] = []
    beat_gap(); c, r = call(beat)
    ok(c == 200 and days_of(r) == ["20250830", "20250831", "20250901"], "1. nothing held: the order as before (%s)" % days_of(r))
    FRONT[0] = [{"day": TODAY8, "fetch": True, "chosenAt": CA, "check": True, "held": True}]
    NEXT_SAVE = list(NEXT); NEXT[:] = []
    beat_gap(); c, r = call(beat)
    ok(c == 200 and days_of(r) == [TODAY8, "20261110"], "1. no period: the held day, then the check's other day, never twice (%s)" % days_of(r))
    NEXT[:] = NEXT_SAVE
    FS.NO_FN.add("tally_held_front")
    n0 = len(FS.ARGS.get("tally_held_front") or [])
    beat_gap(); c, r = call(beat)
    ok(c == 200 and days_of(r) == ["20250830", "20250831", "20250901"], "1. a cloud without 158: as before (%s)" % days_of(r))
    FS.NO_FN.discard("tally_held_front")
    beat_gap(); c, r = call(beat)
    ok(c == 200 and len(FS.ARGS.get("tally_held_front") or []) == n0 and days_of(r)[:1] == ["20250830"], "1. a cloud without 158: not asked again at once (10 minutes) (%s)" % days_of(r))

    print("== 2. period_heads: a whole-day list applies the held deletes it proves first")
    heads = [[CG + "-00006799", 26521, 42860, "Payment", "EXTRA"], [CG + "-0000679a", 26522, 42861, "Receipt"]]
    del ORDER[:]
    c, r = call(dict(base, kind="period_heads", company="MADE UP CO", company_guid=CG, day=TODAY8, via="day", n=2, heads=heads, fetch=True))
    hd = (FS.ARGS.get("tally_held_delete_by_heads") or [{}])[-1]
    ok(c == 200 and r.get("ok") is True and r.get("done") is True, "2. the call answered as the check's (%s)" % r)
    ok(hd.get("p_book") == BOOK and hd.get("p_day") == "2026-11-11" and hd.get("p_heads") == [h[:4] for h in heads], "2. tally_held_delete_by_heads: the book, the day, four columns a head (%s)" % hd)
    ok(hd.get("p_device") == DA and hd.get("p_bridge") == GA["id"], "2. (review 3) and the computer and bridge that sent the list (only their own lines) (%s)" % hd)
    ok("tally_held_delete_by_heads" in ORDER and "tally_check_heads" in ORDER and ORDER.index("tally_held_delete_by_heads") < ORDER.index("tally_check_heads"), "2. before tally_check_heads (%s)" % ORDER)
    n1 = len(FS.ARGS.get("tally_held_delete_by_heads") or [])
    c, r = call(dict(base, kind="period_heads", company="MADE UP CO", company_guid=CG, day=TODAY8, via="split", n=2, heads=heads, fetch=True))
    ok(c == 200 and len(FS.ARGS.get("tally_held_delete_by_heads") or []) == n1, "2. a split list: not asked")
    c, r = call(dict(base, kind="period_heads", company="MADE UP CO", company_guid=CG, day=TODAY8, via="day", n=0, heads=[], fetch=True))
    ok(c == 200 and len(FS.ARGS.get("tally_held_delete_by_heads") or []) == n1, "2. an empty list: not asked")
    BOOM[0] = True
    c, r = call(dict(base, kind="period_heads", company="MADE UP CO", company_guid=CG, day=TODAY8, via="day", n=2, heads=heads, fetch=True))
    BOOM[0] = False
    ok(c == 200 and r.get("ok") is True and r.get("done") is True, "2. its failure never fails the call (%s / %s)" % (c, r))
    FS.NO_FN.add("tally_held_delete_by_heads")
    c, r = call(dict(base, kind="period_heads", company="MADE UP CO", company_guid=CG, day=TODAY8, via="day", n=2, heads=heads, fetch=True))
    ok(c == 200 and r.get("ok") is True and r.get("done") is True, "2. a cloud without 158: as before (%s)" % r)
    FS.NO_FN.discard("tally_held_delete_by_heads")
finally:
    fn.terminate()
    FS.stop() if hasattr(FS, "stop") else None
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
