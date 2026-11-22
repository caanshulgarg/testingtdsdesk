// The CA's review of a return, as checks. Pure: verify(ctx) -> [check]. Each check:
//   {id, group, title, status: "matched" | "difference" | "missing" | "needs", diff (rupees, a - b), a: {label, amt, src},
//    b: {label, amt, src}, rows: [{label, a, b, diff, src?}], text (one line), how (what to do)}
// "matched" only when the two sides agree to the rupee (exact or nothing). Nothing is guessed: what FinCom cannot know
// is "needs" (the owner answers), what is not there is "missing". gate() says whether the JSON may be offered.
import { check as recheck, differences } from "./check.js";

const N = (v) => +v || 0;
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };
const sumBy = (xs, f) => (xs || []).reduce((s, x) => s + N(f(x)), 0);
export const GROUPS = [["ais", "26AS, AIS and TIS"], ["books", "Tally books"], ["gst", "GST"], ["tds", "TDS returns"], ["pf", "PF and ESI"], ["3cd", "Tax audit (3CD)"], ["comp", "The computation"]];

function two(id, group, title, a, b, rows, how) {
  const diff = R(N(a.amt) - N(b.amt));
  return { id, group, title, status: diff === 0 ? "matched" : "difference", diff, a: Object.assign({}, a, { amt: R(a.amt) }), b: Object.assign({}, b, { amt: R(b.amt) }), rows: rows || [], how: diff ? how || "" : "" };
}
const missing = (id, group, title, text, how) => ({ id, group, title, status: "missing", text, how: how || "" });
// a "needs" is answered by the owner with a note (it is then "answered"); fix: true when only a change to the data settles it
const needs = (id, group, title, text, how, rows, fix) => ({ id, group, title, status: "needs", text, how: how || "", rows: rows || [], noAccept: !!fix });

