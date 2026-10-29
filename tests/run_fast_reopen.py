"""python3 run_fast_reopen.py - next-fast-open (20-Oct-2026). The owner on Leads Insurance (Mac Safari): "FinCom is taking
long to open... then it updates books... this should not happen." Opening a client this browser already holds must show
its pages at once from what is kept here; the catch-up with FinCom's cloud runs quietly behind the page.

FinCom's cloud is a stand-in (every request held LATENCY_MS, 150 ms by default, many at a time) with a book shaped like the
staging copy of Leads (made-up names and amounts): 4,414 entries on 560 days (43 payroll entries), 749 ledgers, 56
employees, about 2,400 items of TDS/GST work (ledInfo 776, under 776, map 374, gstins 157, 101 allocations, 16 challans),
one allocation still pointing at a challan removed on the server (as on staging: a 192B line on a deleted challan).
  1. a fresh browser opens the client and brings everything in (measured only);
  2. the SECOND opening (a reload, nothing changed in the cloud): the TDS page usable from the copy here within
     REOPEN_MAX_MS (1,500 ms by default); no "Bringing in…/Reading the books/Loading the books" wait at any moment; the
     challans not fetched again for the allocation whose challan is gone (healed once, the outcome kept); the payroll not
     read again; no day file fetched; the cloud copy's entries checked with a narrow read (guid, AlterID, deleted), never
     every entry's full head; no reload of the page;
  3. the Day Book uploaded again with the same entries (every day's time changes, as on staging 18-Oct and 20-Oct): the
     days are fetched quietly in the background, nothing read into the books again, no wait shown; the next opening
     fetches no day at all, sends nothing to the server and reads nothing in full;
  4. a real change (one new entry on one day): the page still opens at once, the entry arrives by itself, no wait shown.
  flock /tmp/fincom-app.lock python3 tests/run_fast_reopen.py   (TDSDESK_SITE defaults to ../app/dist-test)"""
import os, sys, json, gzip, asyncio, threading, functools, http.server, time, random, re
from urllib.parse import urlparse, parse_qs, unquote
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("FAST_REOPEN_PORT") or 8462)
LAT = int(os.environ.get("LATENCY_MS", "150")) / 1000
MAXMS = int(os.environ.get("REOPEN_MAX_MS") or 1500)
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
CID, BOOK, FIRM = "cmzzleads0001", "zzbook00-0000-4000-8000-000000000001", "f0000000-0000-0000-0000-00000000000f"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(Quiet, directory=SITE)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# ---------- the made-up book, shaped like Leads' (sizes from staging, read-only)
random.seed(7)
esc = lambda s: str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
TDSL = ["TDS 94C", "TDS 94J 2%", "TDS 94J 10%", "TDS on Rent 94I", "TDS 192B"]
PAYH = ["Basic", "HRA", "Conveyance", "Special Allowance", "Arears", "Bonus", "Leave Encashment", "Medical", "LTA", "Telephone",
        "PF Employee", "ESI Employee", "Professional Tax", "TDS 192B", "Advance Recovery", "PF Employer", "ESI Employer", "Gratuity"]
PARTIES = ["ZZ Party %03d" % i for i in range(640)]
EMP = ["ZZ Employee %02d" % i for i in range(56)]
LEDGERS = [{"name": n, "parent": "Sundry Creditors", "open": 0} for n in PARTIES] + \
          [{"name": n, "parent": "Duties & Taxes", "open": 0} for n in TDSL] + \
          [{"name": "ZZ Expense %02d" % i, "parent": "Indirect Expenses", "open": 0} for i in range(60)] + \
          [{"name": h, "parent": "Indirect Expenses", "open": 0} for h in PAYH if h not in TDSL] + \
          [{"name": "ZZ Bank", "parent": "Bank Accounts", "open": 500000}, {"name": "Salary Payable", "parent": "Current Liabilities", "open": 0}]
