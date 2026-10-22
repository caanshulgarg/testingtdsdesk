/* ================================================================== */
/* TDS: returns marked filed, the rate by deductee, late deduction,   */
/* certificate limits, the payable tie-out, the limits tracker and    */
/* corrections after filing (the owner's list of 10-Oct-2026)         */
/* ================================================================== */
// T-E1. A TDS return marked filed on its File tab: the date and the token (or RRR) number, per return and quarter, kept
// with the books (b.tdsFiled, one of BOOKS_KEYS, so it is shared through client_books like the challans). The year's grid
// and the late fee read it. A date typed earlier under Settings › Closed periods ("TDS returns filed", one per quarter) is
// read too, for every form of that quarter, so nothing typed there is lost; marking a return filed also fills that date
// when it is empty, so the closed-period warning before posting knows of it (a date so filled counts for that return
// only, and is cleared again when its mark is taken off).
const TDSFiled = {
  key(fy, q, form){ return fy + "|" + q + "|" + (form || "26Q"); },
  closedOf(fy, q){
    let co = null; try { co = CO(); } catch (e){}
    return co && typeof ClosedP === "object" ? String((ClosedP.cfg(co).tdsFiled || {})[fy + "|" + q] || "") : "";
  },
  get(fy, q, form){
    const b = S.books || {}, r = (b.tdsFiled || {})[this.key(fy, q, form)];
    if (r && r.on) return {on: r.on, token: r.token || "", from: "return", by: r.by || "", at: r.at || ""};
    // the Closed periods date counts for every form of the quarter, unless FinCom itself filled it when another form of the
    // quarter was marked filed (that return's date says nothing of this one)
    const cp = this.closedOf(fy, q);
    const auto = cp && Object.keys(b.tdsFiled || {}).some(k => k.indexOf(fy + "|" + q + "|") === 0 && b.tdsFiled[k].closedFilled && TDS.ymd(b.tdsFiled[k].on) === TDS.ymd(cp));
    if (cp && !auto) return {on: cp, token: "", from: "closed"};
    // a date kept by an earlier build as b.filedOn (26Q only), should one be there
    const old = (b.filedOn || {})[fy + q];
    if (old && (form || "26Q") === "26Q") return {on: old, token: "", from: "old"};
    return null;
  },
  // the last day of the quarter: a return cannot be filed before it ends
  qEnd(fy, q){ const y = num(String(fy).slice(0, 4)); return {Q1: y + "0630", Q2: y + "0930", Q3: y + "1231", Q4: (y + 1) + "0331"}[q] || ""; },
  todayIst(){ return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10).replace(/-/g, ""); },
  // what is wrong with what was typed, in words ("" when it can be kept)
  problem(fy, q, on, token){
    const d = TDS.ymd(on);
    if (d.length !== 8) return "Give the date the return was filed.";
    if (d <= this.qEnd(fy, q)) return "The date is before the quarter ended (" + fmtDate(tallyDate(this.qEnd(fy, q))) + "): a return is filed after its quarter.";
    if (d > this.todayIst()) return "The date is after today.";
    const t = String(token || "").replace(/\s/g, "");
    if (t && !/^\d{15}$/.test(t)) return "The token (or RRR) number is 15 digits, as on the acknowledgement.";
    return "";
  },
  async mark(fy, q, form, on, token){
    const why = this.problem(fy, q, on, token);
    if (why){ toast(why); return false; }
    const d = TDS.ymd(on), iso = d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8), t = String(token || "").replace(/\s/g, "");
    const name = TDS.formShort(form, fy) + ", " + q + " " + fy, fee = TDS.lateFee(fy, q, d, form);
    const ok = await askConfirm({title: "Mark " + name + " filed?",
      body: "Filed on <b>" + esc(fmtDate(iso)) + "</b>" + (t ? ", token " + esc(t) : ", no token number given") + ".<br>" +
        "The year's grid shows it filed, and the late fee is worked out to this date" + (fee && fee.days > 0 ? " (<b>₹" + INR.format(fee.fee) + "</b>, " + fee.days + " days late)" : " (none: filed by the due date)") + "." +
        (this.closedOf(fy, q) ? "" : "<br>Settings › Closed periods gets this date for " + q + " " + fy + ", so FinCom warns before an entry of the quarter is posted.") +
        (typeof TDSDrift === "object" ? "<br>A copy of the quarter's entries is kept, so a change made in Tally later is spotted." : ""),
      ok: "Mark filed"});
    if (!ok || !ok.ok) return false;
    const b = S.books, fill = !this.closedOf(fy, q); b.tdsFiled = Object.assign({}, b.tdsFiled);
    b.tdsFiled[this.key(fy, q, form)] = Object.assign({on: iso, token: t, at: new Date().toISOString(), by: typeof whoAmI === "function" ? whoAmI() : ""}, fill ? {closedFilled: true} : {});
    if (typeof TDSDrift === "object") TDSDrift.keep(fy, q, form);
    // tds-layout (14-Oct-2026): its challan allocations are locked from now (TDSReg, src/js/79); a correction open for it is
    // closed by filing it, and the trail says each allocation is locked
    if (typeof TDSReg === "object"){ if (b.tdsCorr && b.tdsCorr[TDSReg.corrKey(fy, q, form)]){ b.tdsCorr = Object.assign({}, b.tdsCorr); delete b.tdsCorr[TDSReg.corrKey(fy, q, form)]; } TDSReg.lockReturn(fy, q, form); }
    try { const co = CO(); if (co && fill){ const f = Object.assign({}, ClosedP.cfg(co).tdsFiled); f[fy + "|" + q] = iso; ClosedP.set(co, "tdsFiled", f); } } catch (e){}
    try { auditEvent("tds_return_filed", {form, fy, q, on: iso, token: t}, S.coId); } catch (e){}
    saveBooks(); toast(name + " marked filed on " + fmtDate(iso) + "."); render();
    return true;
  },
  async unmark(fy, q, form){
    const name = TDS.formShort(form, fy) + ", " + q + " " + fy;
    const b = S.books, r = (b.tdsFiled || {})[this.key(fy, q, form)] || {}, cp = this.closedOf(fy, q);
    const clear = r.closedFilled && cp && TDS.ymd(cp) === TDS.ymd(r.on);
    const ok = await askConfirm({title: "Take off the filed mark?", body: esc(name) + " goes back to not filed: the late fee is again worked out as if it were filed today." +
      (clear ? " The date under Settings › Closed periods, filled when it was marked, is cleared too." : cp ? " The date under Settings › Closed periods is not changed." : ""), ok: "Take it off", danger: true});
    if (!ok || !ok.ok) return false;
    b.tdsFiled = Object.assign({}, b.tdsFiled); delete b.tdsFiled[this.key(fy, q, form)];
    if (clear) try { const co = CO(), f = Object.assign({}, ClosedP.cfg(co).tdsFiled); delete f[fy + "|" + q]; ClosedP.set(co, "tdsFiled", f); } catch (e){}
    if (b.tdsSnap){ b.tdsSnap = Object.assign({}, b.tdsSnap); delete b.tdsSnap[this.key(fy, q, form)]; }
    saveBooks(); render(); return true;
  }
};

