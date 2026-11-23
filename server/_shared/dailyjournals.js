// Daily Check, phase 2 (next-daily-p2; docs/DAILY-CHECK-PHASE2.md): the entries FinCom prepares itself, each with its
// trace and its checks. Plain JavaScript with no globals, so the night (Deno), the page's second check at Approve (the
// browser) and the tests (Node) run the same file. No AI: every rule is fixed. Nothing here posts.
//
//   journals(inp)              -> {findings, entries}: the GST set-off, payroll and monthly (recurring) journals
//   setoffOne(m, inp)          one GST month (gstMonths' row) -> {finding, entry?}
//   setoffMin(liab, rcm, credit, opening)   the least cash the law allows, by its own method (a search over the legal
//                              allocations, not GSTR.setOff's steps); setoffLegal(pay, ...) the legal order (49, 49A, 88A)
//   payrollOne(ym, rows, inp)  one month of the salary sheet -> {finding, entry?}; payrollPlain(rows) the independent sums
//   recurringAll(inp)          monthly repeats in the books -> [{finding, entry?}]
//   pickLedger(role, inp)      a ledger matched CERTAINLY (exactly one by name and group, or a person's choice), else the
//                              candidates for Needs you
//   trustGate(o)               what a trust level allows (phase 2: always "ask"; AUTO_POSTING is the owner's decision)
//   gstMonths(E, months)       the app's own 3B, set-off and journal for each month marked filed (or kept as filed): run
//                              where S.books is the client's books (the night's withApp, or the browser)
//
// The acceptance rules (docs/DAILY-CHECK-PHASE2.md section 6) are kept here:
//   exact or nothing  every figure traces to a source row (3B, a salary sheet line, the prior months' entries); anything
//                     uncertain is a Needs you finding, never a ready entry
//   two ways          the set-off and the payroll are worked out twice (the builder from the app's own figures, and a plain
//                     checker written apart); ready only when both agree to the paisa
//   books first       no entry when it, or one of the same kind for the same month, is in the books or already approved;
//                     the ledgers in Tally and in the right groups; the period open
// The input is nightchecks' input (server/assistant-night/nightinput.js) plus:
//   gst        gstMonths' rows      drafts  Daily Check's journals already approved ([{dedupe, state, removed}])
//   picks      a person's ledger choices ({role: ledger}), from prior ledger_pick findings
import { r2, num, ymd, ledgerKey, groupsOf, inr, dmon, monYear, checkEntry, sheetMonth, sheetNet, salaryClass, salaryEntries, earningHead, notSalaryHeadName } from "./nightchecks.js";
import { voucherId } from "./dailytrust.js";
export { voucherId, TRUST_KINDS, TRUST_WORDS, LEVEL_WORDS, kindOfSource, PROMOTE_AFTER, AUTO_POSTING, trustGate, promotion } from "./dailytrust.js";

export const KINDS = ["setoff_due", "payroll_due", "recurring_due", "ledger_pick", "setoff_exclude", "sent_check"];
export const SOURCES = { setoff_due: "gst_setoff", payroll_due: "payroll", recurring_due: "recurring" };
export const LOOKBACK = 6;           // months looked at for a set-off or a payroll journal
const H = ["igst", "cgst", "sgst", "cess"];
const P = (x) => Math.round((Number(x) || 0) * 100);            // paise, for exact sums
const R = (p) => p / 100;
const ymOf = (d) => String(d || "").slice(0, 6);
const ymAdd = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(4, 6) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + String(m + 1).padStart(2, "0"); };
const lastDay = (ym) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return ym + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0"); };
const dayIn = (ym, day) => { const e = +lastDay(ym).slice(6, 8); return ym + String(Math.min(day, e)).padStart(2, "0"); };
const live = (books) => ((books && books.vouchers) || []).filter((v) => v && v.date && !v.opt && !v.cancel);
export const CHECK_WORDS = { drcr: "Dr = Cr", ledgers: "Ledgers in Tally", groups: "Ledgers in the right groups", period: "Not in a closed period", duplicate: "Not in the books yet",
  twoways: "Worked out two ways", setoff: "Set-off in the legal order", adds: "Sheet adds up", gst: "GST adds up", pattern: "Same as every month" };

// ---------------------------------------------------------------- the ledgers, matched certainly
// A role's ledgers: by name AND by group (or FinCom's kind of the ledger). Exactly one is certain; a person's choice (a
// ledger_pick finding they answered) is certain while that ledger is still in Tally and in the right group. Anything else:
// the candidates, for Needs you.
const G = {
  duties: /^duties & taxes$/i, curLiab: /^(current liabilities|provisions|sundry creditors)$/i, expense: /^(indirect expenses|direct expenses)$/i,
  curAsset: /^(current assets|loans & advances \(asset\)|duties & taxes)$/i,
};
export const ROLES = {
  salaryExpense: { what: "salary expense", name: /SALAR|WAGES/i, not: /PAYABLE|OUTSTANDING|ADVANCE|DUE\b/i, groups: [G.expense] },
  tds: { what: "TDS on salary", name: /\bTDS\b|TAX DEDUCTED|\b192\b/i, groups: [G.duties, G.curLiab], kind: (m) => m.kind === "tds_payable", prefer: (l, m) => String(m.section || "") === "192" || /SALAR|\b192\b|24Q/i.test(l) },
  profTax: { what: "professional tax payable", name: /PROF(ESSION(AL)?)?\.?\s*TAX|\bP\.?\s?TAX\b|\bPT PAYABLE\b/i, groups: [G.duties, G.curLiab] },
  pf: { what: "PF payable", name: /\bE?PF\b|PROVIDENT/i, not: /CONTRIBUTION|EMPLOYER|EXPENSE/i, groups: [G.duties, G.curLiab] },
  esi: { what: "ESI payable", name: /\bESIC?\b|E\.S\.I/i, not: /CONTRIBUTION|EMPLOYER|EXPENSE/i, groups: [G.duties, G.curLiab] },
  salaryPayable: { what: "salary payable", name: /SALAR(Y|IES)?\b.*\b(PAYABLE|OUTSTANDING|DUE)\b|\b(PAYABLE|OUTSTANDING)\b.*SALAR/i, groups: [G.curLiab] },
  gstInterest: { what: "interest on GST", name: /INTEREST/i, also: /\bGST\b|GOODS AND SERVICE/i, groups: [G.expense] },
  gstLateFee: { what: "GST late fee", name: /LATE\s*FEE/i, groups: [G.expense] },
};
export function pickLedger(role, inp) {
  const R0 = ROLES[role], A = groupsOf(inp.books || {}), map = (inp.books || {}).map || {}, all = Array.from(new Set(inp.ledgers || []));
  const inGroup = (l) => R0.groups.some((g) => A.under(l, g));
  const named = all.filter((l) => (R0.name.test(l) || (R0.kind && R0.kind(map[l] || {}))) && !(R0.not && R0.not.test(l)) && (!R0.also || R0.also.test(l)));
  const ok = named.filter(inGroup);
  const chosen = (inp.picks || {})[role], out = !!(inp.picksOut || {})[role];
  // (review L8) none of that name in the right group: the ones of that name elsewhere, each to be confirmed as used anyway,
  // and the right group's ledgers, so a choice is always there
  const offer = (list) => list.map((l) => ({ ledger: l })).concat(ok.length ? [] : named.filter((l) => !inGroup(l)).map((l) => ({ ledger: l, outside: (A.path(l) || [])[0] || "another group" })),
    ok.length ? [] : all.filter((l) => inGroup(l) && !named.includes(l))
      // plain ledgers of the group first, then tax ledgers and parties
      .map((l) => [l, (A.under(l, /^sundry (creditors|debtors)$/i) ? 2 : 0) + (A.under(l, G.duties) || (map[l] || {}).kind ? 1 : 0)]).sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0])).slice(0, 8).map(([l]) => ({ ledger: l }))).slice(0, 10);
  if (chosen) {
    if (all.includes(chosen) && (inGroup(chosen) || out)) return { ledger: chosen, by: out ? "you, outside the group" : "you" };
    return { cands: offer(ok), why: "The " + R0.what + " ledger you chose (" + chosen + ") is " + (all.includes(chosen) ? "not in a " + groupWords(R0) + " group" : "no longer in Tally") };
  }
  let one = ok;
  if (R0.prefer && ok.length > 1) { const p = ok.filter((l) => R0.prefer(l, map[l] || {})); if (p.length) one = p; }
  if (R0.prefer && ok.length === 1 && !R0.prefer(ok[0], map[ok[0]] || {})) one = [];   // one TDS ledger, not said to be salary's
  if (one.length === 1) return { ledger: one[0], by: "name" };
  return { cands: offer((one.length ? one : ok).slice(0, 6)), why: one.length > 1 ? one.length + " ledgers could be the " + R0.what + " ledger" : "No " + R0.what + " ledger found" + (named.length && !ok.length ? " in a " + groupWords(R0) + " group" : "") };
}
const groupWords = (R0) => R0.groups === ROLES.salaryExpense.groups ? "expenses" : R0.groups.includes(G.duties) ? "Duties & Taxes or current liabilities" : "current liabilities";

