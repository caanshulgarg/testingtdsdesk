"""python3 run_server_reports.py - reports worked out by the database (migration-14, branch fast-sync): MIS, and the TDS
and GST summaries, answered from the cloud copy's ready totals instead of every entry in the browser.
A throwaway PostgreSQL here (pg_stand.py) gets migration-14 as written for staging and:
  - Testing AAD's books from the staging copy (tests/data/books-cache.json, local only; that part is skipped without it):
    tally_mis for FY 2025-26 must give profit before tax 1,13,14,193.29 as Tally, and every head, every month and the
    sales by customer exactly as FinCom's MIS in the browser works them out from the same books;
  - made-up books for the TDS and GST summaries, whose figures are known;
  - another firm's member gets nothing; and how long each answer takes.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_server_reports.py"""
import os, sys, json, time, uuid, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import pg_stand
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
q = lambda s: "'" + str(s).replace("'", "''") + "'"
FIRM, OTHER = str(uuid.uuid4()), str(uuid.uuid4()); ME, STRANGER = str(uuid.uuid4()), str(uuid.uuid4())
db = pg_stand.start(55433)
try:
    db.sql(pg_stand.migration_body(os.path.join(HERE, "..", "server", "tally-cloud", "migration-14-reports.sql")))
    db.sql("insert into firms values (%s, 'ZZ FIRM'), (%s, 'ZZ OTHER'); insert into members values (%s, %s, 'Me', 'owner', true), (%s, %s, 'Stranger', 'owner', true);" % (q(FIRM), q(OTHER), q(ME), q(FIRM), q(STRANGER), q(OTHER)))
    def load(book, client, books, frm, open_as_on):
        under, groups = books.get("under") or {}, books.get("groups") or {}
        def chain(p):
            out = []
            while p and p not in out and len(out) < 30: out.append(p); p = groups.get(p, "")
            return out
        led = dict((books.get("tb") or {}).get("led") or {})
        names = set(led) | set(e["l"] for v in books["vouchers"] for e in v["ent"])
        sql = ["insert into tally_books (book_id, firm_id, client_id, company, from_date, open_as_on) values (%s, %s, %s, 'ZZ CO', %s, %s);" % (q(book), q(FIRM), q(client), q(frm), q(open_as_on))]
        rows = []
        for n in sorted(names):
            x = led.get(n) or {}; p = x.get("parent") or under.get(n, ""); c = chain(p)
            rows.append("(%s, %s, %s, %s, %s, %s, %s)" % (q(book), q(FIRM), q(n), q(p), x.get("open") or 0, "array[%s]::text[]" % ",".join(q(g) for g in c) if c else "'{}'::text[]", q(c[-1] if c else "")))
        for i in range(0, len(rows), 500): sql.append("insert into tally_ledgers (book_id, firm_id, name, parent, open, chain, primary_group) values " + ",".join(rows[i:i + 500]) + ";")
        vrows, lrows, day = [], [], {}
        for v in books["vouchers"]:
            d = v["date"]; iso = d[:4] + "-" + d[4:6] + "-" + d[6:]
            vrows.append("(%s, %s, %s, %s, %s, %s, %s, %s, %s)" % (q(book), q(FIRM), q(v["id"]), q(iso), q(v["type"]), q(v["no"]), q(v.get("party") or ""), "true" if v.get("cancel") else "false", "true" if v.get("opt") else "false"))
            for e in v["ent"]:
                lrows.append("(%s, %s, %s, %s, %s, %s)" % (q(book), q(FIRM), q(v["id"]), q(iso), q(e["l"]), e["a"]))
                if not v.get("cancel") and not v.get("opt"):
                    k = (e["l"], iso); x = day.setdefault(k, [0.0, 0.0, 0.0, 0]); x[0] += e["a"]; x[1] += -e["a"] if e["a"] < 0 else 0; x[2] += e["a"] if e["a"] > 0 else 0; x[3] += 1
        for i in range(0, len(vrows), 500): sql.append("insert into tally_vouchers (book_id, firm_id, guid, day, vtype, vno, party, cancelled, optional) values " + ",".join(vrows[i:i + 500]) + ";")
        for i in range(0, len(lrows), 1000): sql.append("insert into tally_lines (book_id, firm_id, guid, day, ledger, amount) values " + ",".join(lrows[i:i + 1000]) + ";")
        drows = ["(%s, %s, %s, %s, %.2f, %.2f, %.2f, %d)" % (q(book), q(FIRM), q(l), q(d), a, dr, cr, n) for (l, d), (a, dr, cr, n) in day.items()]
        for i in range(0, len(drows), 1000): sql.append("insert into tally_ledger_day (book_id, firm_id, ledger, day, amount, dr, cr, n) values " + ",".join(drows[i:i + 1000]) + ";")
        db.sql("\n".join(sql))
    # ---------- made-up books: TDS and GST summaries with known figures
    V = lambda i, d, typ, party, ent, opt=False: {"id": "zz-%d" % i, "date": d, "type": typ, "no": str(i), "party": party, "cancel": False, "opt": opt, "ent": [{"l": l, "a": a} for l, a in ent]}
    ZZ = {"groups": {"Sales Accounts": "", "Indirect Expenses": "", "Duties & Taxes": "Current Liabilities", "Current Liabilities": "", "Sundry Creditors": "Current Liabilities", "Sundry Debtors": "Current Assets", "Current Assets": "", "Bank Accounts": "Current Assets"},
          "under": {"ZZ Fees": "Sales Accounts", "ZZ Rent": "Indirect Expenses", "TDS on Rent": "Duties & Taxes", "Output CGST": "Duties & Taxes", "Output SGST": "Duties & Taxes", "Input IGST": "Duties & Taxes",
                    "ZZ Landlord": "Sundry Creditors", "ZZ Alpha": "Sundry Debtors", "ZZ Bank": "Bank Accounts"},
          "tb": {"led": {"TDS on Rent": {"open": 5000, "parent": "Duties & Taxes"}, "ZZ Bank": {"open": -100000, "parent": "Bank Accounts"}}},
          "vouchers": [
              V(1, "20250405", "Sales", "ZZ Alpha", [("ZZ Alpha", -11800), ("ZZ Fees", 10000), ("Output CGST", 900), ("Output SGST", 900)]),
              V(2, "20250410", "Journal", "ZZ Landlord", [("ZZ Rent", -50000), ("Input IGST", -9000), ("TDS on Rent", 5000), ("ZZ Landlord", 54000)]),
              V(3, "20250507", "Payment", "ZZ Bank", [("TDS on Rent", -5000), ("ZZ Bank", 5000)]),
              V(4, "20250512", "Journal", "ZZ Landlord", [("ZZ Rent", -50000), ("TDS on Rent", 5000), ("ZZ Landlord", 45000)]),
              V(5, "20250520", "Journal", "ZZ Landlord", [("ZZ Rent", -9999), ("TDS on Rent", 999), ("ZZ Landlord", 9000)], opt=True)]}       # Optional: not counted
    load("00000000-0000-0000-0000-0000000000a1", "zzclient", ZZ, "2025-04-01", "2025-03-31")
    MAP = {"TDS on Rent": {"kind": "tds_payable", "what": "tds_payable"}, "Output CGST": {"kind": "gst", "side": "output", "tax": "CGST", "what": "gst"},
           "Output SGST": {"kind": "gst", "side": "output", "tax": "SGST", "what": "gst"}, "Input IGST": {"kind": "gst", "side": "input", "tax": "IGST", "what": "gst"}, "ZZ Rent": {"kind": "", "what": "none"}}
    db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values " + ",".join("(%s, 'zzclient', 'map', %s, %s::jsonb)" % (q(FIRM), q("." + n), q(json.dumps(d))) for n, d in MAP.items()) + ";")
    t = json.loads(db.one("select tally_tds_summary('zzclient', '2025-04-01', '2025-06-30')", ME))
    L = (t.get("ledgers") or [{}])[0]
    ok(L.get("l") == "TDS on Rent" and L.get("open") == -5000 and L.get("deducted") == 10000 and L.get("paid") == 5000 and L.get("close") == -10000,
       "TDS: TDS on Rent opening 5,000 owed, 10,000 deducted (the Optional 999 left out), 5,000 paid, 10,000 owed at the end (%s)" % {k: L.get(k) for k in ("open", "deducted", "paid", "close")})
    ok(L.get("m", {}).get("202504") == {"cr": 5000, "dr": 0} and L.get("m", {}).get("202505") == {"cr": 5000, "dr": 5000}, "TDS: month by month (%s)" % L.get("m"))
    g = json.loads(db.one("select tally_gst_summary('zzclient', '2025-04-01', '2025-05-31')", ME))
    apr = [m for m in g["months"] if m["ym"] == "202504"][0]
    ok(apr["out"] == {"CGST": 900, "SGST": 900, "IGST": 0, "CESS": 0} and apr["in"]["IGST"] == 9000 and apr["taxableSales"] == 10000,
       "GST: April output CGST 900 + SGST 900, input IGST 9,000, taxable sales 10,000 (%s)" % apr)
    ok(json.loads(db.one("select tally_tds_summary('zzclient', '2025-04-01', '2025-06-30')", STRANGER)).get("none") is True and
       json.loads(db.one("select tally_mis('zzclient', '2025-04-01', '2025-06-30')", STRANGER)).get("none") is True, "another firm's member gets nothing of this client")
    m0 = json.loads(db.one("select tally_mis('zzclient', '2025-04-01', '2025-06-30')", ME))
    ok(m0["pbt"]["t"] == 10000 - 100000 and m0["sales"]["total"] == 10000 and m0["pay"]["owe"] == 99000 and m0["recv"]["owed"] == 11800 and m0["cash"]["total"] == 95000,
       "MIS on made-up books: profit -90,000, sales 10,000, suppliers owed 99,000, customers owe 11,800, bank 95,000 (%s, %s, %s, %s, %s)" % (m0["pbt"]["t"], m0["sales"]["total"], m0["pay"]["owe"], m0["recv"]["owed"], m0["cash"]["total"]))
    # ---------- Testing AAD, from the staging copy: the database's MIS against the browser's
    cache = os.environ.get("TDSDESK_CACHE", os.path.join(HERE, "data", "books-cache.json"))
    if not os.path.exists(cache): print("    skipped: Testing AAD's books (tests/data/books-cache.json is local only)")
    else:
        books = json.load(open(cache))
        t0 = time.time(); load("00000000-0000-0000-0000-0000000000b1", "cmufksrrqjub2g", books, "2025-04-01", "2025-03-31"); print("    Testing AAD loaded in %.1f s" % (time.time() - t0))
        db.sql("analyze;")
        t0 = time.time(); m = json.loads(db.one("select tally_mis('cmufksrrqjub2g', '2025-04-01', '2026-03-31')", ME)); took = time.time() - t0
        ok(m["pbt"]["t"] == 11314193.29, "Testing AAD, FY 2025-26: profit before tax 1,13,14,193.29 from the database (%s)" % m["pbt"]["t"])
        ok(m["sales"]["total"] == 18291456.2 and m["sales"]["other"] == 0, "sales 1,82,91,456.20, no other income (%s, %s)" % (m["sales"]["total"], m["sales"]["other"]))
        t0 = time.time(); [db.one("select tally_mis('cmufksrrqjub2g', '2025-04-01', '2026-03-31')", ME) for _ in range(5)]; each = (time.time() - t0) / 5
        print("    tally_mis for the year: %.0f ms here (with psql's own start each time: %.0f ms)" % (took * 1000, each * 1000))
        # the browser's own MIS on the same books
        from playwright.sync_api import sync_playwright
        SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
        H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
        srv = http.server.ThreadingHTTPServer(("localhost", 8170), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
        with sync_playwright() as p:
            br = p.chromium.launch(); pg = br.new_page(); pg.goto("http://localhost:8170/index.html"); pg.wait_for_function("typeof MIS === 'object'", timeout=60000)
            b = pg.evaluate("""(bk) => { S.books = Object.assign({map: {}}, bk); TallyRead.balances(S.books, {ledgers: Object.entries(bk.tb.led).map(([name, x]) => ({name, parent: x.parent, open: String(x.open), close: ""}))}, "20250401", "20260331");
              S.books.map = Books.mapLedgers(bk.vouchers, {}); const pl = MIS.pl('20250401', '20260331'), s = MIS.sales('20250401', '20260331');
              return {pbt: pl.pbt, gross: pl.gross, heads: Object.fromEntries(Object.entries(pl.heads).map(([k, h]) => [k, {t: h.t, m: h.m}])), sales: s.total, rows: s.rows.map(r => [r.party, r.t])}; }""", books)
            # GST: the database's output tax against the browser's GSTR-1, month by month, with the same ledger settings
            gb = pg.evaluate("""(bk) => { const c = newCompany({name: "Z", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.books = Object.assign({map: {}, cid: c.id}, bk);
              S.books.map = Books.mapLedgers(bk.vouchers, {}); const out = {};
              // GSTR-1 lists a credit note's tax as a positive figure in its own table; the tax for the month nets it off
              GSTR.months().forEach(ym => { out[ym] = r2(GSTR.outward(ym, '').reduce((t, x) => t + (/^CDN/.test(x.kind) ? -1 : 1) * ((x.cgst || 0) + (x.sgst || 0) + (x.igst || 0)), 0)); });
              return {map: S.books.map, out}; }""", books)
            items = [(n, m) for n, m in gb["map"].items() if m.get("kind")]
            db.sql("insert into client_book_items (firm_id, client_id, key, item, data) values " + ",".join("(%s, 'cmufksrrqjub2g', 'map', %s, %s::jsonb)" % (q(FIRM), q("." + n), q(json.dumps(m))) for n, m in items) + ";")
            g2 = json.loads(db.one("select tally_gst_summary('cmufksrrqjub2g', '2025-04-01', '2026-03-31')", ME))
            sv = {x["ym"]: round(x["out"]["CGST"] + x["out"]["SGST"] + x["out"]["IGST"], 2) for x in g2["months"]}
            diff = {k: (v, sv.get(k)) for k, v in gb["out"].items() if abs(v - sv.get(k, 0)) >= 0.01}
            ok(not diff, "GST: the database's output tax is the browser's GSTR-1 tax in every month (year %s)%s" % (round(sum(gb["out"].values()), 2), "" if not diff else ": " + str(diff)[:300]))
            # a fresh browser opening Testing AAD: the day files come slowly (a slow line), MIS comes from the database
            import re, gzip, time as _t
            from urllib.parse import urlparse, parse_qs
            STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"; asked = []
            def route(rt):
                u = urlparse(rt.request.url); path = u.path; j = lambda o: rt.fulfill(status=200, content_type="application/json", body=json.dumps(o))
                if path.endswith("/rpc/tally_status"): return j([{"book": "bk1", "company": "GARG SHEKHAR & COMPANY", "from": "2025-04-01", "openAsOn": "2025-03-31", "ledgersAt": "2026-10-01T06:00:00Z", "daysAt": "2026-10-01T07:00:00Z", "days": 304, "entries": len(books["vouchers"]), "to": "2026-03-31"}])
                if path.endswith("/rpc/tally_days_list"): return j([{"day": "202504%02d" % d, "n": 1, "at": "2026-10-01T07:00:00Z"} for d in range(1, 31)])
                if "/tally-days/" in path: _t.sleep(1.5); return rt.fulfill(status=200, content_type="application/gzip", body=gzip.compress(b"<ENVELOPE></ENVELOPE>"))
                if path.endswith("/rpc/tally_mis") or path.endswith("/rpc/tally_tds_summary") or path.endswith("/rpc/tally_gst_summary"):
                    a2 = json.loads(rt.request.post_data); fn = path.rsplit("/", 1)[1]; asked.append(fn)
                    return j(json.loads(db.one("select %s(%s, %s, %s)" % (fn, q(a2["p_client"]), q(a2["p_from"]), q(a2["p_to"])), ME)))
                return j([])
            ctx = br2 = p.chromium.launch(); pg = br2.new_page(viewport={"width": 1400, "height": 1000}); pg.route(STAGE + "/**", route)
            pg.goto("http://localhost:8170/"); pg.wait_for_timeout(2000); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(600)
            pg.evaluate("""() => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: "u1"}); Cloud.st.firm = "f1"; Cloud.st.state = "ok";
              const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.id = "cmufksrrqjub2g"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true};
              S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "mis"; S.books = null; render(); }""")
            t0 = _t.time(); seen = None
            while _t.time() - t0 < 10:
                if "1,13,14,193.29" in pg.inner_text("#app"): seen = _t.time() - t0; break
                _t.sleep(0.1)
            loaded = pg.evaluate("(S.books.vouchers || []).length")
            ok(seen is not None and seen < 3, "a fresh browser: MIS shows profit 1,13,14,193.29 from the server in %.1f s of opening the client" % (seen or 99))
            ok(loaded == 0 and "tally_mis" in asked, "while the entries are still coming in (%d here so far): the browser asked the server, not every entry" % loaded)
            ok(pg.locator("#srvPl").count() == 1 and "Revenue from operations" in pg.inner_text("#srvPl") and "Worked out by the server" in pg.inner_text("#app"), "the profit and loss by month, and where it comes from, said")
            pg.evaluate("() => { S.booksTab = 'tds'; render(); }"); pg.wait_for_timeout(1500)
            ok("tally_tds_summary" in asked and pg.locator("[data-srv-tds]").count() == 1, "the TDS tab: the summary from the server too")
            pg.evaluate("() => { S.booksTab = 'gst'; render(); }"); pg.wait_for_timeout(1500)
            ok("tally_gst_summary" in asked and pg.locator("[data-srv-gst]").count() == 1, "the GST tab: the summary from the server too")
            br2.close()
            br.close()
        srv.shutdown()
        ok(b["pbt"]["t"] == m["pbt"]["t"], "the browser's MIS on the same books: the same profit (%s)" % b["pbt"]["t"])
        bm = {k: v for k, v in b["pbt"]["m"].items()}; dm = {k: v for k, v in m["pbt"]["m"].items()}
        ok(all(abs(bm[k] - dm.get(k, 0)) < 0.005 for k in bm), "and the same profit in every month (%d months)" % len(bm))
        hd = all(abs(b["heads"][k]["t"] - m["heads"].get(k, {}).get("t", 0)) < 0.005 and all(abs(v - m["heads"][k]["m"].get(mm, 0)) < 0.005 for mm, v in b["heads"][k]["m"].items()) for k in b["heads"])
        ok(hd and set(b["heads"]) == set(m["heads"]), "and every head (%s), month by month" % ", ".join("%s %s" % (k, b["heads"][k]["t"]) for k in sorted(b["heads"])))
        top = {r[0]: r[1] for r in b["rows"]}; dtop = {r["party"]: r["t"] for r in m["sales"]["rows"]}
        ok(all(abs(top.get(k, 0) - v) < 0.005 for k, v in dtop.items()) and len(dtop) == min(20, len(top)), "sales by customer: the top %d customers the same" % len(dtop))
finally:
    db.stop()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
