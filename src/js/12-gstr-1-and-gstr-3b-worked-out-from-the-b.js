/* ================================================================== */
/* GSTR-1 and GSTR-3B, worked out from the books and the ledger setup */
/* ================================================================== */
// STATE_CODES: server/_shared/gst3b.js (shared with the gst-run function)
// GSTR's part the GSTR-3B engine runs is in server/_shared/gst3b.js (shared with the gst-run function); the rest is put on it here
Object.assign(GSTR, {
  ECO_NAME: {amazon: "Amazon", flipkart: "Flipkart", shopify: "Shopify", generic: "Marketplace", market: "Marketplace"},
  // what would be rejected or questioned, before it is filed
  // next-fix-gst-year-save: in two parts, so GST › Year keeps a month's own part until that month's entries change
  // (checksKept, below). checksMonth: what the month's own entries give (with what is of no one month: the ledger map,
  // the GST settings, the fixes, the sales, the client); checksJoin: what looks across months, cheap: the document
  // numbers (a note to a buyer with no GSTIN is numbered or not by the B2C large invoices of every month; the same
  // number twice in the financial year) and the advances. y: the parts kept across drawings; none: afresh, as before
  checks(ym, reg){ return this.checksJoin(ym, reg, this.checksMonth(ym, reg)); },
  // (h, from checksKept: what is known of the month and the registration, so the whole books are not read for nothing:
  // h.cn false, no entry of the month is a credit note (GSTF.lateCn lists none); h.irn false, no sale of the
  // registration has an e-invoice (GSTF.einv lists none); h.out, the month's outward rows, kept)
  checksMonth(ym, reg, h){
    const out = (h && h.out) || this.outward(ym, reg), inn = this.inward(ym, reg), list = [];
    // all: every document found (GST › What to fix lists them); rows: the first five, the examples
    const add = (what, rows, how) => { if (rows.length) list.push({what, n: rows.length, how, rows: rows.slice(0, 5), all: rows}); };
    add("Invoices to a registered party with no GSTIN", out.filter(r => r.kind === "B2B" && !r.gstin), "Fill the GSTIN on the party ledger in Tally.");
    add("Outward invoices with no place of supply", out.filter(r => !r.posCode && r.kind !== "NIL"), "Set the place of supply on the voucher in Tally, or choose the state here (Set place of supply).");
    add("Tax type that does not match the place of supply", out.filter(r => r.posBad && r.kind !== "NIL"), "CGST and SGST are for a sale within your state; IGST for a sale to another state. Correct the tax ledgers or the place of supply on the invoice in Tally.");
    add("Outward invoices with no HSN", out.filter(r => !r.hsn && r.cls === "taxable"), "HSN is needed in the GSTR-1 summary.");
    add("Tax that does not fit the taxable value", out.filter(r => r.taxable && this.partsOf([r]).some(q => !Books.GST_RATES.includes(q.rate))), "Check the rate on these invoices.");
    if (typeof GSTF === "object" && (!h || h.cn !== false)) add("Credit notes issued after 30 November following the invoice\u2019s year", GSTF.lateCn(ym, reg).map(x => ({no: x.no + " (for " + x.orig + ")", party: x.party, doc: x})), "Section 34(2): these cannot reduce your tax. Keep them out of 3.1(a) or issue them as financial credit notes without GST.");
    if (typeof GSTF === "object" && (!h || h.irn !== false)){ const e = GSTF.einv(ym, reg);
      if (e.uses){ add("Invoices to registered customers without an e-invoice (IRN)", e.missing, "Generate the IRN before reporting; GSTR-1 is filled from e-invoices and an invoice without one is not a valid tax invoice where e-invoicing applies.");
        add("E-invoices generated more than 30 days after the invoice date", e.late, "For turnover of \u20b910 crore and above the IRP refuses these; check the date and the turnover limit that applies."); } }
    add("Invoices with items at more than one rate", out.filter(r => r.mixed), "Split rate by rate in the return, from each item's rate in Tally.");
    // G-A1, G-A2 (10-Oct-2026): what the portal refuses, found before the file is made
    add("Buyer GSTINs that are not valid", out.filter(r => r.gstin && !gstinValid(r.gstin)).map(r => ({no: r.gstin, party: r.party, doc: r})), "The 15th character (the check digit) or the form of the GSTIN is wrong, so the portal refuses the invoice. Correct the GSTIN on the party ledger in Tally.");
    // review of next-fix-b2cs-gstin: a B2C summary with an e-invoice: the portal pre-fills the IRN in B2B, FinCom reports it in B2CS
    const vIrn = new Map(this.vIn(ym).filter(v => v.irn).map(v => [v.id, v]));
    add("Summary entries with an e-invoice (IRN)", vIrn.size ? out.filter(r => r.b2cSum && vIrn.has(r.id)) : [], "This summary entry has an e-invoice (IRN): the portal will pre-fill it in GSTR-1 as a B2B invoice, while FinCom reports it in B2C small. Cancel the IRN in Tally or on the e-invoice portal (within 24 hours of making it), or choose Not a summary if it is one invoice.");
    list.push(null);                              // (the document numbers' checks: checksJoin puts them here)
    add("Purchases with no supplier GSTIN", inn.filter(r => !r.gstin && !r.fromHold && (r.cgst || r.sgst || r.igst)), "Needed to match against 2B.");
    add("Supplier GSTINs that are not valid", inn.filter(r => r.gstin && !gstinValid(r.gstin)).map(r => ({no: r.gstin, party: r.party, doc: r})), "The check digit or the form of the GSTIN is wrong: the bill can never match 2B. Correct the GSTIN on the supplier's ledger in Tally.");
    add("Purchases marked ITC not to be taken", inn.filter(r => r.blocked), "These are kept out of the credit claimed.");
    add("Inward supplies under reverse charge", inn.filter(r => r.rcm), "Tax on these is payable by you and shown in 3.1(d).");
    return {list, cand: this.numCands(out)};
  },
  checksJoin(ym, reg, p, y){
    const list = [], add = (what, rows, how) => { if (rows.length) list.push({what, n: rows.length, how, rows: rows.slice(0, 5), all: rows}); };
    p.list.forEach(c => {
      if (c){ list.push(c); return; }
      const dn = this.docNoIssues(ym, reg, p.cand, y);
      add("Invoice numbers longer than 16 characters", dn.long, "The portal takes at most 16 characters. Shorten the number in Tally (and on the invoice), e.g. drop the year's prefix.");
      add("Invoice numbers with characters the portal does not take", dn.chars, "Only letters, digits, / and - are allowed, and a number cannot be only zeros. Change the number in Tally.");
      add("Invoice numbers used twice in the financial year", dn.dup, "Each invoice (and each credit or debit note) needs its own number in the year. Renumber one of them in Tally.");
    });
    // for the year's grid: a check that is only for information is not an error
    list.forEach(c => { if (/^(Purchases marked ITC not to be taken|Inward supplies under reverse charge|Advances kept on account, not counted|Invoices with items at more than one rate)$/.test(c.what)) c.info = true; c.ret = /^(Purchases|Supplier|Inward)/.test(c.what) ? "r3b" : "r1"; });
    if (GSTAdv.ready()){
      const a = y ? y.adv(ym, reg) : GSTAdv.month(ym, reg);
      add("Advances where the rate was assumed at 18%", a.at.filter(r => r.rateFrom === "assumed").map(r => ({no: r.no, party: r.party})), "The customer has no invoice to take a rate from. Set it under Advances.");
      add("Advances kept on account, not counted", a.untaxed.filter(r => /on account/.test(r.why)).map(r => ({no: r.ref, party: r.party})), "Mark any that are advances under Advances.");
    }
    return list;
  },
  // G-A2: the invoice and note numbers of a month that the portal refuses: over 16 characters; characters other than letters,
  // digits, / and -, or only zeros; the same number twice in the financial year (invoices and notes counted apart, capitals
  // and small letters the same, as the portal counts them). Only documents reported one by one (B2B, B2C large, exports,
  // notes); B2C small goes as totals
  // next-gst-b2cs-summary (the owner, 11-Nov-2026): never a row reported in B2CS: a B2C summary (GSTR.b2cSumWhy: B2C, not
  // B2C large) and a note to a buyer with no GSTIN that adjusts B2C small (no cdnur type) carry no number on the portal
  // (ctx: {all}, the year's sales, read once for every month asked with the same ctx)
  // (ctx.allOf: where the year's sales are read from, once, when a note needs them: checksJoin's kept parts.) numCands:
  // the rows numbered or that may be (a note to a buyer with no GSTIN is by cdnurTyp, which reads every month's sales)
  ONE_NO: {B2B: 1, B2CL: 1, EXP: 1},
  numCands(rows){ return rows.filter(r => String(r.no || "").trim() && (this.ONE_NO[r.kind] || r.kind === "CDNR" || r.kind === "DBNR")); },
  numbered(rows, ctx){
    const c = ctx || {};
    return this.numCands(rows).filter(r => this.ONE_NO[r.kind] || r.gstin || this.cdnurTyp(r, c.all = c.all || (c.allOf ? c.allOf() : this.outward("", ""))));
  },
  // (cand: the month's numCands, as checksMonth gives them; y: the parts kept across drawings, checksKept)
  docNoIssues(ym, reg, cand, y){
    const rows = this.numbered(cand || this.outward(ym, reg), y ? {allOf: y.b2cl} : null);
    const s = r => String(r.no).trim();
    const fyM = (() => { const y = num(String(ym).slice(0, 4)), m = num(String(ym).slice(4, 6)), f = m >= 4 ? y : y - 1, out = []; for (let i = 0; i < 12; i++){ const mm = (i + 3) % 12 + 1; out.push((mm >= 4 ? f : f + 1) + String(mm).padStart(2, "0")); } return out; })();
    const idx = y ? y.docNos(fyM, reg) : typeof perRender === "function" ? perRender(this, "docNos|" + reg + "|" + fyM[0], () => this.docNoIndex(fyM, reg)) : this.docNoIndex(fyM, reg);
    const keyOf = r => (r.note ? "N|" : "I|") + s(r).toUpperCase();
    return {long: rows.filter(r => s(r).length > 16), chars: rows.filter(r => !/^[A-Za-z0-9/-]+$/.test(s(r)) || /^0+$/.test(s(r))),
      dup: rows.filter(r => (idx[keyOf(r)] || []).some(id => id !== r.id))};
  },
  // (numOf: a month's numbered rows, as kept; else worked out here)
  docNoIndex(months, reg, numOf){
    const have = new Set(this.months()), idx = {}, ctx = {};
    months.filter(m => have.has(m)).forEach(m => (numOf ? numOf(m) : this.numbered(this.outward(m, reg), ctx)).forEach(r => {
      const k = (r.note ? "N|" : "I|") + String(r.no).trim().toUpperCase();
      (idx[k] = idx[k] || []).includes(r.id) || idx[k].push(r.id);
    }));
    return idx;
  },
  // the switches of a B2C summary (b2cSumWhy, server/_shared/gst3b.js): the party ledger's (b.map[name].b2cSum) and
  // one entry's (b.gstPosFix[id].b2cs: on true "a summary", on false "not a summary", null cleared); FinCom's own, saved with
  // the books (synced), nothing written to Tally
  // (a sale in a month whose GSTR-1 or 3B is filed: asked, with a reason, GSTLock.gate in src/js/47)
  b2cSumLedger(name, on, sure){
    const b = S.books; if (!b || !name) return;
    if (!sure && typeof GSTLock === "object") return GSTLock.gate(S.gstReg || "", (b.vouchers || []).filter(v => v.party === name && Books.isSale(v) && (!S.gstReg || GSTR.regOf(v) === S.gstReg)).map(v => String(v.date).slice(0, 6)), ["r1", "r3b"], "B2C summary switch for " + name, () => this.b2cSumLedger(name, on, true));
    b.map = Object.assign({}, b.map || {});
    const m = b.map[name] = Object.assign({n: 0}, b.map[name] || {});
    if (on) m.b2cSum = {by: typeof whoAmI === "function" ? whoAmI() : "", at: new Date().toISOString()}; else delete m.b2cSum;
    b.mapV = (b.mapV || 0) + 1; saveBooks(); render();
  },
  b2cSumEntry(id, on, sure){
    const b = S.books; if (!b || !id) return;
    if (!sure && typeof GSTLock === "object") return GSTLock.gate(S.gstReg || "", GSTLock.months([id]), ["r1", "r3b"], "B2C summary mark", () => this.b2cSumEntry(id, on, true));
    const fx = b.gstPosFix = Object.assign({}, b.gstPosFix || {}), cur = Object.assign({}, fx[id] || {});
    if (on == null) delete cur.b2cs; else cur.b2cs = {on: !!on, by: typeof whoAmI === "function" ? whoAmI() : "", at: new Date().toISOString()};
    if (cur.pos || cur.b2cs) fx[id] = cur; else delete fx[id];
    saveBooks(); render();
  },
  // the parties with B2C summaries among their sales (the party ledger's switch, or a sale marked or numbered as a range):
  // What to fix offers their credit and debit notes "This adjusts B2C summaries"
  b2cSumParties(b){
    const fx = b.gstPosFix || {}, m = b.map || {}, out = new Set(Object.keys(m).filter(k => m[k] && m[k].b2cSum));
    (b.vouchers || []).forEach(v => { if (!v.party || v.cancel || out.has(v.party) || !Books.isSale(v) || /NOTE/i.test(v.type)) return;
      const f = (fx[v.id] || {}).b2cs; if (f && typeof f === "object" ? f.on : this.noRange(v.no || v.ref)) out.add(v.party); });
    return out;
  },
  // the party ledgers of sales with no GSTIN (the Ledgers tab offers them the switch); next-fix-b2cs-gstin: and those with
  // a GSTIN (a payment gateway's) with a sale that is a B2C summary by its own rule (numbered as a range, or marked)
  b2cParties(b){
    const g = b.gstins || {}, fx = b.gstPosFix || {}, out = new Set();
    (b.vouchers || []).forEach(v => { if (!v.party || v.cancel || out.has(v.party) || !Books.isSale(v)) return;
      if ((!v.gstin && !g[v.party]) || ((fx[v.id] || {}).b2cs || {}).on || this.noRange(v.no || v.ref)) out.add(v.party); });
    return out;
  },
  // G-E1: the errors to fix before filing a month's GSTR-1 (sales side) and 3B (purchase side), for the year's grid
  // errorChecks: the checks it counts, each return's list (GST › What to fix shows the same list, so the counts are one)
  errorChecks(ym, reg){
    const all = typeof perRender === "function" ? perRender(this, "chk|" + ym + "|" + reg, () => this.checksKept(ym, reg)) : this.checks(ym, reg);
    const of = ret => all.filter(c => !c.info && c.ret === ret);
    return {r1: of("r1"), r3b: of("r3b")};
  },
  // next-fix-hang (FINCOM-APP-STAGING-K/-R/-Q, staging 5-11 Nov 2026: 2.0-2.4 s in a click): every drawing of GST › Year
  // worked out each month's checks and its documents again (0.6-1 s for 12 months of 51,758 made-up entries, 2-4 s on an
  // office PC), so a click that only opened the client switcher, a pop-up's Open Tally page or ← Back to the year held
  // the page that long (back to the client: three drawings). In a drawing they are kept now for as long as what they are
  // worked out from is the same, as TDS.kept keeps the TDS rows: the same books object and save (BOOKS_REV), every kept
  // part of the books (BOOKS_KEYS) the same object, the same entries (the list, and each entry in its place), the client
  // (CO(), by its contents but for its counts on the clients' list, refreshStats, which change on every opening), the
  // marketplace sales (S.sales, and SALES_REV: every save of them, src/js/25, as an invoice is ignored or its GSTIN typed in
  // place) and the day; the parts edited in place (the ledger map, the GST settings, the place-of-supply fixes) also by
  // their contents. Asked once per drawing (the year asks 24 times). Outside a drawing, as before, always fresh.
  // next-fix-gst-year-save (the cloud copy's new entries drew GST › Year twice with its 12 months worked out again, 0.65 s
  // each on 51,758 made-up entries, 2.6 s on the owner's office PC; every save did the same): kept by month now.
  // keptState, brought up to date once per drawing: g moves when what is of no one month changes (all of the above but
  // the entries and the save; of the books' parts, only those GST reads: not NOT_GST; the ledger map by its contents but
  // each ledger's count of entries and reason, n and why, which move with every new entry, LedMaster.refresh, so not by
  // mapV either, which every refresh moves); ms[month].st when that month's
  // entries change (another entry in its place, one added, deleted or moved to another month, or one changed in place:
  // its own fields against those last seen, compared when the entries or the save changed); all when either does. A
  // month's own part of the checks (checksMonth, also by whether the registration has e-invoices at all: GSTF.einv) and
  // its document count are kept while its st and g are the same; what looks across months (checksJoin: the document
  // numbers, the advances, from each month's kept rows) while all is. A save that changes one month works out that one.
  // tests/run_hang_gst_year.py
  NOT_GST: new Set(["vouchers", "challans", "alloc", "allocFrom", "allocLog", "pans", "salary", "payroll", "certs", "audit", "auditCfg", "auditRel", "auditWp", "ledSnaps", "fs", "tb", "tbCheck", "mis", "misCfg",
    "msme", "budget", "letters", "ai", "trashLog", "gone", "nrInfo", "tcsCodes", "tcsCodesFixed", "panInoperative", "tdsFiled", "tdsSnap", "tds26as", "tanParty", "f16a", "tracesJr", "tracesConso", "tracesChStatus",
    "payDetails", "chPortions", "tdsCorr", "fixedAssets", "tdsEdits", "matchNo", "tdsSplits", "panFix", "tdsAdded", "tdsPayKind"]),
  _ck: new WeakMap(), _ckAt: null,
  keptState(){
    const b = S.books, V = b && b.vouchers;
    if (!Array.isArray(V) || typeof IN_RENDER === "undefined" || !IN_RENDER || typeof BOOKS_KEYS === "undefined") return null;
    const rev = typeof BOOKS_REV === "number" ? BOOKS_REV : 0, at = this._ckAt;
    if (at && at.b === b && at.gen === RENDER_GEN && at.rev === rev) return at.w;
    let w = this._ck.get(b), co, ed;
    try { const c = (typeof CO === "function" && CO()) || null; co = JSON.stringify(c, (k, x) => (k === "stats" && c && x === c.stats ? undefined : x)); const M = b.map || {};
      ed = JSON.stringify(M, function (k, x){ return this !== M && (k === "n" || k === "why") ? undefined : x; }) + JSON.stringify([b.gstSet, b.gstPosFix]); } catch (e){ return null; }
    if (!w) this._ck.set(b, w = {g: 0, all: 0, ids: null, ms: {}, V: null, arr: null, rev: null, seen: new WeakMap(), v: {}, rd: null, rdRev: null});
    // review of be773616d: the other parts the checks read, outside the entries, by their contents at every save (they are
    // changed in place: the ledgers' GSTINs from the cloud copy, BookSrc.ledgersInto; the groups and ledgers' places,
    // TallyRead; an advance's rate or "is an advance", advFix; the registrations and bill-wise flag of meta)
    if (w.rdRev !== rev || !w.rd){ try { const m = b.meta || {}; w.rd = JSON.stringify([b.gstins, b.under, b.groups, b.states, b.stateOf, b.advFix, b.gstRegs, m.gstins, m.bills]); } catch (e){ return null; } w.rdRev = rev; }
    const sl = S.sales, ids = [typeof SALES_REV === "number" ? SALES_REV : 0, S.coId, co, ed, w.rd, new Date().toDateString(), sl, sl && sl.cid, sl && sl.list, sl && sl.list && sl.list.length, b.ledInfoAt]
      .concat(BOOKS_KEYS.filter(k => k !== "map" && !this.NOT_GST.has(k)).map(k => b[k]));
    if (!w.ids || w.ids.length !== ids.length || !w.ids.every((x, i) => x === ids[i])){ w.ids = ids; w.g++; w.all++; }
    const was = w.V, same = !!was && was.length === V.length && V.every((v, i) => v === was[i]);
    if (!same || w.rev !== rev || w.arr !== V){
      // (a new list of the very same entries in their places: Books.touch, src/js/04, the entries changed in place, as a
      // ledger's name corrected in their lines: every month)
      const by = {}, edited = new Set(), touched = same && w.arr !== V;
      // (the entries come in date order: the month of the one before is tried first, with no new string)
      let k = null, list = null;
      for (const v of V){
        const d = v && v.date != null ? (typeof v.date === "string" ? v.date : String(v.date)) : "";
        if (k === null || (k.length === 6 ? !d.startsWith(k) : d !== k)){ k = d.slice(0, 6); list = by[k] = by[k] || []; }
        list.push(v);
        if (v && typeof v === "object" && !this.sameEntry(v, w.seen)) edited.add(k);
      }
      new Set(Object.keys(by).concat(Object.keys(w.ms))).forEach(k => {
        const a = by[k] || [], o = w.ms[k];
        if (o && !touched && !edited.has(k) && o.list.length === a.length && a.every((v, i) => v === o.list[i])) return;
        w.ms[k] = {list: a, st: (o ? o.st : 0) + 1}; w.all++;
      });
      w.V = V.slice(); w.arr = V; w.rev = rev;
    }
    this._ckAt = {b, gen: RENDER_GEN, rev, w};
    return w;
  },
  // an entry's fields that GST reads, as when last seen (its lines by their list and how many); one not seen before is
  // taken as it is. (Written out: a loop over the names took 30 ms for 51,758 entries, this about 10)
  sameEntry(v, seen){
    const a = seen.get(v), n = Array.isArray(v.ent) ? v.ent.length : -1;
    if (a && v.date === a[0] && v.type === a[1] && v.no === a[2] && v.ref === a[3] && v.refDate === a[4] && v.party === a[5] && v.gstin === a[6] && v.pos === a[7] && v.cmp === a[8] && v.irn === a[9]
      && v.irnDate === a[10] && v.cancel === a[11] && v.opt === a[12] && v.alt === a[13] && v.ent === a[14] && v.supply === a[15] && v.nature === a[16] && v.taxability === a[17] && v.regType === a[18]
      && v.country === a[19] && v.rcm === a[20] && v.ineligibleFlag === a[21] && v.hsn === a[22] && v.narr === a[23] && v.src === a[24] && v.id === a[25] && n === a[26]) return true;
    seen.set(v, [v.date, v.type, v.no, v.ref, v.refDate, v.party, v.gstin, v.pos, v.cmp, v.irn, v.irnDate, v.cancel, v.opt, v.alt, v.ent, v.supply, v.nature, v.taxability, v.regType, v.country, v.rcm,
      v.ineligibleFlag, v.hsn, v.narr, v.src, v.id, n]);
    return !a;
  },
  // kept while the month's entries and g are the same (x: what else it is worked out from); a period, while all is
  keptMonth(key, ym, x, fn){
    const w = this.keptState(); if (!w) return fn();
    if (!/^\d{6}$/.test(String(ym))) return this.keptAll(key + "|" + x, fn);
    const st = w.ms[ym] ? w.ms[ym].st : 0, e = w.v[key];
    if (e && e.g === w.g && e.st === st && e.x === x) return e.r;
    const r = fn(); w.v[key] = {g: w.g, st, x, r}; return r;
  },
  keptAll(key, fn){
    const w = this.keptState(); if (!w) return fn();
    const e = w.v[key];
    if (e && e.all === w.all) return e.r;
    const r = fn(); w.v[key] = {all: w.all, r}; return r;
  },
  // whether a registration's sales carry any e-invoice (GSTF.einv lists the invoices without one only then)
  irnUsed(reg){
    if ((typeof GSTSet === "object" ? GSTSet.einvMode(reg) : "auto") !== "auto") return false;
    return (S.books.vouchers || []).some(v => v && v.irn && !v.opt && Books.isSale(v) && (!reg || this.regOf(v) === reg));
  },
  // checksJoin's kept parts: every month's B2C large invoices (cdnurTyp), the year's document numbers, the advances
  keptParts(){
    const y = {
      b2cl: () => this.keptAll("b2cl", () => { const ms = this.keptState().ms, out = [];
        Object.keys(ms).forEach(k => { out.push(...this.keptMonth("b2cl|" + k, k, null, () => ms[k].list.filter(v => v && !v.opt && !v.cancel).map(v => this.outRow(v, "", "")).filter(r => r && r.kind === "B2CL"))); });
        return out; }),
      docNos: (fyM, reg) => this.keptAll("docNos|" + reg + "|" + fyM[0], () => { const ctx = {allOf: y.b2cl};
        return this.docNoIndex(fyM, reg, m => this.numbered(this.keptMonth("num|" + m + "|" + reg, m, null, () => this.numCands(this.outKept(m, reg))), ctx)); }),
      adv: (ym, reg) => this.keptAll("adv|" + ym + "|" + reg, () => GSTAdv.month(ym, reg))
    };
    return y;
  },
  checksKept(ym, reg){
    const w = this.keptState();
    if (!w) return this.checks(ym, reg);
    // (cn: whether the month has a credit note at all, from its own entries)
    const irn = typeof GSTF === "object" ? this.keptAll("irn|" + reg, () => this.irnUsed(reg)) : false;
    const p = this.keptMonth("chk|" + ym + "|" + reg, ym, irn, () => this.checksMonth(ym, reg, {irn, out: this.outKept(ym, reg), cn: !/^\d{6}$/.test(String(ym)) || ((w.ms[ym] || {}).list || []).some(v => v && /CREDIT NOTE/i.test(v.type))}));
    return this.keptAll("join|" + ym + "|" + reg, () => this.checksJoin(ym, reg, p, this.keptParts()));
  },
  // a month's outward rows, kept by the month (read, never changed, by the parts above and docCount)
  outKept(ym, reg){ return this.keptMonth("out|" + ym + "|" + reg, ym, null, () => this.outward(ym, reg)); },
  // the year's grid: a month's GSTR-1 documents, how many (GSTR.one's total.n: the sum of its outward rows)
  docCount(ym, reg){ return this.keptState() ? this.keptMonth("one|" + ym + "|" + reg, ym, null, () => this.sum(this.outKept(ym, reg)).n) : this.one(ym, reg).total.n; },
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
    // 4(A)(4) inward supplies from ISD (next-gst-isd, GSTR.isISD; none: zeros, as before)
    const isd = t.isd || {};
    out.itc_elg.itc_avl.splice(3, 0, {ty: "ISD", iamt: r2(num(isd.igst)), camt: r2(num(isd.cgst)), samt: r2(num(isd.sgst)), csamt: r2(num(isd.cess))});
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
      ["4(A)(4) Inward supplies from ISD", num((t.isd || {}).taxable), num((t.isd || {}).igst), num((t.isd || {}).cgst), num((t.isd || {}).sgst), num((t.isd || {}).cess)],
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

