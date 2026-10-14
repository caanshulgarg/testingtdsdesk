"""python3 run_ledger_confirm.py - TDS and GST ledgers confirmed on the TDS and GST pages (the owner's request of
14-Oct-2026: "When we click confirm ledger, if we want to unconfirm that, we can do that. Ledgers from Tally should appear
while confirming, a default guess from AI reading every ledger should be there. Earlier TDS and GST ledger confirmation in
TDS and GST pages was good UI; we should do that from there only, so remove that from Settings.")
  A. Where: the TDS page's line "N ledgers to confirm → Confirm" opens the TDS page's Ledgers in place (TDS ledgers only);
     the GST page has a Ledgers section (GST ledgers only); TDS / GST / All switch between them.
  B. The old places redirect: …/books/ledgers, …/from-tally/ledgers, booksTabGo("ledgers"), lmViewGo, the TDS page's More.
  C. Confirm and Unconfirm round trip: who and when kept on the ledger (okBy / okAt, then unok and the history); the
     answer kept (back to "to confirm" with its last guess); the figures do not move; it survives opening the books again.
  D. A return marked filed: Unconfirm leaves it as it is and the row says the filed return used the earlier choice.
  E. The AI guess (a fake AI): asked once, for the ledgers the rules cannot tell only; shown as "AI guess" with its reason;
     counted in nothing (the ledger master unchanged, the figures the same) until a person confirms it; then confirmed as AI's.
  F. AI off (no firm account, or the firm's switch off): no call; the rules' guesses and "Not known" as before.
  G. The ledgers from Tally: a Tally ledger no entry uses appears (with its opening from the cloud copy); the picker
     ("TDS payable 194C") lists the cloud copy's ledgers, the right one first; a choice is confirmed, then unconfirmed.
  H. Settings: no GST / TDS / reverse charge ledger boxes or their Confirm; one line pointing to the TDS and GST pages.
  I. The figures of every return are the same before and after "Confirm all shown" (confirmed ledgers read as before).
Made-up client: tests/ledpage_setup.py (fixture books and masters, FinCom's cloud made up in the page). Offline.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_ledger_confirm.py"""
import os, re, sys, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import ledpage_setup as L
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("LEDCONF_PORT", "8437"))
SHOTS = os.environ.get("LEDCONF_SHOTS", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FIGS = """() => { const b = S.books, out = {}, r2_ = x => Math.round((x || 0) * 100) / 100;
  if (typeof GSTR === "object"){ GSTR._carry = null; } if (typeof GST2B === "object") GST2B._memo = null; if (typeof LedCheck === "object") LedCheck._held = null;
  const months = GSTR.months(), regs = [""].concat((GSTR.gstins(b) || []).map(g => g.slice(0, 2)));
  const sum = s => ({taxable: r2_(s.taxable), igst: r2_(s.igst), cgst: r2_(s.cgst), sgst: r2_(s.sgst), cess: r2_(s.cess)});
  out.gstr1 = {}; out.gstr3b = {}; out.itc = {};
  months.forEach(m => regs.forEach(r => { const k = m + "|" + r, o = GSTR.one(m, r);
    out.gstr1[k] = ["b2b", "b2cl", "b2c", "cdnr", "nil"].map(t => sum(GSTR.sum(o[t] || [])));
    const t = GSTR.threeB(m, r); out.gstr3b[k] = {itc: t.itc, netItc: t.netItc, net: t.net};
    out.itc[k] = sum(GSTR.sum(GSTR.inward(m, r) || [])); }));
  const tds = rows => rows.map(x => [x.section, x.party || x.name || "", r2_(x.amount), r2_(x.tds), x.date || "", x.pan || ""]).sort((a, c) => JSON.stringify(a).localeCompare(JSON.stringify(c)));
  out.q26 = tds(TDS.rows()); out.q27 = tds(TDS.nrRows()); out.q27e = tds(TDS.tcsRows());
  return JSON.parse(JSON.stringify(out)); }"""
REOPEN = """async () => { const cid = S.books.cid; if (typeof TCloud === "object") TCloud.openLoad = async () => {}; S.books = null; await openBooks(cid);
  for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise(r => setTimeout(r, 50)); render(); return !!S.books && !S.books.loading; }"""
ENTRY = "(n) => { const m = S.books.map[n]; if (!m) return null; const c = JSON.parse(JSON.stringify(m)); delete c.n; return c; }"
ANS = "(n) => { const m = S.books.map[n] || {}; return [m.what || '', m.tax || '', m.side || '', m.section || '', m.rate == null ? null : m.rate, m.gstRate == null ? null : m.gstRate]; }"
WHERE = "() => [S.tab, S.booksTab, S.tdsView || '', S.gstView || '', S.ledKind || '', location.hash]"
TALLY_ONLY = "TDS ON RENT 194I"          # a Tally ledger (cloud copy) no entry uses
UNCLEAR = L.UNCLEAR                      # "GST Adjustment Misc": nothing known but the word GST
row = lambda pg, n: pg.locator("#app [data-tax-ledgers] tr[data-src][data-key=%s]" % json.dumps(n))
def shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)

