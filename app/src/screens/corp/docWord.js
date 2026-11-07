// A document as a Word file (.docx), from the same blocks as the preview (docModel.js). The `docx` library is the one the
// reports pack already uses, not bundled: assets/docx.iife.js (docx 9.5.1, MIT), loaded the first time a Word file is made
// (as ensureDocx in lib/reportsExport.js). The letterhead is the page header and footer of the Word file (so every page
// carries it); the minutes carry the minutes book's header with the page number and the Chairman's initials box at the foot.
import { runText } from "./docModel.js";

const G = globalThis, FONT = "Cambria", NAVY = "14213D", TW = 9638;   // A4 less 2 x 20 mm, twentieths of a point
export async function ensureDocx() {
  if (G.docx && G.docx.Document) return G.docx;
  if (!G.TDS_ASSETS || typeof G.loadScriptOnce !== "function") throw new Error("The Word writer (docx.iife.js) could not be loaded");
  await G.loadScriptOnce("docx.iife.js");
  if (!G.docx || !G.docx.Document) throw new Error("The Word writer (docx.iife.js) could not be loaded");
  return G.docx;
}

function runs(D, list, o) {
  o = o || {};
  return (list || []).map((r) => {
    if (typeof r === "string") return new D.TextRun({ text: r, font: FONT, bold: o.b, italics: o.i, size: o.size });
    if (r.miss) return new D.TextRun({ text: "[" + r.miss + "]", font: FONT, highlight: "yellow", bold: o.b, italics: o.i, size: o.size });
    return new D.TextRun({ text: String(r.b), font: FONT, bold: true, italics: o.i, size: o.size });
  });
}
const lineRuns = (D, l, o) => runs(D, Array.isArray(l) ? l : [String(l)], o);
const noBorders = (D) => { const n = { style: D.BorderStyle.NONE, size: 0, color: "FFFFFF" }; return { top: n, bottom: n, left: n, right: n, insideHorizontal: n, insideVertical: n }; };

function dataUrlBytes(u) {
  const m = /^data:image\/(png|jpe?g|gif);base64,(.+)$/i.exec(String(u || ""));
  if (!m) return null;
  const bin = atob(m[2]), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { type: m[1].toLowerCase().replace("jpeg", "jpg"), data: out };
}

