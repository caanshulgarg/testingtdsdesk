// node tests/run_dailyjournals.mjs - Daily Check phase 2's builders (server/_shared/dailyjournals.js) on made-up books,
// through the same path as the night (gst-run's engine books, nightinput's input, the app's own GSTR.threeB and
// GSTF.journal): the GST set-off, the payroll journal, the salary payments, the monthly entries, the trust gate.
// Each: matches, near misses, ties, already in the books or approved, closed periods, the owner's edge cases (a zero tax
// month, more credit notes than sales, reverse charge paid in cash only, interest and late fee, rounding, an employee
// with no TDS, a mid-month joiner, a missing ledger) and the same night twice. Every name, number and GSTIN is invented.
import { booksOf, gstOf, nightInput } from "../server/assistant-night/nightinput.js";
import { run } from "../server/_shared/nightchecks.js";
import * as J from "../server/_shared/dailyjournals.js";
import * as E from "../server/_shared/gst3b.js";
import * as NC from "../server/_shared/nightchecks.js";
import { gstRows, head, L, keepFiled } from "./daily2_books.mjs";

let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const P = (x) => Math.round((Number(x) || 0) * 100);
const drcr = (e) => P(e.voucher.lines.reduce((s, l) => s + (l.dr || 0), 0)) === P(e.voucher.lines.reduce((s, l) => s + (l.cr || 0), 0));
const CASH = "GST ELECTRONIC CASH LEDGER";
// the night, for one client: the input as nightinput makes it, then the journals
function night(rows, today = "20261122", x = {}) {
  if (!x.noKeep) keepFiled(rows, today);      // the 3B kept as filed (review N3), unless the case is about not keeping it
  const b = booksOf(rows), gst = gstOf(rows, b, today);
  // the cloud's queue: one posting still running (a draft with it is on its way), one done with dc-ok posted
  const jobs = { "44444444-4444-4444-8444-444444444444": { status: "running", results: [] }, "55555555-5555-4555-8555-555555555555": { status: "done", results: [{ id: "dc-ok", ok: true }] } };
  const inp = nightInput(rows, b, Object.assign({ today, bankRecs: [], inboxRecs: [], entryRecs: [], twob: [], gst, prior: [], jobs, draftRecs: (rows.items || []).filter((r) => r.key === "asstEntries") }, x));
  return { inp, out: J.journals(inp), gst };
}
const one = (r, kind) => r.out.findings.filter((f) => f.kind === kind);
const entry = (r, src) => r.out.entries.filter((e) => e.source === src);
const line = (e, l) => e.voucher.lines.find((x) => x.ledger === l) || {};

