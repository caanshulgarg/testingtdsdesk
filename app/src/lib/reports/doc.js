// A small document model the three reports are written in (ROUND 100), and its HTML (the preview and the print view).
// The Word file is made from the same model (docx.js), so the preview, the PDF and the Word file say the same thing.
//
// A document: {key, title, blocks: [...], missing: [{k, label}]}. Blocks:
//   {t: "title", text, sub?}                 the document's title (centred), a line under it
//   {t: "h", level: 1 | 2, text, num?}      a heading ("1." numbered when num)
//   {t: "p", runs, num?, indent?, align?, keep?}  a paragraph; num: "1." / "(a)" hung in front; indent 0-2
//   {t: "table", head, rows, num: [col...], widths?, total?}  cells are runs or strings; num: right-aligned columns
//   {t: "sig", cols: [[line, ...], ...]}   signature blocks side by side (a line: runs; "" a gap for the signature)
//   {t: "break"}                             a new page
// Runs: a string, {text, b?, i?}, or {miss: label, k}: an answer not given yet (shown marked, counted).
export const H = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const N = (v) => +v || 0;

// Indian grouping, brackets for a minus, "-" for nil
export function money(v, dec) {
  if (v == null || v === "") return "";
  const n = +v || 0;
  if (Math.abs(n) < 0.5 * Math.pow(10, -dec)) return "-";
  const s = new Intl.NumberFormat("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(Math.abs(n));
  return n < 0 ? "(" + s + ")" : s;
}

export function makeDoc(key, title) {
  const doc = { key, title, blocks: [], missing: [] }, seen = {};
  const R = (x) => (Array.isArray(x) ? x : [x]).filter((r) => r !== undefined && r !== null && r !== false && r !== "").map((r) => {
    if (r && typeof r === "object" && r.miss && !seen[r.k]) { seen[r.k] = 1; doc.missing.push({ k: r.k, label: r.miss }); }
    return r;
  });
  const api = {
    doc,
    title(text, sub) { doc.blocks.push({ t: "title", text, sub: sub || "" }); return api; },
    h(text, level, num) { doc.blocks.push({ t: "h", level: level || 1, text, num: num || "" }); return api; },
    p(runs, o) { doc.blocks.push(Object.assign({ t: "p", runs: R(runs) }, o || {})); return api; },
    table(head, rows, o) { doc.blocks.push(Object.assign({ t: "table", head, rows: rows.map((r) => r.map((c) => R(c == null ? "" : c))) }, o || {})); return api; },
    sig(cols) { doc.blocks.push({ t: "sig", cols: cols.map((c) => c.map((l) => R(l === "" ? " " : l))) }); return api; },
    brk() { doc.blocks.push({ t: "break" }); return api; },
  };
  return api;
}
// numbering of paragraphs: 1, 2, 3 ... (sections); (a), (b) ... (clauses); (i), (ii) ...
export const alpha = (i) => "(" + String.fromCharCode(97 + i) + ")";
const ROM = ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x", "xi", "xii", "xiii", "xiv", "xv", "xvi", "xvii", "xviii", "xix", "xx", "xxi", "xxii", "xxiii", "xxiv", "xxv"];
export const roman = (i) => "(" + ROM[i] + ")";
export const romanUp = (i) => ROM[i];

// ---------- HTML ----------
function runsHtml(runs, mark) {
  return (runs || []).map((r) => {
    if (typeof r === "string" || typeof r === "number") return H(r);
    if (r.miss) return mark ? '<mark class="rp-miss" data-miss="' + H(r.k) + '" title="Answer this in the questionnaire">[' + H(r.miss) + "]</mark>" : "[" + H(r.miss) + "]";
    let t = H(r.text);
    if (r.b) t = "<b>" + t + "</b>";
    if (r.i) t = "<i>" + t + "</i>";
    return t;
  }).join("");
}
export const runsText = (runs) => (runs || []).map((r) => (typeof r === "string" || typeof r === "number" ? String(r) : r.miss ? "[" + r.miss + "]" : r.text)).join("");

export function docHtml(doc, opt) {
  const mark = !(opt && opt.print);
  let h = "";
  doc.blocks.forEach((b) => {
    if (b.t === "title") h += '<div class="rp-title">' + H(b.text) + "</div>" + (b.sub ? '<div class="rp-sub">' + H(b.sub) + "</div>" : "");
    else if (b.t === "h") h += "<h" + (b.level === 1 ? 3 : 4) + ' class="rp-h' + b.level + '">' + (b.num ? '<span class="rp-n">' + H(b.num) + "</span>" : "") + H(b.text) + "</h" + (b.level === 1 ? 3 : 4) + ">";
    else if (b.t === "p") h += '<p class="rp-p' + (b.indent ? " rp-i" + b.indent : "") + (b.align === "center" ? " rp-c" : b.align === "right" ? " rp-r" : "") + (b.num ? " rp-hang" : "") + '">' + (b.num ? '<span class="rp-n">' + H(b.num) + "</span>" : "") + runsHtml(b.runs, mark) + "</p>";
    else if (b.t === "table") {
      const nc = b.num || [];
      h += '<div class="rp-tw"><table class="rp-t"><thead><tr>' + b.head.map((c, i) => "<th" + (nc.includes(i) ? ' class="n"' : "") + ">" + H(c) + "</th>").join("") + "</tr></thead><tbody>" +
        b.rows.map((r, ri) => '<tr' + ((b.bold || []).includes(ri) ? ' class="b"' : "") + ">" + r.map((c, i) => "<td" + (nc.includes(i) ? ' class="n"' : "") + ">" + runsHtml(c, mark) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
    } else if (b.t === "sig") h += '<div class="rp-sig">' + b.cols.map((c) => "<div>" + c.map((l) => (runsText(l).trim() === "" ? '<div class="rp-gap"></div>' : "<div>" + runsHtml(l, mark) + "</div>")).join("") + "</div>").join("") + "</div>";
    else if (b.t === "break") h += '<div class="rp-break"></div>';
  });
  return h;
}
// the print view's style (A4 portrait, as FinPdf); the preview has its own (fin.css)
export const PRINT_CSS = "@page{size:A4 portrait;margin:18mm 16mm}" +
  "body{font:11.5px/1.45 Cambria,Georgia,'Times New Roman',serif;color:#111;margin:0}" +
  ".rp-doc{break-before:page;page-break-before:always}.rp-doc:first-child{break-before:auto;page-break-before:auto}" +
  ".rp-title{font-size:15px;font-weight:700;text-align:center;margin:0 0 2px;text-transform:uppercase}.rp-sub{text-align:center;margin:0 0 12px;font-weight:700}" +
  "h3.rp-h1{font-size:12.5px;margin:12px 0 4px;break-after:avoid}h4.rp-h2{font-size:11.5px;margin:9px 0 3px;font-style:italic;break-after:avoid}" +
  ".rp-n{display:inline-block;min-width:26px}.rp-p{margin:0 0 6px;text-align:justify}.rp-hang{padding-left:26px;text-indent:-26px}.rp-i1{margin-left:26px}.rp-i2{margin-left:52px}.rp-c{text-align:center}.rp-r{text-align:right}" +
  "table.rp-t{border-collapse:collapse;width:100%;margin:4px 0 10px;font-size:10.5px}.rp-t th,.rp-t td{border:1px solid #444;padding:3px 5px;text-align:left;vertical-align:top}.rp-t th{background:#eee}.rp-t .n{text-align:right;white-space:nowrap}.rp-t tr.b td{font-weight:700}" +
  ".rp-sig{display:flex;justify-content:space-between;gap:24px;margin-top:22px;break-inside:avoid}.rp-sig>div{flex:1}.rp-gap{height:36px}.rp-break{break-before:page;page-break-before:always}" +
  "mark.rp-miss{background:#fff3b0}";
