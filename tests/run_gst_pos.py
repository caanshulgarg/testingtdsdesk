"""python3 run_gst_pos.py - the place of supply of a sale (the owner, a CA, 11-Nov-2026): "place of supply missing" only
when it cannot be known. In order: (1) the entry's own place of supply from Tally; (2) CGST and SGST charged: the state of
the registration the return is for; (3) the party's GSTIN, on the entry or the party's ledger: its state; (4) else missing
(IGST to an unregistered buyer with no state). A tax that does not fit the place of supply known from Tally or the GSTIN
(CGST and SGST to another state, IGST within the own state) is an error of its own. Then the bulk fill of the ones still
missing (GST › What to fix › Place of supply missing): tick 3, type "Mah", Apply: 3 errors fewer, the GSTR-1 JSON carries
27, a reload keeps it, Clear brings the error back; Tally's place of supply, when it arrives, wins over FinCom's.
Fixture books (tests/fixtures/books, registration 07), sales of Mar-2026 copied with their fields changed.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("GSTPOS_PORT") or 8331)
YM, REG = "202603", "07"
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
BOOT = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"

# the cases, each a copy of a sale of Mar-2026: LFE/25-26/015 (IGST, a GSTIN of state 09) or LFE/25-26/016 (CGST and
# SGST, a GSTIN of state 07). [no, from, fields]; party "" keeps the party; a party with "L:" is given that ledger GSTIN
CASES = [
    ["P1-TALLY", "016", {"gstin": "", "pos": "Delhi", "party": "Walk-in Tally"}],          # (1) Tally's place of supply
    ["P2-TAX", "016", {"gstin": "", "pos": "", "party": "Walk-in Cash"}],                   # (2) CGST+SGST, nothing else
    ["P3-GSTIN", "015", {"pos": ""}],                                                       # (3) the entry's GSTIN (09)
    ["P3-LEDGER", "015", {"gstin": "", "pos": "", "party": "L:09AAJFQ3158R1Z1"}],           # (3) the party ledger's GSTIN
    ["P4-A", "015", {"gstin": "", "pos": "", "party": "Unreg Buyer A"}],                    # (4) IGST, no state: missing
    ["P4-B", "015", {"gstin": "", "pos": "", "party": "Unreg Buyer B"}],
    ["P4-C", "015", {"gstin": "", "pos": "", "party": "Unreg Buyer C"}],
    ["P4-D", "015", {"gstin": "", "pos": "", "party": "Unreg Buyer D"}],
    ["M1-CS-OTHER", "016", {"gstin": "", "pos": "Uttar Pradesh", "party": "Walk-in UP"}],    # CGST+SGST, Tally says UP
    ["M2-CS-GSTIN", "016", {"gstin": "09AAJFQ3158R1Z1", "pos": ""}],                         # CGST+SGST, GSTIN of 09
    ["M3-IGST-OWN", "015", {"gstin": "", "pos": "Delhi", "party": "Walk-in Delhi"}],         # IGST, Tally says Delhi
]
PLANT = """(cases) => {
  const b = S.books, src = n => b.vouchers.find(v => v.no === 'LFE/25-26/' + n && String(v.date).slice(0, 6) === '%s');
  b.gstins = Object.assign({}, b.gstins);
  cases.forEach(([no, from, f], i) => { const v = Object.assign({}, src(from), {id: 'pos-case-' + i, no});
    Object.keys(f).forEach(k => { if (k !== 'party') v[k] = f[k]; });
    if (f.party && f.party.startsWith('L:')){ v.party = 'Ledger Buyer ' + i; b.gstins[v.party] = f.party.slice(2); } else if (f.party) v.party = f.party;
    b.vouchers.push(v); });
  b.vouchers = b.vouchers.slice(); render();
}""" % YM
ROWS = "(a) => Object.fromEntries(GSTR.outward(a[0], a[1]).filter(r => /^(P|M)\\d/.test(r.no)).map(r => [r.no, {kind: r.kind, pos: r.pos, code: r.posCode, from: r.posFrom, bad: r.posBad}]))"
CHK = "(a) => Object.fromEntries(GSTR.checks(a[0], a[1]).map(c => [c.what, {n: c.n, nos: c.all.map(r => r.no)}]))"
JSONPOS = """(a) => { const j = GSTR.toJson(a[0], a[1]), out = {};
  (j.b2b || []).forEach(g => g.inv.forEach(x => { out[x.inum] = x.pos; }));
  (j.b2cl || []).forEach(g => g.inv.forEach(x => { out[x.inum] = g.pos; }));
  out.b2cs = (j.b2cs || []).map(x => x.pos + '|' + x.sply_ty).sort(); return out; }"""
MISS, BAD = "Outward invoices with no place of supply", "Tax type that does not match the place of supply"

def grid_n(pg):
    pg.evaluate("(a) => { S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = a[1]; S.gstYm = a[0]; render(); }", [YM, REG]); pg.wait_for_timeout(700)
    return pg.evaluate("""(k) => { const c = document.querySelector('#app [data-cell="' + k + '"]'); if (!c) return null; const m = /Errors (\\d+)/.exec(c.innerText); return m ? +m[1] : 0; }""", "GSTR-1|" + YM)

def fix_list(pg):
    pg.click('#app [data-cell="GSTR-1|%s"]' % YM); pg.wait_for_timeout(700)
    return pg.evaluate("""() => { const p = document.querySelector('#app [data-fix-list]'); if (!p) return null;
      return {n: +p.dataset.fixN, groups: Object.fromEntries(Array.from(p.querySelectorAll('[data-fix-group]')).map(g => [g.dataset.fixGroup, +g.dataset.n]))}; }""")

def open_missing(pg):
    pg.evaluate("(w) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === w); if (g && !g.querySelector('[data-fix-row]')) g.querySelector('[data-fix-toggle]').click(); }", MISS); pg.wait_for_timeout(300)

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(BOOT); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        before = pg.evaluate(CHK, [YM, REG])
        ok(MISS not in before and BAD not in before, "the fixture as it is: no place-of-supply finding in Mar-2026 (%s)" % list(before))
        pg.evaluate(PLANT, CASES); pg.wait_for_timeout(300)
        R = pg.evaluate(ROWS, [YM, REG]); C = pg.evaluate(CHK, [YM, REG])
        print("  rows", json.dumps(R))
        ok(R["P1-TALLY"]["code"] == "07" and R["P1-TALLY"]["from"] == "tally" and R["P1-TALLY"]["pos"] == "Delhi", "(1) Tally's place of supply is used (%s)" % R["P1-TALLY"])
        ok(R["P2-TAX"]["code"] == "07" and R["P2-TAX"]["from"] == "tax" and R["P2-TAX"]["pos"] == "Delhi", "(2) CGST and SGST, no state, no GSTIN: the registration's state, 07 Delhi (%s)" % R["P2-TAX"])
        ok(R["P3-GSTIN"]["code"] == "09" and R["P3-GSTIN"]["from"] == "gstin", "(3) the entry's GSTIN: its state, 09 (%s)" % R["P3-GSTIN"])
        ok(R["P3-LEDGER"]["code"] == "09" and R["P3-LEDGER"]["from"] == "gstin" and R["P3-LEDGER"]["kind"] != "B2B", "(3) the party ledger's GSTIN: its state, 09 (the sale stays B2C as before) (%s)" % R["P3-LEDGER"])
        ok(all(R[k]["code"] == "" and not R[k]["bad"] for k in ["P4-A", "P4-B", "P4-C", "P4-D"]), "(4) IGST to an unregistered buyer with no state: still missing (%s)" % R["P4-A"])
        miss = C.get(MISS, {}); bad = C.get(BAD, {})
        ok(sorted(miss.get("nos", [])) == ["P4-A", "P4-B", "P4-C", "P4-D"], "Place of supply missing: only the 4 of case (4) (%s)" % miss)
        ok(sorted(bad.get("nos", [])) == ["M1-CS-OTHER", "M2-CS-GSTIN", "M3-IGST-OWN"], "Tax type does not match: CGST+SGST to UP (Tally), CGST+SGST to a 09 GSTIN, IGST with Delhi (%s)" % bad)
        ok(not any(R[k]["bad"] for k in ["P1-TALLY", "P2-TAX", "P3-GSTIN", "P3-LEDGER"]), "no mismatch on the cases that fit")
        J = pg.evaluate(JSONPOS, [YM, REG])
        print("  json", json.dumps(J))
        ok(J.get("P3-GSTIN") == "09", "GSTR-1 JSON, B2B: IGST, no state in Tally: the place of supply from the GSTIN, 09 (%s)" % J.get("P3-GSTIN"))
        ok(J.get("M2-CS-GSTIN") == "07", "GSTR-1 JSON, B2B: CGST and SGST charged: the own state, 07, as the rule's order says (and flagged, as the GSTIN is of 09) (%s)" % J.get("M2-CS-GSTIN"))
        ok("07|INTRA" in J["b2cs"] and not any(x.startswith("00|") for x in J["b2cs"] if x != "00|INTER"), "GSTR-1 JSON, B2C small: the CGST/SGST sale under 07 INTRA (%s)" % J["b2cs"])
        g0 = grid_n(pg); f0 = fix_list(pg)
        ok(f0 and f0["n"] == g0 and f0["groups"].get(MISS) == 4 and f0["groups"].get(BAD) == 3 and sum(f0["groups"].values()) == g0,
           "the grid's Errors %s = What to fix's count, by group (%s)" % (g0, f0))
        T3B = pg.evaluate("(a) => GSTR.threeB(a[0], a[1]).unregPos", [YM, REG])
        ok(any(x["pos"] == "09" for x in T3B), "3B 3.2: the IGST sale to the unregistered party with a 09 ledger GSTIN is under 09 (%s)" % T3B)

        # ---- the bulk fill: tick 3, type Mah, Enter
        open_missing(pg)
        ids = pg.evaluate("() => Array.from(document.querySelectorAll('#app [data-pos-tick]')).map(x => x.dataset.posTick)")
        ok(len(ids) == 4 and pg.locator("#app [data-pos-set]").count() == 0, "the group lists its 4 invoices with a tick box each, no picker until one is ticked (%s)" % ids)
        h = pg.evaluate("() => Math.min(...Array.from(document.querySelectorAll('#app .pos-tk, #app .pos-all')).map(x => x.getBoundingClientRect().height))")
        ok(h >= 44, "tick targets are at least 44 px high (%s)" % h)
        names = pg.evaluate("() => Array.from(document.querySelectorAll('#app [data-fix-group] [data-fix-row]')).map(r => r.dataset.id)")
        for i in range(3): pg.check('#app [data-pos-tick="%s"]' % names[i]); pg.wait_for_timeout(150)
        ok(pg.locator("#app [data-pos-set]").count() == 1, "3 ticked: Set place of supply appears")
        pg.fill("#app [data-pos-q]", "Mah"); pg.wait_for_timeout(150)
        top = pg.evaluate("() => (document.querySelector('#app [data-pos-opt]') || {}).dataset")
        ok(top and top.get("posOpt") == "27", "typing 'Mah' puts Maharashtra (27) on top (%s)" % top)
        pg.fill("#app [data-pos-q]", "33"); pg.wait_for_timeout(100)
        ok(pg.evaluate("() => (document.querySelector('#app [data-pos-opt]') || {}).innerText || ''").startswith("Tamil Nadu"), "typing the code 33 finds Tamil Nadu")
        pg.fill("#app [data-pos-q]", "Mah"); pg.press("#app [data-pos-q]", "Enter"); pg.wait_for_timeout(900)
        fx = pg.evaluate("() => S.books.gstPosFix")
        ok(fx and sorted(fx) == sorted(names[:3]) and all(x["pos"] == "27" for x in fx.values()), "Enter: the 3 invoices get 27, kept as FinCom's correction in the books (%s)" % fx)
        C2 = pg.evaluate(CHK, [YM, REG]); R2 = pg.evaluate(ROWS, [YM, REG])
        ok(C2.get(MISS, {}).get("n") == 1, "Place of supply missing: 4 -> 1 (%s)" % C2.get(MISS))
        ok(sum(1 for k in ["P4-A", "P4-B", "P4-C", "P4-D"] if R2[k]["from"] == "fincom" and R2[k]["code"] == "27") == 3, "the 3 show 27, set in FinCom")
        g1 = grid_n(pg); f1 = fix_list(pg)
        ok(g1 == g0 - 3 and f1 and f1["n"] == g1, "the grid and What to fix drop by 3: %s -> %s (%s)" % (g0, g1, f1))
        ok(pg.locator("#app [data-pos-fixed]").count() == 1 and pg.locator("#app [data-pos-fixed] [data-pos-clear]").count() == 3, "What to fix lists the 3 set in FinCom, each with Clear")
        J2 = pg.evaluate("(a) => JSON.stringify(GSTR.toJson(a[0], a[1]))", [YM, REG])
        ok('"pos":"27"' in J2, "the GSTR-1 JSON carries the place of supply 27")
        # the single row picker
        open_missing(pg)
        one = pg.evaluate("() => (document.querySelector('#app [data-pos-one]') || {}).dataset")
        ok(one and one.get("posOne"), "the invoice left has its own Set place of supply")
        if one:
            pg.click('#app [data-pos-one="%s"]' % one["posOne"]); pg.wait_for_timeout(200)
            pg.fill("#app [data-fix-group] [data-pos-set] [data-pos-q]", "karn"); pg.wait_for_timeout(100); pg.click("#app [data-fix-group] [data-pos-set] [data-pos-apply]"); pg.wait_for_timeout(800)
            ok(pg.evaluate("(id) => (S.books.gstPosFix[id] || {}).pos", one["posOne"]) == "29" and MISS not in pg.evaluate(CHK, [YM, REG]), "one invoice: 'karn' + Apply sets Karnataka (29); none missing now")
            pg.evaluate("(id) => { const f = Object.assign({}, S.books.gstPosFix); delete f[id]; S.books.gstPosFix = f; saveBooks(); render(); }", one["posOne"]); pg.wait_for_timeout(500)

        # ---- a reload keeps it
        cid = pg.evaluate("() => { Store.saveCompany(CO()); saveBooks(); return S.books.cid; }"); pg.wait_for_timeout(1500)
        pg.reload(); pg.wait_for_timeout(2500); pg.evaluate(BOOT); pg.wait_for_timeout(1200)
        kept = pg.evaluate("async (cid) => { Books.forget(cid); const d = await Books.load(cid); if (!d) return null; S.coId = cid; S.view = 'company'; S.books = Object.assign({loading: false}, d); S.books.map = Books.mapLedgers(S.books.vouchers, {}); render(); return d.gstPosFix || null; }", cid)
        pg.wait_for_timeout(600)
        ok(kept and sorted(kept) == sorted(names[:3]), "after a reload the 3 corrections are still there (%s)" % kept)
        C3 = pg.evaluate(CHK, [YM, REG])
        ok(C3.get(MISS, {}).get("n") == 1, "after a reload: still 1 missing (%s)" % C3.get(MISS))
        ok('"pos":"27"' in pg.evaluate("(a) => JSON.stringify(GSTR.toJson(a[0], a[1]))", [YM, REG]), "after a reload: the JSON still has 27")
        ok("gstPosFix" in pg.evaluate("() => BookSync.keys()"), "the corrections are among the books' parts that are synced (BookSync.keys)")

        # ---- Tally's place of supply wins when it arrives; Clear brings the error back
        pg.evaluate("(id) => { const v = S.books.vouchers.find(v => v.id === id); v.pos = 'Gujarat'; S.books.vouchers = S.books.vouchers.slice(); render(); }", names[0]); pg.wait_for_timeout(200)
        r0 = pg.evaluate("(a) => GSTR.outward(a[0], a[1]).find(r => r.id === a[2])", [YM, REG, names[0]])
        ok(r0["posCode"] == "24" and r0["posFrom"] == "tally", "Tally's place of supply, entered later, wins over FinCom's (%s %s)" % (r0["posCode"], r0["posFrom"]))
        pg.evaluate("(id) => { const v = S.books.vouchers.find(v => v.id === id); v.pos = ''; S.books.vouchers = S.books.vouchers.slice(); render(); }", names[0]); pg.wait_for_timeout(200)
        grid_n(pg); fix_list(pg)
        pg.click('#app [data-pos-fixed] [data-pos-clear="%s"]' % names[1]); pg.wait_for_timeout(800)
        C4 = pg.evaluate(CHK, [YM, REG])
        ok(C4.get(MISS, {}).get("n") == 2 and names[1] not in pg.evaluate("() => S.books.gstPosFix"), "Clear: the invoice is missing again, 1 -> 2 (%s)" % C4.get(MISS))
        ok(grid_n(pg) == g1 + 1, "the grid's count goes up by 1 again")
        ok(pg.evaluate("() => document.querySelectorAll('#app [data-guard]').length") == 0, "no error box")
        br.close()
finally:
    srv.shutdown()
ok(not errors, "no page errors %s" % errors[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
