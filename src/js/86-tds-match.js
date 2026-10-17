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
      return {id: c.id, sec: /^206C/.test(sec) ? "206C" : sec, date: TDS.ymd(c.date), minor: String(c.minorHead || "200"), bal: TDSReg.balance(c, cx).tax, interestLeft: TDSReg.balance(c, cx).interest, fy: TDS.fyOf(c.date), label: this.label(c),
        bsr: c.bsr || "", serial: c.serial || "", narr: c.fromVoucher && vs[c.fromVoucher] ? vs[c.fromVoucher].narr || "" : ""};
    }).filter(c => c.bal > 0.005 || (all && c.interestLeft > 0.005) || all === "any");
  },
  label(c){ return c ? (c.bsr || "") + " / " + (c.serial || "") + " · " + (c.date ? fmtDate(tallyDate(TDS.ymd(c.date))) : "") : ""; },
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
  // ---------------- the suggestions: rules a to f, then the AI's (g), each with its rule and reason in words
  suggest(form, fy, q){
    form = form || "26Q";
    const k = "sg" + form + fy + q;
    return typeof perRender === "function" ? perRender(this, k, () => this.suggestNow(form, fy, q)) : this.suggestNow(form, fy, q);
  },
  suggestNow(form, fy, q){
    if (!S.books || TDSReg.locked(fy, q, form)) return [];
    const cx = TDSReg.ctx(), rows = this.open(form, fy, q, cx), chs = this.chs(cx);
    const opt = {fy, q, links: rows.length ? this.links(rows) : {}, no: this.no()};
    let out = rows.length && chs.length ? tmRules(rows, chs, opt) : [];
    // the AI's pairings (a run kept for these deductions), checked again against what is free now
    const ai = this.aiOf(form, fy, q);
    if (ai && ai.raw && rows.length){
      const taken = new Set([].concat(...out.map(s => s.ids))), use = {};
      out.forEach(s => { (s.parts || [{chId: s.chId, paise: s.total}]).forEach(p => { use[p.chId] = (use[p.chId] || 0) + p.paise; }); });
      const chs2 = this.chs(cx, true).map(c => Object.assign({}, c, {bal: Math.max(0, tmP(c.bal) - (use[c.id] || 0)) / 100}));
      out = out.concat(tmAiCheck(ai.raw, rows.filter(r => !taken.has(r.id)), chs2, opt).sugg.filter(s => s.rule !== "int"));
    }
    return out.concat(this.interestSugg(form, fy, q, cx, ai && ai.raw));
  },
  // interest and fee to allocate to this return, pre-filled (the owner: "interest allocation ... pre-filled as suggestions
  // too"): for each challan this return uses, the default (defaultPortion) where more than allocated now; the AI's
  // proposal where the rules offer none (checked: within the challan's interest left, whole rupees)
  interestSugg(form, fy, q, cx, raw){
    const k = TDSReg.key(form, fy, q), no = this.no(), out = [];
    TDS.challans().filter(c => (cx.uses[c.id] || {})[k]).forEach(c => {
      const key = "int:" + c.id, cur = TDSReg.portionFor(c, form, fy, q, cx), d = this.defaultPortion(c, form, fy, q);
      // a person's own allocation for this return is never offered over (only none yet)
      if (no[key] || ((TDSReg.portions(c) || {})[k]) || (d.interest <= cur.interest + 0.005 && d.fee <= cur.fee + 0.005)) return;
      const interest = Math.max(d.interest, cur.interest), fee = Math.max(d.fee, cur.fee);
      out.push({key, rule: "int", words: TM_RULES.int, chId: c.id, ids: [], total: 0, interest, fee, warn: "", info: "",
        reason: (d.due > 0 ? "Interest " + money(d.due) + " is due on this return's late deductions on this challan" : "This return is the only one using this challan") + ": allocate interest " + money(interest) + (fee ? " and fee " + money(fee) : "") + " of it here"});
    });
    if (raw && raw.interest && raw.interest.length){
      const chs = this.chs(cx, true).filter(c => (cx.uses[c.id] || {})[k]);
      tmAiCheck({pairs: [], splits: [], interest: raw.interest}, [], chs, {fy, q, no}).sugg.filter(s => !out.some(o => o.chId === s.chId)).forEach(s => {
        const cur = TDSReg.portionFor(TDS.challans().find(c => c.id === s.chId), form, fy, q, cx);
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
      return tmReasons(rows, this.chs(cx, "any"), this.suggestNow(form, fy, q).filter(s => s.ids.length), {fy, q, today, pct: form === "27EQ" ? 1 : 1.5});
    };
    return typeof perRender === "function" ? perRender(this, k, f) : f();
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
    return TDSCH.tag(s.ids, s.chId, Object.assign({via: "suggestion", note: "suggestion confirmed: " + s.words + (s.rule === "g" ? " (" + s.reason + ")" : "")}, opt || {}));
  },
  // every suggestion but the splits, in one go (worked out together, they never use a challan beyond its balance)
  confirmAll(form, fy, q){
    form = form || "26Q";
    const list = this.suggestNow(form, fy, q).filter(s => s.rule !== "split" && s.rule !== "int");
    const cx = TDSReg.ctx(); let n = 0, ints = 0; const chs = new Set(), why = [];
    list.forEach(s => {
      const r = TDSCH.tag(s.ids, s.chId, {via: "suggestion", note: "suggestion confirmed: " + s.words + (s.rule === "g" ? " (" + s.reason + ")" : ""), cx, nosave: true});
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
  expand(rows){
    const sp = this.books().tdsSplits || {}, alloc = this.books().alloc || {};
    if (!Object.keys(sp).length) return rows;
    this._base = this._base || {};
    const out = [];
    rows.forEach(r => {
      const s = sp[r.id];
      if (!s || !(s.parts || []).length){ out.push(r); return; }
      this._base[r.id] = r;
      const tot = s.parts.reduce((a, p) => a + TDSCH.p(p.tds), 0);
      if (tot !== TDSCH.p(r.tds)){ out.push(Object.assign(r, {splitStale: true})); return; }
      let paidLeft = TDSCH.p(r.paid);
      s.parts.forEach((p, i) => {
        const last = i === s.parts.length - 1, pp = last ? paidLeft : Math.round(TDSCH.p(r.paid) * TDSCH.p(p.tds) / tot);
        paidLeft -= pp;
        const id = r.id + "#" + (i + 1);
        out.push(Object.assign({}, r, {id, splitOf: r.id, part: i + 1, parts: s.parts.length, tds: TDSCH.p(p.tds) / 100, paid: pp / 100, challan: alloc[id] || ""}));
      });
    });
    return out;
  },
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
    if (log.act === "auto" || log.act === "balance") return {kind: "auto", words: "Matched by: FinCom's earlier automatic allocation (" + when(log) + ")"};
    return {kind: "you", words: "Matched by: " + when(log).replace(/, /, " (") + ")"};
  },
  // ---------------- interest, fee and others: allocated to a return by a person (TDSReg.setPortion); the default offered
  // interest: what this return's late deductions on this challan owe (TDS.interest), else, when this return is the only one
  // using the challan, its interest left; never more than is left. Fee (and others): the challan's, when this return is
  // its only user. {interest, fee, due}
  defaultPortion(c, form, fy, q){
    const cx = TDSReg.ctx(), bal = TDSReg.balance(c, cx), cur = TDSReg.portionFor(c, form, fy, q, cx), only = Object.keys(cx.uses[c.id] || {}).length <= 1;
    const iLeft = r2(bal.interest + cur.interest), fLeft = r2(bal.fee + cur.fee);
    const due = r2(TDS.interest(fy, q, form).filter(x => (x.kind === "pay" && x.challan && x.challan.id === c.id) || (x.kind === "deduct" && x.row.challan === c.id)).reduce((a, x) => a + x.amount, 0));
    const interest = due > 0 ? Math.min(Math.ceil(due), iLeft) : only ? iLeft : 0;
    return {interest: r2(Math.max(0, interest)), fee: only ? fLeft : 0, due};
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
    const due = r2(TDS.interest(fy, q, form).filter(x => x.kind !== "unpaid").reduce((a, x) => a + x.amount, 0));
    const given = r2(mine.reduce((a, c) => a + TDSReg.portionFor(c, form, fy, q, cx).interest, 0));
    if (due >= 1 && given + 0.5 < due) out.warn.push({k: "interest", words: "Interest of " + money(due) + " is due on late deductions or payments; " + money(given) + " is allocated to this return. Allocate the interest paid on its challan (below each challan)."});
    const notPortioned = mine.filter(c => (num(c.interest) || TDSReg.feeOf(c)) && !TDSReg.explicit(c));
    if (notPortioned.length) out.warn.push({k: "portion", words: notPortioned.map(c => TDSCH.label(c)).join(", ") + ": interest or fee paid on " + (notPortioned.length === 1 ? "this challan is" : "these challans is") + " not allocated to any return; the file writes only what is allocated."});
    mine.forEach(c => {
      const n = TDSReg.notes(c, form, fy, q);
      if (n.some(w => /^challan of/.test(w))) out.warn.push({k: "earlier", words: "Challan " + TDSCH.label(c) + ": " + n.filter(w => /^challan of/.test(w)).join("; ") + ". Check its balance with TRACES' challan status."});
      if (n.some(w => /nature/.test(w))) out.info.push({k: "nature", words: "Challan " + TDSCH.label(c) + ": " + n.filter(w => /nature/.test(w)).join("; ") + "."});
      const secs = Array.from(new Set(((cx.uses[c.id] || {})[TDSReg.key(form, fy, q)].ids || []).map(id => this.sec(cx.byRow[id].r))));
      if (secs.length > 1) out.info.push({k: "mixed", words: "Challan " + TDSCH.label(c) + " pays " + secs.join(", ") + ": several sections on one challan is allowed; one challan per section per month is easier to check."});
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
    const cx = TDSReg.ctx(), rows = this.open(form, fy, q, cx), chs = this.chs(cx);
    const rules = tmRules(rows, chs, {fy, q, links: this.links(rows), no: this.no()}), taken = new Set([].concat(...rules.map(s => s.ids))), use = {};
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
function tdsSplitDo(rowId, parts){
  const r = TDSMatch.split(rowId, parts);
  if (!r.ok){ toast(r.why); return r; }
  toast("Split in " + r.n + " parts, each on its challan."); S.tdsSplit = null; render(); return r;
}
function tdsUnsplit(rowId){ const r = TDSMatch.unsplit(rowId); toast(r.ok ? "Split undone: the deduction is whole again, on no challan." : r.why); render(); return r; }
function tdsPortionSet(chId, interest, fee){
  const t = tdsRet(), r = TDSReg.setPortion(chId, t.form, t.fy, t.q, interest, fee);
  toast(r.ok ? "Interest " + money(num(interest)) + " and fee " + money(num(fee)) + " of this challan allocated to " + t.form + " " + t.q + " " + t.fy + "." : r.why); render(); return r;
}
