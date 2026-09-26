/* ================================================================== */
/* Help: a searchable guide, and tickets that firms raise to TDS Desk  */
/* support, with the screen's details attached and a desk for support  */
/* (platform admins) with SLA, pipeline and ageing                     */
/* ================================================================== */
// Tickets live in the firm account (Supabase: support_* functions, bucket support-files). A firm sees only its own
// tickets and never support's internal notes; the functions check that, not this screen.
const SUP = {
  MODULES: ["Purchase bills", "Bank", "Sales", "Inbox", "TDS", "GST", "GST API", "Tally connection", "Accounts, MIS, audit", "Firm account and billing", "Other"],
  CATS: [["question", "Question / how to"], ["problem", "Something is wrong"], ["request", "New feature or change"], ["data", "Data or figures look wrong"], ["billing", "Plan, credit, billing"]],
  PRI: [["low", "Low", "a question, no hurry"], ["medium", "Medium", "work slowed"], ["high", "High", "work stopped for a client"], ["urgent", "Urgent", "a due date today or tomorrow"]],
  ST: {new: "New", open: "Open", waiting: "Awaiting firm", resolved: "Resolved", closed: "Closed"},
  // what the screen was doing: errors and messages shown lately, kept only in this tab
  recent: [],
  note(kind, msg){ this.recent.push({kind, msg: String(msg || "").slice(0, 300), at: new Date().toISOString()}); if (this.recent.length > 8) this.recent.shift(); },
  st(){ S.sup = S.sup || {tab: "guide", list: null, filter: "open", q: "", gq: "", art: "", files: [], rfiles: [], dq: "", dpri: "", dfirm: "", dstat: "active"}; return S.sup; },
  admin(){ return !!(S.account && S.account.superadmin); },
  on(){ return typeof Cloud === "object" && Cloud.on() && !!S.account; },
  code(t){ return t.code || ("T-" + t.num); },
  active(t){ return ["new", "open", "waiting"].includes(t.status); },
  // the screen, the client and what went wrong lately, taken when Help is opened from somewhere
  context(){
    const co = typeof CO === "function" && S.view === "company" ? CO() : null;
    const where = S.view === "company" ? [S.tab === "books" ? "TDS & GST → " + (typeof booksTab === "function" ? booksTab() : "") + (typeof booksTab === "function" && booksTab() === "gst" ? " → " + (S.gstPart || "") : typeof booksTab === "function" && booksTab() === "tds" ? " → " + (S.tdsView || "") : "") : S.tab].filter(Boolean).join("") : "home → " + (S.homeTab || "clients");
    return {screen: where, view: S.view || "", tab: S.tab || "", client: co ? co.name : "", gstin: co ? (co.gstin || "") : "", build: APP_VERSION,
      browser: (typeof navigator !== "undefined" ? navigator.userAgent : "").replace(/\s*\(KHTML.*$/, "").slice(0, 160), at: new Date().toISOString(), recent: this.recent.slice(-6)};
  },
  moduleOf(c){
    if (!c) return "Other";
    if (c.view === "company"){
      if (c.tab === "books") return /gst/.test(c.screen) ? "GST" : /tds/.test(c.screen) ? "TDS" : "Accounts, MIS, audit";
      return ({bank: "Bank", bankset: "Bank", bankrules: "Bank", sales: "Sales", invoices: "Purchase bills", export: "Tally connection", done: "Purchase bills", clientInbox: "Inbox", gstset: "GST", settings: "Other"})[c.tab] || "Other";
    }
    return /tally/.test(c.screen) ? "Tally connection" : /inbox/.test(c.screen) ? "Inbox" : "Other";
  },
  // SLA: late past the resolve-by time; at risk in the last quarter of the window, or when the first answer is overdue
  sla(t, now){
    now = now || Date.now();
    const made = Date.parse(t.created_at), due = Date.parse(t.resolve_by), rsp = Date.parse(t.respond_by);
    if (!this.active(t)) return t.resolved_at && Date.parse(t.resolved_at) <= due ? "met" : t.resolved_at ? "late" : "met";
    if (now > due) return "late";
    if (now > due - (due - made) / 4 || (!t.first_response_at && now > rsp)) return "risk";
    return "track";
  },
  ago(iso){ const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? m + "m" : m < 48 * 60 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; },
  when(iso){ if (!iso) return "—"; const d = new Date(iso); return d.toLocaleDateString("en-IN", {day: "2-digit", month: "short", year: "numeric"}) + " " + d.toLocaleTimeString("en-IN", {hour: "2-digit", minute: "2-digit"}); },
  async load(quiet){
    const s = this.st();
    if (!this.on()) return;
    try { s.list = await Cloud.rpc("support_list"); s.err = ""; s.loadedAt = Date.now(); }
    catch (e){ s.err = e.message; if (!quiet) toast("Tickets: " + e.message); }
    render();
  },
  async open(id){
    const s = this.st(); if (s.open !== id){ s.rtext = ""; s.rfiles = []; } s.open = id; s.detail = null; render();
    try { s.detail = await Cloud.rpc("support_get", {p_ticket: id}); } catch (e){ toast(e.message); s.open = null; }
    render();
  },
  // files go under the firm's folder: for support answering, the ticket's firm
  async upload(files, firm){
    const c = Cloud.cfg(), out = [];
    for (const f of files){
      if (f.size > 10 * 1024 * 1024){ toast(f.name + " is over 10 MB and was left out."); continue; }
      const safe = String(f.name || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80), path = firm + "/" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + "-" + safe;
      const url = c.url.replace(/\/+$/, "") + "/storage/v1/object/support-files/" + path.split("/").map(encodeURIComponent).join("/");
      const put = () => fetch(url, {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token, "Content-Type": f.type || "application/octet-stream"}, body: f});
      let r = await put(); if (r.status === 401){ await Cloud.refreshToken(); r = await put(); }
      if (!r.ok) throw new Error("Could not upload " + f.name + " (" + r.status + ").");
      out.push({path, name: f.name, size: f.size, type: f.type || ""});
    }
    return out;
  },
  async download(path, name){
    const c = Cloud.cfg(), url = c.url.replace(/\/+$/, "") + "/storage/v1/object/support-files/" + path.split("/").map(encodeURIComponent).join("/");
    const get = () => fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token}});
    let r = await get(); if (r.status === 401){ await Cloud.refreshToken(); r = await get(); }
    if (!r.ok) throw new Error("The file could not be fetched (" + r.status + ").");
    const blob = await r.blob(), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name || "file"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  mail(ticket, event){ Cloud.fn("support-mail", {ticket, event}).then(r => { const s = this.st(); s.mailNote = r && r.sent ? "" : (r && r.reason) || ""; }).catch(() => {}); },
  async create(d){
    const s = this.st();
    const files = await this.upload(s.files || [], Cloud.st.firm);
    const t = await Cloud.rpc("support_new", {p_subject: d.subject, p_module: d.module, p_category: d.category, p_priority: d.priority, p_body: d.body, p_context: d.withCtx ? S.helpCtx || this.context() : {}, p_files: files});
    this.mail(t.id, "new");
    return t;
  },
  async reply(body, internal){
    const s = this.st(), t = s.detail;
    const files = await this.upload(s.rfiles || [], t.firm_id);
    await Cloud.rpc("support_reply", {p_ticket: t.id, p_body: body, p_files: files, p_internal: !!internal});
    if (!internal) this.mail(t.id, "reply");
  },
  async set(p){ const t = this.st().detail; await Cloud.rpc("support_set", Object.assign({p_ticket: t.id, p_status: null, p_priority: null, p_assignee: null}, p)); },
  counts(){
    const l = (this.st().list || []);
    return this.admin() ? l.filter(t => t.status === "new" || (t.status === "open" && t.last_by === "firm")).length : l.filter(t => t.status === "waiting").length;
  }
};

