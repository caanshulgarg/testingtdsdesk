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
  // what each TDS line of a payment pays, by Tally's TYPEOFTAXPAYMENT: {tax, interest, fee, others} in rupees (null when
  // the entry carries no such mark: the books' rule then)
  split(v){
    const k = (v && v.tdsx && v.tdsx.kinds) || [];
    if (!k.length) return null;
    const o = {tax: 0, interest: 0, fee: 0, others: 0};
    k.forEach(x => {
      const a = Math.abs(num(x.amt)), w = String(x.kind || "").toLowerCase();
      const slot = /interest/.test(w) ? "interest" : /fee/.test(w) ? "fee" : /penalty|other/.test(w) ? "others" : "tax";
      o[slot] = r2(o[slot] + a);
    });
    return o;
  },
  // the challans Tally keeps on the payments: one for each BSR code, date and number, with the payment it came from
  fromVouchers(b){
    const out = [];
    (b.vouchers || []).forEach(v => {
      const x = v.tdsx;
      if (!x || v.cancel || v.opt) return;
      const sp = this.split(v), tdsPaid = Books.lines(v).tdsPaid.reduce((a, t) => a + t.amount, 0);
      const list = [];
      if (x.challan && x.challan.bsr) list.push({ch: x.challan, nature: x.nature, section: x.section, paid: null});
      (x.periods || []).forEach(p => { if (p.challan && p.challan.bsr) list.push({ch: p.challan, nature: p.nature, section: p.section, paid: p.paid}); });
      const kOf = (z) => z.ch.bsr + "|" + TDS.ymd(z.ch.date) + "|" + String(z.ch.no || "").replace(/\D/g, "").padStart(5, "0");
      const keys = Array.from(new Set(list.map(kOf))), solo = keys.length === 1;
      keys.forEach(key => {
        const one = list.filter(z => kOf(z) === key), it = one[0];
        // the tax: the payment's tax lines (else its TDS lines) when it has one challan; each challan's own paid amount per
        // nature when the payment has several
        const tax = solo ? (sp ? sp.tax : r2(tdsPaid)) : r2(one.reduce((a, z) => a + Math.abs(num(z.paid)), 0));
        // TDSCH.make reads eight digits as ddmmyyyy (the portal's form): Tally's yyyymmdd goes as yyyy-mm-dd
        const d = TDS.ymd(it.ch.date), iso = d.length === 8 ? d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8) : "";
        const c = TDSCH.make({bsr: it.ch.bsr, serial: it.ch.no, date: iso, tax, interest: solo && sp ? sp.interest : 0, fee: solo && sp ? sp.fee : 0,
          others: solo && sp ? sp.others : 0, section: it.section || this.sectionOf(it.nature, it.ch.date || v.date)});
        if (c) out.push(Object.assign(c, {key, vid: v.id, chq: it.ch.chq || "", bank: it.ch.bank || "", branch: it.ch.branch || ""}));
        else out.push({key, vid: v.id, bad: "BSR code " + (it.ch.bsr || "none") + ", challan " + (it.ch.no || "none") + ", date " + (it.ch.date || "none")});
      });
    });
    return out;
  },
  keyOf(c){ return c.bsr + "|" + TDS.ymd(c.date) + "|" + String(c.serial || "").padStart(5, "0"); },
  // the links Tally keeps: [{row: the deduction's row id, vid: the paying voucher, ref}]
  links(b){
    const ded = {}, pay = [];
    (b.vouchers || []).forEach(v => {
      if (v.cancel || v.opt || !v.tdsx) return;
      (v.tdsx.refs || []).forEach(r => {
        if (!r.ref) return;
        if (/new/i.test(r.type || "")) (ded[r.ref] = ded[r.ref] || []).push(v.id + "|" + (r.duty || r.ledger));
        else if (/agst/i.test(r.type || "")) pay.push({vid: v.id, ref: r.ref});
      });
    });
    const out = [];
    pay.forEach(p => (ded[p.ref] || []).forEach(row => out.push({row, vid: p.vid, ref: p.ref})));
    return out;
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
  // the thresholds of the nature a ledger carries, on a date: {limit, single, nature} (null when Tally gives none)
  threshold(ledgers, date){
    for (const l of ledgers || []){
      const nat = this.natureOf(l), c = nat ? this.cat(nat, date) : null;
      if (c && (c.limit || c.single)) return {limit: c.limit, single: c.single, nature: nat};
    }
    return null;
  },
  // everything at once, when the books came in: sections, challans, tags, certificates. {challans, updated, tagged,
  // disagree: [...], conflicts: [...], certs}
  sync(b){
    b = b || S.books;
    const res = {sections: 0, challans: 0, updated: 0, tagged: 0, disagree: [], conflicts: [], certs: 0, bad: []};
    if (!b || !b.vouchers) return res;
    res.sections = this.sections(b);
    // ---- the challans
    b.challans = b.challans || [];
    const byKey = {}, byVid = {};
    b.challans.forEach(c => { byKey[this.keyOf(c)] = c; if (c.fromVoucher) (byVid[c.fromVoucher] = byVid[c.fromVoucher] || []).push(c); });
    const tallyCh = this.fromVouchers(b);
    tallyCh.forEach(t => {
      if (t.bad){ res.bad.push(t); return; }
      const have = byKey[t.key];
      const fields = {tax: t.tax, interest: t.interest || 0, fee: t.fee || 0, others: t.others || 0};
      if (have && have.from === "tally"){
        let ch = false;
        ["tax", "interest", "fee", "others", "section"].forEach(k => { const w = k === "section" ? t.section : fields[k]; if ((have[k] || (k === "section" ? "" : 0)) !== w && !(k !== "section" && this.p(have[k]) === this.p(w))){ have[k] = w; ch = true; } });
        if (ch) res.updated++;
        return;
      }
      if (have){
        // a challan a person entered or uploaded: kept as it is; its payment linked; a difference shown
        if (!have.fromVoucher) have.fromVoucher = t.vid;
        ["tax", "interest", "fee"].forEach(k => { if (this.p(have[k]) !== this.p(fields[k])) res.conflicts.push({kind: "challan", challan: have.id, what: k, fincom: num(have[k]), tally: fields[k], label: TDSCH.label(have)}); });
        return;
      }
      const other = (byVid[t.vid] || []).find(c => c.from !== "tally");
      if (other){
        // the payment is already a challan FinCom has under other details: not made twice; the difference shown
        res.conflicts.push({kind: "challan", challan: other.id, what: "details", fincom: TDSCH.label(other), tally: t.bsr + "/" + t.date + "/" + t.serial, label: TDSCH.label(other)});
        return;
      }
      const c = {id: "tally:" + t.vid + ":" + t.key, from: "tally", fromVoucher: t.vid, bsr: t.bsr, serial: t.serial, date: t.date, tax: t.tax, interest: t.interest || 0, section: t.section, minorHead: t.minorHead || "200"};
      if (t.fee) c.fee = t.fee;
      if (t.others) c.others = t.others;
      if (t.chq) c.cheque = t.chq;
      if (t.bank) c.bank = t.bank + (t.branch ? ", " + t.branch : "");
      b.challans.push(c); byKey[t.key] = c; (byVid[t.vid] = byVid[t.vid] || []).push(c); res.challans++;
    });
    // ---- the tags: a deduction Tally links to a payment that is one challan here
    b.alloc = b.alloc || {}; b.allocFrom = b.allocFrom || {};
    const rows = {}; TDSCH.rowsAll().forEach(r => { rows[r.id] = r; });
    const want = {};
    this.links(b).forEach(l => {
      const chs = byVid[l.vid] || [];
      if (!rows[l.row]) return;
      if (chs.length !== 1){ if (chs.length > 1) res.disagree.push({row: l.row, party: rows[l.row].party, date: rows[l.row].date, fincom: b.alloc[l.row] || "", tally: "", why: "the payment is " + chs.length + " challans here: tag it by hand"}); return; }
      const ch = chs[0], now = b.alloc[l.row];
      if (now === ch.id){ if (!b.allocFrom[l.row]) b.allocFrom[l.row] = "tally"; return; }
      if (now){
        const was = b.challans.find(c => c.id === now);
        res.disagree.push({row: l.row, party: rows[l.row].party, date: rows[l.row].date, tds: rows[l.row].tds, fincom: now, fincomLabel: was ? TDSCH.label(was) : now, tally: ch.id, tallyLabel: TDSCH.label(ch)});
        return;
      }
      (want[ch.id] = want[ch.id] || []).push(l.row);
    });
    Object.entries(want).forEach(([chId, ids]) => {
      const r = TDSCH.tag(ids, chId);
      if (r.ok){ ids.forEach(id => { b.allocFrom[id] = "tally"; }); res.tagged += r.n; }
      else ids.forEach(id => res.disagree.push({row: id, party: rows[id].party, date: rows[id].date, fincom: "", tally: chId, why: r.why}));
    });
    // ---- the certificates
    b.certs = b.certs || [];
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
      if (had) Object.assign(had, t); else { b.certs.push(t); res.certs++; }
    });
    // a certificate Tally no longer keeps leaves FinCom's list only when it came from Tally
    b.certs = b.certs.filter(c => c.src !== "tally" || keepIds.has(c.id));
    b.tallyTds = {at: new Date().toISOString(), disagree: res.disagree, conflicts: res.conflicts, bad: res.bad};
    return res;
  },
  // what is shown on the pages (the last sync)
  disagreements(){ return ((this.books().tallyTds || {}).disagree || []); },
  conflicts(kind){ return ((this.books().tallyTds || {}).conflicts || []).filter(c => !kind || c.kind === kind); }
};
