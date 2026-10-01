/* ================================================================== */
/* Help: a searchable guide, and tickets that firms raise to FinCom  */
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
  when(iso){ return fmtDateTime(iso); },
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
      await Cloud.fresh().catch(() => {});
      let r = await put(); if (r.status === 401){ await Cloud.refreshToken(); r = await put(); }
      if (!r.ok) throw new Error("Could not upload " + f.name + " (" + r.status + ").");
      out.push({path, name: f.name, size: f.size, type: f.type || ""});
    }
    return out;
  },
  async download(path, name){
    const c = Cloud.cfg(), url = c.url.replace(/\/+$/, "") + "/storage/v1/object/support-files/" + path.split("/").map(encodeURIComponent).join("/");
    const get = () => fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token}});
    await Cloud.fresh().catch(() => {});
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

/* ---------- the guide: every "How this tab works" plus the rest of FinCom ---------- */
const GUIDE = {
  A: {
    "start": {area: "Getting started", t: "Getting started with FinCom", what: "FinCom reads purchase bills, bank statements and sales, checks them, and posts them to Tally; it also works out TDS and GST returns from the Tally books.",
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
    "tally": {area: "Tally", t: "Connecting Tally", what: "FinCom talks to Tally on this computer through Tally's own port (9000 by default).",
      steps: ["In Tally: F1 → Settings → Connectivity → TallyPrime acts as: Both, port 9000.", "Open the company in Tally.", "Click the Tally chip at the top of FinCom and check it says connected.", "Post a test entry to a ZZ TEST company first."],
      watch: ["Tally must be open with the right company when posting.", "Everything sent to Tally is listed under Tally: everything sent."]},
    "gstapi": {area: "GST", t: "Fetching from the GST portal (GST API)", what: "With the firm account, 2B can be fetched straight from the GST portal after an OTP sent to the taxpayer.",
      steps: ["On gst.gov.in the taxpayer allows API access: My Profile → Manage API Access.", "Client setup → GST: type the GST portal username for the GSTIN.", "TDS & GST → GST → 2B: Send OTP, type the OTP, Connect, then Fetch 2B."],
      watch: ["The portal session lasts a few hours and is never saved.", "Until the API is available, bring in the 2B JSON downloaded from the portal; the reconciliation is the same."]},
    "gstset": {area: "GST", t: "GST settings and GSTINs", what: "Client setup → GST keeps the client's GSTINs and each GSTIN's settings: filing type, credit basis, opening credit, rule 37, e-invoicing, portal username.",
      steps: ["Add each GSTIN; its PAN must be the client's PAN.", "Choose the GSTIN in the list to see its settings.", "When a setting changes, choose whether it is for this GSTIN only, for all, or for the ones you tick."]},
    "account": {area: "Firm account", t: "Firm account, people and credit", what: "Signing in to the firm account keeps the work in the cloud, shares it with the firm's people, and uses the firm's credit for reading documents.",
      steps: ["Sign in at the top right.", "Owners add people under Settings → People, with what each may do.", "Credit and plan are shown on the firm button; ask the administrator to top up before it runs out."]},
    "tickets": {area: "Help", t: "Raising a ticket", what: "When the guide does not answer it, raise a ticket to FinCom support. It carries the screen you were on, the client, the build and the last messages shown, so there is less back and forth.",
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
  }

};

/* ---------- the screen is app/src/screens/Help.jsx; what its buttons and boxes do ---------- */
function viewHelp(){ return '<div data-react="Help"></div>'; }
// typed or chosen: the guide's search (the best article opens), the ticket searches, the reply, the desk's filters
function supType(k, v, now){
  const s = SUP.st(); s[k] = v;
  if (k === "gq"){ const r = GUIDE.search(v); if (r[0]) s.art = r[0].k; }
  if (k === "rtext" && !now){ FinComReact.redraw(); return; }
  render();
}
function supDraft(k, v, now){ const s = SUP.st(); (s.draft = s.draft || {})[k] = v; if (now) render(); else FinComReact.redraw(); }
function supTab(id){ const s = SUP.st(); s.tab = id; s.open = null; s.newOpen = false; render(); if (id !== "guide" && SUP.on()) SUP.load(true); }
function supArt(k, go){ const s = SUP.st(); s.art = k; if (go){ s.newOpen = false; s.tab = "guide"; } render(); }
function supFilter(f){ SUP.st().filter = f; render(); }
function supDstat(k){ SUP.st().dstat = k; render(); }
function supFiles(which, files){ const s = SUP.st(); s[which] = (s[which] || []).concat(files).slice(0, 8); render(); }
function supFdel(which, i){ SUP.st()[which].splice(i, 1); render(); }
function supDl(path, name){ SUP.download(path, name).catch(err => toast(err.message)); }
async function supSet(k, v){ const s = SUP.st(); try { await SUP.set({[k]: v}); await SUP.open(s.open); SUP.load(true); toast("Saved."); } catch (err){ toast(err.message); render(); } }
async function supAct(a){
  const s = SUP.st();
  if (a === "new"){ s.newOpen = true; s.open = null; s.draft = null; s.files = []; if (!S.helpCtx) S.helpCtx = SUP.context(); render(); return; }
  if (a === "cancel"){ s.newOpen = false; s.draft = null; s.files = []; render(); return; }
  if (a === "back"){ s.open = null; s.detail = null; render(); return; }
  if (a === "reload"){ SUP.load(false); return; }
  if (a === "submit"){
    const dr = s.draft || {};
    if (String(dr.subject || "").trim().length < 3){ toast("Give the ticket a subject."); return; }
    if (String(dr.body || "").trim().length < 5){ toast("Describe what happened."); return; }
    s.busy = true; render();
    try { const tk = await SUP.create(dr); s.newOpen = false; s.draft = null; s.files = []; s.tab = "tickets"; s.busy = false; S.helpCtx = null; toast("Ticket " + SUP.code(tk) + " raised. FinCom support will answer here."); await SUP.load(true); SUP.open(tk.id); }
    catch (err){ s.busy = false; toast("Not raised: " + err.message); render(); }
    return;
  }
  if (a === "send"){
    const body = String(s.rtext || "").trim(), internal = !!s.rint;
    if (!body && !(s.rfiles || []).length){ toast("Write a reply or attach a file."); return; }
    s.busy = true; render();
    try { await SUP.reply(body, internal); s.rfiles = []; s.rtext = ""; s.rint = false; s.busy = false; await SUP.open(s.open); SUP.load(true); toast(internal ? "Note added." : "Sent."); }
    catch (err){ s.busy = false; toast("Not sent: " + err.message); render(); }
    return;
  }
  if (a === "resolve" || a === "reopen"){ try { await SUP.set({p_status: a === "resolve" ? "resolved" : "open"}); await SUP.open(s.open); SUP.load(true); } catch (err){ toast(err.message); } }
}

if (typeof document !== "undefined"){
  // what went wrong lately goes with a ticket: errors, and the messages shown at the foot of the screen
  if (typeof toast === "function"){ const shown = toast; toast = function(m){ try { SUP.note("msg", m); } catch (e){} return shown.apply(this, arguments); }; }
  window.addEventListener("error", e => SUP.note("error", (e && e.message) || "error"));
  window.addEventListener("unhandledrejection", e => SUP.note("error", (e && e.reason && (e.reason.message || e.reason)) || "rejected"));
}
