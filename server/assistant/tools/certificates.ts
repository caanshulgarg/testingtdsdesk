// CA certificates in the Assistant (the owner's request of 14-Oct-2026): turnover for some years, net worth on a date, or
// both, for many clients at once, in a format the user uploads or the firm's standard one. Chat first: whatever is missing
// (a client's name that fits two clients, a year with no signed statements, the firm's details, a field the format needs)
// comes back as a question for the model to ask; nothing is made until the user has confirmed the figures.
//
// The figures, per client per year, as per the SIGNED (audited) financial statements:
//   1. figures the user typed "as per the signed balance sheet" (input.figures);
//   2. figures confirmed before for that client and year (assistant_cert_figures, migration 83);
//   3. a signed statement uploaded in the chat or kept with the client (PDF, Excel, Word): read by FinCom (readSigned:
//      Revenue from operations, Other income, the net worth items, each with its page and line); only when FinCom cannot
//      read it (a scanned copy) the AI reads it, and those figures are labelled "read by the AI" (and checked on their line
//      where the copy has text);
//   4. otherwise a question: "upload the signed balance sheet of FY ... or type the turnover as per it", with the books'
//      figure offered as "from books, not audited", used only when the user says so (input.use_books), and the
//      certificate then says that basis.
// A year without signed statements and a books / signed difference above 1% are flagged, one chat line each.
// The UDIN is never filled. Nothing is filed or sent; the files are a download pack in the firm's private storage.
import "../../../src/js/78-reports.js";
import { PDFDocument, PDFFont, PDFImage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import type { ExtCtx, ExtResult, ExtTool, ToolTable } from "./types.ts";
import TPL from "./certificate-templates.json" with { type: "json" };
import { Block, docx, docxText, fieldsIn, fillDocx, fillText, fyEnd, fyLabel, fyOf, imageSize, inr, Kind, lastYears, Letterhead, Line, linesFromRows, netWorth, NwIn, onLine, readSigned, render, Signed, Tpl, Values } from "./certlib.ts";

// deno-lint-ignore no-explicit-any
const FSX: any = (globalThis as any).FSX;
const T = TPL as unknown as Tpl;
const ITEMS = ["turnover", "other_income", "share_capital", "reserves", "revaluation_reserve", "accumulated_losses", "misc_expenditure", "partners_capital", "partners_current", "shares"] as const;
const NW_ITEMS = ["share_capital", "reserves", "revaluation_reserve", "accumulated_losses", "misc_expenditure", "partners_capital", "partners_current"];
const LABEL: Record<string, string> = { turnover: "Revenue from operations (turnover)", other_income: "Other income (not in turnover)", share_capital: "Paid-up share capital", reserves: "Reserves and surplus",
  revaluation_reserve: "Revaluation reserve", accumulated_losses: "Accumulated losses (shown apart)", misc_expenditure: "Misc. expenditure not written off", partners_capital: "Partners' capital", partners_current: "Partners' current accounts", shares: "Number of shares" };
export const WORDS = /\b(turnover|net\s*-?\s*worth)\b[^.?!]{0,60}\bcertificates?\b|\bcertificates?\b[^.?!]{0,60}\b(turnover|net\s*-?\s*worth)\b|\bsame certificates?\b|\bnet\s*-?\s*worth certificate|\bcertificate_prepare\b/i;

// the store of migration 83 (index.ts writes it with the service role, for the user's firm only)
export type CertSettings = { firm_name?: string | null, frn?: string | null, signatory?: string | null, designation?: string | null, membership_no?: string | null, place?: string | null,
  letterhead_path?: string | null, letterhead_footer_path?: string | null, default_format?: string | null, confirmed?: boolean | null };
export type CertStore = {
  settings: () => Promise<CertSettings | null>,
  saveSettings: (s: CertSettings) => Promise<void>,
  formats: () => Promise<{ id: string, name: string, path: string, kind: string, fields: unknown }[]>,
  saveFormat: (f: { name: string, path: string, kind: string, fields: unknown }) => Promise<string | null>,
  figures: (client: string, fy: string) => Promise<{ figures: Record<string, Got0>, basis: string } | null>,
  saveFigures: (r: { client: string, fy: string, basis: string, figures: Record<string, Got0> }) => Promise<void>,
  keep: (path: string, name: string) => Promise<string | null>,      // copy a file into the firm's settings folder (letterhead, format)
};
type Got0 = { value: number, how: string, src?: string };
export type Upload = { path: string, name: string, type: string };
export type CertCtx = ExtCtx & {
  clients?: (text: string | null) => Promise<{ client: string, name: string, gstin?: string }[]>,
  clientInfo?: (id: string) => Promise<Record<string, unknown> | null>,
  clientFiles?: (id: string) => Promise<Upload[]>,
  rpcFor?: (client: string, fn: string, args: Record<string, unknown>) => Promise<any>,
  uploads?: Upload[],
  readFile?: (path: string) => Promise<Uint8Array | null>,
  aiRead?: (prompt: string, doc?: { bytes: Uint8Array, type: string } | null) => Promise<string>,
  store?: CertStore,
  noFont?: boolean,
};

const strict = (props: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(props), properties: props });
const S = (d: string) => ({ type: ["string", "null"], description: d });
const norm = (s: string) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/\b(m\/s|messrs|private|pvt|limited|ltd|llp|the|co|company)\b\.?/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const safe = (s: string) => String(s || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "client";
const todayDmy = (iso: string) => iso.slice(8, 10) + "-" + iso.slice(5, 7) + "-" + iso.slice(0, 4);
const P = (v: number) => Math.round(v * 100);

// ------------------------------------------------------------------ reading an uploaded file
type Read = { up: Upload, lines: Line[], signed: Signed | null, text: string, kind: "statement" | "format" | "letterhead" | "other", bytes: Uint8Array, scanned: boolean };
async function pdfLines(bytes: Uint8Array): Promise<Line[]> {
  // the same pdf.js the app's statement reading uses (01-documents: text pieces with positions rebuilt into lines)
  const pdfjs: any = await import("npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, verbosity: 0, useSystemFonts: false }).promise;
  const out: Line[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = new Map<number, { x: number, s: string }[]>();
    for (const it of tc.items as any[]) { if (!it.str || !it.str.trim()) continue; const y = Math.round(it.transform[5] / 3) * 3; (rows.get(y) || rows.set(y, []).get(y)!).push({ x: it.transform[4], s: it.str }); }
    let n = 0;
    for (const y of Array.from(rows.keys()).sort((a, b) => b - a)) out.push({ page: p, line: ++n, text: rows.get(y)!.sort((a, b) => a.x - b.x).map((r) => r.s).join("  ").replace(/\s{3,}/g, "  ").trim() });
  }
  return out;
}
async function xlsxLines(bytes: Uint8Array): Promise<Line[]> {
  const ExcelJS: any = (await import("npm:exceljs@4.4.0")).default;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
  const out: Line[] = [];
  wb.eachSheet((ws: any, id: number) => { const rows: unknown[][] = []; ws.eachRow({ includeEmpty: true }, (r: any) => { rows.push((r.values as unknown[]).slice(1).map((v: any) => v && typeof v === "object" ? (v.result ?? v.text ?? "") : v)); }); out.push(...linesFromRows(rows, id)); });
  return out;
}
async function readUpload(ctx: CertCtx, up: Upload): Promise<Read | null> {
  const bytes = ctx.readFile ? await ctx.readFile(up.path) : null;
  if (!bytes) return null;
  const n = up.name.toLowerCase(), t = up.type.toLowerCase();
  let lines: Line[] = [];
  try {
    if (/pdf/.test(t) || n.endsWith(".pdf")) lines = await pdfLines(bytes);
    else if (/sheet|excel/.test(t) || /\.xlsx?$/.test(n)) lines = await xlsxLines(bytes);
    else if (/word/.test(t) || n.endsWith(".docx")) lines = (await docxText(bytes)).split("\n").map((s, i) => ({ page: 1, line: i + 1, text: s })).filter((l) => l.text.trim());
    else if (/^image\//.test(t) || /\.(png|jpe?g)$/.test(n)) return { up, lines: [], signed: null, text: "", kind: /letter|head/i.test(n) || !/balance|bs|p&l|financ|audit/i.test(n) ? "letterhead" : "statement", bytes, scanned: true };
  } catch (_e) { lines = []; }
  const text = lines.map((l) => l.text).join("\n");
  const signed = lines.length ? readSigned(lines) : null;
  const isStatement = !!signed && (signed.figures.turnover || signed.figures.share_capital || signed.figures.reserves || signed.figures.partners_capital) && /balance sheet|profit and loss|statement of profit/i.test(text);
  const isFormat = !isStatement && (fieldsIn(text).length > 0 || /certif/i.test(text) && /\.(docx|pdf)$/.test(n));
  const scanned = /pdf/.test(t + n) && text.replace(/\s/g, "").length < 40;
  const kind = isStatement || (scanned && /balance|bs|p&l|financ|audit|annual/i.test(n)) ? "statement" : /letter\s*-?head/i.test(n) ? "letterhead" : isFormat ? "format" : scanned ? "statement" : "other";
  return { up, lines, signed, text, kind, bytes, scanned };
}

// ------------------------------------------------------------------ the books' figures (a reference only: "from books, not audited")
async function booksFor(ctx: CertCtx, client: string, fy: string): Promise<Record<string, number> | null> {
  if (!ctx.rpcFor) return null;
  try {
    const from = fy + "-04-01", to = fyEnd(fy);
    const [tb, saved] = await Promise.all([ctx.rpcFor(client, "rpt_tb", { p_client: client, p_from: from, p_to: to }), ctx.rpcFor(client, "rpt_saved", { p_client: client })]);
    if (!tb || !tb.ok) return null;
    const rx = (saved && saved.rx) || {}, kind = rx.kind || "company";
    const rows = (tb.rows || []).map((r: any) => ({ l: r.l, g: (r.parent ? [r.parent] : []).concat((r.chain || []).filter((g: string) => g && g !== r.parent)), o: Number(r.o) || 0, d: Number(r.d) || 0, c: Number(r.c) || 0, msme: "" }))
      .filter((t: any) => t.o || t.d || t.c);
    const det = (rx.det || {})[fy] || {};
    const r = FSX.run({ entity: Object.assign({ name: "", kind }, det.entity || {}, { kind }), fy, tb: rows, mapStore: rx.map || { versions: [] }, det, opts: { cashflow: false }, age: null });
    const M = r.model, V = (n: string) => (M.nm[n] || 0) / 100;
    const close = (x: any) => (x.o + x.d - x.c);                                     // Dr positive, rupees
    const reval = -rows.filter((x: any) => /revaluation/i.test(x.l) || x.g.some((g: string) => /revaluation/i.test(g))).reduce((s: number, x: any) => s + close(x), 0);
    const misc = rows.filter((x: any) => x.g.some((g: string) => /^misc\.? expenses \(asset\)$/i.test(g)) || /preliminary exp/i.test(x.l)).reduce((s: number, x: any) => s + close(x), 0);
    return { turnover: V("L_rev_CY"), other_income: V("L_oth_CY"), share_capital: V("L_share_CY"), reserves: V("L_reserves_CY"), partners_capital: V("L_capital_CY"), partners_current: V("L_current_CY"),
      revaluation_reserve: Math.round(reval * 100) / 100, misc_expenditure: Math.round(misc * 100) / 100, accumulated_losses: 0, kind: kind as any };
  } catch (_e) { return null; }
}

// ------------------------------------------------------------------ PDF on the letterhead (A4)
let font0: Uint8Array | null | undefined;
async function pdf(bs: Block[], lh: Letterhead, o: { title: string, noFont?: boolean }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(o.title); doc.setCreator("FinCom"); doc.setProducer("FinCom");
  if (font0 === undefined && !o.noFont) { try { const r = await fetch("https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf", { signal: AbortSignal.timeout(6000) }); font0 = r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { font0 = null; } }
  const ttf = o.noFont ? null : font0;
  let font: PDFFont, bold: PDFFont;
  if (ttf) { doc.registerFontkit(fontkit); font = await doc.embedFont(ttf, { subset: true }); bold = font; }
  else { font = await doc.embedFont(StandardFonts.TimesRoman); bold = await doc.embedFont(StandardFonts.TimesRomanBold); }
  const clean = (s: string) => ttf ? s : s.replace(/₹/g, "Rs.").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\n\x20-\x7E -ÿ]/g, "?");
  const Wd = 595.28, H = 841.89, M = 56;
  let head: PDFImage | null = null, foot: PDFImage | null = null, bg: any = null, top = H - 60, bottom = 60;
  if (lh.kind === "image") {
    head = lh.headerType === "png" ? await doc.embedPng(lh.header) : await doc.embedJpg(lh.header);
    if (lh.footer) foot = lh.footerType === "png" ? await doc.embedPng(lh.footer) : await doc.embedJpg(lh.footer);
  } else if (lh.kind === "pdf") { try { [bg] = await doc.embedPdf(lh.bytes, [0]); top = H - 150; bottom = 90; } catch { bg = null; } }
  const hs = head ? (Wd - 2 * 30) / head.width : 0, fs = foot ? (Wd - 2 * 30) / foot.width : 0;
  if (head) top = H - 20 - head.height * hs - 14;
  if (foot) bottom = 20 + foot.height * fs + 14;
  const pages: any[] = [];
  let page: any, y = 0;
  const newPage = () => {
    page = doc.addPage([Wd, H]); pages.push(page);
    if (bg) page.drawPage(bg, { x: 0, y: 0, width: Wd, height: H });
    if (head) page.drawImage(head, { x: 30, y: H - 20 - head.height * hs, width: head.width * hs, height: head.height * hs });
    if (foot) page.drawImage(foot, { x: 30, y: 20, width: foot.width * fs, height: foot.height * fs });
    if (lh.kind === "text") { let yy = H - 40; lh.lines.forEach((l, i) => { const f = i ? font : bold, sz = i ? 9 : 15, tw = f.widthOfTextAtSize(clean(l), sz); page.drawText(clean(l), { x: (Wd - tw) / 2, y: yy, size: sz, font: f }); yy -= sz + 4; });
      page.drawLine({ start: { x: M, y: yy }, end: { x: Wd - M, y: yy }, thickness: 1, color: rgb(0.2, 0.2, 0.2) }); top = yy - 18; }
    y = top;
  };
  newPage();
  const need = (h: number) => { if (y - h < bottom) newPage(); };
  const wrap = (txt: string, f: PDFFont, size: number, width: number) => {
    const out: string[] = [];
    for (const para of clean(txt).split("\n")) { let line = ""; for (const w of para.split(/\s+/)) { const t = line ? line + " " + w : w; if (f.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t; } out.push(line); }
    return out;
  };
  for (const b of bs) {
    if ("pb" in b) { newPage(); continue; }
    if ("p" in b) {
      const f = b.b ? bold : font, size = 11;
      if (!b.p) { y -= 8; continue; }
      for (const l of wrap(b.p, f, size, Wd - 2 * M)) { need(size + 5); const tw = f.widthOfTextAtSize(l, size); page.drawText(l, { x: b.center ? (Wd - tw) / 2 : M, y: y - size, size, font: f }); y -= size + 5; }
      y -= 5; continue;
    }
    const t = b.table, n = t.cols.length, avail = Wd - 2 * M, ws = n === 3 ? [0.1, 0.48, 0.42].map((x) => x * avail) : n === 2 ? [0.66, 0.34].map((x) => x * avail) : t.cols.map(() => avail / n);
    const row = (vals: string[], f: PDFFont, shade: boolean) => {
      const ls = vals.map((v, i) => wrap(v, f, 9.5, ws[i] - 8)), h = Math.max(...ls.map((l) => l.length)) * 12 + 6;
      need(h);
      if (shade) page.drawRectangle({ x: M, y: y - h, width: avail, height: h, color: rgb(0.93, 0.93, 0.93) });
      let x = M;
      ls.forEach((l, i) => { l.forEach((s, k) => { const tw = f.widthOfTextAtSize(s, 9.5); page.drawText(s, { x: t.cols[i].n ? x + ws[i] - 4 - tw : x + 4, y: y - 12 * (k + 1), size: 9.5, font: f }); });
        page.drawRectangle({ x, y: y - h, width: ws[i], height: h, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 0.6 }); x += ws[i]; });
      y -= h;
    };
    row(t.cols.map((c) => c.h), bold, true);
    for (const r of t.rows) row(r.c, r.b ? bold : font, false);
    y -= 10;
  }
  pages.forEach((p, i) => { if (pages.length > 1) p.drawText("Page " + (i + 1) + " of " + pages.length, { x: Wd - M - 50, y: 8, size: 7, font }); });
  return await doc.save();
}

// ------------------------------------------------------------------ the tool
export const TOOLS: ExtTool[] = [{
  name: "certificate_prepare",
  description: "Prepare CA certificates for one or many clients: turnover for some financial years, net worth on a date, or both, on the firm's letterhead (Word and PDF per client, one summary Excel, as a download pack). Figures are as per the SIGNED (audited) financial statements: typed by the user, read from a signed statement uploaded in the chat or kept with the client, or, only when the user says so, from the books (the certificate then says 'as per books, not audited'). " +
    "Call it with what the user asked; it answers with the figures found and the QUESTIONS to ask (ambiguous client names, years without signed statements, the firm's details asked once, fields the format needs). Ask those questions in the chat, one line each, exactly as given, and call it again with the answers: typed figures in figures (never a figure you worked out yourself), 'use the books figure' in use_books, format fields and client details in answers. " +
    "Show the figures table to the user and set confirm true ONLY after the user has confirmed the figures; the documents are made then. The UDIN is never filled. 'Same certificates for more clients': call it again with the same types, years, as_on, format, addressee and purpose and the new clients.",
  input_schema: strict({
    clients: { type: ["array", "null"], items: { type: "string" }, description: "the clients' names as the user wrote them (null: the client open)" },
    types: { type: "array", items: { type: "string", enum: ["turnover", "net_worth"] }, description: "the certificates asked" },
    years: { type: ["array", "null"], items: { type: "string" }, description: "the financial years for turnover, e.g. 2023-24 (null when not given)" },
    last_years: { type: ["integer", "null"], description: "'last 3 years': 3 (null when years are given or nothing is said)" },
    as_on: S("the net worth date, YYYY-MM-DD (null when not given)"),
    basis: { type: ["string", "null"], enum: ["signed", "books", null], description: "signed (default): as per the signed financial statements; books only when the user asks for book figures for every year" },
    format: S("the format: a format file the user uploaded in this chat (its file name), a format saved before (its name), 'icai' (the ICAI Guidance Note format) or 'firm' (the firm's usual format); null: the firm's default"),
    format_name: S("a name to save an uploaded format under for reuse (null: its file name)"),
    addressee: S("to whom the certificates are addressed (null when not given)"),
    purpose: S("the purpose (null when not given)"),
    date: S("the certificate date YYYY-MM-DD (null: today)"),
    figures: { type: ["array", "null"], items: strict({ client: { type: "string" }, year: { type: "string", description: "e.g. 2023-24" }, item: { type: "string", enum: [...ITEMS] }, value: { type: "number" } }),
      description: "figures the user TYPED as per the signed statements (never your own)" },
    use_books: { type: ["array", "null"], items: strict({ client: { type: "string" }, year: { type: "string" } }), description: "client-years for which the user said to use the books' figure" },
    answers: { type: ["array", "null"], items: strict({ client: { type: ["string", "null"] }, field: { type: "string" }, value: { type: "string" } }),
      description: "the user's answers to the other questions: a format's fields (field as FinCom named it), a client's address / cin / pan / auditor / kind, or the client chosen for an ambiguous name (field 'which')" },
    firm: { type: ["object", "null"], additionalProperties: false, required: ["firm_name", "frn", "signatory", "designation", "membership_no", "place", "letterhead_file", "default_format", "use_these"],
      properties: { firm_name: S("the firm's name"), frn: S("firm registration no."), signatory: S("the signing partner"), designation: S("Partner or Proprietor"), membership_no: S("membership no."), place: S("default place"),
        letterhead_file: S("the uploaded letterhead's file name"), default_format: { type: ["string", "null"], enum: ["icai", "firm", null], description: "'firm' when the owner says 'use our usual format'" },
        use_these: { type: ["boolean", "null"], description: "true when the user confirms the firm details and letterhead shown" } },
      description: "the firm's details, given once (null otherwise)" },
    confirm: { type: ["boolean", "null"], description: "true only after the user confirmed the figures table: make the documents" },
  }),
  task: "book", label: "books", words: WORDS,
  firmWide: true,
  async run(input0, ctx0) { return await prepare(input0 as any, ctx0 as CertCtx); },
}];

type In = { clients: string[] | null, types: string[], years: string[] | null, last_years: number | null, as_on: string | null, basis: string | null, format: string | null, format_name: string | null,
  addressee: string | null, purpose: string | null, date: string | null, figures: { client: string, year: string, item: string, value: number }[] | null, use_books: { client: string, year: string }[] | null,
  answers: { client: string | null, field: string, value: string }[] | null, firm: Record<string, any> | null, confirm: boolean | null };

export async function prepare(inp: In, ctx: CertCtx): Promise<ExtResult> {
  const Q: string[] = [], flags: string[] = [], tables: ToolTable[] = [];
  const types = (inp.types || []).filter((t) => t === "turnover" || t === "net_worth");
  if (!types.length) return { error: "Say which certificates: turnover, net worth or both." };
  const ans = (inp.answers || []);
  const answer = (client: string | null, field: string) => { const f = field.toLowerCase(); const same = (x: string) => !client || !x || norm(x) === norm(client) || x === client || (!!norm(x) && (norm(client).includes(norm(x)) || norm(x).includes(norm(client)))); const a = ans.filter((x) => x.field.toLowerCase() === f && same(x.client || "")); return a.length ? a[a.length - 1].value : null; };

  // ---- uploads in the chat, read once
  const reads: Read[] = [];
  for (const up of (ctx.uploads || []).slice(0, 40)) { const r = await readUpload(ctx, up); if (r) reads.push(r); }
  const byName = (name: string | null | undefined) => name ? reads.find((r) => r.up.name.toLowerCase() === name.toLowerCase()) || reads.find((r) => r.up.name.toLowerCase().includes(name.toLowerCase())) : undefined;

  // ---- 1. the firm's details: asked once, kept in the firm's settings
  const store = ctx.store as CertStore | undefined;
  let st: CertSettings = (store ? await store.settings() : null) || {};
  if (inp.firm) {
    const f = inp.firm, nx: CertSettings = { ...st };
    for (const k of ["firm_name", "frn", "signatory", "designation", "membership_no", "place"] as const) if (f[k]) nx[k] = String(f[k]).slice(0, 160);
    if (f.default_format) nx.default_format = f.default_format;
    if (f.letterhead_file) { const r = byName(f.letterhead_file); if (r && store) nx.letterhead_path = (await store.keep(r.up.path, "letterhead-" + r.up.name)) || r.up.path; else if (r) nx.letterhead_path = r.up.path; }
    if (f.use_these === true || (!st.firm_name && nx.firm_name)) nx.confirmed = true;
    if (store) await store.saveSettings(nx);
    st = nx;
  } else if (!st.letterhead_path) {
    // a letterhead uploaded in this chat before the firm's settings had one
    const lh = reads.find((r) => r.kind === "letterhead");
    if (lh && st.firm_name) { st = { ...st, letterhead_path: store ? (await store.keep(lh.up.path, "letterhead-" + lh.up.name)) || lh.up.path : lh.up.path }; if (store) await store.saveSettings(st); }
  }
  const firmMissing = (["firm_name", "frn", "signatory", "membership_no", "place"] as const).filter((k) => !st[k]);
  const firmLabels: Record<string, string> = { firm_name: "the firm's name", frn: "the firm registration no. (FRN)", signatory: "the signing partner's name", membership_no: "the partner's membership no.", place: "the default place of signing" };
  if (firmMissing.length) Q.push("Before the first certificate, FinCom needs the firm's details once (kept in the firm's settings): " + firmMissing.map((k) => firmLabels[k]).join(", ") + (st.letterhead_path ? "" : ", and the letterhead (upload it as Word, PDF or a picture, or say 'no letterhead')") + ".");
  else if (!st.confirmed) Q.push("Use this letterhead and signatory? " + st.firm_name + ", FRN " + st.frn + "; " + st.signatory + " (" + (st.designation || "Partner") + "), M. No. " + st.membership_no + "; place " + st.place + (st.letterhead_path ? "; letterhead on file" : "; no letterhead on file yet (upload it with Files: Word, PDF or a picture)") + ". Answer yes, or give the changes.");

  // ---- 2. the clients
  type C = { id: string, name: string, kind: Kind, info: Record<string, unknown> };
  const clients: C[] = [];
  const wanted = inp.clients && inp.clients.length ? inp.clients : ctx.clientId ? [ctx.clientName] : [];
  if (!wanted.length) return { error: "Say for which clients (or open the client first)." };
  for (const w of wanted.slice(0, 50)) {
    let id: string | null = null, name = w;
    if (!inp.clients && ctx.clientId) id = ctx.clientId;
    else if (ctx.clients) {
      const pick = answer(w, "which");
      const all = await ctx.clients(null);
      const n = norm(pick || w);
      let hit = all.filter((c) => c.client === (pick || w) || norm(c.name) === n);
      if (!hit.length) hit = all.filter((c) => n && (norm(c.name).includes(n) || n.includes(norm(c.name))));
      if (hit.length === 1) { id = hit[0].client; name = hit[0].name; }
      else if (hit.length > 1) Q.push("Which client is \"" + w + "\": " + hit.slice(0, 6).map((c) => c.name + (c.gstin ? " (GSTIN " + c.gstin + ")" : "")).join("; ") + "?");
      else Q.push("No client of the firm is named \"" + w + "\". Check the name (or add the client first).");
    } else if (ctx.clientId) { id = ctx.clientId; name = ctx.clientName; }
    if (!id || clients.some((c) => c.id === id)) continue;
    const info = (ctx.clientInfo ? await ctx.clientInfo(id).catch(() => null) : null) || {};
    const pan = String(info.pan || String(info.gstin || "").slice(2, 12) || "").toUpperCase();
    const k0 = String(answer(name, "kind") || "").toLowerCase();
    const kind: Kind = /llp/.test(k0) ? "llp" : /firm|partner/.test(k0) ? "firm" : /propriet/.test(k0) ? "proprietor" : /compan/.test(k0) ? "company" : pan[3] === "F" ? "firm" : pan[3] === "P" ? "proprietor" : "company";
    clients.push({ id, name, kind, info });
  }

  // ---- 3. the years and the date
  let years: string[] = [];
  if (types.includes("turnover")) {
    if (inp.years && inp.years.length) years = Array.from(new Set(inp.years.map((y) => fyOf(y)).filter(Boolean) as string[])).sort();
    else if (inp.last_years) years = lastYears(inp.last_years, ctx.today);
    else Q.push("For which financial years is the turnover certificate (for example 'the last 3 years')?");
  }
  let asOn = inp.as_on && /^\d{4}-\d{2}-\d{2}$/.test(inp.as_on) ? inp.as_on : null;
  if (types.includes("net_worth") && !asOn) Q.push("As on which date is the net worth (for example 31-03-2026, the date of the last signed balance sheet)?");
  const nwFy = asOn ? fyOf(asOn)! : null;
  if (asOn && !asOn.endsWith("-03-31")) Q.push("Net worth as on " + todayDmy(asOn) + " is not a balance sheet date: the signed statements give it as on 31-03-" + (Number(nwFy) + 1) + ". Use 31-03-" + (Number(nwFy) + 1) + ", or type the figures as on " + todayDmy(asOn) + " as per a signed statement for that date.");

  // ---- 4. the figures, per client per year
  type Fig = { value: number, how: "typed" | "read" | "ai" | "books" | "kept", src: string };
  const figs = new Map<string, Record<string, Fig>>();          // client|fy -> item -> figure
  const basisOf = new Map<string, "signed" | "typed" | "books">();
  const booksRef = new Map<string, Record<string, number> | null>();
  const sumRows: Record<string, unknown>[] = [];
  for (const c of clients) {
    // the client's own uploads kept in FinCom, and this chat's
    const own = ctx.clientFiles ? await ctx.clientFiles(c.id).catch(() => []) : [];
    for (const up of own) if (!reads.some((r) => r.up.path === up.path)) { const r = await readUpload(ctx, up); if (r) reads.push(Object.assign(r, { own: c.id })); }
    const need = new Map<string, string[]>();
    for (const y of years) need.set(y, ["turnover"]);
    if (nwFy) need.set(nwFy, [...(need.get(nwFy) || []), ...(c.kind === "company" ? ["share_capital", "reserves"] : ["partners_capital", "partners_current"])]);
    for (const [fy, items] of Array.from(need.entries()).sort()) {
      const key = c.id + "|" + fy, got: Record<string, Fig> = {};
      // 1. typed by the user
      for (const f of inp.figures || []) if (norm(f.client) && (norm(f.client) === norm(c.name) || norm(c.name).includes(norm(f.client))) && fyOf(f.year) === fy && isFinite(f.value)) got[f.item] = { value: Math.round(f.value * 100) / 100, how: "typed", src: "typed by you as per the signed statements" };
      // 2. kept from before
      if (store && items.some((i) => !got[i])) { const k = await store.figures(c.id, fy).catch(() => null); if (k) for (const [i, g] of Object.entries(k.figures || {})) if (!got[i] && (k.basis !== "books" || (inp.use_books || []).some((u) => fyOf(u.year) === fy))) got[i] = { value: Number(g.value), how: "kept", src: "confirmed before (" + (g.src || g.how) + ")" }; }
      // 3. a signed statement uploaded
      if (items.some((i) => !got[i])) {
        const cand = reads.filter((r) => r.kind === "statement" && ((r as any).own === c.id || (r.signed && r.signed.name && (norm(r.signed.name).includes(norm(c.name)) || norm(c.name).includes(norm(r.signed.name)))) || norm(r.up.name).includes(norm(c.name).split(" ")[0] || "#"))
          && ((r.signed && r.signed.fy === fy) || (!r.signed?.fy && fyOf((/(19|20)\d{2}\s*[-–_]\s*\d{2}/.exec(r.up.name) || [""])[0]) === fy) || (r.scanned && !(/(19|20)\d{2}/.test(r.up.name)))));
        for (const r of cand) {
          let s = r.signed;
          if ((!s || items.some((i) => !s!.figures[i])) && ctx.aiRead) {
            // the AI reads what FinCom could not (a scanned copy, an odd layout); labelled, and checked on its line where there is text
            ctx.progress("Reading " + r.up.name + " with the AI (FinCom could not read every figure)");
            const prompt = "Read these signed (audited) financial statements and give, as JSON only, {\"fy_end\": \"YYYY-03-31\", \"entity\": \"name\", \"units\": \"rupees|thousands|lakhs|crores\", \"figures\": {\"<item>\": {\"value\": <number as printed, current year column>, \"page\": <n>, \"line\": <n>}}} for the items " + NW_ITEMS.concat(["turnover", "other_income"]).join(", ") + " where they appear (turnover = Revenue from operations; reserves as the balance sheet total of Reserves and surplus, negative if shown in brackets). Leave out what is not printed. Never work a figure out." +
              (r.lines.length ? "\n\nThe text, as [page:line] text:\n" + r.lines.slice(0, 900).map((l) => "[" + l.page + ":" + l.line + "] " + l.text).join("\n") : "");
            const out = await ctx.aiRead(prompt, r.lines.length ? null : { bytes: r.bytes, type: r.up.type || "application/pdf" }).catch(() => "");
            const j = (() => { try { return JSON.parse((/\{[\s\S]*\}/.exec(out) || ["{}"])[0]); } catch { return {}; } })();
            const u = /lakh/i.test(j.units || "") ? 100000 : /crore/i.test(j.units || "") ? 1e7 : /thousand/i.test(j.units || "") ? 1000 : 1;
            const jfy = fyOf(j.fy_end || "");
            if (jfy === fy || !s?.fy) {
              s = s || { fy: jfy, name: String(j.entity || ""), units: u, figures: {}, kind: null };
              for (const [i, g] of Object.entries((j.figures || {}) as Record<string, any>)) {
                if (s.figures[i] || !isFinite(Number(g?.value))) continue;
                const v = Math.round(Number(g.value) * u * 100) / 100, pg = Number(g.page) || 0, ln = Number(g.line) || 0;
                if (r.lines.length && !onLine(r.lines, pg, ln, v, u)) { flags.push(c.name + " " + fyLabel(fy) + ": the AI's " + LABEL[i] + " (" + inr(v) + ") is not on the line it cited in " + r.up.name + "; not used."); continue; }
                s.figures[i] = { value: v, page: pg, line: ln, text: "", how: "ai" };
              }
            }
          }
          if (!s) continue;
          for (const [i, g] of Object.entries(s.figures)) if (!got[i]) got[i] = { value: g.value, how: g.how === "ai" ? "ai" : "read", src: (g.how === "ai" ? "read by the AI from " : "") + r.up.name + (g.page ? " p." + g.page + " line " + g.line : "") };
          if (s.kind && c.kind !== s.kind && !answer(c.name, "kind")) c.kind = s.kind;
          if (s.name && !c.info.signed_name) c.info.signed_name = s.name;
        }
      }
      // 4. the books, as a reference (and the figure, when the user said so)
      if (!booksRef.has(key)) booksRef.set(key, await booksFor(ctx, c.id, fy));
      const bk = booksRef.get(key);
      const useBooks = inp.basis === "books" || (inp.use_books || []).some((u) => (norm(u.client) === norm(c.name) || norm(c.name).includes(norm(u.client))) && fyOf(u.year) === fy);
      const missing = items.filter((i) => !got[i]);
      if (missing.length && useBooks && bk) for (const i of [...items, ...NW_ITEMS.filter((x) => nwFy === fy && bk[x])]) if (!got[i] && bk[i] != null) got[i] = { value: bk[i], how: "books", src: "from books, not audited" };
      const still = items.filter((i) => !got[i]);
      if (still.length) {
        const ref = bk ? " For reference, from books, not audited: " + still.map((i) => LABEL[i] + " ₹" + inr(bk[i] ?? 0)).join(", ") + " (say 'use the books figure' to use it; the certificate will then say so)." : " FinCom holds no books for this year to offer a figure.";
        Q.push("Please upload the signed balance sheet" + (still.includes("turnover") ? " and profit and loss" : "") + " of FY " + fyLabel(fy) + " for " + c.name + ", or type " + still.map((i) => "the " + LABEL[i].toLowerCase()).join(", ") + " as per it." + ref);
      }
      const how = Object.values(got).map((g) => g.how);
      basisOf.set(key, how.includes("books") ? "books" : how.length && how.every((h) => h === "typed") ? "typed" : "signed");
      if (still.length && !Object.keys(got).length) flags.push(c.name + ": no signed financial statements for FY " + fyLabel(fy) + ".");
      else if (how.includes("books")) flags.push(c.name + ": FY " + fyLabel(fy) + " is from the books, not audited (no signed statements); the certificate says so.");
      // books against signed, above 1%
      if (bk) for (const i of ["turnover", ...NW_ITEMS]) { const g = got[i]; if (!g || g.how === "books" || bk[i] == null) continue; const b0 = bk[i], d = Math.abs(g.value - b0); if (d > 0.01 * Math.max(Math.abs(g.value), 1) && d >= 1) flags.push(c.name + " " + fyLabel(fy) + ": " + LABEL[i] + " signed ₹" + inr(g.value) + " vs books ₹" + inr(b0) + " (" + (Math.round(d / Math.max(Math.abs(g.value), 1) * 1000) / 10) + "% apart)."); }
      figs.set(key, got);
    }
  }

  // ---- 5. the figures table, for the user to confirm
  const fmt = (g?: Fig) => g ? g.value : null;
  for (const c of clients) {
    const rows: Record<string, unknown>[] = [];
    for (const y of years) { const g = figs.get(c.id + "|" + y) || {}; rows.push({ item: "Turnover (Revenue from operations)", year: fyLabel(y), amount: fmt(g.turnover), source: g.turnover ? g.turnover.src : "missing" });
      if (g.other_income) rows.push({ item: "Other income (not in turnover)", year: fyLabel(y), amount: g.other_income.value, source: g.other_income.src }); }
    let nwTotal: number | null = null;
    if (nwFy) {
      const g = figs.get(c.id + "|" + nwFy) || {};
      const nwIn: NwIn = Object.fromEntries(NW_ITEMS.map((i) => [i, g[i] ? g[i].value : null]));
      const have = (c.kind === "company" ? ["share_capital", "reserves"] : ["partners_capital"]).every((i) => g[i]);
      const w = netWorth(nwIn, c.kind);
      for (const r of w.rows) {
        const k = r.key;
        rows.push({ item: r.item, year: "as on " + todayDmy(asOn!), amount: have ? (r.sign === "-" ? -r.amount : r.amount) : null, source: r.sign === "=" ? (have ? "worked out (s.2(57))" : "waiting for the figures") : (g[k] ? g[k].src : r.amount ? "" : "nil") });
      }
      if (have) nwTotal = w.total;
    }
    tables.push({ tool: "certificate_prepare", title: c.name + ": figures for the certificate" + (inp.confirm ? "" : " (to confirm)"), columns: [{ k: "item", label: "Item" }, { k: "year", label: "Year / date" }, { k: "amount", label: "Amount", t: "amount" }, { k: "source", label: "From" }],
      rows: rows.map((r) => ({ ...r, books_check: r.source === "from books, not audited" })), label: inp.confirm && !Q.length ? "certificate" : "confirm",
      basis: "as per the signed (audited) financial statements unless a row says 'from books, not audited'", summary: { client: c.name, kind: c.kind, net_worth: nwTotal } });
    sumRows.push({ client: c.name, kind: c.kind, ...Object.fromEntries(years.map((y) => ["t" + y, fmt((figs.get(c.id + "|" + y) || {}).turnover)])), net_worth: nwTotal });
  }
  if (flags.length) tables.push({ tool: "certificate_prepare", title: "Flags", columns: [{ k: "flag", label: "For your attention" }], rows: flags.map((f) => ({ flag: f })), label: "confirm" });

  // ---- 6. the format, and what it needs
  const fam0 = (inp.format || st.default_format || "icai").toLowerCase();
  const fmtUpload = inp.format && !/^(icai|firm)$/i.test(inp.format) ? byName(inp.format) || reads.find((r) => r.kind === "format" && r.up.name.toLowerCase().includes(String(inp.format).toLowerCase())) : reads.find((r) => r.kind === "format");
  let saved: { id: string, name: string, path: string, kind: string, fields: unknown } | undefined;
  if (!fmtUpload && inp.format && !/^(icai|firm)$/i.test(inp.format) && store) saved = (await store.formats()).find((f) => f.name.toLowerCase() === String(inp.format).toLowerCase());
  if (inp.format && !/^(icai|firm)$/i.test(inp.format) && !fmtUpload && !saved) Q.push("No format named \"" + inp.format + "\": upload it, or say 'ICAI format' or 'our usual format'.");
  let fmtBytes: Uint8Array | null = null, fmtKind = "", fmtName = "";
  if (fmtUpload) { fmtBytes = fmtUpload.bytes; fmtKind = /\.docx$/i.test(fmtUpload.up.name) ? "docx" : "pdf"; fmtName = inp.format_name || fmtUpload.up.name.replace(/\.[a-z]+$/i, ""); }
  else if (saved && ctx.readFile) { fmtBytes = await ctx.readFile(saved.path); fmtKind = saved.kind; fmtName = saved.name; }
  const fmtText = fmtUpload ? fmtUpload.text : fmtBytes ? (fmtKind === "docx" ? await docxText(fmtBytes) : (await pdfLines(fmtBytes)).map((l) => l.text).join("\n")) : "";
  const family = fmtBytes ? "upload" : /^firm/.test(fam0) ? "firm" : "icai";
  const valuesFor = (c: C): Values => {
    const v: Values = {};
    const a = (f: string) => answer(c.name, f);
    // the name as in the signed statements when it is the client's fuller legal name (FinCom's own spelling when the same)
    const sn = String(c.info.signed_name || "");
    v.client_name = a("name") || (sn && norm(sn) !== norm(c.name) && norm(sn).includes(norm(c.name)) && sn !== sn.toUpperCase() ? sn : c.name);
    v.client_address = a("address") || String(c.info.address || "");
    const cin = a("cin") || String(c.info.cin || ""), pan = a("pan") || String(c.info.pan || "");
    v.client_cin = cin; v.client_pan = pan; v.client_gstin = String(c.info.gstin || "");
    v.client_ids = cin ? " (CIN " + cin + ")" : pan ? " (PAN " + pan + ")" : "";
    v.client_kind_word = c.kind === "company" ? "Company" : c.kind === "llp" ? "LLP" : c.kind === "proprietor" ? "Concern" : "Firm";
    v.addressee = a("addressee") || inp.addressee || "";
    v.purpose = a("purpose") || inp.purpose || "";
    v.years_text = years.map(fyLabel).join(years.length > 1 ? ", " : "").replace(/, ([^,]*)$/, " and $1");
    v.fy_last = nwFy ? fyLabel(nwFy) : years.length ? fyLabel(years[years.length - 1]) : "";
    v.as_on = asOn ? todayDmy(asOn) : "";
    v.auditor = a("auditor") || "the statutory auditors of the " + v.client_kind_word;
    const bases = Array.from(new Set([...years, ...(nwFy ? [nwFy] : [])].map((y) => basisOf.get(c.id + "|" + y) || "signed")));
    const yrsOf = (b: string) => [...years, ...(nwFy ? [nwFy] : [])].filter((y, i, l) => l.indexOf(y) === i && (basisOf.get(c.id + "|" + y) || "signed") === b).map(fyLabel).join(", ");
    v.basis_text = bases.map((b) => T.basis[b === "typed" ? "signed" : b].replace(/\{\{fy\}\}/g, yrsOf(b)).replace(/\{\{client_kind_word\}\}/g, v.client_kind_word)).join("; and ");
    v.subject = types.length === 2 ? "Turnover and Net Worth" : types[0] === "turnover" ? "Turnover" : "Net Worth";
    Object.assign(v, { firm_name: st.firm_name || "", frn: st.frn || "", signatory: st.signatory || "", designation: st.designation || "Partner", membership_no: st.membership_no || "", place: a("place") || st.place || "",
      date: todayDmy(inp.date && /^\d{4}-\d{2}-\d{2}$/.test(inp.date) ? inp.date : ctx.today), udin: "____________________" });
    // the figures by key and key:year, for an uploaded format
    for (const y of years) { const g = (figs.get(c.id + "|" + y) || {}).turnover; if (g) v["turnover:" + y] = inr(g.value); }
    if (years.length === 1 && v["turnover:" + years[0]]) v.turnover = v["turnover:" + years[0]];
    const nw = (tables.find((t) => t.summary && t.summary.client === c.name)?.summary || {}).net_worth;
    if (nw != null) { v.networth = inr(Number(nw), true); if (nwFy) v["networth:" + nwFy] = v.networth; }
    for (const x of ans) if (x.field.startsWith("ask:") && answer(c.name, x.field) === x.value) v[x.field.toLowerCase()] = x.value;
    for (const x of ans) if (/^[a-z_]+$/.test(x.field) && !v[x.field] && answer(c.name, x.field) === x.value) v[x.field] = x.value;
    return v;
  };
  if (clients.length && !Q.length) {
    for (const c of clients) {
      const v = valuesFor(c), miss: string[] = [];
      if (family === "upload") {
        for (const line of fmtText.split("\n")) for (const f of fillText(line, v).missing) { const w = f.key.startsWith("ask:") ? f.label + " (answer as field '" + f.key + "')" : f.label + " (field '" + f.key + "')"; if (f.key !== "udin" && !f.key.startsWith("turnover") && f.key !== "networth" && !miss.includes(w)) miss.push(w); }
      } else {
        if (!v.client_address) miss.push("the registered office address (field 'address')");
        if (family === "icai" || types.length === 2) { if (!v.addressee) miss.push("to whom it is addressed (addressee)"); if (!v.purpose) miss.push("the purpose"); }
      }
      if (miss.length) Q.push("For the certificate of " + c.name + " the format needs: " + miss.join(", ") + ".");
    }
  }

  const fyList = [...years, ...(nwFy && !years.includes(nwFy) ? [nwFy] : [])];
  const summaryForModel = clients.map((c) => c.name + ": " + fyList.map((y) => { const g = figs.get(c.id + "|" + y) || {}; return fyLabel(y) + " " + Object.entries(g).map(([i, x]) => i + " " + x.value + " (" + x.how + ")").join(", "); }).join("; ")).join(" | ");
  if (Q.length || !inp.confirm) {
    for (const t of tables) t.label = "confirm";
    return { tables, forModel: (Q.length ? "QUESTIONS to ask the user, one line each, exactly as written (nothing is made until they are answered):\n- " + Q.join("\n- ") + "\n" : "No question left. Show the figures table and ask the user to confirm the figures; call again with confirm true only after they confirm.\n") +
      (flags.length ? "FLAGS to tell the user, one line each:\n- " + flags.join("\n- ") + "\n" : "") + "Figures found (shown to the user in the table): " + summaryForModel.slice(0, 3000) + "\nFormat: " + (family === "upload" ? "the uploaded format " + fmtName : family === "firm" ? "the firm's usual format" : "the ICAI format") + "." };
  }

  // ---- 7. the documents: Word and PDF per client on the letterhead, one summary Excel, the pack
  let lh: Letterhead = { kind: "text", lines: [st.firm_name || "", "Chartered Accountants"] };
  if (st.letterhead_path && ctx.readFile) {
    const b = await ctx.readFile(st.letterhead_path).catch(() => null), foot = st.letterhead_footer_path ? await ctx.readFile(st.letterhead_footer_path).catch(() => null) : null;
    const im = b ? imageSize(b) : null, fm = foot ? imageSize(foot) : null;
    if (b && im) lh = { kind: "image", header: b, headerType: im.type, w: im.w, h: im.h, footer: foot, footerType: fm?.type, fw: fm?.w, fh: fm?.h };
    else if (b && /\.docx$/i.test(st.letterhead_path)) lh = { kind: "docx", bytes: b };
    else if (b && /\.pdf$/i.test(st.letterhead_path)) lh = { kind: "pdf", bytes: b };
  }
  const pdfLh: Letterhead = lh.kind === "docx" ? { kind: "text", lines: [st.firm_name || "", "Chartered Accountants"] } : lh;
  const docLh: Letterhead = lh.kind === "pdf" ? { kind: "text", lines: [st.firm_name || "", "Chartered Accountants"] } : lh;
  const type = types.length === 2 ? "combined" : types[0] === "turnover" ? "turnover" : "networth";
  const pack: [string, Uint8Array][] = [];
  const made: string[] = [];
  for (const c of clients) {
    ctx.progress("Certificate for " + c.name);
    const v = valuesFor(c);
    const turnover = years.map((y) => ({ fy: y, value: (figs.get(c.id + "|" + y) || {}).turnover!.value, basis: basisOf.get(c.id + "|" + y) || "signed" }));
    const g = nwFy ? figs.get(c.id + "|" + nwFy) || {} : {};
    const nwRows = nwFy ? netWorth(Object.fromEntries(NW_ITEMS.map((i) => [i, g[i] ? g[i].value : null])), c.kind).rows : null;
    const shares = g.shares ? g.shares.value : Number(answer(c.name, "shares") || 0);
    const bvps = nwRows && shares > 0 ? { shares, value: Math.round(nwRows[nwRows.length - 1].amount / shares * 100) / 100 } : null;
    let blocks: Block[];
    let wordBytes: Uint8Array;
    const base = safe(c.name) + "-" + (type === "combined" ? "turnover-and-net-worth" : type === "turnover" ? "turnover" : "net-worth") + "-certificate";
    if (family === "upload" && fmtKind === "docx" && fmtBytes) {
      const r = await fillDocx(fmtBytes, v);
      wordBytes = r.bytes;
      blocks = (await docxText(r.bytes)).split("\n").map((p) => ({ p }));
    } else if (family === "upload" && fmtBytes) {
      blocks = fmtText.split("\n").map((p) => ({ p: fillText(p, v).text }));
      wordBytes = await docx(blocks, docLh, { title: base });
    } else {
      blocks = render(T, family, type as any, { values: v, turnover, networth: nwRows, bvps });
      wordBytes = await docx(blocks, docLh, { title: base });
    }
    const pdfBytes = await pdf(blocks, pdfLh, { title: base, noFont: ctx.noFont });
    pack.push([safe(c.name) + "/" + base + ".docx", wordBytes], [safe(c.name) + "/" + base + ".pdf", pdfBytes]);
    made.push(c.name);
    // the confirmed figures kept for the next run (assistant_cert_figures: added, never changed)
    if (store) for (const y of fyList) { const gg = figs.get(c.id + "|" + y); if (gg && Object.keys(gg).length) await store.saveFigures({ client: c.id, fy: y, basis: basisOf.get(c.id + "|" + y) || "signed", figures: Object.fromEntries(Object.entries(gg).map(([i, x]) => [i, { value: x.value, how: x.how, src: x.src }])) }).catch(() => {}); }
  }
  // the summary Excel (the reports' own writer)
  const head = ["Client", "Kind", ...years.map((y) => "Turnover " + fyLabel(y)), ...(nwFy ? ["Net worth as on " + todayDmy(asOn!)] : []), "Basis"];
  const xrows: unknown[][] = [["Certificates prepared " + todayDmy(ctx.today) + " (figures as per the signed financial statements unless the basis says books)"], [], head.map((h) => ({ v: h, s: 7 }))];
  for (const c of clients) xrows.push([c.name, c.kind, ...years.map((y) => ({ v: (figs.get(c.id + "|" + y) || {}).turnover?.value ?? null, s: 2 })), ...(nwFy ? [{ v: (tables.find((t) => t.summary?.client === c.name)?.summary || {}).net_worth ?? null, s: 2 }] : []),
    Array.from(new Set(fyList.map((y) => basisOf.get(c.id + "|" + y)))).map((b) => b === "books" ? "books (not audited) for some years" : "signed").join("; ")]);
  if (flags.length) { xrows.push([], [{ v: "Flags", s: 1 }]); for (const f of flags) xrows.push([f]); }
  xrows.push([], ["The UDIN is left blank on every certificate: generate it on the UDIN portal and write it in before issue. Nothing has been filed or sent."]);
  const xlsx: Uint8Array = FSX.xlsx([{ name: "Certificates", rows: xrows, widths: [40, 12, ...years.map(() => 18), ...(nwFy ? [20] : []), 36] }]);
  pack.push(["Certificates-summary.xlsx", xlsx]);
  // a format uploaded for this job is kept by name for the next time
  if (fmtUpload && store) { const kept = await store.keep(fmtUpload.up.path, "format-" + fmtUpload.up.name); await store.saveFormat({ name: fmtName, path: kept || fmtUpload.up.path, kind: fmtKind, fields: fieldsIn(fmtText).map((f) => ({ key: f.key, label: f.label })) }).catch(() => null); }
  const files = [];
  const z = await ctx.uploadFile(FSX.zip(pack), "Certificates-" + ctx.today + ".zip", "zip"); if (z) files.push(z);
  const x = await ctx.uploadFile(xlsx, "Certificates-summary-" + ctx.today + ".xlsx", "xlsx"); if (x) files.push(x);
  return { tables, files, forModel: "Made: " + made.length + " certificate" + (made.length === 1 ? "" : "s") + " (" + made.join(", ") + "), each in Word and PDF on the letterhead, and the summary Excel, in one download pack. Tell the user: the UDIN is left blank on every certificate (generate it on the UDIN portal and write it in); nothing was filed or sent." +
    (flags.length ? " FLAGS, one line each:\n- " + flags.join("\n- ") : "") + (fmtUpload ? " The format was saved as '" + fmtName + "' for next time." : "") };
}
