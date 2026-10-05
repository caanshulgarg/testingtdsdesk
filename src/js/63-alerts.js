/* ================================================================== */
/* Alerts: every warning of the app in one place (the owner's round 3 */
/* of the UI pass, 05-Oct-2026)                                        */
/* ================================================================== */
// The fault of 05-Oct: the same warning three times on every page ("Tally changes are not being recorded on NWS144";
// "Changes not received: … Mark read"; "up to 1 changes not received … (Tally's change number 54396 …) Upload the Day
// Book for these days"). Now:
//  - one place: the bell in the top bar, with a count (app/src/parts/Bell.jsx); no alert text on the pages, except ONE
//    slim line on the Tally page and on that client's Books page (AlertLine);
//  - one alert per problem: for a book, the cursor's gap (tally_sync_cursor.gap), the tally_alerts gap rows (one a day),
//    the lines Tally sent that wait (tally_recorder_lines held / received) and the computer not recording are ONE problem;
//    for a computer, Tally not answering, FinCom having stopped reading by itself and "silent today" are ONE problem;
//  - plain words: what, then what to do; the change numbers, the computers and the ids only behind "details";
//  - the advice follows the cause: lines held by FinCom's own fault (no entry body, the add-on's placeholder GUID, the
//    queue) say FinCom is fetching the entry's details, nothing to do; a real gap says to upload the Day Book;
//  - it clears itself: worked out again from what is true now, so an alert goes when its cause goes (the gap null, the
//    lines applied, the recorder recording); Mark read only for what cannot clear itself (the daily summary);
//  - severity: "bad" red (the books may be wrong and something is to be done), "warn" amber (attention), "info" grey
//    (information: in the bell only).
// The recorder's data (Rec, src/js/61-recorder.js) is read, never changed here.
const AlertHub = {
  held: {rows: null, at: 0, busy: false, none: false},   // tally_recorder_lines still waiting (held, received, queued, failed)
  reset(){ this.held = {rows: null, at: 0, busy: false, none: false}; },
  // read again what the alerts come from (force: now; else at most once a minute, the recorder's own pace)
  refresh(force){
    if (typeof Rec !== "object" || typeof TCloud !== "object" || !TCloud.on()) return;
    if (force){ if (Rec.gaps) Rec.gaps.at = 0; if (Rec.alerts) Rec.alerts.at = 0; this.held.at = 0; }
    Rec.gapsOf(); Rec.alertsOf(); this.heldOf();
    if (force) setTimeout(() => { if (typeof render === "function") render(); }, 400);
  },
  heldOf(){
    const h = this.held;
    if (typeof TCloud === "object" && TCloud.on() && !h.busy && !h.none && Date.now() - (h.at || 0) > 60000){ h.at = Date.now(); setTimeout(() => this.heldLoad(), 0); }
    return [].concat(h.rows || []);
  },
  async heldLoad(){
    const h = this.held;
    h.busy = true;
    try {
      const firm = typeof Rec === "object" && Rec.firm ? Rec.firm() : "";
      h.rows = [].concat(await Cloud.api("tally_recorder_lines?select=id,client_id,book_id,device_id,pc,company,event,object_guid,alter_id,state,held_why,received_at,vch_type,vch_no,vch_date" +
        "&firm_id=eq." + encodeURIComponent(firm) + "&state=in.(held,received,queued,failed)&order=received_at.desc&limit=200") || []);
      h.none = false;
    } catch (e){ h.rows = []; if (typeof Rec === "object" && Rec.missing && Rec.missing(e)) h.none = true; }
    h.busy = false; h.at = Date.now(); if (typeof render === "function") render();
  },
  // a line waiting because of FinCom's side: no body, the add-on's placeholder GUID ("<company GUID>-00000000"), no GUID,
  // FinCom's own posting coming back, or the queue; then FinCom fetches the details itself and nothing is to be done
  oursHeld(l){
    const why = String(l.held_why || "");
    if (/^month locked/i.test(why)) return false;
    return l.state === "queued" || l.state === "received" || l.state === "failed" && /queue|timeout|server/i.test(why) ||
      /no entry body|waiting for the entry's details|no GUID|placeholder|FinCom (posting|id) /i.test(why) || /-0{8}$/.test(String(l.object_guid || ""));
  },
  // "1 entry", "3 entries"
  n(k){ return k + (k === 1 ? " entry" : " entries"); },
  // a time and day in India, as said in a sentence: "08:00 IST today", "04-Oct-2026 18:30 IST"
  when(t){
    const ms = typeof t === "number" ? t : Date.parse(String(t || ""));
    if (!ms) return "";
    return istDay(ms) === istDay(Date.now()) ? fmtTime(ms) + " today" : fmtDateTime(ms);
  },
  // the Day Book's days, from the gap's start to today: "05-Oct", "04-Oct to 05-Oct"
  days(t){
    const a = istDay(t || Date.now()), b = istDay(Date.now()), dm = d => { const p = d.split("-"); return p[2] + "-" + MONTHS3[+p[1] - 1]; };
    return !a || a === b ? dm(b) : dm(a) + " to " + dm(b);
  },
  pc(id, fallback){
    const d = typeof Rec === "object" && Rec.devOf ? Rec.devOf(id) : null;
    return d && typeof tallyPcLabel === "function" ? tallyPcLabel(d) : fallback || "the Tally computer";
  },
  // every alert now: [{key, sev, cid, text, fix, act: {label, run}, details, at, alert (a tally_alerts row: Mark read)}]
  list(){
    // the cloud's alerts need a firm signed in: without one nothing is asked of the cloud (no rpc with an empty firm)
    const out = [], cloud = typeof TCloud === "object" && TCloud.on() && typeof Rec === "object" && !!(Rec.firm && Rec.firm());
    const coName = cid => ((S.companies || {})[cid] || {}).name || "";
    if (cloud){
      const g = Rec.gapsOf(), gapsKnown = !!g.byClient || !!g.no44, rows = Rec.alertsOf(), held = this.heldOf();
      // the tally_alerts rows: the latest one for each (kind, client, book, computer), unread only (no stacking of days)
      const latest = new Map();
      rows.forEach(x => { const k = [x.kind, x.client_id || "", x.book_id || "", x.device_id || ""].join("|"); const h = latest.get(k); if (!h || String(x.at || "") > String(h.at || "")) latest.set(k, x); });
      const unread = [...latest.values()].filter(x => !x.read_at);
      // ---- one problem a book: the cursor's gap, the lines waiting, the computer not recording, the gap alert rows
      const books = new Map();
      const book = (cid, company, bookId) => { const k = cid + "|" + (bookId || norm(company || "")); if (!books.has(k)) books.set(k, {cid, company: company || "", bookId, gap: null, ours: [], other: [], off: [], rows: []}); return books.get(k); };
      Object.entries(g.byClient || {}).forEach(([cid, list]) => list.forEach(x => { book(cid, x.company, x.book).gap = x.gap; }));
      held.filter(l => l.client_id).forEach(l => { const b = book(l.client_id, l.company, l.book_id); (this.oursHeld(l) ? b.ours : b.other).push(l); });
      // the computers keeping a client's company open in Tally without recording its changes (as Rec.clientNotRecording,
      // with the computer's id for its name)
      const tl = (typeof TLight === "object" && TLight.st) || {};
      (tl.cos || []).filter(c => c.client_id && c.device_id && (S.companies || {})[c.client_id]).forEach(c => {
        const d = (tl.devs || []).find(x => x.id === c.device_id && !x.revoked);
        if (!d || !Rec.notRecording(d).includes(c.company)) return;
        const b = [...books.values()].find(y => y.cid === c.client_id && (!y.company || norm(y.company) === norm(c.company))) || book(c.client_id, c.company, null);
        b.off.push({deviceId: d.id, pc: Rec.pcOf(d), company: c.company});
      });
      // a gap alert row speaks for its book only while the cause cannot be read from FinCom's cloud; else the book's
      // own state decides (and the row goes when the gap goes)
      unread.filter(x => x.kind === "gap" && x.client_id).forEach(x => {
        const b = [...books.values()].find(y => y.cid === x.client_id && (!x.book_id || !y.bookId || y.bookId === x.book_id));
        if (b) b.rows.push(x); else if (!gapsKnown) book(x.client_id, "", x.book_id).rows.push(x);
      });
      books.forEach((b, k) => {
        const who = coName(b.cid) || b.company || "A client";
        const gapN = b.gap ? Number(b.gap.missingMax || b.gap.missing || 0) : 0;
        const since = (b.gap && (b.gap.since || b.gap.last_match_at)) || (b.ours[0] && b.ours[b.ours.length - 1].received_at) || "";
        const pcs = [...new Set(b.off.map(x => this.pc(x.deviceId, x.pc)).concat(b.ours.concat(b.other).map(l => this.pc(l.device_id, l.pc))))];
        const det = [];
        if (b.gap){
          const base = [b.gap.start_point, b.gap.recorder_max, b.gap.day_max].map(x => x == null || x === "" ? NaN : Number(x)).filter(x => !Number.isNaN(x));
          det.push("Tally's change number " + (b.gap.tally_altvchid != null ? b.gap.tally_altvchid : "?") + ", received up to " + (base.length ? Math.max(...base) : "?") + (b.gap.words ? " (" + b.gap.words + ")" : ""));
        }
        b.ours.concat(b.other).slice(0, 5).forEach(l => det.push("Line " + (l.line_id || l.id) + ": " + [l.vch_type, l.vch_no].filter(Boolean).join(" ") + (l.held_why ? " — " + l.held_why : " — " + l.state)));
        if (pcs.length) det.push("Computer" + (pcs.length > 1 ? "s" : "") + ": " + pcs.join(", "));
        if (b.off.length) det.push("Not recording its changes for FinCom: " + b.off.map(x => x.company).join(", "));
        if (b.bookId) det.push("Book " + b.bookId);
        const at = [].concat(b.rows.map(x => x.at), b.gap ? [b.gap.at || ""] : [], b.ours.concat(b.other).map(l => l.received_at)).filter(Boolean).sort().pop() || "";
        const recFix = "Turn on FinCom's recorder in Tally on that computer (the details say which).";
        const base = {key: "book:" + k, cid: b.cid, details: det.join(" · "), at, selfClear: true};
        const waiting = b.ours.length + b.other.length;
        if (b.ours.length && (!gapN || b.ours.length >= gapN)){
          // FinCom's own side: the details are on their way, nothing to do
          const k2 = Math.max(gapN, b.ours.length);
          out.push(Object.assign(base, {sev: "warn", text: who + ": " + this.n(k2) + " made in Tally" + (since ? " since " + this.when(since) : "") + (k2 === 1 ? " is" : " are") + " not yet in FinCom.",
            fix: "FinCom is fetching the entry's details from Tally; nothing to do."}));
        } else if (gapN || (b.rows.length && !b.gap && !waiting)){
          // a real gap: entries made in Tally that never reached FinCom; the Day Book of those days brings them in
          const gap = b.gap || {since: b.rows[0] && b.rows[0].at};
          const words = gapN ? this.n(gapN) : "Entries";
          out.push(Object.assign(base, {sev: "bad", text: who + ": " + words + " made in Tally" + (gap.since ? " since " + this.when(gap.since) : "") + (gapN === 1 ? " is" : " are") + " not yet in FinCom.",
            fix: "Upload the Day Book for " + this.days(gap.since) + " to bring " + (gapN === 1 ? "it" : "them") + " in." + (b.off.length ? " " + recFix : ""),
            act: {label: "Upload Day Book", run: () => Rec.uploadDays(b.cid, gap)}}));
        } else if (b.other.length){
          const locked = b.other.filter(l => /^month locked/i.test(String(l.held_why || "")));
          out.push(Object.assign(base, {sev: "warn", text: who + ": " + (b.other.length === 1 ? "1 change" : b.other.length + " changes") + " from Tally " + (b.other.length === 1 ? "is" : "are") + " waiting, not yet in the books" + (locked.length === b.other.length ? " (the month is locked)." : "."),
            fix: locked.length === b.other.length ? "Apply them on Sync activity, or unlock the month." : "See why on Sync activity.", act: {label: "Sync activity", run: () => Rec.openActivity(b.cid)}}));
        } else if (b.off.length){
          out.push(Object.assign(base, {sev: "warn", text: who + ": Tally is not recording its changes for FinCom, so entries made there reach FinCom only with the next Day Book.",
            fix: recFix}));
        }
      });
      // ---- one problem a computer: not answering, stopped by itself, silent today
      const devs = ((typeof TLight === "object" && TLight.st.devs) || []).filter(d => d && !d.revoked);
      const silent = Rec.silentOf();
      devs.forEach(d => {
        const beat = ((d.info || {}).beat) || {}, label = typeof tallyPcLabel === "function" ? tallyPcLabel(d) : d.name, ds = devState(d);
        const stop = beat.readStopped && beat.readStopped.by === "self" ? beat.readStopped : null;
        const quiet = silent.find(x => x.device === d.id);
        const rowsD = unread.filter(x => x.device_id === d.id && x.kind === "silent");
        if (ds.bridge === "offline") return;   // the Tally sign says it (and the bell does not repeat it)
        const base = {key: "pc:" + d.id, details: [label, stop && stop.reason, beat.notAnsweringSince && "not answering since " + fmtDateTime(beat.notAnsweringSince)].filter(Boolean).join(" · "), selfClear: true, at: beat.at || ""};
        if (stop) out.push(Object.assign(base, {sev: "warn", text: "FinCom stopped reading Tally by itself: " + (stop.reason || "Tally did not answer") + ".", fix: "It starts again by itself when Tally answers; nothing to do."}));
        else if (beat.notAnsweringSince) out.push(Object.assign(base, {sev: "warn", text: "Tally is not answering on one computer since " + this.when(beat.notAnsweringSince) + ".", fix: "Close any open window or report in Tally on that computer (the details say which)."}));
        else if (quiet || rowsD.length) out.push(Object.assign(base, {sev: "info", text: "No change recorded today on one computer, though Tally was open there.", fix: "Nothing to do if nobody worked in Tally there today."}));
      });
      // ---- what cannot clear itself: the daily summary, until read
      unread.filter(x => x.kind === "summary").forEach(x => out.push({key: "alert:" + x.id, sev: "info", cid: x.client_id || "", text: x.words || "The day's summary.", fix: "", details: x.at ? "At " + fmtDateTime(x.at) : "", at: x.at, selfClear: false, alert: x}));
    }
    // ---- the app's own warnings
    const a = S.account, bal = a && a.firm ? num(a.firm.balance) : 0, warnAt = a && a.firm ? num(a.firm.warn_at) : 0;
    if (a && a.firm){
      if (S.creditStop && Date.now() - S.creditStop.at < 6 * 3600e3 && bal <= 0) out.push({key: "app:credit", sev: "bad", text: "Credit finished: reading new bills, bank statements and invoices is paused.", fix: "Ask the administrator to add credit. Everything already in FinCom still works.", selfClear: true});
      else if (bal <= warnAt) out.push({key: "app:credit", sev: "warn", text: "Credit left: " + money(bal) + ".", fix: "Ask the administrator to top it up before it runs out.", selfClear: true});
    }
    if (!(S.storeKind === "db" || (typeof Cloud === "object" && Cloud.on() && Cloud.st && !Cloud.st.error))){
      const kept = S.storeKind === "local" || S.storeKind === "idb";
      out.push({key: "app:store", sev: kept ? "info" : "bad", text: kept ? "Your work is saved in this browser only." : "Your work is not being saved.",
        fix: kept ? "Clearing browser data would remove it. Sign in from Settings to keep it in the firm account." : "It will be lost when this page closes. Sign in from Settings to keep it.", selfClear: true});
    }
    const st = typeof selfTestSummary === "function" ? selfTestSummary() : {state: "none"};
    if (st.state === "fail") out.push({key: "app:selftest", sev: "warn", text: "Bill reading has a problem on this computer.", fix: "See the self-test in Settings.",
      details: st.fails.map(k => (k === "pdf" ? "PDF reading: " : "Photo OCR: ") + st.r[k].msg).join(" "), act: {label: "Self-test", run: () => doAct("goSelfTest")}, selfClear: true});
    const rank = {bad: 0, warn: 1, info: 2};
    return out.sort((x, y) => rank[x.sev] - rank[y.sev] || String(y.at || "").localeCompare(String(x.at || "")));
  },
  // the client's own alerts first (its Books page), then the rest
  forClient(cid){ return this.list().filter(x => x.cid === cid && x.sev !== "info"); },
  async read(x){ if (x && x.alert && typeof Rec === "object") await Rec.alertRead(x.alert); }
};
// "This will post through Office computer (NWS144)." before Post (the bank's and sales' bars, and the posting preview):
// the computer the posting goes through, the same as the Tally sign says; "" when none is connected
function postThroughWords(co){
  const s = typeof tallySign === "function" ? tallySign(co) : null;
  if (!s || !s.on) return "";
  if (s.local) return "This will post through this computer.";
  return "This will post through " + (s.through && s.through.length === 1 ? s.through[0] : s.computer) + ".";
}
