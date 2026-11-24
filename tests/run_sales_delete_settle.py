"""python3 run_sales_delete_settle.py - Sales: the page stays still after a bulk delete (the owner, 24-Nov-2026: "When I
deleted the Zoho sheet details, the window was shaking").
The cause: every invoice deleted is a removal sent to FinCom's cloud, and Realtime hands each removal back to the
browser that made it, one row at a time. Each one reloaded the Sales list from scratch (loadSales): the page went to its
loading skeleton and back, the bar at the foot vanished and came back, the scroll jumped, Undo was lost; 22 invoices
deleted, 22 times in a row.
Here (offline, a made-up client and 22 made-up invoices of a Zoho-style sheet): the invoices are ticked and deleted
from the bar, then the 22 removals come back as Realtime sends them (Live.rec, 40 ms apart). Every frame for 4 s is
measured: the page never shows its loading skeleton, the bar never goes, Undo stays; from 500 ms after the last removal
nothing moves (the page's height, its scroll, the bar's height, the number of elements) and nothing is drawn again.
A colleague's removal of an invoice still on the page takes it off, quietly (no skeleton, the ticks and Undo kept).
The review of a85572b8b: Undo clicked while the removals are still coming back puts all of them back; a colleague's
change to an invoice this computer's Undo covers takes Undo away; a removal arriving while Sales is opening stays
removed; a reload keeps work under way (an invoice posted, one mid-upload).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_sales_delete_settle.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("SETTLE_PORT") or 8167)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", "out"); os.makedirs(OUT, exist_ok=True); fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LEDGERS = ["Asha Textiles Pvt Ltd", "Chitra Foods (Lucknow)", "Dev Packaging", "Sales @ 18%", "Output CGST", "Output SGST", "Output IGST", "Round Off"]
# 22 invoices as a Zoho Books sheet gives them (made up): three customers, 2-3 item lines each
ADD = """() => { const s = SL(), cust = [["Asha Textiles Pvt Ltd", "09"], ["Chitra Foods (Lucknow)", "09"], ["Dev Packaging", "07"]];
  for (let i = 0; i < 22; i++){ const [c, st] = cust[i % 3], t = 1000 * (2 + i % 5), inter = st !== "09";
    const items = [1, 2, 3].slice(0, i < 15 ? 3 : 2).map(k => ({desc: "Widget " + k, hsn: "8471", qty: k, unit: "pcs", rate: r2(t / 6), disc: 0, taxable: r2(t / 6 * k), gstRate: 18}));
    const v = newInvoice({number: "INV-" + String(101 + i).padStart(6, "0"), date: "2026-10-" + String(1 + i).padStart(2, "0"), customerName: c, customerGstin: "", pos: st,
      taxable: t, cgst: inter ? 0 : r2(t * .09), sgst: inter ? 0 : r2(t * .09), igst: inter ? r2(t * .18) : 0, cess: 0, total: r2(t * 1.18), items}, "upload");
    v.fileName = "zoho_sales_madeup.xlsx"; v.customerLedger = c; s.list.push(v); mapInvoice(v); v.status = "ready"; }
  s.filter = "ready"; saveSales(); render(); }"""
# every frame: the page's height, its scroll, the bar's height (-1: no bar), the elements on the page, the skeleton
# (a drawing: a batch of changes to the page's elements, seen by a MutationObserver)
WATCH = """() => { if (window.__mo) window.__mo.disconnect(); const w = window.__w = {f: [], renders: 0, t0: performance.now()};
  (window.__mo = new MutationObserver(() => { w.renders++; w.lastRender = performance.now() - w.t0; })).observe(document.getElementById('app'), {subtree: true, childList: true, attributes: true, characterData: true});
  const se = document.scrollingElement;
  const tick = () => { const bar = document.querySelector('#app .actionbar');
    w.f.push([Math.round(performance.now() - w.t0), se.scrollHeight, Math.round(se.scrollTop), bar ? Math.round(bar.getBoundingClientRect().height) : -1,
      document.getElementsByTagName('*').length, document.querySelectorAll('#app [data-loading]').length, document.querySelectorAll('#app .bk-snack').length]);
    if (performance.now() - w.t0 < 4000) requestAnimationFrame(tick); };
  requestAnimationFrame(tick); }"""
# Realtime handing this browser's own removals back, one row at a time (src/js/54 Live.rec), 40 ms apart from 200 ms
ECHO = """(ids) => { const cid = SL().cid; window.__echoDone = 0;
  ids.forEach((id, i) => setTimeout(() => Live.rec("records", {kind: "sales", id: cid + ":" + id, client_id: cid, data: null, deleted: true, updated_at: new Date().toISOString()})
    .then(() => { window.__echoDone++; window.__echoAt = performance.now() - window.__w.t0; }), 200 + 40 * i)); }"""
with sync_playwright() as p:
    # TDSDESK_VIDEO=<folder>: a recording of the run (to see the page move, or stay still)
    br = p.chromium.launch(); vid = os.environ.get("TDSDESK_VIDEO")
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, **({"record_video_dir": vid, "record_video_size": {"width": 1440, "height": 900}} if vid else {}))
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500)
    E("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); W(800)
    E("""(leds) => { const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.bank.ledgers = {list: leds.map(n => ({name: n, group: /Sales/.test(n) ? "Sales Accounts" : /Output|Round/.test(n) ? "Duties & Taxes" : "Sundry Debtors"})), importedAt: new Date().toISOString(), live: true}; S.tab = "sales"; S.step = null; return loadSales(c.id); }); }""", LEDGERS)
    W(800); E(ADD); W(900)
    rows = lambda: pg.locator("#app table.bk-table tbody tr")
    ok(rows().count() == 22, "22 invoices of the sheet, Ready to post (%d)" % rows().count())

    print("1. 18 of the 22 ticked and deleted from the bar; the removals come back from the cloud one by one")
    E("() => { const s = SL(); s.sel.clear(); salesVisible().slice(0, 18).forEach(v => s.sel.add(v.id)); salesLightRefresh(); }"); W(400)
    gone = E("[...SL().sel]")
    E("() => scrollTo(0, 1e6)"); W(400)
    pg.screenshot(path=OUT + "/sales-delete-settle-before.png")
    E(WATCH); pg.click('#app .actionbar button:has-text("Delete")'); E(ECHO, gone)
    W(4300)
    w = E("window.__w"); f = w["f"]; echo_at = E("window.__echoAt") or 0
    ok(E("window.__echoDone") == 18 and E("SL().list.length") == 4, "18 deleted, their 18 removals taken in, 4 invoices left (%s, %s)" % (E("window.__echoDone"), E("SL().list.length")))
    sk = [r for r in f if r[5]]
    ok(not sk, "the page never shows its loading skeleton (%d frames did)" % len(sk))
    nobar = [r for r in f if r[0] > 150 and r[3] < 0]
    ok(not nobar, "the bar at the foot never goes (%d frames without it)" % len(nobar))
    nosnack = [r for r in f if r[0] > 150 and not r[6]]
    ok(not nosnack and "18 invoices deleted" in pg.inner_text("#app .actionbar"), "Undo stays in the bar (%d frames without it)" % len(nosnack))
    late = [r for r in f if r[0] > echo_at + 500]
    moved = [(a, b) for a, b in zip(late, late[1:]) if a[1:5] != b[1:5]]
    ok(len(late) > 30 and not moved, "from 500 ms after the last removal nothing moves: height, scroll, bar, elements (%d frames, %d changes%s)" % (len(late), len(moved), ": " + str(moved[:2]) if moved else ""))
    ch = sum(1 for a, b in zip(f, f[1:]) if a[1:4] != b[1:4])
    ok(ch <= 3, "the delete moves the page once, not again with every removal (%d changes of height, scroll or bar)" % ch)
    ok((w.get("lastRender") or 0) < echo_at + 500, "no drawing loop: %d drawings, the last at %d ms (the last removal at %d ms)" % (w["renders"], w.get("lastRender") or 0, echo_at))
    pg.screenshot(path=OUT + "/sales-delete-settle-after.png")

    print("2. Undo after the removals came back: the 18 are back")
    u = pg.locator('#app .actionbar .bk-snack button:has-text("Undo")')
    if u.count(): u.first.click(); W(500)
    ok(E("SL().list.length") == 22, "Undo puts the 18 back (%d)" % E("SL().list.length"))

    print("3. a colleague's removal of an invoice still on the page: taken off quietly, the ticks kept")
    E("() => { const s = SL(); s.sel.clear(); salesVisible().slice(0, 2).forEach(v => s.sel.add(v.id)); salesLightRefresh(); }"); W(300)
    keep, other = E("(() => { const v = salesVisible(); return [v[0].id, v[v.length - 1].id]; })()")
    E(WATCH)
    E("""(id) => { const cid = SL().cid; return Live.rec("records", {kind: "sales", id: cid + ":" + id, client_id: cid, data: null, deleted: true, updated_at: new Date().toISOString()}); }""", other)
    W(1200)
    f = E("window.__w.f")
    ok(E("SL().list.length") == 21 and not E("SL().list.some(v => v.id === '%s')" % other), "the colleague's removal comes in: 21 invoices (%d)" % E("SL().list.length"))
    ok(not [r for r in f if r[5]], "no loading skeleton for it")
    ok(E("SL().sel.has('%s') && SL().sel.size === 2" % keep) and E("SL().filter") == "ready", "the ticks and the tab are kept")
    # a row from a colleague, as Realtime hands it over (updated_by someone else)
    THEIRS = """([id, data]) => { const cid = SL().cid; return Live.rec("records", {kind: "sales", id: cid + ":" + id, client_id: cid, data: data, deleted: !data, updated_by: "u-colleague", updated_at: new Date().toISOString()}); }"""
    def fresh22():
        E("() => { const s = SL(); s.list.splice(0); s.undo = null; s.sel.clear(); s.sticky.clear(); s.filter = 'ready'; saveSales(); }"); E(ADD); W(900)

    print("4. Undo clicked while the 18 removals are still coming back: all 22 back, and sent again as they are")
    fresh22()
    E("() => { const s = SL(); s.sel.clear(); salesVisible().slice(0, 18).forEach(v => s.sel.add(v.id)); salesLightRefresh(); }"); W(400)
    gone = E("[...SL().sel]")
    E(WATCH); pg.click('#app .actionbar button:has-text("Delete")'); E(ECHO, gone)
    W(420); n0 = E("window.__echoDone")
    pg.locator('#app .actionbar .bk-snack button:has-text("Undo")').first.click()
    W(1600)
    ok(E("window.__echoDone") == 18 and E("SL().list.length") == 22, "Undo after %d of the 18 removals came back: %d invoices once all are in (want 22)" % (n0, E("SL().list.length")))
    sent = E("(ids) => { const cid = SL().cid, ch = cloudChanges().changes; return ids.filter(id => ch.some(r => r.kind === 'sales' && r.id === cid + ':' + id && !r.deleted)).length; }", gone)
    ok(sent == 18, "the 18 put back are sent to the cloud again as invoices, not left as removed (%d of 18)" % sent)

    print("5. a colleague removes an invoice that this computer's Undo covers: Undo is taken away, nothing comes back")
    fresh22()
    E("() => { const s = SL(); s.list.forEach(v => v.status = 'review'); s.filter = 'review'; s.undo = null; saveSales(); render(); }"); W(700)
    E("() => { const s = SL(); s.sel.clear(); salesVisible().slice(0, 2).forEach(v => s.sel.add(v.id)); salesLightRefresh(); }"); W(300)
    two = E("[...SL().sel]")
    E("() => salesBulk('confirm')"); W(700)
    had = E("!!SL().undo")
    E(THEIRS, [two[0], None]); W(900)
    ok(had and not E("SL().list.some(v => v.id === '%s')" % two[0]), "the colleague's removal comes in (Undo was offered before: %s)" % had)
    ok(not E("!!SL().undo"), "Undo of the two confirmed is no longer offered")
    E("() => salesUndo()"); W(400)
    ok(not E("SL().list.some(v => v.id === '%s')" % two[0]), "an Undo anyway does not bring the colleague's removed invoice back")

    print("6. a colleague's removal arriving while Sales is opening: it stays removed")
    fresh22()
    x = E("SL().list[3].id")
    E("""([x, cid]) => { const p = loadSales(cid); const q = Live.rec("records", {kind: "sales", id: cid + ":" + x, client_id: cid, data: null, deleted: true, updated_by: "u-colleague", updated_at: new Date().toISOString()}); return Promise.all([p, q]); }""", [x, E("SL().cid")]); W(1500)
    ok(not E("SL().list.some(v => v.id === '%s')" % x) and E("SL().list.length") == 21, "the invoice removed while the list was being read is gone (%d invoices)" % E("SL().list.length"))
    ok(not E("(x) => cloudChanges().changes.some(r => r.kind === 'sales' && r.id.endsWith(':' + x) && !r.deleted)", x), "and it is not sent back to the cloud as an invoice")

    print("7. a reload while work is under way keeps that work: posted kept, an invoice mid-upload kept")
    fresh22()
    E("""() => { const s = SL(); window.__held = s.list[0]; window.__s0 = s;
      const v = newInvoice({number: "UP-1", date: "2026-10-30", customerName: "Dev Packaging", taxable: 100, cgst: 9, sgst: 9, igst: 0, cess: 0, total: 118, items: []}, "upload"); v.id = "upmid"; s.list.push(v); }""")
    other = E("JSON.parse(JSON.stringify(Object.assign({}, SL().list[5], {x: Object.assign({}, SL().list[5].x, {customerName: 'Chitra Foods (Lucknow)'})})))")
    E(THEIRS, [other["id"], other]); W(900)
    E("() => { window.__held.status = 'posted'; window.__held.postedAt = new Date().toISOString(); }")
    ok(E("SL().list.find(v => v.id === window.__held.id).status") == "posted", "an invoice Tally took while the list was read again is Posted (not lost on an object no longer shown)")
    ok(E("SL().list.some(v => v.id === 'upmid')"), "an invoice read mid-upload, not saved yet, stays")
    ok(E("SL() === window.__s0") and E("SL().list.find(v => v.id === '%s').x.customerName" % other["id"]) == "Chitra Foods (Lucknow)", "the colleague's change comes in, on the same list")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    ctx.close(); br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
