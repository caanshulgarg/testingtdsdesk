// node run_party_hist.js - how a supplier was booked before comes from the books FinCom has, never from Tally live
// (build 190: reading each supplier's ledger from Tally made processing slow whenever Tally was connected)
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "NORM_CACHE", "normNameRaw", "normName", "NOT_EXPENSE", "isTaxLike", "partyExpensesFromTally", "applyPartyHistory"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const calls = [];
ctx.Bridge = {call: async (p) => { calls.push(p); return {rows: []}; }, on: () => true, up: () => true, openFor: () => ({name: "X"})};
ctx.bridgeLive = () => true;
ctx.ledgerInfo = l => /bank/i.test(l) ? {group: "Bank Accounts"} : {group: "Indirect Expenses"};
const d = n => { const t = new Date(Date.now() - n * 86400000); return t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0"); };
// Tally keeps a debit negative: a bill credits the supplier (+) and debits the expense (-)
const bill = (days, exp, amt) => ({date: d(days), ent: [{l: "RAJ FABRICS", a: amt * 1.18}, {l: exp, a: -amt}, {l: "Input CGST", a: -amt * 0.09}, {l: "Input SGST", a: -amt * 0.09}]});
ctx.S.books = {cid: "c1", vouchers: [bill(10, "Job Work Charges", 1000), bill(40, "Job Work Charges", 2000), bill(70, "Freight Inward", 500),
  {date: d(20), ent: [{l: "RAJ FABRICS", a: -5000}, {l: "HDFC BANK", a: 5000}]},                  // a payment: not a bill
  bill(500, "Old Head", 900), Object.assign(bill(5, "Cancelled Head", 100), {cancel: true})]};
(async () => {
  const h = x.partyExpensesFromTally("RAJ FABRICS", "c1");
  ok(h && h.bills === 3, "three bills of the last twelve months (a payment, an old bill and a cancelled one left out): " + (h && h.bills));
  ok(h && h.top[0].ledger === "Job Work Charges" && h.top[0].n === 2 && h.top[1].ledger === "Freight Inward" && !h.top.some(t => /GST|HDFC/.test(t.ledger)), "what the other side was, most used first, no tax or bank: " + JSON.stringify(h && h.top));
  ok(x.partyExpensesFromTally("RAJ FABRICS", "c2") === null, "another client's books are not used");
  ctx.S.books = null;
  const n = await x.applyPartyHistory([{status: "draft", partyLedger: "RAJ FABRICS"}], "c1");
  ok(n === 0, "without the client's books open, nothing is guessed");
  ok(calls.length === 0, "and Tally is never asked (" + calls.length + " requests)");
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
