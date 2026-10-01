/* ================================================================== */
/* Column filters: a funnel on each heading opens a panel for that column */
/* ================================================================== */
const FUNNEL = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 5h18l-7 8.5V20l-4-2v-4.5z"/></svg>';
function colHead(table, key, label, cls){
  const on = colActive(table, key);
  return '<th' + (cls ? ' class="' + cls + '"' : "") + '><span class="colh"><span>' + label + '</span><button class="colf' + (on ? " on" : "") + (S.colPop && S.colPop.t === table && S.colPop.k === key ? " open" : "") +
    '" data-colf="' + key + '" data-colt="' + table + '" aria-label="Filter ' + esc(label) + '" title="Filter ' + esc(label) + '">' + FUNNEL + "</button></span></th>";
}
function colActive(t, k){
  if (t === "txn"){ const f = txnF();
    return k === "date" ? !!(f.from || f.to) : k === "vch" ? !!(f.vchs && f.vchs.length) : k === "no" ? !!f.no : k === "party" ? !!(f.party || (f.parties && f.parties.length)) :
      k === "val" ? !!(f.min || f.max) : k === "status" ? !!(f.states && f.states.length) : k === "doc" ? !!f.doc : false; }
  if (t === "sales"){ const f = (SL() || {}).f || {};
    return k === "date" ? !!(f.from || f.to) : k === "no" ? !!f.no : k === "cust" ? !!(f.cust || (f.custs && f.custs.length)) : k === "val" ? !!(f.min || f.max) : k === "led" ? !!(f.leds && f.leds.length) : false; }
  if (t === "bank"){ const b = B() || {}, f = b.f || {};
    return k === "date" ? !!(b.from || b.to) : k === "narr" ? !!(f.narr || (f.modes && f.modes.length)) : k === "wd" ? !!(f.wmin || f.wmax) : k === "dep" ? !!(f.dmin || f.dmax) : k === "led" ? !!(f.led || f.ledText || (f.leds && f.leds.length)) : false; }
  const f = S.revF || {};
  return k === "date" ? !!(f.from || f.to) : k === "sup" ? !!(f.sup || (f.sups && f.sups.length)) : k === "no" ? !!f.no : k === "val" ? !!(f.min || f.max) : k === "nature" ? !!(f.natures && f.natures.length) : k === "tds" ? !!f.tds : k === "look" ? !!f.look : false;
}
// values found in the table, with how many lines or bills carry each
function colValues(t, k){
  const m = new Map();
  const add = v => { if (v) m.set(v, (m.get(v) || 0) + 1); };
  if (t === "txn"){
    const rows = txnTab() === "bills" ? txnRowsBills() : txnTab() === "sales" ? (txnRowsSales() || []) : (txnRowsBank() || []);
    if (k === "vch") rows.forEach(r => add(r.vch));
    if (k === "party") rows.forEach(r => add(r.party));
    if (k === "status") rows.forEach(r => add(r.label));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  }
  if (t === "sales"){ const list = (SL() || {list: []}).list; if (k === "cust") list.forEach(v => add(v.x.customerName)); if (k === "led") list.forEach(v => add(v.customerLedger)); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]); }
  if (t === "bank"){ const rows = B().rows; if (k === "narr") rows.forEach(r => add(r.dec && r.dec.mode)); if (k === "led") rows.forEach(r => add(r.ledger)); }
  else { const rows = draftRows(); if (k === "sup") rows.forEach(r => add(r.e.x.vendorName)); if (k === "nature") rows.forEach(r => add(r.e.natureId)); }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}
