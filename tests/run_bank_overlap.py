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
(6) a deleted statement uploaded again: all its lines come in, as before.
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
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
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
    E(SETUP, [["zzov1", "Sample Works Pvt Ltd", A1[0], A1[1]], ["zzov2", "Model Traders", A2[0], A2[1]], ["zzov3", "Example Stores", A3[0], A3[1]]])
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
    held = s3.get("held") or []
    ok([h["date"] for h in held] == ["2026-04-02", "2026-04-05", "2026-04-09"] and [h["rep"]["of"] for h in held] == ["2026-04-02", "2026-04-05", "2026-04-09"] and all(h["rep"]["kind"] == "strong" for h in held),
       "the same UTR and amount (2), the same date, amount and balance (1): held aside (%s)" % [(h["date"], h["rep"]["why"]) for h in held])
    rows = E("B().rows.map(r => [r.date, r.rep ? r.rep.kind : ''])")
    ok(rows == [["2026-04-21", "weak"], ["2026-04-28", "weak"], ["2026-06-02", ""]], "the same amount near the date with nothing to compare: added and marked; the new line added (%s)" % rows)
    ok(not any(E("(f) => B().keys[f] === '%s'" % sid3, h["fp"]) for h in held) and s3["n"] == 3, "held lines are not in the books (no key, not counted)")
    ok(any("3 entries are held aside" in t and "2 entries are marked Possible repeat" in t for t in say), "said: %s" % say)
    ok(E("document.querySelectorAll('[data-bo-list=held] [data-bo-line]').length") == 3 and "Repeat of 02-Apr-2026 entry" in E("document.querySelector('[data-held-repeats]').innerText"), "the held lines are listed: Repeat of 02-Apr-2026 entry, Keep it / It's a repeat")
    ok(E("document.querySelectorAll('[data-weak]').length") == 2 and "Possible repeat — check" in E("document.querySelector('[data-weak]').innerText"), "the marked lines say Possible repeat — check")
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        pg.screenshot(path=os.path.join(SHOTS, "held-repeats-page.png"))
        pg.locator("[data-held-repeats]").screenshot(path=os.path.join(SHOTS, "held-repeats.png"))
        pg.locator("[data-weak]").first.screenshot(path=os.path.join(SHOTS, "possible-repeat-line.png"))
    # posting: the marked lines are left out until confirmed
    E("""() => { B().rows.forEach(r => { r.ledger = 'Some Ledger'; r.state = 'ready'; }); window.__posted = []; window.ensureTallyCompany = async () => { window.__posted.push('reached'); return null; };
      const o = window.bankGoneAsk; window.bankGoneAsk = async (b, ids) => { const r = await o(b, ids); window.__ids = r; return r; }; render(); }""")
    E("window.__toasts = []; postBankToTally()"); pg.wait_for_timeout(500)
    d = E("B().rows.find(r => r.date === '2026-06-02').id")
    ok(E("window.__ids") == [d] and E("window.__posted.length") == 1, "posting sends the new line only (%s)" % E("window.__ids"))
    ok(any("2 entries are marked Possible repeat" in t and "not posted" in t for t in toasts()), "and says why the 2 were not posted (%s)" % toasts()[-1:])
    probs = E("bankExportProblems(B().rows.filter(r => r.state === 'ready'))")
    ok(any("Possible repeat" in x for x in probs), "the Tally file waits for them too (%s)" % probs[:1])

    print("== 3. Keep it / It's a repeat / Bring back")
    c2, c1 = E("B().rows.find(r => r.date === '2026-04-28').id"), E("B().rows.find(r => r.date === '2026-04-21').id")
    E("() => { B().filter = 'all'; render(); }"); pg.wait_for_timeout(300)
    pg.click("[data-rep-keep='%s']" % c2); pg.wait_for_timeout(300)
    ok(E("(id) => B().rows.find(r => r.id === id).rep.ok", c2) is True and E("document.querySelectorAll('[data-weak]').length") == 1, "Keep it on a marked line: confirmed")
    E("postBankToTally()"); pg.wait_for_timeout(500)
    ok(sorted(E("window.__ids") or []) == sorted([c2, d]), "now it is posted with the new line (%s)" % E("window.__ids"))
    pg.click("[data-rep-repeat='%s']" % c1); pg.wait_for_timeout(300)
    s3 = st()
    ok(not E("(id) => B().rows.some(r => r.id === id)", c1) and [r["id"] for r in s3.get("repeats") or []] == [c1] and s3["n"] == 2, "It's a repeat on a marked line: out of the books, kept aside (%s)" % [r["id"] for r in s3.get("repeats") or []])
    a = held[0]["id"]; bb = held[2]["id"]
    pg.click("[data-held-keep='%s']" % a); pg.wait_for_timeout(300)
    s3 = st()
    ok(E("B().rows[0].id") == a and E("B().rows[0].state") in ("attention", "suggested", "ready", "intally") and E("(f) => B().keys[f]", held[0]["fp"]) == sid3 and s3["n"] == 3 and s3["from"] == "2026-04-02",
       "Keep it on a held line: into the books in its place by date, with its key; the statement's dates follow (%s)" % [E("B().rows[0].id"), s3["n"], s3["from"]])
    pg.click("[data-held-repeat='%s']" % bb); pg.wait_for_timeout(300)
    s3 = st()
    ok([h["id"] for h in s3.get("held") or []] == [held[1]["id"]] and [r["id"] for r in s3.get("repeats") or []] == [c1, bb], "It's a repeat on a held line: kept aside")
    pg.click("[data-repeats] > summary"); pg.click("[data-rep-back='%s']" % bb); pg.wait_for_timeout(300)
    s3 = st()
    ok([h["id"] for h in s3.get("held") or []] == [held[1]["id"], bb] and [r["id"] for r in s3.get("repeats") or []] == [c1], "Bring back: held again, to choose")
    E("saveBank({rows: true, stmts: true})"); pg.wait_for_timeout(1300)
    E("(async () => { S.bank = null; await loadBank('zzov1'); await openStatement('%s'); })()" % sid3); wait(pg, "B() && !B().loading && B().cur === '%s'" % sid3); pg.wait_for_timeout(400)
    s3 = st()
    ok(len(s3.get("held") or []) == 2 and len(s3.get("repeats") or []) == 1 and E("B().rows.length") == 3 and E("(id) => B().rows.find(r => r.id === id).rep.ok", c2) is True, "after a reload: held 2, repeats 1, the 3 lines with the confirmation")
    E("cloudPush()"); pg.wait_for_timeout(800)
    rec = E("(sid) => (Object.values(__db).find(r => r.kind === 'bank_stmt' && r.id.endsWith(':' + sid)) || {}).data || null", sid3)
    ok(rec and len(rec.get("held") or []) == 2 and len(rec.get("repeats") or []) == 1 and rec.get("fileFrom") == "2026-04-02", "the firm account's statement record carries them (bank_stmt)")
    rec2 = E("(sid) => (Object.values(__db).find(r => r.kind === 'bank_stmt' && r.id.endsWith(':' + sid)) || {}).data || null", s2["id"])
    ok(rec2 and len(rec2.get("dupIds") or []) == 6, "and the skipped lines' list (bank_stmt of May)")
    kinds = sorted(set(E("Object.values(__db).map(r => r.kind)")))
    ok(kinds == ["bank_meta", "bank_rows", "bank_stmt"] or set(kinds) >= {"bank_meta", "bank_rows", "bank_stmt"} and not [k for k in kinds if k.startswith("bank_") and k not in ("bank_meta", "bank_rows", "bank_stmt")], "the same kinds of record as before (%s)" % kinds)

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
    br.close()
errors = [e for e in errors if "ResizeObserver" not in e]
ok(not errors, "no page errors (%s)" % errors[:3])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
