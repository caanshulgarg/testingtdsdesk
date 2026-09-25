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
function noMatchNote(t){
  return '<div class="bk-none">Nothing matches these filters. <button class="linkbtn" data-chipall="' + t + '">Clear all filters</button></div>';
}
function colChipBar(t, shown, total, extra){
  const chips = colChips(t);
  if (!chips.length) return "";
  return '<div class="chipbar"><span class="note">' + shown + " of " + total + (extra ? " \u00b7 " + extra : "") + "</span>" +
    chips.map(([k, l]) => '<span class="fchip"><button class="fchip-l" data-colf="' + k + '" data-colt="' + t + '">' + esc(l) + '</button><button class="fchip-x" data-chipx="' + k + '" data-colt="' + t + '" aria-label="Remove this filter">\u2715</button></span>').join("") +
    '<button class="linkbtn" data-chipall="' + t + '">Clear all</button></div>';
}
function placeColPop(){
  const pop = document.getElementById("colpop"); if (!pop || !S.colPop) return;
  const btn = document.querySelector('.colf[data-colf="' + S.colPop.k + '"][data-colt="' + S.colPop.t + '"]');
  if (!btn){ pop.style.display = "none"; return; }
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
function bankTable(tab){
  const b = B();
  let list = bankVisibleRows();
  const total = list.length;
  const nSel = list.filter(r => b.sel.has(r.id)).length;
  list = list.slice(0, b.limit);
  const empty = {review: "Nothing to review. Every entry has a ledger.", ready: "No entries are ready yet.", done: "Nothing posted or ignored yet."}[tab] || "Nothing here.";
  let h = '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th class="ck"><input type="checkbox" data-bselall aria-label="Select all"' + (nSel && nSel === total ? " checked" : "") + "></th>" +
    colHead("bank", "date", "Date", "dt") + colHead("bank", "narr", "Particulars") + colHead("bank", "wd", "Withdrawal", "n") + colHead("bank", "dep", "Deposit", "n") + colHead("bank", "led", "Ledger", "lg") + '<th class="ac"></th></tr></thead><tbody>';
  h += list.map(r => bankRowHtml(r, tab)).join("");
  h += "</tbody></table>";
  if (!total) h += bankRangeOn() ? noMatchNote("bank") : '<div class="bk-none">' + empty + "</div>";
  h += "</div>";
  if (total > list.length) h += '<div class="bk-more"><button class="btn small" data-act="bankMore">Show ' + Math.min(100, total - list.length) + " more (" + (total - list.length) + " left)</button></div>";
  return h;
}
function bankRowHtml(r, tab){
  const b = B();
  const editable = ["attention", "suggested", "ready"].includes(r.state);
  const sel = b.sel.has(r.id);
  const modeName = {ATM: "ATM cash withdrawal", CASH: "Cash deposit", CHARGES: "Bank charges", INTEREST: "Interest credit"}[r.dec.mode];
  const party = modeName || r.dec.name || r.dec.upi || "";
  const ref = r.dec.chq ? "Chq " + r.dec.chq : r.dec.utr || "";
  const sub = [r.dec.mode !== "OTHER" ? r.dec.mode : "", ref].filter(Boolean).join(" \u00b7 ");
  let ledgerCell, action;
  if (editable){
    const cls = r.state === "suggested" ? " sugg" : r.state === "ready" ? " done" : "";
    const tip = r.why ? ' title="' + esc(r.why) + '"' : "";
    const label = r.state === "suggested" ? '<span class="src"' + tip + ">Suggested \u00b7 " + esc(r.srcLabel || "Match") + "</span>"
      : r.state === "ready" ? '<span class="src ok"' + tip + ">" + esc(r.source === "you" || r.userSet ? "Set by you" : (r.srcLabel || "Confirmed")) + (r.vtype === "Contra" ? " \u00b7 Contra" : "") + (r.billRef ? " \u00b7 Bill " + esc(r.billRef) : "") + "</span>"
      : '<span class="src muted"' + tip + ">" + esc(hasLedgerList() ? "No match found" : "Import the ledger list") + "</span>";
    const held = B().postedTags && String(B().postedTags[fpHash(r.fp || r.id)] || "").startsWith("unconfirmed");
    const perr = r.state === "ready" && r.postError ? '<span class="src bad" title="' + esc(r.postError) + '">Tally: ' + esc(r.postError) +
      (held ? ' <button class="linkbtn" data-brow="notintally" data-rid="' + r.id + '">I checked \u2014 it is not in Tally</button>' : "") + "</span>" : "";
    const ruleTag = r.ruleId ? '<span class="src"><button class="linkbtn" data-redit="' + r.ruleId + '">rule: ' + esc(ruleLabel(allRules().find(x => x.id === r.ruleId) || {name: "gone"})) + "</button></span>" : "";
    ledgerCell = perr + '<input type="text" class="lgbox' + cls + '" data-bled="' + r.id + '" data-fk="bled:' + r.id + '" data-keeptyped data-ac="1" autocomplete="off" value="' + esc(r.ledger) + '" placeholder="Select ledger" aria-label="Ledger">' + label +
      ruleTag + (r.tdsAtPay ? '<span class="src">TDS ' + money(r.tdsAtPay) + " deducted at payment</span>" : "") +
      ((r.splits || []).length ? '<span class="src">split: ' + r.splits.map(sp => esc(sp.ledger) + " " + INR.format(sp.amt)).join(", ") + "</span>" : "");
    const ruleBtn = '<button class="linkbtn" data-brow="rule" data-rid="' + r.id + '" title="Make a rule from this line">Rule</button>';
    action = r.state === "suggested" ? '<button class="btn small primary" data-brow="accept" data-rid="' + r.id + '">Confirm</button>' + ruleBtn + '<button class="icon" data-brow="ignore" data-rid="' + r.id + '" title="Ignore this entry" aria-label="Ignore">\u2715</button>'
      : r.state === "ready" ? (Bridge.on() && Bridge.up() ? '<button class="btn small" data-brow="post" data-rid="' + r.id + '">Post</button> ' : "") + '<button class="linkbtn" data-brow="rule" data-rid="' + r.id + '" title="Make a rule from this line">Rule</button> <button class="linkbtn" data-brow="unready" data-rid="' + r.id + '">Undo</button>'
      : ruleBtn + '<button class="icon" data-brow="ignore" data-rid="' + r.id + '" title="Ignore this entry" aria-label="Ignore">\u2715</button>';
  } else {
    const canUndo = r.state === "sent" && r.tally && r.tally.guid && Bridge.on() && Bridge.up();
    const status = r.state === "sent" ? "Posted " + (r.sentAt ? shortDate(r.sentAt.slice(0, 10)) : "")
      : r.state === "intally" ? "Already in Tally" + (r.tallyRef ? ": " + r.tallyRef : "") + (r.tallyHow ? " (" + r.tallyHow + ")" : "") : "Ignored";
    ledgerCell = '<span class="lgtext">' + esc(r.ledger || "\u2014") + '</span><span class="src muted">' + esc(status) +
      (canUndo ? ' <button class="linkbtn" data-brow="unpost" data-rid="' + r.id + '">Take it back</button>' : "") + "</span>";
    action = r.state === "sent" ? "" : '<button class="linkbtn" data-brow="restore" data-rid="' + r.id + '">Restore</button>';
  }
  const flag = r.balOk === false ? ' <span class="flag bad" title="This entry does not agree with the running balance">!</span>' : r.repaired ? ' <span class="flag warn" title="Amount read from the balance change: check it">\u2248</span>' : "";
  return '<tr class="st-' + r.state + (sel ? " picked" : "") + '"><td class="ck"><input type="checkbox" data-bsel="' + r.id + '"' + (sel ? " checked" : "") + (r.state === "sent" ? " disabled" : "") + ' aria-label="Select"></td>' +
    '<td class="dt" title="' + esc(fmtDate(r.date)) + '">' + shortDate(r.date) + "</td>" +
    '<td class="pt"><div class="pn">' + esc(party || r.narr.slice(0, 60)) + '</div><div class="nr" title="' + esc(r.narr) + '">' + (sub ? '<span class="md">' + esc(sub) + "</span> " : "") + esc(r.narr) + "</div></td>" +
    '<td class="n">' + bkAmt(r.debit) + (r.debit ? flag : "") + '</td><td class="n">' + bkAmt(r.credit) + (r.credit ? flag : "") + "</td>" +
    '<td class="lg">' + ledgerCell + '</td><td class="ac">' + action + "</td></tr>";
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
function viewBankGroups(){
  const b = B();
  const q = b.q.trim().toLowerCase();
  let groups = bankGroups().filter(g => !q || (g.name + " " + g.sample).toLowerCase().includes(q));
  const total = groups.length;
  groups = groups.slice(0, b.limit);
  let h = '<div class="bk-tablewrap"><table class="bk-table"><thead><tr><th>Party</th><th class="n">Entries</th><th class="n">Withdrawals</th><th class="n">Deposits</th><th class="lg">Ledger for all its entries</th><th class="ac"></th></tr></thead><tbody>';
  h += groups.map((g, i) => {
    const sug = Object.entries(g.ledgers).sort((a, b2) => b2[1] - a[1])[0];
    const id = "g" + i;
    return '<tr><td class="pt"><div class="pn">' + esc(g.name) + '</div><div class="nr" title="' + esc(g.sample) + '">' + esc(g.sample) + "</div></td>" +
      '<td class="n">' + g.n + '</td><td class="n">' + bkAmt(g.out) + '</td><td class="n">' + bkAmt(g.inn) + "</td>" +
      '<td class="lg"><input type="text" class="lgbox' + (sug ? " sugg" : "") + '" id="' + id + '" data-gkey="' + esc(g.key) + '" data-fk="gkey:' + esc(g.key) + '" data-draft data-keeptyped data-ac="1" autocomplete="off" value="' + esc(sug ? sug[0] : "") + '" placeholder="Select ledger">' +
      (sug ? '<span class="src">Suggested for ' + sug[1] + " of " + g.n + "</span>" : "") + "</td>" +
      '<td class="ac"><button class="btn small primary" data-gapply="' + id + '">Apply</button></td></tr>';
  }).join("");
  h += "</tbody></table>";
  if (!total) h += (S.revQuery || revColOn()) ? noMatchNote("rev") : '<div class="bk-none">Nothing to review.</div>';
  h += "</div>";
  if (total > groups.length) h += '<div class="bk-more"><button class="btn small" data-act="bankMore">Show more parties (' + (total - groups.length) + " left)</button></div>";
  return h;
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
function bankSettingsHtml(){
  const b = B(), co = CO();
  const std = Object.keys(BANK_LEDGER_DEFAULTS);
  let h = '<div class="bk-overlay" data-bkoverlay><div class="bk-panel" role="dialog" aria-modal="true" aria-labelledby="bkSetT"><div class="bk-panel-head"><h2 id="bkSetT">Bank settings \u2014 ' + esc(co.name) + '</h2><button class="icon" data-act="bankSettingsClose" aria-label="Close">\u2715</button></div>';
  if (bridgeLive(co)) h += '<section><h3>Tally ledger list</h3><p class="note">Live from Tally (' + esc(Bridge.openFor(co).name) + "): " + b.ledgers.list.length + " ledgers, updated " + (b.ledgers.importedAt ? new Date(b.ledgers.importedAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) : "\u2014") + '.</p><button class="btn small" data-act="bankSync">Refresh from Tally</button></section>';
  else h += '<section><h3>Tally ledger list</h3>' + (hasLedgerList()
      ? '<p class="note">' + b.ledgers.list.length + " ledgers, imported " + fmtDate(b.ledgers.importedAt.slice(0, 10)) + " from " + esc(b.ledgers.file || "Tally") + "." + (Date.now() - new Date(b.ledgers.importedAt) > 30 * 864e5 ? " Over 30 days old: update it." : "") + "</p>"
      : '<p class="note">Not imported yet. In Tally: Display More Reports \u2192 List of Accounts \u2192 Export (Excel or XML).</p>') +
    '<button class="btn small" data-act="ledPick">' + (hasLedgerList() ? "Update ledger list" : "Import ledger list") + "</button>" +
    (b.newLed.filter(l => !l.sent).length ? '<p class="note">' + plural(b.newLed.filter(l => !l.sent).length, "new ledger") + " will be created in Tally with the next Tally file.</p>" : "") + "</section>";
  h += '<section><h3>Bank accounts</h3>' + ((co.bankAccounts || []).length ? '<div class="bk-form">' + (co.bankAccounts || []).map(a =>
      '<label><span>' + esc(a.bank) + (a.last4 ? " \u00b7\u00b7" + esc(a.last4) : "") + (a.ifsc ? " \u00b7 " + esc(a.ifsc) : "") + '</span><select data-bankacc="' + a.id + '">' + ledgerOptions(exactLedger(a.ledger), BANK_GROUPS) + "</select></label>").join("") + "</div>"
      : '<p class="note">Bank accounts are added when you upload their statements.</p>') + "</section>";
  h += '<section><h3>Ledgers for standard entries</h3><p class="note">Found automatically in the ledger list; change them if this client uses different ledgers.</p><div class="bk-form">' + std.map(k =>
      '<label><span>' + esc(BANK_LEDGER_LABELS[k]) + '</span><select data-bankled="' + k + '">' + ledgerOptions(stdLedger(co, k)) + "</select></label>").join("") + "</div></section>";
  h += '<section><h3>Automation</h3>' +
    '<label class="chk"><input type="checkbox" data-bankauto' + (co.bankAuto !== false ? " checked" : "") + "> Mark sure matches as Ready (saved rules, exact bill matches, standard entries)</label>" +
    '<label class="chk"><input type="checkbox" data-bankoptional' + (co.bankOptional ? " checked" : "") + "> Post bank entries into Tally as Optional vouchers (they then have to be made regular in Tally)</label>" +
    '<label class="chk"><input type="checkbox" data-bankautoapply' + (co.bankAutoApply !== false ? " checked" : "") + "> When I choose a ledger for an entry, use it for every entry of the same party and remember it</label></section>";
  const nh = Object.keys(b.hist.rows).length;
  h += '<section><h3>Clean up</h3><p class="note">' + b.rules.length + " saved rules \u00b7 " + nh + " remembered decisions \u00b7 " + b.stmts.length + ' statements</p><div class="row" style="gap:6px;flex-wrap:wrap">' +
    '<button class="btn small" data-act="bankClearRules"' + (b.rules.length ? "" : " disabled") + ">Forget saved rules</button>" +
    '<button class="btn small" data-act="bankClearHist"' + (nh ? "" : " disabled") + ">Forget remembered decisions</button>" +
    '<button class="btn small danger" data-act="bankDelAll"' + (b.stmts.length ? "" : " disabled") + ">Delete all statements</button></div></section>";
  h += "</div></div>";
  return h;
}
function bankBar(){
  const b = B();
  if (!b || b.loading || !curStmt()) return "";
  const tc = tabCounts(bankRangeRows());
  const nsel = b.sel.size;
  let left, right;
  if (nsel){
    const selRows = bankSelected();
    left = "<b>" + nsel + " selected</b> <span class=\"muted\">\u00b7 " + INR.format(r2(selRows.reduce((a, r) => a + (r.debit || r.credit), 0))) + '</span> <button class="linkbtn" data-act="bankSelNone">Clear</button>';
    right = '<input type="text" class="lgbox" data-bulkled data-fk="bulkled" data-keeptyped data-ac="1" autocomplete="off" placeholder="Ledger for the ' + nsel + ' selected">' +
      '<button class="btn" data-act="bankBulkLedger">Apply ledger</button>' +
      (selRows.some(r => r.state === "suggested") ? '<button class="btn primary" data-act="bankBulkAccept">Confirm</button>' : "") +
      (selRows.some(r => ["attention", "suggested", "ready"].includes(r.state)) ? '<button class="btn" data-act="bankBulkIgnore">Ignore</button>' : "") +
      (selRows.some(r => r.state === "ignored" || r.state === "intally") ? '<button class="btn" data-act="bankBulkRestore">Restore</button>' : "") +
      (Bridge.on() && Bridge.up() && selRows.some(r => r.state === "ready") ? '<button class="btn primary" data-act="bankBulkPost">Post ' + selRows.filter(r => r.state === "ready").length + " to Tally</button>" : "");
  } else {
    left = '<span class="bk-stat"><b>' + tc.review + '</b> to review</span><span class="bk-stat"><b>' + tc.ready + "</b> ready to post</span>";
    right = (tc.suggested ? '<button class="btn" data-act="bankAcceptAll">Confirm all suggestions (' + tc.suggested + ")</button>" : "") +
      (Bridge.on() && Bridge.up() ? '<button class="btn primary" data-act="bankPost"' + (tc.ready ? "" : " disabled") + ">Post to Tally (" + tc.ready + ")</button>"
        : '<button class="btn primary" data-act="bankXml"' + (tc.ready ? "" : " disabled") + ">Create Tally file (" + tc.ready + ")</button>");
  }
  let snack = "";
  if (b.undo && !nsel){
    const u = b.undo;
    const text = u.what === "set" || u.what === "bulk"
      ? esc(u.label) + " \u2192 <b>" + esc(u.ledger) + "</b>" + (u.others ? " \u00b7 also " + entries(u.others) + " of this party" : "") + (u.ruleKeys && u.ruleKeys.length ? " \u00b7 remembered" : "")
      : u.what === "clear" && u.n > 1 ? "All decisions cleared" : entries(u.n) + " " + ({accept: "confirmed", ignore: "ignored", restore: "restored", clear: "cleared", unready: "moved back to review"}[u.what] || "changed");
    snack = '<div class="bk-snack"><span>' + text + '</span><button class="linkbtn" data-act="bankUndo">Undo</button>' +
      (u.ruleKeys && u.ruleKeys.length ? '<button class="linkbtn" data-act="bankForget">Don\u2019t remember</button>' : "") +
      '<button class="icon" data-act="bankUndoOk" aria-label="Close">\u2715</button></div>';
  }
  return '<div class="actionbar bk-actionbar">' + snack + '<div class="ab-left">' + left + '</div><div class="ab-right">' + right + "</div></div>";
}
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
  if (input.value.trim() && !exact && hasLedgerList()) AC.items.push({name: input.value.trim(), create: true});
  AC.idx = AC.items.length && input.value.trim() ? 0 : -1;
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
  input.value = it.name;
  if (input.dataset.bled) input.dispatchEvent(new Event("change", {bubbles: true}));
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
function bankClick(t){
  const b = B(); if (!b) return false;
  if (t.dataset.btab){ b.filter = t.dataset.btab; b.limit = 100; b.sticky.clear(); b.sel.clear(); render(); return true; }
  if (t.dataset.delstmt){ deleteStatement(t.dataset.delstmt); return true; }
  if (t.dataset.gapply){ const inp = document.getElementById(t.dataset.gapply); if (inp) applyGroup(inp.dataset.gkey, inp.value); acClose(); return true; }
  if (t.hasAttribute && (t.hasAttribute("data-bselall") || t.hasAttribute("data-bsel"))) return true;
  if (t.dataset.rcopy){ const r = clientRules().find(x => x.id === t.dataset.rcopy); if (r) copyRulesTo([r]); return true; }
  if (t.dataset.redit || t.dataset.rtoggle || t.dataset.rdel || t.dataset.rmove){
    const id = t.dataset.redit || t.dataset.rtoggle || t.dataset.rdel || t.dataset.rid;
    const inClient = clientRules().some(x => x.id === id);
    const list = inClient ? clientRules() : firmRules();
    const i = list.findIndex(x => x.id === id), r = list[i];
    if (!r) return true;
    if (t.dataset.rtoggle){ r.off = !r.off; saveRules(r.scope); runRules(null, {force: true}); toast(r.off ? "Rule paused." : "Rule in use again."); render(); return true; }
    if (t.dataset.rdel){
      askConfirm({title: "Delete the rule \u201c" + ruleLabel(r) + "\u201d?", ok: "Delete", body: '<p class="note">Lines already set keep their ledger. Future statements will not use this rule.</p>'}).then(a => {
        if (!a) return;
        list.splice(i, 1); saveRules(r.scope); toast("Rule deleted."); render();
      });
      return true;
    }
    if (t.dataset.rmove){
      const j = t.dataset.rmove === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return true;
      list.splice(j, 0, list.splice(i, 1)[0]);
      saveRules(r.scope); runRules(null, {force: true}); render();
      return true;
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
    return true;
  }
  if (t.dataset.brow === "rule"){
    const row = bankRow(t.dataset.rid);
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
  if (t.dataset.brow === "notintally"){
    const row = bankRow(t.dataset.rid);
    if (row && B().postedTags){ delete B().postedTags[fpHash(row.fp || row.id)]; row.postError = ""; saveBank({rows: true, posted: true}); toast("It will be checked in Tally again, then posted."); render(); }
    return true;
  }
  if (t.dataset.brow === "unpost"){
    const row = bankRow(t.dataset.rid);
    if (row) unpostFromTally("bank", row, B().cid).then(ok => {
      if (!ok) return;
      row.state = row.ledger ? "ready" : "attention"; row.sentAt = ""; row.postVerified = false; row.tally = null;
      if (B().postedTags) delete B().postedTags[fpHash(row.fp || row.id)];
      saveBank({rows: true, posted: true}); render();
    });
    return true;
  }
  if (t.dataset.brow === "post"){ postBankToTally([t.dataset.rid]); return true; }
  if (t.dataset.brow){
    const r = bankRow(t.dataset.rid); if (!r) return true;
    const a = t.dataset.brow;
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
  switch (t.dataset.act){
    case "bankPick": document.getElementById("bankIn").click(); return true;
    case "ledPick": document.getElementById("ledIn").click(); return true;
    case "bookPick": closeMenus(); document.getElementById("bookIn").click(); return true;
    case "bankSettings": b.showSettings = true; render(); return true;
    case "bankSettingsClose": b.showSettings = false; render(); return true;
    case "bankMore": b.limit += 100; render(); return true;
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
    case "dupFind": closeMenus(); findTallyDuplicates(); return true;
    case "dupRemove": removeTallyDuplicates(); return true;
    case "dupClose": S.dupFind = null; render(); return true;
    case "bankCheckTally": {
      closeMenus();
      const b2 = B();
      ensureTallyCompany(CO(b2.cid)).then(n => {
        if (!n) return;
        b2.busy = "Reading the bank ledger from Tally\u2026"; render();
        syncBankBookFromTally(true).then(() => {
          b2.busy = ""; b2.checkedAt = Date.now();
          toast(b2.rows.filter(r => r.state === "intally").length + " entries are already in Tally.");
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
// what the user corrects on the Advances and Reversal screens
function gstFixChange(t){
  const d = t.dataset, b = S.books;
  if (d.tallyfrom !== undefined || d.tallyto !== undefined){ const t0 = Audit.today(); S.tallyRange = Object.assign({from: Audit.iso(Audit.fyStart(t0)), to: Audit.iso(t0)}, S.tallyRange, d.tallyfrom !== undefined ? {from: t.value} : {to: t.value}); return true; }
  if (d.tallytime !== undefined){ S.tallyCopy = Object.assign({}, S.tallyCopy, {time: t.value}); return true; }
  if (d.fskind !== undefined){ b.fs = Object.assign({}, FS.cfg(b), {kind: t.value}); S.fsRun = null; saveBooks(); render(); return true; }
  if (d.fsfy !== undefined){ S.fsFy = t.value; S.fsRun = null; render(); return true; }
  if (d.fsstock !== undefined){ const c = FS.cfg(b); c.stock = Object.assign({}, c.stock, {[d.fsstock]: t.value === "" ? "" : num(t.value)}); b.fs = c; saveBooks(); return true; }
  if (d.fsmfg !== undefined){ b.fs = Object.assign({}, FS.cfg(b), {mfg: !!t.checked}); saveBooks(); return true; }
  if (d.fsshares !== undefined){ b.fs = Object.assign({}, FS.cfg(b), {shares: t.value}); saveBooks(); return true; }
  if (d.fsmap !== undefined){ const c = FS.cfg(b); c.map = Object.assign({}, c.map, {[d.fsmap]: t.value}); b.fs = c; S.fsRun = S.fsRun ? {fy: S.fsRun.fy, kind: c.kind, d: FS.build(S.fsRun.fy)} : null; saveBooks(); render(); return true; }
  if (d.misfrom !== undefined || d.misto !== undefined){ const x = misRangeQuick("ytd", b); S.misRange = Object.assign({from: Audit.iso(x.from), to: Audit.iso(x.to)}, S.misRange, d.misfrom !== undefined ? {from: t.value} : {to: t.value}); return true; }
  if (d.misfreq !== undefined){ b.misCfg = Object.assign({}, b.misCfg, {freq: t.value}); saveBooks(); render(); return true; }
  if (d.miscat !== undefined){ S.misCat = t.value; render(); return true; }
  if (d.misbudpct !== undefined){ S.misBudPct = t.value; return true; }
  if (d.misbud !== undefined){ const [h2, mm] = d.misbud.split("|"), fy = Audit.fyStart(mm + "01").slice(0, 4); b.budget = b.budget || {}; b.budget[fy] = b.budget[fy] || {}; b.budget[fy][h2] = Object.assign({}, b.budget[fy][h2], {[mm]: t.value === "" ? "" : num(t.value)}); saveBooks(); render(); return true; }
  if (d.misf !== undefined){ S.misF = t.value; render(); return true; }
  if (d.mismsme !== undefined){ b.msme = Object.assign({}, b.msme, {[d.mismsme]: t.value}); const r = (b.mis || {}).last; if (r) MIS.run(r.from, r.to, r.how); saveBooks(); render(); return true; }
  if (d.g9t !== undefined){ const fy = GST9.fyOf(S.gstYm || GSTR.months().slice(-1)[0]), reg = S.gstReg || "", st = GST9.typed(fy, reg), [k, f] = d.g9t.split("."); st[k] = Object.assign({}, st[k], {[f]: t.value === "" ? "" : num(t.value)}); if (Object.values(st[k]).every(v => v === "")) delete st[k]; saveBooks(); render(); return true; }
  if (d.itcbasis !== undefined){ b.itcBasis = Object.assign({}, b.itcBasis, {[S.gstReg || ""]: t.value}); saveBooks(); render(); return true; }
  if (d.g3b !== undefined){ const k = (S.gstReg || "") + "|" + S.gstYm, [grp, hd] = d.g3b.split("."); b.gst3b = Object.assign({}, b.gst3b); b.gst3b[k] = Object.assign({}, b.gst3b[k]); b.gst3b[k][grp] = Object.assign({}, b.gst3b[k][grp], {[hd]: t.value === "" ? "" : num(t.value)}); saveBooks(); render(); return true; }
  if (d.gstopen !== undefined){ const k = S.gstReg || ""; b.gstOpen = Object.assign({}, b.gstOpen); b.gstOpen[k] = Object.assign({}, b.gstOpen[k], {[d.gstopen]: t.value === "" ? "" : num(t.value)}); saveBooks(); render(); return true; }
  if (d.inregscope !== undefined){ S.inregScope = t.value; render(); return true; }
  if (d.inregf !== undefined){ S.inregF = t.value; render(); return true; }
  if (d.inregq !== undefined){ S.inregQ = t.value; render(); return true; }
  if (d.g9c !== undefined){
    const fy = GST9.fyOf(S.gstYm || GSTR.months().slice(-1)[0]), reg = S.gstReg || (((b.meta || {}).gstins || [])[0] || "").slice(0, 2), st = GST9C.st(fy, reg), k = d.g9c;
    const v = t.tagName === "TEXTAREA" ? t.value : (t.value === "" ? "" : num(t.value));
    if (k.startsWith("adj.")) st.adj[k.slice(4)] = v; else if (k.startsWith("reasons.")) st.reasons[k.slice(8)] = v; else st[k] = v;
    saveBooks(); render(); return true;
  }
  if (d.relrel !== undefined){ const x = (b.auditRel || []).find(z => z.name === d.relrel); if (x){ x.relation = t.value; saveBooks(); render(); } return true; }
  if (d.auditfreq !== undefined){ b.auditCfg = Object.assign({}, b.auditCfg, {freq: t.value}); saveBooks(); render(); return true; }
  if (d.auditfrom !== undefined || d.auditto !== undefined){ const dr = Audit.defaultRange(b); S.auditRange = Object.assign({from: Audit.iso(dr.from), to: Audit.iso(dr.to)}, S.auditRange, d.auditfrom !== undefined ? {from: t.value} : {to: t.value}); return true; }
  if (d.auditst !== undefined){ S.auditSt = t.value; render(); return true; }
  if (d.auditstatus || d.auditnote){
    const id = d.auditstatus || d.auditnote, au = b.audit = b.audit || {st: {}};
    au.st = au.st || {}; const cur = Object.assign({s: "open"}, au.st[id]);
    if (d.auditstatus) cur.s = t.value; else cur.note = t.value;
    cur.at = new Date().toISOString(); au.st[id] = cur; saveBooks(); render(); return true;
  }
  const lmName = d.lmwhat || d.lmtax || d.lmside || d.lmreg || d.lmgrate || d.lmsec || d.lmrate;
  if (lmName){
    const m = b.map[lmName] = b.map[lmName] || {n: 0};
    if (d.lmwhat) LedMaster.applyWhat(m, t.value || "none");
    if (d.lmtax) m.tax = t.value;
    if (d.lmside) m.side = t.value;
    if (d.lmreg) m.reg = t.value;
    if (d.lmgrate) m.gstRate = t.value ? num(t.value) : null;
    if (d.lmsec) m.section = t.value.toUpperCase().replace(/\s+/g, "");
    if (d.lmrate) m.rate = t.value === "" ? null : num(t.value);
    // a choice made here is the user's own: it counts as confirmed
    m.byHand = true; m.ok = true; m.okAt = new Date().toISOString();
    LedMaster.tplLearn(b, [lmName]); try { LedMaster.applyPosting(b, CO(), "empty"); } catch (e){}
    b.mapV = (b.mapV || 0) + 1; b.reco = null; saveBooks(); render(); return true;
  }
  if (d.r2link !== undefined){ const st = GST2B.state(); if (t.value){ st.link[d.r2link] = [t.value]; delete st.confirm[d.r2link]; } saveBooks(); render(); return true; }
  if (d.r2tag !== undefined){ const st = GST2B.state(); if (t.value) st.tag[d.r2tag] = {tag: t.value, at: new Date().toISOString()}; else delete st.tag[d.r2tag]; saveBooks(); render(); return true; }
  if (d.r2tol !== undefined){ const st = GST2B.state(); st.opt = Object.assign({}, st.opt, {tol: Math.max(0, num(t.value))}); saveBooks(); render(); return true; }
  if (d.amendact){ b.amendFix = Object.assign({}, b.amendFix, {[d.amendact]: t.value}); saveBooks(); render(); return true; }
  if (d.filednot){ const f = (b.filed || {})[d.filednot]; if (f){ f.notFiled = !!t.checked; saveBooks(); render(); } return true; }
  const id = d.advrate || d.advskip || d.advtake || d.advadj;
  if (id){
    b.advFix = b.advFix || {};
    const f = Object.assign({}, b.advFix[id]);
    if (d.advrate) f.rate = t.value;
    if (d.advskip) f.skip = !!t.checked;
    if (d.advtake) f.isAdv = !!t.checked;
    if (d.advadj) f.adjYm = t.value;
    Object.keys(f).forEach(k => { if (f[k] === "" || f[k] === false || f[k] == null) delete f[k]; });
    if (Object.keys(f).length) b.advFix[id] = f; else delete b.advFix[id];
    saveBooks(); render(); return true;
  }
  if (d.asset){
    const [aid, k] = d.asset.split(":"), a = (b.assets || []).find(x => x.id === aid);
    if (a){ a[k] = /^(igst|cgst|sgst|cess)$/.test(k) ? r2(num(t.value)) : t.value; saveBooks(); render(); }
    return true;
  }
  if (d.revd2 !== undefined){ b.rev = Object.assign({}, b.rev, {d2: !!t.checked}); saveBooks(); render(); return true; }
  return false;
}
function booksChange(t){
  if (t.id === "booksIn"){
    const f = (t.files || [])[0]; t.value = "";
    if (!f) return true;
    const b = S.books; b.busy = "Opening " + f.name + "\u2026"; render();
    Books.importDayBook(f, m => { b.busy = m; softRender(); }).then(async res => {
      b.vouchers = res.vouchers; b.meta = Object.assign(res.meta, {at: new Date().toISOString(), file: f.name});
      b.map = Books.mapLedgers(res.vouchers, b.map); LedMaster.refresh(b); b.reco = null; b.busy = "";
      if (Audit.cfg(b).freq !== "off") try { const r = Audit.defaultRange(b); Audit.run(r.from, r.to, "after the day book was read"); } catch (e){}
      await saveBooks();
      toast(res.vouchers.length + " vouchers read, " + Object.keys(b.map).length + " ledgers found. Check the ledgers, then TDS and GST.");
      S.booksTab = "ledgers"; render();
    }, e => { b.busy = ""; toast("Could not read that file: " + (e && e.message || e)); render(); });
    return true;
  }
  if (t.id === "mastersIn"){
    const f = (t.files || [])[0]; t.value = "";
    if (!f) return true;
    const b = S.books; b.busy = "Opening " + f.name + "\u2026"; render();
    Books.importMasters(f, m => { b.busy = m; softRender(); }).then(async res => {
      b.pans = res.pans; b.gstins = res.gstins; b.under = res.under; b.states = res.states; b.groups = res.groups; b.groupInfo = res.groupInfo; b.busy = "";
      b.ledInfo = res.info; b.ledInfoAt = new Date().toISOString(); LedMaster.refresh(b);
      await saveBooks();
      const rows = TDS.rows(), withPan = rows.filter(r => r.pan).length;
      toast(res.count + " ledgers read. " + Object.keys(res.pans).length + " carry a PAN; " + withPan + " of " + rows.length + " deductions now have one.");
      render();
    }, e => { b.busy = ""; toast("Could not read that file: " + (e && e.message || e)); render(); });
    return true;
  }
  if (t.id === "filedIn"){
    const files = Array.from(t.files || []); t.value = "";
    if (!files.length) return true;
    Promise.all(files.map(f => f.text().then(txt => { const k = GSTAmend.keep(JSON.parse(txt), "portal"); return GSTR.label(k.ym) + " " + k.gstin.slice(0, 2); }).catch(e => "not read: " + f.name)))
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
  if (t.dataset.stmtsel){ openStatement(t.value); return true; }
  if (t.hasAttribute("data-bgroup")){ b.grouped = t.checked; b.limit = 100; b.sel.clear(); render(); return true; }
  if (t.dataset.bled){
    const r = bankRow(t.dataset.bled); if (!r) return true;
    const v = t.value.trim();
    if (!v){ if (r.ledger){ setRowLedger(r, ""); saveBank({rows: true}); render(); } return true; }
    const l = exactLedger(v);
    if (!l){ t.value = r.ledger || ""; toast("\u201c" + v + "\u201d is not a Tally ledger. Choose one from the list, or create it."); return true; }
    if (b.sel.has(r.id) && b.sel.size > 1){ acClose(); bulkAction("ledger", l); return true; }
    if (l !== r.ledger || r.state !== "ready"){ setRowLedger(r, l); saveBank({rows: true}); render(); }
    return true;
  }
  if (t.dataset.bsel !== undefined || t.hasAttribute("data-bselall") || t.hasAttribute("data-bulkled") || t.dataset.gkey !== undefined) return true;
  if (t.hasAttribute("data-bankoptional")){ const co = CO(); co.bankOptional = t.checked; Store.saveCompany(co); return true; }
  if (t.hasAttribute("data-bankautoapply")){ const co = CO(); co.bankAutoApply = t.checked; Store.saveCompany(co); return true; }
  if (t.hasAttribute("data-bankauto")){ const co = CO(); co.bankAuto = t.checked; Store.saveCompany(co); render(); return true; }
  if (t.dataset.bankacc){
    const co = CO(); const a = (co.bankAccounts || []).find(x => x.id === t.dataset.bankacc);
    if (a){ a.ledger = t.value; Store.saveCompany(co); suggestAll(b.rows, true); saveBank({rows: true}); render(); }
    return true;
  }
  if (t.dataset.bankled){ const co = CO(); co.bankLedgerNames = co.bankLedgerNames || {}; co.bankLedgerNames[t.dataset.bankled] = t.value; Store.saveCompany(co); suggestAll(b.rows, true); saveBank({rows: true}); render(); return true; }
  return false;
}
document.addEventListener("click", ev => {
  const sa = ev.target.closest && ev.target.closest("[data-sugall]");
  if (sa){ document.querySelectorAll("[data-sug]").forEach(x => { x.checked = sa.checked; }); return; }
  const rs = ev.target.closest && ev.target.closest("[data-revsel]");
  if (rs){ S.revSel = S.revSel || new Set(); if (rs.checked) S.revSel.add(rs.dataset.revsel); else S.revSel.delete(rs.dataset.revsel); render(); return; }
  const ra = ev.target.closest && ev.target.closest("[data-revall]");
  if (ra){ S.revSel = new Set(ra.checked ? revFiltered().map(r => r.e.id) : []); render(); return; }   // only the rows the filter shows
  const cb = ev.target.closest && ev.target.closest("[data-bsel]");
  if (cb){ bankToggle(cb, ev.shiftKey); return; }
  const all = ev.target.closest && ev.target.closest("[data-bselall]");
  if (all && B()){ const b = B(); const vis = bankVisibleRows().filter(r => r.state !== "sent"); if (all.checked) vis.forEach(r => b.sel.add(r.id)); else vis.forEach(r => b.sel.delete(r.id)); bankLightRefresh(); return; }
  const ov = ev.target.hasAttribute && ev.target.hasAttribute("data-bkoverlay");
  if (ov && B()){ B().showSettings = false; render(); return; }
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
  if (t.hasAttribute("data-bankq")){ b.q = t.value; b.sticky.clear(); later("bq", render, 250); return true; }
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
  if (t.hasAttribute("data-allled")){ b.allLed = t.value; return true; }
  return false;
}

