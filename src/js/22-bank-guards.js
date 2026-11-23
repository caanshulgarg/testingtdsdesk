/* @react-lazy: begin 22-bank-guards.js (the React app loads this file with its first file: app/src/lib/bankGuards.js, imported by app/src/main.jsx; build.py react_parts) */
/* ================================================================== */
/* Bank lines: the checks that keep a voucher true to the statement    */
/* (next-fix-audit-bank, 22-Nov-2026; kept out of legacy.js, which is  */
/* at its size budget: tests/run_stability.py)                         */
/* ================================================================== */
// tests/run_bank_audit_fixes.js holds each of these to its case (made-up lines only).

/* ---------- checks: running balance, order, direction ---------- */
// Each line must take the balance before it to the balance printed on it. A line whose direction the file states (its own
// Withdrawal and Deposit columns, a Dr/Cr column or a minus sign: rowsFromCells marks it dirSure) is never turned round
// to fit: it is flagged (balOk false) for a person to look at. Only a line whose direction was worked out may be turned.
// An overdraft or cash-credit account whose balances are printed without their "Dr" (Kotak: the balance's own Dr/Cr
// column, which findHeader leaves out) fits only with every balance taken as minus. Taking the balances as minus and
// turning every line round fit alike, so the balances are taken as minus (a debit balance, with the opening and closing
// printed with them) only when the file states every line's direction, at least two lines are checked that way and the
// balances as printed do not fit (audit of 22-Nov-2026: the payments of a cash-credit account were turned into receipts)
function checkBalances(rows, meta){
  if (rows.length > 1 && rows[0].date > rows[rows.length - 1].date) rows.reverse();    // newest-first statements
  let bad = 0, fixed = 0, known = 0, od = null;
  const has = v => v !== null && v !== undefined, fits = (p, r, v) => Math.abs(r2(p - r.debit + r.credit) - v) <= 0.011;
  // every line fits with the balances times sg, none turned round: {o: the opening that fits, n: lines checked}
  const chain = sg => {
    let p = meta.opening, o = p, n = 0;
    for (let i = 0; i < rows.length; i++){
      const r = rows[i], v = has(r.balance) ? sg * r.balance : null;
      if (has(v) && has(p)){ if (!fits(p, r, v)){ if (i || !fits(-p, r, v)) return null; o = -p; } n++; }
      p = v;
    }
    return {o, n};
  };
  // the lines that do not fit with the balances times sg, none turned round
  const misfit = sg => { let p = has(meta.opening) && sg < 0 ? -Math.abs(meta.opening) : meta.opening, n = 0; rows.forEach(r => { const v = has(r.balance) ? sg * r.balance : null; if (has(v) && has(p) && !fits(p, r, v)) n++; if (has(v)) p = v; }); return n; };
  // an opening or closing printed with Cr is in credit (statementMeta: crPrinted): a reader that took Deposit for
  // Withdrawal fits as an overdraft as well, so it is never read as one (re-review of the bank audit)
  const sure = rows.some(r => has(r.balance)) && rows.every(r => !has(r.balance) || r.dirSure) && !meta.crPrinted;
  let odMaybe = 0;
  if (sure && !chain(1) && (od = chain(-1)) && od.n >= 2){
    rows.forEach(r => { if (has(r.balance)) r.balance = -r.balance; });
    if (has(meta.opening)) meta.opening = od.o;
    const lb = rows.filter(r => has(r.balance)).pop();
    if (has(meta.closing) && Math.abs(meta.closing + lb.balance) <= 0.011) meta.closing = lb.balance;
  } else {
    od = null;
    // not every line fits as an overdraft, but far more do than as printed: said (BankOverlap.odWords), never guessed
    if (sure && rows.filter(r => has(r.balance)).length >= 3){ const a = misfit(1), z = misfit(-1); if (z && z * 2 < a) odMaybe = z; }
  }
  for (let i = 0; i < rows.length; i++){
    const r = rows[i];
    r.balOk = null;
    if (!has(r.balance)) continue;
    const prev = i ? rows[i - 1].balance : meta.opening;
    if (!has(prev)){ r.balOk = true; known++; continue; }
    known++;
    if (fits(prev, r, r.balance)){ r.balOk = true; continue; }
    if (!r.dirSure && fits(prev, {debit: r.credit, credit: r.debit}, r.balance)){ const d = r.debit; r.debit = r.credit; r.credit = d; r.balOk = true; r.fixedDir = true; fixed++; continue; }
    r.balOk = false; bad++;
  }
  if (meta.opening === undefined && rows.length && rows[0].balance !== null) meta.opening = r2(rows[0].balance + rows[0].debit - rows[0].credit);
  if (meta.closing === undefined && rows.length && rows[rows.length - 1].balance !== null) meta.closing = rows[rows.length - 1].balance;
  const totDr = r2(rows.reduce((a, r) => a + r.debit, 0)), totCr = r2(rows.reduce((a, r) => a + r.credit, 0));
  const summaryOk = meta.opening !== undefined && meta.closing !== undefined ? Math.abs(r2(meta.opening - totDr + totCr) - meta.closing) <= 0.011 : null;
  return {bad, fixed, known, totDr, totCr, summaryOk, od: !!od, odMaybe};
}

