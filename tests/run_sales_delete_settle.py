"""python3 run_sales_delete_settle.py - Sales: the page stays still after a bulk delete (the owner, 24-Nov-2026: "When I
deleted the Zoho sheet details, the window was shaking").
The cause: every invoice deleted is a removal sent to FinCom's cloud, and Realtime hands each removal back to the
browser that made it, one row at a time. Each one reloaded the Sales list from scratch (loadSales): the page went to its
loading skeleton and back, the bar at the foot vanished and came back, the scroll jumped; 22 invoices deleted, 22 times
in a row. Now every removal is taken in as before, laid over the list in place, and the page is drawn once they stop.
Here (offline, a made-up client and 22 made-up invoices of a Zoho-style sheet): the invoices are ticked and deleted
from the bar, then the 22 removals come back as Realtime sends them (Live.rec, 40 ms apart). Every frame for 4 s is
measured: the page never shows its loading skeleton, the bar never goes, Undo stays; from 500 ms after the last removal
nothing moves (the page's height, its scroll, the bar's height, the number of elements) and nothing is drawn again.
Also (the reviews of a85572b8b and 8fc130d15): Undo either puts all back or is not offered once the removals come back,
never part; a colleague's removal is always taken in (of an invoice on the page, one Undo covers, one deleted and put
back here, one of a client whose Sales is not open, one arriving while Sales opens); a change made here while the cloud's
is being taken in (Posted, a delete) stays; an invoice mid-upload stays; a field a colleague removed goes.
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

    THEIRS = """([id, data]) => { const cid = SL().cid; return Live.rec("records", {kind: "sales", id: cid + ":" + id, client_id: cid, data: data, deleted: !data, updated_by: "u-colleague", updated_at: new Date().toISOString()}); }"""
    # in step with the cloud: everything here sent (the marks), nothing waiting
    SYNCED = """() => { const ch = cloudChanges().changes, m = Cloud.marks(); ch.forEach(r => { m[cloudKey(r)] = r.hash; }); Cloud.setMarks(m); Cloud.setDels({}); }"""
    def fresh22():
        E("() => { const s = SL(); s.list.splice(0); s.undo = null; s.sel.clear(); s.sticky.clear(); s.filter = 'ready'; saveSales(); }"); E(ADD); W(900); E(SYNCED)
    def moves(f):   # changes of the page's height, scroll or bar, those within 100 ms of each other counted as one
        ts = [b[0] for a, b in zip(f, f[1:]) if a[1:4] != b[1:4]]
        return sum(1 for i, t in enumerate(ts) if not i or t - ts[i - 1] > 100)
    has = lambda x: E("(x) => SL().list.some(v => v.id === x)", x)

    print("1. 18 of the 22 ticked and deleted from the bar; the removals come back from the cloud one by one")
    E(SYNCED)
    E("() => { const s = SL(); s.sel.clear(); salesVisible().slice(0, 18).forEach(v => s.sel.add(v.id)); salesLightRefresh(); }"); W(400)
    gone = E("[...SL().sel]")
    E("() => scrollTo(0, 1e6)"); W(400)
    pg.screenshot(path=OUT + "/sales-delete-settle-before.png")
    E(WATCH); pg.click('#app .actionbar button:has-text("Delete")'); E(ECHO, gone)
    W(4300)
    w = E("window.__w"); f = w["f"]; echo_at = E("window.__echoAt") or 0
    ok(E("window.__echoDone") == 18 and E("SL().list.length") == 4, "18 deleted, their 18 removals taken in, 4 invoices left (%s, %s)" % (E("window.__echoDone"), E("SL().list.length")))
    ok(not [r for r in f if r[5]], "the page never shows its loading skeleton")
    ok(not [r for r in f if r[0] > 150 and r[3] < 0], "the bar at the foot never goes")
    late = [r for r in f if r[0] > echo_at + 500]
    moved = [(a, b) for a, b in zip(late, late[1:]) if a[1:5] != b[1:5]]
    ok(len(late) > 30 and not moved, "from 500 ms after the last removal nothing moves: height, scroll, bar, elements (%d frames, %d changes%s)" % (len(late), len(moved), ": " + str(moved[:2]) if moved else ""))
    ok(moves(f) <= 2, "the page moves once or twice (the delete, Undo going), not with every removal (%d)" % moves(f))
    ok((w.get("lastRender") or 0) < echo_at + 500, "no drawing loop: %d drawings, the last at %d ms (the last removal at %d ms)" % (w["renders"], w.get("lastRender") or 0, echo_at))
    ok(not E("!!SL().undo") and not pg.locator('#app .actionbar .bk-snack').count(), "the removals came back: Undo is not offered any more (as before the fix)")
    pg.screenshot(path=OUT + "/sales-delete-settle-after.png")

    print("2. Undo clicked while the removals are still coming back: all back, or not offered; never part")
    fresh22()
    E("() => { const s = SL(); s.sel.clear(); salesVisible().slice(0, 18).forEach(v => s.sel.add(v.id)); salesLightRefresh(); }"); W(400)
    gone = E("[...SL().sel]")
    E(WATCH); pg.click('#app .actionbar button:has-text("Delete")'); E(ECHO, gone)
    W(420); n0 = E("window.__echoDone"); offered = E("!!SL().undo")
    u = pg.locator('#app .actionbar .bk-snack button:has-text("Undo")')
    if u.count(): u.first.click()
    W(1600)
    n = E("SL().list.length")
    ok(E("window.__echoDone") == 18 and n in (4, 22) and (n == 22 or not offered), "Undo after %d of the 18 came back (offered then: %s): %d invoices (22, or 4 with Undo not offered)" % (n0, offered, n))

    print("3. a colleague's removal of an invoice still on the page: taken off quietly, the ticks kept")
    fresh22()
    E("() => { const s = SL(); s.sel.clear(); salesVisible().slice(0, 2).forEach(v => s.sel.add(v.id)); salesLightRefresh(); }"); W(300)
    keep, other = E("(() => { const v = salesVisible(); return [v[0].id, v[v.length - 1].id]; })()")
    E(WATCH); E(THEIRS, [other, None]); W(1200)
    f = E("window.__w.f")
    ok(E("SL().list.length") == 21 and not has(other), "the colleague's removal comes in: 21 invoices (%d)" % E("SL().list.length"))
    ok(not [r for r in f if r[5]], "no loading skeleton for it")
    ok(E("SL().sel.has('%s') && SL().sel.size === 2" % keep) and E("SL().filter") == "ready", "the ticks and the tab are kept")

    print("4. a colleague removes an invoice that this computer's Undo covers: Undo is taken away, nothing comes back")
    fresh22()
    E("() => { const s = SL(); s.list.forEach(v => v.status = 'review'); s.filter = 'review'; saveSales(); render(); }"); W(700); E(SYNCED)
    E("() => { const s = SL(); s.sel.clear(); salesVisible().slice(0, 2).forEach(v => s.sel.add(v.id)); salesLightRefresh(); }"); W(300)
    two = E("[...SL().sel]")
    E("() => salesBulk('confirm')"); W(700)
    had = E("!!SL().undo")
    E(THEIRS, [two[0], None]); W(900)
    ok(had and not has(two[0]), "the colleague's removal comes in (Undo was offered before: %s)" % had)
    ok(not E("!!SL().undo"), "Undo of the two confirmed is no longer offered")
    E("() => salesUndo()"); W(400)
    ok(not has(two[0]), "an Undo anyway does not bring the colleague's removed invoice back")

    print("5. a colleague's removal arriving while Sales is opening: it stays removed")
    fresh22()
    x = E("SL().list[3].id")
    E("""([x, cid]) => { const p = loadSales(cid); const q = Live.rec("records", {kind: "sales", id: cid + ":" + x, client_id: cid, data: null, deleted: true, updated_by: "u-colleague", updated_at: new Date().toISOString()}); return Promise.all([p, q]); }""", [x, E("SL().cid")]); W(1500)
    ok(not has(x) and E("SL().list.length") == 21, "the invoice removed while the list was being read is gone (%d invoices)" % E("SL().list.length"))
    ok(not E("(x) => cloudChanges().changes.some(r => r.kind === 'sales' && r.id.endsWith(':' + x) && !r.deleted)", x), "and it is not sent back to the cloud as an invoice")

    print("6. a reload while work is under way keeps that work: posted kept, an invoice mid-upload kept")
    fresh22()
    E("""() => { const s = SL(); window.__held = s.list[0]; window.__s0 = s;
      const v = newInvoice({number: "UP-1", date: "2026-10-30", customerName: "Dev Packaging", taxable: 100, cgst: 9, sgst: 9, igst: 0, cess: 0, total: 118, items: []}, "upload"); v.id = "upmid"; s.list.push(v); }""")
    other = E("JSON.parse(JSON.stringify(Object.assign({}, SL().list[5], {x: Object.assign({}, SL().list[5].x, {customerName: 'Chitra Foods (Lucknow)'})})))")
    E(THEIRS, [other["id"], other]); W(900)
    E("() => { window.__held.status = 'posted'; window.__held.postedAt = new Date().toISOString(); }")
    ok(E("SL().list.find(v => v.id === window.__held.id).status") == "posted", "an invoice Tally took while the list was read again is Posted (not lost on an object no longer shown)")
    ok(has("upmid"), "an invoice read mid-upload, not saved yet, stays")
    ok(E("SL() === window.__s0") and E("SL().list.find(v => v.id === '%s').x.customerName" % other["id"]) == "Chitra Foods (Lucknow)", "the colleague's change comes in, on the same list")

    print("7. (P1) one deleted and put back at once, before any push; then a colleague deletes it")
    fresh22()
    x = E("SL().list[2].id")
    E("(x) => salesRowAct('delete', x)", x); W(100); E("() => salesUndo()"); W(800)
    ok(has(x), "Undo put it back")
    ok(not E("(x) => Object.keys(Cloud.dels()).some(k => k.endsWith(':' + x))", x), "and its removal no longer waits to be sent")
    E(THEIRS, [x, None]); W(900)
    ok(not has(x), "the colleague's removal comes in")
    E("(x) => { const v = SL().list.find(o => o.id === x); if (v){ v.userLedger = true; saveSales(); } }", x); W(700)
    ok(not E("(x) => cloudChanges().changes.some(r => r.kind === 'sales' && r.id.endsWith(':' + x) && !r.deleted)", x), "(P1b) a later edit here does not send it back as an invoice")

    print("8. (P5) a removal put back before a push, then a colleague deletes it while another client's Sales is open")
    fresh22()
    cA = E("SL().cid"); x = E("SL().list[2].id")
    E("(x) => salesRowAct('delete', x)", x); W(100); E("() => salesUndo()"); W(700)
    E("""(leds) => { const c = newCompany({name: "ZZ Other Traders", gstin: "09AAACZ9999Z1Z5"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      return openCompany(c.id).then(() => loadBank(c.id)).then(() => { S.tab = "sales"; return loadSales(c.id); }); }""", LEDGERS); W(800)
    E("""([cA, x]) => Live.rec("records", {kind: "sales", id: cA + ":" + x, client_id: cA, data: null, deleted: true, updated_by: "u-colleague", updated_at: new Date().toISOString()})""", [cA, x]); W(600)
    ok(not E("([cA, x]) => BankDB.get('sales:' + cA).then(l => (l || []).some(v => v.id === x))", [cA, x]), "the colleague's removal reaches this browser's copy of the other client")
    E("""(cA) => openCompany(cA).then(() => loadBank(cA)).then(() => { S.tab = "sales"; return loadSales(cA); })""", cA); W(900)
    ok(not has(x), "and that client's Sales, opened again, does not show it")

    print("9. (P2) an invoice Posted here while a colleague's change is being taken in (a slow read)")
    fresh22()
    b = E("SL().list[6].id")
    E("""() => { const g = BankDB.get.bind(BankDB); window.__g0 = g; BankDB.get = (k) => /^sales:/.test(k) ? new Promise(r => setTimeout(() => r(g(k)), 300)) : g(k); }""")
    other = E("JSON.parse(JSON.stringify(Object.assign({}, SL().list[5], {x: Object.assign({}, SL().list[5].x, {customerName: 'Chitra Foods (Lucknow)'})})))")
    E("""([d, b]) => { Live.rec("records", {kind: "sales", id: SL().cid + ":" + d.id, client_id: SL().cid, data: d, deleted: false, updated_by: "u-colleague", updated_at: new Date().toISOString()});
      setTimeout(() => { const v = SL().list.find(o => o.id === b); v.status = 'posted'; v.postedAt = 'T'; saveSales(); }, 100); }""", [other, b]); W(1500)
    ok(E("(b) => SL().list.find(o => o.id === b).status", b) == "posted", "it stays Posted")
    ok(E("(b) => BankDB.get('sales:' + SL().cid).then(l => (l.find(v => v.id === b) || {}).status)", b) == "posted", "and is kept so in this browser")

    print("10. (P3) an invoice deleted here while a colleague's change is being taken in")
    fresh22()
    c = E("SL().list[8].id")
    other = E("JSON.parse(JSON.stringify(Object.assign({}, SL().list[5], {x: Object.assign({}, SL().list[5].x, {customerName: 'Asha Textiles Pvt Ltd'})})))")
    E("""([d, c]) => { Live.rec("records", {kind: "sales", id: SL().cid + ":" + d.id, client_id: SL().cid, data: d, deleted: false, updated_by: "u-colleague", updated_at: new Date().toISOString()});
      setTimeout(() => salesRowAct('delete', c), 100); }""", [other, c]); W(1500)
    ok(not has(c), "it stays deleted")
    ok(E("(c) => Object.keys(Cloud.dels()).some(k => k.endsWith(':' + c))", c), "and its removal waits to be sent (not dropped because a row was being taken in)")
    E("() => { BankDB.get = window.__g0; }")

    print("11. (P4) a field a colleague removed from an invoice goes here too")
    fresh22()
    d = E("(() => { const v = SL().list[4]; v.extraNote = 'here'; saveSales(); return v.id; })()"); W(900); E(SYNCED)
    other = E("(() => { const o = JSON.parse(JSON.stringify(SL().list[4])); delete o.extraNote; o.x.customerName = 'Dev Packaging'; return o; })()")
    E(THEIRS, [other["id"], other]); W(900)
    ok(not E("(d) => 'extraNote' in SL().list.find(v => v.id === d)", d), "the removed field is gone here")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    ctx.close(); br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
