// The files FinCom Assistant makes on request: xlsx, docx and pdf. Tables come only from the book tools (the caller runs
// the tool again and passes its result); text may be the AI's own (a letter, a draft reply), and the file then says so.
// Every file ends with where its figures came from: "Figures from FinCom's books as of <time>".
import ExcelJS from "npm:exceljs@4.4.0";
import { AlignmentType, BorderStyle, Document, Footer, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "npm:docx@9.7.2";
import { PDFDocument, PDFFont, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

export type Col = { k: string, label: string, t?: string };
// fromFile: the table was copied from the user's own sheet (filetable.ts), not computed from the books: no automatic totals
// (the file's own total rows are copied, marked __b; a sum FinCom adds is a row marked __sum; a group heading is __h) and
// the note under it says where the figures came from
export type TableData = { title?: string, columns: Col[], rows: Record<string, unknown>[], basis?: string, fromFile?: string, note?: string };
export type Section = { heading?: string | null, text?: string | null, table?: TableData | null };
export type DocSpec = {
  format: "xlsx" | "docx" | "pdf", title: string, client: string, firm: { name: string, lines: string[] },
  sections: Section[], asOf: string, aiText: boolean, draft: boolean,
};

export const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  zip: "application/zip",
};

// 1,23,45,678.90
export function inr(n: unknown): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!isFinite(v)) return "";
  const neg = v < 0, [i, d] = Math.abs(v).toFixed(2).split(".");
  const last3 = i.slice(-3), rest = i.slice(0, -3);
  return (neg ? "-" : "") + (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last3 + "." + d;
}
const isNum = (t?: string) => t === "amount" || t === "int" || t === "pct";
const dmy = (v: unknown) => { const s = String(v ?? ""); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(8, 10) + "-" + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(s.slice(5, 7)) - 1] + "-" + s.slice(0, 4) : s; };
const cellText = (c: Col, v: unknown) => v == null ? "" : c.t === "amount" ? (isFinite(Number(v)) && v !== "" ? inr(v) : String(v)) : c.t === "date" ? dmy(v) : c.t === "pct" ? (typeof v === "number" ? String(v) + "%" : String(v)) : String(v);
// a file whose tables all come from the user's own sheet does not say its figures are FinCom's books'
const onlyFromFiles = (d: DocSpec) => d.sections.some((s) => s.table) && d.sections.every((s) => !s.table || !!s.table.fromFile);
export const footerLines = (d: DocSpec) => [onlyFromFiles(d) ? "Made by FinCom on " + d.asOf + "; figures as in your file, not checked against the books." : "Figures from FinCom's books as of " + d.asOf + ".", ...(d.aiText ? ["AI-drafted text, review before use."] : [])];
// a row of a file table: a group heading, a total row (the file's own, or a sum FinCom added), or a plain row
const isHead = (r: Record<string, unknown>) => typeof r.__h === "string";
const isBold = (r: Record<string, unknown>) => !!(r.__b || r.__sum || r.__h);
export const safeName = (s: string) => String(s || "FinCom").replace(/[^A-Za-z0-9 ._-]+/g, " ").replace(/\s+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "FinCom";

// ---------------------------------------------------------------- xlsx
export async function makeXlsx(d: DocSpec): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "FinCom"; wb.created = new Date();
  const tables = d.sections.filter((s) => s.table);
  const texts = d.sections.filter((s) => s.text);
  const used = new Set<string>();
  const sheetName = (s: string) => { let n = s.replace(/[\\/?*[\]:]/g, " ").slice(0, 28).trim() || "Sheet"; let k = n, i = 2; while (used.has(k.toLowerCase())) k = n.slice(0, 25) + " " + i++; used.add(k.toLowerCase()); return k; };
  for (const s of tables) {
    const t = s.table as TableData;
    const ws = wb.addWorksheet(sheetName(s.heading || t.title || d.title));
    ws.addRow([s.heading || t.title || d.title]).font = { bold: true, size: 13 };
    ws.addRow([d.client + (t.basis ? " · " + t.basis : "")]).font = { italic: true, color: { argb: "FF5A6B63" } };
    ws.addRow([]);
    const head = ws.addRow(t.columns.map((c) => c.label || c.k));
    head.font = { bold: true }; head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEF3F0" } }; c.border = { bottom: { style: "thin" } }; });
    const first = ws.rowCount + 1;
    // a file table's total rows: a sum FinCom added is a formula over the copied rows; the file's own total is a formula
    // only where it equals the sum of the rows above it (since the last total or heading), else its value as in the file
    let since: number[] = [];
    const dataAt: number[] = [];
    const ranges = (rs: number[], L: string) => { const out: string[] = []; let a = -1, b = -1; for (const x of rs) { if (x === b + 1) b = x; else { if (a > 0) out.push(a === b ? L + a : L + a + ":" + L + b); a = b = x; } } if (a > 0) out.push(a === b ? L + a : L + a + ":" + L + b); return out.join(","); };
    for (const r of t.rows) {
      if (isHead(r)) { ws.addRow([String(r.__h)]).font = { bold: true }; since = []; continue; }
      const row = ws.addRow(t.columns.map((c) => {
        const v = r[c.k];
        if (v == null || v === "") return null;
        if (isNum(c.t)) { const n = typeof v === "number" ? v : Number(v); return isFinite(n) ? n : String(v); }
        if (c.t === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) return new Date(String(v) + "T00:00:00Z");
        return String(v);
      }));
      if (t.fromFile && (r.__b || r.__sum)) {
        row.font = { bold: true };
        const over = r.__sum ? dataAt : since;
        t.columns.forEach((c, i) => {
          const v = r[c.k];
          if (c.t !== "amount" || typeof v !== "number" || !over.length) return;
          const L = ws.getColumn(i + 1).letter;
          const sum = over.reduce((a, n) => a + (Number(ws.getRow(n).getCell(i + 1).value) || 0), 0);
          if (r.__sum || Math.abs(sum - v) < 0.5) row.getCell(i + 1).value = { formula: "SUM(" + ranges(over, L) + ")", result: v };
          row.getCell(i + 1).border = { top: { style: "thin" } };
        });
        since = [];
      } else if (!r.__sum) { since.push(row.number); dataAt.push(row.number); }
    }
    const last = ws.rowCount;
    t.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.t === "amount") { col.numFmt = '"₹"#,##,##0.00;-"₹"#,##,##0.00'; col.width = 16; }
      else if (c.t === "int") { col.numFmt = "0"; col.width = 10; }
      else if (c.t === "pct") { col.numFmt = "0.00"; col.width = 10; }
      else if (c.t === "date") { col.numFmt = "dd-mmm-yyyy"; col.width = 13; }
      else col.width = Math.min(48, Math.max(10, (c.label || c.k).length + 2, ...t.rows.slice(0, 200).map((r) => String(r[c.k] ?? "").length + 1)));
    });
    // totals of the amount columns, as formulas
    const amountCols = t.columns.map((c, i) => [c, i] as [Col, number]).filter(([c]) => c.t === "amount" && !/balance|side|rate/i.test(c.k));
    if (t.rows.length > 1 && amountCols.length && !t.fromFile) {
      const tot = ws.addRow(t.columns.map((_c, i) => (i === 0 ? "Total" : null)));
      tot.font = { bold: true };
      for (const [, i] of amountCols) {
        const L = ws.getColumn(i + 1).letter;
        const sum = t.rows.reduce((a, r) => a + (Number(r[t.columns[i].k]) || 0), 0);
        tot.getCell(i + 1).value = { formula: "SUM(" + L + first + ":" + L + last + ")", result: Math.round(sum * 100) / 100 };
        tot.getCell(i + 1).border = { top: { style: "thin" } };
      }
    }
    ws.addRow([]);
    if (t.note) ws.addRow([t.note]).font = { italic: true, size: 9, color: { argb: "FF5A6B63" } };
    for (const f of footerLines(d)) ws.addRow([f]).font = { italic: true, size: 9, color: { argb: "FF5A6B63" } };
    ws.views = [{ state: "frozen", ySplit: 4, xSplit: 0 }];
  }
  if (texts.length || !tables.length) {
    const ws = wb.addWorksheet(sheetName("Notes"));
    ws.addRow([d.title]).font = { bold: true, size: 13 };
    for (const s of texts) { if (s.heading) ws.addRow([s.heading]).font = { bold: true }; for (const line of String(s.text).split("\n")) ws.addRow([line]); ws.addRow([]); }
    for (const f of footerLines(d)) ws.addRow([f]).font = { italic: true, size: 9 };
    ws.getColumn(1).width = 110;
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------- docx
export async function makeDocx(d: DocSpec): Promise<Uint8Array> {
  const kids: (Paragraph | Table)[] = [];
  kids.push(new Paragraph({ children: [new TextRun({ text: d.firm.name || "", bold: true, size: 30 })] }));
  for (const l of d.firm.lines) if (l) kids.push(new Paragraph({ children: [new TextRun({ text: l, size: 18, color: "5A6B63" })] }));
  kids.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1F6B52", space: 4 } }, children: [] }));
  kids.push(new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Date: " + new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).replace(/ /g, "-") })] }));
  if (d.draft) kids.push(new Paragraph({ children: [new TextRun({ text: "DRAFT - for the CA's review", bold: true, color: "B45309" })] }));
  kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: d.title })] }));
  if (d.client) kids.push(new Paragraph({ children: [new TextRun({ text: d.client, italics: true })] }));
  for (const s of d.sections) {
    if (s.heading) kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: s.heading })] }));
    if (s.text) for (const line of String(s.text).split("\n")) {
      if (/^#\s+/.test(line)) kids.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text: line.replace(/^#\s+/, "") })] }));
      else kids.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: line })] }));
    }
    if (s.table) {
      const t = s.table;
      const cell = (txt: string, num: boolean, bold = false) => new TableCell({ children: [new Paragraph({ alignment: num ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: txt, bold, size: 18 })] })] });
      const rows = [new TableRow({ tableHeader: true, children: t.columns.map((c) => cell(c.label || c.k, isNum(c.t), true)) }),
        ...t.rows.map((r) => new TableRow({ children: t.columns.map((c, i) => cell(isHead(r) ? (i === 0 ? String(r.__h) : "") : cellText(c, r[c.k]), isNum(c.t) && !isHead(r), isBold(r))) }))];
      const amountCols = t.columns.filter((c) => c.t === "amount" && !/balance|side|rate/i.test(c.k));
      if (t.rows.length > 1 && amountCols.length && !t.fromFile) rows.push(new TableRow({ children: t.columns.map((c, i) => cell(i === 0 ? "Total" : amountCols.includes(c) ? inr(t.rows.reduce((a, r) => a + (Number(r[c.k]) || 0), 0)) : "", isNum(c.t), true)) }));
      kids.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
      if (t.basis) kids.push(new Paragraph({ children: [new TextRun({ text: t.basis, italics: true, size: 16, color: "5A6B63" })] }));
      if (t.note) kids.push(new Paragraph({ children: [new TextRun({ text: t.note, italics: true, size: 16, color: "5A6B63" })] }));
    }
  }
  const doc = new Document({ creator: "FinCom", title: d.title, sections: [{ children: kids,
    footers: { default: new Footer({ children: footerLines(d).map((f) => new Paragraph({ children: [new TextRun({ text: f, italics: true, size: 16, color: "5A6B63" })] })) }) } }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

// ---------------------------------------------------------------- pdf (A4)
let rupeeFont: Uint8Array | null | undefined;
async function loadFont(fetcher?: typeof fetch): Promise<Uint8Array | null> {
  if (rupeeFont !== undefined) return rupeeFont;
  try {
    const r = await (fetcher || fetch)("https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf", { signal: AbortSignal.timeout(6000) });
    rupeeFont = r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch { rupeeFont = null; }
  return rupeeFont;
}
export async function makePdf(d: DocSpec, opts: { fetch?: typeof fetch, noFont?: boolean } = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(d.title); pdf.setCreator("FinCom"); pdf.setProducer("FinCom");
  let font: PDFFont, bold: PDFFont, rupee = "Rs.";
  const ttf = opts.noFont ? null : await loadFont(opts.fetch);
  if (ttf) { pdf.registerFontkit(fontkit); font = await pdf.embedFont(ttf, { subset: true }); bold = font; rupee = "₹"; }
  else { font = await pdf.embedFont(StandardFonts.Helvetica); bold = await pdf.embedFont(StandardFonts.HelveticaBold); }
  const clean = (s: string) => ttf ? s : s.replace(/₹/g, "Rs.").replace(/[^\x20-\x7E -ÿ]/g, "?");
  const W = 595.28, H = 841.89, M = 40;
  let page = pdf.addPage([W, H]), y = H - M;
  const pages = [page];
  const newPage = () => { page = pdf.addPage([W, H]); pages.push(page); y = H - M; };
  const need = (h: number) => { if (y - h < M + 30) newPage(); };
  const wrap = (txt: string, f: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of clean(txt).split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/)) {
        const tryL = line ? line + " " + w : w;
        if (f.widthOfTextAtSize(tryL, size) > width && line) { out.push(line); line = w; } else line = tryL;
      }
      out.push(line);
    }
    return out;
  };
  const text = (txt: string, size = 10, f = font, color = rgb(0.08, 0.13, 0.1), indent = 0) => {
    for (const l of wrap(txt, f, size, W - 2 * M - indent)) { need(size + 4); page.drawText(l, { x: M + indent, y: y - size, size, font: f, color }); y -= size + 4; }
  };
  text(d.firm.name || "", 15, bold);
  for (const l of d.firm.lines) if (l) text(l, 8.5, font, rgb(0.35, 0.42, 0.39));
  y -= 4; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: rgb(0.12, 0.42, 0.32) }); y -= 10;
  text("Date: " + new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).replace(/ /g, "-"), 9);
  if (d.draft) text("DRAFT - for the CA's review", 10, bold, rgb(0.7, 0.33, 0.04));
  y -= 4; text(d.title, 14, bold); if (d.client) text(d.client, 9.5, font, rgb(0.35, 0.42, 0.39)); y -= 6;
  for (const s of d.sections) {
    if (s.heading) { y -= 4; text(s.heading, 11.5, bold); }
    if (s.text) for (const line of String(s.text).split("\n")) { if (/^#\s+/.test(line)) text(line.replace(/^#\s+/, ""), 10.5, bold); else text(line, 9.5); }
    if (s.table) {
      const t = s.table, cols = t.columns, n = cols.length;
      const want = cols.map((c) => Math.max(font.widthOfTextAtSize(clean(c.label || c.k), 7.5), ...t.rows.slice(0, 80).map((r) => font.widthOfTextAtSize(clean(cellText(c, r[c.k])).slice(0, 60), 7.5))) + 8);
      const total = want.reduce((a, b) => a + b, 0), avail = W - 2 * M;
      const widths = want.map((w) => (total > avail ? w * avail / total : w));
      const row = (vals: string[], f: PDFFont, shade: boolean) => {
        const lines = vals.map((v, i) => wrap(v, f, 7.5, widths[i] - 6));
        const h = Math.max(...lines.map((l) => l.length)) * 9.5 + 4;
        need(h);
        if (shade) page.drawRectangle({ x: M, y: y - h, width: widths.reduce((a, b) => a + b, 0), height: h, color: rgb(0.93, 0.95, 0.94) });
        let x = M;
        lines.forEach((ls, i) => {
          ls.forEach((l, k) => {
            const tw = f.widthOfTextAtSize(l, 7.5);
            page.drawText(l, { x: isNum(cols[i].t) ? x + widths[i] - 3 - tw : x + 3, y: y - 9.5 * (k + 1), size: 7.5, font: f });
          });
          x += widths[i];
        });
        y -= h;
        page.drawLine({ start: { x: M, y }, end: { x: M + widths.reduce((a, b) => a + b, 0), y }, thickness: 0.3, color: rgb(0.8, 0.84, 0.82) });
      };
      row(cols.map((c) => c.label || c.k), bold, true);
      for (const r of t.rows) row(isHead(r) ? cols.map((_c, i) => (i === 0 ? String(r.__h) : "")) : cols.map((c) => cellText(c, r[c.k])), isBold(r) ? bold : font, !!(r.__b || r.__sum));
      const amountCols = cols.filter((c) => c.t === "amount" && !/balance|side|rate/i.test(c.k));
      if (t.rows.length > 1 && amountCols.length && !t.fromFile) row(cols.map((c, i) => (i === 0 ? "Total" : amountCols.includes(c) ? inr(t.rows.reduce((a, r) => a + (Number(r[c.k]) || 0), 0)) : "")), bold, true);
      if (t.basis) { y -= 2; text(t.basis, 7.5, font, rgb(0.35, 0.42, 0.39)); }
      if (t.note) { y -= 2; text(t.note, 7.5, font, rgb(0.35, 0.42, 0.39)); }
      else text("Amounts in " + rupee, 7, font, rgb(0.35, 0.42, 0.39));
      y -= 6;
    }
  }
  const foot = footerLines(d).join(" ");
  pages.forEach((p, i) => {
    p.drawText(clean(foot).slice(0, 140), { x: M, y: 22, size: 7, font, color: rgb(0.35, 0.42, 0.39) });
    p.drawText("Page " + (i + 1) + " of " + pages.length, { x: W - M - 50, y: 22, size: 7, font, color: rgb(0.35, 0.42, 0.39) });
  });
  return await pdf.save();
}

export async function makeFile(d: DocSpec, opts: { fetch?: typeof fetch, noFont?: boolean } = {}): Promise<Uint8Array> {
  return d.format === "xlsx" ? makeXlsx(d) : d.format === "docx" ? makeDocx(d) : makePdf(d, opts);
}
