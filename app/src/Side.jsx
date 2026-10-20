// The sidebar: the open client and its areas, then all clients and help. Was renderSide() in src/js/02-the-layout.js.
// S, CO, docType, ... are the business logic's globals (legacy.js); goClient/navHome/toggleSetup are its navigation.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FinComNav } from "./nav.js";
import { useDismiss } from "./parts/dismiss.js";
// Arc UI (arc-ui, 09-Oct-2026): the sidebar in Arc's look (styles/arc-shell.css): a light surface, Lucide icons as
// Arc's components use, quiet section labels, the open client as a card, and on a computer a button that folds the
// sidebar to its icons (remembered on this computer).
//
// Clean-up batch 1, "Find your way" (11-Oct-2026, the owner: "clean… anyone would love to work in FinCom"): one tree,
// in the order a CA works (bring in → work → returns → books), each item named as its page's title:
//   FIRM    Today · Compliance · Clients · Tally · Settings (People and Plan are Settings' sections) · Help
//   CLIENT  Overview / BRING IN Inbox · From Tally / WORK Purchase · Bank · Sales · Transactions / RETURNS TDS · GST /
//           BOOKS Reports · MIS · Statements (the Financial statements page) · Audit · Look up · Letters / then Client setup · All clients · Help
// On a phone the bar along the bottom keeps five: Overview · Purchase · Bank · Sales · More (Today · Compliance ·
// Clients · Tally · More on the firm's pages); More opens a sheet with everything else.
import { ArrowLeftRight, BookOpen, Scale, CalendarCheck, ChartColumn, CircleHelp, CloudDownload, Ellipsis, FileSearch, FileText, Inbox,
  Landmark, LayoutDashboard, Mail, PanelLeftClose, PanelLeftOpen, Percent, Plug, ReceiptText, Search, Settings, SlidersHorizontal, Sun,
  TrendingUp, Users, X } from "lucide-react";

const ICONS = { today: Sun, dash: LayoutDashboard, bills: ReceiptText, bank: Landmark, sales: TrendingUp, inbox: Inbox, fromtally: CloudDownload,
  setup: SlidersHorizontal, settings: Settings, txn: ArrowLeftRight, books: BookOpen, tds: Percent, gst: FileText, reports: ChartColumn, lookup: Search,
  audit: FileSearch, letters: Mail, help: CircleHelp, clients: Users, compliance: CalendarCheck, more: Ellipsis, integrations: Plug, recon: Scale };
// each area its own colour (the owner, 09-Oct-2026: "some bright colours"), the accents of styles/arc-tokens.css
const TONES = { today: "amber", dash: "indigo", bills: "amber", bank: "sky", sales: "emerald", inbox: "violet", fromtally: "teal", setup: "slate",
  settings: "slate", txn: "teal", books: "violet", tds: "rose", gst: "indigo", reports: "teal", lookup: "sky", audit: "rose", letters: "amber",
  help: "sky", clients: "indigo", compliance: "rose", more: "slate", integrations: "teal", recon: "emerald" };

const RAIL = { Transactions: "Trans\u00ADactions", Reconciliations: "Reconcil\u00ADiations", Integrations: "Integra\u00ADtions", Compliance: "Compli\u00ADance" };
function Item({ icon, label, on, count, onClick, title, bar }) {
  const Icon = ICONS[icon] || LayoutDashboard;
  return (
    // a name a screen reader reads out (review item 34): the label, what it is for, and the count beside it
    <button className="side-link" aria-current={on ? "page" : undefined} onClick={onClick} title={title || label} data-bar={bar ? "" : undefined}
      data-side={label} aria-label={label + (title ? ": " + title : "") + (count ? ", " + count + " waiting" : "")}>
      <i className="side-chip" data-tone={TONES[icon] || "indigo"} aria-hidden="true"><Icon className="side-ic" width={16} height={16} strokeWidth={1.75} /></i>
      <span className="side-word">{label}</span>
      {/* the folded rail's words under the icon: a long word may break at its soft hyphen (t70) */}
      <span className="side-rail-word" aria-hidden="true">{RAIL[label] || label}</span>
      {count ? <span className="side-count">{count}</span> : null}
    </button>
  );
}

