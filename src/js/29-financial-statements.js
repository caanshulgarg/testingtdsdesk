
/* ================================================================== */
/* Financial statements: Schedule III (companies) and the ICAI format */
/* for non-corporate entities, from the ledgers in Tally              */
/* ================================================================== */
const FS = {
  // what a group is, from Tally's own flags when the masters are read, else from the reserved names
  nature(l){
    const b = S.books || {}, info = b.groupInfo || {}, path = Books.groupPath(l), top = path[path.length - 1] || "";
    const x = info[top] || info[path[0]];
    if (x) return {rev: x.rev, gp: x.gp, dr: x.dr, path, top};
    const t = top.toLowerCase();
    const R = {"sales accounts": [1, 1, 0], "direct incomes": [1, 1, 0], "indirect incomes": [1, 0, 0], "purchase accounts": [1, 1, 1], "direct expenses": [1, 1, 1], "indirect expenses": [1, 0, 1]};
    if (R[t]) return {rev: !!R[t][0], gp: !!R[t][1], dr: !!R[t][2], path, top};
    return {rev: false, gp: false, dr: /assets|investments|misc\. expenses|suspense|branch/.test(t), path, top};
  },
  // the lines of each format: [id, label, section]
  LINES: {
    co: [["share", "Share capital", "EQ"], ["reserves", "Reserves and surplus", "EQ"], ["ltb", "Long-term borrowings", "NCL"], ["dtl", "Deferred tax liabilities (net)", "NCL"], ["oltl", "Other long-term liabilities", "NCL"], ["ltp", "Long-term provisions", "NCL"],
      ["stb", "Short-term borrowings", "CL"], ["tp", "Trade payables", "CL"], ["ocl", "Other current liabilities", "CL"], ["stp", "Short-term provisions", "CL"],
      ["ppe", "Property, plant and equipment", "NCA"], ["intang", "Intangible assets", "NCA"], ["cwip", "Capital work-in-progress", "NCA"], ["nci", "Non-current investments", "NCA"], ["dta", "Deferred tax assets (net)", "NCA"], ["ltla", "Long-term loans and advances", "NCA"], ["onca", "Other non-current assets", "NCA"],
      ["ci", "Current investments", "CA"], ["inv", "Inventories", "CA"], ["tr", "Trade receivables", "CA"], ["cash", "Cash and cash equivalents", "CA"], ["stla", "Short-term loans and advances", "CA"], ["oca", "Other current assets", "CA"]],
    nc: [["capital", "Owners' capital", "EQ"], ["reserves", "Reserves and surplus", "EQ"], ["ltb", "Long-term borrowings", "NCL"], ["dtl", "Deferred tax liabilities (net)", "NCL"], ["oltl", "Other long-term liabilities", "NCL"], ["ltp", "Long-term provisions", "NCL"],
      ["stb", "Short-term borrowings", "CL"], ["tp", "Trade payables", "CL"], ["ocl", "Other current liabilities", "CL"], ["stp", "Short-term provisions", "CL"],
      ["ppe", "Property, plant and equipment", "NCA"], ["intang", "Intangible assets", "NCA"], ["cwip", "Capital work-in-progress", "NCA"], ["nci", "Non-current investments", "NCA"], ["dta", "Deferred tax assets (net)", "NCA"], ["ltla", "Long-term loans and advances", "NCA"], ["onca", "Other non-current assets", "NCA"],
      ["ci", "Current investments", "CA"], ["inv", "Inventories", "CA"], ["tr", "Trade receivables", "CA"], ["cash", "Cash and bank balances", "CA"], ["stla", "Short-term loans and advances", "CA"], ["oca", "Other current assets", "CA"]]
  },
  PL: [["rev", "Revenue from operations"], ["oth", "Other income"], ["mat", "Cost of materials consumed"], ["pur", "Purchases of stock-in-trade"], ["chg", "Changes in inventories"], ["emp", "Employee benefits expense"],
    ["fin", "Finance costs"], ["dep", "Depreciation and amortisation expense"], ["exp", "Other expenses"], ["exc", "Exceptional items"], ["tax", "Tax expense"]],
  SECTIONS: {EQ: "Shareholders' funds", NCL: "Non-current liabilities", CL: "Current liabilities", NCA: "Non-current assets", CA: "Current assets"},
  cfg(b){ return Object.assign({kind: "co", mfg: false, map: {}, stock: {}, shares: "", face: ""}, (b && b.fs) || {}); },
  // where a ledger goes by rule, before any choice by hand; bal is Tally's sign (a debit is negative)
  place(l, bal, kind){
    const n = this.nature(l), p = n.path.map(g => g.toLowerCase()), has = g => p.includes(g), up = l.toUpperCase();
    if (n.rev){
      if (!n.dr) return n.gp ? "rev" : "oth";
      if (n.gp) return has("purchase accounts") ? "pur" : "exp";
      const txt = up + " " + n.path.join(" ").toUpperCase();
      if (/DEPRECIATION|AMORTI/.test(txt)) return "dep";
      if (/INCOME TAX|PROVISION FOR TAX|DEFERRED TAX/.test(txt)) return "tax";
      if (/EMPLOYEE|SALAR|WAGES|BONUS|STAFF|GRATUITY|\bPF\b|\bESI|PROVIDENT|LEAVE ENCASH|INCENTIVE/.test(txt)) return "emp";
      if (/FINANCE|INTEREST|PROCESSING FEE|LOAN CHARGE|BANK CHARGE/.test(txt) && !/INTEREST ON (TDS|GST|INCOME TAX)/.test(up)) return "fin";
      return "exp";
    }
    if (/PROFIT\s*&\s*LOSS/i.test(l)) return "reserves";
    const dr = bal < 0;
    if (has("capital account")) return has("reserves & surplus") ? "reserves" : (kind === "co" ? (/SHARE|EQUITY|CAPITAL/.test(up) && !/CURRENT|DRAWING/.test(up) ? "share" : "reserves") : "capital");
    if (has("reserves & surplus")) return "reserves";
    if (has("fixed assets")) return /SOFTWARE|GOODWILL|TRADEMARK|PATENT|COPYRIGHT|LICEN[CS]E|INTANGIBLE/.test(up) ? "intang" : /CAPITAL WORK|CWIP|UNDER CONSTRUCTION/.test(up) ? "cwip" : "ppe";
    if (has("investments")) return /MUTUAL FUND|\bMF\b|LIQUID|\bSIP\b/.test(up) ? "ci" : "nci";
    if (has("stock-in-hand")) return "inv";
    if (has("sundry debtors")) return dr ? "tr" : "ocl";                             // a customer in credit: an advance received
    if (has("sundry creditors")) return dr ? "stla" : "tp";                          // a supplier in debit: an advance paid
    if (has("cash-in-hand")) return dr ? "cash" : "stb";
    if (has("bank od a/c") || has("bank occ a/c")) return dr ? "cash" : "stb";
    if (has("bank accounts")) return dr ? "cash" : "stb";                            // a bank in credit is an overdraft
    if (has("secured loans") || has("unsecured loans") || has("loans (liability)")) return /CREDIT CARD|OVERDRAFT|\bOD\b|\bCC\b|CASH CREDIT/.test(up + " " + n.path.join(" ").toUpperCase()) ? "stb" : (dr ? "stla" : "ltb");
    if (/DEFERRED TAX/.test(up)) return dr ? "dta" : "dtl";
    if (has("provisions")) return /GRATUITY|LEAVE/.test(up) ? "ltp" : "stp";
    if (has("duties & taxes")) return dr ? "stla" : "ocl";                           // input credit and tax paid in advance are assets
    if (has("deposits (asset)")) return /FIXED DEPOSIT|\bFD\b|FDR/.test(up + " " + n.path.join(" ").toUpperCase()) ? "cash" : (/SECURITY|RENT DEPOSIT/.test(up) ? "ltla" : "stla");
    if (has("loans & advances (asset)")) return dr ? "stla" : "ocl";
    if (has("current assets")) return dr ? (/FIXED DEPOSIT|\bFD\b/.test(up + " " + n.path.join(" ").toUpperCase()) ? "cash" : /TDS|TCS|INCOME TAX|GST|ADVANCE TAX|REFUND/.test(up + " " + n.path.join(" ").toUpperCase()) ? "stla" : "oca") : "ocl";
    if (has("current liabilities")) return dr ? "stla" : "ocl";
    if (has("misc. expenses (asset)")) return "onca";
    if (has("suspense a/c")) return dr ? "oca" : "ocl";
    return dr ? "oca" : "ocl";
  },
  // one set of statements for a year, from the ledgers' balances and the year's movements
  build(fy){
    const b = S.books, c = this.cfg(b), from = fy + "0401", to = String(num(fy) + 1) + "0331";
    const bal = Audit.balances(from, to);
    if (!bal.ok) return {error: bal.why, from, to};
    const close = bal.at(to), open = bal.at(Audit.dayBefore(from)), lines = this.LINES[c.kind === "co" ? "co" : "nc"];
    const mv = MIS.moves(from, to), stock = c.stock || {}, integrated = Object.keys(close).some(l => this.nature(l).path.some(g => /^stock-in-hand$/i.test(g)) && Math.abs(close[l]) >= 1);
    const put = {}, det = {}, add = (k, l, v) => { put[k] = r2((put[k] || 0) + v); (det[k] = det[k] || []).push([l, r2(v)]); };
    const plLine = {}, plDet = {};
    const all = Array.from(new Set(Object.keys(close).concat(Object.keys(mv)))).sort();
    let revenueLedgersClose = 0;
    all.forEach(l => {
      const v = num(close[l]), n = this.nature(l);
      const where = (c.map || {})[l] || this.place(l, v, c.kind);
      if (n.rev){
        // the year's movement goes to the statement of profit and loss
        const m = num((mv[l] || {}).t), amt = !n.dr ? m : -m, k = where === "pur" && c.mfg ? "mat" : where;
        plLine[k] = r2((plLine[k] || 0) + amt); (plDet[k] = plDet[k] || []).push([l, r2(amt)]);
        revenueLedgersClose += v;
        return;
      }
      if (Math.abs(v) < 0.005) return;
      const side = lines.find(z => z[0] === where);
      if (!side) return add("ocl", l, v);
      const liab = ["EQ", "NCL", "CL"].includes(side[2]);
      add(where, l, liab ? v : -v);
    });
    // inventories: the stock ledgers when Tally keeps them, else the figures typed
    const stOpen = integrated ? 0 : num(stock.open), stClose = integrated ? 0 : num(stock.close);
    if (!integrated && stClose) add("inv", "Closing stock (as typed)", stClose);
    plLine.chg = r2((plLine.chg || 0) + (stOpen - stClose)); if (stOpen || stClose) plDet.chg = [["Opening stock", stOpen], ["Less: closing stock", -stClose]];
    const inc = num(plLine.rev) + num(plLine.oth), exp = ["mat", "pur", "chg", "emp", "fin", "dep", "exp"].reduce((s2, k) => s2 + num(plLine[k]), 0);
    const pbe = r2(inc - exp), pbt = r2(pbe - num(plLine.exc)), pat = r2(pbt - num(plLine.tax));
    // last year's profit, still in the income and expense ledgers at the start of the year, and the stock it carried
    const bf = r2(all.filter(l => this.nature(l).rev).reduce((a, l) => a + num(open[l]), 0) + stOpen);
    if (Math.abs(bf) >= 0.005) add("reserves", "Surplus brought forward: last year's profit not yet in the profit and loss account", bf);
    // this year's profit sits in reserves (for a firm, with the partners' capital)
    add("reserves", "Surplus: profit for the year", pat);
    const sec = s2 => lines.filter(z => z[2] === s2).reduce((a, z) => a + num(put[z[0]]), 0);
    const eqL = r2(sec("EQ") + sec("NCL") + sec("CL")), assets = r2(sec("NCA") + sec("CA"));
    // last year, when the balances before the year are known
    const py = {}; all.forEach(l => { const v = num(open[l]); if (!v || this.nature(l).rev) return; const where = (c.map || {})[l] || this.place(l, v, c.kind), side = lines.find(z => z[0] === where);
      const liab = side && ["EQ", "NCL", "CL"].includes(side[2]); const k = side ? where : "ocl"; py[k] = r2((py[k] || 0) + (liab || !side ? v : -v)); });
    if (!integrated && num(stock.open)) py.inv = r2((py.inv || 0) + num(stock.open));
    const pyRev = r2(all.filter(l => this.nature(l).rev).reduce((a, l) => a + num(open[l]), 0));
    if (pyRev) py.reserves = r2((py.reserves || 0) + pyRev + (integrated ? 0 : num(stock.open)));
    // the profit and loss balance before the year belongs to reserves; revenue ledgers carry no balance at the start of a year
    const lyCovered = MIS.covered(MIS.shift(from, -1));
    const pyPl = lyCovered ? this.plOnly(MIS.shift(from, -1), MIS.shift(to, -1), c) : null;
    // the notes a reader needs: trade payables and receivables by age, MSME, and the fixed assets
    const pays = MIS.ageing(to, "p", close), recv = MIS.ageing(to, "r", close), msme = MIS.msme();
    const fa = all.filter(l => ["ppe", "intang", "cwip"].includes((c.map || {})[l] || this.place(l, num(close[l]), c.kind)) && !this.nature(l).rev).map(l => {
      const o = -num(open[l]), cl = -num(close[l]); let addn = 0, del = 0;
      (b.vouchers || []).forEach(v => { if (v.date < from || v.date > to || v.opt || v.cancel) return; v.ent.forEach(e => { if (e.l !== l) return; if (e.a < 0 && !/DEPRECIATION/i.test(v.narr || "")) addn += -e.a; else if (e.a > 0) del += e.a; }); });
      return {l, open: r2(o), add: r2(addn), del: r2(del), close: r2(cl)};
    }).filter(x => x.open || x.close || x.add || x.del);
    return {fy, from, to, kind: c.kind, lines, put, det, py, pl: plLine, plDet, inc: r2(inc), exp: r2(exp), pbe, pbt, pat, pyPl, eqL, assets, diff: r2(eqL - assets), integrated, stock: {open: stOpen, close: stClose},
      src: bal.src, tp: {msme: r2(pays.rows.filter(p => /micro|small/i.test(msme[p.party] || "")).reduce((a, p) => a + p.total, 0)), all: r2(put.tp || 0), age: pays.sum, rows: pays.rows}, tr: {age: recv.sum, rows: recv.rows}, fa,
      eps: c.kind === "co" && num(c.shares) ? r2(pat / num(c.shares)) : null, cfg: c};
  },
  plOnly(from, to, c){
    const mv = MIS.moves(from, to), pl = {};
    Object.keys(mv).forEach(l => { const n = this.nature(l); if (!n.rev) return; const m = num(mv[l].t), amt = !n.dr ? m : -m, w = (c.map || {})[l] || this.place(l, 0, c.kind), k = w === "pur" && c.mfg ? "mat" : w; pl[k] = r2((pl[k] || 0) + amt); });
    const inc = num(pl.rev) + num(pl.oth), exp = ["mat", "pur", "chg", "emp", "fin", "dep", "exp"].reduce((s2, k) => s2 + num(pl[k]), 0);
    return Object.assign(pl, {inc: r2(inc), exp: r2(exp), pbt: r2(inc - exp - num(pl.exc)), pat: r2(inc - exp - num(pl.exc) - num(pl.tax))});
  },
  // the statements as one document
  html(d){
    const co = CO(), m = v => v == null || v === "" ? "" : INR.format(r2(v)), comp = d.kind === "co", py = d.py && Object.keys(d.py).length;
    let noteNo = 0; const notes = [], noteOf = {};
    const nOf = k => { if (!noteOf[k]) { noteOf[k] = ++noteNo; notes.push(k); } return noteOf[k]; };
    const head = (a, c2) => '<tr><td colspan="4" style="padding-top:8px"><b>' + a + "</b></td></tr>" + (c2 || "");
    let bs = '<table><thead><tr><th>Particulars</th><th class="n">Note</th><th class="n">31 March ' + (num(d.fy) + 1) + '</th><th class="n">' + (py ? "31 March " + d.fy : "") + "</th></tr></thead><tbody>";
    const row = (z, pv) => { const v = num(d.put[z[0]]); if (!v && !num((d.py || {})[z[0]])) return ""; return "<tr><td>\u2003" + esc(z[1]) + '</td><td class="n">' + nOf(z[0]) + '</td><td class="n">' + m(v) + '</td><td class="n">' + (py ? m((d.py || {})[z[0]]) : "") + "</td></tr>"; };
    const secTot = s2 => d.lines.filter(z => z[2] === s2).reduce((a, z) => a + num(d.put[z[0]]), 0), secPy = s2 => d.lines.filter(z => z[2] === s2).reduce((a, z) => a + num((d.py || {})[z[0]]), 0);
    bs += head("I. EQUITY AND LIABILITIES");
    [["EQ", comp ? "Shareholders' funds" : "Owners' funds"], ["NCL", "Non-current liabilities"], ["CL", "Current liabilities"]].forEach(([s2, l], i) => { bs += head("(" + (i + 1) + ") " + l) + d.lines.filter(z => z[2] === s2).map(z => row(z)).join(""); });
    bs += '<tr><td><b>TOTAL</b></td><td></td><td class="n"><b>' + m(d.eqL) + '</b></td><td class="n"><b>' + (py ? m(secPy("EQ") + secPy("NCL") + secPy("CL")) : "") + "</b></td></tr>";
    bs += head("II. ASSETS");
    [["NCA", "Non-current assets"], ["CA", "Current assets"]].forEach(([s2, l], i) => { bs += head("(" + (i + 1) + ") " + l) + d.lines.filter(z => z[2] === s2).map(z => row(z)).join(""); });
    bs += '<tr><td><b>TOTAL</b></td><td></td><td class="n"><b>' + m(d.assets) + '</b></td><td class="n"><b>' + (py ? m(secPy("NCA") + secPy("CA")) : "") + "</b></td></tr></tbody></table>";
    const plRow = (k, l, pv) => { const v = num(d.pl[k]); if (!v && !(d.pyPl && num(d.pyPl[k]))) return ""; return "<tr><td>\u2003" + esc(l) + '</td><td class="n">' + nOf("pl:" + k) + '</td><td class="n">' + m(v) + '</td><td class="n">' + (d.pyPl ? m(d.pyPl[k]) : "") + "</td></tr>"; };
    const L = Object.fromEntries(this.PL);
    let pl = '<table><thead><tr><th>Particulars</th><th class="n">Note</th><th class="n">Year to 31 March ' + (num(d.fy) + 1) + '</th><th class="n">' + (d.pyPl ? "Year to 31 March " + d.fy : "") + "</th></tr></thead><tbody>" +
      plRow("rev", "I. " + L.rev) + plRow("oth", "II. " + L.oth) + '<tr><td><b>III. Total income (I + II)</b></td><td></td><td class="n"><b>' + m(d.inc) + '</b></td><td class="n"><b>' + (d.pyPl ? m(d.pyPl.inc) : "") + "</b></td></tr>" +
      '<tr><td colspan="4"><b>IV. Expenses</b></td></tr>' + ["mat", "pur", "chg", "emp", "fin", "dep", "exp"].map(k => plRow(k, L[k])).join("") +
      '<tr><td><b>Total expenses</b></td><td></td><td class="n"><b>' + m(d.exp) + '</b></td><td class="n"><b>' + (d.pyPl ? m(d.pyPl.exp) : "") + "</b></td></tr>" +
      '<tr><td><b>V. Profit before exceptional items and tax</b></td><td></td><td class="n"><b>' + m(d.pbe) + "</b></td><td></td></tr>" + plRow("exc", "VI. " + L.exc) +
      '<tr><td><b>VII. Profit before tax</b></td><td></td><td class="n"><b>' + m(d.pbt) + '</b></td><td class="n"><b>' + (d.pyPl ? m(d.pyPl.pbt) : "") + "</b></td></tr>" + plRow("tax", "VIII. " + L.tax) +
      '<tr><td><b>IX. Profit for the year</b></td><td></td><td class="n"><b>' + m(d.pat) + '</b></td><td class="n"><b>' + (d.pyPl ? m(d.pyPl.pat) : "") + "</b></td></tr>" +
      (d.eps != null ? "<tr><td>X. Earnings per equity share (basic and diluted)</td><td></td><td class=\"n\">" + d.eps.toFixed(2) + "</td><td></td></tr>" : "") + "</tbody></table>";
    // the notes: the ledgers behind each line, and the ones the formats ask for
    const lab = k => (d.lines.find(z => z[0] === k) || [0, (this.PL.find(z => "pl:" + z[0] === k) || [0, k])[1]])[1];
    let nt = "";
    notes.forEach(k => {
      const list = k.startsWith("pl:") ? (d.plDet[k.slice(3)] || []) : (d.det[k] || []);
      nt += '<h3 style="font-size:13px;margin:12px 0 4px">Note ' + noteOf[k] + ". " + esc(lab(k)) + "</h3>";
      if (k === "tp") nt += '<p class="note">Micro and small enterprises: ' + m(d.tp.msme) + "; others: " + m(d.tp.all - d.tp.msme) + ". Outstanding by age from the bill date: " + MIS.BUCKETS.map((z, i) => z[1] + " days " + m(d.tp.age.b[i])).join("; ") + ".</p>";
      if (k === "tr") nt += '<p class="note">Outstanding by age from the bill date: ' + MIS.BUCKETS.map((z, i) => z[1] + " days " + m(d.tr.age.b[i])).join("; ") + ". Undisputed, considered good unless shown otherwise.</p>";
      if (k === "ppe" && d.fa.length) nt += '<table><thead><tr><th>Asset</th><th class="n">Opening</th><th class="n">Additions</th><th class="n">Deductions</th><th class="n">Closing</th></tr></thead><tbody>' +
        d.fa.map(x => "<tr><td>" + esc(x.l) + '</td><td class="n">' + m(x.open) + '</td><td class="n">' + m(x.add) + '</td><td class="n">' + m(x.del) + '</td><td class="n">' + m(x.close) + "</td></tr>").join("") + "</tbody></table>";
      nt += "<table><tbody>" + list.slice().sort((a, c2) => Math.abs(c2[1]) - Math.abs(a[1])).slice(0, 60).map(([l, v]) => "<tr><td>" + esc(l) + '</td><td class="n">' + m(v) + "</td></tr>").join("") +
        (list.length > 60 ? '<tr><td class="note">and ' + (list.length - 60) + " more ledgers</td><td></td></tr>" : "") + "</tbody></table>";
    });
    const title = comp ? "Balance Sheet as at 31 March " + (num(d.fy) + 1) : "Balance Sheet as at 31 March " + (num(d.fy) + 1);
    return '<div style="text-align:center;margin-bottom:10px"><h1 style="font-size:18px;margin:0">' + esc(co.name) + '</h1><div class="note">' + (comp ? "Schedule III to the Companies Act, 2013 (Division I)" : "Format of the ICAI Guidance Note on Financial Statements of Non-Corporate Entities") + "</div></div>" +
      "<h2>" + title + "</h2>" + bs + (Math.abs(d.diff) >= 1 ? '<p class="bad">The balance sheet does not tally by \u20b9' + m(d.diff) + ": " + (d.integrated ? "check the opening balances." : "type the opening and closing stock, or check the opening balances.") + "</p>" : "") +
      (d.lines.some(z => num(d.put[z[0]]) < -0.5) ? '<p class="bad">Negative on the balance sheet, to be looked at: ' + d.lines.filter(z => num(d.put[z[0]]) < -0.5).map(z => esc(z[1]) + " " + m(d.put[z[0]])).join("; ") + ". Place those ledgers on the other side on the Mapping tab, or correct them in Tally.</p>" : "") +
      "<h2>Statement of Profit and Loss for the year ended 31 March " + (num(d.fy) + 1) + "</h2>" + pl + "<h2>Notes</h2>" + nt +
      '<p class="note">From the books in Tally (' + esc(d.src || "") + "). A draft for the auditor: accounting policies, contingent liabilities, related parties and the other disclosures are added from the records.</p>";
  }
};
