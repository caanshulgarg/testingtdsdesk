/* @react-lazy: begin 86-tds-match.js (the React app loads this file with its TDS screens: app/src/lib/tdsGlobals.js; build.py react_parts) */
/* ================================================================== */
/* Which challan pays which deduction: the one matcher (next-challan- */
/* match, the owner's request of 17-Oct-2026)                         */
/* ================================================================== */
// "TDS page look is good but it is very confusing which challan to knock off against which deduction.. how do computer do
// that.. set the best practice (see Winman, Computax, ClearTax).. create something any fresher can understand". His
// decisions: a match is SHOWN first and confirmed with one click, never applied by itself; where no one challan has enough
// left, "Split the row" across challans is OFFERED, never done by itself.
// One matcher, TDSMatch.suggest(form, fy, q): the rules a to f of server/_shared/tdsmatch.js (tmRules, the same file the
// tds-challan-match function reads), then g, the AI's pairings for what they leave (one Claude call, askAi), each checked
// by the code (tmAiCheck). It replaced TDSReg.autoAllocate (the "Auto-allocate N" button), TDSCH.proposals (the
// "Suggested tagging" card), and the tagging a new challan (TDSReg.autoPlace) and Tally's payroll (Payroll.autoTag) made by
// themselves: they now show up here as suggestions. Tally's own bill-wise link naming one challan stays tagged by
// TDSTally.sync (the book-keeper's decision), shown "Matched by: Tally".
// Where it is kept: S.books.alloc (row id -> challan id) as ever; a split, S.books.tdsSplits[row id] = {parts: [{chId,
// tds}], by, at}, whose parts are rows "<row id>#1", "#2" in every list (expand), each with its own challan; a person's "Not
// this", S.books.matchNo[key]; who matched what, the audit trail (TDSReg.log, allocLog). The screen is
// app/src/screens/tds/Match.jsx (each return's Challans tab).
// next-tds-interest2 (20-Oct-2026): TDSReg's allocation actions, moved here from src/js/79 to keep legacy.js within its
// size budget (tests/run_stability.py): only the TDS screens, which load this file, call them (tests/harness.js loads
// TDSRegActs with TDSReg)
const TDSRegActs = {
  // give a return a part of a challan's interest and fee; past the challan's own, from its free tax (balance); refused past
  // what the challan holds, and on a locked return
  // (others not given: fee is the fee and others together, the fee first)
  setPortion(chId, form, fy, q, interest, fee, opt, others){
    const b = S.books, c = this.chOf(chId);
    if (!b || !c) return {ok: false, why: "No such challan."};
    if (this.locked(fy, q, form)) return {ok: false, why: this.lockWords(fy, q, form)};
    const k = this.key(form, fy, q), cur = JSON.parse(JSON.stringify(this.portions(c) || {}));
    const ou = Object.keys(cur).filter(x => x !== k).map(x => this.pp(c, cur[x])), oth = (f) => r2(ou.reduce((a, x) => a + x[f], 0)), M = (v) => Math.max(0, v);
    const hi = r2(num(c.interest) - oth("interest")), hf = r2(num(c.fee) - oth("fee234")), ho = r2(num(c.others) - oth("others"));
    interest = r2(num(interest)); fee = r2(num(fee));
    if (others == null){ const f = Math.min(fee, M(hf)); others = r2(fee - f); fee = f; } else others = r2(num(others));
    if (interest < 0 || fee < 0 || others < 0) return {ok: false, why: "An amount cannot be below nil."};
    // each head past its own from the tax not used, in turn: interest, the fee, others
    let r = M(r2(num(c.tax) - this.usedTax(c) - M(-hi) - M(-hf) - M(-ho)));
    // the TDS check of 22-Oct-2026, H8 (Leads: ₹16,200 of the 30-Apr-2026 194J challan, which pays March 2026, given to Q1
    // 2026-27 as its fee, March left short): the tax of a challan is first for the deductions of the month it was deposited
    // for (its section's, not yet on a challan); only what is beyond them may pay another return's interest or fee
    const cd = TDS.ymd(c.date), cm = num(cd.slice(4, 6)), om = num(cd.slice(6, 8)) <= (cm === 4 ? 30 : 7) ? (cm === 1 ? (num(cd.slice(0, 4)) - 1) + "12" : cd.slice(0, 4) + String(cm - 1).padStart(2, "0")) : cd.slice(0, 6), sec = TDSCH.secNorm(c.section), own = TDS.rows().concat(TDS.salaryRows()).filter(z => !z.challan && TDS.ymd(z.date).slice(0, 6) === om && (!sec || TDSCH.secNorm(z.section) === sec));
    const keep = r2(own.reduce((a, z) => a + num(z.tds), 0));
    if (keep > 0.005 && this.key(form, TDS.fyOf(om + "01"), TDS.qOf(om + "01")) !== k){
      const need = r2(M(interest - hi) + M(fee - (others == null ? hf + ho : hf)) + (others == null ? 0 : M(others - ho)));
      if (TDSCH.p(need) > TDSCH.p(M(r - keep))) return {ok: false, why: money(keep) + " of this challan's tax is for its own deductions (" + ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][num(om.slice(4, 6)) - 1] + " " + om.slice(0, 4) + (sec ? ", " + sec : "") + "), not yet on it: " + money(M(r - keep)) + " can go to another return's interest or fee."};
    }
    for (const [v, h, w] of [[interest, hi, "interest"], [fee, hf, "the fee"], [others, ho, "others"]]){
      const x = r2(M(h) + r);
      if (TDSCH.p(v) > TDSCH.p(x)) return {ok: false, why: money(x) + " free on this challan for " + w + ": " + money(r2(v - x)) + " more cannot be given."};
      r = M(r - M(v - h));
    }
    const was = cur[k] ? Object.assign({}, cur[k]) : null;
    if (interest || fee || others) cur[k] = {interest, fee, others}; else delete cur[k];
    const all = Object.assign({}, b.chPortions || {});
    if (Object.keys(cur).length) all[chId] = cur; else delete all[chId];
    b.chPortions = all;
    this.log({act: "portion", ch: c, form, fy, q, interest, fee: r2(fee + others), note: this.notes(c, form, fy, q).join("; ")});
    if (!(opt && opt.nosave)){ this.done(); saveBooks(); }
    return {ok: true, was};
  },
  // The register's "Use…" and a return's "Add from register" (and its one-click suggestions) are this one call: the
  // return's open deductions, oldest first, each whole, up to the amount given (never past the challan's tax left);
  // interest and fee, when given, added to the return's portion (setPortion's limit). Refused, nothing changed, over
  // any balance or on a return marked filed. only(r): which deductions may be used (a new challan's own placing).
  // {ok, why, n, ids, tax, interest, fee, short, was (the portion before, for Undo)}
  useBalance(chId, form, fy, q, amount, interest, fee, via, only){
    const c = this.chOf(chId);
    if (!c) return {ok: false, why: "No such challan."};
    form = form || "26Q";
    if (!this.FORMS.includes(form) || !/^Q[1-4]$/.test(q || "") || !/^\d{4}-\d{2}$/.test(fy || "")) return {ok: false, why: "Choose the form, the year and the quarter."};
    if (this.locked(fy, q, form)) return {ok: false, why: this.lockWords(fy, q, form)};
    const cx = this.ctx(), bal = this.balance(c, cx), want = r2(num(amount)), wi = r2(num(interest)), wf = r2(num(fee));
    if (want < 0 || wi < 0 || wf < 0) return {ok: false, why: "An amount cannot be below nil."};
    if (!want && !wi && !wf) return {ok: false, why: "Give the amount to use."};
    if (TDSCH.p(want) > TDSCH.p(bal.tax)) return {ok: false, why: money(bal.tax) + " left on this challan: " + money(r2(want - bal.tax)) + " more cannot be used."};
    let room = TDSCH.p(want); const ids = [];
    this.openRows(fy, q, form, cx).filter(r => !only || only(r)).forEach(r => { if (TDSCH.p(r.tds) <= room){ room -= TDSCH.p(r.tds); ids.push(r.id); } });
    if (want && !ids.length) return {ok: false, why: "No open deduction of " + form + " " + q + " " + fy + " fits within " + money(want) + "."};
    let n = 0, tax = 0, was = null;
    if (ids.length){
      const r = TDSCH.tag(ids, chId, {via: via || "balance", cx, nosave: true});
      if (!r.ok) return r;
      n = r.n; tax = r2(ids.reduce((a, id) => a + cx.byRow[id].r.tds, 0));
    }
    if (wi || wf){
      const cur = this.portionSet(c, form, fy, q, cx);
      const r = this.setPortion(chId, form, fy, q, r2(cur.interest + wi), r2(cur.fee + wf), {nosave: true});
      if (!r.ok){ if (ids.length) TDSCH.untag(ids, {cx, nosave: true}); return r; }
      was = r.was || {interest: 0, fee: 0};
    }
    this.done(); saveBooks();
    return {ok: true, n, ids, tax, interest: wi, fee: wf, short: r2(want - tax), was, chId, form, fy, q};
  },
  // Undo of a use: its deductions off again, its portion as it was
  undoUse(r){
    if (!r || !r.ok) return {ok: false};
    if (r.ids && r.ids.length){ const u = TDSCH.untag(r.ids, {nosave: true}); if (!u.ok) return u; }
    if (r.was) this.setPortion(r.chId, r.form, r.fy, r.q, r.was.interest, r.was.fee, {nosave: true}, r.was.others);
    this.done(); saveBooks(); return {ok: true};
  },
  // the return's open total: what "Use…" fills in (the balance, or less when the return needs less)
  openTotal(fy, q, form, cx){ return r2(this.openRows(fy, q, form, cx).reduce((a, r) => a + r.tds, 0)); },
  // a return's use of a challan taken off: its deductions untagged and its interest and fee portion cleared; refused when
  // filed. {ok, ids, was} (for Undo: use them again)
  removeUse(chId, form, fy, q){
    const c = this.chOf(chId);
    if (!c) return {ok: false, why: "No such challan."};
    if (this.locked(fy, q, form)) return {ok: false, why: this.lockWords(fy, q, form)};
    const cx = this.ctx(), u = (cx.uses[chId] || {})[this.key(form, fy, q)], ids = u ? u.ids.slice() : [];
    if (ids.length){ const r = TDSCH.untag(ids, {cx, nosave: true}); if (!r.ok) return r; }
    const p = this.explicit(c) ? this.portions(c, cx) : null, was = p && p[this.key(form, fy, q)] ? Object.assign({}, p[this.key(form, fy, q)]) : null;
    if (was) this.setPortion(chId, form, fy, q, 0, 0, {nosave: true});
    this.done(); saveBooks();
    return {ok: true, n: ids.length, ids, was, chId, form, fy, q};
  },
  undoRemove(r){
    if (!r || !r.ok) return {ok: false};
    if (r.ids.length){ const t = TDSCH.tag(r.ids, r.chId, {via: "tag", nosave: true}); if (!t.ok) return t; }
    if (r.was) this.setPortion(r.chId, r.form, r.fy, r.q, r.was.interest, r.was.fee, {nosave: true}, r.was.others);
    this.done(); saveBooks(); return {ok: true};
  },
};
// (put on TDSReg only where legacy.js has run: a page whose legacy.js failed shows "FinCom did not open", not this error)
if (typeof TDSReg === "object") Object.assign(TDSReg, TDSRegActs);
const TDSMatch = {
  books(){ return S.books || {}; },
  sec(r){ return TDS.sec(r.section || "") || ""; },
  // the return's deductions on no challan, as the rules read them
  open(form, fy, q, cx){
    return TDSReg.openRows(fy, q, form, cx).map(r => ({id: r.id, sec: form === "24Q" ? "192" : form === "27EQ" ? "206C" : this.sec(r), date: TDS.ymd(r.date), tds: r.tds, party: r.party || r.employee || "", pan: r.pan || "", fy: r.fy, q: r.q}));
  },
  // every challan with tax left, as the rules read them; the narration of the Tally payment it was made from
  chs(cx, all){
    const b = this.books(), vs = {};
    (b.vouchers || []).forEach(v => { vs[v.id] = v; });
    return TDS.challans().map(c => {
      const sec = TDSCH.secNorm(c.section);
      const ly = this.lastYear(c);
      return {id: c.id, sec: /^206C/.test(sec) ? "206C" : sec, date: TDS.ymd(c.date), minor: String(c.minorHead || "200"), bal: TDSReg.balance(c, cx).tax, interestLeft: TDSReg.balance(c, cx).interest, fy: TDS.fyOf(c.date), label: this.label(c), ...(ly ? {forFy: ly} : {}),
        bsr: c.bsr || "", serial: c.serial || "", narr: c.fromVoucher && vs[c.fromVoucher] ? vs[c.fromVoucher].narr || "" : ""};
    }).filter(c => c.bal > 0.005 || (all && c.interestLeft > 0.005) || all === "any");
  },
  label(c){ return c ? (c.bsr || "") + " / " + (c.serial || "") + " · " + (c.date ? fmtDate(tallyDate(TDS.ymd(c.date))) : "") : ""; },
  // the TDS check of 22-Oct-2026, H7 (Leads, Payments 151-154 of 29-Apr-2025: March 2025's TDS, offered to Q1 2025-26): an
  // April challan (by 30 April) whose tax is, within a rupee, a TDS ledger's balance on 1 April of that year (its section's,
  // where the challan names one) pays last year's March: the year before its own ("2024-25"), else ""
  lastYear(c){
    const d = TDS.ymd(c && c.date);
    if (!d || d.slice(4, 6) !== "04") return "";
    const sec = TDSCH.secNorm(c.section), y = d.slice(0, 4), map = this.books().map || {};
    const hit = Object.keys(map).some(l => map[l].kind === "tds_payable" && (!sec || TDSCH.secNorm(map[l].section) === sec) && Math.abs(this.openOn(l, y + "0401") - num(c.tax)) <= 1);
    return hit ? (+y - 1) + "-" + y.slice(2) : "";
  },
  // a ledger's credit balance at the start of a day, from the balances FinCom holds (b.tb: Tally's openings at tb.from) and
  // the entries between; null without them
  openOn(l, d){
    const tb = this.books().tb, x = tb && tb.led && tb.led[l];
    if (!x) return null;
    let bal = num(x.open);
    (this.books().vouchers || []).forEach(v => { if (v.opt || v.cancel) return; const t = TDS.ymd(v.date), f = TDS.ymd(tb.from); if (t >= f && t < d) v.ent.forEach(e => { if (e.l === l) bal += e.a; }); else if (t < f && t >= d) v.ent.forEach(e => { if (e.l === l) bal -= e.a; }); });
    return r2(bal);
  },
  // next-24q-split (the owner on Leads' Form 138 Q1: "24Q has only 2 month TDS challan… why only 2 months?"): a challan
  // naming no section, made from a Tally TDS payment, pays what that payment debits: 6-Jul ₹2,27,543 is TDS 192B ₹1,98,578
  // (June's salary TDS, Form 138 Q1's) with 194C, 194J and 194I (26Q's). [{sec, amount}] (sec "" for a TDS ledger of no
  // section), or null: the challan names its section, or its payment is not in the books
  paidSecs(c){
    if (!c || !c.fromVoucher || TDSCH.secNorm(c.section) || typeof Books !== "object") return null;
    const b = this.books(), vs = b.vouchers || [];
    if (!this._vx || this._vx.vs !== vs){ const by = {}; vs.forEach(v => { if (v && v.id) by[v.id] = v; }); this._vx = {vs, by}; }
    const v = this._vx.by[c.fromVoucher];
    if (!v) return null;
    const by = {}; (Books.lines(v).tdsPaid || []).forEach(t => { const k = TDSCH.secNorm(t.section) || ""; by[k] = r2((by[k] || 0) + t.amount); });
    const out = Object.keys(by).sort().map(sec => ({sec, amount: by[sec]}));
    return out.length ? out : null;
  },
  // the returns such a challan can pay (a Set of forms), or null when it cannot be told (then any, as before)
  formsOf(c){ const p = this.paidSecs(c); return !p || p.some(x => !x.sec) ? null : new Set(p.map(x => TDSReg.homeForm({section: x.sec}))); },
  // a challan of a return's kind: minor head 200; its section's form, else the forms its Tally payment paid, else any
  kindOk(c, form){
    if (String((c && c.minorHead) || "200") !== "200") return false;
    const h = TDSReg.homeForm(c), f = h ? null : this.formsOf(c);
    return h ? h === form : !f || f.has(form);
  },
  // "192B, 194C, 194I, 194J" for such a challan (the grids' Section), with its amounts for the hover
  paidLabel(c){ const p = (this.paidSecs(c) || []).filter(x => x.sec); return p.length ? {w: p.map(x => x.sec).join(", "), t: "Its Tally payment paid " + p.map(x => x.sec + " " + money(x.amount)).join(" · ")} : null; },
  // what Tally says a payment paid: its bill-wise links (Agst Ref to the deductions' New Ref), and for salary the months a
  // payroll TDS payment says it is for. {chId: [row ids]}
  links(rows){
    const b = this.books(), want = new Set(rows.map(r => r.id)), out = {}, idx = TDSCH.billIndex(), vs = {};
    (b.vouchers || []).forEach(v => { vs[v.id] = v; if (v.guid) vs[v.guid] = v; });
    TDS.challans().forEach(c => {
      const v = c.fromVoucher ? vs[c.fromVoucher] : null;
      if (!v) return;
      const ids = TDSCH.billLinks(v, idx).map(x => x.split("|").slice(0, 2).join("|")).filter(id => want.has(id));
      try { if (typeof TDSTally === "object") TDSTally.links(b).filter(l => l.vid === v.id && !l.why && !l.many && want.has(l.row)).forEach(l => ids.push(l.row)); } catch (e){}
      // a payroll TDS payment's period (Tally's Stat Payment, the months it pays)
      const per = v.tdsx || {}, from = TDS.ymd(per.from).slice(0, 6), to = (TDS.ymd(per.to) || TDS.ymd(per.from)).slice(0, 6);
      if (from && /^192/.test(TDSCH.secNorm(c.section))) rows.filter(r => r.sec === "192" && r.date.slice(0, 6) >= from && r.date.slice(0, 6) <= to).forEach(r => ids.push(r.id));
      if (ids.length) out[c.id] = Array.from(new Set(ids));
    });
    return out;
  },
  no(){ return this.books().matchNo || {}; },
  // the section and month of other returns' deductions on no challan (a later month's own challan is theirs: tmRules' H6
  // across a quarter's end): [{sec, ym}], once each
  waiting(form, fy, q, cx){
    const seen = new Set(), out = [];
    Object.values((cx || TDSReg.ctx()).byRow).forEach(({r, form: f}) => {
      if (r.challan || !(r.tds > 0.005) || (f === form && r.fy === fy && r.q === q)) return;
      const sec = f === "24Q" ? "192" : f === "27EQ" ? "206C" : this.sec(r), ym = TDS.ymd(r.date).slice(0, 6), k = sec + "|" + ym;
      if (!seen.has(k)){ seen.add(k); out.push({sec, ym}); }
    });
    return out;
  },
  // ---------------- next-24q-auto (the owner on Leads' Form 138 Q1, 20-Oct-2026: "FinCom has now shown the challans, but the
  // deductions are being filled by me by adding"). Salary TDS is one figure a month paid on one challan: on opening a 24Q
  // return its deductions are PLACED by the sure rules (a Tally's link, b/c the exact amount, s below), each tagged "Rule"
  // in the register (allocLog act "auto", note "rule: <words>"); the other rules stay suggestions. Never moved: a deduction
  // already on a challan (a person's or Tally's), one a person took off a challan (an "untag" of it in the trail), a filed
  // return. 26Q, 27Q and 27EQ are as before (suggested, confirmed by a person).
  SAL: "Salary: the month's TDS on the next month's 192 challan",
  AUTO: new Set(["a", "b", "c", "s"]),
  // a challan's 192 part (paise): its tax when it names 192; one naming no section made from a Tally payment, what that
  // payment paid under 192 (6-Jul ₹2,27,543: TDS 192B ₹1,98,578); else null
  part192(c){
    const s = TDSCH.secNorm(c && c.section);
    if (s) return /^192/.test(s) ? tmP(c.tax) : null;
    const p = (this.paidSecs(c) || []).filter(x => /^192/.test(x.sec));
    return p.length ? p.reduce((a, x) => a + tmP(x.amount), 0) : null;
  },
  // 24Q's tax on a challan (paise), every quarter
  used24(c, cx){ return Object.values((cx.uses[c.id] || {})).filter(u => u.form === "24Q").reduce((a, u) => a + tmP(u.tax), 0); },
  // s: all of a month's 192 deductions to the one challan paying 192 deposited in the next month by its 7th (the due date;
  // 30 April for March), when its 192 part not yet used is at least the month's TDS; what is over is said once
  salRule(rows, chs, opt, cx){
    const out = [], no = opt.no || {}, today = tmYmd(opt.today), by = {}, chBy = {}, left = {};
    TDS.challans().forEach(c => { chBy[c.id] = c; });
    chs.forEach(c => { left[c.id] = tmP(c.bal); });
    rows.filter(r => r.sec === "192" && tmP(r.tds) > 0).forEach(r => { const ym = tmYmd(r.date).slice(0, 6); (by[ym] = by[ym] || []).push(r); });
    Object.keys(by).sort().forEach(ym => {
      const list = by[ym].slice().sort((a, c) => tmYmd(a.date).localeCompare(tmYmd(c.date)) || (String(a.id) < String(c.id) ? -1 : 1)), need = list.reduce((a, r) => a + tmP(r.tds), 0), last = tmYmd(list[list.length - 1].date), due = tmDue(ym);
      const cands = chs.filter(c => { const d = tmYmd(c.date); return String(c.minor || "200") === "200" && d.slice(0, 6) === due.slice(0, 6) && d <= due && d >= last && !(today && d > today) && this.part192(chBy[c.id]) != null; });
      if (cands.length !== 1) return;
      const c = cands[0], ch = chBy[c.id], part = this.part192(ch) - this.used24(ch, cx) - (tmP(c.bal0 != null ? c.bal0 : c.bal) - left[c.id]), ids = list.map(r => r.id), key = c.id + ":" + ids.slice().sort().join(",");
      if (part < need || left[c.id] < need || no[key]) return;
      left[c.id] -= need;
      const over = part - need;
      out.push({key, rule: "s", words: this.SAL, reason: "192 · " + tmMonth(ym) + " · " + list.length + (list.length === 1 ? " deduction " : " deductions ") + tmInr(need) + " · challan of " + tmDmy(c.date) + " paid " + tmInr(this.part192(ch)) + " under 192",
        warn: "", info: over > 0 ? tmInr(over) + " more paid than deducted — use for interest/next month or check" : "", chId: c.id, ids, total: need, over});
    });
    return out;
  },
  // the rules of a return (next-tds-autoplace: tmPlan, R1 to R8 in order, each placing with its rule code and whether it is
  // certain); 24Q's salary rule s after a, b, c
  rulesFor(form, rows, chs, opt, cx){
    const mid = form === "24Q" ? (r, c) => this.salRule(r, c, opt, cx || TDSReg.ctx()) : null;
    return tmPlan(rows, chs, mid ? Object.assign({}, opt, {mid}) : opt);
  },
  // a confirmed suggestion's words in the trail: its rule code first (R6 …), the AI's as before
  noteOf(s){ return "suggestion confirmed: " + (s.code && s.rule !== "g" ? s.code + " " : "") + s.words + (s.rule === "g" ? " (" + s.reason + ")" : ""); },
  // what a person took off a challan stays off (the trail's "untag" of it, not a stale one dropped)
  offRows(){ return new Set((this.books().allocLog || []).filter(l => l.act === "untag" && l.row && !/^stale/.test(l.note || "")).map(l => l.row)); },
  // allocations naming a deduction that is no longer in the books: a payroll entry's books 192 line or its "TDS not split by
  // employee" row (pay:<entry>|~) once Tally's payroll gives each employee's TDS (after Payroll.carry has taken its challan to
  // the employees). Dropped, each said in the trail. Only a payroll entry's (26Q, 27Q, 27EQ untouched); never a filed return's
  dropStale(){
    const b = S.books, V = (b && b.payroll || {}).vouchers || {};
    if (!b || !b.alloc || !Object.keys(V).length) return 0;
    try { Payroll.carry(b); } catch (e){}
    TDSReg.forget();
    const live = TDSReg.ctx().byRow, L = b.allocLog || [], chs = TDS.challans(); let n = 0;
    Object.keys(b.alloc).forEach(k => {
      const g = k.replace(/^pay:/, "").split("|")[0];
      if (live[k] || live[k.replace(/#\d+$/, "")] || !V[g]) return;
      const was = L.slice().reverse().find(l => l.row === k) || {};
      if (was.fy && was.q && TDSReg.locked(was.fy, was.q, "24Q")) return;
      TDSReg.log({act: "untag", ch: chs.find(c => c.id === b.alloc[k]) || null, form: "24Q", fy: was.fy || "", q: was.q || "", row: k, tax: was.tax || 0,
        note: "stale: this deduction is no longer in the books (Tally's payroll gives each employee's TDS); its old allocation dropped"});
      delete b.alloc[k]; n++;
    });
    if (n) TDSReg.forget();
    return n;
  },
  // on opening a 24Q return: stale allocations dropped, then the sure rules' matches placed. {placed, dropped}
  autoRun(form, fy, q){
    const b = S.books;
    if (form !== "24Q" || !b || b.loading || TDSReg.locked(fy, q, form)) return {placed: 0, dropped: 0};
    if (typeof PayLoad === "object" && PayLoad.waiting && PayLoad.waiting(b)) return {placed: 0, dropped: 0};
    const dropped = this.dropStale(), off = this.offRows(), cx = TDSReg.ctx(); let placed = 0;
    this.suggestNow(form, fy, q).filter(s => this.AUTO.has(s.rule) && s.ids.length && !s.ids.some(id => off.has(id))).forEach(s => {
      const r = TDSCH.tag(s.ids, s.chId, {via: "auto", note: "rule: " + s.words + " · " + s.reason + (s.info ? " · " + s.info : ""), cx, nosave: true});
      if (r.ok) placed += r.n;
    });
    if (placed || dropped){ TDSReg.forget(); TDSReg.done(); saveBooks(); }
    return {placed, dropped};
  },
  // called as a 24Q return is drawn: once for these books as they are (a run that changes nothing is not run again)
  autoOpen(form, fy, q){
    const b = S.books;
    if (form !== "24Q" || !b || b.loading) return;
    const sig = [fy, q, Object.keys(b.alloc || {}).length, TDS.challans().length, (b.vouchers || []).length, (b.allocLog || []).length].join("|");
    if (this._auto && this._auto.b === b && this._auto.sig === sig) return;
    this._auto = {b, sig};
    setTimeout(() => { try { if (S.books !== b) return; const r = this.autoRun(form, fy, q); if (r.placed || r.dropped) render(); } catch (e){} }, 0);
  },
  // what a 24Q return's challans hold of 192 beyond its TDS on them: [{c, part, used, over, words}] (said once, Challans)
  salaryExcess(fy, q){
    const cx = TDSReg.ctx(), k = TDSReg.key("24Q", fy, q), out = [];
    TDS.challans().forEach(c => {
      if (!(cx.uses[c.id] || {})[k]) return;
      const part = this.part192(c); if (part == null) return;
      const over = part - this.used24(c, cx);
      if (over >= 100) out.push({c, part: part / 100, used: this.used24(c, cx) / 100, over: over / 100, words: tmInr(over) + " more paid than deducted — use for interest/next month or check"});
    });
    return out;
  },
  // ---------------- the suggestions: rules a to f, then the AI's (g), each with its rule and reason in words
  suggest(form, fy, q){
    form = form || "26Q";
    const k = "sg" + form + fy + q;
    return typeof perRender === "function" ? perRender(this, k, () => this.suggestNow(form, fy, q)) : this.suggestNow(form, fy, q);
  },
  suggestNow(form, fy, q){
    if (!S.books || TDSReg.locked(fy, q, form)) return [];
    // next-24q-split: a challan whose Tally payment paid none of this return's sections is not offered to it
    const cx = TDSReg.ctx(), rows = this.open(form, fy, q, cx), chBy = {}, kind = c => { const f = this.formsOf(chBy[c.id]); return !f || f.has(form); };
    TDS.challans().forEach(c => { chBy[c.id] = c; });
    const chs = this.chs(cx).filter(kind);
    let today = ""; try { today = istToday(); } catch (e){}
    const opt = {fy, q, today, links: rows.length ? this.links(rows) : {}, no: this.no(), waiting: rows.length ? this.waiting(form, fy, q, cx) : []};
    let out = rows.length && chs.length ? this.rulesFor(form, rows, chs, opt, cx) : [];
    // the AI's pairings (a run kept for these deductions), checked again against what is free now
    const ai = this.aiOf(form, fy, q);
    if (ai && ai.raw && rows.length){
      const taken = new Set([].concat(...out.map(s => s.ids))), use = {};
      out.forEach(s => { (s.parts || [{chId: s.chId, paise: s.total}]).forEach(p => { use[p.chId] = (use[p.chId] || 0) + p.paise; }); });
      const chs2 = this.chs(cx, true).filter(kind).map(c => Object.assign({}, c, {bal: Math.max(0, tmP(c.bal) - (use[c.id] || 0)) / 100}));
      out = out.concat(tmAiCheck(ai.raw, rows.filter(r => !taken.has(r.id)), chs2, opt).sugg.filter(s => s.rule !== "int").map(s => Object.assign(s, {code: "R9", auto: false})));
    }
    return out.concat(this.interestSugg(form, fy, q, cx, ai && ai.raw));
  },
  // interest and fee to allocate to this return, pre-filled (the owner: "interest allocation ... pre-filled as suggestions
  // too"): for each challan this return uses, the default (defaultPortion) where more than allocated now; the AI's
  // proposal where the rules offer none (checked: within the challan's interest left, whole rupees)
  interestSugg(form, fy, q, cx, raw){
    const k = TDSReg.key(form, fy, q), no = this.no(), out = [];
    TDS.challans().filter(c => (cx.uses[c.id] || {})[k]).forEach(c => {
      const key = "int:" + c.id, cur = TDSReg.portionSet(c, form, fy, q, cx), d = this.defaultPortion(c, form, fy, q);
      // a person's own allocation for this return is never offered over (only none yet)
      if (no[key] || ((TDSReg.portions(c) || {})[k]) || (d.interest <= cur.interest + 0.005 && d.fee <= cur.fee + 0.005)) return;
      const interest = Math.max(d.interest, cur.interest), fee = Math.max(d.fee, cur.fee);
      out.push({key, rule: "int", words: TM_RULES.int, chId: c.id, ids: [], total: 0, interest, fee, warn: "", info: "",
        reason: (d.due > 0 ? "Interest " + money(d.due) + " is due on this return's late deductions on this challan" : "This return is the only one using this challan") + ": allocate interest " + money(interest) + (fee ? " and fee " + money(fee) : "") + " of it here"});
    });
    if (raw && raw.interest && raw.interest.length){
      const chs = this.chs(cx, true).filter(c => (cx.uses[c.id] || {})[k]);
      tmAiCheck({pairs: [], splits: [], interest: raw.interest}, [], chs, {fy, q, no}).sugg.filter(s => !out.some(o => o.chId === s.chId)).forEach(s => {
        const cur = TDSReg.portionSet(TDS.challans().find(c => c.id === s.chId), form, fy, q, cx);
        out.push(Object.assign(s, {interest: r2(cur.interest + s.interest / 100), fee: cur.fee}));
      });
    }
    return out;
  },
  // what no suggestion covers: a reason and the next step for each deduction (tmReasons)
  reasons(form, fy, q){
    const k = "rs" + form + fy + q;
    const f = () => {
      if (!S.books) return [];
      const cx = TDSReg.ctx(), rows = this.open(form, fy, q, cx).concat(TDS.formRows(form).filter(r => r.fy === fy && r.q === q && !r.challan && !(r.tds > 0.005)).map(r => { const m = form === "24Q" ? {} : TDS26Q.remark(r, form) || {}; return {id: r.id, sec: this.sec(r), date: TDS.ymd(r.date), tds: 0, party: r.party, remark: m.remark === "A" ? "A" : "", cert: m.certFull || m.certNo || ""}; }));
      let today = ""; try { today = istToday(); } catch (e){}
      return tmReasons(rows, this.chs(cx, "any"), this.suggestNow(form, fy, q).filter(s => s.ids.length), {fy, q, today, pct: form === "27EQ" ? 1 : 1.5, tally: this.tallyPays(fy, q)});
    };
    return typeof perRender === "function" ? perRender(this, k, f) : f();
  },
  // round 86 (19-Oct-2026): the TDS payments in Tally not yet challans (no BSR code given), of this quarter and the next:
  // tmReasons names one for a section and month in place of "No challan paid yet"
  tallyPays(fy, q){
    try {
      const qs = ["Q1", "Q2", "Q3", "Q4"], i = qs.indexOf(q), nfy = i === 3 ? (+String(fy).slice(0, 4) + 1) + "-" + String((+String(fy).slice(0, 4) + 2) % 100).padStart(2, "0") : fy, nq = qs[(i + 1) % 4];
      const allCh = TDS.challans();
      return TDS.paymentsFromBooks().filter(p => num(p.tax) > 0.005 && [fy + q, nfy + nq].includes(TDS.fyOf(p.date) + TDS.qOf(p.date)) && TDSTally.notChallan(p, allCh))
        .map(p => ({vid: p.vid, date: TDS.ymd(p.date), tax: p.tax, sections: (p.sections || []).filter(Boolean).map(x => TDSCH.secNorm(x) || TDS.sec(x) || x)}));
    } catch (e){ return []; }
  },
  // "N of M matched automatically · K need you": M the deductions with tax; N those on a challan or in a suggestion the
  // AI is not unsure of; K the rest (a reason and a next step each)
  metric(form, fy, q){
    const rows = TDS.formRows(form).filter(r => r.fy === fy && r.q === q && r.tds > 0.005), sg = this.suggestNow(form, fy, q);
    const sure = new Set([].concat(...sg.filter(s => s.confidence !== "low").map(s => s.ids))), low = new Set([].concat(...sg.filter(s => s.confidence === "low").map(s => s.ids)));
    const on = rows.filter(r => r.challan).length, sugg = rows.filter(r => !r.challan && sure.has(r.id)).length;
    return {m: rows.length, n: on + sugg, on, sugg, k: rows.length - on - sugg, low: rows.filter(r => low.has(r.id)).length};
  },
  // ---------------- a person's actions (each refused on a filed return, and over a challan's balance: TDSCH.tag)
  find(key, form, fy, q){ return this.suggestNow(form || "26Q", fy, q).find(s => s.key === key) || null; },
  confirm(key, form, fy, q, opt){
    const s = this.find(key, form, fy, q);
    if (!s) return {ok: false, why: "That suggestion is no longer there."};
    if (s.rule === "split") return {ok: false, split: true, why: "A split is made in its own window: Split the row."};
    if (s.rule === "int"){ const r = TDSReg.setPortion(s.chId, form || "26Q", fy, q, s.interest, s.fee, opt); return r.ok ? Object.assign(r, {n: 0, interest: s.interest}) : r; }
    return TDSCH.tag(s.ids, s.chId, Object.assign({via: "suggestion", note: this.noteOf(s)}, opt || {}));
  },
  // every suggestion but the splits, in one go (worked out together, they never use a challan beyond its balance)
  confirmAll(form, fy, q){
    form = form || "26Q";
    const list = this.suggestNow(form, fy, q).filter(s => s.rule !== "split" && s.rule !== "int");
    const cx = TDSReg.ctx(); let n = 0, ints = 0; const chs = new Set(), why = [];
    list.forEach(s => {
      const r = TDSCH.tag(s.ids, s.chId, {via: "suggestion", note: this.noteOf(s), cx, nosave: true});
      if (r.ok && r.n){ n += r.n; chs.add(s.chId); } else if (!r.ok) why.push(r.why);
    });
    // then the interest and fee of the challans now used (worked out again with the new matches)
    this.suggestNow(form, fy, q).filter(s => s.rule === "int").forEach(s => {
      const r = TDSReg.setPortion(s.chId, form, fy, q, s.interest, s.fee, {nosave: true});
      if (r.ok) ints++; else why.push(r.why);
    });
    if (n || ints){ TDSReg.done(); saveBooks(); }
    return {ok: !why.length, n, challans: chs.size, interest: ints, why};
  },
  notThis(key, form, fy, q){
    const b = S.books; if (!b) return {ok: false};
    const s = this.find(key, form, fy, q);
    b.matchNo = Object.assign({}, b.matchNo || {}, {[key]: {at: new Date().toISOString(), by: TDSReg.who(), form: form || "", fy: fy || "", q: q || ""}});
    if (s) TDSReg.log({act: "not-this", ch: TDS.challans().find(c => c.id === s.chId), form, fy, q, tax: s.total / 100, note: "suggestion set aside: " + s.words + " · " + s.reason});
    TDSReg.done(); saveBooks();
    return {ok: true};
  },
  move(ids, chId){ return TDSCH.tag(ids, chId, {via: "tag", note: "moved by a person"}); },
  takeOff(ids){ return TDSCH.untag(ids); },
  // ---------------- splitting a deduction across challans (offered, done by a person)
  // the row as it is before any split: the books', the payroll's or the salary sheet's
  baseRow(rowId){ return (this._base || {})[rowId] || null; },
  // a row with a split, as its parts (the tax as split; the amount paid in the same proportion, the last part the rest;
  // the same dates); a split whose parts no longer add up to the row (the books changed) is not used: the row whole, said
  expand(rows){ return TDS.expandSplits(rows); },
  // parts: [{chId, tds (rupees)}]: two or more, adding up to the deduction to the paisa, each within its challan's balance
  split(rowId, parts){
    const b = S.books; if (!b) return {ok: false, why: "Open the client's books first."};
    const cx = TDSReg.ctx(), x = cx.byRow[rowId];
    if (!x) return {ok: false, why: "That deduction is not in a return."};
    const r = x.r;
    if (r.splitOf || (b.tdsSplits || {})[rowId]) return {ok: false, why: "This deduction is split already."};
    if (TDSReg.locked(r.fy, r.q, x.form)) return {ok: false, why: TDSReg.lockWords(r.fy, r.q, x.form)};
    if (r.challan) return {ok: false, why: "Take it off its challan first."};
    parts = (parts || []).map(p => ({chId: p.chId, tds: r2(num(p.tds))})).filter(p => p.tds > 0);
    if (parts.length < 2 || new Set(parts.map(p => p.chId)).size !== parts.length) return {ok: false, why: "A split needs two or more challans, each once."};
    const tot = parts.reduce((a, p) => a + TDSCH.p(p.tds), 0);
    if (tot !== TDSCH.p(r.tds)) return {ok: false, why: "The parts add up to " + money(tot / 100) + "; the deduction is " + money(r.tds) + ". They must add up to it exactly."};
    const chs = TDS.challans();
    for (const p of parts){
      const c = chs.find(z => z.id === p.chId);
      if (!c) return {ok: false, why: "No such challan."};
      const left = TDSReg.balance(c, cx).tax;
      if (TDSCH.p(p.tds) > TDSCH.p(left)) return {ok: false, why: money(left) + " left on challan " + TDSCH.label(c) + ": its part " + money(p.tds) + " is more."};
    }
    b.tdsSplits = Object.assign({}, b.tdsSplits || {}, {[rowId]: {parts, by: TDSReg.who(), at: new Date().toISOString()}});
    b.alloc = b.alloc || {};
    parts.forEach((p, i) => { b.alloc[rowId + "#" + (i + 1)] = p.chId; });
    delete b.alloc[rowId];
    parts.forEach((p, i) => TDSReg.log({act: "split", ch: chs.find(z => z.id === p.chId), form: x.form, fy: r.fy, q: r.q, row: rowId + "#" + (i + 1), tax: p.tds,
      note: "split " + (i + 1) + " of " + parts.length + " of " + money(r.tds) + " (" + (r.party || "") + ")"}));
    TDSReg.forget(); TDSReg.done(); saveBooks();
    return {ok: true, n: parts.length};
  },
  unsplit(rowId){
    const b = S.books, s = b && (b.tdsSplits || {})[rowId];
    if (!s) return {ok: false, why: "This deduction is not split."};
    const cx = TDSReg.ctx(), lock = TDSReg.lockedOf(s.parts.map((p, i) => rowId + "#" + (i + 1)), cx);
    if (lock) return {ok: false, why: lock};
    s.parts.forEach((p, i) => { delete b.alloc[rowId + "#" + (i + 1)]; });
    const t = Object.assign({}, b.tdsSplits); delete t[rowId]; b.tdsSplits = t;
    TDSReg.log({act: "unsplit", row: rowId, note: "split undone"});
    TDSReg.forget(); TDSReg.done(); saveBooks();
    return {ok: true};
  },
  // ---------------- who matched a deduction: Tally, a person, or a suggestion a person confirmed
  matchedBy(rowId){
    const b = this.books(), from = (b.allocFrom || {})[rowId];
    if (!(b.alloc || {})[rowId]) return {kind: "", words: ""};
    if (from === "tally") return {kind: "tally", words: "Matched by: Tally (its payment is linked to this deduction)"};
    const log = (b.allocLog || []).slice().reverse().find(l => l.row === rowId && ["tag", "suggestion", "auto", "tally", "balance", "split"].includes(l.act));
    const when = (l) => (l.by || "you") + ", " + fmtDate(String(l.at || "").slice(0, 10));
    if (!log) return {kind: "", words: "Matched before this record was kept"};
    if (log.act === "suggestion") return {kind: "suggestion", words: "Matched by: suggestion confirmed by " + when(log) + (log.note ? " · " + log.note.replace(/^suggestion confirmed: /, "") : "")};
    if (log.act === "tally") return {kind: "tally", words: "Matched by: Tally"};
    if (log.act === "split") return {kind: "you", words: "Matched by: " + when(log).replace(/, /, " (") + ") · split"};
    // next-24q-auto: placed by a rule on opening the return, or carried from a payroll month's total (Payroll.carry)
    if (log.act === "auto" && /^rule: /.test(log.note || "")) return {kind: "rule", words: "Matched by: rule " + ((log.note.match(/ · (R\d) · run /) || [])[1] ? log.note.match(/ · (R\d) · run /)[1] + " " : "") + "· " + log.note.slice(6).split(" · ")[0] + " (FinCom, " + fmtDate(String(log.at || "").slice(0, 10)) + ")"};
    if (/^carried from the month's total/.test(log.note || "")) return {kind: "rule", words: "Matched by: rule · carried from the month's total challan (FinCom, " + fmtDate(String(log.at || "").slice(0, 10)) + ")"};
    if (log.act === "auto" || log.act === "balance") return {kind: "auto", words: "Matched by: FinCom's earlier automatic allocation (" + when(log) + ")"};
    return {kind: "you", words: "Matched by: " + when(log).replace(/, /, " (") + ")"};
  },
  // ---------------- interest, fee and others: allocated to a return by a person (TDSReg.setPortion); the default offered
  // interest: what this return's late deductions on this challan owe (TDS.interest), else, when this return is the only one
  // using the challan, its interest left; never more than is left. Fee (and others): the challan's, when this return is
  // its only user. {interest, fee, due}
  // the interest a return's late deductions on a challan owe (TDS.interest): paid late, and deducted late
  dueOn(c, form, fy, q){ return r2(TDS.interest(fy, q, form).filter(x => (x.kind === "pay" && x.challan && x.challan.id === c.id) || (x.kind === "deduct" && x.row.challan === c.id)).reduce((a, x) => a + x.amount, 0)); },
  defaultPortion(c, form, fy, q, dflt){
    const cx = TDSReg.ctx(), bal = TDSReg.balance(c, cx), cur = TDSReg.portionSet(c, form, fy, q, cx), only = Object.keys(cx.uses[c.id] || {}).length <= 1;
    const iLeft = r2(bal.interest + cur.interest), fLeft = r2(bal.fee + cur.fee);
    const due = r2(TDS.interest(fy, q, form).filter(x => (x.kind === "pay" && x.challan && x.challan.id === c.id) || (x.kind === "deduct" && x.row.challan === c.id)).reduce((a, x) => a + x.amount, 0));
    // (the TDS check, M6: the default the file takes when nobody has allocated: the interest this return's late deductions on
    // the challan owe, from the challan's own interest only, after what the returns before it (in date order) take)
    if (dflt){
      const ks = Object.keys(cx.uses[c.id] || {}).filter(x => { const u = cx.uses[c.id][x]; return u && (u.fy + u.q < fy + q || (u.fy + u.q === fy + q && u.form < form)); }), before = r2(ks.reduce((a, x) => { const u = cx.uses[c.id][x]; return a + (u ? this.dueOn(c, u.form, u.fy, u.q) : 0); }, 0));
      return {interest: r2(Math.max(0, Math.min(Math.ceil(due - 0.005), r2(iLeft - before)))), fee: 0, due};
    }
    const interest = due > 0 ? Math.min(Math.ceil(due), TDSMatch.free(c, form, fy, q, cx).interest) : only ? iLeft : 0;
    return {interest: r2(Math.max(0, interest)), fee: only ? fLeft : 0, due};
  },
  // ---------------- next-tds-interest (the owner, 20-Oct-2026): the return's interest and late fee in one table, and the
  // interest and fee due allocated to its challans. {rows: [{id, row, unpaid, challan, months1, months2, rate2, from,
  // interest}], fee (TDS.lateFee), filed, perChallan: [{c, due, allocated, fee, diff}], totals: {interest, due, allocated,
  // short, feeDue, feeAllocated, feeShort}}. One row a deduction: deducted late (1%, from the bill) and paid late (1.5%; TCS
  // 1%) together; one still unpaid, a row of its own. next-tds-interest2: the 234E fee allocated apart from others (fee:
  // the challan's fee234 portion); a short under TDS.MIN_WARN (₹10) is not a warning (warnShort)
  interestTable(form, fy, q){
    form = form || "26Q";
    const cx = TDSReg.ctx(), k = TDSReg.key(form, fy, q), L = TDS.interest(fy, q, form), by = {}, rows = [], chs = TDS.challans(), ch = {};
    chs.forEach(c => { ch[c.id] = c; });
    L.forEach(x => {
      const id = x.row.id + (x.kind === "unpaid" ? ":u" : "");
      const r = by[id] || (by[id] = rows[rows.push({id, row: x.row, unpaid: x.kind === "unpaid", challan: ch[x.row.challan] || null, months1: 0, months2: 0, rate2: 0, from: "", due: "", interest: 0}) - 1]);
      if (x.kind === "deduct"){ r.months1 = x.months; r.from = x.from; } else { r.months2 = x.months; r.rate2 = x.rate; r.due = x.due; }
      r.interest = r2(r.interest + x.amount);
    });
    rows.sort((a, b) => TDS.ymd(a.row.date).localeCompare(TDS.ymd(b.row.date)) || String(a.row.party || "").localeCompare(String(b.row.party || "")));
    const perChallan = chs.filter(c => (cx.uses[c.id] || {})[k]).map(c => {
      const due = r2(L.filter(x => x.kind !== "unpaid" && x.row.challan === c.id).reduce((a, x) => a + x.amount, 0)), p = TDSReg.portionFor(c, form, fy, q, cx);
      return {c, due, allocated: p.interest, fee: p.fee234, diff: r2(due - p.interest)};
    });
    const filed = TDSFiled.get(fy, q, form), sum = (f) => r2(perChallan.reduce((a, x) => a + x[f], 0)), fee = TDS.lateFee(fy, q, filed ? filed.on : "", form);
    const due = sum("due"), allocated = sum("allocated"), feeDue = fee && fee.days > 0 ? r2(fee.fee) : 0, feeAllocated = sum("fee");
    return {rows, perChallan, filed, fee, totals: {interest: r2(L.reduce((a, x) => a + x.amount, 0)), due, allocated, short: r2(Math.max(0, due - allocated)),
      feeDue, feeAllocated, feeShort: r2(Math.max(0, feeDue - feeAllocated))}};
  },
  // a money difference worth a warning: TDS.MIN_WARN (₹10, the owner, 20-Oct-2026) or more
  warnShort(v){ return num(v) >= TDS.MIN_WARN; },
  // the most a return may have of a challan's interest, its 234E fee and its others (TDSReg.setPortion's limit): its own,
  // the head left, and the challan's tax not used (kept here, out of legacy.js)
  free(c, form, fy, q, cx){
    const b = TDSReg.balance(c, cx), cur = TDSReg.portionSet(c, form, fy, q, cx), t = Math.max(0, b.tax);
    return {interest: r2(cur.interest + b.interest + t), fee: r2(cur.fee234 + b.fee234 + t), others: r2(cur.others + b.others + t)};
  },
  // "Allocate interest due": each challan of the return its interest due (whole rupees, up), within what it has free
  // (free: its interest, then its tax not used). {ok, n, why}
  allocateDue(form, fy, q){
    if (TDSReg.locked(fy, q, form)) return {ok: false, why: TDSReg.lockWords(fy, q, form)};
    const cx = TDSReg.ctx(); let n = 0;
    this.interestTable(form, fy, q).perChallan.forEach(x => {
      if (!(x.due > 0)) return;
      const cur = TDSReg.portionSet(x.c, form, fy, q, cx), want = Math.min(Math.ceil(x.due - 0.005), TDSMatch.free(x.c, form, fy, q, cx).interest);
      if (Math.abs(want - cur.interest) < 0.005) return;
      if (TDSReg.setPortion(x.c.id, form, fy, q, want, cur.fee234, {nosave: true}, cur.others).ok) n++;
    });
    if (n){ TDSReg.done(); saveBooks(); }
    return {ok: true, n};
  },
  // "Allocate fee due": the return's 234E fee not yet allocated, on its challans in date order, each within what it has
  // free (its fee, then its tax not used). {ok, n, short, why}
  allocateFeeDue(form, fy, q){
    if (TDSReg.locked(fy, q, form)) return {ok: false, why: TDSReg.lockWords(fy, q, form)};
    const cx = TDSReg.ctx(), t = this.interestTable(form, fy, q); let left = r2(Math.ceil(t.totals.feeShort - 0.005)), n = 0;
    t.perChallan.forEach(x => {
      if (left <= 0) return;
      const cur = TDSReg.portionSet(x.c, form, fy, q, cx), give = r2(Math.min(left, Math.max(0, TDSMatch.free(x.c, form, fy, q, cx).fee - cur.fee234)));
      if (give > 0 && TDSReg.setPortion(x.c.id, form, fy, q, cur.interest, r2(cur.fee234 + give), {nosave: true}, cur.others).ok){ left = r2(left - give); n++; }
    });
    if (n){ TDSReg.done(); saveBooks(); }
    return {ok: true, n, short: left};
  },
  // ---------------- before the file: what blocks it, what to look at
  // {block: [{k, words, n, ids}], warn: [...], info: [...]}
  checks(form, fy, q){
    form = form || "26Q";
    const cx = TDSReg.ctx(), rows = TDS.formRows(form).filter(r => r.fy === fy && r.q === q), out = {block: [], warn: [], info: []};
    const un = rows.filter(r => !r.challan && r.tds > 0.005);
    if (un.length) out.block.push({k: "untagged", n: un.length, ids: un.map(r => r.id), words: un.length + " deduction" + (un.length === 1 ? " is" : "s are") + " on no challan (" + money(un.reduce((a, r) => a + r.tds, 0)) + "): match " + (un.length === 1 ? "it" : "them") + " first. The file is not made while any is left out."});
    const over = TDSReg.overUsed(fy, q, form);
    if (over.length) out.block.push({k: "over", n: over.length, words: over.map(c => "Challan " + TDSCH.label(c) + " is used " + money(-TDSReg.balance(c, cx).tax) + " beyond its tax").join("; ") + ": take deductions off it."});
    const stale = rows.filter(r => r.splitStale);
    if (stale.length) out.block.push({k: "stale", n: stale.length, words: stale.length + " split deduction" + (stale.length === 1 ? "'s" : "s'") + " tax changed in the books: undo the split and split it again."});
    const mine = TDS.challans().filter(c => (cx.uses[c.id] || {})[TDSReg.key(form, fy, q)]);
    const notPortioned = mine.filter(c => this.warnShort(num(c.interest) + TDSReg.feeOf(c)) && !TDSReg.explicit(c));
    if (notPortioned.length) out.warn.push({k: "portion", words: notPortioned.map(c => TDSCH.label(c)).join(", ") + ": interest or fee paid on " + (notPortioned.length === 1 ? "this challan is" : "these challans is") + " not allocated by a person; the file takes the interest due on the return's late deductions on it (and, its only return, its fee): check it on Challans."});
    mine.forEach(c => {
      const n = TDSReg.notes(c, form, fy, q);
      if (n.some(w => /^challan of/.test(w))) out.warn.push({k: "earlier", words: "Challan " + TDSCH.label(c) + ": " + n.filter(w => /^challan of/.test(w)).join("; ") + ". Check its balance with TRACES' challan status."});
      if (n.some(w => /nature/.test(w))) out.info.push({k: "nature", words: "Challan " + TDSCH.label(c) + ": " + n.filter(w => /nature/.test(w)).join("; ") + "."});
      // next-tds-early (the owner): several sections on one challan is allowed and said nowhere
    });
    return out;
  },
  // ---------------- g. the AI, for what the rules leave (the tds-challan-match function; one Claude call)
  ai: {},                              // form|fy|q -> {hash, busy, state, say, raw, at}
  aiKey(form, fy, q){ return (this.books().cid || "") + "|" + form + "|" + fy + "|" + q; },
  aiOf(form, fy, q){ const a = this.ai[this.aiKey(form, fy, q)]; return a && a.hash === this.leftHash(form, fy, q) ? a : (a && !a.raw ? a : null); },
  aiState(form, fy, q){ return this.ai[this.aiKey(form, fy, q)] || null; },
  // on unless the firm's AI help is off, its TDS part off, or the client left out of AI help (Settings, AI help)
  aiAllowed(){ if (typeof AIH !== "object") return false; const f = (S.firm || {}).ai || {}, c = AIH.cfg(), co = CO(); return f.on !== false && c.tdsMatch !== false && !(co && co.aiOff); },
  online(){ return typeof Cloud === "object" && Cloud.on && Cloud.on() && Cloud.sess && Cloud.sess(); },
  url(){ return String(Cloud.cfg().url || "").replace(/\/+$/, "") + "/functions/v1/tds-challan-match"; },
  // what the rules leave: the deductions no suggestion covers, the challans with tax still left after them
  leftovers(form, fy, q){
    // next-24q-split: a challan whose Tally payment paid none of this return's sections is not offered to it
    const cx = TDSReg.ctx(), rows = this.open(form, fy, q, cx), chBy = {}, kind = c => { const f = this.formsOf(chBy[c.id]); return !f || f.has(form); };
    TDS.challans().forEach(c => { chBy[c.id] = c; });
    const chs = this.chs(cx).filter(kind);
    let today = ""; try { today = istToday(); } catch (e){}
    const rules = this.rulesFor(form, rows, chs, {fy, q, today, links: this.links(rows), no: this.no(), waiting: this.waiting(form, fy, q, cx)}, cx), taken = new Set([].concat(...rules.map(s => s.ids))), use = {};
    rules.forEach(s => { (s.parts || [{chId: s.chId, paise: s.total}]).forEach(p => { use[p.chId] = (use[p.chId] || 0) + p.paise; }); });
    return {rows: rows.filter(r => !taken.has(r.id)), chs: chs.map(c => Object.assign({}, c, {bal: r2((tmP(c.bal) - (use[c.id] || 0)) / 100)})).filter(c => c.bal > 0.005)};
  },
  leftHash(form, fy, q){
    try { const l = this.leftovers(form, fy, q); return JSON.stringify([l.rows.map(r => [r.id, r.tds]), l.chs.map(c => [c.id, c.bal])]); } catch (e){ return ""; }
  },
  // ask once for these leftovers (again only when they change, or "Ask AI again"); whatever happens the rules stand
  async askAi(form, fy, q, force){
    const k = this.aiKey(form, fy, q), h = this.leftHash(form, fy, q), a = this.ai[k] = this.ai[k] || {};
    if (a.busy || (!force && a.hash === h)) return a;
    const l = this.leftovers(form, fy, q);
    a.hash = h; a.raw = null;
    if (!l.rows.length || !l.chs.length){ a.state = "nothing"; a.say = ""; return a; }
    if (!this.aiAllowed()){ a.state = "off"; a.say = "AI is off for this firm or client (Settings, AI help): the rules' suggestions stand."; return a; }
    if (!this.online()){ a.state = "offline"; a.say = "AI needs the firm account (signed in): the rules' suggestions stand."; return a; }
    a.busy = true; render();
    try {
      await Cloud.fresh().catch(() => {});
      const c = Cloud.cfg(), s = Cloud.sess();
      const send = (r) => ({id: r.id, sec: r.sec, date: r.date, tds: r.tds, party: r.party, pan: tmMask(r.pan), fy: r.fy, q: r.q});
      const sendC = (x) => ({id: x.id, sec: x.sec, date: x.date, minor: x.minor, bal: x.bal, interestLeft: x.interestLeft, fy: x.fy, bsr: x.bsr, serial: x.serial, narr: String(x.narr || "").slice(0, 120)});
      const res = await fetch(this.url(), {method: "POST", headers: {"Content-Type": "application/json", apikey: c.key, Authorization: "Bearer " + (s && s.access_token)},
        body: JSON.stringify({action: "suggest", client_id: S.books.cid, form, fy, q, ai: true, rows: l.rows.map(send), challans: l.chs.map(sendC)})});
      let j = null; try { j = await res.json(); } catch (e){}
      if (!j || !j.ok) throw new Error((j && j.error) || ("HTTP " + res.status));
      a.raw = j.ai && j.ai.state === "used" ? {pairs: j.pairs || [], splits: j.splits || [], interest: j.interest || []} : null;
      a.state = (j.ai && j.ai.state) || "failed"; a.say = (j.ai && j.ai.say) || "";
    } catch (e){
      a.state = "failed"; a.say = "AI could not be reached just now (" + String(e.message || e).slice(0, 120) + "): the rules' suggestions stand.";
    }
    a.busy = false; a.at = Date.now(); render();
    return a;
  },
  // called when a return's Challans tab is drawn: asks once for the leftovers, when they changed
  view(form, fy, q){
    try {
      const k = this.aiKey(form, fy, q), a = this.ai[k];
      if (!S.books || TDSReg.locked(fy, q, form)) return a || null;
      if (!a || (!a.busy && a.hash !== this.leftHash(form, fy, q))) setTimeout(() => this.askAi(form, fy, q), 0);
      return a || null;
    } catch (e){ return null; }
  }
};

/* ---------- the actions of the Challans tab (app/src/screens/tds/Match.jsx) ---------- */
const tdsRet = () => ({form: S.tdsForm || "26Q", fy: S.tdsFy, q: S.tdsQ});
function tdsMatchConfirm(key){
  const t = tdsRet(), s = TDSMatch.find(key, t.form, t.fy, t.q);
  if (s && s.rule === "split"){ tdsSplitOpen(key); return {ok: false, split: true}; }
  const r = TDSMatch.confirm(key, t.form, t.fy, t.q);
  if (!r.ok){ toast(r.why); render(); return r; }
  if (s && s.rule === "int"){ toast("Interest " + money(s.interest) + (s.fee ? " and fee " + money(s.fee) : "") + " allocated to this return."); render(); return r; }
  toast(r.n + " deduction" + (r.n === 1 ? "" : "s") + " matched.", {actions: [{label: "Undo", run: () => { TDSCH.untag(s.ids); render(); }}]});
  render(); return r;
}
function tdsMatchConfirmAll(){
  const t = tdsRet(), r = TDSMatch.confirmAll(t.form, t.fy, t.q);
  toast(r.n + " deduction" + (r.n === 1 ? "" : "s") + " matched to " + r.challans + " challan" + (r.challans === 1 ? "" : "s") + (r.interest ? "; interest allocated on " + r.interest : "") + "." + (r.why.length ? " Not done: " + r.why[0] : ""));
  render(); return r;
}
function tdsMatchNo(key){ const t = tdsRet(); TDSMatch.notThis(key, t.form, t.fy, t.q); toast("Set aside: it is not suggested again."); render(); }
function tdsMoveOpen(ids){ S.tdsMove = {ids: (ids || []).slice()}; render(); }
function tdsMoveTo(ids, chId){
  const r = TDSMatch.move(ids, chId);
  if (!r.ok){ toast(r.why); return r; }
  toast(r.n + " deduction" + (r.n === 1 ? "" : "s") + " moved to challan " + TDSCH.label(TDS.challans().find(c => c.id === chId)) + ".");
  S.tdsMove = null; S.tdsSel = {}; render(); return r;
}
function tdsTakeOff(ids){
  const r = TDSMatch.takeOff(ids);
  if (!r.ok){ toast(r.why); return r; }
  toast(r.n + " deduction" + (r.n === 1 ? "" : "s") + " taken off " + (r.n === 1 ? "its challan" : "their challans") + "."); S.tdsSel = {}; render(); return r;
}
function tdsSplitOpen(key){ S.tdsSplit = {key}; render(); }
// Split… on a deduction more than a challan's balance (the challan panel): that challan first, the rest on another
function tdsSplitRow(rowId, chId){ S.tdsSplit = {rowId, chId}; render(); }
function tdsSplitDo(rowId, parts){
  const r = TDSMatch.split(rowId, parts);
  if (!r.ok){ toast(r.why); return r; }
  toast("Split in " + r.n + " parts, each on its challan."); S.tdsSplit = null; render(); return r;
}
function tdsUnsplit(rowId){ const r = TDSMatch.unsplit(rowId); toast(r.ok ? "Split undone: the deduction is whole again, on no challan." : r.why); render(); return r; }
function tdsAllocateDue(){
  const t = tdsRet(), r = TDSMatch.allocateDue(t.form, t.fy, t.q);
  toast(!r.ok ? r.why : r.n ? "Interest due allocated on " + r.n + " challan" + (r.n === 1 ? "" : "s") + "." : "The interest due is allocated already."); render(); return r;
}
function tdsAllocateFeeDue(){
  const t = tdsRet(), r = TDSMatch.allocateFeeDue(t.form, t.fy, t.q);
  toast(!r.ok ? r.why : r.short > 0 ? money(r.short) + " of the late fee could not be allocated: no challan of this return has that much free. Pay it on a challan." : r.n ? "Late fee 234E allocated." : "The late fee is allocated already."); render(); return r;
}
// (others not given: fee is the fee and others together, the fee first; TDSReg.setPortion)
function tdsPortionSet(chId, interest, fee, others){
  const t = tdsRet(), r = TDSReg.setPortion(chId, t.form, t.fy, t.q, interest, fee, undefined, others);
  toast(r.ok ? "Interest " + money(num(interest)) + ", fee " + money(num(fee)) + (others != null ? " and others " + money(num(others)) : "") + " of this challan allocated to " + t.form + " " + t.q + " " + t.fy + "." : r.why); render(); return r;
}
// ---------------------------------------------------------------- round 86: the TDS rows of Tally's entries, read right
// (the owner, 19-Oct-2026: "this is coming again and again": Rent rows with TDS = the whole rent, Contractor rows with
// assessable 0.00, 10% deducted shown as 7.5% "exempt in Tally", Section blank). The rows the cloud keeps
// (tally_tds_details_marked, TCloud.tdsLines) as FinCom shows them, the rows stored before the reader was fixed included:
//   - a row whose TDS is its own ledger line's amount with no assessable amount (the old reader took the line's amount
//     when Tally gave no tax), or a row of the TDS ledger / party line echoing another row of the same entry, deductee and
//     nature that has the assessable amount: hidden;
//   - exempt only when Tally marked it so AND no tax was booked;
//   - the rate is the one booked (TDS / assessable x 100); where Tally's nature master says another, one note says both;
//   - the section, where Tally's row has none, from the nature (TDSTally.sectionOf).
// Validate & file shows, folded under "Checks from Tally", only the rows of the return's year and quarter with a real
// problem: the rate booked is not the law's for the section (where known), no PAN, the section unknown.
const TDSTallyRows = {
  pct: (v) => Math.round(num(v) * 10000) / 10000,
  // the ledger line's own amount in the books (the entry from the cloud copy: id = Tally's GUID), or null
  lineAmt(r){
    const v = ((S.books || {}).vouchers || []).find(x => x.id === r.guid); if (!v || !Array.isArray(v.ent)) return null;
    const e = v.ent[num(r.line_no)];
    return e && (!r.ledger || e.l === r.ledger) ? Math.abs(num(e.a)) : null;
  },
  // one row as shown: {row, hide, tax, base, exempt, booked, tallyRate, note, section, sectionFrom, day}
  view(r, all){
    const tax = r.amount == null || r.amount === "" ? null : num(r.amount), base = num(r.assessable), day = TDS.ymd(r.day);
    const la = this.lineAmt(r);
    const echo = !(base > 0) && (all || []).some(x => x !== r && x.guid === r.guid && x.party === r.party && x.nature === r.nature && num(x.assessable) > 0);
    const own = !(base > 0) && tax != null && la != null && Math.abs(Math.abs(tax) - la) < 0.005;
    const exempt = !!r.exempt && !(tax != null && Math.abs(tax) > 0.005);
    const tallyRate = r.rate == null || r.rate === "" ? null : num(r.rate);
    const booked = base > 0 && tax != null && Math.abs(tax) > 0.005 ? this.pct(Math.abs(tax) / base * 100) : exempt ? 0 : tallyRate;
    const note = !exempt && tallyRate && booked != null && Math.abs(tallyRate - booked) >= 0.05 ? "Tally\u2019s nature says " + tallyRate + "%; " + booked + "% was deducted" : "";
    let section = TDS.sec(r.section || ""), sectionFrom = r.section_from || "";
    if (!section && r.nature){ try { section = TDSTally.sectionOf(r.nature, day) || ""; } catch (e){ section = ""; } if (section) sectionFrom = "Tally's nature of payment"; }
    return {row: r, hide: echo || own, tax, base, exempt, booked, tallyRate, note, section, sectionFrom, day};
  },
  // what is wrong with a row shown: [{k, words}]
  problems(w){
    const out = [], r = w.row, pan = (() => { try { return TDS.panOf(r.party); } catch (e){ return ""; } })();
    if (!w.section) out.push({k: "section", words: "section unknown: Tally's nature \u201c" + (r.nature || "") + "\u201d names none"});
    if (!Certs.validPan(pan)) out.push({k: "pan", words: "no PAN for " + (r.party || "the deductee") + " (20% under 206AA)"});
    else if (w.section && !w.exempt && w.booked != null && w.tax != null){
      let e = null;
      try { e = Certs.expectedNormal({section: w.section, pan, rate: w.booked, party: r.party, paid: w.base, pay: TDSRate.kindOf((r.nature || "") + " " + (r.ledger || ""))}); } catch (z){ e = null; }
      const std = TDS.STD[w.section] || [];
      if (e && e.rate != null && std.length && Math.abs(e.rate - w.booked) >= 0.05) out.push({k: "rate", expected: e.rate, words: w.booked + "% deducted; the law's rate is " + e.rate + "% (" + e.why + ")"});
    }
    return out;
  },
  // the return's form takes the row's section
  ofForm(sec, form){
    const s = TDS.sec(sec || "");
    if (form === "24Q") return /^192/.test(s);
    if (form === "27EQ") return /^206C/.test(s);
    if (form === "27Q") return /^195/.test(s);
    return !/^(192|195|206C)/.test(s);
  },
  // the rows of the return's year and quarter with a problem: {busy, missing, rows: [{...view, problems}], seen}
  checks(cid, fy, q, form){
    if (typeof TCloud !== "object" || !TCloud.on() || !TCloud.book(cid)) return {rows: [], off: true};
    const x = TCloud.tdsLines(cid), all = x.rows;
    if (!all) return {rows: [], busy: !x.missing && !x.err, missing: !!x.missing, err: x.err || ""};
    const views = all.map(r => this.view(r, all)).filter(w => !w.hide && w.day && TDS.fyOf(w.day) === fy && TDS.qOf(w.day) === q && this.ofForm(w.section, form));
    const rows = views.map(w => Object.assign(w, {problems: this.problems(w)})).filter(w => w.problems.length);
    return {rows, seen: views.length};
  }
};

if (typeof globalThis === "object") Object.assign(globalThis, {TDSMatch, TDSTallyRows, tdsRet, tdsMatchConfirm, tdsMatchConfirmAll, tdsMatchNo, tdsMoveOpen, tdsMoveTo, tdsTakeOff, tdsSplitOpen, tdsSplitRow, tdsSplitDo, tdsUnsplit, tdsPortionSet, tdsAllocateDue, tdsAllocateFeeDue});
/* @react-lazy: end */
