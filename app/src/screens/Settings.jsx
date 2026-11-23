// Settings, in two places that look and work the same way: a list of sections on the left, one section on the right.
//   FirmSettings — for the whole firm (Settings in the sidebar when no client is open). The section is S.settingsTab.
//   ClientSetup  — for the open client (Client setup). The section is S.tab, one of SETUP_TABS (src/js/02).
// Was the tiles page (settingsTiles, viewRules in src/js/18) and viewCompanySettings (src/js/27), which put the
// company, Tally, TDS and GST settings on one long page.
// The owner's redesign of 17-Nov-2026 (settings-layout.css): one line a section in the list, its status at the right (a
// section needing something in the warning colour); "Needs you" / "To finish" above, only what needs doing, each a link
// to its section; a client's header (name, GSTIN, PAN, Tally, "N of M set up"); on a phone the list first, then the
// section full width with "← Settings" / "← Client setup" back to the list.
//
// Each section is one draft (review 18: parts/Confirm.jsx, src/js/60): what is typed or picked is checked as before
// (coSetText, coCommit, coCommitRuleLedger, …) but saved, and sent to the cloud, only when Save at its foot is pressed;
// leaving with unsaved changes asks. Sections not yet redrawn in React show the old screen's HTML through <Legacy>.
// next-room-2: AI help's own working and buttons (not in the program every page loads)
import "../../../src/js/50-ai-help-page.js";
import { SheetFormats } from "../parts/SheetPanel.jsx";
// GSTLock's checks of a change (the ISD switch, GST API all clients): with this screen, as with the GST screens (build.py lazy_files)
import "../../../src/js/47-gst-lock-checks.js";
import HowPage from "../parts/HowPage.jsx";
import { useState, useEffect, Suspense, lazy } from "react";
// Academy batches (calls, stage 1): in the calls' own small-windows file, loaded when the section is opened
const Batches = lazy(() => import("../calls/CallMenu.jsx").then((m) => ({ default: m.Batches })));
// "Have a coupon?" under Plan and credit (migration 120's coupon_redeem): its own small file
const CouponBox = lazy(() => import("../parts/CouponBox.jsx"));
import Confirm, { ChoiceTag } from "../parts/Confirm.jsx";
import Legacy from "../parts/Legacy.jsx";
import { AiSettings } from "../parts/Ai.jsx";
import AutoPostSettings from "../parts/AutoPostSettings.jsx";
import { AssistantSettings } from "../parts/AssistantSettings.jsx";
import { CloudBooks } from "./Tally.jsx";
import HomeLink, { goTallyPage } from "../parts/HomeLink.jsx";
import "../../../src/js/96-bank-sent-heal.js";
import "../../../src/js/98-link-record.js";
import "../../../src/js/97-postto-link.js";
import BooksSource from "../parts/BooksSource.jsx";
import { PlanCredit, FirmAccount, PeopleEtc } from "./Account.jsx";
import { Rates, Reading, ClosedPeriods } from "./SettingsMore.jsx";
import { BankSetup } from "../parts/BankSettings.jsx";
import GstSettings from "./gst/GstSettings.jsx";
import Parties from "./Parties.jsx";
import GstApiAll from "./GstApiAll.jsx";
import LogoPick from "../parts/LogoPick.jsx";
// next-assistant (phase 1 design): the client's own contacts, for Daily Check's weekly questions
import ClientContacts from "./daily/ClientContacts.jsx";
import TrustLevels from "./daily/TrustLevels.jsx";
import { clientTallyState, tallyDevs, pcLive, seenWords, openOn } from "../lib/tallyState.js";
// TDSF25 (src/js/83-tds-forms-2025.js: the deductor's details) comes with this screen's file, not in legacy.js (build.py lazy_files)
import "../../../src/js/83-tds-forms-2025.js";
// the two-pane look of both pages (the owner's redesign of 17-Nov-2026): with this screen's file, not in the main styles
import "./settings-layout.css";
// the bill desk's suppliers: waiting bills' new suppliers, the year read from Tally (src/js/99, kept out of legacy.js)
import "../../../src/js/99-pending-suppliers.js";

// the list on the left: groups of sections; each section one line, its label and, at the right, where it stands now
// (a section that needs something done: warn, in the warning colour; its whole status in the tip)
function SetNav({ label, groups, current, pick, foot }) {
  return (
    <nav className="setnav" aria-label={label}>
      {groups.map((g) => (
        <div className="setgroup" key={g.title}>
          <div className="setgroup-t">{g.title}</div>
          {g.items.map((it) => (
            <button key={it.id} className={[it.danger && "danger", it.warn && "warn"].filter(Boolean).join(" ") || undefined} data-set-item={it.id} data-done={it.done === undefined ? undefined : String(it.done)}
              title={it.tip || it.status || undefined} aria-current={current === it.id ? "page" : undefined} onClick={() => pick(it.id)}>
              <span>{it.label}</span>{it.status && <small>{it.status}</small>}
            </button>
          ))}
        </div>
      ))}
      {foot}
    </nav>
  );
}

// "Needs you" (the firm) / "To finish" (a client): only what needs doing, each a link to its section; nothing when all is done
function NeedsStrip({ title, items, pick }) {
  if (!items.length) return null;
  return <div className="set-needs" role="region" aria-label={title} data-set-needs="">
    <b>{title + " (" + items.length + ")"}</b>
    {items.map((x, i) => <button key={x.id + i} type="button" className="linkbtn" data-needs-go={x.id} onClick={() => pick(x.id, x)}>{x.text}</button>)}
  </div>;
}

// what each section changes (its draft: src/js/60, draftStore); a section with none has only buttons that act at once
const GST_BOOK_KEYS = "books:gstSet,gstOpen,itcBasis,rule37On,gstCashLedger,gstAato,gstContacts,gstApi,gstEst,gstRegs,rev";
const SEC_STORES = { settings: ["client"], cotally: ["client"], cotds: ["client"], deductees: ["parties"], gstset: ["client", GST_BOOK_KEYS], bankset: ["client"], coclosed: ["client"],
  firm: ["firm"], rates: ["firm"], ai: ["firm"], reading: ["reading"] };
const SEC_EMPTY = { cosheets: "Each change acts at once; a format deleted is kept, with who and why.", bankrules: "Each rule is saved from its own box (New rule, Change); a rule deleted is asked first.", account: "Nothing to save here: each button acts at once.",
  plan: "Nothing to save here.", autopost: "Nothing to save here: the panel has its own Save, and only the owner switches it on.", moves: "Each switch acts at once. It is kept in this browser, for you only.", bridge: "Nothing to save here: each button acts at once.", tcloud: "Nothing to save here: each button acts at once.", postlog: "Nothing to save here.", gstapi: "Nothing to save here." };

// the Save bar's own words, for a section that asks for them (GST settings, the owner's redesign of 17-Nov-2026)
const SEC_BAR = { gstset: { count: true, discardText: "Undo my changes" } };

// "← Back to Post to Tally": a setup page reached from another page leads back to it (smart moves round 1, Smart.setReturn)
export function BackTo() {
  const back = typeof Smart === "object" ? Smart.returnHere() : null;
  if (!back) return null;
  return <p className="back-to"><button className="linkbtn" data-back-to="" onClick={() => Smart.goBack()}>{"← Back to " + back.label}</button></p>;
}