// T-A2. The rate that applies, decided by who the deductee is (the PAN's 4th letter) and what was paid for (the expense
// ledger's nature of payment in Tally, else its name, else the TDS ledger's). Used by Certs.expected (src/js/18) after a
// certificate and the 206AA higher rate, which are unchanged; where nothing here decides, the nearest usual rate is used
// as before.
const TDSRate = {
  PAN_KIND: {P: "an individual", H: "a HUF", C: "a company", F: "a firm or LLP", A: "an association of persons", T: "a trust", B: "a body of individuals",
    L: "a local authority", J: "an artificial juridical person", G: "a government body"},
  panKind(pan){ const p = String(pan || "").toUpperCase(); return Certs.validPan(p) ? p[3] : ""; },
  // what a ledger's words say was paid for, among the kinds that decide a rate within one section
  kindOf(text){
    const u = String(text || "").toUpperCase();
    if (!u) return "";
    if (/TECHNICAL|CALL\s*CENT(RE|ER)/.test(u)) return "technical";
    if (/DIRECTOR/.test(u)) return "director";
    if (/PROFESSIONAL|PROFF?\b|LEGAL|AUDIT|ADVOCATE|RETAINER|CONSULT|ARCHITECT|DOCTOR|MEDICAL FEE|CHARTERED/.test(u)) return "professional";
    if (/(RENT|HIRE|LEASE).*(PLANT|MACHIN|EQUIPMENT)|(PLANT|MACHIN|EQUIPMENT).*(RENT|HIRE|LEASE)/.test(u)) return "rent_machinery";
    if (/RENT|LEASE|LAND|BUILDING|GODOWN|WAREHOUSE|PREMISES|FURNITURE/.test(u)) return "rent_building";
    if (/CONTRACT|LABOUR|JOB\s*WORK|MANPOWER|TRANSPORT|FREIGHT|CARTAGE|REPAIR|MAINTENANCE|ADVERT|PRINTING|CATERING|SECURITY|HOUSEKEEPING/.test(u)) return "contractor";
    return "";
  },
  // a deduction's payment type: the expense ledgers of its entry first (their nature in Tally, then their names), then the
  // TDS ledger (its nature, then its name). The party's own line is no expense: its ledger by structure (TDS.led, src/js/09;
  // next-fix-tds-party: the voucher's party name often differs from the ledger, so a payment debiting "Rao Consultants LLP"
  // named "Rao Consultants" read the party's ledger as the expense)
  payType(t, v){
    const b = S.books || {}, info = b.ledInfo || {}, out = [], p = TDS.led(v);
    (v.ent || []).forEach(e => { if (e.a < 0 && e.l !== p && !Books.ledgerOf(e.l).kind) out.push(e.l); });
    for (const l of out){ const k = this.kindOf((info[l] || {}).tdsNature); if (k) return k; }
    for (const l of out){ const k = this.kindOf(l); if (k) return k; }
    return this.kindOf((info[t.ledger] || {}).tdsNature) || this.kindOf(t.ledger);
  },
  // {rate, why} where the deductee and the payment type decide it, else null
  expect(r){
    const sec = TDS.sec(r.section), pk = this.panKind(r.pan), who = this.PAN_KIND[pk] || "";
    if (sec === "194C" && pk) return pk === "P" || pk === "H"
      ? {rate: 1, why: "194C to " + who + " (PAN's 4th letter " + pk + "): 1%"}
      : {rate: 2, why: "194C to " + who + " (PAN's 4th letter " + pk + "): 2%"};
    const k = r.pay || "";
    if (sec === "194J"){
      if (k === "technical") return {rate: 2, why: "194J, fees for technical services: 2%"};
      if (k === "professional") return {rate: 10, why: "194J, professional fees: 10%"};
      if (k === "director") return {rate: 10, why: "194J, director's fees: 10%"};
    }
    if (sec === "194I"){
      if (k === "rent_machinery") return {rate: 2, why: "194-I, rent of plant or machinery: 2%"};
      if (k === "rent_building") return {rate: 10, why: "194-I, rent of land, building or furniture: 10%"};
    }
    return null;
  }
};

