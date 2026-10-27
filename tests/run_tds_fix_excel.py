"""python3 run_tds_fix_excel.py - a TDS return's deductions: what needs fixing, the section's name, and the Excel round trip
(t70, 16-Oct-2026; the owner: "section name is not there.. show me what needs fixing.. I want to correct it in Excel and bring
it back.. excel should have formulas"). Used as a person would, on the fixture books (tests/fixtures/books, and a year on):

  1. "Needs fixing" in the deductions' filter bar ([data-ded-filter=fix]) with its count; pressed, only the deductions
     the return already finds wrong (no valid PAN, the rate question, no challan, the section, the payment code);
  2. every section shows its plain name under its code, this year's and last year's, by deduction and by deductee;
  3. Export (the Excel to correct): one row a deduction, the FinCom id first; TDS a live formula (Paid × Rate, to the
     paisa as the page keeps it) with its value saved, the books' TDS beside it and a Difference formula; a totals row of
     SUMs; a Summary sheet by section (COUNTIF, SUMIF on the Deductions sheet); the header row frozen; amounts #,##0.00;
  4. Import: the file with a PAN, a section and a TDS amount changed (and a bad PAN on another row) gives a preview of
     exactly those three, the bad PAN refused; nothing changes until Apply; then the table, the card's figures and
     "edited in FinCom: books ₹X" show them; the books from Tally are not changed; the Excel exported again carries them;
  5. a Rate changed in the file with no saved value for its TDS formula: the TDS is worked out as Paid × Rate, and said;
  6. the corrections are kept with the books: opened again, still there.
Runs on the React build (app/dist-test) or TDSDESK_SITE."""
import os, sys, json, base64, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD, CHALLANS
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("FIX_PORT") or 8341)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
# the file a download makes, kept as base64 (saveFile replaced)
CATCH = """() => { window.__files = []; window.saveFile = async (name, data) => { const a = new Uint8Array(await data.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); window.__files.push({name, b64: btoa(s)}); return true; }; }"""
# the last file downloaded, read with the app's own SheetJS
# the deductions-only Excel to correct (TDSEdit.toExcel), of the return's rows
QUICK = """() => { const rs = TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1'); return TDSEdit.toExcel(rs, TDSEdit.problems(rs, '2026-27', 'Q1', '26Q'), '2026-27', 'ZZ 26Q Q1 deductions'); }"""
READ = """() => { const f = window.__files[window.__files.length - 1]; const bin = atob(f.b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  window.__wb = XLSX.read(a, {type: 'array', cellFormula: true, cellNF: true}); const ws = window.__wb.Sheets.Deductions, sm = window.__wb.Sheets.Summary;
  const z = XLSX.CFB.read(a, {type: 'array'}), x = XLSX.CFB.find(z, '/xl/worksheets/sheet1.xml');
  const rows = XLSX.utils.sheet_to_json(ws, {header: 1, raw: true});
  const cell = (s, ref) => { const c = (s || {})[ref]; return c ? {v: c.v, f: c.f || '', z: c.z || ''} : null; };
  return {name: f.name, sheets: window.__wb.SheetNames, head: rows[0], n: rows.length, rows,
    frozen: /<pane[^>]*state="frozen"/.test(new TextDecoder().decode(x.content)),
    J2: cell(ws, 'J2'), L2: cell(ws, 'L2'), I2: cell(ws, 'I2'), K2: cell(ws, 'K2'), tot: rows.length, totI: cell(ws, 'I' + rows.length), totJ: cell(ws, 'J' + rows.length), totK: cell(ws, 'K' + rows.length), totL: cell(ws, 'L' + rows.length),
    sB2: cell(sm, 'B2'), sC2: cell(sm, 'C2'), sD2: cell(sm, 'D2'), sE2: cell(sm, 'E2')}; }"""
# the workbook changed as a person would in Excel; back as bytes (base64)
EDIT = """(changes) => { const ws = window.__wb.Sheets.Deductions;
  changes.forEach(([ref, v, keepF]) => { const c = ws[ref] = ws[ref] || {}; if (v === null) { delete c.v; c.t = 'n'; } else { c.v = v; c.t = typeof v === 'number' ? 'n' : 's'; if (!keepF) delete c.f; } delete c.w; });
  const out = XLSX.write(window.__wb, {bookType: 'xlsx', type: 'array'}), a = new Uint8Array(out); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }"""
RELOAD = """async () => { const cid = S.books.cid; await saveBooks(); S.books = null; await openBooks(cid);
  for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise(r => setTimeout(r, 50)); render(); return !!S.books && !S.books.loading; }"""
