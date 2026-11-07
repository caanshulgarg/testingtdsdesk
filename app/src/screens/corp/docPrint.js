// A document's A4 pages as HTML (the designs "Board resolution" and "Minutes of board meeting"): the letterhead (the
// company's name, CIN, logo, and its address, phone and email at the foot) or plain paper; for the minutes the minutes
// book's header on every page and a box for the Chairman's initials at its foot. The live preview and the PDF are the same
// HTML: the PDF is the browser's own print of these pages (Save as PDF), so nothing heavy is loaded for it.
//   PAPER_CSS                               the paper's rules (the preview puts them in the page once; the print window too)
//   blockHtml(b)                            one block
//   pageHtml(model, letter, blocksHtml[], no, total)
//   paginate(model, letter, measure)        [[block index, ...], ...] pages, by the blocks' heights (measure(i) in px)
//   printPdf(model, letter, pages, title)   opens the print view (A4) and prints
import { runText } from "./docModel.js";
import { serifCss } from "./fonts.js";

export const H = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const PAGE = { w: 794, h: 1123 };            // A4 at 96 px an inch
const PAD = { x: 72, top: 64, bottom: 60 };        // the text's margins on plain paper
const LH_HEAD = 118, LH_FOOT = 56, MIN_HEAD = 52, MIN_FOOT = 64;

export const PAPER_CSS = `
.corp-a4{width:794px;height:1123px;background:#fff;color:#111827;box-sizing:border-box;position:relative;overflow:hidden;font-family:"Source Serif 4","Source Serif Pro",Georgia,"Times New Roman",serif;font-size:13.5px;line-height:1.62}
.corp-a4 .pg-body{position:absolute;left:${PAD.x}px;right:${PAD.x}px}
.corp-a4 .lh-head{position:absolute;left:64px;right:64px;top:40px}
.corp-a4 .lh-row{display:flex;align-items:center;gap:18px}
.corp-a4 .lh-logo{width:54px;height:54px;border:1.5px solid #14213D;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;color:#14213D;letter-spacing:.04em;flex:0 0 auto;overflow:hidden}
.corp-a4 .lh-logo img{width:100%;height:100%;object-fit:contain}
.corp-a4 .lh-logo.img{border:0;border-radius:0}
.corp-a4 .lh-name{font-size:21px;font-weight:700;letter-spacing:.08em;color:#14213D;line-height:1.25}
.corp-a4 .lh-cin{font-family:Inter,"Inter Variable",Arial,sans-serif;font-size:10.5px;letter-spacing:.04em;color:#4A5468;margin-top:3px}
.corp-a4 .lh-rule{height:2px;background:#14213D;margin-top:14px}
.corp-a4 .lh-rule2{height:1px;background:#C9A96E;margin-top:3px}
.corp-a4 .lh-foot{position:absolute;left:64px;right:64px;bottom:28px;border-top:1px solid #C9A96E;padding-top:8px;font-family:Inter,"Inter Variable",Arial,sans-serif;font-size:10px;color:#4A5468;text-align:center;letter-spacing:.02em}
.corp-a4 .mb-head{position:absolute;left:56px;right:56px;top:30px;display:flex;justify-content:space-between;gap:12px;font-family:Inter,"Inter Variable",Arial,sans-serif;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#4A5468;border-bottom:1px solid #D9DDE5;padding-bottom:8px}
.corp-a4 .mb-foot{position:absolute;left:56px;right:56px;bottom:26px;display:flex;justify-content:space-between;align-items:flex-end;font-family:Inter,"Inter Variable",Arial,sans-serif;font-size:10px;color:#4A5468}
.corp-a4 .mb-init{display:flex;align-items:flex-end;gap:8px}
.corp-a4 .mb-box{display:inline-block;width:64px;height:30px;border:1px solid #111827}
.corp-a4 .b{margin:0 0 12px}
.corp-a4 .b-title{text-align:center;font-weight:700;font-size:13px;letter-spacing:.06em;line-height:1.5}
.corp-a4 .b-rule{height:1px;background:#D9DDE5;margin:2px 0 14px}
.corp-a4 .b-subject{font-weight:700;font-style:italic}
.corp-a4 .b-p{text-align:justify}
.corp-a4 table.b-list{border-collapse:collapse;font-size:13px;margin:0 0 12px 24px}
.corp-a4 table.b-list td{padding:2px 24px 2px 0;vertical-align:top}
.corp-a4 ol.b-lines{margin:0 0 12px;padding-left:28px}
.corp-a4 ol.b-lines li{margin:0 0 4px}
.corp-a4 .b-to div{line-height:1.5}
.corp-a4 .b-grid{display:grid;grid-template-columns:132px minmax(0,1fr);gap:4px 18px}
.corp-a4 .b-grid > div:nth-child(odd){font-weight:700}
.corp-a4 .b-grid > div{white-space:pre-line}
.corp-a4 .b-item{font-weight:700;font-size:12.5px;margin:4px 0 6px}
.corp-a4 .b-sig{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-top:22px;font-size:13px}
.corp-a4 .b-sig .gap{height:54px}
.corp-a4 .b-sig .line{width:220px;border-top:1px solid #111827;padding-top:4px}
.corp-a4 .b-seal{width:86px;height:86px;border:1px dashed #9AA3B2;border-radius:50%;display:flex;align-items:center;justify-content:center;text-align:center;font-family:Inter,"Inter Variable",Arial,sans-serif;font-size:10px;color:#9AA3B2}
.corp-a4 .miss{background:#FFF3BF;color:#5C4400;padding:0 2px;border-radius:2px}
`;

