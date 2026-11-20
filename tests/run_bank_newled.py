"""python3 run_bank_newled.py - new Tally ledgers suggested and made from the bank page (next-bank-newled).
The owner (20-Nov-2026): "an option in bank page that by ticking only that any name of person or company or item...
system should suggest the ledger name to be created in tally.. we can create it single and multi select the rows to add
the ledgers in tally". Rules only; a review list first; one Create makes them in the linked Tally company; name and group
only. Made-up statement and ledgers (never a client's). Checked:
 (1) the name read from UPI / NEFT / IMPS / RTGS / HDFC narrations, cleaned and title-cased, the group guessed (money
     out: Sundry Creditors, money in: Sundry Debtors); never a UPI id, a reference or a number as a name; nothing for a
     machine handle, ATM cash or bank charges; the line shows "New ledger: <name> · <group>" with Create;
 (2) a line with a ledger matched (or set by hand) is never offered a new one;
 (3) a name close to a ledger Tally has: "Similar: <ledger>", not a new ledger;
 (4) one line's Create opens the review with that line only; after Create the line (and the other line of the same
     party) uses the new ledger, the ledgers are read again;
 (5) ticked lines: "Create ledgers for N rows"; the review has one line per party (the ticked lines of one party merged,
     with their count), lines with a ledger and lines with no name counted as skipped; name and group edited; one
     Bridge.post with every master, the client and the company; each line's own untick leaves it out;
 (6) a double click sends once;
 (7) Tally already has it (the bridge says altered): "Already in Tally", and that ledger is used; Tally refuses one:
     "Failed: <reason>", that line keeps no ledger and nothing waits for it;
 (8) the bridge not connected: nothing is sent, the review says why, the ledger waits for the next posting and the line
     uses it;
 (9) a new ledger sent alone from the old one-ledger path (pushNewLedger) carries the client too.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_newled.py"""
import os, threading, functools, http.server, re, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("BNL_PORT") or 8476)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

