"""python3 run_bank_sent_heal.py - bank lines a posting of this computer put in Tally are marked posted, never sent twice
(owner, 26-Oct-2026 19:31 IST, ITSEasy Solutions, "Its Bank 25-26.xlsx": Tally created 41 vouchers of job 3cca4219, ids up to
2447, but the 41 lines stayed "Post to Tally (41)"; pressing again, the bridge's resend guard refused them all, "already sent
from this computer on 26-10-2026 (Tally ids up to 2447, sent in a batch of 41), job 3cca4219…", and the page called them
"41 not posted" in red).
A stand for FinCom Bridge 2.1.8 runs in the page (its /jobs, the record of what it sent, Tally's reply per request: CREATED,
LASTVCHID), with reading entries by date off (/ledgerlines answers readDays false: nothing can be read back). Checked:
(1) a batch Tally took whole (CREATED = 41, no errors): the 41 lines are posted (In Tally), with the batch's ids, each line's
    id inferred (2407..2447 in the order sent, marked inferred) and the job; the Post button no longer counts them;
(2) the same lines again, this browser's memory wiped: the bridge's resend guard holds them back; each is marked posted
    from that job's record (they are in Tally), nothing is sent to Tally, and the report is one quiet line
    "41 already in Tally (sent HH:MM, Tally ids up to 2447) - marked as posted.", not red;
(3) the owner's state (lines ready, "already sent from this computer on … job X" on each): opening the Bank page heals them
    from the job's record, without pressing anything;
(4) a partial batch (Tally created 40 of 41): needs review, never marked; pressed again, held back by the guard and still
    not marked (the job's record says Tally did not take it whole), never sent again;
(5) a posting this page stopped following before its last batch was answered ("No such job" while the bridge rewrote its
    progress): a short gap is ridden out; a long one leaves the lines with the job, and the job's record marks them.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_sent_heal.py"""