while len(LEDGERS) < 749: LEDGERS.append({"name": "ZZ Misc %03d" % len(LEDGERS), "parent": "Indirect Expenses", "open": 0})
import datetime
D0 = datetime.date(2025, 4, 1); DAYS = [(D0 + datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(560)]
iso = lambda d8: d8[:4] + "-" + d8[4:6] + "-" + d8[6:8]
VOUCHERS = []      # {guid, day, alt, type, no, party, lines: [(ledger, amount)]}
pay_days = [d for d in DAYS if d.endswith("28")][:19]
for i in range(4414):
    d = DAYS[i * len(DAYS) // 4414]; g = "zzguid-%05d" % i
    p = PARTIES[i % len(PARTIES)]; amt = 1000 + (i * 37) % 90000
    if i % 7 == 0:
        t = TDSL[i % 4]; tds = round(amt * 0.02, 2)
        lines = [("ZZ Expense %02d" % (i % 60), -amt), (t, tds), (p, round(amt - tds, 2))]
    else:
        lines = [("ZZ Expense %02d" % (i % 60), -amt), (p, amt)]
    VOUCHERS.append({"guid": g, "day": d, "alt": 1000 + i, "type": "Journal", "no": str(i + 1), "party": p, "lines": lines})
# 43 payroll entries (two a month), each employee on Basic / HRA / TDS 192B as cost centres
PAYV = []
for k in range(43):
    v = VOUCHERS[100 * k + 50]; v["type"] = "Payroll"; v["party"] = ""; v["lines"] = [("Basic", -500000), ("HRA", -100000), ("TDS 192B", 50000), ("Salary Payable", 550000)]; PAYV.append(v)
def vxml(v):
    ent = "".join("<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><ISDEEMEDPOSITIVE>%s</ISDEEMEDPOSITIVE><AMOUNT>%.2f</AMOUNT></ALLLEDGERENTRIES.LIST>"
                  % (esc(l), "Yes" if a < 0 else "No", a) for l, a in v["lines"])
    return ('<TALLYMESSAGE><VOUCHER VCHTYPE="%s" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><ALTERID>%d</ALTERID><VOUCHERTYPENAME>%s</VOUCHERTYPENAME>'
            "<VOUCHERNUMBER>%s</VOUCHERNUMBER><PARTYLEDGERNAME>%s</PARTYLEDGERNAME><NARRATION>zz</NARRATION><ISCANCELLED>No</ISCANCELLED><ISOPTIONAL>No</ISOPTIONAL>%s</VOUCHER></TALLYMESSAGE>"
            % (esc(v["type"]), v["day"], v["guid"], v["alt"], esc(v["type"]), v["no"], esc(v["party"]), ent))
def head(v):
    return {"guid": v["guid"], "day": iso(v["day"]), "alter_id": v["alt"], "vtype": v["type"], "vno": v["no"], "party": v["party"], "narration": "zz " * 20,
            "cancelled": False, "optional": False, "deleted_at": None, "gstin": None, "pos": None, "ref": "ZZ/REF/%s" % v["no"], "ref_date": iso(v["day"]), "cmp_gstin": "09ZZZZZ0000Z1Z0",
            "irn": None, "irn_ack_date": None, "gst_reg_type": "Regular", "gst_country": "India", "gst_rcm": False, "gst_nature": None, "gst_taxability": None, "gst_supply": None,
            "gst_ineligible": False, "gst_mixed": False, "gst_alter_id": v["alt"], "tds_tally": None, "tds_tally_alter_id": None, "book_id": BOOK}
GZ = {}
DAY_AT = {d: "2026-10-18T03:54:00+00:00" for d in DAYS}
def build_days():
    by = {}
    for v in VOUCHERS: by.setdefault(v["day"], []).append(vxml(v))
    for d in DAYS: GZ[d] = gzip.compress(("<ENVELOPE><BODY><DATA>" + "".join(by.get(d, [])) + "</DATA></BODY></ENVELOPE>").encode("utf-8"))
build_days()
T = {"tally_ledgers": [dict(l, book_id=BOOK, pan=None, gstin=None, tds_nature=None, tds_special_rate=None, tds_ldc=None, merged_into=None, deleted_at=None,
                            for_payroll=l["name"] in PAYH, pay_type=("Deductions from Employees" if l["name"] in ("TDS 192B", "PF Employee", "ESI Employee", "Professional Tax") else "Earnings for Employees") if l["name"] in PAYH else None,
                            pay_stat_type=None, it_component=None) for l in LEDGERS],
     "tally_groups": [], "tally_tds_natures": [], "tally_recorder_lines": [], "tally_salary_pays": [],
     "tally_employees": [{"guid": "zzemp-%02d" % i, "name": e, "parent": "Staff", "category": "", "is_group": False, "pan": "ZZZPZ%04dZ" % i, "joined": "2024-04-01",
                          "left_on": None, "designation": "Officer", "gone_at": None, "book_id": BOOK} for i, e in enumerate(EMP)],
     "tally_cost_allocs": [], "tally_vouchers": [head(v) for v in VOUCHERS], "tally_lines": [], "tally_bills": []}
for v in PAYV:
    for e in EMP:
        for hname, a in (("Basic", 8900), ("HRA", 1780), ("TDS 192B", 890)):
            T["tally_cost_allocs"].append({"guid": v["guid"], "alter_id": v["alt"], "day": iso(v["day"]), "ledger": hname, "centre": e, "amount": a, "gone_at": None, "book_id": BOOK})
# ---------- the TDS/GST work as items (client_book_items), shaped like Leads'
AT = "2026-10-20T07:45:00+00:00"; ITEMS = []
def item(k, i, d, o=None, deleted=False):
    ITEMS.append({"key": k, "item": i, "ord": o, "data": None if deleted else d, "deleted": deleted, "seq": len(ITEMS) + 1, "updated_at": AT, "updated_by": "u-other"})
for k in ("ledInfo", "under", "map", "gstins", "alloc", "pans"): item(k, "", {"$t": "obj"})
for n in [l["name"] for l in LEDGERS][:750] + ["ZZ Gone %02d" % i for i in range(26)]: item("ledInfo", "." + n, {"pan": "", "gstin": "", "addr": "zz " * 8})
for l in LEDGERS + [{"name": "ZZ Gone %02d" % i, "parent": "Sundry Creditors"} for i in range(27)]: item("under", "." + l["name"], l["parent"])
for n in [l["name"] for l in LEDGERS][:370] + TDSL[:4]: item("map", "." + n, {"kind": "tds" if n in TDSL else "other", "ok": n in TDSL, "what": "tds_payable" if n in TDSL else ""})
for n in PARTIES[:157]: item("gstins", "." + n, "09ZZZZZ%04dZ1Z5" % PARTIES.index(n))
CH = [{"id": "chzz%02d" % i, "bsr": "1234567", "tax": 10000 + i, "date": "2026%02d07" % (4 + i % 6), "serial": "%05d" % (i + 1), "section": "194C", "interest": 0, "from": "books"} for i in range(15)]
item("challans", "", {"$t": "arr"})
for i, c in enumerate(CH): item("challans", "#" + c["id"], c, i)
item("challans", "#chzzgone", None, deleted=True)      # the challan removed on the server; one allocation still points at it
tds_v = [v for v in VOUCHERS if any(l in TDSL[:4] for l, _ in v["lines"])]
for j, v in enumerate(tds_v[:100]): item("alloc", "." + v["guid"] + "|" + next(l for l, _ in v["lines"] if l in TDSL), CH[j % 15]["id"])
item("alloc", "." + PAYV[0]["guid"] + "|TDS 192B", "chzzgone")
STATUS_AT = {"ledgersAt": "2026-10-17T16:18:53Z", "daysAt": "2026-10-18T03:54:22Z"}
LOG = []           # (t, path, select, bytes)
def proj(rows, q):
    sel = (q.get("select") or [None])[0]
    for key, vals in q.items():
        if key in ("select", "order", "limit", "offset"): continue
        v = vals[0]
        if v.startswith("eq."): rows = [r for r in rows if str(r.get(key)).lower() == v[3:].lower() or (r.get(key) is True and v[3:] == "true")]
        elif v.startswith("in.("):
            s = set(x.strip('"') for x in re.findall(r'"(?:[^"\\]|\\.)*"|[^,]+', v[4:-1])); rows = [r for r in rows if str(r.get(key)) in s]
        elif v == "is.null": rows = [r for r in rows if r.get(key) is None]
        elif v == "not.is.null": rows = [r for r in rows if r.get(key) is not None]
        elif v.startswith("gt."): rows = [r for r in rows if str(r.get(key) or "") > v[3:]]
    off = int((q.get("offset") or ["0"])[0]); lim = int((q.get("limit") or ["1000"])[0]); rows = rows[off:off + lim]
    if sel: cols = sel.split(","); rows = [{c: r.get(c) for c in cols} for r in rows]
    return rows
async def route(r):
    await asyncio.sleep(LAT)
    u = urlparse(r.request.url); path = u.path; q = parse_qs(u.query)
    async def j(o):
        b = json.dumps(o); LOG.append((time.time(), path.split("/")[-1], (q.get("select") or [""])[0] + ("&key=" + q["key"][0] if "key" in q else "") + ("&guid" if "guid" in q else ""), len(b)))
        return await r.fulfill(status=200, content_type="application/json", body=b)
    if path.endswith("/rpc/tally_status"):
        return await j([dict({"book": BOOK, "company": "ZZ LEADS-LIKE BROKERS PVT LTD", "from": "2025-04-01", "openAsOn": "2025-03-31", "state": {"phase": "live"},
                              "days": len(DAYS), "entries": len(VOUCHERS), "to": iso(DAYS[-1])}, **STATUS_AT)])
    if path.endswith("/rpc/tally_days_list"):
        off = int((q.get("offset") or ["0"])[0]); return await j([{"day": d, "n": 1, "at": DAY_AT[d]} for d in DAYS][off:off + 1000])
    if "/tally-days/" in path:
        b = GZ.get(path.rsplit("/", 1)[1][:8], b""); LOG.append((time.time(), "DAYFILE", "", len(b)))
        return await r.fulfill(status=200, content_type="application/gzip", body=b)
    name = path.split("/rest/v1/")[-1] if "/rest/v1/" in path else ""
    if name == "client_book_items":
        after = int(q.get("seq", ["gt.0"])[0][3:]); key = (q.get("key") or [""])[0][3:]
        return await j([x for x in ITEMS if x["seq"] > after and (not key or x["key"] == key)][:1000])
    if name == "rpc/save_book_items":
        body = json.loads(r.request.post_data or "{}"); out = []
        for x in body.get("p_items", []):
            ITEMS.append({"key": x["k"], "item": x.get("i", ""), "ord": x.get("o"), "data": None if x.get("del") else x.get("d"), "deleted": bool(x.get("del")), "seq": len(ITEMS) + 1, "updated_at": AT, "updated_by": "u1"})
            out.append({"k": x["k"], "i": x.get("i", ""), "seq": len(ITEMS)})
        return await j({"ok": True, "items": out, "at": AT})
    if name == "members": return await j([{"user_id": "u1", "firm_id": FIRM, "name": "ZZ", "role": "owner", "active": True}])
    if name in T: return await j(proj(T[name], q))
    return await j([])
WATCH = r"""(() => {
  const busy = /Bringing in|Bringing the books|Reading the books|Looking for the books|Loading the books|Updating (the )?books|Reading payroll/i;
  window.__w = {seen: [], loads: 0};
  setInterval(() => { try {
    if (!(typeof S === 'object' && S && S.books && S.books.cid === '%s' && !S.books.loading)) return;
    const app = document.querySelector('#app'); if (!app) return;
    const t = app.innerText, m = t.match(busy), ld = app.querySelector('[data-loading]');
    // which frame, and where (CI 40898330057 saw 'a loading frame @2081' once, never here): its words and the page part it is in
    const where = (e) => { const out = []; for (let x = e; x && x !== app && out.length < 4; x = x.parentElement) { const d = [...x.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name).join(','); if (d || x.className) out.push(x.tagName.toLowerCase() + (d ? '[' + d + ']' : '') + (typeof x.className === 'string' && x.className ? '.' + x.className.split(' ')[0] : '')); } return out.join(' < '); };
    if (m || ld) window.__w.seen.push((m ? m[0] : 'a loading frame') + ' @' + Math.round(performance.now()) + (ld ? ' (' + ((ld.innerText || '').trim().slice(0, 60)) + ' | ' + where(ld) + ')' : ''));
  } catch (e) {} }, 40);
})()""" % CID
def cat(rows, since):
    rs = [x for x in rows if x[0] >= since]
    by = lambda f: [x for x in rs if f(x)]
    return {"n": len(rs), "dayfiles": len(by(lambda x: x[1] == "DAYFILE")), "challans_full": len(by(lambda x: x[2].endswith("&key=eq.challans"))),
            "payroll": len(by(lambda x: x[1] in ("tally_employees", "tally_cost_allocs"))), "save": len(by(lambda x: x[1] == "save_book_items")),
            "heads_kb": sum(x[3] for x in by(lambda x: x[1] == "tally_vouchers")) // 1024, "full_heads": len(by(lambda x: x[1] == "tally_vouchers" and "narration" in x[2] and "&guid" not in x[2])),
            "kb": sum(x[3] for x in rs) // 1024}
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(); ctx = await br.new_context(viewport={"width": 1300, "height": 900})
        await ctx.add_init_script(WATCH); pg = await ctx.new_page()
        navs = []; pg.on("framenavigated", lambda f: navs.append(f.url) if f == pg.main_frame else None)
        errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
        await ctx.route(STAGE + "/**", route)
        cdp = await ctx.new_cdp_session(pg); await cdp.send("Emulation.setCPUThrottlingRate", {"rate": 2})
        async def until(js, t=180):
            s = time.time()
            while time.time() - s < t:
                try:
                    if await pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return time.time() - s
                except Exception: pass
                await asyncio.sleep(0.03)
            return None
        async def quiet(sec=2.5, t=90):
            s = time.time()
            while time.time() - s < t:
                last = LOG[-1][0] if LOG else 0
                if time.time() - last > sec: return
                await asyncio.sleep(0.2)
        async def boot():
            await pg.goto("http://localhost:%d/" % PORT); await pg.wait_for_timeout(1200)
            if await pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): await pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); await pg.wait_for_timeout(400)
            await pg.evaluate("""([cid, firm]) => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: "u1"}); Cloud.st.firm = firm; Cloud.st.state = "ok";
              let c = S.companies[cid]; if (!c){ c = newCompany({name: "ZZ Leads-like Brokers Pvt Ltd", gstin: ""}); c.id = cid; c.tan = "DELZ01234Z"; c.pan = "AAACZ1234Z"; S.companies[c.id] = c; Store.saveCompany(c); }
              S.data[c.id] = S.data[c.id] || {parties: {}, entries: {}, loaded: true}; }""", [CID, FIRM])
        async def open_it(label, n=len(VOUCHERS)):
            await pg.evaluate("() => { if (!window.__rw){ const o = window.render; window.render = function(){ window.__w.renders++; return o.apply(this, arguments); }; window.__rw = 1; } window.__w.renders = 0; }")
            await pg.evaluate("() => { window.__w.seen = []; }")
            t0 = time.time()
            await pg.evaluate("(cid) => { S.coId = cid; S.view = 'company'; S.tab = 'books'; S.booksTab = 'tds'; S.tdsView = 'year'; S.tdsFy = '2026-27'; S.books = null; render(); }", CID)
            usable = await until("S.books && S.books.cid === '%s' && !S.books.loading && S.books.vouchers.length >= %d && document.querySelector('#app [data-tds-page]') && !document.querySelector('#app [data-loading]')" % (CID, min(n, 1)))
            ready = await until("S.books && S.books.vouchers && S.books.vouchers.length === %d && S.books.meta && S.books.meta.cloud && !S.books.busy && !(S.lkFr || {}).busy && PayLoad.ok(S.books, '%s')" % (n, BOOK))
            w = await pg.evaluate("() => ({openMs: S.books && S.books.openMs, renders: window.__w.renders})")
            print("     books open %s ms, %s draws by then" % (w["openMs"], w["renders"]))
            print("  %-46s TDS page usable %s ms; every entry in and the payroll here %s ms" % (label, int(usable * 1000) if usable is not None else "-", int(ready * 1000) if ready is not None else "-"))
            return usable, ready, t0
        # ---------- 1. a fresh browser
        print("== 1. a fresh browser (nothing kept), a Leads-shaped book: %d entries on %d days, %d items of work" % (len(VOUCHERS), len(DAYS), len(ITEMS)))
        await boot(); u1, r1, t1 = await open_it("first opening:")
        await quiet(); c1 = cat(LOG, t1)
        print("     %s" % json.dumps(c1))
        ok(r1 is not None, "the books come in on the first opening")
        # ---------- 2. the second opening, nothing changed
        print("== 2. the second opening (a reload), nothing changed in the cloud")
        navs.clear(); await pg.reload(); await boot(); n0 = len(navs)
        u2, r2, t2 = await open_it("second opening:")
        await quiet(); c2 = cat(LOG, t2); seen2 = await pg.evaluate("window.__w.seen")
        print("     %s" % json.dumps(c2))
        ok(u2 is not None and u2 * 1000 <= MAXMS, "the TDS page is usable from the copy here in %s ms (<= %d)" % (int(u2 * 1000) if u2 is not None else "-", MAXMS))
        ok(not seen2, "no \"Bringing in…/Reading the books/Loading the books\" wait at any moment (%s)" % seen2[:3])
        ok(c2["challans_full"] == 0, "the challans not fetched again for an allocation whose challan is gone: healed once, the outcome kept (%d)" % c2["challans_full"])
        ok(c2["payroll"] == 0, "the payroll not read again (%d reads)" % c2["payroll"])
        ok(c2["dayfiles"] == 0, "no day file fetched (%d)" % c2["dayfiles"])
        ok(c2["full_heads"] == 0, "the cloud copy's entries checked with a narrow read, never every entry's full head (%d full reads, %d KB)" % (c2["full_heads"], c2["heads_kb"]))
        ok(len(navs) == n0, "the page is not reloaded by itself (%s)" % navs[n0:])
        # ---------- 3. the same Day Book uploaded again: every day's time moves, the entries are the same
        print("== 3. the same Day Book uploaded again (every day's time moves, the entries the same)")
        for d in DAYS: DAY_AT[d] = "2026-10-20T07:46:51+00:00"
        STATUS_AT["daysAt"] = "2026-10-20T07:46:51Z"
        await pg.reload(); await boot(); u3, r3, t3 = await open_it("opening after the upload:")
        await quiet(); c3 = cat(LOG, t3); seen3 = await pg.evaluate("window.__w.seen")
        print("     %s" % json.dumps(c3))
        ok(u3 is not None and u3 * 1000 <= MAXMS, "usable from the copy here in %s ms (<= %d)" % (int(u3 * 1000) if u3 is not None else "-", MAXMS))
        ok(not seen3, "no wait shown while the days are checked in the background (%s)" % seen3[:3])
        kept = await pg.evaluate("(at) => Object.values(((S.books.meta || {}).cloud || {}).days || {}).every(x => x === at)", DAY_AT[DAYS[0]])
        ok(kept, "the days' new times are kept here")
        await pg.reload(); await boot(); u4, r4, t4 = await open_it("and the opening after that:")
        await quiet(); c4 = cat(LOG, t4)
        ok(c4["dayfiles"] == 0, "the next opening fetches no day (%d)" % c4["dayfiles"])
        # (the ledger map the first read of the books made here goes to the server once, on the opening after it)
        ok(c4["save"] == 0 and c4["challans_full"] == 0 and c4["payroll"] == 0 and c4["full_heads"] == 0, "and nothing is sent, healed or read again in full (%s)" % json.dumps(c4))
        # ---------- 4. a real change: one new entry on the last day
        print("== 4. one new entry in Tally (the last day)")
        nv = {"guid": "zzguid-new01", "day": DAYS[-1], "alt": 99999, "type": "Journal", "no": "9999", "party": PARTIES[3], "lines": [("ZZ Expense 01", -4321), (PARTIES[3], 4321)]}
        VOUCHERS.append(nv); T["tally_vouchers"].append(head(nv)); T["tally_lines"] += [{"guid": nv["guid"], "ledger": l, "amount": a, "hsn": None, "rate": None, "book_id": BOOK} for l, a in nv["lines"]]; build_days(); DAY_AT[DAYS[-1]] = "2026-10-20T09:00:00+00:00"
        await pg.reload(); await boot(); u5, r5, t5 = await open_it("opening with one new entry:", len(VOUCHERS))
        await quiet(); seen5 = await pg.evaluate("window.__w.seen")
        ok(u5 is not None and u5 * 1000 <= MAXMS, "usable from the copy here in %s ms (<= %d)" % (int(u5 * 1000) if u5 is not None else "-", MAXMS))
        ok(r5 is not None and await pg.evaluate("S.books.vouchers.some(v => v.id === 'zzguid-new01')"), "the new entry arrives by itself")
        ok(not seen5, "no wait shown while it comes in (%s)" % seen5[:3])
        ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
        await ctx.unroute_all(behavior="ignoreErrors"); await br.close()
asyncio.run(main())
srv.shutdown()
print("  latency per request: %d ms; CPU 2x slower" % (LAT * 1000))
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
