// The sidebar: the open client and its areas, then all clients and help. Was renderSide() in src/js/02-the-layout.js.
// S, CO, docType, ... are the business logic's globals (legacy.js); goClient/navHome/toggleSetup are its navigation.
import { useLayoutEffect, useState } from "react";
// Arc UI (arc-ui, 09-Oct-2026): the sidebar in Arc's look (styles/arc-shell.css): a light surface, Lucide icons as
// Arc's components use, quiet section labels, the open client as a card, and on a computer a button that folds the
// sidebar to its icons (remembered on this computer). On a phone it stays the bar along the bottom.
import { ArrowLeftRight, BookOpen, ChartColumn, CircleHelp, Inbox, LayoutDashboard, Landmark, Mail, PanelLeftClose, PanelLeftOpen,
  ReceiptText, Search, SlidersHorizontal, TrendingUp, Users, FileSearch } from "lucide-react";

const ICONS = { dash: LayoutDashboard, bills: ReceiptText, bank: Landmark, sales: TrendingUp, inbox: Inbox, setup: SlidersHorizontal,
  txn: ArrowLeftRight, books: BookOpen, reports: ChartColumn, lookup: Search, audit: FileSearch, letters: Mail, help: CircleHelp, clients: Users };
// each area its own colour (the owner, 09-Oct-2026: "some bright colours"), the accents of styles/arc-tokens.css
const TONES = { dash: "indigo", bills: "amber", bank: "sky", sales: "emerald", inbox: "violet", setup: "slate", txn: "teal", books: "violet",
  reports: "teal", lookup: "sky", audit: "rose", letters: "amber", help: "sky", clients: "indigo" };

function Item({ icon, label, on, count, onClick, title }) {
  const Icon = ICONS[icon] || LayoutDashboard;
  return (
    // a name a screen reader reads out (review item 34): the label, what it is for, and the count beside it
    <button className="side-link" aria-current={on ? "page" : undefined} onClick={onClick} title={title || label}
      aria-label={label + (title ? ": " + title : "") + (count ? ", " + count + " waiting" : "")}>
      <i className="side-chip" data-tone={TONES[icon] || "indigo"} aria-hidden="true"><Icon className="side-ic" width={15} height={15} strokeWidth={2} /></i>
      <span>{label}</span>
      {count ? <span className="side-count">{count}</span> : null}
    </button>
  );
}

