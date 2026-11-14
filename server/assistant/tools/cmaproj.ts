// CMA data, the projected years on the user's own figures (the owner, 14-Nov-2026: five years after the one now running,
// revenue by year, gross and EBITDA margins by year, depreciation and interest by year, one tax rate). Each
// year from the one before, on the figures the user gave for it (cmaplan.ts) and FinCom's stated defaults for the rest:
//   - revenue: the amount given, else the growth given, else the growth of the year before (the base's trend, kept within
//     -10% to 25%, for the first); an amount beats a growth that does not match it, and the difference is listed;
//   - gross margin and EBITDA margin: as given (an amount given beats its %), else the nearest year's given, else the base
//     year's own; cost of materials = revenue less the gross profit; employee and other costs = the gross profit less the
//     EBITDA, split as in the base year; other income nil where the user's EBITDA is used (so EBITDA - depreciation -
//     interest = PBT, as in the user's own table);
//   - depreciation and interest: as given, else the nearest year's given, else the base's rates;
//   - tax: the rate given (the year's, else one for all years), else the base year's effective rate, else 25.17% (a
//     company) or 31.2%; on the profit before tax, nil on a loss;
//   - the balance sheet: receivables, stock and creditors at the base year's days; the net block plus the capital
//     expenditure less the depreciation (with depreciation given and no capex, the capex is the depreciation, said);
//     the profit to reserves (or capital); term loans less their repayment; everything else as at the base; cash and bank
//     the balancing figure, a shortfall borrowed from the bank and repaid first from later surplus cash. The balance sheet balances by construction, and the forms'
//     own checks (cmaengine.ts) test it and the fund flow again.
// Plain module.
import { CYear, Lines, LIAB, ASSET, sumOf } from "./cmaengine.ts";
import type { Plan, YP } from "./cmaplan.ts";

const fyL = (y: number) => y + "-" + String((y + 1) % 100).padStart(2, "0");
const pc = (v: number) => (Math.round(v * 10) / 10) + "%";
const cr = (v: number) => "₹" + (v / 1e7).toFixed(2) + " Cr";
const g = (l: Lines, k: string) => (typeof l[k] === "number" && isFinite(l[k]) ? l[k] : 0);

export type ProjOpts = { kind: string, newLoans?: number[] | null, repay?: number[] | null, capex?: number[] | null, div?: number[] | null, trDays?: number | null, invDays?: number | null, tpDays?: number | null };
export type PlanOut = { lines: Lines[], said: string[], diffs: string[] };

