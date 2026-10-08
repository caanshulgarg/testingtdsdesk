/* ================================================================== */
/* Phase 2: the Tally change recorder (migration 44)                  */
/* ================================================================== */
// FinCom Bridge 2.1.9 sends every change saved in Tally as a recorder line (tally_recorder_lines); FinCom's cloud applies
// it to the copy, holds it (a locked month, no body) or marks it a duplicate. Here, for the app:
//   - the tie-out of a month (Books -> Tie-out): the five figures typed from Tally beside FinCom's own five, saved with
//     tally_tieout_save; the owner ticks it and locks the month (tally_month_lock / tally_month_unlock);
//   - Sync activity (the Tally page): the lines, newest first, what waits and why, the owner's Apply now;
//   - per computer and company: recording or not (info.bridges[id].recorder), the gap when a PC without the add-on
//     changed Tally (tally_sync_cursor.gap), and the computers silent today (tally_recorder_silent).
// Every read falls back quietly when migration 44 has not run (42703, PGRST202/205: the words REC_NOT44 where the feature
// needs it, nothing elsewhere).
const REC_NOT44 = "not available until migration 44 runs";
const Rec = {
  firm(){ const f = typeof Cloud === "object" && Cloud.st ? Cloud.st.firm : ""; return f && typeof f === "object" ? String(f.id || "") : String(f || ""); },
  missing(e){ return /42703|42P01|PGRST20[0-9]|does not exist|Could not find|schema cache|\b404\b/i.test(String((e && e.message) || e)); },
  role(){ return (S.account && S.account.me && S.account.me.role) || ""; },
  owner(){ return this.role() === "owner"; },
  canWrite(){ return ["owner", "staff"].includes(this.role()); },
  say(e){ return String((e && e.message) || e).replace(/^ERROR:\s*/i, "").replace(/^./, c => c.toUpperCase()); },
  // a local date as yyyy-mm-dd
  ymdLocal(t){ const d = new Date(t); return isNaN(d) ? "" : d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); },

  // ---------------------------------------------------------------- H54: the tie-out of a month
  FIGS: [["receivables", "Receivables"], ["payables", "Payables"], ["cash_bank", "Cash and bank"], ["profit", "Profit"], ["tb_total", "Trial balance total"]],
  tie: {},                 // cid -> {rows: {month: row}, locks: {month: row}, no44, at, busy, err, msg: {month: {ok|err}}}
  tieOf(cid){
    const t = this.tie[cid] = this.tie[cid] || {rows: {}, locks: {}, msg: {}, at: 0, busy: false};
    if (typeof TCloud === "object" && TCloud.on() && !t.busy && !t.no44 && Date.now() - t.at > 60000){ t.at = Date.now(); setTimeout(() => this.tieLoad(cid), 0); }
    return t;
  },
  async tieLoad(cid){
    const t = this.tie[cid] = this.tie[cid] || {rows: {}, locks: {}, msg: {}, at: 0};
    t.busy = true;
    try {
      const q = "client_id=eq." + encodeURIComponent(cid);
      const rows = [].concat(await Cloud.api("tally_tieouts?select=month,receivables,payables,cash_bank,profit,tb_total,fincom,saved_at,saved_by,ticked_at,ticked_by,note&" + q + "&order=month.asc") || []);
      const locks = [].concat(await Cloud.api("tally_month_locks?select=month,locked_at,locked_by,note,unlocked_at&" + q + "&unlocked_at=is.null&order=month.asc") || []);
      t.rows = {}; rows.forEach(r => { t.rows[String(r.month).slice(0, 10)] = r; });
      t.locks = {}; locks.filter(l => !l.unlocked_at).forEach(l => { t.locks[String(l.month).slice(0, 10)] = l; });
      t.no44 = false; t.err = "";
    } catch (e){ if (this.missing(e)) t.no44 = true; else t.err = this.say(e); }
    t.busy = false; t.at = Date.now(); render();
  },
  // the months of the copy's period ("YYYY-MM-01"), newest first: the cloud copy's dates, else the books read here
  months(cid){
    const bk = typeof TCloud === "object" ? TCloud.book(cid) : null, b = S.books && S.books.cid === cid ? S.books : null;
    const d8 = x => String(x || "").replace(/-/g, "").slice(0, 8);
    const from = [bk && d8(bk.from), b && d8((b.meta || {}).from)].filter(Boolean).sort()[0] || "";
    const to = [bk && d8(bk.to), b && d8((b.meta || {}).to)].filter(Boolean).sort().pop() || "";
    if (!from || !to || to < from) return [];
    return MIS.monthsOf(from, to).map(ym => ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-01").reverse();
  },
  monthEnd(m){ const y = num(m.slice(0, 4)), mo = num(m.slice(5, 7)), last = new Date(y, mo, 0).getDate(); return m.slice(0, 4) + m.slice(5, 7) + String(last).padStart(2, "0"); },
  // FinCom's five figures at a month-end, from the books read here, by the helpers the books screens use (no working of
  // its own): receivables and payables Parties.position (customers in debit, suppliers in credit, as MIS, Reports and
  // Letters show them); cash and bank Audit.balances on the cash and bank ledgers (Audit.isCash, Audit.isBankL), as MIS's
  // run does; profit MIS.pl from the year's start (the profit after tax, as Tally's P&L shows the year so far); the trial
  // balance total LK.tbBooks (Look up's trial balance, its debit total; one that does not total is not given).
  // {receivables, payables, cash_bank, profit, tb_total, why: {figure: words when not available}}
  _fc: null,
  fincom(cid, month){
    const b = S.books && S.books.cid === cid ? S.books : null, out = {why: {}};
    const na = (k, w) => { out[k] = null; out.why[k] = w; };
    if (!b || !(b.vouchers || []).length){ this.FIGS.forEach(([k]) => na(k, "the books are not open here")); return out; }
    const end = this.monthEnd(month), key = [cid, end, (b.vouchers || []).length, (b.tb || {}).at || "", b.mapV || 0, Object.keys(b.under || {}).length].join("|");
    const memo = this._fc && this._fc.b === b ? this._fc.m : new Map();
    this._fc = {b, m: memo};
    if (memo.has(key)) return memo.get(key);
    const tryIt = (k, f) => { try { const v = f(); if (v && v.na) na(k, v.na); else out[k] = r2(v); } catch (e){ na(k, (e && e.message) || String(e)); } };
    let P = null;
    try { P = Parties.position(end); } catch (e){ P = {ok: false, why: (e && e.message) || String(e)}; }
    tryIt("receivables", () => P.ok ? P.owed : {na: P.why});
    tryIt("payables", () => P.ok ? P.youOwe : {na: P.why});
    tryIt("cash_bank", () => {
      const tb = b.tb, fs = Audit.fyStart(end), base = tb && tb.from > fs && tb.from <= end ? tb.from : fs;
      const B = Audit.balances(base, end);
      if (!B.ok) return {na: B.why};
      const at = B.at(end);
      return Object.keys(at).filter(l => Audit.isCash(l) || Audit.isBankL(l)).reduce((s, l) => s + r2(-at[l]), 0);
    });
    tryIt("profit", () => {
      const fs = Audit.fyStart(end);
      if (!MIS.covered(fs)) return {na: "the books here begin after " + fmtDate(tallyDate(fs))};
      return MIS.pl(fs, end).pat.t;
    });
    tryIt("tb_total", () => {
      const T = LK.tbBooks(end);
      if (T.none) return {na: T.none};
      if (T.refused) return {na: "the trial balance here does not total (off by " + INR.format(T.off) + ")"};
      return T.dr;
    });
    memo.set(key, out);
    return out;
  },
  // a figure typed from Tally: "" -> null; "1,23,456.50", "-2,000", "(2,000)" -> numbers; anything else -> NaN
  parse(s){
    let t = String(s == null ? "" : s).replace(/[\s,₹]/g, "");
    if (!t) return null;
    let neg = false;
    if (/^\(.*\)$/.test(t)){ neg = true; t = t.slice(1, -1); }
    if (!/^[-+]?\d*\.?\d+$/.test(t)) return NaN;
    const n = Number(t);
    return neg ? -n : n;
  },
  // Save (tick null), Tick (true), Untick (false): tally_tieout_save(p_client, p_month, p_figures, p_fincom, p_tick)
  async tieSave(cid, month, vals, tick){
    const t = this.tieOf(cid), figs = {};
    for (const [k, label] of this.FIGS){
      const n = this.parse(vals[k]);
      if (Number.isNaN(n)){ t.msg[month] = {err: label + " must be a number."}; render(); return false; }
      figs[k] = n == null ? null : r2(n);
    }
    figs.note = String(vals.note || "").trim().slice(0, 300);
    const f = this.fincom(cid, month), fc = {};
    this.FIGS.forEach(([k]) => { fc[k] = f[k] == null ? null : f[k]; });
    t.msg[month] = {busy: true}; render();
    try {
      const r = await TCloud.rpc("tally_tieout_save", {p_client: cid, p_month: month, p_figures: figs, p_fincom: fc, p_tick: tick === undefined ? null : tick});
      if (r && r.ok === false) throw new Error(r.error || "It was not saved.");
      if (r && r.month) t.rows[String(r.month).slice(0, 10)] = r;
      t.msg[month] = {ok: tick === true ? "Saved and ticked." : tick === false ? "Saved; the tick is taken off." : "Saved."};
    } catch (e){
      t.msg[month] = {err: this.missing(e) ? "Tie-out: " + REC_NOT44 + "." : this.say(e)};
    }
    render();
    return true;
  },
  async lock(cid, month){
    const a = await askConfirm({title: "Lock " + GSTR.label(month.slice(0, 4) + month.slice(5, 7)) + "?", ok: "Lock the month",
      body: "<p>Changes made in Tally to entries of this month are held, not applied to FinCom’s copy, until you approve each one (Tally page → Sync activity → Apply now) or unlock the month.</p>" +
        '<div class="bk-form one"><label><span>Note (kept with the lock)</span><input id="lockNote" maxlength="300" placeholder="Why the month is locked"></label></div>',
      read: () => ({note: ((document.getElementById("lockNote") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    await this.lockCall(cid, month, "tally_month_lock", {p_client: cid, p_month: month, p_note: (a.data && a.data.note) || ""});
  },
  async unlock(cid, month){
    const a = await askConfirm({title: "Unlock " + GSTR.label(month.slice(0, 4) + month.slice(5, 7)) + "?", ok: "Unlock",
      body: "<p>Changes made in Tally to this month are applied to FinCom’s copy again as they come. Lines already held stay held until you apply them.</p>" +
        '<div class="bk-form one"><label><span>Note (optional)</span><input id="unlockNote" maxlength="300"></label></div>',
      read: () => ({note: ((document.getElementById("unlockNote") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    await this.lockCall(cid, month, "tally_month_unlock", {p_client: cid, p_month: month, p_note: (a.data && a.data.note) || ""});
  },
  async lockCall(cid, month, fn, args){
    const t = this.tieOf(cid);
    t.msg[month] = {busy: true}; render();
    try {
      const r = await TCloud.rpc(fn, args);
      if (r && r.ok === false) throw new Error(r.error || "It was not done.");
      t.msg[month] = {ok: fn === "tally_month_lock" ? (r && r.already ? "The month was locked already." : "Locked.") : "Unlocked."};
    } catch (e){ t.msg[month] = {err: this.missing(e) ? "Month locks: " + REC_NOT44 + "." : this.say(e)}; }
    await this.tieLoad(cid);
  },

  // ---------------------------------------------------------------- H49-H51: Sync activity
  // 05-Oct-2026 (the owner's words): what was done in Tally, and what it means for the books. Never "synced": a line not
  // entered in the books says so, with the cloud's reason
  ACTS: {created: "Created", altered: "Altered", deleted: "Deleted", cancelled: "Cancelled", imported: "Imported", ledger_created: "Ledger created",
    ledger_altered: "Ledger altered", ledger_renamed: "Ledger renamed", ledger_deleted: "Ledger deleted"},
  // FinCom's own entry coming back from Tally: a line with a FinCom id (fid) or a short line (migration 45; read as fid / short
  // with the lines, or in the whole row a live line brings), or the cloud's words for it. Only its creation is FinCom's: a
  // later change to it in Tally is a person's (Altered)
  fromFincom(r){
    if (!r || !["created", "imported"].includes(String(r.event || ""))) return false;
    const p = (r.payload && typeof r.payload === "object") ? r.payload : {};
    const fid = r.fid || p.fid, short = r.short != null ? r.short : p.short;
    return !!fid || short === true || short === "true" || /^FinCom (posting|id) /.test(String(r.held_why || ""));
  },
  actWords(r){ return this.fromFincom(r) ? "Posted from FinCom" : (this.ACTS[r.event] || String(r.event || "")); },
  act: {},                 // {rows, no44, busy, at, err, cid (whose lines were read), msg}
  actOf(){
    const a = this.act, cid = S.syncClient || "";
    if (!a.rows && !("at" in a)) Object.assign(a, {rows: null, at: 0, busy: false, no44: false, err: "", cid: ""});
    if (typeof TCloud === "object" && TCloud.on() && !a.busy && (a.cid !== cid || !a.at || Date.now() - a.at > 60000)){ a.at = Date.now(); a.cid = cid; setTimeout(() => this.actLoad(), 0); }
    return a;
  },
  async actLoad(){
    const a = this.act, cid = S.syncClient || "";
    a.busy = true; a.cid = cid;
    try {
      const rows = await Cloud.api("tally_recorder_lines?select=id,client_id,book_id,device_id,pc,company,line_id,event,object_guid,alter_id,vch_type,vch_no,vch_date,saved_at,received_at,applied_at,state,held_why,ledgers,fid:payload->>fid,short:payload->>short,checks:payload->checkNotes" +
        "&firm_id=eq." + encodeURIComponent(this.firm()) + (cid ? "&client_id=eq." + encodeURIComponent(cid) : "") + "&order=received_at.desc&limit=200");
      a.rows = [].concat(rows || []); a.no44 = false; a.err = "";
    } catch (e){ if (this.missing(e)){ a.no44 = true; a.rows = []; } else a.err = this.say(e); }
    a.busy = false; a.at = Date.now(); render();
  },
  // a line from the live channel (Live, src/js/54): put in its place, newest first
  lineIn(r){
    if (!r || r.id == null) return false;
    const a = this.act;
    if (!Array.isArray(a.rows)) return false;
    if (a.cid && r.client_id && r.client_id !== a.cid) return false;
    const rows = a.rows.filter(x => String(x.id) !== String(r.id));
    rows.push(r);
    a.rows = rows.sort((x, y) => String(y.received_at || "").localeCompare(String(x.received_at || "")) || num(y.id) - num(x.id)).slice(0, 200);
    render();
    return true;
  },
  sorted(){ return [].concat(this.act.rows || []).sort((x, y) => String(y.received_at || "").localeCompare(String(x.received_at || "")) || num(y.id) - num(x.id)); },
  filtered(f){
    const rows = this.sorted(), today = new Date().toDateString();
    if (f === "waiting") return rows.filter(r => r.state === "held" || r.state === "received");
    if (f === "held") return rows.filter(r => r.state === "held");
    if (f === "mismatch") return rows.filter(r => r.check && r.check.ok === false);        // the ledger check (F37-40): none yet
    if (f === "today") return rows.filter(r => r.received_at && new Date(r.received_at).toDateString() === today);
    return rows;
  },
  entry(r){
    if (/^ledger_/.test(String(r.event || ""))){ const l = [].concat(r.ledgers || [])[0]; return (l && (l.name || l.to || l.from)) || "a ledger"; }
    const head = [r.vch_type, r.vch_no].filter(Boolean).join(" ");
    return (head || "an entry") + (r.vch_date ? " · " + fmtDate(String(r.vch_date).slice(0, 10)) : "");
  },
  // bridge 2.3.1 (the owner's rule after review, 06-Oct-2026): an entry is held only when its lines do not total zero; any
  // other mismatch is entered with plain words for a person (tally-ingest's payload checkNotes, read as checks; a live row
  // carries its payload): "; to check: ..." after "Entered in the books"
  notesWords(r){
    const n = [].concat((r && (r.checks || (r.payload && r.payload.checkNotes))) || []).map(x => String(x || "").trim()).filter(Boolean);
    return n.length ? "; to check: " + n.join("; ") : "";
  },
  // a line's state in the owner's words (05-Oct-2026): "Entered in the books" for an applied line alone
  stateWords(r){
    const why = r.held_why ? ": " + r.held_why : "";
    switch (r.state){
      case "applied": return "Entered in the books" + this.notesWords(r);
      case "held": return "Received, not yet entered in the books" + why;
      case "received": return "Received, not yet entered in the books";
      case "replaced": return "Replaced by a later line";
      case "duplicate": return "Already in the books";
      case "stale": return "An older change, not applied";
      case "failed": return "Not entered" + why;
      case "queued": return "Received, waiting in FinCom's queue";
      default: return "Not entered: " + String(r.state || "unknown state");
    }
  },
  // the computer a line came from, from the firm's computers as the Tally page or the Tally light read them
  devOf(id){ return [].concat((typeof TCloud === "object" && TCloud.pane.devices) || [], (typeof TLight === "object" && TLight.st.devs) || []).find(d => d && d.id === id) || null; },
  // the lines received or held more than 2 minutes ago, each with why it waits: the PC offline, Tally closed there, or
  // the cloud's own words (held_why)
  waiting(){
    const now = Date.now();
    return this.sorted().filter(r => (r.state === "received" || r.state === "held") && r.received_at && now - Date.parse(r.received_at) > 120000).map(r => {
      const d = this.devOf(r.device_id), pc = r.pc || (d && ((d.info || {}).computer || d.name)) || "the Tally computer";
      let why = r.held_why || "";
      if (!why && d){ const ds = devState(d, now); why = ds.bridge === "offline" || ds.bridge === "none" ? pc + " is offline" : ds.tally === "closed" ? "Tally not open on " + pc : ""; }
      else if (d && r.state === "received"){ const ds = devState(d, now); if (ds.bridge === "offline" || ds.bridge === "none") why = pc + " is offline"; else if (ds.tally === "closed") why = "Tally not open on " + pc; }
      return {r, why: why || "not yet entered in the books"};
    });
  },
  // FinCom 2.3.5 (the owner: "in tally sync there is a yellow field coming all the time.. there should be clear flow"):
  // the lines waiting over 2 minutes (waiting(), above) by what will actually happen to them - THE one classifier, used by
  // Sync activity, the books' held banner and the bell (AlertHub.oursHeld), so they never disagree (review of f0f1531f).
  //   "" = being fetched: FinCom Bridge or the cloud settles it by itself (said quietly);
  //   any other kind = Needs you: nothing happens until a person acts, with ONE action:
  //     daybook  - upload that day's Day Book (the bridge gave up; no entry GUID; a Day Book of the day incomplete...)
  //     dupid    - FinCom's id is on a second Tally entry: check Tally for a double posting, then upload that day's Day Book
  //     readstop - reading is stopped from FinCom on that computer: an owner resumes it (Resume reading)
  //     baseline - the company's starting point is not recorded: the Tally page (the computer's More, Baselines)
  //     masters  - a ledger line with no GUID: read the ledgers from Tally (Books -> From Tally)
  //     locked   - the month is locked in FinCom: unlock it in Tie-out (then it applies)
  //     other    - any other held reason: Apply now (tally_recorder_release_held), once it is settled
  // Every reason the bridge (bridge-go) and the cloud (server/tally-cloud, migration 60) write is in
  // tests/run_tally_page_simple.py (KINDS), each with its kind. The cloud's words are not changed.
  FETCHED: [/waiting for the entry's details/i, /^waiting: /i, /FinCom asks again at/i, /matches no posting of this firm/i,
    /held until FinCom Bridge( [\d.]+)? sends/i, /next (ledger list|day read|full line)/i, /^unknown (entry|ledger)\b/i, /^applied when |^replaced by /i,
    /could not be asked whether it was (deleted|cancelled) here/i, /^the entry was not read from Tally/i, /queue/i, /not read from Tally in time/i],
  needKind(r){
    if (!r) return "";
    const why = String(r.held_why || "").trim(), st = String(r.state || "");
    if (st === "received" || st === "queued") return "";
    if (st === "failed") return /queue|timeout|server/i.test(why) ? "" : "other";
    if (st !== "held") return "";
    if (/reading from Tally is stopped|stopped from FinCom/i.test(why)) return "readstop";
    if (/starting point/i.test(why)) return "baseline";
    if (/^FinCom id .* is matched to another Tally entry/i.test(why)) return "dupid";
    if (/no MasterID or no date/i.test(why)) return "daybook";
    if (this.FETCHED.some(x => x.test(why))) return "";
    if (/Day Book|could not tell which entry|cannot tell which entry|cannot be asked for its entry/i.test(why)) return "daybook";
    if (/^no GUID on the line/i.test(why)) return "masters";
    if (/^month locked/i.test(why)) return "locked";
    if (!why && /-0{8}$/.test(String(r.object_guid || ""))) return "";     // the add-on's placeholder, no words yet: the bridge asks for it
    return "other";
  },
  // {needs: [{key, kind, cid, company, day (yyyy-mm-dd), lines, text}], fetching: [{r, why}]}
  flow(){
    const needs = new Map(), fetching = [];
    this.waiting().forEach(w => {
      const r = w.r, kind = this.needKind(r);
      if (!kind){ fetching.push(w); return; }
      const company = r.company || (((S.companies || {})[r.client_id] || {}).name) || "a company";
      const day = /^\d{4}-\d{2}-\d{2}/.test(String(r.vch_date || "")) ? String(r.vch_date).slice(0, 10) : istDay(r.received_at) || "";
      const dev = this.devOf(r.device_id), pc = r.pc || (dev && ((dev.info || {}).computer || dev.name)) || "the Tally computer";
      const key = kind + "|" + company + "|" + (kind === "readstop" ? pc : kind === "masters" || kind === "baseline" ? "" : day) + (kind === "other" ? "|" + String(r.held_why || "") : "");
      if (!needs.has(key)) needs.set(key, {key, kind, cid: r.client_id || "", company, day: kind === "readstop" || kind === "masters" || kind === "baseline" ? "" : day, pc, deviceId: r.device_id || "", lines: []});
      needs.get(key).lines.push(r);
    });
    const n = (k) => k + (k === 1 ? " entry" : " entries"), out = [...needs.values()].sort((a, b) => a.company.localeCompare(b.company) || b.day.localeCompare(a.day));
    out.forEach(g => {
      const k = g.lines.length, d = g.day ? fmtDate(g.day) : "", head = g.company + (d ? " · " + d : "") + ": ";
      const w = String(g.lines[0].held_why || ""), m = /^FinCom id (\S+)/.exec(w);
      g.text = head + (g.kind === "daybook" ? n(k) + " could not be read from Tally \u2014 upload the Day Book for " + (d || "that day")
        : g.kind === "dupid" ? n(k) + " carry FinCom id " + (m ? m[1] : "") + ", which is on another Tally entry already \u2014 check Tally for a double posting, then upload the Day Book for " + (d || "that day")
        : g.kind === "readstop" ? n(k) + " waiting: reading from Tally is stopped on " + g.pc + " \u2014 " + (this.role() === "owner" ? "Resume reading" : "an owner of the firm resumes it on the Tally page")
        : g.kind === "baseline" ? n(k) + " waiting: the company's starting point is not recorded \u2014 see the Tally page (the computer's More)"
        : g.kind === "masters" ? n(k) + " of a ledger with no GUID \u2014 read the ledgers again: Books \u2192 From Tally"
        : g.kind === "locked" ? n(k) + (k === 1 ? " falls" : " fall") + " in a month locked in FinCom (" + w + ") \u2014 unlock the month in Tie-out; " + (k === 1 ? "it applies" : "they apply") + " then"
        : n(k) + " not yet entered in the books (" + (w || "held") + ") \u2014 Apply now once it is settled");
    });
    // 2.4.0 review MEDIUM (next-renumber): the bridges' renumbering alerts are "Needs you" too (kind renumber), first
    const rn = this.renumberNeeds().filter(g => !S.syncClient || g.cid === S.syncClient);
    return {needs: rn.concat(out), fetching};
  },
  // 2.4.0 review MEDIUM (next-renumber): an entry inserted or deleted in Tally makes Tally renumber the later entries of
  // that voucher type with no line for them; FinCom Bridge reads them again, and says the ones it could not
  // (renumber.go: below the starting point, Tally too slow twice, an answer it cannot read, more than 500, or not
  // listable by MasterID) on its beat (info.beat.renumberAlerts, kept by tally-ingest; the last 7 days). One item a
  // company, the earliest date of every computer's alerts: [{key, kind: "renumber", cid, company, day, n, more, text}];
  // its one action: Upload the Day Book from that day (Rec.uploadFrom)
  renumberNeeds(){
    const tl = (typeof TLight === "object" && TLight.st) || {}, by = new Map();
    (tl.devs || []).filter(d => d && !d.revoked).forEach(d => {
      [].concat((((d.info || {}).beat) || {}).renumberAlerts || []).forEach(a => {
        const f = String((a && a.from) || "");
        if (!a || !a.company || !/^\d{8}$/.test(f)) return;
        const day = f.slice(0, 4) + "-" + f.slice(4, 6) + "-" + f.slice(6, 8), k = norm(a.company);
        const co = (tl.cos || []).find(c => c.client_id && norm(c.company) === k)
          || Object.values(S.companies || {}).map(c => ({client_id: c.id, company: c.tallyName || c.name})).find(c => !(S.companies[c.client_id] || {}).deleted && norm(c.company) === k);
        if (!by.has(k)) by.set(k, {key: "renumber|" + a.company, kind: "renumber", cid: co ? co.client_id : "", company: a.company, day, n: 0, more: false, pc: this.pcOf(d), deviceId: d.id, lines: []});
        const g = by.get(k);
        if (day < g.day) g.day = day;
        g.n += Math.max(0, Number(a.n) || 0); g.more = g.more || a.more === true;
      });
    });
    return [...by.values()].sort((a, b) => a.company.localeCompare(b.company)).map(g => Object.assign(g, {
      text: g.company + " \u00b7 " + fmtDate(g.day) + ": " + (g.more ? "more than " : "") + g.n + (g.n === 1 && !g.more ? " entry" : " entries") +
        " may have been renumbered in Tally (an entry was inserted or deleted there) and could not be read again \u2014 upload the Day Book from " + fmtDate(g.day)}));
  },
  // the Day Book upload from a day to today: Books -> From Tally
  async uploadFrom(cid, day){
    if (!cid || !day) return;
    if (S.view !== "company" || S.coId !== cid) await openCompany(cid);
    S.dbFrom = day; S.dbTo = this.ymdLocal(Date.now());
    goClient("books:import");
  },
  // the Day Book upload for one day: Books -> From Tally with that day (Rec.uploadDays does it from a day to today)
  async uploadDay(cid, day){
    if (!cid || !day) return;
    S.dbFrom = day; S.dbTo = day;
    if (S.view !== "company" || S.coId !== cid) await openCompany(cid);
    S.dbFrom = day; S.dbTo = day;
    goClient("books:import");
  },
  // a client's Tie-out (unlocking a month), its From Tally (the ledgers), the Tally page, Resume reading on one computer
  async openClientTab(cid, tab){ if (!cid) return; if (S.view !== "company" || S.coId !== cid) await openCompany(cid); goClient(tab); },
  openTallyPage(){ S.tallyTab = "computers"; navHome("tally"); },
  resumeOn(g){ if (typeof TCloud === "object" && g && g.deviceId) TCloud.readResume({device: {id: g.deviceId}, computer: g.pc}); },
  // Apply now on every line of a group, one after another (the list's own Apply now, line by line)
  async releaseAll(lines){ for (const r of [].concat(lines || [])) if (r.state === "held") await this.release(r); },
  async release(r){
    const a = this.act;
    a.msg = {busy: true, id: r.id}; render();
    try {
      const j = await TCloud.rpc("tally_recorder_release_held", {p_line: num(r.id)});
      if (j && j.ok === false) a.msg = {err: "Line " + (j.line_id || r.id) + " is still held" + (j.why ? ": " + j.why : ".")};
      else a.msg = {ok: "Line " + ((j && j.line_id) || r.line_id || r.id) + ": " + this.stateWords({state: (j && j.state) || "applied"}) + (j && j.why ? " (" + j.why + ")" : "") + "."};
    } catch (e){ a.msg = {err: this.missing(e) ? "Apply now: " + REC_NOT44 + "." : this.say(e)}; }
    await this.actLoad();
  },
  // a client's own lines: the Tally page's Sync activity, for that client
  // filter: the list shown first ("held": the lines held, from the books' "not yet in these books" line)
  openActivity(cid, filter){ S.syncClient = cid || ""; S.syncFilter = filter || "all"; S.tallyTab = "activity"; this.act.at = 0; navHome("tally"); },

  // ---------------------------------------------------------------- unknown ledgers (the owner, 06-Oct-2026; migration 56)
  // "An entry using an unknown ledger is applied anyway, with nothing flagged. Until 2.3.1 is out, flag these on the page in
  // plain words so they are visible." The firm's live entries whose lines name a ledger FinCom's copy does not have
  // (tally_unknown_ledger_entries(p_book null): every book of the firm; members read). Read once a minute at most; nothing
  // shown (and no error) while migration 56 has not run
  unk: {},                 // per list: "firm" (p_book null) or "b:<book ids>" (a client's books, one call a book): {rows, at, busy, none, err}
  unkKey(books){ return books && books.length ? "b:" + books.join(",") : "firm"; },
  unkOf(books){
    const key = this.unkKey(books), u = this.unk[key] || (this.unk[key] = {rows: null, at: 0, busy: false, none: false, err: ""});
    if (typeof TCloud === "object" && TCloud.on() && !u.busy && (!u.at || Date.now() - u.at > 60000)){ u.at = Date.now(); setTimeout(() => this.unkLoad(books), 0); }
    return u;
  },
  async unkLoad(books){
    const key = this.unkKey(books), u = this.unk[key] || (this.unk[key] = {rows: null, at: 0, busy: false, none: false, err: ""});
    u.busy = true;
    try {
      const out = [];
      for (const b of (books && books.length ? books : [null])) out.push(...[].concat(await TCloud.rpc("tally_unknown_ledger_entries", {p_book: b}) || []));
      u.rows = out; u.none = false; u.err = "";
    } catch (e){ u.rows = []; if (this.missing(e)) u.none = true; else u.err = this.say(e); }
    u.busy = false; u.at = Date.now(); render();
  },
  // a client's books in FinCom's cloud (TCloud.st[cid].books[].book): its Books page asks for these books only (the
  // firm-wide list stops at 500 entries)
  unkBooks(cid){
    const st = cid && typeof TCloud === "object" && TCloud.st && TCloud.st[cid];
    return [...new Set([].concat((st && st.books) || []).map(b => b && b.book).filter(Boolean).map(String))].sort();
  },
  // one sentence an entry and ledger: "<type> <number> of <date> uses the ledger '<name>', which FinCom does not have yet. It
  // is in the books; the ledger's group is unknown until the next ledger list or bridge 2.3.1."
  unkWords(r, name){
    const head = [r.vtype, r.vno].map(x => String(x || "").trim()).filter(Boolean).join(" ") || "An entry";
    return head + (r.day ? " of " + fmtDate(String(r.day).slice(0, 10)) : "") + " uses the ledger '" + name + "', which FinCom does not have yet. It is in the books; the ledger's group is unknown until the next ledger list or bridge 2.3.1.";
  },
  // the sentences for one client ("" or none: every client), newest entry first: [{key, cid, text}]; books: read those
  // books only (a client's Books page), else the firm's list
  unkLines(cid, books){
    const rows = this.unkOf(books).rows || [];
    const out = [];
    rows.filter(r => !cid || String(r.client_id || "") === String(cid)).forEach(r => {
      const names = Array.isArray(r.ledgers) ? r.ledgers : String(r.ledgers || "").replace(/^\{|\}$/g, "").split(",").map(x => x.replace(/^"|"$/g, "")).filter(Boolean);
      names.forEach(n => out.push({key: (r.book_id || "") + ":" + r.guid + ":" + n, cid: r.client_id || "", text: this.unkWords(r, n)}));
    });
    return out;
  },

  // ---------------------------------------------------------------- F36 / N102: is each PC recording?
  // the recorder words a computer's bridges send (info.bridges[id].recorder: {company: {seen, lastAt}}; the beat's
  // companies may carry recorderSeen / recorderLastAt too): null when none of its bridges reports one (before 2.1.9)
  recOf(dev){
    const info = (dev && dev.info) || {}, br = info.bridges || {}, main = dev && dev.main_bridge;
    let any = false; const out = {};
    Object.keys(br).sort((x, y) => (y === main) - (x === main)).forEach(id => {
      const rc = br[id] && br[id].recorder;
      if (!rc || typeof rc !== "object") return;
      any = true;
      Object.keys(rc).forEach(co => { const x = rc[co] || {}; if (!out[co] || (x.seen && !out[co].seen)) out[co] = {seen: !!x.seen, lastAt: x.lastAt || ""}; });
    });
    if (!any) return null;
    [].concat((info.beat || {}).companies || []).forEach(c => {
      if (!c || !c.name) return;
      const o = out[c.name];
      if (o && !o.lastAt && c.recorderLastAt) o.lastAt = c.recorderLastAt;
      if (!o && c.recorderSeen !== undefined) out[c.name] = {seen: !!c.recorderSeen, lastAt: c.recorderLastAt || ""};
    });
    return out;
  },
  openOf(dev){
    const info = (dev && dev.info) || {}, s = new Set([].concat((info.beat || {}).open || []));
    Object.values(info.bridges || {}).forEach(b => [].concat((b && b.open) || []).forEach(n => s.add(n)));
    return [...s].filter(Boolean);
  },
  pcOf(dev){ return ((dev && dev.info) || {}).computer || (dev && dev.name) || "the Tally computer"; },
  // the companies open on a computer whose changes are not recorded ([] when it reports no recorder)
  notRecording(dev){
    const rc = this.recOf(dev);
    if (!rc) return [];
    return this.openOf(dev).filter(co => rc[co] && rc[co].seen === false);
  },
  // (bridge 2.3.1, the owner's last change: nothing is switched off by the 2-second rule any more; the per-company
  // "switched off" lines and their "Changes come from" advice are gone. A request not answered in time is said on the
  // computer's line, TCloud.readState)
  // the computers keeping a client's company open without recording it: [{pc, company}]
  clientNotRecording(cid){
    const st = (typeof TLight === "object" && TLight.st) || {}, out = [];
    (st.cos || []).filter(c => c.client_id === cid && c.device_id).forEach(c => {
      const d = (st.devs || []).find(x => x.id === c.device_id && !x.revoked);
      if (d && this.notRecording(d).includes(c.company)) out.push({pc: this.pcOf(d), company: c.company});
    });
    return out;
  },

  // ---------------------------------------------------------------- the GAP flag (tally_sync_cursor.gap)
  gaps: {},                // {byClient: {cid: [{book, company, gap}]}, at, busy, no44}
  gapsOf(){
    const g = this.gaps;
    if (typeof TCloud === "object" && TCloud.on() && !g.busy && !g.no44 && Date.now() - (g.at || 0) > 60000){ g.at = Date.now(); setTimeout(() => this.gapsLoad(), 0); }
    return g;
  },
  async gapsLoad(){
    const g = this.gaps;
    g.busy = true;
    try {
      const cur = [].concat(await Cloud.api("tally_sync_cursor?select=book_id,gap,gap_at,last_match_at&gap=not.is.null") || []).filter(c => c && c.gap && typeof c.gap === "object");
      const books = cur.length ? [].concat(await TCloud.restAll("tally_books?select=book_id,client_id,company&order=company.asc") || []) : [];
      const by = {};
      cur.forEach(c => { const b = books.find(x => x.book_id === c.book_id); if (b && b.client_id) (by[b.client_id] = by[b.client_id] || []).push({book: c.book_id, company: b.company || "", gap: c.gap, gapAt: c.gap_at}); });
      g.byClient = by; g.no44 = false;
    } catch (e){ g.byClient = {}; if (this.missing(e)) g.no44 = true; }
    g.busy = false; g.at = Date.now(); render();
  },
  gapFor(cid){ const g = this.gapsOf(); return ((g.byClient || {})[cid] || []); },
  // gap.words + " (Tally's change number N, received up to M)"; M: the baseline the cloud compared with (the starting
  // point, the recorder lines' highest AlterID, the day books' highest), the greatest of them
  gapWords(gap){
    const base = [gap.start_point, gap.recorder_max, gap.day_max].map(x => x == null || x === "" ? NaN : Number(x)).filter(x => !Number.isNaN(x));
    const words = gap.words || ("up to " + (gap.missingMax || gap.missing || "some") + " changes not received" + (gap.since ? " since " + fmtDateTime(gap.since) : ""));
    return words + " (Tally's change number " + (gap.tally_altvchid != null ? gap.tally_altvchid : "?") + ", received up to " + (base.length ? Math.max(...base) : "?") + ")";
  },
  // Upload the Day Book for these days: Books -> From Tally with the Day Book's dates from gap.since to today
  async uploadDays(cid, gap){
    S.dbFrom = this.ymdLocal(gap && (gap.since || gap.last_match_at || gap.at) || Date.now()) || ""; S.dbTo = this.ymdLocal(Date.now());
    if (S.view !== "company" || S.coId !== cid) await openCompany(cid);
    goClient("books:import");
  },

  // ---------------------------------------------------------------- J64: silent today
  silent: {},              // {rows, at, busy, none}
  silentOf(){
    const s = this.silent;
    if (typeof TCloud === "object" && TCloud.on() && !s.busy && !s.none && Date.now() - (s.at || 0) > 5 * 60000){ s.at = Date.now(); setTimeout(() => this.silentLoad(), 0); }
    return [].concat(s.rows || []);
  },
  async silentLoad(){
    const s = this.silent;
    s.busy = true;
    try { const j = await TCloud.rpc("tally_recorder_silent", {p_firm: this.firm()}); s.rows = [].concat((j && j.silent) || []); }
    catch (e){ s.rows = []; if (this.missing(e)) s.none = true; }
    s.busy = false; s.at = Date.now(); render();
  },

  // ---------------------------------------------------------------- round 20 (d.1): alerts (migration 47)
  // tally_alerts (kind gap | silent | summary; RLS: the firm reads its own), the latest 100, read again after a minute;
  // shown unread first, newest first. An owner or staff marks one read: tally_alert_read(p_id). The table or a column
  // missing (42P01, 42703, PGRST20x): nothing anywhere, no words
  alerts: {},              // {rows, at, busy, none, msg}
  alertsOf(){
    const a = this.alerts;
    if (typeof TCloud === "object" && TCloud.on() && !a.busy && !a.none && Date.now() - (a.at || 0) > 60000){ a.at = Date.now(); setTimeout(() => this.alertsLoad(), 0); }
    if (a.none) return [];
    return [].concat(a.rows || []).sort((x, y) => (!!x.read_at - !!y.read_at) || String(y.at || "").localeCompare(String(x.at || "")) || num(y.id) - num(x.id));
  },
  async alertsLoad(){
    const a = this.alerts;
    a.busy = true;
    try {
      a.rows = [].concat(await Cloud.api("tally_alerts?select=id,client_id,book_id,device_id,kind,day,words,data,at,read_at,read_by&firm_id=eq." + encodeURIComponent(this.firm()) + "&order=at.desc&limit=100") || []);
      a.none = false;
    } catch (e){ a.rows = []; if (this.missing(e)) a.none = true; }
    a.busy = false; a.at = Date.now(); render();
  },
  clientAlerts(cid){ return this.alertsOf().filter(x => !x.read_at && cid && String(x.client_id || "") === String(cid)); },
  async alertRead(x){
    const a = this.alerts;
    if (!this.canWrite()) return;
    a.msg = {busy: true, id: x.id}; render();
    try {
      const r = await TCloud.rpc("tally_alert_read", {p_id: x.id});
      if (r && r.ok === false) throw new Error(r.error || "It was not marked read.");
      const row = (a.rows || []).find(y => y.id === x.id);
      if (row && !row.read_at) row.read_at = new Date().toISOString();
      a.msg = null;
    } catch (e){ a.msg = {err: this.missing(e) ? "Marking an alert read: not available until migration 47 runs." : this.say(e)}; }
    await this.alertsLoad();
  },
  alertKind(k){ return {gap: "Changes not received", silent: "Silent", summary: "Today"}[k] || String(k || ""); },

  // ---------------------------------------------------------------- H52: Tally not responding
  notResponding(r){
    const beat = ((r.device || {}).info || {}).beat || {}, since = beat.notAnsweringSince;
    if (!since) return "";
    const last = (r.reqs || beat.reqs || {}).last;
    return "Tally not responding on " + r.computer + " since " + tallyHm(since) + (last && last.kind ? ", last request " + last.kind + " " + ((Number(last.ms) || 0) / 1000).toFixed(1) + " s" : "");
  }
};