// the checks every journal gets: Dr = Cr, ledgers in Tally (nightchecks' own), the right groups, not in a closed period
function baseChecks(voucher, inp, roles) {
  const out = checkEntry({ voucher, source: "journal" }, inp).filter((c) => c.k !== "duplicate" && c.k !== "gst");
  const A = groupsOf(inp.books || {}), bad = [], pk = inp.picks || {}, po = inp.picksOut || {};
  // a ledger the owner confirmed for its role though it is in another group (review L8) passes as confirmed
  // only for the role it was confirmed for
  const confirmed = (l, role) => !!role && !!po[role] && pk[role] === l;
  (roles || []).forEach(([l, test, words, role]) => { if (l && !test(A, l) && !confirmed(l, role)) bad.push(l + " (" + words + ")"); });
  out.push({ k: "groups", ok: !bad.length, why: bad.length ? "Not in the right group: " + bad.join(", ") : "" });
  return out;
}
const isDuties = (A, l) => A.under(l, G.duties);
const isLiab = (A, l) => A.under(l, G.duties) || A.under(l, G.curLiab);
const isExp = (A, l) => A.under(l, G.expense);
// the Tally lines of a journal ([{ledger, dr} | {ledger, cr}]), the same ledger and side merged, in the order made
const merge = (lines) => { const o = []; lines.forEach((l) => { if (!(P(l.dr) || P(l.cr)) || !l.ledger) return; const x = o.find((y) => y.ledger === l.ledger && !!y.dr === !!P(l.dr)); if (x) { if (P(l.dr)) x.dr = R(P(x.dr) + P(l.dr)); else x.cr = R(P(x.cr) + P(l.cr)); } else o.push(P(l.dr) ? { ledger: l.ledger, dr: R(P(l.dr)) } : { ledger: l.ledger, cr: R(P(l.cr)) }); }); return o; };
const totalDr = (lines) => R(lines.reduce((s, l) => s + P(l.dr), 0));
// two lists of lines the same, to the paisa (the order may differ)
export function sameLines(a, b) {
  const k = (ls) => merge(ls || []).map((l) => l.ledger + "|" + (P(l.dr) ? "D" + P(l.dr) : "C" + P(l.cr))).sort().join(";");
  return k(a) === k(b);
}
// a journal FinCom posted carries its id; a pending one is in Daily Check's drafts
const posted = (inp, vid) => live(inp.books).some((v) => String(v.narr || "").includes("TDSDesk:" + vid));
const pending = (inp, dedupe) => (inp.drafts || []).some((d) => d && d.dedupe === dedupe && !d.removed && d.state !== "failed");
// (last fix) sent to Tally and not confirmed there for 24 hours: never offered again silently. Needs you: a sent_check
// finding for that draft ("Not in Tally: offer it again", the owner's, through entry_unconfirm); the entry waits on it
function sentCheck(inp, dedupe, label, you) {
  const d = (inp.drafts || []).find((x) => x && x.dedupe === dedupe && x.state === "unconfirmed");
  if (!d) return null;
  return { finding: you(label + ": waiting on Tally to confirm it", [], { waits: true }).finding,
    picks: [finding("sent_check", "sent:" + dedupe + ":" + d.ver, "you", { party: label, dedupe, at: d.at, ver: d.ver, short: "Not confirmed in Tally",
      title: label + ": sent to Tally but not confirmed there after 24 hours. Check it in Tally." }, [], [{ t: "retry", ref: "retry:" + dedupe, label: "Not in Tally: offer it again", dedupe, ver: d.ver }])] };
}
function finding(kind, key, state, facts, evidence, candidates) {
  return { kind, key, state, facts: Object.assign({ ask_text: "" }, facts), evidence: evidence || [], candidates: candidates || [] };
}
function entryOf(f, source, dedupe, voucher, reason, evidence, checks) {
  return { finding_key: f.kind + "|" + f.key, source, dedupe, work_ref: voucherId(dedupe), voucher, reason, why: f.facts.short, evidence, checks, ready: checks.every((c) => c.ok) };
}
// a ledger that is not certain: a ledger_pick finding (Needs you: pick one) for each, the journal's finding waits on it
function picksNeeded(misses) {
  return misses.map(([role, p]) => finding("ledger_pick", "led:" + role, "you", { party: ROLES[role].what, short: "Pick a ledger", title: "Which ledger is the " + ROLES[role].what + "?" + ((p.cands || []).length ? "" : " " + p.why + "."), role },
    [], (p.cands || []).map((c) => c.outside ? { t: "ledger", ref: "ledger:" + role + ":" + c.ledger + ":outside", label: "Use “" + c.ledger + "” anyway (under " + c.outside + ")", ledger: c.ledger, outside: true }
      : { t: "ledger", ref: "ledger:" + role + ":" + c.ledger, label: c.ledger, ledger: c.ledger })));
}

// ---------------------------------------------------------------- 1. the GST set-off journal
// (review M1) The least cash the law allows, found by its own method and not by GSTR.setOff's steps: sections 49(5), 49A
// and rule 88A stated as constraints, then every allocation that could be best is tried. IGST credit goes first to IGST
// and must be used up (49A) before any CGST or SGST credit; what is left of it goes to CGST and SGST in any proportion
// (rule 88A): the share to CGST is the one free choice, and the cash is piecewise linear in it, so the least is at one of
// its breakpoints (the ends, or where CGST's or SGST's own credit exactly covers the rest). CGST credit then pays CGST and
// then IGST, SGST credit SGST and then IGST; never across; cess only cess; reverse charge is not set off. In paise.
export function setoffMin(liab, rcm, credit, opening) {
  const L = {}, C = {};
  for (const h of H) { L[h] = Math.max(0, P((liab || {})[h])); C[h] = Math.max(0, P(num((credit || {})[h]) + num((opening || {})[h]))); }
  const ii = Math.min(L.igst, C.igst), restI = L.igst - ii, credI = C.igst - ii, T = Math.min(credI, L.cgst + L.sgst);
  const lo = Math.max(0, T - L.sgst), hi = Math.min(L.cgst, T);
  const cashAt = (a) => {
    const b = T - a, owC = L.cgst - a, owS = L.sgst - b, cc = Math.min(C.cgst, owC), ss = Math.min(C.sgst, owS);
    const toI = Math.min(restI, (C.cgst - cc) + (C.sgst - ss));
    return (owC - cc) + (owS - ss) + (restI - toI);
  };
  let best = Infinity, at = lo;
  for (const a0 of [lo, hi, L.cgst - C.cgst, T - (L.sgst - C.sgst)]) { const a = Math.max(lo, Math.min(hi, a0)); const c = cashAt(a); if (c < best) { best = c; at = a; } }
  const cess = Math.max(0, L.cess - C.cess), rc = H.reduce((s, h) => s + Math.max(0, P((rcm || {})[h])), 0);
  return { cash: best + cess, cashAll: best + cess + rc, igstToCgst: at, igstToSgst: T - at };
}
// the legal order checked on a set-off (the app's or the plain one): what is wrong, or ""
export function setoffLegal(pay, liab, rcm, credit, opening) {
  const u = (f, t) => P(((pay.use || {})[f] || {})[t]);
  const avail = (h) => Math.max(0, P(num((credit || {})[h]) + num((opening || {})[h]))), owe = (h) => Math.max(0, P((liab || {})[h]));
  if (u("cgst", "sgst") || u("sgst", "cgst")) return "CGST and SGST credit crossed";
  if (["igst", "cgst", "sgst"].some((h) => u("cess", h) || u(h, "cess"))) return "Cess crossed with another head";
  for (const h of H) {
    const used = H.reduce((s, f) => s + u(f, h), 0), cash = P((pay.cash || {})[h]) - P((pay.rcmCash || {})[h]);
    if (used + cash !== owe(h)) return h.toUpperCase() + ": credit used and cash paid do not add up to the tax";
    const out = H.reduce((s, t) => s + u(h, t), 0);
    if (out > avail(h)) return h.toUpperCase() + " credit used is more than there was";
    if (P((pay.rcmCash || {})[h]) !== Math.max(0, P((rcm || {})[h]))) return "Reverse charge is not paid in cash";
  }
  if (u("igst", "igst") !== Math.min(owe("igst"), avail("igst"))) return "IGST credit not used against IGST first";
  // 49A: no CGST or SGST credit used at all while IGST credit is left that could have paid it
  const usedCS = ["cgst", "sgst"].reduce((s, f) => s + H.reduce((x, t) => x + u(f, t), 0), 0), leftI0 = avail("igst") - H.reduce((s, t) => s + u("igst", t), 0);
  if (usedCS > 0 && leftI0 > 0) return "CGST or SGST credit used before the IGST credit was used up (section 49A)";
  const leftI = avail("igst") - H.reduce((s, t) => s + u("igst", t), 0);
  if ((u("cgst", "igst") || u("sgst", "igst")) && leftI > 0) return "CGST or SGST credit used for IGST before the IGST credit";
  // cash only when no credit that may pay it is left
  const left = (h) => avail(h) - H.reduce((s, t) => s + u(h, t), 0);
  const cashOf = (h) => P((pay.cash || {})[h]) - P((pay.rcmCash || {})[h]);
  if (cashOf("igst") > 0 && (left("igst") > 0 || left("cgst") > 0 || left("sgst") > 0)) return "IGST paid in cash while credit was left";
  if (cashOf("cgst") > 0 && (left("cgst") > 0 || left("igst") > 0)) return "CGST paid in cash while credit was left";
  if (cashOf("sgst") > 0 && (left("sgst") > 0 || left("igst") > 0)) return "SGST paid in cash while credit was left";
  if (cashOf("cess") > 0 && left("cess") > 0) return "Cess paid in cash while credit was left";
  return "";
}
const samePay = (a, b) => H.every((h) => P((a.cash || {})[h]) === P((b.cash || {})[h]) && P((a.rcmCash || {})[h]) === P((b.rcmCash || {})[h])) &&
  ["igst", "cgst", "sgst", "cess"].every((f) => Object.keys((a.use || {})[f] || {}).concat(Object.keys((b.use || {})[f] || {})).every((t) => P(((a.use || {})[f] || {})[t]) === P(((b.use || {})[f] || {})[t])));

