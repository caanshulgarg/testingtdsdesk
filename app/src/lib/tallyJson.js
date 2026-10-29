// The owner, 28-Oct-2026: "Build JSON also: anyone can upload XML or JSON; the system understands it and updates it."
// Loaded only when a chosen Tally file is not plain XML (window.loadTallyJson, main.jsx; tallyFiles, src/js/23), so the app's
// first file and legacy.js stay within their budgets (tests/run_stability.py):
//   - a JSON export of TallyPrime (7.1: JSON (Data Exchange), Tally's object schema; UTF-16LE with the BOM from its screens,
//     UTF-8 from its port: tests/fixtures/real-tally-7.1-json), UTF-8 or UTF-16, with or without the
//     byte-order mark, told by its content: each object turned into the XML element Tally writes for it
//     (server/_shared/tallyjson.js, the same rule FinCom's server uses), streamed a piece at a time, so a JSON Day Book of
//     any size becomes the Day Book XML every reader of FinCom already reads: the same GUIDs, the same rows;
//   - a zip holding one or more Tally files (XML or JSON, a zip inside it too): each file inside taken as if chosen on its
//     own (read from the zip a piece at a time; nothing is unzipped on a server);
//   - an Excel file (a Day Book exported as Excel), a PDF, a Word file: said plainly, with how to export it as XML or JSON.
import { isJsonText, jsonKindOf, jsonScanner, elemXml, envelopeHead, ENVELOPE_FOOT, jsonCompany } from "../../../server/_shared/tallyjson.js";

const EXCEL = "This is an Excel export. Export the Day Book as XML or JSON instead: Day Book → F2 period → E (Export) → Format: XML or JSON";
const HOW = "In TallyPrime open Day Book, press Alt+F2 for the period, then Alt+E (Export) \u2192 Current, F8 (File Format): XML or JSON, and E to export; upload that file.";
const READ = 8 * 1024 * 1024;

async function bytesAt(blob, a, b) { return new Uint8Array(await blob.slice(a, b).arrayBuffer()); }
function encodingOf(h) {
  if (typeof Books === "object" && Books.encodingOf) return Books.encodingOf(h);
  if (h[0] === 0xFF && h[1] === 0xFE) return "utf-16le";
  if (h[0] === 0xFE && h[1] === 0xFF) return "utf-16be";
  return h.length > 1 && h[1] === 0 && h[0] !== 0 ? "utf-16le" : "utf-8";
}