const FOLD = "fincom:sideFolded";
// the person's choice, kept in this browser (t70: never folded on its own: "only icons make the system unreadable"; folded
// is a rail with each item's words under its icon, styles/arc-shell.css)
const readFold = () => { try { return localStorage.getItem(FOLD) === "1"; } catch (e) { return false; } };
const initials = (name) => String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

// the menu's items, in order: [group label or null, items]. Each item: icon, label, on, go, and optionally count, title,
// bar (one of the phone bar's four)
function tree() {
  const co = CO(), inCo = S.view === "company" && !!co, open = co || (S.coId && S.companies[S.coId]);
  const home = S.view === "home";
  const help = { icon: "help", label: "Help", on: home && S.homeTab === "help", count: typeof SUP === "object" ? SUP.counts() : 0, go: () => navHome("help") };
  if (home || !open) {
    const t = S.homeTab;
    return [[null, [
      // the firm's home page (homeTab "today"); the Inbox for all clients is opened from it ("To read"), so it lights Today too
      { icon: "today", label: "Today", on: t === "today" || t === "inbox", go: () => navHome("today"), bar: true, title: "What needs doing, every client" },
      { icon: "compliance", label: "Compliance", on: t === "compliance", go: () => navHome("compliance"), bar: true, title: "Returns and payments due, every client" },
      { icon: "clients", label: "Clients", on: t === "clients", go: () => navHome("clients"), bar: true },
      { icon: "books", label: "Tally", on: t === "tally", go: () => { S.tallyFocus = ""; navHome("tally"); }, bar: true },
      // zoho-books (13-Oct-2026): Tally, Zoho Books and what comes next, one page (src/js/74, screens/Integrations.jsx)
      { icon: "integrations", label: "Integrations", on: t === "integrations", go: () => goIntegrations(""), title: "Tally, Zoho Books and other books" },
      // People and Plan and credit are sections of Settings (and the firm menu's own items)
      { icon: "settings", label: "Settings", on: t === "rules", go: () => goSettings(null), title: "The firm's settings, people, plan and credit" },
    ]], ["sep", [help]]];
  }
  const st = open.stats || {}, mod = inCo ? docType() : "", setup = inCo && isSetupTab(S.tab), bt = inCo && S.tab === "books" ? booksTab() : "";
  const work = inCo && !setup && !["dash", "clientInbox", "txn", "books"].includes(S.tab);
  // ui-tidy (13-Oct-2026; the owner: "still it is very confusing where is the client"): Clients first, in the sidebar and
  // the phone's bar, from inside a client too (was "All clients" at the foot)
  return [
    [null, [{ icon: "clients", label: "Clients", on: false, go: () => navHome("clients"), bar: true, title: "Every client: find one, open it" },
      { icon: "dash", label: "Overview", on: inCo && S.tab === "dash", go: () => goClient("dash"), bar: true, title: "Where this client stands" }]],
    // t70 (16-Oct-2026; the owner): no "Bring in": the Inbox is the top bar's tray (TopBar.jsx InboxBtn), From Tally
    // (books:import, its address kept) is reached from the Tally panel's Upload and Connect Tally's step 6
    ["Work", [
      { icon: "bills", label: "Purchase", count: st.drafts || 0, go: () => goClient("bills"), bar: true, on: work && mod === "bills" },
      { icon: "bank", label: "Bank", on: work && mod === "bank", go: () => goClient("bank"), bar: true,
        count: S.bank && S.bank.cid === open.id ? tabCounts(S.bank.rows).review : 0 },
      { icon: "sales", label: "Sales", on: work && mod === "sales", go: () => goClient("sales") },
      { icon: "txn", label: "Transactions", on: inCo && S.tab === "txn", go: () => goClient("txn"), title: "One register: purchase, sales and bank" },
    ]],
    ["Returns", [
      { icon: "tds", label: "TDS", on: bt === "tds", go: () => goClient("books:tds"), title: "TDS returns and the challan register" },
      { icon: "gst", label: "GST", on: bt === "gst", go: () => goClient("books:gst"), title: "GST returns" },
      // tds-layout (14-Oct-2026): TDS receivable vs 26AS, out of TDS
      { icon: "recon", label: "Reconciliations", on: bt === "recon", go: () => goClient("books:recon"), title: "TDS receivable vs 26AS" },
    ]],
    ["Books", [
      { icon: "reports", label: "Reports", on: bt === "reports", go: () => goClient("books:reports") },
      { icon: "reports", label: "MIS", on: bt === "mis", go: () => goClient("books:mis"), title: "Management reports from the books" },
      { icon: "books", label: "Statements", on: bt === "fs", go: () => { S.fsTab = ""; goClient("books:fs"); }, title: "Financial statements: balance sheet, P&L, cash flow, notes and computation, linked to the trial balance" },
      // the tie-out with Tally is a tab of Audit
      { icon: "audit", label: "Audit", on: bt === "audit" || bt === "tieout", go: () => goClient("books:audit"), title: "Checks over the books, and the tie-out with Tally" },
      { icon: "lookup", label: "Look up", on: bt === "lookup", go: () => goClient("books:lookup"), title: "Any ledger, any dates (press /)" },
      { icon: "letters", label: "Letters", on: bt === "letters", go: () => goClient("books:letters"), title: "Balance confirmations and dues reminders" },
    ]],
    ["sep", [
      { icon: "setup", label: "Client setup", on: setup, go: () => { if (!setup) toggleSetup(); }, title: "This client's company, suppliers, Tally and ledgers" },
      help,
    ]],
  ];
}