// the app's own figures for each month marked filed (or kept as filed): GSTR.threeB, GSTF.journal (the "Set-off journal
// for Tally" the GST page gives), interest and late fee. E = {GSTR, GSTF, GSTSet}; S.books must be the client's books.
export function gstMonths(E, months) {
  const out = [], books = (globalThis.S || {}).books || {};
  let regs = [];
  try { regs = Array.from(new Set((E.GSTR.gstins(books) || []).map((g) => String(g).slice(0, 2)))).sort(); } catch (e) { regs = []; }
  for (const reg of regs) for (const ym of months) {
    const rec = E.GSTF.peek(ym, reg) || {};
    if (!rec.r3b && !rec.snap) continue;
    const type = E.GSTSet && E.GSTSet.typeOf ? E.GSTSet.typeOf(ym, reg) : "monthly";
    if (type !== "monthly") { out.push({ reg, ym, skip: type }); continue; }
    try {
      const t = E.GSTR.threeB(ym, reg), J = E.GSTF.journal(ym, reg);
      const nil = H.every((h) => !P((t.net || {})[h]) && !P((t.netItc || {})[h]) && !P((t.rcmOut || {})[h]));
      const it = rec.r3b ? E.GSTF.interest(ym, reg, t) : null, fee = rec.r3b ? E.GSTF.lateFee(ym, reg, "r3b", nil) : null;
      const pick = (o) => JSON.parse(JSON.stringify(o || {}));
      out.push({ reg, ym, filed: String(rec.r3b || "").replace(/-/g, ""), due: String(E.GSTF.due(ym, "r3b", reg) || "").replace(/-/g, ""), arn: rec.r3bArn || "", kept: !!rec.snap, snapPay: rec.snap ? pick(rec.snap.pay) : null,
        t: { net: pick(t.net), rcmOut: pick(t.rcmOut), netItc: pick(t.netItc), opening: pick(t.opening), pay: pick(t.pay) },
        journal: { lines: pick(J.lines), missing: J.missing || [], date: J.date, narr: J.narr, cashL: J.cashL, balanced: !!J.balanced },
        interest: it ? { total: r2(it.total), days: it.days } : null, fee: fee ? { fee: r2(fee.fee || 0), days: fee.days || 0, unknown: !!fee.unknown } : null,
        portalInt: rec.portalInt != null ? num(rec.portalInt) : null, portalFee: rec.portalFee3 != null ? num(rec.portalFee3) : null,
        roles: Object.fromEntries((J.lines || []).map((l) => [l.l, roleOfGst(books.map || {}, l.l, J.cashL)])) });
    } catch (e) { out.push({ reg, ym, skip: "error", why: String((e && e.message) || e).slice(0, 120) }); }
  }
  return out;
}
// what a ledger of the set-off journal is: "out:cgst", "in:igst", "rcm:igst", "cash"
function roleOfGst(map, l, cashL) {
  if (l === cashL) return "cash";
  const m = map[l] || {};
  if (m.kind !== "gst") return "";
  const h = String(m.tax || "").toLowerCase();
  return (m.rcm && m.side === "output" ? "rcm:" : m.side === "output" ? "out:" : "in:") + h;
}
// a tax-only entry (a set-off) in the books, under ANY voucher type (review L5): every line a tax ledger, or a rounding line
// of at most ₹10; an output GST ledger on the debit side
export function taxOnly(v, A, map) {
  const tax = (l) => A.isDuties(l) || A.under(l, /GST|TAX|TDS|TCS|CESS|ELECTRONIC/i) || /\bGST\b|GST\b|\bTDS\b|\bTCS\b|\bCESS\b|ELECTRONIC (CASH|CREDIT)/i.test(l);
  return v.ent.length >= 2 && v.ent.every((e) => tax(e.l) || Math.abs(e.a) <= 10) &&
    v.ent.some((e) => e.a < 0 && (map[e.l] || {}).kind === "gst" && (map[e.l] || {}).side === "output");
}
const vLines = (v) => v.ent.filter((e) => Math.abs(e.a) >= 0.005).map((e) => e.a < 0 ? { ledger: e.l, dr: r2(-e.a) } : { ledger: e.l, cr: r2(e.a) });
const nearLines = (a, b) => { const k = (ls) => merge(ls).filter((l) => !/ROUND/i.test(l.ledger)); const x = k(a), y = k(b); return x.length === y.length && x.every((l) => y.some((z) => z.ledger === l.ledger && !!z.dr === !!l.dr && Math.abs(P(z.dr || z.cr) - P(l.dr || l.cr)) <= 100)); };

