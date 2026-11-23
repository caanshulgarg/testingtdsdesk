// New look, phase 1 (docs/UX-QUICKBOOKS-OF-INDIA.md, the owner's review of 22-Nov-2026: "too much cluttered, lots of
// words"; "+ New to make a normal journal entry like QuickBooks"). Only while the person's switch is on (flag.js):
//   - the menu of at most 7 items (the sidebar, Side.jsx, draws this tree instead of its own: window.__nlTree):
//       firm    Home · Clients · Due dates · Daily Check · Tally          (then Settings, Help)
//       client  Home · Bank · Purchase · Sales · GST · TDS · ITR · Books · Tally   (then Client settings, All clients, Help)
//     and the row of that item's pages over the page (NLTabs): GST · TDS · ITR (GST, TDS, Income tax return, 26AS) and
//     Books (Reports, MIS, My MIS, Financial statements, Transactions, Audit, Look up, Letters, From Tally, Corporate).
//     Every page keeps its address (goClient("books:mis") …), so nothing that opens a page directly changes;
//   - + New in the top bar (NLTop): Record (Journal F7, Payment F5, Receipt F6, Contra F4: the entry form, Entry.jsx;
//     Bill, Sale: the uploads) and Bring in (bank statement, bills, sales invoices, a new client);
//   - search, Ctrl+K (and the top bar's box): clients, pages, actions, and the open client's bills and ledgers; ↑↓ and
//     Enter. F3 still opens the client switcher.
import { Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Search } from "lucide-react";
import { newLook } from "./flag.js";
import "./newlook.css";

const Entry = lazy(() => import("./Entry.jsx"));
const go = (fn) => () => (window.FinComNav ? window.FinComNav.go(fn) : fn());
const coOpen = () => { const co = typeof CO === "function" ? CO() : null; return co || (S.coId && S.companies[S.coId]) || null; };
const bt = () => (S.view === "company" && S.tab === "books" && typeof booksTab === "function" ? booksTab() : "");

// ---------------------------------------------------------------- the menu
export const RETURNS = [["gst", "GST", "books:gst"], ["tds", "TDS", "books:tds"], ["itr", "Income tax return", "books:itr"], ["recon", "26AS reconciliation", "books:recon"]];
export function booksPages(co) {
  return [["reports", "Reports", "books:reports"], ["mis", "MIS", "books:mis"], ["mymis", "My MIS", "books:mymis"], ["fs", "Financial statements", "books:fs"],
    ["txn", "Transactions", "txn"], ["audit", "Audit", "books:audit"], ["lookup", "Look up", "books:lookup"], ["letters", "Letters", "books:letters"],
    ["import", "From Tally", "books:import"], ...(co && typeof FS === "object" && FS.entityOf(co).code === "C" ? [["corp", "Corporate", "books:corp"]] : [])];
}
const isReturns = (b) => b === "gst" || b === "tds" || b === "recon" || /^itr/.test(b);
const isBooks = (b) => S.tab === "txn" || ["reports", "mis", "mymis", "fs", "audit", "tieout", "lookup", "letters", "import", "ledgers"].includes(b) || /^corp/.test(b);
const openPage = (to) => { if (to === "books:fs") S.fsTab = ""; goClient(to); };
const tallyGo = (cid) => () => { S.tallyFocus = cid || ""; S.tallyTab = "computers"; navHome("tally"); };