import os, threading, functools, http.server, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8291), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SETUP = r"""async () => {
  const G = "ITSEasy Solutions Pvt Ltd", BANK = "Its Bank", PARTY = "Sundry Receipts";
  const c = newCompany({name: G, gstin: "09AAKFG1234C1Z5"}); c.tallyName = G; c.bankAccounts = [{id: "a1", bank: "Its Bank", acct: "2526", ledger: BANK}];
  choiceConfirm(c, "bank:a1", BANK); choiceConfirm(c, "postTo", G);
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  const mk = (n, p) => Array.from({length: n}, (_, i) => ({id: p + i, fp: "fp-" + p + i, date: "2026-01-" + String(1 + (i % 28)).padStart(2, "0"), debit: 0, credit: 1000 + i,
    narr: "NEFT CR CUSTOMER " + i, dec: {name: "CUSTOMER " + i, mode: "NEFT"}, ledger: PARTY, state: "ready", balOk: true, userSet: true}));
  window.__mkRows = mk;
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "Its Bank", acct: "2526", from: "2026-01-01", to: "2026-01-31"}], cur: "s1", rows: mk(41, "s1-"), rules: [], wrules: [],
    ledgers: {list: [{name: BANK, group: "Bank Accounts"}, {name: PARTY, group: "Sundry Debtors"}], importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "ready", grouped: false,
    showSettings: false, q: "", limit: 500, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  window.ensureTallyCompany = async () => G; window.syncLedgersFromTally = async () => true; window.syncBankBookFromTally = async () => true;
  window.checkBankBalance = async () => null;
  // reading entries by date is off on this computer: the copy says so, nothing can be read back
  window.tallyCall = async (co, path) => /^\/(ledgerlines|vouchers)/.test(path) ? {ok: true, via: "copy", vouchers: [], readDays: false, note: "reading entries from Tally is off on this computer"} : {vouchers: []};
  // ---- the stand: FinCom Bridge 2.1.8 on this computer (jobs, posted-ids.json, Tally's reply per request)
  const T = window.__T = {jobs: {}, rec: {}, imports: [], last: 2366, batch: 50, mode: "whole", gets: 0, lostFrom: -1, lostN: 0, holdLast: false};
  Object.assign(Bridge.st, {state: "up", version: "2.4.5", tallyUp: true, open: [{name: G, port: 9000}], allowImport: true});
  Bridge.on = () => true; Bridge.up = () => true; Bridge.openFor = () => ({name: G, port: 9000}); Bridge.ensureProven = async () => true; Bridge.refresh = async () => true;
  const err = (m) => Object.assign(new Error(m), {code: "bridge"});
  const key = id => String(id).replace(/[^A-Za-z0-9]/g, "");
  const day = () => { const d = new Date(); return String(d.getDate()).padStart(2, "0") + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + d.getFullYear(); };
  Bridge.call = async (path, body) => {
    if (path === "/jobs" && body){
      const id = body.jobId, results = [], vs = [].concat(body.vouchers || []), at0 = new Date().toISOString();
      const todo = [];
      vs.forEach(v => { const a = T.rec[key(v.id)]; if (!a){ todo.push(v); return; }
        results.push({id: v.id, kind: "voucher", ok: false, alreadySent: true, refused: true, sent: true, state: "failed", sentOn: a.at, vchId: "", sentJob: a.job, batchN: a.n, batchEnd: a.end,
          message: "already sent from this computer on " + day() + " (Tally ids up to " + a.end + ", sent in a batch of " + a.n + "), job " + a.job}); });
      const reqs = []; for (let i = 0; i < todo.length; i += T.batch) reqs.push(todo.slice(i, i + T.batch));
      reqs.forEach((r, k) => {
        const n = r.length, at = new Date(Date.now() + k * 1000).toISOString(), bad = T.mode === "ledger" ? r.filter(v => /<LEDGERNAME>Software<\/LEDGERNAME>/.test(v.xml)) : [];
        const whole = T.mode === "whole" || (T.mode === "ledger" && !bad.length), created = whole ? n : n - (bad.length || 1);
        const lineError = bad.length ? ["Ledger &apos;Software&apos; does not exist!"] : [];
        T.imports.push(r.map(v => v.id)); T.last += created; const lv = String(T.last);
        r.forEach(v => { T.rec[key(v.id)] = {job: id, end: lv, n, at};
          results.push(Object.assign({id: v.id, kind: "voucher", company: G, lastVchId: lv, created, altered: 0, errors: whole ? 0 : 1, exceptions: 0, ignored: 0, sentAt: at, batchN: n, batchEnd: lv, vchDate: "20260101", vchType: "Receipt"},
            whole ? {ok: true, verified: false, byReply: true, message: ""} : {ok: false, needsReview: true, accepted: true, lineError, message: "Tally's reply: created " + created + " of " + n + ", errors 1" + (lineError.length ? ", Ledger 'Software' does not exist!" : "")})); });
      });
      T.jobs[id] = {id, status: "done", company: G, total: vs.length, done: vs.length, results, finishedAt: new Date().toISOString(), checking: false, message: "Posted"};
      T.gets = 0;
      return {id, status: "running", company: G, total: vs.length, done: 0, results: []};
    }
    let m = /^\/jobs\?id=(.+)$/.exec(path);
    if (m){
      const id = decodeURIComponent(m[1]), j = T.jobs[id];
      if (!j) throw err("No such job.");
      const g = T.gets++;
      // the page reads the job while the bridge rewrites its progress: "No such job" for a while
      if (T.lostFrom >= 0 && g >= T.lostFrom && g < T.lostFrom + T.lostN) throw err("No such job.");
      // the last request still at Tally: the job running, its answers not all there yet
      if (T.holdLast && g < T.lostFrom) return Object.assign({}, j, {status: "running", results: j.results.slice(0, j.results.length - T.batch)});
      return JSON.parse(JSON.stringify(j));
    }
    if (/^\/jobs\/resume/.test(path)) return T.jobs[body.id];
    return {ok: true};
  };
  render();
  return c.id;
}"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8291/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = pg.evaluate
    cid = E(SETUP); pg.wait_for_timeout(600)
    btn = lambda: E("(() => { const b = [...document.querySelectorAll('#app button')].find(x => /^(Post to Tally|Create Tally file) \\(/.test(x.innerText.trim())); return b ? b.innerText.trim() : ''; })()")
    rows = lambda: E("B().rows.map(r => ({id: r.id, st: r.state, by: r.postByReply === true, end: r.tally && r.tally.batchEnd, n: r.tally && r.tally.batchN, g: r.tally && r.tally.vchGuess, inf: !!(r.tally && r.tally.inferred), job: r.tally && r.tally.job, err: r.postError || ''}))")
    rep = lambda: E("(() => { const r = B().postReport || {}; return {posted: r.posted, failed: (r.failed || []).map(f => f.msg), already: r.already || 0, line: r.alreadyLine || ''}; })()")
    ok(btn() == "Post to Tally (41)", "the statement: 41 lines ready, 'Post to Tally (41)' (%s)" % btn())

    # (1) one request of 41, Tally's reply CREATED 41, no errors, LASTVCHID 2407..2447
    E("() => { window.__T.batch = 50; window.__T.last = 2406; }")
    E("() => postBankToTally()"); pg.wait_for_timeout(1200)
    R = rows(); J = list(E("Object.keys(window.__T.jobs)"))
    ok(all(r["st"] == "sent" and r["by"] and r["end"] == "2447" and r["n"] == 41 and not r["err"] for r in R), "(1) all 41 lines posted by Tally's reply, batch ending Tally id 2447 of 41 (%s)" % R[0])
    ok([r["g"] for r in R] == [str(2407 + i) for i in range(41)] and all(r["inf"] for r in R), "(1) each line's Tally id inferred in the order sent, 2407..2447, marked inferred (%s, %s)" % (R[0]["g"], R[-1]["g"]))
    ok(J and all(r["job"] == J[0] for r in R), "(1) and each carries the job (%s)" % R[0]["job"])
    ok(E("tabCounts(B().rows).post") == 0 and btn() == "Post to Tally (0)", "(1) the Post button no longer counts them (%s)" % btn())
    E("() => { B().filter = 'done'; render(); }"); pg.wait_for_timeout(400)
    t = pg.inner_text("#app table.bk-table tbody tr >> nth=0")
    ok("In Tally" in t and "batch ending Tally id 2447" in t and "Tally ids 2407\u20132447; this line 2407, inferred" in t and "job " + J[0][:8] in t, "(1) the line says In Tally, the ids and the job (%s)" % t.replace("\n", " ")[:220])
    rp = rep(); al = pg.locator("#app .bk-alert").first.get_attribute("class") if pg.locator("#app .bk-alert").count() else ""
    ok(rp["posted"] == 41 and not rp["failed"] and "41 in Tally" in pg.inner_text("#app") and "bad" not in (al or ""), "(1) the report: 41 in Tally, nothing red (%s)" % rp)
    n_imp = len(E("window.__T.imports"))

    # (2) the same lines again, this browser's memory of them wiped: the bridge's guard holds them back; marked from the job
    E("() => { B().rows.forEach(r => { r.state = 'ready'; r.tally = null; r.postByReply = false; r.sentAt = ''; r.postedVia = ''; }); B().postedTags = {}; B().postReport = null; B().filter = 'ready'; render(); }")
    ok(btn() == "Post to Tally (41)", "(2) memory wiped: 'Post to Tally (41)' again")
    E("() => postBankToTally()"); pg.wait_for_timeout(1200)
    R = rows(); rp = rep()
    ok(len(E("window.__T.imports")) == n_imp, "(2) nothing is sent to Tally again (%d imports)" % len(E("window.__T.imports")))
    ok(all(r["st"] == "sent" and r["end"] == "2447" and r["job"] == J[0] for r in R) and [r["g"] for r in R] == [str(2407 + i) for i in range(41)], "(2) each line held back by the guard is marked posted from job %s's record (%s)" % (J[0][:8], R[0]))
    al = pg.locator("#app .bk-alert[data-already-posted]")
    ok(not rp["failed"] and rp["already"] == 41 and re.match(r"^41 already in Tally \(sent \d\d:\d\d, Tally ids up to 2447\) \u2014 marked as posted\.$", rp["line"]) and al.count() == 1 and "bad" not in (al.get_attribute("class") or ""),
       "(2) one quiet line, not red: %s" % rp["line"])
    txt = pg.inner_text("#app")
    ok("not posted" not in txt and "already sent from this computer" not in txt and btn() == "Post to Tally (0)", "(2) no 'not posted', no list of duplicates, nothing left to post (%s)" % btn())

    # (3) the owner's state: lines ready, each with the guard's words naming the job; the Bank page opened again
    E("""async () => { const b = B(); const msg = (await (async () => 'already sent from this computer on 26-10-2026 (Tally ids up to 2447, sent in a batch of 41), job ' + Object.keys(window.__T.jobs)[0])());
      b.rows.forEach(r => { r.state = 'ready'; r.tally = null; r.postByReply = false; r.sentAt = ''; r.postedVia = ''; r.postError = msg; delete r.postJob; });
      b.postedTags = {}; b.postReport = null;
      await BankDB.set('stmts:' + b.cid, b.stmts); await BankDB.set('stmt:' + b.cid + ':s1', JSON.parse(JSON.stringify(b.rows))); await BankDB.set('posted:' + b.cid, {});
      const led = b.ledgers; bankHealOpen.done = {}; await loadBank(b.cid);
      B().ledgers = led; B().filter = 'ready'; render(); }""")
    pg.wait_for_timeout(1500)
    R = rows()
    ok(len(R) == 41 and all(r["st"] == "sent" and r["end"] == "2447" and not r["err"] for r in R) and len(E("window.__T.imports")) == n_imp,
       "(3) on opening the Bank page the 41 lines heal themselves from the job's record, nothing sent (%s)" % (R[0] if R else None))
    ok(btn() == "Post to Tally (0)" and "41 already in Tally" in pg.inner_text("#app"), "(3) 'Post to Tally (0)', and the quiet line says why (%s)" % btn())

    # (4) a partial batch: Tally created 40 of 41 (a line error): needs review, never marked, never sent again
    E("() => { const b = B(); b.rows = window.__mkRows(41, 's1-p'); b.postReport = null; b.filter = 'ready'; window.__T.mode = 'partial'; render(); }")
    E("() => postBankToTally()"); pg.wait_for_timeout(1200)
    R = rows(); rp = rep(); n_imp2 = len(E("window.__T.imports"))
    ok(all(r["st"] == "ready" for r in R) and len(rp["failed"]) == 41 and "created 40 of 41" in rp["failed"][0], "(4) a partial batch: none marked, 41 for review (%s)" % (rp["failed"][:1]))
    E("() => { B().postReport = null; window.__T.mode = 'whole'; }")
    E("() => postBankToTally()"); pg.wait_for_timeout(1200)
    R = rows(); rp = rep()
    # 30-Oct-2026 (run_bank_partial_post.py): the lines keep Tally's own words and wait for Check with Tally, never only
    # the guard's "already sent from this computer"
    ok(all(r["st"] == "ready" for r in R) and len(E("window.__T.imports")) == n_imp2 and len(rp["failed"]) == 41 and not rp["already"] and "Tally made 40 of the 41" in rp["failed"][0] and "already sent from this computer" not in rp["failed"][0],
       "(4) pressed again: not sent, still not marked (Tally did not take that batch whole), with Tally's words (%s)" % rp["failed"][:1])
    bankheal_open = E("(async () => { bankHealOpen.done = {}; return await bankHealOpen(); })()")
    ok(bankheal_open == 0 and all(r["st"] == "ready" for r in rows()), "(4) and opening the page does not mark them either")

    # (5a) the page loses the job for a moment ("No such job" twice) while the last batch is answered: ridden out
    E("() => { const b = B(); b.rows = window.__mkRows(7, 's1-q'); b.postReport = null; Object.assign(window.__T, {mode: 'whole', batch: 3, lostFrom: 1, lostN: 2, holdLast: true}); }")
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    R = rows()
    ok(all(r["st"] == "sent" for r in R) and not rep()["failed"], "(5a) a short 'No such job' while the bridge rewrites its progress: the posting is followed to its end, all 7 posted (%s)" % [r["st"] for r in R])
    # (5b) the page loses the job for good before the last batch's answer: those lines keep the job, and its record marks them
    E("() => { const b = B(); b.rows = window.__mkRows(7, 's1-r'); b.postReport = null; Object.assign(window.__T, {mode: 'whole', batch: 3, lostFrom: 1, lostN: 1000, holdLast: true}); }")
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    R = rows(); n_imp3 = len(E("window.__T.imports"))
    ok([r["st"] for r in R] == ["sent"] * 4 + ["ready"] * 3 and all(r["err"] for r in R[4:]), "(5b) the answers the page had are marked; the 3 it never saw wait, with the job (%s)" % [r["st"] for r in R])
    E("() => { window.__T.lostN = 0; window.__T.lostFrom = -1; window.__T.holdLast = false; bankHealOpen.done = {}; }")
    E("(async () => bankHealOpen())()"); pg.wait_for_timeout(600)
    R = rows()
    ok(all(r["st"] == "sent" for r in R) and len(E("window.__T.imports")) == n_imp3 and R[-1]["end"] and R[-1]["job"], "(5b) the lines whose answers were lost here are marked from the job's record, never sent again (%s)" % R[-1])

    # (6) the 19-Feb-2026 receipt: one request of 41, Tally created 40 and refused the line to "Software" (no such ledger)
    E("""() => { const b = B(); b.rows = window.__mkRows(41, 's1-s'); b.rows[20].ledger = 'Software'; b.ledgers.list.push({name: 'Software', group: 'Indirect Incomes'}); b.postReport = null;
      Object.assign(window.__T, {mode: 'ledger', batch: 50, last: 2407}); }""")
    E("() => postBankToTally()"); pg.wait_for_timeout(1200)
    R = rows(); rp = rep(); sw = R[20]
    ok(sum(r["st"] == "sent" for r in R) == 40 and sw["st"] == "ready" and R[19]["end"] == "2447" and R[19]["g"] == "2427" and R[21]["g"] == "2428", "(6) Tally created 40 of 41: the 40 are posted (ids inferred around the refused one), the Software line is not (%s / %s)" % (R[19], sw))
    ok(len(rp["failed"]) == 1 and "Tally refused this line" in rp["failed"][0] and "Software" in rp["failed"][0] and "Software" in sw["err"], "(6) the report names the one line not posted and why, in Tally's words (%s)" % rp["failed"])
    # (6b) the owner's state for it: every line ready with the guard's words; opening the page sorts them the same way
    E("""async () => { const b = B(), jid = Object.keys(window.__T.jobs).slice(-1)[0];
      b.rows.forEach(r => { r.state = 'ready'; r.tally = null; r.postByReply = false; r.postedVia = ''; r.sentAt = ''; r.postError = 'already sent from this computer on 26-10-2026 (Tally ids up to 2447, sent in a batch of 41), job ' + jid; delete r.postJob; });
      b.postedTags = {}; bankHealOpen.done = {}; await bankHealOpen(); }""")
    R = rows(); n_imp4 = len(E("window.__T.imports"))
    ok(sum(r["st"] == "sent" for r in R) == 40 and R[20]["st"] == "ready" and "Tally refused this line" in R[20]["err"] and "40 already in Tally" in pg.inner_text("#app"), "(6b) on opening the page: 40 In Tally, the Software line ready with its reason (%s)" % R[20]["err"][:90])
    E("() => postBankToTally()"); pg.wait_for_timeout(1000)
    ok(len(E("window.__T.imports")) == n_imp4 and rows()[20]["st"] == "ready", "(6b) Post again: the Software line is never sent again (the bridge's record holds it)")

    # (7) never a line whose ledger is its own bank account's ledger
    E("() => { const b = B(); b.rows = window.__mkRows(3, 's1-o'); b.postReport = null; window.__T.mode = 'whole'; render(); }")
    r7 = E("bankSetLedger('s1-o0', 'Its Bank')")
    ok(r7 is False and E("B().rows[0].ledger") == "" and E("B().rows[0].state") == "attention", "(7) choosing the bank account's own ledger by hand is refused; the line has no ledger (%s)" % E("B().rows[0].state"))
    ok("This is the bank account itself" in pg.inner_text("body"), "(7) and it says: This is the bank account itself, choose the expense or party ledger")
    E("() => { const r = B().rows[1]; r.ledger = 'Its Bank'; r.state = 'suggested'; r.userSet = false; suggestAll([r], true); }")
    ok(E("B().rows[1].ledger") != "Its Bank", "(7) a suggestion of the bank's own ledger is dropped (%s)" % E("B().rows[1].ledger"))
    E("() => { const r = B().rows[2]; r.ledger = 'Its Bank'; r.state = 'ready'; r.userSet = true; learnRows([r], 'you'); }")
    ok(not E("(B().hist.rows['fp-s1-o2'] || {}).l"), "(7) and it is never learnt")
    n_imp5 = len(E("window.__T.imports"))
    E("() => postBankToTally(['s1-o2'])"); pg.wait_for_timeout(800)
    ok(len(E("window.__T.imports")) == n_imp5 and E("B().rows[2].state") == "attention" and "bank account itself" in " ".join(rep()["failed"]), "(7) a ready line with it is not posted (no Contra to and from the bank); it goes back for a ledger (%s)" % rep()["failed"])
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
