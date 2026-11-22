// The CA's review of a return, as checks. Pure: verify(ctx) -> [check]. Each check:
//   {id, group, title, status: "matched" | "difference" | "missing" | "needs", diff (rupees, a - b), a: {label, amt, src},
//    b: {label, amt, src}, rows: [{label, a, b, diff}], text, how, fp (the fingerprint of its figures), noAccept}
// Rules (the review of eea72c4a3):
//   - every check compares two INDEPENDENT sources; "matched" only when both are there and agree to the rupee (exact or
//     nothing); a side that is not there is "missing", never "matched";
//   - what FinCom cannot know is "needs"; what only a change to the data settles cannot be accepted (noAccept);
//   - a check whose two sides come from the same records (the return's add-back against the list it was made from) is
//     a CONSISTENCY check (kind "consistency"): it proves the list reached the return, not that the list is right; where
//     a second source exists (the bank entries, the challans, the filed TDS returns, TRACES) it is a check of its own;
//   - a payment date the books do not show is asked item by item (ask); the answer changes the computation, and until
//     every item is answered the check cannot be accepted with a note;
//   - an acceptance is bound to the check's figures (fp: the difference and both sides): if either side changes, the
//     acceptance lapses and the check is open again.
// gate() says whether the JSON may be offered.
import { check as recheck, differences } from "./check.js";

const N = (v) => +v || 0;
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };
const sumBy = (xs, f) => (xs || []).reduce((s, x) => s + N(f(x)), 0);
const has = (v) => v !== null && v !== undefined && v !== "" && !(typeof v === "number" && !isFinite(v));
const dmy = (d) => (d ? String(d).slice(6, 8) + "-" + String(d).slice(4, 6) + "-" + String(d).slice(0, 4) : "");
export const GROUPS = [["ais", "26AS, AIS and TIS"], ["books", "Tally books"], ["gst", "GST"], ["tds", "TDS returns"], ["pf", "PF and ESI"], ["dis", "43B and 43B(h)"], ["3cd", "Tax audit (3CD)"], ["comp", "The computation"], ["json", "The JSON"]];

