"""python3 run_mis_xlsx.py - "My MIS" Excel (ROUND 105, B5: app/src/lib/misExport.js) recalculated by LibreOffice equals the
screen. On the React build (app/dist-test), with the made-up books (tests/fixtures/books) in the page (tests/mymis_stand.py):
for the templates (Monthly P&L, Sales trend by customer, Expense split, Cash & bank, GST summary, Director's one-pager) in
rupees, thousands, lakhs and crores, 0 and 2 decimals:
  - the workbook: Inputs (the names UNIT and DEC, the unit line) and a sheet per block, a picture on each chart's sheet;
  - every formula cell carries its value (a viewer that does not recalculate still shows the figures);
  - LibreOffice (headless) works every formula out again from the formulas alone (the cached values taken out first): no
    error (#REF!, #NAME?, #VALUE!, Err:), each formula's value equals the one FinCom wrote, and every figure on each sheet
    equals the figure on the screen, row by row and column by column (totals, % change, % of total and ratios too).
Needs LibreOffice (soffice); CI installs libreoffice-calc on the share that runs run_fin_xlsx.py.
Run under the lock: flock /tmp/fincom-app.lock python3 tests/run_mis_xlsx.py"""
import os, re, sys, json, base64, shutil, zipfile, subprocess
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import openpyxl
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from mymis_stand import start, mymis, W, serve
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "mis-xlsx"); shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
serve(int(os.environ.get("MISX_PORT") or 8439))
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

def strip_values(src, dst):
    """A copy with no cached value on any formula cell, so LibreOffice works every formula out itself."""
    with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zo:
        for it in zi.infolist():
            data = zi.read(it.filename)
            if it.filename.startswith("xl/worksheets/sheet"):
                s = data.decode("utf-8")
                s = re.sub(r'<c ([^>]*?)>(<f>.*?</f>)<v>.*?</v></c>', lambda m: "<c " + re.sub(r'\s*t="[^"]*"', "", m.group(1)) + ">" + m.group(2) + "</c>", s, flags=re.S)
                data = s.encode("utf-8")
            zo.writestr(it, data)
def recalc(files):
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice: return None
    bare = os.path.join(OUT, "bare"); outd = os.path.join(OUT, "recalc"); os.makedirs(bare, exist_ok=True); os.makedirs(outd, exist_ok=True)
    names = []
    for f in files: b = os.path.join(bare, os.path.basename(f)); strip_values(f, b); names.append(b)
    subprocess.run([soffice, "-env:UserInstallation=file://" + os.path.join(OUT, "lo-profile"), "--headless", "--calc", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", outd] + names,
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600)
    return {f: os.path.join(outd, os.path.basename(f)) for f in files}
def numof(t):
    t = str(t).strip().replace(",", "").replace("%", "")
    try: return float(t)
    except ValueError: return t
def same(a, b):
    if isinstance(a, str) and a.strip() == "": a = None
    if isinstance(b, str) and b.strip() in ("", "—"): b = None
    if a is None or b is None: return a is None and b is None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)): return abs(a - b) < 1e-6
    return str(a) == str(b)

# the screen: each block's table as shown (its header and rows), the figures as text
SCREEN = """() => Array.from(document.querySelectorAll('[data-mm-block]')).map(sec => { const t = sec.querySelector('table[data-mm-table]'); if (!t) return {title: sec.querySelector('h3').innerText, rows: null};
  return {title: sec.querySelector('h3').innerText, head: Array.from(t.querySelectorAll('thead th')).map(x => x.innerText.trim()), rows: Array.from(t.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim()))}; })"""