// T-S3. Interest under 201(1A)(i): 1% a month (or part of one) from when the tax was to be deducted to when it was. Tally
// shows this as a TDS entry of its own (party debited, TDS credited, no expense) dated after the bill it is for. The bill
// is the latest entry before it that credits the same party with an expense whose TDS at a usual rate of the section is
// this amount. Nothing is found where the TDS is in the bill's own entry.
const TDSInt = {
  lateDeduct(r){
    // the bill already found for the row (TDS.allRowsNow, the review's M2): from its date to the deduction
    if (r && r.credit && r.tds > 0){ const m = TDS.monthsBetween(r.credit, r.date); return m > 0 && TDS.ymd(r.credit) < TDS.ymd(r.date) ? {date: TDS.ymd(r.credit), voucher: r.bill || "", amount: r.paid, months: m} : null; }
    if (!r || r.paid > 0 || !(r.tds > 0) || r.sep) return null;   // a TDS entry of its own not matched to a bill (TDSSep): no bill to count from
    const idx =typeof perRender === "function" ? perRender(this, "byParty", () => this.index()) : this.index();
    const std = TDS.STD[TDS.sec(r.section)] || [];
    const vid = String(r.id).split("|")[0], d = TDS.ymd(r.date);
    let hit = null;
    (idx[r.party] || []).forEach(x => {
      if (x.id === vid || x.date > d) return;
      if (!std.some(rate => Math.abs(x.amount * rate / 100 - r.tds) <= Math.max(1, r.tds * 0.005))) return;
      if (!hit || x.date > hit.date) hit = x;
    });
    if (!hit || hit.date >= d) return null;
    const months = TDS.monthsBetween(hit.date, d);
    return months > 0 ? {date: hit.date, voucher: hit.no, amount: hit.amount, months} : null;
  },
  // every entry that credits a party with an expense and carries no TDS of its own, by the party's ledger (TDS.led: the
  // deductee of the TDS entries it is looked up for; next-fix-tds-party)
  index(){
    const out = {};
    ((S.books || {}).vouchers || []).forEach(v => {
      if (v.opt || v.cancel || !v.party) return;
      const L = Books.lines(v);
      if (L.tds.length) return;
      const p = TDS.led(v), pe = (v.ent || []).find(e => e.l === p);
      if (!pe || !(pe.a > 0)) return;
      let exp = 0;
      (v.ent || []).forEach(e => { if (e.a < 0 && e.l !== p && !Books.ledgerOf(e.l).kind) exp += -e.a; });
      if (exp > 0) (out[p] = out[p] || []).push({id: v.id, date: TDS.ymd(v.date), no: v.no || v.ref || "", amount: r2(exp)});
    });
    return out;
  }
};