function tree() {
  const co = typeof CO === "function" ? CO() : null, inCo = S.view === "company" && !!co, open = coOpen(), home = S.view === "home";
  const help = { icon: "help", label: "Help", on: home && S.homeTab === "help", go: () => navHome("help") };
  if (home || !open) {
    const t = S.homeTab;
    return [[null, [
      { icon: "today", label: "Home", on: t === "today" || t === "inbox", go: () => navHome("today"), bar: true, title: "What needs doing, every client" },
      { icon: "clients", label: "Clients", on: t === "clients", go: () => navHome("clients"), bar: true },
      { icon: "compliance", label: "Due dates", on: t === "compliance", go: () => { S.nlDueTab = "due"; navHome("compliance"); }, bar: true, title: "Returns and payments due, every client" },
      { icon: "daily", label: "Daily Check", on: t === "daily", go: () => navHome("daily"), title: "What last night's checks found" },
      { icon: "integrations", label: "Tally", on: t === "tally" || t === "integrations", go: tallyGo(""), bar: true, title: "Connect Tally, its companies and ports" },
    ]], ["sep", [
      { icon: "settings", label: "Settings", on: t === "rules", go: () => goSettings(null) },
      ...(typeof Cloud === "object" && Cloud.on() && ["owner", "staff"].includes(String((Cloud.st && Cloud.st.role) || "")) ? [{ icon: "meetings", label: "Meetings", on: t === "meetings", go: () => navHome("meetings") }] : []),
      help]]];
  }
  const st = open.stats || {}, mod = inCo ? docType() : "", setup = inCo && isSetupTab(S.tab), b = bt();
  const work = inCo && !setup && !["dash", "clientInbox", "txn", "books"].includes(S.tab);
  return [[null, [
    { icon: "dash", label: "Home", on: inCo && (S.tab === "dash" || S.tab === "clientInbox"), go: () => goClient("dash"), bar: true, title: "Where this client stands" },
    { icon: "bank", label: "Bank", on: work && mod === "bank", go: () => goClient("bank"), bar: true, count: S.bank && S.bank.cid === open.id && typeof tabCounts === "function" ? tabCounts(S.bank.rows).review : 0 },
    { icon: "bills", label: "Purchase", on: work && mod === "bills", go: () => goClient("bills"), bar: true, count: st.drafts || 0 },
    { icon: "sales", label: "Sales", on: work && mod === "sales", go: () => goClient("sales") },
    { icon: "gst", label: "GST · TDS · ITR", on: isReturns(b), go: () => goClient("books:gst"), bar: true, title: "GST, TDS, income tax return and 26AS" },
    { icon: "books", label: "Books", on: inCo && isBooks(b), go: () => goClient("books:reports"), title: "Reports, MIS, statements, audit, look up, letters" },
    { icon: "integrations", label: "Tally", on: false, go: tallyGo(open.id), title: "This client's Tally company, and connecting Tally" },
  ]], ["sep", [
    { icon: "setup", label: "Client settings", on: setup, go: () => { if (!setup) { S.setupList = Date.now(); toggleSetup(); } } },
    { icon: "clients", label: "All clients", on: false, go: () => navHome("clients") },
    help]]];
}
window.__nlTree = tree;

// the row of the pages of the menu item open (a client's GST · TDS · ITR or Books)
export function NLTabs() {
  if (!newLook() || S.view !== "company" || S.loadingCo) return null;
  const co = CO(), b = bt(), list = isReturns(b) ? RETURNS : isBooks(b) ? booksPages(co) : null;
  if (!list) return null;
  const cur = S.tab === "txn" ? "txn" : b === "tieout" ? "audit" : b === "ledgers" ? "import" : /^itr/.test(b) ? "itr" : /^corp/.test(b) ? "corp" : b;
  return <nav className="nl-tabs" aria-label={isReturns(b) ? "GST · TDS · ITR" : "Books"} data-nl-tabs={isReturns(b) ? "returns" : "books"}>
    {list.map(([k, w, to]) => <button key={k} type="button" className="nl-tab" data-nl-tab={k} aria-current={k === cur ? "page" : undefined} onClick={go(() => openPage(to))}>{w}</button>)}
  </nav>;
}

