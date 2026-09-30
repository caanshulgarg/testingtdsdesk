// The top bar: the page title (client header with its status tabs, or the home screen's name), the Tally chip, the
// firm account chip and the firm button, with the Tally panel and firm menu they open.
// Was renderTop, clientHeader, topRight, tallyPanelHtml, firmMenuHtml (src/js/02 and 18); actions are doAct(...).
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";

const HOME_TITLES = { clients: "Clients", today: "Today", inbox: "Inbox", tally: "Tally", rules: "Settings", help: "Help" };
const BOOKS_TITLES = { reports: "Reports", lookup: "Look up", letters: "Confirmations and reminders" };
const DOC_NAMES = { bills: "Purchase bills", bank: "Bank", sales: "Sales invoices" };

function Title({ title, sub, children }) {
  return (
    <div className="tbar">
      <div className="tbar-title"><h2>{title}</h2><span className="note">{sub}</span></div>
      {children}
    </div>
  );
}

function ClientHeader() {
  const co = CO(), setup = isSetupTab(S.tab), t = docType(), inbox = docqCount(S.coId);
  const title = S.tab === "dash" ? "Dashboard" : S.tab === "clientInbox" ? "Inbox" : S.tab === "txn" ? "Transactions"
    : S.tab === "books" ? BOOKS_TITLES[booksTab()] || "TDS & GST from the books" : setup ? "Client setup" : DOC_NAMES[t];
  const head = (
    <Title title={title} sub={co.name}>
      <div className="tbar-actions">
        {inbox > 0 && !setup && S.tab !== "clientInbox" && <button className="btn small" onClick={() => goStep("collect")}>{"\u{1F4E5} " + inbox + " in inbox"}</button>}
        {setup ? <button className="btn small" onClick={() => toggleSetup()}>Back to the work</button>
          : t !== "sales" && <button className="btn primary small" onClick={() => doAct("uploadHere")}>{t === "bank" ? "Upload statement" : "Upload bills"}</button>}
      </div>
    </Title>
  );
  if (["dash", "clientInbox", "txn", "books"].includes(S.tab)) return head;
  if (setup) return head;   // its sections are listed on the left of the page (screens/Settings.jsx)
  // sales and the bank page have their own tabs
  if ((t === "sales" && S.tab === "sales") || (t === "bank" && S.tab === "bank")) return head;
  const now = curStep(), c = stepCounts(), n = (x) => (String(x || "").match(/\d+/) || [""])[0];
  return <>{head}<nav className="sbar" aria-label="Status">
    {[["review", "To review", n(c.review)], ["post", "Ready to post", n(c.post)], ["done", "Posted", n(c.done)]].map(([id, label, k]) =>
      <button key={id} aria-selected={now === id} onClick={() => goStep(id)}>{label}{k !== "" && <> <span className="sbar-n">{k}</span></>}</button>)}
  </nav></>;
}

