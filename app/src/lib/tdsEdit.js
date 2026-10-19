// TDS deductions corrected in FinCom (t70, 16-Oct-2026). Kept in the React bundle (legacy.js is at its size budget) and
// put on window, so the business logic (TDS.allRowsNow, src/js/09) lays the corrections over the books: loaded from main.jsx.
// The owner: "section name is not there.. I need to filter what needs fixing.. export to Excel, correct it there and
// bring it back". A return's deductions go out to Excel (one row a deduction, with its FinCom id; TDS a live formula,
// Paid × Rate; the books' TDS beside it and the difference; totals and a Summary by section, all formulas), the
// corrected file comes back as a preview of each change (old → new), and nothing is applied until "Apply N changes".
// What is applied is kept with the books as FinCom's corrections of the return (S.books.tdsEdits, one of BOOKS_KEYS):
// {rowId: {f: {pan, section, rate, paid, tds, dcode, cert, remarks}, log: [{field, from, to, by, at}]}}. The books read
// from Tally are not changed; TDS.allRowsNow lays the corrections over each deduction (TDSEdit.apply), so the return, its
// file and every figure read the corrected deduction, and r.books keeps what the books say. The challan of a deduction
// is changed as on the page (TDSCH.tag / untag, S.books.alloc).
// "Needs fixing" (the deductions' filter) uses the problems the return already finds: no valid PAN, a PAN inoperative,
// the rate question (Certs.issues), not against a challan, the payment code to confirm (TDS26Q.payCodeRows), and a
// section FinCom does not know. No new tax rule here.
const TDSEdit = {
  FIELDS: ["pan", "section", "rate", "paid", "tds", "dcode", "cert", "remarks", "date", "credit"],
  WORDS: {party: "Deductee name", pan: "PAN", section: "Section", rate: "Rate", paid: "Amount paid", tds: "TDS", dcode: "Deductee code", cert: "Lower-deduction certificate", remarks: "Remarks", challan: "Challan", date: "Date of deduction", credit: "Date paid or credited"},
  all(){ return (S.books && S.books.tdsEdits) || {}; },
  // the deductee code as the return file has carried it: 01 a company (the PAN's fourth letter C), else 02
  codeOf(pan){ return Certs.validPan(pan) && /^[A-Z]{3}C/.test(String(pan).toUpperCase()) ? "01" : "02"; },
  // a deduction as the books give it, with FinCom's corrections over it (TDS.allRowsNow)
  apply(r){
    const e = this.all()[r.id], f = e && e.f;
    if (!f || !Object.keys(f).length) return r;
    r.books = {party: r.party, pan: r.pan, section: r.section, rate: r.rate, paid: r.paid, tds: r.tds, dcode: this.codeOf(r.pan), cert: "", remarks: "", date: r.date, credit: r.credit || r.date};
    // next-tds-addlist: the deductee's name given in FinCom where Tally has none (its PAN from the PAN book, unless given)
    if (f.party != null && String(f.party).trim()){ r.party = String(f.party).trim(); if (f.pan == null) r.pan = TDS.panOf(r.party); r.partyFrom = "fincom"; }
    if (f.pan != null) r.pan = f.pan;
    if (f.section != null) r.section = f.section;
    if (f.paid != null) r.paid = r2(f.paid);
    if (f.tds != null) r.tds = r2(f.tds);
    if (f.rate != null) r.rate = f.rate; else if ((f.paid != null || f.tds != null) && r.paid) r.rate = r2(r.tds / r.paid * 100);
    if (f.dcode != null) r.dcode = f.dcode;
    if (f.cert != null) r.cert = f.cert;
    if (f.remarks != null) r.remarks = f.remarks;
    // next-tds-clear: the dates corrected on the Deductions step (the date of deduction decides the quarter)
    if (f.date != null && TDS.ymd(f.date).length === 8){ r.date = TDS.ymd(f.date); r.q = TDS.qOf(r.date); r.fy = TDS.fyOf(r.date); }
    if (f.credit != null && TDS.ymd(f.credit).length === 8) r.credit = TDS.ymd(f.credit) === r.date ? undefined : TDS.ymd(f.credit);
    r.edited = Object.keys(f);
    return r;
  },
  // what the books say for a field of a deduction (to put back, an edit equal to it is dropped)
  booksOf(r, k){ const b = r.books || {party: r.party, pan: r.pan, section: r.section, rate: r.rate, paid: r.paid, tds: r.tds, dcode: this.codeOf(r.pan), cert: "", remarks: "", date: r.date, credit: r.credit || r.date}; return b[k]; },
  same(k, a, b){ return ["rate", "paid", "tds"].includes(k) ? Math.abs(num(a) - num(b)) < 0.005 : String(a == null ? "" : a) === String(b == null ? "" : b); },
  set(r, k, v){
    const b = S.books; b.tdsEdits = b.tdsEdits || {};
    const e = b.tdsEdits[r.id] = b.tdsEdits[r.id] || {f: {}, log: []};
    const from = r[k] == null ? (k === "dcode" ? this.codeOf(r.pan) : "") : r[k];
    if (this.same(k, v, this.booksOf(r, k))) delete e.f[k]; else e.f[k] = v;
    e.log.push({field: k, from, to: v, by: typeof whoAmI === "function" ? whoAmI() : "", at: new Date().toISOString()});
  },
  edited(rows){ return rows.filter(r => r.edited && r.edited.length); },
  // a section FinCom knows (its usual rates, or the Act of 2025's table)
  knownSec(s){
    const k = TDS.sec(s);
    if (!k) return false;
    if (TDS.STD[k]) return true;
    return typeof RULE_DEFAULTS === "object" && RULE_DEFAULTS.some(x => x.old && TDS.sec(x.old) === k);
  },
  // next-tds-addlist (the owner, 19-Oct-2026): a deduction on a challan that cannot pay it: the challan deposited before
  // the deduction (k "early": TDS cannot be paid before it is deducted), or naming another section (k "sec"). [{k, words}]
  P_NAME: "deductee name missing",
  P_EARLY: "challan dated before the deduction",
  early(r, c){ return !!c && TDS.ymd(c.date).length === 8 && TDS.ymd(c.date) < TDS.ymd(r.date); },
  placeIssues(r, c){
    const out = [];
    if (!c) return out;
    if (this.early(r, c)) out.push({k: "early", words: "Challan dated before the deduction"});
    const cs = TDSCH.secNorm(c.section);
    if (cs && r.section && !TDSCH.secOk(cs, r.section)) out.push({k: "sec", words: "Challan is for " + cs + "; this is " + (TDS.sec(r.section) || r.section)});
    return out;
  },
  // the problems the return already finds, by deduction: {rowId: ["no valid PAN", …]}
  problems(rows, fy, q, form){
    const out = {}, add = (id, w) => { (out[id] = out[id] || []).push(w); };
    const chById = {}; TDS.challans().forEach(c => { chById[c.id] = c; });
    const issues = form === "26Q" ? Certs.issues(fy, q) : [], pay = typeof TDS26Q === "object" && TDS26Q.payCodeRows ? TDS26Q.payCodeRows(fy, q, form) : [];
    rows.forEach(r => {
      if (!Certs.validPan(r.pan)) add(r.id, "no valid PAN");
      else if (Certs.inoperative(r.pan)) add(r.id, "PAN inoperative");
      if (form !== "27EQ" && !this.knownSec(r.section)) add(r.id, "section not known: " + (r.section || "none"));
      if (!r.challan) add(r.id, "not against a challan");
      if (!(r.party || r.employee)) add(r.id, this.P_NAME);
      this.placeIssues(r, r.challan && chById[r.challan]).forEach(x => add(r.id, x.k === "early" ? this.P_EARLY : x.words.toLowerCase()));
    });
    issues.forEach(x => add(x.row.id, "rate " + x.row.rate + "% should be " + x.expected + "%" + (x.why ? ": " + x.why : "")));
    pay.forEach(x => add(x.row.id, x.why));
    return out;
  },
  // the rate as the file carries it: the one that gives the TDS back from the amount paid (so the formula agrees)
  rateOut(r){ return r.paid ? r.tds / r.paid * 100 : num(r.rate); },
  chLabel(id){ const c = id && TDS.challans().find(x => x.id === id); return c ? TDSCH.label(c) : ""; },
  COLS: ["FinCom id (do not change)", "Date", "Voucher", "Deductee", "PAN", "Section", "Section name", "Rate %", "Amount paid", "TDS", "TDS in books", "Difference",
    "Challan", "Deductee code", "Lower-deduction certificate", "Remarks", "Needs fixing"],
  // the workbook: Deductions (the rows shown, with formulas) and Summary (by section, formulas on Deductions)
  book(rows, probs, fy){
    const X = XLSX, ws = {}, n = rows.length, last = n + 1, A = (c, r) => X.utils.encode_cell({c, r});
    const put = (c, r, cell) => { ws[A(c, r)] = cell; };
    const s = (v) => ({t: "s", v: String(v == null ? "" : v)}), m = (v, f) => (f ? {t: "n", v: r2(v), f, z: "#,##0.00"} : {t: "n", v: r2(num(v)), z: "#,##0.00"});
    this.COLS.forEach((h, c) => put(c, 0, s(h)));
    rows.forEach((r, i) => {
      const y = i + 1, R = y + 1, books = this.booksOf(r, "tds"), rate = this.rateOut(r), tds = num(r.paid) === 0 ? num(books) : r2(num(r.paid) * rate / 100);
      put(0, y, s(r.id)); put(1, y, s(r.date ? fmtDate(tallyDate(TDS.ymd(r.date))) : "")); put(2, y, s(r.voucher)); put(3, y, s(r.party)); put(4, y, s(r.pan || ""));
      put(5, y, s(r.section)); put(6, y, s(TDS.secName(r.section, fy)));
      put(7, y, {t: "n", v: rate, z: "0.00##"}); put(8, y, m(r.paid));
      put(9, y, m(tds, "IF(I" + R + "=0,K" + R + ",ROUND(I" + R + "*H" + R + "/100,2))")); put(10, y, m(books)); put(11, y, m(r2(tds - num(books)), "J" + R + "-K" + R));
      put(12, y, s(this.chLabel(r.challan))); put(13, y, s(r.dcode || this.codeOf(r.pan))); put(14, y, s(r.cert || ((Certs.forRow(r) || {}).certNo || "")));
      put(15, y, s(r.remarks || "")); put(16, y, s((probs[r.id] || []).join("; ")));
    });
    const T = n + 1, sum = (col, k) => m(rows.reduce((a, r) => a + k(r), 0), "SUM(" + col + "2:" + col + last + ")");
    put(3, T, s("Total"));
    put(8, T, sum("I", (r) => num(r.paid)));
    const tdsOf = (r) => (num(r.paid) === 0 ? num(this.booksOf(r, "tds")) : r2(num(r.paid) * this.rateOut(r) / 100));
    put(9, T, sum("J", tdsOf)); put(10, T, sum("K", (r) => num(this.booksOf(r, "tds")))); put(11, T, sum("L", (r) => tdsOf(r) - num(this.booksOf(r, "tds"))));
    ws["!ref"] = X.utils.encode_range({s: {c: 0, r: 0}, e: {c: this.COLS.length - 1, r: T}});
    ws["!cols"] = [20, 12, 12, 32, 12, 10, 30, 8, 15, 14, 14, 12, 26, 10, 18, 24, 40].map((w) => ({wch: w}));
    ws["!autofilter"] = {ref: "A1:" + A(this.COLS.length - 1, n)};
    // Summary: each section's deductions, amount paid and TDS, worked out on the Deductions sheet
    const secs = Array.from(new Set(rows.map(r => r.section))).sort(), sm = {}, rg = (c) => "Deductions!$" + c + "$2:$" + c + "$" + last;
    const sp = (c, r, cell) => { sm[A(c, r)] = cell; };
    ["Section", "Section name", "Deductions", "Amount paid", "TDS"].forEach((h, c) => sp(c, 0, s(h)));
    secs.forEach((x, i) => {
      const y = i + 1, R = y + 1, mine = rows.filter(r => r.section === x);
      sp(0, y, s(x)); sp(1, y, s(TDS.secName(x, fy))); sp(2, y, {t: "n", v: mine.length, f: "COUNTIF(" + rg("F") + ",A" + R + ")"});
      sp(3, y, m(mine.reduce((a, r) => a + num(r.paid), 0), "SUMIF(" + rg("F") + ",A" + R + "," + rg("I") + ")"));
      sp(4, y, m(mine.reduce((a, r) => a + tdsOf(r), 0), "SUMIF(" + rg("F") + ",A" + R + "," + rg("J") + ")"));
    });
    const ST = secs.length + 1;
    sp(0, ST, s("Total")); sp(2, ST, {t: "n", v: n, f: "SUM(C2:C" + ST + ")"});
    sp(3, ST, m(rows.reduce((a, r) => a + num(r.paid), 0), "SUM(D2:D" + ST + ")")); sp(4, ST, m(rows.reduce((a, r) => a + tdsOf(r), 0), "SUM(E2:E" + ST + ")"));
    sm["!ref"] = X.utils.encode_range({s: {c: 0, r: 0}, e: {c: 4, r: ST}});
    sm["!cols"] = [12, 34, 12, 16, 16].map((w) => ({wch: w}));
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Deductions");
    X.utils.book_append_sheet(wb, sm, "Summary");
    return wb;
  },
  // the header row kept in view (SheetJS's free edition does not write a frozen pane: it is set in the sheet's XML)
  freeze(bytes){
    try {
      const C = XLSX.CFB, z = C.read(new Uint8Array(bytes), {type: "array"});
      ["/xl/worksheets/sheet1.xml", "/xl/worksheets/sheet2.xml"].forEach((p) => {
        const e = C.find(z, p); if (!e) return;
        const xml = new TextDecoder().decode(new Uint8Array(e.content)).replace(/<sheetView ([^>]*?)\/>/, '<sheetView $1><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView>');
        e.content = new TextEncoder().encode(xml); e.size = e.content.length;
      });
      return C.write(z, {fileType: "zip", type: "array"});
    } catch (err){ return bytes; }
  },
  async toExcel(rows, probs, fy, name){
    await ensureXlsx();
    const out = this.freeze(XLSX.write(this.book(rows, probs, fy), {bookType: "xlsx", type: "array"}));
    return saveFile(name.replace(/[^A-Za-z0-9]+/g, "-") + "-to-correct.xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  },
  // a corrected file read: each change (old → new), what is refused and why, the ids not found; nothing applied
  read(wb, rows){
    const ws = wb.Sheets.Deductions || wb.Sheets[wb.SheetNames.find(n => { const c = wb.Sheets[n].A1; return c && /^FinCom id/.test(String(c.v)); })];
    if (!ws) return {error: "This file has no Deductions sheet with a FinCom id column. Export the deductions from here, correct that file and bring it back."};
    const R = XLSX.utils.decode_range(ws["!ref"] || "A1"), head = {};
    for (let c = R.s.c; c <= R.e.c; c++){ const h = ws[XLSX.utils.encode_cell({c, r: 0})]; if (h) head[String(h.v).trim()] = c; }
    const col = (name) => head[this.COLS.find(x => x.startsWith(name))];
    const byId = {}; rows.forEach(r => { byId[r.id] = r; });
    const chs = TDS.challans(), out = {changes: [], refused: [], unmatched: [], notes: [], rows: 0};
    const cell = (y, name) => { const c = col(name); return c == null ? undefined : ws[XLSX.utils.encode_cell({c, r: y})]; };
    const val = (y, name) => { const c = cell(y, name); return c ? (c.v == null ? "" : c.v) : undefined; };
    const numOf = (v) => (typeof v === "number" ? v : String(v).trim() === "" ? NaN : Number(String(v).replace(/[₹,\s]/g, "")));
    for (let y = 1; y <= R.e.r; y++){
      const id = String(val(y, "FinCom id") || "").trim();
      if (!id) continue;                                  // the totals row, a blank line
      const r = byId[id];
      if (!r){ out.unmatched.push({line: y + 1, id}); continue; }
      out.rows++;
      const who = r.party + " (" + (r.voucher || fmtDate(tallyDate(TDS.ymd(r.date)))) + ")";
      const ch = (field, from, to) => out.changes.push({id, line: y + 1, who, field, from, to});
      const no = (field, value, why) => out.refused.push({id, line: y + 1, who, field, value: String(value), why});
      // PAN
      let pan = val(y, "PAN");
      if (pan !== undefined){ pan = String(pan).trim().toUpperCase(); if (pan === "PANNOTAVBL") pan = "";
        if (pan !== String(r.pan || "").toUpperCase()){ if (pan && !Certs.validPan(pan)) no("pan", pan, "not a PAN: five letters, four digits, a letter"); else ch("pan", r.pan || "", pan); } }
      // section
      let sec = val(y, "Section");
      if (sec !== undefined){ sec = String(sec).trim().toUpperCase().replace(/\s+/g, "");
        if (sec !== String(r.section || "").toUpperCase().replace(/\s+/g, "")){ if (!this.knownSec(sec)) no("section", sec, "a section FinCom does not know"); else ch("section", r.section, sec); } }
      // amounts: the rate and amount paid as typed; the TDS as the file worked it out (its formula's saved value), or
      // Paid × Rate where the file kept no value
      const rate0 = this.rateOut(r);
      let rate = val(y, "Rate"), paid = val(y, "Amount paid"), rateN = rate0, paidN = num(r.paid);
      if (rate !== undefined){ const x = numOf(rate); if (isNaN(x) || x < 0 || x > 100) no("rate", rate, "a rate is a number from 0 to 100"); else { rateN = x; if (Math.abs(x - rate0) > 1e-6) ch("rate", r2(rate0), r2(x)); } }
      if (paid !== undefined){ const x = numOf(paid); if (isNaN(x) || x < 0) no("paid", paid, "an amount cannot be negative or blank"); else { paidN = x; if (Math.abs(x - num(r.paid)) >= 0.005) ch("paid", num(r.paid), r2(x)); } }
      const tc = cell(y, "TDS");
      if (tc){
        let x = tc.v;
        if ((x === undefined || x === "") && tc.f){ x = paidN === 0 ? num(this.booksOf(r, "tds")) : r2(paidN * rateN / 100); out.notes.push(who + ": TDS worked out as Amount paid × Rate (the file kept no value for its formula)"); }
        x = numOf(x);
        if (isNaN(x) || x < 0) no("tds", tc.v, "an amount cannot be negative or blank");
        else if (Math.abs(x - num(r.tds)) >= 0.005) ch("tds", num(r.tds), r2(x));
      }
      // challan
      let cl = val(y, "Challan");
      if (cl !== undefined){ cl = String(cl).trim(); const now = this.chLabel(r.challan);
        if (cl !== now){ const c = cl ? chs.find(x => TDSCH.label(x) === cl) : null; if (cl && !c) no("challan", cl, "no such challan here (BSR/date/serial as exported)"); else ch("challan", now, cl); } }
      let dc = val(y, "Deductee code");
      if (dc !== undefined){ dc = String(dc).trim().padStart(2, "0"); const now = r.dcode || this.codeOf(r.pan);
        if (dc !== now){ if (!/^0[12]$/.test(dc)) no("dcode", dc, "01 (a company) or 02 (anyone else)"); else ch("dcode", now, dc); } }
      ["cert", "remarks"].forEach((k) => { const v = val(y, k === "cert" ? "Lower-deduction" : "Remarks"); if (v === undefined) return;
        const now = k === "cert" ? (r.cert != null ? r.cert : ((Certs.forRow(r) || {}).certNo || "")) : (r.remarks || "");
        if (String(v).trim() !== String(now)) ch(k, now, String(v).trim()); });
    }
    return out;
  },
  // the preview applied: challans as on the page; the rest as FinCom's corrections. Returns {ok, n, why}
  applyAll(prev, rows){
    const byId = {}; rows.forEach(r => { byId[r.id] = r; });
    let n = 0; const why = [];
    prev.changes.forEach((c) => {
      const r = byId[c.id]; if (!r) return;
      if (c.field === "challan"){
        const chId = c.to ? (TDS.challans().find(x => TDSCH.label(x) === c.to) || {}).id : "";
        const res = chId ? TDSCH.tag([r.id], chId) : TDSCH.untag([r.id]);
        if (res && res.ok === false){ why.push(c.who + ": " + res.why); return; }
      } else this.set(r, c.field, c.field === "pan" || c.field === "section" || c.field === "dcode" || c.field === "cert" || c.field === "remarks" ? c.to : num(c.to));
      n++;
    });
    return {ok: !why.length, n, why};
  }
};

window.TDSEdit = TDSEdit;
export default TDSEdit;
