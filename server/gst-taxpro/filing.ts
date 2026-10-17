// Filing GSTR-1, IFF and GSTR-3B through the GST API: the parts that do no I/O (docs/gst-filing-api.md), used by index.ts
// and tested on their own (tests/gst_file_unit.ts). The owner's decisions of 17-Oct-2026: FinCom saves the return; a
// person compares the portal's summary with FinCom's and files with the signatory's EVC OTP; nothing here sends anything.
export const PROD_URL = "https://gstapi.charteredinfo.com";
export const SANDBOX_URL = "https://gstsandbox.charteredinfo.com";

export type Fig = { n: number; txval: number; iamt: number; camt: number; samt: number; csamt: number };
export type Figs = Record<string, Fig>;
const H = ["txval", "iamt", "camt", "samt", "csamt"] as const;
const num = (v: unknown) => { const x = Number(v); return isFinite(x) ? x : 0; };
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const z = (): Fig => ({ n: 0, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 });
function add(f: Fig, d: any, sg = 1) { for (const h of H) f[h] = r2(f[h] + sg * num(d?.[h])); }

// ---------- GSTR-1: FinCom's figures by table, from the JSON it saves ----------
// tables of parties with documents (inv or nt), lists of documents, and lists of rows
const PARTY = ["b2b", "b2ba", "b2cl", "b2cla", "exp", "expa", "cdnr", "cdnra"];
const DOCS = ["cdnur", "cdnura"];
const ROWS = ["b2cs", "b2csa", "at", "ata", "txpd", "txpda"];
const isNote = (k: string) => k.startsWith("cdn");
const noteSign = (d: any) => String(d?.ntty || "C").toUpperCase() === "D" ? 1 : -1;
// a document's figures: its items (itm_det or the item itself), or itself
function docInto(f: Fig, d: any, sg: number) {
  const it = Array.isArray(d?.itms) ? d.itms : null;
  if (it) it.forEach((x: any) => add(f, x?.itm_det || x, sg)); else add(f, d, sg);
}
export function r1Figures(j: any): Figs {
  const out: Figs = {};
  const t = (k: string) => (out[k.toUpperCase()] ||= z());
  for (const k of PARTY) for (const p of (Array.isArray(j?.[k]) ? j[k] : [])) {
    const docs = p?.inv || p?.nt || [];
    for (const d of docs) { const f = t(k); f.n++; docInto(f, d, isNote(k) ? noteSign(d) : 1); }
  }
  for (const k of DOCS) for (const d of (Array.isArray(j?.[k]) ? j[k] : [])) { const f = t(k); f.n++; docInto(f, d, noteSign(d)); }
  for (const k of ROWS) for (const r of (Array.isArray(j?.[k]) ? j[k] : [])) {
    const f = t(k); f.n++;
    // advances (11A, 11B): the advance is ad_amt, kept as the table's value
    const rows = Array.isArray(r?.itms) ? r.itms : [r];
    rows.forEach((x: any) => add(f, { ...x, txval: x.txval ?? x.ad_amt }, 1));
  }
  if (j?.nil) { const f = t("nil"); for (const x of (j.nil.inv || [])) { f.n++; f.txval = r2(f.txval + num(x.nil_amt) + num(x.expt_amt) + num(x.ngsup_amt)); } }
  if (j?.hsn) { const f = t("hsn"); for (const x of [].concat(j.hsn.data || [], j.hsn.hsn_b2b || [], j.hsn.hsn_b2c || [])) { f.n++; add(f, x, 1); } }
  if (j?.doc_issue) { const f = t("doc_issue"); for (const d of (j.doc_issue.doc_det || [])) for (const x of (d.docs || [])) f.n += num(x.net_issue ?? (num(x.totnum) - num(x.cancel))); }
  return out;
}
// the portal's GSTR-1 summary (RETSUM, sec_sum) as the same figures: ttl_tax is the taxable value
export function r1PortalFigures(sum: any): Figs {
  const out: Figs = {};
  for (const s of (sum?.sec_sum || [])) {
    const k = String(s?.sec_nm || "").toUpperCase(); if (!k) continue;
    const f = out[k] = z();
    if (k === "DOC_ISSUE") { f.n = num(s.net_doc_issued ?? (num(s.ttl_doc_issued) - num(s.ttl_doc_cancelled))); continue; }
    f.n = num(s.ttl_rec);
    f.txval = r2(num(s.ttl_tax ?? s.ttl_txval)); f.iamt = r2(num(s.ttl_igst)); f.camt = r2(num(s.ttl_cgst)); f.samt = r2(num(s.ttl_sgst)); f.csamt = r2(num(s.ttl_cess));
  }
  return out;
}

