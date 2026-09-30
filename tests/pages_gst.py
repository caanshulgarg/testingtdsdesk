"""python3 pages_gst.py SITE OUT.json [PORT] - the GST pages of the books in tests/data (every part, the first and the last
three months), as text, into OUT.json.
Run it on two builds and compare, to see that a change (a screen moved to React, say) shows the same thing:
  python3 pages_gst.py ../site-test live.json 8170 && python3 pages_gst.py ../app/dist-test react.json 8171
  python3 -c "import json; a=json.load(open('live.json'))['pages']; b=json.load(open('react.json'))['pages']; print([k for k in a if a[k]!=b.get(k)])"
"""
import json, os, sys, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
site, out, port = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 8170
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=site); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", port), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "books-cache.json"))))
res, errors = {}, []
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    # a React development build warns about rows with the same key (they can be left on screen): counted as errors
    pg.on("console", lambda m: errors.append("same key: " + " | ".join(str(a.json_value())[:80] for a in m.args[1:3])) if "same key" in m.text else None)
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "tds"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
    def grab(name):
        pg.wait_for_timeout(250)
        t = pg.evaluate("document.getElementById('app').innerText")
        res[name] = re.sub(r"\s+", " ", t.replace("? How this tab works", "")).strip()
    pg.evaluate("() => { S.booksTab = 'gst'; render(); }"); pg.wait_for_timeout(500)
    months = pg.evaluate("GSTR.months()")
    parts = pg.evaluate("['r1','r3b','inreg','r2b','follow','adv','rev','amend','g9','g9c','vault','qtr','cmp08','gstr4']")
    for ym in months[:1] + months[-3:]:
        for part in parts:
            pg.evaluate("([ym, part]) => { S.gstYm = ym; S.gstPart = part; S.books.reco = null; render(); }", [ym, part]); grab("%s/%s/%s" % (ym, part, pg.evaluate("S.gstPart")))
    # GSTR-1 with a customer opened, then filtered to B2B
    pg.evaluate("() => { S.gstPart = 'r1'; const g = GSTR.one(S.gstYm, S.gstReg || ''); const r = g.b2b[0] || g.b2c[0]; S.r1Open = r ? (r.gstin || normName(r.party)) : ''; render(); }"); grab("r1-opened")
    pg.evaluate("() => { S.r1F = {part: 'B2B', q: ''}; render(); }"); grab("r1-b2b")
    # the input register for the whole year, one kind, and a chip
    pg.evaluate("() => { S.gstPart = 'inreg'; S.inregScope = 'year'; render(); }"); grab("inreg-year")
    pg.evaluate("() => { S.inregF = 'Reverse charge'; render(); }"); grab("inreg-rcm")
    pg.evaluate("() => { S.inregF = 'Not in 2B'; S.inregQ = 'a'; render(); }"); grab("inreg-not2b")
    pg.evaluate("() => { S.inregF = ''; S.inregQ = ''; S.inregScope = 'month'; render(); }")
    # 2B for the last two months, made from the books with faults planted, then every tab of 2B reconciliation
    made = pg.evaluate(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "make2b.js")).read())
    grab("r2b-first")
    for tab in ["suppliers", "matched", "diff", "probable", "only2b", "books"]:
        pg.evaluate("(t) => { S.r2Tab = t; render(); }", tab); grab("r2b-" + tab)
    pg.evaluate("() => { S.r2Tab = 'suppliers'; const s = GST2B.suppliers(GST2B.scope(r2Reg(S.books), r2Scope().months)); S.r2Open = s.length ? (s[0].gstin || s[0].party) : ''; render(); }"); grab("r2b-opened")
    pg.evaluate("() => { S.r2Scope = 'year'; S.r2Tab = 'books'; S.r2F = {books: {flag: 'big'}}; render(); }"); grab("r2b-year-big")
    pg.evaluate("() => { S.r2Scope = 'all'; S.r2Tab = 'only2b'; S.r2F = {}; render(); }"); grab("r2b-all-only2b")
    # amendments: the busiest sales month kept as filed, with one invoice changed and one left out; then the next month
    pg.evaluate(r"""() => {
      const reg = S.gstReg || '', ms = GSTR.months(), n = m => GSTR.one(m, reg).b2b.length, m1 = ms.slice().sort((a, c) => n(c) - n(a))[0];
      const j = JSON.parse(JSON.stringify(GSTR.toJson(m1, reg)));
      if (j.b2b && j.b2b[0]){ const inv = j.b2b[0].inv[0]; inv.itms[0].itm_det.txval = r2(num(inv.itms[0].itm_det.txval) + 100); if (j.b2b[1]) j.b2b[1].inv.pop(); }
      GSTAmend.keep(j, 'portal', {at: '2026-01-01T00:00:00Z'}); S.gstYm = ms[ms.indexOf(m1) + 1] || m1; S.gstPart = 'amend'; render(); }"""); grab("amend-filed")
    pg.evaluate("() => { const id = GSTAmend.pending(S.gstYm, S.gstReg || '').rows[0]; if (id) S.books.amendFix = {[id.id]: 'skip'}; render(); }"); grab("amend-skip")
    # reversal with a capital good and the 5% rule; advances in the busiest month for receipts
    pg.evaluate("() => { S.books.assets = [{id: 'as1', name: 'LED wall', date: '2025-05-10', igst: 180000, cgst: 0, sgst: 0, cess: 0, use: 'common', reg: S.gstReg || '', sold: ''}]; S.gstPart = 'rev'; render(); }"); grab("rev-asset")
    pg.evaluate("() => { const ms = GSTR.months(), n = m => GSTAdv.ready() ? GSTAdv.month(m, S.gstReg || '').at.length + GSTAdv.month(m, S.gstReg || '').open.length : 0; S.gstYm = ms.slice().sort((a, c) => n(c) - n(a))[0]; S.gstPart = 'adv'; render(); }"); grab("adv-busiest")
    # GSTR-9 and 9C with figures typed, and the text of both PDFs
    pg.evaluate("() => { const ms = GSTR.months(); S.gstYm = ms[0]; const w = {fy: GST9.fyOf(S.gstYm), reg: S.gstReg || ''}; const t = GST9.typed(w.fy, S.gstReg || ''); t['15E'] = {igst: 5000}; const c = GST9C.st(w.fy, w.reg); c.adj['5B'] = 100000; c.reasons['6'] = 'Unbilled revenue of March'; c.turnover = 1234567; S.gstPart = 'g9'; render(); }")
    grab("g9-typed")
    pg.evaluate("() => { S.gstPart = 'g9c'; render(); }"); grab("g9c-typed")
    for w in ["9", "9C"]:
        t = pg.evaluate("(w) => { const d = document.createElement('div'); d.innerHTML = gst9PackHtml(w); document.body.appendChild(d); const t = d.innerText; d.remove(); return t; }", w)
        res["pdf-" + w] = re.sub(r"\s+", " ", t).strip()
    # ITC follow-up with the 2B made above: everything, one kind, a decision and a note, and a letter logged
    pg.evaluate("() => { S.gstYm = GSTR.months().filter(m => GST2B.all2b(S.gstReg || '').some(t => t.ym === m)).slice(-1)[0]; S.gstPart = 'follow'; S.itctShow = 'open'; render(); }"); grab("follow-open")
    pg.evaluate("() => { S.itctShow = 'all'; render(); }"); grab("follow-all")
    pg.evaluate("() => { const it = ITCT.items(S.gstReg || '').items.find(x => ITCT.CATS[x.cat].acts.length); if (it){ S.itctCat = it.cat; const st = ITCT.store(S.gstReg || ''); st.dec[it.key] = {act: ITCT.CATS[it.cat].acts.slice(-1)[0][0], note: 'asked on phone', at: '20260101'}; } render(); }"); grab("follow-decided")
    pg.evaluate("() => { S.itctCat = ''; const sp = ITCT.suppliers(S.gstReg || '', ITCT.items(S.gstReg || '').items)[0]; if (sp){ const st = ITCT.store(S.gstReg || ''); st.sent[sp.key] = ['20260105', '20260110']; } render(); }"); grab("follow-sent")
    # a quarterly (QRMP) GSTIN: a first month (IFF, PMT-06), its 3B card, and a quarter end; then composition
    busy = "(() => { const ms = GSTR.months(), n = m => GSTR.one(m, S.gstReg || '').b2b.length; return ms.slice().sort((a, c) => n(c) - n(a))[0]; })()"
    pg.evaluate("(busy) => { S.books.gstSet = S.books.gstSet || {}; const st = GSTSet.store(S.gstReg || ''); st.filing = [{type: 'qrmp', from: GSTR.months()[0]}]; S.gstYm = GSTSet.qStart(eval(busy)); S.gstPart = 'qtr'; render(); }", busy); grab("qrmp-first")
    pg.evaluate("() => { const r = GSTF.rec(S.gstYm, S.gstReg || ''); r.iff = '2026-01-10'; r.pmt06 = {igst: 1000}; r.pmtMethod = 'self'; render(); }"); grab("qrmp-first-filled")
    pg.evaluate("() => { S.gstPart = 'r3b'; render(); }"); grab("qrmp-first-3b")
    pg.evaluate("() => { S.gstYm = GSTSet.qEnd(S.gstYm); S.gstPart = 'qtr'; render(); }"); grab("qrmp-qend")
    pg.evaluate("() => { GSTSet.store(S.gstReg || '').filing = [{type: 'comp', from: GSTR.months()[0]}]; S.gstPart = 'cmp08'; render(); }"); grab("comp-cmp08")
    pg.evaluate("() => { S.books.gstEst = true; GSTF.rec(GSTSet.qEnd(S.gstYm), S.gstReg || '').cmp08 = '2026-02-28'; render(); }"); grab("comp-cmp08-late")
    pg.evaluate("() => { S.gstPart = 'gstr4'; render(); }"); grab("comp-gstr4")
    # monthly again, the filing card with FinCom's estimate on and figures from the portal
    pg.evaluate("() => { GSTSet.store(S.gstReg || '').filing = []; S.gstPart = 'r3b'; const r = GSTF.rec(S.gstYm, S.gstReg || ''); r.r1 = '2026-02-15'; r.portalFee1 = 500; r.portalInt = 123; render(); }"); grab("filing-est")
    pg.evaluate("() => { S.books.gstEst = false; render(); }")
    # customers' IMS rejections on GSTR-1: a number looked for, a credit note and an invoice marked, then 3B
    pg.evaluate("() => { const reg = S.gstReg || '', docs = CustIMS.find(reg, '') ; S.gstPart = 'r1'; const all = GSTR.months().flatMap(m => GSTR.one(m, reg).cdnr.concat(GSTR.one(m, reg).b2b)); const cn = all.find(r => r.kind === 'CDNR') || all[0]; S.custImsQ = String((cn && cn.no) || '1'); render(); }"); grab("custims-find")
    pg.evaluate("() => { const reg = S.gstReg || '', hits = CustIMS.find(reg, S.custImsQ); hits.slice(0, 1).forEach(r => CustIMS.add(reg, r.id)); const inv = GSTR.months().flatMap(m => GSTR.one(m, reg).b2b)[0]; if (inv){ const h = CustIMS.find(reg, inv.no)[0]; if (h) CustIMS.add(reg, h.id); } S.custImsQ = ''; GSTR._carry = null; render(); }"); grab("custims-marked")
    pg.evaluate("() => { const x = CustIMS.items(S.gstReg || '')[0]; if (x){ S.gstYm = x.addYm || x.rejYm; } S.gstPart = 'r3b'; render(); }"); grab("custims-3b")
    # GST settings in Client setup: as it stands after all the above, then the contacts searched
    pg.evaluate("() => { S.tab = 'gstset'; render(); }"); grab("gstset")
    pg.evaluate("() => { S.gcontQ = 'a'; render(); }"); grab("gstset-contacts")
    pg.evaluate("() => { S.gcontQ = ''; S.tab = 'books'; render(); }")
    br.close()
srv.shutdown()
json.dump({"pages": res, "errors": errors}, open(out, "w"), indent=0)
print(len(res), "pages;", len(errors), "errors")