// The owner, 19-Oct-2026: "in India people sometimes book the bill in one entry without TDS and the TDS in another entry".
// A TDS entry of its own: a journal (or the payment) that credits a TDS ledger and debits the party, with no expense in
// it. Its deductee is the party debited (a journal often names no party in Tally), and it is matched to the party's bills
// booked without TDS, in this order:
//   (a) the bill named: a bill-wise Agst Ref on the party's line naming the bill's New Ref (or its number), or the bill's
//       number in the narration (3 characters or more, as a word);
//   (b) the TDS fits one bill: the rate that applies (else one of the section's usual rates) × the bill, within ₹1 or 1%;
//       the latest such bill;
//   (c) the TDS fits a month's bills together (several bills' TDS in one journal), the latest month first, then months
//       together back from it.
// For (b) and (c) a bill is of the same section (where its expense ledger says one), dated on or before the TDS entry (the
// same day, entered before or after, counts) and the entry is within the bill's financial year (a March bill: up to
// 30 April, the TDS due date). A bill is taken once. The row then carries the bill's date (date of payment or credit,
// r.credit) and amount (r.paid), and r.covers, what it covers for the limits check (TDSWatch): the bills, or, short of
// the rate that applies, what its TDS covers at that rate (r.sepShort: the audit's "short deducted", the short amount
// only). A bill that carries its own TDS is never counted again: an entry naming it adds TDS, not its amount.
const TDSSep = {
  // the deductee of a TDS entry of its own, else ""
  partyOf(v){
    const ent = v.ent || [];
    if (!ent.some(e => { const m = Books.ledgerOf(e.l); return m.kind === "tds_payable" && e.a > 0 && !/^192/.test(String(m.section || "")); })) return "";   // salary TDS (192) is 24Q's
    const masters = Audit.mastersIn(), bankish = l => Books.ledgerOf(l).kind === "bank" || (masters && (Audit.isBankL(l) || Audit.isCash(l)));
    const rest = ent.filter(e => !Books.ledgerOf(e.l).kind && Math.abs(e.a) >= 0.005);
    const dr = rest.filter(e => e.a < 0), cr = rest.filter(e => e.a > 0 && !bankish(e.l));
    if (dr.length !== 1 || cr.length) return "";
    const l = dr[0].l;
    if (Audit.isExpense(l) || (masters && Audit.under(l, /^(purchase accounts|fixed assets|duties & taxes|sales accounts|direct incomes|indirect incomes|capital account)$/i))) return "";
    return l;
  },
  // the section a bill's expense ledger points to ("" when nothing says): AI help's choice, the ledger's nature of payment
  // in Tally, its name (not TDSWatch.ruleOf's last step, which reads the deduction rows being made here)
  secOfLedger(l){
    const ai = typeof AIH === "object" && AIH.tdsRule ? AIH.tdsRule(l) : undefined;
    let rule = ai && ai !== "none" ? ai : "";
    if (!rule && ai !== "none" && !(Audit.NO_TDS_RE && Audit.NO_TDS_RE.test(l))){
      rule = TDSRate.kindOf((((S.books || {}).ledInfo || {})[l] || {}).tdsNature);
      if (!rule){ const k = Audit.TDS_KEY.find(([re]) => re.test(l)); rule = k ? k[1] : ""; }
    }
    const R = rule ? RULE_DEFAULTS.find(z => z.id === rule) : null;
    return R && R.old ? TDS.sec(R.old) : "";
  },
  // the party's bills: entries that credit the party with an expense, by the party's ledger (TDS.led, as the TDS entry's
  // deductee; next-fix-tds-party: a bill under the name "Kite Estates" crediting "Kite Estates LLP-UP" was missed)
  bills(){
    const out = {}, masters = Audit.mastersIn();
    ((S.books || {}).vouchers || []).forEach(v => {
      if (v.opt || v.cancel || Books.isSale(v)) return;
      let party = TDS.led(v), pe = party && (v.ent || []).find(e => e.l === party && e.a > 0);
      if (!pe && masters){ const c = (v.ent || []).filter(e => e.a > 0 && Audit.isCreditor(e.l)); if (c.length === 1){ pe = c[0]; party = pe.l; } }
      if (!pe) return;
      let amount = 0; const leds = [];
      (v.ent || []).forEach(e => { if (e.a < 0 && e.l !== party && !Books.ledgerOf(e.l).kind){ amount += -e.a; leds.push(e.l); } });
      if (!(amount > 0)) return;
      const d = TDS.ymd(v.date), fyEnd = TDS.fyOf(d).slice(0, 4) * 1 + 1 + "0331", due = TDS.dueDate(d);
      const refs = new Set();
      (pe.b || []).forEach(z => { if (z[0] && /new/i.test(z[1] || "")) refs.add(String(z[0]).trim().toUpperCase()); });
      [v.no, v.ref].forEach(z => { const t = String(z || "").trim().toUpperCase(); if (t.length >= 3) refs.add(t); });
      const secs = leds.map(l => this.secOfLedger(l)).filter(Boolean);
      (out[party] = out[party] || []).push({vid: v.id, date: d, no: v.ref || v.no || "", amount: r2(amount), left: r2(amount), ledgers: leds, refs,
        own: Books.lines(v).tds.length > 0, sec: secs[0] || "", end: due > fyEnd ? due : fyEnd});
    });
    return out;
  },
  // the rate that applies to the row: a certificate's, else as the rate check works it (PAN, what was paid for, 206AA)
  rateFor(r){
    try { const c = Certs.forRow(r); if (c && num(c.rate)) return num(c.rate); } catch (e){}
    let e = null; try { e = Certs.expectedNormal(r); } catch (z){}
    if (e && e.rate) return e.rate;
    const std = TDS.STD[TDS.sec(r.section)] || [];
    return std.length ? Math.max(...std) : 0;
  },
  // does the bill's own name appear in the entry: its Agst Ref names, or its number in the narration
  named(bl, agst, narr){
    for (const ref of bl.refs){
      if (agst.has(ref)) return true;
      if (ref.length >= 3 && narr && new RegExp("(^|[^A-Z0-9])" + ref.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&") + "($|[^A-Z0-9])").test(narr)) return true;
    }
    return false;
  },
  link(rows){
    const todo = rows.filter(r => r.sep && !(r.paid > 0) && r.tds > 0 && r.party);
    if (!todo.length) return rows;
    const byId = {}, idx = this.bills();
    ((S.books || {}).vouchers || []).forEach(v => { byId[v.id] = v; });
    todo.sort((a, c) => TDS.ymd(a.date).localeCompare(TDS.ymd(c.date)) || String(a.id).localeCompare(String(c.id))).forEach(r => {
      const v = byId[String(r.id).split("|")[0]] || {ent: []}, d = TDS.ymd(r.date), sec = TDS.sec(r.section), list = idx[r.party] || [];
      const pe = (v.ent || []).find(e => e.l === r.party), agst = new Set(((pe && pe.b) || []).filter(z => z[0] && /agst/i.test(z[1] || "")).map(z => String(z[0]).trim().toUpperCase()));
      const narr = String(v.narr || "").toUpperCase();
      let exp = this.rateFor(r);
      const rates = Array.from(new Set([exp].concat(TDS.STD[sec] || []).filter(x => x > 0)));
      const fits = base => rates.some(rate => Math.abs(base * rate / 100 - r.tds) <= Math.max(1, r.tds * 0.01));
      const open = bl => !bl.own && bl.left > 0.5 && bl.date <= d && d <= bl.end && (!bl.sec || bl.sec === sec);
      let hit = list.filter(bl => bl.date <= d && this.named(bl, agst, narr)), how = hit.length ? "ref" : "";
      if (!hit.length){
        const one = list.filter(bl => open(bl) && fits(bl.left)).sort((a, c) => c.date.localeCompare(a.date))[0];
        if (one){ hit = [one]; how = "amount"; }
      }
      if (!hit.length){
        const cand = list.filter(open), months = Array.from(new Set(cand.map(bl => bl.date.slice(0, 6)))).sort().reverse();
        for (const m of months){ const g = cand.filter(bl => bl.date.slice(0, 6) === m); if (g.length > 1 && fits(g.reduce((s, bl) => s + bl.left, 0))){ hit = g; break; } }
        for (let k = 2; !hit.length && k <= months.length; k++){ const g = cand.filter(bl => months.slice(0, k).includes(bl.date.slice(0, 6))); if (fits(g.reduce((s, bl) => s + bl.left, 0))) hit = g; }
        if (hit.length) how = "month";
      }
      if (!hit.length){ r.covers = exp ? r2(r.tds * 100 / exp) : 0; return; }   // matched to no bill: what its TDS covers at the rate
      hit.sort((a, c) => a.date.localeCompare(c.date));
      const fresh = hit.filter(bl => !bl.own), paid = r2(fresh.reduce((s, bl) => s + bl.left, 0));
      fresh.forEach(bl => { bl.left = 0; });
      r.credit = hit[0].date; r.bill = hit.map(bl => bl.no).filter(Boolean).join(", "); r.bills = hit.map(bl => ({vid: bl.vid, date: bl.date, no: bl.no, amount: bl.amount}));
      r.paid = paid; r.rateFrom = "bill (" + how + ")";
      // what was paid for: the bill's expense ledger (professional or technical, building or machinery)
      const kind = hit.map(bl => bl.ledgers.map(l => TDSRate.kindOf((((S.books || {}).ledInfo || {})[l] || {}).tdsNature) || TDSRate.kindOf(l)).find(Boolean)).find(Boolean);
      if (kind) r.pay = kind;
      if (!(paid > 0)){ r.rate = null; r.topUp = true; r.covers = 0; return; }   // every bill named carries its own TDS: not counted again
      r.rate = r2(r.tds / paid * 100);
      exp = this.rateFor(r) || exp;
      if (exp && r.tds < r2(paid * exp / 100) - Math.max(1, paid * exp / 100 * 0.01)){ r.sepShort = true; r.covers = r2(r.tds * 100 / exp); }
      else r.covers = paid;
    });
    return rows;
  }
};

// T-A3. Lower-deduction certificates (section 197; 395 of the Act of 2025) with their amount limit: a certificate covers the
// deductee's payments of its section from its first day to its last, matched by PAN where both have one (else by name),
// up to its amount. Its use is the payments it covered, in date order; once the amount is used, or after its last day,
// the usual rate applies again. Certs.forRow / expected (src/js/18) ask here.
const TDSLdc = {
  // each certificate's rows in date order, with what was used before each: {certId: {used, rows: [{id, paid, before}]}}
  use(){ return typeof perRender === "function" ? perRender(this, "use", () => this.useNow()) : this.useNow(); },
  useNow(){
    const out = {}, certs = Certs.all();
    certs.forEach(c => { out[c.id] = {used: 0, rows: [], byRow: {}}; });
    if (!certs.length) return out;
    TDS.allRows().slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id))).forEach(r => {
      const c = certs.find(x => this.covers(x, r));
      if (!c) return;
      const u = out[c.id], before = u.used;
      u.rows.push({id: r.id, paid: r.paid, before}); u.byRow[r.id] = before; u.used = r2(u.used + num(r.paid));
    });
    return out;
  },
  covers(c, r){
    const sec = TDS.sec(c.section), cp = String(c.pan || "").toUpperCase(), rp = String(r.pan || "").toUpperCase();
    if (sec && sec !== TDS.sec(r.section)) return false;
    const who = Certs.validPan(cp) && Certs.validPan(rp) ? cp === rp : normName(c.party) === normName(r.party);
    if (!who) return false;
    const d = TDS.ymd(r.date);
    return (!c.from || d >= TDS.ymd(c.from)) && (!c.to || d <= TDS.ymd(c.to));
  },
  // a certificate's state, for its list: used, left, and a warning at 80% and near or past its last day
  state(c){
    const u = this.use()[c.id] || {used: 0}, lim = num(c.limit), used = r2(u.used), today = TDSFiled.todayIst(), to = TDS.ymd(c.to);
    const days = to ? Math.round((new Date(to.slice(0, 4) + "-" + to.slice(4, 6) + "-" + to.slice(6, 8)) - new Date(today.slice(0, 4) + "-" + today.slice(4, 6) + "-" + today.slice(6, 8))) / 86400000) : null;
    let st = "ok", words = "In force";
    if (days != null && days < 0){ st = "ended"; words = "Ended " + fmtDate(tallyDate(to)); }
    else if (lim && used >= lim - 0.5){ st = "full"; words = "Amount used up: the usual rate applies"; }
    else if (lim && used >= lim * 0.8){ st = "warn"; words = Math.floor(used / lim * 100) + "% of the amount used"; }
    else if (days != null && days <= 30){ st = "warn"; words = "Ends in " + days + " day" + (days === 1 ? "" : "s"); }
    return {used, left: lim ? r2(Math.max(0, lim - used)) : null, st, words, days};
  }
};

