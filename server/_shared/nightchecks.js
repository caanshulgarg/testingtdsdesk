// Daily Check's night checks (next-assistant, phase 1; docs/ASSISTANT-PHASE1.md). Plain JavaScript with no globals, so the
// assistant-night function (Deno) and the tests (Node) run the same file. No AI: every rule is fixed.
//
//   run(inp)            -> {findings, entries}: the checks, then FinCom's own answer for each, then the entries it can make
//   checks(inp)         the raw findings (a) to (e), each {kind, key, facts}; key is stable from night to night
//   answer(raw, inp)    each finding's state: "resolved" (exactly one certain match: acceptance rule 1), "you" (two that
//                       fit, a near miss, or the firm decides) or "ask" (nothing fits); with its evidence or candidates
//   entriesFor(f, inp)  the entries FinCom prepares (an Inbox bill for a 2B gap, a bank line it answered), each checked
//   checkEntry(e, inp)  Dr = Cr, ledgers in Tally, not in a closed period, no duplicate, GST adds up (acceptance rule 2)
//   askText(f)          the plain question to the client (fixed words a kind)
//
// Ported from the browser (src/js/06-audit.js: the group tests, cash40A3, odd's round sums and journals without narration,
// the suspense part of balances; src/js/22-written-rules.js ruleHits; src/js/21 ledgerKey; GST2B.normNo): the same rules,
// taking the books as an argument. tests/run_nightchecks_diff.js runs both on the same made-up books and compares.
//
// The input (assistant-night/data.ts makes it from the cloud copy; the tests make it by hand):
//   today      "YYYYMMDD", the night's date (India)
//   books      {vouchers: [{id, date, type, no, ref, party, narr, ent: [{l, a}]}] (Tally's sign: a debit is negative),
//               under: {ledger: group}, groups: {group: parent}, map: {ledger: {kind}}, gstin: {ledger: GSTIN}}
//   ledgers    every ledger name in the client's Tally (the cloud copy)
//   bank       {accounts: [{id, ledger}], rows: [{id, acct, date, narr, debit, credit, ledger, state, dec: {name, mode}}]}
//   rules      written bank rules (the client's, then the firm's), as src/js/22 keeps them
//   bills      FinCom's own bill entries (records kind "entry"): {id, status, partyLedger, expenseLedger, x: {vendorName,
//               vendorGstin, invoiceNo, invoiceDate, taxable, cgst, sgst, igst, total}}
//   inboxUnread  the number of Inbox files for the client not read yet
//   twob       2B documents the books do not have (GST2B.run's only2b): {gstin, party, no, date, taxable, igst, cgst, sgst, cess}
//   salary     the salary sheet's rows {name, date, month, gross, tds, net}
//   challans   {ref, kind: "gst"|"tds", date, amt}
//   history    bank lines a PERSON set before: {name, amt, ledger}
//   closed     [{from, to}] closed periods; readTo: the last day the books are read up to
//   ledgersFor {gstCash, cgstIn, sgstIn, igstIn}
//   prior      what earlier nights found: [{kind, key, state, evidence, undone}]

export const LIMITS = { advanceDays: 60, cash: 10000, cashTransport: 35000, round: 50000, narr: 100000, jumpX: 3, jumpMin: 50000, wrongSide: 1000, suspenseDays: 30, near: 0.02 };
const TOL = 1;   // amounts within ₹1 (acceptance rule 1)

export const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
export const num = (x) => { const n = typeof x === "number" ? x : parseFloat(String(x == null ? "" : x).replace(/[,₹\s]/g, "")); return isFinite(n) ? n : 0; };
export function ymd(s) {
  s = String(s == null ? "" : s).trim();
  if (/^\d{8}$/.test(s)) return s;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + m[2] + m[3];
  m = s.match(/^(\d{2})[-/.](\d{2})[-/.](\d{4})$/); if (m) return m[3] + m[2] + m[1];
  return "";
}
const ms = (d) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8));
export const daysBetween = (a, c) => Math.round((ms(c) - ms(a)) / 86400000);
const addDays = (d, n) => { const t = new Date(ms(d) + n * 86400000); return t.getUTCFullYear() + String(t.getUTCMonth() + 1).padStart(2, "0") + String(t.getUTCDate()).padStart(2, "0"); };
const ymOf = (d) => String(d).slice(0, 6);
const ymAdd = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(4, 6) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + String(m + 1).padStart(2, "0"); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const dmon = (d) => d && d.length >= 8 ? d.slice(6, 8) + "-" + MON[+d.slice(4, 6) - 1] : "";
export const monYear = (ym) => MON[+ym.slice(4, 6) - 1] + " " + ym.slice(0, 4);
export const monShort = (ym) => MON[+ym.slice(4, 6) - 1];
export function inr(v) {
  const n = Math.abs(r2(v)), [i, f] = n.toFixed(2).split("."), last = i.slice(-3), rest = i.slice(0, -3);
  return (v < 0 ? "-" : "") + "₹" + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last + (f === "00" ? "" : "." + f);
}
const P2 = (x) => Math.round((Number(x) || 0) * 100);
const near = (a, c) => Math.abs(r2(a) - r2(c)) <= TOL;
const closeish = (a, c) => { const d = Math.abs(r2(a) - r2(c)); return d > TOL && d <= Math.max(TOL, Math.abs(c) * LIMITS.near); };