// ---------------------------------------------------------------- + New
// [kind, words, Tally's key]: Record makes an entry; Bring in uploads. The keys are labels only (decision D4: the browser
// keeps F5 for reloading; Alt+F4 closes a window on Windows)
export const RECORD = [["Journal", "Journal", "F7"], ["Payment", "Payment", "F5"], ["Receipt", "Receipt", "F6"], ["Contra", "Contra", "F4"]];
function bringIn(kind) {
  const co = coOpen();
  if (kind === "client") return doAct("addCo");
  if (!co) { toast("Open a client first: press F3 to choose one."); return openSwitcher(); }
  if (kind === "bank") { goClient("bank"); return setTimeout(() => doAct("uploadHere"), 0); }
  if (kind === "bills") return goStep("collect", "bills");
  if (kind === "sales") { goClient("sales"); return setTimeout(() => typeof salesAct === "function" && salesAct("salesPick"), 0); }
}
export const newEntry = (type) => { S.nlEntry = { type, cid: S.view === "company" && S.coId ? S.coId : "", at: Date.now() }; S.nlNew = false; render(); };

function NewMenu({ close }) {
  const box = useRef(null);
  useEffect(() => {
    const out = (e) => { if (box.current && !box.current.contains(e.target) && !(e.target.closest && e.target.closest("[data-nl-new]"))) close(); };
    const key = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("pointerdown", out, true); document.addEventListener("keydown", key, true);
    const f = box.current && box.current.querySelector("button"); if (f) f.focus();
    return () => { document.removeEventListener("pointerdown", out, true); document.removeEventListener("keydown", key, true); };
  }, []);
  const pick = (fn) => () => { close(); fn(); };
  return <div ref={box} className="nl-pop nl-newmenu" role="menu" aria-label="New" data-nl-newmenu="">
    <div className="nl-pop-h">Record</div>
    {RECORD.map(([t, w, k]) => <button key={t} type="button" role="menuitem" className="nl-pop-i" data-nl-record={t} onClick={pick(() => newEntry(t))}><span>{w}</span><kbd>{k}</kbd></button>)}
    <button type="button" role="menuitem" className="nl-pop-i" data-nl-record="Bill" onClick={pick(() => bringIn("bills"))}><span>Purchase bill</span><kbd>F9</kbd></button>
    <button type="button" role="menuitem" className="nl-pop-i" data-nl-record="Sale" onClick={pick(() => bringIn("sales"))}><span>Sales invoice</span><kbd>F8</kbd></button>
    <div className="nl-pop-h">Bring in</div>
    <button type="button" role="menuitem" className="nl-pop-i" data-nl-bring="bank" onClick={pick(() => bringIn("bank"))}><span>Bank statement</span></button>
    <button type="button" role="menuitem" className="nl-pop-i" data-nl-bring="bills" onClick={pick(() => bringIn("bills"))}><span>Bills</span></button>
    <button type="button" role="menuitem" className="nl-pop-i" data-nl-bring="client" onClick={pick(() => bringIn("client"))}><span>New client</span></button>
  </div>;
}

// the top bar's two: search and + New
export function NLTop() {
  const [open, setOpen] = useState(false);
  if (!newLook()) return null;
  return <span className="nl-top" data-nl-top="">
    <button type="button" className="nl-search-btn" data-nl-search-open="" aria-label="Search (Ctrl+K)" title="Search clients, bills, ledgers and pages (Ctrl+K)" onClick={() => { S.nlSearch = { q: "", i: 0 }; render(); }}>
      <Search width={15} height={15} strokeWidth={1.8} aria-hidden="true" /><span className="nl-search-w">Search</span><kbd>Ctrl K</kbd></button>
    <span className="nl-new-wrap">
      <button type="button" className="btn small primary nl-new" data-nl-new="" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Plus width={15} height={15} strokeWidth={2.2} aria-hidden="true" /><span>New</span></button>
      {open && <NewMenu close={() => setOpen(false)} />}
    </span>
  </span>;
}