/* ---------- the guide: every "How this tab works" plus the rest of TDS Desk ---------- */
const GUIDE = {
  A: {
    "start": {area: "Getting started", t: "Getting started with TDS Desk", what: "TDS Desk reads purchase bills, bank statements and sales, checks them, and posts them to Tally; it also works out TDS and GST returns from the Tally books.",
      steps: ["Add a client under All clients, with its GSTIN and PAN.", "Connect Tally on this computer (Tally chip at the top) so entries can be posted and the day book read.", "Bring in documents: Purchase, Bank and Sales on the left.", "Review what was read, then post to Tally.", "For returns, open TDS & GST and read the day book from Tally."],
      watch: ["Work is saved in this browser unless you sign in to the firm account, which keeps it in the cloud for everyone in the firm."]},
    "bills": {area: "Documents", t: "Purchase bills", what: "Bills are read from PDFs and photos, checked against the supplier's ledger and GST, and posted to Tally as purchase or journal vouchers with TDS where it applies.",
      steps: ["Drop the bills, or send them to the client's inbox address.", "Check each bill: supplier, number, date, ledger, GST, TDS section.", "Approve, then post the approved bills to Tally from the Post step."],
      watch: ["A bill already in Tally is shown as a duplicate and not posted again.", "The TDS section and rate come from the supplier's settings under Suppliers and TDS."]},
    "bank": {area: "Documents", t: "Bank statements", what: "Statements (PDF, Excel or CSV) are read line by line; each line gets a ledger from your written rules, earlier choices and Tally's bills outstanding.",
      steps: ["Add the bank account under Client setup → Bank accounts, with its Tally ledger.", "Bring in the statement.", "Check the lines under Review; write a rule for anything that repeats.", "Post the ready lines to Tally."],
      watch: ["A statement that does not balance from opening to closing is flagged before posting.", "Lines already in Tally are matched, not posted again."]},
    "sales": {area: "Documents", t: "Sales", what: "Sales invoices and marketplace reports (Amazon, Flipkart and others) are read and posted as sales vouchers with GST by rate and place of supply.",
      steps: ["Bring in the invoices or the marketplace report.", "Check customers, rates and places of supply.", "Post to Tally."]},
    "inbox": {area: "Documents", t: "Inbox", what: "Each client has an address and a drop link; documents sent there wait in the Inbox until you sort them.",
      steps: ["Share the client's drop link or address.", "Open Inbox, check each document's client and kind, and send it on to Purchase, Bank or Sales."]},
    "tally": {area: "Tally", t: "Connecting Tally", what: "TDS Desk talks to Tally on this computer through Tally's own port (9000 by default).",
      steps: ["In Tally: F1 → Settings → Connectivity → TallyPrime acts as: Both, port 9000.", "Open the company in Tally.", "Click the Tally chip at the top of TDS Desk and check it says connected.", "Post a test entry to a ZZ TEST company first."],
      watch: ["Tally must be open with the right company when posting.", "Everything sent to Tally is listed under Tally: everything sent."]},
    "gstapi": {area: "GST", t: "Fetching from the GST portal (GST API)", what: "With the firm account, 2B can be fetched straight from the GST portal after an OTP sent to the taxpayer.",
      steps: ["On gst.gov.in the taxpayer allows API access: My Profile → Manage API Access.", "Client setup → GST: type the GST portal username for the GSTIN.", "TDS & GST → GST → 2B: Send OTP, type the OTP, Connect, then Fetch 2B."],
      watch: ["The portal session lasts a few hours and is never saved.", "Until the API is available, bring in the 2B JSON downloaded from the portal; the reconciliation is the same."]},
    "gstset": {area: "GST", t: "GST settings and GSTINs", what: "Client setup → GST keeps the client's GSTINs and each GSTIN's settings: filing type, credit basis, opening credit, rule 37, e-invoicing, portal username.",
      steps: ["Add each GSTIN; its PAN must be the client's PAN.", "Choose the GSTIN in the list to see its settings.", "When a setting changes, choose whether it is for this GSTIN only, for all, or for the ones you tick."]},
    "account": {area: "Firm account", t: "Firm account, people and credit", what: "Signing in to the firm account keeps the work in the cloud, shares it with the firm's people, and uses the firm's credit for reading documents.",
      steps: ["Sign in at the top right.", "Owners add people under Settings → People, with what each may do.", "Credit and plan are shown on the firm button; ask the administrator to top up before it runs out."]},
    "tickets": {area: "Help", t: "Raising a ticket", what: "When the guide does not answer it, raise a ticket to TDS Desk support. It carries the screen you were on, the client, the build and the last messages shown, so there is less back and forth.",
      steps: ["Open Help from the screen where the problem is.", "Help → My tickets → New ticket: a subject, the module, how urgent, and what happened.", "Attach screenshots or the file that was being read.", "Replies appear on the ticket (and by email when email is set up). Reply on the ticket, or mark it resolved."],
      watch: ["Response targets: urgent 2 hours, high 4, medium 8, low 24; resolution: urgent 8 hours, high 1 day, medium 3 days, low 5 days."]}
  },
  // the guide's articles and every tab guide, in one list
  all(){
    const out = Object.entries(this.A).map(([k, x]) => Object.assign({k, area: x.area}, x));
    if (typeof Help === "object") Object.entries(Help.T).forEach(([k, x]) => out.push(Object.assign({k: "tab:" + k, area: k.startsWith("gst") ? "GST" : "TDS"}, x)));
    return out;
  },
  text(x){ return [x.t, x.what, (x.steps || []).join(" "), x.from || "", (x.watch || []).join(" ")].join(" ").toLowerCase(); },
  search(q){
    const words = String(q || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 1);
    if (!words.length) return [];
    return this.all().map(x => { const t = x.t.toLowerCase(), all = this.text(x); let s = 0;
      words.forEach(w => { if (t.includes(w)) s += 5; const m = all.split(w).length - 1; s += Math.min(m, 4); }); return {x, s}; })
      .filter(r => r.s > 0).sort((a, b) => b.s - a.s).map(r => r.x);
  },
  html(x){
    return "<h3 style=\"margin:0 0 6px\">" + esc(x.t) + '</h3><p class="note" style="margin:0 0 8px">' + esc(x.area) + "</p><p>" + esc(x.what) + "</p>" +
      (x.steps && x.steps.length ? "<h4>What to do</h4><ol>" + x.steps.map(s => "<li>" + esc(s) + "</li>").join("") + "</ol>" : "") +
      (x.from ? "<h4>Where the figures come from</h4><p>" + esc(x.from) + "</p>" : "") +
      (x.watch && x.watch.length ? "<h4>Watch for</h4><ul>" + x.watch.map(s => "<li>" + esc(s) + "</li>").join("") + "</ul>" : "");
  }
};

