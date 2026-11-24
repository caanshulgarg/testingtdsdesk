/* @react-lazy: begin 55-einvoice.js (the React app loads this file with its Sales and GST settings screens: build.py react_parts) */
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
  // (next-fix-audit-sales-einv) the seller: the client's registration the invoice is issued from (salesRegOf, as the Tally
  // voucher's CMPGSTIN), never its main GSTIN for an invoice of another; "" when the client has several and it is not
  // known. Its address: Sales settings' for the main GSTIN, the registration's own (cfg["address_" + GSTIN]) for another
  seller(v, co){ const r = salesRegOf(v); return String(r.gstin || (r.several ? "" : co.gstin) || "").toUpperCase(); },
  // the GSTIN an IRN was made under (cancel, e-way bill): one made before irnGstin was kept was made with the main GSTIN
  irnSeller(v, co){ return v.x.irnGstin || (v.x.irnStatus ? String(co.gstin || "").toUpperCase() : this.seller(v, co)); },
  address(gstin, co, cfg){ return gstin && gstin !== String(co.gstin || "").toUpperCase() ? cfg["address_" + gstin] || "" : cfg.address; },
  // what stops the invoice from being e-invoiced, in words
  problems(v, co, cfg){
    const x = v.x, out = [], seller = this.seller(v, co), buyer = String(x.customerGstin || "").toUpperCase();
    if (!seller && salesRegOf(v).several) out.push("Which of the client's registrations this invoice is issued from is not known: set the seller GSTIN on the invoice.");
    else if (!GSTIN_RE.test(seller)) out.push("The client's GSTIN is not set (Client setup).");
    if (!GSTIN_RE.test(buyer)) out.push("The customer has no GSTIN: an invoice to an unregistered person is not e-invoiced.");
    if (!x.number || String(x.number).length > 16) out.push("The invoice number must be 1 to 16 characters.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ""))) out.push("The invoice date is missing.");
    if (!this.pin(this.address(seller, co, cfg))) out.push(seller && seller !== String(co.gstin || "").toUpperCase() ? "The address of the registration " + seller + " in Sales settings needs its PIN code." : "The client's address in Sales settings needs its PIN code.");
    if (!this.pin(x.address)) out.push("The customer's address needs its PIN code.");
    if (!(x.items || []).length) out.push("The invoice needs its items (description, HSN, quantity, rate).");
    (x.items || []).forEach((it, i) => { if (!/^\d{4,8}$/.test(String(it.hsn || "").trim())) out.push("Item " + (i + 1) + " needs an HSN or SAC code of 4 to 8 digits."); });
    // (the IRP is given the items: they must come to the invoice's own total, a rupee's rounding aside)
    if (!out.length){ const b = this.build(v, co, cfg), d = r2(num(x.total) - b.ItemList.reduce((a, it) => a + it.TotItemVal, 0)); if (Math.abs(d) > 1) out.push("The items come to " + money(r2(num(x.total) - d)) + " with GST, but the invoice to " + money(x.total) + ": check the items.");
      // (the IRP's IGST or CGST + SGST are worked out from the seller's state and the place of supply, IGST Act ss.7-8: they
      // must be the invoice's own, a rupee aside, or the IRN reports one tax and the books carry the other)
      const vd = b.ValDtls, cs = r2(num(x.cgst) + num(x.sgst));
      if (Math.abs(vd.IgstVal - num(x.igst)) > 1 || Math.abs(r2(vd.CgstVal + vd.SgstVal) - cs) > 1) out.push("By the place of supply the e-invoice would carry IGST " + money(vd.IgstVal) + " and CGST + SGST " + money(r2(vd.CgstVal + vd.SgstVal)) + ", but the invoice has IGST " + money(num(x.igst)) + " and CGST + SGST " + money(cs) + ": correct the tax or the place of supply."); }
    return out;
  },
  // the invoice in the IRP's schema
  build(v, co, cfg){
    const x = v.x, seller = this.seller(v, co), buyer = String(x.customerGstin || "").toUpperCase(), addr = this.address(seller, co, cfg);
    // (a supply to an SEZ: inter-state whatever the states, IGST Act s.7(5)(b); under LUT no IGST, s.16(3)(a): SupTyp
    // SEZWP / SEZWOP, the IRP's supply types)
    const sez = /^SEZWO?P$/.test(x.supply || "") ? x.supply : "", lut = sez === "SEZWOP";
    const inter = !!sez || !!(x.pos && seller.slice(0, 2) !== String(x.pos));
    let ass = 0, cg = 0, sg = 0, ig = 0, ces = 0, tot = 0;
    const items = (x.items || []).map((it, i) => {
      const qty = num(it.qty) || 1, gross = r2(qty * num(it.rate)), taxable = r2(num(it.taxable) || gross), rate = num(it.gstRate), disc = r2(Math.max(0, gross - taxable));
      const tax = lut ? 0 : r2(taxable * rate / 100), igst = inter ? tax : 0, cgst = inter ? 0 : r2(tax / 2), sgst = inter ? 0 : r2(tax - r2(tax / 2)), cess = r2(num(it.cess));
      const val = r2(taxable + igst + cgst + sgst + cess);
      ass = r2(ass + taxable); cg = r2(cg + cgst); sg = r2(sg + sgst); ig = r2(ig + igst); ces = r2(ces + cess); tot = r2(tot + val);
      const hsn = String(it.hsn || "").trim();
      return {SlNo: String(i + 1), PrdDesc: String(it.desc || "").slice(0, 300), IsServc: /^99/.test(hsn) ? "Y" : "N", HsnCd: hsn, Qty: qty, Unit: this.UQC[it.unit] || "OTH",
        UnitPrice: r2(num(it.rate)), TotAmt: gross || taxable, Discount: disc, AssAmt: taxable, GstRt: rate, IgstAmt: igst, CgstAmt: cgst, SgstAmt: sgst, CesAmt: cess, TotItemVal: val};
    });
    const total = r2(num(x.total) || tot), round = r2(total - tot);
    return {
      Version: "1.1",
      TranDtls: {TaxSch: "GST", SupTyp: sez || "B2B", RegRev: "N", IgstOnIntra: "N"},
      DocDtls: {Typ: x.noteKind === "credit" ? "CRN" : x.noteKind === "debit" ? "DBN" : "INV", No: String(x.number || ""), Dt: this.dmy(x.date)},
      SellerDtls: {Gstin: seller, LglNm: String(co.tallyName || co.name || "").slice(0, 100), Addr1: this.addr1(addr), Loc: this.loc(addr), Pin: num(this.pin(addr)), Stcd: seller.slice(0, 2)},
      BuyerDtls: {Gstin: buyer, LglNm: String(x.customerName || "").slice(0, 100), Pos: String(x.pos || buyer.slice(0, 2)), Addr1: this.addr1(x.address), Loc: this.loc(x.address), Pin: num(this.pin(x.address)), Stcd: buyer.slice(0, 2)},
      ItemList: items,
      ValDtls: {AssVal: ass, CgstVal: cg, SgstVal: sg, IgstVal: ig, CesVal: ces, RndOffAmt: Math.abs(round) < 10 ? round : 0, TotInvVal: Math.abs(round) < 10 ? total : tot}
    };
  },
  // what the invoice's e-invoice part (app/src/screens/Sales.jsx EinvPanel) shows and offers, or null when it is not shown
  // (the firm's GST API off, or a GSTIN not given): a, the e-invoice user (none: "Give the client's e-invoice API user");
  // irn: Make the IRN (none made, or it was cancelled); ewb: Make the e-way bill (an IRN and no e-way bill); cancel:
  // Cancel the IRN (within 24 hours of it). Sales hides an invoice posted over 24 hours ago only when none is offered
  // (salesNeedsAction, src/js/03)
  offers(v, co){
    co = co || CO(SL().cid); const x = v.x || {}, gstin = String(co.gstin || "").toUpperCase();
    if (!GSTAPI.on() || !GSTIN_RE.test(gstin) || !GSTIN_RE.test(String(x.customerGstin || "").toUpperCase())) return null;
    const a = this.need(this.seller(v, co) || gstin), active = !!x.irn && x.irnStatus !== "cancelled", on = !!a && active;
    return {a, active, irn: !!a && !active, ewb: on && !x.ewayNo, cancel: on && !!x.ackDt && Date.now() - Date.parse(x.ackDt) < 864e5};
  },
  // whether the invoice needs an e-way bill (CGST Rules r.138), only for keeping it listed (salesNeedsAction, src/js/03;
  // the panel offers Make the e-way bill on any invoice with an IRN: offers): never a credit or debit note; goods (a line
  // whose HSN does not start with 99, the IRP's IsServc rule in build; a blank HSN counts as goods) that bear GST (exempt
  // and 0% lines left out), worth more than EWB_MIN: their taxable value with GST (none under LUT to an SEZ, SEZWOP) and
  // cess, with the invoice's own cess when no line carries one
  EWB_MIN: 50000,
  ewbNeeded(v){
    const x = v.x || {}, lut = x.supply === "SEZWOP";
    if (x.noteKind) return false;
    const goods = (x.items || []).filter(it => !/^99/.test(String(it.hsn || "").trim()) && num(it.gstRate) > 0 && !it.exempt);
    if (!goods.length) return false;
    const lineCess = (x.items || []).some(it => num(it.cess));
    return goods.reduce((a, it) => { const t = num(it.taxable) || (num(it.qty) || 1) * num(it.rate); return a + t * (1 + (lut ? 0 : num(it.gstRate) / 100)) + num(it.cess); }, lineCess ? 0 : num(x.cess)) > this.EWB_MIN;
  },
  // the IRP's time limit, as the GST checks say it (src/js/12: "E-invoices generated more than 30 days after the invoice
  // date"; it binds turnover of Rs 10 crore and above, which is not known here): past it, Make the IRN does not keep an
  // invoice listed (the panel still offers it)
  IRN_DAYS: 30,
  irnLate(v){ const d = Date.parse(String((v.x || {}).date || "").slice(0, 10)); return !!d && Date.now() - d > this.IRN_DAYS * 864e5; },
  accounts: {}, asked: {},
  // the client's e-invoice user, asked of the server once a session (and after a sign-in); never the password
  need(gstin){ if (!this.asked[gstin]){ this.asked[gstin] = Date.now(); this.status(gstin).then(() => render(), () => {}); } return this.accounts[gstin]; },
  async status(gstin){ this.asked[gstin] = Date.now(); const j = await GSTAPI.call({action: "einv-status", gstins: [gstin]}); this.host = j.host; this.accounts[gstin] = (j.accounts || [])[0] || null; return this.accounts[gstin]; },
  async login(gstin, username, password){ const j = await GSTAPI.call({action: "einv-login", gstin, username, password}); this.host = j.host; return this.status(gstin); },
  async irn(v){
    const s = SL(), co = CO(s.cid), probs = this.problems(v, co, s.cfg);
    if (probs.length) throw new Error(probs[0]);
    const gstin = this.seller(v, co);
    const j = await GSTAPI.call({action: "irn", gstin, docKey: v.id, clientId: co.id, inv: this.build(v, co, s.cfg)});
    Object.assign(v.x, {irn: j.irn, ackNo: j.ackNo, ackDt: j.ackDt, signedQr: j.signedQr || "", irnStatus: "active", irnGstin: gstin});
    if (j.ewbNo) v.x.ewayNo = j.ewbNo;
    saveSales(); return j;
  },
  async cancel(v, reason, remark){
    const s = SL(), co = CO(s.cid);
    await GSTAPI.call({action: "irn-cancel", gstin: this.irnSeller(v, co), docKey: v.id, reason, remark});
    v.x.irnStatus = "cancelled"; v.x.irnCancelledAt = new Date().toISOString();
    // (next-fix-audit-sales-einv) a cancelled IRN: the invoice is no supply any more (CGST Rules r.48(4)), so it leaves the
    // sales (ignored, never posted); one already in Tally stays, marked: its voucher is to be cancelled in Tally
    // (a posting still queued in the cloud may yet reach Tally: marked, and salesQueuedSync sets it aside if it does not)
    if (["posted", "intally"].includes(v.status) || v.postJob) v.x.irnCancelInTally = true; else v.status = "ignored";
    saveSales();
  },
  async ewb(v, trans){
    const s = SL(), co = CO(s.cid);
    const j = await GSTAPI.call({action: "ewb", gstin: this.irnSeller(v, co), docKey: v.id, trans});
    Object.assign(v.x, {ewayNo: j.ewbNo, ewayDate: j.ewbDate, ewayValidTill: j.validTill}); saveSales(); return j;
  }
};
if (typeof globalThis === "object") globalThis.EINV = EINV;
/* @react-lazy: end */