export function projectPlan(base: CYear, prev: CYear | null, fys: number[], plan: Plan, o: ProjOpts): PlanOut {
  const b = base.l, said: string[] = [], diffs: string[] = [];
  const at = (a: number[] | null | undefined, i: number) => (a && a.length ? a[Math.min(i, a.length - 1)] || 0 : 0);
  const step = Math.max(plan.step, 1);
  const rev0 = g(b, "rev"), cost0 = g(b, "mat") + g(b, "pur") + g(b, "chg"), over0 = g(b, "emp") + g(b, "exp");
  const gm0 = rev0 > 0 ? (rev0 - cost0) / rev0 * 100 : 30, em0 = rev0 > 0 ? (rev0 - cost0 - over0) / rev0 * 100 : 10;
  const empShare = over0 > 0 ? g(b, "emp") / over0 : 0.5;
  // the user's figure of a year, else the nearest year's (later first), said once a year
  const Y = (fy: number): YP => plan.years[fy] || {};
  const nearest = (k: keyof YP, fy: number): { v: number, fy: number } | null => {
    const ys = Object.keys(plan.years).map(Number).filter((y) => plan.years[y][k] != null);
    if (!ys.length) return null;
    const later = ys.filter((y) => y > fy).sort((a, c) => a - c), earlier = ys.filter((y) => y < fy).sort((a, c) => c - a);
    const y = later[0] ?? earlier[0];
    return { v: plan.years[y][k] as number, fy: y };
  };
  const anyEbitda = Object.values(plan.years).some((y) => y.em != null || y.ebitda != null);
  // the base year's trend for revenue when nothing is given at all
  const rp = prev ? g(prev.l, "rev") : 0, trend = rp > 0 && rev0 > 0 ? rev0 / rp - 1 : null;
  const g0 = trend == null ? 0.10 : Math.max(-0.10, Math.min(0.25, trend));
  // days of the base year
  const days = (v: number, on: number) => (on > 0 ? v / on * 365 : 0);
  const trD = o.trDays ?? days(g(b, "tr"), rev0), invD = o.invDays ?? days(g(b, "inv"), cost0 > 0 ? cost0 : rev0), tpD = o.tpDays ?? days(g(b, "tp"), (cost0 > 0 ? cost0 : 0) + g(b, "exp"));
  // depreciation and interest rates of the base
  const block = (l: Lines) => g(l, "ppe") + g(l, "intang");
  const open0 = prev && block(prev.l) > 0 ? block(prev.l) : block(b) + g(b, "dep"), dr = open0 > 0 ? Math.min(0.6, g(b, "dep") / open0) : 0;
  const debt = (l: Lines) => g(l, "ltb") + g(l, "stb") + g(l, "stbo") + g(l, "cm");
  const ir = debt(b) > 0 ? Math.min(0.3, g(b, "fin") / debt(b)) : 0;
  const pbt0 = rev0 + g(b, "oth") - cost0 - over0 - g(b, "fin") - g(b, "dep") - g(b, "exc") - g(b, "xo"), eff = pbt0 > 0 ? g(b, "tax") / pbt0 : 0;
  // with tax amounts given and no rate: the rate they imply (to the nearest 1%), so the user's own tax is kept
  const tx = Object.values(plan.years).filter((y) => y.tax != null && y.pbt != null && (y.pbt as number) > 0);
  const implied = tx.length ? Math.round(tx.reduce((t, y) => t + (y.tax as number), 0) / tx.reduce((t, y) => t + (y.pbt as number), 0) * 100) : null;
  const taxDefault = implied != null && implied > 0 && implied < 60 ? implied : eff > 0.05 && eff < 0.5 ? eff * 100 : o.kind === "company" ? 25.17 : 31.2;
  const toCap = o.kind !== "company" && !g(b, "share") ? (g(b, "current") ? "current" : "capital") : "reserves";
  const depGiven = Object.values(plan.years).some((y) => y.dep != null);

  const out: Lines[] = [];
  let lastG = g0, extra = 0;
  const gapSaid: string[] = [];
  const revSaid: string[] = [], from: Record<string, string[]> = {};
  const note = (k: string, t: string) => { (from[k] ||= []).push(t); };
  for (let i = 0; i < fys.length; i++) {
    const fy = fys[i], y = Y(fy), p = i ? out[i - 1] : b, pRev = g(p, "rev");
    // revenue
    let rev: number;
    if (y.rev != null) {
      rev = y.rev;
      if (y.growth != null && pRev > 0) {
        const imp = (rev / pRev - 1) * 100;
        if (Math.abs(imp - y.growth) >= 0.05) diffs.push(fyL(fy) + ": revenue " + cr(rev) + " is " + pc(imp) + " over " + fyL(fy - 1) + "'s " + cr(pRev) + "; you said " + pc(y.growth) + ". The amount is used.");
      }
      revSaid.push(fyL(fy) + " " + cr(rev) + " (as you gave it)");
    } else if (y.growth != null) { rev = pRev * (1 + y.growth / 100); revSaid.push(fyL(fy) + " " + cr(rev) + " (" + pc(y.growth) + " growth, as you gave it)"); }
    else { rev = pRev * (1 + lastG); revSaid.push(fyL(fy) + " " + cr(rev) + " (" + pc(lastG * 100) + " growth: not given, " + (i ? "the year before's" : "the base year's trend" + (trend != null && Math.abs(trend - g0) > 1e-9 ? ", capped" : "")) + ")"); }
    if (pRev > 0) lastG = rev / pRev - 1;
    // the margins (an amount beats its %)
    const margin = (amtK: "gp" | "ebitda", pctK: "gm" | "em", dflt: number, words: string) => {
      const a = y[amtK], pct = y[pctK];
      if (a != null && rev > 0) {
        const m = a / rev * 100;
        if (pct != null && Math.abs(a - rev * pct / 100) > step * 1.5) diffs.push(fyL(fy) + ": " + words + " " + cr(a) + " is " + pc(m) + " of the revenue; you said " + pc(pct) + ". The amount is used.");
        return m;
      }
      if (pct != null) return pct;
      const n = nearest(pctK, fy) || (nearest(amtK, fy) && plan.years[nearest(amtK, fy)!.fy].rev ? { v: nearest(amtK, fy)!.v / (plan.years[nearest(amtK, fy)!.fy].rev as number) * 100, fy: nearest(amtK, fy)!.fy } : null);
      if (n) { note(pctK, fyL(fy) + " " + pc(n.v) + " (not given: " + fyL(n.fy) + "'s)"); return n.v; }
      note(pctK, fyL(fy) + " " + pc(dflt) + " (not given: the base year's)");
      return dflt;
    };
    const gm = margin("gp", "gm", gm0, "gross profit");
    let em = margin("ebitda", "em", em0, "EBITDA");
    if (em > gm) { diffs.push(fyL(fy) + ": the EBITDA margin " + pc(em) + " is above the gross margin " + pc(gm) + "; taken as the gross margin (no other costs)."); em = gm; }
    const l: Lines = {};
    for (const k of [...LIAB, ...ASSET]) l[k] = g(p, k);
    l.rev = rev; l.mat = rev * (1 - gm / 100); l.pur = 0; l.chg = 0;
    const over = rev * (gm - em) / 100;
    l.emp = over * empShare; l.exp = over - l.emp; l.exc = 0; l.xo = 0;
    l.oth = anyEbitda ? 0 : g(b, "oth");
    // depreciation and interest
    const nd = y.dep == null ? nearest("dep", fy) : null;
    l.dep = y.dep ?? (nd ? nd.v : block(p) * dr);
    if (y.dep == null) note("dep", fyL(fy) + " " + cr(l.dep) + (nd ? " (not given: " + fyL(nd.fy) + "'s)" : " (not given: " + pc(dr * 100) + " of the opening block, the base year's rate)"));
    const nf = y.fin == null ? nearest("fin", fy) : null;
    l.fin = y.fin ?? (nf ? nf.v : debt(p) * ir);
    if (y.fin == null) note("fin", fyL(fy) + " " + cr(l.fin) + (nf ? " (not given: " + fyL(nf.fy) + "'s)" : " (not given: " + pc(ir * 100) + " of the borrowings, the base year's rate)"));
    const pbt = l.rev + l.oth - l.mat - l.emp - l.exp - l.dep - l.fin;
    if (y.pbt != null && Math.abs(y.pbt - pbt) > step * 3) diffs.push(fyL(fy) + ": your profit before tax " + cr(y.pbt) + "; EBITDA less depreciation and interest gives " + cr(pbt) + ", which is used.");
    const rate = y.taxRate ?? plan.taxRate ?? taxDefault;
    l.tax = Math.max(0, pbt) * rate / 100;
    if (y.tax != null && Math.abs(y.tax - l.tax) > step * 3) diffs.push(fyL(fy) + ": your tax " + cr(y.tax) + "; " + pc(rate) + " of the profit before tax is " + cr(l.tax) + ", which is used.");
    const pat = pbt - l.tax;
    if (y.pat != null && Math.abs(y.pat - pat) > step * 4) diffs.push(fyL(fy) + ": your profit after tax " + cr(y.pat) + "; FinCom's is " + cr(pat) + ", which is used.");
    // the balance sheet
    let capex = o.capex ? at(o.capex, i) : depGiven ? l.dep : 0;
    l.ppe = g(p, "ppe") + capex - l.dep;
    if (l.ppe < 0) { capex -= l.ppe; l.ppe = 0; }
    const repaid = Math.min(g(p, "ltb"), at(o.repay, i));
    l.ltb = g(p, "ltb") + at(o.newLoans, i) - repaid;
    l.tr = rev * trD / 365; l.inv = l.mat * invD / 365; l.tp = (l.mat + l.exp) * tpD / 365;
    l[toCap] = g(p, toCap) + pat - at(o.div, i);
    // cash is the balancing figure: a shortfall is borrowed from the bank, and that borrowing is repaid first from a later
    // year's surplus cash (never carried for ever); the bank borrowings of the base year stay as they were
    let cash = sumOf(l, LIAB) - sumOf(l, ASSET.filter((k) => k !== "cash"));
    if (cash < 0) { l.stb = g(l, "stb") - cash; extra += -cash; gapSaid.push(fyL(fy) + " short by " + cr(-cash) + ", borrowed"); cash = 0; }
    else if (extra > 0 && cash > 0) { const r = Math.min(extra, cash); l.stb = g(l, "stb") - r; extra -= r; cash -= r; gapSaid.push(fyL(fy) + " " + cr(r) + " of it repaid from the surplus cash"); }
    l.cash = cash;
    out.push(l);
  }
  // what was used, in the Assumptions
  said.push("Revenue: " + revSaid.join("; ") + ".");
  said.push("Gross margin (revenue less the cost of materials and goods) " + (from.gm ? "as you gave it, and for the years not given: " + from.gm.join("; ") : "as you gave it") + ".");
  said.push("EBITDA margin " + (from.em ? "as you gave it, and for the years not given: " + from.em.join("; ") : "as you gave it") + "; employee and other costs are the gross profit less the EBITDA, split " + Math.round(empShare * 100) + ":" + (100 - Math.round(empShare * 100)) + " as in " + fyL(base.fy) + ".");
  if (anyEbitda) said.push("Other income nil in the projected years, so that EBITDA less depreciation and interest is the profit before tax, as in your figures.");
  const given = (k: keyof YP) => Object.values(plan.years).some((y) => y[k] != null);
  const w = (k: keyof YP, t: string[] | undefined) => (given(k) ? "as you gave it" + (t ? "; " + t.join("; ") : "") : (t || []).join("; "));
  said.push("Depreciation " + w("dep", from.dep) + ". Interest " + w("fin", from.fin) + (given("fin") ? " (not tied to the borrowings)" : "") + ".");
  said.push("Tax at " + (plan.taxRate != null ? pc(plan.taxRate) + " (as you said)" : Object.values(plan.years).some((y) => y.taxRate != null) ? "the rates you gave" : pc(taxDefault) + (implied != null && implied === taxDefault ? " (the rate your tax figures imply)" : eff > 0.05 && eff < 0.5 ? " (" + fyL(base.fy) + "'s effective rate)" : " (FinCom's default)")) + " of the profit before tax; nil on a loss.");
  said.push(o.capex ? "Capital expenditure as you said." : depGiven ? "Capital expenditure not given: taken equal to each year's depreciation, so the net block stays as at " + fyL(base.fy) + " (tell me the capex to change it)." : "No new fixed assets (capital expenditure nil).");
  said.push("Receivables at " + Math.round(trD) + " days of revenue, stock at " + Math.round(invD) + " days of the cost of materials and creditors at " + Math.round(tpD) + " days of materials and other costs" + (o.trDays != null || o.invDays != null || o.tpDays != null ? " (as you said where given; else " + fyL(base.fy) + "'s)." : ", as in " + fyL(base.fy) + "."));
  said.push("The profit after tax goes to " + (toCap === "reserves" ? "reserves and surplus" : "the " + toCap + " account") + (o.div ? " less the dividend or drawings you gave" : " (no dividend or drawings)") + "; other assets and liabilities stay as at " + fyL(base.fy) + "; cash and bank is the balancing figure.");
  if (gapSaid.length) said.push("Cash shortfall shown as bank borrowing (short-term), repaid first from later surplus cash: " + gapSaid.join("; ") + (extra > 0 ? "; " + cr(extra) + " still borrowed at the end of " + fyL(fys[fys.length - 1]) : "") + ". Its interest is not in the interest above.");
  return { lines: out, said, diffs };
}

