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
  // the IGST rate in a block's rate details, which is the whole GST rate; null when not set
  igstRate(s){ const m = String(s || "").match(/<GSTRATEDUTYHEAD>IGST<\/GSTRATEDUTYHEAD>\s*<GSTRATEVALUATIONTYPE>[^<]*<\/GSTRATEVALUATIONTYPE>\s*<GSTRATE>\s*([\d.]+)\s*<\/GSTRATE>/); return m ? num(m[1]) : null; },
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
      no: this.one(s, "VOUCHERNUMBER"), ref: this.one(s, "REFERENCE"), refDate: this.one(s, "REFERENCEDATE"), irn: this.one(s, "IRN"), irnDate: this.one(s, "IRNACKDATE"),
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
    // each item's HSN, rate and goods or services, for the accounting allocation inside it
    const items = [];
    if (s.indexOf("<ALLINVENTORYENTRIES.LIST>") >= 0){
      let at = 0;
      for (;;){
        const a = s.indexOf("<ALLINVENTORYENTRIES.LIST>", at); if (a < 0) break;
        const z = s.indexOf("</ALLINVENTORYENTRIES.LIST>", a); if (z < 0) break;
        const own = s.slice(a, z).replace(/<ACCOUNTINGALLOCATIONS\.LIST>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST>/g, "");
        const qm = this.one(own, "BILLEDQTY").match(/^\s*(-?[\d.,]+)\s*([A-Za-z][A-Za-z.]*)?/);
        items.push({a, z, h: this.one(own, "GSTHSNNAME"), hd: this.one(own, "GSTHSNDESCRIPTION"), gr: this.igstRate(own), sp: this.one(own, "GSTOVRDNTYPEOFSUPPLY"),
          q: qm ? Math.abs(num(qm[1].replace(/,/g, ""))) : 0, u: qm && qm[2] ? qm[2].replace(/\./g, "").toUpperCase() : ""});
        at = z + 1;
      }
    }
    // an item invoice keeps the purchase or sales ledger inside each item, in its accounting allocation
    [["<ALLLEDGERENTRIES.LIST>", "</ALLLEDGERENTRIES.LIST>"], ["<LEDGERENTRIES.LIST>", "</LEDGERENTRIES.LIST>"], ["<ACCOUNTINGALLOCATIONS.LIST>", "</ACCOUNTINGALLOCATIONS.LIST>"]].forEach(([open2, close]) => {
      let pos = -1;
      s.split(open2).slice(1).forEach(p => {
        pos = s.indexOf(open2, pos + 1);
        const e = p.split(close)[0];
        const name = this.one(e, "LEDGERNAME");
        if (!name) return;
        const x = {l: name, a: this.amt(this.one(e, "AMOUNT")), r: num(this.one(e, "GSTRATE")) || null};
        // the line's own HSN and rate (a ledger invoice), else the item's it sits in
        const it = open2 === "<ACCOUNTINGALLOCATIONS.LIST>" ? items.find(q => pos > q.a && pos < q.z) : null;
        const lh = it ? it.h : this.one(e, "GSTHSNNAME"), lr = it ? it.gr : this.igstRate(e), ls = it ? it.sp : this.one(e, "GSTOVRDNTYPEOFSUPPLY");
        if (lh) x.h = lh;
        if (lr != null) x.gr = lr;
        if (ls) x.sp = ls;
        const ld = it ? it.hd : this.one(e, "GSTHSNDESCRIPTION");
        if (ld) x.hd = ld;
        if (it && it.q){ x.q = it.q; if (it.u) x.u = it.u; it.q = 0; }   // the item's quantity, once, on its first allocation
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
    // a cancelled voucher has no entries; it is kept for the documents issued (GSTR-1 table 13)
    if (v.ent.length || (v.cancel && v.no)) out.push(v);
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
      // TallyPrime keeps the GSTIN, registration type and state in dated registration details;
      // older releases in PARTYGSTIN. The latest dated one is the one in force.
      const regs = (piece.match(/<LEDGSTREGDETAILS\.LIST>[\s\S]*?<\/LEDGSTREGDETAILS\.LIST>/g) || []).map(bk => ({from: this.one(bk, "APPLICABLEFROM"), gstin: this.one(bk, "GSTIN").toUpperCase(), type: this.one(bk, "GSTREGISTRATIONTYPE"), state: this.one(bk, "STATE")}))
        .filter(x => x.gstin || x.type).sort((a, c) => String(a.from).localeCompare(String(c.from)));
      const lastReg = regs.filter(x => x.gstin).pop() || null;
      const gst = (this.one(piece, "PARTYGSTIN") || (lastReg ? lastReg.gstin : "")).toUpperCase();
      const par = this.one(piece, "PARENT");
      const st = this.one(piece, "LEDSTATENAME") || ((piece.match(/<STATE>[^<]*<\/STATE>/g) || []).map(x => this.unesc(x.replace(/<[^>]*>/g, ""))).filter(Boolean).pop() || "");
      // a PAN not typed in Tally is the one inside a valid GSTIN
      const panG = /^\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/.test(gst) ? gst.slice(2, 12) : "";
      if (pan) pans[name] = pan; else if (panG) pans[name] = panG;
      if (gst) gstins[name] = gst;
      if (par) under[name] = par;
      const tt = this.one(piece, "TAXTYPE").replace(/[^A-Za-z ]/g, "").trim();
      info[name] = {group: par, taxType: tt, dutyHead: this.one(piece, "GSTDUTYHEAD"), tdsNature: this.one(piece, "TDSNATUREOFPAYMENT") || this.one(piece, "NATUREOFPAYMENT"), gstin: gst, pan,
        ob: this.amt(this.one(piece, "OPENINGBALANCE")), from: this.one(piece, "STARTINGFROM"),
        msme: this.one(piece, "UDYAMREGNUMBER") ? (this.one(piece, "ENTERPRISETYPE") || "Micro") : "", regType: (lastReg && lastReg.type) || (regs.length ? regs[regs.length - 1].type : "") || this.one(piece, "GSTREGISTRATIONTYPE"),
        panFrom: pan ? "Tally" : panG ? "GSTIN" : "", email: this.one(piece, "EMAIL"), phone: this.one(piece, "LEDGERMOBILE") || this.one(piece, "LEDGERPHONE"), gstinHistory: regs.filter(x => x.gstin).length > 1 ? regs.filter(x => x.gstin).map(x => x.from + ":" + x.gstin) : undefined};
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
    const out = {taxable: 0, tax: {CGST: 0, SGST: 0, IGST: 0, CESS: 0}, tds: [], tdsPaid: [], party: 0, rates: {}, roundoff: 0}, vals = [];
    v.ent.forEach(e => {
      const m = Books.ledgerOf(e.l), amt = Math.abs(e.a), sign = e.a < 0 ? -1 : 1;
      if (m.kind === "ineligible"){ out.ineligible = r2((out.ineligible || 0) + amt); out.taxable = r2(out.taxable + amt); return; }
      // the reverse-charge liability credited beside the input tax is what we owe, not tax on the bill
      if (m.kind === "gst" && m.rcm && m.side === "output"){ out.rcmOwed = r2((out.rcmOwed || 0) + amt); return; }
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
      vals.push({amt, h: e.h || "", gr: e.gr, sp: e.sp || "", hd: e.hd || "", q: num(e.q), u: e.u || ""});
    });
    out.total = r2(out.taxable + out.tax.CGST + out.tax.SGST + out.tax.IGST + out.tax.CESS + out.roundoff);
    out.parts = this.parts(vals, out, v);
    return out;
  },
  GST_RATES: [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40],
  // the nearest GST rate, when a worked-out rate is within a rounding of it
  snapRate(r){ const n = this.GST_RATES.reduce((a, c) => Math.abs(c - r) < Math.abs(a - r) ? c : a, 0); return Math.abs(n - r) <= 0.05 ? n : r; },
  // the value and tax of a voucher, rate by rate and HSN by HSN: from each item's rate where Tally has it,
  // with the tax on the voucher shared out in proportion, so the parts always add up to the voucher
  parts(vals, L, v){
    const heads = ["IGST", "CGST", "SGST", "CESS"], taxAll = r2(heads.reduce((a, h) => a + L.tax[h], 0));
    const g = {};
    vals.forEach(x => { const k = (x.gr == null ? "?" : x.gr) + "|" + x.h; const q = g[k] = g[k] || {gr: x.gr, hsn: x.h, supply: x.sp, desc: x.hd, qty: 0, unit: x.u, taxable: 0};
      q.taxable = r2(q.taxable + x.amt); q.qty = r2(q.qty + x.q); if (!q.supply) q.supply = x.sp; if (!q.desc) q.desc = x.hd; if (!q.unit) q.unit = x.u; });
    let list = Object.values(g);
    const vh = (v && v.hsn || [])[0] || "", vs = (v && v.supply) || "";
    if (!list.length) list = [{gr: null, hsn: vh, supply: vs, taxable: 0}];
    list.forEach(q => { if (!q.hsn) q.hsn = vh; if (!q.supply) q.supply = vs; });
    // lines with no rate take whatever tax the rated lines do not explain
    const known = list.filter(q => q.gr != null), unknown = list.filter(q => q.gr == null);
    const expKnown = r2(known.reduce((a, q) => a + q.taxable * q.gr / 100, 0));
    const unkTaxable = r2(unknown.reduce((a, q) => a + q.taxable, 0));
    const unkTax = Math.max(0, r2(taxAll - expKnown - num(L.tax.CESS)));
    const unkRate = unkTaxable ? this.snapRate(Math.round(unkTax / unkTaxable * 10000) / 100) : (known.length ? 0 : (L.taxable ? this.snapRate(Math.round(r2(taxAll - L.tax.CESS) / L.taxable * 10000) / 100) : 0));
    unknown.forEach(q => { q.gr = unkRate; q.guessed = true; });
    // one line per rate and HSN, the voucher's tax shared by what each should carry
    const m = {};
    list.forEach(q => { const k = q.gr + "|" + q.hsn; const x = m[k] = m[k] || {rate: q.gr, hsn: q.hsn, supply: q.supply, desc: q.desc || "", qty: 0, unit: q.unit || "", taxable: 0, guessed: !!q.guessed};
      x.taxable = r2(x.taxable + q.taxable); x.qty = r2(x.qty + num(q.qty)); if (!x.desc) x.desc = q.desc || ""; if (!x.unit) x.unit = q.unit || ""; });
    const out = Object.values(m).sort((a, c) => c.taxable - a.taxable);
    const w = out.map(x => x.taxable * x.rate), ws = w.reduce((a, c) => a + c, 0), ts = out.reduce((a, x) => a + x.taxable, 0);
    heads.forEach(h => {
      const k = h === "IGST" ? "igst" : h === "CGST" ? "cgst" : h === "SGST" ? "sgst" : "cess";
      let left = L.tax[h];
      out.forEach((x, i) => { const share = i === out.length - 1 ? left : r2(L.tax[h] * (h === "CESS" || !ws ? (ts ? x.taxable / ts : 1 / out.length) : w[i] / ws)); x[k] = share; left = r2(left - share); });
    });
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
  // reverse charge: marked so in Tally, or the tax on the bill credited to a reverse-charge payable ledger
  isRcm(v){
    if (v.rcm) return true;
    // a reverse-charge ledger on the voucher: the payable credited, or a reverse-charge input debited
    return v.ent.some(e => { const m = this.ledgerOf(e.l); return m.kind === "gst" && m.rcm && (m.side === "output" ? e.a > 0.004 : e.a < -0.004); });
  },
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

