// The sidebar: the open client and its areas, then all clients and help. Was renderSide() in src/js/02-the-layout.js.
// S, CO, docType, ... are the business logic's globals (legacy.js); goClient/navHome/toggleSetup are its navigation.
import { useLayoutEffect } from "react";

const ICONS = {
  dash: <path d="M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-4H4zM14 8h6V4h-6z" />,
  bills: <><path d="M6 3h9l3 3v15H6z" /><path d="M9 9h6M9 13h6M9 17h4" /></>,
  bank: <><path d="M3 10l9-6 9 6" /><path d="M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18" /></>,
  sales: <><path d="M4 17l5-5 4 4 7-7" /><path d="M14 9h6v6" /></>,
  inbox: <><path d="M3 13l3-8h12l3 8v6H3z" /><path d="M3 13h5l1.5 2.5h5L16 13h5" /></>,
  setup: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="8" cy="18" r="2" /></>,
  txn: <><path d="M4 5h16v14H4z" /><path d="M4 9h16M9 9v10" /></>,
  books: <><path d="M5 4h9l5 5v11H5z" /><path d="M13 4v5h5" /><path d="M8 13h7M8 17h5" /></>,
  reports: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  lookup: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /><path d="M8 10.5h5M10.5 8v5" /></>,
  letters: <><path d="M3 6h18v12H3z" /><path d="M3 7l9 6 9-6" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6" /><circle cx="12" cy="17" r=".6" /></>,
  clients: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.6c2.6.2 4.6 1.9 5.3 5.4" /></>,
};

function Item({ icon, label, on, count, onClick, title }) {
  return (
    <button className="side-link" aria-current={on ? "page" : undefined} onClick={onClick} title={title}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{ICONS[icon]}</svg>
      <span>{label}</span>
      {count ? <span className="side-count">{count}</span> : null}
    </button>
  );
}

export default function Side() {
  const hide = signInNeeded();
  useLayoutEffect(() => { document.getElementById("side").classList.toggle("hidden", hide); });
  if (hide) return null;

  const co = CO(), inCo = S.view === "company" && !!co, open = co || (S.coId && S.companies[S.coId]);
  const st = open ? open.stats || {} : {};
  const mod = inCo ? docType() : "", onDash = inCo && S.tab === "dash", bt = inCo && S.tab === "books" ? booksTab() : "";
  const home = S.view === "home";
  return (
    <>
      <div className="side-brand">FinCom</div>
      {open && (
          <div className="side-client">
            <span className="side-label">Client</span>
            <button className="side-co" onClick={() => openSwitcher()} title="Change client (F3)">
              <b>{open.name}</b><small>{(open.gstin || "No GSTIN") + " · change"}</small>
            </button>
          </div>)}
      {/* on the firm's own pages, the firm's menu instead of a client's (review item 29) */}
      {home && <>
        <div className="side-firm-label">Firm</div>
        <Item icon="clients" label="Clients" on={["clients", "today", "inbox"].includes(S.homeTab)} onClick={() => navHome("clients")} />
        <Item icon="clients" label="People" on={S.homeTab === "rules" && S.settingsTab === "account"} onClick={() => goSettings("account")} />
        <Item icon="reports" label="Plan and credit" on={S.homeTab === "rules" && S.settingsTab === "plan"} onClick={() => goSettings("plan")} />
        <Item icon="books" label="Tally" on={S.homeTab === "tally"} onClick={() => navHome("tally")} />
        <Item icon="setup" label="Settings" on={S.homeTab === "rules" && !["account", "plan"].includes(S.settingsTab)} onClick={() => goSettings(null)} />
      </>}
      {open && !home && (
        <>
          <Item icon="dash" label="Dashboard" on={onDash} onClick={() => goClient("dash")} />
          <Item icon="bills" label="Purchase" count={st.drafts || 0} onClick={() => goClient("bills")}
            on={inCo && mod === "bills" && !onDash && !isSetupTab(S.tab) && !["clientInbox", "txn", "books"].includes(S.tab)} />
          <Item icon="bank" label="Bank" on={inCo && mod === "bank" && !isSetupTab(S.tab)} onClick={() => goClient("bank")}
            count={S.bank && S.bank.cid === open.id ? tabCounts(S.bank.rows).review : 0} />
          <Item icon="sales" label="Sales" on={inCo && mod === "sales" && !isSetupTab(S.tab)} onClick={() => goClient("sales")} />
          <Item icon="inbox" label="Inbox" on={inCo && S.tab === "clientInbox"} count={docqCount(open.id)} onClick={() => goClient("inbox")} />
          <Item icon="txn" label="Transactions" on={inCo && S.tab === "txn"} onClick={() => goClient("txn")} />
          <Item icon="books" label="TDS & GST" on={!!bt && !BOOKS_OWN_PAGES.includes(bt)} onClick={() => goClient("books")} />
          <Item icon="reports" label="Reports" on={bt === "reports"} onClick={() => goClient("books:reports")} />
          <Item icon="reports" label="MIS" on={bt === "mis"} onClick={() => goClient("books:mis")} title="Management reports from the books" />
          <Item icon="books" label="Accounts" on={bt === "fs"} onClick={() => goClient("books:fs")} title="Financial statements" />
          <Item icon="lookup" label="Audit" on={bt === "audit"} onClick={() => goClient("books:audit")} title="Checks over the books" />
          <Item icon="lookup" label="Look up" on={bt === "lookup"} onClick={() => goClient("books:lookup")} title="Any ledger, any dates (press /)" />
          <Item icon="letters" label="Letters" on={bt === "letters"} onClick={() => goClient("books:letters")} title="Balance confirmations and dues reminders" />
          <Item icon="setup" label="Client setup" on={inCo && isSetupTab(S.tab)} onClick={() => toggleSetup()} />
        </>
      )}
      <div className="side-sep" />
      {!home && <Item icon="clients" label="All clients" on={false} onClick={() => navHome("clients")} />}
      <Item icon="help" label="Help" on={home && S.homeTab === "help"} count={typeof SUP === "object" ? SUP.counts() : 0} onClick={() => navHome("help")} />
      <div className="side-grow" />
      <div className="side-ver">{APP_VERSION.split("·")[1] || APP_VERSION}<br />{__REACT_BUILD__}</div>
    </>
  );
}
