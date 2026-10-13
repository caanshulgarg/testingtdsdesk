// node run_reports_fs.js - Step 3: the Schedule III statements in the firm's format (src/js/78-reports.js, FSX), on a
// made-up company and a made-up firm (tests/reports_fixtures.js). Test data only: every name and figure is invented.
//   1. the mapping: suggested by rule for every ledger, confirmed once (version 1), reused, a new ledger flagged, an edit
//      pending until confirmed again (version 2)
//   2. the trial balance ties to the statements; the balance sheet balances, this year and last
//   3. every note's Total equals its line on the face; the previous year equals the openings
//   4. the exact note order and titles of the spec (Sample B: 32 notes; Sample A: 27 notes)
//   5. the 27 checks pass on the clean books
//   6. numbering follows the lines printed, and every cross-reference follows the new numbers
//   7. units: whole rupees, Indian grouping, brackets, "-"; the header on every page, "n / N" in the footer
//   8. the signature blocks; the policies by entity type; the partners' accounts; the income-tax blocks
//   9. ratios: all 11 for a company, NP and GP for a firm; a variance over 25% needs its explanation
//  10. the cash flow statement behind its switch, and it ties to cash and cash equivalents
//  11. Excel: every figure on the statements is a formula; Word: a footer "PAGE / NUMPAGES", a landscape PPE section
//  12. the provisional TB export with the columns chosen
const F = require("./reports_fixtures"), X = F.loadFSX(), fs = require("fs"), path = require("path"), zlib = require("zlib");
let fails = 0; const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const OUT = process.env.TDSDESK_OUT || path.join(__dirname, "out"); fs.mkdirSync(OUT, {recursive: true});
const unzip = (buf) => { const out = {}; let i = 0; const b = Buffer.from(buf);
  while (b.readUInt32LE(i) === 0x04034b50){ const n = b.readUInt16LE(i + 26), e = b.readUInt16LE(i + 28), sz = b.readUInt32LE(i + 18), name = b.slice(i + 30, i + 30 + n).toString(); out[name] = b.slice(i + 30 + n + e, i + 30 + n + e + sz).toString(); i += 30 + n + e + sz; } return out; };
const run = (fx, o) => X.run(Object.assign({}, fx, {mapStore: F.confirmed(X, fx)}, o || {}), {files: ["xlsx", "docx", "html", "tb"]});

