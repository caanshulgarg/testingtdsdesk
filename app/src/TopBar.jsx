// The top bar: the page title (client header with its status tabs, or the home screen's name), the Tally chip, the
// firm account chip and the firm button, with the Tally panel and firm menu they open.
// Was renderTop, clientHeader, topRight, tallyPanelHtml, firmMenuHtml (src/js/02 and 18); actions are doAct(...).
// calls (stage 1): the one button on a client's page (calls/CallButton.jsx; the call screen loads only when used)
import CallButton from "./calls/CallButton.jsx";
import TallyPill from "./parts/TallyPill.jsx";
import TallyLine, { PanelBooks, panelBooksShown } from "./parts/TallyLine.jsx";
import { TallyStates } from "./parts/TallyStates.jsx";
import HelpButton from "./parts/HelpButton.jsx";
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import Bell from "./parts/Bell.jsx";
import { Inbox as InboxIcon } from "lucide-react";
import { needDays } from "./screens/books/FromTally.jsx";
// Arc UI (src/arc): the status tabs are Arc's Tabs, the Tally panel Arc's Drawer, the firm menu a dropdown menu in Arc's
// style (Radix's menu, as Arc's DropdownMenu, whose trigger and items do not fit the firm button and its menu)
import { Drawer, DrawerContent } from "@/registry/components/drawer/drawer";
import * as Menu from "@radix-ui/react-dropdown-menu";
import menu from "@/registry/components/dropdown-menu/dropdown-menu.module.css";
import Button from "./parts/Button.jsx";
import { goTallyPage } from "./parts/HomeLink.jsx";
import { StateBar } from "./parts/StateBar.jsx";
import { useDismiss } from "./parts/dismiss.js";
import TallyChip, { goTallyCard } from "./parts/TallyChip.jsx";
import { clientTallyState } from "./lib/tallyState.js";

const HOME_TITLES = { clients: "Clients", today: "Today", compliance: "Compliance", inbox: "Inbox", tally: "Tally", integrations: "Integrations", rules: "Settings", help: "Help", meetings: "Meetings" };
// one name for one thing (spec K1; clean-up batch 1): each page is called what the sidebar calls it. From Tally keeps
// the Tally ledgers as its tab, and Audit the tie-out with Tally
const BOOKS_TITLES = { tds: "TDS", gst: "GST", import: "From Tally", ledgers: "From Tally", tieout: "Audit", reports: "Reports", lookup: "Look up",
  letters: "Letters", mis: "MIS", mymis: "My MIS", fs: "Financial statements", audit: "Audit", recon: "Reconciliations" };
const DOC_NAMES = { bills: "Purchase", bank: "Bank", sales: "Sales" };

