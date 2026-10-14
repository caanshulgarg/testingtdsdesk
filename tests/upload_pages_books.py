"""Made-up books for the upload-and-review pages (Purchase, Bank, Sales), as the owner saw them on 14-Oct-2026:
Testing AAD with no bill to review, 3 entries Tally did not take (one gone from Tally, one with no answer, one refused),
12 bills in Tally, 2 duplicates and 3 deleted; then, on demand, bills to review (one not read), a bank statement and
sales invoices. Used by run_upload_pages.py and the screenshots of the pages (offline, nothing leaves the page).

Each is a JS function for page.evaluate; PURCHASE first (it opens the client), the others after it."""

# the stand of run_post_tabs.py (FinCom's cloud, its postings and the bridge faked), with the owner's counts
PURCHASE = """async () => {
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tallyName = "GARG SHEKHAR & COMPANY";
  S.firm.firmName = "ABC"; S.account = {firm: {balance: 499999912, plan: {name: "Firm"}}, me: {email: "owner@abc.in", role: "owner"}};
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  choiceConfirm(c, "tds:professional", "TDS Payable - Professional"); choiceConfirm(c, "postTo", "GARG SHEKHAR & COMPANY");
  const c2 = newCompany({name: "Other Client", gstin: "09AAAPZ1234A1Z5"}); S.companies[c2.id] = c2; S.data[c2.id] = {parties: {}, entries: {}, loaded: true}; c2.stats = {};
  window.__c2 = c2.id;
  const t = (m) => new Date(Date.now() - m * 60000).toISOString();
  window.__t = t;
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-1", name: "Anshul"}];
  TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk1", company: "GARG SHEKHAR & COMPANY", daysAt: new Date().toISOString(), state: {doneTo: "20261001", skipped: []}}]};
  const G = "GARG SHEKHAR & COMPANY";
  // the postings in FinCom's cloud:
  //   jC done (old2 in Tally): Posted; jD failed, nothing of it here: Errors (Retry, Dismiss);
  //   jU still running, u1 sent when Tally stopped answering (state unknown): Errors, "Checking whether it reached Tally";
  //   jX done, x1 refused by Tally (item failed): Errors
  window.__jobs = [
    {id: "jC", client_id: c.id, company: G, status: "done", done: 1, n: 1, message: "1 of 1 sent to Tally", created_at: t(300), updated_at: t(299), entry_ids: ["old2"], results: [{id: "old2", ok: true, verified: true}], items: [{id: "old2", state: "in_tally"}]},
    {id: "jU", client_id: c.id, company: G, status: "running", done: 0, n: 1, message: "Checking whether it reached Tally", created_at: t(6), updated_at: t(5), entry_ids: ["u1"],
      results: [{id: "u1", ok: false, outcomeUnknown: true, state: "unknown", message: "Checking whether it reached Tally"}], items: [{id: "u1", state: "unknown", reason: "Checking whether it reached Tally", outcomeUnknown: true}]},
    {id: "jX", client_id: c.id, company: G, status: "done", done: 0, n: 1, message: "0 of 1 sent to Tally", created_at: t(30), updated_at: t(29), entry_ids: ["x1"],
      results: [{id: "x1", ok: false, message: "Voucher date is outside the period of the company"}], items: [{id: "x1", state: "failed", reason: "Voucher date is outside the period of the company"}]}];
  // tally_post_ids (migration-32; released_at from migration-37): the FinCom ids the cloud holds for the client's postings.
  // jD's old3 and jX's x1 were released (the job failed / the bridge said not in Tally); a row with live=true is still held
  window.__postIds = [{job_id: "jX", fincom_id: "x1", entry_id: "x1", live: false, released_at: t(28), released_why: "refused: Voucher date is outside the period of the company"}];
  window.__postIdsFail = "";
  TCloud.restAll = async (u) => { if (/^tally_post_ids/.test(u)){ if (window.__postIdsFail) throw new Error(window.__postIdsFail); window.__idsAsked = (window.__idsAsked || []).concat([u]); return JSON.parse(JSON.stringify(window.__postIds)); }
    return /tally_post_jobs/.test(u) ? JSON.parse(JSON.stringify(window.__jobs)) : []; };
  window.__rpc = [];
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); if (fn === "tally_status") return TCloud.st[a.p_client] ? TCloud.st[a.p_client].books : [];
    return /^tally_(want_update|post_enqueue|post_dismiss|post_undismiss|post_record)$/.test(fn) ? {ok: true} : null; };
  Cloud.api = async () => [];
  CloudJobs.list = null; CloudJobs.at = 0; CloudJobs.tried = {};
  window.__dev = {id: "d-1", name: "NWS144", revoked: false, last_seen: new Date().toISOString(), info: {computer: "NWS144", beat: {at: new Date().toISOString(), every: 30, tally: true, tallyState: "open",
    paused: false, notAnsweringSince: "", updating: false, lastRead: t(10), open: [G], companies: [{name: G, open: true, at: t(10), lastRead: t(10)}]}}};
  TLight.refresh = function(){ return Promise.resolve(); };
  TLight.st = {at: Date.now(), busy: false, by: {}, devs: [window.__dev], cos: [{company: G, client_id: c.id, device_id: "d-1"}]};
  PostCheck.due = () => false;
  await openCompany(c.id);
  const mk = (id, n, no, amt, extra) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; S.data[c.id].entries[e.id] = e; approve(e); Object.assign(e, extra || {}); return e; };
  // approved a while ago (before the postings of the cloud that name them)
  const old = {approvedAt: t(400)};
  mk("u1", "Unknown Outcome Co", "U/1", 5000, old); mk("x1", "Refused Co", "X/1", 7000, old);
  // FA/ELEC/013: posted, then not found in the cloud copy: needs attention
  mk("fa", "FINGATE ADVISORY", "FA/ELEC/013", 25535, {approvedAt: t(400), exportedAt: "2026-09-29T03:58:55Z", postVerified: true, postedVia: "bridge", goneFromTally: "2026-10-02T10:04:00Z",
    tally: {at: "2026-09-29T03:58:55Z", guid: "g-66b4", vchDate: "20260701", vchType: "Journal", company: G}});
  // in Tally already: on no tab
  for (let i = 1; i <= 11; i++) mk("in" + i, ["Kashi IT Solutions", "Alpha Consultants", "Delta Legal LLP"][i % 3], "IN/" + i, 10000 + i * 1250,
    {approvedAt: t(900), exportedAt: "2026-09-" + String(10 + i).padStart(2, "0") + "T03:00:00Z", postVerified: true, postedVia: "bridge", tally: {at: "2026-09-20T03:00:00Z", guid: "g-in" + i, vchDate: "20260701"}});
  const raw = (id, n, no, amt, extra) => { const e = newEntry(n + ".pdf"); e.id = id; Object.assign(e.x, {vendorName: n, invoiceNo: no, invoiceDate: "2026-08-04", taxable: amt, total: amt}); Object.assign(e, extra); S.data[c.id].entries[id] = e; return e; };
  raw("d1", "Kashi IT Solutions", "IN/2", 12500, {status: "duplicate", dupOf: {entryId: "in2", msg: "Duplicate of Kashi IT Solutions IN/2"}});
  raw("d2", "Alpha Consultants", "IN/4", 15000, {status: "duplicate", dupOf: {entryId: "in4", msg: "Duplicate of Alpha Consultants IN/4"}});
  for (let i = 1; i <= 3; i++) raw("del" + i, "Old Vendor " + i, "OV/" + i, 3000 * i, {status: "deleted", deleted: {at: t(2000 + i), by: "Anshul", reason: "uploaded by mistake"}});
  TallyProof.at[c.id] = Date.now(); TallyProof.check = async () => 0;
  refreshStats(c.id); goStep("post", "bills");
  await new Promise(r => setTimeout(r, 500));
  S.bank.loading = false;
  window.autoPostTo = async () => {};
  await CloudJobs.load(true);
  goStep("review", "bills");
  render();
  return c.id;
}"""

