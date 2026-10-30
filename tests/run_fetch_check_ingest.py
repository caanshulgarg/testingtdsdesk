"""python3 run_fetch_check_ingest.py - tally-ingest (server/tally-cloud/index.ts under Deno, against the stand-in for
Supabase, fake_supabase.py) for the owner's decision of 30-Oct-2026 (migration 133): books brought from Tally with a
progress bar, and an uploaded Day Book checked against Tally and corrected to it. No new Tally request: the upload's days go
through the older-entries path the bridge already has (periodDays, period_heads, period_entries, period_stop). Made-up
books only. Written before the code. Checks:
  1. the beat: each day handed out carries its choice time (chosenAt: without it a stop of the bridge never reached FinCom
     and the page could never say "stopped"); the upload's days to check (tally_check_next) come after the period's, in
     the room left of the answer (3 by day), fetch true, under the same choice rule, with Tally's six standard types; a day
     never twice; none while the computer's switch is off or its reading paused; a cloud without 133: as before.
  2. period_heads: a day being checked goes to tally_check_heads (the heads as four columns, the day, how listed) and the
     period's own count as well; the MasterIDs asked are both's; a day not being checked: the period's path as before; a
     cloud without 133: as before.
  3. period_entries: a day being checked goes to tally_check_entries (the entries as a Day Book's, their lines, the entries
     with no ledger line as seen) and the answer is the check's; the period's entries go through
     tally_period_entries_logged (each logged for "Today from Tally"); a cloud without 133: tally_period_entries as before.
  4. period_stop: the check stops with the period (tally_check_stop, the same choice time).
  5. an upload read into FinCom (a person's upload_days, and the upload job's days read by the queue) queues those days for
     the check (tally_check_queue); the bridge's own day reads never do; a cloud without 133: the upload as before.
Needs Deno (DENO, default: the deno on the PATH or /opt/deno/deno)."""
import os, sys, json, time, gzip, base64, hashlib, subprocess, threading, urllib.request, urllib.error, shutil, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
SQLDIR = os.path.join(HERE, "..", "server", "tally-cloud")
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK, BOOK2 = "99999999-9999-9999-9999-999999999133", "11111111-1111-1111-1111-111111111133", "11111111-1111-1111-1111-111111112133"
DA, KA = "d1000000-0000-0000-0000-000000000133", "fcd_" + "c" * 48
CG = "a2f776bd-4a48-4f7d-9c73-48a8f087b133"
GA = {"id": "go-aaaaaa133133", "computer": "MADEUP-PC", "user": "madeup", "mode": "main", "runMode": "user", "version": "2.4.9"}
CA = "2026-10-30T05:00:00.123456+00:00"
NEXT = {BOOK: [{"day": "20250830", "fetch": True, "types": ["Sales"], "chosenAt": CA}]}
CHECK = {BOOK: [{"day": "20250830", "fetch": True, "chosenAt": CA, "check": True}, {"day": "20250712", "fetch": True, "chosenAt": CA, "check": True}, {"day": "20250711", "fetch": True, "chosenAt": CA, "check": True}],
         BOOK2: [{"day": "20250601", "fetch": True, "chosenAt": "2026-10-30T06:00:00+00:00", "check": True}]}
CHECKDAYS = {"20250712"}
real = FS.rpc
def rpc(name, a):
    if name.startswith("tally_period") or name.startswith("tally_check") or name == "tally_ledger_progress_save":
        FS.ARGS.setdefault(name, []).append(a)
        if name in FS.NO_FN: raise LookupError("PGRST202")
        if name in ("tally_period_next", "tally_period_next_paced"): return NEXT.get(a["p_book"], [])[: a["p_max"]]
        if name == "tally_check_next": return CHECK.get(a["p_book"], [])[: a["p_max"]]
        if name == "tally_period_gate": return True
        if name == "tally_check_heads":
            if a["p_day"].replace("-", "") not in CHECKDAYS: return {"ok": True, "mine": False}
            return {"ok": True, "mine": True, "n": len(a["p_heads"]), "want": ["7", "9"], "done": False, "removed": 0}
        if name == "tally_period_heads":
            if a["p_day"].replace("-", "") in CHECKDAYS: return {"ok": False, "error": "FinCom did not ask for this day"}
            return {"ok": True, "n": len(a["p_heads"]), "held": 1, "done": False, "want": [str(h[1]) for h in a["p_heads"][1:]]}
        if name == "tally_check_entries":
            if a["p_day"].replace("-", "") not in CHECKDAYS: return {"ok": True, "mine": False}
            return {"ok": True, "mine": True, "stored": len(a["p_vouchers"]), "added": 1, "updated": 0, "done": True, "want": []}
        if name in ("tally_period_entries", "tally_period_entries_logged"):
            if a["p_day"].replace("-", "") in CHECKDAYS: return {"ok": False, "error": "FinCom did not ask for this day"}
            return {"ok": True, "stored": len(a["p_vouchers"]), "stale": 0, "held": 2, "n": 3, "done": False, **({"logged": 1} if name.endswith("logged") else {})}
        if name == "tally_check_queue": return {"ok": True, "queued": len(a.get("p_days") or [])}
        return {"ok": True}
    return real(name, a)
