/* ================================================================== */
/* 24Q: salary, employee by employee                                  */
/* ================================================================== */
const TDS24Q = {
  // the salary sheet, in whatever column names the office uses
  cols: {
    name: ["employeename", "name", "nameofemployee", "employee"],
    pan: ["pan", "pannumber", "panofemployee", "employeepan"],
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
  pick(head, names){
    const h = head.map(x => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
    for (const n of names){ const i = h.indexOf(n); if (i >= 0) return i; }
    for (const n of names){ const i = h.findIndex(x => x.includes(n)); if (i >= 0) return i; }
    return -1;
  },
  async fromFile(file){
    let grid;
    if (/\.(xlsx|xls)$/i.test(file.name)){
      await ensureXlsx();
      const wb = XLSX.read(await file.arrayBuffer(), {type: "array", cellDates: true});
      grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, raw: true, defval: ""});
    } else {
      const t = await file.text();
      grid = t.split(/\r?\n/).filter(Boolean).map(l => l.split(l.includes("\t") ? "\t" : ","));
    }
    let hi = -1;
    for (let i = 0; i < Math.min(10, grid.length); i++){
      if (this.pick(grid[i], this.cols.name) >= 0 && this.pick(grid[i], this.cols.tds) >= 0){ hi = i; break; }
    }
    if (hi < 0) return {error: "That sheet needs at least an employee name column and a TDS column."};
    const head = grid[hi], idx = {};
    Object.keys(this.cols).forEach(k => { idx[k] = this.pick(head, this.cols[k]); });
    const get = (r, k) => idx[k] >= 0 ? r[idx[k]] : "";
    const rows = [];
    grid.slice(hi + 1).forEach(r => {
      const name = String(get(r, "name") || "").trim();
      if (!name || /^total/i.test(name)) return;
      const tds = num(get(r, "tds"));
      const when = Market.date(get(r, "date")) || this.monthDate(get(r, "month"));
      rows.push({name, pan: String(get(r, "pan") || "").toUpperCase().replace(/[^A-Z0-9]/g, ""), code: String(get(r, "code") || "").trim(),
        date: when, gross: num(get(r, "gross")), exempt: num(get(r, "exempt")), standard: num(get(r, "standard")),
        profTax: num(get(r, "profTax")), chapter6: num(get(r, "chapter6")), taxable: num(get(r, "taxable")),
        tds, surcharge: num(get(r, "surcharge")), cess: num(get(r, "cess")),
        regime: /new/i.test(String(get(r, "regime") || "")) ? "N" : /old/i.test(String(get(r, "regime") || "")) ? "O" : ""});
    });
    return {rows: rows.filter(r => r.tds || r.gross)};
  },
  monthDate(v){
    const s = String(v || "").trim();
    if (!s) return "";
    const m = s.match(/([A-Za-z]{3,})[^0-9]*(\d{2,4})/);
    if (m){
      const mo = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
      const y = m[2].length === 2 ? "20" + m[2] : m[2];
      if (mo) return y + "-" + String(mo).padStart(2, "0") + "-" + new Date(num(y), mo, 0).getDate();
    }
    return Market.date(s);
  },
  rows(){ return ((S.books || {}).salary || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))); },
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
    const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-24Q-" + q + "-" + fy.replace("-", "") + ".xlsx",
      new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
};

