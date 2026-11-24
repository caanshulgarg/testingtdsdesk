/* ================================================================== */
/* 24Q: salary, employee by employee                                  */
/* ================================================================== */
const TDS24Q = {
  // the salary sheet, in whatever column names the office uses
  cols: {
    name: ["employeename", "name", "nameofemployee", "employee"],
    pan: ["pan", "pannumber", "panno", "panofemployee", "employeepan"],
    code: ["employeecode", "empcode", "code", "employeeid"],
    month: ["month", "salarymonth", "period"],
    date: ["date", "paymentdate", "dateofpayment"],
    gross: ["grosssalary", "gross", "totalsalary", "salary", "grossearnings"],
    exempt: ["exemptallowances", "exempt", "hraexempt", "exemption", "allowancesexempt"],
    standard: ["standarddeduction", "standard"],
    profTax: ["professionaltax", "ptax", "pt"],
    chapter6: ["chaptervia", "deductionschaptervia", "deductions", "80c", "totaldeductions"],
    taxable: ["taxableincome", "taxable", "netincome", "totalincome"],
    tds: ["tdsdeducted", "tds", "taxdeducted", "incometax", "tdsamount"],
    surcharge: ["surcharge"], cess: ["cess", "healthandeducationcess", "educationcess"],
    regime: ["regime", "taxregime", "newregime"]
  },
  // a column: an exact name first, then a header holding the name, never a date of birth or joining nor the company
  // ("Company" holds "pan"): next-fix-audit-imports
  pick(head, names){
    const h = head.map(x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    for (const n of names){ const i = h.indexOf(n); if (i >= 0) return i; }
    for (const n of names){ const i = h.findIndex(x => x.includes(n) && !/birth|dob|join|company/.test(x)); if (i >= 0) return i; }
    return -1;
  },
  async fromFile(file){
    let grid, sheet = "", ai = null;
    if (/\.(xlsx|xls)$/i.test(file.name)){
      await ensureXlsx();
      const wb = xlsxBook(await file.arrayBuffer(), {cellDates: true});
      grid = xlsxRows(wb.Sheets[sheet = wb.SheetNames[0]]);
    } else {
      // (quoted cells, "Sharma, Ravi" and "1,00,000", kept whole: TDSCH.csv)
      const t = await file.text();
      grid = /\t/.test(t.split(/\r?\n/)[0]) ? t.split(/\r?\n/).filter(Boolean).map(l => l.split("\t")) : TDSCH.csv(t);
    }
    let hi = -1;
    for (let i = 0; i < Math.min(10, grid.length); i++){
      if (this.pick(grid[i], this.cols.name) >= 0 && this.pick(grid[i], this.cols.tds) >= 0){ hi = i; break; }
    }
    // no name and TDS column by name: FinCom's AI reads the columns, once for this client and layout (app/src/lib/aiColumns.js)
    if (hi < 0){ ai = await registersLoad().then(() => AiCols.salary(grid, sheet)).catch(() => null); if (ai) hi = ai.hi; }
    if (hi < 0) return {error: "That sheet needs at least an employee name column and a TDS column."};
    const head = grid[hi], idx = ai ? ai.idx : {}, body = grid.slice(hi + 1), H = head.map(x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    // (the AI's columns: the fields it did not name are found by their names, a column never used twice)
    Object.keys(this.cols).forEach(k => { if (ai && idx[k] >= 0) return; const j = this.pick(head, this.cols[k]); idx[k] = ai && Object.values(idx).includes(j) ? -1 : j; });
    // the PAN: the column whose values are PANs (most of them; PANNOTAVBL, PANAPPLIED, PANINVALID count, as 24Q writes
    // them); the named one kept unless another column passes (review of e7bf15906: it became -1, every PAN "")
    const pans = i => { const v = body.map(r => String(r[i] || "").trim()).filter(Boolean); return v.length && v.filter(x => /^([A-Z]{5}\d{4}[A-Z]|PAN(NOTAVBL|APPLIED|INVALID))$/i.test(x)).length * 2 >= v.length; };
    if (idx.pan < 0 || !pans(idx.pan)){ const j = head.findIndex((x, i) => pans(i)); if (j >= 0) idx.pan = j; }
    // a date only by its own name when there is a month column ("Date of Joining" is no payment date)
    if (idx.date >= 0 && (/birth|join|leav|dob|doj/.test(H[idx.date]) || (!ai && idx.month >= 0 && !this.cols.date.includes(H[idx.date])))) idx.date = -1;
    const get = (r, k) => idx[k] >= 0 ? r[idx[k]] : "";
    const rows = [];
    let undated = 0;
    body.forEach(r => {
      const name = String(get(r, "name") || "").trim();
      if (!name || /^(grand\s*|sub\s*|net\s*)?total\b/i.test(name) || /^(grand\s*|sub\s*)?total\b/i.test(String(r[0] || "").trim())) return;
      const tds = num(get(r, "tds"));
      const when = Market.date(get(r, "date")) || this.monthDate(get(r, "month"));
      if (!when) undated++;
      rows.push({name, pan: String(get(r, "pan") || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), code: String(get(r, "code") || "").trim(),
        date: when, gross: num(get(r, "gross")), exempt: num(get(r, "exempt")), standard: num(get(r, "standard")),
        profTax: num(get(r, "profTax")), chapter6: num(get(r, "chapter6")), taxable: num(get(r, "taxable")),
        tds, surcharge: num(get(r, "surcharge")), cess: num(get(r, "cess")),
        regime: /new/i.test(String(get(r, "regime") || "")) ? "N" : /old/i.test(String(get(r, "regime") || "")) ? "O" : ""});
    });
    return {rows: rows.filter(r => r.tds || r.gross), undated, cols: ai && ai.cols};
  },
  // a month as its last day: Apr-2026, April 26, 04/2026, 2026-04; a month with no year is no date ("")
  monthDate(v){
    if (v instanceof Date) return Market.date(v);
    const s = String(v || "").trim();
    if (!s) return "";
    let m = s.match(/([A-Za-z]{3,})[^0-9]*(\d{2,4})/), y, mo;
    if (m){ mo = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[1].slice(0, 3).toLowerCase()) + 1; y = m[2]; }
    else if ((m = s.match(/^(\d{1,2})[-\/.](\d{4})$/))){ mo = +m[1]; y = m[2]; }
    else if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})$/))){ mo = +m[2]; y = m[1]; }
    if (y){ y = y.length === 2 ? "20" + y : y; return mo >= 1 && mo <= 12 ? y + "-" + String(mo).padStart(2, "0") + "-" + new Date(num(y), mo, 0).getDate() : ""; }
    return Market.date(s);
  },
  rows(){ return ((S.books || {}).salary || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))); },
  // next-challan-match: the sheet's rows as deductions, matched to challans like any other (Form 138's rows for a year with
  // no Tally payroll). Each has a stable id, kept on the row: "sal:" and a hash of the employee, PAN, date and amounts, and
  // its place among rows that are the same in all of these (so the same sheet brought in again keeps its matching)
  dedRows(){
    const b = S.books || {}, list = b.salary || [];
    if (!list.length) return [];
    const seen = {}, alloc = b.alloc || {};
    const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); };
    const out = [];
    list.forEach(r => {
      const base = [normName(r.name), String(r.pan || "").toUpperCase(), TDS.ymd(r.date), r2(num(r.gross)), r2(num(r.tds))].join("|"), k = seen[base] = (seen[base] || 0) + 1;
      if (!r.id) r.id = "sal:" + hash(base) + "-" + k;
      const date = TDS.ymd(r.date);
      if (!date) return;
      out.push({id: r.id, date, q: TDS.qOf(date), fy: TDS.fyOf(date), party: r.name, employee: r.name, pan: TDS.panPick(r.name, r.pan), tallyPan: r.pan || "", section: "192", ledger: "", paid: r2(num(r.gross)), tds: r2(num(r.tds)),
        rate: num(r.gross) ? r2(num(r.tds) / num(r.gross) * 100) : null, voucher: "", src: "sheet", challan: alloc[r.id] || ""});
    });
    return (TDS.expandSplits(out)).sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },
  // Annexure I: employee-wise deductions for the quarter
  annexI(fy, q){
    const rows = this.rows().filter(r => r.date && TDS.fyOf(r.date) === fy && TDS.qOf(r.date) === q);
    const by = {};
    rows.forEach(r => {
      const k = (r.pan || r.name).toUpperCase();
      const e = by[k] = by[k] || {name: r.name, pan: r.pan, code: r.code, paid: 0, tds: 0, months: 0, rows: []};
      e.paid = r2(e.paid + r.gross); e.tds = r2(e.tds + r.tds); e.months++; e.rows.push(r);
    });
    return Object.values(by).sort((a, b) => a.name.localeCompare(b.name));
  },
  // Annexure II: the year's salary details, filed with the fourth quarter
  annexII(fy){
    const rows = this.rows().filter(r => r.date && TDS.fyOf(r.date) === fy);
    const by = {};
    rows.forEach(r => {
      const k = (r.pan || r.name).toUpperCase();
      const e = by[k] = by[k] || {name: r.name, pan: r.pan, code: r.code, gross: 0, exempt: 0, standard: 0, profTax: 0, chapter6: 0, taxable: 0, tds: 0, surcharge: 0, cess: 0, regime: ""};
      ["gross", "exempt", "standard", "profTax", "chapter6", "tds", "surcharge", "cess"].forEach(f => { e[f] = r2(e[f] + r[f]); });
      e.taxable = r2(e.taxable + (r.taxable || 0));
      if (r.regime) e.regime = r.regime;
    });
    return Object.values(by).map(e => {
      if (!e.taxable) e.taxable = r2(e.gross - e.exempt - e.standard - e.profTax - e.chapter6);
      return e;
    }).sort((a, b) => a.name.localeCompare(b.name));
  },
  checks(fy, q){
    const a = this.annexI(fy, q), out = [];
    const noPan = a.filter(e => !/^[A-Z]{5}\d{4}[A-Z]$/.test(e.pan));
    if (noPan.length) out.push({what: "Employees without a valid PAN", n: noPan.length, how: "Tax is 20% under section 206AA without one.", who: noPan.slice(0, 4).map(e => e.name)});
    const chs = TDS.challans().filter(c => TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q);
    const paid = chs.reduce((s, c) => s + num(c.tax), 0), ded = a.reduce((s, e) => s + e.tds, 0);
    if (Math.abs(paid - ded) > 1) out.push({what: "Salary TDS deducted and the challans do not agree", n: 1,
      how: "Deducted " + INR.format(ded) + ", challans " + INR.format(paid) + ". Some challans may belong to 26Q.", who: []});
    return out;
  },
  challanSheet(fy, q){
    const cx = TDSReg.ctx(), k = TDSReg.key("24Q", fy, q), rows = TDS.salaryRows().filter(r => r.fy === fy && r.q === q), chs = TDS.challans();
    const d = (s) => s ? fmtDate(tallyDate(TDS.ymd(s))) : "";
    const used = chs.filter(c => (cx.uses[c.id] || {})[k]);
    const head = [["Challans used by " + TDS.formName("24Q", fy) + " " + q + " " + fy], ["BSR code", "Challan serial", "Date of deposit", "Section", "Tax", "Interest", "Fee and others", "Tax used here", "Deductions here", "Interest allocated here", "Fee allocated here", "Tax left"]]
      .concat(used.map(c => { const u = cx.uses[c.id][k], p = TDSReg.portionFor(c, "24Q", fy, q, cx); return [c.bsr, c.serial, d(c.date), TDSCH.secNorm(c.section), num(c.tax), num(c.interest), TDSReg.feeOf(c), u.tax, u.n, p.interest, p.fee, TDSReg.balance(c, cx).tax]; }));
    const byId = {}; chs.forEach(c => { byId[c.id] = c; });
    return head.concat([[], ["Salary payments and their challans"], ["Employee", "PAN", "Date", "Paid", "TDS", "Challan", "Matched by"]],
      rows.map(r => { const c = byId[r.challan]; return [r.employee || r.party, r.pan || "PANNOTAVBL", d(r.date), r.paid, r.tds, c ? c.bsr + " / " + c.serial + " / " + d(c.date) : r.tds > 0 ? "on no challan" : "", typeof TDSMatch === "object" ? TDSMatch.matchedBy(r.id).words.replace(/^Matched by: /, "") : ""]; }));
  },
  async toExcel(fy, q){
    await ensureXlsx();
    const a1 = this.annexI(fy, q), a2 = this.annexII(fy);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      [["Sl.", "Employee", "PAN", "Code", "Months paid", "Amount paid or credited", "TDS deducted"]].concat(
        a1.map((e, i) => [i + 1, e.name, e.pan || "PANNOTAVBL", e.code, e.months, e.paid, e.tds]))), "Annexure I " + q);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(
      [["Sl.", "Employee", "PAN", "Regime", "Gross salary", "Exempt allowances", "Standard deduction", "Professional tax",
        "Chapter VI-A", "Taxable income", "TDS", "Surcharge", "Cess"]].concat(
        a2.map((e, i) => [i + 1, e.name, e.pan || "PANNOTAVBL", e.regime === "N" ? "New" : e.regime === "O" ? "Old" : "", e.gross, e.exempt,
          e.standard, e.profTax, e.chapter6, e.taxable, e.tds, e.surcharge, e.cess]))), "Annexure II " + fy);
    // next-challan-match: the Challans sheet: each challan this return uses (what it pays here, the interest and fee
    // allocated here, what is left), then each salary payment with its challan (or "on no challan")
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(this.challanSheet(fy, q)), "Challans");
    const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-24Q-" + q + "-" + fy.replace("-", "") + ".xlsx",
      new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
};

