/* @react-lazy: begin 93-tds-autoplace.js (the React app loads this file with its TDS screens: app/src/lib/tdsGlobals.js; build.py react_parts) */
/* ================================================================== */
/* Place automatically (next-tds-autoplace, the owner's approval of  */
/* 23-Oct-2026: sections C and D of the TDS check of 22-Oct-2026)    */
/* ================================================================== */
// One button on a return's Deductions step: the deductions on no challan placed by the rules that are certain (R1 to R5:
// tmPlan in server/_shared/tdsmatch.js, through TDSMatch.suggestNow), each with its rule and reason in the allocation
// trail ("rule: <words> · <reason> · R2 · run <id>"), shown in the Deductions register's How placed column. The rest stays
// suggested (R6 to R8, R5 with something left over, R2/R3 paid late, the AI's R9), one click each, or said ("need a
// challan"). The result is one line: "312 placed · 18 suggested · 5 need a challan" with Undo.
// Never: on a return marked filed (TDSReg.locked); on a challan dated before a deduction; a later month's own challan for
// an earlier month; beyond a challan's tax (TDSCH.tag refuses it); a deduction a person took off a challan (the trail's
// untag, not a stale one and not this Undo's) is not put back.
// Undo: each run is one step, kept with the books in S.books.matchNo (a person's matching decisions, synced with the
// books; no new books item, no table) as "auto|<form|fy|q>" = {run, at, by, form, fy, q, n, g: [{ch, code, ids}]}: one
// click takes off what the run placed and is still where the run put it, so the allocation is exactly as before (a
// person's own placing made after the run stays). Only the last run of a return is kept.
const TDSAuto = {
  key(form, fy, q){ return "auto|" + TDSReg.key(form || "26Q", fy, q); },
  last(form, fy, q){ const r = ((S.books || {}).matchNo || {})[this.key(form, fy, q)]; return r && r.run ? r : null; },
  ACTS: ["tag", "untag", "suggestion", "auto", "tally", "balance", "split"],
  // the deductions a person took off a challan (their last placing act an untag that is not a stale one or an Undo of a run)
  off(){
    const last = {};
    ((S.books || {}).allocLog || []).forEach(l => { if (l && l.row && this.ACTS.includes(l.act)) last[l.row] = l; });
    return new Set(Object.keys(last).filter(k => last[k].act === "untag" && !/^(stale|undo: )/.test(last[k].note || "")));
  },
  // what is left after a run: the open deductions in a suggestion, and those with none ("need a challan"); sg the run's
  // suggestions (what it placed is no longer open), else worked out again
  left(form, fy, q, sg){
    sg = (sg || TDSMatch.suggestNow(form, fy, q)).filter(s => s.ids.length && s.rule !== "int");
    const inS = new Set([].concat(...sg.map(s => s.ids))), open = TDSReg.openRows(fy, q, form, TDSReg.ctx()), suggested = open.filter(r => inS.has(r.id)).length;
    return {suggested, need: open.length - suggested};
  },
  // the run: {ok, why, run, placed, suggested, need, why2: [refusals]}
  run(form, fy, q){
    form = form || "26Q";
    const b = S.books;
    if (!b) return {ok: false, why: "Open the client's books first."};
    if (TDSReg.locked(fy, q, form)) return {ok: false, why: TDSReg.lockWords(fy, q, form)};
    // (the register's context: kept up to date by each tag, so worked out once for the run; 10,000 deductions)
    const off = this.off(), id = "ap" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), cx = TDSReg.ctx(), groups = [], why2 = [];
    const plan = TDSMatch.suggestNow(form, fy, q);
    let n = 0;
    plan.filter(s => s.auto && s.ids.length && !s.parts && s.rule !== "int" && !s.ids.some(r => off.has(r))).forEach(s => {
      const r = TDSCH.tag(s.ids, s.chId, {via: "auto", note: "rule: " + s.words + " · " + s.reason + " · " + s.code + " · run " + id, cx, nosave: true});
      if (r.ok && r.n){ n += r.n; groups.push({ch: s.chId, code: s.code, ids: s.ids.slice()}); } else if (!r.ok) why2.push(r.why);
    });
    if (n){
      b.matchNo = Object.assign({}, b.matchNo || {}, {[this.key(form, fy, q)]: {run: id, at: new Date().toISOString(), by: TDSReg.who(), form, fy, q, n, g: groups}});
      TDSReg.done(); saveBooks();
    }
    const l = this.left(form, fy, q, plan);
    return {ok: true, run: n ? id : "", placed: n, suggested: l.suggested, need: l.need, why2, form, fy, q};
  },
  // the one result line
  words(r){ return r ? r.placed + " placed · " + r.suggested + " suggested · " + r.need + " need a challan" : ""; },
  // Undo of the last run: {ok, why, n}
  undo(form, fy, q){
    form = form || "26Q";
    const b = S.books, rec = this.last(form, fy, q);
    if (!b || !rec) return {ok: false, why: "Nothing to undo."};
    if (TDSReg.locked(fy, q, form)) return {ok: false, why: TDSReg.lockWords(fy, q, form)};
    const alloc = b.alloc || {}, ids = [];
    (rec.g || []).forEach(g => g.ids.forEach(r => { if (alloc[r] === g.ch) ids.push(r); }));
    if (ids.length){
      const L0 = (b.allocLog || []).length, u = TDSCH.untag(ids, {cx: TDSReg.ctx(), nosave: true});
      if (!u.ok) return u;
      (b.allocLog || []).slice(L0).forEach(l => { if (l.act === "untag") l.note = "undo: automatic placing " + rec.run; });
    }
    const m = Object.assign({}, b.matchNo || {}); delete m[this.key(form, fy, q)]; b.matchNo = m;
    TDSReg.done(); saveBooks();
    return {ok: true, n: ids.length};
  },
  // how a deduction was placed by a run, when the trail no longer has its line (the trail keeps its last 5,000): {code}
  howOf(rowId){
    const m = (S.books || {}).matchNo || {};
    if (this._ix && this._ix.m === m) return this._ix.by[rowId] || null;
    const by = {};
    Object.keys(m).filter(k => k.indexOf("auto|") === 0).forEach(k => (m[k].g || []).forEach(g => g.ids.forEach(r => { by[r] = {code: g.code, ch: g.ch, at: m[k].at}; })));
    this._ix = {m, by};
    return by[rowId] || null;
  }
};
// the Deductions step's button and its Undo (app/src/screens/tds/Winman.jsx); the result kept for the page (S.tdsAp)
function tdsAutoPlace(){
  const t = tdsRet(), r = TDSAuto.run(t.form, t.fy, t.q);
  if (!r.ok){ toast(r.why); render(); return r; }
  S.tdsAp = Object.assign({key: TDSReg.key(t.form, t.fy, t.q)}, r);
  render(); return r;
}
function tdsAutoUndo(){
  const t = tdsRet(), r = TDSAuto.undo(t.form, t.fy, t.q);
  toast(r.ok ? "Undone: " + r.n + " deduction" + (r.n === 1 ? "" : "s") + " back as they were." : r.why);
  if (r.ok) S.tdsAp = null;
  render(); return r;
}
if (typeof globalThis === "object") Object.assign(globalThis, {TDSAuto, tdsAutoPlace, tdsAutoUndo});
/* @react-lazy: end */
