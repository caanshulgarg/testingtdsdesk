/* ================================================================== */
/* Returns for GSTINs that are not monthly filers                     */
/*  QRMP: IFF (months 1-2, optional), PMT-06 (months 1-2), GSTR-1 and */
/*        GSTR-3B for the quarter                                     */
/*  Composition: CMP-08 each quarter, GSTR-4 for the year             */
/* ================================================================== */
const GSTQ = {
  H: ["igst", "cgst", "sgst", "cess"],
  z(){ return {taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, n: 0}; },
  add(a, x){ const o = Object.assign({}, a); ["taxable", "igst", "cgst", "sgst", "cess", "n", "total", "ineligible"].forEach(k => { if (x && x[k] != null && typeof x[k] === "number") o[k] = r2(num(o[k]) + x[k]); }); return o; },
  months(qEnd){ const all = GSTR.months(); return GSTR.expand(GSTSet.qStart(qEnd) + "-" + qEnd).filter(m => all.includes(m)); },
  // ---- QRMP ----
  // 3B for the quarter: the three months added together, the credit set off once at the end,
  // and what was deposited by PMT-06 in the first two months used before any more cash is asked for
  threeBQ(qEnd, reg){
    const ms = this.months(qEnd), ts = ms.map(m => GSTR.threeBm(m, reg)), sum = k => ts.reduce((a, t) => this.add(a, t[k] || {}), this.z());
    const keys = ["sale", "cn", "net", "adv", "zero", "nil", "nongst", "rcmOut", "rcmIn", "toUnreg", "impGoods", "impServ", "other", "blocked", "buy", "itc", "reversal", "rev1", "rev2", "reclaim", "na", "rules", "r42", "r43", "held", "released", "cn2b", "rejBack", "netItc"];
    const t = {quarter: true, months: ms, qEnd, basis: (ts[ts.length - 1] || {}).basis || "no 2B"};
    keys.forEach(k => { t[k] = sum(k); });
    t.inw5 = ts.reduce((a, x) => { Object.keys(x.inw5 || {}).forEach(k => { a[k] = r2((a[k] || 0) + num(x.inw5[k])); }); return a; }, {});
    const up = {}; ts.forEach(x => (x.unregPos || []).forEach(p => { const o = up[p.pos] = up[p.pos] || {pos: p.pos, taxable: 0, igst: 0}; o.taxable = r2(o.taxable + p.taxable); o.igst = r2(o.igst + p.igst); }));
    t.unregPos = Object.values(up).sort((a, c) => a.pos.localeCompare(c.pos));
    t.custRej = {add: ts.reduce((a, x) => this.add(a, (x.custRej || {}).add || {}), this.z()), back: ts.reduce((a, x) => this.add(a, (x.custRej || {}).back || {}), this.z())};
    t.r37 = {rev: ts.reduce((a, x) => this.add(a, (x.r37 || {}).rev || {}), this.z()), re: ts.reduce((a, x) => this.add(a, (x.r37 || {}).re || {}), this.z())};
    t.ineligible = r2(ts.reduce((a, x) => a + num(x.ineligible), 0));
    t.opening = GSTR.creditIn(ms[0] || qEnd, reg);
    t.pay = GSTR.setOff(t.net, t.rcmOut, t.netItc, t.opening);
    // PMT-06 deposits of the quarter's first two months are in the cash ledger: they pay first
    const dep = this.deposited(qEnd, reg); t.pmt = dep;
    t.cashAfter = {}; t.pmtLeft = {};
    this.H.forEach(h => { t.cashAfter[h] = r2(Math.max(0, num(t.pay.cash[h]) - num(dep[h]))); t.pmtLeft[h] = r2(Math.max(0, num(dep[h]) - num(t.pay.cash[h]))); });
    t.payable = r2(this.H.reduce((a, h) => a + t.cashAfter[h], 0));
    return t;
  },
  deposited(qEnd, reg){ const d = {igst: 0, cgst: 0, sgst: 0, cess: 0}; GSTR.expand(GSTSet.qStart(qEnd) + "-" + qEnd).filter(m => m !== qEnd).forEach(m => { const p = (GSTF.peek(m, reg).pmt06 || {}); this.H.forEach(h => { d[h] = r2(d[h] + num(p[h])); }); }); return d; },
  // PMT-06 for a quarter's first or second month. Fixed sum: 35% of the cash paid in the last quarter's 3B,
  // or all of the cash paid in the last month if that was a monthly return. Self-assessment: the month's tax after its credit.
  pmt06(ym, reg){
    const rec = GSTF.peek(ym, reg), method = rec.pmtMethod || GSTSet.peek(reg).pmt || "fixed", prevEnd = this.prevYm(GSTSet.qStart(ym)), have = GSTR.months().includes(prevEnd);
    let amt = {igst: 0, cgst: 0, sgst: 0, cess: 0}, why = "", known = true;
    if (method === "fixed"){
      if (!have){ known = false; why = "the return before this quarter is not in the books; the portal shows the amount"; }
      else { const prevQ = GSTSet.typeOf(prevEnd, reg) === "qrmp", t = GSTR.threeB(prevEnd, reg), f = prevQ ? 0.35 : 1;
        this.H.forEach(h => { amt[h] = Math.round(num(t.pay.cash[h]) * f); });
        why = prevQ ? "35% of the cash paid in the 3B for " + GSTSet.qLabel(prevEnd) : "the cash paid in the 3B for " + GSTR.label(prevEnd) + " (a monthly return)"; }
    } else { const t = GSTR.threeBm(ym, reg); this.H.forEach(h => { amt[h] = Math.max(0, Math.round(num(t.pay.cash[h]))); }); why = "the month\u2019s tax less its credit"; }
    const total = this.H.reduce((a, h) => a + amt[h], 0), paid = rec.pmt06 || {};
    return {method, amt, total, why, known, due: GSTF.due(ym, "pmt06", reg), paid, paidTotal: r2(this.H.reduce((a, h) => a + num(paid[h]), 0))};
  },
  prevYm(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 1 ? (y - 1) + "12" : y + String(m - 1).padStart(2, "0"); },
  // IFF: the month's invoices and notes to registered customers, optional, at most Rs 50 lakh of value a month;
  // above that, documents go in date order up to the limit and the rest wait for the quarter's GSTR-1
  LIMIT: 5000000,
  key(ctin, num){ return String(ctin || "").toUpperCase() + "|" + GST2B.normNo(num); },
  iff(ym, reg){
    const j = GSTR.toJson(ym, reg, {plain: true}), out = {gstin: j.gstin, fp: j.fp, version: j.version, hash: j.hash};
    const docs = [], dt = d => { const p = String(d || "").split("-"); return p.length === 3 ? p[2] + p[1] + p[0] : ""; };
    (j.b2b || []).forEach(g => (g.inv || []).forEach(i => docs.push({sec: "b2b", ctin: g.ctin, g, x: i, num: i.inum, d: dt(i.idt), val: num(i.val)})));
    (j.cdnr || []).forEach(g => (g.nt || []).forEach(i => docs.push({sec: "cdnr", ctin: g.ctin, g, x: i, num: i.nt_num, d: dt(i.nt_dt), val: num(i.val)})));
    docs.sort((a, c) => a.d.localeCompare(c.d) || String(a.num).localeCompare(String(c.num)));
    // request of 02-Oct-2026: no longer cut at Rs 50 lakh (the Jan-2026 IFF of Testing AAD went through at 55,53,800 of
    // taxable value); above the limit the screen warns, and the documents can still go in the quarter's GSTR-1 instead
    const sg = x => x.sec === "cdnr" && String(x.x.ntty || "C").toUpperCase() === "C" ? -1 : 1;
    docs.forEach(x => { x.txval = r2((x.x.itms || []).reduce((a, it) => a + num((it.itm_det || {}).txval), 0)); x.s = sg(x); });
    let run = 0; const inc = docs.slice(), left = [];
    inc.forEach(x => { run += x.val; });
    const group = (sec, inner) => { const m = new Map(); inc.filter(x => x.sec === sec).forEach(x => { const o = m.get(x.ctin) || Object.assign({}, x.g, {[inner]: []}); o[inner].push(x.x); m.set(x.ctin, o); }); return Array.from(m.values()); };
    const b2b = group("b2b", "inv"), cdnr = group("cdnr", "nt"); if (b2b.length) out.b2b = b2b; if (cdnr.length) out.cdnr = cdnr;
    const taxOf = x => (x.x.itms || []).reduce((a, it) => { const d = it.itm_det || {}; return a + num(d.iamt) + num(d.camt) + num(d.samt) + num(d.csamt); }, 0);
    const taxable = r2(inc.reduce((a, x) => a + x.s * x.txval, 0));
    return {json: out, keys: inc.map(x => this.key(x.ctin, x.num)), n: inc.filter(x => x.sec === "b2b").length, notes: inc.filter(x => x.sec === "cdnr").length,
      val: r2(run), taxable, tax: r2(inc.reduce((a, x) => a + x.s * taxOf(x), 0)), all: docs.length, allVal: r2(docs.reduce((a, x) => a + x.val, 0)), left: left.length,
      over: taxable > this.LIMIT, docs: inc.map(x => ({key: this.key(x.ctin, x.num), sec: x.sec, ctin: x.ctin, num: x.num, d: x.d, val: r2(x.val), txval: x.txval, tax: r2(taxOf(x))}))};
  },
  // GSTR-1 for the quarter: everything in it, less the invoices and notes already sent in an IFF
  r1Q(qEnd, reg){
    // the documents sent in each IFF filed: as recorded when it was downloaded, else worked out again the same way
    const qs = GSTSet.qStart(qEnd), j = GSTR.toJson(qs + "-" + qEnd, reg), skip = new Set(GSTR.expand(qs + "-" + qEnd).filter(m => m !== qEnd && this.iffFiled(m, reg)));
    const sent = new Set(); skip.forEach(m => { const r = GSTF.peek(m, reg); (r.iffDocs ? Object.keys(r.iffDocs) : r.iffKeys || this.iff(m, reg).keys).forEach(k => sent.add(k)); });
    if (sent.size){
      if (j.b2b) j.b2b = j.b2b.map(g => Object.assign({}, g, {inv: g.inv.filter(i => !sent.has(this.key(g.ctin, i.inum)))})).filter(g => g.inv.length);
      if (j.cdnr) j.cdnr = j.cdnr.map(g => Object.assign({}, g, {nt: g.nt.filter(i => !sent.has(this.key(g.ctin, i.nt_num)))})).filter(g => g.nt.length);
      if (j.b2b && !j.b2b.length) delete j.b2b; if (j.cdnr && !j.cdnr.length) delete j.cdnr;
    }
    return {json: j, skipped: Array.from(skip)};
  },
  // an IFF counts only when it was filed (a filing date or its ARN) by its due date: the portal closes it after the 13th.
  // "IFF not filed" (iffSkip) says so on purpose: its documents go in the quarter's GSTR-1
  iffFiled(ym, reg){ return this.iffState(ym, reg).s === "filed"; },
  iffState(ym, reg){
    const r = GSTF.peek(ym, reg), due = GSTF.due(ym, "iff", reg), v = typeof GSTV === "object" ? GSTV.copies(reg, "iff", ym)[0] : null;
    const on = r.iff || (v && v.arnDate) || "", arn = r.iffArn || (v && v.arn) || "";
    if (r.iffSkip) return {s: "skipped", due, on: "", arn: ""};
    if (on && on > due) return {s: "late", due, on, arn};
    if (on || arn) return {s: "filed", due, on, arn};
    return {s: GSTF.today() > due ? "missed" : "open", due, on: "", arn: ""};
  },
  // the documents of a filed IFF, as they were when it was filed, against the books now: a document changed or gone
  // since needs an amendment in a later GSTR-1 (table 9A for an invoice, 9C for a note); one added since goes in the
  // quarter's GSTR-1 as a new document
  iffChanges(ym, reg){
    const was = GSTF.peek(ym, reg).iffDocs; if (!was) return null;
    const now = new Map(this.iff(ym, reg).docs.map(x => [x.key, x])), changed = [], gone = [], added = [];
    Object.entries(was).forEach(([k, x]) => { const n = now.get(k); if (!n) gone.push(Object.assign({key: k}, x));
      else if (Math.abs(num(n.txval) - num(x.txval)) >= 0.5 || Math.abs(num(n.tax) - num(x.tax)) >= 0.5) changed.push(Object.assign({key: k, was: x}, n)); });
    now.forEach((n, k) => { if (!was[k]) added.push(n); });
    return {changed, gone, added, n: changed.length + gone.length};
  },
  // the documents of the IFF recorded when it is marked filed (a date or ARN typed, or the PDF kept)
  iffSnap(ym, reg){ const r = GSTF.rec(ym, reg); if (r.iffDocs) return false; const f = this.iff(ym, reg); r.iffDocs = {}; f.docs.forEach(x => { r.iffDocs[x.key] = {sec: x.sec, num: x.num, d: x.d, txval: x.txval, tax: x.tax}; }); r.iffSnapAt = new Date().toISOString(); return true; },
  // the quarter on one page (request of 02-Oct-2026): the first and second months' IFF, the third month's GSTR-1 for the
  // quarter (what the IFFs did not carry), and the quarter: counts, taxable value net of notes, tax, status, the figures as
  // filed (the PDFs, or typed), PMT-06; and the check that the quarter's total is 3B 3.1(a)
  quarter(qEnd, reg){
    const qs = GSTSet.qStart(qEnd), ms = GSTR.expand(qs + "-" + qEnd), fx = (f, per) => typeof GSTX === "object" ? GSTX.fig(reg, f, per) : null;
    const cols = ms.filter(m => m !== qEnd).map(m => {
      const f = this.iff(m, reg), st = this.iffState(m, reg), fig = fx("iff", m), p = this.pmt06(m, reg), sent = st.s === "filed";
      return {m, kind: "iff", label: "IFF " + GSTR.label(m), due: st.due, state: st, n: f.n, notes: f.notes, b2c: 0, taxable: f.taxable, tax: f.tax, over: f.over,
        inFile: sent || st.s === "open", toQuarter: !sent && st.s !== "open", filed: fig && fig.tl ? fig.tl.taxable : null, filedSrc: fig ? fig.source : "",
        pmt: p, changes: this.iffChanges(m, reg), file: "IFF_" + (f.json.gstin || "") + "_" + f.json.fp + ".json"};
    });
    // the third month: the quarter's GSTR-1 less what the filed IFFs carried
    const r1 = this.r1Q(qEnd, reg), j = r1.json, cnt = k => (j[k] || []).reduce((a, g) => a + (g.inv || g.nt || []).length, 0);
    const tx = k => (j[k] || []).reduce((a, g) => a + (g.inv || g.nt || []).reduce((b, i) => b + (k === "cdnr" && String(i.ntty || "C").toUpperCase() === "C" ? -1 : 1) * (i.itms || []).reduce((c, it) => c + num((it.itm_det || {}).txval), 0), 0), 0);
    const b2cs = (j.b2cs || []).reduce((a, x) => a + num(x.txval), 0), b2cl = tx("b2cl"), exp = (j.exp || []).reduce((a, g) => a + (g.inv || []).reduce((b, i) => b + (i.itms || []).reduce((c, it) => c + num(it.txval), 0), 0), 0);
    const tax = k => (j[k] || []).reduce((a, g) => a + (g.inv || g.nt || []).reduce((b, i) => b + (k === "cdnr" && String(i.ntty || "C").toUpperCase() === "C" ? -1 : 1) * (i.itms || []).reduce((c, it) => { const d = it.itm_det || {}; return c + num(d.iamt) + num(d.camt) + num(d.samt) + num(d.csamt); }, 0), 0), 0);
    const b2csTax = (j.b2cs || []).reduce((a, x) => a + num(x.iamt) + num(x.camt) + num(x.samt) + num(x.csamt), 0);
    // advances received and not yet invoiced (table 11A) less those adjusted against invoices (11B): in 3.1(a) too
    const advOf = k => (j[k] || []).reduce((a, g) => a + (g.itms || []).reduce((b, it) => b + num(it.ad_amt), 0), 0);
    // advances marked as adjusted with no invoice to the customer in the quarter: not in 11B (GSTAdv.month), listed apart
    let um = []; try { um = GSTAdv.ready() ? GSTAdv.month(qs + "-" + qEnd, reg).unmatched : []; } catch (e){ um = []; }
    const st3 = GSTF.peek(qEnd, reg), fig3 = fx("r1", qEnd);
    const m3 = {m: qEnd, kind: "r1", label: "GSTR-1 " + GSTSet.qLabel(qEnd), due: GSTF.due(qEnd, "r1", reg), state: {s: st3.r1 ? "filed" : GSTF.today() > GSTF.due(qEnd, "r1", reg) ? "missed" : "open", on: st3.r1 || "", arn: st3.r1Arn || ""},
      n: cnt("b2b"), notes: cnt("cdnr"), b2b: r2(tx("b2b")), cdnr: r2(tx("cdnr")), b2cs: r2(b2cs), b2cl: r2(b2cl), exp: r2(exp), b2c: r2(b2cs + b2cl),
      adv: r2(advOf("at") - advOf("txpd")), advAt: r2(advOf("at")), advTxpd: r2(advOf("txpd")), advUnmatched: um,
      taxable: r2(tx("b2b") + tx("cdnr") + b2cs + b2cl + exp + advOf("at") - advOf("txpd")), tax: r2(tax("b2b") + tax("cdnr") + tax("b2cl") + b2csTax), skipped: r1.skipped,
      filed: fig3 && fig3.tl ? fig3.tl.taxable : null, filedSrc: fig3 ? fig3.source : "", file: "GSTR1_" + (j.gstin || "") + "_" + j.fp + ".json"};
    // FinCom's total: the IFFs that carry their documents and the GSTR-1; 3B 3.1(a) worked out for the quarter
    const t = GSTR.threeB(qEnd, reg), fig3b = fx("r3b", qEnd);
    const total = r2(cols.filter(c => c.inFile).reduce((a, c) => a + c.taxable, 0) + m3.taxable);
    const filedParts = cols.map(c => c.filed).concat([m3.filed]), filedAll = filedParts.every(v => v != null);
    const filedTotal = filedAll ? r2(filedParts.reduce((a, v) => a + num(v), 0)) : null;
    const r3a = r2(t.net.taxable), r3aFiled = fig3b && fig3b.a ? num(fig3b.a.taxable) : null;
    return {qEnd, qs, label: GSTSet.qLabel(qEnd), cols, m3, total, r3a, diff: r2(total - r3a), filedTotal, r3aFiled, filedDiff: filedTotal != null && r3aFiled != null ? r2(filedTotal - r3aFiled) : null,
      threeB: t, pmtPaid: t.pmt, payable: t.payable, due3b: GSTF.due(qEnd, "r3b", reg), r3bOn: st3.r3b || "", file3b: "GSTR3B_" + ((GSTR.gstins(S.books) || []).find(x => !reg || x.slice(0, 2) === reg) || "") + "_" + qEnd.slice(4, 6) + qEnd.slice(0, 4) + ".json"};
  },
  // the filing type of one quarter only (request of 02-Oct-2026): the quarter's own line in the filing history, and the
  // type before it put back from the next quarter on
  setQuarterType(ym, reg, type){
    const qs = GSTSet.qStart(ym), next = this.nextYm(GSTSet.qEnd(ym)), before = GSTSet.typeOf(next, reg), st = GSTSet.store(reg);
    let h = (st.filing || []).filter(x => x.from !== qs);
    h.push({from: qs, type});
    if (!h.some(x => x.from === next)) h.push({from: next, type: before});
    h = h.sort((a, c) => a.from.localeCompare(c.from)).filter((x, i, a) => i === 0 || x.type !== a[i - 1].type);
    st.filing = h; GSTR._carry = null;
  },
  nextYm(ym){ const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 12 ? (y + 1) + "01" : y + String(m + 1).padStart(2, "0"); },
  // ---- Composition ----
  RATES: {mfr: {l: "Manufacturer: 1% of turnover", r: 1, base: "all"}, trader: {l: "Trader: 1% of turnover of taxable supplies", r: 1, base: "taxable"}, rest: {l: "Restaurant: 5% of turnover", r: 5, base: "all"}, serv: {l: "Services (notification 2/2019): 6% of turnover", r: 6, base: "all"}},
  compCat(reg){ return GSTSet.peek(reg).comp || "trader"; },
  cmp08(qEnd, reg){
    const ms = this.months(qEnd), cat = this.RATES[this.compCat(reg)];
    let all = 0, taxable = 0, exempt = 0;
    ms.forEach(m => GSTR.outward(m, reg).forEach(r => { const s = r.kind === "CDNR" ? -1 : 1; all += s * num(r.taxable); if (r.cls === "taxable") taxable += s * num(r.taxable); else exempt += s * num(r.taxable); }));
    const turnover = r2(cat.base === "all" ? all : taxable), tax = r2(turnover * cat.r / 100), half = r2(tax / 2);
    const rcm = ms.reduce((a, m) => this.add(a, GSTR.threeBm(m, reg).rcmOut), this.z());
    const rec = GSTF.peek(qEnd, reg), due = GSTF.due(qEnd, "cmp08", reg), upto = rec.cmp08 || "", late = upto ? Math.max(0, GSTF.days(due, upto)) : 0;
    const payable = r2(tax + rcm.igst + rcm.cgst + rcm.sgst + rcm.cess), interest = r2(payable * 0.18 * late / 365);
    return {months: ms, cat, all: r2(all), taxable: r2(taxable), exempt: r2(exempt), turnover, tax, cgst: half, sgst: r2(tax - half), rcm, payable, due, filed: upto, late, interest};
  },
  gstr4(fy, reg){
    const y = +fy.slice(0, 4), ms = GSTR.months().filter(m => m >= y + "04" && m <= (y + 1) + "03");
    const t4 = {reg: this.z(), regRcm: this.z(), unregRcm: this.z(), imps: this.z()};
    ms.forEach(m => GSTR.inward(m, reg).forEach(r0 => { const r = GSTR.signedIn(r0), k = r.import && r.supply !== "Goods" ? "imps" : r.rcm ? (r.gstin ? "regRcm" : "unregRcm") : r.gstin ? "reg" : null; if (k) t4[k] = this.add(t4[k], Object.assign({}, r, {n: 1})); }));
    const quarters = Array.from(new Set(ms.map(m => GSTSet.qEnd(m)))).map(q => Object.assign({q, label: GSTSet.qLabel(q)}, this.cmp08(q, reg)));
    const sumQ = k => r2(quarters.reduce((a, x) => a + num(typeof x[k] === "object" ? 0 : x[k]), 0));
    return {fy, months: ms, t4, quarters, turnover: sumQ("turnover"), tax: sumQ("tax"), rcm: quarters.reduce((a, x) => this.add(a, x.rcm), this.z()), interest: sumQ("interest"), due: (y + 1) + "-06-30"};
  },
  apiMode(){ return ((S.books || {}).gstApi) || "save"; }
};
// the QRMP, CMP-08 and GSTR-4 pages: React (app/src/screens/gst/Periodic.jsx)
// a date or choice kept for a month (or quarter end) and GSTIN: IFF filed on, PMT-06 method, CMP-08 filed on
function gqSetField(k, v, ym){ const r = GSTF.rec(ym || S.gstYm || "", S.gstReg || ""); if (v === "") delete r[k]; else r[k] = v; GSTR._carry = null; saveBooks(); render(); }
// PMT-06 paid, head by head
function gqSetPaid(k, v){ const r = GSTF.rec(S.gstYm || "", S.gstReg || ""); r.pmt06 = Object.assign({}, r.pmt06, {[k]: v === "" ? 0 : num(v)}); GSTR._carry = null; saveBooks(); render(); }
// the IFF file for the month; a copy is kept so the quarter's GSTR-1 leaves these invoices out once filed
function gqIffJson(){
  const ym = S.gstYm || "", reg = S.gstReg || "";
  if (typeof ledgersReady === "function" && !ledgersReady("gst")) return;
  const f = GSTQ.iff(ym, reg); GSTF.rec(ym, reg).iffKeys = f.keys;
  try { GSTAmend.keep(JSON.parse(JSON.stringify(f.json)), "downloaded", {iff: true}); } catch (e2){}
  saveBooks(); saveFile("IFF_" + f.json.gstin + "_" + f.json.fp + ".json", new Blob([JSON.stringify(f.json)], {type: "application/json"}));
}

// IFF: filed (a date or ARN: its documents are recorded then), or not filed on purpose (they go in the quarter's GSTR-1)
function gqIffFiled(ym, k, v){ const reg = S.gstReg || "", r = GSTF.rec(ym, reg); if (v === "") delete r[k]; else { r[k] = v; delete r.iffSkip; GSTQ.iffSnap(ym, reg); } GSTR._carry = null; saveBooks(); render(); }
function gqIffSkip(ym, on){ const r = GSTF.rec(ym, S.gstReg || ""); if (on){ r.iffSkip = new Date().toISOString(); delete r.iff; delete r.iffArn; delete r.iffDocs; } else delete r.iffSkip; GSTR._carry = null; saveBooks(); render(); }
function gqQuarterType(type){ GSTQ.setQuarterType(S.gstYm || "", S.gstReg || "", type); saveBooks(); render(); }
