"""python3 run_pickups_ingest.py - bridge 2.5.10's pick-up acknowledgement in tally-ingest (server/tally-cloud/index.ts under
Deno, against the stand-in for Supabase, fake_supabase.py). The owner's request of 08-Nov-2026: the page says "Started at
HH:MM on <login>'s Tally" or "Not started: <the bridge's own reason>" from what the bridge says, not by inference. No
migration: kept on the computer's beat (tally_devices.info.beat.pickups), which the page already reads. Made-up firm,
computer, bridges and books only. Checks:
  1. the beat answer's days say what they are handed out for: kind period (the period's), check, or fill (a day queued by
     Bring missing days: tally_check_days.source 'fill'); an older bridge ignores the key;
  2. the beat's pickups kept, cleaned: company, guid, kind (period | check | fill), chosenAt / takenAt / pickedAt /
     pickedUtc / at (ISO times only), state (started | refused), day (yyyymmdd), code (a known reason only), words (200
     letters, no markup), login (60); a started one without its time, a refused one without a known code, an unknown kind
     or state: dropped; anything else in an entry dropped; at most 20; the bridge that said it and when it was seen added;
  3. merged with the beat before: another bridge of the computer keeps its own (2 hours from when it was seen); this
     bridge's are what it says now; an older bridge (no pickups) leaves the others' as they were;
  4. a change is passed on at once on the firm's broadcast channel (the page's TLight.beatIn merges it into info.beat).
  (7. migration 155: after the beat's record is kept, tally_link_guid_fill is asked for this bridge; a cloud without it: as before)
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK = "99999999-9999-9999-9999-999999992510", "11111111-1111-1111-1111-111111112510"
DA, KA = "d2510000-0000-0000-0000-000000002510", "fcd_" + "f" * 48
CG = "a2f776bd-4a48-4f7d-9c73-48a8f0872510"
GA = {"id": "go-aaaaaa251025", "computer": "PC-MADEUP", "user": "madeup-a", "mode": "main", "runMode": "user", "version": "2.5.10"}
GB = {"id": "go-bbbbbb251025", "computer": "PC-MADEUP", "user": "madeup-b", "mode": "main", "runMode": "user", "version": "2.5.10"}
CA = "2026-11-08T05:00:00.123456+00:00"
NEXT = {BOOK: [{"day": "20250830", "fetch": True, "types": ["Sales"], "chosenAt": CA}]}
CHECK = {BOOK: [{"day": "20250712", "fetch": True, "chosenAt": CA, "check": True}, {"day": "20250711", "fetch": True, "chosenAt": CA, "check": True}]}
real = FS.rpc
def rpc(name, a):
    if name.startswith("tally_period") or name.startswith("tally_check") or name.startswith("tally_days_claim") or name == "tally_ledger_progress_save":
        FS.ARGS.setdefault(name, []).append(a)
        if name in FS.NO_FN: raise LookupError("PGRST202")
        if name in ("tally_period_next", "tally_period_next_paced"): return NEXT.get(a["p_book"], [])[: a["p_max"]]
        if name in ("tally_check_next", "tally_check_next_open"): return CHECK.get(a["p_book"], [])[: a["p_max"]]
        if name == "tally_period_gate": return True
        return {"ok": True}
    if name == "tally_link_guid_fill":     # migration 155 (section 7)
        FS.ARGS.setdefault(name, []).append(a)
        if name in FS.NO_FN: raise LookupError("PGRST202")
        return 0
    return real(name, a)
FS.rpc = rpc
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "MADE UP CO", "client_id": "c1", "book_id": BOOK}]
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.10", "period_fetch": True})
FS.T["tally_books"] += [{"book_id": BOOK, "firm_id": FIRM, "client_id": "c1", "company": "MADE UP CO", "from_date": "2025-04-01", "open_as_on": "2025-03-31"}]
FS.T["clients"] += [{"id": "c1", "firm_id": FIRM, "name": "MADE UP CO", "tally_name": "MADE UP CO", "gstin": "", "deleted": False}]
FS.T["tally_sync_cursor"] = [{"book_id": BOOK, "company_guid": CG}]
FS.T["tally_check_days"] = [{"book_id": BOOK, "firm_id": FIRM, "day": "2025-07-12", "source": "fill"}, {"book_id": BOOK, "firm_id": FIRM, "day": "2025-07-11", "source": "ask"}]
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def kept():
    d = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    return ((d.get("info") or {}).get("beat") or {})
def started(company="MADE UP CO", kind="period", taken="2026-11-08T05:00:02Z", at="2026-11-08T05:00:03Z", **more):
    return dict({"company": company, "guid": CG, "kind": kind, "chosenAt": CA[:40], "takenAt": taken, "state": "started", "pickedAt": at.replace("Z", "+05:30"),
                 "pickedUtc": at, "day": "20250830", "login": "madeup-a"}, **more)
def refused(code="typing", kind="check", **more):
    return dict({"company": "MADE UP CO", "guid": CG, "kind": kind, "chosenAt": CA[:40], "takenAt": "2026-11-08T05:00:02Z", "state": "refused", "day": "20250712",
                 "code": code, "words": "someone is working in Tally; reading starts once Tally has been left alone for a minute", "at": "2026-11-08T05:00:04Z", "login": "madeup-a"}, **more)
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    h0 = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour
    dev.update(period_night_from=(h0 + 2) % 24, period_night_to=(h0 + 4) % 24, period_night_sunday=False)
    base = {"version": "2.5.10", "bridge": GA, "kind": "beat", "tally": True, "open": ["MADE UP CO"], "companies": [{"name": "MADE UP CO", "open": True, "guid": CG}]}
    print("== 1. the days say what they are handed out for")
    c, r = call(base)
    pd = r.get("periodDays") or []
    kinds = {d.get("day"): d.get("kind") for d in pd}
    ok(c == 200 and kinds == {"20250830": "period", "20250712": "fill", "20250711": "check"}, "1. period, fill (Bring missing days), check (%s)" % kinds)
    ok(all(set(d) <= {"company", "company_guid", "day", "fetch", "types", "chosenAt", "check", "kind"} for d in pd) and pd and pd[0].get("chosenAt") == CA, "1. nothing else changed in a day (%s)" % pd[:1])
    ok("pickups" not in kept(), "2. a beat with none: none kept (%s)" % kept().get("pickups"))

    print("== 2. kept, cleaned")
    junk = [started(secret="x"), refused(words="<b>" + "w" * 400 + "</b>"),
            started(company="BAD KIND", kind="made up"), started(company="BAD STATE", state="taken"), refused(company="BAD CODE", code="made up"),
            started(company="NO TIME", pickedUtc="10:42"), started(company="BAD TAKEN", taken="yesterday"), "not an object", [1, 2],
            started(company="BAD DAY", day="2025-08-30", login="SRV01\\<madeup>" + "z" * 80)]
    c, r = call(dict(base, pickups=junk))
    pk = kept().get("pickups") or []
    by = {p.get("company") + "|" + p.get("kind"): p for p in pk}
    ok(c == 200 and set(by) == {"MADE UP CO|period", "MADE UP CO|check", "BAD DAY|period"}, "2. the bad ones dropped (%s)" % sorted(by))
    s0 = by.get("MADE UP CO|period") or {}
    ok(s0.get("state") == "started" and s0.get("pickedUtc") == "2026-11-08T05:00:03Z" and s0.get("pickedAt") == "2026-11-08T05:00:03+05:30" and s0.get("day") == "20250830"
       and s0.get("login") == "madeup-a" and s0.get("bridge") == GA["id"] and s0.get("seen") and "secret" not in s0 and "code" not in s0,
       "2. started: when, the first day, the login, the bridge (%s)" % s0)
    r0 = by.get("MADE UP CO|check") or {}
    ok(r0.get("state") == "refused" and r0.get("code") == "typing" and r0.get("words") == "someone is working in Tally; reading starts once Tally has been left alone for a minute"
       and r0.get("at") == "2026-11-08T05:00:04Z" and "pickedUtc" not in r0,
       "2. refused: its code, FinCom's own words for it (the bridge's text never kept: review 6) (%s)" % {k: (v[:40] if isinstance(v, str) else v) for k, v in r0.items()})
    ok(s0.get("book") == BOOK and r0.get("book") == BOOK and (by.get("BAD DAY|period") or {}).get("book") == "", "2. each matched to its book (a company not linked: none) (review 6)")
    bd = by.get("BAD DAY|period") or {}
    ok(bd.get("day") == "" and len(bd.get("login", "")) <= 60 and "<" not in bd.get("login", ""), "2. a day not yyyymmdd: none; the login cut, plain (%s)" % bd)
    c, r = call(dict(base, pickups=[started(company="CO %02d" % i) for i in range(30)]))
    ok(len(kept().get("pickups") or []) == 20, "2. at most 20 (%d)" % len(kept().get("pickups") or []))
    ok(c == 200 and all(k in r for k in ("ok", "posts")), "2. the beat answered as ever (%s)" % sorted(r)[:6])

    print("== 3. merged with the beat before")
    call(dict(base, pickups=[started()]))
    call(dict(base, bridge=GB, pickups=[refused(code="posting", login="madeup-b")]))
    pk = kept().get("pickups") or []
    ok(sorted((p["bridge"], p["state"]) for p in pk) == sorted([(GA["id"], "started"), (GB["id"], "refused")]), "3. both bridges' kept (%s)" % [(p["bridge"], p["state"]) for p in pk])
    call(dict(base, bridge=GB, pickups=[]))
    pk = kept().get("pickups") or []
    ok([(p["bridge"], p["state"]) for p in pk] == [(GA["id"], "started")], "3. a bridge's own are what it says now (%s)" % [(p["bridge"], p["state"]) for p in pk])
    call(dict(base, bridge=dict(GB, version="2.5.9")))
    ok([(p["bridge"]) for p in kept().get("pickups") or []] == [GA["id"]], "3. an older bridge (no pickups): the others' kept as they were (%s)" % kept().get("pickups"))
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    for p in dev["info"]["beat"]["pickups"]: p["seen"] = "2026-01-01T00:00:00.000Z"
    call(dict(base, bridge=GB, pickups=[]))
    ok("pickups" not in kept(), "3. seen more than 2 hours ago: dropped (%s)" % kept().get("pickups"))

    print("== 4. passed on at once")
    FS.BCAST.clear()
    call(dict(base, pickups=[started(taken="2026-11-08T05:10:00Z", at="2026-11-08T05:10:01Z")]))
    sent = [m for b in FS.BCAST for m in (b.get("messages") or []) if m.get("event") == "beat"]
    bp = (sent[-1].get("payload", {}).get("beat", {}).get("pickups") if sent else None) or []
    ok(bp and bp[0].get("state") == "started" and bp[0].get("pickedUtc") == "2026-11-08T05:10:01Z", "4. broadcast with the pickups (%s)" % bp)
    FS.BCAST.clear()
    call(dict(base, pickups=[refused(taken="2026-11-08T05:20:00Z")]))
    sent = [m for b in FS.BCAST for m in (b.get("messages") or []) if m.get("event") == "beat"]
    ok(sent and ((sent[-1].get("payload", {}).get("beat", {}).get("pickups") or [{}])[0]).get("code") == "typing", "4. a new refusal passed on too (%d sent)" % len(sent))

    print("== 5. why the last run ended (bridge 2.5.10 lastStop)")
    LS = {"at": "2026-11-08T08:35:57Z", "back": "2026-11-08T08:40:01Z", "why": "stall", "log": "olderEntries", "code": 0, "words": "x", "secret": "y"}
    FS.BCAST.clear()
    c, r = call(dict(base, lastStop=LS))
    ls, kept_ = kept().get("lastStop") or {}, (next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}).get("lastStop") or {}
    ok(c == 200 and ls == {"at": LS["at"], "back": LS["back"], "why": "stall", "log": "olderEntries"}, "5. kept on the beat, cleaned (%s)" % ls)
    ok(kept_.get("why") == "stall" and kept_.get("back") == LS["back"] and kept_.get("bridge") == GA["id"], "5. kept on the computer too (%s)" % kept_)
    sent = [m for b in FS.BCAST for m in (b.get("messages") or []) if m.get("event") == "beat"]
    ok(sent and (sent[-1].get("payload", {}).get("beat", {}).get("lastStop") or {}).get("why") == "stall", "5. passed on at once")
    call(dict(base))
    ok("lastStop" not in kept() and ((next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}).get("lastStop") or {}).get("why") == "stall", "5. no longer said: kept on the computer")
    call(dict(base, lastStop=dict(LS, back="2026-11-08T07:00:00Z", why="panic", code=2)))
    ok(((next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}).get("lastStop") or {}).get("why") == "stall", "5. an older one never replaces a newer")
    for bad in ({"why": "made up", "at": LS["at"], "back": LS["back"]}, {"why": "exit", "at": "noon", "back": LS["back"]}, {"why": "exit", "at": LS["at"]}, "stall"):
        call(dict(base, lastStop=bad))
        ok("lastStop" not in kept(), "5. dropped: %s" % (bad,))
    call(dict(base, lastStop=dict(LS, back="2026-11-08T09:00:00Z", why="exit", code=-1073741510, log="made up")))
    k5 = (next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}).get("lastStop") or {}
    ok(k5.get("why") == "exit" and k5.get("code") == -1073741510 and "log" not in k5, "5. its exit code; an unknown log kind dropped (%s)" % k5)
    print("== 6. the first heartbeat of India's day (migration 149, review 5)")
    info = next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}
    df = info.get("dayFirst") or {}
    today = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).strftime("%Y-%m-%d")
    ok(df.get("day") == today and df.get("at", "") < (info.get("beat") or {}).get("at", ""), "6. kept, the day's first beat (%s)" % df)
    first = df.get("at")
    call(dict(base))
    ok(((next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}).get("dayFirst") or {}).get("at") == first, "6. not moved by a later beat")
    print("== 7. a link with no Tally GUID takes it from the bridge's own record (migration 155)")
    FS.ARGS.pop("tally_link_guid_fill", None)
    c, r = call(dict(base))
    for i in range(40):     # (review B3: asked without the beat waiting for it)
        if FS.ARGS.get("tally_link_guid_fill"): break
        time.sleep(0.05)
    g = FS.ARGS.get("tally_link_guid_fill") or []
    ok(c == 200 and g and g[-1] == {"p_firm": FIRM, "p_device": DA, "p_bridge": GA["id"]}, "7. asked after the beat's record is kept, for this bridge (%s)" % g[-1:])
    FS.ARGS.pop("tally_link_guid_fill", None)
    c, r = call(dict(base, companies=[{"name": "MADE UP CO", "open": False, "guid": CG}])); time.sleep(0.5)
    ok(c == 200 and not FS.ARGS.get("tally_link_guid_fill"), "7. not asked when the bridge's own record lists no company open")
    FS.NO_FN.add("tally_link_guid_fill")
    c, r = call(dict(base)); time.sleep(0.5); n1 = len(FS.ARGS.get("tally_link_guid_fill") or [])
    c2, r2 = call(dict(base)); time.sleep(0.5)
    ok(c == 200 and r.get("ok") is True and c2 == 200 and len(FS.ARGS.get("tally_link_guid_fill") or []) == n1, "7. a cloud without 155: the beat answers as before, not asked again for 10 minutes")
    FS.NO_FN.discard("tally_link_guid_fill")
finally:
    fn.terminate()
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
