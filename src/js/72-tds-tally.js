/* ================================================================== */
/* TDS from Tally: challans, their tagging, certificates, thresholds  */
/* ================================================================== */
// Bridge 2.4.3 (the owner's approval of 11-Oct-2026): what Tally keeps about TDS reaches FinCom's cloud copy and is used
// here, beside what a person enters in FinCom:
//   - a TDS payment's challan (BSR code, number, date; the cheque, bank and branch), on the payment or per nature where
//     Tally's Challan Reconciliation writes it: a challan is made from it ("From Tally"), its tax, interest and late fee
//     split by what each line of the payment pays (Tally's TYPEOFTAXPAYMENT), so the FVU's challan record carries them;
//   - the link Tally keeps from a payment to each deduction it pays (TAXOBJECTALLOCATIONS: the same reference, Agst Ref on
//     the payment, New Ref on the deduction): the deduction is tagged to the payment's challan ("From Tally"). A deduction
//     FinCom already tags to another challan is never moved: the disagreement is shown, for a person to decide;
//   - a TDS ledger's nature of payment (TDSRATENAME) and the nature's own section (Tally's TDSRate master): the section
//     the books read for that ledger, preferred over the section in its name (a person's own choice stays);
//   - a party's lower-deduction certificates: in FinCom's list ("From Tally"); a certificate FinCom has under the same
//     number is kept as it is, and where it differs from Tally the difference is shown;
//   - each nature's thresholds (the year's limit, the single bill's): used by the limits tracker for the ledgers of that
//     nature, said as Tally's.
// Nothing here is worked out by AI; every figure is Tally's stored value or FinCom's own rule. sync() runs when the books
// come in from the cloud copy (TCloud.load) and is safe to run again (nothing is added twice).
const TDSTally = {
  p: (v) => Math.round(num(v) * 100),
  books(){ return S.books || {}; },
  // the nature of payment Tally keeps on a ledger: the cloud's ledger list (2.4.3), else the masters read with the books
  natureOf(ledger){
    const b = this.books();
    return String(((b.ledTds || {})[ledger] || {}).nature || ((b.ledInfo || {})[ledger] || {}).tdsNature || "").trim();
  },
  // the nature's row that applies on a date (Tally's CATEGORYDETAILS by APPLICABLEFROM: the latest on or before it, else
  // the first): {from, section, rate, other, nopan, nopanOther, limit, single}
  cat(nature, date){
    const n = (this.books().tdsNat || {})[String(nature || "").trim()];
    if (!n || !(n.cats || []).length) return null;
    const d = TDS.ymd(date) || "99999999";
    const rows = n.cats.map(c => ({from: String(c[0] || ""), section: String(c[1] || "").trim(), rate: c[2], other: c[3], nopan: c[4], nopanOther: c[5], limit: num(c[6]), single: num(c[7])}))
      .sort((a, b) => a.from.localeCompare(b.from));
    let hit = null;
    rows.forEach(r => { if (!r.from || r.from <= d) hit = r; });
    return hit || rows[0];
  },
  // a nature's section: the nature master's own (TDSRATESECTION), else the section written in its name; "" when neither
  sectionOf(nature, date){
    const c = this.cat(nature, date);
    if (c && c.section) return TDS.sec(c.section);
    return typeof Books === "object" && Books.secIn ? Books.secIn(String(nature || "").toUpperCase()) : "";
  },
  // a TDS ledger's section from Tally's nature, onto the books' map: preferred over the section guessed from its name; a
  // person's own choice (by hand or confirmed) stays. How many ledgers changed
  sections(b){
    let n = 0;
    Object.keys(b.map || {}).forEach(name => {
      const m = b.map[name];
      if (!m || m.byHand || m.ok || (m.kind !== "tds_payable" && m.kind !== "tcs_payable")) return;
      const nat = this.natureOf(name), sec = nat ? this.sectionOf(nat) : "";
      if (!sec || sec === m.section) return;
      m.sectionGuess = m.section || ""; m.section = sec; m.sectionFrom = "Tally: nature of payment " + nat; n++;
    });
    return n;
  },
  // a payment of TDS (or TCS) as Tally marks it: another duty's Stat Payment (GST) is never read as a TDS challan
  // bridge 2.4.4: salary TDS is Tally's Stat Payment of Income Tax (section 192): its challan is a TDS challan too (24Q)
  isTds(x){ return !!x && (!x.stat || /^(TDS|TCS|Income\s*Tax)\b/i.test(String(x.stat))); },
  // what a payment pays, by Tally's TYPEOFTAXPAYMENT: {tax, interest, fee, others} in rupees. Interest, the late fee and
  // others are the lines Tally marks so; the tax is the rest of the TDS the books see paid (so a tax line whose blank mark
  // was not kept still counts). null when the entry carries no mark, or when the rest is not a tax (the books' rule then)
  split(v){
    const x = v && v.tdsx, k = (x && x.kinds) || [];
    if (!k.length || !this.isTds(x)) return null;
    const L = Books.lines(v), duty = new Set(L.tdsPaid.map(t => t.ledger));
    let paid = r2(L.tdsPaid.reduce((a, t) => a + t.amount, 0));
    // bridge 2.4.4: salary TDS (Stat Payment of Income Tax) is paid from the Income Tax pay head, which the books do not read
    // as a TDS ledger: what it pays is the lines Tally marks with a kind of payment
    if (!(paid > 0) && /^income\s*tax/i.test(String(x.stat || ""))){ paid = r2(k.reduce((a, z) => a + Math.abs(num(z.amt)), 0)); k.forEach(z => duty.add(z.ledger)); }
    const o = {tax: 0, interest: 0, fee: 0, others: 0};
    let out = 0;
    k.forEach(z => {
      const a = Math.abs(num(z.amt)), slot = this.kindOf(z.kind);
      if (slot === "tax") return;
      o[slot] = r2(o[slot] + a);
      if (duty.has(z.ledger)) out = r2(out + a);
    });
    // (review 243 N1) every TDS line marked interest, fee or others (a payment of interest alone): tax 0, never the
    // interest read as tax; more marked than the TDS paid: not Tally's split (the books' rule then)
    o.tax = r2(paid - out);
    if (o.tax < -0.005) return null;
    if (o.tax < 0) o.tax = 0;
    return o;
  },
  kindOf(kind){ const w = String(kind || "").toLowerCase(); return /interest/.test(w) ? "interest" : /fee/.test(w) ? "fee" : /penalty|other/.test(w) ? "others" : "tax"; },
  // the challans Tally keeps on the payments: one for each BSR code, date and number, with the payment it came from. A
  // challan whose amounts cannot be told from Tally's entry is not made: {bad} for a person
  fromVouchers(b){
    const out = [];
    (b.vouchers || []).forEach(v => {
      const x = v.tdsx;
      if (!x || v.cancel || v.opt || !this.isTds(x)) return;
      const sp = this.split(v);
      let tdsPaid = Books.lines(v).tdsPaid.reduce((a, t) => a + t.amount, 0);
      // bridge 2.4.4: salary TDS (Stat Payment of Income Tax) is paid from the Income Tax pay head, which the books do not
      // read as a TDS ledger: its tax is the lines Tally marks Tax (TYPEOFTAXPAYMENT), else the pay head's (Payroll, src/js/73)
      if (!(tdsPaid > 0) && /^income\s*tax/i.test(String(x.stat || ""))){
        tdsPaid = r2((x.kinds || []).filter(z => this.kindOf(z.kind) === "tax").reduce((a, z) => a + Math.abs(num(z.amt)), 0));
        if (!(tdsPaid > 0) && typeof Payroll === "object") tdsPaid = r2((v.ent || []).filter(e => Payroll.isTds(e.l)).reduce((a, e) => a + Math.abs(num(e.a)), 0));
      }
      const list = [];
      if (x.challan && x.challan.bsr) list.push({ch: x.challan, nature: x.nature, section: x.section, paid: null});
      (x.periods || []).forEach(p => { if (p.challan && p.challan.bsr) list.push({ch: p.challan, nature: p.nature, section: p.section, paid: p.paid}); });
      const kOf = (z) => z.ch.bsr + "|" + TDS.ymd(z.ch.date) + "|" + String(z.ch.no || "").replace(/\D/g, "").padStart(5, "0");
      const keys = Array.from(new Set(list.map(kOf))), solo = keys.length === 1;
      const badOf = (key, it, why) => ({key, vid: v.id, bad: "BSR code " + (it.ch.bsr || "none") + ", challan " + (it.ch.no || "none") + ", date " + (it.ch.date || "none") + (why ? ": " + why : "")});
      // several challans on one payment: each its own paid amount per nature; the interest, fee and others by the nature
      // of their line (one challan for that nature, else none can be made)
      const natKeys = {};
      if (!solo) list.forEach(z => { const n = String(z.nature || "").trim(); (natKeys[n] = natKeys[n] || new Set()).add(kOf(z)); });
      const extras = {}; let shareBad = "";
      if (!solo && sp) (x.kinds || []).forEach(z => {
        const slot = this.kindOf(z.kind); if (slot === "tax") return;
        const ks = natKeys[String(z.nature || "").trim()];
        if (!ks || ks.size !== 1){ shareBad = "the " + slot + " of " + Math.abs(num(z.amt)) + " is not for one challan's nature"; return; }
        const kk = Array.from(ks)[0], e = extras[kk] = extras[kk] || {interest: 0, fee: 0, others: 0};
        e[slot] = r2(e[slot] + Math.abs(num(z.amt)));
      });
      keys.forEach(key => {
        const one = list.filter(z => kOf(z) === key), it = one[0];
        if (!solo && (shareBad || one.some(z => z.paid == null))){ out.push(badOf(key, it, shareBad || "Tally gives no amount for this challan on a payment of several challans")); return; }
        const tax = solo ? (sp ? sp.tax : r2(tdsPaid)) : r2(one.reduce((a, z) => a + Math.abs(num(z.paid)), 0));
        const e = solo ? (sp || {}) : (extras[key] || {});
        if (!(tax > 0) && !(num(e.interest) > 0 || num(e.fee) > 0 || num(e.others) > 0)){ out.push(badOf(key, it, "no amount")); return; }
        // TDSCH.make reads eight digits as ddmmyyyy (the portal's form): Tally's yyyymmdd goes as yyyy-mm-dd
        const d = TDS.ymd(it.ch.date), iso = d.length === 8 ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) : "";
        const c = TDSCH.make({bsr: it.ch.bsr, serial: it.ch.no, date: iso, tax, interest: e.interest || 0, fee: e.fee || 0,
          others: e.others || 0, section: it.section || this.sectionOf(it.nature, it.ch.date || v.date)});
        if (c) out.push(Object.assign(c, {key, vid: v.id, chq: it.ch.chq || "", bank: it.ch.bank || "", branch: it.ch.branch || ""}));
        else out.push(badOf(key, it, ""));
      });
    });
    return out;
  },
  // a challan this sync made (and only such a one is changed or removed by it); a challan a person made from a Tally
  // payment ("Make it a challan", before 2.4.3 also marked from "tally") is a person's (review 243 R1)
  made(c){ return !!c && (c.madeBy === "tally-sync" || String(c.id || "").indexOf("tally:") === 0); },
  // a TDS payment in the books not yet a challan: no challan names it, and none without a payment has its date and tax
  // (review 243 R3)
  notChallan(p, challans){
    const cs = challans || [];
    if (cs.some(c => c.fromVoucher === p.vid)) return false;
    return !cs.some(c => !c.fromVoucher && TDS.ymd(c.date) === TDS.ymd(p.date) && Math.abs(num(c.tax) - num(p.tax)) < 1);
  },
  keyOf(c){ return TDSCH.chKey(c); },
  // the links Tally keeps: [{row: the deduction's row id, vid: the paying voucher, ref}] where exactly one deduction carries
  // the payment's reference for that party and duty ledger (Tally's reference names are unique only per party and duty,
  // and are often a voucher number); [{row, vid, ref, many}] where several do (none tagged: a person decides)
  refKey(r, party){ return String(r.ref) + "|" + String(party || "").trim().toUpperCase() + "|" + String(r.duty || "").trim().toUpperCase(); },
  links(b){
    const ded = {}, pay = [];
    (b.vouchers || []).forEach(v => {
      if (v.cancel || v.opt || !v.tdsx || !this.isTds(v.tdsx)) return;
      (v.tdsx.refs || []).forEach(r => {
        if (!r.ref || !r.duty) return;
        if (/new/i.test(r.type || "")) (ded[this.refKey(r, r.party || r.ledger)] = ded[this.refKey(r, r.party || r.ledger)] || []).push({row: v.id + "|" + r.duty, nature: r.nature || "", date: TDS.ymd(v.date)});
        else if (/agst/i.test(r.type || "") && r.party) pay.push({vid: v.id, ref: r.ref, key: this.refKey(r, r.party), nature: r.nature || "", date: TDS.ymd(v.date)});
      });
    });
    const out = [], fyStart = (d) => num(TDS.fyOf(d).slice(0, 4));
    pay.forEach(p => {
      const d = (ded[p.key] || []).filter(z => !p.nature || !z.nature || z.nature === p.nature);
      const rows = Array.from(new Set(d.map(z => z.row)));
      if (rows.length !== 1){ rows.forEach(row => out.push({row, vid: p.vid, ref: p.ref, many: rows.length})); return; }
      // (review 243 N2) a payment dated before its deduction, or in a year after the next, is not its payment (another
      // year's reference of the same name): listed, never tagged
      const z = d.find(q => q.row === rows[0]);
      if (z.date && p.date && p.date < z.date) out.push({row: rows[0], vid: p.vid, ref: p.ref, why: "Tally's payment of reference " + p.ref + " is dated before the deduction: tag it by hand"});
      else if (z.date && p.date && fyStart(p.date) > fyStart(z.date) + 1) out.push({row: rows[0], vid: p.vid, ref: p.ref, why: "Tally's payment of reference " + p.ref + " is more than a year after the deduction: tag it by hand"});
      else out.push({row: rows[0], vid: p.vid, ref: p.ref});
    });
    // (review 243 N2) one deduction reached by several payments: none tagged, listed
    const by = {};
    out.forEach(l => { (by[l.row] = by[l.row] || new Set()).add(l.vid); });
    return out.map(l => by[l.row].size > 1 && !l.many && !l.why ? Object.assign({}, l, {why: "Tally pays it with " + by[l.row].size + " payments: tag it by hand"}) : l)
      .filter((l, i, a) => !(by[l.row].size > 1) || a.findIndex(q => q.row === l.row) === i);
  },
  // the certificates Tally keeps on the parties
  certsFrom(b){
    const out = [];
    Object.entries(b.ledTds || {}).forEach(([party, t]) => (t.ldc || []).forEach(c => {
      const [nature, from, to, sec, no, rate, limit] = (c || []).map(x => String(x == null ? "" : x).trim());
      if (!no && !from) return;
      out.push({id: "tally:" + party + ":" + (no || from), src: "tally", party, pan: (b.pans || {})[party] || "", section: this.sectionOf(nature, from) || "",
        certNo: no, rate: num(rate), limit: num(limit), from: TDS.ymd(from), to: TDS.ymd(to), nature, under: sec});
    }));
    return out;
  },
  // the thresholds of the nature a ledger carries, on a date, for FinCom's rule R: {limit, single, nature}, each only where
  // Tally's is stricter (lower) than FinCom's, the nature's section is the rule's, and the rule's limit is a year's or a
  // bill's (never a month's); null when Tally gives nothing that applies
  threshold(ledgers, date, R){
    if (!R || !/^(annual|single|single_or_annual)$/.test(R.basis || "")) return null;
    for (const l of ledgers || []){
      const nat = this.natureOf(l), c = nat ? this.cat(nat, date) : null;
      if (!c || !(c.limit || c.single)) continue;
      if (TDS.sec(this.sectionOf(nat, date)) !== TDS.sec(R.old)) continue;
      // (review 243 N3) a bill-or-year rule (194C) takes Tally's figures only when Tally fills both: one figure alone
      // (Tally 7.1 keeps 194C's bill figure in EXEMPTIONLIMIT, its bill field blank) says not which it is
      if (R.basis === "single_or_annual" && !(c.limit && c.single)) continue;
      const o = {nature: nat};
      if (c.limit && R.basis !== "single" && (!num(R.limit) || c.limit < num(R.limit))) o.limit = c.limit;
      if (c.single && R.basis !== "annual" && (!num(R.single) || c.single < num(R.single))) o.single = c.single;
      return o.limit || o.single ? o : null;
    }
    return null;
  },
  // everything at once, when the books came in: sections, challans, tags, certificates. {challans, updated, tagged,
  // disagree: [...], conflicts: [...], certs}
  sync(b){
    b = b || S.books;
    const res = {sections: 0, challans: 0, updated: 0, removed: 0, tagged: 0, disagree: [], conflicts: [], certs: 0, bad: []};
    if (!b || !b.vouchers) return res;
    // the books of another company (the person switched while these loaded): nothing worked out on them
    if (b !== S.books){ res.skipped = true; return res; }
    res.sections = this.sections(b);
    // ---- the challans
    b.challans = b.challans || [];
    b.alloc = b.alloc || {}; b.allocFrom = b.allocFrom || {};
    const tagged = new Set(Object.values(b.alloc));
    const FIELDS = ["tax", "interest", "fee", "others", "section"];
    const val = (c, k) => k === "section" ? String(c[k] || "") : this.p(c[k]);
    const tallyCh = this.fromVouchers(b), now = {};
    tallyCh.forEach(t => { (now[t.vid] = now[t.vid] || new Set()).add(t.key); });
    // a challan made from Tally that Tally no longer gives (the details corrected, the payment cancelled or gone): left
    // when nothing is tagged to it; kept with its tags otherwise, the difference shown (never a second one made then)
    const held = new Set();
    b.challans = b.challans.filter(c => {
      if (!this.made(c) || (now[c.fromVoucher] && now[c.fromVoucher].has(this.keyOf(c)))) return true;
      // (review 243 N5) only one nobody changed in FinCom leaves; one a person corrected stays, shown like a tagged one
      const was = c.tallyWas || {}, touched = FIELDS.some(k => (k in was) && val(was, k) !== val(c, k));
      if (!tagged.has(c.id) && !touched){ res.removed++; return false; }
      held.add(c.fromVoucher);
      const t = tallyCh.find(z => z.vid === c.fromVoucher && !z.bad);
      res.conflicts.push({kind: "challan", challan: c.id, what: "details", fincom: TDSCH.label(c), tally: t ? t.bsr + "/" + t.date + "/" + t.serial : "no challan (the payment changed or is gone in Tally)", label: TDSCH.label(c)});
      return true;
    });
    const byKey = {}, byVid = {};
    b.challans.forEach(c => { byKey[this.keyOf(c)] = c; if (c.fromVoucher) (byVid[c.fromVoucher] = byVid[c.fromVoucher] || []).push(c); });
    const use = TDS.challanUse ? TDS.challanUse() : {};
    tallyCh.forEach(t => {
      if (t.bad){ res.bad.push(t); return; }
      const have = byKey[t.key];
      const fields = {tax: t.tax, interest: t.interest || 0, fee: t.fee || 0, others: t.others || 0, section: t.section || ""};
      if (have && this.made(have)){
        // Tally's new figure goes in only where nobody changed the challan in FinCom (it still equals what Tally gave
        // last), and a tax is never lowered below what is tagged to it; anything else shown
        const was = have.tallyWas || {};
        let ch = false;
        FIELDS.forEach(k => {
          if (val(have, k) === val(fields, k)) { was[k] = fields[k]; return; }
          const untouched = !(k in was) || val(was, k) === val(have, k);
          const below = k === "tax" && this.p(fields.tax) < this.p(use[have.id] || 0);
          if (untouched && !below){ have[k] = fields[k]; was[k] = fields[k]; ch = true; }
          else { was[k] = fields[k]; res.conflicts.push({kind: "challan", challan: have.id, what: k, fincom: k === "section" ? have[k] : num(have[k]), tally: fields[k], label: TDSCH.label(have)}); }
        });
        have.tallyWas = was;
        if (ch) res.updated++;
        return;
      }
      if (have){
        // a challan a person entered or uploaded: kept as it is; its payment linked; a difference shown
        if (!have.fromVoucher) have.fromVoucher = t.vid;
        ["tax", "interest", "fee"].forEach(k => { if (this.p(have[k]) !== this.p(fields[k])) res.conflicts.push({kind: "challan", challan: have.id, what: k, fincom: num(have[k]), tally: fields[k], label: TDSCH.label(have)}); });
        return;
      }
      if (held.has(t.vid)) return;   // its earlier challan from Tally is kept with its tags: the difference is listed above
      const other = (byVid[t.vid] || []).find(c => !this.made(c));
      if (other){
        // the payment is already a challan FinCom has under other details: not made twice; the difference shown
        res.conflicts.push({kind: "challan", challan: other.id, what: "details", fincom: TDSCH.label(other), tally: t.bsr + "/" + t.date + "/" + t.serial, label: TDSCH.label(other)});
        return;
      }
      const c = {id: "tally:" + t.vid + ":" + t.key, from: "tally", madeBy: "tally-sync", fromVoucher: t.vid, bsr: t.bsr, serial: t.serial, date: t.date, tax: t.tax, interest: t.interest || 0, section: t.section, minorHead: t.minorHead || "200"};
      if (t.fee) c.fee = t.fee;
      if (t.others) c.others = t.others;
      if (t.chq) c.cheque = t.chq;
      if (t.bank) c.bank = t.bank + (t.branch ? ", " + t.branch : "");
      c.tallyWas = {tax: c.tax, interest: c.interest, fee: c.fee || 0, others: c.others || 0, section: c.section || ""};
      if (typeof TDSReg === "object") c.autoPlace = "pending";        // tds-layout: placed once Tally's own tags are in
      b.challans.push(c); byKey[t.key] = c; (byVid[t.vid] = byVid[t.vid] || []).push(c); res.challans++;
    });
    // ---- the tags: a deduction Tally links to a payment that is one challan here
    const rows = {}; TDSCH.rowsAll().forEach(r => { rows[r.id] = r; });
    const want = {};
    this.links(b).forEach(l => {
      const chs = byVid[l.vid] || [];
      if (!rows[l.row]) return;
      if (l.why && !l.many){ res.disagree.push({row: l.row, party: rows[l.row].party, date: rows[l.row].date, fincom: b.alloc[l.row] || "", tally: "", why: l.why}); return; }
      if (l.many){ res.disagree.push({row: l.row, party: rows[l.row].party, date: rows[l.row].date, fincom: b.alloc[l.row] || "", tally: "", why: "Tally's reference " + l.ref + " is on " + l.many + " deductions of this party: tag it by hand"}); return; }
      if (chs.length !== 1){ if (chs.length > 1) res.disagree.push({row: l.row, party: rows[l.row].party, date: rows[l.row].date, fincom: b.alloc[l.row] || "", tally: "", why: "the payment is " + chs.length + " challans here: tag it by hand"}); return; }
      const ch = chs[0], cur = b.alloc[l.row];
      if (!cur && b.allocFrom[l.row] === "off"){ res.disagree.push({row: l.row, party: rows[l.row].party, date: rows[l.row].date, fincom: "", tally: ch.id, why: "taken off Tally's challan " + TDSCH.label(ch) + " by hand: left off"}); return; }
      if (cur === ch.id){ if (!b.allocFrom[l.row]) b.allocFrom[l.row] = "tally"; return; }
      if (cur){
        const was = b.challans.find(c => c.id === cur);
        res.disagree.push({row: l.row, party: rows[l.row].party, date: rows[l.row].date, tds: rows[l.row].tds, fincom: cur, fincomLabel: was ? TDSCH.label(was) : cur, tally: ch.id, tallyLabel: TDSCH.label(ch)});
        return;
      }
      (want[ch.id] = want[ch.id] || []).push(l.row);
    });
    Object.entries(want).forEach(([chId, ids]) => {
      const r = TDSCH.tag(ids, chId, {via: "tally"});
      if (r.ok){ ids.forEach(id => { b.allocFrom[id] = "tally"; }); res.tagged += r.n; }
      else ids.forEach(id => res.disagree.push({row: id, party: rows[id].party, date: rows[id].date, fincom: "", tally: chId, why: r.why}));
    });
    // ---- tds-layout: a challan new from Tally, with nothing tagged by Tally, goes to its own draft return (TDSReg.placeNew)
    if (typeof TDSReg === "object") res.placed = TDSReg.placeNew(true).filter(x => x.placed).length;
    // ---- the certificates
    b.certs = b.certs || [];
    const CF = [["party", String], ["pan", String], ["section", TDS.sec], ["certNo", String], ["rate", num], ["limit", num], ["from", TDS.ymd], ["to", TDS.ymd], ["nature", String], ["under", String]];
    const tc = this.certsFrom(b), mine = b.certs.filter(c => c.src !== "tally");
    const keepIds = new Set();
    tc.forEach(t => {
      const same = mine.find(c => t.certNo && String(c.certNo || "").trim().toUpperCase() === t.certNo.toUpperCase());
      if (same){
        [["rate", num], ["limit", num], ["from", TDS.ymd], ["to", TDS.ymd], ["section", TDS.sec]].forEach(([k, f]) => {
          if (t[k] !== "" && t[k] != null && String(f(same[k] || "")) !== String(f(t[k]))) res.conflicts.push({kind: "certificate", cert: same.id, what: k, fincom: same[k], tally: t[k], label: t.certNo + " (" + t.party + ")"});
        });
        return;
      }
      keepIds.add(t.id);
      const had = b.certs.find(c => c.id === t.id);
      if (!had){ t.tallyWas = Object.fromEntries(CF.map(([k]) => [k, t[k]])); b.certs.push(t); res.certs++; return; }
      // Tally's figure goes in where nobody changed the certificate in FinCom; a person's correction stays, the difference shown
      const was = had.tallyWas || {};
      CF.forEach(([k, f]) => {
        if (String(f(had[k] == null ? "" : had[k])) === String(f(t[k] == null ? "" : t[k]))){ was[k] = t[k]; return; }
        const untouched = !(k in was) || String(f(was[k] == null ? "" : was[k])) === String(f(had[k] == null ? "" : had[k]));
        if (untouched) had[k] = t[k];
        else res.conflicts.push({kind: "certificate", cert: had.id, what: k, fincom: had[k], tally: t[k], label: t.certNo + " (" + t.party + ")"});
        was[k] = t[k];
      });
      had.tallyWas = was;
    });
    // a certificate Tally no longer keeps leaves FinCom's list only when it came from Tally
    // (review 243 N5) one a person corrected stays, the difference shown
    b.certs = b.certs.filter(c => {
      if (c.src !== "tally" || keepIds.has(c.id)) return true;
      const was = c.tallyWas || {}, touched = CF.some(([k, f]) => (k in was) && String(f(was[k] == null ? "" : was[k])) !== String(f(c[k] == null ? "" : c[k])));
      if (touched) res.conflicts.push({kind: "certificate", cert: c.id, what: "certificate", fincom: c.certNo, tally: "no longer in Tally", label: c.certNo + " (" + c.party + ")"});
      return touched;
    });
    b.tallyTds = {at: new Date().toISOString(), disagree: res.disagree, conflicts: res.conflicts, bad: res.bad};
    return res;
  },
  // what is shown on the pages (the last sync)
  disagreements(){ return ((this.books().tallyTds || {}).disagree || []); },
  bad(){ return ((this.books().tallyTds || {}).bad || []); },
  conflicts(kind){ return ((this.books().tallyTds || {}).conflicts || []).filter(c => !kind || c.kind === kind); }
};
