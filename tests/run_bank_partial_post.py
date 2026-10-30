"""python3 run_bank_partial_post.py - bank lines of a batch Tally made only partly are never lost quietly (owner, 30-Oct-2026,
Fingate Advisory Services: an HDFC statement posted to Tally, "some entries were not posted"; 24 of 69 lines of 4-Aug..6-Oct
in Tally, 45 not, no error left on the page).
What staging showed (read-only): one job of the bridge on the Tally computer, two requests of 50 and 37 bank lines; Tally's
ids went 3033 -> 3041 -> 3057, so it made 8 of the 50 and 16 of the 37 (24). The bridge put every line of both requests
under review (Tally's reply never says which voucher it refused) and on its record as sent; the next Post, its resend
guard answered "already sent from this computer on ... job ..." for all 87, those words replaced Tally's on every line,
and the lines sat "ready" with no way forward. The client's Tally book had no from date, so the posting went straight to
the bridge, and FinCom's cloud has no tally_post_record (migration 27 never ran there): no record, no row on the Post
page's Errors tab, and nothing said.
Made-up fixtures (never the owner's lines): 70 lines, posted in requests of 50 and 20; the stand's Tally makes 8 of the 50
and 16 of the 20, with a line error for each one it refuses. Checked:
 (1) first Post: no line is marked posted on a guess; all 70 are listed with Tally's own words and counts ("Tally made 8 of
     the 50 lines sent together ... Tally said: ..."), and the report offers Check with Tally;
 (2) the record: FinCom's cloud without tally_post_record -> the report says the posting was not recorded (never quiet);
     with it -> one record of the 70 answers; a press that sent nothing (the guard's refusals) records nothing new;
 (3) the Post page's Errors tab lists all 70 bank lines with Tally's words;
 (4) Post again: nothing is sent, and every line still carries Tally's words, never only the guard's;
 (5) Check with Tally (the bank ledger read for those days): the 24 in Tally are marked posted with their voucher; the 46
     are not, released, and Post sends exactly those 46 once (the bridge lets each go once more); all 70 posted, none twice;
 (6) a read that does not hold those days: "Not checked", nothing marked; Post them again: the bridge's look in Tally
     before each marks the ones already there as posted (Already in Tally), the rest are made; none twice.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_partial_post.py"""
