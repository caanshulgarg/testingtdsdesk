/* @react-lazy: begin 47-gst-lock-checks.js (the React app loads this file with its GST and books screens: build.py react_parts) */
// GSTLock's checks that work a change out (src/js/47-closed-periods.js has the marks, the words and the asking): a 2B pair or
// tolerance (pair), a 2B brought in (twoB), a books setting such as the ISD ledger switch (guardBooks). Kept out of legacy.js
// (its size budget): every place that calls them is on a GST or books screen, which loads this file (app/src/screens/Gst.jsx)
const GSTLockMore = {
  // a change FinCom allows on a filed month when a person says so (B2C summary marks, places of supply: the filed GSTR-1
  // stays as it is and the change goes as an amendment; a 2B brought in again): asked, with a reason, and the audit trail
  // records it. w: the words (else worked out from the months). true: go on
  async ask(reg, months, forms, what, w){
    w = w || this.why(reg, months, forms);
    if (!w) return true;
    const ans = await askConfirm({title: "Change a filed month?", ok: "Change anyway",
      body: esc(w) + " The filed return is not changed." + '<label class="f" style="margin-top:12px"><span>Why (kept in the audit trail)</span><input type="text" id="cbxWhy" autocomplete="off" aria-label="Why"></label>',
      read: () => ((document.getElementById("cbxWhy") || {}).value || "").trim(), validate: (d) => d ? "" : "Say why: it is kept in the audit trail."});
    if (!ans || !ans.ok) return false;
    try { auditEvent("gst_filed_changed", {reg, months: Array.from(new Set((months || []).filter(Boolean))).slice(0, 12), what: what || "", why: w, reason: ans.data || ""}, S.coId); } catch (e){}
    return true;
  },
  // the credit every ITC line gives each month (4(A)(5) and 4(B)(1), app/src/lib/itcFinal.js)
  // (only for the months fm says are filed, when given: the rest cannot refuse anything)
  credits(reg, fm){
    const F = typeof ITCF === "object" ? ITCF : null, by = {};
    if (!F) return by;
    F.rows(reg).forEach(r => {
      if (r.fixed) return;
      const ms = new Set([r.e.C, r.bm, r.tm].concat(Object.keys(r.booksBy || {}), Object.keys(r.blkBy || {})).filter(m => m && (!fm || fm(m))));
      ms.forEach(m => { const a = F.effect(r, r.e, m), c = F.revEffect(r, r.e, m), o = by[m] = by[m] || {}; this.H.forEach(h => { o[h] = r2((o[h] || 0) + num(a[h])); o["r" + h] = r2((o["r" + h] || 0) + num(c[h])); }); });
    });
    return by;
  },
  // a change to the 2B reconciliation (change(st): applied to GST2B.state()): the words when it would move the credit of a
  // month whose 3B is filed (every line compared: a re-match that runs on to other bills is caught), else "". Worked out,
  // not guessed: a bill of a filed month whose credit was taken there, linked now to an open month's 2B, moves nothing filed.
  // Nothing filed for the registration: "" at once. Allowed and keep (the default): the change stays applied, with the
  // matching worked out for it (the caller's own same change then costs nothing); refused, or keep false: put back as it
  // was, with the matching of before
  pair(reg, keys, ids, change, keep){
    if (typeof ITCF !== "object" || typeof GST2B !== "object" || !S.books || !this.any(reg)) return "";
    const st = GST2B.state(), saved = JSON.stringify({confirm: st.confirm, link: st.link, opt: st.opt});
    const fc = new Map(), fm = m => { if (!fc.has(m)) fc.set(m, !!this.filed(reg, m)); return fc.get(m); };
    const was = this.credits(reg, fm), m0 = GST2B._memo, i0 = ITCF._memo ? ITCF._memo() : null;
    let w = "", done = false;
    try {
      if (change) change(st);
      const now = this.credits(reg, fm);
      const ms = Array.from(new Set(Object.keys(was).concat(Object.keys(now)))).sort().filter(m => this.H.some(h => Math.abs(((was[m] || {})[h] || 0) - ((now[m] || {})[h] || 0)) >= 0.005 || Math.abs(((was[m] || {})["r" + h] || 0) - ((now[m] || {})["r" + h] || 0)) >= 0.005));
      w = this.why(reg, ms); this.moved = ms.filter(m => this.filed(reg, m)); done = !w && keep !== false;
    } finally {
      if (!done){ const o = JSON.parse(saved); st.confirm = o.confirm; st.link = o.link; if (o.opt === undefined) delete st.opt; else st.opt = o.opt; GST2B._memo = m0; if (ITCF._memo) ITCF._memo(i0); }
    }
    return w;
  },
  // a change to the books' settings that moves credit between months or between the rows of table 4 (the ledger's ISD
  // switch on next-gst-isd-2b, or anything like it): t4 is the 4(A)/4(B) rows of every filed 3B month of a registration as
  // the books work them out now; guardBooks(what, apply, undo, go) applies the change, compares, undoes it (apply and undo
  // must move b.mapV or whatever the 3B's caches are keyed on), then go() at once when no filed month moves, else asked
  // with a reason (the words say a filed 3B is adjusted in the current month). For entries Tally types (not a click):
  // t4 before the books are put in, t4Moved after, and the words shown as a warning
  // fn() in one calculation's memo (as the audit runs, src/js/06): the month index and the book's documents worked out once
  scope(fn){ if (typeof JOB_MEMO === "undefined") return fn(); const was = JOB_MEMO; JOB_MEMO = new WeakMap(); IN_RENDER++; try { return fn(); } finally { IN_RENDER--; JOB_MEMO = was; } },
  // table 4 of the filed 3B months (only: those of them in it), as the books work it out now
  t4(reg, only){
    return this.scope(() => {
      const out = {};
      GSTR._carry = null;     // once: the months after it carry their credit from it, worked out in turn
      (only || GSTR.months() || []).forEach(m => { if (!this.filed(reg, m)) return; const t = GSTR.threeBm(m, reg) || {};
        out[m] = JSON.stringify(["impGoods", "impServ", "rcmIn", "isd", "other", "rev1", "rev2"].map(k => this.H.map(h => r2(num((t[k] || {})[h]))))); });
      return out;
    });
  },
  // the filed months whose table 4 moved (kept in this.moved for the audit trail), in words
  t4Moved(reg, was, now){ const ms = Object.keys(was).filter(m => was[m] !== now[m]); this.moved = ms; return this.why(reg, ms); },
  // apply() and undo() a change to the books, for the registrations with a filed 3B: {w, reg, months} when a filed month's
  // table 4 would move, else null. only: the months the change can reach (else every filed month)
  tryBooks(regs, apply, undo, only){
    regs = regs.filter(r => this.any(r));
    if (!regs.length) return null;
    const was = regs.map(r => this.t4(r, only)); let x = null;
    try { apply(); regs.forEach((r, i) => { const w = this.t4Moved(r, was[i], this.t4(r, only)); if (w && !x) x = {w, reg: r, months: this.moved.slice()}; }); }
    finally { undo(); GSTR._carry = null; }
    return x;
  },
  // only: the months the change can reach (the ISD switch: the months of the ledger's entries), else every filed month
  guardBooks(what, apply, undo, go, only){
    const x = this.tryBooks((GSTR.gstins(S.books) || []).map(g => g.slice(0, 2)), apply, undo, only);
    if (!x) return go();
    this.ask(x.reg, x.months, ["r3b"], what, x.w).then(y => { if (y) go(); else render(); });
  },
  // a 2B (first, or in place of the one there) for a registration and month: {w, reg, months} when it would move the table 4
  // of a month whose 3B is filed (the words name the 2B and the months), else null: then it is left in, with the matching
  // and the ITC lines worked out for it (what the screen draws next; the caller's own putting it in costs nothing more).
  // A month's table 4 reads the 2B only through its ITC lines: the wrap of GSTR.threeBm (app/src/lib/itcFinal.js apply())
  // is the books' own input tax (no 2B in it) plus every line's effect on 4(A)(5) and revEffect on 4(B)(1) in that month,
  // so comparing those sums for the filed months (credits) is comparing table 4, whatever the matching (GST2B.run, any
  // month to any month) moves. The registration's first 2B also switches the wrap on: then table 4 itself is compared
  twoB(t){
    const b = S.books; if (!b || !t || !t.gstin || typeof ITCF !== "object") return null;
    const reg = String(t.gstin).slice(0, 2), k = t.gstin + "|" + t.period, tb = b.twoBs = b.twoBs || {}, had = Object.prototype.hasOwnProperty.call(tb, k), old = tb[k];
    if (!this.any(reg)) return null;
    const put = () => { tb[k] = t; GST2B._memo = null; }, back = () => { if (had) tb[k] = old; else delete tb[k]; GST2B._memo = null; };
    let x = null;
    if (!GST2B.all2b(reg).length) x = this.tryBooks([reg], put, back);
    else {
      const fc = new Map(), fm = m => { if (!fc.has(m)) fc.set(m, !!this.filed(reg, m)); return fc.get(m); };
      const was = this.credits(reg, fm), m0 = GST2B._memo, i0 = ITCF._memo();
      let ok = false;
      try {
        put(); const now = this.credits(reg, fm);
        const ms = Array.from(new Set(Object.keys(was).concat(Object.keys(now)))).sort().filter(m => this.H.some(h => ["", "r"].some(p => Math.abs(((was[m] || {})[p + h] || 0) - ((now[m] || {})[p + h] || 0)) >= 0.005)));
        if (ms.length) x = {w: this.why(reg, ms), reg, months: ms}; else { ok = true; this.kept = t; }
      } finally { if (!ok){ back(); GST2B._memo = m0; ITCF._memo(i0); } }
    }
    if (x) x.w = "The 2B for " + GSTR.label(t.ym) + " would change table 4 of " + x.months.map(m => GSTR.label(m)).join(", ") + ". " + x.w;
    return x;
  }
};
Object.assign(GSTLock, GSTLockMore);
// the filed mark taken off by emptying its date box (GSTMark, src/js/35): asked first when it has more than a date
Object.assign(GSTMark, {
  // the date box emptied: a mark with an ARN (the GST API, the browser helper), the 3B kept as filed or the IFF's documents is asked about first,
  // saying what goes with it; a date alone goes at once. go(): after it is taken off
  ask(ym, reg, k, go){
    const r = GSTF.peek(ym, reg), arn = r[k + "Arn"], kept = k === "r3b" && r.snap, docs = k === "iff" && r.iffDocs && Object.keys(r.iffDocs).length;
    if (!arn && !kept && !docs){ this.clear(ym, reg, k); return go(); }
    const how = r[k + "Via"] === "api" ? " (filed through the GST API)" : r[k + "Via"] === "helper" ? " (read from the portal by the browser helper)" : "";
    const what = [arn ? "its ARN " + arn + how : "", kept ? "the 3B kept as filed (the next month’s carried credit and GSTR-9 then use the books as they are now)" : "", docs ? "the documents recorded as in the IFF" : ""].filter(Boolean);
    askConfirm({title: "Take off the filed mark?", ok: "Take it off", danger: true,
      body: esc(({r3b: "GSTR-3B", r1: "GSTR-1", iff: "IFF"})[k] + " for " + GSTR.label(ym) + " goes back to not filed. With the date go " + what.join(" and ") + ". The return on the portal is not touched.")})
      .then(a => { if (a && a.ok){ this.clear(ym, reg, k); go(); } else render(); });
  }
});
/* @react-lazy: end */
