"""python3 run_gap_post_ingest.py - tally-ingest (server/tally-cloud/index.ts under Deno, against the stand-in for
Supabase, fake_supabase.py) for next-fix-gap-after-post (migration 182). Staging, 13-Nov-2026, Client CL: the gap's read
(tally_gap_front, 160) was given up 6 hours after the gap opened and held for ever by an old over2s stop. 182 reads such a
gap at the computer's quiet time (outside its office hours, the pace's night) instead: tally-ingest says that time to the
cloud (p_night). Nothing new is asked of Tally (the same check days, the same older-entries path). Made-up books only.
Written before the code. Checks:
  1. by day: tally_gap_front asked with p_night false, its days next as before (check days, newest first).
  2. at night (the computer's office hours over): asked with p_night true.
  3. a cloud with 160 but without 182: 160's call (no p_night) in the same beat, its days used; not asked with p_night
     again at once (10 minutes).
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno). INDEX_TS: another index.ts (the red run: the checks
marked (guard) hold what stays as it was, and pass)."""
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
NEXT = [{"day": "20250830", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"},
        {"day": "20250831", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"},
        {"day": "20250901", "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"}]
HELD = [[]]
GAPF = [[{"day": "20261111", "fetch": True, "chosenAt": CA, "check": True, "gap": True}, {"day": "20261110", "fetch": True, "chosenAt": CA, "check": True, "gap": True}]]
CHECK = [{"day": "20261111", "fetch": True, "chosenAt": CA, "check": True}]
ORDER = []
NIGHT_MISSING = [False]     # a cloud with 160 but without 182 (no tally_gap_front with p_night)
real = FS.rpc
def rpc(name, a):
    if name.startswith("tally_period") or name.startswith("tally_check") or name.startswith("tally_held") or name.startswith("tally_gap"):
        FS.ARGS.setdefault(name, []).append(a); ORDER.append(name)
        if name in FS.NO_FN: raise LookupError("PGRST202")
        if name == "tally_gap_front" and "p_night" in a and NIGHT_MISSING[0]: raise LookupError("PGRST202")
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
    gf_calls = lambda: FS.ARGS.get("tally_gap_front") or []

    print("== 1. by day")
    c, r = call(beat)
    gf = gf_calls()[-1] if gf_calls() else {}
    ok(c == 200 and gf.get("p_book") == BOOK and gf.get("p_night") is False, "1. tally_gap_front asked with the computer's time: by day (p_night false) (%s)" % gf)
    ok(days_of(r)[:2] == ["20261111", "20261110"] and all(x.get("kind") == "check" and x.get("types") == TYPES6 for x in (r.get("periodDays") or [])[:2]), "1. (guard) its days next, as check days (%s)" % days_of(r))

    print("== 2. at night")
    dev.update(period_night_from=h0 % 24, period_night_to=(h0 + 2) % 24)
    time.sleep(5.2); c, r = call(beat)
    gf = gf_calls()[-1] if gf_calls() else {}
    ok(c == 200 and gf.get("p_night") is True, "2. outside the computer's office hours: p_night true (%s)" % gf)
    ok(days_of(r)[:2] == ["20261111", "20261110"], "2. (guard) its days next (%s)" % days_of(r))

    print("== 3. a cloud without 182")
    NIGHT_MISSING[0] = True
    n0 = len(gf_calls())
    time.sleep(5.2); c, r = call(beat)
    calls = gf_calls()[n0:]
    ok(c == 200 and len(calls) == 2 and "p_night" in calls[0] and "p_night" not in calls[1], "3. 160's call in the same beat (%s)" % calls)
    ok(days_of(r)[:2] == ["20261111", "20261110"], "3. (guard) its days used (%s)" % days_of(r))
    n1 = len(gf_calls())
    time.sleep(5.2); c, r = call(beat)
    calls = gf_calls()[n1:]
    ok(c == 200 and len(calls) == 1 and "p_night" not in calls[0] and days_of(r)[:1] == ["20261111"], "3. (guard) not asked with p_night again at once (10 minutes) (%s)" % calls)
finally:
    fn.terminate()
    FS.stop() if hasattr(FS, "stop") else None
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
