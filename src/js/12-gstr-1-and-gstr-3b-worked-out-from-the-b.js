/* ================================================================== */
/* GSTR-1 and GSTR-3B, worked out from the books and the ledger setup */
/* ================================================================== */
// STATE_CODES: server/_shared/gst3b.js (shared with the gst-run function)
// GSTR's part the GSTR-3B engine runs is in server/_shared/gst3b.js (shared with the gst-run function); the rest is put on it here
Object.assign(GSTR, {
  ECO_NAME: {amazon: "Amazon", flipkart: "Flipkart", shopify: "Shopify", generic: "Marketplace", market: "Marketplace"},
  // what would be rejected or questioned, before it is filed
  checks(ym, reg){
    const out = this.outward(ym, reg), inn = this.inward(ym, reg), list = [];
    // all: every document found (GST › What to fix lists them); rows: the first five, the examples
    const add = (what, rows, how) => { if (rows.length) list.push({what, n: rows.length, how, rows: rows.slice(0, 5), all: rows}); };
    add("Invoices to a registered party with no GSTIN", out.filter(r => r.kind === "B2B" && !r.gstin), "Fill the GSTIN on the party ledger in Tally.");
    add("Outward invoices with no place of supply", out.filter(r => !r.posCode && r.kind !== "NIL"), "Set the place of supply on the voucher in Tally, or choose the state here (Set place of supply).");
    add("Tax type that does not match the place of supply", out.filter(r => r.posBad && r.kind !== "NIL"), "CGST and SGST are for a sale within your state; IGST for a sale to another state. Correct the tax ledgers or the place of supply on the invoice in Tally.");
    add("Outward invoices with no HSN", out.filter(r => !r.hsn && r.cls === "taxable"), "HSN is needed in the GSTR-1 summary.");
    add("Tax that does not fit the taxable value", out.filter(r => r.taxable && this.partsOf([r]).some(q => !Books.GST_RATES.includes(q.rate))), "Check the rate on these invoices.");
    if (typeof GSTF === "object") add("Credit notes issued after 30 November following the invoice\u2019s year", GSTF.lateCn(ym, reg).map(x => ({no: x.no + " (for " + x.orig + ")", party: x.party, doc: x})), "Section 34(2): these cannot reduce your tax. Keep them out of 3.1(a) or issue them as financial credit notes without GST.");
    if (typeof GSTF === "object"){ const e = GSTF.einv(ym, reg);
      if (e.uses){ add("Invoices to registered customers without an e-invoice (IRN)", e.missing, "Generate the IRN before reporting; GSTR-1 is filled from e-invoices and an invoice without one is not a valid tax invoice where e-invoicing applies.");
        add("E-invoices generated more than 30 days after the invoice date", e.late, "For turnover of \u20b910 crore and above the IRP refuses these; check the date and the turnover limit that applies."); } }
    add("Invoices with items at more than one rate", out.filter(r => r.mixed), "Split rate by rate in the return, from each item's rate in Tally.");
    // G-A1, G-A2 (10-Oct-2026): what the portal refuses, found before the file is made
    add("Buyer GSTINs that are not valid", out.filter(r => r.gstin && !gstinValid(r.gstin)).map(r => ({no: r.gstin, party: r.party, doc: r})), "The 15th character (the check digit) or the form of the GSTIN is wrong, so the portal refuses the invoice. Correct the GSTIN on the party ledger in Tally.");
    const dn = this.docNoIssues(ym, reg);
    add("Invoice numbers longer than 16 characters", dn.long, "The portal takes at most 16 characters. Shorten the number in Tally (and on the invoice), e.g. drop the year's prefix.");
    add("Invoice numbers with characters the portal does not take", dn.chars, "Only letters, digits, / and - are allowed, and a number cannot be only zeros. Change the number in Tally.");
    add("Invoice numbers used twice in the financial year", dn.dup, "Each invoice (and each credit or debit note) needs its own number in the year. Renumber one of them in Tally.");
    add("Purchases with no supplier GSTIN", inn.filter(r => !r.gstin && !r.fromHold && (r.cgst || r.sgst || r.igst)), "Needed to match against 2B.");
    add("Supplier GSTINs that are not valid", inn.filter(r => r.gstin && !gstinValid(r.gstin)).map(r => ({no: r.gstin, party: r.party, doc: r})), "The check digit or the form of the GSTIN is wrong: the bill can never match 2B. Correct the GSTIN on the supplier's ledger in Tally.");
    add("Purchases marked ITC not to be taken", inn.filter(r => r.blocked), "These are kept out of the credit claimed.");
    add("Inward supplies under reverse charge", inn.filter(r => r.rcm), "Tax on these is payable by you and shown in 3.1(d).");
    // for the year's grid: a check that is only for information is not an error
    list.forEach(c => { if (/^(Purchases marked ITC not to be taken|Inward supplies under reverse charge|Advances kept on account, not counted|Invoices with items at more than one rate)$/.test(c.what)) c.info = true; c.ret = /^(Purchases|Supplier|Inward)/.test(c.what) ? "r3b" : "r1"; });
    if (GSTAdv.ready()){
      const a = GSTAdv.month(ym, reg);
      add("Advances where the rate was assumed at 18%", a.at.filter(r => r.rateFrom === "assumed").map(r => ({no: r.no, party: r.party})), "The customer has no invoice to take a rate from. Set it under Advances.");
      add("Advances kept on account, not counted", a.untaxed.filter(r => /on account/.test(r.why)).map(r => ({no: r.ref, party: r.party})), "Mark any that are advances under Advances.");
    }
    return list;
  },
  // G-A2: the invoice and note numbers of a month that the portal refuses: over 16 characters; characters other than letters,
  // digits, / and -, or only zeros; the same number twice in the financial year (invoices and notes counted apart, capitals
  // and small letters the same, as the portal counts them). Only documents reported one by one (B2B, B2C large, exports,
  // notes); B2C small goes as totals
  docNoIssues(ym, reg){
    const ONE = {B2B: 1, B2CL: 1, EXP: 1, CDNR: 1, DBNR: 1};
    const rows = this.outward(ym, reg).filter(r => ONE[r.kind] && String(r.no || "").trim());
    const s = r => String(r.no).trim();
    const fyM = (() => { const y = num(String(ym).slice(0, 4)), m = num(String(ym).slice(4, 6)), f = m >= 4 ? y : y - 1, out = []; for (let i = 0; i < 12; i++){ const mm = (i + 3) % 12 + 1; out.push((mm >= 4 ? f : f + 1) + String(mm).padStart(2, "0")); } return out; })();
    const idx = typeof perRender === "function" ? perRender(this, "docNos|" + reg + "|" + fyM[0], () => this.docNoIndex(fyM, reg)) : this.docNoIndex(fyM, reg);
    const keyOf = r => (r.note ? "N|" : "I|") + s(r).toUpperCase();
    return {long: rows.filter(r => s(r).length > 16), chars: rows.filter(r => !/^[A-Za-z0-9/-]+$/.test(s(r)) || /^0+$/.test(s(r))),
      dup: rows.filter(r => (idx[keyOf(r)] || []).some(id => id !== r.id))};
  },
  docNoIndex(months, reg){
    const ONE = {B2B: 1, B2CL: 1, EXP: 1, CDNR: 1, DBNR: 1}, have = new Set(this.months()), idx = {};
    months.filter(m => have.has(m)).forEach(m => this.outward(m, reg).forEach(r => {
      if (!ONE[r.kind] || !String(r.no || "").trim()) return;
      const k = (r.note ? "N|" : "I|") + String(r.no).trim().toUpperCase();
      (idx[k] = idx[k] || []).includes(r.id) || idx[k].push(r.id);
    }));
    return idx;
  },
  // G-E1: the errors to fix before filing a month's GSTR-1 (sales side) and 3B (purchase side), for the year's grid
  // errorChecks: the checks it counts, each return's list (GST › What to fix shows the same list, so the counts are one)
  errorChecks(ym, reg){
    const all = typeof perRender === "function" ? perRender(this, "chk|" + ym + "|" + reg, () => this.checks(ym, reg)) : this.checks(ym, reg);
    const of = ret => all.filter(c => !c.info && c.ret === ret);
    return {r1: of("r1"), r3b: of("r3b")};
  },
  errorsFor(ym, reg){
    const e = this.errorChecks(ym, reg), n = l => l.reduce((a, c) => a + c.n, 0);
    return {r1: n(e.r1), r3b: n(e.r3b)};
  },
  async toJsonFile(ym, reg){
    const ft = typeof GSTSet === "object" && reg ? GSTSet.typeOf(ym, reg) : "monthly";
    const j = ft === "qrmp" ? (GSTSet.isQEnd(ym) ? GSTQ.r1Q(ym, reg).json : GSTQ.iff(ym, reg).json) : this.toJson(ym, reg);
    // the copy kept here is what later months' amendments are measured against
    const extra = ft === "qrmp" ? (GSTSet.isQEnd(ym) ? {quarter: GSTSet.qStart(ym) + "-" + ym} : {iff: true}) : null;
    if (reg && j.gstin){ try { GSTAmend.keep(JSON.parse(JSON.stringify(j)), "downloaded", extra); saveBooks(); } catch (e){} }
    saveFile("GSTR1_" + (j.gstin || "") + "_" + j.fp + ".json", new Blob([JSON.stringify(j)], {type: "application/json"}));
    return j;
  },
  // GSTR-3B in the shape the portal takes
  threeBJson(ym, reg){
    const t = this.threeB(ym, reg);
    const gstin = (GSTR.gstins(S.books) || []).find(x => !reg || x.slice(0, 2) === reg) || "";
    const sup = (txval, iamt, camt, samt, csamt) => ({txval: r2(txval), iamt: r2(iamt), camt: r2(camt), samt: r2(samt), csamt: r2(csamt)});
    const out = {gstin, ret_period: ym.slice(4, 6) + ym.slice(0, 4),
      sup_details: {
        osup_det: sup(t.net.taxable, t.net.igst, t.net.cgst, t.net.sgst, t.net.cess),
        osup_zero: sup(t.zero.taxable, t.zero.igst, 0, 0, t.zero.cess),
        osup_nil_exmp: {txval: r2(t.nil.taxable)},
        isup_rev: sup(t.rcmOut.taxable, t.rcmOut.igst, t.rcmOut.cgst, t.rcmOut.sgst, t.rcmOut.cess),
        osup_nongst: {txval: r2(t.nongst.taxable)}
      },
      itc_elg: {itc_avl: [
        {ty: "IMPG", iamt: r2(t.impGoods.igst), camt: 0, samt: 0, csamt: r2(t.impGoods.cess)},
        {ty: "IMPS", iamt: r2(t.impServ.igst), camt: 0, samt: 0, csamt: r2(t.impServ.cess)},
        // 4(A)(3) is reverse charge OTHER than imports: imported services are already in IMPS (4(A)(2)), so they are not
        // counted again here (the owner, 17-Oct-2026: "should not be double")
        {ty: "ISRC", iamt: r2(t.rcmIn.igst), camt: r2(t.rcmIn.cgst), samt: r2(t.rcmIn.sgst), csamt: r2(t.rcmIn.cess)},
        {ty: "OTH", iamt: r2(t.other.igst), camt: r2(t.other.cgst), samt: r2(t.other.sgst), csamt: r2(t.other.cess)}
      ], itc_rev: [{ty: "RUL", iamt: r2(t.rev1.igst), camt: r2(t.rev1.cgst), samt: r2(t.rev1.sgst), csamt: r2(t.rev1.cess)},
        {ty: "OTH", iamt: r2(t.rev2.igst), camt: r2(t.rev2.cgst), samt: r2(t.rev2.sgst), csamt: r2(t.rev2.cess)}],
        itc_net: sup(0, t.netItc.igst, t.netItc.cgst, t.netItc.sgst, t.netItc.cess),
        // 4(D)(1) credit reclaimed (ty RUL) and 4(D)(2) ineligible under 16(4) or place of supply (ty OTH)
        itc_inelg: [{ty: "RUL", iamt: r2(t.reclaim.igst), camt: r2(t.reclaim.cgst), samt: r2(t.reclaim.sgst), csamt: r2(t.reclaim.cess)},
          {ty: "OTH", iamt: r2(t.na.igst), camt: r2(t.na.cgst), samt: r2(t.na.sgst), csamt: r2(t.na.cess)}]},
      inward_sup: {isup_details: [{ty: "GST", inter: r2(t.inw5.gstInter), intra: r2(t.inw5.gstIntra)}, {ty: "NONGST", inter: r2(t.inw5.ngInter), intra: r2(t.inw5.ngIntra)}]}
    };
    out.itc_elg.itc_avl.splice(3, 0, {ty: "ISD", iamt: 0, camt: 0, samt: 0, csamt: 0});
    if (t.unregPos.length) out.inter_sup = {unreg_details: t.unregPos.filter(x => Math.abs(x.taxable) >= 0.01).map(x => ({pos: x.pos, txval: r2(x.taxable), iamt: r2(x.igst)})), comp_details: [], uin_details: []};
    return out;
  },
  async toExcel(ym, reg){
    await ensureXlsx();
    const g = this.one(ym, reg), t = this.threeB(ym, reg);
    const d = s => String(s).length === 8 ? String(s).slice(6, 8) + "-" + String(s).slice(4, 6) + "-" + String(s).slice(0, 4) : s;
    const cols = ["GSTIN", "Party", "Invoice no.", "Date", "Place of supply", "Rate", "Taxable", "IGST", "CGST", "SGST", "Cess", "Invoice value"];
    const line = r => [r.gstin, r.party, r.no, d(r.date), r.pos, r.rate, r.taxable, r.igst, r.cgst, r.sgst, r.cess, r.total];
    const wb = XLSX.utils.book_new();
    const add = (name, head, body) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(body)), name);
    add("B2B", cols, g.b2b.map(line));
    add("B2C large", cols, g.b2cl.map(line));
    add("B2C small", cols, g.b2c.map(line));
    if (g.nil.length) add("Nil, exempt, non-GST", cols, g.nil.map(line));
    if (g.rcm.length) add("Reverse charge", cols, g.rcm.map(line));
    add("Credit and debit notes", cols.concat(["Kind"]), g.cdnr.map(r => line(r).concat([r.note])));
    if (g.exp.length) add("Exports", cols, g.exp.map(line));
    add("HSN summary", ["HSN", "Goods or services", "Rate", "Invoices", "Taxable", "IGST", "CGST", "SGST", "Cess"], g.hsn.map(h => [h.hsn, h.supply, h.rate, h.n, h.taxable, h.igst, h.cgst, h.sgst, h.cess]));
    add("Documents issued", ["Series", "From", "To", "Issued"], g.series.map(x => [x.pre, x.from, x.to, x.n]));
    {
      const a = GSTAdv.month(ym, reg), ah = ["Date", "Receipt", "Customer", "GSTIN", "Bill ref", "Received", "Rate", "Rate from", "Place of supply", "Advance less tax", "IGST", "CGST", "SGST"];
      const al = r => [d(r.date), r.no, r.party, r.gstin, r.ref, r.received, r.rate, r.rateFrom, r.pos, r.taxable, r.igst, r.cgst, r.sgst];
      if (a.at.length) add("11A Advances received", ah, a.at.map(al));
      if (a.txpd.length) add("11B Advances adjusted", ["Adjusted on", "By"].concat(ah), a.txpd.map(r => [d(r.adjDate), r.by].concat(al(r))));
    }
    add("Before filing", ["What", "How many", "What to do"], GSTR.checks(ym, reg).map(c => [c.what, c.n, c.how]));
    if (reg){
      const p = GSTAmend.pending(ym, reg);
      if (p.rows.length) add("Amendments", ["Month filed", "Document", "GSTIN", "Number", "Date", "Taxable now", "What differs", "Reported as"],
        p.rows.map(r => { const x = r.now || r.was; return [GSTR.label(r.P), x.kind, x.ctin || "", x.num, d(x.date), r.now ? r.now.txval : 0, r.changes.join("; "), r.act]; }));
    }
    add("GSTR-3B", ["", "Taxable", "IGST", "CGST", "SGST", "Cess"], [
      ["3.1(a) Outward taxable supplies", t.sale.taxable, t.sale.igst, t.sale.cgst, t.sale.sgst, t.sale.cess],
      ["Add: tax on advances, 11A less 11B", t.adv.taxable, t.adv.igst, t.adv.cgst, t.adv.sgst, t.adv.cess],
      ["Less: credit notes", -t.cn.taxable, -t.cn.igst, -t.cn.cgst, -t.cn.sgst, -t.cn.cess],
      ["3.1(b) Zero rated: exports and SEZ", t.zero.taxable, t.zero.igst, t.zero.cgst, t.zero.sgst, t.zero.cess],
      ["3.1(c) Nil rated and exempt", t.nil.taxable, "", "", "", ""],
      ["3.1(d) Inward on reverse charge", t.rcmOut.taxable, t.rcmOut.igst, t.rcmOut.cgst, t.rcmOut.sgst, t.rcmOut.cess],
      ["3.1(e) Non-GST outward", t.nongst.taxable, "", "", "", ""],
      ["3.2 Inter-state to unregistered", t.toUnreg.taxable, t.toUnreg.igst, "", "", ""],
      [], ["4(A)(1) Import of goods", t.impGoods.taxable, t.impGoods.igst, t.impGoods.cgst, t.impGoods.sgst, t.impGoods.cess],
      ["4(A)(2) Import of services", t.impServ.taxable, t.impServ.igst, t.impServ.cgst, t.impServ.sgst, t.impServ.cess],
      ["4(A)(3) Inward on reverse charge", t.rcmIn.taxable, t.rcmIn.igst, t.rcmIn.cgst, t.rcmIn.sgst, t.rcmIn.cess],
      ["4(A)(5) All other ITC", t.other.taxable, t.other.igst, t.other.cgst, t.other.sgst, t.other.cess],
      ["4(B)(1) Reversed: rule 42", "", t.r42.igst, t.r42.cgst, t.r42.sgst, t.r42.cess],
      ["4(B)(1) Reversed: rule 43", "", t.r43.igst, t.r43.cgst, t.r43.sgst, t.r43.cess],
      ["4(B)(2) Reversed: ITC not to be taken", t.blocked.taxable, t.reversal.igst, t.reversal.cgst, t.reversal.sgst, t.reversal.cess],
      ["4(C) Net ITC available", "", t.netItc.igst, t.netItc.cgst, t.netItc.sgst, t.netItc.cess],
      [], ["Tax payable", "", t.payable.igst, t.payable.cgst, t.payable.sgst, t.payable.cess]]);
    const outBin = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-GSTR1-3B-" + (ym || "all") + (reg ? "-" + reg : "") + ".xlsx",
      new Blob([outBin], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
});

