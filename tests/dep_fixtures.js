// Made-up fixed-asset books for the depreciation tests (src/js/80-assets.js, FAR). Every name and figure is invented; the
// four books are shaped like the four real patterns seen on staging (read-only, 14-Oct-2026):
//   A. asset-wise ledgers under sub-groups that carry the income-tax rate ("Plant & Machionary @ 15%", "Computer &
//      Laptops 40%"), accumulated depreciation per block ("Provision for Dep on P&M @15%", "Accumulated Depreciation-
//      Computers") kept as ledgers under Fixed Assets; a purchase and a sale in the year
//   B. accumulated depreciation per asset ("Accumulated Dep for Car"), plain groups, depreciation booked by a journal;
//      a furniture ledger with no accumulated depreciation at all
//   C. intangibles with the rate in the group ("Intangible Assets @25%") and software
//   D. only opening balances: a building and land straight under Fixed Assets, depreciation credited to the asset itself
// The shape is FAR.propose's input: ledgers with their group path (parent first, "Fixed Assets" last) and the opening
// (Dr positive, at 1 April 2025); vouchers of the year with Dr positive amounts.
const fs = require("fs"), path = require("path"), vm = require("vm");
function loadFAR(){
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "js", "80-assets.js"), "utf8");
  const ctx = {console, Math, JSON, Date, Intl, Number, String, Array, Object, Set, Map, RegExp, isFinite, parseFloat};
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx, {filename: "80-assets.js"});
  return ctx.FAR;
}
const FA = "Fixed Assets";
const L = (l, groups, open) => ({l, path: groups.concat([FA]), open});
const V = (id, date, type, ent) => ({id, date, no: id, type, ent: ent.map(([l, a]) => ({l, a}))});
const books = {
  A: {fy: "2025", ledgers: [
      L("AC - Hitachi", ["Plant & Machionary @ 15%"], 45000), L("Edge Binding Machine", ["Plant & Machionary @ 15%"], 300000),
      L("HP Laptop", ["Computer & Laptops 40%"], 52000),
      L("Provision for Dep on P&M @15%", [], -110000), L("Accumulated Depreciation- Computers", [], -20000)],
    vouchers: [
      V("A1", "2025-11-20", "Purchase", [["Edge Binding Machine", 150000], ["Input IGST", 27000], ["Sharma Machines", -177000]]),
      V("A2", "2026-02-10", "Receipt", [["HDFC Bank", 18000], ["HP Laptop", -18000]]),
      V("A0", "2025-03-31", "Journal", [["Depreciation", 1000], ["Provision for Dep on P&M @15%", -1000]])]},     // last year's: not in this year
  B: {fy: "2025", ledgers: [L("CAR", ["Vehicles"], 900000), L("Accumulated Dep for Car", [], -300000), L("Office Furniture", ["Furniture & Fixtures"], 120000)],
    vouchers: [V("B1", "2026-03-31", "Journal", [["Depreciation", 75000], ["Accumulated Dep for Car", -75000]])]},
  C: {fy: "2025", ledgers: [L("Trademark", ["Intangible Assets @25%"], 40000), L("Tally ERP Licence", ["Software"], 18000)], vouchers: []},
  D: {fy: "2025", ledgers: [L("Office Building", [], 2500000), L("Land at Noida", [], 1000000)],
    vouchers: [V("D1", "2026-03-31", "Journal", [["Depreciation", 125000], ["Office Building", -125000]])]},
};

// the register worked by hand in run_depreciation.js (part 3): a company, straight line, residual 5%, FY 2025-26
function handRegister(){
  return {v: 1, fy: "2025", kind: "company", settings: {method: "SLM", residualPct: 5, dtRate: 25.168}, ok: {},
    assets: [
      {id: "L:Edge Binding Machine", ledger: "Edge Binding Machine", group: "Plant & Machionary @ 15%", cls: "pm_general", clsSure: true, block: "pm15", blockSure: true, typedOpen: true, openGross: 300000, openAcc: 60000, putToUse: "2021-04-01", bookOpen: 300000,
        adds: [{key: "A1|0", date: "2025-11-20", amount: 150000, kind: "add", putToUse: "2025-11-20", sure: true}], moves: []},
      {id: "L:HP Laptop", ledger: "HP Laptop", group: "Computer & Laptops 40%", cls: "computer_eud", clsSure: true, block: "pm40", blockSure: true, typedOpen: true, openGross: 52000, openAcc: 20000, putToUse: "2024-04-01", bookOpen: 52000,
        adds: [], moves: [{key: "A2|1", date: "2026-02-10", amount: 18000, kind: "sale", sale: 18000, sure: true}]},
      {id: "L:AC - Hitachi", ledger: "AC - Hitachi", group: "Plant & Machionary @ 15%", cls: "office", clsSure: true, block: "pm15", blockSure: true, typedOpen: true, openGross: 45000, openAcc: 42750, putToUse: "2019-04-01", bookOpen: 45000, adds: [], moves: []}],
    accDep: [{ledger: "Provision for Dep on P&M @15%", open: 102750, match: {kind: "group", group: "Plant & Machionary @ 15%"}, booked: 0, byHand: true},
      {ledger: "Accumulated Depreciation- Computers", open: 20000, match: {kind: "group", group: "Computer & Laptops 40%"}, booked: 0, byHand: true}],
    blocks: {pm15: {open: 210000}, pm40: {open: 25000}}, depLedger: "Depreciation"};
}
module.exports = {loadFAR, books, handRegister};
