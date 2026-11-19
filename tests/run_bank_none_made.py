"""python3 run_bank_none_made.py - a batch Tally refused whole (it made 0 of the lines sent) is said plainly, never as
"does not say which" (owner, 19-Nov-2026).
What happened: Tally answered a request of 39 bank lines "created 0 of 39" with one line error, "Could not set
'SVCurrentCompany' to '<company>'" (the company was not open in Tally). The bridge puts any reply that is not clean under
review (needsReview), so every line said "Tally made 0 of the 39 lines sent together and does not say which ... Press
Check with Tally to find which of them are in Tally". Tally had said plainly that it made none; the bridge keeps no record
of such a request (acceptedForgetMany), so the lines may simply go again.
Made-up fixtures (never a client's lines). Checked:
 (0) bankInReview: a reply of 0 made (no outcome unknown, not accepted) is not in review; a partly made batch, no answer,
     accepted, or a reply without Tally's counts still is;
 (1) Post 39 lines; Tally cannot open the company: no line is in review, none released, each says "Tally made none of the
     39 lines. Tally could not open <company>: open it in Tally (and close any screen or login prompt in it), then post
     again."; no "does not say which", no Check with Tally; the report says nothing of a check;
 (2) the company opened, Post again: all 39 are made, each once;
 (3) any other words of a whole refusal: "Tally made none of the 39 lines. Tally said: <words>. Nothing was posted; fix this
     in Tally and post again.";
 (4) lines stored before (postReview from a 0-made reply, the old words): opening the statement shows the new words and
     takes them out of review; a stored partly made batch and a stored no-answer line stay in review, and Post sends only
     the 0-made ones;
 (5) a batch Tally made only partly (8 of 39) still says "does not say which" and offers Check with Tally.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_none_made.py"""
import os, threading, functools, http.server, re, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("BNM_PORT") or 8472)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

