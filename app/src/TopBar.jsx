// The top bar: the page title (client header with its status tabs, or the home screen's name), the Tally chip, the
// firm account chip and the firm button, with the Tally panel and firm menu they open.
// Was renderTop, clientHeader, topRight, tallyPanelHtml, firmMenuHtml (src/js/02 and 18); actions are doAct(...).
import TallyPill from "./parts/TallyPill.jsx";
import TallyLine from "./parts/TallyLine.jsx";
import { TallyStates } from "./parts/TallyStates.jsx";
import HelpButton from "./parts/HelpButton.jsx";
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";

const HOME_TITLES = { clients: "Clients", today: "Today", inbox: "Inbox", tally: "Tally", rules: "Settings", help: "Help" };
const BOOKS_TITLES = { reports: "Reports", lookup: "Look up", letters: "Confirmations and reminders", mis: "MIS", fs: "Accounts", audit: "Audit" };
const DOC_NAMES = { bills: "Purchase bills", bank: "Bank", sales: "Sales invoices" };

function Title({ title, sub, children }) {
  return (
    <div className="tbar">
      <div className="tbar-title"><h2>{title}</h2><span className="note">{sub}</span></div>
      {children}
    </div>
  );
}

// the one main button of each page (review item 27): what the page is for; uploading from anywhere else is the
// "+ Upload" in the top bar
function MainAction() {
  const t = docType(), bt = S.tab === "books" ? booksTab() : "";
  if (["invoices", "export", "done"].includes(S.tab) && t === "bills") return <button className="btn primary small" onClick={() => doAct("uploadHere")}>Upload bills</button>;
  if (S.tab === "bank") return <button className="btn primary small" onClick={() => doAct("uploadHere")}>Upload statement</button>;
  if (bt === "letters") return <button className="btn primary small" onClick={() => ltrMode("confirm")}>New confirmation</button>;
  if (bt === "reports") return <button className="btn primary small" onClick={() => doAct("keepNow")}>Refresh books</button>;
  return null;
}

function ClientHeader() {
  const co = CO(), setup = isSetupTab(S.tab), t = docType(), inbox = docqCount(S.coId);
  const title = S.tab === "dash" ? "Dashboard" : S.tab === "clientInbox" ? "Inbox" : S.tab === "txn" ? "Transactions"
    : S.tab === "books" ? BOOKS_TITLES[booksTab()] || "TDS & GST" : setup ? "Client setup" : DOC_NAMES[t];
  const head = (
    <Title title={title} sub={co.name}>
      <div className="tbar-actions">
        {inbox > 0 && !setup && S.tab !== "clientInbox" && <button className="btn small" onClick={() => goStep("collect")}>{"\u{1F4E5} " + inbox + " in inbox"}</button>}
        {setup ? <button className="btn small" onClick={() => toggleSetup()}>Back to the work</button> : <MainAction />}
      </div>
    </Title>
  );
  if (["dash", "clientInbox", "txn", "books"].includes(S.tab)) return head;
  if (setup) return head;   // its sections are listed on the left of the page (screens/Settings.jsx)
  // sales and the bank page have their own tabs
  if ((t === "sales" && S.tab === "sales") || (t === "bank" && S.tab === "bank")) return head;
  const now = curStep(), c = stepCounts(), n = (x) => (String(x || "").match(/\d+/) || [""])[0];
  // purchase bills: one row of tabs (review of 02-Oct-2026: a second row under it repeated "To review"): the three steps,
  // then the bills held as duplicates, deleted, or needing no entry
  const bills = t === "bills", ents = bills && typeof D === "function" && D() ? Object.values(D().entries || {}) : [], cnt = (st) => ents.filter((e) => e.status === st).length;
  const side = bills ? [["duplicate", "Duplicates"], ["deleted", "Deleted"]].concat(cnt("rejected") ? [["rejected", "No entry"]] : []) : [];
  const onSide = bills && S.tab === "invoices" && side.some(([id]) => id === S.filter);
  const goSide = (id) => { S.step = null; S.tab = "invoices"; S.filter = id; S.selected = null; S.drawerOpen = false; S.reviewTable = false; render(); window.scrollTo(0, 0); };
  return <>{head}<nav className="sbar" aria-label="Status" data-bill-filters={bills ? "" : undefined}>
    {[["review", "To review", n(c.review)], ["post", "Post to Tally", n(c.post)], ["done", "In Tally", n(c.done)]].map(([id, label, k]) =>
      <button key={id} aria-selected={now === id && !onSide} onClick={() => goStep(id)} data-step={id}>{label}{k !== "" && <> <span className="sbar-n" data-step-n="">{k}</span></>}
        {id === "post" && c.postAttention > 0 && <> <span className="sbar-n attn" data-attn-n="" title={c.postAttention + " need" + (c.postAttention === 1 ? "s" : "") + " your attention"}>{c.postAttention}</span></>}</button>)}
    {side.map(([id, label]) => <button key={id} aria-selected={onSide && S.filter === id} onClick={() => goSide(id)}>{label} <span className="sbar-n">{cnt(id)}</span></button>)}
  </nav></>;
}

