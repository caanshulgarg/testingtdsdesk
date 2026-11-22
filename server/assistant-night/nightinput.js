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
import { gstMonths, pickLedger, picksOf, LOOKBACK } from "../_shared/dailyjournals.js";

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

// the bank (as staging keeps it): records bank_stmt {id, acctId, acct, bank, from, to, ...}, bank_rows {rows: [...]} in
// parts, bank_meta {rules: learnt rules [{key, dir, ledger, auto, label, at}], hist: {rows: {fp: {k, p, t, l, d, dt, s, n}}}}.
// An account is the statement's acctId (several statements of one account are one account); its Tally ledger, last 4
// digits and name come from the client's bankAccounts [{id, ledger, last4, bank, acct, ifsc}], matched on that id.
// A finding's key is the statement and the line (review H1), so setting a ledger later changes nothing.
export function bankOf(recs, clientData) {
  const stmts = {}, parts = {}, meta = {}, accs = ((clientData || {}).bankAccounts || []).filter((a) => a && a.id != null);
  (recs || []).forEach((r) => {
    if (!r || r.deleted || !r.data) return;
    const sid = String(r.id).split(":")[1];
    if (r.kind === "bank_meta") Object.assign(meta, r.data);
    else if (r.kind === "bank_stmt") stmts[sid] = r.data;
    else if (r.kind === "bank_rows") (parts[sid] = parts[sid] || [])[+String(r.id).split(":")[2] || 0] = r.data.rows || [];
  });
  const accounts = {}, rows = [];
  Object.keys(stmts).sort().forEach((sid) => {
    const st = stmts[sid] || {}, acct = String(st.acctId || sid), ba = accs.find((a) => String(a.id) === String(st.acctId)) || {};
    if (!accounts[acct]) accounts[acct] = { id: acct, ledger: ba.ledger || "", name: ba.bank || st.bank || "Bank", last4: String(ba.last4 || String(ba.acct || st.acct || "").replace(/\D/g, "").slice(-4)) };
    const ps = parts[sid] || [];
    for (let p = 0; ps[p]; p++) ps[p].forEach((x) => { if (x && x.id != null) rows.push(Object.assign({}, x, { id: String(x.id), acct, sid, date: ymd(x.date), debit: r2(num(x.debit)), credit: r2(num(x.credit)), narr: String(x.narr || "") })); });
  });
  // what people chose before: the bank's own history (bank_meta.hist.rows), as the browser keeps it; else the lines a
  // person set (never an ignored one)
  const kept = meta.hist && meta.hist.rows && typeof meta.hist.rows === "object" ? Object.values(meta.hist.rows).filter((h) => h && h.k && h.l) : null;
  const history = kept && kept.length ? kept : rows.filter((x) => x.userSet && x.ledger && x.state !== "ignored" && x.dec && x.dec.key).map((x) => ({ k: x.dec.key, l: x.ledger, d: x.debit ? "out" : "in", s: "you", n: x.dec.name || "" }));
  return { bank: { accounts: Object.values(accounts), rows }, learned: Array.isArray(meta.rules) ? meta.rules.filter((r) => r && r.key && r.ledger) : [], history };
}

// the ledgers FinCom's entries use: the client's input GST ledgers and GST cash ledger, by FinCom's ledger list (kinds)
export function ledgersFor(b) {
  const map = b.map || {}, names = Object.keys(map), pick = (re, kind) => names.find((l) => re.test(l) && (!kind || (map[l] || {}).kind === kind)) || "";
  return { cgstIn: pick(/INPUT.*\bC\s*\.?\s*GST\b|\bC\s*\.?\s*GST\b.*INPUT/i), sgstIn: pick(/INPUT.*\bS\s*\.?\s*GST\b|\bS\s*\.?\s*GST\b.*INPUT/i), igstIn: pick(/INPUT.*\bI\s*\.?\s*GST\b|\bI\s*\.?\s*GST\b.*INPUT/i),
    gstCash: pick(/ELECTRONIC CASH|GST CASH/i), tds: pick(/TDS PAYABLE/i), salaryPayable: pick(/SALAR.*PAYABLE/i) };
}