import os, threading, functools, http.server, re, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("BPP_PORT") or 8293)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SETUP = r"""async () => {
  const G = "Zeta Advisory Services Pvt Ltd", BANK = "Zeta Bank", RCPT = "Sundry Receipts", PAY = "Sundry Payments";
  const c = newCompany({name: G, gstin: "09AAKFZ1234C1Z5"}); c.tallyName = G; c.bankAccounts = [{id: "a1", bank: "Zeta Bank", acct: "0001", ledger: BANK}];
  choiceConfirm(c, "bank:a1", BANK); choiceConfirm(c, "postTo", G);
  S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "bank";
  S.data[c.id] = S.data[c.id] || {entries: {}}; S.data[c.id].entries = S.data[c.id].entries || {}; S.data[c.id].loaded = true;
  // made-up lines: receipts and payments on days of Aug..Oct 2026; two lines share a day and an amount
  const mk = (n, p, day0) => Array.from({length: n}, (_, i) => { const cr = i % 3 !== 1, amt = 1000 + 37 * i, d = new Date(Date.UTC(2026, 7, 4 + Math.floor((day0 || 0) + i * 0.9)));
    return {id: p + i, fp: "fp-" + p + i, date: d.toISOString().slice(0, 10), debit: cr ? 0 : amt, credit: cr ? amt : 0, narr: (cr ? "NEFT CR PARTY " : "NEFT DR VENDOR ") + i,
      dec: {name: (cr ? "PARTY " : "VENDOR ") + i, mode: "NEFT"}, ledger: cr ? RCPT : PAY, state: "ready", balOk: true, userSet: true}; });
  window.__mkRows = mk;
  S.bank = {cid: c.id, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "Zeta Bank", acct: "0001", from: "2026-08-01", to: "2026-10-25"}], cur: "s1", rows: mk(70, "s1-"), rules: [], wrules: [],
    ledgers: {list: [{name: BANK, group: "Bank Accounts"}, {name: RCPT, group: "Sundry Debtors"}, {name: PAY, group: "Sundry Creditors"}], importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "ready", grouped: false,
    showSettings: false, q: "", limit: 500, pendingRule: null, busy: "", createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: []};
  window.ensureTallyCompany = async () => G; window.syncLedgersFromTally = async () => true; window.syncBankBookFromTally = async () => true;
  window.checkBankBalance = async () => null; window.scanStatementInTally = async () => ({extra: [], wrongDate: []});
  // ---- the stand's Tally: the vouchers it holds, numbered; and the bank ledger read for a period (or "not covered")
  const T = window.__T = {jobs: {}, rec: {}, imports: [], last: 3033, batch: 50, refuse: new Set(), tally: [], covered: true, sentIds: [], rpc: [], rpcMode: "missing"};
  const tagOf = x => ((String(x).match(/TDSDesk:([A-Za-z0-9]+)/) || [])[1] || "");
  const amtOf = x => { const m = [...String(x).matchAll(/<LEDGERNAME>([^<]*)<\/LEDGERNAME>[\s\S]*?<AMOUNT>([-0-9.]+)<\/AMOUNT>/g)]; return m.map(z => ({ledger: z[1].replace(/&amp;/g, "&"), amount: z[2]})); };
  const dateOf = x => (String(x).match(/<DATE>(\d{8})<\/DATE>/) || [])[1] || "";
  const typeOf = x => (String(x).match(/VCHTYPE="([^"]*)"/) || [])[1] || "";
  window.tallyCall = async (co, path) => {
    if (!/^\/(ledgerlines|vouchers)/.test(path)) return {vouchers: []};
    if (!T.covered) return {ok: true, via: "copy", vouchers: [], readDays: false, note: "reading entries from Tally is off on this computer"};
    return {ok: true, vouchers: T.tally.map(v => JSON.parse(JSON.stringify(v)))};
  };
  // ---- the stand: FinCom Bridge 2.4.9 on this computer (jobs, its record of what it sent, the look in Tally before each)
  Object.assign(Bridge.st, {state: "up", version: "2.4.9", tallyUp: true, open: [{name: G, port: 9000}], allowImport: true});
  Bridge.on = () => true; Bridge.up = () => true; Bridge.openFor = () => ({name: G, port: 9000}); Bridge.ensureProven = async () => true; Bridge.refresh = async () => true;
  const err = (m) => Object.assign(new Error(m), {code: "bridge"});
  const key = id => String(id).replace(/[^A-Za-z0-9]/g, "");
  const day = () => { const d = new Date(); return String(d.getDate()).padStart(2, "0") + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + d.getFullYear(); };
  Bridge.call = async (path, body) => {
    if (path === "/jobs" && body){
      const id = body.jobId, results = [], vs = [].concat(body.vouchers || []), rel = [].concat(body.released || []);
      const todo = [];
      vs.forEach(v => {
        const a = T.rec[key(v.id)], r = rel.find(x => String(x.id) === String(v.id) && x.at && !(a && (a.honoured || []).includes(x.at)));
        if (a && !r){ results.push({id: v.id, kind: "voucher", ok: false, alreadySent: true, refused: true, sent: true, state: "failed", sentOn: a.at, vchId: "", sentJob: a.job, batchN: a.n, batchEnd: a.end,
          message: "already sent from this computer on " + day() + " (Tally ids up to " + a.end + ", sent in a batch of " + a.n + "), job " + a.job}); return; }
        if (a && r) a.honoured = (a.honoured || []).concat([r.at]);
        // 2.1.4: the look in Tally just before posting: the same voucher there already
        const there = T.tally.find(t => tagOf(t.narration) && tagOf(t.narration) === tagOf(v.xml));
        if (there){ results.push({id: v.id, kind: "voucher", ok: false, already: true, sameId: true, company: G, message: "Already in Tally (voucher no. " + there.number + ", " + day() + ")", vchNumber: there.number, vchType: there.type, vchDate: there.date, guid: there.guid, masterId: there.masterId}); return; }
        todo.push(v);
      });
      const reqs = []; for (let i = 0; i < todo.length; i += T.batch) reqs.push(todo.slice(i, i + T.batch));
      reqs.forEach((r, k) => {
        const n = r.length, at = new Date(Date.now() + k * 1000).toISOString(), bad = r.filter(v => T.refuse.has(String(v.id))), made = r.filter(v => !T.refuse.has(String(v.id)));
        T.imports.push(r.map(v => v.id)); T.sentIds.push(...r.map(v => v.id));
        made.forEach(v => { T.last++; const ents = amtOf(v.xml); T.tally.push({date: dateOf(v.xml), type: typeOf(v.xml), number: String(T.last - 3000), guid: "guid-" + T.last, masterId: String(T.last),
          narration: (String(v.xml).match(/<NARRATION>([\s\S]*?)<\/NARRATION>/) || [])[1] || "", entries: ents, cancelled: "No"}); });
        const lv = String(T.last), whole = !bad.length, lineError = bad.map((v, z) => "Voucher Number '" + (900 + z) + "' already exists!");
        r.forEach(v => { T.rec[key(v.id)] = {job: id, end: lv, n, at};
          results.push(Object.assign({id: v.id, kind: "voucher", company: G, lastVchId: lv, created: made.length, altered: 0, errors: bad.length, exceptions: 0, ignored: 0, sentAt: at, batchN: n, batchEnd: lv, vchDate: dateOf(v.xml), vchType: typeOf(v.xml)},
            whole ? {ok: true, verified: false, byReply: true, message: ""} : {ok: false, needsReview: true, accepted: made.length > 0, lineError, message: "Tally's reply: created " + made.length + " of " + n + ", errors " + bad.length + ": " + lineError.slice(0, 2).join(" | ")})); });
      });
      T.jobs[id] = {id, status: "done", company: G, total: vs.length, done: vs.length, results, finishedAt: new Date().toISOString(), checking: false, message: "Posted"};
      return {id, status: "running", company: G, total: vs.length, done: 0, results: []};
    }
    let m = /^\/jobs\?id=(.+)$/.exec(path);
    if (m){ const j = T.jobs[decodeURIComponent(m[1])]; if (!j) throw err("No such job."); return JSON.parse(JSON.stringify(j)); }
    if (/^\/jobs\/resume/.test(path)) return T.jobs[body.id];
    return {ok: true};
  };
  // ---- FinCom's cloud: on, the client's Tally book has no from date (so the posting goes straight to the bridge, as
  // for the owner's client); tally_post_record missing ("missing") or there ("ok")
  TCloud.on = () => true; TCloud.st[c.id] = {at: Date.now(), books: [{book: "bk-1", company: G, from: null}]};
  TCloud.status = async () => TCloud.st[c.id].books; TCloud.restAll = async () => []; Cloud.api = async () => [];
  TCloud.rpc = async (fn, args) => {
    T.rpc.push({fn, args: JSON.parse(JSON.stringify(args || {}))});
    if (fn === "tally_post_record" && T.rpcMode === "missing") throw new Error("Could not find the function public.tally_post_record(p_client, p_company, p_entry_ids, p_id, p_message, p_results, p_status) in the schema cache (PGRST202)");
    return {ok: true};
  };
  if (typeof CloudJobs === "object"){ CloudJobs.load = async () => null; }
  render();
  return c.id;
}"""