export function verify(c) {
  const out = [], im = c.imports || {}, M = c.model || {}, S = c.main || {};
  const as26 = im.as26 && im.as26.data, ais = im.ais && im.ais.data, tis = im.tis && im.tis.data, bk = c.books || null;
  const paid = M.paid || {};

  // ---------- 26AS / AIS / TIS ----------
  if (!as26) out.push(missing("as26", "ais", "Form 26AS", "Not brought in.", "Download 26AS from TRACES (View Tax Credit, export as text) and bring it in."));
  if (!ais) out.push(missing("ais_file", "ais", "AIS", "Not brought in.", "Download the AIS JSON from the compliance portal and bring it in."));
  if (as26) {
    // TDS credit by deductor and section: the return's claim against 26AS
    const key = (r) => r.tan + " " + r.sec;
    const fx = {}, cl = {};
    as26.tds.forEach((r) => { const k = key(r); fx[k] = fx[k] || { tan: r.tan, name: r.name, sec: r.sec, amt: 0 }; fx[k].amt += N(r.tax); });
    (paid.tds || []).forEach((r) => { const k = r.tan + " " + r.sec; cl[k] = cl[k] || { tan: r.tan, name: r.name, sec: r.sec, amt: 0 }; cl[k].amt += N(r.amt); });
    const keys = [...new Set(Object.keys(fx).concat(Object.keys(cl)))].sort();
    const rows = keys.map((k) => ({ label: (fx[k] || cl[k]).name + " (" + (fx[k] || cl[k]).tan + ", " + (fx[k] || cl[k]).sec + ")", a: null, b: R((fx[k] || {}).amt) }));
    // the books' TDS receivable against 26AS (the return claims the 26AS lines: they carry the TANs the schedule needs)
    const B = M.books || {}, led = (xs) => (xs || []).map((t) => t.ledger).join(", ");
    if (B.tds == null) out.push(needs("tds_26as", "ais", "TDS credit: the books against 26AS", "No TDS receivable ledger was found in the books (by name) to check 26AS against.", "Say which ledger holds the TDS receivable, or accept the 26AS figure.", rows));
    else out.push(two("tds_26as", "ais", "TDS credit: the books against 26AS", { label: "TDS receivable in the books", amt: B.tds, src: led(B.tdsLedgers) + " at 31-03-2026" },
      { label: "Form 26AS", amt: sumBy(as26.tds, (x) => x.tax), src: "26AS Part I, " + as26.tds.length + " lines" }, rows, "Claim only what 26AS shows; a deduction booked but not in 26AS is followed up with the deductor."));
    if (as26.tcs.length || B.tcs != null) out.push(B.tcs == null ? needs("tcs_26as", "ais", "TCS credit: the books against 26AS", "26AS shows TCS of " + R(sumBy(as26.tcs, (x) => x.tax)) + "; no TCS receivable ledger was found in the books.", "Book it, or say where it is.")
      : two("tcs_26as", "ais", "TCS credit: the books against 26AS", { label: "TCS receivable in the books", amt: B.tcs, src: led(B.tcsLedgers) }, { label: "Form 26AS", amt: sumBy(as26.tcs, (x) => x.tax), src: "26AS Part VI" }));
    const advBk = B.adv != null ? B.adv : sumBy(paid.advance, (x) => x.amt), adv26 = sumBy(as26.paid.filter((p) => p.kind === "advance"), (x) => x.amount);
    M.advSrc = B.adv != null ? led(B.advLedgers) + " in the books" : "no advance tax ledger in the books";
    const chRows = as26.paid.filter((p) => p.kind === "advance" || p.kind === "self").map((p) => {
      const mine = (paid.advance || []).concat(paid.selfAssessment || []).find((x) => x.bsr === p.bsr && x.date === p.date && String(x.serial || "") === String(p.serial || ""));
      return { label: (p.kind === "advance" ? "Advance tax " : "Self-assessment tax ") + p.date.slice(6, 8) + "-" + p.date.slice(4, 6) + "-" + p.date.slice(0, 4) + " BSR " + p.bsr + " / " + p.serial, a: R(mine ? mine.amt : 0), b: R(p.amount), diff: R((mine ? mine.amt : 0) - p.amount) };
    });
    out.push(two("adv_tax", "ais", "Advance tax challans", { label: "Advance tax in the books", amt: advBk, src: M.advSrc }, { label: "Form 26AS", amt: adv26, src: "26AS, tax paid (minor head 100)" }, chRows.filter((r) => r.diff && /^Advance/.test(r.label))));
    out.push(two("sa_tax", "ais", "Self-assessment tax challans", { label: "In the return", amt: sumBy(paid.selfAssessment, (x) => x.amt), src: "self-assessment tax entered" }, { label: "Form 26AS", amt: sumBy(as26.paid.filter((p) => p.kind === "self"), (x) => x.amount), src: "26AS, tax paid (minor head 300)" }, chRows.filter((r) => r.diff && /^Self/.test(r.label))));
    if (im.as26.read && im.as26.read.selfCheckOk === false) out.push(needs("as26_self", "ais", "26AS read completely", "The lines read from 26AS do not add up to its own totals for every deductor.", "Bring in the text export instead of the PDF."));
  }
  if (ais) {
    const cat = (k) => ais.rows.filter((r) => r.cat === k);
    const inc = M.os || {};
    out.push(two("ais_interest", "ais", "Interest (AIS against the return)", { label: "In the return", amt: N(inc.interest) + (bk ? 0 : 0), src: M.interestSrc || "interest income in the books" }, { label: "AIS", amt: sumBy(cat("interest"), (x) => x.amount), src: cat("interest").map((x) => x.code).join(", ") || "AIS" },
      cat("interest").map((x) => ({ label: (x.src || x.desc) + (x.srcId ? " (" + x.srcId + ")" : ""), a: null, b: R(x.amount) })), "Every interest the AIS reports is income of the year (savings interest too). Where the books differ, find the account."));
    out.push(two("ais_dividend", "ais", "Dividend", { label: "In the return", amt: N(inc.dividend), src: "dividend in the books" }, { label: "AIS", amt: sumBy(cat("dividend"), (x) => x.amount), src: "AIS" }));
    if (cat("rent").length || N(inc.rent)) out.push(two("ais_rent", "ais", "Rent received", { label: "In the return", amt: N(inc.rent) + N(M.hpRent), src: "rent in the books" }, { label: "AIS", amt: sumBy(cat("rent"), (x) => x.amount), src: "AIS" }));
    const hv = ais.rows.filter((r) => ["hv", "purchase", "sale"].includes(r.cat));
    if (hv.length) out.push(needs("ais_hv", "ais", "High-value purchases and sales in the AIS", hv.length + " transactions of " + R(sumBy(hv, (x) => x.amount)) + ". Say where each is in the books.", "Mark each as in the books (and where) or give feedback on the AIS.",
      hv.map((x) => ({ label: x.code + " " + (x.desc || "") + (x.src ? ", " + x.src : ""), b: R(x.amount) }))));
    const g = cat("gst");
    if (g.length) out.push(two("ais_gst", "ais", "GST turnover in the AIS against the return", { label: "Turnover in the return", amt: N(M.turnover), src: "Part A-P&L, revenue from operations" }, { label: "AIS (GST)", amt: sumBy(g, (x) => x.amount), src: "AIS, GSTR-3B" }, [], "The reasons are listed under GST."));
    // AIS against 26AS: the same deductions in both
    if (as26) {
      const aisTds = ais.rows.filter((r) => /^TDS/i.test(r.code) || (r.tax && r.sec)), t1 = sumBy(aisTds, (x) => x.tax), t2 = sumBy(as26.tds, (x) => x.tax);
      out.push(two("ais_26as", "ais", "TDS in the AIS against 26AS", { label: "AIS", amt: t1, src: "AIS TDS lines" }, { label: "Form 26AS", amt: t2, src: "26AS Part I" }));
    }
  }
  if (tis) {
    const bus = tis.rows.find((r) => /business receipt/i.test(r.desc));
    // the receipts others reported (TDS / TCS on them) must be within the turnover the return declares
    if (bus) { const turn = N(M.turnover), over = R(N(bus.amount) - turn);
      out.push({ id: "tis_business", group: "ais", title: "Business receipts in the TIS within the turnover", status: over > 0 ? "difference" : "matched", diff: over > 0 ? over : 0,
        a: { label: "Turnover in the return", amt: R(turn), src: "Part A-P&L, revenue from operations" }, b: { label: "TIS, business receipts", amt: R(bus.amount), src: "TIS (receipts others reported)" }, rows: [],
        how: over > 0 ? "Others reported more receipts than the turnover: find the receipts not booked, or give feedback on the AIS." : "" }); }
  }

  // ---------- Tally books ----------
  if (bk && bk.sched) {
    const t = bk.sched.totals;
    out.push(two("bs_tally", "books", "Balance sheet: sources equal application", { label: "Sources of funds", amt: t.sources, src: "Part A-BS" }, { label: "Application of funds", amt: t.apply, src: "Part A-BS" }, [], "A ledger without a code or with the wrong side: see the ledgers not placed."));
    if (bk.plPbt != null) out.push(two("pl_ties", "books", "Profit before tax ties to the statements", { label: "Part A-P&L", amt: t.pbt, src: "from the trial balance codes" }, { label: "Financial statements", amt: bk.plPbt, src: "Statements › Profit and loss" }));
    const un = (bk.sched.unmapped || []).concat(bk.sched.unplaced || []);
    out.push(un.length ? Object.assign(two("ledgers_placed", "books", "Every ledger is in a schedule line", { label: "Ledgers not placed", amt: sumBy(un, (x) => Math.abs(x.amt)), src: un.length + " ledgers" }, { label: "Allowed", amt: 0, src: "" }, un.map((x) => ({ label: x.ledger, a: x.amt, b: 0, diff: x.amt })), "Give each a line on Statements › Trial balance."), {}) : { id: "ledgers_placed", group: "books", title: "Every ledger is in a schedule line", status: "matched", diff: 0, rows: [] });
    if (bk.opening) out.push(two("opening", "books", "Opening balances equal last year's closing", { label: "Opening balances in Tally (1-4-2025)", amt: bk.opening.tally, src: "Tally" }, { label: "Last year's closing", amt: bk.opening.lastYear, src: bk.opening.src }, bk.opening.rows || []));
    else out.push(missing("opening", "books", "Opening balances equal last year's closing", "Last year's audited balance sheet or ITR is not in FinCom.", "Bring in last year's balance sheet on Statements, or last year's ITR JSON on Fixed assets."));
    if (bk.capital) out.push(two("capital", "books", "Capital account movement", { label: "Closing capital", amt: bk.capital.closing, src: "Part A-BS" }, { label: "Opening + profit + introduced - drawings", amt: bk.capital.opening + bk.capital.profit + bk.capital.introduced - bk.capital.drawings, src: "capital ledgers and the P&L" }));
  } else out.push(missing("books", "books", "Tally books", (bk && bk.missing && bk.missing.join(" ")) || "The books are not in.", "Bring the books in from Tally."));

  // ---------- GST ----------
  if (c.gst && c.gst.ok) {
    const g = c.gst, reasons = (g.reasons || []).filter((x) => R(x.amt));
    const explained = sumBy(reasons, (x) => x.amt);
    out.push(two("gst_r1", "gst", "Turnover against GSTR-1", { label: "Turnover in the return", amt: N(M.turnover), src: "Part A-P&L" }, { label: "GSTR-1 + reasons", amt: N(g.r1) + explained, src: "GSTR-1 for FY 2025-26 (" + g.months + " months)" },
      reasons.map((x) => ({ label: x.label, a: null, b: R(x.amt) })), "List each reason (advances, credit notes, exempt or non-GST supplies, other GSTINs) until nothing is left unexplained."));
    if (g.r3b != null) out.push(two("gst_3b", "gst", "GSTR-1 against GSTR-3B", { label: "GSTR-1 outward supplies", amt: g.r1, src: "GSTR-1" }, { label: "GSTR-3B outward supplies", amt: g.r3b, src: "GSTR-3B" }));
  } else out.push(missing("gst", "gst", "GST returns for FY 2025-26", (c.gst && c.gst.text) || "No GST returns in FinCom for the year.", "Open GST for the client, or say the client is not registered."));

  // ---------- TDS returns ----------
  if (c.tds && c.tds.ok) {
    const t = c.tds;
    out.push(two("tds_payable", "tds", "TDS deducted (26Q and 24Q) against TDS payable in the books", { label: "Deducted per FinCom's 26Q / 24Q", amt: t.deducted, src: "TDS › the four quarters" }, { label: "Credited to TDS payable in the books", amt: t.payable, src: "TDS payable ledgers" }));
    out.push(two("tds_paid", "tds", "TDS deducted against TDS deposited", { label: "Deducted", amt: t.deducted, src: "26Q / 24Q" }, { label: "Deposited by challan", amt: t.deposited, src: "Challans matched" }, (t.unpaid || []).map((x) => ({ label: x.party + " " + x.section, a: R(x.tds), b: 0, diff: R(x.tds) })), "TDS not deposited by the due date of the return: 30% of the expense is disallowed (40(a)(ia)); shown in the computation."));
    const dis = (S.lines || []).find((l) => l.key === "add:40aia");
    out.push({ id: "tds_40aia", group: "tds", title: "Section 40(a)(ia) worked out", status: "matched", diff: 0, text: dis ? "Added back " + dis.amt + " (30% of the sums without TDS)." : "Nothing to add back.", rows: (dis && dis.trace || []).map((x) => ({ label: x.ledger + " " + x.group, a: x.amt })) });
  } else out.push(missing("tds", "tds", "TDS returns in FinCom", (c.tds && c.tds.text) || "No TDS data for the year.", "Open TDS for the client."));

  // ---------- PF / ESI ----------
  const ecr = im.ecr || [], pfc = im.pfc || [], esi = im.esi || [];
  if (c.pfInBooks || ecr.length || pfc.length) {
    if (!ecr.length) out.push(missing("pf_ecr", "pf", "PF ECRs for the year", "The books show PF; no ECR is brought in.", "Bring in each month's ECR and its challan."));
    else {
      const months = ecr.map((e) => e.wageMonth), want = []; for (let y = 2025, m = 4; !(y === 2026 && m === 4); m++) { if (m > 12) { m = 1; y++; } if (y === 2026 && m === 4) break; want.push(String(y) + String(m).padStart(2, "0")); }
      const gap = want.filter((m) => !months.includes(m));
      if (gap.length) out.push(missing("pf_months", "pf", "An ECR for every month", gap.length + " months have no ECR: " + gap.map((m) => m.slice(4, 6) + "-" + m.slice(0, 4)).join(", ") + ".", "Bring them in, or say there were no employees in PF in those months."));
      const er = sumBy(ecr, (e) => N(e.data.eps) + N(e.data.er));
      if (c.pfBooks != null) out.push(two("pf_books", "pf", "Employer's PF in the books against the ECRs", { label: "Contribution to PF in the books", amt: c.pfBooks, src: "Part A-P&L, contribution to PF" }, { label: "Employer's share in the ECRs", amt: er + N(c.pfAdminCharges), src: ecr.length + " ECRs" + (c.pfAdminCharges ? " + admin charges" : "") }));
      const noCh = ecr.filter((e) => !pfc.some((p) => p.wageMonth === e.wageMonth));
      if (noCh.length) out.push(missing("pf_challans", "pf", "A challan for every ECR", noCh.length + " months have an ECR but no challan: their payment dates are not known.", "Bring in the payment receipts (they show the date of credit)."));
    }
    const late = (c.pf36va || []).filter((x) => x.late && !x.missing);
    out.push({ id: "pf_36va", group: "pf", title: "Employees' share paid by the 15th (36(1)(va))", status: late.length ? "difference" : "matched", diff: R(sumBy(late, (x) => x.ee)),
      a: { label: "Paid late", amt: R(sumBy(late, (x) => x.ee)), src: "challans brought in" }, b: { label: "Allowed", amt: 0, src: "" },
      rows: late.map((x) => ({ label: x.fund + " " + x.ym.slice(4, 6) + "-" + x.ym.slice(0, 4) + ": due " + x.due.slice(6, 8) + "-" + x.due.slice(4, 6) + ", paid " + x.paidOn.slice(6, 8) + "-" + x.paidOn.slice(4, 6) + "-" + x.paidOn.slice(0, 4), a: R(x.ee) })),
      how: late.length ? "Disallowed for good (no grace days, Checkmate Services, SC 2022); added back in the computation. Accept each with a note." : "" });
  }

  // ---------- 3CD ----------
  if (M.audit) {
    if (!c.form3cd) out.push(missing("3cd", "3cd", "Form 3CD drafted in FinCom", "The tax audit applies; no 3CD draft for the year.", "Run Audit for the year: its 3CD draft fills itself."));
    else c.form3cd.forEach((x) => out.push(two("3cd_" + x.clause, "3cd", "3CD clause " + x.clause + " against the return", { label: "Form 3CD", amt: x.amt, src: "Audit › 3CD draft" }, { label: "Schedule BP", amt: x.itr, src: x.itrSrc })));
  }

  // ---------- the computation ----------
  (S.needs || []).forEach((n) => out.push(needs("need_" + n.key, "comp", n.text.split(":")[0], n.text, "Change it on Data.", [], true)));
  (S.warn || []).forEach((w) => out.push({ id: "warn_" + w.key, group: "comp", title: w.text.split(/[.:]/)[0], status: "difference", diff: 0, text: w.text, rows: [], how: "Correct the figure, or accept it with a note." }));
  const sane = sanity(M, S); sane.forEach((x) => out.push(x));
  const b2 = recheck(M), dd = differences(S.key || {}, b2);
  out.push({ id: "two_computations", group: "comp", title: "Two independent computations agree", status: dd.length ? "difference" : "matched", diff: dd.length ? dd[0].diff : 0,
    a: { label: "Computation", amt: S.liability, src: "tax.js" }, b: { label: "Second check", amt: b2.liability, src: "check.js" },
    rows: dd.map((x) => ({ label: x.key, a: x.main, b: x.check, diff: x.diff })), text: dd.length ? dd.length + " figures differ: the JSON is not offered." : "Every figure agrees to the rupee.", noAccept: true });

  const acc = c.accepted || {};
  out.forEach((x) => { if (x.status !== "matched" && acc[x.id] && !x.noAccept) x.accepted = acc[x.id]; });
  return out;
}