for (const which of ["company", "firm"]){
  console.log("\n== " + which);
  const fx = F[which](), co = which === "company";
  // 1. the mapping
  const m0 = X.mapping({versions: []}, fx.tb, fx.entity.kind);
  ok(m0.unplaced.length === 0 && Object.values(m0.map).every(m => m.line && m.by === "rule"), "1. every ledger placed by rule from its group (" + fx.tb.length + " ledgers)");
  let st = X.confirm({versions: []}, m0.map, "owner", "2026-10-13");
  ok(st.versions.length === 1 && st.versions[0].v === 1, "1. the owner confirms once: version 1");
  const m1 = X.mapping(st, fx.tb.concat([{l: "Courier Charges", g: ["Indirect Expenses"], o: 0, d: 500, c: 0}]), fx.entity.kind);
  ok(m1.confirmed && m1.fresh.length === 1 && m1.fresh[0] === "Courier Charges", "1. reused next year; a new ledger is flagged");
  st = X.editMap(st, "Rent", "exp", "Rent", fx.entity.kind);
  const m2 = X.mapping(st, fx.tb, fx.entity.kind);
  ok(m2.map.Rent && m2.map.Rent.pending && m2.map.Rent.by === "owner", "1. an edit by the owner is pending until confirmed");
  st = X.confirm(st, m2.map, "owner", "2026-10-14");
  ok(st.versions.length === 2 && st.versions[1].map.Rent.by === "owner" && st.versions[0].map.Rent.by === "rule", "1. confirmed again: version 2, version 1 kept");

  const r = run(fx), M = r.model, V = n => M.nm[n] || 0;
  fs.writeFileSync(path.join(OUT, "reports-" + which + ".xlsx"), r.files.xlsx); fs.writeFileSync(path.join(OUT, "reports-" + which + ".docx"), r.files.docx); fs.writeFileSync(path.join(OUT, "reports-" + which + ".html"), r.files.html);
  // 2. the TB ties
  const sumP = f => fx.tb.reduce((a, t) => a + Math.round(f(t) * 100), 0);
  ok(sumP(t => t.o) === 0 && sumP(t => t.d) === sumP(t => t.c), "2. the trial balance agrees (openings nil, debits = credits)");
  ok(V("T_el_CY") === V("T_as_CY") && V("T_el_PY") === V("T_as_PY") && V("T_as_CY") > 0, "2. the balance sheet balances: " + X.money(V("T_as_CY")) + " / last year " + X.money(V("T_as_PY")));
  // the face is the TB: each line is the sum of its ledgers' closing balances (rounded to the rupee); the profit is the P&L ledgers
  const lineSum = (k, y) => { const s = M.L.filter(x => x.line === k).reduce((a, x) => a + (y === "CY" ? x.cy : x.py), 0); return X.R0((X.line(k).side === "L" || X.line(k).side === "I" ? -1 : 1) * s); };
  const plain = ["ltb", "stb", "tp", "ocl", "stp", "ppe", "nci", "dta", "ltla", "tr", "cash", "stla", "oca", "rev", "oth", "emp", "fin", "dep", "exp", "pur"].filter(k => M.L.some(x => x.line === k));
  ok(plain.every(k => V("L_" + k + "_CY") === lineSum(k, "CY") && V("L_" + k + "_PY") === lineSum(k, "PY")), "2. every line is its ledgers in the TB (" + plain.length + " lines, both years)");
  const plProfit = -M.L.filter(x => x.pl).reduce((a, x) => a + x.cy, 0), stockEff = X.SUBS.inv.reduce((a, k) => a + M.stockCls[k].close.v - M.stockCls[k].open.v - M.stockCls[k].ledMove.v, 0);
  ok(Math.abs(V("T_pat_CY") - (plProfit + stockEff)) <= 1500, "2. the profit is the P&L ledgers with the change in stock (" + X.money(V("T_pat_CY")) + "; rounding within the lines)");
  ok(Math.abs(M.res.CY.round.v) <= 500 && Math.abs(M.res.PY.round.v) <= 500, "2. rounding off within a few rupees (" + M.res.CY.round.v / 100 + ", " + M.res.PY.round.v / 100 + ")");
  // 3. each note's total = its line; the previous year = the openings
  const c3 = r.checks.find(c => c.id === 3), c5 = r.checks.find(c => c.id === 5);
  ok(c3.ok, "3. every note's Total equals its line on the face, both years" + (c3.ok ? "" : ": " + c3.items[0]));
  const noteTotals = M.notes.filter(n => n.print && n.lines.length && !["ppe", "capital", "current"].includes(n.key) && n.tables[0]).map(n => [n, n.tables[0].rows.find(z => z.k === "t")]).filter(([, t]) => t);
  ok(noteTotals.length >= (co ? 20 : 15) && noteTotals.every(([n, t]) => t.c[0].v === n.lines.reduce((a, k) => a + V("L_" + k + "_CY"), 0) && t.c[1].v === n.lines.reduce((a, k) => a + V("L_" + k + "_PY"), 0)), "3. " + noteTotals.length + " notes' totals read directly against the face");
  const simple = M.L.filter(x => !x.pl && x.hasPy && !["inv", "capital", "current"].includes(x.line) && !(x.line === "reserves" && x.sub === "Surplus"));
  ok(c5.ok && simple.every(x => x.po + x.pd - x.pc === x.o), "3. the previous year's closing of every balance equals this year's opening (" + simple.length + " ledgers; stock, surplus and partners with last year's profit)");
  ok(plain.filter(k => !X.isPL(k)).every(k => V("L_" + k + "_PY") === X.R0((X.line(k).side === "L" ? -1 : 1) * M.L.filter(x => x.line === k).reduce((a, x) => a + x.o, 0))), "3. the previous-year column of the balance sheet equals the openings of the year");
  // 4. the note order and titles
  const titles = M.notes.filter(n => n.print).map(n => n.title), want = co ? F.SPEC_COMPANY : F.SPEC_FIRM;
  ok(JSON.stringify(titles) === JSON.stringify(want), "4. the exact note order and titles of the spec (" + titles.length + " notes)" + (JSON.stringify(titles) === JSON.stringify(want) ? "" : "\n     got  " + titles.join(" | ") + "\n     want " + want.join(" | ")));
  ok(M.notes.filter(n => n.print).every((n, i) => n.no === i + 1), "4. numbered 1.." + titles.length + " with no gap");
  if (!co){ const rs = M.notes.find(n => n.key === "reserves"); ok(rs && rs.print && rs.nil && !M.face2.bs.some(z => z.note === "reserves"), "4. the firm's Reserves and Surplus: printed, nil, not on the face (Sample A skips 5)");
    ok(M.face2.bs.some(z => z.t === "General Information" && z.note === "gi") && M.face2.bs.some(z => z.t === "Significant Accounting Policies"), "4. below the TOTAL: General Information 1 and Significant Accounting Policies 2"); }
  // 5. the checks
  const failed = r.checks.filter(c => !c.ok);
  ok(r.checks.length === 27 && failed.length === 0, "5. all 27 checks pass on the clean books" + (failed.length ? ": " + failed.map(c => c.id + " " + c.items[0]).join("; ") : ""));
  // 6. renumbering: a line that goes nil takes its note out, the later notes move up, the references follow
  if (co){
    const fx2 = F.company(); fx2.tb = fx2.tb.map(t => t.l === "Security Deposit - Tender" ? Object.assign({}, t, {o: 0, po: 0}) : t.l === "Cash" ? Object.assign({}, t, {o: t.o + 30000, po: t.po + 30000}) : t);
    fx2.det = JSON.parse(JSON.stringify(fx2.det)); fx2.det.ari = {rpLoans: {yes: true, text: "Repayable on demand."}};
    const r2 = run(fx2), M2 = r2.model, t2 = M2.notes.filter(n => n.print).map(n => n.title);
    ok(!t2.includes("Other Current Assets") && t2.length === 31 && M2.noteNo.rev === 18 && M2.noteNo.stla === 17, "6. Other Current Assets nil: 31 notes, Revenue becomes Note 18");
    const ari = M2.notes.find(n => n.key === "ari"), p = ari.paras.find(z => z.ari === "rpLoans");
    ok(/Refer Note 17\./.test(X.resolveRefs(p.x, M2)) && M2.face2.pl.find(z => z.t === "Revenue from Operations").note === "rev" && /<td class="nn">18<\/td>/.test(X.html(M2).split("Revenue from Operations")[1].slice(0, 40)), "6. the face and the text follow the new numbers (Refer Note 17; Revenue 18)");
    ok(r2.checks.find(c => c.id === 18).ok && r2.checks.find(c => c.id === 19).ok, "6. checks 18 and 19 pass after renumbering");
  }
  // 7. units, header, footer
  ok(X.money(-12345678900) === "(12,34,56,789)" && X.money(0) === "-" && X.money(123456789) === "12,34,568" && X.money(99) === "1" && X.money(-50) === "(1)", "7. whole rupees, Indian grouping, brackets, \"-\" for nil, half away from zero");
  const html = r.files.html, pages = html.split('<section class="pg').length - 1;
  ok(pages === M.pages.length && html.split('<div class="hd">').length - 1 === pages, "7. a header on every page (" + pages + " page groups)");
  ok(/@bottom-right\{content:counter\(page\) ' \/ ' counter\(pages\)/.test(html), "7. the footer is \"n / N\"");
  ok((html.match(/\(All amounts in ₹, unless otherwise stated\)/g) || []).length === pages, "7. the units line on every page");
  ok(html.includes(co ? "CIN : U12345MH2015PTC123456" : "PAN : AAFFH1234H") && html.includes(co ? "UDYAM-MH-00-0000000" : "HERON TRADERS"), "7. the statement pages carry the identity line");
  // 8. signatures, policies, partners, blocks
  const S = X.signLines(M);
  ok(S.left.includes("UDIN : " + fx.det.sign.auditor.udin) && S.left.includes("Firm Regn No : 123456W") && S.left.includes("Membership No : 234567") && S.left.some(l => /^Date : /.test(l)) && S.left.some(l => /^Place : /.test(l)), "8. the auditor: FRN, M.No, UDIN, Place, Date");
  if (co) ok(S.right[0] === "For and on behalf of Board of Directors" && S.right.includes("DIN : 01234567") && S.right.includes("DIN : 07654321"), "8. company: For and on behalf of Board of Directors, with DIN");
  else ok(S.right[0] === "For HERON TRADERS & CO." && S.right.includes("PAN : ABCPM1234A") && S.right.filter(l => l === "PARTNER").length === 2 && !S.right.some(l => /Board/.test(l)), "8. firm: For <firm>, partners with PAN");
  ok((html.match(/As per our report of even date attached/g) || []).length === 3, "8. the signature block on the balance sheet, the P&L and the last note");
  const pol = M.notes.find(n => n.key === "sap").paras.map(p => p.x).join(" ");
  if (co) ok(/Schedule II/.test(pol) && /Minimum Alternate Tax/.test(pol) && !/Level IV/.test(pol) && /2\.13 Earnings per Share/.test(pol), "8. the company's policies: Schedule II rates, MAT, deferred tax, EPS (2.1 to 2.13)");
  else ok(/Income-tax Act/.test(pol) && /50% of the rate/.test(pol) && /Level IV/.test(pol) && !/the Company|Proprietor/.test(pol) && /The Firm|the Firm/.test(pol), "8. the firm's policies: income-tax rates with the 180-day half rate, Level IV, the Firm's wording");
  if (!co){
    const cap = M.notes.find(n => n.key === "capital"), cur = M.notes.find(n => n.key === "current");
    ok(cap.tables[0].cols.map(c => c.h).join("|") === "Name of Partner|Share (%)|Opening Balance|Capital Introduced|Remuneration|Interest|Withdrawal|Profit/Loss|Closing Balance", "8. the partners' notes: the 9 columns of Sample A");
    ok(cur.tables[0].rows.map(z => z.t).join("|") === "Asha Menon|Ravi Desai|Current Year|Previous Year", "8. one row per partner, a Current Year and a Previous Year row");
    const prof = cur.tables[0].rows.slice(0, 2).map(z => z.c[6].v);
    ok(prof[0] + prof[1] === V("T_pat_CY") && prof[0] === X.R0(V("T_pat_CY") * 0.6), "8. the profit shared 60:40: " + prof.map(X.money).join(" + ") + " = " + X.money(V("T_pat_CY")));
    ok(cur.tables[0].rows[0].c[5].v < 0, "8. withdrawals in brackets");
    const it = M.notes.find(n => n.key === "ppe");
    ok(it.itBlock && it.tables[0].rows[1].c[6].v === 3400000 && it.tables[0].rows.find(z => z.t === "Current Year Total").c[9].v === V("L_ppe_CY"), "8. the income-tax blocks: computers at 40% with half on additions under 180 days (34,000), closing WDV = the face");
    const ox = M.notes.find(n => n.key === "exp");
    ok(ox.tables[0].rows.filter(z => z.k === "h").map(z => z.t).every(h => X.EXP_GROUPS.includes(h)) && ox.tables[1] && ox.tables[1].title === "Auditor's Remuneration includes", "8. other expenses under the firm's sub-heads, with the auditor's remuneration box");
  } else {
    const ppe = M.notes.find(n => n.key === "ppe");
    ok(ppe.landscape && ppe.tables.length === 2 && ppe.tables[0].bands.map(b => b[0]).join("|") === "|Gross Block|Depreciation and Amortisation|Net Book Value", "8. PPE: landscape, current and previous period, the gross block / depreciation / net book value bands");
    const sh = M.notes.find(n => n.key === "share");
    ok(sh.tables[1].rows[3].c[0].v === 120000 && sh.tables[1].rows[1].c[0].v === 20000 && sh.tables[3].cols.slice(-1)[0].h === "% Change during the year", "8. share capital: the reconciliation (20,000 issued; 1,20,000 at the end) and the promoters with % change");
  }
  // 9. ratios
  ok(M.ratioList.length === (co ? 11 : 2) && (co || M.ratioList.map(z => z.key).join() === "np,gp"), "9. ratios: " + M.ratioList.map(z => z.key).join(", "));
  const big = M.ratioList.filter(z => z.needs);
  ok(big.every(z => z.reason) && M.notes.find(n => n.key === "ratios").tables[0].cols.slice(-1)[0].h === "Reason for variance above 25%", "9. " + big.length + " ratios vary by more than 25%; each has its explanation, in its own column");
  // 10. cash flow behind its switch
  ok(!M.cf, "10. no cash flow statement by default (small company / non-corporate)");
  const rc = run(fx, {opts: {cashflow: true}}), Mc = rc.model;
  ok(Mc.cf && Mc.cf.diff === 0 && Mc.pages[2].kind === "cf", "10. switched on: AS-3 indirect method, after the P&L, and it ties to cash and cash equivalents (difference " + (Mc.cf ? Mc.cf.diff : "-") + ")");
  ok(rc.checks.filter(c => !c.ok).length === 0, "10. the checks still pass with the cash flow");
  // 11. Excel and Word
  const z = unzip(r.files.xlsx), wbx = z["xl/workbook.xml"], sheets = [...wbx.matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  const sx = name => z["xl/worksheets/sheet" + (sheets.indexOf(name) + 1) + ".xml"];
  const numCells = s => [...s.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*)>(.*?)<\/c>/g)].filter(m => !/t="s"/.test(m[3]) && /<v>/.test(m[4]) && !/^A$/.test(m[1]));
  const faceNum = ["Balance Sheet", "Profit and Loss", "Notes"].map(sx).flatMap(numCells), noF = faceNum.filter(m => !/<f>/.test(m[4]));
  ok(faceNum.length > (co ? 400 : 250) && noF.length === 0, "11. Excel: every one of " + faceNum.length + " figures on the statements and notes is a live formula" + (noF.length ? " (" + noF.length + " are not, e.g. " + noF.slice(0, 3).map(m => m[1] + m[2]).join(", ") + ")" : ""));
  ok(/TB_CY/.test(wbx) && /SUMIFS\(TB_CY,TB_LINE/.test(sx("Balance Sheet")), "11. the face goes back to the TB sheet (SUMIFS over TB_CY by line)");
  const d = unzip(r.files.docx);
  ok(/PAGE/.test(d["word/footer1.xml"]) && /NUMPAGES/.test(d["word/footer1.xml"]) && / \/ /.test(d["word/footer1.xml"]), "11. Word: the footer is PAGE / NUMPAGES");
  ok(/w:orient="landscape"/.test(d["word/document.xml"]) && Object.keys(d).filter(k => /^word\/header\d+\.xml$/.test(k)).length === M.pages.length, "11. Word: a landscape section for the fixed-asset note, a header for every page group");
  // 12. the TB export
  const tbx = unzip(X.tbExport(M, ["ledger", "primary", "parent", "opDr", "opCr", "dr", "cr", "clDr", "clCr", "pyClosing"]));
  ok(/Ledger Name/.test(tbx["xl/sharedStrings.xml"]) && /Tally Group \(Primary\)/.test(tbx["xl/sharedStrings.xml"]) && /Basic details/.test(tbx["xl/workbook.xml"]), "12. the provisional TB: the chosen columns, and the basic details sheet");
  const csv = X.tbExport(M, ["ledger", "closing", "line"], {csv: true}).split("\r\n");
  ok(csv[0] === '"Ledger Name","Closing (Dr +, Cr -)","Schedule III line"' && csv.length === M.L.length + 2 && Math.abs(Number(csv[csv.length - 1].split(",")[1])) < 0.005, "12. other columns on request (CSV); the closing column adds to nil");
}
console.log("\n" + (fails ? fails + " FAILED" : "all passed")); process.exit(fails ? 1 : 0);