with sync_playwright() as p:
    srv, br, pg = L.start(p, PORT, SITE, errors=errors)
    E = pg.evaluate; T = lambda sel="#app": pg.inner_text(sel)
    cid, _ = L.open_page(pg, "owner")
    # a ledger of the cloud copy that no entry uses, with its opening and Tally's nature of payment
    E("""(n) => { window.__ledRows.push({name: n, parent: "Duties & Taxes", gstin: "", pan: "", needs_confirm: false, before_clean: null});
      const rest = TCloud.restAll; TCloud.restAll = async (p) => { if (/^tally_ledgers\\?select=name,open/.test(p)) { window.__rest.push(p);
        return window.__ledRows.map(r => ({name: r.name, open: r.name === n ? -1500 : 0, tds_nature: r.name === n ? "Rent on Land or Building" : "", tds_deductee_type: ""})); } return rest(p); }; }""", TALLY_ONLY)
    E("async () => { await Ledgers.load(S.books.cid, {force: true}); TaxLed.ext = {}; render(); }"); pg.wait_for_timeout(600)
    f0 = E(FIGS)

    # ---------- B. the old address (ledpage_setup opens Books › Tally ledgers) lands on the TDS page's Ledgers, all kinds
    w = E(WHERE)
    ok(w[:5] == ["books", "tds", "ledgers", w[3], "all"] and w[5].endswith("/books/tds/ledgers/all"), "B. S.booksTab = 'ledgers' opens the TDS page's Ledgers with every kind, the address replaced (%s)" % w)
    ok(pg.locator("#app [data-tax-ledgers=all]").count() == 1 and pg.locator("#app [data-books-tab=ledgers]").count() == 0, "B. the TDS and GST ledgers page; no Tally ledgers tab on From Tally")
    for h in ["#/c/%s/from-tally/ledgers" % cid, "#/c/%s/books/ledgers" % cid]:
        E("async (h) => { S.booksTab = 'import'; S.tdsView = 'year'; render(); await Route.apply(h); render(); }", h); pg.wait_for_timeout(500)
        w = E(WHERE)
        ok(w[1:3] == ["tds", "ledgers"] and pg.locator("#app [data-tax-ledgers]").count() == 1, "B. the old link %s opens the TDS page's Ledgers (%s)" % (h.split(cid)[1], w))
    for js in ["() => { S.tdsView = 'year'; booksTabGo('ledgers'); }", "() => { S.tdsView = 'year'; lmViewGo(''); }"]:
        E(js); pg.wait_for_timeout(400)
        ok(E(WHERE)[1:3] == ["tds", "ledgers"], "B. %s opens the TDS page's Ledgers" % js.split("; ")[1].split("(")[0])

    # ---------- A. the TDS page's line opens the TDS ledgers in place; the GST page's Ledgers section
    E("() => { S.ledKind = ''; S.booksTab = 'tds'; S.tdsView = 'year'; render(); }"); pg.wait_for_timeout(500)
    shot(pg, "after-tds-page")
    ln = pg.locator("#app [data-tds-page] [data-ledger-banner]")
    ok(ln.count() == 1 and re.search(r"\d+ ledgers? to confirm\s*→\s*Confirm", ln.inner_text()) is not None, "A. the TDS page: '%s'" % (" ".join(ln.inner_text().split()) if ln.count() else ""))
    if ln.count(): ln.locator("[data-ledger-confirm]").click(); pg.wait_for_timeout(500)
    w = E(WHERE)
    ok(w[1:3] == ["tds", "ledgers"] and w[5].endswith("/books/tds/ledgers") and pg.locator("#app [data-tax-ledgers=tds]").count() == 1, "A. Confirm opens the TDS page's Ledgers in place (%s)" % w)
    kinds = E("() => [...document.querySelectorAll('#app [data-tax-ledgers] table[data-led-table=main] tbody tr[data-key]')].map(t => t.dataset.key)")
    ok(len(kinds) > 0 and all(E("(n) => { const r = TaxLed.row(S.books, n); return r.kind === 'tds' || !r.kind; }", n) for n in kinds), "A. TDS ledgers only (%d): %s" % (len(kinds), kinds[:6]))
    ok(TALLY_ONLY in kinds, "G. %s, in Tally with no entries, is on the TDS ledgers" % TALLY_ONLY)
    tr = row(pg, TALLY_ONLY)
    ok(tr.count() == 1 and "Opening ₹1,500.00 Dr" in tr.inner_text() and tr.locator("[data-tl-tally-only]").count() == 1 and "Rent on Land or Building" in tr.inner_text(),
       "G. with its group, its opening and Tally's nature of payment from the cloud copy: %r" % (tr.inner_text().replace("\n", " | ")[:200] if tr.count() else ""))
    shot(pg, "after-tds-ledgers")
    E("() => { S.booksTab = 'gst'; S.gstView = 'year'; S.gstYm = GSTR.months().slice(-1)[0]; render(); }"); pg.wait_for_timeout(500)
    sec = pg.locator("#app [data-gst-sec=ledgers]")
    ok(sec.count() == 1, "A. the GST page has a Ledgers section (%s)" % (sec.inner_text() if sec.count() else ""))
    if sec.count(): sec.click(); pg.wait_for_timeout(500)
    w = E(WHERE)
    ok(w[3] == "ledgers" and w[5].endswith("/books/gst/ledgers") and pg.locator("#app [data-tax-ledgers=gst]").count() == 1, "A. it opens the GST ledgers in place (%s)" % w)
    gk = E("() => [...document.querySelectorAll('#app [data-tax-ledgers] table[data-led-table=main] tbody tr[data-key]')].map(t => t.dataset.key)")
    ok(len(gk) > 0 and all(E("(n) => { const r = TaxLed.row(S.books, n); return r.kind === 'gst' || !r.kind; }", n) for n in gk) and TALLY_ONLY not in gk, "A. GST ledgers only (%d)" % len(gk))
    itc = E("() => [...document.querySelectorAll('#app [data-tax-ledgers] [data-tl-detail]')].map(x => x.textContent)")
    ok(any("ITC eligible" in x for x in itc), "A. the GST rows say the input tax credit (%s)" % itc[:3])
    shot(pg, "after-gst-ledgers")
    pg.click("#app [data-tl-kind=all]"); pg.wait_for_timeout(400)
    ok(pg.locator("#app [data-tax-ledgers=all]").count() == 1 and len(E("() => [...document.querySelectorAll('#app [data-tax-ledgers] table[data-led-table=main] tbody tr[data-key]')]")) >= len(gk) + len(kinds) - 1, "A. All shows both")
    E("() => TaxLed.go('tds')"); pg.wait_for_timeout(500)

    # ---------- C. Confirm and Unconfirm, with who and when; the figures never move
    led = E("""() => { const r = TaxLed.forKind(S.books, 'tds').rows.find(r => !r.ok && r.src === 'rule' && r.used > 0 && r.ans && /^tds_payable$/.test(r.ans.what)); return r ? r.n : ''; }""")
    ok(bool(led), "C. a TDS ledger used in entries, with the rules' answer, to confirm (%s)" % led)
    a0, e0 = E(ANS, led), E(ENTRY, led)
    row(pg, led).locator("[data-led-confirm]").click(); pg.wait_for_timeout(500)
    m = E(ENTRY, led)
    ok(m.get("ok") and m.get("okBy") and m.get("okAt") and (m.get("hist") or [{}])[-1].get("act") == "confirm" and E(ANS, led) == a0, "C. Confirm: confirmed by %s at %s, the answer kept %s" % (m.get("okBy"), m.get("okAt"), a0))
    ok(row(pg, led).locator("[data-led-okby]").count() == 1 and row(pg, led).locator("[data-led-unconfirm]").count() == 1 and row(pg, led).locator("[data-led-change]").count() == 1, "C. the confirmed row: '✓ Confirmed by …', Unconfirm and Change")
    shot(pg, "after-confirmed-row")
    row(pg, led).locator("[data-led-unconfirm]").click(); pg.wait_for_timeout(500)
    m = E(ENTRY, led)
    ok(not m.get("ok") and (m.get("unok") or {}).get("by") and (m.get("unok") or {}).get("at") and [x.get("act") for x in m.get("hist") or []][-2:] == ["confirm", "unconfirm"], "C. Unconfirm: not confirmed, with who and when (%s, %s) and the history" % ((m.get("unok") or {}).get("by"), (m.get("unok") or {}).get("at")))
    ok(E(ANS, led) == a0 and (m.get("unok") or {}).get("was", {}).get("by"), "C. back to 'to confirm' with its last answer %s; who had confirmed it kept" % (E(ANS, led),))
    ok(row(pg, led).locator("[data-led-confirm]").count() == 1 and row(pg, led).locator("[data-tl-unok]").count() == 1 and "Unconfirmed by" in row(pg, led).inner_text(), "C. the row: Confirm again, and 'Unconfirmed by …'")
    ok(E("(n) => LedMaster.pending(S.books).some(x => x[0] === n)", led), "C. it counts as to confirm again (the TDS page's line, To fix)")
    ok(E(FIGS) == f0, "C. no figure moved by Confirm or Unconfirm")
    ok(E(REOPEN) and not E(ENTRY, led).get("ok") and (E(ENTRY, led).get("unok") or {}).get("by"), "C. after opening the books again: still unconfirmed, with who and when")
    # opening the books again lets the ledger master guess from names (LedMaster.refresh): the made-up ledger nothing is
    # known of is put back as ledpage_setup.py makes it, for E and F
    E("(n) => { S.books.map[n] = {n: 0, what: ''}; S.books.mapV = (S.books.mapV || 0) + 1; }", UNCLEAR)
    E("() => TaxLed.go('tds')"); pg.wait_for_timeout(500)

    # ---------- D. a filed return is not changed by Unconfirm: the row says the filed return used the earlier choice
    fq = E("""(n) => { const v = S.books.vouchers.find(v => v.ent.some(e => e.l === n)); const fy = TDS.fyOf(v.date), q = TDS.qOf(v.date);
      S.books.tdsFiled = Object.assign({}, S.books.tdsFiled, {[fy + '|' + q + '|26Q']: {on: '2026-07-20', token: '', at: '2026-07-20T10:00:00Z', by: 'asha@firm.test'}}); render(); return fy + '|' + q + '|26Q'; }""", led)
    filed0 = E("() => JSON.stringify(S.books.tdsFiled)")
    row(pg, led).locator("[data-led-confirm]").click(); pg.wait_for_timeout(400)
    row(pg, led).locator("[data-led-unconfirm]").click(); pg.wait_for_timeout(500)
    fn = row(pg, led).locator("[data-tl-filed]")
    ok(fn.count() == 1 and "used the earlier choice" in fn.inner_text() and "not changed" in fn.inner_text(), "D. the row: %r" % (fn.inner_text() if fn.count() else ""))
    ok(E("() => JSON.stringify(S.books.tdsFiled)") == filed0 and E(FIGS) == f0, "D. the filed return (%s) and the figures as they were" % fq)
    ub = pg.locator("#app [data-led-undo-bar]")
    ok(ub.count() == 1 and "used the earlier choice" in ub.inner_text(), "D. said once in the step's line too")

    # ---------- F. AI off: no call; the rules' guesses and Not known as before
    E("() => { window.__ai = []; TaxLed.fetchGuess = async (body) => { window.__ai.push(body); return {ok: true, guesses: []}; }; TaxLed.ai = {asked: {}, busy: {}, err: {}, last: {}}; S.ledKind = 'all'; render(); }"); pg.wait_for_timeout(800)
    ok(E("() => TaxLed.aiOn()") is False and E("() => window.__ai.length") == 0, "F. no firm account: AI off, nothing asked")
    ai_line = pg.locator("#app [data-tl-ai]")
    ok(ai_line.count() == 1 and ai_line.get_attribute("data-tl-ai") == "off" and "rules’ guesses are shown" in ai_line.inner_text(), "F. one line: %r" % (ai_line.inner_text() if ai_line.count() else ""))
    un = row(pg, UNCLEAR)
    ok(un.count() == 1 and un.get_attribute("data-src") == "none" and un.locator("[data-tl-src=none]").count() == 1, "F. %s: Not known (the rules cannot tell, no AI)" % UNCLEAR)
    rules_rows = E("() => TaxLed.all(S.books).rows.filter(r => r.src === 'rule').length")
    ok(rules_rows > 5, "F. the rules' guesses shown as before (%d)" % rules_rows)
    E("() => { Cloud.on = () => true; ASST.st().settings = {enabled: false, consent: true}; render(); }"); pg.wait_for_timeout(800)
    ok(E("() => TaxLed.aiOn()") is False and E("() => window.__ai.length") == 0, "F. the firm's switch off: nothing asked")
    shot(pg, "after-ai-off")

    # ---------- E. a fake AI: asked once for what the rules cannot tell; a guess, never applied until confirmed
    E("""() => { ASST.st().settings = {enabled: true, consent: true};
      TaxLed.fetchGuess = async (body) => { window.__ai.push(JSON.parse(JSON.stringify(body)));
        return {ok: true, model: 'claude-haiku-5-5', cached: 0, asked: body.ledgers.length, usd: 0.0001, guesses: body.ledgers.map(l => ({name: l.name, kind: /GST/i.test(l.name) ? 'gst_input' : 'not_tax', head: 'IGST', rate: 18, section: '',
          confidence: 'medium', reason: 'fake AI: read from ' + l.name + ' under ' + (l.group || 'no group')}))}; };
      TaxLed.ai = {asked: {}, busy: {}, err: {}, last: {}}; render(); }"""); pg.wait_for_timeout(1500)
    sent = E("() => window.__ai")
    names = [l["name"] for b in sent for l in b["ledgers"]]
    ok(len(sent) == 1 and sent[0]["action"] == "ledger_guess" and sent[0]["client_id"] == cid, "E. one batch asked by itself when the page opened (%d)" % len(sent))
    ok(UNCLEAR in names and not any(E("(n) => !!LedPage.checkOf(S.books, n) || !!(S.books.map[n] || {}).what && !!(S.books.map[n] || {}).ok", n) for n in names), "E. only the ledgers the rules cannot tell (%d: %s)" % (len(names), names[:5]))
    ok(not any(E("(n) => !!(S.books.map[n] || {}).what && LedPage.taxW(S.books.map[n].what)", n) for n in names), "E. no ledger the ledger master already reads as GST or TDS")
    smp = [l for b in sent for l in b["ledgers"] if l["name"] == UNCLEAR]
    ok(smp and set(smp[0].keys()) >= {"name", "group", "open", "use", "samples"}, "E. each with its group, opening, use and sample entries")
    un = row(pg, UNCLEAR)
    ok(un.count() == 1 and un.get_attribute("data-src") == "ai" and un.locator("[data-tl-src=ai] .tag").inner_text() == "AI guess" and "fake AI: read from " + UNCLEAR in un.inner_text(), "E. %s: 'AI guess' with its reason (%r)" % (UNCLEAR, un.inner_text().replace("\n", " | ")[:160] if un.count() else ""))
    ok(E(ENTRY, UNCLEAR) and not E(ENTRY, UNCLEAR).get("ok") and (E(ENTRY, UNCLEAR).get("what") or "") == "", "E. not applied: the ledger master still has no answer for it")
    ok(E(FIGS) == f0, "E. no figure moved by the AI guess")
    shot(pg, "after-ai-guess")
    E("() => { TaxLed.ai.asked = {}; render(); }"); pg.wait_for_timeout(800)
    ok(len(E("() => window.__ai")) == 1, "E. not asked again for the same ledgers (kept with the books)")
    un.locator("[data-led-confirm]").click(); pg.wait_for_timeout(500)
    m = E(ENTRY, UNCLEAR)
    ok(m.get("ok") and m.get("what") == "gst" and m.get("tax") == "IGST" and m.get("side") == "input" and m.get("okFrom") == "ai" and "AI guess, confirmed by" in (m.get("why") or ""), "E. Confirm: the AI's answer, confirmed by this person, marked as AI's (%s %s %s)" % (m.get("what"), m.get("tax"), m.get("okFrom")))
    pg.click("#app [data-led-undo-bar] [data-led-undo-last]") if pg.locator("#app [data-led-undo-bar] [data-led-undo-last]").count() else None; pg.wait_for_timeout(400)
    ok(not E(ENTRY, UNCLEAR).get("ok") and (E(ENTRY, UNCLEAR).get("what") or "") == "", "E. Undo puts it back unanswered")

    # ---------- G. the picker lists the cloud copy's ledgers: "which ledger is TDS payable 194C"
    E("() => TaxLed.go('tds')"); pg.wait_for_timeout(500)
    rid = E("() => (rules().find(r => /^194C$/.test(Ledgers.sec(r.old))) || {}).id || ''")
    key = "tds:" + rid
    post = pg.locator("#app [data-tl-post=tds] tr[data-tl-post-key=%s]" % json.dumps(key))
    ok(bool(rid) and post.count() == 1, "G. the TDS ledger of each payment type is here (%s)" % key)
    post.locator("[data-tl-pick-open]").click(); pg.wait_for_timeout(300)
    pg.fill("#app [data-tl-pick] input", "which ledger is TDS payable 194C"); pg.wait_for_timeout(500)
    opts = E("() => [...document.querySelectorAll('#app [data-tl-pick] [data-tl-pick-opt]')].map(b => b.dataset.tlPickOpt)")
    cloud = set(E("() => window.__ledRows.map(r => r.name)"))
    ok(opts and opts[0] == L.RENAMED and all(o in cloud for o in opts), "G. the picker lists the cloud copy's ledgers, %s first (%s)" % (L.RENAMED, opts[:4]))
    shot(pg, "after-picker")
    pg.click("#app [data-tl-pick] [data-tl-pick-opt=%s]" % json.dumps(L.RENAMED)); pg.wait_for_timeout(500)
    c = E("(k) => choiceGet(CO(), k)", key)
    ok(c and c["value"] == L.RENAMED and c["state"] == "confirmed" and c.get("by") and c.get("at"), "G. chosen and confirmed: %s by %s" % ((c or {}).get("value"), (c or {}).get("by")))
    ok(E("(k) => choiceUsable(CO(), k)", key) == L.RENAMED, "G. posting may use it")
    post.locator("[data-tl-post-unconfirm]").click(); pg.wait_for_timeout(400)
    c = E("(k) => choiceGet(CO(), k)", key)
    ok(c["state"] == "guessed" and c["value"] == L.RENAMED and (c.get("unok") or {}).get("by") and (c.get("unok") or {}).get("at") and E("(k) => choiceUsable(CO(), k)", key) == "",
       "G. Unconfirm: kept as a guess with who and when; posting waits (%s)" % c.get("unok"))
    ok(E("""(k) => { const co = CO(), mine = co.choices[k], older = {value: mine.value, state: 'confirmed', by: 'x', at: '2026-01-01T00:00:00Z'}; return choicePick(older, mine) === mine && choicePick(mine, older) === mine; }""", key),
       "G. an older confirmed copy from another computer does not undo the Unconfirm")
    post.locator("[data-tl-post-confirm]").click(); pg.wait_for_timeout(300)
    ok(E("(k) => choiceGet(CO(), k).state", key) == "confirmed", "G. confirmed again with one click")

    # ---------- I. Confirm all shown: the figures read as before
    E("() => { S.ledKind = 'all'; S.ledQ = ''; render(); }"); pg.wait_for_timeout(400)
    btn = pg.locator("#app [data-tl-confirm-shown]")
    want = E("() => { const a = TaxLed.all(S.books); return a.rows.concat(a.more).filter(r => !r.ok && r.ans && r.ans.what).map(r => r.n).sort(); }")
    ok(btn.count() == 1 and ("Confirm all shown (%d)" % len(want)) in btn.inner_text(), "I. 'Confirm all shown (%d)'" % len(want))
    btn.click(); pg.wait_for_timeout(600)
    ok(all(E("(ns) => ns.map(n => !!(S.books.map[n] || {}).ok)", want)), "I. every row shown confirmed")
    ok(E(FIGS) == f0, "I. the TDS and GST figures are the same for the confirmed ledgers (every return)")

    # ---------- H. Settings: no ledger confirmation; one line pointing to the TDS and GST pages
    for tab in ["cotally", "cotds", "gstset"]:
        E("(t) => { S.tab = t; render(); }", tab); pg.wait_for_timeout(500)
        t = T()
        ok(pg.locator("#app [data-choice-confirm^='gst:'], #app [data-choice-confirm^='tds:'], #app [data-choice^='gst:'], #app [data-choice^='tds:']").count() == 0
           and pg.locator("#app input[aria-label^='TDS ledger for']").count() == 0 and not re.search(r"Input CGST|Reverse charge ledgers|TDS ledger in Tally", t), "H. Client setup › %s: no GST or TDS ledger to confirm" % tab)
        ok(pg.locator("#app [data-ledger-pointer]").count() == 1 and "Confirm TDS/GST ledgers on the TDS and GST pages" in pg.locator("#app [data-ledger-pointer]").inner_text(), "H. … one line: 'Confirm TDS/GST ledgers on the TDS and GST pages'")
    shot(pg, "after-settings-gst")
    pg.click("#app [data-ledger-pointer-go=gst]"); pg.wait_for_timeout(500)
    ok(E(WHERE)[3] == "ledgers" and pg.locator("#app [data-tax-ledgers=gst]").count() == 1, "H. its GST link opens the GST page's Ledgers")
    ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors %s" % errors[:3])
    br.close(); srv.shutdown()

print("\nALL PASSED" if not fails else "\n%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
