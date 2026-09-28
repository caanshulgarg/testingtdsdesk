/* ================================================================== */
/* Getting started for a new client, and the keyboard shortcuts        */
/* ================================================================== */
const ONB = {
  steps(co){
    const b = S.books && S.books.cid === co.id ? S.books : null, bridge = typeof Bridge === "object" && Bridge.on() && Bridge.up();
    return [
      {id: "tally", done: !!co.tallyName, t: "Name the company as it is in Tally", d: "So entries go to the right company.", btn: ["Client setup", 'data-act="setup"']},
      {id: "bridge", done: !!bridge, t: "Connect the Tally Bridge", d: "A small program on the computer where Tally is open.", btn: ["Connect", 'data-act="tallyGuide"']},
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
      const el = document.createElement("button"); el.dataset.goclient = "books:lookup"; el.style.display = "none"; document.body.appendChild(el); el.click(); el.remove();
      setTimeout(() => { const i = document.getElementById("lkAsk"); if (i){ i.focus(); i.select(); } }, 80);
    }
  });
}
// the dashboard's question box: opens Look up with the question asked
if (typeof document !== "undefined"){
  const dashAsk = () => {
    const i = document.getElementById("dashAsk"), q = i ? i.value.trim() : "";
    const el = document.createElement("button"); el.dataset.goclient = "books:lookup"; el.style.display = "none"; document.body.appendChild(el); el.click(); el.remove();
    if (!q) return;
    const go = (n) => { if (S.books && S.books.cid === S.coId && !S.books.loading){ LK.st().ask = q; render(); const b = document.querySelector('[data-lk="ask"]'); if (b) b.click(); } else if (n < 40) setTimeout(() => go(n + 1), 100); };
    setTimeout(() => go(0), 50);
  };
  document.addEventListener("click", e => { if (e.target.closest && e.target.closest("[data-dashask]")) dashAsk(); });
  document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target && e.target.id === "dashAsk"){ e.preventDefault(); dashAsk(); } });
}
// after the nightly copy is switched on anywhere, Look up shows it
if (typeof document !== "undefined") document.addEventListener("click", e => {
  const t = e.target.closest && e.target.closest('[data-act="tallyScheduleOn"]');
  if (t && S.lkFr) setTimeout(() => { S.lkFr.at = 0; LK.autoFresh(); }, 4000);
});
// while Look up, Reports or Letters is on screen: pick up what the bridge has brought in, once a minute
if (typeof window !== "undefined") setInterval(() => {
  try { if (document.visibilityState === "visible" && S.view === "company" && S.tab === "books" && ["lookup", "reports", "letters"].includes(S.booksTab) && typeof LK === "object") LK.autoFresh(); } catch (e){}
}, 60000);