export function setoffOne(m, inp, others) {
  const key = "setoff:" + m.reg + ":" + m.ym, dedupe = key, vid = voucherId(dedupe), label = monYear(m.ym);
  const base = { party: "GST set-off " + label.split(" ")[0], ym: m.ym, reg: m.reg, date: m.journal ? m.journal.date : "" };
  const you = (title, cands, extra) => ({ finding: finding("setoff_due", key, "you", Object.assign({}, base, { short: "Set-off " + label + ": check", title }, extra || {}), [], cands) });
  if (m.skip) return m.skip === "error" ? you("Set-off " + label + ": the 3B could not be worked out (" + m.why + ")") : null;   // a quarterly return: by hand
  if (posted(inp, vid)) return null;                                                                                           // in the books
  { const sc = sentCheck(inp, dedupe, "Set-off " + label, you); if (sc) return sc; }
  if (pending(inp, dedupe)) return null;                                                                                       // approved, on its way
  const J = m.journal, t = m.t;
  // (review L4) kept as filed with no filing date: interest and late fee are not known. Past the due date: Needs you
  if (!m.filed && m.due && String(inp.today) > m.due) return you("Set-off " + label + ": no filing date, so interest and late fee are not known. Type the filing date on the GST page.");
  // (review N3) exact or nothing: ready only for a month whose 3B is kept as filed (its copy is what the journal follows)
  if (!m.snapPay) return you("Set-off " + label + ": keep this 3B as filed first (GST page), then FinCom prepares its set-off.");
  // 1. the interest and the late fee: the portal's own figures when kept; one worked out here and not confirmed waits
  const intAmt = m.portalInt != null ? r2(m.portalInt) : m.interest && m.interest.total > 0 ? null : 0;
  const feeAmt = m.portalFee != null ? r2(m.portalFee) : m.fee && m.fee.unknown ? null : m.fee && m.fee.fee > 0 ? null : 0;
  if (!J.lines.length && !intAmt && !feeAmt && intAmt !== null && feeAmt !== null) return null;                          // nothing to set off
  // 2. the books changed since the 3B was kept as filed
  if (m.snapPay && !samePay(m.snapPay, t.pay)) return you("Set-off " + label + ": the books changed since the 3B was filed. Look at the 3B first.");
  if ((J.missing || []).length) return you("Set-off " + label + ": no " + J.missing.join(", ") + " in FinCom's GST ledgers. Set it in GST settings.");
  if (intAmt === null) return you("Set-off " + label + ": interest of about " + inr(m.interest.total) + " (" + m.interest.days + " days late). Type the portal's figure on the GST page.");
  if (feeAmt === null) return you("Set-off " + label + ": a late fee is due. Type the portal's figure on the GST page.");
  // 3. the books first: a set-off journal of this month already there (the same lines), or a tax journal that may be it
  // (review H1) looked for from the month's start up to tonight (a set-off booked late by hand, after the filing date, or
  // at the end of the look-back), under any voucher type; one not clearly another month's (the same lines as another
  // month's set-off, or its narration naming another month) is Needs you
  const A = groupsOf(inp.books || {}), map = (inp.books || {}).map || {}, from = m.ym + "01", to = String(inp.today || lastDay(ymAdd(m.ym, 1)));
  const lines0 = J.lines.map((l) => P(l.dr) ? { ledger: l.l, dr: l.dr } : { ledger: l.l, cr: l.cr });
  const inWin = live(inp.books).filter((v) => v.date >= from && v.date <= to && taxOnly(v, A, map));
  if (inWin.some((v) => nearLines(vLines(v), lines0))) return null;
  // (review N1) another month's ONLY when its lines are that month's own set-off (within ₹1 a line); the narration never
  // decides. (N2) one the owner said is not for this month is left out (a setoff_exclude finding they answered)
  const otherMonth = (v) => (others || []).some((o) => o.ym !== m.ym && nearLines(vLines(v), o.lines));
  const excl = inp.excluded || new Set();
  const theirs = inWin.filter((v) => !otherMonth(v) && !excl.has(m.reg + ":" + m.ym + ":" + v.id));
  if (theirs.length) return { finding: you("Set-off " + label + ": waiting on " + (theirs.length === 1 ? "a tax journal" : theirs.length + " tax journals") + " that may be its set-off", [], { waits: true }).finding,
    picks: theirs.map((v) => finding("setoff_exclude", "excl:" + m.reg + ":" + m.ym + ":" + v.id, "you", { party: "GST set-off " + label.split(" ")[0], amt: r2(v.ent.filter((e) => e.a < 0).reduce((x, e) => x - e.a, 0)), date: v.date, ym: m.ym,
      short: "Tax journal: which month?", title: "A tax journal of " + dmon(v.date) + " (" + inr(v.ent.filter((e) => e.a < 0).reduce((x, e) => x - e.a, 0)) + ") may be " + label + "'s set-off. Check it in Tally." },
      [], [{ t: "exclude", ref: "excl:" + m.reg + ":" + m.ym + ":" + v.id, label: "That journal is not for " + label, voucher: v.id }])) };
  // 4. the lines: the app's journal, then interest and late fee from the cash ledger
  const ledI = intAmt ? pickLedger("gstInterest", inp) : null, ledF = feeAmt ? pickLedger("gstLateFee", inp) : null;
  const miss = [["gstInterest", ledI], ["gstLateFee", ledF]].filter(([, p]) => p && !p.ledger);
  if (miss.length) return { finding: you("Set-off " + label + ": pick the " + miss.map(([r]) => ROLES[r].what).join(" and ") + " ledger", [], { waits: true }).finding, picks: picksNeeded(miss) };
  const lines = merge(lines0.concat(intAmt ? [{ ledger: ledI.ledger, dr: intAmt }, { ledger: J.cashL, cr: intAmt }] : [], feeAmt ? [{ ledger: ledF.ledger, dr: feeAmt }, { ledger: J.cashL, cr: feeAmt }] : []));
  // 5. two ways: the plain set-off from the 3B's own figures, and its journal
  const least = setoffMin(t.net, t.rcmOut, t.netItc, t.opening), plain = t.pay;
  const legal = setoffLegal(t.pay, t.net, t.rcmOut, t.netItc, t.opening);
  const appCash = H.reduce((s, h) => s + P(t.pay.cash[h]) - P((t.pay.rcmCash || {})[h]), 0);
  const want = {};
  const add = (k, p) => { if (p) want[k] = (want[k] || 0) + p; };
  for (const h of H) {
    add("out:" + h, H.reduce((s, f) => s + P((plain.use[f] || {})[h]), 0) + P(plain.cash[h]) - P(plain.rcmCash[h]));
    add("in:" + h, Object.values(plain.use[h] || {}).reduce((s, v) => s + P(v), 0));
    add("rcm:" + h, P(plain.rcmCash[h]));
  }
  add("cash", H.reduce((s, h) => s + P(plain.cash[h]), 0) + P(intAmt) + P(feeAmt));
  const got = {}, roles = m.roles || {};
  lines.forEach((l) => { const r0 = l.ledger === J.cashL ? "cash" : roles[l.ledger] || ""; if (r0) got[r0] = (got[r0] || 0) + (P(l.dr) || P(l.cr)); });
  const byRole = Object.keys(want).concat(Object.keys(got)).every((k) => (want[k] || 0) === (got[k] || 0));
  const agree = !legal && appCash === least.cash && byRole;
  // 6. the trace: each head, the credit used and the cash
  const ev = [{ t: "gst3b", ref: "3b:" + m.reg + ":" + m.ym, label: "GSTR-3B " + label + (m.filed ? " · filed " + dmon(m.filed) + (m.arn ? " · ARN …" + String(m.arn).slice(-6) : "") : " · kept as filed") }];
  for (const h of H) {
    const owe = Math.max(0, P(t.net[h])), used = H.reduce((s, f) => s + P((t.pay.use[f] || {})[h]), 0), cash = P(t.pay.cash[h]) - P((t.pay.rcmCash || {})[h]);
    if (owe || used || cash) ev.push({ t: "gst3b", ref: "3b:" + h, label: h.toUpperCase() + " tax " + inr(R(owe)) + " = credit " + inr(R(used)) + " + cash " + inr(R(cash)) });
    if (P((t.pay.rcmCash || {})[h])) ev.push({ t: "gst3b", ref: "3b:rcm:" + h, label: "Reverse charge " + h.toUpperCase() + " " + inr(t.pay.rcmCash[h]) + ", paid in cash" });
  }
  if (intAmt) ev.push({ t: "gst3b", ref: "3b:int", label: "Interest " + inr(intAmt) + " (the portal's figure)" });
  if (feeAmt) ev.push({ t: "gst3b", ref: "3b:fee", label: "Late fee " + inr(feeAmt) + " (the portal's figure)" });
  const d = J.date && J.date.length === 8 ? J.date : ymd(J.date);
  const voucher = { type: "Journal", kind: "setoff", date: d, no: "", party: J.cashL, period: m.ym, reg: m.reg, book: inp.bookId || "", lines,
    narration: J.narr + (intAmt || feeAmt ? "; interest and late fee paid in cash" : "") };
  const checks = baseChecks(voucher, inp, lines.map((l) => [l.ledger, l.ledger === ledI?.ledger || l.ledger === ledF?.ledger ? isExp : l.ledger === J.cashL ? (A2, x) => A2.under(x, G.curAsset) : isDuties,
    l.ledger === ledI?.ledger || l.ledger === ledF?.ledger ? "an expense" : l.ledger === J.cashL ? "Duties & Taxes or current assets" : "Duties & Taxes", l.ledger === ledI?.ledger ? "gstInterest" : l.ledger === ledF?.ledger ? "gstLateFee" : ""]));
  checks.push({ k: "duplicate", ok: true, why: "" });
  checks.push({ k: "setoff", ok: !legal, why: legal });
  checks.push({ k: "twoways", ok: agree, why: agree ? "" : appCash !== least.cash ? "The 3B pays " + inr(R(appCash)) + " in cash; the least the law allows is " + inr(R(least.cash)) : "The journal does not follow the 3B to the paisa" });
  const amt = totalDr(lines);
  const f = finding("setoff_due", key, "resolved", Object.assign({}, base, { amt, date: d, short: "GST set-off " + label }), ev);
  const e = entryOf(f, "gst_setoff", dedupe, voucher, "GST set-off", ev, checks);
  if (!e.ready) return you("Set-off " + label + ": " + checks.filter((c) => !c.ok).map((c) => c.why || CHECK_WORDS[c.k]).join("; "), [], { amt });
  return { finding: f, entry: e };
}

