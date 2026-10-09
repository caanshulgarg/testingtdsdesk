/* ================================================================== */
/* Smart moves (round 1, approved by the owner on 09-Oct-2026): after  */
/* a piece of work ends, the page moves on to what comes next, or says */
/* where to go. Navigation and display only.                           */
/* ================================================================== */
// The rules every move keeps (the owner's):
//   - nothing is approved, posted or sent to Tally by a move; it only changes the page shown;
//   - a move happens only when no box has focus, no dialog is open and no change is left unsaved (Drafts), and only if
//     the page is still the one where the work started; otherwise the same words come as a toast with a button;
//   - each move says so in a toast with "Stay here" (and Undo where there is one), and Back undoes it (a new step in the
//     browser's history);
//   - each kind of move has its own switch under Settings → How the work is done → Move on by itself (on unless turned
//     off), kept in this browser for the person using it.
const Smart = {
  // [kind, what ends, what the page then does]: the switches on the Settings page, in this order
  KINDS: [
    ["upload", "When bills have been read", "Open Review, or the bill when there is only one"],
    ["approve", "After a bill is approved, set aside, or kept as a separate bill", "Open the next bill in the same list"],
    ["post", "When a posting to Tally ends", "Show Posted, or Errors with the failed entries first"],
    ["setup", "After a setup page is saved", "Go back to the page that sent you there"],
    ["resume", "On opening FinCom, and after signing in", "Open the page where you left off for the last client"],
  ],
  key(kind){ return "tdsdesk:move:" + kind; },
  on(kind){ return lsGet(this.key(kind)) !== "0"; },
  set(kind, on){ lsSet(this.key(kind), on ? "1" : "0"); },
  // a box with the cursor in it: a text box, a choice list, an editable area (a button or a tick box is not typing)
  typing(){
    const a = typeof document !== "undefined" ? document.activeElement : null;
    if (!a || a === document.body) return false;
    if (a.isContentEditable) return true;
    if (a.tagName === "TEXTAREA" || a.tagName === "SELECT") return true;
    return a.tagName === "INPUT" && !/^(button|submit|reset|checkbox|radio|file|image|range|color)$/i.test(a.type || "");
  },
  // a dialog on the page: the confirm box, the client switcher, a modal (the bill's drawer counts unless it is where
  // the work was done, o.drawer)
  dialog(o){
    if (typeof document === "undefined") return false;
    const cb = document.getElementById("confirmBox");
    if (cb && cb.childElementCount && !cb.classList.contains("hidden") && getComputedStyle(cb).display !== "none") return true;
    if (S.switcher) return true;
    return Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"], dialog[open]')).some(d => !(o && o.drawer && d.classList.contains("drawer")) && d.getClientRects().length > 0);
  },
  unsaved(){ try { return typeof Drafts === "object" && Drafts.anyDirty(); } catch (e){ return false; } },
  // why the page may not move now ("" when it may)
  held(o){ return this.typing() ? "typing" : this.dialog(o) ? "dialog" : this.unsaved() ? "unsaved" : ""; },
  here(){ try { return typeof Route === "object" ? Route.of() : ""; } catch (e){ return ""; } },
  // Undo for a move that does not change the address (a tab of the Post page): a step in the history with its own mark;
  // Back past the mark puts the page back
  marks: [], n: 0,
  pushMark(undo){
    const id = ++this.n;
    this.marks.push({id, undo});
    try { history.pushState({smart: id}, "", location.href); } catch (e){}
  },
  popTo(state){
    const keep = (state && state.smart) || 0;
    let undone = false;
    while (this.marks.length && this.marks[this.marks.length - 1].id > keep){ const m = this.marks.pop(); try { m.undo(); undone = true; } catch (e){} }
    if (undone) render();
  },
  // the move itself: an address (#/c/<client>/purchase/review), or a function that sets the page (o.undo puts it back
  // when the address stays the same)
  move(where, o){
    if (typeof where === "string"){
      if (where === location.hash){ return; }
      if (typeof history !== "undefined" && typeof Route === "object" && Route.ready){ try { history.pushState(null, "", location.pathname + location.search + where); } catch (e){} }
      return Route.apply(where);
    }
    const before = location.hash;
    where();
    render();
    if (location.hash === before && o && o.undo) this.pushMark(o.undo);
    if (!this.reduced()) { try { window.scrollTo(0, 0); } catch (e){} } else { try { window.scrollTo({top: 0, behavior: "instant"}); } catch (e){} }
  },
  reduced(){ try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e){ return false; } },
  // Smart.go(where, words, o): move to `where` and say `words` with "Stay here" (Back), when the switch o.kind is on, the
  // page is still o.from (the page where the work started; default: this one) and nothing is held; else say o.idle (or
  // the same words) with a button o.label that makes the move when pressed. o.actions: more buttons (Undo).
  // Returns true when the page moved.
  go(where, words, o){
    o = o || {};
    const from = o.from === undefined ? this.here() : o.from;
    const still = !from || from === this.here();
    const why = !this.on(o.kind) ? "off" : !still ? "elsewhere" : this.held(o);
    const extra = (o.actions || []).filter(Boolean);
    if (!why){
      if (o.before) o.before();
      const r = this.move(where, o);
      const stay = {label: o.stayLabel || "Stay here", run: () => { try { history.back(); } catch (e){} }};
      Promise.resolve(r).then(() => toast(words, {actions: extra.concat(o.noStay ? [] : [stay])}));
      this.last = {kind: o.kind, moved: true, words};
      return true;
    }
    const go = {label: o.label || "Open →", run: () => { if (o.before) o.before(); this.move(where, o); }};
    toast(o.idle || words, {actions: [go].concat(extra)});
    this.last = {kind: o.kind, moved: false, why, words: o.idle || words};
    return false;
  },
  // the name of a page, for "Back to <page>" (from its address)
  pageName(h){
    const p = String(h || "").replace(/^#\/?/, "").split("/");
    if (p[0] === "c"){
      const w = p[2] || "dash";
      if (w === "post") return "Post to Tally";
      if (w === "done") return "In Tally";
      if (w === "bill") return "the bill";
      if (w === "purchase") return p[3] === "review" ? "Review" : "Purchase bills";
      if (w === "upload") return "Upload";
      if (w === "books") return {reports: "Reports", lookup: "Look up", letters: "Letters", mis: "MIS", fs: "Accounts", audit: "Audit", tds: "TDS", gst: "GST", import: "From Tally"}[p[3]] || "the books";
      if (w === "setup") return "Client setup";
      return {dash: "Dashboard", inbox: "Inbox", txn: "Transactions", bank: "Bank", sales: "Sales"}[w] || "the client";
    }
    return {clients: "Clients", today: "Today", inbox: "Inbox", tally: "Tally", help: "Help", settings: "Settings"}[p[0]] || "the last page";
  },

  /* ---------------------------------------------------------------- 7. where you left off */
  lastKey(cid){ return "tdsdesk:lastHash:" + cid; },
  // after each drawing (Route.sync): the client's page shown, kept for the next opening
  remember(h){
    const m = /^#\/c\/([^/]+)\//.exec(h || "");
    if (!m || this._kept === h) return;
    this._kept = h;
    let cid = m[1]; try { cid = decodeURIComponent(cid); } catch (e){}
    lsSet(this.lastKey(cid), h);
  },
  lastHash(cid){
    const h = lsGet(this.lastKey(cid)) || "";
    return h.indexOf("#/c/" + encodeURIComponent(cid) + "/") === 0 ? h : "";
  },
  // opening FinCom without an address: the last client's page last shown (its dashboard when the switch is off)
  async resume(cid){
    const h = this.on("resume") ? this.lastHash(cid) : "";
    if (!h){ await openCompany(cid); return false; }
    await openCompany(cid);
    const bill = /\/bill\/([^/]+)$/.exec(h);
    let to = h;
    if (bill){ let id = bill[1]; try { id = decodeURIComponent(id); } catch (e){} if (!D(cid).entries[id]) to = "#/c/" + encodeURIComponent(cid) + "/purchase/draft"; }
    return Route.apply(to);
  },
  // after signing in on the sign-in page: back to the last client's page, with "Back where you left off · Clients"
  afterSignIn(from){
    const cid = lsGet("tdsdesk:last") || "";
    if (!cid || !S.companies[cid] || S.view === "company") return false;
    const h = this.lastHash(cid) || "#/c/" + encodeURIComponent(cid) + "/dash";
    return this.go(h, "Back where you left off", {kind: "resume", from, label: "Open " + (S.companies[cid].name || "the client") + " →", idle: "Signed in. Your last client was " + (S.companies[cid].name || "") + ".",
      noStay: true, actions: [{label: "Clients", run: () => navHome("clients")}]});
  },

  /* ---------------------------------------------------------------- 9. back to where the setup was asked for */
  // a jump into a setup page (Client setup, the Tally page, Books in the cloud) from another page: that page is kept
  setReturn(){
    const h = this.here();
    if (!h || /\/setup\/|^#\/settings|^#\/tally/.test(h)) return;
    S.returnTo = {hash: h, label: this.pageName(h), cid: S.coId || ""};
  },
  // the page now is a setup page with a page to go back to
  returnHere(){
    const r = S.returnTo, h = this.here();
    return r && r.hash !== h && (/\/setup\/|^#\/settings|^#\/tally/.test(h)) ? r : null;
  },
  goBack(){ const r = S.returnTo; S.returnTo = null; if (r) this.move(r.hash); },
  // after Save on a setup page: "Saved · Back to <page> →", moving back by itself when the switch is on
  afterSave(){
    const r = this.returnHere(); if (!r) return false;
    // moved: the way back is used up; not moved: it stays for "← Back to …" and the toast's button
    const moved = this.go(r.hash, "Saved. Back to " + r.label, {kind: "setup", label: "Back to " + r.label + " →", idle: "Saved", before: () => { S.returnTo = null; }});
    return moved;
  },
  // after each drawing: a person who went somewhere else on their own no longer needs the way back
  dropReturn(h){ const r = S.returnTo; if (r && h !== r.hash && !/\/setup\/|^#\/settings|^#\/tally/.test(h)) S.returnTo = null; },

  /* ---------------------------------------------------------------- 10. getting ready: the next step */
  ONB_DONE: {tally: "Tally name saved", bridge: "FinCom Bridge connected", link: "Linked", books: "The books are read", opening: "Opening balances read", gst: "GSTIN added", bank: "Bank account added", bills: "First bills uploaded"},
  // a step that was not done when last looked at, and is now: "Linked · Next: Read the books →" (looked at once in two
  // seconds, after a drawing, for the open client)
  onbWatch(){
    const co = S.view === "company" && typeof CO === "function" ? CO() : null;
    if (!co || co.onbHide || typeof ONB !== "object") return;
    const t = Date.now(); if (this._onbAt && t - this._onbAt < 2000) return;
    // another message on screen (a move just said): this one waits for a later drawing
    const tw = document.getElementById("toast"); if (tw && !tw.classList.contains("hidden") && !tw.classList.contains("out")) return;
    this._onbAt = t;
    let st; try { st = ONB.steps(co); } catch (e){ return; }
    const seen = (this._onb = this._onb || {})[co.id], now = {};
    st.forEach(s => { now[s.id] = !!s.done; });
    this._onb[co.id] = now;
    if (!seen) return;
    const fresh = st.find(s => s.done && seen[s.id] === false);
    if (!fresh) return;
    const next = st.find(s => !s.done);
    const words = this.ONB_DONE[fresh.id] || "Done";
    if (!next){ toast(words + ". " + co.name + " is ready."); return; }
    toast(words, {actions: [{label: "Next: " + next.t + " →", run: () => onbStepGo(next)}]});
  },

  /* ---------------------------------------------------------------- 11. the period a page opens on */
  // remembered per page and client (only for the person in this browser)
  pkey(page, cid){ return "tdsdesk:period:" + page + ":" + (cid || S.coId || ""); },
  recall(page, cid){ try { return JSON.parse(lsGet(this.pkey(page, cid)) || "null"); } catch (e){ return null; } },
  keep(page, v, cid){ try { lsSet(this.pkey(page, cid), JSON.stringify(v)); } catch (e){} },
  today(){ return typeof istToday === "function" ? istToday() : Audit.today(); },
  fyStartOf(d){ const y = num(String(d).slice(0, 4)), m = num(String(d).slice(4, 6)); return (m >= 4 ? y : y - 1) + "0401"; },
  fyLabelOf(d){ const y = num(this.fyStartOf(d).slice(0, 4)); return y + "-" + String(y + 1).slice(2); },
  // TDS: the quarter whose return is due now: the last quarter that has ended (on 09-Oct-2026, Q2 of 2026-27, due
  // 31-Oct). Its tax year is the quarter's own, so in April and May it is Q4 of the year before (still the old forms
  // for 2025-26; Form 138/140/144/143 from 2026-27, TDS.formName)
  tdsDue(today){
    const t = today || this.today(), y = num(t.slice(0, 4)), m = num(t.slice(4, 6));
    // the quarter today falls in: Q1 Apr-Jun ... Q4 Jan-Mar; the one before it has ended
    const qNow = m >= 4 && m <= 6 ? 1 : m >= 7 && m <= 9 ? 2 : m >= 10 && m <= 12 ? 3 : 4;
    const fyNow = m >= 4 ? y : y - 1;
    const q = qNow === 1 ? 4 : qNow - 1, fy = qNow === 1 ? fyNow - 1 : fyNow;
    const due = {1: fy + "0731", 2: fy + "1031", 3: (fy + 1) + "0131", 4: (fy + 1) + "0531"}[q];
    return {fy: fy + "-" + String(fy + 1).slice(2), q: "Q" + q, due};
  },
  // GST: the return due now. Monthly: last month (3B by the 20th). QRMP: the last quarter that has ended (its GSTR-1
  // by the 13th and 3B by the 22nd/24th after it). With filing marks kept for that year, the oldest month (quarter) up
  // to then that is not marked filed.
  gstDue(reg, today){
    const t = today || this.today(), y = num(t.slice(0, 4)), m = num(t.slice(4, 6));
    let ym = m === 1 ? (y - 1) + "12" : y + String(m - 1).padStart(2, "0");
    const qrmp = typeof GSTSet === "object" && GSTSet.typeOf(ym, reg) === "qrmp";
    if (qrmp){ while (!GSTSet.isQEnd(ym)) ym = this.prevYm(ym); }
    const first = this.fyStartOf(ym + "01").slice(0, 6);
    if (typeof GSTV === "object" && GSTV.filedOn){
      const list = []; for (let x = first; x <= ym; x = this.nextYm(x)) if (!qrmp || GSTSet.isQEnd(x)) list.push(x);
      const filed = (x) => { try { return !!GSTV.filedOn(reg, "r3b", x); } catch (e){ return false; } };
      if (list.some(filed)){ const open = list.find(x => !filed(x)); if (open) ym = open; }
    }
    return ym;
  },
  nextYm(ym){ const y = num(ym.slice(0, 4)), m = num(ym.slice(4, 6)); return m === 12 ? (y + 1) + "01" : y + String(m + 1).padStart(2, "0"); },
  prevYm(ym){ const y = num(ym.slice(0, 4)), m = num(ym.slice(4, 6)); return m === 1 ? (y - 1) + "12" : y + String(m - 1).padStart(2, "0"); },
  // the books in FinCom end before the date asked for: their last day ("" when they reach it, or there are none)
  booksEndBefore(d){
    const to = String(((S.books || {}).meta || {}).to || "");
    return to && d && to < d ? to : "";
  },
};
// a step of the Getting ready card, pressed (or its toast's Next): where it goes
function onbStepGo(s){
  if (!s || !s.btn) return;
  const b = s.btn[1] || {};
  if (b.focus) S.upFocus = b.focus;
  // a setup page reached from here leads back here once saved (9)
  if (b.act) Smart.setReturn();
  if (b.act) doAct(b.act); else goClient(b.go);
}
if (typeof window !== "undefined") window.addEventListener("popstate", ev => Smart.popTo(ev.state));
