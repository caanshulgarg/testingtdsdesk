/* ================================================================== */
/* The layout: a sidebar, and each client as Collect, Review, Post,    */
/* Done. The screens inside are the ones the app already has.          */
/* ================================================================== */
// the sidebar is drawn by React: app/src/Side.jsx
function inboxTotal(){ return Object.values(S.docq || {}).filter(d => d.status === "waiting").length + Object.keys(S.inbox || {}).length; }
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
