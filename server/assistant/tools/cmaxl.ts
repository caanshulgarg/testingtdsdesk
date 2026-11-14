// CMA data, the bank-format Excel (ExcelJS, as files.ts and the certificates write theirs): Form I (particulars, the items
// still to be given as placeholders), Forms II-VI and the ratios with LIVE formulas (the engine's own, cmaengine.ts, each
// cell's cached result FinCom's figure), the Assumptions sheet whose cells drive the forms (the MPBF method II or I, the
// stock and receivables margins, the limit sought: change one and the forms follow), the Checks sheet (each check a live
// formula, beside FinCom's result), the differences between the audited figures and the earlier CMA, and the sources.
import ExcelJS from "npm:exceljs@4.4.0";
import { colLetter } from "../filetable.ts";
import { Cma, fyL, KIND_WORD, Row, rowOf, Sheet } from "./cmaengine.ts";

// the projections summary (cma.ts): the forms' columns it shows (A and C; B from the first year the user gave the
// profitability for) and each business vertical's share of the revenue in each of A's years (%)
export type Summary = { cols: number[], bCols: number[], verts: { name: string, share: number[] }[], notes?: string[] };
export type XlMeta = { client: string, firm: string, today: string, status: string, assumptions: string[], form1: [string, string][], sources: string[][], diffs: (string | number)[][], ties: (string | number)[][], summary?: Summary };

const AMT = '#,##,##0;[Red]-#,##,##0', DEC = "0.00", MO = "0.0";
// the Assumptions sheet's input cells (the forms' {M} {SM} {RM} {LIM})
const PARAM: Record<string, string> = { M: "Assumptions!$C$4", SM: "Assumptions!$C$5", RM: "Assumptions!$C$6", LIM: "Assumptions!$C$7" };
const FIRST = 7;   // the first row of a form's lines

export function excelFormula(f: string, sheetOf: (id: string) => Sheet, here: Sheet, col: number, rowAt: (sheet: Sheet, key: string) => number, qualify = false): string {
  return f.replace(/\[(?:(\w+):)?(\w+)(?:@-(\d))?\]/g, (_m, sh, key, back) => {
    const S = sh ? sheetOf(sh) : here, c = col - Number(back || 0);
    const ref = colLetter(1 + c) + rowAt(S, key);
    return S === here && !qualify ? ref : "'" + S.name + "'!" + ref;
  }).replace(/\{(\w+)\}/g, (_m, p) => PARAM[p]);
}