const MODE_NAMES = {UPI: "UPI", NEFT: "NEFT", IMPS: "IMPS", RTGS: "RTGS", CHQ: "Cheque", CASH: "Cash deposit", ATM: "Cash withdrawal", NACH: "NACH / ECS", CARD: "Card", CHARGES: "Bank charges", INTEREST: "Interest", TRANSFER: "Transfer", OTHER: "Other"};
function colPopHtml(){
  const p = S.colPop; if (!p) return "";
  const bank = p.t === "bank", sales = p.t === "sales", txn = p.t === "txn", b = bank ? B() : null;
  const f = bank ? (b.f || {}) : sales ? ((SL() || {}).f || {}) : txn ? txnF() : (S.revF || {});
  const dateFrom = bank ? b.from : f.from, dateTo = bank ? b.to : f.to;
  const q = String(p.search || "").trim().toLowerCase();
  const list = (values, chosen, name, labeler) => {
    const shown = q ? values.filter(([v]) => String(labeler ? labeler(v) : v).toLowerCase().includes(q) || (chosen || []).includes(v)) : values;
    return '<input type="search" class="cp-search" data-cpsearch data-fk="cpsearch" value="' + esc(p.search || "") + '" placeholder="Search\u2026" aria-label="Search the list">' +
      '<div class="cp-list">' + shown.map(([v, n]) => '<label class="cp-item"><input type="checkbox" data-pf="' + name + '" value="' + esc(v) + '"' + ((chosen || []).includes(v) ? " checked" : "") + "><span>" + esc(labeler ? labeler(v) : v) + '</span><small>' + n + "</small></label>").join("") +
      (shown.length ? "" : '<p class="note">' + (values.length ? "Nothing matches that." : "Nothing to choose from yet.") + "</p>") + "</div>";
  };
  const amt = (k, ph, v) => '<input type="text" inputmode="decimal" data-pf="' + k + '" data-fk="cp-' + k + '" value="' + esc(v || "") + '" placeholder="' + ph + '">';
  const range = (a, b2, va, vb) => '<div class="cp-range"><label>From' + amt(a, "0", va) + "</label><label>To" + amt(b2, "any", vb) + "</label></div>";
  const radio = (name, cur, opts) => '<div class="cp-radios">' + opts.map(([v, l]) => '<label class="cp-item"><input type="radio" name="cp-' + name + '" data-pf="' + name + '" value="' + v + '"' + ((cur || "") === v ? " checked" : "") + "><span>" + l + "</span></label>").join("") + "</div>";
  let body = "", title = "";
  if (p.k === "date"){
    title = "Date";
    body = '<div class="cp-quick">' + [["month", "This month"], ["last", "Last month"], ["quarter", "This quarter"], ["fy", "This year"]].map(([v, l]) => '<button class="cp-chip" data-cpquick="' + v + '">' + l + "</button>").join("") + "</div>" +
      '<div class="cp-range"><label>From<input type="date" data-pf="from" data-fk="cp-from" value="' + esc(dateFrom || "") + '"></label><label>To<input type="date" data-pf="to" data-fk="cp-to" value="' + esc(dateTo || "") + '"></label></div>';
  } else if (bank && p.k === "narr"){
    title = "Particulars";
    body = '<div class="cp-row"><select data-pf="narrNot"><option value="">Has</option><option value="1"' + (f.narrNot ? " selected" : "") + '>Does not have</option></select><input type="text" data-pf="narr" data-fk="cp-narr" value="' + esc(f.narr || "") + '" placeholder="swiggy, zomato"></div>' +
      '<p class="cp-sub">Separate words with commas. Mode:</p>' + list(colValues("bank", "narr"), f.modes, "modes", v => MODE_NAMES[v] || v);
  } else if (bank && (p.k === "wd" || p.k === "dep")){
    title = p.k === "wd" ? "Withdrawal" : "Deposit";
    body = p.k === "wd" ? range("wmin", "wmax", f.wmin, f.wmax) : range("dmin", "dmax", f.dmin, f.dmax);
  } else if (bank && p.k === "led"){
    title = "Ledger";
    body = radio("led", f.led, [["", "Any ledger"], ["none", "No ledger yet"], ["set", "Ledger chosen"]]) + '<p class="cp-sub">Or only these ledgers:</p>' + list(colValues("bank", "led"), f.leds, "leds");
  } else if (txn && p.k === "vch"){
    title = "Voucher type"; body = list(colValues("txn", "vch"), f.vchs, "vchs");
  } else if (txn && p.k === "no"){
    title = "Number"; body = '<input type="text" data-pf="no" data-fk="cp-no" value="' + esc(f.no || "") + '" placeholder="Number has\u2026" class="cp-full">';
  } else if (txn && p.k === "party"){
    title = "Party";
    body = '<input type="text" data-pf="party" data-fk="cp-party" value="' + esc(f.party || "") + '" placeholder="Name has\u2026" class="cp-full"><p class="cp-sub">Or only these:</p>' + list(colValues("txn", "party"), f.parties, "parties");
  } else if (txn && p.k === "val"){
    title = "Amount"; body = range("min", "max", f.min, f.max);
  } else if (txn && p.k === "status"){
    title = "In Tally"; body = list(colValues("txn", "status"), f.states, "states");
  } else if (txn && p.k === "doc"){
    title = "Document"; body = radio("doc", f.doc, [["", "All"], ["yes", "Document attached"], ["no", "No document"]]);
  } else if (sales && p.k === "no"){
    title = "Invoice"; body = '<input type="text" data-pf="no" data-fk="cp-no" value="' + esc(f.no || "") + '" placeholder="Invoice number has\u2026" class="cp-full">';
  } else if (sales && p.k === "cust"){
    title = "Customer";
    body = '<input type="text" data-pf="cust" data-fk="cp-cust" value="' + esc(f.cust || "") + '" placeholder="Name, GSTIN or ledger has\u2026" class="cp-full"><p class="cp-sub">Or only these customers:</p>' + list(colValues("sales", "cust"), f.custs, "custs");
  } else if (sales && p.k === "val"){
    title = "Total"; body = range("min", "max", f.min, f.max);
  } else if (sales && p.k === "led"){
    title = "Customer ledger"; body = list(colValues("sales", "led"), f.leds, "leds");
  } else if (!bank && !sales && p.k === "sup"){
    title = "Supplier";
    body = '<input type="text" data-pf="sup" data-fk="cp-sup" value="' + esc(f.sup || "") + '" placeholder="Name, GSTIN or ledger has\u2026" class="cp-full"><p class="cp-sub">Or only these suppliers:</p>' + list(colValues("rev", "sup"), f.sups, "sups");
  } else if (!bank && !sales && p.k === "no"){
    title = "Bill no."; body = '<input type="text" data-pf="no" data-fk="cp-no" value="' + esc(f.no || "") + '" placeholder="Bill number has\u2026" class="cp-full">';
  } else if (!bank && !sales && p.k === "val"){
    title = "Value"; body = range("min", "max", f.min, f.max);
  } else if (!bank && p.k === "nature"){
    const lab = Object.fromEntries(rules().map(r => [r.id, r.label]));
    title = "Payment type"; body = list(colValues("rev", "nature"), f.natures, "natures", v => lab[v] || v);
  } else if (!bank && p.k === "tds"){
    title = "TDS"; body = radio("tds", f.tds, [["", "All bills"], ["yes", "TDS booked"], ["no", "No TDS"]]);
  } else if (!bank && p.k === "look"){
    title = "Status"; body = radio("look", f.look, [["", "All bills"], ["yes", "Need a look"], ["no", "Ready to approve"]]);
  }
  return '<div class="colpop" id="colpop" role="dialog" aria-label="Filter ' + esc(title) + '"><div class="cp-head"><b>Filter: ' + esc(title) + '</b><button class="icon" data-cpclose aria-label="Close">\u2715</button></div>' +
    '<div class="cp-body">' + body + "</div>" +
    '<div class="cp-foot"><button class="linkbtn" data-cpclear>Clear</button><span></span>' +
    (S.colAuto ? '<button class="btn small primary" data-cpclose>Done</button>' : '<button class="btn small" data-cpclose>Cancel</button><button class="btn small primary" data-cpapply>Apply</button>') + "</div>" +
    '<label class="cp-auto"><input type="checkbox" data-cpauto' + (S.colAuto ? " checked" : "") + "> Apply as I choose</label></div>";
}
function colPopApply(clearOnly, keepOpen){
  const p = S.colPop; if (!p) return;
  const listEl = document.querySelector("#colpop .cp-list");
  const scroll = listEl ? listEl.scrollTop : 0;
  const pop = document.getElementById("colpop");
  const vals = {};
  if (pop && !clearOnly) pop.querySelectorAll("[data-pf]").forEach(el => {
    const k = el.dataset.pf;
    if (el.type === "checkbox"){ vals[k] = vals[k] || []; if (el.checked) vals[k].push(el.value); }
    else if (el.type === "radio"){ if (el.checked) vals[k] = el.value; else if (!(k in vals)) vals[k] = ""; }
    else vals[k] = el.value;
  });
  const keys = {bank: {date: ["from", "to"], narr: ["narr", "narrNot", "modes"], wd: ["wmin", "wmax"], dep: ["dmin", "dmax"], led: ["led", "leds", "ledText"]},
                sales: {date: ["from", "to"], no: ["no"], cust: ["cust", "custs"], val: ["min", "max"], led: ["leds"]},
                txn: {date: ["from", "to"], vch: ["vchs"], no: ["no"], party: ["party", "parties"], val: ["min", "max"], status: ["states"], doc: ["doc"]},
                rev: {date: ["from", "to"], sup: ["sup", "sups"], no: ["no"], val: ["min", "max"], nature: ["natures"], tds: ["tds"], look: ["look"]}}[p.t][p.k];
  if (p.t === "bank"){
    const b = B(); b.f = b.f || {};
    keys.forEach(k => { const v = clearOnly ? "" : (vals[k] == null ? "" : vals[k]); if (k === "from" || k === "to") b[k] = v; else b.f[k] = v; });
    if (b.from && b.to && b.from > b.to){ const x = b.from; b.from = b.to; b.to = x; }
    b.sel.clear();
  } else if (p.t === "txn"){
    const f2 = txnF();
    keys.forEach(k => { f2[k] = clearOnly ? "" : (vals[k] == null ? "" : vals[k]); });
  } else if (p.t === "sales"){
    const sl = SL(); sl.f = sl.f || {};
    keys.forEach(k => { const v = clearOnly ? "" : (vals[k] == null ? "" : vals[k]); if (k === "from" || k === "to") sl.f[k] = v; else sl.f[k] = v; });
    sl.sel.clear();
  } else {
    S.revF = S.revF || {};
    keys.forEach(k => { S.revF[k] = clearOnly ? "" : (vals[k] == null ? "" : vals[k]); });
    S.revSel = new Set();
  }
  S.colPop = keepOpen ? Object.assign({}, p, {scroll}) : null;
  render();
}
// chips above the table: what is filtered, each removable
// the chips over a list (app/src/parts/ChipBar.jsx): a chip opens its column's filter box, ✕ removes it, Clear all
function colChipOpen(t, k){ S.colPop = S.colPop && S.colPop.k === k && S.colPop.t === t ? null : {t, k, justOpened: true}; render(); }
function colChipX(t, k){ S.colPop = {t, k}; colPopApply(true); }
function colChipAll(t){
  if (t === "bank"){ const b = B(); b.from = ""; b.to = ""; b.f = {}; b.sel.clear(); }
  else if (t === "sales"){ const sl = SL(); if (sl){ sl.f = {}; sl.sel.clear(); } }
  else if (t === "txn"){ S.txnF = S.txnF || {}; S.txnF[txnTab()] = {}; S.txnQ = ""; S.txnStatus = ""; }
  else { S.revF = {}; S.revSel = new Set(); }
  S.colPop = null; render();
}
function colChips(t){
  const chips = [];
  const money = v => INR.format(num(v));
  const rng = (a, b2) => a && b2 ? money(a) + "\u2013" + money(b2) : a ? "\u2265 " + money(a) : "\u2264 " + money(b2);
  const d = v => fmtDate(v);
  if (t === "bank"){ const b = B(), f = b.f || {};
    if (b.from || b.to) chips.push(["date", "Date " + (b.from && b.to ? d(b.from) + " \u2013 " + d(b.to) : b.from ? "from " + d(b.from) : "to " + d(b.to))]);
    if (f.narr) chips.push(["narr", "Particulars " + (f.narrNot ? "does not have" : "has") + " \u201c" + f.narr + "\u201d"]);
    if (f.modes && f.modes.length) chips.push(["narr", "Mode: " + f.modes.map(m => MODE_NAMES[m] || m).join(", ")]);
    if (f.wmin || f.wmax) chips.push(["wd", "Withdrawal " + rng(f.wmin, f.wmax)]);
    if (f.dmin || f.dmax) chips.push(["dep", "Deposit " + rng(f.dmin, f.dmax)]);
    if (f.led) chips.push(["led", f.led === "none" ? "No ledger yet" : "Ledger chosen"]);
    if (f.leds && f.leds.length) chips.push(["led", "Ledger: " + f.leds.slice(0, 2).join(", ") + (f.leds.length > 2 ? " +" + (f.leds.length - 2) : "")]);
  } else if (t === "txn"){ const f = txnF();
    if (f.from || f.to) chips.push(["date", "Date " + (f.from && f.to ? d(f.from) + " \u2013 " + d(f.to) : f.from ? "from " + d(f.from) : "to " + d(f.to))]);
    if (f.vchs && f.vchs.length) chips.push(["vch", "Voucher: " + f.vchs.join(", ")]);
    if (f.no) chips.push(["no", "Number has \u201c" + f.no + "\u201d"]);
    if (f.party) chips.push(["party", "Party has \u201c" + f.party + "\u201d"]);
    if (f.parties && f.parties.length) chips.push(["party", "Party: " + f.parties.slice(0, 2).join(", ") + (f.parties.length > 2 ? " +" + (f.parties.length - 2) : "")]);
    if (f.min || f.max) chips.push(["val", "Amount " + rng(f.min, f.max)]);
    if (f.states && f.states.length) chips.push(["status", f.states.join(", ")]);
    if (f.doc) chips.push(["doc", f.doc === "yes" ? "Document attached" : "No document"]);
  } else if (t === "sales"){ const f = (SL() || {}).f || {};
    if (f.from || f.to) chips.push(["date", "Date " + (f.from && f.to ? d(f.from) + " \u2013 " + d(f.to) : f.from ? "from " + d(f.from) : "to " + d(f.to))]);
    if (f.no) chips.push(["no", "Invoice has \u201c" + f.no + "\u201d"]);
    if (f.cust) chips.push(["cust", "Customer has \u201c" + f.cust + "\u201d"]);
    if (f.custs && f.custs.length) chips.push(["cust", "Customer: " + f.custs.slice(0, 2).join(", ") + (f.custs.length > 2 ? " +" + (f.custs.length - 2) : "")]);
    if (f.min || f.max) chips.push(["val", "Total " + rng(f.min, f.max)]);
    if (f.leds && f.leds.length) chips.push(["led", "Ledger: " + f.leds.slice(0, 2).join(", ")]);
  } else { const f = S.revF || {}, lab = Object.fromEntries(rules().map(r => [r.id, r.label]));
    if (f.from || f.to) chips.push(["date", "Date " + (f.from && f.to ? d(f.from) + " \u2013 " + d(f.to) : f.from ? "from " + d(f.from) : "to " + d(f.to))]);
    if (f.sup) chips.push(["sup", "Supplier has \u201c" + f.sup + "\u201d"]);
    if (f.sups && f.sups.length) chips.push(["sup", "Supplier: " + f.sups.slice(0, 2).join(", ") + (f.sups.length > 2 ? " +" + (f.sups.length - 2) : "")]);
    if (f.no) chips.push(["no", "Bill no. has \u201c" + f.no + "\u201d"]);
    if (f.min || f.max) chips.push(["val", "Value " + rng(f.min, f.max)]);
    if (f.natures && f.natures.length) chips.push(["nature", "Type: " + f.natures.map(n => lab[n] || n).join(", ")]);
    if (f.tds) chips.push(["tds", f.tds === "yes" ? "TDS booked" : "No TDS"]);
    if (f.look) chips.push(["look", f.look === "yes" ? "Need a look" : "Ready to approve"]);
  }
  return chips;
}
function placeColPop(){
  const pop = document.getElementById("colpop"); if (!pop || !S.colPop) return;
  const btn = document.querySelector('.colf[data-colf="' + S.colPop.k + '"][data-colt="' + S.colPop.t + '"]');
  if (!btn){ pop.style.display = "none"; return; }
  pop.style.display = "";   // hidden while its button was not in the page (a React table is put back after the old screens)
  const th = btn.closest("th") || btn, cell = th.getBoundingClientRect(), r = btn.getBoundingClientRect();
  const body = pop.querySelector(".cp-body"), foot = pop.querySelector(".cp-foot"), head = pop.querySelector(".cp-head"), auto = pop.querySelector(".cp-auto");
  const chrome = (head ? head.offsetHeight : 0) + (foot ? foot.offsetHeight : 0) + (auto ? auto.offsetHeight : 0) + 8;
  const below = window.innerHeight - cell.bottom - 20, above = cell.top - 20;
  const down = below >= 260 || below >= above;                      // downwards when there is room, as a spreadsheet does
  if (body) body.style.maxHeight = Math.max(150, Math.min(360, (down ? below : above) - chrome)) + "px";
  const w = pop.offsetWidth, h = pop.offsetHeight;
  // under the column, aligned to its left edge; to its right edge when that would run off the screen
  let left = cell.left;
  if (left + w > window.innerWidth - 12) left = Math.max(12, cell.right - w);
  left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
  const top = down ? Math.min(cell.bottom + 4, window.innerHeight - h - 12) : Math.max(12, cell.top - h - 4);
  pop.style.left = left + "px"; pop.style.top = top + "px";
  const lst = pop.querySelector(".cp-list"); if (lst && S.colPop.scroll) lst.scrollTop = S.colPop.scroll;
  if (S.colPop.justOpened){
    S.colPop.justOpened = false;
    const first = pop.querySelector('input[type="text"], input[type="date"], input[type="search"]');
    if (first){ first.focus(); try { first.setSelectionRange(first.value.length, first.value.length); } catch (e){} }
  }
}

