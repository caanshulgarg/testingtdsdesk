/* ================================================================== */
/* 26AS / AIS / TIS against the books, by upload (TDS/GST round 2,   */
/* item 2, T-A6)                                                      */
/* ================================================================== */
// The CA downloads the client's Form 26AS from TRACES (View Tax Credit → Export as Text, or the PDF) or its AIS / TIS from
// the compliance portal (JSON or PDF) and uploads it here. FinCom reads the tax deducted (and collected) on each line and
// lists, by TAN, section, quarter and amount:
//   - the client's own tax credit (the file's PAN is the client's): against the TDS receivable entries in the books
//     (a debit to a ledger the ledger check calls TDS or TCS receivable), party by party;
//   - the client as deductor (the file's PAN is someone else's, a deductee of the client): the lines whose TAN is the
//     client's, against the deductee's rows in FinCom's TDS returns.
// Each line is Matched, Only in 26AS (or AIS) or Only in the books (or FinCom's return). Nothing here changes a figure;
// linking a deductor's TAN to a party in the books only says which party it is (kept as b.tanParty).
//
// THE FILE LAYOUTS ARE ASSUMED (the government sites cannot be reached from where FinCom is built, so no official sample
// was read; the fixtures in tests/fixtures/tds-26as/ are written from the layouts as commonly known):
//   26AS text (TRACES "Export as Text"): one record a line, fields separated by "^". A header pair of lines ("File
//     Creation Date^Permanent Account Number (PAN)^…" and its values); then each part opens with a line naming it
//     ("PART-I - Details of Tax Deducted at Source", "PART-VI - Details of Tax Collected at Source", …). In a part, a
//     deductor's line: Sr. No.^Name of Deductor^TAN of Deductor^…^Total Amount Paid / Credited^Total Tax Deducted^Total
//     TDS Deposited; under it, each transaction on a line beginning "^": ^Sr. No.^Section^Transaction Date^Status of
//     Booking^Date of Booking^Remarks^Amount Paid / Credited^Tax Deducted^TDS Deposited. Dates as dd-Mon-yyyy. Read: by
//     the TAN, the section code (19x, 206C…), the dates and the last three amounts of each line, not by column number, so
//     an extra or missing empty column does not move a figure.
//   26AS PDF: the same tables as text lines (pdf.js); a deductor line ends in TAN and three amounts, a transaction line
//     carries Sr. No., section, date, the status letter, and three amounts. A row broken over two lines is not read: the
//     self-check below then says so.
//   AIS / TIS JSON (compliance portal "Download JSON"): any nesting. Each object whose keys name an amount paid and a tax
//     deducted (or collected) is a line; the TAN, deductor name, section (from an information code such as "TDS-194J")
//     and quarter are taken from it or the objects around it. The assessee's PAN from a key named PAN.
//   AIS PDF: lines "TDS-194J … NAME (TAN)" open a source; detail lines "1 Q1 15/04/2025 1,00,000 10,000 10,000 Active".
// Self-check: where a file gives each deductor's totals (26AS), the lines read must add up to them; a difference is shown
// once, at the top, and the file is marked "check".
const AS26 = {
  TAN: /\b([A-Z]{4}\d{5}[A-Z])\b/,
  PAN: /\b([A-Z]{5}\d{4}[A-Z])\b/,
  MON: {JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12},
  amt(s){ const t = String(s == null ? "" : s).replace(/[₹,\s]/g, ""); return /^-?\d+(\.\d+)?$/.test(t) ? num(t) : null; },
  isAmt(s){ return /^-?[\d,]+\.\d{1,2}$/.test(String(s || "").trim()) || /^-?\d[\d,]*$/.test(String(s || "").trim()); },
  // dd-Mon-yyyy, dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd → yyyymmdd
  date(s){
    const t = String(s || "").trim();
    let m = t.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{4})$/);
    if (m && this.MON[m[2].toUpperCase()]) return m[3] + String(this.MON[m[2].toUpperCase()]).padStart(2, "0") + m[1].padStart(2, "0");
    m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/); if (m) return m[3] + m[2].padStart(2, "0") + m[1].padStart(2, "0");
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + m[2] + m[3];
    return "";
  },
  sec(s){
    const t = String(s || "").toUpperCase().replace(/\s+/g, "");
    const m = t.match(/(206C[A-Z0-9()]*|19[0-9][A-Z0-9()]*|39[0-9]\(\d+\)[A-Z0-9()]*)/);
    return m ? m[1].replace(/[()]/g, "") : "";
  },
  // ---------------- 26AS text ----------------
  parseText(text){
    const lines = String(text || "").replace(/\r/g, "").split("\n");
    const out = {kind: "26AS", pan: "", holder: "", fy: "", rows: [], totals: []};
    // the header: a line naming the fields, the next line their values
    for (let i = 0; i < Math.min(lines.length - 1, 30); i++){
      if (/Permanent Account Number/i.test(lines[i])){
        const k = lines[i].split("^").map(x => x.trim()), v = lines[i + 1].split("^").map(x => x.trim());
        k.forEach((name, j) => {
          if (/Permanent Account Number/i.test(name) && this.PAN.test(v[j] || "")) out.pan = v[j].match(this.PAN)[1];
          else if (/Name of Assessee/i.test(name)) out.holder = v[j] || "";
          else if (/Financial Year/i.test(name)) out.fy = this.fyWords(v[j]);
        });
        break;
      }
    }
    if (!out.pan){ const m = String(text).match(/Permanent Account Number[^\n]*\n[^\n]*?\b([A-Z]{5}\d{4}[A-Z])\b/i); if (m) out.pan = m[1]; }
    let part = "", ded = null;
    lines.forEach(raw => {
      const line = raw.trim(); if (!line) return;
      const head = line.replace(/\^/g, " ").trim();
      if (/^PART[-\s]*[IVX]+\b/i.test(head)){ part = /Collected at Source/i.test(head) ? "TCS" : /Deducted at Source/i.test(head) && !/15G|15H/i.test(head) ? "TDS" : ""; ded = null; return; }
      if (!part) return;
      const f = raw.split("^").map(x => x.trim());
      if (/Name of (Deductor|Collector)|Section\s*\^?\s*Transaction|Sr\.?\s*No/i.test(line) && !/\d{2}-[A-Za-z]{3}-\d{4}/.test(line)) return;
      const nums = f.filter(x => this.isAmt(x) && /\./.test(x)).map(x => this.amt(x));
      const tan = (f.find(x => /^[A-Z]{4}\d{5}[A-Z]$/.test(x)) || "");
      if (tan){
        // a deductor's line: Sr. No., name, TAN, …, the three totals
        const name = f.filter(x => x && !/^\d+$/.test(x) && x !== tan && !this.isAmt(x))[0] || "";
        ded = {tan, name};
        if (nums.length >= 3){ const t = nums.slice(-3); out.totals.push({part, tan, name, amount: t[0], tax: t[1], deposited: t[2]}); }
        return;
      }
      if (!ded) return;
      // a transaction: section, transaction date, status, booking date, the three amounts
      // the section is the field just before the transaction date (a serial number such as 194 is not a section)
      const di = f.findIndex(x => this.date(x)), sec = di > 0 ? this.sec(f[di - 1]) : "", dates = f.map(x => this.date(x)).filter(Boolean);
      if (!sec || !dates.length || nums.length < 2) return;
      const st = (f.find(x => /^[FUPOM]$/.test(x)) || "");
      const t = nums.slice(-3);
      out.rows.push(this.row({part, tan: ded.tan, name: ded.name, section: sec, date: dates[0], booked: dates[1] || "", status: st,
        amount: t.length === 3 ? t[0] : null, tax: t.length === 3 ? t[1] : t[0], deposited: t.length === 3 ? t[2] : t[1]}));
    });
    if (!out.fy && out.rows.length) out.fy = this.majorFy(out.rows);
    return this.check(out);
  },
  fyWords(s){ const m = String(s || "").match(/(20\d{2})\s*-\s*(20)?(\d{2})/); return m ? m[1] + "-" + m[3] : ""; },
  majorFy(rows){ const c = {}; rows.forEach(r => { c[r.fy] = (c[r.fy] || 0) + 1; }); return Object.keys(c).sort((a, b) => c[b] - c[a])[0] || ""; },
  row(r){ const d = r.date || ""; return Object.assign(r, {fy: d ? TDS.fyOf(d) : r.fy || "", q: d ? TDS.qOf(d) : r.q || "", tax: r2(num(r.tax)), amount: r.amount == null ? null : r2(num(r.amount)), deposited: r.deposited == null ? null : r2(num(r.deposited))}); },
  // the lines read against the deductor's totals the file gives
  check(f){
    const diffs = [];
    (f.totals || []).forEach(t => {
      const rows = f.rows.filter(r => r.tan === t.tan && r.part === t.part), s = r2(rows.reduce((a, r) => a + r.tax, 0));
      if (Math.abs(s - t.tax) >= 1) diffs.push({tan: t.tan, name: t.name, file: t.tax, read: s});
    });
    f.check = {ok: !diffs.length, diffs};
    return f;
  },
  // ---------------- PDF (26AS, AIS) ----------------
  async pdfLines(file, password){
    await ensurePdfJs();
    if (!window.pdfjsLib) throw {code: "pdf_unavailable"};
    let pdf;
    try { pdf = await window.pdfjsLib.getDocument({data: new Uint8Array(await file.arrayBuffer()), password: password || undefined, isEvalSupported: false, enableXfa: false}).promise; }
    catch (e){ if (/password/i.test(String(e && (e.name || e.message)))) throw {code: password ? "pdf_wrong_password" : "pdf_password"}; throw {code: "pdf_broken"}; }
    const out = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 300); p++){
      const tc = await (await pdf.getPage(p)).getTextContent(), rows = [];
      (tc.items || []).filter(it => it.str && it.str.trim()).forEach(it => {
        const y = Math.round(it.transform[5]), x = it.transform[4];
        let r = rows.find(z => Math.abs(z.y - y) <= 2); if (!r){ r = {y, items: []}; rows.push(r); }
        r.items.push({x, s: it.str.replace(/\s+/g, " ").trim()});
      });
      rows.sort((a, b) => b.y - a.y).forEach(r => out.push(r.items.sort((a, b) => a.x - b.x).map(i => i.s).join(" ")));
    }
    return out;
  },
  parsePdfLines(lines){
    const text = lines.join("\n");
    if (/Annual Information Statement|Taxpayer Information Summary|\bAIS\b|\bTIS\b/i.test(text) && !/Annual Tax Statement|Form\s*26AS/i.test(text)) return this.parseAisLines(lines);
    const out = {kind: "26AS", pan: "", holder: "", fy: "", rows: [], totals: [], fromPdf: true};
    const pm = text.match(/Permanent Account Number\s*\(?PAN\)?\s*:?\s*([A-Z]{5}\d{4}[A-Z])/i) || text.match(this.PAN); if (pm) out.pan = pm[1];
    const nm = text.match(/Name of Assessee\s*:?\s*([^\n]+)/i); if (nm) out.holder = nm[1].replace(/Address.*$/i, "").trim();
    const fm = text.match(/Financial Year\s*:?\s*(20\d{2}\s*-\s*(?:20)?\d{2})/i); if (fm) out.fy = this.fyWords(fm[1]);
    const A = "(-?[\\d,]+\\.\\d{2})", D = "(\\d{2}-[A-Za-z]{3}-\\d{4})";
    const dedRe = new RegExp("^\\d+\\s+(.+?)\\s+([A-Z]{4}\\d{5}[A-Z])\\s+" + A + "\\s+" + A + "\\s+" + A + "$");
    const rowRe = new RegExp("^\\d+\\s+(\\S+)\\s+" + D + "\\s+([FUPOM])\\s+(?:" + D + "\\s+)?(?:(\\S.*?)\\s+)?" + A + "\\s+" + A + "\\s+" + A + "$");
    let part = "", ded = null;
    lines.forEach(l => {
      const line = l.trim();
      if (/^PART[-\s]*[IVX]+\b/i.test(line)){ part = /Collected at Source/i.test(line) ? "TCS" : /Deducted at Source/i.test(line) && !/15G|15H/i.test(line) ? "TDS" : ""; ded = null; return; }
      if (!part) return;
      let m = line.match(dedRe);
      if (m){ ded = {tan: m[2], name: m[1].trim()}; out.totals.push({part, tan: m[2], name: ded.name, amount: this.amt(m[3]), tax: this.amt(m[4]), deposited: this.amt(m[5])}); return; }
      m = line.match(rowRe);
      if (m && ded && this.sec(m[1])) out.rows.push(this.row({part, tan: ded.tan, name: ded.name, section: this.sec(m[1]), date: this.date(m[2]), status: m[3], booked: m[4] ? this.date(m[4]) : "",
        amount: this.amt(m[6]), tax: this.amt(m[7]), deposited: this.amt(m[8])}));
    });
    if (!out.fy && out.rows.length) out.fy = this.majorFy(out.rows);
    return this.check(out);
  },
  parseAisLines(lines){
    const text = lines.join("\n"), out = {kind: "AIS", pan: "", holder: "", fy: "", rows: [], totals: [], fromPdf: true};
    const pm = text.match(/\bPAN\b\s*:?\s*([A-Z]{5}\d{4}[A-Z])/i) || text.match(this.PAN); if (pm) out.pan = pm[1];
    const fm = text.match(/Financial Year\s*:?\s*(20\d{2}\s*-\s*(?:20)?\d{2})/i); if (fm) out.fy = this.fyWords(fm[1]);
    let src = null;
    lines.forEach(l => {
      const line = l.trim();
      const s = line.match(/\b(TDS|TCS)-([0-9A-Z()]+)\b.*?([A-Za-z0-9&.,'\- ]+?)\s*\(([A-Z]{4}\d{5}[A-Z])\)/);
      if (s){ src = {part: s[1], section: this.sec(s[2]), name: s[3].trim(), tan: s[4]}; return; }
      const m = line.match(/^\d+\s+(Q[1-4])\b.*?(\d{2}[\/-]\d{2}[\/-]\d{4})\s+(-?[\d,]+(?:\.\d+)?)\s+(-?[\d,]+(?:\.\d+)?)\s+(-?[\d,]+(?:\.\d+)?)(?:\s+(\w+))?/);
      if (m && src) out.rows.push(this.row({part: src.part, tan: src.tan, name: src.name, section: src.section, date: this.date(m[2]), status: m[6] || "",
        amount: this.amt(m[3]), tax: this.amt(m[4]), deposited: this.amt(m[5])}));
    });
    if (!out.fy && out.rows.length) out.fy = this.majorFy(out.rows);
    return this.check(out);
  },
  // ---------------- AIS / TIS JSON ----------------
  parseJson(j){
    const out = {kind: "AIS", pan: "", holder: "", fy: "", rows: [], totals: []};
    const K = {
      amount: /^(amount|amt)?.*(paid|credited|debited|gross|receipt)|^amount$|^amt$|^value$/i,
      tax: /(tds|tcs|tax).*(deducted|collected|amt|amount)$|^(tds|tcs|tax)$|^taxdeducted$|^tdsamt$/i,
      deposited: /deposit/i, date: /date|^dt|dt$/i, quarter: /quarter|qtr/i,
      tan: /tan/i, name: /name|source|deductor|collector|infosrc/i, section: /section|infocode|info_code|code$|category/i, status: /status/i
    };
    const str = v => (v == null ? "" : String(v)).trim();
    const walk = (o, ctx, depth) => {
      if (depth > 12 || o == null) return;
      if (Array.isArray(o)){ o.forEach(x => walk(x, ctx, depth + 1)); return; }
      if (typeof o !== "object") return;
      const c = Object.assign({}, ctx), keys = Object.keys(o);
      let amount = null, tax = null, deposited = null, date = "", q = "", status = "";
      keys.forEach(k => {
        const v = o[k]; if (v && typeof v === "object") return;
        const s = str(v), lk = k.replace(/[^A-Za-z]/g, "");
        if (!out.pan && /^(pan|assesseepan|panno)$/i.test(lk) && this.PAN.test(s)) { out.pan = s.match(this.PAN)[1]; return; }
        if (!out.holder && /^(name|assesseename|nameofassessee)$/i.test(lk) && depth <= 2) out.holder = s;
        if (!out.fy && /financialyear|^fy$/i.test(lk)) out.fy = this.fyWords(s);
        if (K.tan.test(lk) && /^[A-Z]{4}\d{5}[A-Z]$/.test(s)) { c.tan = s; return; }
        if (K.section.test(lk) && this.sec(s)) { c.section = this.sec(s); if (/^TCS/i.test(s)) c.part = "TCS"; else if (/^TDS/i.test(s)) c.part = "TDS"; }
        if (K.name.test(lk) && /[A-Za-z]{3}/.test(s) && !this.isAmt(s)) { const tm = s.match(/\(([A-Z]{4}\d{5}[A-Z])\)/); if (tm) c.tan = tm[1]; c.name = s.replace(/\s*\([A-Z]{4}\d{5}[A-Z]\)\s*/, "").trim(); }
        if (K.deposited.test(lk) && this.amt(s) != null) deposited = this.amt(s);
        else if (K.tax.test(lk) && this.amt(s) != null) tax = this.amt(s);
        else if (K.amount.test(lk) && this.amt(s) != null) amount = this.amt(s);
        if (K.quarter.test(lk)) { const m = s.match(/Q[1-4]/i); if (m) q = m[0].toUpperCase(); }
        else if (K.date.test(lk) && this.date(s)) date = date || this.date(s);
        if (K.status.test(lk)) status = s;
      });
      if (tax != null && (amount != null || deposited != null) && c.tan){
        out.rows.push(this.row({part: c.part || "TDS", tan: c.tan, name: c.name || "", section: c.section || "", date, q, status, amount, tax, deposited}));
        if (!date && q && out.fy){ const r = out.rows[out.rows.length - 1]; r.fy = out.fy; r.q = q; }
      }
      keys.forEach(k => { const v = o[k]; if (v && typeof v === "object") walk(v, c, depth + 1); });
    };
    walk(j, {}, 0);
    if (!out.fy && out.rows.length) out.fy = this.majorFy(out.rows.filter(r => r.fy));
    out.rows.forEach(r => { if (!r.fy) r.fy = out.fy; });
    return this.check(out);
  },
  // ---------------- a file brought in ----------------
  async read(file, password){
    const name = String(file.name || "").toLowerCase();
    if (/\.json$/.test(name)){ let j; try { j = JSON.parse(await file.text()); } catch (e){ throw {code: "not_json"}; } return this.parseJson(j); }
    if (/\.pdf$/.test(name) || file.type === "application/pdf") return this.parsePdfLines(await this.pdfLines(file, password));
    const t = await file.text();
    if (/^\s*[{\[]/.test(t)){ try { return this.parseJson(JSON.parse(t)); } catch (e){} }
    return this.parseText(t);
  },
  files(){ const b = S.books || {}; return Array.isArray(b.tds26as) ? b.tds26as : []; },
  clientPan(){ const co = CO() || {}; const p = String(co.pan || "").toUpperCase(); if (Certs.validPan(p)) return p; const g = String(co.gstin || "").toUpperCase(); return GSTIN_RE.test(g) ? g.slice(2, 12) : ""; },
  clientTan(){ return String((CO() || {}).tan || "").toUpperCase().trim(); },
  // whose file it is: the client's own (its tax credit) or a deductee's (the client's deductions as they see them)
  whose(f){ const p = this.clientPan(); return !f.pan || !p || f.pan === p ? "own" : "deductee"; },
  async add(file){
    let f;
    try { f = await this.read(file); }
    catch (e){
      if (e && e.code === "pdf_password"){
        const ans = await askConfirm({title: "This PDF has a password", ok: "Open",
          body: "TRACES and the compliance portal lock these PDFs. Type the password (26AS: the date of birth or incorporation as DDMMYYYY; AIS: the PAN in small letters followed by it).<br><input type=\"password\" id=\"as26pw\" aria-label=\"PDF password\" style=\"margin-top:8px;width:100%\">",
          read: () => (document.getElementById("as26pw") || {}).value || "", validate: v => v ? "" : "Type the password."});
        if (!ans || !ans.ok) return null;
        try { f = await this.read(file, ans.data); }
        catch (e2){ toast(e2 && e2.code === "pdf_wrong_password" ? "That password did not open the PDF." : "The PDF could not be read."); return null; }
      } else { toast(e && e.code === "not_json" ? file.name + " is not a JSON file the portal gives." : file.name + " could not be read."); return null; }
    }
    if (!f.rows.length){ toast(file.name + ": no tax deducted or collected was found in it. Use the 26AS text file (TRACES: Export as Text) or the AIS JSON."); return null; }
    const b = S.books;
    f.id = uid("as"); f.file = file.name; f.at = new Date().toISOString(); f.by = typeof whoAmI === "function" ? whoAmI() : "";
    // the same statement brought in again replaces the earlier one (same kind, PAN and year)
    const same = this.files().find(x => x.kind === f.kind && x.pan === f.pan && x.fy === f.fy);
    b.tds26as = this.files().filter(x => x !== same).concat([f]);
    saveBooks(); render();
    toast(f.kind + (f.pan ? " of " + f.pan : "") + (f.fy ? ", " + f.fy : "") + ": " + f.rows.length + " line" + (f.rows.length === 1 ? "" : "s") + " read" + (same ? ", in place of the one brought in earlier" : "") + ".");
    return f;
  },
  async remove(id){
    const f = this.files().find(x => x.id === id); if (!f) return false;
    const ok = await askConfirm({title: "Take this file out?", body: esc(f.kind + " " + (f.pan || "") + " " + (f.fy || "") + " (" + f.file + ")") + " leaves the reconciliation. Upload it again to bring it back.", ok: "Take it out"});
    if (!ok || !ok.ok) return false;
    S.books.tds26as = this.files().filter(x => x.id !== id); saveBooks(); render(); return true;
  },
  // ---------------- the client's own tax credit against its books ----------------
  // each debit to a TDS or TCS receivable ledger: the date, the party (the entry's party, else the ledger on the other
  // side that is not tax or bank), the amount. A transfer between two receivable ledgers is not a credit
  bookCredits(){
    const out = [];
    ((S.books || {}).vouchers || []).forEach(v => {
      if (v.opt || v.cancel) return;
      const rec = e => { const k = Books.ledgerOf(e.l).kind || ""; const w = (Books.ledgerOf(e.l).what || ""); return k === "tds_receivable" || k === "tcs_receivable" || w === "tds_receivable" || w === "tcs_receivable"; };
      const deb = v.ent.filter(e => rec(e) && e.a < 0), cred = v.ent.filter(e => rec(e) && e.a > 0);
      if (!deb.length || cred.length) return;
      let party = v.party && !rec({l: v.party}) && !Books.ledgerOf(v.party).kind ? v.party : "";
      if (!party){ const o = v.ent.find(e => e.a > 0 && !Books.ledgerOf(e.l).kind); if (o) party = o.l; }
      deb.forEach((e, i) => out.push({id: v.id + "|" + i, vid: v.id, date: v.date, fy: TDS.fyOf(v.date), q: TDS.qOf(v.date), party, ledger: e.l,
        tcs: /tcs/.test(Books.ledgerOf(e.l).kind || Books.ledgerOf(e.l).what || ""), tax: r2(Math.abs(e.a)), voucher: v.no || v.ref || "", type: v.type}));
    });
    return out;
  },
  parties(){ return Array.from(new Set(this.bookCredits().map(x => x.party).filter(Boolean))).sort(); },
  // the party a TAN is, as the person linked it, else the one party whose name is the deductor's
  partyOf(tan, name){
    const m = ((S.books || {}).tanParty || {})[tan];
    if (m) return {party: m, how: "linked"};
    const list = this.parties(); let best = null, sc = 0;
    list.forEach(p => { const s = nameSim(p, name); if (s > sc){ sc = s; best = p; } });
    return sc >= 0.9 ? {party: best, how: "name"} : {party: "", how: ""};
  },
  link(tan, party){ const b = S.books; b.tanParty = Object.assign({}, b.tanParty); if (party) b.tanParty[tan] = party; else delete b.tanParty[tan]; saveBooks(); render(); },
  // match the file's lines with the books: the same party, year and tax (within a rupee), the same quarter first and the
  // nearest date; then what is left of a party's quarter as a whole when the totals agree
  near(a, b){ return Math.abs(num(a) - num(b)) < 1; },
  pair(lines, books, keyL, keyB){
    const used = new Set(), out = [];
    lines.forEach(l => {
      const c = books.filter(x => !used.has(x.id) && keyL(l) && keyL(l) === keyB(x) && x.fy === l.fy && this.near(x.tax, l.tax));
      if (!c.length) return;
      c.sort((a, b) => ((a.q === l.q ? 0 : 1) - (b.q === l.q ? 0 : 1)) || Math.abs(Date.parse(tallyDate(a.date)) - Date.parse(tallyDate(l.date))) - Math.abs(Date.parse(tallyDate(b.date)) - Date.parse(tallyDate(l.date))));
      used.add(c[0].id); l._m = c[0]; out.push({status: "matched", how: c[0].q === l.q ? "line" : "line, another quarter", line: l, book: c[0]});
    });
    // the quarter's totals
    const left = lines.filter(l => !l._m), byK = {};
    left.forEach(l => { const k = keyL(l) + "|" + l.fy + "|" + l.q; if (keyL(l)) (byK[k] = byK[k] || {l: [], b: []}).l.push(l); });
    books.filter(x => !used.has(x.id)).forEach(x => { const k = keyB(x) + "|" + x.fy + "|" + x.q; if (byK[k]) byK[k].b.push(x); });
    Object.values(byK).forEach(g => {
      if (!g.b.length) return;
      const a = r2(g.l.reduce((s, x) => s + x.tax, 0)), b = r2(g.b.reduce((s, x) => s + x.tax, 0));
      if (!this.near(a, b)) return;
      g.l.forEach(l => { l._m = g.b[0]; out.push({status: "matched", how: "quarter total", line: l, book: null, group: g.b}); });
      g.b.forEach(x => used.add(x.id));
    });
    lines.filter(l => !l._m).forEach(l => out.push({status: "file", line: l}));
    books.filter(x => !used.has(x.id)).forEach(x => out.push({status: "books", book: x}));
    lines.forEach(l => { delete l._m; });
    return out;
  },
  own(fy){
    const files = this.files().filter(f => this.whose(f) === "own" && (!fy || f.fy === fy));
    // one file per year: the 26AS first (the tax credit as TRACES books it), else the AIS
    const f = files.find(x => x.kind === "26AS") || files[0];
    if (!f) return null;
    const lines = f.rows.filter(r => r.fy === f.fy).map(r => Object.assign({}, r, {party: this.partyOf(r.tan, r.name)}));
    const books = this.bookCredits().filter(x => x.fy === f.fy);
    // a TCS credit (Part VI) only against TCS in the books, TDS against TDS (the TDS review, L6)
    const res = this.pair(lines, books, l => l.party.party && l.party.party + "|" + (l.part === "TCS" ? "TCS" : "TDS"), x => x.party + "|" + (x.tcs ? "TCS" : "TDS"));
    // by deductor: the file's tax, the books' tax for the party it is linked to, the difference
    const by = {};
    lines.forEach(l => { const d = by[l.tan] = by[l.tan] || {tan: l.tan, name: l.name, party: l.party, file: 0, books: 0, pending: 0}; d.file = r2(d.file + l.tax); if (l.status && l.status !== "F") d.pending = r2(d.pending + l.tax); });
    Object.values(by).forEach(d => { d.books = r2(books.filter(x => d.party.party && x.party === d.party.party).reduce((a, x) => a + x.tax, 0)); d.diff = r2(d.file - d.books); });
    const linked = new Set(Object.values(by).map(d => d.party.party).filter(Boolean));
    const noTan = {};
    books.filter(x => !linked.has(x.party)).forEach(x => { const k = x.party || "(no party)"; noTan[k] = r2((noTan[k] || 0) + x.tax); });
    return {file: f, rows: res, deductors: Object.values(by).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)), booksOnly: noTan,
      sum: {file: r2(lines.reduce((a, l) => a + l.tax, 0)), books: r2(books.reduce((a, x) => a + x.tax, 0))}};
  },
  // ---------------- the client as deductor: what its deductees' statements show against its returns ----------------
  deductees(fy){
    const tan = this.clientTan(), out = [];
    this.files().filter(f => this.whose(f) === "deductee" && (!fy || f.fy === fy)).forEach(f => {
      const lines = f.rows.filter(r => r.fy === f.fy && (tan ? r.tan === tan : false));
      const rows = ["26Q", "27Q", "27EQ", "24Q"].flatMap(form => TDS.formRows(form).map(r => Object.assign({form}, r))).filter(r => r.fy === f.fy && String(r.pan || "").toUpperCase() === f.pan);
      const books = rows.map(r => ({id: r.id, date: r.date, fy: r.fy, q: r.q, tax: r.tds, amount: r.paid, section: TDS.sec(r.section), party: r.party, form: r.form, pan: r.pan}));
      const res = this.pair(lines, books, () => f.pan, () => f.pan);
      res.forEach(x => { if (x.status === "matched" && x.book && x.line.section && x.book.section && TDS.sec(x.line.section) !== x.book.section) x.note = "section " + x.line.section + " in " + f.kind + ", " + x.book.section + " in FinCom"; });
      res.forEach(x => { if (x.status === "books"){ const fl = TDSFiled.get(x.book.fy, x.book.q, x.book.form); x.note = fl ? "the return was filed: a correction may be needed (PAN or the row)" : "the return is not marked filed yet"; } });
      out.push({file: f, tan, party: (rows[0] || {}).party || f.holder || "", rows: res, sum: {file: r2(lines.reduce((a, l) => a + l.tax, 0)), books: r2(books.reduce((a, x) => a + x.tax, 0))}, noTan: !tan});
    });
    return out;
  }
};