// T-A4. The TDS payable ledgers in Tally against the return, quarter by quarter: they should move by the TDS deducted less
// the challans deposited. The day book's own entries to those ledgers (TDS payable and the month-end clearing account) are
// added up; a difference is named. The challans are also set against the TDS payments in Tally.
const TDSTie = {
  quarters(fy){ return ["Q1", "Q2", "Q3", "Q4"].map(q => this.quarter(fy, q)); },
  quarter(fy, q){
    const inQ = d => TDS.fyOf(d) === fy && TDS.qOf(d) === q;
    const tcsCh = new Set(TDS.tcsRows().filter(r => r.challan).map(r => r.challan));
    const deducted = r2(TDS.allRows().filter(r => r.fy === fy && r.q === q).reduce((a, r) => a + r.tds, 0));
    const ch = TDS.challans().filter(c => inQ(c.date) && !tcsCh.has(c.id)), challans = r2(ch.reduce((a, c) => a + num(c.tax), 0));
    const paidBooks = r2(TDS.paymentsFromBooks().filter(p => inQ(p.date)).reduce((a, p) => a + p.tax, 0));
    let moved = 0, n = 0;
    ((S.books || {}).vouchers || []).forEach(v => {
      if (v.opt || v.cancel || !inQ(v.date)) return;
      v.ent.forEach(e => { const k = Books.ledgerOf(e.l).kind; if (k === "tds_payable" || k === "tds_clearing"){ moved += e.a; n++; } });
    });
    moved = r2(moved);
    const should = r2(deducted - challans), gap = r2(moved - should), chGap = r2(challans - paidBooks);
    return {fy, q, deducted, challans, paidBooks, should, moved, gap, chGap, entries: n, ok: Math.abs(gap) < 1 && Math.abs(chGap) < 1};
  },
  // the difference in words
  why(x){
    const out = [];
    if (Math.abs(x.gap) >= 1) out.push((x.gap > 0 ? "The TDS ledgers in Tally rose by " : "The TDS ledgers in Tally fell by ") + "₹" + INR.format(Math.abs(x.gap)) +
      " more than TDS deducted less challans: an entry to a TDS ledger that is neither a deduction nor a payment (a journal adjusting it), a payment not entered as a challan here, or a challan here not paid in Tally.");
    if (Math.abs(x.chGap) >= 1) out.push(x.chGap > 0 ? "Challans here are ₹" + INR.format(x.chGap) + " more than the TDS payments in Tally: a payment is missing in Tally, or a challan is entered twice."
      : "TDS payments in Tally are ₹" + INR.format(-x.chGap) + " more than the challans here: make a challan of each payment (Challans tab).");
    return out;
  }
};

