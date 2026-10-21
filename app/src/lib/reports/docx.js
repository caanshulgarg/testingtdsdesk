// A report (doc.js) as a Word file (ROUND 100), with the `docx` library (D: its browser build's global, docx 9.5.1,
// loaded by reportsExport.js). Headings are Word headings (Heading 1 / 2), numbered paragraphs hang their number, tables
// are Word tables (the financial summary, AOC-2, CARO), signature blocks a table without borders, the pages numbered in
// the footer. A gap in the answers is printed in square brackets, highlighted.
//
//   docxDocument(D, doc, {company})  -> a docx.Document (D.Packer.toBlob(it) gives the file)
import { runsText } from "./doc.js";

const FONT = "Cambria";
const TW = 9638; // A4 width less 2 x 20 mm margins, in twentieths of a point

function runs(D, list, o) {
  o = o || {};
  return (list || []).map((r) => {
    if (typeof r === "string" || typeof r === "number") return new D.TextRun({ text: String(r), bold: o.b, italics: o.i, font: FONT });
    if (r.miss) return new D.TextRun({ text: "[" + r.miss + "]", highlight: "yellow", font: FONT, bold: o.b });
    return new D.TextRun({ text: String(r.text), bold: r.b || o.b, italics: r.i || o.i, font: FONT });
  });
}
function cellParas(D, c, o) {
  const t = runs(D, c, o);
  return [new D.Paragraph({ style: "Normal", children: t.length ? t : [new D.TextRun({ text: "", font: FONT })], alignment: o && o.right ? D.AlignmentType.RIGHT : D.AlignmentType.LEFT, spacing: { before: 20, after: 20 } })];
}
function table(D, b) {
  const nc = b.head.length, w = Math.floor(TW / nc), num = b.num || [], bold = b.bold || [];
  const border = { style: D.BorderStyle.SINGLE, size: 4, color: "444444" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const head = new D.TableRow({ tableHeader: true, children: b.head.map((h, i) => new D.TableCell({ borders, width: { size: w, type: D.WidthType.DXA }, shading: { fill: "EEEEEE", type: D.ShadingType.CLEAR, color: "auto" }, children: cellParas(D, [h], { b: true, right: num.includes(i) }) })) });
  const rows = b.rows.map((r, ri) => new D.TableRow({ children: r.map((c, i) => new D.TableCell({ borders, width: { size: w, type: D.WidthType.DXA }, children: cellParas(D, c, { b: bold.includes(ri), right: num.includes(i) }) })) }));
  return new D.Table({ rows: [head].concat(rows), width: { size: TW, type: D.WidthType.DXA }, columnWidths: b.head.map(() => w) });
}
function sig(D, b) {
  const none = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" }, borders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
  const w = Math.floor(TW / b.cols.length);
  return new D.Table({ borders, width: { size: TW, type: D.WidthType.DXA }, columnWidths: b.cols.map(() => w),
    rows: [new D.TableRow({ cantSplit: true, children: b.cols.map((c) => new D.TableCell({ borders, width: { size: w, type: D.WidthType.DXA },
      children: c.map((l) => new D.Paragraph({ style: "Normal", children: runsText(l).trim() ? runs(D, l) : [new D.TextRun({ text: "", font: FONT })], spacing: { after: runsText(l).trim() ? 0 : 200 } })) })) })] });
}

export function docxDocument(D, doc, meta) {
  const kids = [];
  let pageBreak = false;
  const pb = () => { const v = pageBreak; pageBreak = false; return v; };
  doc.blocks.forEach((b) => {
    if (b.t === "break") { pageBreak = true; return; }
    if (b.t === "title") {
      kids.push(new D.Paragraph({ pageBreakBefore: pb(), alignment: D.AlignmentType.CENTER, heading: D.HeadingLevel.TITLE, spacing: { after: b.sub ? 60 : 240 }, children: [new D.TextRun({ text: String(b.text).toUpperCase(), bold: true, size: 28, font: FONT, color: "000000" })] }));
      if (b.sub) kids.push(new D.Paragraph({ style: "Normal", alignment: D.AlignmentType.CENTER, spacing: { after: 240 }, children: [new D.TextRun({ text: b.sub, bold: true, font: FONT })] }));
    } else if (b.t === "h") {
      kids.push(new D.Paragraph({ pageBreakBefore: pb(), heading: b.level === 1 ? D.HeadingLevel.HEADING_1 : D.HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 200, after: 80 },
        children: [new D.TextRun({ text: (b.num ? b.num + " " : "") + b.text, bold: true, italics: b.level === 2, size: b.level === 1 ? 24 : 22, font: FONT, color: "000000" })] }));
    } else if (b.t === "p") {
      const ind = (b.indent || 0) * 454, hang = b.num ? 454 : 0;
      const ch = (b.num ? [new D.TextRun({ text: b.num, font: FONT }), new D.TextRun({ text: "\t", font: FONT })] : []).concat(runs(D, b.runs));
      kids.push(new D.Paragraph({ style: "Normal", pageBreakBefore: pb(), children: ch, keepNext: !!b.keep, alignment: b.align === "center" ? D.AlignmentType.CENTER : b.align === "right" ? D.AlignmentType.RIGHT : D.AlignmentType.JUSTIFIED,
        indent: hang || ind ? { left: ind + hang, hanging: hang } : undefined, tabStops: hang ? [{ type: D.TabStopType.LEFT, position: ind + hang }] : undefined, spacing: { after: 100 } }));
    } else if (b.t === "table") {
      if (pb()) kids.push(new D.Paragraph({ style: "Normal", pageBreakBefore: true, children: [] }));
      kids.push(table(D, b)); kids.push(new D.Paragraph({ style: "Normal", children: [], spacing: { after: 80 } }));
    } else if (b.t === "sig") {
      if (pb()) kids.push(new D.Paragraph({ style: "Normal", pageBreakBefore: true, children: [] }));
      kids.push(sig(D, b));
    }
  });
  const footer = new D.Footer({ children: [new D.Paragraph({ style: "Normal", alignment: D.AlignmentType.CENTER, children: [
    new D.TextRun({ children: [(meta && meta.company ? meta.company + " · " + doc.title + " · Page " : "Page "), D.PageNumber.CURRENT, " of ", D.PageNumber.TOTAL_PAGES], size: 16, font: FONT, color: "555555" })] })] });
  return new D.Document({
    creator: "FinCom", title: (meta && meta.company ? meta.company + " - " : "") + doc.title, description: doc.title,
    styles: { default: { document: { run: { font: FONT, size: 22 } } }, paragraphStyles: [{ id: "Normal", name: "Normal", quickFormat: true, run: { font: FONT, size: 22 } }] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134, footer: 567 } } }, footers: { default: footer }, children: kids }],
  });
}