// ---------------------------------------------------------------- search (Ctrl+K)
const lc = (s) => String(s || "").toLowerCase();
function pagesOf() {
  const co = coOpen(), out = [
    ["Home", () => navHome("today")], ["Clients", () => navHome("clients")], ["Due dates", () => { S.nlDueTab = "due"; navHome("compliance"); }], ["Daily Check", () => navHome("daily")],
    ["Tally", tallyGo("")], ["Tally: sent to Tally", () => goTallyPage("sent")], ["Integrations", () => navHome("integrations")], ["Settings", () => goSettings(null)], ["Settings: people", () => goSettings("account")],
    ["Settings: plan and credit", () => goSettings("plan")], ["Help", () => navHome("help")],
    ...(typeof Cloud === "object" && Cloud.on() ? [["GST portal links", () => { S.nlDueTab = "gstapi"; navHome("compliance"); }], ["Settings: email to clients", () => goSettings("mail")]] : [])];
  if (co) {
    const n = " · " + co.name;
    [["Home", "dash"], ["Bank", "bank"], ["Purchase", "bills"], ["Sales", "sales"]].forEach(([w, to]) => out.push([w + n, () => goClient(to)]));
    RETURNS.concat(booksPages(co)).forEach(([, w, to]) => out.push([w + n, () => openPage(to)]));
    out.push(["Client settings" + n, () => { if (!isSetupTab(S.tab)) { S.setupList = Date.now(); toggleSetup(); } }]);
  }
  return out;
}
const goTallyPage = (tab) => { S.tallyFocus = ""; S.tallyTab = tab; navHome("tally"); };
// every result: {g: group, w: words, s: small words, go}
function results(q) {
  const co = coOpen(), w = lc(q).trim(), hit = (...xs) => !w || w.split(/\s+/).every((p) => xs.some((x) => lc(x).includes(p)));
  const out = [];
  RECORD.forEach(([t, word, k]) => { if (hit("new " + word, word, "entry voucher")) out.push({ g: "Actions", w: "New " + word.toLowerCase(), s: "Tally " + k, go: () => newEntry(t) }); });
  if (hit("upload bank statement")) out.push({ g: "Actions", w: "Upload a bank statement", s: "", go: () => bringIn("bank") });
  if (hit("new client add")) out.push({ g: "Actions", w: "New client", s: "", go: () => bringIn("client") });
  pagesOf().forEach(([word, f]) => { if (w && hit(word)) out.push({ g: "Pages", w: word, s: "", go: f }); });
  Object.values(S.companies || {}).filter((c) => c && !c.deleted).forEach((c) => {
    if (hit(c.name, c.gstin, c.pan)) out.push({ g: "Clients", w: c.name, s: [c.gstin, c.pan].filter(Boolean).join(" · "), go: () => openCompany(c.id) });
  });
  if (co && w) {
    const ents = Object.entries((typeof D === "function" && D(co.id).entries) || {});
    ents.forEach(([id, e]) => { const x = (e && e.x) || {};
      if (hit(x.vendorName, x.invoiceNo, x.gstin, String(x.total || ""), e.fileName)) out.push({ g: "Bills · " + co.name, w: (x.vendorName || e.fileName || "Bill") + (x.invoiceNo ? " · " + x.invoiceNo : ""),
        s: [x.invoiceDate ? fmtDate(x.invoiceDate) : "", x.total ? money(num(x.total)) : ""].filter(Boolean).join(" · "),
        go: () => { S.view = "company"; S.step = null; S.tab = "invoices"; S.filter = e.status; S.selected = id; S.reviewTable = false; render(); } }); });
    let leds = []; try { leds = typeof Ledgers === "object" ? Ledgers.list(co.id) || [] : []; } catch (e) { leds = []; }
    leds.forEach((l) => { if (l && l.name && hit(l.name, l.group)) out.push({ g: "Ledgers · " + co.name, w: l.name, s: l.group || "", go: () => { goClient("books:lookup"); setTimeout(() => { try { LK.st().kind = "ledger"; lkLed(l.name); } catch (e) { /* Look up opened */ } }, 0); } }); });
  }
  // a few of each group, the groups in this order
  const per = {}, order = ["Actions", "Clients", "Pages"];
  return out.filter((r) => (per[r.g] = (per[r.g] || 0) + 1) <= (w ? 8 : 5)).sort((a, b) => (order.indexOf(a.g) + 1 || 9) - (order.indexOf(b.g) + 1 || 9));
}