// src/js/21-repairing-a-statement.js ledgerKey, and GST2B.normNo (server/_shared/gst3b.js)
export const ledgerKey = (s) => String(s || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
export const normNo = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
// a party named in a bank line (review H2): "exact" only when the line's decoded name IS the party's (by ledgerKey);
// the party's name somewhere in the narration ("RAMESHWAR ENTERPRISES" holds "Ramesh") is only "near": Needs you, never
// resolved
export function names(row, party) {
  const k = ledgerKey(party);
  if (!k) return "";
  if (row.dec && row.dec.name && ledgerKey(row.dec.name) === k) return "exact";
  return k.length >= 4 && ledgerKey(row.narr).includes(k) ? "near" : "";
}

// ---------------------------------------------------------------- the group tests (src/js/06-audit.js Audit.is*)
export function groupsOf(books) {
  const under = books.under || {}, groups = books.groups || {}, map = books.map || {}, memo = new Map();
  // books.pathOf / kindOf: the browser's own (ledGroupPath, Books.ledgerOf) where the caller has them (assistant-night does)
  const path = (l) => {
    if (memo.has(l)) return memo.get(l);
    if (books.pathOf) { const p = books.pathOf(l) || []; memo.set(l, p); return p; }
    const out = []; let g = under[l], n = 0;
    while (g && n++ < 30) { out.push(g); g = groups[g]; }
    memo.set(l, out); return out;
  };
  const under_ = (l, re) => path(l).some((g) => re.test(g));
  const kind = books.kindOf ? (l) => books.kindOf(l) || "" : (l) => (map[l] || {}).kind || "";
  const A = {
    path, under: under_,
    isCash: (l) => under_(l, /^cash-in-hand$/i) || (!path(l).length && kind(l) === "bank" && /\bCASH\b/i.test(l)),
    isBankL: (l) => under_(l, /^bank (accounts|od a\/c|occ a\/c)$/i) || (kind(l) === "bank" && !A.isCash(l)),
    isLoan: (l) => under_(l, /^(loans \(liability\)|secured loans|unsecured loans)$/i) || (!path(l).length && /\bLOAN\b/i.test(l)),
    isCapital: (l) => under_(l, /^capital account$/i),
    isDuties: (l) => under_(l, /^duties & taxes$/i) || (!!kind(l) && kind(l) !== "bank" && kind(l) !== "roundoff"),
    isCreditor: (l) => under_(l, /^sundry creditors$/i),
    isDebtor: (l) => under_(l, /^sundry debtors$/i),
    isExpense: (l) => under_(l, /^(indirect expenses|direct expenses)$/i) || (!path(l).length && !kind(l) && /EXP|CHARGES|RENT|SALARY|WAGES|FEES|REPAIR|FREIGHT|CARTAGE|TRAVEL|CONVEYANCE|COMMISSION|ADVERT/i.test(l)),
    isIncome: (l) => under_(l, /^(sales accounts|direct incomes|indirect incomes)$/i),
    isSuspense: (l) => under_(l, /^suspense a\/c$/i) || /SUSPENSE/i.test(l),
  };
  return A;
}
const isSaleRe = (v) => /SALES?\b|CREDIT NOTE/i.test(v.type) && !/PURCHASE/i.test(v.type);
const isPurchaseRe = (v) => /PURCHASE|DEBIT NOTE/i.test(v.type);
// books.isSale / isPurchase: the app's own (Books.isSale, by type and by content) where the caller has them; set at each
// entry point (one call at a time: no await inside)
let isSale = isSaleRe, isPurchase = isPurchaseRe;
const use = (books) => { isSale = (books && books.isSale) || isSaleRe; isPurchase = (books && books.isPurchase) || isPurchaseRe; };
const live = (books) => (books.vouchers || []).filter((v) => v && v.date && !v.opt && !v.cancel);

// ---------------------------------------------------------------- the ported checks (the browser's rows, for the test)
// 06-audit.js checkSteps.cash40A3: cash paid to one party in a day (in one voucher where the ledger is an expense)
export function cashRows(A, V, o = {}) {
  const lim = o.cash || LIMITS.cash, limT = o.cashTransport || LIMITS.cashTransport, byDay = {};
  V.forEach((v) => {
    if (/CONTRA/i.test(v.type)) return;
    const paid = v.ent.filter((e) => A.isCash(e.l) && e.a > 0).reduce((s, e) => s + e.a, 0);
    if (!paid) return;
    v.ent.filter((e) => e.a < 0 && !A.isCash(e.l) && !A.isBankL(e.l) && !A.isLoan(e.l) && !A.isCapital(e.l) && !A.isDuties(e.l) && !A.isDebtor(e.l) && !/IMPREST|ADVANCE|SECURITY DEPOSIT/i.test(e.l)).forEach((e) => {
      const k = v.date + "|" + e.l + (A.isExpense(e.l) ? "|" + v.id : ""), x = byDay[k] = byDay[k] || { date: v.date, l: e.l, amt: 0, vs: [] };
      x.amt = r2(x.amt + Math.min(-e.a, paid)); x.vs.push(v);
    });
  });
  return Object.values(byDay).filter((x) => x.amt > (/TRANSPORT|ROADWAYS|LOGISTIC|CARRIER|GOODS CARRIAGE|TRUCK/i.test(x.l) ? limT : lim));
}
// 06-audit.js checkSteps.odd: round-sum journals to income or expense, and journals with no narration
export function roundRows(A, V, o = {}) {
  const min = o.round || LIMITS.round;
  return V.filter((v) => /JOURNAL/i.test(v.type)).map((v) => ({ v, amt: v.ent.filter((e) => e.a > 0).reduce((s, e) => s + e.a, 0) }))
    .filter((x) => x.amt >= min && x.amt % 10000 === 0 && x.v.ent.some((e) => A.isExpense(e.l) || A.isIncome(e.l)));
}
export function bareRows(A, V, o = {}) {
  const min = o.narr || LIMITS.narr, types = o.narrTypes || /JOURNAL|PAYMENT|RECEIPT/i;
  return V.filter((v) => types.test(v.type)).map((v) => ({ v, amt: v.ent.filter((e) => e.a > 0).reduce((s, e) => s + e.a, 0) }))
    .filter((x) => x.amt >= min && !String(x.v.narr || "").trim());
}
// balances on a day: the sum of every entry up to it (the cloud copy's books start at their first day), credit positive
export function balancesAt(V, d, open) {
  const bal = Object.assign({}, open || {});
  V.forEach((v) => { if (v.date <= d) v.ent.forEach((e) => { bal[e.l] = r2((bal[e.l] || 0) + e.a); }); });
  return bal;
}
// 22-written-rules.js ruleHits (decoded name compared by ledgerKey here: normName is the browser's)
export function ruleHits(rule, row, acc) {
  if (!rule || rule.off) return false;
  const w = rule.when || {}, hay = (String(row.narr || "") + " " + (row.ref || "")).toLowerCase(), dec = row.dec || {};
  for (const c of (w.text || [])) {
    const v = String(c.v || "").toLowerCase().trim();
    if (!v) continue;
    const has = hay.includes(v);
    if (c.op === "has" && !has) return false;
    if (c.op === "not" && has) return false;
    if (c.op === "starts" && !hay.trim().startsWith(v)) return false;
    if (c.op === "is" && ledgerKey(dec.name || "") !== ledgerKey(v) && hay.trim() !== v) return false;
  }
  if (w.dir === "out" && !row.debit) return false;
  if (w.dir === "in" && !row.credit) return false;
  const amt = row.debit || row.credit;
  if (w.amtMin !== "" && w.amtMin != null && amt < num(w.amtMin)) return false;
  if (w.amtMax !== "" && w.amtMax != null && amt > num(w.amtMax)) return false;
  if ((w.modes || []).length && !w.modes.includes(dec.mode || "")) return false;
  if (w.acNo) {
    const want = String(w.acNo).replace(/\D/g, "");
    const got = (String(row.narr || "").match(/\d{6,18}/g) || []).map((x) => x.replace(/^0+/, ""));
    if (want && !got.some((g) => g.endsWith(want.replace(/^0+/, "")) || want.endsWith(g))) return false;
  }
  if (w.account && w.account !== "any" && acc && acc.id !== w.account) return false;
  if (w.from && row.date < w.from) return false;
  if (w.to && row.date > w.to) return false;
  return (w.text || []).some((c) => String(c.v || "").trim() && c.op !== "not") || !!w.acNo || (w.modes || []).length > 0 || (w.amtMin !== "" && w.amtMin != null) || (w.amtMax !== "" && w.amtMax != null);
}

// each sale or purchase entry's amount still open after the party's receipts and payments in the books, first in first
// out (as MIS ageing does for a party not kept bill-wise); kept per list of entries
const OPEN = new WeakMap();
let OPEN_BAL = {};
export function openLeft(A, V, open) {
  if (open) OPEN_BAL = open;
  if (OPEN.has(V)) return OPEN.get(V);
  const by = {}, left = new Map();
  V.forEach((v) => v.ent.forEach((e) => { if (A.isCreditor(e.l) || A.isDebtor(e.l)) (by[e.l] = by[e.l] || []).push({ v, a: e.a }); }));
  Object.keys(by).forEach((party) => {
    const cred = A.isCreditor(party), bills = [];
    // the opening balance first: an advance carried in is credit for the next bills; last year's bills are paid first
    const o0 = r2(cred ? num((OPEN_BAL || {})[party]) : -num((OPEN_BAL || {})[party]));
    let credit = o0 < 0 ? -o0 : 0;
    if (o0 > 0) bills.push({ v: { id: "open" }, left: o0 });
    by[party].sort((x, c) => x.v.date.localeCompare(c.v.date) || String(x.v.id).localeCompare(String(c.v.id))).forEach(({ v, a }) => {
      let amt = r2(cred ? a : -a);
      if (amt > 0) { const t = Math.min(credit, amt); credit = r2(credit - t); const x = { v, left: r2(amt - t) }; bills.push(x); left.set(v.id, x.left); }
      else if (amt < 0) { let p = -amt; for (const x of bills) { if (p <= 0) break; const t = Math.min(x.left, p); x.left = r2(x.left - t); p = r2(p - t); left.set(x.v.id, x.left); } if (p > 0) credit = r2(credit + p); }
    });
  });
  OPEN.set(V, left);
  return left;
}

// ---------------------------------------------------------------- the checks (a) to (e)
const F = (kind, key, facts) => ({ kind, key, facts });

// (a) advances open after 60 days: a party's bills and payments taken first in, first out, from its opening balance.
// Staging, 22-Nov-2026 (one client, 81 findings, nearly all noise): only a PAYMENT (or receipt) through bank or cash makes
// an advance; a journal or debit note that takes a party past its bills (a TDS deduction, a write-off, a set-off) is no
// advance and is never asked. One finding per party: what it paid (or received) beyond its bills more than 60 days ago,
// with the oldest date. A party with no entries in the books' year (only an opening balance) and a ledger that takes far
// more receipts than sales (a payment gateway, a settlement ledger) are for the firm to look at, not questions.
function advances(inp, A, V, out) {
  const by = {}, viaBank = (v) => v.ent.some((e) => A.isBankL(e.l) || A.isCash(e.l));
  V.forEach((v) => v.ent.forEach((e) => { if (A.isCreditor(e.l) || A.isDebtor(e.l)) (by[e.l] = by[e.l] || []).push({ v, a: e.a }); }));
  const open = {}, spareOf = {}, ob = inp.open || {}, from = inp.booksFrom || (V[0] && V[0].date) || inp.today, moved = new Set(Object.keys(by));
  Object.keys(ob).forEach((l) => { if ((A.isCreditor(l) || A.isDebtor(l)) && !by[l] && Math.abs(num(ob[l])) >= 0.01) by[l] = []; });
  Object.keys(by).sort().forEach((party) => {
    const cred = A.isCreditor(party), rows = by[party].sort((x, c) => x.v.date.localeCompare(c.v.date) || String(x.v.id).localeCompare(String(c.v.id)));
    // for a supplier a bill is a credit (a > 0) and a payment a debit; for a customer the other way round
    const bills = [], adv = [];
    let spare = 0;   // what journals and notes took past the bills: no advance, taken up by the next bills first
    // the opening balance first (Tally's sign, a debit negative): last year's bills still owed, or an advance carried in
    const o0 = r2(cred ? num(ob[party]) : -num(ob[party]));
    if (o0 > 0) bills.push({ left: o0 });
    else if (o0 < 0) adv.push({ v: { id: "open", date: from }, left: -o0 });
    let pays = 0, invoices = 0;
    rows.forEach(({ v, a }) => {
      let amt = r2(cred ? a : -a);
      if (amt > 0) {   // a bill: takes up what journals left over, then the oldest advances, else waits
        invoices++;
        const t0 = Math.min(spare, amt); spare = r2(spare - t0); amt = r2(amt - t0);
        while (amt > 0 && adv.length) { const x = adv[0], t = Math.min(x.left, amt); x.left = r2(x.left - t); amt = r2(amt - t); if (x.left <= 0.005) adv.shift(); }
        if (amt > 0) bills.push({ left: amt });
      } else if (amt < 0) {   // a payment or an adjustment: pays the oldest bills first
        let p = -amt; const bank = viaBank(v);
        if (bank) pays++;
        while (p > 0 && bills.length) { const x = bills[0], t = Math.min(x.left, p); x.left = r2(x.left - t); p = r2(p - t); if (x.left <= 0.005) bills.shift(); }
        if (p > 0.005) { if (bank) adv.push({ v, left: r2(p) }); else spare = r2(spare + p); }
      }
    });
    open[party] = adv; spareOf[party] = spare;
    const old = adv.filter((x) => daysBetween(x.v.date, inp.today) > LIMITS.advanceDays);
    // carried in from last year (no payment of this book): a balance on the wrong side
    const carried = old.filter((x) => x.v.id === "open").reduce((s, x) => s + x.left, 0);
    if (carried >= LIMITS.wrongSide) out.push(F("wrong_side", "ws:" + ledgerKey(party), { party, amt: r2(carried), side: cred ? "supplier" : "customer", date: inp.today, old: !moved.has(party) }));
    const paid = old.filter((x) => x.v.id !== "open"), amt = r2(paid.reduce((s, x) => s + x.left, 0));
    if (!paid.length || amt < LIMITS.wrongSide) return;
    out.push(F("advance_open", "adv:" + ledgerKey(party), { party, side: cred ? "paid" : "received", amt, n: paid.length, date: paid[0].v.date, vid: paid[0].v.id, vids: paid.map((x) => x.v.id),
      days: daysBetween(paid[0].v.date, inp.today), gateway: !cred && pays >= 10 && pays > 3 * invoices ? true : undefined }));
  });
  // a party on the wrong side with no open advance found above (a journal took it there)
  const bal = balancesAt(V, inp.today, inp.open);
  Object.keys(bal).sort().forEach((l) => {
    const b = bal[l], wrong = (A.isCreditor(l) && b < -LIMITS.wrongSide) || (A.isDebtor(l) && b > LIMITS.wrongSide);
    // (what journals or notes took past the bills is the firm's own adjustment: not asked)
    if (!wrong || (open[l] || []).length || spareOf[l] > 0.005 || out.some((f) => f.facts.party === l)) return;
    out.push(F("wrong_side", "ws:" + ledgerKey(l), { party: l, amt: Math.abs(b), side: A.isCreditor(l) ? "supplier" : "customer", date: inp.today, old: !moved.has(l) }));
  });
}

// (b) unusual entries
function unusual(inp, A, V, out) {
  const from = addDays(inp.today, -400), recent = V.filter((v) => v.date >= from);
  cashRows(A, recent).forEach((x) => out.push(F("cash_big", "cash:" + x.date + ":" + ledgerKey(x.l) + (A.isExpense(x.l) ? ":" + x.vs[0].id : ""), { party: x.l, amt: x.amt, date: x.date, vids: x.vs.map((v) => v.id) })));
  roundRows(A, recent).forEach((x) => out.push(F("round_sum", "round:" + x.v.id, { party: (x.v.ent.find((e) => A.isExpense(e.l) || A.isIncome(e.l)) || {}).l || x.v.party || "", amt: x.amt, date: x.v.date, vid: x.v.id })));
  // (a journal of tax ledgers only, the GST set-off or a TDS transfer, with at most a rounding line (under ₹10, or a round-off
  // ledger), is the firm's
  // own: not asked)
  const taxL = (l) => A.isDuties(l) || A.isBankL(l) || A.isCash(l) || A.under(l, /GST|TAX|TDS|TCS|CESS|ELECTRONIC/i) || /\bGST\b|GST\b|\bTDS\b|\bTCS\b|\bCESS\b|ELECTRONIC (CASH|CREDIT)/i.test(l);
  bareRows(A, recent).filter((x) => !x.v.ent.every((e) => Math.abs(e.a) < 10 || /ROUND/i.test(e.l) || ((inp.books.map || {})[e.l] || {}).kind === "roundoff" || taxL(e.l))).forEach((x) => out.push(F("no_narration", "narr:" + x.v.id, { party: x.v.party || (x.v.ent.find((e) => e.a < 0) || {}).l || "", amt: x.amt, date: x.v.date, vid: x.v.id, type: x.v.type, ref: x.v.ref || "" })));
  // an expense ledger's last full month against the average of the three before it
  const last = ymAdd(ymOf(inp.today), -1), tot = {};
  V.forEach((v) => { const m = ymOf(v.date); if (m < ymAdd(last, -3) || m > last) return; v.ent.forEach((e) => { if (A.isExpense(e.l)) { const t = tot[e.l] = tot[e.l] || {}; t[m] = r2((t[m] || 0) - e.a); } }); });
  Object.keys(tot).sort().forEach((l) => {
    const t = tot[l], now = t[last] || 0, before = [1, 2, 3].map((i) => t[ymAdd(last, -i)] || 0), avg = r2(before.reduce((s, x) => s + x, 0) / 3);
    if (avg > 0 && now >= LIMITS.jumpX * avg && now - avg >= LIMITS.jumpMin) out.push(F("expense_jump", "jump:" + ledgerKey(l) + ":" + last, { party: l, amt: now, avg, ym: last, times: Math.round(now / avg) }));
  });
  // suspense with a balance today that was there 30 days ago too
  const then = addDays(inp.today, -LIMITS.suspenseDays), bNow = balancesAt(V, inp.today, inp.open), bThen = balancesAt(V, then, inp.open);
  Object.keys(bNow).sort().forEach((l) => {
    if (!A.isSuspense(l) || Math.abs(bNow[l]) < 1 || Math.abs(bThen[l] || 0) < 1) return;
    const since = V.filter((v) => v.date <= then && v.ent.some((e) => e.l === l)).map((v) => v.date).sort().pop() || then;
    out.push(F("suspense", "sus:" + ledgerKey(l), { party: l, amt: Math.abs(bNow[l]), date: since }));
  });
}

// (c) bank lines with nothing behind them, and months with no statement
function bank(inp, out) {
  const bk = inp.bank || {}, rows = bk.rows || [];
  rows.forEach((r) => {
    const d = ymd(r.date), amt = r2(r.debit || r.credit);
    // explained: sent, in Tally, ready or ignored, or a ledger a person set; a "suggested" ledger is FinCom's guess, checked here
    if (!d || !amt || ["sent", "intally", "ready", "ignored"].includes(String(r.state || "")) || (r.userSet && r.ledger)) return;
    if (daysBetween(d, inp.today) < 3) return;   // too new: the day's own posting comes first
    out.push(F("bank_no_bill", "bank:" + (r.sid || r.acct) + ":" + r.id, { party: (r.dec && r.dec.name) || shortNarr(r.narr), amt, date: d, dir: r.debit ? "out" : "in", row: r.id, acct: r.acct, sid: r.sid || "", suggested: r.state === "suggested" ? (r.ledger || "") : undefined, narr: String(r.narr || "").slice(0, 120) }));
  });
  const lastFull = ymAdd(ymOf(inp.today), -1);
  (bk.accounts || []).forEach((a) => {
    const months = new Set(rows.filter((r) => r.acct === a.id).map((r) => ymOf(ymd(r.date))).filter(Boolean));
    if (!months.size) return;
    const first = Array.from(months).sort()[0];
    for (let m = first; m <= lastFull; m = ymAdd(m, 1)) if (!months.has(m)) out.push(F("bank_month_missing", "bankm:" + a.id + ":" + m, { party: a.name || a.ledger || "Bank", acct: a.id, ym: m, last4: a.last4 || "" }));
  });
}
const shortNarr = (s) => String(s || "").replace(/^(UPI|NEFT|RTGS|IMPS|CHQ|ACH)[-/ ]*/i, "").split(/[/-]/).map((x) => x.trim()).filter((x) => /[A-Za-z]{3}/.test(x))[0] || "Bank line";

// (d) 2B bills not in the books, months with no sales
function gst(inp, A, V, out) {
  (inp.twob || []).forEach((p) => {
    const d = ymd(p.date); if (!d || !p.gstin) return;
    const total = r2(num(p.taxable) + num(p.igst) + num(p.cgst) + num(p.sgst) + num(p.cess));
    out.push(F("twob_not_in_books", "2b:" + p.gstin + ":" + normNo(p.no), { party: p.party || p.gstin, gstin: p.gstin, no: String(p.no || ""), date: d, amt: total, taxable: r2(num(p.taxable)), igst: r2(num(p.igst)), cgst: r2(num(p.cgst)), sgst: r2(num(p.sgst)), cess: r2(num(p.cess)) }));
  });
  const sales = {};
  V.forEach((v) => { if (isSale(v) && !/CREDIT/i.test(v.type)) sales[ymOf(v.date)] = (sales[ymOf(v.date)] || 0) + 1; });
  const ms_ = Object.keys(sales).sort();
  if (!ms_.length) return;
  const lastFull = ymAdd(ymOf(inp.today), -1);
  for (let m = ymAdd(ms_[0], 1); m <= lastFull; m = ymAdd(m, 1)) {
    if (sales[m]) continue;
    if (![1, 2, 3].every((i) => sales[ymAdd(m, -i)])) continue;   // only after three months in a row with sales
    out.push(F("sales_month_missing", "sales:" + m, { party: "Sales", ym: m }));
  }
}

// (e) the salary sheet: months with salary in the books and no sheet; what was paid against the sheet
const salaryLedger = (A, l) => /SALAR|WAGES/i.test(l) && (A.isExpense(l) || /PAYABLE/i.test(l));
export function sheetMonth(r) { const m = ymd(r.date); if (m) return ymOf(m); const s = String(r.month || ""); const x = s.match(/^(\d{4})-?(\d{2})$/); if (x) return x[1] + x[2]; const i = MON.findIndex((k) => s.toLowerCase().startsWith(k.toLowerCase())); const y = s.match(/(\d{4})/); return i >= 0 && y ? y[1] + String(i + 1).padStart(2, "0") : ""; }
// (phase 2, review L2) one net for every use: the sheet's own net when it has one, else gross less TDS, professional tax,
// PF and ESI
export const sheetNet = (r) => r2(r.net != null && r.net !== "" ? num(r.net) : num(r.gross) - num(r.tds) - num(r.profTax) - num(r.pf) - num(r.esi));
// (phase 2, review H2 and N5) salary booked for a month: one rule for the payroll journal and the salary payments.
// A ledger is salary "yes" when it is the salary ledger the payroll uses (certain by name, or the owner's pick), or sits in
// that ledger's own sub-group where EVERY ledger is salary-named; "maybe" when it is another expense named like salary
// (salary, wages, remuneration, stipend, bonus, staff pay; not auditors' remuneration or staff welfare). A month with a
// "maybe" cannot be decided exactly: Needs you.
export const SALARY_RE = /SALAR|WAGES|REMUNERATION|STIPEND|BONUS|STAFF\s*(PAY|COST)|PAYROLL|EMPLOYEE\s*(BENEFIT|COST)/i;
const NOT_SALARY = /AUDIT|WELFARE/i;
export const salaryNamed = (l) => SALARY_RE.test(l) && !NOT_SALARY.test(l);
// next-payroll (re-review 1): a pay head of Tally's payroll that is salary paid to the employee (an earning: "Earnings for
// Employees", bonus, overtime, arrears), by Tally's pay head type; with no type (a bridge before 2.4.4), by its name. The
// employer's contributions (PF, ESI, EDLI, admin charges), gratuity, reimbursements, loans and deductions are not salary
// (third review) by Tally's type alone when it gives one (arrears are salary whatever their type, as 73-payroll.js has
// it); by the name only when it gives none ("Company PF Share", "Mediclaim (Company)", "Employer ESI": not salary; an
// earning such as "Company Car Allowance" is: "company" counts only with a share, PF, ESI or insurance word)
const NOT_EARN_TYPE = /employer|gratuity|reimburse|loan|advance|deduction|not applicable/i;
const EMPLOYER_NAME = /employer|gratuity|contribution|\bedli\b|admin(istrative|istration)?\s*charge|mediclaim|\bbonus\s*provision|\b(company|co\.?)('?s)?\b.*\b(share|pf|epf|esic?|insurance)\b|\b(share|pf|epf|esic?)\b.*\bcompany\b/i;
const NOT_EARN_NAME = /payable|reimburse|\bloan\b|advance|\btds\b|income\s*tax|prof(essional)?\.?\s*tax|\b(e?pf|esic?)\b/i;
const ARREARS = /\bar{1,2}ears?\b/i;
export function earningHead(name, type) {
  const t = String(type || "").trim(), n = String(name || "");
  if (ARREARS.test(n) && !/employer|gratuity|loan|advance|deduction/i.test(t)) return true;
  if (t) return /earning|bonus|overtime|arrear/i.test(t) && !NOT_EARN_TYPE.test(t);
  return !EMPLOYER_NAME.test(n) && !NOT_EARN_NAME.test(n);
}
export const notSalaryHeadName = (l) => EMPLOYER_NAME.test(String(l || "")) && !ARREARS.test(String(l || ""));
export function salaryClass(A, l, base, ledgers) {
  if (!A.isExpense(l)) return "";
  if (base && l === base) return "yes";
  const pb = base ? A.path(base) || [] : [];
  if (pb.length >= 2 && (A.path(l) || [])[0] === pb[0]) {
    const peers = (ledgers || []).filter((x) => (A.path(x) || [])[0] === pb[0]);
    if (peers.length && peers.every(salaryNamed)) return "yes";
  }
  return salaryNamed(l) ? "maybe" : "";
}
const MONTH_RX = [/^jan/i, /^feb/i, /^mar/i, /^apr/i, /^may/i, /^jun/i, /^jul/i, /^aug/i, /^sep/i, /^oct/i, /^nov/i, /^dec/i];
// the narration names the month: "Oct 2026", "October-2026", "Oct'26", "10/2026", "2026-10"; a full date ("20/11/2026",
// "2026-11-20") names a day, not a month (review N1)
export function namesMonth(narr, ym) {
  const t = String(narr || ""), y = ym.slice(0, 4), m = +ym.slice(4, 6), yy = y.slice(2);
  if (new RegExp("(^|[^\\d/.-])0?" + m + "[-/.](" + y + "|" + yy + ")(?![\\d/.-]*\\d)").test(t) || new RegExp("(^|[^\\d/.-])" + y + "[-/.]0?" + m + "(?![-/.]?\\d)").test(t)) return true;
  const re = /([A-Za-z]{3,9})[\s.'’,-]*('?)(\d{4}|\d{2})(?!\d)/g; let x;
  while ((x = re.exec(t))) { const yr = x[3].length === 4 ? x[3] : "20" + x[3]; if (MONTH_RX[m - 1].test(x[1]) && (x[1].length === 3 || /^(january|february|march|april|may|june|july|august|september|october|november|december|sept)$/i.test(x[1])) && yr === y) return true; }
  return false;
}
// the entries that book salary for a month, each counted for one month only (review N5): an entry naming a month counts for
// that month; else one dated in the month; one dated the 1st to 10th of the next month counts for this month only when this
// month has no salary entry of its own (and then not for the next)
export function salaryEntries(V, ym, isSal) {
  const sal = V.filter((v) => v.ent.some((e) => e.a < 0 && isSal(e.l)));
  const named = (v, m) => namesMonth(v.narr, m), namesOther = (v, m) => !named(v, m) && Array.from({ length: 25 }, (_, i) => ymAdd(m, i - 12)).some((y) => y !== m && named(v, y));
  const own = (m) => sal.filter((v) => ymOf(v.date) === m && !namesOther(v, m));
  const early = (m) => own(m).some((v) => +v.date.slice(6, 8) > 10 || named(v, m)) ? [] : own(ymAdd(m, 1)).filter((v) => +v.date.slice(6, 8) <= 10 && !named(v, ymAdd(m, 1)));
  const lent = new Set(early(ymAdd(ym, -1)).map((v) => v.id));
  const out = new Map();
  own(ym).filter((v) => !lent.has(v.id)).forEach((v) => out.set(v.id, v));
  early(ym).forEach((v) => out.set(v.id, v));
  sal.filter((v) => named(v, ym)).forEach((v) => out.set(v.id, v));
  return Array.from(out.values());
}
function salary(inp, A, V, out) {
  const rows = inp.salary || [];
  if (!rows.length) return;
  const sheet = {};
  rows.forEach((r) => { const m = sheetMonth(r); if (m) sheet[m] = r2((sheet[m] || 0) + sheetNet(r)); });
  const first = Object.keys(sheet).sort()[0], lastFull = ymAdd(ymOf(inp.today), -1), booked = {}, paid = {};
  V.forEach((v) => {
    const m = ymOf(v.date);
    v.ent.forEach((e) => { if (e.a < 0 && /SALAR|WAGES/i.test(e.l) && A.isExpense(e.l)) booked[m] = true; });
    // a payment from bank or cash to salary (or salary payable): counted for the month before when made by the 15th
    const out_ = v.ent.filter((e) => (A.isBankL(e.l) || A.isCash(e.l)) && e.a > 0).reduce((s, e) => s + e.a, 0);
    const to = v.ent.filter((e) => e.a < 0 && salaryLedger(A, e.l)).reduce((s, e) => s - e.a, 0);
    if (out_ && to) { const k = +v.date.slice(6, 8) <= 15 ? ymAdd(m, -1) : m; paid[k] = r2((paid[k] || 0) + Math.min(out_, to)); }
  });
  for (let m = first; m && m <= lastFull; m = ymAdd(m, 1)) {
    if (booked[m] && sheet[m] == null) out.push(F("salary_month_missing", "salm:" + m, { party: "Salary", ym: m }));
    if (sheet[m] != null && paid[m] != null && !near(sheet[m], paid[m])) out.push(F("salary_mismatch", "sald:" + m, { party: "Salary", ym: m, amt: paid[m], sheet: sheet[m], diff: r2(paid[m] - sheet[m]) }));
  }
}

export function checks(inp) {
  use(inp.books);
  const books = inp.books || {}, A = groupsOf(books), V = live(books).sort((a, c) => a.date.localeCompare(c.date)), out = [];
  if (inp.today) {
    advances(inp, A, V, out); unusual(inp, A, V, out); bank(inp, out); gst(inp, A, V, out); salary(inp, A, V, out);
  }
  return out;
}

// ---------------------------------------------------------------- FinCom's own answer: the candidates of each finding
// Each candidate: {t: entry|doc|rule|twob|salary|challan|history, ref (unique: nothing is used twice), label, ledger?,
// work?}. exact: passes every test; near: fails one by a little (Needs you, never resolved).
const billLive = (b) => b && b.x && !/rejected|deleted|removed|duplicate/i.test(String(b.status || ""));
// a bill posted to Tally is in the books (and settled there, first in first out): only bills not posted yet are candidates
const billOpen = (b) => billLive(b) && !b.exportedAt && !/posted|exported|done/i.test(String(b.status || ""));
const billTotal = (b) => r2(num(b.x.total) || (num(b.x.taxable) + num(b.x.cgst) + num(b.x.sgst) + num(b.x.igst)));
const billParty = (b, party, gstin) => {
  const bg = String(b.x.vendorGstin || "").toUpperCase();
  if (gstin && bg) return bg === gstin;                     // two GSTINs: they decide (a mismatch blocks a name match)
  return (!!ledgerKey(b.x.vendorName) && ledgerKey(b.x.vendorName) === ledgerKey(party)) || (!!b.partyLedger && b.partyLedger === party);
};
const billCand = (b) => ({ t: "doc", ref: "bill:" + b.id, label: "Bill " + (b.x.invoiceNo || "") + " · " + dmon(ymd(b.x.invoiceDate)) + " · " + inr(billTotal(b)), work: b.id });

function candidates(f, inp, A, V) {
  const exact = [], nearL = [], x = f.facts, bills = (inp.bills || []).filter(billOpen), gstinOf = (l) => String(((inp.books || {}).gstin || {})[l] || "").toUpperCase();
  const add = (list, c) => { if (!list.some((y) => y.ref === c.ref)) list.push(c); };
  if (f.kind === "advance_open" || f.kind === "wrong_side") {
    const g = gstinOf(x.party), after = f.kind === "advance_open" ? x.date : "";
    if (x.side === "paid" || x.side === "supplier") {
      bills.forEach((b) => {
        if (!billParty(b, x.party, g)) return;
        const d = ymd(b.x.invoiceDate), t = billTotal(b), inDate = !!d && d >= after && d <= inp.today && (!after || daysBetween(after, d) <= 365);
        if (near(t, x.amt) && inDate) add(exact, billCand(b)); else if ((near(t, x.amt) && !inDate) || closeish(t, x.amt)) add(nearL, billCand(b));
      });
      (inp.twob || []).forEach((p) => {
        if (!g || p.gstin !== g) return;
        const d = ymd(p.date), t = r2(num(p.taxable) + num(p.igst) + num(p.cgst) + num(p.sgst) + num(p.cess)), inDate = !!d && d >= after && d <= inp.today && (!after || daysBetween(after, d) <= 365);
        // a 2B bill that is also FinCom's bill (same GSTIN and number) is the same candidate
        if (bills.some((b) => String(b.x.vendorGstin || "").toUpperCase() === p.gstin && normNo(b.x.invoiceNo) === normNo(p.no))) return;
        const c = { t: "twob", ref: "2b:" + p.gstin + ":" + normNo(p.no), label: "2B: bill " + p.no + " · " + dmon(d) + " · " + inr(t) };
        if (near(t, x.amt) && inDate) add(exact, c); else if (near(t, x.amt) || closeish(t, x.amt)) add(nearL, c);
      });
    }
  } else if (f.kind === "cash_big") {
    bills.forEach((b) => { if (!billParty(b, x.party, gstinOf(x.party))) return; const d = ymd(b.x.invoiceDate), t = billTotal(b);
      if (near(t, x.amt) && d && Math.abs(daysBetween(d, x.date)) <= 31) add(exact, billCand(b)); else if (closeish(t, x.amt)) add(nearL, billCand(b)); });
  } else if (f.kind === "round_sum") {
    // the same amount to the same ledger in 3 or more earlier months: explained by history (rent, a retainer)
    const ms_ = new Set(V.filter((v) => v.id !== x.vid && v.date < x.date && v.ent.some((e) => e.l === x.party && near(Math.abs(e.a), x.amt))).map((v) => ymOf(v.date)));
    if (ms_.size >= 3) add(exact, { t: "history", ref: "hist:round:" + x.vid, label: "Same amount in " + ms_.size + " earlier months" });
  } else if (f.kind === "no_narration") {
    if (String(x.ref || "").trim()) add(exact, { t: "entry", ref: "ref:" + x.vid, label: "Bill " + x.ref + " in the entry" });
  } else if (f.kind === "expense_jump") {
    const ms0 = x.ym + "01", me = ymAdd(x.ym, 1) + "01", jump = x.amt - x.avg;
    const big = V.filter((v) => v.date >= ms0 && v.date < me).map((v) => ({ v, a: v.ent.filter((e) => e.l === x.party && e.a < 0).reduce((s, e) => s - e.a, 0) })).filter((y) => y.a >= 0.8 * jump);
    if (big.length === 1) bills.forEach((b) => { if (near(billTotal(b), big[0].a) && !!ledgerKey(b.x.vendorName) && ledgerKey(b.x.vendorName) === ledgerKey(big[0].v.party)) add(exact, billCand(b)); });
  } else if (f.kind === "bank_no_bill") {
    const row = ((inp.bank || {}).rows || []).find((r) => r.id === x.row && (r.sid || r.acct) === (x.sid || x.acct)) || {}, acc = ((inp.bank || {}).accounts || []).find((a) => a.id === x.acct);
    // 1. written rules
    (inp.rules || []).forEach((r, i) => { if (ruleHits(r, row, acc)) { const led = r.then && (r.then.ledger || (r.then.kind && (inp.ledgersFor || {})[r.then.kind])) || ""; if (led) add(exact, { t: "rule", ref: "rule:" + (r.id || i) + ":" + x.row, label: "Rule: " + (r.name || (r.when.text || []).map((c) => "“" + c.v + "”").join(" + ")) + " → " + led, ledger: led }); } });
    // 2. bills and invoices of the party the line names
    if (x.dir === "out") bills.forEach((b) => { const nm = names(row, b.x.vendorName); if (!nm) return; const d = ymd(b.x.invoiceDate), t = billTotal(b);
      const c = Object.assign(billCand(b), { ledger: b.partyLedger || b.x.vendorName });
      if (near(t, x.amt) && d && d <= x.date) add(nm === "exact" ? exact : nearL, c); else if (closeish(t, x.amt)) add(nearL, c); });
    V.forEach((v) => {
      const sale = isSale(v) && x.dir === "in", buy = isPurchase(v) && x.dir === "out";
      if (!sale && !buy) return;
      const p = v.ent.find((e) => (sale ? e.a < 0 && A.isDebtor(e.l) : e.a > 0 && A.isCreditor(e.l)));
      const nm = p && names(row, p.l);
      if (!nm) return;
      // review M1: an invoice or bill already settled by receipts or payments in the books is no candidate
      const left = openLeft(A, V, inp.open || {}).get(v.id);
      if (left != null && left < Math.abs(p.a) - TOL) return;
      const t = Math.abs(p.a), okDate = sale ? v.date <= addDays(x.date, 7) : v.date <= x.date;
      const c = { t: "entry", ref: "vch:" + v.id, label: v.type + " " + (v.no || v.ref || "") + " · " + dmon(v.date) + " · " + inr(t), ledger: p.l };
      if (near(t, x.amt) && okDate) add(nm === "exact" ? exact : nearL, c); else if (closeish(t, x.amt)) add(nearL, c);
    });
    // 3. a 2B bill of a supplier the line names (the books do not have it yet)
    if (x.dir === "out") (inp.twob || []).forEach((p) => { const nm = names(row, p.party); if (!nm) return; const t = r2(num(p.taxable) + num(p.igst) + num(p.cgst) + num(p.sgst) + num(p.cess));
      const c = { t: "twob", ref: "2b:" + p.gstin + ":" + normNo(p.no), label: "2B: bill " + p.no + " of " + p.party + " · " + inr(t), ledger: p.party }; if (near(t, x.amt)) add(nm === "exact" ? exact : nearL, c); else if (closeish(t, x.amt)) add(nearL, c); });
    // 4. salary: the sheet's net pay for the month (or the month before), a line that says salary. (Phase 2) against the
    // salary payable ledger only when that ledger is certain (exactly one, in current liabilities, or a person's pick) and
    // the month's payroll is booked to it (in the books, or its Daily Check journal approved); else Needs you
    const sp = (inp.ledgersFor || {}).salaryPayable || "";
    const base = (inp.ledgersFor || {}).salaryExpense || "";
    const isSal = (l) => salaryClass(A, l, base, inp.ledgers) === "yes";
    const payBooked = (m) => !!sp && (salaryEntries(V, m, isSal).some((v) => v.ent.some((e) => e.l === sp && e.a > 0))
      || (inp.drafts || []).some((d) => d && d.dedupe === "payroll:" + m && !d.removed && d.state !== "failed"));
    if (x.dir === "out" && /SALAR|WAGES/i.test(row.narr || "")) [ymOf(x.date), ymAdd(ymOf(x.date), -1)].forEach((m) => {
      const net = r2((inp.salary || []).filter((r) => sheetMonth(r) === m).reduce((s, r) => s + sheetNet(r), 0));
      // (review L1) resolved only to the paisa; ₹0.01 to ₹1 out: Needs you
      if (net && near(net, x.amt)) add(payBooked(m) && P2(net) === P2(x.amt) ? exact : nearL, { t: "salary", ref: "sal:" + m, label: "Salary sheet " + monYear(m) + " · net " + inr(net), ledger: sp });
    });
    // (phase 2) one employee's pay: the line's decoded name is the sheet's name (ledgerKey), the net within ₹1, the month
    // the line pays (by the 15th: the month before), one row of that name in that month
    if (x.dir === "out" && row.dec && ledgerKey(row.dec.name)) {
      const m = +x.date.slice(6, 8) <= 15 ? ymAdd(ymOf(x.date), -1) : ymOf(x.date), k = ledgerKey(row.dec.name);
      const rs = (inp.salary || []).filter((r) => sheetMonth(r) === m && ledgerKey(r.name) === k);
      if (rs.length) {
        const net = r2(rs.reduce((s, r) => s + sheetNet(r), 0)), c = { t: "salary", ref: "sal:" + m + ":" + k, label: "Salary sheet " + monYear(m) + " · " + rs[0].name + " · net " + inr(net), ledger: sp };
        if (P2(net) === P2(x.amt) && rs.length === 1 && payBooked(m)) add(exact, c); else if (near(net, x.amt) || closeish(net, x.amt)) add(nearL, c);
        // two rows of that name: each that fits is shown, none is picked
        else if (rs.length > 1) rs.forEach((r, i) => { if (near(sheetNet(r), x.amt)) add(nearL, Object.assign({}, c, { ref: c.ref + ":" + i, label: "Salary sheet " + monYear(m) + " · " + r.name + (r.code ? " (" + r.code + ")" : "") + " · net " + inr(sheetNet(r)) })); });
      }
    }
    // 5. tax challans: the same amount, the same day or the next bank day
    (inp.challans || []).forEach((c) => { const d = ymd(c.date); if (x.dir !== "out" || !d) return;
      const cc = { t: "challan", ref: "challan:" + c.kind + ":" + c.ref, label: (c.kind === "gst" ? "GST" : "TDS") + " challan " + String(c.ref || "").slice(-6) + " · " + inr(c.amt), ledger: (inp.ledgersFor || {})[c.kind === "gst" ? "gstCash" : "tds"] || "" };
      if (near(c.amt, x.amt) && Math.abs(daysBetween(d, x.date)) <= 1) add(exact, cc); else if (near(c.amt, x.amt) && Math.abs(daysBetween(d, x.date)) <= 5) add(nearL, cc); });
    // 6. a loan's EMI: the same amount to one loan ledger in 3 of the 4 months before, within 3 days of the same date
    const emi = {};
    V.forEach((v) => { const back = daysBetween(v.date, x.date); if (back < 20 || back > 130) return;
      v.ent.forEach((e) => { if (e.a < 0 && A.isLoan(e.l) && near(-e.a, x.amt) && Math.abs(+v.date.slice(6, 8) - +x.date.slice(6, 8)) <= 3) (emi[e.l] = emi[e.l] || new Set()).add(ymOf(v.date)); }); });
    if (x.dir === "out") Object.keys(emi).forEach((l) => { if (emi[l].size >= 3) add(exact, { t: "history", ref: "emi:" + ledgerKey(l) + ":" + x.row, label: "EMI: same amount to " + l + " in " + emi[l].size + " months", ledger: l }); });
    // 7. rules the bank learnt from a person's choices (bank_meta.rules: {key, dir, ledger}; src/js/96 newled): the line's
    // decoded key, the same direction or any
    const dk = row.dec && row.dec.key;
    // (re-review N1) a key made from the narration ("narr:…") is a narration match: near, never exact; a rule for either
    // direction ("any") is exact only when a person chose it before for a line in THIS direction
    const byNarr = /^narr:/.test(String(dk || ""));
    const seenDir = (r) => (inp.history || []).some((h) => h && h.k === dk && h.l === r.ledger && h.d === x.dir && /^(you|accepted|hand|confirm|rule-written)$/.test(String(h.s || "")));
    if (dk) (inp.learned || []).forEach((r) => { if (!r || r.key !== dk || !r.ledger || !(r.dir === "any" || r.dir === x.dir)) return;
      const c = { t: "rule", ref: "learnt:" + r.key + ":" + x.row, label: "Learnt: " + (r.label || r.key) + " → " + r.ledger, ledger: r.ledger };
      add(!byNarr && (r.dir === x.dir || seenDir(r)) ? exact : nearL, c); });
    // 8. what people chose before for the same party (bank_meta.hist.rows: {k, d, l, s}): twice or more, always the same
    // ledger; two ledgers before is no answer
    if (dk) {
      // (N5) a choice whose source is not known is not counted
      const before = (inp.history || []).filter((h) => h && h.k === dk && h.l && (!h.d || h.d === x.dir) && /^(you|accepted|hand|confirm|rule-written)$/.test(String(h.s || "")));
      const leds = Array.from(new Set(before.map((h) => h.l)));
      if (before.length >= 2 && leds.length === 1) add(byNarr ? nearL : exact, { t: "history", ref: "hist:" + dk + ":" + x.row, label: "Same as before (" + before.length + " times): " + leds[0], ledger: leds[0] });
      else if (leds.length > 1) leds.forEach((l) => add(nearL, { t: "history", ref: "hist:" + dk + ":" + l + ":" + x.row, label: "Before: " + l, ledger: l }));
    }
  } else if (f.kind === "twob_not_in_books") {
    // any bill FinCom holds, posted or not: the client need not send it again (a posted one makes no entry)
    (inp.bills || []).filter(billLive).forEach((b) => {
      if (String(b.x.vendorGstin || "").toUpperCase() !== x.gstin || normNo(b.x.invoiceNo) !== normNo(x.no)) return;
      const c = Object.assign(billCand(b), { label: "Inbox: bill " + (b.x.invoiceNo || "") + " · " + inr(billTotal(b)) });
      if (near(billTotal(b), x.amt)) add(exact, c); else add(nearL, c);
    });
  }
  return { exact, near: nearL };
}

// one answer: every candidate points at the same document (or none) and the same ledger. Two rules naming the same
// ledger are one answer; a bill and a rule naming different ledgers are two
const DOCS = ["doc", "entry", "twob", "salary", "challan"];
const target = (c) => (DOCS.includes(c.t) ? c.ref : "") + "|" + (c.ledger || "");
export const oneAnswer = (list) => list.length > 0 && new Set(list.map(target)).size === 1;

export function answer(raw, inp) {
  use(inp.books);
  const books = inp.books || {}, A = groupsOf(books), V = live(books).sort((a, c) => a.date.localeCompare(c.date));
  const prior = inp.prior || [], undone = new Set(prior.filter((p) => p.undone).map((p) => p.kind + "|" + p.key));
  // evidence already used by another finding (resolved on an earlier night, not undone)
  const usedBy = new Map();
  prior.forEach((p) => { if (p.state === "resolved" && !p.undone) (p.evidence || []).forEach((e) => { if (e.ref && !/^rule:|^hist:/.test(e.ref)) usedBy.set(e.ref, p.kind + "|" + p.key); }); });
  const all = raw.map((f) => Object.assign({}, f, candidates(f, inp, A, V)));
  // a document or entry that fits two findings tonight is a tie for both (never picked)
  const count = new Map();
  all.forEach((f) => f.exact.forEach((c) => { if (!/^rule:|^hist:|^emi:/.test(c.ref) && !usedBy.has(c.ref)) count.set(c.ref, (count.get(c.ref) || 0) + 1); }));
  return all.map((f) => {
    const me = f.kind + "|" + f.key, free = [], contested = [];
    f.exact.forEach((c) => {
      const owner = usedBy.get(c.ref);
      if (owner && owner !== me) return;                       // used before by another finding: not a candidate
      if ((count.get(c.ref) || 0) > 1) contested.push(c); else free.push(c);
    });
    let state, evidence = [], cands = [];
    if (f.kind === "suspense") state = "you";
    else if (contested.length) { state = "you"; cands = free.concat(contested); }          // fits another finding too
    else if (free.length && !oneAnswer(free)) { state = "you"; cands = free; }            // two that fit: never picked
    else if (free.length && undone.has(me)) state = "ask";                                // the person undid it before
    else if (free.length) { state = "resolved"; evidence = free; }
    else if (f.near.length) { state = "you"; cands = f.near; }                            // a near miss: never resolved
    else state = "ask";
    // a payment gateway or settlement ledger (receipts far beyond its sales), or an old balance with no entries this year:
    // the firm looks at it, the client is not asked
    if (state === "ask" && ((f.kind === "advance_open" && f.facts.gateway) || (f.kind === "wrong_side" && f.facts.old))) state = "you";
    // (N5) a line with FinCom's guess nobody reviewed, and nothing certain: the firm looks at the guess first
    if (state === "ask" && f.kind === "bank_no_bill" && f.facts.suggested !== undefined) state = "you";
    // a missing month while the Inbox holds files not read yet: read them first, ask nothing
    if (state === "ask" && /month_missing$/.test(f.kind) && (inp.inboxUnread || 0) > 0) { state = "you"; f.facts = Object.assign({}, f.facts, { unread: inp.inboxUnread }); }
    // a month the books are not read up to yet: the bridge is behind, not the client
    if (state === "ask" && f.kind === "sales_month_missing" && inp.readTo && inp.readTo < ymAdd(f.facts.ym, 1) + "01") { state = "you"; f.facts = Object.assign({}, f.facts, { readTo: inp.readTo }); }
    const out = { kind: f.kind, key: f.key, facts: f.facts, state, evidence: evidence.map(slim), candidates: cands.map(slim) };
    out.short = shortOf(out); if (state === "ask") out.ask = askText(out); if (state === "you") out.title = titleOf(out);
    // kept with the finding: the row's words, and the question to use if the person undoes FinCom's answer or asks
    out.facts = Object.assign({}, f.facts, { short: out.short, title: out.title || "", ask_text: askText(out) });
    return out;
  });
}
const slim = (c) => { const o = { t: c.t, ref: c.ref, label: c.label }; if (c.ledger) o.ledger = c.ledger; if (c.work) o.work = c.work; return o; };

// ---------------------------------------------------------------- the words (calm: one short line a row)
export function askText(f) {
  const x = f.facts || {}, a = inr(x.amt || 0), d = dmon(x.date || "");
  switch (f.kind) {
    case "advance_open": return (x.n > 1 ? a + " paid " + (x.side === "paid" ? "to " : "by ") + x.party + " since " + d + " (" + x.n + " payments) has no " + (x.side === "paid" ? "bill" : "invoice") + " in the books. "
      : a + " advance " + (x.side === "paid" ? "to " : "from ") + x.party + " on " + d + " is still open. ") + (x.side === "paid" ? "Has the bill come?" : "Has the invoice gone out?");
    case "wrong_side": return x.side === "supplier" ? a + " is shown as paid in advance to " + x.party + ". Is a bill pending?" : a + " is shown as received in advance from " + x.party + ". Is an invoice pending?";
    case "cash_big": return a + " paid in cash to " + x.party + " on " + d + ". Please send the bill.";
    case "round_sum": return a + " entered to " + x.party + " on " + d + ". What is it for?";
    case "no_narration": return a + " " + String(x.type || "entry").toLowerCase() + " on " + d + " has no narration. What is it for?";
    case "expense_jump": return x.party + " was " + a + " in " + monYear(x.ym) + ", against about " + inr(x.avg) + " a month before. What was it for?";
    case "bank_no_bill": return x.dir === "out" ? a + " paid to " + x.party + " on " + d + ": what is it for? A bill, salary or advance?" : a + " received from " + x.party + " on " + d + ": what is it for? An invoice, a loan or an advance?";
    case "bank_month_missing": return "Please send the bank statement" + (x.last4 ? " (account ending " + x.last4 + ")" : " for " + x.party) + " for " + monYear(x.ym) + ".";
    case "twob_not_in_books": return "Please send bill " + x.no + " from " + x.party + " (" + a + ", " + monYear(ymOf(x.date)) + ").";
    case "sales_month_missing": return "There are no sales in the books for " + monYear(x.ym) + ". Were there none, or are the bills still to come?";
    case "salary_month_missing": return "Please send the salary sheet for " + monYear(x.ym) + ".";
    case "salary_mismatch": return "Salary paid for " + monYear(x.ym) + " is " + a + " but the sheet says " + inr(x.sheet) + ". What is the " + inr(Math.abs(x.diff)) + "?";
    default: return "";
  }
}
const SHORT = {
  ask: { advance_open: "Advance open. Bill come?", wrong_side: "Balance on the wrong side. Bill?", cash_big: "Cash. Bill?", round_sum: "Round sum. What for?", no_narration: "No narration. What for?",
    bank_no_bill: "Paid for what?", bank_month_missing: "Statement missing", twob_not_in_books: "Bill not in books", sales_month_missing: "No sales?", salary_month_missing: "Salary sheet missing", salary_mismatch: "Salary differs" },
  resolved: { advance_open: "Advance: bill found", wrong_side: "Balance: bill found", cash_big: "Cash: bill found", round_sum: "Round sum: same every month", no_narration: "Bill in the entry",
    expense_jump: "Jump: bill found", bank_no_bill: "Bank line answered", twob_not_in_books: "2B bill: in Inbox", salary_mismatch: "Salary difference explained" },
};
function shortOf(f) {
  const x = f.facts || {};
  if (f.state === "resolved") return SHORT.resolved[f.kind] || "Answered";
  if (f.kind === "expense_jump") return (x.times || 3) + "× usual. What for?";
  if (f.kind === "bank_no_bill" && x.dir === "in") return "Received for what?";
  return SHORT.ask[f.kind] || "";
}
function titleOf(f) {
  const x = f.facts || {}, a = x.amt ? inr(x.amt) : "";
  if (x.unread) return x.unread + " Inbox files not read · " + (f.kind === "bank_month_missing" ? "statement " : f.kind === "salary_month_missing" ? "salary sheet " : "sales ") + monYear(x.ym) + "?";
  if (x.readTo) return "Books read up to " + dmon(x.readTo) + " · sales " + monYear(x.ym) + "?";
  if (f.kind === "suspense") return "Suspense " + a + " since " + dmon(x.date);
  if (f.kind === "advance_open" && x.gateway) return a + " received through " + x.party + " · not matched to sales";
  if (f.kind === "wrong_side" && x.old && !(f.candidates || []).length) return a + " " + x.party + " · old balance, no entries this year";
  if (f.kind === "bank_no_bill" && x.suggested !== undefined && !(f.candidates || []).length) return a + " " + (x.dir === "out" ? "paid" : "received") + " " + dmon(x.date) + (x.suggested ? " · guess: " + x.suggested + " · right?" : " · what is it?");
  if (f.kind === "bank_no_bill") return a + " " + (x.dir === "out" ? "paid" : "received") + " " + dmon(x.date) + " · which one?";
  return a + " " + x.party + " · which one?";
}

// ---------------------------------------------------------------- the entries FinCom prepares, and their checks
export const GST_RATES = [0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28, 40];
export function checkEntry(e, inp) {
  const v = e.voucher || {}, lines = v.lines || [], led = new Set(inp.ledgers || []), out = [];
  const dr = r2(lines.reduce((s, l) => s + num(l.dr), 0)), cr = r2(lines.reduce((s, l) => s + num(l.cr), 0));
  out.push({ k: "drcr", ok: lines.length >= 2 && dr === cr && dr > 0, why: dr === cr ? "" : "Dr " + inr(dr) + " ≠ Cr " + inr(cr) });
  const missing = lines.map((l) => l.ledger).filter((l) => !l || !led.has(l));
  out.push({ k: "ledgers", ok: !missing.length, why: missing.length ? "Not in Tally: " + missing.map((l) => l || "(none)").join(", ") : "" });
  const d = ymd(v.date), shut = (inp.closed || []).find((p) => d && d >= ymd(p.from) && d <= ymd(p.to));
  out.push({ k: "period", ok: !!d && !shut, why: !d ? "No date" : shut ? "In a closed period" : "" });
  // a duplicate: the same party, bill number and amount, posted (the books) or drafted (FinCom's bills, another entry tonight)
  const amt = r2(dr), noN = normNo(v.no), pk = ledgerKey(v.party);
  const inBooks = (inp.books && inp.books.vouchers || []).some((x) => !x.cancel && ((noN && normNo(x.ref || x.no) === noN && ledgerKey(x.party) === pk) || (e.source === "bank_self_answer" && x.date === d && x.ent.some((z) => z.l === v.bank && near(Math.abs(z.a), amt)) && x.ent.some((z) => z.l === v.against))));
  const inDrafts = noN && (inp.bills || []).some((b) => b.id !== e.work_ref && billLive(b) && normNo(b.x.invoiceNo) === noN && (ledgerKey(b.x.vendorName) === pk || String(b.x.vendorGstin || "").toUpperCase() === String(v.gstin || "").toUpperCase()) && near(billTotal(b), amt));
  out.push({ k: "duplicate", ok: !inBooks && !inDrafts, why: inBooks ? "Already in the books" : inDrafts ? "Already a bill in FinCom" : "" });
  if (v.gst) {
    const g = v.gst, tax = r2(num(g.igst) + num(g.cgst) + num(g.sgst)), rate = g.taxable > 0 ? tax * 100 / g.taxable : 0, std = GST_RATES.find((x) => Math.abs(rate - x) < 0.05);
    const split = num(g.igst) ? !num(g.cgst) && !num(g.sgst) : Math.abs(num(g.cgst) - num(g.sgst)) <= 0.01;
    const ok = !tax || (split && std != null && Math.abs(g.taxable * std / 100 - tax) <= TOL);
    out.push({ k: "gst", ok, why: ok ? "" : !split ? "CGST and SGST differ, or IGST with them" : "Tax is not a GST rate of the taxable value" });
  }
  return out;
}
export const CHECK_WORDS = { drcr: "Dr = Cr", ledgers: "Ledgers in Tally", period: "Not in a closed period", duplicate: "No duplicate", gst: "GST adds up" };

export function entriesFor(findings, inp) {
  const out = [], lf = inp.ledgersFor || {}, bills = inp.bills || [];
  findings.forEach((f) => {
    if (f.state !== "resolved") return;
    const x = f.facts;
    if (f.kind === "twob_not_in_books") {
      const ev = f.evidence.find((c) => c.work), b = ev && bills.find((y) => y.id === ev.work);
      if (!b || /posted|approved|waiting/i.test(String(b.status || ""))) return;   // already on its way: nothing to prepare
      const cg = r2(num(b.x.cgst)), sg = r2(num(b.x.sgst)), ig = r2(num(b.x.igst)), tx = r2(num(b.x.taxable)), tot = billTotal(b);
      const lines = [{ ledger: b.expenseLedger || "", dr: tx }];
      if (cg) lines.push({ ledger: lf.cgstIn || "", dr: cg }); if (sg) lines.push({ ledger: lf.sgstIn || "", dr: sg }); if (ig) lines.push({ ledger: lf.igstIn || "", dr: ig });
      lines.push({ ledger: b.partyLedger || "", cr: tot });
      out.push(made(f, "twob_inbox_bill", "bill:" + b.id, b.id, { type: "Purchase", date: ymd(b.x.invoiceDate), no: b.x.invoiceNo || "", party: b.partyLedger || b.x.vendorName, gstin: x.gstin, lines,
        narration: "Bill " + (b.x.invoiceNo || "") + " dt " + dmon(ymd(b.x.invoiceDate)), gst: { taxable: tx, cgst: cg, sgst: sg, igst: ig } }, "2B bill in Inbox", inp));
    } else if (f.kind === "bank_no_bill") {
      const c = f.evidence[0], acc = ((inp.bank || {}).accounts || []).find((a) => a.id === x.acct) || {}, bankL = acc.ledger || "", against = c.ledger || "";
      const lines = x.dir === "out" ? [{ ledger: against, dr: x.amt }, { ledger: bankL, cr: x.amt }] : [{ ledger: bankL, dr: x.amt }, { ledger: against, cr: x.amt }];
      out.push(made(f, "bank_self_answer", "row:" + (x.sid || x.acct) + ":" + x.row, (x.sid || x.acct) + ":" + x.row, { type: x.dir === "out" ? "Payment" : "Receipt", date: x.date, no: "", party: against, bank: bankL, against, lines,
        narration: x.narr }, { rule: "Your rule", entry: "Invoice match", doc: "Bill match", twob: "2B bill", salary: "Salary sheet", challan: "Challan match", history: "Same as before" }[c.t] || "Matched", inp));
    }
  });
  return out;
}
function made(f, source, dedupe, work, voucher, reason, inp) {
  const e = { finding_key: f.kind + "|" + f.key, source, dedupe, work_ref: work, voucher, reason, why: f.short, evidence: f.evidence };
  e.checks = checkEntry(e, inp); e.ready = e.checks.every((c) => c.ok);
  return e;
}

export function run(inp) {
  const findings = answer(checks(inp), inp);
  return { findings, entries: entriesFor(findings, inp) };
}