// ---------- GSTR-3B: the same rows from FinCom's JSON and from the portal's 3B ----------
export function r3bFigures(j: any): Figs {
  const s = j?.sup_details || {}, e = j?.itc_elg || {}, row = (d: any): Fig => { const f = z(); add(f, d || {}, 1); return f; };
  const ty = (l: any[], t: string) => row((l || []).find((x: any) => x?.ty === t));
  const five = z(); for (const x of (j?.inward_sup?.isup_details || [])) five.txval = r2(five.txval + num(x.inter) + num(x.intra));
  const unreg = z(); for (const x of (j?.inter_sup?.unreg_details || [])) { unreg.n++; add(unreg, x, 1); }
  return {
    "3.1(a)": row(s.osup_det), "3.1(b)": row(s.osup_zero), "3.1(c)": row(s.osup_nil_exmp), "3.1(d)": row(s.isup_rev), "3.1(e)": row(s.osup_nongst),
    "3.2 unregistered": unreg,
    "4(A)(1)": ty(e.itc_avl, "IMPG"), "4(A)(2)": ty(e.itc_avl, "IMPS"), "4(A)(3)": ty(e.itc_avl, "ISRC"), "4(A)(4)": ty(e.itc_avl, "ISD"), "4(A)(5)": ty(e.itc_avl, "OTH"),
    "4(B)(1)": ty(e.itc_rev, "RUL"), "4(B)(2)": ty(e.itc_rev, "OTH"), "4(C)": row(e.itc_net), "4(D)(1)": ty(e.itc_inelg, "RUL"), "4(D)(2)": ty(e.itc_inelg, "OTH"),
    "5": five,
  };
}

// ---------- the comparison a person confirms ----------
const LABEL: Record<string, string> = { B2B: "B2B invoices (4A)", B2BA: "B2B amended (9A)", B2CL: "B2C large (5)", B2CLA: "B2C large amended", B2CS: "B2C small (7)", B2CSA: "B2C small amended",
  CDNR: "Notes, registered (9B)", CDNRA: "Notes amended", CDNUR: "Notes, unregistered (9B)", CDNURA: "Notes unregistered amended", EXP: "Exports (6A)", EXPA: "Exports amended",
  AT: "Advances received (11A)", ATA: "Advances amended", TXPD: "Advances adjusted (11B)", TXPDA: "Adjusted amended", NIL: "Nil, exempt, non-GST (8)", HSN: "HSN summary (12)", DOC_ISSUE: "Documents issued (13)" };
// counts that are compared: documents (B2C small, HSN and the rest are rows the portal may group differently)
const COUNTED = new Set(["B2B", "B2BA", "B2CL", "B2CLA", "CDNR", "CDNRA", "CDNUR", "CDNURA", "EXP", "EXPA", "DOC_ISSUE"]);
export type Row = { key: string; label: string; fincom: Fig; portal: Fig; diff: Fig; differs: string[]; rounding: string[] };
// the owner's answer of 17-Oct-2026: a figure that differs by less than ₹1.00 is rounding (shown, needs no reason); ₹1.00 or
// more is a difference that must be corrected or accepted with a reason. A count of documents never rounds
export const ROUNDING = 1;
export function compare(fincom: Figs, portal: Figs, form: string) {
  const keys = Array.from(new Set(Object.keys(fincom).concat(Object.keys(portal))));
  const rows: Row[] = [], differs: string[] = [], rounding: string[] = [];
  for (const k of keys) {
    const a = fincom[k] || z(), b = portal[k] || z(), d = z(), dk: string[] = [], rk: string[] = [];
    if (form !== "3B" && COUNTED.has(k)) { d.n = a.n - b.n; if (d.n !== 0) dk.push(k + ".n"); }
    for (const h of H) {
      d[h] = r2(a[h] - b[h]);
      const x = Math.round(Math.abs(d[h]) * 100);          // in paise, so 0.99 and 1.00 are exact
      if (x >= ROUNDING * 100) dk.push(k + "." + h); else if (x >= 1) rk.push(k + "." + h);
    }
    const empty = !a.n && !b.n && H.every((h) => !a[h] && !b[h]);
    if (empty) continue;
    rows.push({ key: k, label: LABEL[k] || k, fincom: a, portal: b, diff: d, differs: dk, rounding: rk });
    differs.push(...dk); rounding.push(...rk);
  }
  return { rows, differs, rounding };
}
// the portal's summary the same as when the person confirmed it (figures, not the text: the portal adds checksums)
export function sameFigures(a: Figs, b: Figs) {
  const norm = (x: Figs) => JSON.stringify(Object.keys(x).sort().map((k) => [k, x[k].n, ...H.map((h) => r2(x[k][h]))]).filter((r) => r.slice(1).some((v) => v !== 0)));
  return norm(a || {}) === norm(b || {});
}

