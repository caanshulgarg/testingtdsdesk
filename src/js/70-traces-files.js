/* @react-lazy: begin 70-traces-files.js (the React app loads this file with its TDS screens: app/src/lib/tdsGlobals.js and app/src/screens/tds/Files.jsx; build.py react_parts; integ-link 27-Oct-2026, legacy.js's size budget) */
/* ================================================================== */
/* TRACES files by upload (TDS/GST round 2, item 3, T-S4): Form 16A,  */
/* the justification report and the consolidated file                 */
/* ================================================================== */
// The CA downloads these from TRACES (there is no API) and uploads them on the TDS page › TRACES files:
//   Form 16A (Form 131 from tax year 2026-27): the zip of certificates, or the PDFs themselves. Each PDF is kept with its
//     deductee (by the deductee's PAN, from the file name or the certificate's text), in this browser's file store and the
//     firm's cloud documents, and can be downloaded from the deductee's line.
//   Justification report: the defaults TRACES found in a statement (short deduction, short payment, interest for paying
//     or deducting late, the late fee, PAN errors), read into the "TRACES defaults" list of that return, with what to do.
//   Consolidated file: the statement as TRACES holds it; its deductee lines (PAN, name, amounts) are checked against
//     FinCom's return before a correction is prepared.
// Nothing here changes a figure of the return. A file brought in again for the same return replaces the earlier one.
//
// THE FILE LAYOUTS ARE ASSUMED (TRACES cannot be reached from where FinCom is built; the fixtures in
// tests/fixtures/traces/ are written from the layouts as commonly known):
//   zip: a plain zip, or one locked with a password using the zip format's original encryption (ZipCrypto). A zip locked
//     with AES is not opened: FinCom asks for the files unzipped. A zip may hold another zip.
//   Form 16A: PDFs (TRACES-PDF-CONVERTER's output), one per deductee and quarter. The file name usually starts with the
//     deductee's PAN ("ABCPD1234E_Q1_2025-26.pdf"); else the PAN is read from the certificate ("PAN of the Deductee"). A
//     zip holding only the converter's text file is named as such: convert it with TRACES-PDF-CONVERTER first.
//   Justification report (text): a header with TAN, financial year, quarter and form; a "Summary of Defaults" of
//     "label ^ amount" lines; then one table per kind of default under a heading naming it ("Short Deduction", "Short
//     Payment", "Interest on Payment Default", "Interest on Deduction Default", "Late Filing Fee u/s 234E", "PAN Errors"),
//     fields separated by "^" (or tabs). A line of a table is read by its PAN, section, dates and the last amount, which
//     is taken as the default's amount; the summary's own figure is shown beside the lines' total, and a difference is
//     said once.
//   Consolidated file: the statement's FVU text layout ("^"-separated FH, BH, CD, DD records). BH gives the TAN, form,
//     year and quarter; each DD a deductee: its PAN (or PANNOTAVBL / PANINVALID / PANAPPLIED), its name, its amounts.
//     The DD's fields are read by what they look like, not by column number.
const TRF = {
  // ---------------- zip ----------------
  CRC: null,
  crcTable(){ if (this.CRC) return this.CRC; const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (this.CRC = t); },
  crc32(c, b){ return (this.crcTable()[(c ^ b) & 0xff] ^ (c >>> 8)) >>> 0; },
  // the zip format's original password protection
  zipDecrypt(data, password){
    const T = this; let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
    const upd = (b) => { k0 = T.crc32(k0, b); k1 = (k1 + (k0 & 0xff)) >>> 0; k1 = (Math.imul(k1, 134775813) + 1) >>> 0; k2 = T.crc32(k2, k1 >>> 24); };
    const pw = new TextEncoder().encode(password || ""); for (const b of pw) upd(b);
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++){ const t = (k2 | 2) & 0xffff, kb = (Math.imul(t, t ^ 1) >>> 8) & 0xff, c = data[i] ^ kb; upd(c); out[i] = c; }
    return out;
  },
  async inflate(data){
    if (typeof DecompressionStream !== "function") throw {code: "zip_unsupported"};
    const s = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(s).arrayBuffer());
  },
  // [{name, data: Uint8Array}]; a password asked once if a file in it is locked
  async unzip(bytes, ask){
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let e = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50){ e = i; break; }
    if (e < 0) throw {code: "zip_broken"};
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
    const out = []; let password = null;
    for (let i = 0; i < n; i++){
      if (dv.getUint32(p, true) !== 0x02014b50) throw {code: "zip_broken"};
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true);
      const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + xl + cl;
      if (/\/$/.test(name)) continue;
      const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
      let data = u8.subarray(ds, ds + csize);
      if (method === 99) throw {code: "zip_aes"};
      if (flags & 1){
        if (password == null){ password = ask ? await ask() : null; if (password == null) throw {code: "zip_cancelled"}; }
        const d = this.zipDecrypt(data, password);
        // the 12th byte of the header is the check byte: the CRC's top byte (or the file time's, when sizes follow the data)
        const check = flags & 8 ? dv.getUint16(lo + 10, true) >>> 8 : crc >>> 24;
        if (d[11] !== check) throw {code: "zip_password"};
        data = d.subarray(12);
      }
      if (method === 8) data = await this.inflate(data);
      else if (method !== 0) throw {code: "zip_unsupported"};
      out.push({name: name.split("/").pop(), data});
    }
    return out;
  },
  async askPassword(what){
    const ans = await askConfirm({title: "This zip has a password", ok: "Open",
      body: esc(what) + " is locked. Type the password TRACES gave with the download.<br><input type=\"password\" id=\"trfpw\" aria-label=\"Zip password\" style=\"margin-top:8px;width:100%\">",
      read: () => (document.getElementById("trfpw") || {}).value || "", validate: v => v ? "" : "Type the password."});
    return ans && ans.ok ? ans.data : null;
  },
  // every file of an upload: a zip opened (and a zip inside it), anything else as it is
  async expand(file){
    const isZip = /\.zip$/i.test(file.name || "") || file.type === "application/zip";
    if (!isZip) return [file];
    const parts = await this.unzip(new Uint8Array(await file.arrayBuffer()), () => this.askPassword(file.name));
    const out = [];
    for (const x of parts){
      const f = new File([x.data], x.name, {type: /\.pdf$/i.test(x.name) ? "application/pdf" : /\.zip$/i.test(x.name) ? "application/zip" : "text/plain"});
      if (/\.zip$/i.test(x.name)) (await this.expand(f)).forEach(y => out.push(y)); else out.push(f);
    }
    return out;
  },
  zipWords(e){
    const c = e && e.code;
    return c === "zip_aes" ? "it is locked with AES, which FinCom cannot open: unzip it on the computer (7-Zip or WinZip, with TRACES' password) and upload the files inside."
      : c === "zip_password" ? "the password did not open it." : c === "zip_cancelled" ? "no password was given." : c === "zip_unsupported" ? "it is packed in a way FinCom cannot open: unzip it on the computer and upload the files inside."
      : "it could not be opened as a zip.";
  },
  // ---------------- the kind of a TRACES text file ----------------
  kindOfText(t){
    if (/^\s*\d+\^FH\^/m.test(t) && /^\s*\d+\^DD\^/m.test(t)) return "conso";
    if (/Justification Report|Short Deduction|Short Payment|Interest on (Payment|Deduction) Default|Late Filing Fee/i.test(t)) return "jr";
    // tds-layout: TRACES' challan status (a table naming BSR and the amount consumed), read by the register (src/js/79)
    if (/BSR/i.test(t) && /consum|utili[sz]ed|claimed/i.test(t) && typeof TDSReg === "object" && TDSReg.parseStatus(t).length) return "chstatus";
    return "";
  },
  // ---------------- Form 16A ----------------
  f16(){ const b = S.books || {}; return Array.isArray(b.f16a) ? b.f16a : []; },
  // the deductee's PAN, the quarter and year of a certificate: from its file name, else its text
  async f16Facts(file){
    const own = typeof AS26 === "object" ? AS26.clientPan() : "", name = String(file.name || "").toUpperCase();
    let pan = (name.match(/(?:^|[^A-Z])([A-Z]{5}\d{4}[A-Z])(?![A-Z0-9])/) || [])[1] || "";
    let q = (name.match(/(?:^|[^A-Z0-9])Q([1-4])(?![0-9])/) || [])[1] || "", fy = "";
    const fm = name.match(/(20\d{2})[-_]?(\d{2})(?!\d)/); if (fm) fy = fm[1] + "-" + fm[2];
    let cert = "";
    try {
      const lines = await AS26.pdfLines(file), text = lines.join("\n");
      if (!pan){
        const i = lines.findIndex(l => /PAN of the Deductee/i.test(l));
        const scan = (i >= 0 ? lines.slice(i, i + 3) : lines).join(" ").match(/[A-Z]{5}\d{4}[A-Z]/g) || [];
        pan = scan.filter(p => p !== own).pop() || "";
      }
      if (!q){ const m = text.match(/\bQ([1-4])\b/); if (m) q = m[1]; }
      if (!fy){ const m = text.match(/Assessment Year\s*:?\s*(20\d{2})\s*-\s*(?:20)?(\d{2})/i); if (m){ const y = num(m[1]) - 1; fy = y + "-" + String(y + 1).slice(2); } }
      if (!fy){ const m = text.match(/Tax Year\s*:?\s*(20\d{2})\s*-\s*(?:20)?(\d{2})/i); if (m) fy = m[1] + "-" + m[2]; }
      const cm = text.match(/Certificate\s*No\.?\s*:?\s*([A-Z0-9]{5,10})/i); if (cm) cert = cm[1];
    } catch (e){ /* a certificate whose text cannot be read is kept by its file name alone */ }
    return {pan, q: q ? "Q" + q : "", fy, cert};
  },
  partyOfPan(pan){
    const b = S.books || {}, pans = b.pans || {};
    const hit = Object.keys(pans).find(p => String(pans[p] || "").toUpperCase() === pan);
    if (hit) return hit;
    const r = TDS.rows().concat(TDS.nrRows(), TDS.tcsRows(), TDS.salaryRows()).find(x => String(x.pan || "").toUpperCase() === pan);
    return r ? r.party : "";
  },
  async addF16(pdfs){
    const co = CO(), b = S.books, kept = [], skipped = [];
    for (const f of pdfs){
      const x = await this.f16Facts(f);
      if (!x.pan){ skipped.push(f.name); continue; }
      const id = uid("f16");
      const rec = {id, pan: x.pan, party: this.partyOfPan(x.pan), fy: x.fy, q: x.q, cert: x.cert, name: f.name, size: f.size, at: new Date().toISOString()};
      await FileStore.put(co.id, id, f); S.files[id] = f;
      if (typeof CloudDocs === "object" && CloudDocs.on()) CloudDocs.add(co.id, id, f, "f16a");
      // the same deductee, quarter and year brought in again: the newer certificate in its place
      const same = this.f16().filter(r => r.pan === rec.pan && r.q === rec.q && r.fy === rec.fy);
      b.f16a = this.f16().filter(r => same.indexOf(r) < 0).concat([rec]);
      kept.push(rec);
    }
    if (kept.length) saveBooks();
    return {kept, skipped};
  },
  async downloadF16(id){
    const r = this.f16().find(x => x.id === id); if (!r) return;
    try { const f = await FileStore.get((CO() || {}).id, id, r.docPath, r.name); if (!f) throw new Error("missing"); saveFile(r.name, f); }
    catch (e){ toast("The certificate is not on this computer" + (r.docPath ? " and could not be fetched from the firm's documents." : ". Upload it again here.")); }
  },
  // ---------------- justification report ----------------
  JR_KINDS: [
    ["shortDed", /short\s*deduction/i, "Short deduction", "Deduct and pay the difference with interest by a challan, and file a correction with the deductee's row changed (C3)."],
    ["shortPay", /short\s*payment/i, "Short payment", "Pay the difference by a challan and tag it to the return in a correction (C9, or C2 for the challan)."],
    ["intPay", /interest.*(payment\s*default|late\s*payment)|late\s*payment.*interest/i, "Interest for paying late", "Pay the interest by a challan (minor head 400) and tag it to the return in a correction."],
    ["intDed", /interest.*(deduction\s*default|late\s*deduction)|late\s*deduction.*interest/i, "Interest for deducting late", "Pay the interest by a challan (minor head 400) and tag it to the return in a correction."],
    ["lateFee", /late\s*filing\s*fee|234E|section\s*427/i, "Late filing fee", "Pay the fee by a challan and tag it to the return in a correction."],
    ["int220", /220\s*\(\s*2\s*\)/i, "Interest on the demand (220(2))", "Pay the demand with this interest; it grows each month it is unpaid."],
    ["pan", /PAN\s*error|invalid\s*PAN|PAN\s*not\s*available|PANNOTAVBL|PANINVALID/i, "PAN error", "Get the deductee's right PAN and file a correction (C5); until then 20% applies (206AA)."]
  ],
  parseJr(text){
    const t = String(text || "").replace(/\r/g, ""), lines = t.split("\n");
    const out = {kind: "jr", tan: "", fy: "", q: "", form: "", token: "", summary: {}, items: []};
    const tm = t.match(/\bTAN\b[^A-Z0-9\n]*([A-Z]{4}\d{5}[A-Z])/i) || t.match(/\b([A-Z]{4}\d{5}[A-Z])\b/); if (tm) out.tan = tm[1];
    const fm = t.match(/Financial\s*Year[^0-9\n]*(20\d{2})\s*-\s*(?:20)?(\d{2})/i); if (fm) out.fy = fm[1] + "-" + fm[2];
    const qm = t.match(/Quarter[^A-Z0-9\n]*Q?([1-4])\b/i); if (qm) out.q = "Q" + qm[1];
    const om = t.match(/Form\s*(?:Type|No\.?)?[^A-Z0-9\n]*(24Q|26Q|27Q|27EQ|13[0-9]|14[0-9])\b/i); if (om) out.form = ({138: "24Q", 140: "26Q", 144: "27Q", 143: "27EQ"})[om[1]] || om[1].toUpperCase();
    const km = t.match(/Token\s*(?:Number|No\.?)?[^0-9\n]*(\d{15})/i); if (km) out.token = km[1];
    let sec = "", inSummary = false;
    const kindOf = s => (this.JR_KINDS.find(k => k[1].test(s)) || [])[0] || "";
    lines.forEach(raw => {
      const line = raw.trim(); if (!line) return;
      const f = (/\^/.test(line) ? line.split("^") : line.split(/\t|\s{2,}/)).map(x => x.trim());
      const amts = f.filter(x => /^-?[\d,]+\.\d{2}$/.test(x)).map(x => num(x.replace(/,/g, "")));
      if (/summary\s*of\s*defaults?/i.test(line)){ inSummary = true; sec = ""; return; }
      const k = kindOf(f[0] || line), cells = f.filter(Boolean);
      if (inSummary && cells.length >= 2){
        // "label ^ amount" (or "PAN Errors ^ 2", a count)
        if (k && amts.length) out.summary[k] = r2((out.summary[k] || 0) + amts[amts.length - 1]);
        else if (k && /^\d+$/.test(cells[cells.length - 1])) out.summary[k + "N"] = num(cells[cells.length - 1]);
        else if (/total/i.test(line) && amts.length) out.summary.total = amts[amts.length - 1];
        return;
      }
      // a heading: names a kind and carries no amount
      if (k && !amts.length && cells.length <= 2){ sec = k; inSummary = false; return; }
      if (inSummary) return;
      if (!sec || !amts.length) return;
      if (/^(sr\.?\s*no|s\.?\s*no|#)/i.test(f[0]) || /^total/i.test(f[0] || "")) return;
      const pan = (f.find(x => /^(?:[A-Z]{5}\d{4}[A-Z]|PANNOTAVBL|PANINVALID|PANAPPLIED)$/.test(x)) || "");
      const di = f.findIndex(x => /^\d{2}[-\/]([A-Za-z]{3}|\d{2})[-\/]\d{4}$/.test(x));
      const section = f.map(x => (/^(19\d[A-Z0-9]*|206C\w*|9\d[A-Z]{1,3}|4[A-Z]{2,3})$/.test(x) ? x : "")).find(Boolean) || "";
      const challan = (f.find(x => /^\d{7}$/.test(x)) || "") + (f.find(x => /^\d{5}$/.test(x)) ? "/" + f.find(x => /^\d{5}$/.test(x)) : "");
      const name = f.find(x => /[A-Za-z]{3}/.test(x) && x !== pan && !/^\d/.test(x) && x !== section && !/^(Q[1-4]|F|U|P)$/.test(x)) || "";
      out.items.push({kind: sec, pan, name, section, date: di >= 0 ? (AS26.date(f[di]) || "") : "", challan: sec === "shortPay" || sec === "intPay" ? challan.replace(/^\//, "") : "", amount: r2(amts[amts.length - 1])});
    });
    // the lines read against the summary's own figures
    out.diffs = [];
    this.JR_KINDS.forEach(([k, , label]) => {
      const s = out.summary[k], read = r2(out.items.filter(x => x.kind === k).reduce((a, x) => a + x.amount, 0));
      if (s != null && k !== "pan" && Math.abs(s - read) >= 1 && out.items.some(x => x.kind === k)) out.diffs.push({kind: k, label, summary: s, read});
    });
    return out;
  },
  jrs(){ const b = S.books || {}; return Array.isArray(b.tracesJr) ? b.tracesJr : []; },
  jrFor(fy, q, form){ return this.jrs().find(x => x.fy === fy && x.q === q && x.form === (form || "26Q")) || null; },
  // ---------------- consolidated file ----------------
  parseConso(text){
    const out = {kind: "conso", tan: "", fy: "", q: "", form: "", rows: [], challans: 0, cd: []};
    String(text || "").replace(/\r/g, "").split("\n").forEach(raw => {
      const f = raw.split("^").map(x => x.trim()); if (f.length < 3) return;
      const rt = f[1];
      // next-tds-forms-2025: Forms 138, 140, 143, 144 (tax year 2026-27 on) have Protean's file format 1.1: the batch
      // header has the assessment year (field 16) before the tax year (field 17), and the challan record its BSR code,
      // serial and date in fields 15, 17 and 19, the deductees' deposited total in field 21; read by field number
      if (rt === "BH" && /^(138|140|143|144)$/.test(f[4] || "")){
        out.layout = "2025"; out.tan = /^[A-Z]{4}\d{5}[A-Z]$/.test(f[12] || "") ? f[12] : "";
        out.form = ({138: "24Q", 140: "26Q", 144: "27Q", 143: "27EQ"})[f[4]];
        if (/^20\d{4}$/.test(f[16] || "")) out.fy = f[16].slice(0, 4) + "-" + f[16].slice(4);
        if (/^Q[1-4]$/.test(f[17] || "")) out.q = f[17];
      } else if (rt === "CD" && out.layout === "2025"){
        out.challans++;
        const d = f[18] || "";
        if (/^\d{7}$/.test(f[14] || "") && /^\d{8}$/.test(d)) out.cd.push({n: f[3] || "", bsr: f[14], date: d.slice(4, 8) + d.slice(2, 4) + d.slice(0, 2), serial: String(f[16] || "").padStart(5, "0"), consumed: num(f[20])});
      } else if (rt === "BH"){
        out.tan = (f.find(x => /^[A-Z]{4}\d{5}[A-Z]$/.test(x)) || "");
        const fm = f.find(x => /^(24Q|26Q|27Q|27EQ|13[0-9]|14[0-9])$/.test(x)); if (fm) out.form = ({138: "24Q", 140: "26Q", 144: "27Q", 143: "27EQ"})[fm] || fm;
        const y = f.find(x => /^20\d{4}$/.test(x)); if (y) out.fy = y.slice(0, 4) + "-" + y.slice(4);
        const q = f.find(x => /^Q[1-4]$/.test(x)); if (q) out.q = q;
      } else if (rt === "CD"){
        out.challans++;
        // tds-layout (14-Oct-2026): the challan as TRACES holds it, and what the statement consumes of it (the deductee
        // annexure's total, the first amount after the challan's serial; the FVU layout, as FinCom writes it in src/js/16)
        const bi = f.findIndex((x, i) => i > 4 && /^\d{7}$/.test(x)), di = bi > 0 ? f.findIndex((x, i) => i > bi && /^\d{8}$/.test(x)) : -1;
        const si = di > 0 ? f.findIndex((x, i) => i > di && /^\d{1,5}$/.test(x)) : -1, ai = si > 0 ? f.findIndex((x, i) => i > si && /^-?\d+\.\d{2}$/.test(x)) : -1;
        if (bi > 0 && di > 0 && si > 0){ const d = f[di]; out.cd.push({n: f[3] || "", bsr: f[bi], date: d.slice(4, 8) + d.slice(2, 4) + d.slice(0, 2), serial: f[si].padStart(5, "0"), consumed: ai > 0 ? num(f[ai]) : 0}); }
      }
      else if (rt === "DD"){
        const pan = f.find(x => /^(?:[A-Z]{5}\d{4}[A-Z]|PANNOTAVBL|PANINVALID|PANAPPLIED)$/.test(x)) || "";
        const pi = f.indexOf(pan);
        const name = f.slice(pi + 1).find(x => /[A-Za-z]{2}/.test(x) && !/^(?:[A-Z]{5}\d{4}[A-Z]|PAN\w+)$/.test(x) && !/^[A-Z]?\d/.test(x)) || "";
        const amounts = f.filter(x => /^-?\d+\.\d{2}$/.test(x)).map(x => num(x)).filter(x => x > 0);
        const date = f.find(x => /^\d{8}$/.test(x)) || "";
        // Protean's file format 1.1: field 4 the deductee's number, field 5 its challan's
        const nw = out.layout === "2025";
        out.rows.push({challan: (nw ? f[4] : f[3]) || "", n: (nw ? f[3] : f[4]) || "", pan, name, amounts, date: date ? date.slice(4, 8) + date.slice(2, 4) + date.slice(0, 2) : ""});
      }
    });
    return out;
  },
  consos(){ const b = S.books || {}; return Array.isArray(b.tracesConso) ? b.tracesConso : []; },
  // TRACES' deductee lines against FinCom's return: the same PAN, the name, the TDS
  consoCheck(c){
    const rows = TDS.formRows(c.form || "26Q").filter(r => r.fy === c.fy && r.q === c.q), out = [], seen = new Set();
    const nm = s => normName(s).replace(/ /g, "").replace(/(pvtltd|privatelimited|limited|ltd|pvt|llp|ms)/g, "");
    c.rows.forEach(d => {
      const mine = rows.filter(r => String(r.pan || "").toUpperCase() === d.pan && d.pan.length === 10 && !/^PAN/.test(d.pan));
      const tdsHit = mine.find(r => !seen.has(r.id) && d.amounts.some(a => Math.abs(a - r.tds) < 1));
      if (tdsHit) seen.add(tdsHit.id);
      const words = [];
      if (/^PAN/.test(d.pan)) words.push(d.pan === "PANNOTAVBL" ? "no PAN in TRACES' statement" : d.pan === "PANINVALID" ? "PAN marked invalid by TRACES" : "PAN applied for");
      else if (!mine.length){
        const byName = rows.find(r => nameSim(r.party, d.name) >= 0.9);
        words.push(byName ? "FinCom has " + byName.party + " under PAN " + (byName.pan || "none") : "this PAN is not in FinCom's return");
      } else {
        if (mine.every(r => nm(r.party) !== nm(d.name)) && nameSim(mine[0].party, d.name) < 0.9) words.push("name in Tally: " + mine[0].party);
        if (!tdsHit) words.push("TDS differs: FinCom has " + mine.map(r => "₹" + INR.format(r.tds)).join(", "));
      }
      out.push(Object.assign({}, d, {party: (tdsHit || mine[0] || {}).party || "", ok: !words.length, words}));
    });
    const extra = rows.filter(r => !seen.has(r.id) && !c.rows.some(d => d.pan === String(r.pan || "").toUpperCase()));
    return {rows: out, extra};
  },
  // ---------------- an upload: what each file is ----------------
  async add(fileList){
    const files = Array.from(fileList || []), said = [];
    let all = [];
    for (const f of files){
      try { (await this.expand(f)).forEach(x => all.push(x)); }
      catch (e){ said.push(f.name + ": " + this.zipWords(e)); }
    }
    const pdfs = all.filter(f => /\.pdf$/i.test(f.name)), texts = all.filter(f => /\.(txt|csv|tds)$/i.test(f.name) || f.type === "text/plain");
    const b = S.books;
    for (const f of texts){
      const t = await f.text(), k = this.kindOfText(t);
      if (k === "jr"){
        const r = this.parseJr(t); r.file = f.name; r.at = new Date().toISOString(); r.id = uid("jr");
        if (!r.form) r.form = "26Q";
        b.tracesJr = this.jrs().filter(x => !(x.fy === r.fy && x.q === r.q && x.form === r.form)).concat([r]);
        said.push("Justification report, " + TDS.formShort(r.form, r.fy) + " " + r.q + " " + r.fy + ": " + r.items.length + " default" + (r.items.length === 1 ? "" : "s") + " read.");
      } else if (k === "conso"){
        const r = this.parseConso(t); r.file = f.name; r.at = new Date().toISOString(); r.id = uid("cs");
        b.tracesConso = this.consos().filter(x => !(x.fy === r.fy && x.q === r.q && x.form === r.form)).concat([r]);
        const cdiff = typeof TDSReg === "object" ? TDSReg.traces({form: r.form || "26Q", fy: r.fy, q: r.q}).filter(x => x.src === "conso" && Math.abs(x.diff) >= 0.01).length : 0;
        said.push("Consolidated file, " + TDS.formShort(r.form || "26Q", r.fy) + " " + r.q + " " + r.fy + ": " + r.rows.length + " deductee line" + (r.rows.length === 1 ? "" : "s") + " read." +
          (cdiff ? " " + cdiff + " challan" + (cdiff === 1 ? "" : "s") + ": TRACES' consumed amount differs from FinCom's used." : ""));
      } else if (k === "chstatus"){
        const rows = TDSReg.parseStatus(t);
        b.tracesChStatus = [{id: uid("cs"), file: f.name, at: new Date().toISOString(), rows}];
        const diff = TDSReg.traces().filter(x => x.src === "status" && Math.abs(x.diff) >= 0.01).length;
        said.push("Challan status file: " + rows.length + " challan" + (rows.length === 1 ? "" : "s") + " read" + (diff ? "; " + diff + " differ from what FinCom uses of them (see the challan register)." : ", each as FinCom uses it."));
      } else if (texts.length && !pdfs.length && /\.txt$/i.test(f.name)) said.push(f.name + ": this text file is not a justification report or a consolidated file. A Form 16A zip holding only a text file is for TRACES-PDF-CONVERTER: convert it there, then upload the PDFs (or their zip) here.");
    }
    if (pdfs.length){
      const r = await this.addF16(pdfs);
      if (r.kept.length) said.push("Form 16A: " + r.kept.length + " certificate" + (r.kept.length === 1 ? "" : "s") + " kept with " + new Set(r.kept.map(x => x.pan)).size + " deductee" + (new Set(r.kept.map(x => x.pan)).size === 1 ? "" : "s") + ".");
      if (r.skipped.length) said.push("Not kept (no deductee's PAN in the file name or the certificate): " + r.skipped.join(", ") + ".");
    }
    saveBooks(); render();
    return said;
  },
  remove(key, id){
    const b = S.books, list = Array.isArray(b[key]) ? b[key] : [], x = list.find(r => r.id === id);
    if (!x) return Promise.resolve(false);
    return askConfirm({title: "Take this out?", body: esc(x.file || x.name || "") + " leaves FinCom. Upload it again to bring it back.", ok: "Take it out"}).then(ok => {
      if (!ok || !ok.ok) return false;
      b[key] = list.filter(r => r.id !== id);
      if (key === "f16a") try { FileStore.drop((CO() || {}).id, id); if (x.docPath && typeof CloudDocs === "object") CloudDocs.remove(x.docPath); } catch (e){}
      saveBooks(); render(); return true;
    });
  }
};
if (typeof globalThis === "object") Object.assign(globalThis, {TRF});
/* @react-lazy: end */