function quickRange(v){
  const now = new Date(), iso = d => d.toISOString().slice(0, 10), y = now.getFullYear(), m = now.getMonth(), fy = m >= 3 ? y : y - 1, qm = Math.floor(m / 3) * 3;
  if (v === "month") return [iso(new Date(Date.UTC(y, m, 1))), iso(new Date(Date.UTC(y, m + 1, 0)))];
  if (v === "last") return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))];
  if (v === "quarter") return [iso(new Date(Date.UTC(y, qm, 1))), iso(new Date(Date.UTC(y, qm + 3, 0)))];
  if (v === "fy") return [iso(new Date(Date.UTC(fy, 3, 1))), iso(new Date(Date.UTC(fy + 1, 2, 31)))];
  return ["", ""];
}
// the row of filters under the column headings (no longer shown; kept for reference)
function bankFilterRow(){
  const b = B(), f = b.f || {}, st = curStmt();
  const lo = (st && st.from) || (b.rows[0] || {}).date || "", hi = (st && st.to) || (b.rows[b.rows.length - 1] || {}).date || "";
  const modes = [["", "Any mode"], ["UPI", "UPI"], ["NEFT", "NEFT"], ["IMPS", "IMPS"], ["RTGS", "RTGS"], ["CHQ", "Cheque"], ["CASH", "Cash deposit"], ["ATM", "Cash withdrawal"], ["NACH", "NACH / ECS"], ["CARD", "Card"], ["CHARGES", "Bank charges"], ["INTEREST", "Interest"], ["TRANSFER", "Transfer"], ["OTHER", "Other"]];
  const num2 = (key, ph) => '<input type="number" data-bf="' + key + '" data-fk="bf' + key + '" placeholder="' + ph + '" value="' + esc(f[key] || "") + '" aria-label="' + ph + '">';
  return '<tr class="bk-frow"><th class="ck"></th>' +
    '<th class="dt"><input type="date"' + (b.from ? ' class="on"' : '') + ' data-bfrom data-fk="bffrom" value="' + esc(b.from || "") + '" min="' + esc(lo) + '" max="' + esc(hi) + '" aria-label="From date">' +
      '<input type="date"' + (b.to ? ' class="on"' : '') + ' data-bto data-fk="bfto" value="' + esc(b.to || "") + '" min="' + esc(lo) + '" max="' + esc(hi) + '" aria-label="To date">' +
      '<select data-bquick aria-label="Quick date range"><option value="">Quick\u2026</option><option value="all">Whole statement</option><option value="month">This month</option><option value="last">Last month</option><option value="quarter">This quarter</option><option value="fy">This year</option></select></th>' +
    '<th><div class="bk-fpair"><select' + (f.narrNot ? ' class="on"' : '') + ' data-bf="narrNot" aria-label="Contains or not"><option value=""' + (f.narrNot ? "" : " selected") + '>has</option><option value="1"' + (f.narrNot ? " selected" : "") + ">has not</option></select>" +
      '<input type="text" data-bf="narr" data-fk="bfnarr" data-keeptyped autocomplete="off" placeholder="swiggy, zomato" value="' + esc(f.narr || "") + '" aria-label="Particulars"></div>' +
      '<select' + (f.mode ? ' class="on"' : '') + ' data-bf="mode" aria-label="Mode">' + modes.map(([v, l]) => '<option value="' + v + '"' + (f.mode === v ? " selected" : "") + ">" + l + "</option>").join("") + "</select></th>" +
    '<th class="n">' + num2("wmin", "from") + num2("wmax", "to") + "</th>" +
    '<th class="n">' + num2("dmin", "from") + num2("dmax", "to") + "</th>" +
    '<th class="lg"><select' + (f.led ? ' class="on"' : '') + ' data-bf="led" aria-label="Ledger"><option value="">Any ledger</option><option value="none"' + (f.led === "none" ? " selected" : "") + '>No ledger yet</option><option value="set"' + (f.led === "set" ? " selected" : "") + ">Ledger chosen</option></select>" +
      '<input type="text" data-bf="ledText" data-fk="bfled" data-keeptyped autocomplete="off" placeholder="ledger has\u2026" value="' + esc(f.ledText || "") + '" aria-label="Ledger contains"></th>' +
    '<th class="ac">' + (bankRangeOn() ? '<button class="linkbtn" data-act="bankRangeClear">Clear</button>' : "") + "</th></tr>";
}
// One line per party among the entries to review
function bankGroups(){
  const b = B(), m = new Map();
  bankRangeRows().forEach(r => {
    if (!["attention", "suggested"].includes(r.state)) return;
    const k = r.dec.key;
    let g = m.get(k);
    if (!g){ g = {key: k, name: r.dec.name || r.dec.upi || r.narr.slice(0, 40), mode: r.dec.mode, n: 0, out: 0, inn: 0, sample: r.narr, ledgers: {}, rows: []}; m.set(k, g); }
    g.n++; g.out += r.debit; g.inn += r.credit; g.rows.push(r);
    if (r.ledger) g.ledgers[r.ledger] = (g.ledgers[r.ledger] || 0) + 1;
  });
  return Array.from(m.values()).sort((a, b2) => b2.n - a.n || (b2.out + b2.inn) - (a.out + a.inn));
}
function applyGroup(key, ledger){
  const b = B();
  const l = exactLedger(ledger);
  if (!l){ toast(ledger ? "\u201c" + ledger + "\u201d is not a Tally ledger. Choose one from the list, or create it." : "Choose a ledger first."); return; }
  const rows = b.rows.filter(r => r.dec.key === key && ["attention", "suggested", "ready"].includes(r.state));
  if (!rows.length) return;
  setLedgerFor(rows, l, "set");
  if (b.undo) b.undo.label = rows[0].dec.name || key;
  render();
}
// the bar at the bottom of the bank screen: React (app/src/screens/Bank.jsx)
// Creating a ledger that is not yet in Tally
async function openCreateLedger(name, rowId, targetFk, opts){
  opts = opts || {};
  const b = B();
  const groups = Array.from(new Set((b.ledgers.groups || []).concat(TALLY_GROUPS))).filter(Boolean);
  const row = rowId ? bankRow(rowId) : null;
  const guess = opts.group || (row ? (row.debit ? "Sundry Creditors" : "Sundry Debtors") : "Sundry Creditors");
  const acNo = row ? ((row.narr.match(/\b(\d{9,18})\b/) || [])[1] || "") : "";
  const ifsc = row ? ((row.narr.toUpperCase().match(/\b([A-Z]{4}0[A-Z0-9]{6})\b/) || [])[1] || "") : "";
  const near = Array.from(knownLedgers().values()).map(l => ({l, s: nameSim(l.name, name)})).filter(x => x.s >= 0.7).sort((a, c) => c.s - a.s).slice(0, 3);
  const ans = await askConfirm({title: "Create a ledger in Tally", ok: "Create ledger",
    body: (near.length ? '<p class="bk-warn">Similar ledgers already in Tally: ' + near.map(x => "<b>" + esc(x.l.name) + "</b>").join(", ") + ". Make sure this is a different party.</p>" : "") +
      '<div class="bk-form one"><label><span>Ledger name</span><input type="text" id="nlName" value="' + esc(name) + '"></label>' +
      '<label><span>Under (group)</span><select id="nlGroup">' + groups.map(g => "<option" + (g === guess ? " selected" : "") + ">" + esc(g) + "</option>").join("") + "</select></label>" +
      '<label><span>PAN (optional)</span><input type="text" id="nlPan" maxlength="10" value="' + esc(opts.gstin && gstinValid(opts.gstin) ? opts.gstin.slice(2, 12) : "") + '"></label><label><span>GSTIN (optional)</span><input type="text" id="nlGstin" maxlength="15" value="' + esc(opts.gstin || "") + '"></label>' +
      '<label><span>Bank account no. (optional)</span><input type="text" id="nlAc" value="' + esc(acNo) + '"></label><label><span>IFSC (optional)</span><input type="text" id="nlIfsc" value="' + esc(ifsc) + '"></label></div>' +
      '<p class="note">The ledger is created in Tally together with the entries, when you import the Tally file.</p>',
    read: () => { const v = id => (document.getElementById(id) || {}).value || ""; return {name: v("nlName").trim(), group: v("nlGroup"), pan: v("nlPan"), gstin: v("nlGstin"), ac: v("nlAc"), ifsc: v("nlIfsc")}; },
    validate: d => !d.name ? "Enter the ledger name." : (exactLedger(d.name) && !(ledgerInfo(d.name) || {}).pending) ? "\u201c" + exactLedger(d.name) + "\u201d already exists in Tally: choose it from the list." : (d.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(d.pan)) ? "The PAN does not look right." : (d.gstin && !gstinValid(d.gstin.toUpperCase())) ? "The GSTIN does not look right." : ""});
  if (!ans) return null;
  const d = ans.data;
  if (!createLedger(d.name, d.group, d.pan, d.gstin, d.ac, d.ifsc)) return null;
  if (opts.address){ const nl = B().newLed.find(l => l.name === d.name); if (nl){ nl.address = opts.address; saveBank({newLed: true}); } }
  if (opts.onCreated){ toast("Ledger \u201c" + d.name + "\u201d will be created in Tally."); opts.onCreated(d.name); return d.name; }
  if (row) setRowLedger(row, d.name);
  if (targetFk){ const inp = document.querySelector('[data-fk="' + targetFk + '"]'); if (inp) inp.value = d.name; }
  toast("Ledger \u201c" + d.name + "\u201d will be created in Tally.");
  render();
  return d.name;
}
/* ---------- ledger suggestions while typing (works the same in every browser) ---------- */
const AC = {box: null, fk: null, items: [], idx: -1, q: ""};
function acMatches(q){
  const list = Array.from(knownLedgers().values());
  const qq = q.trim().toLowerCase();
  if (!qq) return list.slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, 12).map(l => ({l, sc: 1}));
  const words = qq.split(/\s+/).filter(Boolean);
  return list.map(l => {
    const n = l.name.toLowerCase();
    let sc = 0;
    if (n === qq) sc = 100;
    else if (n.startsWith(qq)) sc = 90;
    else if (words.every(w => n.includes(w))) sc = 70 + (n.split(/[\s\-\/&.,()]+/).some(t => t.startsWith(words[0])) ? 10 : 0);
    else if (qq.length >= 3){
      // spelling mistakes: compare with the whole name, each word, and each pair of words
      const toks = n.split(/[\s\-\/&.,()]+/).filter(Boolean);
      let sim = nameSim(q, l.name);
      toks.forEach((t, i) => { sim = Math.max(sim, nameSim(qq, t), i + 1 < toks.length ? nameSim(qq, t + " " + toks[i + 1]) : 0); });
      if (sim >= 0.6) sc = sim * 60;
    }
    return {l, sc};
  }).filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc || a.l.name.length - b.l.name.length).slice(0, 12);
}
function acInput(){ return AC.fk ? document.querySelector('[data-fk="' + AC.fk.replace(/"/g, '\\"') + '"]') : null; }
function acOpen(input){
  if (!B()) return;
  // just picked: the redraw that follows puts focus back in the box, which must not open the list again
  if (AC.picked && AC.picked.fk === input.dataset.fk && Date.now() - AC.picked.at < 800 && input.value === AC.picked.value) return;
  AC.fk = input.dataset.fk;
  AC.q = input.value;
  const m = acMatches(input.value);
  const exact = m.some(x => x.l.name.toLowerCase() === input.value.trim().toLowerCase());
  AC.items = m.map(x => ({name: x.l.name, group: x.l.group || "", pending: !!x.l.pending}));
  // ledgers used before for this party come first
  const row = input.dataset.bled ? bankRow(input.dataset.bled) : null;
  const h = row ? historyFor(row) : null;
  if (h && h.ranked.length){
    const q = input.value.trim().toLowerCase();
    const known = knownLedgers();
    const past = h.ranked.filter(x => !q || x.l.toLowerCase().includes(q) || q === (row.ledger || "").toLowerCase()).slice(0, 4)
      .map(x => ({name: x.l, group: ((known.get(x.l.toLowerCase()) || {}).group || ""), used: x.n}));
    AC.items = past.concat(AC.items.filter(it => !past.some(p => p.name.toLowerCase() === it.name.toLowerCase())));
  }
  // "create" comes first, where it is seen; Enter still takes the best existing match below it
  if (input.value.trim() && !exact && hasLedgerList()) AC.items.unshift({name: input.value.trim(), create: true});
  AC.idx = !input.value.trim() || !AC.items.length ? -1 : AC.items[0].create && AC.items.length > 1 ? 1 : 0;
  if (!AC.box){ AC.box = document.createElement("div"); AC.box.id = "acBox"; AC.box.setAttribute("role", "listbox"); document.body.appendChild(AC.box); }
  acDraw(input);
}
function acDraw(input){
  if (!AC.box) return;
  if (!input || !AC.items.length){
    AC.box.style.display = "block";
    AC.box.innerHTML = '<div class="acempty">' + (knownLedgers().size ? "No Tally ledger matches \u201c" + esc(AC.q) + "\u201d" : "Import the Tally ledger list first (Bank \u2192 Settings).") + "</div>";
    if (!input){ acClose(); return; }
  } else {
    AC.box.innerHTML = AC.items.map((it, i) => '<div class="aci' + (i === AC.idx ? " on" : "") + '" data-aci="' + i + '" role="option">' +
      (it.create ? '<span class="accreate">+ Create ledger \u201c' + esc(it.name) + "\u201d\u2026</span>" : (it.used ? "<b>" + esc(it.name) + "</b>" : esc(it.name)) + " <span>" + (it.used ? '<em class="usedtag">used ' + it.used + "×</em> " : "") + esc(it.group) + (it.pending ? " · new" : "") + "</span>") + "</div>").join("");
  }
  const r = input.getBoundingClientRect();
  const below = window.innerHeight - r.bottom;
  AC.box.style.display = "block";
  AC.box.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 324)) + "px";
  AC.box.style.width = Math.max(r.width, 320) + "px";
  if (below < 260 && r.top > below){ AC.box.style.top = ""; AC.box.style.bottom = (window.innerHeight - r.top + 2) + "px"; }
  else { AC.box.style.bottom = ""; AC.box.style.top = (r.bottom + 2) + "px"; }
  const on = AC.box.querySelector(".aci.on"); if (on && on.scrollIntoView) on.scrollIntoView({block: "nearest"});
}
document.addEventListener("focusout", ev => {
  const t = ev.target;
  if (!t || !t.dataset || (t.dataset.gkey === undefined && !t.hasAttribute("data-bulkled"))) return;
  setTimeout(() => { if (document.activeElement !== t && t.value.trim() && !exactLedger(t.value)) t.classList.add("invalid"); else t.classList.remove("invalid"); }, 150);
});
function acClose(){ AC.fk = null; AC.items = []; AC.idx = -1; if (AC.box) AC.box.style.display = "none"; }
function acPick(i){
  const input = acInput(), it = AC.items[i];
  if (!input || !it) return;
  acClose();
  if (!it.create) AC.picked = {fk: input.dataset.fk, value: it.name, at: Date.now()};
  if (it.create){
    if (input.dataset.e === "partyLedger" || input.dataset.e === "expenseLedger"){
    const k = input.dataset.e, e0 = curEntry();
    input.value = e0 ? e0[k] || "" : "";
    openCreateLedger(it.name, null, null, {group: k === "partyLedger" ? "Sundry Creditors" : "Indirect Expenses", gstin: k === "partyLedger" && e0 ? fixGstin(e0.x.vendorGstin).value : "", onCreated: name => { const e1 = curEntry(); if (e1){ e1[k] = name; Store.saveEntry(S.coId, e1); } render(); }});
    return;
  }
  if (input.dataset.svcust || input.hasAttribute("data-sdcust") || input.hasAttribute("data-svbulk")){
      const v = input.dataset.svcust ? inv(input.dataset.svcust) : null;
      const d = SL() && SL().draft;
      input.value = v ? v.customerLedger || "" : input.hasAttribute("data-sdcust") && d ? d.customerLedger || "" : "";
      const gstin = v ? v.x.customerGstin : d && input.hasAttribute("data-sdcust") ? d.x.customerGstin : "";
      openCreateLedger(it.name, null, null, {group: "Sundry Debtors", gstin, address: v ? v.x.address : d ? d.x.address : "", onCreated: name => {
        if (v) setCustomerLedger(v, name);
        else if (input.hasAttribute("data-sdcust") && SL().draft) applyDraftCustomer(name);
        else if (input.hasAttribute("data-svbulk")) salesBulk("ledger", name);
        render();
      }});
      return;
    }
    input.value = input.dataset.bled ? ((bankRow(input.dataset.bled) || {}).ledger || "") : "";
    openCreateLedger(it.name, input.dataset.bled || null, input.dataset.bled ? null : input.dataset.fk);
    return;
  }
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, it.name);
  AC.picked.at = Date.now();
  if (input.dataset.bled){ input.dispatchEvent(new Event("change", {bubbles: true})); AC.picked.at = Date.now(); setTimeout(() => { const el = acInput() || document.querySelector('[data-fk="' + AC.picked.fk.replace(/"/g, '\\"') + '"]'); if (el && document.activeElement === el) el.blur(); acClose(); }, 0); }
  else if (input.hasAttribute("data-bulkled")) bulkLedgerFrom(input);
  else if (input.dataset.svcust || input.hasAttribute("data-sdcust")) input.dispatchEvent(new Event("change", {bubbles: true}));
  else if (input.dataset.e){ input.dispatchEvent(new Event("input", {bubbles: true})); input.dispatchEvent(new Event("change", {bubbles: true})); }
  else if (input.hasAttribute("data-svbulk")){ const l = exactLedger(input.value); if (l) salesBulk("ledger", l); }
}
function acAfterRender(){
  if (!AC.fk) return;
  const input = acInput();
  if (!input || document.activeElement !== input){ acClose(); return; }
  acDraw(input);
}
document.addEventListener("input", ev => { const t = ev.target; if (t && t.dataset && t.dataset.ac) acOpen(t); }, true);
document.addEventListener("focusin", ev => { const t = ev.target; if (t && t.dataset && t.dataset.ac) acOpen(t); else if (AC.fk && !(t && t.closest && t.closest("#acBox"))) acClose(); });
document.addEventListener("keydown", ev => {
  if (!AC.fk || !AC.items.length) return;
  const t = ev.target;
  if (!t.dataset || t.dataset.fk !== AC.fk) return;
  if (ev.key === "ArrowDown"){ ev.preventDefault(); AC.idx = (AC.idx + 1) % AC.items.length; acDraw(t); }
  else if (ev.key === "ArrowUp"){ ev.preventDefault(); AC.idx = (AC.idx - 1 + AC.items.length) % AC.items.length; acDraw(t); }
  else if (ev.key === "Enter" && AC.idx >= 0){ ev.preventDefault(); ev.stopPropagation(); acPick(AC.idx); }
  else if (ev.key === "Escape"){ ev.preventDefault(); ev.stopImmediatePropagation(); acClose(); }
}, true);
document.addEventListener("mousedown", ev => {
  const it = ev.target.closest && ev.target.closest("#acBox [data-aci]");
  if (it){ ev.preventDefault(); acPick(+it.dataset.aci); }
  else if (AC.fk && !(ev.target.closest && ev.target.closest("#acBox")) && !(ev.target.dataset && ev.target.dataset.fk === AC.fk)) acClose();
}, true);
window.addEventListener("resize", () => { if (AC.fk) acDraw(acInput()); });
document.addEventListener("scroll", () => { if (AC.fk) acDraw(acInput()); }, true);
/* ---------- confirmation box (browser pop-ups can be blocked inside claude.ai) ---------- */
function askConfirm(o){
  return new Promise(done => {
    let box = document.getElementById("confirmBox");
    if (!box){ box = document.createElement("div"); box.id = "confirmBox"; document.body.appendChild(box); }
    box.innerHTML = '<div class="cbx' + (o.wide ? " wide" : "") + '" role="dialog" aria-modal="true" aria-labelledby="cbxT"><h2 id="cbxT">' + esc(o.title) + "</h2>" +
      '<div class="note" style="font-size:14px;line-height:1.5">' + o.body + "</div>" +
      (o.check ? '<label class="chk" style="margin-top:10px"><input type="checkbox" id="cbxCheck"> ' + esc(o.check) + "</label>" : "") +
      '<div class="row" style="justify-content:flex-end;margin-top:16px"><button class="btn" data-cbx="no">Cancel</button><button class="btn ' + (o.danger ? "danger-fill" : "primary") + '" data-cbx="yes">' + esc(o.ok || "OK") + "</button></div></div>";
    box.style.display = "flex";
    const finish = v => {
      const chk = document.getElementById("cbxCheck"); const extra = !!(chk && chk.checked);
      const data = v && o.read ? o.read() : null;
      if (v && o.validate){ const err = o.validate(data); if (err){ let e = box.querySelector(".cbx-err"); if (!e){ e = document.createElement("p"); e.className = "cbx-err"; box.querySelector(".cbx .row").before(e); } e.textContent = err; return; } }
      box.style.display = "none"; box.innerHTML = ""; document.removeEventListener("keydown", onKey, true); done(v ? {ok: true, check: extra, data} : null);
    };
    const onKey = ev => { if (ev.key === "Escape"){ ev.preventDefault(); ev.stopPropagation(); finish(false); } else if (ev.key === "Enter" && !(ev.target && (ev.target.id === "cbxCheck" || ev.target.tagName === "SELECT"))){ ev.preventDefault(); ev.stopPropagation(); finish(true); } };
    document.addEventListener("keydown", onKey, true);
    box.onclick = ev => { const bt = ev.target.closest("[data-cbx]"); if (bt){ ev.stopPropagation(); finish(bt.dataset.cbx === "yes"); } else if (ev.target === box) finish(false); };
    if (o.onReady) try { o.onReady(box); } catch (e){}
    const first = box.querySelector("input[type=text]"); const yes = box.querySelector('[data-cbx="yes"]');
    if (first){ first.focus(); first.select(); } else if (yes) yes.focus();
  });
}
/* ---------- deleting and clearing ---------- */
async function deleteStatement(sid){
  const b = B(), st = b.stmts.find(x => x.id === sid);
  if (!st) return;
  const rows = sid === b.cur ? b.rows : ((await BankDB.get("stmt:" + b.cid + ":" + sid)) || []);
  const sent = rows.filter(r => r.state === "sent").length;
  const acc = (CO(b.cid).bankAccounts || []).find(a => a.id === st.acctId) || {};
  const ans = await askConfirm({title: "Delete this statement?", danger: true, ok: "Delete statement",
    body: "<b>" + esc(acc.ledger || st.bank) + "</b>, " + fmtDate(st.from) + " to " + fmtDate(st.to) + " (" + esc(st.fileName) + ", " + st.n + " rows).<br>" +
      "All ledger choices made on its rows are removed. Saved rules and new ledgers stay. You can upload the file again afterwards." +
      (sent ? "<br><br><b>" + sent + " entries from it were already sent to Tally.</b> Tally is not changed: if you upload it again, those rows could be sent twice. Match with the Tally bank book first." : "")});
  if (!ans) return;
  Object.keys(b.keys).forEach(k => { if (b.keys[k] === sid) delete b.keys[k]; });
  b.stmts = b.stmts.filter(x => x.id !== sid);
  await BankDB.del("stmt:" + b.cid + ":" + sid);
  saveBank({stmts: true, keys: true});
  if (b.cur === sid){ clearTimeout(bankSaveTimer); bankSaveTimer = null; b.cur = null; b.rows = []; b.sel.clear(); b.sticky.clear(); b.undo = null; }
  toast("Statement deleted.");
  if (!b.cur && b.stmts.length) await openStatement(b.stmts[b.stmts.length - 1].id); else render();
}
async function clearStatement(){
  const b = B(), st = curStmt();
  if (!st) return;
  const sent = b.rows.filter(r => r.state === "sent").length;
  const ans = await askConfirm({title: "Clear all decisions on this statement?", ok: "Clear decisions",
    body: "Every row goes back to the start: ledgers you set, accepted and ignored rows are reset, what was learnt from this statement is forgotten, and the suggestions are worked out again." +
      (sent ? " The " + sent + " rows already sent to Tally stay as they are." : "") + "<br>You can undo this from the bottom bar.",
    check: "Also forget the saved rules for this client (otherwise they fill rows again straight away)"});
  if (!ans) return;
  const snaps = b.rows.map(rowSnapshot);
  const oldRules = b.rules.slice();
  if (ans.check) b.rules = [];
  const histPrev = unlearnRows(b.rows.filter(r => r.state !== "sent"));
  b.rows.forEach(r => {
    if (r.state === "sent") return;
    Object.assign(r, {ledger: "", state: "attention", userSet: false, why: "", source: "", billId: null, billRef: "", tdsAtPay: 0, tdsLedger: "", newGroup: ""});
    delete r.prevState; delete r.tallyIdx; delete r.tallyRef;
  });
  suggestAll(b.rows);
  const acc = (CO(b.cid).bankAccounts || []).find(a => a.id === st.acctId);
  matchTallyBook(acc, b.rows);
  b.sel.clear(); b.sticky.clear();
  b.undo = {what: "clear", label: "all rows", n: snaps.length, others: 0, snaps, ruleKeys: ans.check ? oldRules.map(r => r.key) : [], oldRules: ans.check ? oldRules : []};
  if (ans.check) b.undo.restoreAllRules = oldRules;
  b.undo.histPrev = histPrev;
  b.filter = "review";
  saveBank({rows: true, rules: true});
  toast("Decisions cleared" + (ans.check ? " and rules forgotten" : "") + ".");
  render();
}
async function deleteAllStatements(){
  const b = B();
  if (!b.stmts.length){ toast("There are no statements to delete."); return; }
  const ans = await askConfirm({title: "Delete all bank statements of " + CO(b.cid).name + "?", danger: true, ok: "Delete all " + b.stmts.length,
    body: b.stmts.length + " statements and every decision on them are removed. Tally is not changed.",
    check: "Also delete saved rules, learnt history, new ledgers not yet sent, and the Tally bank books"});
  if (!ans) return;
  clearTimeout(bankSaveTimer); bankSaveTimer = null;
  for (const st of b.stmts) await BankDB.del("stmt:" + b.cid + ":" + st.id);
  b.stmts = []; b.keys = {}; b.cur = null; b.rows = []; b.sel.clear(); b.sticky.clear(); b.undo = null; b.lastFail = null;
  if (ans.check){ b.rules = []; b.newLed = b.newLed.filter(l => l.sent); b.books = {}; b.hist = {rows: {}}; b.histVer++; }
  saveBank({stmts: true, keys: true, rules: true, newLed: true, books: true, hist: true});
  toast("All bank statements deleted" + (ans.check ? ", with rules and bank books" : "") + ".");
  render();
}
async function clearHistory(){
  const b = B(), n = Object.keys(b.hist.rows).length;
  if (!n){ toast("Nothing has been learnt yet."); return; }
  const ans = await askConfirm({title: "Forget the learnt history?", danger: true, ok: "Forget history",
    body: n + " past decisions are forgotten. Rows already filled keep their ledgers; saved rules stay."});
  if (!ans) return;
  b.hist = {rows: {}}; b.histVer++;
  saveBank({hist: true});
  toast("History forgotten.");
  render();
}
async function clearRules(){
  const b = B();
  if (!b.rules.length){ toast("There are no saved rules."); return; }
  const ans = await askConfirm({title: "Forget all " + b.rules.length + " saved rules?", danger: true, ok: "Forget rules",
    body: "Rows already filled keep their ledgers. New statements will no longer be filled from these rules."});
  if (!ans) return;
  b.rules = [];
  saveBank({rules: true});
  toast("Rules forgotten.");
  render();
}
function bankRow(id){ const b = B(); return b && b.rows.find(r => r.id === id); }
// one line's buttons: rule, notintally, unpost, post, accept, ignore, restore, unready
function bankRowAct(a, id){
  const b = B(); if (!b) return true;
  if (a === "rule"){
    const row = bankRow(id);
    if (!row) return true;
    openRuleEditor(ruleFromRow(row), true).then(r => {
      if (!r) return;
      (r.scope === "firm" ? firmRules() : clientRules()).unshift(r);
      saveRules(r.scope);
      const n = runRules(null, {force: true});
      toast("Rule saved \u00b7 " + n + " lines set.");
      render();
    });
    return true;
  }
  if (a === "notintally"){
    const row = bankRow(id);
    if (row && B().postedTags){ delete B().postedTags[fpHash(row.fp || row.id)]; row.postError = ""; saveBank({rows: true, posted: true}); toast("It will be checked in Tally again, then posted."); render(); }
    return true;
  }
  if (a === "unpost"){
    const row = bankRow(id);
    if (row) unpostFromTally("bank", row, B().cid).then(ok => {
      if (!ok) return;
      row.state = row.ledger ? "ready" : "attention"; row.sentAt = ""; row.postVerified = false; row.tally = null;
      if (B().postedTags) delete B().postedTags[fpHash(row.fp || row.id)];
      saveBank({rows: true, posted: true}); render();
    });
    return true;
  }
  if (a === "post"){ postBankToTally([id]); return true; }
  {
    const r = bankRow(id); if (!r) return true;
    b.undo = {what: a === "accept" ? "accept" : a, label: "1 entry", n: 1, others: 0, snaps: [rowSnapshot(r)], ruleKeys: [], oldRules: []};
    b.sticky.add(r.id);
    if (a === "accept"){
      const l = exactLedger(r.ledger);
      if (!l){ b.undo = null; toast("Choose a Tally ledger first."); return true; }
      r.ledger = l; r.state = "ready"; b.undo.histPrev = learnRows([r], "accepted");
    }
    if (a === "ignore"){ r.prevState = r.state; r.state = "ignored"; b.undo.histPrev = unlearnRows([r]); }
    if (a === "restore"){ r.state = exactLedger(r.ledger) ? "ready" : "attention"; delete r.tallyIdx; }
    if (a === "unready"){ r.state = r.ledger ? "suggested" : "attention"; r.userSet = false; b.undo.histPrev = unlearnRows([r]); }
    saveBank({rows: true}); render(); return true;
  }
}
// the React bank screen (app/src/screens/Bank.jsx)
function bankTabGo(k){ const b = B(); b.focus = null; b.filter = k; b.limit = 100; b.sticky.clear(); b.sel.clear(); render(); }
function bankSetGrouped(on){ const b = B(); b.grouped = on; b.limit = 100; b.sel.clear(); render(); }
function bankSearch(q){ const b = B(); b.q = q; b.sticky.clear(); FinComReact.redraw(); later("bq", render, 250); }
// a line's ledger, typed or picked; returns false when it is not a Tally ledger (the box goes back to the line's ledger)
function bankSetLedger(id, v){
  const b = B(), r = bankRow(id); if (!r) return true;
  v = String(v || "").trim();
  if (!v){ if (r.ledger){ setRowLedger(r, ""); saveBank({rows: true}); render(); } return true; }
  const l = exactLedger(v);
  if (!l){ toast("\u201c" + v + "\u201d is not a Tally ledger. Choose one from the list, or create it."); return false; }
  if (b.sel.has(r.id) && b.sel.size > 1){ acClose(); bulkAction("ledger", l); return true; }
  if (l !== r.ledger || r.state !== "ready"){ setRowLedger(r, l); saveBank({rows: true}); render(); }
  return true;
}
// which Tally ledger a bank account is
function bankSetAccLedger(accId, v){
  const b = B(), co = CO(), a = (co.bankAccounts || []).find(x => x.id === accId);
  if (a){ a.ledger = v; Store.saveCompany(co); suggestAll(b.rows, true); saveBank({rows: true}); render(); }
}
// tick a line; with Shift, every line between it and the one ticked before
function bankToggleRow(id, on, shift){ bankToggle({dataset: {bsel: id}, checked: on}, shift); }
function bankSelAll(on){ const b = B(); bankVisibleRows().filter(r => r.state !== "sent").forEach(r => { if (on) b.sel.add(r.id); else b.sel.delete(r.id); }); bankLightRefresh(); }
// a client's bank settings and rules (app/src/parts/BankSettings.jsx): the settings shown or not, a standard entry's
// ledger, an automation choice, and a rule changed, paused, deleted (asked first), moved or copied to other clients
// the checks over a statement (app/src/parts/BankChecks.jsx): show only some lines, tick an entry to delete from Tally
function bankFocusGo(title, ids, note){ bankFocus(title, [].concat(ids || []), note || ""); render(); window.scrollTo({top: 0, behavior: "smooth"}); }
function reconPick(i, on){ if (!S.recon) return; if (on) S.recon.pick.add(i); else S.recon.pick.delete(i); render(); }
function bankSettingsShow(on){ B().showSettings = on; render(); }
function bankStdLedger(k, v){ const b = B(), co = CO(); co.bankLedgerNames = co.bankLedgerNames || {}; co.bankLedgerNames[k] = v; Store.saveCompany(co); suggestAll(b.rows, true); saveBank({rows: true}); render(); }
function bankOptSet(k, on){ const co = CO(); co[k] = on; Store.saveCompany(co); render(); }
function ruleAct(what, id){
  if (what === "copy"){ const r = clientRules().find(x => x.id === id); if (r) copyRulesTo([r]); return; }
  const inClient = clientRules().some(x => x.id === id);
  const list = inClient ? clientRules() : firmRules();
  const i = list.findIndex(x => x.id === id), r = list[i];
  if (!r) return;
  if (what === "toggle"){ r.off = !r.off; saveRules(r.scope); runRules(null, {force: true}); toast(r.off ? "Rule paused." : "Rule in use again."); render(); return; }
  if (what === "del"){
    askConfirm({title: "Delete the rule \u201c" + ruleLabel(r) + "\u201d?", ok: "Delete", body: '<p class="note">Lines already set keep their ledger. Future statements will not use this rule.</p>'}).then(a => {
      if (!a) return;
      list.splice(i, 1); saveRules(r.scope); toast("Rule deleted."); render();
    });
    return;
  }
  if ((what === "up" || what === "down")){
    const j = what === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return;
    list.splice(j, 0, list.splice(i, 1)[0]);
    saveRules(r.scope); runRules(null, {force: true}); render();
    return;
  }
  openRuleEditor(JSON.parse(JSON.stringify(r)), false).then(nr => {
    if (!nr) return;
    if (nr.scope !== r.scope){ list.splice(i, 1); (nr.scope === "firm" ? firmRules() : clientRules()).unshift(nr); saveRules("firm"); saveRules("client"); }
    else list[i] = nr;
    saveRules(nr.scope);
    const n = runRules(null, {force: true});
    toast("Rule saved" + (n ? " \u00b7 " + n + " lines set" : "") + ".");
    render();
  });
  return;
}
function bankClick(t){
  const b = B(); if (!b) return false;
  if (t.dataset.btab){ bankTabGo(t.dataset.btab); return true; }
  if (t.dataset.delstmt){ deleteStatement(t.dataset.delstmt); return true; }
  if (t.dataset.brow){ bankRowAct(t.dataset.brow, t.dataset.rid); return true; }
  switch (t.dataset.act){
    case "bankPick": document.getElementById("bankIn").click(); return true;
    case "ledPick": document.getElementById("ledIn").click(); return true;
    case "bookPick": closeMenus(); document.getElementById("bookIn").click(); return true;
    case "bankSettings": b.showSettings = true; render(); return true;
    case "bankSettingsClose": b.showSettings = false; render(); return true;
    case "bankMore": b.limit += 200; render(); return true;
    case "bankCsv": closeMenus(); exportBankCsv(); return true;
    case "bankDismissFail": b.lastFail = null; render(); return true;
    case "bankCopyReport": {
      const txt = b.lastFail ? b.lastFail.report : "";
      const fallback = () => { const box = document.getElementById("bankReport"); if (box){ box.hidden = false; box.select(); } toast("Select the text and copy it."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast("Copied. Paste it into the chat."), fallback); else fallback();
      return true;
    }
    case "bankXml": exportBankXml(); return true;
    case "bankFile": closeMenus(); exportBankXml(); return true;
    case "bankDismissMoved": b.moved = null; render(); return true;
    case "bankOpenMoved": { const m = b.moved; b.moved = null; if (m){ openCompany(m.cid).then(() => { S.tab = "bank"; render(); }); } return true; }
    case "ruleNew": {
      openRuleEditor(newRule(), true).then(r => {
        if (!r) return;
        (r.scope === "firm" ? firmRules() : clientRules()).unshift(r);
        saveRules(r.scope);
        const n = runRules(null, {force: false});
        toast("Rule saved" + (n ? " \u00b7 " + n + " lines set" : "") + ".");
        render();
      });
      return true;
    }
    case "ruleNoThanks": { B().offerRule = null; render(); return true; }
    case "ruleFromBulk": {
      const o = B().offerRule; if (!o) return true;
      B().offerRule = null;
      const r0 = newRule({name: o.ledger, when: {text: [{op: "has", v: o.text}], dir: o.dir, amtMin: "", amtMax: "", modes: [], acNo: "", account: "any", from: "", to: ""},
        then: {action: "set", ledger: o.ledger, kind: "", vtype: "", tdsNature: "", tdsAtPay: false, splits: [], narr: "", ready: true}});
      openRuleEditor(r0, true).then(r => {
        if (!r){ render(); return; }
        (r.scope === "firm" ? firmRules() : clientRules()).unshift(r);
        saveRules(r.scope);
        const n = runRules(null, {force: false});
        toast("Rule saved \u00b7 future statements will follow it" + (n ? " \u00b7 " + n + " set now" : "") + ".");
        render();
      });
      return true;
    }
    case "ruleFind": {
      S.ruleSuggest = suggestRules();
      toast(S.ruleSuggest.length ? S.ruleSuggest.length + " rules can be made from past work." : "Nothing repeated often enough yet.");
      render(); return true;
    }
    case "ruleFindClose": S.ruleSuggest = null; render(); return true;
    case "ruleMakeSug": {
      const list = S.ruleSuggest || [];
      const picked = list.filter((x, i) => { const el = document.querySelector('[data-sug="' + i + '"]'); return el && el.checked; });
      if (!picked.length){ toast("Tick at least one."); return true; }
      picked.forEach(sg => {
        clientRules().unshift(newRule({name: sg.ledger + " \u2013 " + sg.text,
          when: {text: [{op: "has", v: sg.text}], dir: sg.dir, amtMin: "", amtMax: "", modes: [], acNo: "", account: "any", from: "", to: ""},
          then: {action: "set", ledger: sg.ledger, kind: "", vtype: "", tdsNature: "", tdsAtPay: false, splits: [], narr: "", ready: true}}));
      });
      saveRules("client");
      S.ruleSuggest = null;
      const n = runRules(null, {force: false});
      toast(picked.length + " rules made" + (n ? " \u00b7 " + n + " lines set now" : "") + ".");
      render(); return true;
    }
    case "ruleCopyAll": copyRulesTo(clientRules().filter(r => !r.off)); return true;
    case "ruleRunNow": { const n = runRules(null, {force: true}); toast(n ? n + " lines set by your rules." : "No line matched a rule."); render(); return true; }
    case "bankApplyAll": applyToVisible((B().allLed || "").trim()); return true;
    case "bankClearSearch": { const b2 = B(); b2.q = ""; b2.allLed = ""; render(); return true; }
    case "bankPost": {
      // with a date range chosen, only the ready lines inside it are posted
      if (bankRangeOn()){ const ids = B().rows.filter(r => r.state === "ready" && inBankRange(r)).map(r => r.id); if (!ids.length){ toast("No ready lines in this date range."); return true; } postBankToTally(ids); }
      else postBankToTally();
      return true;
    }
    case "fixFree": fixBreaks(null); return true;
    case "fixGoogle": fixBreaks("google"); return true;
    case "fixClaude": fixBreaks("claude"); return true;
    case "bankRetryFree": case "bankRetryGoogle": case "bankRetryClaude": {
      const b = B(), f = b && b.lastFile;
      if (!f){ toast("Upload the statement again: the file is not held on this computer."); return true; }
      b.lastFail = null; render();
      const how = t.dataset.act;
      uploadStatements([f], how === "bankRetryGoogle" ? "google" : how === "bankRetryClaude" ? "claude" : null);
      return true;
    }
    case "bankRangeClear": { const b = B(); b.from = ""; b.to = ""; b.f = {}; b.sel.clear(); render(); return true; }
    case "bankBulkPost": { const ids = b.rows.filter(r => b.sel.has(r.id) && r.state === "ready").map(r => r.id); b.sel.clear(); postBankToTally(ids); return true; }
    case "bankReportOk": b.postReport = null; render(); return true;
    case "bankFocusOff": b.focus = null; render(); return true;
    case "goneBack": goneBack(); return true;
    case "balHide": { const st = curStmt(); if (st){ st.tallyBalHidden = st.tallyBal ? st.tallyBal.at : "none"; saveBank({stmts: true}); render(); } return true; }
    case "reconRun": closeMenus(); reconcileBank(); return true;
    case "reconClose": S.recon = null; render(); return true;
    case "reconPost": reconPost(); return true;
    case "reconDelete": reconDelete("delete"); return true;
    case "reconReplace": reconDelete("replace"); return true;
    case "goneKeep": b.gone = null; render(); return true;
    case "goneCheck": checkMarkedInTally(); return true;
    case "bankBalCheck": closeMenus(); checkBankBalance(); return true;
    case "bankBalWhy": checkBankBalance({explain: true}); return true;
    case "dupFind": closeMenus(); findTallyDuplicates(); return true;
    case "dupRemove": removeTallyDuplicates("extra"); return true;
    case "dupRemoveWrong": removeTallyDuplicates("wrong"); return true;
    case "dupClose": S.dupFind = null; render(); return true;
    case "bankCheckTally": {
      closeMenus();
      const b2 = B();
      ensureTallyCompany(CO(b2.cid)).then(n => {
        if (!n) return;
        b2.busy = "Reading the bank ledger from Tally\u2026"; render();
        const before = new Set(b2.rows.filter(r => r.state === "intally").map(r => r.id));
        syncBankBookFromTally(true).then(() => {
          b2.busy = ""; b2.checkedAt = Date.now();
          const now = b2.rows.filter(r => r.state === "intally"), fresh = now.filter(r => !before.has(r.id));
          if (fresh.length) bankFocus("found in Tally just now", fresh.map(r => r.id), "These lines are already in Tally, so they will not be posted. Each shows how it was matched.");
          toast(fresh.length ? fresh.length + " more line" + (fresh.length === 1 ? " was" : "s were") + " found in Tally (" + now.length + " in all)." : "No more lines found in Tally (" + now.length + " already marked).");
          render();
        }, e => { b2.busy = ""; toast("Could not read: " + e.message); render(); });
      });
      return true;
    }
    case "bankSync": closeMenus(); ensureTallyCompany(CO(b.cid)).then(n => { if (n) bankAutoSync(true).then(() => toast("Refreshed from Tally.")); }); return true;
    case "bankClaude": closeMenus(); askClaudeForLedgers(); return true;
    case "bankAcceptAll": {
      const rows = b.rows.filter(r => r.state === "suggested" && exactLedger(r.ledger));
      if (!rows.length) return true;
      b.undo = {what: "accept", label: "suggestions", n: rows.length, others: 0, snaps: rows.map(rowSnapshot), ruleKeys: [], oldRules: []};
      rows.forEach(r => { r.ledger = exactLedger(r.ledger); r.state = "ready"; b.sticky.add(r.id); });
      b.undo.histPrev = learnRows(rows, "accepted");
      saveBank({rows: true}); render(); return true;
    }
    case "bankUndo": undoBank(); render(); return true;
    case "bankUndoOk": b.undo = null; bankLightRefresh(); return true;
    case "bankForget": forgetUndoRule(); b.undo = null; toast("Applied, but not remembered for next time."); bankLightRefresh(); return true;
    case "bankSelNone": b.sel.clear(); bankLightRefresh(); return true;
    case "bankBulkAccept": bulkAction("accept"); return true;
    case "bankBulkIgnore": bulkAction("ignore"); return true;
    case "bankBulkRestore": bulkAction("restore"); return true;
    case "bankBulkLedger": { const inp = document.querySelector("[data-bulkled]"); bulkLedgerFrom(inp); return true; }
    case "bankDelStmt": closeMenus(); if (b.cur) deleteStatement(b.cur); return true;
    case "bankClearStmt": closeMenus(); clearStatement(); return true;
    case "bankDelAll": deleteAllStatements(); return true;
    case "bankClearRules": clearRules(); return true;
    case "bankClearHist": clearHistory(); return true;
  }
  return false;
}
function closeMenus(){ document.querySelectorAll(".bk-menu[open]").forEach(d => d.removeAttribute("open")); }
function bulkLedgerFrom(inp){
  const v = inp ? inp.value.trim() : "";
  if (!v){ toast("Choose the ledger for the selected entries."); return; }
  const l = exactLedger(v);
  if (!l){ toast("\u201c" + v + "\u201d is not a Tally ledger. Choose one from the list, or create it."); return; }
  acClose();
  bulkAction("ledger", l);
}
// a figure typed into GSTR-3B (4(B)(2), 4(D)(1)), from app/src/screens/gst/Returns.jsx: what = "rev2.igst", …; kept for the GSTIN and month
function gst3bSet(what, val){
  const b = S.books, k = (S.gstReg || "") + "|" + S.gstYm, [grp, hd] = what.split(".");
  b.gst3b = Object.assign({}, b.gst3b); b.gst3b[k] = Object.assign({}, b.gst3b[k]); b.gst3b[k][grp] = Object.assign({}, b.gst3b[k][grp], {[hd]: val === "" ? "" : num(val)});
  saveBooks(); render();
}
// amendments (app/src/screens/gst/Workings.jsx): how an earlier month's document is reported now, and a filed copy
// marked as never filed
function amendSetAct(id, act){ const b = S.books; b.amendFix = Object.assign({}, b.amendFix, {[id]: act}); saveBooks(); render(); }
function filedSetNotFiled(key, on){ const f = (S.books.filed || {})[key]; if (f){ f.notFiled = !!on; saveBooks(); render(); } }
// advances: what the user corrects about one receipt (rate, not an advance, is an advance, the month it was billed)
function advFix(id, key, val){
  const b = S.books; b.advFix = b.advFix || {};
  const f = Object.assign({}, b.advFix[id], {[key]: val});
  Object.keys(f).forEach(k => { if (f[k] === "" || f[k] === false || f[k] == null) delete f[k]; });
  if (Object.keys(f).length) b.advFix[id] = f; else delete b.advFix[id];
  saveBooks(); render();
}
// rule 43: a capital good's name, date put to use, credit, use, registration, date sold
function assetSet(id, k, v){ const a = (S.books.assets || []).find(x => x.id === id); if (a){ a[k] = /^(igst|cgst|sgst|cess)$/.test(k) ? r2(num(v)) : v; saveBooks(); render(); } }
function assetRemove(id){ S.books.assets = (S.books.assets || []).filter(a => a.id !== id); saveBooks(); render(); }
// GSTR-9 and 9C (app/src/screens/gst/Annual.jsx): figures not in the books, typed once for the year and GSTIN
function gst9Where(){ const b = S.books; return {fy: GST9.fyOf(S.gstYm || GSTR.months().slice(-1)[0]), reg: S.gstReg || ((GSTR.gstins(b) || [])[0] || "").slice(0, 2)}; }
function gst9Typed(k, f, v){ const w = gst9Where(), st = GST9.typed(w.fy, S.gstReg || ""); st[k] = Object.assign({}, st[k], {[f]: v === "" ? "" : num(v)}); if (Object.values(st[k]).every(x => x === "")) delete st[k]; saveBooks(); render(); }
// 9C: key is "turnover", "itcBooks", "adj.5B", "reasons.6"…; reasons are text, the rest amounts
function gst9cSet(key, v){
  const w = gst9Where(), st = GST9C.st(w.fy, w.reg), val = key.startsWith("reasons.") ? v : (v === "" ? "" : num(v));
  if (key.startsWith("adj.")) st.adj[key.slice(4)] = val; else if (key.startsWith("reasons.")) st.reasons[key.slice(8)] = val; else st[key] = val;
  saveBooks(); render();
}
// a Tally ledger's GST or TDS meaning, set on the Tally ledgers tab (app/src/screens/books/Ledgers.jsx): what (the
// kind), tax, side, reg, gstRate, section, rate. A choice made here is the user's own: it counts as confirmed
function lmSet(name, key, val){
  const b = S.books, m = b.map[name] = b.map[name] || {n: 0};
  if (key === "what") LedMaster.applyWhat(m, val || "none");
  if (key === "tax" || key === "side" || key === "reg") m[key] = val;
  if (key === "gstRate") m.gstRate = val ? num(val) : null;
  if (key === "section") m.section = String(val).toUpperCase().replace(/\s+/g, "");
  if (key === "rate") m.rate = val === "" ? null : num(val);
  m.byHand = true; m.ok = true; m.okAt = new Date().toISOString();
  LedMaster.tplLearn(b, [name]); try { LedMaster.applyPosting(b, CO(), "empty"); } catch (e){}
  b.mapV = (b.mapV || 0) + 1; b.reco = null; saveBooks(); render();
}
function lmConfirmToggle(name){ const m = S.books.map[name]; if (m){ LedMaster.confirm(S.books, [name], !m.ok); S.books.reco = null; saveBooks(); render(); } }
function lmViewGo(v){ S.lmView = v; S.booksTab = "ledgers"; render(); }
function lmPost(k){ LedMaster.applyPosting(S.books, CO(), k); render(); }
// the Audit tab (app/src/screens/books/Audit.jsx): the period, how often it runs by itself, and a finding's status
// or note (kept with the books)
// Accounts (app/src/screens/books/Accounts.jsx): the format, the year, stock, a manufacturer, shares, a ledger placed by
// hand (the statements are worked out again) or given back to the rule
function fsKindSet(v){ const b = S.books; b.fs = Object.assign({}, FS.cfg(b), {kind: v}); S.fsRun = null; saveBooks(); render(); }
function fsFyGo(v){ S.fsFy = v; S.fsRun = null; render(); }
function fsStockSet(which, v){ const b = S.books, c = FS.cfg(b); c.stock = Object.assign({}, c.stock, {[which]: v === "" ? "" : num(v)}); b.fs = c; saveBooks(); }
function fsSet(key, v){ const b = S.books; b.fs = Object.assign({}, FS.cfg(b), {[key]: v}); saveBooks(); }
function fsRedo(c){ S.books.fs = c; S.fsRun = S.fsRun ? {fy: S.fsRun.fy, kind: c.kind, d: FS.build(S.fsRun.fy)} : null; saveBooks(); render(); }
function fsMapSet(l, v){ const c = FS.cfg(S.books); c.map = Object.assign({}, c.map, {[l]: v}); fsRedo(c); }
function fsUnmap(l){ const c = FS.cfg(S.books); delete c.map[l]; fsRedo(c); }
// MIS (app/src/screens/books/Mis.jsx): its period and quick picks, the tab, how often it runs by itself, a supplier
// marked MSME (the run is worked out again), a month of the budget
function misRangeSet(key, v){ const x = misRangeQuick("ytd", S.books); S.misRange = Object.assign({from: Audit.iso(x.from), to: Audit.iso(x.to)}, S.misRange, {[key]: v}); render(); }
function misQuickGo(k){ const x = misRangeQuick(k, S.books); S.misRange = {from: Audit.iso(x.from), to: Audit.iso(x.to)}; render(); }
function misTabGo(id){ S.misTab = id; S.misQ = ""; S.misF = ""; render(); }
function misFreqSet(v){ const b = S.books; b.misCfg = Object.assign({}, b.misCfg, {freq: v}); saveBooks(); render(); }
function misMsmeSet(party, v){ const b = S.books; b.msme = Object.assign({}, b.msme, {[party]: v}); const r = (b.mis || {}).last; if (r) MIS.run(r.from, r.to, r.how); saveBooks(); render(); }
function misBudSet(h2, mm, v){ const b = S.books, fy = Audit.fyStart(mm + "01").slice(0, 4); b.budget = b.budget || {}; b.budget[fy] = b.budget[fy] || {}; b.budget[fy][h2] = Object.assign({}, b.budget[fy][h2], {[mm]: v === "" ? "" : num(v)}); saveBooks(); render(); }
function auditRangeSet(key, v){ const dr = Audit.defaultRange(S.books); S.auditRange = Object.assign({from: Audit.iso(dr.from), to: Audit.iso(dr.to)}, S.auditRange, {[key]: v}); }
function auditFreqSet(v){ const b = S.books; b.auditCfg = Object.assign({}, b.auditCfg, {freq: v}); saveBooks(); render(); }
function auditFindingSet(id, key, v){
  const au = S.books.audit = S.books.audit || {st: {}};
  au.st = au.st || {}; const cur = Object.assign({s: "open"}, au.st[id]);
  if (key === "s") cur.s = v; else cur.note = v;
  cur.at = new Date().toISOString(); au.st[id] = cur; saveBooks(); render();
}
// related parties: a ledger added (from the list or a guess), its relation, removed
function relAdd(name){ const b = S.books; if (!(b.auditRel || []).some(x => x.name === name)) b.auditRel = (b.auditRel || []).concat([{name, relation: ""}]); saveBooks(); render(); }
function relSet(name, relation){ const x = (S.books.auditRel || []).find(z => z.name === name); if (x){ x.relation = relation; saveBooks(); render(); } }
function relRemove(name){ const b = S.books; b.auditRel = (b.auditRel || []).filter(x => x.name !== name); saveBooks(); render(); }
// what the user corrects on the Advances and Reversal screens
function gstFixChange(t){
  const d = t.dataset, b = S.books;
  if (d.itctemail !== undefined || d.itctphone !== undefined){ const st = ITCT.store(S.gstReg || ""), k = d.itctemail !== undefined ? d.itctemail : d.itctphone; st.contact[k] = Object.assign({}, st.contact[k], d.itctemail !== undefined ? {email: t.value.trim()} : {phone: t.value.trim()}); saveBooks(); return true; }
  if (d.itcbasis !== undefined){ b.itcBasis = Object.assign({}, b.itcBasis, {[S.gstReg || ""]: t.value}); saveBooks(); render(); return true; }
  if (d.gstopen !== undefined){ const k = S.gstReg || ""; b.gstOpen = Object.assign({}, b.gstOpen); b.gstOpen[k] = Object.assign({}, b.gstOpen[k], {[d.gstopen]: t.value === "" ? "" : num(t.value)}); saveBooks(); render(); return true; }
  if (d.revd2 !== undefined){ b.rev = Object.assign({}, b.rev, {d2: !!t.checked}); saveBooks(); render(); return true; }
  return false;
}
// build 195: a file exported from another Tally company is never taken into this client's books. Once a client has a
// file, every later file must come from the same company (same name, or the same company part of the GUIDs); the first
// file's company must be the client's (its Tally name or name), or the person says it is
async function companyGate(fc, b, co, fname, quiet){
  if (!fc || !(fc.name || fc.guid)) return {ok: true};
  const n = x => String(x || "").toLowerCase().replace(/\(\s*\d{4}\s*-\s*\d{2,4}\s*\)/g, "").replace(/[^a-z0-9]/g, "");
  const had = b.tallyCo;
  if (had && (had.guid || had.name)){
    const same = (had.guid && fc.guid) ? had.guid === fc.guid : n(had.name) === n(fc.name);
    if (!same){
      const why = n(had.name) === n(fc.name)
        ? fname + " is from another Tally company that has the same name (\u201c" + fc.name + "\u201d). Choose the file exported from the company these books came from."
        : fname + " is from the Tally company \u201c" + (fc.name || "another company") + "\u201d; the books here are from \u201c" + (had.name || "another company") + "\u201d. Choose the file exported from that company.";
      if (!quiet) askConfirm({title: "This file is from another Tally company", ok: "Close", body: '<p class="note">' + esc(why) + "</p>"});
      return {ok: false, why};
    }
    return {ok: true};
  }
  const names = [co && co.tallyName, co && co.name].filter(Boolean).map(n);
  const gstOk = fc.gstin && co && co.gstin && fc.gstin.slice(2, 12) === String(co.gstin).toUpperCase().slice(2, 12);
  if (!fc.name || gstOk || names.some(x => x && (x === n(fc.name) || x.includes(n(fc.name)) || n(fc.name).includes(x)))) return {ok: true};
  if (quiet) return {ok: true};                       // the upload for several clients: the person matched it there
  const r = await askConfirm({title: "Is this the right company?", ok: "Yes, take it", body: '<p class="note">' + esc(fname) + " was exported from the Tally company <b>" + esc(fc.name) + "</b>. The client open here is <b>" + esc((co && co.name) || "") + "</b>" + (co && co.tallyName ? " (in Tally: " + esc(co.tallyName) + ")" : "") + ". Take it into this client\u2019s books?</p>"});
  return r && r.ok ? {ok: true} : {ok: false, why: "not taken: it is from " + fc.name};
}
// build 195: a day book file for the client open (S.books): its company checked, then only the dates chosen replaced.
// opts.quiet: from the upload for several clients (the mapping was confirmed there; the answer is returned, not shown)
async function bringDayBookFile(f, from0, to0, opts){
  opts = opts || {};
  const b = S.books; b.busy = "Opening " + f.name + "\u2026"; render();
  const who = {client: S.coId, company: BridgeSeed.company()};           // fixed now: the background sends below keep to this client
  let fc = null; try { fc = await Books.fileCompany(f); } catch (e){}
  const gate = await companyGate(fc, b, CO(), f.name, opts.quiet);
  if (!gate.ok){ b.busy = ""; render(); return {refused: gate.why}; }
    return Books.importDayBook(f, m => { b.busy = m; softRender(); }).then(async res => {
      const bad = notThisClient((res.meta || {}).gstins);
      if (bad.length){ b.busy = ""; render(); if (opts.quiet) return {refused: panRefusal("The day book " + f.name, bad)}; askConfirm({title: "This day book is not this client\u2019s", ok: "Close", body: '<p class="note">' + esc(panRefusal("The day book " + f.name, bad)) + " Choose the day book exported from this client\u2019s company in Tally, or correct the client\u2019s GSTIN and PAN in Client setup.</p>"}); return; }
      // a part: the dates chosen (or the file's own first and last date); only those dates are replaced, the rest stays
      const ds = res.vouchers.map(v => v.date).filter(Boolean).sort();
      const from = from0 || ds[0], to = to0 || ds[ds.length - 1];
      if (!from || !to){ b.busy = ""; render(); if (!opts.quiet) toast("There are no entries in " + f.name + "."); return {refused: "no entries in the file"}; }
      const inside = res.vouchers.filter(v => v.date >= from && v.date <= to), outside = res.vouchers.length - inside.length;
      if (!(b.vouchers || []).length){ b.vouchers = inside; b.meta = Object.assign(res.meta, {from, to}); }
      else TallyRead.merge(b, {vouchers: inside, meta: res.meta}, from, to);
      b.meta.at = new Date().toISOString(); b.meta.file = "day book files from Tally";
      const part = {from, to, n: inside.length, file: f.name, at: b.meta.at};
      b.meta.parts = ((b.meta.parts || []).filter(p => !(p.from >= from && p.to <= to))).concat([part]);
      b.map = Books.mapLedgers(b.vouchers, b.map); LedMaster.refresh(b); b.busy = "";
      TallyRead.after(b, "after the day book was read", {from: b.meta.from, to: b.meta.to});
      if (fc && (fc.name || fc.guid) && !b.tallyCo) b.tallyCo = {name: fc.name, guid: fc.guid};
      await saveBooks();
      if (!opts.quiet) toast(inside.length + " entries of " + fmtDate(tallyDate(from)) + " to " + fmtDate(tallyDate(to)) + " brought in" + (outside ? " (" + outside + " outside those dates left out)" : "") + ". Choose the next part, or check the ledgers, then TDS and GST.");
      // the same file fills the bridge's copy for these dates (the bridge never reads them from Tally itself) and FinCom's
      // cloud (everyone in the firm sees the same books)
      (async () => {
        const step = m => { b.busy = m; softRender(); };
        if (Bridge.on()){
          try { const r = await BridgeSeed.send(f, step, {from, to}, who.company); part.bridge = r && r.entries != null ? "filled (" + r.entries + ")" : r && r.skipped ? "not changed: " + r.skipped : ""; }
          catch (e){ part.bridge = "not taken: " + ((e && e.message) || e); }
        } else part.bridge = "not connected on this computer";
        if (TCloudUp.on()){
          // quietly, in the background: nothing on the screen unless it fails
          try { const r = await TCloudUp.days(await f.text(), {from, to}, null, who); part.cloud = r && r.days != null ? "in the cloud (" + r.days + " days)" : (r && r.skipped) || ""; }
          catch (e){ part.cloud = "not sent: " + ((e && e.message) || e); toast("Saved here, but it could not be shared with the firm just now (" + ((e && e.message) || e) + "). Choose the file again later."); }
        } else part.cloud = "sign in to the firm account to share it";
        b.busy = ""; await saveBooks(null, b); render();          // these books, even if another client is open by now
      })();
      render();
      return {n: inside.length, from, to};
    }, e => { b.busy = ""; if (!opts.quiet) toast("Could not read that file: " + (e && e.message || e)); render(); return {refused: "could not read it: " + ((e && e.message) || e)}; });
}
function booksChange(t){
  if (t.id === "booksIn"){
    const f = (t.files || [])[0]; t.value = "";
    if (!f) return true;
    const iso8 = v => String(v || "").replace(/-/g, "");
    bringDayBookFile(f, iso8(S.dbFrom), iso8(S.dbTo));
    return true;
  }
  if (t.id === "tbIn"){
    const f = (t.files || [])[0]; t.value = "";
    if (!f) return true;
    const b = S.books, on = String(S.tbOn || tbDefaultOn(b) || "").replace(/-/g, "");
    if (!/^\d{8}$/.test(on)){ toast("Give the date of the trial balance (the day before the first date of the books) first."); return true; }
    f.text().then(async text => {
      const r = TBFile.read(text, b);
      const odd = TBFile.foreign(r, b); if (odd){ askConfirm({title: "This trial balance does not look like this client\u2019s", ok: "Close", body: '<p class="note">' + esc(odd) + "</p>"}); return; }
      if (!r.rows.length){ toast(r.groupsSeen ? "This trial balance shows only groups. In Tally, press Alt+F5 (detailed) so each ledger is shown, then export it again." : "No ledger balances found in " + f.name + ". Export the Trial Balance from Tally as XML."); return; }
      const next = (t => t.getFullYear() + String(t.getMonth() + 1).padStart(2, "0") + String(t.getDate()).padStart(2, "0"))(new Date(+on.slice(0, 4), +on.slice(4, 6) - 1, +on.slice(6, 8) + 1));
      const to = (b.meta || {}).to || next;
      const j = {from: next, to, ledgers: r.rows.map(x => ({name: x.name, parent: (b.under || {})[x.name] || "", open: String(x.open), close: ""}))};
      TallyRead.balances(b, j, next, to);
      b.tb.source = "the trial balance file " + f.name; b.tb.openAsOn = on;
      // the closing figures follow from the opening and the entries brought in
      if (typeof MIS === "object"){ const mv = MIS.moves(b.tb.from, b.tb.to); Object.entries(b.tb.led).forEach(([l, x]) => { x.close = r2(num(x.open) + ((mv[l] || {}).t || 0)); }); }
      TallyRead.after(b, "after the trial balance was read", {from: next, to});
      await saveBooks(); render();
      const tot = r2(r.rows.reduce((s2, x) => s2 + num(x.open), 0));
      toast(r.rows.length + " opening balances as on " + fmtDate(tallyDate(on)) + " brought in" + (Math.abs(tot) >= 1 ? "; they do not add up to nil (difference " + INR.format(tot) + "): check the trial balance was exported with every ledger" : "") + ".");
      if (Bridge.on()) BridgeSeed.opening(on, b.tb.led).then(x => { b.tb.bridge = x && x.skipped ? "not taken: " + x.skipped : "taken"; saveBooks(); render(); if (x && x.skipped) toast("The bridge\u2019s copy was not given the balances: " + x.skipped); }, e => toast("The bridge could not take the balances: " + ((e && e.message) || e)));
      if (TCloudUp.on()) TCloudUp.opening(next, on, b.tb.led).then(() => { b.tb.cloud = "in the cloud"; saveBooks(); render(); }, e => toast("The balances are here, but the cloud did not take them: " + ((e && e.message) || e)));
    }, e => toast("Could not read that file: " + ((e && e.message) || e)));
    return true;
  }
  if (t.dataset && t.dataset.tbcheckon !== undefined){ S.tbCheckOn = t.value; render(); return true; }
  if (t.id === "tbCheckIn"){
    const f = (t.files || [])[0]; t.value = "";
    if (!f) return true;
    const b = S.books, on = String(S.tbCheckOn || tallyDate((b.meta || {}).to) || "").replace(/-/g, "");
    if (!/^\d{8}$/.test(on)){ toast("Give the date of the trial balance first."); return true; }
    f.text().then(async text => {
      const r = TBFile.read(text, b);
      const odd = TBFile.foreign(r, b); if (odd){ askConfirm({title: "This trial balance does not look like this client\u2019s", ok: "Close", body: '<p class="note">' + esc(odd) + "</p>"}); return; }
      if (!r.rows.length){ toast(r.groupsSeen ? "This trial balance shows only groups. In Tally, press Alt+F5 (detailed) so each ledger is shown, then export it again." : "No ledger balances found in " + f.name + "."); return; }
      b.tbCheck = TBCheck.run(b, r.rows, on, f.name);
      await saveBooks(); render();
      toast(b.tbCheck.ok ? "Ready: every ledger agrees with Tally\u2019s trial balance as on " + fmtDate(tallyDate(on)) + "." : b.tbCheck.why || (b.tbCheck.n + " ledger" + (b.tbCheck.n === 1 ? " differs" : "s differ") + " from Tally\u2019s trial balance; they are listed under step 5."));
    }, e => toast("Could not read that file: " + ((e && e.message) || e)));
    return true;
  }
  if (t.id === "mastersIn"){
    const f = (t.files || [])[0]; t.value = "";
    if (!f) return true;
    const b = S.books; b.busy = "Opening " + f.name + "\u2026"; render();
    (async () => { let fc = null; try { fc = await Books.fileCompany(f); } catch (e){} return companyGate(fc, b, CO(), f.name).then(g => ({g, fc})); })().then(({g, fc}) => {
    if (!g.ok){ b.busy = ""; render(); return; }
    if (fc && (fc.name || fc.guid) && !b.tallyCo) b.tallyCo = {name: fc.name, guid: fc.guid};
    Books.importMasters(f, m => { b.busy = m; softRender(); }).then(async res => {
      b.pans = res.pans; b.gstins = res.gstins; b.under = res.under; b.states = res.states; b.groups = res.groups; b.groupInfo = res.groupInfo; b.busy = "";
      b.ledInfo = res.info; b.ledInfoAt = new Date().toISOString(); LedMaster.refresh(b);
      await saveBooks();
      const rows = TDS.rows(), withPan = rows.filter(r => r.pan).length;
      toast(res.count + " ledgers read. " + Object.keys(res.pans).length + " carry a PAN; " + withPan + " of " + rows.length + " deductions now have one.");
      render();
    }, e => { b.busy = ""; toast("Could not read that file: " + (e && e.message || e)); render(); });
    });
    return true;
  }
  if (t.id === "filedIn"){
    const files = Array.from(t.files || []); t.value = "";
    if (!files.length) return true;
    Promise.all(files.map(f => f.text().then(txt => { const j = JSON.parse(txt); if (notThisClient([j.gstin]).length) return "not taken: " + f.name + " is for " + j.gstin + ", another PAN"; const k = GSTAmend.keep(j, "portal"); return GSTR.label(k.ym) + " " + k.gstin.slice(0, 2); }).catch(e => "not read: " + f.name)))
      .then(list => { saveBooks(); toast("Filed GSTR-1 kept: " + list.join(", ") + "."); render(); });
    return true;
  }
  if (t.id === "twoBIn"){
    const files = Array.from(t.files || []); t.value = "";
    if (!files.length) return true;
    const b = S.books;
    Promise.all(files.map(f => f.text().then(txt => {
      const x = GST2B.fromJson(JSON.parse(txt));
      if (!x.gstin || !x.ym) throw new Error("no period");
      if (notThisClient([x.gstin]).length) return "not taken: " + f.name + " is for " + x.gstin + ", another PAN";
      b.twoBs = b.twoBs || {};
      b.twoBs[x.gstin + "|" + x.period] = x;
      return GSTR.label(x.ym) + " (" + x.rows.length + ")";
    }).catch(() => "not read: " + f.name))).then(list => {
      delete b.twoB; S.r2Tab = ""; saveBooks();
      toast("2B brought in: " + list.join(", ") + ".");
      render();
    });
    return true;
  }
  return false;
}
function bankChange(t){
  const b = B(); if (!b) return false;
  if (t.id === "bankIn"){
    const files = Array.from(t.files || []).filter(isBankFile); t.value = "";
    const bnk = B();
    if (bnk && bnk.fixWant && files.length && curStmt()){ const how = bnk.fixWant; bnk.fixWant = null; S.files["st:" + curStmt().id] = files[0]; fixBreaks(how === "free" ? null : how); return true; }
    const was = S.step; Promise.resolve(uploadStatements(files)).then(() => { if (was === "collect" && S.step === "collect") goStep("review", "bank"); }); return true; }
  if (t.id === "ledIn"){ const f = t.files && t.files[0]; t.value = ""; if (f) importLedgerList(f); return true; }
  if (t.id === "bookIn"){ const f = t.files && t.files[0]; t.value = ""; if (f) importTallyBook(f); return true; }
  if (t.dataset.bled){ if (!bankSetLedger(t.dataset.bled, t.value)) t.value = (bankRow(t.dataset.bled) || {}).ledger || ""; return true; }
  return false;
}
document.addEventListener("click", ev => {
  if (!(ev.target.closest && ev.target.closest(".bk-menu"))) closeMenus();
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Enter" && ev.target && ev.target.hasAttribute && ev.target.hasAttribute("data-bulkled") && !(AC.fk && AC.idx >= 0)){ ev.preventDefault(); bulkLedgerFrom(ev.target); }
});
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && S.view === "company" && S.tab === "bank" && B() && B().showSettings && !document.querySelector("#confirmBox[style*='flex']")){
    ev.preventDefault(); ev.stopImmediatePropagation(); B().showSettings = false; render();
  }
}, true);
function bankInput(t){
  const b = B(); if (!b) return false;
  if (t.dataset && t.dataset.bf){
    b.f = b.f || {}; b.f[t.dataset.bf] = t.value; b.sel.clear();
    later("bcol", render, t.tagName === "SELECT" ? 0 : 250); return true;
  }
  if (t.hasAttribute("data-bfrom") || t.hasAttribute("data-bto")){
    if (t.hasAttribute("data-bfrom")) b.from = t.value; else b.to = t.value;
    if (b.from && b.to && b.from > b.to){ const x = b.from; b.from = b.to; b.to = x; }
    b.sel.clear(); later("brange", render, 150); return true;
  }
  if (t.hasAttribute("data-bquick")){
    const v = t.value, now = new Date(), iso = d => d.toISOString().slice(0, 10), y = now.getFullYear(), m = now.getMonth();
    const fyStart = m >= 3 ? y : y - 1;
    if (v === "all"){ b.from = ""; b.to = ""; }
    if (v === "month"){ b.from = iso(new Date(Date.UTC(y, m, 1))); b.to = iso(new Date(Date.UTC(y, m + 1, 0))); }
    if (v === "last"){ b.from = iso(new Date(Date.UTC(y, m - 1, 1))); b.to = iso(new Date(Date.UTC(y, m, 0))); }
    if (v === "quarter"){ const qm = Math.floor(m / 3) * 3; b.from = iso(new Date(Date.UTC(y, qm, 1))); b.to = iso(new Date(Date.UTC(y, qm + 3, 0))); }   // Apr-Jun, Jul-Sep, Oct-Dec, Jan-Mar
    if (v === "fy"){ b.from = iso(new Date(Date.UTC(fyStart, 3, 1))); b.to = iso(new Date(Date.UTC(fyStart + 1, 2, 31))); }
    b.sel.clear(); render(); return true;
  }
  return false;
}


// a long statement keeps going as you scroll: the next lines load when the end of the list comes into view
let bankMoreBusy = false;
window.addEventListener("scroll", () => {
  if (bankMoreBusy || !S.bank || S.view !== "company" || S.tab !== "bank") return;
  const m = document.querySelector(".bk-more [data-act='bankMore']");
  if (!m || m.getBoundingClientRect().top > window.innerHeight + 300) return;
  bankMoreBusy = true;
  requestAnimationFrame(() => { S.bank.limit += 200; render(); setTimeout(() => { bankMoreBusy = false; }, 250); });
}, {passive: true});
/* ================================================================== */
/* Day books for several clients at once (build 195): each file's      */
/* company is read from the file and matched to a client (GSTIN, else   */
/* the Tally name); the person confirms the matches, then the files are */
/* taken one at a time. Each file still passes the same checks          */
/* ================================================================== */
const MultiUp = {
  norm(x){ return String(x || "").toLowerCase().replace(/\(\s*\d{4}\s*-\s*\d{2,4}\s*\)/g, "").replace(/[^a-z0-9]/g, ""); },
  match(fc){
    const cos = Object.values(S.companies || {}).filter(c => !c.deleted);
    if (fc.gstin){
      const g = cos.filter(c => String(c.gstin || "").toUpperCase() === fc.gstin); if (g.length === 1) return g[0].id;
      const p = cos.filter(c => String(c.gstin || "").toUpperCase().slice(2, 12) === fc.gstin.slice(2, 12)); if (p.length === 1) return p[0].id;
    }
    if (fc.name){ const k = this.norm(fc.name), by = cos.filter(c => [c.tallyName, c.name].filter(Boolean).some(x => this.norm(x) === k)); if (by.length === 1) return by[0].id; }
    return "";
  },
  async pick(inp){
    const files = Array.from(inp.files || []); inp.value = "";
    if (!files.length) return;
    S.multiUp = {rows: [], busy: false, reading: true}; render();
    for (const f of files){
      let fc = {}; try { fc = await Books.fileCompany(f); } catch (e){}
      S.multiUp.rows.push({f, name: fc.name || "", gstin: fc.gstin || "", cid: this.match(fc), status: "waiting"});
    }
    S.multiUp.reading = false; render();
  },
  setClient(i, cid){ const r = ((S.multiUp || {}).rows || [])[i]; if (r){ r.cid = cid; render(); } },
  async start(){
    const m = S.multiUp; if (!m || m.busy) return;
    const todo = m.rows.filter(r => r.cid && r.status === "waiting");
    if (!todo.length){ toast("Choose the client for each file first."); return; }
    m.busy = true;
    const keepCo = S.coId, keepView = S.view;
    for (const r of todo){
      r.status = "reading…"; render();
      try {
        S.coId = r.cid;
        if (!S.books || S.books.cid !== r.cid){ S.books = null; await openBooks(r.cid); }
        for (let i = 0; i < 400 && (!S.books || S.books.loading); i++) await new Promise(z => setTimeout(z, 50));
        const res = await bringDayBookFile(r.f, "", "", {quiet: true});
        r.ok = !!(res && !res.refused && res.n != null);
        r.status = !res ? "not taken" : res.refused ? "not taken: " + res.refused : "done: " + res.n + " entries, " + fmtDate(tallyDate(res.from)) + " to " + fmtDate(tallyDate(res.to));
      } catch (e){ r.status = "not taken: " + ((e && e.message) || e); }
      S.view = keepView; render();
    }
    S.coId = keepCo; S.view = keepView; m.busy = false; render();
    const ok = m.rows.filter(r => r.ok).length;
    toast(ok + " of " + m.rows.length + " files brought in. Next, for each client: its opening balances (trial balance) and the check, under Books → From Tally.");
  }

};
