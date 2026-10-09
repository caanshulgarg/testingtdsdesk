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
        const x = u[e.l] = u[e.l] || {n: 0, dr: 0, cr: 0, sale: 0, purch: 0, cn: 0, dn: 0, pay: 0, setoff: 0, other: 0, inter: 0, intra: 0, rcmN: 0, ratios: [], with: {}, samples: [], months: new Set()};
        x.n++; if (v.ent.some(z => z !== e && /\bRCM\b|REVERSE/i.test(z.l))) x.rcmN++; if (e.a < 0) x.dr++; else x.cr++;
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
    // reverse charge: the name says so; or by use, when (almost) every entry of the ledger is a reverse-charge entry
    // (another ledger on it is named RCM / reverse charge) - never for a ledger named input or ITC without RCM in its
    // name: a regular input ledger takes the credit of the reverse-charge purchases too (Dr expense, Dr 07 CGST INPUT,
    // Cr 07 RCM CGST PAYABLE), and was called reverse charge when ANY of its entries was one (08-Oct-2026)
    const rcmName = /\bRCM\b|REVERSE\s*CHARGE/.test(up), inputName = /\bINPUT\b|\bITC\b/.test(up);
    const rcmLike = rcmName || (!inputName && !!(x && x.n && x.rcmN / x.n >= 0.8));
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
      // kept with the books (BOOKS_KEYS): a suggestion is "pending" and counts in no figure until the ledger is
      // confirmed (then it is in the ledger master, b.map, which is what the returns read)
      it.state = ((b.map || {})[n] || {}).ok ? "confirmed" : "pending";
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
      it.okSig = this.sig(u[n]); it.okAt = new Date().toISOString(); it.okBy = whoAmI(); it.tick = undefined; it.state = "confirmed"; done.push(n); });
    LedMaster.confirm(b, done, true);
    c.savedAt = new Date().toISOString(); c.savedBy = whoAmI(); c.strict = true;
    return done.length;
  },
  // the ledgers not confirmed (the books' own map). Since the owner's decision on H1 (09-Oct-2026, "Keep today's figures")
  // Books.ledgerOf no longer reads them as "other tax": the books' map counts as in 2.3.3, the check's suggestions count
  // in no figure until confirmed (they are kept apart in b.ledCheck until then)
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

