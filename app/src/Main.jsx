// The page's main part (#app): the sign-in page, or the banners and the screen of the moment, the bill drawer, the bar
// at the foot and the column filter box. Was the drawing half of render() (renderNow, src/js/01), which put these in the
// page as HTML, with a placeholder for each React screen; render() now only does its other work (what the screen needs
// loaded, the ledger list's box, the tables' funnels) and React draws the page.
//
// Which screen: S.view (home or company), S.tab (a client's part), S.step (collecting), S.homeTab (home's page).
import { Suspense } from "react";
import Guard from "./Guard.jsx";
import Legacy from "./parts/Legacy.jsx";
import SignIn from "./screens/SignIn.jsx";
import SCREENS from "./screens/index.js";
import PageSkeleton from "./parts/PageSkeleton.jsx";
import OpenLoader, { openingAfterSignIn } from "./parts/OpenLoader.jsx";
import { StatusTabs } from "./TopBar.jsx";
import ClientStrip from "./parts/ClientStrip.jsx";

const { Working, Books, Txn, Dash, DocqPanel, PostStep, DoneStep, ClientSetup, Collect, Sales, VendorRecon, ReviewTable, Invoices, Bank, Parties, Export,
  Help, Today, Compliance, InboxAll, TallyHome, FirmSettings, Clients, Drawer, BankBar, SalesBar, ActionBar, Integrations } = SCREENS;

// something wrong with reading bills on this computer
function ClientInbox() {
  const has = Cloud.on() && docqFor(S.coId).length;
  // clean-up batch 3: empty, one sentence and one next step; the Inbox for all clients is Today's "To read", one click away
  return has ? <DocqPanel cid={S.coId || ""} /> : <p className="note" data-inbox-empty="">Nothing is waiting for this client. <button className="linkbtn" onClick={() => goSettings("account")}>How to send documents in</button></p>;
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
    // stability batch 1: one wait, in the page's shape (the same as the frame before the program loads), not a "Loading…" note
    if (S.loadingCo) return <PageSkeleton what={co.name + "’s work"} />;
    if (S.tab === "invoices") return VR.st() ? <VendorRecon /> : S.reviewTable && S.filter === "draft" ? <ReviewTable /> : <Invoices />;
    if (S.tab === "bank") return <Bank />;
    if (S.tab === "sales") return <Sales />;
    if (S.tab === "deductees") return <Parties />;
    return <Export />;
  }
  const t = S.homeTab;
  return t === "help" ? <Help /> : t === "today" ? <Today /> : t === "compliance" ? <Compliance /> : t === "inbox" ? <InboxAll /> : t === "tally" ? <TallyHome /> : t === "integrations" ? <Integrations /> : t === "rules" ? <FirmSettings /> : <Clients />;
}

// the bar at the foot of a client's bank, sales or bills
function Bar() {
  if (S.view !== "company") return null;
  if (S.tab === "bank") return B() && !B().loading && curStmt() ? <BankBar /> : null;
  if (S.tab === "sales") return salesBarOn() ? <SalesBar /> : null;
  return S.tab === "invoices" ? <ActionBar /> : null;
}

export default function Main({ v }) {
  if (!S.firm) return null;   // the frame index.html drew stays until then (App.jsx)
  if (signInNeeded()) return <Guard name="the sign-in page" v={v}><SignIn /></Guard>;
  // just signed in: FinCom opening until the firm's first sync is done (one wait, not an empty list filling in)
  if (openingAfterSignIn()) return <OpenLoader />;
  const company = S.view === "company" && CO();
  return <>
    {/* round 3 (05-Oct-2026): no warnings on the pages; the credit, the storage, the self-test and Tally's alerts are in
        the bell in the top bar (parts/Bell.jsx, AlertHub in src/js/63-alerts.js) */}
    {/* a client's status tabs, the first thing on the page (were a second row of the header: stability batch 1) */}
    {/* ui-tidy: the client's own pages and its Tally chip, first on every page of a client */}
    {company && <Guard name="the client strip" v={v} quiet><ClientStrip /></Guard>}
    {company && <Guard name="the status tabs" v={v} quiet><StatusTabs /></Guard>}
    {company && <Guard name="the reading cards" v={v} quiet><Working /></Guard>}
    {/* a screen whose file is still coming (screens/lazy.js) shows the page's shape meanwhile */}
    <Guard name="this screen" v={v} key={S.view + ":" + (company ? S.tab : S.homeTab)}><Suspense fallback={<PageSkeleton what="the page" />}><Screen /></Suspense></Guard>
    {drawerEntry() && <Guard name="the bill drawer" v={v}><Drawer /></Guard>}
    <Guard name="the bar" v={v} quiet><Suspense fallback={null}><Bar /></Suspense></Guard>
    <Legacy html={colPopHtml()} />
  </>;
}
