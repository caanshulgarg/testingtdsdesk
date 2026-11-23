/* @react-lazy: begin 99-screen-parts.js (the React app loads this file with the screens that use it: build.py react_parts) */
/* Moved out of legacy.js as they were (its size budget, tests/run_legacy_room.py): the parts of the program only the
   React app's own screens call, each from a screen that imports this file first (next-speed). The file each came from is
   named above its part. */
// ---- from src/js/00-core.js
const DB_LIMIT = 5000;
// ---- from src/js/01-documents-in-the-firm-account.js
// num, r2, INR, MONTHS3, toDateObj, fmtDate: server/_shared/gst3b.js (shared with the gst-run function)
const INR0 = new Intl.NumberFormat("en-IN", {maximumFractionDigits:0});
// a negative amount reads "-₹1,234.00" (the minus before the rupee sign; colour scheme of 02-Oct-2026), shown in red by negAmounts
// a Tally narration as shown on the screen: without FinCom's matching mark (" | TDSDesk:<id>", kept in Tally so FinCom can
// find its own entries; never shown, owner's spec K1)
function shownNarr(s){ return String(s == null ? "" : s).replace(/\s*\|?\s*TDSDesk:[A-Za-z0-9]+/gi, "").trim(); }
// the plain words alone, for a message built into a sentence
function plainText(s){ const p = plainMessage(s); return p ? p.text.replace(/\.$/, "") : String(s == null ? "" : s); }
// ---- from src/js/03-transactions.js
function txnColOn(){ const f = txnF(); return Object.keys(f).some(k => Array.isArray(f[k]) ? f[k].length : f[k]); }
// the register: React (app/src/screens/Txn.jsx)
// the register as an Excel file (review item 30), the same rows and columns as the CSV, amounts as numbers
function txnTable(){
  const tab = txnTab();
  const rows = txnFiltered(tab === "bills" ? txnRowsBills() : tab === "sales" ? txnRowsSales() : txnRowsBank());
  const head = ["S. no.", "Date", "Uploaded", "Voucher", tab === "bank" ? "Reference" : "Invoice no.", tab === "sales" ? "Customer" : "Party",
    tab === "bank" ? "Withdrawal (₹)" : "Taxable (₹)", tab === "bank" ? "Deposit (₹)" : "GST (₹)", tab === "bank" ? "Amount (₹)" : "Invoice value (₹)", "In Tally", "Document"];
  const body = rows.map((r, i) => [i + 1, r.date ? fmtDate(r.date) : "", r.up ? fmtDate(r.up) : "", r.vch, r.no, r.party,
    num(tab === "bank" ? r.dr : r.taxable) || "", num(tab === "bank" ? r.cr : r.gst) || "", num(r.total) || "", r.label, r.file]);
  return {tab, head, body};
}
function txnExcel(){
  const t = txnTable();
  FC.excel("transactions-" + t.tab + "-" + new Date().toISOString().slice(0, 10), [[{bills: "Purchase", sales: "Sales", bank: "Bank"}[t.tab] || t.tab, [t.head].concat(t.body)]]);
}
// columns that can be hidden (the chooser on the Transactions page)
const TXN_COLS = [["date", "Date"], ["vch", "Voucher"], ["no", "Invoice no. / Reference"], ["party", "Party"], ["amts", "Taxable and GST / Withdrawal and deposit"], ["val", "Invoice value / Amount"], ["status", "In Tally"], ["doc", "Document"]];
// ---- from src/js/18-certificates-under-197-and-206aa-where-t.js
// a TDS return's pages are React (app/src/screens/TdsReturn.jsx); these work out what they show
function tdsSorted(tab, list, get){
  const s = ((S.tdsSort || {})[tab]) || {};
  if (!s.k) return list;
  return list.slice().sort((a, c) => { const x = get(a, s.k), y = get(c, s.k); return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * (s.d || 1); });
}
function tdsMonths(fy, q){
  const y = num(fy.slice(0, 4)), start = {Q1: 4, Q2: 7, Q3: 10, Q4: 1}[q], yy = q === "Q4" ? y + 1 : y;
  return [0, 1, 2].map(i => String(yy) + String(start + i).padStart(2, "0"));
}
// the challans a quarter uses: deposited in it, or paying one of its deductions
function tdsQuarterChallans(fy, q, rows){
  const used = new Set(rows.map(r => r.challan).filter(Boolean));
  return TDS.challans().filter(c => (TDS.fyOf(c.date) === fy && TDS.qOf(c.date) === q) || used.has(c.id));
}
// the GST tab: React (app/src/screens/Gst.jsx); GSTR-1 and 3B are app/src/screens/gst/Returns.jsx, the input register gst/InputRegister.jsx, 2B gst/TwoB.jsx, amendments, advances and reversal gst/Workings.jsx, GSTR-9 and 9C gst/Annual.jsx, ITC follow-up gst/ItcFollow.jsx, returns filed gst/ReturnsFiled.jsx, QRMP, CMP-08 and GSTR-4 gst/Periodic.jsx; the other parts are still the old pages below
// the parts of the GST tab for the GSTIN and month chosen, following its filing type
// the From Tally tab: React (app/src/screens/books/FromTally.jsx). What it asks:
// the bridge's own view of this client's company (it asks Tally nothing), asked at most once a minute
function setupKeepFor(co){
  const ks = (S.setupKeep || {})[co.id];
  if (Bridge.on() && (!ks || Date.now() - ks.at > 60000) && !S.setupKeepBusy){
    S.setupKeepBusy = true;
    Bridge.call("/keep?company=" + encodeURIComponent(BridgeSeed.company()) + Bridge.pinQ(), null, 20000).then(j => ({at: Date.now(), st: j}), e => ({at: Date.now(), error: (e && e.message) || String(e)}))
      .then(x => { S.setupKeep = S.setupKeep || {}; S.setupKeep[co.id] = x; S.setupKeepBusy = false; render(); });
  }
  return ks;
}
// the time of the bridge's daily update from Tally (build 188: Tally is read once a day, or on Update from Tally)
function keepAtSet(v){ if (/^\d{2}:\d{2}$/.test(v)) LK.keepSet({dailyAt: v}, "Tally will be updated every day at " + v + "."); }
function gstSetYm(ym){ S.gstYm = ym; Smart.keep("gst", {ym}); S.books.reco = null; render(); }
function gstSetReg(reg){ S.gstReg = reg; S.books.reco = null; render(); }
/* ---------- Today: what needs doing, across every client ---------- */
/* ---------- Inbox: every waiting document, and uploads that matched no client ---------- */
// Today, Inbox and Clients are drawn by React (app/src/screens/Today.jsx, InboxAll.jsx, Clients.jsx)
/* ---------- Tally: the connection, and everything sent ---------- */
// Settings, TDS rates and limits and reading bills (app/src/screens/SettingsMore.jsx)
function rateSet(id, k, v){ const r = S.firm.rules[id] = S.firm.rules[id] || {}; r[k] = num(v); Store.saveFirm(); render(); }
function readingToggle(which, on){
  if (which === "askClaudeNew"){ S.askClaudeNewSupplier = on; lsSet("tdsdesk:askClaudeNew", on ? "1" : ""); }
  else { S.freeFirst = on; lsSet("tdsdesk:freeFirst", on ? "1" : "0"); }
  render();
}
// ---- from src/js/20-bank-statements.js
const BANK_LEDGER_LABELS = {charges:"Bank charges", interest:"Interest received", gstCash:"GST payment (cash ledger)", tds:"TDS payment", advanceTax:"Advance / self-assessment tax",
  pf:"PF payment", esi:"ESI payment", salary:"Salary payment", cash:"Cash withdrawal / deposit"};
