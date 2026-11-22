// assistant-night: the night checks' input made from what FinCom holds in the cloud (next-assistant, phase 1). Plain
// JavaScript so Node tests it (tests/run_assistant_night.mjs) and Deno runs it.
//   booksOf(rows)            the client's books as the app holds them once opened from the cloud (gst-run's engine.books:
//                            the cloud copy's entries, masters and groups, and the client's work: salary, challans, 2B...)
//   twobOnly(b, rows)        2B documents the books do not have: the app's own 2B matching (GST2B.run's only2b), run for
//                            each of the client's GSTINs as the GST page runs it
//   nightInput(rows, b, x)   the input of server/_shared/nightchecks.js run(): x = {today, bankRecs (records bank_stmt,
//                            bank_rows, bank_meta), inboxRecs (records inbox), entryRecs (records entry: FinCom's bills),
//                            prior (night_findings of earlier nights)}
// What is mapped from where is listed in docs/ASSISTANT-PHASE1.md ("Data sources"); a source FinCom does not hold in the
// cloud (the firm's own bank rules, GST payments) is left out, and its self-answer simply finds nothing.
import * as E from "../_shared/gst3b.js";
import { books as engineBooks } from "../gst-run/engine.js";
import { ymd, num, r2 } from "../_shared/nightchecks.js";

const G = globalThis;
// the app's globals the engine reads (S, CO) for the length of one call, then put back
function withApp(rows, b, fn) {
  const was = { S: G.S, CO: G.CO };
  try {
    const co = Object.assign({}, rows.co || {}, { id: rows.client });
    G.S = { books: b, coId: rows.client, companies: { [rows.client]: co }, sales: { cid: rows.client, list: rows.sales || [] }, gstYm: "" };
    G.CO = (cid) => G.S.companies[cid || G.S.coId];
    return fn();
  } finally { G.S = was.S; G.CO = was.CO; }
}
export function booksOf(rows) {
  return withApp(rows, null, () => { const b = engineBooks(rows); G.S.books = b; return b; });
}
export function twobOnly(b, rows) {
  return withApp(rows, b, () => {
    const out = [], seen = new Set();
    let regs = [];
    try { regs = Array.from(new Set((E.GSTR.gstins(b) || []).map((g) => String(g).slice(0, 2)))); } catch (e) { regs = []; }
    for (const reg of regs) {
      let res = null;
      try { E.GST2B._memo = null; res = E.GST2B.run(reg); } catch (e) { res = null; }
      ((res && res.only2b) || []).forEach((p) => {
        if (!p || p.sec === "impg" || p.rej || p.dir === "out") return;
        const k = p.gstin + "|" + E.GST2B.normNo(p.no);
        if (seen.has(k)) return; seen.add(k);
        out.push({ gstin: p.gstin, party: p.party || p.name || p.gstin, no: p.no, date: ymd(p.date), taxable: r2(num(p.taxable)), igst: r2(num(p.igst)), cgst: r2(num(p.cgst)), sgst: r2(num(p.sgst)), cess: r2(num(p.cess)) });
      });
    }
    return out;
  });
}