TABLE = """() => [...document.querySelectorAll('#tdsDnTable > tbody > tr')].map(tr => ({id: tr.querySelector('input[type=checkbox]') ? tr.querySelector('input[type=checkbox]').getAttribute('aria-label') : '',
  text: tr.innerText, pan: (tr.querySelector('[data-pan]') || {}).innerText || '', sec: (tr.querySelector('[data-sec]') || {}).innerText || '', edited: [...tr.querySelectorAll('[data-edited]')].map(e => e.title || e.innerText)}))"""

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        E, W = pg.evaluate, pg.wait_for_timeout
        pg.goto("http://localhost:%d/" % PORT); W(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); W(2000)
        E("window.__dueToday = '2026-10-11'")
        E(LOAD, books); W(1000); E("S.books = window.__bk; render();"); W(500); E(CHALLANS); W(300)
        cid = E("S.coId")
        def go(h, wait=1300):
            E("(h) => { location.hash = h; }", "#/c/%s/books/tds/%s" % (cid, h)); W(wait)
        go("2026-27/Q1/26Q/deductions"); E("() => { S.tdsDedView = 'table'; S.tdsFl = {}; render(); }"); W(400)
        rows = E("TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1').map(r => ({id: r.id, pan: r.pan, section: r.section, paid: r.paid, tds: r.tds, challan: r.challan}))")
        print("1. Needs fixing")
        # next-tds-tidy2 (the owner: "Filters should be there in columns only"): Needs fixing is a tick in the Deductee column's filter
        pg.click("#app #tdsDnTable thead [data-cf='deductions:name']"); W(200)
        chip = pg.locator("[data-cf-pop='deductions:name'] [data-cf-flag='deductions:fix']")
        ok(chip.count() == 1, "the Deductee column's filter has Needs fixing")
        flagged = E("""() => { const rs = TDS.rows().filter(r => r.fy === '2026-27' && r.q === 'Q1'), iss = new Set(Certs.issues('2026-27', 'Q1').map(x => x.row.id));
          const pay = new Set(TDS26Q.payCodeRows('2026-27', 'Q1', '26Q').map(x => x.row.id)), known = (x) => !!TDS.STD[TDS.sec(x)] || RULE_DEFAULTS.some(d => d.old && TDS.sec(d.old) === TDS.sec(x));
          return rs.filter(r => !Certs.validPan(r.pan) || Certs.inoperative(r.pan) || iss.has(r.id) || !r.challan || pay.has(r.id) || !known(r.section)).length; }""")
        all_n = pg.locator("#tdsDnTable > tbody > tr").count()
        if chip.count(): chip.check(); W(500)
        shown = pg.locator("#tdsDnTable > tbody > tr").count()
        ok(chip.count() and chip.is_checked() and shown == flagged and flagged > 0, "ticked: only the deductions with a problem the return finds (%d of %d; %d)" % (shown, all_n, flagged))
        pg.keyboard.press("Escape")
        E("() => { S.tdsFl = {}; render(); }"); W(300)

        print("2. the section's name")
        secs = E("[...document.querySelectorAll('#tdsDnTable > tbody > tr [data-sec]')].map(e => [e.innerText, e.closest('td').title || ''])")
        ok(secs and all(c and s for c, s in secs), "by deduction: each section's short code, its name on a hover (%s)" % secs[:2])
        # next-challan-match (18-Oct-2026): the deductees are a tab of their own, Deductees (PAN), with each one's sections
        pg.click("[data-ret-tab=deductees]"); W(400)
        secs = E("[...document.querySelectorAll('#tdsDeTable > tbody > tr > td:nth-child(4)')].map(e => e.innerText)")
        ok(secs and all(secs), "Deductees (PAN): each deductee's sections (%s)" % secs[:2])
        pg.click("[data-ret-tab=deductions]"); W(300)
        go("2025-26/Q2/26Q/deductions"); W(300)
        secs = E("[...document.querySelectorAll('#tdsDnTable > tbody > tr [data-sec]')].map(e => [e.innerText, e.closest('td').title || ''])")
        ok(secs and all(c and s for c, s in secs), "2025-26 too: the old section and its name (%s)" % secs[:2])
        go("2026-27/Q1/26Q/deductions"); W(300)

        print("3. the Excel to correct")
        E(CATCH)
        pg.click("#app [data-step-tool] details.more > summary"); W(200)
        items = E("[...document.querySelectorAll('#app [data-step-tool] .more-item')].map(b => b.textContent)")
        # next-tds-excel2: the step's ⋯ downloads the return's own workbook (run_tds_excel2.py) and Upload Excel takes either
        # file back; the deductions-only Excel (TDSEdit.toExcel) is still read back here, made as before
        # next-excel-buttons (27-Oct-2026): Download Excel and Upload Excel are the tab row's (the step's ⋯ no longer repeats
        # them); Upload Excel there uses this step's file box (data-ded-import), which takes either file back
        xl = E("[...document.querySelectorAll('#app [data-ret-tabrow] [data-xl-tools] [data-xl]')].map(b => b.textContent.trim())")
        ok(xl == ["Download Excel", "Upload Excel"] and not any("Excel" in i for i in items), "the tab row: Download Excel and Upload Excel; the step's ⋯ none (%s; %s)" % (xl, items))
        pg.keyboard.press("Escape"); E("document.querySelectorAll('#app details.more[open]').forEach(d => d.open = false)")
        E(QUICK); W(1500)
        x = E(READ) if E("window.__files.length") else None
        ok(x and x["sheets"] == ["Deductions", "Summary"] and x["head"][0].startswith("FinCom id") and x["n"] == len(rows) + 2, "Deductions and Summary; the FinCom id first; one row a deduction and the totals (%s)" % (x and [x["sheets"], x["head"][:3], x["n"]]))
        if x:
            ok(x["head"][7:12] == ["Rate %", "Amount paid", "TDS", "TDS in books", "Difference"] and "Needs fixing" in x["head"] and "Section name" in x["head"], "the columns: … Rate, Amount paid, TDS, TDS in books, Difference … Needs fixing (%s)" % x["head"])
            ok(x["J2"]["f"] == "IF(I2=0,K2,ROUND(I2*H2/100,2))" and abs(x["J2"]["v"] - rows[0]["tds"]) < 0.005, "TDS: a live formula, Paid × Rate to the paisa, its value saved (%s)" % x["J2"])
            ok(x["L2"]["f"] == "J2-K2" and abs(x["L2"]["v"]) < 0.005 and abs(x["K2"]["v"] - rows[0]["tds"]) < 0.005, "TDS in books beside it; Difference a formula, 0 before any change (%s %s)" % (x["K2"], x["L2"]))
            t = x["tot"]
            ok(all(c and c["f"].startswith("SUM(") for c in (x["totI"], x["totJ"], x["totK"], x["totL"])) and x["totI"]["f"] == "SUM(I2:I%d)" % (t - 1), "the totals row: SUM for Paid, TDS, TDS in books, Difference (%s)" % [c and c["f"] for c in (x["totI"], x["totJ"], x["totK"], x["totL"])])
            ok(x["sC2"] and x["sC2"]["f"].startswith("COUNTIF(Deductions!") and x["sD2"]["f"].startswith("SUMIF(Deductions!") and x["sE2"]["f"].startswith("SUMIF(Deductions!"), "Summary by section: COUNTIF and SUMIF on the Deductions sheet (%s)" % [x["sC2"], x["sD2"]])
            ok(x["frozen"] and x["I2"]["z"] == "#,##0.00" and x["J2"]["z"] == "#,##0.00", "the header row frozen; amounts #,##0.00 (%s, %s)" % (x["frozen"], x["I2"]["z"]))
            ok(x["rows"][1][0] == rows[0]["id"], "the first column is the deduction's FinCom id")

        print("4. the corrected Excel brought back")
        r1, r2_ = rows[0], rows[1]
        newpan, newsec, newtds = "AAAPZ1234C", "194J", round(r1["tds"] + 500, 2)
        b64 = E(EDIT, [["E2", newpan, False], ["F3", newsec, False], ["J2", newtds, False], ["E3", "BAD123", False]])
        pg.set_input_files("#app [data-ded-import]", files=[{"name": "corrected.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "buffer": base64.b64decode(b64)}]); W(1500)
        ch = E("[...document.querySelectorAll('#app [data-imp-changes] tbody tr')].map(tr => tr.dataset.impChange + ': ' + tr.innerText.replace(/\\s+/g, ' '))")
        ok(sorted(c.split(":")[0] for c in ch) == ["pan", "section", "tds"], "the preview: exactly the PAN, the section and the TDS changed (%s)" % ch)
        ref = E("[...document.querySelectorAll('#app [data-imp-refused] li')].map(l => l.dataset.impRefusedField + ': ' + l.innerText)")
        ok(len(ref) == 1 and ref[0].startswith("pan") and "BAD123" in ref[0], "the bad PAN refused, said (%s)" % ref)
        ok(E("TDS.rows().find(r => r.id === '%s').pan" % r1["id"]) == r1["pan"], "nothing applied before Apply")
        ok(pg.locator("#app [data-imp-apply]").inner_text() == "Apply 3 changes", "Apply 3 changes")
        pg.click("#app [data-imp-apply]"); W(800)
        tb = E(TABLE)
        row1 = next((t for t in tb if r1["pan"] in t["text"] or newpan in t["pan"]), None)
        ok(tb and tb[0]["pan"] == newpan, "the table: the new PAN under the deductee (%s)" % (tb and tb[0]["pan"]))
        ok(len(tb) > 1 and tb[1]["sec"].strip() == "194J", "the new section on the second deduction, its code (%s)" % (len(tb) > 1 and tb[1]["sec"]))
        ok(tb and any("edited in FinCom: books ₹" in e for e in tb[0]["edited"]) and E("INR.format(%s)" % newtds) in tb[0]["text"], "the new TDS, and 'edited in FinCom: books ₹…' under it (%s)" % (tb and tb[0]["edited"]))
        total = round(sum(r["tds"] for r in rows) + 500, 2)
        card = pg.inner_text("#app [data-ded-count]")   # next-tds-tidy2: no summary strip; the table's foot has the TDS
        ok(E("INR.format(%s)" % total) in card, "the table's foot: TDS %s" % total)
        ok("2 edited in FinCom" in pg.inner_text("#app [data-ded-count]"), "the count of deductions shown says it")
        ok(E("(() => { const v = S.books.vouchers.find(v => '%s'.startsWith(v.id + '|')); return JSON.stringify(v).includes('%s'); })()" % (r1["id"], newpan)) is False, "the books from Tally are not changed")
        log = E("S.books.tdsEdits['%s'].log.map(l => [l.field, !!l.by, !!l.at])" % r1["id"])
        ok(sorted(l[0] for l in log) == ["pan", "tds"] and all(l[1] and l[2] for l in log), "each change kept with who and when (%s)" % log)
        E(CATCH)
        E(QUICK); W(1500)
        y = E(READ)
        ok(y["rows"][1][4] == newpan and y["rows"][2][5] == newsec and abs(y["J2"]["v"] - newtds) < 0.005 and abs(y["K2"]["v"] - r1["tds"]) < 0.005 and abs(y["L2"]["v"] - 500) < 0.005,
           "exported again: the corrections, TDS in books as the books say, the Difference 500 (%s %s %s)" % (y["rows"][1][4], y["J2"], y["L2"]))

        print("5. a Rate changed, its TDS formula with no saved value")
        b64 = E(EDIT, [["H3", 10, False], ["J3", None, True]])
        pg.set_input_files("#app [data-ded-import]", files=[{"name": "rate.xlsx", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "buffer": base64.b64decode(b64)}]); W(1500)
        ch = E("[...document.querySelectorAll('#app [data-imp-changes] tbody tr')].map(tr => tr.dataset.impChange + ': ' + tr.innerText.replace(/\\s+/g, ' '))")
        want = round(r2_["paid"] * 10 / 100, 2)
        ok(sorted(c.split(":")[0] for c in ch) == ["rate", "tds"] and any(c.startswith("tds") and E("INR.format(%s)" % want) in c for c in ch), "the TDS worked out as Amount paid × Rate: %s (%s)" % (want, ch))
        ok("Amount paid × Rate" in pg.inner_text("#app [data-imp-notes]") if pg.locator("#app [data-imp-notes]").count() else False, "and said in the preview")
        pg.click("#app [data-imp-apply]"); W(800)
        ok(abs(E("TDS.rows().find(r => r.id === '%s').tds" % r2_["id"]) - want) < 0.005, "applied: the second deduction's TDS %s" % want)

        print("6. kept with the books")
        ok(E("BOOKS_KEYS.includes('tdsEdits')"), "tdsEdits is one of BOOKS_KEYS")
        ok(E(RELOAD), "the books opened again"); W(500)
        go("2026-27/Q1/26Q/deductions"); W(300)
        tb = E(TABLE)
        ok(tb and tb[0]["pan"] == newpan and "2 edited in FinCom" in pg.inner_text("#app [data-ded-count]"), "the corrections are still there (%s)" % (tb and tb[0]["pan"]))
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
ok(not errors, "no page errors (%s)" % errors[:3])
srv.shutdown()
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