console.log("1. the GST set-off journal");
const base = { ym: "202610", intra: 100000, inter: 50000, buyIntra: 40000, buyInter: 20000, rcm: 10000, rec: { cashLedger: CASH } };
{
  const r = night(gstRows(base)), e = entry(r, "gst_setoff")[0], f = one(r, "setoff_due")[0];
  ok(e && e.ready && f.state === "resolved", "a filed month: a ready set-off journal");
  ok(e && drcr(e) && e.checks.every((c) => c.ok), "Dr = Cr to the paisa, every check passed: " + (e ? e.checks.map((c) => c.k).join(", ") : ""));
  ok(e && line(e, "CGST OUTPUT").dr === 9000 && line(e, "CGST INPUT").cr === 3600 && line(e, "IGST INPUT").cr === 5400 && line(e, CASH).cr === 16200, "output tax debited, input tax and the cash ledger credited, the client's own ledger names");
  ok(e && line(e, "IGST RCM OUTPUT").dr === 1800, "reverse charge debited to its payable ledger, paid in cash");
  ok(e && e.voucher.date === "20261120" && e.voucher.type === "Journal", "dated the 3B's filing date, a Journal");
  ok(e && e.evidence.some((x) => /CGST tax ₹9,000 = credit ₹3,600 \+ cash ₹5,400/.test(x.label)) && e.evidence.some((x) => /filed 20-Nov/.test(x.label)), "the trace: each head, the credit used and the cash; the 3B filed");
  ok(e && e.checks.find((c) => c.k === "twoways").ok && e.checks.find((c) => c.k === "setoff").ok, "worked out two ways (the plain set-off agrees) and in the legal order");
  const r2 = night(gstRows(base));
  ok(JSON.stringify(r2.out) === JSON.stringify(r.out), "the same night twice: the same findings and entries");
}
{
  // (the owner, 23-Nov-2026) an export with payment of IGST (3.1(b)): its IGST 9,000 is set off and paid with 3.1(a)'s
  // (sections 49 and 49A, rule 88A): IGST 18,000 = IGST credit 5,400 + cash 12,600; CGST and SGST 5,400 each in cash
  const exp = { day: 11, type: "Export Sales", party: "Overseas Buyer Co", lines: [["Overseas Buyer Co", -59000], ["Sales", 50000], ["IGST OUTPUT", 9000]], head: { gstin: "", pos: "" } };
  const r = night(gstRows(Object.assign({}, base, { more: [exp] }))), e = entry(r, "gst_setoff")[0], m = r.gst[0];
  ok(m && m.t.zero && m.t.zero.igst === 9000, "the month's 3.1(b) carries the export's IGST 9,000 to the night (" + JSON.stringify(m && m.t.zero) + ")");
  ok(e && e.ready && e.checks.every((c) => c.ok), "3.1(b) IGST: a ready set-off journal, every check passed (" + (e ? e.checks.filter((c) => !c.ok).map((c) => c.k + ": " + c.why).join("; ") : one(r, "setoff_due").map((f) => f.facts.title).join("; ")) + ")");
  ok(e && line(e, "IGST OUTPUT").dr === 18000 && line(e, "IGST INPUT").cr === 5400 && line(e, CASH).cr === 25200, "IGST output 18,000 debited (3.1(a) 9,000 + 3.1(b) 9,000), IGST input 5,400 and cash 25,200 credited");
  ok(e && e.evidence.some((x) => /IGST tax ₹18,000 = credit ₹5,400 \+ cash ₹12,600/.test(x.label)), "the trace: IGST tax 18,000 = credit 5,400 + cash 12,600");
  // (review of ad4be74c3) a 3B kept as filed before 3.1(b)'s tax was in the set-off (its 6.1 had 3.1(a)'s IGST 9,000 only):
  // Needs you says why it differs now
  const old = night(gstRows(Object.assign({}, base, { more: [exp], rec: { cashLedger: CASH, snap: { pay: { use: { igst: { igst: 5400 } }, cash: { igst: 3600, cgst: 5400, sgst: 5400 }, rcmCash: {}, due: { igst: 9000, cgst: 5400, sgst: 5400, cess: 0 } } } } })));
  const tt = (one(old, "setoff_due")[0] || { facts: {} }).facts.title || "";
  ok(!entry(old, "gst_setoff").length && /3\.1\(b\)/.test(tt) && /before/.test(tt), "kept as filed before 3.1(b)'s IGST joined the set-off: Needs you says so (" + tt + ")");
}
{
  const r = night(gstRows(Object.assign({}, base, { rec: {} })));
  ok(!entry(r, "gst_setoff").length && one(r, "setoff_due")[0].state === "you" && /Ledgers in Tally|Not in Tally/.test(one(r, "setoff_due")[0].facts.title), "a missing ledger (the cash ledger not in Tally): Needs you, no entry");
}
{
  const r = night(gstRows({ ym: "202610", rec: { cashLedger: CASH } }));
  ok(!entry(r, "gst_setoff").length && !one(r, "setoff_due").length, "a zero tax month: nothing to set off, nothing shown");
}
{
  const r = night(gstRows({ ym: "202610", intra: 10000, credit: 30000, buyIntra: 5000, rec: { cashLedger: CASH } }));
  const m = r.gst[0];
  ok(m && m.t.pay.carry.neg && m.t.pay.carry.neg.cgst > 0 && !entry(r, "gst_setoff").length && !one(r, "setoff_due").length, "more credit notes than sales (a negative liability): no tax to pay, no journal");
  ok(J.setoffMin(m.t.net, m.t.rcmOut, m.t.netItc, m.t.opening).cash === 0, "the independent least cash: a negative liability is no tax");
}
{
  const r = night(gstRows({ ym: "202610", rcm: 10000, rec: { cashLedger: CASH } })), e = entry(r, "gst_setoff")[0];
  ok(e && e.ready && e.voucher.lines.length === 2 && line(e, "IGST RCM OUTPUT").dr === 1800 && line(e, CASH).cr === 1800, "reverse charge only, paid in cash only: Dr the payable, Cr the cash ledger");
}
{
  // filed 15 days late: interest and a late fee are due. Worked out here only: Needs you; the portal's figures kept: in the journal
  const late = Object.assign({}, base, { filed: "2026-12-05" });
  const r = night(gstRows(late), "20261222");
  ok(!entry(r, "gst_setoff").length && /interest/i.test(one(r, "setoff_due")[0].facts.title), "interest worked out but not confirmed: Needs you (the portal's figure first)");
  const r2 = night(gstRows(Object.assign({}, late, { rec: { cashLedger: CASH, portalInt: 106.52, portalFee3: 750 } })), "20261222"), e = entry(r2, "gst_setoff")[0];
  ok(e && e.ready && line(e, "Interest on GST").dr === 106.52 && line(e, "GST Late Fee").dr === 750 && line(e, CASH).cr === 16200 + 106.52 + 750, "interest and late fee from the portal: debited to their ledgers, paid from the cash ledger");
  ok(e && drcr(e) && e.evidence.some((x) => /Interest ₹106.52/.test(x.label)), "with interest: Dr = Cr, its figure in the trace");
  const r3 = night(gstRows(Object.assign({}, late, { rec: { cashLedger: CASH, portalInt: 106.52, portalFee3: 0 }, drop: ["Interest on GST"] })), "20261222");
  ok(!entry(r3, "gst_setoff").length && one(r3, "ledger_pick").some((f) => f.key === "led:gstInterest"), "no interest ledger: Needs you, pick a ledger");
}
{
  // rounding: paise in the tax
  const r = night(gstRows(Object.assign({}, base, { intra: 100000.55, buyIntra: 33333.33 }))), e = entry(r, "gst_setoff")[0];
  ok(e && e.ready && drcr(e) && e.checks.find((c) => c.k === "twoways").ok, "paise in the tax: still Dr = Cr and both ways agree");
}
{
  // already in the books: the same journal posted in November
  const done = { day: 20, type: "Journal", lines: [["IGST OUTPUT", -9000], ["CGST OUTPUT", -9000], ["SGST OUTPUT", -9000], ["IGST RCM OUTPUT", -1800], ["IGST INPUT", 5400], ["CGST INPUT", 3600], ["SGST INPUT", 3600], [CASH, 16200]] };
  const rows = gstRows(base), d = (x) => Object.assign({}, x);
  const add = (rw, x, ym) => { const g = "x" + rw.heads.length; rw.heads.push(head(g, ym + "-" + x.day, x.type, "")); x.lines.forEach(([l, a]) => rw.lines.push(L(g, l, a))); return rw; };
  const r = night(add(rows, d(done), "2026-11"));
  ok(!entry(r, "gst_setoff").length && !one(r, "setoff_due").length, "already in the books (the same lines): no entry");
  const other = { day: 18, type: "Journal", lines: [["CGST OUTPUT", -5000], ["CGST INPUT", 5000]] };
  const r2 = night(add(gstRows(base), other, "2026-11"));
  ok(!entry(r2, "gst_setoff").length && /may be Oct 2026's set-off/.test(one(r2, "setoff_exclude")[0].facts.title), "a different tax journal in the month after: Needs you (it may be this one), never a second journal");
  const tag = { day: 21, type: "Journal", lines: [["CGST OUTPUT", -1], [CASH, 1]] }, rw = add(gstRows(base), tag, "2026-11");
  rw.heads[rw.heads.length - 1].narration = "posted | TDSDesk:" + J.voucherId("setoff:07:202610");
  ok(!entry(night(rw), "gst_setoff").length && !one(night(rw), "setoff_due").length, "posted by Daily Check (its id in Tally's narration): no entry");
  const pend = gstRows(Object.assign({}, base, { items: [{ key: "asstEntries", item: "#dc-x", ord: 0, data: { id: "dc-x", dedupe: "setoff:07:202610", state: "sent", job: "44444444-4444-4444-8444-444444444444" }, deleted: false }] }));
  ok(!entry(night(pend), "gst_setoff").length, "approved and its posting still running: no entry");
  const okd = gstRows(Object.assign({}, base, { items: [{ key: "asstEntries", item: "#dc-ok", ord: 0, data: { id: "dc-ok", dedupe: "setoff:07:202610", state: "sent", job: "55555555-5555-4555-8555-555555555555" }, deleted: false }] }));
  ok(!entry(night(okd), "gst_setoff").length, "final review 1: the job reports this voucher ok (proof): no entry");
  const noproof = gstRows(Object.assign({}, base, { items: [{ key: "asstEntries", item: "#dc-x", ord: 0, data: { id: "dc-x", dedupe: "setoff:07:202610", state: "posted" }, deleted: false }] }));
  ok(!entry(night(noproof), "gst_setoff").length && one(night(noproof), "sent_check").length === 1, "last fix: a draft saying posted with no proof and no time: not confirmed (Needs you), never offered again silently");
  const D = (data) => gstRows(Object.assign({}, base, { items: [{ key: "asstEntries", item: "#dc-x", ord: 0, data: Object.assign({ id: "dc-x", dedupe: "setoff:07:202610" }, data), deleted: false }] }));
  const hAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const own = night(D({ state: "posted", results: { "dc-x": { ok: true, state: "posted", tallyId: "4417", at: hAgo(30) } } }));
  ok(!entry(own, "gst_setoff").length && !one(own, "setoff_due").length && !one(own, "sent_check").length, "last fix: posted straight to the bridge, its own result ok with Tally's voucher id: proof (posted)");
  const pnd = night(D({ state: "posted", results: { "dc-x": { ok: true, state: "posted", at: hAgo(2) } } }));
  ok(!entry(pnd, "gst_setoff").length && !one(pnd, "sent_check").length, "last fix: says posted, no voucher id, sent 2 hours ago: pending, never offered again");
  const at25 = hAgo(25), unc = night(D({ state: "posted", results: { "dc-x": { ok: true, state: "posted", at: at25 } } }));
  const sc = one(unc, "sent_check")[0];
  ok(!entry(unc, "gst_setoff").length && sc && sc.state === "you" && sc.candidates[0].t === "retry" && /not confirmed there after 24 hours/.test(sc.facts.title) && one(unc, "setoff_due")[0].facts.waits, "last fix: 25 hours and not confirmed: Needs you (Not confirmed in Tally), never back to ready");
  const again = night(D({ state: "posted", results: { "dc-x": { ok: true, state: "posted", at: at25 } } }), "20261122", { prior: [{ kind: "sent_check", key: sc.key, state: "resolved", evidence: [sc.candidates[0]] }] });
  ok(entry(again, "gst_setoff").length === 1, "last fix: the owner said it is not in Tally: the entry is made again (the bridge checks Tally for FinCom's id first)");
  ok(entry(night(D({ state: "failed", results: { "dc-x": { ok: false, msg: "refused" } } })), "gst_setoff").length === 1, "last fix: Tally refused it: offered again");
  const failed = gstRows(Object.assign({}, base, { items: [{ key: "asstEntries", item: "#dc-x", ord: 0, data: { id: "dc-x", dedupe: "setoff:07:202610", state: "failed" }, deleted: false }] }));
  ok(entry(night(failed), "gst_setoff").length === 1, "a draft Tally refused is not pending: the entry is made again");
}
{
  const r = night(gstRows(Object.assign({}, base, { closed: { to: "2026-11-30" } })));
  ok(!entry(r, "gst_setoff").length && /closed/i.test(one(r, "setoff_due")[0].facts.title), "a closed period: Needs you, no entry");
}
{
  const r = night(gstRows(Object.assign({}, base, { rec: { cashLedger: CASH, snap: { pay: { use: { igst: { igst: 1 } }, cash: {}, rcmCash: {} } } } })));
  ok(!entry(r, "gst_setoff").length && /changed since the 3B was filed/.test(one(r, "setoff_due")[0].facts.title), "the books changed since the 3B was kept as filed: Needs you");
}
{
  const rows = gstRows(base); rows.ledgers.find((l) => l.name === "CGST OUTPUT").parent = "Indirect Expenses";
  const r = night(rows);
  ok(!entry(r, "gst_setoff").length && /right group/.test(one(r, "setoff_due")[0].facts.title), "an output GST ledger outside Duties & Taxes: Needs you");
}
{
  const r = night(gstRows(Object.assign({}, base, { filed: "", rec: { cashLedger: CASH } })));
  ok(!one(r, "setoff_due").length, "a month not filed and not kept as filed: nothing yet");
}
{
  // the checker catches a journal that does not follow the 3B (a rupee moved from CGST to SGST input)
  const r = night(gstRows(base)), m = JSON.parse(JSON.stringify(r.gst[0]));
  m.journal.lines.find((l) => l.l === "CGST INPUT").cr -= 1; m.journal.lines.find((l) => l.l === "SGST INPUT").cr += 1;
  const x = J.setoffOne(m, r.inp, []);
  ok(!x.entry && /follow the 3B/.test(x.finding.facts.title), "a journal that does not follow the 3B to the paisa: Needs you, never ready");
  const m2 = JSON.parse(JSON.stringify(r.gst[0])); m2.journal.lines.find((l) => l.l === CASH).cr += 0.01; m2.journal.lines.find((l) => l.l === "CGST OUTPUT").dr += 0.01;
  ok(!J.setoffOne(m2, r.inp, []).entry, "the cash line a paisa out (still balanced): Needs you (exact, review L6)");
  const m3 = JSON.parse(JSON.stringify(r.gst[0])); m3.t.pay.use.igst.igst -= 1000; m3.t.pay.cash.igst += 1000;
  ok(!J.setoffOne(m3, r.inp, []).entry, "a 3B paying more cash than the law needs: Needs you");
  const bad = JSON.parse(JSON.stringify(m.t.pay)); bad.use.cgst.cgst -= 100; bad.use.cgst.igst = 0; bad.cash.cgst += 100;
  ok(/paid in cash while credit was left/.test(J.setoffLegal(bad, m.t.net, m.t.rcmOut, m.t.netItc, m.t.opening)), "the legal order: cash paid while credit was left is caught");
  const cross = JSON.parse(JSON.stringify(m.t.pay)); cross.use.cgst.sgst = 10;
  ok(/crossed/.test(J.setoffLegal(cross, m.t.net, m.t.rcmOut, m.t.netItc, m.t.opening)), "the legal order: CGST credit used for SGST is caught");
}

console.log("2. the set-off against the app's own (differential)");
{
  // the app's GSTR.setOff (server/_shared/gst3b.js) against the independent least cash (setoffMin, a search over the legal
  // allocations): the same cash to the paisa, and the app's allocation legal (49, 49A, 88A), on random months
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const amt = () => { const k = rnd(); return k < 0.15 ? 0 : k < 0.2 ? -Math.round(rnd() * 50000) / 100 : Math.round(rnd() * 5000000) / 100; };
  let same = 0, legal = 0, N = 3000;
  for (let i = 0; i < N; i++) {
    const L0 = { igst: amt(), cgst: amt(), sgst: amt(), cess: amt() }, Rc = { igst: rnd() < 0.3 ? amt() : 0, cgst: rnd() < 0.2 ? amt() : 0, sgst: 0, cess: 0 }; Rc.sgst = Rc.cgst;
    const C = { igst: amt(), cgst: amt(), sgst: amt(), cess: amt() }, O = { igst: rnd() < 0.3 ? amt() : 0, cgst: rnd() < 0.3 ? amt() : 0, sgst: rnd() < 0.3 ? amt() : 0, cess: 0 };
    const app = E.GSTR.setOff(L0, Rc, C, O), cash = ["igst", "cgst", "sgst", "cess"].reduce((s0, h) => s0 + P(app.cash[h]) - P(app.rcmCash[h]), 0);
    if (cash === J.setoffMin(L0, Rc, C, O).cash) same++; else if (same + 5 > i) console.log("    differs:", JSON.stringify({ L0, Rc, C, O }));
    if (!J.setoffLegal(app, L0, Rc, C, O)) legal++;
  }
  ok(same === N, "the app's cash equals the independent least cash on " + N + " random months, to the paisa (" + same + ")");
  ok(legal === N, "the app's set-off keeps the legal order on every one (" + legal + ")");
  // the independent method checked by brute force: every legal allocation of small whole amounts, the least cash found
  let bf = 0, BN = 300;
  for (let i = 0; i < BN; i++) {
    const v = () => Math.floor(rnd() * 5), L0 = { igst: v(), cgst: v(), sgst: v(), cess: 0 }, C = { igst: v(), cgst: v(), sgst: v(), cess: 0 };
    let best = Infinity;
    for (let ii = 0; ii <= Math.min(L0.igst, C.igst); ii++) for (let ic = 0; ic <= C.igst - ii; ic++) for (let is = 0; is <= C.igst - ii - ic; is++)
      for (let cc = 0; cc <= C.cgst; cc++) for (let ci = 0; ci <= C.cgst - cc; ci++) for (let ss = 0; ss <= C.sgst; ss++) for (let si = 0; si <= C.sgst - ss; si++) {
        if (ii + ci + si > L0.igst || ic + cc > L0.cgst || is + ss > L0.sgst) continue;
        const pay = { use: { igst: { igst: ii, cgst: ic, sgst: is }, cgst: { cgst: cc, igst: ci }, sgst: { sgst: ss, igst: si }, cess: { cess: 0 } },
          cash: { igst: L0.igst - ii - ci - si, cgst: L0.cgst - ic - cc, sgst: L0.sgst - is - ss, cess: 0 }, rcmCash: { igst: 0, cgst: 0, sgst: 0, cess: 0 } };
        if (J.setoffLegal(pay, L0, {}, C, {})) continue;
        best = Math.min(best, (pay.cash.igst + pay.cash.cgst + pay.cash.sgst) * 100);
      }
    if (best === J.setoffMin(L0, {}, C, {}).cash) bf++; else if (bf + 3 > i) console.log("    brute force differs:", JSON.stringify({ L0, C, best, min: J.setoffMin(L0, {}, C, {}) }));
  }
  ok(bf === BN, "the independent least cash equals a brute-force search over every legal allocation (" + bf + " of " + BN + " small months)");
  // the reviewer's case: CGST tax 100, IGST credit 100, CGST credit 100. Using the CGST credit first is illegal (49A)
  {
    const L0 = { igst: 0, cgst: 100, sgst: 0, cess: 0 }, C = { igst: 100, cgst: 100, sgst: 0, cess: 0 };
    const wrong = { use: { igst: { igst: 0, cgst: 0, sgst: 0 }, cgst: { cgst: 100, igst: 0 }, sgst: { sgst: 0, igst: 0 }, cess: { cess: 0 } }, cash: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, rcmCash: { igst: 0, cgst: 0, sgst: 0, cess: 0 } };
    const right = JSON.parse(JSON.stringify(wrong)); right.use.cgst.cgst = 0; right.use.igst.cgst = 100;
    ok(/49A/.test(J.setoffLegal(wrong, L0, {}, C, {})) && !J.setoffLegal(right, L0, {}, C, {}) && !J.setoffLegal(E.GSTR.setOff(L0, {}, C, {}), L0, {}, C, {}), "the reviewer's case: CGST credit used before the IGST credit is illegal; IGST credit first is legal, and so is the app's");
  }
  // and on the 3B of made-up books: the entry's total is the app's 3B credit used plus cash paid, exactly
  for (const o of [base, { ym: "202610", intra: 250000, buyInter: 300000, rec: { cashLedger: CASH } }, { ym: "202610", inter: 80000, buyIntra: 90000, rec: { cashLedger: CASH } }, Object.assign({}, base, { intra: 777777.77 })]) {
    const r = night(gstRows(o)), e = entry(r, "gst_setoff")[0], m = r.gst[0], p = m.t.pay;
    const want = ["igst", "cgst", "sgst", "cess"].reduce((s, h) => s + ["igst", "cgst", "sgst", "cess"].reduce((x, f) => x + P((p.use[f] || {})[h]), 0) + P(p.cash[h]), 0);
    ok(e && P(e.voucher.lines.reduce((s, l) => s + (l.dr || 0), 0)) === want, "3B of made-up books (" + JSON.stringify(Object.keys(o).filter((k) => o[k] && k !== "rec" && k !== "ym")) + "): the journal's total is the 3B's credit used + cash, exactly (" + (want / 100) + ")");
  }
}

console.log("3. the payroll journal");
const PL = { "Salary": "Indirect Expenses", "TDS on Salary 192": "Duties & Taxes", "Professional Tax Payable": "Duties & Taxes", "Salary Payable": "Provisions", "PF Payable": "Duties & Taxes", "ESI Payable": "Duties & Taxes" };
const sheet = [
  { name: "Ravi Kumar", date: "2026-10-31", gross: 50000, tds: 2500, profTax: 200 },
  { name: "Asha Verma", date: "2026-10-31", gross: 30000, tds: 0, profTax: 200 },            // no TDS
  { name: "New Joiner", date: "2026-10-31", gross: 12903.23, tds: 0, profTax: 0 },          // joined on 18-Oct: part of a month
];
const pay = (o = {}) => { const rw0 = gstRows({ ym: "202610", filed: "", extraLedgers: Object.assign({}, PL, o.ledgers || {}), drop: o.drop || [], closed: o.closed, items: [{ key: "salary", item: "", ord: 0, data: o.sheet || sheet, deleted: false }].concat(o.items || []) });
  const rw = rw0; if (o.groups) rw.groups.push({ name: "Employee Costs", parent: "Indirect Expenses" });
  (o.more || []).forEach((x, i) => { const g = "p" + i; rw.heads.push(head(g, x.date, x.type || "Journal", "")); x.lines.forEach(([l, a]) => rw.lines.push(L(g, l, a))); if (x.narr) rw.heads[rw.heads.length - 1].narration = x.narr; });
  return rw; };
{
  const r = night(pay()), e = entry(r, "payroll")[0];
  ok(e && e.ready && one(r, "payroll_due")[0].state === "resolved", "a month of the sheet: a ready payroll journal");
  ok(e && line(e, "Salary").dr === 92903.23 && line(e, "TDS on Salary 192").cr === 2500 && line(e, "Professional Tax Payable").cr === 400 && line(e, "Salary Payable").cr === 90003.23, "Dr salary (gross), Cr TDS, professional tax and salary payable (net)");
  ok(e && drcr(e) && e.checks.every((c) => c.ok) && e.voucher.date === "20261031", "Dr = Cr to the paisa, every check passed, dated the month's last day");
  ok(e && e.evidence.some((x) => /Asha Verma: ₹30,000 − ₹200 = ₹29,800/.test(x.label)) && e.evidence.some((x) => /New Joiner: ₹12,903.23 = ₹12,903.23/.test(x.label)), "the trace: each employee's gross, deductions and net (no TDS; a mid-month joiner as the sheet has it)");
  ok(JSON.stringify(night(pay()).out) === JSON.stringify(r.out), "the same night twice: the same");
}
{
  const rw = pay({ sheet: sheet.map((x, i) => i === 0 ? Object.assign({}, x, { net: 47300.01 }) : x) }), r = night(rw);
  ok(!entry(r, "payroll").length && /Ravi Kumar's gross/.test(one(r, "payroll_due")[0].facts.title), "a sheet whose gross is not net plus deductions (a paisa out): Needs you");
  const r2 = night(pay({ sheet: sheet.map((x, i) => i === 0 ? Object.assign({}, x, { net: 47300 }) : x) }));
  ok(entry(r2, "payroll").length === 1, "the same with the net right: ready");
  ok(J.payrollPlain(sheet.map((x, i) => i === 0 ? Object.assign({}, x, { net: 47300.01 }) : x)).bad === "Ravi Kumar", "the plain checker finds the same employee");
}
{
  const r = night(pay({ sheet: sheet.concat([{ name: "PF Person", date: "2026-10-31", gross: 20000, tds: 0, profTax: 200, pf: 1800, esi: 150 }]) })), e = entry(r, "payroll")[0];
  ok(e && line(e, "PF Payable").cr === 1800 && line(e, "ESI Payable").cr === 150 && drcr(e), "PF and ESI on the sheet: credited to their payables");
}
{
  ok(/surcharge/.test(one(night(pay({ sheet: [Object.assign({}, sheet[0], { surcharge: 250 })] })), "payroll_due")[0].facts.title), "surcharge on TDS: Needs you");
  ok(/twice/.test(one(night(pay({ sheet: sheet.concat([sheet[1]]) })), "payroll_due")[0].facts.title), "an employee twice on the sheet: Needs you");
}
{
  const r = night(pay({ drop: ["Salary Payable"] }));
  ok(!entry(r, "payroll").length && one(r, "payroll_due")[0].state === "you" && one(r, "ledger_pick").some((f) => f.key === "led:salaryPayable"), "a missing ledger (no salary payable): Needs you, pick a ledger");
  const r2 = night(pay({ ledgers: { "TDS Payable 192 Staff": "Duties & Taxes" } })), pk = one(r2, "ledger_pick").find((f) => f.key === "led:tds");
  ok(!entry(r2, "payroll").length && pk && pk.candidates.length === 2, "two TDS ledgers that could be salary's (a tie): never picked, both shown");
  const r3 = night(pay({ ledgers: { "TDS Payable 192 Staff": "Duties & Taxes" } }), "20261122", { prior: [{ kind: "ledger_pick", key: "led:tds", state: "resolved", evidence: [{ ledger: "TDS Payable 192 Staff" }] }] });
  ok(entry(r3, "payroll").length === 1 && line(entry(r3, "payroll")[0], "TDS Payable 192 Staff").cr === 2500, "the person picked one: the journal uses it");
  const r4 = night(pay({ ledgers: { "Salary Payable": "Indirect Expenses" } }));
  ok(!entry(r4, "payroll").length, "a salary payable outside current liabilities: no certain ledger, no entry");
}
{
  const booked = { date: "2026-10-31", lines: [["Salary", -92903.23], ["Salary Payable", 92903.23]] };
  ok(!entry(night(pay({ more: [booked] })), "payroll").length && !one(night(pay({ more: [booked] })), "payroll_due").length, "already booked in the books (same month, same kind, the same gross): no entry");
  const diff = { date: "2026-10-31", lines: [["Salary", -90000], ["HDFC Bank", 90000]], type: "Payment" };
  const r = night(pay({ more: [diff] }));
  ok(!entry(r, "payroll").length && /booked ₹90,000/.test(one(r, "payroll_due")[0].facts.title), "salary booked for another amount: Needs you, never a second journal");
  ok(!entry(night(pay({ items: [{ key: "asstEntries", item: "#dc-p", ord: 0, data: { id: "dc-p", dedupe: "payroll:202610", state: "posting", job: "44444444-4444-4444-8444-444444444444" }, deleted: false }] })), "payroll").length, "approved and its posting still running: no entry");
  const r5 = night(pay({ closed: { to: "2026-10-31" } }));
  ok(!entry(r5, "payroll").length && /closed/i.test(one(r5, "payroll_due")[0].facts.title), "a closed period: Needs you");
  ok(!one(night(pay(), "20261015"), "payroll_due").length, "the month not over yet: nothing");
}

console.log("4. salary payments from the bank");
{
  const stmt = { kind: "bank_stmt", id: "c1:s1", data: { id: "s1", acctId: "acc-1", acct: "XX2231", bank: "HDFC Bank", from: "2026-11-01", to: "2026-11-30" } };
  const rowsB = (rs) => [stmt, { kind: "bank_rows", id: "c1:s1:0", data: { rows: rs } }];
  const bl = (id, date, amt, name, narr) => ({ id, date, narr: narr || "NEFT/" + name.toUpperCase() + "/SAL", debit: amt, credit: 0, ledger: "", state: "attention", dec: { name, key: "neft:" + name.toLowerCase(), mode: "NEFT" } });
  const booked = { date: "2026-10-31", lines: [["Salary", -92903.23], ["TDS on Salary 192", 2500], ["Professional Tax Payable", 400], ["Salary Payable", 90003.23]] };
  const go = (rs, o = {}) => { const rw = pay(Object.assign({ more: [booked] }, o)); rw.co.bankAccounts = [{ id: "acc-1", ledger: "HDFC Bank", last4: "2231" }]; const b = booksOf(rw);
    const inp = nightInput(rw, b, { today: "20261122", bankRecs: rowsB(rs), inboxRecs: [], entryRecs: [], twob: [], gst: [], prior: [], draftRecs: [] }); return run(inp); };
  const res = go([bl(1, "2026-11-01", 47300, "Ravi Kumar"), bl(2, "2026-11-02", 29801.01, "Asha Verma"), bl(3, "2026-11-18", 12903.23, "New Joiner")]);
  const f = (row) => res.findings.find((x) => x.facts.row === String(row)), e1 = res.entries.find((e) => e.work_ref === "s1:1");
  ok(f(1).state === "resolved" && f(1).evidence[0].t === "salary" && e1 && e1.ready && e1.voucher.against === "Salary Payable", "an employee's pay (same name, net within ₹1, the month it pays): a ready bank entry against salary payable");
  ok(f(2).state === "you", "₹1.01 off the sheet's net: Needs you, never resolved");
  ok(f(3).state !== "resolved", "paid on the 18th: that month's pay, not October's; no sheet for it yet: not resolved");
  const nb = go([bl(1, "2026-11-01", 47300, "Ravi Kumar")], { more: [] });
  ok(nb.findings.find((x) => x.facts.row === "1").state === "you", "the payroll not booked yet: Needs you (salary payable would go negative)");
  const tw = go([bl(1, "2026-11-01", 47300, "Ravi Kumar")], { sheet: sheet.concat([Object.assign({}, sheet[0], { code: "E9" })]) });
  ok(tw.findings.find((x) => x.facts.row === "1").state === "you", "two employees of the same name: a tie, Needs you");
  const two = go([bl(1, "2026-11-01", 47300, "Ravi Kumar")], { ledgers: { "Outstanding Salary Payable": "Provisions" } });
  ok(two.findings.find((x) => x.facts.row === "1").state === "you", "two salary payable ledgers: not certain, Needs you");
}

console.log("5. monthly entries");
const RENT = (day, ym, amt = 45000) => ({ date: ym + "-" + day, lines: [["Rent", -amt], ["Sample Landlord", amt]], narr: "Rent " + ym });
const rec = (more, today = "20261122", o = {}) => night(pay(Object.assign({ more, sheet: [] }, o)), today);
{
  const r = rec([RENT("01", "2026-08"), RENT("01", "2026-09"), RENT("01", "2026-10")]), e = entry(r, "recurring")[0];
  ok(e && e.ready && e.voucher.date === "20261101" && line(e, "Rent").dr === 45000 && line(e, "Sample Landlord").cr === 45000, "rent on the 1st for three months, November's missing past the 6th: a ready entry dated 1-Nov");
  ok(e && e.evidence[0].label.includes("3 months in a row") && e.evidence.length === 4 && drcr(e), "the pattern as evidence, with the three entries");
  ok(!entry(rec([RENT("01", "2026-08"), RENT("01", "2026-09"), RENT("01", "2026-10")], "20261106"), "recurring").length, "not yet past the usual day plus 5: nothing");
  ok(!entry(rec([RENT("01", "2026-08"), RENT("01", "2026-09"), RENT("01", "2026-10"), RENT("01", "2026-11")]), "recurring").length, "November's is in the books: nothing");
  ok(!entry(rec([RENT("01", "2026-09"), RENT("01", "2026-10")]), "recurring").length, "only two months: no pattern");
  ok(!entry(rec([RENT("01", "2026-07"), RENT("01", "2026-08"), RENT("01", "2026-09")]), "recurring").length, "two months missed: the pattern is broken, nothing");
  const moved = rec([RENT("01", "2026-08", 45000), RENT("01", "2026-09", 45500), RENT("01", "2026-10", 45900)]);
  ok(!entry(moved, "recurring").length && one(moved, "recurring_due")[0].state === "you", "amounts within 2% but not the same: Needs you, never a guessed amount");
  const far = rec([RENT("01", "2026-08", 45000), RENT("01", "2026-09", 45000), RENT("01", "2026-10", 50000)]);
  ok(!entry(far, "recurring").length && !one(far, "recurring_due").length, "an amount outside 2%: no pattern, nothing");
  const other = rec([RENT("01", "2026-08"), RENT("01", "2026-09"), RENT("01", "2026-10"), { date: "2026-11-03", lines: [["Rent", -45000], ["Sample Supplier", 45000]] }]);
  ok(!entry(other, "recurring").length && /may be this month/.test(one(other, "recurring_due")[0].facts.title), "the same expense and amount booked another way this month: Needs you, never twice");
  const dep = (ym) => ({ date: ym, lines: [["Depreciation", -12000], ["Accumulated Depreciation", 12000]] });
  ok(!entry(rec([dep("2026-08-31"), dep("2026-09-30"), dep("2026-10-31")]), "recurring").length, "month-end depreciation: November's not due until 5-Dec");
  const de = entry(rec([dep("2026-08-31"), dep("2026-09-30"), dep("2026-10-31")], "20261206"), "recurring")[0];
  ok(de && de.ready && de.voucher.date === "20261130", "month-end depreciation on 6-Dec: ready, dated 30-Nov");
  const cl = rec([RENT("01", "2026-08"), RENT("01", "2026-09"), RENT("01", "2026-10")], "20261122", { closed: { to: "2026-11-30" } });
  ok(!entry(cl, "recurring").length && one(cl, "recurring_due")[0].state === "you", "a closed period: Needs you");
  const bank = rec(["08", "09", "10"].map((m) => ({ date: "2026-" + m + "-01", type: "Payment", lines: [["Rent", -45000], ["HDFC Bank", 45000]] })));
  ok(!one(bank, "recurring_due").length, "rent paid from the bank each month: the bank statement brings it, no journal");
  const k = one(rec([RENT("01", "2026-08"), RENT("01", "2026-09"), RENT("01", "2026-10")]), "recurring_due")[0].key;
  ok(!entry(rec([RENT("01", "2026-08"), RENT("01", "2026-09"), RENT("01", "2026-10")], "20261122", { items: [{ key: "asstEntries", item: "#dc-r", ord: 0, data: { id: "dc-r", dedupe: k, state: "sent", job: "44444444-4444-4444-8444-444444444444" }, deleted: false }] }), "recurring").length, "approved and its posting still running: no entry");
  const a = rec([RENT("01", "2026-08"), RENT("01", "2026-09"), RENT("01", "2026-10")]), b2 = rec([RENT("01", "2026-08"), RENT("01", "2026-09"), RENT("01", "2026-10")]);
  ok(JSON.stringify(a.out) === JSON.stringify(b2.out), "the same night twice: the same");
}

console.log("5b. the review's cases (H1, H2, M2, L1-L5, L8)");
{
  const addV = (rw, g, day, type, lines, narr) => { rw.heads.push(head(g, day, type, "", narr ? { narration: narr } : {})); lines.forEach(([l, a]) => rw.lines.push(L(g, l, a))); return rw; };
  const SEP = Object.assign({}, base, { ym: "202609" });   // September, filed 20-Oct
  const sepLines = [["IGST OUTPUT", -9000], ["CGST OUTPUT", -9000], ["SGST OUTPUT", -9000], ["IGST RCM OUTPUT", -1800], ["IGST INPUT", 5400], ["CGST INPUT", 3600], ["SGST INPUT", 3600], [CASH, 16200]];
  ok(entry(night(gstRows(SEP)), "gst_setoff").length === 1, "H1: September's set-off ready while none is in the books");
  ok(!entry(night(addV(gstRows(SEP), "late", "2026-11-15", "Journal", sepLines)), "gst_setoff").length && !one(night(addV(gstRows(SEP), "late", "2026-11-15", "Journal", sepLines)), "setoff_due").length, "H1: September's set-off booked late by hand (15-Nov, after the month after): found, no second journal");
  ok(!entry(night(addV(gstRows(SEP), "late", "2026-11-15", "GST Setoff", sepLines)), "gst_setoff").length, "L5: the same under a custom voucher type (\"GST Setoff\"): found by its lines");
  const odd = night(addV(gstRows(SEP), "odd", "2026-11-12", "Journal", [["CGST OUTPUT", -700], ["CGST INPUT", 700]]));
  ok(!entry(odd, "gst_setoff").length && /may be Sep 2026's set-off/.test(one(odd, "setoff_exclude")[0].facts.title), "H1: an unexplained tax journal any time after the month: Needs you");
  const nar = night(addV(gstRows(SEP), "odd", "2026-11-12", "Journal", [["CGST OUTPUT", -700], ["CGST INPUT", 700]], "GST set-off for Aug 2026"));
  ok(!entry(nar, "gst_setoff").length, "N1: a narration naming another month decides nothing (its lines are no month's set-off): Needs you");
  const rv = night(addV(gstRows(Object.assign({}, base)), "rv", "2026-11-20", "Journal", [["CGST OUTPUT", -5000], ["CGST INPUT", 5000]], "GST set-off paid on 20/11/2026"));
  ok(!entry(rv, "gst_setoff").length && one(rv, "setoff_exclude").length === 1 && one(rv, "setoff_due")[0].facts.waits, "N1: the reviewer's case \"GST set-off paid on 20/11/2026\" with other lines: Needs you, never ready");
  const ex = one(rv, "setoff_exclude")[0];
  ok(ex.candidates.length === 1 && ex.candidates[0].label === "That journal is not for Oct 2026" && ex.candidates[0].voucher === "rv" && ex.candidates[0].ref === "excl:07:202610:rv", "N2: the choice \"That journal is not for Oct 2026\" (and Not needed on the page)");
  const rv2 = night(addV(gstRows(Object.assign({}, base)), "rv", "2026-11-20", "Journal", [["CGST OUTPUT", -5000], ["CGST INPUT", 5000]], "GST set-off paid on 20/11/2026"), "20261122",
    { prior: [{ kind: "setoff_exclude", key: ex.key, state: "resolved", evidence: [ex.candidates[0]] }] });
  ok(entry(rv2, "gst_setoff").length === 1 && !one(rv2, "setoff_exclude").length, "N2: the owner said it is not for October: that journal left out, October proceeds");
  const lines9 = [["IGST OUTPUT", -9000], ["CGST OUTPUT", -9000], ["SGST OUTPUT", -9000], ["IGST RCM OUTPUT", -1800], ["IGST INPUT", 5400], ["CGST INPUT", 3600], ["SGST INPUT", 3600], [CASH, 16200]];
  ok(entry(night(addV(addV(gstRows(SEP), "a", "2026-10-20", "Journal", sepLines), "b0", "2026-11-01", "Journal", [["CGST OUTPUT", -1], ["CGST INPUT", 1]])), "gst_setoff").length === 0, "N1: only lines decide another month's (a 1-rupee tax journal is nobody's): Needs you");
  ok(!taxOnlyOK(addV(gstRows(SEP), "rnd", "2026-11-12", "Journal", [["CGST OUTPUT", -700], ["CGST INPUT", 688], ["Round Off", 12]])), "L5: a rounding line over ₹10: not a set-off journal");
}
function taxOnlyOK(rw) { const r = night(rw); const v = r.inp.books.vouchers.find((x) => x.id === "rnd"); const { groupsOf } = NC; return J.taxOnly(v, groupsOf(r.inp.books), r.inp.books.map); }
{
  // N3: ready only for a month kept as filed; a filed date alone: Needs you
  const r = night(gstRows(base), "20261122", { noKeep: true });
  ok(!entry(r, "gst_setoff").length && /keep this 3B as filed first/.test(one(r, "setoff_due")[0].facts.title), "N3: a filed date but no copy kept: Needs you, keep this 3B as filed first");
  const pay0 = night(gstRows(base)).gst[0].t.pay;
  ok(entry(night(gstRows(Object.assign({}, base, { rec: { cashLedger: CASH, snap: { pay: pay0 } } }))), "gst_setoff").length === 1, "N3: kept as filed (and the same): ready");
  const r4 = night(gstRows(Object.assign({}, base, { filed: "", rec: { cashLedger: CASH, snap: { pay: pay0 } } })));
  ok(!entry(r4, "gst_setoff").length && /no filing date/.test(one(r4, "setoff_due")[0].facts.title), "L4: kept as filed with no filing date, past the due date: Needs you (interest and late fee not known)");
}
{
  // H2: salary booked in the month after (by the 10th), or naming the month, or under a salary-like ledger
  const n = (more, o = {}) => night(pay(Object.assign({ more }, o)));
  ok(!entry(n([{ date: "2026-11-07", lines: [["Salary", -92903.23], ["Salary Payable", 92903.23]] }]), "payroll").length && !one(n([{ date: "2026-11-07", lines: [["Salary", -92903.23], ["Salary Payable", 92903.23]] }]), "payroll_due").length, "H2: October's salary booked on 7-Nov: booked, no journal");
  const nm = n([{ date: "2026-11-25", lines: [["Salary", -92903.23], ["Salary Payable", 92903.23]], narr: "Salary for October 2026" }]);
  ok(!entry(nm, "payroll").length && !one(nm, "payroll_due").length, "H2: booked on 25-Nov with a narration naming October: booked");
  const bonus = n([{ date: "2026-10-31", lines: [["Staff Bonus", -5000], ["Salary Payable", 5000]] }], { ledgers: { "Staff Bonus": "Indirect Expenses" } });
  ok(!entry(bonus, "payroll").length && one(bonus, "payroll_due")[0].state === "you", "H2: a staff bonus booked in October (another salary-like ledger): Needs you, never a second journal");
  const grp = n([{ date: "2026-10-31", lines: [["Factory Wages", -92903.23], ["Salary Payable", 92903.23]] }], { ledgers: { "Salary": "Employee Costs", "Factory Wages": "Employee Costs" }, groups: true });
  ok(!entry(grp, "payroll").length && one(grp, "payroll_due")[0].state === "you", "N5: two salary-named ledgers and no pick: the salary ledger is not certain, Needs you");
  const grpP = night(pay({ more: [{ date: "2026-10-31", lines: [["Factory Wages", -92903.23], ["Salary Payable", 92903.23]] }], ledgers: { "Salary": "Employee Costs", "Factory Wages": "Employee Costs" }, groups: true }), "20261122",
    { prior: [{ kind: "ledger_pick", key: "led:salaryExpense", state: "resolved", evidence: [{ ledger: "Salary" }] }] });
  ok(!entry(grpP, "payroll").length && !one(grpP, "payroll_due").length, "N5: the owner picked Salary; booked to another ledger of its sub-group where every ledger is salary-named: booked");
  const grp2 = n([{ date: "2026-10-31", lines: [["Crew Pay", -92903.23], ["Salary Payable", 92903.23]] }], { ledgers: { "Salary": "Employee Costs", "Crew Pay": "Employee Costs" }, groups: true });
  ok(entry(grp2, "payroll").length === 1, "N5: a sub-group with a ledger not named salary: only the salary ledger itself counts");
  ok(entry(n([{ date: "2026-10-31", lines: [["Auditors Remuneration", -25000], ["Sample Supplier", 25000]] }], { ledgers: { "Auditors Remuneration": "Indirect Expenses" } }), "payroll").length === 1, "N5: auditors' remuneration is not salary");
  ok(entry(n([{ date: "2026-10-20", lines: [["Staff Welfare", -3000], ["Cash", 3000]] }], { ledgers: { "Staff Welfare": "Indirect Expenses" } }), "payroll").length === 1, "N5: staff welfare is not salary");
  for (const l of ["Payroll Expenses", "Employee Benefit Expense", "Employee Cost - Office"]) {
    const r = n([{ date: "2026-10-31", lines: [[l, -92903.23], ["Salary Payable", 92903.23]] }], { ledgers: { [l]: "Indirect Expenses" } });
    ok(!entry(r, "payroll").length && one(r, "payroll_due")[0].state === "you", "final review 3: \"" + l + "\" is salary-named, not the payroll's ledger: Needs you");
  }
  const both = n([{ date: "2026-10-31", lines: [["Salary", -92903.23], ["Salary Payable", 92903.23]] }, { date: "2026-11-05", lines: [["Salary", -1000], ["HDFC Bank", 1000]] }]);
  ok(!entry(both, "payroll").length && !one(both, "payroll_due").length, "N5: October booked on 31-Oct; a salary entry on 5-Nov is November's, not counted twice for October");
  {
    const A = NC.groupsOf({ under: { Salary: "Indirect Expenses" }, groups: { "Indirect Expenses": "" } }), isS = (l) => l === "Salary";
    const V = [{ id: "a", date: "20261031", narr: "", ent: [{ l: "Salary", a: -5 }] }, { id: "b", date: "20261105", narr: "", ent: [{ l: "Salary", a: -6 }] }, { id: "c", date: "20261205", narr: "", ent: [{ l: "Salary", a: -7 }] }];
    ok(NC.salaryEntries(V, "202610", isS).map((v) => v.id).join() === "a" && NC.salaryEntries(V, "202611", isS).map((v) => v.id).join() === "b,c", "N5: each entry counts for one month only (5-Nov for November once October has its own; 5-Dec lent to November, which had none after the 10th)");
  }
  ok(entry(n([{ date: "2026-10-31", lines: [["Rent", -45000], ["Sample Landlord", 45000]] }]), "payroll").length === 1, "H2: rent in October (the same primary group, not salary): not counted");
}
{
  // L1 / L2: salary payments to the paisa; the net less PF and ESI
  const stmt = { kind: "bank_stmt", id: "c1:s1", data: { id: "s1", acctId: "acc-1", acct: "XX2231", bank: "HDFC Bank", from: "2026-11-01", to: "2026-11-30" } };
  const bl = (id, amt, name) => ({ id, date: "2026-11-01", narr: "NEFT/" + name.toUpperCase(), debit: amt, credit: 0, ledger: "", state: "attention", dec: { name, key: "neft:" + name, mode: "NEFT" } });
  const go = (rs, sh) => { const rw = pay({ sheet: sh || sheet, more: [{ date: "2026-10-31", lines: [["Salary", -1], ["Salary Payable", 1]] }] }); rw.co.bankAccounts = [{ id: "acc-1", ledger: "HDFC Bank", last4: "2231" }];
    const b = booksOf(rw); return run(nightInput(rw, b, { today: "20261122", bankRecs: [stmt, { kind: "bank_rows", id: "c1:s1:0", data: { rows: rs } }], inboxRecs: [], entryRecs: [], twob: [], gst: [], prior: [], draftRecs: [] })); };
  const f = (r, id) => r.findings.find((x) => x.facts.row === String(id));
  ok(f(go([bl(1, 47299.5, "Ravi Kumar")]), 1).state === "you", "L1: 50 paise off the net: Needs you (resolved only to the paisa)");
  ok(f(go([bl(1, 47300, "Ravi Kumar")]), 1).state === "resolved", "L1: to the paisa: resolved");
  ok(f(go([bl(1, 18050, "PF Person")], [{ name: "PF Person", date: "2026-10-31", gross: 20000, tds: 0, profTax: 0, pf: 1800, esi: 150 }]), 1).state === "resolved", "L2: the net less PF and ESI, the same everywhere");
}
{
  // L3: FinCom's own monthly entry posted in October continues the series
  const own = Object.assign(RENT("01", "2026-10"), { narr: "Monthly entry | TDSDesk:" + J.voucherId("rec:x:202610") });
  ok(entry(rec([RENT("01", "2026-08"), RENT("01", "2026-09"), own]), "recurring").length === 1, "L3: FinCom's own posted entry counts in the pattern: November proposed");
}
{
  // L8: no salary payable in a liabilities group: a clear choice, one outside the group confirmed explicitly, never stuck
  const r = night(pay({ ledgers: { "Salary Payable": "Indirect Expenses", "Staff Dues": "Provisions" } }));
  const pk = one(r, "ledger_pick").find((f) => f.key === "led:salaryPayable");
  ok(pk && pk.candidates.some((c) => c.outside && /Use “Salary Payable” anyway \(under Indirect Expenses\)/.test(c.label)) && pk.candidates.some((c) => c.ledger === "Staff Dues" && !c.outside), "L8: the one of that name outside the group (to confirm), and the right group's ledgers");
  const r2 = night(pay({ ledgers: { "Salary Payable": "Indirect Expenses" } }), "20261122", { prior: [{ kind: "ledger_pick", key: "led:salaryPayable", state: "resolved", evidence: [{ ledger: "Salary Payable", outside: true }] }] });
  ok(entry(r2, "payroll").length === 1, "L8: confirmed though outside the group: the journal is made");
  const r3 = night(pay({ ledgers: { "Salary Payable": "Indirect Expenses" } }), "20261122", { prior: [{ kind: "ledger_pick", key: "led:salaryPayable", state: "resolved", evidence: [{ ledger: "Salary Payable" }] }] });
  ok(!entry(r3, "payroll").length, "L8: picked without the confirmation: still asks");
  const r4 = night(pay({ sheet: [{ name: "PF Person", date: "2026-10-31", gross: 20000, tds: 0, profTax: 0, pf: 1800 }], drop: ["Salary Payable", "PF Payable"], ledgers: { "Misc Dues": "Indirect Expenses" } }), "20261122",
    { prior: [{ kind: "ledger_pick", key: "led:pf", state: "resolved", evidence: [{ ledger: "Misc Dues", outside: true }] }, { kind: "ledger_pick", key: "led:salaryPayable", state: "resolved", evidence: [{ ledger: "Misc Dues" }] }] });
  ok(!entry(r4, "payroll").length, "low: a ledger confirmed outside its group for PF does not pass for salary payable (only its own role)");
}

console.log("6. every entry, every night: ready only with every check passed");
{
  const all = [night(gstRows(base)), night(pay()), rec([RENT("01", "2026-08"), RENT("01", "2026-09"), RENT("01", "2026-10")])].flatMap((r) => r.out.entries);
  ok(all.length >= 3 && all.every((e) => e.ready === e.checks.every((c) => c.ok) && (!e.ready || drcr(e))), "ready means every check passed and Dr = Cr (" + all.length + " entries)");
  ok(all.every((e) => /^dc-/.test(e.work_ref) && e.work_ref === J.voucherId(e.dedupe)), "each carries its own id for Tally, the same each night");
  ok(new Set(all.map((e) => e.dedupe)).size === all.length, "one entry a month and kind (unique dedupe)");
}

console.log("7. the trust levels");
{
  ok(J.trustGate({ level: 0, amt: 5000 }).act === "ask", "level 0 asks first (the default)");
  ok(J.trustGate({ level: 1, amt: 5000 }).act === "ask" && J.trustGate({ level: 2, amt: 5000 }).act === "ask", "phase 2: levels 1 and 2 still wait for Approve (posting by itself is the owner's decision)");
  ok(J.trustGate({ level: 1, amt: 5000, allowed: true }).act === "tell" && J.trustGate({ level: 2, amt: 5000, allowed: true }).act === "quiet", "once allowed: level 1 done then told, level 2 done quietly");
  ok(J.trustGate({ level: 2, amt: 100001, limit: 100000, allowed: true }).act === "ask" && J.trustGate({ level: 2, amt: 100000, limit: 100000, allowed: true }).act === "quiet", "the owner's limit: above ₹1 lakh asks first, at it does not");
  ok(J.trustGate({ level: 7, amt: 1 }).act === "ask" && J.trustGate({}).act === "ask", "odd input: asks first");
  ok(J.promotion({ approved: 19 }, 0) === null && J.promotion({ approved: 20 }, 0).to === 1 && J.promotion({ approved: 40 }, 1).to === 2 && J.promotion({ approved: 99 }, 2) === null, "a promotion is suggested after 20 approvals, one level up, never past 2");
  ok(J.promotion({ approved: 25, dismissedAt: "2026-11-20", lastAt: "2026-11-19" }, 0) === null && J.promotion({ approved: 25, dismissedAt: "2026-11-20", lastAt: "2026-11-21" }, 0).to === 1, "put off: not asked again until more are approved");
  ok(J.AUTO_POSTING === false, "posting by itself is off in this phase");
}

console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fails ? 1 : 0);