G = "Zeta Traders Pvt Ltd"
SV = "Could not set 'SVCurrentCompany' to '" + G + "'"
SETUP = r"""async (G) => {
  const BANK = "Zeta Bank", RCPT = "Sundry Receipts", PAY = "Sundry Payments";
  const c = newCompany({name: G, gstin: "09AAKFZ1234C1Z5"}); c.tallyName = G; c.bankAccounts = [{id: "a1", bank: "Zeta Bank", acct: "0001", ledger: BANK}];
  choiceConfirm(c, "bank:a1", BANK); choiceConfirm(c, "postTo", G);
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  S.data[c.id] = S.data[c.id] || {entries: {}}; S.data[c.id].entries = S.data[c.id].entries || {}; S.data[c.id].loaded = true;
  const mk = (n, p) => Array.from({length: n}, (_, i) => { const cr = i % 3 !== 1, amt = 2000 + 41 * i, d = new Date(Date.UTC(2026, 8, 2 + Math.floor(i * 0.7)));
    return {id: p + i, fp: "fp-" + p + i, date: d.toISOString().slice(0, 10), debit: cr ? 0 : amt, credit: cr ? amt : 0, narr: (cr ? "NEFT CR CUSTOMER " : "NEFT DR SUPPLIER ") + i,
      dec: {name: (cr ? "CUSTOMER " : "SUPPLIER ") + i, mode: "NEFT"}, ledger: cr ? RCPT : PAY, state: "ready", balOk: true, userSet: true}; });
  window.__mkRows = mk;
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "Zeta Bank", acct: "0001", from: "2026-09-01", to: "2026-10-31"}], cur: "s1", rows: mk(39, "s1-"), rules: [], wrules: [],
    ledgers: {list: [{name: BANK, group: "Bank Accounts"}, {name: RCPT, group: "Sundry Debtors"}, {name: PAY, group: "Sundry Creditors"}], importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "ready", grouped: false,
    showSettings: false, q: "", limit: 500, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  window.ensureTallyCompany = async () => G; window.syncLedgersFromTally = async () => true; window.syncBankBookFromTally = async () => true;
  window.checkBankBalance = async () => null; window.scanStatementInTally = async () => ({extra: [], wrongDate: []});
  // ---- the stand's Tally: the vouchers it holds. T.whole: words for a request it refuses whole (it makes none);
  // T.makeOnly: it makes only the first n of a request and refuses the rest
  const T = window.__T = {jobs: {}, rec: {}, imports: [], last: 5100, batch: 50, whole: "", makeOnly: 0, tally: []};
  const tagOf = x => ((String(x).match(/TDSDesk:([A-Za-z0-9]+)/) || [])[1] || "");
  const dateOf = x => (String(x).match(/<DATE>(\d{8})<\/DATE>/) || [])[1] || "";
  const typeOf = x => (String(x).match(/VCHTYPE="([^"]*)"/) || [])[1] || "";
  window.tallyCall = async () => ({vouchers: []});
  Object.assign(Bridge.st, {state: "up", version: "2.4.9", tallyUp: true, open: [{name: G, port: 9000}], allowImport: true});
  Bridge.on = () => true; Bridge.up = () => true; Bridge.openFor = () => ({name: G, port: 9000}); Bridge.ensureProven = async () => true; Bridge.refresh = async () => true;
  const err = (m) => Object.assign(new Error(m), {code: "bridge"});
  const key = id => String(id).replace(/[^A-Za-z0-9]/g, "");
  Bridge.call = async (path, body) => {
    if (path === "/jobs" && body){
      const id = body.jobId, results = [], vs = [].concat(body.vouchers || []);
      const todo = [];
      vs.forEach(v => {
        const a = T.rec[key(v.id)];
        if (a){ results.push({id: v.id, kind: "voucher", ok: false, alreadySent: true, refused: true, sent: true, state: "failed", sentOn: a.at, vchId: "", sentJob: a.job, batchN: a.n, batchEnd: a.end,
          message: "already sent from this computer on 19-11-2026 (Tally ids up to " + a.end + ", sent in a batch of " + a.n + "), job " + a.job}); return; }
        const there = T.tally.find(t => tagOf(t.narration) && tagOf(t.narration) === tagOf(v.xml));
        if (there){ results.push({id: v.id, kind: "voucher", ok: false, already: true, sameId: true, company: G, message: "Already in Tally (voucher no. " + there.number + ")", vchNumber: there.number, vchType: there.type, vchDate: there.date, guid: there.guid, masterId: there.masterId}); return; }
        todo.push(v);
      });
      const reqs = []; for (let i = 0; i < todo.length; i += T.batch) reqs.push(todo.slice(i, i + T.batch));
      reqs.forEach((r, k) => {
        const n = r.length, at = new Date(Date.now() + k * 1000).toISOString();
        const made = T.whole ? [] : T.makeOnly ? r.slice(0, T.makeOnly) : r;
        T.imports.push(r.map(v => v.id));
        made.forEach(v => { T.last++; T.tally.push({date: dateOf(v.xml), type: typeOf(v.xml), number: String(T.last - 5000), guid: "guid-" + T.last, masterId: String(T.last),
          narration: (String(v.xml).match(/<NARRATION>([\s\S]*?)<\/NARRATION>/) || [])[1] || "", cancelled: "No"}); });
        const lv = made.length ? String(T.last) : "0", whole = made.length === n;
        const lineError = T.whole ? [T.whole] : whole ? [] : r.slice(made.length).map((v, z) => "Voucher Number '" + (700 + z) + "' already exists!");
        r.forEach(v => {
          // FinCom Bridge 2.4.9 (bridge-go/post.go): a request Tally made nothing of is not on its record (it may go again);
          // any other is recorded as sent
          if (made.length) T.rec[key(v.id)] = {job: id, end: lv, n, at};
          results.push(Object.assign({id: v.id, kind: "voucher", company: G, lastVchId: lv, created: made.length, altered: 0, errors: lineError.length, exceptions: 0, ignored: 0, sentAt: at, batchN: n, batchEnd: lv, vchDate: dateOf(v.xml), vchType: typeOf(v.xml)},
            whole ? {ok: true, verified: false, byReply: true, message: ""} : {ok: false, needsReview: true, accepted: made.length > 0, lineError, message: "Tally's reply: created " + made.length + " of " + n + ", errors " + lineError.length + ": " + lineError.slice(0, 2).join(" | ")}));
        });
      });
      T.jobs[id] = {id, status: "done", company: G, total: vs.length, done: vs.length, results, finishedAt: new Date().toISOString(), checking: false, message: "Posted"};
      return {id, status: "running", company: G, total: vs.length, done: 0, results: []};
    }
    let m = /^\/jobs\?id=(.+)$/.exec(path);
    if (m){ const j = T.jobs[decodeURIComponent(m[1])]; if (!j) throw err("No such job."); return JSON.parse(JSON.stringify(j)); }
    if (/^\/jobs\/resume/.test(path)) return T.jobs[body.id];
    return {ok: true};
  };
  TCloud.on = () => true; TCloud.st[c.id] = {at: Date.now(), books: [{book: "bk-1", company: G, from: null}]};
  TCloud.status = async () => TCloud.st[c.id].books; TCloud.restAll = async () => []; Cloud.api = async () => [];
  TCloud.rpc = async () => ({ok: true});
  if (typeof CloudJobs === "object"){ CloudJobs.load = async () => null; }
  render();
  return c.id;
}"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = pg.evaluate
    cid = E(SETUP, G); pg.wait_for_timeout(600)
    # the Bank screen's own code (src/js/96) is there once the screen is open
    E("() => new Promise((r) => { const go = (k) => typeof bankInReview === 'function' || k > 100 ? r() : setTimeout(() => go(k + 1), 50); go(0); })")
    rows = lambda: E("B().rows.map(r => ({id: r.id, st: r.state, err: r.postError || '', rev: !!r.postReview, rel: !!r.release, job: r.postJob || ''}))")
    rep = lambda: E("(() => { const r = B().postReport || {}; return {posted: r.posted || 0, failed: (r.failed || []).map(f => f.msg), review: r.review || 0}; })()")
    report_text = lambda: pg.inner_text("#app [data-bank-report]") if pg.locator("#app [data-bank-report]").count() else ""

    # (0) bankInReview
    cases = E("""() => { const base = {ok: false, needsReview: true, accepted: false, created: 0, altered: 0, batchN: 39, lineError: ["x"]};
      return {none: bankInReview(base), part: bankInReview(Object.assign({}, base, {created: 8, accepted: true})), unknown: bankInReview(Object.assign({}, base, {outcomeUnknown: true})),
        accepted: bankInReview(Object.assign({}, base, {accepted: true})), nocounts: bankInReview({ok: false, needsReview: true}), altered: bankInReview(Object.assign({}, base, {altered: 2, accepted: true}))}; }""")
    ok(cases["none"] is False, "(0) a reply Tally made none of is not in review (%s)" % cases["none"])
    ok(all(cases[k] is True for k in ["part", "unknown", "accepted", "nocounts", "altered"]), "(0) partly made, no answer, accepted, altered, or no counts: still in review (%s)" % cases)

    # (1) Tally cannot open the company: it makes none of the 39
    E("(w) => { window.__T.whole = w; }", SV)
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    R = rows(); rp = rep()
    ok(len(E("window.__T.imports")) == 1 and len(E("window.__T.tally")) == 0, "(1) one request of 39 went; Tally made none")
    want = "Tally made none of the 39 lines. Tally could not open " + G + ": open it in Tally (and close any screen or login prompt in it), then post again."
    ok(all(r["st"] == "ready" and not r["rev"] and not r["rel"] for r in R), "(1) every line ready, not in review, not released (%s)" % R[0])
    ok(all(r["err"] == want for r in R), "(1) each line says Tally could not open the company (%s)" % R[0]["err"][:200])
    ok(not any("does not say which" in r["err"] or "Check with Tally" in r["err"] for r in R), "(1) no 'does not say which', no 'Check with Tally'")
    t = report_text()
    ok(rp["review"] == 0 and pg.locator("#app [data-check-review]").count() == 0 and "does not say which" not in t and "check with Tally" not in t,
       "(1) the report offers no check with Tally (%s)" % t.replace("\n", " ")[:200])
    body = pg.inner_text("#app")
    ok("Tally could not open " + G in body and "does not say which" not in body, "(1) the screen shows the new words, never 'does not say which'")

    # (2) the company opened in Tally: Post again makes all 39, each once
    E("() => { window.__T.whole = ''; B().postReport = null; }")
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    R = rows(); tags = [re.search(r"TDSDesk:([A-Za-z0-9]+)", v["narration"]).group(1) for v in E("window.__T.tally")]
    ok(all(r["st"] == "sent" for r in R) and len(tags) == 39 and len(set(tags)) == 39, "(2) posted again: all 39 in Tally, each once (%d, %d distinct)" % (len(tags), len(set(tags))))

    # (3) other words of a whole refusal
    E("() => { const b = B(); b.rows = window.__mkRows(39, 's3-'); b.postReport = null; window.__T.whole = 'Voucher totals do not match!'; }")
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    R = rows()
    want3 = "Tally made none of the 39 lines. Tally said: Voucher totals do not match! Nothing was posted; fix this in Tally and post again."
    ok(all(r["st"] == "ready" and not r["rev"] and r["err"] == want3 for r in R), "(3) Tally's own words, nothing posted, post again (%s)" % R[0]["err"][:200])

    # (4) lines stored before this fix: postReview from a 0-made reply and the old words
    E("""(sv) => { const b = B(); b.rows = window.__mkRows(6, 's4-'); b.postReport = null; window.__T.whole = ''; window.__T.makeOnly = 0;
      const old = (made, n, said) => 'Tally made ' + made + ' of the ' + n + ' lines sent together and does not say which. Tally said: ' + said + '. Press Check with Tally to find which of them are in Tally.';
      b.rows.forEach((r, i) => {
        if (i < 4){ r.postReview = {job: 'job-old-0', created: 0, n: 39, batchEnd: '0', at: '2026-11-18T10:00:00Z', words: [sv]}; r.postJob = 'job-old-0'; r.postError = old(0, 39, sv); }
        else if (i === 4){ r.postReview = {job: 'job-old-8', created: 8, n: 39, batchEnd: '5120', at: '2026-11-18T10:00:00Z', words: ["Voucher Number '700' already exists!"]}; r.postJob = 'job-old-8'; r.postError = old(8, 39, "Voucher Number '700' already exists!"); }
        else { r.postReview = {job: 'job-old-u', created: 0, n: 39, batchEnd: '', at: '2026-11-18T10:00:00Z', words: ['Sent to Tally, but no answer came']}; r.postJob = 'job-old-u'; r.postError = 'Sent to Tally, and no answer came, so FinCom cannot tell whether Tally made it. Tally said: Sent to Tally, but no answer came. Press Check with Tally.'; }
      });
      ['job-old-0', 'job-old-8', 'job-old-u'].forEach(j => { window.__T.jobs[j] = {id: j, status: 'done', company: 'x', results: []}; });
      bankHealOpen.done = {}; return bankHealOpen(); }""", SV)
    pg.wait_for_timeout(500)
    R = rows()
    ok(all(not r["rev"] and r["err"] == want for r in R[:4]), "(4) stored 0-made lines: the new words, out of review (%s)" % R[0]["err"][:200])
    ok(R[4]["rev"] and "Tally made 8 of the 39 lines sent together and does not say which" in R[4]["err"], "(4) a stored partly made line stays in review (%s)" % R[4]["err"][:100])
    ok(R[5]["rev"] and "no answer came" in R[5]["err"], "(4) a stored no-answer line stays in review (%s)" % R[5]["err"][:100])
    n_imp = len(E("window.__T.imports"))
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    imps = E("window.__T.imports"); R = rows()
    ok(len(imps) == n_imp + 1 and sorted(imps[-1]) == ["s4-0", "s4-1", "s4-2", "s4-3"], "(4) Post sends only the 4 Tally made none of (%s)" % (imps[-1] if len(imps) > n_imp else "nothing"))
    ok(all(r["st"] == "sent" for r in R[:4]) and R[4]["rev"] and R[5]["rev"] and R[4]["st"] == "ready" and R[5]["st"] == "ready", "(4) those 4 posted; the 2 that may be in Tally still wait for a check")
    # the same stored lines, Post pressed before the statement was opened again: the 0-made ones go, the others wait
    E("""(sv) => { const b = B(); b.rows = window.__mkRows(3, 's5-'); b.postReport = null;
      b.rows.forEach((r, i) => { r.postReview = {job: 'job-old-0', created: i ? 0 : 8, n: 39, batchEnd: i ? '0' : '5120', at: '2026-11-18T10:00:00Z', words: [sv]}; r.postJob = 'job-old-0';
        r.postError = 'Tally made ' + (i ? 0 : 8) + ' of the 39 lines sent together and does not say which. Tally said: ' + sv + '. Press Check with Tally to find which of them are in Tally.'; }); }""", SV)
    n_imp = len(E("window.__T.imports"))
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    imps = E("window.__T.imports"); R = rows()
    ok(len(imps) == n_imp + 1 and sorted(imps[-1]) == ["s5-1", "s5-2"] and R[0]["rev"] and R[0]["st"] == "ready", "(4) Post straight away: only the 0-made stored lines go (%s)" % (imps[-1] if len(imps) > n_imp else "nothing"))

    # (5) a batch Tally made only partly still waits for a check
    E("() => { const b = B(); b.rows = window.__mkRows(39, 's6-'); b.postReport = null; window.__T.whole = ''; window.__T.makeOnly = 8; }")
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    R = rows(); rp = rep()
    ok(all(r["st"] == "ready" and r["rev"] and "Tally made 8 of the 39 lines sent together" in r["err"] and "does not say which" in r["err"] for r in R), "(5) 8 of 39: every line in review, 'does not say which' (%s)" % R[0]["err"][:120])
    t = report_text()
    ok(rp["review"] == 39 and pg.locator("#app [data-check-review]").count() == 1 and "wait for a check with Tally" in t, "(5) the report offers Check with Tally (%s)" % t.replace("\n", " ")[:160])
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
raise SystemExit(1 if fails else 0)
