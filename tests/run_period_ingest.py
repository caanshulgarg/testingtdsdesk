"""python3 run_period_ingest.py - FinCom Bridge 2.4.5 (ROUND 102; migration 98): tally-ingest (server/tally-cloud/index.ts under
Deno, against the stand-in for Supabase, fake_supabase.py) for the older entries of a period the person chose and the ledger
read's progress. Written before the code. Checks:
  1. the beat's answer carries periodDays from tally_period_next for the computer's open companies (the beat's GUID, else
     the book's), at most 3 days in all, each {company, company_guid, day, fetch, types}; none while the computer's reading
     is paused or stopped; a cloud without migration 98: no periodDays and the beat as before; the beat keeps tallyIni
     (cleaned) for Help & support;
  2. period_heads: exactly four columns a head reach tally_period_heads (anything more never passed), the day as a date; the
     answer's MasterIDs only in the fetch phase; an unlinked company 409; a company this computer never named 403; "upload"
     goes to tally_period_upload with its words; not a day: 400;
  3. period_entries: the entries read as a Day Book's (parse.js), each with its day and full, their lines; an entry of
     another date refuses the whole call (nothing stored); an entry whose lines do not total zero is not stored and the day
     goes to be uploaded by hand (the answer says so); a salary payment's bank details never reach the database;
  4. ledger_progress (and the beat's ledgerProgress) reach tally_ledger_progress_save.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, BOOK2 = "99999999-9999-9999-9999-999999999999", "11111111-1111-1111-1111-111111111245", "11111111-1111-1111-1111-111111112245"
DA, KA = "d1000000-0000-0000-0000-000000000245", "fcd_" + "b" * 48
CG = "a2f776bd-4a48-4f7d-9c73-48a8f087b137"
GA = {"id": "go-aaaaaa245245", "computer": "PC-A", "user": "anshul", "mode": "main", "runMode": "user", "version": "2.4.5"}
NEXT = {BOOK: [{"day": "20250830", "fetch": False, "types": ["Sales", "Receipt", 'Bad"Type']}, {"day": "20250829", "fetch": False, "types": ["Sales"]}],
        BOOK2: [{"day": "20250731", "fetch": True, "types": []}, {"day": "20250730", "fetch": True, "types": []}]}
real = FS.rpc
def rpc(name, a):
    if name.startswith("tally_period") or name == "tally_ledger_progress_save":
        FS.ARGS.setdefault(name, []).append(a)
        if name in FS.NO_FN: raise LookupError("PGRST202")
        if name == "tally_period_next": return NEXT.get(a["p_book"], [])[: a["p_max"]]
        if name == "tally_period_heads": return {"ok": True, "n": len(a["p_heads"]), "held": 1, "done": False, "want": [str(h[1]) for h in a["p_heads"][1:]]}
        if name == "tally_period_entries": return {"ok": True, "stored": len(a["p_vouchers"]), "stale": 0, "held": 2, "n": 3, "done": False}
        return {"ok": True}
    return real(name, a)
FS.rpc = rpc
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "BIG CO", "client_id": "c1", "book_id": BOOK}, {"firm_id": FIRM, "company": "SECOND CO", "client_id": "c2", "book_id": BOOK2}]
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-A", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.4.5"})
FS.T["tally_books"] += [{"book_id": BOOK, "firm_id": FIRM, "client_id": "c1", "company": "BIG CO", "from_date": "2025-04-01", "open_as_on": "2025-03-31"},
                        {"book_id": BOOK2, "firm_id": FIRM, "client_id": "c2", "company": "SECOND CO", "from_date": "2025-04-01", "open_as_on": "2025-03-31"}]
FS.T["clients"] += [{"id": "c1", "firm_id": FIRM, "name": "BIG CO", "deleted": False}, {"id": "c2", "firm_id": FIRM, "name": "SECOND CO", "deleted": False}]
FS.T["tally_sync_cursor"] = [{"book_id": BOOK2, "company_guid": "book2-guid"}]
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def V(mid, day, amt="100.00", other=""):
    return ('<VOUCHER REMOTEID="%s-%08x" VCHTYPE="Sales"><DATE>%s</DATE><GUID>%s-%08x</GUID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>%d</VOUCHERNUMBER>'
            '<PARTYLEDGERNAME>Spike Customer</PARTYLEDGERNAME><ALTERID> %d</ALTERID><MASTERID> %d</MASTERID>'
            '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Customer</LEDGERNAME><AMOUNT>-%s</AMOUNT></ALLLEDGERENTRIES.LIST>'
            '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>%s</AMOUNT>%s</ALLLEDGERENTRIES.LIST></VOUCHER>') % (CG, mid, day, CG, mid, mid, 5000 + mid, mid, amt, amt if other == "" else other, "")
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    base = {"version": "2.4.5", "bridge": GA}
    beat = dict(base, kind="beat", tally=True, open=["BIG CO", "SECOND CO"], companies=[{"name": "BIG CO", "open": True, "guid": CG}, {"name": "SECOND CO", "open": True}],
                tallyIni=[{"path": r"C:\Program Files\TallyPrime\tally.ini", "state": "usertdl-no", "why": "this Tally is set not to load any add-on (User TDL = No)", "at": "2026-10-21T10:00:00+05:30", "extra": "x" * 9000}],
                ledgerProgress=[{"company": "BIG CO", "company_guid": CG, "round": "r1", "read": 312, "of": 1240, "done": False, "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}])
    print("== 1. the beat")
    # ROUND 103 (1c): the computer's switch off (the default): no days, periodFetch false; nothing asked of the database
    c, r = call(beat)
    ok(c == 200 and r.get("periodDays") == [] and r.get("periodFetch") is False and not FS.ARGS.get("tally_period_next"), "1. the switch off: no days, periodFetch false (%s)" % {k: r.get(k) for k in ("periodDays", "periodFetch")})
    next(d for d in FS.T["tally_devices"] if d["id"] == DA)["period_fetch"] = True
    # office hours set around now (the day pace whatever the hour this test runs at; the night pace is checked below)
    h0 = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour
    next(d for d in FS.T["tally_devices"] if d["id"] == DA).update(period_night_from=(h0 + 2) % 24, period_night_to=(h0 + 4) % 24, period_night_sunday=False)
    c, r = call(dict(beat, oldDaysTest={"company": "BIG CO", "state": "done", "at": "2026-10-21T10:00:00+05:30", "line": "0.21 s / 0.34 s / 0.18 s \u00b7 no freeze",
                                        "results": [{"day": "20260901", "ms": 210, "holdMs": 0, "rows": 40, "secret": "x"}], "raw": "y" * 5000}))
    ok(r.get("periodFetch") is True, "1. the switch on: periodFetch true")
    odt = (((next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}).get("beat") or {}).get("oldDaysTest") or {})
    ok(odt.get("line", "").endswith("no freeze") and "raw" not in odt and "secret" not in (odt.get("results") or [{}])[0] and odt["results"][0]["ms"] == 210, "1. the old-days test kept, cleaned (%s)" % odt)
    pd = r.get("periodDays") or []
    ok(c == 200 and len(pd) == 3, "the beat answers 3 days (%s %s)" % (c, pd))
    ok(pd and pd[0] == {"company": "BIG CO", "company_guid": CG, "day": "20250830", "fetch": False, "types": ["Sales", "Receipt"]}, "1. the first: BIG CO under the beat's GUID, counting, a type with a quote mark left out (%s)" % (pd[:1],))
    ok(len(pd) == 3 and pd[2]["company"] == "SECOND CO" and pd[2]["company_guid"] == "book2-guid" and pd[2]["fetch"] is True, "1. SECOND CO under the book's GUID, fetching (%s)" % (pd[2:],))
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    ti = (((dev.get("info") or {}).get("beat") or {}).get("tallyIni") or [])
    ok(len(ti) == 1 and ti[0]["state"] == "usertdl-no" and "extra" not in ti[0] and "User TDL = No" in ti[0]["why"], "1. the beat keeps the tally.ini report, cleaned (%s)" % ti)
    lp = FS.ARGS.get("tally_ledger_progress_save") or []
    ok(lp and lp[-1]["p_book"] == BOOK and lp[-1]["p_read"] == 312 and lp[-1]["p_of"] == 1240, "1. the beat's ledger progress kept (%s)" % lp[-1:])
    # ROUND 103 (the owner's decision of 21-Oct-2026, evening): 3 days by day, up to 30 outside the computer's office hours
    # (India's time; 20:00-08:00 and Sunday by default; the owner's hours per computer)
    ok(r.get("periodNight") in (True, False), "1. the beat says the pace (%s)" % r.get("periodNight"))
    h = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour
    devA = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    devA.update(period_night_from=(h + 2) % 24, period_night_to=(h + 4) % 24, period_night_sunday=False)
    keep = NEXT[BOOK]
    NEXT[BOOK] = [{"day": "202508%02d" % (31 - i) if i < 31 else "202507%02d" % (62 - i), "fetch": True, "types": []} for i in range(40)]
    c, r = call(beat)
    ok(c == 200 and r.get("periodNight") is False and len(r.get("periodDays") or []) == 3 and FS.ARGS["tally_period_next"][-1]["p_max"] == 3, "1. inside office hours: 3 days, periodNight false (%s, %d)" % (r.get("periodNight"), len(r.get("periodDays") or [])))
    devA.update(period_night_from=h, period_night_to=(h + 2) % 24)
    c, r = call(beat)
    ok(c == 200 and r.get("periodNight") is True and len(r.get("periodDays") or []) == 30 and FS.ARGS["tally_period_next"][-1]["p_max"] == 30, "1. outside office hours: up to 30 days, periodNight true (%s, %d)" % (r.get("periodNight"), len(r.get("periodDays") or [])))
    # review 245 R12: the second company's call at night still says night (p_max above 3) though fewer days are left; the
    # answer cut to what is left
    NEXT[BOOK] = NEXT[BOOK][:28]
    n8 = len(FS.ARGS.get("tally_period_next") or [])
    c, r = call(beat)
    a2 = (FS.ARGS.get("tally_period_next") or [])[n8:]
    ok(len(r.get("periodDays") or []) == 30 and len(a2) == 2 and a2[1]["p_max"] > 3, "1. at night every company's call keeps the night pace, the answer cut to 30 (%s)" % [x["p_max"] for x in a2])
    devA.update(period_night_from=(h + 2) % 24, period_night_to=(h + 4) % 24, period_night_sunday=True)
    sunday = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).weekday() == 6
    c, r = call(beat)
    ok(r.get("periodNight") is sunday, "1. all Sunday outside office hours when set (today Sunday: %s; %s)" % (sunday, r.get("periodNight")))
    devA["period_fetch"] = False
    devA.update(period_night_from=h, period_night_to=(h + 2) % 24)
    n9 = len(FS.ARGS.get("tally_period_next") or [])
    c, r = call(beat)
    ok(r.get("periodDays") == [] and r.get("periodFetch") is False and len(FS.ARGS.get("tally_period_next") or []) == n9, "1. the computer's switch off wins at night (%s)" % r.get("periodDays"))
    devA["period_fetch"] = True
    devA.update(period_night_from=(h + 2) % 24, period_night_to=(h + 4) % 24, period_night_sunday=False)
    NEXT[BOOK] = keep
    n0 = len(FS.ARGS.get("tally_period_next") or [])
    c, r = call(dict(beat, paused=True))
    ok(c == 200 and r.get("periodDays") == [] and len(FS.ARGS.get("tally_period_next") or []) == n0, "1. none while paused: an empty list, so the bridge stops at once (%s)" % r.get("periodDays"))
    c, r = call(dict(beat, readStopped={"by": "self", "reason": "x", "at": "2026-10-21T10:00:00"}))
    ok(c == 200 and r.get("periodDays") == [], "1. none while reading is stopped")
    FS.NO_FN.add("tally_period_next")
    c, r = call(beat)
    ok(c == 200 and "periodDays" not in r and r.get("ok") is True, "1. a cloud without 98: the beat as before")
    FS.NO_FN.discard("tally_period_next")

    print("== 2. period_heads")
    heads = [[CG + "-00000001", 1, 5001, "Sales", "PRIVATE"], [CG + "-00000002", 2, 5002, "Receipt"], [CG + "-00000003", 3, 5003, "Sales"]]
    c, r = call(dict(base, kind="period_heads", company="BIG CO", company_guid=CG, day="20250830", via="day", n=3, heads=heads, fetch=False))
    a = (FS.ARGS.get("tally_period_heads") or [{}])[-1]
    ok(c == 200 and r.get("ok") is True and r.get("want") == [] and r.get("n") == 3, "2. counting: no MasterIDs asked for (%s)" % r)
    ok(a.get("p_day") == "2025-08-30" and a.get("p_via") == "day" and a.get("p_heads") == [h[:4] for h in heads], "2. four columns a head, the day as a date (%s)" % a)
    c, r = call(dict(base, kind="period_heads", company="BIG CO", company_guid=CG, day="20250830", via="split", n=3, heads=heads, fetch=True))
    ok(c == 200 and r.get("want") == ["2", "3"] and (FS.ARGS["tally_period_heads"][-1]).get("p_via") == "split", "2. fetching: the MasterIDs FinCom lacks (%s)" % r)
    c, r = call(dict(base, kind="period_heads", company="NOT LINKED", company_guid=CG, day="20250830", heads=heads))
    ok(c == 409, "2. an unlinked company: 409")
    FS.T["tally_companies"].append({"firm_id": FIRM, "company": "NEVER NAMED", "client_id": "c1", "book_id": BOOK})
    c, r = call(dict(base, kind="period_heads", company="NEVER NAMED", company_guid=CG, day="20250830", heads=heads))
    ok(c == 403, "2. a company this computer never named: 403 (%s)" % c)
    c, r = call(dict(base, kind="period_heads", company="BIG CO", company_guid=CG, day="2025-08-30", heads=heads))
    ok(c == 400, "2. not a day: 400")
    words = "Tally took too long to give 30-Aug-2025. Please upload that day's Day Book."
    c, r = call(dict(base, kind="period_heads", company="BIG CO", company_guid=CG, day="20250830", upload=True, why="over2s", type="Sales", words=words))
    u = (FS.ARGS.get("tally_period_upload") or [{}])[-1]
    ok(c == 200 and r.get("ok") is True and u.get("p_why") == "over2s" and u.get("p_type") == "Sales" and u.get("p_words") == words and u.get("p_day") == "2025-08-30", "2. upload by hand: kept with its words (%s)" % u)

    print("== 3. period_entries")
    c, r = call(dict(base, kind="period_entries", company="BIG CO", company_guid=CG, day="20250830", vouchers=[V(2, "20250830"), V(3, "20250830")], gone=[], full=True))
    e = (FS.ARGS.get("tally_period_entries") or [{}])[-1]
    vs = e.get("p_vouchers") or []
    ok(c == 200 and r.get("ok") is True and r.get("stored") == 2, "3. stored (%s)" % r)
    ok(len(vs) == 2 and all(v.get("day") == "2025-08-30" and v.get("full") is True and v.get("guid", "").startswith(CG) for v in vs) and len(e.get("p_lines") or []) == 4, "3. a Day Book's entries, each with its day and full, their lines (%s)" % [(v.get("guid"), v.get("day")) for v in vs])
    n1 = len(FS.ARGS.get("tally_period_entries") or [])
    c, r = call(dict(base, kind="period_entries", company="BIG CO", company_guid=CG, day="20250830", vouchers=[V(4, "20250830"), V(5, "20250831")], full=True))
    ok(c == 400 and len(FS.ARGS.get("tally_period_entries") or []) == n1, "3. an entry of another date: the whole call refused, nothing stored (%s)" % r)
    n2 = len(FS.ARGS.get("tally_period_upload") or [])
    c, r = call(dict(base, kind="period_entries", company="BIG CO", company_guid=CG, day="20250830", vouchers=[V(6, "20250830"), V(7, "20250830", other="90.00")], full=True))
    e = (FS.ARGS.get("tally_period_entries") or [{}])[-1]
    up = (FS.ARGS.get("tally_period_upload") or [{}])[-1]
    ok(c == 200 and [v["guid"][-2:] for v in e.get("p_vouchers") or []] == ["06"] and r.get("notTaken") == 1 and r.get("upload") == "FinCom could not read 30-Aug-2025 from Tally. Please upload that day's Day Book.",
       "3. lines not totalling zero: that entry not stored, the day to be uploaded (%s)" % r)
    ok(len(FS.ARGS.get("tally_period_upload") or []) == n2 + 1 and up.get("p_why") == "entries", "3. the day marked to upload")
    bank = V(8, "20250830").replace("</ALLLEDGERENTRIES.LIST></VOUCHER>", "<BANKALLOCATIONS.LIST><BANKEMPLOYEENAME>Asha Rao</BANKEMPLOYEENAME><ACCOUNTNUMBER>50100123456781</ACCOUNTNUMBER><IFSCODE>HDFC0001234</IFSCODE><AMOUNT>100.00</AMOUNT></BANKALLOCATIONS.LIST></ALLLEDGERENTRIES.LIST></VOUCHER>")
    c, r = call(dict(base, kind="period_entries", company="BIG CO", company_guid=CG, day="20250830", vouchers=[bank], full=True))
    ok(c == 200 and "50100123456781" not in json.dumps(FS.ARGS["tally_period_entries"][-1]) and "HDFC0001234" not in json.dumps(FS.ARGS["tally_period_entries"][-1]), "3. a salary payment's bank details never reach the database")

    # ROUND 103 (B): a payroll voucher and a salary payment read by the period fetch (FinComVoucherObject as 2.4.4 keeps them,
    # testdata/payroll244 7.1) go the payroll path: each employee's pay-head amounts as cost allocations, the salary paid to
    # each employee by name, no bank detail; counted like any other entry
    PAYD = os.path.join(HERE, "..", "bridge-go", "testdata", "payroll244", "7.1")
    pr = open(os.path.join(PAYD, "obj-PR-NOV-stripped.xml")).read().replace("20261101", "20250830")
    sal = open(os.path.join(PAYD, "obj-SAL-PAY-NOV-stripped.xml")).read().replace("20261202", "20250830")
    c, r = call(dict(base, kind="period_entries", company="BIG CO", company_guid=CG, day="20250830", vouchers=[pr, sal], gone=[], full=True))
    e = (FS.ARGS.get("tally_period_entries") or [{}])[-1]
    pv = {v.get("type"): v for v in e.get("p_vouchers") or []}
    costs = [x for x in (pv.get("Payroll") or {}).get("costs") or []]
    sp = (pv.get("Payment") or {}).get("salpay") or []
    ok(c == 200 and r.get("ok") is True and sorted(pv) == ["Payment", "Payroll"], "3. a payroll voucher and a salary payment stored (%s, %s)" % (r, sorted(pv)))
    ok(any(x.get("centre") == "FC Emp One" and x.get("amt") == -50000 for x in costs) and len([l for l in e.get("p_lines") or [] if l[0] == pv["Payroll"]["guid"]]) >= 2, "3. the payroll's pay heads per employee kept (%s)" % costs[:3])
    ok(sp and all(x.get("employee") for x in sp) and "ACCOUNTNUMBER" not in json.dumps(e) and "IFSCODE" not in json.dumps(e), "3. the salary paid per employee, no bank detail (%s)" % sp[:2])

    # review 245 R1: an entry with no ledger line (a stock journal) passed as seen at its AlterID; gone MasterIDs passed on;
    # a locked month: the words to upload
    sj = ('<VOUCHER VCHTYPE="Stock Journal"><DATE>20250830</DATE><GUID>%s-%08x</GUID><VOUCHERTYPENAME>Stock Journal</VOUCHERTYPENAME><ALTERID> 77</ALTERID><MASTERID> 9</MASTERID></VOUCHER>' % (CG, 9))
    c, r = call(dict(base, kind="period_entries", company="BIG CO", company_guid=CG, day="20250830", vouchers=[V(10, "20250830"), sj], gone=["11", "x12"], full=True))
    e = (FS.ARGS.get("tally_period_entries") or [{}])[-1]
    ok(c == 200 and e.get("p_seen") == {"%s-%08x" % (CG, 9): 77} and [v["guid"][-2:] for v in e.get("p_vouchers") or []] == ["0a"] and e.get("p_gone") == ["11", "12"], "3. seen and gone passed on (%s / %s)" % (e.get("p_seen"), e.get("p_gone")))
    real_e = rpc
    def locked_rpc(name, a):
        if name == "tally_period_entries":
            FS.ARGS.setdefault(name, []).append(a)
            return {"ok": True, "locked": True, "stored": 0, "upload": "FinCom did not bring in 30-Aug-2025: its month is locked in FinCom. Unlock the month, then upload that day's Day Book."}
        return real_e(name, a)
    FS.rpc = locked_rpc
    c, r = call(dict(base, kind="period_entries", company="BIG CO", company_guid=CG, day="20250830", vouchers=[V(13, "20250830")], full=True))
    FS.rpc = real_e
    ok(c == 200 and r.get("ok") is True and "Unlock the month" in str(r.get("upload")), "3. a locked month: ok, the words to upload (%s)" % r)

    # review 245 R3: a company GUID that is not the book's recorded one: refused, nothing kept
    FS.T["tally_sync_cursor"].append({"book_id": BOOK, "company_guid": CG})
    n3 = len(FS.ARGS.get("tally_period_heads") or [])
    c, r = call(dict(base, kind="period_heads", company="BIG CO", company_guid="other-copy-guid", day="20250830", heads=heads))
    ok(c == 409 and r.get("otherGuid") is True and len(FS.ARGS.get("tally_period_heads") or []) == n3, "3. another company GUID (a same-named copy): 409, nothing kept (%s)" % r)
    c, r = call(dict(base, kind="ledger_progress", company="BIG CO", company_guid="other-copy-guid", round="r9", read=1, of=2, done=False))
    ok(c == 409, "3. ledger progress of another GUID: 409")

    # ROUND 103 (1b): the bridge stopped the period: tally_period_stop with its day, reason and words
    nstop = len(FS.ARGS.get("tally_period_stop") or [])
    c, r = call(dict(base, kind="period_stop", company="BIG CO", company_guid=CG, day="20250830", why="over2s", words="x"))
    ok(c == 400 and len(FS.ARGS.get("tally_period_stop") or []) == nstop, "3. period_stop without the choice it was reading: 400, nothing stopped (%s)" % r)
    c, r = call(dict(base, kind="period_stop", company="BIG CO", company_guid=CG, day="20250830", why="over2s", chosenAt="2026-10-21T08:00:00.123456+00:00", words="Tally took too long to give 30-Aug-2025, so FinCom stopped reading older entries of BIG CO. Please upload the Day Book for the days still missing."))
    sp = (FS.ARGS.get("tally_period_stop") or [{}])[-1]
    ok(c == 200 and r.get("ok") is True and sp.get("p_day") == "2025-08-30" and sp.get("p_why") == "over2s" and sp.get("p_chosen_at") == "2026-10-21T08:00:00.123456+00:00" and "stopped reading" in sp.get("p_words", ""), "3. period_stop kept with its choice (%s)" % sp)

    print("== 4. ledger_progress")
    c, r = call(dict(base, kind="ledger_progress", company="BIG CO", company_guid=CG, round="r2", read=1240, of=1240, done=True))
    lp = FS.ARGS["tally_ledger_progress_save"][-1]
    ok(c == 200 and lp["p_read"] == 1240 and lp["p_done"] is True and lp["p_round"] == "r2" and lp["p_device"] == DA, "4. kept (%s)" % lp)
finally:
    fn.terminate()
    FS.stop() if hasattr(FS, "stop") else None
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
