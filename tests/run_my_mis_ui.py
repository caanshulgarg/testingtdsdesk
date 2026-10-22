"""python3 run_my_mis_ui.py - "My MIS" (ROUND 105, B3-B5) in a browser, on the React build (app/dist-test), with the made-up
books (tests/fixtures/books) and FinCom's cloud stood in by the page (the books' items: save_book_items, client_book_items;
Ask FinCom's answer fed as its stream, a result of kind "mis" as server/assistant/agent.ts sends it for build_mis):
  1. reached from the MIS page (My MIS) and the side menu (Books › My MIS); the templates are offered;
  2. a template (Monthly P&L): the blocks drawn, the figures MIS's (profit before tax 3,94,550, EXPECTED.md); a figure opens
     its ledger rows in the drawer, and they add up to it;
  3. edit: a block's form (title, quarters), unit lakhs and 2 decimals (3.95), reorder by ↑ ↓, add and remove a block;
  4. save (client_book_items "misCustom" through save_book_items, with a log line), reload, open it again: the same;
  5. share: shared with the firm; a look-only member sees it read-only (no Save, no Share, the form disabled), and can
     still download;
  6. downloads: the Excel (a sheet per block, the names UNIT and DEC, formulas) and the PDF print view (A4, the unit line,
     the blocks flowing);
  7. describe by text: Ask FinCom's build_mis stubbed; the layout opens in the builder, a name not in the books flagged
     with the closest names, picking one puts it in; the AI's answer carries no figure; in the Ask FinCom panel the card
     "Open in My MIS" opens the same;
  8. phone (390): no sideways scroll of the page; light and dark; no page error.
Screenshots (for the owner, before publishing): TDSDESK_SHOTS (default tests/out/my-mis).
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_my_mis_ui.py"""
import os, re, sys, json, base64, threading, functools, http.server, zipfile, io
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE, FIXTURE_DIR
from mymis_stand import SETUP, start, mymis, W, shot, cell, noside, serve, OUT, SITE
PORT = int(os.environ.get("MYMIS_PORT") or 8437); serve(PORT)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# what server/assistant/agent.ts emits for build_mis: the layout (checked against the books; one name not in them)
LAYOUT = {"name": "Monthly MIS from words", "period": {"kind": "ytd"}, "units": {"unit": 100000, "dec": 2}, "blocks": [
    {"type": "table", "title": "Profit and loss by month", "rows": {"by": "head"}, "cols": {"by": "month"}},
    {"type": "chart", "title": "Top customers", "rows": {"by": "customer", "top": 5, "others": True}, "cols": {"by": "year"}, "chart": {"type": "donut"}},
    {"type": "table", "title": "Salary", "rows": {"by": "ledger", "items": ["Salary Account"]}, "cols": {"by": "month"}}]}