FS.rpc = rpc
FS.USERS.update({"tok-owner": {"id": "u-owner", "email": "o@zz.test"}})
FS.T["members"] += [{"user_id": "u-owner", "firm_id": FIRM, "role": "owner", "active": True}]
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "MADE UP CO", "client_id": "c1", "book_id": BOOK}, {"firm_id": FIRM, "company": "SECOND MADE UP", "client_id": "c2", "book_id": BOOK2}]
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "MADEUP-PC", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.4.9", "period_fetch": False})
FS.T["tally_books"] += [{"book_id": BOOK, "firm_id": FIRM, "client_id": "c1", "company": "MADE UP CO", "from_date": "2025-04-01", "open_as_on": "2025-03-31"},
                        {"book_id": BOOK2, "firm_id": FIRM, "client_id": "c2", "company": "SECOND MADE UP", "from_date": "2025-04-01", "open_as_on": "2025-03-31"}]
FS.T["clients"] += [{"id": "c1", "firm_id": FIRM, "name": "MADE UP CO", "tally_name": "MADE UP CO", "gstin": "", "deleted": False}, {"id": "c2", "firm_id": FIRM, "name": "SECOND MADE UP", "tally_name": "SECOND MADE UP", "gstin": "", "deleted": False}]
FS.T["tally_sync_cursor"] = [{"book_id": BOOK, "company_guid": CG}, {"book_id": BOOK2, "company_guid": "book2-guid"}]
FS.T.setdefault("tally_days", []); FS.T.setdefault("tally_jobs", [])
FS.T["tally_jobs"].append({"id": "job-q", "firm_id": FIRM, "client_id": "c1", "book_id": BOOK, "kind": "upload", "sealed": True, "status": "running", "total": 2, "done": 0})
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", os.path.join(SQLDIR, "index.ts")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA, tok=None, headers=None):
    h = {"Content-Type": "application/json"}; h.update(headers or {})
    if key: h["x-fincom-device"] = key
    if tok: h["Authorization"] = "Bearer " + tok
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers=h)
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"{}")
        except ValueError: return e.code, {}
def V(mid, day, amt="100.00"):
    return ('<VOUCHER REMOTEID="%s-%08x" VCHTYPE="Sales"><DATE>%s</DATE><GUID>%s-%08x</GUID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>%d</VOUCHERNUMBER>'
            '<PARTYLEDGERNAME>Made-up Traders</PARTYLEDGERNAME><ALTERID> %d</ALTERID><MASTERID> %d</MASTERID>'
            '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Made-up Traders</LEDGERNAME><AMOUNT>-%s</AMOUNT></ALLLEDGERENTRIES.LIST>'
            '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') % (CG, mid, day, CG, mid, mid, 5000 + mid, mid, amt, amt)
