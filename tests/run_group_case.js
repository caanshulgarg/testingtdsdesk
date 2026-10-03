// node run_group_case.js - Tally's group names matched without regard to capital letters (02-Oct-2026: Tally names the
// group "Cash-in-hand", FinCom's lists "Cash-in-Hand"). The made-up books (tests/fixtures/books) are read twice: as Tally
// wrote them, and with the groups spelt in other capitals ("Cash-in-hand", "sundry debtors", "INDIRECT EXPENSES",
// "bank accounts", "capital account", Tally's flags kept under "employee benefit expenses"), a ledger's group sometimes
// in one spelling and the group list in another. Every report must come out the same: the MIS (profit and loss, the cash
// flow, receivables), the accounts (FS), the audit's cash and debtor tests, the ledger check's group chain, the bank
// test of the ledger master, the year's openings (TallyRead), and Look up's order of groups.
const fs = require("fs"), path = require("path"), {load, openBlob, HTML, FIXTURE_DIR} = require("./harness");
const CACHE = (() => { const h = require("./harness"); if (!h.FIXTURE) require("child_process").execFileSync(process.execPath, [path.join(__dirname, "fixture_cache.js"), h.FIXTURE_CACHE], {stdio: "inherit"}); return h.FIXTURE_CACHE; })();
const NAMES = ["num", "r2", "xesc", "esc", "MONTHS", "fmtDate", "tallyDate", "STATE_CODES", "RULE_DEFAULTS", "Books", "LedMaster", "Audit", "MIS", "Parties", "FS", "TDS", "Certs", "TallyRead", "LedCheck", "Ledgers", "GSTR", "GSTAdv", "GSTRev", "GSTAmend", "GST2B", "INR", "NORM_CACHE", "normName", "normNameRaw", "nameSim", "GSTSet", "GSTF", "GSTQ"];
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const RENAME = {"Cash-in-Hand": "Cash-in-hand", "Sundry Debtors": "sundry debtors", "Indirect Expenses": "INDIRECT EXPENSES", "Bank Accounts": "bank accounts", "Capital Account": "capital account", "Sundry Creditors": "Sundry creditors"};
const odd = g => RENAME[g] || g;
async function books(spell){
  const {ctx, x} = load(HTML, NAMES);
  const b = JSON.parse(fs.readFileSync(CACHE, "utf8"));
  const ms = await x.Books.importMasters(await openBlob(path.join(FIXTURE_DIR, "Master.xml")));
  let groups = ms.groups, under = ms.under, groupInfo = ms.groupInfo;
  if (spell){
    // the group list in Tally's other spelling; each ledger's group: every other ledger keeps the first spelling
    groups = {}; Object.entries(ms.groups).forEach(([g, p]) => { groups[odd(g)] = p ? odd(p) : p; });
    under = {}; Object.entries(ms.under).forEach(([l, g], i) => { under[l] = l === "Cash" ? g : l === "Quillfeather Weddings LLP" ? odd(g) : i % 2 ? odd(g) : g; });
    groupInfo = {}; Object.entries(ms.groupInfo).forEach(([g, v]) => { groupInfo[g === "Employee Benefit Expenses" ? "employee benefit expenses" : odd(g)] = v; });
  }
  Object.assign(b, {ledInfo: ms.info, under, groups, groupInfo, gstins: ms.gstins, pans: ms.pans, states: ms.states, challans: [], alloc: {}});
  b.map = x.Books.mapLedgers(b.vouchers, {}); ctx.S.books = b; ctx.S.coId = "t";
  ctx.CO = () => ({name: "Larkspur Fixture Events Private Limited", gstin: "07AAGCL4827M1Z3"});
  x.LedMaster.refresh(b);
  return {ctx, x, b};
}
(async () => {
  const A = await books(false), Z = await books(true);
  const zb = Z.b;
  ok(zb.under["Cash"] === "Cash-in-Hand" && zb.groups["Cash-in-hand"] != null && zb.groups["Cash-in-Hand"] == null, "the odd books: Cash under \"Cash-in-Hand\", the group list has \"Cash-in-hand\"");
  ok(Object.values(zb.under).includes("sundry debtors") && zb.groups["sundry debtors"] != null, "the odd books: \"sundry debtors\" in the group list and as some customers' group");

  console.log("each test of a group");
  ok(Z.x.Audit.isCash("Cash") && Z.x.Audit.isBankL("Tamarind Urban Bank - CA 0042") && Z.x.Audit.isDebtor("Quillfeather Weddings LLP") && Z.x.Audit.isDebtor("Brindle Corporate Travels"), "Audit: cash, bank and customers found under \"Cash-in-hand\", \"bank accounts\", \"sundry debtors\"");
  ok(Z.x.LedMaster.bankByGroup("Cash", {group: "Cash-in-Hand"}) && Z.x.LedMaster.bankByGroup("Cash", {group: "cash-in-hand"}), "LedMaster.bankByGroup: \"Cash-in-Hand\" and \"cash-in-hand\" are bank and cash groups");
  ok(Z.x.LedCheck.chain(zb, "Cash").join(" > ") === "Cash-in-Hand > Current Assets", "LedCheck.chain walks up from \"Cash-in-Hand\" through the list's \"Cash-in-hand\": " + Z.x.LedCheck.chain(zb, "Cash").join(" > "));
  ok(Z.x.TallyRead.primaryOf(zb, "Travelling Expenses").toLowerCase() === "indirect expenses" && Z.x.TallyRead.primaryOf(zb, "Cash") === "Current Assets" && Z.x.TallyRead.NOMINAL.map(g => g.toLowerCase()).includes(Z.x.TallyRead.primaryOf(zb, "Sale of Decor Goods").toLowerCase()), "TallyRead.primaryOf: up through the list's spelling to the primary group, which counts as income or expense in any capitals");
  ok(Z.x.MIS.flowHead("Quillfeather Weddings LLP")[1] === "Received from customers" && Z.x.MIS.flowHead("Share Capital").join() === "fin,Capital and drawings" && Z.x.MIS.flowHead("Travelling Expenses")[1] === "Expenses paid",
    "MIS.flowHead: \"sundry debtors\", \"capital account\", \"INDIRECT EXPENSES\" read as Tally's groups");
  ok(Z.x.MIS.flowHead("Devika Larkspur - Loan").slice(0, 2).join() === "fin,Partners' accounts" && /^partner:/.test(Z.x.MIS.flowHead("Devika Larkspur - Loan")[2]) && Z.x.MIS.flowHead("Salary Payable").join() === "op,Salaries and staff,name" && Z.x.MIS.flowHead("ESI Payable - Employees Share").join() === "op,Other receipts and payments",
    "MIS.flowHead (round 4): the partner match finds the Capital Account ledger under \"capital account\"; Salary Payable by its name under Current Liabilities; ESI by its sub-group");

  console.log("the reports come out the same");
  const run = X => { const r = X.x.MIS.run("20250401", "20260331", "test"); return {sales: r.sales.total, heads: Object.fromEntries(Object.entries(r.pl.heads).map(([k, v]) => [k, v.t])), pbt: r.pl.pbt.t, recv: r.recv.sum, pay: r.pay.sum,
    cash: r.p2.cash.rows.map(z => [z.sec, z.lab, z.t]), net: r.p2.cash.net, ties: r.p2.cash.ties, bal: r.balances.cash.concat(r.balances.bank)}; };
  const ra = run(A), rz = run(Z);
  ok(JSON.stringify(ra.heads) === JSON.stringify(rz.heads) && ra.pbt === rz.pbt && ra.sales === rz.sales, "MIS profit and loss the same (employee costs from \"employee benefit expenses\"'s flags): PBT " + rz.pbt);
  ok(JSON.stringify(ra.cash) === JSON.stringify(rz.cash) && rz.net === 38050 && rz.ties, "MIS cash flow the same, line by line; net 38,050, opening + change = closing");
  ok(JSON.stringify(ra.recv) === JSON.stringify(rz.recv) && JSON.stringify(ra.pay) === JSON.stringify(rz.pay), "MIS receivables and payables the same");
  ok(JSON.stringify(ra.bal) === JSON.stringify(rz.bal) && rz.bal.some(z => z[0] === "Cash"), "MIS cash and bank balances the same, Cash among them");
  const fa = A.x.FS.build("2025"), fz = Z.x.FS.build("2025");
  ok(!fz.error && JSON.stringify(fa.put) === JSON.stringify(fz.put) && fz.put.cash === 231750 && fz.put.tr === 718200, "FS: every line of the balance sheet the same; cash 2,31,750, trade receivables 7,18,200");
  ok(fa.pbt === fz.pbt && JSON.stringify(fa.pl) === JSON.stringify(fz.pl), "FS: the profit and loss the same");

  console.log("lists");
  // Look up's trial balance: groups in Tally's order whatever their capitals (LK.tbShape)
  const {x: L} = load(HTML, ["num", "r2", "LK"]);
  const sh = L.LK.tbShape({rows: [{l: "a", top: "INDIRECT EXPENSES", bal: 1}, {l: "b", top: "capital account", bal: -2}, {l: "c", top: "Current assets", bal: 1}], src: "cloud"});
  ok(sh.groups.map(g => g.g).join(",") === "capital account,Current assets,INDIRECT EXPENSES", "Look up: groups in Tally's order in any capitals (" + sh.groups.map(g => g.g).join(", ") + ")");
  console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
