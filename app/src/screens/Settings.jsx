// Settings, in two places that look and work the same way: a list of sections on the left, one section on the right.
//   FirmSettings — for the whole firm (Settings in the sidebar when no client is open). The section is S.settingsTab.
//   ClientSetup  — for the open client (Client setup). The section is S.tab, one of SETUP_TABS (src/js/02).
// Was the tiles page (settingsTiles, viewRules in src/js/18) and viewCompanySettings (src/js/27), which put the
// company, Tally, TDS and GST settings on one long page.
//
// Each section is one draft (review 18: parts/Confirm.jsx, src/js/60): what is typed or picked is checked as before
// (coSetText, coCommit, coCommitRuleLedger, …) but saved, and sent to the cloud, only when Save at its foot is pressed;
// leaving with unsaved changes asks. Sections not yet redrawn in React show the old screen's HTML through <Legacy>.
import { SheetFormats } from "../parts/SheetPanel.jsx";
import HowPage from "../parts/HowPage.jsx";
import { useState } from "react";
import Confirm, { ChoiceTag } from "../parts/Confirm.jsx";
import Legacy from "../parts/Legacy.jsx";
import { AiSettings } from "../parts/Ai.jsx";
import { AssistantSettings } from "../parts/AssistantSettings.jsx";
import { CloudBooks } from "./Tally.jsx";
import HomeLink, { goTallyPage } from "../parts/HomeLink.jsx";
import TallyLink from "../parts/TallyLink.jsx";
import BooksSource from "../parts/BooksSource.jsx";
import { PlanCredit, FirmAccount, PeopleEtc, Platform } from "./Account.jsx";
import { Rates, Reading, ClosedPeriods } from "./SettingsMore.jsx";
import { BankSetup } from "../parts/BankSettings.jsx";
import GstSettings from "./gst/GstSettings.jsx";
import Parties from "./Parties.jsx";
import GstApiAll from "./GstApiAll.jsx";
import LogoPick from "../parts/LogoPick.jsx";

// the list on the left: groups of sections; each section has a label and, below it, where it stands now
function SetNav({ label, groups, current, pick }) {
  return (
    <nav className="setnav" aria-label={label}>
      {groups.map((g) => (
        <div className="setgroup" key={g.title}>
          <div className="setgroup-t">{g.title}</div>
          {g.items.map((it) => (
            <button key={it.id} className={it.danger ? "danger" : undefined} aria-current={current === it.id ? "page" : undefined} onClick={() => pick(it.id)}>
              <span>{it.label}</span>{it.status && <small>{it.status}</small>}
            </button>
          ))}
        </div>
      ))}
    </nav>
  );
}

// what each section changes (its draft: src/js/60, draftStore); a section with none has only buttons that act at once
const GST_BOOK_KEYS = "books:gstSet,gstOpen,itcBasis,rule37On,gstCashLedger,gstAato,gstContacts,gstApi,gstEst,gstRegs,rev";
const SEC_STORES = { settings: ["client"], cotally: ["client"], cotds: ["client"], deductees: ["parties"], gstset: ["client", GST_BOOK_KEYS], bankset: ["client"], coclosed: ["client"],
  firm: ["firm"], rates: ["firm"], ai: ["firm"], reading: ["reading"] };
const SEC_EMPTY = { cosheets: "Each change acts at once; a format deleted is kept, with who and why.", bankrules: "Each rule is saved from its own box (New rule, Change); a rule deleted is asked first.", account: "Nothing to save here: each button acts at once.",
  plan: "Nothing to save here.", moves: "Each switch acts at once. It is kept in this browser, for you only.", bridge: "Nothing to save here: each button acts at once.", tcloud: "Nothing to save here: each button acts at once.", postlog: "Nothing to save here.", gstapi: "Nothing to save here.", platform: "Nothing to save here: each button acts at once." };

