/* ================================================================== */
/* E-invoice (IRN) and e-way bill from a sales invoice, through the   */
/* firm's gst-taxpro function (TaxPro's e-invoice API)                */
/* ================================================================== */
// The invoice is put in the IRP's schema (INV-01, version 1.1) here; the function signs in with the client's e-invoice API
// user (kept in Vault), asks for the IRN and keeps what comes back (gst_einvoices). The IRN, acknowledgement and signed
// QR are also kept on the invoice (v.x.irn, ackNo, ackDt, signedQr; ewayNo), for the printed invoice and the Tally voucher.
const EINV = {
  // FinCom's units to the GST unit codes (UQC)
  UQC: {Nos: "NOS", Pcs: "PCS", Kg: "KGS", Gm: "GMS", Ltr: "LTR", Mtr: "MTR", "Sq Ft": "SQF", Box: "BOX", Set: "SET", Hrs: "OTH", Days: "OTH", Month: "OTH", Job: "OTH"},
  pin(s){ const m = String(s || "").match(/\b([1-9]\d{5})\b/); return m ? m[1] : ""; },
  // the line of an address before its PIN code, for the place (Loc)
  loc(s){
    const segs = String(s || "").split(/\n|,/).map(x => x.trim()).filter(Boolean), i = segs.findIndex(l => this.pin(l));
    const here = i >= 0 ? segs[i].replace(/\b[1-9]\d{5}\b/, "").replace(/[-–:]\s*$/, "").trim() : "";
    return (here || (i > 0 ? segs[i - 1] : segs[segs.length - 1] || "")).slice(0, 50);
  },
  addr1(s){ return String(s || "").split(/\n/)[0].replace(/\s+/g, " ").trim().slice(0, 100); },
  dmy(d){ const t = String(d || "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t.slice(8, 10) + "/" + t.slice(5, 7) + "/" + t.slice(0, 4) : ""; },
  // what stops the invoice from being e-invoiced, in words
  problems(v, co, cfg){
    const x = v.x, out = [], seller = String(co.gstin || "").toUpperCase(), buyer = String(x.customerGstin || "").toUpperCase();
    if (!GSTIN_RE.test(seller)) out.push("The client's GSTIN is not set (Client setup).");
    if (!GSTIN_RE.test(buyer)) out.push("The customer has no GSTIN: an invoice to an unregistered person is not e-invoiced.");
    if (!x.number || String(x.number).length > 16) out.push("The invoice number must be 1 to 16 characters.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ""))) out.push("The invoice date is missing.");
    if (!this.pin(cfg.address)) out.push("The client's address in Sales settings needs its PIN code.");
    if (!this.pin(x.address)) out.push("The customer's address needs its PIN code.");
    if (!(x.items || []).length) out.push("The invoice needs its items (description, HSN, quantity, rate).");
    (x.items || []).forEach((it, i) => { if (!/^\d{4,8}$/.test(String(it.hsn || "").trim())) out.push("Item " + (i + 1) + " needs an HSN or SAC code of 4 to 8 digits."); });
    return out;
  },
  // the invoice in the IRP's schema
  build(v, co, cfg){
    const x = v.x, seller = String(co.gstin || "").toUpperCase(), buyer = String(x.customerGstin || "").toUpperCase();
    const inter = !!(x.pos && seller.slice(0, 2) !== String(x.pos));
    let ass = 0, cg = 0, sg = 0, ig = 0, ces = 0, tot = 0;
    const items = (x.items || []).map((it, i) => {
      const qty = num(it.qty) || 1, gross = r2(qty * num(it.rate)), taxable = r2(num(it.taxable) || gross), rate = num(it.gstRate), disc = r2(Math.max(0, gross - taxable));
      const tax = r2(taxable * rate / 100), igst = inter ? tax : 0, cgst = inter ? 0 : r2(tax / 2), sgst = inter ? 0 : r2(tax - r2(tax / 2)), cess = r2(num(it.cess));
      const val = r2(taxable + igst + cgst + sgst + cess);
      ass = r2(ass + taxable); cg = r2(cg + cgst); sg = r2(sg + sgst); ig = r2(ig + igst); ces = r2(ces + cess); tot = r2(tot + val);
      const hsn = String(it.hsn || "").trim();
      return {SlNo: String(i + 1), PrdDesc: String(it.desc || "").slice(0, 300), IsServc: /^99/.test(hsn) ? "Y" : "N", HsnCd: hsn, Qty: qty, Unit: this.UQC[it.unit] || "OTH",
        UnitPrice: r2(num(it.rate)), TotAmt: gross || taxable, Discount: disc, AssAmt: taxable, GstRt: rate, IgstAmt: igst, CgstAmt: cgst, SgstAmt: sgst, CesAmt: cess, TotItemVal: val};
    });
    const total = r2(num(x.total) || tot), round = r2(total - tot);
    return {
      Version: "1.1",
      TranDtls: {TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N"},
      DocDtls: {Typ: x.noteKind === "credit" ? "CRN" : x.noteKind === "debit" ? "DBN" : "INV", No: String(x.number || ""), Dt: this.dmy(x.date)},
      SellerDtls: {Gstin: seller, LglNm: String(co.tallyName || co.name || "").slice(0, 100), Addr1: this.addr1(cfg.address), Loc: this.loc(cfg.address), Pin: num(this.pin(cfg.address)), Stcd: seller.slice(0, 2)},
      BuyerDtls: {Gstin: buyer, LglNm: String(x.customerName || "").slice(0, 100), Pos: String(x.pos || buyer.slice(0, 2)), Addr1: this.addr1(x.address), Loc: this.loc(x.address), Pin: num(this.pin(x.address)), Stcd: buyer.slice(0, 2)},
      ItemList: items,
      ValDtls: {AssVal: ass, CgstVal: cg, SgstVal: sg, IgstVal: ig, CesVal: ces, RndOffAmt: Math.abs(round) < 10 ? round : 0, TotInvVal: Math.abs(round) < 10 ? total : tot}
    };
  },
  accounts: {}, asked: {},
  // the client's e-invoice user, asked of the server once a session (and after a sign-in); never the password
  need(gstin){ if (!this.asked[gstin]){ this.asked[gstin] = Date.now(); this.status(gstin).then(() => render(), () => {}); } return this.accounts[gstin]; },
  async status(gstin){ this.asked[gstin] = Date.now(); const j = await GSTAPI.call({action: "einv-status", gstins: [gstin]}); this.host = j.host; this.accounts[gstin] = (j.accounts || [])[0] || null; return this.accounts[gstin]; },
  async login(gstin, username, password){ const j = await GSTAPI.call({action: "einv-login", gstin, username, password}); this.host = j.host; return this.status(gstin); },
  async irn(v){
    const s = SL(), co = CO(s.cid), probs = this.problems(v, co, s.cfg);
    if (probs.length) throw new Error(probs[0]);
    const j = await GSTAPI.call({action: "irn", gstin: String(co.gstin).toUpperCase(), docKey: v.id, clientId: co.id, inv: this.build(v, co, s.cfg)});
    Object.assign(v.x, {irn: j.irn, ackNo: j.ackNo, ackDt: j.ackDt, signedQr: j.signedQr || "", irnStatus: "active"});
    if (j.ewbNo) v.x.ewayNo = j.ewbNo;
    saveSales(); return j;
  },
  async cancel(v, reason, remark){
    const s = SL(), co = CO(s.cid);
    await GSTAPI.call({action: "irn-cancel", gstin: String(co.gstin).toUpperCase(), docKey: v.id, reason, remark});
    v.x.irnStatus = "cancelled"; v.x.irnCancelledAt = new Date().toISOString(); saveSales();
  },
  async ewb(v, trans){
    const s = SL(), co = CO(s.cid);
    const j = await GSTAPI.call({action: "ewb", gstin: String(co.gstin).toUpperCase(), docKey: v.id, trans});
    Object.assign(v.x, {ewayNo: j.ewbNo, ewayDate: j.ewbDate, ewayValidTill: j.validTill}); saveSales(); return j;
  }
};
