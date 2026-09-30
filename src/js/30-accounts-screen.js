
/* ---------- the Accounts tab: the financial statements, and where each ledger goes ---------- */
function fsYears(){ const ms = GSTR.months(); return Array.from(new Set(ms.map(m => Audit.fyStart(m + "01").slice(0, 4)))).sort().reverse(); }
async function fsExcel(d){
  await ensureXlsx();
  const wb = XLSX.utils.book_new(), add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n.slice(0, 31));
  const pyOn = d.py && Object.keys(d.py).length;
  add("Balance Sheet", [["Particulars", "31 Mar " + (num(d.fy) + 1)].concat(pyOn ? ["31 Mar " + d.fy] : [])].concat(d.lines.filter(z => num(d.put[z[0]]) || num((d.py || {})[z[0]])).map(z => [FS.SECTIONS[z[2]] + ": " + z[1], num(d.put[z[0]])].concat(pyOn ? [num(d.py[z[0]])] : [])))
    .concat([["Total equity and liabilities", d.eqL], ["Total assets", d.assets], ["Difference", d.diff]]));
  add("Profit and Loss", [["Particulars", "Year to 31 Mar " + (num(d.fy) + 1)]].concat(FS.PL.filter(z => num(d.pl[z[0]])).map(z => [z[1], num(d.pl[z[0]])])).concat([["Total income", d.inc], ["Total expenses", d.exp], ["Profit before tax", d.pbt], ["Profit for the year", d.pat]]));
  add("Ledgers", [["Line", "Ledger", "Amount"]].concat(Object.entries(d.det).flatMap(([k, list]) => list.map(([l, v]) => [(d.lines.find(z => z[0] === k) || [0, k])[1], l, v])))
    .concat(Object.entries(d.plDet).flatMap(([k, list]) => list.map(([l, v]) => ["P&L: " + ((FS.PL.find(z => z[0] === k) || [0, k])[1]), l, v]))));
  if (d.fa.length) add("Fixed assets", [["Asset", "Opening", "Additions", "Deductions", "Closing"]].concat(d.fa.map(x => [x.l, x.open, x.add, x.del, x.close])));
  saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-financial-statements-" + d.fy + ".xlsx", new Blob([XLSX.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}
