
/* ---------- the Accounts tab: the financial statements, and where each ledger goes ---------- */
function fsYears(){ const ms = GSTR.months(); return Array.from(new Set(ms.map(m => Audit.fyStart(m + "01").slice(0, 4)))).sort().reverse(); }
// the last year the books cover to its end, 31 March (review of 01-Oct-2026: Accounts opens on it and runs by itself);
// the latest year when none is complete yet
function fsLastFull(){
  const ys = fsYears(), vs = ((S.books || {}).vouchers || []);
  let end = String(((S.books || {}).meta || {}).to || "");
  vs.forEach(v => { if (String(v.date) > end) end = String(v.date); });
  return ys.find(y => end >= String(num(y) + 1) + "0331") || ys[0] || "";
}
function fsYearNow(){ const ys = fsYears(); return S.fsFy && ys.includes(S.fsFy) ? S.fsFy : fsLastFull(); }
async function fsExcel(d){
  await ensureXlsx();
  const wb = XLSX.utils.book_new(), add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n.slice(0, 31));
  const pyOn = d.py && Object.keys(d.py).length;
  add("Balance Sheet", [["Particulars", "31 Mar " + (num(d.fy) + 1)].concat(pyOn ? ["31 Mar " + d.fy] : [])].concat(d.lines.filter(z => num(d.put[z[0]]) || num((d.py || {})[z[0]])).map(z => [FS.SECTIONS[z[2]] + ": " + z[1], num(d.put[z[0]])].concat(pyOn ? [num(d.py[z[0]])] : [])))
    .concat([["Total equity and liabilities", d.eqL], ["Total assets", d.assets], ["Difference", d.diff]]));
  // review of 02-Oct-2026: a head nil after an expense credit is set off is still listed (MIS.plRule)
  const plSum = d.plSum || {}, plSet = d.plSet || {}, plLab = k => "P&L: " + ((FS.PL.find(z => z[0] === k) || [0, k])[1]);
  add("Profit and Loss", [["Particulars", "Year to 31 Mar " + (num(d.fy) + 1)]].concat(FS.PL.filter(z => num(d.pl[z[0]]) || (plSum[z[0]] && plSum[z[0]].cr >= 0.005)).map(z => [z[1], num(d.pl[z[0]])])).concat([["Total income", d.inc], ["Total expenses", d.exp], ["Profit before tax", d.pbt], ["Profit for the year", d.pat]]));
  // each head: its ledgers (a credit negative, with the flag), then the set-off and the excess credit, then the total
  add("Ledgers", [["Line", "Ledger", "Amount", "Note"]].concat(Object.entries(d.det).flatMap(([k, list]) => list.map(([l, v]) => [(d.lines.find(z => z[0] === k) || [0, k])[1], l, v])))
    .concat(Object.entries(d.plDet).flatMap(([k, list]) => list.map(([l, v, flag]) => [plLab(k), l, v, flag || ""])
      .concat(plSum[k] && plSum[k].cr >= 0.005 ? [[plLab(k), "Debit balances", plSum[k].dr, "set-off"], [plLab(k), "Less: credit balances set off in the head", -plSum[k].cr, "set-off"]] : [])
      .concat((plSet[k] || []).map(([l, v]) => [plLab(k), l, v, "set-off"]))
      .concat(plSum[k] || plSet[k] ? [[plLab(k), "Total", num(d.pl[k]), ""]] : [])))
    .concat(Object.keys(plSet).filter(k => !d.plDet[k]).flatMap(k => plSet[k].map(([l, v]) => [plLab(k), l, v, "set-off"]).concat([[plLab(k), "Total", num(d.pl[k]), ""]]))));
  if (d.fa.length) add("Fixed assets", [["Asset", "Opening", "Additions", "Deductions", "Closing"]].concat(d.fa.map(x => [x.l, x.open, x.add, x.del, x.close])));
  saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-financial-statements-" + d.fy + ".xlsx", new Blob([XLSX.write(wb, {bookType: "xlsx", type: "array"})], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
}