// the phone's list and sections in the browser's history: a section opened from the list is a step of its own, marked
// fcSetFrom (so "←" goes back to the list's step, as the browser's Back does); the step the list is shown on is marked
// fcSetList (Client setup: the list and Company share an address). FOCUS: where the focus goes after the next drawing
// ("head", or "list:<section>"), on a phone only, and only for a drawing within a second (never later, for another page).
// The history steps are added on a phone only: on a computer the list and the section show together, and a step with the
// same address would make Back seem to do nothing.
let FOCUS = { to: "", at: 0 };
const focusNext = (to) => { FOCUS = { to, at: Date.now() }; };
const phone = () => typeof matchMedia === "function" && matchMedia("(max-width: 760px)").matches;
// the sidebar's Client setup (Side.jsx: S.setupList, the time it was pressed) asks for the list first: only for a drawing
// soon after, and never after an address was opened (Back / Forward, a link: Route.apply), so a mark left while the client
// was loading cannot turn a later link to Company into the list
const SETUP_LIST_MS = 10000;
const setupListAsked = () => { const t = S.setupList; if (t && Date.now() - t > SETUP_LIST_MS) delete S.setupList; return !!S.setupList; };
if (typeof window === "object") { const drop = () => { if (typeof S === "object" && S) delete S.setupList; }; window.addEventListener("hashchange", drop); window.addEventListener("popstate", drop); }
const hst = () => { try { return (typeof history === "object" && history.state) || {}; } catch (e) { return {}; } };
const markStep = (o) => { try { history.replaceState(Object.assign({}, hst(), o), "", location.href); } catch (e) { /* the address is unchanged */ } };

// top: the strip (and a client's header) above both panes. list: on a phone (≤ 760 px, settings-layout.css) the list is
// shown alone, the section hidden; otherwise the section alone, full width, with "← <label>" (back) to the list. On a
// computer both panes always show (Back hidden).
function Layout({ label, groups, current, pick, children, scope, cid, foot, top, list, back }) {
  const it = groups.flatMap((g) => g.items).find((x) => x.id === current);
  // the control pressed is hidden on a phone (the list or the section goes): the focus follows to what is shown
  useEffect(() => {
    const f = Date.now() - FOCUS.at < 1000 ? FOCUS.to : ""; FOCUS = { to: "", at: 0 };
    if (!f || !phone()) return;
    const el = f === "head" ? document.querySelector("#app .sethead h2") : document.querySelector('#app .setnav button[data-set-item="' + f.slice(5) + '"]');
    if (el && el.getClientRects().length) el.focus();
  });
  return (
    <div className={"setpage" + (list ? " list-first" : "")} data-set-page={scope}>
    {top}
    <div className="setwrap">
      <SetNav label={label} groups={groups} current={current} pick={pick} foot={foot} />
      <div className="setbody">
        <p className="set-back"><button type="button" className="linkbtn" data-set-back="" onClick={back}>{"← " + label}</button></p>
        <BackTo />
        <header className="sethead"><h2 tabIndex={-1}>{it.label}</h2><p>{it.about}</p></header>
        {scope === "setup" && <HowPage page="setup" />}
        {/* clean-up batch 2: a section where each button acts at once has no Save bar ("Nothing to save here" beside a Save) */}
        {!(SEC_STORES[current] || []).length && /^Nothing to save here/.test(SEC_EMPTY[current] || "") ? <div className="cfm-sec" data-confirm={scope + ":" + current} data-saves-at-once="">{children}</div>
          : <Confirm id={scope + ":" + current} label={it.label} stores={SEC_STORES[current] || []} cid={cid} empty={SEC_EMPTY[current]} {...(SEC_BAR[current] || {})}>{children}</Confirm>}
      </div>
    </div>
    </div>
  );
}

const Card = ({ title, note, danger, children }) => (
  <section className={"setcard" + (danger ? " danger" : "")}>
    {title && <h3>{title}</h3>}{note && <p className="note">{note}</p>}{children}
  </section>
);

/* ---------------------------------------------------------------- for the firm */

function FirmDetails() {
  const setAddr = (v) => { S.firm.firmAddress = v; later("firm", () => Store.saveFirm(), 600); FinComReact.redraw(); };
  const pick = (ev) => { const f = ev.target.files && ev.target.files[0]; if (f) firmLogoRead(f).then((logo) => { S.firm.firmLogo = logo; Store.saveFirm(); render(); }, (e) => toast(e.message)); };
  return <Card title="Name, address and logo" note="Shown at the top of every page, and on reports, letters and MIS packs prepared for clients.">
    <div className="grid"><label className="f"><span>Firm name</span>
      <input type="text" value={S.firm.firmName || ""} onChange={(ev) => { firmSetName(ev.target.value); FinComReact.redraw(); }} /></label>
      <label className="f wide"><span>Address</span><textarea rows={2} value={S.firm.firmAddress || ""} onChange={(ev) => setAddr(ev.target.value)} /></label>
      <label className="f"><span>Logo</span><LogoPick has={!!S.firm.firmLogo} onChange={pick} /></label>
      {S.firm.firmLogo && <div><img src={S.firm.firmLogo} alt="Logo" style={{ maxHeight: 48 }} /> <button className="linkbtn" onClick={() => { S.firm.firmLogo = ""; Store.saveFirm(); render(); }}>Remove</button></div>}</div>
  </Card>;
}

// what needs the firm, from what the page already holds (nothing is asked for it):
//   this person's OWN computer with Tally (FCOwn.bridge: their own bridge's computer; another person's computer offline is
//   not theirs to fix, grey elsewhere, next-tally-own-status M4), heard this week with Tally but not now, and only while
//   the computers were read a moment ago (TLight; never while that read is failing, or before it is read again after
//   the tab was hidden)
//   the GST API links that lapsed: a client's GSTIN that once had a session (connected, ended or failed) and is not live
//   now; a GSTIN only looked up (GSTAPI.seen, set by every 2B page's card before the server answers) is not counted
const WEEK = 7 * 864e5;
function firmSignals() {
  const beatOf = (d) => (((d && d.info) || {}).beat || {}), beatAt = (d) => Date.parse(beatOf(d).at || (d && d.last_seen) || "") || 0;
  const TL = typeof TLight === "object" ? TLight.st || {} : {};
  // read within 3 minutes (a beat every 30 s), each beat's age told as of that read (devState at TL.at), not as of now
  const fresh = !!TL.at && Date.now() - TL.at < 180000 && !(typeof TStale === "object" && TStale.now(["light"]));
  let own = null, answers = false;
  try { own = window.FCOwn && window.FCOwn.bridge ? window.FCOwn.bridge() : null; answers = !!(window.FCOwn && window.FCOwn.state && (window.FCOwn.state() || {}).state === "ok"); } catch (e) { own = null; }
  const liveAtRead = (d) => { try { const b = typeof devState === "function" ? devState(d, TL.at).bridge : ""; return b === "online" || b === "reconnecting"; } catch (e) { return pcLive(d); } };
  const dev = own && own.dev && tallyDevs().find((d) => d.id === own.dev.id);
  const hadTally = (d) => { const b = beatOf(d); return !!b.tally || b.tallyState === "open" || b.tallyState === "busy" || openOn(d).length > 0; };
  // (their bridge answering this browser now: the top bar says Connected, so nothing here says otherwise)
  const off = fresh && !answers && dev && beatAt(dev) && TL.at - beatAt(dev) < WEEK && hadTally(dev) && !liveAtRead(dev) ? [dev] : [];
  const G = typeof GSTAPI === "object" ? GSTAPI : null;
  const gstins = Array.from(new Set(Object.values(S.companies || {}).filter((c) => c && !c.deleted).map((c) => String(c.gstin || "").toUpperCase()).filter((g) => /^\d{2}[A-Z0-9]{13}$/.test(g))));
  const lapsed = G ? gstins.filter((g) => { const x = (G.sess || {})[g]; return !!x && !!(x.connectedAt || x.endedAt || x.error) && !G.live(g); }).length : 0;
  const soon = G ? gstins.filter((g) => { const x = G.live(g) && G.accessLeft ? G.accessLeft(g) : null; return x && x.soon && !x.over; }).length : 0;
  return { off, offSince: off.length ? seenWords(new Date(beatAt(off[0])).toISOString()) : "", notLinked: lapsed, soon };
}
const plural = (n, one, many) => n + " " + (n === 1 ? one : many || one + "s");

