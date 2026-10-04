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
  ACTS: {created: "created", altered: "altered", deleted: "deleted", cancelled: "cancelled", imported: "imported", ledger_created: "ledger created",
    ledger_altered: "ledger altered", ledger_renamed: "ledger renamed", ledger_deleted: "ledger deleted"},
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
      const rows = await Cloud.api("tally_recorder_lines?select=id,client_id,book_id,device_id,pc,company,line_id,event,object_guid,alter_id,vch_type,vch_no,vch_date,saved_at,received_at,applied_at,state,held_why,ledgers" +
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
    if (f === "mismatch") return rows.filter(r => r.check && r.check.ok === false);        // the ledger check (F37-40): none yet
    if (f === "today") return rows.filter(r => r.received_at && new Date(r.received_at).toDateString() === today);
    return rows;
  },
  entry(r){
    if (/^ledger_/.test(String(r.event || ""))){ const l = [].concat(r.ledgers || [])[0]; return (l && (l.name || l.to || l.from)) || "a ledger"; }
    const head = [r.vch_type, r.vch_no].filter(Boolean).join(" ");
    return (head || "an entry") + (r.vch_date ? " · " + fmtDate(String(r.vch_date).slice(0, 10)) : "");
  },
  stateWords(r){
    const why = r.held_why ? ": " + r.held_why : "";
    return r.state === "applied" ? "applied" : r.state === "duplicate" ? "duplicate" : r.state === "stale" ? "stale (older than the copy)" : r.state === "held" ? "held" + why
      : r.state === "failed" ? "failed" + why : r.state === "received" ? "waiting" : String(r.state || "");
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
      if (!why && d){ const ds = devState(d, now); why = ds.bridge === "offline" || ds.bridge === "none" ? pc + " is offline" : ds.tally === "closed" ? "Tally is closed on " + pc : ""; }
      else if (d && r.state === "received"){ const ds = devState(d, now); if (ds.bridge === "offline" || ds.bridge === "none") why = pc + " is offline"; else if (ds.tally === "closed") why = "Tally is closed on " + pc; }
      return {r, why: why || "not applied yet"};
    });
  },
  async release(r){
    const a = this.act;
    a.msg = {busy: true, id: r.id}; render();
    try {
      const j = await TCloud.rpc("tally_recorder_release_held", {p_line: num(r.id)});
      if (j && j.ok === false) a.msg = {err: "Line " + (j.line_id || r.id) + " is still held" + (j.why ? ": " + j.why : ".")};
      else a.msg = {ok: "Line " + ((j && j.line_id) || r.line_id || r.id) + ": " + ((j && j.state) || "applied") + (j && j.why ? " (" + j.why + ")" : "") + "."};
    } catch (e){ a.msg = {err: this.missing(e) ? "Apply now: " + REC_NOT44 + "." : this.say(e)}; }
    await this.actLoad();
  },
  // a client's own lines: the Tally page's Sync activity, for that client
  openActivity(cid){ S.syncClient = cid || ""; S.tallyTab = "activity"; this.act.at = 0; navHome("tally"); },

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

  // ---------------------------------------------------------------- H52: Tally not responding
  notResponding(r){
    const beat = ((r.device || {}).info || {}).beat || {}, since = beat.notAnsweringSince;
    if (!since) return "";
    const last = (r.reqs || beat.reqs || {}).last;
    return "Tally not responding on " + r.computer + " since " + tallyHm(since) + (last && last.kind ? ", last request " + last.kind + " " + ((Number(last.ms) || 0) / 1000).toFixed(1) + " s" : "");
  }
};
