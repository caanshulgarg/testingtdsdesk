// node run_receivable_buckets.js - review of 02-Oct-2026: Note 10's ageing and MIS's Receivables buckets added up to
// about 1.61 crore against receivables of 1,11,85,854; the 13-week forecast expected 1,57,19,111.14 in the week of
// 01-Apr-2026. Receipts on account and advances are now set against each party's oldest bills first (MIS.netOpen, one
// function for the ageing and the forecast), so a party's buckets and its "not bill-wise" amount add up to its ledger
// balance, and what is expected from it never exceeds that balance. Runs the built app's code on made-up books.
const {load, HTML} = require("./harness");
const {ctx, x} = load(HTML, ["num", "r2", "INR", "esc", "ledNm", "ledEnt", "ledClean", "ledKey", "LED_IDX", "ledIdx", "ledUnder", "ledGroupPath", "LedMaster",
  "Audit", "Parties", "MIS", "FS", "TallyRead", "Books"]);
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
ctx.memoScope = f => f(); ctx.fmtDate = d => String(d || ""); ctx.tallyDate = d => String(d || ""); ctx.saveBooks = () => {}; ctx.LK = {cache: {}};
ctx.S.coId = "t"; ctx.S.companies = {t: {id: "t", name: "Test", pan: "AANFG3202D"}};
ctx.GSTR = {threeB(){ throw new Error("no GST here"); }};
ctx.TDS = {rows: () => [], salaryRows: () => []};
// Tally's sign: a debit is negative. A sale debits the customer; a receipt credits it
const sale = (id, date, party, amt, ref) => ({id, date, type: "Sales", no: ref, party, ent: [{l: party, a: -amt, b: [[ref, "New Ref", -amt]]}, {l: "Sales", a: amt}]});
const rcpt = (id, date, party, amt, bills) => ({id, date, type: "Receipt", no: id, party, ent: [{l: "ICICI Bank", a: -amt}, {l: party, a: amt, b: bills}]});
ctx.S.books = {cid: "t", meta: {from: "20250401", to: "20260331", bills: 1}, map: {},
  groups: {"Current Assets": "", "Sundry Debtors": "Current Assets", "Bank Accounts": "Current Assets", "Sales Accounts": ""},
  under: {"ONACC LTD": "Sundry Debtors", "ADV LTD": "Sundry Debtors", "NOBILLS LTD": "Sundry Debtors", "ICICI Bank": "Bank Accounts", "Sales": "Sales Accounts"},
  tb: {from: "20250401", to: "20260331", at: "2026-10-01T00:00:00Z", led: {"NOBILLS LTD": {open: -50000, close: 0, parent: "Sundry Debtors"}, "ICICI Bank": {open: -500000, close: 0, parent: "Bank Accounts"}}},
  vouchers: [
    // ONACC: three bills (10,000 in May, 20,000 in Aug, 30,000 in Feb) and 25,000 received on account: owed 35,000
    sale("s1", "20250510", "ONACC LTD", 10000, "ON/1"), sale("s2", "20250810", "ONACC LTD", 20000, "ON/2"), sale("s3", "20260210", "ONACC LTD", 30000, "ON/3"),
    rcpt("r1", "20260301", "ONACC LTD", 25000, [["", "On Account", 25000]]),
    // ADV: 40,000 received in advance (an Advance ref) and a bill of 30,000 later not set against it: a credit of 10,000
    rcpt("r2", "20250601", "ADV LTD", 40000, [["ADV/1", "Advance", 40000]]), sale("s4", "20260115", "ADV LTD", 30000, "AD/1"),
    // NOBILLS: an opening balance of 50,000 Dr and no bill-wise details at all; 5,000 received without a bill
    {id: "r3", date: "20251001", type: "Receipt", no: "r3", party: "NOBILLS LTD", ent: [{l: "ICICI Bank", a: -5000}, {l: "NOBILLS LTD", a: 5000}]}]};

const P = x.Parties.position("20260331"), A = x.MIS.ageing("20260331", "r", P.at);
const row = n => A.rows.find(p => p.party === n) || {}, tot = p => x.r2((p.nb || []).reduce((a, v) => a + v, 0) + (p.und || 0));
ok(A.rows.every(p => Math.abs(tot(p) - Math.max(0, -x.num(P.at[p.party]))) < 0.005), "every party's buckets plus not bill-wise = its ledger balance owed (" + A.rows.map(p => p.party + " " + tot(p)).join(", ") + ")");
const on = row("ONACC LTD");
ok(on.net === 35000 && on.open.map(b => b.ref + " " + b.left).join(", ") === "ON/2 5000, ON/3 30000" && on.und === 0, "on account: 25,000 clears the oldest bills first (ON/1 in full, 15,000 of ON/2): 5,000 of ON/2 and 30,000 of ON/3 left (" + (on.open || []).map(b => b.ref + " " + b.left) + ")");
const ad = row("ADV LTD");
ok(ad.net === -10000 && ad.advance === 10000 && ad.nb.every(v => v === 0) && ad.und === 0, "an advance larger than the bill: nothing owed, 10,000 shown as an advance (" + [ad.net, ad.advance] + ")");
const nb = row("NOBILLS LTD");
ok(nb.net === 45000 && nb.und === 45000 && nb.nb.every(v => v === 0), "no bill-wise details: the 45,000 balance is one not bill-wise amount (" + [nb.net, nb.und] + ")");
const bucketsAll = x.r2(A.sum.nb.reduce((a, v) => a + v, 0) + A.sum.und);
ok(bucketsAll === P.owed && P.owed === 80000, "in all: buckets " + A.sum.nb.join(" + ") + " + not bill-wise " + A.sum.und + " = 80,000 owed to you, the ledger balances (gross bills would have said " + A.sum.open + ")");
// the 13-week forecast: from the same open bills, never more than a party's balance
const pay = x.MIS.ageing("20260331", "p", P.at), fc = x.MIS.forecast("20260331", A, pay, null);
const fromParty = n => x.r2(fc.weeks.reduce((a, w) => a + w.items.filter(i => i.who === n && i.what === "Collections").reduce((s, i) => s + i.amt, 0), 0));
ok(fromParty("ONACC LTD") <= 35000 && fromParty("ONACC LTD") > 0 && fromParty("ADV LTD") === 0, "forecast: at most 35,000 from ONACC (" + fromParty("ONACC LTD") + "), nothing from ADV, whose balance is an advance");
ok(x.r2(fc.weeks.reduce((a, w) => a + w.inn, 0)) <= P.owed, "forecast: total collections expected " + x.r2(fc.weeks.reduce((a, w) => a + w.inn, 0)) + " never above the 80,000 owed");
// Note 10 in the accounts: the same ages, with not bill-wise on one line
const d = x.FS.build("2025"), html = x.FS.html(d), note = (html.match(/Outstanding by age[^<]*/g) || []).pop() || "";
ok(/not bill-wise 45,000\.00/.test(note) && /total 80,000\.00/.test(note), "Note 10: ages plus not bill-wise 45,000 add to 80,000 (" + note + ")");
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
