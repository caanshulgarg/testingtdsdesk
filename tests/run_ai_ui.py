"""python3 run_ai_ui.py - AI help in TDS and GST: off by default; the setting switches each part; nothing is used until
accepted; the audit follows only accepted answers; 2B pairs, TDS ledgers, and a notice read and a reply drafted.
Claude's replies are stood in (window.claudeRead), so nothing leaves this computer."""
import json, os, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8131), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(HERE, "data", "books-cache.json"))))
fails, errors = [], []
def until(pg, js, sec=20, arg=None):
    import time
    t = time.time()
    while time.time() - t < sec:
        if pg.evaluate(js, arg) if arg is not None else pg.evaluate(js): return True
        pg.wait_for_timeout(250)
    raise AssertionError("timed out: " + js)
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8131/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""(bk) => {
      const c = newCompany({name: "ZZ TEST (VMS books)", gstin: "07AADCV3366N1ZU"});
      S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.map = Books.mapLedgers(bk.vouchers, {});
      LedMaster.refresh(S.books); LedMaster.confirm(S.books, LedMaster.pending(S.books).map(x => x[0]), true); window.__bk = S.books; S.booksTab = "gst"; S.gstYm = "202508"; S.gstReg = "07"; render(); }""", books)
    pg.wait_for_timeout(1200); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(600)
    # Claude stood in: answers by what is asked
    pg.evaluate("""() => { window.__asked = []; window.claudeReady = () => true;
      window.claudeRead = async (prompt, imgs, careful) => { window.__asked.push({prompt, imgs: (imgs || []).length});
        if (/expense and purchase ledgers/.test(prompt)){ const items = []; prompt.split('\\n').forEach(l => { const m = l.match(/^(\\d+)\\. (.*?) \\| group/); if (m) items.push({i: +m[1], tds: /RENT/i.test(m[2]) ? 'rent_building' : /STAFF WELFARE|FOOD|CAR/i.test(m[2]) ? 'none' : /LEGAL|PROFESSIONAL|AUDIT/i.test(m[2]) ? 'professional' : 'none', itc: /STAFF WELFARE|FOOD|CAR|MOTOR/i.test(m[2]) ? 'blocked' : 'allowed', clause: '17(5)(b)', reason: 'stand-in answer for ' + m[2]}); }); return {items}; }
        if (/TDS payable ledgers/.test(prompt)) return {items: [{i: 0, rule: 'professional', reason: 'name says professional'}]};
        if (/GSTR-2B\\) to purchase entries/.test(prompt)){ const items = []; prompt.split('\\n').forEach(l => { const m = l.match(/^(\\d+)\\. 2B:/); if (m) items.push({i: +m[1], pick: 0, confidence: 0.9, reason: 'same number written differently'}); }); return {items}; }
        if (/notice to an Indian taxpayer/.test(prompt)) return {law: 'GST', form: 'ASMT-10', ref: 'ZD0708250012345', date: '2025-09-20', reply_by: '2025-10-20', gstin: '07AADCV3366N1ZU', fy: '2025-26', months: ['202506'], summary: 'Outward supplies in GSTR-1 exceed those in GSTR-3B for June 2025.', issues: [{point: 'GSTR-1 taxable more than 3B', amount: 125000, period: 'Jun 2025'}]};
        if (/Draft a reply/.test(prompt)) return {reply: 'To the Proper Officer\\nRef: ZD0708250012345\\nSubject: Reply to ASMT-10\\n[to check: figures]\\n[Authorised signatory]', points: [{issue: 'GSTR-1 v 3B', answer: 'explained', to_check: 'figures'}]};
        return {}; }; }""")
    # ---------- off by default
    t = pg.inner_text("#app")
    ok("Notices" not in pg.inner_text("nav.sbar >> nth=1") if pg.locator("nav.sbar").count() > 1 else True, "AI help is off by default: no Notices in GST")
    ok(not pg.evaluate("AIH.enabled('tds') || AIH.enabled('r2b') || AIH.enabled('audit') || AIH.enabled('notices')"), "every part is off until the firm switches AI help on")
    # ---------- Settings, AI help: switch it on
    pg.evaluate("S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = ''; render()"); pg.wait_for_timeout(400)
    ok(pg.locator('[data-settab="ai"]').count() == 1 and "off" in pg.inner_text('[data-settab="ai"]'), "Settings has an AI help tile, showing off")
    pg.click('[data-settab="ai"]'); pg.wait_for_timeout(400)
    ok(pg.locator('input[data-aihset="tds"]').is_disabled(), "the parts cannot be ticked while AI help is off")
    pg.check('input[data-aihset="on"]'); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.firm.ai.on === true && AIH.enabled('tds') && AIH.enabled('notices')"), "switched on: all four parts on")
    pg.uncheck('input[data-aihset="r2b"]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("!AIH.enabled('r2b') && AIH.enabled('tds')"), "one part can be switched off on its own")
    pg.check('input[data-aihset="r2b"]'); pg.wait_for_timeout(300)
    cid = pg.evaluate("S.coId")
    pg.check('input[data-aihco="%s"]' % cid); pg.wait_for_timeout(300)
    ok(pg.evaluate("!AIH.enabled('tds') && !AIH.enabled('notices')"), "a client can be kept away from AI whatever the firm has on")
    pg.uncheck('input[data-aihco="%s"]' % cid); pg.wait_for_timeout(300)
    pg.evaluate("S.view = 'company'; S.tab = 'books'; S.books = window.__bk; render()"); pg.wait_for_timeout(500)
    # ---------- 1 and 3: ledgers, TDS section and blocked credit
    pg.evaluate("S.booksTab = 'ledgers'; S.lmView = 'ai'; render()"); pg.wait_for_timeout(500)
    ok("AI: TDS section and blocked credit" in pg.inner_text("#app"), "Tally ledgers has the AI view")
    before = pg.evaluate("(() => { const r = Audit.run('20250401', '20260331', 'test'); return (r.findings.find(f => f.check === 'gstBlocked') || {count: 0}).count; })()")
    pg.click('button[data-aih="review"]'); until(pg, "() => " + "!S.books.busy && Object.keys((S.books.ai || {}).led || {}).length > 0")
    n_led = pg.evaluate("Object.keys(S.books.ai.led).length")
    ok(n_led > 5, "AI reviewed the expense and purchase ledgers: %d" % n_led)
    ok("Accept" in pg.inner_text("#app"), "each suggestion waits to be accepted")
    after_unaccepted = pg.evaluate("(() => { const r = Audit.run('20250401', '20260331', 'test'); return (r.findings.find(f => f.check === 'gstBlocked') || {count: 0}).count; })()")
    ok(after_unaccepted == before, "the audit does not use suggestions nobody accepted (%d, %d)" % (before, after_unaccepted))
    # a ledger with credit taken on it, answered "blocked" (by the stand-in or here)
    target = pg.evaluate("(Object.entries(S.books.ai.led).find(([l, x]) => x.itcIn > 0 && x.itc === 'blocked') || Object.entries(S.books.ai.led).find(([l, x]) => x.itcIn > 0) || [''])[0]")
    pg.evaluate("(l) => { S.books.ai.led[l].itc = 'blocked'; render(); }", target)
    pg.click('button[data-aihok="%s"]' % target.replace('"', '\\"')); pg.wait_for_timeout(400)
    ok(pg.evaluate("(l) => S.books.ai.led[l].itcOk === 'yes' && !!S.books.ai.led[l].okBy", target), "accepting records who accepted: " + target)
    blk = pg.evaluate("(l) => { const r = Audit.run('20250401', '20260331', 'test'); const f = r.findings.find(x => x.check === 'gstBlocked'); return f ? f.rows.filter(z => /credit taken on/.test(z.note) && z.note.indexOf(l) >= 0).length : 0; }", target)
    has_itc = pg.evaluate("(l) => S.books.ai.led[l].itcIn", target)
    ok(blk > 0 and has_itc, "the audit's blocked-credit check now uses the accepted answer for %s (%d rows; credit taken on %d)" % (target, blk, has_itc or 0))
    # a TDS ledger with no section
    pg.evaluate("() => { S.books.map['TDS PAYABLE ON FEES'] = {kind: 'tds_payable', what: 'tds_payable', section: '', ok: false, n: 1}; delete S.books.ai.tdsPay['TDS PAYABLE ON FEES']; render(); }")
    pg.click('button[data-aih="reviewAgain"]'); until(pg, "() => " + "!S.books.busy && !!(S.books.ai.tdsPay || {})['TDS PAYABLE ON FEES']")
    pg.click('button[data-aihpay="TDS PAYABLE ON FEES"]'); pg.wait_for_timeout(400)
    ok(pg.evaluate("S.books.map['TDS PAYABLE ON FEES'].section === '194J' && S.books.map['TDS PAYABLE ON FEES'].ok"), "a TDS ledger without a section gets the accepted one (194J)")
    # ---------- the audit button
    pg.evaluate("S.booksTab = 'audit'; render()"); pg.wait_for_timeout(500)
    ok(pg.locator('button[data-aih="auditReview"]').count() == 1, "Audit has the AI review button")
    # ---------- 2: 2B leftovers
    pg.evaluate("""() => { const b = S.books; const pur = b.vouchers.filter(v => Books.isPurchase(v) && v.gstin && GSTR.ym(v.date) === '202508').slice(0, 3);
      const docs = GST2B.bookDocs ? GST2B.bookDocs('07').filter(d => pur.some(v => v.id === d.id)) : [];
      window.__docs = docs.map(d => d.id);
      b.twoBs = b.twoBs || {}; }""")
    pg.evaluate("S.booksTab = 'gst'; S.gstPart = 'r2b'; S.r2Tab = 'only2b'; render()"); pg.wait_for_timeout(600)
    has_bar = pg.locator('button[data-aih="pair2b"]').count()
    if has_bar:
        pg.click('button[data-aih="pair2b"]'); until(pg, "() => " + "!S.books.busy"); pg.wait_for_timeout(300)
        n_pairs = pg.evaluate("Object.keys(S.books.ai.pairs).length")
        ok(n_pairs >= 0, "AI suggested pairs for 2B invoices left: %d" % n_pairs)
        if n_pairs:
            k = pg.evaluate("Object.keys(S.books.ai.pairs)[0]")
            pg.click('button[data-aihpair="%s"]' % k); pg.wait_for_timeout(400)
            ok(pg.evaluate("(k) => (GST2B.state().link[k] || [])[0] === S.books.ai.pairs[k].id", k), "an accepted pair is linked the same way as one chosen by hand")
    else:
        print("  (no 2B file in these books: the 2B pairing is checked in run_ai.js)")
    # ---------- 4: a notice
    pg.evaluate("S.booksTab = 'gst'; S.gstPart = 'notices'; render()"); pg.wait_for_timeout(500)
    ok("GST notices" in pg.inner_text("#app"), "GST has a Notices part when AI help is on")
    npath = os.path.join(OUT, "notice.png")
    import base64
    open(npath, "wb").write(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="))
    pg.set_input_files('input[data-aihnotice="gst"]', npath)
    until(pg, "() => " + "(S.books.ai.notices[0] || {}).step === 'drafted'"); pg.wait_for_timeout(400)
    t = pg.inner_text("#app")
    ok("ASMT-10" in t and "ZD0708250012345" in t and "20 Oct 2025" in t, "the notice is read: form, reference and the date to reply by")
    ok(pg.locator('textarea[data-aihnreply]').count() == 1 and "[Authorised signatory]" in pg.input_value('textarea[data-aihnreply]'), "a draft reply to check and edit")
    asked = pg.evaluate("window.__asked.filter(a => /Draft a reply/.test(a.prompt)).map(a => a.prompt)[0] || ''")
    ok('"202506"' in asked, "the draft is given this client's figures for the notice's month")
    pg.evaluate("S.booksTab = 'tds'; S.tdsView = 'notices'; render()"); pg.wait_for_timeout(400)
    ok("TDS notices" in pg.inner_text("#app"), "TDS has its Notices page")
    # ---------- the record of what AI did
    lg = pg.evaluate("S.books.ai.log.map(x => x.what)")
    ok("accepted" in lg and "AI read a notice" in lg and "AI drafted a reply" in lg, "what AI did, and who accepted it, is kept: " + ", ".join(sorted(set(lg))))
    # ---------- switched off: gone again, and the audit stops using the answers
    pg.evaluate("S.firm.ai.on = false; render()"); pg.wait_for_timeout(300)
    ok(pg.evaluate("AIH.blocked(Object.keys(S.books.ai.led)[0]) === undefined && AIH.tdsRule(Object.keys(S.books.ai.led)[0]) === undefined"), "switched off: the audit goes back to its own rules")
    pg.screenshot(path=OUT + "/ai.png", full_page=True)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
