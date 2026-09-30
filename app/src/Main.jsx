// The page's main part (#app): the sign-in page, or the banners and the screen of the moment, the bill drawer, the bar
// at the foot and the column filter box. Was the drawing half of render() (renderNow, src/js/01), which put these in the
// page as HTML, with a placeholder for each React screen; render() now only does its other work (what the screen needs
// loaded, the ledger list's box, the tables' funnels) and React draws the page.
//
// Which screen: S.view (home or company), S.tab (a client's part), S.step (collecting), S.homeTab (home's page).
import Guard from "./Guard.jsx";
import Legacy from "./parts/Legacy.jsx";
import SignIn from "./screens/SignIn.jsx";
import SCREENS from "./screens/index.js";

const { Working, Books, Txn, Dash, DocqPanel, PostStep, DoneStep, ClientSetup, Collect, Sales, VendorRecon, ReviewTable, Invoices, Bank, Parties, Export,
  Help, Today, InboxAll, TallyHome, FirmSettings, Clients, Drawer, BankBar, SalesBar, ActionBar } = SCREENS;

// something wrong with reading bills on this computer
function SelfTestBanner() {
  const sum = selfTestSummary();
  if (sum.state !== "fail") return null;
  const msgs = sum.fails.map((k) => (k === "pdf" ? "PDF reading: " : "Photo OCR: ") + sum.r[k].msg);
  return <div className="banner" style={{ borderLeftColor: "var(--stop)", background: "var(--stop-soft)", marginBottom: 12 }}><b>Bill reading has a problem here.</b> {msgs.join(" ")}{" "}
    <button className="linkbtn" onClick={() => doAct("goSelfTest")}>See the self-test</button></div>;
}

// the firm's credit running out, and where the work is being saved
function Banners() {
  const a = S.account, bal = a && a.firm ? num(a.firm.balance) : 0, warn = a && a.firm ? num(a.firm.warn_at) : 0;
  const credit = !a || !a.firm ? null
    : S.creditStop && Date.now() - S.creditStop.at < 6 * 3600e3 && bal <= 0 ? <p className="banner" style={{ borderLeftColor: "var(--stop)", background: "var(--stop-soft)" }}><b>Credit finished.</b> Reading new bills, bank statements and invoices is paused. Everything already in FinCom still works, and entries can still be posted to Tally. Ask the administrator to add credit.</p>
    : bal <= warn ? <p className="banner">Credit left: <b>{INR.format(bal)}</b>. Ask the administrator to top it up before it runs out.</p> : null;
  const saved = S.storeKind === "db" || (Cloud.on() && Cloud.st && !Cloud.st.error) ? null
    : <p className="banner">{S.storeKind === "local" || S.storeKind === "idb" ? "Your work is saved in this browser only. Clearing browser data will remove it." : "Your work is not being saved. It will be lost when you close this page."}</p>;
  return <>{credit}{saved}</>;
}

function ClientInbox() {
  const has = Cloud.on() && docqFor(S.coId).length;
  return <>{has ? <DocqPanel cid={S.coId || ""} /> : <p className="note">Nothing is waiting for this client. Documents sent in by office automation appear here.</p>}
    <div className="row" style={{ marginTop: 10 }}><button className="btn small" onClick={() => navHome("inbox")}>Inbox for all clients</button></div></>;
}

function Screen() {
  const co = CO(), open = S.view === "company" && co && !S.loadingCo;
  if (open && S.tab === "books") return <Books />;
  if (open && S.tab === "txn") return <Txn />;
  if (open && S.tab === "dash") return <Dash />;
  if (open && S.tab === "clientInbox") return <ClientInbox />;
  if (open && S.tab === "export") return <PostStep />;
  if (open && S.tab === "done") return <DoneStep />;
  if (open && isSetupTab(S.tab)) return <ClientSetup />;
  if (open && S.step === "collect") return docType() === "sales" ? <Sales /> : <Collect />;
  if (S.view === "company" && co) {
    if (S.loadingCo) return <p className="note">{"Opening " + co.name + "…"}</p>;
    if (S.tab === "invoices") return VR.st() ? <VendorRecon /> : S.reviewTable && S.filter === "draft" ? <ReviewTable /> : <Invoices />;
    if (S.tab === "bank") return <Bank />;
    if (S.tab === "sales") return <Sales />;
    if (S.tab === "deductees") return <Parties />;
    return <Export />;
  }
  const t = S.homeTab;
  return t === "help" ? <Help /> : t === "today" ? <Today /> : t === "inbox" ? <InboxAll /> : t === "tally" ? <TallyHome /> : t === "rules" ? <FirmSettings /> : <Clients />;
}

// the bar at the foot of a client's bank, sales or bills
function Bar() {
  if (S.view !== "company") return null;
  if (S.tab === "bank") return B() && !B().loading && curStmt() ? <BankBar /> : null;
  if (S.tab === "sales") return salesBarOn() ? <SalesBar /> : null;
  return S.tab === "invoices" ? <ActionBar /> : null;
}

export default function Main({ v }) {
  if (!S.firm) return <p className="note">Loading…</p>;
  if (signInNeeded()) return <Guard name="the sign-in page" v={v}><SignIn /></Guard>;
  const company = S.view === "company" && CO();
  return <>
    <SelfTestBanner /><Banners />
    {company && <Guard name="the reading cards" v={v} quiet><Working /></Guard>}
    <Guard name="this screen" v={v} key={S.view + ":" + (company ? S.tab : S.homeTab)}><Screen /></Guard>
    {drawerEntry() && <Guard name="the bill drawer" v={v}><Drawer /></Guard>}
    <Guard name="the bar" v={v} quiet><Bar /></Guard>
    <Legacy html={colPopHtml()} />
  </>;
}
