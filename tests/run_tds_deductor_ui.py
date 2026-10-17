"""python3 run_tds_deductor_ui.py - Client setup → TDS: the deductor's details for the TDS statements (the owner's
answer of 17-Oct-2026, branch next-tds-forms-2025).

  - the card is there, with the deductor's category defaulting to what the PAN's 4th letter says (shown, changeable)
  - required fields are marked; a wrong value is named beside its field, as the workbook checks it (TDSF25.deductorProblems)
  - the Ministry, the State (Annexure 5) and the AIN show only for a Government category
  - "This client is a bank, co-operative bank or post office" (default No) and what it changes (194A: 1022 / to confirm)
  - filled in and saved (the section's Save): kept on the client (co.tds26q), read by the files (TDS26Q.firmDetails), and
    a Form 140 made from it has nothing to fix in the deductor's part
  - screenshots, desktop and phone, light (tests/out/deductor/)
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tds_deductor_ui.py"""
import os, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.path.join(os.environ.get("TDSDESK_OUT") or os.path.join(HERE, "out"), "deductor"); os.makedirs(OUT, exist_ok=True)
PORT = 8287
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SETUP = """async () => {
  const c = newCompany({name: "Fixture Traders", gstin: "07AAAFF1234F1Z5"}); c.pan = "AAAFF1234F"; c.tan = "BLRF02329F";
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c);
  await openCompany(c.id); S.tab = "cotds"; render(); return c.id; }"""
FILL = {"flat": "12 First Floor", "road": "MG Road", "area": "Karol Bagh", "town": "New Delhi", "pin": "110005", "email": "accounts@fixture.example",
        "phone": "9811111111", "person": "Ravi Kumar", "personDesignation": "Partner", "personPan": "ABCPK1234K", "personFlat": "12 First Floor",
        "personPin": "110005", "personEmail": "ravi@fixture.example", "personPhone": "9822222222"}

