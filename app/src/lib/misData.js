// "My MIS" (ROUND 105, B1): the books in this browser made into the engine's input (app/src/lib/misCustom.js, its `data`).
// Everything a figure depends on is decided here by the existing program, never again by the engine: each ledger's MIS
// head and P&L line (MIS.plHead), its nature and side (FS.nature), where its balance goes in the balance sheet (FS.place),
// its Financial-statement code (FinSt.tb / FinSt.codeOf), each entry's sales and customer (MIS.sales' rule) and purchases
// and supplier (MIS.purchases' rule), the opening balances (Audit.balances), GST by month (MIS.compliance: the GST
// builders) and the ageing (MIS.ageing). G holds the program's globals (globalThis in the app; the test passes its own).
// A lazy module: loaded with the My MIS screen; nothing here is in legacy.js.
import { periodOf, r2 } from "./misCustom.js";

const N = (v) => (typeof v === "number" ? (isFinite(v) ? v : 0) : (isFinite(parseFloat(v)) ? parseFloat(v) : 0));
export function needsOf(def) {
  const by = (def.blocks || []).map((b) => b.rows.by);
  return { gst: by.includes("gst"), ageing: by.includes("ageing"), code: by.includes("code") };
}

export function buildMisData(G, def, o = {}) {
  const S = G.S, b = (S && S.books) || {}, A = G.Audit, MIS = G.MIS, FS = G.FS, Books = G.Books, FinSt = G.FinSt;
  const all = (b.vouchers || []).filter((v) => !v.opt && !v.cancel);
  let first = "", last = ""; all.forEach((v) => { if (!first || v.date < first) first = v.date; if (v.date > last) last = v.date; });
  const booksFrom = String((b.meta || {}).from || first || ""), booksTo = String((b.meta || {}).to || last || "");
  const pr = periodOf(def, { booksTo }, o.today), need = needsOf(def);
  // each ledger's rule, once
  const memo = {}, c = FS ? FS.cfg(b) : null, masters = A.mastersIn();
  const led = (l) => {
    if (memo[l]) return memo[l];
    const k = MIS.plHead(l, c) || {}, n = FS ? FS.nature(l) : { rev: !!k.h, dr: k.h && k.h !== "rev" && k.h !== "oth" };
    const x = { g: A.path(l), h: k.h || "", s: k.s || "", dc: n.dr ? -1 : 1, rev: !!n.rev,
      kind: A.isDebtor(l) ? "r" : A.isCreditor(l) ? "p" : A.isBankL(l) ? "bank" : A.isCash(l) ? "cash" : "",
      pur: A.under(l, /^purchase accounts$/i), sales: A.under(l, /^sales accounts$/i), exp: A.isExpense(l), fixed: A.isFixed(l),
      place: FS ? { dr: FS.place(l, -1, "co"), cr: FS.place(l, 1, "co") } : {}, code: "" };
    memo[l] = x; return x;
  };
  // the entries, each with its sales and customer (MIS.sales) and its purchases and supplier (MIS.purchases)
  const vouchers = all.map((v) => {
    const out = { id: v.id, date: v.date, no: v.no, type: v.type, party: v.party || "", narr: v.narr || "", ent: v.ent.map((e) => ({ l: e.l, a: e.a })) };
    v.ent.forEach((e) => led(e.l));
    let sa = 0;
    if (masters) { const s = v.ent.filter((e) => memo[e.l].sales); if (s.length) sa = r2(s.reduce((t, e) => t + e.a, 0)); }
    else if (Books.isSale(v)) sa = r2(Books.lines(v).taxable * (/CREDIT NOTE/i.test(v.type) ? -1 : 1));
    if (sa) { out.sa = sa; out.who = v.party || (v.ent.find((e) => memo[e.l].kind === "r") || v.ent.find((e) => (e.a < 0) !== (sa < 0) && !memo[e.l].sales) || {}).l || "—"; }
    if (!Books.isSale(v)) {
      const p = v.ent.find((e) => e.a > 0 && memo[e.l].kind === "p");
      if (p) { const val = r2(v.ent.filter((e) => e.a < 0 && (memo[e.l].exp || memo[e.l].pur || memo[e.l].fixed)).reduce((s, e) => s - e.a, 0)); if (val) { out.pa = val; out.pw = p.l; } }
    }
    return out;
  });
  // the balances the closing figures start from: as MIS takes them for the period (Audit.balances)
  let open = null, B = null;
  try { B = A.balances(pr.from, pr.to); } catch (e) { B = null; }
  if (B && B.ok) {
    const tbRoute = b.tb && b.tb.from <= pr.from && b.tb.to >= pr.to, from = tbRoute ? b.tb.from : (first || booksFrom);
    open = { from, bal: B.at(A.dayBefore(from)) };
    Object.keys(open.bal).forEach((l) => led(l));
  }
  Object.keys(b.ledInfo || {}).concat(Object.keys(b.under || {}).filter((n) => !(b.groups || {})[n])).forEach((l) => { if ((b.ledInfo || {})[l]) led(l); });
  // Financial-statement codes: the trial balance of the report's year (FinSt.tb), else each ledger's code by rule
  let codes = null;
  if (need.code && FinSt) {
    codes = {};
    Object.entries(FinSt.CODES).forEach(([k, x]) => { codes[k] = { label: x.label, note: x.note, side: x.side, sign: x.sign }; });
    const fy = A.fyStart(pr.to).slice(0, 4), T = FinSt.tb(fy);
    if (T && !T.error) T.rows.forEach((r) => { if (!r.synthetic && r.code && memo[r.ledger]) memo[r.ledger].code = r.code; });
    Object.keys(memo).forEach((l) => { if (!memo[l].code) { try { memo[l].code = FinSt.codeOf(l, 0).code || ""; } catch (e) { /* no code */ } } });
  }
  // GST by month (the GST builders, as MIS's Compliance tab) and the ageing (MIS.ageing), only when a block shows them
  let gst = null, ageing = null;
  if (need.gst) { try { gst = {}; MIS.compliance(pr.from, pr.to).gst.forEach((g) => { gst[g.ym] = { out: g.out, itc: g.itc, rcm: g.rcm, carry: g.carry, due: g.due, pay: g.pay }; }); } catch (e) { gst = null; } }
  if (need.ageing) {
    const balTo = B && B.ok ? B.at(pr.to) : null;
    const one = (side) => { const Ag = MIS.ageing(pr.to, side, balTo); return { sum: { nb: Ag.sum.nb, und: Ag.sum.und, owe: Ag.sum.owe, advance: Ag.sum.advance }, rows: Ag.rows.map((p) => ({ party: p.party, nb: p.nb, und: p.und, owe: r2(Math.max(0, N(p.net))) })) }; };
    try { ageing = { asOn: pr.to, r: one("r"), p: one("p") }; } catch (e) { ageing = null; }
  }
  return { v: 1, company: ((G.CO && G.CO()) || {}).name || (b.meta || {}).company || "", booksFrom, booksTo, vouchers, ledgers: memo, open, codes, gst, ageing, budget: b.budget || {} };
}
