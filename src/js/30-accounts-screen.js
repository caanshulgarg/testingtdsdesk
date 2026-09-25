
/* ---------- the Accounts tab: the financial statements, and where each ledger goes ---------- */
function fsYears(){ const ms = GSTR.months(); return Array.from(new Set(ms.map(m => Audit.fyStart(m + "01").slice(0, 4)))).sort().reverse(); }
function viewBooksAccounts(b){
  const c = FS.cfg(b), years = fsYears(), fy = S.fsFy && years.includes(S.fsFy) ? S.fsFy : years[0], m = v => INR.format(r2(v || 0));
  if (!fy) return '<div class="bk-none">Bring in the day book first.</div>';
  const d = S.fsRun && S.fsRun.fy === fy && S.fsRun.kind === c.kind ? S.fsRun.d : null;
  let h = '<section class="dash-card"><h3>Financial statements</h3><div class="row" style="gap:8px;flex-wrap:wrap;align-items:center">' +
    '<select data-fskind style="width:auto"><option value="co"' + (c.kind === "co" ? " selected" : "") + '>Company: Schedule III (Division I)</option><option value="nc"' + (c.kind !== "co" ? " selected" : "") + ">Firm, LLP, proprietor, trust: ICAI format for non-corporate entities</option></select>" +
    '<select data-fsfy style="width:auto">' + years.map(y => '<option value="' + y + '"' + (y === fy ? " selected" : "") + ">" + y + "-" + String(num(y) + 1).slice(2) + "</option>").join("") + "</select>" +
    '<button class="btn small primary" data-act="fsRun">Run now</button>' + (d && !d.error ? '<button class="btn small" data-act="fsPdf">Download (PDF)</button><button class="btn small" data-act="fsExcel">Excel</button>' : "") + "</div>" +
    '<div class="row" style="gap:12px;flex-wrap:wrap;align-items:center;margin-top:8px">' +
    '<label class="note">Opening stock <input type="number" step="0.01" data-fsstock="open" value="' + esc(c.stock.open || "") + '" style="width:130px"></label><label class="note">Closing stock <input type="number" step="0.01" data-fsstock="close" value="' + esc(c.stock.close || "") + '" style="width:130px"></label>' +
    '<label class="note"><input type="checkbox" data-fsmfg' + (c.mfg ? " checked" : "") + "> purchases are materials consumed (a manufacturer)</label>" +
    (c.kind === "co" ? '<label class="note">Equity shares <input type="number" data-fsshares value="' + esc(c.shares || "") + '" style="width:110px"></label>' : "") + "</div>" +
    '<p class="note">Stock is taken from the stock ledgers when Tally keeps inventory in the accounts; otherwise type it here. Each ledger is placed by its group in Tally and by its balance (a customer in credit is an advance received, a bank in credit is an overdraft); change any on the Mapping tab.</p></section>';
  const tab = S.fsTab || "st";
  h += '<nav class="sbar" aria-label="Accounts" style="margin-top:10px">' + [["st", "Statements"], ["map", "Mapping"]].map(([id, l]) => '<button data-fstab="' + id + '" aria-selected="' + (tab === id) + '">' + l + "</button>").join("") + "</nav>";
  if (!d) return h + '<div class="bk-none">Press Run now.</div>';
  if (d.error) return h + '<div class="bk-alert">The balances are needed: ' + esc(d.error) + ".</div>";
  if (tab === "map"){
    const lines = FS.LINES[c.kind === "co" ? "co" : "nc"].concat(FS.PL.map(z => [z[0], "P&L: " + z[1], "PL"]));
    const q = String(S.fsQ || "").toLowerCase(), rows = [];
    Object.entries(d.det).forEach(([k, list]) => list.forEach(([l, v]) => rows.push([l, k, v])));
    Object.entries(d.plDet).forEach(([k, list]) => list.forEach(([l, v]) => rows.push([l, k, v])));
    const shown = rows.filter(r => !/^(Surplus|Closing stock|Opening stock|Less: closing)/.test(r[0]) && (!q || r[0].toLowerCase().includes(q))).sort((a, c2) => a[1].localeCompare(c2[1]) || Math.abs(c2[2]) - Math.abs(a[2]));
    return h + '<div class="revfilter"><input type="search" id="fsq" data-fk="fsq" data-keeptyped value="' + esc(S.fsQ || "") + '" placeholder="Find a ledger" style="width:260px"><span class="note">' + shown.length + ' ledgers \u00b7 <b>' + Object.keys(c.map || {}).length + "</b> placed by hand</span></div>" +
      '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Ledger</th><th>Tally group</th><th class="n">Amount</th><th>Goes to</th></tr></thead><tbody>' +
      shown.slice(0, 500).map(([l, k, v]) => "<tr><td>" + esc(l) + (c.map[l] ? ' <span class="tag">by hand</span>' : "") + '</td><td class="note">' + esc(FS.nature(l).path.join(" \u2190 ")) + '</td><td class="n">' + m(v) + '</td><td><select data-fsmap="' + esc(l) + '" style="width:auto">' +
        lines.map(z => '<option value="' + z[0] + '"' + (z[0] === k ? " selected" : "") + ">" + esc(z[1]) + "</option>").join("") + '</select>' + (c.map[l] ? ' <button class="linkbtn" data-fsunmap="' + esc(l) + '">by rule</button>' : "") + "</td></tr>").join("") + "</tbody></table></div>";
  }
  return h + '<section class="dash-card fs-doc" style="margin-top:10px">' + (Math.abs(d.diff) >= 1 ? "" : '<p class="note" style="color:#1F7A4D">The balance sheet tallies.</p>') + FS.html(d).replace(/<table>/g, '<div class="bk-tablewrap"><table class="bk-table">').replace(/<\/table>/g, "</table></div>") + "</section>";
}
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
