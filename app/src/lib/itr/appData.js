// What the checks need from the rest of FinCom, read on the page (the legacy globals): GST worked out from the books
// (GSTR, src/js/12 and server/_shared/gst3b.js), the TDS returns (TDS, src/js/09), PF in the books, the 3CD draft
// (Audit.form3cd), and the statements' own profit before tax (FinSt). Each part answers {ok: false, text} when its
// source is not there, never a figure made up.
const N = (v) => +v || 0;
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };
const G = () => (typeof window === "object" ? window : globalThis);
const MONTHS = (fy) => { const out = []; for (let i = 0; i < 12; i++) { const m = ((3 + i) % 12) + 1, y = m >= 4 ? +fy : +fy + 1; out.push(String(y) + String(m).padStart(2, "0")); } return out; };

export function gstData(fy, books) {
  const g = G(), GSTR = g.GSTR;
  if (!GSTR || typeof GSTR.outward !== "function") return { ok: false, text: "FinCom's GST working is not loaded." };
  try {
    let r1 = 0, months = 0;
    MONTHS(fy).forEach((ym) => { const rows = GSTR.outward(ym, ""); if (rows.length) months++; r1 += N(GSTR.sum(rows).taxable); });
    if (!months) return { ok: false, text: "No outward supplies in the books for FY 2025-26." };
    const reasons = [];
    if (books && books.ok) {
      const pl = books.sched.pl, bs = books.sched.bs;
      if (pl.otherOpRev.cy) reasons.push({ label: "Other operating revenue (not a supply in GSTR-1)", amt: pl.otherOpRev.cy });
      const adv = bs.advancesIn.cy - bs.advancesIn.py; if (R(adv)) reasons.push({ label: "Advances from customers, change in the year", amt: -adv });
    }
    return { ok: true, r1: R(r1), r3b: null, months, reasons };
  } catch (e) { return { ok: false, text: "GST could not be worked out: " + ((e && e.message) || e) }; }
}

export function tdsData(fy) {
  const g = G(), TDS = g.TDS, b = g.S && g.S.books;
  if (!TDS || typeof TDS.allRows !== "function" || !b) return { ok: false, text: "FinCom's TDS is not loaded." };
  try {
    const from = fy + "0401", to = (+fy + 1) + "0331";
    const rows = TDS.allRows().filter((r) => r.date >= from && r.date <= to);
    if (!rows.length) return { ok: false, text: "No TDS deductions in the books for FY 2025-26." };
    const deducted = rows.reduce((s, r) => s + N(r.tds), 0), deposited = rows.filter((r) => r.challan).reduce((s, r) => s + N(r.tds), 0);
    const payL = new Set(Object.entries(b.map || {}).filter(([, m]) => m && m.kind === "tds_payable").map(([l]) => l));
    let payable = 0;
    (b.vouchers || []).forEach((v) => { if (v.cancel || v.date < from || v.date > to) return; (v.ent || []).forEach((e) => { if (payL.has(e.l) && e.a > 0 && !/payment|contra/i.test(v.type || "")) payable += e.a; }); });
    return { ok: true, deducted: R(deducted), deposited: R(deposited), payable: R(payable), unpaid: rows.filter((r) => !r.challan).map((r) => ({ party: r.party, section: r.section, tds: r.tds })) };
  } catch (e) { return { ok: false, text: "TDS could not be read: " + ((e && e.message) || e) }; }
}

export function pfBooks(books) { return books && books.ok ? books.sched.pl.pf.cy : null; }

export function form3cdTie(books, comp) {
  if (!books || !books.ok) return null;
  const f = (books.findings || []), line = (k) => ((comp.lines || []).find((l) => l.key === k) || {}).amt || 0;
  const tds = f.filter((x) => x.check === "tdsMissed").reduce((s, x) => s + N(x.base) * 0.3, 0), cash = f.filter((x) => x.id === "cash40A3").reduce((s, x) => s + N(x.amount), 0);
  return [{ clause: "21(b)", amt: R(tds), itr: line("add:40aia"), itrSrc: "BP: 40(a)(ia)" }, { clause: "21(d)", amt: R(cash), itr: line("add:40a3"), itrSrc: "BP: 40A(3)" }];
}

// the client's entity and whether it is an LLP (Client setup), its PAN and name
export function clientOf() {
  const g = G(), co = (g.CO && g.CO()) || {};
  const ent = g.FS && g.FS.entityOf ? g.FS.entityOf(co).code : "";
  return { id: co.id, name: co.name || "", pan: String(co.pan || "").toUpperCase(), gstin: co.gstin || "", entity: ent, llp: /\bLLP\b/i.test(co.name || "") };
}
