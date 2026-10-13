"""python3 run_reports_dcf.py - Step 3: the DCF valuation (FSX.dcf / dcfExcel / dcfWord, src/js/78-reports.js) on the made-up
company of tests/reports_fixtures.js. Test data only.
  1. the history comes from the books (the Schedule III statements of each year)
  2. without the assumptions it refuses, naming each one missing: FinCom never assumes
  3. the Excel, recalculated independently (LibreOffice headless when installed, else the Python evaluator in
     reports_recalc.py; every cached value is removed first), equals the values worked out by hand here: revenue, EBITDA,
     FCFF, the discount factors, the terminal value, enterprise and equity value, value per share, and the WACC x g grid
  4. FCFE as well (cost of equity, net borrowing)
  5. the Word draft says it must be issued by a registered valuer / merchant banker"""
import os, sys, json, subprocess, zipfile, re
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import reports_recalc as RC
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

FCFF = {"years": 5, "revGrowth": [12, 10, 9, 8, 7], "ebitdaMargin": [14, 14.5, 15, 15, 15], "depPct": 3, "capexPct": 4, "nwcPct": 18, "taxRate": 25, "tg": 5, "shares": 120000,
        "valuationDate": "2026-03-31", "method": "FCFF", "rf": 7, "beta": 1.2, "erp": 6, "kd": 10, "de": 0.5, "netDebt": 900000}
FCFE = {"years": 3, "revGrowth": [10, 10, 10], "ebitdaMargin": [15, 15, 15], "depPct": 3, "capexPct": 4, "nwcPct": 18, "taxRate": 25, "tg": 4, "shares": 120000,
        "valuationDate": "2026-03-31", "method": "FCFE", "ke": 16, "netBorrowing": [50000, 0, -50000], "interestPct": 1.5}
JS = r"""
const F = require('./reports_fixtures'), X = F.loadFSX(), fs = require('fs'), [out, a1, a2] = process.argv.slice(1);
const fx = F.company(), r = X.run(Object.assign({}, fx, {mapStore: F.confirmed(X, fx)})), hist = X.histFrom([r.model], {withPy: true});
const res = {hist, missing: X.dcf(hist, {years: 5, method: 'FCFF'})};
[[a1, 'fcff'], [a2, 'fcfe']].forEach(([A, k]) => { const d = X.dcf(hist, JSON.parse(A)); res[k] = {perShare: d.perShare, ev: d.ev, equity: d.equity, rate: d.rate, grid: d.grid, error: d.error};
  if (!d.error){ fs.writeFileSync(out + '/reports-dcf-' + k + '.xlsx', X.dcfExcel(d, fx.entity)); fs.writeFileSync(out + '/reports-dcf-' + k + '.docx', X.dcfWord(d, fx.entity)); } });
process.stdout.write(JSON.stringify(res));
"""
res = json.loads(subprocess.check_output(["node", "-e", JS, OUT, json.dumps(FCFF), json.dumps(FCFE)], cwd=HERE))
hist = res["hist"]
# 1
ok(len(hist) == 2 and hist[-1]["fy"] == "2025" and hist[-1]["rev"] == 6300000 and hist[0]["rev"] == 5400000, "1. history from the books: %s, revenue %s" % (", ".join(h["fy"] for h in hist), ", ".join("{:,.0f}".format(h["rev"]) for h in hist)))
# 2
miss = res["missing"]
ok(miss.get("error") and "never assumes" in miss["error"] and len(miss["missing"]) >= 8 and "Tax rate (%)" in miss["missing"], "2. without the assumptions: refused, naming %d missing" % len(miss.get("missing", [])))

