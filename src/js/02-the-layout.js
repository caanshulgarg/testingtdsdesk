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
/* ---------- Post to Tally and Done: React (app/src/screens/Post.jsx, Done.jsx) ---------- */
function viewPostStep(){ return '<div data-react="PostStep"></div>'; }
function viewDoneStep(){ return '<div data-react="DoneStep"></div>'; }
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

/* ---------- Collect: everything that arrives for this client (React: app/src/screens/Collect.jsx) ---------- */
function viewCollect(){ return docType() === "sales" ? viewSales() : '<div data-react="Collect"></div>'; }

