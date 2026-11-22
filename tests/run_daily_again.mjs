// node tests/run_daily_again.mjs - Daily Check phase 2's second check at Approve (app/src/screens/daily/again.js): the
// same builder on the books as the browser has them, with the app's own GSTR / GSTF (here gst3b.js, the same object the
// browser's legacy.js carries). Approve goes on only when the entry is exactly what last night made; anything changed
// (a line, the date, a ledger gone, the period closed, an entry or approval since) refuses: acceptance rule 4.
import { booksOf, gstOf, nightInput } from "../server/assistant-night/nightinput.js";
import { journals } from "../server/_shared/dailyjournals.js";
import * as E from "../server/_shared/gst3b.js";
import { gstRows, head, L, keepFiled } from "./daily2_books.mjs";

let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const { recheck, CHANGED, inputOf } = await import("../app/src/screens/daily/again.js");
const CASH = "GST ELECTRONIC CASH LEDGER", TODAY = "20261122";

const PL = { "Salary": "Indirect Expenses", "TDS on Salary 192": "Duties & Taxes", "Professional Tax Payable": "Duties & Taxes", "Salary Payable": "Provisions" };
const SHEET = [{ name: "Ravi Kumar", date: "2026-10-31", gross: 50000, tds: 2500, profTax: 200 }, { name: "Asha Verma", date: "2026-10-31", gross: 30000, tds: 0, profTax: 200 }];
const rowsOf = (o = {}) => keepFiled(gstRows(Object.assign({ ym: "202610", intra: 100000, inter: 50000, buyIntra: 40000, buyInter: 20000, rcm: 10000, rec: { cashLedger: CASH }, extraLedgers: PL, items: [{ key: "salary", item: "", ord: 0, data: SHEET, deleted: false }] }, o)));
// last night (the cloud) and the browser now: the same rows made into books twice, as each opens them
function lastNight(rows) { const b = booksOf(rows); return journals(nightInput(rows, b, { today: TODAY, bankRecs: [], inboxRecs: [], entryRecs: [], twob: [], gst: gstOf(rows, b, TODAY), prior: [], draftRecs: [] })).entries; }
async function browser(rows, e, o = {}) {
  const b = booksOf(JSON.parse(JSON.stringify(Object.assign({}, rows, { made: undefined }))));
  Object.assign(globalThis, { S: { books: b, coId: "c1", companies: { c1: rows.co } }, CO: () => rows.co, GSTR: E.GSTR, GSTF: E.GSTF, GSTSet: E.GSTSet, Books: E.Books, ledGroupPath: E.ledGroupPath });
  try { return await recheck(Object.assign({ client_id: "c1" }, e), Object.assign({ today: TODAY, ledgers: rows.ledgers.map((l) => l.name), drafts: [], prior: [], bookId: "b1", jobs: {} }, o)); }
  finally { delete globalThis.S; delete globalThis.CO; delete globalThis.GSTR; delete globalThis.GSTF; delete globalThis.GSTSet; delete globalThis.Books; delete globalThis.ledGroupPath; }
}
const rows = rowsOf(), night = lastNight(rows), so = night.find((e) => e.source === "gst_setoff"), pay = night.find((e) => e.source === "payroll");
ok(so && pay && so.ready && pay.ready, "last night: a ready set-off and a ready payroll journal");
ok(await browser(rows, so) === "" && await browser(rows, pay) === "", "Approve with nothing changed: goes on (the same journal both ways)");
{
  const bent = JSON.parse(JSON.stringify(so)); bent.voucher.lines[0].dr += 1; bent.voucher.lines[bent.voucher.lines.length - 1].cr += 1;
  ok(await browser(rows, bent) === CHANGED, "a line not what the books give now (still balanced): Changed since last night");
  const moved = JSON.parse(JSON.stringify(pay)); moved.voucher.date = "20261030";
  ok(await browser(rows, moved) === CHANGED, "another date: Changed since last night");
}
{
  // since last night: a sale added to October (the 3B moves), the salary sheet edited, a ledger removed, the period closed
  const r1 = rowsOf(); r1.heads.push(head("late", "2026-10-28", "Sales", "Sample Retail", { gstin: "07BBBBB1111B1Z1", pos: "Delhi" })); [["Sample Retail", -11800], ["Sales", 10000], ["CGST OUTPUT", 900], ["SGST OUTPUT", 900]].forEach(([l, a]) => r1.lines.push(L("late", l, a)));
  ok(await browser(r1, so) === CHANGED, "a sale added to October since: the set-off is refused");
  ok(await browser(rowsOf({ items: [{ key: "salary", item: "", ord: 0, data: [SHEET[0], Object.assign({}, SHEET[1], { gross: 31000 })], deleted: false }] }), pay) === CHANGED, "the salary sheet edited since: the payroll is refused");
  ok(await browser(rowsOf({ drop: ["Salary Payable"] }), pay) === CHANGED, "a ledger gone from Tally since: refused");
  ok(await browser(rowsOf({ closed: { to: "2026-10-31" } }), pay) === CHANGED, "the period closed since: refused");
  const r2 = rowsOf(); r2.heads.push(head("pb", "2026-10-31", "Journal", "")); [["Salary", -80000], ["Salary Payable", 80000]].forEach(([l, a]) => r2.lines.push(L("pb", l, a)));
  ok(await browser(r2, pay) === CHANGED, "the salary booked by hand since: refused (never twice)");
}
{
  ok(/Already approved/.test(await browser(rows, pay, { drafts: [{ id: "dc-1", dedupe: pay.dedupe, state: "sent", job: "66666666-6666-4666-8666-666666666666" }], jobs: { "66666666-6666-4666-8666-666666666666": { status: "taken" } } })), "approved already (its posting on its way): refused, said so");
  ok(await browser(rows, pay, { drafts: [{ id: "dc-1", dedupe: pay.dedupe, state: "posting" }] }) === "", "final review 1: a draft saying posting with no job: not proof, may be approved again (the bridge checks Tally for FinCom's id first)");
  const hAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
  ok(/Already approved/.test(await browser(rows, pay, { drafts: [{ id: "dc-1", dedupe: pay.dedupe, state: "posted", results: { "dc-1": { ok: true, at: hAgo(2) } } }] })), "last fix: says posted (no voucher id), 2 hours: pending, refused");
  ok(/not confirmed there/.test(await browser(rows, pay, { drafts: [{ id: "dc-1", dedupe: pay.dedupe, state: "posted", results: { "dc-1": { ok: true, at: hAgo(26) } } }] })), "last fix: 26 hours: not confirmed in Tally, refused (Needs you)");
  ok(/Already approved/.test(await browser(rows, pay, { drafts: [{ id: "dc-1", dedupe: pay.dedupe, state: "posted", results: { "dc-1": { ok: true, tallyId: "88", at: hAgo(40) } } }] })), "last fix: its own result with Tally's voucher id: posted, refused");
  ok(await browser(rows, pay, { drafts: [{ id: "dc-1", dedupe: pay.dedupe, state: "failed" }] }) === "", "its own earlier post that Tally refused: may be approved again");
  ok(/not the books last night read/.test(await browser(rows, so, { bookId: "b2" })), "low: other books open here (a client's books split by year): refused");
  ok(/Already approved/.test(await browser(rows, pay, { drafts: [{ id: "dc-1", dedupe: pay.dedupe, state: "sent", job: "11111111-1111-4111-8111-111111111111" }], jobs: { "11111111-1111-4111-8111-111111111111": { status: "waiting" } } })), "N4: queued and still waiting: approved already");
  ok(await browser(rows, pay, { drafts: [{ id: "dc-1", dedupe: pay.dedupe, state: "sent", job: "11111111-1111-4111-8111-111111111111" }], jobs: { "11111111-1111-4111-8111-111111111111": { status: "failed" } } }) === "", "N4: queued and the queue's posting failed: the draft counts as failed, offered again");
  const r3 = rowsOf(); r3.heads.push(head("tag", "2026-11-25", "Journal", "", { narration: "Salary | TDSDesk:" + pay.work_ref })); [["Salary", -1], ["Salary Payable", 1]].forEach(([l, a]) => r3.lines.push(L("tag", l, a)));
  ok(await browser(r3, pay) === CHANGED, "posted already (its id in Tally): refused");
}
{
  const inp = (() => { const b = booksOf(rows); globalThis.S = { books: b }; globalThis.CO = () => rows.co; globalThis.GSTR = E.GSTR; globalThis.GSTF = E.GSTF; try { return inputOf("c1", { today: TODAY, ledgers: [], drafts: [{ id: "x-1", dedupe: "a" }, { id: "dc-2", dedupe: "b", state: "posted" }] }); } finally { delete globalThis.S; delete globalThis.CO; delete globalThis.GSTR; delete globalThis.GSTF; } })();
  ok(inp.drafts.length === 1 && inp.drafts[0].dedupe === "b" && inp.gst.length === 1, "the browser's input: only Daily Check's own drafts; the app's 3B for the filed month");
}
console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fails ? 1 : 0);
