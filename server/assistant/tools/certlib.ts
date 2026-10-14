// CA certificates (turnover, net worth): the parts with no I/O, so the tests load them anywhere. certificates.ts is the
// Assistant's tool that uses them. Nothing here calls a model: the AI only reads a scanned statement (certificates.ts),
// and what it reads is labelled. Amounts are rupees in, worked in paise, rupees out.
//   netWorth      the working (Companies Act s.2(57); partners' accounts for a firm or an LLP)
//   readSigned    Revenue from operations, Other income and the net worth items from a signed statement's text lines,
//                 each with the page and line it came from
//   fieldsIn / fillText / fillDocx    an uploaded format's placeholders and blanks, and filling them
//   unzip / zip   docx and xlsx are zips (DecompressionStream, no package)
//   render / docx the certificate from a template (certificate-templates.json) as blocks, and those blocks as Word
export type Kind = "company" | "firm" | "llp" | "proprietor";
export type NwIn = { share_capital?: number | null, reserves?: number | null, revaluation_reserve?: number | null, accumulated_losses?: number | null,
  misc_expenditure?: number | null, partners_capital?: number | null, partners_current?: number | null };
export type NwRow = { item: string, amount: number, sign: "+" | "-" | "=", key: string };

const P = (v: unknown) => { const n = Number(v); return isFinite(n) ? Math.round(n * 100) : 0; };
const R = (p: number) => p / 100;
export const fyLabel = (fy: string | number) => Number(fy) + "-" + String(Number(fy) + 1).slice(2);
export const fyEnd = (fy: string | number) => (Number(fy) + 1) + "-03-31";
// "2025-26", "FY 2025-26", "2025" -> "2025"; a date -> the year it falls in
export function fyOf(v: unknown): string | null {
  const s = String(v ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return String(Number(m[2]) >= 4 ? Number(m[1]) : Number(m[1]) - 1);
  m = /(\d{4})\s*[-–/]\s*(\d{2,4})/.exec(s);
  if (m) return m[1];
  m = /(\d{4})/.exec(s);
  return m ? m[1] : null;
}
// the last n years that have ended by `today` (YYYY-MM-DD), oldest first
export function lastYears(n: number, today: string): string[] {
  const y = Number(today.slice(0, 4)), mo = Number(today.slice(5, 7)), last = mo >= 4 ? y - 1 : y - 2;
  return Array.from({ length: Math.max(1, Math.min(10, n)) }, (_, i) => String(last - (n - 1) + i));
}
// 1,23,45,678.90
export function inr(v: number | null | undefined, brackets = false): string {
  if (v == null || !isFinite(v)) return "";
  const p = Math.round(v * 100), neg = p < 0, a = Math.abs(p), i = String(Math.floor(a / 100)), d = String(a % 100).padStart(2, "0");
  const last3 = i.slice(-3), rest = i.slice(0, -3);
  const s = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last3 + "." + d;
  return neg ? (brackets ? "(" + s + ")" : "-" + s) : s;
}
export const dmy = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.slice(8, 10) + "-" + iso.slice(5, 7) + "-" + iso.slice(0, 4) : iso;

// ------------------------------------------------------------------ net worth
// Company (s.2(57)): paid-up capital + reserves and surplus as in the balance sheet (free reserves, securities premium, and
// the surplus, which is negative when the profit and loss account has a debit balance) - the revaluation reserve included
// in them - accumulated losses shown apart from the reserves - deferred / miscellaneous expenditure not written off.
// Firm or LLP: partners' capital + partners' current accounts (+ any reserves) - the same deductions.
export function netWorth(c: NwIn, kind: Kind): { rows: NwRow[], total: number } {
  const partners = kind === "firm" || kind === "llp" || kind === "proprietor";
  const rows: NwRow[] = [];
  const add = (key: string, item: string, v: unknown, sign: "+" | "-", always = false) => { const p = P(v); if (p || always) rows.push({ item, amount: R(Math.abs(p) * (sign === "-" ? 1 : Math.sign(p) || 1)), sign, key }); return sign === "-" ? -Math.abs(p) : p; };
  let t = 0;
  if (partners) {
    t += add("partners_capital", kind === "proprietor" ? "Proprietor's capital account" : "Partners' capital accounts", c.partners_capital, "+", true);
    t += add("partners_current", kind === "proprietor" ? "Proprietor's current account" : "Partners' current accounts", c.partners_current, "+", kind !== "proprietor");
    t += add("reserves", "Add: Reserves and surplus", c.reserves, "+");
  } else {
    t += add("share_capital", "Paid-up share capital", c.share_capital, "+", true);
    t += add("reserves", "Add: Reserves and surplus (as per the balance sheet)", c.reserves, "+", true);
  }
  t += add("revaluation_reserve", "Less: Revaluation reserve (included above; excluded from net worth)", c.revaluation_reserve, "-");
  t += add("accumulated_losses", "Less: Accumulated losses (not netted in the reserves above)", c.accumulated_losses, "-", !partners);
  t += add("misc_expenditure", "Less: Deferred / miscellaneous expenditure not written off", c.misc_expenditure, "-", !partners);
  rows.push({ item: "Net worth", amount: R(t), sign: "=", key: "net_worth" });
  return { rows, total: R(t) };
}

// ------------------------------------------------------------------ the signed statements' text
export type Line = { page: number, line: number, text: string };
export type Got = { value: number, page: number, line: number, text: string, how: "read" | "ai" | "typed" | "books" };
export type Signed = { fy: string | null, name: string, units: number, figures: Record<string, Got>, kind: Kind | null };
// an amount token: 1,23,456.00  (1,23,456)  -1234  12.5 ; a bare 1-3 digit number is a note number
const AMT = /\(?-?₹?\s?\d[\d,]*(?:\.\d+)?\)?/g;
function amountsIn(s: string): number[] {
  const out: number[] = [];
  for (const m of s.replace(/\b(19|20)\d{2}\s*[-–]\s*\d{2,4}\b/g, " ").replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, " ").matchAll(AMT)) {
    let t = m[0].replace(/[₹\s]/g, "");
    const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
    t = t.replace(/[(),-]/g, "");
    if (!t || !/\d/.test(t)) continue;
    if (!/[,.]/.test(m[0]) && t.length <= 3) continue;          // a note number, not an amount
    if (/^(19|20)\d{2}$/.test(t) && !/[,.]/.test(m[0])) continue; // a year
    const n = Number(t);
    if (isFinite(n)) out.push(neg ? -n : n);
  }
  return out;
}
const TARGETS: [string, RegExp, RegExp?][] = [
  ["turnover", /^(?:i\.?\s+|[ivx]+\)?\s+|\d+\.?\s+)?(revenue from operations|income from operations|turnover|sales(?: and services)?|gross receipts)\b/i, /other|deferred/i],
  ["other_income", /^(?:ii\.?\s+|[ivx]+\)?\s+|\d+\.?\s+)?other income\b/i],
  ["share_capital", /^(?:\(?[a-z]\)\s+|\d+\.?\s+)?(equity )?(share capital|paid[- ]up (share )?capital)\b/i, /application|pending|money/i],
  ["reserves", /^(?:\(?[a-z]\)\s+|\d+\.?\s+)?reserves?\s*(and|&)\s*surplus\b/i],
  ["revaluation_reserve", /revaluation reserve/i],
  ["misc_expenditure", /(miscellaneous expenditure|preliminary expenses|deferred revenue expenditure)(?!.*written off during)/i],
  ["accumulated_losses", /(debit balance (of|in) (the )?(profit|p\s*&\s*l|statement of profit)|accumulated loss)/i],
  ["partners_capital", /^(?:\(?[a-z]\)\s+|\d+\.?\s+)?(partners'?|proprietor'?s?|owners'?)\s*(fixed\s+)?capital( account| accounts)?\b/i],
  ["partners_current", /^(?:\(?[a-z]\)\s+|\d+\.?\s+)?(partners'?|proprietor'?s?)\s*current( account| accounts)?\b/i],
];
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
// the year the statements are for: "as at 31st March, 2025", "for the year ended March 31, 2025", "31.03.2025"
export function yearOf(text: string): string | null {
  const t = text.replace(/\s+/g, " ");
  const re = [new RegExp("(?:as at|as on|year ended|period ended)\\s*(?:the\\s*)?31(?:st)?\\s*(?:day of\\s*)?march,?\\s*(\\d{4})", "i"), new RegExp("(?:as at|as on|year ended|period ended)\\s*march\\s*31,?\\s*(\\d{4})", "i"),
    /(?:as at|as on|year ended|period ended)\s*31[./-]0?3[./-](\d{4})/i];
  for (const r of re) { const m = r.exec(t); if (m) return String(Number(m[1]) - 1); }
  return null;
}
export function readSigned(lines: Line[]): Signed {
  const all = lines.map((l) => l.text).join("\n");
  const unitM = /(?:₹|rs\.?|inr|rupees|amount)[^\n]{0,20}?\bin\s+(lakhs?|lacs?|crores?|thousands?|'000|millions?)/i.exec(all) || /\(\s*in\s+(lakhs?|lacs?|crores?|thousands?|millions?)\s*\)/i.exec(all);
  const units = !unitM ? 1 : /lak|lac/i.test(unitM[1]) ? 100000 : /crore/i.test(unitM[1]) ? 10000000 : /thousand|'000/i.test(unitM[1]) ? 1000 : /million/i.test(unitM[1]) ? 1000000 : 1;
  const figures: Record<string, Got> = {};
  for (const l of lines) {
    const text = l.text.replace(/\s+/g, " ").trim();
    for (const [key, re, not] of TARGETS) {
      if (figures[key] || !re.test(text) || (not && not.test(text.replace(re, "")))) continue;
      const nums = amountsIn(text.replace(re, " "));
      if (!nums.length) continue;
      figures[key] = { value: Math.round(nums[0] * units * 100) / 100, page: l.page, line: l.line, text: text.slice(0, 160), how: "read" };
    }
  }
  // a balance sheet line "Reserves and surplus" with a debit P&L is already negative; an accumulated loss line matched
  // inside the reserves note is netted there, so it is dropped when the reserves are negative
  if (figures.accumulated_losses && figures.reserves && figures.reserves.value < 0) delete figures.accumulated_losses;
  if (figures.accumulated_losses) figures.accumulated_losses.value = Math.abs(figures.accumulated_losses.value);
  if (figures.misc_expenditure) figures.misc_expenditure.value = Math.abs(figures.misc_expenditure.value);
  const kind: Kind | null = figures.partners_capital ? (/limited liability partnership|\bLLP\b/i.test(all) ? "llp" : "firm") : figures.share_capital ? "company" : null;
  const name = (lines.find((l) => /\b(limited|ltd\.?|llp|& co|and company|traders|enterprises|industries|associates)\b/i.test(l.text)) || lines[0] || { text: "" }).text.replace(/\s+/g, " ").trim().slice(0, 120);
  return { fy: yearOf(all), name, units, figures, kind };
}
// lines from an Excel sheet's rows (the cells of a row joined)
export function linesFromRows(rows: unknown[][], page = 1): Line[] {
  return rows.map((r, i) => ({ page, line: i + 1, text: r.map((c) => c == null ? "" : typeof c === "number" ? c.toFixed(2) : String(c)).filter((x) => x !== "").join("  ") })).filter((l) => l.text);
}
// does the AI's reading of a figure stand in the text? (the figure must appear on the line it cites)
export function onLine(lines: Line[], page: number, line: number, value: number, units = 1): boolean {
  const l = lines.find((x) => x.page === page && x.line === line);
  if (!l) return false;
  return amountsIn(l.text).some((n) => Math.abs(Math.abs(n * units) - Math.abs(value)) < 0.51);
}

// ------------------------------------------------------------------ an uploaded format: its placeholders and blanks
export type Field = { key: string, label: string, raw: string, year?: string | null };
const SYN: [string, RegExp][] = [
  ["udin", /\budin\b/i],
  ["membership_no", /membership|m\.?\s?no\b/i],
  ["frn", /\bfrn\b|firm reg/i],
  ["signatory", /(name of (the )?(partner|ca|chartered accountant|signatory)|signatory|partner'?s name)/i],
  ["firm_name", /(name of (the )?(ca )?firm|firm name|chartered accountants? firm)/i],
  ["client_cin", /\bcin\b|llpin/i],
  ["client_pan", /\bpan\b/i],
  ["client_gstin", /\bgstin\b/i],
  ["client_address", /address|registered office/i],
  ["client_name", /(name of (the )?(company|firm|entity|applicant|bidder|tenderer|contractor|client|concern|assessee)|(company|client|entity|bidder|applicant|firm)'?s?\s*name|^(client|company|entity|applicant)$|m\/s)/i],
  ["tender_no", /tender|nit|bid (no|ref|number)|rfp/i],
  ["addressee", /^(to|addressee|bank|branch|name of (the )?bank)\b/i],
  ["purpose", /purpose/i],
  ["networth", /net\s*-?\s*worth/i],
  ["turnover", /turnover|revenue|sales/i],
  ["as_on", /as on|as at/i],
  ["place", /^place\b/i],
  ["date", /^date\b|dated/i],
];
const keyOf = (label: string): string => (SYN.find(([, re]) => re.test(label)) || ["", null])[0] || "";
const BRACKET = /\{\{\s*([^{}]{1,60}?)\s*\}\}|«([^«»]{1,60})»|<<([^<>]{1,60})>>|\[([A-Za-z][^\[\]]{1,60})\]/g;
const BLANK = /_{4,}|\.{6,}|…{2,}/g;
// the fields of a format's text, in order (a placeholder's own words name it; a blank is named by the words before it)
export function fieldsIn(text: string): Field[] {
  const out: Field[] = [];
  for (const para of text.split(/\n/)) {
    for (const m of para.matchAll(BRACKET)) {
      const label = (m[1] || m[2] || m[3] || m[4] || "").trim();
      out.push({ key: keyOf(label) || "ask:" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), label, raw: m[0], year: fyOf(label.match(/(19|20)\d{2}\s*[-–]\s*\d{2,4}/)?.[0] || "") });
    }
    let last = 0;
    for (const m of para.matchAll(BLANK)) {
      const before = para.slice(last, m.index).replace(BRACKET, " ").trim();
      last = (m.index || 0) + m[0].length;
      const words = before.split(/[:;,]|\s{2,}/).pop()!.trim() || before.slice(-60).trim();
      const label = (words || before).slice(-80);
      const yearM = /((?:19|20)\d{2}\s*[-–]\s*\d{2,4})/.exec(before.slice(-60));
      out.push({ key: keyOf(label) || keyOf(before) || "ask:" + label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(-40), label: label || "blank", raw: m[0], year: yearM ? fyOf(yearM[1]) : null });
    }
  }
  return out;
}
// the value for a field: by key, by key:year (turnover:2024), or the user's answer by label
export type Values = Record<string, string>;
export function valueFor(f: Field, v: Values): string | null {
  if (f.key === "udin") return "____________________";           // never filled
  if (f.year && v[f.key + ":" + f.year] != null) return v[f.key + ":" + f.year];
  if (v[f.key] != null) return v[f.key];
  if (v["ask:" + f.label.toLowerCase()] != null) return v["ask:" + f.label.toLowerCase()];
  return null;
}
// one paragraph's text with its fields filled; fields with no value stay as they were
export function fillText(text: string, v: Values): { text: string, missing: Field[] } {
  const missing: Field[] = [];
  const fs = fieldsIn(text);
  let i = 0, out = "", rest = text;
  for (const f of fs) {
    const at = rest.indexOf(f.raw);
    if (at < 0) continue;
    const val = valueFor(f, v);
    if (val == null) missing.push(f);
    out += rest.slice(0, at) + (val == null ? f.raw : val);
    rest = rest.slice(at + f.raw.length); i++;
  }
  return { text: out + rest, missing };
}

// ------------------------------------------------------------------ zip
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip file");
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip directory");
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    const lnl = dv.getUint16(off + 26, true), lxl = dv.getUint16(off + 28, true), start = off + 30 + lnl + lxl, data = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, data.slice());
    else if (method === 8) out.set(name, new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer()));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
// a stored zip (the reports' FSX.zip, with a date), for docx and the download pack
export function zip(files: [string, Uint8Array | string][]): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], cen: Uint8Array[] = []; let off = 0;
  const u16 = (v: number) => [v & 255, (v >>> 8) & 255], u32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, data] of files) {
    const nb = enc.encode(name), db = typeof data === "string" ? enc.encode(data) : data, c = crc32(db);
    const loc = Uint8Array.from([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0)]);
    parts.push(loc, nb, db);
    const h = Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(db.length), ...u32(db.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]);
    cen.push(h, nb);
    off += loc.length + nb.length + db.length;
  }
  const cl = cen.reduce((s, x) => s + x.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cl), ...u32(off), ...u16(0)]);
  const all = [...parts, ...cen, end], out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let o = 0; for (const x of all) { out.set(x, o); o += x.length; }
  return out;
}