// a short stable hash of a check's figures (FNV-1a over its JSON)
export function fingerprint(c) {
  const s = JSON.stringify([c.status, R(c.diff), c.a ? [R(c.a.amt), c.a.src || ""] : null, c.b ? [R(c.b.amt), c.b.src || ""] : null, (c.rows || []).map((r) => [r.label, r.a == null ? null : R(r.a), r.b == null ? null : R(r.b)]), c.text || ""]);
  let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function two(id, group, title, a, b, rows, how) {
  if (!has(a.amt) || !has(b.amt)) {
    const gone = !has(a.amt) ? a : b;
    return { id, group, title, status: "missing", diff: 0, a: has(a.amt) ? Object.assign({}, a, { amt: R(a.amt) }) : null, b: has(b.amt) ? Object.assign({}, b, { amt: R(b.amt) }) : null, rows: rows || [], text: gone.label + ": not there" + (gone.why ? " (" + gone.why + ")" : "") + ".", how: gone.how || "" };
  }
  const diff = R(N(a.amt) - N(b.amt));
  return { id, group, title, status: diff === 0 ? "matched" : "difference", diff, a: Object.assign({}, a, { amt: R(a.amt) }), b: Object.assign({}, b, { amt: R(b.amt) }), rows: rows || [], how: diff ? how || "" : "" };
}
const missing = (id, group, title, text, how) => ({ id, group, title, status: "missing", text, how: how || "" });
// fix: true when only a change to the data settles it (never accepted with a note)
const needs = (id, group, title, text, how, rows, fix) => ({ id, group, title, status: "needs", text, how: how || "", rows: rows || [], noAccept: !!fix });
const matched = (id, group, title, text, rows) => ({ id, group, title, status: "matched", diff: 0, text: text || "", rows: rows || [] });
const consistency = (x) => Object.assign(x, { kind: "consistency", title: "Consistency: " + x.title });
// items to answer one by one on Checks: [{id, label, amt, value (the answer so far)}]
const askOf = (xs, ans, label) => xs.map((x) => ({ id: x.id, label: label(x), amt: R(x.amt != null ? x.amt : x.dis != null ? x.dis : x.ee), value: (ans || {})[x.id] || "" }));

export function verify(c) {
  const out = [], im = c.imports || {}, M = c.model || {}, S = c.main || {};
  const as26 = im.as26 && im.as26.data, ais = im.ais && im.ais.data, tis = im.tis && im.tis.data, bk = c.books && c.books.ok ? c.books : null;
  const B = M.books || {}, led = (xs) => (xs || []).map((t) => t.ledger).join(", ");
  const line = (k) => ((S.lines || []).find((l) => l.key === k) || {}).amt;

  // ---------- 26AS / AIS / TIS ----------
  if (!as26) out.push(missing("as26", "ais", "Form 26AS", "Not brought in.", "Download 26AS from TRACES (View Tax Credit, export as text) and bring it in."));
  if (!ais) out.push(missing("ais_file", "ais", "AIS", "Not brought in.", "Download the AIS JSON from the compliance portal and bring it in."));
  if (as26) {
    const isF = (r) => String(r.status || "").toUpperCase() === "F";
    const booked = as26.tds.filter(isF), notF = as26.tds.filter((r) => !isF(r));
    const rows = booked.map((r) => ({ label: r.name + " (" + r.tan + ", " + r.sec + ", " + dmy(r.date) + ")", a: null, b: R(r.tax) }));
    out.push(two("tds_26as", "ais", "TDS credit: the books against 26AS", { label: "TDS receivable in the books", amt: B.tds, src: led(B.tdsLedgers) + " at 31-03-2026", why: "no TDS receivable ledger found by name", how: "Say which ledger holds the TDS receivable." },
      { label: "Form 26AS (booking status F)", amt: sumBy(booked, (x) => x.tax), src: "26AS Part I, " + booked.length + " lines" }, rows, "Claim only what 26AS shows as booked; a deduction booked in the books but not in 26AS is followed up with the deductor."));
    if (notF.length) out.push(needs("tds_status", "ais", "26AS lines not finally booked (status other than F)", notF.length + " lines of " + R(sumBy(notF, (x) => x.tax)) + " are not claimed: status U (unmatched), P (provisional), O (overbooked) or a status that could not be read.", "Claim them only once TRACES shows them as F (bring in the 26AS text export if the status was not read); or answer with the reason.", notF.map((r) => ({ label: r.name + " (" + r.tan + ", " + r.sec + ", " + (r.status ? "status " + r.status : "status not read") + ")", b: R(r.tax) }))));
    if (as26.tcs.length || has(B.tcs)) out.push(two("tcs_26as", "ais", "TCS credit: the books against 26AS", { label: "TCS receivable in the books", amt: B.tcs, src: led(B.tcsLedgers), why: "no TCS receivable ledger found by name", how: "Book the TCS, or say where it is." }, { label: "Form 26AS", amt: sumBy(as26.tcs, (x) => x.tax), src: "26AS Part VI" }));
    out.push(two("adv_tax", "ais", "Advance tax: the books against 26AS", { label: "Advance tax ledger in the books", amt: B.adv, src: led(B.advLedgers), why: "no advance tax ledger found by name", how: "Say which ledger holds the advance tax." }, { label: "Form 26AS challans", amt: sumBy(as26.paid.filter((p) => p.kind === "advance"), (x) => x.amount), src: "26AS, tax paid (minor head 100)" },
      as26.paid.filter((p) => p.kind === "advance").map((p) => ({ label: dmy(p.date) + " BSR " + p.bsr + " / " + p.serial, b: R(p.amount) }))));
    const saOwn = (M.paid.selfAssessment || []).filter((x) => x.src === "entered");
    if (saOwn.length || as26.paid.some((p) => p.kind === "self")) out.push(two("sa_tax", "ais", "Self-assessment tax: challans entered against 26AS", { label: "Self-assessment tax in the books", amt: B.sa, src: "self-assessment tax ledger", why: "no self-assessment tax ledger found by name", how: "Book it, or say where it is." },
      { label: "Form 26AS", amt: sumBy(as26.paid.filter((p) => p.kind === "self"), (x) => x.amount), src: "26AS, tax paid (minor head 300)" }));
    if (im.as26.read && im.as26.read.selfCheckOk === false) out.push(needs("as26_self", "ais", "26AS read completely", "The lines read from 26AS do not add up to its own totals for every deductor.", "Bring in the text export instead of the PDF.", [], true));
  }
  if (ais) {
    const cat = (k) => ais.rows.filter((r) => r.cat === k), inc = M.os || {};
    out.push(two("ais_interest", "ais", "Interest (AIS against the return)", { label: "In the return", amt: N(inc.interest), src: M.interestSrc || "interest income in the books" }, { label: "AIS", amt: sumBy(cat("interest"), (x) => x.amount), src: cat("interest").map((x) => x.code).join(", ") || "AIS" },
      cat("interest").map((x) => ({ label: (x.src || x.desc) + (x.srcId ? " (" + x.srcId + ")" : ""), a: null, b: R(x.amount) })), "Every interest the AIS reports is income of the year (savings interest too). Where the books differ, find the account."));
    out.push(two("ais_dividend", "ais", "Dividend", { label: "In the return", amt: N(inc.dividend), src: "dividend in the books / entered" }, { label: "AIS", amt: sumBy(cat("dividend"), (x) => x.amount), src: "AIS" }));
    if (cat("rent").length || N(inc.rent)) out.push(two("ais_rent", "ais", "Rent received", { label: "In the return", amt: N(inc.rent) + N(M.hpRent), src: "rent in the books" }, { label: "AIS", amt: sumBy(cat("rent"), (x) => x.amount), src: "AIS" }));
    const hv = ais.rows.filter((r) => ["hv", "purchase", "sale"].includes(r.cat));
    if (hv.length) out.push(needs("ais_hv", "ais", "High-value purchases and sales in the AIS", hv.length + " transactions of " + R(sumBy(hv, (x) => x.amount)) + ". Say where each is in the books.", "Answer where each is in the books, or give feedback on the AIS.", hv.map((x) => ({ label: x.code + " " + (x.desc || "") + (x.src ? ", " + x.src : ""), b: R(x.amount) }))));
    const g = cat("gst");
    if (g.length) out.push(two("ais_gst", "ais", "GST turnover in the AIS against the return", { label: "Turnover in the return", amt: M.turnover, src: "Part A-P&L, revenue from operations" }, { label: "AIS (GST)", amt: sumBy(g, (x) => x.amount), src: "AIS, GSTR-3B" }, [], "The reasons are listed under GST."));
    if (as26) { const aisTds = ais.rows.filter((r) => /^TDS/i.test(r.code)); out.push(two("ais_26as", "ais", "TDS in the AIS against 26AS", { label: "AIS", amt: sumBy(aisTds, (x) => x.tax), src: "AIS TDS lines" }, { label: "Form 26AS", amt: sumBy(as26.tds, (x) => x.tax), src: "26AS Part I" })); }
  }
  if (tis) {
    const bus = tis.rows.find((r) => /business receipt/i.test(r.desc));
    if (bus) { const turn = N(M.turnover), over = R(N(bus.amount) - turn);
      out.push({ id: "tis_business", group: "ais", title: "Business receipts in the TIS within the turnover", status: over > 0 ? "difference" : "matched", diff: over > 0 ? over : 0,
        a: { label: "Turnover in the return", amt: R(turn), src: "Part A-P&L, revenue from operations" }, b: { label: "TIS, business receipts", amt: R(bus.amount), src: "TIS (receipts others reported)" }, rows: [],
        how: over > 0 ? "Others reported more receipts than the turnover: find the receipts not booked, or give feedback on the AIS." : "" }); }
  }

  // ---------- Tally books ----------
  if (bk && bk.sched) {
    const t = bk.sched.totals;
    out.push(two("bs_tally", "books", "Balance sheet: sources equal application", { label: "Sources of funds", amt: t.sources, src: "Part A-BS, liabilities side (ledger codes)" }, { label: "Application of funds", amt: t.apply, src: "Part A-BS, assets side (ledger codes)" }, [], "A ledger without a code or with the wrong side: see the ledgers not placed."));
    out.push(two("pl_ties", "books", "Profit before tax: Part A-P&L against Tally's own profit and loss", { label: "Part A-P&L", amt: t.pbt, src: "the statements' codes" },
      { label: "Tally's profit and loss", amt: bk.plTally, src: "income and expense ledgers by Tally's own groups, with the stock", why: "the books' groups or stock are not in", how: "Bring in the ledger masters from Tally." }));
    const un = (bk.sched.unmapped || []).concat(bk.sched.unplaced || []);
    out.push(un.length ? two("ledgers_placed", "books", "Every ledger is in a schedule line", { label: "Ledgers not placed", amt: sumBy(un, (x) => Math.abs(x.amt)), src: un.length + " ledgers" }, { label: "Allowed", amt: 0, src: "" }, un.map((x) => ({ label: x.ledger, a: x.amt, b: 0, diff: x.amt })), "Give each a line on Statements › Trial balance.")
      : matched("ledgers_placed", "books", "Every ledger is in a schedule line"));
    const py = bk.pyBs;
    out.push(two("opening", "books", "Opening balances equal last year's closing", { label: "Opening balances in Tally (1-4-2025)", amt: bk.openingTally, src: "Tally's opening balances, balance sheet ledgers" },
      { label: "Last year's closing", amt: py ? py.total : null, src: py ? py.src : "", why: "last year's balance sheet is not in FinCom", how: "Upload last year's audited balance sheet on Statements (or last year's books)." }, (bk.openingRows || [])));
    if (M.entity !== "C") out.push(two("capital", "books", "Capital account movement", { label: "Closing capital (Part A-BS)", amt: bk.capital ? bk.capital.closing : null, src: "capital ledgers at 31-03-2026 + the year's profit" },
      { label: "Opening + profit + introduced - drawings", amt: bk.capital && py && has(py.capital) ? py.capital + bk.capital.profit + bk.capital.introduced - bk.capital.drawings : null, src: "last year's balance sheet, the P&L and the year's capital entries", why: "last year's closing capital is not in FinCom", how: "Upload last year's balance sheet." }));
  } else out.push(missing("books", "books", "Tally books", (c.books && c.books.missing && c.books.missing.join(" ")) || "The books are not in.", "Bring the books in from Tally."));

  // ---------- GST: the return against the FILED returns ----------
  const g = c.gst;
  if (g && g.ok) {
    const reasons = (g.reasons || []).filter((x) => R(x.amt)), explained = sumBy(reasons, (x) => x.amt);
    out.push(two("gst_r1", "gst", "Turnover against the filed GSTR-1", { label: "Turnover in the return", amt: M.turnover, src: "Part A-P&L" },
      { label: "Filed GSTR-1 + reasons", amt: has(g.filedR1) ? N(g.filedR1) + explained : null, src: "GSTR-1 as filed (" + (g.monthsR1 || 0) + " of 12 months)", why: "no filed GSTR-1 in FinCom", how: "Bring the filed GSTR-1 JSONs in (GST › Filed), or fetch them through the GST API." },
      reasons.map((x) => ({ label: x.label, a: null, b: R(x.amt) })), "List each reason (advances, credit notes across the year end, exempt or non-GST supplies, other GSTINs) until nothing is left unexplained."));
    out.push(two("gst_3b", "gst", "Filed GSTR-1 against the filed GSTR-3B", { label: "GSTR-1 outward supplies", amt: g.filedR1, src: "GSTR-1 as filed", why: "no filed GSTR-1" }, { label: "GSTR-3B outward supplies", amt: g.filedR3b, src: "GSTR-3B as filed (" + (g.monthsR3b || 0) + " of 12 months)", why: "no filed GSTR-3B in FinCom", how: "Fetch the filed 3B (GST API) or bring its JSON in." }));
    if (has(g.filedR1) && N(g.monthsR1) < 12) out.push(missing("gst_months", "gst", "Filed GSTR-1 for every month", (12 - N(g.monthsR1)) + " months of FY 2025-26 have no filed GSTR-1 in FinCom.", "Bring them in, or say the client filed quarterly (QRMP)."));
  } else out.push(missing("gst", "gst", "Filed GST returns for FY 2025-26", (g && g.text) || "No filed GST returns in FinCom for the year.", "Bring in the filed GSTR-1 / 3B, or answer that the client is not registered."));

  // ---------- TDS returns ----------
  const td = c.tds;
  if (td && td.ok) {
    out.push(two("tds_payable", "tds", "TDS deducted (26Q and 24Q) against TDS payable in the books", { label: "Deducted per FinCom's 26Q / 24Q", amt: td.deducted, src: "TDS › the four quarters" }, { label: "Credited to TDS payable in the books", amt: td.payable, src: "TDS payable ledgers" }));
    out.push(two("tds_paid", "tds", "TDS deducted against TDS deposited by the due date of the return", { label: "Deducted", amt: td.deducted, src: "26Q / 24Q" }, { label: "Deposited by challan by the due date", amt: td.deposited, src: "challans matched" },
      (td.unpaid || []).map((x) => ({ label: x.party + " " + x.section, a: R(x.tds), b: 0, diff: R(x.tds) })), "TDS not deposited by the due date of the return: 30% of the expense is disallowed (40(a)(ia))."));
    // 40(a)(ia) and 40(a)(i): the return's add-back against the TDS records themselves
    const rec = R(N(td.missedBase) * 0.3 + N(td.unpaidBase) * 0.3 + N(td.nrBase));
    out.push(consistency(two("tds_40aia", "tds", "40(a)(ia) and 40(a)(i): the return against the TDS records", { label: "Added back in the return", amt: N(line("add:40aia")) + N(line("add:40ai")), src: "Schedule BP" },
      { label: "From the TDS records", amt: rec, src: "30% of sums without TDS (" + R(td.missedBase) + ") and of TDS not deposited by the due date (" + R(td.unpaidBase) + "); 100% of non-resident sums without TDS or with TDS not deposited (" + R(td.nrBase) + ")" })));
    // the TDS records against the returns as filed, and the challans against TRACES: second sources
    out.push(two("tds_filed", "tds", "TDS deducted: FinCom's records against the returns as filed", { label: "FinCom's TDS records now", amt: td.filed ? td.filed.records : null, src: td.filed ? "26Q / 27Q, " + td.filed.quarters.join(", ") : "" },
      { label: "The returns as filed", amt: td.filed ? td.filed.tds : null, src: "the copy kept when each return was marked filed", why: "no 26Q / 27Q of FY 2025-26 is marked filed in FinCom", how: "Mark each filed return on TDS › File (with its token number)." },
      (td.notFiled || []).map((q) => ({ label: q + ": entries, not marked filed" })), "An entry changed after filing: a correction statement is due before the return relies on it."));
    out.push(two("tds_traces", "tds", "TDS challans: FinCom against TRACES", { label: "Used by FinCom", amt: td.traces ? td.traces.fincom : null, src: "FinCom's challans" },
      { label: "Consumed per TRACES", amt: td.traces ? td.traces.traces : null, src: "TRACES' consolidated file / challan status file", why: "no TRACES file for FY 2025-26 in FinCom", how: "Bring in the consolidated file or the challan status file on TDS › TRACES files." }, td.traces ? td.traces.rows : []));
    if ((c.nrAsk || []).length) out.push(needs("tds_nr", "tds", "Resident or non-resident?", c.nrAsk.length + " parties without TDS look foreign: " + c.nrAsk.join(", ") + ". A non-resident's sum is disallowed in full (40(a)(i)), a resident's at 30%.", "Mark the non-residents on TDS (27Q details), or answer that they are resident.", c.nrAsk.map((p) => ({ label: p }))));
  } else out.push(missing("tds", "tds", "TDS returns in FinCom", (td && td.text) || "No TDS data for the year.", "Open TDS for the client."));

  // ---------- PF / ESI ----------
  const ecr = im.ecr || [], pfc = im.pfc || [], esi = im.esi || [];
  const months = []; for (let i = 0; i < 12; i++) { const m = ((3 + i) % 12) + 1, y = m >= 4 ? 2025 : 2026; months.push(String(y) + String(m).padStart(2, "0")); }
  const mm = (m) => m.slice(4, 6) + "-" + m.slice(0, 4);
  if (has(c.pfBooks) && N(c.pfBooks) || ecr.length || pfc.length) {
    const gap = months.filter((m) => !ecr.some((e) => e.wageMonth === m));
    if (gap.length) out.push(missing("pf_months", "pf", "A PF ECR for every month", gap.length + " months have no ECR: " + gap.map(mm).join(", ") + ".", "Bring them in, or answer that there were no PF members in those months."));
    else out.push(matched("pf_months", "pf", "A PF ECR for every month"));
    out.push(two("pf_books", "pf", "Employer's PF in the books against the ECRs", { label: "Contribution to PF in the books", amt: c.pfBooks, src: "Part A-P&L, contribution to PF", why: "no PF expense ledger" },
      { label: "Employer's share in the ECRs", amt: ecr.length ? sumBy(ecr, (e) => N(e.data.eps) + N(e.data.er)) + N(c.pfAdminCharges) : null, src: ecr.length + " ECRs" + (c.pfAdminCharges ? " + admin charges" : ""), why: "no ECR brought in" }));
    const noCh = ecr.filter((e) => !pfc.some((p) => p.wageMonth === e.wageMonth));
    if (noCh.length) out.push(missing("pf_challans", "pf", "A PF challan for every ECR", noCh.length + " months have an ECR but no challan: " + noCh.map((e) => mm(e.wageMonth)).join(", ") + ". Their payment dates are not known, so nothing is disallowed for them.", "Bring in the payment receipts (they show the date of credit)."));
  }
  if (has(c.esiBooks) && N(c.esiBooks) || esi.length) {
    const gap = months.filter((m) => !esi.some((e) => e.wageMonth === m));
    if (gap.length) out.push(missing("esi_months", "pf", "An ESI challan for every month", gap.length + " months have no ESI challan: " + gap.map(mm).join(", ") + ".", "Bring them in, or answer that no employee was in ESI in those months."));
    else out.push(matched("esi_months", "pf", "An ESI challan for every month"));
    out.push(two("esi_books", "pf", "Employer's ESI in the books against the challans", { label: "Employer's ESI in the books", amt: c.esiBooks, src: "ESI expense ledger", why: "no ESI expense ledger found by name" }, { label: "Employer's share in the challans", amt: esi.length ? sumBy(esi, (e) => e.data.er) : null, src: esi.length + " challans", why: "no ESI challan brought in" }));
  }
  const pv = c.pf36va || [];
  if (pv.length) {
    const late = pv.filter((x) => x.late && !x.missing), unknown = pv.filter((x) => x.missing);
    out.push({ id: "pf_36va", group: "pf", title: "Employees' PF / ESI credited by the 15th (36(1)(va))", status: late.length ? "difference" : "matched", diff: R(sumBy(late, (x) => x.ee)),
      a: { label: "Paid late (disallowed)", amt: R(sumBy(late, (x) => x.ee)), src: "challans brought in" }, b: { label: "Allowed", amt: 0, src: "" },
      rows: late.map((x) => ({ label: x.fund + " " + mm(x.ym) + ": due " + dmy(x.due) + ", paid " + dmy(x.paidOn), a: R(x.ee) })),
      how: late.length ? "Disallowed for good (no grace days, Checkmate Services, SC 2022); added back in the computation. Accept each with a note." : "" });
    if (unknown.length) out.push(Object.assign(needs("pf_36va_unknown", "pf", "Employees' share: payment date not known", unknown.length + " months (" + unknown.map((x) => x.fund + " " + mm(x.ym)).join(", ") + ") have no challan: neither disallowed nor taken as paid in time.", "Bring in the challans, or give each month's date of payment (or Not paid) here: the computation follows the answer.", unknown.map((x) => ({ label: x.fund + " " + mm(x.ym), a: R(x.ee) })), true),
      { ask: askOf(unknown, c.answers, (x) => x.fund + " " + mm(x.ym) + " (due " + dmy(x.due) + ")") }));
  }

  // ---------- 43B and 43B(h): this year's charge to each payable, and when it was paid ----------
  const dues = c.dues43B;
  if (dues) {
    const on = dues.filter((x) => x.kind43B), unk = on.filter((x) => x.unknown), shareUnk = on.filter((x) => x.unknownShare);
    const want = R(sumBy(on.filter((x) => !x.unknown && !x.unknownShare), (x) => x.dis));
    out.push(consistency(two("43b", "dis", "43B: this year's dues unpaid by the due date", { label: "Added back in the return", amt: N(line("add:43b")), src: "Schedule BP, 43B" },
      { label: "This year's charge unpaid by the due date", amt: want, src: dues.length + " payables at 31-03-2026: the year's charge, the payments after the year end" },
      dues.map((x) => ({ label: x.ledger + " (" + x.kind + (x.role === "ee" ? ", employees' share: 36(1)(va), not 43B" : x.role === "er" ? ", employer's" : "") + ")" + (x.kind43B ? ": charged this year " + R(x.charge) + (x.chargeKnown ? "" : " (not known: the balance)") : ": not under 43B") + (x.dates && x.dates.length ? ", paid " + x.dates.map(dmy).join(", ") : ""), a: R(x.closing), b: R(x.dis) })))));
    if (unk.length) out.push(Object.assign(needs("43b_unknown", "dis", "43B: payment dates not known", unk.length + " dues are unpaid in the books and the books end before the due date of the return (" + dmy(c.due) + "). Nothing is added back for them until each is answered.", "Give each one's date of payment, or Not paid: the computation follows the answer.", unk.map((x) => ({ label: x.ledger + " (" + x.kind + ")", a: R(x.dis) })), true),
      { ask: askOf(unk, c.answers, (x) => x.ledger + ": " + R(x.unpaid) + " of this year's charge") }));
    if (shareUnk.length) out.push(needs("43b_share", "dis", "43B: the employer's part of a PF / ESI payable", shareUnk.map((x) => x.ledger).join(", ") + " holds the employer's and the employees' shares together and March's ECR / ESI challan is not in: the employer's part (43B) cannot be told from the employees' (36(1)(va)).", "Bring in March's ECR / ESI challan, or keep the shares in two ledgers in Tally.", shareUnk.map((x) => ({ label: x.ledger, a: R(x.unpaid) })), true));
    const stale = on.filter((x) => R(x.stale) > 0);
    if (stale.length) out.push(needs("43b_stale", "dis", "43B: an old balance not reduced in the year", stale.map((x) => x.ledger + " " + R(x.stale)).join(", ") + ": part of the balance at 1-04-2025 was never paid down in the year (the ledger never fell below it) and is not paid by the due date. It is not this year's charge, so FinCom does not add it back.",
      "Old balance: already disallowed in an earlier year, or paid (and the books not updated)? Answer for each with a note; if it is a due of this year after all, add it to the computation as an adjustment.", stale.map((x) => ({ label: x.ledger + " (" + x.kind + "), at 1-04-2025 " + R(x.opening), a: R(x.stale) }))));
    const guess = on.filter((x) => !x.chargeKnown && R(x.dis));
    if (guess.length) out.push(needs("43b_charge", "dis", "43B: this year's charge not known", guess.map((x) => x.ledger).join(", ") + ": the year's charge could not be read from the vouchers, so the whole unpaid balance is taken.", "Bring the year's vouchers in from Tally.", guess.map((x) => ({ label: x.ledger, a: R(x.dis) })), true));
    const gstLike = dues.filter((x) => (x.kind === "gst" || x.kind === "tds") && R(N(x.closing) - N(x.paid)) > 0);
    if (gstLike.length) out.push(needs("43b_gst", "dis", "GST / TDS payable at the year end, unpaid by the due date", gstLike.map((x) => x.ledger).join(", ") + ": GST is under 43B only if charged to the P&L; unpaid TDS falls under 40(a)(ia).", "Answer whether the GST was claimed as an expense.", gstLike.map((x) => ({ label: x.ledger, a: R(N(x.closing) - N(x.paid)) }))));
    const pp = c.pfProof;
    if (pp) out.push(two("43b_paid", "dis", "PF / ESI paid after the year end: the bank entries against the challans", { label: "Bank entries in the books", amt: pp.books, src: "payments to the PF / ESI payables, April to the due date" },
      { label: "March challans brought in", amt: pp.challans, src: "EPFO / ESIC challans (dates of credit)", why: "March's challans are not brought in", how: "Bring in March's PF and ESI challans." }, pp.rows, "A payment without its challan, or a challan without its entry: find which, the 43B date follows the challan."));
  } else out.push(missing("43b", "dis", "43B dues from the books", "The books' payables at 31-03-2026 could not be read.", "Bring the books in from Tally."));
  const pr = c.prior43B;
  if (pr && pr.ask) out.push(Object.assign(needs("43b_prior", "dis", "43B of earlier years paid this year", "Dues were payable at 1-04-2025 (" + (pr.rows || []).map((x) => x.ledger).join(", ") + ") and last year's return is not in FinCom: what of them was added back last year and paid in FY 2025-26 is allowed now (section 43B).", "Give the amount (0 if none): it is allowed in the computation.", (pr.rows || []).map((x) => ({ label: x.ledger + ": opening " + R(x.opening) + ", paid in the year " + R(x.paidInYear) })), true), { askAmount: true }));
  const ms = c.msme;
  if (ms) {
    out.push(consistency(two("43bh", "dis", "43B(h): micro and small suppliers paid late", { label: "Added back in the return", amt: N(line("add:43bh")), src: "Schedule BP, 43B(h)" }, { label: "Paid after the " + ms.days + " days, bill by bill", amt: R(sumBy(ms.rows, (x) => x.amt)), src: "bills of the year open at 31-03-2026 (the ageing's references) and when each was settled" },
      ms.rows.map((x) => ({ label: x.party + " " + (x.ref || "") + " of " + dmy(x.date) + ": limit " + dmy(x.limit) + (x.paidOn ? ", paid " + dmy(x.paidOn) : ", unpaid"), a: R(x.amt) })))));
    if (ms.fifo) out.push(two("43bh_fifo", "dis", "43B(h): the bill references against the payment vouchers", { label: "Bill by bill (the ageing)", amt: R(sumBy(ms.rows, (x) => x.amt)), src: "bill-wise references" },
      { label: "From the payment vouchers", amt: ms.fifo.unknown ? null : ms.fifo.amt, src: "each MSME party's ledger, oldest bills paid first", why: "some bills fall due after the books end" }, [], "The references and the vouchers settle bills differently: see which bill each payment was for."));
    if ((ms.unknown || []).length) out.push(Object.assign(needs("43bh_unknown", "dis", "43B(h): when MSME bills were paid", ms.unknown.length + " bills fall due after the books end: not known whether paid within " + ms.days + " days. Nothing is added back for them until each is answered.", "Give each bill's date of payment, or Not paid: the computation follows the answer.", ms.unknown.map((x) => ({ label: x.party + " " + (x.ref || "") + ", limit " + dmy(x.limit), a: R(x.amt) })), true),
      { ask: askOf(ms.unknown, c.answers, (x) => x.party + " " + (x.ref || "") + " of " + dmy(x.date) + " (limit " + dmy(x.limit) + ")") }));
  }

  // ---------- 3CD: the saved 3CD against the ITR's schedules ----------
  if (M.audit) {
    if (!c.form3cd) out.push(missing("3cd", "3cd", "Form 3CD drafted in FinCom", "The tax audit applies; no saved Audit run for FY 2025-26 to draw the 3CD from.", "Run Audit for the whole year: its 3CD draft fills itself."));
    else c.form3cd.forEach((x) => out.push((x.clause.startsWith("21(b)") ? consistency : (y) => y)(two("3cd_" + x.clause, "3cd", "3CD clause " + x.clause + " against the return", { label: "Form 3CD (" + x.what + ")", amt: x.amt, src: "the saved Audit run of " + (x.at || "").slice(0, 10) },
      { label: "Schedule BP", amt: x.itrBase != null ? x.itrBase : N(line(x.itrKey)), src: x.itrSrc }))));
  }

  // ---------- the computation ----------
  (S.needs || []).forEach((n) => out.push(needs("need_" + n.key, "comp", n.text.split(":")[0], n.text, "Settle it on Data.", [], true)));
  (S.warn || []).forEach((w) => out.push({ id: "warn_" + w.key, group: "comp", title: w.text.split(/[.:]/)[0], status: "difference", diff: 0, text: w.text, rows: [], how: "Correct the figure, or accept it with a note." }));
  if (S.carry && N(S.carry.cyUd) && M.form !== "ITR-4") out.push(needs("ud_split", "comp", "This year's unabsorbed depreciation", "Of the loss left after set-off, " + R(S.carry.cyUd) + " is this year's depreciation: it goes to Schedule UD (carried without limit, section 32(2)) and only " + R(S.carry.cyBus) + " to Schedule CFL as business loss. The e-filing utility's rule 618 compares CFL's business loss with CYLA's whole balance: if the utility asks for the whole balance in CFL, it would be counted twice.", "Confirm the split (or say how the utility took it)."));
  if (S.carry && N(S.carry.lostS80)) out.push(needs("carry_s80", "comp", "This year's business loss is lost", "The return is after the due date: the business loss of " + R(S.carry.lostS80) + " is not carried forward (section 80).", "Confirm it is understood (the JSON carries no such loss forward)."));
  sanity(M, S).forEach((x) => out.push(x));
  const b2 = recheck(M), dd = differences(S.key || {}, b2);
  out.push({ id: "two_computations", group: "comp", title: "Two independent computations agree", status: dd.length ? "difference" : "matched", diff: dd.length ? dd[0].diff : 0,
    a: { label: "Computation", amt: S.liability, src: "tax.js" }, b: { label: "Second check", amt: b2.liability, src: "check.js" },
    rows: dd.map((x) => ({ label: x.key, a: x.main, b: x.check, diff: x.diff })), text: dd.length ? dd.length + " figures differ: the JSON is not offered." : "Every figure agrees to the rupee.", noAccept: true });
  // the JSON's coverage: a schedule with figures that FinCom does not map blocks the JSON (json.js coverage)
  (c.coverage || []).forEach((x) => out.push(needs("cover_" + x.key, "json", x.title, x.text, "FinCom does not fill this schedule yet: the JSON is not offered (nothing is put in as zero).", [], true)));

  const acc = c.accepted || {};
  out.forEach((x) => {
    x.fp = fingerprint(x);
    const a = acc[x.id];
    if (x.status !== "matched" && a && !x.noAccept) { if (a.fp === x.fp) x.accepted = a; else x.lapsed = a; }
  });
  return out;
}

// the rules a reviewer checks on any computation
function sanity(M, S) {
  const out = [], ent = M.entity, form = M.form;
  const okForm = { P: ["ITR-3", "ITR-4"], H: ["ITR-3", "ITR-4"], F: M.llp ? ["ITR-5"] : ["ITR-5", "ITR-4"], C: ["ITR-6"] }[ent] || ["ITR-5"];
  if (!okForm.includes(form)) out.push(needs("form", "comp", "The right form", form + " is not the return for this entity (" + ent + (M.llp ? ", LLP" : "") + ").", "Use " + okForm.join(" or ") + ".", [], true));
  if (ent === "F" && M.llp == null) out.push(needs("llp", "comp", "Firm or LLP", "Say whether the client is a partnership firm or an LLP (Client setup has them as one choice).", "Answer on Data.", [], true));
  if (form === "ITR-4") {
    if (S.ti > 5000000) out.push(needs("itr4_limit", "comp", "ITR-4: total income within Rs 50 lakh", "Total income " + S.ti + " is above Rs 50 lakh: ITR-3 / ITR-5.", "", [], true));
    if (M.audit) out.push(needs("itr4_audit", "comp", "ITR-4 with a tax audit", "A tax audit applies: ITR-4 cannot be used.", "", [], true));
    if (M.cg && (N(M.cg.s111A) || N(M.cg.s112) || N(M.cg.other) || N(M.cg.s112A) > 125000)) out.push(needs("itr4_cg", "comp", "ITR-4 and capital gains", "Capital gains other than 112A up to Rs 1.25 lakh need ITR-3 / ITR-5.", "", [], true));
  }
  const rateOk = ent === "C" ? ["115BAA", "normal"].includes(M.regime) && (M.regime === "115BAA" || M.smallCo != null) : ent === "P" || ent === "H" ? ["new", "old"].includes(M.regime) : true;
  out.push({ id: "rates", group: "comp", title: "Regime and rates right for the entity", status: rateOk ? "matched" : "needs", diff: 0, text: rateOk ? (S.tax && S.tax.rateName) || "" : "Choose the regime (and, for a company, the FY 2023-24 turnover) on Data.", rows: [], noAccept: true });
  if ((ent === "P" || ent === "H") && M.regime === "old" && (S.heads || {}).pgbp && !M.form10iea) out.push(needs("10iea", "comp", "Form 10-IEA for the old regime", "With business income, the old regime needs Form 10-IEA filed by the due date of 139(1).", "Give its acknowledgement number and date on Data.", [], true));
  return out;
}

// the JSON is offered only when: the schema validates, the two computations agree, and every check is matched, or
// accepted (a difference, missing data) / answered (a question) with the owner's note, the note still bound to the same
// figures; what only a change to the data settles can never be accepted
export const isOpen = (x) => x.status !== "matched" && !x.accepted;
export function gate(checks, schemaRes) {
  const open = checks.filter(isOpen), two = checks.find((x) => x.id === "two_computations"), why = [];
  if (!schemaRes) why.push("The official schema is not loaded.");
  else if (!schemaRes.ok) why.push("The JSON does not pass the official schema (" + schemaRes.errors.length + " errors).");
  if (!two || two.status !== "matched") why.push("The two computations do not agree.");
  if (open.length) why.push(open.length + " checks are open.");
  return { ok: why.length === 0, why, open };
}