// (phase 2) the months the set-off looks at: the app's own 3B for each, worked out with the app's globals in place
export function gstOf(rows, b, today) {
  const cur = String(today).slice(0, 6), months = [];
  for (let i = LOOKBACK; i >= 1; i--) { let y = +cur.slice(0, 4), m = +cur.slice(4, 6) - 1 - i; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; months.push(y + String(m + 1).padStart(2, "0")); }
  return withApp(rows, b, () => gstMonths({ GSTR: E.GSTR, GSTF: E.GSTF, GSTSet: E.GSTSet }, months));
}
// (phase 2) Daily Check's journals already approved: kept with the client's books as the existing posting path keeps a
// hand-made voucher (client_book_items "asstEntries", items "#dc-..."; app/src/lib/asstEntries.js)
export function draftsOf(recs) {
  return (recs || []).filter((r) => r && r.data && /^#?dc-/.test(String(r.item || r.data.id || ""))).map((r) => ({ dedupe: String(r.data.dedupe || ""), state: String(r.data.state || ""), removed: !!(r.deleted || r.data.removed) })).filter((d) => d.dedupe);
}

// x: {today, bankRecs, inboxRecs, entryRecs, twob, prior, firmRules, draftRecs}; rows.co is the client's settings (clients.data)
export function nightInput(rows, b, x) {
  const co = rows.co || {}, bk = bankOf(x.bankRecs, co);
  const closedTo = ymd((co.closed || {}).to);
  // FinCom's purchase bills only: a proforma, order, quotation, challan, receipt or statement read from the Inbox is not one
  const bills = (x.entryRecs || []).filter((r) => r && !r.deleted && r.data && r.data.x && !String(r.data.docKind || "").trim()).map((r) => Object.assign({}, r.data, { id: r.data.id || r.id }));
  const challans = (b.challans || []).map((c) => ({ ref: c.cin || ((c.bsr || "") + (c.serial || "")), kind: "tds", date: ymd(c.date), amt: r2(num(c.total) || (num(c.tax) + num(c.surcharge) + num(c.cess) + num(c.interest) + num(c.fee) + num(c.others))) })).filter((c) => c.date && c.amt);
  // the app's own sale and purchase tests (custom voucher types), worked out once with the app's globals in place
  const sales = new Set(), buys = new Set();
  withApp(rows, b, () => (b.vouchers || []).forEach((v) => { try { if (E.Books.isSale(v)) sales.add(v.id); else if (E.Books.isPurchase(v)) buys.add(v.id); } catch (e) { /* as the app: neither */ } }));
  // opening balances (tally_ledgers.open: Tally's sign, a debit negative)
  const open = {};
  (rows.ledgers || []).forEach((l) => { if (l && l.name && num(l.open)) open[l.name] = r2(num(l.open)); });
  const out = {
    today: x.today,
    books: { vouchers: b.vouchers || [], under: b.under || {}, groups: b.groups || {}, map: b.map || {}, gstin: Object.fromEntries(Object.entries(b.ledInfo || {}).map(([l, i]) => [l, (i && i.gstin) || ""])),
      pathOf: (l) => E.ledGroupPath(b, l), kindOf: (l) => ((b.map || {})[l] || {}).kind || "", isSale: (v) => sales.has(v.id), isPurchase: (v) => buys.has(v.id) },
    open, booksFrom: ymd(rows.book && rows.book.from_date),
    ledgers: (rows.ledgers || []).map((l) => l.name).filter(Boolean),
    bank: bk.bank, rules: Array.isArray(x.firmRules) ? x.firmRules : [], learned: bk.learned, history: bk.history, bills,
    inboxUnread: (x.inboxRecs || []).filter((r) => r && !r.deleted && r.data && r.data.status === "waiting").length,
    twob: x.twob || [], salary: b.salary || [], challans,
    closed: closedTo ? [{ from: "19000101", to: closedTo }] : [],
    // the last day the books hold an entry for: a month after it is the bridge being behind, not the client
    readTo: (b.vouchers || []).reduce((m, v) => (v.date > m ? v.date : m), ""),
    ledgersFor: ledgersFor(b), prior: x.prior || [],
    gst: x.gst || [], drafts: draftsOf(x.draftRecs), picks: picksOf(x.prior), picksOut: picksOf(x.prior, true),
    // (review M2) the bridge's reads: when each was made and the highest AlterID it had (tally_sync_reads)
    reads: (x.reads || []).map((r) => ({ at: String(r.at || ""), alt: Number(r.highest_alterid) || 0 })).filter((r) => r.at && r.alt),
  };
  // (phase 2) a salary line is paid against the salary payable ledger only when that ledger is certain
  out.ledgersFor.salaryPayable = pickLedger("salaryPayable", out).ledger || "";
  // (review H2) the client's salary ledger: its group says what else is salary
  out.ledgersFor.salaryExpense = pickLedger("salaryExpense", out).ledger || "";
  return out;
}