// ------------------------------------------------------------------ a Word format: fill its fields in place
const xe = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const xd = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const paraText = (p: string) => Array.from(p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>/g)).map((m) => m[1] != null ? xd(m[1]) : "\t").join("");
// the text of a docx, a paragraph a line (tables: a row a line, cells with two spaces)
export async function docxText(bytes: Uint8Array): Promise<string> {
  const z = await unzip(bytes), doc = new TextDecoder().decode(z.get("word/document.xml") || new Uint8Array());
  return Array.from(doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)).map((m) => paraText(m[0])).join("\n");
}
// a paragraph's runs made one (the first run's look kept) with the new text
function setPara(p: string, text: string): string {
  const firstR = /<w:r[ >][\s\S]*?<\/w:r>/.exec(p);
  const rPr = firstR ? (/<w:rPr>[\s\S]*?<\/w:rPr>/.exec(firstR[0]) || [""])[0] : "";
  const pPr = (/<w:pPr>[\s\S]*?<\/w:pPr>/.exec(p) || [""])[0];
  const open = (/^<w:p(?:\s[^>]*)?>/.exec(p) || ["<w:p>"])[0];
  const runs = text.split("\n").map((t, i) => (i ? "<w:r>" + rPr + "<w:br/></w:r>" : "") + "<w:r>" + rPr + '<w:t xml:space="preserve">' + xe(t) + "</w:t></w:r>").join("");
  return open + pPr + runs + "</w:p>";
}
// fill a Word format: every paragraph with a field; in a table, an empty cell or a blank to the right of a cell naming a
// year, under a heading naming turnover or net worth, takes that year's figure. Returns the new docx and what is missing.
export async function fillDocx(bytes: Uint8Array, v: Values): Promise<{ bytes: Uint8Array, missing: Field[], filled: number }> {
  const z = await unzip(bytes);
  const name = "word/document.xml", dec = new TextDecoder();
  let doc = dec.decode(z.get(name) || new Uint8Array());
  const missing: Field[] = []; let filled = 0;
  // tables first: a row with a year and empty cells
  doc = doc.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const head = paraText(tbl.slice(0, (tbl.indexOf("</w:tr>") + 7) || tbl.length)).toLowerCase();
    const what = /net\s*-?\s*worth/.test(head) ? "networth" : /turnover|revenue|sales/.test(head) ? "turnover" : "";
    if (!what) return tbl;
    return tbl.replace(/<w:tr[ >][\s\S]*?<\/w:tr>/g, (tr) => {
      const cells = Array.from(tr.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)).map((m) => m[0]);
      const yi = cells.findIndex((c) => /(19|20)\d{2}\s*[-–]\s*\d{2,4}/.test(paraText(c)));
      if (yi < 0) return tr;
      const fy = fyOf((/(19|20)\d{2}\s*[-–]\s*\d{2,4}/.exec(paraText(cells[yi])) || [""])[0]);
      const val = fy != null ? (v[what + ":" + fy] ?? (what === "networth" ? v.networth : undefined)) : undefined;
      let out = tr;
      for (let i = yi + 1; i < cells.length; i++) {
        const t = paraText(cells[i]).trim();
        if (t && !/^(_{2,}|\.{3,}|-|–)$/.test(t)) continue;
        if (val == null) { missing.push({ key: what, label: what + " " + (fy ? fyLabel(fy) : ""), raw: t, year: fy }); continue; }
        const nc = cells[i].replace(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/, (p) => setPara(p === "<w:p/>" ? "<w:p></w:p>" : p, val));
        out = out.replace(cells[i], nc); filled++;
        break;
      }
      return out;
    });
  });
  doc = doc.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (p) => {
    const t = paraText(p);
    if (!fieldsIn(t).length) return p;
    const r = fillText(t, v);
    missing.push(...r.missing);
    if (r.text === t) return p;
    filled++;
    return setPara(p, r.text);
  });
  z.set(name, new TextEncoder().encode(doc));
  return { bytes: zip(Array.from(z.entries())), missing, filled };
}