function CloudChip() {
  if (!Cloud.on()) return null;
  const st = Cloud.st;
  if (st.busy) return <span className="tchip off">Syncing…</span>;
  if (st.state === "signedout") return <button className="tchip bad" onClick={() => doAct("openSettings")}>Sign in again</button>;
  if (st.error) return <button className="tchip warn" onClick={() => doAct("openSettings")} title={st.error}>Sync problem</button>;
  const mins = st.lastSync ? Math.round((Date.now() - st.lastSync) / 60000) : null;
  const title = st.email + (st.lastSync ? " · last sync " + new Date(st.lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
  return <span className="tchip ok" title={title}>{"☁ Shared" + (mins > 5 ? " · " + mins + "m" : "")}</span>;
}

function TopRight() {
  const bal = accountBalance(), plan = S.account && S.account.firm ? planName(S.account.firm.plan) : "";
  const live = bridgeLive(S.view === "company" ? CO() : null), on = Bridge.on();
  return (
    <div className="topright">
      <button className={"tallychip" + (live ? " live" : on ? " off" : " none")} onClick={() => doAct("tallyPanel")} title="Tally connection">
        <span className="dotled" />Tally{live ? "" : on ? ": not answering" : ": not set up"}
      </button>
      <CloudChip />
      <button className="firmbtn" onClick={() => doAct("firmMenu")}>
        <b>{(S.firm.firmName || "Firm").slice(0, 26)}</b>
        {(plan || bal != null) && <small>{plan + (bal != null ? (plan ? " · " : "") + "credit " + INR.format(bal) : "")}</small>}
      </button>
    </div>
  );
}

function TallyPanel() {
  const co = S.view === "company" ? CO() : null, live = bridgeLive(co), st = Bridge.st || {};
  const close = () => doAct("tallyPanelClose");
  return <>
    <button className="menu-scrim" onClick={close} aria-label="Close" />
    <div className="tallypanel" role="dialog" aria-label="Tally connection">
      <div className="fm-head"><b>Tally connection</b><button className="icon" onClick={close} aria-label="Close">✕</button></div>
      <div className="tp-body">
        {Bridge.on() ? <>
          <p><span className={"dotled " + (live ? "live" : "off")} /><b>{live ? "Connected" : "Not answering"}</b>{st.version && <span className="note"> · bridge {st.version}</span>}</p>
          {co && <p className="note">{Bridge.openFor(co).name ? Bridge.openFor(co).name + " is open in Tally." : (co.tallyName || co.name) + " is not open in Tally."}</p>}
          {!live && <p className="note">Open TallyPrime on the computer where the bridge runs, and keep the company open.</p>}
        </> : <p className="note">The Tally Bridge is not set up on this computer. Install it on the computer where TallyPrime runs, then come back here.</p>}
      </div>
      <div className="tp-foot">
        <button className="btn small" onClick={() => doAct("tallyGuide")}>Connection guide</button>
        <button className="btn small" onClick={() => navHome("tally")}>Everything sent to Tally</button>
      </div>
    </div>
  </>;
}

function FirmMenu() {
  const a = S.account, bal = accountBalance();
  return <>
    <button className="menu-scrim" onClick={() => doAct("firmMenuClose")} aria-label="Close" />
    <div className="firmmenu" role="menu">
      <div className="fm-head"><b>{S.firm.firmName || "Firm"}</b>{a && a.me && <span className="note">{(a.me.email || "") + " · " + (a.me.role || "")}</span>}</div>
      {a && a.firm && <div className="fm-plan"><span>{planName(a.firm.plan) || "Plan"}</span>{bal != null && <b>credit {INR.format(bal)}</b>}</div>}
      <button className="fm-item" onClick={() => doAct("openSettings")}>Settings</button>
      <button className="fm-item" onClick={() => navHome("tally")}>Tally: everything sent</button>
      <button className="fm-item" onClick={() => navHome("inbox")}>Inbox for all clients</button>
      <button className="fm-item" onClick={() => navHome("clients")}>All clients</button>
      {Cloud.on() && <button className="fm-item" onClick={() => doAct("signOutNow")}>Sign out</button>}
    </div>
  </>;
}

export default function TopBar() {
  const hide = signInNeeded();
  useLayoutEffect(() => { const top = document.querySelector("header.top"); if (top) top.style.display = hide ? "none" : ""; });
  const inCo = S.view === "company" && CO();
  return <>
    {createPortal((S.firm.firmName || "") + " · " + APP_VERSION, document.getElementById("firmLine"))}
    {createPortal(
      <div className="headrow">
        {inCo ? <ClientHeader /> : <Title title={HOME_TITLES[S.homeTab] || "Clients"} sub={S.firm.firmName || ""} />}
        <TopRight />
      </div>, document.getElementById("cobar"))}
    {S.tallyPanel && !hide && <TallyPanel />}
    {S.firmMenu && !hide && <FirmMenu />}
  </>;
}