// Arc's page header: the breadcrumb (Clients › <client>, or Firm › <firm>) over the title, then the page's actions
function Title({ title, sub, crumb, children, after }) {
  // after: beside the page's name on its line (a client's Tally chip), so the breadcrumb above keeps its width
  return (
    <div className="tbar" data-crumb={crumb}>
      <div className="tbar-title">{after ? <div className="tbar-h"><h2>{title}</h2>{after}</div> : <h2>{title}</h2>}{typeof sub === "string" || sub == null ? <span className="note" title={sub || undefined}>{sub}</span> : sub}</div>
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
  // 2.4.0: one Upload for the Tally data; clean-up batch 1: called "Bring in from Tally", the one name for bringing the Tally data in (a Day Book, the ledger masters or a trial balance): which it is comes from the file
  daybook: ["Bring in from Tally", "Upload a Day Book or ledger masters XML exported from Tally: FinCom reads which it is, and its dates, from the file", () => doAct("tallyPick")],
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
// clean-up batch 2 ("one main button"): the page's own main action, when it shows one, so the top bar's Upload is plain:
// To review's Approve, and Post to Tally's "Post N to Tally" (its To post tab, with bills ready)
export function pageOwnsPrimary() {
  const up = uploadKind();
  // (upload-pages: only while there are bills to approve; with none, Upload is the page's one next step)
  if (up === "bills" && S.tab === "invoices" && S.reviewTable && S.filter === "draft") return typeof draftRows === "function" && draftRows().length > 0;
  if (up === "bills" && S.tab === "export") {
    const co = CO(); if (!co) return false;
    let ready = 0, errors = 0;
    try { ready = ((typeof postBills === "function" && postBills(co.id)) || { ready: [] }).ready.length; } catch (e) { ready = 0; }
    try { errors = typeof postTabCounts === "function" ? num(postTabCounts(co.id).errors) : 0; } catch (e) { errors = 0; }
    const tab = (S.postTabs || {})[co.id] || (errors ? "errors" : "topost");
    return tab === "topost" && ready > 0;
  }
  return false;
}
function MainAction() {
  const bt = S.tab === "books" ? booksTab() : "", up = uploadKind();
  // one primary a page (spec K2): the review table's own Approve is its primary, so Upload is a plain button there;
  // clean-up batch 2: so is Post to Tally's "Post N to Tally"
  const own = pageOwnsPrimary();
  if (up) { const [label, title, go] = UPLOADS[up]; return <Button className={"btn small" + (own ? "" : " primary")} data-upload={up} title={title} onClick={go}>{label}</Button>; }
  if (bt === "letters") return <Button className="btn small" onClick={() => ltrMode("confirm")}>New confirmation</Button>;   // the letters' own Print is the page's primary
  // while the copy of the books is empty, "Read the books from Tally" on the page is its one primary (one primary in every state)
  if (bt === "reports") return <Button className={"btn small" + (S.books && (S.books.vouchers || []).length ? " primary" : "")} onClick={() => doAct("keepNow")}>Refresh books</Button>;
  return null;
}

function ClientHeader() {
  const co = CO(), setup = isSetupTab(S.tab), t = docType(), inbox = docqCount(S.coId);
  const title = S.tab === "dash" ? "Overview" : S.tab === "clientInbox" ? "Inbox" : S.tab === "txn" ? "Transactions"
    : S.tab === "books" ? BOOKS_TITLES[booksTab()] || "From Tally" : setup ? "Client setup" : DOC_NAMES[t];
  // ui-tidy (13-Oct-2026; the owner: "still it is very confusing where is the client"): the breadcrumb is the way about:
  // Clients (the list) › the client (a click: the switcher, to find another by name, GSTIN or PAN) › the page
  const crumbs = <nav className="note crumbs" aria-label="Breadcrumb" data-crumbs="">
    <button type="button" className="linkbtn" data-crumb-clients="" onClick={() => navHome("clients")}>Clients</button><span aria-hidden="true">›</span>
    <button type="button" className="linkbtn crumb-co" data-client-switch="" title="Switch client (F3 or Ctrl+K)" aria-label={"Client " + co.name + ": switch client"} onClick={() => openSwitcher()}>{co.name} <span aria-hidden="true">▾</span></button>
    <span aria-hidden="true">›</span><span data-crumb-page="">{title}</span></nav>;
  const head = (
    // the client's one Tally chip ("Not linked → Link") beside the page's name (it was in the client's row of pages, gone)
    <Title title={title} sub={crumbs} crumb="client-nav" after={!S.loadingCo ? <TallyChip co={co} where="title" /> : null}>
      <div className="tbar-actions">
        {S.tab === "dash" && !S.loadingCo && <CallButton co={co} />}
        {inbox > 0 && !setup && S.tab !== "clientInbox" && <Button className="btn small" onClick={() => goStep("collect")}>{"\u{1F4E5} " + inbox + " in inbox"}</Button>}
      </div>
    </Title>
  );
  return head;
}

// whether this client page has the status tabs (To review · Post to Tally · In Tally …)
export function statusTabsShown() {
  const co = S.view === "company" ? CO() : null;
  if (!co || S.loadingCo) return false;
  const setup = isSetupTab(S.tab), t = docType();
  if (["dash", "clientInbox", "txn", "books"].includes(S.tab)) return false;
  if (setup) return false;   // its sections are listed on the left of the page (screens/Settings.jsx)
  // sales and the bank page have their own tabs
  if ((t === "sales" && S.tab === "sales") || (t === "bank" && S.tab === "bank")) return false;
  return true;
}

// a client's states (upload-pages, 14-Oct-2026): the one row of states of Purchase, Bank and Sales (parts/StateBar.jsx),
// the first thing on the page, kept in view under the header (steady.css). It was the three steps with an unlabelled
// badge for Tally's errors beside them, and Bank and Sales had rows of their own
export function StatusTabs() {
  return <StateBar />;
}

// Saving (spec H3): "Saving…" while saving, "Not saved: <reason>" in red on a failure (a click opens Settings → Sign-in),
// and since round 3 A a quiet "Saved 08:07" once saved, the rest in its tooltip. No cloud sign and no "live" (54-live-sync.js keeps doing its work).
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
  // round 3 A (the owner, 14-Oct-2026): the page's "Saved 08:07 · changes by others appear here at once" moved here: the
  // time on the chip, the rest in its tooltip
  if (sv.at) return <span className="tsave ok" data-save="saved" tabIndex={0}
    title={"Saved to the firm account at " + fmtTime(sv.at) + (Live.st === "live" ? ". Changes by others appear here at once." : ".")}>{"Saved " + fmtTime(sv.at)}</span>;
  return null;
}

// "N Tally errors" (spec H4): the count of Post to Tally → Errors (postTabCounts, src/js/59), a link to that list;
// hidden at zero and on the firm's own pages. upload-pages (14-Oct-2026): it said "3 entries need review" over Purchase's
// "To review 0"; the upload pages show the same count as their Errors state, so it is not said again in the top bar
function ReviewLink() {
  const co = S.view === "company" ? CO() : null;
  if (!co || typeof postTabCounts !== "function" || (typeof uploadPage === "function" && uploadPage())) return null;
  let n = 0; try { n = num(postTabCounts(co.id).errors); } catch (e) { n = 0; }
  if (!n) return null;
  const go = () => { S.postTabs = S.postTabs || {}; S.postTabs[co.id] = "errors"; goStep("post", "bills"); };
  return <button className="treview" data-review-link="" title="Open Post to Tally → Errors" onClick={go}>{n + (n === 1 ? " Tally error" : " Tally errors")}</button>;
}

// the one Tally sign (spec H1, H2): green connected / red not connected (tallySign, src/js/49), naming the computer (round
// 3, 05-Oct-2026): "Tally connected on this computer", "… through Office computer (NWS144)", "… through 2 computers",
// "Tally not connected. Last seen on …", "Tally is open on … with a different company"; on a phone the dot and the
// computer's name. The detail on hover, and in the Tally panel on a click
export function TallyDetail({ s, link = null }) {
  // round 3 (05-Oct-2026): connected through more than one computer: each, with its company and last contact
  if (s.many) return <dl className="tdetail" data-tally-detail="" data-tally-reason="">
    {s.many.map((m) => <span key={m.computer} style={{ display: "contents" }}><dt>Computer</dt><dd>{m.computer}</dd><dt>Company</dt><dd>{m.company || "\u2014"}</dd><dt>Last contact</dt><dd>{m.at || "never"}</dd></span>)}
  </dl>;
  return <dl className="tdetail" data-tally-detail="" data-tally-reason={s.on ? "" : s.code}>
    <dt>Computer</dt><dd>{s.computer || "none heard from"}</dd>
    <dt>Company</dt><dd>{s.company || "\u2014"}</dd>
    {link && <><dt>Link</dt><dd data-tally-link-word={link.state}>{link.word}</dd></>}
    <dt>Last contact</dt><dd>{s.at || "never"}</dd>
    {!s.on && <><dt>Why</dt><dd className="why">{s.reason}</dd><dt>What to do</dt><dd>{s.fix}</dd></>}
  </dl>;
}
// the top bar's sign (the owner, 11-Oct-2026): THIS computer only, a dot and a short word, steady (tallyHere, src/js/49):
// green "Tally ready"; amber "Tally closed", "Tally busy", "Company not open", "Company not linked", "No internet"; red
// "Bridge stopped"; grey "Tally not on this computer" (no bridge here: not an alarm). The hover card: the company, the
// Windows user, when last confirmed, the next step as a button, and the firm's other computers in one quiet line
export function HereCard({ h, link = null }) {
  const pc = h.computer ? tallyPcShort(h.computer, h.user) : "";
  return <div className="there" data-tally-here-card={h.code}>
    <p className="there-head"><span className={"tsign-dot " + h.level} aria-hidden="true" /><b>{h.label}</b></p>
    <dl className="tdetail" data-tally-detail="" data-tally-reason={h.level === "ok" ? "" : h.code}>
      {pc && <><dt>Computer</dt><dd>{pc}</dd></>}
      {h.company && <><dt>Company</dt><dd>{h.company}</dd></>}
      {link && <><dt>Link</dt><dd data-tally-link-word={link.state} data-tally-pill={link.pill ? link.pill.state : undefined}>{link.pill && link.state !== "unlinked" ? link.pill.text : link.word}</dd></>}
      {h.code !== "none" && <><dt>Last confirmed</dt><dd data-tally-confirmed="">{h.confirmed ? tallyIst(h.confirmed) : "\u2014"}</dd></>}
    </dl>
    {h.hint && <p className="note there-hint" data-tally-hint="">{h.hint}</p>}
    {h.other && <p className="note there-other" data-tally-other="">{h.other}</p>}
    {h.next.length > 0 && <div className="there-acts">{h.next.map((n, i) => <button key={n.act} type="button" data-tally-next={n.act}
      className={"btn small" + (i === 0 && h.level !== "ok" && n.act !== "tallyCheck" ? " primary" : "")} onClick={(ev) => { ev.stopPropagation(); doAct(n.act); }}>{n.label}</button>)}</div>}
  </div>;
}
function TallySign() {
  const co = S.view === "company" ? CO() : null, h = tallyHere(co), t = tallyStatus(co), lk = co ? tallyLinkOf(co) : null;
  // next-tally-suvit: the client's company in the one pill's words (lib/tallyState.js), as its card and chip say them
  const k = lk ? Object.assign({}, lk, { pill: clientTallyState(co) }) : null;
  const tone = { ok: "on", warn: "warn", bad: "off", idle: "idle" }[h.level] || "idle";
  return <span className="tsign-wrap">
    <button className={"tsign tallychip " + tone} data-tally-sign={h.level === "ok" ? "on" : "off"} data-tally-here={h.code} data-tally-level={h.level} data-tally={t.state} data-tally-link-sign={k ? k.state : undefined}
      aria-haspopup="dialog" aria-label={"Tally: " + h.label} title={tallyHereWords(h) + (k ? " — " + (k.state === "unlinked" ? k.word : k.pill.text) : "")}
      // ui-tidy; 15-Oct-2026: while the client is not linked, the sign points to the Tally page's Connect Tally, step 4 with this
      // client (goTallyCard, parts/TallyChip.jsx), as every Tally chip does
      onClick={() => (co && k && k.state === "unlinked" ? goTallyCard(co.id) : doAct("tallyPanel"))}>
      <span className="tsign-dot" aria-hidden="true" /><span className="tsign-long">{h.label}</span><span className="tsign-short">{h.short}</span>
    </button>
    {!S.tallyPanel && <span className="tsign-pop" role="group" aria-label="Tally on this computer"><HereCard h={h} link={k} /></span>}
  </span>;
}

// t70 (16-Oct-2026; the owner: the sidebar's Inbox and From Tally out): the Inbox as a tray beside the bell, with what is
// waiting (the open client's, or every client's on the firm's pages); it opens what the sidebar's Inbox opened
function InboxBtn() {
  const co = S.view === "company" ? CO() : null;
  const n = typeof docqCount === "function" ? (co ? docqCount(co.id) : Object.values(S.docq || {}).filter((d) => d.status === "waiting").length) : 0;
  const words = "Inbox" + (n ? ", " + n + " waiting" : "") + (co ? ": documents that arrived for this client" : ": documents that arrived, every client");
  return <button type="button" className="bell tb-inbox-btn" data-topbar-inbox="" aria-label={words} title={words} aria-current={(co ? S.tab === "clientInbox" : S.view === "home" && S.homeTab === "inbox") ? "page" : undefined}
    onClick={() => (co ? goClient("inbox") : navHome("inbox"))}>
    <InboxIcon width={16} height={16} strokeWidth={1.75} aria-hidden="true" />{n > 0 && <span className="bell-n" data-inbox-count="">{n}</span>}</button>;
}

// t70: in the Tally panel, the way to From Tally's upload (a Day Book, the masters), and the days that need a Day Book
function PanelUpload({ co }) {
  if (!co) return null;
  const b = S.books && S.books.cid === co.id ? S.books : null, days = b ? needDays(b, co.id) : [], nd = days.reduce((a, x) => a + x.days, 0);
  return <p className="tp-upload" data-tp-upload-line="">
    <button type="button" className="btn small" data-tp-upload="" onClick={() => { doAct("tallyPanelClose"); goClient("books:import"); }}>Upload Day Book or masters</button>
    {nd > 0 && <span className="note" data-tp-days=""> {nd} day{nd === 1 ? "" : "s"} need a Day Book</span>}</p>;
}

function TopRight() {
  const bal = accountBalance(), plan = S.account && S.account.firm ? planName(S.account.firm.plan) : "";
  const inCo = S.view === "company" && CO();
  // stability batch 1: two parts. The page's own buttons (left), which come and go with the page; then the bell, the
  // Tally sign and the firm, each in a place of its own width (steady.css), at the same spot on every page
  return (
    <div className="topright">
      {/* keyed by the page: a page's own buttons are its own, drawn new with it (not slid along when their width changes) */}
      <span className="tb-page" key={S.view + ":" + (inCo ? S.tab + ":" + (S.tab === "books" ? booksTab() : "") : S.homeTab)}>
      {/* the upload pages have their guide as a "?" at the end of their row of states */}
      {inCo && !(typeof uploadPage === "function" && uploadPage()) && <HelpButton page />}
      <ReviewLink />
      <SaveState />
      {/* the page's one primary action, at the right of the page's own buttons, in the same place on every page (spec I, K2) */}
      {inCo && !isSetupTab(S.tab) && <MainAction />}
      </span>
      <span className="tb-global">
      <span className="tb-slot tb-inbox"><InboxBtn /></span>
      <span className="tb-slot tb-bell"><Bell /></span>
      <span className="tb-slot tb-tally"><TallySign /></span>
      <span className="tb-slot tb-firm">
      <Menu.Root open={!!S.firmMenu && !signInNeeded()} onOpenChange={(o) => { if (o !== !!S.firmMenu) doAct(o ? "firmMenu" : "firmMenuClose"); }} modal={false}>
        <Menu.Trigger asChild><button className="firmbtn" title={(S.firm.firmName || "Firm") + (plan ? " · plan " + plan : "") + (bal != null ? " · credit " + money(bal) : "")}>
          <b>{(S.firm.firmName || "Firm").slice(0, 26)}</b>
          {/* upload-pages (14-Oct-2026; the owner read "ABC ₹49.99 Cr credit" on Purchase as meaning nothing): the firm's
              credit shows on the firm's own pages; on a client's page it is in the firm menu and the button's tip */}
          {inCo ? null : bal != null ? <small data-credit="">{moneyShort(bal) + " credit"}</small> : plan ? <small>{plan}</small> : null}
        </button></Menu.Trigger>
        <FirmMenu />
      </Menu.Root>
      </span>
      </span>
    </div>
  );
}

// the Tally panel: Arc's Drawer from the right, open while S.tallyPanel is. It leaves the page usable (not modal): a click
// elsewhere closes it, except on the Tally sign itself, whose click closes it as before
const TP_REF = { get current() { return document.querySelector('[data-overlay="tallypanel"]'); } };
function TallyPanel({ open }) {
  const co = S.view === "company" ? CO() : null, live = bridgeLive(co), st = Bridge.st || {};
  const close = () => { if (S.tallyPanel) doAct("tallyPanelClose"); };
  // a click outside (the first click only closes), Esc and (a phone) Back (parts/dismiss.js); the Tally sign toggles it
  useDismiss(!!open, TP_REF, close, { also: () => Array.from(document.querySelectorAll(".tsign-wrap")) });
  return <Drawer open={open} onOpenChange={(o) => { if (!o) close(); }} modal={false}>
    <DrawerContent className="tallypanel" data-overlay="tallypanel" title="Tally connection" closeLabel="Close" aria-describedby={undefined}
      onInteractOutside={(ev) => ev.preventDefault()}
      // Esc stays with the app's own key handler (src/js), which closes the panel first, as before
      onEscapeKeyDown={(ev) => ev.preventDefault()}>
      {open && <><div className="tp-body">
        <HereCard h={tallyHere(co)} link={co ? Object.assign({}, tallyLinkOf(co), { pill: clientTallyState(co) }) : null} />
        <p className="note" style={{ margin: "10px 0 4px" }}><b>The firm’s Tally computers</b></p>
        <div data-tally-firm=""><TallyDetail s={tallySign(co)} /></div>
        <p><TallyPill co={co} /></p>{co && typeof tallyLine === "function" && tallyLine(co) && <p data-panel-tally-line=""><TallyLine co={co} update={!panelBooksShown(co.id)} /></p>}
        {/* round 3 A: the client's books, Books up to … · read …, Update now; the rest under Details */}
        {co && <PanelBooks cid={co.id} />}<PanelUpload co={co} /><p className="note">{tallyStatus(co).say}</p>
        <TallyStates co={co} />
        {Bridge.on() ? <>
          <p><span className={"dotled " + (live ? "live" : "off")} /><b>{live ? "Connected" : "Not answering"}</b>{st.version && <span className="note"> · FinCom Bridge {st.version}</span>}</p>
          {co && <p className="note">{(Bridge.openFor(co) || {}).name ? Bridge.openFor(co).name + " is open in Tally." : (co.tallyName || co.name) + " is not open in Tally."}</p>}
          {!live && <p className="note">Open TallyPrime on the computer where the bridge runs, and keep the company open.</p>}
        </> : <p className="note">FinCom Bridge is not set up on this computer. Install FinCom Bridge from the Tally page on the computer where TallyPrime runs, then come back here.</p>}
      </div>
      <div className="tp-foot">
        <Button className="btn small" onClick={() => doAct("tallyGuide")}>Connection guide</Button>
        <Button className="btn small" data-panel-sent="" onClick={() => goTallyPage("sent")}>Everything sent to Tally</Button>
      </div></>}
    </DrawerContent>
  </Drawer>;
}

// the firm menu under the firm button: open while S.firmMenu is (doAct firmMenu / firmMenuClose), Radix's menu in Arc's style
function FirmMenu() {
  const a = S.account, bal = accountBalance();
  const item = (label, go, extra) => <Menu.Item asChild onSelect={go}><button type="button" className={"fm-item " + menu.item}>{label}{extra}</button></Menu.Item>;
  return <Menu.Portal><Menu.Content className={"firmmenu " + menu.menu} sideOffset={6} align="end" collisionPadding={12} loop>
      <Menu.Label className="fm-head"><b>{S.firm.firmName || "Firm"}</b>{a && a.me && <span className="note">{(a.me.email || "") + " · " + (a.me.role || "")}</span>}</Menu.Label>
      {a && a.firm && <div className="fm-plan"><span>{planName(a.firm.plan) || "Plan"}</span>{bal != null && <b>credit {money(bal)}</b>}</div>}
      <Menu.Separator className={menu.separator} />
      {/* clean-up batch 1: the firm's own things; Tally, Today's inbox and the clients are in the sidebar */}
      {item("Settings", () => doAct("openSettings"))}
      {item("People", () => goSettings("account"))}
      {item("Plan and credit", () => goSettings("plan"))}
      {Cloud.on() && item("Sign out", () => doAct("signOutNow"))}
  </Menu.Content></Menu.Portal>;
}

// the header's height as --head-h, for what stays in view under it (the status tabs)
let headObs = null;
function watchHead(top) {
  if (headObs || !top || typeof ResizeObserver !== "function") return;
  headObs = new ResizeObserver(() => document.documentElement.style.setProperty("--head-h", Math.round(top.getBoundingClientRect().height) + "px"));
  headObs.observe(top);
}

export default function TopBar() {
  const hide = signInNeeded();
  useLayoutEffect(() => { const top = document.querySelector("header.top"); if (top) { top.style.display = hide ? "none" : ""; watchHead(top); } });
  const inCo = S.view === "company" && CO();
  return <>
    {createPortal(
      <div className="headrow">
        {inCo ? <ClientHeader /> : <Title title={HOME_TITLES[S.homeTab] || "Clients"} sub={S.firm.firmName || ""} crumb={S.firm.firmName ? "firm" : undefined} />}
        <TopRight />
      </div>, document.getElementById("cobar"))}
    <TallyPanel open={!!S.tallyPanel && !hide} />
  </>;
}