export async function cmaExcel(c: Cma, meta: XlMeta): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FinCom"; wb.created = new Date();
  const n = c.years.length;
  const rowNo = new Map<Sheet, Map<string, number>>();
  for (const s of c.sheets) rowNo.set(s, new Map(s.rows.map((r, i) => [r.key, FIRST + i])));
  const rowAt = (s: Sheet, key: string) => { const r = rowNo.get(s)!.get(key); if (!r) throw new Error("no row " + key + " in " + s.name); return r; };
  const sheetOf = (id: string) => c.sheets.find((s) => s.id === id)!;
  const grey = { argb: "FF5A6B63" };
  const head = (ws: ExcelJS.Worksheet, title: string) => {
    ws.getCell("A1").value = String(meta.client || "").toUpperCase(); ws.getCell("A1").font = { bold: true, size: 13 };
    ws.getCell("A2").value = title; ws.getCell("A2").font = { bold: true };
    ws.getCell("A3").value = "Amounts in rupees. Prepared by FinCom on " + meta.today + " for " + (meta.firm || "the firm") + "; not audited. " + meta.status;
    ws.getCell("A3").font = { italic: true, color: grey };
  };
  const sheet = (name: string) => wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 1, ySplit: 6 }] });

  // ---------------------------------------------------------------- Form I
  const f1 = wb.addWorksheet("Form I");
  head(f1, "FORM I - PARTICULARS OF THE EXISTING AND PROPOSED LIMITS");
  f1.getColumn(1).width = 58; f1.getColumn(2).width = 70;
  meta.form1.forEach(([k, v], i) => {
    const r = f1.getRow(5 + i); r.getCell(1).value = k; r.getCell(2).value = v;
    if (/^\[/.test(v)) r.getCell(2).font = { bold: true, color: { argb: "FFB45309" } };
    if (!v) r.getCell(1).font = { bold: true };
  });

  // ---------------------------------------------------------------- the projections summary (A, B, C), live on Form II
  if (meta.summary && meta.summary.cols.length) summarySheet(wb, c, meta, meta.summary, rowAt, sheetOf, head);

  // ---------------------------------------------------------------- Forms II-VI and the ratios
  for (const s of c.sheets) {
    const ws = sheet(s.name);
    head(ws, s.title);
    ws.getColumn(1).width = 78;
    for (let i = 0; i < n; i++) ws.getColumn(2 + i).width = 17;
    const hr = ws.getRow(5), kr = ws.getRow(6);
    hr.getCell(1).value = "Particulars"; kr.getCell(1).value = "";
    c.years.forEach((y, i) => { hr.getCell(2 + i).value = fyL(y.fy); kr.getCell(2 + i).value = KIND_WORD[y.kind] + (y.asOn ? " to " + y.asOn : ""); });
    hr.font = { bold: true }; kr.font = { italic: true, color: grey };
    for (const [i, r] of s.rows.entries()) {
      const row = ws.getRow(FIRST + i);
      row.getCell(1).value = r.label;
      if (r.fmt === "head") { row.getCell(1).font = { bold: true }; continue; }
      if (/^(\d+\.|Total|DSCR)/.test(r.label) && !r.input) row.getCell(1).font = { bold: /Total|total|Net worth|MPBF|permissible|profit after|surplus|gap/.test(r.label) };
      for (let k = 0; k < n; k++) {
        const cell = row.getCell(2 + k), v = r.vals[k];
        if (r.input) { if (v != null) cell.value = Math.round(v * 100) / 100; }
        else if (r.f && !((s.later || /@-1\]/.test(r.f)) && k === 0)) {
          const res = v == null ? "" : Math.round(v * 1e6) / 1e6;
          cell.value = { formula: excelFormula(r.f, sheetOf, s, k, rowAt), result: res } as ExcelJS.CellFormulaValue;
        }
        cell.numFmt = r.fmt === "amt" ? AMT : r.fmt === "mo" ? MO : DEC;
      }
    }
  }

  // ---------------------------------------------------------------- Assumptions (the cells that drive the forms)
  const as = wb.addWorksheet("Assumptions");
  head(as, "ASSUMPTIONS (change the yellow cells: the forms follow)");
  as.getColumn(1).width = 60; as.getColumn(2).width = 4; as.getColumn(3).width = 16; as.getColumn(4).width = 90;
  const inputs: [number, string, string | number | null, string, string][] = [
    [4, "MPBF method (II: Nayak/Tandon second method; I: first method)", c.opts.method, "@", "II is FinCom's default; type I for the first method."],
    [5, "Stock margin for drawing power", c.opts.stockMargin, "0%", "FinCom's default 25%."],
    [6, "Receivables margin for drawing power", c.opts.recMargin, "0%", "FinCom's default 25%."],
    [7, "Working capital limit sought (blank: not given; MPBF is used)", c.opts.limit, AMT, c.opts.limit == null ? "[To be given: the limit sought]" : "As you said."],
  ];
  for (const [r, label, v, fmt, note] of inputs) {
    const row = as.getRow(r);
    row.getCell(1).value = label;
    const cell = row.getCell(3);
    if (v != null) cell.value = v;
    cell.numFmt = fmt; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3B0" } };
    row.getCell(4).value = note;
  }
  as.getRow(9).getCell(1).value = "How each figure was made"; as.getRow(9).font = { bold: true };
  meta.assumptions.forEach((t, i) => { const row = as.getRow(10 + i); row.getCell(1).value = i + 1 + ". " + t; row.getCell(1).alignment = { wrapText: false }; });

  // ---------------------------------------------------------------- Checks (live)
  const ck = wb.addWorksheet("Checks");
  head(ck, "CHECKS (each a live formula; FALSE means the figures are not final)");
  ck.getColumn(1).width = 6; ck.getColumn(2).width = 82; ck.getColumn(3).width = 10; ck.getColumn(4).width = 12; ck.getColumn(5).width = 14; ck.getColumn(6).width = 18;
  const ch = ck.getRow(5);
  ["No.", "Check", "Year", "Live check", "FinCom", "Difference"].forEach((t, i) => { ch.getCell(i + 1).value = t; });
  ch.font = { bold: true };
  c.checks.forEach((x, i) => {
    const row = ck.getRow(6 + i), S = sheetOf(x.sheet);
    const a = excelFormula(x.fa, sheetOf, S, x.col, rowAt, true), b = x.fb ? excelFormula(x.fb, sheetOf, S, x.col, rowAt, true) : String(Math.round((x.b ?? 0) * 100) / 100);
    row.getCell(1).value = x.n; row.getCell(2).value = x.label; row.getCell(3).value = x.year;
    row.getCell(4).value = { formula: "ABS((" + a + ")-(" + b + "))<=" + x.tol, result: x.ok } as ExcelJS.CellFormulaValue;
    row.getCell(5).value = x.ok ? "OK" : "FAILS"; row.getCell(5).font = { bold: !x.ok, color: { argb: x.ok ? "FF15803D" : "FFB91C1C" } };
    row.getCell(6).value = Math.round(x.gap); row.getCell(6).numFmt = AMT;
  });
  const t0 = 8 + c.checks.length;
  if (meta.ties.length) {
    ck.getRow(t0).getCell(2).value = "The files' own totals against the lines FinCom placed (the mapping's check)"; ck.getRow(t0).font = { bold: true };
    const th = ck.getRow(t0 + 1);
    ["", "File, year and total", "", "In the file", "As placed", "Difference"].forEach((t, i) => { th.getCell(i + 1).value = t; });
    th.font = { bold: true };
    meta.ties.forEach((t, i) => { const row = ck.getRow(t0 + 2 + i); t.forEach((v, k) => { row.getCell(k + 1).value = v; if (typeof v === "number") row.getCell(k + 1).numFmt = AMT; }); });
  }

  // ---------------------------------------------------------------- the differences and the sources
  if (meta.diffs.length) {
    const d = wb.addWorksheet("Differences");
    head(d, "DIFFERENCES: THE AUDITED FIGURES (USED) AGAINST THE EARLIER CMA AND THE BOOKS");
    [12, 46, 20, 20, 20, 40].forEach((w, i) => { d.getColumn(i + 1).width = w; });
    const h = d.getRow(5); ["Year", "Line", "Used", "Other", "Difference", "Other source"].forEach((t, i) => { h.getCell(i + 1).value = t; }); h.font = { bold: true };
    meta.diffs.forEach((r, i) => { const row = d.getRow(6 + i); r.forEach((v, k) => { row.getCell(k + 1).value = v; }); row.getCell(5).value = { formula: "C" + (6 + i) + "-D" + (6 + i), result: Number(r[4]) || 0 } as ExcelJS.CellFormulaValue; [3, 4, 5].forEach((k) => { row.getCell(k).numFmt = AMT; }); });
  }
  const so = wb.addWorksheet("Sources");
  head(so, "WHERE EACH YEAR'S FIGURES CAME FROM");
  [12, 18, 90].forEach((w, i) => { so.getColumn(i + 1).width = w; });
  meta.sources.forEach((r, i) => { const row = so.getRow(5 + i); r.forEach((v, k) => { row.getCell(k + 1).value = v; }); if (i === 0) row.font = { bold: true }; });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
