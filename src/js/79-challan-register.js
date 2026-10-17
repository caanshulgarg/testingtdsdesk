/* ================================================================== */
/* One challan register per client TAN (tds-layout, 14-Oct-2026)       */
/* ================================================================== */
// The owner's rules (Anshul, approved 13/14-Oct-2026), every return drawing on one register of the client's challans:
//  1. one register: each challan with its tax, interest and fee paid, what each return and quarter uses of it, and what is
//     left (balance(): the one balance, by head; "Balance left" is tax + interest + fee everywhere). Challans come from
//     Tally (bridge 2.4.3), uploads, a Tally payment made a challan, or typed in by hand (addHand);
//  2. never overbooked: what all returns use of a challan never passes its amount; tax, interest and fee each kept apart,
//     each with its own limit. Anything over is refused with "₹X left on this challan" (TDSCH.tag, useBalance, setPortion);
//  3. cross-form use allowed (the owner's decision): a salary (92B) challan may pay 26Q deductions and the other way
//     round; a small neutral note says so ("challan nature 92B used in 26Q"), nothing is refused;
//  4. earlier periods' unused balances allowed (the owner's decision): a challan of an earlier quarter or year may pay a
//     later return's deductions; a note says so ("challan of FY 2025-26 used in FY 2026-27") and the audit trail keeps it;
//  5. a return marked filed (TDSFiled, src/js/66) has its allocations locked: they change only once a correction is
//     opened for that return (openCorrection), which the audit trail records;
//  6. auto-allocation (autoAllocate, the app's one allocator): Tally's own tags (2.4.3, allocFrom "tally") first and never
//     moved; then the return's open deductions to challans of the same form (by the challan's nature) and year, oldest
//     challan first; unused balances of other forms and earlier periods only suggested, one click each (useBalance);
//  7. a new challan goes in by itself (the owner, 14-Oct-2026): to the draft return of its own type and quarter, capped by
//     its balance; a filed return is never changed; one whose type cannot be told is asked in To fix (autoPlace);
//  8. TRACES: a consolidated file or a challan status file brought in (TRF, src/js/70) is compared, challan by challan,
//     with what FinCom uses of it; a difference, or a hand challan TRACES does not know, is flagged (traces).
// Where it is kept: which deduction a challan pays stays S.books.alloc (row id -> challan id), as before: the FVU file
// (src/js/16) and every figure read it, so nothing already worked out moves. New, with the books: chPortions (a
// challan's interest and fee given to returns by a person), tdsCorr (corrections opened), allocLog (the audit trail),
// tracesChStatus (TRACES' challan status file). The audit trail also goes, signed in, to the firm's cloud as rows of
// tds_challan_allocations (migration 80: add-only, rows never changed or removed, row security per firm).
// Two browsers: each use is checked against the books as just re-read from the firm's copy (fresh, before a person's use);
// two people using one challan in the same second can still pass it, which the FVU file then refuses (src/js/16) and To fix
// shows ("used beyond its amount"). A guarantee would need the check in the database; it is not made here.
const TDSReg = {
  FORMS: ["26Q", "27Q", "27EQ", "24Q"],
  books(){ return S.books || {}; },
  memo(k, f){ return typeof perRender === "function" ? perRender(this, k, f) : f(); },
  key(form, fy, q){ return form + "|" + fy + "|" + q; },
  // ---------------- one context per action: every deduction with its form, what each return uses of each challan ----------------
  // {byRow: {id: {r, form}}, uses: {chId: {"form|fy|q": {form, fy, q, tax, n, ids}}}, use: {chId: tax used}}; kept up to
  // date by tag/untag within the action (track), so a loop of tags reads it, never works it out again
  ctx(){
    // within a drawing, once per drawing (perRender); in an action, once per action: kept for the rest of this task (an
    // action runs at once; one that waits starts again with its books as they are then)
    if (typeof IN_RENDER === "undefined" || !IN_RENDER){
      // kept while the same books, entries, salary and payroll, and the same allocations (the object and how many: tag and
      // untag keep the context up to date themselves; a write to b.alloc made elsewhere adds or takes out a key, or calls forget)
      const b = S.books || {}, a = b.alloc, an = a ? Object.keys(a).length : 0;
      if (this._cx && this._cx.books === S.books && this._cx.v === b.vouchers && this._cx.s === b.salary && this._cx.p === b.payroll && this._cx.a === a && this._cx.an === an) return this._cx.cx;
      const cx = this.build();
      this._cx = {books: S.books, v: b.vouchers, s: b.salary, p: b.payroll, a, an, cx};
      Promise.resolve().then(() => { this._cx = null; });
      return cx;
    }
    return this.memo("ctx", () => this.build());
  },
  // the context worked out again at the next ctx() (after a write to b.alloc that is not a tag or an untag)
  forget(){ this._cx = null; },
  // tag and untag kept the context up to date (track): it stays the action's context with the allocations as they are now
  kept(cx){ const b = S.books || {}; if (this._cx && this._cx.cx === cx){ this._cx.a = b.alloc; this._cx.an = b.alloc ? Object.keys(b.alloc).length : 0; } },
  build(){
    {
      const byRow = {}, uses = {}, use = {};
      this.FORMS.forEach(form => TDS.formRows(form).forEach(r => { if (!byRow[r.id]) byRow[r.id] = {r, form}; }));
      Object.values(byRow).forEach(({r, form}) => { if (r.challan) this.track({uses, use}, r, form, r.challan, 1); });
      return {byRow, uses, use};
    }
  },
  track(x, r, form, chId, sign){
    const k = this.key(form, r.fy, r.q), m = x.uses[chId] = x.uses[chId] || {};
    const u = m[k] = m[k] || {form, fy: r.fy, q: r.q, tax: 0, n: 0, ids: []};
    u.tax = r2(u.tax + sign * r.tds); u.n += sign; x.use[chId] = r2((x.use[chId] || 0) + sign * r.tds);
    if (sign > 0) u.ids.push(r.id); else u.ids = u.ids.filter(id => id !== r.id);
    if (u.n <= 0) delete m[k];
  },
  byRow(cx){ return (cx || this.ctx()).byRow; },
  uses(cx){ return (cx || this.ctx()).uses; },
  formOfRow(id, cx){ const x = this.byRow(cx)[id]; return x ? x.form : ""; },
  // ---------------- the challan's nature: its own form ----------------
  // the form a challan is for by its nature of payment (its section); "" when it does not say, and for minor head 400
  homeForm(c){
    if (String((c && c.minorHead) || "200") === "400") return "";
    const s = TDSCH.secNorm(c && c.section);
    if (!s) return "";
    if (s === "192") return "24Q";
    if (/^206C/.test(s)) return "27EQ";
    if (TDS.NR.test(TDS.sec(s))) return "27Q";
    return "26Q";
  },
  // the section a form's challan is under when nothing else says (24Q: 192, 27EQ: 206C, 27Q: 195; 26Q: none in particular)
  sectionOfForm(form){ return {"24Q": "192", "27EQ": "206C", "27Q": "195"}[form] || ""; },
  // the nature as the challan writes it: 92B for salary (a code typed by hand kept: 92A government, 92B others), 94C, 6CE
  natureCode(c){ if (c && c.natureCode) return c.natureCode; const s = TDSCH.secNorm(c && c.section); return !s ? "" : s === "192" ? "92B" : s.replace(/^1(9\d)/, "$1").replace(/^206C/, "6C"); },
  feeOf(c){ return r2(num(c.fee) + num(c.others)); },
  // ---------------- the balance: the one ----------------
  // a challan's interest and fee by return: what a person allocated (chPortions), and nothing else. next-challan-match (the
  // owner, 17-Oct-2026; FVU 1.2's "interest allocated" / "others allocated"): interest and fee are ALLOCATED to a return
  // explicitly, the Challans tab offering the amount (TDSMatch.defaultPortion); none allocated, the return's file carries
  // 0.00. (Before, none set gave the whole to the challan's home return by itself.) The fee portion is the fee and others
  // together, the fee first (the register's split, tds/Register.jsx)
  portions(c){ return ((this.books().chPortions || {})[c && c.id]) || null; },
  explicit(c){ return !!((this.books().chPortions || {})[c && c.id]); },
  portionsUsed(c, cx){ const p = this.portions(c, cx) || {}; return {interest: r2(Object.values(p).reduce((a, x) => a + num(x.interest), 0)), fee: r2(Object.values(p).reduce((a, x) => a + num(x.fee), 0))}; },
  // what a return uses of every challan: its own share (the return's Challans figure; the TDS review, M6)
  usedBy(fy, q, form, cx){ const k = this.key(form, fy, q); return r2(Object.values((cx || this.ctx()).uses).reduce((a, m) => a + num((m[k] || {}).tax), 0)); },
  // what is left of a challan, by head: {tax, interest, fee, total}. Tax: less what the deductions tagged to it use; interest
  // and fee: less what a person gave to returns (none given: all of it is still the challan's to give)
  balance(c, cx){
    const pu = this.portionsUsed(c, cx), tax = r2(num(c.tax) - ((cx || this.ctx()).use[c.id] || 0));
    const interest = r2(num(c.interest) - pu.interest), fee = r2(this.feeOf(c) - pu.fee);
    return {tax, interest, fee, total: r2(tax + interest + fee)};
  },
  usedTax(c, cx){ return r2((cx || this.ctx()).use[c.id] || 0); },
  // the interest and fee a return's file carries for a challan: its portion (portions: a person's, else all to the home return)
  portionFor(c, form, fy, q, cx){
    const x = (this.portions(c, cx) || {})[this.key(form, fy, q)] || {};
    return {interest: num(x.interest), fee: num(x.fee), set: this.explicit(c)};
  },
  // give a return a part of a challan's interest and fee; refused over the limit of each, and on a locked return
  setPortion(chId, form, fy, q, interest, fee, opt){
    const b = S.books, c = TDS.challans().find(x => x.id === chId);
    if (!b || !c) return {ok: false, why: "No such challan."};
    if (this.locked(fy, q, form)) return {ok: false, why: this.lockWords(fy, q, form)};
    const k = this.key(form, fy, q), cur = JSON.parse(JSON.stringify(this.portions(c) || {}));
    const others = (f) => r2(Object.keys(cur).filter(x => x !== k).reduce((a, x) => a + num(cur[x][f]), 0));
    const iLeft = r2(num(c.interest) - others("interest")), fLeft = r2(this.feeOf(c) - others("fee"));
    interest = r2(num(interest)); fee = r2(num(fee));
    if (interest < 0 || fee < 0) return {ok: false, why: "An amount cannot be below nil."};
    if (TDSCH.p(interest) > TDSCH.p(iLeft)) return {ok: false, why: money(iLeft) + " left on this challan for interest: " + money(r2(interest - iLeft)) + " more cannot be given."};
    if (TDSCH.p(fee) > TDSCH.p(fLeft)) return {ok: false, why: money(fLeft) + " left on this challan for the fee: " + money(r2(fee - fLeft)) + " more cannot be given."};
    const was = cur[k] ? Object.assign({}, cur[k]) : null;
    if (interest || fee) cur[k] = {interest, fee}; else delete cur[k];
    const all = Object.assign({}, b.chPortions || {});
    if (Object.keys(cur).length) all[chId] = cur; else delete all[chId];
    b.chPortions = all;
    this.log({act: "portion", ch: c, form, fy, q, interest, fee, note: this.notes(c, form, fy, q).join("; ")});
    if (!(opt && opt.nosave)){ this.done(); saveBooks(); }
    return {ok: true, was};
  },
  // ---------------- notes: other form, earlier period (allowed, said) ----------------
  notes(c, form, fy, q){
    const out = [], nf = this.homeForm(c), cfy = TDS.fyOf(c.date), cq = TDS.qOf(c.date);
    if (nf && nf !== form) out.push("challan nature " + this.natureCode(c) + " used in " + form);
    if (cfy < fy) out.push("challan of FY " + cfy + " used in FY " + fy);
    else if (cfy === fy && cq < q) out.push("challan of " + cq + " " + cfy + " used in " + q);
    return out;
  },
  // ---------------- filed returns: locked ----------------
  corrKey(fy, q, form){ return fy + "|" + q + "|" + (form || "26Q"); },
  corrOpen(fy, q, form){ return !!((this.books().tdsCorr || {})[this.corrKey(fy, q, form)]); },
  filed(fy, q, form){ try { return TDSFiled.get(fy, q, form || "26Q"); } catch (e){ return null; } },
  locked(fy, q, form){ return !!this.filed(fy, q, form) && !this.corrOpen(fy, q, form); },
  lockWords(fy, q, form){ return (form || "26Q") + " " + q + " " + fy + " is marked filed: its challan allocations are locked. Open a correction for it to change them."; },
  rowLocked(id, cx){ const x = this.byRow(cx)[id]; return !!x && this.locked(x.r.fy, x.r.q, x.form); },
  // the first locked deduction among these, in words; "" when none is locked
  lockedOf(ids, cx){
    const by = this.byRow(cx);
    for (const id of ids || []){ const x = by[id]; if (x && this.locked(x.r.fy, x.r.q, x.form)) return this.lockWords(x.r.fy, x.r.q, x.form); }
    return "";
  },
  openCorrection(fy, q, form){
    const b = S.books; if (!b) return false;
    b.tdsCorr = Object.assign({}, b.tdsCorr || {}, {[this.corrKey(fy, q, form)]: {at: new Date().toISOString(), by: this.who()}});
    this.log({act: "correction", form, fy, q, note: "correction opened: allocations may change"});
    this.done(); saveBooks(); return true;
  },
  closeCorrection(fy, q, form){
    const b = S.books; if (!b || !b.tdsCorr) return false;
    const t = Object.assign({}, b.tdsCorr); delete t[this.corrKey(fy, q, form)]; b.tdsCorr = t;
    this.lockReturn(fy, q, form, "correction closed");
    this.done(); saveBooks(); return true;
  },
  // a return marked filed (TDSFiled.mark), or a correction closed: each of its allocations goes to the trail as locked
  lockReturn(fy, q, form, why){
    const cx = this.ctx(), chs = TDS.challans();
    Object.entries(cx.uses).forEach(([chId, m]) => { const u = m[this.key(form, fy, q)]; if (u) this.log({act: "lock", ch: chs.find(c => c.id === chId), form, fy, q, tax: u.tax, locked: true, note: why || "return marked filed"}); });
  },
  // ---------------- the audit trail ----------------
  who(){ try { return (Cloud.st && Cloud.st.email) || ((Cloud.sess && Cloud.sess()) || {}).email || ""; } catch (e){ return ""; } },
  // one line: {act: tag | untag | auto | tally | suggestion | balance | portion | lock | correction | challan-add |
  // challan-edit | challan-link | challan-delete, ch, form, fy, q, row, tax, interest, fee, locked, note}; pushed now,
  // the list trimmed and sent once the action is done (done())
  log(e){
    const b = S.books; if (!b) return null;
    const c = e.ch || null;
    const x = {id: uid("al"), at: new Date().toISOString(), by: this.who(), act: e.act, ch: c ? c.id : "", chKey: TDSCH.chKey(c), form: e.form || "", fy: e.fy || "", q: e.q || "",
      row: e.row || "", tax: r2(num(e.tax)), interest: r2(num(e.interest)), fee: r2(num(e.fee)), locked: !!e.locked, note: String(e.note || "").slice(0, 500)};
    (b.allocLog = b.allocLog || []).push(x);
    return x;
  },
  done(){ const b = S.books; if (b && b.allocLog && b.allocLog.length > 5000) b.allocLog = b.allocLog.slice(-5000); this.flushSoon(); },
  logTag(rows, c, via, cx, why){
    rows.forEach(r => { const form = this.formOfRow(r.id, cx) || "26Q"; this.log({act: via || "tag", ch: c, form, fy: r.fy, q: r.q, row: r.id, tax: r.tds, note: [why || ""].concat(this.notes(c, form, r.fy, r.q)).filter(Boolean).join("; ")}); });
  },
  logUntag(list, cx){
    list.forEach(({r, ch}) => { const form = this.formOfRow(r.id, cx) || "26Q"; this.log({act: "untag", ch, form, fy: r.fy, q: r.q, row: r.id, tax: r.tds}); });
  },
  trail(chId){ return (this.books().allocLog || []).filter(x => !chId || x.ch === chId).slice().reverse(); },
  // the cloud's copy (migration 80): the lines after this browser's sent-up-to marker (kept in this browser only, so marking
  // them sent changes nothing in the books and starts no sync), in calls of 500; a line sent twice is kept once (client_ref)
  cloud: {none: false, busy: false},
  cloudOn(){ try { return typeof Cloud === "object" && Cloud.on() && !!(Cloud.st && Cloud.st.firm); } catch (e){ return false; } },
  sentKey(cid){ return "fincom:alloclog-sent:" + cid; },
  flushSoon(){ if (!this.cloudOn() || this.cloud.none) return; clearTimeout(this.ft); this.ft = setTimeout(() => this.flush(), 1500); },
  async flush(){
    const b = S.books;
    if (!b || !b.cid || !this.cloudOn() || this.cloud.none || this.cloud.busy) return 0;
    const log = b.allocLog || [], mark = lsGet(this.sentKey(b.cid)) || "", at = mark ? log.findIndex(x => x.id === mark) : -1;
    const todo = log.slice(at + 1).slice(0, 500);
    if (!todo.length) return 0;
    this.cloud.busy = true;
    let tan = ""; try { tan = String((CO() || {}).tan || ""); } catch (e){}
    try {
      await Cloud.api("tds_challan_allocations?on_conflict=firm_id,client_ref", {method: "POST", headers: {Prefer: "resolution=ignore-duplicates,return=minimal"},
        body: todo.map(x => ({client_id: b.cid, tan, challan_id: x.ch || "", challan_key: x.chKey || "", form: x.form || "", fy: x.fy || "", quarter: x.q || "", deduction_id: x.row || "",
          action: x.act, tax: x.tax, interest: x.interest, fee: x.fee, locked: !!x.locked, note: x.note || "", client_ref: x.id}))});
      lsSet(this.sentKey(b.cid), todo[todo.length - 1].id);
    } catch (e){
      if (/tds_challan_allocations/.test(String(e && e.message)) && /PGRST20|does not exist|schema cache|Could not find/i.test(String(e && e.message))) this.cloud.none = true;
    }
    this.cloud.busy = false;
    if (todo.length === 500) this.flushSoon();
    return todo.length;
  },
  // ---------------- two browsers: the books re-read from the firm's copy before a person's use ----------------
  async fresh(){
    const b = S.books;
    if (!b || !b.cid || typeof BookItems !== "object" || !BookItems.on()) return false;
    try { await Promise.race([BookItems.pullNow(b.cid), new Promise(res => setTimeout(res, 4000))]); return true; } catch (e){ return false; }
  },
  // ---------------- auto-allocation ----------------
  // a challan of the return's own year: deposited in the year, or (March's TDS, due by 30 April) for Q4 up to 31 May after
  sameYear(c, fy, q){ const d = TDS.ymd(c.date); return TDS.fyOf(d) === fy || (q === "Q4" && TDS.fyOf(d) > fy && d <= String(num(String(fy).slice(0, 4)) + 1) + "0531"); },
  sameStep(c, fy, q, form){ return this.sameYear(c, fy, q) && (this.homeForm(c) === form || !this.homeForm(c)); },
  // the return's deductions on no challan, oldest first (the smaller first on one day)
  openRows(fy, q, form, cx){
    return Object.values(this.byRow(cx)).filter(x => x.form === form && x.r.fy === fy && x.r.q === q && !x.r.challan && x.r.tds > 0).map(x => x.r)
      .sort((a, b) => String(TDS.ymd(a.date)).localeCompare(String(TDS.ymd(b.date))) || TDSCH.p(a.tds) - TDSCH.p(b.tds));
  },
  // next-challan-match: the "Auto-allocate N" button (autoAllocate) and the one-click suggestions of other forms' and
  // earlier periods' balances (suggestions) are gone: the one matcher (TDSMatch, src/js/86) suggests, a person confirms.
  // ---------------- one rule, one function: a challan's balance used by a return ----------------
  // The register's "Use…" and a return's "Add from register" (and its one-click suggestions) are this one call: the
  // return's open deductions, oldest first, each whole, up to the amount given (never past the challan's tax left);
  // interest and fee, when given, added to the return's portion within their own balance. Refused, nothing changed, over
  // any balance or on a return marked filed. only(r): which deductions may be used (a new challan's own placing).
  // {ok, why, n, ids, tax, interest, fee, short, was (the portion before, for Undo)}
  useBalance(chId, form, fy, q, amount, interest, fee, via, only){
    const c = TDS.challans().find(x => x.id === chId);
    if (!c) return {ok: false, why: "No such challan."};
    form = form || "26Q";
    if (!this.FORMS.includes(form) || !/^Q[1-4]$/.test(q || "") || !/^\d{4}-\d{2}$/.test(fy || "")) return {ok: false, why: "Choose the form, the year and the quarter."};
    if (this.locked(fy, q, form)) return {ok: false, why: this.lockWords(fy, q, form)};
    const cx = this.ctx(), bal = this.balance(c, cx), want = r2(num(amount)), wi = r2(num(interest)), wf = r2(num(fee));
    if (want < 0 || wi < 0 || wf < 0) return {ok: false, why: "An amount cannot be below nil."};
    if (!want && !wi && !wf) return {ok: false, why: "Give the amount to use."};
    if (TDSCH.p(want) > TDSCH.p(bal.tax)) return {ok: false, why: money(bal.tax) + " left on this challan: " + money(r2(want - bal.tax)) + " more cannot be used."};
    if (TDSCH.p(wi) > TDSCH.p(bal.interest)) return {ok: false, why: money(bal.interest) + " of interest left on this challan: " + money(r2(wi - bal.interest)) + " more cannot be used."};
    if (TDSCH.p(wf) > TDSCH.p(bal.fee)) return {ok: false, why: money(bal.fee) + " of fee left on this challan: " + money(r2(wf - bal.fee)) + " more cannot be used."};
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
      const cur = this.portionFor(c, form, fy, q, cx);
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
    if (r.was) this.setPortion(r.chId, r.form, r.fy, r.q, r.was.interest, r.was.fee, {nosave: true});
    this.done(); saveBooks(); return {ok: true};
  },
  // the return's open total: what "Use…" fills in (the balance, or less when the return needs less)
  openTotal(fy, q, form, cx){ return r2(this.openRows(fy, q, form, cx).reduce((a, r) => a + r.tds, 0)); },
  // a return's use of a challan taken off: its deductions untagged and its interest and fee portion cleared; refused when
  // filed. {ok, ids, was} (for Undo: use them again)
  removeUse(chId, form, fy, q){
    const c = TDS.challans().find(x => x.id === chId);
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
    if (r.was) this.setPortion(r.chId, r.form, r.fy, r.q, r.was.interest, r.was.fee, {nosave: true});
    this.done(); saveBooks(); return {ok: true};
  },
  // the open returns a challan may be used by: every form and quarter with deductions, of any year (a challan may pay a
  // later return from its unused balance, or an earlier one paid late), not marked filed (or under correction); its own
  // return first. [{form, fy, q, open (₹ still on no challan), own}]
  openReturns(c, cx){
    cx = cx || this.ctx();
    const seen = {}, out = [], own = this.ownReturn(c);
    Object.values(cx.byRow).forEach(({r, form}) => {
      const k = this.key(form, r.fy, r.q);
      if (seen[k]) return;
      seen[k] = 1;
      if (!this.locked(r.fy, r.q, form)) out.push({form, fy: r.fy, q: r.q, open: this.openTotal(r.fy, r.q, form, cx), own: !!own && own === k});
    });
    return out.sort((a, b) => (b.own - a.own) || b.fy.localeCompare(a.fy) || a.q.localeCompare(b.q) || this.FORMS.indexOf(a.form) - this.FORMS.indexOf(b.form));
  },
  // ---------------- a new challan goes in by itself (the owner, 14-Oct-2026) ----------------
  // A challan made from now on (typed by hand, uploaded, made from a Tally payment, or read from Tally) is marked autoPlace
  // "pending" where it is made; one already in the books never is, so nothing already allocated moves. Once Tally's own
  // tags are in (TDSTally.sync runs first), each pending challan with nothing used yet goes to the draft return of its own
  // type (homeForm) and quarter: the quarter it was deposited in, else the one before (the last month's TDS is paid in the
  // next quarter). Only that return's open deductions of the challan's section, dated on or before the deposit, oldest
  // first, each whole, up to the challan's tax (useBalance, the one rule). A return marked filed is never changed. A
  // challan whose type cannot be told is not placed: To fix of its quarter's returns asks which return.
  ownReturn(c){
    const d = TDS.ymd(c.date), form = this.homeForm(c);
    if (!form || !d) return "";
    if (c.placedIn) return c.placedIn;
    return this.key(form, TDS.fyOf(d), TDS.qOf(d));
  },
  // what Tally links (its bill references): the deductions, Tally's to tag (TDSTally.sync) or the person's where Tally's link
  // is unclear ("tag it by hand"), never placed by autoPlace; and the payments, whose challan waits for the sync's tags
  // before it is placed (the owner's order: Tally's tags first). {rows: Set, vids: Set}
  tallyLinked(){
    try { const l = typeof TDSTally === "object" && S.books ? TDSTally.links(S.books) : []; return {rows: new Set(l.map(x => x.row)), vids: new Set(l.map(x => x.vid))}; }
    catch (e){ return {rows: new Set(), vids: new Set()}; }
  },
  // tl: tallyLinked(), once for several; synced: called by the sync, after Tally's tags. next-challan-match (the owner,
  // 17-Oct-2026: shown first, confirmed with one click, never applied by itself): a new challan is no longer allocated here;
  // its draft return (its own type and quarter, else the quarter before) is named, where the one matcher (TDSMatch) shows
  // what it can pay as suggestions. A challan whose type cannot be told is still asked in To fix ("unknown").
  autoPlace(c, tl, synced){
    if (!c || c.autoPlace !== "pending") return {placed: false};
    tl = tl || this.tallyLinked();
    if (c.fromVoucher && tl.vids.has(c.fromVoucher) && !synced) return {placed: false, waiting: true};   // still "pending": the sync looks at it
    const cx = this.ctx();
    if (this.usedTax(c, cx) > 0.005){ c.autoPlace = "used"; return {placed: false}; }
    const form = this.homeForm(c);
    if (!form){ c.autoPlace = "unknown"; return {placed: false, unknown: true}; }
    const d = TDS.ymd(c.date), fy0 = TDS.fyOf(d), q0 = TDS.qOf(d);
    const prev = q0 === "Q1" ? {fy: (num(fy0.slice(0, 4)) - 1) + "-" + fy0.slice(2, 4), q: "Q4"} : {fy: fy0, q: "Q" + (num(q0.slice(1)) - 1)};
    c.autoPlace = "suggested";
    for (const t of [{fy: fy0, q: q0}, prev]){
      if (this.locked(t.fy, t.q, form)) continue;
      const n = typeof TDSMatch === "object" ? TDSMatch.suggestNow(form, t.fy, t.q).filter(s => s.chId === c.id || (s.parts || []).some(p => p.chId === c.id)).length : 0;
      if (n) return {placed: false, suggested: true, form, fy: t.fy, q: t.q, n, chId: c.id};
    }
    return {placed: false};
  },
  // every pending challan, once the challans are made (addHand, TDSCH.add, TDSTally.sync, challanFromBooks)
  placeNew(synced){ const p = TDS.challans().filter(c => c.autoPlace === "pending"), tl = p.length ? this.tallyLinked() : null; return p.map(c => Object.assign({c}, this.autoPlace(c, tl, synced))); },
  // the words and the way to the return whose Challans tab suggests what a new challan pays: "Matches suggested on 26Q Q2 →"
  placedToast(p, lead){
    if (!p || !p.suggested) return toast(lead);
    toast(lead + " What it can pay is suggested on " + p.form + " " + p.q + " " + p.fy + ": confirm it there.", {actions: [{label: p.form + " " + p.q + " →", run: () => tdsGoTab(p.fy, p.q, p.form, "challans")}]});
  },
  // the challans whose type could not be told, deposited in this quarter or the next (To fix asks which return)
  unknownType(fy, q){
    return this.memo("unk" + fy + q, () => {
      const nq = q === "Q4" ? {fy: (num(fy.slice(0, 4)) + 1) + "-" + String(num(fy.slice(0, 4)) + 2).slice(2), q: "Q1"} : {fy, q: "Q" + (num(q.slice(1)) + 1)}, cx = this.ctx();
      return TDS.challans().filter(c => c.autoPlace === "unknown" && this.usedTax(c, cx) < 0.005 && ((TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q) || (TDS.fyOf(c.date) === nq.fy && TDS.qOf(c.date) === nq.q)));
    });
  },
  // challans this return uses beyond their amount (two browsers at once; an old tagging): To fix says so
  overUsed(fy, q, form){ const cx = this.ctx(); return TDS.challans().filter(c => (cx.uses[c.id] || {})[this.key(form, fy, q)] && this.balance(c, cx).tax < -0.005); },
  // ---------------- the register ----------------
  // every challan of the client's TAN: {c, uses: [{form, fy, q, tax, n, ids, locked, notes, portion}], bal}
  register(){
    return this.memo("register", () => {
      const cx = this.ctx();
      return TDS.challans().map(c => ({c, bal: this.balance(c, cx),
        uses: Object.values(cx.uses[c.id] || {}).sort((a, b) => (a.fy + a.q + a.form).localeCompare(b.fy + b.q + b.form))
          .map(u => Object.assign({}, u, {locked: this.locked(u.fy, u.q, u.form), notes: this.notes(c, u.form, u.fy, u.q), portion: this.portionFor(c, u.form, u.fy, u.q, cx)}))}));
    });
  },
  // the split of a challan's amount by head (the register's row shows the total; the split on hover)
  split(c){ return {tax: num(c.tax), interest: num(c.interest), fee: num(c.fee), others: num(c.others), total: r2(num(c.tax) + num(c.interest) + num(c.fee) + num(c.others))}; },
  // ---------------- challans entered by hand (the owner's request of 14-Oct-2026) ----------------
  // The same rules as every other challan once in (never overbooked, other form and earlier year with a note, filed returns
  // locked). Checked here, without TRACES: the TAN is the client's, the BSR code 7 digits, the date a real day not after
  // today, the serial 5 digits, the minor head 200 or 400, the nature of payment one FinCom knows, amounts not below nil
  // and not all nil, mode bank or online. The year is the date's (financial year). The challan itself is made by TDSCH.make,
  // as an uploaded one is.
  MODES: [["online", "Online (e-Pay Tax)"], ["bank", "Over the bank counter"]],
  realDay(d){ if (!/^\d{8}$/.test(d)) return false; const x = new Date(tallyDate(d) + "T00:00:00Z"); return !isNaN(x) && x.toISOString().slice(0, 10) === tallyDate(d); },
  srcOf(c){
    if (!c) return "";
    if (typeof TDSTally === "object" && TDSTally.made(c)) return "tally";
    return c.from === "upload" ? "upload" : c.from === "books" || c.fromVoucher ? "books" : "hand";
  },
  srcWords(c){ return {tally: "From Tally", hand: "Entered by hand", upload: "Uploaded from the portal", books: "From a Tally payment"}[this.srcOf(c)] || ""; },
  // the register's row (round 3 B, the owner 14-Oct-2026): the source in two words beside the BSR code / serial
  srcShort(c){ return {tally: "Tally", hand: "by hand", upload: "portal", books: "Tally payment"}[this.srcOf(c)] || ""; },
  // "Set type" (round 3 B): a challan that gives no nature of payment (or a wrong one) gets one. Kept with the challan as
  // FinCom's own note (Tally is not changed), in the trail, and a challan of unknown type is then placed in its own draft
  // return as a new one is (autoPlace). Not while a filed return uses it.
  setNature(chId, code){
    const c = TDS.challans().find(z => z.id === chId);
    if (!c) return {ok: false, why: "No such challan."};
    const f = this.filedUsing(c);
    if (f.length) return {ok: false, why: "A filed return uses this challan (" + f.map(u => u.form + " " + u.q + " " + u.fy).join(", ") + "): open a correction for it first."};
    const raw = String(code || "").trim().toUpperCase(), section = /^6C[A-Z]{1,2}$/.test(raw) ? "20" + raw : raw;
    if (!TDSCH.secNorm(section)) return {ok: false, why: "Give the nature of payment (section code), e.g. 94C or 194C, 92B for salary."};
    const was = this.natureCode(c) || "none";
    c.section = section; c.natureCode = /^(9[2-6][A-Z]{0,3}|6C[A-Z]{1,2})$/.test(raw) ? raw : "";
    c.natureSet = {at: new Date().toISOString(), by: this.who(), was};
    this.log({act: "challan-edit", ch: c, tax: c.tax, note: "type set: " + was + " to " + (this.natureCode(c) || section)});
    let placed = null;
    if (c.autoPlace === "unknown"){ c.autoPlace = "pending"; this.forget(); placed = this.autoPlace(c, this.tallyLinked(), true); }
    this.forget(); this.done(); saveBooks();
    return {ok: true, placed};
  },
  // {ok, errors: {field: words}, c (the challan as it would be kept), dup, dupTally}
  check(x, editId){
    const e = {}, t = (v) => String(v == null ? "" : v).trim();
    let co = null; try { co = CO(); } catch (err){}
    const ctan = String((co && co.tan) || "").toUpperCase(), tan = t(x.tan || ctan).toUpperCase();
    if (!/^[A-Z]{4}\d{5}[A-Z]$/.test(tan)) e.tan = "The TAN is 10 characters: 4 letters, 5 digits, a letter.";
    else if (ctan && tan !== ctan) e.tan = "This client's TAN is " + ctan + ": a challan of another TAN belongs to that deductor.";
    if (!/^\d{7}$/.test(t(x.bsr))) e.bsr = "The BSR code is 7 digits.";
    const date = TDSCH.date8(t(x.date));
    if (!this.realDay(date)) e.date = "Give the date of deposit.";
    else if (date > istToday()) e.date = "The date of deposit cannot be after today.";
    else if (date < "20040401") e.date = "A challan of before April 2004 is not one TRACES holds.";
    if (!/^\d{5}$/.test(t(x.serial))) e.serial = "The challan serial number is 5 digits (as printed, with leading zeros).";
    const minor = t(x.minorHead || "200");
    if (minor !== "200" && minor !== "400") e.minorHead = "The minor head is 200 (TDS payable by taxpayer) or 400 (regular assessment).";
    // a TCS nature as the challan writes it (6CE, 6CR, ...) is section 206C and its letters
    const secIn = t(x.section).toUpperCase(), section = /^6C[A-Z]{1,2}$/.test(secIn) ? "20" + secIn : secIn;
    if (!TDSCH.secNorm(section)) e.section = "Give the nature of payment (section code), e.g. 94C or 194C, 92B for salary.";
    const AM = ["tax", "surcharge", "cess", "interest", "fee", "others"];
    AM.forEach(k => { const raw = t(x[k]).replace(/[₹\s]/g, ""); if (raw && !/^\d[\d,]*(\.\d{0,2})?$/.test(raw)) e[k] = /^-/.test(raw) ? "Not below nil." : "An amount in rupees."; });
    if (!AM.some(k => TDSCH.money2(x[k]) > 0) && !AM.some(k => e[k])) e.tax = "Give the amounts paid: they are all nil.";
    const mode = !x.mode || x.mode === "online" ? "online" : x.mode === "bank" ? "bank" : "";
    if (!mode) e.mode = "Online or over the bank counter.";
    // the challan, made as an uploaded one is (TDSCH.make), then what only a hand entry has
    const c = Object.keys(e).length ? null : Object.assign(TDSCH.make({bsr: t(x.bsr), serial: t(x.serial), date: tallyDate(date), section, minor, tax: x.tax, surcharge: x.surcharge, cess: x.cess,
      interest: x.interest, fee: x.fee, others: x.others}) || {}, {natureCode: /^(9[2-6][A-Z]{0,3}|6C[A-Z]{1,2})$/.test(secIn) ? secIn : "", year: TDS.fyOf(date), yearKind: "FY", mode, tan},
      t(x.note) ? {note: t(x.note).slice(0, 500)} : {});
    // the same BSR code, date and serial, of this TAN: never twice
    const dup = c ? TDS.challans().find(z => z.id !== editId && TDSCH.chKey(z) === TDSCH.chKey(c)) || null : null;
    const dupTally = dup && this.srcOf(dup) === "tally" ? dup : null;
    if (dup && !dupTally) e.dup = "Challan " + TDSCH.label(dup) + " is already in the register (" + this.srcWords(dup).toLowerCase() + "): the same BSR code, date and serial cannot be added twice.";
    if (dupTally) e.dup = "This challan was read from Tally already (" + TDSCH.label(dupTally) + "). Link your details to it rather than add a second copy.";
    return {ok: !Object.keys(e).length, errors: e, c, dup, dupTally};
  },
  // anything filed (and not under correction) that uses the challan; its allocations, if any
  filedUsing(c){ return Object.values(this.uses()[c.id] || {}).filter(u => this.locked(u.fy, u.q, u.form)); },
  hasAlloc(c){ return Object.keys(this.uses()[c.id] || {}).length > 0 || this.explicit(c); },
  canEdit(c){
    if (!c) return "No such challan.";
    if (this.srcOf(c) === "tally") return "This challan was read from Tally: change it in Tally, and it comes in again with the books.";
    const f = this.filedUsing(c);
    if (f.length) return "A filed return uses this challan (" + f.map(u => u.form + " " + u.q + " " + u.fy).join(", ") + "): open a correction for it first.";
    return "";
  },
  // why a challan cannot be deleted ("" when it can): one read from Tally, or one anything is allocated to
  canDelete(c){
    if (!c) return "No such challan.";
    if (this.srcOf(c) === "tally") return "This challan was read from Tally: remove it in Tally.";
    if (this.hasAlloc(c)) return "Deductions or an interest or fee portion are allocated to this challan: take them off first.";
    return "";
  },
  async keepReceipt(id, file){
    if (!file) return null;
    let co = null; try { co = CO(); } catch (e){}
    if (!co) return null;
    try { await FileStore.put(co.id, id, file); S.files[id] = file; } catch (e){}
    if (typeof CloudDocs === "object" && CloudDocs.on()) CloudDocs.add(co.id, id, file, "challan");
    return {name: file.name, size: file.size};
  },
  // add a challan typed in: {ok, why, errors, dupTally, c, placed}; it goes to its own draft return by itself (autoPlace)
  async addHand(x, file){
    const b = S.books; if (!b) return {ok: false, why: "Open the client's books first."};
    const r = this.check(x);
    if (!r.ok) return {ok: false, errors: r.errors, dupTally: r.dupTally, why: Object.values(r.errors)[0]};
    const c = Object.assign({id: uid("ch"), from: "hand", madeBy: "hand", autoPlace: "pending", enteredBy: this.who() || (typeof whoAmI === "function" ? whoAmI() : ""), enteredAt: new Date().toISOString()}, r.c);
    if (file){ const k = await this.keepReceipt(c.id, file); if (k) c.receipt = k; }
    b.challans = (b.challans || []).concat([c]);
    this.log({act: "challan-add", ch: c, tax: c.tax, interest: c.interest, fee: this.feeOf(c), note: "entered by hand" + (c.note ? ": " + c.note : "")});
    const placed = this.autoPlace(c);
    this.done(); saveBooks();
    return {ok: true, c, placed};
  },
  // a hand-typed challan that Tally already has: the person's note and receipt kept on Tally's challan (its figures stay Tally's)
  async linkToTally(chId, x, file){
    const c = TDS.challans().find(z => z.id === chId);
    if (!c || this.srcOf(c) !== "tally") return {ok: false, why: "That challan is not one read from Tally."};
    const note = String((x && x.note) || "").trim();
    if (note) c.note = note.slice(0, 500);
    if (file){ const k = await this.keepReceipt(c.id, file); if (k) c.receipt = k; }
    c.linkedBy = this.who(); c.linkedAt = new Date().toISOString();
    this.log({act: "challan-link", ch: c, note: "details typed by hand linked to Tally's challan" + (note ? ": " + note : "")});
    this.done(); saveBooks();
    return {ok: true, c};
  },
  async editHand(chId, x, file){
    const c = TDS.challans().find(z => z.id === chId);
    const no = this.canEdit(c); if (no) return {ok: false, why: no};
    const r = this.check(x, chId);
    if (!r.ok) return {ok: false, errors: r.errors, why: Object.values(r.errors)[0]};
    const used = this.usedTax(c);
    if (TDSCH.p(r.c.tax) < TDSCH.p(used)) { const why = money(used) + " of this challan's tax is used by returns: the tax cannot be less."; return {ok: false, errors: {tax: why}, why}; }
    const was = TDSCH.label(c) + ", tax " + money(c.tax);
    ["incomeTax", "surcharge", "cess", "fee", "others", "note", "cin"].forEach(k => { delete c[k]; });
    Object.assign(c, r.c, {editedBy: this.who(), editedAt: new Date().toISOString()});
    if (file){ const k = await this.keepReceipt(c.id, file); if (k) c.receipt = k; }
    this.log({act: "challan-edit", ch: c, tax: c.tax, interest: c.interest, fee: this.feeOf(c), note: "edited; was " + was});
    this.done(); saveBooks();
    return {ok: true, c};
  },
  // a soft delete, with its reason (canDelete says when it cannot); restore brings it back
  deleteHand(chId, reason){
    const c = TDS.challans().find(z => z.id === chId), no = this.canDelete(c);
    if (no) return {ok: false, why: no};
    const why = String(reason || "").trim();
    if (why.length < 3) return {ok: false, why: "Say why the challan is deleted."};
    c.deleted = {at: new Date().toISOString(), by: this.who(), reason: why.slice(0, 300)};
    this.log({act: "challan-delete", ch: c, tax: c.tax, note: "deleted: " + why.slice(0, 300)});
    this.done(); saveBooks();
    return {ok: true};
  },
  restore(chId){
    const c = ((this.books().challans) || []).find(z => z.id === chId && z.deleted);
    if (!c) return {ok: false, why: "No such deleted challan."};
    const dup = TDS.challans().find(z => TDSCH.chKey(z) === TDSCH.chKey(c));
    if (dup) return {ok: false, why: "Challan " + TDSCH.label(dup) + " is in the register again: this one cannot come back beside it."};
    delete c.deleted;
    this.log({act: "challan-add", ch: c, tax: c.tax, note: "restored"});
    this.done(); saveBooks(); return {ok: true};
  },
  deletedList(){ return ((this.books().challans) || []).filter(c => c.deleted); },
  async receipt(chId){
    const c = ((this.books().challans) || []).find(z => z.id === chId), r = c && c.receipt;
    if (!r) return;
    try { const f = await FileStore.get((CO() || {}).id, chId, r.docPath, r.name); if (!f) throw new Error("missing"); saveFile(r.name, f); }
    catch (e){ toast("The receipt is not on this computer" + (r.docPath ? " and could not be fetched from the firm's documents." : ". Attach it again.")); }
  },
  // ---------------- TRACES ----------------
  // TRACES' consumed amount per challan against FinCom's use: from a consolidated file (the statement's challans) and a
  // challan status file (each challan's consumed amount across statements); a challan entered by hand that TRACES does not
  // know. Each: {src: conso | status | unknown, form, fy, q, key, label, challan, fincom, traces, diff, unknown, hint}
  traces(filter){
    const byKey = {}, out = [], cx = this.ctx(), uses = cx.uses;
    TDS.challans().forEach(c => { byKey[TDSCH.chKey(c)] = c; });
    const k = (bsr, date, serial) => TDSCH.chKey({bsr, date, serial});
    TRF.consos().forEach(cs => (cs.cd || []).forEach(cd => {
      const key = k(cd.bsr, cd.date, cd.serial), c = byKey[key], form = cs.form || "26Q";
      const fin = c ? num(((uses[c.id] || {})[this.key(form, cs.fy, cs.q)] || {}).tax) : 0;
      out.push({src: "conso", file: cs.file, form, fy: cs.fy, q: cs.q, key, label: cd.bsr + "/" + cd.serial + " · " + fmtDate(tallyDate(TDS.ymd(cd.date))), challan: c || null,
        fincom: r2(fin), traces: r2(num(cd.consumed)), diff: r2(fin - num(cd.consumed))});
    }));
    ((this.books().tracesChStatus || [])).forEach(f => (f.rows || []).forEach(x => {
      const key = k(x.bsr, x.date, x.serial), c = byKey[key], fin = c ? this.usedTax(c, cx) : 0;
      out.push({src: "status", file: f.file, form: "", fy: "", q: "", key, label: x.bsr + "/" + x.serial + " · " + fmtDate(tallyDate(TDS.ymd(x.date))), challan: c || null,
        fincom: r2(fin), traces: r2(num(x.consumed)), diff: r2(fin - num(x.consumed))});
    }));
    // a challan entered by hand that TRACES does not know: in no challan record of a consolidated file for a return that
    // uses it, or (a challan status file read) not in that file though deposited within its dates. A near one TRACES has
    // (two of the BSR code, date and serial the same) is named: one of the three was likely typed wrong
    const near = (c, list) => { const m = list.find(t => [t.bsr === c.bsr, TDS.ymd(t.date) === TDS.ymd(c.date), String(t.serial).padStart(5, "0") === String(c.serial).padStart(5, "0")].filter(Boolean).length === 2);
      return m ? "TRACES has " + m.bsr + "/" + fmtDate(tallyDate(TDS.ymd(m.date))) + "/" + String(m.serial).padStart(5, "0") + ": check the " + (m.bsr !== c.bsr ? "BSR code" : TDS.ymd(m.date) !== TDS.ymd(c.date) ? "date of deposit" : "serial number") : ""; };
    const hand = TDS.challans().filter(c => this.srcOf(c) === "hand");
    TRF.consos().forEach(cs => {
      const form = cs.form || "26Q", known = new Set((cs.cd || []).map(cd => k(cd.bsr, cd.date, cd.serial)));
      hand.filter(c => (uses[c.id] || {})[this.key(form, cs.fy, cs.q)] && !known.has(TDSCH.chKey(c))).forEach(c => out.push({src: "unknown", file: cs.file, form, fy: cs.fy, q: cs.q, key: TDSCH.chKey(c), label: TDSCH.label(c), challan: c,
        fincom: r2(num(((uses[c.id] || {})[this.key(form, cs.fy, cs.q)] || {}).tax)), traces: 0, diff: 0, unknown: true, hint: near(c, cs.cd || [])}));
    });
    ((this.books().tracesChStatus || [])).forEach(f => {
      const rows = f.rows || [], known = new Set(rows.map(x => k(x.bsr, x.date, x.serial))), ds = rows.map(x => TDS.ymd(x.date)).sort();
      if (!ds.length) return;
      hand.filter(c => TDS.ymd(c.date) >= ds[0] && TDS.ymd(c.date) <= ds[ds.length - 1] && !known.has(TDSCH.chKey(c))).forEach(c => out.push({src: "unknown", file: f.file, form: "", fy: "", q: "", key: TDSCH.chKey(c), label: TDSCH.label(c), challan: c,
        fincom: this.usedTax(c, cx), traces: 0, diff: 0, unknown: true, hint: near(c, rows)}));
    });
    return out.filter(x => !filter || ((!filter.form || !x.form || x.form === filter.form) && (!filter.fy || !x.fy || x.fy === filter.fy) && (!filter.q || !x.q || x.q === filter.q)
      && (x.src !== "status" || !filter.chIds || filter.chIds.includes(x.challan && x.challan.id))));
  },
  // TRACES' challan status file (CSV or text from TRACES' challan status / OLTAS; the layout is ASSUMED, as TRF's are):
  // a header row naming BSR, the date of deposit, the challan serial, and the amount consumed (or utilised / claimed)
  parseStatus(text){
    const rows = TDSCH.csv(String(text || "").replace(/\t/g, ","));
    const at = rows.findIndex(r => r.some(x => /bsr/i.test(x)) && r.some(x => /consum|utili[sz]|claimed/i.test(x)));
    if (at < 0) return [];
    const h = rows[at].map(x => String(x || "").trim()), col = (re) => h.findIndex(x => re.test(x));
    const ci = {bsr: col(/bsr/i), date: col(/date/i), serial: col(/serial|challan\s*no/i), amount: col(/deposit(ed)?\s*amount|^amount|total/i), consumed: col(/consum|utili[sz]|claimed/i)};
    return rows.slice(at + 1).map(r => ({bsr: String(r[ci.bsr] || "").replace(/\D/g, ""), date: TDSCH.date8(r[ci.date]), serial: String(r[ci.serial] || "").replace(/\D/g, ""),
      amount: TDSCH.money2(r[ci.amount]), consumed: TDSCH.money2(r[ci.consumed])})).filter(x => x.bsr.length === 7 && x.date && x.serial);
  }
};
