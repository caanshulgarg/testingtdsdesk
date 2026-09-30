/* ================================================================== */
/* Getting started for a new client, and the keyboard shortcuts        */
/* ================================================================== */
const ONB = {
  steps(co){
    const b = S.books && S.books.cid === co.id ? S.books : null, bridge = typeof Bridge === "object" && Bridge.on() && Bridge.up();
    return [
      {id: "tally", done: !!co.tallyName, t: "Name the company as it is in Tally", d: "So entries go to the right company.", btn: ["Client setup", {act: "setup"}]},
      {id: "bridge", done: !!bridge, t: "Connect the Tally Bridge", d: "A small program on the computer where Tally is open.", btn: ["Connect", {act: "tallyGuide"}]},
      {id: "books", done: !!(b && (b.vouchers || []).length), t: "Read the books from Tally", d: "Unlocks MIS, audit review, reports, look up and letters.", btn: ["Read the books", {go: "books:import"}]},
      {id: "gst", done: !!co.gstin, t: "Add the GSTIN", d: "For GST returns and 2B.", btn: ["Add it", {act: "setup"}]},
      {id: "bank", done: !!(co.bankAccounts || []).length, t: "Add a bank account", d: "Then bring in a statement.", btn: ["Bank", {go: "bank"}]},
      {id: "bills", done: Object.keys(D(co.id).entries || {}).length > 0, t: "Upload the first bills", d: "PDF, photo or email.", btn: ["Upload", {go: "bills"}]}
    ];
  }

};
const KEYS = [
  ["/", "Look up any ledger, anywhere in a client"],
  ["?", "This list"],
  ["F3 or Ctrl+K", "Switch client"],
  ["Ctrl+A", "Approve the bill on screen"],
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