// ---------------------------------------------------------------- 2. the payroll journal (the salary sheet)
// The sheet's rows (TDS24Q.fromFile, src/js/17-24q.js): {name, date|month, gross, tds, profTax, surcharge, cess} and, when
// the sheet has them, net, pf, esi. Each employee: gross = net + TDS + professional tax + PF + ESI, to the paisa.
// (review: other deductions) an advance recovered, canteen, LWF (r.otherDed, the sheet's own heads) are out of the pay too
export function payrollPlain(rows) {
  let g = 0, t = 0, pt = 0, pf = 0, esi = 0, o = 0, n = 0, bad = "";
  for (const r of rows) {
    const gr = P(r.gross), td = P(r.tds), p = P(r.profTax), f = P(r.pf), e = P(r.esi), od = P(r.otherDed);
    const nt = r.net != null && r.net !== "" ? P(r.net) : gr - td - p - f - e - od;
    if (gr !== nt + td + p + f + e + od && !bad) bad = String(r.name || "?");
    if (nt < 0 && !bad) bad = String(r.name || "?");
    g += gr; t += td; pt += p; pf += f; esi += e; o += od; n += nt;
  }
  return { gross: R(g), tds: R(t), profTax: R(pt), pf: R(pf), esi: R(esi), other: R(o), net: R(n), bad, adds: g === n + t + pt + pf + esi + o };
}
// next-payroll: how the client books salary, as kept on the client (Payroll page: co.payrollMethod, co.payrollJournal,
// co.payrollPayable, co.payrollVchType) and the pay heads Tally's payroll has (tally_ledgers.for_payroll): the night reads
// them from the client's record, the page's second check from CO() and S.books.payroll (the same object both ways)
// heads: the ledgers of Tally's payroll, as names or {name, type} (Tally's pay head type): heads keeps the earnings,
// notEarn the rest (the employer's contributions, gratuity, deductions ...: never salary booked)
export function payrollSettings(co, heads) {
  const c = co || {}, m = (c.payrollMethod || {}).value, earn = new Set(), not = new Set(), typed = new Set();
  (heads || []).forEach((h) => { const name = String(typeof h === "string" ? h : (h && h.name) || ""), type = typeof h === "string" ? "" : (h && (h.type || h.pay_type)) || ""; if (!name) return; (earningHead(name, type) ? earn : not).add(name); if (String(type).trim()) typed.add(name); });
  return { method: m === "tally" || m === "journal" ? m : "", journal: Object.assign({}, c.payrollJournal || {}), payable: String(c.payrollPayable || ""),
    vchType: String(c.payrollVchType || ""), heads: Array.from(earn).sort(), notEarn: Array.from(not).sort(), typed: Array.from(typed).sort() };
}
export const TP_ID = (ym) => "dc-tp-" + ym;                // the Tally Payroll vouchers' ids: dc-tp-<yyyymm>-<part>
const tpHolds = (inp, d) => { const t = Date.parse(String(d.at || "")); return live(inp.books).some((v) => String(v.narr || "").includes("TDSDesk:" + d.vid)) || !(isFinite(t) && Date.now() - t > 24 * 3600e3); };
const ownTp = (v, ym) => String(v.narr || "").includes("TDSDesk:" + TP_ID(ym) + "-");
// the salary booked for a month (review H2, N5; next-payroll review B1): any entry with a salary expense on the debit side
// (salaryClass), a pay head of Tally's payroll (an earning: an expense ledger for payroll, "Basic", "HRA"), or any ledger
// a payroll-type voucher debits; FinCom's own Tally Payroll vouchers of the month left out when skipOwn (a split month
// half posted is finished, not taken for salary booked by hand)
function bookedFor(ym, inp, skipOwn) {
  const A = groupsOf(inp.books || {}), sbase = (pickLedger("salaryExpense", inp).ledger) || "", ph = new Set(((inp.payroll || {}).heads) || []), ne = new Set(((inp.payroll || {}).notEarn) || []), ty = new Set(((inp.payroll || {}).typed) || []);
  // (third review) a pay head Tally gives a type to goes by its type alone; the name only for one with none
  const not = (l) => ne.has(l) || (!ty.has(l) && !ph.has(l) && notSalaryHeadName(l));
  const V = live(inp.books).filter((v) => !(skipOwn && ownTp(v, ym)));
  const pt = new Set(); V.forEach((v) => { if (/payroll/i.test(String(v.type || ""))) (v.ent || []).forEach((e) => { if (e.a < 0 && A.isExpense(e.l) && !not(e.l)) pt.add(e.l); }); });
  // (re-review 1) the employer's contributions, gratuity and the like are never salary: an entry touching only them is not
  // salary booked
  const cls = (l) => (not(l) ? "" : (ph.has(l) || pt.has(l)) && A.isExpense(l) ? "yes" : salaryClass(A, l, sbase, inp.ledgers));
  return { cls, booked: salaryEntries(V, ym, (l) => cls(l) !== "") };
}
export function payrollOne(ym, rows, inp) {
  const key = "payroll:" + ym, dedupe = key, vid = voucherId(dedupe), label = monYear(ym), date = lastDay(ym);
  const base = { party: "Payroll " + label.split(" ")[0], ym, date, n: rows.length };
  const you = (title, extra) => ({ finding: finding("payroll_due", key, "you", Object.assign({}, base, { short: "Payroll " + label + ": check", title }, extra || {})) });
  const tp = inp.payroll || {};
  if (tp.method === "tally" && !(tp.journal || {})[ym]) return tallyOne(ym, rows, inp, { key, dedupe, vid, label, date, base, you });
  if (posted(inp, vid)) return null;
  { const sc = sentCheck(inp, dedupe, "Payroll " + label, you); if (sc) return sc; }
  // (fourth review) a Tally Payroll part of this month (posted as Tally Payroll before the owner chose a journal) holds the
  // journal back while it may be in Tally: its FinCom id in the books (then the salary is booked anyway), or sent within
  // the last day; one a day old and not in the books (deleted in Tally) does not (Approve settles it from Tally first)
  if ((inp.drafts || []).some((d) => d && d.dedupe === dedupe && !d.removed && d.state !== "failed" && (!/^dc-tp-/.test(String(d.vid || "")) || tpHolds(inp, d)))) return null;
  // 1. the sheet itself
  if (rows.some((r) => P(r.surcharge) || P(r.cess))) return you("Payroll " + label + ": the sheet has surcharge or cess on TDS. Book it by hand.");
  const seen = new Set(), twice = rows.find((r) => { const k = ledgerKey(r.name) + "|" + String(r.code || r.pan || ""); if (seen.has(k)) return true; seen.add(k); return false; });
  if (twice) return you("Payroll " + label + ": " + twice.name + " is on the sheet twice.");
  // (review) other deductions (an advance recovered, canteen, LWF) have no ledger in the payroll journal: said so (a month
  // posted through Tally Payroll takes them, each to its own pay head)
  const other = rows.filter((r) => P(r.otherDed));
  if (other.length) return you("Payroll " + label + ": other deductions (" + Array.from(new Set(other.flatMap((r) => Object.keys(r.ded || {})))).join(", ") + ") have no ledger in the payroll journal. Book this month by hand, or post it through Tally Payroll.");
  // the builder: each employee's net, then the totals by ledger (rupees with paise, as the sheet keeps them)
  // (review L2) each employee's net by the one net function (nightchecks sheetNet: TDS, PT, PF and ESI)
  const per = rows.map((r) => { const gross = r2(num(r.gross)), ded = r2(num(r.tds) + num(r.profTax) + num(r.pf) + num(r.esi)); return { name: r.name, gross, tds: r2(num(r.tds)), pt: r2(num(r.profTax)), pf: r2(num(r.pf)), esi: r2(num(r.esi)), net: sheetNet(r), ded }; });
  const wrong = per.find((p) => Math.abs(r2(p.net + p.ded) - p.gross) >= 0.005 || p.net < 0 || p.gross <= 0);
  if (wrong) return you("Payroll " + label + ": " + wrong.name + "'s gross " + inr(wrong.gross) + " is not net " + inr(wrong.net) + " plus deductions " + inr(wrong.ded) + ".");
  const sum = (k) => r2(per.reduce((s, p) => s + p[k], 0));
  const tot = { gross: sum("gross"), tds: sum("tds"), pt: sum("pt"), pf: sum("pf"), esi: sum("esi"), net: sum("net") };
  // 2. the books first (review H2, the same rule as the salary payments: nightchecks forMonth, salaryLike): salary booked
  // for the month by any entry with a salary-like expense on the debit side, dated in the month or up to the 10th of the
  // next, or naming the month. The same gross: nothing; anything else: Needs you
  // (review N5) salary "yes" (the payroll's own salary ledger, or its all-salary sub-group) is compared; a "maybe" (another
  // ledger named like salary) cannot be decided exactly: Needs you. Each entry counts for one month (salaryEntries)
  const A = groupsOf(inp.books || {}), { cls, booked } = bookedFor(ym, inp, false);
  const maybe = booked.find((v) => v.ent.some((e) => e.a < 0 && cls(e.l) === "maybe"));
  if (maybe) return you("Payroll " + label + ": an entry of " + dmon(maybe.date) + " to " + maybe.ent.find((e) => e.a < 0 && cls(e.l) === "maybe").l + " may be salary. Check it first.", { amt: tot.gross });
  const sal = (e) => e.a < 0 && cls(e.l) === "yes";
  if (booked.length) {
    const amt = r2(booked.reduce((s, v) => s + v.ent.filter(sal).reduce((x, e) => x - e.a, 0), 0));
    if (Math.abs(amt - tot.gross) <= 1) return null;
    return you("Payroll " + label + ": salary booked " + inr(amt) + ", the sheet says " + inr(tot.gross) + ".", { amt: tot.gross });
  }
  // 3. the ledgers, certainly
  const roles = [["salaryExpense", true], ["tds", tot.tds > 0], ["profTax", tot.pt > 0], ["pf", tot.pf > 0], ["esi", tot.esi > 0], ["salaryPayable", tot.net > 0]].filter((x) => x[1]).map((x) => x[0]);
  const got = Object.fromEntries(roles.map((r) => [r, pickLedger(r, inp)]));
  const miss = roles.filter((r) => !got[r].ledger).map((r) => [r, got[r]]);
  if (miss.length) return { finding: you("Payroll " + label + ": pick the " + miss.map(([r]) => ROLES[r].what).join(", ") + " ledger" + (miss.length > 1 ? "s" : ""), { amt: tot.gross, waits: true }).finding, picks: picksNeeded(miss) };
  const L = (r) => got[r].ledger;
  const lines = merge([{ ledger: L("salaryExpense"), dr: tot.gross }, tot.tds ? { ledger: L("tds"), cr: tot.tds } : null, tot.pt ? { ledger: L("profTax"), cr: tot.pt } : null,
    tot.pf ? { ledger: L("pf"), cr: tot.pf } : null, tot.esi ? { ledger: L("esi"), cr: tot.esi } : null, tot.net ? { ledger: L("salaryPayable"), cr: tot.net } : null].filter(Boolean));
  // 4. two ways: the plain sums in paise straight from the sheet's rows
  const plain = payrollPlain(rows);
  const agree = !plain.bad && plain.adds && P(plain.gross) === P(tot.gross) && P(plain.tds) === P(tot.tds) && P(plain.profTax) === P(tot.pt) && P(plain.pf) === P(tot.pf) && P(plain.esi) === P(tot.esi) && P(plain.net) === P(tot.net)
    && P(totalDr(lines)) === P(plain.gross) && P(lines.reduce((s, l) => s + P(l.cr), 0) / 100) === P(plain.tds + plain.profTax + plain.pf + plain.esi + plain.net);
  const voucher = { type: "Journal", kind: "payroll", date, no: "", party: L(tot.net ? "salaryPayable" : "salaryExpense"), period: ym, book: inp.bookId || "", lines,
    narration: "Salary for " + label + " as per the salary sheet (" + rows.length + " employee" + (rows.length === 1 ? "" : "s") + ")" };
  const checks = baseChecks(voucher, inp, [[L("salaryExpense"), isExp, "an expense", "salaryExpense"]].concat(roles.filter((r) => r !== "salaryExpense").map((r) => [L(r), r === "salaryPayable" ? (A2, x) => A2.under(x, G.curLiab) : isLiab, r === "salaryPayable" ? "current liabilities" : "Duties & Taxes or current liabilities", r])));
  checks.push({ k: "duplicate", ok: true, why: "" });
  checks.push({ k: "adds", ok: plain.adds && !plain.bad, why: plain.bad ? plain.bad + " does not add up" : "" });
  checks.push({ k: "twoways", ok: agree, why: agree ? "" : "The plain sums and the journal differ" });
  const ev = [{ t: "salary", ref: "sheet:" + ym, label: "Salary sheet " + label + " · " + rows.length + " employee" + (rows.length === 1 ? "" : "s") },
    { t: "salary", ref: "sheet:" + ym + ":tot", label: "Gross " + inr(tot.gross) + " = net " + inr(tot.net) + (tot.tds ? " + TDS " + inr(tot.tds) : "") + (tot.pt ? " + PT " + inr(tot.pt) : "") + (tot.pf ? " + PF " + inr(tot.pf) : "") + (tot.esi ? " + ESI " + inr(tot.esi) : "") }]
    .concat(per.slice(0, 4).map((p, i) => ({ t: "salary", ref: "sheet:" + ym + ":" + i, label: p.name + ": " + inr(p.gross) + (p.ded ? " − " + inr(p.ded) : "") + " = " + inr(p.net) })))
    .concat(per.length > 4 ? [{ t: "salary", ref: "sheet:" + ym + ":more", label: "and " + (per.length - 4) + " more on the sheet" }] : []);
  const f = finding("payroll_due", key, "resolved", Object.assign({}, base, { amt: tot.gross, short: "Payroll " + label }), ev);
  const e = entryOf(f, "payroll", dedupe, voucher, "Payroll", ev, checks);
  if (!e.ready) return you("Payroll " + label + ": " + checks.filter((c) => !c.ok).map((c) => c.why || CHECK_WORDS[c.k]).join("; "), { amt: tot.gross });
  return { finding: f, entry: e };
}