function body(D, model) {
  const kids = [];
  model.blocks.forEach((b) => {
    if (b.t === "title") kids.push(new D.Paragraph({ alignment: D.AlignmentType.CENTER, spacing: { after: 160 }, children: runs(D, b.runs, { b: true, size: 23 }) }));
    else if (b.t === "rule") kids.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: "D9DDE5", space: 1 } }, spacing: { after: 160 }, children: [] }));
    else if (b.t === "subject") kids.push(new D.Paragraph({ keepNext: true, spacing: { after: 140 }, children: runs(D, b.runs, { b: true, i: true }) }));
    else if (b.t === "p") kids.push(new D.Paragraph({ alignment: D.AlignmentType.JUSTIFIED, spacing: { after: 140, line: 320 }, children: runs(D, b.runs) }));
    else if (b.t === "item") kids.push(new D.Paragraph({ keepNext: true, spacing: { before: 80, after: 80 }, children: [new D.TextRun({ text: b.no + ". " + b.title, bold: true, font: FONT })] }));
    else if (b.t === "lines") b.items.forEach((it, i) => kids.push(new D.Paragraph({ indent: { left: 454, hanging: 340 }, spacing: { after: 60 }, children: [new D.TextRun({ text: (i + 1) + ".\t", font: FONT })].concat(runs(D, it)), tabStops: [{ type: D.TabStopType.LEFT, position: 454 }] })));
    else if (b.t === "to") b.lines.forEach((l, i) => kids.push(new D.Paragraph({ spacing: { after: i === b.lines.length - 1 ? 200 : 0 }, children: lineRuns(D, l) })));
    else if (b.t === "list") {
      const w = [600, 3600, 2800, 2000];
      kids.push(new D.Table({ borders: noBorders(D), width: { size: 9000, type: D.WidthType.DXA }, columnWidths: w, indent: { size: 340, type: D.WidthType.DXA },
        rows: b.rows.map((r) => new D.TableRow({ children: r.map((c, i) => new D.TableCell({ borders: noBorders(D), width: { size: w[i], type: D.WidthType.DXA },
          children: [new D.Paragraph({ children: typeof c === "string" ? [new D.TextRun({ text: c, font: FONT })] : runs(D, [c]) })] })) })) }));
      kids.push(new D.Paragraph({ spacing: { after: 100 }, children: [] }));
    } else if (b.t === "grid") {
      const w = [2000, TW - 2000];
      kids.push(new D.Table({ borders: noBorders(D), width: { size: TW, type: D.WidthType.DXA }, columnWidths: w,
        rows: b.rows.map(([k, v]) => new D.TableRow({ children: [new D.TableCell({ borders: noBorders(D), width: { size: w[0], type: D.WidthType.DXA }, children: [new D.Paragraph({ children: [new D.TextRun({ text: k, bold: true, font: FONT })] })] }),
          new D.TableCell({ borders: noBorders(D), width: { size: w[1], type: D.WidthType.DXA }, children: (typeof v === "string" ? v.split("\n") : [null]).map((t) => new D.Paragraph({ children: t == null ? runs(D, [v]) : [new D.TextRun({ text: t, font: FONT })] })) })] })) }));
      kids.push(new D.Paragraph({ spacing: { after: 120 }, children: [] }));
    } else if (b.t === "sig") {
      const left = b.lines.map((l) => (l === "" ? new D.Paragraph({ spacing: { before: 600 }, children: [] }) : new D.Paragraph({ children: lineRuns(D, l) })));
      const w = b.seal ? [6200, TW - 6200] : [TW, 0];
      const cells = [new D.TableCell({ borders: noBorders(D), width: { size: w[0], type: D.WidthType.DXA }, children: left })];
      if (b.seal) cells.push(new D.TableCell({ borders: noBorders(D), width: { size: w[1], type: D.WidthType.DXA }, verticalAlign: D.VerticalAlign.BOTTOM,
        children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: "(Company seal)", font: FONT, color: "9AA3B2", size: 18 })] })] }));
      kids.push(new D.Paragraph({ spacing: { before: 240 }, children: [] }));
      kids.push(new D.Table({ borders: noBorders(D), width: { size: TW, type: D.WidthType.DXA }, columnWidths: b.seal ? w : [TW], rows: [new D.TableRow({ cantSplit: true, children: cells })] }));
    }
  });
  return kids;
}