// ---------------------------------------------------------------- zip: read from the file a part at a time
const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u64 = (b, i) => u32(b, i) + u32(b, i + 4) * 4294967296;
function zipFail(why) { const e = new Error(why); e.zip = true; return e; }
// the files in a zip: [{name, method, csize, size, at (the local header), flags}]
async function zipList(blob) {
  const tailLen = Math.min(blob.size, 65557 + 20), base = blob.size - tailLen, t = await bytesAt(blob, base, blob.size);
  let e = -1; for (let i = t.length - 22; i >= 0; i--) if (u32(t, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw zipFail("it is not a whole zip (its end is missing): zip it again, or upload the files inside it");
  let n = u16(t, e + 10), cdSize = u32(t, e + 12), cdAt = u32(t, e + 16);
  // zip64: the end's locator just before it
  if ((n === 0xFFFF || cdAt === 0xFFFFFFFF) && e >= 20 && u32(t, e - 20) === 0x07064b50) {
    const z = await bytesAt(blob, u64(t, e - 20 + 8), u64(t, e - 20 + 8) + 56);
    if (u32(z, 0) === 0x06064b50) { n = u64(z, 32); cdSize = u64(z, 40); cdAt = u64(z, 48); }
  }
  const cd = await bytesAt(blob, cdAt, cdAt + cdSize), out = [];
  for (let p = 0, i = 0; i < n && p + 46 <= cd.length; i++) {
    if (u32(cd, p) !== 0x02014b50) throw zipFail("its list of files is damaged: zip it again");
    const flags = u16(cd, p + 8), method = u16(cd, p + 10), nl = u16(cd, p + 28), xl = u16(cd, p + 30), cl = u16(cd, p + 32);
    let csize = u32(cd, p + 20), size = u32(cd, p + 24), at = u32(cd, p + 42);
    const name = new TextDecoder(flags & 0x800 ? "utf-8" : "windows-1252").decode(cd.subarray(p + 46, p + 46 + nl));
    // zip64 sizes and place in the extra field
    for (let x = p + 46 + nl, end = x + xl; x + 4 <= end;) {
      const id = u16(cd, x), len = u16(cd, x + 2); let q = x + 4;
      if (id === 1) { if (size === 0xFFFFFFFF) { size = u64(cd, q); q += 8; } if (csize === 0xFFFFFFFF) { csize = u64(cd, q); q += 8; } if (at === 0xFFFFFFFF) { at = u64(cd, q); } }
      x += 4 + len;
    }
    p += 46 + nl + xl + cl;
    if (/\/$/.test(name)) continue;
    out.push({ name, method, csize, size, at, flags });
  }
  return out;
}
// one file of a zip as a Blob (inflated by the browser's own DecompressionStream, a piece at a time)
async function zipEntry(blob, x) {
  if (x.flags & 1) throw zipFail(x.name + " in it has a password: unzip it on the computer and upload the files inside");
  const h = await bytesAt(blob, x.at, x.at + 30);
  if (u32(h, 0) !== 0x04034b50) throw zipFail("it is damaged near " + x.name + ": zip it again");
  const ds = x.at + 30 + u16(h, 26) + u16(h, 28), data = blob.slice(ds, ds + x.csize);
  if (x.method === 0) return data;
  if (x.method !== 8) throw zipFail(x.name + " in it is packed in a way FinCom cannot open: unzip it on the computer and upload the files inside");
  if (typeof DecompressionStream !== "function") throw zipFail("this browser cannot open zips: unzip it on the computer and upload the files inside");
  return await new Response(data.stream().pipeThrough(new DecompressionStream("deflate-raw"))).blob();
}

// ---------------------------------------------------------------- JSON -> Tally's XML
// {file (the XML, a File named as the JSON was), kind, n} or {why}
async function jsonToXml(f, enc, onStep) {
  const sc = jsonScanner(), dec = new TextDecoder(enc), parts = [], strs = [];
  let size = 0, n = 0, other = 0, kind = "", head = "", company = "", read = 0;
  const flush = () => { if (strs.length) { parts.push(new Blob(strs, { type: "text/xml" })); strs.length = 0; size = 0; } };
  const take = (els) => {
    for (const t of els) {
      const x = elemXml(t);
      if (!x) { other++; continue; }
      if (/^<VOUCHER[\s>]/.test(x)) n++;
      strs.push("<TALLYMESSAGE>" + x + "</TALLYMESSAGE>\r\n"); size += x.length;
      if (size > 4e6) flush();
    }
  };
  for (let at = 0; at < f.size; at += READ) {
    const end = Math.min(f.size, at + READ), text = dec.decode(await bytesAt(f, at, end), { stream: end < f.size });
    if (!head) { head = text.slice(0, 262144); kind = jsonKindOf(head); company = jsonCompany(head); }
    take(sc.push(text)); read = end;
    if (onStep) onStep("Reading " + f.name + " (JSON): " + n.toLocaleString("en-IN") + " entries (" + Math.round(read / 1048576) + " MB)…");
  }
  take(sc.push(dec.decode()));
  flush();
  if (!kind) kind = jsonKindOf(head);
  if (kind === "report") return { why: f.name + " is the Day Book as Tally shows it on the screen (its rows), without the entries’ own details (their IDs, ledger lines, GST and TDS). Export it again with F8 (File Format): JSON (Data Exchange) or XML (Data Interchange), and upload that file." };
  if (!parts.length) return { why: f.name + " is a JSON file but holds no Tally entries or masters FinCom can read. " + HOW };
  const out = new File([envelopeHead(company)].concat(parts, [ENVELOPE_FOOT]), f.name, { type: "text/xml" });
  out.fromJson = { name: f.name, size: f.size, entries: n, other };
  return { file: out, n };
}

// ---------------------------------------------------------------- what each chosen file is, opened
// [{file}] for each Tally file (a zip's files each on its own), or {name, why} when it is not one FinCom reads
async function unpack(files, onStep, depth = 0) {
  const out = [];
  for (const f of files) {
    try {
      const h = await bytesAt(f, 0, 512);
      // a zip (PK..): Excel's .xlsx is a zip too
      if (h[0] === 0x50 && h[1] === 0x4B && (h[2] === 3 || h[2] === 5 || h[2] === 7)) {
        let list; try { list = await zipList(f); } catch (e) { out.push({ name: f.name, why: f.name + ": " + (e.zip ? e.message : "it could not be opened as a zip") + "." }); continue; }
        if (list.some((x) => /^xl\//i.test(x.name)) && list.some((x) => /\[Content_Types\]\.xml$/i.test(x.name))) { out.push({ name: f.name, why: f.name + ": " + EXCEL + "." }); continue; }
        if (list.some((x) => /^word\//i.test(x.name))) { out.push({ name: f.name, why: f.name + " is a Word document, not a Tally export. " + HOW }); continue; }
        if (depth > 1) { out.push({ name: f.name, why: f.name + " is a zip inside a zip inside a zip: unzip it on the computer and upload the files inside." }); continue; }
        const inner = list.filter((x) => !/(^|\/)(__MACOSX\/|\.)/.test(x.name));
        if (!inner.length) { out.push({ name: f.name, why: f.name + " is an empty zip." }); continue; }
        for (const x of inner) {
          const short = x.name.split("/").pop();
          if (onStep) onStep("Opening " + short + " from " + f.name + "…");
          try {
            const b = await zipEntry(f, x);
            const g = new File([b], short, { type: /\.json$/i.test(short) ? "application/json" : "text/xml" });
            g.fromZip = f.name;
            (await unpack([g], onStep, depth + 1)).forEach((y) => out.push(y));
          } catch (e) { out.push({ name: short, why: f.name + ": " + (e && e.zip ? e.message : "could not open " + short + " in it (" + ((e && e.message) || e) + ")") + "." }); }
        }
        continue;
      }
      if (h[0] === 0xD0 && h[1] === 0xCF && h[2] === 0x11 && h[3] === 0xE0) { out.push({ name: f.name, why: f.name + ": " + EXCEL + "." }); continue; }
      if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) { out.push({ name: f.name, why: f.name + " is a PDF, which holds the report as printed, not Tally’s data. " + HOW }); continue; }
      const enc = encodingOf(h.subarray(0, 64));
      const text = new TextDecoder(enc === "utf-16be" ? "utf-16be" : enc).decode(h.subarray(0, (h.length & ~1)));
      // Excel's own XML (a "Save as XML Spreadsheet") or an HTML table saved as .xls
      if (/<\?mso-application\s+progid="Excel\.Sheet"|urn:schemas-microsoft-com:office:spreadsheet/i.test(text)) { out.push({ name: f.name, why: f.name + ": " + EXCEL + "." }); continue; }
      if (isJsonText(text)) {
        if (enc === "utf-16be") { out.push({ name: f.name, why: f.name + " is saved as UTF-16 big-endian text, which TallyPrime does not write. " + HOW }); continue; }
        const r = await jsonToXml(f, enc, onStep);
        if (r.why) { out.push({ name: f.name, why: r.why }); continue; }
        if (f.fromZip) r.file.fromZip = f.fromZip;
        out.push({ file: r.file });
        continue;
      }
      out.push({ file: f });
    } catch (e) { out.push({ name: f.name, why: "Could not read " + f.name + ": " + ((e && e.message) || e) }); }
  }
  return out;
}
// true when a file needs this module (a zip, JSON, Excel, PDF), told by its first bytes
async function needs(f) {
  const h = await bytesAt(f, 0, 64);
  if (h[0] === 0x50 && h[1] === 0x4B) return true;
  if (h[0] === 0xD0 && h[1] === 0xCF) return true;
  if (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) return true;
  const enc = encodingOf(h);
  return isJsonText(new TextDecoder(enc === "utf-16be" ? "utf-16be" : enc).decode(h.subarray(0, h.length & ~1)));
}

export const TallyJson = { unpack, needs, jsonToXml, zipList, zipEntry, EXCEL };
globalThis.TallyJson = TallyJson;
