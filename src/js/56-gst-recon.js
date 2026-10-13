/* ================================================================== */
/* GST against the filed returns (request of 02-Oct-2026): the books  */
/* invoice by invoice against the filed GSTR-1 / IFF and 2B, the tax  */
/* type against the customer's state, GSTR-1 + IFF against 3B, days   */
/* late, credit in 2B not claimed, Optional entries, entries deleted  */
/* in Tally, and the corrections to make when the returns are final   */
/* ================================================================== */
// The screen is app/src/screens/gst/Recon.jsx ("Filed vs books"); the 3B page and Returns filed show parts of it.
const GSTX = {
  H: ["igst", "cgst", "sgst", "cess"],
  fyMonths(fy){ const y = +String(fy).slice(0, 4), out = []; for (let m = 4; m <= 15; m++) out.push((m <= 12 ? y : y + 1) + String(m <= 12 ? m : m - 12).padStart(2, "0")); return out; },
  fyNow(){ const ms = GSTR.months(); return GSTF.fyOf(S.gstYm || ms[ms.length - 1] || GSTF.today().slice(0, 7).replace("-", "")); },
  qEnds(fy){ return this.fyMonths(fy).filter(m => GSTSet.isQEnd(m)); },
  qLabel(qEnd){ return GSTSet.qLabel(qEnd); },
  // a place of supply as its state code: "07", "07-Delhi", "Delhi" or "DELHI"
  posCode(pos){ const p = String(pos || "").trim(); if (/^\d{2}\b/.test(p)) return p.slice(0, 2); return STATE_CODES[p.toUpperCase().replace(/&/g, "AND").replace(/\s+/g, " ")] || ""; },
  stateName(code){ return GSTRegs.STATES[code] || ("state " + code); },
  key(no){ return String(no == null ? "" : no).toUpperCase().replace(/[^A-Z0-9]/g, ""); },
  sumH(rows, k){ return r2(rows.reduce((a, x) => a + num(x[k]) * (x.dir || 1), 0)); },
  // the return a month is reported in: a quarterly filer's month is in its IFF, else in the quarter's GSTR-1
  retOf(ym, reg){ const t = GSTSet.typeOf(ym, reg); return t === "qrmp" ? GSTSet.qEnd(ym) : ym; },

  // ---------- 3. the tax type against the customer's state ----------
  // Inter-state (the customer's GSTIN, else the place of supply, in another state) is IGST; within the state, CGST + SGST.
  // A registered customer's state is its GSTIN's: a place of supply in Tally that says otherwise is noted, not trusted
  // (Testing AAD: 2025-26/GST/561 to a Delhi GSTIN carried "Uttar Pradesh").
  taxType(reg, months){
    const out = [];
    (months || []).forEach(ym => GSTR.outward(ym, reg).forEach(r => {
      if (r.kind === "EXP" || r.kind === "NIL" || r.eco) return;
      const own = reg || String(r.gstin || "").slice(0, 2), cust = r.gstin ? r.gstin.slice(0, 2) : this.posCode(r.pos);
      if (!cust || !own) return;
      const inter = cust !== own, i = Math.abs(num(r.igst)) > 0.5, cs = Math.abs(num(r.cgst)) + Math.abs(num(r.sgst)) > 0.5;
      const posC = this.posCode(r.pos), posOff = r.gstin && posC && posC !== cust;
      let why = "";
      if (inter && cs && !i) why = "CGST + SGST charged, but the customer is in " + this.stateName(cust) + (r.gstin ? " (GSTIN " + r.gstin + ")" : "") + ": it is an inter-state supply, IGST";
      else if (!inter && i && !cs) why = "IGST charged, but the customer is in " + this.stateName(cust) + ", the client's own state: CGST + SGST";
      else if (i && cs) why = "both IGST and CGST + SGST on one invoice";
      if (!why) return;
      out.push({id: r.id, ym, date: r.date, no: r.no, party: r.party, gstin: r.gstin, kind: r.kind, cust, pos: r.pos, posOff,
        taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, should: inter ? "IGST" : "CGST + SGST", why: why + (posOff ? " (Tally's place of supply says " + r.pos + ")" : "")});
    }));
    return out;
  },

  // ---------- filed figures: from the PDFs of the returns filed, or typed ----------
  fig(reg, form, per){
    const typed = (GSTF.peek(per, reg).fig || {})[form];
    if (typed) return Object.assign({source: "typed"}, typed);
    const rec = GSTV.copies(reg, form, per).find(x => x.fig);
    return rec ? Object.assign({source: "pdf", rec: rec.id}, rec.fig) : null;
  },
  figSet(reg, form, per, path, v){
    const r = GSTF.rec(per, reg), f = r.fig = r.fig || {}, x = f[form] = f[form] || (form === "r3b" ? {kind: "r3b"} : {kind: "r1", tl: {}});
    const [a, b2] = path.split("."); x[a] = x[a] || {}; x[a][b2] = v === "" ? 0 : num(v);
    saveBooks(); render();
  },
  // GSTR-1 + IFF against 3B 3.1(a), and 3B 3.1(d) against the reverse charge in the books, quarter by quarter
  // (the test of 02-Oct-2026: GSTR-1 + IFF = 3B 3.1(a) = Rs 1,73,63,343.44 for the year; reverse charge equal each quarter)
  cross(reg, fy){
    const q = this.fyMonths(fy).filter(m => GSTSet.typeOf(m, reg) !== "monthly" ? GSTSet.isQEnd(m) : true);
    const rows = q.map(per => {
      const qm = GSTSet.typeOf(per, reg) === "qrmp" ? this.qMonths(per) : [per];
      const parts = qm.map(m => ({m, form: GSTSet.isQEnd(m) || GSTSet.typeOf(m, reg) === "monthly" ? "r1" : "iff", f: this.fig(reg, GSTSet.isQEnd(m) || GSTSet.typeOf(m, reg) === "monthly" ? "r1" : "iff", m)}));
      const have = parts.filter(p => p.f && p.f.tl);
      const r1 = have.length ? r2(have.reduce((a, p) => a + num(p.f.tl.taxable), 0)) : null;
      const b = this.fig(reg, "r3b", per), a = b && b.a ? num(b.a.taxable) : null;
      const t = GSTSet.typeOf(per, reg) === "qrmp" ? GSTQ.threeBQ(per, reg) : GSTR.threeB(per, reg);
      const rcmBooks = {cgst: num(t.rcmOut.cgst), sgst: num(t.rcmOut.sgst), igst: num(t.rcmOut.igst)};
      const d = b && b.d ? {cgst: num(b.d.cgst), sgst: num(b.d.sgst), igst: num(b.d.igst)} : null;
      return {per, label: qm.length > 1 ? this.qLabel(per) : GSTR.label(per), parts: parts.map(p => ({m: p.m, form: p.form, taxable: p.f && p.f.tl ? num(p.f.tl.taxable) : null, source: p.f ? p.f.source : ""})),
        r1, r3b: a, diff: r1 != null && a != null ? r2(r1 - a) : null, books: r2(num(t.net.taxable)),
        rcm3b: d, rcmBooks, rcmDiff: d ? r2(Math.abs(d.cgst - rcmBooks.cgst) + Math.abs(d.sgst - rcmBooks.sgst) + Math.abs(d.igst - rcmBooks.igst)) : null,
        missing: parts.filter(p => !(p.f && p.f.tl)).map(p => GSTV.label(p.form) + " " + GSTR.label(p.m)).concat(a == null ? ["GSTR-3B " + (qm.length > 1 ? this.qLabel(per) : GSTR.label(per))] : [])};
    });
    const tot = k => rows.every(r => r[k] != null) ? r2(rows.reduce((a, r) => a + r[k], 0)) : null;
    return {rows, r1: tot("r1"), r3b: tot("r3b"), books: r2(rows.reduce((a, r) => a + r.books, 0))};
  },
  qMonths(qEnd){ const y = +qEnd.slice(0, 4), m = +qEnd.slice(4, 6); return [m - 2, m - 1, m].map(x => y + String(x).padStart(2, "0")); },

  // ---------- 9. days late, late fee and interest, return by return ----------
  late(reg, fy){
    return GSTV.expected(fy, reg).filter(r => ["r1", "iff", "r3b", "cmp08"].includes(r.form)).map(r => {
      const portal = this.portal(reg, r.form, r.per), rec = GSTV.copies(reg, r.form, r.per)[0];
      const filed = (portal && portal.dof) || (rec && rec.arnDate) || GSTV.filedOn(reg, r.form, r.per) || "";
      const arn = (portal && portal.arn) || (rec && rec.arn) || "";
      const days = filed && r.due ? Math.max(0, GSTF.days(r.due, filed)) : null;
      let fee = 0, interest = null, note = "";
      if (r.form === "iff"){ note = days ? "An IFF cannot be filed late: what it missed goes in the quarter's GSTR-1" : ""; }
      else if (filed && days){
        const lf = GSTF.lateFee(r.per, reg, r.form === "r1" ? "r1" : r.form === "cmp08" ? "cmp08" : "r3b");
        fee = lf.days ? lf.fee : Math.min(days * 50, 10000);
        if (r.form === "r3b"){ try { const t = GSTSet.typeOf(r.per, reg) === "qrmp" ? GSTQ.threeBQ(r.per, reg) : GSTR.threeB(r.per, reg); interest = GSTF.interest(r.per, reg, t).total; } catch (e){ interest = null; } }
      }
      const f3 = r.form === "r3b" ? this.fig(reg, "r3b", r.per) : null;
      return {form: r.form, per: r.per, label: GSTV.label(r.form) + " " + GSTV.perLabel(r.form, r.per, reg), due: r.due, filed, arn, days, fee, interest,
        paidFee: f3 && f3.lateFee ? r2(this.H.reduce((a, h) => a + num(f3.lateFee[h]), 0)) : null,
        paidInterest: f3 && f3.interest ? r2(this.H.reduce((a, h) => a + num(f3.interest[h]), 0)) : null,
        source: portal ? "portal" : rec ? "pdf" : filed ? "typed" : "", optional: !!r.optional, note};
    });
  },

  // ---------- 13. marked filed from the portal (ARN and date) ----------
  portal(reg, form, per){ return ((S.books || {}).portalFiled || {})[reg + "|" + form + "|" + per] || null; },
  // the portal's return status list (GSTN RETTRACK through gst-taxpro): each filed return marked, with its ARN and date
  takePortal(reg, list){
    const b = S.books; b.portalFiled = b.portalFiled || {}; let n = 0;
    (list || []).forEach(x => {
      const st = String(x.status || "").toLowerCase(); if (!/filed/.test(st) || /not\s*filed/.test(st)) return;
      const per = /^\d{6}$/.test(String(x.ret_prd || "")) ? x.ret_prd.slice(2, 6) + x.ret_prd.slice(0, 2) : ""; if (!per) return;
      const t = String(x.rtntype || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      let form = t === "GSTR3B" ? "r3b" : t === "GSTR1" ? "r1" : t === "IFF" ? "iff" : t === "CMP08" ? "cmp08" : t === "GSTR1A" ? "r1a" : t === "GSTR9" ? "gstr9" : "";
      if (!form) return;
      form = GSTV.formFor(form, per, reg);
      const m = String(x.dof || "").match(/^(\d{2})-(\d{2})-(\d{4})$/), dof = m ? m[3] + "-" + m[2] + "-" + m[1] : String(x.dof || "");
      const k = reg + "|" + form + "|" + per, had = b.portalFiled[k];
      if (!had || had.arn !== x.arn || had.dof !== dof) n++;
      b.portalFiled[k] = {arn: x.arn || "", dof, mof: x.mof || "", at: new Date().toISOString()};
      const fk = GSTV.filedKey(form); if (fk && dof) GSTF.rec(per, reg)[fk] = dof;
    });
    return n;
  },

  // ---------- 5 and 7. the filed GSTR-1 / IFF, invoice by invoice ----------
  // filed documents: imported from the portal's Excel or JSON (b.filedDocs), or the portal JSON fetched (b.filed)
  filedDocs(reg, fy){
    const b = S.books || {}, out = [], months = new Set(this.fyMonths(fy)), seen = new Set();
    Object.values(b.filedDocs || {}).filter(x => x && x.reg === reg && !x.removed && months.has(x.per)).forEach(x => {
      seen.add(x.per + "|" + x.form);
      (x.docs || []).forEach(d => out.push(Object.assign({ret: x.per, form: x.form, src: x.source}, d)));
    });
    // the GSTR-1 JSON kept from the portal (fetched or uploaded), when no Excel of the same return was brought in
    if (typeof GSTAmend === "object") (GSTAmend.filed(reg) || []).filter(f => !f.notFiled && months.has(f.ym)).forEach(f => {
      const form = GSTV.formFor("r1", f.ym, reg); if (seen.has(f.ym + "|" + form)) return; seen.add(f.ym + "|" + form);
      this.fromJson(f.json).forEach(d => out.push(Object.assign({ret: f.ym, form, src: "portal json"}, d)));
    });
    return {docs: out, periods: seen};
  },
  // a GSTR-1 JSON (portal download or API) to documents, credit notes to unregistered persons included
  fromJson(j){
    const out = [], sum = itms => { const t = {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0}; (itms || []).forEach(it => { const d = it.itm_det || it; t.taxable = r2(t.taxable + num(d.txval)); t.igst = r2(t.igst + num(d.iamt)); t.cgst = r2(t.cgst + num(d.camt)); t.sgst = r2(t.sgst + num(d.samt)); t.cess = r2(t.cess + num(d.csamt)); }); return t; };
    const ymd = s => GSTAmend.ymd(s);
    (j.b2b || []).forEach(g => (g.inv || []).forEach(x => out.push(Object.assign({kind: "B2B", gstin: String(g.ctin).toUpperCase(), no: x.inum, date: ymd(x.idt), pos: String(x.pos || "").padStart(2, "0"), val: num(x.val)}, sum(x.itms)))));
    (j.b2cl || []).forEach(g => (g.inv || []).forEach(x => out.push(Object.assign({kind: "B2CL", gstin: "", no: x.inum, date: ymd(x.idt), pos: String(g.pos || "").padStart(2, "0"), val: num(x.val)}, sum(x.itms)))));
    (j.exp || []).forEach(g => (g.inv || []).forEach(x => out.push(Object.assign({kind: "EXP", gstin: "", no: x.inum, date: ymd(x.idt), pos: "96", val: num(x.val)}, sum(x.itms)))));
    (j.cdnr || []).forEach(g => (g.nt || []).forEach(x => out.push(Object.assign({kind: x.ntty === "D" ? "DBNR" : "CDNR", gstin: String(g.ctin).toUpperCase(), no: x.nt_num, date: ymd(x.nt_dt), pos: String(x.pos || "").padStart(2, "0"), val: num(x.val)}, sum(x.itms)))));
    (j.cdnur || []).forEach(x => out.push(Object.assign({kind: x.ntty === "D" ? "DBNR" : "CDNR", gstin: "", no: x.nt_num, date: ymd(x.nt_dt), pos: String(x.pos || "").padStart(2, "0"), val: num(x.val)}, sum(x.itms))));
    return out;
  },
  // the portal's Excel of a filed GSTR-1 or IFF (or the offline tool's): a sheet per table, a header row naming the
  // columns; rows of one invoice at several rates are added up. Amounts of tax, when the sheet has none, come from the rate.
  fromExcel(wb, reg){
    const out = new Map(), H = s => String(s || "").toLowerCase().replace(/[^a-z0-9%]/g, "");
    const col = (hd, ...names) => hd.findIndex(h => names.some(n => h === n || h.startsWith(n)));
    wb.SheetNames.forEach(sn => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], {header: 1, raw: true, defval: ""});
      const hi = rows.findIndex(r => r.some(c => /invoice\s*number|note\s*(\/\s*refund\s*voucher\s*)?number|note\s*no/i.test(String(c))) && r.some(c => /taxable\s*value/i.test(String(c))));
      if (hi < 0) return;
      const hd = rows[hi].map(H), name = sn.toLowerCase();
      if (/(^|[^a-z])(b2ba|cdnra|b2cla|expa|cdnura|b2csa|at|ata|txp|hsn|docs|exemp)([^a-z]|$)/.test(name.replace(/[,\s]+/g, " "))) return;
      const c = {gstin: col(hd, "gstinuinofrecipient", "gstin", "recipientgstin", "ctin"), name: col(hd, "receivername", "recipientname", "tradelegalname"),
        no: col(hd, "invoicenumber", "notenumber", "noterefundvouchernumber", "notenumber"), date: col(hd, "invoicedate", "notedate", "noterefundvoucherdate"),
        val: col(hd, "invoicevalue", "notevalue", "noterefundvouchervalue"), pos: col(hd, "placeofsupply"), rate: col(hd, "rate"), taxable: col(hd, "taxablevalue"),
        igst: col(hd, "integratedtax", "igst"), cgst: col(hd, "centraltax", "cgst"), sgst: col(hd, "stateuttax", "statetax", "sgst"), cess: col(hd, "cessamount", "cess"),
        ntype: col(hd, "notetype", "documenttype"), urtype: col(hd, "urtype")};
      if (c.no < 0 || c.taxable < 0) return;
      const note = c.ntype >= 0 || /cdn/.test(name);
      rows.slice(hi + 1).forEach(r => {
        const no = String(r[c.no] || "").trim(); if (!no || /^total/i.test(no)) return;
        const gstin = c.gstin >= 0 ? String(r[c.gstin] || "").toUpperCase().trim() : "";
        const nt = c.ntype >= 0 ? String(r[c.ntype] || "").trim().toUpperCase() : "";
        const kind = note ? (nt.startsWith("D") ? "DBNR" : "CDNR") : /exp/.test(name) ? "EXP" : /b2cl/.test(name) ? "B2CL" : gstin ? "B2B" : "B2CL";
        const pos = this.posCode(c.pos >= 0 ? r[c.pos] : "") || (gstin ? gstin.slice(0, 2) : "");
        const d = r[c.date], date = typeof d === "number" ? XLSX.SSF.format("yyyymmdd", d) : this.dateKey(d);
        const k = kind + "|" + gstin + "|" + this.key(no), x = out.get(k) || {kind, gstin, name: c.name >= 0 ? String(r[c.name] || "") : "", no, date, pos, val: num(c.val >= 0 ? r[c.val] : 0), taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0};
        const tv = num(r[c.taxable]), rt = c.rate >= 0 ? num(r[c.rate]) : 0, inter = pos && reg ? pos !== reg : false;
        x.taxable = r2(x.taxable + tv);
        const has = ["igst", "cgst", "sgst"].some(h => c[h] >= 0 && String(r[c[h]]) !== "");
        if (has){ ["igst", "cgst", "sgst", "cess"].forEach(h => { if (c[h] >= 0) x[h] = r2(x[h] + num(r[c[h]])); }); }
        else if (rt){ if (inter || kind === "EXP") x.igst = r2(x.igst + tv * rt / 100); else { x.cgst = r2(x.cgst + tv * rt / 200); x.sgst = r2(x.sgst + tv * rt / 200); } if (c.cess >= 0) x.cess = r2(x.cess + num(r[c.cess])); }
        out.set(k, x);
      });
    });
    return Array.from(out.values());
  },
  dateKey(s){
    const t = String(s || "").trim(), M = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};
    let m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/); if (m) return m[3] + m[2].padStart(2, "0") + m[1].padStart(2, "0");
    m = t.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})$/); if (m && M[m[2].toLowerCase()]) return (m[3].length === 2 ? "20" + m[3] : m[3]) + String(M[m[2].toLowerCase()]).padStart(2, "0") + m[1].padStart(2, "0");
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return m[1] + m[2] + m[3];
    return t.replace(/\D/g, "").slice(0, 8);
  },
  // bringing in a filed GSTR-1 or IFF's details: the portal's Excel or JSON; the return period is read from the JSON (fp),
  // else the file name (MMYYYY), else the latest invoice month (a quarter's last month for a quarterly filer's GSTR-1)
  async importFiled(file, reg, perAsked){
    const name = file.name || "", isJson = /\.json$/i.test(name) || file.type === "application/json";
    let docs = [], per = perAsked || "", fpGstin = "";
    if (isJson){
      const j = JSON.parse(await file.text()); docs = this.fromJson(j); fpGstin = String(j.gstin || "").toUpperCase();
      if (!per && /^\d{6}$/.test(String(j.fp || ""))) per = j.fp.slice(2) + j.fp.slice(0, 2);
    } else {
      await ensureXlsx(); const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), {type: "array"}); docs = this.fromExcel(wb, reg);
    }
    if (fpGstin && fpGstin.slice(0, 2) !== reg) throw new Error("This return is for GSTIN " + fpGstin + ", not this registration.");
    if (!docs.length) throw new Error("No invoices or notes were found in " + name + ".");
    if (!per){ const m = name.match(/(?:^|[^0-9])(0[1-9]|1[0-2])(20\d{2})(?![0-9])/); if (m) per = m[2] + m[1]; }
    if (!per){ const last = docs.map(d => String(d.date).slice(0, 6)).filter(m => /^\d{6}$/.test(m)).sort().pop(); per = last || ""; }
    if (!/^\d{6}$/.test(per)) throw new Error("Say which return period this is (YYYYMM).");
    const form = GSTV.formFor("r1", per, reg), b = S.books; b.filedDocs = b.filedDocs || {};
    // a return brought in again replaces the one here; the earlier copy is kept, marked replaced (never deleted)
    const k = reg + "|" + form + "|" + per, prev = b.filedDocs[k];
    if (prev) b.filedDocs[k + "|was" + Date.now()] = Object.assign({}, prev, {removed: {at: new Date().toISOString(), by: whoAmI(), reason: "replaced by " + name}});
    b.filedDocs[k] = {reg, per, form, source: isJson ? "json" : "excel", name, at: new Date().toISOString(), by: whoAmI(), docs};
    return {per, form, n: docs.length};
  },
  // the books' invoices and notes that GSTR-1 reports one by one (B2B, large B2C, notes, exports)
  bookDocs(reg, fy){
    const out = [];
    this.fyMonths(fy).forEach(ym => GSTR.outward(ym, reg).forEach(r => {
      if (r.eco || r.kind === "NIL") return;
      if (r.kind === "B2C") return;                       // small B2C is reported as a summary, not invoice by invoice
      out.push({id: r.id, ym, date: r.date, no: r.no, party: r.party, gstin: r.gstin || "", kind: r.kind, taxable: r.taxable, igst: r.igst, cgst: r.cgst, sgst: r.sgst, cess: r.cess});
    }));
    return out;
  },
  // invoice by invoice: in both, in the books only, in a return only, in another period, another tax type, another value
  r1Match(reg, fy){
    const books = this.bookDocs(reg, fy), filed = this.filedDocs(reg, fy), rows = [];
    const covered = m => { const q = this.retOf(m, reg); return filed.periods.has(m + "|iff") || filed.periods.has(m + "|r1") || filed.periods.has(q + "|r1"); };
    const note = k => k === "CDNR" || k === "DBNR" ? k : "INV";
    const fIdx = new Map(); filed.docs.forEach((d, i) => { const k = note(d.kind) + "|" + this.key(d.no); (fIdx.get(k) || fIdx.set(k, []).get(k)).push(i); });
    const used = new Set();
    books.forEach(bd => {
      const cands = (fIdx.get(note(bd.kind) + "|" + this.key(bd.no)) || []).filter(i => !used.has(i));
      const i = cands.find(j => !bd.gstin || !filed.docs[j].gstin || filed.docs[j].gstin === bd.gstin);
      if (i === undefined){ rows.push({st: covered(bd.ym) ? "booksOnly" : "unchecked", b: bd, f: null}); return; }
      used.add(i); const fd = filed.docs[i], issues = [];
      const inRet = fd.form === "iff" ? [fd.ret] : GSTSet.typeOf(fd.ret, reg) === "qrmp" ? this.qMonths(fd.ret) : [fd.ret];
      if (!inRet.includes(bd.ym)) issues.push("period");
      const bi = Math.abs(num(bd.igst)) > 0.5, fi = Math.abs(num(fd.igst)) > 0.5, bc = Math.abs(num(bd.cgst)) > 0.5, fc = Math.abs(num(fd.cgst)) > 0.5;
      if (bi !== fi || bc !== fc) issues.push("taxtype");
      if (Math.abs(Math.abs(num(bd.taxable)) - Math.abs(num(fd.taxable))) > 1) issues.push("value");
      rows.push({st: issues.length ? issues[0] : "ok", issues, b: bd, f: fd});
    });
    filed.docs.forEach((fd, i) => { if (!used.has(i)) rows.push({st: "filedOnly", b: null, f: fd}); });
    const count = st => rows.filter(r => r.st === st).length;
    return {rows, periods: Array.from(filed.periods), counts: {ok: count("ok"), booksOnly: count("booksOnly"), filedOnly: count("filedOnly"), period: rows.filter(r => (r.issues || []).includes("period")).length,
      taxtype: rows.filter(r => (r.issues || []).includes("taxtype")).length, value: rows.filter(r => (r.issues || []).includes("value")).length, unchecked: count("unchecked")}};
  },
  // 7. the credit notes of the books against the returns
  creditNotes(reg, fy){ return this.r1Match(reg, fy).rows.filter(r => (r.b || r.f) && ((r.b || r.f).kind === "CDNR")); },

  // ---------- 6. 2B against the books, the whole year ----------
  claimed3b(reg, qEnd){
    const f = this.fig(reg, "r3b", qEnd); if (f && f.itc) return {heads: f.itc, source: f.source === "pdf" ? "3B PDF" : "3B typed"};
    const j = ((S.books || {}).filed3b || {}); const g = (GSTR.gstins(S.books) || []).find(x => x.slice(0, 2) === reg) || "";
    const x = j[g + "|" + qEnd]; const oth = x && x.json && ((x.json.itc_elg || {}).itc_avl || []).find(r => r.ty === "OTH");
    return oth ? {heads: {igst: num(oth.iamt), cgst: num(oth.camt), sgst: num(oth.samt), cess: num(oth.csamt)}, source: "3B from the portal"} : null;
  },
  // what 2B makes available for a return period: Part A less Part B (credit notes), where credit is available
  avail2b(reg, per){
    const g = (GSTR.gstins(S.books) || []).find(x => x.slice(0, 2) === reg) || "", k = g + "|" + per.slice(4, 6) + per.slice(0, 4);
    const t = ((S.books || {}).twoBs || {})[k]; if (!t) return null;
    const rows = (t.rows || []).filter(r => String(r.itcavl || "Y").toUpperCase() !== "N" && !r.rcm && !/a$/.test(r.sec || ""));
    const h = {}; this.H.forEach(x => { h[x] = this.sumH(rows, x); }); return h;
  },
  // 8. credit available in 2B and not claimed in 3B, by head
  unclaimed(reg, per){
    const av = this.avail2b(reg, per); if (!av) return null;
    const c = this.claimed3b(reg, per), t = GSTSet.typeOf(per, reg) === "qrmp" ? GSTQ.threeBQ(per, reg) : GSTR.threeB(per, reg);
    const claimed = c ? c.heads : {igst: num(t.other.igst), cgst: num(t.other.cgst), sgst: num(t.other.sgst), cess: num(t.other.cess)};
    const rows = this.H.map(h => ({h, avail: num(av[h]), claimed: num(claimed[h]), not: r2(num(av[h]) - num(claimed[h]))}));
    return {rows, source: c ? c.source : "FinCom's working (no filed 3B here)", total: r2(rows.reduce((a, r) => a + Math.max(0, r.not), 0))};
  },
  twoBYear(reg, fy){
    const r = GST2B.run(reg), months = new Set(this.fyMonths(fy)), dec = (((S.books || {}).itcTrack || {})[reg] || {}).dec || {};
    const claimedQ = {}; this.qEnds(fy).forEach(q => { const c = this.claimed3b(reg, q), av = this.avail2b(reg, q); claimedQ[q] = c && av ? this.H.reduce((a, h) => a + num(c.heads[h]), 0) >= this.H.reduce((a, h) => a + num(av[h]), 0) * 0.9 : null; });
    const only2b = r.only2b.filter(x => months.has(x.ym)).map(x => {
      const q = GSTSet.typeOf(x.ym, reg) === "qrmp" ? GSTSet.qEnd(x.ym) : x.ym, d = Object.entries(dec).find(([k]) => k.includes("|" + x.gstin + "|") && k.includes("|" + x.no + "|"));
      return Object.assign({}, x, {claimed: claimedQ[q], decided: d ? d[1] : null,
        say: d && d[1].act === "expense" ? "kept as an expense (decided " + fmtDate(String(d[1].at).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")) + ")"
          : claimedQ[q] ? "credit claimed in 3B but no entry in books" : claimedQ[q] === false ? "in 2B, not in the books; 3B claimed less than 2B" : "in 2B, not in the books (3B figures not here)"});
    });
    const onlyBooks = r.onlyBooks.filter(x => months.has(x.ym));
    const taxOnly = []; this.fyMonths(fy).forEach(ym => GSTR.inward(ym, reg).filter(x => x.taxOnly).forEach(x => taxOnly.push(Object.assign({ym}, x))));
    return {only2b, onlyBooks, taxOnly, loaded: r.loaded,
      tot: {only2b: {igst: this.sumH(only2b, "igst"), cgst: this.sumH(only2b, "cgst"), sgst: this.sumH(only2b, "sgst")}, onlyBooks: {igst: this.sumH(onlyBooks, "igst"), cgst: this.sumH(onlyBooks, "cgst"), sgst: this.sumH(onlyBooks, "sgst")}}};
  },

  // ---------- 11. Optional entries: in Tally, never in a return ----------
  optional(reg, fy){
    const months = new Set(this.fyMonths(fy));
    return (S.books.vouchers || []).filter(v => v.opt && !v.cancel && months.has(String(v.date).slice(0, 6))).map(v => {
      const L = Books.lines(v), tax = r2(L.tax.CGST + L.tax.SGST + L.tax.IGST + L.tax.CESS);
      if (!tax && !L.taxable) return null;
      if (reg && GSTR.regOf(v) && GSTR.regOf(v) !== reg) return null;
      return {id: v.id, date: v.date, type: v.type, no: v.no, party: v.party, taxable: L.taxable, igst: L.tax.IGST, cgst: L.tax.CGST, sgst: L.tax.SGST, sale: Books.isSale(v)};
    }).filter(Boolean).sort((a, c) => String(a.date).localeCompare(String(c.date)));
  },

  // ---------- 12. entries deleted in Tally ----------
  srv: {},          // the server's list (tally_vouchers_gone_list), per client
  async loadGone(cid){
    if (!(typeof Cloud === "object" && Cloud.on && Cloud.on())) return;
    try { this.srv[cid] = {at: Date.now(), list: await Cloud.api("rpc/tally_vouchers_gone_list", {method: "POST", body: {p_client: cid}}) || []}; }
    catch (e){ this.srv[cid] = {at: Date.now(), list: [], missing: /tally_vouchers_gone|PGRST202|schema cache|does not exist|404/i.test(String(e && e.message || e))}; }
    render();
  },
  gone(reg){
    const b = S.books || {}, out = new Map();
    Object.entries(b.gone || {}).filter(([, g]) => g && !g.back && g.v).forEach(([id, g]) => out.set(id, {id, v: g.v, at: g.at, by: g.by, from: "books"}));
    const s = this.srv[b.cid];
    ((s && s.list) || []).forEach(x => { if (out.has(x.guid)) return;
      out.set(x.guid, {id: x.guid, at: String(x.goneAt || "").slice(0, 10), from: "server", v: {id: x.guid, date: x.date, type: x.type, no: x.number, party: x.party, gstin: x.gstin, ref: x.reference, refDate: x.referenceDate, opt: x.optional,
        ent: (x.lines || []).map(l => ({l: l[0], a: num(l[1])}))}}); });
    const twoB = GST2B.run(reg), in2b = new Set([].concat(twoB.only2b, twoB.pairs.map(p => p.p)).filter(Boolean).map(x => String(x.gstin) + "|" + this.key(x.no)));
    return Array.from(out.values()).map(g => {
      const v = g.v, ym = String(v.date).slice(0, 6), L = Books.lines(v), inTax = r2(v.ent.reduce((a, e) => { const m = Books.ledgerOf(e.l); return a + ((m.kind === "gst" || m.kind === "gst_common") && m.side === "input" ? -num(e.a) : 0); }, 0));
      const gstin = String(v.gstin || (b.gstins || {})[v.party] || "").toUpperCase(), no = Books.supInv ? Books.supInv(v) : (v.ref || v.no);
      const per = this.retOf(ym, reg), filed3b = !!(this.fig(reg, "r3b", per) || GSTF.peek(per, reg).r3b || this.portal(reg, "r3b", per));
      const isIn2b = gstin && in2b.has(gstin + "|" + this.key(no));
      const purchase = inTax > 0.5 && !Books.isSale(v);
      return {id: g.id, at: g.at, from: g.from, date: v.date, type: v.type, no: v.no, supInv: no, party: v.party, gstin, taxable: L.taxable, inTax,
        sale: Books.isSale(v), reverse: purchase && (isIn2b || filed3b), in2b: !!isIn2b, filed3b,
        say: purchase && (isIn2b || filed3b) ? "credit to reverse" + (isIn2b ? " (still in 2B)" : "") + (filed3b ? " (3B of " + (GSTSet.isQEnd(per) && GSTSet.typeOf(per, reg) === "qrmp" ? this.qLabel(per) : GSTR.label(per)) + " filed)" : "") : ""};
    }).sort((a, c) => String(c.at).localeCompare(String(a.at)) || String(c.date).localeCompare(String(a.date)));
  },

  // ---------- 10. the returns are final: the differences as corrections to make in Tally ----------
  final(reg){ return !!GSTSet.peek(reg).final; },
  setFinal(reg, on){ const s = GSTSet.store(reg); s.final = !!on; s.finalAt = new Date().toISOString(); s.finalBy = whoAmI(); saveBooks(); render(); },
  corrections(reg, fy){
    const fin = this.final(reg), out = [], d = x => fmtDate(String(x).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")), m = this.r1Match(reg, fy);
    const amt = x => r2(num(x.taxable)), tax = x => r2(num(x.igst) + num(x.cgst) + num(x.sgst));
    m.rows.forEach(r => {
      const x = r.b || r.f, what = x.kind === "CDNR" ? "Credit note" : x.kind === "DBNR" ? "Debit note" : "Invoice", ret = r.f ? GSTV.label(r.f.form) + " " + GSTV.perLabel(r.f.form, r.f.ret, reg) : "";
      if (r.st === "booksOnly") out.push({area: "Sales", what, no: x.no, date: d(x.date), party: x.party || x.gstin, taxable: amt(x), tax: tax(x),
        diff: "in the books, in no return filed",
        action: fin ? "Make it Optional in Tally (it was not reported, and the returns are final)" : "Report it in the next GSTR-1 (amendment or late reporting)"});
      if (r.st === "filedOnly") out.push({area: "Sales", what, no: x.no, date: d(x.date), party: x.name || x.gstin, taxable: amt(x), tax: tax(x),
        diff: "in " + ret + ", not in the books", action: "Book this " + what.toLowerCase() + " in Tally as reported in " + ret});
      (r.issues || []).forEach(i => {
        if (i === "period") out.push({area: "Sales", what, no: x.no, date: d(r.b.date), party: x.party, taxable: amt(r.b), tax: tax(r.b), diff: "dated " + GSTR.label(r.b.ym) + " in the books, reported in " + ret,
          action: fin ? "Change its date in Tally into " + ret.replace(/^\S+\s/, "") : "Check the date; amend the return if the books are right"});
        if (i === "taxtype") out.push({area: "Sales", what, no: x.no, date: d(r.b.date), party: x.party, taxable: amt(r.b), tax: tax(r.b),
          diff: "books: " + (num(r.b.igst) ? "IGST" : "CGST + SGST") + "; " + ret + ": " + (num(r.f.igst) ? "IGST" : "CGST + SGST"),
          action: fin ? "Change the tax type in Tally to " + (num(r.f.igst) ? "IGST" : "CGST + SGST") + ", as filed" : "Correct the books or the return"});
        if (i === "value") out.push({area: "Sales", what, no: x.no, date: d(r.b.date), party: x.party, taxable: amt(r.b), tax: tax(r.b), diff: "value " + money(amt(r.b)) + " in the books, " + money(amt(r.f)) + " in " + ret,
          action: fin ? "Change the value in Tally to " + money(amt(r.f)) + ", as filed" : "Correct the books or amend the return"});
      });
    });
    if (!fin) this.taxType(reg, this.fyMonths(fy)).forEach(t => out.push({area: "Sales", what: "Invoice", no: t.no, date: d(t.date), party: t.party, taxable: amt(t), tax: tax(t), diff: t.why, action: "Change the tax type to " + t.should + " (in Tally, and in the return if not yet filed)"}));
    const tb = this.twoBYear(reg, fy);
    tb.only2b.filter(x => !(x.decided && x.decided.act === "expense")).forEach(x => out.push({area: "Purchases", what: x.dir < 0 ? "Credit note from supplier" : "Purchase bill", no: x.no, date: d(x.date), party: x.party || x.gstin, taxable: amt(x), tax: tax(x), diff: x.say,
      action: x.claimed ? "Book this bill in Tally (its credit was claimed in 3B)" : fin ? "Book this bill in Tally" : "Book this bill in Tally, or leave its credit unclaimed"}));
    tb.onlyBooks.forEach(x => out.push({area: "Purchases", what: "Purchase bill", no: x.no, date: d(x.date), party: x.party || x.gstin, taxable: amt(x), tax: tax(x), diff: "input tax in the books, not in 2B",
      action: fin ? "Move its tax to an ineligible or 'not in 2B' ledger in Tally, or follow it up with the supplier" : "Follow it up with the supplier before claiming"}));
    this.gone(reg).filter(g => g.reverse).forEach(g => out.push({area: "Deleted in Tally", what: g.type, no: g.supInv || g.no, date: d(g.date), party: g.party, taxable: amt(g), tax: g.inTax, diff: "deleted in Tally on " + fmtDate(g.at) + "; " + g.say,
      action: "Reverse the credit in the next 3B (or book the bill again if it was deleted by mistake)"}));
    return {final: fin, rows: out};
  },
  async correctionsExcel(reg, fy){
    await ensureXlsx();
    const c = this.corrections(reg, fy), co = CO() || {};
    const head = ["Area", "Document", "Number", "Date", "Party", "Taxable value", "Tax", "Difference", "Correction to make"];
    const wb = XLSX.utils.book_new(), rows = [[co.name + " · " + ((GSTR.gstins(S.books) || []).find(g => g.slice(0, 2) === reg) || reg) + " · " + fy + (c.final ? " · filed returns are final" : "")], [], head]
      .concat(c.rows.map(r => [r.area, r.what, r.no, r.date, r.party, r.taxable, r.tax, r.diff, r.action]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Book corrections");
    const opt = this.optional(reg, fy);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Date", "Type", "Number", "Party", "Taxable value", "IGST", "CGST", "SGST"]].concat(opt.map(o => [fmtDate(String(o.date).replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")), o.type, o.no, o.party, o.taxable, o.igst, o.cgst, o.sgst]))), "Optional - not in returns");
    const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(String(co.name || "client").replace(/[^A-Za-z0-9]+/g, "-") + "_GST-book-corrections_" + fy + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
};
// picking the filed GSTR-1 / IFF details (Excel or JSON) from the Filed vs books page
async function gstxImport(files){
  const reg = S.gstReg || "", done = [], bad = [];
  for (const f of Array.from(files || [])){
    try { const r = await GSTX.importFiled(f, reg, ""); done.push(GSTV.label(r.form) + " " + GSTV.perLabel(r.form, r.per, reg) + " (" + r.n + ")"); }
    catch (e){ bad.push(f.name + ": " + ((e && e.message) || e)); }
  }
  if (done.length) saveBooks();
  toast([done.length ? "Brought in: " + done.join(", ") : "", bad.length ? "Not taken: " + bad.join("; ") : ""].filter(Boolean).join(" · ") || "Nothing brought in.");
  render();
}
