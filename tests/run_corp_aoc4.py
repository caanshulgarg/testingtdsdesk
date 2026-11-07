"""python3 run_corp_aoc4.py - Corporate › e-Forms › AOC-4, phase 1 stage 5 (07-Nov-2026; the design "3 · AOC-4 prepared from
the balance sheet and P&L"). On the made-up books of tests/fixtures/fin-statements/company.json (as run_fin_statements_ui.py:
total assets 85,87,800.55, revenue 1,22,00,000 for FY 2025-26; a made-up company, no real client):
  1. opened from e-Forms (AOC-4 › Open the AOC-4 builder), in its own file (Aoc4-*.js, with the statements' model);
  2. From FinCom Books: every balance sheet and P&L line in AOC-4's order equals the Financial statements page's figure
     (FinSt.build, rupees), both years; the totals; the source of each ("Books · n ledgers");
  3. the checks: the balance sheet tallies; profit and the movement in reserves (said either way, with the difference);
     the previous year against the AOC-4 filed for FY 2024-25 (none kept: said; kept and equal: ✓; different: named);
     the UDIN not entered;
  4. a figure edited (trade payables): the totals and the tally check follow; its reason kept; back to the source's figure;
  5. the steps: Next: attachments; the attachments each Ready / Not applicable; Ready for MCA: e-Forms says Ready to file;
  6. the sheet "figures in MCA order": CSV (the form's order, both years, the source), Excel (the same cells), PDF (the
     print view);
  7. Upload balance sheet & P&L: a CSV's lines mapped to the heads by their words (a total row left out), the mapping
     changed by hand; a PDF: "coming in phase 2", nothing read;
  8. kept after a reload, from the firm's copy (a stand-in: tests/corp_fake_cloud.py): the AOC-4's row in corp_filings
     carries the builder's data.
RED before stage 5. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_corp_aoc4.py"""
import os, re, io, sys, csv, json, subprocess, threading, functools, http.server
import openpyxl
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from corp_fake_cloud import INSTALL
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = os.environ.get("TDSDESK_SHOTS", os.path.join(HERE, "out", "corp-shots")); os.makedirs(SHOTS, exist_ok=True)
PORT = int(os.environ.get("CORP_PORT") or 8725)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

# the books FinCom would hold for the fixture (the same as run_fin_statements_ui.py makes them)
BOOKS = json.loads(subprocess.check_output(["node", "-e", r"""
const F = require('./fixtures/fin-statements/company.json'), from = '20240401';
const under = Object.assign({}, F.groups), led = {};
Object.entries(F.o).forEach(([n, v]) => { led[n] = {open: -v, close: 0, parent: under[n]}; });
const vouchers = [], bank = Object.keys(under).find(n => under[n] === 'Bank Accounts'), shift = e => String(Number(e.slice(0, 4)) - 1) + e.slice(4);
(F.additions || []).forEach(([l, d, a], i) => vouchers.push({id: 'a' + i, date: d, no: 'A' + i, type: 'Journal', narr: 'Purchase of ' + l, ent: [{l, a: -a}, {l: bank, a}]}));
[['20250331', F.p, F.plp, F.o], ['20260331', F.c, F.plc, F.p]].forEach(([end, bs, pl, prev]) => {
  const ent = [];
  Object.keys(bs).forEach(n => { if (n === bank) return; const added = (F.additions || []).filter(([l, d]) => l === n && d <= end && d > shift(end)).reduce((s, z) => s + z[2], 0);
    const mv = Math.round(((bs[n] || 0) - (prev[n] || 0) - added) * 100) / 100; if (mv) ent.push({l: n, a: -mv}); });
  Object.entries(pl).forEach(([n, v]) => { if (v) ent.push({l: n, a: -v}); });
  ent.push({l: bank, a: Math.round(-ent.reduce((s, e) => s + e.a, 0) * 100) / 100});
  vouchers.push({id: 'm' + end, date: end, no: 'M' + end, type: 'Journal', narr: 'Movements for the year (fixture)', ent});
});
process.stdout.write(JSON.stringify({under, groups: {}, vouchers, meta: {from, to: '20260331'}, tb: {from, to: '20260331', at: '2026-04-30T10:00:00Z', src: 'copy', led}}));
"""], cwd=HERE))
OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
SETUP = """(bk) => {
  const c = newCompany({name: "Larkspur Analytics Private Limited (made-up)", gstin: "29AABCL1234F1Z5"}); c.pan = "AABCL1234F"; c.cin = "U72900KA2015PTC000001";
  S.companies[c.id] = c; Store.saveCompany(c); S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const b = Object.assign({loading: false, cid: c.id, challans: [], alloc: {}, ledInfo: {}, gstins: {}, pans: {}, states: {}, misCfg: {freq: "off"}, auditCfg: {freq: "off"},
    msme: {"Bluebell Print Works": "Micro"}, fs: {taxDep: {"2024": {c40: 220000, pm15: 140000, f10: 80000}}}}, bk);
  b.map = Books.mapLedgers(b.vouchers, {});
  S.books = b; window.__bk = b; saveBooks(); S.booksTab = "dash"; render(); return c.id; }"""
