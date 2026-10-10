/* ================================================================== */
/* TDS: returns marked filed, the rate by who the deductee is, and    */
/* interest for deducting late (the owner's list of 10-Oct-2026)      */
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
  // TDS ledger (its nature, then its name)
  payType(t, v){
    const b = S.books || {}, info = b.ledInfo || {}, out = [];
    (v.ent || []).forEach(e => { if (e.a < 0 && e.l !== v.party && !Books.ledgerOf(e.l).kind) out.push(e.l); });
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
    if (!r || r.paid > 0 || !(r.tds > 0)) return null;
    const idx = typeof perRender === "function" ? perRender(this, "byParty", () => this.index()) : this.index();
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
  // every entry that credits a party with an expense and carries no TDS of its own, by party
  index(){
    const out = {};
    ((S.books || {}).vouchers || []).forEach(v => {
      if (v.opt || v.cancel || !v.party) return;
      const L = Books.lines(v);
      if (L.tds.length) return;
      const pe = (v.ent || []).find(e => e.l === v.party);
      if (!pe || !(pe.a > 0)) return;
      let exp = 0;
      (v.ent || []).forEach(e => { if (e.a < 0 && e.l !== v.party && !Books.ledgerOf(e.l).kind) exp += -e.a; });
      if (exp > 0) (out[v.party] = out[v.party] || []).push({id: v.id, date: TDS.ymd(v.date), no: v.no || v.ref || "", amount: r2(exp)});
    });
    return out;
  }
};
