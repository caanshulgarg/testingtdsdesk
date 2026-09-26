/* ================================================================== */
/* ================================================================== */
/* GSTR-2B reconciliation: the purchase side of Tally against 2B      */
/* ================================================================== */
const GST2B = {
  normNo(s){ return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); },
  // the same number written differently: "INV/2024-25/0012", "INV-12/24-25", "12"
  coreNo(s){
    let t = String(s || "").toUpperCase().replace(/\b(FY)?\s*20\d{2}\s*[-/]\s*(20)?\d{2}\b/g, " ").replace(/\b\d{2}\s*[-/]\s*\d{2}\b(?=\D*$|\D)/g, " ");
    const digits = (t.match(/\d+/g) || []).map(d => String(num(d)));
    const letters = t.replace(/[^A-Z]/g, "").replace(/^(INV|INVOICE|BILL|TAX|GST|NO|SI|CN|DN)+/, "");
    return letters + "|" + digits.join("-");
  },
  lastDigits(s){ const d = String(s || "").match(/\d+/g); return d ? String(num(d[d.length - 1])) : ""; },
  dmy(s){ const p = String(s || "").split("-"); return p.length === 3 ? p[2] + p[1] + p[0] : String(s || "").replace(/\D/g, "").slice(0, 8); },
  ymOfPeriod(p){ p = String(p || ""); return p.length === 6 ? p.slice(2) + p.slice(0, 2) : ""; },
  RSN: {P: "place of supply rule: supplier and recipient in the same state, different place of supply", C: "filed after the time limit in section 16(4)"},
  IMS: {N: "no action", A: "accepted", R: "rejected", P: "pending"},
  // the portal's JSON: one row per document, every section 2B carries
  fromJson(j){
    const d = (j && j.data) || j || {}, dd = d.docdata || {}, period = d.rtnprd || "", ym = this.ymOfPeriod(period);
    const rows = [];
    const add = (sec, sup, x, extra) => {
      const no = x.inum || x.ntnum || x.nt_num || x.docnum || x.boenum || "";
      rows.push(Object.assign({sec, period, ym, gstin: String(sup.ctin || "").toUpperCase(), party: sup.trdnm || "", filedOn: sup.supfildt || "", supPrd: sup.supprd || "",
        no: String(no), noN: this.normNo(no), date: this.dmy(x.dt || x.docdt || x.boedt || x.nt_dt), val: num(x.val), taxable: num(x.txval),
        igst: num(x.igst), cgst: num(x.cgst), sgst: num(x.sgst), cess: num(x.cess), pos: x.pos || "", rcm: x.rev === "Y", itcavl: x.itcavl || x.itcelg || "Y",
        rsn: x.rsn || "", typ: x.typ || "", ims: x.imsStatus || "", irn: x.irn || "", dir: 1}, extra || {}));
    };
    (dd.b2b || []).forEach(s => (s.inv || []).forEach(x => add("b2b", s, x)));
    (dd.b2ba || []).forEach(s => (s.inv || []).forEach(x => add("b2ba", s, x, {oNo: x.oinum || "", oDate: this.dmy(x.oidt)})));
    (dd.cdnr || []).forEach(s => (s.nt || s.inv || []).forEach(x => add("cdnr", s, x, {dir: x.typ === "D" ? 1 : -1})));
    (dd.cdnra || []).forEach(s => (s.nt || s.inv || []).forEach(x => add("cdnra", s, x, {dir: x.typ === "D" ? 1 : -1, oNo: x.ontnum || x.ont_num || "", oDate: this.dmy(x.ontdt || x.ont_dt)})));
    (dd.isd || []).forEach(s => (s.doclist || []).forEach(x => add("isd", s, x, {dir: x.doctyp === "C" ? -1 : 1})));
    (dd.impg || []).forEach(x => add("impg", {ctin: "", trdnm: "Import of goods (" + (x.portcode || "") + ")"}, x));
    // documents rejected in IMS: 2B keeps them apart (docRejdata); they give no credit, and a rejected credit note does not reduce it
    const rj = d.docRejdata || {};
    (rj.b2b || []).forEach(s => (s.inv || []).forEach(x => add("b2b", s, x, {rej: true, ims: "R", itcavl: "N", remarks: x.remarks || ""})));
    (rj.b2ba || []).forEach(s => (s.inv || []).forEach(x => add("b2ba", s, x, {rej: true, ims: "R", itcavl: "N", remarks: x.remarks || "", oNo: x.oinum || "", oDate: this.dmy(x.oidt)})));
    (rj.cdnr || []).forEach(s => (s.nt || s.inv || []).forEach(x => add("cdnr", s, x, {rej: true, ims: "R", itcavl: "N", remarks: x.remarks || "", dir: x.typ === "D" ? 1 : -1})));
    (rj.cdnra || []).forEach(s => (s.nt || s.inv || []).forEach(x => add("cdnra", s, x, {rej: true, ims: "R", itcavl: "N", remarks: x.remarks || "", dir: x.typ === "D" ? 1 : -1})));
    (dd.impgsez || []).forEach(s => (s.boe || []).forEach(x => add("impgsez", s, x)));
    rows.forEach((r, i) => { r.key = period + "|" + r.sec + "|" + r.gstin + "|" + r.noN + "|" + r.date + "|" + i; });
    return {rows, period, ym, gstin: String(d.gstin || "").toUpperCase(), generated: d.gendt || "", summary: d.itcsumm || null};
  },
  // every document in Tally that carries input tax: purchases, and expenses booked in journals or payments
  bookDocs(){
    const b = S.books;
    if (!b || !b.vouchers) return [];
    const regs = ((b.meta || {}).gstins || []).map(g => g.slice(0, 2)), gst = b.gstins || {};
    const out = [];
    this.skipped = {setOff: 0, taxOnly: 0};
    b.vouchers.forEach(v => {
      if (Books.isSale(v)) return;
      const tax = {IGST: 0, CGST: 0, SGST: 0, CESS: 0};
      let signed = 0, reg = "", inel = 0, any = false, setOff = false;
      v.ent.forEach(e => {
        const m = Books.ledgerOf(e.l);
        if ((m.kind === "gst" || m.kind === "gst_common") && m.side === "output" && !m.rcm) setOff = true;
        if (m.kind === "gst" && m.rcm && m.side === "output") return;
        if (!((m.kind === "gst" || m.kind === "gst_common") && m.side === "input") && m.kind !== "ineligible") return;
        any = true;
        const amt = Math.abs(e.a), t = m.tax || "IGST";
        tax[t] = r2(tax[t] + amt); signed += e.a;
        if (m.kind === "ineligible") inel = r2(inel + amt);
        if (m.reg && !reg) reg = m.reg;
      });
      if (!any) return;
      // the month's set-off of output tax against credit is not a purchase
      if (setOff){ this.skipped.setOff++; return; }
      // the supplier: the voucher's party, else the one ledger in it that carries a GSTIN
      let party = v.party, gstin = String(v.gstin || gst[v.party] || "").toUpperCase();
      if (!gstin){ const e = v.ent.find(x => gst[x.l]); if (e){ party = e.l; gstin = String(gst[e.l]).toUpperCase(); } }
      if (!party || Books.ledgerOf(party).kind === "bank"){ const e = v.ent.find(x => (x.a < 0) !== (signed < 0) && !Books.ledgerOf(x.l).kind); if (e) party = e.l; }
      // the value: what sits on the same side as the tax, other than tax, TDS, bank and the supplier
      let taxable = 0;
      v.ent.forEach(e => { if (e.l !== party && !Books.ledgerOf(e.l).kind && (e.a < 0) === (signed < 0)) taxable = r2(taxable + Math.abs(e.a)); });
      // tax alone, with no supplier's GSTIN and no value beside it: a rounding or reversal entry
      if (!taxable && !gstin){ this.skipped.taxOnly++; return; }
      if (!reg) reg = String(v.cmp || "").slice(0, 2) || (regs.length === 1 ? regs[0] : "");
      const no = v.ref || v.no || "";
      out.push({id: v.id, voucher: v.no || "", type: v.type, party: party || "", gstin, no: String(no), noN: this.normNo(no), core: this.coreNo(no),
        date: v.refDate || v.date, bookDate: v.date, ym: String(v.date).slice(0, 6), reg,
        taxable, igst: tax.IGST, cgst: tax.CGST, sgst: tax.SGST, cess: tax.CESS,
        dir: signed <= 0 ? 1 : -1, rcm: Books.isRcm(v), ineligible: inel > 0, narr: v.narr || ""});
    });
    return out;
  },
  settings(){ return Object.assign({tol: 1}, (S.books && S.books.reco2b && S.books.reco2b.opt) || {}); },
  state(){ const b = S.books; b.reco2b = b.reco2b || {}; ["confirm", "link", "tag"].forEach(k => { b.reco2b[k] = b.reco2b[k] || {}; }); return b.reco2b; },
  all2b(reg){
    const all = Object.values((S.books && S.books.twoBs) || {}).filter(t => !reg || t.gstin.slice(0, 2) === reg);
    // for a QRMP GSTIN the quarter's 2B (made for its last month) holds the whole quarter; the first two months' 2Bs are
    // for information only, and are set aside once the quarter's is here
    const have = new Set(all.map(t => t.gstin + "|" + t.ym));
    return all.filter(t => { if (typeof GSTSet !== "object") return true; const r = t.gstin.slice(0, 2);
      return !(GSTSet.typeOf(t.ym, r) === "qrmp" && !GSTSet.isQEnd(t.ym) && have.has(t.gstin + "|" + GSTSet.qEnd(t.ym))); }).sort((a, c) => a.ym.localeCompare(c.ym));
  },
  _memo: null,
  // match every 2B document against every book document, strongest evidence first
  run(reg){
    const b = S.books, st = this.state(), tol = num(this.settings().tol) || 1;
    const key = [reg, b.vouchers && b.vouchers.length, b.mapV || 0, Object.keys(b.gstins || {}).length, Object.keys(b.twoBs || {}).join(","), JSON.stringify(st.confirm), JSON.stringify(st.link), tol, S.coId].join("|");
    if (this._memo && this._memo.key === key && this._memo.v === b.vouchers) return this._memo.res;
    const portal = [], rejRows = [];
    this.all2b(reg).forEach(t => t.rows.forEach(r => (r.rej ? rejRows : portal).push(r)));
    const regs = ((b.meta || {}).gstins || []).map(g => g.slice(0, 2));
    const books = this.bookDocs().filter(d => !reg || d.reg === reg || (!d.reg && regs.length <= 1));
    const byId = new Map(books.map(d => [d.id, d]));
    const taken = new Set(), pairs = [], used2b = new Set();
    const taxOf = x => r2(num(x.igst) + num(x.cgst) + num(x.sgst) + num(x.cess));
    const sumOf = list => list.reduce((a, d) => ({taxable: r2(a.taxable + d.taxable), igst: r2(a.igst + d.igst), cgst: r2(a.cgst + d.cgst), sgst: r2(a.sgst + d.sgst), cess: r2(a.cess + d.cess)}),
      {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0});
    const near = (a, c) => Math.abs(num(a) - num(c)) <= tol;
    const pan = g => String(g || "").slice(2, 12);
    const days = (a, c) => { const f = s => new Date(String(s).slice(0, 4) + "-" + String(s).slice(4, 6) + "-" + String(s).slice(6, 8)).getTime(); return Math.abs(f(a) - f(c)) / 86400000; };
    const byG = new Map();
    books.forEach(d => { const k = d.gstin || "?"; (byG.get(k) || byG.set(k, []).get(k)).push(d); });
    const free = d => !taken.has(d.id);
    const pair = (p, list, tier, how) => {
      list.forEach(d => taken.add(d.id)); used2b.add(p.key);
      const s = sumOf(list);
      const diff = {taxable: r2(p.taxable - s.taxable), igst: r2(p.igst - s.igst), cgst: r2(p.cgst - s.cgst), sgst: r2(p.sgst - s.sgst), cess: r2(p.cess - s.cess)};
      const issues = [];
      const taxSame = near(taxOf(p), taxOf(s));
      // the same tax on a different value: the bill has a part without GST (a reimbursement, a ticket) that Tally counts in the value
      if (!near(p.taxable, s.taxable)) issues.push((taxSame ? "value differs by " : "taxable differs by ") + INR.format(diff.taxable) + (taxSame ? " (the tax is the same)" : ""));
      if (!taxSame) issues.push("tax differs by " + INR.format(r2(taxOf(p) - taxOf(s))));
      else if (!near(p.igst, s.igst)) issues.push(p.igst ? "IGST in 2B, CGST and SGST in the books" : "CGST and SGST in 2B, IGST in the books");
      const bd = list[0];
      if (p.date && bd.date && p.date !== bd.date && days(p.date, bd.date) > 0) issues.push("date " + GSTAmend.dmy(p.date) + " in 2B, " + GSTAmend.dmy(bd.date) + " in Tally");
      if (tier >= 3 && p.noN !== bd.noN) issues.push("number " + p.no + " in 2B, " + bd.no + " in Tally");
      if (p.gstin && bd.gstin && p.gstin !== bd.gstin) issues.push("GSTIN " + p.gstin + " in 2B, " + bd.gstin + " in Tally");
      if (!bd.gstin) issues.push("no GSTIN in Tally for " + (bd.party || "the supplier") + "; 2B says " + p.gstin);
      if (list.length > 1) issues.push("booked in " + list.length + " vouchers");
      const timing = list.some(d => d.ym !== p.ym);
      const confirmed = st.confirm[p.key] === "yes";
      if (list.length > 1 && list.every(d => d.noN === list[0].noN && near(taxOf(d), taxOf(list[0])))) issues.push("the same bill booked " + list.length + " times");
      const status = (how === "probable" && !confirmed) ? "probable" : (issues.filter(x => !/^date |^booked in |^number |^value differs /.test(x)).length ? "diff" : "matched");
      pairs.push({p, books: list, sum: s, diff, issues, tier, how, status, timing, confirmed, manual: how === "manual"});
    };
    // a bill and its exact reversal (same supplier, number and tax, the other way) cancel out: set both aside,
    // so a bill booked, reversed and booked again at a revised value is matched on what is left
    const reversed = [];
    const rk = d => (d.gstin || d.party) + "|" + d.noN + "|" + Math.round(taxOf(d));
    const pos = new Map();
    books.filter(d => d.dir > 0 && d.noN).forEach(d => { const k = rk(d); (pos.get(k) || pos.set(k, []).get(k)).push(d); });
    // not when 2B has a credit note from the supplier for that tax: then it is the supplier's credit note, to be matched
    const cn2b = new Set(portal.filter(p => p.dir < 0).map(p => p.gstin + "|" + Math.round(taxOf(p))));
    books.filter(d => d.dir < 0 && d.noN && !cn2b.has(d.gstin + "|" + Math.round(taxOf(d)))).forEach(d => { const l = pos.get(rk(d)); const hit = l && l.find(z => !taken.has(z.id)); if (hit){ taken.add(hit.id); taken.add(d.id); reversed.push([hit, d]); } });
    // 0. what the user linked by hand, and what they said is not the same
    portal.forEach(p => {
      const ids = st.link[p.key];
      if (!ids || !ids.length) return;
      const list = ids.map(id => byId.get(id)).filter(d => d && free(d));
      if (list.length) pair(p, list, 0, "manual");
    });
    const rejected = (p, list) => list.some(d => st.confirm[p.key + ">" + d.id] === "no");
    const tiers = [
      // 1. same GSTIN, same number, same amounts
      p => { const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && d.noN === p.noN); const s = sumOf(c); return c.length && near(s.taxable, p.taxable) && near(taxOf(s), taxOf(p)) ? [c, 1, "exact"] : null; },
      // 2. same GSTIN, same number, amounts differ
      p => { const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && d.noN === p.noN); return c.length ? [c, 2, "number"] : null; },
      // 3. same GSTIN, the number written differently
      p => { const core = this.coreNo(p.no); const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && d.core === core && core !== "|"); return c.length ? [c, 3, "number"] : null; },
      // 3b. same GSTIN, one number the other with a prefix or suffix added ("39/2025-26" and "EXP/IN/39/2025-26")
      p => { const a = p.noN; if (a.length < 3) return null;
        const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && d.noN.length >= 3 && d.noN !== a && (d.noN.endsWith(a) || a.endsWith(d.noN) || d.noN.startsWith(a) || a.startsWith(d.noN)) && this.lastDigits(d.no) === this.lastDigits(p.no));
        return c.length ? [c, 3, "number"] : null; },
      // 4. same GSTIN and amounts, near in date, number different: to confirm
      p => { const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && near(d.taxable, p.taxable) && near(taxOf(d), taxOf(p)) && (!p.date || !d.date || days(p.date, d.date) <= 31));
        return c.length ? [[c.sort((a, x) => days(a.date, p.date) - days(x.date, p.date))[0]], 4, "probable"] : null; },
      // 5. another registration of the same supplier (same PAN)
      p => { const c = books.filter(d => free(d) && d.dir === p.dir && d.gstin && d.gstin !== p.gstin && pan(d.gstin) === pan(p.gstin) && (d.noN === p.noN || d.core === this.coreNo(p.no)));
        return c.length ? [[c[0]], 5, "probable"] : null; },
      // 6. no GSTIN in Tally: the same number and tax
      p => { const c = (byG.get("?") || []).filter(d => free(d) && d.dir === p.dir && (d.noN === p.noN || (d.core === this.coreNo(p.no) && this.lastDigits(d.no) === this.lastDigits(p.no))) && near(taxOf(d), taxOf(p)));
        return c.length ? [[c[0]], 6, "probable"] : null; },
      // 7. no GSTIN in Tally and no invoice number: a similar name, the same tax, near in date
      p => { const c = (byG.get("?") || []).filter(d => free(d) && d.dir === p.dir && near(taxOf(d), taxOf(p)) && near(d.taxable, p.taxable) && (!p.date || !d.date || days(p.date, d.date) <= 31) && nameSim(d.party, p.party) >= 0.6);
        return c.length ? [[c.sort((a, x) => nameSim(x.party, p.party) - nameSim(a.party, p.party))[0]], 7, "probable"] : null; }
    ];
    tiers.forEach(tier => portal.forEach(p => {
      if (used2b.has(p.key) || p.sec === "impg") return;
      const hit = tier(p);
      if (!hit) return;
      const [list, t, how] = hit;
      if (rejected(p, list)) return;
      if (how === "probable" && st.confirm[p.key] === "no") return;
      pair(p, list, t, how);
    }));
    // imports: by bill of entry number, else by IGST
    portal.filter(p => p.sec === "impg" && !used2b.has(p.key)).forEach(p => {
      const c = books.filter(d => free(d) && d.dir === 1 && (d.noN === p.noN || (!d.gstin && near(d.igst, p.igst) && d.igst > 0)));
      if (c.length && !rejected(p, [c[0]])) pair(p, [c[0]], c[0].noN === p.noN ? 2 : 4, c[0].noN === p.noN ? "number" : "probable");
    });
    // rejected in IMS: found in Tally by supplier and number (or number written differently), else on its own
    const rejList = [];
    rejRows.forEach(p => {
      const c = (byG.get(p.gstin) || []).filter(d => free(d) && d.dir === p.dir && (d.noN === p.noN || (d.core === this.coreNo(p.no) && this.coreNo(p.no) !== "|")));
      c.forEach(d => taken.add(d.id));
      rejList.push({p, books: c, sum: sumOf(c)});
    });
    const only2b = portal.filter(p => !used2b.has(p.key));
    const onlyBooks = books.filter(d => !taken.has(d.id));
    // the same supplier's bill, same number and tax, booked more than once
    const dupes = {}, dk = {};
    const revIds = new Set(reversed.flat().map(d => d.id));
    books.forEach(d => { if (!d.noN || revIds.has(d.id)) return; const k = (d.gstin || d.party) + "|" + d.noN + "|" + d.dir + "|" + Math.round(taxOf(d)); (dk[k] = dk[k] || []).push(d); });
    Object.values(dk).filter(l => l.length > 1 && taxOf(l[0]) > 0).forEach(l => l.forEach((d, i) => { dupes[d.id] = {n: l.length, first: i === 0, others: l.filter(z => z !== d).map(z => z.voucher + " of " + GSTAmend.dmy(z.bookDate))}; }));
    // a bill in 2B and in Tally, but booked with no input tax (the tax charged to the expense)
    const docIds = new Set(books.map(d => d.id)), gstMap = b.gstins || {};
    const noCredit = new Map();
    (b.vouchers || []).forEach(v => { if (docIds.has(v.id) || Books.isSale(v) || v.cancel) return; const k = this.normNo(v.ref || v.no); if (k.length >= 3) (noCredit.get(k) || noCredit.set(k, []).get(k)).push(v); });
    portal.forEach(p => { delete p.bookedNoCredit; });
    only2b.forEach(p => {
      const c = (noCredit.get(p.noN) || []).filter(v => (!p.date || days(p.date, v.date) <= 62) && (!gstMap[v.party] || String(gstMap[v.party]).toUpperCase() === p.gstin || pan(gstMap[v.party]) === pan(p.gstin)));
      if (c.length){ const v = c[0]; p.bookedNoCredit = {id: v.id, type: v.type, no: v.no, date: v.date, party: v.party}; }
    });
    const res = {pairs, only2b, onlyBooks, portal, books, taxOf, dupes, reversed, rejected: rejList, loaded: this.all2b(reg).map(t => t.ym)};
    this._memo = {key, v: b.vouchers, res};
    return res;
  },
  // the part of the result that belongs to the months chosen
  scope(reg, months){
    const r = this.run(reg), inM = ym => !months || months.includes(ym);
    const pairs = r.pairs.filter(x => inM(x.p.ym) || x.books.some(d => inM(d.ym)));
    const lastLoaded = r.loaded[r.loaded.length - 1] || "";
    return {all: r, pairs, matched: pairs.filter(x => x.status === "matched"), diff: pairs.filter(x => x.status === "diff"), probable: pairs.filter(x => x.status === "probable"),
      timing: pairs.filter(x => x.timing), only2b: r.only2b.filter(p => inM(p.ym)), onlyBooks: r.onlyBooks.filter(d => inM(d.ym)),
      laterMissing: r.onlyBooks.filter(d => inM(d.ym) && d.ym >= lastLoaded).length, taxOf: r.taxOf, reversed: (r.reversed || []).filter(pr => pr.some(d => inM(d.ym))), rejected: (r.rejected || []).filter(x => inM(x.p.ym) || x.books.some(d => inM(d.ym)))};
  },
  totals(list, f){ return list.reduce((a, x) => { const o = f ? f(x) : x; return {n: a.n + 1, taxable: r2(a.taxable + num(o.taxable) * (o.dir || 1)), tax: r2(a.tax + (num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess)) * (o.dir || 1))}; }, {n: 0, taxable: 0, tax: 0}); },
  // supplier by supplier, 2B against the books
  suppliers(sc){
    const m = {};
    const get = (g, name) => { const k = g || "no GSTIN: " + (name || ""); return m[k] = m[k] || {gstin: g, party: name || "", t2b: 0, tbk: 0, matched: 0, diff: 0, probable: 0, only2b: 0, onlyBooks: 0, pairs: [], p2b: [], pbk: []}; };
    const tx = o => (num(o.igst) + num(o.cgst) + num(o.sgst) + num(o.cess)) * (o.dir || 1);
    sc.pairs.forEach(x => { const s = get(x.p.gstin, x.p.party); s.t2b = r2(s.t2b + tx(x.p)); s.tbk = r2(s.tbk + tx(Object.assign({dir: x.p.dir}, x.sum))); s[x.status]++; s.pairs.push(x); });
    sc.only2b.forEach(p => { const s = get(p.gstin, p.party); s.t2b = r2(s.t2b + tx(p)); s.only2b++; s.p2b.push(p); });
    sc.onlyBooks.forEach(d => { const s = get(d.gstin, d.party); if (!s.party) s.party = d.party; s.tbk = r2(s.tbk + tx(d)); s.onlyBooks++; s.pbk.push(d); });
    return Object.values(m).map(s => Object.assign(s, {gap: r2(s.t2b - s.tbk)})).sort((a, c) => Math.abs(c.gap) - Math.abs(a.gap));
  },
  // what to send a supplier whose invoices are not in 2B
  followUp(s){
    const co = CO();
    return "Dear " + (s.party || "Sir/Madam") + ",\n\nThe following invoices issued to " + co.name + (co.gstin ? " (GSTIN " + co.gstin + ")" : "") +
      " are in our books but do not appear in our GSTR-2B. Please report them in your GSTR-1 / IFF, or let us know if any detail differs:\n\n" +
      s.pbk.map((d, i) => (i + 1) + ". Invoice " + d.no + " dated " + GSTAmend.dmy(d.date) + ", taxable " + INR.format(d.taxable) + ", tax " + INR.format(r2(d.igst + d.cgst + d.sgst + d.cess))).join("\n") +
      "\n\nRegards";
  },
  async toExcel(sc, label){
    await ensureXlsx();
    const d = s => String(s).length === 8 ? String(s).slice(6, 8) + "-" + String(s).slice(4, 6) + "-" + String(s).slice(0, 4) : s;
    const rate = x => x.taxable ? Math.round((num(x.igst) + num(x.cgst) + num(x.sgst)) / num(x.taxable) * 100) : "";
    const head = ["AS PER GST-2B", "", "", "", "", "", "", "", "", "", "AS PER TALLY", "", "", "", "", "", "DIFFERENCE", "", "", "", "", ""];
    const cols = ["GSTIN NO.", "PARTY NAME", "INV. NO.", "INV DATE", "INV VALUE", "RATE", "TAXABLE", "IGST", "CGST", "SGST", "INV. NO.", "INV DATE", "TAXABLE", "IGST", "CGST", "SGST",
      "TAXABLE", "IGST", "CGST", "SGST", "Remarks", "2B month / Tally month"];
    const remark = x => x.status === "matched" ? (x.timing ? "Matched, different month" : "Matched") : x.status === "probable" ? "To confirm: " + x.issues.join("; ") : "Difference: " + x.issues.join("; ");
    const line = x => [x.p.gstin, x.p.party, x.p.no, d(x.p.date), x.p.val, rate(x.p), x.p.taxable, x.p.igst, x.p.cgst, x.p.sgst,
      x.books.map(b => b.no).join(", "), d(x.books[0].date), x.sum.taxable, x.sum.igst, x.sum.cgst, x.sum.sgst, x.diff.taxable, x.diff.igst, x.diff.cgst, x.diff.sgst, remark(x),
      GSTR.label(x.p.ym) + " / " + Array.from(new Set(x.books.map(b => GSTR.label(b.ym)))).join(", ")];
    const wb = XLSX.utils.book_new();
    const sheet = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name.slice(0, 31));
    const st = this.state();
    sheet("B2B", [head, cols].concat(sc.pairs.filter(x => x.p.dir === 1 && !/^cdnr/.test(x.p.sec)).map(line)));
    sheet("CDNR", [head, cols].concat(sc.pairs.filter(x => /^cdnr/.test(x.p.sec)).map(line)));
    sheet("ITC Taken But Not Shown In 2B", [["GSTIN NO.", "PARTY NAME", "INV. NO.", "INV DATE", "VCH NO.", "VCH TYPE", "RATE", "TAXABLE", "IGST", "CGST", "SGST", "Remarks", "Note"]]
      .concat(sc.onlyBooks.map(x => [x.gstin || "not in Tally", x.party, x.no, d(x.date), x.voucher, x.type, rate(x), x.taxable, x.igst, x.cgst, x.sgst, x.gstin ? "ITC BOOKED IN TALLY" : "ITC BOOKED, NO GSTIN IN TALLY", ((st.tag[x.id] || {}).tag || "")])));
    sheet("In 2B Not In Books", [["GSTIN NO.", "PARTY NAME", "INV. NO.", "INV DATE", "INV VALUE", "RATE", "TAXABLE", "IGST", "CGST", "SGST", "2B month", "Section", "ITC available", "Reason", "IMS", "Supplier filed", "Remarks"]]
      .concat(sc.only2b.map(x => [x.gstin, x.party, x.no, d(x.date), x.val, rate(x), x.taxable, x.igst, x.cgst, x.sgst, GSTR.label(x.ym), x.sec, x.itcavl, this.RSN[x.rsn] || x.rsn, this.IMS[x.ims] || x.ims, x.filedOn,
        ((st.tag[x.key] || {}).tag || "ITC NOT TAKEN")])));
    sheet("Suppliers", [["GSTIN", "Supplier", "Tax in 2B", "Tax in Tally", "Gap", "Matched", "Differences", "To confirm", "In 2B only", "In Tally only"]]
      .concat(this.suppliers(sc).map(s => [s.gstin || "", s.party, s.t2b, s.tbk, s.gap, s.matched, s.diff, s.probable, s.only2b, s.onlyBooks])));
    const out = XLSX.write(wb, {bookType: "xlsx", type: "array"});
    saveFile(CO().name.replace(/[^A-Za-z0-9]+/g, "-") + "-2B-reco-" + String(label || "").replace(/[^A-Za-z0-9]+/g, "-") + ".xlsx", new Blob([out], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
  }
};