/* ================================================================== */
/* The GST and TDS ledgers page, simpler (FinCom 2.4.0; the owner of  */
/* 08-Oct-2026: "there should be simple page of tds & gst tally ledger */
/* import page"): one row a ledger with one answer and one action     */
/* ================================================================== */
// The screen is app/src/screens/books/Ledgers.jsx. One list of the client's tax-like ledgers (the map's GST and TDS ledgers
// and the check's), each with ONE answer: the check's suggestion while the ledger is not confirmed and not set by hand,
// else the ledger master's (b.map) - so the page never shows two answers for one ledger. The rows go to three places:
//   GST ledgers / TDS ledgers - FinCom can tell what it is: Confirm, or Change;
//   Needs you - FinCom could not tell (or a TDS ledger without its section, a GST ledger without its head or side), and
//     the rest a person must act on: a ledger renamed in Tally (an owner confirms), entries naming a ledger FinCom does
//     not have (migration 56), ledger lines without a GUID (Rec.needKind "masters", the shared classifier), a confirmed
//     ledger now used differently, ledgers changed after returns were made, two ledgers with one GSTIN, a PAN that is
//     not the one in the ledger's GSTIN - each with its one action.
// Nothing new is asked of Tally: the ledger list is the bridge's (Ledgers, src/js/58) and the masters read as before.
const LedPage = {
  // the check worked out by itself when the books, the masters or the ledgers change (it was a button: "Run the ledger
  // check"; "Check again" under More still runs it on demand)
  key(b){ return (b.vouchers || []).length + "|" + (b.ledInfoAt || "") + "|" + Object.keys(b.map || {}).length + "|" + Object.keys(b.ledInfo || {}).length; },
  ensure(b){
    const k = this.key(b);
    if (!b.ledCheck || !b.ledCheck.ranAt || b.ledCheck.autoKey !== k){
      LedCheck.run(b); b.ledCheck.autoKey = k;
      // kept with the books, its suggestions pending (they count in nothing until confirmed)
      if (typeof saveBooks === "function" && b.cid) setTimeout(() => { if (S.books === b) saveBooks(); }, 0);
    }
    return b.ledCheck;
  },
  rows(b){
    const c = this.ensure(b), info = b.ledInfo || {}, names = new Set();
    Object.entries(b.map || {}).forEach(([n, m]) => { if (LedMaster.taxLike(n, m, info[n])) names.add(n); });
    (c.names || []).forEach(n => names.add(n));
    return Array.from(names).sort((x, y) => x.localeCompare(y)).map(n => this.row(b, n));
  },
  row(b, n){
    const has = !!(b.map && b.map[n]), m = has ? b.map[n] : {}, it = ((b.ledCheck || {}).items || {})[n], ok = !!m.ok, cp = it ? LedCheck.pick(it) : null;
    // the ledger master's answer (what the returns use) wherever it has one; the check's for a ledger it alone found, or
    // one the master has no answer for
    const fromCheck = !!(cp && (!has || (!m.what && !ok)));
    const p = fromCheck ? cp : {what: m.what || "", side: m.side || "", tax: m.tax || "", rate: LedMaster.isGst(m.what) ? m.gstRate : m.rate, section: m.section || "",
      conf: ok ? "high" : cp && this.same(cp, m) ? cp.conf : "medium", ev: cp ? cp.ev : [], fromAi: false};
    // the check reads it otherwise: said under Why (its answer is taken only with "Confirm the check's sure answers")
    const alt = cp && has && !ok && !this.same(cp, m) ? this.says(cp) : "";
    const kind = LedMaster.isGst(p.what) ? "gst" : LedMaster.isTds(p.what) ? "tds" : "none";
    let unclear = "";
    if (!ok){
      if (!p.what || (p.what === "none" && LedMaster.taxLike(n, null, (b.ledInfo || {})[n]) && !(cp && cp.what === "none" && cp.conf !== "low")) || (fromCheck && p.conf === "low" && !p.fromAi)) unclear = "FinCom could not tell what this ledger is";
      else if ((p.what === "tds_payable" || p.what === "tcs_payable") && !p.section) unclear = "a TDS ledger without its section";
      else if (/^(gst|gst_rcm|gst_import)$/.test(p.what) && (!p.tax || !p.side)) unclear = "a GST ledger whose head (CGST, SGST, IGST) or side (input, output) is not known";
    }
    return {n, m, it, ok, fromCheck, p, alt, kind, unclear, group: ((b.ledInfo || {})[n] || {}).group || (b.under || {})[n] || "", why: m.why || ""};
  },
  same(cp, m){ return (cp.what || "") === (m.what || "") && (!LedMaster.isGst(cp.what) || ((cp.tax || "") === (m.tax || "") && (cp.side || "") === (m.side || ""))) && (!LedMaster.isTds(cp.what) || !cp.section || cp.section === (m.section || "")); },
  // "CGST input · 9%", "IGST output, reverse charge", "Not a tax ledger"
  says(p){
    if (!p || !p.what) return "Not known yet";
    if (p.what === "none") return "Not a tax ledger";
    if (/^(gst|gst_rcm|gst_import)$/.test(p.what))
      return String(p.tax || "GST").replace("+", " + ") + (p.side ? " " + p.side : "") + (p.what === "gst_rcm" ? ", reverse charge" : p.what === "gst_import" ? ", on imports" : "") + (num(p.rate) ? " · " + num(p.rate) + "%" : "");
    return LedMaster.label(p.what) + (LedMaster.isTds(p.what) && p.section ? " · " + LedCheck.secLabel(p.section) : "") + (num(p.rate) ? " · " + num(p.rate) + "%" : "");
  },
  // the nature of payment: Tally's own (the master's), else the payments FinCom's rules know for the section
  nature(b, n, sec){
    const t = ((b.ledInfo || {})[n] || {}).tdsNature; if (t) return String(t);
    const k = String(sec || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (!k || typeof RULE_DEFAULTS === "undefined") return "";
    return Array.from(new Set(RULE_DEFAULTS.filter(r => String(r.old || "").toUpperCase().replace(/[^0-9A-Z]/g, "") === k).map(r => r.label))).slice(0, 3).join(" / ");
  },
  // Confirm on a row: the ledger confirmed as the row says (the master's answer, as its Confirm did); a ledger only the
  // check found goes into the master with the check's answer. A confirm is its own step: saved at once. The check's
  // "only confirmed ledgers count" switch is still set only by "Confirm the check's sure answers" (lcConfirm)
  confirm(b, names, how){
    const rows = [].concat(names || []).map(n => this.row(b, n)).filter(r => !r.ok && (r.fromCheck || (b.map && b.map[r.n])));
    if (!rows.length) return 0;
    const was = this.before(b, rows.map(r => r.n));
    Drafts.direct(() => {
      b.map = b.map || {};
      rows.filter(r => r.fromCheck).forEach(r => { const p = r.p, m = b.map[r.n] = b.map[r.n] || {n: 0};
        LedMaster.applyWhat(m, p.what || "none");
        if (LedMaster.isGst(p.what)){ m.tax = p.tax || m.tax; m.side = p.side || m.side; if (p.rate) m.gstRate = p.rate; }
        if (LedMaster.isTds(p.what)){ m.section = p.section || ""; if (p.rate) m.rate = p.rate; }
        m.why = (p.ev || []).map(e => LedCheck.SRC[e.src] + ": " + e.say).join("; "); });
      const names2 = rows.map(r => r.n), u = LedCheck.usage(b, names2);
      LedMaster.confirm(b, names2, true);
      names2.forEach(n => { const it = ((b.ledCheck || {}).items || {})[n]; if (it){ it.okSig = LedCheck.sig(u[n]); it.okAt = new Date().toISOString(); it.okBy = whoAmI(); it.state = "confirmed"; } });
      // 2.4.1: how it was confirmed, and what it was before (a row's Undo puts that back)
      was.forEach(([n, prev]) => { const m = b.map[n]; if (m){ m.okHow = how || "row"; m.prev = prev; } });
      this.dirty(b); saveBooks();
    }, {bypass: true});
    S.ledUndo = {cid: b.cid, text: rows.length === 1 ? "Confirmed: " + rows[0].n + "." : rows.length + " ledgers confirmed.", list: was};
    render();
    return rows.length;
  },

  // ---------- FinCom 2.4.1: the simple page (the owner's decisions of 09-Oct-2026) ----------
  // "Keep today's figures": the returns read b.map (Books.ledgerOf) as before; nothing here moves a figure unless a person
  // changes a ledger (Confirm keeps the answer as it is; Change and "Use the check's" change that one ledger)
  taxW(w){ return LedMaster.isGst(w) || LedMaster.isTds(w); },
  // the answer the returns read (b.map), in the shape of the check's
  ans(m){ m = m || {}; return {what: m.what || "", side: m.side || "", tax: m.tax || "", rate: LedMaster.isGst(m.what) ? m.gstRate : m.rate, section: m.section || ""}; },
  // FinCom's check's own answer (its rules, never AI's: no AI on this page), where it has one it is not unsure of
  checkOf(b, n){ const it = ((b.ledCheck || {}).items || {})[n], s = it && it.s; return s && s.what && s.conf !== "low" ? s : null; },
  // one entry that uses the ledger (the check's samples): type, number, date, amount
  example(b, n){ const it = ((b.ledCheck || {}).items || {})[n], x = it && it.use && (it.use.samples || [])[0]; return x || null; },
  exampleSay(x){ if (!x) return ""; const d = /^\d{8}$/.test(String(x.date || "")) ? fmtDate(tallyDate(x.date)) : fmtDate(String(x.date || "").slice(0, 10));
    return [x.type, x.no].filter(Boolean).join(" ") + " · " + d + " · " + money(x.amt); },
  // the main table: one row a GST or TDS ledger (what the map reads as GST or TDS, or a tax-like ledger it has no answer
  // for), and a ledger only the check found that it reads as GST or TDS
  line(b, n){
    const m = (b.map || {})[n] || null, s = this.checkOf(b, n), info = (b.ledInfo || {})[n] || {};
    return {n, m, has: !!m, ok: !!(m && m.ok), says: m && m.what ? this.says(this.ans(m)) : "Not known yet", check: s, checkSays: s ? this.says(s) : "",
      agree: !!(m && m.what && s && this.same(s, m)), used: m ? (m.n || 0) : 0, ex: this.example(b, n), group: info.group || (b.under || {})[n] || ""};
  },
  main(b){
    const c = this.ensure(b), info = b.ledInfo || {}, map = b.map || {}, names = new Set();
    Object.entries(map).forEach(([n, m]) => { if (this.taxW(m.what) || (!m.what && LedMaster.taxLike(n, m, info[n]))) names.add(n); });
    (c.names || []).forEach(n => { if (!map[n]){ const s = this.checkOf(b, n); if (s && this.taxW(s.what)) names.add(n); } });
    return Array.from(names).sort((x, y) => x.localeCompare(y)).map(n => this.line(b, n));
  },
  // the other ledgers (not tax), most used first: one can be marked as tax with Change
  others(b){
    const main = new Set(this.main(b).map(r => r.n));
    return Object.entries(b.map || {}).filter(([n]) => !main.has(n)).sort((x, y) => (y[1].n || 0) - (x[1].n || 0) || x[0].localeCompare(y[0])).map(([n]) => this.line(b, n));
  },
  // "Confirm all": the ledgers used in entries (n > 0), not confirmed, whose answer is the check's too
  agreeing(b){ return this.main(b).filter(r => r.has && !r.ok && r.used > 0 && r.agree).map(r => r.n); },
  // "Please check": a confirmed ledger the check reads otherwise; a confirmed name-guess no entry uses yet, which would
  // count as tax once used (confirmed before 2.4.1 in a batch, not on its own row, and Tally's master does not say GST or
  // TDS). "Keep mine" puts one away (m.kept) until the check reads it otherwise again
  review(b){
    const out = [], info = b.ledInfo || {};
    Object.entries(b.map || {}).sort((x, y) => x[0].localeCompare(y[0])).forEach(([n, m]) => {
      if (!m.ok) return;
      const s = this.checkOf(b, n), mine = this.says(this.ans(m)), k = m.kept || {};
      if (s && m.what && !this.same(s, m)){ const cs = this.says(s); if (k.check !== cs) out.push({n, kind: "differs", m, mine, check: s, checkSays: cs, ex: this.example(b, n)}); return; }
      if (this.taxW(m.what) && !((m.n || 0) > 0) && !/^(row|change|check|agree)$/.test(m.okHow || "") && !/^(GST|TDS|TCS)$/i.test(String((info[n] || {}).taxType || "")) && !m.kept)
        out.push({n, kind: "unused", m, mine, check: s, checkSays: s ? this.says(s) : "", ex: null});
    });
    return out;
  },
  // what each ledger was before a change (for Undo): a copy with its own history (prev), the last 5 steps kept, so an
  // Undo puts back exactly what was there and a second Undo goes one step further back
  bare(m){ const c = JSON.parse(JSON.stringify(m || {})); let x = c; for (let i = 0; i < 4 && x && x.prev; i++) x = x.prev; if (x && x.prev) delete x.prev; return c; },
  before(b, names){ return [].concat(names).map(n => [n, b.map && b.map[n] ? this.bare(b.map[n]) : null]); },
  dirty(b){ b.mapV = (b.mapV || 0) + 1; b.reco = null; if (typeof GSTR === "object") GSTR._carry = null; if (typeof GST2B === "object") GST2B._memo = null; },
  // each its own step, saved at once (never a draft), with Undo
  step(b, text, names, fn){
    const was = this.before(b, names);
    Drafts.direct(() => { b.map = b.map || {}; fn(was); this.dirty(b); saveBooks(); }, {bypass: true});
    S.ledUndo = {cid: b.cid, text, list: was};
    render();
  },
  confirmAgree(b){
    const names = this.agreeing(b); if (!names.length) return 0;
    this.confirm(b, names, "agree");
    S.ledUndo = Object.assign({}, S.ledUndo, {text: names.length === 1 ? "1 ledger confirmed." : names.length + " ledgers confirmed."});
    return names.length;
  },
  keepMine(b, n){
    const m = (b.map || {})[n]; if (!m) return;
    const s = this.checkOf(b, n), cs = s && !this.same(s, m) ? this.says(s) : "unused";
    this.step(b, "Kept as you confirmed: " + n + ".", [n], (was) => { m.kept = {by: whoAmI(), at: new Date().toISOString(), check: cs}; m.prev = was[0][1]; });
  },
  useCheck(b, n){
    const s = this.checkOf(b, n); if (!s) return;
    this.step(b, "Changed to the check’s answer: " + n + ".", [n], (was) => {
      const m = b.map[n] = b.map[n] || {n: 0};
      LedMaster.applyWhat(m, s.what);
      if (LedMaster.isGst(s.what)){ m.tax = s.tax || m.tax; m.side = s.side || m.side; if (s.rate) m.gstRate = s.rate; }
      if (LedMaster.isTds(s.what)){ m.section = s.section || ""; if (s.rate) m.rate = s.rate; }
      m.why = (s.ev || []).map(e => LedCheck.SRC[e.src] + ": " + e.say).join("; ");
      LedMaster.confirm(b, [n], true); m.okHow = "check"; delete m.kept; m.prev = was[0][1];
      const it = ((b.ledCheck || {}).items || {})[n]; if (it){ it.okSig = LedCheck.sig(LedCheck.usage(b, [n])[n]); it.okAt = m.okAt; it.okBy = m.okBy; }
    });
  },
  // put ledgers back as they were (Undo); a ledger that was not in the map is taken out of it again
  restore(b, list){
    Drafts.direct(() => {
      const items = (b.ledCheck || {}).items || {};
      list.forEach(([n, prev]) => {
        const used = ((b.map || {})[n] || {}).n || 0;
        if (prev) b.map[n] = Object.assign(JSON.parse(JSON.stringify(prev)), {n: used}); else delete b.map[n];
        if (items[n]) items[n].state = prev && prev.ok ? "confirmed" : "pending";
      });
      this.dirty(b); saveBooks();
    }, {bypass: true});
  },
  // a confirmed row's own Undo: what it was before it was confirmed or changed (kept on the ledger); one confirmed before
  // 2.4.1 is only not confirmed any more
  undoRow(b, n){
    const m = (b.map || {})[n]; if (!m) return;
    const prev = m.prev !== undefined ? m.prev : Object.assign(this.bare(m), {ok: false, okAt: undefined, okBy: undefined, okHow: undefined, prev: undefined});
    this.restore(b, [[n, prev]]);
    if (S.ledUndo && (S.ledUndo.list || []).some(x => x[0] === n)) S.ledUndo = null;
    render();
  },
  undoLast(b){ const u = S.ledUndo; if (!u || u.cid !== b.cid) return; S.ledUndo = null; this.restore(b, u.list || []); toast("Undone."); render(); },
  // two ledgers with one GSTIN; a PAN that is not the one inside the ledger's GSTIN. From the masters read and the
  // bridge's ledger list; "Fine as it is" (b.ledOk) puts one away
  conflicts(b, cid){
    const all = {}, ok = b.ledOk || {}, out = [];
    const add = (n, g, p) => { if (!n) return; const x = all[n] = all[n] || {n, gstin: "", pan: ""}; g = String(g || "").toUpperCase().trim(); p = String(p || "").toUpperCase().trim(); if (g && !x.gstin) x.gstin = g; if (p && !x.pan) x.pan = p; };
    Object.entries(b.ledInfo || {}).forEach(([n, i]) => add(n, i && i.gstin, i && i.pan));
    Object.entries(b.gstins || {}).forEach(([n, g]) => add(n, g, ""));
    Object.entries(b.pans || {}).forEach(([n, p]) => add(n, "", p));
    if (typeof Ledgers === "object" && cid) Ledgers.list(cid).forEach(l => { if (l) add(l.name, l.gstin, l.pan); });
    const own = new Set([].concat((typeof GSTR === "object" && GSTR.gstins ? GSTR.gstins(b) : []) || [], [((CO(cid) || {}).gstin || "")]).map(g => String(g || "").toUpperCase()));
    const by = {};
    Object.values(all).forEach(x => { if (GSTIN_RE.test(x.gstin) && !own.has(x.gstin)) (by[x.gstin] = by[x.gstin] || []).push(x.n); });
    Object.keys(by).sort().forEach(g => { const ns = by[g].sort((x, y) => x.localeCompare(y)); if (ns.length < 2 || ok["gstin:" + g]) return;
      out.push({key: "gstin:" + g, kind: "gstin", names: ns, text: "GSTIN " + g + " is on " + ns.length + " ledgers: " + ns.join(", ") + ". If they are one party, merge them in Tally; if not, correct the GSTIN in Tally."}); });
    Object.values(all).sort((x, y) => x.n.localeCompare(y.n)).forEach(x => {
      if (!GSTIN_RE.test(x.gstin) || !PAN_RE.test(x.pan) || x.gstin.slice(2, 12) === x.pan || ok["pan:" + x.n]) return;
      out.push({key: "pan:" + x.n, kind: "pan", names: [x.n], text: x.n + ": PAN " + x.pan + " is not the PAN inside its GSTIN " + x.gstin + " (" + x.gstin.slice(2, 12) + "). Correct it in Tally; the TDS returns use the PAN."}); });
    return out;
  },
  fine(b, key){ Drafts.direct(() => { (b.ledOk = b.ledOk || {})[key] = {by: whoAmI(), at: new Date().toISOString()}; saveBooks(); }, {bypass: true}); render(); },
  // entries naming a ledger FinCom does not have yet (migration 56, Rec.unkOf), one item a ledger
  unknown(cid){
    if (typeof Rec !== "object" || !Rec.unkOf || typeof TCloud !== "object" || !TCloud.on() || !cid) return [];
    const bks = Rec.unkBooks(cid), rows = (Rec.unkOf(bks.length ? bks : null).rows || []).filter(r => String(r.client_id || "") === String(cid)), by = {};
    rows.forEach(r => { const names = Array.isArray(r.ledgers) ? r.ledgers : String(r.ledgers || "").replace(/^\{|\}$/g, "").split(",").map(x => x.replace(/^"|"$/g, "")).filter(Boolean);
      names.forEach(n => { (by[n] = by[n] || []).push(r); }); });
    const one = r => [r.vtype, r.vno].map(x => String(x || "").trim()).filter(Boolean).join(" ") + (r.day ? " of " + fmtDate(String(r.day).slice(0, 10)) : "");
    return Object.keys(by).sort().map(n => { const rs = by[n];
      return {key: "unk:" + n, n, text: "'" + n + "' is used by " + rs.length + (rs.length === 1 ? " entry" : " entries") + " (" + rs.slice(0, 3).map(one).join(", ") + (rs.length > 3 ? ", …" : "") + "), but FinCom does not have this ledger yet. The entries are in the books; its group comes with the next ledger list."}; });
  },
  // a confirmed ledger now used differently: kept as confirmed, with its use now (the warning goes)
  // release-240 review M5: saved at once, as fine() (its own confirm step, not a draft)
  keepUse(b, n){ const it = ((b.ledCheck || {}).items || {})[n]; if (it) Drafts.direct(() => { it.okSig = LedCheck.sig(LedCheck.usage(b, [n])[n]); it.okAt = new Date().toISOString(); it.okBy = whoAmI(); saveBooks(); }, {bypass: true}); render(); },
  // "2 min ago", "3 h ago", "on 07-Oct-2026 10:05"
  ago(at){
    const t = Date.parse(String(at || "")); if (!t) return "";
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    return min < 1 ? "just now" : min < 60 ? min + " min ago" : min < 24 * 60 ? Math.floor(min / 60) + " h ago" : "on " + fmtDateTime(t);
  }
};