// the open client as a card: in a client, a click changes the client (F3); on a firm page it goes back to the client's
// page last shown (backToClient, src/js/52), the one way back (the Tally page's own "← Back to" link is gone)
function ClientCard({ open, home, after }) {
  const back = () => { S.firmMenu = false; S.tallyPanel = false; if (typeof backToClient === "function") backToClient(); else openCompany(open.id).then(() => { render(); window.scrollTo(0, 0); }); };
  const go = () => { if (after) after(); if (home) back(); else openSwitcher(); };
  const label = home ? "Back to " + open.name : "Client: " + open.name + ". Change client (F3)";
  return <div className="side-client">
    <span className="side-label">Client</span>
    {/* t70: the name on one line with ▾ (change the client; its full name in the title), the GSTIN under it */}
    <button className="side-co" onClick={go} title={(home ? "Back to " : "") + open.name + (home ? "" : " · change client (F3)")} aria-label={label} data-side-client={home ? "back" : "change"}>
      <span className="side-av" aria-hidden="true">{initials(open.name)}</span>
      <span className="side-co-words"><span className="side-co-name"><b>{open.name}</b><span className="side-co-caret" aria-hidden="true">{home ? "↩" : "▾"}</span></span><small>{open.gstin || "No GSTIN"}</small></span>
    </button>
  </div>;
}

function Groups({ groups, after, phone }) {
  return groups.map(([g, items], i) => <div className="side-grp" key={i} data-group={g || undefined}>
    {g === "sep" ? <div className="side-sep" /> : g ? <div className="side-label side-group">{g}</div> : null}
    {/* stability batch 3: the click is seen to be taken (the thin bar under the top bar if the page takes over 300 ms) */}
    {items.map((x) => <Item key={x.label} {...x} bar={phone ? false : x.bar} onClick={() => { if (after) after(); FinComNav.go(x.go); }} />)}
  </div>);
}

// the phone's More: everything not in the bar, as a sheet over the page (styles/arc-shell.css; shown on a phone only)
function MoreSheet({ groups, open, home, close }) {
  // a tap on the dimmed area, Esc and Back close it (parts/dismiss.js); Esc goes no further (it left the client before)
  const sheet = useRef(null);
  useDismiss(true, sheet, close);
  return createPortal(<div className="side-sheet-wrap" data-side-sheet="">
    <button className="side-sheet-back" aria-label="Close the menu" onClick={close} />
    <div ref={sheet} className="side-sheet" role="dialog" aria-label="More">
      <div className="side-sheet-head"><b>More</b><button className="side-fold" onClick={close} aria-label="Close"><X width={16} height={16} aria-hidden="true" /></button></div>
      {open && <ClientCard open={open} home={home} after={close} />}
      {/* the rest: what the bar does not show */}
      <Groups groups={groups.map(([g, items]) => [g, items.filter((x) => !x.bar)]).filter(([, items]) => items.length)} after={close} phone />
    </div>
  </div>, document.body);
}

