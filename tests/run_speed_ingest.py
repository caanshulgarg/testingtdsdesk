"""python3 run_speed_ingest.py - next-speed (the speed plan of 22-Nov-2026, #1 and #3): tally-ingest (server/tally-cloud/index.ts
under Deno, against the stand-in for Supabase, fake_supabase.py), every answer of the stand-in WAIT_MS late (default 40: a
round trip inside the cloud's region plus the database's own time), so a call's time shows its round trips one after another.
Checks:
  1. the bridge id is checked (tally_bridge_bind) on every call, so a moved or refused id is refused at once (the
     coordinator, 23-Nov-2026: no keep); a call with another bridge id is asked; an id another computer holds is refused
     every time, and asked every time;
  2. a revoked key is refused at once, on its very next call;
  3. the beat's time and its requests one after another, before and after (printed; the reads side by side, its
     last_seen written as before);
  4. the older entries' pace (#1, review B1): never more days handed out (stamped in tally_period_next_paced) than the
     bridge reads of the list (bridge-go/daypull.go: 3 by day, 30 at night or with FastEntries): a default bridge with
     Tally left alone still 3 by day; FastEntries 30; at night 30 as before.
Needs Deno (DENO). Made-up computer and books only. SPEED_INGEST_JSON=file writes the timings."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
INDEX = os.environ.get("INDEX_TS") or os.path.join(SQLDIR, "index.ts")
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
WAIT = int(os.environ.get("WAIT_MS", "40")) / 1000.0
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
FIRM, BOOK = "99999999-9999-9999-9999-999999990301", "11111111-1111-1111-1111-111111110301"
DA, KA = "d1000000-0000-0000-0000-000000000301", "fcd_" + "e" * 48
DB_, KB = "d1000000-0000-0000-0000-000000000302", "fcd_" + "d" * 48
CG = "a2f776bd-4a48-4f7d-9c73-48a8f0870301"
GA = {"id": "go-aaaaaa301301", "computer": "MADEUP-PC", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.5.16"}
NEXT = [{"day": "202508%02d" % d, "fetch": True, "types": ["Sales"], "chosenAt": "2026-11-07T14:50:15+00:00"} for d in range(1, 32)]
real = FS.rpc
def rpc(name, a):
    if name in ("tally_period_next", "tally_period_next_paced"): FS.ARGS.setdefault(name, []).append(a); return NEXT[: a["p_max"]]
    if name == "tally_period_gate": return True
    if name.startswith("tally_check") or name.startswith("tally_held") or name.startswith("tally_gap") or name == "tally_period_retry_days": FS.ARGS.setdefault(name, []).append(a); return []
    return real(name, a)
FS.rpc = rpc
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "MADE UP CO", "client_id": "c1", "book_id": BOOK}]
for d, k in ((DA, KA), (DB_, KB)):
    FS.T["tally_devices"].append({"id": d, "firm_id": FIRM, "name": "MADEUP-PC", "key_hash": hashlib.sha256(k.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.16", "period_fetch": True})
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
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except ValueError: return e.code, {}
binds = lambda: len(FS.ARGS.get("tally_bridge_bind") or [])
dev = lambda d=DA: next(x for x in FS.T["tally_devices"] if x["id"] == d)
res = {}
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    h0 = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour
    for d in (DA, DB_): dev(d).update(period_night_from=(h0 + 2) % 24, period_night_to=(h0 + 4) % 24, period_night_sunday=False)     # office hours now
    base = {"version": "2.5.16", "bridge": GA}
    now = lambda s=0: (datetime.datetime.utcnow() - datetime.timedelta(seconds=s)).strftime("%Y-%m-%dT%H:%M:%SZ")
    # a beat whose typing gate is known: the pick-ups, the older entries' companies and the last request's time
    def beat(key_sec=None, **kw):
        b = dict(base, kind="beat", tally=True, open=["MADE UP CO"], companies=[{"name": "MADE UP CO", "open": True, "guid": CG}],
                 pickups=[], periodPull={"companies": {"MADE UP CO": {}}}, reqs={"last": {"ms": 120, "at": now()}})
        if key_sec is not None: b["lastKeySec"] = key_sec
        b.update(kw); return b
    plain = dict(base, kind="beat", tally=True, open=["MADE UP CO"], companies=[{"name": "MADE UP CO", "open": True, "guid": CG}])
    call(plain); time.sleep(5.3)

    print("== 1. the bridge id is checked on every call (never kept)")
    n0 = binds(); c1, _ = call(plain); time.sleep(5.3); n1 = binds(); c2, _ = call(plain); n2 = binds()
    ok(c1 == 200 and c2 == 200, "1. both beats answered (%s %s)" % (c1, c2))
    ok(n1 - n0 == 1 or n0 >= 1, "1. the bind asked when not yet kept (%d -> %d)" % (n0, n1))
    ok(n2 == n1 + 1, "1. the next beat within the minute asks the bind again: checked on every call (%d -> %d)" % (n1, n2))
    other = dict(GA, id="go-bbbbbb301301")
    c, _ = call(dict(plain, bridge=other)); ok(binds() == n2 + 1, "1. another bridge id on the same key is asked (%d)" % binds())
    # the first computer's id named by the second key: another computer's, refused, never kept
    nb = binds(); c3, r3 = call(dict(plain, bridge=GA), key=KB); c4, r4 = call(dict(plain, bridge=GA), key=KB)
    ok(c3 == 409 and c4 == 409 and r3.get("idRefused") and r4.get("idRefused"), "1. an id another computer holds: refused each time (%s %s)" % (c3, c4))
    ok(binds() == nb + 2, "1. ... and asked each time, never kept (%d -> %d)" % (nb, binds()))

    print("== 2. a revoked key is refused at once")
    dev()["revoked"] = True
    c, r = call(plain); ok(c == 401, "2. the very next call after the key is revoked: 401 (%s %s)" % (c, r))
    dev()["revoked"] = False

    print("== 3. the beat's time, every answer %d ms late" % int(WAIT * 1000))
    time.sleep(5.3); call(plain)
    FS.DELAY[0] = WAIT; times = []; trips = []
    for i in range(3):
        time.sleep(5.3); del FS.SPANS[:]
        seen0 = dev().get("last_seen"); t0 = time.time(); c, _ = call(plain); t = time.time() - t0
        sp = sorted(FS.SPANS, key=lambda s: s[2])
        # requests one after another: the longest chain of spans each starting after the one before it ended
        chain, end = 0, 0.0
        for s in sp:
            if s[2] >= end - 0.002: chain += 1; end = s[3]
        times.append(t); trips.append(chain)
        if os.environ.get("SPEED_INGEST_SPANS") and i == 2:
            for s in sp: print("    %6d %6d  %s %s" % ((s[2] - t0) * 1000, (s[3] - t0) * 1000, s[0], s[1].split("?")[0][:90]))
        ok(c == 200 and dev().get("last_seen") != seen0, "3. beat %d answered, its last_seen written (%s)" % (i + 1, c))
    FS.DELAY[0] = 0.0
    res["beat_ms"] = sorted(round(x * 1000) for x in times); res["beat_trips"] = trips; res["beat_requests"] = len(sp)
    print("  beat: %s ms; requests one after another %s; requests %d" % (res["beat_ms"], trips, len(sp)))

    print("== 4. the older entries' pace by day: never more days handed out than the bridge reads")
    # what a bridge reads of a list (bridge-go/daypull.go applyPeriodDays): at most 3 by day, 30 (pullNightDays) when the
    # answer says night or its FastEntries is on
    def accepts(b, r): return 30 if (r.get("periodNight") is True or ((b.get("periodPull") or {}).get("fast") or {}).get("on") is True) else 3
    def pace(b):
        time.sleep(5.3); n = len(FS.ARGS.get("tally_period_next_paced") or []); c, r = call(b)
        a = (FS.ARGS.get("tally_period_next_paced") or [{}])[-1] if len(FS.ARGS.get("tally_period_next_paced") or []) > n else {}
        return c, a, r
    def handed(tag, b, want):
        c, a, r = pace(b)
        days = r.get("periodDays") or []
        ok(c == 200 and (not a or a.get("p_max") == want), "4. %s: %s days asked of the database (%s)" % (tag, want, a.get("p_max")))
        ok(not a or a.get("p_max") <= accepts(b, r), "4. %s: no day stamped handed out that the bridge will not read (asked %s, it reads %s)" % (tag, a.get("p_max"), accepts(b, r)))
        ok(len(days) <= accepts(b, r), "4. %s: the list fits what the bridge reads (%d of %d)" % (tag, len(days), accepts(b, r)))
        return a
    a = handed("a default bridge, Tally left alone 5 minutes", beat(key_sec=300), 3)
    ok(a.get("p_night") is False, "4. said 'day'")
    handed("a default bridge, left alone a minute", beat(key_sec=60), 3)
    handed("a key 20 s ago", beat(key_sec=20), 3)
    handed("a beat that says nothing of its typing gate", plain, 3)
    handed("Tally busy", beat(key_sec=300, tallyState="busy"), 3)
    fastb = beat(key_sec=300); fastb["periodPull"] = dict(fastb["periodPull"], fast={"on": True})
    handed("FastEntries on (takes a wide list by day), left alone", fastb, 30)
    c, a, r = pace(beat(key_sec=300, paused=True))
    ok(not a or a.get("p_max") == 3, "4. reading paused: never 30 (%s)" % a.get("p_max"))
    dev().update(period_night_from=(h0 - 1) % 24, period_night_to=(h0 + 2) % 24)
    a = handed("at night", beat(key_sec=5), 30)
    ok(a.get("p_night") is True, "4. at night said 'night', as before")
finally:
    fn.terminate()
    try: fn.wait(10)
    except Exception: fn.kill()
if os.environ.get("SPEED_INGEST_JSON"): json.dump(res, open(os.environ["SPEED_INGEST_JSON"], "w"), indent=1)
errs = [l for l in log if "error" in l.lower() and "tally-ingest" in l.lower()]
if fails: print("".join(log[-40:]))
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
