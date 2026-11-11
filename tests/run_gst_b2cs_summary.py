"""python3 run_gst_b2cs_summary.py - a consolidated B2C entry (the owner, a CA, 11-Nov-2026): one sales entry booking many
B2C sales received through a payment gateway, numbered as a range ("2026-27/155 to 2026-27/182"), party with no GSTIN,
Rs 5,93,206.01, was flagged on GSTR-1 > What to fix as "Invoice number too long", "has characters the portal refuses" and
"used twice". B2C small (B2CS) is reported as totals by place of supply and rate, with no invoice number, so:

  1. invoice-number checks (length, characters, used twice) apply only to documents reported one by one (B2B, B2C large,
     exports, notes to registered persons and the unregistered notes of table 9B); never to a row reported in B2CS;
  2. a consolidated B2C entry goes in B2CS even when it is inter-state and above the B2C large limit: (a) by itself when
     its number is a range and the party has no GSTIN; (b) by the party ledger's switch "Consolidated B2C (summary of many
     sales)" (b.map[ledger].b2cSum, FinCom's own, kept over a refresh of the ledger list); (c) per entry on What to fix
     ("This is a summary of many B2C sales", b.gstPosFix[id].b2cs, or "Not a summary" to undo the range rule); the
     entry says which rule made it B2CS;
  3. table 13: a range number counts the range's documents (155 to 182 = 28) in its series;
  4. the year's grid and What to fix count the same (GSTR.errorsFor / errorChecks).
A real B2C large invoice with a too-long number is still flagged; a B2B number used twice still is.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("GSTB2CS_PORT") or 8729)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

YM, REG = "202604", "07"
GW = "Payment Gateway Collections"      # a payment gateway's party ledger, no GSTIN
RANGE = "2026-27/155 to 2026-27/182"
NUMCHK = ["Invoice numbers longer than 16 characters", "Invoice numbers with characters the portal does not take", "Invoice numbers used twice in the financial year"]
CHECKS = "(a) => Object.fromEntries(GSTR.checks(a[0], a[1]).map(c => [c.what, {n: c.n, ids: (c.all || c.rows).map(r => (r.doc || r).id)}]))"
ROW = "(id) => { const r = GSTR.outward('" + YM + "', '" + REG + "').find(r => r.id === id); return r ? {kind: r.kind, sum: r.b2cSum || '', no: r.no} : null; }"
# a sale of Rs 5,93,206.01: taxable 5,02,716.96 at 18%; IGST to Maharashtra, or CGST and SGST within Delhi
ADD = """(a) => { const [id, no, party, inter, total, taxable, date] = a, tax = Math.round((total - taxable) * 100) / 100, half = Math.round(tax / 2 * 100) / 100;
  const v = {id, date: date || '20260430', type: 'Sales', no, ref: '', refDate: '', irn: '', irnDate: '', party, gstin: '', pos: inter ? 'Maharashtra' : 'Delhi', cmp: '07AAGCL4827M1Z3',
    narr: 'Sales received through the gateway', regType: 'Unregistered', country: 'India', rcm: false, taxability: 'Taxable', nature: '', supply: 'Services', ineligibleFlag: false,
    hsn: ['998596'], by: 'accounts', upd: '', cancel: false, opt: false, alt: 9000 + S.books.vouchers.length,
    ent: [{l: party, a: -total, r: null}, {l: 'Event Management Services', a: taxable, r: 9, h: '998596', gr: 18, sp: 'Services'}].concat(inter ? [{l: '07 IGST OUTPUT', a: tax, r: null}] : [{l: '07 CGST OUTPUT', a: half, r: null}, {l: '07 SGST OUTPUT', a: Math.round((tax - half) * 100) / 100, r: null}])};
  S.books.vouchers = S.books.vouchers.concat([v]); S.books.map = Books.mapLedgers(S.books.vouchers, S.books.map); LedMaster.refresh(S.books); render(); return v.id; }"""
DROP = "(id) => { S.books.vouchers = S.books.vouchers.filter(v => v.id !== id); render(); }"
COUNTS = "(a) => { const e = GSTR.errorsFor(a[0], a[1]), l = GSTR.errorChecks(a[0], a[1]); return {r1: e.r1, l1: l.r1.reduce((s, c) => s + c.n, 0)}; }"

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        base = pg.evaluate(COUNTS, [YM, REG])

        # the range rule, as GSTR.noRange reads a number
        rg = pg.evaluate("() => [GSTR.noRange('2026-27/155 to 2026-27/182'), GSTR.noRange('PG/APR/1-PG/APR/40'), GSTR.noRange('INV/155 to 182'), GSTR.noRange('2026-27'), GSTR.noRange('LFE/25-26/001'), GSTR.noRange('155-182'), GSTR.noRange('A/9 to A/3')]")
        ok(rg[0] and rg[0]["n"] == 28 and rg[0]["from"] == "2026-27/155" and rg[0]["to"] == "2026-27/182", "'2026-27/155 to 2026-27/182' is a range of 28 (%s)" % rg[0])
        ok(rg[1] and rg[1]["n"] == 40 and rg[2] and rg[2]["n"] == 28 and rg[2]["to"] == "INV/182", "'PG/APR/1-PG/APR/40' (dash, common prefix) 40; 'INV/155 to 182' 28 (%s / %s)" % (rg[1], rg[2]))
        ok(rg[3] is None and rg[4] is None and rg[5] is None and rg[6] is None, "'2026-27', 'LFE/25-26/001', '155-182' (a dash and no prefix) and a range backwards are not ranges (%s)" % rg[3:])

        # 1, 2(a): the owner's entry, inter-state (IGST, above the B2C large limit) and intra-state
        a = pg.evaluate(ADD, ["t-gw-inter", RANGE, GW, True, 593206.01, 502716.96])
        r = pg.evaluate(ROW, a)
        ok(r and r["kind"] == "B2C" and r["sum"] == "range", "inter-state, Rs 5,93,206.01, range number, no GSTIN: B2C small (B2CS), not B2C large; the rule: the number is a range (%s)" % r)
        ch = pg.evaluate(CHECKS, [YM, REG])
        ok(not any(a in ch.get(k, {}).get("ids", []) for k in NUMCHK), "no invoice-number finding (length, characters, used twice) on it (%s)" % {k: ch[k] for k in NUMCHK if k in ch})
        b = pg.evaluate(ADD, ["t-gw-intra", RANGE, GW, False, 593206.01, 502716.96, "20260415"])
        r2 = pg.evaluate(ROW, b)
        ok(r2 and r2["kind"] == "B2C" and r2["sum"] == "range", "the intra-state variant (CGST and SGST): B2CS, the rule shown (%s)" % r2)
        ch = pg.evaluate(CHECKS, [YM, REG])
        ok(not any(x in ch.get(k, {}).get("ids", []) for k in NUMCHK for x in (a, b)), "the two entries, the same range number: not 'used twice', not too long, no bad characters (%s)" % {k: ch[k] for k in NUMCHK if k in ch})
        c = pg.evaluate(COUNTS, [YM, REG])
        ok(c == base, "the grid's count and What to fix's are as before: nothing for the summaries (%s, before %s)" % (c, base))
        j = pg.evaluate("(a) => GSTR.toJson(a[0], a[1])", [YM, REG])
        b2cs = [x for x in j.get("b2cs", []) if x["pos"] == "27" and x["rt"] == 18]
        ok(b2cs and abs(b2cs[0]["txval"] - 502716.96) < 0.01 and abs(b2cs[0]["iamt"] - 90489.05) < 0.01, "the JSON: B2CS Maharashtra (27) at 18%%: 5,02,716.96, IGST 90,489.05 (%s)" % b2cs)
        ok(not any(i["inum"] == RANGE for g in j.get("b2cl", []) for i in g["inv"]), "the JSON: not in b2cl")
        # 3: table 13 counts the range
        docs = [d for g in j.get("doc_issue", {}).get("doc_det", []) if g["doc_num"] == 1 for d in g["docs"] if str(d["from"]).startswith("2026-27/")]
        ok(docs and docs[0]["totnum"] == 56 and docs[0]["from"] == "2026-27/155" and docs[0]["to"] == "2026-27/182", "table 13: the series 2026-27/ counts 28 invoices for each range entry (two entries: 56), 155 to 182 (%s)" % docs)

        # a real B2C large invoice with a number too long: still flagged, still B2CL
        l = pg.evaluate(ADD, ["t-b2cl-long", "LFE/2026-27/000123", "Walk-in Buyer Mumbai", True, 150000, 127118.64])
        r = pg.evaluate(ROW, l); ch = pg.evaluate(CHECKS, [YM, REG])
        ok(r and r["kind"] == "B2CL" and r["sum"] == "", "a single inter-state sale of Rs 1,50,000 to an unregistered buyer: B2C large (%s)" % r)
        ok(l in ch.get(NUMCHK[0], {}).get("ids", []), "its 18-character number is still flagged too long (%s)" % ch.get(NUMCHK[0]))
        c1 = pg.evaluate(COUNTS, [YM, REG])
        ok(c1["r1"] == base["r1"] + 1 and c1["l1"] == c1["r1"], "the grid's count and What to fix's: one more, the same (%s)" % c1)

        # a B2B invoice number used twice: still flagged
        dup = pg.evaluate("""(a) => { const s = S.books.vouchers.filter(v => v.type === 'Sales' && v.gstin && !v.cancel && v.date >= '20260401' && v.date < '20260501' && v.cmp === '07AAGCL4827M1Z3');
          const o = s[0]; if (!o) return null; const c = Object.assign({}, o, {id: 't-b2b-dup', alt: 9999, date: '20260420'}); S.books.vouchers = S.books.vouchers.concat([c]); render(); return [o.id, c.id, o.no]; }""", None)
        if dup:
            ch = pg.evaluate(CHECKS, [YM, REG])
            ok(all(x in ch.get(NUMCHK[2], {}).get("ids", []) for x in dup[:2]), "a B2B number used twice (%s): both flagged (%s)" % (dup[2], ch.get(NUMCHK[2])))
            pg.evaluate(DROP, "t-b2b-dup")
        else:
            ok(False, "the fixture has an April B2B sale of the Delhi registration to repeat")

        # 2(b): the party ledger's switch, for a number that is no range
        g = pg.evaluate(ADD, ["t-gw-ledger", "PG APR 26 SUMMARY", "Marketplace Collections", True, 593206.01, 502716.96])
        r = pg.evaluate(ROW, g); ch = pg.evaluate(CHECKS, [YM, REG])
        ok(r and r["kind"] == "B2CL" and g in ch.get(NUMCHK[1], {}).get("ids", []) and g in ch.get(NUMCHK[0], {}).get("ids", []), "no range and no switch: B2C large, its number flagged (%s)" % r)
        pg.evaluate("() => GSTR.b2cSumLedger('Marketplace Collections', true)")
        r = pg.evaluate(ROW, g); ch = pg.evaluate(CHECKS, [YM, REG])
        ok(r and r["kind"] == "B2C" and r["sum"] == "ledger" and not any(g in ch.get(k, {}).get("ids", []) for k in NUMCHK), "the ledger switched to Consolidated B2C: B2CS, the rule: the party ledger; no number finding (%s)" % r)
        m = pg.evaluate("() => { const m = S.books.map['Marketplace Collections']; return [!!(m && m.b2cSum), !!(m && m.byHand)]; }")
        ok(m == [True, False], "kept in the ledger map (b.map, synced with the books), the ledger's kind left as it was (%s)" % m)
        kept = pg.evaluate("() => { S.books.map = Books.mapLedgers(S.books.vouchers, S.books.map); LedMaster.refresh(S.books); return !!(S.books.map['Marketplace Collections'] || {}).b2cSum; }")
        ok(kept, "the switch is kept when the ledger list is made again (mapLedgers, LedMaster.refresh)")
        ok(pg.evaluate("() => BookSync.keys().includes('map') && BookSync.keys().includes('gstPosFix')"), "the switches are in parts of the books that are synced (map, gstPosFix)")

        # 2(c): per entry, on What to fix; and "Not a summary" over the range rule
        pg.evaluate("() => GSTR.b2cSumLedger('Marketplace Collections', false)")
        pg.evaluate("(id) => GSTR.b2cSumEntry(id, true)", g)
        r = pg.evaluate(ROW, g)
        ok(r and r["kind"] == "B2C" and r["sum"] == "entry", "the ledger switched off, the entry marked as a summary: B2CS, the rule: marked on the entry (%s)" % r)
        ok(pg.evaluate("(id) => !!(S.books.gstPosFix[id] || {}).b2cs", g), "kept in gstPosFix with the entry's id")
        pg.evaluate("(id) => GSTR.b2cSumEntry(id, false)", a)
        r = pg.evaluate(ROW, a); ch = pg.evaluate(CHECKS, [YM, REG])
        ok(r and r["kind"] == "B2CL" and r["sum"] == "" and a in ch.get(NUMCHK[1], {}).get("ids", []), "'Not a summary' on the range entry: B2C large again, its number flagged (%s)" % r)
        pg.evaluate("(id) => GSTR.b2cSumEntry(id, null)", a)
        ok(pg.evaluate(ROW, a)["sum"] == "range" and a not in (pg.evaluate("(id) => S.books.gstPosFix || {}", a)), "cleared: the range rule again, nothing kept for it")

        # the screens: What to fix shows the button on a B2C large row; the summaries are listed with their rule
        pg.evaluate("(a) => { S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = a[1]; S.gstYm = a[0]; render(); }", [YM, REG]); pg.wait_for_timeout(600)
        pg.click('#app [data-cell="GSTR-1|%s"]' % YM); pg.wait_for_timeout(800)
        pg.evaluate("(w) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === w); if (g && !g.querySelector('[data-fix-row]')) g.querySelector('[data-fix-toggle]').click(); }", NUMCHK[0]); pg.wait_for_timeout(300)
        btn = pg.evaluate("(id) => !!document.querySelector('#app [data-fix-row][data-id=\"' + id + '\"] [data-b2cs-mark]')", l)
        ok(btn, "What to fix: the B2C large row offers 'This is a summary of many B2C sales'")
        sm = pg.evaluate("() => Array.from(document.querySelectorAll('#app [data-b2cs-sum] [data-b2cs-row]')).map(r => [r.dataset.b2csRow, r.dataset.why, r.innerText.replace(/\\s+/g, ' ')])")
        ok(any(x[0] == b and x[1] == "range" and "range" in x[2] for x in sm) and any(x[0] == g and x[1] == "entry" for x in sm), "What to fix lists the entries reported as B2C summaries, each with the rule that made it so (%s)" % sm)
        # the other entry marked "not a summary": it is B2C large with its number errors, so the month keeps errors (the tab stays)
        pg.evaluate("(id) => GSTR.b2cSumEntry(id, false)", g); pg.wait_for_timeout(300)
        n0 = pg.evaluate(COUNTS, [YM, REG])["r1"]
        pg.click('#app [data-fix-row][data-id="%s"] [data-b2cs-mark]' % l); pg.wait_for_timeout(500)
        n1 = pg.evaluate(COUNTS, [YM, REG])
        ok(n1["r1"] == n0 - 1 and n1["l1"] == n1["r1"] and pg.evaluate(ROW, l)["sum"] == "entry", "the button: the entry goes to B2CS, What to fix and the grid one fewer (%s -> %s)" % (n0, n1))
        tab = pg.evaluate("() => (document.querySelector('#app [data-sub=\"fix\"]') || {}).innerText || ''")
        ok(tab == "What to fix (%d)" % n1["r1"], "the tab says the same count (%r)" % tab)
        pg.evaluate("(id) => GSTR.b2cSumEntry(id, null)", l); pg.evaluate("(id) => GSTR.b2cSumEntry(id, null)", g)
        # the Ledgers tab: the switch beside a party ledger of sales with no GSTIN
        pg.evaluate("() => { S.booksTab = 'ledgers'; S.ledQ = 'Payment Gateway'; render(); }"); pg.wait_for_timeout(800)
        sw = pg.evaluate("(n) => { const x = document.querySelector('#app [data-b2cs-ledger=\"' + n + '\"]'); return x ? [x.checked, (x.closest('label') || {}).innerText || ''] : null; }", GW)
        ok(sw and sw[0] is False and "Consolidated B2C" in sw[1], "Books > Tally ledgers: the party ledger has the switch 'Consolidated B2C (summary of many sales)' (%s)" % sw)
        if sw:
            pg.click('#app [data-b2cs-ledger="%s"]' % GW); pg.wait_for_timeout(400)
            ok(pg.evaluate("(n) => !!(S.books.map[n] || {}).b2cSum", GW) and pg.evaluate(ROW, a)["sum"] in ("range", "ledger"), "ticked: kept on the ledger")
        ok(pg.evaluate("() => document.querySelectorAll('#app [data-guard]').length") == 0, "no error box")
        br.close()
finally:
    srv.shutdown()
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
