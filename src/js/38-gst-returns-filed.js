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
  // every record, removed ones included (a removal is a soft delete: the record and its PDF are kept, marked removed)
  all(){ const b = S.books || {}; b.gstVault = b.gstVault || []; this.fixIff(b.gstVault); return b.gstVault; },
  // the records in use
  list(){ return this.all().filter(x => !x.removed); },
  // a quarterly (QRMP) filer's return for the first or second month of a quarter is an IFF, even when the portal's PDF
  // prints "FORM GSTR-1" (request of 02-Oct-2026: the Apr-2025 and May-2025 IFFs of Testing AAD were filed as GSTR-1)
  formFor(form, per, reg){
    return form === "r1" && /^\d{6}$/.test(per) && reg && typeof GSTSet === "object" && GSTSet.typeOf(per, reg) === "qrmp" && !GSTSet.isQEnd(per) ? "iff" : form;
  },
  fixIff(list){
    list.forEach(x => { const f = this.formFor(x.form, x.per, x.reg); if (f !== x.form){
      x.formRead = x.form; x.form = f;
      // the filing date went in as a GSTR-1's; it is the IFF's
      const r = GSTF.rec(x.per, x.reg); if (x.arnDate && r.r1 === x.arnDate){ if (!r.iff) r.iff = x.arnDate; delete r.r1; }
    } });
  },
  // ---- the figures on a filed return's PDF (request of 02-Oct-2026), for the cross-check of GSTR-1 + IFF against 3B ----
  // GSTR-1 / IFF: the Total Liability line (value, IGST, CGST, SGST, cess). GSTR-3B: 3.1(a), 3.1(d), 4A(5), 4(C), and the
  // interest and late fee of 5.1. Amounts may be printed 1,23,456.78 or (1,234.00) for a negative.
  nums(s, n){
    const out = [], re = /\(?-?\d[\d,]*\.\d{1,2}\)?|\(?-?\d{1,3}(?:,\d{2,3})+\)?|(?<![\w.])-?\d+(?![\w.])/g; let m;
    while ((m = re.exec(s)) && out.length < n){ const t = m[0]; out.push((/^\(.*\)$/.test(t) ? -1 : 1) * num(t.replace(/[(),]/g, ""))); }
    return out;
  },
  after(t, re, n){ const m = re.exec(t); return m ? this.nums(t.slice(m.index + m[0].length, m.index + m[0].length + 260), n) : null; },
  figures(text, form){
    const t = String(text || "").replace(/\s+/g, " "), five = a => a && a.length >= 4 ? {taxable: a[0], igst: a[1], cgst: a[2], sgst: a[3], cess: a[4] || 0} : null;
    if (form === "r1" || form === "iff" || form === "r1a"){
      let a = this.after(t, /Total\s+Liability\s*\(\s*Outward\s+supplies\s+other\s+than\s+Reverse\s+charge\s*\)/i, 6);
      if (a && a.length === 6 && Number.isInteger(a[0])) a = a.slice(1);
      return a && a.length >= 4 ? {kind: "r1", tl: five(a)} : null;
    }
    if (form === "r3b"){
      const a = five(this.after(t, /\(a\)\s*Outward\s+taxable\s+supplies\s*\(\s*other\s+than\s+zero\s+rated,?\s*nil\s+rated\s+and\s+exempted\s*\)/i, 5));
      const d = five(this.after(t, /\(d\)\s*Inward\s+supplies\s*\(\s*liable\s+to\s+reverse\s+charge\s*\)/i, 5));
      const four = (re) => { const x = this.after(t, re, 4); return x && x.length === 4 ? {igst: x[0], cgst: x[1], sgst: x[2], cess: x[3]} : null; };
      const itc = four(/\(5\)\s*All\s+other\s+ITC/i), net = four(/C\.?\s*Net\s+ITC\s+[Aa]vailable\s*\(\s*A\s*-\s*B\s*\)/i);
      const intr = four(/\bInterest\b(?!\s+and)/i), fee = four(/\bLate\s+fee\b/i);
      return a || d || itc ? {kind: "r3b", a, d, itc, net, interest: intr, lateFee: fee} : null;
    }
    return null;
  },
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
    this.all().push(rec);
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
async function gstvPdfText(file, pages){
  const pdf = await getPdf(file); let text = "";
  for (let i = 1; i <= Math.min(pages || 2, pdf.numPages); i++){ try { text += pageTextLines(await (await pdf.getPage(i)).getTextContent()) + "\n"; } catch (e){} }
  return text;
}
// ---- taking in PDFs: bound to a checklist row when picked from one ----
async function gstvTake(files, bound){
  const b = S.books, co = CO(), gstins = (GSTR.gstins(b) || []).map(g => g.toUpperCase());
  let added = 0, sorted = 0; const refused = [], dupes = [];
  for (const file of Array.from(files || [])){
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf"){ refused.push(file.name + " (not a PDF)"); continue; }
    let d, text = ""; try { text = await gstvPdfText(file, 8); d = GSTV.detect(text, file.name, gstins); } catch (e){ d = GSTV.detect("", file.name, gstins); d.why.push("could not read the PDF"); }
    // a GSTIN of another PAN is refused; with no PAN on the client, only the GSTINs in its books are taken
    if (d.gstin && (notThisClient([d.gstin]).length || (!clientPan() && gstins.length && !gstins.includes(d.gstin)))){ refused.push(file.name + " (GSTIN " + d.gstin + " is not this client’s)"); continue; }
    let reg = d.gstin ? d.gstin.slice(0, 2) : (bound ? bound.reg : (S.gstReg || ""));
    let form = d.form, per = d.per, sure = d.sure, note = "";
    if (bound && !(d.sure)){ form = form || bound.form; per = per || bound.per; reg = reg || bound.reg; sure = !!(form && per && reg); }
    const asRead = form; form = GSTV.formFor(form, per, reg);
    if (form !== asRead){ d.form = form; d.why.push("a quarterly filer's return for " + GSTR.label(per) + " is an IFF, though the PDF says GSTR-1"); }
    if (bound && d.sure && (d.form !== bound.form || d.per !== bound.per)) note = "added from the " + GSTV.label(bound.form) + " " + GSTV.perLabel(bound.form, bound.per, bound.reg) + " line, but the PDF reads as " + GSTV.label(d.form) + " " + GSTV.perLabel(d.form, d.per, reg);
    if (GSTV.list().some(x => x.reg === reg && x.form === form && x.per === per && x.size === file.size && x.name === file.name)){ dupes.push(file.name); continue; }
    const fig = GSTV.figures(text, form);
    const rec = GSTV.addRecord({reg, form: sure ? form : (form || ""), per: sure ? per : (per || ""), arn: d.arn, arnDate: d.arnDate, name: file.name, size: file.size, sort: !sure, note, why: d.why.join("; "), fig: fig || undefined, formRead: asRead !== form ? asRead : undefined});
    await FileStore.put(co.id, rec.id, file); S.files[rec.id] = file;
    if (typeof CloudDocs === "object" && CloudDocs.on()) CloudDocs.add(co.id, rec.id, file, "gstret");
    if (sure) added++; else sorted++;
  }
  GSTR._carry = null; saveBooks(); render();
  toast([added ? added + " return" + (added === 1 ? "" : "s") + " filed away" : "", sorted ? sorted + " to sort" : "", dupes.length ? dupes.length + " already here" : "", refused.length ? "not taken: " + refused.join(", ") : ""].filter(Boolean).join(" · ") || "Nothing added.");
}
async function gstvFile(rec){ return FileStore.get((CO() || {}).id, rec.id, rec.docPath, rec.name); }
// the Returns filed page: React (app/src/screens/gst/ReturnsFiled.jsx)
// what the Returns filed page does (app/src/screens/gst/ReturnsFiled.jsx)
const gstvFind = id => GSTV.all().find(x => x.id === id);
async function gstvOpen(id){ const x = gstvFind(id), f = x && await gstvFile(x); if (!f){ toast("This PDF is not on this computer and could not be fetched from the firm’s cloud documents."); return; } window.open(URL.createObjectURL(f), "_blank"); }
async function gstvDownload(id){ const x = gstvFind(id), f = x && await gstvFile(x); if (!f){ toast("This PDF could not be found."); return; } saveFile(GSTV.fileName(x), f); }
// a PDF that could not be read for sure: its GSTIN, return or period said by the user, then filed in its place
function gstvSetSort(id, key, val){ const x = gstvFind(id); if (x){ x[key] = String(val).trim(); saveBooks(); if (key !== "per") render(); } }
function gstvFileIt(id){
  const x = gstvFind(id); if (!x) return;
  const ok = x.form && (GSTV.isAnnual(x.form) ? /^\d{4}-\d{2}$/.test(x.per) : /^\d{4}(0[1-9]|1[0-2])$/.test(x.per));
  if (!ok){ toast(GSTV.isAnnual(x.form) ? "Give the year as 2025-26." : "Give the return and the period as YYYYMM, e.g. 202603 (for a quarter, its last month)."); return; }
  x.sort = false; const k = GSTV.filedKey(x.form); if (k && x.arnDate){ const r = GSTF.rec(x.per, x.reg); if (!r[k]) r[k] = x.arnDate; }
  saveBooks(); render();
}
// a soft delete (request of 02-Oct-2026: removals are soft deletes): the record leaves the list, marked removed with who,
// when and why; the PDF stays in this browser and the firm's cloud documents, and Restore puts it back
async function gstvRemove(id){
  const x = gstvFind(id); if (!x) return;
  const ans = await askConfirm({title: "Remove this PDF from the list?", ok: "Remove", danger: true,
    body: esc(GSTV.label(x.form) + " " + GSTV.perLabel(x.form, x.per, x.reg) + " — " + x.name) + " leaves the list. The PDF is kept and can be restored. The return on the portal is not touched." +
      '<label class="f" style="margin-top:12px"><span>Reason</span><input type="text" id="cbxWhy" autocomplete="off" aria-label="Reason"></label>',
    read: () => ((document.getElementById("cbxWhy") || {}).value || "").trim()});
  if (!ans) return;
  x.removed = {at: new Date().toISOString(), by: whoAmI(), reason: ans.data || ""};
  saveBooks(); render();
}
function gstvRestore(id){ const x = GSTV.all().find(z => z.id === id); if (!x) return; delete x.removed; saveBooks(); toast("Restored: " + GSTV.label(x.form) + " " + GSTV.perLabel(x.form, x.per, x.reg) + "."); render(); }
// every PDF of the GSTIN and year in one zip
async function gstvZip(){
  const reg = S.gstReg || "", fy = S.gstvFy, recs = GSTV.list().filter(x => x.reg === reg && !x.sort && GSTV.fyOfPer(x.per) === fy), files = [], missed = [];
  const used = new Set();
  for (const x of recs){ const f = await gstvFile(x); if (!f){ missed.push(x.name); continue; } let n = GSTV.fileName(x); let i = 2; while (used.has(n)){ n = GSTV.fileName(x).replace(/\.pdf$/, "_" + i++ + ".pdf"); } used.add(n); files.push({name: n, data: new Uint8Array(await f.arrayBuffer())}); }
  if (!files.length){ toast("No PDF could be read."); return; }
  const g = ((GSTR.gstins(S.books)) || []).find(z => z.slice(0, 2) === reg) || reg;
  saveFile(String((CO() || {}).name || "client").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") + "_" + g + "_GST-returns_" + fy + ".zip", GSTV.zip(files));
  if (missed.length) toast(missed.length + " could not be read and were left out: " + missed.join(", "));
}