// ------------------------------------------------------------------ the certificate as blocks, from a template
export type Item = { p?: string, b?: number, center?: number, if?: string, table?: string, average?: number, sign?: number, encl?: string, pb?: number, confirm?: string };
export type Tpl = { templates: Record<string, Record<string, Item[] | string>>, sign: { lines: string[] }, basis: Record<string, string> };
export type Block = { p: string, b?: boolean, center?: boolean } | { table: { cols: { h: string, n?: boolean }[], rows: { c: string[], b?: boolean }[] } } | { pb: true };
export const subst = (s: string, v: Values) => s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_m, k) => v[k] ?? "");
export type CertData = { values: Values, turnover: { fy: string, value: number, basis: string }[], networth: NwRow[] | null, bvps: { shares: number, value: number } | null };
export function render(tpl: Tpl, family: string, type: "turnover" | "networth" | "combined", d: CertData): Block[] {
  const items = (tpl.templates[family] || tpl.templates.icai)[type] as Item[];
  const out: Block[] = [];
  for (const it of items) {
    if (it.if && !d.values[it.if]) continue;
    if (it.pb) { out.push({ pb: true }); continue; }
    if (it.p != null) { out.push({ p: subst(it.p, d.values), b: !!it.b, center: !!it.center }); continue; }
    if (it.table === "turnover") {
      const rows = d.turnover.map((t, i) => ({ c: [String(i + 1), fyLabel(t.fy) + (t.basis === "books" ? " (as per books, not audited)" : " (Audited)"), inr(t.value)] }));
      if (it.average && d.turnover.length > 1) rows.push({ c: ["", "Average Turnover", inr(Math.round(d.turnover.reduce((s, t) => s + P(t.value), 0) / d.turnover.length) / 100)], b: true } as any);
      out.push({ table: { cols: [{ h: "S. No." }, { h: "Financial Year" }, { h: "Turnover (Revenue from operations) (in ₹)", n: true }], rows } });
    } else if (it.table === "networth" && d.networth) {
      out.push({ table: { cols: [{ h: "Particulars" }, { h: "Amount (in ₹)", n: true }], rows: d.networth.map((r) => ({ c: [r.item, r.sign === "-" ? "(" + inr(r.amount) + ")" : inr(r.amount, true)], b: r.sign === "=" })) } });
    } else if (it.table === "bvps" && d.bvps && d.bvps.shares > 0) {
      out.push({ table: { cols: [{ h: "Book value per share (in ₹): Net worth / number of shares outstanding (" + d.bvps.shares + ")" }, { h: "Amount", n: true }], rows: [{ c: ["Book value per share", inr(d.bvps.value, true)] }] } });
    } else if (it.sign) {
      out.push({ p: "" });
      for (const l of tpl.sign.lines) out.push({ p: subst(l, d.values), b: /^For /.test(l) });
      if (it.encl) out.push({ p: "" }, { p: "Encl: " + it.encl });
    }
  }
  return out;
}
// the blocks as plain text (tests, and the chat's preview)
export const blocksText = (bs: Block[]) => bs.map((b) => "p" in b ? b.p : "table" in b ? b.table.rows.map((r) => r.c.join(" | ")).join("\n") : "----").join("\n");