// the bank: each statement an account (its Tally ledger where one is set), its rows from the parts kept in the cloud
export function bankOf(recs) {
  const stmts = {}, parts = {}, meta = {};
  (recs || []).forEach((r) => {
    if (!r || r.deleted || !r.data) return;
    const sid = String(r.id).split(":")[1];
    if (r.kind === "bank_meta") Object.assign(meta, r.data);
    else if (r.kind === "bank_stmt") stmts[sid] = r.data;
    else if (r.kind === "bank_rows") (parts[sid] = parts[sid] || [])[+String(r.id).split(":")[2] || 0] = r.data.rows || [];
  });
  const accounts = {}, rows = [];
  Object.keys(stmts).sort().forEach((sid) => {
    const st = stmts[sid] || {}, m = st.meta || {}, acct = String(st.ledger || m.acct || sid);
    if (!accounts[acct]) accounts[acct] = { id: acct, ledger: st.ledger || st.bankLedger || "", name: m.bank || st.ledger || "Bank", last4: String(m.acct || "").replace(/\D/g, "").slice(-4) };
    const ps = parts[sid] || [];
    for (let p = 0; ps[p]; p++) ps[p].forEach((x) => { if (x && x.id != null) rows.push(Object.assign({}, x, { id: String(x.id), acct, sid, date: ymd(x.date), debit: r2(num(x.debit)), credit: r2(num(x.credit)), narr: String(x.narr || "") })); });
  });
  // a line a PERSON set (userSet) teaches: the same name and amount again is "same as before"
  const history = rows.filter((x) => x.userSet && x.ledger && x.dec && x.dec.name).map((x) => ({ name: x.dec.name, amt: x.debit || x.credit, ledger: x.ledger }));
  return { bank: { accounts: Object.values(accounts), rows }, rules: Array.isArray(meta.rules) ? meta.rules : [], history };
}

// the ledgers FinCom's entries use: the client's input GST ledgers and GST cash ledger, by FinCom's ledger list (kinds)
export function ledgersFor(b) {
  const map = b.map || {}, names = Object.keys(map), pick = (re, kind) => names.find((l) => re.test(l) && (!kind || (map[l] || {}).kind === kind)) || "";
  return { cgstIn: pick(/INPUT.*\bC\s*\.?\s*GST\b|\bC\s*\.?\s*GST\b.*INPUT/i), sgstIn: pick(/INPUT.*\bS\s*\.?\s*GST\b|\bS\s*\.?\s*GST\b.*INPUT/i), igstIn: pick(/INPUT.*\bI\s*\.?\s*GST\b|\bI\s*\.?\s*GST\b.*INPUT/i),
    gstCash: pick(/ELECTRONIC CASH|GST CASH/i), tds: pick(/TDS PAYABLE/i), salaryPayable: pick(/SALAR.*PAYABLE/i) };
}

export function nightInput(rows, b, x) {
  const bk = bankOf(x.bankRecs), co = rows.co || {};
  const closedTo = ymd((co.closed || {}).to);
  const bills = (x.entryRecs || []).filter((r) => r && !r.deleted && r.data && r.data.x).map((r) => Object.assign({}, r.data, { id: r.data.id || r.id }));
  const challans = (b.challans || []).map((c) => ({ ref: c.cin || ((c.bsr || "") + (c.serial || "")), kind: "tds", date: ymd(c.date), amt: r2(num(c.total) || (num(c.tax) + num(c.surcharge) + num(c.cess) + num(c.interest) + num(c.fee) + num(c.others))) })).filter((c) => c.date && c.amt);
  return {
    today: x.today,
    books: { vouchers: b.vouchers || [], under: b.under || {}, groups: b.groups || {}, map: b.map || {}, gstin: Object.fromEntries(Object.entries(b.ledInfo || {}).map(([l, i]) => [l, (i && i.gstin) || ""])),
      pathOf: (l) => E.ledGroupPath(b, l), kindOf: (l) => ((b.map || {})[l] || {}).kind || "" },
    ledgers: (rows.ledgers || []).map((l) => l.name).filter(Boolean),
    bank: bk.bank, rules: bk.rules, history: bk.history, bills,
    inboxUnread: (x.inboxRecs || []).filter((r) => r && !r.deleted && r.data && r.data.status === "waiting").length,
    twob: x.twob || [], salary: b.salary || [], challans,
    closed: closedTo ? [{ from: "19000101", to: closedTo }] : [],
    // the last day the books hold an entry for: a month after it is the bridge being behind, not the client
    readTo: (b.vouchers || []).reduce((m, v) => (v.date > m ? v.date : m), ""),
    ledgersFor: ledgersFor(b), prior: x.prior || [],
  };
}