// "Your data" (stability batch 5, trust signals): where the work is kept and who can see it, in plain words
function yourData() {
  const signed = typeof Cloud === "object" && Cloud.on();
  askConfirm({ title: "Your data", ok: "Close", body:
    "<p><b>Where it is kept.</b> In this browser, on this computer" + (signed ? ", and in your firm’s FinCom account, so the firm’s people can open it on their own computers." : ". It stays on this computer only until you sign in to a firm account (Settings).") + "</p>" +
    "<p><b>Who can see it.</b> " + (signed ? "The people your firm’s owner has added (Settings → People), each with their role. Other firms using FinCom cannot open it." : "Only someone using this browser on this computer.") + "</p>" +
    "<p><b>On a shared computer.</b> " + (signed ? "Sign out when you finish (the firm menu at the top right → Sign out)." : "Use your own Windows account, or sign in to a firm account and sign out when you finish.") + "</p>" +
    "<p><b>Is it saved?</b> The line above today’s date at the foot of this menu says so: “Saved on this computer”" + (signed ? ", and when it was last synced with the firm account." : ".") + "</p>" });
}

// the quiet line: where the work is kept and when it was last synced (a background event of the last ten minutes is in the
// bell since t70, parts/Bell.jsx)
export function FootLine() {
  let t = "Saved on this computer";
  if (typeof Cloud === "object" && Cloud.on()) {
    const st = Cloud.st || {}, sv = (typeof Live === "object" && Live.sv) || {};
    t = sv.state === "offline" || (typeof navigator === "object" && navigator.onLine === false) ? "No internet · work kept on this computer"
      : st.lastSync ? "Synced " + fmtTime(st.lastSync) + " · saved on this computer" : "Saved on this computer · syncing";
  } else {
    // not signed in: the work stays here; one line under it says so and leads to signing in (it was a floating box,
    // "Working on this computer only…", over the sidebar; the coordinator's screenshot review, 14-Oct-2026)
    t += " only" + (typeof navigator === "object" && navigator.onLine === false ? " · no internet" : "");
    const signIn = () => { S.view = "home"; S.homeTab = "rules"; S.settingsTab = "account"; render(); };
    return <><span className="side-quiet side-one" data-trust-line="" title={t}>{t}</span>
      <span className="side-quiet side-one" data-local-only="" title="Working on this computer only. Sign in from Settings to share with the firm.">Not shared · <button type="button" className="linkbtn side-data" aria-label="Sign in: share the work with the firm" onClick={signIn}>Sign in</button></span></>;
  }
  return <span className="side-quiet" data-trust-line="" title={t}>{t}</span>;
}

// the foot in one line: "Saved here · Sign in" (or "Synced 10:42"), ⓘ opens the full words, today's date and Your data
function Foot() {
  const signed = typeof Cloud === "object" && Cloud.on();
  const st = signed ? Cloud.st || {} : {}, sv = (typeof Live === "object" && Live.sv) || {};
  const off = (typeof navigator === "object" && navigator.onLine === false) || sv.state === "offline";
  const short = signed ? (off ? "Offline · kept here" : st.lastSync ? "Synced " + fmtTime(st.lastSync) : "Syncing…") : off ? "Saved here · offline" : "Saved here";
  const signIn = () => { S.view = "home"; S.homeTab = "rules"; S.settingsTab = "account"; render(); };
  return <div className="side-foot" data-side-foot="">
    <span className="side-foot-line"><span data-trust-short="">{short}</span>{!signed && <> · <button type="button" className="linkbtn side-data" aria-label="Sign in: share the work with the firm" onClick={signIn}>Sign in</button></>}</span>
    <details className="side-foot-more">
      <summary aria-label="Where your work is kept, and today's date" title="Where your work is kept, and today's date">ⓘ</summary>
      <div className="side-foot-pop" data-side-foot-more=""><FootLine /><span>Today {fmtDate(new Date())} · <button type="button" className="linkbtn side-data" data-your-data="" aria-label="Your data: where your work is kept and who can see it" onClick={yourData}>Your data</button></span></div>
    </details>
  </div>;
}