function headerFooter(D, model, letter) {
  if (model.kind === "minutes") {
    const start = (model.head && model.head.startPage) || 1;
    const head = new D.Header({ children: [new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 4, color: "D9DDE5", space: 4 } }, tabStops: [{ type: D.TabStopType.RIGHT, position: TW }],
      children: [new D.TextRun({ text: String(model.head.left).toUpperCase(), font: "Arial", size: 15, color: "4A5468" }), new D.TextRun({ text: "\tPAGE NO. ", font: "Arial", size: 15, color: "4A5468" }),
        new D.TextRun({ children: [D.PageNumber.CURRENT], font: "Arial", size: 15, color: "4A5468" })] })] });
    const box = { style: D.BorderStyle.SINGLE, size: 6, color: "111827" };
    const foot = new D.Footer({ children: [new D.Table({ borders: noBorders(D), width: { size: TW, type: D.WidthType.DXA }, columnWidths: [TW - 2800, 1500, 1300],
      rows: [new D.TableRow({ children: [new D.TableCell({ borders: noBorders(D), width: { size: TW - 2800, type: D.WidthType.DXA }, children: [new D.Paragraph({ children: [] })] }),
        new D.TableCell({ borders: { top: box, bottom: box, left: box, right: box }, width: { size: 1500, type: D.WidthType.DXA }, children: [new D.Paragraph({ spacing: { before: 280 }, children: [] })] }),
        new D.TableCell({ borders: noBorders(D), width: { size: 1300, type: D.WidthType.DXA }, verticalAlign: D.VerticalAlign.BOTTOM, children: [new D.Paragraph({ indent: { left: 120 }, children: [new D.TextRun({ text: "Chairman’s initials", font: "Arial", size: 15, color: "4A5468" })] })] })] })] })] });
    return { headers: { default: head }, footers: { default: foot }, pageNumbers: { start } };
  }
  if (!letter || !letter.on) return {};
  const img = dataUrlBytes(letter.logo);
  const nameRuns = [new D.TextRun({ text: String(letter.name || "").toUpperCase(), bold: true, font: FONT, size: 32, color: NAVY, characterSpacing: 30 })];
  const headKids = [];
  if (img) {
    const w = [1300, TW - 1300];
    headKids.push(new D.Table({ borders: noBorders(D), width: { size: TW, type: D.WidthType.DXA }, columnWidths: w, rows: [new D.TableRow({ children: [
      new D.TableCell({ borders: noBorders(D), width: { size: w[0], type: D.WidthType.DXA }, children: [new D.Paragraph({ children: [new D.ImageRun({ type: img.type === "jpg" ? "jpg" : img.type, data: img.data, transformation: { width: 54, height: 54 } })] })] }),
      new D.TableCell({ borders: noBorders(D), width: { size: w[1], type: D.WidthType.DXA }, verticalAlign: D.VerticalAlign.CENTER, children: [new D.Paragraph({ children: nameRuns }),
        letter.cin ? new D.Paragraph({ children: [new D.TextRun({ text: "CIN " + letter.cin, font: "Arial", size: 17, color: "4A5468" })] }) : new D.Paragraph({ children: [] })] })] })] }));
  } else {
    headKids.push(new D.Paragraph({ children: nameRuns }));
    if (letter.cin) headKids.push(new D.Paragraph({ children: [new D.TextRun({ text: "CIN " + letter.cin, font: "Arial", size: 17, color: "4A5468" })] }));
  }
  headKids.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.DOUBLE, size: 6, color: NAVY, space: 4 } }, children: [] }));
  const bits = [letter.address ? "Regd. Office: " + letter.address : "", letter.phone ? "Tel: " + letter.phone : "", letter.email || "", letter.website || ""].filter(Boolean);
  const foot = new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.CENTER, border: { top: { style: D.BorderStyle.SINGLE, size: 4, color: "C9A96E", space: 4 } },
    children: [new D.TextRun({ text: bits.join(" · "), font: "Arial", size: 16, color: "4A5468" })] })] });
  return { headers: { default: new D.Header({ children: headKids }) }, footers: bits.length ? { default: foot } : undefined };
}

export async function wordBlob(model, letter) {
  const D = await ensureDocx();
  const hf = headerFooter(D, model, letter);
  const doc = new D.Document({
    creator: "FinCom", title: model.title, description: "Prepared in FinCom. Wording to be checked by a Company Secretary before use.",
    styles: { default: { document: { run: { font: FONT, size: 23 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: model.kind === "minutes" ? 1300 : letter && letter.on ? 1900 : 1440, bottom: 1300, left: 1134, right: 1134, header: 560, footer: 480 },
      pageNumbers: hf.pageNumbers } }, headers: hf.headers, footers: hf.footers, children: body(D, model) }],
  });
  return D.Packer.toBlob(doc);
}

export async function downloadWord(model, letter, name) {
  const blob = await wordBlob(model, letter);
  const file = String(name || model.title || "Document").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() + ".docx";
  if (typeof G.saveFile === "function") await G.saveFile(file, blob);
  else { const a = document.createElement("a"), u = URL.createObjectURL(blob); a.href = u; a.download = file; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
  return file;
}
export { runText };
