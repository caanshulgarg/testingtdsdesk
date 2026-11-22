// The return model: what the two computations take (tax.js, check.js), put together from the books (books.js), the
// files brought in (imports.js) and the owner's answers (b.itr "<ay>|state"). Pure. Every figure says where it came
// from; what is not known stays empty and the checks say so.
import { FORM_OF } from "./law.js";
import { pf36va, settle36va, settle43B, settleMsme, adjustments } from "./books.js";

const N = (v) => +v || 0;
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };

// files: the store's list -> {ais, tis, as26, prefill, ecr[], pfc[], esi[]}
export function importsOf(files) {
  const one = (k) => files.find((f) => f.kind === k) || null;
  return { ais: one("ais"), tis: one("tis"), as26: one("as26"), prefill: one("prefill"), ecr: files.filter((f) => f.kind === "ecr"), pfc: files.filter((f) => f.kind === "pfchallan"), esi: files.filter((f) => f.kind === "esic") };
}

// the head of income a TDS section's receipt belongs to (Schedule TDS2 HeadOfIncome)
export function headOf(sec, M) {
  const s = String(sec || "").toUpperCase().replace(/[()]/g, "");
  if (/^(193|194|194A|194B|194BB|194EE|194K|194LA|194LB|194LBA|194LBB|194LBC|194N|194S|194BA)$/.test(s)) return "OS";
  if (/^194I|^194IB/.test(s)) return M && M.hp != null ? "HP" : "OS";
  return "BP";
}
export function formsFor(entity, llp) { const f = (FORM_OF[entity] || ["ITR-5"]).slice(); return entity === "F" && llp ? ["ITR-5"] : f; }

// c: {entity, llp, client: {name, pan, gstin}, state, books (fromApp result or null), imports}
export function buildModel(c) {
  const st = c.state || {}, im = c.imports || {}, bk = c.books && c.books.ok ? c.books : null;
  const entity = c.entity, form = st.form || formsFor(entity, c.llp)[0];
  // LLP or firm: asked in the return (Client setup has "Firm or LLP" as one choice); never read from the name
  const M = { form, entity, llp: entity === "F" ? (st.llp === true || st.llp === false ? st.llp : (c.llp === true || c.llp === false ? c.llp : undefined)) : false, regime: st.regime || (entity === "C" ? "" : entity === "F" ? "firm" : ""), age: N(st.age), resident: st.resident !== false,
    audit: !!st.audit, tp: !!st.tp, filingDate: st.filingDate || "", smallCo: st.smallCo, bookProfitOk: !!st.bookProfitOk, form10iea: st.form10iea || "", deductions: st.deductions || {}, losses: st.losses || {}, matCredit: N(st.matCredit) };
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
    // 43B, 43B(h), 36(1)(va) and the earlier years' 43B are worked out here, from the books' items and the owner's answers
    // (a payment date given on Checks changes the computation at once)
    const OWN = new Set(["43b", "43bh", "36va"]);
    M.business = { itBlocks: (bk.f && bk.f.itBlocks) || [], pbt: bk.sched.totals.pbt, pbtSrc: "Part A-P&L (the books)", adds: adj.adds.filter((a) => !OWN.has(a.key)).map(keep).filter((a) => R(a.amt)), less: adj.less.filter((a) => a.key !== "43b_prior").map(keep).filter((a) => R(a.amt)), itDep: adj.itDep };
    const ans = st.paidOn || {};
    M.dues43B = settle43B(bk.dues43B || [], ans, c.due || "20260831");
    M.msme = settleMsme(bk.msme || null, ans);
    M.prior43B = prior43B(bk, st, c.prevState);
    const own = adjustments({ dues43B: M.dues43B, msmeRows: M.msme ? M.msme.rows : [], pf36va: settle36va(pf36va(im.ecr, im.pfc, im.esi), ans), prior43BPaid: M.prior43B.amt, prior43BSrc: M.prior43B.src, prior43BTrace: M.prior43B.trace });
    own.adds.forEach((a) => M.business.adds.push(keep(a))); own.less.forEach((a) => M.business.less.push(keep(a)));
    M.business.adds = M.business.adds.filter((a) => R(a.amt)); M.business.less = M.business.less.filter((a) => R(a.amt));
    (st.extraAdj || []).forEach((a) => (a.sign < 0 ? M.business.less : M.business.adds).push({ key: "own:" + a.id, label: a.label, amt: N(a.amt), bp: a.bp || (a.sign < 0 ? "AnyOthAmtAllDeduct" : "OthItemDisallowUs28To44DA"), src: "entered by " + (a.by || "the owner") + ": " + (a.why || ""), trace: [] }));
    M.turnover = bk.sched.totals.revenue;
    M.bookProfit = entity === "C" ? (st.bookProfit != null && st.bookProfit !== "" ? N(st.bookProfit) : bk.sched.totals.pat + bk.sched.pl.taxCurrent.cy + bk.sched.pl.taxDeferred.cy) : undefined;
    if (entity === "F") { M.partners = (st.partners || []).map((p) => ({ name: p.name, remuneration: N(p.remuneration), interest: N(p.interest), rate: N(p.rate), working: p.working !== false })); M.partnersDetail = (st.partners || []).slice(); }
  }
  if (entity === "C" && M.bookProfit == null && st.bookProfit != null) M.bookProfit = N(st.bookProfit);
  // other sources: the interest the books hold (moved out of business) and what the owner adds
  const interestBooks = bk ? bk.sched.pl.interestInc.cy : 0;
  M.os = { interest: R(interestBooks + N(st.osInterest)), dividend: R(st.osDividend), other: R(st.osOther) };
  M.interestSrc = "the books' interest income" + (N(st.osInterest) ? " + " + R(st.osInterest) + " entered" : "");
  if (st.salary && N(st.salary.gross)) M.salary = { gross: N(st.salary.gross), std: Math.min(N(st.salary.gross), M.regime === "old" ? 50000 : 75000) };
  if (st.hp != null && st.hp !== "") M.hp = N(st.hp);
  if (st.cg) M.cg = st.cg;
  if (st.cg112A && N(st.cg112A.sale)) M.cg112A = { sale: N(st.cg112A.sale), cost: N(st.cg112A.cost) };
  if (Array.isArray(st.matCredits)) M.matCredits = st.matCredits;
  // taxes paid: the 26AS lines (they carry the TAN and BSR the JSON needs); the books' figures are checked against them
  const as26 = im.as26 && im.as26.data;
  M.paid = { tds: [], tcs: [], advance: [], selfAssessment: [] };
  if (as26) {
    // only lines TRACES shows as finally booked (status F) are claimed; U, P, O and a status not read are asked (verify.js)
    M.paid.tds = as26.tds.filter((r) => String(r.status || "").toUpperCase() === "F").map((r) => ({ tan: r.tan, name: r.name, sec: r.sec, gross: r.amount, amt: r.tax, date: r.date, head: headOf(r.sec, M) }));
    M.paid.tcs = as26.tcs.map((r) => ({ tan: r.tan, name: r.name, sec: r.sec, gross: r.amount, amt: r.tax }));
    as26.paid.forEach((p) => { const x = { bsr: p.bsr, date: p.date, serial: p.serial, amt: p.amount }; if (p.kind === "advance") M.paid.advance.push(x); else if (p.kind === "self") M.paid.selfAssessment.push(x); });
    M.tdsSrc = "Form 26AS (the books' TDS receivable is checked against it)"; M.advSrc = "Form 26AS challans";
  }
  (st.saPaid || []).forEach((p) => { if (!M.paid.selfAssessment.some((x) => x.bsr === p.bsr && x.date === p.date && String(x.serial) === String(p.serial))) M.paid.selfAssessment.push({ bsr: p.bsr, date: p.date, serial: p.serial, amt: N(p.amt), src: "entered" }); });
  M.pf36va = settle36va(pf36va(im.ecr, im.pfc, im.esi), st.paidOn);
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