// a form as the chat shows it: amounts as numbers; percentages, ratios and months as their text
export function rowCells(r: Row, n: number): Record<string, unknown> {
  const o: Record<string, unknown> = { item: r.label };
  for (let k = 0; k < n; k++) {
    const v = r.vals[k];
    o["y" + k] = r.fmt === "head" || v == null ? null : r.fmt === "amt" ? Math.round(v) : r.fmt === "pct" ? (Math.round(v * 10) / 10).toFixed(1) + "%" : r.fmt === "mo" ? (Math.round(v * 10) / 10).toFixed(1) + " months" : (Math.round(v * 100) / 100).toFixed(2);
  }
  return o;
}

// the owner's layout in ₹ crore: each figure a formula on Form II's cells (its cached result FinCom's), so the summary is the
// forms' own; the verticals' shares are the yellow cells (change one and its amounts follow)
function summarySheet(wb: ExcelJS.Workbook, c: Cma, meta: XlMeta, S: Summary, rowAt: (s: Sheet, key: string) => number, sheetOf: (id: string) => Sheet, head: (ws: ExcelJS.Worksheet, title: string) => void) {
  const ws = wb.addWorksheet("Projections summary", { views: [{ state: "frozen", xSplit: 1, ySplit: 0 }] });
  head(ws, "PROJECTIONS SUMMARY");
  ws.getCell("A3").value = "₹ crore, worked from Form II (so every figure agrees with the forms). Prepared by FinCom on " + meta.today + " for " + (meta.firm || "the firm") + "; not audited. " + meta.status;
  ws.getColumn(1).width = 46;
  for (let k = 0; k < Math.max(S.cols.length, S.bCols.length) + 1; k++) ws.getColumn(2 + k).width = 15;
  const F2 = sheetOf("II"), II = (key: string, i: number) => "'Form II'!" + colLetter(1 + i) + rowAt(F2, key);
  const val = (key: string, i: number) => rowOf(c, "II", key).vals[i] ?? 0;
  const CR = 1e7, D2 = "0.00", P1 = "0.0%";
  const fx = (formula: string, result: number | string) => ({ formula, result: typeof result === "number" ? Math.round(result * 1e8) / 1e8 : result }) as ExcelJS.CellFormulaValue;
  const yl = (i: number) => "FY " + fyL(c.years[i].fy) + (c.years[i].kind === "estimate" ? " (estimate)" : "");
  let r = 5;
  // A. revenue by year and its growth
  ws.getRow(r).getCell(1).value = "A. REVENUE GROWTH PROJECTION"; ws.getRow(r).font = { bold: true }; r++;
  ["Financial year", "Revenue (₹ Cr)", "Annual growth"].forEach((t, k) => { ws.getRow(r).getCell(1 + k).value = t; }); ws.getRow(r).font = { bold: true }; r++;
  for (const i of S.cols) {
    const row = ws.getRow(r++), rev = val("sales", i), prev = i > 0 ? val("sales", i - 1) : 0;
    row.getCell(1).value = yl(i);
    row.getCell(2).value = fx(II("sales", i) + "/" + CR, rev / CR); row.getCell(2).numFmt = D2;
    if (i > 0) { row.getCell(3).value = fx("IF(" + II("sales", i - 1) + "=0,\"\"," + II("sales", i) + "/" + II("sales", i - 1) + "-1)", prev ? rev / prev - 1 : ""); row.getCell(3).numFmt = P1; }
  }
  r++;
  // B. the profitability, years as columns
  ws.getRow(r).getCell(1).value = "B. PROFITABILITY PROJECTIONS"; ws.getRow(r).font = { bold: true }; r++;
  ws.getRow(r).getCell(1).value = "Particulars"; S.bCols.forEach((i, k) => { ws.getRow(r).getCell(2 + k).value = "FY" + fyL(c.years[i].fy).slice(2); }); ws.getRow(r).font = { bold: true }; r++;
  const at: Record<string, number> = {};
  const oth = S.bCols.some((i) => Math.abs(val("oth", i) - val("nox", i)) >= 1);
  const lines: [string, string, (i: number, k: number) => [string, number | string], string][] = [
    ["rev", "Revenue", (i) => [II("sales", i) + "/" + CR, val("sales", i) / CR], D2],
    ["gp", "Gross profit (revenue less materials and goods, net of the stock change)", (i) => ["(" + II("sales", i) + "-" + II("mat", i) + "-" + II("chg", i) + ")/" + CR, (val("sales", i) - val("mat", i) - val("chg", i)) / CR], D2],
    ["gm", "Gross margin", (i, k) => { const L = colLetter(1 + k); const rv = val("sales", i); return ["IF(" + L + at.rev + "=0,\"\"," + L + at.gp + "/" + L + at.rev + ")", rv ? (rv - val("mat", i) - val("chg", i)) / rv : ""]; }, P1],
    ["eb", "EBITDA", (i) => ["(" + II("opbi", i) + "+" + II("dep", i) + ")/" + CR, (val("opbi", i) + val("dep", i)) / CR], D2],
    ["em", "EBITDA margin", (i, k) => { const L = colLetter(1 + k); const rv = val("sales", i); return ["IF(" + L + at.rev + "=0,\"\"," + L + at.eb + "/" + L + at.rev + ")", rv ? (val("opbi", i) + val("dep", i)) / rv : ""]; }, P1],
    ["dep", "Depreciation", (i) => [II("dep", i) + "/" + CR, val("dep", i) / CR], D2],
    ["int", "Interest", (i) => [II("int", i) + "/" + CR, val("int", i) / CR], D2],
    ...(oth ? [["oth", "Other income less exceptional items", (i: number) => ["(" + II("oth", i) + "-" + II("nox", i) + ")/" + CR, (val("oth", i) - val("nox", i)) / CR], D2] as [string, string, (i: number, k: number) => [string, number | string], string]] : []),
    ["pbt", "Profit before tax", (i) => [II("pbt", i) + "/" + CR, val("pbt", i) / CR], D2],
    ["tax", "Tax", (i) => [II("tax", i) + "/" + CR, val("tax", i) / CR], D2],
    ["pat", "Profit after tax", (i) => [II("pat", i) + "/" + CR, val("pat", i) / CR], D2],
    ["chk", "Check: EBITDA - depreciation - interest" + (oth ? " + other income" : "") + " - profit before tax (nil)", (_i, k) => { const L = colLetter(1 + k); return ["ROUND(" + L + at.eb + "-" + L + at.dep + "-" + L + at.int + (oth ? "+" + L + at.oth : "") + "-" + L + at.pbt + ",4)", 0]; }, D2],
  ];
  for (const [key, label, f, fmt] of lines) {
    at[key] = r;
    const row = ws.getRow(r++);
    row.getCell(1).value = label;
    if (key === "pat" || key === "pbt" || key === "eb") row.getCell(1).font = { bold: true };
    if (key === "chk") row.getCell(1).font = { italic: true, color: { argb: "FF5A6B63" } };
    S.bCols.forEach((i, k) => { const [form, res] = f(i, k); const cell = row.getCell(2 + k); cell.value = fx(form, res); cell.numFmt = fmt; });
  }
  r++;
  // C. the revenue by business vertical: each share a yellow cell, its amount the share of Form II's revenue
  if (S.verts.length) {
    ws.getRow(r).getCell(1).value = "C. REVENUE CONTRIBUTION BY BUSINESS VERTICAL"; ws.getRow(r).font = { bold: true }; r++;
    const hdr = (t: string) => { ws.getRow(r).getCell(1).value = t; S.cols.forEach((i, k) => { ws.getRow(r).getCell(2 + k).value = "FY" + fyL(c.years[i].fy).slice(2); }); ws.getRow(r).font = { bold: true }; r++; };
    hdr("Share of revenue");
    const shareRow: number[] = [];
    for (const v of S.verts) {
      shareRow.push(r);
      const row = ws.getRow(r++);
      row.getCell(1).value = v.name;
      S.cols.forEach((_i, k) => { const cell = row.getCell(2 + k); cell.value = Math.round(v.share[k] * 1e6) / 1e8; cell.numFmt = P1; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3B0" } }; });
    }
    const tot = ws.getRow(r++);
    tot.getCell(1).value = "Total"; tot.font = { bold: true };
    S.cols.forEach((_i, k) => { const L = colLetter(1 + k); tot.getCell(2 + k).value = fx(shareRow.map((x) => L + x).join("+"), S.verts.reduce((t, v) => t + Math.round(v.share[k] * 1e6) / 1e8, 0)); tot.getCell(2 + k).numFmt = P1; });
    r++;
    hdr("Revenue (₹ Cr)");
    const amtRow: number[] = [];
    S.verts.forEach((v, n) => {
      amtRow.push(r);
      const row = ws.getRow(r++);
      row.getCell(1).value = v.name;
      S.cols.forEach((i, k) => { const L = colLetter(1 + k); row.getCell(2 + k).value = fx(L + shareRow[n] + "*" + II("sales", i) + "/" + CR, Math.round(v.share[k] * 1e6) / 1e8 * val("sales", i) / CR); row.getCell(2 + k).numFmt = D2; });
    });
    const ta = ws.getRow(r++);
    ta.getCell(1).value = "Total (the revenue)"; ta.font = { bold: true };
    S.cols.forEach((i, k) => { const L = colLetter(1 + k); ta.getCell(2 + k).value = fx(amtRow.map((x) => L + x).join("+"), S.verts.reduce((t, v) => t + Math.round(v.share[k] * 1e6) / 1e8 * val("sales", i) / CR, 0)); ta.getCell(2 + k).numFmt = D2; });
  }
}
