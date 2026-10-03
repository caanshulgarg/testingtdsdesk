/* ================================================================== */
/* The GST and TDS ledger check (request of 02-Oct-2026), once per   */
/* client: 1. what Tally's masters say (facts), 2. how the day book   */
/* uses each tax-like ledger, 3. AI only for what is still unclear;   */
/* one screen to confirm, with the evidence and its source. Nothing   */
/* counts in a return until it is confirmed (once the check is saved)*/
/* ================================================================== */
// The screen is app/src/screens/books/LedCheck.jsx, at the top of the Tally ledgers tab. The choices go into the ledger
// master (b.map, LedMaster) as before; b.ledCheck keeps the suggestions, their evidence, and the usage each confirmed
// ledger had, so a later change of use is noticed.
const LedCheck = {
  V: 1,
  SRC: {master: "Tally master", usage: "Day book", firm: "Your firm", name: "Name", ai: "AI"},
  // a TDS section from "194I", "194-I", or the short "94I" / "94 J" many ledgers carry
  section(s){
    const u = String(s || "").toUpperCase(), m = u.match(/\b(19[2-9])\s*-?\s*([A-Z]{0,2})\b|\b206\s*-?\s*C\s*([A-Z]{0,2})\b/);
    if (m) return m[1] ? m[1] + m[2] : "206C" + (m[3] || "");
    const s2 = u.match(/(?:^|[^0-9])9\s*([2-9])\s*-?\s*([A-Z]{1,2})?\b/);
    return s2 && (s2[2] || /9\s*[2-9]\b/.test(u)) ? "19" + s2[1] + (s2[2] || "") : "";
  },
  secLabel(s){ return s ? s.replace(/^(19\d)([A-Z]+)$/, "$1-$2") : ""; },
  // the group chain of a ledger, from Tally's groups
  chain(b, l){ const out = []; let g = ((b.ledInfo || {})[l] || {}).group || ledUnder(b, l) || ""; for (let i = 0; i < 12 && g; i++){ out.push(g); const p = ledLook(b.groups || {}, g); if (!p || ledKey(p) === ledKey(g) || /^\W*primary$/i.test(p)) break; g = p; } return out; },
  inGroup(b, l, re){ return this.chain(b, l).some(g => re.test(g)); },
  nominal(b, l){ return this.inGroup(b, l, /^(sales accounts|direct incomes|indirect incomes|purchase accounts|direct expenses|indirect expenses|fixed assets)$/i) ? (this.inGroup(b, l, /incomes|^sales accounts$/i) ? "inc" : "exp") : ""; },
  taxGroup(b, l){ return this.inGroup(b, l, /^duties\s*(&|and)\s*taxes$/i) || this.inGroup(b, l, /^(gst|tds|tcs)$/i); },
  // the ledgers to check: what the master or name makes tax-like, and every ledger under Duties & Taxes
  candidates(b){
    const info = b.ledInfo || {}, names = new Set();
    Object.keys(b.map || {}).concat(Object.keys(info)).forEach(n => { const m = (b.map || {})[n]; if (LedMaster.taxLike(n, m && m.what === "none" && !m.byHand ? null : m, info[n]) || this.taxGroup(b, n) || /\bRCM\b|REVERSE\s*CHARGE/i.test(n)) names.add(n); });
    return Array.from(names).sort();
  },

  // ---------- 15. what Tally's master says: facts where set ----------
  master(b, n){
    const i = (b.ledInfo || {})[n]; if (!i) return null;
    const tt = String(i.taxType || "").trim(), T = tt.toUpperCase(), dh = String(i.dutyHead || "").toUpperCase(), grp = i.group || "", out = {ev: []};
    const head = /INTEGRATED|IGST/.test(dh) ? "IGST" : /CENTRAL|CGST/.test(dh) ? "CGST" : /STATE|UT|SGST/.test(dh) ? "SGST" : /CESS/.test(dh) ? "CESS" : "";
    if (T === "GST"){ out.gst = true; out.head = head; out.ev.push("tax type GST" + (head ? ", duty head " + i.dutyHead : "")); if (num(i.rate)) { out.rate = num(i.rate); out.ev.push("rate " + i.rate + "%"); } }
    else if (T === "TDS" || T === "TCS"){ out.tds = T; out.section = this.section(i.tdsNature); out.ev.push("tax type " + tt + (i.tdsNature ? ", nature of payment " + i.tdsNature : "")); }
    else if (/SERVICE\s*TAX|\bVAT\b|\bCST\b|EXCISE|KRISHI|SWACHH/.test(T)){ out.none = true; out.ev.push("tax type " + tt + ": a tax before GST, not GST"); }
    // tax type Others away from Duties & Taxes: not a tax ledger ("Fee GST" under Loans & Advances), except a TDS / TCS
    // account named so, which is tax deducted from the client and kept as an asset ("TDS Receivable FY 2025-26")
    else if (T && !this.taxGroup(b, n) && !(/\bTDS\b|\bTCS\b|^TDS[_\s]/i.test(n) && !this.inGroup(b, n, /expenses|incomes|^purchase accounts$|^sales accounts$/i))){ out.none = true; out.ev.push("tax type " + tt + ", under " + grp + " (not Duties & Taxes)"); }
    else if (grp) out.ev.push("under " + grp + (T ? ", tax type " + tt : ""));
    return out;
  },

  // ---------- 16. how the day book uses each tax-like ledger ----------
  usage(b, names){
    const want = new Set(names), u = {}, reg = String((GSTR.gstins(b) || [])[0] || (CO() || {}).gstin || "").slice(0, 2), nom = {}, gst = b.gstins || {};
    const nomOf = l => nom[l] === undefined ? (nom[l] = this.nominal(b, l)) : nom[l];
    (b.vouchers || []).forEach(v => {
      if (v.opt || v.cancel || !v.ent.some(e => want.has(e.l))) return;
      const cn = /CREDIT\s*NOTE/i.test(v.type), dn = /DEBIT\s*NOTE/i.test(v.type), pay = /PAYMENT|RECEIPT|CONTRA/i.test(v.type);
      const inc = v.ent.some(e => nomOf(e.l) === "inc"), exp = v.ent.some(e => nomOf(e.l) === "exp"), sale = !cn && (Books.isSale(v) || inc), purch = Books.isPurchase(v) || exp;
      const base = v.ent.filter(e => nomOf(e.l)).reduce((a, e) => a + Math.abs(e.a), 0);
      const party = String(v.gstin || gst[v.party] || "").slice(0, 2);
      const taxLines = v.ent.filter(e => want.has(e.l)), setoff = !inc && !exp && v.ent.every(e => want.has(e.l) || LedMaster.bankByGroup(e.l, (b.ledInfo || {})[e.l]));
      taxLines.forEach(e => {
        const x = u[e.l] = u[e.l] || {n: 0, dr: 0, cr: 0, sale: 0, purch: 0, cn: 0, dn: 0, pay: 0, setoff: 0, other: 0, inter: 0, intra: 0, ratios: [], with: {}, samples: [], months: new Set()};
        x.n++; if (e.a < 0) x.dr++; else x.cr++;
        if (cn) x.cn++; else if (dn) x.dn++; else if (setoff) x.setoff++; else if (sale) x.sale++; else if (purch) x.purch++; else if (pay) x.pay++; else x.other++;
        if (party && reg) { if (party === reg) x.intra++; else x.inter++; }
        if (base) x.ratios.push(Math.round(Math.abs(e.a) / base * 10000) / 100);
        v.ent.forEach(z => { if (z !== e && want.has(z.l)) x.with[z.l] = (x.with[z.l] || 0) + 1; });
        x.months.add(String(v.date).slice(0, 6));
        if (x.samples.length < 5 && (!x.samples.length || x.samples[x.samples.length - 1].type !== v.type || x.samples.length < 3))
          x.samples.push({date: v.date, type: v.type, no: v.no, side: e.a < 0 ? "Dr" : "Cr", amt: Math.abs(e.a), lines: v.ent.slice(0, 6).map(z => (z.a < 0 ? "Dr " : "Cr ") + z.l + " " + Math.abs(z.a))});
      });
    });
    Object.values(u).forEach(x => { const r = x.ratios.slice().sort((a, c) => a - c); x.ratio = r.length ? r[Math.floor(r.length / 2)] : null; x.months = x.months.size; delete x.ratios; });
    return u;
  },
  // what the use says, in one line (for the screen and for AI)
  sayUse(x){
    if (!x || !x.n) return "not used in the day book";
    const p = [], add = (k, l) => { if (x[k]) p.push(x[k] + " " + l); };
    add("sale", "on sales/income"); add("purch", "on purchases/expenses"); add("cn", "on credit notes"); add("dn", "on debit notes"); add("pay", "on payments/receipts"); add("setoff", "on set-off or tax-only entries"); add("other", "other");
    return x.n + " entries: " + p.join(", ") + "; usually " + (x.dr >= x.cr ? "debit" : "credit") + " (" + x.dr + " Dr / " + x.cr + " Cr)" + (x.ratio != null ? "; tax about " + x.ratio + "% of the value" : "") +
      (x.inter + x.intra ? "; party in another state " + x.inter + ", same state " + x.intra : "");
  },
  // a "signature" of the use, to notice when a confirmed ledger starts being used differently
  sig(x){ if (!x || !x.n) return "unused"; const k = ["sale", "purch", "cn", "pay", "setoff"].filter(f => x[f] / x.n >= 0.2); return k.join("+") + "|" + (x.dr >= x.cr ? "dr" : "cr"); },

  // ---------- the suggestion: master facts first, then use, then the name; unclear ones go to AI ----------
  suggest(b, n, x, hint){
    const ms = this.master(b, n) || {ev: []}, up = n.toUpperCase(), ev = [], S2 = {what: "", side: "", tax: "", rate: null, section: "", conf: "low"};
    const add = (src, say) => ev.push({src, say});
    ms.ev.forEach(s => add("master", s));
    if (x && x.n) add("usage", this.sayUse(x));
    const notTaxName = /NON[\s-]*GST|NOT\s+GST|EXEMPT/.test(up), payish = /\b(PENA?LTY|PANELTY|FEES?|LOAN|PAYMENTS?|REFUND|DEPOSIT|INTEREST|CLIENT|REFUNDABLE)\b/.test(up);
    const rcmLike = /\bRCM\b|REVERSE\s*CHARGE/.test(up) || Object.keys((x && x.with) || {}).some(w => /\bRCM\b|REVERSE/i.test(w));
    if (hint && hint.what) add("firm", "confirmed as " + LedMaster.label(hint.what) + (hint.section ? " " + this.secLabel(hint.section) : "") + (hint.tax ? " " + hint.tax : "") + (hint.side ? " " + hint.side : "") + " for " + hint.others + " other client" + (hint.others === 1 ? "" : "s"));
    // not tax: the master says so (tax type Others away from Duties & Taxes, or a tax before GST), or the name says non-GST
    if (ms.none || (notTaxName && !ms.gst)){ Object.assign(S2, {what: "none", conf: "high"}); if (notTaxName && !ms.none) add("name", "the name says it is not GST"); return Object.assign(S2, {ev}); }
    if (!ms.gst && !ms.tds && payish && !this.taxGroup(b, n)){ Object.assign(S2, {what: "none", conf: "high"}); add("name", "a penalty, fee, loan or payment account, not under Duties & Taxes"); return Object.assign(S2, {ev}); }
    const tdsName = /\bTDS\b|\bTCS\b/.test(up) || this.section(n);
    if (ms.tds || (tdsName && !ms.gst)){
      const asset = this.inGroup(b, n, /^(loans\s*&\s*advances\s*\(asset\)|current assets|deposits\s*\(asset\))$/i);
      const tcs = ms.tds === "TCS" || /\bTCS\b|206C/.test(up), recv = /RECEIVABLE|REFUND|ADVANCE/.test(up) || asset || (x && x.dr > x.cr && x.sale + x.pay >= x.purch);
      if (asset && !/RECEIVABLE/.test(up)) add("master", "kept under " + (((b.ledInfo || {})[n] || {}).group || "an asset group") + ": tax deducted from the client");
      S2.what = tcs ? (recv ? "tcs_receivable" : "tcs_payable") : (recv ? "tds_receivable" : "tds_payable");
      S2.section = ms.section || this.section(n) || (hint && hint.section) || "";
      if (!ms.section && S2.section) add("name", "section " + this.secLabel(S2.section) + " from the name");
      if (x && x.n && !recv) add("usage", "credited on " + (x.purch + x.other) + " expense entries: TDS deducted");
      S2.conf = ms.tds && S2.section ? "high" : S2.section && (x && x.cr >= x.dr) ? "high" : S2.section ? "medium" : "low";
      return Object.assign(S2, {ev});
    }
    const gstName = /\bGST\b|\b(C|S|I|UT)\s*\.?\s*GST\b|\bCESS\b/.test(up);
    if (ms.gst || gstName || rcmLike){
      S2.what = rcmLike ? "gst_rcm" : /IMPORT|CUSTOMS/.test(up) ? "gst_import" : "gst";
      S2.tax = ms.head || (/IGST|I\s*GST|INTEGRATED/.test(up) ? "IGST" : /CGST|C\s*GST|CENTRAL/.test(up) ? "CGST" : /SGST|S\s*GST|UTGST/.test(up) ? "SGST" : /CESS/.test(up) ? "CESS" : "");
      const rn = up.match(/(\d+(?:\.\d+)?)\s*%/); S2.rate = ms.rate || (rn ? num(rn[1]) : null);
      // the side: output when credited on sales or debited on credit notes; input when debited on purchases
      const outUse = x ? x.sale + x.cn : 0, inUse = x ? x.purch + x.dn : 0;
      const rcmLiab = S2.what === "gst_rcm" && !/\bINPUT\b|\bITC\b/.test(up) && (x ? x.cr >= x.dr : /PAYABLE|OUTPUT/.test(up));
      if (/\bINPUT\b|\bITC\b/.test(up)) S2.side = "input"; else if (/OUTPUT/.test(up) || rcmLiab) S2.side = "output";
      else if (outUse > inUse) { S2.side = "output"; add("usage", "used on " + outUse + " sales or credit notes: output tax"); }
      else if (inUse > outUse) { S2.side = "input"; add("usage", "used on " + inUse + " purchases: input tax"); }
      if (rcmLiab && x && x.n) add("usage", "credited on " + x.cr + " of its " + x.n + " entries: tax owed on reverse charge");
      if (S2.what === "gst_rcm"){
        // the liability credited beside the reverse-charge input: its heads are those of the input lines with it
        if (!S2.tax && x){ const heads = new Set(Object.keys(x.with).map(w => { const m = this.master(b, w) || {}; return m.head || (/CGST/i.test(w) ? "CGST" : /SGST/i.test(w) ? "SGST" : /IGST/i.test(w) ? "IGST" : ""); }).filter(Boolean));
          if (heads.has("CGST") && heads.has("SGST")) { S2.tax = "CGST+SGST"; add("usage", "credited beside CGST and SGST reverse-charge input: CGST + SGST"); } else if (heads.size === 1) S2.tax = Array.from(heads)[0]; }
      }
      if (x && x.ratio && S2.rate == null) { const r = Books.snapRate ? Books.snapRate(S2.tax === "IGST" ? x.ratio : x.ratio * 2) : null; if (r) add("usage", "tax is about " + x.ratio + "% of the value: " + r + "% GST"); }
      const sideFromUse = x && ((S2.side === "output" && (x.sale + x.cn) > 0) || (S2.side === "input" && (x.purch + x.dn) > 0) || (rcmLiab && x.cr >= 3 * Math.max(1, x.dr)));
      S2.conf = ms.gst && ms.head && S2.side && (sideFromUse || /INPUT|OUTPUT/.test(up)) ? "high" : (S2.tax && S2.side && (ms.gst || sideFromUse)) ? (S2.what === "gst_rcm" && S2.tax ? "high" : "medium") : "low";
      if (!x || !x.n) { add("usage", "not used yet: the side cannot be read from the day book"); if (S2.conf === "high" && !/INPUT|OUTPUT/.test(up)) S2.conf = "medium"; }
      return Object.assign(S2, {ev});
    }
    if (hint && hint.what){ Object.assign(S2, {what: hint.what, side: hint.side || "", tax: hint.tax || "", section: hint.section || "", conf: "medium"}); return Object.assign(S2, {ev}); }
    Object.assign(S2, {what: "none", conf: "low"});
    return Object.assign(S2, {ev});
  },

  // ---------- run, keep, and what changed since ----------
  st(b){ return b.ledCheck = b.ledCheck || {v: this.V, items: {}}; },
  run(b){
    const names = this.candidates(b), u = this.usage(b, names), c = this.st(b), at = new Date().toISOString();
    names.forEach(n => {
      const hint = typeof LedMaster.tplFor === "function" ? LedMaster.tplFor(b, n) : null, s = this.suggest(b, n, u[n], hint), it = c.items[n] = c.items[n] || {};
      const ai = it.ai && !s.ev.some(e => e.src === "master") ? it.ai : null;
      it.s = s; it.use = u[n] ? {n: u[n].n, say: this.sayUse(u[n]), samples: u[n].samples} : {n: 0, say: "not used in the day book"}; it.sig = this.sig(u[n]); it.at = at;
      if (ai) it.ai = ai;
    });
    c.ranAt = at; c.names = names;
    return c;
  },
  // ledgers new since the check was saved, and confirmed ledgers now used differently (a warning)
  diff(b){
    const c = b.ledCheck; if (!c || !c.savedAt) return {fresh: [], changed: []};
    const names = this.candidates(b), u = this.usage(b, names), fresh = [], changed = [];
    names.forEach(n => { const it = c.items[n], m = (b.map || {})[n] || {};
      if (!it) { fresh.push(n); return; }
      if (m.ok && it.okSig && it.okSig !== this.sig(u[n])) changed.push({n, was: it.okSig, now: this.sig(u[n]), say: this.sayUse(u[n])}); });
    return {fresh, changed};
  },
  // the answer used: AI's for a ledger the rules left unclear, else the rules'
  pick(it){ return it.ai && (it.s.conf === "low") ? Object.assign({}, it.s, it.ai, {fromAi: true}) : it.s; },
  ticked(it){ return it.tick !== undefined ? !!it.tick : (this.pick(it).conf === "high" && !this.pick(it).fromAi); },
  setTick(n, on){ const it = (S.books.ledCheck || {}).items[n]; if (it){ it.tick = !!on; render(); } },
  // the answers ticked go into the ledger master, confirmed, with where each came from; the check is saved, and from now
  // on a tax-like ledger not confirmed counts in no return
  confirm(b, names){
    const c = this.st(b), u = this.usage(b, names), done = [];
    names.forEach(n => { const it = c.items[n]; if (!it) return; const p = this.pick(it), m = b.map[n] = b.map[n] || {n: 0};
      LedMaster.applyWhat(m, p.what || "none");
      if (LedMaster.isGst(p.what)){ m.tax = p.tax || m.tax; m.side = p.side || m.side; if (p.rate) m.gstRate = p.rate; }
      if (LedMaster.isTds(p.what)){ m.section = p.section || ""; if (p.rate) m.rate = p.rate; }
      m.why = p.ev.map(e => this.SRC[e.src] + ": " + e.say).join("; ") + (p.fromAi ? "; AI: " + (it.ai.reason || "") : "");
      m.src = Array.from(new Set(p.ev.map(e => e.src).concat(p.fromAi ? ["ai"] : [])));
      it.okSig = this.sig(u[n]); it.okAt = new Date().toISOString(); it.okBy = whoAmI(); it.tick = undefined; done.push(n); });
    LedMaster.confirm(b, done, true);
    c.savedAt = new Date().toISOString(); c.savedBy = whoAmI(); c.strict = true;
    return done.length;
  },
  // a ledger counts in returns only when confirmed, once the check is saved (request of 02-Oct-2026): an unconfirmed
  // tax-like ledger reads as "other tax", in no return and not part of any taxable value
  PENDING: Object.freeze({kind: "tax_other", pending: true}),
  held(b){
    if (!(b && b.ledCheck && b.ledCheck.strict)) return null;
    const k = (b.mapV || 0) + "|" + Object.keys(b.map || {}).length;
    if (this._held && this._held.b === b && this._held.k === k) return this._held.set;
    const set = new Set(Object.entries(b.map || {}).filter(([n, m]) => !m.ok && LedMaster.taxLike(n, m, (b.ledInfo || {})[n])).map(([n]) => n));
    this._held = {b, k, set}; return set;
  },

  // ---------- 17. AI, only for what is still unclear: one call per client ----------
  async askAi(b){
    if (!AIH.ready("tds") && !AIH.ready("audit")) return 0;
    const c = this.st(b), unclear = Object.entries(c.items).filter(([n, it]) => it.s && it.s.conf === "low" && !((b.map || {})[n] || {}).ok).slice(0, 60);
    if (!unclear.length){ toast("Nothing is unclear: every ledger was settled by Tally's masters or the day book."); return 0; }
    const info = b.ledInfo || {}, list = unclear.map(([n, it]) => ({name: n, group: (info[n] || {}).group || "", taxType: (info[n] || {}).taxType || "", use: it.use.say,
      samples: (it.use.samples || []).slice(0, 5).map(s => s.date + " " + s.type + " " + s.side + " " + s.amt + " | " + s.lines.join(", "))}));
    const prompt = "You classify ledgers of an Indian business's Tally books for GST and TDS returns. For each ledger below you get its name, its Tally group, Tally's tax type, " +
      "how the day book uses it, and up to 5 sample entries. Answer with JSON only: {\"ledgers\": [{\"name\": exact name, \"kind\": one of \"gst_output\", \"gst_input\", \"gst_rcm\", \"tds_payable\", \"tds_receivable\", \"tcs_payable\", \"tcs_receivable\", \"not_tax\", " +
      "\"head\": \"CGST\" | \"SGST\" | \"IGST\" | \"CESS\" | \"CGST+SGST\" | \"\", \"rate\": number or null, \"tds_section\": e.g. \"194J\" or \"\", \"confidence\": \"high\" | \"medium\" | \"low\", \"reason\": one short line}]}. " +
      "Do not guess a tax ledger from the word GST alone: penalty, fee, loan and payment accounts are not tax ledgers.\n\n" + JSON.stringify(list);
    let j; try { j = await claudeRead(prompt, [], false); } catch (e){ toast("AI could not be asked: " + ((e && (e.message || e.code)) || e)); return 0; }
    const MAPK = {gst_output: ["gst", "output"], gst_input: ["gst", "input"], gst_rcm: ["gst_rcm", "output"], tds_payable: ["tds_payable", ""], tds_receivable: ["tds_receivable", ""], tcs_payable: ["tcs_payable", ""], tcs_receivable: ["tcs_receivable", ""], not_tax: ["none", ""]};
    let n = 0;
    ((j && j.ledgers) || []).forEach(a => { const it = c.items[a.name], k = MAPK[a.kind]; if (!it || !k) return;
      it.ai = {what: k[0], side: k[1], tax: a.head || "", rate: a.rate == null ? null : num(a.rate), section: this.section(a.tds_section || ""), conf: ["high", "medium", "low"].includes(a.confidence) ? a.confidence : "low", reason: String(a.reason || "").slice(0, 200), at: new Date().toISOString()};
      it.s.ev = it.s.ev.filter(e => e.src !== "ai").concat([{src: "ai", say: (a.kind || "").replace("_", " ") + (a.head ? " " + a.head : "") + (a.tds_section ? " " + a.tds_section : "") + " (" + it.ai.conf + "): " + it.ai.reason}]); n++; });
    AIH.log("ledger check", n + " ledgers asked");
    return n;
  }
};
