// FinCom Assistant's one Upload (AUpload). It was src/js/82-asst-upload.js; it lives with the panel (loaded the first
// time the panel opens, App.jsx), so legacy.js stays within its budget (tests/run_stability.py). It uses the app's
// readers (AS26, gridsFromSheet, statementMeta, uploadStatements …), which are the page's globals.
/* ================================================================== */
/* FinCom Assistant: one Upload (the owner's request of 14-Oct-2026). */
/* Anything can be uploaded (PDF, picture, Excel/CSV, Word, JSON),    */
/* several at once or dropped on the panel. FinCom says what each    */
/* file is by its own rules first (the readers the app already has); the AI is   */
/* asked only when they cannot tell. Then the next steps as buttons:  */
/* nothing is posted, filed or added by itself.                       */
/* ================================================================== */
// 30 files a message, any type (the owner, 13-Nov-2026): the limits, the stored type, what the AI is given of each file
// and what it costs are server/_shared/attachrules.js, the same file fincom-assistant runs
import { ATTACH, ZIP, attachInr, fitAttachments, sniff, storeType, textTokens } from "../../../server/_shared/attachrules.js";
const AUpload = window.AUpload = {
  KIND: {notice: "Notice", bill: "Bill or invoice", register: "Register", bank: "Bank statement", as26: "26AS / AIS / TRACES", certificate: "Certificate format", other: "Other document"},
  MAX: ATTACH.fileBytes,
  ACCEPT: "",                         // any type

  // a tax department's notice, intimation, show cause or order (the words such a notice carries; a bill does not)
  NOTICE: /\b(ASMT-?1[01]|DRC-?0[1-7]A?|REG-?(0?3|17|31)|ADT-?0[12]|show\s*cause\s*notice|notice\s+(u\/s|under\s+section)|intimation\s+u\/s|under\s+section\s+(143|148A?|142|133\(6\)|73|74|61|65)\b[^\n]{0,80}\bnotice|document\s+identification\s+number|\bDIN\s*[:\-]?\s*(ITBA|CBIC|ZD)|demand\s+order|scrutiny\s+notice|reply\s+(by|within)[^\n]{0,40}(days|\d{2}[-\/.]\d{2}))/i,
  AS26: /Annual\s+Tax\s+Statement|Form\s*(No\.?\s*)?26AS|Annual\s+Information\s+Statement|Taxpayer\s+Information\s+Summary|\bTRACES\b/i,
  AS26_NAME: /26\s*as|\bais\b|\btis\b|traces|annual[-_ ]?(tax|information)/i,
  BILL: /\b(tax\s*invoice|gst\s*invoice|invoice\s*(no|number|#|date)|bill\s*of\s*supply|bill\s*(no|number)|credit\s*note|debit\s*note)\b/i,
  CERT: /\bthis\s+is\s+to\s+certify\b|\bwe\s+(hereby\s+)?certify\b|\bcertificate\b[^\n]{0,60}\b(format|template)\b|\bUDIN\b/i,
  BLANK: /_{4,}|\.{6,}|\[[A-Za-z][A-Za-z .\/]{1,30}\]|\{\{[^}]{1,40}\}\}|<<[^>]{1,40}>>|\bXX+\b/g,

  // files a message (fincom-assistant refuses more: server/assistant/index.ts)
  LIMIT: ATTACH.files,
  st(){ const a = ASST.st(); a.uploads = a.uploads || []; return a; },
  // the files of the earlier Upload, shown as their own items in the thread (sessions before 02-Nov-2026): none are added now
  list(){ const k = ASST.key(), a = this.st(); return a.uploads.filter(u => u.key === k && !u.chip); },
  // the files in the question box, not sent yet (the owner, 31-Oct-2026: "it should work like Claude")
  pending(){ const k = ASST.key(), a = this.st(); return a.uploads.filter(u => u.key === k && u.chip && !u.sent); },
  ext(f){ return (String(f.name || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || ""; },
  isSheet(f){ return /^(xlsx|xls|xlsm|csv)$/.test(this.ext(f)) || /spreadsheet|ms-excel|text\/csv/.test(f.type || ""); },
  isWord(f){ return this.ext(f) === "docx" || /wordprocessingml/.test(f.type || ""); },

  // ---------------- what FinCom can read of the file, on this computer ----------------
  // a zip's files, from its central directory: {name, method, csize, usize, flags, at (the local header)}
  zipList(buf){
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip file");
    const n = dv.getUint16(eocd + 10, true), out = [];
    let p = dv.getUint32(eocd + 16, true);
    for (let k = 0; k < n && p + 46 <= buf.length && dv.getUint32(p, true) === 0x02014b50; k++){
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      out.push({name: new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl)), flags: dv.getUint16(p + 8, true), method: dv.getUint16(p + 10, true),
        csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true), at: dv.getUint32(p + 42, true)});
      p += 46 + nl + xl + cl;
    }
    return out;
  },
  // one file of a zip, unpacked; never more than max bytes (a size the zip states is not trusted: the unpacking stops)
  async unzip(buf, e, max){
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), at = e.at;
    if (at + 30 > buf.length || dv.getUint32(at, true) !== 0x04034b50) throw new Error("damaged");
    const start = at + 30 + dv.getUint16(at + 26, true) + dv.getUint16(at + 28, true), raw = buf.subarray(start, start + e.csize);
    if (e.method === 0){ if (raw.length > max) throw new Error("too large"); return raw.slice(); }
    if (e.method !== 8 || typeof DecompressionStream !== "function") throw new Error("packed in a way FinCom cannot open here");
    const rd = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader(), parts = [];
    let len = 0;
    for (;;){
      const {done, value} = await rd.read();
      if (done) break;
      len += value.length;
      if (len > max){ try { rd.cancel(); } catch (x){} throw new Error("too large"); }
      parts.push(value);
    }
    const out = new Uint8Array(len); let o = 0; for (const x of parts){ out.set(x, o); o += x.length; }
    return out;
  },
  async docxText(file){
    // a .docx is a zip; word/document.xml holds the text (paragraphs, table cells)
    const buf = new Uint8Array(await file.arrayBuffer()), e = this.zipList(buf).find(x => x.name === "word/document.xml");
    if (!e) throw new Error("not a Word file");
    const xml = new TextDecoder().decode(await this.unzip(buf, e, ZIP.entryBytes));
    return xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>|<\/w:tc>/g, "\t").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
  },
  // a file's words when it is text (no NUL in its first 8 KB): {text, full}; "" when it is not
  async plainText(file){
    const cap = ATTACH.textChars * 3, buf = new Uint8Array(await file.slice(0, cap).arrayBuffer());
    if (buf.subarray(0, 8192).includes(0)) return {text: "", full: 0};
    const text = new TextDecoder().decode(buf);
    return {text, full: file.size > cap ? Math.round(text.length * file.size / cap) : text.length};
  },
  // every sheet's rows (SheetJS, as gridsFromSheet), with its name
  async sheets(file){
    await ensureXlsx();
    if (!window.XLSX) throw {code: "xlsx_missing"};
    const plain = /\.(csv|txt)$/i.test(file.name) || /text\/(csv|plain)/.test(file.type);
    const wb = XLSX.read(await file.arrayBuffer(), plain ? {type: "array", raw: true} : {type: "array", cellDates: true, raw: false, dateNF: "dd/mm/yyyy"});
    return wb.SheetNames.map(n => ({name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], {header: 1, raw: true, defval: "", blankrows: false})}));
  },
  // rows on lines, cells by tabs, sheets apart by a blank line (fincom-assistant reads an .xls from it: filetable.ts)
  gridText(grids){ return grids.map(g => g.slice(0, 20000).map(r => r.map(c => cellText(c)).join("\t")).join("\n")).join("\n\n"); },
  // a zip: its list of files, then the text of the files FinCom can read in it, within the zip limits (ZIP: how many,
  // how large unpacked, a zip bomb, how deep)
  async zipText(buf, name, depth, seen){
    // seen: what this zip and the zips in it have opened together (the limits hold across the levels, not for each)
    seen = seen || {opened: 0, total: 0};
    const ents = this.zipList(buf).filter(e => !e.name.endsWith("/")), out = ["[The zip " + name + ": " + ents.length + " file" + (ents.length === 1 ? "" : "s") + (ents.length > ZIP.entries ? ", the first " + ZIP.entries + " listed" : "") + "]"];
    ents.slice(0, ZIP.entries).forEach(e => out.push("  " + e.name + " (" + kbOf(e.usize) + ")"));
    for (const e of ents.slice(0, ZIP.entries)){
      const ext = (e.name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || "";
      const skip = (why) => out.push("--- " + e.name + ": " + why + " ---");
      if (/^(png|jpe?g|webp|gif|heic|bmp|tiff?)$/.test(ext)){ skip("a picture: not read inside a zip"); continue; }
      if (/^(exe|dll|so|bin|dmg|iso|msi|apk|jar|class|mp[34]|mov|avi|wav)$/.test(ext)){ skip("not read (not a document)"); continue; }
      if (seen.opened >= ZIP.open){ skip("not opened: FinCom reads " + ZIP.open + " files of a zip"); continue; }
      if (e.flags & 1){ skip("locked with a password: not opened"); continue; }
      if (e.usize > 4096 && e.usize > Math.max(1, e.csize) * ZIP.ratio){ skip("not opened: it unpacks to far more than its size (a zip bomb?)"); continue; }
      if (e.usize === 0xffffffff || e.usize > ZIP.entryBytes){ skip("too large to open here"); continue; }
      if (seen.total + e.usize > ZIP.totalBytes){ skip("not opened: the zip's files are too large together"); continue; }
      if (ext === "zip" && depth >= ZIP.depth){ skip("a zip inside a zip inside a zip: listed only"); continue; }
      try {
        const b = await this.unzip(buf, e, Math.min(ZIP.entryBytes, ZIP.totalBytes - seen.total));
        seen.opened++; seen.total += b.length;
        const f = new File([b], e.name.split("/").pop(), {type: ""}), k = sniff(b.subarray(0, 16), e.name, "");
        // a zip by its bytes too (a zip named .dat): opened one level down at most
        if (k === "application/zip" && ext !== "zip" && depth >= ZIP.depth){ skip("a zip inside a zip inside a zip: listed only"); continue; }
        let t = "";
        if (ext === "zip" || k === "application/zip") t = await this.zipText(b, e.name, depth + 1, seen);
        else if (k === "application/pdf") t = (await AS26.pdfLines(f)).join("\n");
        else if (k === "xlsx" || /^(xlsx|xlsm|xls|csv)$/.test(ext)) t = this.gridText((await this.sheets(f)).map(x => x.rows));
        else if (k === "docx") t = await this.docxText(f);
        else t = (await this.plainText(f)).text;
        if (t.trim()) out.push("--- " + e.name + " ---", t.slice(0, ATTACH.textChars)); else skip("nothing FinCom can read in it");
      } catch (x){ skip(/too large/.test(String(x && x.message)) ? "not opened: it unpacks to more than " + kbOf(ZIP.entryBytes) : "could not be read (" + ((x && (x.message || x.code)) || "damaged") + ")"); }
    }
    return out.join("\n");
  },
  // a PDF's pages (0 when it cannot be opened: locked or damaged)
  async pdfPages(file){
    try { return (await window.pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, enableXfa: false}).promise).numPages || 0; } catch (e){ return 0; }
  },
  async read(file){
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer()), k = sniff(head, file.name, file.type);
    const out = {lines: [], grids: [], text: "", full: 0, pages: 0, locked: false, pdf: k === "application/pdf", image: /^image\//.test(k), sniffed: k};
    try {
      if (out.pdf){ out.lines = await AS26.pdfLines(file); out.pages = await this.pdfPages(file); }
      else if (out.image){ /* a picture: the AI sees it as it is */ }
      else if (k === "xlsx" || (this.isSheet(file) && k !== "docx" && k !== "application/zip")) out.grids = (await this.sheets(file)).map(x => x.rows);
      else if (k === "docx" || this.isWord(file)) out.lines = (await this.docxText(file)).split("\n");
      else if (k === "application/zip") out.text = await this.zipText(new Uint8Array(await file.arrayBuffer()), file.name, 1);
      else if (!isImage(file)) Object.assign(out, await this.plainText(file));
    } catch (e){ if (e && /pdf_(wrong_)?password/.test(e.code || "")) out.locked = true; out.err = (e && (e.code || e.message)) || "unreadable"; }
    if (!out.text) out.text = out.lines.length ? out.lines.join("\n") : this.gridText(out.grids);
    out.full = Math.max(out.full || 0, out.text.length);
    out.text = out.text.slice(0, ATTACH.textChars);
    return out;
  },

  // ---------------- the rules: what the file is, from what FinCom can read (no AI) ----------------
  // {kind, summary, side?} or null when the rules cannot tell
  rules(file, r, client){
    const name = String(file.name || ""), text = r.text || "", head = text.slice(0, 20000);
    const gstin = String((client || {}).gstin || "").toUpperCase();
    // a Tally export: brought in on the Tally pages, not here
    if (/^xml$/.test(this.ext(file)) && /<ENVELOPE>/i.test(head)){
      const t = /<VOUCHER[\s>]/.test(head) ? "Day Book" : /<(LEDGER|GROUP) NAME=/.test(head) ? "ledger masters" : /<DSPACCNAME>/.test(head) ? "trial balance" : "";
      if (t) return {kind: "other", tally: true, summary: "A Tally " + t + " export: bring it in from Books › Tally."};
    }
    // a notice: first (a notice may quote 26AS or invoices; a 26AS, a bill or a statement never reads as a notice)
    const nm = head.match(this.NOTICE);
    if (nm){
      const form = (head.match(/\b(ASMT-?1[01]|DRC-?0[1-7]A?|REG-?(?:0?3|17|31)|ADT-?0[12])\b/i) || [])[1];
      const sec = (head.match(/\b(?:u\/s|under\s+section)\s*([0-9]{2,3}[A-Z]?(?:\s*\(\s*[0-9a-z]+\s*\))*)/i) || [])[1];
      const by = (head.match(/\b(?:reply|respond|submit)[^\n]{0,60}?(?:by|on or before|before)\s*[:\-]?\s*(\d{1,2}[-\/.](?:\d{1,2}|[A-Za-z]{3})[-\/.]\d{2,4})/i) || [])[1];
      return {kind: "notice", summary: "A notice" + (form ? " (" + form.toUpperCase() + ")" : sec ? " under section " + sec.replace(/\s+/g, "") : "") + (by ? ", reply by " + by : "") + "."};
    }
    // a GSTR-1 or GSTR-2B file from the GST portal (JSON): a register of invoices, to be imported in Purchase or Sales
    if (this.ext(file) === "json" || /^\s*\{/.test(head)){
      const g = this.gstJson(text);
      if (g) return {kind: "register", gst: g.form, summary: "A " + g.form + " file from the GST portal" + (g.period ? " for " + g.period : "") + ": " + g.n + " invoice" + (g.n === 1 ? "" : "s") + (g.ctin ? " from " + g.ctin + " part" + (g.ctin === 1 ? "y" : "ies") : "") + "."};
    }
    // 26AS / AIS / TIS: the portal's words, the JSON it gives, or the file's name (its PDF is locked with a password)
    if (this.AS26.test(head) || (/^(json|txt)$/.test(this.ext(file)) && /Permanent Account Number|"(pan|PAN)"\s*:/.test(head) && /deduct|TDS|tax\s*collected/i.test(head)) || (r.locked && this.AS26_NAME.test(name))){
      const kind = /Annual\s+Information\s+Statement|\bAIS\b/i.test(head) || /\bais\b/i.test(name) ? "AIS" : /Taxpayer\s+Information\s+Summary|\bTIS\b/.test(head) ? "TIS" : "Form 26AS";
      let fy = (head.match(/Financial\s+Year\s*[:\-]?\s*(\d{4}-\d{2,4})/i) || [])[1];
      if (!fy){
        // TRACES' text export: a row of headings ("…^Financial Year^Assessment Year^…") with the values on the next line
        const ls = head.split(/\r?\n/), i = ls.findIndex(l => /Financial\s+Year/i.test(l) && /[\^\t|,]/.test(l));
        if (i >= 0 && ls[i + 1]){ const sep = (ls[i].match(/[\^\t|,]/) || ["^"])[0], c = ls[i].split(sep).findIndex(x => /Financial\s+Year/i.test(x)), v = (ls[i + 1].split(sep)[c] || "").trim(); if (/^\d{4}-\d{2,4}$/.test(v)) fy = v; }
      }
      return {kind: "as26", summary: kind + (fy ? " for " + fy : "") + (r.locked ? " (locked with a password: FinCom asks for it when it is added)" : "") + "."};
    }
    // a bank statement: a sheet whose headings are a statement's, or a PDF naming a bank with its balances
    for (const g of r.grids) if (findHeader(g)){
      const meta = statementMeta(g.slice(0, 25).map(row => row.map(c => cellText(c)).join(" ")));
      return {kind: "bank", summary: this.bankLine(meta)};
    }
    if (r.lines.length){
      const meta = statementMeta(r.lines.slice(0, 80));
      if ((meta.ifsc || meta.bank) && /\b(opening|closing)\s*bal(ance)?\b|statement\s+of\s+account|account\s+statement/i.test(head) && !this.BILL.test(r.lines.slice(0, 25).join("\n"))) return {kind: "bank", summary: this.bankLine(meta)};
    }
    if (r.locked && /statement|bank|a\/?c|acct/i.test(name)) return {kind: "bank", summary: "A bank statement locked with a password (FinCom asks for it when it is added)."};
    // a register: a sheet listing invoices (a heading row with the invoice, the party and an amount; three rows or more)
    for (const g of r.grids){
      for (let i = 0; i < Math.min(g.length, 15); i++){
        const hs = (g[i] || []).map(c => cellText(c).toLowerCase());
        const has = re => hs.some(h => re.test(h));
        if (has(/invoice|bill|voucher|inv\.?\s*no|document\s*no/) && has(/gstin|party|supplier|customer|vendor|buyer|name/) && has(/taxable|amount|value|total/) && g.length - i - 1 >= 3){
          const heads = (g[i] || []).map(c => cellText(c)).filter(Boolean);
          return {kind: "register", summary: "A register of " + (g.length - i - 1) + " rows (" + heads.slice(0, 6).join(", ") + (heads.length > 6 ? ", …" : "") + ")."};
        }
      }
    }
    // a certificate format: a certificate's words with blanks to fill
    const blanks = (head.match(this.BLANK) || []).length;
    if (this.CERT.test(head) && (blanks >= 2 || /\b(format|template)\b/i.test(head + " " + name))){
      const title = (r.lines.find(l => /certif/i.test(l)) || name).trim().slice(0, 90);
      return {kind: "certificate", summary: "A certificate format: " + title + (blanks ? " (" + blanks + " blank" + (blanks === 1 ? "" : "s") + " to fill)" : "") + "."};
    }
    // a bill: a tax invoice, a bill of supply or a note (not a proforma, an order, a quotation, a challan or a receipt)
    if (r.lines.length && this.BILL.test(r.lines.slice(0, 40).join("\n")) && !docKindOf(r.lines)){
      const no = (head.match(/\b(?:invoice|bill|note)\s*(?:no|number|#)\.?\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/\-.]{1,30})/i) || [])[1];
      const date = (head.match(/\b(?:invoice\s*)?date[d]?\s*[:\-]?\s*(\d{1,2}[-\/.](?:\d{1,2}|[A-Za-z]{3})[-\/.]\d{2,4})/i) || [])[1];
      // whose bill: made out to the client (a purchase) or by the client (a sale); when FinCom cannot tell, both are offered
      const bt = billToShipTo(r.lines), all = (head.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g) || []);
      const side = !gstin || !all.includes(gstin) ? "" : bt.bill === gstin ? "purchase" : bt.bill && bt.bill !== gstin ? "sales" : all[0] === gstin ? "sales" : "purchase";
      const what = /credit\s*note/i.test(head) ? "A credit note" : /debit\s*note/i.test(head) ? "A debit note" : /bill\s*of\s*supply/i.test(head) ? "A bill of supply" : "A tax invoice";
      return {kind: "bill", side, summary: what + (no ? " no. " + no.replace(/[.\-]+$/, "") : "") + (date ? " dated " + date : "") + (side === "purchase" ? ", made out to this client (a purchase)" : side === "sales" ? ", issued by this client (a sale)" : "") + "."};
    }
    return null;
  },
  // GSTR-1 ({gstin, fp, b2b: [{ctin, inv: [...]}], ...}) or GSTR-2B ({data: {gstin, rtnprd, docdata: {b2b: [{ctin, inv}]}}}):
  // the form, the period (MM-YYYY) and how many invoices; null when it is not one
  gstJson(text){
    let j; try { j = JSON.parse(text); } catch (e){ return null; }
    if (!j || typeof j !== "object") return null;
    const d = j.data && typeof j.data === "object" ? j.data : j;
    const two = d.docdata && typeof d.docdata === "object", src = two ? d.docdata : d;
    const secs = ["b2b", "b2ba", "cdnr", "cdnra", "b2cl", "b2cs", "exp", "isd", "impg"].filter(k => Array.isArray(src[k]));
    if (!secs.length || !(d.gstin || j.gstin)) return null;
    let n = 0; const parties = new Set();
    for (const k of secs) for (const x of src[k]){ if (x && x.ctin) parties.add(x.ctin); n += Array.isArray(x && x.inv) ? x.inv.length : Array.isArray(x && x.nt) ? x.nt.length : 1; }
    const fp = String(d.rtnprd || d.fp || j.fp || "");
    return {form: two ? "GSTR-2B" : "GSTR-1", period: /^\d{6}$/.test(fp) ? fp.slice(0, 2) + "-" + fp.slice(2) : "", n, ctin: parties.size};
  },
  bankLine(m){
    const acct = m.acct ? " account ending " + String(m.acct).slice(-4) : "";
    const per = m.from && m.to ? ", " + fmtDate(m.from) + " to " + fmtDate(m.to) : "";
    return "A bank statement" + (m.bank ? ": " + m.bank + "," : "") + acct + per + ".";
  },
  // the next steps for a kind (buttons; each is the user's own click)
  actions(u){
    const ask = {id: "ask", label: "Ask about it"};
    // firm-wide (no client open): a step that belongs to a client's pages waits for the client to be opened
    if (!u.cid && ["bill", "bank", "as26", "register"].includes(u.kind)) return [{id: "client", label: "Open the client to add it", disabled: true}, ask];
    if (u.tally) return [{id: "tally", label: "Open Books › Tally"}];
    switch (u.kind){
      case "notice": return [{id: "notice", label: "Read the notice and draft a reply", primary: true}];
      case "bill": return (u.side === "sales" ? [{id: "sales", label: "Add to Sales for review", primary: true}] : u.side === "purchase" ? [{id: "purchase", label: "Add to Purchase for review", primary: true}]
        : [{id: "purchase", label: "Add to Purchase for review", primary: true}, {id: "sales", label: "Add to Sales for review"}]).concat([ask]);
      // a register sheet or a GSTR-1/2B file: the Purchase or Sales page's own import (upload pages, src/js/82-registers.js),
      // which shows what it read for review; GSTR-2B is purchases, GSTR-1 sales; nothing is posted
      case "register": return (u.gst === "GSTR-2B" ? [{id: "importP", label: "Import in Purchase", primary: true}] : u.gst === "GSTR-1" ? [{id: "importS", label: "Import in Sales", primary: true}]
        : [{id: "importP", label: "Import in Purchase", primary: true}, {id: "importS", label: "Import in Sales"}]).concat([ask]);
      case "bank": return [{id: "bank", label: "Add to Bank for review", primary: true}];
      case "as26": return [{id: "as26", label: "Add to Reconciliations (26AS / AIS)", primary: true}];
      case "certificate": return [{id: "keep", label: "Use for a certificate", primary: true}, ask];
      default: return [ask];
    }
  },

  // ---------------- the question box's files: chips, sent with the question as one message ----------------
  // Chosen, dropped or pasted, each file is a chip in the box (its name, size, the upload's progress, ×): read here, told by
  // FinCom's rules, stored in the firm's private folder; nothing is in the conversation until Send. Up to LIMIT a message.
  // at most ATTACH.upAtOnce read and upload at the same time; the others wait ("queued")
  add(files){
    const a = this.st(), cid = ASST.cid();
    files = Array.from(files || []).filter(Boolean);
    if (!files.length) return;
    if (!Cloud.on()){ toast("Sign in to the firm account to attach files."); return; }
    const room = this.LIMIT - this.pending().length;
    if (room <= 0 || files.length > room) toast("Up to " + this.LIMIT + " files a message: " + (room <= 0 ? "send these first, or take one off." : "the first " + room + " " + (room === 1 ? "is" : "are") + " attached."));
    let total = this.pending().filter(u => u.state !== "failed").reduce((t, u) => t + (u.size || 0), 0);
    for (const file of files.slice(0, Math.max(0, room))){
      const u = {id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key: ASST.key(), cid, chip: true, name: file.name, size: file.size, type: file.type || "", file,
        state: "queued", progress: 0, kind: "", by: "", summary: "", acts: [], done: {}, at: new Date().toISOString()};
      try { if (isImage(file) && URL.createObjectURL) u.thumb = URL.createObjectURL(file); } catch (e){}
      // what can never be sent: said on its chip at once, with no Retry
      const no = !file.size ? "it is empty, 0 bytes" : file.size > this.MAX ? "larger than " + this.MAX / 1048576 + " MB" : total + file.size > ATTACH.totalBytes ? "the files of this message would be over " + ATTACH.totalBytes / 1048576 + " MB together" : "";
      // over the message's total: Retry once others are taken off (it is checked again); empty or too large: never
      if (no) Object.assign(u, {state: "failed", error: no, fatal: !/together/.test(no), overTotal: /together/.test(no)}); else total += file.size;
      a.uploads.push(u);
    }
    this.pump();
    ASST.draw();
    setTimeout(() => { const el = document.getElementById("asstQ"); if (el && document.activeElement !== el) el.focus({preventScroll: true}); }, 30);
  },
  pump(){
    const a = this.st();
    let n = a.uploads.filter(u => u.chip && u.state === "uploading" && !u.dropped).length;
    for (const u of a.uploads) if (n < ATTACH.upAtOnce && u.chip && u.state === "queued" && !u.dropped){ n++; this.run(u); }
  },
  async run(u){
    const co = (u.cid && CO(u.cid)) || {}, file = u.file;
    Object.assign(u, {state: "uploading", progress: 0, error: ""}); ASST.draw();
    try {
      const r = await this.read(file);
      u.excerpt = String(r.text || ""); u.full = r.full; u.pdf = r.pdf; u.native = r.pdf ? "pdf" : r.image ? "image" : ""; u.pages = r.pages;
      u.unread = !r.pdf && !r.image && !u.excerpt.trim(); u.tokens = textTokens(u.excerpt); u.sniffed = r.sniffed;
      const k = this.rules(file, r, co);
      if (k) Object.assign(u, k, {by: "rules"});
      else if (u.unread) Object.assign(u, {kind: "other", by: "rules", summary: "FinCom could not read this file" + (r.err ? " (" + r.err + ")" : "") + "."});
      u.path = await this.store(file, u.cid, k && k.kind === "notice" ? "notices" : "uploads", p => { u.progress = p; ASST.draw(); }, /^(application\/pdf|image\/)/.test(r.sniffed || "") ? r.sniffed : "");
      if (u.dropped) return;
      u.state = "ready"; u.acts = u.kind ? this.actions(u) : [];
      ASST.draw();
      // what the rules could not tell: the AI's one line, in the background (Send does not wait for it); the buttons under
      // the answer follow when it comes. Only for a few files at a time (30 would be 30 calls); the others are "other"
      if (!u.kind){ Object.assign(u, {kind: "other"}, this.pending().length <= 3 ? await this.classify(u, r) : {by: "rules", summary: ""}); u.acts = this.actions(u); }
      this.record(u).catch(() => {});
    } catch (e){ u.state = "failed"; u.error = (e && e.message) || String(e); }
    finally { this.pump(); }
    ASST.draw();
  },
  retry(u){
    if (!u || u.state !== "failed" || u.fatal) return;
    if (u.overTotal){
      const total = this.pending().filter(x => x !== u && x.state !== "failed").reduce((t, x) => t + (x.size || 0), 0);
      if (total + u.size > ATTACH.totalBytes){ toast("Still over " + ATTACH.totalBytes / 1048576 + " MB together: take another file off first."); return; }
      u.overTotal = false;
    }
    u.state = "queued"; this.pump(); ASST.draw();
  },
  drop(u){ const a = this.st(); u.dropped = true; a.uploads = a.uploads.filter(x => x !== u); try { if (u.thumb && !u.sent) URL.revokeObjectURL(u.thumb); } catch (e){} this.pump(); ASST.draw(); },
  // the box's upload, all files together: {n, done, pct} while any is waiting or uploading, else null
  progress(){
    const list = this.pending().filter(u => u.state !== "failed");
    if (!list.some(u => u.state === "queued" || u.state === "uploading")) return null;
    const all = list.reduce((t, u) => t + (u.size || 1), 0), got = list.reduce((t, u) => t + (u.size || 1) * (u.state === "ready" ? 1 : u.state === "uploading" ? (u.progress || 0) : 0), 0);
    return {n: list.length, done: list.filter(u => u.state === "ready").length, up: list.filter(u => u.state === "uploading").length, pct: Math.round(got * 100 / (all || 1))};
  },
  // what the AI will be given of the box's files, and about what it costs (attachrules.js: the server does the same):
  // {notes: {id: line}, tokens, inr}
  fit(){
    const list = this.pending().filter(u => u.state === "ready");
    const f = fitAttachments(list.map(u => ({name: u.name, size: u.size, native: u.native || "", pages: u.pages, chars: (u.excerpt || "").length, tokens: u.tokens, read: !u.unread})));
    const notes = {};
    list.forEach((u, i) => {
      let w = f.plan[i].why;
      // kept to ATTACH.textChars on this computer already: shortened too
      if (f.plan[i].mode === "text" && (u.full || 0) > (u.excerpt || "").length){ const pct = Math.max(1, Math.round(f.plan[i].chars * 100 / u.full)); w = (f.plan[i].cut ? w.replace(/\d+% of it/, pct + "% of it") : (w ? w + " " : "") + "Shortened to fit: the AI reads about the first " + pct + "% of it."); }
      if (w) notes[u.id] = w;
    });
    return {notes, tokens: f.tokens, inr: list.length ? attachInr(f.tokens, list.some(u => u.kind === "notice")) : 0};
  },
  // Send: the files in the box go with the question (75-assistant.js ask). null with none, false while one is not ready.
  // A file that could not be uploaded is not sent (it stays in the box, said so); the others go
  prep(q){
    const a = ASST.st(), all = this.pending();
    if (!all.length) return null;
    if (a.busy) return false;
    if (all.some(u => u.state === "uploading" || u.state === "queued")){ toast("Wait for the files to upload, then send."); return false; }
    const list = all.filter(u => u.state === "ready"), bad = all.filter(u => u.state === "failed");
    if (bad.length) toast((bad.length === 1 ? "1 file is" : bad.length + " files are") + " not sent: " + bad.map(u => u.name + " (" + u.error + ")").join("; ") + (list.length ? ". The others are sent." : "."));
    if (!list.length){ if (!String(q || "").trim()) return false; return null; }
    const notice = list.find(u => u.kind === "notice");
    q = q || (notice && list.length === 1 ? "Read this notice: what does it ask, by when, and check it against the books. Then draft a reply." : list.length === 1 ? "Read this file" : "Read these files");
    list.forEach(u => { u.sent = true; if (u.kind !== "notice" && !ASST.ups().some(x => x.path === u.path)) ASST.ups().push({path: u.path, name: u.name, type: u.type || ""}); });
    // read into the AI: a notice first (the notice flow keys on the first file), each with its kind and size; with the text
    // FinCom read of it (a PDF's too: it goes as its text when it cannot go as it is) and how long that text was
    const att = list.slice().sort((x, y) => (y.kind === "notice") - (x.kind === "notice")).map(u => {
      const x = {path: u.path, name: u.name, type: u.type || (u.pdf ? "application/pdf" : ""), kind: u.kind || "other", size: u.size};
      if (u.native !== "image" && u.excerpt){ x.text = u.excerpt; x.full = u.full || u.excerpt.length; }
      return x;
    });
    const fx = {q, files: list, att};
    // two statements attached and a comparison asked for: FinCom compares them line by line itself (asst-compare.js), the AI
    // explains; the files alone are read, not the client's books (else "compare these balance sheets" is the books' own card)
    const pdfs = list.filter(u => u.pdf);
    if (pdfs.length >= 2 && CMP_WORDS.test(q)){
      fx.noBooks = true;
      fx.cmp = async (turn) => {
        turn.tools.push({name: "compare_statements", label: "Comparing the two statements line by line"}); turn.toolAt = 0; ASST.draw();
        try {
          const m = await import("./asst-compare.js"), r = await m.compareFiles(pdfs[0], pdfs[1]);
          if (r.result){ turn.results.push(r.result); fx.sendQ = (q + "\n\n" + r.brief).slice(0, 3990); }
          else turn.warn = {message: r.why};
        } catch (e){ turn.warn = {message: "FinCom could not compare the statements itself just now (" + ((e && e.message) || e) + "); the AI reads both."}; }
        ASST.draw();
      };
    }
    return fx;
  },
  // into the firm's private bucket; the upload's progress (0..1) to onProgress (XMLHttpRequest: fetch tells no progress)
  // sniffed: the type the file's own bytes say (a PDF or a picture); else the browser's, kept only when it is a safe one
  async store(file, cid, folder, onProgress, sniffed){
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess(), name = String(file.name || "file").replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80);
    const path = Cloud.st.firm + "/" + (cid || "_firm") + "/" + folder + "/" + Date.now().toString(36) + "-" + name;
    const url = String(c.url).replace(/\/+$/, "") + "/storage/v1/object/assistant-files/" + path.split("/").map(encodeURIComponent).join("/");
    const status = await new Promise((ok, no) => {
      const x = new XMLHttpRequest();
      x.open("POST", url);
      x.setRequestHeader("apikey", c.key); x.setRequestHeader("Authorization", "Bearer " + s.access_token); x.setRequestHeader("Content-Type", storeType(file.name, sniffed || (/^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(file.type) ? "application/octet-stream" : file.type)));   // never served back as a page
      if (onProgress && x.upload) x.upload.onprogress = (e) => { if (e.lengthComputable && e.total) onProgress(Math.min(1, e.loaded / e.total)); };
      x.onload = () => ok(x.status); x.onerror = () => no(new Error("the connection failed")); x.ontimeout = () => no(new Error("the upload took too long"));
      x.timeout = 120000;
      x.send(file);
    });
    if (status < 200 || status >= 300) throw new Error("it could not be stored (" + status + ")");
    if (onProgress) onProgress(1);
    return path;
  },
  // the AI, only when the rules could not tell: a PDF or a picture as it is, anything else as the text FinCom read (masked
  // on the server). Its kind is shown as the AI's
  async classify(u, r){
    try {
      await Cloud.fresh().catch(() => {});
      const c = Cloud.cfg(), s = Cloud.sess(), bin = r.pdf || /^image\/(png|jpeg|webp|gif)$/.test(u.type);
      const res = await fetch(ASST.url(), {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"},
        body: JSON.stringify({action: "classify", client_id: u.cid, name: u.name, excerpt: bin ? (r.pdf ? String(u.excerpt || "").slice(0, 12000) : "") : u.excerpt, attachments: bin ? [{path: u.path, name: u.name, type: u.type || (r.pdf ? "application/pdf" : ""), kind: "upload"}] : []})});
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) return {kind: "other", by: "rules", summary: (j.error || "FinCom could not tell what this file is just now") + "", aiError: true};
      return {kind: AUpload.KIND[j.kind] ? j.kind : "other", by: "ai", summary: String(j.summary || "").slice(0, 300)};
    } catch (e){ return {kind: "other", by: "rules", summary: "FinCom could not tell what this file is just now.", aiError: true}; }
  },
  async record(u, patch){
    if (patch){ await Cloud.api("assistant_uploads?path=eq." + encodeURIComponent(u.path), {method: "PATCH", body: patch}); return; }
    await Cloud.api("assistant_uploads", {method: "POST", body: {client_id: u.cid, path: u.path, name: String(u.name).slice(0, 200), size: u.size, mime: u.type || null, kind: u.kind, kind_by: u.by === "ai" ? "ai" : "rules", summary: u.summary || null}});
  },
  // a step the user clicked. Each one hands the file to the page that already does that job, for review there
  async act(u, id, o){
    const a = this.st(), f = u.file, mark = (msg) => { u.done[id] = msg; this.record(u, {action: id}).catch(() => {}); ASST.draw(); };
    const atClient = async () => { if (S.view !== "company" || S.coId !== u.cid) await openCompany(u.cid); };
    try {
      if (id === "notice" || id === "ask"){
        a.attach = {path: u.path, name: u.name, type: u.type || (isPdf(f) ? "application/pdf" : ""), kind: u.kind === "notice" ? "notice" : u.kind || "other"};
        if (!/^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(a.attach.type) && !isPdf(f)) a.attach.text = u.excerpt || "";
        if (id === "notice"){ if (!a.q) a.q = "Read this notice: what does it ask, by when, and check it against the books. Then draft a reply."; }
        else if (!a.q) a.q = "What is in " + u.name + "? Summarise it.";
        if (!(o && o.quiet)) u.done[id] = "Attached to your next question.";
        ASST.draw(); setTimeout(() => { const el = document.getElementById("asstQ"); if (el) el.focus(); }, 60);
        return;
      }
      if (!f){ toast("Upload the file again: it was uploaded in an earlier session."); return; }
      if (id === "purchase"){ await atClient(); await enqueueFiles([f], u.cid); mark("Added to Purchase: it is being read, for you to review before anything is posted."); return; }
      if (id === "sales"){ await atClient(); if (!S.sales || S.sales.cid !== u.cid) await loadSales(u.cid); await uploadSales([f]); mark("Added to Sales for review."); return; }
      if (id === "bank"){
        await atClient(); if (!S.bank || S.bank.cid !== u.cid) await loadBank(u.cid);
        const before = (S.bank.stmts || []).length; await uploadStatements([f]);
        if ((S.bank.stmts || []).length > before) mark("Added to Bank for review."); else toast("The statement was not added: it was uploaded before, or could not be read.");
        return;
      }
      if (id === "as26"){
        await atClient();
        if (!S.books || S.books.cid !== u.cid){ toast("Open the client's books first (Books › Tally), then add the file again."); return; }
        const r = await AS26.add(f); if (r) mark("Added to Reconciliations › TDS receivable vs 26AS."); return;
      }
      if (id === "importP" || id === "importS"){
        const side = id === "importS" ? "sales" : "purchase";
        await atClient(); goStep("review", side === "sales" ? "sales" : "bills");
        await sheetStart([f], side);
        mark("Opened in " + (side === "sales" ? "Sales" : "Purchase") + "'s import: check what was read there; nothing is posted.");
        return;
      }
      if (id === "keep"){
        // the certificate tool reads it from the conversation's uploads (it is there already); the question is the user's to send
        if (!a.q) a.q = "Prepare the certificate in the format " + u.name + ".";
        mark("Given to the certificate tool with your next question; kept with this client's uploads.");
        setTimeout(() => { const el = document.getElementById("asstQ"); if (el) el.focus(); }, 60);
        return;
      }
      if (id === "tally"){ ASST.screen("tally_sync"); return; }
      if (id === "open"){ ASST.close(); await atClient(); goClient(u.done.as26 ? "books:recon" : u.done.sales ? "sales" : u.done.bank ? "bank" : "bills"); return; }
    } catch (e){ toast("That step could not be done: " + ((e && e.message) || e)); }
  },
  remove(u){ const a = this.st(); a.uploads = a.uploads.filter(x => x !== u); ASST.draw(); }
};
// "compare", "differences", "vs": a comparison of the files asked for
const CMP_WORDS = /\b(compare|comparison|compared|comparing|differences?|differ|vs\.?|versus|reconcile|changed?|changes)\b/i;
const kbOf = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " bytes";
ASST.upload = files => AUpload.add(files);
// the answer's stream says which files were not read or were shortened (server/assistant/index.ts: {t: "attach", notes})
if (!ASST.take.attachNotes){
  const take = ASST.take;
  ASST.take = function (t, e){ if (e && e.t === "attach"){ t.attachNotes = Array.isArray(e.notes) ? e.notes.slice(0, 30) : []; return; } return take.call(this, t, e); };
  ASST.take.attachNotes = true;
}
ASST.prep = function (q){ return AUpload.prep(q); };

export default AUpload;
