// Validate & file (next-tds-clear, design §3.7): ONE panel in place of To fix, the Return file tab, FileChecks and the
// step ③ card. At the top the checks passed; then the errors (only what stops the whole file), the warnings and the
// File row: the previous PRN, Make FVU file, Download, Check with FVU, Mark filed.
// next-tds-validate-short (the owner, 25-Oct-2026, Leads Insurance Form 140 Q1: "maximum errors and warnings are not
// required.. there should be a shorter way to say this warning.. don't need too long warnings.. all calculations of
// interest should be there if we click late payment interest in warning"; then "there should not be any blocker also if we
// do not file any deductions.. we can say that certain deductions are not there but it cannot be a blocker"):
//   - errors: only what stops the file as a whole (a challan used beyond its tax, nothing the file can carry, 24Q without
//     its salary sheet). A row the file cannot carry (on no challan, on a challan the FVU refuses for it, a stale split, a
//     wrong remark, a record FVU 8.7 refuses) is left out of the file (TDS26Q.leftOut, src/js/92) and said in one warning;
//   - warnings: one short line each (SHORT_MAX characters), the same kind grouped with its count, at most MAX_LINES lines
//     (the rest under "N more"), one action each; the long words and the list open on click in a side panel (Panel);
//   - advice (Tally's old nature-of-payment rates, a fee under 194C that may be 194J, a challan's nature, a rate other than
//     the TDS ledger's, …) under one folded "Suggestions (N)" line; the online checks, Checks before filing, the AI match,
//     the checks from Tally and the year's checks under one folded "More checks";
//   - interest: no table on the page; "Interest ₹x due · Details" opens the whole working (tds/Interest.jsx): the figure on
//     the line is the working's total, the one "not allocated" beside it its own line of that working.
// checkReturn() is the one source of a return's problem count: the header's badge, the rail's and the TDS home's
// status all come from it. Nothing here works out a figure: the counts are those of TDSMatch.checks, Certs.issues,
// TDSMatch.interestTable (TDS.interest / lateFee), TDS26Q / TCS27EQ, TDSReg, TDSTally, TDSDrift, TRF, TDSPanFix, TDSF25,
// TDSAdd.dups and TDS26Q.leftOut (src/js).
import { useState } from "react";
import { TracesCheck } from "./Register.jsx";
import { InterestFee } from "./Interest.jsx";
import { stepName, PrevPrn } from "./Shell.jsx";
import { PreFileButton } from "../../parts/PreFile.jsx";
import ListTable from "../../parts/ListTable.jsx";
import { Panel } from "../../parts/DetailDrawer.jsx";