# bills to review: four read (one with no TDS ledger chosen yet), one the reading service could not read
DRAFTS = """() => {
  const cid = S.coId, d = S.data[cid];
  const mk = (id, n, no, amt, extra) => { const e = newEntry(n + ".pdf"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-10-0" + (1 + Object.keys(d.entries).length % 8), taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; Object.assign(e, extra || {}); d.entries[id] = e; return e; };
  mk("v1", "Kashi IT Solutions", "K/101", 48000); mk("v2", "Alpha Consultants", "A/77", 125000); mk("v3", "Delta Legal LLP", "DL/9", 36500); mk("v4", "Mehta & Co", "M/12", 18250);
  const nr = mk("v5", "", "", 0); nr.fileName = "scan-0042.jpg"; nr.notRead = {reason: "the photo is too dark to read", at: new Date().toISOString()};
  refreshStats(cid); goStep("review", "bills"); render();
}"""

# an upload going on: 5 files, 2 read, 1 being read, 1 waiting and 1 the reader could not read
UPLOADING = """() => {
  const cid = S.coId, f = (n) => ({name: n});
  const j = (n, st, extra) => Object.assign({id: uid("j"), file: f(n), name: n, target: cid, cid, status: st, msg: ""}, extra || {});
  S.jobs = [j("bill-1.pdf", "done", {entryId: "v1"}), j("bill-2.pdf", "done", {entryId: "v2"}), j("bill-3.pdf", "reading", {startedAt: Date.now()}), j("bill-4.pdf", "waiting"),
    j("bill-5.jpg", "failed", {msg: "The file could not be opened: it is not a PDF or a photo."})];
  render();
}"""