// next-payroll (the owner, 23-Nov-2026: "Night prepares every month"): a Tally Payroll company's month is prepared as ONE
// entry for Tally's own payroll voucher (posted on Approve by app/src/lib/payrollPost.js: the employees and pay heads
// are Tally's, the net to the salary payable ledger), for every month kept with the books, other deductions (an advance,
// canteen, LWF: each to its own pay head on Approve) included. No journal ledger is needed: the entry is the month's
// totals (gross, each deduction, net, the employees), worked out two ways. Books first: salary booked for the month by
// any other entry (a hand payroll voucher to "Basic" or "HRA" too) stops it (Needs you when the amount differs); the
// month's own Tally Payroll vouchers (TDSDesk:dc-tp-<yyyymm>-<n>) are what is being finished: a month split in parts
// with some in Tally stays ready until every part is there (each part's draft says how many there are)
function tallyOne(ym, rows, inp, c) {
  const { key, dedupe, vid, label, date, base, you } = c, tp = inp.payroll || {}, T = "Tally Payroll " + label;
  if (posted(inp, vid) || (inp.drafts || []).some((d) => d && d.dedupe === dedupe && !d.removed && d.state !== "failed" && !/^dc-tp-/.test(String(d.vid || "")))) return null;   // booked as a journal through Daily Check
  // (third review) a part whose FinCom id is in the books is in Tally, whatever its draft says: never "Not confirmed"
  const inBooks = new Set();
  live(inp.books).forEach((v) => { const m = String(v.narr || "").match(new RegExp("TDSDesk:(" + TP_ID(ym) + "-\\d+)")); if (m) inBooks.add(m[1]); });
  const drafts = (inp.drafts || []).map((d) => (d && inBooks.has(String(d.vid || "")) ? Object.assign({}, d, { state: "posted" }) : d));
  { const sc = sentCheck(Object.assign({}, inp, { drafts }), dedupe, "Payroll " + label, you); if (sc) return sc; }
  const mine = drafts.filter((d) => d && d.dedupe === dedupe && !d.removed && /^dc-tp-/.test(String(d.vid || "")));
  if (mine.some((d) => d.state === "live" || d.state === "pending")) return null;           // a part on its way to Tally
  const done = new Set(mine.filter((d) => d.state === "posted").map((d) => String(d.vid)));
  inBooks.forEach((x) => done.add(x));
  const parts = Math.max(0, ...mine.map((d) => Number(d.parts) || 0));
  if (parts > 0 && Array.from({ length: parts }, (_, i) => TP_ID(ym) + "-" + (i + 1)).every((x) => done.has(x))) return null;
  // 1. the sheet
  if (rows.some((r) => P(r.surcharge) || P(r.cess))) return you(T + ": the sheet has surcharge or cess on TDS. Book it by hand.");
  const seen = new Set(), twice = rows.find((r) => { const k = ledgerKey(r.name) + "|" + String(r.code || r.pan || ""); if (seen.has(k)) return true; seen.add(k); return false; });
  if (twice) return you(T + ": " + twice.name + " is on the sheet twice.");
  const per = rows.map((r) => { const gross = r2(num(r.gross)), other = r2(num(r.otherDed)), ded = r2(num(r.tds) + num(r.profTax) + num(r.pf) + num(r.esi) + other);
    const net = r.net != null && r.net !== "" ? r2(num(r.net)) : r2(gross - ded);
    return { name: r.name, gross, tds: r2(num(r.tds)), pt: r2(num(r.profTax)), pf: r2(num(r.pf)), esi: r2(num(r.esi)), other, net, ded }; });
  const wrong = per.find((p) => Math.abs(r2(p.net + p.ded) - p.gross) >= 0.005 || p.net < 0 || p.gross <= 0);
  if (wrong) return you(T + ": " + wrong.name + "'s gross " + inr(wrong.gross) + " is not net " + inr(wrong.net) + " plus deductions " + inr(wrong.ded) + ".");
  // (review, low) Tally Payroll takes an employee only with something to pay: said before anything is posted
  const zero = per.find((p) => P(p.net) === 0);
  if (zero) return you(T + ": " + zero.name + "'s net pay is ₹0. Tally Payroll can't take an employee with nothing to pay: leave them off this month's sheet, or post this month as a journal.");
  const sum = (k) => r2(per.reduce((s, p) => s + p[k], 0));
  const tot = { gross: sum("gross"), tds: sum("tds"), pt: sum("pt"), pf: sum("pf"), esi: sum("esi"), other: sum("other"), net: sum("net") };
  // 2. the books first: salary booked by any other entry (the month's own Tally Payroll vouchers left out)
  const { cls, booked } = bookedFor(ym, inp, true);
  const maybe = booked.find((v) => v.ent.some((e) => e.a < 0 && cls(e.l) === "maybe"));
  if (maybe) return you(T + ": an entry of " + dmon(maybe.date) + " to " + maybe.ent.find((e) => e.a < 0 && cls(e.l) === "maybe").l + " may be salary. Check it first.", { amt: tot.gross });
  if (booked.length) {
    const amt = r2(booked.reduce((s, v) => s + v.ent.filter((e) => e.a < 0 && cls(e.l) === "yes").reduce((x, e) => x - e.a, 0), 0));
    if (Math.abs(amt - tot.gross) <= 1) return null;
    return you(T + ": salary booked " + inr(amt) + ", the sheet says " + inr(tot.gross) + ".", { amt: tot.gross });
  }
  // 3. the salary payable ledger: the one picked on Payroll, else the one certain by name and group; none yet is no stop
  // (Approve asks for it on Payroll)
  const L = new Set(inp.ledgers || []), payable = tp.payable && L.has(tp.payable) ? tp.payable : (pickLedger("salaryPayable", inp).ledger || "");
  // 4. two ways
  const plain = payrollPlain(rows);
  const agree = !plain.bad && plain.adds && [["gross", "gross"], ["tds", "tds"], ["profTax", "pt"], ["pf", "pf"], ["esi", "esi"], ["other", "other"], ["net", "net"]].every(([a, b]) => P(plain[a]) === P(tot[b]))
    && P(tot.gross) === P(tot.net) + P(tot.tds) + P(tot.pt) + P(tot.pf) + P(tot.esi) + P(tot.other);
  const voucher = { type: tp.vchType || "Payroll", kind: "tallyPayroll", date, no: "", party: payable, period: ym, book: inp.bookId || "", lines: [], n: rows.length,
    gross: tot.gross, net: tot.net, ded: { tds: tot.tds, pt: tot.pt, pf: tot.pf, esi: tot.esi, other: tot.other },
    narration: "Salary for " + label + " as per the salary sheet (" + rows.length + " employee" + (rows.length === 1 ? "" : "s") + ")" };
  const checks = checkEntry({ voucher: { date }, source: "journal" }, inp).filter((x) => x.k === "period");
  checks.push({ k: "duplicate", ok: true, why: "" });
  checks.push({ k: "adds", ok: plain.adds && !plain.bad, why: plain.bad ? plain.bad + " does not add up" : "" });
  checks.push({ k: "twoways", ok: agree, why: agree ? "" : "The plain sums and the totals differ" });
  const ev = [{ t: "salary", ref: "sheet:" + ym, label: "Salary sheet " + label + " · " + rows.length + " employee" + (rows.length === 1 ? "" : "s") },
    { t: "salary", ref: "sheet:" + ym + ":tot", label: "Gross " + inr(tot.gross) + " = net " + inr(tot.net) + (tot.tds ? " + TDS " + inr(tot.tds) : "") + (tot.pt ? " + PT " + inr(tot.pt) : "") + (tot.pf ? " + PF " + inr(tot.pf) : "") + (tot.esi ? " + ESI " + inr(tot.esi) : "") + (tot.other ? " + other deductions " + inr(tot.other) : "") }]
    .concat(per.slice(0, 4).map((p, i) => ({ t: "salary", ref: "sheet:" + ym + ":" + i, label: p.name + ": " + inr(p.gross) + (p.ded ? " − " + inr(p.ded) : "") + " = " + inr(p.net) })))
    .concat(per.length > 4 ? [{ t: "salary", ref: "sheet:" + ym + ":more", label: "and " + (per.length - 4) + " more on the sheet" }] : [])
    .concat(done.size ? [{ t: "entry", ref: "tp:" + ym + ":done", label: done.size + " part" + (done.size === 1 ? "" : "s") + " already in Tally: Approve posts the rest" }] : []);
  const f = finding("payroll_due", key, "resolved", Object.assign({}, base, { amt: tot.gross, short: T }), ev);
  const e = entryOf(f, "payroll", dedupe, voucher, "Tally Payroll", ev, checks);
  if (!e.ready) return you(T + ": " + checks.filter((x) => !x.ok).map((x) => x.why || CHECK_WORDS[x.k]).join("; "), { amt: tot.gross });
  return { finding: f, entry: e };
}