/* ---------- a line's links to a bill or a sales invoice ---------- */
// One purchase bill or sales invoice is matched to one line only (audit of 22-Nov-2026: a second payment of the same
// amount to the same party was matched to the bill already matched, so the bill was settled twice and its TDS at
// payment credited twice). The bills and invoices a line not being suggested again holds: the current statement's lines
// (bankClaims), and every other statement's, kept on its record when its lines are saved (st.links, saveBank).
function bankLinks(rows){
  const o = {b: [], s: []};
  (rows || []).forEach(r => { if (!r || r.state === "ignored") return; if (r.billId) o.b.push(r.billId); (r.salesIds || []).forEach(id => o.s.push(id)); });
  return o;
}
// rows: the lines being looked at (redo: those of them suggested again); a line of the page's statement counts by its
// id, so a copy of the lines suggested is not held back by the lines it copies
function bankClaims(b, rows, redo){
  const t = new Set(), s = new Set(), add = l => { (l.b || []).forEach(x => t.add(x)); (l.s || []).forEach(x => s.add(x)); }, ids = new Set(rows.map(r => r.id));
  (b.stmts || []).forEach(st => { if (st.id !== b.cur && st.links) add(st.links); });
  add(bankLinks(rows.filter(r => !redo.has(r)).concat((b.rows || []).filter(r => !ids.has(r.id)))));
  return {t, s};
}
// a line given another ledger by a person (or a rule) leaves the bill, the invoice, the TDS at payment and the split it had
// (audit of 22-Nov-2026: a receipt moved to another customer still settled the first customer's invoice; a split line
// given another ledger still posted the old split's ledgers)
function bankUnlink(r){ Object.assign(r, {billId: null, billRef: "", tdsAtPay: 0, tdsLedger: "", salesIds: null, splits: []}); }
// the sales invoices a receipt settles: only those of the customer whose ledger the line is posted to
function bankSalesOf(row){
  const l = String(exactLedger(row.ledger) || row.ledger || "").toLowerCase();
  return (row.salesIds || []).map(id => (B().salesRef || []).find(v => v.id === id)).filter(v => v && String(exactLedger(v.customerLedger) || v.customerLedger || "").toLowerCase() === l);
}
// the receipt's bill allocations: each invoice its total, the last what is left of the amount received, so the
// allocations add up to the party's line exactly (a receipt within a rupee of the invoices: the rest stays open on
// the last invoice in Tally); none when that would leave the last at nothing or less
function bankSalesAlloc(invs, amount){
  let left = r2(amount);
  const out = invs.map((v, i) => { const a = i < invs.length - 1 ? r2(num(v.x.total)) : left; left = r2(left - a); return {ref: v.x.number, amt: a}; });
  return out.every(a => a.amt > 0) ? out : [];
}

// a receipt posted: the invoices it settles marked received (only the customer's it is posted to: bankSalesOf)
function markSalesReceived(r){
  if (!r.salesIds || !r.salesIds.length) return;
  const b = B(), list = b.salesRef || [];
  let changed = false;
  const mine = new Set(bankSalesOf(r));
  list.forEach(v => { if (mine.has(v)){ v.receivedBy = r.id; v.receivedAt = r.date; changed = true; } });
  if (changed){ if (S.sales && S.sales.cid === b.cid) saveSales(); else BankDB.set("sales:" + b.cid, list); }
}

/* ---------- which bank account a statement is ---------- */
// The same account: the full account numbers agree when both are known (no X or * in them); otherwise the last four
// digits and the IFSC, when both have one (audit of 22-Nov-2026: an IFSC read from a narration made a new account)
function bankAccIs(a, meta, last4){
  const full = v => /^\d{9,}$/.test(String(v || "").replace(/^0+/, "")) ? String(v).replace(/^0+/, "") : "", x = full(a.acct), y = full(meta.acct);
  if (x && y) return x === y;
  return !!last4 && a.last4 === last4 && (!meta.ifsc || !a.ifsc || a.ifsc === meta.ifsc);
}

/* ---------- before a voucher goes to Tally ---------- */
// what stops a ready line from going in a Tally file (bankExportProblems) besides its ledger: a line that does not fit the
// running balance may have been misread (the bridge's posting moves it back to review: postBankToTally guard 3), and a
// split with TDS at payment does not add up
function bankLineProblem(r){
  if (r.balOk === false) return fmtDate(r.date) + ": does not agree with the statement’s running balance, so it may have been misread — check the amount";
  if ((r.splits || []).length && num(r.tdsAtPay) > 0 && r.debit) return fmtDate(r.date) + ": a split with TDS at payment — remove the split or the TDS";
  // the split's parts (as bankVoucherXml takes them) must add up to the line (re-review: a rule's fixed split of 10,000 on
  // a payment of 5,000 made a voucher of Dr 10,000 against Cr 5,000)
  const sp = (r.splits || []).filter(x => x.ledger && exactLedger(x.ledger) && num(x.amt) > 0), tot = r2(sp.reduce((a, x) => a + num(x.amt), 0));
  if (sp.length && Math.abs(r2(tot - (r.debit || r.credit))) > 0.005) return fmtDate(r.date) + ": its split adds up to " + INR.format(tot) + ", not the " + INR.format(r.debit || r.credit) + " on the statement — set the split again";
  return "";
}
// every name above on globalThis, for legacy.js in the React app (its own declaration: a test reading one name by
// name, tests/harness.js, does not take this line with it)
function bankGuardsOn(){ if (typeof globalThis === "object") Object.assign(globalThis, {checkBalances, bankLinks, bankClaims, bankUnlink, bankSalesOf, bankSalesAlloc, bankAccIs, bankLineProblem, markSalesReceived}); }
bankGuardsOn();
/* @react-lazy: end */