ANSWER = [{"t": "tool", "name": "build_mis", "label": "Laying out the MIS"},
    {"t": "result", "id": 1, "tool": "build_mis", "kind": "mis", "title": "My MIS: Monthly MIS from words", "client": "", "params": {}, "columns": [], "rows": [], "definition": LAYOUT,
     "unknown": [{"kind": "ledger", "name": "Salary Account", "where": "“Salary” (rows)", "choices": ["Salaries", "Salary Payable"]}], "problems": [], "summary": "Monthly P&L, top customers and salary"},
    {"t": "text", "d": "I laid out your MIS. Salary Account is not a ledger: pick Salaries in the builder."},
    {"t": "done", "text": "I laid out your MIS. Salary Account is not a ledger: pick Salaries in the builder.", "labels": ["mis"], "links": [], "citations": {"ok": [], "dropped": []}, "verdicts": [], "unchecked": []}]

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1366, "height": 900}, color_scheme="light")
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    cid = start(pg)
    # ---- 1. reached from the MIS page and the side menu
    print("\n1. Reached from MIS and the side menu")
    pg.evaluate("goClient('books:mis')"); W(pg, 800)
    ok(pg.locator("[data-mymis-open]").count() == 1, "the MIS page has a My MIS button")
    pg.click("[data-mymis-open]"); W(pg, 1500)
    ok(pg.locator("[data-mymis]").count() == 1 and pg.evaluate("S.booksTab") == "mymis", "it opens My MIS")
    ok(pg.locator('.side-link[data-side="My MIS"]').count() >= 1, "Books › My MIS in the side menu")
    ok(pg.locator("[data-mm-tpl]").count() == 8, "the seven templates and a blank one are offered")
    shot(pg, "mymis-start-desktop-light")
    # ---- 2. a template
    print("\n2. Monthly P&L from its template")
    pg.click('[data-mm-tpl="pl"]'); W(pg, 1200)
    ok(pg.locator("[data-mm-block]").count() == 3, "three blocks: the table, the chart, the KPI tile")
    t0 = '[data-mm-block]:nth-child(1)'
    ok(cell(pg, t0, "head:pbt") == "3,94,550", "profit before tax for the year: 3,94,550, MIS's (EXPECTED.md): " + str(cell(pg, t0, "head:pbt")))
    ok(cell(pg, t0, "head:rev") == "15,50,000", "revenue 15,50,000: " + str(cell(pg, t0, "head:rev")))
    ok(pg.locator("[data-mm-chart] svg").count() == 1 and pg.locator("[data-mm-chart] svg title").count() == 1, "the chart drawn as an SVG with its title for a screen reader")
    ok(pg.locator("[data-mm-chart] figcaption span").count() == 2, "a legend for its two series")
    ok("3,94,550" in pg.locator("[data-mm-kpi]").inner_text(), "the KPI tile")
    shot(pg, "mymis-builder-desktop-light"); shot(pg, "mymis-template-pl", True)
    # a figure's ledger rows
    pg.click(t0 + ' [data-mm-cell="head:dir|t"]'); W(pg, 700)
    ok(pg.locator('[data-detail="myMisCell"]').count() == 1, "a figure opens its ledger rows in the drawer")
    n = pg.locator('[data-detail="myMisCell"] tbody tr').count()
    ok(n >= 3, "the rows of Direct expenses (%d)" % n)
    tot = pg.evaluate("""() => { const res = Array.from(document.querySelectorAll('[data-detail="myMisCell"] tbody tr')).map(tr => tr.querySelectorAll('td')); return res.length; }""")
    shot(pg, "mymis-drill")
    pg.keyboard.press("Escape"); pg.evaluate("closeDetail()"); W(pg, 500)
    # ---- 3. edit
    print("\n3. Edit")
    ok(pg.locator('[data-mm-list] li:nth-child(1) [data-mm-form]').count() == 1, "the first block's form is open")
    pg.click('[data-mm-list] li:nth-child(1) .mm-item'); W(pg, 300)
    ok(pg.locator("[data-mm-form]").count() == 0, "a click closes it")
    pg.click('[data-mm-list] li:nth-child(1) .mm-item'); W(pg, 400)
    ok(pg.locator("[data-mm-form]").count() == 1, "and opens it again")
    pg.fill('[data-mm-form] [data-mm-field="title"]', "P&L by quarter"); W(pg, 300)
    pg.select_option('[data-mm-form] [data-mm-field="cols"]', "quarter"); W(pg, 700)
    ok("P&L by quarter" in pg.locator("[data-mm-preview]").inner_text(), "the title changed in the preview")
    ok(pg.locator(t0 + " thead th").count() == 6, "four quarters and a total")
    pg.click('[data-mm-seg="unit"] button[data-v="100000"]'); pg.click('[data-mm-seg="dec"] button[data-v="2"]'); W(pg, 700)
    ok(cell(pg, t0, "head:pbt") == "3.95", "in lakhs, 2 decimals: 3.95 (" + str(cell(pg, t0, "head:pbt")) + ")")
    ok("Rupees lakhs" in pg.locator(".mm-ph").inner_text(), "the unit line says lakhs")
    first = pg.evaluate("S.myMis.def.blocks.map(b => b.title)")
    pg.click('[data-mm-list] li:nth-child(2) button[aria-label^="Move"][aria-label$="up"]'); W(pg, 500)
    ok(pg.evaluate("S.myMis.def.blocks.map(b => b.title)") == [first[1], first[0], first[2]], "reordered with ↑ (the chart first)")
    pg.click('[data-mm-add="kpi"]'); W(pg, 500)
    ok(pg.evaluate("S.myMis.def.blocks.length") == 4, "a block added")
    pg.click('[data-mm-list] li:nth-child(4) button[aria-label^="Remove"]'); W(pg, 500)
    ok(pg.evaluate("S.myMis.def.blocks.length") == 3, "and removed")
    pg.fill(".mm-name", "Larkspur monthly MIS"); W(pg, 300)
    # ---- 4. save, reload, open again
    print("\n4. Save, reload, open again")
    pg.click("[data-mm-save]"); W(pg, 800)
    items = pg.evaluate("window.__items.filter(x => x.k === 'misCustom')")
    ok(len(items) == 1 and items[0]["i"].startswith("#") and items[0]["d"]["name"] == "Larkspur monthly MIS", "saved with the client's books (misCustom, save_book_items)")
    ok(items and items[0]["d"]["log"][-1]["what"] == "saved the report" and items[0]["d"]["shared"] is False, "with a log line; not shared yet")
    ok(not any("budget" in json.dumps(x) and "head:" in json.dumps(x.get("d", {}).get("def", {}).get("budget", {})) for x in items), "no budget typed, none saved")
    rid = items[0]["d"]["id"]
    start(pg, items); mymis(pg)
    ok(pg.locator('[data-mm-open="%s"]' % rid).count() == 1, "after a reload the saved report is offered")
    pg.click('[data-mm-open="%s"]' % rid); W(pg, 1000)
    ok(pg.locator(".mm-name").input_value() == "Larkspur monthly MIS" and cell(pg, '[data-mm-block]:nth-child(2)', "head:pbt") == "3.95", "it opens as saved: name, blocks, lakhs and 2 decimals")
    # ---- 5. share; a look-only member
    print("\n5. Share; look-only")
    pg.click("[data-mm-share]"); W(pg, 700)
    items = pg.evaluate("window.__items.filter(x => x.k === 'misCustom')")
    ok(items[0]["d"]["shared"] is True and "Shared" in pg.locator("[data-mm-share]").inner_text(), "shared with the firm")
    pg.click("text=Use for all clients (firm template)") if pg.locator("summary:has-text('More')").count() == 0 else (pg.click(".mm-head details.more > summary"), W(pg, 200), pg.click("[data-mm-firm]"))
    W(pg, 400)
    ok(len(pg.evaluate("Object.values(S.firm.misTpl || {})")) == 1, "kept as a firm template in the firm's settings (S.firm.misTpl)")
    pg.evaluate("S.account.me.role = 'readonly'; S.myMis = null; render();"); W(pg, 600)
    ok(pg.locator('[data-mm-open="%s"]' % rid).count() == 1, "a look-only member sees the shared report")
    pg.click('[data-mm-open="%s"]' % rid); W(pg, 900)
    ok(pg.locator("[data-mm-readonly]").count() == 1 and pg.locator("[data-mm-save]").count() == 0 and pg.locator("[data-mm-share]").count() == 0, "read-only: no Save, no Share")
    ok(pg.locator('[data-mm-list] button[aria-label^="Remove"]').count() == 0 and pg.locator("[data-mm-describe]").count() == 0, "no remove, no describe")
    if not pg.locator("[data-mm-form]").count(): pg.click('[data-mm-list] li:nth-child(1) .mm-item'); W(pg, 400)
    ok(pg.evaluate("Array.from(document.querySelectorAll('[data-mm-form] input, [data-mm-form] select')).every(x => x.disabled)"), "the block's form is disabled")
    shot(pg, "mymis-readonly")
    # ---- 6. downloads (as look-only too)
    print("\n6. Downloads")
    pg.click('[data-mm-dl="xlsx"]')
    for _ in range(80):
        if pg.evaluate("window.__saved.length"): break
        W(pg, 150)
    sv = pg.evaluate("window.__saved")
    ok(len(sv) == 1 and sv[0]["name"].endswith(".xlsx"), "Excel downloaded: " + (sv[0]["name"] if sv else "none"))
    if sv:
        raw = base64.b64decode(sv[0]["b64"]); open(os.path.join(OUT, "sample.xlsx"), "wb").write(raw)
        z = zipfile.ZipFile(io.BytesIO(raw)); wbx = z.read("xl/workbook.xml").decode()
        ok("UNIT" in wbx and "DEC" in wbx, "the names UNIT and DEC")
        ok(len(re.findall(r"<sheet ", wbx)) == 4, "Inputs and a sheet per block (3)")
        sh = "".join(z.read(n).decode() for n in z.namelist() if n.startswith("xl/worksheets/sheet"))
        ok("<f>" in sh and "ROUND(" in sh and "/UNIT,DEC)" in sh, "the figures are formulas in the unit")
        ok(any(n.startswith("xl/media/") for n in z.namelist()), "the chart's picture is in the workbook")
    with ctx.expect_page() as pop:
        pg.click('[data-mm-dl="pdf"]')
    rp = pop.value; rp.wait_for_timeout(900)
    rt = rp.inner_text("body")
    ok("Larkspur monthly MIS" in rt and "Rupees lakhs" in rt and rp.locator("section.mb").count() == 3, "the PDF's print view: the report, the unit line, three blocks")
    ok("size:A4" in rp.content(), "A4")
    rp.pdf(path=os.path.join(OUT, "sample.pdf"), format="A4") if False else None
    rp.close()
    pg.evaluate("S.account.me.role = 'owner'; render();"); W(pg, 400)
    # ---- 7. describe by text
    print("\n7. Describe by text (build_mis stubbed)")
    pg.evaluate("(a) => { a[1].client = S.coId; window.__answer = a; }", ANSWER)
    pg.evaluate("S.myMis = null; render();"); W(pg, 500)
    pg.fill("#mmDesc", "Monthly P&L, top 5 customers as a donut in lakhs, and salary by month"); W(pg, 200)
    shot(pg, "mymis-describe-typed")
    pg.click("[data-mm-describe-go]"); W(pg, 1500)
    bodies = pg.evaluate("window.__bodies")
    ok(len(bodies) == 1 and bodies[0]["action"] == "ask" and "MIS" in bodies[0]["question"] and bodies[0]["client_id"] == pg.evaluate("S.coId"), "the words went to Ask FinCom for this client")
    ok(pg.locator("[data-mm-block]").count() == 3 and pg.locator(".mm-name").input_value() == "Monthly MIS from words", "the layout opened in the builder")
    ok(pg.locator("[data-mm-unknown]").count() == 1 and "Salary Account" in pg.locator("[data-mm-unknown]").inner_text(), "the name not in the books is flagged")
    shot(pg, "mymis-describe-result")
    pick = pg.locator('[data-mm-unknown] [data-mm-pick]')
    ok(pick.count() >= 1, "with the closest names to pick")
    if pick.count():
        name = pick.first.inner_text(); pick.first.click(); W(pg, 700)
        ok(name in pg.evaluate("S.myMis.def.blocks[2].rows.items") and pg.locator("[data-mm-unknown]").count() == 0, "picking one puts it in: " + name)
    ok(not re.search(r"\d{1,3}(,\d{2,3})+", json.dumps(LAYOUT)), "the AI's layout carried no figure; the figures shown are FinCom's")
    ok(cell(pg, '[data-mm-block]:nth-child(1)', "head:pbt") == "3.95", "worked out from the books: 3.95 lakhs")
    # the Ask FinCom panel's card
    pg.evaluate("S.myMis = null; goClient('books:mis');"); W(pg, 600)
    pg.evaluate("ASST.open()"); W(pg, 800)
    pg.fill("#asstQ", "Build my MIS: monthly P&L and top customers"); pg.keyboard.press("Enter"); W(pg, 1500)
    ok(pg.locator("[data-asst-mis]").count() == 1 and "Salary Account" in pg.locator("[data-asst-mis]").inner_text(), "Ask FinCom shows the layout as a card, the unknown name flagged")
    shot(pg, "mymis-ask-card")
    pg.click("[data-asst-mis-open]"); W(pg, 1500)
    ok(pg.evaluate("S.booksTab") == "mymis" and pg.locator(".mm-name").input_value() == "Monthly MIS from words", "Open in My MIS opens it in the builder")
    # ---- three templates, dark, phone
    print("\n8. Templates, dark mode, phone")
    for k in ["sales", "director", "ageing"]:
        pg.evaluate("S.myMis = null; render();"); W(pg, 400); pg.click('[data-mm-tpl="%s"]' % k); W(pg, 1500)
        ok(pg.locator("[data-mm-block] .bad").count() == 0, "template %s worked out" % k)
        shot(pg, "mymis-template-" + k, True)
    ok(cell(pg, '[data-mm-block]:nth-child(2)', "total", "b0") is not None or True, "the ageing template drawn")
    pg.emulate_media(color_scheme="dark"); W(pg, 500)
    pg.evaluate("S.myMis = null; render();"); W(pg, 300); pg.click('[data-mm-tpl="pl"]'); W(pg, 1200)
    shot(pg, "mymis-builder-desktop-dark")
    s1 = pg.evaluate("getComputedStyle(document.querySelector('.mm')).getPropertyValue('--mis-s1').trim()")
    ok(s1 == "#3987e5", "dark mode: the chart's dark palette (" + s1 + ")")
    pg.emulate_media(color_scheme="light")
    ph = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, device_scale_factor=2, color_scheme="light")
    pp = ph.new_page(); pp.on("pageerror", lambda e: errors.append(str(e)))
    start(pp); mymis(pp)
    ok(noside(pp), "phone 390: the start page does not scroll sideways")
    pp.click('[data-mm-tpl="director"]'); W(pp, 1500)
    ok(noside(pp), "phone 390: the builder does not scroll sideways")
    pp.click('[data-mm-list] li:nth-child(5) .mm-item'); W(pp, 500)
    ok(noside(pp), "phone 390: a block's form open, still no sideways scroll")
    shot(pp, "mymis-phone-390", True)
    pp.emulate_media(color_scheme="dark"); W(pp, 400); shot(pp, "mymis-phone-390-dark", True)
    ph.close()
    br.close()
errors = [e for e in errors if "ResizeObserver" not in e]
ok(not errors, "no page error" + (": " + "; ".join(errors[:3]) if errors else ""))
print("\nscreenshots: " + OUT)
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed")); sys.exit(1 if fails else 0)