// ---------------------------------------------------------------- 3. monthly repeats in the books
// A journal (no bank or cash line, not a tax-only or salary journal) with the same ledgers on the same sides, once a month
// for 3 or more months in a row, amounts within 2% of each other. When the next month's is missing past its usual day plus
// 5 days, it is proposed: ready only when the last three were the very same (the same lines, to the paisa); amounts that
// moved within 2% need you. Never for an amount outside the pattern.
export function recurringAll(inp) {
  const A = groupsOf(inp.books || {}), map = (inp.books || {}).map || {}, today = inp.today, cur = ymOf(today), out = [];
  const fit = (v) => /JOURNAL/i.test(v.type) && v.ent.length >= 2 && !v.ent.some((e) => A.isBankL(e.l) || A.isCash(e.l)) && !taxOnly(v, A, map) &&
    !v.ent.some((e) => /SALAR|WAGES/i.test(e.l));   // FinCom's own posted monthly entries count too (review L3): the series goes on
  const sig = (v) => v.ent.filter((e) => !/ROUND/i.test(e.l) && (map[e.l] || {}).kind !== "roundoff").map((e) => e.l + (e.a < 0 ? "|D" : "|C")).sort().join(";");
  const by = new Map();
  live(inp.books).filter((v) => v.date > ymAdd(cur, -14) + "00" && fit(v)).forEach((v) => { const k = sig(v); if (!by.has(k)) by.set(k, []); by.get(k).push(v); });
  for (const [k, vs] of Array.from(by.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const per = new Map();
    vs.forEach((v) => { const m = ymOf(v.date); if (!per.has(m)) per.set(m, []); per.get(m).push(v); });
    const months = Array.from(per.keys()).sort(), lastM = months[months.length - 1];
    // the run of months that ends at the last one, each with exactly one such entry
    let run = [];
    for (let m = lastM; per.has(m) && per.get(m).length === 1; m = ymAdd(m, -1)) run.unshift(per.get(m)[0]);
    if (run.length < 3) continue;
    const amt = (v) => r2(v.ent.filter((e) => e.a < 0).reduce((s, e) => s - e.a, 0)), as = run.map(amt), lo = Math.min(...as), hi = Math.max(...as);
    if (!(lo > 0) || hi > lo * 1.02) continue;                     // not a pattern
    const target = ymAdd(lastM, 1);
    if (target > cur) continue;                                    // the next one is not due yet
    if (target < ymAdd(cur, -1)) continue;                         // two or more months missed: the pattern is broken
    const days = run.map((v) => +v.date.slice(6, 8)), monthEnd = run.every((v) => v.date === lastDay(ymOf(v.date)));
    const usual = monthEnd ? +lastDay(target).slice(6, 8) : days.slice().sort((a, b) => a - b)[Math.floor(days.length / 2)];
    const when = monthEnd ? lastDay(target) : dayIn(target, usual), due = addDays(when, 5);
    if (today <= due) continue;
    // the month after is due too and missing: two in a row missed, the pattern is broken
    if (target < cur && today > addDays(monthEnd ? lastDay(cur) : dayIn(cur, usual), 5)) continue;
    const key = "rec:" + voucherId(k).slice(3) + ":" + target, dedupe = key, vid = voucherId(dedupe);
    if (posted(inp, vid)) continue;
    const last = run[run.length - 1], lines = vLines(last), drL = lines.filter((l) => l.dr).map((l) => l.ledger);
    const party = (lines.find((l) => l.cr && !isExp(A, l.ledger)) || lines.find((l) => l.cr) || lines[0]).ledger;
    { const sc = sentCheck(inp, dedupe, party + " " + monYear(target), (title, c, extra) => ({ finding: finding("recurring_due", key, "you", Object.assign({ party, ym: target, short: "Monthly: check", title }, extra || {}), [], c || []) })); if (sc) { out.push(sc); continue; } }
    if (pending(inp, dedupe)) continue;
    // an entry in the target month to the same expense for about the same amount (other ledgers): it may be this month's
    const maybe = live(inp.books).find((v) => ymOf(v.date) === target && v.ent.some((e) => e.a < 0 && drL.includes(e.l) && Math.abs(-e.a - lines.find((l) => l.ledger === e.l).dr) <= 0.02 * lines.find((l) => l.ledger === e.l).dr));
    const label = monYear(target), first = run[0], rng = monYear(ymOf(first.date)).split(" ")[0] + "–" + monYear(ymOf(last.date));
    const base = { party, ym: target, date: when, n: run.length, sig: k };
    const ev = [{ t: "pattern", ref: "pat:" + k, label: "Same entry " + run.length + " months in a row (" + rng + ")" + (lo === hi ? ", " + inr(lo) + " each" : ", " + inr(lo) + " to " + inr(hi)) + (monthEnd ? ", at month end" : ", about the " + ordinal(usual)) }]
      .concat(run.slice(-3).map((v) => ({ t: "entry", ref: "vch:" + v.id, label: v.type + " " + dmon(v.date) + " · " + inr(amt(v)) })));
    const you = (title) => out.push({ finding: finding("recurring_due", key, "you", Object.assign({}, base, { amt: amt(last), short: "Monthly: check", title }), [], []) });
    if (maybe) { you(party + " " + label + ": an entry of " + dmon(maybe.date) + " may be this month's. Check it."); continue; }
    const same3 = run.slice(-3).every((v) => sameLines(vLines(v), lines));
    if (!same3) { you(party + " " + label + " is missing. The amount moved (" + inr(lo) + " to " + inr(hi) + "): enter it by hand."); continue; }
    const voucher = { type: "Journal", kind: "recurring", date: when, no: "", party, period: target, book: inp.bookId || "", lines: merge(lines),
      narration: "Monthly entry for " + label + ", as in " + rng };
    const checks = baseChecks(voucher, inp, []);
    checks.push({ k: "duplicate", ok: true, why: "" });
    const g = gstOfLines(voucher.lines, map);
    if (g) checks.push({ k: "gst", ok: g.ok, why: g.ok ? "" : "The GST on these lines is not a GST rate" });
    checks.push({ k: "pattern", ok: sameLines(voucher.lines, lines) && P(totalDr(voucher.lines)) === P(amt(last)), why: "" });
    const f = finding("recurring_due", key, "resolved", Object.assign({}, base, { amt: amt(last), short: party + " " + label.split(" ")[0] }), ev);
    const e = entryOf(f, "recurring", dedupe, voucher, "Monthly", ev, checks);
    if (!e.ready) { you(party + " " + label + ": " + checks.filter((c) => !c.ok).map((c) => c.why || CHECK_WORDS[c.k]).join("; ")); continue; }
    out.push({ finding: f, entry: e });
  }
  return out;
}
const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
const addDays = (d, n) => { const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) + n * 86400000); return t.getUTCFullYear() + String(t.getUTCMonth() + 1).padStart(2, "0") + String(t.getUTCDate()).padStart(2, "0"); };
// GST on a journal's own lines (a retainer's bill booked by journal): the tax a GST rate of the rest of the debit side
function gstOfLines(lines, map) {
  const tax = lines.filter((l) => (map[l.ledger] || {}).kind === "gst");
  if (!tax.length) return null;
  const head = (h) => tax.filter((l) => String((map[l.ledger] || {}).tax || "").toUpperCase() === h).reduce((s, l) => s + P(l.dr || l.cr), 0);
  const base = lines.filter((l) => l.dr && (map[l.ledger] || {}).kind !== "gst").reduce((s, l) => s + P(l.dr), 0);
  const t = head("IGST") + head("CGST") + head("SGST"), rate = base ? t * 100 / base : 0;
  const split = head("IGST") ? !head("CGST") && !head("SGST") : head("CGST") === head("SGST");
  const std = [0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28, 40].find((x) => Math.abs(rate - x) < 0.05);
  return { ok: split && std != null && Math.abs(base * std / 100 - t) <= 100 };
}