const money = (v) => "₹" + INR.format(r2(v || 0));
// the late fee in whole rupees where it is whole (₹17,200); every other figure as FinCom writes money (₹31,594.43)
const rup = (v) => "₹" + Math.round(num(v)).toLocaleString("en-IN");
const amt = (v) => (Math.abs(r2(v || 0) - Math.round(v || 0)) < 0.005 ? rup(v) : money(v));
const s_ = (n, one, many) => n + " " + (n === 1 ? one : many);
const day = (d) => (d ? fmtDate(tallyDate(TDS.ymd(d))) : "");
export const SHORT_MAX = 70, MAX_LINES = 5;
// a long sentence's first part, as one short line
const cut = (w) => { w = String(w || ""); const i = w.search(/[:;(]/); let t = (i > 12 ? w.slice(0, i) : w).trim(); if (t.length > SHORT_MAX - 10) t = t.slice(0, SHORT_MAX - 12).replace(/\s+\S*$/, "") + "…"; return t; };

// the rows of a return
export const rowsOf = (fy, q, form) => (form === "27Q" ? TDS.nrRows() : form === "27EQ" ? TDS.tcsRows() : form === "24Q" ? TDS.formRows("24Q") : TDS.rows()).filter((r) => r.fy === fy && r.q === q);

// the TDS check's notes (TDSAudit.notes, src/js/91) that are advice, not a warning
const AU_SUGG = ["secpay", "natrate", "ledrate", "bills", "revd", "sal192"];
// the short line of the TDS check's notes of one kind (n of them)
const AU_SHORT = {
  topup: (n) => s_(n, "TDS entry", "TDS entries") + " booked as an expense with no deductee",
  rev: (n) => s_(n, "TDS amount", "TDS amounts") + " debited back in Tally",
  payover: (n) => s_(n, "TDS payment", "TDS payments") + " above the deductions they pay",
  recv: (n) => s_(n, "TDS receivable ledger", "TDS receivable ledgers") + " with deductions",
  chsplit: (n) => s_(n, "Tally payment covers", "Tally payments cover") + " several sections",
  chpaise: (n) => s_(n, "challan", "challans") + " not in whole rupees",
  chdraft: (n) => s_(n, "challan needs its", "challans need their") + " serial number",
  secpay: (n) => s_(n, "payment", "payments") + " booked under another section than paid for",
  natrate: (n) => s_(n, "Tally nature of payment", "Tally natures of payment") + " with old rates",
  ledrate: (n, l) => (l.length === 1 ? cut(l[0].words) : s_(n, "note", "notes") + ": rate other than the TDS ledger's"),
};

// a return's checks: {errors, warnings, info, passed, kinds}. Each item {k, n, short (the line, at most SHORT_MAX
// characters), words (the long words, in its panel), step?, go? (the step link's words), review?, act?, list? ([{words,
// act?}]), leftOut?, dups?, pri? (the order of the warnings: 1 first)}. info: the Suggestions
export function checkReturn(fy, q, form) {
  const out = { errors: [], warnings: [], info: [], passed: 0, kinds: 0 };
  const put = (list, it) => { out.kinds++; if (it && it.n > 0) list.push(it); else out.passed++; };
  const unitW = form === "27EQ" ? ["collection", "collections"] : form === "24Q" ? ["salary payment", "salary payments"] : ["deduction", "deductions"];
  let mc = { block: [], warn: [], info: [] };
  try { mc = TDSMatch.checks(form, fy, q); } catch (e) { /* the matcher not loaded: nothing said */ }
  const blk = (k) => mc.block.find((x) => x.k === k), rowsQ = rowsOf(fy, q, form);
  // errors: what stops the whole file (the builder refuses these too)
  const ov = blk("over");
  let ovs = []; try { ovs = ov ? TDSReg.overUsed(fy, q, form) : []; } catch (e) { /* */ }
  const ovBy = (c) => -TDSReg.balance(c).tax;
  put(out.errors, { k: "over", n: ov ? ov.n : 0, words: ov ? ov.words : "", short: !ov ? "" : ovs.length === 1 ? "Challan " + (ovs[0].serial || TDSCH.label(ovs[0])) + " is used " + money(ovBy(ovs[0])) + " beyond its tax"
    : s_(ov.n, "challan used beyond its tax", "challans used beyond their tax") + " · " + money(ovs.reduce((a, c) => a + ovBy(c), 0)), step: "challans", review: true });
  // next-tds-validate-short: the rows the file leaves out (TDS26Q.leftOut: on no challan; a challan the FVU refuses for it,
  // dated before the financial year or after today or not minor head 200; a split whose tax changed; a remark B, T or Y that
  // is wrong; a record FVU 8.7 refuses), said in two lines, never an error
  let lo = []; try { lo = TDS26Q.leftOut(form, fy, q); } catch (e) { /* the TDS screens' program not loaded */ }
  const sum = (l) => l.reduce((a, x) => a + num(x.r.tds), 0), noCh = lo.filter((x) => x.k === "nochallan"), other = lo.filter((x) => x.k !== "nochallan");
  put(out.warnings, { k: "unmatched", n: noCh.length, pri: 1, short: s_(noCh.length, unitW[0], unitW[1]) + " not in the file (no challan) · " + money(sum(noCh)),
    words: "A " + (form === "27EQ" ? "collectee" : "deductee") + " record needs its challan, so the file is made without these " + s_(noCh.length, unitW[0], unitW[1]) + " (" + money(sum(noCh)) + "). Put them on a challan to file them now; else they can go in a correction later. Their interest runs till they are paid.",
    step: "challans", go: "Put on a challan", review: true, leftOut: noCh });
  const okw = { early: "on a challan Protean's FVU refuses for it", stale: "a split whose tax changed in the books", remark: "a remark B, T or Y to correct", fvu87: "a record FVU 8.7 refuses" };
  put(out.warnings, { k: "leftout", n: other.length, pri: 2, short: s_(other.length, unitW[0], unitW[1]) + " not in the file (FVU would refuse) · " + money(sum(other)),
    words: "The file is made without these: " + Array.from(new Set(other.map((x) => okw[x.k]))).join("; ") + ". Correct them to file them.", step: other.length && other[0].k === "early" ? "deductions" : other.length && other[0].k === "stale" ? "challans" : "deductees", fixK: other.length ? other[0].k : "", review: true, leftOut: other });
  // the whole file: nothing it can carry
  const taxed = rowsQ.filter((r) => num(r.tds) > 0.005).length, nilIn = form === "26Q" && rowsQ.some((r) => !r.challan && !(num(r.tds) > 0.005) && /^[BTY]$/.test(((TDS26Q.remark && TDS26Q.remark(r, form)) || {}).remark || "") && !lo.some((x) => x.r.id === r.id));
  const nofile = taxed > 0 && lo.filter((x) => num(x.r.tds) > 0.005).length >= taxed && !nilIn;
  put(out.errors, { k: "nofile", n: nofile ? 1 : 0, short: "No " + unitW[0] + " is on a challan the FVU takes: no file", words: "Every " + unitW[0] + " of this return is left out of the file (above), so there is nothing to file: put them on a challan first.", step: "challans" });
  // next-tds-autoplace: the remarks of the rows with no tax (src/js/94): their errors are rows left out (above); the
  // optional UIN a suggestion
  let rk = []; try { rk = TDSDecl.checks(fy, q, form); } catch (e) { /* the TDS screens' program not loaded */ }
  rk.filter((x) => x.level === "warn").forEach((x) => out.info.push({ k: "rm-" + x.k, n: x.n, short: x.k === "b-uin" ? s_(x.n, "remark B row", "remark B rows") + " without the Form 121 UIN (optional)" : cut(x.words), words: x.words, step: "deductees" }));
  // next-fvu87 (24-Oct-2026): up to FY 2025-26, what Protean's FVU 8.7 refuses on a deductee record (left out, above), 194T
  // which it has no code for (a warning) and what FinCom changed for it in the file (a suggestion)
  let f87 = []; try { f87 = TDS26Q.fvu87Checks(fy, q, form); } catch (e) { /* the TDS screens' program not loaded */ }
  f87.forEach((x) => { if (x.level === "warn") out.warnings.push({ k: "fvu87-" + x.k, n: x.n, short: x.k === "no-code" ? s_(x.n, "194T payment", "194T payments") + ": FVU 8.7 has no code for them" : cut(x.words), words: x.words, step: "deductees", review: true });
    else if (x.level !== "error") out.info.push({ k: "fvu87-" + x.k, n: x.n, short: cut(x.words), words: x.words }); });
  // the salary return without the salary sheet or Tally's payroll: no file can be made
  const sheet = form === "24Q" && (((S.books || {}).salary || []).length > 0), tally = form === "24Q" && !sheet && Payroll.has(fy);
  if (form === "24Q") put(out.errors, { k: "nosheet", n: !sheet && !tally ? 1 : 0, short: "24Q needs the salary sheet", words: "24Q needs the salary sheet: the books cannot say whose TDS it is", act: ["Bring in the salary sheet", () => doAct("salaryPick")] });
  // next-tds-validate-short: possible duplicates (TDSAdd.dups, src/js/88): one added in FinCom that the books already have
  let dp = []; try { if (form !== "24Q") dp = TDSAdd.dups(form, fy, q); } catch (e) { /* the TDS screens' program not loaded */ }
  put(out.warnings, { k: "dups", n: dp.length, pri: 3, short: "Possible duplicate " + unitW[1] + ": " + dp.length + " · " + money(dp.reduce((a, x) => a + num(x.a.tds), 0)),
    words: "Each pair: the same deductee, date of deduction, section and TDS, one of them added in FinCom. Keep one: the other is taken out of the return (kept, with Put back under Suggestions).", review: true, dups: dp });
  // warnings: potential notices and what to look at before filing
  let pans = [];
  try { pans = TDSPanFix.list(form, fy, q).filter((p) => p.bad); } catch (e) { /* */ }
  const who = form === "24Q" ? ["employee", "employees"] : form === "27EQ" ? ["buyer", "buyers"] : ["deductee", "deductees"];
  put(out.warnings, { k: "nopan", n: pans.length, short: s_(pans.length, who[0] + " without a valid, operative PAN", who[1] + " without a valid, operative PAN"), step: "deductees", review: true });
  if (form === "26Q") {
    const iss = Certs.issues(fy, q), short = r2(iss.reduce((a, x) => a + Math.max(0, num(x.short)), 0));
    put(out.warnings, { k: "rate", n: iss.length, short: s_(iss.length, "rate question", "rate questions") + (short ? " · short " + money(short) : ""), step: "deductions", review: true });
  }
  if (form !== "24Q") {
    const pc = TDS26Q.payCodeRows(fy, q, form).length;
    put(out.warnings, { k: "paycode", n: pc, short: s_(pc, unitW[0] + ": payment code to confirm", unitW[1] + ": payment code to confirm"), words: s_(pc, unitW[0] + " with a payment code to confirm (2025 Act)", unitW[1] + " with a payment code to confirm (2025 Act)"), review: true });
  }
  if (form === "27Q" || form === "27EQ") {
    const oth = form === "27Q" ? TDS26Q.nrChecks(fy, q) : TCS27EQ.checks(fy, q);
    if (form === "27Q") put(out.warnings, { k: "nrdetails", n: oth.length, short: s_(oth.length, "non-resident deductee with details missing", "non-resident deductees with details missing"), review: true });
    else {
      const nocode = oth.filter((x) => /No collection code/.test(x.why || "")).length;
      put(out.warnings, { k: "nocode", n: nocode, short: s_(nocode, "collection without a collection code", "collections without a collection code"), review: true });
      put(out.warnings, { k: "tcsrate", n: oth.length - nocode, short: s_(oth.length - nocode, "TCS rate question", "TCS rate questions"), review: true });
    }
  }
  if (form === "24Q") {
    let ch = [];
    if (sheet) {
      ch = TDS24Q.checks(fy, q);
      const a1 = TDS24Q.annexI(fy, q), inBooks = TDS.salaryRows().filter((r) => r.fy === fy && r.q === q), bt = r2(inBooks.reduce((a, r) => a + r.tds, 0)), stx = r2(a1.reduce((s, e) => s + e.tds, 0));
      if (inBooks.length && Math.abs(bt - stx) >= TDS.MIN_WARN) ch = ch.concat([{ what: "Salary TDS in the books differs from the salary sheet", n: inBooks.length, how: "Tally has " + money(bt) + " under section 192 this quarter; the sheet has " + money(stx) + ".", who: Array.from(new Set(inBooks.map((r) => r.party))).slice(0, 3) }]);
    } else if (tally) ch = Payroll.checks(fy, q);
    put(out.warnings, { k: "salary", n: ch.length, short: s_(ch.length, "salary check before filing", "salary checks before filing"), words: ch.length ? s_(ch.length, "salary check before filing", "salary checks before filing") + ": " + ch.map((c) => c.what.toLowerCase()).join("; ") : "", step: sheet ? "people" : undefined, review: true, list: ch });
  }
  // next-tds-interest (the owner, 20-Oct-2026), next-tds-validate-short: one line, the return's whole interest and what of it
  // is not allocated on its challans; the working (tds/Interest.jsx) in its panel. No line once allocated with nothing
  // unpaid, none under ₹10 (TDS.MIN_WARN); the 234E fee as allocated on the Challans grid (Fee 234E allocated)
  const filed = TDSFiled.get(fy, q, form);
  let it = null; try { it = TDSMatch.interestTable(form, fy, q); } catch (e) { /* the matcher not loaded */ }
  const T = it ? it.totals : { interest: 0, short: 0, unpaid: 0, feeShort: 0 }, big = (v) => TDSMatch.warnShort(v);
  const intOn = it && (big(T.short) || big(T.unpaid)), feeShort = it && !filed ? T.feeShort : 0;
  put(out.warnings, { k: "interest", n: intOn ? 1 : 0, pri: 4, short: "Interest " + money(T.interest) + " due" + (big(T.short) ? " · " + money(T.short) + " not allocated" : ""), total: T.interest, notAlloc: T.short,
    words: "Interest under " + (form === "27EQ" ? "206C(7)" : "201(1A)") + " of this return, worked out deduction by deduction below.", review: true, dlabel: "Details", step: "challans" });
  if (big(feeShort)) out.warnings.push({ k: "fee", n: 1, pri: 5, short: "Late fee 234E " + amt(feeShort) + (T.feeAllocated > 0.005 ? " still to allocate" : ""), review: true, dlabel: "Details", step: "challans" });
  // the matcher's warnings (interest not allocated by a person, a challan used by an earlier return): suggestions
  mc.warn.forEach((x, i) => out.info.push({ k: "m-" + x.k + i, n: 1, short: x.k === "portion" ? "Interest allocated by FinCom on a challan: check it on Challans" : x.k === "earlier" ? "A challan an earlier return used too: check its balance" : cut(x.words), words: x.words, step: "challans" }));
  if (form !== "24Q") {
    let td = 0; try { td = TDSTally.disagreements().length + TDSTally.conflicts("challan").length + TDSTally.bad().length; } catch (e) { /* */ }
    put(out.warnings, { k: "tally", n: td, short: s_(td, "challan differs between Tally and FinCom", "challans differ between Tally and FinCom"), review: true });
  }
  // next-tds-addlist (19-Oct-2026), next-tds-early (20-Oct-2026): a deduction on a challan naming another section: a warning
  const chBy = {}; TDS.challans().forEach((c) => { chBy[c.id] = c; });
  const wrongSec = rowsQ.filter((r) => r.challan && chBy[r.challan] && TDSEdit.placeIssues(r, chBy[r.challan]).some((x) => x.k === "sec"));
  put(out.warnings, { k: "chsec", n: wrongSec.length, short: s_(wrongSec.length, unitW[0] + " on a challan of another section", unitW[1] + " on a challan of another section"), step: "deductions" });
  const unk = TDSReg.unknownType(fy, q).length;
  put(out.warnings, { k: "chtype", n: unk, short: s_(unk, "challan of unknown type: which return?", "challans of unknown type: which return?"), review: true });
  const drift = filed && form !== "24Q" ? TDSDrift.check(fy, q, form) : null, dn = drift ? drift.rows.length : 0;
  put(out.warnings, { k: "corr", n: dn, short: s_(dn, "change in Tally since filing: file a correction", "changes in Tally since filing: file a correction"), review: true });
  const jr = TRF.jrFor(fy, q, form), jn = jr ? jr.items.length : 0;
  put(out.warnings, { k: "traces", n: jn, short: s_(jn, "TRACES default", "TRACES defaults"), review: true });
  let dpn = 0; try { dpn = TDSF25.deductorProblems(TDS26Q.firmDetails()).length; } catch (e) { /* */ }
  put(out.warnings, { k: "deductor", n: dpn, short: s_(dpn, "deductor detail missing or not in the file's form", "deductor details missing or not in the file's form"), step: "deductor" });
  // the Suggestions: what goes elsewhere, and the matcher's notes
  if (form === "26Q") { const pr = TDS.portalRows().filter((r) => r.fy === fy && r.q === q).length; if (pr) out.info.push({ k: "portal", n: pr, short: s_(pr, "deduction goes on the portal (26QB / 26QC / 26QD)", "deductions go on the portal (26QB / 26QC / 26QD)"), words: s_(pr, "deduction goes on the portal (26QB / 26QC / 26QD), not this return", "deductions go on the portal (26QB / 26QC / 26QD), not this return"), review: true }); }
  mc.info.forEach((x, i) => out.info.push({ k: "i-" + x.k + i, n: 1, short: x.k === "nature" ? cut(String(x.words).replace(/^Challan ([^:]+): (.*)$/, "$2 (challan $1)")) : cut(x.words), words: x.words }));
  // the owner, 22-Oct-2026 (Leads Insurance, a blank 194J row of ₹0.71): an entry that adjusts a TDS ledger without a
  // deductee (a round-off journal) is no deduction (TDS.adjOnly); each such entry said once, a suggestion, with the entry
  let adj = []; try { adj = TDSAdj.list(fy, q, form); } catch (e) { /* the TDS screens' program not loaded */ }
  adj.forEach((x, i) => out.info.push({ k: "tdsadj" + i, n: 1, short: cut(x.words), words: x.words, adj: x.vid, act: ["Open the entry", () => TDSAdj.open(x)] }));
  // the TDS check of 22-Oct-2026 (src/js/91: TDSAudit.notes): reversals, top-ups, sections against the expense, payments
  // against deductions, Tally's old rates, one PAN under two names, the remarks; one line a kind (its count), its notes in
  // the line's panel; advice (AU_SUGG and the notes) under Suggestions
  let au = []; try { au = TDSAudit.notes(fy, q, form); } catch (e) { /* the TDS screens' program not loaded */ }
  const g = {};
  au.forEach((x) => { const sugg = x.level !== "warn" || AU_SUGG.includes(x.k), key = (sugg ? "s:" : "w:") + x.k;
    (g[key] = g[key] || { k: x.k, sugg, list: [] }).list.push({ words: x.words, step: x.step, act: x.vid ? ["Open the entry", () => TDSAdj.open({ date: x.date, no: x.no || "", ledgers: [x.ledger || ""] })] : undefined }); });
  Object.values(g).forEach((G) => {
    const n = G.list.length, f = AU_SHORT[G.k], one = n === 1 ? G.list[0] : null;
    const item = { k: "au-" + G.k, n, short: f ? f(n, G.list) : one ? cut(one.words) : s_(n, "note", "notes") + ": " + cut(G.list[0].words), list: G.list, step: (G.list.find((x) => x.step) || {}).step, review: true };
    if (G.k === "chsplit") Object.assign(item, { step: "challans", go: "Split on Challans", review: false, pri: 6 });
    (G.sugg ? out.info : out.warnings).push(item);
  });
  // next-tds-excel, next-tds-validate-short: rows taken out of this return (an Excel brought back, Keep one of a possible
  // duplicate), kept in the books, with Put back
  let outs = []; try { outs = TDSEdit.outList().filter((o) => o.form === form && o.fy === fy && o.q === q); } catch (e) { /* */ }
  if (outs.length) out.info.push({ k: "tdsx-out", n: outs.length, short: s_(outs.length, unitW[0], unitW[1]) + " taken out of this return (kept in the books)",
    words: s_(outs.length, unitW[0], unitW[1]) + " taken out of this return (kept in the books): " + outs.slice(0, 3).map((o) => (o.party || "—") + " " + money(o.tds)).join(", ") + (outs.length > 3 ? " …" : ""),
    list: outs.map((o) => ({ words: (o.party || "—") + " " + money(o.tds) + ": " + (o.dup ? o.reason : "by an Excel brought back" + (o.reason ? " (" + o.reason + ")" : "")), act: ["Put back", () => { TDSX.putBack(o.id); render(); }] })),
    act: ["Put back", () => { outs.forEach((o) => TDSX.putBack(o.id)); render(); }] });
  // every line said at most SHORT_MAX characters
  [out.errors, out.warnings, out.info].forEach((l) => l.forEach((x) => { if (!x.short) x.short = cut(x.words); if (!x.words) x.words = x.short; }));
  out.warnings.sort((a, b) => (a.pri || 9) - (b.pri || 9));
  out.leftOut = lo; out.drift = dn; out.n = out.errors.length + out.warnings.length;
  return out;
}

// what a line's step link sets before it goes
function goStep(it) {
  if (it.step === "deductees") S.tdsDeeF = "bad";
  if (it.step === "challans" && it.k === "unmatched") S.tdsChSel = "__none";
  // next-tds-register: the rows on a challan that cannot pay them are in the Deductions register's Mapped tab
  if (it.step === "deductions" && (it.fixK === "early" || it.k === "chsec")) { S.tdsDedView = ""; S.tdsWinAdd = ""; S.tdsDedReg = "mapped"; S.tdsDregSel = {}; }
  if (it.step === "deductions" && it.k === "rate") { S.tdsFl = Object.assign({}, S.tdsFl || {}, { deductions: Object.assign({}, (S.tdsFl || {}).deductions || {}, { rate: "q" }) }); S.tdsDedView = "table"; S.tdsDedCh = ""; }
  S.tdsFix = ""; tdsTabGo(it.step); try { window.scrollTo(0, 0); } catch (e) { /* */ }
}

// one line of the panel: its short words and one action (the panel with its details, else the step, else its act)
function Line({ it, level, onOpen, form, open, hide }) {
  const det = it.review || it.list || it.leftOut || it.dups;
  return <li className={"vf-line " + level} data-val-item={it.k} data-val-level={level} data-tds-adj={it.adj} hidden={hide || undefined}>
    <div className="vf-row">
      <span className="vf-ic" aria-hidden="true">{level === "error" ? "✕" : level === "warn" ? "!" : "i"}</span>
      <span className="vf-w" title={it.words !== it.short ? it.words : undefined}>{it.short}</span>
      <span className="vf-act">
        {det ? <button type="button" className="linkbtn" data-val-review={it.k} aria-expanded={!!open} onClick={onOpen}>{it.dlabel || "Review"}</button>
          : it.step ? <button type="button" className="linkbtn" data-val-fix={it.step} onClick={() => goStep(it)}>{it.go || "Fix"} →</button>
            : it.act ? <button type="button" className="linkbtn" data-val-act={it.k} onClick={it.act[1]}>{it.act[0]} →</button> : null}
      </span>
    </div>
  </li>;
}

// the rows a file leaves out, with why and where to correct them
function LeftList({ list, form }) {
  const W = { nochallan: "on no challan", early: "challan refused by the FVU", stale: "split changed in the books", remark: "remark to correct", fvu87: "refused by FVU 8.7" };
  return <div className="bk-tablewrap"><table className="bk-table vf-itable" data-left-list={list.length}>
    <thead><tr><th>{form === "24Q" ? "Employee" : form === "27EQ" ? "Buyer" : "Deductee"}</th><th>Section</th><th className="dt">Deducted on</th><th className="n">TDS</th><th>Why left out</th></tr></thead>
    <tbody>{list.map((x) => <tr key={x.r.id} data-left-row={x.r.id} data-left-k={x.k}><td>{x.r.party || x.r.employee}</td><td>{TDS.sec(x.r.section || "") || (form === "24Q" ? "192" : "")}</td><td className="dt">{day(x.r.date)}</td><td className="n">{money(x.r.tds)}</td><td>{W[x.k]}{x.why && x.k !== "nochallan" ? <small className="note vf-snote">{x.why}</small> : null}</td></tr>)}</tbody>
  </table></div>;
}

// the possible duplicates, each pair with Keep on each side (the other taken out of the return, kept: Put back)
function DupList({ list, form }) {
  const src = (r) => (r.added ? "Added in FinCom" + (r.addedBy ? " by " + r.addedBy : "") + (r.addedAt ? " on " + fmtDate(tallyDate(String(r.addedAt).slice(0, 10).replace(/-/g, ""))) : "") : "Books: " + (r.type || "entry") + (r.voucher ? " " + r.voucher : ""));
  const ch = {}; TDS.challans().forEach((c) => { ch[c.id] = c; });
  const keep = (a, b) => { const r = TDSAdd.keepOne(form, a.id, b.id); if (!r.ok) toast(r.why); else toast("Kept one: the other is taken out of the return (Put back under Suggestions)."); render(); };
  const books = list.filter((p) => !p.b.added);
  const side = (r, o) => <td data-dup-side={r.id}>
    <b>{r.party}</b> · {TDS.sec(r.section)} · {day(r.date)} · {money(r.tds)}{r.books && r.books.tds != null && Math.abs(num(r.books.tds) - num(r.tds)) > 0.005 ? <small className="note vf-snote" data-dup-edited="">corrected in FinCom; the books say {money(r.books.tds)}</small> : null}
    <small className="note vf-snote">{src(r)} · {r.challan && ch[r.challan] ? "challan " + ch[r.challan].serial + " · " + day(ch[r.challan].date) : "on no challan"}</small>
    <button type="button" className="btn small" data-dup-keep={r.id} onClick={() => keep(r, o)}>Keep this one</button></td>;
  return <>
    {books.length > 1 && <p><button type="button" className="btn small" data-dup-keep-books={books.length} onClick={() => { let n = 0; books.forEach((p) => { if (TDSAdd.keepOne(form, p.b.id, p.a.id).ok) n++; }); toast(n + " kept from the books; the ones added in FinCom taken out (Put back under Suggestions)."); render(); }}>Keep the books’ entry of all {books.length}</button></p>}
    <div className="bk-tablewrap"><table className="bk-table vf-itable" data-dup-list={list.length}>
      <thead><tr><th>One</th><th>The other</th><th>Why alike</th></tr></thead>
      <tbody>{list.map((p) => <tr key={p.a.id} data-dup-pair={p.a.id + "|" + p.b.id}>{side(p.b, p.a)}{side(p.a, p.b)}<td className="note">{p.why}</td></tr>)}</tbody>
    </table></div></>;
}

// what a line's panel shows: its long words, its list or table, the review it always had, and its step
function Detail({ it, form, fy, q, reviews }) {
  const k = it.k;
  return <div className="vf-detail" data-val-detail={k}>
    {it.words && it.words !== it.short && k !== "interest" ? <p className="note" data-val-words="">{it.words}</p> : null}
    {k === "interest" || k === "fee" || k === "intwork" ? <InterestFee fy={fy} q={q} form={form} /> : null}
    {it.leftOut && it.leftOut.length ? <LeftList list={it.leftOut} form={form} /> : null}
    {it.dups && it.dups.length ? <DupList list={it.dups} form={form} /> : null}
    {it.list && it.list.length && k !== "salary" ? <ul className="vf-dlist" data-val-dlist="">{it.list.map((x, i) => <li key={i}>{x.words}{x.act ? <> <button type="button" className="linkbtn" onClick={x.act[1]}>{x.act[0]} →</button></> : null}</li>)}</ul> : null}
    {reviews[k] ? <div className="vf-review" data-fix-part={k}>{reviews[k]}</div> : null}
    {it.act && !it.list ? <p><button type="button" className="btn small" data-val-act={k} onClick={it.act[1]}>{it.act[0]} →</button></p> : null}
    {it.step ? <p><button type="button" className="btn small primary" data-val-fix={it.step} onClick={() => goStep(it)}>{it.go || "Fix on " + stepName(it.step, form)} →</button></p> : null}
  </div>;
}

// the panel. val: checkReturn(); reviews: {k: element}; year: [[k, label, element]]; file: the File row
export function ValidatePanel({ fy, q, form, val, reviews = {}, year = [], file, chIds = [] }) {
  // a list asked for (an old …/checks/<k> address, a year's check) belongs to the return it was asked on
  const at = fy + "|" + q + "|" + form;
  if (S.tdsFix && S.tdsFixAt && S.tdsFixAt !== at && !["limits", "tieout", "rates"].includes(S.tdsFix)) S.tdsFix = "";
  const [moreW, setMoreW] = useState(false);
  const sel = S.tdsFix || "", all = S.tdsValOpen === "*";
  const pick = (k) => { S.tdsFix = S.tdsFix === k ? "" : k; S.tdsFixAt = at; render(); };
  const lines = val.errors.concat(val.warnings, val.info), ySel = year.find(([k]) => k === sel);
  const det = all ? null : sel === "intwork" ? { k: "intwork", short: "Interest and late fee: the working", words: "" } : lines.find((x) => x.k === sel) || null;
  const line = (it, level, hide) => <Line key={it.k} it={it} level={level} form={form} open={sel === it.k} onOpen={() => pick(it.k)} hide={hide} />;
  // "Print all" (S.tdsValOpen "*"): every line's details under it (the interest working once, under More checks); upto: the lines shown (the rest hidden till Show)
  const list = (l, level, upto) => l.map((it, i) => all ? [line(it, level), <li key={it.k + ":d"} className="vf-line vf-inline">{(it.review || it.list || it.leftOut || it.dups) && it.k !== "interest" && it.k !== "fee" ? <Detail it={it} form={form} fy={fy} q={q} reviews={reviews} /> : null}</li>] : line(it, level, upto != null && i >= upto));
  // at most MAX_LINES lines: the rest under "N more" (in the page, hidden till Show)
  const W = val.warnings, nShow = moreW || all || W.length <= MAX_LINES ? W.length : MAX_LINES - 1, restW = W.length - nShow;
  const moreOpen = all || !!ySel || sel === "intwork";
  return <section className="vf" data-validate={form} data-to-fix={sel || "all"}>
    {/* round 94: the number to fix is the header's ("N to fix"), not said again here; the lists say what each is */}
    <div className="vf-counts" data-val-counts="" data-val-errors={val.errors.length} data-val-warnings={val.warnings.length}>
      <span className="ok" data-val-passed={val.passed}>✓ {s_(val.passed, "check passed", "checks passed")}</span>
    </div>
    {val.errors.length > 0 && <><h4 className="vf-h">Errors · block the file</h4><ul className="vf-list" data-val-list="errors">{list(val.errors, "error")}</ul></>}
    {W.length > 0 && <><h4 className="vf-h">Warnings</h4><ul className="vf-list" data-val-list="warnings">{list(W, "warn", nShow)}
      {restW > 0 && <li className="vf-line warn" data-val-more-warn={restW}><div className="vf-row"><span className="vf-ic" aria-hidden="true">!</span><span className="vf-w">{s_(restW, "more warning", "more warnings")}</span>
        <span className="vf-act"><button type="button" className="linkbtn" data-val-more-show="" onClick={() => setMoreW(true)}>Show</button></span></div></li>}</ul></>}
    {!val.errors.length && !W.length && <p className="ok-line" data-fix-none="" data-cm-checks="ok">Nothing to fix in this return.</p>}
    {val.info.length > 0 && <details className="vf-year vf-sugg" data-val-sugg={val.info.length} open={all || val.info.some((x) => x.k === sel)}>
      <summary>Suggestions ({val.info.length})</summary>
      <ul className="vf-list" data-val-list="info">{list(val.info, "info")}</ul>
    </details>}
    <details className="vf-year vf-more" data-val-morechecks="" open={moreOpen}>
      <summary>More checks</summary>
      <div className="vf-orow" data-online="interest"><span className="vf-on">Interest &amp; late fee</span>
        <span className="note">the working, deduction by deduction</span>
        <button type="button" className="btn small" data-int-open="" onClick={() => pick("intwork")}>Details</button></div>
      <Online fy={fy} q={q} form={form} chIds={chIds} />
      <TallyChecks fy={fy} q={q} form={form} />
      {all && <InterestFee fy={fy} q={q} form={form} />}
      {year.length > 0 && <details className="vf-year" data-year-checks="" open={!!ySel || all}>
        <summary>Year checks · {year.map(([, l]) => l).join(" · ")}</summary>
        <p className="vf-ylinks">{year.map(([k, l], i) => <span key={k}>{i > 0 && " · "}<button type="button" className={"linkbtn" + (sel === k ? " on" : "")} data-fix={k} aria-pressed={sel === k} onClick={() => pick(k)}>{l}</button></span>)}</p>
        {year.filter(([k]) => sel === k || all).map(([k, , el]) => <div key={k} data-fix-part={k}>{el}</div>)}
      </details>}
    </details>
    <h4 className="vf-h">File</h4>
    {file}
    <Panel open={!!det} onClose={() => { S.tdsFix = ""; render(); }} title={det ? det.short : ""} wide attrs={{ "data-val-drawer": det ? det.k : "" }}>
      {det ? <Detail it={det} form={form} fy={fy} q={q} reviews={reviews} /> : null}
    </Panel>
  </section>;
}

// the online checks: TRACES PANs, TRACES challan balances, the CSI file, the AI match
function Online({ fy, q, form, chIds }) {
  const [csi, setCsi] = useState(null), [show, setShow] = useState("");
  const co = CO() || {}, path = csi == null ? co.csiFile || "" : csi;
  let unknown = [];
  try { unknown = TDSPanFix.list(form, fy, q).filter((p) => p.pan && Certs.validPan(p.pan) && p.status.state === "unknown").map((p) => p.pan); } catch (e) { /* */ }
  const panOn = typeof PANCheck === "object" && typeof PANCheck.provider === "function";
  let ai = null; try { ai = TDSMatch.aiState(form, fy, q); } catch (e) { /* */ }
  const aiOn = (() => { try { return TDSMatch.aiAllowed() && !!TDSMatch.online(); } catch (e) { return false; } })();
  return <div className="vf-online" data-online-checks="">
    <div className="vf-orow" data-online="pan"><span className="vf-on">TRACES · verify PANs</span>
      <span className="note">{panOn ? (unknown.length ? unknown.length + " not checked yet" : "every PAN checked") : "not connected yet"}</span>
      <button type="button" className="btn small" data-online-run="pan" disabled={!panOn || !unknown.length} onClick={() => tdsPanCheck(unknown)}>Run</button></div>
    <div className="vf-orow" data-online="challans"><span className="vf-on">TRACES · challan balances</span>
      <span className="note">from the TRACES files brought in (After filing)</span>
      <button type="button" className="btn small" data-online-run="challans" aria-expanded={show === "ch"} onClick={() => setShow(show === "ch" ? "" : "ch")}>{show === "ch" ? "Hide" : "Run"}</button></div>
    {show === "ch" && <div className="vf-review"><TracesCheck filter={{ form, fy, q, chIds }} title="TRACES’ consumed amount against FinCom’s used" /></div>}
    <div className="vf-orow" data-online="csi"><span className="vf-on">CSI file (challans from the portal)</span>
      <span className="note">{co.csiFile ? "on the Tally computer: " + co.csiFile : "fetching from the portal is not connected yet"}</span>
      <button type="button" className="btn small" data-online-run="csi" aria-expanded={show === "csi"} onClick={() => setShow(show === "csi" ? "" : "csi")}>{co.csiFile ? "Change" : "Upload"}</button></div>
    {show === "csi" && <div className="vf-review row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="f"><span>Where the CSI file is, on the computer with FinCom Bridge (Check with FVU reads it)</span>
        <input type="text" value={path} placeholder="C:\\TDS\\DELZ12345A.csi" aria-label="CSI file on the Tally computer" style={{ width: 320 }} onChange={(ev) => setCsi(ev.target.value)} /></label>
      <button type="button" className="btn small" data-csi-save="" onClick={() => { coCommit("csiFile", String(path || "").trim()); setShow(""); toast("Kept: Check with FVU uses this CSI file."); }}>Save</button></div>}
    <div className="vf-orow" data-online="prefile"><span className="vf-on">Checks before filing</span>
      <span className="note">FinCom’s full checklist for this return, with its entries and an Excel</span>
      <PreFileButton kind="tds" form={form} fy={fy} q={q} /></div>
    <div className="vf-orow" data-online="ai"><span className="vf-on">AI match (challans)</span>
      <span className="note">{ai && ai.busy ? "AI is looking at what the rules left…" : ai && ai.say ? ai.say : aiOn ? "for what the matching rules leave" : "off (AI help, or not signed in)"}</span>
      <button type="button" className="btn small" data-online-run="ai" disabled={!aiOn || (ai && ai.busy) || TDSReg.locked(fy, q, form)} onClick={() => { TDSMatch.askAi(form, fy, q, true); render(); }}>Run</button></div>
  </div>;
}

// round 86 (19-Oct-2026): "Checks from Tally", folded: Tally's TDS rows of this return's year and quarter with a real
// problem (the rate deducted is not the law's for the section, no PAN, the section unknown), each once, read right
// (TDSTallyRows, src/js/86: the rate is the one booked; Tally's nature master's rate said beside it where it differs).
// The whole list of Tally's TDS rows is no longer on the TDS pages
export function TallyChecks({ fy, q, form }) {
  let c = null;
  try { c = TDSTallyRows.checks(S.coId, fy, q, form); } catch (e) { return null; }
  if (!c || c.off || c.missing || c.err) return null;
  const n = c.rows.length, day = (d) => (d ? fmtDate(tallyDate(d)) : "");
  return <details className="vf-year vf-tally" data-tally-checks={c.busy ? "busy" : n}>
    <summary>Checks from Tally · {c.busy ? "reading Tally’s TDS rows…" : n ? s_(n, "row to look at", "rows to look at") + (c.seen > n ? " of " + c.seen : "") : "nothing to look at"}</summary>
    {c.busy ? <p className="note">Loading…</p> : n ? <ListTable name="tdsTallyChecks" rows={c.rows} rowKey={(w) => w.row.guid + ":" + w.row.line_no} unit={["row", "rows"]} empty={null}
      rowProps={(w) => ({ "data-tally-check": w.problems.map((x) => x.k).join(" ") })}
      cols={[
        { k: "date", role: "date", label: "Date", cls: "dt", v: (w) => w.day, cell: (w) => day(w.day) },
        { k: "party", role: "party", label: "Deductee", v: (w) => w.row.party, cell: (w) => w.row.party },
        { k: "base", role: "amount", label: "Assessable", cls: "n", v: (w) => w.base, sum: true, fmt: money, cell: (w) => money(w.base) },
        { k: "nature", label: "Nature of payment", v: (w) => w.row.nature, cell: (w) => w.row.nature },
        { k: "sec", label: "Section", v: (w) => w.section, cell: (w) => w.section || "—" },
        { k: "rate", label: "Rate", cls: "n", v: (w) => (w.booked == null ? "" : w.booked), cell: (w) => <>{w.booked == null ? "" : w.booked + "%"}{w.note ? <small className="note" data-tally-rate-note="" style={{ display: "block" }}>{w.note}</small> : null}</> },
        { k: "tds", label: "TDS", cls: "n", v: (w) => w.tax || 0, sum: true, fmt: money, cell: (w) => (w.tax == null ? "—" : money(w.tax)) },
        { k: "why", label: "What to look at", cell: (w) => w.problems.map((x) => x.words).join("; ") },
      ]} /> : <p className="note" data-tally-checks-none="">{c.seen ? "Tally’s TDS rows of this quarter have a section and a PAN, at the law’s rates." : "No TDS row in Tally for this quarter."}</p>}
  </details>;
}

// the File row's previous PRN box
export function PrnBox({ fy, q, form }) {
  const [v, setV] = useState(null), cur = v == null ? PrevPrn.get(fy, q, form) : v;
  return <label className="f vf-prn"><span>Previous return’s token (PRN)</span>
    <input type="text" inputMode="numeric" value={cur} placeholder="15 digits" aria-label="Previous return's token (PRN)" data-prev-prn="" style={{ width: 170 }}
      onChange={(ev) => setV(ev.target.value)} onBlur={() => { if (v != null) PrevPrn.set(fy, q, form, v); }} /></label>;
}