// ---------------------------------------------------------------- the revenue by business vertical
// each vertical's share in each year: as given, else in a straight line between the years given (flat before the first and
// after the last); an amount given is its share of that year's revenue; shares that do not add to 100% are scaled to it
export function verticalShares(plan: Plan, fys: number[], revOf: (fy: number) => number): { name: string, share: number[] }[] & { notes?: string[] } {
  const out = plan.verticals.map((v) => {
    const pts = new Map<number, number>();
    for (const [fy, s] of Object.entries(v.share)) pts.set(Number(fy), s);
    for (const [fy, a] of Object.entries(v.amount)) if (!pts.has(Number(fy)) && revOf(Number(fy)) > 0) pts.set(Number(fy), a / revOf(Number(fy)) * 100);
    const ks = [...pts.keys()].sort((a, b) => a - b);
    const share = fys.map((fy) => {
      if (!ks.length) return 0;
      if (fy <= ks[0]) return pts.get(ks[0])!;
      if (fy >= ks[ks.length - 1]) return pts.get(ks[ks.length - 1])!;
      const hi = ks.find((k) => k >= fy)!, lo = [...ks].reverse().find((k) => k <= fy)!;
      return hi === lo ? pts.get(lo)! : pts.get(lo)! + (pts.get(hi)! - pts.get(lo)!) * (fy - lo) / (hi - lo);
    });
    return { name: v.name, share };
  }) as { name: string, share: number[] }[] & { notes?: string[] };
  out.notes = [];
  fys.forEach((fy, k) => {
    const t = out.reduce((s, v) => s + v.share[k], 0);
    if (t > 0 && Math.abs(t - 100) > 0.05) { out.notes!.push(fyL(fy) + ": the verticals' shares add to " + pc(t) + "; scaled to 100%."); for (const v of out) v.share[k] = v.share[k] * 100 / t; }
  });
  return out;
}