function Palette() {
  const sr = S.nlSearch, inp = useRef(null), box = useRef(null);
  const q = sr.q || "", list = useMemo(() => results(q), [q, S.coId]);
  const i = Math.max(0, Math.min(sr.i || 0, list.length - 1));
  const close = () => { S.nlSearch = null; render(); };
  const pick = (r) => { S.nlSearch = null; if (r) (window.FinComNav ? window.FinComNav.go(r.go) : r.go()); render(); };
  useEffect(() => { if (inp.current) inp.current.focus(); }, []);
  useLayoutEffect(() => { const el = box.current && box.current.querySelector('[aria-selected="true"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" }); });
  const key = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sr.i = Math.min(list.length - 1, i + 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sr.i = Math.max(0, i - 1); render(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(list[i]); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
  };
  let last = "";
  return createPortal(<div className="nl-veil" data-nl-veil="" onPointerDown={(e) => { if (e.target === e.currentTarget) close(); }}>
    <div ref={box} className="nl-palette" role="dialog" aria-modal="true" aria-label="Search" data-nl-palette="">
      <div className="nl-pal-in"><Search width={16} height={16} aria-hidden="true" />
        <input ref={inp} type="text" data-nl-q="" value={q} placeholder="Search clients, bills, ledgers, pages…" aria-label="Search" autoComplete="off"
          onChange={(e) => { sr.q = e.target.value; sr.i = 0; render(); }} onKeyDown={key} /><kbd>Esc</kbd></div>
      <ul className="nl-pal-list" role="listbox" aria-label="Results">
        {list.length ? list.map((r, j) => { const head = r.g !== last; last = r.g;
          return [head && <li key={"h" + j} className="nl-pal-g" role="presentation">{r.g}</li>,
            <li key={j} role="option" aria-selected={j === i} className="nl-pal-r" data-nl-result={r.g} onPointerEnter={() => { if (sr.i !== j) { sr.i = j; render(); } }} onClick={() => pick(r)}>
              <span className="nl-pal-w">{r.w}</span>{r.s && <span className="nl-pal-s">{r.s}</span>}</li>]; })
          : <li className="nl-pal-none" data-nl-none="">Nothing found for “{q}”.</li>}
      </ul>
      <div className="nl-pal-foot">↑↓ to move · Enter to open · F3 changes the client</div>
    </div></div>, document.body);
}

// Ctrl+K (and "/" outside a box) opens the search; the keys go to it before the rest of the page sees them
function useKeys() {
  useEffect(() => {
    const k = (e) => {
      if (!newLook()) return;
      const ctrl = e.ctrlKey || e.metaKey, inField = /INPUT|SELECT|TEXTAREA/.test((document.activeElement && document.activeElement.tagName) || "");
      // Esc with the search open closes the search first, whatever has the focus (it may be open over the entry window)
      if (e.key === "Escape" && S.nlSearch) { e.preventDefault(); e.stopImmediatePropagation(); S.nlSearch = null; render(); return; }
      if (ctrl && String(e.key).toLowerCase() === "k" && !S.switcher) { e.preventDefault(); e.stopImmediatePropagation(); S.nlSearch = S.nlSearch ? null : { q: "", i: 0 }; render(); }
      else if (e.key === "/" && !inField && !ctrl && !S.nlSearch && !S.nlEntry && !(S.view === "company" && S.tab === "books" && bt() === "lookup")) { e.preventDefault(); e.stopImmediatePropagation(); S.nlSearch = { q: "", i: 0 }; render(); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, []);
}

// the sidebar draws the new menu once this file is in
let drawn = false;
export default function Shell() {
  useKeys();
  useEffect(() => { if (!drawn) { drawn = true; render(); } }, []);
  if (!newLook()) return null;
  return <>
    {S.nlSearch && <Palette />}
    {S.nlEntry && <Suspense fallback={null}><Entry /></Suspense>}
  </>;
}