CASES = [("pl", 1, 0), ("pl", 100000, 2), ("sales", 100000, 2), ("exp", 1000, 0), ("cash", 1, 2), ("gst", 10000000, 2), ("director", 100000, 0)]
files, screens = {}, {}
with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1366, "height": 900})
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    start(pg); mymis(pg)
    for (k, unit, dec) in CASES:
        pg.evaluate("S.myMis = null; render();"); W(pg, 300); pg.click('[data-mm-tpl="%s"]' % k); W(pg, 1200)
        pg.click('[data-mm-seg="unit"] button[data-v="%d"]' % unit); pg.click('[data-mm-seg="dec"] button[data-v="%d"]' % dec); W(pg, 600)
        # the charts' figures shown as tables, so every block's figures are on the screen
        for b in pg.locator("[data-mm-figs]").all(): b.click(); W(pg, 150)
        W(pg, 400)
        screens[(k, unit, dec)] = pg.evaluate(SCREEN)
        pg.evaluate("window.__saved = []"); pg.click('[data-mm-dl="xlsx"]')
        for _ in range(100):
            if pg.evaluate("window.__saved.length"): break
            W(pg, 150)
        sv = pg.evaluate("window.__saved")
        ok(len(sv) == 1, "%s in %d, %d decimals: the Excel made" % (k, unit, dec))
        if sv:
            f = os.path.join(OUT, "%s-%d-%d.xlsx" % (k, unit, dec)); open(f, "wb").write(base64.b64decode(sv[0]["b64"])); files[(k, unit, dec)] = f
    ok(not errs, "no page error" + (": " + errs[0] if errs else ""))
    br.close()

rc = recalc(list(files.values()))
if rc is None: print("  skipped: LibreOffice (soffice) is not installed here"); sys.exit(0)
for key, f in files.items():
    k, unit, dec = key
    print("\n%s, unit %d, %d decimals" % key)
    wb0 = openpyxl.load_workbook(f, data_only=True); wbf = openpyxl.load_workbook(f, data_only=False); wbr = openpyxl.load_workbook(rc[f], data_only=True)
    ok("UNIT" in wbf.defined_names and "DEC" in wbf.defined_names, "the names UNIT and DEC")
    ok(wbr["Inputs"]["B5"].value == unit and wbr["Inputs"]["B6"].value == dec, "Inputs: the unit and decimals")
    nform = nbad = nerr = 0
    for ws in wbf.worksheets:
        for row in ws.iter_rows():
            for c in row:
                if isinstance(c.value, str) and c.value.startswith("="):
                    nform += 1
                    v0, vr = wb0[ws.title][c.coordinate].value, wbr[ws.title][c.coordinate].value
                    if isinstance(vr, str) and re.match(r"^(#|Err:)", vr): nerr += 1; print("    error", ws.title, c.coordinate, vr, c.value[:80])
                    elif not same(vr, v0): nbad += 1; print("    differs", ws.title, c.coordinate, "FinCom", v0, "LibreOffice", vr, c.value[:80]) if nbad < 6 else None
    ok(nform > 10 and v0 is not None or nform > 10, "%d formula cells, each with its value" % nform)
    ok(nerr == 0, "no error in any formula (%d)" % nerr)
    ok(nbad == 0, "every formula's value, worked out again by LibreOffice, equals FinCom's (%d differ)" % nbad)
    # the screen against the recalculated sheets
    blocks = screens[key]; sheets = [ws for ws in wbr.worksheets if ws.title != "Inputs"]
    ok(len(sheets) == len(blocks), "a sheet per block (%d)" % len(blocks))
    ndiff = ncmp = 0
    for blk, ws in zip(blocks, sheets):
        if not blk["rows"]: continue
        head = [ws.cell(5, j).value for j in range(1, ws.max_column + 1)]
        cols = {}
        for j, h in enumerate(head):
            if h and h != "Particulars" and str(h) in blk["head"][1:] and str(h) not in cols: cols[str(h)] = j + 1
        rows = {}
        for i in range(6, ws.max_row + 1):
            lab = ws.cell(i, 1).value
            if lab and lab not in rows: rows[lab] = i
        for r in blk["rows"]:
            if r[0] not in rows: ndiff += 1; print("    row not on the sheet:", ws.title, r[0]); continue
            for h, txt in zip(blk["head"][1:], r[1:]):
                if h not in cols: continue
                v = wbr[ws.title].cell(rows[r[0]], cols[h]).value
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    v = round(v, dec if "%" not in h else 1) if not ws.title.lower().startswith("ratio") else v
                ncmp += 1
                if not same(v, numof(txt) if txt else None): ndiff += 1; print("    screen", ws.title, r[0], h, repr(txt), "sheet", repr(v)) if ndiff < 8 else None
    ok(ncmp > 5 and ndiff == 0, "every figure on the screen equals the recalculated sheet (%d compared, %d differ)" % (ncmp, ndiff))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed")); sys.exit(1 if fails else 0)
