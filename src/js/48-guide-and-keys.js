/* ================================================================== */
/* Getting started for a new client, and the keyboard shortcuts        */
/* ================================================================== */
const ONB = {
  steps(co){
    const b = S.books && S.books.cid === co.id ? S.books : null, ts = typeof tallyStatus === "function" ? tallyStatus(co) : {state: "none"};
    const bridge = !["none", "offline"].includes(ts.state);
    // linked: a Tally company is this client's, in the cloud or open through the bridge here (review item 6)
    const linked = bridge && ts.state !== "unlinked" && (((typeof TLight === "object" && TLight.st.cos) || []).some(r => r.client_id === co.id) || (typeof Bridge === "object" && Bridge.on() && Bridge.up() && !!Bridge.openFor(co)));
    return [
      {id: "tally", done: !!co.tallyName, t: "Name the company as it is in Tally", d: "So entries go to the right company.", btn: ["Client setup", 'data-act="setup"']},
      {id: "bridge", done: !!bridge, t: "Connect the Tally Bridge", d: "A small program on the computer where Tally is open.", btn: ["Connect", 'data-act="tallyGuide"']},
      {id: "link", done: !!linked, t: "Link the Tally company", d: "The company in Tally with this client's books: linked by itself when its GSTIN is the client's.", btn: ["Link Tally company", 'data-act="goTcloud"']},
      {id: "books", done: !!(b && (b.vouchers || []).length), t: "Read the books from Tally", d: "Unlocks MIS, audit review, reports, look up and letters.", btn: ["Read the books", 'data-goclient="books:import"']},
      {id: "gst", done: !!co.gstin, t: "Add the GSTIN", d: "For GST returns and 2B.", btn: ["Add it", 'data-act="setup"']},
      {id: "bank", done: !!(co.bankAccounts || []).length, t: "Add a bank account", d: "Then bring in a statement.", btn: ["Bank", 'data-goclient="bank"']},
      {id: "bills", done: Object.keys(D(co.id).entries || {}).length > 0, t: "Upload the first bills", d: "PDF, photo or email.", btn: ["Upload", 'data-goclient="bills"']}
    ];
  },
  card(co){
    if (!co || co.onbHide) return "";
    if (!S.books || S.books.cid !== co.id){ if (typeof openBooks === "function" && S.view === "company") setTimeout(() => { if (!S.books || S.books.cid !== co.id) openBooks(co.id); }, 0); }
    const st = this.steps(co), n = st.filter(s => s.done).length;
    if (n === st.length) return "";
    return '<section class="dash-card onb"><div class="onb-h"><div><h3>Getting ' + esc(co.name) + ' ready</h3><p class="note" style="margin:0">' + n + " of " + st.length + ' done</p></div><button class="linkbtn" data-onbhide>Hide this</button></div>' +
      '<div class="onb-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + st.length + '" aria-valuenow="' + n + '"><i style="width:' + Math.round(n / st.length * 100) + '%"></i></div><ol class="onb-list">' +
      st.map(s => '<li class="' + (s.done ? "done" : "") + '"><span class="onb-n" aria-hidden="true">' + (s.done ? "✓" : "") + "</span><div><b>" + esc(s.t) + "</b><span>" + esc(s.d) + "</span></div>" + (s.done ? "" : '<button class="btn small" ' + s.btn[1] + ">" + esc(s.btn[0]) + "</button>") + "</li>").join("") + "</ol></section>";
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
function showKeys(){
  askConfirm({title: "Keyboard shortcuts", ok: "Close", body: '<table class="bk-table keys-t"><tbody>' + KEYS.map(([k, d]) => "<tr><td>" + k.split(" or ").map(x => "<kbd>" + esc(x) + "</kbd>").join(" or ") + "</td><td>" + esc(d) + "</td></tr>").join("") + "</tbody></table>"});
}
if (typeof document !== "undefined"){
  document.addEventListener("click", e => {
    const t = e.target.closest && e.target.closest("[data-onbhide],[data-showkeys]"); if (!t) return;
    if (t.hasAttribute("data-showkeys")){ showKeys(); return; }
    const co = CO(); if (co){ co.onbHide = true; Store.saveCompany(co); render(); }
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