LINES = """() => { const d = FinSt.build('2025', {unit: 1, dec: 2}), o = {};
  Object.values(d.bs.sections).forEach(s => s.lines.forEach(z => { o[z.id] = [z.cy, z.py]; }));
  ['rev','oth','mat','pur','chg','emp','fin','dep','exp','exc','pbt','pat'].forEach(k => { o['pl:' + k] = [d.pl[k].cy, d.pl[k].py]; });
  o.eqL = [d.bs.total.eqL.cy, d.bs.total.eqL.py]; o.assets = [d.bs.total.assets.cy, d.bs.total.assets.py]; return o; }"""
def num(s):
    s = (s or "").strip().replace(",", "")
    if s in ("", "-"): return 0.0
    neg = s.startswith("(") and s.endswith(")")
    return -float(s.strip("()")) if neg else float(s)
def cells(pg, table, key):
    v = pg.evaluate("([t, k]) => [...document.querySelectorAll('#app [data-aoc4-table=' + t + '] tr[data-aoc4-line=' + k + '] input')].map(e => e.value)", [table, key])
    return [num(x) for x in v]
def total(pg, table, k):
    v = pg.evaluate("([t, k]) => [...document.querySelectorAll('#app [data-aoc4-table=' + t + '] tr[data-aoc4-total=' + k + '] td')].map(e => e.innerText)", [table, k])
    return [num(v[1]), num(v[2])] if len(v) >= 3 else None
