// A Word file's text and tables, read on the server (the owner, 14-Nov-2026: a five-year road map in Word for the CMA's
// projections, which FinCom could not read: only the page took a Word file's text out, and only for the chat model). A
// .docx is a zip; its body is word/document.xml. No dependency: the zip's central directory read here, the entry inflated
// with the runtime's own DecompressionStream ("deflate-raw"), and the XML walked for paragraphs (w:p), tables (w:tbl,
// w:tr, w:tc), text (w:t), tabs and breaks. Never more than MAX bytes unzipped (a small file that unzips to gigabytes is
// refused), never more than 2,000 blocks. The one Word reader: certlib.ts reads a format's paragraphs with it too. Deleted text (w:delText) and field codes (w:instrText) are left out.
// Plain module: no Deno, no imports.

export type DocBlock = { type: "p", text: string } | { type: "table", rows: string[][] };
// paras: every paragraph's text as written (tabs kept, nothing trimmed), table cells' too, in order: certlib.ts's lines
export type DocText = { blocks: DocBlock[], text: string, paras: string[] };
const MAX = 8 * 1024 * 1024;

const u16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

// one entry of a zip, by its name: stored or deflated; null when it is not there or cannot be read within MAX
export async function zipEntry(zip: Uint8Array, want: string): Promise<Uint8Array | null> {
  // the end of the central directory: its signature within the last 64 KiB (the comment's room)
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) if (u32(zip, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = u16(zip, eocd + 10), cdAt = u32(zip, eocd + 16);
  let p = cdAt;
  for (let k = 0; k < count && p + 46 <= zip.length; k++) {
    if (u32(zip, p) !== 0x02014b50) return null;
    const method = u16(zip, p + 10), csize = u32(zip, p + 20), usize = u32(zip, p + 24), nlen = u16(zip, p + 28), xlen = u16(zip, p + 30), clen = u16(zip, p + 32), local = u32(zip, p + 42);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name !== want) continue;
    if (usize > MAX || local + 30 > zip.length || u32(zip, local) !== 0x04034b50) return null;
    const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28), data = zip.subarray(start, start + csize);
    if (method === 0) return data.slice();
    if (method !== 8) return null;
    return await inflate(data, MAX);
  }
  return null;
}
async function inflate(data: Uint8Array, max: number): Promise<Uint8Array | null> {
  try {
    const r = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>).getReader();
    const parts: Uint8Array[] = [];
    let n = 0;
    for (;;) {
      const { value, done } = await r.read();
      if (done) break;
      n += value.length;
      if (n > max) { await r.cancel().catch(() => {}); return null; }
      parts.push(value);
    }
    const out = new Uint8Array(n);
    let at = 0;
    for (const x of parts) { out.set(x, at); at += x.length; }
    return out;
  } catch { return null; }
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
// a character reference to no character (past U+10FFFF, a surrogate, nil) is left out, never thrown on
const cp = (n: number) => Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "";
const unesc = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? cp(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e] ?? m);

// word/document.xml to blocks: a paragraph's text; a table's rows of cells (a cell's paragraphs joined by a space; a table
// inside a cell flattened into it)
export function docXml(xml: string, paras: string[] = []): DocBlock[] {
  const blocks: DocBlock[] = [];
  let raw: string[] | null = null;
  const tables: { rows: string[][], row: string[] | null, cell: string[] | null }[] = [];
  let para: string[] | null = null;
  const re = /<(\/?)w:(p|tbl|tr|tc|t|tab|br|cr|delText|instrText)\b([^>]*?)(\/?)>|([^<]+)/g;
  let inT = false, skipT = false, m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && blocks.length < 2000) {
    const [, close, tag, , self, text] = m;
    if (text != null) { if (inT && !skipT && para) { para.push(unesc(text)); raw?.push(unesc(text)); } continue; }
    const top = tables[tables.length - 1];
    if (tag === "t" || tag === "delText" || tag === "instrText") { if (self) continue; inT = !close; skipT = tag !== "t" && !close; if (close) skipT = false; continue; }
    if (tag === "tab") { if (para) { para.push("\t"); raw?.push("\t"); } continue; }
    if (tag === "br" || tag === "cr") { if (para) para.push(" "); continue; }
    if (tag === "p") {
      if (self) { if (!top) blocks.push({ type: "p", text: "" }); continue; }
      if (!close) { para = []; raw = []; continue; }
      const t = (para || []).join("").replace(/[  ]+/g, " ").trim();
      if (raw) paras.push(raw.join(""));
      para = null; raw = null;
      if (top && top.cell) { if (t) top.cell.push(t); } else if (t) blocks.push({ type: "p", text: t });
      continue;
    }
    if (tag === "tbl") {
      if (!close) { tables.push({ rows: [], row: null, cell: null }); continue; }
      const t = tables.pop();
      if (!t) continue;
      const outer = tables[tables.length - 1];
      if (outer && outer.cell) outer.cell.push(t.rows.map((r) => r.join(" ")).join(" "));
      else if (t.rows.length) blocks.push({ type: "table", rows: t.rows });
      continue;
    }
    if (!top) continue;
    if (tag === "tr") { if (!close) top.row = []; else { if (top.row && top.row.some((c) => c)) top.rows.push(top.row); top.row = null; } continue; }
    if (tag === "tc") { if (!close) top.cell = []; else { if (top.row && top.cell) top.row.push(top.cell.join(" ").trim()); top.cell = null; } }
  }
  return blocks;
}
// the blocks as text: a paragraph a line, a table's row a line with its cells apart by tabs
export const blocksText = (b: DocBlock[]) => b.map((x) => x.type === "p" ? x.text : x.rows.map((r) => r.join("\t")).join("\n")).join("\n");

export async function docxText(bytes: Uint8Array): Promise<DocText | null> {
  const x = await zipEntry(bytes, "word/document.xml");
  if (!x) return null;
  const paras: string[] = [];
  const blocks = docXml(new TextDecoder().decode(x), paras);
  return { blocks, text: blocksText(blocks), paras };
}
