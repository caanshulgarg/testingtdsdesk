/* ================================================================== */
/* FinCom Assistant: one Upload (the owner's request of 14-Oct-2026). */
/* Anything can be uploaded (PDF, picture, Excel/CSV, Word, JSON),    */
/* several at once or dropped on the panel. FinCom says what each    */
/* file is by its own rules first (the readers the app already has); the AI is   */
/* asked only when they cannot tell. Then the next steps as buttons:  */
/* nothing is posted, filed or added by itself.                       */
/* ================================================================== */
const AUpload = {
  KIND: {notice: "Notice", bill: "Bill or invoice", register: "Register", bank: "Bank statement", as26: "26AS / AIS / TRACES", certificate: "Certificate format", other: "Other document"},
  MAX: 20 * 1024 * 1024,
  ACCEPT: ".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls,.csv,.docx,.txt,.json,.xml,application/pdf,image/png,image/jpeg,image/webp",
  // a tax department's notice, intimation, show cause or order (the words such a notice carries; a bill does not)
  NOTICE: /\b(ASMT-?1[01]|DRC-?0[1-7]A?|REG-?(0?3|17|31)|ADT-?0[12]|show\s*cause\s*notice|notice\s+(u\/s|under\s+section)|intimation\s+u\/s|under\s+section\s+(143|148A?|142|133\(6\)|73|74|61|65)\b[^\n]{0,80}\bnotice|document\s+identification\s+number|\bDIN\s*[:\-]?\s*(ITBA|CBIC|ZD)|demand\s+order|scrutiny\s+notice|reply\s+(by|within)[^\n]{0,40}(days|\d{2}[-\/.]\d{2}))/i,
  AS26: /Annual\s+Tax\s+Statement|Form\s*(No\.?\s*)?26AS|Annual\s+Information\s+Statement|Taxpayer\s+Information\s+Summary|\bTRACES\b/i,
  AS26_NAME: /26\s*as|\bais\b|\btis\b|traces|annual[-_ ]?(tax|information)/i,
  BILL: /\b(tax\s*invoice|gst\s*invoice|invoice\s*(no|number|#|date)|bill\s*of\s*supply|bill\s*(no|number)|credit\s*note|debit\s*note)\b/i,
  CERT: /\bthis\s+is\s+to\s+certify\b|\bwe\s+(hereby\s+)?certify\b|\bcertificate\b[^\n]{0,60}\b(format|template)\b|\bUDIN\b/i,
  BLANK: /_{4,}|\.{6,}|\[[A-Za-z][A-Za-z .\/]{1,30}\]|\{\{[^}]{1,40}\}\}|<<[^>]{1,40}>>|\bXX+\b/g,

  st(){ const a = ASST.st(); a.uploads = a.uploads || []; return a; },
  list(){ const k = ASST.key(), a = this.st(); return a.uploads.filter(u => u.key === k); },
  ext(f){ return (String(f.name || "").toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || ""; },
  isSheet(f){ return /^(xlsx|xls|xlsm|csv)$/.test(this.ext(f)) || /spreadsheet|ms-excel|text\/csv/.test(f.type || ""); },
  isWord(f){ return this.ext(f) === "docx" || /wordprocessingml/.test(f.type || ""); },

  // ---------------- what FinCom can read of the file, on this computer ----------------
  async docxText(file){
    // a .docx is a zip; word/document.xml holds the text (paragraphs, table cells)
    const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50){ eocd = i; break; }
    if (eocd < 0) throw new Error("not a Word file");
    let p = dv.getUint32(eocd + 16, true);
    const n = dv.getUint16(eocd + 10, true);
    for (let k = 0; k < n; k++){
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (name !== "word/document.xml") continue;
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = buf.subarray(start, start + csize);
      let xml;
      if (method === 0) xml = new TextDecoder().decode(raw);
      else if (method === 8 && typeof DecompressionStream === "function") xml = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
      else throw new Error("this Word file cannot be read here");
      return xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>|<\/w:tc>/g, "\t").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'");
    }
    throw new Error("not a Word file");
  },
  async read(file){
    const out = {lines: [], grids: [], text: "", locked: false, pdf: isPdf(file), image: isImage(file)};
    try {
      if (out.pdf) out.lines = await AS26.pdfLines(file);
      else if (this.isSheet(file)) out.grids = await gridsFromSheet(file);
      else if (this.isWord(file)) out.lines = (await this.docxText(file)).split("\n");
      else if (!out.image && file.size < 5 * 1024 * 1024) out.text = await file.text();
    } catch (e){ if (e && /pdf_(wrong_)?password/.test(e.code || "")) out.locked = true; out.err = (e && (e.code || e.message)) || "unreadable"; }
    if (!out.text) out.text = out.lines.length ? out.lines.join("\n") : out.grids.map(g => g.slice(0, 200).map(r => r.map(c => cellText(c)).join("\t")).join("\n")).join("\n\n");
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
    if (u.tally) return [{id: "tally", label: "Open Books › Tally"}];
    switch (u.kind){
      case "notice": return [{id: "notice", label: "Read the notice and draft a reply", primary: true}];
      case "bill": return (u.side === "sales" ? [{id: "sales", label: "Add to Sales for review", primary: true}] : u.side === "purchase" ? [{id: "purchase", label: "Add to Purchase for review", primary: true}]
        : [{id: "purchase", label: "Add to Purchase for review", primary: true}, {id: "sales", label: "Add to Sales for review"}]).concat([ask]);
      // the import of a register or a GSTR-1/2B file is being built (branch upload-pages); until it lands: coming soon
      case "register": return [{id: "soon", label: "Import in Purchase/Sales: coming soon", disabled: true}, ask];
      case "bank": return [{id: "bank", label: "Add to Bank for review", primary: true}];
      case "as26": return [{id: "as26", label: "Add to Reconciliations (26AS / AIS)", primary: true}];
      case "certificate": return [{id: "keep", label: "Keep as a certificate format", primary: true}, ask];
      default: return [ask];
    }
  },

  // ---------------- the Upload: store, tell, offer ----------------
  async add(files){
    const a = this.st(), cid = ASST.cid();
    files = Array.from(files || []).filter(Boolean);
    if (!files.length) return;
    if (!cid){ toast("Open the client the files are for first."); return; }
    if (!Cloud.on()){ toast("Sign in to the firm account to upload."); return; }
    const co = CO(cid) || {};
    a.uploading = true; ASST.draw();
    for (const file of files.slice(0, 20)){
      const u = {id: "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key: ASST.key(), cid, name: file.name, size: file.size, type: file.type || "", file,
        state: "reading", kind: "", by: "", summary: "", acts: [], done: {}, at: new Date().toISOString()};
      a.uploads.push(u); ASST.draw();
      try {
        if (file.size > this.MAX) throw new Error("it is larger than 20 MB");
        if (!file.size) throw new Error("it is empty");
        const r = await this.read(file);
        u.excerpt = String(r.text || "").slice(0, 20000);
        const k = this.rules(file, r, co);
        if (k){ Object.assign(u, k, {by: "rules"}); }
        // stored in the firm's private folder: a notice where notices go (the notice flow as before), anything else in uploads/
        u.path = await this.store(file, cid, k && k.kind === "notice" ? "notices" : "uploads");
        if (!k){
          if (!r.pdf && !r.image && !String(r.text || "").trim()) Object.assign(u, {kind: "other", by: "rules", summary: "FinCom could not read this file" + (r.err ? " (" + r.err + ")" : "") + "."});
          else { u.state = "asking"; ASST.draw(); Object.assign(u, await this.classify(u, r)); }
        }
        u.acts = this.actions(u);
        u.state = "ready";
        this.record(u).catch(() => {});
      } catch (e){ u.state = "failed"; u.error = (e && e.message) || String(e); }
      ASST.draw();
    }
    a.uploading = false; ASST.draw();
    // one notice uploaded alone: ready to ask, as the Notice button did
    const ready = this.list().filter(u => u.state === "ready"), last = ready[ready.length - 1];
    if (files.length === 1 && last && last.kind === "notice" && last.name === files[0].name) this.act(last, "notice", {quiet: true});
  },
  async store(file, cid, folder){
    await Cloud.fresh().catch(() => {});
    const c = Cloud.cfg(), s = Cloud.sess(), name = String(file.name || "file").replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80);
    const path = Cloud.st.firm + "/" + cid + "/" + folder + "/" + Date.now().toString(36) + "-" + name;
    const r = await fetch(String(c.url).replace(/\/+$/, "") + "/storage/v1/object/assistant-files/" + path.split("/").map(encodeURIComponent).join("/"),
      {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": file.type || "application/octet-stream"}, body: file});
    if (!r.ok) throw new Error("it could not be stored (" + r.status + ")");
    return path;
  },
  // the AI, only when the rules could not tell: a PDF or a picture as it is, anything else as the text FinCom read (masked
  // on the server). Its kind is shown as the AI's
  async classify(u, r){
    try {
      await Cloud.fresh().catch(() => {});
      const c = Cloud.cfg(), s = Cloud.sess(), bin = r.pdf || /^image\/(png|jpeg|webp|gif)$/.test(u.type);
      const res = await fetch(ASST.url(), {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"},
        body: JSON.stringify({action: "classify", client_id: u.cid, name: u.name, excerpt: bin ? "" : u.excerpt, attachments: bin ? [{path: u.path, name: u.name, type: u.type || (r.pdf ? "application/pdf" : "")}] : []})});
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
      if (id === "keep"){ mark("Kept with this client's uploads as a certificate format."); return; }
      if (id === "tally"){ ASST.screen("tally_sync"); return; }
      if (id === "open"){ ASST.close(); await atClient(); goClient(u.done.as26 ? "books:recon" : u.done.sales ? "sales" : u.done.bank ? "bank" : "bills"); return; }
    } catch (e){ toast("That step could not be done: " + ((e && e.message) || e)); }
  },
  remove(u){ const a = this.st(); a.uploads = a.uploads.filter(x => x !== u); ASST.draw(); }
};
ASST.upload = files => AUpload.add(files);