/* ---------- the screen ---------- */
function supPill(kind, v){
  const lab = kind === "st" ? (SUP.ST[v] || v) : kind === "pri" ? ((SUP.PRI.find(p => p[0] === v) || [, v])[1]) : kind === "sla" ? ({track: "on track", risk: "at risk", late: "late", met: "met"})[v] : v;
  return '<span class="sp-pill sp-' + kind + "-" + esc(v) + '">' + esc(lab) + "</span>";
}
function viewHelp(){
  const s = SUP.st(), adm = SUP.admin();
  if (s.tab === "desk" && !adm) s.tab = "tickets";
  const n = SUP.counts();
  let h = '<div class="pane" style="margin-top:0"><div class="sp-head"><div><h2 style="margin:0">Help</h2><p class="note" style="margin:2px 0 0">Search the guide; if it does not answer it, raise a ticket to TDS Desk support.</p></div>' +
    (SUP.on() ? '<button class="btn primary" data-sup="new">+ New ticket</button>' : "") + "</div>" +
    '<nav class="sbar" aria-label="Help">' + [["guide", "Guide"], ["tickets", "My tickets", !adm && n ? n : null]].concat(adm ? [["desk", "Support desk", n || null]] : [])
      .map(([id, l, c]) => '<button data-suptab="' + id + '" aria-selected="' + (s.tab === id) + '">' + l + (c ? ' <span class="sbar-n">' + c + "</span>" : "") + "</button>").join("") + "</nav>";
  if (s.newOpen) h += viewSupNew();
  else if (s.open) h += viewSupTicket();
  else if (s.tab === "guide") h += viewSupGuide();
  else if (!SUP.on()) h += '<div class="bk-none">Sign in to the firm account (top right) to raise tickets and follow them. The guide works without it.</div>';
  else if (s.list === null){ if (!s.loading){ s.loading = true; SUP.load(true).then(() => { s.loading = false; render(); }); } h += '<p class="note">Reading tickets…</p>'; }
  else h += s.tab === "desk" ? viewSupDesk() : viewSupMine();
  return h + "</div>";
}
function viewSupGuide(){
  const s = SUP.st(), q = s.gq || "", hits = q ? GUIDE.search(q) : null, all = GUIDE.all(), art = all.find(x => x.k === s.art);
  let h = '<div class="sp-guide"><div class="sp-gleft"><input type="search" data-supgq data-fk="supgq" data-keeptyped value="' + esc(q) + '" placeholder="Search: 2B, rule 37, challan, Tally port…" style="width:100%">';
  const list = hits || all;
  if (hits && !hits.length) h += '<p class="note">Nothing in the guide for “' + esc(q) + "”.</p>";
  const areas = Array.from(new Set(list.map(x => x.area)));
  h += (hits ? [["Results", list.slice(0, 20)]] : areas.map(a => [a, list.filter(x => x.area === a)])).map(([a, xs]) =>
    '<h4 class="sp-area">' + esc(a) + "</h4>" + xs.map(x => '<button class="sp-art' + (x.k === s.art ? " on" : "") + '" data-supart="' + esc(x.k) + '">' + esc(x.t) + "</button>").join("")).join("");
  h += '</div><div class="sp-gright">' + (art ? GUIDE.html(art) : '<p class="note">Choose a topic on the left, or search.</p>') +
    '<div class="sp-still"><b>Did not find the answer?</b> ' + (SUP.on() ? '<button class="btn small" data-sup="new">Raise a ticket</button>' : '<span class="note">Sign in to the firm account to raise a ticket.</span>') + "</div></div></div>";
  return h;
}
function supRow(t, adm){
  return '<tr data-supopen="' + esc(t.id) + '" class="sp-row"><td class="sp-id">' + esc(SUP.code(t)) + "</td><td>" + esc(t.subject) + (adm ? '<div class="note">' + esc(t.firm_name || "") + " · " + esc(t.created_name || t.created_email || "") + "</div>" : "") +
    "</td><td>" + esc(t.module) + "</td><td>" + supPill("pri", t.priority) + "</td><td>" + supPill("st", t.status) + (t.status === "open" && t.last_by === "firm" && adm ? ' <span class="note">firm replied</span>' : "") +
    "</td><td>" + supPill("sla", SUP.sla(t)) + '</td><td class="dt" title="' + esc(SUP.when(t.updated_at)) + '">' + esc(fmtDate(String(t.updated_at).slice(0, 10))) + "</td></tr>";
}
function viewSupMine(){
  const s = SUP.st(), l = s.list || [], d30 = Date.now() - 30 * 864e5;
  const mine = l.filter(t => SUP.active(t)), wait = l.filter(t => t.status === "waiting"), done = l.filter(t => !SUP.active(t) && Date.parse(t.resolved_at || t.updated_at) > d30);
  let h = '<div class="dash-tiles" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-top:12px">' +
    '<button class="dtile" data-supf="open"><span>My open</span><b>' + mine.length + "</b><small>in progress</small></button>" +
    '<button class="dtile' + (wait.length ? " warn" : "") + '" data-supf="waiting"><span>Awaiting me</span><b>' + wait.length + "</b><small>support replied; your answer is needed</small></button>" +
    '<button class="dtile" data-supf="closed"><span>Resolved · 30 days</span><b>' + done.length + "</b><small>last 30 days</small></button></div>";
  const f = s.filter || "open", q = String(s.q || "").toLowerCase();
  const shown = l.filter(t => (f === "all" || (f === "open" ? SUP.active(t) : f === "waiting" ? t.status === "waiting" : !SUP.active(t))) && (!q || (SUP.code(t) + " " + t.subject + " " + t.module).toLowerCase().includes(q)));
  h += supToolbar([["open", "Open", l.filter(SUP.active).length], ["waiting", "Awaiting me", wait.length], ["closed", "Closed", l.filter(t => !SUP.active(t)).length], ["all", "All", l.length]], f, s.q);
  h += shown.length ? '<div class="bk-tablewrap"><table class="bk-table sp-table"><thead><tr><th>ID</th><th>Subject</th><th>Module</th><th>Priority</th><th>Status</th><th>SLA</th><th class="dt">Updated</th></tr></thead><tbody>' + shown.map(t => supRow(t, false)).join("") + "</tbody></table></div>"
    : '<p class="note">' + (l.length ? "No tickets here." : "No tickets yet. Raise one with + New ticket; it goes to TDS Desk support.") + "</p>";
  return h;
}
function supToolbar(chips, f, q){
  return '<div class="sp-bar"><div class="sp-chips">' + chips.map(([k, l, c]) => '<button data-supf="' + k + '" class="' + (f === k ? "on" : "") + '">' + l + ' <span>' + c + "</span></button>").join("") + "</div>" +
    '<input type="search" data-supq data-fk="supq" data-keeptyped value="' + esc(q || "") + '" placeholder="Search tickets…" style="width:240px">' +
    '<button class="btn small" data-sup="reload" title="Read again">↻</button></div>';
}
function viewSupDesk(){
  const s = SUP.st(), l = s.list || [], now = Date.now(), d30 = now - 30 * 864e5;
  const open = l.filter(SUP.active), sla = {met: 0, risk: 0, late: 0, track: 0};
  open.forEach(t => sla[SUP.sla(t, now)]++);
  l.filter(t => !SUP.active(t) && Date.parse(t.resolved_at || t.updated_at) > d30).forEach(t => sla[SUP.sla(t, now)]++);
  const judged = sla.met + sla.late + sla.track + sla.risk, health = judged ? Math.round(100 * (sla.met + sla.track) / judged) : 100;
  const win = l.filter(t => Date.parse(t.created_at) > d30), closedWin = win.filter(t => !SUP.active(t));
  const firstRsp = l.filter(t => t.first_response_at && Date.parse(t.created_at) > d30).map(t => (Date.parse(t.first_response_at) - Date.parse(t.created_at)) / 36e5);
  const avgRsp = firstRsp.length ? firstRsp.reduce((a, b) => a + b, 0) / firstRsp.length : null;
  // opened and closed, week by week, for eight weeks
  const wk = []; for (let i = 7; i >= 0; i--){ const a = now - (i + 1) * 7 * 864e5, b = now - i * 7 * 864e5;
    wk.push({lab: new Date(a).toLocaleDateString("en-IN", {day: "2-digit", month: "short"}), o: l.filter(t => { const c = Date.parse(t.created_at); return c > a && c <= b; }).length,
      c: l.filter(t => { const c = Date.parse(t.resolved_at || ""); return c > a && c <= b; }).length}); }
  const top = Math.max(1, ...wk.map(w => Math.max(w.o, w.c)));
  let h = '<div class="sp-desk">' +
    '<div class="sp-card sp-now"><div class="sp-kick">OPEN NOW</div><div class="sp-big">' + open.length + " <small>tickets</small></div>" +
      '<div class="sp-kick" style="margin-top:14px">SLA HEALTH <b style="float:right">' + health + "%</b></div>" +
      '<div class="sp-health"><i style="width:' + health + '%"></i></div>' +
      '<div class="note">' + ["track", "risk", "late"].map(k => '<span class="sp-dot sp-d-' + k + '"></span>' + sla[k] + " " + ({track: "on track", risk: "at risk", late: "late"})[k]).join("   ") + "   " + sla.met + " met</div></div>" +
    '<div class="sp-card sp-kpis">' + [["Opened · 30 days", win.length, ""], ["Closed · 30 days", closedWin.length, win.length ? Math.round(100 * closedWin.length / win.length) + "% of opened" : ""],
      ["SLA breached", open.filter(t => SUP.sla(t, now) === "late").length, "open and past due"], ["First reply", avgRsp == null ? "—" : avgRsp < 1 ? Math.round(avgRsp * 60) + "m" : avgRsp.toFixed(1) + "h", "average, 30 days"]]
      .map(([a, b, c]) => '<div><div class="sp-kick">' + a.toUpperCase() + '</div><div class="sp-mid">' + b + '</div><div class="note">' + c + "</div></div>").join("") +
      '<div class="sp-chart" aria-label="Opened and closed by week">' + wk.map(w => '<div class="sp-wk"><div class="sp-bars"><i class="o" style="height:' + Math.round(60 * w.o / top) + 'px" title="' + w.o + ' opened"></i><i class="c" style="height:' + Math.round(60 * w.c / top) + 'px" title="' + w.c + ' closed"></i></div><small>' + w.lab + "</small></div>").join("") +
      '</div><div class="note"><span class="sp-dot sp-d-o"></span>opened <span class="sp-dot sp-d-c"></span>closed · last 8 weeks</div></div></div>';
  // where the open tickets sit
  const pipe = ["new", "open", "waiting"].map(k => [k, open.filter(t => t.status === k).length]).filter(x => x[1]);
  h += '<div class="sp-card"><b>Pipeline · where ' + open.length + " open tickets sit</b>" + (pipe.length ? '<div class="sp-pipe">' + pipe.map(([k, c]) => '<button data-supdstat="' + k + '" class="sp-p-' + k + '" style="flex:' + c + '"><b>' + c + "</b><small>" + SUP.ST[k] + "</small></button>").join("") + "</div>" : '<p class="note">Nothing open.</p>') + "</div>";
  // firms, resolution time, oldest
  const byFirm = {}; open.forEach(t => { byFirm[t.firm_name || "?"] = (byFirm[t.firm_name || "?"] || 0) + 1; });
  const firms = Object.entries(byFirm).sort((a, b) => b[1] - a[1]).slice(0, 6), fmax = Math.max(1, ...firms.map(f => f[1]));
  const res = SUP.PRI.map(([k, lab]) => { const xs = l.filter(t => t.priority === k && t.resolved_at && Date.parse(t.resolved_at) > d30).map(t => (Date.parse(t.resolved_at) - Date.parse(t.created_at)) / 36e5); return [lab, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null, xs.length]; });
  h += '<div class="sp-two"><div class="sp-card"><b>Firms by open tickets</b>' + (firms.length ? firms.map(([f, c]) => '<div class="sp-hbar"><span>' + esc(f) + '</span><i style="width:' + Math.round(100 * c / fmax) + '%"></i><b>' + c + "</b></div>").join("") : '<p class="note">None open.</p>') + "</div>" +
    '<div class="sp-card"><b>Average time to resolve · 30 days</b>' + (res.some(r => r[2]) ? res.map(([lab, v, n2]) => '<div class="dash-row"><span>' + lab + '</span><b>' + (v == null ? "—" : v < 24 ? v.toFixed(1) + " h" : (v / 24).toFixed(1) + " days") + (n2 ? ' <small class="note">(' + n2 + ")</small>" : "") + "</b></div>").join("") : '<p class="note">Nothing resolved in the last 30 days.</p>') + "</div></div>";
  const old = open.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(0, 5);
  h += '<div class="sp-card"><b>Oldest open</b>' + (old.length ? '<div class="bk-tablewrap"><table class="bk-table sp-table"><thead><tr><th>ID</th><th>Subject</th><th>Firm</th><th>Owner</th><th>Status</th><th>Age</th><th>SLA</th></tr></thead><tbody>' +
    old.map(t => '<tr class="sp-row" data-supopen="' + esc(t.id) + '"><td class="sp-id">' + esc(SUP.code(t)) + "</td><td>" + esc(t.subject) + "</td><td>" + esc(t.firm_name || "") + "</td><td>" + esc(t.assignee || "—") + "</td><td>" + supPill("st", t.status) + "</td><td>" + SUP.ago(t.created_at) + "</td><td>" + supPill("sla", SUP.sla(t, now)) + "</td></tr>").join("") + "</tbody></table></div>" : '<p class="note">Nothing open.</p>') + "</div>";
  // the register
  const q = String(s.dq || "").toLowerCase(), st = s.dstat || "active";
  const shown = l.filter(t => (st === "all" || (st === "active" ? SUP.active(t) : st === "done" ? !SUP.active(t) : t.status === st)) && (!s.dpri || t.priority === s.dpri) && (!s.dfirm || t.firm_id === s.dfirm) &&
    (!q || (SUP.code(t) + " " + t.subject + " " + t.module + " " + (t.firm_name || "") + " " + (t.created_name || "")).toLowerCase().includes(q)));
  const firmList = Array.from(new Map(l.map(t => [t.firm_id, t.firm_name || "?"])).entries());
  h += '<div class="sp-card"><b>All tickets</b><div class="sp-bar"><div class="sp-chips">' + [["active", "Open"], ["new", "New"], ["open", "Firm replied"], ["waiting", "Awaiting firm"], ["done", "Closed"], ["all", "All"]]
      .map(([k, lb]) => '<button data-supdstat="' + k + '" class="' + (st === k ? "on" : "") + '">' + lb + "</button>").join("") + "</div>" +
    '<select data-supdpri style="width:auto"><option value="">Any priority</option>' + SUP.PRI.map(([k, lb]) => '<option value="' + k + '"' + (s.dpri === k ? " selected" : "") + ">" + lb + "</option>").join("") + "</select>" +
    '<select data-supdfirm style="width:auto"><option value="">All firms</option>' + firmList.map(([id, n]) => '<option value="' + esc(id) + '"' + (s.dfirm === id ? " selected" : "") + ">" + esc(n) + "</option>").join("") + "</select>" +
    '<input type="search" data-supdq data-fk="supdq" data-keeptyped value="' + esc(s.dq || "") + '" placeholder="Search…" style="width:200px"><button class="btn small" data-sup="reload" title="Read again">↻</button></div>' +
    (shown.length ? '<div class="bk-tablewrap"><table class="bk-table sp-table"><thead><tr><th>ID</th><th>Subject</th><th>Module</th><th>Priority</th><th>Status</th><th>SLA</th><th class="dt">Updated</th></tr></thead><tbody>' + shown.map(t => supRow(t, true)).join("") + "</tbody></table></div>" : '<p class="note">No tickets here.</p>') + "</div>";
  return h;
}
function viewSupNew(){
  const s = SUP.st(), c = S.helpCtx || SUP.context(), d = s.draft || (s.draft = {module: SUP.moduleOf(c), category: "problem", priority: "medium", withCtx: true, subject: s.gq || "", body: ""});
  const sugg = d.subject && d.subject.length > 3 ? GUIDE.search(d.subject).slice(0, 3) : [];
  return '<div class="sp-card" style="margin-top:12px"><div class="sp-head"><h3 style="margin:0">New ticket to TDS Desk support</h3><button class="linkbtn" data-sup="cancel">Cancel</button></div>' +
    '<label class="sp-f"><span>Subject</span><input type="text" data-supd="subject" data-fk="supd-subject" data-keeptyped maxlength="200" value="' + esc(d.subject) + '" placeholder="In a line: what is wrong or what you need"></label>' +
    (sugg.length ? '<div class="sp-sugg"><span class="note">The guide may answer it:</span> ' + sugg.map(x => '<button class="linkbtn" data-supart="' + esc(x.k) + '" data-supgo>' + esc(x.t) + "</button>").join(" · ") + "</div>" : "") +
    '<div class="sp-grid"><label class="sp-f"><span>Module</span><select data-supd="module">' + SUP.MODULES.map(m => "<option" + (d.module === m ? " selected" : "") + ">" + esc(m) + "</option>").join("") + "</select></label>" +
    '<label class="sp-f"><span>Kind</span><select data-supd="category">' + SUP.CATS.map(([k, l]) => '<option value="' + k + '"' + (d.category === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
    '<label class="sp-f"><span>How urgent</span><select data-supd="priority">' + SUP.PRI.map(([k, l, n]) => '<option value="' + k + '"' + (d.priority === k ? " selected" : "") + ">" + l + " — " + n + "</option>").join("") + "</select></label></div>" +
    '<label class="sp-f"><span>What happened</span><textarea data-supd="body" data-fk="supd-body" data-keeptyped rows="7" placeholder="What you did, what you expected, what happened instead. The exact message helps.">' + esc(d.body) + "</textarea></label>" +
    '<div class="sp-files">' + supFileList(s.files, "files") + '<label class="btn small">Attach screenshots or files<input type="file" multiple data-supfile="files" hidden accept="image/*,.pdf,.xml,.json,.xlsx,.xls,.csv,.txt,.zip"></label> <span class="note">up to 10 MB each</span></div>' +
    '<label class="chk" style="margin-top:10px"><input type="checkbox" data-supd="withCtx"' + (d.withCtx ? " checked" : "") + "> Attach the screen’s details</label>" +
    (d.withCtx ? '<div class="sp-ctx">' + supCtx(c) + "</div>" : "") +
    '<div class="row" style="justify-content:flex-end;gap:8px;margin-top:12px"><button class="btn" data-sup="cancel">Cancel</button><button class="btn primary" data-sup="submit"' + (s.busy ? " disabled" : "") + ">" + (s.busy ? "Sending…" : "Raise ticket") + "</button></div></div>";
}
function supCtx(c){
  if (!c || !Object.keys(c).length) return '<span class="note">No screen details.</span>';
  return [["Screen", c.screen], ["Client", c.client ? c.client + (c.gstin ? " · " + c.gstin : "") : ""], ["Build", c.build], ["Browser", c.browser]].filter(x => x[1]).map(([a, b]) => '<div><span class="note">' + a + "</span> " + esc(b) + "</div>").join("") +
    ((c.recent || []).length ? '<div><span class="note">Last messages</span><ul>' + c.recent.map(r => "<li>" + esc(r.kind === "error" ? "Error: " + r.msg : r.msg) + "</li>").join("") + "</ul></div>" : "");
}
function supFileList(list, which){
  return (list || []).map((f, i) => '<span class="sp-file">' + esc(f.name) + ' <small>' + Math.max(1, Math.round(f.size / 1024)) + ' KB</small> <button class="linkbtn" data-supfdel="' + which + "|" + i + '" aria-label="Remove">✕</button></span>').join("");
}
function viewSupTicket(){
  const s = SUP.st(), t = s.detail, adm = SUP.admin();
  if (!t) return '<p class="note">Opening the ticket…</p>';
  const sla = SUP.sla(t);
  let h = '<div class="sp-card" style="margin-top:12px"><button class="linkbtn" data-sup="back">← All tickets</button>' +
    '<div class="sp-thead"><div><div class="note">' + esc(SUP.code(t)) + " · " + esc(t.module) + " · " + esc((SUP.CATS.find(c => c[0] === t.category) || [, t.category])[1]) + '</div><h3 style="margin:2px 0 6px;font-size:20px">' + esc(t.subject) + "</h3>" +
      supPill("st", t.status) + " " + supPill("pri", t.priority) + " " + supPill("sla", sla) +
      '<div class="note" style="margin-top:6px">' + (adm ? "<b>" + esc(t.firm_name || "") + "</b> · " : "") + "raised by " + esc(t.created_name || t.created_email || "") + " on " + esc(SUP.when(t.created_at)) +
      (SUP.active(t) ? " · answer by " + esc(SUP.when(t.first_response_at ? t.resolve_by : t.respond_by)) : t.resolved_at ? " · resolved " + esc(SUP.when(t.resolved_at)) : "") + "</div></div>";
  if (adm) h += '<div class="sp-admin"><label class="sp-f"><span>Status</span><select data-supset="p_status">' + Object.entries(SUP.ST).map(([k, l]) => '<option value="' + k + '"' + (t.status === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
    '<label class="sp-f"><span>Priority</span><select data-supset="p_priority">' + SUP.PRI.map(([k, l]) => '<option value="' + k + '"' + (t.priority === k ? " selected" : "") + ">" + l + "</option>").join("") + "</select></label>" +
    '<label class="sp-f"><span>Owner</span><input type="text" data-supset="p_assignee" data-fk="supset-owner" data-keeptyped value="' + esc(t.assignee || "") + '" placeholder="who is on it" style="width:140px"></label></div>';
  else h += "<div>" + (SUP.active(t) ? '<button class="btn small" data-sup="resolve">Mark resolved</button>' : '<button class="btn small" data-sup="reopen">Open it again</button>') + "</div>";
  h += "</div>";
  const c = t.context || {};
  if (Object.keys(c).length) h += '<details class="sp-ctx"' + (adm ? " open" : "") + "><summary>Screen details sent with the ticket</summary>" + supCtx(c) + "</details>";
  h += '<div class="sp-thread">' + (t.thread || []).map(m => '<div class="sp-msg' + (m.from_support ? " sup" : "") + (m.internal ? " int" : "") + '"><div class="sp-mhead"><b>' + esc(m.author_name || (m.from_support ? "TDS Desk support" : "Firm")) + "</b>" +
    (m.from_support ? ' <span class="note">TDS Desk support</span>' : "") + (m.internal ? ' <span class="sp-pill sp-int">internal note — the firm does not see it</span>' : "") + '<span class="note" style="margin-left:auto">' + esc(SUP.when(m.created_at)) + "</span></div>" +
    '<div class="sp-body">' + esc(m.body).replace(/\n/g, "<br>") + "</div>" +
    ((m.files || []).length ? '<div class="sp-mfiles">' + m.files.map(f => '<button class="sp-file" data-supdl="' + esc(f.path) + '" data-supdln="' + esc(f.name) + '">\u{1F4CE} ' + esc(f.name) + " <small>" + Math.max(1, Math.round((f.size || 0) / 1024)) + " KB</small></button>").join("") + "</div>" : "") + "</div>").join("") + "</div>";
  h += '<div class="sp-card"><label class="sp-f"><span>' + (adm ? "Reply to the firm" : "Reply") + '</span><textarea data-supr data-fk="supr" data-keeptyped rows="4" placeholder="' + (adm ? "Your answer" : "Add details, answer support’s question") + '">' + esc(s.rtext || "") + "</textarea></label>" +
    '<div class="sp-files">' + supFileList(s.rfiles, "rfiles") + '<label class="btn small">Attach<input type="file" multiple data-supfile="rfiles" hidden></label></div>' +
    '<div class="row" style="justify-content:flex-end;gap:10px;margin-top:8px;align-items:center">' + (adm ? '<label class="chk"><input type="checkbox" data-supint> Internal note (the firm does not see it)</label>' : "") +
    '<button class="btn primary" data-sup="send"' + (s.busy ? " disabled" : "") + ">" + (s.busy ? "Sending…" : "Send") + "</button></div>" +
    (s.mailNote && adm ? '<p class="note">Email: ' + esc(s.mailNote) + "</p>" : "") + "</div>";
  return h;
}

if (typeof document !== "undefined"){
  // what went wrong lately goes with a ticket: errors, and the messages shown at the foot of the screen
  if (typeof toast === "function"){ const shown = toast; toast = function(m){ try { SUP.note("msg", m); } catch (e){} return shown.apply(this, arguments); }; }
  window.addEventListener("error", e => SUP.note("error", (e && e.message) || "error"));
  window.addEventListener("unhandledrejection", e => SUP.note("error", (e && e.reason && (e.reason.message || e.reason)) || "rejected"));
  // Help opened from a screen: remember the screen before the view changes (capture runs first)
  document.addEventListener("click", e => { const t = e.target.closest('[data-nav="help"]'); if (t && !(S.view === "home" && S.homeTab === "help")) S.helpCtx = SUP.context(); }, true);
  document.addEventListener("input", e => {
    const t = e.target, s = SUP.st(); if (!t.dataset) return;
    if (t.dataset.supgq !== undefined){ s.gq = t.value; const r = GUIDE.search(t.value); if (r[0]) s.art = r[0].k; render(); return; }
    if (t.dataset.supq !== undefined){ s.q = t.value; render(); return; }
    if (t.dataset.supdq !== undefined){ s.dq = t.value; render(); return; }
    if (t.dataset.supr !== undefined){ s.rtext = t.value; return; }
    if (t.dataset.supd && t.type !== "checkbox" && t.tagName !== "SELECT"){ (s.draft = s.draft || {})[t.dataset.supd] = t.value; if (t.dataset.supd === "subject") render(); }
  });
  document.addEventListener("change", async e => {
    const t = e.target, s = SUP.st(); if (!t.dataset) return;
    if (t.dataset.supd && (t.type === "checkbox" || t.tagName === "SELECT")){ (s.draft = s.draft || {})[t.dataset.supd] = t.type === "checkbox" ? t.checked : t.value; render(); return; }
    if (t.dataset.supfile){ s[t.dataset.supfile] = (s[t.dataset.supfile] || []).concat(Array.from(t.files || [])).slice(0, 8); t.value = ""; render(); return; }
    if (t.dataset.supdpri !== undefined){ s.dpri = t.value; render(); return; }
    if (t.dataset.supdfirm !== undefined){ s.dfirm = t.value; render(); return; }
    if (t.dataset.supset){ try { await SUP.set({[t.dataset.supset]: t.value.trim ? t.value.trim() : t.value}); await SUP.open(s.open); SUP.load(true); toast("Saved."); } catch (err){ toast(err.message); render(); } return; }
  });
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-sup],[data-suptab],[data-supart],[data-supopen],[data-supf],[data-supdstat],[data-supfdel],[data-supdl]"); if (!t) return;
    const s = SUP.st(), d = t.dataset;
    if (d.suptab){ s.tab = d.suptab; s.open = null; s.newOpen = false; render(); if (d.suptab !== "guide" && SUP.on()) SUP.load(true); return; }
    if (d.supart){ s.art = d.supart; if (d.supgo !== undefined){ s.newOpen = false; s.tab = "guide"; } render(); return; }
    if (d.supopen){ SUP.open(d.supopen); return; }
    if (d.supf){ s.filter = d.supf; render(); return; }
    if (d.supdstat){ s.dstat = d.supdstat; render(); return; }
    if (d.supfdel){ const [w, i] = d.supfdel.split("|"); s[w].splice(+i, 1); render(); return; }
    if (d.supdl){ SUP.download(d.supdl, d.supdln).catch(err => toast(err.message)); return; }
    const a = d.sup;
    if (a === "new"){ s.newOpen = true; s.open = null; s.draft = null; s.files = []; if (!S.helpCtx) S.helpCtx = SUP.context(); render(); return; }
    if (a === "cancel"){ s.newOpen = false; s.draft = null; s.files = []; render(); return; }
    if (a === "back"){ s.open = null; s.detail = null; render(); return; }
    if (a === "reload"){ SUP.load(false); return; }
    if (a === "submit"){
      const dr = s.draft || {};
      if (String(dr.subject || "").trim().length < 3){ toast("Give the ticket a subject."); return; }
      if (String(dr.body || "").trim().length < 5){ toast("Describe what happened."); return; }
      s.busy = true; render();
      try { const tk = await SUP.create(dr); s.newOpen = false; s.draft = null; s.files = []; s.tab = "tickets"; s.busy = false; S.helpCtx = null; toast("Ticket " + SUP.code(tk) + " raised. TDS Desk support will answer here."); await SUP.load(true); SUP.open(tk.id); }
      catch (err){ s.busy = false; toast("Not raised: " + err.message); render(); }
      return;
    }
    if (a === "send"){
      const ta = document.querySelector("[data-supr]"), body = ta ? ta.value.trim() : "", internal = !!(document.querySelector("[data-supint]") || {}).checked;
      if (!body && !(s.rfiles || []).length){ toast("Write a reply or attach a file."); return; }
      s.busy = true; render();
      try { await SUP.reply(body, internal); s.rfiles = []; s.rtext = ""; if (ta) ta.value = ""; s.busy = false; await SUP.open(s.open); SUP.load(true); toast(internal ? "Note added." : "Sent."); }
      catch (err){ s.busy = false; toast("Not sent: " + err.message); render(); }
      return;
    }
    if (a === "resolve" || a === "reopen"){ try { await SUP.set({p_status: a === "resolve" ? "resolved" : "open"}); await SUP.open(s.open); SUP.load(true); } catch (err){ toast(err.message); } return; }
  });
}
