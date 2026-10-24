/* @react-lazy: begin 94-tds-remarks.js (the React app loads this file with its TDS screens: app/src/lib/tdsGlobals.js; build.py react_parts) */
/* ================================================================== */
/* Remarks B, T and Y on a deduction with no tax (next-tds-autoplace, */
/* the owner's approval of 23-Oct-2026; TDS check B "Remarks")       */
/* ================================================================== */
// A payment with no tax deducted is reported with its reason (the "remark", DD field 32 of Form 140; DD field 30 of 26Q up
// to FY 2025-26):
//   T  a transporter (194C; 393(4) Sl. 8 of the Act of 2025) who gave his PAN and declares he owns ten goods carriages or
//      fewer: the deductee's "Transporter declaration received" for the year, ticked on the Deductees step's editor
//   B  a declaration that the income is not taxable (Form 15G / 15H; from tax year 2026-27 Form 121, section 393(6)): its
//      form, the date it was received and, for Form 140, its Unique Identification Number (DD field 31, 26 characters)
//   Y  below the threshold: by itself, from the limits FinCom already works out for every party (TDSWatch, src/js/66);
//      a deduction typed with "Y" is checked against them
// The letters are the same in Protean's old 26Q format (FVU 8.x) and in Form 140's Annexure 6 (docs/tds-forms-2025/140.md,
// rows 446-560: B with codes 1004 … 1030, T with 1023 and 1024, Y with most codes); Form 144 (27Q) takes Y only, with the
// codes listed there; FinCom writes B, T and Y on 26Q / Form 140 only. TDS_REMARK names them in one place.
// Kept with the books, per deductee per year, in S.books.nrInfo[party].decl[fy] = {t: {at, by}, b: {form, date, uin, at, by}}
// (nrInfo: a deductee's details a return asks for, one of BOOKS_KEYS, so it is synced with the books; no new item, no table).
const TDS_REMARK = {B: "B", T: "T", Y: "Y"};
const TDSDecl = {
  // the deductee's record in nrInfo: its own name, else one whose name is the same written another way
  keyOf(party){
    const n = (S.books || {}).nrInfo || {};
    if (n[party]) return party;
    const k = normName(party || "");
    return Object.keys(n).find(x => n[x] && n[x].decl && normName(x) === k) || party;
  },
  of(party, fy){ const n = ((S.books || {}).nrInfo || {})[this.keyOf(party)] || {}; return ((n.decl || {})[fy]) || {}; },
  // set a deductee's declarations for a year: {transporter: true | false, form: "15G" | "15H" | "" (none), date, uin}; a
  // key not given is left as it is. {ok, why}
  set(party, fy, x){
    const b = S.books;
    if (!b || !String(party || "").trim() || !/^\d{4}-\d{2}$/.test(fy || "")) return {ok: false, why: "Choose the deductee and the year."};
    x = x || {};
    const key = this.keyOf(party), who = typeof TDSReg === "object" ? TDSReg.who() : "", at = new Date().toISOString();
    const n = Object.assign({}, b.nrInfo || {}), rec = Object.assign({}, n[key] || {}), decl = Object.assign({}, rec.decl || {}), d = Object.assign({}, decl[fy] || {});
    if (x.transporter === true) d.t = {at, by: who}; else if (x.transporter === false) delete d.t;
    if (x.form !== undefined){
      if (!x.form) delete d.b;
      else {
        // next-tds-excel (the owner, 24-Oct-2026): from tax year 2026-27 Form 121 is its own choice; 15G / 15H for earlier years
        // (15G / 15H kept before on a 2026-27 declaration still read)
        if (x.form === "121" ? !TDS.isNew(fy) : !/^15[GH]$/.test(x.form)) return {ok: false, why: TDS.isNew(fy) ? "The declaration is Form 121 (from tax year 2026-27)." : "The declaration is Form 15G or Form 15H."};
        const uin = String(x.uin == null ? (d.b || {}).uin || "" : x.uin).toUpperCase().replace(/\s/g, "");
        if (uin && !/^[A-Z0-9]{1,26}$/.test(uin)) return {ok: false, why: "The UIN is letters and digits, 26 at most."};
        d.b = {form: x.form, date: x.date == null ? (d.b || {}).date || "" : TDS.ymd(x.date), uin, at, by: who};
      }
    }
    if (Object.keys(d).length) decl[fy] = d; else delete decl[fy];
    if (Object.keys(decl).length) rec.decl = decl; else delete rec.decl;
    n[key] = rec; b.nrInfo = n;
    if (typeof TDSReg === "object" && TDSReg.forget) TDSReg.forget();
    saveBooks();
    return {ok: true};
  },
  // below the year's limit for its section (TDSWatch): true / false; null when FinCom has no bills of it to tell
  below(r){
    const fy = r.fy || TDS.fyOf(r.date), sec = TDS.sec(r.section);
    if (!fy || !sec || typeof TDSWatch !== "object") return null;
    let list = [];
    try { list = TDSWatch.year(fy); } catch (e){ return null; }
    const k = normName(r.party || ""), w = list.find(z => TDS.sec(z.section) === sec && normName(z.party) === k);
    return w ? !w.over : null;
  },
  limitOf(r){ try { const k = normName(r.party || ""); return TDSWatch.year(r.fy).find(z => TDS.sec(z.section) === TDS.sec(r.section) && normName(z.party) === k) || null; } catch (e){ return null; } },
  // a deduction's remark when no tax was deducted (26Q / Form 140): {remark, certNo, uin} or null (the usual A / C then)
  remark(r, form){
    if (!r || form !== "26Q" || num(r.tds) > 0.005) return null;
    const fy = r.fy || TDS.fyOf(r.date), d = this.of(r.party, fy), sec = TDS.sec(r.section);
    if (d.b) return {remark: TDS_REMARK.B, certNo: "", uin: d.b.uin || ""};
    if (d.t && /^194C/.test(sec)) return {remark: TDS_REMARK.T, certNo: ""};
    if (/^[BTY]$/.test(r.basis || "")) return {remark: TDS_REMARK[r.basis], certNo: "", uin: ""};
    if (this.below(r) === true) return {remark: TDS_REMARK.Y, certNo: ""};
    return null;
  },
  // Validate & file: the remarks' checks: [{k, level (error: stops the file; warn), n, ids, words}] (one line per kind, the deductees named)
  checks(fy, q, form){
    if (form !== "26Q" || typeof TDS_FORMS !== "object") return [];
    const rows = TDS_FORMS[form].rows().filter(r => r.fy === fy && r.q === q && !(num(r.tds) > 0.005)), isNew = TDS.isNew(fy);
    const bad = {"b-decl": [], "b-uin": [], "t-pan": [], "t-sec": [], "y-over": []};
    rows.forEach(r => {
      const m = TDS26Q.remark(r, form) || {};
      if (m.remark === "B"){
        const d = this.of(r.party, fy).b || {}, miss = [];
        if (!d.form) miss.push(isNew ? "the form (Form 121)" : "the form (15G or 15H)");
        if (!d.date) miss.push("the date it was received");
        if (miss.length) bad["b-decl"].push({r, w: r.party + ": " + miss.join(", ")});
        // (the owner, 23-Oct-2026: the UIN is optional, as the format has DD field 31: a warning, the file is still made)
        if (isNew && !/^[A-Z0-9]{26}$/.test(d.uin || "")) bad["b-uin"].push({r, w: r.party});
      }
      if (m.remark === "T" && !(Certs.validPan(r.pan) && !Certs.inoperative(r.pan))) bad["t-pan"].push({r, w: r.party});
      if (m.remark === "T" && !/^194C/.test(TDS.sec(r.section))) bad["t-sec"].push({r, w: r.party + " (" + TDS.sec(r.section) + ")"});
      if (m.remark === "Y" && this.below(r) === false){ const w = this.limitOf(r) || {}; bad["y-over"].push({r, w: r.party + " (" + TDS.sec(r.section) + " ₹" + INR.format(r2(num(w.credited))) + " in " + fy + ", limit " + (w.limitWords || "") + ")"}); }
    });
    const uniq = (l) => Array.from(new Set(l.map(x => x.w)));
    const W = {"b-decl": "Remark B (" + (isNew ? "Form 121" : "Form 15G/15H") + ") needs the declaration: ", "b-uin": "Remark B: the Form 121 UIN (26 characters, DD field 31) is not given (optional; give it if the deductee has it): ", "t-pan": "Remark T (transporter) needs the deductee's PAN: ",
      "t-sec": "Remark T is only for 194C (a transporter's contract): ", "y-over": "Remark Y (below the threshold), but the payments are above it: "};
    return Object.keys(bad).filter(k => bad[k].length).map(k => ({k, level: k === "b-uin" ? "warn" : "error", n: bad[k].length, ids: bad[k].map(x => x.r.id), words: W[k] + uniq(bad[k]).join("; ")}));
  }
};
// TDS26Q.remark (src/js/16) with these first: the file builders, the Excel working and the screens read the one function
if (typeof TDS26Q === "object" && TDS26Q.remark && !TDS26Q.remark.withDecl){
  const tdsRemark0 = TDS26Q.remark;
  TDS26Q.remark = function(r, form){ return TDSDecl.remark(r, form) || tdsRemark0.call(this, r, form); };
  TDS26Q.remark.withDecl = true;
}
// the Deductees step's editor: a deductee's declarations for the return's year
function tdsDeclSet(party, fy, x){ const r = TDSDecl.set(party, fy, x); if (!r.ok) toast(r.why); render(); return r; }
if (typeof globalThis === "object") Object.assign(globalThis, {TDSDecl, TDS_REMARK, tdsDeclSet});
/* @react-lazy: end */
