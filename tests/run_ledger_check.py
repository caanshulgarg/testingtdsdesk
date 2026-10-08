"""python3 run_ledger_check.py - the GST and TDS ledger check (request of 02-Oct-2026, items 15-18) on Testing AAD: Tally's
masters as facts, the day book's use, AI only for what is unclear, one confirm screen with the evidence and its source,
high-confidence answers ticked, nothing counted until confirmed, a later change of use warned, and a firm's confirmed
answers as hints for its other clients. The expected answers are the ones in the request.
Uses tests/data/books-cache.json and gst-cache.json (client data, not in git).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_ledger_check.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
import gstfix
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8197), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books, gst = gstfix.load()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the request's expected answers
WANT = {"CGST 9 %": ("gst", "output", "CGST"), "SGST 9 %": ("gst", "output", "SGST"), "Professional Fee Non Gst": ("none", "", ""), "RCM Payable": ("gst_rcm", "output", "CGST+SGST"),
        "Panelty GST": ("none", "", ""), "Fee GST": ("none", "", ""), "GST Loan": ("none", "", ""), "GST PAYMENT CLIENT": ("none", "", ""), "GST PAYMENTS NOT REFUNDABLE": ("none", "", ""),
        "SB Cess @ .5%": ("none", "", ""), "TDS ON RENT 94I": ("tds_payable", "", "")}

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8197/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    cid = pg.evaluate(gstfix.SETUP, [books, gst]); pg.wait_for_timeout(1500)
    E = lambda js, *a: pg.evaluate(js, *a)
    # the masters as read from Tally; the request's ledgers as not yet confirmed (as on a new client)
    E("""([info, names]) => { S.books = window.__bk; S.books.ledInfo = info; names.forEach(n => { const m = S.books.map[n]; if (m){ delete m.ok; delete m.byHand; delete m.okAt; } });
      LedMaster.refresh(S.books); S.booksTab = 'ledgers'; render(); }""", [gst["ledInfo"], list(WANT)])
    pg.wait_for_timeout(800)
    # FinCom 2.4.0: the check is worked out by itself on the ledgers page (no second list); Check again is under More
    ok(pg.locator("#app [data-ledpage]").count() == 1 and E("!!(S.books.ledCheck && S.books.ledCheck.ranAt)"), "the ledger check is worked out by itself on the Tally ledgers tab")
    pg.click("#app [data-more-toggle=ledpage]"); pg.wait_for_timeout(300)
    pg.click("#app [data-led-check-again]"); pg.wait_for_timeout(1500)
    got = E("(names) => Object.fromEntries(names.map(n => { const it = S.books.ledCheck.items[n]; const s = it ? LedCheck.pick(it) : {}; return [n, [s.what || '', s.side || '', s.tax || '', s.section || '', s.conf || '', (s.ev || []).map(e => e.src)]]; }))", list(WANT))
    for n, (w, side, tax) in WANT.items():
        g = got.get(n) or ["?"] * 6
        good = g[0] == w and (not side or g[1] == side) and (not tax or g[2] == tax) and (n != "TDS ON RENT 94I" or g[3] == "194I")
        ok(good, "18. %s → %s%s (%s)" % (n, w, " " + side + " " + tax if side else "", g[:5]))
    # 15. facts from the master, with their source
    ok("master" in got["CGST 9 %"][5] and got["CGST 9 %"][4] == "high", "15. CGST 9 %: Tally's master (tax type GST, duty head CGST) is the evidence; high confidence")
    ok("master" in got["SB Cess @ .5%"][5] and "master" in got["Fee GST"][5], "15. SB Cess (Service Tax) and Fee GST (tax type Others, under Loans & Advances): not tax, from the master")
    # 16. the day book's use, in words
    use = E("S.books.ledCheck.items['CGST 9 %'].use.say")
    ok("credit notes" in use and "usually" in use, "16. the use of CGST 9 % said: " + use[:120])
    rc = E("S.books.ledCheck.items['RCM Payable'].s.ev.map(e => e.say).join(' | ')")
    ok("CGST and SGST" in rc, "16. RCM Payable: credited beside CGST and SGST reverse-charge input, so CGST + SGST (%s)" % rc[:160])
    # 18. high confidence ticked to start with; the table shows the evidence with its source
    tk = E("(names) => names.filter(n => LedCheck.ticked(S.books.ledCheck.items[n]))", list(WANT))
    ok(set(tk) >= {"CGST 9 %", "SGST 9 %", "Professional Fee Non Gst", "Fee GST", "SB Cess @ .5%", "TDS ON RENT 94I", "RCM Payable"}, "18. high-confidence answers ticked to start with (%d of %d)" % (len(tk), len(WANT)))
    ok(pg.locator("#app tr[data-key='CGST 9 %'] [data-led-why] .tag:has-text('Tally master')").count() == 1 and pg.locator("#app tr[data-key='CGST 9 %'] [data-led-why] .tag:has-text('Day book')").count() >= 1, "18. the screen shows each piece of evidence with its source (under the row's Why)")
    # 17. AI only for what is unclear: one call for the client, with names, groups, use and a few entries
    low = E("Object.entries(S.books.ledCheck.items).filter(([n, it]) => it.s.conf === 'low' && !(S.books.map[n] || {}).ok).map(([n]) => n)")
    E("""(low) => { S.firm.ai = {on: true}; S.engine = 'api'; window.__asked = [];
      window.claudeRead = async (prompt) => { window.__asked.push(prompt); return {ledgers: low.map(n => ({name: n, kind: 'not_tax', head: '', rate: null, tds_section: '', confidence: 'medium', reason: 'test answer'}))}; }; render(); }""", low)
    pg.wait_for_timeout(300)
    if low:
        E("doAct('lcAi')"); pg.wait_for_timeout(1200)
        asked = E("window.__asked")
        ok(len(asked) == 1 and all(n in asked[0] for n in low[:3]) and "CGST 9 %" not in asked[0], "17. one AI call for the client, with only the %d unclear ledgers (none of the settled ones)" % len(low))
        ok(all("ai" in E("(n) => S.books.ledCheck.items[n].s.ev.map(e => e.src)", n) for n in low) and not any(E("(n) => LedCheck.ticked(S.books.ledCheck.items[n])", n) for n in low), "17. AI's answers shown as AI's, and never ticked")
    else:
        ok(True, "17. nothing left unclear for AI")
    # 18. confirm the ticked: into the ledger master, with the source; nothing unconfirmed counts any more
    pg.click("#app [data-led-confirm-sure]"); pg.wait_for_timeout(1200)   # 2.4.0: "Confirm the check's N sure answers" (under More)
    m = E("(names) => Object.fromEntries(names.map(n => [n, [!!(S.books.map[n] || {}).ok, (S.books.map[n] || {}).what, (S.books.map[n] || {}).side || '', (S.books.map[n] || {}).tax || '', (S.books.map[n] || {}).section || '', ((S.books.map[n] || {}).src || []).join()]]))", tk)
    ok(m["CGST 9 %"][:4] == [True, "gst", "output", "CGST"] and "master" in m["CGST 9 %"][5] and m["TDS ON RENT 94I"][:2] == [True, "tds_payable"] and m["TDS ON RENT 94I"][4] == "194I",
       "18. confirmed into the ledger master with the source of each answer (%s; %s)" % (m["CGST 9 %"], m["TDS ON RENT 94I"]))
    ok(E("S.books.ledCheck.strict && !!S.books.ledCheck.savedAt"), "18. the check is saved")
    still = E("LedMaster.pending(S.books).map(([n]) => n)")
    held = E("(n) => Books.ledgerOf(n).kind", still[0]) if still else "tax_other"
    ok(held == "tax_other", "18. a tax ledger not confirmed counts in no return (%s: %s)" % ((still or ["none left"])[0], held))
    # Q3: the sales credit notes on CGST 9 % / SGST 9 % now reduce output tax, not count as input
    q3 = E("(() => { const t = GSTQ.threeBQ('202512', '09'); return [t.cn.cgst, t.other.cgst]; })()")
    ok(q3[0] == 13938.19, "18. Q3: the credit notes on CGST 9 %% reduce output CGST by 13,938.19 (%s)" % q3)
    # later: only new ledgers, and a confirmed ledger whose use changes (a warning)
    E("""() => { const b = S.books; for (let i = 0; i < 6; i++) b.vouchers.push({id: 'x' + i, date: '2026030' + (i + 1), type: 'Purchase', no: 'P' + i, party: 'Some Supplier', ent: [{l: 'Some Supplier', a: 1180}, {l: 'Rent', a: -1000}, {l: 'SGST 9 %', a: -90}, {l: 'CGST 9 %', a: -90}]});
      b.ledInfo['NEW IGST 5%'] = {group: 'GST', taxType: 'GST', dutyHead: 'IGST'}; b.map['NEW IGST 5%'] = {n: 0}; render(); }""")
    pg.wait_for_timeout(800)
    d = E("LedCheck.diff(S.books)")
    # 2.4.0: the check runs again by itself, so a new ledger is simply a row to confirm
    ok(pg.locator("#app [data-led-table] tr[data-key='NEW IGST 5%']").count() == 1 and any(x["n"] == "SGST 9 %" for x in d["changed"]), "18. later: a new ledger to confirm, and a confirmed one now used on purchases (warned) (%s)" % {"changed": [x["n"] for x in d["changed"]]})
    w = pg.locator("#app [data-led-needs] tr[data-need=used][data-key='SGST 9 %']")
    ok(w.count() == 1 and "Used differently" in w.inner_text() and w.locator("[data-led-keep]").count() == 1, "18. the warning is on the screen (Needs you, with Keep as confirmed)")
    # the firm's confirmed answers are hints for its other clients
    h = E("""() => { const b2 = {cid: 'other-client', vouchers: [], map: {'TDS ON RENT 94I': {n: 0}}, ledInfo: {'TDS ON RENT 94I': {group: 'TDS', taxType: 'Others'}}, groups: {TDS: 'Duties & Taxes'}, under: {}};
      const it = LedCheck.suggest(b2, 'TDS ON RENT 94I', null, LedMaster.tplFor(b2, 'TDS ON RENT 94I')); return it.ev.filter(e => e.src === 'firm').map(e => e.say); }""")
    ok(len(h) == 1 and "194-I" in h[0], "18. another client of the firm: 'confirmed as TDS payable 194-I for 1 other client' as a hint (%s)" % h)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nFAILED: %d" % len(fails) if fails else "\nall passed")
