"""python3 run_gap_autoread_ingest.py - tally-ingest (server/tally-cloud/index.ts under Deno, against the stand-in for
Supabase, fake_supabase.py) for next-gap-autoread (migration 160). Staging, 11-Nov-2026: the recorder's gap (Tally's
ALTVCHID ahead of FinCom's) stayed until the owner uploaded the Day Book by hand. Now the beat asks the bridge itself for
the gap's days (tally_gap_front: open 2 minutes, nothing held, no posting waiting, each day once per 15 minutes) through
the older-entries path the bridge already has (periodDays -> period_heads): no new Tally request. Made-up books only.
Written before the code. Checks:
  1. the beat: tally_gap_front asked for the book and the room of the answer; its days come next (after a held delete's,
     before the period's) as check days (fetch, Tally's six standard types, the choice time, the company and its GUID),
     never listed twice (the check's own list naming a day again).
  2. tally_gap_front returning nothing: the order as before; the answer full with held days: not asked.
  3. a cloud without 160: as before, and not asked again at once (10 minutes).
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
FIRM, BOOK = "99999999-9999-9999-9999-999999999160", "11111111-1111-1111-1111-111111111160"
DA, KA = "d1000000-0000-0000-0000-000000000160", "fcd_" + "f" * 48
CG = "a2f776bd-4a48-4f7d-9c73-48a8f087b160"
GA = {"id": "go-aaaaaa160160", "computer": "MADEUP-PC", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.10"}
CA = "2026-11-11T13:14:55.486421+00:00"
NEXT = [{"day": "20250830", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"},
        {"day": "20250831", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"},
        {"day": "20250901", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"}]
HELD = [[]]
GAPF = [[{"day": "20261111", "fetch": True, "chosenAt": CA, "check": True, "gap": True}, {"day": "20261110", "fetch": True, "chosenAt": CA, "check": True, "gap": True}]]
CHECK = [{"day": "20261111", "fetch": True, "chosenAt": CA, "check": True}]
ORDER = []
real = FS.rpc
def rpc(name, a):
    if name.startswith("tally_period") or name.startswith("tally_check") or name.startswith("tally_held") or name.startswith("tally_gap"):
        FS.ARGS.setdefault(name, []).append(a); ORDER.append(name)
        if name in FS.NO_FN: raise LookupError("PGRST202")
        if name in ("tally_period_next", "tally_period_next_paced"): return NEXT[: a["p_max"]]
        if name in ("tally_check_next", "tally_check_next_open"): return CHECK[: a["p_max"]]
        if name == "tally_period_gate": return True
        if name == "tally_held_front": return HELD[0][: a["p_max"]]
        if name == "tally_gap_front": return GAPF[0][: a["p_max"]]
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
    def gapn(): return len(FS.ARGS.get("tally_gap_front") or [])

    print("== 1. the beat: the gap's days read by the bridge itself")
    c, r = call(beat)
    pd = r.get("periodDays") or []
    gf = (FS.ARGS.get("tally_gap_front") or [{}])[-1]
    ok(c == 200 and gf.get("p_book") == BOOK and gf.get("p_max") == 3, "1. tally_gap_front asked for the book and the answer's room (%s)" % gf)
    ok(days_of(r) == ["20261111", "20261110", "20250830"], "1. the gap's days next, newest first, then the period's in the room left; never twice (%s)" % days_of(r))
    ok(len(pd) == 3 and all(x.get("kind") == "check" and x.get("fetch") is True and x.get("types") == TYPES6 and x.get("chosenAt") == CA and x.get("company") == "MADE UP CO" and x.get("company_guid") == CG for x in pd[:2]),
       "1. as check days: fetch, the six types, the choice time, the company and GUID (%s)" % (pd[:2],))
    i_g = ORDER.index("tally_gap_front") if "tally_gap_front" in ORDER else 99
    i_h = ORDER.index("tally_held_front") if "tally_held_front" in ORDER else -1
    i_p = next((i for i, n in enumerate(ORDER) if n.startswith("tally_period_next")), -1)
    ok(i_h < i_g < i_p, "1. after a held delete's day, before the period's days (%s)" % ORDER[:6])

    print("== 2. nothing to read; the answer full")
    GAPF[0] = []
    time.sleep(0.1); c, r = call(beat)
    ok(c == 200 and days_of(r) == ["20250830", "20250831", "20250901"], "2. tally_gap_front returns nothing: the order as before (%s)" % days_of(r))
    GAPF[0] = [{"day": "20261111", "fetch": True, "chosenAt": CA, "check": True, "gap": True}]
    HELD[0] = [{"day": "2026110%d" % i, "fetch": True, "chosenAt": CA, "check": True, "held": True} for i in (7, 8, 9)]
    n0 = gapn()
    time.sleep(0.1); c, r = call(beat)
    ok(c == 200 and gapn() == n0 and days_of(r) == ["20261107", "20261108", "20261109"], "2. the answer full with held days: not asked (%s)" % days_of(r))
    HELD[0] = []

    print("== 3. a cloud without 160")
    FS.NO_FN.add("tally_gap_front")
    time.sleep(0.1); c, r = call(beat)
    ok(c == 200 and days_of(r) == ["20250830", "20250831", "20250901"], "3. as before (%s)" % days_of(r))
    FS.NO_FN.discard("tally_gap_front")
    n1 = gapn()
    time.sleep(0.1); c, r = call(beat)
    ok(c == 200 and gapn() == n1 and days_of(r)[:1] == ["20250830"], "3. not asked again at once (10 minutes) (%s)" % days_of(r))
finally:
    fn.terminate()
    FS.stop() if hasattr(FS, "stop") else None
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