def check(pg, k): return pg.evaluate("(k) => { const e = document.querySelector('#app [data-aoc4-checks] [data-check=' + k + ']'); return e ? [e.dataset.ok, e.innerText] : null; }", k)

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200])); pg.on("dialog", lambda d: d.accept())
    files = []; pg.on("request", lambda r: files.append(r.url))
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(1200)
    E("() => localStorage.removeItem('__corp_fake_rows')"); E(INSTALL)   # Corporate needs the firm account (a stand-in)
    co = E(SETUP, BOOKS); W(1200); E("S.books = window.__bk; render();"); W(600)

    print("1. from e-Forms")
    E("() => goClient('books:corp-forms')"); W(1800)
    E("(cid) => { FCCorp.saveProfile(cid, {agms: {'2025-26': '2026-09-25'}, auditor: 'Made-up & Associates', auditorFrn: '000000S'}); S.corpFy = '2025-26'; render(); }", co); W(500)
    pg.click("#app [data-form-open='annual:AOC-4:2025-26']"); W(400)
    pg.click("#app [data-form-detail] [data-open-aoc4]"); W(2500)
    ok(E("booksTab()") == "corp-aoc4" and E("!!document.querySelector('#app [data-corp-page=aoc4]')"), "the AOC-4 builder opens (%s)" % E("booksTab()"))
    ok(any("/Aoc4-" in u for u in files), "in its own file (%s)" % [u.rsplit("/", 1)[-1] for u in files if "Aoc4" in u][:2])
    W(1500)

    print("2. From FinCom Books, in AOC-4's order")
    want = E(LINES)
    for k in ["sc", "rs", "ltb", "dtl", "ltp", "stb", "tpm", "tpo", "ocl", "stp", "ppe", "intang", "nci", "ltla", "inv", "tr", "cash", "stla", "oca"]:
        got = cells(pg, "bs", k)
        ok(got and abs(got[0] - (want[k][0] or 0)) < 0.006 and abs(got[1] - (want[k][1] or 0)) < 0.006, "%s: %s = the statements' %s" % (k, got, want[k]))
    ok(total(pg, "bs", "TA") == [round(want["assets"][0], 2), round(want["assets"][1], 2)] and total(pg, "bs", "TA")[0] == 8587800.55, "total assets 85,87,800.55 (%s)" % total(pg, "bs", "TA"))
    ok(total(pg, "bs", "TL") == total(pg, "bs", "TA"), "total equity and liabilities = total assets")
    order = E("[...document.querySelectorAll('#app [data-aoc4-table=bs] tr[data-aoc4-line]')].map(r => r.dataset.aoc4Line)")
    ok(order[:4] == ["sc", "rs", "msw", "sapp"] and order.index("ltb") < order.index("stb") < order.index("ppe") < order.index("ci") < order.index("oca"), "the form's order (%s)" % order)
    src = E("document.querySelector('#app [data-aoc4-table=bs] tr[data-aoc4-line=tr] td:last-child').innerText")
    ok(re.match(r"Books · \d+ ledgers?", src) is not None, "the source of each line (%s)" % src)
    pg.click("#app [data-aoc4-tab=pl]"); W(400)
    for k in ["rev", "oth", "emp", "fin", "dep", "exp"]:
        got = cells(pg, "pl", k)
        ok(got and abs(got[0] - want["pl:" + k][0]) < 0.006 and abs(got[1] - (want["pl:" + k][1] or 0)) < 0.006, "P&L %s: %s = %s" % (k, got, want["pl:" + k]))
    ok(cells(pg, "pl", "rev")[0] == 12200000 and abs(total(pg, "pl", "PAT")[0] - want["pl:pat"][0]) < 0.006 and abs(total(pg, "pl", "PBT")[0] - want["pl:pbt"][0]) < 0.006, "revenue 1,22,00,000; profit before and after tax as the statements (%s)" % total(pg, "pl", "PAT"))
    pg.click("#app [data-aoc4-tab=bs]"); W(300)

    print("3. the checks")
    ok(check(pg, "bs")[0] == "yes", "the balance sheet tallies (%s)" % check(pg, "bs"))
    r = check(pg, "reserves")
    ok(r and (r[0] == "yes" and "matches" in r[1] or r[0] == "no" and "difference" in r[1]), "profit and the movement in reserves: said (%s)" % r)
    ok(check(pg, "py")[0] == "na" and "FY 2024-25" in check(pg, "py")[1], "the previous year: no AOC-4 of FY 2024-25 kept (%s)" % check(pg, "py"))
    ok(check(pg, "udin") and check(pg, "udin")[0] == "no", "the UDIN not entered yet")
    # the previous year's figures as the builder shows them, both statements (each tab draws its own inputs)
    PYF = """(cid) => { const o = {}; document.querySelectorAll('#app [data-aoc4-input]').forEach(e => { const [k, c] = e.dataset.aoc4Input.split(':'); if (c === 'py') o[k] = +(e.value.replace(/,/g, '').replace(/^\\((.*)\\)$/, '-$1').replace(/^-$/, '0')); }); return o; }"""
    pyf = E(PYF, co); pg.click("#app [data-aoc4-tab=pl]"); W(400); pyf.update(E(PYF, co)); pg.click("#app [data-aoc4-tab=bs]"); W(400)
    E("([cid, f]) => { FCCorp.saveFiling(cid, {ref: 'annual:AOC-4:2024-25', form: 'AOC-4', kind: 'annual', period: '2024-25', status: 'filed', srn: 'AB1112223', filedOn: '2025-10-20', steps: 4, data: {figures: f}}); render(); }", [co, pyf]); W(600)
    ok(check(pg, "py")[0] == "yes", "kept and equal: ✓ (%s)" % check(pg, "py"))
    E("([cid, f]) => { f.sc = (f.sc || 0) + 1000; FCCorp.saveFiling(cid, {ref: 'annual:AOC-4:2024-25', form: 'AOC-4', kind: 'annual', period: '2024-25', status: 'filed', srn: 'AB1112223', filedOn: '2025-10-20', steps: 4, data: {figures: f}}); render(); }", [co, pyf]); W(600)
    ok(check(pg, "py")[0] == "no" and "Share capital" in check(pg, "py")[1], "different: the line named (%s)" % check(pg, "py"))
    pg.click("#app [data-aoc4-tab=co]"); W(300); pg.fill("#app [data-aoc4-detail=udin]", "26000001AAAAAA1111"); pg.press("#app [data-aoc4-detail=udin]", "Tab"); W(400); pg.click("#app [data-aoc4-tab=bs]"); W(300)
    ok((check(pg, "udin") or [""])[0] == "yes", "the UDIN entered, 18 characters: checked (%s)" % check(pg, "udin"))
    pg.click("#app [data-aoc4-tab=co]"); W(300); pg.fill("#app [data-aoc4-detail=udin]", "2600AB"); pg.press("#app [data-aoc4-detail=udin]", "Tab"); W(400); pg.click("#app [data-aoc4-tab=bs]"); W(300)
    ok((check(pg, "udin") or [""])[0] == "no" and "18 characters" in check(pg, "udin")[1], "a UDIN of the wrong shape: said")
    pg.click("#app [data-aoc4-tab=co]"); W(300); pg.fill("#app [data-aoc4-detail=udin]", "26000001AAAAAA1111"); pg.press("#app [data-aoc4-detail=udin]", "Tab"); W(400); pg.click("#app [data-aoc4-tab=bs]"); W(300)

    print("4. a figure edited")
    tp = cells(pg, "bs", "tpo")[0]
    pg.fill("#app [data-aoc4-input='tpo:cy']", "%.2f" % (tp + 5000)); pg.press("#app [data-aoc4-input='tpo:cy']", "Tab"); W(500)
    ok(total(pg, "bs", "TL")[0] == round(want["eqL"][0] + 5000, 2) and check(pg, "bs")[0] == "no" and "5,000" in check(pg, "bs")[1], "the totals and the tally check follow (%s)" % check(pg, "bs"))
    ok(E("document.querySelector('#app [data-aoc4-next]').disabled") and "Give the reason" in E("(document.querySelector('#app [data-aoc4-hold]') || {}).innerText || ''"), "a figure changed without its reason: Next held back")
    pg.fill("#app [data-aoc4-why=tpo]", "a bill booked after the books closed (made-up)"); pg.press("#app [data-aoc4-why=tpo]", "Tab"); W(400)
    ok("edited: a bill booked after" in E("document.querySelector('#app tr[data-aoc4-line=tpo] td:last-child').innerText"), "its reason shown with the source")
    pg.click("#app [data-aoc4-undo=tpo]"); W(500)
    ok(cells(pg, "bs", "tpo")[0] == tp and check(pg, "bs")[0] == "yes", "back to the source's figure: tallies again")

    print("5. the steps")
    pg.click("#app [data-aoc4-next]"); W(500)
    ok(E("!!document.querySelector('#app [data-aoc4-step=\"1\"][data-done]')") and E("document.querySelector('#app [data-aoc4-step=\"2\"]').getAttribute('aria-current')") == "step", "Next: the figures done, on to attachments")
    keys = E("[...document.querySelectorAll('#app [data-attach-state]')].map(e => e.dataset.attachState)")
    for i, k in enumerate(keys): pg.select_option("#app [data-attach-state='%s']" % k, "ready" if i < 3 else "na"); W(150)
    W(300)
    pg.click("#app [data-aoc4-ready]"); W(1500)
    ok(E("booksTab()") == "corp-forms" and "Ready to file" in E("document.querySelector('#app tr[data-form-ref=\"annual:AOC-4:2025-26\"]').innerText"), "Ready for MCA: e-Forms says Ready to file")
    E("() => goClient('books:corp-aoc4')"); W(1500)

    print("6. the sheet in MCA order")
    with pg.expect_download(timeout=20000) as dl:
        pg.click("#app [data-aoc4-csv]")
    p_csv = os.path.join(SHOTS, "aoc4.csv"); dl.value.save_as(p_csv)
    rows = list(csv.reader(io.StringIO(open(p_csv, encoding="utf-8-sig").read())))
    labels = [r[0].strip() for r in rows if r]
    ok(rows[0][0] == "Form AOC-4: figures in the order of the form" and labels.index("Share capital") < labels.index("Reserves and surplus") < labels.index("Long-term borrowings") < labels.index("Total assets") < labels.index("Revenue from operations"), "CSV: the form's order")
    sc = next(r for r in rows if r and r[0].strip() == "Share capital")
    ok(abs(float(sc[1]) - want["sc"][0]) < 0.006 and abs(float(sc[2]) - want["sc"][1]) < 0.006 and sc[3].startswith("Books"), "CSV: both years and the source (%s)" % sc)
    with pg.expect_download(timeout=30000) as dl:
        pg.click("#app [data-aoc4-xlsx]")
    p_x = os.path.join(SHOTS, "aoc4.xlsx"); dl.value.save_as(p_x)
    ws = openpyxl.load_workbook(p_x).active
    xl = {str(r[0]).strip(): r for r in ws.iter_rows(values_only=True) if r and r[0]}
    ok("Total assets" in xl and abs(float(xl["Total assets"][1]) - 8587800.55) < 0.006 and abs(float(xl["Share capital"][1]) - want["sc"][0]) < 0.006, "Excel: the same cells (total assets %s)" % (xl.get("Total assets") or [None, None])[1])
    with ctx.expect_page(timeout=15000) as pop:
        pg.click("#app [data-aoc4-pdf]")
    pw = pop.value; pw.wait_for_load_state(); W(400)
    ok(pw.evaluate("!!document.querySelector('[data-aoc4-print]')") and "Total equity and liabilities" in pw.evaluate("document.body.innerText") and "85,87,800.55" in pw.evaluate("document.body.innerText"), "PDF: the print view of the sheet")
    pw.close()
    pg.screenshot(path=os.path.join(SHOTS, "aoc4-1440.png"), full_page=True)

    print("7. Upload balance sheet & P&L")
    pg.click("#app [data-aoc4-src=upload]"); W(500)
    up = "\n".join(["Particulars,31-03-2026,31-03-2025", "Share capital,100000,100000", "Reserves and surplus,250000,150000", "Trade payables,80000,60000", "Total,430000,310000",
                    "Property plant and equipment,200000,180000", "Trade receivables,130000,90000", "Cash and bank balances,100000,40000", "Revenue from operations,900000,700000", "Other expenses,800000,640000"])
    pg.set_input_files("#app [data-aoc4-file]", files=[{"name": "audited-bs.csv", "mimeType": "text/csv", "buffer": up.encode()}]); W(1500)
    ok(cells(pg, "bs", "sc") == [100000.0, 100000.0] and cells(pg, "bs", "rs") == [250000.0, 150000.0] and cells(pg, "bs", "cash") == [100000.0, 40000.0], "the CSV's lines mapped by their words (%s)" % cells(pg, "bs", "cash"))
    ok(E("document.querySelector('#app [data-upload-head=\"4\"]').value") == "-", "the total row left out (Not used)")
    ok(E("document.querySelectorAll('#app [data-upload-guessed]').length") >= 8, "every head guessed from the words marked: check the head")
    ok((check(pg, "total0") or ["", ""])[0] == "yes", "the file's own total equals the one worked out (%s)" % check(pg, "total0"))
    ok(total(pg, "bs", "TL")[0] == 430000 and total(pg, "bs", "TA")[0] == 430000 and "Upload · Trade payables" in E("document.querySelector('#app tr[data-aoc4-line=tpo] td:last-child').innerText"), "totals and the source from the upload")
    # the lines were all mapped by their words, so the mapping is folded: opened to change one
    E("() => { const d = document.querySelector('#app [data-aoc4-mapping]'); if (d) d.open = true; }"); W(300)
    pg.select_option("#app [data-upload-head='3']", "tpm"); W(500)
    ok(not E("!!document.querySelector('#app [data-upload-guessed=\"3\"]')"), "a head chosen by hand: no longer marked")
    ok(E("(cid) => FCCorp.corpOf(cid).filings.find(x => x.ref === 'annual:AOC-4:2025-26').status", co) == "in_progress", "a head changed after Ready: in progress again")
    ok(E("!!document.querySelector('#app [data-aoc4-heads-ok]')"), "the heads guessed: one tick to say they are checked")
    pg.select_option("#app [data-upload-head='5']", ""); W(500)
    un = E("(document.querySelector('#app [data-aoc4-unmapped]') || {}).innerText || ''")
    ok("Not in any head: 1 line, ₹2,00,000.00" in un and "Property plant and equipment" in un and (check(pg, "unmapped") or [""])[0] == "no", "a line in no head: listed with its amount (%s)" % un[:80])
    pg.select_option("#app [data-upload-head='5']", "ppe"); W(500)
    ok(cells(pg, "bs", "tpm")[0] == 80000 and cells(pg, "bs", "tpo")[0] == 0, "the mapping changed by hand: trade payables to micro and small")
    pg.set_input_files("#app [data-aoc4-file]", files=[{"name": "audited.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4 made-up"}]); W(800)
    ok("phase 2" in (E("(document.querySelector('#app [data-aoc4-error]') || {}).innerText") or "") and cells(pg, "bs", "sc") == [100000.0, 100000.0], "a PDF: coming in phase 2, nothing read")

    print("8. kept")
    W(1500)
    pend = E("(cid) => Object.keys(FCCorp.corpOf(cid).pending)", co)
    ok(not pend, "everything saved (%s)" % pend)
    row = E("(cid) => __fake.rows.corp_filings.find(r => r.client_id === cid && r.form === 'AOC-4' && r.period === '2025-26')", co)
    ok(row and row.get("data") and json.dumps(row["data"]).find("tpm") >= 0, "the firm's copy: the AOC-4's row with the builder's data (%s)" % (json.dumps(row)[:200] if row else None))
    E("() => __fake.restore()")
    pg.reload(); W(3500); E(OPEN); W(1200); E(INSTALL); W(2500)
    ok(E("!!document.querySelector('#app [data-corp-page=aoc4]')") and cells(pg, "bs", "tpm")[0] == 80000, "after a reload: the builder, the upload and its mapping")

    print("9. a filed AOC-4: its saved figures, never worked out again")
    E("(cid) => { const f = FCCorp.corpOf(cid).filings.find(x => x.ref === 'annual:AOC-4:2025-26'); FCCorp.saveFiling(cid, Object.assign({}, f, {status: 'filed', srn: 'AB1234567', filedOn: '2026-10-20', data: Object.assign({}, f.data, {figures: Object.assign({}, f.data.figures, {sc: 777})})})); render(); }", co); W(1500)
    ok(cells(pg, "bs", "sc")[0] == 777 and not E("!!document.querySelector('#app [data-aoc4-save]')"), "the figures as saved (share capital 777), no Save draft")
    with pg.expect_download(timeout=20000) as dl:
        pg.click("#app [data-aoc4-csv]")
    p2 = os.path.join(SHOTS, "aoc4-filed.csv"); dl.value.save_as(p2)
    rows2 = list(csv.reader(io.StringIO(open(p2, encoding="utf-8-sig").read())))
    sc2 = next(r for r in rows2 if r and r[0].strip() == "Share capital")
    ok(float(sc2[1]) == 777 and E("(cid) => FCCorp.corpOf(cid).filings.find(x => x.ref === 'annual:AOC-4:2025-26').data.figures.sc", co) == 777, "its download: the saved figures; nothing stamped over them")
    ctx.close(); br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
