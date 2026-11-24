"""python3 run_side_itr_ui.py - the owner's review of 23-Nov-2026 (Safari, classic look, about 1000 px wide, a company's
Income tax return): "side panel is overlapping to fincom.. and itr 5 is not applicable for companies.. option to choose
itr form should be there and there should recommendation of itr form which is to be defaulted". Offline, made-up data:
  1. the sidebar, classic and New look, 1000 and 1440 px wide (and folded): scrolled anywhere, the FinCom row and the
     client card stay at the top, painted (not see-through), and no menu word shows over them or above them;
  2. the return of a company (made-up PAN, fourth letter C) on the real page (no demo): ITR-6, "Company", recommended
     with its reason, in a chooser on the page; ITR-5 chosen: said not for a company, no JSON; ITR-7: said FinCom makes
     no JSON for it; the choice kept in the client's books for AY 2026-27, another client (an individual) with its own;
     "Use ITR-6" goes back to the recommendation.
  4. the review of 24-Nov-2026: a client with no PAN and no kind of taxpayer: no form picked, no JSON, said plainly
     ("FinCom needs the PAN or the kind of taxpayer to pick the form"), the chooser still there; an individual with
     only a salary: ITR-2 until it is said that they are not a director in a company, held no unlisted equity shares and
     have no agricultural income above Rs 5,000 (rule 12), then ITR-1; a Yes to any keeps ITR-2. The heading shows no
     kind of taxpayer (never "Other") while it is not known. The same individual with presumptive business income:
     ITR-3 while rule 12 is not answered (ITR-4 is not for a director, unlisted shares or agricultural income above
     Rs 5,000), ITR-4 once all three are No, ITR-3 again for a director. Classic light and New look dark.
  5. the review of 24-Nov-2026 (2): the wording while rule 12 is not answered ("ITR-4 is not for someone who ... Answer
     the questions below to see if it fits."); ITR-4 chosen by hand with blank answers: no JSON, the questions named in
     the info tone; ITR-2's no-JSON-yet note in the info tone, not amber; a firm asked about unlisted shares (not
     director), ITR-5 for a Yes or assets abroad; Client setup a firm with a company PAN: ITR-6, said plainly.
TDSDESK_SHOTS=<dir> keeps the screenshots (deviceScaleFactor 2). Run on the React build:
TDSDESK_SITE=../app/dist-test python3 run_side_itr_ui.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
PORT = int(os.environ.get("SIDE_ITR_PORT") or 8963)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("TDSDESK_SHOTS", "")
SHOTS3 = os.environ.get("ITR3_SHOTS", "")
if SHOTS3: os.makedirs(SHOTS3, exist_ok=True)
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
SETUP = """() => { const c = newCompany({name: "Sample Works Private Limited", gstin: "07ZZZCX4321Z1Z5"}); c.pan = "ZZZCX4321Z"; S.companies[c.id] = c;
  const p = newCompany({name: "Sample Person", gstin: ""}); p.pan = "ZZZPX4321Z"; S.companies[p.id] = p;
  const n = newCompany({name: "Sample New Client", gstin: ""}); n.pan = ""; S.companies[n.id] = n;
  const f = newCompany({name: "Sample Partners", gstin: ""}); f.pan = "ZZZFX4321Z"; S.companies[f.id] = f;
  const k = newCompany({name: "Sample Traders Private Limited", gstin: ""}); k.pan = "ZZZCX5432Z"; k.entity = "F"; S.companies[k.id] = k;
  S.coId = c.id; S.view = "company"; render(); goClient("books:itr"); return [c.id, p.id, n.id, f.id, k.id]; }"""
# at a scroll of the sidebar: whether the top block (FinCom row and client card) is whole, painted, and on top of the menu
SIDE = """(y) => { const s = document.getElementById('side'); s.scrollTop = y;
  const top = s.querySelector('.side-top') || s.querySelector('.side-client'), brand = s.querySelector('.side-brand'), card = s.querySelector('.side-client');
  const tr = top.getBoundingClientRect(), br = brand.getBoundingClientRect(), cr = card ? card.getBoundingClientRect() : tr, sr = s.getBoundingClientRect();
  const bg = getComputedStyle(top).backgroundColor, opaque = !/rgba\\(.*,\\s*0(\\.\\d+)?\\)$/.test(bg) && bg !== 'transparent';
  const shown = [];
  for (let x = sr.left + 10; x < sr.right - 10; x += 14) for (let yy = Math.max(0, sr.top); yy < cr.bottom - 1; yy += 3) {
    const at = document.elementFromPoint(x, yy); if (!at) continue; const m = at.closest('.side-link, .side-label, .side-sep, .side-firm-label');
    if (m && !m.closest('.side-top') && !m.closest('.side-client')) shown.push(m.textContent.trim().slice(0, 16)); }
  return {scroll: Math.round(s.scrollTop), max: s.scrollHeight - s.clientHeight, brandTop: Math.round(br.top), brandBottom: Math.round(br.bottom), cardTop: Math.round(cr.top),
    brandShown: br.top >= sr.top - 1 && br.bottom <= cr.top + 1, opaque, bg, shown: [...new Set(shown)]}; }"""

def page(br, w, h, nl=False, fold=False, scheme="light"):
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, color_scheme=scheme)
    if nl: ctx.add_init_script("try { localStorage.setItem('fincom:newlook:local', 'on'); } catch (e) {}")
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    ids = pg.evaluate(SETUP); pg.wait_for_timeout(2500)
    if fold: pg.click("#side .side-fold"); pg.wait_for_timeout(500)
    return ctx, pg, ids
def shot(pg, name):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name + ".png"))

with sync_playwright() as p:
    br = p.chromium.launch()
    print("1. the sidebar scrolled: the FinCom row and the client card stay put, painted, above the menu")
    for nl, w, h, fold in ((False, 1000, 620, False), (False, 1440, 760, False), (False, 1000, 520, True), (True, 1000, 470, False), (True, 1440, 400, False)):
        tag = "%s-%d%s" % ("new" if nl else "classic", w, "-folded" if fold else "")
        ctx, pg, ids = page(br, w, h, nl, fold)
        r0 = pg.evaluate(SIDE, 0)
        ok(r0["max"] > 20, tag + ": the menu is longer than the window (scrolls %d px)" % r0["max"])
        for y in (40, 120, 10000):
            r = pg.evaluate(SIDE, y)
            ok(r["brandShown"], tag + " scrolled %d: the FinCom row is whole above the client card (top %d, card %d)" % (r["scroll"], r["brandTop"], r["cardTop"]))
            ok(r["opaque"], tag + " scrolled %d: the top block is painted (%s)" % (r["scroll"], r["bg"]))
            ok(not r["shown"], tag + " scrolled %d: no menu word shows over or above the client card %s" % (r["scroll"], r["shown"][:4]))
        pg.evaluate(SIDE, 120); pg.wait_for_timeout(200); shot(pg, "side-" + tag + "-scrolled")
        ctx.close()

    print("2. a company's return: ITR-6 recommended and defaulted; the chooser; a form that does not fit or has no JSON is said")
    ctx, pg, ids = page(br, 1000, 700)
    head = lambda: pg.locator(".itr-head h1").inner_text()
    ok(pg.locator("[data-itr]").count() == 1, "the Income tax return page is open")
    ok(head().startswith("ITR-6") and "Company" in head() and "ZZZCX4321Z" in head(), "the heading: ITR-6, Company, the PAN (%s)" % head().replace("\n", " "))
    ok(pg.locator("[data-itr-pick] [data-itr-form]").count() == 1 and pg.eval_on_selector("[data-itr-form]", "e => e.value") == "ITR-6", "a visible ITR form chooser on the page, ITR-6 chosen")
    ok(pg.locator("[data-itr-form]").is_visible(), "the chooser is visible")
    opts = pg.eval_on_selector_all("[data-itr-form] option", "os => os.map(o => o.textContent)")
    ok(len(opts) == 7 and "ITR-6 (recommended)" in opts and "ITR-5 (not for this client)" in opts, "every form offered, ITR-6 marked recommended, ITR-5 not for this client (%s)" % opts)
    why = pg.inner_text("[data-itr-why]")
    ok("Recommended: ITR-6" in why and "fourth letter is C" in why and "company" in why, "the reason in plain words: " + why)
    ok(pg.locator("[data-itr-form-warn]").count() == 0, "no warning for the recommended form")
    shot(pg, "itr-company-recommended")
    pg.select_option("[data-itr-form]", "ITR-5"); pg.wait_for_timeout(600)
    ok(head().startswith("ITR-5"), "ITR-5 chosen: the heading follows")
    warn = pg.inner_text("[data-itr-form-warn]") if pg.locator("[data-itr-form-warn]").count() else ""
    ok("ITR-5 is not for a company" in warn and "ITR-6" in warn, "ITR-5 for a company is said plainly: " + warn)
    kept = pg.evaluate("() => { const st = (S.books && S.books.itr || {})['2026|state'] || {}; return [S.books && S.books.cid === S.coId, st.form, st.formSet]; }")
    ok(kept == [True, "ITR-5", True], "the choice is kept in the client's books for AY 2026-27 (%s)" % kept)
    shot(pg, "itr-company-itr5-chosen")
    pg.click("[data-itr-tab=itr-json]"); pg.wait_for_timeout(700)
    ok(pg.locator("[data-itr-json=unsupported]").count() == 1 and pg.locator("[data-itr-download]").count() == 0, "the JSON step makes no JSON for ITR-5 for a company")
    shot(pg, "itr-company-itr5-json")
    pg.select_option("[data-itr-form]", "ITR-7"); pg.wait_for_timeout(600)
    warn = pg.inner_text("[data-itr-form-warn]") if pg.locator("[data-itr-form-warn]").count() else ""
    ok("cannot make the JSON for ITR-7" in warn, "ITR-7: FinCom's JSON does not cover it, said plainly: " + warn)
    ok(pg.locator("[data-itr-json=unsupported]").count() == 1 and "ITR-7" in pg.inner_text("[data-itr-json=unsupported]"), "the JSON step says so too")
    ok(pg.locator("[data-itr-exempt]").count() == 1, "the company is asked whether it claims exemption under section 11")
    pg.select_option("[data-itr-exempt]", "y"); pg.wait_for_timeout(600)
    ok("Recommended: ITR-7" in pg.inner_text("[data-itr-why]"), "claiming exemption: ITR-7 recommended")
    shot(pg, "itr-company-itr7")
    pg.select_option("[data-itr-exempt]", "n"); pg.wait_for_timeout(400)
    pg.select_option("[data-itr-form]", "ITR-5"); pg.wait_for_timeout(400)
    print("   another client keeps its own form")
    pg.evaluate("(id) => openCompany(id).then(() => goClient('books:itr'))", ids[1]); pg.wait_for_timeout(2500)
    ok(head().startswith("ITR-2") and "Individual" in head(), "the individual (fourth letter P, no books, no salary yet), rule 12 not answered: ITR-2 (%s)" % head().replace("\n", " "))
    ok("fourth letter is P" in pg.inner_text("[data-itr-why]"), "with its reason")
    for k, v in (("director", "n"), ("unlisted", "n"), ("agriOver", "n")): pg.select_option("[data-itr-q1=%s]" % k, v); pg.wait_for_timeout(400)
    ok(head().startswith("ITR-2"), "the three answered, the residential status not yet: still ITR-2 (%s)" % head().split("\n")[0])
    pg.select_option("[data-itr-res]", "RES"); pg.wait_for_timeout(400)
    ok(head().startswith("ITR-1"), "not a director, no unlisted shares, no agricultural income above Rs 5,000, a resident: ITR-1 (%s)" % head().split("\n")[0])
    ok(pg.locator("[data-itr-form-warn]").count() == 1 and "cannot make the JSON for ITR-1" in pg.inner_text("[data-itr-form-warn]"), "ITR-1 has no JSON in FinCom yet: said")
    shot(pg, "itr-individual")
    pg.evaluate("(id) => openCompany(id).then(() => goClient('books:itr'))", ids[0]); pg.wait_for_timeout(2500)
    ok(head().startswith("ITR-5"), "back on the company: its own choice (ITR-5) kept (%s)" % head().split("\n")[0])
    pg.click("[data-itr-use-rec]"); pg.wait_for_timeout(600)
    ok(head().startswith("ITR-6") and pg.locator("[data-itr-form-warn]").count() == 0, "Use ITR-6: back to the recommendation")
    pg.click("[data-itr-tab=itr-json]"); pg.wait_for_timeout(700)
    ok(pg.locator("[data-itr-json=unsupported]").count() == 0, "ITR-6: the JSON step builds its JSON (as before)")
    ctx.close()
    print("4. no PAN and no kind of taxpayer: no form picked, no JSON; an individual: ITR-2 until rule 12 is answered")
    SHOTS2 = os.environ.get("ITR2_SHOTS", "")
    if SHOTS2: os.makedirs(SHOTS2, exist_ok=True)
    NOKIND = "FinCom needs the PAN or the kind of taxpayer to pick the form"
    for nl, scheme in ((False, "light"), (True, "dark")):
        look = "[%s %s] " % ("new look" if nl else "classic", scheme)
        ctx, pg, ids = page(br, 1000, 700, nl=nl, scheme=scheme)
        pg.evaluate("(id) => openCompany(id).then(() => goClient('books:itr'))", ids[2]); pg.wait_for_timeout(2500)
        ok(pg.locator("[data-itr-pick] [data-itr-form]").count() == 1 and pg.locator("[data-itr-form]").is_visible(), look + "no PAN: the ITR form chooser is still there")
        warn = pg.inner_text("[data-itr-form-warn]") if pg.locator("[data-itr-form-warn]").count() else ""
        ok(NOKIND in warn, look + "no PAN: said plainly: " + warn)
        ok(pg.eval_on_selector("[data-itr-form-warn]", "e => e.dataset.tone") == "info", look + "no PAN: the note in the info tone, not red (the review of 24-Nov-2026 (3))")
        ok("No form recommended" in pg.inner_text("[data-itr-why]") and "(recommended)" not in " ".join(pg.eval_on_selector_all("[data-itr-form] option", "os => os.map(o => o.textContent)")), look + "no PAN: no form recommended on a guess")
        ok(head().startswith("ITR form not picked") and pg.locator("[data-itr-use-rec]").count() == 0, look + "no PAN: the heading says no form is picked (%s)" % head().split("\n")[0])
        ok("Other" not in head() and head().strip() == "ITR form not picked" and pg.locator(".itr-head [data-itr-kind]").count() == 0, look + "no PAN: no kind of taxpayer shown next to it until it is known (%r)" % head())
        if SHOTS2: pg.screenshot(path=os.path.join(SHOTS2, "nopan-%s-%s.png" % ("newlook" if nl else "classic", scheme)))
        for f in ("ITR-6", "ITR-3"):
            pg.select_option("[data-itr-form]", f); pg.wait_for_timeout(500)
            ok(NOKIND in (pg.inner_text("[data-itr-form-warn]") if pg.locator("[data-itr-form-warn]").count() else ""), look + "no PAN, %s chosen by hand: still no JSON, said" % f)
            pg.click("[data-itr-tab=itr-json]"); pg.wait_for_timeout(700)
            ok(pg.locator("[data-itr-json=unsupported]").count() == 1 and pg.locator("[data-itr-download]").count() == 0 and NOKIND in pg.inner_text("[data-itr-json=unsupported]"), look + "no PAN, %s: the JSON step makes no JSON and says why" % f)
        pg.evaluate("(id) => openCompany(id).then(() => goClient('books:itr'))", ids[1]); pg.wait_for_timeout(2500)
        why = pg.inner_text("[data-itr-why]")
        ok(head().startswith("ITR-2") and "Recommended: ITR-2" in why and "ITR-1 is not for someone who is a director in a company, held unlisted shares, has agricultural income above Rs 5,000 or is a non-resident or not ordinarily resident. Answer the questions below to see if it fits." in why, look + "an individual, rule 12 not answered: ITR-2, and why in plain words: " + why)
        ok("does not know yet" not in why, look + "not said as if ITR-1 were ruled out already")
        tone = pg.eval_on_selector("[data-itr-form-warn]", "e => [e.dataset.tone, getComputedStyle(e).backgroundColor, getComputedStyle(e.closest('.itr')).getPropertyValue('--itr-warn-bg')]") if pg.locator("[data-itr-form-warn]").count() else None
        ok(tone and tone[0] == "info" and "cannot make the JSON for ITR-2 yet" in pg.inner_text("[data-itr-form-warn]") and "Winman" in pg.inner_text("[data-itr-form-warn]"), look + "ITR-2's no-JSON-yet note in the info tone (%s)" % (tone,))
        ok(tone and tone[1] != pg.evaluate("() => { const d = document.createElement('div'); d.style.background = getComputedStyle(document.querySelector('.itr')).getPropertyValue('--itr-warn-bg'); document.querySelector('.itr').appendChild(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }"), look + "not amber (%s)" % (tone,))
        ok(pg.locator("[data-itr-q1]").count() == 3, look + "the three questions are asked on the form box")
        if SHOTS2: pg.screenshot(path=os.path.join(SHOTS2, "itr2-%s-%s.png" % ("newlook" if nl else "classic", scheme)))
        pg.select_option("[data-itr-q1=director]", "y"); pg.wait_for_timeout(400)
        for k in ("unlisted", "agriOver"): pg.select_option("[data-itr-q1=%s]" % k, "n"); pg.wait_for_timeout(400)
        why = pg.inner_text("[data-itr-why]")
        ok(head().startswith("ITR-2") and "not for someone who is a director in a company" in why, look + "a director in a company: ITR-2, said: " + why)
        if SHOTS2: pg.screenshot(path=os.path.join(SHOTS2, "itr2-director-%s-%s.png" % ("newlook" if nl else "classic", scheme)))
        pg.select_option("[data-itr-q1=director]", ""); pg.wait_for_timeout(300)
        # presumptive business income: ITR-4 only once rule 12 is answered; until then ITR-3, said why
        for k in ("unlisted", "agriOver"): pg.select_option("[data-itr-q1=%s]" % k, ""); pg.wait_for_timeout(300)
        pg.select_option("[data-itr-presq]", "y"); pg.wait_for_timeout(500)
        why = pg.inner_text("[data-itr-why]")
        ok(head().startswith("ITR-3") and "Individual" in head() and "Recommended: ITR-3" in why and "business or profession" in why
           and "ITR-4 is not for someone who is a director in a company, held unlisted shares, has agricultural income above Rs 5,000 or is a non-resident or not ordinarily resident. Answer the questions below to see if it fits." in why, look + "presumptive income, rule 12 not answered: ITR-3, and why in plain words: " + why)
        # ITR-4 chosen by hand with the answers blank: no JSON until they are given, the questions named, info tone
        pg.select_option("[data-itr-form]", "ITR-4"); pg.wait_for_timeout(500)
        warn = pg.inner_text("[data-itr-form-warn]") if pg.locator("[data-itr-form-warn]").count() else ""
        ok("answer the questions below" in warn and "director" in warn and pg.eval_on_selector("[data-itr-pick]", "e => e.dataset.json") == "0" and pg.eval_on_selector("[data-itr-form-warn]", "e => e.dataset.tone") == "info", look + "ITR-4 by hand, answers blank: no JSON, the questions named, info tone: " + warn)
        if SHOTS2: pg.screenshot(path=os.path.join(SHOTS2, "itr4-blank-%s-%s.png" % ("newlook" if nl else "classic", scheme)))
        pg.click("[data-itr-tab=itr-json]"); pg.wait_for_timeout(700)
        ok(pg.locator("[data-itr-json=unsupported]").count() == 1 and pg.locator("[data-itr-download]").count() == 0, look + "ITR-4 by hand, answers blank: the JSON step makes no JSON")
        pg.click("[data-itr-use-rec]"); pg.wait_for_timeout(500)
        ok(pg.locator("[data-itr-q1]").count() == 3 and pg.locator("[data-itr-form-warn]").count() == 0, look + "the three questions asked, no warning for ITR-3")
        if SHOTS2: pg.screenshot(path=os.path.join(SHOTS2, "itr3-%s-%s.png" % ("newlook" if nl else "classic", scheme)))
        for k in ("director", "unlisted", "agriOver"): pg.select_option("[data-itr-q1=%s]" % k, "n"); pg.wait_for_timeout(400)
        pg.select_option("[data-itr-res]", "RES"); pg.wait_for_timeout(400)
        why = pg.inner_text("[data-itr-why]")
        ok(head().startswith("ITR-4") and "Recommended: ITR-4" in why, look + "presumptive income, all three No, a resident: ITR-4: " + why)
        pg.select_option("[data-itr-q1=director]", "y"); pg.wait_for_timeout(400)
        why = pg.inner_text("[data-itr-why]")
        ok(head().startswith("ITR-3") and "ITR-4 is not for someone who is a director in a company" in why, look + "presumptive income, a director: ITR-3, said: " + why)
        opts = pg.eval_on_selector_all("[data-itr-form] option", "os => os.map(o => o.textContent)")
        ok("ITR-4 (not for this client)" in opts, look + "a director: ITR-4 marked not for this client (%s)" % opts)
        pg.select_option("[data-itr-form]", "ITR-4"); pg.wait_for_timeout(500)
        warn = pg.inner_text("[data-itr-form-warn]") if pg.locator("[data-itr-form-warn]").count() else ""
        ok("ITR-4 is not for someone who is a director in a company" in warn and pg.eval_on_selector("[data-itr-pick]", "e => e.dataset.json") == "0", look + "ITR-4 chosen by hand for a director: no JSON, said: " + warn)
        ctx.close()
    print("5. the review of 24-Nov-2026 (2): a firm asked about unlisted shares; the PAN settles the kind; assets abroad")
    ctx, pg, ids = page(br, 1000, 700)
    pg.evaluate("(id) => openCompany(id).then(() => goClient('books:itr'))", ids[3]); pg.wait_for_timeout(2500)
    pg.select_option("[data-itr-presq]", "y"); pg.wait_for_timeout(500)
    qs = pg.eval_on_selector_all("[data-itr-q1]", "es => es.map(e => e.dataset.itrQ1)")
    ok(qs == ["unlisted", "agriOver"], "a firm with presumptive income: asked about unlisted shares and agricultural income, not director (%s)" % qs)
    why = pg.inner_text("[data-itr-why]")
    ok(head().startswith("ITR-5") and "ITR-4 is not for a firm that is an LLP, held unlisted shares or has agricultural income above Rs 5,000. Answer the questions below to see if it fits." in why, "a firm, not answered: ITR-5, said: " + why)
    ok(pg.locator("[data-itr-pick] [data-itr-llp]").count() == 1, "a firm: firm or LLP is asked on the form box too (the review of 24-Nov-2026 (3))")
    pg.select_option("[data-itr-q1=agriOver]", "n"); pg.select_option("[data-itr-q1=unlisted]", "y"); pg.wait_for_timeout(500)
    ok(head().startswith("ITR-5") and "not for a firm that held unlisted shares" in pg.inner_text("[data-itr-why]"), "a firm that held unlisted shares: ITR-5: " + pg.inner_text("[data-itr-why]"))
    pg.select_option("[data-itr-q1=unlisted]", "n"); pg.wait_for_timeout(500)
    why = pg.inner_text("[data-itr-why]")
    ok(head().startswith("ITR-5") and "ITR-4 is not for a firm that is an LLP. Answer the questions below to see if it fits." in why, "a firm, both No, firm or LLP not answered: ITR-5, never ITR-4 on a guess (%s): %s" % (head().split("\n")[0], why))
    if SHOTS2: pg.screenshot(path=os.path.join(SHOTS2, "firm-llp-blank-classic-light.png"))
    pg.select_option("[data-itr-pick] [data-itr-llp]", "firm"); pg.wait_for_timeout(500)
    ok(head().startswith("ITR-4") and pg.evaluate("() => S.books.itr['2026|state'].llp") is False, "a partnership firm, both No: ITR-4, kept where Data keeps it (%s)" % head().split("\n")[0])
    if SHOTS2: pg.screenshot(path=os.path.join(SHOTS2, "firm-itr4-classic-light.png"))
    pg.evaluate("() => { const st = S.books.itr['2026|state']; st.profile = Object.assign({}, st.profile, { foreignAssets: 'YES' }); }")
    pg.evaluate("(id) => openCompany(id).then(() => goClient('books:itr'))", ids[3]); pg.wait_for_timeout(2500)
    ok(head().startswith("ITR-5") and "outside India" in pg.inner_text("[data-itr-why]"), "a firm with assets outside India: ITR-5, said: " + pg.inner_text("[data-itr-why]"))
    pg.evaluate("(id) => openCompany(id).then(() => goClient('books:itr'))", ids[4]); pg.wait_for_timeout(2500)
    why = pg.inner_text("[data-itr-why]")
    ok(head().startswith("ITR-6") and "Company" in head() and "fourth letter is C" in why and "Client setup says a firm or LLP" in why and "FinCom follows the PAN" in why, "Client setup a firm, the PAN a company: ITR-6, said plainly: %s | %s" % (head().replace("\n", " "), why))
    opts = pg.eval_on_selector_all("[data-itr-form] option", "os => os.map(o => o.textContent)")
    ok("ITR-5 (not for this client)" in opts and "ITR-4 (not for this client)" in opts, "a company PAN: ITR-4 and ITR-5 not for this client (%s)" % opts)
    if SHOTS2: pg.screenshot(path=os.path.join(SHOTS2, "pan-vs-setup-classic-light.png"))
    ctx.close()
    print("6. the review of 24-Nov-2026 (3): the residential status on the form box, Schedule FA rows left, the Losses card on ITR-4, a HUF's karta")
    ctx, pg, ids = page(br, 1000, 760)
    st = lambda: pg.evaluate("() => S.books.itr['2026|state'] || {}")
    reopen = lambda i: (pg.evaluate("(id) => openCompany(id).then(() => goClient('books:itr'))", i), pg.wait_for_timeout(2500))
    reopen(ids[1])
    ok(pg.locator("[data-itr-pick] [data-itr-res]").count() == 1, "an individual: the residential status is asked on the form box")
    opts = pg.eval_on_selector_all("[data-itr-res] option", "os => os.map(o => o.textContent)")
    ok(opts == ["Choose", "Resident", "Not ordinarily resident", "Non-resident"], "its choices (%s)" % opts)
    pg.select_option("[data-itr-presq]", "y"); pg.wait_for_timeout(400)
    for k in ("director", "unlisted", "agriOver"): pg.select_option("[data-itr-q1=%s]" % k, "n"); pg.wait_for_timeout(300)
    why = pg.inner_text("[data-itr-why]")
    ok(head().startswith("ITR-3") and "ITR-4 is not for someone who is a non-resident or not ordinarily resident. Answer the questions below to see if it fits." in why, "rule 12 answered, the residential status not set: ITR-3, not on a guess: " + why)
    opts = pg.eval_on_selector_all("[data-itr-form] option", "os => os.map(o => o.textContent)")
    ok("ITR-4" in opts and "ITR-4 (not for this client)" not in opts, "not set: ITR-4 not barred (%s)" % opts)
    pg.select_option("[data-itr-form]", "ITR-4"); pg.wait_for_timeout(500)
    warn = pg.inner_text("[data-itr-form-warn]") if pg.locator("[data-itr-form-warn]").count() else ""
    ok("the residential status" in warn and pg.eval_on_selector("[data-itr-pick]", "e => e.dataset.json") == "0" and pg.eval_on_selector("[data-itr-form-warn]", "e => e.dataset.tone") == "info", "ITR-4 by hand, not set: no JSON until it is chosen, info tone: " + warn)
    shot3 = lambda n: SHOTS3 and pg.screenshot(path=os.path.join(SHOTS3, n + ".png"))
    shot3("itr4-residential-blank")
    for code, words in (("NOR", "not ordinarily resident"), ("NRI", "is a non-resident")):
        pg.select_option("[data-itr-res]", code); pg.wait_for_timeout(500)
        warn = pg.inner_text("[data-itr-form-warn]") if pg.locator("[data-itr-form-warn]").count() else ""
        ok(words in warn and pg.eval_on_selector("[data-itr-pick]", "e => e.dataset.fits") == "0" and "ITR-3" in pg.inner_text("[data-itr-why]"), code + ": ITR-4 does not fit, ITR-3 recommended: " + warn)
    pg.select_option("[data-itr-res]", "RES"); pg.wait_for_timeout(500)
    ok(pg.eval_on_selector("[data-itr-pick]", "e => e.dataset.json") == "1" and st().get("resident") == "RES", "Resident: the ITR-4 JSON can be made; kept as the return's residential status (%s)" % st().get("resident"))
    shot3("itr4-resident")
    pg.click("[data-itr-use-rec]") if pg.locator("[data-itr-use-rec]").count() else None
    lbl = pg.eval_on_selector("[data-itr-q1=director]", "e => e.closest('label').innerText")
    ok("director in a company" in lbl, "an individual's director question: " + lbl)
    print("   Schedule FA rows left after the answer is changed to No")
    pg.evaluate("() => { const s = S.books.itr['2026|state']; s.profile = Object.assign({}, s.profile, { foreignAssets: 'NO' }); s.fa = { DtlsForeignBank: [{ CountryName: 'DEMO LAND', AccountNumber: '000111' }] }; }")
    reopen(ids[1])
    why = pg.inner_text("[data-itr-why]")
    ok("Recommended: ITR-3" in why and "Schedule FA" in why and pg.eval_on_selector("[data-itr-pick]", "e => e.dataset.fits") == "0", "rows left in Schedule FA after a No: ITR-4 barred while they are there: " + why)
    ok(pg.locator("[data-itr-pick] [data-itr-fa-left]").count() == 1 and pg.locator("[data-itr-fa-remove]").inner_text().strip() == "Remove these rows", "the note offers Remove these rows")
    ok(pg.eval_on_selector("[data-itr-fa-left]", "e => e.dataset.tone") == "info", "in the info tone, not a warning")
    shot3("fa-rows-left")
    pg.click("[data-itr-fa-remove]"); pg.wait_for_timeout(600)
    ok("Recommended: ITR-4" in pg.inner_text("[data-itr-why]") and pg.locator("[data-itr-fa-left]").count() == 0, "rows removed: ITR-4 again (%s)" % pg.inner_text("[data-itr-why]")[:40])
    ok(pg.evaluate("() => { const fa = S.books.itr['2026|state'].fa || {}; return Object.values(fa).filter(Array.isArray).reduce((a, v) => a + v.length, 0); }") == 0, "and Schedule FA has no rows")
    print("   a loss of earlier years on ITR-4: the Losses card is there to remove it; a loss lost under section 80 does not count")
    pg.evaluate("() => { S.books.itr['2026|state'].losses = { business: [{ ay: '2022', amt: 40000, filed: '20220725', inTime: true }] }; }")
    reopen(ids[1])
    ok("Recommended: ITR-3" in pg.inner_text("[data-itr-why]") and "loss of earlier years" in pg.inner_text("[data-itr-why]"), "a business loss brought forward: ITR-3 recommended, ITR-4 (chosen by hand) barred: " + pg.inner_text("[data-itr-why]")[:60])
    pg.select_option("[data-itr-form]", "ITR-4"); pg.wait_for_timeout(500)
    pg.click("[data-itr-tab=itr-sch]"); pg.wait_for_timeout(700)
    ok(pg.locator("[data-itr-sched=losses]").count() == 1, "ITR-4 chosen, a loss entry barring it: the Losses card is on Schedules")
    shot3("itr4-losses-card")
    pg.select_option("[data-itr-sched=losses] [data-itr-sub=bfloss] select >> nth=2", "n"); pg.wait_for_timeout(600)
    ok(pg.eval_on_selector("[data-itr-pick]", "e => e.dataset.fits") == "1" and pg.locator("[data-itr-sched=losses]").count() == 1, "marked No: the loss is lost (section 80): ITR-4 fits; the card stays while the entry is there")
    pg.click("[data-itr-sched=losses] [data-itr-sub=bfloss] .itr-rm"); pg.wait_for_timeout(600)
    ok(pg.evaluate("() => (S.books.itr['2026|state'].losses.business || []).length") == 0 and pg.locator("[data-itr-form-warn][data-tone=bad]").count() == 0, "the entry removed: nothing bars ITR-4")
    print("   a HUF: the director question is about its karta")
    hid = pg.evaluate("() => { const h = newCompany({name: 'Sample Family HUF', gstin: ''}); h.pan = 'ZZZHX4321Z'; S.companies[h.id] = h; return h.id; }")
    reopen(hid)
    pg.select_option("[data-itr-presq]", "y"); pg.wait_for_timeout(400)
    lbl = pg.eval_on_selector("[data-itr-q1=director]", "e => e.closest('label').innerText")
    ok("karta" in lbl.lower() and pg.locator("[data-itr-res]").count() == 1, "a HUF: the karta's directorship and the residential status asked: " + lbl)
    pg.select_option("[data-itr-q1=director]", "y"); pg.wait_for_timeout(400)
    why = pg.inner_text("[data-itr-why]")
    ok("HUF that is a director" not in why and "whose karta is a director in a company" in why, "a HUF whose karta is a director: said so: " + why)
    shot3("huf-karta")
    ctx.close()
    print("3. on a phone (390 px): the chooser and its questions fit the width")
    ctx = br.new_context(viewport={"width": 390, "height": 800}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    pg.evaluate(SETUP); pg.wait_for_timeout(2500)
    wide = pg.evaluate("() => [document.documentElement.scrollWidth, [...document.querySelectorAll('.itr-pick, .itr-pick *')].filter(e => e.getBoundingClientRect().right > 391).map(e => e.tagName + ' ' + e.textContent.slice(0, 30))]")
    ok(pg.locator("[data-itr-exempt]").count() == 1 and wide[0] <= 391 and not wide[1], "phone: the ITR form box fits 390 px (page %d wide %s)" % (wide[0], wide[1][:3]))
    shot(pg, "itr-company-phone")
    ctx.close()
    br.close()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\n%d checks failed" % len(fails) if fails else "\nall passed")
raise SystemExit(1 if fails else 0)