// T-S1. Each party's running total for the year by payment type, from the day book, against the TDS limit (194C 30,000 a
// bill or 1,00,000 a year, 194J 50,000, 194H 20,000, 194-I 50,000 a month, 194A 10,000), and the list of parties over the
// limit whose payments are not covered by TDS: the TDS due, interest at 1% a month from each bill to today, and the 30% of
// the expense at risk under section 40(a)(ia). The payment type: AI help's choice, else the ledger's nature of payment in
// Tally, else its name (Audit.TDS_KEY); the rate: the PAN's 4th letter, 20% with no PAN (206AA).
const TDSWatch = {
  year(fy){ return typeof perRender === "function" ? perRender(this, "y|" + fy, () => this.yearNow(fy)) : this.yearNow(fy); },
  ruleOf(l){
    const ai = typeof AIH === "object" && AIH.tdsRule ? AIH.tdsRule(l) : undefined;
    if (ai === "none") return "";
    if (ai) return ai;
    if (Audit.NO_TDS_RE && Audit.NO_TDS_RE.test(l)) return "";
    const nat = TDSRate.kindOf(((S.books.ledInfo || {})[l] || {}).tdsNature);
    if (nat) return nat;
    const k = Audit.TDS_KEY.find(([re]) => re.test(l));
    if (k) return k[1] === "rent_building" && /PLANT|MACHIN|EQUIPMENT/i.test(l) ? "rent_machinery" : k[1];
    // a ledger that carries TDS elsewhere in the books: the kind of that TDS ("Sound and Light Hire" with 194C: a contract)
    return (typeof perRender === "function" ? perRender(this, "byLedger", () => this.byLedger()) : this.byLedger())[l] || "";
  },
  byLedger(){
    const out = {}, byId = {};
    ((S.books || {}).vouchers || []).forEach(v => { byId[v.id] = v; });
    TDS.allRows().forEach(r => {
      const sec = TDS.sec(r.section), v = byId[String(r.id).split("|")[0]];
      const rule = sec === "194J" ? (r.pay === "technical" || r.pay === "director" ? r.pay : "professional") : sec === "194I" ? (r.pay === "rent_machinery" ? r.pay : "rent_building")
        : ((RULE_DEFAULTS.find(z => z.old && TDS.sec(z.old) === sec && z.basis !== "never" && !z.form) || {}).id || "");
      if (!rule || !v) return;
      const p = TDS.led(v);
      v.ent.forEach(e => { if (e.a < 0 && e.l !== p && !Books.ledgerOf(e.l).kind && !out[e.l]) out[e.l] = rule; });
    });
    return out;
  },
  yearNow(fy){
    const b = S.books || {}, agg = {}, start = fy.slice(0, 4) + "0401", end = (num(fy.slice(0, 4)) + 1) + "0331";
    (b.vouchers || []).forEach(v => {
      if (v.opt || v.cancel || Books.isSale(v)) return;
      // round 69: an entry that names no party (a journal "Freight Dr / Sharma Roadways Cr"): the one supplier it credits, as
      // the audit's own check took it before the audit came to read this list. The party: its ledger (TDS.led), the name the
      // deduction rows carry too (next-fix-tds-party: a bill named apart from its ledger was left out of the limits)
      let party = TDS.led(v);
      if (!party){ const cr = v.ent.filter(e => e.a > 0 && Audit.isCreditor(e.l)); if (cr.length === 1) party = cr[0].l; }
      if (!party) return;
      const d = TDS.ymd(v.date); if (d < start || d > end) return;
      const pe = v.ent.find(e => e.l === party); if (!pe || !(pe.a > 0)) return;
      if (/\bBANK\b|GOVERNMENT|MUNICIPAL|\bLIC\b/i.test(party)) return;
      v.ent.forEach(e => {
        if (!(e.a < 0) || e.l === party || Books.ledgerOf(e.l).kind) return;
        if (Audit.mastersIn() && !Audit.isExpense(e.l)) return;
        const rule = this.ruleOf(e.l); if (!rule) return;
        const k = party + "|" + rule, x = agg[k] = agg[k] || {party, rule, credited: 0, max: 0, months: {}, credits: [], ledgers: new Set()};
        const a = r2(-e.a); x.credited = r2(x.credited + a); x.max = Math.max(x.max, a); x.months[d.slice(0, 6)] = r2((x.months[d.slice(0, 6)] || 0) + a);
        x.credits.push({date: d, amount: a, voucher: v.no || v.ref || "", vid: v.id, ledger: e.l}); x.ledgers.add(e.l);
      });
    });
    // a deduction counts for the year of the bill it is for (a TDS entry of its own after the bill: r.credit, TDSSep)
    const rows = TDS.allRows().filter(r => (r.credit ? TDS.fyOf(r.credit) : r.fy) === fy), today = TDSFiled.todayIst(), out = [];
    Object.values(agg).forEach(x => {
      let R = RULE_DEFAULTS.find(z => z.id === x.rule); if (!R || R.basis === "never") return;
      // bridge 2.4.3: the thresholds of the nature of payment Tally keeps on these ledgers (its TDSRate master), as Tally has them
      const TT = typeof TDSTally === "object" ? TDSTally.threshold(Array.from(x.ledgers), start, R) : null;   // only the same section, a year's or a bill's limit, and only where stricter (review 243 H4)
      if (TT) R = Object.assign({}, R, TT.limit ? {limit: TT.limit} : {}, TT.single ? {single: TT.single} : {}, {fromTally: TT.nature});
      const sec = TDS.sec(R.old), mine = rows.filter(r => r.party === x.party && TDS.sec(r.section) === sec);
      const tds = r2(mine.reduce((a, r) => a + r.tds, 0));
      // the base the deductions cover: their amount paid, or worked back from the TDS at the usual rate when Tally's entry has none
      // (the owner, 19-Oct-2026) a TDS entry of its own matched to its bills says what it covers (r.covers, TDSSep): its bills,
      // what its TDS covers at the rate when short, nothing again for a bill that carries its own TDS
      const covered = r2(mine.reduce((a, r) => a + (typeof r.covers === "number" ? r.covers : r.paid > 0 ? r.paid : r.rate ? r.tds * 100 / r.rate : r.tds * 100 / ((TDS.STD[sec] || [])[0] || 1)), 0));
      const monthsOver = Object.entries(x.months).filter(([, a]) => a > R.limit);
      const over = R.basis === "single_or_annual" ? (x.max > R.single || x.credited > R.limit) : R.basis === "single" ? x.max >= R.single : R.basis === "always" ? x.credited > 0
        : R.basis === "monthly" ? monthsOver.length > 0 : x.credited > R.limit;
      // the amount TDS applies to: the whole year once the year's limit is crossed; else the single bills over the bill limit
      // (194C), the months over the monthly limit (194-I), or what is above the limit (194Q)
      const counts = c => R.basis === "single_or_annual" ? (x.credited > R.limit || c.amount > R.single) : R.basis === "monthly" ? x.months[c.date.slice(0, 6)] > R.limit : true;
      let base = R.basis === "excess" ? Math.max(0, x.credited - R.limit) : r2(x.credits.filter(counts).reduce((a, c) => a + c.amount, 0));
      if (!over) base = 0;
      const pan = TDS.panOf(x.party), pk = TDSRate.panKind(pan);
      const usual = pk === "P" || pk === "H" ? R.rateInd : R.rateOth, rate = pk ? usual : noPanRate(R, usual);
      const uncovered = r2(Math.max(0, base - covered));
      // interest: 1% a month from each bill to today, on the TDS of what the deductions do not cover (the latest bills first)
      let left = uncovered, interest = 0;
      x.credits.filter(counts).slice().sort((a, c) => c.date.localeCompare(a.date)).forEach(c => {
        if (left <= 0) return; const part = Math.min(left, c.amount); left = r2(left - part);
        interest += part * rate / 100 * 0.01 * TDS.monthsBetween(c.date, today);
      });
      const limitWords = R.basis === "single_or_annual" ? "₹" + INR.format(R.single) + " a bill or ₹" + INR.format(R.limit) + " a year" : R.basis === "monthly" ? "₹" + INR.format(R.limit) + " a month"
        : R.basis === "always" ? "any amount" : R.basis === "single" ? "₹" + INR.format(R.single) + " a payment" : "₹" + INR.format(R.limit) + " a year";
      const used = R.basis === "monthly" ? Math.max.apply(null, Object.values(x.months)) / R.limit : R.basis === "single_or_annual" ? Math.max(x.credited / R.limit, x.max / R.single) : R.limit ? x.credited / R.limit : 1;
      out.push({party: x.party, rule: x.rule, section: R.old, label: R.label, ledgers: Array.from(x.ledgers), credited: x.credited, limitWords: limitWords + (R.fromTally ? " (Tally: " + R.fromTally + ")" : ""), limitFrom: R.fromTally || "", used: r2(used * 100), over, tds, covered, base, pan, rate,
        uncovered, due: r2(uncovered * rate / 100), short: mine.some(r => r.sepShort), interest: r2(interest), disallow: r2(uncovered * 0.3),
        // each credit marked whether it counts towards the TDS (round 69: the audit's entries behind the finding)
        credits: x.credits.map(c => Object.assign({}, c, {counts: !!over && !!counts(c)}))});
    });
    return out.sort((a, c) => c.used - a.used);
  },
  // the parties to look at: over the limit or at 80% of it
  tracker(fy){ return this.year(fy).filter(x => x.over || x.used >= 80); },
  // the parties over the limit whose payments the deductions do not cover
  missed(fy){ return this.year(fy).filter(x => x.over && x.due >= 1); }
};

