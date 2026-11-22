// The return model: what the two computations take (tax.js, check.js), put together from the books (books.js), the
// files brought in (imports.js) and the owner's answers (b.itr "<ay>|state"). Pure. Every figure says where it came
// from; what is not known stays empty and the checks say so.
import { FORM_OF } from "./law.js";
import { pf36va } from "./books.js";

const N = (v) => +v || 0;
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };

// files: the store's list -> {ais, tis, as26, prefill, ecr[], pfc[], esi[]}
export function importsOf(files) {
  const one = (k) => files.find((f) => f.kind === k) || null;
  return { ais: one("ais"), tis: one("tis"), as26: one("as26"), prefill: one("prefill"), ecr: files.filter((f) => f.kind === "ecr"), pfc: files.filter((f) => f.kind === "pfchallan"), esi: files.filter((f) => f.kind === "esic") };
}

export function formsFor(entity, llp) { const f = (FORM_OF[entity] || ["ITR-5"]).slice(); return entity === "F" && llp ? ["ITR-5"] : f; }

// c: {entity, llp, client: {name, pan, gstin}, state, books (fromApp result or null), imports}
export function buildModel(c) {
  const st = c.state || {}, im = c.imports || {}, bk = c.books && c.books.ok ? c.books : null;
  const entity = c.entity, form = st.form || formsFor(entity, c.llp)[0];
  const M = { form, entity, llp: !!c.llp, regime: st.regime || (entity === "C" ? "" : entity === "F" ? "firm" : ""), age: N(st.age), resident: st.resident !== false,
    audit: !!st.audit, tp: !!st.tp, filingDate: st.filingDate || "", smallCo: st.smallCo, form10iea: st.form10iea || "", deductions: st.deductions || {}, losses: st.losses || {}, matCredit: N(st.matCredit) };
  if (entity === "F") M.regime = "firm";
  // business income
  if (form === "ITR-4") {
    const p = st.presumptive || {};
    M.presumptive = {};
    if (p.ad) M.presumptive.ad = { digital: N(p.ad.digital), other: N(p.ad.other), declared: p.ad.declared == null || p.ad.declared === "" ? null : N(p.ad.declared) };
    if (p.ada) M.presumptive.ada = { receipts: N(p.ada.receipts), cash: N(p.ada.cash), declared: p.ada.declared == null || p.ada.declared === "" ? null : N(p.ada.declared) };
    if (p.ae && (p.ae.vehicles || []).length) M.presumptive.ae = { vehicles: p.ae.vehicles, declared: p.ae.declared == null || p.ae.declared === "" ? null : N(p.ae.declared) };
    M.turnover = R(N(p.ad && p.ad.digital) + N(p.ad && p.ad.other) + N(p.ada && p.ada.receipts));
  } else if (bk) {
    const adj = bk.adj, edits = st.adjEdits || {};
    const keep = (a) => (edits[a.key] && edits[a.key].v != null ? Object.assign({}, a, { amt: N(edits[a.key].v), why: edits[a.key].why, edited: true }) : a);
    M.business = { pbt: bk.sched.totals.pbt, pbtSrc: "Part A-P&L (the books)", adds: adj.adds.map(keep).filter((a) => R(a.amt)), less: adj.less.map(keep).filter((a) => R(a.amt)), itDep: adj.itDep };
    (st.extraAdj || []).forEach((a) => (a.sign < 0 ? M.business.less : M.business.adds).push({ key: "own:" + a.id, label: a.label, amt: N(a.amt), bp: a.bp || (a.sign < 0 ? "AnyOthAmtAllDeduct" : "OthItemDisallowUs28To44DA"), src: "entered by " + (a.by || "the owner") + ": " + (a.why || ""), trace: [] }));
    M.turnover = bk.sched.totals.revenue;
    M.bookProfit = entity === "C" ? (st.bookProfit != null && st.bookProfit !== "" ? N(st.bookProfit) : bk.sched.totals.pat + bk.sched.pl.taxCurrent.cy + bk.sched.pl.taxDeferred.cy) : undefined;
    if (entity === "F") M.partners = (st.partners || []).map((p) => ({ name: p.name, remuneration: N(p.remuneration), interest: N(p.interest), rate: N(p.rate), working: p.working !== false }));
  }
  if (entity === "C" && M.bookProfit == null && st.bookProfit != null) M.bookProfit = N(st.bookProfit);
  // other sources: the interest the books hold (moved out of business) and what the owner adds
  const interestBooks = bk ? bk.sched.pl.interestInc.cy : 0;
  M.os = { interest: R(interestBooks + N(st.osInterest)), dividend: R(st.osDividend), other: R(st.osOther) };
  M.interestSrc = "the books' interest income" + (N(st.osInterest) ? " + " + R(st.osInterest) + " entered" : "");
  if (st.salary && N(st.salary.gross)) M.salary = { gross: N(st.salary.gross), std: Math.min(N(st.salary.gross), M.regime === "old" ? 50000 : 75000) };
  if (st.hp != null && st.hp !== "") M.hp = N(st.hp);
  if (st.cg) M.cg = st.cg;
  // taxes paid: the 26AS lines (they carry the TAN and BSR the JSON needs); the books' figures are checked against them
  const as26 = im.as26 && im.as26.data;
  M.paid = { tds: [], tcs: [], advance: [], selfAssessment: [] };
  if (as26) {
    M.paid.tds = as26.tds.map((r) => ({ tan: r.tan, name: r.name, sec: r.sec, gross: r.amount, amt: r.tax, date: r.date }));
    M.paid.tcs = as26.tcs.map((r) => ({ tan: r.tan, name: r.name, sec: r.sec, gross: r.amount, amt: r.tax }));
    as26.paid.forEach((p) => { const x = { bsr: p.bsr, date: p.date, serial: p.serial, amt: p.amount }; if (p.kind === "advance") M.paid.advance.push(x); else if (p.kind === "self") M.paid.selfAssessment.push(x); });
    M.tdsSrc = "Form 26AS (the books' TDS receivable is checked against it)"; M.advSrc = "Form 26AS challans";
  }
  (st.saPaid || []).forEach((p) => { if (!M.paid.selfAssessment.some((x) => x.bsr === p.bsr && x.date === p.date && String(x.serial) === String(p.serial))) M.paid.selfAssessment.push({ bsr: p.bsr, date: p.date, serial: p.serial, amt: N(p.amt), src: "entered" }); });
  M.pf36va = pf36va(im.ecr, im.pfc, im.esi);
  // the books' own figures to check the return's against
  // the tax ledgers of the books at 31-03-2026 (Balances with revenue authorities, by name): TDS, TCS, advance tax
  if (bk) {
    const tr = bk.sched.bs.revenueAuth.trace, by = (re, not) => tr.filter((t) => re.test(t.ledger) && !(not && not.test(t.ledger)));
    const tot = (xs) => R(xs.reduce((s, t) => s + N(t.amt), 0));
    const tdsL = by(/\bTDS\b|TAX DEDUCTED/i, /TCS|PAYABLE/i), tcsL = by(/\bTCS\b|TAX COLLECTED/i, /PAYABLE/i), advL = by(/ADVANCE TAX|ADVANCE INCOME TAX/i), saL = by(/SELF.?ASSESSMENT/i);
    M.books = { tds: tdsL.length ? tot(tdsL) : null, tdsLedgers: tdsL, tcs: tcsL.length ? tot(tcsL) : null, tcsLedgers: tcsL, adv: advL.length ? tot(advL) : null, advLedgers: advL, sa: saL.length ? tot(saL) : null };
  }
  return M;
}

