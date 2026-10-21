// The reports pack as files (ROUND 100): the Board's Report, the Independent Auditor's Report and the management
// representation letter as Word (.docx) and as the print view (A4, saved as PDF from there, like FinPdf), and "Download
// all": the financial statements and the three reports in one print view, or a zip of separate files (the statements as
// the Excel workbook, the reports as Word). A lazy module: the Reports area of the Financial statements page imports it;
// nothing here is in legacy.js. The `docx` library is not bundled: its prebuilt browser file is served from this site
// (assets/docx.iife.js, docx 9.5.1 from npm, the package's dist/index.iife.js unchanged, sha256
// bb2908d72ffd8a3d896b455563733d3a2e708e1384a5140e05b3c6dd0b2f676d, MIT: assets/docx-LICENSE.txt) and loaded the first
// time a Word file is made (ensureDocx, like ensureExcelJs in finExport.js).
//
//   ReportsPack.pack(fy, {unit, dec})            -> pack() of reports/index.js for the open client
//   ReportsPack.docx(key, fy, opt)               -> {blob, name}; key: board | audit | mrl
//   ReportsPack.downloadDocx(key, fy, opt)       saves it, returns the name
//   ReportsPack.html(keys, fy, opt)              the print view's HTML (keys may hold "fs": the statements first)
//   ReportsPack.openPdf(keys, fy, opt, win?)     opens the print view (A4) and prints
//   ReportsPack.zip(fy, opt)                     -> {blob, name, files}; downloadZip saves it
import "./finGlobals.js";
import { pack, docHtml, PRINT_CSS } from "./reports/index.js";
import { docxDocument } from "./reports/docx.js";
import { zipFiles } from "./reports/zip.js";
import { pdfHtml, FinXlsx } from "./finExport.js";

const G = globalThis;
const DOCX = "docx.iife.js";
export const DOCX_SHA256 = "bb2908d72ffd8a3d896b455563733d3a2e708e1384a5140e05b3c6dd0b2f676d";
export const DOCX_VERSION = "9.5.1";
export async function ensureDocx() {
  if (G.docx && G.docx.Document) return G.docx;
  if (!G.TDS_ASSETS || typeof G.loadScriptOnce !== "function") throw { code: "lib_missing", message: DOCX + " could not be loaded" };
  await G.loadScriptOnce(DOCX);
  if (!G.docx || !G.docx.Document) throw { code: "lib_missing", message: DOCX + " could not be loaded" };
  return G.docx;
}

const TITLES = { board: "Board's Report", audit: "Independent Auditor's Report", mrl: "Management representation letter" };
const yearOf = (fy) => Number(String(fy).slice(0, 4));
const fyLabel = (fy) => yearOf(fy) + "-" + String(yearOf(fy) + 1).slice(2);
const H = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// the statements in the unit asked, and in rupees for the tests of size; the day book and the answers of the open client
let memoR = { key: "", d: null };
function statements(fy, opt) {
  // S (the app's state) is a top-level binding of the classic scripts, not a property of window
  const st = typeof S !== "undefined" ? S : G.S, b = st && st.books;
  if (!b) throw { code: "fin_error", message: "Open a client first." };
  const d = G.FinSt.build(String(fy), { unit: opt && opt.unit, dec: opt && opt.dec });
  if (!d || d.error) throw { code: "fin_error", message: (d && d.error) || "The statements could not be worked out." };
  let fsTxt = ""; try { fsTxt = JSON.stringify(Object.assign({}, b.fs, { reports: undefined })); } catch (e) { fsTxt = String(Date.now()); }
  const key = [b.cid, fy, (b.vouchers || []).length, (b.tb || {}).at || "", fsTxt, ((typeof CO === "function" ? CO() : null) || {}).name || ""].join("\u0001");
  if (memoR.key !== key) { const dR = G.FinSt.build(String(fy), { unit: 1, dec: 2 }); memoR = { key, d: dR && !dR.error ? dR : d }; }
  return { b, d, dR: memoR.d };
}
export function packFor(fy, opt) {
  const { b, d, dR } = statements(fy, opt);
  return pack({ d, dR, vouchers: b.vouchers || [], store: (b.fs || {}).reports || {}, fy: String(fy) });
}
const base = (p, key) => String(p.c.inp.name || "Client").replace(/[\\/:*?"<>|]+/g, " ").trim() + " " + TITLES[key] + " FY " + fyLabel(p.c.fy);

async function docxOf(p, key) {
  const D = await ensureDocx();
  const blob = await D.Packer.toBlob(docxDocument(D, p[key], { company: p.c.inp.name }));
  return { blob, name: base(p, key) + ".docx" };
}
async function save(name, blob) {
  if (typeof G.saveFile === "function") await G.saveFile(name, blob);
  else { const a = document.createElement("a"), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 5000); }
  return name;
}

function printHtml(keys, fy, opt) {
  const p = packFor(fy, opt);
  let css = PRINT_CSS, body = "";
  if (keys.includes("fs")) { const { d } = statements(fy, opt); const x = pdfHtml(d, {}); css = x.css + PRINT_CSS.replace(/@page\{[^}]*\}/, ""); body += x.body; }
  keys.filter((k) => TITLES[k]).forEach((k) => { body += '<section class="rp-doc" data-rp-doc="' + k + '">' + docHtml(p[k], { print: true }) + "</section>"; });
  const title = (p.c.inp.name || "Client") + " - " + (keys.length > 1 ? "Financial statements and reports" : TITLES[keys[0]]) + " FY " + fyLabel(fy);
  return { css, body, title, pack: p };
}

export const ReportsPack = {
  pack: packFor,
  async docx(key, fy, opt) { return docxOf(packFor(fy, opt), key); },
  async downloadDocx(key, fy, opt) { const x = await this.docx(key, fy, opt); return save(x.name, x.blob); },
  html(keys, fy, opt) { const x = printHtml(keys, fy, opt); return "<style>" + x.css + "</style>" + x.body; },
  // the print view (A4 portrait): a window of its own, printed (or saved as PDF) from there; win: opened already by the click
  openPdf(keys, fy, opt, win) {
    const w = win || window.open("", "_blank");
    if (!w) { if (typeof G.toast === "function") G.toast("Allow pop-ups for this site to print."); return null; }
    let x;
    try { x = printHtml(keys, fy, opt); }
    catch (e) { w.close(); if (typeof G.toast === "function") G.toast((e && e.message) || "The reports could not be made."); return null; }
    w.document.open();
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + H(x.title) + "</title><style>" + x.css + "</style></head><body>" + x.body + "</body></html>");
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* the person prints from the window */ } }, 400);
    return w;
  },
  async zip(fy, opt) {
    const p = packFor(fy, opt), files = [];
    const xl = await FinXlsx.make(fy, opt);
    files.push({ name: xl.name, data: new Uint8Array(xl.buffer) });
    for (const k of ["board", "audit", "mrl"]) { const x = await docxOf(p, k); files.push({ name: x.name, data: new Uint8Array(await x.blob.arrayBuffer()) }); }
    const blob = new Blob([zipFiles(files)], { type: "application/zip" });
    return { blob, name: String(p.c.inp.name || "Client").replace(/[\\/:*?"<>|]+/g, " ").trim() + " Financial statements and reports FY " + fyLabel(fy) + ".zip", files: files.map((f) => f.name) };
  },
  async downloadZip(fy, opt) { const x = await this.zip(fy, opt); return save(x.name, x.blob); },
  sha256: DOCX_SHA256,
  version: DOCX_VERSION,
};
G.ReportsPack = ReportsPack;