gz = lambda s: base64.b64encode(gzip.compress(s.encode())).decode()
TYPES6 = ["Sales", "Purchase", "Receipt", "Payment", "Journal", "Contra"]
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)
    base = {"version": "2.4.9", "bridge": GA}
    beat = dict(base, kind="beat", tally=True, open=["MADE UP CO", "SECOND MADE UP"], companies=[{"name": "MADE UP CO", "open": True, "guid": CG}, {"name": "SECOND MADE UP", "open": True}])
    dev = next(d for d in FS.T["tally_devices"] if d["id"] == DA)
    h0 = (datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)).hour
    dev.update(period_night_from=(h0 + 2) % 24, period_night_to=(h0 + 4) % 24, period_night_sunday=False)
    print("== 1. the beat")
    c, r = call(beat)
    ok(c == 200 and r.get("periodDays") == [] and not FS.ARGS.get("tally_check_next"), "1. the switch off: no days, the check not asked (%s)" % r.get("periodDays"))
    dev["period_fetch"] = True
    c, r = call(beat)
    pd = r.get("periodDays") or []
    ok(c == 200 and len(pd) == 3, "1. 3 days by day (%s)" % pd)
    ok(pd and pd[0].get("day") == "20250830" and pd[0].get("chosenAt") == CA, "1. the period's day first, with its choice time (%s)" % (pd[:1],))
    ok([x.get("day") for x in pd] == ["20250830", "20250712", "20250711"] and all(x.get("fetch") is True and x.get("chosenAt") == CA for x in pd[1:]), "1. then the upload's days to check, a day never twice (%s)" % [x.get("day") for x in pd])
    ok(pd[1:] and all(x.get("types") == TYPES6 and x.get("company") == "MADE UP CO" and x.get("company_guid") == CG for x in pd[1:]), "1. the check's days: the six standard types, the company and its GUID (%s)" % (pd[1:2],))
    ca = next((x for x in FS.ARGS.get("tally_check_next") or [] if x.get("p_book") == BOOK), {})
    ok(ca.get("p_book") == BOOK and ca.get("p_max") == 3, "1. the check asked for the room left plus the company's days already listed (%s)" % ca)
    c, r = call(dict(beat, paused=True))
    ok(c == 200 and r.get("periodDays") == [], "1. paused: none")
    FS.NO_FN.add("tally_check_next")
    c, r = call(beat)
    ok(c == 200 and [x.get("day") for x in r.get("periodDays") or []] == ["20250830"] and r.get("ok") is True, "1. a cloud without 133: the period's days as before (%s)" % r.get("periodDays"))
    FS.NO_FN.discard("tally_check_next")

    print("== 2. period_heads")
    heads = [[CG + "-00000001", 1, 5001, "Sales", "PRIVATE"], [CG + "-00000007", 7, 5007, "Sales"], [CG + "-00000009", 9, 5009, "Receipt"]]
    c, r = call(dict(base, kind="period_heads", company="MADE UP CO", company_guid=CG, day="20250712", via="day", n=3, heads=heads, fetch=True))
    a = (FS.ARGS.get("tally_check_heads") or [{}])[-1]
    ok(c == 200 and r.get("ok") is True and sorted(r.get("want") or []) == ["7", "9"] and r.get("done") is False, "2. a day being checked: the check's answer (%s)" % r)
    ok(a.get("p_day") == "2025-07-12" and a.get("p_via") == "day" and a.get("p_heads") == [h[:4] for h in heads], "2. four columns a head, the day, how listed (%s)" % a)
    ok((FS.ARGS.get("tally_period_heads") or [{}])[-1].get("p_day") == "2025-07-12", "2. the period's own count asked as well")
    n0 = len(FS.ARGS.get("tally_check_heads") or [])
    c, r = call(dict(base, kind="period_heads", company="MADE UP CO", company_guid=CG, day="20250830", via="day", n=3, heads=heads, fetch=True))
    ok(c == 200 and r.get("want") == ["7", "9"] and r.get("held") == 1, "2. a day not being checked: the period's path as before (%s)" % r)
    FS.NO_FN.add("tally_check_heads")
    c, r = call(dict(base, kind="period_heads", company="MADE UP CO", company_guid=CG, day="20250830", via="day", n=3, heads=heads, fetch=True))
    ok(c == 200 and r.get("ok") is True and r.get("want") == ["7", "9"], "2. a cloud without 133: as before (%s)" % r)
    FS.NO_FN.discard("tally_check_heads")

    print("== 3. period_entries")
    sj = ('<VOUCHER VCHTYPE="Stock Journal"><DATE>20250712</DATE><GUID>%s-%08x</GUID><VOUCHERTYPENAME>Stock Journal</VOUCHERTYPENAME><ALTERID> 77</ALTERID><MASTERID> 11</MASTERID></VOUCHER>' % (CG, 11))
    c, r = call(dict(base, kind="period_entries", company="MADE UP CO", company_guid=CG, day="20250712", vouchers=[V(7, "20250712"), V(9, "20250712"), sj], gone=[], full=True))
    e = (FS.ARGS.get("tally_check_entries") or [{}])[-1]
    vs = e.get("p_vouchers") or []
    ok(c == 200 and r.get("ok") is True and r.get("done") is True and r.get("stored") == 2 and r.get("added") == 1, "3. a day being checked: the check's answer (%s)" % r)
    ok(len(vs) == 2 and all(v.get("day") == "2025-07-12" for v in vs) and len(e.get("p_lines") or []) == 4 and e.get("p_seen") == {"%s-%08x" % (CG, 11): 77}, "3. the entries as a Day Book's, their lines, the seen one (%s)" % e.get("p_seen"))
    c, r = call(dict(base, kind="period_entries", company="MADE UP CO", company_guid=CG, day="20250830", vouchers=[V(2, "20250830")], gone=[], full=True))
    ok(c == 200 and r.get("ok") is True and r.get("stored") == 1 and (FS.ARGS.get("tally_period_entries_logged") or [{}])[-1].get("p_day") == "2025-08-30", "3. the period's entries through tally_period_entries_logged (%s)" % r)
    FS.NO_FN.update(["tally_check_entries", "tally_period_entries_logged"])
    n1 = len(FS.ARGS.get("tally_period_entries") or [])
    c, r = call(dict(base, kind="period_entries", company="MADE UP CO", company_guid=CG, day="20250830", vouchers=[V(3, "20250830")], gone=[], full=True))
    ok(c == 200 and r.get("ok") is True and len(FS.ARGS.get("tally_period_entries") or []) == n1 + 1, "3. a cloud without 133: tally_period_entries as before (%s)" % r)
    FS.NO_FN.difference_update(["tally_check_entries", "tally_period_entries_logged"])

    print("== 4. period_stop")
    c, r = call(dict(base, kind="period_stop", company="MADE UP CO", company_guid=CG, day="20250712", why="window", chosenAt=CA, words="Tally stopped answering while FinCom read 12-Jul-2025."))
    s = (FS.ARGS.get("tally_check_stop") or [{}])[-1]
    ok(c == 200 and s.get("p_book") == BOOK and s.get("p_day") == "2025-07-12" and s.get("p_why") == "window" and s.get("p_chosen_at") == CA, "4. the check stops with the period, the same choice time (%s)" % s)

    print("== 5. an upload read into FinCom queues its days for the check")
    day0 = "<ENVELOPE><BODY><DATA><TALLYMESSAGE>" + V(21, "20250901") + "</TALLYMESSAGE></DATA></BODY></ENVELOPE>"
    c, r = call({"kind": "upload_days", "client": "c1", "company": "MADE UP CO", "days": [{"day": "20250901", "gz": gz(day0)}, {"day": "20250902", "gz": gz("<ENVELOPE></ENVELOPE>")}]}, key=None, tok="tok-owner")
    qa = (FS.ARGS.get("tally_check_queue") or [{}])[-1]
    ok(c == 200 and qa.get("p_book") == BOOK and sorted(qa.get("p_days") or []) == ["2025-09-01", "2025-09-02"] and qa.get("p_source") == "upload", "5. a person's upload: its days queued (%s / %s)" % (r, qa))
    nq = len(FS.ARGS.get("tally_check_queue") or [])
    c, r = call(dict(base, kind="days", company="MADE UP CO", company_guid=CG, days=[{"day": "20250903", "gz": gz("<ENVELOPE></ENVELOPE>")}]))
    ok(c == 200 and len(FS.ARGS.get("tally_check_queue") or []) == nq, "5. the bridge's own day reads never queue a check (%s)" % c)
    FS.QUEUE.append({"msg_id": 990133, "vt": 0, "read_ct": 0, "message": {"job": "job-q", "firm": FIRM, "book": BOOK, "days": [{"day": "20250905", "gz": gz("<ENVELOPE></ENVELOPE>")}]}, "archived": False})
    c, r = call({"kind": "work"}, key=None, headers={"x-fincom-work": FS.WORK_KEY})
    qa = (FS.ARGS.get("tally_check_queue") or [{}])[-1]
    ok(c == 200 and qa.get("p_days") == ["2025-09-05"] and qa.get("p_book") == BOOK, "5. the upload job's days read by the queue: queued (%s / %s)" % (r, qa))
    FS.NO_FN.add("tally_check_queue")
    c, r = call({"kind": "upload_days", "client": "c1", "company": "MADE UP CO", "days": [{"day": "20250906", "gz": gz("<ENVELOPE></ENVELOPE>")}]}, key=None, tok="tok-owner")
    ok(c == 200 and r.get("ok") is True and r.get("done") == ["20250906"], "5. a cloud without 133: the upload as before (%s)" % r)
    FS.NO_FN.discard("tally_check_queue")
finally:
    fn.terminate()
    FS.stop() if hasattr(FS, "stop") else None
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
