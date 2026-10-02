/* ================================================================== */
/* Getting started for a new client, and the keyboard shortcuts        */
/* ================================================================== */
const ONB = {
  steps(co){
    const b = S.books && S.books.cid === co.id ? S.books : null, ts = typeof tallyStatus === "function" ? tallyStatus(co) : {state: "none"};
    const bridge = !["none", "offline"].includes(ts.state);
    // linked: a Tally company is this client's, in the cloud or open through the bridge here (review item 6)
    // review of 01-Oct-2026: a company linked in the cloud is linked whether or not the Tally computer is on now (it was
    // shown not done for a client linked in "Books in the cloud" while that computer was off)
    const cloudLinked = ((typeof TLight === "object" && TLight.st.cos) || []).some(r => r.client_id === co.id) || (typeof TCloud === "object" && TCloud.has(co.id));
    const linked = cloudLinked || (bridge && ts.state !== "unlinked" && typeof Bridge === "object" && Bridge.on() && Bridge.up() && !!Bridge.openFor(co));
    // review of 02-Oct-2026: each tick says what is done, wherever it was done. The bridge is set up once a Tally computer
    // has sent this client's books (it may be off now); the day book and opening balances are read when the cloud copy
    // holds them, not only when this browser has loaded them
    const bk = typeof TCloud === "object" && TCloud.book ? TCloud.book(co.id) : null;
    const bridgeSet = bridge || !!bk || ts.state === "offline";
    const dayBook = !!((b && (b.vouchers || []).length) || (bk && bk.entries > 0));
    const opening = !!((b && b.tb && b.tb.led && Object.keys(b.tb.led).length) || (bk && bk.openAsOn));
    const tallyBank = b && typeof FC === "object" ? Object.keys(Object.assign({}, b.under, b.ledInfo)).filter(l => ["Bank Accounts", "Bank OD A/c", "Bank OCC A/c"].some(g => FC.inGroup(l, g))).length : 0;
    return [
      {id: "tally", done: !!co.tallyName, t: "Name the company as it is in Tally", d: "So entries go to the right company.", btn: ["Client setup", {act: "setup"}]},
      {id: "bridge", done: bridgeSet, t: "Connect the Tally Bridge", d: "A small program on the computer where Tally is open.", btn: ["Connect", {act: "tallyGuide"}]},
      {id: "link", done: !!linked, t: "Link the Tally company", d: "The company in Tally with this client's books: linked by itself when its GSTIN is the client's.", btn: ["Link Tally company", {act: "goTcloud"}]},
      {id: "books", done: dayBook, t: "Read the books from Tally", d: "Unlocks MIS, audit review, reports, look up and letters.", btn: ["Read the books", {go: "books:import"}]},
      {id: "opening", done: opening, t: "Read the opening balances", d: "Tally's balances at the start of the books, so the trial balance, receivables and accounts are right.", btn: ["Read the books", {go: "books:import"}]},
      {id: "gst", done: !!co.gstin, t: "Add the GSTIN", d: "For GST returns and 2B.", btn: ["Add it", {act: "setup"}]},
      {id: "bank", done: !!(co.bankAccounts || []).some(a => a.ledger), t: "Add a bank account", d: (tallyBank ? tallyBank + " bank account" + (tallyBank === 1 ? "" : "s") + " in Tally. " : "") + "Add the one to bring statements for, with its Tally ledger.", btn: ["Bank", {go: "bank"}]},
      {id: "bills", done: Object.keys(D(co.id).entries || {}).length > 0, t: "Upload the first bills", d: "PDF, photo or email.", btn: ["Upload", {go: "bills"}]}
    ];
  }

};
const KEYS = [
  ["/", "Look up any ledger, anywhere in a client"],
  ["?", "This list"],
  ["F3 or Ctrl+K", "Switch client"],
  ["Ctrl+Enter", "Approve the bill on screen"],
  ["J or K", "Next or previous bill in the list"],
  ["Esc", "Close a panel, or go back"],
  ["Enter", "In Look up: show the answer"]
];
// a new client's first steps hidden (app/src/parts/Notes.jsx)
function onbHide(){ const co = CO(); if (co){ co.onbHide = true; Store.saveCompany(co); render(); } }
function showKeys(){
  askConfirm({title: "Keyboard shortcuts", ok: "Close", body: '<table class="bk-table keys-t"><tbody>' + KEYS.map(([k, d]) => "<tr><td>" + k.split(" or ").map(x => "<kbd>" + esc(x) + "</kbd>").join(" or ") + "</td><td>" + esc(d) + "</td></tr>").join("") + "</tbody></table>"});
}
if (typeof document !== "undefined"){
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-showkeys]"); if (t) showKeys();
  });
  document.addEventListener("keydown", e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const a = document.activeElement, inField = a && (/INPUT|SELECT|TEXTAREA/.test(a.tagName) || a.isContentEditable);
    if (inField || document.querySelector("#confirmBox[style*='flex']")) return;
    if (e.key === "?"){ e.preventDefault(); showKeys(); return; }
    if (e.key === "/" && S.view === "company" && S.coId){
      e.preventDefault();
      goClient("books:lookup");
      setTimeout(() => { const i = document.getElementById("lkAsk"); if (i){ i.focus(); i.select(); } }, 80);
    }
  });
}
// the dashboard's question box (app/src/screens/Dash.jsx): opens Look up with the question asked
function dashAsk(q){
  goClient("books:lookup");
  q = String(q || "").trim();
  if (!q) return;
  const go = (n) => { if (S.books && S.books.cid === S.coId && !S.books.loading){ lkAsk(q); } else if (n < 40) setTimeout(() => go(n + 1), 100); };
  setTimeout(() => go(0), 50);
}