// earlier years' 43B (and 43B(h)) dues paid this year, allowed now (AmtDisallUs43BNowAllow): from last year's return
// made in FinCom (its version keeps what 43B added back, by ledger), else the owner's figure; with dues payable at the
// start of the year and no figure, it is asked (the JSON waits). Payments in the year settle the opening balance oldest
// first: a ledger's part allowed last year (paid by last year's due date) first, then last year's add-back.
// -> {amt, src, trace, ask (true: to be answered), rows}
export function prior43B(bk, st, prev) {
  const rows = (bk && bk.prior43B) || [], ms = bk && bk.msme, msPrior = ms ? (ms.priorParties || []).length > 0 || (ms.prior || []).length > 0 : false;
  const vs = (prev && prev.versions) || [], last = vs.length ? vs[vs.length - 1] : null;
  if (last && Array.isArray(last.dis43B)) {
    const trace = [];
    let amt = 0;
    last.dis43B.forEach((d) => {
      const r = rows.find((x) => x.ledger === d.ledger), dl = N(d.amt);
      const u = r ? Math.min(dl, Math.max(0, r.paidInYear - Math.max(0, r.opening - dl))) : 0;
      amt += u; trace.push({ ledger: d.ledger, group: "added back last year " + R(dl) + (r ? ", paid in the year " + R(r.paidInYear) : ", ledger not in the books"), amt: R(u) });
    });
    return { amt: R(amt), src: "last year's return made in FinCom (v" + last.v + "), paid in FY 2025-26", trace, ask: false, rows };
  }
  if (st.prior43BPaid != null && st.prior43BPaid !== "") return { amt: R(st.prior43BPaid), src: "entered by the owner: earlier years' 43B paid in FY 2025-26", trace: [], ask: false, rows, entered: true };
  return { amt: 0, src: "", trace: [], ask: rows.some((r) => r.paidInYear > 0) || msPrior, rows };
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