// T-S2. A filed return's entries, kept when it is marked filed (b.tdsSnap, with the books: shared through client_books,
// no new table): after Tally is read again, what was added, changed or deleted in the quarter since, and the kind of
// correction each needs (C3: a deductee row added, changed or set to nil; C5: the PAN alone). A person confirms when the
// correction is filed, and the copy is then taken again.
const TDSDrift = {
  rowOf(r){ return [TDS.ymd(r.date), r.party || "", String(r.pan || "").toUpperCase(), r.section || "", r2(num(r.paid)), r2(num(r.tds))]; },
  keep(fy, q, form){
    const b = S.books, rows = {};
    TDS.formRows(form).filter(r => r.fy === fy && r.q === q).forEach(r => { rows[r.id] = this.rowOf(r); });
    b.tdsSnap = Object.assign({}, b.tdsSnap);
    b.tdsSnap[TDSFiled.key(fy, q, form)] = {at: new Date().toISOString(), rows};
  },
  check(fy, q, form){
    const s = ((S.books || {}).tdsSnap || {})[TDSFiled.key(fy, q, form)];
    if (!s || !s.rows) return null;
    const now = {}, out = [];
    TDS.formRows(form).filter(r => r.fy === fy && r.q === q).forEach(r => { now[r.id] = this.rowOf(r); });
    const money = v => "₹" + INR.format(v);
    Object.keys(now).forEach(id => {
      const n = now[id], w = s.rows[id];
      if (!w){ out.push({id, what: "added", type: "C3", party: n[1], tds: n[5], words: "added in Tally: " + money(n[5]) + " TDS on " + fmtDate(tallyDate(n[0]))}); return; }
      const ch = [];
      if (w[0] !== n[0]) ch.push("date " + fmtDate(tallyDate(w[0])) + " → " + fmtDate(tallyDate(n[0])));
      if (w[1] !== n[1]) ch.push("deductee " + w[1] + " → " + n[1]);
      if (w[3] !== n[3]) ch.push("section " + w[3] + " → " + n[3]);
      if (Math.abs(w[4] - n[4]) >= 0.5) ch.push("amount " + money(w[4]) + " → " + money(n[4]));
      if (Math.abs(w[5] - n[5]) >= 0.5) ch.push("TDS " + money(w[5]) + " → " + money(n[5]));
      const pan = w[2] !== n[2];
      if (!ch.length && !pan) return;
      out.push({id, what: "changed", type: ch.length ? "C3" : "C5", party: n[1], tds: n[5], words: ch.concat(pan ? ["PAN " + (w[2] || "none") + " → " + (n[2] || "none")] : []).join("; ")});
    });
    Object.keys(s.rows).forEach(id => { if (!now[id]){ const w = s.rows[id]; out.push({id, what: "deleted", type: "C3", party: w[1], tds: w[5], words: "deleted in Tally: " + money(w[5]) + " TDS of " + fmtDate(tallyDate(w[0])) + " (set it to nil in the correction)"}); } });
    return {at: s.at, rows: out};
  },
  async corrected(fy, q, form){
    const d = this.check(fy, q, form); if (!d || !d.rows.length) return false;
    const ok = await askConfirm({title: "Correction filed?", body: "The copy of " + esc(TDS.formShort(form, fy) + ", " + q + " " + fy) + " is taken again from the books as they are now, and the " + d.rows.length + " change" + (d.rows.length === 1 ? "" : "s") + " listed stop showing. Do this once the correction statement is filed.", ok: "Correction filed"});
    if (!ok || !ok.ok) return false;
    this.keep(fy, q, form);
    const k = TDSFiled.key(fy, q, form), f = (S.books.tdsFiled || {})[k];
    if (f){ S.books.tdsFiled = Object.assign({}, S.books.tdsFiled); S.books.tdsFiled[k] = Object.assign({}, f, {corrected: (f.corrected || []).concat([new Date().toISOString()])}); }
    try { auditEvent("tds_correction_filed", {form, fy, q, changes: d.rows.length}, S.coId); } catch (e){}
    saveBooks(); render(); return true;
  }
};