function firmGroups(sig = firmSignals()) {
  const a = S.account, tally = tallyStatus(null).label;
  const gstApi = (() => { const xs = Object.values(GSTAPI.sess || {}).filter(Boolean); const soon = xs.filter((x) => x.accessUntil && Date.parse(x.accessUntil) - Date.now() < 3 * 86400000 && !x.endedAt).length; return xs.filter((x) => GSTAPI.live && x.connectedAt && !x.endedAt).length + " connected" + (soon ? ", " + soon + " ending soon" : ""); })();
  const groups = [
    { title: "Your firm", items: [
      { id: "firm", label: "Firm details", about: "The firm’s name, as it appears on the page and on what you give clients.", status: S.firm.firmName || "no name yet", warn: !S.firm.firmName },
      { id: "account", label: "Sign-in and people", about: "Who is signed in, the people in the firm and what each may do, and keeping work in step across computers.",
        status: Cloud.on() ? (a && a.me ? a.me.email : "signed in") : "not signed in" },
      ...(Cloud.on() ? [{ id: "batches", label: "Academy batches", about: "Classes by video call: a batch's members and Start class.", status: "" }] : []),
      { id: "plan", label: "Plan and credit", about: "What the firm pays, the credit left, and this month’s use.",
        status: a && a.firm ? money(num(a.firm.balance)) + " left" : "", tip: a && a.firm ? (a.firm.plan ? a.firm.plan.name : "no plan") + " · " + money(num(a.firm.balance)) + " left" : "" },
    ] },
    { title: "Tally", items: [
      { id: "bridge", label: "Connect Tally", about: "Connecting Tally, its companies and clients, and help: all on the one Tally page in the sidebar.",
        status: sig.off.length ? "1 offline" : tally, warn: !!sig.off.length, tip: "Tally: " + tally + (sig.off.length ? " · your computer with Tally is offline" : "") },
      ...(Cloud.on() ? [{ id: "tcloud", label: "Books in the cloud", about: "The computers that send Tally’s books to the firm account (which company is which client: the Tally page).",
        status: tally, tip: "Tally: " + tally }] : []),
      { id: "postlog", label: "Sent to Tally", about: "A record of every entry posted to Tally, by whom and when: it is kept on the Tally page.", status: (S.firm.postLog || []).length + " entries" },
    ] },
    { title: "GST", items: [
      ...(Cloud.on() ? [{ id: "gstapi", label: "GST API, all clients", about: "Every client's GST portal connection: until when, the returns fetched, the e-invoice user.",
        status: sig.notLinked ? sig.notLinked + " not linked" : sig.soon ? sig.soon + " ending soon" : gstApi, warn: !!(sig.notLinked || sig.soon), tip: gstApi + (sig.notLinked ? ", " + sig.notLinked + " not linked" : "") }] : []),
    ] },
    { title: "How the work is done", items: [
      { id: "rates", label: "TDS rates and limits", about: "The rates and yearly limits used to work out TDS on every client’s bills.", status: "FY " + (S.firm.fy || "2026-27"), tip: "tax year " + (S.firm.fy || "2026-27") },
      { id: "reading", label: "Reading bills", about: "How bills and statements are read — free reading first, then Google OCR or Claude — and a test of each.",
        status: S.engine === "api" ? "free, then Claude" : hasGoogle() ? "free, then Google OCR" : "free reading only",
        tip: S.engine === "api" ? "free steps, then Claude" : hasGoogle() ? "free steps, then Google OCR" : "free reading only" },
      { id: "ai", label: "AI help", about: "Claude’s suggestions in TDS, GST, audit and notices: on or off.", status: AIH.sub() },
      { id: "autopost", label: "Post automatically", about: "Bank lines and purchase bills that copy what a person approved before go to Tally by themselves; the rest waits for you. Off unless switched on, client by client.",
        ...(() => { const all = Object.values(S.companies || {}), n = all.filter((c) => c.choices && c.choices.autopost && c.choices.autopost.value && c.choices.autopost.value.on).length; return n ? { status: "on for " + n + " of " + all.length, tip: "on for " + n + " of " + all.length + " clients" } : { status: "off" }; })() },
      { id: "moves", label: "Move on by itself", about: "When a piece of work ends, the page opens what comes next. It never approves, posts or sends anything to Tally, never moves while you are typing or have unsaved changes, and says so with Stay here; Back undoes it.",
        status: Smart.KINDS.filter(([k]) => Smart.on(k)).length + " of " + Smart.KINDS.length + " on" },
    ] },
  ];
  return groups.filter((g) => g.items.length);
}

// Needs you: each thing to do, as a link to its section (only sections the list has)
function firmNeeds(sig, ids) {
  const out = [];
  if (!S.firm.firmName) out.push({ id: "firm", text: "The firm’s name is not set" });
  if (sig.off.length) out.push({ id: "bridge", text: "Your computer with Tally is offline" + (sig.offSince ? " since " + sig.offSince : "") });
  if (sig.notLinked) out.push({ id: "gstapi", text: "GST API not linked for " + plural(sig.notLinked, "client") });
  if (sig.soon) out.push({ id: "gstapi", text: "GST API link ends soon for " + plural(sig.soon, "client") });
  return out.filter((x) => ids.includes(x.id));
}

// the records kept on this computer (clean-up batch 2: it was a line on the Clients page), with the plan
function RecordsUsed() {
  const all = Object.values(S.companies || {}), used = all.reduce((a, c) => a + num((c.stats || {}).records || 1), 0) + Object.keys(S.inbox || {}).length + 1;
  return <Card title="Records on this computer"><p className="note" data-records-used="" style={{ margin: 0 }}>{"About " + INR0.format(used) + " of " + INR0.format(DB_LIMIT) + " records used"}</p></Card>;
}

// Move on by itself (smart moves round 1): one switch for each kind of move, on unless turned off (Smart, src/js/64)
function MoveSwitches() {
  const [, redraw] = useState(0);
  return <Card title="After a piece of work" note="With a switch off, the page stays where it is and a message offers the same step as a button.">
    <div data-move-switches="">{Smart.KINDS.map(([k, when, what]) => <label key={k} className="chk" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0" }}>
      <input type="checkbox" data-move={k} checked={Smart.on(k)} onChange={(ev) => { Smart.set(k, ev.target.checked); redraw((n) => n + 1); render(); }} />
      <span><b>{when}</b><br /><span className="note">{what}</span></span></label>)}</div>
  </Card>;
}

// console phase 1b (27-Oct-2026): platform administration (firms, plans, prices, credit, AI keys, new firms) is FinCom's
// console now; FinCom's own people (platform_admins) get one small link to it, in a new tab. The address is the build's:
// console-staging.fincom.live for the testing site, console.fincom.live for the live one (app/console.json)
function AdminConsoleLink() {
  if (!(typeof FirmGate === "object" && FirmGate.admin())) return null;
  return <div className="setgroup" data-admin-console=""><div className="setgroup-t">FinCom</div>
    <a className="linkbtn" href={__CONSOLE_URL__} target="_blank" rel="noopener noreferrer" style={{ display: "block", padding: "6px 10px" }}>Admin console ↗</a></div>;
}

