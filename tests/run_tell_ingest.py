"""python3 run_tell_ingest.py - a proper way to tell (the owner's decision of 24-Nov-2026: "There should be proper way to tell and
auto import of tally days into fincom"; the plan tally-tell-autoday, A.4 and A.5). tally-ingest (server/tally-cloud/index.ts
under Deno, against the stand-in for Supabase, fake_supabase.py). Checks:
  1. bridge 2.5.22's beat: skip, numbersWhy and addonSilent kept on info.bridges[<bridge>].tell, cleaned (known codes only,
     at most 50, names cut to 200), with its time; the bridge's own words never kept
  2. an older bridge (none of the keys, every company started): no tell; another bridge's tell kept as it was
  4. a held line dated before the book's first day never says FinCom brings that day by itself (the owner, 24-Nov: an
     earlier year is never added or read by itself)
  3. FinCom's words never ask for a Day Book upload: a day stopped for good, a day's list stopped, a day marked by the
     bridge, the pick-up reasons, the days the bridge lists, the renumbering alerts, and no such words left in index.ts
Needs Deno (DENO). Made-up books only."""
import os, sys, json, re, time, hashlib, subprocess, threading, urllib.request, urllib.error, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_supabase as FS
DENO = os.environ.get("DENO") or shutil.which("deno") or "/opt/deno/deno"
INDEX = os.environ.get("INDEX_TS") or os.path.join(HERE, "..", "server", "tally-cloud", "index.ts")
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIRM, BOOK = "99999999-9999-9999-9999-999999992210", "11111111-1111-1111-1111-111111112210"
DA, KA = "d2210000-0000-0000-0000-000000002210", "fcd_" + "d" * 48
CG = "a2f776bd-4a48-4f7d-9c73-48a8f0872210"
GA = {"id": "go-aaaaaa221022", "computer": "PC-MADEUP", "user": "madeup-a", "mode": "main", "runMode": "user", "version": "2.5.22"}
GB = {"id": "go-bbbbbb221022", "computer": "PC-MADEUP", "user": "madeup-b", "mode": "main", "runMode": "user", "version": "2.5.16"}
LOCKED = [False]
def V(mid, day, amt="100.00", other=""):
    return ('<VOUCHER REMOTEID="%s-%08x" VCHTYPE="Sales"><DATE>%s</DATE><GUID>%s-%08x</GUID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>%d</VOUCHERNUMBER>'
            '<PARTYLEDGERNAME>Spike Customer</PARTYLEDGERNAME><ALTERID> %d</ALTERID><MASTERID> %d</MASTERID>'
            '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Spike Customer</LEDGERNAME><AMOUNT>-%s</AMOUNT></ALLLEDGERENTRIES.LIST>'
            '<ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales</LEDGERNAME><AMOUNT>%s</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER>') % (CG, mid, day, CG, mid, mid, 5000 + mid, mid, amt, amt if other == "" else other)
def words_of(x):     # every text a reply carries (its keys' names aside: the bridge reads the key "upload")
    if isinstance(x, dict): return [w for v in x.values() for w in words_of(v)]
    if isinstance(x, list): return [w for v in x for w in words_of(v)]
    return [x] if isinstance(x, str) else []
OLD_WORDS = "Tally could not send 31-Aug-2025 in time on 3 days. Upload that day's Day Book to finish it."
real = FS.rpc
def rpc(name, a):
    if name.startswith("tally_period") or name.startswith("tally_check") or name in ("tally_days_claim", "tally_autoday_queue"):
        FS.ARGS.setdefault(name, []).append(a)
        if name in FS.NO_FN: raise LookupError("PGRST202")
        if name in ("tally_period_entries", "tally_period_entries_logged") and LOCKED[0]: return {"ok": True, "locked": True, "stored": 0, "upload": "FinCom did not bring in 30-Aug-2025: its month is locked in FinCom. Unlock the month, then upload that day's Day Book."}
        if name in ("tally_period_entries", "tally_period_entries_logged"): return {"ok": True, "stored": 1, "n": 1, "done": False}
        if name == "tally_period_day_stop": return {"ok": True, "fails": 3, "upload": True, "retryAt": "", "words": OLD_WORDS}
        if name == "tally_period_gate": return True
        if name in ("tally_period_next", "tally_period_next_paced", "tally_check_next", "tally_check_next_open", "tally_days_claim", "tally_period_retry_days"): return []
        return {"ok": True}
    if name in ("tally_recorder_send", "tally_recorder_apply"):
        FS.ARGS.setdefault(name, []).append(a)
        return {"results": [{"line_id": l.get("line_id"), "state": "held"} for l in a.get("p_lines") or []]}
    return real(name, a)