def hand(h, A):
    """The DCF worked out by hand, from the last year of history and the assumptions."""
    n, t, g = A["years"], A["taxRate"] / 100, A["tg"] / 100
    fcfe = A["method"] == "FCFE"
    if fcfe:
        rate = A["ke"] / 100
    else:
        ke = (A["rf"] + A["beta"] * A["erp"]) / 100
        we, wd = 1 / (1 + A["de"]), A["de"] / (1 + A["de"])
        rate = we * ke + wd * A["kd"] / 100 * (1 - t)
    rev, nwc0, cfs = h["rev"], h["nwc"], []
    for i in range(n):
        rev = rev * (1 + A["revGrowth"][i] / 100)
        ebitda = rev * A["ebitdaMargin"][i] / 100
        dep = rev * A["depPct"] / 100
        ebit = ebitda - dep
        nopat = ebit * (1 - t)
        nwc = rev * A["nwcPct"] / 100
        fcff = nopat + dep - rev * A["capexPct"] / 100 - (nwc - nwc0)
        nwc0 = nwc
        cf = fcff - (rev * A["interestPct"] / 100) * (1 - t) + A["netBorrowing"][i] if fcfe else fcff
        cfs.append(cf)
    pv = sum(cf / (1 + rate) ** (i + 1) for i, cf in enumerate(cfs))
    tv = cfs[-1] * (1 + g) / (rate - g)
    ev = pv + tv / (1 + rate) ** n
    eq = ev if fcfe else ev - A["netDebt"]
    grid = [[(sum(cf / (1 + w) ** (i + 1) for i, cf in enumerate(cfs)) + cfs[-1] * (1 + gg) / (w - gg) / (1 + w) ** n - (0 if fcfe else A["netDebt"])) / A["shares"]
             for gg in [g - 0.01, g - 0.005, g, g + 0.005, g + 0.01]] for w in [rate - 0.02, rate - 0.01, rate, rate + 0.01, rate + 0.02]]
    return {"rate": rate, "cfs": cfs, "tv": tv, "ev": ev, "eq": eq, "ps": eq / A["shares"], "grid": grid}

for key, A in (("fcff", FCFF), ("fcfe", FCFE)):
    H = hand(hist[-1], A)
    path = os.path.join(OUT, "reports-dcf-%s.xlsx" % key)
    import openpyxl
    names = {n: d.attr_text for n, d in openpyxl.load_workbook(path).defined_names.items()}
    vals, how = RC.recalc(path)
    def cell(n):
        m = re.match(r"^'?(.*?)'?!\$?([A-Z]+)\$?(\d+)$", names[n])
        return vals.get((m.group(1), m.group(2) + m.group(3)))
    near = lambda a, b: a is not None and abs(a - b) <= 1e-6 * max(1, abs(b))
    ok(near(cell("V_ps"), H["ps"]) and near(cell("V_eq"), H["eq"]) and near(cell("V_ev"), H["ev"]) and near(cell("V_tv"), H["tv"]),
       "3. %s, recalculated by %s: value per share %.4f (by hand %.4f); equity %s; terminal value %s" % (key.upper(), how, cell("V_ps") or 0, H["ps"], "{:,.2f}".format(cell("V_eq") or 0), "{:,.2f}".format(cell("V_tv") or 0)))
    if key == "fcff":
        ok(near(cell("A_rate"), H["rate"]), "3. WACC from its parts: %.6f (by hand %.6f)" % (cell("A_rate") or 0, H["rate"]))
    # the cash flows row and the grid
    wb = openpyxl.load_workbook(path)
    ws = wb["DCF"]
    cfrow = next(r for r in range(1, ws.max_row + 1) if str(ws.cell(r, 1).value).startswith("Free cash flow to the firm" if key == "fcff" else "Free cash flow to equity"))
    got = [vals[("DCF", openpyxl.utils.get_column_letter(c + 2) + str(cfrow))] for c in range(A["years"])]
    ok(all(near(a, b) for a, b in zip(got, H["cfs"])), "3. %s: each year's cash flow equals the hand-worked one (%s)" % (key.upper(), ", ".join("{:,.0f}".format(x) for x in H["cfs"])))
    grow = next(r for r in range(1, ws.max_row + 1) if str(ws.cell(r, 1).value).startswith("Sensitivity")) + 2
    g2 = [[vals[("DCF", openpyxl.utils.get_column_letter(c + 2) + str(grow + i))] for c in range(5)] for i in range(5)]
    ok(all(near(g2[i][j], H["grid"][i][j]) for i in range(5) for j in range(5)), "3. %s: the 5 x 5 sensitivity grid (rate x g) equals the hand-worked values; centre %.4f" % (key.upper(), g2[2][2]))
    ok(near(g2[2][2], H["ps"]), "3. %s: the grid's centre is the value per share" % key.upper())
    nf = sum(1 for k in vals) ; ok(nf > 60, "3. %s: %d live formulas recalculated" % (key.upper(), nf))
    doc = zipfile.ZipFile(os.path.join(OUT, "reports-dcf-%s.docx" % key)).read("word/document.xml").decode()
    ok("must be issued by a registered valuer / merchant banker" in doc and "DRAFT VALUATION REPORT" in doc, "5. %s: the Word draft says it must be issued by a registered valuer / merchant banker" % key.upper())
print("\n" + ("%d FAILED" % len(fails) if fails else "all passed")); sys.exit(1 if fails else 0)