// the details the JSON needs about the person: the client record, the pre-filled data, then the owner's own entries
export function buildProfile(c) {
  const st = c.state || {}, pre = c.imports && c.imports.prefill && c.imports.prefill.data, cl = c.client || {}, own = st.profile || {};
  const name = String(cl.name || "").trim().toUpperCase(), parts = name.split(/\s+/);
  const org = c.entity === "C" || c.entity === "F";
  const p = { pan: cl.pan || "", orgName: org ? name : "", first: org ? "" : parts.length > 1 ? parts[0] : "", sur: org ? name : parts.length > 1 ? parts.slice(1).join(" ") : name };
  const src = { pan: "Client setup", sur: "Client setup" };
  if (pre) {
    if (pre.dob) { p.dob = pre.dob.slice(0, 4) + "-" + pre.dob.slice(4, 6) + "-" + pre.dob.slice(6, 8); src.dob = "pre-filled data"; }
    if (pre.addr) { p.address = { flat: (pre.addr.line || "").split(",")[0], street: (pre.addr.line || "").split(",")[1], locality: (pre.addr.line || "").split(",").slice(2).join(",").trim() || pre.addr.city, city: pre.addr.city, state: String(pre.addr.state || "").padStart(2, "0"), pin: pre.addr.pin }; src.address = "pre-filled data"; }
    if (pre.email) { p.email = pre.email; src.email = "pre-filled data"; } if (pre.mobile) { p.mobile = pre.mobile; src.mobile = "pre-filled data"; }
    if (pre.bank && pre.bank[0]) { p.bank = { ifsc: pre.bank[0].ifsc, name: pre.bank[0].bank, account: pre.bank[0].account, type: "SB" }; src.bank = "pre-filled data"; }
  }
  Object.keys(own).forEach((k) => { if (own[k] !== "" && own[k] != null) { p[k] = own[k]; src[k] = "entered"; } });
  if (!p.verPan && !org) p.verPan = p.pan;
  if (!p.verName && !org) p.verName = [p.first, p.middle, p.sur].filter(Boolean).join(" ");
  p.src = src;
  return p;
}