function CloudChip() {
  if (!Cloud.on()) return null;
  const st = Cloud.st, sv = Live.sv;
  // live sync (54-live-sync.js): Saving…, Saved 14:05, or offline; "live" while changes by others come in at once
  if (st.state !== "signedout" && sv.state === "offline") return <span className="tchip warn" data-save="offline" title="Changes are kept on this computer and sent when it is back online">Offline · changes kept here</span>;
  if (sv.state === "saving") return <span className="tchip off" data-save="saving">Saving…</span>;
  if (st.busy) return <span className="tchip off">Syncing…</span>;
  if (st.state === "signedout") return <button className="tchip bad" onClick={() => doAct("openSettings")}>Sign in again</button>;
  if (st.error) return <button className="tchip warn" onClick={() => doAct("openSettings")} title={st.error}>Sync problem</button>;
  const mins = st.lastSync ? Math.round((Date.now() - st.lastSync) / 60000) : null;
  const title = st.email + (st.lastSync ? " · last sync " + fmtTime(st.lastSync) : "");
  return <span className="tchip ok" title={title + (Live.st === "live" ? " · changes by others appear at once" : "")} data-save={sv.at ? "saved" : ""} data-live={Live.st}>
    {"☁ " + (sv.at ? "Saved " + fmtTime(sv.at) : "Shared" + (mins > 5 ? " · " + mins + "m" : "")) + (Live.st === "live" ? " · live" : "")}</span>;
}

function TopRight() {
  const bal = accountBalance(), plan = S.account && S.account.firm ? planName(S.account.firm.plan) : "";
  const t = tallyStatus(S.view === "company" ? CO() : null);
  const inCo = S.view === "company" && CO();
  return (
    <div className="topright">
      {inCo && <HelpButton page />}
      {inCo && <button className="btn small" title="Upload bills, statements or sales invoices for this client" onClick={() => goStep("collect")}>+ Upload</button>}
      <button className={"tallychip" + (t.level === "ok" ? " live" : t.level === "warn" ? " off" : " none")} onClick={() => doAct("tallyPanel")} title={(inCo && typeof tallyLine === "function" && tallyLine(CO()) ? tallyLine(CO()).text + " \u2014 " : "") + "Tally: " + t.label + " \u2014 " + t.say} data-tally={t.state}>
        <span className="dotled" />{t.short}
      </button>
      <CloudChip />
      <button className="firmbtn" onClick={() => doAct("firmMenu")} title={(S.firm.firmName || "Firm") + (plan ? " · plan " + plan : "") + (bal != null ? " · credit " + money(bal) : "")}>
        <b>{(S.firm.firmName || "Firm").slice(0, 26)}</b>
        {bal != null ? <small data-credit="">{moneyShort(bal) + " credit"}</small> : plan ? <small>{plan}</small> : null}
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
        <p><TallyPill co={co} /></p>{co && typeof tallyLine === "function" && tallyLine(co) && <p data-panel-tally-line=""><TallyLine co={co} /></p>}<p className="note">{tallyStatus(co).say}</p>
        <TallyStates co={co} />
        {Bridge.on() ? <>
          <p><span className={"dotled " + (live ? "live" : "off")} /><b>{live ? (st.shaky ? "Reconnecting…" : "Connected") : "Not answering"}</b>{st.version && <span className="note"> · FinCom Bridge {st.version}</span>}</p>
          {co && <p className="note">{Bridge.openFor(co).name ? Bridge.openFor(co).name + " is open in Tally." : (co.tallyName || co.name) + " is not open in Tally."}</p>}
          {!live && <p className="note">Open TallyPrime on the computer where the bridge runs, and keep the company open.</p>}
        </> : <p className="note">FinCom Bridge is not set up on this computer. Install FinCom Bridge from the Tally page on the computer where TallyPrime runs, then come back here.</p>}
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
      {a && a.firm && <div className="fm-plan"><span>{planName(a.firm.plan) || "Plan"}</span>{bal != null && <b>credit {money(bal)}</b>}</div>}
      <button className="fm-item" onClick={() => doAct("openSettings")}>Settings</button>
      <button className="fm-item" onClick={() => navHome("tally")}>Tally <TallyPill prefix="" /></button>
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
