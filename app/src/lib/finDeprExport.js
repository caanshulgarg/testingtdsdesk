// The Excel sheets and the PDF notes of depreciation and deferred tax (FinDepr, src/js/88-fin-depr.js; owner, 29-Oct-2026),
// in the statements' workbook (finExport.js calls these only when d.depr is there: the Fixed assets & deferred tax tab is in
// use for the client). Three sheets, every figure a formula FinDepr works out the same way:
//   "FA - Companies Act"  the classes (method, life, residual: yellow, change them), each asset's depreciation pro rata by
//                         days to the day before From and to To, the class summary (SUMIFS), what the books booked, and the
//                         differences the Trial Balance's FinCom rows read;
//   "FA - Income tax"     the blocks (section 32): opening WDV (last year's ITR), additions put to use 180 days or more /
//                         under, sale value, ceased, depreciation, STCG / (STCL), closing WDV; the additions and sales below;
//   "Deferred tax"        the timing differences (the register's net block, the blocks' WDV, the Trial Balance's provisions),
//                         the rate from the Inputs' tax regime, closing, last year's, the movement, the entry.
// The Trial Balance's FinCom rows (row.depr) and, when the statements take the register, the PPE sheet's rows read them.
const G = globalThis;
const N = (v) => +v || 0;
const SHN = { ca: "FA - Companies Act", it: "FA - Income tax", dt: "Deferred tax" };
const Q = (name) => "'" + name.replace(/'/g, "''") + "'";
const NF2 = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \\-??_);_(@_)', NF0 = '_(* #,##0_);_(* \\(#,##0\\);_(* \\-??_);_(@_)', DATEF = "dd-mmm-yyyy";
const serial = (ymd) => G.FinDepr.dn(ymd) + 25569;
let L = null;   // the layout of the workbook being made: the cells the other sheets read

const A = (k, c, r) => Q(SHN[k]) + "!$" + c + "$" + r;
// the PPE sheet's row of a class, when the statements take the register: the class summary in the unit
function ppeF(x, sp) {
  const s = (k) => () => (L && L.cls[x.cls] ? "ROUND(" + A("ca", L.col[k], L.cls[x.cls]) + "/UNIT,DEC)" : "0");
  return { D: s("gO"), E: s("gA"), F: () => "-" + s("gD")(), G: "ROUND(" + sp("D") + "+" + sp("E") + "+" + sp("F") + ",DEC)", H: s("dO"), I: s("dep"), J: () => "-" + s("dD")(),
    K: "ROUND(" + sp("H") + "+" + sp("I") + "+" + sp("J") + ",DEC)", L: "ROUND(" + sp("D") + "-" + sp("H") + ",DEC)", M: "ROUND(" + sp("G") + "-" + sp("K") + ",DEC)" };
}
// the Computation's Annexure 1, a block's depreciation (J) or closing WDV (K): the FA - Income tax sheet's (same blocks, same order)
const itRef = (i, col) => () => (L && L.it ? A("it", col, L.it.b0 + i) : "0");
// a FinCom row of the Trial Balance: its CY (column D) read from these sheets
function tbCell(x, i) {
  const [kind, cls] = String(x.depr).split(":");
  const f = () => {
    if (!L) return String(x.cy);
    if (kind === "dt") return cls === "pl" ? A("dt", "C", L.dt.adj) : cls === "dtl" ? "-ROUND(MAX(0," + A("dt", "C", L.dt.closing) + ")-" + A("dt", "C", L.dt.booksL) + ",2)" : "ROUND(MAX(0,-" + A("dt", "C", L.dt.closing) + ")-" + A("dt", "C", L.dt.booksA) + ",2)";
    const r = L.cls[cls]; if (!r) return String(x.cy);
    return kind === "dep" ? A("ca", L.col.depAdj, r) : kind === "gain" ? "-" + A("ca", L.col.gainAdj, r) : kind === "loss" ? A("ca", L.col.lossAdj, r) : A("ca", L.col.netAdj, r);
  };
  return { f, v: x.cy, src: ["tb", "rows", i, "cy"] };
}

function sheets(c) {
  const d = c.d, D = d.depr, ca = D.ca, it = D.itP || D.it, dt = D.dt, put = c.put;
  L = { cls: {}, col: {}, dt: {} };
  ["ca", "it", "dt"].forEach((k) => c.add("fd" + k, SHN[k]));
  const head = (k, title) => {
    put(k, "A1", { f: c.IN.name, v: d.inputs.name }, { b: true, sz: 12 });
    put(k, "A2", title, { b: true });
    put(k, "A3", "Amounts in rupees. Yellow cells are inputs: change one and the sheet, the Trial Balance's FinCom rows and the statements follow.", { i: true, sz: 9 });
  };
  const IN = { fill: "FFFFFF99" };

  // ---- FA - Companies Act ----
  const K = "fdca";
  head(K, "Fixed asset register and depreciation as per the Companies Act, 2013 (Schedule II), " + (ca.full ? "year ended " + G.FinDepr.DMY(ca.y1) : "for the period " + G.FinDepr.DMY(ca.from) + " to " + G.FinDepr.DMY(ca.to)));
  put(K, "A5", "Year starts"); put(K, "B5", serial(ca.y0), { nf: DATEF }); put(K, "A6", "Period from"); put(K, "B6", serial(ca.from), Object.assign({ nf: DATEF }, IN)); put(K, "A7", "Period to"); put(K, "B7", serial(ca.to), Object.assign({ nf: DATEF }, IN));
  put(K, "A8", "Days in the year"); put(K, "B8", { f: "DATE(YEAR(B5)+1,3,31)-B5+1", v: ca.diy });
  const Y0 = A("ca", "B", 5), FROM = A("ca", "B", 6), TO = A("ca", "B", 7), DIY = A("ca", "B", 8);
  // the class table: settings, then the summary of the items, then what the books booked and the differences
  const CH = ["Class", "Method (WDV / SLM / NONE)", "Useful life (years)", "Residual %", "WDV rate", "Gross: opening", "Additions", "Deletions", "Gross: closing", "Depreciation: opening", "For the period", "On deletions", "Depreciation: closing", "Net block: opening", "Net block: closing",
    "Profit on sale", "Loss on sale", "Booked in the books: depreciation", "Booked: profit on sale", "Booked: loss on sale", "FinCom row: depreciation", "FinCom row: profit on sale", "FinCom row: loss on sale", "FinCom row: to the net block"];
  const CC = "ABCDEFGHIJKLMNOPQRSTUVWX".split("");
  ["gO", "gA", "gD", "gC", "dO", "dep", "dD", "dC", "nO", "nC", "gainP", "lossP", "booked", "gainBk", "lossBk", "depAdj", "gainAdj", "lossAdj", "netAdj"].forEach((k, i) => { L.col[k] = CC[5 + i]; });
  let r = 10;
  put(K, "A" + r, "Classes (Schedule II defaults: change the yellow cells)", { b: true }); r++;
  CH.forEach((h, i) => put(K, CC[i] + r, h, { b: true, sz: 9, wrap: true, box: true })); c.ws(K).getRow(r).height = 44; r++;
  const classes = Object.values(ca.classes), c0 = r;
  classes.forEach((x, i) => { L.cls[x.cls] = c0 + i; });
  const itemsStart = c0 + classes.length + 4, n = ca.items.length, i0 = itemsStart + 1, i1 = i0 + Math.max(0, n - 1);
  const IR = (col) => "$" + col + "$" + i0 + ":$" + col + "$" + i1;
  classes.forEach((x, i) => {
    const rr = c0 + i, cf = x.cfg, sum = (col, v, path) => put(K, L.col[col] + rr, { f: n ? "SUMIFS(" + IR(col === "gO" ? "Q" : col === "gA" ? "R" : col === "gD" ? "S" : col === "gC" ? "T" : col === "dO" ? "U" : col === "dep" ? "V" : col === "dD" ? "W" : col === "dC" ? "X" : col === "nO" ? "Y" : "Z") + "," + IR("A") + ",$A" + rr + ")" : "0", v, src: path }, { nf: NF2 });
    put(K, "A" + rr, x.cls); put(K, "B" + rr, cf.method, IN); put(K, "C" + rr, N(cf.life), IN); put(K, "D" + rr, N(cf.res), IN);
    put(K, "E" + rr, { f: 'IF(AND(B' + rr + '="WDV",C' + rr + '>0),1-(D' + rr + '/100)^(1/C' + rr + '),0)', v: cf.method === "WDV" && cf.life > 0 ? 1 - Math.pow(cf.res / 100, 1 / cf.life) : 0 }, { nf: "0.0000%" });
    const P = (k) => ["depr", "ca", "classes", x.cls, k];
    ["gO", "gA", "gD", "gC", "dO", "dep", "dD", "dC", "nO", "nC"].forEach((k) => sum(k, x[k], P(k)));
    put(K, L.col.gainP + rr, { f: n ? "SUMIFS(" + IR("AA") + "," + IR("A") + ",$A" + rr + "," + IR("AA") + ',">0")' : "0", v: x.gainP, src: P("gainP") }, { nf: NF2 });
    put(K, L.col.lossP + rr, { f: n ? "-SUMIFS(" + IR("AA") + "," + IR("A") + ",$A" + rr + "," + IR("AA") + ',"<0")' : "0", v: x.lossP, src: P("lossP") }, { nf: NF2 });
    put(K, L.col.booked + rr, N(x.booked), { nf: NF2 }); put(K, L.col.gainBk + rr, N(x.gainBk), { nf: NF2 }); put(K, L.col.lossBk + rr, N(x.lossBk), { nf: NF2 });
    const cell = (k) => L.col[k] + rr;
    put(K, cell("depAdj"), { f: "ROUND(" + cell("dep") + "-" + cell("booked") + ",2)", v: Math.round((x.dep - x.booked) * 100) / 100 }, { nf: NF2 });
    put(K, cell("gainAdj"), { f: "ROUND(" + cell("gainP") + "-" + cell("gainBk") + ",2)", v: Math.round((x.gainP - x.gainBk) * 100) / 100 }, { nf: NF2 });
    put(K, cell("lossAdj"), { f: "ROUND(" + cell("lossP") + "-" + cell("lossBk") + ",2)", v: Math.round((x.lossP - x.lossBk) * 100) / 100 }, { nf: NF2 });
    put(K, cell("netAdj"), { f: "ROUND(-" + cell("depAdj") + "+" + cell("gainAdj") + "-" + cell("lossAdj") + ",2)", v: Math.round((-(x.dep - x.booked) + (x.gainP - x.gainBk) - (x.lossP - x.lossBk)) * 100) / 100 }, { nf: NF2 });
    put(K, "Y" + rr, x.label, { i: true, sz: 9 });
  });
  const ct = c0 + classes.length;
  put(K, "A" + ct, "Total", { b: true });
  ["gO", "gA", "gD", "gC", "dO", "dep", "dD", "dC", "nO", "nC", "gainP", "lossP"].forEach((k) => put(K, L.col[k] + ct, { f: classes.length ? "SUM(" + L.col[k] + c0 + ":" + L.col[k] + (ct - 1) + ")" : "0", v: ca.total[k] != null ? ca.total[k] : classes.reduce((s, x) => s + N(x[k]), 0), src: ca.total[k] != null ? ["depr", "ca", "total", k] : null }, { b: true, top: true, nf: NF2 }));
  L.caTotal = ct;
  // the items
  const IH = ["Class", "Asset", "Put to use (blank: before the year)", "Sold on", "Sale value", "Cost", "Depreciation at the start of the year", "Method", "Depreciation a year", "Room above the residual", "Counted from", "Days to the day before From", "Days to To",
    "Depreciation to the day before From", "Depreciation to To", "Held at the start of the period (1 = yes)", "Gross: opening", "Additions", "Deletions", "Gross: closing", "Depreciation: opening", "For the period", "On deletions", "Depreciation: closing", "Net block: opening", "Net block: closing", "Profit / (loss) on sale"];
  const IC = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat(["AA"]);
  put(K, "A" + (itemsStart - 1), "The register, asset by asset (depreciation pro rata by days; never below the residual value)", { b: true });
  IH.forEach((h, i) => put(K, IC[i] + itemsStart, h, { b: true, sz: 9, wrap: true, box: true })); c.ws(K).getRow(itemsStart).height = 58;
  ca.items.forEach((x, i) => {
    const rr = i0 + i, cr = L.cls[x.cls], s = (col) => "$" + col + "$" + cr, P = (k) => ["depr", "ca", "items", i, k], inP = (col) => "AND(" + col + rr + '<>"",' + col + rr + ">=" + FROM + "," + col + rr + "<=" + TO + ")";
    put(K, "A" + rr, x.cls); put(K, "B" + rr, x.name);
    put(K, "C" + rr, x.put ? serial(x.put) : null, Object.assign({ nf: DATEF }, IN)); put(K, "D" + rr, x.sale ? serial(x.sale) : null, Object.assign({ nf: DATEF }, IN));
    put(K, "E" + rr, x.sale ? N(x.value) : 0, Object.assign({ nf: NF2 }, IN)); put(K, "F" + rr, N(x.cost), Object.assign({ nf: NF2 }, IN)); put(K, "G" + rr, N(x.acc), Object.assign({ nf: NF2 }, IN));
    put(K, "H" + rr, { f: s("B"), v: x.cls && ca.classes[x.cls] ? ca.classes[x.cls].cfg.method : "" });
    put(K, "I" + rr, { f: "IF(OR(H" + rr + '="NONE",' + s("C") + "<=0),0,IF(H" + rr + '="SLM",F' + rr + "*(1-" + s("D") + "/100)/" + s("C") + ",(F" + rr + "-G" + rr + ")*" + s("E") + "))", v: x.annual }, { nf: NF2 });
    put(K, "J" + rr, { f: "MAX(0,F" + rr + "-F" + rr + "*" + s("D") + "/100-G" + rr + ")", v: x.room }, { nf: NF2 });
    put(K, "K" + rr, { f: "MAX(" + Y0 + ",IF(C" + rr + '="",' + Y0 + ",C" + rr + "))", v: serial(x.put && x.put > ca.y0 ? x.put : ca.y0) }, { nf: DATEF });
    put(K, "L" + rr, { f: "MAX(0,MIN(" + FROM + "-1,IF(D" + rr + '="",' + FROM + "-1,D" + rr + "-1))-K" + rr + "+1)", v: x.daysA });
    put(K, "M" + rr, { f: "MAX(0,MIN(" + TO + ",IF(D" + rr + '="",' + TO + ",D" + rr + "-1))-K" + rr + "+1)", v: x.daysB });
    put(K, "N" + rr, { f: "ROUND(MIN(J" + rr + ",I" + rr + "*L" + rr + "/" + DIY + "),2)", v: x.depA, src: P("depA") }, { nf: NF2 });
    put(K, "O" + rr, { f: "ROUND(MIN(J" + rr + ",I" + rr + "*M" + rr + "/" + DIY + "),2)", v: x.depB, src: P("depB") }, { nf: NF2 });
    put(K, "P" + rr, { f: "IF(AND(OR(C" + rr + '="",C' + rr + "<" + FROM + "),OR(D" + rr + '="",D' + rr + ">=" + FROM + ")),1,0)", v: x.held ? 1 : 0 });
    put(K, "Q" + rr, { f: "P" + rr + "*F" + rr, v: x.gO, src: P("gO") }, { nf: NF2 });
    put(K, "R" + rr, { f: "IF(" + inP("C") + ",F" + rr + ",0)", v: x.gA, src: P("gA") }, { nf: NF2 });
    put(K, "S" + rr, { f: "IF(" + inP("D") + ",F" + rr + ",0)", v: x.gD, src: P("gD") }, { nf: NF2 });
    put(K, "T" + rr, { f: "ROUND(Q" + rr + "+R" + rr + "-S" + rr + ",2)", v: x.gC, src: P("gC") }, { nf: NF2 });
    put(K, "U" + rr, { f: "IF(P" + rr + "=1,ROUND(G" + rr + "+N" + rr + ",2),0)", v: x.dO, src: P("dO") }, { nf: NF2 });
    put(K, "V" + rr, { f: "ROUND(O" + rr + "-N" + rr + ",2)", v: x.dep, src: P("dep") }, { nf: NF2 });
    put(K, "W" + rr, { f: "IF(" + inP("D") + ",ROUND(G" + rr + "+O" + rr + ",2),0)", v: x.dD, src: P("dD") }, { nf: NF2 });
    put(K, "X" + rr, { f: "ROUND(U" + rr + "+V" + rr + "-W" + rr + ",2)", v: x.dC, src: P("dC") }, { nf: NF2 });
    put(K, "Y" + rr, { f: "ROUND(Q" + rr + "-U" + rr + ",2)", v: x.nO, src: P("nO") }, { nf: NF2 });
    put(K, "Z" + rr, { f: "ROUND(T" + rr + "-X" + rr + ",2)", v: x.nC, src: P("nC") }, { nf: NF2 });
    put(K, "AA" + rr, { f: "IF(" + inP("D") + ",ROUND(E" + rr + "-(F" + rr + "-G" + rr + "-O" + rr + "),2),0)", v: x.gain, src: P("gain") }, { nf: NF2 });
  });
  // the register against the trial balance: its net block and the TB's (the classes' codes, after FinCom's rows)
  const tr = i1 + 3, codes = [];
  Object.values(ca.classes).forEach((x) => { codes.push(x.g); if (x.a) codes.push(x.a); });
  put(K, "A" + tr, "Net block: the register less the Trial Balance (the classes' codes, after FinCom's rows; nil when the statements take the register and the opening agrees)", { i: true, sz: 9 });
  put(K, "Z" + tr, { f: "ROUND(" + A("ca", "O", ct) + "-(" + (codes.length ? codes.map((cd) => "SUMIFS(" + c.TBc("F") + "," + c.TBc("G") + ',"' + cd + '")').join("+") : "0") + "),2)", v: null }, { nf: NF2, i: true });
  c.widths(K, Object.assign({ A: 9, B: 44 }, Object.fromEntries(IC.slice(2).map((col) => [col, 14]))));
  c.ws(K).views = [{ state: "frozen", xSplit: 2, ySplit: 0 }];

  // ---- FA - Income tax ----
  const T = "fdit", bl = it.blocks, fyL = d.fy + "-" + String(+d.fy + 1).slice(2);
  head(T, "Depreciation as per the Income-tax Act, 1961 (section 32), previous year " + fyL + (it.part ? ": an estimate to " + G.FinDepr.DMY(D.period.to) + " (section 32 works for a whole year)" : ""));
  put(T, "A5", "Previous year ends"); put(T, "B5", serial(String(+d.fy + 1) + "0331"), { nf: DATEF });
  put(T, "A6", "Up to"); put(T, "B6", serial(it.part ? D.period.to : String(+d.fy + 1) + "0331"), { nf: DATEF });
  put(T, "A7", "Share of the year"); put(T, "B7", { f: "(B6-DATE(YEAR(B5)-1,4,1)+1)/(B5-DATE(YEAR(B5)-1,4,1)+1)", v: it.part ? (G.FinDepr.dn(D.period.to) - G.FinDepr.dn(d.fy + "0401") + 1) / ca.diy : 1 }, { nf: "0.0000" });
  const BH = ["Block", "Rate", "Opening WDV", "Added, put to use 180 days or more", "Added, under 180 days", "Sale value", "Block ceases (1 = yes)", "Total", "STCG / (STCL)", "Depreciation", "Closing WDV", "Opening WDV from"];
  let br = 9; BH.forEach((h, i) => put(T, "ABCDEFGHIJKL"[i] + br, h, { b: true, sz: 9, wrap: true, box: true })); c.ws(T).getRow(br).height = 44; br++;
  const b0 = br, addsS = b0 + bl.length + 4, adds = it.blocks.reduce((a, z) => a.concat(z.adds.map((x) => Object.assign({ block: z.key }, x))), []), a0 = addsS + 1, a1 = a0 + Math.max(0, adds.length - 1);
  const salesL = (D.it.sales || []).filter((s2) => s2.date <= (it.part ? D.period.to : "99999999")), sS = a1 + 4, s0 = sS + 1, s1 = s0 + Math.max(0, salesL.length - 1);
  const AR = (col) => "$" + col + "$" + a0 + ":$" + col + "$" + a1, SR = (col) => "$" + col + "$" + s0 + ":$" + col + "$" + s1;
  L.it = { b0, b1: b0 + bl.length - 1 };
  bl.forEach((z, i) => {
    const rr = b0 + i, P = (k) => ["depr", D.itP ? "itP" : "it", "blocks", i, k];
    put(T, "A" + rr, z.key); put(T, "B" + rr, z.rate, { nf: "0%" }); put(T, "C" + rr, N(z.open), Object.assign({ nf: NF2 }, IN));
    put(T, "D" + rr, { f: adds.length ? "SUMIFS(" + AR("D") + "," + AR("A") + ",$A" + rr + "," + AR("F") + ",0)" : "0", v: z.addA, src: P("addA") }, { nf: NF2 });
    put(T, "E" + rr, { f: adds.length ? "SUMIFS(" + AR("D") + "," + AR("A") + ",$A" + rr + "," + AR("F") + ",1)" : "0", v: z.addB, src: P("addB") }, { nf: NF2 });
    put(T, "F" + rr, { f: salesL.length ? "SUMIFS(" + SR("D") + "," + SR("A") + ",$A" + rr + ")" : "0", v: z.sale, src: P("sale") }, { nf: NF2 });
    put(T, "G" + rr, z.ceased ? 1 : 0, IN);
    put(T, "H" + rr, { f: "ROUND(C" + rr + "+D" + rr + "+E" + rr + "-F" + rr + ",2)", v: z.total, src: P("total") }, { nf: NF2 });
    put(T, "I" + rr, { f: "IF(H" + rr + "<0,-H" + rr + ",IF(G" + rr + "=1,-H" + rr + ",0))", v: z.stcg, src: P("stcg") }, { nf: NF2 });
    put(T, "J" + rr, { f: "IF(OR(H" + rr + "<0,G" + rr + "=1),0,ROUND((MAX(0,C" + rr + "+D" + rr + "-F" + rr + ")*B" + rr + "+MAX(0,E" + rr + "+MIN(0,C" + rr + "+D" + rr + "-F" + rr + "))*B" + rr + "/2)*$B$7,0))", v: z.dep, src: P("dep") }, { nf: NF0 });
    put(T, "K" + rr, { f: "IF(OR(H" + rr + "<0,G" + rr + "=1),0,ROUND(H" + rr + "-J" + rr + ",2))", v: z.close, src: P("close") }, { nf: NF2 });
    put(T, "L" + rr, z.srcLabel || "not known", { i: true, sz: 9 });
    put(T, "M" + rr, z.name, { i: true, sz: 9 });
  });
  const bt = b0 + bl.length; L.it.total = bt;
  put(T, "A" + bt, "Total", { b: true });
  ["C", "D", "E", "F", "H", "I", "J", "K"].forEach((col) => put(T, col + bt, { f: bl.length ? "SUM(" + col + b0 + ":" + col + (bt - 1) + ")" : "0", v: bl.reduce((s2, z) => s2 + N(z[{ C: "open", D: "addA", E: "addB", F: "sale", H: "total", I: "stcg", J: "dep", K: "close" }[col]]), 0) }, { b: true, top: true, nf: col === "J" ? NF0 : NF2 }));
  put(T, "A" + (addsS - 1), "Additions (from the register; the put-to-use date decides the rate)", { b: true });
  ["Block", "Asset", "Put to use", "Amount", "Days used in the year", "Under 180 days (1 = half the rate)"].forEach((h, i) => put(T, "ABCDEF"[i] + addsS, h, { b: true, sz: 9, box: true, wrap: true }));
  adds.forEach((x, i) => { const rr = a0 + i; put(T, "A" + rr, x.block); put(T, "B" + rr, x.name || ""); put(T, "C" + rr, serial(x.put), Object.assign({ nf: DATEF }, IN)); put(T, "D" + rr, N(x.amt), Object.assign({ nf: NF2 }, IN));
    put(T, "E" + rr, { f: "$B$5-C" + rr + "+1", v: x.days }); put(T, "F" + rr, { f: "IF(E" + rr + "<180,1,0)", v: x.half ? 1 : 0 }); });
  put(T, "A" + (sS - 1), "Sales (the consideration, from the day book)", { b: true });
  ["Block", "Asset", "Date", "Sale value"].forEach((h, i) => put(T, "ABCD"[i] + sS, h, { b: true, sz: 9, box: true }));
  salesL.forEach((x, i) => { const rr = s0 + i; put(T, "A" + rr, x.block); put(T, "B" + rr, x.name || ""); put(T, "C" + rr, serial(x.date), { nf: DATEF }); put(T, "D" + rr, N(x.value), Object.assign({ nf: NF2 }, IN)); });
  c.widths(T, { A: 9, B: 12, C: 15, D: 15, E: 15, F: 15, G: 10, H: 15, I: 15, J: 15, K: 15, L: 40, M: 50 });

  // ---- Deferred tax ----
  const X = "fddt", rg = c.IN.regime;
  head(X, "Deferred tax (AS 22) " + (D.period.full ? "as at " + G.FinDepr.DMY(ca.y1) : "as at " + G.FinDepr.DMY(D.period.to)));
  ["Timing difference", "", "Amount", "Deferred tax"].forEach((h, i) => put(X, "ABCD"[i] + "5", h, { b: true, box: true }));
  const depCls = Object.values(ca.classes).filter((x) => x.cls !== "land" && x.cfg.method !== "NONE").map((x) => A("ca", L.col.nC, L.cls[x.cls]));
  const RSf = (cds) => "ROUND(" + cds.map((cd) => "SUMIFS(" + c.TBc("F") + "," + c.TBc("G") + ',"' + cd + '")').join("+") + ",2)";
  const row = (rr, label, f, v, src, tax) => { put(X, "A" + rr, label); put(X, "C" + rr, f == null ? v : { f, v, src }, { nf: NF2 }); if (tax) put(X, "D" + rr, { f: "ROUND(C" + rr + "*$C$14/100,0)", v: Math.round(N(v) * dt.rate / 100) }, { nf: NF0 }); };
  const dr = (k) => dt.rows.find((z) => z.key === k) || { diff: 0 }, di = (k) => ["depr", "dt", "rows", dt.rows.findIndex((z) => z.key === k), "diff"];
  row(6, "Carrying amount of depreciable assets in the books (the register's net block)", depCls.length ? "ROUND(" + depCls.join("+") + ",2)" : "0", dr("dep").book);
  row(7, "Written down value for income tax (the blocks)", A("it", "K", L.it.total), dr("dep").tax);
  row(8, "Depreciation: books less tax", "ROUND(C6-C7,2)", dr("dep").diff, di("dep"), true);
  row(9, "Provision for gratuity (section 40A(7)): allowed when paid", RSf(["5A", "5E"]), dr("grat").diff, di("grat"), true);
  row(10, "Provision for leave encashment (section 43B(f)): allowed when paid", RSf(["5B", "5C"]), dr("leave").diff, di("leave"), true);
  row(11, "Dues to micro and small enterprises unpaid beyond the time allowed (section 43B(h))", null, dr("msme").diff, null, true); put(X, "C11", dr("msme").diff, Object.assign({ nf: NF2 }, IN));
  row(12, "Statutory dues unpaid by the due date (section 43B)", null, dr("stat").diff, null, true); put(X, "C12", dr("stat").diff, Object.assign({ nf: NF2 }, IN));
  row(13, "Net timing difference (a liability when positive)", "ROUND(C8+C9+C10+C11+C12,2)", dt.total, ["depr", "dt", "total"]);
  put(X, "A14", "Rate % (" + dt.rateWhy + ")");
  const rateF = dt.given ? null : "IF(" + rg + '="115BAA",25.168,IF(' + rg + '="normal",' + (dt.rate === 26 ? 26 : 31.2) + ",31.2))";
  put(X, "C14", rateF ? { f: rateF, v: dt.rate, src: ["depr", "dt", "rate"] } : dt.rate, Object.assign({ nf: "0.000" }, rateF ? {} : IN));
  put(X, "B14", "linked to Inputs: Tax regime", { i: true, sz: 9 });
  row(15, "Deferred tax liability / (asset) at the end", "ROUND(C13*C14/100,0)", dt.closing, ["depr", "dt", "closing"]);
  row(16, "Last year's: " + dt.openSrc, null, dt.open); put(X, "C16", dt.open, Object.assign({ nf: NF2 }, IN));
  row(17, "Movement: charge / (credit) to the profit and loss", "ROUND(C15-C16,2)", dt.move, ["depr", "dt", "move"]);
  row(18, "In the books before FinCom's rows: deferred tax liability", null, dt.booksL);
  row(19, "In the books before FinCom's rows: deferred tax asset", null, dt.booksA);
  row(20, "FinCom's row: deferred tax in the profit and loss (closing less the books')", "ROUND(C15-(C18-C19),2)", dt.adj, ["depr", "dt", "adj"]);
  L.dt = { closing: 15, booksL: 18, booksA: 19, adj: 20 };
  put(X, "A22", dt.mat, { i: true }); put(X, "A23", D.sources.dt, { i: true, sz: 9 });
  if (dt.partNote) put(X, "A24", dt.partNote, { i: true, sz: 9 });
  c.widths(X, { A: 80, B: 24, C: 18, D: 16 });
}

// ---- the PDF ----
function pdfDt(d, M, H, key) {
  const dt = d.depr && d.depr.dt; if (!dt || !d.depr.use.dt || key !== (dt.closing >= 0 ? "31" : "9")) return "";
  const R0 = (v) => M(v / d.inputs.unit);
  return '<div class="sub" data-fs-dtnote="">Deferred tax ' + (dt.closing >= 0 ? "liability" : "asset") + " (net): components</div><table><thead><tr><th>Particulars</th><th class=\"n\">Timing difference (Rs)</th><th class=\"n\">Deferred tax</th></tr></thead><tbody>" +
    dt.rows.filter((z) => z.diff).map((z) => "<tr><td>" + H(z.label) + '</td><td class="n">' + M(z.diff / d.inputs.unit) + '</td><td class="n">' + R0(z.dtax) + "</td></tr>").join("") +
    '<tr class="tot"><td>Deferred tax ' + (dt.closing >= 0 ? "liability" : "asset") + " (net) at " + H(dt.rate) + '%</td><td></td><td class="n">' + R0(Math.abs(dt.closing)) + "</td></tr>" +
    "<tr><td>Last year's (" + H(dt.openSrc) + ')</td><td></td><td class="n">' + R0(dt.open) + "</td></tr>" +
    '<tr class="tot"><td>' + (dt.move >= 0 ? "Charge" : "Credit") + ' to the statement of profit and loss</td><td></td><td class="n">' + R0(Math.abs(dt.move)) + "</td></tr></tbody></table>" +
    '<p style="font-size:9pt;margin:4px 0"><i>' + H(dt.mat) + "</i></p>";
}
function pdfPpe(d, H) {
  const ca = d.depr && d.depr.ca; if (!ca || !d.depr.use.ca) return "";
  const m = Object.values(ca.classes).filter((c) => c.cfg.method !== "NONE").map((c) => c.label + " " + (c.cfg.method === "SLM" ? "straight line" : "written down value") + ", " + c.cfg.life + " years").join("; ");
  return '<p style="font-size:9pt;margin:4px 0" data-fs-ppereg=""><i>Depreciation as per Schedule II to the Companies Act, 2013, pro rata from the date an asset is put to use (' + H(m) + "), residual value as stated; the fixed asset register is kept by FinCom.</i></p>";
}

export const FinDeprX = { ppeF, tbCell, itRef, sheets, pdfDt, pdfPpe, SHN };
G.FinDeprX = FinDeprX;
