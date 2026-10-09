"""python3 tdsgst_snapshot.py SITE OUT.json [PORT] - the figures and files of the TDS and GST return pages, for the
fixture books (tests/fixtures/books, 2025-26) and the same books moved a year on (2026-27, the forms of the Income-tax
Act, 2025), into OUT.json. Made for the redesign of 09-Oct-2026 (branch app-tdsgst): the layout of the pages changed,
nothing they show or make may. Run it on the build before and after a change and compare with tdsgst_compare():

  files    every file the pages make, by the page's own buttons: the TDS text file (26Q/27Q/27EQ and Forms 140/144/143,
           each quarter) and the GSTR-1 and GSTR-3B JSON (each month and GSTIN). Compared byte for byte; the one field
           that is the day the file is made (the FVU file's FH record) is set to DDMMYYYY first.
  figures  every rupee amount the pages show, for each return (all its tabs together) and each year's page. Each amount
           shown before must be shown after (a return's tabs may be laid out differently, and a new summary may repeat).

The snapshot taken on the build before the redesign is tests/fixtures/tdsgst-before.json; run_tdsgst_ui.py compares the
build under test with it."""
import json, os, sys, re, hashlib, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

AMT = re.compile(r"₹\s?-?[\d,]+(?:\.\d+)?")


def amounts(text):
    return sorted(set(a.replace(" ", "") for a in AMT.findall(text)))


# the books in the page: the fixture's 2025-26, and a copy a year on (2026-27), with challans for each quarter
LOAD = """(bk) => {
  const c = newCompany({name: "ZZ TDSGST", gstin: "07AAGCL4827M1Z3"}); c.tan = "DELZ12345A"; S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const on = (d) => { const t = String(d || ""); return /^\\d{8}$/.test(t) ? String(+t.slice(0, 4) + 1) + t.slice(4) : t; };
  const next = bk.vouchers.map((v) => Object.assign({}, v, {id: v.id + "+1y", date: on(v.date)}));
  const b = Object.assign({loading: false, challans: [], alloc: {}}, bk, {vouchers: bk.vouchers.concat(next), cid: c.id});
  b.meta = Object.assign({}, bk.meta, {to: on(bk.meta.to)});
  // a salary sheet for 24Q (Form 138): two employees, each month of both years, one without a PAN
  b.salary = [];
  for (let i = 0; i < 24; i++) { const y = 2025 + Math.floor((i + 3) / 12), m = (i + 3) % 12 + 1, d = y + "-" + String(m).padStart(2, "0") + "-28";
    b.salary.push({name: "Asha Verma", pan: "ABCPV1234K", code: "E1", date: d, gross: 95000, exempt: 12000, standard: 6250, profTax: 200, chapter6: 12500, taxable: 64050, tds: 6405, surcharge: 0, cess: 0, regime: "N"});
    b.salary.push({name: "Ravi Menon", pan: "", code: "E2", date: d, gross: 42000, exempt: 4000, standard: 6250, profTax: 200, chapter6: 0, taxable: 31550, tds: 1250 + i, surcharge: 0, cess: 0, regime: "O"}); }
  S.books = b; S.books.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "tds"; render();
}"""
CHALLANS = """() => {
  const by = {}; TDS.rows().concat(TDS.nrRows(), TDS.tcsRows()).forEach((r) => { const k = r.fy + r.q; if (!by[k]) by[k] = r; });
  S.books.challans = Object.values(by).map((r, i) => ({id: "ch" + i, bsr: "0240020", serial: String(10000 + i), date: r.date, tax: 900000, interest: i % 2 ? 150 : 0}));
  TDS.autoAllocate(); render();
}"""


