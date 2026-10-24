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
/* ---------- the upload pages' states (upload-pages, 14-Oct-2026) ---------- */
// The owner (14-Oct-2026: "UI to upload bills, bank, sales is very wrong"): Purchase said "3 entries need review" in the
// top bar, "To review 0" in the tabs and "Review 0 uploaded bills" under them; the 3 were Tally's errors, under an
// unlabelled badge. Now each upload page (Purchase, Bank, Sales) has one row of states, in the same words everywhere,
// each with one count, and every count is worked out here, once, from the same rows the state's table lists: the
// state bar, the bars at the foot and the empty states read these and nothing else.
const STATE_WORDS = {review: "To review", ready: "Ready to post", errors: "Errors", intally: "In Tally", duplicate: "Duplicates",
  deleted: "Deleted", rejected: "No entry", ignored: "Ignored"};
// the bank page's own words (the owner, 24-Oct-2026: "To do · Ready to post · Posted · Ignored"; Purchase and Sales keep
// theirs), Ignored always shown there
const BANK_STATE_WORDS = {review: "To do", intally: "Posted"};
// Purchase: To review = the bills to review (the review table's rows); Ready to post, Errors and In Tally = the three
// lists of Post to Tally (postTabCounts, src/js/59: its To post, Errors and Posted rows); Duplicates, Deleted, No entry =
// the bills held so. null when the client's bills are not on this computer
function billStates(cid){
  cid = cid || S.coId;
  const d = S.data[cid];
  if (!d || !d.loaded) return null;
  const v = Object.values(d.entries), n = st => v.filter(e => e.status === st).length;
  const t = typeof postTabCounts === "function" ? postTabCounts(cid) : {topost: 0, posted: 0, errors: 0};
  return {review: n("draft"), ready: num(t.topost), errors: num(t.errors), intally: num(t.posted), duplicate: n("duplicate"), deleted: n("deleted"), rejected: n("rejected")};
}
// Bank: the statement's lines by tab (tabCounts, src/js/22: the same test, bankTabOf, as the table's rows)
function bankStates(){
  const b = typeof B === "function" ? B() : null;
  if (!b || b.cid !== S.coId || b.loading || typeof curStmt !== "function" || !curStmt()) return null;
  const t = tabCounts(bankRangeRows());
  return {review: t.review, ready: t.ready, intally: t.done, ignored: t.ignored};
}
// Sales: the invoices by tab (salesCounts, src/js/26: the same test, salesTabStates, as the table's rows)
function salesStates(){
  const s = typeof SL === "function" ? SL() : null;
  if (!s || s.cid !== S.coId || s.loading) return null;
  const t = salesCounts();
  return {review: t.review, ready: t.ready, intally: t.done, ignored: t.ignored};
}
// which page of the three this is ("" for none)
function uploadPage(){
  if (S.view !== "company" || !CO() || S.loadingCo || isSetupTab(S.tab)) return "";
  if (S.tab === "bank") return "bank";
  if (S.tab === "sales") return "sales";
  if (["invoices", "export", "done"].includes(S.tab) && docType() === "bills") return "bills";
  return "";
}
// the states of the page, in order: [[id, words, count]]. A state that is often empty and needs nothing (Errors, No entry,
// Ignored) shows only while it has rows or is open
function pageStates(page){
  page = page || uploadPage();
  const c = page === "bills" ? billStates() : page === "bank" ? bankStates() : page === "sales" ? salesStates() : null;
  if (!c) return [];
  const now = pageState(page);
  const order = page === "bills" ? ["review", "ready", "errors", "intally", "duplicate", "deleted", "rejected"] : ["review", "ready", "intally", "ignored"];
  const optional = page === "bank" ? [] : ["errors", "rejected", "ignored"];
  return order.filter(id => !optional.includes(id) || c[id] > 0 || now === id).map(id => [id, (page === "bank" && BANK_STATE_WORDS[id]) || STATE_WORDS[id], num(c[id])]);
}
// the state open now
function pageState(page){
  page = page || uploadPage();
  if (page === "bank"){ const b = B(); if (!b || b.focus) return ""; const t = bankTab(); return t === "done" ? "intally" : ["review", "ready", "ignored"].includes(t) ? t : ""; }
  if (page === "sales"){ const s = SL(); if (!s) return ""; return s.filter === "done" ? "intally" : ["review", "ready", "ignored"].includes(s.filter) ? s.filter : "review"; }
  if (page !== "bills") return "";
  if (S.tab === "done") return "intally";
  if (S.tab === "export"){
    const t = postTabNow(S.coId);
    return t === "posted" ? "intally" : t === "errors" ? "errors" : "ready";
  }
  return {draft: "review", duplicate: "duplicate", deleted: "deleted", rejected: "rejected"}[S.filter] || "";
}
// Post to Tally's list open for a client: the one chosen, else the one with work (Errors when there are any)
function postTabNow(cid){
  S.postTabs = S.postTabs || {};
  if (S.postTabs[cid]) return S.postTabs[cid];
  const t = typeof postTabCounts === "function" ? postTabCounts(cid) : {errors: 0};
  return num(t.errors) ? "errors" : "topost";
}
// open a state of the page
function goState(id, page){
  page = page || uploadPage();
  if (page === "bank"){ bankTabGo(id === "intally" ? "done" : id); return; }
  if (page === "sales"){ salesTabGo(id === "intally" ? "done" : id); return; }
  if (page !== "bills") return;
  const post = {ready: "topost", errors: "errors", intally: "posted"}[id];
  if (post){ S.postTabs = S.postTabs || {}; S.postTabs[S.coId] = post; goStep("post", "bills"); return; }
  if (id === "review"){ goStep("review", "bills"); return; }
  S.step = null; S.tab = "invoices"; S.filter = id; S.selected = null; S.drawerOpen = false; S.reviewTable = false; render(); window.scrollTo(0, 0);
}
// the upload going on, or the last one, for the open client's page: {busy, done, total, failed: [jobs]} (Purchase reads
// S.jobs; Bank and Sales say what they are doing in their own busy line)
function uploadProgress(cid){
  cid = cid || S.coId;
  const mine = (S.jobs || []).filter(j => j.cid === cid || j.target === cid);
  const busy = mine.filter(j => ["waiting", "checking", "reading"].includes(j.status));
  return {busy: busy.length, done: mine.length - busy.length, total: mine.length, now: busy.find(j => j.status === "reading") || busy[0] || null,
    failed: mine.filter(j => j.status === "failed")};
}
// the firm's plan comes as {name, includes, …} from the firm account; older copies kept only its name
function planName(p){ return p && typeof p === "object" ? String(p.name || "") : String(p || ""); }
/* ---------- Post to Tally and Done: React (app/src/screens/Post.jsx, Done.jsx) ---------- */
function viewPostStep(){ return '<div data-react="PostStep"></div>'; }
function viewDoneStep(){ return '<div data-react="DoneStep"></div>'; }
/* ---------- Client setup: four tabs, out of the daily path ---------- */
// the sections of Client setup, in the order of the list on its left (app/src/screens/Settings.jsx)
const SETUP_TABS = [["settings", "Company"], ["cotally", "Tally"], ["cotds", "TDS"], ["deductees", "Suppliers"], ["gstset", "GST"],
  ["bankset", "Bank accounts"], ["bankrules", "Bank rules"], ["coclosed", "Closed periods"], ["cosheets", "Register formats"], ["coremove", "Remove this client"]];
function isSetupTab(t){ return SETUP_TABS.some(x => x[0] === t); }

/* ---------- Collect: everything that arrives for this client (React: app/src/screens/Collect.jsx) ---------- */
function viewCollect(){ return docType() === "sales" ? viewSales() : '<div data-react="Collect"></div>'; }

