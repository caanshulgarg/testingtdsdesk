/* ================================================================== */
/* The layout: a sidebar, and each client as Collect, Review, Post,    */
/* Done. The screens inside are the ones the app already has.          */
/* ================================================================== */
const NAV = [
  ["today", "Today", '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>'],
  ["clients", "Clients", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.6.2 4.6 1.9 5.3 5.4"/>'],
  ["inbox", "Inbox", '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>'],
  ["tally", "Tally", '<path d="M4 12h12"/><path d="M12 6l6 6-6 6"/><path d="M20 4v16"/>'],
  ["rules", "Settings", '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>']
];
function inboxTotal(){ return Object.values(S.docq || {}).filter(d => d.status === "waiting").length + Object.keys(S.inbox || {}).length; }
function renderSide(){
  const side = document.getElementById("side");
  if (!side) return;
  if (signInNeeded()){ side.innerHTML = ""; side.classList.add("hidden"); return; }
  side.classList.remove("hidden");
  const co = CO(), inCo = S.view === "company" && co, open = co || (S.coId && S.companies[S.coId]);
  const st = open ? (open.stats || {}) : {};
  const icon = d => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">' + d + "</svg>";
  const ICONS = {
    dash: '<path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z"/>',
    bills: '<path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
    bank: '<path d="M3 10l9-6 9 6"/><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>',
    sales: '<path d="M4 17l5-5 4 4 7-7"/><path d="M14 9h6v6"/>',
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>',
    setup: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="8" cy="18" r="2"/>',
    txn: '<path d="M4 5h16v14H4z"/><path d="M4 9h16M9 9v10"/>',
    books: '<path d="M5 4h9l5 5v11H5z"/><path d="M13 4v5h5"/><path d="M8 13h7M8 17h5"/>',
    clients: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.6.2 4.6 1.9 5.3 5.4"/>'
  };
  const item = (id, label, on, n, kind, attr) => '<button class="side-link" ' + (attr || ("data-nav=\"" + id + "\"")) + (on ? ' aria-current="page"' : "") + ">" +
    icon(ICONS[kind || id]) + "<span>" + label + "</span>" + (n ? '<span class="side-count">' + n + "</span>" : "") + "</button>";
  const mod = inCo ? docType() : "";
  const onDash = inCo && S.tab === "dash";
  let h = '<div class="side-brand">TDS Desk</div>';
  if (open){
    h += '<div class="side-client"><span class="side-label">Client</span><button class="side-co" data-act="switch" title="Change client (F3)"><b>' + esc(open.name) + "</b><small>" + esc(open.gstin || "No GSTIN") + " \u00b7 change</small></button></div>" +
      item("dash", "Dashboard", onDash, 0, "dash", 'data-goclient="dash"') +
      item("bills", "Purchase", inCo && mod === "bills" && !onDash && !isSetupTab(S.tab), st.drafts || 0, "bills", 'data-goclient="bills"') +
      item("bank", "Bank", inCo && mod === "bank" && !isSetupTab(S.tab), S.bank && S.bank.cid === open.id ? tabCounts(S.bank.rows).review : 0, "bank", 'data-goclient="bank"') +
      item("sales", "Sales", inCo && mod === "sales" && !isSetupTab(S.tab), 0, "sales", 'data-goclient="sales"') +
      item("inbox", "Inbox", inCo && S.tab === "clientInbox", docqCount(open.id), "inbox", 'data-goclient="inbox"') +
      item("txn", "Transactions", inCo && S.tab === "txn", 0, "txn", 'data-goclient="txn"') +
      item("books", "TDS & GST", inCo && S.tab === "books", 0, "books", 'data-goclient="books"') +
      item("setup", "Client setup", inCo && isSetupTab(S.tab), 0, "setup", 'data-act="setup"');
  }
  h += '<div class="side-sep"></div>' + item("clients", "All clients", S.view === "home" && S.homeTab !== "rules", 0, "clients");
  h += '<div class="side-grow"></div><div class="side-ver">' + esc(APP_VERSION.split("\u00b7")[1] || APP_VERSION) + "</div>";
  side.innerHTML = h;
}
/* ---------- which step and which kind of document a client is showing ---------- */
function docType(){ return ["export", "done"].includes(S.tab) ? (S.postFocus || "bills") : S.tab === "bank" ? "bank" : S.tab === "sales" ? "sales" : "bills"; }
function curStep(){
  if (S.step === "collect") return "collect";
  if (S.tab === "export") return "post";
  if (S.tab === "done") return "done";
  const t = docType();
  if (t === "bills") return S.tab === "export" ? "post" : ["approved", "rejected"].includes(S.filter) ? "done" : "review";
  if (t === "bank"){ const f = (S.bank && S.bank.filter) || "review"; return f === "ready" ? "post" : ["done", "all"].includes(f) ? "done" : "review"; }
  return "review";
}
function goStep(step, type){
  type = type || docType();
  S.step = step === "collect" ? "collect" : null;
  S.selected = null; S.reviewTable = (step === "review" && type === "bills"); S.drawerOpen = false;
  if (step === "post" || step === "done"){
    S.tab = step === "post" ? "export" : "done"; S.postFocus = type;
    if (!S.bank || S.bank.cid !== S.coId) loadBank(S.coId).then(() => render());
    render(); window.scrollTo(0, 0);
    if (step === "post" && type !== "bills") setTimeout(() => { const el = document.getElementById("post-" + type); if (el) el.scrollIntoView({block: "start"}); }, 50);
    return;
  }
  if (type === "bills"){
    S.tab = step === "post" ? "export" : "invoices";
    if (step === "review") S.filter = "draft";
    if (step === "done") S.filter = "approved";
  } else if (type === "bank"){
    S.tab = "bank";
    if (S.bank && S.bank.cid === S.coId) S.bank.filter = step === "post" ? "ready" : step === "done" ? "done" : "review";
    else S.pendingBankFilter = step === "post" ? "ready" : step === "done" ? "done" : "review";
  } else S.tab = "sales";
  render(); window.scrollTo(0, 0);
}
function stepCounts(){
  const co = CO(), st = (co && co.stats) || {}, t = docType();
  const inbox = docqCount(S.coId);
  if (t === "bank" && S.bank && S.bank.cid === S.coId){
    const c = tabCounts(S.bank.rows);
    return {collect: inbox ? inbox + " in inbox" : "upload a statement", review: c.review + " to review", post: c.ready + " ready", done: c.done + " done"};
  }
  if (t === "sales"){
    const n = S.sales && S.sales.cid === S.coId ? S.sales.list.length : 0;
    return {collect: "upload or create", review: n + " invoices", post: "from the list", done: ""};
  }
  return {collect: inbox ? inbox + " in inbox" : "upload bills", review: (st.drafts || 0) + " to review", post: (st.waiting || 0) + " approved", done: (st.invoicesFy || 0) + " this year"};
}
// the firm's plan comes as {name, includes, …} from the firm account; older copies kept only its name
function planName(p){ return p && typeof p === "object" ? String(p.name || "") : String(p || ""); }
function topRight(){
  const bal = accountBalance();
  const plan = S.account && S.account.firm ? planName(S.account.firm.plan) : "";
  return '<div class="topright">' +
    '<button class="tallychip' + (bridgeLive(S.view === "company" ? CO() : null) ? " live" : Bridge.on() ? " off" : " none") + '" data-act="tallyPanel" title="Tally connection">' +
      '<span class="dotled"></span>Tally' + (bridgeLive(S.view === "company" ? CO() : null) ? "" : Bridge.on() ? ": not answering" : ": not set up") + "</button>" +
    cloudChip() +
    '<button class="firmbtn" data-act="firmMenu"><b>' + esc((S.firm.firmName || "Firm").slice(0, 26)) + "</b>" +
      (plan || bal != null ? "<small>" + esc(plan) + (bal != null ? (plan ? " \u00b7 " : "") + "credit " + INR.format(bal) : "") + "</small>" : "") + "</button></div>";
}
function tallyPanelHtml(){
  if (!S.tallyPanel) return "";
  const co = S.view === "company" ? CO() : null, live = bridgeLive(co), st = Bridge.st || {};
  return '<button class="menu-scrim" data-act="tallyPanelClose" aria-label="Close"></button><div class="tallypanel" role="dialog" aria-label="Tally connection">' +
    '<div class="fm-head"><b>Tally connection</b><button class="icon" data-act="tallyPanelClose" aria-label="Close">\u2715</button></div>' +
    '<div class="tp-body">' + (Bridge.on()
      ? '<p><span class="dotled ' + (live ? "live" : "off") + '"></span><b>' + (live ? "Connected" : "Not answering") + "</b>" + (st.version ? '<span class="note"> \u00b7 bridge ' + esc(st.version) + "</span>" : "") + "</p>" +
        (co ? '<p class="note">' + (Bridge.openFor(co).name ? esc(Bridge.openFor(co).name) + " is open in Tally." : esc(co.tallyName || co.name) + " is not open in Tally.") + "</p>" : "") +
        (live ? "" : '<p class="note">Open TallyPrime on the computer where the bridge runs, and keep the company open.</p>')
      : '<p class="note">The Tally Bridge is not set up on this computer. Install it on the computer where TallyPrime runs, then come back here.</p>') + "</div>" +
    '<div class="tp-foot"><button class="btn small" data-act="tallyGuide">Connection guide</button><button class="btn small" data-nav="tally">Everything sent to Tally</button></div></div>';
}
function firmMenuHtml(){
  if (!S.firmMenu) return "";
  const a = S.account, bal = accountBalance();
  return '<button class="menu-scrim" data-act="firmMenuClose" aria-label="Close"></button><div class="firmmenu" role="menu">' +
    '<div class="fm-head"><b>' + esc(S.firm.firmName || "Firm") + "</b>" + (a && a.me ? '<span class="note">' + esc(a.me.email || "") + " \u00b7 " + esc(a.me.role || "") + "</span>" : "") + "</div>" +
    (a && a.firm ? '<div class="fm-plan"><span>' + esc(planName(a.firm.plan) || "Plan") + "</span>" + (bal != null ? "<b>credit " + INR.format(bal) + "</b>" : "") + "</div>" : "") +
    '<button class="fm-item" data-act="openSettings">Settings</button>' +
    '<button class="fm-item" data-nav="tally">Tally: everything sent</button>' +
    '<button class="fm-item" data-nav="inbox">Inbox for all clients</button>' +
    '<button class="fm-item" data-nav="clients">All clients</button>' +
    (Cloud.on() ? '<button class="fm-item" data-act="signOutNow">Sign out</button>' : "") + "</div>";
}
function clientHeader(){
  const co = CO(), setup = isSetupTab(S.tab), t = docType();
  const names = {bills: "Purchase bills", bank: "Bank", sales: "Sales invoices"};
  const inbox = docqCount(S.coId);
  const title = S.tab === "dash" ? "Dashboard" : S.tab === "clientInbox" ? "Inbox" : S.tab === "txn" ? "Transactions" : S.tab === "books" ? "TDS & GST from the books" : setup ? "Client setup" : names[t];
  let h = '<div class="tbar"><div class="tbar-title"><h2>' + title + '</h2><span class="note">' + esc(co.name) + "</span></div>" +
    '<div class="tbar-actions">' + (inbox && !setup && S.tab !== "clientInbox" ? '<button class="btn small" data-step="collect">\u{1F4E5} ' + inbox + " in inbox</button>" : "") +
    (setup ? '<button class="btn small" data-act="setup">Back to the work</button>' : (t === "sales" ? "" : '<button class="btn primary small" data-act="uploadHere">' + (t === "bank" ? "Upload statement" : "Upload bills") + "</button>")) + "</div></div>";
  if (S.tab === "dash" || S.tab === "clientInbox" || S.tab === "txn" || S.tab === "books") return h;
  if (setup){
    return h + '<nav class="sbar" aria-label="Client setup">' + SETUP_TABS.map(([id, l]) => '<button data-tab="' + id + '" aria-selected="' + (S.tab === id) + '">' + l + "</button>").join("") + "</nav>";
  }
  if (t === "sales" && S.tab === "sales") return h;
  const now = curStep(), c = stepCounts();
  const num0 = x => { const m = String(x || "").match(/\d+/); return m ? m[0] : ""; };
  const items = [["review", "To review", num0(c.review)], ["post", "Ready to post", num0(c.post)], ["done", "Posted", num0(c.done)]];
  return h + '<nav class="sbar" aria-label="Status">' + items.map(([id, l, n]) => '<button data-step="' + id + '" aria-selected="' + (now === id) + '">' + l +
    (n !== "" ? ' <span class="sbar-n">' + n + "</span>" : "") + "</button>").join("") + "</nav>";
}
/* ---------- Post to Tally: everything this client has approved, in one place ---------- */
function viewPostStep(){
  const co = CO(), v = Object.values(D().entries);
  const bills = v.filter(e => e.status === "approved" && !e.exportedAt);
  const billAmt = bills.reduce((a, e) => a + num(e.x.total), 0);
  const bankOn = S.bank && S.bank.cid === co.id && !S.bank.loading;
  const ready = bankOn ? S.bank.rows.filter(r => r.state === "ready") : [];
  const st = bankOn ? curStmt() : null;
  const sales = S.sales && S.sales.cid === co.id ? S.sales.list.filter(x => x.status === "approved" && !x.postedAt) : [];
  const card = (id, title, n, sub) => '<a class="pcard' + (S.postFocus === id ? " on" : "") + '" href="#post-' + id + '"><span>' + title + "</span><b>" + n + "</b><small>" + sub + "</small></a>";
  let h = '<section class="poststep"><div class="post-sum">' +
    card("bills", "Purchase bills", bills.length, bills.length ? INR.format(billAmt) : "nothing approved") +
    card("bank", "Bank lines", bankOn ? ready.length : "\u2026", bankOn ? (st ? esc(st.name || "current statement") : "no statement open") : "loading") +
    card("sales", "Sales invoices", S.sales && S.sales.cid === co.id ? sales.length : "\u2014", "posted from the Sales list") + "</div>";
  h += '<p class="note" style="margin:0 0 16px">Every entry is checked against Tally before it goes, and read back after. Nothing is posted twice.</p>';
  h += '<section class="psec" id="post-bills"><h3>Purchase bills</h3>' + viewExport() + "</section>";
  h += '<section class="psec" id="post-bank"><h3>Bank lines</h3>';
  if (!bankOn) h += '<p class="note">Loading the bank statements\u2026</p>';
  else if (!st) h += '<p class="note">No bank statement yet. <button class="linkbtn" data-dtype="bank" data-gstep="collect">Upload one</button>.</p>';
  else {
    h += (S.bank.postReport ? bankReportHtml() : "") +
      '<div class="row" style="align-items:center;gap:12px"><span><b>' + ready.length + "</b> line" + (ready.length === 1 ? "" : "s") + " ready in " + esc(st.name || "this statement") + "</span>" +
      (ready.length && Bridge.on() && Bridge.up() ? '<button class="btn primary" data-act="bankPost">Post ' + ready.length + " bank line" + (ready.length === 1 ? "" : "s") + "</button>" : "") +
      '<button class="btn small" data-act="toBankReady">See the lines</button>' +
      (S.bank.stmts.length > 1 ? '<span class="note">' + S.bank.stmts.length + " statements: choose another in the bank tab</span>" : "") + "</div>";
  }
  h += "</section>";
  h += '<section class="psec" id="post-sales"><h3>Sales invoices</h3><p class="note">Sales invoices are posted from the list on the Sales tab.</p><button class="btn small" data-dtype="sales">Open sales</button></section>';
  return h + "</section>";
}
function bankReportHtml(){ return S.bank.postReport ? postReportHtml(S.bank.postReport) : ""; }
/* ---------- Done: what went to Tally for this client, and taking an entry back ---------- */
function viewDoneStep(){
  const v = Object.values(D().entries);
  const posted = v.filter(e => e.exportedAt).length, approved = v.filter(e => e.status === "approved").length;
  return '<section class="poststep"><div class="post-sum">' +
    '<div class="pcard"><span>Bills posted</span><b>' + posted + "</b><small>" + approved + " approved in all</small></div>" +
    '<div class="pcard"><span>Bank lines posted</span><b>' + (S.bank && S.bank.cid === S.coId ? S.bank.rows.filter(r => r.state === "sent").length : "\u2014") + "</b><small>in the open statement</small></div>" +
    '</div><div class="row" style="margin:0 0 14px;gap:10px"><button class="btn small" data-act="toBillsApproved">Approved bills</button><button class="btn small" data-act="toBankDone">Bank lines done</button></div>' +
    viewPostLog() + "</section>";
}
/* ---------- Client setup: four tabs, out of the daily path ---------- */
const SETUP_TABS = [["settings", "Company and Tally"], ["gstset", "GST"], ["bankset", "Bank accounts"], ["bankrules", "Bank rules"], ["deductees", "Suppliers and TDS"]];
function isSetupTab(t){ return SETUP_TABS.some(x => x[0] === t); }
function viewBankSetup(which){
  const co = CO();
  if (!S.bank || S.bank.cid !== co.id || S.bank.loading){
    if (!S.bank || S.bank.cid !== co.id) loadBank(co.id).then(() => render());
    return '<p class="note">Loading this client\u2019s bank details\u2026</p>';
  }
  return which === "rules" ? viewRulesPanel() : '<div class="setup-inline">' + bankSettingsHtml() + "</div>";
}

/* ---------- Collect: everything that arrives for this client ---------- */
function viewCollect(){
  const t = docType();
  if (t === "sales") return viewSales();
  const inbox = docqPanel(S.coId);
  const card = t === "bank"
    ? '<section class="collect-card"><h3>Upload a bank statement</h3><div class="drop" id="bankDrop" tabindex="0" role="button" data-act="bankPick" aria-label="Upload a bank statement"><strong>Drop a statement here, or click to choose</strong>' +
      '<div class="note">Excel, CSV or PDF from any bank. The balances are checked, and the statement is filed under the right account.</div></div><input type="file" id="bankIn" accept=".xls,.xlsx,.csv,.pdf,.txt" multiple class="hidden"></section>'
    : '<section class="collect-card"><h3>Upload purchase bills</h3>' + uploadBlock(CO()) + "</section>";
  const mine = viewJobs(j => j.target === S.coId || j.cid === S.coId || j.target === "auto");
  return '<div class="collect">' + (inbox || '<p class="note" style="margin:0 0 12px">Nothing waiting in the inbox for ' + esc(CO().name) + ".</p>") + card +
    (mine ? '<section class="collect-card">' + mine + '<button class="btn small" data-step="review">Review them</button></section>' : "") + "</div>";
}