G = "Orchid Demo Traders"
LINES = [
  # id, out?, narration, the new ledger expected (name, group) or None
  ("r1", 1, "UPI/412345678901/RAMESH KUMAR/rameshk@okaxis/Payment fr", ("Ramesh Kumar", "Sundry Creditors")),
  ("r2", 1, "UPI-RAMESH KUMAR-rameshkumar99@ybl-YESB0000001-412345678911-PAYMENT", ("Ramesh Kumar", "Sundry Creditors")),
  ("r3", 1, "UPI/DR/412345678902/MR SURESH PAL/PYTM/9876543210@paytm/NA", ("Suresh Pal", "Sundry Creditors")),
  ("r4", 0, "UPI/CR/412345678903/BLUEFIN SUPPLIES PVT/HDFC/bluefin.supplies@okhdfcbank/INVOICE 22", ("Bluefin Supplies Pvt", "Sundry Debtors")),
  ("r5", 1, "NEFT DR-HDFC0001234-NOVA TEXTILES LLP-NETBANK, MUM-N123456789012345-RENT", ("Nova Textiles LLP", "Sundry Creditors")),
  ("r6", 1, "IMPS-412345678904-KAVITA SHARMA-HDFC-XXXXXXXX1234-SALARY", ("Kavita Sharma", "Sundry Creditors")),
  ("r7", 1, "RTGS DR-ICIC0000999-SILVERLINE METALS PRIVATE LIMITED-NETBANK, MUM-ICICR52026111900045678", ("Silverline Metals Private Limited", "Sundry Creditors")),
  ("r8", 1, "BY TRANSFER-NEFT*HDFC0000012*N12345678*M S PRAKASH ELECTRICALS--", ("Prakash Electricals", "Sundry Creditors")),
  ("r9", 0, "UPI/412345678908/M/S DEEPAK HARDWARE/deepakhw@okicici/Paid", ("Deepak Hardware", "Sundry Debtors")),
  ("r10", 1, "UPI/412345678906/paytmqr28100505010112abc@paytm/UPI", None),
  ("r11", 1, "UPI-9876543210@ybl-412345678907", None),
  ("r12", 1, "ATM WDL 1234 CONNAUGHT PLACE", None),
  ("r13", 0, "NEFT CR-SBIN0000123-ORBIT ENGINEERS-ORCHID DEMO TRADERS-SBINN52026111900012", None),
  ("r14", 1, "IMPS-412345678912-RAJESH MOTORS-HDFC-XXXXXX5678", None),
  ("r15", 1, "SMS CHARGES QTR", None),
]
SETUP = r"""async ([G, LINES]) => {
  const BANK = "Demo Bank Current";
  const c = newCompany({name: G}); c.tallyName = G; c.bankAccounts = [{id: "a1", bank: "Demo Bank", acct: "0001", ledger: BANK}];
  choiceConfirm(c, "bank:a1", BANK); choiceConfirm(c, "postTo", G);
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  S.data[c.id] = S.data[c.id] || {entries: {}}; S.data[c.id].entries = S.data[c.id].entries || {}; S.data[c.id].loaded = true;
  const rows = LINES.map(([id, out, narr], i) => { const amt = 1000 + 37 * i;
    return {id, fp: "fp-" + id, date: "2026-10-" + String(1 + i).padStart(2, "0"), debit: out ? amt : 0, credit: out ? 0 : amt, narr, dec: decodeNarr(narr, G), ledger: "", state: "attention", balOk: true, why: []}; });
  const base = [{name: BANK, group: "Bank Accounts"}, {name: "Orbit Engineers", group: "Sundry Debtors"}, {name: "Rajesh Motor Works", group: "Sundry Creditors"},
    {name: "Office Rent", group: "Indirect Expenses"}, {name: "Bank Charges", group: "Indirect Expenses"}, {name: "Cash", group: "Cash-in-Hand"}];
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "Demo Bank", acct: "0001", from: "2026-10-01", to: "2026-10-31"}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: base.slice(), groups: ["Bank Accounts", "Sundry Debtors", "Sundry Creditors", "Indirect Expenses", "Cash-in-Hand"], importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "review", grouped: false,
    showSettings: false, q: "", limit: 500, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  window.ensureTallyCompany = async co => (Bridge.on() && Bridge.up() ? G : (toast("Connect FinCom Bridge first."), null));
  window.syncBankBookFromTally = async () => true; window.checkBankBalance = async () => null;
  // ---- the stand's bridge: what Bridge.post was given, and Tally's answer for each ledger
  const T = window.__T = {posts: [], syncs: 0, delay: 0, exist: {}, fail: {}, made: []};
  Object.assign(Bridge.st, {state: "up", version: "2.5.17", tallyUp: true, open: [{name: G, port: 9000}], allowImport: true});
  Bridge.on = () => true; Bridge.up = () => true; Bridge.openFor = () => ({name: G, port: 9000});
  Bridge.post = async (payload) => {
    T.posts.push(JSON.parse(JSON.stringify(payload)));
    if (T.delay) await new Promise(r => setTimeout(r, T.delay));
    return {ok: true, company: payload.company, results: [].concat(payload.masters || []).map(m => {
      const name = (m.xml.match(/<LEDGER NAME="([^"]*)"/) || [])[1];
      if (T.fail[name]) return {id: m.id, ok: false, message: T.fail[name]};
      T.made.push({name, group: (m.xml.match(/<PARENT>([^<]*)<\/PARENT>/) || [])[1]});
      return T.exist[name] ? {id: m.id, ok: true, created: 0, altered: 1, message: "ALTERED: 1"} : {id: m.id, ok: true, created: 1, altered: 0, message: "CREATED: 1"};
    })};
  };
  // reading Tally's ledgers again: what it now has
  window.syncLedgersFromTally = async () => { T.syncs++; const b = B(); T.made.forEach(m => { if (!b.ledgers.list.some(l => l.name === m.name)) b.ledgers.list.push({name: m.name, group: m.group}); });
    b.ledgers.importedAt = new Date().toISOString(); Ledgers.ver++; return true; };
  TCloud.on = () => false;
  suggestAll(S.bank.rows);
  render();
  return c.id;
}"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = pg.evaluate
    cid = E(SETUP, [G, [[a, b, c] for a, b, c, _ in LINES]]); pg.wait_for_timeout(800)
    # the Bank screen's own code is there once the screen is open
    E("() => new Promise((r) => { const go = (k) => typeof NewLed === 'object' || k > 100 ? r() : setTimeout(() => go(k + 1), 50); go(0); })")
    have = E("typeof NewLed === 'object'")
    ok(have, "the Bank screen loads the new-ledger rules (NewLed)")
    row = lambda i: E("(i) => { const r = B().rows.find(x => x.id === i); return {st: r.state, led: r.ledger}; }", i)
    hint = lambda i: pg.locator('#app [data-nl-new="%s"]' % i)
    T = lambda: E("window.__T")
    review = lambda: pg.locator("#app [data-nl-review]")
    def lines():
        return E("""() => Array.from(document.querySelectorAll('#app [data-nl-line]')).map(x => ({name: (x.querySelector('[data-nl-name]') || {}).value, group: (x.querySelector('[data-nl-group]') || {}).value,
          n: ((x.querySelector('[data-nl-n]') || {}).textContent || '').trim(), on: !!(x.querySelector('[data-nl-on]') || {}).checked, text: x.textContent}))""")
    def results():
        return pg.locator("#app [data-nl-results] [data-nl-res]").all_inner_texts()

    # (1) the names
    if have:
        got = E("() => Object.fromEntries(B().rows.map(r => [r.id, NewLed.guess(r)]))")
    else:
        got = {}
    for i, out, narr, want in LINES:
        g = got.get(i)
        if want and i not in ("r13", "r14"):
            ok(bool(g) and g["name"] == want[0] and g["group"] == want[1] and not g["similar"], "(1) %s: %s -> %s · %s (%s)" % (i, narr[:40], want[0], want[1], g))
    for i in ("r10", "r11", "r12", "r15"):
        ok(have and got.get(i) is None and hint(i).count() == 0, "(1) %s: no new ledger for a machine handle, a number handle, ATM cash or charges (%s)" % (i, got.get(i)))
    names = [g["name"] for g in got.values() if g]
    ok(have and not any("@" in n or re.search(r"\d", n) for n in names), "(1) no name carries a UPI id, a reference or a number (%s)" % names)
    ok(hint("r1").count() == 1 and hint("r1").inner_text().replace("\n", " ").startswith("New ledger: Ramesh Kumar · Sundry Creditors"), "(1) the line says 'New ledger: Ramesh Kumar · Sundry Creditors' (%s)" % (hint("r1").inner_text() if hint("r1").count() else "none"))
    ok(pg.locator('#app [data-nl-create="r1"]').count() == 1 and hint("r4").count() == 1 and "Bluefin Supplies Pvt · Sundry Debtors" in hint("r4").inner_text(), "(1) with its own Create; money in is guessed Sundry Debtors")

    # (2) a line with a ledger matched is never offered one
    ok(row("r13")["led"] == "Orbit Engineers" and hint("r13").count() == 0 and got.get("r13") is None, "(2) a line matched to a Tally ledger: no new ledger (%s)" % row("r13"))
    E("() => { bankSetLedger('r15', 'Bank Charges'); }"); pg.wait_for_timeout(300)
    ok(row("r15")["led"] == "Bank Charges" and E("NewLed.guess(B().rows.find(r => r.id === 'r15'))") is None if have else False, "(2) a line given a ledger by hand: none either")

    # (3) close to a ledger Tally has
    sim = pg.locator('#app [data-nl-similar="r14"]')
    ok(sim.count() == 1 and "Similar: Rajesh Motor Works" in sim.inner_text() and hint("r14").count() == 0, "(3) 'Similar: Rajesh Motor Works', not a new ledger (%s)" % (sim.inner_text() if sim.count() else "none"))

    # (4) one line's Create: the review with that line only; the line and its party's other line use it
    if pg.locator('#app [data-nl-create="r1"]').count():
        pg.click('#app [data-nl-create="r1"]'); pg.wait_for_timeout(400)
    L = lines()
    ok(review().count() == 1 and len(L) == 1 and L[0]["name"] == "Ramesh Kumar" and L[0]["group"] == "Sundry Creditors" and L[0]["on"], "(4) the review: that line only (%s)" % L)
    if review().count():
        pg.click("#app [data-nl-go]"); pg.wait_for_timeout(800)
    t = T()
    ok(len(t["posts"]) == 1 and len(t["posts"][0]["masters"]) == 1 and t["posts"][0]["client"] == cid and t["posts"][0]["company"] == G and t["posts"][0]["vouchers"] == [],
       "(4) one Bridge.post: one master, the client and the company, no vouchers (%s)" % [(len(x.get("masters", [])), x.get("client"), x.get("company")) for x in t["posts"]])
    ok(any("Ramesh Kumar" in r and "Created" in r for r in results()), "(4) the result: Ramesh Kumar Created (%s)" % results())
    ok(row("r1") == {"st": "ready", "led": "Ramesh Kumar"} and row("r2")["led"] == "Ramesh Kumar", "(4) the line uses the new ledger, and so does the other line of the party (%s, %s)" % (row("r1"), row("r2")))
    ok(t["syncs"] >= 1 and E("B().newLed.some(l => l.name === 'Ramesh Kumar' && l.sent)"), "(4) Tally's ledgers read again; the ledger is marked made")
    if pg.locator("#app [data-nl-close]").count(): pg.click("#app [data-nl-close]"); pg.wait_for_timeout(300)
    ok(review().count() == 0 and hint("r1").count() == 0 and hint("r2").count() == 0, "(4) closed; neither line offers a new ledger any more")

    # (5) ticked lines: merged per party, skipped counted, edited, one post with every master
    E("() => { B().rows.push(Object.assign({}, B().rows.find(r => r.id === 'r3'), {id: 'r3b', fp: 'fp-r3b', date: '2026-10-20', debit: 4321})); suggestAll(B().rows, true); ['r3', 'r3b', 'r13', 'r10', 'r5', 'r6', 'r7'].forEach(id => B().sel.add(id)); render(); }")
    pg.wait_for_timeout(400)
    bulk = pg.locator("#app .actionbar [data-nl-bulk]")
    ok(bulk.count() == 1 and bulk.inner_text().strip() == "Create ledgers for 7 rows", "(5) the bar: 'Create ledgers for 7 rows' (%s)" % (bulk.inner_text() if bulk.count() else "none"))
    if bulk.count(): bulk.click(); pg.wait_for_timeout(400)
    L = lines()
    ok([x["name"] for x in L] == ["Suresh Pal", "Nova Textiles LLP", "Kavita Sharma", "Silverline Metals Private Limited"], "(5) one line per party (%s)" % [x["name"] for x in L])
    ok(L and L[0]["n"] == "2 rows" and all(x["n"] == "1 row" for x in L[1:]), "(5) the two lines of Suresh Pal merged, with their count (%s)" % [x["n"] for x in L])
    sk = pg.locator("#app [data-nl-skip]")
    ok(sk.count() == 1 and "1 row already has a ledger" in sk.inner_text() and "1 row has no name to use" in sk.inner_text(), "(5) skipped: 1 with a ledger, 1 with no name (%s)" % (sk.inner_text() if sk.count() else "none"))
    opts = E("() => Array.from(document.querySelectorAll('#app [data-nl-line] [data-nl-group]')[0].options).map(o => o.value)") if L else []
    ok("Indirect Expenses" in opts and "Sundry Debtors" in opts and "Cash-in-Hand" in opts, "(5) the group: a list of Tally's groups (%s)" % opts[:6])
    if len(L) == 4:
        first = pg.locator("#app [data-nl-line]").nth(0)
        first.locator("[data-nl-name]").fill("Suresh Pal Contractor"); first.locator("[data-nl-group]").select_option("Indirect Expenses")
        pg.locator("#app [data-nl-line]").nth(3).locator("[data-nl-on]").uncheck(); pg.wait_for_timeout(200)
    go = pg.locator("#app [data-nl-go]")
    ok(go.count() == 1 and go.inner_text().strip() == "Create 3 ledgers in Tally", "(5) one line unticked: 'Create 3 ledgers in Tally' (%s)" % (go.inner_text() if go.count() else "none"))
    # (7) set up first: Tally already has Nova Textiles LLP (it answers altered); it refuses Kavita Sharma
    E("() => { window.__T.exist['Nova Textiles LLP'] = true; window.__T.fail['Kavita Sharma'] = 'Group &apos;Sundry Creditorz&apos; does not exist'; window.__T.delay = 500; }")
    n0 = len(T()["posts"])
    # (6) a double click
    if go.count(): go.dblclick(); pg.wait_for_timeout(1500)
    t = T(); posts = t["posts"][n0:]
    ok(len(posts) == 1, "(6) a double click: one Bridge.post (%d)" % len(posts))
    m = posts[0]["masters"] if posts else []
    ok(len(m) == 3 and posts[0]["client"] == cid and posts[0]["company"] == G, "(5) one Bridge.post with the 3 masters, the client and the company (%d)" % len(m))
    xml = "".join(x["xml"] for x in m)
    ok('<LEDGER NAME="Suresh Pal Contractor"' in xml and "<PARENT>Indirect Expenses</PARENT>" in xml and "Silverline" not in xml, "(5) the edited name and group sent; the unticked line not sent")
    ok("OPENINGBALANCE" not in xml, "(5) name and group only: no opening balance")
    R = results()
    ok(any("Suresh Pal Contractor" in r and "Created" in r for r in R), "(5) Suresh Pal Contractor: Created (%s)" % R)
    ok(row("r3") == {"st": "ready", "led": "Suresh Pal Contractor"} and row("r3b")["led"] == "Suresh Pal Contractor", "(5) both lines of the party use it (%s)" % row("r3b"))
    ok(any("Nova Textiles LLP" in r and "Already in Tally" in r for r in R) and row("r5") == {"st": "ready", "led": "Nova Textiles LLP"}, "(7) Tally already had it: 'Already in Tally', and it is used (%s)" % row("r5"))
    ok(any("Kavita Sharma" in r and "Failed: Group 'Sundry Creditorz' does not exist" in r for r in R), "(7) refused: 'Failed: <Tally's reason>' (%s)" % R)
    ok(row("r6")["led"] == "" and not E("B().newLed.some(l => l.name === 'Kavita Sharma')"), "(7) that line keeps no ledger, nothing waits for it (%s)" % row("r6"))
    ok(row("r7")["led"] == "" and row("r10")["led"] == "" and row("r13")["led"] == "Orbit Engineers", "(5) the unticked line and the skipped ones are as they were")
    if pg.locator("#app [data-nl-close]").count(): pg.click("#app [data-nl-close]"); pg.wait_for_timeout(300)
    ok(hint("r7").count() == 1, "(5) the unticked line still offers its new ledger")

    # (8) the bridge not connected
    E("() => { Bridge.on = () => false; Bridge.up = () => false; window.__T.delay = 0; B().sel.clear(); render(); }"); pg.wait_for_timeout(300)
    n0 = len(T()["posts"])
    if pg.locator('#app [data-nl-create="r8"]').count():
        pg.click('#app [data-nl-create="r8"]'); pg.wait_for_timeout(300)
        pg.click("#app [data-nl-go]"); pg.wait_for_timeout(800)
    ok(len(T()["posts"]) == n0, "(8) bridge not connected: nothing sent")
    why = pg.locator("#app [data-nl-why]")
    ok(why.count() == 1 and "FinCom Bridge is not connected" in why.inner_text(), "(8) the review says why (%s)" % (why.inner_text() if why.count() else "none"))
    ok(any("Prakash Electricals" in r and "next posting" in r for r in results()), "(8) the ledger waits for the next posting (%s)" % results())
    ok(row("r8") == {"st": "ready", "led": "Prakash Electricals"} and E("B().newLed.some(l => l.name === 'Prakash Electricals' && !l.sent)"), "(8) kept as a new ledger, not sent; the line uses it (%s)" % row("r8"))

    # (9) the one-ledger path carries the client
    E("() => { Bridge.on = () => true; Bridge.up = () => true; const x = document.querySelector('#app [data-nl-close]'); if (x) x.click(); }")
    n0 = len(T()["posts"])
    E("() => createLedger('Lotus Demo Stores', 'Sundry Debtors')"); pg.wait_for_timeout(800)
    t = T(); posts = t["posts"][n0:]
    ok(len(posts) == 1 and posts[0].get("client") == cid and len(posts[0]["masters"]) == 1, "(9) pushNewLedger: one master, with the client (%s)" % [x.get("client") for x in posts])

    ok(not errors, "no page errors (%s)" % errors[:3])
    br.close()
print("\n%d failed" % len(fails) if fails else "\nall passed")
srv.shutdown()
raise SystemExit(1 if fails else 0)
