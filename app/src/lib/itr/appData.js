// What the checks need from the rest of FinCom, read on the page (the legacy globals): GST worked out from the books
// (GSTR, src/js/12 and server/_shared/gst3b.js), the TDS returns (TDS, src/js/09), PF in the books, the 3CD draft
// (Audit.form3cd), and the statements' own profit before tax (FinSt). Each part answers {ok: false, text} when its
// source is not there, never a figure made up.
import { page } from "./page.js";
import { entityFrom } from "./pick.js";
const N = (v) => +v || 0;
const R = (v) => { const x = N(v), r = Math.round(Math.abs(x) + 1e-9) * Math.sign(x); return r === 0 ? 0 : r; };
const G = page;
const MONTHS = (fy) => { const out = []; for (let i = 0; i < 12; i++) { const m = ((3 + i) % 12) + 1, y = m >= 4 ? +fy : +fy + 1; out.push(String(y) + String(m).padStart(2, "0")); } return out; };

// GST as FILED (never the books' own working, which the books would trivially agree with): GSTR-1 from the filed
// copies FinCom keeps (b.filed: the portal's, or a download marked filed: GSTAmend.filed), GSTR-3B from b.filed3b (the
// portal's 3B). Each in the GSTN's own JSON layout.
const n = (v) => +v || 0;
export function r1Taxable(j) {
  if (!j) return 0;
  let t = 0;
  (j.b2b || []).forEach((p) => (p.inv || []).forEach((i) => (i.itms || []).forEach((x) => { t += n((x.itm_det || x).txval); })));
  (j.b2cl || []).forEach((p) => (p.inv || []).forEach((i) => (i.itms || []).forEach((x) => { t += n((x.itm_det || x).txval); })));
  (j.b2cs || []).forEach((x) => { t += n(x.txval); });
  (j.exp || []).forEach((p) => (p.inv || []).forEach((i) => (i.itms || []).forEach((x) => { t += n(x.txval); })));
  ((j.nil && j.nil.inv) || []).forEach((x) => { t += n(x.nil_amt) + n(x.expt_amt) + n(x.ngsup_amt); });
  const notes = (arr, key) => (arr || []).forEach((p) => (p[key] || []).forEach((nt) => { const sg = String(nt.ntty || "C").toUpperCase() === "D" ? 1 : -1; (nt.itms || []).forEach((x) => { t += sg * n((x.itm_det || x).txval); }); }));
  notes(j.cdnr, "nt"); notes([{ nt: j.cdnur || [] }], "nt");
  return R(t);
}
export function r3bTaxable(j) {
  const d = (j && (j.sup_details || (j.data && j.data.sup_details) || (j.r3b && j.r3b.sup_details))) || null;
  if (!d) return null;
  return R(n(d.osup_det && d.osup_det.txval) + n(d.osup_zero && d.osup_zero.txval) + n(d.osup_nil_exmp && d.osup_nil_exmp.txval) + n(d.osup_nongst && d.osup_nongst.txval));
}
export function gstData(fy, books) {
  const g = G(), b = g.S && g.S.books;
  if (!b) return { ok: false, text: "The books are not open." };
  const months = new Set(MONTHS(fy));
  const r1s = (typeof g.GSTAmend === "object" && g.GSTAmend.filed ? g.GSTAmend.filed("") : Object.values(b.filed || {}).filter((f) => !f.notFiled)).filter((f) => months.has(f.ym));
  const r3s = Object.values(b.filed3b || {}).filter((f) => months.has(f.ym));
  if (!r1s.length && !r3s.length) return { ok: false, text: "No filed GSTR-1 or GSTR-3B for FY 2025-26 is in FinCom." };
  const per = {};
  r1s.forEach((f) => { const k = String(f.gstin).toUpperCase(); per[k] = (per[k] || 0) + r1Taxable(f.json); });
  const reasons = [];
  if (books && books.ok) {
    const pl = books.sched.pl, bs = books.sched.bs;
    if (pl.otherOpRev.cy) reasons.push({ label: "Other operating revenue (not a supply in GSTR-1)", amt: pl.otherOpRev.cy });
    const adv = bs.advancesIn.cy - bs.advancesIn.py; if (R(adv)) reasons.push({ label: "Advances from customers, change in the year", amt: -adv });
  }
  const r3 = r3s.map((f) => r3bTaxable(f.json)).filter((v) => v != null);
  return { ok: true, filedR1: r1s.length ? R(r1s.reduce((a, f) => a + r1Taxable(f.json), 0)) : null, monthsR1: new Set(r1s.map((f) => f.ym)).size,
    filedR3b: r3.length ? R(r3.reduce((a, v) => a + v, 0)) : null, monthsR3b: new Set(r3s.map((f) => f.ym)).size, reasons, perGstin: Object.keys(per).map((k) => ({ gstin: k, amt: R(per[k]) })) };
}

export function pfBooks(books) { return books && books.ok ? books.sched.pl.pf.cy : null; }

// the client's entity (Client setup / the PAN), its PAN, name and GSTIN; firm or LLP is asked in the return (never read from the name)
export function clientOf() {
  const g = G(), co = (g.CO && g.CO()) || {};
  // the PAN's fourth letter settles the kind (pick.js entityFrom); Client setup's choice (FS.entityOf) only without a
  // PAN. entitySet: what Client setup says, so the page can say when it differs from the PAN
  const fsCode = g.FS && g.FS.entityOf ? g.FS.entityOf(co).code : "", setCode = String(co.entity || "").toUpperCase();
  const ent = entityFrom(fsCode || setCode, co.pan, co.gstin).code || fsCode;
  return { id: co.id, name: co.name || "", pan: String(co.pan || "").toUpperCase(), gstin: co.gstin || "", entity: ent, entitySet: setCode };
}