BANK = """async () => {
  const cid = S.coId, c = CO();
  c.bankAccounts = [{id: "a1", bank: "ICICI", acct: "0214", ledger: "ICICI Bank"}];
  const parties = ["DIPTI VATS", "PAYUAMAZON", "BHARATKOSH", "PERFEKT SENSE DIGITA", "CLOUD WIZARD CONSULTING", "AMAZON GROCERIES", "CCAPROTEAN", "NAVNEET TENDER DSC"];
  const states = ["ready","ready","ready","attention","suggested","sent","intally","ready"];
  let bal = 250000;
  const rows = Array.from({length: 24}, (_, i) => { const out = i % 3 !== 1; const amt = [2000, 28788, 2970, 1000, 100000, 5.9, 16200, 1482][i % 8] * (1 + (i % 5) / 10);
    bal += out ? -amt : amt;
    return {id: "r" + i, fp: "fp" + i, date: "2026-04-" + String(1 + i).padStart(2, "0"), debit: out ? r2(amt) : 0, credit: out ? 0 : r2(amt), bal: r2(bal),
      narr: (out ? "NEFT DR " : "NEFT CR ") + parties[i % 8] + " UTR" + (100000 + i), dec: {name: parties[i % 8], mode: "NEFT", utr: "UTR" + (100000 + i)},
      ledger: states[i % 8] === "attention" ? "" : parties[i % 8], state: states[i % 8], tally: states[i % 8] === "sent" ? {guid: "g" + i} : undefined, balOk: true, why: states[i % 8] === "attention" ? ["No ledger found for this party."] : []}; });
  S.bank = {cid, loading: false, stmts: [{id: "s1", acctId: "a1", bank: "ICICI", acct: "0214", from: "2026-04-01", to: "2026-04-24", opening: 250000, closing: bal, totDr: 0, totCr: 0}], cur: "s1", rows, rules: [], wrules: [],
    ledgers: {list: parties.map(p => ({name: p, group: "Sundry Creditors"})).concat([{name: "ICICI Bank", group: "Bank Accounts"}]), importedAt: new Date().toISOString(), live: true}, newLed: [], keys: {}, books: {}, filter: "review", grouped: false, showSettings: false, q: "", limit: 100, pendingRule: null, busy: "",
    createFor: null, sel: new Set(), sticky: new Set(), undo: null, hist: {rows: {}}, histVer: 0, postedTags: {}, salesRef: [], stmtsTrash: []};
  choiceConfirm(c, "bank:a1", "ICICI Bank");
  S.tab = "bank"; S.step = null; render();
}"""

BANK_EMPTY = """() => { const b = B(); b.stmts = []; b.cur = null; b.rows = []; render(); }"""

SALES = """async () => {
  const cid = S.coId;
  S.tab = "sales"; S.step = null;
  await loadSales(cid);
  const mk = (i, cust, total, status, led) => ({id: "sv" + i, source: i % 2 ? "upload" : "created", fileName: "inv-" + i + ".pdf", status, customerLedger: led || "",
    x: {number: "INV/26-27/" + String(i).padStart(3, "0"), date: "2026-09-" + String(i + 1).padStart(2, "0"), customerName: cust, customerGstin: "", pos: "09", taxable: r2(total / 1.18), cgst: r2(total * 0.09 / 1.18), sgst: r2(total * 0.09 / 1.18), igst: 0, total}});
  SL().list = [mk(1, "Alpha Retail LLP", 11800, "review", "Alpha Retail LLP"), mk(2, "Beta Stores", 23600, "review"), mk(3, "Gamma Mart", 5900, "ready", "Gamma Mart"),
    mk(4, "Alpha Retail LLP", 47200, "ready", "Alpha Retail LLP"), mk(5, "Beta Stores", 35400, "posted", "Beta Stores"), mk(6, "Gamma Mart", 8260, "intally", "Gamma Mart"), mk(7, "Old Customer", 1180, "ignored", "")];
  SL().filter = "review"; render();
}"""

SALES_EMPTY = """() => { SL().list = []; render(); }"""

# two bills approved and not yet posted: Ready to post
READY = """() => {
  const cid = S.coId, d = S.data[cid];
  const mk = (id, n, no, amt) => { const e = newEntry("Manual entry"); e.id = id; Object.assign(e.x, {vendorName: n, vendorGstin: "", invoiceNo: no, invoiceDate: "2026-07-01", taxable: amt, total: amt});
    e.natureId = "professional"; e.partyLedger = n; e.expenseLedger = "Professional Charges"; d.entries[id] = e; approve(e); return e; };
  mk("r1", "Alpha Consultants", "A/1", 100000); mk("r2", "Kashi IT Solutions", "K/7", 20000);
  refreshStats(cid); render();
}"""
