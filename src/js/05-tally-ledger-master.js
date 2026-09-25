/* ================================================================== */
/* Tally ledger master: which ledgers are GST and TDS, confirmed once */
/* ================================================================== */
const LedMaster = {
  WHAT: [
    ["gst", "GST", "gst"], ["gst_rcm", "GST, reverse charge", "gst"], ["gst_import", "GST on imports", "gst"], ["gst_common", "GST, common credit (rule 42)", "gst_common"],
    ["ineligible", "GST, ITC not to be taken", "ineligible"], ["gst_control", "GST control or provisional account", "tax_other"], ["gst_setoff", "GST set-off or electronic ledger", "tax_other"],
    ["gst_interest", "GST interest or late fee", "tax_other"],
    ["tds_payable", "TDS payable", "tds_payable"], ["tds_clearing", "TDS clearing: month-end transfer, then paid", "tds_clearing"], ["tds_receivable", "TDS receivable", "tds_receivable"], ["tcs_payable", "TCS payable", "tcs_payable"], ["tcs_receivable", "TCS receivable", "tcs_receivable"],
    ["tds_interest", "TDS interest or late fee", "tax_other"], ["bank", "Bank or cash", "bank"], ["roundoff", "Round off", "roundoff"], ["none", "Not a tax ledger", ""]],
  isGst(w){ return /^gst|^ineligible$/.test(w || ""); },
  isTds(w){ return /^tds_|^tcs_/.test(w || ""); },
  kindOf(w){ const x = this.WHAT.find(z => z[0] === w); return x ? x[2] : ""; },
  label(w){ const x = this.WHAT.find(z => z[0] === w); return x ? x[1] : "\u2014"; },
  // a ledger that should be in one of the two masters
  taxLike(name, m, info){
    if (m && m.what && m.what !== "none" && m.what !== "bank" && m.what !== "roundoff") return true;
    if (m && m.what === "none") return false;
    if (info && /^(GST|TDS|TCS)$/i.test(info.taxType || "")) return true;
    return /\b(C|S|I|UT)\s*\.?\s*GST\b|\bGST\b|\bCESS\b|\bTDS\b|\bTCS\b|\b19[2-9][A-Z]{0,2}\b|\b206C/i.test(name) && !/\bSALARY\s+PAYABLE\b/i.test(name);
  },
  // how each ledger is used in the day book: which side, which registration, which rate
  usage(b){
    const u = {};
    (b.vouchers || []).forEach(v => {
      const sale = Books.isSale(v), purch = Books.isPurchase(v), reg = (sale || purch) ? String(v.cmp || "").slice(0, 2) : "";
      let value = 0;
      v.ent.forEach(e => { const k = (b.map[e.l] || {}).kind; if (!k && e.l !== v.party) value += Math.abs(e.a); });
      v.ent.forEach(e => {
        const x = u[e.l] = u[e.l] || {n: 0, sale: 0, purch: 0, dr: 0, cr: 0, regs: {}, rates: {}, rcm: 0, onSaleCr: 0, onPurchDr: 0};
        x.n++; if (sale) x.sale++; if (purch) x.purch++; if (e.a < 0) x.dr++; else x.cr++;
        if (reg) x.regs[reg] = (x.regs[reg] || 0) + 1;
        if (v.rcm) x.rcm++;
        if (sale && e.a > 0) x.onSaleCr++;
        if (purch && e.a < 0) x.onPurchDr++;
        const r = e.r || (value ? Math.round(Math.abs(e.a) / value * 10000) / 100 : 0);
        if (r){ const k = String(r); x.rates[k] = (x.rates[k] || 0) + 1; }
      });
    });
    return u;
  },
  top(obj){ const e = Object.entries(obj || {}).sort((a, c) => c[1] - a[1]); return e.length ? e[0] : null; },
  RATES: [0.1, 0.25, 1, 1.5, 2.5, 3, 5, 6, 9, 12, 14, 18, 28],
  // the best guess for one ledger, and why
  propose(name, info, u, regs){
    const up = name.toUpperCase(), why = [];
    info = info || {}; u = u || {n: 0, regs: {}, rates: {}};
    const tt = String(info.taxType || "").toUpperCase(), dh = String(info.dutyHead || "").toUpperCase();
    const p = {what: "none", tax: "", side: "", reg: "", section: "", rate: null, gstRate: null};
    if (tt === "GST" || /\bGST\b|\bCESS\b|\b(C|S|I|UT)\s*\.?\s*GST/.test(up)){
      p.what = "gst";
      if (tt === "GST") why.push("Tally: tax type GST");
      if (/ELECTRONIC|CASH\s*LEDGER|CREDIT\s*LEDGER|CURRENT\s*GST\s*PAYABLE|GST\s*PAYABLE|SET\s*OFF/.test(up)) p.what = "gst_setoff";
      else if (/INTEREST|LATE\s*FEE|PENALTY/.test(up)) p.what = "gst_interest";
      else if (/CONTROL|PROVISIONAL|PENDING|SUSPENSE|UNCLAIMED/.test(up)) p.what = "gst_control";
      else if (/\bRCM\b|REVERSE/.test(up)) p.what = "gst_rcm";
      else if (/IMPORT|CUSTOMS|\bBOE\b/.test(up)) p.what = "gst_import";
      else if (/INELIGIBLE|BLOCKED|NOT\s*CLAIM|17\s*\(?5/.test(up)) p.what = "ineligible";
      else if (/COMMON/.test(up)) p.what = "gst_common";
      p.tax = /INTEGRATED|IGST/.test(dh) || /\bIGST\b|I\s*GST/.test(up) ? "IGST" : /CENTRAL|CGST/.test(dh) || /\bCGST\b|C\s*GST/.test(up) ? "CGST" :
        /STATE|UT|SGST|UTGST/.test(dh) || /\b(S|UT)GST\b|S\s*GST/.test(up) ? "SGST" : /CESS/.test(dh + up) ? "CESS" : "";
      if (dh) why.push("Tally: duty head " + info.dutyHead); else if (p.tax) why.push("name says " + p.tax);
      if (/\bINPUT\b|\bITC\b|RECEIVABLE/.test(up)){ p.side = "input"; why.push("name says input"); }
      else if (/OUTPUT|PAYABLE/.test(up)){ p.side = "output"; why.push("name says output"); }
      else if (u.onPurchDr > u.onSaleCr){ p.side = "input"; why.push("debited on " + u.onPurchDr + " purchases"); }
      else if (u.onSaleCr){ p.side = "output"; why.push("credited on " + u.onSaleCr + " sales"); }
      const pre = up.match(/(?:^|\D)(\d{2})\s/);
      const grp = String(info.group || "").match(/(?:^|\D)(\d{2})(?:\D|$)/);
      const used = this.top(u.regs);
      if (pre && regs.includes(pre[1])){ p.reg = pre[1]; why.push("name starts " + pre[1]); }
      else if (grp && regs.includes(grp[1])){ p.reg = grp[1]; why.push("group " + info.group); }
      else if (used){ p.reg = used[0]; why.push("used on " + used[1] + " vouchers of " + used[0]); }
      else if (regs.length === 1) p.reg = regs[0];
      const rn = up.match(/(\d+(?:\.\d+)?)\s*%/);
      if (rn){ p.gstRate = num(rn[1]); why.push("rate " + rn[1] + "% in the name"); }
    } else if (tt === "TDS" || tt === "TCS" || /\bTDS\b|\bTCS\b/.test(up) || /\b19[2-9][A-Z]{0,2}\b|\b206C/.test(up)){
      const tcs = tt === "TCS" || /\bTCS\b|206C/.test(up);
      p.what = /INTEREST\s+(ON|FOR)\s+(LATE\s+)?(TDS|TCS)|LATE\s*FEE|PENALTY|234E|201\s*\(?1A/.test(up) ? "tds_interest" : tcs ? (/RECEIVABLE|ADVANCE|PAID/.test(up) ? "tcs_receivable" : "tcs_payable") : (/RECEIVABLE|ADVANCE|REFUND|\bA\.?\s*Y\b|\bT\.?\s*Y\b/.test(up) ? "tds_receivable" : "tds_payable");
      if (tt) why.push("Tally: tax type " + info.taxType);
      const sec = up.match(/\b(19[2-9][A-Z]{0,2}|206C[A-Z]{0,2})\b/);
      if (sec){ p.section = sec[1]; why.push("section " + sec[1] + " in the name"); }
      else if (/\b(393|389|394|392)\b/.test(up)){
        // a ledger named under the Income-tax Act, 2025: the section it replaces, from what it is for
        const NAT = [[/SALARY|PERQUISITE\s*.*SALARY/, "192"], [/NON\s*RESIDENT|\b394\b/, "195"], [/PERQUISITE|BENEFIT/, "194R"], [/CONTRACT/, "194C"], [/PROF|TECH|FEES/, "194J"],
          [/INSURANCE\s*COMM/, "194D"], [/COMM|BROKER/, "194H"], [/RENT/, "194I"], [/INTEREST/, "194A"], [/PURCHASE\s*OF\s*GOOD/, "194Q"], [/PROPERTY/, "194IA"], [/E.?COMMERCE/, "194O"], [/DIVIDEND/, "194"]];
        const hit = NAT.find(([re]) => re.test(up.replace(/\b(389|392|393|394)\b/g, " ")) || (re.source === "NON\\s*RESIDENT|\\b394\\b" && /\b394\b/.test(up)));
        if (hit){ p.section = hit[1]; why.push("named under the new Act; " + hit[1] + " from the words in the name"); }
      }
      else if (info.tdsNature){ p.section = (String(info.tdsNature).match(/19[2-9][A-Z]{0,2}|206C[A-Z]{0,2}/) || [""])[0]; if (p.section) why.push("Tally: nature " + info.tdsNature); }
      const rn = up.match(/(\d+(?:\.\d+)?)\s*%/);
      if (rn){ p.rate = num(rn[1]); why.push("rate " + rn[1] + "%"); }
      if (p.what === "tds_payable" && !p.section) why.push("no section: choose one, or mark it a general TDS account");
    } else if (/\bROUND\s*(ED)?\s*OFF\b/.test(up)){ p.what = "roundoff"; why.push("name"); }
    else if (/\bBANK\b|\bCASH\b/.test(up) || /bank|cash/i.test(info.group || "")){ p.what = "bank"; why.push(info.group ? "group " + info.group : "name"); }
    if (u.n) why.push("used " + u.n + " times");
    p.why = why.join("; ");
    return p;
  },
  // turn a choice into what the returns read
  applyWhat(m, w){
    m.what = w; m.kind = this.kindOf(w); m.rcm = w === "gst_rcm";
    if (this.isGst(w)){ m.tax = m.tax || "IGST"; m.side = m.side || (w === "gst_rcm" ? "output" : "input"); }
    if (!this.isTds(w)){ delete m.section; delete m.rate; }
    if (!this.isGst(w)){ delete m.tax; delete m.side; delete m.gstRate; }
    return m;
  },
  // fill every ledger not yet confirmed with the best guess; what the user set by hand is kept
  refresh(b){
    b.map = b.map || {};
    const regs = ((b.meta || {}).gstins || []).map(g => g.slice(0, 2)), info = b.ledInfo || {}, u = this.usage(b);
    const names = new Set(Object.keys(b.map).concat(Object.keys(info).filter(n => this.taxLike(n, null, info[n]))));
    names.forEach(n => {
      const m = b.map[n] = b.map[n] || {n: 0};
      m.n = (u[n] || {}).n || m.n || 0;
      // a client set up before the masters: what its ledgers were already marked as
      if (!m.what && m.kind) m.what = ({gst: m.rcm ? "gst_rcm" : "gst", gst_common: "gst_common", ineligible: "ineligible", tds_payable: "tds_payable", tds_receivable: "tds_receivable", bank: "bank", roundoff: "roundoff"})[m.kind] || "";
      if (m.ok || m.byHand) return;
      const p = this.propose(n, info[n], u[n], regs), tp = typeof this.tplFor === "function" ? this.tplFor(b, n) : null;
      if (tp && tp.what){
        this.applyWhat(m, tp.what);
        if (this.isGst(tp.what)){ m.tax = tp.tax || p.tax || m.tax; m.side = tp.side || p.side || m.side; m.reg = p.reg; m.gstRate = tp.gstRate || null; }
        if (this.isTds(tp.what)){ m.section = tp.section; m.rate = tp.rate; }
        m.why = "confirmed this way for " + tp.others + " other client" + (tp.others === 1 ? "" : "s") + (p.why ? "; " + p.why : "");
        return;
      }
      this.applyWhat(m, p.what);
      if (this.isGst(p.what)){ m.tax = p.tax || m.tax; m.side = p.side || m.side; m.reg = p.reg; if (p.gstRate != null) m.gstRate = p.gstRate; }
      if (this.isTds(p.what)){ m.section = p.section; m.rate = p.rate; }
      m.why = p.why;
    });
    // a TDS ledger with no section that is filled from the section ledgers and paid from the bank is a clearing account
    Object.entries(b.map).forEach(([n, m]) => {
      if (m.ok || m.byHand || m.what !== "tds_payable" || m.section) return;
      let cr = 0, fromTds = 0, paid = 0;
      (b.vouchers || []).forEach(v => { const e = v.ent.find(z => z.l === n); if (!e) return;
        if (e.a > 0){ cr++; if (v.ent.some(z => z !== e && z.a < 0 && (b.map[z.l] || {}).what === "tds_payable" && (b.map[z.l] || {}).section)) fromTds++; }
        else if (v.ent.some(z => /bank/.test((b.map[z.l] || {}).kind || ""))) paid++; });
      if (cr && fromTds / cr >= 0.8 && paid){ this.applyWhat(m, "tds_clearing"); m.why = fromTds + " of its " + cr + " credits move TDS from the section ledgers; paid from the bank " + paid + " times" + (m.why ? "; " + m.why.replace(/;?\s*no section: choose one, or mark it a general TDS account/, "") : ""); }
    });
    b.mapV = (b.mapV || 0) + 1;
    return b.map;
  },
  // what is still to be confirmed, and what the day book says against a choice
  pending(b){ return Object.entries((b && b.map) || {}).filter(([n, m]) => !m.ok && this.taxLike(n, m, (b.ledInfo || {})[n])); },
  checks(b, n, m){
    const u = (this._u && this._u.b === b.vouchers ? this._u.u : (this._u = {b: b.vouchers, u: this.usage(b)}).u)[n] || {regs: {}, rates: {}};
    const out = [];
    if (this.isGst(m.what)){
      if (m.side === "input" && u.onSaleCr) out.push("credited on " + u.onSaleCr + " sale" + (u.onSaleCr === 1 ? "" : "s"));
      if (m.side === "output" && u.onPurchDr && m.what !== "gst_rcm") out.push("debited on " + u.onPurchDr + " purchase" + (u.onPurchDr === 1 ? "" : "s"));
      const other = Object.entries(u.regs).filter(([r]) => m.reg && r !== m.reg);
      if (other.length) out.push("on " + other.reduce((a, x) => a + x[1], 0) + " vouchers Tally's voucher GSTIN is " + other.map(x => x[0]).join(", ") + "; the returns go by this ledger's registration");
      if (m.gstRate){
        const half = m.tax === "IGST" ? m.gstRate : m.gstRate / 2;
        const off = Object.entries(u.rates).filter(([r]) => Math.abs(num(r) - half) > 0.6).reduce((s, [, c]) => s + c, 0);
        if (off) out.push(off + " voucher" + (off === 1 ? "" : "s") + " at another rate");
      }
    }
    if (m.what === "tds_payable" && !m.section) out.push("no section: choose one; if it only collects the month's TDS from the section ledgers and is paid from the bank, it is a TDS clearing account");
    return out;
  },
  confirm(b, names, yes){ names.forEach(n => { const m = b.map[n]; if (m){ m.ok = !!yes; m.byHand = true; m.okAt = yes ? new Date().toISOString() : undefined; } }); b.mapV = (b.mapV || 0) + 1;
    if (yes && typeof this.tplLearn === "function"){ this.tplLearn(b, names); try { const co = CO(); if (co && co.id === b.cid) this.applyPosting(b, co, "empty"); } catch (e){} } }
};

