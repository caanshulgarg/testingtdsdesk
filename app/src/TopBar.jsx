// The top bar: the page title (client header with its status tabs, or the home screen's name), the Tally chip, the
// firm account chip and the firm button, with the Tally panel and firm menu they open.
// Was renderTop, clientHeader, topRight, tallyPanelHtml, firmMenuHtml (src/js/02 and 18); actions are doAct(...).
import TallyPill from "./parts/TallyPill.jsx";
import TallyLine from "./parts/TallyLine.jsx";
import { TallyStates } from "./parts/TallyStates.jsx";
import HelpButton from "./parts/HelpButton.jsx";
import { useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import Bell from "./parts/Bell.jsx";
// Arc UI (src/arc): the status tabs are Arc's Tabs, the Tally panel Arc's Drawer, the firm menu a dropdown menu in Arc's
// style (Radix's menu, as Arc's DropdownMenu, whose trigger and items do not fit the firm button and its menu)
import { Tabs } from "@/registry/components/tabs/tabs";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import tabs from "@/registry/components/tabs/tabs.module.css";
import { Drawer, DrawerContent } from "@/registry/components/drawer/drawer";
import * as Menu from "@radix-ui/react-dropdown-menu";
import menu from "@/registry/components/dropdown-menu/dropdown-menu.module.css";
import Button from "./parts/Button.jsx";

const HOME_TITLES = { clients: "Clients", today: "Today", inbox: "Inbox", tally: "Your Tally connection", rules: "Settings", help: "Help" };
// one name for one thing (spec K1): each page is called what the sidebar calls it
const BOOKS_TITLES = { reports: "Reports", lookup: "Look up", letters: "Letters", mis: "MIS", fs: "Accounts", audit: "Audit" };
const DOC_NAMES = { bills: "Purchase", bank: "Bank", sales: "Sales" };

// Arc's page header: the breadcrumb (Clients › <client>, or Firm › <firm>) over the title, then the page's actions
function Title({ title, sub, crumb, children }) {
  return (
    <div className="tbar" data-crumb={crumb}>
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
  // 2.4.0: one Upload for the Tally data (a Day Book, the ledger masters or a trial balance): which it is comes from the file
  daybook: ["Upload Tally data", "Upload a Day Book or ledger masters XML exported from Tally: FinCom reads which it is, and its dates, from the file", () => doAct("tallyPick")],
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
  if (up) { const [label, title, go] = UPLOADS[up]; return <Button className={"btn small" + (own ? "" : " primary")} data-upload={up} title={title} onClick={go}>{label}</Button>; }
  if (bt === "letters") return <Button className="btn small" onClick={() => ltrMode("confirm")}>New confirmation</Button>;   // the letters' own Print is the page's primary
  // while the copy of the books is empty, "Read the books from Tally" on the page is its one primary (one primary in every state)
  if (bt === "reports") return <Button className={"btn small" + (S.books && (S.books.vouchers || []).length ? " primary" : "")} onClick={() => doAct("keepNow")}>Refresh books</Button>;
  return null;
}

function ClientHeader() {
  const co = CO(), setup = isSetupTab(S.tab), t = docType(), inbox = docqCount(S.coId);
  const title = S.tab === "dash" ? "Dashboard" : S.tab === "clientInbox" ? "Inbox" : S.tab === "txn" ? "Transactions"
    : S.tab === "books" ? BOOKS_TITLES[booksTab()] || "TDS & GST" : setup ? "Client setup" : DOC_NAMES[t];
  const head = (
    <Title title={title} sub={co.name} crumb="client">
      <div className="tbar-actions">
        {inbox > 0 && !setup && S.tab !== "clientInbox" && <Button className="btn small" onClick={() => goStep("collect")}>{"\u{1F4E5} " + inbox + " in inbox"}</Button>}
        {setup && <Button className="btn small" onClick={() => toggleSetup()}>Back to the work</Button>}
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
  // Arc's Tabs, its root with Radix's list and triggers in Arc's classes: no scroll arrows (more buttons in nav.sbar) and
  // each tab's words first, as the tests read them; the chosen tab's pill is drawn in styles/arc-look.css. A tab is chosen by a click (or Enter / Space), as before; the arrow keys only move between them
  // (activationMode "manual"), so going along the tabs never opens a page on the way
  const cur = onSide ? S.filter : now || "";
  return <>{head}<nav className="sbar" aria-label="Status" data-bill-filters={bills ? "" : undefined}>
    <Tabs value={cur} onValueChange={() => {}} activationMode="manual"><TabsPrimitive.List aria-label="Status" className={tabs.list}>
    {[["review", "To review", n(c.review)], ["post", "Post to Tally", n(c.post)], ["done", "In Tally", n(c.done)]].map(([id, label, k]) =>
      <TabsPrimitive.Trigger key={id} value={id} className={tabs.trigger} onClick={() => goStep(id)} data-step={id}>{label}{k !== "" && <> <span className="sbar-n" data-step-n="">{k}</span></>}
        {id === "post" && c.postAttention > 0 && <> <span className="sbar-n attn" data-attn-n="" title={c.postAttention + " need" + (c.postAttention === 1 ? "s" : "") + " your attention"}>{c.postAttention}</span></>}</TabsPrimitive.Trigger>)}
    {side.map(([id, label]) => <TabsPrimitive.Trigger key={id} value={id} className={tabs.trigger} onClick={() => goSide(id)}>{label} <span className="sbar-n">{cnt(id)}</span></TabsPrimitive.Trigger>)}
    </TabsPrimitive.List></Tabs>
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

// the one Tally sign (spec H1, H2): green connected / red not connected (tallySign, src/js/49), naming the computer (round
// 3, 05-Oct-2026): "Tally connected on this computer", "… through Office computer (NWS144)", "… through 2 computers",
// "Tally not connected. Last seen on …", "Tally is open on … with a different company"; on a phone the dot and the
// computer's name. The detail on hover, and in the Tally panel on a click
export function TallyDetail({ s }) {
  // round 3 (05-Oct-2026): connected through more than one computer: each, with its company and last contact
  if (s.many) return <dl className="tdetail" data-tally-detail="" data-tally-reason="">
    {s.many.map((m) => <span key={m.computer} style={{ display: "contents" }}><dt>Computer</dt><dd>{m.computer}</dd><dt>Company</dt><dd>{m.company || "\u2014"}</dd><dt>Last contact</dt><dd>{m.at || "never"}</dd></span>)}
  </dl>;
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
      <span className="tsign-dot" aria-hidden="true" /><span className="tsign-long">{s.words}</span><span className="tsign-short">{s.short || s.computer}</span>
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
      <Bell />
      <TallySign />
      <Menu.Root open={!!S.firmMenu && !signInNeeded()} onOpenChange={(o) => { if (o !== !!S.firmMenu) doAct(o ? "firmMenu" : "firmMenuClose"); }} modal={false}>
        <Menu.Trigger asChild><button className="firmbtn" title={(S.firm.firmName || "Firm") + (plan ? " · plan " + plan : "") + (bal != null ? " · credit " + money(bal) : "")}>
          <b>{(S.firm.firmName || "Firm").slice(0, 26)}</b>
          {bal != null ? <small data-credit="">{moneyShort(bal) + " credit"}</small> : plan ? <small>{plan}</small> : null}
        </button></Menu.Trigger>
        <FirmMenu />
      </Menu.Root>
      {/* the page's one primary action, always at the far right, in the same place on every page (spec I, K2) */}
      {inCo && !isSetupTab(S.tab) && <MainAction />}
    </div>
  );
}

// the Tally panel: Arc's Drawer from the right, open while S.tallyPanel is. It leaves the page usable (not modal): a click
// elsewhere closes it, except on the Tally sign itself, whose click closes it as before
function TallyPanel({ open }) {
  const co = S.view === "company" ? CO() : null, live = bridgeLive(co), st = Bridge.st || {};
  const close = () => { if (S.tallyPanel) doAct("tallyPanelClose"); };
  return <Drawer open={open} onOpenChange={(o) => { if (!o) close(); }} modal={false}>
    <DrawerContent className="tallypanel" title="Tally connection" closeLabel="Close" aria-describedby={undefined}
      onInteractOutside={(ev) => { if (ev.target && ev.target.closest && ev.target.closest(".tsign-wrap")) ev.preventDefault(); }}
      // Esc stays with the app's own key handler (src/js), which closes the panel first, as before
      onEscapeKeyDown={(ev) => ev.preventDefault()}>
      {open && <><div className="tp-body">
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
        <Button className="btn small" onClick={() => doAct("tallyGuide")}>Connection guide</Button>
        <Button className="btn small" onClick={() => navHome("tally")}>Everything sent to Tally</Button>
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
      {item("Settings", () => doAct("openSettings"))}
      {item("Tally ", () => navHome("tally"), <TallyPill prefix="" />)}
      {item("Inbox for all clients", () => navHome("inbox"))}
      {item("All clients", () => navHome("clients"))}
      {Cloud.on() && item("Sign out", () => doAct("signOutNow"))}
  </Menu.Content></Menu.Portal>;
}

export default function TopBar() {
  const hide = signInNeeded();
  useLayoutEffect(() => { const top = document.querySelector("header.top"); if (top) top.style.display = hide ? "none" : ""; });
  const inCo = S.view === "company" && CO();
  return <>
    {createPortal(S.firm.firmName || "", document.getElementById("firmLine"))}
    {createPortal(
      <div className="headrow">
        {inCo ? <ClientHeader /> : <Title title={HOME_TITLES[S.homeTab] || "Clients"} sub={S.firm.firmName || ""} crumb={S.firm.firmName ? "firm" : undefined} />}
        <TopRight />
      </div>, document.getElementById("cobar"))}
    <TallyPanel open={!!S.tallyPanel && !hide} />
  </>;
}
