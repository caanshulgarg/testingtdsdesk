/* ================================================================== */
/* GST on advances: GSTR-1 tables 11A (received) and 11B (adjusted)   */
/* ================================================================== */
const GSTAdv = {
  RATES: [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40],
  ready(){ const b = S.books; return !!(b && b.meta && b.meta.bills); },
  nearRate(x){ let best = 18, d = 1e9; this.RATES.forEach(r => { if (Math.abs(r - x) < d){ d = Math.abs(r - x); best = r; } }); return d < 0.6 ? best : r2(x); },
  // a ledger is a customer when it sits under Sundry Debtors; without the masters, when it was billed
  isCustomer(name, billed){
    const b = S.books, under = b.under || {}, groups = b.groups || {};
    let p = under[name];
    if (p == null) return billed.has(name);
    for (let i = 0; p && i < 15; i++){
      if (/^sundry\s+debtors$/i.test(p.trim())) return true;
      p = groups[p];
    }
    return false;
  },
  stateCode(name){ return STATE_CODES[String(name || "").toUpperCase().trim()] || ""; },
  _memo: null,
  // every advance received, and what later used it up
  build(){
    const b = S.books;
    if (!b || !b.vouchers) return {pieces: [], billed: new Map()};
    const key = [b.vouchers.length, b.mapV || 0, JSON.stringify(b.advFix || {}), Object.keys(b.under || {}).length, Object.keys(b.states || {}).length, S.coId].join("|");
    if (this._memo && this._memo.key === key && this._memo.v === b.vouchers) return this._memo.res;
    const fix = b.advFix || {};
    const vs = b.vouchers.map((v, i) => [v, i]).sort((a, c) => String(a[0].date).localeCompare(String(c[0].date)) || a[1] - c[1]).map(x => x[0]);
    // what each customer was billed, for the rate, registration and place of supply of an advance
    const billed = new Map();
    const firstSupply = {Goods: 0, Services: 0};
    vs.forEach(v => {
      if (!Books.isSale(v) || /CREDIT NOTE/i.test(v.type)) return;
      const L = Books.lines(v), tax = L.tax.CGST + L.tax.SGST + L.tax.IGST;
      const supply = v.supply || ((v.hsn || []).some(h => /^99/.test(h)) ? "Services" : (v.hsn || []).length ? "Goods" : "");
      if (supply) firstSupply[supply]++;
      const list = billed.get(v.party) || [];
      list.push({date: v.date, rate: L.taxable ? this.nearRate(tax / L.taxable * 100) : null, reg: GSTR.regOf(v), gstin: (v.gstin || "").toUpperCase(),
        pos: v.pos || "", supply, cls: Books.supplyClass(v)});
      billed.set(v.party, list);
    });
    const refs = new Map(), pieces = [];
    const take = (r, amount, ym, date, by, how) => {
      let need = amount;
      r.pieces.forEach(p => {
        if (need <= 0.004 || p.left <= 0.004) return;
        const t = r2(Math.min(need, p.left));
        p.left = r2(p.left - t); need = r2(need - t);
        p.adj.push({ym, date, amount: t, by, how});
      });
    };
    vs.forEach(v => {
      const rcpt = /RECEIPT/i.test(v.type) && !/CONTRA/i.test(v.type);
      const sale = Books.isSale(v) && !/CREDIT NOTE/i.test(v.type);
      const refund = /PAYMENT/i.test(v.type) || /CREDIT NOTE/i.test(v.type);
      if (!rcpt && !sale && !refund) return;
      const ym = GSTR.ym(v.date);
      v.ent.forEach((e, ei) => {
        if (!e.b) return;
        if (rcpt && !this.isCustomer(e.l, billed)) return;
        if (sale && e.l !== v.party) return;
        e.b.forEach((x, bi) => {
          const name = x[0], type = x[1], amt = x[2];
          const k = e.l + "|" + (type === "On Account" ? "\u0000on-account" : name);
          let r = refs.get(k);
          if (rcpt){
            if (amt <= 0) return;                                   // a debit on a receipt is not money received
            const early = type === "Advance" || type === "On Account" || (type === "New Ref" && !(r && r.billed)) || (type === "Agst Ref" && r && !r.billed && r.pieces.length);
            if (!early) return;
            const id = v.id + ":" + ei + ":" + bi;
            const p = {id, vid: v.id, date: v.date, ym, no: v.no, party: e.l, ref: type === "On Account" ? "" : name, type, amount: r2(amt), left: r2(amt), adj: [],
              cmpReg: GSTR.regOf(v), fix: fix[id] || {}};
            pieces.push(p);
            if (!r){ r = {pieces: [], billed: false}; refs.set(k, r); }
            r.pieces.push(p);
          } else if (sale){
            if (type === "Agst Ref" && r && r.pieces.length) take(r, Math.abs(amt), ym, v.date, v.no, "invoice");
            if (r) r.billed = true; else refs.set(k, {pieces: [], billed: true});
          } else if (refund){
            if (amt < 0 && type === "Agst Ref" && r && !r.billed && r.pieces.length) take(r, Math.abs(amt), ym, v.date, v.no, "refund");
          }
        });
      });
    });
    const regs = (GSTR.gstins(b) || []).map(g => g.slice(0, 2));
    const mostly = firstSupply.Goods > firstSupply.Services ? "Goods" : "Services";
    pieces.forEach(p => {
      const f = p.fix;
      if (f.adjYm && p.left > 0.004){ p.adj.push({ym: f.adjYm, date: f.adjYm + "01", amount: p.left, by: "", how: "marked"}); p.left = 0; }
      const hist = billed.get(p.party) || [];
      const before = hist.filter(h => h.date <= p.date), after = hist.filter(h => h.date > p.date);
      const s = before.length ? before[before.length - 1] : after[0] || null;
      p.supply = s && s.supply ? s.supply : mostly;
      p.zero = !!(s && (s.cls === "export" || s.cls === "sez"));
      p.exempt = !!(s && (s.cls === "exempt" || s.cls === "nil" || s.cls === "nongst"));
      p.rate = f.rate != null && f.rate !== "" ? num(f.rate) : s && s.rate != null ? s.rate : 18;
      p.rateFrom = f.rate != null && f.rate !== "" ? "set" : s && s.rate != null ? (before.length ? "last invoice" : "next invoice") : "assumed";
      p.reg = s && s.reg ? s.reg : p.cmpReg || regs[0] || "";
      const gstin = ((b.gstins || {})[p.party] || (s && s.gstin) || "").toUpperCase();
      p.gstin = gstin;
      p.pos = f.pos || (gstin ? gstin.slice(0, 2) : "") || this.stateCode((b.states || {})[p.party]) || (s ? this.stateCode(s.pos) : "") || p.reg;
      p.guessed = p.rateFrom === "assumed" || !s;
      p.skip = !!f.skip;
      // money kept on account is usually a collection nobody tied to its invoice; it counts only when marked
      p.onAccount = p.type === "On Account" && !f.isAdv;
      p.taxed = !p.skip && !p.onAccount && p.supply !== "Goods" && !p.zero && !p.exempt && p.rate > 0;
      p.why = p.skip ? "marked as not an advance" : p.onAccount ? "on account, not tied to a bill: mark it if it is an advance" : p.supply === "Goods" ? "goods: no tax on advances" : p.zero ? "export or SEZ" : p.exempt ? "exempt supply" : p.rate > 0 ? "" : "nil rate";
    });
    const res = {pieces, billed};
    this._memo = {key, v: b.vouchers, res};
    return res;
  },
  // tax inside an amount received, at the rate, split by whether the supply is inter-state
  taxOf(amount, rate, pos, reg){
    const taxable = r2(amount * 100 / (100 + rate)), inter = !!(pos && reg && pos !== reg);
    const tax = r2(taxable * rate / 100);
    return inter ? {taxable, igst: tax, cgst: 0, sgst: 0, cess: 0, inter} : {taxable, igst: 0, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)), cess: 0, inter};
  },
  row(p, amount, extra){
    return Object.assign({id: p.id, party: p.party, gstin: p.gstin, date: p.date, no: p.no, ref: p.ref, type: p.type, rate: p.rate, rateFrom: p.rateFrom,
      pos: p.pos, reg: p.reg, received: amount}, this.taxOf(amount, p.rate, p.pos, p.reg), extra || {});
  },
  // one month: 11A is what came in and was not billed in the same month; 11B is an earlier advance billed now
  month(ym, reg){
    const zero = {n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, received: 0};
    if (!this.ready()) return {ready: false, at: [], txpd: [], atSum: zero, txpdSum: zero, net: zero, untaxed: [], open: []};
    const months = ym ? GSTR.expand(ym) : GSTR.months();
    const {pieces} = this.build();
    const at = [], txpd = [], untaxed = [];
    pieces.forEach(p => {
      if (reg && p.reg !== reg) return;
      months.forEach(m => {
        if (p.ym === m){
          const sameMonth = p.adj.filter(a => a.ym === m).reduce((s, a) => s + a.amount, 0);
          const amount = r2(p.amount - sameMonth);
          if (amount > 0.004){
            if (p.taxed) at.push(this.row(p, amount));
            else untaxed.push(this.row(p, amount, {why: p.why}));
          }
        }
        p.adj.forEach(a => {
          if (a.ym === m && p.ym < m && p.taxed) txpd.push(this.row(p, a.amount, {receivedYm: p.ym, adjDate: a.date, by: a.by, how: a.how}));
        });
      });
    });
    const sum = rows => rows.reduce((s, r) => ({n: s.n + 1, received: r2(s.received + r.received), taxable: r2(s.taxable + r.taxable), igst: r2(s.igst + r.igst),
      cgst: r2(s.cgst + r.cgst), sgst: r2(s.sgst + r.sgst), cess: r2(s.cess + r.cess)}), zero);
    const atSum = sum(at), txpdSum = sum(txpd);
    const net = {n: 0, received: r2(atSum.received - txpdSum.received), taxable: r2(atSum.taxable - txpdSum.taxable), igst: r2(atSum.igst - txpdSum.igst),
      cgst: r2(atSum.cgst - txpdSum.cgst), sgst: r2(atSum.sgst - txpdSum.sgst), cess: r2(atSum.cess - txpdSum.cess)};
    const last = months[months.length - 1] || "";
    const open = pieces.filter(p => (!reg || p.reg === reg) && p.taxed && p.ym <= last && r2(p.amount - p.adj.filter(a => a.ym <= last).reduce((s, a) => s + a.amount, 0)) > 0.004);
    return {ready: true, at, txpd, atSum, txpdSum, net, untaxed, open};
  },
  // GSTR-1 JSON parts: grouped by place of supply and rate, the advance shown without its tax
  json(rows){
    const m = {};
    rows.forEach(r => {
      const k = r.pos + "|" + (r.inter ? "INTER" : "INTRA");
      const g = m[k] = m[k] || {pos: String(r.pos).padStart(2, "0"), sply_ty: r.inter ? "INTER" : "INTRA", rates: {}};
      const it = g.rates[r.rate] = g.rates[r.rate] || {rt: r.rate, ad_amt: 0, iamt: 0, camt: 0, samt: 0, csamt: 0};
      it.ad_amt = r2(it.ad_amt + r.taxable); it.iamt = r2(it.iamt + r.igst); it.camt = r2(it.camt + r.cgst); it.samt = r2(it.samt + r.sgst); it.csamt = r2(it.csamt + r.cess);
    });
    return Object.values(m).map(g => ({pos: g.pos, sply_ty: g.sply_ty, itms: Object.values(g.rates).map(it => g.sply_ty === "INTER"
      ? {rt: it.rt, ad_amt: it.ad_amt, iamt: it.iamt, csamt: it.csamt} : {rt: it.rt, ad_amt: it.ad_amt, camt: it.camt, samt: it.samt, csamt: it.csamt})}));
  }
};