// ---- from src/js/22-written-rules.js
/* ---------- the rules screen ---------- */
function ruleWhenText(r){
  const w = r.when || {}, bits = [];
  (w.text || []).forEach(c => { if (String(c.v || "").trim()) bits.push({has: "contains", not: "does not contain", starts: "starts with", is: "is"}[c.op] + " \u201c" + c.v + "\u201d"); });
  if (w.dir === "out") bits.push("money out");
  if (w.dir === "in") bits.push("money in");
  if ((w.modes || []).length) bits.push(w.modes.join("/"));
  if (w.amtMin !== "" && w.amtMin != null) bits.push("at least " + INR.format(num(w.amtMin)));
  if (w.amtMax !== "" && w.amtMax != null) bits.push("at most " + INR.format(num(w.amtMax)));
  if (w.acNo) bits.push("account ending " + String(w.acNo).slice(-4));
  if (w.account && w.account !== "any") bits.push("one bank account only");
  if (w.from || w.to) bits.push("between " + (w.from ? fmtDate(w.from) : "start") + " and " + (w.to ? fmtDate(w.to) : "end"));
  return bits.join(" \u00b7 ") || "no conditions yet";
}
function bankToggle(cb, shift){
  const b = B(); if (!b) return;
  const id = cb.dataset.bsel;
  if (shift && bankLastClicked && bankLastClicked !== id){
    const vis = bankVisibleRows().slice(0, b.limit).map(r => r.id);
    const i = vis.indexOf(bankLastClicked), j = vis.indexOf(id);
    if (i >= 0 && j >= 0){ const [lo, hi] = i < j ? [i, j] : [j, i]; vis.slice(lo, hi + 1).forEach(x => { if (cb.checked) b.sel.add(x); else b.sel.delete(x); }); }
  } else if (cb.checked) b.sel.add(id); else b.sel.delete(id);
  bankLastClicked = id;
  bankLightRefresh();
}
function bkAmt(n){ return n ? INR.format(r2(n)) : ""; }
function stmtLabel(st){
  const acc = accountFor(st);
  return (exactLedger(acc.ledger) || (st.bank + (acc.last4 ? " \u00b7\u00b7" + acc.last4 : ""))) + " \u2014 " + shortDate(st.from) + " to " + shortDate(st.to) + " " + String(st.to || "").slice(0, 4);
}
// ---- from src/js/23-column-filters.js
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
Object.assign(Trash, {
  // the line under a Restore item: what, when, by whom, why
  say(x){ return x.label + " \u00b7 removed " + fmtDateTime(x.at) + (x.by ? " by " + x.by : "") + (x.reason ? " \u00b7 " + x.reason : "") + (x.server ? "" : " \u00b7 kept in this browser only"); },
});
function bankSearch(q){ const b = B(); b.q = q; b.sticky.clear(); FinComReact.redraw(); later("bq", render, 250); }
// tick a line; with Shift, every line between it and the one ticked before
function bankToggleRow(id, on, shift){ bankToggle({dataset: {bsel: id}, checked: on}, shift); }
// a client's bank settings and rules (app/src/parts/BankSettings.jsx): the settings shown or not, a standard entry's
// ledger, an automation choice, and a rule changed, paused, deleted (asked first), moved or copied to other clients
// the checks over a statement (app/src/parts/BankChecks.jsx): show only some lines, tick an entry to delete from Tally
function bankFocusGo(title, ids, note){ bankFocus(title, [].concat(ids || []), note || ""); render(); window.scrollTo({top: 0, behavior: "smooth"}); }
function reconPick(i, on){ if (!S.recon) return; if (on) S.recon.pick.add(i); else S.recon.pick.delete(i); render(); }
function bankSettingsShow(on){ B().showSettings = on; render(); }
function bankStdLedger(k, v){ const b = B(), co = CO(); co.bankLedgerNames = co.bankLedgerNames || {}; co.bankLedgerNames[k] = v; Store.saveCompany(co); suggestAll(b.rows, true); saveBank({rows: true}); render(); }
function bankOptSet(k, on){ const co = CO(); co[k] = on; Store.saveCompany(co); render(); }
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
// rule 43: a capital good's name, date put to use, credit, use, registration, date sold
function assetSet(id, k, v){ const a = (S.books.assets || []).find(x => x.id === id); if (a){ a[k] = /^(igst|cgst|sgst|cess)$/.test(k) ? r2(num(v)) : v; saveBooks(); render(); } }
function assetRemove(id){ S.books.assets = (S.books.assets || []).filter(a => a.id !== id); saveBooks(); render(); }
// the Audit tab (app/src/screens/books/Audit.jsx): the period, how often it runs by itself, and a finding's status
// or note (kept with the books)
// Financial statements (app/src/screens/books/FinStatements.jsx, its Details): the format (a format chosen by hand stays
// chosen; otherwise it follows the client's entity type, FS.cfg), the year, the stock typed when Tally does not keep it
function fsKindSet(v){ const b = S.books; b.fs = Object.assign({}, FS.cfg(b), {kind: v, kindSet: true}); S.fsRun = null; saveBooks(); render(); }
function fsFyGo(v){ S.fsFy = v; S.fsRun = null; render(); }
function fsStockSet(which, v){ const b = S.books, c = FS.cfg(b); c.stock = Object.assign({}, c.stock, {[which]: v === "" ? "" : num(v)}); b.fs = c; saveBooks(); }
// MIS (app/src/screens/books/Mis.jsx): its period and quick picks, the tab, how often it runs by itself, a supplier
// marked MSME (the run is worked out again), a month of the budget
// the period chosen is kept for the client in this browser (smart moves round 1)
function misRangeSet(key, v){ const x = misRangeQuick("ytd", S.books); S.misRange = Object.assign({from: Audit.iso(x.from), to: Audit.iso(x.to)}, S.misRange, {[key]: v}); Smart.keep("mis", S.misRange); render(); }
function misQuickGo(k){ const x = misRangeQuick(k, S.books); S.misRange = {from: Audit.iso(x.from), to: Audit.iso(x.to)}; Smart.keep("mis", S.misRange); render(); }
// (the run on its own looked at again with the new setting: MIS.maybeRun, next-fix-mis-rework)
function misFreqSet(v){ const b = S.books; b.misCfg = Object.assign({}, b.misCfg, {freq: v}); saveBooks(); MIS.maybeRun(); render(); }
function misBudSet(h2, mm, v){ const b = S.books, fy = Audit.fyStart(mm + "01").slice(0, 4); b.budget = b.budget || {}; b.budget[fy] = b.budget[fy] || {}; b.budget[fy][h2] = Object.assign({}, b.budget[fy][h2], {[mm]: v === "" ? "" : num(v)}); saveBooks(); render(); }
function auditRangeSet(key, v){ const dr = Audit.defaultRange(S.books); S.auditRange = Object.assign({from: Audit.iso(dr.from), to: Audit.iso(dr.to)}, S.auditRange, {[key]: v}); }
function auditFreqSet(v){ const b = S.books; b.auditCfg = Object.assign({}, b.auditCfg, {freq: v}); saveBooks(); render(); }
function auditFindingSet(id, key, v){
  const au = S.books.audit = S.books.audit || {st: {}};
  au.st = au.st || {}; const cur = Object.assign({s: "open"}, au.st[id]);
  if (key === "s") cur.s = v; else cur.note = v;
  cur.at = new Date().toISOString(); au.st[id] = cur; if (typeof Audit === "object" && Audit.quietSave) Audit.quietSave(); else saveBooks(); render();
}
// related parties: a ledger added (from the list or a guess), its relation, removed
function relAdd(name){ const b = S.books; if (!(b.auditRel || []).some(x => x.name === name)) b.auditRel = (b.auditRel || []).concat([{name, relation: ""}]); saveBooks(); render(); }
function relSet(name, relation){ const x = (S.books.auditRel || []).find(z => z.name === name); if (x){ x.relation = relation; saveBooks(); render(); } }
function relRemove(name){ const b = S.books; b.auditRel = (b.auditRel || []).filter(x => x.name !== name); saveBooks(); render(); }
// Send again (Books > From Tally): the file this page still holds (or this browser's own copy of it); else it is chosen again
async function tallySendAgain(i){
  const b = S.books, p = b && ((b.meta || {}).parts || [])[i];
  if (!p) return;
  const cid = b.cid || S.coId, k = p.wait || ("tcup:" + cid + ":" + p.from + "-" + p.to);
  if (!TCloudUp.on()){ toast("Sign in to the firm account first: then Send again."); return; }
  if (TCloudUp.live.has(k)){ toast((p.file || "This day book") + " is being sent now."); return; }
  let x = null; try { x = await IDBStore.get(k); } catch (e){}
  const f = TCloudUp.files[k] || (x && x.blob);
  if (!f){
    p.cloud = "not sent: this page no longer holds " + (p.file || "the file") + " (it was reloaded); choose it again";
    p.again = false; render();
    toast("Choose " + (p.file || "the Day Book") + " again: this page no longer holds it.");
    tallyPickFor(tallyDate(p.from), tallyDate(p.to));
    return;
  }
  const who = (x && x.who) || {client: cid, company: BridgeSeed.company()};
  TCloudUp.keep(cid, f, {from: p.from, to: p.to});
  const held = !(x && x.blob) && f.size <= DayCut.PIECE ? TCloudUp.hold(cid, f, {from: p.from, to: p.to}, who).catch(() => {}) : null;
  p.wait = k; b.busy = "Sending " + (p.file || "the day book") + " to FinCom’s cloud…"; render();
  await tallyCloudSend(b, p, f, k, who, m => { b.busy = m; softRender(); }, held);
  b.busy = ""; await saveBooks(null, b); render();
}
// the trial balance asked about on the page: as opening balances, or to check the books against
async function tbAskUse(how){
  const a = S.tbAsk; if (!a || a.cid !== S.coId) return;
  const on = String(a.on || "").replace(/-/g, "");
  const r = how === "open" ? await bringTbFile(a.f, on, {toast: false}) : await checkTbFile(a.f, on, {toast: false});
  if (r.refused && /date/.test(r.refused) && !/^\d{8}$/.test(on)){ toast(r.refused); return; }
  S.tbAsk = null;
  S.tallyUp = {cid: S.coId, at: Date.now(), busy: false, lines: [{kind: "tb", name: a.name, ok: !r.refused, text: r.refused ? "The trial balance was not taken: " + r.refused : r.text}]};
  render();
}
// a day (or the dates between two files) that needs its Day Book: the one file box, for those dates only (yyyy-mm-dd)
function tallyPickFor(from, to){ S.dbFrom = from || ""; S.dbTo = to || from || ""; render(); const i = document.getElementById("tallyIn"); if (i){ i.value = ""; i.click(); } }
// ---- from src/js/24-tally-bridge.js
/* ---------- settings ---------- */
// the Tally Bridge settings (app/src/screens/Tally.jsx): an address, key or following typed; a Tally company linked to a
// client; one Tally chosen (a port) or back to automatic
function bridgeSet(k, v){ Bridge.setCfg({[k]: typeof v === "string" ? v.trim() : v}); if (k !== "follow"){ Bridge.lastOpenKey = null; startBridgePolling(); } render(); }
function bridgePin(port){
  port = num(port); Bridge.setCfg({port: port || 0}); Bridge.lastOpenKey = null;
  if (S.bank){ S.bank.syncedAt = {}; S.bank.ledgers.importedAt = ""; }
  Bridge.refresh().then(() => { toast(port ? "FinCom now uses only the Tally on port " + port + "." : "FinCom picks your Tally automatically."); bridgeTick(false); render(); });
}
// ---- from src/js/25-sales.js
// the states in code order (01 … 38, then 96, 97): an object's number-like keys ("10") come before "01" in JavaScript
function gstStateList(){ return Object.keys(GST_STATES).sort((a, b) => num(a) - num(b)).map(c => [c, GST_STATES[c]]); }
// From 22-09-2025 (GST rate rationalisation) most goods and services moved from 12% to 5% and from 28% to 18%;
// 12% and 28% remain only for a few items. Kept in the list, with a warning on later invoices (review item 10).
const GST_RATE_CHANGE = "2025-09-22";
function salesRateWarnings(x){
  const out = [];
  if (!x || !x.date || x.date < GST_RATE_CHANGE) return out;
  (x.items || []).forEach((it, i) => {
    const r = num(it.gstRate);
    if ((r === 12 || r === 28) && (String(it.desc || "").trim() || num(it.rate)))
      out.push("Item " + (i + 1) + (it.hsn ? " (HSN/SAC " + it.hsn + ")" : "") + ": " + r + "% applies after 22-09-2025 only to a few items; most moved to " + (r === 12 ? "5%" : "18%") + ". Check the rate for this HSN/SAC.");
  });
  return out;
}
const SALES_UNITS = ["Nos", "Pcs", "Kg", "Gm", "Ltr", "Mtr", "Sq Ft", "Box", "Set", "Hrs", "Days", "Month", "Job"];
// output tax ledgers (optionally rate-wise, e.g. "Output CGST 9%" or "Output IGST 18"); v: the invoice, for the state of
// the client's own registration it is issued from (next-fix-igst-pick, 16-Nov-2026: taxLedgerPick, below)
function taxLedgerFor(kind, rate, v){ return taxLedgerPick(kind, rate, v).ledger; }
// the person's answer when the books use several sales types: kept for the client
function salesVtAnswer(t){ const s = SL(); if (!s || !t) return; s.cfg.voucherType = t; s.cfg.vtBy = "asked"; s.cfg.vtFrom = "books"; delete s.cfg.vtNotice; s.vtAsk = null; saveSales({cfg: true}); s.list.forEach(v => mapInvoice(v)); render(); }
// the notice of a type learnt from the books, shown until the person closes it or presses Change
function salesVtNoticeDone(open){ const s = SL(); if (!s) return; if (s.cfg.vtNotice) s.cfg.vtNotice.seen = new Date().toISOString(); if (open) s.showSettings = true; saveSales({cfg: true}); render(); }
// ---- from src/js/26-sales-from-a-marketplace.js
// "It is this invoice": the Tally voucher of this number (another amount) is this invoice: In Tally, never posted
function salesNearAnswer(id){
  const s = SL(), v = inv(id), m = v && v.dupBlock; if (!m || m.src === "fincom" || !["review", "ready"].includes(v.status)) return;
  delete v.dupBlock; v.status = "intally"; v.postNote = "Already in Tally"; v.tallyMatch = m;
  auditEvent("sales_tally_same", "Invoice " + (v.x.number || v.id) + ": the Tally voucher " + [m.type, m.number, m.date, m.amount].join(" ") + " is this invoice", s.cid);
  saveSales(); render();
}
function salesSearch(q){ const s = SL(); s.q = q; s.sticky.clear(); FinComReact.redraw(); later("sq", render, 250); }
function salesToggle(id, on, shift){
  const s = SL();
  if (shift && salesLastClicked){ const vis = salesVisible().map(v => v.id); const i = vis.indexOf(salesLastClicked), j = vis.indexOf(id); if (i >= 0 && j >= 0) vis.slice(Math.min(i, j), Math.max(i, j) + 1).forEach(x => on ? s.sel.add(x) : s.sel.delete(x)); }
  else if (on) s.sel.add(id); else s.sel.delete(id);
  salesLastClicked = id; salesLightRefresh();
}
// an invoice's customer ledger; false when it is not a Tally ledger (the box goes back)
function salesSetCust(id, val){
  const s = SL(), v = inv(id); if (!v) return true;
  val = String(val || "").trim();
  if (!val){ v.customerLedger = ""; v.userLedger = false; salesPartyFill(v); mapInvoice(v); saveSales(); render(); return true; }
  if (!exactLedger(val)){ toast("“" + val + "” is not a Tally ledger. Choose one from the list, or create it."); return false; }
  if (s.sel.has(v.id) && s.sel.size > 1){ salesBulk("ledger", exactLedger(val)); return true; }
  if (setCustomerLedger(v, val)) render();
  return true;
}
// the invoice being created
function draftSet(k, val){
  const s = SL(), x = s.draft.x;
  x[k] = k === "dueDays" ? num(val) : k === "customerGstin" ? String(val).trim().toUpperCase() : val;
  if (k === "customerGstin" && gstinValid(x.customerGstin)) x.pos = stateOfGstin(x.customerGstin);
  if (k === "date" && !s.draft.editId){ const nn = nextInvoiceNumber(x.date); if (normInvNo(x.number) !== normInvNo(nn.number) && /\{FY\}/.test(s.cfg.series)){ x.number = nn.number; s.draft.seriesN = nn.n; } }
  recalcDraft(); render();
}
function draftItemRemove(i){ const s = SL(); s.draft.x.items.splice(i, 1); if (!s.draft.x.items.length) s.draft.x.items.push(blankItem()); recalcDraft(); render(); }
// the customer of the invoice being created; false when it is not a Tally ledger
function draftCust(val){
  const s = SL(); val = String(val || "").trim();
  if (!val){ s.draft.customerLedger = ""; render(); return true; }
  const l = exactLedger(val);
  if (!l){ toast("“" + val + "” is not a Tally ledger. Choose one, or create it from the list."); return false; }
  applyDraftCustomer(l); return true;
}
function salesCfgCheck(k, on){ const s = SL(); s.cfg[k] = on; saveSales({cfg: true}); s.list.forEach(v => mapInvoice(v)); render(); }
// ---- from src/js/27-firm-account.js
/* ---------- plan, balance and charging ---------- */
const MODULE_ICON = {bills: "\u{1F9FE}", bank: "\u{1F3E6}", sales: "\u{1F4C4}", claude: "\u2728", vision: "\u{1F441}", tally: "\u{1F4D2}", cloud: "\u2601", clients: "\u{1F465}"};
function moduleIncluded(code){
  const inc = S.account && S.account.firm && S.account.firm.plan && S.account.firm.plan.includes;
  return !!(inc && inc[code]);
}
// an approved bill, not yet in Tally, back to To review (staying on the page it was sent back from)
function billBack(id){ const e = D().entries[id]; if (e){ const keep = S.tab; undoApproval(e); S.tab = keep; render(); } }
// a ledger Tally does not have, in the bills waiting to be posted: use the Tally ledger chosen instead
function billFixPick(old, role, to){
  if (!to){ toast("Choose the Tally ledger first."); return; }
  const n = replaceLedgerInWaiting(S.coId, old, to, role);
  toast("\u201c" + to + "\u201d used in " + n + " bill" + (n === 1 ? "" : "s") + " and saved for future bills.");
  refreshStats(S.coId); render();
}
// open a kind of document (bills, bank, sales) at a step; the step the client is on when none is given
function goDocType(type, step){
  step = step || curStep();
  if (type === "bank" && (!S.bank || S.bank.cid !== S.coId)) loadBank(S.coId).then(() => { if (S.pendingBankFilter && S.bank){ S.bank.filter = S.pendingBankFilter; S.pendingBankFilter = null; } render(); });
  goStep(step === "post" && type === "sales" ? "review" : step, type);
}
function txnGo(kind, id){
  if (kind === "bill"){ const e = D().entries[id]; if (e){ S.tab = "invoices"; S.filter = e.status === "duplicate" ? "duplicate" : e.status; S.reviewTable = e.status === "draft"; S.selected = id; S.drawerOpen = e.status === "draft"; render(); window.scrollTo(0, 0); } return; }
  if (kind === "sale"){ S.tab = "sales"; if (SL()) SL().openId = id; render(); window.scrollTo(0, 0); return; }
  S.tab = "bank"; if (S.bank){ S.bank.filter = "all"; S.bank.sticky.add(id); } render(); window.scrollTo(0, 0);
}
// 2B reconciliation (app/src/screens/gst/TwoB.jsx): its tab, span, filters, and what the user settles about a document
// 27Q: a non-resident deductee's details for the file; 27EQ: a TCS ledger's collection code
function tdsNrSet(party, k, v){ const b = S.books; b.nrInfo = Object.assign({}, b.nrInfo); b.nrInfo[party] = Object.assign({}, b.nrInfo[party], {[k]: typeof v === "string" ? v.trim() : v}); saveBooks(); render(); }
function tdsTcsCode(ledger, code){ const b = S.books; b.tcsCodes = Object.assign({}, b.tcsCodes, {[ledger]: code}); saveBooks(); render(); }
function tdsFilter(tab, key, val, typed){ S.tdsFl = Object.assign({}, S.tdsFl, {[tab]: Object.assign({}, (S.tdsFl || {})[tab], {[key]: val})}); if (typed){ FinComReact.redraw(); later("tdsf", render, 250); } else render(); }
// one row opened under a table (a challan's deductions, a deductee's, an employee's months); a second click closes it
function tdsToggle(which, key){ S[which] = S[which] === key ? "" : key; render(); }
// a challan taken out (tds-layout): a soft delete with its reason, the one dialog; TDSReg.canDelete says when it cannot be
// (read from Tally, or anything allocated to it); Undo brings it back
async function challanDelete(id){
  const c = TDS.challans().find(z => z.id === id), no = TDSReg.canDelete(c);
  if (no){ toast(no); return false; }
  const ok = await askConfirm({title: "Delete challan " + TDSCH.label(c) + "?", ok: "Delete", danger: true,
    body: "It leaves the register; the register keeps it, with your reason, under Deleted.<br><label>Why <input type=\"text\" id=\"chDelWhy\" style=\"width:100%\"></label>",
    read: () => (document.getElementById("chDelWhy") || {}).value || "", validate: (v) => String(v || "").trim().length < 3 ? "Say why the challan is deleted." : ""});
  if (!ok || !ok.ok) return false;
  const r = TDSReg.deleteHand(id, ok.data);
  if (r.ok) toast("Challan " + TDSCH.label(c) + " deleted.", {actions: [{label: "Undo", run: () => { TDSReg.restore(id); render(); }}]}); else toast(r.why);
  render(); return r.ok;
}
function certAdd(c){
  const party = String(c.party || "").trim();
  if (!party){ toast("Name the deductee as it appears in Tally."); return false; }
  S.books.certs = (S.books.certs || []).concat([{id: uid("ct"), party, pan: String(c.pan || "").toUpperCase().trim(), section: String(c.section || "").toUpperCase().trim(),
    certNo: String(c.certNo || "").trim(), rate: num(c.rate), from: c.from || "", to: c.to || "", limit: num(c.limit)}]);
  saveBooks(); toast("Certificate added."); render(); return true;
}
function certDelete(id){ S.books.certs = (S.books.certs || []).filter(c => c.id !== id); saveBooks(); render(); }
function gstViewGo(v){ S.gstView = v; render(); }
function acctPerson(what, email){
  // a reset link by email: they choose the new password; "makepw" is the fallback where email is not set up
  if (what === "reset") Cloud.fn("admin", {action: "send_reset", email, redirect: appUrl()}).then(r => { S.newPerson = null; toast(r.note || "Reset link sent."); render(); },
    e => toast(adminNotYet(e) ? "Reset links by email start once the firm account\u2019s update is done. For now, use \u201cMake a password\u201d." : e.message));
  else if (what === "makepw") Cloud.fn("admin", {action: "reset_password", email}).then(r => { S.newPerson = {email: r.email, password: r.password}; toast("New password made."); render(); }, e => toast(e.message));
  else if (what === "unlock") Cloud.fn("admin", {action: "unlock", email}).then(r => toast(r.note || "Unlocked."),
    e => toast(adminNotYet(e) ? "The lockout starts once the firm account\u2019s update is done: nobody is locked out until then." : e.message));
  else if (what === "mfa") askConfirm({title: "Reset two-step sign-in for " + email + "?", ok: "Reset", body: '<p class="note">Their authenticator entry is removed. At the next sign-in they set it up again with their phone. Do this only when you are sure it is them asking.</p>'})
    .then(a => { if (a) Cloud.fn("admin", {action: "reset_two_step", email}).then(() => toast("Two-step sign-in reset for " + email + "."), e => toast(e.message)); });
  else Cloud.fn("admin", {action: "set_person", email, active: what === "on"}).then(() => { toast(what === "on" ? "Switched on." : "Switched off."); loadAccount(); }, e => toast(e.message));
}
function acctBackup(id){
  // (the firm's whole backup: the server may take long to start its answer; the answer itself is waited for while it comes)
  Cloud.api("rpc/backup_data", {method: "POST", body: {p_id: num(id)}, timeout: 180000}).then(d => {
    saveFile("tds-desk-backup-" + new Date().toISOString().slice(0, 10) + ".json", new Blob([JSON.stringify(d, null, 1)], {type: "application/json"}));
    toast("Downloaded. Keep it somewhere outside this system.");
  }, e => toast(e.message));
}
function acctDropOff(id){
  askConfirm({title: "Switch this key off?", ok: "Switch it off", body: '<p class="note">Anything using this key will no longer be able to send files in.</p>'}).then(a => {
    if (!a) return;
    Cloud.rpc("revoke_drop_key", {p_id: id}).then(() => Cloud.rpc("my_drop_keys")).then(k => { S.dropKeys = [].concat(k || []); render(); }, e => toast(e.message));
  });
}
function cloudAuto(on){ Cloud.setCfg({auto: on}); startCloudSync(); render(); }
function docsKeep(on){ S.firm.cloudDocs = on; Store.saveFirm(); toast(on ? "Documents will be kept in the firm account." : "Documents stay on this computer only."); render(); }
function docYearsSet(v){ S.firm.docYears = num(v); Store.saveFirm(); render(); }
// per payment type: the TDS ledger (kind "tds") or the default expense ledger (kind "exp")
function coSetRuleLedger(kind, ruleId, v){ const co = CO(); const m = kind === "tds" ? co.tdsLedgers : co.expenseLedgers; if (!((co.id + kind + ruleId) in SETUP_PREV)) SETUP_PREV[co.id + kind + ruleId] = m[ruleId] || ""; m[ruleId] = v; later("c" + co.id, () => Store.saveCompany(co), 600); }
// a TDS ledger of another section, or an income ledger as the expense default, is refused when the box is left
function coCommitRuleLedger(kind, ruleId){
  const co = CO(); if (!co) return;
  const m = kind === "tds" ? co.tdsLedgers : co.expenseLedgers, val = String(m[ruleId] || "").trim(), pk = co.id + kind + ruleId, prev = pk in SETUP_PREV ? SETUP_PREV[pk] : val;
  delete SETUP_PREV[pk];
  if (!val) return;
  const r = ruleOf(ruleId), listed = Ledgers.cid() === co.id && hasLedgerList();
  let msg = "";
  if (kind === "tds"){ const c = tdsLedgerCheck(co.id, val, Ledgers.sec(r.old)); if (!c.ok && (listed || c.sec)) msg = c.msg; else if (c.ok) m[ruleId] = c.name; }
  else if (listed){ const ex = exactLedger(val); if (ex && Ledgers.cls(co.id, ex) === "income") msg = "\u201c" + ex + "\u201d is an income ledger, not for purchase bills"; }
  if (msg){ m[ruleId] = prev; toast(msg + ". Not taken: " + (prev ? "\u201c" + prev + "\u201d kept." : "left empty.")); }
  Store.saveCompany(co); render();
}
function coSetBlockRule(catId, v){ const co = CO(); co.gstBlock = co.gstBlock || {}; co.gstBlock[catId] = v; Store.saveCompany(co); render(); }
function firmSetupSave(d){
  const name = String(d.name || "").trim();
  if (!name){ toast("The firm\u2019s name is needed."); return false; }
  S.firm.firmName = name.slice(0, 120); firmNameToAccount(S.firm.firmName);
  S.firm.firmAddress = String(d.address || "").trim().slice(0, 400);
  if (d.logo !== undefined) S.firm.firmLogo = d.logo || "";
  Store.saveFirm(); toast("Saved."); render();
  return true;
}
// a logo picked from the computer, kept small (a data URL of at most about 150 KB)
function firmLogoRead(file){
  return new Promise((ok, no) => {
    if (!file || !/^image\//.test(file.type)){ no(new Error("Choose a picture (PNG or JPG).")); return; }
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 320 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      const out = c.toDataURL("image/png");
      out.length > 200000 ? no(new Error("The logo is too large; use a smaller picture.")) : ok(out);
    };
    img.onerror = () => no(new Error("That picture could not be read."));
    img.src = url;
  });
}
function firmSetName(v){ S.firm.firmName = v; later("firm", () => { if (typeof Drafts === "object" && Drafts.hold("firm")) return; Store.saveFirm(); firmNameToAccount(v); }, 600); const el = document.getElementById("firmLine"); if (el) el.textContent = v; }
// an owner clears a client's wrong GSTIN or PAN, with a reason (review of 02-Oct-2026): on the server through
// client_clear_ids (migration-25; a sync alone can never empty them), then here
async function coClearIds(what){
  const co = CO(), label = what.map(w => w === "gstin" ? "GSTIN " + (co.gstin || "") : "PAN " + (co.pan || "")).join(" and ");
  const ok = await askConfirm({title: "Clear the " + label + "?", ok: "Clear it", danger: true,
    body: "<p>" + esc(co.name) + " will have no " + what.map(w => w.toUpperCase()).join(" or ") + " in FinCom until one is typed again. Returns and checks that need it will say so.</p>" +
      '<label class="f" style="margin-top:12px"><span>Reason (kept with the change)</span><input type="text" id="cbxWhy" autocomplete="off" aria-label="Reason"></label>',
    read: () => ({reason: ((document.getElementById("cbxWhy") || {}).value || "").trim()}),
    validate: v => v.reason ? "" : "Give the reason."});
  if (!ok) return;
  const reason = (ok.data && ok.data.reason) || "";
  if (Cloud.on() && Cloud.st.state !== "off"){
    try { await Cloud.rpc("client_clear_ids", {p_client: co.id, p_what: what, p_reason: reason}); }
    catch (e){ const m = String((e && e.message) || e); toast(/client_clear_ids|does not exist|schema cache/i.test(m) ? "FinCom's cloud is not ready for this yet (migration-25)." : m); return; }
  }
  what.forEach(w => { co[w] = ""; });
  co.idsCleared = (co.idsCleared || []).concat([{what, reason, at: new Date().toISOString(), by: (Cloud.st && Cloud.st.email) || ""}]).slice(-20);
  Store.saveCompany(co); toast("Cleared. Type the right " + what.map(w => w.toUpperCase()).join(" and ") + " when you have it."); render();
}
// ---- from src/js/33-customer-ims.js
/* ================================================================== */
/* Our invoices and credit notes rejected by the customer in IMS      */
/* ================================================================== */
// The customer's IMS is theirs: nothing about their action comes to us in a file, so the rejections are marked
// here by hand, document by document, from the books' own sales. What each one does:
//  - an invoice rejected: our tax stays as reported. If the invoice is right, the customer accepts it (before their 3B)
//    or we send it again by amending it; if it is wrong, it is corrected in Tally (reported as an amendment) or cancelled
//    by a credit note.
//  - a credit note rejected: the portal adds its tax back to our liability, in the 3B of the month after the customer
//    rejected it. That add-back is put into 3.1(a) here in the same month, and taken out again if the customer later
//    accepts it (usually after we amend and send it again).
// CustIMS: the whole object is in server/_shared/gst3b.js (the GSTR-3B engine, shared with the gst-run function)
// the "Rejected by customers in IMS" card under GSTR-1: React (app/src/screens/gst/CustIms.jsx)
// a document marked as rejected by the customer, or not after all
function custImsAdd(id){ CustIMS.add(S.gstReg || "", id); S.custImsQ = ""; GSTR._carry = null; saveBooks(); render(); }
function custImsRemove(id){ delete CustIMS.store(S.gstReg || "")[id]; GSTR._carry = null; saveBooks(); render(); }
// what is kept for one: rejYm, addYm, doneYm, act, remark
function custImsSet(id, key, val){
  const s = CustIMS.store(S.gstReg || "")[id]; if (!s) return;
  s[key] = val; if (key === "act" && val === "accepted" && !s.doneYm) s.doneYm = s.addYm;
  GSTR._carry = null; saveBooks(); if (key !== "remark") render();
}
// ---- from src/js/35-gst-filing.js
Object.assign(GSTMark, {
  set(ym, reg, k, on, arn, via){
    const r = GSTF.rec(ym, reg);
    r[k] = on || r[k] || GSTF.today();
    if (arn){ r[k + "Arn"] = arn; if (via) r[k + "Via"] = via; else delete r[k + "Via"]; }
    if (k === "r3b" && !r.snap && typeof GSTR === "object"){ r.snap = GSTF.snapOf(GSTR.threeB(ym, reg)); r.snapAt = new Date().toISOString(); }
    if (k === "iff"){ delete r.iffSkip; if (typeof GSTQ === "object") GSTQ.iffSnap(ym, reg); }
    GSTR._carry = null; return r;
  },
});
function gstfJournal(){
  const ym = S.gstYm || "", reg = S.gstReg || "", J = GSTF.journal(ym, reg); if (!J.lines.length){ toast("Nothing to set off this month."); return; }
  if (!J.balanced){ toast("A ledger is missing in Tally (" + J.missing.join(", ") + "); the journal would not balance."); return; }
  const co = CO() || {}; saveFile(String(co.name || "client").replace(/[^A-Za-z0-9]+/g, "-") + "-GST-setoff-" + reg + "-" + ym + ".xml", new Blob([Audit.jeXml([{date: J.date, narr: J.narr, lines: J.lines}])], {type: "application/xml"}));
}
// the GSTR-1A file; a copy is kept so the next GSTR-1 does not report these again
function gst1aJson(){
  const ym = S.gstYm || "", reg = S.gstReg || "", r = GSTAmend.json1a(ym, reg); if (!r || !r.rows.length) return;
  const out = Object.assign({version: "GST3.2.1", hash: "hash"}, r.json);
  GSTAmend.keep1a(out); saveBooks();
  saveFile("GSTR1A_" + out.gstin + "_" + out.fp + ".json", new Blob([JSON.stringify(out)], {type: "application/json"}));
  render(); toast("GSTR-1A for " + GSTR.label(ym) + " downloaded and kept.");
}
// ---- from src/js/36-gst-settings.js
Object.assign(GSTRegs, {
  source(g, b){ b = b || S.books || {}; const co = CO() || {};
    const t = [];
    if (((b.meta || {}).gstins || []).map(x => String(x).toUpperCase()).includes(g)) t.push("from Tally");
    if ((b.gstRegs || []).some(r => r.gstin === g)) t.push("added here");
    if (String(co.gstin || "").toUpperCase().trim() === g) t.push("Client setup");
    return t; },
  // why a GSTIN cannot be added, or "" when it can
  refuse(g, b){ g = String(g || "").toUpperCase().trim(); b = b || S.books || {};
    if (!/^\d{2}[A-Z0-9]{13}$/.test(g)) return "A GSTIN has 15 characters: 2-digit state code, PAN, entity number, Z and a check character.";
    if (!gstinValid(g)) return g + " is not a valid GSTIN: its last character (the check character) does not agree with the rest.";
    if (!this.STATES[g.slice(0, 2)]) return g + " starts with " + g.slice(0, 2) + ", which is not a state code.";
    const pan = clientPan();
    if (!pan) return "Type the client’s PAN in Client setup first; every GSTIN added must carry it.";
    if (g.slice(2, 12) !== pan) return g + " is for PAN " + g.slice(2, 12) + ", not this client’s PAN " + pan + ".";
    if (GSTR.gstins(b).includes(g)) return g + " is already here.";
    if (GSTR.gstins(b).some(x => x.slice(0, 2) === g.slice(0, 2))) return "This client already has a GSTIN in " + this.state(g) + "; FinCom keeps one GSTIN for each state.";
    return ""; },
  remove(g){ const b = S.books; b.gstRegs = (b.gstRegs || []).filter(r => r.gstin !== g); GSTR._carry = null; },
});
// a setting changed for one GSTIN: with more than one, ask whether it is for this GSTIN only (the default), all of them, or those ticked
async function gsetApply(reg, what, fn){
  const regs = GSTR.gstins(S.books), others = regs.filter(g => g.slice(0, 2) !== reg), me = regs.find(g => g.slice(0, 2) === reg) || reg;
  if (!others.length || typeof document === "undefined"){ fn(reg); return true; }
  const r = await askConfirm({title: "Apply to which GSTINs?", ok: "Save",
    body: "<p>" + esc(what) + " for " + esc(me) + ".</p>" +
      '<label class="chk" style="display:block"><input type="radio" name="gapto" value="one" checked> Only ' + esc(me) + "</label>" +
      '<label class="chk" style="display:block"><input type="radio" name="gapto" value="all"> All ' + regs.length + " GSTINs of the client</label>" +
      '<label class="chk" style="display:block"><input type="radio" name="gapto" value="some"> ' + esc(me) + " and the GSTINs ticked:</label>" +
      '<div style="margin-left:24px">' + others.map(g => '<label class="chk" style="display:block"><input type="checkbox" data-gapto="' + g.slice(0, 2) + '"> ' + esc(g) + " · " + esc(GSTRegs.state(g)) + "</label>").join("") + "</div>",
    onReady: box => box.querySelectorAll("[data-gapto]").forEach(c => c.addEventListener("change", () => { if (c.checked){ const s = box.querySelector('input[name="gapto"][value="some"]'); if (s) s.checked = true; } })),
    read: () => { const box = document.getElementById("confirmBox"), mode = (box.querySelector('input[name="gapto"]:checked') || {}).value || "one";
      return {mode, ticked: Array.from(box.querySelectorAll("[data-gapto]:checked")).map(c => c.dataset.gapto)}; },
    validate: d => d.mode === "some" && !d.ticked.length ? "Tick the other GSTINs, or choose “Only " + me + "”." : ""});
  if (!r){ render(); return false; }
  const to = r.data.mode === "all" ? regs.map(g => g.slice(0, 2)) : r.data.mode === "some" ? [reg].concat(r.data.ticked) : [reg];
  Array.from(new Set(to)).forEach(x => fn(x));
  if (to.length > 1) toast(what + ": saved for " + to.length + " GSTINs.");
  return true;
}
// the GST settings page: React (app/src/screens/gst/GstSettings.jsx). What it changes:
// a filing type from a quarter: chosen here, set with "Set" (asked for which GSTINs when there are more)
function gsetPick(reg, key, v){ const k = key === "from" ? "gsetFrom" : "gsetType"; S[k] = Object.assign({}, S[k], {[reg]: v}); }
function gsetFilingAdd(reg, shownType){
  const months = GSTR.months(), from = (S.gsetFrom || {})[reg] || GSTSet.qStart(months[0] || GSTF.today().slice(0, 7).replace("-", "")), type = (S.gsetType || {})[reg] || shownType || "monthly";
  gsetApply(reg, GSTSet.typeLabel(type) + " from " + GSTSet.qLabel(from), x => { const st = GSTSet.store(x); st.filing = (st.filing || []).filter(y => y.from !== from).concat([{type, from}]); })
    .then(done => { if (!done) return; GSTR._carry = null; saveBooks(); render(); toast(GSTSet.typeLabel(type) + " from " + GSTSet.qLabel(from) + "."); });
}
function gsetFilingDel(reg, from){ const st = GSTSet.store(reg); st.filing = (st.filing || []).filter(x => x.from !== from); saveBooks(); render(); }
// a setting that can be shared with the client's other GSTINs, if the user says so
function gsetShared(reg, key, val){
  const b = S.books, share = {basis: ["Credit in 3B table 4", x => { b.itcBasis = Object.assign({}, b.itcBasis, {[x]: val}); }],
    r37: ["Rule 37 " + (val ? "on" : "off"), x => { b.rule37On = Object.assign({}, b.rule37On, {[x]: !!val}); }],
    einv: ["E-invoicing", x => { GSTSet.store(x).einv = val; }],
    pmt: ["PMT-06 method", x => { GSTSet.store(x).pmt = val; }],
    comp: ["Composition rate", x => { GSTSet.store(x).comp = val; }]}[key];
  // cancelled: the control shows the saved value again (a new S.gsetNonce draws it afresh)
  gsetApply(reg, share[0], share[1]).then(done => { if (done){ GSTR._carry = null; saveBooks(); } else S.gsetNonce = (S.gsetNonce || 0) + 1; render(); });
}
// a setting of one GSTIN or of the client: open (with head), puser, api, est, cash, aato (with the year), d2
function gsetSet(key, val, reg, sub){
  const b = S.books;
  if (key === "open"){ b.gstOpen = Object.assign({}, b.gstOpen); b.gstOpen[reg] = Object.assign({}, b.gstOpen[reg], {[sub]: val === "" ? "" : num(val)}); }
  if (key === "puser") GSTSet.store(reg).portalUser = String(val).trim();
  if (key === "api") b.gstApi = val;
  if (key === "est") b.gstEst = !!val;
  if (key === "cash") b.gstCashLedger = Object.assign({}, b.gstCashLedger, {[reg]: val});
  if (key === "aato") b.gstAato = Object.assign({}, b.gstAato, {[sub]: num(val)});
  if (key === "d2") b.rev = Object.assign({}, b.rev, {d2: !!val});
  GSTR._carry = null; saveBooks(); render();
}
// a GSTIN added (it must carry the client's PAN) or removed
function gregAdd(g){
  g = String(g || "").toUpperCase().trim(); const why = GSTRegs.refuse(g, S.books);
  if (why){ toast(why); return false; }
  GSTRegs.add(g); S.gsetReg = g.slice(0, 2); S.gstReg = g.slice(0, 2); saveBooks(); render(); toast(g + " added (" + GSTRegs.state(g) + ")."); return true;
}
function gregRemove(g){
  // no question first (spec K9, round 2): nothing is lost, adding it again brings everything back
  GSTRegs.remove(g); saveBooks(); toast(g + " removed. Its settings, 2B and returns filed stay with the books and come back if it is added again."); render();
}
// a party's email or phone for GST letters
function gcontSet(gstin, key, val){ const b = S.books; b.gstContacts = Object.assign({}, b.gstContacts); b.gstContacts[gstin] = Object.assign({}, b.gstContacts[gstin], {[key]: String(val).trim()}); saveBooks(); }
function booksHasAny(b){ return !!b && BOOKS_WIPE.some(k => { const v = b[k]; return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : !!v; }); }
// ---- from src/js/37-gst-periodic.js
/* ================================================================== */
/* Returns for GSTINs that are not monthly filers                     */
/*  QRMP: IFF (months 1-2, optional), PMT-06 (months 1-2), GSTR-1 and */
/*        GSTR-3B for the quarter                                     */
/*  Composition: CMP-08 each quarter, GSTR-4 for the year             */
/* ================================================================== */
// GSTQ: the whole object is in server/_shared/gst3b.js (the GSTR-3B engine, shared with the gst-run function)
// the QRMP, CMP-08 and GSTR-4 pages: React (app/src/screens/gst/Periodic.jsx)
// a date or choice kept for a month (or quarter end) and GSTIN: IFF filed on, PMT-06 method, CMP-08 filed on
function gqSetField(k, v, ym){ const r = GSTF.rec(ym || S.gstYm || "", S.gstReg || ""); if (v === "") delete r[k]; else r[k] = v; GSTR._carry = null; saveBooks(); render(); }
// PMT-06 paid, head by head
function gqSetPaid(k, v){ const r = GSTF.rec(S.gstYm || "", S.gstReg || ""); r.pmt06 = Object.assign({}, r.pmt06, {[k]: v === "" ? 0 : num(v)}); GSTR._carry = null; saveBooks(); render(); }
// the IFF file for the month; a copy is kept so the quarter's GSTR-1 leaves these invoices out once filed
function gqIffJson(){
  const ym = S.gstYm || "", reg = S.gstReg || "";
  if (typeof ledgersReady === "function" && !ledgersReady("gst")) return;
  const f = GSTQ.iff(ym, reg); GSTF.rec(ym, reg).iffKeys = f.keys;
  try { GSTAmend.keep(JSON.parse(JSON.stringify(f.json)), "downloaded", {iff: true}); } catch (e2){}
  saveBooks(); saveFile("IFF_" + f.json.gstin + "_" + f.json.fp + ".json", new Blob([JSON.stringify(f.json)], {type: "application/json"}));
}
function gqQuarterType(type){ GSTQ.setQuarterType(S.gstYm || "", S.gstReg || "", type); saveBooks(); render(); }
// ---- from src/js/39-gst-api.js
// the card is drawn by React (app/src/screens/GstApiCard.jsx) in this place
function viewGstApiCard(b){ return GSTAPI.gstinOf(S.gstReg || ((GSTR.gstins(b) || [])[0] || "").slice(0, 2)) ? '<div data-react="GstApiCard"></div>' : ""; }
// ---- from src/js/40-support.js
Object.assign(SUP, {
  MODULES: ["Purchase bills", "Bank", "Sales", "Inbox", "TDS", "GST", "GST API", "Tally connection", "Accounts, MIS, audit", "Firm account and billing", "Other"],
  CATS: [["question", "Question / how to"], ["problem", "Something is wrong"], ["request", "New feature or change"], ["data", "Data or figures look wrong"], ["billing", "Plan, credit, billing"]],
  PRI: [["low", "Low", "a question, no hurry"], ["medium", "Medium", "work slowed"], ["high", "High", "work stopped for a client"], ["urgent", "Urgent", "a due date today or tomorrow"]],
  ST: {new: "New", open: "Open", waiting: "Awaiting firm", resolved: "Resolved", closed: "Closed"},
  code(t){ return t.code || ("T-" + t.num); },
  moduleOf(c){
    if (!c) return "Other";
    if (c.view === "company"){
      if (c.tab === "books") return /gst/.test(c.screen) ? "GST" : /tds/.test(c.screen) ? "TDS" : "Accounts, MIS, audit";
      return ({bank: "Bank", bankset: "Bank", bankrules: "Bank", sales: "Sales", invoices: "Purchase bills", export: "Tally connection", done: "Purchase bills", clientInbox: "Inbox", gstset: "GST", settings: "Other"})[c.tab] || "Other";
    }
    return /tally/.test(c.screen) ? "Tally connection" : /inbox/.test(c.screen) ? "Inbox" : "Other";
  },
  ago(iso){ const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? m + "m" : m < 48 * 60 ? Math.round(m / 60) + "h" : Math.round(m / 1440) + "d"; },
  when(iso){ return fmtDateTime(iso); },
  async open(id){
    const s = this.st(); if (s.open !== id){ s.rtext = ""; s.rfiles = []; } s.open = id; s.detail = null; render();
    try { s.detail = await Cloud.rpc("support_get", {p_ticket: id}); } catch (e){ toast(e.message); s.open = null; }
    render();
  },
  // files go under the firm's folder: for support answering, the ticket's firm
  async upload(files, firm){
    const c = Cloud.cfg(), out = [];
    for (const f of files){
      if (f.size > 10 * 1024 * 1024){ toast(f.name + " is over 10 MB and was left out."); continue; }
      const safe = String(f.name || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80), path = firm + "/" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + "-" + safe;
      const url = c.url.replace(/\/+$/, "") + "/storage/v1/object/support-files/" + path.split("/").map(encodeURIComponent).join("/");
      const put = () => fetch(url, {method: "POST", headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token, "Content-Type": f.type || "application/octet-stream"}, body: f});
      await Cloud.fresh().catch(() => {});
      let r = await put(); if (r.status === 401){ await Cloud.refreshToken(); r = await put(); }
      if (!r.ok) throw new Error("Could not upload " + f.name + " (" + r.status + ").");
      out.push({path, name: f.name, size: f.size, type: f.type || ""});
    }
    return out;
  },
  async download(path, name){
    const c = Cloud.cfg(), url = c.url.replace(/\/+$/, "") + "/storage/v1/object/support-files/" + path.split("/").map(encodeURIComponent).join("/");
    const get = () => fetch(url, {headers: {apikey: c.key, Authorization: "Bearer " + Cloud.sess().access_token}});
    await Cloud.fresh().catch(() => {});
    let r = await get(); if (r.status === 401){ await Cloud.refreshToken(); r = await get(); }
    if (!r.ok) throw new Error("The file could not be fetched (" + r.status + ").");
    const blob = await r.blob(), a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name || "file"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },
  mail(ticket, event){ Cloud.fn("support-mail", {ticket, event}).then(r => { const s = this.st(); s.mailNote = r && r.sent ? "" : (r && r.reason) || ""; }).catch(() => {}); },
  async create(d){
    const s = this.st();
    const files = await this.upload(s.files || [], Cloud.st.firm);
    const t = await Cloud.rpc("support_new", {p_subject: d.subject, p_module: d.module, p_category: d.category, p_priority: d.priority, p_body: d.body, p_context: d.withCtx ? S.helpCtx || this.context() : {}, p_files: files});
    this.mail(t.id, "new");
    return t;
  },
  async reply(body, internal){
    const s = this.st(), t = s.detail;
    const files = await this.upload(s.rfiles || [], t.firm_id);
    await Cloud.rpc("support_reply", {p_ticket: t.id, p_body: body, p_files: files, p_internal: !!internal});
    if (!internal) this.mail(t.id, "reply");
  },
  async set(p){ const t = this.st().detail; await Cloud.rpc("support_set", Object.assign({p_ticket: t.id, p_status: null, p_priority: null, p_assignee: null}, p)); },
});
/* ---------- the screen is app/src/screens/Help.jsx; what its buttons and boxes do ---------- */
// typed or chosen: the guide's search (the best article opens), the ticket searches, the reply, the desk's filters
function supType(k, v, now){
  const s = SUP.st(); s[k] = v;
  if (k === "gq"){ const r = GUIDE.search(v); if (r[0]) s.art = r[0].k; }
  if (k === "rtext" && !now){ FinComReact.redraw(); return; }
  render();
}
function supDraft(k, v, now){ const s = SUP.st(); (s.draft = s.draft || {})[k] = v; if (now) render(); else FinComReact.redraw(); }
function supTab(id){ const s = SUP.st(); s.tab = id; s.open = null; s.newOpen = false; render(); if (id !== "guide" && SUP.on()) SUP.load(true); }
function supArt(k, go){ const s = SUP.st(); s.art = k; if (go){ s.newOpen = false; s.tab = "guide"; } render(); }
function supFilter(f){ SUP.st().filter = f; render(); }
function supDstat(k){ SUP.st().dstat = k; render(); }
function supFiles(which, files){ const s = SUP.st(); s[which] = (s[which] || []).concat(files).slice(0, 8); render(); }
function supFdel(which, i){ SUP.st()[which].splice(i, 1); render(); }
function supDl(path, name){ SUP.download(path, name).catch(err => toast(err.message)); }
async function supSet(k, v){ const s = SUP.st(); try { await SUP.set({[k]: v}); await SUP.open(s.open); SUP.load(true); toast("Saved."); } catch (err){ toast(err.message); render(); } }
async function supAct(a){
  const s = SUP.st();
  if (a === "new"){ s.newOpen = true; s.open = null; s.draft = null; s.files = []; if (!S.helpCtx) S.helpCtx = SUP.context(); render(); return; }
  if (a === "cancel"){ s.newOpen = false; s.draft = null; s.files = []; render(); return; }
  if (a === "back"){ s.open = null; s.detail = null; render(); return; }
  if (a === "reload"){ SUP.load(false); return; }
  if (a === "submit"){
    const dr = s.draft || {};
    if (String(dr.subject || "").trim().length < 3){ toast("Give the ticket a subject."); return; }
    if (String(dr.body || "").trim().length < 5){ toast("Describe what happened."); return; }
    s.busy = true; render();
    try { const tk = await SUP.create(dr); s.newOpen = false; s.draft = null; s.files = []; s.tab = "tickets"; s.busy = false; S.helpCtx = null; toast("Ticket " + SUP.code(tk) + " raised. FinCom support will answer here."); await SUP.load(true); SUP.open(tk.id); }
    catch (err){ s.busy = false; toast("Not raised: " + err.message); render(); }
    return;
  }
  if (a === "send"){
    const body = String(s.rtext || "").trim(), internal = !!s.rint;
    if (!body && !(s.rfiles || []).length){ toast("Write a reply or attach a file."); return; }
    s.busy = true; render();
    try { await SUP.reply(body, internal); s.rfiles = []; s.rtext = ""; s.rint = false; s.busy = false; await SUP.open(s.open); SUP.load(true); toast(internal ? "Note added." : "Sent."); }
    catch (err){ s.busy = false; toast("Not sent: " + err.message); render(); }
    return;
  }
  if (a === "resolve" || a === "reopen"){ try { await SUP.set({p_status: a === "resolve" ? "resolved" : "open"}); await SUP.open(s.open); SUP.load(true); } catch (err){ toast(err.message); } }
}
// ---- from src/js/43-two-step.js
// grouped for typing by hand: JBSW Y3DP EHPK 3PXP
function mfaKeyGroups(k){ return String(k || "").replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 "); }
// Settings → Firm account, the owner: every computer and phone signed in to this account is signed out (Settings
// screen: app/src/screens/Account.jsx)
async function signOutAll(){
  const a = await askConfirm({title: "Sign out of all devices?", ok: "Sign out everywhere", body: '<p class="note">Every computer and phone signed in to your account is signed out, this one too. Work already synced stays in the firm account.</p>'});
  if (!a) return;
  try { await Cloud.authApi("logout?scope=global", "POST"); }
  catch (e){ toast("Could not reach the firm account: " + e.message); return; }
  signOutHere("Signed out of all devices.", false, "");
}
// ---- from src/js/44-lookup.js
Object.assign(FC, {
  PRESETS: [["month", "This month"], ["lastmonth", "Last month"], ["quarter", "This quarter"], ["lastquarter", "Last quarter"], ["ytd", "Year to date"], ["fy", "This year"], ["lastfy", "Last year"]],
  fyLabel(from){ const y = num(String(from).slice(0, 4)); return y + "-" + String(y + 1).slice(2); },
  amt(x){ return Math.abs(r2(x || 0)) < 0.005 ? "" : INR.format(r2(x)); },
  shortMonth(ym){ const m = num(String(ym).slice(4, 6)); return ["", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"][((m + 8) % 12) + 1]; },
});
// Look up (app/src/screens/books/Lookup.jsx): what its buttons and boxes do
function lkType(k, v){ const x = LK.st(); x[k] = k === "from" || k === "to" || k === "asOn" ? FC.d8(v) : v; FinComReact.redraw(); }
function lkSrc(src){ LK.st().src = src; render(); }
function lkKind(k){ const x = LK.st(); x.kind = k; x.res = null; x.heard = ""; if (x.typ && !LK.types().includes(x.typ)) x.typ = ""; if (x.kind === "bills" && x.led && !(Audit.isDebtor(x.led) || Audit.isCreditor(x.led))) x.led = ""; render(); }
function lkPer(k){ const x = LK.st(), p = FC.period(k); x.from = p.from; x.to = p.to; LK.run("auto"); }
function lkRec(i){ const x = LK.st(), r = LK.recent()[i]; if (r){ Object.assign(x, r); x.heard = ""; LK.run("auto"); } }
function lkMonth(ym){ const x = LK.st(), y = num(ym.slice(0, 4)), m = num(ym.slice(4, 6)); Object.assign(x, {kind: x.led ? "ledger" : "group", from: ym + "01", to: FC.monthEnd(y, m)}); LK.run("auto"); }
// the books end before the dates asked: their last year instead ("Show 2025-26")
function lkShowFy(fyStart){ const x = LK.st(); x.from = fyStart; x.to = (num(fyStart.slice(0, 4)) + 1) + "0331"; x.asOn = x.to; LK.run("auto"); }
function lkOpen(id){ const x = LK.st(); x.open[id] = !x.open[id]; render(); }
// ---- from src/js/47-closed-periods.js
// Client setup, closed periods (app/src/screens/SettingsMore.jsx): the closing date, a warning on or off, a TDS return filed
function closedSet(co, k, v){
  if (k === "to"){ ClosedP.set(co, "to", v); toast(v ? "Books closed up to " + fmtDate(v) + " for " + co.name + "." : "No closing date."); }
  else if (k.indexOf("q:") === 0){ const q = k.slice(2), f = Object.assign({}, ClosedP.cfg(co).tdsFiled); if (v) f[q] = v; else delete f[q]; ClosedP.set(co, "tdsFiled", f); }
  else ClosedP.set(co, k, v);
  render();
}
// ---- from src/js/52-routes.js
function detailOpen(k){ return S.detail && S.detail.k === k && S.detail.at === Route.of() ? S.detail.id : null; }
// ---- from src/js/57-ledger-check.js
Object.assign(LedPage, {
  exampleSay(x){ if (!x) return ""; const d = /^\d{8}$/.test(String(x.date || "")) ? fmtDate(tallyDate(x.date)) : fmtDate(String(x.date || "").slice(0, 10));
    return [x.type, x.no].filter(Boolean).join(" ") + " · " + d + " · " + money(x.amt); },
  // the other ledgers (not tax), most used first: one can be marked as tax with Change
  others(b){
    const main = new Set(this.main(b).map(r => r.n));
    return Object.entries(b.map || {}).filter(([n]) => !main.has(n)).sort((x, y) => (y[1].n || 0) - (x[1].n || 0) || x[0].localeCompare(y[0])).map(([n]) => this.line(b, n));
  },
  // "Please check": a confirmed ledger the check reads otherwise; a confirmed name-guess no entry uses yet, which would
  // count as tax once used (confirmed before 2.4.1 in a batch, not on its own row, and Tally's master does not say GST or
  // TDS). "Keep mine" puts one away (m.kept) until the check reads it otherwise again
  review(b){
    const out = [], info = b.ledInfo || {};
    Object.entries(b.map || {}).sort((x, y) => x[0].localeCompare(y[0])).forEach(([n, m]) => {
      if (!m.ok) return;
      const s = this.checkOf(b, n), mine = this.says(this.ans(m)), k = m.kept || {};
      if (s && m.what && !this.same(s, m)){ const cs = this.says(s); if (k.check !== cs) out.push({n, kind: "differs", m, mine, check: s, checkSays: cs, ex: this.example(b, n)}); return; }
      if (this.taxW(m.what) && !((m.n || 0) > 0) && !/^(row|change|check|agree)$/.test(m.okHow || "") && !/^(GST|TDS|TCS)$/i.test(String((info[n] || {}).taxType || "")) && !m.kept)
        out.push({n, kind: "unused", m, mine, check: s, checkSays: s ? this.says(s) : "", ex: null});
    });
    return out;
  },
  // each its own step, saved at once (never a draft), with Undo
  step(b, text, names, fn){
    const was = this.before(b, names);
    Drafts.direct(() => { b.map = b.map || {}; fn(was); this.dirty(b); saveBooks(); }, {bypass: true});
    S.ledUndo = {cid: b.cid, text, list: was};
    render();
  },
  keepMine(b, n){
    const m = (b.map || {})[n]; if (!m) return;
    const s = this.checkOf(b, n), cs = s && !this.same(s, m) ? this.says(s) : "unused";
    this.step(b, "Kept as you confirmed: " + n + ".", [n], (was) => { m.kept = {by: whoAmI(), at: new Date().toISOString(), check: cs}; m.prev = was[0][1]; });
  },
  useCheck(b, n){
    const s = this.checkOf(b, n); if (!s) return;
    this.step(b, "Changed to the check’s answer: " + n + ".", [n], (was) => {
      const m = b.map[n] = b.map[n] || {n: 0};
      LedMaster.applyWhat(m, s.what);
      if (LedMaster.isGst(s.what)){ m.tax = s.tax || m.tax; m.side = s.side || m.side; if (s.rate) m.gstRate = s.rate; }
      if (LedMaster.isTds(s.what)){ m.section = s.section || ""; if (s.rate) m.rate = s.rate; }
      m.why = (s.ev || []).map(e => LedCheck.SRC[e.src] + ": " + e.say).join("; ");
      LedMaster.confirm(b, [n], true); m.okHow = "check"; delete m.kept; m.prev = was[0][1];
      const it = ((b.ledCheck || {}).items || {})[n]; if (it){ it.okSig = LedCheck.sig(LedCheck.usage(b, [n])[n]); it.okAt = m.okAt; it.okBy = m.okBy; }
    });
  },
  // put ledgers back as they were (Undo); a ledger that was not in the map is taken out of it again
  restore(b, list){
    Drafts.direct(() => {
      const items = (b.ledCheck || {}).items || {};
      list.forEach(([n, prev]) => {
        const used = ((b.map || {})[n] || {}).n || 0;
        if (prev) b.map[n] = Object.assign(JSON.parse(JSON.stringify(prev)), {n: used}); else delete b.map[n];
        if (items[n]) items[n].state = prev && prev.ok ? "confirmed" : "pending";
      });
      this.dirty(b); saveBooks();
    }, {bypass: true});
  },
  // a confirmed row's own Undo: what it was before it was confirmed or changed (kept on the ledger); one confirmed before
  // 2.4.1 is only not confirmed any more
  undoRow(b, n){
    const m = (b.map || {})[n]; if (!m) return;
    const prev = m.prev !== undefined ? m.prev : Object.assign(this.bare(m), {ok: false, okAt: undefined, okBy: undefined, okHow: undefined, prev: undefined});
    this.restore(b, [[n, prev]]);
    if (S.ledUndo && (S.ledUndo.list || []).some(x => x[0] === n)) S.ledUndo = null;
    render();
  },
  undoLast(b){ const u = S.ledUndo; if (!u || u.cid !== b.cid) return; S.ledUndo = null; this.restore(b, u.list || []); toast("Undone."); render(); },
  // two ledgers with one GSTIN; a PAN that is not the one inside the ledger's GSTIN. From the masters read and the
  // bridge's ledger list; "Fine as it is" (b.ledOk) puts one away
  conflicts(b, cid){
    const all = {}, ok = b.ledOk || {}, out = [];
    const add = (n, g, p) => { if (!n) return; const x = all[n] = all[n] || {n, gstin: "", pan: ""}; g = String(g || "").toUpperCase().trim(); p = String(p || "").toUpperCase().trim(); if (g && !x.gstin) x.gstin = g; if (p && !x.pan) x.pan = p; };
    Object.entries(b.ledInfo || {}).forEach(([n, i]) => add(n, i && i.gstin, i && i.pan));
    Object.entries(b.gstins || {}).forEach(([n, g]) => add(n, g, ""));
    Object.entries(b.pans || {}).forEach(([n, p]) => add(n, "", p));
    if (typeof Ledgers === "object" && cid) Ledgers.list(cid).forEach(l => { if (l) add(l.name, l.gstin, l.pan); });
    const own = new Set([].concat((typeof GSTR === "object" && GSTR.gstins ? GSTR.gstins(b) : []) || [], [((CO(cid) || {}).gstin || "")]).map(g => String(g || "").toUpperCase()));
    const by = {};
    Object.values(all).forEach(x => { if (GSTIN_RE.test(x.gstin) && !own.has(x.gstin)) (by[x.gstin] = by[x.gstin] || []).push(x.n); });
    Object.keys(by).sort().forEach(g => { const ns = by[g].sort((x, y) => x.localeCompare(y)); if (ns.length < 2 || ok["gstin:" + g]) return;
      out.push({key: "gstin:" + g, kind: "gstin", names: ns, text: "GSTIN " + g + " is on " + ns.length + " ledgers: " + ns.join(", ") + ". If they are one party, merge them in Tally; if not, correct the GSTIN in Tally."}); });
    Object.values(all).sort((x, y) => x.n.localeCompare(y.n)).forEach(x => {
      if (!GSTIN_RE.test(x.gstin) || !PAN_RE.test(x.pan) || x.gstin.slice(2, 12) === x.pan || ok["pan:" + x.n]) return;
      out.push({key: "pan:" + x.n, kind: "pan", names: [x.n], text: x.n + ": PAN " + x.pan + " is not the PAN inside its GSTIN " + x.gstin + " (" + x.gstin.slice(2, 12) + "). Correct it in Tally; the TDS returns use the PAN."}); });
    return out;
  },
  fine(b, key){ Drafts.direct(() => { (b.ledOk = b.ledOk || {})[key] = {by: whoAmI(), at: new Date().toISOString()}; saveBooks(); }, {bypass: true}); render(); },
  // "2 min ago", "3 h ago", "on 07-Oct-2026 10:05"
  ago(at){
    const t = Date.parse(String(at || "")); if (!t) return "";
    const min = Math.max(0, Math.round((Date.now() - t) / 60000));
    return min < 1 ? "just now" : min < 60 ? min + " min ago" : min < 24 * 60 ? Math.floor(min / 60) + " h ago" : "on " + fmtDateTime(t);
  },
});
// ---- from src/js/59-post-preview.js
// a bill's ledgers on one line, the party first; a Round Off of nothing is left out
function postLedgerLine(e){
  const ls = (e.snapshot ? e.snapshot.lines : []).filter(l => l.ledger && !((l.role === "roundoff" || /^round\s*(ed\s*)?off\b/i.test(l.ledger)) && Math.abs(num(l.amt)) < 0.005));
  const order = {party: 0, expense: 1, gst: 2, "rcm-in": 2, "rcm-out": 2, tds: 3, roundoff: 4};
  return [...new Set(ls.slice().sort((a, b) => (order[a.role] ?? 1) - (order[b.role] ?? 1)).map(l => l.ledger))].join(" · ");
}
function goSetupFor(msg){ Smart.setReturn(); S.postStop = null; S.step = null; S.tab = /TDS/.test(msg) || /expense/.test(msg) ? "cotds" : "cotally"; render(); window.scrollTo(0, 0); }
// a failed posting of the cloud: one of the entries still to send is held live
function postJobHeld(j){
  if (typeof CloudJobs !== "object") return false;
  const ids = (CloudJobs.idsOf(j) || []).filter(id => !CloudJobs.inTally(j, id));
  return ids.some(id => postIdReleased(id, j.client_id) === false);
}
// what the row of a posting says beside Retry: the refusal of the last press, or the standing one (a deleted bill)
function postRetryWhy(j){ return (j && typeof CloudJobs === "object" && CloudJobs.refused && CloudJobs.refused[j.id]) || postRetryRefusal(j) || ""; }
// B4: the timing the bridge wrote on the job (tally_post_jobs.timing = {reqs: [{n, seconds, …}], secondsTotal}): "K requests, T s"
function postTimingWords(j){
  const t = j && j.timing;
  if (!t || typeof t !== "object") return "";
  const k = Array.isArray(t.reqs) ? t.reqs.length : num(t.reqs), s = t.secondsTotal != null ? num(t.secondsTotal) : (Array.isArray(t.reqs) ? t.reqs.reduce((a, q) => a + num(q.seconds), 0) : 0);
  if (!k && !s) return "";
  return k + (k === 1 ? " request, " : " requests, ") + (Math.round(s * 10) / 10) + " s";
}
// the owner's decision B (05-Oct-2026, migration 55): any member of the firm who may post (owner or staff: the cloud's
// can_write) settles a posting whose result is uncertain: "Mark posted" (a Tally id) and "Not in Tally - post again"
// (the FinCom Bridge looks in Tally first; nothing is sent until it finds the entry is not there). A reason is required;
// the name and time are kept. A superadmin who is not a member, or a viewer, does not
function postCanSettle(){ const r = S.account && (S.account.me || {}).role; return r === "owner" || r === "staff"; }
// a bill of the last run that Tally did not take: opened to be put right (the Errors tab's "Fix in bill →")
function postFixBill(id){
  const e = D().entries[id]; if (!e) return;
  S.step = null; S.tab = "invoices"; S.reviewTable = false; S.drawerOpen = false; S.filter = e.status; S.selected = id;
  render(); window.scrollTo(0, 0);
}
function postPreviewOne(kind, id){
  const co = CO(), row = postRows(co).find(r => r.kind === kind && r.id === id);
  if (row) postPreview(co, [row], {view: true});
}
// Back to review from the Post to Tally page, for any kind
function postBackToReview(kind, id){
  if (kind === "bill"){ billBack(id); return; }
  if (kind === "bank" && S.bank){ const r = S.bank.rows.find(x => x.id === id); if (r){ r.state = "attention"; r.userSet = false; saveBank({rows: true}); toast("Back in To review in Bank."); render(); } return; }
  if (kind === "sale" && S.sales){ const v = S.sales.list.find(x => x.id === id); if (v){ v.status = "review"; saveSales(); toast("Back in To review in Sales."); render(); } }
}
// ---- from src/js/62-post-reasons.js
// what "Show Tally's reply" opens: Tally's words and counts as they came
function postReplyRaw(r, it){
  if (!r && !it) return "";
  const parts = [];
  if (r){
    const c = ["created", "altered", "ignored", "exceptions", "errors"].filter(k => r[k] != null && r[k] !== "").map(k => k.toUpperCase() + " " + num(r[k]));
    if (c.length) parts.push(c.join(", "));
    if (r.lastVchId != null && r.lastVchId !== "") parts.push("LASTVCHID " + r.lastVchId);
    if (postLineWords(r)) parts.push(postLineWords(r));
    if (r.message) parts.push(postReasonText(r.message));
  }
  if (it && it.reason && !parts.includes(postReasonText(it.reason))) parts.push(postReasonText(it.reason));
  return parts.join("\n");
}
function postIsoOf(d){ const s = String(d || ""); return /^\d{8}$/.test(s) ? s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6, 8) : /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ""; }
Object.assign(PostFlags, {
  // review M2: an owner restores any removal; another member only their own
  mayRestore(k){ const f = this.removed.get(k), me = (S.account && S.account.me) || {}; return !!f && (me.role === "owner" || (!!me.user_id && f.by === me.user_id)); },
  removeRows(keys, why){ return this.batches("tally_post_row_remove", keys, {p_why: why || ""}, keys.length + (keys.length === 1 ? " row moved" : " rows moved") + " to Removed. The entries in Tally are not affected."); },
});
// G. search: bill no., party, amount, Tally id (and FinCom's id)
function postRowHit(x, q){
  const n = String(q || "").trim().toLowerCase();
  if (!n) return true;
  const tid = x.st && x.st.id ? [x.st.id.vch, x.st.id.batchEnd].concat(x.st.id.ids || []) : [];
  const amt = x.d.amount ? [String(x.d.amount), typeof INR === "object" ? INR.format(x.d.amount) : ""] : [];
  const n2 = n.replace(/[₹,\s]/g, "");
  return [x.id, x.d.no, x.d.party].concat(tid, amt).some(v => v != null && v !== "" && String(v).toLowerCase().includes(n))
    || (!!n2 && /^\d+(\.\d+)?$/.test(n2) && amt.some(v => String(v).replace(/,/g, "").includes(n2)));
}
// ---- from src/js/60-choices.js
// a person takes a confirmation back (the owner, 14-Oct-2026: "if we want to unconfirm that, we can do that"): the value
// stays as a guess to confirm again, with who unconfirmed it and when; posting waits for a new Confirm (choiceUsable)
function choiceUnconfirm(co, key, opts){
  if (!co) return null;
  const was = choiceGet(co, key);
  if (!was || was.state !== "confirmed") return null;
  const now = new Date().toISOString(), who = (opts && opts.by) || choiceWho();
  const rec = {value: was.value || "", state: "guessed", by: who, at: now, why: "unconfirmed by " + who, unok: {by: who, at: now}, prev: {value: was.value || "", state: was.state, by: was.by || "", at: was.at || ""}};
  Drafts.direct(() => { choiceWrite(co, key, rec); if (!(opts && opts.nosave)) Store.saveCompany(co); }, {bypass: true});
  return rec;
}
// a person picked and confirmed the ledger of a bank account (the bank page, Bank accounts in Client setup)
function bankConfirmAccLedger(accId, v){
  const b = B(), co = CO(b ? b.cid : S.coId), a = choiceAcc(co, accId);
  if (!a) return false;
  const ex = exactLedger(v) || (hasLedgerList() ? "" : String(v || "").trim());
  if (!ex){ toast("“" + v + "” is not a Tally ledger. Choose one from the list."); return false; }
  choiceConfirm(co, "bank:" + accId, ex);
  if (b && b.cid === co.id){ suggestAll(b.rows, true); saveBank({rows: true}); }
  toast("Tally ledger confirmed: " + ex + ".");
  render();
  return true;
}
// ---- from src/js/61-recorder.js
Object.assign(Rec, {
  owner(){ return this.role() === "owner"; },
  // Save (tick null), Tick (true), Untick (false): tally_tieout_save(p_client, p_month, p_figures, p_fincom, p_tick)
  async tieSave(cid, month, vals, tick){
    const t = this.tieOf(cid), figs = {};
    for (const [k, label] of this.FIGS){
      const n = this.parse(vals[k]);
      if (Number.isNaN(n)){ t.msg[month] = {err: label + " must be a number."}; render(); return false; }
      figs[k] = n == null ? null : r2(n);
    }
    figs.note = String(vals.note || "").trim().slice(0, 300);
    const f = this.fincom(cid, month), fc = {};
    this.FIGS.forEach(([k]) => { fc[k] = f[k] == null ? null : f[k]; });
    t.msg[month] = {busy: true}; render();
    try {
      const r = await TCloud.rpc("tally_tieout_save", {p_client: cid, p_month: month, p_figures: figs, p_fincom: fc, p_tick: tick === undefined ? null : tick});
      if (r && r.ok === false) throw new Error(r.error || "It was not saved.");
      if (r && r.month) t.rows[String(r.month).slice(0, 10)] = r;
      t.msg[month] = {ok: tick === true ? "Saved and ticked." : tick === false ? "Saved; the tick is taken off." : "Saved."};
    } catch (e){
      t.msg[month] = {err: this.missing(e) ? "Tie-out: " + REC_NOT44 + "." : this.say(e)};
    }
    render();
    return true;
  },
  async lock(cid, month){
    const a = await askConfirm({title: "Lock " + GSTR.label(month.slice(0, 4) + month.slice(5, 7)) + "?", ok: "Lock the month",
      body: "<p>Changes made in Tally to entries of this month are held, not applied to FinCom’s copy, until you approve each one (Tally page → Sync activity → Apply now) or unlock the month.</p>" +
        '<div class="bk-form one"><label><span>Note (kept with the lock)</span><input id="lockNote" maxlength="300" placeholder="Why the month is locked"></label></div>',
      read: () => ({note: ((document.getElementById("lockNote") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    await this.lockCall(cid, month, "tally_month_lock", {p_client: cid, p_month: month, p_note: (a.data && a.data.note) || ""});
  },
  async unlock(cid, month){
    const a = await askConfirm({title: "Unlock " + GSTR.label(month.slice(0, 4) + month.slice(5, 7)) + "?", ok: "Unlock",
      body: "<p>Changes made in Tally to this month are applied to FinCom’s copy again as they come. Lines already held stay held until you apply them.</p>" +
        '<div class="bk-form one"><label><span>Note (optional)</span><input id="unlockNote" maxlength="300"></label></div>',
      read: () => ({note: ((document.getElementById("unlockNote") || {}).value || "").trim()})});
    if (!a || !a.ok) return;
    await this.lockCall(cid, month, "tally_month_unlock", {p_client: cid, p_month: month, p_note: (a.data && a.data.note) || ""});
  },
  // ---------------------------------------------------------------- H49-H51: Sync activity
  // 05-Oct-2026 (the owner's words): what was done in Tally, and what it means for the books. Never "synced": a line not
  // entered in the books says so, with the cloud's reason
  ACTS: {created: "Created", altered: "Altered", deleted: "Deleted", cancelled: "Cancelled", imported: "Imported", ledger_created: "Ledger created",
    ledger_altered: "Ledger altered", ledger_renamed: "Ledger renamed", ledger_deleted: "Ledger deleted"},
  // FinCom's own entry coming back from Tally: a line with a FinCom id (fid) or a short line (migration 45; read as fid / short
  // with the lines, or in the whole row a live line brings), or the cloud's words for it. Only its creation is FinCom's: a
  // later change to it in Tally is a person's (Altered)
  fromFincom(r){
    if (!r || !["created", "imported"].includes(String(r.event || ""))) return false;
    const p = (r.payload && typeof r.payload === "object") ? r.payload : {};
    const fid = r.fid || p.fid, short = r.short != null ? r.short : p.short;
    return !!fid || short === true || short === "true" || /^FinCom (posting|id) /.test(String(r.held_why || ""));
  },
  actWords(r){ return this.fromFincom(r) ? "Posted from FinCom" : (this.ACTS[r.event] || String(r.event || "")); },
  actOf(){
    const a = this.act, cid = S.syncClient || "";
    if (!a.rows && !("at" in a)) Object.assign(a, {rows: null, at: 0, busy: false, no44: false, err: "", cid: ""});
    if (typeof TCloud === "object" && TCloud.on() && !a.busy && (a.cid !== cid || !a.at || (Date.now() - a.at > (Live.recorderLive ? SLOW_MS : 60000) && pollOk()))){ a.at = Date.now(); a.cid = cid; setTimeout(() => this.actLoad(), 0); }
    return a;
  },
  filtered(f){
    const rows = this.sorted(), today = new Date().toDateString();
    if (f === "waiting") return rows.filter(r => r.state === "held" || r.state === "received" || r.state === "fetching");
    if (f === "held") return rows.filter(r => r.state === "held");
    if (f === "mismatch") return rows.filter(r => r.check && r.check.ok === false);        // the ledger check (F37-40): none yet
    if (f === "today") return rows.filter(r => r.received_at && new Date(r.received_at).toDateString() === today);
    return rows;
  },
  entry(r){
    if (/^ledger_/.test(String(r.event || ""))){ const l = [].concat(r.ledgers || [])[0]; return (l && (l.name || l.to || l.from)) || "a ledger"; }
    const head = [r.vch_type, r.vch_no].filter(Boolean).join(" ");
    return (head || "an entry") + (r.vch_date ? " · " + fmtDate(String(r.vch_date).slice(0, 10)) : "");
  },
  // bridge 2.3.1 (the owner's rule after review, 06-Oct-2026): an entry is held only when its lines do not total zero; any
  // other mismatch is entered with plain words for a person (tally-ingest's payload checkNotes, read as checks; a live row
  // carries its payload): "; to check: ..." after "Entered in the books"
  notesWords(r){
    const n = [].concat((r && (r.checks || (r.payload && r.payload.checkNotes))) || []).map(x => String(x || "").trim()).filter(Boolean);
    return n.length ? "; to check: " + n.join("; ") : "";
  },
  // a line's state in the owner's words (05-Oct-2026): "Entered in the books" for an applied line alone
  stateWords(r){
    const why = r.held_why ? ": " + r.held_why : "";
    switch (r.state){
      case "applied": return "Entered in the books" + this.notesWords(r);
      case "held": return "Received, not yet entered in the books" + why;
      case "received": return "Received, not yet entered in the books";
      // migration 196 (the owner, 13-Nov-2026: no entry is ever held): FinCom is bringing the entry from Tally by itself
      case "fetching": return "Being brought from Tally" + why;
      case "replaced": return "Replaced by a later line";
      case "duplicate": return "Already in the books";
      case "stale": return "An older change, not applied";
      case "failed": return "Not entered" + why;
      case "queued": return "Received, waiting in FinCom's queue";
      default: return "Not entered: " + String(r.state || "unknown state");
    }
  },
  // the Day Book upload for one day: Books -> From Tally with that day (Rec.uploadDays does it from a day to today)
  async uploadDay(cid, day){
    if (!cid || !day) return;
    S.dbFrom = day; S.dbTo = day;
    if (S.view !== "company" || S.coId !== cid) await openCompany(cid);
    S.dbFrom = day; S.dbTo = day;
    goClient("books:import");
  },
  resumeOn(g){ if (typeof TCloud === "object" && g && g.deviceId) TCloud.readResume({device: {id: g.deviceId}, computer: g.pc}); },
  // Apply now on every line of a group, one after another (the list's own Apply now, line by line)
  async releaseAll(lines){ for (const r of [].concat(lines || [])) if (r.state === "held") await this.release(r); },
  async release(r){
    const a = this.act;
    a.msg = {busy: true, id: r.id}; render();
    try {
      const j = await TCloud.rpc("tally_recorder_release_held", {p_line: num(r.id)});
      if (j && j.ok === false) a.msg = {err: "Line " + (j.line_id || r.id) + " is still held" + (j.why ? ": " + j.why : ".")};
      else a.msg = {ok: "Line " + ((j && j.line_id) || r.line_id || r.id) + ": " + this.stateWords({state: (j && j.state) || "applied"}) + (j && j.why ? " (" + j.why + ")" : "") + "."};
    } catch (e){ a.msg = {err: this.missing(e) ? "Apply now: " + REC_NOT44 + "." : this.say(e)}; }
    await this.actLoad();
  },
  // "Sales GBTS2627-09 · 12-Oct-2026"
  unkEntry(r){ return ([r.vtype, r.vno].map(x => String(x || "").trim()).filter(Boolean).join(" ") || "An entry") + (r.day ? " · " + fmtDate(String(r.day).slice(0, 10)) : ""); },
  // "9 ledgers used in Tally are not in FinCom yet (INPUT IGST, INPUT CGST, … · 327 entries)"
  unkHead(g){
    const n = g.ledgers.length, names = g.ledgers.slice(0, 2).map(x => x.n).join(", ") + (n > 2 ? ", …" : "");
    return (n === 1 ? "1 ledger used in Tally is" : n + " ledgers used in Tally are") + " not in FinCom yet (" + names + " \u00b7 " + this.unkN(g.entries) + ")";
  },
  unkN(k){ return k + (k === 1 ? " entry" : " entries"); },
  // can Tally's ledger list be read for this client now, and what to say beside the way to From Tally: {ok, kind, pc, text}
  unkCan(cid){
    const co = S.companies && S.companies[cid], name = (co && (co.tallyName || co.name)) || "this client's company";
    const l = co && typeof tallyLine === "function" ? tallyLine(co) : null, pc = (l && l.computer) || "the Tally computer";
    if (!l) return {ok: false, kind: "none", pc, text: "No Tally computer keeps this client's books yet: link one in Client setup → Tally."};
    if (l.state === "offline") return {ok: false, kind: "offline", pc, text: "Tally can't be read now: " + pc + " is offline. Once FinCom Bridge runs there again, use Books › From Tally."};
    if (l.state === "stopped") return {ok: false, kind: "stopped", pc, text: "Tally can't be read now: reading is stopped from FinCom on " + pc + (l.stop && l.stop.reason ? " (" + l.stop.reason + ")" : "") + ". An owner resumes it on the Tally page; then the ledgers come in and this line goes by itself."};
    if (l.state === "closed") return {ok: false, kind: "closed", pc, text: "Tally can't be read now: it is not open on " + pc + ". Open " + name + " in Tally there, then use Books › From Tally."};
    if (l.state === "paused") return {ok: true, kind: "paused", pc, text: "Background reading is paused on " + pc + ", so new ledgers do not come in by themselves. Update from Tally reads them once. To keep them coming: right-click the FinCom icon near the clock → Resume background reading."};
    if (l.state === "notanswering") return {ok: true, kind: "notanswering", pc, text: l.text + "; Update from Tally goes once Tally answers."};
    return {ok: true, kind: "open", pc, text: "Update from Tally on Books › From Tally reads Tally's ledger list on " + pc + "."};
  },
  clientAlerts(cid){ return this.alertsOf().filter(x => !x.read_at && cid && String(x.client_id || "") === String(cid)); },
});
// ---- from src/js/65-tds-challans.js
Object.assign(TDSCH, {
  /* ---------- Tally bill-wise ---------- */
  // the deductions a payment voucher pays bill-wise: its TDS-ledger lines' Agst Ref names, met with the New Ref the
  // deduction put on the same ledger
  billIndex(){
    const b = S.books || {}, idx = {};
    (b.vouchers || []).forEach(v => (v.ent || []).forEach(e => {
      if (!(e.a > 0) || !e.b || Books.ledgerOf(e.l).kind !== "tds_payable") return;
      e.b.forEach(([name, type]) => { if (/new/i.test(type || "") && name) (idx[e.l + "\u0001" + String(name).trim().toUpperCase()] = idx[e.l + "\u0001" + String(name).trim().toUpperCase()] || []).push(v.id + "|" + e.l); });
    }));
    return idx;
  },
  billLinks(v, idx){
    const out = [];
    if (!v) return out;
    (v.ent || []).forEach(e => {
      if (!(e.a < 0) || !e.b || Books.ledgerOf(e.l).kind !== "tds_payable") return;
      e.b.forEach(([name, type]) => { if (/agst/i.test(type || "") && name) (idx[e.l + "\u0001" + String(name).trim().toUpperCase()] || []).forEach(id => { if (!out.includes(id)) out.push(id); }); });
    });
    return out;
  },
  // how many deductions a Tally payment voucher pays bill-wise (shown beside it before it is a challan)
  billCount(vid){ const v = ((S.books || {}).vouchers || []).find(x => x.id === vid); return this.billLinks(v, this.billIndex()).length; },
  // the Payment History table (CSV or Excel), as rows of cells
  fromTable(aoa){
    const H = [["cin", /^cin\b|challan identification/i], ["bsr", /bsr/i], ["serial", /challan\s*(serial|no|number)|^serial/i], ["date", /date\s*of\s*deposit|deposit\s*date|tender\s*date|payment\s*date|paid\s*on|^date/i],
      ["minor", /minor\s*head|type\s*of\s*payment/i], ["section", /nature\s*of\s*payment|section|^nature/i], ["surcharge", /surcharge/i], ["cess", /cess/i],
      ["interest", /interest/i], ["penalty", /penalty/i], ["fee", /fee|234e/i], ["others", /^others?$/i], ["total", /total/i], ["tax", /^(basic\s*)?(income\s*)?tax(\s*amount)?(\s*\(.*\))?$/i]];
    const at = aoa.findIndex(r => (r || []).some(x => /bsr|^cin\b/i.test(String(x || "").trim())));
    if (at < 0) return [];
    const head = aoa[at].map(x => String(x || "").trim()), col = {};
    head.forEach((h, i) => { const hit = H.find(([k, re]) => !(k in col) && re.test(h)); if (hit) col[hit[0]] = i; });
    return aoa.slice(at + 1).map(r => {
      const x = {};
      Object.keys(col).forEach(k => { x[k] = (r || [])[col[k]]; });
      return this.make(x);
    }).filter(Boolean);
  },
  // a challan receipt PDF's text (the e-filing portal's e-Pay Tax receipt, or a bank's counterfoil)
  fromText(text){
    const t = String(text || "").replace(/₹/g, "Rs. ");
    const get = (re) => { const m = t.match(re); return m ? m[1].trim() : ""; };
    const amt = (label) => get(new RegExp("(?:^|\\n)\\s*(?:[A-F]\\s+)?" + label + "[^\\n\\d]*?([\\d,]+\\.\\d{2}|[\\d,]+)", "i"));
    const x = {
      cin: get(/\bCIN\s*(?:No\.?)?\s*[:\-]?\s*([0-9 ]{20,24})/i), bsr: get(/BSR\s*code\s*[:\-]?\s*(\d{7})/i),
      serial: get(/Challan\s*(?:Serial\s*)?(?:No\.?|Number)\s*[:\-]?\s*(\d{1,6})\b/i),
      date: get(/(?:Date\s*of\s*Deposit|Tender\s*Date|Deposit\s*Date)\s*[:\-]?\s*([0-9]{1,2}[-\/. ][A-Za-z0-9]{2,9}[-\/. ,]+\d{4})/i),
      minor: get(/Minor\s*Head\s*[:\-]?\s*([^\n]*)/i), section: get(/(?:Nature\s*of\s*Payment|Section)\s*[:\-]?\s*([^\n]*)/i),
      tax: amt("Tax(?!\\s*Breakup)(?!\\s*Applicable)"), surcharge: amt("Surcharge"), cess: amt("(?:Education\\s*)?Cess"), interest: amt("Interest"),
      penalty: amt("Penalty"), fee: amt("Fee(?:\\s*under\\s*section\\s*234E)?"), total: amt("Total(?:\\s*\\([^)]*\\))?")
    };
    if (x.cin) x.cin = x.cin.replace(/\s/g, "").slice(0, 20);
    const c = this.make(x);
    return c ? [c] : [];
  },
  async readFile(f){
    const name = String(f.name || "").toLowerCase();
    if (/\.pdf$/.test(name) || f.type === "application/pdf"){
      const pdf = await getPdf(f); let text = "";
      for (let i = 1; i <= Math.min(pdf.numPages, 6); i++){ try { text += pageTextLines(await (await pdf.getPage(i)).getTextContent()) + "\n"; } catch (e){} }
      // a PDF of many receipts: each page on its own
      const pages = text.split(/(?=Challan\s*Receipt|ITNS\s*No)/i).filter(s => /BSR|CIN/i.test(s));
      return [].concat(...(pages.length ? pages : [text]).map(s => this.fromText(s)));
    }
    if (/\.csv$|\.txt$/.test(name) && !/\.xlsx?$/.test(name)){
      const text = await f.text();
      return this.fromTable(this.csv(text));
    }
    await ensureXlsx();
    const wb = xlsxBook(await f.arrayBuffer());
    return [].concat(...wb.SheetNames.map(s => this.fromTable(xlsxRows(wb.Sheets[s]))));
  },
  async upload(files){
    const list = Array.from(files || []);
    if (!list.length || !S.books) return null;
    let read = [], bad = [];
    for (const f of list){
      try { const got = await this.readFile(f); if (got.length) read = read.concat(got); else bad.push(f.name); } catch (e){ bad.push(f.name); }
    }
    const r = this.add(read);
    const props = typeof TDSMatch === "object" && S.tdsFy && S.tdsQ ? TDSMatch.suggestNow(S.tdsView === "return" ? S.tdsForm || "26Q" : "26Q", S.tdsFy, S.tdsQ) : [], exact = props.filter(p => /exact/.test(p.words)).length;
    toast((r.added ? r.added + " challan" + (r.added === 1 ? "" : "s") + " added" : "No new challan") + (r.updated ? ", " + r.updated + " filled in" : "") +
      (r.linked ? ", " + r.linked + " matched to Tally payments" : "") + (r.placed ? ", " + r.placed + " with matches suggested on " + (r.placed === 1 ? "its return" : "their returns") : "") + "." + (props.length ? " " + props.length + " suggestion" + (props.length === 1 ? "" : "s") + " to confirm on Challans" + (exact ? " (" + exact + " exact)" : "") + "." : "") +
      (bad.length ? " Nothing read from " + bad.slice(0, 3).join(", ") + (bad.length > 3 ? " and " + (bad.length - 3) + " more" : "") + "." : ""));
    render();
    return Object.assign({read: read.length, bad}, r);
  },
});
// ---- from src/js/66-tds-smart.js
Object.assign(TDSFiled, {
  async mark(fy, q, form, on, token){
    const why = this.problem(fy, q, on, token);
    if (why){ toast(why); return false; }
    const d = TDS.ymd(on), iso = d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8), t = String(token || "").replace(/\s/g, "");
    const name = TDS.formShort(form, fy) + ", " + q + " " + fy, fee = TDS.lateFee(fy, q, d, form), corr = typeof TDSReg === "object" && TDSReg.corrOpen(fy, q, form);
    const ok = await askConfirm({title: "Mark " + name + " filed?",
      body: "Filed on <b>" + esc(fmtDate(iso)) + "</b>" + (t ? ", token " + esc(t) : ", no token number given") + ".<br>" +
        "The year's grid shows it filed, and the late fee is worked out to this date" + (fee && fee.days > 0 ? " (<b>₹" + INR.format(fee.fee) + "</b>, " + fee.days + " days late)" : " (none: filed by the due date)") + "." +
        (this.closedOf(fy, q) ? "" : "<br>Settings › Closed periods gets this date for " + q + " " + fy + ", so FinCom warns before an entry of the quarter is posted.") +
        (typeof TDSDrift === "object" ? "<br>A copy of the quarter's entries is kept, so a change made in Tally later is spotted." : "") +
        (corr ? "<br><b>A correction is open for this return.</b> Marking it filed closes the correction (the trail records it), and its challan allocations are locked again." : ""),
      ok: corr ? "Mark filed and close the correction" : "Mark filed"});
    if (!ok || !ok.ok) return false;
    // the quarter's date is FinCom's to fill: none yet, or the one this return's earlier mark filled (marked again)
    const b = S.books, cp0 = this.closedOf(fy, q), prev = (b.tdsFiled || {})[this.key(fy, q, form)], fill = !cp0 || !!(prev && prev.closedFilled && TDS.ymd(prev.on) === TDS.ymd(cp0)); b.tdsFiled = Object.assign({}, b.tdsFiled);
    b.tdsFiled[this.key(fy, q, form)] = Object.assign({on: iso, token: t, at: new Date().toISOString(), by: typeof whoAmI === "function" ? whoAmI() : ""}, fill ? {closedFilled: true} : {});
    if (typeof TDSDrift === "object") TDSDrift.keep(fy, q, form);
    // tds-layout (14-Oct-2026): its challan allocations are locked from now (TDSReg, src/js/79); a correction open for it was
    // asked about above and is closed by filing it (closeCorrection: the trail says so, and each allocation is locked)
    if (typeof TDSReg === "object"){ if (corr) TDSReg.closeCorrection(fy, q, form); else TDSReg.lockReturn(fy, q, form); }
    try { auditEvent("tds_return_filed", Object.assign({form, fy, q, on: iso, token: t}, corr ? {correctionClosed: true} : {}), S.coId); } catch (e){}
    saveBooks(); if (fill) this.quarterDate(fy, q, true); toast(name + " marked filed on " + fmtDate(iso) + "."); render();
    return true;
  },
});
// ---- from src/js/73-payroll.js
/* ---------- the page's actions (app/src/screens/tds/Payroll.jsx) ---------- */
function payDetailSet(guid, k, v){
  const e = Payroll.employees().find(x => x.guid === guid);
  if (!Payroll.setDetail(e, k, v)) return;
  saveBooks(); render();
}
// F: pay heads read before Bridge 2.4.4 (no type): the ledgers read from Tally again, the existing ledgers-only wake
async function payAskLedgers(){
  try { const r = await Ledgers.askTally(S.coId); toast(r && r.via ? "Tally was asked for the ledgers; the pay heads' types come with them." : "FinCom Bridge or FinCom's cloud is not reaching the Tally computer now."); }
  catch (e){ toast("Could not ask Tally: " + (e && e.message || e)); }
}
// ---- from src/js/74-zoho-books.js
Object.assign(ZohoB, {
  owner(){ return !!(S.account && S.account.me && S.account.me.role === "owner"); },
  // is the function set up (the owner's Zoho client id and secret in place)? {configured, redirectUri, scopes}; never the values
  async config(force){
    if (this.st.cfg && !force) return this.st.cfg;
    try { this.st.cfg = await this.call({kind: "config"}); } catch (e){ this.st.cfg = {ok: false, configured: false, error: (e && e.message) || String(e)}; }
    return this.st.cfg;
  },
  // the firm's Integrations card: "Connected: 2 organisations" / "Not set up" / "Needs you"
  summary(){
    const cs = this.conns().filter(c => c.status !== "disconnected"), bad = cs.filter(c => c.status === "needs_sign_in" || c.error);
    if (!cs.length) return {state: this.st.cfg && this.st.cfg.configured === false ? "off" : "none", line: this.st.cfg && this.st.cfg.configured === false ? "Not set up" : "No organisation connected"};
    return {state: bad.length ? "warn" : "ok", line: "Connected: " + cs.length + " organisation" + (cs.length === 1 ? "" : "s") + (bad.length ? " · " + bad.length + " needs you" : "")};
  },
  async connect(){
    if (!this.owner()) { toast("Only the firm's owner can connect Zoho Books."); return; }
    const j = await this.call({kind: "connect_start", back: location.origin + location.pathname});
    if (!j.ok){ toast(j.error || "Zoho Books could not be started."); return; }
    location.href = j.url;
  },
  async link(grant, org, cid){
    const j = await this.call({kind: "link", grant, org, client: cid});
    if (!j.ok){ toast(j.error || "The organisation could not be linked."); return j; }
    await this.load(true);
    if (typeof TCloud === "object"){ TCloud.st[cid] = {}; try { await TCloud.status(cid, true); } catch (e){} }
    toast("Linked. " + ((j.first && j.first.counts && j.first.counts.entries) || 0) + " entries read from Zoho Books so far; the rest follow every few minutes.");
    render();
    return j;
  },
  async disconnect(c){
    if (!this.owner()) { toast("Only the firm's owner can disconnect Zoho Books."); return; }
    if (!(await askConfirm({title: "Disconnect " + (c.orgName || "this organisation") + "?", ok: "Disconnect",
      body: "<p>FinCom stops reading and posting to this Zoho organisation and gives up its access (the sign-in is revoked at Zoho). Nothing is deleted: the entries already read stay in FinCom, and nothing in Zoho is touched.</p>"}))) return;
    const j = await this.call({kind: "disconnect", connection: c.id});
    toast(j.ok ? (j.message || "Disconnected.") : (j.error || "Could not disconnect."));
    await this.load(true); render();
  },
  async syncNow(c){
    toast("Reading " + (c.orgName || "the organisation") + " from Zoho Books…");
    const j = await this.call({kind: "sync_now", connection: c.id});
    toast(j.ok ? "Read from Zoho Books: " + ((j.counts && j.counts.entries) || 0) + " entries new or changed." : (j.error || "The read stopped."));
    await this.load(true); render();
  },
  async hookNew(c){
    const j = await this.call({kind: "hook_new", connection: c.id});
    if (!j.ok){ toast(j.error || "Could not make the address."); return ""; }
    return j.url;
  },
  // a person's words for the time Zoho's access token is good until (never the token)
  tokenWords(c){
    if (!c) return "";
    if (c.status === "needs_sign_in") return "Sign in to Zoho again (Reconnect)";
    if (c.status === "disconnected") return "Disconnected";
    return "Connected" + (c.tokenUntil ? " · token valid until " + fmtDateTime(c.tokenUntil) : "") + " (renewed by itself)";
  },
});
// the integrations a firm can use, one entry each (the Integrations page draws a card per entry; a new one is one line)
//   status(): {state: ok | warn | none | off | soon, line}
const INTEGRATIONS = [
  {id: "tally", name: "Tally (FinCom Bridge)", icon: "tally", page: "tally", status: () => typeof tallyIntegrationLine === "function" ? tallyIntegrationLine() : {state: "none", line: ""}},
  {id: "zoho", name: "Zoho Books", icon: "zoho", page: "zoho", status: () => ZohoB.summary()},
  {id: "busy", name: "Busy", icon: "busy", page: "", soon: true, status: () => ({state: "soon", line: "Coming soon"}), note: "Waiting on the route through a Busy partner."}
];
// the Tally card's line: "2 computers · 5 companies linked · 1 needs you" (the cloud's own lists, as the Tally page reads them)
function tallyIntegrationLine(){
  if (typeof TLight !== "object" || !TCloud.on()) return {state: "none", line: "Sign in to the firm account to see Tally"};
  try { TLight.refresh(); } catch (e){}
  const st = TLight.st || {}, devs = (st.devs || []).length, linked = (st.cos || []).filter(c => c.client_id).length;
  const need = Object.values(st.by || {}).filter(x => x && x.level === "bad").length;
  if (!st.loaded) return {state: "none", line: "Reading…"};
  if (!devs) return {state: "none", line: "No computer connected yet"};
  return {state: need ? "warn" : "ok", line: devs + " computer" + (devs === 1 ? "" : "s") + " · " + linked + " compan" + (linked === 1 ? "y" : "ies") + " linked" + (need ? " · " + need + " need" + (need === 1 ? "s" : "") + " you" : "")};
}
// which integration feeds a client's books, in words (Client setup's Books source card)
function booksSourceOf(co){
  if (!co) return {kind: "none"};
  const z = ZohoB.connFor(co.id);
  if (z) return {kind: "zoho", name: z.orgName || z.org, conn: z};
  const bk = typeof TCloud === "object" && TCloud.book ? TCloud.book(co.id) : null;
  if (bk && /^Zoho Books · /.test(String(bk.company || ""))) return {kind: "zoho", name: String(bk.company).replace(/^Zoho Books · /, ""), conn: null};
  const l = typeof tallyLinkOf === "function" ? tallyLinkOf(co) : null;
  const company = (l && (l.company || l.name)) || (bk && bk.company) || "";
  return company ? {kind: "tally", name: company} : {kind: "none"};
}
// ---- from src/js/76-prefiling.js
Object.assign(PreFile, {
  close(){ S.prefile = null; render(); },
  excel(res){
    const head = [["Check before filing: " + this.title(res) + " · " + res.client], ["Run " + new Date(res.at).toLocaleString("en-GB") + ". FinCom's own checks, no AI."], [],
      ["Check", "Result", "Items", "Amount", "Note"]].concat(res.lines.map(l => [l.title, l.status === "ok" ? "ok" : l.status === "fix" ? "fix this" : l.status === "na" ? "does not apply" : "could not check", l.count || 0, l.amount || 0, l.note || ""]));
    const items = [["Check", "Date", "Voucher", "Party or ledger", "Section or type", "Amount", "Note"]].concat(res.lines.flatMap(l => (l.findings || []).flatMap(f => (f.rows || []).map(x =>
      [l.title, x.date ? fmtDate(tallyDate(x.date)) : "", x.no || "", x.party || "", x.type || "", r2(num(x.amount)), x.note || ""]))));
    return FC.excel("check-before-filing-" + this.title(res), [["Checklist", head], ["Entries", items]]);
  },
  openEntry(x){
    const d8 = String(x.date || "").slice(0, 8);
    S.prefile = null;
    const lk = LK.st();
    Object.assign(lk, {kind: "find", q: String(x.no || x.party || ""), typ: "", from: d8 || lk.from, to: d8 || lk.to, heard: "", led: ""});
    FC.go("lookup"); LK.run("auto");
  },
});
// ---- from src/js/81-tax-ledgers.js
Object.assign(TaxLed, {
  // the opening balance and Tally's nature of payment, from FinCom's cloud copy (read once a book; the ledger list itself
  // does not carry them). Nothing is asked of Tally
  async loadExt(cid){
    const bk = typeof TCloud === "object" && TCloud.on() && TCloud.has(cid) ? TCloud.book(cid) : null, cur = this.ext[cid];
    if (!bk || (cur && cur.book === bk.book && (cur.at || cur.busy))) return;
    this.ext[cid] = {book: bk.book, busy: true, by: (cur && cur.by) || {}};
    const q = sel => "tally_ledgers?select=" + sel + "&merged_into=is.null&book_id=eq." + encodeURIComponent(bk.book) + "&order=name.asc";
    let rows = null;
    for (const sel of ["name,open,tds_nature,tds_deductee_type", "name,open"]){ try { rows = await TCloud.restAll(q(sel)); break; } catch (e){ this.ext[cid].err = (e && e.message) || String(e); } }
    const by = {};
    [].concat(rows || []).forEach(r => { if (r && r.name) by[ledNm(r.name).toLowerCase()] = {open: r.open == null || r.open === "" ? null : num(r.open), nature: r.tds_nature || "", dtype: r.tds_deductee_type || ""}; });
    this.ext[cid] = {book: bk.book, at: new Date().toISOString(), by};
    if (typeof render === "function") render();
  },
  // the count for the notice line ("19 ledgers to confirm"): the same as LedMaster.pending, by kind
  pending(b, kind){
    return LedMaster.pending(b).filter(([n, m]) => { if (!kind || kind === "all") return true; const k = this.kindOfWhat(m.what) || this.kindOfName(n, (b.ledInfo || {})[n]); return !k || k === kind; });
  },
  // the ledgers to ask about: not confirmed, no answer from the rules or the master, not asked before with the same facts
  toAsk(b, rows){ return rows.filter(r => !r.ok && r.src !== "rule" && r.src !== "confirmed" && !(r.it && r.it.ai && r.it.ai.key === this.aiKey(b, r))); },
  aiKey(b, r){ const it = r.it || {}; return [r.n, r.group, (it.use || {}).n || 0].join("|"); },
  // what goes to the server for one ledger: name, group, opening, Tally's tax type and nature, the use, 3 sample entries
  // (the server masks identifiers and the parties named in them)
  payload(b, r, tl){
    const t = tl[r.n] || {}, it = r.it || ((b.ledCheck || {}).items || {})[r.n] || {}, use = it.use || {};
    return {name: r.n, group: r.group || t.group || "", chain: (t.chain || []).slice(0, 6), open: r.open, taxType: t.taxType || "", nature: t.nature || "",
      use: use.say || "not used in the day book", samples: (use.samples || []).slice(0, 3).map(s => s.date + " " + s.type + " " + s.side + " " + s.amt + " | " + (s.lines || []).join(", "))};
  },
  parties(b){ const set = new Set(); Object.keys(b.gstins || {}).concat(Object.keys(b.pans || {})).forEach(n => set.add(n));
    Object.entries(b.under || {}).forEach(([n, g]) => { if (/sundry (debtors|creditors)/i.test(g || "")) set.add(n); }); return Array.from(set).slice(0, 2000); },
  MAPK: {gst_output: ["gst", "output"], gst_input: ["gst", "input"], gst_rcm: ["gst_rcm", "output"], gst_ineligible: ["ineligible", "input"], tds_payable: ["tds_payable", ""], tds_receivable: ["tds_receivable", ""],
    tcs_payable: ["tcs_payable", ""], tcs_receivable: ["tcs_receivable", ""], tax_interest: ["", ""], not_tax: ["none", ""]},
  // one batch for the client (at most 100), kept with the books as the check's "ai" (src/js/57's shape): a guess, pending
  async ask(b, opts){
    opts = opts || {};
    const cid = b.cid;
    if (this.ai.busy[cid]) return 0;
    if (!this.aiOn() && !opts.force){ this.ai.err[cid] = "off"; return 0; }
    const a = this.all(b), rows = this.toAsk(b, a.rows.concat(a.more)).slice(0, 100);
    if (!rows.length) return 0;
    this.ai.busy[cid] = true; this.ai.asked[cid] = Date.now(); render();
    let j = null;
    try { j = await this.fetchGuess({action: "ledger_guess", client_id: cid, ledgers: rows.map(r => this.payload(b, r, a.tally)), parties: this.parties(b)}); this.ai.err[cid] = ""; }
    catch (e){ this.ai.err[cid] = (e && e.kind) === "off" || (e && e.kind) === "consent" ? "off" : (e && e.message) || "AI could not be asked"; }
    this.ai.busy[cid] = false;
    const c = LedCheck.st(b), at = new Date().toISOString(), byName = new Map(rows.map(r => [r.n, r]));
    let n = 0;
    ((j && j.guesses) || []).forEach(g => { const r = byName.get(g.name), k = this.MAPK[g.kind]; if (!r || !k) return;
      const it = c.items[g.name] = c.items[g.name] || {s: {what: "", conf: "low", ev: []}, use: {n: 0, say: "not used in the day book"}, state: "pending", tallyOnly: !r.inBooks};
      const what = g.kind === "tax_interest" ? (/TDS|TCS|19\d|206C/i.test(g.name) || /^tds/.test(g.section || "") ? "tds_interest" : "gst_interest") : k[0];
      it.ai = {what, side: k[1], tax: g.head || "", rate: g.rate == null ? null : num(g.rate), section: LedCheck.section(g.section || ""), conf: ["high", "medium", "low"].includes(g.confidence) ? g.confidence : "low",
        reason: String(g.reason || "").slice(0, 200), at, key: this.aiKey(b, r), model: (j && j.model) || ""};
      n++; });
    this.ai.last[cid] = {at, n, asked: rows.length, cached: (j && j.cached) || 0, usd: (j && j.usd) || 0};
    if (n){ Drafts.direct(() => saveBooks(), {bypass: true}); }
    render();
    return n;
  },
  // drawn with the page: the AI guess asked once by itself where the rules cannot tell (the owner: "a default guess from
  // AI reading every ledger should be there"); again only when a ledger's facts change
  auto(b, rows){
    const cid = b.cid;
    if (!cid || this.ai.busy[cid] || Date.now() - (this.ai.asked[cid] || 0) < 60000 || !this.aiOn()) return;
    if (!this.toAsk(b, rows).length) return;
    setTimeout(() => { if (S.books === b) this.ask(b); }, 0);
  },
  // the posting choices of each page
  postKeys(kind){
    if (kind === "gst") return [["gst:cgst", "Input CGST"], ["gst:sgst", "Input SGST"], ["gst:igst", "Input IGST"]];
    return rules().filter(r => r.basis !== "never").map(r => ["tds:" + r.id, r.label, r]);
  },
  // a person's choice from the list: checked (a TDS ledger of another section is refused), then confirmed
  postSet(co, key, value){
    value = String(value || "").trim();
    if (!co || !value) return false;
    const [k, sub] = choiceSplit(key);
    if (k === "tds"){ const r = ruleOf(sub), c = tdsLedgerCheck(co.id, value, Ledgers.sec(r.old)); if (!c.ok && c.msg){ toast(c.msg + "."); return false; } if (c.name) value = c.name; }
    if (k === "rcm"){ Drafts.direct(() => { co.gst = co.gst || {}; co.gst[sub] = value; Store.saveCompany(co); }, {bypass: true}); toast("Saved: " + value + "."); render(); return true; }
    choiceConfirm(co, key, value); toast("Confirmed: " + value + "."); render(); return true;
  },
  postUnconfirm(co, key){ const r = choiceUnconfirm(co, key); if (r) toast("Unconfirmed: " + r.value + ". Posting waits until it is confirmed again."); render(); return r; },
});
// ---- from src/js/82-registers.js
function vrExcel(){ vendorReconExcel().catch(e => toast("Could not make the file: " + (e.message || e))); }
function reconExcelGo(){ bankReconExcel().catch(e => toast("Could not make the file: " + (e.message || e))); }
// ---- from src/js/85-twob-auto.js
function m2bAgain(reg){ M2B.sync(reg, "match again", true); }
// (each name only when declared: a test's harness loads a file's names one by one, tests/harness.js)
if (typeof DB_LIMIT !== "undefined") globalThis.DB_LIMIT = DB_LIMIT;
if (typeof INR0 !== "undefined") globalThis.INR0 = INR0;
if (typeof shownNarr !== "undefined") globalThis.shownNarr = shownNarr;
if (typeof plainText !== "undefined") globalThis.plainText = plainText;
if (typeof txnColOn !== "undefined") globalThis.txnColOn = txnColOn;
if (typeof txnTable !== "undefined") globalThis.txnTable = txnTable;
if (typeof txnExcel !== "undefined") globalThis.txnExcel = txnExcel;
if (typeof TXN_COLS !== "undefined") globalThis.TXN_COLS = TXN_COLS;
if (typeof tdsSorted !== "undefined") globalThis.tdsSorted = tdsSorted;
if (typeof tdsMonths !== "undefined") globalThis.tdsMonths = tdsMonths;
if (typeof tdsQuarterChallans !== "undefined") globalThis.tdsQuarterChallans = tdsQuarterChallans;
if (typeof setupKeepFor !== "undefined") globalThis.setupKeepFor = setupKeepFor;
if (typeof keepAtSet !== "undefined") globalThis.keepAtSet = keepAtSet;
if (typeof gstSetYm !== "undefined") globalThis.gstSetYm = gstSetYm;
if (typeof gstSetReg !== "undefined") globalThis.gstSetReg = gstSetReg;
if (typeof rateSet !== "undefined") globalThis.rateSet = rateSet;
if (typeof readingToggle !== "undefined") globalThis.readingToggle = readingToggle;
if (typeof BANK_LEDGER_LABELS !== "undefined") globalThis.BANK_LEDGER_LABELS = BANK_LEDGER_LABELS;
if (typeof ruleWhenText !== "undefined") globalThis.ruleWhenText = ruleWhenText;
if (typeof bankToggle !== "undefined") globalThis.bankToggle = bankToggle;
if (typeof bkAmt !== "undefined") globalThis.bkAmt = bkAmt;
if (typeof stmtLabel !== "undefined") globalThis.stmtLabel = stmtLabel;
if (typeof applyGroup !== "undefined") globalThis.applyGroup = applyGroup;
if (typeof bankSearch !== "undefined") globalThis.bankSearch = bankSearch;
if (typeof bankToggleRow !== "undefined") globalThis.bankToggleRow = bankToggleRow;
if (typeof bankFocusGo !== "undefined") globalThis.bankFocusGo = bankFocusGo;
if (typeof reconPick !== "undefined") globalThis.reconPick = reconPick;
if (typeof bankSettingsShow !== "undefined") globalThis.bankSettingsShow = bankSettingsShow;
if (typeof bankStdLedger !== "undefined") globalThis.bankStdLedger = bankStdLedger;
if (typeof bankOptSet !== "undefined") globalThis.bankOptSet = bankOptSet;
if (typeof gst3bSet !== "undefined") globalThis.gst3bSet = gst3bSet;
if (typeof amendSetAct !== "undefined") globalThis.amendSetAct = amendSetAct;
if (typeof filedSetNotFiled !== "undefined") globalThis.filedSetNotFiled = filedSetNotFiled;
if (typeof assetSet !== "undefined") globalThis.assetSet = assetSet;
if (typeof assetRemove !== "undefined") globalThis.assetRemove = assetRemove;
if (typeof fsKindSet !== "undefined") globalThis.fsKindSet = fsKindSet;
if (typeof fsFyGo !== "undefined") globalThis.fsFyGo = fsFyGo;
if (typeof fsStockSet !== "undefined") globalThis.fsStockSet = fsStockSet;
if (typeof misRangeSet !== "undefined") globalThis.misRangeSet = misRangeSet;
if (typeof misQuickGo !== "undefined") globalThis.misQuickGo = misQuickGo;
if (typeof misFreqSet !== "undefined") globalThis.misFreqSet = misFreqSet;
if (typeof misBudSet !== "undefined") globalThis.misBudSet = misBudSet;
if (typeof auditRangeSet !== "undefined") globalThis.auditRangeSet = auditRangeSet;
if (typeof auditFreqSet !== "undefined") globalThis.auditFreqSet = auditFreqSet;
if (typeof auditFindingSet !== "undefined") globalThis.auditFindingSet = auditFindingSet;
if (typeof relAdd !== "undefined") globalThis.relAdd = relAdd;
if (typeof relSet !== "undefined") globalThis.relSet = relSet;
if (typeof relRemove !== "undefined") globalThis.relRemove = relRemove;
if (typeof tallySendAgain !== "undefined") globalThis.tallySendAgain = tallySendAgain;
if (typeof tbAskUse !== "undefined") globalThis.tbAskUse = tbAskUse;
if (typeof tallyPickFor !== "undefined") globalThis.tallyPickFor = tallyPickFor;
if (typeof bridgeSet !== "undefined") globalThis.bridgeSet = bridgeSet;
if (typeof bridgePin !== "undefined") globalThis.bridgePin = bridgePin;
if (typeof gstStateList !== "undefined") globalThis.gstStateList = gstStateList;
if (typeof GST_RATE_CHANGE !== "undefined") globalThis.GST_RATE_CHANGE = GST_RATE_CHANGE;
if (typeof salesRateWarnings !== "undefined") globalThis.salesRateWarnings = salesRateWarnings;
if (typeof SALES_UNITS !== "undefined") globalThis.SALES_UNITS = SALES_UNITS;
if (typeof taxLedgerFor !== "undefined") globalThis.taxLedgerFor = taxLedgerFor;
if (typeof salesVtAnswer !== "undefined") globalThis.salesVtAnswer = salesVtAnswer;
if (typeof salesVtNoticeDone !== "undefined") globalThis.salesVtNoticeDone = salesVtNoticeDone;
if (typeof salesNearAnswer !== "undefined") globalThis.salesNearAnswer = salesNearAnswer;
if (typeof salesSearch !== "undefined") globalThis.salesSearch = salesSearch;
if (typeof salesToggle !== "undefined") globalThis.salesToggle = salesToggle;
if (typeof salesSetCust !== "undefined") globalThis.salesSetCust = salesSetCust;
if (typeof draftSet !== "undefined") globalThis.draftSet = draftSet;
if (typeof draftItemRemove !== "undefined") globalThis.draftItemRemove = draftItemRemove;
if (typeof draftCust !== "undefined") globalThis.draftCust = draftCust;
if (typeof salesCfgCheck !== "undefined") globalThis.salesCfgCheck = salesCfgCheck;
if (typeof MODULE_ICON !== "undefined") globalThis.MODULE_ICON = MODULE_ICON;
if (typeof moduleIncluded !== "undefined") globalThis.moduleIncluded = moduleIncluded;
if (typeof billBack !== "undefined") globalThis.billBack = billBack;
if (typeof billFixPick !== "undefined") globalThis.billFixPick = billFixPick;
if (typeof goDocType !== "undefined") globalThis.goDocType = goDocType;
if (typeof txnGo !== "undefined") globalThis.txnGo = txnGo;
if (typeof tdsNrSet !== "undefined") globalThis.tdsNrSet = tdsNrSet;
if (typeof tdsTcsCode !== "undefined") globalThis.tdsTcsCode = tdsTcsCode;
if (typeof tdsFilter !== "undefined") globalThis.tdsFilter = tdsFilter;
if (typeof tdsToggle !== "undefined") globalThis.tdsToggle = tdsToggle;
if (typeof challanDelete !== "undefined") globalThis.challanDelete = challanDelete;
if (typeof certAdd !== "undefined") globalThis.certAdd = certAdd;
if (typeof certDelete !== "undefined") globalThis.certDelete = certDelete;
if (typeof gstViewGo !== "undefined") globalThis.gstViewGo = gstViewGo;
if (typeof acctPerson !== "undefined") globalThis.acctPerson = acctPerson;
if (typeof acctBackup !== "undefined") globalThis.acctBackup = acctBackup;
if (typeof acctDropOff !== "undefined") globalThis.acctDropOff = acctDropOff;
if (typeof cloudAuto !== "undefined") globalThis.cloudAuto = cloudAuto;
if (typeof docsKeep !== "undefined") globalThis.docsKeep = docsKeep;
if (typeof docYearsSet !== "undefined") globalThis.docYearsSet = docYearsSet;
if (typeof coSetRuleLedger !== "undefined") globalThis.coSetRuleLedger = coSetRuleLedger;
if (typeof coCommitRuleLedger !== "undefined") globalThis.coCommitRuleLedger = coCommitRuleLedger;
if (typeof coSetBlockRule !== "undefined") globalThis.coSetBlockRule = coSetBlockRule;
if (typeof firmSetupSave !== "undefined") globalThis.firmSetupSave = firmSetupSave;
if (typeof firmLogoRead !== "undefined") globalThis.firmLogoRead = firmLogoRead;
if (typeof firmSetName !== "undefined") globalThis.firmSetName = firmSetName;
if (typeof coClearIds !== "undefined") globalThis.coClearIds = coClearIds;
if (typeof custImsAdd !== "undefined") globalThis.custImsAdd = custImsAdd;
if (typeof custImsRemove !== "undefined") globalThis.custImsRemove = custImsRemove;
if (typeof custImsSet !== "undefined") globalThis.custImsSet = custImsSet;
if (typeof gstfJournal !== "undefined") globalThis.gstfJournal = gstfJournal;
if (typeof gst1aJson !== "undefined") globalThis.gst1aJson = gst1aJson;
if (typeof gsetApply !== "undefined") globalThis.gsetApply = gsetApply;
if (typeof gsetPick !== "undefined") globalThis.gsetPick = gsetPick;
if (typeof gsetFilingAdd !== "undefined") globalThis.gsetFilingAdd = gsetFilingAdd;
if (typeof gsetFilingDel !== "undefined") globalThis.gsetFilingDel = gsetFilingDel;
if (typeof gsetShared !== "undefined") globalThis.gsetShared = gsetShared;
if (typeof gsetSet !== "undefined") globalThis.gsetSet = gsetSet;
if (typeof gregAdd !== "undefined") globalThis.gregAdd = gregAdd;
if (typeof gregRemove !== "undefined") globalThis.gregRemove = gregRemove;
if (typeof gcontSet !== "undefined") globalThis.gcontSet = gcontSet;
if (typeof booksHasAny !== "undefined") globalThis.booksHasAny = booksHasAny;
if (typeof gqSetField !== "undefined") globalThis.gqSetField = gqSetField;
if (typeof gqSetPaid !== "undefined") globalThis.gqSetPaid = gqSetPaid;
if (typeof gqIffJson !== "undefined") globalThis.gqIffJson = gqIffJson;
if (typeof gqQuarterType !== "undefined") globalThis.gqQuarterType = gqQuarterType;
if (typeof viewGstApiCard !== "undefined") globalThis.viewGstApiCard = viewGstApiCard;
if (typeof supType !== "undefined") globalThis.supType = supType;
if (typeof supDraft !== "undefined") globalThis.supDraft = supDraft;
if (typeof supTab !== "undefined") globalThis.supTab = supTab;
if (typeof supArt !== "undefined") globalThis.supArt = supArt;
if (typeof supFilter !== "undefined") globalThis.supFilter = supFilter;
if (typeof supDstat !== "undefined") globalThis.supDstat = supDstat;
if (typeof supFiles !== "undefined") globalThis.supFiles = supFiles;
if (typeof supFdel !== "undefined") globalThis.supFdel = supFdel;
if (typeof supDl !== "undefined") globalThis.supDl = supDl;
if (typeof supSet !== "undefined") globalThis.supSet = supSet;
if (typeof supAct !== "undefined") globalThis.supAct = supAct;
if (typeof mfaKeyGroups !== "undefined") globalThis.mfaKeyGroups = mfaKeyGroups;
if (typeof signOutAll !== "undefined") globalThis.signOutAll = signOutAll;
if (typeof lkType !== "undefined") globalThis.lkType = lkType;
if (typeof lkSrc !== "undefined") globalThis.lkSrc = lkSrc;
if (typeof lkKind !== "undefined") globalThis.lkKind = lkKind;
if (typeof lkPer !== "undefined") globalThis.lkPer = lkPer;
if (typeof lkRec !== "undefined") globalThis.lkRec = lkRec;
if (typeof lkMonth !== "undefined") globalThis.lkMonth = lkMonth;
if (typeof lkShowFy !== "undefined") globalThis.lkShowFy = lkShowFy;
if (typeof lkOpen !== "undefined") globalThis.lkOpen = lkOpen;
if (typeof closedSet !== "undefined") globalThis.closedSet = closedSet;
if (typeof detailOpen !== "undefined") globalThis.detailOpen = detailOpen;
if (typeof postLedgerLine !== "undefined") globalThis.postLedgerLine = postLedgerLine;
if (typeof goSetupFor !== "undefined") globalThis.goSetupFor = goSetupFor;
if (typeof postJobHeld !== "undefined") globalThis.postJobHeld = postJobHeld;
if (typeof postRetryWhy !== "undefined") globalThis.postRetryWhy = postRetryWhy;
if (typeof postTimingWords !== "undefined") globalThis.postTimingWords = postTimingWords;
if (typeof postCanSettle !== "undefined") globalThis.postCanSettle = postCanSettle;
if (typeof postFixBill !== "undefined") globalThis.postFixBill = postFixBill;
if (typeof postPreviewOne !== "undefined") globalThis.postPreviewOne = postPreviewOne;
if (typeof postBackToReview !== "undefined") globalThis.postBackToReview = postBackToReview;
if (typeof postReplyRaw !== "undefined") globalThis.postReplyRaw = postReplyRaw;
if (typeof postIsoOf !== "undefined") globalThis.postIsoOf = postIsoOf;
if (typeof postRowHit !== "undefined") globalThis.postRowHit = postRowHit;
if (typeof choiceUnconfirm !== "undefined") globalThis.choiceUnconfirm = choiceUnconfirm;
if (typeof bankConfirmAccLedger !== "undefined") globalThis.bankConfirmAccLedger = bankConfirmAccLedger;
if (typeof payDetailSet !== "undefined") globalThis.payDetailSet = payDetailSet;
if (typeof payAskLedgers !== "undefined") globalThis.payAskLedgers = payAskLedgers;
if (typeof INTEGRATIONS !== "undefined") globalThis.INTEGRATIONS = INTEGRATIONS;
if (typeof tallyIntegrationLine !== "undefined") globalThis.tallyIntegrationLine = tallyIntegrationLine;
if (typeof booksSourceOf !== "undefined") globalThis.booksSourceOf = booksSourceOf;
if (typeof vrExcel !== "undefined") globalThis.vrExcel = vrExcel;
if (typeof reconExcelGo !== "undefined") globalThis.reconExcelGo = reconExcelGo;
if (typeof m2bAgain !== "undefined") globalThis.m2bAgain = m2bAgain;
/* @react-lazy: end */