// ---------- 3B: the set-off (sections 49, 49A; rule 88A) from the portal's liability and the ledgers ----------
type Heads = { igst: number; cgst: number; sgst: number; cess: number };
const HD = ["igst", "cgst", "sgst", "cess"] as const;
const zh = (): Heads => ({ igst: 0, cgst: 0, sgst: 0, cess: 0 });
// liab: the 3B's tx_pmt lines ({liab_ldg_id, trans_typ, igst: {tx, intr, fee}, ...}); trans_typ 30002 = other than reverse
// charge (credit may pay it), 30003 = reverse charge (cash only). itc: the credit ledger by head. cash: the cash ledger
// by head ({tx, intr, fee} or a number)
export function setoff(liab: any[], itc: Partial<Heads>, cash: any) {
  const lines = (liab || []).map((l) => ({ id: l.liab_ldg_id, ty: Number(l.trans_typ), tx: { igst: num(l.igst?.tx), cgst: num(l.cgst?.tx), sgst: num(l.sgst?.tx), cess: num(l.cess?.tx) } as Heads,
    intr: { igst: num(l.igst?.intr), cgst: num(l.cgst?.intr), sgst: num(l.sgst?.intr), cess: num(l.cess?.intr) } as Heads, fee: { cgst: num(l.cgst?.fee), sgst: num(l.sgst?.fee) } }));
  const main = lines.find((l) => l.ty !== 30003);
  const cr: Heads = { igst: num(itc.igst), cgst: num(itc.cgst), sgst: num(itc.sgst), cess: num(itc.cess) };
  const due: Heads = main ? { ...main.tx } : zh();
  const use = { i_pdi: 0, i_pdc: 0, i_pds: 0, c_pdc: 0, c_pdi: 0, s_pds: 0, s_pdi: 0, cs_pdcs: 0 };
  const take = (have: number, need: number) => r2(Math.max(0, Math.min(have, need)));
  // IGST credit: IGST first; what is left goes to CGST and SGST (any order or proportion): first where their own credit
  // falls short, then whatever remains, so it is used up before CGST or SGST credit is (rule 88A)
  let x = take(cr.igst, due.igst); use.i_pdi = x; cr.igst = r2(cr.igst - x); due.igst = r2(due.igst - x);
  for (const [h, k] of [["cgst", "i_pdc"], ["sgst", "i_pds"]] as const) { x = take(cr.igst, due[h] - cr[h]); use[k] = r2(use[k] + x); cr.igst = r2(cr.igst - x); due[h] = r2(due[h] - x); }
  for (const [h, k] of [["cgst", "i_pdc"], ["sgst", "i_pds"]] as const) { x = take(cr.igst, due[h]); use[k] = r2(use[k] + x); cr.igst = r2(cr.igst - x); due[h] = r2(due[h] - x); }
  // CGST credit: CGST, then IGST; SGST credit: SGST, then IGST; never CGST against SGST
  x = take(cr.cgst, due.cgst); use.c_pdc = x; cr.cgst = r2(cr.cgst - x); due.cgst = r2(due.cgst - x);
  x = take(cr.sgst, due.sgst); use.s_pds = x; cr.sgst = r2(cr.sgst - x); due.sgst = r2(due.sgst - x);
  x = take(cr.cgst, due.igst); use.c_pdi = x; cr.cgst = r2(cr.cgst - x); due.igst = r2(due.igst - x);
  x = take(cr.sgst, due.igst); use.s_pdi = x; cr.sgst = r2(cr.sgst - x); due.igst = r2(due.igst - x);
  x = take(cr.cess, due.cess); use.cs_pdcs = x; cr.cess = r2(cr.cess - x); due.cess = r2(due.cess - x);
  // the rest in cash: tax, interest and late fee of every line (reverse charge wholly)
  const need = zh();
  const pdcash = lines.map((l) => {
    const t = l === main ? due : l.tx;
    HD.forEach((h) => { need[h] = r2(need[h] + t[h] + l.intr[h] + (h === "cgst" || h === "sgst" ? l.fee[h] : 0)); });
    return { liab_ldg_id: l.id, trans_typ: l.ty, ipd: r2(t.igst), cpd: r2(t.cgst), spd: r2(t.sgst), cspd: r2(t.cess),
      i_intrpd: r2(l.intr.igst), c_intrpd: r2(l.intr.cgst), s_intrpd: r2(l.intr.sgst), cs_intrpd: r2(l.intr.cess), c_lfeepd: r2(l.fee.cgst), s_lfeepd: r2(l.fee.sgst) };
  });
  const cashHave = (h: string) => { const c = cash?.[h]; return typeof c === "number" ? c : num(c?.tot ?? (num(c?.tx) + num(c?.intr) + num(c?.fee))) || num(cash?.[h + "_tot_bal"]); };
  const short: Partial<Heads> = {};
  HD.forEach((h) => { const s = r2(need[h] - cashHave(h)); if (s > 0) short[h] = s; });
  return { pditc: { liab_ldg_id: main ? main.id : null, trans_typ: main ? main.ty : 30002, ...use }, pdcash, cashNeeded: need, short, left: cr };
}
// the credit and cash ledgers from the ledger balance answer (field names to confirm with TaxPro: docs question 7)
export function ledgersOf(bal: any) {
  const d = bal?.data ?? bal ?? {}, i = d.itc_blnc || d.itc_bal || d.itcBal || {}, c = d.cash_bal || d.cashBal || {};
  return { itc: { igst: num(i.igst_bal ?? i.igst), cgst: num(i.cgst_bal ?? i.cgst), sgst: num(i.sgst_bal ?? i.sgst), cess: num(i.cess_bal ?? i.cess) }, cash: c };
}

