/* ================================================================== */
/* Returns filed: the portal's own PDFs of every GST return, kept per */
/* client, GSTIN and period, with a checklist of what should be there */
/* ================================================================== */
// The record (form, period, ARN, date, file name, where the file is) is kept with the books; the PDF itself is kept in this
// browser's file store and sent to the firm's cloud documents, so it opens from any computer.
const GSTV = {
  FORMS: {
    r1:     {l: "GSTR-1",  order: 1},
    iff:    {l: "IFF",     order: 2},
    r1a:    {l: "GSTR-1A", order: 3},
    r3b:    {l: "GSTR-3B", order: 4},
    pmt06:  {l: "PMT-06 challan", order: 5},
    cmp08:  {l: "CMP-08",  order: 6},
    gstr4:  {l: "GSTR-4",  order: 7, annual: true},
    gstr9:  {l: "GSTR-9",  order: 8, annual: true},
    gstr9c: {l: "GSTR-9C", order: 9, annual: true}
  },
  MON: {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
        january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12},
  label(form){ return (this.FORMS[form] || {}).l || form || "?"; },
  isAnnual(form){ return !!(this.FORMS[form] || {}).annual; },
  list(){ const b = S.books || {}; return b.gstVault = b.gstVault || []; },
  // the period's name: a month, a QRMP quarter (by its last month), or a financial year
  perLabel(form, per, reg){
    if (!per) return "?";
    if (this.isAnnual(form) || /^\d{4}-\d{2}$/.test(per)) return per;
    const q = typeof GSTSet === "object" && reg && GSTSet.typeOf(per, reg) !== "monthly" && GSTSet.isQEnd(per) && (form === "r1" || form === "r3b" || form === "cmp08" || form === "r1a");
    return q ? GSTSet.qLabel(per) : GSTR.label(per);
  },
  fyOfPer(per){ return /^\d{4}-\d{2}$/.test(per) ? per : GSTF.fyOf(per); },
  ymIn(fy, m){ const y = +fy.slice(0, 4); return (m >= 4 ? y : y + 1) + String(m).padStart(2, "0"); },
  // ---- reading a portal PDF: the form, the GSTIN, the period, the ARN and its date ----
  // text: the words of the first pages; name: the file name; gstins: the client's registrations
  detect(text, name, gstins){
    const t = String(text || "").replace(/\s+/g, " "), n = String(name || ""), both = t + " " + n.replace(/[_.]/g, " ");
    const out = {form: "", per: "", gstin: "", arn: "", arnDate: "", sure: false, why: []};
    // the form: from the heading ("Form GSTR-3B"), else the first form named, else the file name
    const FORM_RE = [["gstr9c", /GSTR\s*-?\s*9\s*C\b/i], ["gstr9", /GSTR\s*-?\s*9(?![0-9AC])/i], ["gstr4", /GSTR\s*-?\s*4(?![0-9A])/i], ["cmp08", /CMP\s*-?\s*0?8\b/i],
      ["r1a", /GSTR\s*-?\s*1\s*A\b/i], ["iff", /Invoice\s+Furnishing\s+Facility|\bIFF\b/i], ["r3b", /GSTR\s*-?\s*3\s*B\b/i], ["pmt06", /\bPMT\s*-?\s*0?6\b|\bCPIN\b/i], ["r1", /GSTR\s*-?\s*1(?![0-9A-Z])/i]];
    const head = t.match(/\bForm\s+(?:GST\s+)?((?:GSTR|CMP|PMT)\s*-?\s*[0-9]+\s*[A-C]?)/i);
    if (head){ const h = head[1]; const hit = FORM_RE.find(([, re]) => re.test(h)); if (hit){ out.form = hit[0]; out.why.push("heading " + h.replace(/\s+/g, "")); } }
    if (!out.form){ let best = null; FORM_RE.forEach(([k, re]) => { const m = re.exec(t); if (m && (!best || m.index < best.i)) best = {k, i: m.index}; }); if (best){ out.form = best.k; out.why.push("named in the text"); } }
    if (!out.form){ const hit = FORM_RE.find(([, re]) => re.test(n.replace(/[_.]/g, " "))); if (hit){ out.form = hit[0]; out.why.push("file name"); } }
    // the GSTIN: one of the client's first
    const all = (both.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/g) || []);
    out.gstin = all.find(g => (gstins || []).includes(g)) || all[0] || "";
    // ARN and its date
    const arn = t.match(/\bAA\d{6}[0-9A-Z]{6,9}\b/); if (arn) out.arn = arn[0];
    const DL = "(?:Date\\s+of\\s+(?:ARN|filing|deposit)|ARN\\s+date|Filing\\s+date)\\s*:?\\s*";
    const dd = t.match(new RegExp(DL + "(\\d{1,2})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{4})", "i")) || t.match(new RegExp(DL + "(\\d{1,2})[\\s\\-]([A-Za-z]{3,9})[\\s\\-,]+(\\d{4})", "i"));
    if (dd){ const mo = /^\d+$/.test(dd[2]) ? +dd[2] : this.MON[dd[2].toLowerCase()]; if (mo) out.arnDate = dd[3] + "-" + String(mo).padStart(2, "0") + "-" + String(+dd[1]).padStart(2, "0"); }
    // the financial year
    const fyM = t.match(/(?:Financial\s+)?Year\s*:?\s*(20\d{2})\s*-\s*(\d{2,4})/i) || t.match(/\bF\.?Y\.?\s*:?\s*(20\d{2})\s*-\s*(\d{2,4})/i);
    const fy = fyM ? fyM[1] + "-" + String(fyM[2]).slice(-2) : "";
    // the period: a range of months (a quarter), a month name, or MMYYYY
    const MN = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
    const perZone = (t.match(/(?:Tax\s+|Return\s+)?Period\s*:?\s*([^|]{0,40})/i) || [])[1] || "";
    const range = (perZone.match(new RegExp(MN + "\\s*(?:-|to|–)\\s*" + MN, "i")) || t.match(new RegExp("\\b" + MN + "\\s*(?:-|to|–)\\s*" + MN + "\\b", "i")));
    const one = perZone.match(new RegExp("\\b" + MN + "\\b(?:[\\s,\\-]+(20\\d{2}))?", "i"));
    const mmyyyy = both.match(/(?:^|[^0-9])((0[1-9]|1[0-2])(20\d{2}))(?![0-9])/);
    const monOf = s => this.MON[String(s).toLowerCase().slice(0, 3)] || this.MON[String(s).toLowerCase()];
    if (this.isAnnual(out.form)){ if (fy) out.per = fy; }
    else if (range && fy){ out.per = this.ymIn(fy, monOf(range[2])); out.why.push("quarter " + range[1] + "-" + range[2]); }
    else if (one){ const m = monOf(one[1]); if (one[2]) out.per = (m >= 1 ? one[2] + String(m).padStart(2, "0") : ""); else if (fy) out.per = this.ymIn(fy, m); }
    if (!out.per && mmyyyy && !this.isAnnual(out.form)) out.per = mmyyyy[3] + mmyyyy[2];
    if (!out.per && this.isAnnual(out.form) && mmyyyy){ const y = +mmyyyy[3], m = +mmyyyy[2]; out.per = (m >= 4 ? y : y - 1) + "-" + String((m >= 4 ? y : y - 1) + 1).slice(2); }
    out.sure = !!(out.form && out.per && out.gstin);
    return out;
  },
  // ---- what should be on file for a GSTIN in a financial year, by its filing type ----
  expected(fy, reg){
    const y = +fy.slice(0, 4), rows = [], types = new Set();
    for (let m = 4; m <= 15; m++){
      const ym = (m <= 12 ? y : y + 1) + String(m <= 12 ? m : m - 12).padStart(2, "0"), t = GSTSet.typeOf(ym, reg); types.add(t);
      if (t === "monthly"){ rows.push({form: "r1", per: ym, due: GSTF.due(ym, "r1", reg)}); rows.push({form: "r3b", per: ym, due: GSTF.due(ym, "r3b", reg)}); }
      else if (t === "qrmp"){
        if (GSTSet.isQEnd(ym)){ rows.push({form: "r1", per: ym, due: GSTF.due(ym, "r1", reg)}); rows.push({form: "r3b", per: ym, due: GSTF.due(ym, "r3b", reg)}); }
        else { rows.push({form: "iff", per: ym, due: GSTF.due(ym, "iff", reg), optional: true}); rows.push({form: "pmt06", per: ym, due: GSTF.due(ym, "pmt06", reg), optional: true}); }
      } else if (t === "comp" && GSTSet.isQEnd(ym)) rows.push({form: "cmp08", per: ym, due: GSTF.due(ym, "cmp08", reg)});
    }
    const nfy = (y + 1) + "-" + String(y + 2).slice(2), big = GSTF.aato(nfy).v > 50000000;
    if (types.has("comp")) rows.push({form: "gstr4", per: fy, due: (y + 1) + "-06-30"});
    if (types.has("monthly") || types.has("qrmp")){ rows.push({form: "gstr9", per: fy, due: (y + 1) + "-12-31"}); rows.push({form: "gstr9c", per: fy, due: (y + 1) + "-12-31", optional: !big, note: big ? "" : "if turnover is above ₹5 crore"}); }
    return rows;
  },
  // copies on file for a form and period, newest first
  copies(reg, form, per){ return this.list().filter(x => x.reg === reg && x.form === form && x.per === per).sort((a, c) => String(c.at).localeCompare(String(a.at))); },
  // the filing date typed on the GST screens, for the returns that have one
  filedKey(form){ return ({r1: "r1", r3b: "r3b", iff: "iff", cmp08: "cmp08"})[form] || ""; },
  filedOn(reg, form, per){ const k = this.filedKey(form); return k && /^\d{6}$/.test(per) ? (GSTF.peek(per, reg)[k] || "") : ""; },
  years(reg){
    const s = new Set(GSTR.months().map(m => GSTF.fyOf(m)));
    this.list().filter(x => !reg || x.reg === reg).forEach(x => { if (x.per) s.add(this.fyOfPer(x.per)); });
    s.add(GSTF.fyOf(GSTF.today().slice(0, 7).replace("-", "")));
    return Array.from(s).sort().reverse();
  },
  // a record is added once its file is safely stored; the filing date on the GST screens is filled from the ARN date if empty
  addRecord(r){
    const rec = Object.assign({id: "gv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), at: new Date().toISOString(), by: (typeof Cloud === "object" && Cloud.st && Cloud.st.email) || ""}, r);
    this.list().push(rec);
    const k = this.filedKey(rec.form);
    if (k && rec.arnDate && /^\d{6}$/.test(rec.per) && rec.reg){ const f = GSTF.rec(rec.per, rec.reg); if (!f[k]) f[k] = rec.arnDate; }
    return rec;
  },
  status(row, reg){
    const have = this.copies(reg, row.form, row.per)[0], today = GSTF.today();
    if (have) return {s: "have", rec: have};
    if (row.due && row.due > today) return {s: "notdue"};
    return {s: row.optional ? "optional" : "missing"};
  },
  // several files in one zip, stored as they are (a PDF is already compressed)
  zip(files){
    const enc = new TextEncoder(), parts = [], cds = []; let off = 0;
    const now = new Date(), dT = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2), dD = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    files.forEach(f => {
      const nb = enc.encode(f.name), data = f.data, crc = crc32(data), lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, dT, true); lh.setUint16(12, dD, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, nb, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true); cd.setUint16(12, dT, true); cd.setUint16(14, dD, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nb.length, true);
      [30, 32, 34, 36].forEach(o => cd.setUint16(o, 0, true)); cd.setUint32(38, 0, true); cd.setUint32(42, off, true);
      cds.push(cd.buffer, nb); off += 30 + nb.length + data.length;
    });
    const cdSize = cds.reduce((a, x) => a + (x.byteLength !== undefined ? x.byteLength : x.length), 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(cds, [end.buffer]), {type: "application/zip"});
  },
  // the name a copy is saved under: client, GSTIN, return and period
  fileName(rec){
    const co = String((CO() || {}).name || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const g = ((GSTR.gstins(S.books)) || []).find(z => z.slice(0, 2) === rec.reg) || rec.reg;
    const per = /^\d{6}$/.test(rec.per) ? rec.per.slice(0, 4) + "-" + rec.per.slice(4, 6) : rec.per;
    return co + "_" + g + "_" + this.label(rec.form).replace(/\s+/g, "-") + "_" + per + ".pdf";
  }
};
// ---- reading the words of a PDF's first pages ----
async function gstvPdfText(file){
  const pdf = await getPdf(file); let text = "";
  for (let i = 1; i <= Math.min(2, pdf.numPages); i++){ try { text += pageTextLines(await (await pdf.getPage(i)).getTextContent()) + "\n"; } catch (e){} }
  return text;
}
// ---- taking in PDFs: bound to a checklist row when picked from one ----
async function gstvTake(files, bound){
  const b = S.books, co = CO(), gstins = (GSTR.gstins(b) || []).map(g => g.toUpperCase());
  let added = 0, sorted = 0; const refused = [], dupes = [];
  for (const file of Array.from(files || [])){
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf"){ refused.push(file.name + " (not a PDF)"); continue; }
    let d; try { d = GSTV.detect(await gstvPdfText(file), file.name, gstins); } catch (e){ d = GSTV.detect("", file.name, gstins); d.why.push("could not read the PDF"); }
    // a GSTIN of another PAN is refused; with no PAN on the client, only the GSTINs in its books are taken
    if (d.gstin && (notThisClient([d.gstin]).length || (!clientPan() && gstins.length && !gstins.includes(d.gstin)))){ refused.push(file.name + " (GSTIN " + d.gstin + " is not this client’s)"); continue; }
    let reg = d.gstin ? d.gstin.slice(0, 2) : (bound ? bound.reg : (S.gstReg || ""));
    let form = d.form, per = d.per, sure = d.sure, note = "";
    if (bound && !(d.sure)){ form = form || bound.form; per = per || bound.per; reg = reg || bound.reg; sure = !!(form && per && reg); }
    if (bound && d.sure && (d.form !== bound.form || d.per !== bound.per)) note = "added from the " + GSTV.label(bound.form) + " " + GSTV.perLabel(bound.form, bound.per, bound.reg) + " line, but the PDF reads as " + GSTV.label(d.form) + " " + GSTV.perLabel(d.form, d.per, reg);
    if (GSTV.list().some(x => x.reg === reg && x.form === form && x.per === per && x.size === file.size && x.name === file.name)){ dupes.push(file.name); continue; }
    const rec = GSTV.addRecord({reg, form: sure ? form : (form || ""), per: sure ? per : (per || ""), arn: d.arn, arnDate: d.arnDate, name: file.name, size: file.size, sort: !sure, note, why: d.why.join("; ")});
    await FileStore.put(co.id, rec.id, file); S.files[rec.id] = file;
    if (typeof CloudDocs === "object" && CloudDocs.on()) CloudDocs.add(co.id, rec.id, file, "gstret");
    if (sure) added++; else sorted++;
  }
  GSTR._carry = null; saveBooks(); render();
  toast([added ? added + " return" + (added === 1 ? "" : "s") + " filed away" : "", sorted ? sorted + " to sort" : "", dupes.length ? dupes.length + " already here" : "", refused.length ? "not taken: " + refused.join(", ") : ""].filter(Boolean).join(" · ") || "Nothing added.");
}
async function gstvFile(rec){ return FileStore.get((CO() || {}).id, rec.id, rec.docPath, rec.name); }
function viewGstReturnsFiled(b){
  const reg = S.gstReg || "", years = GSTV.years(reg), fy = years.includes(S.gstvFy) ? S.gstvFy : (GSTF.fyOf(S.gstYm || GSTR.months().slice(-1)[0] || "") || years[0]);
  S.gstvFy = fy;
  const g = ((GSTR.gstins(b)) || []).find(z => z.slice(0, 2) === reg) || reg, rows = GSTV.expected(fy, reg), d = s => s ? GSTAmend.dmy(String(s).replace(/-/g, "")) : "";
  const exp = new Set(rows.map(r => r.form + "|" + r.per));
  const extra = GSTV.list().filter(x => x.reg === reg && !x.sort && x.form && GSTV.fyOfPer(x.per) === fy && !exp.has(x.form + "|" + x.per));
  const seenX = new Set(); extra.forEach(x => { if (!seenX.has(x.form + "|" + x.per)){ seenX.add(x.form + "|" + x.per); rows.push({form: x.form, per: x.per, extra: true}); } });
  rows.sort((a, c) => GSTV.isAnnual(a.form) - GSTV.isAnnual(c.form) || String(a.per).localeCompare(String(c.per)) || GSTV.FORMS[a.form].order - GSTV.FORMS[c.form].order);
  const st = rows.map(r => Object.assign({}, r, GSTV.status(r, reg))), have = st.filter(x => x.s === "have").length, miss = st.filter(x => x.s === "missing").length, toSort = GSTV.list().filter(x => x.sort);
  let h = '<section class="dash-card"><div class="gf-ctl" style="flex-wrap:wrap;gap:8px"><h3 style="margin:0">Returns filed · ' + esc(g) + "</h3>" +
    '<select data-gstvfy style="width:auto">' + years.map(y => '<option value="' + y + '"' + (y === fy ? " selected" : "") + ">" + y + "</option>").join("") + "</select>" +
    '<label class="btn small primary" style="cursor:pointer">Add PDFs from the portal<input type="file" accept="application/pdf,.pdf" multiple data-gstvpick hidden></label>' +
    (have ? '<button class="btn small" data-gstv="zip">Download the year (' + have + " PDF" + (have === 1 ? "" : "s") + ", zip)</button>" : "") + "</div>" +
    '<div class="gf-chips"><span class="gf-chip">On file <b>' + have + "</b></span>" + (miss ? '<span class="gf-chip warn">PDF missing <b>' + miss + "</b></span>" : "") + (toSort.length ? '<a class="gf-chip warn" href="#gstvsort">To sort <b>' + toSort.length + "</b></a>" : "") + "</div>" +
    '<div class="gstv-drop" data-gstvdrop>Drop the PDFs downloaded from the GST portal here — GSTR-1, GSTR-3B, IFF, GSTR-1A, CMP-08, GSTR-4, GSTR-9, 9C, PMT-06 challans. Each is read for its return, GSTIN, period and ARN and filed in its place.</div>' +
    '<div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th>Period</th><th>Return</th><th>Due</th><th>Filed on</th><th>ARN</th><th>Portal PDF</th></tr></thead><tbody>' +
    st.map(r => {
      const c = GSTV.copies(reg, r.form, r.per), rec = c[0], filed = (rec && rec.arnDate) || GSTV.filedOn(reg, r.form, r.per);
      const pick = '<label class="linkbtn" style="cursor:pointer">add<input type="file" accept="application/pdf,.pdf" data-gstvpick data-gform="' + r.form + '" data-gper="' + esc(r.per) + '" hidden></label>';
      const pdf = rec ? '<button class="linkbtn" data-gstvopen="' + rec.id + '">open</button> · <button class="linkbtn" data-gstvdl="' + rec.id + '">download</button>' + (c.length > 1 ? ' <span class="nr">' + c.length + " copies</span>" : "") + (rec.note ? '<div class="bad">' + esc(rec.note) + "</div>" : "")
        : r.s === "missing" ? '<span class="bad">missing</span> · ' + pick : r.s === "notdue" ? '<span class="nr">not due yet</span> · ' + pick : '<span class="nr">' + esc(r.note || "optional") + "</span> · " + pick;
      return "<tr><td>" + esc(GSTV.perLabel(r.form, r.per, reg)) + "</td><td>" + esc(GSTV.label(r.form)) + (r.optional && !rec ? ' <span class="nr">optional</span>' : "") + "</td><td>" + esc(d(r.due)) + "</td><td>" + esc(d(filed)) + "</td><td>" + esc((rec && rec.arn) || "") + "</td><td>" + pdf + "</td></tr>";
    }).join("") + "</tbody></table></div>";
  h += '<p class="note">Kept in this browser and, when the firm account is on, in its cloud documents, so any computer of the firm can open them. The checklist follows the filing type in GST settings. Filing dates typed on the GST screens and ARN dates read from the PDFs fill each other in. When the GST API is connected, filing status and ARN will be fetched; the portal’s PDF itself is still downloaded from the portal and added here.</p></section>';
  if (toSort.length){
    const forms = Object.entries(GSTV.FORMS), gl = (GSTR.gstins(b) || []);
    h += '<section class="dash-card" id="gstvsort" style="margin-top:12px"><h3>To sort</h3><p class="note">These could not be read for sure. Say which return and period each is, and it is filed in its place.</p><div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th>File</th><th>GSTIN</th><th>Return</th><th>Period</th><th></th></tr></thead><tbody>' +
      toSort.map(x => "<tr><td>" + esc(x.name) + (x.why ? '<div class="nr">' + esc(x.why) + "</div>" : "") + ' <button class="linkbtn" data-gstvopen="' + x.id + '">open</button></td>' +
        '<td><select data-gstvs="reg" data-gid="' + x.id + '" style="width:auto">' + gl.map(z => '<option value="' + z.slice(0, 2) + '"' + (x.reg === z.slice(0, 2) ? " selected" : "") + ">" + esc(z) + "</option>").join("") + "</select></td>" +
        '<td><select data-gstvs="form" data-gid="' + x.id + '" style="width:auto"><option value="">—</option>' + forms.map(([k, f]) => '<option value="' + k + '"' + (x.form === k ? " selected" : "") + ">" + f.l + "</option>").join("") + "</select></td>" +
        '<td><input type="text" data-gstvs="per" data-gid="' + x.id + '" value="' + esc(x.per || "") + '" placeholder="' + (GSTV.isAnnual(x.form) ? "2025-26" : "YYYYMM, e.g. 202603") + '" style="width:150px"></td>' +
        '<td><button class="btn small" data-gstvok="' + x.id + '">File it</button> <button class="linkbtn" data-gstvdel="' + x.id + '">remove</button></td></tr>').join("") + "</tbody></table></div></section>";
  }
  // every copy on file, the older ones too, for this GSTIN and year
  const kept = GSTV.list().filter(x => x.reg === reg && !x.sort && GSTV.fyOfPer(x.per) === fy).sort((a, c) => String(a.per).localeCompare(String(c.per)) || String(c.at).localeCompare(String(a.at)));
  if (kept.length) h += '<section class="dash-card" style="margin-top:12px"><h3>Every PDF on file, ' + esc(fy) + '</h3><div class="bk-tablewrap"><table class="bk-table compact"><thead><tr><th>Return</th><th>Period</th><th>File</th><th class="dt">Added</th><th>By</th><th>Cloud</th><th></th></tr></thead><tbody>' +
    kept.map(x => "<tr><td>" + esc(GSTV.label(x.form)) + "</td><td>" + esc(GSTV.perLabel(x.form, x.per, reg)) + "</td><td>" + esc(x.name) + '<div class="nr">' + Math.max(1, Math.round((x.size || 0) / 1024)) + " KB</div></td><td>" + esc(d(String(x.at).slice(0, 10))) + "</td><td>" + esc(x.by || "") + "</td><td>" + (x.docPath ? "✓" : '<span class="nr">this computer</span>') +
      '</td><td><button class="linkbtn" data-gstvopen="' + x.id + '">open</button> · <button class="linkbtn" data-gstvdl="' + x.id + '">download</button> · <button class="linkbtn" data-gstvdel="' + x.id + '">remove</button></td></tr>').join("") + "</tbody></table></div></section>";
  return h;
}
if (typeof document !== "undefined"){
  document.addEventListener("change", e => {
    const t = e.target; if (!t.dataset || !S.books) return;
    if (t.dataset.gstvpick !== undefined && t.files && t.files.length){ const bound = t.dataset.gform ? {form: t.dataset.gform, per: t.dataset.gper, reg: S.gstReg || ""} : null; gstvTake(t.files, bound); t.value = ""; return; }
    if (t.dataset.gstvfy !== undefined){ S.gstvFy = t.value; render(); return; }
    if (t.dataset.gstvs !== undefined){ const x = GSTV.list().find(z => z.id === t.dataset.gid); if (x){ x[t.dataset.gstvs] = t.value.trim(); saveBooks(); if (t.dataset.gstvs !== "per") render(); } }
  });
  document.addEventListener("dragover", e => { if (e.target.closest && e.target.closest("[data-gstvdrop]")){ e.preventDefault(); e.target.closest("[data-gstvdrop]").classList.add("on"); } });
  document.addEventListener("dragleave", e => { const z = e.target.closest && e.target.closest("[data-gstvdrop]"); if (z) z.classList.remove("on"); });
  document.addEventListener("drop", e => { const z = e.target.closest && e.target.closest("[data-gstvdrop]"); if (!z || !S.books) return; e.preventDefault(); z.classList.remove("on"); gstvTake(e.dataTransfer.files, null); });
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-gstvopen],[data-gstvdl],[data-gstvdel],[data-gstvok],[data-gstv]"); if (!t || !S.books) return;
    const find = id => GSTV.list().find(x => x.id === id);
    if (t.dataset.gstvopen){ const x = find(t.dataset.gstvopen), f = x && await gstvFile(x); if (!f){ toast("This PDF is not on this computer and could not be fetched from the firm’s cloud documents."); return; } window.open(URL.createObjectURL(f), "_blank"); return; }
    if (t.dataset.gstvdl){ const x = find(t.dataset.gstvdl), f = x && await gstvFile(x); if (!f){ toast("This PDF could not be found."); return; } saveFile(GSTV.fileName(x), f); return; }
    if (t.dataset.gstvok){ const x = find(t.dataset.gstvok); if (!x) return;
      const ok = x.form && (GSTV.isAnnual(x.form) ? /^\d{4}-\d{2}$/.test(x.per) : /^\d{4}(0[1-9]|1[0-2])$/.test(x.per));
      if (!ok){ toast(GSTV.isAnnual(x.form) ? "Give the year as 2025-26." : "Give the return and the period as YYYYMM, e.g. 202603 (for a quarter, its last month)."); return; }
      x.sort = false; const k = GSTV.filedKey(x.form); if (k && x.arnDate){ const r = GSTF.rec(x.per, x.reg); if (!r[k]) r[k] = x.arnDate; }
      saveBooks(); render(); return; }
    if (t.dataset.gstvdel){ const x = find(t.dataset.gstvdel); if (!x) return;
      const ans = await askConfirm({title: "Remove this PDF?", body: esc(GSTV.label(x.form) + " " + GSTV.perLabel(x.form, x.per, x.reg) + " — " + x.name) + " is removed from TDS Desk and the firm’s cloud documents. The return on the portal is not touched.", ok: "Remove", danger: true});
      if (!ans) return;
      const co = CO(); await FileStore.drop(co.id, x.id); if (x.docPath && typeof CloudDocs === "object") CloudDocs.remove(x.docPath);
      S.books.gstVault = GSTV.list().filter(z => z !== x); saveBooks(); render(); return; }
    if (t.dataset.gstv === "zip"){
      const reg = S.gstReg || "", fy = S.gstvFy, recs = GSTV.list().filter(x => x.reg === reg && !x.sort && GSTV.fyOfPer(x.per) === fy), files = [], missed = [];
      const used = new Set();
      for (const x of recs){ const f = await gstvFile(x); if (!f){ missed.push(x.name); continue; } let n = GSTV.fileName(x); let i = 2; while (used.has(n)){ n = GSTV.fileName(x).replace(/\.pdf$/, "_" + i++ + ".pdf"); } used.add(n); files.push({name: n, data: new Uint8Array(await f.arrayBuffer())}); }
      if (!files.length){ toast("No PDF could be read."); return; }
      const g = ((GSTR.gstins(S.books)) || []).find(z => z.slice(0, 2) === reg) || reg;
      saveFile(String((CO() || {}).name || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") + "_" + g + "_GST-returns_" + fy + ".zip", GSTV.zip(files));
      if (missed.length) toast(missed.length + " could not be read and were left out: " + missed.join(", "));
    }
  });
}