def snapshot(site, port=8290, shots=None):
    from playwright.sync_api import sync_playwright
    from books_data import CACHE
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    H = functools.partial(Quiet, directory=site)
    srv = http.server.ThreadingHTTPServer(("localhost", port), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    books = json.load(open(CACHE))
    files, figures, errors = {}, {}, []
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
        pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        # the files the buttons make: saveFile kept; the ledgers counted as confirmed (the fixture's are not, which sends a
        # download to the ledgers page instead)
        pg.evaluate("""() => { window.__files = []; window.ledgersReady = () => true;
          window.saveFile = async (name, data) => { const t = data instanceof Blob ? await data.text() : String(data); window.__files.push({name, text: t}); return true; }; }""")
        text = lambda: re.sub(r"\s+", " ", pg.evaluate("document.getElementById('app').innerText"))
        fys = pg.evaluate("tdsYears(S.books, TDS.rows())")

        def take(key):
            pg.wait_for_timeout(60)
            figures.setdefault(key, set()).update(amounts(text()))

        def press(label_re):
            """the first button whose words match, in the page as it is (the old pages had them above the tabs, the new on
            the File tab)"""
            return pg.evaluate("""(re) => { const b = [...document.querySelectorAll('#app button')].find((x) => new RegExp(re).test(x.textContent) && !x.disabled);
              if (b) b.click(); return !!b; }""", label_re)

        for fy in fys:
            pg.evaluate("(fy) => { S.booksTab = 'tds'; S.tdsFy = fy; S.tdsView = 'year'; S.tdsQ = ''; render(); }", fy); take("tds/%s/year" % fy)
            for q in ["Q1", "Q2", "Q3", "Q4"]:
                for form in ["26Q", "27Q", "27EQ", "24Q"]:
                    key = "tds/%s/%s/%s" % (fy, q, form)
                    for tab in ["summary", "challans", "deductees", "deductions", "employees", "annex2", "checks", "file"]:
                        pg.evaluate("([fy, q, form, tab]) => { S.tdsFy = fy; S.tdsQ = q; S.tdsForm = form; S.tdsView = 'return'; S.tdsTab = tab; S.tdsOpen = ''; S.chOpen = ''; render(); }", [fy, q, form, tab])
                        take(key)
                    if form != "24Q":
                        pg.evaluate("() => { window.__files = []; S.tdsTab = 'file'; render(); }"); pg.wait_for_timeout(60)
                        if press(r"^Download the .* text file"):
                            pg.wait_for_timeout(150)
                            for f in pg.evaluate("window.__files"):
                                t = re.sub(r"^(\d+\^FH\^NS1\^R\^)\d{8}\^", r"\1DDMMYYYY^", f["text"], flags=re.M)
                                files["%s/%s" % (key, f["name"])] = {"sha256": hashlib.sha256(t.encode()).hexdigest(), "bytes": len(t.encode())}
            pg.evaluate("(fy) => { S.tdsFy = fy; S.tdsView = 'certs'; render(); }", fy); take("tds/%s/certs" % fy)
        # GST: each GSTIN and month, each part (the parts and, on the new page, each tab of GSTR-1 and 3B)
        regs = pg.evaluate("GSTR.gstins(S.books).map((g) => g.slice(0, 2))")
        months = pg.evaluate("GSTR.months()")
        parts = ["r1", "r3b", "inreg", "r2b", "follow", "adv", "rev", "amend", "g9", "g9c", "filedcmp", "recon", "vault", "qtr"]
        for reg in regs:
            for ym in months:
                for part in parts:
                    key = "gst/%s/%s/%s" % (reg, ym, part)
                    # every tab of the return (a part the GSTIN's filing type does not have opens the first, GSTR-1)
                    for sub in ["summary", "details", "diff", "file"]:
                        pg.evaluate("([reg, ym, part, sub]) => { S.booksTab = 'gst'; S.gstReg = reg; S.gstSeen = ''; S.gstYm = ym; S.books.reco = null; S.gstView = 'return'; S.gstPart = part; S.gstSub = sub; S.gstSeen = reg + '|' + GSTSet.typeOf(ym, reg); render(); }", [reg, ym, part, sub])
                        take(key)
                    if part in ("r1", "r3b"):
                        pg.evaluate("() => { window.__files = []; S.gstSub = 'file'; render(); }"); pg.wait_for_timeout(60)
                        if press(r"^Download GSTR-%s JSON" % ("1" if part == "r1" else "3B")):
                            pg.wait_for_timeout(200)
                            for f in pg.evaluate("window.__files"):
                                files["%s/%s" % (key, f["name"])] = {"sha256": hashlib.sha256(f["text"].encode()).hexdigest(), "bytes": len(f["text"].encode())}
        br.close()
    srv.shutdown()
    return {"files": files, "figures": {k: sorted(v) for k, v in figures.items()}, "errors": errors}


def compare(before, after):
    """what differs: files missing or not byte-identical, and amounts shown before and not after"""
    out = []
    for k, f in before["files"].items():
        g = after["files"].get(k)
        if not g: out.append("file not made: " + k)
        elif g["sha256"] != f["sha256"]: out.append("file differs: %s (%d -> %d bytes)" % (k, f["bytes"], g["bytes"]))
    for k in after["files"]:
        if k not in before["files"]: out.append("file not made before: " + k)
    for k, a in before["figures"].items():
        lost = sorted(set(a) - set(after["figures"].get(k, [])))
        if lost: out.append("figures not shown: %s: %s" % (k, ", ".join(lost[:8])))
    return out


if __name__ == "__main__":
    site, out = sys.argv[1], sys.argv[2]
    res = snapshot(site, int(sys.argv[3]) if len(sys.argv) > 3 else 8290)
    json.dump(res, open(out, "w"), indent=0, sort_keys=True)
    print(len(res["files"]), "files;", len(res["figures"]), "pages;", sum(len(v) for v in res["figures"].values()), "amounts;", len(res["errors"]), "errors")