// ---------- what may be sent ----------
// writes (save, proceed, offset, OTP, file) go to the sandbox or a stand-in; TaxPro's production host only when the
// function is told so (TAXPRO_FILE_LIVE=yes), after real returns have been tried on the sandbox
export function writeAllowed(base: string, live: string) {
  const b = String(base || "").replace(/\/+$/, "").toLowerCase();
  return b !== PROD_URL || live === "yes";
}
const R1_KEYS = ["gstin", "fp", "gt", "cur_gt", ...PARTY, ...DOCS, ...ROWS, "nil", "hsn", "doc_issue", "supeco", "ecom", "ecoma"];
export function cleanR1(j: any, gstin: string, period: string) {
  if (!j || typeof j !== "object") throw new Error("The return is needed.");
  if (String(j.gstin || "").toUpperCase() !== gstin) throw new Error("The return is for GSTIN " + j.gstin + ", not " + gstin + ".");
  if (String(j.fp || "") !== period) throw new Error("The return is for the period " + j.fp + ", not " + period + ".");
  const out: Record<string, unknown> = {};
  for (const k of R1_KEYS) if (j[k] !== undefined) out[k] = j[k];
  return out as any;
}
const R3B_KEYS = ["gstin", "ret_period", "sup_details", "inter_sup", "itc_elg", "inward_sup", "intr_ltfee", "eco_dtls"];
export function cleanR3b(j: any, gstin: string, period: string) {
  if (!j || typeof j !== "object") throw new Error("The return is needed.");
  if (String(j.gstin || "").toUpperCase() !== gstin) throw new Error("The return is for GSTIN " + j.gstin + ", not " + gstin + ".");
  if (String(j.ret_period || "") !== period) throw new Error("The return is for the period " + j.ret_period + ", not " + period + ".");
  const out: Record<string, unknown> = {};
  for (const k of R3B_KEYS) if (j[k] !== undefined) out[k] = j[k];
  return out as any;
}
// a text to keep or show: never the OTP (masked where it appears, and any PAN|OTP pair)
export function safeText(t: unknown, otp: string) {
  let s = String(t == null ? "" : t);
  if (otp) s = s.split(otp).join("*".repeat(otp.length));
  return s.replace(/([A-Z]{5}\d{4}[A-Z]?)\|\d{4,8}/g, "$1|******");
}