// ------------------------------------------------------------------ Word: the blocks on the letterhead
export type Letterhead = { kind: "image", header: Uint8Array, headerType: "png" | "jpeg", footer?: Uint8Array | null, footerType?: "png" | "jpeg", w?: number, h?: number, fw?: number, fh?: number }
  | { kind: "docx", bytes: Uint8Array } | { kind: "text", lines: string[] } | { kind: "pdf", bytes: Uint8Array };
const W = (t: string, b?: boolean, al?: string, sz = 22) => '<w:p><w:pPr><w:spacing w:before="0" w:after="100"/>' + (al ? '<w:jc w:val="' + al + '"/>' : "") + "</w:pPr>" +
  t.split("\n").map((x, i) => (i ? "<w:r><w:br/></w:r>" : "") + '<w:r><w:rPr><w:rFonts w:ascii="Cambria" w:hAnsi="Cambria"/>' + (b ? "<w:b/>" : "") + '<w:sz w:val="' + sz + '"/></w:rPr><w:t xml:space="preserve">' + xe(x) + "</w:t></w:r>").join("") + "</w:p>";
function tableX(t: { cols: { h: string, n?: boolean }[], rows: { c: string[], b?: boolean }[] }): string {
  const full = 9000, n = t.cols.length, ws = t.cols.map((_c, i) => n === 3 ? [900, 4300, 3800][i] : n === 2 ? [6000, 3000][i] : Math.round(full / n));
  const bd = '<w:tcBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/></w:tcBorders>';
  const tc = (txt: string, w: number, b: boolean, right: boolean) => '<w:tc><w:tcPr><w:tcW w:w="' + w + '" w:type="dxa"/>' + bd + "</w:tcPr>" + W(txt, b, right ? "right" : undefined, 21) + "</w:tc>";
  return '<w:tbl><w:tblPr><w:tblW w:w="' + full + '" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>' + ws.map((w) => '<w:gridCol w:w="' + w + '"/>').join("") + "</w:tblGrid>" +
    "<w:tr><w:trPr><w:tblHeader/></w:trPr>" + t.cols.map((c, i) => tc(c.h, ws[i], true, !!c.n)).join("") + "</w:tr>" +
    t.rows.map((r) => "<w:tr><w:trPr><w:cantSplit/></w:trPr>" + r.c.map((c, i) => tc(c, ws[i], !!r.b, !!t.cols[i]?.n)).join("") + "</w:tr>").join("") + "</w:tbl>" + W("", false, undefined, 8);
}
export function bodyXml(bs: Block[]): string {
  return bs.map((b) => "pb" in b ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : "table" in b ? tableX(b.table) : W(b.p, b.b, b.center ? "center" : b.p.length > 160 ? "both" : undefined)).join("");
}
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const imgXml = (rid: string, cx: number, cy: number, id: number) => '<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + id + '" name="Letterhead ' + id + '"/>' +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + id + '" name="lh' + id + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
  '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