def run(pg, E):
    card = pg.locator("#app [data-deductor]")
    ok(card.count() == 1, "Client setup → TDS: the deductor's details card")
    cat = pg.locator('#app [data-ded="deductorType"] select')
    ok(cat.count() == 1 and "From the PAN: Firm" in cat.inner_text(), "the category: from the PAN (Firm) as the default, changeable")
    ok(pg.locator('#app [data-ded="personPan"] .req').count() == 1 and pg.locator('#app [data-ded="postOffice"] .req').count() == 0, "required fields marked, optional ones not")
    ok(pg.locator('#app [data-ded="ministry"]').count() == 0 and pg.locator('#app [data-ded="ain"]').count() == 0, "no Ministry or AIN for a firm")
    # a wrong PIN is named beside its field
    box = pg.locator('#app [data-ded="pin"] input'); box.fill("1100"); box.blur(); pg.wait_for_timeout(300)
    ok("PIN code" in pg.inner_text('#app [data-ded="pin"]'), "a 4-digit PIN: named beside the field (%s)" % pg.inner_text('#app [data-ded="pin"]')[:120])
    for k, v in FILL.items():
        b = pg.locator('#app [data-ded="%s"] input' % k); b.fill(v); b.blur(); pg.wait_for_timeout(80)
    pg.select_option('#app [data-ded="state"] select', "09"); pg.wait_for_timeout(150)
    pg.select_option('#app [data-ded="personState"] select', "09"); pg.wait_for_timeout(300)
    left = E("TDSF25.deductorProblems(TDS26Q.firmDetails())")
    ok(left == [], "all required filled: nothing left to fix (%s)" % left)
    ok(pg.locator("#app [data-deductor] .err").count() == 0, "and no field shows a problem")
    # Government: the Ministry and the AIN appear
    pg.select_option('#app [data-ded="deductorType"] select', "A"); pg.wait_for_timeout(300)
    ok(pg.locator('#app [data-ded="ministry"] select').count() == 1 and pg.locator('#app [data-ded="ain"] input').count() == 1 and pg.locator('#app [data-ded="stateName"]').count() == 0,
       "Central Government: the Ministry (Annexure 3) and the AIN show")
    ok("Ministry" in pg.inner_text('#app [data-ded="ministry"]') and any(p["k"] == "ministry" for p in E("TDSF25.deductorProblems(TDS26Q.firmDetails())")), "the Ministry is then required")
    pg.select_option('#app [data-ded="deductorType"] select', "S"); pg.wait_for_timeout(300)
    ok(pg.locator('#app [data-ded="stateName"] select').count() == 1 and pg.locator('#app [data-ded="ministry"]').count() == 0, "State Government: its State (Annexure 5), no Ministry")
    pg.select_option('#app [data-ded="deductorType"] select', ""); pg.wait_for_timeout(300)
    ok(E("(CO().tds26q || {}).deductorType || ''") == "" and pg.locator('#app [data-ded="ministry"]').count() == 0, "back to the PAN's category")
    # the bank question, default No
    chk = pg.locator('#app [data-ded="isBank"] input')
    ok(chk.count() == 1 and not chk.is_checked(), "“This client is a bank, co-operative bank or post office”: No by default")
    chk.check(); pg.wait_for_timeout(300)
    ok(E("!!CO().tds26q.isBank") and "1020" in pg.inner_text('#app [data-ded="isBank"]'), "ticked: kept, and it says which codes then apply")
    chk.uncheck(); pg.wait_for_timeout(300)
    # Save (the section's footer), then kept after a fresh page
    foot = pg.locator('#app [data-confirm-foot="setup:cotds"]')
    ok("Not saved yet" in foot.inner_text(), "a draft until Save")
    foot.locator("[data-cfm=save]").click(); pg.wait_for_timeout(600)
    ok(foot.inner_text().startswith("Saved"), "Save: saved (%s)" % foot.inner_text()[:60])
    fd = E("TDS26Q.firmDetails()")
    ok(fd["personPan"] == "ABCPK1234K" and fd["state"] == "09" and (fd.get("gstin") or fd.get("gstinOwn")) == "07AAAFF1234F1Z5" and not fd.get("isBank"), "the files read them (%s)" % {k: fd.get(k) for k in ("personPan", "state", "gstin", "isBank")})

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1400, "height": 1000}); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    E = lambda js, *a: pg.evaluate(js, *a)
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    cid = E(SETUP); pg.wait_for_timeout(1000)
    run(pg, E)
    pg.locator("#app [data-deductor]").scroll_into_view_if_needed()
    pg.set_viewport_size({"width": 1400, "height": 1250})
    pg.evaluate("() => { const el = document.querySelector('#app section.setcard [data-deductor]').closest('section'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 150); }"); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(OUT, "deductor-desktop.png"))
    keep = E("JSON.stringify(Object.values(S.companies))")
    for scheme in ("light", "dark"):
        c2 = br.new_context(viewport={"width": 390, "height": 844}, color_scheme=scheme); p2 = c2.new_page(); p2.on("pageerror", lambda e: errors.append(str(e)))
        p2.goto("http://localhost:%d/" % PORT); p2.wait_for_timeout(2000); p2.click('button[data-act="useOffline"]'); p2.wait_for_timeout(800)
        p2.evaluate("""async (cs) => { JSON.parse(cs).forEach(c => { S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c); });
          const id = JSON.parse(cs).slice(-1)[0].id; await openCompany(id); S.tab = "cotds"; render(); }""", keep); p2.wait_for_timeout(1200)
        ok(p2.locator("#app [data-deductor]").count() == 1 and p2.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "phone (%s): the card, no sideways scroll" % scheme)
        p2.locator("#app section.setcard:has([data-deductor])").screenshot(path=os.path.join(OUT, "deductor-phone-%s.png" % scheme))
        c2.close()
    ok(not errors, "no page errors %s" % errors[:3])
    br.close()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