// "← Back to Post to Tally": a setup page reached from another page leads back to it (smart moves round 1, Smart.setReturn)
export function BackTo() {
  const back = typeof Smart === "object" ? Smart.returnHere() : null;
  if (!back) return null;
  return <p className="back-to"><button className="linkbtn" data-back-to="" onClick={() => Smart.goBack()}>{"← Back to " + back.label}</button></p>;
}

function Layout({ label, groups, current, pick, children, scope, cid }) {
  const it = groups.flatMap((g) => g.items).find((x) => x.id === current);
  return (
    <div className="setwrap">
      <SetNav label={label} groups={groups} current={current} pick={pick} />
      <div className="setbody">
        <BackTo />
        <header className="sethead"><h2>{it.label}</h2><p>{it.about}</p></header>
        {scope === "setup" && <HowPage page="setup" />}
        {/* clean-up batch 2: a section where each button acts at once has no Save bar ("Nothing to save here" beside a Save) */}
        {!(SEC_STORES[current] || []).length && /^Nothing to save here/.test(SEC_EMPTY[current] || "") ? <div className="cfm-sec" data-confirm={scope + ":" + current} data-saves-at-once="">{children}</div>
          : <Confirm id={scope + ":" + current} label={it.label} stores={SEC_STORES[current] || []} cid={cid} empty={SEC_EMPTY[current]}>{children}</Confirm>}
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

function firmGroups() {
  const a = S.account, sa = !!(a && a.superadmin);
  const groups = [
    { title: "Your firm", items: [
      { id: "firm", label: "Firm details", about: "The firm’s name, as it appears on the page and on what you give clients.", status: S.firm.firmName || "no name yet" },
      { id: "account", label: "Sign-in and people", about: "Who is signed in, the people in the firm and what each may do, and keeping work in step across computers.",
        status: Cloud.on() ? (a && a.me ? a.me.email : "signed in") : "not signed in" },
      { id: "plan", label: "Plan and credit", about: "What the firm pays, the credit left, and this month’s use.",
        status: a && a.firm ? (a.firm.plan ? a.firm.plan.name : "no plan") + " · " + money(num(a.firm.balance)) + " left" : "" },
    ] },
    { title: "Tally", items: [
      { id: "bridge", label: "Connect Tally", about: "Connecting Tally (six steps), its status, and help: all on the one Tally page in the sidebar.",
        status: "Tally: " + tallyStatus(null).label + (Bridge.on() && Bridge.up() && !Bridge.st.tallyUp ? " (bridge here running, Tally not open)" : "") },
      { id: "tcloud", label: "Books in the cloud", about: "Computers that send Tally’s books to the firm account, and which Tally company is which client.",
        status: "Tally: " + tallyStatus(null).label },
      { id: "postlog", label: "Sent to Tally", about: "A record of every entry posted to Tally, by whom and when: it is kept on the Tally page.", status: (S.firm.postLog || []).length + " entries" },
    ] },
    { title: "GST", items: [
      { id: "gstapi", label: "GST API, all clients", about: "Every client's GST portal connection: until when, the returns fetched, the e-invoice user.",
        status: (() => { const xs = Object.values(GSTAPI.sess || {}); const soon = xs.filter((x) => x.accessUntil && Date.parse(x.accessUntil) - Date.now() < 3 * 86400000 && !x.endedAt).length; return xs.filter((x) => GSTAPI.live && x.connectedAt && !x.endedAt).length + " connected" + (soon ? ", " + soon + " ending soon" : ""); })() },
    ] },
    { title: "How the work is done", items: [
      { id: "rates", label: "TDS rates and limits", about: "The rates and yearly limits used to work out TDS on every client’s bills.", status: "tax year " + (S.firm.fy || "2026-27") },
      { id: "reading", label: "Reading bills", about: "How bills and statements are read — free reading first, then Google OCR or Claude — and a test of each.",
        status: S.engine === "api" ? "free steps, then Claude" : hasGoogle() ? "free steps, then Google OCR" : "free reading only" },
      { id: "ai", label: "AI help", about: "Claude’s suggestions in TDS, GST, audit and notices: on or off.", status: AIH.sub() },
      { id: "moves", label: "Move on by itself", about: "When a piece of work ends, the page opens what comes next. It never approves, posts or sends anything to Tally, never moves while you are typing or have unsaved changes, and says so with Stay here; Back undoes it.",
        status: Smart.KINDS.filter(([k]) => Smart.on(k)).length + " of " + Smart.KINDS.length + " on" },
    ] },
  ];
  if (sa) groups.push({ title: "Administrator", items: [{ id: "platform", label: "Platform", about: "All firms, credit, plans, prices and keys.", status: S.adminData ? (S.adminData.firms || []).length + " firms" : "" }] });
  return groups;
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

export function FirmSettings() {
  const groups = firmGroups(), ids = groups.flatMap((g) => g.items.map((i) => i.id));
  const cur = ids.includes(S.settingsTab) ? S.settingsTab : "firm";
  const pick = (id) => { S.settingsTab = id; render(); window.scrollTo(0, 0); };
  const body = {
    firm: () => <FirmDetails />,
    account: () => <><FirmAccount />{Cloud.on() && <PeopleEtc />}</>,
    plan: () => <><PlanCredit /><RecordsUsed /></>,
    // clean-up batch 2: one home each, the Tally page; here one line that leads there
    bridge: () => <Card><HomeLink id="bridge" text="Tally is connected in one place: the Tally page (six steps, its status, and help). Nothing to set here." link="Open the Tally page" go={() => goTallyPage("computers")} /></Card>,
    tcloud: () => <CloudBooks />,
    postlog: () => <Card><HomeLink id="sent" text="One record for every client: what was sent, by whom and when." link="Open it on the Tally page" go={() => { goTallyPage("sent"); S.logAll = true; render(); }} /></Card>,
    gstapi: () => <GstApiAll />,
    rates: () => <Rates />,
    reading: () => <Reading />,
    ai: () => <><AiSettings />{Cloud.on() && <AssistantSettings />}</>,
    moves: () => <MoveSwitches />,
    platform: () => <Platform />,
  }[cur];
  // the one place for the build stamp (owner's spec K1): a small About line at the foot of Settings
  return <><Layout label="Settings" groups={groups} current={cur} pick={pick} scope="firm" cid="">{body()}</Layout>
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

function Company() {
  const co = CO(), owner = S.account && S.account.me ? S.account.me.role === "owner" : true;
  return <Card title="The client" note="As on the client’s GST registration. The PAN is filled in from the GSTIN when left empty.">
    <div className="grid"><CoText label="Client name" path="name" /><CoText label="GSTIN" path="gstin" /><CoText label="PAN" path="pan" /><EntityType co={co} /></div>
    {/* review of 02-Oct-2026: a GSTIN or PAN cannot be emptied by a sync (the server keeps it); an owner clears a wrong one
        here, with a reason that is kept */}
    {owner && (co.gstin || co.pan) && <div className="row" data-clear-ids="" style={{ gap: 8, marginTop: 8 }}>
      {co.gstin && <button className="btn small" onClick={() => coClearIds(["gstin"])}>Clear a wrong GSTIN…</button>}
      {co.pan && <button className="btn small" onClick={() => coClearIds(["pan"])}>Clear a wrong PAN…</button>}</div>}
  </Card>;
}

// review item 36: bills for services post as a Journal or as a Purchase voucher, as the client books them in Tally; a
// client with its own voucher type (say "Purchase - Services", made under Purchase in Tally) types its name
function VoucherType({ co }) {
  const vt = co.voucherType || "Journal", known = vt === "Journal" || vt === "Purchase";
  const [other, setOther] = useState(!known);
  const pick = (v) => { setOther(v === null); if (v) coCommit("voucherType", v); };
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
const DedLab = ({ label, req }) => <span>{label}{req && <b className="req" title="Required" aria-label="required"> *</b>}</span>;
function DedT({ p, k, label, req, max, placeholder, path }) {
  const co = CO(), pth = path || "tds26q." + k, v = pth.split(".").reduce((o, x) => (o || {})[x], co);
  return <label className="f" data-ded={k}><DedLab label={label} req={req} />
    <input type="text" value={v || ""} maxLength={max} placeholder={placeholder} aria-label={label}
      onChange={(ev) => { coSetText(pth, ev.target.value); FinComReact.redraw(); }} onBlur={() => coCommit(pth)} /><DedErr p={p} k={k} /></label>;
}
function DedSel({ p, k, label, req, opts, first }) {
  const d = CO().tds26q || {};
  return <label className="f" data-ded={k}><DedLab label={label} req={req} />
    <select aria-label={label} value={d[k] || ""} onChange={(ev) => coCommit("tds26q." + k, ev.target.value)}>
      <option value="">{first}</option>{opts.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select><DedErr p={p} k={k} /></label>;
}
function DeductorDetails() {
  const co = CO(), d = co.tds26q || {}, firm = TDS26Q.firmDetails();
  const probs = {}; TDSF25.deductorProblems(firm).forEach((p) => { (probs[p.k] = probs[p.k] || []).push(p.why); });
  const catPan = TDSF25.categoryOf(co.pan), cat = TDSF25.categoryFor(firm), govt = TDSF25.GOVT.test(cat);
  const states = Object.entries(TDSF25.STATES).map(([n, c]) => [c, c + " · " + n]);
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "10px 14px" };
  return <Card title="Deductor details for the TDS statements" note="Used in every TDS / TCS statement file (Forms 138, 140, 143, 144, and the old 24Q, 26Q, 27Q, 27EQ). Fields marked * are required; each is checked as Protean's file format asks.">
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
        <DedT p={probs} k="road" label="Road / street / sector" /><DedT p={probs} k="area" label="Area / locality" max={25} /><DedT p={probs} k="town" label="District" max={25} />
        <DedSel p={probs} k="state" label="State" req opts={states} first="Choose the State" /><DedT p={probs} k="pin" label="PIN code" req max={6} /><DedT p={probs} k="country" label="Country" max={25} placeholder="INDIA" />
        <DedT p={probs} k="email" label="E-mail" req={!d.personEmail} max={75} /><DedT p={probs} k="phoneCc" label="Phone country code" max={5} placeholder="91" /><DedT p={probs} k="phone" label="Phone" req max={10} />
      </div>
      <h4 style={{ margin: "14px 0 6px" }}>The person responsible for deducting</h4>
      <div style={grid}>
        <DedT p={probs} k="person" label="Name" req max={75} /><DedT p={probs} k="personDesignation" label="Designation" req max={20} /><DedT p={probs} k="personPan" label="PAN" req max={10} />
        <DedT p={probs} k="personFlat" label="Flat / door / block" req max={25} /><DedT p={probs} k="personPostOffice" label="Post office" max={25} /><DedT p={probs} k="personPremises" label="Building" />
        <DedT p={probs} k="personRoad" label="Road / street / sector" /><DedT p={probs} k="personArea" label="Area / locality" max={25} /><DedT p={probs} k="personTown" label="District" max={25} />
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
    <GstSettings />
    <LedgerPointer />
    <Card title="Blocked credit, section 17(5)" note="Flag: suggest on matching bills, and you accept or reject. Always blocked: applied by itself (it can still be unticked on a bill). Credit allowed: never flagged — for example a car dealer buying motor vehicles.">
      <div className="tblwrap"><table className="data" data-statement="">
        <thead><tr><th>Kind of purchase</th><th>Section</th><th>For this client</th></tr></thead>
        <tbody>{BLOCK_CATS.map((b) => <tr key={b.id}><td>{b.label}</td><td>{b.sec}</td>
          <td><select aria-label={"Blocked credit: " + b.label} value={blockRule(co, b.id)} onChange={(ev) => coSetBlockRule(b.id, ev.target.value)}>
            <option value="flag">Flag for review</option>{!b.flagOnly && <option value="block">Always blocked</option>}<option value="allow">Credit allowed</option></select>
            {b.flagOnly && <div className="nr">Flag only: never blocked by itself{b.id === "construction" ? " (repairs and plant and machinery are allowed)" : " (vehicles over 13 seats, dealers and transporters are allowed)"}.</div>}</td></tr>)}</tbody>
      </table></div>
    </Card>
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

function clientGroups() {
  const co = CO(), tc = tallyCounts(co), here = (co.bankAccounts || []).length, known = Object.keys(D().parties || {}).length, supNew = pendingSuppliers().length;
  const accs = tc ? tc.bank : here, sup = tc ? tc.sup : known;
  const label = Object.fromEntries(SETUP_TABS);
  const it = (id, about, status, danger) => ({ id, label: label[id], about, status, danger });
  return [
    { title: "The client", items: [
      it("settings", "Who the client is: name, GSTIN and PAN.", co.gstin || "no GSTIN yet"),
      it("cotally", "Which Tally company entries go into, how they are numbered, and the round-off ledger.", "Tally: " + tallyLinkOf(co).word + (tallyLinkOf(co).company ? " · " + tallyLinkOf(co).company : "")),
    ] },
    { title: "Tax", items: [
      it("cotds", "Whether the client deducts TDS, and the expense ledger of each payment type (TDS ledgers: on the TDS page).", co.mustDeduct === false ? "does not deduct" : "deducts TDS"),
      it("deductees", "Each supplier’s PAN and usual payment type, and amounts credited before FinCom, so yearly limits are right.", sup + " supplier" + (sup === 1 ? "" : "s") + (tc ? " in Tally (Sundry Creditors)" + (known ? ", " + known + " with details here" : "") : "") + (supNew ? " + " + supNew + " new, not yet approved" : "")),
      it("gstset", "GST registrations and how each is filed, and which purchases have blocked credit (GST ledgers: on the GST page).", ""),
    ] },
    { title: "Bank", items: [
      it("bankset", "The client’s bank accounts and the Tally ledger of each.", accs + " account" + (accs === 1 ? "" : "s") + (tc ? " in Tally (Bank Accounts)" + (here ? ", " + here + " with statements here" : "") : "")),
      it("bankrules", "Rules that give bank lines their ledger by themselves, for this client or the whole firm.", ""),
    ] },
    { title: "Books", items: [
      it("coclosed", "Periods already closed or filed: FinCom warns before posting an entry dated in one.", ""),
      it("cosheets", "The formats of purchase and sales registers FinCom has learnt (sheets, PDF tables, JSON): rename, delete or map one again.",
        (typeof SheetFmt === "object" ? SheetFmt.saved(co.id).length : 0) + " saved"),
    ] },
  ];
}

export function ClientSetup() {
  const co = CO(), tab = S.tab;
  const body = {
    settings: () => <Company />,
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
  // removing the client is out of the way, in More, behind the client's name (review of 02-Oct-2026)
  return <>
    <div className="row" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
      <details className="bk-menu" data-more="client"><summary className="btn small">More</summary><div className="bk-menu-list">
        <button className="danger" onClick={() => doAct("delCo")}>Remove this client<small>Asks for the client’s name. The firm account keeps its data, marked removed.</small></button>
      </div></details>
    </div>
    <Layout label="Client setup" groups={clientGroups()} current={isSetupTab(tab) && tab !== "coremove" ? tab : "settings"} pick={(id) => { goTab(id); window.scrollTo(0, 0); }} scope="setup" cid={co.id}>{body()}</Layout>
  </>;
}
