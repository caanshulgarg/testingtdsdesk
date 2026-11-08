"""python3 run_bank_overlap.py - a bank statement that overlaps one already uploaded (next-bank-overlap, the owner's approved
design, 08-Nov-2026). Made-up statements and names only. Checked:
(1) April, then a file of April and May: the April lines are skipped as already uploaded, May is added; said plainly
    ("April 2026 already uploaded (6 entries kept as they are). Only May 2026 added (5 entries)."); each statement is
    labelled with the dates it really holds, and its opening, closing and totals are those of its own lines; the
    skipped lines can be seen (See them); the two statements join (no gap said);
(2) the same April lines read again in another style (the narration wrapped differently, PDF against Excel): the same UTR
    and amount, or the same date, amount and balance, are held aside ("Repeat of <date> entry"), out of the books; the
    same amount a day apart with no reference or balance to compare is added but marked "Possible repeat - check"; a
    line marked so is not posted (postBankToTally) nor put in a Tally file until confirmed;
(3) Keep it / It's a repeat / Bring back, on held and marked lines: nothing deleted; kept after a reload, and in the
    firm account's copy (bank_stmt, the same records as before);
(4) two identical lines on one day in one file, with no balance: both kept; matched occurrence by occurrence against a
    later file;
(5) the join check: an opening that is not the closing of the statement before: "Rs X difference between <date> and
    <date>", and the days no statement holds;
(6) a deleted statement uploaded again: all its lines come in, as before;
(7) review of 08-Nov-2026: held lines and repeats stay among the lines (marked, in their place): another computer that
    syncs the parts after "It's a repeat" gets each line once, nothing postable twice; the line's own state decides
    (a kept line cannot be put aside by a stale screen); a reference names one entry only within 2 days (monthly rent to
    the same account is not held), never words ("TRANSFER TO <acct>") or a number on two lines; a cheque number is
    compared as a number (004512 = 4512); a held line is not charged.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_overlap.py   (BANK_SHOTS=<dir>: screenshots)"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = os.environ.get("BANK_SHOTS", "")
PORT = 8417
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(Q, directory=SITE)); PORT = srv.server_address[1]; threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

def csv(acct, ifsc, lines, period=None):
    out = ["Demo Bank,,,,,", "Account Number: %s,,,,," % acct, "IFSC: %s,,,,," % ifsc]
    if period: out.append("Statement period: %s to %s,,,,," % period)
    out.append("Date,Narration,Chq./Ref.No.,Withdrawal Amt.,Deposit Amt.,Closing Balance")
    for d, narr, ref, wd, dep, bal in lines:
        out.append("%s,%s,%s,%s,%s,%s" % (d, narr, ref, "%.2f" % wd if wd else "", "%.2f" % dep if dep else "", "" if bal is None else "%.2f" % bal))
    return "\n".join(out) + "\n"

A1 = ("50100123454321", "DEMO0001234")
APR = [("02/04/2026", "NEFT CR-ALPHA TRADERS-AXISN26092000111", "", 0, 25000, 125000),
       ("05/04/2026", "UPI/609512345678/BETA STORES/beta@ok", "", 1200, 0, 123800),
       ("09/04/2026", "ATM CASH WDL MG ROAD", "", 5000, 0, 118800),
       ("15/04/2026", "CHQ PAID GAMMA SERVICES", "004512", 8000, 0, 110800),
       ("20/04/2026", "BANK CHARGES", "", 118, 0, 110682),
       ("28/04/2026", "INT CREDIT", "", 0, 350, 111032)]
MAY = [("03/05/2026", "NEFT CR-DELTA AGENCIES-HDFCN26123000222", "", 0, 40000, 151032),
       ("08/05/2026", "UPI/612812345678/EPSILON MART/eps@ok", "", 2300, 0, 148732),
       ("12/05/2026", "ATM CASH WDL PARK ST", "", 3000, 0, 145732),
       ("19/05/2026", "RTGS DR-ZETA METALS-SBINR52026051900333", "", 60000, 0, 85732),
       ("30/05/2026", "SMS CHARGES", "", 17.70, 0, 85714.30)]
# the April lines again as another download reads them: wrapped and worded differently
PDF = [("02/04/2026", "BY TRANSFER NEFT ALPHA TRADERS AXISN26092000111", "", 0, 25000, 125000),     # same UTR and amount: held
       ("05/04/2026", "UPI 609512345678 BETA STORES", "", 1200, 0, 123800),                         # same UTR and amount: held
       ("09/04/2026", "ATM-CASH WDL/MG ROAD BLR", "", 5000, 0, 118800),                              # same date, amount, balance: held
       ("15/04/2026", "CHEQUE 4512 GAMMA SERVICES", "4512", 8000, 0, None),                          # same cheque (004512) and amount: held
       ("21/04/2026", "BANK CHGS INCL GST", "", 118, 0, None),                                       # same amount a day apart: marked
       ("28/04/2026", "INTEREST CREDITED", "", 0, 350, None),                                        # same amount, same day: marked
       ("02/06/2026", "NEFT CR-ETA LTD-ICICN26153000444", "", 0, 10000, None)]                       # new
A2 = ("60200987657788", "DEMO0005678")
SAME = ("10/01/2026", "CASH DEPOSIT BY SELF", "", 0, 5000, None)
I1 = [SAME, SAME, ("12/01/2026", "NEFT CR-ONE TRADING-UTIBN26012000555", "", 0, 100, None)]
I2 = [SAME, SAME, ("12/01/2026", "NEFT CR-ONE TRADING-UTIBN26012000555", "", 0, 100, None), ("15/01/2026", "NEFT CR-TWO TRADING-UTIBN26015000666", "", 0, 700, None)]
I3 = [SAME, ("20/01/2026", "NEFT CR-THREE TRADING-UTIBN26020000777", "", 0, 900, None)]
A3 = ("70300555559911", "DEMO0009012")
J1 = [("05/01/2026", "NEFT CR-KAPPA CO-KKBKN26005000888", "", 0, 20000, 70000), ("28/01/2026", "RENT PAID", "", 20000, 0, 50000)]
# monthly rent to the same account (its number in the narration and in the Chq/Ref column), and an EMI whose loan number is on every line
A5 = ("80400123456789", "DEMO0003456")
K1 = [("01/03/2026", "EMI LOAN 998877665544", "998877665544", 15000, 0, 185000), ("31/03/2026", "NEFT DR-123456789012-LANDLORD RENT", "TRANSFER TO 50100999998888", 30000, 0, 155000)]
K2 = [("01/04/2026", "EMI LOAN 998877665544", "998877665544", 15000, 0, 140000), ("01/04/2026", "NEFT DR-123456789012-LANDLORD RENT", "TRANSFER TO 50100999998888", 30000, 0, 110000),
      ("30/04/2026", "NEFT DR-123456789012-LANDLORD RENT", "TRANSFER TO 50100999998888", 30000, 0, 80000)]
# a long statement (two sync parts of 300 lines): its first line a possible repeat of a line already here
A6 = ("90500111112222", "DEMO0007890")
L0 = [("01/06/2026", "CASH DEP BRANCH", "", 0, 777, None)]
L1 = [("01/06/2026", "CASH DEPOSIT AT BRANCH", "", 0, 777, None)] + [("%02d/06/2026" % (2 + i // 12), "UPI/7%011d/SHOP %d" % (i, i), "", 10 + i, 0, None) for i in range(304)]
J2 = [("03/03/2026", "NEFT CR-LAMBDA CO-KKBKN26062000999", "", 0, 4000, 55500), ("20/03/2026", "ELECTRICITY BILL", "", 2500, 0, 53000)]

STUB = """(firm) => {
  const db = window.__db = {}; window.__charges = []; window.__toasts = [];
  Cloud.st.firm = firm; Cloud.on = () => true; S.account = {firm: {balance: 1e6}};
  if (typeof LocalOwner === 'object') LocalOwner.mayPush = () => true;
  const t0 = window.toast; window.toast = function (m) { window.__toasts.push(String(m)); return t0.apply(this, arguments); };
  Cloud.rpc = async (fn, a) => { if (fn === 'charge_usage') { window.__charges.push(a); return {ok: true, balance: 1e6}; } return null; };
  Cloud.api = async (path, opts) => {
    const m = (opts && opts.method) || 'GET';
    if (path.startsWith('records?on_conflict') && m === 'POST') { opts.body.forEach(r => { db[r.kind + '|' + r.client_id + '|' + r.id] = JSON.parse(JSON.stringify(r)); }); return null; }
    if (path.startsWith('records?') && m === 'PATCH') return null;
    if (path.startsWith('records?select=') && path.includes('client_id=eq.')) {
      const cid = decodeURIComponent(path.split('client_id=eq.')[1].split('&')[0]);
      return Object.values(db).filter(r => r.client_id === cid && /^bank_/.test(r.kind)).map(r => JSON.parse(JSON.stringify(r)));
    }
    return [];
  };
}"""
SETUP = """(accs) => {
  accs.forEach(([id, name, acct, ifsc]) => {
    const c = newCompany({name, gstin: ""}); c.id = id;
    c.bankAccounts = [{id: "ba" + id, bank: "Demo Bank", acct, ifsc, last4: acct.slice(-4), ledger: "Demo Bank A/c"}];
    S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; Store.saveCompany(c);
  });
}"""
OPEN = """(cid) => { S.coId = cid; S.view = "company"; S.tab = "bank"; S.bank = null; render(); }"""
UPLOAD = """([text, name]) => uploadStatements([new File([text], name, {type: 'text/csv'})])"""

def wait(pg, js, t=15000):
    try: pg.wait_for_function("() => { try { return !!(" + js + "); } catch (e) { return false; } }", timeout=t); return True
    except Exception: return False

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = pg.evaluate
    E(STUB, "f0000000-0000-0000-0000-0000000000ab")
    E(SETUP, [["zzov1", "Sample Works Pvt Ltd", A1[0], A1[1]], ["zzov2", "Model Traders", A2[0], A2[1]], ["zzov3", "Example Stores", A3[0], A3[1]], ["zzov5", "Sample Rentals", A5[0], A5[1]], ["zzov6", "Model Kirana", A6[0], A6[1]]])
    toasts = lambda: E("window.__toasts")
    def up(text, name, n_before):
        E("window.__toasts = []"); E(UPLOAD, [text, name]); wait(pg, "!B().busy && B().stmts.length > %d" % n_before); pg.wait_for_timeout(600)
        return [t for t in toasts() if t.startswith(name + ":")]
    def st(i=-1): return E("(i) => { const s = B().stmts; return JSON.parse(JSON.stringify(s[i < 0 ? s.length + i : i])); }", i)

    print("== 1. April, then April and May")
    E(OPEN, "zzov1"); wait(pg, "B() && B().cid === 'zzov1' && !B().loading")
    up(csv(A1[0], A1[1], APR, ("01/04/2026", "30/04/2026")), "apr.csv", 0)
    s1 = st()
    ok(s1["n"] == 6 and s1["from"] == "2026-04-02" and s1["to"] == "2026-04-28", "April: 6 lines, labelled with its dates 02-Apr to 28-Apr (%s %s-%s)" % (s1["n"], s1["from"], s1["to"]))
    ok(s1.get("fileFrom") == "2026-04-01" and s1.get("fileTo") == "2026-04-30" and s1["opening"] == 100000 and s1["closing"] == 111032, "the file's period kept apart; opening 100000, closing 111032 (%s)" % [s1.get("fileFrom"), s1.get("fileTo"), s1["opening"], s1["closing"]])
    say = up(csv(A1[0], A1[1], APR + MAY), "apr-may.csv", 1)
    s2 = st()
    ok(any("apr-may.csv: April 2026 already uploaded (6 entries kept as they are). Only May 2026 added (5 entries)." in t for t in say), "said plainly: %s" % say)
    ok(E("B().rows.length") == 5 and s2["n"] == 5 and s2["dupRows"] == 6 and E("B().rows.every(r => r.date >= '2026-05-01')"), "only the 5 May lines are added (%s rows, %s skipped)" % (E("B().rows.length"), s2["dupRows"]))
    ok(s2["from"] == "2026-05-03" and s2["to"] == "2026-05-30", "the new statement is labelled with the dates it holds: %s to %s" % (s2["from"], s2["to"]))
    ok(s2["opening"] == 111032 and s2["closing"] == 85714.3 and s2["totDr"] == 65317.7 and s2["totCr"] == 40000, "its opening, closing and totals are its own lines' (%s)" % [s2["opening"], s2["closing"], s2["totDr"], s2["totCr"]])
    ok(s2.get("summaryOk") is True and len(s2.get("dupIds") or []) == 6 and all(i.startswith(s1["id"] + "-") for i in s2["dupIds"]), "it adds up; the 6 skipped lines are listed against April's (%s)" % s2.get("dupIds"))
    ok(E("Object.values(B().keys).filter(v => v === '%s').length" % s1["id"]) == 6, "April's lines still belong to April")
    head = E("(document.querySelector('[data-dup-words]') || {}).innerText || ''")
    ok("April 2026 already uploaded (6 entries kept as they are)" in head, "the header says it: %s" % head)
    pg.click("[data-dup-see]"); wait(pg, "document.querySelectorAll('[data-bo-list=dup] [data-bo-line]').length === 6", 5000)
    ok(E("document.querySelectorAll('[data-bo-list=dup] [data-bo-line]').length") == 6 and "ATM CASH WDL MG ROAD" in E("document.querySelector('[data-dup-list]').innerText"), "See them lists the 6 lines kept as they are")
    ok(not E("document.querySelector('[data-join-gap]')") and not E("document.querySelector('[data-join-days]')"), "May follows on from April: no gap said")
    labels = E("Array.from(document.querySelectorAll('.bk-stmtsel option')).map(o => o.textContent)")
    ok(any("02-Apr-2026 to 28-Apr-2026" in l for l in labels) and any("03-May-2026 to 30-May-2026" in l for l in labels), "the statement list shows each one's own dates (%s)" % labels)
    pg.click("[data-dup-see]")

    print("== 2. the April lines read again in another style")
    say = up(csv(A1[0], A1[1], PDF), "apr-pdf.csv", 2)
    s3 = st(); sid3 = s3["id"]
    HELD = "JSON.parse(JSON.stringify(B().rows.filter(BankOverlap.isHeld)))"
    held = E(HELD)
    ok([h["date"] for h in held] == ["2026-04-02", "2026-04-05", "2026-04-09", "2026-04-15"] and [h["rep"]["of"] for h in held] == ["2026-04-02", "2026-04-05", "2026-04-09", "2026-04-15"] and all(h["rep"]["kind"] == "strong" for h in held),
       "the same UTR and amount (2), the same date, amount and balance (1), the same cheque 004512 = 4512 (1): held aside (%s)" % [(h["date"], h["rep"]["why"]) for h in held])
    ok("same cheque 4512 and amount" in held[3]["rep"]["why"], "the cheque compared as a number: %s" % held[3]["rep"]["why"])
    ok(E("B().rows.length") == 7 and [h["state"] for h in held] == ["ignored"] * 4 and E("B().rows.map(r => r.date).join()") == "2026-04-02,2026-04-05,2026-04-09,2026-04-15,2026-04-21,2026-04-28,2026-06-02",
       "held lines stay among the statement's lines, in their place, ignored and marked")
    ok(E("window.__charges.length && window.__charges[window.__charges.length - 1]") and "3" in str(E("JSON.stringify(window.__charges[window.__charges.length - 1])")), "only the 3 lines not held are charged (%s)" % E("JSON.stringify(window.__charges[window.__charges.length - 1])"))
    rows = E("B().rows.filter(r => !bankAside(r)).map(r => [r.date, r.rep ? r.rep.kind : ''])")
    ok(rows == [["2026-04-21", "weak"], ["2026-04-28", "weak"], ["2026-06-02", ""]], "the same amount near the date with nothing to compare: added and marked; the new line added (%s)" % rows)
    E("() => { B().filter = 'all'; render(); }"); pg.wait_for_timeout(200)
    ok(E("bankVisibleRows().length") == 3 and s3["n"] == 3 and E("tabCounts(B().rows).ignored") == 0 and E("countStates(B().rows).ignored || 0") == 0 and abs(s3["totDr"] - 118) < 0.01,
       "held lines are not in the books: in no tab (not even All or Ignored), not counted, not in the totals (%s)" % [E("bankVisibleRows().length"), s3["n"], s3["totDr"]])
    E("() => { B().filter = 'review'; render(); }"); pg.wait_for_timeout(200)
    ok(any("4 entries are held aside" in t and "2 entries are marked Possible repeat" in t for t in say), "said: %s" % say)
    ok(E("document.querySelectorAll('[data-bo-list=held] [data-bo-line]').length") == 4 and "Repeat of 02-Apr-2026 entry" in E("document.querySelector('[data-held-repeats]').innerText"), "the held lines are listed: Repeat of 02-Apr-2026 entry, Keep it / It's a repeat")
    ok(E("document.querySelectorAll('[data-weak]').length") == 2 and "Possible repeat — check" in E("document.querySelector('[data-weak]').innerText"), "the marked lines say Possible repeat — check")
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        pg.screenshot(path=os.path.join(SHOTS, "held-repeats-page.png"))
        pg.locator("[data-held-repeats]").screenshot(path=os.path.join(SHOTS, "held-repeats.png"))
        pg.locator("[data-weak]").first.screenshot(path=os.path.join(SHOTS, "possible-repeat-line.png"))
    # posting: the marked lines are left out until confirmed
    E("""() => { B().rows.filter(r => !bankAside(r)).forEach(r => { r.ledger = 'Some Ledger'; r.state = 'ready'; }); window.__posted = []; window.ensureTallyCompany = async () => { window.__posted.push('reached'); return null; };
      const o = window.bankGoneAsk; window.bankGoneAsk = async (b, ids) => { const r = await o(b, ids); window.__ids = r; return r; }; render(); }""")
    E("window.__toasts = []; postBankToTally()"); pg.wait_for_timeout(500)
    d = E("B().rows.find(r => r.date === '2026-06-02').id")
    ok(E("window.__ids") == [d] and E("window.__posted.length") == 1, "posting sends the new line only (%s)" % E("window.__ids"))
    ok(any("2 entries are marked Possible repeat" in t and "not posted" in t for t in toasts()), "and says why the 2 were not posted (%s)" % toasts()[-1:])
    probs = E("bankExportProblems(B().rows.filter(r => r.state === 'ready'))")
    ok(any("Possible repeat" in x for x in probs), "the Tally file waits for them too (%s)" % probs[:1])
    pr = E("postRows(CO()).filter(x => x.kind === 'bank').map(x => x.state[0])")
    ok(pr.count("Possible repeat — check") == 2 and pr.count("Waiting for Tally") == 1, "the Post page lists them as Possible repeat — check (%s)" % pr)
    wid = E("B().rows.find(r => r.date === '2026-04-21').id")
    E("(id) => { B().drawer = id; render(); }", wid); pg.wait_for_timeout(400)
    dr = E("(document.querySelector('[data-bank-drawer]') || {}).innerText || ''")
    ok("Possible repeat — check" in dr and not E("document.querySelector('[data-bank-drawer] [data-drawer-act=post]')") and E("!!document.querySelector('[data-bank-drawer] [data-rep-keep]')"),
       "the line's drawer: Possible repeat — check, Keep it / It's a repeat, no Post (%s)" % dr[:80].replace("\n", " "))
    E("() => { B().drawer = null; render(); }")

    print("== 3. Keep it / It's a repeat / Bring back")
    c2, c1 = E("B().rows.find(r => r.date === '2026-04-28').id"), E("B().rows.find(r => r.date === '2026-04-21').id")
    E("() => { B().filter = 'all'; render(); }"); pg.wait_for_timeout(300)
    pg.click("[data-rep-keep='%s']" % c2); pg.wait_for_timeout(300)
    ok(E("(id) => B().rows.find(r => r.id === id).rep.ok", c2) is True and E("document.querySelectorAll('[data-weak]').length") == 1, "Keep it on a marked line: confirmed")
    E("postBankToTally()"); pg.wait_for_timeout(500)
    ok(sorted(E("window.__ids") or []) == sorted([c2, d]), "now it is posted with the new line (%s)" % E("window.__ids"))
    pg.click("[data-rep-repeat='%s']" % c1); pg.wait_for_timeout(300)
    s3 = st()
    REPS = "B().rows.filter(BankOverlap.isRepeat).map(r => r.id)"; HIDS = "B().rows.filter(BankOverlap.isHeld).map(r => r.id)"
    ok(E("B().rows.length") == 7 and E("(id) => B().rows.findIndex(r => r.id === id)", c1) == 4 and E(REPS) == [c1] and s3["n"] == 2 and not E("(id) => bankVisibleRows().some(r => r.id === id)", c1),
       "It's a repeat on a marked line: kept in its place, out of the books (%s)" % E(REPS))
    E("(id) => BankOverlap.repeat(id)", c2); pg.wait_for_timeout(200)
    ok(E("(id) => B().rows.find(r => r.id === id).state", c2) != "ignored" and E(REPS) == [c1], "the line's own state decides: a kept line is not put aside by a stale screen")
    a = held[0]["id"]; bb = held[2]["id"]
    pg.click("[data-held-keep='%s']" % a); pg.wait_for_timeout(300)
    s3 = st()
    ok(E("B().rows[0].id") == a and E("B().rows[0].state") in ("attention", "suggested", "ready", "intally") and E("(id) => bankVisibleRows().some(r => r.id === id) || bankTabOf(B().rows[0]) !== 'aside'", a) and E("(f) => B().keys[f]", held[0]["fp"]) == sid3 and s3["n"] == 3 and s3["from"] == "2026-04-02",
       "Keep it on a held line: into the books in its place by date, with its key; the statement's dates follow (%s)" % [E("B().rows[0].id"), s3["n"], s3["from"]])
    pg.click("[data-held-repeat='%s']" % bb); pg.wait_for_timeout(300)
    s3 = st()
    ok(E(HIDS) == [held[1]["id"], held[3]["id"]] and E(REPS) == [bb, c1] and E("B().rows.length") == 7, "It's a repeat on a held line: kept aside, in its place")
    pg.click("[data-repeats] > summary"); pg.click("[data-rep-back='%s']" % bb); pg.wait_for_timeout(300)
    s3 = st()
    ok(E(HIDS) == [held[1]["id"], bb, held[3]["id"]] and E(REPS) == [c1], "Bring back: held again, to choose")
    E("saveBank({rows: true, stmts: true})"); pg.wait_for_timeout(1300)
    E("(async () => { S.bank = null; await loadBank('zzov1'); await openStatement('%s'); })()" % sid3); wait(pg, "B() && !B().loading && B().cur === '%s'" % sid3); pg.wait_for_timeout(400)
    s3 = st()
    ok(len(E(HIDS)) == 3 and len(E(REPS)) == 1 and E("B().rows.length") == 7 and E("bankVisibleRows().length") + 0 >= 0 and s3["n"] == 3 and E("(id) => B().rows.find(r => r.id === id).rep.ok", c2) is True, "after a reload: held 3, repeats 1, 3 lines in the books, the confirmation kept")
    E("cloudPush()"); pg.wait_for_timeout(800)
    rec = E("(sid) => (Object.values(__db).find(r => r.kind === 'bank_stmt' && r.id.endsWith(':' + sid)) || {}).data || null", sid3)
    rws = E("(sid) => (Object.values(__db).find(r => r.kind === 'bank_rows' && r.id.endsWith(':' + sid + ':0')) || {}).data || null", sid3)
    ok(rec and "held" not in rec and "repeats" not in rec and rec.get("n") == 3 and rws and len(rws["rows"]) == 7 and sum(1 for r in rws["rows"] if r.get("rep") and r["state"] == "ignored" and (r["rep"].get("gone") or not r["rep"].get("ok"))) == 4,
       "the firm account's copy: the lines carry their marks (bank_rows, 7 lines, 4 aside); the statement record holds no list of them")
    rec2 = E("(sid) => (Object.values(__db).find(r => r.kind === 'bank_stmt' && r.id.endsWith(':' + sid)) || {}).data || null", s2["id"])
    ok(rec2 and len(rec2.get("dupIds") or []) == 6, "and the skipped lines' list (bank_stmt of May)")
    kinds = sorted(set(E("Object.values(__db).map(r => r.kind)")))
    ok(kinds == ["bank_meta", "bank_rows", "bank_stmt"] or set(kinds) >= {"bank_meta", "bank_rows", "bank_stmt"} and not [k for k in kinds if k.startswith("bank_") and k not in ("bank_meta", "bank_rows", "bank_stmt")], "the same kinds of record as before (%s)" % kinds)

    print("== 3b. one posting check: Undo, Bring back, an older version's Restore; the reconciliation")
    E("() => { window.__exact0 = window.exactLedger; window.exactLedger = (v) => v; B().filter = 'all'; render(); }")
    POST = "(async () => { window.__ids = null; await postBankToTally(); return window.__ids; })()"
    def blocked(i): return i not in (E(POST) or []) and E("(id) => bankRepOpen(B().rows.find(r => r.id === id))", i) is True
    def buttons(i): pg.wait_for_timeout(250); return E("(id) => !!document.querySelector(`[data-rep-keep='${id}']`) && !!document.querySelector(`[data-rep-repeat='${id}']`)", i)
    # A: a line marked Possible repeat, a ledger picked, It's a repeat, Undo
    E("(id) => { const r = B().rows.find(x => x.id === id); r.rep = {kind: 'weak', of: '2026-04-28', ofId: 'x', why: 'same amount on the same date'}; r.state = 'attention'; r.ledger = ''; B().undo = null; render(); }", c2)
    E("(id) => bankSetLedger(id, 'Some Ledger')", c2); pg.wait_for_timeout(200)
    ok(E("!!(B().undo && B().undo.snaps.some(s => s.rep && s.rep.kind === 'weak' && !s.rep.ok))"), "A: picking a ledger keeps the mark in the Undo snapshot")
    E("() => { window.__u = B().undo; }"); E("(id) => BankOverlap.repeat(id)", c2); pg.wait_for_timeout(200)
    ok(E("B().undo") is None, "A: It's a repeat clears the Undo")
    E("undoBank()"); ok(E("(id) => bankAside(B().rows.find(r => r.id === id))", c2) is True and c2 not in (E(POST) or []), "A: Undo then does nothing: the line stays aside, not posted")
    E("() => { B().undo = window.__u; undoBank(); const r = B().rows.find(x => x.id === '%s'); r.ledger = 'Some Ledger'; r.state = 'ready'; render(); }" % c2)
    ok(blocked(c2) and buttons(c2), "A: even an Undo from before: the line comes back with its mark, not posted, Keep it / It's a repeat shown")
    # B: ... It's a repeat, Bring back, Undo
    E("(id) => { const r = B().rows.find(x => x.id === id); r.state = 'attention'; r.ledger = ''; B().undo = null; bankSetLedger(id, 'Some Ledger'); window.__u = B().undo; }", c2)
    E("(id) => BankOverlap.repeat(id)", c2); E("(id) => BankOverlap.back(id)", c2); pg.wait_for_timeout(200)
    ok(E("B().undo") is None and E("(id) => BankOverlap.isHeld(B().rows.find(r => r.id === id))", c2) is True, "B: Bring back: held, and the Undo cleared")
    E("() => { B().undo = window.__u; undoBank(); const r = B().rows.find(x => x.id === '%s'); r.state = 'ready'; render(); }" % c2)
    ok(blocked(c2) and buttons(c2), "B: an Undo from before: not posted, Keep it / It's a repeat shown")
    # an older version's Restore of a held line: state back in the books, the mark still strong and not confirmed
    o = held[3]["id"]
    E("(id) => { const r = B().rows.find(x => x.id === id); r.state = 'ready'; r.ledger = 'Some Ledger'; render(); }", o)
    ok(blocked(o) and buttons(o) and "looks like the entry of 15-Apr-2026" in E("(id) => document.querySelector(`[data-weak='${id}']`).innerText", o), "an older version's Restore: not posted, Possible repeat — check with Keep it / It's a repeat")
    ok(any("Possible repeat" in x for x in E("bankExportProblems(B().rows.filter(r => r.state === 'ready'))")) and E("(id) => postRows(CO()).find(x => x.id === id).state[0]", o) == "Possible repeat — check", "and the Tally file and the Post page agree")
    pg.click("[data-rep-keep='%s']" % o); pg.wait_for_timeout(300)
    ok(o in (E(POST) or []), "Keep it: now it is posted")
    # a marked line that becomes ready while the posting waits (its ledger confirmed meanwhile): checked again at the end
    d = E("B().rows.find(r => r.date === '2026-06-02').id")
    fin = E("""async ([c, d]) => {
      const names = ['ensureTallyCompany', 'bankSentHeal', 'syncLedgersFromTally', 'bankLedgerReady', 'syncBankBookFromTally', 'tallyCall', 'scanStatementInTally', 'isOwnBank', 'dropOwnBank', 'bankGoneAsk'];
      const sv = {}; names.forEach(n => { sv[n] = window[n]; });
      const r = B().rows.find(x => x.id === c), dr = B().rows.find(x => x.id === d);
      r.rep = {kind: 'weak', of: '2026-04-28', ofId: 'x', why: 'test'}; r.state = 'attention'; r.ledger = 'Some Ledger'; dr.state = 'ready'; dr.ledger = 'Some Ledger';
      window.__final = []; B().ledgers.live = false;
      window.ensureTallyCompany = async () => 'ZZ TEST'; window.bankSentHeal = async () => ({n: 0}); window.bankGoneAsk = async (b, ids) => ids;
      window.syncLedgersFromTally = async () => { r.state = 'ready'; };
      window.bankLedgerReady = () => 'Demo Bank A/c'; window.syncBankBookFromTally = async () => {}; window.tallyCall = async () => ({vouchers: []});
      window.scanStatementInTally = async () => ({extra: [], wrongDate: []});
      window.isOwnBank = (x) => { window.__final.push(x.id); return true; }; window.dropOwnBank = () => {};
      try { await postBankToTally(); } finally { names.forEach(n => { window[n] = sv[n]; }); B().busy = ''; }
      return window.__final; }""", [c2, d])
    ok(d in fin and c2 not in fin, "a marked line made ready while the posting waited is checked again and not sent (sent: %s)" % fin)
    # a line already posted / already in Tally is never set aside
    for stt in ("sent", "intally"):
        E("([id, s]) => { const r = B().rows.find(x => x.id === id); r.rep = {kind: 'weak', of: '2026-04-28', ofId: 'x', why: 'test'}; r.state = s; render(); }", [c2, stt])
        pg.wait_for_timeout(250)
        E("(id) => BankOverlap.repeat(id)", c2); pg.wait_for_timeout(200)
        ok(E("(id) => bankRepOpen(B().rows.find(r => r.id === id))", c2) is False and E("(id) => B().rows.find(r => r.id === id).state", c2) == stt and not E("(id) => bankAside(B().rows.find(r => r.id === id))", c2)
           and not E("(id) => !!document.querySelector(`[data-rep-keep='${id}'],[data-rep-repeat='${id}']`)", c2), "a line %s: no Keep it / It's a repeat, and It's a repeat refused (it stays %s)" % ("already posted" if stt == "sent" else "already in Tally", stt))
    E("(id) => { const r = B().rows.find(x => x.id === id); r.state = 'ready'; r.rep.ok = true; render(); }", c2)
    # the reconciliation: lines set aside are not the statement's entries, never take a Tally voucher
    E("(id) => { B().rows.find(x => x.id === id).state = 'ignored'; B().rows.find(x => x.id === id).rep = {kind: 'strong', of: '2026-04-15', ofId: 'y', why: 'test'}; }", o)
    aside = E("B().rows.filter(bankAside).map(r => r.id)")
    R = E("""async () => { const sv = [window.ensureTallyCompany, window.tallyBankBalance, Bridge.call];
      CO().bankAccounts[0].ledger = 'Demo Bank A/c';
      window.ensureTallyCompany = async () => 'ZZ TEST'; window.tallyBankBalance = async () => ({close: 0, how: 'test'});
      Bridge.call = async () => ({vouchers: [{date: '20260409', guid: 'g1', type: 'Payment', number: '7', entries: [{ledger: 'Demo Bank A/c', amount: '5000'}, {ledger: 'Cash', amount: '-5000'}]},
                                             {date: '20260405', guid: 'g2', type: 'Payment', number: '8', entries: [{ledger: 'Demo Bank A/c', amount: '1200'}, {ledger: 'Beta', amount: '-1200'}]}]});
      try { const R = await reconcileBank({stay: true}); return R && {missing: R.missing, extra: R.extra.length, pairs: R.pairs}; }
      finally { [window.ensureTallyCompany, window.tallyBankBalance, Bridge.call] = sv; S.recon = null; } }""")
    ok(R and not set(R["missing"]) & set(aside) and R["extra"] == 2 and R["pairs"] == 0 and all(E("(id) => B().rows.find(r => r.id === id).state", i) == "ignored" for i in aside),
       "the reconciliation: the %d lines set aside are not left out, take no Tally voucher (both Tally entries stay unpaired), stay aside (%s)" % (len(aside), R))
    E("() => { window.exactLedger = window.__exact0; B().filter = 'review'; render(); }")

    print("== 4. two identical lines on one day, no balance")
    E(OPEN, "zzov2"); wait(pg, "B() && B().cid === 'zzov2' && !B().loading")
    up(csv(A2[0], A2[1], I1), "jan-a.csv", 0)
    r = E("B().rows.map(r => r.fp)")
    ok(len(r) == 3 and len(set(r)) == 3 and E("B().rows.filter(r => r.narr === 'CASH DEPOSIT BY SELF').length") == 2, "both identical lines are kept, each with its own fingerprint (%d)" % len(r))
    up(csv(A2[0], A2[1], I2), "jan-b.csv", 1)
    ok(st()["dupRows"] == 3 and E("B().rows.length") == 1, "the same two again in a later file: both skipped, one by one (skipped %s, added %s)" % (st()["dupRows"], E("B().rows.length")))
    up(csv(A2[0], A2[1], I3), "jan-c.csv", 2)
    ok(st()["dupRows"] == 1 and E("B().rows.length") == 1 and E("B().rows[0].narr").startswith("NEFT CR-THREE"), "a file with one of them: only that one is skipped (%s)" % st()["dupRows"])

    print("== 5. the join check")
    E(OPEN, "zzov3"); wait(pg, "B() && B().cid === 'zzov3' && !B().loading")
    up(csv(A3[0], A3[1], J1, ("01/01/2026", "31/01/2026")), "jan.csv", 0)
    up(csv(A3[0], A3[1], J2, ("01/03/2026", "31/03/2026")), "mar.csv", 1)
    gap = E("(document.querySelector('[data-join-gap]') || {}).innerText || ''"); days = E("(document.querySelector('[data-join-days]') || {}).innerText || ''")
    ok("1,500.00 difference between 28-Jan-2026 and 03-Mar-2026" in gap, "the gap is flagged: %s" % gap[:140])
    ok("No statement for 01-Feb-2026 to 28-Feb-2026" in days, "and the missing days: %s" % days[:140])

    print("== 6. a deleted statement uploaded again")
    j1 = st(0)["id"]
    E("() => { window.confirmTyped = async () => ({reason: 'test'}); }")
    E("(async (sid) => deleteStatement(sid))('%s')" % j1); pg.wait_for_timeout(1200)
    up(csv(A3[0], A3[1], J1, ("01/01/2026", "31/01/2026")), "jan.csv", 1)
    s6 = st()
    ok(s6["n"] == 2 and not s6.get("dupRows") and not s6.get("held") and E("B().rows.length") == 2, "all its lines come in again, none held or skipped (%s)" % [s6["n"], s6.get("dupRows"), len(s6.get("held") or [])])

    print("== 7. a reference names one entry; syncing after It's a repeat")
    E(OPEN, "zzov5"); wait(pg, "B() && B().cid === 'zzov5' && !B().loading")
    up(csv(A5[0], A5[1], K1, ("01/03/2026", "31/03/2026")), "mar-rent.csv", 0)
    say = up(csv(A5[0], A5[1], K2, ("01/04/2026", "30/04/2026")), "apr-rent.csv", 1)
    ok(not E(HIDS) and E("B().rows.length") == 3 and not E("B().rows.some(r => r.rep)"),
       "monthly rent to the same account (31-Mar, 30-Apr), the same text in the Chq/Ref column a day apart, the loan number on every EMI: none held or marked (%s)" % E("JSON.stringify(B().rows.map(r => r.rep || null))"))
    ok(E("BankOverlap.refKey('TRANSFER TO 50100999998888')") == "" and E("BankOverlap.refKey('50100999998888')") == "" and E("BankOverlap.refKey('004512')") == "C:4512" and E("BankOverlap.refKey('012', true)") == "" and E("BankOverlap.refKey('AXISN26092000111')") == "U:AXISN26092000111",
       "references: words and account-shaped numbers are not; a cheque number is a number of 4 digits or more; a UTR is")
    E(OPEN, "zzov6"); wait(pg, "B() && B().cid === 'zzov6' && !B().loading")
    up(csv(A6[0], A6[1], L0), "jun-a.csv", 0)
    up(csv(A6[0], A6[1], L1), "jun-b.csv", 1)
    sid6 = st()["id"]
    w0 = E("B().rows[0].id")
    ok(E("B().rows.length") == 305 and E("B().rows[0].rep && B().rows[0].rep.kind") == "weak", "a statement of 305 lines (two sync parts), its first line marked Possible repeat")
    E("cloudPush()"); pg.wait_for_timeout(900)
    pre = E("JSON.parse(JSON.stringify(B().rows))")
    E("() => { B().filter = 'all'; render(); }"); pg.wait_for_timeout(300)
    E("(id) => BankOverlap.repeat(id)", w0); pg.wait_for_timeout(300)
    E("cloudPush()"); pg.wait_for_timeout(900)
    parts = E("(sid) => Object.values(__db).filter(r => r.kind === 'bank_rows' && r.id.split(':')[1] === sid).map(r => JSON.parse(JSON.stringify(r)))", sid6)
    ok(sorted(p_["id"].split(":")[2] for p_ in parts) == ["0", "1"] and sum(len(p_["data"]["rows"]) for p_ in parts) == 305, "the firm account holds 2 parts, 305 lines (%s)" % [len(p_["data"]["rows"]) for p_ in parts])
    # the other computer: it held the lines before It's a repeat, and now applies the parts sent after it
    got = E("""async ([sid, pre, parts]) => {
      const key = 'stmt:zzdevB:' + sid; await BankDB.set(key, pre);
      for (const p of parts) await cloudApplyBankPart(Object.assign({}, p, {id: p.id.replace(/^[^:]+/, 'zzdevB')}));
      return (await BankDB.get(key)) || []; }""", [sid6, pre, parts])
    ids = [r["id"] for r in got]
    ok(len(got) == 305 and len(set(ids)) == 305 and ids == [r["id"] for r in pre], "the other computer: 305 lines, each once, in the same places (%d lines, %d different)" % (len(got), len(set(ids))))
    postable = [r for r in got if not (r.get("rep") and r["state"] == "ignored")]
    ok(len(postable) == 304 and got[0]["id"] == w0 and got[0]["state"] == "ignored" and got[0]["rep"].get("gone"), "and the repeat is kept aside there too: 304 lines in the books, none twice")
    ok(E("B().rows.length") == 305 and E("bankVisibleRows().length") == 304, "here: 305 lines held, 304 in the books")
    br.close()
errors = [e for e in errors if "ResizeObserver" not in e]
ok(not errors, "no page errors (%s)" % errors[:3])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