export function FirmSettings() {
  const sig = firmSignals(), groups = firmGroups(sig), ids = groups.flatMap((g) => g.items.map((i) => i.id));
  // no section asked for (Settings in the sidebar, #/settings): Firm details on a computer, the list on a phone
  const list = !ids.includes(S.settingsTab);
  const cur = list ? "firm" : S.settingsTab;
  const pick = (id) => { focusNext("head"); S.settingsTab = id; render(); if (list && S.settingsTab === id && phone()) markStep({ fcSetFrom: 1 }); window.scrollTo(0, 0); };
  const back = () => { focusNext("list:" + cur); if (hst().fcSetFrom) history.back(); else { S.settingsTab = null; render(); } window.scrollTo(0, 0); };
  const body = {
    firm: () => <FirmDetails />,
    account: () => <><FirmAccount />{Cloud.on() && <PeopleEtc />}</>,
    plan: () => <><PlanCredit /><Suspense fallback={null}><CouponBox /></Suspense><RecordsUsed /></>,
    batches: () => <Suspense fallback={<p className="note">Loading…</p>}><Batches /></Suspense>,
    // clean-up batch 2: one home each, the Tally page; here one line that leads there
    bridge: () => <Card><HomeLink id="bridge" text="Tally is connected in one place: the Tally page (its companies, which client each is, and help). Nothing to set here." link="Open the Tally page" go={() => goTallyPage("computers")} /></Card>,
    tcloud: () => <CloudBooks />,
    postlog: () => <Card><HomeLink id="sent" text="One record for every client: what was sent, by whom and when." link="Open it on the Tally page" go={() => { goTallyPage("sent"); S.logAll = true; render(); }} /></Card>,
    gstapi: () => <GstApiAll />,
    rates: () => <Rates />,
    reading: () => <Reading />,
    ai: () => <><AiSettings />{Cloud.on() && <AssistantSettings />}</>,
    autopost: () => <AutoPostSettings />,
    moves: () => <MoveSwitches />,
  }[cur];
  // the one place for the build stamp (owner's spec K1): a small About line at the foot of Settings
  return <><Layout label="Settings" groups={groups} current={cur} pick={pick} scope="firm" cid="" foot={<AdminConsoleLink />}
      list={list} back={back} top={<NeedsStrip title="Needs you" items={firmNeeds(sig, ids)} pick={pick} />}>{body()}</Layout>
    <p className="note about-line" data-about="">{"About FinCom: this version was built on " + String(__REACT_BUILD__).replace(/^React · /, "").replace(/(\d{2}:\d{2})(?! IST)/, "$1 IST")}</p></>;
}

/* ---------------------------------------------------------------- for one client */

// a text setting of the client: kept as typed, checked (GSTIN, PAN) when the box is left
function CoText({ label, path, placeholder, choice }) {
  const co = CO(), v = path.split(".").reduce((o, k) => (o || {})[k], co);
  return <label className="f"><span>{label}{choice && <> <ChoiceTag co={co} k={choice} /></>}</span>
    <input type="text" value={v || ""} placeholder={placeholder}
      onChange={(ev) => { coSetText(path, ev.target.value); FinComReact.redraw(); }} onBlur={() => coCommit(path)} /></label>;
}
const CoCheck = ({ path, on, children }) => (
  <label className="chk"><input type="checkbox" checked={on} onChange={(ev) => coCommit(path, ev.target.checked)} /> {children}</label>
);