// the rules a reviewer checks on any computation
function sanity(M, S) {
  const out = [], ent = M.entity, form = M.form;
  const okForm = { P: ["ITR-3", "ITR-4"], H: ["ITR-3", "ITR-4"], F: M.llp ? ["ITR-5"] : ["ITR-5", "ITR-4"], C: ["ITR-6"] }[ent] || ["ITR-5"];
  if (!okForm.includes(form)) out.push(needs("form", "comp", "The right form", form + " is not the return for this entity (" + ent + ").", "Use " + okForm.join(" or ") + ".", [], true));
  if (form === "ITR-4") {
    if (S.ti > 5000000) out.push(needs("itr4_limit", "comp", "ITR-4: total income within Rs 50 lakh", "Total income " + S.ti + " is above Rs 50 lakh: ITR-3 / ITR-5.", "", [], true));
    if (M.audit) out.push(needs("itr4_audit", "comp", "ITR-4 with a tax audit", "A tax audit applies: ITR-4 cannot be used.", "", [], true));
    if (M.cg && (N(M.cg.s111A) || N(M.cg.s112) || N(M.cg.other) || N(M.cg.s112A) > 125000)) out.push(needs("itr4_cg", "comp", "ITR-4 and capital gains", "Capital gains other than 112A up to Rs 1.25 lakh need ITR-3 / ITR-5.", "", [], true));
  }
  const rateOk = ent === "C" ? ["115BAA", "normal"].includes(M.regime) : ent === "P" || ent === "H" ? ["new", "old"].includes(M.regime) : true;
  out.push({ id: "rates", group: "comp", title: "Regime and rates right for the entity", status: rateOk ? "matched" : "needs", diff: 0, text: rateOk ? (S.tax && S.tax.rateName) || "" : "Choose the regime on Data.", rows: [], noAccept: true });
  if ((ent === "P" || ent === "H") && M.regime === "old" && (S.heads || {}).pgbp && !M.form10iea) out.push(needs("10iea", "comp", "Form 10-IEA for the old regime", "With business income, the old regime needs Form 10-IEA filed by the due date of 139(1).", "Give its acknowledgement number and date, or choose the new regime."));
  if (M.form !== "ITR-4" && (S.carry || {}).business && S.carry.business.length && M.filingDate && M.filingDate > S.due) out.push(needs("carry", "comp", "Losses to carry forward", "The return is after the due date: the year's business loss is not carried forward (section 80).", ""));
  return out;
}

// the JSON is offered only when: the schema validates, the two computations agree, and every check is matched, or
// accepted (a difference, missing data) / answered (a question) with the owner's note; what only a change to the data
// settles (the form, the regime, the two computations) can never be accepted
export const isOpen = (x) => x.status !== "matched" && !x.accepted;
export function gate(checks, schemaRes) {
  const open = checks.filter(isOpen);
  const two = checks.find((x) => x.id === "two_computations");
  const why = [];
  if (!schemaRes) why.push("The official schema is not loaded.");
  else if (!schemaRes.ok) why.push("The JSON does not pass the official schema (" + schemaRes.errors.length + " errors).");
  if (!two || two.status !== "matched") why.push("The two computations do not agree.");
  if (open.length) why.push(open.length + " checks are open.");
  return { ok: why.length === 0, why, open };
}
