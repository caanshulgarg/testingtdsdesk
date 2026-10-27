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
  const c = newCompany({name: "ZZ TDSGST", gstin: "07AAGCL4827M1Z3"}); c.tan = "DELZ12345A"; S.companies[c.id] = c;
  // the fixture client shows its advances in GST returns (off unless turned on, the owner 22-Oct-2026; GSTAdv.ready)
  c.choices = Object.assign(c.choices || {}, {advGst: {value: "on", state: "confirmed", by: "test", at: "2026-10-22T00:00:00Z"}}); S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
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
  TDS.autoAllocate();
  // next-challan-match (17-Oct-2026): a challan's interest is written only as allocated to a return; as a person does on the
  // Challans tab, it is allocated to the return that uses it (the one the files of 14-Oct-2026 gave it to by themselves)
  if (typeof TDSMatch === "object") TDS.challans().forEach(c => { if (!num(c.interest)) return; const m = TDSReg.uses()[c.id] || {};
    const k = Object.keys(m).sort((a, b) => (m[a].fy + m[a].q + m[a].form).localeCompare(m[b].fy + m[b].q + m[b].form))[0];
    if (k) TDSReg.setPortion(c.id, m[k].form, m[k].fy, m[k].q, num(c.interest), 0, {nosave: true}); });
  render();
}"""

# next-tds-addlist (19-Oct-2026): the snapshot's challans dated on each quarter's LAST deduction (CHALLANS dates them on the
# first: a challan dated before the deductions it pays is now an error in Validate & file, "a challan cannot pay TDS
# deducted after its deposit date", and the file is not made). tdsgst-before.json was taken again with these on the build
# before the change (origin/staging-next 006adb4da) and compared with the build after
CHALLANS_SNAP = CHALLANS.replace("if (!by[k]) by[k] = r;", "if (!by[k] || TDS.ymd(r.date) >= TDS.ymd(by[k].date)) by[k] = r;")
assert CHALLANS_SNAP != CHALLANS

# next-tds-validate-short (26-Oct-2026, staging-next 3ffef91d3): an empty required deductor detail now blocks the file
# (TDSF25.deductorRequired), and the fixture company had only its TAN, so no TDS file was made. The snapshot gives the
# deductor's details (the PAN that of its GSTIN, as tdsval_case.FILL gives the rest); tdsgst-before.json was taken again
# with these on the build before the change (30e025c19) and compared with the build after
DEDUCTOR = """() => { const co = CO(); co.pan = co.pan || 'AAGCL4827M';
  co.tds26q = Object.assign({}, co.tds26q || {}, {flat: '12 First Floor', town: 'New Delhi', state: '07', pin: '110005', email: 'a@b.in',
    phone: '9811111111', person: 'Ravi Kumar', personDesignation: 'Partner', personPan: 'ABCPK1234K', personFlat: '12 First Floor', personTown: 'New Delhi'});
  render(); }"""

# the day tests/fixtures/tdsgst-before.json was made (14-Oct-2026). The pages show figures worked out to today (the 234E
# late fee is 200 a day to the date), so the browser's clock is fixed at that day; a real clock made the comparison fail a
# day later (15-Oct-2026: 24Q Q1 2026-27, 15,000.00 became 15,200.00)
# next-tds-early (20-Oct-2026): moved to 31-May-2027, after the fixture's last challan (Q4 2026-27's, March 2027): Protean's FVU
# refuses a challan dated after the day the file is made (T-FV-3040), and the app now does too, so on 14-Oct-2026 the
# 2026-27 Form 140 files of Q3 and Q4 were not made. tdsgst-before.json was taken again at this day on the build before
# (origin/staging-next ca9ca1593) and compared with the build after
SNAPSHOT_DAY = "2027-05-31T12:00:00+05:30"

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
        pg.clock.set_fixed_time(SNAPSHOT_DAY)
        pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
        pg.evaluate(DEDUCTOR); pg.evaluate(CHALLANS_SNAP); pg.wait_for_timeout(300)
        left = pg.evaluate("typeof TDSF25 === 'object' && TDSF25.deductorRequired ? TDSF25.deductorRequired(TDS26Q.firmDetails()).map(x => x.k) : []")
        if left: errors.append("the deductor's required details not all given: %s" % left)
        # the files the buttons make: saveFile kept; the ledgers counted as confirmed (the fixture's are not, which sends a
        # download to the ledgers page instead)
        pg.evaluate("""() => { window.__files = []; window.ledgersReady = () => true;
          window.saveFile = async (name, data) => { const t = data instanceof Blob ? await data.text() : String(data); window.__files.push({name, text: t}); return true; }; }""")
        # tds-layout (14-Oct-2026): a challan's split by head is shown on hover (data-split-words): it counts as shown
        text = lambda: re.sub(r"\s+", " ", pg.evaluate("document.getElementById('app').innerText + ' ' + [...document.querySelectorAll('#app [data-split-words]')].map((e) => e.dataset.splitWords).join(' ')"))
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
            # tds-layout (14-Oct-2026): the year opened as the app's own "← year" does (no form picked, no To fix list chosen),
            # whatever the return opened last left (since tds-layout a return opened sets the form picked, as tdsGo always did)
            pg.evaluate("(fy) => { S.booksTab = 'tds'; S.tdsFy = fy; S.tdsView = 'year'; S.tdsQ = ''; S.tdsPickForm = ''; S.tdsFix = ''; render(); }", fy); take("tds/%s/year" % fy)
            # round 46 (TDS & GST makeover): the tie-out and the TDS limits, under the year's grid before, are TDS › Checks;
            # their figures count as the year's page's (a build without Checks shows the grid again: the same figures).
            # tds-layout (14-Oct-2026): no TDS tabs any more; the old Checks view leads to a return's To fix with that list
            # (S.tdsView 'checks' is still read), so it is asked for whenever the page has the grid (as every build since round 46)
            for chk in ["tieout", "limits"]:
                pg.evaluate("([fy, c]) => { S.tdsFy = fy; S.tdsQ = ''; S.tdsView = typeof tdsNav === 'function' && (document.querySelector('[data-tds-sec]') || typeof TDSReg === 'object') ? 'checks' : 'year'; S.tdsCheck = c; render(); }", [fy, chk]); take("tds/%s/year" % fy)
            # next-tds-validate-short (25-Oct-2026): the return's interest and late fee working, a click away (Details), opened
            pg.evaluate("() => { if (S.tdsView === 'return') { S.tdsFix = 'intwork'; S.tdsFixAt = S.tdsFy + '|' + S.tdsQ + '|' + S.tdsForm; render(); } }"); take("tds/%s/year" % fy); pg.evaluate("() => { S.tdsFix = ''; render(); }")
            for q in ["Q1", "Q2", "Q3", "Q4"]:
                for form in ["26Q", "27Q", "27EQ", "24Q"]:
                    key = "tds/%s/%s/%s" % (fy, q, form)
                    for tab in ["summary", "challans", "deductees", "deductions", "employees", "annex2", "checks", "file"]:
                        pg.evaluate("([fy, q, form, tab]) => { S.tdsFy = fy; S.tdsQ = q; S.tdsForm = form; S.tdsView = 'return'; S.tdsTab = tab; S.tdsOpen = ''; S.chOpen = ''; S.tdsFix = ''; render(); }", [fy, q, form, tab])
                        take(key)
                    # next-tds-clear (19-Oct-2026): what a return showed on its tabs is now a click away on its steps: By
                    # section and By employee are toggles of Deductions, and Validate & file's lines open their lists
                    # ("Review ▸"); each is shown as a person would open it
                    # next-tds-tidy2: Form 138's Deductions opens on Select challan as 26Q's; its rows are on the challans and
                    # in "Not on any challan" (Done opened), Annexure I in one table under ⋯ (S.tdsDedView "table")
                    for extra in ["S.tdsTab = 'deductions'; S.tdsDedView = 'sections';", "S.tdsTab = 'deductions'; S.tdsDedView = ''; S.q24View = 'emp';", "S.tdsTab = 'file'; S.q24View = ''; S.tdsValOpen = '*';",
                                  "S.tdsTab = 'deductions'; S.tdsValOpen = ''; S.tdsDedView = 'table';", "S.tdsTab = 'deductions'; S.tdsDedView = ''; S.tdsWinCh = '__none'; S.dtDoneOpen = true;",
                                  "S.tdsTab = 'deductions'; S.tdsDedView = ''; S.tdsWinCh = ''; S.tdsDedReg = 'pending';", "S.tdsTab = 'deductions'; S.tdsDedView = ''; S.tdsDedReg = 'mapped';"]:
                        pg.evaluate("() => { " + extra + " render(); }"); take(key)
                    pg.evaluate("() => { S.tdsDedView = ''; S.q24View = ''; S.tdsValOpen = ''; S.tdsWinCh = ''; S.dtDoneOpen = false; S.tdsDedReg = ''; render(); }")
                    if form != "24Q":
                        pg.evaluate("() => { window.__files = []; S.tdsTab = 'file'; render(); }"); pg.wait_for_timeout(60)
                        if press(r"^(Download the .* text file|Make FVU file)"):
                            pg.wait_for_timeout(150)
                            for f in pg.evaluate("window.__files"):
                                t = re.sub(r"^(\d+\^FH\^NS1\^R\^)\d{8}\^", r"\1DDMMYYYY^", f["text"], flags=re.M)
                                files["%s/%s" % (key, f["name"])] = {"sha256": hashlib.sha256(t.encode()).hexdigest(), "bytes": len(t.encode())}
                                if os.environ.get("SNAP_TEXT_DIR"):   # the text itself, to read a difference (tds-layout, 14-Oct-2026)
                                    o = os.path.join(os.environ["SNAP_TEXT_DIR"], key, f["name"]); os.makedirs(os.path.dirname(o), exist_ok=True); open(o, "w").write(t)
            pg.evaluate("(fy) => { S.tdsFy = fy; S.tdsView = 'certs'; render(); }", fy); take("tds/%s/certs" % fy)
            # next-tds-validate-short (25-Oct-2026): the interest and late fee working is a click away (Details): opened
            pg.evaluate("() => { S.tdsFix = 'intwork'; S.tdsFixAt = S.tdsFy + '|' + S.tdsQ + '|' + S.tdsForm; render(); }"); take("tds/%s/certs" % fy); pg.evaluate("() => { S.tdsFix = ''; render(); }")
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
                            # the walk files each month as it goes: until 22-Oct-2026 the download itself counted as filing; now a
                            # JSON downloaded here counts only once the month is marked filed (on today's date: no late fee changes)
                            if part == "r1": pg.evaluate("([ym, reg]) => { const r = GSTF.rec(ym, reg); if (!r.r1 && !r.iff) r.r1 = GSTF.today(); }", [ym, reg])
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
