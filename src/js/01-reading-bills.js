/* @react-lazy: begin 01-reading-bills.js (the React app loads this file the first time a bill is read: readerLoad, src/js/82) */
/* ================================================================== */
/* Reading bills: the free reader (PDF text and OCR, checked by rules) */
/* and the reading service's prompt, taken out of src/js/01 so the     */
/* program every page loads (legacy.js) stays within its budget         */
/* ================================================================== */
// Only the reading of a file is here (extract, extractBest, readWithRetry, freeParse, freeReadOnly and what they use);
// the queue, the checks and what is done with a bill once read stay in src/js/01. Each caller waits for readerLoad()
// first (runJob, retryNotRead, rereadEntry, rereadCarefully, runSelfTest; readSalesFile in src/js/25): in the React app
// it loads this file (window.loadReader, app/src/main.jsx; kept by the service worker for offline use), in the one-file
// site it is in the page already.
// Trim empty paper around the writing, so close-ups cover text rather than margins.
function trimToContent(src){
  const k = Math.min(1, 400 / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"); g.drawImage(src, 0, 0, w, h);
  let d;
  try { d = g.getImageData(0, 0, w, h).data; } catch (e){ return src; }
  const lum = new Uint8Array(w * h), hist = new Uint32Array(256);
  for (let i = 0; i < w * h; i++){ const y = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 | 0; lum[i] = y; hist[y]++; }
  let acc = 0, paper = 255;
  for (let v = 255; v >= 0; v--){ acc += hist[v]; if (acc >= w * h * 0.5){ paper = v; break; } }
  const ink = paper - 45, rows = new Uint32Array(h), cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (lum[y * w + x] < ink){ rows[y]++; cols[x]++; }
  const band = (arr, len, other) => { let a = 0, b = len - 1; while (a < len && arr[a] < other * 0.01) a++; while (b > a && arr[b] < other * 0.01) b--; return [a, b]; };
  const [y0, y1] = band(rows, h, w), [x0, x1] = band(cols, w, h);
  if (y1 - y0 < h * 0.15 || x1 - x0 < w * 0.15) return src;
  const m = 0.03, X0 = Math.max(0, (x0 / w - m)), Y0 = Math.max(0, (y0 / h - m)), X1 = Math.min(1, (x1 + 1) / w + m), Y1 = Math.min(1, (y1 + 1) / h + m);
  if ((X1 - X0) * (Y1 - Y0) > 0.9) return src;
  return cropCanvas(src, Math.round(X0 * src.width), Math.round(Y0 * src.height), Math.round((X1 - X0) * src.width), Math.round((Y1 - Y0) * src.height));
}
// n overlapping horizontal strips, top to bottom, so each text line stays whole.
// A short, wide writing area needs fewer strips.
function stripsOf(src, n){
  if (src.width > src.height * 1.2) n = Math.max(1, Math.min(n, 2));
  const L = src.height, size = Math.min(L, Math.ceil(L / n * 1.15)), out = [];
  for (let i = 0; i < n; i++){
    const start = n === 1 ? 0 : Math.round(i * (L - size) / (n - 1));
    out.push(enhanceCanvas(cropCanvas(src, 0, start, src.width, size)));
  }
  return out;
}
// Page 1 in full plus close-ups, then further pages in full, within the per-call limit.
async function buildImageSet(canvases, careful){
  const max = S.imgMax, out = [];
  if (!max || !canvases.length) return out;
  if (max === 1){
    out.push(await imgBlob(enhanceCanvas(trimToContent(canvases[0])), "strip"));
    return out.filter(Boolean);
  }
  const stripCount = max >= 4 ? (careful ? 3 : 2) : max >= 3 ? 2 : 0;
  out.push(await imgBlob(canvases[0], "page"));
  if (stripCount) for (const st of stripsOf(trimToContent(canvases[0]), stripCount)) out.push(await imgBlob(st, "strip"));
  else out.push(await imgBlob(enhanceCanvas(trimToContent(canvases[0])), "strip"));
  for (let i = 1; i < canvases.length && out.length < max; i++) out.push(await imgBlob(canvases[i], "page"));
  return out.slice(0, max).filter(Boolean);
}
function buildPrompt(text, fileName, imageCount, kind){
  const list = rules().map(r => "- " + r.id + ": " + r.label + " (" + r.hint + ")").join("\n");
  const how = kind === "pdf_text"
    ? "The file is a PDF with a text layer; its text is below" + (imageCount ? " and its page images are attached" : "") + "."
    : "The invoice may be handwritten or a photo or scan: a kachcha bill, cash memo, manual bill-book page or a printed bill, possibly at an angle, faint, or partly in Hindi. " +
      (imageCount > 1 ? "The first image is the whole first page. The next images are enhanced close-up strips of that same page from top to bottom (they overlap), sent so small and handwritten writing is legible; any image after those is a further page. Use the whole page for layout and the strips to read the writing." : "The page image is attached.");
  return "You are reading one Indian purchase or expense bill for a chartered accountant. The buyer is the accountant's client and may need to deduct TDS.\n" +
    how + "\n" +
    (text ? "Text extracted from the file (may be incomplete):\n\"\"\"\n" + text + "\n\"\"\"\n" : "") +
    "File name: " + fileName + "\n\n" +
    "Extract the bill and classify the payment for TDS under India's Income-tax Act, 2025 (section 393). Choose natureId from:\n" + list + "\n\n" +
    "Reply with only one JSON object in this shape:\n" +
    "{\"docKind\": \"invoice\"|\"proforma\"|\"purchase_order\"|\"quotation\"|\"challan\"|\"receipt\"|\"statement\", \"shipGstin\": string|null, \"items\": [{\"description\": string, \"hsn\": string|null, \"qty\": number|null, \"unit\": string|null, \"rate\": number|null, \"taxable\": number, \"gstRate\": number|null}], \"vendorName\": string, \"vendorGstin\": string|null, \"vendorPan\": string|null, \"buyerName\": string|null, \"buyerGstin\": string|null, \"invoiceNo\": string|null, \"invoiceDate\": \"YYYY-MM-DD\"|null, \"taxableValue\": number|null, \"cgst\": number, \"sgst\": number, \"igst\": number, \"totalAmount\": number|null, \"description\": string, \"natureId\": string, \"natureReason\": string, \"confidence\": number, \"rentMonths\": number|null, \"handwritten\": boolean, \"uncertainFields\": string[], \"legibilityNote\": string}\n" +
    "How to read:\n" +
    "- The vendor issued the bill (name at the top, stamp or signature); the buyer is who it is billed to (\"M/s\", \"To\", \"Bill to\", \"Buyer\").\n" +
    "- Amounts: Indian grouping (1,25,000 = 125000), \"/-\" and \"Rs.\" mark rupees. If the amount is also written in words, use the words to confirm or correct the figure.\n" +
    "- If GST is not charged separately, taxableValue equals the total and all GST heads are 0. If the total is not written, add up the item lines (quantity x rate).\n" +
    "- Dates are day first (12/09/26 = 2026-09-12). A GSTIN has 15 characters; copy it exactly or give null.\n" +
    "- Give vendorPan only if a PAN is written; do not work it out. Use null for anything not on the bill, rather than guessing.\n" +
    "- docKind: what the paper actually is. A proforma invoice, purchase order, quotation, delivery challan or receipt is NOT a purchase bill.\n" +
    "- buyerGstin: the GSTIN in the \"Bill to\" block. shipGstin: the GSTIN in the \"Ship to\" or consignee block, when it is different.\n" +
    "- items: one entry for each line on the bill, each with its own GST rate when the bill shows more than one. Leave items empty if the bill has no line detail.\n" +
    "- description: at most 100 characters on what was supplied. natureReason: at most 160 characters. confidence: 0 to 1 for the natureId choice. rentMonths: months billed, only for rent.\n" +
    "- handwritten: true if the key figures are handwritten. uncertainFields: names of fields from the shape above that you could not read with confidence (for example \"totalAmount\", \"invoiceDate\"). legibilityNote: at most 120 characters on what was hard to read, or an empty string.";
}
// pull item rows out of the lines between the table heading and the totals
function readItems(lines){
  const rows = itemLines(lines);
  const out = [];
  rows.forEach(l0 => {
    // addresses, IPs, phone numbers and web addresses are not amounts
    const l = String(l0)
      .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, " ")
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
      .replace(/\b(?:ip|server|mac|imei|port)\b\s*[-:]?\s*\S+/gi, " ")
      .replace(/\+?\d{2}[- ]?\d{10}\b/g, " ");
    const amts = lineAmounts(l).filter(a => a.strong || a.v > 0).map(a => a.v);
    if (!amts.length) return;
    const hsn = (l.match(/\b(\d{4}|\d{6}|\d{8})\b/g) || []).find(c => /^(0[1-9]|[1-9]\d)/.test(c) && (c.length === 4 || c.length === 6 || c.length === 8) && num(c) > 1000) || "";
    // many bills print: HSN | GST% | quantity | unit | rate | amount
    if (hsn){
      const after = l.slice(l.indexOf(hsn) + hsn.length);
      const nums = (after.match(/-?[\d,]+(?:\.\d+)?/g) || []).map(x => num(x)).filter(x => x > 0);
      const unitM2 = after.match(/\b([A-Za-z]{2,8})\b(?=\s*[\d,])/);
      if (nums.length >= 4){
        const [g, q, rt, amt] = [nums[0], nums[1], nums[2], nums[nums.length - 1]];
        if (g <= 28 && q > 0 && rt > 0 && Math.abs(r2(q * rt) - amt) <= Math.max(2, amt * 0.02)){
          const desc2 = l.slice(0, l.indexOf(hsn)).replace(/^\s*\d+[.)]?\s*/, "").replace(/\s+/g, " ").trim();
          out.push({desc: desc2.slice(0, 80), hsn, qty: q, unit: unitM2 ? unitM2[1] : "", rate: rt, taxable: r2(amt), gstRate: g});
          return;
        }
      }
      if (nums.length === 3 && Math.abs(r2(nums[0] * nums[1]) - nums[2]) <= Math.max(2, nums[2] * 0.02)){
        const desc3 = l.slice(0, l.indexOf(hsn)).replace(/^\s*\d+[.)]?\s*/, "").replace(/\s+/g, " ").trim();
        out.push({desc: desc3.slice(0, 80), hsn, qty: nums[0], unit: unitM2 ? unitM2[1] : "", rate: nums[1], taxable: r2(nums[2]), gstRate: null});
        return;
      }
    }
    const unitM = l.match(UNIT_WORDS);
    const taxable = amts[amts.length - 1];
    let qty = 0, rate = 0;
    if (amts.length >= 3){ qty = amts[amts.length - 3]; rate = amts[amts.length - 2]; }
    else if (amts.length === 2){ rate = amts[0]; qty = rate ? r2(taxable / rate) : 0; }
    if (qty && rate && Math.abs(r2(qty * rate) - taxable) > Math.max(1, taxable * 0.02)){ qty = 0; rate = 0; }
    const gstM = l.match(/(\d{1,2}(?:\.\d+)?)\s*%/);
    const desc = l.replace(/\s{2,}/g, " ").replace(/[\d,]+\.\d{2}/g, "").replace(/\b\d{4,8}\b/g, "").replace(UNIT_WORDS, "").replace(/\s+/g, " ").trim();
    if (desc.replace(/[^A-Za-z]/g, "").length < 3) return;
    out.push({desc: desc.slice(0, 80), hsn, qty, unit: unitM ? unitM[0] : "", rate, taxable, gstRate: gstM ? num(gstM[1]) : null});
  });
  // drop specks: a line worth almost nothing next to the rest is noise, not an item
  const big = out.reduce((a, i) => Math.max(a, num(i.taxable)), 0);
  return out.filter(i => num(i.taxable) >= Math.max(5, big * 0.005)).slice(0, 40);
}
// a note's own number, and the invoice it is against
function noteNoOf(lines){
  const t = [].concat(lines || []).slice(0, 40).join("\n");
  const m = t.match(/\b(?:credit|debit)\s*note\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-.]{1,30})/i) || t.match(/\b(?:cn|dn)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-.]{1,30})/i);
  const a = t.match(/\b(?:against|original|ref(?:erence)?\.?\s*to)\s*(?:invoice|bill)?\s*(?:no|number|#)?\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-.]{2,30})/i);
  return {no: m ? m[1].replace(/[.\-]+$/, "") : "", against: a ? a[1].replace(/[.\-]+$/, "") : ""};
}
const FREE_GST_RATES = [0.25, 1.5, 3, 5, 6, 12, 18, 28, 40];
function ocrDigits(s){ return s.replace(/[OoQD]/g, "0").replace(/[Il|!]/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2").replace(/G/g, "6"); }
function ocrLetters(s){ return s.replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B").replace(/2/g, "Z").replace(/6/g, "G"); }
// Candidate GSTINs, repaired by position (digits where digits belong) and by the check digit.
function findGstins(text){
  const out = [], seen = new Set();
  const lines = String(text || "").split(/\n/);
  const buyerAt = lines.findIndex(l => /(buyer|bill(ed)?\s*to|consignee|ship(ped)?\s*to|recipient|details\s+of\s+receiver)/i.test(l));
  lines.forEach((line, li) => {
    const up = line.toUpperCase().replace(/[‘’'`]/g, "");
    const re = /(?:^|[^A-Z0-9])([0-9OIQDSBZG|!]{2}\s?[A-Z0-9]{5}\s?[0-9OIQDSBZG|!]{4}\s?[A-Z0-9]\s?[A-Z0-9]\s?[Z2]\s?[A-Z0-9])(?![A-Z0-9])/g;
    let m;
    while ((m = re.exec(up))){
      const raw = m[1].replace(/\s/g, "");
      if (raw.length !== 15) continue;
      const g = ocrDigits(raw.slice(0, 2)) + ocrLetters(raw.slice(2, 7)) + ocrDigits(raw.slice(7, 11)) + ocrLetters(raw.slice(11, 12)) + raw[12] + "Z" + raw[14];
      const f = fixGstin(g);
      if (f.status === "ok" || f.status === "fixed"){
        if (seen.has(f.value)) continue;
        seen.add(f.value);
        const ctx = (lines[li - 1] || "") + " " + line + " " + (lines[li - 2] || "");
        out.push({gstin: f.value, line: li, buyerHint: (buyerAt >= 0 && li > buyerAt && li - buyerAt <= 12) || /(bill(ed)?\s*to|buyer|consignee|recipient|ship(ped)?\s*to|customer|party|m\/s|\bto\b)/i.test(ctx)});
      }
    }
    // second look, on lines that mention GST: join the pieces and try every 15-character window
    if (/G\s?\.?\s?S\s?\.?\s?T|GST|65T|6ST|C5T/i.test(up)){
      const compact = up.replace(/[^A-Z0-9|!]/g, "");
      for (let i = 0; i + 15 <= compact.length; i++){
        const raw = compact.slice(i, i + 15);
        const g = ocrDigits(raw.slice(0, 2)) + ocrLetters(raw.slice(2, 7)) + ocrDigits(raw.slice(7, 11)) + ocrLetters(raw.slice(11, 12)) + raw[12] + "Z" + raw[14];
        if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(g)) continue;
        const f = fixGstin(g);
        if ((f.status === "ok" || f.status === "fixed") && !seen.has(f.value)){
          seen.add(f.value);
          const ctx = (lines[li - 1] || "") + " " + line + " " + (lines[li - 2] || "");
          out.push({gstin: f.value, line: li, buyerHint: (buyerAt >= 0 && li > buyerAt && li - buyerAt <= 12) || /(bill(ed)?\s*to|buyer|consignee|recipient|ship(ped)?\s*to)/i.test(ctx)});
        }
      }
    }
  });
  return out;
}
function parseAmount(s){
  const t = String(s).replace(/[Oo]/g, "0").replace(/[, ]/g, "");
  const n = parseFloat(t);
  return isFinite(n) ? n : null;
}
// Amounts on a line: money-shaped numbers, not rates ("18%"), not codes.
function lineAmounts(line){
  const out = [];
  const re = /(-?\s?(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?)(\s*%)?/g;
  let m;
  while ((m = re.exec(line))){
    if (m[2]) continue;
    const raw = m[1];
    const hasDec = /\.\d{1,2}$/.test(raw), hasComma = raw.includes(",");
    const v = parseAmount(raw);
    if (v === null) continue;
    if (!hasDec && !hasComma && Math.abs(v) >= 100000) continue;   // phone, account or HSN numbers
    out.push({v, strong: hasDec || hasComma});
  }
  return out;
}
// A heading row of a table: several column labels, or an item-table heading.
function isHeadingRow(line){
  if (lineAmounts(line).some(a => a.strong)) return false;
  const labels = colLabels().filter(([, re]) => re.test(line)).length;
  return labels >= 2 || (/(description|particulars|item)/i.test(line) && /(qty|quantity|rate|hsn|sac|amount|value)/i.test(line));
}
function amountAfter(lines, re, opts){
  opts = opts || {};
  const hits = [];
  lines.forEach((line, i) => {
    if (!re.test(line)) return;
    if (/in\s*words|rupees\s+[a-z]/i.test(line)) return;
    let am = lineAmounts(line.replace(re, " ")).filter(a => a.strong);
    if (!am.length && lines[i + 1] && !opts.sameLineOnly && !isHeadingRow(line)) am = lineAmounts(lines[i + 1]).filter(a => a.strong);
    if (am.length) hits.push(am[am.length - 1].v);
  });
  if (!hits.length) return null;
  return opts.pick === "max" ? Math.max(...hits) : opts.pick === "first" ? hits[0] : hits[hits.length - 1];
}
function datesIn(s){
  const out = [];
  let m;
  const r1 = /\b(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4}|\d{2})\b/g;
  while ((m = r1.exec(s))){ const d = toIsoDate(m[1], m[2], m[3]); if (d) out.push(d); }
  const r2 = /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-\/.]*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s\-\/.,]*(\d{4}|\d{2})\b/gi;
  while ((m = r2.exec(s))){ const d = toIsoDate(m[1], MONTHS[m[2].toLowerCase()], m[3]); if (d) out.push(d); }
  const r3 = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  while ((m = r3.exec(s))){ const d = toIsoDate(m[2], MONTHS[m[1].toLowerCase()], m[3]); if (d) out.push(d); }
  return out;
}
const OTHER_DATES = /(ack(nowledge?ment)?|due|delivery|dispatch|despatch|order|p\.?\s?o|lr|gr|challan|e-?way(\s*bill)?|supply|payment|ref(erence)?|irn|valid(ity)?|expiry|birth)\.?\s*(no\.?\s*)?(&\s*)?date/i;
function findDate(lines){
  for (const re of [/(invoice|inv|bill|document|doc)\.?\s*(no\.?\s*(&|and|\/)\s*)?date/i, /\bdated?\b/i, /\bdt\.?\s/i]){
    for (let i = 0; i < lines.length; i++){
      if (!re.test(lines[i])) continue;
      // cut out other kinds of dates on the same line ("Ack Date : 10-Sep-26")
      const clean = lines[i].replace(new RegExp(OTHER_DATES.source + "\\s*[:\\-]?\\s*\\S+(\\s+\\S+)?", "ig"), " ");
      if (!re.test(clean)) continue;
      const after = clean.slice(clean.search(re));
      const d = datesIn(after)[0] || (lines[i + 1] ? datesIn(lines[i + 1])[0] : "") || (lines[i + 2] && lines[i + 2].length < 40 ? datesIn(lines[i + 2])[0] : "");
      if (d) return d;
    }
  }
  // a date wrapped by a narrow cell: "10-Sep-" on one line, "2026" on the next
  for (let i = 0; i < lines.length - 1; i++){
    if (OTHER_DATES.test(lines[i])) continue;
    const m = lines[i].match(/(?:^|\s)(\d{1,2})[\-\/.\s](jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\-\/.]?$|(?:^|\s)(\d{1,2})[\-\/.\s](jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\-\/.]\s/i);
    if (!m) continue;
    const d = m[1] || m[3], mon = (m[2] || m[4]).toLowerCase();
    for (let k = i + 1; k <= Math.min(i + 2, lines.length - 1); k++){
      const y = lines[k].match(/(?:^|\s)(20\d{2})(?=\s|$)/);
      if (y){ const iso = toIsoDate(d, MONTHS[mon], y[1]); if (iso) return iso; }
    }
  }
  return "";
}
// ---- GST labels, tolerant of OCR ("CGSTAmL", "IGST18"), but not GSTIN ----
// OCR often reads G as 6 and I as 1 or l ("16ST", "C6ST")
// Safari before 16.4 cannot read a regular expression with a look-behind, and then the whole program fails to load (Mac
// Safari stuck on "Opening FinCom", 17-Oct-2026). The few that had one check "not right after <chars>" here instead: the
// match whose group 2 took part is refused when the character before it is one of notAfter, and the search goes on from the
// next character, which gives exactly the matches of /…(?<![chars])…/ (test, exec, match and replace all go through exec)
class NotAfterRegExp extends RegExp {
  constructor(src, flags, notAfter){ super(src, flags); this.notAfter = notAfter; }
  exec(s){
    s = String(s); const g = this.global || this.sticky, re = new RegExp(this.source, this.flags.replace(/[gy]/g, "") + "g");
    re.lastIndex = g ? this.lastIndex : 0;
    let m;
    while ((m = RegExp.prototype.exec.call(re, s))){
      if (!this.notAfter || m[2] === undefined || m.index === 0 || !this.notAfter.test(s[m.index - 1])){ if (g) this.lastIndex = m.index + m[0].length; return m; }
      re.lastIndex = m.index + 1;
    }
    if (g) this.lastIndex = 0;
    return null;
  }
}
const RE_CGST = /\bc\s?[g6]st(?!\s?in\b)/i, RE_SGST = /\b(s|ut)\s?[g6]st(?!\s?in\b)/i, RE_IGST = new NotAfterRegExp("(\\bi\\s?[g6]st|([1l|])[g6]st)(?!\\s?in\\b)", "i", /[\w.,]/);
const NUMBER_WORD_RE = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|lacs?|crores?)\b/ig;
function numberWordCount(l){ return (String(l).match(NUMBER_WORD_RE) || []).length; }
// PANs printed on the bill (labelled), for suppliers without GSTIN
const PAN_HOLDER = /^[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]$/;
function findPans(lines){
  const out = [];
  lines.forEach((l, i) => {
    const ctx = (lines[i - 1] || "") + " " + l;
    if (!/\bpan\b/i.test(ctx)) return;
    (l.toUpperCase().match(/\b[A-Z]{5}[0-9OIL]{4}[A-Z]\b/g) || []).forEach(raw => {
      const p = raw.slice(0, 5) + ocrDigits(raw.slice(5, 9)) + raw[9];
      if (PAN_HOLDER.test(p) && out.indexOf(p) < 0) out.push(p);
    });
  });
  return out;
}
// Rates printed on the bill ("18%", "@ 5%", "9 %")
function ratesShown(lines){
  const set = new Set();
  lines.forEach(l => (l.match(/(\d{1,2}(?:\.\d{1,2})?)\s*%/g) || []).forEach(m => { const v = parseFloat(m); if (FREE_GST_RATES.includes(v) || FREE_GST_RATES.includes(v * 2)) set.add(FREE_GST_RATES.includes(v * 2) && !FREE_GST_RATES.includes(v) ? v * 2 : v); }));
  return Array.from(set).sort((a, b) => a - b);
}
// ---- amount in words (Indian numbering) ----
const WORD_NUMS = {zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13,
  fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19, twenty:20, thirty:30, forty:40, fourty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90};
const WORD_SCALES = {thousand:1e3, lakh:1e5, lakhs:1e5, lac:1e5, lacs:1e5, million:1e6, crore:1e7, crores:1e7};
function wordsValue(words){
  let total = 0, cur = 0, any = false;
  for (const w of words){
    if (w in WORD_NUMS){ cur += WORD_NUMS[w]; any = true; }
    else if (w === "hundred"){ cur = (cur || 1) * 100; any = true; }
    else if (WORD_SCALES[w]){ total += (cur || 1) * WORD_SCALES[w]; cur = 0; any = true; }
    else if (w === "and") continue;
    else return null;   // an unknown word: do not trust this reading
  }
  return any ? total + cur : null;
}
// Returns the amount written in words, only when every word was understood.
function amountInWords(lines, mode){
  for (let i = 0; i < lines.length; i++){
    const L = lines[i];
    const looks = /(in\s*words|\brupees?\b|\binr\s+[a-z]|\brs\.?\s+[a-z]{3,})/i.test(L) || (/\bonly\b/i.test(L) && numberWordCount(L) >= 2);
    if (!looks) continue;
    const isTax = /\b(tax|gst)\s*(amount|amt)?\b.*in\s*words|\btax\s*amount\b/i.test(L);
    if ((mode === "tax") !== isTax) continue;
    const parts = [];
    for (let k = i; k < Math.min(lines.length, i + 4); k++){
      const l = lines[k].toLowerCase();
      if (k > i && /\d/.test(l)) continue;             // a figures line placed in between
      if (k > i && !numberWordCount(l) && !/\bonly\b/.test(l)) { if (parts.length) break; else continue; }
      let seg = l;
      if (k === i){
        if (/(rupees?|inr|rs\.?)\s+[a-z]/.test(l) && numberWordCount(l.replace(/^.*?(rupees?|inr|rs\.?)\s+/, "")) > 0) seg = l.replace(/^.*?(rupees?|inr|rs\.?)\s+/, "");
        else if (/in\s*words/.test(l)) seg = l.replace(/^.*in\s*words\)?\s*[:\-]?/, "");
        else if (numberWordCount(l) >= 2){
          // "Eighteen Thousand Nine Hundred Rupees only", or a misread "Res. Thirty One ..."
          const m = l.match(/((?:\b[a-z]+\b[\s,\-]*)+?)\s*(?:rupees?\s*)?only\b/);
          seg = m ? m[1] : l;
          seg = seg.replace(/^.*?\b(?=(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)\b)/, "");
        } else continue;
      }
      parts.push(seg);
      if (/\bonly\b/.test(l)) break;
    }
    const text = parts.join(" ").replace(/\bonly\b.*$/, "").replace(/[^a-z\s]/g, " ");
    const words = text.split(/\s+/).filter(w => w && !/^(rupees?|inr|rs|indian|res)$/.test(w));
    if (!words.length) continue;
    const pi = words.indexOf("paise");
    let rup = words, pai = [];
    if (pi >= 0){
      const andIdx = words.lastIndexOf("and", pi);
      rup = words.slice(0, andIdx >= 0 ? andIdx : pi);
      pai = words.slice(andIdx >= 0 ? andIdx + 1 : pi, pi);
      if (words.slice(pi + 1).length) continue;
    }
    const r = wordsValue(rup);
    if (r === null || r <= 0) continue;
    const p = pai.length ? wordsValue(pai) : 0;
    if (p === null) continue;
    return Math.round((r + p / 100) * 100) / 100;
  }
  return null;
}
// ---- GST summary tables: labels in one row, amounts in the row below ----
function colLabels(){ return COL_LABELS; }
const COL_LABELS = [
  ["taxable", /tax'?\s?able\s*(value|amount|amt)?|assessable/i],
  ["cgst", /\bc\s?gst(?!\s?in\b)/i], ["sgst", /\b(s|ut)\s?gst(?!\s?in\b)/i], ["igst", /\bi\s?gst(?!\s?in\b)/i],
  ["total", /(total\s*(inv(oice)?\.?\s*)?(value|amount|amt)|invoice\s*(value|total|amount)|grand\s*total|amount\s*payable)/i]
];
function tableColumns(lines){
  const found = {};
  for (let i = 0; i < lines.length - 1; i++){
    const l = lines[i];
    if (lineAmounts(l).some(a => a.strong)) continue;
    const hits = [];
    for (const [k, re] of COL_LABELS){ const m = l.match(re); if (m) hits.push({k, at: m.index}); }
    if (hits.length < 2) continue;
    hits.sort((a, b) => a.at - b.at);
    for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++){
      const am = lineAmounts(lines[j]).filter(a => a.strong);
      if (am.length >= hits.length){
        const vals = am.slice(-hits.length);
        hits.forEach((h, idx) => { if (found[h.k] === undefined) found[h.k] = vals[idx].v; });
        break;
      }
    }
  }
  return found;
}
// IGST / CGST / SGST / UTGST mentioned as a tax line (not "GSTIN")
function gstShown(lines){ return lines.some(l => (RE_CGST.test(l) || RE_SGST.test(l) || RE_IGST.test(l)) && !/\b(0(\.0+)?\s*%|nil|exempt)/i.test(l)); }
function amountShown(lines, v){
  if (v === null || v === undefined) return false;
  return lines.some(l => lineAmounts(l).some(a => Math.abs(a.v - v) < 0.01));
}
// ---- Reconcile the figures: total − GST must equal a taxable value printed on the bill ----
function taxWordsAmount(lines){ return amountInWords(lines, "tax"); }
function reconcileFigures(lines, found){
  const round = v => Math.round(v * 100) / 100;
  const totals = [], gsts = [];
  const addT = (v, w, from) => { if (v > 0) totals.push({v: round(v), w, from}); };
  const addG = (v, w, parts, from) => { if (v >= 0) gsts.push({v: round(v), w, parts, from}); };
  const hasI = lines.some(l => RE_IGST.test(l)), hasCS = lines.some(l => RE_CGST.test(l) || RE_SGST.test(l));
  // CGST+SGST inside a state, IGST across states; the GSTIN state codes decide when the labels do not
  const split = g => (hasI && !hasCS) ? {igst: g} : (hasCS && !hasI) ? {cgst: round(g / 2), sgst: round(g / 2)}
    : (found.supplierState && found.buyerState && found.supplierState !== found.buyerState) ? {igst: g} : {cgst: round(g / 2), sgst: round(g / 2)};
  addT(found.inWords, 3, "amount in words");
  addT(found.total, 2, "total line");
  addT(found.tblTotal, 1, "summary table");
  lines.forEach((l, i) => {
    if (/^(grand\s*)?total\b/i.test(l) && !/(tax|qty|quantity)/i.test(l)){
      let am = lineAmounts(l).filter(a => a.strong);
      if (!am.length && lines[i + 1]) am = lineAmounts(lines[i + 1]).filter(a => a.strong).slice(-1);
      if (am.length === 1 || (am.length > 1 && /(₹|rs\.?|inr)/i.test(l))) addT(am[am.length - 1].v, /(₹|rs\.?|inr)/i.test(l) ? 2 : 1, "total line");
    }
    if (/\b(net\s*amount|net\s*payable|amount\s*payable|total\s*inv\.?\s*(amt|amount|value))\b/i.test(l)){
      const am = lineAmounts(l).filter(a => a.strong);
      if (am.length) addT(am[am.length - 1].v, 1, "total line");
    }
  });
  // GST lines
  const igstL = [], cgstL = [], sgstL = [];
  lines.forEach(l => {
    const am = lineAmounts(l).filter(a => a.strong).map(a => a.v).filter(v => v > 0);
    if (!am.length) return;
    const i = RE_IGST.test(l), c = RE_CGST.test(l), s = RE_SGST.test(l);
    if (i && !c && !s) igstL.push(am[am.length - 1]);
    else if (c && !s && !i) cgstL.push(am[am.length - 1]);
    else if (s && !c && !i) sgstL.push(am[am.length - 1]);
  });
  const uniq = a => Array.from(new Set(a));
  uniq(igstL).forEach(v => addG(v, 2, {igst: v}, "IGST line"));
  if (uniq(igstL).length > 1) addG(uniq(igstL).reduce((a, b) => a + b, 0), 2, {igst: round(uniq(igstL).reduce((a, b) => a + b, 0))}, "IGST lines added");
  uniq(cgstL).forEach(c => { if (sgstL.some(s => Math.abs(s - c) < 0.01)) addG(c * 2, 2, {cgst: c, sgst: c}, "CGST + SGST lines"); });
  if (uniq(cgstL).length > 1){
    const cs = round(uniq(cgstL).reduce((a, b) => a + b, 0)), ss = round(uniq(sgstL).reduce((a, b) => a + b, 0));
    if (Math.abs(cs - ss) < 0.02) addG(cs + ss, 2, {cgst: cs, sgst: ss}, "CGST + SGST lines added");
  }
  const tw = taxWordsAmount(lines);
  if (tw !== null) addG(tw, 3, split(tw), "tax amount in words");
  if (found.tblGst) addG(found.tblGst, 1, found.tblParts, "summary table");
  if (!gstShown(lines)) addG(0, 1, {}, "no GST on the bill");
  // table rows where the largest amount is the sum of the others: taxable + tax(es) = total
  lines.forEach(l => {
    const am = lineAmounts(l).filter(a => a.strong).map(a => a.v).filter(v => v > 0);
    if (am.length < 3 || am.length > 14) return;
    const M = Math.max(...am), rest = am.filter((v, k) => k !== am.indexOf(M));
    for (let a = 0; a < rest.length; a++) for (let b = 0; b < rest.length; b++){
      if (b === a) continue;
      if (Math.abs(rest[a] + rest[b] - M) < 0.02 && rest[a] > rest[b]){ addT(M, 2, "table row"); addG(rest[b], 2, split(rest[b]), "table row"); }
      for (let c = b + 1; c < rest.length; c++){
        if (c === a || rest[a] <= rest[b]) continue;
        if (Math.abs(rest[a] + rest[b] + rest[c] - M) < 0.02 && Math.abs(rest[b] - rest[c]) < 0.01){ addT(M, 2, "table row"); addG(rest[b] + rest[c], 2, {cgst: rest[b], sgst: rest[c]}, "table row"); }
      }
    }
  });
  // a single-rate bill: total ÷ (1 + rate) is a printed taxable value, and the difference is printed as tax
  totals.filter(t => t.w >= 2).forEach(t => FREE_GST_RATES.forEach(r => {
    const tx = round(t.v / (1 + r / 100)), g = round(t.v - tx);
    if (g > 0 && amountShown(lines, tx) && (amountShown(lines, g) || amountShown(lines, round(g / 2)))) addG(g, 2, split(g), "rate " + r + "% on a printed taxable value");
  }));
  const rates = ratesShown(lines);
  const rateOk = (g, tx) => {
    const eff = g / tx * 100;
    if (FREE_GST_RATES.some(r => Math.abs(eff - r) <= 0.15)) return true;
    // several rates on one bill: the overall rate lies between the lowest and highest printed rate
    return rates.length >= 2 && eff > rates[0] + 0.05 && eff < rates[rates.length - 1] - 0.05 ? "mixed" : false;
  };
  const shownAmounts = [];
  lines.forEach(l => lineAmounts(l).forEach(a => { if (a.strong && a.v > 0) shownAmounts.push(a.v); }));
  const roLines = [0];
  lines.forEach(l => { if (/(round(ed)?\s*[-]?\s*off|\br\s*[\/i1l]\s*o(ff)?\b)/i.test(l)) lineAmounts(l).forEach(a => { if (Math.abs(a.v) <= 1 && a.v !== 0) roLines.push(a.v, -a.v); }); });
  let best = null;
  for (const t of totals) for (const g of gsts){
    let tx = null, ro = 0, roPenalty = 0;
    for (const r of roLines){ const c = round(t.v - g.v - r); if (c > 0 && amountShown(lines, c)){ tx = c; ro = r; break; } }
    if (tx === null){
      // round off not printed or not read: accept a printed taxable value within ₹1
      const want = t.v - g.v;
      const near = shownAmounts.filter(v => Math.abs(v - want) <= 1 && Math.abs(v - want) > 0.005).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
      if (near){ tx = near; ro = round(want - near); roPenalty = 1; }
    }
    if (tx === null || tx <= 0) continue;
    const rk = g.v > 0 ? rateOk(g.v, tx) : true;
    if (!rk) continue;
    const score = t.w + g.w + (ro === 0 ? 1 : 0) - roPenalty - (rk === "mixed" ? 1 : 0)
      + totals.filter(x => x !== t && Math.abs(x.v - t.v) < 0.01).length + gsts.filter(x => x !== g && Math.abs(x.v - g.v) < 0.01).length;
    if (!best || score > best.score) best = {score, total: t.v, taxable: tx, gst: g.v, parts: g.parts, ro, mixed: rk === "mixed" ? rates : null, from: [t.from, g.from]};
  }
  return best;
}
// ---- Bill number: pick the most invoice-like token on a line ----
function invoiceTokenScore(tok, line){
  if (!/\d/.test(tok) || tok.length < 2) return -9;
  if (/^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(tok) || /^\d{1,2}-[a-z]{3}-\d{2,4}$/i.test(tok)) return -9;   // dates
  if (/^\d+(st|nd|rd|th)$/i.test(tok) || /^\d{6}$/.test(tok) || /^\d{10,}$/.test(tok)) return -9;               // floors, PIN codes, phone / account numbers
  if (GSTIN_RE.test(tok.toUpperCase())) return -9;
  let s = 0;
  if (/(^|[\/\-])(20)?(\d{2})[\-\/](20)?(\d{2})([\/\-]|$)/.test(tok)){
    const m = tok.match(/(?:20)?(\d{2})[\-\/](?:20)?(\d{2})/);
    if (m && (+m[1] + 1) % 100 === +m[2] % 100) s += 6;       // financial year inside: 2026-27
  }
  if (/\//.test(tok)) s += 2;
  if (tok.length >= 5) s += 1;
  if (/^(b|t|a|c|d|e|f|g|h|plot|sector|block|flat|shop|unit|floor|gali|wz|rz)[\-\/]?\d{1,3}$/i.test(tok)) s -= 4;   // address bits: B-17, T-01, Sector-3
  const before = line.slice(0, line.indexOf(tok)).toLowerCase();
  if (/(floor|sector|plot|block|road|nagar|street|near|tower|building|khasra|house|pin)\W*$/.test(before)) s -= 3;
  return s;
}
function bestInvoiceToken(line, minScore){
  const toks = (line.match(/[A-Za-z0-9][A-Za-z0-9\/\-_.]{0,29}/g) || []).map(t => t.replace(/[.\-\/]+$/, ""));
  let best = null;
  toks.forEach(t => { const sc = invoiceTokenScore(t, line); if (sc >= minScore && (!best || sc > best.sc)) best = {t, sc}; });
  return best ? best.t : "";
}
function findInvoiceNo(lines, fileName){
  const labels = [/(tax\s*)?invoice\s*(no|number|num|#)\.?/i, /(?:^|\s)#(?=\s*[A-Z]{0,6}[\-\/]?\d)/, /\binv\.?\s*(no|number|#)\.?/i, /(bill|document|doc|voucher|memo|challan)\s*(no|number|#)\.?/i, /\bserial\s*no\.?/i, /\bsr\.?\s*no\.?/i];
  const isDate = t => /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(t);
  const pick = str => {
    const t = (String(str).replace(/^((\s*(&|and|\/)\s*date)|[\s:.\-#])+/i, "").match(/^([A-Za-z0-9][A-Za-z0-9\/\-_.]{0,29})/) || [])[1];
    return t && /\d/.test(t) && !isDate(t) ? t.replace(/[.\-\/]+$/, "") : "";
  };
  for (const re of labels){
    for (let i = 0; i < lines.length; i++){
      const m = lines[i].match(re);
      if (!m) continue;
      const got = pick(lines[i].slice(m.index + m[0].length));
      if (got && invoiceTokenScore(got, lines[i]) > -3) return got;
      // labels in a heading row, value in the row below (often next to address text)
      for (let k = i + 1; k <= Math.min(i + 2, lines.length - 1); k++){
        const shortLine = (lines[k].match(/[A-Za-z0-9][A-Za-z0-9\/\-_.]*/g) || []).length <= 2;
        const tok = bestInvoiceToken(lines[k], shortLine ? 0 : 2);
        if (tok && !(shortLine && /^\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}$/.test(tok))) return tok;
      }
    }
  }
  // financial-year style numbers: "PRI/26-27/0214", "INV/2026-27/214", also when a narrow cell wraps them
  const fy = (a, b) => { a = +a % 100; b = +b % 100; return (a + 1) % 100 === b; };
  for (const l of lines){
    const m = l.match(/(?:^|\s)([A-Z]{1,10}[\/\-])?((?:20)?(\d{2})[\-\/](?:20)?(\d{2}))[\/\-]((?:[A-Z]{1,8}[\/\-])?[A-Z]{0,4}\d{1,8})(?=\s|$)/);
    // a date such as 09-10-2026 also looks like this, so without a prefix the last part must not be a year
    if (m && fy(m[3], m[4]) && (m[1] || !/^(19|20)?\d{2}$/.test(m[5]))) return m[0].trim();
  }
  for (let i = 0; i < lines.length - 1; i++){
    const a = lines[i].match(/(?:^|\s)([A-Z]{1,10}[\/\-](?:20)?(\d{2})[\-\/])$|(?:^|\s)([A-Z]{1,10}[\/\-](?:20)?(\d{2})[\-\/])\s/);
    if (!a) continue;
    const head = a[1] || a[3], y1 = a[2] || a[4];
    for (let k = i + 1; k <= Math.min(i + 2, lines.length - 1); k++){
      const b = lines[k].match(/(?:^|\s)((?:20)?(\d{2})[\/\-]([A-Z]{0,4}\d{1,8}))(?=\s|$)/g) || [];
      for (const cand of b){
        const mm = cand.trim().match(/^(?:20)?(\d{2})[\/\-]([A-Z]{0,4}\d{1,8})$/);
        if (mm && fy(y1, mm[1])) return head + cand.trim();
      }
    }
  }
  // the file name, e.g. "Supplier inv-214.pdf", only if that number is also printed on the bill
  const fm = String(fileName || "").match(/(?:inv(?:oice)?|bill)[\s_\-#.]*([A-Za-z0-9\/\-]{1,20}?\d[A-Za-z0-9\/\-]*)/i);
  if (fm){
    const tok = fm[1].replace(/\.(pdf|jpe?g|png|webp)$/i, "");
    const re = new RegExp("(^|[^A-Za-z0-9])" + tok.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&") + "([^A-Za-z0-9]|$)");
    if (lines.some(l => re.test(l))) return tok;
  }
  return "";
}
const NAME_SKIP = /(tax\s*invoice|invoice|original|duplicate|triplicate|recipient|gstin|pan\b|phone|mob|e-?mail|www\.|bill\s*of\s*supply|cash\s*memo|credit|debit|state|page\s*\d|deals\s+in|dealers?\s+in|manufacturers?\s+of|khasra|plot|road|nagar|enclave|sector|near\b|@|^\W*$)/i;
// Tally adds the financial year to company names: "ABC TRADERS PVT LTD (2026-2027)"
function stripFyName(n){ return String(n || "").replace(/\s*[\(\[]\s*(fy\s*)?(20)?\d{2}\s*[-\/]\s*(20)?\d{2}\s*[\)\]]\s*$/i, "").replace(/\s+(fy\s*)?20\d{2}\s*-\s*(20)?\d{2}\s*$/i, "").trim(); }
// the name in the signature block: "For M/s. ABC & Associates" below the totals, followed by a designation
function signatureName(lines){
  let from = -1;
  lines.forEach((l, i) => { if (/(grand\s*)?total|amount\s*(chargeable|in\s*words)|rupees|\bonly\b|thanking|yours\s+(faithfully|truly|sincerely)/i.test(l)) from = i; });
  for (let i = lines.length - 1; i > from && i >= 0; i--){
    const m = lines[i].match(/^\s*for\s+(?:m\/?s\.?\s*)?(.{3,80}?)\s*[:,.]?\s*$/i);
    if (!m) continue;
    const nm = stripFyName(m[1].trim());
    if (/^(the|your|our|any|all|this|period|year|month|quarterly|monthly|annual|services?|supply)\b/i.test(nm) || /\d{3}/.test(nm)) continue;
    const next = lines.slice(i + 1, i + 6).join(" ");
    if (/(chartered|accountants?|proprietor|partner|director|authori[sz]ed|signatory|advocate|manager|\bsd\/?-)/i.test(next)) return nm;
  }
  return "";
}
const RIGHT_COL_LABELS = /\s+(invoice\s*no|inv\.?\s*no|bill\s*no|dated?\b|delivery\s*note|reference\s*no|buyer'?s\s*order|dispatch|destination|e-?way|mode\s*\/?\s*terms|place\s+of\s+supply)/i;
// the first line of a letterhead, cut before the address or a right-hand column
function letterheadName(line){
  const l = String(line || "").split(RIGHT_COL_LABELS)[0];
  return stripFyName(l.split(/\s+(?=(?:near|opp\.?|opposite|behind|plot|shop|house|h\.?\s*no|flat|sector|road|street|st\.|floor|gate|bazar|bazaar|market|nagar|colony|phase|village|p\.?o\.?|dist|tehsil|\d)\b)/i)[0].replace(/[,;:]+$/, "").trim());
}
const DOC_TITLE = /\s*\b((gst\s*|tax\s*|retail\s*|proforma\s*|commercial\s*)?invoice|bill\s+of\s+supply|rent\s+bill|cash\s+memo|estimate|quotation|receipt|debit\s+note|credit\s+note)\s*$/i;
const DESIGNATION = /^(advocates?|chartered\s+accountants?|company\s+secretar(y|ies)|cost\s+accountants?|architects?|consultants?|proprietor|partner|doctor|dr\.?\s|engineers?)\b/i;
function cleanName(l){ return stripFyName(String(l || "").replace(DOC_TITLE, "").replace(/^(from|name)\s*[:\-]\s*/i, "").replace(/^(sh|shri|smt|mr|mrs|ms|m\/s)\.?\s+/i, "").replace(/[,;:]+$/, "").trim()); }
function guessVendorName(lines, firstGstinLine, clientName){
  const own = n => clientName && (normName(n) === normName(clientName) || nameSim(n, clientName) >= 0.85);
  // lines belonging to "Bill to" / "Ship to" / "Consignee" are the other side, never the seller
  const blocked = new Set();
  lines.forEach((l, i) => {
    if (/^\s*(bill\s*to|billed\s*to|ship\s*to|shipped\s*to|consignee|buyer|deliver(y)?\s*to|sold\s*to)\b/i.test(l)){
      for (let k = i; k < Math.min(lines.length, i + 7); k++) blocked.add(k);
    }
  });
  const sentence = l => l.split(" ").length > 9 || /\b(we|hereby|enclose|kindly|please|thanking|dear|sir|madam|regards|reg:|subject|sub:)\b/i.test(l);
  const firmLike = /(associates|& co\b|\bco\.|company|llp|pvt|ltd|limited|enterprises|traders|trading|services|agency|agencies|consultancy|industries|solutions|systems|computers|technologies|corporation|& sons|electricals?|electronics|hardware|stores|mart|works|motors|pharma|medicos?|foods|transport|logistics|carriers|printers|packaging)/i;
  // boilerplate that is never a supplier's name
  const JUNK = /(rupees|paisa|amount\s*in\s*words|e\.?\s?&\s?o\.?\s?e|terms|conditions|warranty|declaration|authoris|signator|jurisdiction|customer\s*care|page\s*\d|subject to|bank\s*details|ifsc|branch\s*code|a\/?c\s*no|gstin|state\s*name|place\s*of\s*supply|^total\b|^sub\s*total)/i;
  const usable = l => l.length >= 4 && !sentence(l) && !own(l) && !NAME_SKIP.test(l) && !DESIGNATION.test(l) && !JUNK.test(l) && /[A-Za-z]{3}/.test(l) && !/^(to|from|bill\s*to|buyer|party)\b\s*[:,]?$/i.test(l);
  const raw = lines.slice(0, 8);
  const top = raw.map((l, i) => (blocked.has(i) ? "" : cleanName(letterheadName(l))));
  const sig = signatureName(lines);
  if (sig && !own(sig)){
    const hit = top.find(l => l && (normName(l) === normName(sig) || nameSim(l, sig) >= 0.8));
    return hit || cleanName(sig);
  }
  // a person's name with the designation on the next line ("SURESH KUMAR SHARMA" / "Advocate, Delhi High Court")
  for (let i = 0; i < 4; i++) if (top[i] && usable(top[i]) && DESIGNATION.test(raw[i + 1] || "")) return top[i];
  // "From:" followed by the name
  const fi = raw.findIndex(l => /^from\s*[:\-]/i.test(l));
  if (fi >= 0){
    const same = cleanName(letterheadName(raw[fi].replace(/^from\s*[:\-]\s*/i, "")));
    if (same && usable(same) && !/^(bill|invoice)\b/i.test(same)) return same;
    for (let i = fi + 1; i < Math.min(raw.length, fi + 3); i++) if (top[i] && usable(top[i])) return top[i];
  }
  const firm = top.slice(0, 3).find(l => l && usable(l) && firmLike.test(l));
  if (firm) return firm;
  const caps = top.slice(0, 2).find(l => l && usable(l) && l === l.toUpperCase() && l.split(" ").length >= 2 && l.split(" ").length <= 6);
  if (caps) return caps;
  // the seller is named above the item table, never in the terms at the foot
  let headEnd = lines.findIndex(l => /(item\s*name|description|particulars|goods)/i.test(l) && /(hsn|sac|qty|quantity|rate|amount)/i.test(l));
  if (headEnd < 0) headEnd = lines.findIndex(l => /(sub\s*total|grand\s*total|amount\s*in\s*words|taxable\s*value)/i.test(l));
  if (headEnd < 5) headEnd = Math.max(8, Math.round(lines.length * 0.4));
  // when the supplier's GSTIN is on the bill, the seller's name is written beside it
  const near = firstGstinLine >= 0 ? {from: Math.max(0, firstGstinLine - 6), to: firstGstinLine + 6} : null;
  const keep = lines.map((l, i) => (blocked.has(i) || i > headEnd || (near && (i < near.from || i > near.to)) ? "" : l));
  const guess = cleanName(guessVendorNameOld(keep.filter(l => l && usable(l)), firstGstinLine));
  return guess && usable(guess) && guess.split(" ").filter(w => /[A-Za-z]{2}/.test(w)).length >= 2 ? guess : "";
}
function guessVendorNameOld(lines, firstGstinLine){
  // the supplier's name is near the top, before the "To / Bill to / M/s" block
  let stop = lines.findIndex(l => /^(to\b|bill(ed)?\s*to|m\/s\b|buyer|consignee|ship(ped)?\s*to|details\s+of\s+(receiver|recipient))/i.test(l));
  if (stop < 0 || stop > 14) stop = 14;
  const top = lines.slice(0, Math.max(3, stop));
  const TITLE_BITS = /(tax\s*invoice|\(?\s*e-?\s*invoice\s*\)?|original\s+for\s+(the\s+)?(recipient|buyer)|(duplicate|triplicate)(\s+for\s+\w+)?|bill\s+of\s+supply|cash\s+memo|retail\s+invoice|invoice)/ig;
  const RIGHT_COL = /\b(invoice\s*no|inv\.?\s*no|bill\s*no|dated?\b|delivery\s*note|reference\s*no|buyer'?s\s*order|dispatch|destination|e-?way|mode\s*\/?\s*terms|place\s+of\s+supply)/i;
  const cands = top.map(l => l.split(RIGHT_COL)[0].replace(/\s{2,}.*/, "").replace(TITLE_BITS, " ").replace(/[^A-Za-z0-9&.,()' \-]/g, " ").replace(/\s+/g, " ").trim())
    .filter(l => l.length >= 4 && !NAME_SKIP.test(l) && /[A-Za-z]{3}/.test(l) && (l.match(/\d/g) || []).length <= 2);
  const scored = cands.map(l => ({l, s: (/(pvt|ltd|limited|llp|traders|enterprises|industries|agency|agencies|company|co\.|associates|services|carriers|solutions|stores|& sons)/i.test(l) ? 5 : 0) + (l === l.toUpperCase() ? 3 : 0) + Math.min(l.length, 40) / 20}));
  scored.sort((a, b) => b.s - a.s);
  return scored.length ? scored[0].l : "";
}
const NATURE_WORDS = [
  ["rent_machinery", /(hire|rent(al)?)\s+(of\s+|charges\s+for\s+)?(machine|machinery|equipment|crane|jcb|generator|dg\s*set)/i],
  ["rent_building", /\b(rent|lease\s*rent|licen[cs]e\s+fee)\b/i],
  ["professional", /(professional\s+(fee|charge|service)|consultan|legal\s+(fee|service)|audit\s+fee|advocate|architect|retainer|ind\s*as\b|financial\s+statements|statutory\s+audit|tax\s+audit|internal\s+audit|income\s*tax\s+return|valuation\s+report|certification\s+fee)/i],
  ["technical", /(technical\s+service|software\s+(implementation|support)|it\s+support|annual\s+maintenance|\bamc\b|cloud\s+(computing|hosting|services?)|\bvps\b|server\s+(hosting|rental)|web\s+hosting|data\s*cent(er|re))/i],
  ["commission", /(commission|brokerage)/i],
  ["interest", /\binterest\s+(on|charged|amount)\b/i],
  ["contractor", /(freight|cartage|carriage|transportation\s+charges|labou?r\s+charges?|job\s*work|contract|loading|unloading|repair|catering|advertis|manpower|security\s+service|printing\s+charges)/i]
];
// The item lines: between the table heading and the totals.
function itemLines(lines){
  const head = lines.findIndex(l => /(description|particulars|item|goods|services)/i.test(l) && /(qty|quantity|rate|amount|hsn|sac)/i.test(l));
  const start = head >= 0 ? head + 1 : 0;
  let end = lines.findIndex((l, i) => i > start && /(taxable|sub\s*-?\s*total|total\s*before|grand\s*total|\btotal\b)/i.test(l));
  if (end < 0) end = Math.min(lines.length, start + 15);
  return lines.slice(start, end).filter(l => /[A-Za-z]{3}/.test(l) && lineAmounts(l).some(a => a.strong) && !/\b(c|s|i|ut)?\s?gst\b|\btax\b|round\s*off|\btotal\b/i.test(l));
}
const SAC_NATURE = [["9982", "professional"], ["9983", "technical"], ["9985", "contractor"], ["9987", "contractor"], ["9954", "contractor"], ["9965", "contractor"], ["9966", "contractor"], ["9967", "contractor"], ["9972", "rent_building"], ["9973", "rent_machinery"]];
function guessNature(items){
  const t = items.join(" \n");
  for (const [id, re] of NATURE_WORDS) if (re.test(t)) return {id, how: "item description"};
  const sac = (t.match(/\b99\d{2,4}\b/) || [])[0];
  if (sac){ const hit = SAC_NATURE.find(([code]) => sac.startsWith(code)); if (hit) return {id: hit[1], how: "SAC code " + sac}; }
  const codes = t.match(/\b\d{4,8}\b/g) || [];
  if (codes.length && codes.every(c => !/^99/.test(c)) && /(kgs?|pcs|nos|units?|mtrs?|ltrs?|bags?|boxes|qty)/i.test(t)) return {id: "goods", how: "HSN codes and quantities"};
  return null;
}
// Returns {ok, j, cid, why[]}. j has the same shape Claude returns.
function freeParse(text, cid, fileName, opts){
  opts = opts || {};
  const why = [];
  const lines = String(text || "").split(/\n/).map(l => l.replace(/[|]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const gstins = findGstins(text);
  // which client is this for?
  let buyer = null;
  const cos = Object.values(S.companies);
  if (!cid){
    for (const g of gstins){ const c = cos.find(x => x.gstin === g.gstin); if (c){ cid = c.id; buyer = g; break; } }
    if (!cid){
      for (const g of gstins){ const c = cos.filter(x => (x.pan || (x.gstin || "").slice(2, 12)) === g.gstin.slice(2, 12)); if (c.length === 1){ cid = c[0].id; buyer = g; break; } }
    }
  } else {
    const co = CO(cid);
    buyer = gstins.find(g => g.gstin === co.gstin) || gstins.find(g => co.pan && g.gstin.slice(2, 12) === co.pan) || null;
  }
  if (!buyer) buyer = gstins.find(g => g.buyerHint && gstins.indexOf(g) > 0) || null;
  // the client's own sales invoice: its GSTIN is in the seller's header, and the other GSTIN is under Bill to
  let salesOf = null;
  if (buyer && cid && CO(cid) && buyer.gstin === CO(cid).gstin && !buyer.buyerHint && (gstins.some(g => g !== buyer && g.buyerHint && g.line > buyer.line) || (gstins.length === 1 && buyer.line <= 8))) salesOf = cid;
  const supplier = gstins.find(g => g !== buyer && !(cid && CO(cid) && g.gstin === CO(cid).gstin)) || null;
  // an unregistered supplier (landlord, advocate): PAN instead of GSTIN, and no GST
  let supplierPan = "";
  if (!supplier){
    const buyerPan = buyer ? buyer.gstin.slice(2, 12) : (cid && CO(cid) ? (CO(cid).pan || (CO(cid).gstin || "").slice(2, 12)) : "");
    const inGstins = gstins.map(g => g.gstin.slice(2, 12));
    supplierPan = findPans(lines).find(p => p !== buyerPan && inGstins.indexOf(p) < 0) || "";
    if (!supplierPan) why.push("supplier GSTIN not found");
  }

  let invoiceNo = findInvoiceNo(lines, fileName);
  let noNumber = false;
  if (!invoiceNo){
    const dt = findDate(lines);
    if (dt && /\b(bill|invoice|fees?)\b/i.test(lines.join(" ")) && !/\b(invoice|bill)\s*(no|number|#)/i.test(lines.join(" "))){
      invoiceNo = "Bill dt " + dt.slice(8, 10) + "." + dt.slice(5, 7) + "." + dt.slice(0, 4);
      noNumber = true;
    } else why.push("bill number not found");
  }
  const invoiceDate = findDate(lines);
  if (!invoiceDate) why.push("date not found");

  let total = amountAfter(lines, /(grand\s*total|invoice\s*(total|value|amount)|total\s*(invoice\s*)?(amount|value|amt)(\s*after\s*tax)?|amount\s*payable|net\s*payable|bill\s*amount|total\s*amount|total\s*\((rs|inr|₹)\.?\)|^total\s*(₹|rs\.?|inr)\s*[\d,]+\.\d{2}$)/i);
  let taxable = amountAfter(lines, /(tax'?\s?able\s*(value|amount|amt)|total\s*taxable|sub\s*-?\s*total|total\s*before\s*tax|assessable\s*value|amount\s*before\s*tax)/i, {pick:"max"});
  let cgst = amountAfter(lines, RE_CGST, {pick:"max", sameLineOnly:true}) || 0;
  let sgst = amountAfter(lines, RE_SGST, {pick:"max", sameLineOnly:true}) || 0;
  let igst = amountAfter(lines, RE_IGST, {pick:"max", sameLineOnly:true}) || 0;
  const ro = amountAfter(lines, /(round(ed)?\s*[-]?\s*off|\br\s*\/\s*o\b)/i, {sameLineOnly:true}) || 0;
  const extraChecks = [];
  // GST summary tables (labels in one row, amounts below)
  const tbl = tableColumns(lines);
  const lineGst = cgst + sgst + igst;
  const lineOk = total !== null && taxable !== null && Math.abs(taxable + lineGst - total) <= 1.0 && (lineGst > 0 || taxable !== total || !gstShown(lines));
  const tblGst = (tbl.cgst || 0) + (tbl.sgst || 0) + (tbl.igst || 0);
  const tableOk = tbl.total !== undefined && tbl.taxable !== undefined && Math.abs(tbl.taxable + tblGst - tbl.total) <= 1.0;
  if (tableOk){
    total = tbl.total; taxable = tbl.taxable;
    cgst = tbl.cgst || 0; sgst = tbl.sgst || 0; igst = tbl.igst || 0;
    extraChecks.push("figures from the GST summary table");
  } else if (!lineOk && (tbl.total !== undefined || tbl.taxable !== undefined)){
    if (tbl.total !== undefined && (total === null || !lineOk)) total = tbl.total;
    if (tbl.taxable !== undefined && (taxable === null || !lineOk)) taxable = tbl.taxable;
    if (tbl.cgst !== undefined && !cgst) cgst = tbl.cgst;
    if (tbl.sgst !== undefined && !sgst) sgst = tbl.sgst;
    if (tbl.igst !== undefined && !igst) igst = tbl.igst;
  }
  // amount in words (the invoice total, not the tax amount)
  const inWords = amountInWords(lines);
  const rec = reconcileFigures(lines, {inWords, total, tblTotal: tbl.total,
    supplierState: supplier ? supplier.gstin.slice(0, 2) : "", buyerState: buyer ? buyer.gstin.slice(0, 2) : (cid && CO(cid) && CO(cid).gstin ? CO(cid).gstin.slice(0, 2) : ""),
    tblGst: (tbl.cgst || 0) + (tbl.sgst || 0) + (tbl.igst || 0), tblParts: {cgst: tbl.cgst, sgst: tbl.sgst, igst: tbl.igst}});
  if (rec){
    total = rec.total; taxable = rec.taxable;
    cgst = rec.parts.cgst || 0; sgst = rec.parts.sgst || 0; igst = rec.parts.igst || 0;
    const i = extraChecks.indexOf("figures from the GST summary table"); if (i >= 0) extraChecks.splice(i, 1);
    extraChecks.push("taxable value (" + INR.format(rec.taxable) + ") = total from " + rec.from[0] + " − GST from " + rec.from[1] + ", and it is printed on the bill");
    if (rec.ro) extraChecks.push("round off " + rec.ro);
    if (rec.mixed) extraChecks.push("several GST rates on the bill (" + rec.mixed.join("%, ") + "%)");
  }
  const gst = cgst + sgst + igst;
  if (supplierPan && gst > 0) why.push("GST is charged but the supplier's GSTIN was not found");
  if (inWords !== null){
    if (total === null){ total = inWords; extraChecks.push("total taken from the amount in words"); }
    else if (rec && Math.abs(inWords - total) <= 1){ if (rec.from[0] !== "amount in words") extraChecks.push("total matches the amount in words"); }
    else if (Math.abs(inWords - total) <= 1) extraChecks.push("total matches the amount in words");
    else if (Math.abs(inWords - Math.round(total)) > 1) why.push("total in figures (" + total + ") and in words (" + inWords + ") differ");
  }
  if (total === null) why.push("total not found");
  if (taxable === null && total !== null && gst > 0){
    taxable = Math.round((total - gst - ro) * 100) / 100;
    if (!amountShown(lines, taxable) && !amountShown(lines, Math.round((total - gst) * 100) / 100)) { why.push("taxable value not shown on the bill"); }
  }
  if (taxable === null && total !== null && gst === 0 && !supplier) taxable = total;
  if (taxable === null) why.push("taxable value not found");
  if (total !== null && taxable !== null){
    const diff = Math.abs(taxable + gst - total);
    if (diff > 1.0 && Math.abs(taxable + gst + ro - total) > 0.05) why.push("taxable value plus GST does not equal the total");
  }
  if (gst === 0 && gstShown(lines)) why.push("GST is shown on the bill but its amount was not found");
  if (cgst && sgst && Math.abs(cgst - sgst) > 0.05) why.push("CGST and SGST differ");
  if ((cgst || sgst) && igst) why.push("both IGST and CGST/SGST found");
  if (gst > 0 && taxable && !(rec && rec.mixed)){
    const rate = gst / taxable * 100;
    if (!FREE_GST_RATES.some(r => Math.abs(rate - r) <= 0.15)) why.push("GST is " + rate.toFixed(2) + "% of the taxable value, not a standard rate");
  }
  const bs = billToShipTo(lines);
  if (bs.bill && bs.bill !== (supplier ? supplier.gstin : "")) buyer = {gstin: bs.bill, line: -1};   // the bill-to block decides whose bill it is
  if (supplier && cid && CO(cid) && supplier.gstin === CO(cid).gstin) why.push("this looks like the client's own sales invoice");
  // no GSTIN or PAN printed: a saved deductee of this name supplies the PAN
  if (!supplier && !supplierPan && cid && S.data[cid]){
    const nm0 = normName(guessVendorName(lines, -1, CO(cid) ? CO(cid).name : ""));
    const p0 = nm0 && Object.values(S.data[cid].parties || {}).find(x => x.pan && normName(x.name) === nm0);
    if (p0){ supplierPan = p0.pan; const k = why.indexOf("supplier GSTIN not found"); if (k >= 0) why.splice(k, 1); }
  }

  // supplier name and payment type: from this client's saved deductee, if known
  let vendorName = "", natureId = "", natureReason = "", known = false;
  if ((supplier || supplierPan) && cid && S.data[cid]){
    const sp = supplier ? supplier.gstin.slice(2, 12) : supplierPan;
    const p = Object.values(S.data[cid].parties).find(x => (supplier && x.gstin === supplier.gstin) || (x.pan && x.pan === sp));
    if (p){ vendorName = p.name; natureId = p.natureDefault || ""; natureReason = "Saved payment type for this deductee"; known = !!p.natureDefault; }
  }
  const guessedName = guessVendorName(lines, supplier ? supplier.line : lines.findIndex(l => /\bpan\b/i.test(l)), cid && CO(cid) ? CO(cid).name : "");
  const items = itemLines(lines);
  const nat = guessNature(items) || (/(bill\s+for\s+professional\s+services|professional\s+(fees|services)|chartered\s+accountants?|company\s+secretar|cost\s+accountants?|advocates?\b)/i.test(lines.join(" ")) ? {id: "professional", how: "the bill is for professional services"} : null);
  const itemText = items.map(l => l.replace(/\b\d[\d,.\/]*\b/g, " ").replace(/[^A-Za-z&()\-\/ ]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).join("; ");
  const j = {
    vendorName: vendorName || guessedName, vendorGstin: supplier ? supplier.gstin : null, vendorPan: supplierPan || null,
    buyerName: null, buyerGstin: buyer ? buyer.gstin : null,
    invoiceNo: (noteKindOf(lines) && noteNoOf(lines).no) || invoiceNo || null, invoiceDate: invoiceDate || null,
    againstInvoice: noteKindOf(lines) ? (noteNoOf(lines).against || (noteNoOf(lines).no ? invoiceNo : "") || null) : null,
    taxableValue: taxable, cgst, sgst, igst, totalAmount: total,
    description: itemText.slice(0, 100),
    items: readItems(lines),
    docKind: docKindOf(lines),
    noteKind: noteKindOf(lines),
    shipGstin: (billToShipTo(lines).ship || null),
    hint: lines.slice(0, 80).join(" ").slice(0, 1500),
    natureId: natureId || (nat ? nat.id : "none"),
    natureReason: natureReason || (nat ? "Free reading: " + nat.how : ""),
    confidence: known ? 0.95 : nat ? 0.6 : 0.2,
    rentMonths: null, handwritten: false,
    uncertainFields: (known ? [] : ["vendorName"]).concat(supplierPan && opts.ocr && !known ? ["vendorPan"] : []).concat(noNumber ? ["invoiceNo"] : []),
    legibilityNote: noNumber ? "The bill has no bill number: a reference from its date is used." : "",
    salesOf
  };
  const checks = why.length ? [] : [supplierPan ? "supplier PAN (no GSTIN, no GST)" : "supplier GSTIN check digit", "bill number", "date", "taxable value + GST = total"].concat(gst > 0 ? ["GST at " + Math.round(gst / taxable * 1000) / 10 + "%"] : [], extraChecks);
  // which fields are missing or doubtful, for a partly read draft
  const missing = [];
  if (!supplier && !supplierPan) missing.push("vendorGstin");
  if (!invoiceNo) missing.push("invoiceNo");
  if (!invoiceDate) missing.push("invoiceDate");
  if (total === null || why.some(w => /total/.test(w))) missing.push("total");
  if (taxable === null || why.some(w => /taxable|GST is/.test(w))) missing.push("taxable");
  if (why.some(w => /CGST|IGST|GST is/.test(w))) missing.push("cgst", "sgst", "igst");
  const found = [supplier || supplierPan || null, invoiceNo, invoiceDate, total, taxable].filter(v => v !== null && v !== undefined && v !== "").length;
  return {ok: why.length === 0, known, j, cid, why, checks, missing, found};
}
async function freeReadOnly(file){
  let text = "", canvases = [], kind;
  if (isPdf(file)){
    const r = await pdfPages(file, [1]);
    text = r.text; canvases = r.canvases;
    kind = text.replace(/\s/g, "").length >= 80 ? "pdf_text" : "pdf_scan";
  } else { canvases = [await imageToCanvas(file)]; kind = "photo"; }
  let best = null;
  const tryT = t => { const r = freeParse(t, null, file.name); if (!best || r.ok || r.why.length < best.why.length) best = r; return r.ok; };
  if (kind === "pdf_text") tryT(text);
  else {
    const passes = [];
    for (const psm of ["3", "11"]){
      const o = await ocrCanvas(canvases[0], psm);
      if (!o) throw {code:"ocr_not_working"};
      passes.push(o);
      if (tryT(o.text)) break;
      if (passes.length > 1 && tryT(passes.map(x => x.text).join("\n"))) break;
    }
  }
  return {kind, fp: best};
}
function checksPass(j){
  const tot = num(j.totalAmount), tx = num(j.taxableValue), gst = num(j.cgst) + num(j.sgst) + num(j.igst);
  return !!(j.vendorName && j.invoiceDate && tot > 0 && tx > 0 && Math.abs(tx + gst - tot) <= 1.5);
}
// Bill numbers and dates have no check digit: when OCR read them, another OCR reading must agree.
function crossCheckOcr(j, texts){
  const unsure = [];
  const norm = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (j.invoiceNo){
    const want = norm(j.invoiceNo);
    const hasToken = t => String(t).split(/\s+/).some(w => norm(w) === want);
    const agree = texts.filter(t => { const got = findInvoiceNo(String(t).split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean), ""); return norm(got) === want || hasToken(t); }).length;
    if (agree < 2) unsure.push("invoiceNo");
  }
  if (j.invoiceDate){
    const agree = texts.filter(t => findDate(String(t).split(/\n/).map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean)) === j.invoiceDate || datesIn(String(t)).indexOf(j.invoiceDate) >= 0).length;
    if (agree < 2) unsure.push("invoiceDate");
  }
  return unsure;
}
async function extract(file, careful, page, cidHint, force){
  if (!S.engine && !S.freeFirst) throw {code: S.sampleReady ? "no_engine" : "not_ready"};
  let text = "", canvases = [], kind;
  if (isPdf(file)){
    const r = await pdfPages(file, page ? [].concat(page) : [1, 2, 3]);
    text = r.text; canvases = r.canvases;
    kind = text.replace(/\s/g, "").length >= 80 ? "pdf_text" : "pdf_scan";
    if (kind === "pdf_scan") text = "";
  } else if (isImage(file)){
    canvases = [await imageToCanvas(file)];
    kind = "photo";
  } else throw {code:"bad_type"};
  if (!canvases.length) throw {code:"unreadable"};
  const preview = await canvasJpeg(canvases[0], 1400, 0.8);
  // trace: every step that was tried, whether it worked, and why not
  const trace = [];
  const step = (name, ok, note) => trace.push({step: name, ok: !!ok, note: note || ""});

  // asked for a particular reader: Google OCR first, or straight to Claude
  if (force === "google"){
    if (!googleReady()) throw {code: "no_google_key"};
    const o = await googleOcr(canvases[0]);
    let fpG = freeParse(o.text, cidHint || null, file.name, {ocr: true});
    if (fpG.cid && !D(fpG.cid).loaded){ try { await Store.loadCompany(fpG.cid); fpG = freeParse(o.text, fpG.cid, file.name, {ocr: true}); } catch (e){} }
    if (kind === "pdf_text" && !fpG.ok){ const r2 = freeParse(text + "\n" + o.text, fpG.cid || cidHint || null, file.name, {ocr: true}); if (r2.ok) fpG = r2; }
    trace.push({step: "Google OCR (asked for)", ok: !!fpG.ok, note: fpG.ok ? "read" : (fpG.why || []).join(", ")});
    if (fpG.ok) return {j: fpG.j, kind, preview, method: "google-ocr", checks: fpG.checks, trace};
    if (!S.engine) throw {code: "free_failed", detail: (fpG.why || []).join(", "), trace, partial: fpG.found >= 2 ? {j: fpG.j, missing: fpG.missing, kind, preview} : null};
    force = "claude";     // Google could not read it: Claude next
  }
  // 1. free
  let freeWhy = "", lastFree = null;
  if (!careful && S.freeFirst && force !== "claude"){
    let ftext = "", conf = 0, fp = null;
    const tryText = async (t, c) => {
      if (!t || t.replace(/\s/g, "").length < 40) return null;
      let r = freeParse(t, cidHint || null, file.name, {ocr: c < 100});
      if (r.cid && !D(r.cid).loaded){ try { await Store.loadCompany(r.cid); r = freeParse(t, r.cid, file.name, {ocr: c < 100}); } catch (e){} }
      if (!fp || r.ok || r.why.length < fp.why.length){ fp = r; ftext = t; conf = c; }
      return r;
    };
    const res = r => r ? (r.ok ? "all checks passed" : r.why.join(", ")) : "no readable text";
    let source = kind === "pdf_text" ? "free-text" : "free-ocr", googleWhy = "";
    const salesHand = () => fp && fp.j && fp.j.salesOf ? {j: Object.assign({}, fp.j, {salesText: ftext}), kind, preview, method: source, trace, checks: fp.checks || []} : null;
    if (kind === "pdf_text"){ const r = await tryText(text, 100); step("PDF's own text", r && r.ok, res(r)); if (salesHand()){ step("Sales invoice", true, "the client's own invoice: handed to Sales"); return salesHand(); } }
    else step("PDF's own text", false, kind === "pdf_scan" ? "scanned PDF, no text inside" : "photo, no text inside");
    const ocrTexts = [];
    if (!(fp && fp.ok)){
      const passes = [];
      for (const [psm, delines] of [["3", false], ["11", false], ["3", true]]){
        const label = "Built-in OCR (" + (delines ? "table lines removed" : psm === "3" ? "page layout" : "scattered text") + ")";
        const o = await ocrCanvas(canvases[0], psm, {delines});
        if (!o){ step("Built-in OCR", false, "not working here: " + ocrProblem()); break; }
        passes.push(o);
        ocrTexts.push(o.text);
        let r = await tryText(o.text, o.confidence);
        if (!(r && r.ok) && kind === "pdf_text"){ const r2 = await tryText(text + "\n" + o.text, o.confidence); if (r2 && r2.ok) r = r2; }
        if (!(r && r.ok) && passes.length > 1){ const r3 = await tryText(passes.map(x => x.text).join("\n"), Math.min(...passes.map(x => x.confidence))); if (r3 && r3.ok) r = r3; }
        step(label, r && r.ok, res(r) + " (confidence " + Math.round(o.confidence) + "%)");
        if (r && r.ok){ source = "free-ocr"; break; }
        if (salesHand()) break;
      }
      if (salesHand()){ step("Sales invoice", true, "the client's own invoice: handed to Sales"); return salesHand(); }
      if (!(fp && fp.ok)){
        if (!hasGoogle()) step("Google OCR", false, window.claude ? "not available inside claude.ai" : "no Google key saved");
        else {
          const before = fp;
          fp = null;
          try {
            const o = await googleOcr(canvases[0]);
            let r = await tryText(o.text, o.confidence);
            if (!(r && r.ok) && kind === "pdf_text"){ const r2 = await tryText(text + "\n" + o.text, o.confidence); if (r2 && r2.ok) r = r2; }
            S.googleLast = {ok: true, at: Date.now()};
            step("Google OCR", r && r.ok, res(r));
            if (fp && fp.ok) source = "google-ocr";
            else { googleWhy = "Google OCR: " + res(r); if (before && (!fp || before.why.length <= fp.why.length)) fp = before; }
          } catch (e){
            const msg = errCopy(e && e.code) + (e && e.message ? " Google said: " + e.message : "");
            S.googleLast = {ok: false, at: Date.now(), msg};
            step("Google OCR", false, msg);
            googleWhy = "Google OCR failed (" + ((e && e.code) || "error") + ")"; fp = before;
          }
        }
      }
    }
    if (fp){
      lastFree = fp;
      if (fp.ok && source === "free-ocr"){
        if (ocrTexts.length < 2){
          const o2 = await ocrCanvas(canvases[0], "11");
          if (o2) ocrTexts.push(o2.text);
        }
        const unsure = crossCheckOcr(fp.j, ocrTexts);
        if (unsure.length){
          fp.j.uncertainFields = Array.from(new Set((fp.j.uncertainFields || []).concat(unsure)));
          step("Second OCR reading", false, "did not agree on: " + unsure.map(k => k === "invoiceNo" ? "bill number" : "date").join(", ") + " (marked for you to check)");
        } else step("Second OCR reading", true, "bill number and date confirmed");
      }
      if (fp.ok){
        const askClaude = S.askClaudeNewSupplier && S.engine && !fp.known && (kind === "pdf_text" || conf >= 75);
        if (!askClaude){
          // accepted free: for a new supplier the name and payment type are for you to confirm
          const inTally = !fp.known && supplierInTally(fp.j);
          const note = fp.known ? "" : inTally ? "In Tally as " + inTally + ", not yet in FinCom's list: confirm the payment type before approving." : "New supplier: check the name and confirm the payment type before approving.";
          if (!fp.known) step("Supplier name and payment type", true, "left for you to confirm (no Claude call)");
          return {j: fp.j, kind, preview, method: source, checks: fp.checks, trace, note, confirmType: !fp.known};
        }
        // figures are checked; ask Claude (text only) just for the supplier's name and the payment type
        try {
          const jt = await claudeRead(buildPrompt(ftext, file.name, 0, "pdf_text"), [], false, file.name);
          const m = Object.assign({}, fp.j, {
            vendorName: jt.vendorName || fp.j.vendorName, vendorPan: jt.vendorPan || null, buyerName: jt.buyerName || null,
            description: jt.description || fp.j.description, natureId: jt.natureId || fp.j.natureId,
            natureReason: jt.natureReason || fp.j.natureReason, confidence: jt.confidence, rentMonths: jt.rentMonths == null ? null : jt.rentMonths,
            uncertainFields: []});
          step("Claude (text only)", true, "asked only for the supplier name and payment type; figures came from free reading");
          return {j: m, kind, preview, method: source === "google-ocr" ? "google+claude-text" : "free+claude-text", checks: fp.checks, trace};
        } catch (err){
          step("Claude (text only)", false, errCopy(err && err.code));
          return {j: fp.j, kind, preview, method: source, checks: fp.checks, trace, confirmType: true, note: "Claude could not be asked for the supplier name and payment type; check them."};
        }
      }
      freeWhy = fp.why.join(", ") + (googleWhy ? "; " + googleWhy : "");
    } else {
      freeWhy = S.ocrState === "unavailable" && kind !== "pdf_text" ? "free OCR is not available here (" + (S.ocrError || "blocked") + ")" : "no readable text was found";
      if (googleWhy && freeWhy.indexOf(googleWhy) < 0) freeWhy += "; " + googleWhy;
    }
  } else if (careful) step("Free reading", false, "skipped: careful re-read asked for");
  else step("Free reading", false, "switched off in Settings");
  if (!S.engine) throw {code: force === "claude" ? "no_engine" : "free_failed", detail: freeWhy, trace, partial: lastFree && lastFree.found >= 2 ? {j: lastFree.j, missing: lastFree.missing, kind, preview} : null};

  // 2. text PDFs: Claude with the text only
  if (kind === "pdf_text" && !careful){
    const j = await claudeRead(buildPrompt(text, file.name, 0, "pdf_text"), [], false, file.name);
    const ok = checksPass(j);
    step("Claude (text only)", ok || !S.imgMax, ok ? "read the whole bill from the PDF's text" : "its figures did not add up; trying the page image");
    if (ok || !S.imgMax) return {j, kind, preview, method:"claude-text", freeWhy, trace};
  }

  // 3. Claude with images
  if (!S.imgMax) throw {code:"images_unavailable", trace};
  let images = [];
  if (kind === "pdf_text"){
    for (const c of canvases.slice(0, Math.min(2, S.imgMax))) images.push(await imgBlob(c, "page"));
    images = images.filter(Boolean);
  } else {
    images = await buildImageSet(canvases, careful);
    if (!images.length) throw {code:"unreadable", trace};
  }
  const j = await claudeRead(buildPrompt(text, file.name, images.length, kind), images, careful, file.name);
  step(careful ? "Claude (careful re-read)" : "Claude (images)", true, "read from " + images.length + " image" + (images.length === 1 ? "" : "s"));
  return {j, kind, preview, method: careful ? "claude-careful" : "claude-images", freeWhy, trace};
}
// A photo or scan that came back without the essentials gets one careful re-read.
function needsCarefulRead(r){
  const j = r.j || {};
  if (r.kind === "pdf_text" || /^free/.test(r.method || "")) return false;
  const missing = !j.vendorName || j.totalAmount == null || !j.invoiceDate;
  const unsure = Array.isArray(j.uncertainFields) && j.uncertainFields.some(f => f === "totalAmount" || f === "taxableValue");
  return missing || unsure;
}
async function extractBest(file, onCareful, page, cidHint, force){
  let r = await extract(file, false, page, cidHint, force);
  if (needsCarefulRead(r)){
    if (onCareful) onCareful();
    try { const r2 = await extract(file, true, page, cidHint, force); r2.freeWhy = r.freeWhy; r2.trace = (r.trace || []).concat(r2.trace || []); r = r2; } catch (e){ /* keep the first reading */ }
  }
  return r;
}
const READ_RETRY_KINDS = ["rate_limit", "overloaded", "timed_out"];
// Reading with one automatic retry when the reading service is rate-limited, busy or timed out (waits its Retry-After,
// at most 30 s, else 5 s). onWait(err) is told before the wait. The error of the second try carries retried: true.
async function readWithRetry(file, onCareful, page, cidHint, force, onWait){
  try { return await extractBest(file, onCareful, page, cidHint, force); }
  catch (err){
    if (!(err && READ_RETRY_KINDS.includes(err.kind))) throw err;
    if (onWait) onWait(err);
    const ra = Number(err.retryAfter);
    await new Promise(res => setTimeout(res, ra > 0 ? Math.min(30, ra) * 1000 : 5000));
    try { return await extractBest(file, onCareful, page, cidHint, force); }
    catch (err2){ if (err2 && typeof err2 === "object") err2.retried = true; throw err2; }
  }
}
// (each name only when declared: a test's harness loads a file's names one by one, tests/harness.js)
if (typeof trimToContent !== "undefined") globalThis.trimToContent = trimToContent;
if (typeof stripsOf !== "undefined") globalThis.stripsOf = stripsOf;
if (typeof buildImageSet !== "undefined") globalThis.buildImageSet = buildImageSet;
if (typeof buildPrompt !== "undefined") globalThis.buildPrompt = buildPrompt;
if (typeof readItems !== "undefined") globalThis.readItems = readItems;
if (typeof noteNoOf !== "undefined") globalThis.noteNoOf = noteNoOf;
if (typeof FREE_GST_RATES !== "undefined") globalThis.FREE_GST_RATES = FREE_GST_RATES;
if (typeof ocrDigits !== "undefined") globalThis.ocrDigits = ocrDigits;
if (typeof ocrLetters !== "undefined") globalThis.ocrLetters = ocrLetters;
if (typeof findGstins !== "undefined") globalThis.findGstins = findGstins;
if (typeof parseAmount !== "undefined") globalThis.parseAmount = parseAmount;
if (typeof lineAmounts !== "undefined") globalThis.lineAmounts = lineAmounts;
if (typeof isHeadingRow !== "undefined") globalThis.isHeadingRow = isHeadingRow;
if (typeof amountAfter !== "undefined") globalThis.amountAfter = amountAfter;
if (typeof datesIn !== "undefined") globalThis.datesIn = datesIn;
if (typeof OTHER_DATES !== "undefined") globalThis.OTHER_DATES = OTHER_DATES;
if (typeof findDate !== "undefined") globalThis.findDate = findDate;
if (typeof NotAfterRegExp !== "undefined") globalThis.NotAfterRegExp = NotAfterRegExp;
if (typeof RE_CGST !== "undefined") globalThis.RE_CGST = RE_CGST;
if (typeof NUMBER_WORD_RE !== "undefined") globalThis.NUMBER_WORD_RE = NUMBER_WORD_RE;
if (typeof numberWordCount !== "undefined") globalThis.numberWordCount = numberWordCount;
if (typeof PAN_HOLDER !== "undefined") globalThis.PAN_HOLDER = PAN_HOLDER;
if (typeof findPans !== "undefined") globalThis.findPans = findPans;
if (typeof ratesShown !== "undefined") globalThis.ratesShown = ratesShown;
if (typeof WORD_NUMS !== "undefined") globalThis.WORD_NUMS = WORD_NUMS;
if (typeof WORD_SCALES !== "undefined") globalThis.WORD_SCALES = WORD_SCALES;
if (typeof wordsValue !== "undefined") globalThis.wordsValue = wordsValue;
if (typeof amountInWords !== "undefined") globalThis.amountInWords = amountInWords;
if (typeof colLabels !== "undefined") globalThis.colLabels = colLabels;
if (typeof COL_LABELS !== "undefined") globalThis.COL_LABELS = COL_LABELS;
if (typeof tableColumns !== "undefined") globalThis.tableColumns = tableColumns;
if (typeof gstShown !== "undefined") globalThis.gstShown = gstShown;
if (typeof amountShown !== "undefined") globalThis.amountShown = amountShown;
if (typeof taxWordsAmount !== "undefined") globalThis.taxWordsAmount = taxWordsAmount;
if (typeof reconcileFigures !== "undefined") globalThis.reconcileFigures = reconcileFigures;
if (typeof invoiceTokenScore !== "undefined") globalThis.invoiceTokenScore = invoiceTokenScore;
if (typeof bestInvoiceToken !== "undefined") globalThis.bestInvoiceToken = bestInvoiceToken;
if (typeof findInvoiceNo !== "undefined") globalThis.findInvoiceNo = findInvoiceNo;
if (typeof NAME_SKIP !== "undefined") globalThis.NAME_SKIP = NAME_SKIP;
if (typeof stripFyName !== "undefined") globalThis.stripFyName = stripFyName;
if (typeof signatureName !== "undefined") globalThis.signatureName = signatureName;
if (typeof RIGHT_COL_LABELS !== "undefined") globalThis.RIGHT_COL_LABELS = RIGHT_COL_LABELS;
if (typeof letterheadName !== "undefined") globalThis.letterheadName = letterheadName;
if (typeof DOC_TITLE !== "undefined") globalThis.DOC_TITLE = DOC_TITLE;
if (typeof DESIGNATION !== "undefined") globalThis.DESIGNATION = DESIGNATION;
if (typeof cleanName !== "undefined") globalThis.cleanName = cleanName;
if (typeof guessVendorName !== "undefined") globalThis.guessVendorName = guessVendorName;
if (typeof guessVendorNameOld !== "undefined") globalThis.guessVendorNameOld = guessVendorNameOld;
if (typeof NATURE_WORDS !== "undefined") globalThis.NATURE_WORDS = NATURE_WORDS;
if (typeof itemLines !== "undefined") globalThis.itemLines = itemLines;
if (typeof SAC_NATURE !== "undefined") globalThis.SAC_NATURE = SAC_NATURE;
if (typeof guessNature !== "undefined") globalThis.guessNature = guessNature;
if (typeof freeParse !== "undefined") globalThis.freeParse = freeParse;
if (typeof freeReadOnly !== "undefined") globalThis.freeReadOnly = freeReadOnly;
if (typeof checksPass !== "undefined") globalThis.checksPass = checksPass;
if (typeof crossCheckOcr !== "undefined") globalThis.crossCheckOcr = crossCheckOcr;
if (typeof extract !== "undefined") globalThis.extract = extract;
if (typeof needsCarefulRead !== "undefined") globalThis.needsCarefulRead = needsCarefulRead;
if (typeof extractBest !== "undefined") globalThis.extractBest = extractBest;
if (typeof READ_RETRY_KINDS !== "undefined") globalThis.READ_RETRY_KINDS = READ_RETRY_KINDS;
if (typeof readWithRetry !== "undefined") globalThis.readWithRetry = readWithRetry;
/* @react-lazy: end */
