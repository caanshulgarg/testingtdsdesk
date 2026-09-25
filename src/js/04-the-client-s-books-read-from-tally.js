/* ================================================================== */
/* The client's books, read from Tally: vouchers, ledgers, mapping    */
/* ================================================================== */
const Books = {
  // Tally exports can be very large, so the file is read in pieces and only what we use is kept
  async importDayBook(file, onProgress){
    const dec = await this.decoder(file);
    const out = [], meta = {company: "", from: "", to: "", gstins: new Set(), bills: 1, cc: 1};
    let buf = "", read = 0;
    const reader = file.stream().getReader();
    for (;;){
      const {done, value} = await reader.read();
      if (done) break;
      read += value.length;
      buf += dec.decode(value, {stream: true});
      let cut;
      while ((cut = buf.indexOf("</VOUCHER>")) >= 0){
        const piece = buf.slice(0, cut + 10);
        buf = buf.slice(cut + 10);
        const start = piece.lastIndexOf("<VOUCHER ");
        if (start >= 0) this.takeVoucher(piece.slice(start), out, meta);
      }
      if (buf.length > 400000) buf = buf.slice(-200000);
      if (onProgress && out.length % 250 === 0) onProgress("Read " + out.length + " vouchers (" + Math.round(read / 1048576) + " MB)…");
    }
    buf += dec.decode();
    let cut;
    while ((cut = buf.indexOf("</VOUCHER>")) >= 0){
      const piece = buf.slice(0, cut + 10); buf = buf.slice(cut + 10);
      const start = piece.lastIndexOf("<VOUCHER ");
      if (start >= 0) this.takeVoucher(piece.slice(start), out, meta);
    }
    meta.gstins = Array.from(meta.gstins);
    const dates = out.map(v => v.date).filter(Boolean).sort();
    meta.from = dates[0] || ""; meta.to = dates[dates.length - 1] || "";
    return {vouchers: out, meta};
  },
  async decoder(file){
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (head[0] === 0xFF && head[1] === 0xFE) return new TextDecoder("utf-16le");
    if (head[0] === 0xFE && head[1] === 0xFF) return new TextDecoder("utf-16be");
    return new TextDecoder("utf-8");
  },
  // Tally writes "Applicable" or "Not Applicable", sometimes with a stray character in front
  yesFlag(v){ const t = String(v || "").replace(/[^A-Za-z ]/g, " ").trim().toLowerCase(); return /\bapplicable\b/.test(t) && !/\bnot\b/.test(t); },
  // "$17000.00 @ ₹ 86.40/$ = ₹ 1468800.00" is 1468800: the rupee value after the last "="
  amt(v){ const t = String(v || ""), i = t.lastIndexOf("="); return num(i >= 0 ? t.slice(i + 1) : t); },
  one(s, tag){ const m = s.match(new RegExp("<" + tag + ">([^<]*)</" + tag + ">")); return m ? this.unesc(m[1]) : ""; },
  unesc(v){
    return String(v || "").replace(/&apos;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (m, n) => { const c = num(n); return c >= 32 && c < 127 ? String.fromCharCode(c) : " "; })
      .replace(/&amp;/g, "&").trim();
  },
  takeVoucher(s, out, meta){
    const type = (s.match(/VCHTYPE="([^"]*)"/) || [])[1] || "";
    const v = {
      id: this.one(s, "GUID") || (s.match(/REMOTEID="([^"]*)"/) || [])[1] || "",
      date: this.one(s, "DATE"), type,
      no: this.one(s, "VOUCHERNUMBER"), ref: this.one(s, "REFERENCE"), refDate: this.one(s, "REFERENCEDATE"),
      party: this.one(s, "PARTYNAME") || this.one(s, "PARTYLEDGERNAME"),
      gstin: this.one(s, "PARTYGSTIN"), pos: this.one(s, "PLACEOFSUPPLY"),
      cmp: this.one(s, "CMPGSTIN"), narr: this.one(s, "NARRATION").slice(0, 120),
      regType: this.one(s, "GSTREGISTRATIONTYPE"),
      country: this.one(s, "COUNTRYOFRESIDENCE"),
      rcm: this.yesFlag(this.one(s, "GSTOVRDNISREVCHARGEAPPL")) || this.one(s, "ISREVERSECHARGEAPPLICABLE") === "Yes",
      taxability: this.one(s, "GSTOVRDNTAXABILITY"),
      supply: this.one(s, "GSTOVRDNTYPEOFSUPPLY"),
      ineligibleFlag: this.yesFlag(this.one(s, "GSTOVRDNINELIGIBLEITC")),
      hsn: Array.from(new Set((s.match(/<GSTHSNNAME>([^<]*)<\/GSTHSNNAME>/g) || []).map(x => x.replace(/<[^>]*>/g, "").trim()).filter(Boolean))),
      by: this.one(s, "ENTEREDBY"), upd: this.one(s, "UPDATEDDATETIME").slice(0, 8),
      cancel: this.one(s, "ISCANCELLED") === "Yes", opt: this.one(s, "ISOPTIONAL") === "Yes",
      ent: []
    };
    if (v.cmp) meta.gstins.add(v.cmp);
    // an item invoice keeps the purchase or sales ledger inside each item, in its accounting allocation
    [["<ALLLEDGERENTRIES.LIST>", "</ALLLEDGERENTRIES.LIST>"], ["<LEDGERENTRIES.LIST>", "</LEDGERENTRIES.LIST>"], ["<ACCOUNTINGALLOCATIONS.LIST>", "</ACCOUNTINGALLOCATIONS.LIST>"]].forEach(([open2, close]) => {
      s.split(open2).slice(1).forEach(p => {
        const e = p.split(close)[0];
        const name = this.one(e, "LEDGERNAME");
        if (!name) return;
        const x = {l: name, a: this.amt(this.one(e, "AMOUNT")), r: num(this.one(e, "GSTRATE")) || null};
        // bill-wise details: [ref name, New Ref / Agst Ref / Advance / On Account, amount]
        if (e.indexOf("<BILLALLOCATIONS.LIST>") >= 0){
          const bl = e.split("<BILLALLOCATIONS.LIST>").slice(1).map(p2 => {
            const q = p2.split("</BILLALLOCATIONS.LIST>")[0];
            return [this.one(q, "NAME"), this.one(q, "BILLTYPE"), this.amt(this.one(q, "AMOUNT"))];
          }).filter(z => z[1] && z[2]);
          if (bl.length) x.b = bl;
        }
        // cost centres: [category, cost centre, amount]
        if (e.indexOf("<CATEGORYALLOCATIONS.LIST>") >= 0){
          const cl = [];
          e.split("<CATEGORYALLOCATIONS.LIST>").slice(1).forEach(p3 => {
            const blk = p3.split("</CATEGORYALLOCATIONS.LIST>")[0], cat = this.one(blk, "CATEGORY") || "Primary Cost Category";
            blk.split("<COSTCENTREALLOCATIONS.LIST>").slice(1).forEach(p4 => { const q4 = p4.split("</COSTCENTREALLOCATIONS.LIST>")[0], nm = this.one(q4, "NAME"); if (nm) cl.push([cat, nm, this.amt(this.one(q4, "AMOUNT"))]); });
          });
          if (cl.length) x.c = cl;
        }
        v.ent.push(x);
      });
    });
    // the rate on an item line, when the tax ledgers do not carry one
    if (!v.ent.some(e => e.r)){
      const rate = this.one(s, "GSTRATE");
      if (rate) v.rate = num(rate);
    }
    if (v.ent.length) out.push(v);
  },
  async importMasters(file, onProgress){
    const dec = await this.decoder(file);
    const pans = {}, gstins = {}, under = {}, states = {}, groups = {}, info = {}, groupInfo = {};
    let buf = "", n = 0;
    const take = whole => {
      // the groups come before the ledgers; keep the tree, to know a customer from a supplier
      if (whole.indexOf("<GROUP NAME=") >= 0) (whole.match(/<GROUP NAME="[^"]*"[\s\S]*?<\/GROUP>/g) || []).forEach(g => {
        const gn = this.unesc(g.match(/<GROUP NAME="([^"]*)"/)[1]);
        groups[gn] = this.one(g, "PARENT");
        groupInfo[gn] = {rev: this.one(g, "ISREVENUE") === "Yes", gp: this.one(g, "AFFECTSGROSSPROFIT") === "Yes", dr: this.one(g, "ISDEEMEDPOSITIVE") === "Yes"};
      });
      const at = whole.lastIndexOf("<LEDGER ");
      if (at < 0) return;
      const piece = whole.slice(at);
      const raw = (piece.match(/<LEDGER NAME="([^"]*)"/) || [])[1];
      if (!raw) return;
      const name = this.unesc(raw);
      const pan = this.one(piece, "INCOMETAXNUMBER").toUpperCase();
      const gst = this.one(piece, "PARTYGSTIN").toUpperCase();
      const par = this.one(piece, "PARENT");
      const st = this.one(piece, "LEDSTATENAME") || ((piece.match(/<STATE>[^<]*<\/STATE>/g) || []).map(x => this.unesc(x.replace(/<[^>]*>/g, ""))).filter(Boolean).pop() || "");
      if (pan) pans[name] = pan;
      if (gst) gstins[name] = gst;
      if (par) under[name] = par;
      const tt = this.one(piece, "TAXTYPE").replace(/[^A-Za-z ]/g, "").trim();
      info[name] = {group: par, taxType: tt, dutyHead: this.one(piece, "GSTDUTYHEAD"), tdsNature: this.one(piece, "TDSNATUREOFPAYMENT") || this.one(piece, "NATUREOFPAYMENT"), gstin: gst, pan,
        ob: this.amt(this.one(piece, "OPENINGBALANCE")), from: this.one(piece, "STARTINGFROM"),
        msme: this.one(piece, "UDYAMREGNUMBER") ? (this.one(piece, "ENTERPRISETYPE") || "Micro") : "", regType: this.one(piece, "GSTREGISTRATIONTYPE")};
      if (st) states[name] = st;
      n++;
    };
    const reader = file.stream().getReader();
    for (;;){
      const {done, value} = await reader.read();
      if (done) break;
      buf += dec.decode(value, {stream: true});
      let cut;
      while ((cut = buf.indexOf("</LEDGER>")) >= 0){
        const piece = buf.slice(0, cut + 9); buf = buf.slice(cut + 9);
        take(piece);
      }
      if (onProgress && n % 300 === 0) onProgress("Read " + n + " ledgers\u2026");
    }
    buf += dec.decode();
    let cut;
    while ((cut = buf.indexOf("</LEDGER>")) >= 0){
      const piece = buf.slice(0, cut + 9); buf = buf.slice(cut + 9);
      take(piece);
    }
    return {pans, gstins, under, states, groups, groupInfo, info, count: n};
  },
  // what each ledger is: TDS section, GST tax, party or expense
  mapLedgers(vouchers, saved){
    const seen = new Map();
    vouchers.forEach(v => v.ent.forEach(e => seen.set(e.l, (seen.get(e.l) || 0) + 1)));
    const map = {};
    seen.forEach((n, name) => {
      const keep = (saved || {})[name];
      if (keep && keep.byHand){ map[name] = Object.assign({n}, keep); return; }
      map[name] = Object.assign({n}, this.guess(name), keep && keep.byHand ? keep : {});
    });
    return map;
  },
  guess(name){
    const u = name.toUpperCase();
    const sec = u.match(/\b(19[2-9][A-Z]{0,2}|206C[A-Z]?)\b/);
    if (/TDS|TCS/.test(u) && sec){
      const rate = (u.match(/(\d+(?:\.\d+)?)\s*%/) || [])[1];
      return {kind: /RECEIVABLE/.test(u) ? "tds_receivable" : "tds_payable", section: sec[1], rate: rate ? num(rate) : null};
    }
    const gst = u.match(/\b(\d{2})?\s*(CGST|SGST|UTGST|IGST|CESS)\s*(INPUT|OUTPUT)?\b/);
    if (gst && /INPUT|OUTPUT/.test(u)) return {kind: "gst", reg: gst[1] || "", tax: gst[2] === "UTGST" ? "SGST" : gst[2], side: gst[3] === "INPUT" ? "input" : "output"};
    if (/\bROUND\s*(ED)?\s*OFF\b/.test(u)) return {kind: "roundoff"};
    if (/BANK|CASH\b/.test(u)) return {kind: "bank"};
    return {kind: ""};
  },
  ledgerOf(name){ return (S.books && S.books.map && S.books.map[name]) || {}; },
  // the purchase and sales side of a voucher, ready for GST and TDS
  lines(v){
    const out = {taxable: 0, tax: {CGST: 0, SGST: 0, IGST: 0, CESS: 0}, tds: [], tdsPaid: [], party: 0, rates: {}, roundoff: 0};
    v.ent.forEach(e => {
      const m = Books.ledgerOf(e.l), amt = Math.abs(e.a), sign = e.a < 0 ? -1 : 1;
      if (m.kind === "ineligible"){ out.ineligible = r2((out.ineligible || 0) + amt); out.taxable = r2(out.taxable + amt); return; }
      if (m.kind === "gst" || m.kind === "gst_common"){
        out.tax[m.tax] = r2(out.tax[m.tax] + amt);
        if (m.kind === "gst_common"){ out.common = out.common || {CGST: 0, SGST: 0, IGST: 0, CESS: 0}; out.common[m.tax] = r2(out.common[m.tax] + amt); }
        return;
      }
      if (m.kind === "tds_clearing"){
        if (e.a < 0 && v.ent.some(z => Books.ledgerOf(z.l).kind === "bank")) out.tdsPaid.push({ledger: e.l, section: "", amount: amt});   // paid from the bank
        return;
      }
      if (m.kind === "tds_payable"){
        // the month-end move of each section's TDS into a clearing account is neither a deduction nor a payment
        if (e.a < 0 && v.ent.some(z => Books.ledgerOf(z.l).kind === "tds_clearing" && z.a > 0)) return;
        if (e.a > 0) out.tds.push({ledger: e.l, section: m.section, rate: m.rate, amount: amt});   // credited: tax deducted
        else if (!v.ent.some(z => Books.ledgerOf(z.l).kind === "bank")) return;                     // debited without the bank: an adjustment, not a payment
        else out.tdsPaid.push({ledger: e.l, section: m.section, amount: amt});                      // debited: tax paid over
        return;
      }
      if (m.kind === "roundoff"){ out.roundoff = r2(out.roundoff + e.a); return; }
      if (m.kind === "tax_other" || m.kind === "tcs_payable" || m.kind === "tcs_receivable") return;
      if (e.l === v.party){ out.party = amt; return; }
      if (m.kind === "bank" || m.kind === "tds_receivable") return;
      out.taxable = r2(out.taxable + amt);
      if (e.r){ const key = String(r2(e.r * 2)); out.rates[key] = r2((out.rates[key] || 0) + amt); }
    });
    out.total = r2(out.taxable + out.tax.CGST + out.tax.SGST + out.tax.IGST + out.tax.CESS + out.roundoff);
    return out;
  },
  // what part of the return a voucher belongs to
  supplyClass(v){
    const country = String(v.country || "").toLowerCase();
    const exportish = /EXPORT/i.test(v.type) || (country && country !== "india");
    if (exportish) return "export";
    if (/SEZ/i.test(v.type) || /SEZ/i.test(v.regType || "")) return "sez";
    if (/exempt/i.test(v.taxability || "")) return "exempt";
    if (/nil/i.test(v.taxability || "")) return "nil";
    if (/non.?gst/i.test(v.taxability || "")) return "nongst";
    return "taxable";
  },
  isRcm(v){ return !!v.rcm; },
  isImport(v){ const c = String(v.country || "").toLowerCase(); return !!c && c !== "india"; },
  // orders and stock movements carry no accounts; they are never purchases or sales
  NONACC: /ORDER|DELIVERY NOTE|RECEIPT NOTE|REJECTION|STOCK JOURNAL|PHYSICAL STOCK|MATERIAL (IN|OUT)|MEMO/i,
  groupPath(l){ const b = S.books || {}, under = b.under || {}, groups = b.groups || {}, out = []; let p = under[l]; for (let i = 0; p && i < 15; i++){ out.push(p); p = groups[p]; } return out; },
  // a voucher type with its own name ("GST INWARD", "LOCAL", "IMPORT") is known by what it does:
  // it debits a ledger under Purchase Accounts, or credits one under Sales Accounts
  byContent(v, re, debit){
    if (/JOURNAL|PAYMENT|RECEIPT|CONTRA/i.test(v.type)) return false;
    return v.ent.some(e => (debit ? e.a < 0 : e.a > 0) && (this.groupPath(e.l).some(g => re.test(g)) || (!this.groupPath(e.l).length && (debit ? /PURCHASE/i : /\bSALES?\b/i).test(e.l))));
  },
  isPurchase(v){
    if (this.NONACC.test(v.type)) return false;
    if (/PUR|PURCHASE/i.test(v.type) || /DEBIT NOTE/i.test(v.type)) return true;
    if (/SALE|SALES|CREDIT NOTE|EXPORT/i.test(v.type)) return false;
    return this.byContent(v, /^purchase accounts$/i, true);
  },
  isSale(v){
    if (this.NONACC.test(v.type)) return false;
    if (/SALE|SALES|CREDIT NOTE|EXPORT/i.test(v.type)) return true;
    if (/PUR|PURCHASE|DEBIT NOTE/i.test(v.type)) return false;
    return this.byContent(v, /^sales accounts$/i, false);
  },
  async save(cid, data){
    await IDBStore.write([["books:" + cid, data]]);
  },
  async load(cid){
    try { return await IDBStore.get("books:" + cid); } catch (e){ return null; }
  }
};

