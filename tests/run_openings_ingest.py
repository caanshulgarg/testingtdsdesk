"""python3 run_openings_ingest.py - migration 130 / FinCom Bridge 2.5.0 (the owner's decision of 30-Oct-2026): tally-ingest
(server/tally-cloud/index.ts under Deno, against the stand-in for Supabase, fake_supabase.py; never a real database) puts
opening balances through the guards. The migration's functions are stood in for here as the SQL does them
(tests/run_migration130.py tests the SQL itself on pg_stand). Written before the code. Checks:
  A. ledger_list, a dated round (openingsAt): every row's opening staged (tally_openings_stage, the round, the date), a new
     ledger added at nil until the last batch, then settled once (tally_openings_settle): taken when they add up to nil;
  B. (a) a dated round that does not add up to nil: the stored openings stay, held, one alert (the words name the bridge's
     ledger read, no computer name); the answer's notes say so;
  C. (c) an undated round (a bridge before 2.5.0) on a book whose openings tie: changed openings never taken (kept); on a
     fresh book an undated round that ties is taken (new ledgers and changed openings only, as before);
  D. ledger_changes: undated on a tied book: a changed opening not taken, a new ledger at nil, kept; dated: taken as before;
  E. upload_ledgers (a trial balance used as opening balances): (b) a date that is not the day before the books begin is
     refused with plain words, nothing called; (a) one that does not add up to nil: ledgers and groups taken at nil
     (applyGroups), the openings held, one alert, 409 with the words; one that adds up: tally_ingest_ledgers_g as before;
  F. a cloud without migration 130: everything as before (openings straight in), said in the notes for a dated round.
  G. bridge 2.5.1 (book 3d36a836, 30-Oct-2026: 2.5.0 sent openings as at Tally's own books-from, a year before FinCom's
     copy begins): openings read as at another day than the book's from_date are never taken (ledger_list: nothing staged
     or settled, the notes say so; ledger_changes: no opening changed, a new ledger at nil); as at from_date: taken
     through 130's guards;
  H. the beat's answer names, for each company open in Tally, FinCom's first day of its book (booksFrom {company:
     yyyymmdd}; "" when FinCom has none yet, the bridge then uses Tally's own BOOKSFROM; "" for a company of that name
     with another GUID than the book's recorded one).
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, urllib.request, urllib.error, shutil, threading, re
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO: print("skipped: no deno (set DENO)"); raise SystemExit(0)
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM = "99999999-9999-9999-9999-999999999130"
BA, BB, BC, BD, BE = ("11111111-1111-1111-1111-11111111013%d" % i for i in range(5))
DEV, KEY = "d1000000-0000-0000-0000-000000000130", "fcd_" + "e" * 48
GO = {"id": "go-aaaaaa250250", "computer": "PC-G5", "user": "user-g5", "mode": "main", "runMode": "user", "version": "2.5.0"}
FS.USERS["tok-owner"] = {"id": "u-owner", "email": "owner@zz.test"}
FS.T["members"] += [{"user_id": "u-owner", "firm_id": FIRM, "role": "owner", "active": True}]
NAMES = {BA: "LOAN CO", BB: "TIED CO", BC: "FRESH CO", BD: "UPLOAD CO", BE: "NODATE CO"}
FS.T["clients"] += [{"id": "c%d" % i, "firm_id": FIRM, "name": n, "tally_name": n, "gstin": "", "deleted": False} for i, n in enumerate(NAMES.values())]
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": n, "client_id": "c%d" % i, "book_id": b, "device_id": DEV, "last_seen": "2026-10-30T00:00:00Z"} for i, (b, n) in enumerate(NAMES.items())]
FS.T["tally_books"] += [{"book_id": b, "firm_id": FIRM, "client_id": "c%d" % i, "company": n, "from_date": "2025-04-01", "open_as_on": "2025-03-31", "ledgers_at": None} for i, (b, n) in enumerate(NAMES.items())]
next(b for b in FS.T["tally_books"] if b["book_id"] == BE).update(from_date=None, open_as_on=None)   # H: FinCom has no first day yet
FS.T["tally_devices"].append({"id": DEV, "firm_id": FIRM, "name": "NWS144", "key_hash": hashlib.sha256(KEY.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.0", "wake_token": None})
FS.T.setdefault("tally_ledgers", []); FS.T.setdefault("tally_groups", []); FS.T.setdefault("tally_ledger_aliases", []); FS.T.setdefault("tally_vouchers", [])
FS.T["tally_openings_held"] = []
FS.T.setdefault("tally_sync_cursor", []).append({"book_id": BA, "company_guid": "CG-A"})   # H: the book's recorded company GUID
FS.NO_COL.pop("tally_openings_held", None)        # a cloud with migration 130
HELD, ALERTS = [], []
def L(book, name=None):
    rows = [r for r in FS.T["tally_ledgers"] if r["book_id"] == book and not r.get("deleted_at")]
    return {r["name"]: (float(r.get("open") or 0), None if r.get("open_sent") is None else float(r["open_sent"])) for r in rows} if name is None else next((r for r in rows if r["name"] == name), None)
def seed(book, rows):
    FS.T["tally_ledgers"] = [r for r in FS.T["tally_ledgers"] if r["book_id"] != book] + [{"book_id": book, "firm_id": FIRM, "name": n, "parent": p, "open": v, "open_sent": v, "deleted_at": None} for n, p, v in rows]
# the migration's functions, as the SQL does them (run_migration130.py)
def cand(book, rows):
    live = {r["name"]: float(r["open_sent"] if r.get("open_sent") is not None else r.get("open") or 0) for r in FS.T["tally_ledgers"] if r["book_id"] == book and not r.get("deleted_at")}
    inc = {}
    for n, v in rows: inc.setdefault(n, round(float(v), 2))
    stored = sum(live.values()); nonzero = sum(1 for v in live.values() if v != 0)
    c = sum(inc.get(n, v) for n, v in live.items()) + sum(v for n, v in inc.items() if n not in live)
    changed = sum(1 for n, v in inc.items() if (n not in live and v != 0) or (n in live and live[n] != v))
    return {"stored": stored, "nonzero": nonzero, "storedTies": nonzero > 0 and abs(stored) <= 1, "candidate": round(c, 2), "candidateTies": abs(c) <= 1, "changed": changed}
def hold(a):
    HELD.append(dict(a, stage=a["p_stage"]))
    if a["p_stage"] == "held":
        n = a["p_diff"]; s = "%.2f" % abs(n); i, d = s.split("."); g = i[-3:]; i = i[:-3]
        while i: g = i[-2:] + "," + g; i = i[:-2]
        ALERTS.append({"book": a["p_book"], "words": "Opening balances from %s do not add up to nil: %s.%s%s" % (a["p_source"], g, d, " Dr" if n < 0 else " Cr" if n > 0 else "")})
    return len(HELD)
real = FS.rpc
def rpc(fn, a):
    if fn.startswith("tally_openings_"): FS.ARGS.setdefault(fn, []).append(a)
    if fn == "tally_book_for":   # as the SQL (migration-2-hardening.sql): null for a company not linked to a client
        c = next((c for c in FS.T["tally_companies"] if c["firm_id"] == a["p_firm"] and c["company"] == a["p_company"]), None)
        return c["book_id"] if c and c.get("client_id") and c.get("book_id") else None
    if fn == "tally_openings_candidate": return cand(a["p_book"], a["p_rows"])
    if fn == "tally_openings_hold": return hold(a)
    if fn == "tally_openings_stage": HELD.append(dict(a, stage="pending")); return len(HELD)
    if fn == "tally_openings_settle":
        mine = [h for h in HELD if h.get("p_round") == a["p_round"] and h["p_book"] == a["p_book"] and h["stage"] == "pending"]
        if not mine: return {"ok": True, "settled": "nothing pending"}
        rows = {}
        for h in mine:
            for n, v in h["p_rows"]: rows[n] = v
        rws = sorted(rows.items()); c = cand(a["p_book"], rws)
        for h in mine: h["stage"] = "done"
        if c["changed"] == 0: return {"ok": True, "settled": "applied", "changed": 0}
        if not c["candidateTies"]:
            hold({"p_book": a["p_book"], "p_source": a["p_source"], "p_round": a["p_round"], "p_openings_at": a["p_openings_at"], "p_rows": rws, "p_stage": "held", "p_diff": c["candidate"]})
            return {"ok": True, "settled": "held", "difference": c["candidate"]}
        if c["storedTies"] and a["p_openings_at"] is None:
            hold({"p_book": a["p_book"], "p_source": a["p_source"], "p_round": a["p_round"], "p_openings_at": None, "p_rows": rws, "p_stage": "kept", "p_diff": c["candidate"]})
            return {"ok": True, "settled": "kept"}
        for n, v in rws:
            r = L(a["p_book"], n)
            if r: r["open"] = r["open_sent"] = v
        return {"ok": True, "settled": "applied", "changed": c["changed"]}
    return real(fn, a)
FS.rpc = rpc
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, device=True):
    h = {"Content-Type": "application/json"}
    if device: h["x-fincom-device"] = KEY; body = dict({"version": "2.5.0", "bridge": GO}, **body)
    else: h["Authorization"] = "Bearer tok-owner"
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=h)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
row = lambda g, name, parent, op, oc=0: ["g-" + g, 1, 1, name, parent, op, "", "", oc, ""]
def lst(company, rnd, rows, last, at=None, seen=None):
    b = {"kind": "ledger_list", "company": company, "round": rnd, "complete": True, "rowsRead": 9, "seen": seen or [r[0] for r in rows], "last": last, "ledgers": rows, "groups": [["Sundry Debtors", ""], ["Cash-in-Hand", ""], ["Capital Account", ""]]}
    if at: b["openingsAt"] = at
    return call(b)
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    print("== A. a dated round that adds up to nil")
    seed(BA, [("Cash", "Cash-in-Hand", -631000), ("Capital", "Capital Account", 631000), ("Loan Advance Party", "Sundry Debtors", -8950000), ("Party P Singh", "Sundry Debtors", 8950000)])
    c, r = lst("LOAN CO", "d-1", [row("1", "Cash", "Cash-in-Hand", "-631000"), row("2", "Loan Advance Party", "Sundry Debtors", "0"), row("9", "New Party", "Sundry Debtors", "-500")], False, "20250401")
    st = FS.ARGS.get("tally_openings_stage") or []
    ok(c == 200 and len(st) == 1 and st[0]["p_round"] == "d-1" and st[0]["p_openings_at"] == "2025-04-01" and sorted(x[0] for x in st[0]["p_rows"]) == ["Cash", "Loan Advance Party", "New Party"],
       "A. every row of a dated batch staged with its round and date (%s)" % st)
    ok(L(BA)["Loan Advance Party"] == (-8950000, -8950000) and L(BA)["New Party"] == (0, 0) and not FS.ARGS.get("tally_openings_settle"), "A. nothing taken before the last batch; a new ledger at nil (%s)" % L(BA))
    c, r = lst("LOAN CO", "d-1", [row("3", "Capital", "Capital Account", "631000"), row("4", "Party P Singh", "Sundry Debtors", "500")], True, "20250401")
    se = FS.ARGS.get("tally_openings_settle") or []
    ok(c == 200 and len(se) == 1 and se[0]["p_round"] == "d-1" and se[0]["p_openings_at"] == "2025-04-01" and se[0]["p_source"] == "the bridge's ledger read" and r.get("openings") == "applied", "A. settled once, on the last batch (%s; %s)" % (se, r))
    ok(L(BA) == {"Cash": (-631000, -631000), "Capital": (631000, 631000), "Loan Advance Party": (0, 0), "Party P Singh": (500, 500), "New Party": (-500, -500)}, "A. taken (%s)" % L(BA))
    print("== B. (a) a dated round that does not add up to nil: held")
    before = L(BA)
    c, r = lst("LOAN CO", "d-2", [row("2", "Loan Advance Party", "Sundry Debtors", "-8950000"), row("4", "Party P Singh", "Sundry Debtors", "-3850000")], True, "20250401")
    ok(c == 200 and r.get("openings") == "held" and L(BA) == before, "B. the stored openings stay (%s)" % r.get("openings"))
    ok(len(ALERTS) == 1 and ALERTS[0]["words"] == "Opening balances from the bridge's ledger read do not add up to nil: 1,28,00,500.00 Dr" and not re.search("PC-G5|user-g5", ALERTS[0]["words"]), "B. one alert, no computer name (%s)" % ALERTS)
    ok(any("openings held" in n and "1,28,00,500.00 Dr" in n for n in r.get("notes", [])), "B. the notes say so (%s)" % r.get("notes"))
    print("== C. (c) an undated round")
    seed(BB, [("Cash", "Cash-in-Hand", -500), ("Capital", "Capital Account", 500)])
    c, r = lst("TIED CO", "u-1", [row("1", "Cash", "Cash-in-Hand", "-900", 1), row("2", "Capital", "Capital Account", "900", 1), row("3", "Unchanged", "Sundry Debtors", "0")], True)
    ok(c == 200 and r.get("openings") == "kept" and L(BB)["Cash"] == (-500, -500) and len(ALERTS) == 1, "C. tied openings never changed by an undated round; no alert (%s)" % r.get("openings"))
    st = [s for s in FS.ARGS.get("tally_openings_stage", []) if s["p_round"] == "u-1"]
    ok(len(st) == 1 and sorted(x[0] for x in st[0]["p_rows"]) == ["Capital", "Cash", "Unchanged"] and st[0]["p_openings_at"] is None, "C. an undated round stages its new ledgers and changed openings only (%s)" % st)
    seed(BC, [])
    c, r = lst("FRESH CO", "u-2", [row("1", "Cash", "Cash-in-Hand", "-100"), row("2", "Capital", "Capital Account", "100")], True)
    ok(c == 200 and r.get("openings") == "applied" and L(BC) == {"Cash": (-100, -100), "Capital": (100, 100)}, "C. a fresh book takes an undated round that ties (%s; %s)" % (r.get("openings"), L(BC)))
    print("== D. ledger_changes")
    c, r = call({"kind": "ledger_changes", "company": "TIED CO", "company_guid": "", "why": "counter", "ledgers": [row("1", "Cash", "Cash-in-Hand", "-777"), row("7", "Brand New", "Sundry Debtors", "-5")]})
    ok(c == 200 and L(BB)["Cash"] == (-500, -500) and L(BB)["Brand New"] == (0, 0) and any("not taken" in k for k in r.get("kept", [])) and HELD[-1]["stage"] == "kept", "D. undated, tied book: not taken, kept (%s; %s)" % (L(BB), r.get("kept")))
    c, r = call({"kind": "ledger_changes", "company": "TIED CO", "company_guid": "", "why": "counter", "openingsAt": "20250401", "ledgers": [row("1", "Cash", "Cash-in-Hand", "-777")]})
    ok(c == 200 and L(BB)["Cash"] == (-777, -777), "D. dated: taken as before (%s)" % (L(BB),))
    print("== E. a trial balance uploaded as opening balances")
    seed(BD, [("Cash", "Cash-in-Hand", -100), ("Capital", "Capital Account", 100)])
    n_g = len(FS.ARGS.get("tally_ingest_ledgers_g") or [])
    c, r = call({"kind": "upload_ledgers", "client": "c3", "from": "20260401", "openAsOn": "20260331", "complete": False, "ledgers": [["Cash", "Cash-in-Hand", "-200"], ["Capital", "Capital Account", "200"]]}, device=False)
    ok(c == 400 and r.get("refused") == "date" and "31-Mar-2026" in r.get("error", "") and "31-Mar-2025" in r.get("error", "") and "1-Apr-2025" in r.get("error", "") and "nothing was changed" in r.get("error", "")
       and len(FS.ARGS.get("tally_ingest_ledgers_g") or []) == n_g and L(BD)["Cash"] == (-100, -100), "E. (b) not the day before the books begin: refused, plain words (%s)" % r)
    c, r = call({"kind": "upload_ledgers", "client": "c3", "from": "20250401", "openAsOn": "20250331", "complete": False, "ledgers": [["Cash", "Cash-in-Hand", "-200"], ["Capital", "Capital Account", "150"], ["Party", "Sundry Debtors", "0"]]}, device=False)
    ok(c == 409 and r.get("refused") == "nil" and r.get("error", "").startswith("Opening balances from a trial balance uploaded do not add up to nil: 50.00 Dr") and len(FS.ARGS.get("tally_ingest_ledgers_g") or []) == n_g
       and L(BD)["Cash"] == (-100, -100) and "Party" in L(BD) and L(BD)["Party"][0] == 0 and len(ALERTS) == 2, "E. (a) does not add up: openings held, ledgers taken at nil, one alert (%s; %s)" % (r, L(BD)))
    c, r = call({"kind": "upload_ledgers", "client": "c3", "from": "20250401", "openAsOn": "20250331", "complete": False, "ledgers": [["Cash", "Cash-in-Hand", "-200"], ["Capital", "Capital Account", "200"]]}, device=False)
    ok(c == 200 and len(FS.ARGS.get("tally_ingest_ledgers_g") or []) == n_g + 1, "E. one that adds up: taken as before (%s)" % r)
    seed(BD, [("Cash", "Cash-in-Hand", -100), ("Capital", "Capital Account", 100), ("Stale Party", "Sundry Debtors", -999)])
    n_g = len(FS.ARGS.get("tally_ingest_ledgers_g") or [])
    c, r = call({"kind": "upload_ledgers", "client": "c3", "from": "20250401", "openAsOn": "20250331", "complete": False, "ledgers": [["Cash", "Cash-in-Hand", "-300"], ["Capital", "Capital Account", "300"]]}, device=False)
    ok(c == 200 and len(FS.ARGS.get("tally_ingest_ledgers_g") or []) == n_g + 1, "E. a correct trial balance (its own total nil) is taken though the book holds a wrong opening it leaves out (%s)" % r)
    n_g = len(FS.ARGS.get("tally_ingest_ledgers_g") or [])
    c, r = call({"kind": "upload_ledgers", "client": "c3", "from": "20250401", "openAsOn": "20250331", "complete": True, "count": 2, "ledgers": [["Cash", "Cash-in-Hand", "-150"], ["Stale Party", "Sundry Debtors", "-999"]]}, device=False)
    gl = (FS.ARGS.get("tally_ingest_ledgers_g") or [{}])[-1]
    ok(c == 200 and len(FS.ARGS.get("tally_ingest_ledgers_g") or []) == n_g + 1 and r.get("held") and "a ledger masters file uploaded" in r.get("kept", "")
       and sorted(gl.get("p_ledgers") or []) == [["Cash", "Cash-in-Hand", "-100"], ["Stale Party", "Sundry Debtors", "-999"]] and gl.get("p_complete") is True,
       "E. a masters upload (complete) whose openings do not add up: held; the list still taken (complete), with the openings FinCom holds (%s; %s)" % (r, gl.get("p_ledgers")))
    n_g = len(FS.ARGS.get("tally_ingest_ledgers_g") or [])
    c, r = call({"kind": "upload_ledgers", "client": "c3", "from": "20250401", "openAsOn": "20250331", "complete": True, "count": 3, "ledgers": [["Cash", "Cash-in-Hand", "-100"], ["Capital", "Capital Account", "1099"], ["Stale Party", "Sundry Debtors", "-999"]]}, device=False)
    ok(c == 200 and len(FS.ARGS.get("tally_ingest_ledgers_g") or []) == n_g + 1 and not r.get("held"), "E. a masters upload that adds up: taken as before (%s)" % r)
    c, r = call({"kind": "ledgers", "company": "UPLOAD CO", "from": "20250401", "openAsOn": "20250331", "ledgers": [["Cash", "Cash-in-Hand", "-300"]], "groups": []})
    ok(c == 200 and r.get("held") and "the bridge's trial balance" in r.get("kept", "") and ALERTS[-1]["words"].startswith("Opening balances from the bridge's trial balance"), "E. the bridge's trial-balance list: held the same way, answered 200 (%s)" % r)
    print("== G. (2.5.1) openings read as at another day than FinCom's first day of the book")
    seed(BA, [("Cash", "Cash-in-Hand", -631000), ("Capital", "Capital Account", 631000)])
    n_st, n_se = len(FS.ARGS.get("tally_openings_stage") or []), len(FS.ARGS.get("tally_openings_settle") or [])
    c, r = lst("LOAN CO", "w-1", [row("1", "Cash", "Cash-in-Hand", "-100"), row("3", "Capital", "Capital Account", "100"), row("8", "Year Before Party", "Sundry Debtors", "-7")], True, "20240401")
    ok(c == 200 and len(FS.ARGS.get("tally_openings_stage") or []) == n_st and len(FS.ARGS.get("tally_openings_settle") or []) == n_se and r.get("openings") is None
       and L(BA)["Cash"] == (-631000, -631000) and L(BA)["Capital"] == (631000, 631000) and L(BA)["Year Before Party"] == (0, 0),
       "G. as at 2024-04-01 on a book from 2025-04-01: nothing staged or settled, the openings stay, a new ledger at nil (%s; %s)" % (L(BA), r.get("openings")))
    ok(any("openings as at 2024-04-01 not taken: FinCom's books of this company begin on 2025-04-01" in n for n in r.get("notes", [])) and not any("without the guards" in n for n in r.get("notes", [])), "G. the notes say so, and only so (%s)" % r.get("notes"))
    c, r = call({"kind": "ledger_changes", "company": "LOAN CO", "company_guid": "", "why": "counter", "openingsAt": "20240401", "ledgers": [row("1", "Cash", "Cash-in-Hand", "-555"), row("6", "Changed Year Party", "Sundry Debtors", "-9")]})
    ok(c == 200 and L(BA)["Cash"] == (-631000, -631000) and L(BA)["Changed Year Party"] == (0, 0) and r.get("kept") == ["2 opening(s) as at 2024-04-01 not taken: FinCom's books of this company begin on 2025-04-01"]
       and HELD[-1]["stage"] == "kept" and HELD[-1]["p_openings_at"] == "2024-04-01", "G. ledger_changes as at another day: no opening changed, a new ledger at nil, the words name both days (%s; %s)" % (L(BA), r))
    c, r = lst("LOAN CO", "w-2", [row("1", "Cash", "Cash-in-Hand", "-100"), row("3", "Capital", "Capital Account", "107"), row("8", "Year Before Party", "Sundry Debtors", "-7")], True, "20250401")
    se = FS.ARGS.get("tally_openings_settle") or []
    ok(c == 200 and len(se) == n_se + 1 and se[-1]["p_openings_at"] == "2025-04-01" and r.get("openings") == "applied"
       and L(BA)["Cash"] == (-100, -100) and L(BA)["Capital"] == (107, 107) and L(BA)["Year Before Party"] == (-7, -7), "G. as at the book's from_date: taken through 130's guards (%s; %s)" % (L(BA), r.get("openings")))
    c, r = lst("LOAN CO", "w-3", [row("1", "Cash", "Cash-in-Hand", "-100"), row("3", "Capital", "Capital Account", "999")], True, "20250401")
    ok(c == 200 and r.get("openings") == "held" and L(BA)["Capital"] == (107, 107), "G. as at from_date but not adding up to nil: held by 130's guards (%s)" % r.get("openings"))
    c, r = call({"kind": "ledger_changes", "company": "LOAN CO", "company_guid": "", "why": "counter", "openingsAt": "20250401", "ledgers": [row("1", "Cash", "Cash-in-Hand", "-93")]})
    ok(c == 200 and L(BA)["Cash"] == (-93, -93), "G. ledger_changes as at from_date: taken (%s)" % (L(BA),))
    print("== H. (2.5.1) the beat names FinCom's first day of each open company's book")
    c, r = call({"kind": "beat", "tally": True, "open": ["LOAN CO", "NODATE CO"], "companies": [{"name": "LOAN CO", "open": True, "guid": "cg-a"}, {"name": "NODATE CO", "open": True, "guid": "cg-e"}, {"name": "TIED CO", "open": False}, {"name": "NOT LINKED CO", "open": True}]})
    ok(c == 200 and r.get("booksFrom") == {"LOAN CO": "20250401", "NODATE CO": "", "NOT LINKED CO": ""}, "H. booksFrom: the book's from_date as yyyymmdd; \"\" when FinCom has none or the company is not linked; closed companies left out (%s)" % r.get("booksFrom"))
    c, r = call({"kind": "beat", "tally": True, "open": [], "companies": []})
    ok(c == 200 and not r.get("booksFrom"), "H. no open company: no booksFrom (%s)" % r.get("booksFrom"))
    c, r = call({"kind": "beat", "tally": True, "open": ["LOAN CO"], "companies": [{"name": "LOAN CO", "open": True, "guid": "cg-a"}]})
    ok(c == 200 and r.get("booksFrom") == {"LOAN CO": "20250401"}, "H. the book's recorded GUID (any case): its day (%s)" % r.get("booksFrom"))
    c, r = call({"kind": "beat", "tally": True, "open": ["LOAN CO"], "companies": [{"name": "LOAN CO", "open": True, "guid": "cg-restored-copy"}]})
    ok(c == 200 and r.get("booksFrom") == {"LOAN CO": ""}, "H. a company of that name with another GUID (a restored or test copy): \"\", never the book's day (%s)" % r.get("booksFrom"))
    c, r = call({"kind": "beat", "tally": True, "open": ["LOAN CO"], "companies": [{"name": "LOAN CO", "open": True}]})
    ok(c == 200 and not r.get("booksFrom"), "H. no GUID in the beat yet for a book with a recorded GUID: left out, the bridge keeps its day (%s)" % r.get("booksFrom"))
    print("== F. a cloud without migration 130")
    FS.NO_COL["tally_openings_held"] = {"id"}
    time.sleep(0.1)
    print("  (the function's column check is cached for 5 minutes: F runs in a second function)")
    fn.terminate(); fn.wait(10)
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    n_st = len(FS.ARGS.get("tally_openings_stage") or [])
    seed(BC, [("Cash", "Cash-in-Hand", -100), ("Capital", "Capital Account", 100)])
    c, r = lst("FRESH CO", "d-9", [row("1", "Cash", "Cash-in-Hand", "-150", 1), row("5", "Another", "Sundry Debtors", "50")], True, "20250401")
    ok(c == 200 and len(FS.ARGS.get("tally_openings_stage") or []) == n_st and L(BC)["Cash"] == (-150, -150) and L(BC)["Another"] == (50, 50)
       and any("migration 130 is not applied" in n for n in r.get("notes", [])), "F. as before, said in the notes (%s; %s)" % (L(BC), r.get("notes")))
finally:
    fn.terminate()
    try: fn.wait(10)
    except Exception: pass
if fails:
    print("".join(log[-40:]))
    print("FAILED %d" % len(fails)); raise SystemExit(1)
print("ALL PASSED")