export async function docx(bs: Block[], lh: Letterhead, o: { title: string, draftNote?: string }): Promise<Uint8Array> {
  const body = bodyXml(bs);
  if (lh.kind === "docx") {
    // the firm's own Word letterhead: its header, footer and page set-up kept; its body replaced by the certificate
    const z = await unzip(lh.bytes), dec = new TextDecoder(), doc = dec.decode(z.get("word/document.xml") || new Uint8Array());
    const sect = (doc.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) || []).pop() || "";
    const open = (/<w:document[^>]*>/.exec(doc) || ["<w:document " + NS + ">"])[0];
    const head = doc.slice(0, doc.indexOf(open));
    z.set("word/document.xml", new TextEncoder().encode(head + open + "<w:body>" + body + sect + "</w:body></w:document>"));
    return zip(Array.from(z.entries()));
  }
  const EMU = 9525, maxW = 6.3 * 914400;   // 6.3 inches across
  const files: [string, Uint8Array | string][] = [];
  let hdr = "", ftr = "", hdrRels = "", ftrRels = "", ct = "";
  if (lh.kind === "image") {
    const sc = (w: number, h: number) => { const cx = Math.min(maxW, (w || 800) * EMU); return [Math.round(cx), Math.round(cx * (h || 120) / (w || 800))]; };
    const [hx, hy] = sc(lh.w || 0, lh.h || 0);
    hdr = imgXml("rIdImg1", hx, hy, 1); hdrRels = '<Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/lh-head.' + (lh.headerType === "png" ? "png" : "jpeg") + '"/>';
    files.push(["word/media/lh-head." + (lh.headerType === "png" ? "png" : "jpeg"), lh.header]);
    if (lh.footer) { const [fx, fy] = sc(lh.fw || 0, lh.fh || 0); ftr = imgXml("rIdImg2", fx, fy, 2); ftrRels = '<Relationship Id="rIdImg2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/lh-foot.' + (lh.footerType === "png" ? "png" : "jpeg") + '"/>'; files.push(["word/media/lh-foot." + (lh.footerType === "png" ? "png" : "jpeg"), lh.footer]); }
    ct = '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>';
  } else {
    const lines = lh.kind === "text" ? lh.lines : [];
    hdr = lines.map((l, i) => W(l, i === 0, "center", i === 0 ? 30 : 18)).join("") + '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1"/></w:pBdr><w:spacing w:after="0"/></w:pPr></w:p>';
  }
  if (o.draftNote) ftr += W(o.draftNote, false, "left", 16);
  const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/><w:footerReference w:type="default" r:id="rIdF"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2300" w:right="1200" w:bottom="1800" w:left="1300" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr>';
  const rel = (x: string) => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + x + "</Relationships>";
  files.unshift(
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + ct +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'],
    ["_rels/.rels", rel('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>')],
    ["docProps/core.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>' + xe(o.title) + "</dc:title><dc:creator>FinCom</dc:creator></cp:coreProperties>"],
    ["word/_rels/document.xml.rels", rel('<Relationship Id="rIdH" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>')],
    ["word/document.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ' + NS + "><w:body>" + body + sect + "</w:body></w:document>"],
    ["word/header1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ' + NS + ">" + (hdr || "<w:p/>") + "</w:hdr>"],
    ["word/footer1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ' + NS + ">" + (ftr || "<w:p/>") + "</w:ftr>"],
    ["word/_rels/header1.xml.rels", rel(hdrRels)],
    ["word/_rels/footer1.xml.rels", rel(ftrRels)],
  );
  return zip(files);
}
// an image's size (PNG or JPEG), for the letterhead's proportions
export function imageSize(b: Uint8Array): { type: "png" | "jpeg", w: number, h: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50) { const dv = new DataView(b.buffer, b.byteOffset); return { type: "png", w: dv.getUint32(16), h: dv.getUint32(20) }; }
  if (b[0] === 0xFF && b[1] === 0xD8) {
    let i = 2; const dv = new DataView(b.buffer, b.byteOffset);
    while (i < b.length - 9) { if (b[i] !== 0xFF) { i++; continue; } const m = b[i + 1], len = dv.getUint16(i + 2); if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { type: "jpeg", h: dv.getUint16(i + 5), w: dv.getUint16(i + 7) }; i += 2 + len; }
    return { type: "jpeg", w: 0, h: 0 };
  }
  return null;
}