const runsHtml = (runs) => (runs || []).map((r) => (typeof r === "string" ? H(r) : r.b != null ? "<b>" + H(r.b) + "</b>" : r.miss ? '<span class="miss">[' + H(r.miss) + "]</span>" : "")).join("");
const lineHtml = (l) => (Array.isArray(l) ? runsHtml(l) : H(l));

export function blockHtml(b) {
  if (b.t === "title") return '<div class="b b-title">' + runsHtml(b.runs) + "</div>";
  if (b.t === "rule") return '<div class="b-rule"></div>';
  if (b.t === "subject") return '<div class="b b-subject">' + runsHtml(b.runs) + "</div>";
  if (b.t === "p") return '<p class="b b-p">' + runsHtml(b.runs) + "</p>";
  if (b.t === "list") return '<table class="b-list"><tbody>' + b.rows.map((r) => "<tr>" + r.map((c) => "<td>" + (typeof c === "string" ? H(c) : runsHtml([c])) + "</td>").join("") + "</tr>").join("") + "</tbody></table>";
  if (b.t === "lines") return '<ol class="b-lines">' + b.items.map((it) => "<li>" + runsHtml(it) + "</li>").join("") + "</ol>";
  if (b.t === "to") return '<div class="b b-to">' + b.lines.map((l) => "<div>" + lineHtml(l) + "</div>").join("") + "</div>";
  if (b.t === "grid") return '<div class="b b-grid">' + b.rows.map(([k, v]) => "<div>" + H(k) + "</div><div>" + (typeof v === "string" ? H(v) : runsHtml([v])) + "</div>").join("") + "</div>";
  if (b.t === "item") return '<div class="b-item">' + H(b.no + ". " + b.title) + "</div>";
  if (b.t === "sig") {
    const ls = b.lines.map((l) => (l === "" ? '<div class="gap"></div>' : "<div>" + lineHtml(l) + "</div>"));
    // the signature's name sits on the line: the line after the gap
    const gi = b.lines.indexOf("");
    if (gi >= 0 && ls[gi + 1]) ls[gi + 1] = ls[gi + 1].replace("<div>", '<div class="line">');
    return '<div class="b-sig"><div>' + ls.join("") + "</div>" + (b.seal ? '<div class="b-seal" aria-hidden="true">Company<br>seal</div>' : "") + "</div>";
  }
  return "";
}

