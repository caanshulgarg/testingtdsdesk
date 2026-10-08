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
//    for a computer, Tally not answering, a request not answered in time (tried again by itself) and "silent today" are ONE problem;
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
      h.rows = [].concat(await Cloud.api("tally_recorder_lines?select=id,client_id,book_id,device_id,pc,company,event,object_guid,alter_id,state,held_why,received_at,vch_type,vch_no,vch_date,ledgers" +
        "&firm_id=eq." + encodeURIComponent(firm) + "&state=in.(held,received,queued,failed)&order=received_at.desc&limit=200") || []);
      h.none = false;
    } catch (e){ h.rows = []; if (typeof Rec === "object" && Rec.missing && Rec.missing(e)) h.none = true; }
    h.busy = false; h.at = Date.now(); if (typeof render === "function") render();
  },
  // the lines still waiting, as known now: the bell's own read, each brought up to date by Sync activity's lines (read
  // later, or come in live), so a line applied there is not counted as waiting here
  waitingRows(){
    const rows = this.heldOf(), act = typeof Rec === "object" && Rec.act && Array.isArray(Rec.act.rows) ? Rec.act.rows : [];
    const by = new Map(act.map(r => [String(r.id), r]));
    const out = rows.map(r => by.get(String(r.id)) || r);
    const seen = new Set(out.map(r => String(r.id)));
    act.forEach(r => { if (!seen.has(String(r.id)) && ["held", "received", "queued", "failed"].includes(r.state)) out.push(r); });
    return out.filter(r => ["held", "received", "queued", "failed"].includes(r.state));
  },
  // the owner's finding of 05-Oct-2026: a book with a line HELD is never "in sync". The held lines of these clients
  // (none given: every client's)
  heldFor(cids){
    const want = cids ? new Set([].concat(cids).map(String)) : null;
    return this.waitingRows().filter(r => r.state === "held" && r.client_id && (!want || want.has(String(r.client_id))));
  },
  // the held lines in the owner's words: "received, not yet entered in the books: <held_why>" for one line (or lines
  // with one reason), "N received, not yet entered in the books" for more
  heldSay(lines, count){
    const n = lines.length, whys = [...new Set(lines.map(l => String(l.held_why || "").trim()).filter(Boolean))];
    return (count || n > 1 ? n + " " : "") + "received, not yet entered in the books" + (whys.length === 1 ? ": " + whys[0] : "");
  },
  // the owner's finding of 05-Oct-2026 (Look up said "From the books (…), in step with Tally as of 05-Oct-2026 13:59 IST"
  // with a line of that company held): every view of a client's books (Look up, the trial balance, the day book, P&L,
  // balance sheet, and their print and Excel) says instead "N entries received from Tally are not yet in these books:
  // <reason>" (the reason when the lines share one, else "see Sync activity"). null when no line of the client is held
  booksHeld(cid){
    if (!cid) return null;
    const lines = this.heldFor([cid]);
    if (!lines.length) return null;
    const n = lines.length, why = this.oneWhy(lines);
    return {n, lines, why, text: this.n(n) + " received from Tally " + (n === 1 ? "is" : "are") + " not yet in these books: " + (why || "see Sync activity")};
  },
  oneWhy(lines){ const w = [...new Set(lines.map(l => String(l.held_why || "").trim()))]; return w.length === 1 ? w[0] : ""; },
  // the ledgers a line touches (tally_recorder_lines.ledgers: [{name, guid}]); none when the line came without its entry
  ledgersOf(l){ return [].concat((l && l.ledgers) || []).map(x => typeof x === "string" ? x : (x && (x.name || x.to || x.from)) || "").map(x => String(x).trim()).filter(Boolean); },
  // the entry's date (yyyymmdd): its voucher date, else the day it reached FinCom
  heldDay(l){ const d = String(l.vch_date || "").replace(/-/g, "").slice(0, 8); return /^\d{8}$/.test(d) ? d : String(istDay(l.received_at) || "").replace(/-/g, ""); },
  // a ledger's view (Look up's ledger account, its print and Excel): the held lines that name this ledger, and those whose
  // ledgers are not known (no entry body), which may touch any ledger. Only entries dated up to the view's last day
  ledgerHeld(cid, led, to){
    const h = this.booksHeld(cid);
    if (!h || !led) return [];
    const key = x => ledNm(x).trim().toLowerCase(), k = key(led), upto = l => !to || !this.heldDay(l) || this.heldDay(l) <= String(to);
    const mine = h.lines.filter(l => upto(l) && this.ledgersOf(l).some(x => key(x) === k)), unknown = h.lines.filter(l => upto(l) && !this.ledgersOf(l).length);
    const ent = ls => { const ds = [...new Set(ls.map(l => this.heldDay(l)).filter(Boolean))].sort().map(d => fmtDate(tallyDate(d)));
      return this.n(ls.length) + (ds.length ? " of " + ds.join(", ") : ""); };
    const out = [];
    if (mine.length) out.push({kind: "known", text: ent(mine) + " for this ledger " + (mine.length === 1 ? "is" : "are") + " waiting: " + (this.oneWhy(mine) || "see Sync activity")});
    if (unknown.length) out.push({kind: "unknown", text: ent(unknown) + " waiting; the ledger is not yet known, so this balance may be incomplete."});
    return out;
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
  // the line's part of a fingerprint (the table at AlertClear, below): the line, and whether a person must act on it
  // ("need": Sync activity's "Needs you", Rec.needKind) or not ("wait": FinCom or the bridge is still at it). The same
  // words in the bell, the books' banner and Sync activity, so a line cleared in one place is cleared in all
  lineAtom(l){ return "line:" + l.id + ":" + (typeof Rec === "object" && Rec.needKind && Rec.needKind(l) ? "need" : "wait"); },
  // every alert not cleared by this person (AlertClear, below): what the bell, its count and the pages' lines show
  list(){ const all = this.all(); return typeof AlertClear === "object" ? all.filter(x => !AlertClear.cleared(x)) : all; },
  // every alert now, cleared or not: [{key, fp, sev, cid, text, fix, act: {label, run}, details, at, alert (a tally_alerts row: Mark read)}]
  // fp: its fingerprint, what it says that makes it this notification (the table at AlertClear, below)
  all(){
    // the cloud's alerts need a firm signed in: without one nothing is asked of the cloud (no rpc with an empty firm)
    const out = [], cloud = typeof TCloud === "object" && TCloud.on() && typeof Rec === "object" && !!(Rec.firm && Rec.firm());
    const coName = cid => ((S.companies || {})[cid] || {}).name || "";
    if (cloud){
      const g = Rec.gapsOf(), gapsKnown = !!g.byClient || !!g.no44, rows = Rec.alertsOf(), held = this.waitingRows();
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
        // the fingerprint: the gap by the day it started (never its count, which ticks), each line waiting, each computer not recording
        const gapFrom = b.gap ? (b.gap.since || b.gap.last_match_at || b.gap.at) : b.rows.length ? b.rows[0].at : "";
        // (the book by FinCom's cloud id, the same on every computer; the client and company when it has none)
        const fp = AlertClear.fp([b.gap || b.rows.length ? "gap:" + (b.bookId || k) + ":" + (istDay(gapFrom) || "?") : ""]
          .concat(b.ours.concat(b.other).map(l => this.lineAtom(l)), b.off.map(x => "off:" + x.deviceId + ":" + norm(x.company))));
        const base = {key: "book:" + k, fp, cid: b.cid, details: det.join(" · "), at, selfClear: true};
        const waiting = b.ours.length + b.other.length;
        // 2.3.5: lines a person must settle (b.other) are said first; "nothing to do" only when nothing else waits
        if (b.ours.length && !b.other.length && (!gapN || b.ours.length >= gapN)){
          // FinCom's own side: the details are on their way, nothing to do. FinCom 2.3.5 (the owner: "a yellow field coming
          // all the time"): information, said quietly (the bell lists it; no yellow line on the pages): yellow is for "Needs you"
          const k2 = Math.max(gapN, b.ours.length), hd = b.ours.filter(l => l.state === "held");
          out.push(Object.assign(base, {sev: "info", text: hd.length === b.ours.length && k2 === hd.length ? who + ": " + this.heldSay(hd, true) + "."
            : who + ": " + this.n(k2) + " made in Tally" + (since ? " since " + this.when(since) : "") + (k2 === 1 ? " is" : " are") + " not yet in FinCom.",
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
          const hd = b.other.filter(l => l.state === "held");
          out.push(Object.assign(base, {sev: "warn", text: who + ": " + (hd.length === b.other.length ? this.heldSay(hd, true) + "."
              : (b.other.length === 1 ? "1 change" : b.other.length + " changes") + " from Tally " + (b.other.length === 1 ? "is" : "are") + " waiting, not yet in the books" + (locked.length === b.other.length ? " (the month is locked)." : ".")),
            // FinCom 2.3.5: lines the bridge gave up on say the one thing to do (Sync activity's "Needs you" has each day's button)
            fix: locked.length === b.other.length ? "Apply them on Sync activity, or unlock the month." : b.other.every(l => typeof Rec === "object" && Rec.needKind && Rec.needKind(l) === "daybook")
              ? "Needs you: upload the Day Book for " + [...new Set(b.other.map(l => this.heldDay(l)).filter(Boolean))].sort().map(d => fmtDate(tallyDate(d))).join(", ") + " (Sync activity has each day's button)."
              : hd.length === b.other.length ? "See them on Sync activity." : "See why on Sync activity.", act: {label: "Sync activity", run: () => Rec.openActivity(b.cid)}}));
        } else if (b.off.length){
          out.push(Object.assign(base, {sev: "warn", text: who + ": Tally is not recording its changes for FinCom, so entries made there reach FinCom only with the next Day Book.",
            fix: recFix}));
        }
      });
      // ---- one problem a computer: not answering, tried again by itself, silent today
      const devs = ((typeof TLight === "object" && TLight.st.devs) || []).filter(d => d && !d.revoked);
      const silent = Rec.silentOf();
      devs.forEach(d => {
        const beat = ((d.info || {}).beat) || {}, label = typeof tallyPcLabel === "function" ? tallyPcLabel(d) : d.name, ds = devState(d);
        // bridge 2.3.1: a request not answered in time, tried again by itself (never a stop); a bridge before 2.3.1 that
        // stopped by itself is said the same way (2.3.1 clears that stop when it starts)
        const old = beat.readStopped && beat.readStopped.by === "self" ? beat.readStopped : null;
        const retry = beat.tallyRetry && beat.tallyRetry.words ? beat.tallyRetry : null;
        const quiet = silent.find(x => x.device === d.id);
        const rowsD = unread.filter(x => x.device_id === d.id && x.kind === "silent");
        if (ds.bridge === "offline") return;   // the Tally sign says it (and the bell does not repeat it)
        // review H1 (bridge 2.3.1): the own Tally lists its companies too slowly (the bridge stops at 2 s): this computer's
        // changes wait, in the bridge's own plain words; gone by itself when the list answers in time again
        if (beat.recorderWaitWords) out.push({key: "ownwait:" + d.id, fp: AlertClear.fp(["ownwait:" + d.id + ":" + istDay(Date.now())]), sev: "warn", cid: "", selfClear: true, at: beat.at || "", details: label,
          text: String(beat.recorderWaitWords).replace(/\.?$/, "."), fix: "Nothing is lost: they go by themselves once Tally answers in time. Close any open window or report in Tally on that computer, or press Update now there."});
        const pcFp = kind => AlertClear.fp(["pc:" + d.id + ":" + kind]);
        const base = {key: "pc:" + d.id, details: [label, old && old.reason, beat.notAnsweringSince && "not answering since " + fmtDateTime(beat.notAnsweringSince)].filter(Boolean).join(" · "), selfClear: true, at: beat.at || ""};
        if (retry) out.push(Object.assign(base, {fp: pcFp("retry:" + istDay(retry.since || retry.at || Date.now())), sev: "warn", text: String(retry.words).replace(/\.?$/, ".") + " (one computer)", fix: "Nothing to do: it tries again by itself; postings go on."}));
        else if (old) out.push(Object.assign(base, {fp: pcFp("stopped:" + (old.at || "")), sev: "warn", text: "Tally did not answer in time" + (old.at ? " at " + fmtTime(old.at) : "") + " on one computer; reading starts again by itself once FinCom Bridge 2.3.1 is on it.", fix: "Update the bridge on that computer (it updates by itself within a few hours)."}));
        else if (beat.notAnsweringSince) out.push(Object.assign(base, {fp: pcFp("notanswering:" + beat.notAnsweringSince), sev: "warn", text: "Tally is not answering on one computer since " + this.when(beat.notAnsweringSince) + ".", fix: "Close any open window or report in Tally on that computer (the details say which)."}));
        else if (quiet || rowsD.length) out.push(Object.assign(base, {fp: pcFp("silent:" + istDay(Date.now())), sev: "info", text: "No change recorded today on one computer, though Tally was open there.", fix: "Nothing to do if nobody worked in Tally there today."}));
      });
      // ---- the owner's condition (Fix 2c): a computer key refused a bridge id: one alert per (id, computer), owners only
      if (S.account && S.account.me && S.account.me.role === "owner"){
        const tp = TCloud.pane || {};
        if (!tp.bridgeAlertsAt || Date.now() - tp.bridgeAlertsAt > 300000){ tp.bridgeAlertsAt = Date.now(); TCloud.loadBridgeAlerts().then(() => render()).catch(() => {}); }
        (tp.bridgeAlerts || []).filter(x => !x.read_at).forEach(x => out.push({key: "bridgeid:" + x.id, fp: AlertClear.fp(["bridgeid:" + x.id]), sev: "bad", cid: "", selfClear: false, at: x.last_at || x.at,
          text: [x.tried_computer, x.tried_user].filter(Boolean).join(" \u00b7 ") + " tried to use bridge " + x.bridge_id + ", which belongs to another computer; FinCom refused it.",
          fix: "Ask that Windows user to install FinCom Bridge again (it makes an id of its own), or release this bridge's identity on the Tally page.",
          details: x.words || "", act: {label: "Mark read", run: () => TCloud.bridgeAlertRead(x)}}));
      }
      // ---- what cannot clear itself: the daily summary, until read
      unread.filter(x => x.kind === "summary").forEach(x => out.push({key: "alert:" + x.id, fp: AlertClear.fp(["alert:" + x.id]), sev: "info", cid: x.client_id || "", text: x.words || "The day's summary.", fix: "", details: x.at ? "At " + fmtDateTime(x.at) : "", at: x.at, selfClear: false, alert: x}));
    }
    // ---- the app's own warnings
    const a = S.account, bal = a && a.firm ? num(a.firm.balance) : 0, warnAt = a && a.firm ? num(a.firm.warn_at) : 0;
    if (a && a.firm){
      if (S.creditStop && Date.now() - S.creditStop.at < 6 * 3600e3 && bal <= 0) out.push({key: "app:credit", fp: AlertClear.fp(["credit:stop:" + istDay(S.creditStop.at)]), sev: "bad", text: "Credit finished: reading new bills, bank statements and invoices is paused.", fix: "Ask the administrator to add credit. Everything already in FinCom still works.", selfClear: true});
      else if (bal <= warnAt) out.push({key: "app:credit", fp: AlertClear.fp(["credit:low:" + warnAt]), sev: "warn", text: "Credit left: " + money(bal) + ".", fix: "Ask the administrator to top it up before it runs out.", selfClear: true});
    }
    if (!(S.storeKind === "db" || (typeof Cloud === "object" && Cloud.on() && Cloud.st && !Cloud.st.error))){
      const kept = S.storeKind === "local" || S.storeKind === "idb";
      out.push({key: "app:store", fp: AlertClear.fp(["store:" + (kept ? "browser" : "unsaved")]), sev: kept ? "info" : "bad", text: kept ? "Your work is saved in this browser only." : "Your work is not being saved.",
        fix: kept ? "Clearing browser data would remove it. Sign in from Settings to keep it in the firm account." : "It will be lost when this page closes. Sign in from Settings to keep it.", selfClear: true});
    }
    const st = typeof selfTestSummary === "function" ? selfTestSummary() : {state: "none"};
    if (st.state === "fail") out.push({key: "app:selftest", fp: AlertClear.fp(["selftest:" + st.fails.slice().sort().join(",")]), sev: "warn", text: "Bill reading has a problem on this computer.", fix: "See the self-test in Settings.",
      details: st.fails.map(k => (k === "pdf" ? "PDF reading: " : "Photo OCR: ") + st.r[k].msg).join(" "), act: {label: "Self-test", run: () => doAct("goSelfTest")}, selfClear: true});
    const rank = {bad: 0, warn: 1, info: 2};
    return out.sort((x, y) => rank[x.sev] - rank[y.sev] || String(y.at || "").localeCompare(String(x.at || "")));
  },
  // the client's own alerts first (its Books page), then the rest
  forClient(cid){ return this.list().filter(x => x.cid === cid && x.sev !== "info"); },
  async read(x){ if (x && x.alert && typeof Rec === "object") await Rec.alertRead(x.alert); }
};
/* ------------------------------------------------------------------ */
/* Clear (FinCom, 08-Oct-2026). The owner: "There should be option to  */
/* clear notifications everywhere.. in the bell of desktop even we dont */
/* have that option.. run it everywhere.. and have the clear option..   */
/* and if one time any notification is cleared then that notification  */
/* should not appear".                                                 */
/* ------------------------------------------------------------------ */
// Every notification (the bell's, and every slim line or banner on the pages that says the same: the alert line, the
// books' "not yet in these books" banner, Sync activity's "Needs you" groups and "being fetched" note, the unknown-ledger
// banner) has a Clear; the bell has Clear all. A notification cleared is never shown again to that person, on any page or
// device. It is "the same notification" when its fingerprint is: the items of what it says that make it this problem.
// THE FINGERPRINTS (one item a line; a notification is cleared when EVERY item of its fingerprint has been cleared by this
// person, so the same problem said with fewer items (one of two lines applied) stays cleared, and a NEW item (a new line,
// a gap from another day, another computer or kind of problem) makes it a new notification that shows). Never in a
// fingerprint: times that move, counts that tick, the words.
//   key                          shown on                                        fingerprint items
//   book:<client>|<book>         the bell; the alert line (Tally page, Books)    gap:<book id>:<IST day the gap started (the cursor's since or last
//                                                                                  match, else the gap alert row's time)>; line:<id>:need|wait for each
//                                                                                  line waiting; off:<computer>:<company> for each computer not recording it
//   held:<client>                the books' "not yet in these books" banner      line:<id>:need|wait for each held line
//   needs:<kind|company|day…>    Sync activity's "Needs you" group               line:<id>:need for each of its lines
//   fetching:<client or all>     Sync activity's "being fetched" note            line:<id>:wait|need for each line
//   unk:<client or firm>         "uses a ledger FinCom does not have yet"        unk:<the entry's key> for each entry
//   ownwait:<computer>           the bell                                        ownwait:<computer>:<IST day> (the beat has no start time: another day is new)
//   pc:<computer>                the bell                                        pc:<computer>:retry:<IST day of the retry> | :stopped:<its time> |
//                                                                                  :notanswering:<since> | :silent:<IST day>  (the computer + the kind)
//   bridgeid:<id>                the bell (owners)                               bridgeid:<id>
//   alert:<id>                   the bell (the daily summary)                    alert:<id>  (Clear also marks it read, as Mark read)
//   app:credit                   the bell; the alert line                        credit:stop:<IST day it stopped> | credit:low:<the warning level> (not the balance)
//   app:store                    the bell                                        store:browser | store:unsaved
//   app:selftest                 the bell; the alert line                        selftest:<the failed checks>
// line:<id>:need|wait: AlertHub.lineAtom ("need" when a person must act: Rec.needKind), the same in every place, so a
// line cleared in the bell is cleared on the books' banner and in Sync activity too.
// Where it is kept: signed in to the firm account, in FinCom's cloud (migration 68: app_alert_dismissals, the person's own
// rows, through alert_dismiss / alert_dismiss_undo / alert_dismissals_list), with a copy in this browser so a reload hides
// what was cleared while the list is read again; not signed in (or before migration 68 runs), in this browser only
// (localStorage). Clearing hides; it never changes data: no line applied or released, nothing removed, the work lists
// (Sync activity's table, Post to Tally) stay as they are. Undo marks that Clear's rows undone (kept, never removed).
const AlertClear = {
  st: null,
  undo: null,          // the last Clear, for its Undo: {lb, n, until}
  inflight: {},        // lb -> the call sending it
  reset(){ this.st = {who: null, rows: [], at: 0, busy: false, none: false, ver: 0, set: null, setVer: -1}; },
  fp(items){ return [...new Set([].concat(items || []).filter(Boolean).map(String))].sort().join("\n"); },
  item(key, items, text){ return {key, fp: this.fp(items), text: String(text || "")}; },
  firmOn(){ try { return typeof Cloud === "object" && Cloud.on() && !!(Cloud.st && Cloud.st.firm); } catch (e){ return false; } },
  who(){ if (!this.firmOn()) return "local"; const s = (Cloud.sess && Cloud.sess()) || {}; return Cloud.st.firm + "|" + (s.user_id || s.email || Cloud.st.email || ""); },
  lsKey(w){ return "fincom:alerts-cleared:" + w; },
  readLocal(w){ try { const v = JSON.parse(localStorage.getItem(this.lsKey(w)) || "[]"); return Array.isArray(v) ? v.filter(r => r && r.fp) : []; } catch (e){ return []; } },
  saveLocal(){ const st = this.st; try { localStorage.setItem(this.lsKey(st.who), JSON.stringify(st.rows.slice(0, 5000))); } catch (e){} },
  cloud(){ return this.firmOn() && !this.st.none; },
  rpc(fn, a){ return typeof TCloud === "object" && TCloud.rpc ? TCloud.rpc(fn, a) : Cloud.api("rpc/" + fn, {method: "POST", body: a || {}}); },
  missing(e){ return /PGRST20[0-9]|does not exist|Could not find|schema cache|\b404\b/i.test(String((e && e.message) || e)); },
  // the person's cleared rows now ({key, fp, batch, lb, pending}); the cloud's list read at most once a minute
  rowsNow(){
    if (!this.st) this.reset();
    const w = this.who();
    if (this.st.who !== w){ this.reset(); this.st.who = w; this.st.rows = this.readLocal(w); }
    const st = this.st;
    if (this.cloud() && !st.busy && Date.now() - st.at > 60000){ st.at = Date.now(); setTimeout(() => this.load(), 0); }
    return st.rows;
  },
  async load(){
    const st = this.st;
    if (!st) return;
    st.busy = true;
    try {
      const pend = st.rows.filter(r => r.pending);         // what could not be sent before goes first
      if (pend.length) await this.send(pend);
      if (!st.none){
        const list = [].concat(await this.rpc("alert_dismissals_list", {}) || []);
        const lbOf = new Map(st.rows.filter(r => r.batch && r.lb).map(r => [r.batch, r.lb]));
        st.rows = list.map(x => ({key: String(x.key || ""), fp: String(x.fp || ""), batch: String(x.batch || ""), lb: lbOf.get(String(x.batch || "")) || ""}))
          .filter(r => r.fp).concat(st.rows.filter(r => r.pending));
      }
    } catch (e){ if (this.missing(e)) st.none = true; }
    st.busy = false; st.at = Date.now(); st.ver++;
    if (this.st === st){ this.saveLocal(); if (typeof render === "function") render(); }
  },
  async send(rows){
    const st = this.st;
    try {
      const j = await this.rpc("alert_dismiss", {p_items: rows.map(r => ({key: r.key, fp: r.fp, words: r.words || ""}))});
      rows.forEach(r => { r.pending = false; r.batch = String((j && j.batch) || ""); });
    } catch (e){ if (this.missing(e)) st.none = true; }
    if (this.st === st) this.saveLocal();
  },
  atoms(){
    this.rowsNow();
    const st = this.st;
    if (st.setVer !== st.ver || !st.set){ st.set = new Set(); st.rows.forEach(r => String(r.fp || "").split("\n").forEach(a => { if (a) st.set.add(a); })); st.setVer = st.ver; }
    return st.set;
  },
  cleared(x){ if (!x || !x.fp) return false; const a = this.atoms(); return String(x.fp).split("\n").every(t => a.has(t)); },
  // Clear: one notification or many (Clear all); hidden at once, then kept (the cloud, or this browser)
  async clear(items){
    items = [].concat(items || []).filter(x => x && x.key && x.fp && !this.cleared(x));
    if (!items.length) return;
    this.rowsNow();
    const st = this.st, lb = "L" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const rows = items.map(x => ({key: x.key, fp: x.fp, words: String(x.text || "").slice(0, 500), lb, batch: "", pending: true}));
    st.rows = rows.concat(st.rows); st.ver++; this.saveLocal();
    this.undo = {lb, n: items.length, until: Date.now() + 6000};
    clearTimeout(this.undoT); this.undoT = setTimeout(() => { if (this.undo && this.undo.lb === lb){ this.undo = null; if (typeof render === "function") render(); } }, 6100);
    if (typeof render === "function") render();
    // the daily summary: Clear marks it read too (as its Mark read did)
    items.filter(x => x.alert && typeof AlertHub === "object").forEach(x => { try { Promise.resolve(AlertHub.read(x)).catch(() => {}); } catch (e){} });
    if (this.cloud()){ const p = this.send(rows); this.inflight[lb] = p; try { await p; } finally { delete this.inflight[lb]; } }
  },
  // Undo the last Clear: its rows marked undone in the cloud (kept), gone from this browser's copy
  async undoLast(){
    const u = this.undo;
    if (!u) return;
    this.undo = null; clearTimeout(this.undoT);
    if (this.inflight[u.lb]) await this.inflight[u.lb].catch(() => {});
    const st = this.st, mine = st.rows.filter(r => r.lb === u.lb);
    st.rows = st.rows.filter(r => r.lb !== u.lb); st.ver++; this.saveLocal();
    if (typeof render === "function") render();
    for (const b of [...new Set(mine.map(r => r.batch).filter(Boolean))]){
      try { await this.rpc("alert_dismiss_undo", {p_batch: b}); }
      catch (e){ if (!this.missing(e) && typeof toast === "function") toast("Could not undo in the firm account: " + ((e && e.message) || e)); }
    }
  },
  undoShown(){ return this.undo && Date.now() < this.undo.until ? this.undo : null; }
};
AlertClear.reset();
// what a client's books say while lines Tally sent for them are held (AlertHub.booksHeld): null when none
function booksHeld(cid){ return typeof AlertHub === "object" ? AlertHub.booksHeld(cid || S.coId) : null; }
// the same words on a printed report or ledger (led: a ledger's own lines too), and as the first rows of its Excel sheet
function heldWords(cid, led, to){
  const h = booksHeld(cid);
  return h ? [h.text].concat(led ? AlertHub.ledgerHeld(cid || S.coId, led, to).map(x => x.text) : []) : [];
}
function heldPrintHtml(cid, led, to){ return heldWords(cid, led, to).map(t => '<p class="note" data-held-print="" style="color:#9A3412;font-weight:600;margin:4px 0">' + esc(t) + "</p>").join(""); }
function heldSheetRows(cid, led, to){ const w = heldWords(cid, led, to); return w.length ? w.map(t => [t]).concat([[]]) : []; }
// "This will post through Office computer (NWS144)." before Post (the bank's and sales' bars, and the posting preview):
// the computer the posting goes through, the same as the Tally sign says; "" when none is connected
function postThroughWords(co){
  const s = typeof tallySign === "function" ? tallySign(co) : null;
  if (!s || !s.on) return "";
  // the owner's rule of 05-Oct-2026: the poster's own bridge, named with its Windows user (a shared computer has one a user)
  try {
    const r = typeof TCloud === "object" && TCloud.pane && TCloud.pane.devices && !TCloud.pane.noTarget && typeof TCloud.postThrough === "function" ? TCloud.postThrough(co) : null;
    if (r) return "This will post through " + [r.computer, r.user].filter(Boolean).join(" \u00b7 ") + ".";
  } catch (e){}
  if (s.local) return "This will post through this computer.";
  return "This will post through " + (s.through && s.through.length === 1 ? s.through[0] : s.computer) + ".";
}