const FOLD = "fincom:sideFolded";
const readFold = () => { try { return localStorage.getItem(FOLD) === "1"; } catch (e) { return false; } };
const initials = (name) => String(name || "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

export default function Side() {
  const hide = signInNeeded();
  const [folded, setFolded] = useState(readFold);
  useLayoutEffect(() => { const el = document.getElementById("side"); el.classList.toggle("hidden", hide); el.classList.toggle("side-folded", folded); });
  const fold = () => { const f = !folded; setFolded(f); try { localStorage.setItem(FOLD, f ? "1" : "0"); } catch (e) { /* kept for this visit only */ } };
  if (hide) return null;

  const co = CO(), inCo = S.view === "company" && !!co, open = co || (S.coId && S.companies[S.coId]);
  const st = open ? open.stats || {} : {};
  const mod = inCo ? docType() : "", onDash = inCo && S.tab === "dash", bt = inCo && S.tab === "books" ? booksTab() : "";
  const home = S.view === "home";
  return (
    <>
      <div className="side-brand"><span className="side-mark" aria-hidden="true">F</span><span className="side-name">FinCom</span>
        <button type="button" className="side-fold" onClick={fold} aria-label={folded ? "Show the menu's words" : "Fold the menu to its icons"} title={folded ? "Show the menu's words" : "Fold the menu to its icons"}>
          {folded ? <PanelLeftOpen width={16} height={16} strokeWidth={1.75} aria-hidden="true" /> : <PanelLeftClose width={16} height={16} strokeWidth={1.75} aria-hidden="true" />}</button></div>
      {open && (
          <div className="side-client">
            <span className="side-label">Client</span>
            <button className="side-co" onClick={() => openSwitcher()} title="Change client (F3)" aria-label={"Client: " + open.name + ". Change client (F3)"}>
              <span className="side-av" aria-hidden="true">{initials(open.name)}</span><span className="side-co-words"><b>{open.name}</b><small>{(open.gstin || "No GSTIN") + " · change"}</small></span>
            </button>
          </div>)}
      {/* on the firm's own pages, the firm's menu instead of a client's (review item 29) */}
      {home && <>
        {/* one way back to the open client from a firm page (round 4 of the UI pass and the Tally redesign, 09-Oct-2026,
            merged into one item on arc-ui): backToClient (src/js/52) opens the client's page last shown, else its dashboard */}
        {open && <Item icon="dash" label={"\u2190 Back to " + open.name}
          onClick={() => { S.firmMenu = false; S.tallyPanel = false; if (typeof backToClient === "function") backToClient(); else openCompany(open.id).then(() => { render(); window.scrollTo(0, 0); }); }} />}
        <div className="side-firm-label">Firm</div>
        <Item icon="clients" label="Clients" on={["clients", "today", "inbox"].includes(S.homeTab)} onClick={() => navHome("clients")} />
        <Item icon="clients" label="People" on={S.homeTab === "rules" && S.settingsTab === "account"} onClick={() => goSettings("account")} />
        <Item icon="reports" label="Plan and credit" on={S.homeTab === "rules" && S.settingsTab === "plan"} onClick={() => goSettings("plan")} />
        <Item icon="books" label="Tally" on={S.homeTab === "tally"} onClick={() => { S.tallyFocus = ""; navHome("tally"); }} />
        <Item icon="setup" label="Settings" on={S.homeTab === "rules" && !["account", "plan"].includes(S.settingsTab)} onClick={() => goSettings(null)} />
      </>}
      {open && !home && (
        <>
          <div className="side-label side-group">Work</div>
          <Item icon="dash" label="Dashboard" on={onDash} onClick={() => goClient("dash")} />
          <Item icon="bills" label="Purchase" count={st.drafts || 0} onClick={() => goClient("bills")}
            on={inCo && mod === "bills" && !onDash && !isSetupTab(S.tab) && !["clientInbox", "txn", "books"].includes(S.tab)} />
          <Item icon="bank" label="Bank" on={inCo && mod === "bank" && !isSetupTab(S.tab)} onClick={() => goClient("bank")}
            count={S.bank && S.bank.cid === open.id ? tabCounts(S.bank.rows).review : 0} />
          <Item icon="sales" label="Sales" on={inCo && mod === "sales" && !isSetupTab(S.tab)} onClick={() => goClient("sales")} />
          <Item icon="inbox" label="Inbox" on={inCo && S.tab === "clientInbox"} count={docqCount(open.id)} onClick={() => goClient("inbox")} />
          <Item icon="txn" label="Transactions" on={inCo && S.tab === "txn"} onClick={() => goClient("txn")} />
          <div className="side-label side-group">Books</div>
          <Item icon="books" label="TDS & GST" on={!!bt && !BOOKS_OWN_PAGES.includes(bt)} onClick={() => goClient("books")} />
          <Item icon="reports" label="Reports" on={bt === "reports"} onClick={() => goClient("books:reports")} />
          <Item icon="reports" label="MIS" on={bt === "mis"} onClick={() => goClient("books:mis")} title="Management reports from the books" />
          <Item icon="books" label="Accounts" on={bt === "fs"} onClick={() => goClient("books:fs")} title="Financial statements" />
          <Item icon="audit" label="Audit" on={bt === "audit"} onClick={() => goClient("books:audit")} title="Checks over the books" />
          <Item icon="lookup" label="Look up" on={bt === "lookup"} onClick={() => goClient("books:lookup")} title="Any ledger, any dates (press /)" />
          <Item icon="letters" label="Letters" on={bt === "letters"} onClick={() => goClient("books:letters")} title="Balance confirmations and dues reminders" />
          <Item icon="setup" label="Client setup" on={inCo && isSetupTab(S.tab)} onClick={() => toggleSetup()} />
        </>
      )}
      <div className="side-sep" />
      {!home && <Item icon="clients" label="All clients" on={false} onClick={() => navHome("clients")} />}
      <Item icon="help" label="Help" on={home && S.homeTab === "help"} count={typeof SUP === "object" ? SUP.counts() : 0} onClick={() => navHome("help")} />
      <div className="side-grow" />
      {/* review of 01-Oct-2026: the date here was the build's, read as today's; now each says what it is */}
      {/* the build stamp moved to the About line in Settings (owner's spec K1, 04-Oct-2026) */}
      <div className="side-ver" data-side-date=""><span>Today {fmtDate(new Date())}</span></div>
    </>
  );
}