const initials = (name) => String(name || "").replace(/\b(private|limited|pvt|ltd|the|of|and|&)\b/gi, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "•";

// where the text may run on a page: [top, bottom] in px
function frame(model, letter) {
  if (model.kind === "minutes") return [letter ? 40 + LH_HEAD : MIN_HEAD + 26, PAGE.h - MIN_FOOT - 18];
  return letter ? [40 + LH_HEAD, PAGE.h - LH_FOOT - 34] : [PAD.top, PAGE.h - PAD.bottom];
}
export const room = (model, letter) => { const [a, b] = frame(model, letter); return b - a; };

// letter: {on, name, cin, address, phone, email, website, logo} (the letterhead) or null (plain paper)
export function pageHtml(model, letter, inner, no, total) {
  const [top, bottom] = frame(model, letter && letter.on ? letter : null);
  let head = "", foot = "";
  const lh = letter && letter.on;
  if (lh) {
    const logo = letter.logo ? '<span class="lh-logo img"><img alt="" src="' + H(letter.logo) + '"></span>' : '<span class="lh-logo" aria-hidden="true">' + H(initials(letter.name)) + "</span>";
    head = '<div class="lh-head" data-letterhead=""><div class="lh-row">' + logo + '<div><div class="lh-name">' + H(String(letter.name || "").toUpperCase()) + "</div>" + (letter.cin ? '<div class="lh-cin">CIN ' + H(letter.cin) + "</div>" : "") +
      '</div></div><div class="lh-rule"></div><div class="lh-rule2"></div></div>';
    const bits = [letter.address ? "Regd. Office: " + letter.address : "", letter.phone ? "Tel: " + letter.phone : "", letter.email || "", letter.website || ""].filter(Boolean);
    foot = bits.length ? '<div class="lh-foot">' + H(bits.join(" · ")) + "</div>" : "";
  }
  if (model.kind === "minutes") {
    // the minutes book's page: its header (or the letterhead), and the Chairman's initials on every page (SS-1 para 7.4)
    const n = (model.head.startPage || 1) + no - 1;
    if (!lh) head = '<div class="mb-head" data-minutes-head=""><span>' + H(model.head.left) + "</span><span>Page No. " + n + "</span></div>";
    foot = '<div class="mb-foot" data-initials=""><span>' + (lh ? "Minutes book page No. " + n + (no < total ? " · " : "") : "") + (no < total ? "Continued on page " + (n + 1) : "") +
      '</span><span class="mb-init"><span class="mb-box" aria-hidden="true"></span>Chairman’s initials</span></div>';
  }
  return '<div class="corp-a4" data-page="' + no + '">' + head + '<div class="pg-body" style="top:' + top + "px;height:" + (bottom - top) + 'px">' + inner + "</div>" + foot + "</div>";
}

// blocks into pages: a block that does not fit goes to the next page (a heading never left alone at a page's foot)
export function paginate(model, letter, measure) {
  const avail = room(model, letter && letter.on ? letter : null), pages = [[]];
  let used = 0;
  model.blocks.forEach((b, i) => {
    const h = measure(i);
    const keepNext = b.t === "item" || b.t === "subject";
    const nh = keepNext && i + 1 < model.blocks.length ? h + measure(i + 1) : h;
    if (used > 0 && used + nh > avail) { pages.push([]); used = 0; }
    pages[pages.length - 1].push(i); used += h;
  });
  return pages;
}

export function docHtml(model, letter, pages) {
  const html = model.blocks.map(blockHtml);
  return pages.map((ix, n) => pageHtml(model, letter, ix.map((i) => html[i]).join(""), n + 1, pages.length)).join("");
}

export function printPdf(model, letter, pages, title) {
  const w = window.open("", "_blank");
  if (!w) { if (typeof toast === "function") toast("Allow pop-ups for this site to save the PDF."); return null; }
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + H(title) + "</title>" +
    "<style>" + serifCss() + PAPER_CSS + "@page{size:A4 portrait;margin:0}html,body{margin:0;padding:0;background:#fff}.corp-a4{page-break-after:always;break-after:page}.corp-a4:last-child{page-break-after:auto;break-after:auto}" +
    "@media screen{body{background:#E9ECF2}.corp-a4{margin:16px auto;box-shadow:0 1px 4px rgba(0,0,0,.15)}}</style></head><body data-corp-print=\"\">" + docHtml(model, letter, pages) + "</body></html>");
  w.document.close();
  // the fonts first (the serif kept with the app, fonts.js), then the browser's print (Save as PDF)
  const go = () => { try { w.focus(); w.print(); } catch (e) { /* the person prints from the window */ } };
  try { (w.document.fonts && w.document.fonts.ready ? w.document.fonts.ready : Promise.resolve()).then(() => setTimeout(go, 250)); } catch (e) { setTimeout(go, 600); }
  return w;
}
export { runText };