export default function Side() {
  const hide = signInNeeded();
  const [folded, setFolded] = useState(readFold);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => { const el = document.getElementById("side"); el.classList.toggle("hidden", hide); el.classList.toggle("side-folded", folded); });
  // the menu swapped under a keyboard user (firm ↔ client): the focus goes to the item of the same name, or the first item
  const mode = S.view === "home" || !(CO() || (S.coId && S.companies[S.coId])) ? "firm" : "client";
  const focusName = useRef(null);
  focusName.current = (() => { const a = document.activeElement; return a && a.closest && a.closest("#side") ? (a.dataset.side || "") : null; })();
  useLayoutEffect(() => {
    const was = focusName.current;
    if (was == null || (document.activeElement && document.activeElement !== document.body)) return;
    const side = document.getElementById("side");
    const el = (was && side.querySelector('.side-link[data-side="' + CSS.escape(was) + '"]')) || side.querySelector(".side-link");
    if (el) el.focus();
  }, [mode]);
  // the sheet closes when the page changes (a link, Back, a key)
  const where = S.view + ":" + S.homeTab + ":" + S.tab + ":" + S.booksTab + ":" + S.coId;
  useEffect(() => { setMore(false); }, [where]);
  const fold = () => { const f = !folded; setFolded(f); try { localStorage.setItem(FOLD, f ? "1" : "0"); } catch (e) { /* kept for this visit only */ } };
  if (hide) return null;

  const co = CO(), open = co || (S.coId && S.companies[S.coId]);
  const home = S.view === "home" || !open;
  const groups = tree();
  const all = groups.flatMap(([, items]) => items), barOn = all.some((x) => x.bar && x.on);
  // stability batch 1: the firm's menu and a client's are two different trees; each is drawn whole (keyed by which one),
  // so going from one to the other replaces the menu in one go instead of sliding the shared items (Help, the separator)
  // up or down. The date line is fixed at the sidebar's foot (steady.css)
  return (
    <div key={home ? "firm" : "client"} className="side-tree" style={{ display: "contents" }}>
      <div className="side-brand"><span className="side-mark" aria-hidden="true">F</span><span className="side-name">FinCom</span>
        <button type="button" className="side-fold" onClick={fold} aria-label={folded ? "Show the menu's words" : "Fold the menu to its icons"} title={folded ? "Show the menu's words" : "Fold the menu to its icons"}>
          {folded ? <PanelLeftOpen width={16} height={16} strokeWidth={1.75} aria-hidden="true" /> : <PanelLeftClose width={16} height={16} strokeWidth={1.75} aria-hidden="true" />}</button></div>
      {open && <ClientCard open={open} home={home} />}
      {home && <div className="side-firm-label">Firm</div>}
      <Groups groups={groups} />
      {/* the phone bar's fifth: More (hidden on a computer, where every item shows) */}
      <button className="side-link side-more" data-bar="" aria-expanded={more} aria-current={!barOn && !more ? "page" : undefined} aria-label="More: every other page"
        onClick={() => setMore(!more)}>
        <i className="side-chip" data-tone="slate" aria-hidden="true"><Ellipsis className="side-ic" width={15} height={15} strokeWidth={2} /></i><span>More</span></button>
      {more && <MoreSheet groups={groups} open={open} home={home} close={() => setMore(false)} />}
      <div className="side-grow" />
      {/* review of 01-Oct-2026: the date here was the build's, read as today's; now each says what it is */}
      {/* the build stamp moved to the About line in Settings (owner's spec K1, 04-Oct-2026) */}
      {/* stability batch 3: the foot of the sidebar, two lines in the same place on every page: where the work is kept
          and when it was last synced, or something that happened by itself (a colleague's change, the server not
          answering: toast(…, {background: true})), then today's date */}
      {/* t70: one small line (where the work is kept, Sign in), the rest under ⓘ */}
      <div className="side-ver" data-side-date=""><Foot /></div>
    </div>
  );
}
