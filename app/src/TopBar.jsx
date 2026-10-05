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
// one name for one thing (spec K1): each page is called what the sidebar calls it
const BOOKS_TITLES = { reports: "Reports", lookup: "Look up", letters: "Letters", mis: "MIS", fs: "Accounts", audit: "Audit" };
const DOC_NAMES = { bills: "Purchase", bank: "Bank", sales: "Sales" };

function Title({ title, sub, children }) {
  return (
    <div className="tbar">
      <div className="tbar-title"><h2>{title}</h2><span className="note">{sub}</span></div>
      {children}
    </div>
  );
}

// the one main button of each page (review item 27): what the page is for. One Upload (spec I, 04-Oct-2026): on every
// page that uploads (Purchase, Bank, Sales, Day Book) the page's Upload is here, in the same place, and nowhere else
const UPLOADS = {
  bills: ["Upload bills", "Upload purchase bills (PDF, photo) for this client", () => doAct("uploadHere")],
  bank: ["Upload statement", "Upload a bank statement (Excel, CSV, PDF) for this client", () => doAct("uploadHere")],
  sales: ["Upload invoices", "Upload the sales invoices this client issued (PDF, photo)", () => salesAct("salesPick")],
  daybook: ["Upload Day Book", "Upload the Day Book exported from Tally as XML (the dates on the page, if chosen, limit it)", () => doAct("booksPick")],
};
export function uploadKind() {
  if (S.view !== "company" || !CO() || isSetupTab(S.tab)) return "";
  const t = docType(), bt = S.tab === "books" ? booksTab() : "";
  if (["invoices", "export", "done"].includes(S.tab) && t === "bills") return "bills";
  if (S.tab === "bank") return "bank";
  if (S.tab === "sales") return "sales";
  if (S.tab === "books" && bt === "import") return "daybook";
  return "";
}
function MainAction() {
  const bt = S.tab === "books" ? booksTab() : "", up = uploadKind();
  // one primary a page (spec K2): the review table's own Approve is its primary, so Upload is a plain button there
  const own = up === "bills" && S.tab === "invoices" && S.reviewTable && S.filter === "draft";
  if (up) { const [label, title, go] = UPLOADS[up]; return <button className={"btn small" + (own ? "" : " primary")} data-upload={up} title={title} onClick={go}>{label}</button>; }
  if (bt === "letters") return <button className="btn small" onClick={() => ltrMode("confirm")}>New confirmation</button>;   // the letters' own Print is the page's primary
  // while the copy of the books is empty, "Read the books from Tally" on the page is its one primary (one primary in every state)
  if (bt === "reports") return <button className={"btn small" + (S.books && (S.books.vouchers || []).length ? " primary" : "")} onClick={() => doAct("keepNow")}>Refresh books</button>;
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
        {setup && <button className="btn small" onClick={() => toggleSetup()}>Back to the work</button>}
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

// Saving shows only when it matters (spec H3): "Saving…" while saving, "Not saved: <reason>" in red on a failure (a click
// opens Settings → Sign-in), nothing when all is saved. No cloud sign and no "live" (54-live-sync.js keeps doing its work).
function saveWhy(err, fallback) { const p = typeof plainError === "function" ? plainError(err) : null; return p ? p.text : String(err || "").trim() || fallback; }
function SaveState() {
  if (!Cloud.on()) return null;
  const st = Cloud.st || {}, sv = Live.sv || {};
  const bad = (kind, why, title) => <button className="tsave bad" data-save={kind} title={title || why} onClick={() => doAct("openSettings")}>{"Not saved: " + why}</button>;
  if (st.state === "signedout") return bad("signedout", "you are signed out. Sign in again to save your work to the firm account.");
  if (sv.state === "offline") return bad("offline", "no internet on this computer. Your changes are kept here and saved when it is back.", sv.err || "");
  if (sv.state === "error") return bad("error", saveWhy(sv.err, "the server did not take the change. It is kept here and sent again on its own."), sv.err || "");
  if (st.error) return bad("error", saveWhy(st.error, "the firm account could not be reached."), st.error);
  if (sv.state === "saving" || st.busy) return <span className="tsave" data-save="saving">Saving…</span>;
  return null;
}

// "N entries need review" (spec H4): the count of Post to Tally → Errors (postTabCounts, src/js/59), a link to that tab;
// hidden at zero and on the firm's own pages
function ReviewLink() {
  const co = S.view === "company" ? CO() : null;
  if (!co || typeof postTabCounts !== "function") return null;
  let n = 0; try { n = num(postTabCounts(co.id).errors); } catch (e) { n = 0; }
  if (!n) return null;
  const go = () => { S.postTabs = S.postTabs || {}; S.postTabs[co.id] = "errors"; goStep("post", "bills"); };
  return <button className="treview" data-review-link="" title="Open Post to Tally → Errors" onClick={go}>{n + (n === 1 ? " entry needs review" : " entries need review")}</button>;
}

// the one Tally sign (spec H1, H2): green "Tally connected" / red "Tally disconnected" (tallySign, src/js/49); the detail
// on hover, and in the Tally panel on a click
export function TallyDetail({ s }) {
  return <dl className="tdetail" data-tally-detail="" data-tally-reason={s.on ? "" : s.code}>
    <dt>Computer</dt><dd>{s.computer || "none heard from"}</dd>
    <dt>Company</dt><dd>{s.company || "\u2014"}</dd>
    <dt>Last contact</dt><dd>{s.at || "never"}</dd>
    {!s.on && <><dt>Why</dt><dd className="why">{s.reason}</dd><dt>What to do</dt><dd>{s.fix}</dd></>}
  </dl>;
}
function TallySign() {
  const co = S.view === "company" ? CO() : null, s = tallySign(co), t = tallyStatus(co);
  return <span className="tsign-wrap">
    <button className={"tsign tallychip " + (s.on ? "on" : "off")} data-tally-sign={s.on ? "on" : "off"} data-tally={t.state} aria-haspopup="dialog"
      title={tallySignWords(s)} onClick={() => doAct("tallyPanel")}>
      <span className="tsign-dot" aria-hidden="true" />{s.on ? "Tally connected" : "Tally disconnected"}
    </button>
    {!S.tallyPanel && <span className="tsign-pop" role="tooltip"><TallyDetail s={s} /></span>}
  </span>;
}

function TopRight() {
  const bal = accountBalance(), plan = S.account && S.account.firm ? planName(S.account.firm.plan) : "";
  const inCo = S.view === "company" && CO();
  return (
    <div className="topright">
      {inCo && <HelpButton page />}
      <ReviewLink />
      <SaveState />
      <TallySign />
      <button className="firmbtn" onClick={() => doAct("firmMenu")} title={(S.firm.firmName || "Firm") + (plan ? " · plan " + plan : "") + (bal != null ? " · credit " + money(bal) : "")}>
        <b>{(S.firm.firmName || "Firm").slice(0, 26)}</b>
        {bal != null ? <small data-credit="">{moneyShort(bal) + " credit"}</small> : plan ? <small>{plan}</small> : null}
      </button>
      {/* the page's one primary action, always at the far right, in the same place on every page (spec I, K2) */}
      {inCo && !isSetupTab(S.tab) && <MainAction />}
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
        <TallyDetail s={tallySign(co)} />
        <p><TallyPill co={co} /></p>{co && typeof tallyLine === "function" && tallyLine(co) && <p data-panel-tally-line=""><TallyLine co={co} /></p>}<p className="note">{tallyStatus(co).say}</p>
        <TallyStates co={co} />
        {Bridge.on() ? <>
          <p><span className={"dotled " + (live ? "live" : "off")} /><b>{live ? (st.shaky ? "Reconnecting…" : "Connected") : "Not answering"}</b>{st.version && <span className="note"> · FinCom Bridge {st.version}</span>}</p>
          {co && <p className="note">{(Bridge.openFor(co) || {}).name ? Bridge.openFor(co).name + " is open in Tally." : (co.tallyName || co.name) + " is not open in Tally."}</p>}
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
    {createPortal(S.firm.firmName || "", document.getElementById("firmLine"))}
    {createPortal(
      <div className="headrow">
        {inCo ? <ClientHeader /> : <Title title={HOME_TITLES[S.homeTab] || "Clients"} sub={S.firm.firmName || ""} />}
        <TopRight />
      </div>, document.getElementById("cobar"))}
    {S.tallyPanel && !hide && <TallyPanel />}
    {S.firmMenu && !hide && <FirmMenu />}
  </>;
}