// the kind of entity (review of 02-Oct-2026): from the PAN's fourth letter unless chosen here; Accounts picks its
// format from it (Schedule III for a company, the ICAI format for the others)
function EntityType({ co }) {
  const e = FS.entityOf(Object.assign({}, co, { entity: "" })), fromPan = FS.ENTITY[e.code];
  return <label className="f"><span>Entity type</span>
    <select aria-label="Entity type" value={co.entity || ""} onChange={(ev) => coCommit("entity", ev.target.value)}>
      <option value="">{fromPan ? "From the PAN: " + fromPan : "From the PAN (none yet)"}</option>
      {Object.entries(FS.ENTITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>;
}

function OtherRegLedgers({ co }) {
  const others = (String(co.otherGstins || "").toUpperCase().match(/\b\d{2}[A-Z0-9]{13}\b/g) || []).filter((g) => g !== String(co.gstin || "").toUpperCase());
  const all = [String(co.gstin || "").toUpperCase()].filter(Boolean).concat(others), st = (g) => (typeof GST_STATES === "object" && GST_STATES[g.slice(0, 2)]) || g.slice(0, 2);
  // (the owner's approval of 23-Nov-2026) each GSTIN's registration name in Tally goes on every entry (src/js/01 vchGstReg)
  return <div data-gst-by-reg="" style={{ marginTop: 6 }}>
    <p className="note" style={{ margin: 0 }}>Each entry sent to Tally names its GST registration. Give each name as in Tally (Company › GST Registration Details).</p>
    <div className="grid">{all.map((g) => <CoText key={g} label={g + ": name in Tally"} path={"gstRegName." + g.slice(0, 2)} placeholder={st(g) + " Registration"} />)}</div>
    {others.length > 0 && <p className="note" style={{ margin: "6px 0 0" }}>Input GST ledgers of each other GSTIN, set once; a bill to a GSTIN without them waits. FinCom cannot read which GSTIN a ledger is for in Tally: check each is that GSTIN’s.</p>}
    {others.map((g) => <div key={g} className="grid" data-reg={g.slice(0, 2)}>{["cgst", "sgst", "igst", "cess"].map((h) => <CoText key={h} label={g + ": input " + h.toUpperCase()} path={"gstByReg." + g.slice(0, 2) + "." + h} />)}</div>)}</div>;
}

function Company() {
  const co = CO(), owner = S.account && S.account.me ? S.account.me.role === "owner" : true;
  return <Card title="The client" note="As on the client’s GST registration. The PAN is filled in from the GSTIN when left empty.">
    <div className="grid"><CoText label="Client name" path="name" /><CoText label="GSTIN" path="gstin" /><CoText label="PAN" path="pan" /><EntityType co={co} />
      <CoText label="Other GSTINs (registrations in other states)" path="otherGstins" placeholder="e.g. 29…, 33…" /></div>
    {/* (the owner, 23-Nov-2026) one Tally company with the GST ledgers of each registration: a bill to the client's other
        GSTIN then goes on without the per-bill "the GST ledgers are that GSTIN's" (compute, src/js/01) */}
    <div data-multi-gstin="" style={{ marginTop: 8 }}><CoCheck path="multiGstin" on={!!co.multiGstin}>This Tally company has more than one GSTIN</CoCheck>
      <p className="note" style={{ margin: "2px 0 0" }}>Bills to its other GSTINs go to that GSTIN’s own GST ledgers without asking each time.</p>
      {/* (review of ad4be74c3) each other GSTIN's input ledgers, picked once (gstLedgerFor, src/js/01); a bill to a GSTIN
          without them is held */}
      {co.multiGstin && <OtherRegLedgers co={co} />}</div>
    {/* review of 02-Oct-2026: a GSTIN or PAN cannot be emptied by a sync (the server keeps it); an owner clears a wrong one
        here, with a reason that is kept */}
    {owner && (co.gstin || co.pan) && <div className="row" data-clear-ids="" style={{ gap: 8, marginTop: 8 }}>
      {co.gstin && <button className="btn small" onClick={() => coClearIds(["gstin"])}>Clear a wrong GSTIN…</button>}
      {co.pan && <button className="btn small" onClick={() => coClearIds(["pan"])}>Clear a wrong PAN…</button>}</div>}
  </Card>;
}
function CompanyAndContacts() {
  return <><Company /><Card title="Contacts"><ClientContacts co={CO()} key={CO().id} /></Card><Card title="What FinCom may do by itself"><TrustLevels co={CO()} key={CO().id} /></Card></>;
}

// review item 36: bills for services post as a Journal or as a Purchase voucher, as the client books them in Tally; a
// client with its own voucher type (say "Purchase - Services", made under Purchase in Tally) types its name
function VoucherType({ co }) {
  // what bills really post as (billVt, src/js/03: the client's type, or the "Post as" a purchase sheet chose over it);
  // any choice made here is the client's, and that "Post as" goes (coCommit)
  const vt = billVt(co), known = vt === "Journal" || vt === "Purchase";
  const [other, setOther] = useState(!known);
  const pick = (v) => { setOther(v === null); coCommit("voucherType", v || co.voucherType || "Journal"); };
  return <fieldset className="f wide vtype" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
    <legend style={{ fontWeight: 600, marginBottom: 6 }}>Post purchase bills (goods and services) as</legend>
    <label className="chk"><input type="radio" name="vtype" checked={!other && vt === "Journal"} onChange={() => pick("Journal")} /> Journal voucher</label>
    <label className="chk"><input type="radio" name="vtype" checked={!other && vt === "Purchase"} onChange={() => pick("Purchase")} /> Purchase voucher <span className="note">(many clients book services through Purchase in Tally)</span></label>
    <label className="chk"><input type="radio" name="vtype" checked={other} onChange={() => pick(null)} /> Another voucher type in Tally</label>
    {other && <div style={{ margin: "4px 0 0 24px", maxWidth: 320 }}><CoText label="Its name, exactly as in Tally" path="voucherType" placeholder="Purchase - Services" /></div>}
    <p className="note" style={{ margin: "6px 0 0" }}>{"Bills now go to Tally as “" + vt + "” vouchers. The voucher type must exist in the client’s Tally company. Supplier credit notes still go as " + (co.debitNoteType || "Debit Note") + "."}</p>
  </fieldset>;
}

// review of 01-Oct-2026: where the client keeps the supplier's invoice number, for matching purchases with GSTR-2B
function SupInvFrom({ co }) {
  const how = co.supInvFrom || "ref";
  return <fieldset className="f wide supinv" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
    <legend style={{ fontWeight: 600, marginBottom: 6 }}>Supplier invoice no. is in</legend>
    {Object.entries(Books.SUPINV).map(([k, l]) => <label key={k} className="chk"><input type="radio" name="supinv" value={k} checked={how === k} onChange={() => coCommit("supInvFrom", k)} /> {l}</label>)}
    <p className="note" style={{ margin: "6px 0 0" }}>{"2B reconciliation and the inward register match purchases on the number in the " + Books.SUPINV[how].toLowerCase() + (how === "narr" ? " (the first invoice or bill number written there)" : "") + ". When it is empty they use the Reference, then the voucher no., then an invoice number in the narration."}</p>
  </fieldset>;
}

function TallySetup() {
  const co = CO(), auto = co.vchNumbering === "tally";
  // round 39: the Link to Tally card says it all: the company (linked by a person's click), the client's Tally name (its
  // More: Name differs in Tally) and the one company entries are posted into (its tick)
  return <>
    {/* zoho-books: which integration feeds the client (Tally: the Link to Tally card inside it, as before) */}
    <BooksSource co={co} where="setup" />
    <Card title="How purchase bills are entered">
      <VoucherType co={co} />
      <SupInvFrom co={co} />
      <div className="f wide vnum" style={{ marginBottom: 12 }}><span>Voucher numbering</span>
        {auto ? <div className="note"><span className="tag ok">Automatic in Tally</span> Tally gives every entry its own next number{co.vchAutoAt ? " (set " + fmtDate(String(co.vchAutoAt).slice(0, 10)) + ")" : ""}. FinCom sends no voucher numbers.{" "}
            <button className="linkbtn" onClick={() => doAct("vchUseBillNo")}>Use supplier bill numbers instead</button></div>
          : <><div className="note">FinCom sends the supplier’s bill number as the voucher number; a number already in Tally is retried with the supplier’s initials.</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn small" disabled={!(Bridge.on() && Bridge.up())} title={Bridge.on() && Bridge.up() ? undefined : "Needs FinCom Bridge and Tally open"} onClick={() => doAct("vchAuto")}>Set automatic numbering in Tally</button>
              <button className="btn small" onClick={() => doAct("vchTallyDone")}>It is set in Tally already: use Tally’s automatic numbers</button>
            </div></>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <CoCheck path="createOptional" on={!!co.createOptional}>Post purchase bills and sales invoices as Optional vouchers</CoCheck>
        <p className="note">Tally hides Optional vouchers from the Day Book until they are made regular with Ctrl+L.</p>
        <CoCheck path="billwise" on={!!co.billwise}>Add the invoice number as a bill-wise reference on the party</CoCheck>
      </div>
    </Card>
    <Card title="Ledgers used in every entry" note="Names as in Tally. Expense ledgers by payment type are under TDS.">
      <LedgerPointer />
      <div className="grid"><CoText label="Round off" path="roundOff" /></div>
    </Card>
  </>;
}

// ledger-confirm (14-Oct-2026; the owner: "we should do that from there only, so remove that from Settings"): the TDS and
// GST ledgers (input CGST / SGST / IGST, the TDS ledger of each payment type, the reverse charge ledgers) are chosen and
// confirmed on the TDS and GST pages' Ledgers (books/TaxLedgers.jsx); one line here says where
export function LedgerPointer() {
  return <p className="note" data-ledger-pointer="">Confirm TDS/GST ledgers on the TDS and GST pages:{" "}
    <button className="linkbtn" data-ledger-pointer-go="tds" onClick={() => TaxLed.go("tds")}>TDS ledgers</button>{" · "}
    <button className="linkbtn" data-ledger-pointer-go="gst" onClick={() => TaxLed.go("gst")}>GST ledgers</button></p>;
}

function RuleLedger({ kind, r }) {
  const co = CO(), v = (kind === "tds" ? co.tdsLedgers : co.expenseLedgers)[r.id] || "";
  return <><input type="text" value={v} aria-label={(kind === "tds" ? "TDS ledger for " : "Expense ledger for ") + r.label}
    onChange={(ev) => { coSetRuleLedger(kind, r.id, ev.target.value); FinComReact.redraw(); }} onBlur={() => coCommitRuleLedger(kind, r.id)} />
    {v && <div><ChoiceTag co={co} k={(kind === "tds" ? "tds:" : "exp:") + r.id} value={v} /></div>}</>;
}

// next-tds-forms-2025 (the owner, 17-Oct-2026): the deductor's details the TDS statements need (Forms 138, 140, 143, 144;
// the old 24Q / 26Q / 27Q / 27EQ read the same keys), kept as co.tds26q. Checked by the same function the files use
// (TDSF25.deductorProblems, src/js/83): each problem shown beside its field. Required fields are marked *.
// the deductor's fields (module level, so React keeps each box while typing)
const DedErr = ({ p, k }) => p[k] ? <small className="err" style={{ color: "var(--danger, #b42318)", display: "block" }}>{p[k].join(" ")}</small> : null;
// next-tds-validate-short (the owner, 26-Oct-2026: "the REQUIRED address details must be filled"): a required field still
// empty (TDSF25.deductorRequired, the one Validate & file blocks on) has a red outline and "Required" under it till filled
let DED_NEED = {};
const NEED_BOX = { outline: "1.5px solid var(--danger, #b42318)", outlineOffset: -1 };
const DedNeed = ({ k }) => DED_NEED[k] ? <small className="ded-req" data-ded-required={k} style={{ color: "var(--danger, #b42318)", display: "block" }}>{DED_NEED[k].bad ? "Not a valid TAN" : "Required"}</small> : null;
const DedLab = ({ label, req }) => <span>{label}{req && <b className="req" title="Required" aria-label="required"> *</b>}</span>;
function DedT({ p, k, label, req, max, placeholder, path }) {
  const co = CO(), pth = path || "tds26q." + k, v = pth.split(".").reduce((o, x) => (o || {})[x], co);
  return <label className={"f" + (DED_NEED[k] ? " ded-need" : "")} data-ded={k}><DedLab label={label} req={req} />
    <input type="text" value={v || ""} maxLength={max} placeholder={placeholder} aria-label={label} aria-invalid={DED_NEED[k] ? true : undefined} style={DED_NEED[k] ? NEED_BOX : undefined}
      onChange={(ev) => { coSetText(pth, ev.target.value); FinComReact.redraw(); }} onBlur={() => coCommit(pth)} /><DedNeed k={k} />{DED_NEED[k] ? null : <DedErr p={p} k={k} />}</label>;
}
function DedSel({ p, k, label, req, opts, first }) {
  const d = CO().tds26q || {};
  return <label className={"f" + (DED_NEED[k] ? " ded-need" : "")} data-ded={k}><DedLab label={label} req={req} />
    <select aria-label={label} value={d[k] || ""} aria-invalid={DED_NEED[k] ? true : undefined} style={DED_NEED[k] ? NEED_BOX : undefined} onChange={(ev) => coCommit("tds26q." + k, ev.target.value)}>
      <option value="">{first}</option>{opts.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select><DedNeed k={k} />{DED_NEED[k] ? null : <DedErr p={p} k={k} />}</label>;
}
export function DeductorDetails() {
  const co = CO(), d = co.tds26q || {}, firm = TDS26Q.firmDetails();
  const probs = {}; TDSF25.deductorProblems(firm).forEach((p) => { (probs[p.k] = probs[p.k] || []).push(p.why); });
  DED_NEED = {}; (TDSF25.deductorRequired ? TDSF25.deductorRequired(firm) : []).forEach((x) => { DED_NEED[x.k] = x; });
  // one e-mail is needed, the deductor's or the responsible person's: both boxes say so while neither is given
  if (DED_NEED.email) { DED_NEED.personEmail = DED_NEED.email; }
  const catPan = TDSF25.categoryOf(co.pan), cat = TDSF25.categoryFor(firm), govt = TDSF25.GOVT.test(cat);
  const states = Object.entries(TDSF25.STATES).map(([n, c]) => [c, c + " · " + n]);
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px 14px" };
  return <Card title="Deductor details for the TDS statements" note="Used in every TDS / TCS statement file. Fields marked * are required.">
    <div data-deductor="">
      <div style={grid}>
        <DedSel p={probs} k="deductorType" label="Deductor category" req opts={Object.entries(TDSF25.CATEGORY)} first={catPan ? "From the PAN: " + TDSF25.CATEGORY[catPan] : "From the PAN (none yet)"} />
        <DedT p={probs} k="tan" label="TAN" req max={10} path="tan" />
        <DedT p={probs} k="gstin" label="GSTIN" max={15} placeholder={co.gstin || ""} />
      </div>
      <label className="chk" data-ded="isBank"><input type="checkbox" checked={!!d.isBank} onChange={(ev) => coCommit("tds26q.isBank", ev.target.checked)} /> This client is a bank, co-operative bank or post office
        <span className="note" style={{ display: "block" }}>{d.isBank ? "Interest it pays (old 194A) is 1020 for a senior citizen or 1021 for others; FinCom asks which for each deductee (To fix). Cash withdrawals (old 194N) are 1064 / 1065." : "No: interest it pays (old 194A) is written as 1022."}</span></label>
      {govt && <div style={grid}>
        {/^[SEHN]$/.test(cat) && <DedSel p={probs} k="stateName" label="State (of the State Government)" req opts={states} first="Choose the State" />}
        {/^[ADGEHLN]$/.test(cat) && <DedSel p={probs} k="ministry" label={"Ministry" + (/^[ADG]$/.test(cat) ? "" : " (optional)")} req={/^[ADG]$/.test(cat)} opts={Object.entries(TDSF25.MINISTRIES).map(([c, n]) => [c, c + " · " + n])} first="Choose the Ministry" />}
        {d.ministry === "99" && <DedT p={probs} k="ministryOther" label="Ministry's name" req max={150} />}
        {/^[AS]$/.test(cat) && <DedT p={probs} k="ain" label="AIN of the PAO / DTO / CDDO" max={7} placeholder="7 digits, for book adjustment" />}
      </div>}
      <h4 style={{ margin: "14px 0 6px" }}>The deductor's address</h4>
      <div style={grid}>
        <DedT p={probs} k="branch" label="Branch / division (old 24Q, 26Q, 27Q, 27EQ)" max={75} />
        <DedT p={probs} k="flat" label="Flat / door / block" req max={25} /><DedT p={probs} k="postOffice" label="Post office" max={25} /><DedT p={probs} k="premises" label="Building" />
        <DedT p={probs} k="road" label="Road / street / sector" /><DedT p={probs} k="area" label="Area / locality" max={25} /><DedT p={probs} k="town" label="City / town (district)" req max={25} />
        <DedSel p={probs} k="state" label="State" req opts={states} first="Choose the State" /><DedT p={probs} k="pin" label="PIN code" req max={6} /><DedT p={probs} k="country" label="Country" max={25} placeholder="INDIA" />
        <DedT p={probs} k="email" label="E-mail" req={!d.personEmail} max={75} /><DedT p={probs} k="phoneCc" label="Phone country code" max={5} placeholder="91" /><DedT p={probs} k="phone" label="Phone" req max={10} />
      </div>
      <h4 style={{ margin: "14px 0 6px" }}>The person responsible for deducting</h4>
      <div style={grid}>
        <DedT p={probs} k="person" label="Name" req max={75} /><DedT p={probs} k="personDesignation" label="Designation" req max={20} /><DedT p={probs} k="personPan" label="PAN" req max={10} />
        <DedT p={probs} k="personFlat" label="Flat / door / block" req max={25} /><DedT p={probs} k="personPostOffice" label="Post office" max={25} /><DedT p={probs} k="personPremises" label="Building" />
        <DedT p={probs} k="personRoad" label="Road / street / sector" /><DedT p={probs} k="personArea" label="Area / locality" max={25} /><DedT p={probs} k="personTown" label="City / town (district)" req max={25} />
        <DedSel p={probs} k="personState" label="State" req opts={states} first="Choose the State" /><DedT p={probs} k="personPin" label="PIN code" req max={6} /><DedT p={probs} k="personCountry" label="Country" max={25} placeholder="INDIA" />
        <DedT p={probs} k="personEmail" label="E-mail" req={!d.email} max={75} /><DedT p={probs} k="personPhoneCc" label="Mobile country code" max={5} placeholder="91" /><DedT p={probs} k="personPhone" label="Mobile" req max={10} />
      </div>
    </div>
  </Card>;
}

function TdsSetup() {
  const co = CO();
  return <>
    <Card title="Does this client deduct TDS?">
      <div className="stack" style={{ gap: 8 }}>
        <CoCheck path="mustDeduct" on={co.mustDeduct !== false}>This client has to deduct TDS</CoCheck>
        <p className="note">Companies, firms and LLPs always deduct. An individual or HUF deducts only if last year’s business turnover was above ₹1 crore, or professional receipts above ₹50 lakh. Untick this and no TDS is worked out for any bill of this client.</p>
        <CoCheck path="turnover10cr" on={!!co.turnover10cr}>Turnover last year was above ₹10 crore</CoCheck>
        <p className="note">Needed for TDS on purchase of goods.</p>
        <CoCheck path="bookTds" on={co.bookTds !== false}>Book TDS in purchase entries</CoCheck>
        <p className="note">Untick if this client books TDS separately, for example at the time of payment. TDS is still worked out and shown.</p>
      </div>
    </Card>
    <DeductorDetails />
    <Card title="Expense ledger by payment type" note="The expense ledger a bill goes to unless you choose another.">
      <LedgerPointer />
      <div className="tblwrap"><table className="data" data-statement="">
        <thead><tr><th>Payment type</th><th>Default expense ledger</th></tr></thead>
        <tbody>{rules().map((r) => <tr key={r.id}><td>{r.label}</td><td><RuleLedger kind="exp" r={r} /></td></tr>)}</tbody>
      </table></div>
    </Card>
    <p className="note">Each supplier’s PAN, usual payment type and amounts credited before FinCom: <button className="linkbtn" onClick={() => goTab("deductees")}>Suppliers</button>.</p>
  </>;
}


function GstSetup() {
  const co = CO();
  return <>
    <GstSettings clientWide={<Card title="Blocked credit, section 17(5)" note="Flag: suggest on matching bills, and you accept or reject. Always blocked: applied by itself (it can still be unticked on a bill). Credit allowed: never flagged — for example a car dealer buying motor vehicles.">
      <div className="tblwrap"><table className="data" data-statement="">
        <thead><tr><th>Kind of purchase</th><th>Section</th><th>For this client</th></tr></thead>
        <tbody>{BLOCK_CATS.map((b) => <tr key={b.id}><td>{b.label}</td><td>{b.sec}</td>
          <td><select aria-label={"Blocked credit: " + b.label} value={blockRule(co, b.id)} onChange={(ev) => coSetBlockRule(b.id, ev.target.value)}>
            <option value="flag">Flag for review</option>{!b.flagOnly && <option value="block">Always blocked</option>}<option value="allow">Credit allowed</option></select>
            {b.flagOnly && <div className="nr">Flag only: never blocked by itself{b.id === "construction" ? " (repairs and plant and machinery are allowed)" : " (vehicles over 13 seats, dealers and transporters are allowed)"}.</div>}</td></tr>)}</tbody>
      </table></div>
    </Card>} />
    <LedgerPointer />
  </>;
}

function Remove() {
  const co = CO();
  return <Card title="Remove this client" danger note="Deletes this client from FinCom, with all its bills, bank statements and suppliers. Nothing in Tally is touched.">
    <button className="btn danger" onClick={() => doAct("delCo")}>Remove {co.name}…</button>
  </Card>;
}

// the client's bank accounts and suppliers as Tally has them (review of 01-Oct-2026: Client setup said "0 accounts,
// 3 suppliers"): the ledgers under Bank Accounts (and the bank OD / OCC groups) and under Sundry Creditors
function tallyCounts(co) {
  const b = S.books && (!S.books.cid || S.books.cid === co.id) ? S.books : null;
  if (!b) return null;
  const names = Array.from(new Set(Object.keys(b.under || {}).concat(Object.keys(b.ledInfo || {}))));
  if (!names.length) return null;
  const inG = (l, gs) => gs.some((g) => FC.inGroup(l, g));
  return { bank: names.filter((l) => inG(l, ["Bank Accounts", "Bank OD A/c", "Bank OCC A/c"])).length, sup: names.filter((l) => inG(l, ["Sundry Creditors"])).length };
}

// where the client stands, from what is already on the page (nothing is asked for it): its name, GSTIN and PAN; its Tally
// company (or Zoho Books); the TDS deductor's required details (TDSF25.deductorRequired, as Validate & file checks them);
// the suppliers kept without a PAN; each GSTIN's GSTR-2B (portal) username, once the client's books are open here; its
// bank accounts. done: true / false for a section whose state is known, undefined when it is not (left out of "N of M").
// A section is not done only when it is also in To finish (clientNeeds): a client with no GST registration (a PAN, no
// GSTIN: TDS only) has nothing to finish for GST; the bank accounts of a client whose books come from Tally (or Zoho) are
// not known until its ledgers are read
function clientSignals(co) {
  const tc = tallyCounts(co), here = (co.bankAccounts || []).length, parties = Object.values(D().parties || {}), supNew = pendingSuppliers().length;
  const zoho = typeof booksSourceOf === "function" && (booksSourceOf(co) || {}).kind === "zoho", ts = clientTallyState(co);
  let dedMissing;
  try { dedMissing = co.mustDeduct === false ? 0 : typeof TDSF25 === "object" && TDSF25.deductorRequired && typeof TDS26Q === "object" ? TDSF25.deductorRequired(TDS26Q.firmDetails()).length : undefined; } catch (e) { dedMissing = undefined; }
  const b = S.books && S.books.cid === co.id && !S.books.loading ? S.books : null;
  let regs = null;
  try { regs = b && typeof GSTR === "object" && typeof GSTSet === "object" ? GSTR.gstins(b) || [] : null; } catch (e) { regs = null; }
  const noUser = regs ? regs.filter((g) => !GSTSet.peek(g.slice(0, 2)).portalUser) : [];
  const pan = typeof clientPan === "function" ? clientPan(co) : String(co.pan || "").trim();
  const accs = tc ? tc.bank : here, banksKnown = !!tc || here > 0 || (!zoho && ts.state === "unlinked");
  return { tc, here, accs, banksKnown, pan, sup: tc ? tc.sup : parties.length, known: parties.length, supNew, zoho, ts,
    noPan: parties.filter((p) => p && !p.noTds && !String(p.pan || "").trim()).length, dedMissing, regs, noUser };
}

function clientGroups(co = CO(), sig = clientSignals(co)) {
  const { tc, here, accs, sup, known, supNew, ts } = sig;
  const label = Object.fromEntries(SETUP_TABS);
  const it = (id, about, status, more) => Object.assign({ id, label: label[id], about, status }, more);
  const gstState = (g) => (typeof GSTRegs === "object" ? g.slice(0, 2) + " · " + GSTRegs.state(g) : g);
  return [
    { title: "The client", items: [
      it("settings", "Who the client is: name, GSTIN and PAN.", co.gstin || (sig.pan ? "no GSTIN" : "no PAN yet"), { warn: !sig.pan, done: !!sig.pan, tip: co.gstin || !sig.pan ? undefined : "no GSTIN (not registered for GST) · PAN " + sig.pan }),
      it("cotally", "How entries are numbered and the round-off ledger; the client's company in Tally is on the Tally page.", sig.zoho ? "Zoho Books" : ts.word,
        { tip: sig.zoho ? undefined : "Tally: " + ts.word + (ts.company ? " · " + ts.company : ""), warn: !sig.zoho && ts.state === "unlinked", done: sig.zoho || ts.state !== "unlinked" }),
    ] },
    { title: "Tax", items: [
      it("cotds", "Whether the client deducts TDS, and the expense ledger of each payment type (TDS ledgers: on the TDS page).", co.mustDeduct === false ? "does not deduct" : sig.dedMissing ? sig.dedMissing + " to fill" : "deducts TDS",
        { warn: !!sig.dedMissing, done: sig.dedMissing === undefined ? undefined : !sig.dedMissing, tip: sig.dedMissing ? "deducts TDS · deductor details: " + sig.dedMissing + " required to fill" : undefined }),
      it("deductees", "Each supplier’s PAN and usual payment type, and amounts credited before FinCom, so yearly limits are right.", sig.noPan ? sig.noPan + " no PAN" : plural(sup, "supplier"),
        { warn: !!sig.noPan, done: !sig.noPan, tip: sup + " supplier" + (sup === 1 ? "" : "s") + (tc ? " in Tally (Sundry Creditors)" + (known ? ", " + known + " with details here" : "") : "") + (supNew ? " + " + supNew + " new, not yet approved" : "") + (sig.noPan ? " · " + sig.noPan + " without a PAN" : "") }),
      it("gstset", "GST registrations and how each is filed, and which purchases have blocked credit (GST ledgers: on the GST page).", !sig.regs ? "" : sig.noUser.length ? sig.noUser.length + " to finish" : plural(sig.regs.length, "GSTIN"),
        { warn: !!sig.noUser.length, done: !sig.regs || !sig.regs.length ? undefined : !sig.noUser.length, tip: sig.noUser.length ? "GSTR-2B username missing for " + sig.noUser.map(gstState).join(", ") : undefined }),
    ] },
    { title: "Bank", items: [
      it("bankset", "The client’s bank accounts and the Tally ledger of each.", sig.banksKnown ? plural(accs, "account") : "",
        { warn: sig.banksKnown && !accs, done: sig.banksKnown ? accs > 0 : undefined, tip: accs + " account" + (accs === 1 ? "" : "s") + (tc ? " in Tally (Bank Accounts)" + (here ? ", " + here + " with statements here" : "") : "") }),
      it("bankrules", "Rules that give bank lines their ledger by themselves, for this client or the whole firm.", ""),
    ] },
    { title: "Books", items: [
      it("coclosed", "Periods already closed or filed: FinCom warns before posting an entry dated in one.", ""),
      it("cosheets", "The formats of purchase and sales registers FinCom has learnt (sheets, PDF tables, JSON): rename, delete or map one again.",
        (typeof SheetFmt === "object" ? SheetFmt.saved(co.id).length : 0) + " saved"),
    ] },
  ];
}

// To finish: each thing still to do for the client, as a link to its section (a GSTIN's: that GSTIN chosen)
function clientNeeds(co, sig) {
  const out = [];
  if (!sig.pan) out.push({ id: "settings", text: "No PAN yet" });
  if (!sig.zoho && sig.ts.state === "unlinked") out.push({ id: "cotally", text: "Not linked to its company in Tally" });
  if (sig.dedMissing) out.push({ id: "cotds", text: "TDS deductor details: " + sig.dedMissing + " to fill" });
  if (sig.noPan) out.push({ id: "deductees", text: plural(sig.noPan, "supplier") + " without PAN" });
  const gs = sig.noUser.map((g) => ({ id: "gstset", reg: g.slice(0, 2), text: "GSTR-2B username missing for " + g.slice(0, 2) + (typeof GSTRegs === "object" ? " · " + GSTRegs.state(g) : "") }));
  out.push(...(gs.length > 2 ? [{ id: "gstset", reg: gs[0].reg, text: "GSTR-2B username missing for " + gs.length + " GSTINs" }] : gs));
  if (sig.banksKnown && !sig.accs) out.push({ id: "bankset", text: "No bank account yet" });
  return out;
}

// the client at the top: name, GSTIN, PAN, its Tally (or Zoho Books), and how many of the sections with a known state are done
function ClientHead({ co, sig, items, more }) {
  const known = items.filter((x) => x.done !== undefined), done = known.filter((x) => x.done).length;
  const books = sig.zoho ? "Zoho Books" : "Tally: " + sig.ts.word + (sig.ts.company ? " · " + sig.ts.company : "");
  return <div className="set-client" data-set-client="">
    <div className="set-client-id"><b className="set-client-name">{co.name}</b>
      <span className="note">{"GSTIN " + (co.gstin || "none") + " · PAN " + (sig.pan || "not set") + " · " + books}</span></div>
    {known.length > 0 && <div className="set-client-prog" data-set-progress={done + "/" + known.length}>
      <span><b>{done + " of " + known.length}</b> set up</span>
      <div className="set-bar" role="progressbar" aria-label="Sections set up" aria-valuemin={0} aria-valuemax={known.length} aria-valuenow={done}><i style={{ width: Math.round((100 * done) / known.length) + "%" }} /></div></div>}
    {more}
  </div>;
}

// on a phone, the list is shown first when Client setup is opened from the sidebar (Side.jsx: S.setupList), and on the
// step of the browser's history it was shown on (fcSetList, with Company's address); a link or an address to any section,
// Company too, opens that section. "← Client setup" goes back to the list's step, or shows the list where none came before
export function ClientSetup() {
  const co = CO(), tab = S.tab;
  // the sidebar's Client setup: the step it opened (written after this drawing, Route.sync) is the list's
  // (a moment later: the address is written once the drawing is done)
  useEffect(() => { if (setupListAsked()) setTimeout(() => { if (setupListAsked()) { delete S.setupList; markStep({ fcSetList: 1, fcSetFrom: 0 }); } }, 0); });
  const body = {
    settings: () => <CompanyAndContacts />,
    cotally: () => <TallySetup />,
    cotds: () => <TdsSetup />,
    deductees: () => <Parties />,
    gstset: () => <GstSetup />,
    bankset: () => <BankSetup which="accounts" />,
    bankrules: () => <BankSetup which="rules" />,
    coclosed: () => <ClosedPeriods co={co} />,
    cosheets: () => <SheetFormats />,
    coremove: () => <Remove />,
  }[tab] || (() => <Company />);
  const sig = clientSignals(co), groups = clientGroups(co, sig), cur = isSetupTab(tab) && tab !== "coremove" ? tab : "settings";
  const list = cur === "settings" && (setupListAsked() || !!hst().fcSetList);
  const pick = (id) => {
    focusNext("head");
    // from the list, on a phone: the section is a new step (Company's has the list's address, so it is added here)
    if (list && id === S.tab) { delete S.setupList; if (phone()) try { history.pushState({ fcSetFrom: 1 }, "", location.href); } catch (e) { /* no history */ } render(); }
    else { delete S.setupList; goTab(id); if (list && S.tab === id && phone()) markStep({ fcSetFrom: 1, fcSetList: 0 }); }
    window.scrollTo(0, 0);
  };
  const back = () => { focusNext("list:" + cur); if (hst().fcSetFrom) history.back(); else { S.setupList = Date.now(); if (S.tab === "settings") render(); else goTab("settings"); } window.scrollTo(0, 0); };
  // removing the client is out of the way, in More, behind the client's name (review of 02-Oct-2026)
  const more = <details className="bk-menu" data-more="client"><summary className="btn small">More</summary><div className="bk-menu-list">
    <button className="danger" onClick={() => doAct("delCo")}>Remove this client<small>Asks for the client’s name. The firm account keeps its data, marked removed.</small></button>
  </div></details>;
  return <Layout label="Client setup" groups={groups} current={cur} pick={pick} scope="setup" cid={co.id} list={list} back={back}
    top={<><ClientHead co={co} sig={sig} items={groups.flatMap((g) => g.items)} more={more} />
      <NeedsStrip title="To finish" items={clientNeeds(co, sig)} pick={(id, x) => { if (x && x.reg) { S.gsetReg = x.reg; S.gsetTab = "regs"; } pick(id); }} /></>}>{body()}</Layout>;
}