FS.rpc = rpc
FS.T["tally_companies"] += [{"firm_id": FIRM, "company": "MADE UP CO", "client_id": "c1", "book_id": BOOK}]
FS.T["tally_devices"].append({"id": DA, "firm_id": FIRM, "name": "PC-MADEUP", "key_hash": hashlib.sha256(KA.encode()).hexdigest(), "revoked": False, "info": {}, "version": "2.5.22", "period_fetch": True})
FS.T["tally_books"] += [{"book_id": BOOK, "firm_id": FIRM, "client_id": "c1", "company": "MADE UP CO", "from_date": "2026-04-01", "open_as_on": "2026-03-31"}]
FS.T["clients"] += [{"id": "c1", "firm_id": FIRM, "name": "MADE UP CO", "tally_name": "MADE UP CO", "gstin": "", "deleted": False}]
FS.T["tally_sync_cursor"] = [{"book_id": BOOK, "company_guid": CG}]
FS.start()
env = dict(os.environ, SUPABASE_URL="http://127.0.0.1:%d" % FS.PORT, SUPABASE_SERVICE_ROLE_KEY=FS.SERVICE, SUPABASE_ANON_KEY="anon-key")
fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-env", "--allow-read", INDEX], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
log = []
threading.Thread(target=lambda: [log.append(l) for l in fn.stdout], daemon=True).start()
def call(body, key=KA):
    rq = urllib.request.Request("http://127.0.0.1:8000/", data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-fincom-device": key})
    try: r = urllib.request.urlopen(rq, timeout=60); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def info(): return next(d for d in FS.T["tally_devices"] if d["id"] == DA).get("info") or {}
def tell(b=GA): return ((info().get("bridges") or {}).get(b["id"]) or {}).get("tell")
CO = [{"name": "MADE UP CO", "open": True, "guid": CG, "altvchid": 95937, "altmstid": 400}]
base = {"version": "2.5.22", "bridge": GA, "kind": "beat", "tally": True, "open": ["MADE UP CO"], "companies": CO}
try:
    for i in range(240):
        try: urllib.request.urlopen("http://127.0.0.1:8000/", timeout=1)
        except urllib.error.HTTPError: break
        except Exception: time.sleep(0.5)

    print("== 1. bridge 2.5.22: kept on its own record, cleaned")
    AS = {"company": "MADE UP CO", "guid": CG.upper(), "reason": "addonShared", "since": "2026-11-24T10:00:00+05:30", "tallyAlter": 95937, "lastLineAlter": 95888, "words": "please upload the Day Book"}
    c, r = call(dict(base, skip={"MADE UP CO": "ownerUnknown", "ACME": "made up", "  OTHER CO \r\n": "twoTallys"},
                     numbersWhy={"MADE UP CO": "lightFailed", "X": "upload the Day Book"}, addonSilent=[AS, {"company": "", "reason": "noFile"}, "junk"]))
    t = tell() or {}
    ok(c == 200 and r.get("ok") is True, "1. the beat answered as ever")
    ok(t.get("skip") == {"MADE UP CO": "ownerUnknown", "OTHER CO": "twoTallys"}, "1. skip: known codes, names trimmed (%s)" % t.get("skip"))
    ok(t.get("numbersWhy") == {"MADE UP CO": "lightFailed"}, "1. numbersWhy: known codes only (%s)" % t.get("numbersWhy"))
    ok(t.get("addonSilent") == [{"company": "MADE UP CO", "guid": CG, "reason": "addonShared", "since": AS["since"], "tallyAlter": 95937, "lastLineAlter": 95888}], "1. addonSilent cleaned (%s)" % t.get("addonSilent"))
    ok(isinstance(t.get("at"), str) and t["at"] >= (info().get("beat") or {}).get("at", "z")[:16], "1. with its time (%s)" % t.get("at"))
    ok("upload" not in json.dumps(t).lower(), "1. the bridge's words never kept")
    ok("recorderStuck" not in (info().get("beat") or {}), "1. info.beat.recorderStuck not written by addonSilent (a key of its own)")
    c, r = call(dict(base, skip={"CO %d" % i: "notOpen" for i in range(80)}, numbersWhy={}, addonSilent=[]))
    ok(len((tell() or {}).get("skip") or {}) == 50, "1. at most 50 (%d)" % len((tell() or {}).get("skip") or {}))

    print("== 2. an older bridge")
    c, r = call(dict(base, version="2.5.16", bridge=GB))
    ok(c == 200 and tell(GB) is None, "2. no keys, every company started: no tell (%s)" % tell(GB))
    ok(len((tell() or {}).get("skip") or {}) == 50, "2. the other bridge's tell kept as it was")
    c, r = call(dict(base))
    ok(tell() is None, "2. 2.5.22 saying none of them any more: none (%s)" % tell())

    print("== 3. no ask for an upload")
    b16 = {"version": "2.5.16", "bridge": GB}
    c, r = call(dict(b16, kind="period_day_stop", company="MADE UP CO", company_guid=CG, day="20250831", why="over2s"))
    ok(c == 200 and r.get("upload") is True and r.get("words") == "Tally could not send 31-Aug-2025 in time on 3 days. FinCom tries it again by itself.", "3. a day stopped on its 3rd day: FinCom's words (%s)" % r.get("words"))
    c, r = call(dict(b16, kind="period_heads", company="MADE UP CO", company_guid=CG, day="20250830", upload=True, why="over2s", type="Sales", words="Tally took too long to give 30-Aug-2025. Please upload that day's Day Book."))
    u = (FS.ARGS.get("tally_period_upload") or [{}])[-1]
    ok(c == 200 and u.get("p_words") == "Tally took too long to give 30-Aug-2025. FinCom brings this day from Tally by itself.", "3. a day the bridge marks: kept without the ask (%s)" % u.get("p_words"))
    c, r = call(dict(b16, kind="period_stop", company="MADE UP CO", company_guid=CG, day="20250830", why="over2s", chosenAt="2026-11-24T08:00:00.123456+00:00",
                     words="Tally took too long to give 30-Aug-2025, so FinCom stopped reading older entries of MADE UP CO. Please upload the Day Book for the days still missing."))
    ps, cs = (FS.ARGS.get("tally_period_stop") or [{}])[-1], (FS.ARGS.get("tally_check_stop") or [{}])[-1]
    ok(c == 200 and ps.get("p_words") == cs.get("p_words") == "Tally took too long to give 30-Aug-2025, so FinCom stopped reading older entries of MADE UP CO. FinCom tries again by itself.", "3. a stopped list: both kept without the ask (%s)" % ps.get("p_words"))
    PU = [{"company": "MADE UP CO", "guid": CG, "kind": k, "chosenAt": "2026-11-24T05:00:00Z", "takenAt": "2026-11-24T05:00:02Z", "state": "refused", "day": "20250830", "code": code, "at": "2026-11-24T05:00:03Z"}
          for k, code in (("period", "stopped"), ("check", "dayRetry"))]
    call(dict(base, pickups=PU, periodPull={"uploadDays": [{"company": "MADE UP CO", "day": "20250830", "words": "Upload the Day Book for 30-Aug-2025"}]},
              renumberAlerts=[{"company": "MADE UP CO", "words": "Tally may have renumbered 3 entries: upload the Day Book from 01-Oct-2026", "n": 3, "from": "20261001", "type": "Sales", "at": "2026-11-24T05:00:00Z"}]))
    bt = info().get("beat") or {}
    pw = {p.get("code"): p.get("words") for p in bt.get("pickups") or []}
    ok(pw.get("stopped") and pw.get("dayRetry") and not any(re.search(r"upload|choose it again", w, re.I) for w in pw.values()), "3. pick-up reasons: no upload, no 'choose it again' (%s)" % pw)
    ud = ((bt.get("periodPull") or {}).get("uploadDays") or [{}])[0]
    ok(ud.get("day") == "20250830" and "upload" not in ud.get("words", "upload").lower(), "3. the days the bridge lists: no ask (%s)" % ud)
    ra = (bt.get("renumberAlerts") or [{}])[0]
    ok(ra.get("words") == "Tally may have renumbered 3 entries. FinCom reads these days from Tally again by itself.", "3. a renumbering alert: no ask (%s)" % ra.get("words"))
    replies = []
    c, r = call(dict(b16, kind="period_entries", company="MADE UP CO", company_guid=CG, day="20250830", vouchers=[V(6, "20250830"), V(7, "20250830", other="90.00")], full=True)); replies.append(r)
    ok(c == 200 and r.get("notTaken") == 1 and r.get("upload") == "FinCom could not read 30-Aug-2025 from Tally yet. FinCom tries again by itself.", "3. an entry whose lines do not total zero: plain words (%s)" % r.get("upload"))
    LOCKED[0] = True
    c, r = call(dict(b16, kind="period_entries", company="MADE UP CO", company_guid=CG, day="20250830", vouchers=[V(8, "20250830")], full=True)); replies.append(r)
    LOCKED[0] = False
    ok(c == 200 and r.get("locked") is True and r.get("upload") == "FinCom did not bring in 30-Aug-2025: its month is locked in FinCom. Unlock the month, then press Bring missing days on the Tally page.", "3. a locked month: what to press (%s)" % r.get("upload"))
    c, r = call(dict(b16, kind="period_day_stop", company="MADE UP CO", company_guid=CG, day="20250831", why="over2s")); replies.append(r)
    bad = [w for x in replies for w in words_of(x) if "upload" in w.lower()]
    ok(not bad, "3. no reply's words contain 'upload' (%s)" % bad)
    code = [l for l in open(INDEX, encoding="utf-8").read().split("\n") if not l.lstrip().startswith("//")]
    asks = [l.strip()[:120] for l in code if re.search(r"(please upload|upload (the|that day's|this day's|the day's) day book|choose it again)", l.split(" // ")[0], re.I)]
    ok(not asks, "3. no ask for a Day Book upload left in index.ts (%s)" % asks)

    print("== 4. a line dated before the book's first day (01-Apr-2026)")
    for bk in FS.T["tally_books"]: bk.update(from_date="2026-04-01", open_as_on="2026-03-31")     # (section 3's older day moved the book's start)
    HW = "deleted in Tally; FinCom could not tell which entry: upload that day's Day Book to settle it"
    def dl(lid, d): return {"line_id": lid, "event": "deleted", "object_guid": "", "master_id": lid[1:], "alter_id": None, "vch_type": "Receipt", "vch_no": lid, "vch_date": d,
                            "saved_at": "2026-11-24T10:00:00Z", "pc": "PC", "user": "TALLY User", "company_guid": CG, "ledgers": [], "narration": "", "fid": "", "xml": "", "source": "addon", "heldWhy": HW}
    c, r = call({"kind": "recorder_lines", "version": "2.5.16", "bridge": GB, "company": "MADE UP CO", "company_guid": CG, "lines": [dl("D31", "20260331"), dl("D32", "20260402")]})
    sent = {l["line_id"]: l for l in ((FS.ARGS.get("tally_recorder_send") or FS.ARGS.get("tally_recorder_apply") or [{}])[-1].get("p_lines") or [])}
    w1, w2 = (sent.get("D31") or {}).get("heldWhy", ""), (sent.get("D32") or {}).get("heldWhy", "")
    ok(c == 200 and w1 == "deleted in Tally; FinCom could not tell which entry. It is dated before this book's first day in FinCom.", "4. before the first day: no promise to read it (%s %s)" % (c, w1))
    ok(((sent.get("D31") or {}).get("payload") or {}).get("heldWhy") == w1, "4. the payload's words the same")
    ok(w2 == "deleted in Tally; FinCom could not tell which entry. FinCom brings this day from Tally by itself.", "4. within the book: FinCom brings it (%s)" % w2)
finally:
    fn.terminate()
if fails:
    print("".join(log[-40:]))
print("\n" + ("PASSED" if not fails else "FAILED: %d" % len(fails)))
raise SystemExit(1 if fails else 0)