with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    E = pg.evaluate
    cid = E(SETUP); pg.wait_for_timeout(600)
    rows = lambda: E("B().rows.map(r => ({id: r.id, st: r.state, err: r.postError || '', rev: !!r.postReview, rel: !!r.release, num: (r.tally && (r.tally.number || r.tally.vchNumber)) || '', mid: (r.tally && r.tally.masterId) || '', g: (r.tally && r.tally.vchGuess) || ''}))")
    rep = lambda: E("(() => { const r = B().postReport || {}; return {posted: r.posted || 0, failed: (r.failed || []).map(f => f.msg), review: r.review || 0, unrecorded: r.unrecorded || '', already: r.already || 0}; })()")
    # the stand's Tally refuses 42 of the first 50 (makes 8) and 4 of the next 20 (makes 16)
    GOOD1 = {0, 7, 14, 21, 28, 35, 42, 49}; BAD2 = {52, 57, 61, 66}
    REFUSE = [i for i in range(50) if i not in GOOD1] + sorted(BAD2)
    E("(ids) => { window.__T.refuse = new Set(ids); }", ["s1-%d" % i for i in REFUSE])
    IN_TALLY = sorted(GOOD1 | (set(range(50, 70)) - BAD2))
    ok(len(IN_TALLY) == 24 and len(REFUSE) == 46, "fixture: Tally will make 24 of the 70 lines (8 of 50, 16 of 20) and refuse 46")

    # (1) first Post
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    R = rows(); rp = rep(); n_imp = len(E("window.__T.imports"))
    ok(n_imp == 2 and [len(x) for x in E("window.__T.imports")] == [50, 20], "(1) two requests went to Tally, of 50 and 20 (%s)" % [len(x) for x in E("window.__T.imports")])
    ok(all(r["st"] == "ready" and not r["g"] for r in R), "(1) no line is marked posted on a guess (Tally did not say which it made)")
    ok(len(rp["failed"]) == 70, "(1) the report lists all 70 lines (%d)" % len(rp["failed"]))
    ok(all(("Tally made 8 of the 50 lines sent together" in r["err"] or "Tally made 16 of the 20 lines sent together" in r["err"]) and "already exists" in r["err"] for r in R),
       "(1) each line carries Tally's counts and words (%s)" % R[0]["err"][:160])
    ok(rp["review"] == 70 and pg.locator("#app [data-check-review]").count() == 1, "(1) and the report offers Check with Tally (%s)" % rp["review"])

    # (2) the record in FinCom's cloud
    recs = [x for x in E("window.__T.rpc") if x["fn"] == "tally_post_record"]
    ok(len(recs) == 1 and len(recs[0]["args"]["p_results"]) == 70, "(2) FinCom asked its cloud to record the posting with 70 answers (%d calls)" % len(recs))
    ok("tally_post_record" in rp["unrecorded"] and pg.locator("#app [data-post-unrecorded]").count() == 1, "(2) the cloud without tally_post_record: the report says it was not recorded (%s)" % rp["unrecorded"][:120])

    # (3) the Post page's Errors tab
    er = E("(cid) => { const t = postTabRows(cid, 'errors'); return t.shown.filter(x => x.kind === 'bank').map(x => ({id: x.id, code: x.st.code, todo: x.st.todo})); }", cid)
    ok(len(er) == 70 and all(x["code"] == 6 and "Tally said:" in x["todo"] for x in er), "(3) the Post page's Errors tab lists the 70 bank lines with Tally's words (%d, %s)" % (len(er), er[0]["todo"][:80] if er else ""))

    # (4) Post again before any check: nothing is sent, Tally's words stay
    E("() => { B().postReport = null; window.__T.rpcMode = 'ok'; }")
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    R = rows(); rp = rep()
    ok(len(E("window.__T.imports")) == n_imp and len(E("window.__T.tally")) == 24, "(4) pressed again: nothing sent to Tally (%d requests, %d in Tally)" % (len(E("window.__T.imports")), len(E("window.__T.tally"))))
    ok(all("Tally said:" in r["err"] and "already sent from this computer" not in r["err"] for r in R), "(4) every line still says what Tally said, not only 'already sent from this computer' (%s)" % R[1]["err"][:120])
    recs2 = [x for x in E("window.__T.rpc") if x["fn"] == "tally_post_record"]
    ok(all(not any(r.get("alreadySent") for r in x["args"]["p_results"]) for x in recs2[1:]), "(2b) a press that sent nothing records no guard refusal as a posting (%d calls)" % len(recs2))

    # (4b) the owner's state today: lines ready with only the guard's words; the Bank page opened again settles the words
    E("""async () => { const b = B(), jid = Object.keys(window.__T.jobs)[0];
      b.rows.forEach(r => { const a = window.__T.rec[String(r.id).replace(/[^A-Za-z0-9]/g, '')]; r.postError = 'already sent from this computer on 29-10-2026 (Tally ids up to ' + a.end + ', sent in a batch of ' + a.n + '), job ' + a.job; delete r.postReview; delete r.postJob; });
      bankHealOpen.done = {}; await bankHealOpen(); }""")
    pg.wait_for_timeout(500)
    R = rows()
    ok(all(r["st"] == "ready" and r["rev"] and "Tally said:" in r["err"] for r in R), "(4b) the owner's state (guard's words only): opening the page brings back Tally's words from the job's record (%s)" % R[0]["err"][:100])

    # (5) Check with Tally: the ledger read for those days
    E("() => { B().postReport = {at: Date.now(), posted: 0, failed: [], review: 70, dismiss: 'bankReportOk'}; render(); }"); pg.wait_for_timeout(300)
    pg.click("#app [data-check-review]"); pg.wait_for_timeout(1200)
    R = rows(); byi = {r["id"]: r for r in R}
    found = [i for i in range(70) if byi["s1-%d" % i]["st"] == "sent"]
    ok(found == IN_TALLY, "(5) Check with Tally: the 24 lines Tally made are marked posted (%d: %s)" % (len(found), found[:10]))
    ok(all(byi["s1-%d" % i]["num"] and byi["s1-%d" % i]["mid"] for i in IN_TALLY), "(5) each with its own voucher (no. %s, Tally id %s)" % (byi["s1-0"]["num"], byi["s1-0"]["mid"]))
    ok(all(byi["s1-%d" % i]["st"] == "ready" and byi["s1-%d" % i]["rel"] and "Not in Tally" in byi["s1-%d" % i]["err"] and "already exists" in byi["s1-%d" % i]["err"] for i in REFUSE),
       "(5) the 46 not in Tally are said so, with what Tally had said, and released (%s)" % byi["s1-1"]["err"][:140])
    t = pg.inner_text("#app [data-review-check]")
    ok("24 in Tally, marked posted" in t and "46 not in Tally" in t, "(5) the page says it: %s" % t.replace("\n", " ")[:160])
    E("() => { window.__T.refuse = new Set(); }")
    pg.click("#app [data-review-post-missing]"); pg.wait_for_timeout(1500)
    R = rows(); imps = E("window.__T.imports")
    ok(len(imps) == n_imp + 1 and sorted(imps[-1]) == sorted("s1-%d" % i for i in REFUSE), "(5) Post sends exactly the 46 once more (%d in the request)" % len(imps[-1]))
    tags = [re.search(r"TDSDesk:([A-Za-z0-9]+)", v["narration"]).group(1) for v in E("window.__T.tally")]
    ok(all(r["st"] == "sent" for r in R) and len(tags) == 70 and len(set(tags)) == 70, "(5) all 70 lines posted, each once in Tally (%d vouchers, %d distinct)" % (len(tags), len(set(tags))))

    # (6) a read that does not hold the days: not checked, nothing marked; posted again with the bridge looking first
    E("(ids) => { const b = B(); b.rows = window.__mkRows(30, 's2-', 3); b.cur = 's1'; b.postReport = null; b.reviewCheck = null; window.__T.refuse = new Set(ids); window.__T.batch = 50; window.__T.covered = false; }",
      ["s2-%d" % i for i in range(30) if i % 3])
    E("() => postBankToTally()"); pg.wait_for_timeout(1500)
    n_t = len(E("window.__T.tally")); R = rows()
    ok(n_t == 80 and all(r["st"] == "ready" and r["rev"] for r in R), "(6) 30 more lines: Tally made 10, all 30 wait for a check (%d in Tally)" % n_t)
    E("() => bankCheckReview()"); pg.wait_for_timeout(800)
    t = pg.inner_text("#app [data-review-check]") if pg.locator("#app [data-review-check]").count() else ""
    ok("Not checked" in t and all(r["st"] == "ready" for r in rows()), "(6) the read does not hold those days: 'Not checked', nothing marked (%s)" % t.replace("\n", " ")[:110])
    E("() => { window.__T.refuse = new Set(); }")
    pg.click("#app [data-review-post-again]"); pg.wait_for_timeout(1500)
    R = rows(); tags = [re.search(r"TDSDesk:([A-Za-z0-9]+)", v["narration"]).group(1) for v in E("window.__T.tally")]
    ok(all(r["st"] == "sent" for r in R) and len(tags) == 100 and len(set(tags)) == 100, "(6) posted again: the 10 already there marked posted (Already in Tally), the 20 made; none twice (%d, %d distinct)" % (len(tags), len(set(tags))))
    br.close()
ok(not errors, "no page errors" + ("" if not errors else ": " + " | ".join(errors[:3])))
print("\n" + (str(len(fails)) + " FAILED" if fails else "all passed"))
raise SystemExit(1 if fails else 0)