// ---------------------------------------------------------------- all of them, for one client's night
export function journals(inp) {
  const today = inp.today || "", cur = ymOf(today), findings = [], entries = [], byKey = new Map();
  const put = (r) => {
    if (!r) return;
    (r.picks || []).forEach((p) => { if (!byKey.has(p.kind + "|" + p.key)) { byKey.set(p.kind + "|" + p.key, p); findings.push(p); } });
    findings.push(r.finding); if (r.entry) entries.push(r.entry);
  };
  const months = []; for (let i = LOOKBACK; i >= 1; i--) months.push(ymAdd(cur, -i));
  // the set-off: each month's own journal, so one month's journal in the books is not taken for another's
  const gst = (inp.gst || []).filter((m) => months.includes(m.ym));
  const others = gst.filter((m) => m.journal).map((m) => ({ ym: m.ym, lines: m.journal.lines.map((l) => P(l.dr) ? { ledger: l.l, dr: l.dr } : { ledger: l.l, cr: l.cr }) }));
  gst.forEach((m) => put(setoffOne(m, inp, others)));
  // the payroll: each month of the sheet, after it ends, not before the books begin
  const sheet = new Map();
  (inp.salary || []).forEach((r) => { const m = sheetMonth(r); if (m && months.includes(m) && (!inp.booksFrom || m >= ymOf(inp.booksFrom))) { if (!sheet.has(m)) sheet.set(m, []); sheet.get(m).push(r); } });
  Array.from(sheet.keys()).sort().forEach((m) => put(payrollOne(m, sheet.get(m), inp)));
  recurringAll(inp).forEach(put);
  // a ledger a person picked earlier stays answered (its finding is kept as they left it)
  return { findings, entries };
}
// the people's ledger choices, from what earlier nights found (ledger_pick answered)
// (review N2) the hand journals the owner said are not a month's set-off: "<reg>:<ym>:<voucher id>"
export function excludedOf(prior) {
  const o = new Set();
  (prior || []).forEach((p) => { const ev = (p.evidence || [])[0]; if (p.kind === "setoff_exclude" && p.state === "resolved" && !p.undone && ev && ev.t === "exclude") o.add(String(p.key).replace(/^excl:/, "")); });
  return o;
}
// (final review 1) what a draft proves, the same rule as the server's asst_draft_state: "posted" only with proof the
// voucher reached Tally (the cloud's job reports THIS voucher's result ok; FinCom's id in the books is checked by the
// builder itself); "live" while its job is still waiting, taken or running; anything else ("failed": Tally refused it,
// the queue stopped it, a job done without this voucher ok, or a draft with no job at all) is offered again. The bridge
// checks Tally for FinCom's id before posting, so a voucher already there is never posted twice
// (last fix) the draft's own result for its voucher (posted straight to the bridge here: no cloud job) is proof when ok
// AND it carries Tally's voucher id. A draft saying posted without that proof is "pending" for 24 hours, then
// "unconfirmed" (Needs you), never failed; once the owner said "Not in Tally: offer it again" for that draft (a sent_check
// answered) it is failed. d.ver: the draft's version, its voucher's own send time (results[vid].at; "-" when none), the
// same on the server; d.at: the time its age is counted from (that send time, else when it was saved)
export const DAY_MS = 24 * 3600 * 1000;
export function draftState(d, jobs, now, retried) {
  if (d.removed) return "failed";
  const own = (d.results || {})[d.vid];
  if (own && own.ok === true && String(own.tallyId || own.vchId || own.masterId || "").trim()) return "posted";
  const j = (jobs || {})[d.job || ""];
  const res = j && Array.isArray(j.results) ? j.results.find((x) => x && x.id === d.vid) : null;
  if (res && res.ok === true) return "posted";
  if (j && /^(waiting|taken|running)$/.test(String(j.status || ""))) return "live";
  if (String(d.state || "") === "posted") {
    if (retried && retried.has("sent:" + d.dedupe + ":" + (d.ver || "-"))) return "failed";
    const at = Date.parse(String(d.at || "")), t = now == null ? Date.now() : now;
    return isFinite(at) && t - at <= DAY_MS ? "pending" : "unconfirmed";
  }
  return "failed";
}
// the drafts the owner said are not in Tally (sent_check answered "offer it again")
export function retriedOf(prior) {
  const o = new Set();
  (prior || []).forEach((p) => { const ev = (p.evidence || [])[0]; if (p.kind === "sent_check" && p.state === "resolved" && !p.undone && ev && ev.t === "retry") o.add(String(p.key)); });
  return o;
}
// (outside: which of them the person confirmed though the ledger is in another group)
export function picksOf(prior, outside) {
  const o = {};
  (prior || []).forEach((p) => { if (p.kind === "ledger_pick" && p.state === "resolved" && !p.undone && (p.evidence || [])[0] && p.evidence[0].ledger) o[String(p.key).replace(/^led:/, "")] = outside ? !!p.evidence[0].outside : p.evidence[0].ledger; });
  return o;
}
// bank lines paying an employee: the sheet's name (by ledgerKey) and net pay for the month, within ₹1
export function salaryLineFor(row, x, inp) {
  const dname = ledgerKey((row.dec && row.dec.name) || "");
  if (!dname || x.dir !== "out") return null;
  // the month the pay is for: a line by the 15th pays the month before (as nightchecks counts salary paid)
  const m = +String(x.date).slice(6, 8) <= 15 ? ymAdd(ymOf(x.date), -1) : ymOf(x.date);
  const rows = (inp.salary || []).filter((r) => sheetMonth(r) === m && ledgerKey(r.name) === dname);
  if (!rows.length) return null;
  const net = r2(rows.reduce((s, r) => s + sheetNet(r), 0));
  return { m, net, name: rows[0].name, n: rows.length };
}
