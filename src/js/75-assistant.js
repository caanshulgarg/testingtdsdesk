/* ================================================================== */
/* FinCom Assistant (the owner's approval of AI in the app, 13-Oct-    */
/* 2026): a chat panel on every page, for the open client or the       */
/* whole firm. It asks the fincom-assistant function, which answers    */
/* from FinCom's book tools (green: checked against the books), from   */
/* the Day Book with the AI (amber: not checked), or as general        */
/* guidance with the web (blue). It never changes anything: posting,   */
/* filing and deleting stay on their own screens.                      */
/* The panel is app/src/parts/Assistant.jsx; this file keeps its state */
/* (S.asst) and does what its buttons do.                              */
/* ================================================================== */
const ASST = {
  st(){
    if (!S.asst) S.asst = {open: false, q: "", busy: false, scope: "client", by: {}, attach: null, uploading: false, saved: null, chatIds: {}};
    return S.asst;
  },
  // the client the panel is about: the open client (unless "whole firm" is chosen), else none
  cid(){ const a = this.st(); return a.scope === "client" && S.view === "company" && S.coId && CO() ? S.coId : null; },
  key(){ return this.cid() || "_firm"; },
  turns(){ const a = this.st(), k = this.key(); return a.by[k] = a.by[k] || []; },
  draw(){ if (typeof FinComReact === "object" && FinComReact.redraw) FinComReact.redraw(); else render(); },
  url(){ return String(Cloud.cfg().url || "").replace(/\/+$/, "") + "/functions/v1/fincom-assistant"; },
  letterhead(){
    const f = S.firm || {};
    return {name: f.firmName || ((S.account || {}).firm || {}).name || "", lines: String(f.firmAddress || "").split(/\n|,\s*(?=[A-Z])/).map(x => x.trim()).filter(Boolean).slice(0, 3)};
  },
  // what the conversation so far says, as plain text, for Claude (never the tables: the book tools give them again)
  history(){
    return this.turns().filter(t => t.done && !t.error).slice(-8).flatMap(t => [{role: "user", content: t.q}, {role: "assistant", content: this.plain(t.text).slice(0, 4000)}]);
  },
  plain(s){ return String(s || "").replace(/⟦F(\d+)⟧/g, "").replace(/\[V:([^|\]]+)\|([^\]]+)\]/g, "(voucher $1, $2)"); },
  open(q){
    const a = this.st();
    if (!this.on()){
      this.loadSettings(true).then(st => { if (st && st.enabled) this.open(q); else if (st && !st.error) toast("FinCom Assistant is switched off for the firm. The owner can switch it on in Settings › AI help."); else toast("FinCom Assistant could not be reached just now; try again in a moment."); });
      return;
    }
    a.open = true; if (q != null) a.q = q; this.draw(); setTimeout(() => { const el = document.getElementById("asstQ"); if (el) el.focus(); }, 80);
  },
  // the short notice on first use (the owner's decision of 14-Oct-2026: on by default, no consent tick; the notice instead)
  noticeSeen(){ try { return lsGet("tdsdesk:asst-notice") === "1"; } catch (e){ return false; } },
  noticeOk(){ try { lsSet("tdsdesk:asst-notice", "1"); } catch (e){} this.st().noticeOk = true; this.draw(); },
  close(){ this.st().open = false; this.draw(); },
  setScope(s){ this.st().scope = s; this.draw(); },
  async ask(q){
    const a = this.st();
    q = String(q == null ? a.q : q).trim();
    if (!q || a.busy) return;
    if (!Cloud.on()){ toast("Sign in to the firm account to use the assistant."); return; }
    const turn = {id: "t" + Date.now().toString(36), q, at: new Date().toISOString(), cid: this.cid(), live: "", text: "", labels: [], results: [], slices: [], tools: [], files: [], drafts: [],
      notice: null, screens: [], verdicts: [], links: [], unchecked: [], citations: {ok: [], dropped: []}, error: null, done: false, attach: a.attach};
    const list = this.turns(); list.push(turn);
    a.q = ""; a.busy = true; const attach = a.attach; a.attach = null; this.draw();
    this.keepCursor();
    let last = 0;
    const tick = () => { const n = Date.now(); if (n - last > 70){ last = n; this.draw(); } };
    try {
      await Cloud.fresh().catch(() => {});
      const c = Cloud.cfg(), s = Cloud.sess();
      const r = await fetch(this.url(), {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"},
        body: JSON.stringify({action: "ask", question: q, client_id: turn.cid, history: this.history(), attachments: attach ? [attach] : [], uploads: this.ups(), firm: this.letterhead(), lang: a.lang || "en-IN"})});
      if (!r.ok || !String(r.headers.get("content-type") || "").includes("event-stream")){
        const j = await r.json().catch(() => ({}));
        throw Object.assign(new Error(j.error || ("The assistant could not be reached (" + r.status + ").")), {kind: j.kind || "other"});
      }
      const rd = r.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;){
        const {done, value} = await rd.read();
        if (done) break;
        buf += dec.decode(value, {stream: true});
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0){
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!chunk.startsWith("data: ")) continue;
          let e; try { e = JSON.parse(chunk.slice(6)); } catch (x){ continue; }
          this.take(turn, e); tick();
        }
      }
    } catch (e){
      turn.error = {kind: (e && e.kind) || "other", message: (e && e.message) || "The assistant could not answer."};
    }
    turn.done = true; a.busy = false;
    if (!turn.text && turn.live) turn.text = turn.live;
    this.draw();
    if (a.open && (!document.activeElement || document.activeElement === document.body)) this.keepCursor();
    this.autosave();
  },
  // the question box keeps the cursor after a question is asked (the owner, 15-Oct-2026: "the cursor is moving differently":
  // the box was greyed out while FinCom answered, which threw the cursor out of it, and it never came back); a box the
  // user is typing in elsewhere (the "Wrong answer?" line, a filed notice's number) keeps it
  keepCursor(){
    const box = document.getElementById("asstQ"), on = document.activeElement;
    if (!box || on === box || (on && on !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(on.tagName))) return;
    try { box.focus({preventScroll: true}); } catch (e){}
  },
  // one event of the answer's stream (server/assistant/agent.ts)
  take(t, e){
    if (e.t === "text") t.live += e.d;
    else if (e.t === "tool"){ t.tools.push({name: e.name, label: e.label}); t.toolAt = t.live.length; }   // the step under way, until words come after it
    else if (e.t === "result") t.results.push(e);
    else if (e.t === "slice") t.slices.push(e);
    else if (e.t === "figures") t.verdicts = t.verdicts.concat(e.verdicts || []);
    else if (e.t === "notice"){ t.notice = e.fields; t.noticeId = e.id || null; t.checklist = e.checklist || []; t.annexures = e.annexures || []; t.noticeStatus = "received"; }
    else if (e.t === "notice_items") t.checklist = e.checklist || t.checklist;
    else if (e.t === "cases") t.cases = (t.cases || []).filter(c => !(e.cases || []).some(x => x.n === c.n)).concat(e.cases || []);
    else if (e.t === "warn") t.warn = e;
    else if (e.t === "draft"){ t.drafts.push(e); if (e.kind === "notice_reply") t.noticeStatus = "drafted"; }
    else if (e.t === "file") t.files.push(e);
    else if (e.t === "screen"){ if (!t.screens.some(x => x.screen === e.screen)) t.screens.push(e); }
    else if (e.t === "choices") t.choices = e;          // "Which one?": a button per ledger name, each asking again with it
    else if (e.t === "error") t.error = {kind: e.kind, message: e.message};
    else if (e.t === "prefile"){ t.prefile = e; this.runPrefile(t); }
    else if (e.t === "done"){ t.cached = e.cached || null; t.route = e.route || ""; if (e.cases) t.cases = e.cases; t.text = e.text || t.live; t.labels = e.labels || []; t.unchecked = e.unchecked || []; t.citations = e.citations || {ok: [], dropped: []}; t.links = e.links || []; t.verdicts = e.verdicts || t.verdicts; t.usage = e.usage; }
  },
  // "check my Q2 26Q": FinCom's own checklist (src/js/76-prefiling.js), here in the browser, on the client's books
  runPrefile(t){
    const p = t.prefile || {};
    if (!S.books || S.books.cid !== p.client || !(S.books.vouchers || []).length){ t.prefileErr = "Open " + ((S.companies[p.client] || {}).name || "the client") + "'s books to run the check (it uses the books in this browser)."; return; }
    try {
      if (p.form === "GST"){ const ym = String(p.month || "").replace(/-/g, "").slice(0, 6) || String(S.gstYm || ""); t.prefileRes = PreFile.gst(p.reg || String((CO() || {}).gstin || "").slice(0, 2), ym); }
      else { const fy = p.fy || TDS.fyOf(new Date().toISOString().slice(0, 10).replace(/-/g, "")); t.prefileRes = PreFile.tds(p.form, fy, p.quarter || TDS.qOf(new Date().toISOString().slice(0, 10).replace(/-/g, ""))); }
    } catch (e){ t.prefileErr = "The check could not run: " + ((e && e.message) || e); }
  },
  // the firm's switch (assistant_settings; the owner's decision of 14-Oct-2026: ON for every firm unless its owner switches
  // it off). The owner's report of 14-Oct-2026 ("not able to click FinCom Assistant in settings"): the setting was read
  // once, when the app first drew, and kept for good; read before the sign-in had finished it came back empty and the
  // page said "Loading…" for ever, and after a failed read the switch stayed greyed. Now an empty or failed read is
  // asked again (1, 2, 4 … 30 s), and a change of firm (another sign-in) reads it afresh.
  async loadSettings(force){
    const a = this.st();
    const firm = typeof Cloud === "object" && Cloud.st ? Cloud.st.firm || "" : "";
    if (a.settingsFirm !== firm){ a.settings = undefined; a.settingsFirm = firm; a.settingsTries = 0; }
    if (a.settings && !a.settings.error && !force) return a.settings;
    if (a.settingsBusy) return a.settingsBusy;
    if (typeof Cloud !== "object" || !Cloud.on()){ this.retrySettings(); return a.settings; }
    a.settingsBusy = (async () => {
      let st;
      try { st = await Cloud.rpc("asst_settings", {}); } catch (e){ st = {enabled: false, error: (e && e.message) || "could not be read"}; }
      if (!st || typeof st !== "object"){ a.settings = null; this.retrySettings(); }
      else { a.settings = st; a.settingsTries = 0; if (st.error) this.retrySettings(); }
      a.settingsBusy = null; this.draw(); return a.settings;
    })();
    return a.settingsBusy;
  },
  retrySettings(){
    const a = this.st();
    if (a.settingsTimer) return;
    a.settingsTries = (a.settingsTries || 0) + 1;
    const wait = Math.min(30000, 1000 * Math.pow(2, Math.min(a.settingsTries - 1, 5)));
    a.settingsTimer = setTimeout(() => { a.settingsTimer = null; this.loadSettings(true); }, wait);
  },
  async setSettings(enabled){
    try { this.st().settings = await Cloud.rpc("asst_set_settings", {p_enabled: !!enabled, p_consent: true}); toast(enabled ? "FinCom Assistant is on for the firm." : "FinCom Assistant is off for the firm."); }
    catch (e){ toast("Could not change it: " + (e && e.message)); }
    this.draw();
  },
  on(){ const st = this.st().settings; return !!(st && !st.error && st.enabled); },
  // ---------- what the answer's buttons do
  copy(t){
    const lines = [t.q, "", this.plain(t.text)];
    t.results.forEach(r => { lines.push("", r.title || r.tool); lines.push(r.columns.map(c => c.label).join("\t")); r.rows.forEach(row => lines.push(r.columns.map(c => this.cell(c, row[c.k])).join("\t"))); });
    const txt = lines.join("\n");
    (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Copied."), () => toast("Could not copy here."));
  },
  cell(c, v){ if (v == null) return ""; if (c.t === "amount") return INR.format(r2(num(v))); if (c.t === "date") return this.dmy(v); return String(v); },
  dmy(v){ const s = String(v || ""); return /^\d{4}-\d{2}-\d{2}/.test(s) ? fmtDate(s.slice(0, 10)) : s; },
  excel(t, r){
    const list = r ? [r] : t.results;
    if (!list.length){ toast("No table to export."); return; }
    FC.excel(r ? (r.title || r.tool) : "Assistant", list.map(x => [String(x.title || x.tool).slice(0, 31), [x.columns.map(c => c.label)].concat(x.rows.map(row => x.columns.map(c => c.t === "amount" || c.t === "int" || c.t === "pct" ? (row[c.k] == null ? "" : num(row[c.k])) : c.t === "date" ? this.dmy(row[c.k]) : row[c.k] == null ? "" : String(row[c.k]))))]))
      .catch(er => toast("Could not build the file: " + (er && er.message)));
  },
  // an entry of a table: Look up's "Find entries" on its number and date, in the client's books
  openEntry(row, cid){
    const id = cid || S.coId, d8 = String(row.day || row.date || "").replace(/-/g, "").slice(0, 8);
    const go = () => {
      const x = LK.st();
      Object.assign(x, {kind: "find", q: String(row.vno || row.no || ""), typ: "", from: d8 || x.from, to: d8 || x.to, heard: "", led: ""});
      FC.go("lookup"); LK.run("auto");
    };
    this.close();
    if (S.view !== "company" || S.coId !== id) openCompany(id).then(go); else go();
  },
  screen(s){
    const cid = this.cid();          // the open client: the Tally page opens on it (its link card)
    this.close();
    const m = {post_to_tally: () => goClient("post"), bills: () => goClient("bills"), bank: () => goClient("bank"), sales: () => goClient("sales"), gst_filing: () => goClient("books:gst"),
      gst_settings: () => goGstSettings ? goGstSettings() : goClient("books:gst"), tds_returns: () => goClient("books:tds"), tds_challans: () => goClient("books:tds"), tally_ledgers: () => goClient("books:ledgers"),
      tally_sync: () => { S.tallyFocus = cid || ""; navHome("tally"); }, closed_periods: () => goSettings("closed"), due_list: () => navHome("today")};
    try { (m[s] || (() => navHome("today")))(); } catch (e){ navHome("today"); }
  },
  async download(f){
    try {
      await Cloud.fresh().catch(() => {});
      const c = Cloud.cfg(), s = Cloud.sess();
      const r = await fetch(String(c.url).replace(/\/+$/, "") + "/storage/v1/object/authenticated/assistant-files/" + f.path.split("/").map(encodeURIComponent).join("/"), {headers: {apikey: c.key, Authorization: "Bearer " + s.access_token}});
      if (!r.ok) throw new Error("the file is not there any more (" + r.status + ")");
      saveFile(f.name, await r.blob());
    } catch (e){ toast("Could not download: " + (e && e.message)); }
  },
  // a notice: into the firm's private bucket (<firm>/<client>/notices/...), then attached to the next question
  async attach(file){
    const a = this.st(), cid = this.cid();
    if (!file) return;
    if (!cid){ toast("Open the client the notice is for first."); return; }
    if (!/pdf|png|jpe?g|webp/i.test(file.type || file.name)){ toast("A notice must be a PDF or a picture."); return; }
    if (file.size > 20 * 1024 * 1024){ toast("The notice is larger than 20 MB."); return; }
    a.uploading = true; this.draw();
    try {
      await Cloud.fresh().catch(() => {});
      const c = Cloud.cfg(), s = Cloud.sess(), name = String(file.name || "notice").replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80);
      const path = Cloud.st.firm + "/" + cid + "/notices/" + Date.now().toString(36) + "-" + name;
      const r = await fetch(String(c.url).replace(/\/+$/, "") + "/storage/v1/object/assistant-files/" + path.split("/").map(encodeURIComponent).join("/"),
        {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": file.type || "application/pdf"}, body: file});
      if (!r.ok) throw new Error("upload " + r.status);
      a.attach = {path, name: file.name, type: file.type || "application/pdf"};
      if (!a.q) a.q = "Read this notice: what does it ask, by when, and check it against the books. Then draft a reply.";
    } catch (e){ toast("The notice could not be stored: " + (e && e.message)); }
    a.uploading = false; this.draw();
  },
  // files for the assistant to read in this conversation (a signed balance sheet, a certificate format, a letterhead):
  // into the firm's private bucket (<firm>/<client or _firm>/uploads/...), sent with every question of the conversation;
  // the tool reads them, the model is not sent them as they are
  ups(){ const a = this.st(), k = this.key(); a.upsBy = a.upsBy || {}; return a.upsBy[k] = a.upsBy[k] || []; },
  async upload(files){
    const a = this.st(), cid = this.cid(), list = Array.from(files || []);
    if (!list.length) return;
    if (!Cloud.on()){ toast("Sign in to the firm account to upload."); return; }
    a.uploading = true; this.draw();
    for (const file of list.slice(0, 20)){
      if (!/\.(pdf|xlsx|xls|docx|png|jpe?g)$/i.test(file.name || "")){ toast(file.name + ": upload a PDF, Excel, Word or picture file."); continue; }
      if (file.size > 20 * 1024 * 1024){ toast(file.name + " is larger than 20 MB."); continue; }
      try {
        await Cloud.fresh().catch(() => {});
        const c = Cloud.cfg(), s = Cloud.sess(), name = String(file.name).replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80);
        const path = Cloud.st.firm + "/" + (cid || "_firm") + "/uploads/" + Date.now().toString(36) + "-" + name;
        const r = await fetch(String(c.url).replace(/\/+$/, "") + "/storage/v1/object/assistant-files/" + path.split("/").map(encodeURIComponent).join("/"),
          {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": file.type || "application/octet-stream"}, body: file});
        if (!r.ok) throw new Error("upload " + r.status);
        this.ups().push({path, name: file.name, type: file.type || ""});
      } catch (e){ toast(file.name + " could not be stored: " + (e && e.message)); }
    }
    a.uploading = false; this.draw();
  },
  unUpload(path){ const l = this.ups(), i = l.findIndex(x => x.path === path); if (i >= 0) l.splice(i, 1); this.draw(); },
  // the notice's reply date on the client's due list: only when the user clicks
  async addTask(t){
    const n = t.notice || {};
    if (!n.reply_by || !t.cid){ toast("This notice has no reply date to add."); return; }
    try {
      await Cloud.api("client_due_tasks", {method: "POST", body: {client_id: t.cid, title: "Reply to " + (n.form || "notice") + (n.reference ? " " + n.reference : ""), due: n.reply_by, source: "notice", ref: String(n.reference || "")}});
      t.taskAdded = true; toast("Added to the due list: reply by " + fmtDate(n.reply_by) + "."); this.draw();
    } catch (e){ toast("Could not add it: " + (e && e.message)); }
  },
  // "Wrong answer?": the owner sees it under Settings › Assistant, and the developers are told (no figures leave FinCom)
  async report(t, note){
    try {
      await Cloud.fresh().catch(() => {});
      const c = Cloud.cfg(), s = Cloud.sess();
      const entries = t.results.flatMap(r => (r.rows || []).map(x => x.guid).filter(Boolean)).concat((t.citations.ok || []).map(x => x.guid)).slice(0, 50);
      const r = await fetch(this.url(), {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + s.access_token, "Content-Type": "application/json"},
        body: JSON.stringify({action: "report", client_id: t.cid, question: t.q, note: String(note || "").slice(0, 300), tools: t.tools.map(x => x.name), entries})});
      const j = await r.json().catch(() => ({}));
      if (!j.ok) throw new Error(j.error || r.status);
      t.reported = true; toast("Thank you. The firm's owner sees it, and FinCom's developers look into it."); this.draw();
    } catch (e){ toast("Could not send it: " + (e && e.message)); }
  },
  // ---------- saved conversations (per client, or firm-wide): the firm's members see them
  async autosave(){
    const a = this.st(), k = this.key(), list = this.turns().filter(t => t.done);
    if (!list.length || !Cloud.on() || !a.saveOn) return;
    await this.save(true).catch(() => {});
  },
  async save(quiet){
    const a = this.st(), k = this.key(), cid = this.cid();
    const turns = this.turns().filter(t => t.done).map(t => ({q: t.q, at: t.at, text: t.text, labels: t.labels, results: t.results.map(r => ({tool: r.tool, title: r.title, columns: r.columns, rows: (r.rows || []).slice(0, 500), summary: r.summary, basis: r.basis, period: r.period, params: r.params})),
      files: t.files, drafts: t.drafts, notice: t.notice, noticeId: t.noticeId, checklist: t.checklist, annexures: t.annexures, cases: t.cases, verdicts: t.verdicts, links: t.links, citations: t.citations, screens: t.screens, choices: t.choices || null, unchecked: t.unchecked, error: t.error}));
    if (!turns.length){ if (!quiet) toast("Nothing to save yet."); return; }
    const title = turns[0].q.slice(0, 120);
    try {
      if (a.chatIds[k]) await Cloud.api("assistant_chats?id=eq." + a.chatIds[k], {method: "PATCH", body: {turns, title, updated_at: new Date().toISOString()}});
      else { const r = await Cloud.api("assistant_chats", {method: "POST", headers: {Prefer: "return=representation"}, body: {client_id: cid, title, turns}}); a.chatIds[k] = r && r[0] && r[0].id; }
      a.saveOn = true;
      if (!quiet) toast("Saved for " + (cid ? CO().name : "the firm") + ".");
    } catch (e){ if (!quiet) toast("Could not save: " + (e && e.message)); }
    this.draw();
  },
  async listSaved(){
    const a = this.st(), cid = this.cid();
    try { a.saved = await Cloud.api("assistant_chats?select=id,title,updated_at,client_id&order=updated_at.desc&limit=20&client_id=" + (cid ? "eq." + encodeURIComponent(cid) : "is.null")); }
    catch (e){ a.saved = []; }
    this.draw();
  },
  async loadSaved(id){
    const a = this.st();
    try {
      const r = await Cloud.api("assistant_chats?select=id,turns&id=eq." + encodeURIComponent(id));
      const row = r && r[0]; if (!row) return;
      const k = this.key();
      a.by[k] = (row.turns || []).map((t, i) => Object.assign({id: "s" + i, cid: this.cid(), live: "", tools: [], slices: [], done: true, results: [], files: [], drafts: [], screens: [], verdicts: [], links: [], unchecked: [], citations: {ok: [], dropped: []}}, t));
      a.chatIds[k] = id; a.saveOn = true; a.saved = null; this.draw();
    } catch (e){ toast("Could not open it: " + (e && e.message)); }
  },
  newChat(){ const a = this.st(), k = this.key(); a.by[k] = []; delete a.chatIds[k]; if (a.upsBy) delete a.upsBy[k]; a.saveOn = false; this.draw(); },
  // ---------- Settings › Assistant (the owner): this month's use, the monthly cap, the days, the questions, the mismatches
  async loadUsage(){
    const a = this.st();
    try { a.usage = await Cloud.rpc("asst_usage", {p_days: 30}); } catch (e){ a.usage = {error: e.message}; }
    try { a.mismatches = await Cloud.rpc("asst_mismatches", {p_limit: 200}); } catch (e){ a.mismatches = null; }
    this.draw();
  },
  // the firm's monthly cap in rupees (a calendar month, India's date; migration 96), and the rupees to a dollar (null keeps it)
  async setCap(inr, rate){
    const p = {p_inr: inr === "" || inr == null ? null : Math.max(0, Math.min(10000000, r2(num(inr)))), p_rate: rate === "" || rate == null ? null : Math.max(1, Math.min(1000, r2(num(rate))))};
    try { const r = await Cloud.rpc("asst_set_cap", p); toast("Monthly limit ₹" + INR.format(r.cap_inr) + " at ₹" + r.rate + " to the dollar."); this.loadUsage(); }
    catch (e){ toast("Could not set it: " + (e && e.message)); }
  },
  // a notice's documents: ticked as they are attached; its status, filed with the acknowledgement number (FinCom files nothing)
  async tick(t, item, done){
    if (!t.noticeId) return;
    try { const r = await Cloud.rpc("asst_notice_tick", {p_id: t.noticeId, p_item: item, p_done: !!done}); t.checklist = (r && r.checklist) || t.checklist; this.draw(); }
    catch (e){ toast("Could not change it: " + (e && e.message)); }
  },
  async noticeStatus(t, status, ack){
    if (!t.noticeId) return;
    if (status === "filed" && !String(ack || "").trim()){ toast("Type the acknowledgement number of the reply filed."); return; }
    try { const r = await Cloud.rpc("asst_notice_status", {p_id: t.noticeId, p_status: status, p_ack: ack || null}); t.noticeStatus = r.status; t.noticeAck = r.ack_no; toast(status === "filed" ? "Marked filed (" + r.ack_no + ")." : "Status: " + status + "."); this.draw(); }
    catch (e){ toast("Could not change it: " + (e && e.message)); }
  },
};
// the due list's tasks added from a notice (client_due_tasks), for app/src/parts/DueList.jsx and the client's due list
const AsstTasks = {
  cache: {}, at: 0,
  async load(){ if (!Cloud.on() || Date.now() - this.at < 60000) return; this.at = Date.now(); try { const r = await Cloud.api("client_due_tasks?select=id,client_id,title,due,done,ref&done=is.false&order=due"); this.cache = {}; (r || []).forEach(t => { (this.cache[t.client_id] = this.cache[t.client_id] || []).push(t); }); } catch (e){} },
  dueItems(co){
    setTimeout(() => { this.load().catch(() => {}); }, 0);
    return (this.cache[co.id] || []).map(t => ({kind: "task", tax: "Task", what: t.title, per: t.ref || "", due: t.due, on: "", go: {tab: "today"}}));
  },
};
// Ctrl+J opens the assistant anywhere (Ctrl+K finds a client and offers "Ask FinCom Assistant")
document.addEventListener("keydown", ev => {
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === "j" || ev.key === "J")){ ev.preventDefault(); ASST.st().open ? ASST.close() : ASST.open(); }
});
