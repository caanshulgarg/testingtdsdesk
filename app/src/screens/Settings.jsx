// Settings, in two places that look and work the same way: a list of sections on the left, one section on the right.
//   FirmSettings — for the whole firm (Settings in the sidebar when no client is open). The section is S.settingsTab.
//   ClientSetup  — for the open client (Client setup). The section is S.tab, one of SETUP_TABS (src/js/02).
// Was the tiles page (settingsTiles, viewRules in src/js/18) and viewCompanySettings (src/js/27), which put the
// company, Tally, TDS and GST settings on one long page.
//
// Every change is saved as it is made: typed text a moment later (coSetText, firmSetName), a tick or choice at once
// (coCommit). Sections not yet redrawn in React show the old screen's HTML through <Legacy>.
import { useState } from "react";
import Legacy from "../parts/Legacy.jsx";
import { AiSettings } from "../parts/Ai.jsx";
import { BridgeSettings, CloudBooks } from "./Tally.jsx";
import { PlanCredit, FirmAccount, PeopleEtc, Platform } from "./Account.jsx";
import { Rates, Reading, ClosedPeriods } from "./SettingsMore.jsx";
import { BankSetup } from "../parts/BankSettings.jsx";
import GstSettings from "./gst/GstSettings.jsx";
import Parties from "./Parties.jsx";
import { PostLog } from "./Done.jsx";

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

function Layout({ label, groups, current, pick, children }) {
  const it = groups.flatMap((g) => g.items).find((x) => x.id === current);
  return (
    <div className="setwrap">
      <SetNav label={label} groups={groups} current={current} pick={pick} />
      <div className="setbody">
        <header className="sethead"><h2>{it.label}</h2><p>{it.about}</p></header>
        <p className="setsaved">Changes are saved as you make them.</p>
        {children}
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
  return <Card title="Firm details" note="Shown at the top of every page, and on reports, letters and MIS packs prepared for clients.">
    <div className="grid"><label className="f"><span>Firm name</span>
      <input type="text" value={S.firm.firmName || ""} onChange={(ev) => { firmSetName(ev.target.value); FinComReact.redraw(); }} /></label>
      <label className="f wide"><span>Address</span><textarea rows={2} value={S.firm.firmAddress || ""} onChange={(ev) => setAddr(ev.target.value)} /></label>
      <label className="f"><span>Logo</span><input type="file" accept="image/*" aria-label="Firm logo" onChange={pick} /></label>
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
      { id: "bridge", label: "Tally Bridge", about: "The small program that lets FinCom read from and post into TallyPrime on this computer: set it up and check it.",
        status: "Tally: " + tallyStatus(null).label + (Bridge.on() && Bridge.up() && !Bridge.st.tallyUp ? " (bridge here running, Tally not open)" : "") },
      { id: "tcloud", label: "Books in the cloud", about: "Computers that send Tally’s books to the firm account, and which Tally company is which client.",
        status: "Tally: " + tallyStatus(null).label },
      { id: "postlog", label: "Sent to Tally", about: "A record of every entry posted to Tally, by whom and when, for all clients.", status: (S.firm.postLog || []).length + " entries" },
    ] },
    { title: "How the work is done", items: [
      { id: "rates", label: "TDS rates and limits", about: "The rates and yearly limits used to work out TDS on every client’s bills.", status: "tax year " + (S.firm.fy || "2026-27") },
      { id: "reading", label: "Reading bills", about: "How bills and statements are read — free reading first, then Google OCR or Claude — and a test of each.",
        status: S.engine === "api" ? "free steps, then Claude" : hasGoogle() ? "free steps, then Google OCR" : "free reading only" },
      { id: "ai", label: "AI help", about: "Claude’s suggestions in TDS, GST, audit and notices: on or off.", status: AIH.sub() },
    ] },
  ];
  if (sa) groups.push({ title: "Administrator", items: [{ id: "platform", label: "Platform", about: "All firms, credit, plans, prices and keys.", status: S.adminData ? (S.adminData.firms || []).length + " firms" : "" }] });
  return groups;
}

export function FirmSettings() {
  const groups = firmGroups(), ids = groups.flatMap((g) => g.items.map((i) => i.id));
  const cur = ids.includes(S.settingsTab) ? S.settingsTab : "firm";
  const pick = (id) => { S.settingsTab = id; render(); window.scrollTo(0, 0); };
  const body = {
    firm: () => <FirmDetails />,
    account: () => <><FirmAccount />{Cloud.on() && <PeopleEtc />}</>,
    plan: () => <PlanCredit />,
    bridge: () => <BridgeSettings />,
    tcloud: () => <CloudBooks />,
    postlog: () => <PostLog />,
    rates: () => <Rates />,
    reading: () => <Reading />,
    ai: () => <AiSettings />,
    platform: () => <Platform />,
  }[cur];
  return <Layout label="Settings" groups={groups} current={cur} pick={pick}>{body()}</Layout>;
}

/* ---------------------------------------------------------------- for one client */

// a text setting of the client: kept as typed, checked (GSTIN, PAN) when the box is left
function CoText({ label, path, placeholder }) {
  const co = CO(), v = path.split(".").reduce((o, k) => (o || {})[k], co);
  return <label className="f"><span>{label}</span>
    <input type="text" value={v || ""} placeholder={placeholder}
      onChange={(ev) => { coSetText(path, ev.target.value); FinComReact.redraw(); }} onBlur={() => coCommit(path)} /></label>;
}
const CoCheck = ({ path, on, children }) => (
  <label className="chk"><input type="checkbox" checked={on} onChange={(ev) => coCommit(path, ev.target.checked)} /> {children}</label>
);

function Company() {
  return <Card title="The client" note="As on the client’s GST registration. The PAN is filled in from the GSTIN when left empty.">
    <div className="grid"><CoText label="Client name" path="name" /><CoText label="GSTIN" path="gstin" /><CoText label="PAN" path="pan" /></div>
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
  const co = CO(), open = Bridge.up() && Bridge.st.open.length ? Bridge.st.open : null, auto = co.vchNumbering === "tally";
  return <>
    <Card title="The company in Tally" note="Entries go into this company. The name must match Tally’s exactly.">
      <div className="grid">
        <CoText label="Company name in Tally" path="tallyName" />
        {open && <label className="f"><span>Or pick the company open in Tally</span>
          <select value={open.some((o) => o.name === co.tallyName) ? co.tallyName : ""} onChange={(ev) => coSetTallyName(ev.target.value)}>
            <option value="">—</option>{open.map((o) => <option key={o.name}>{o.name}</option>)}</select></label>}
      </div>
    </Card>
    <Card title="How purchase bills are entered">
      <VoucherType co={co} />
      <SupInvFrom co={co} />
      <div className="f wide vnum" style={{ marginBottom: 12 }}><span>Voucher numbering</span>
        {auto ? <div className="note"><span className="tag ok">Automatic in Tally</span> Tally gives every entry its own next number{co.vchAutoAt ? " (set " + fmtDate(String(co.vchAutoAt).slice(0, 10)) + ")" : ""}. FinCom sends no voucher numbers.{" "}
            <button className="linkbtn" onClick={() => doAct("vchUseBillNo")}>Use supplier bill numbers instead</button></div>
          : <><div className="note">FinCom sends the supplier’s bill number as the voucher number; a number already in Tally is retried with the supplier’s initials.</div>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn small" disabled={!(Bridge.on() && Bridge.up())} title={Bridge.on() && Bridge.up() ? undefined : "Needs the Tally Bridge and Tally open"} onClick={() => doAct("vchAuto")}>Set automatic numbering in Tally</button>
              <button className="btn small" onClick={() => doAct("vchTallyDone")}>It is set in Tally already: use Tally’s automatic numbers</button>
            </div></>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <CoCheck path="createOptional" on={!!co.createOptional}>Post purchase bills and sales invoices as Optional vouchers</CoCheck>
        <p className="note">Tally hides Optional vouchers from the Day Book until they are made regular with Ctrl+L.</p>
        <CoCheck path="billwise" on={!!co.billwise}>Add the invoice number as a bill-wise reference on the party</CoCheck>
      </div>
    </Card>
    <Card title="Ledgers used in every entry" note="Names as in Tally. Ledgers for TDS and expenses by payment type are under TDS.">
      <div className="grid">
        <CoText label="Input CGST" path="gst.cgst" /><CoText label="Input SGST" path="gst.sgst" /><CoText label="Input IGST" path="gst.igst" /><CoText label="Round off" path="roundOff" />
      </div>
    </Card>
  </>;
}

function RuleLedger({ kind, r }) {
  const co = CO(), v = (kind === "tds" ? co.tdsLedgers : co.expenseLedgers)[r.id] || "";
  return <input type="text" value={v} aria-label={(kind === "tds" ? "TDS ledger for " : "Expense ledger for ") + r.label}
    onChange={(ev) => { coSetRuleLedger(kind, r.id, ev.target.value); FinComReact.redraw(); }} />;
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
    <Card title="Ledgers by payment type" note="The TDS ledger each kind of payment is credited to, and the expense ledger a bill goes to unless you choose another.">
      <div className="tblwrap"><table className="data">
        <thead><tr><th>Payment type</th><th>TDS ledger in Tally</th><th>Default expense ledger</th></tr></thead>
        <tbody>{rules().map((r) => <tr key={r.id}><td>{r.label}</td><td>{r.basis === "never" ? "—" : <RuleLedger kind="tds" r={r} />}</td><td><RuleLedger kind="exp" r={r} /></td></tr>)}</tbody>
      </table></div>
    </Card>
    <p className="note">Each supplier’s PAN, usual payment type and amounts credited before FinCom: <button className="linkbtn" onClick={() => goTab("deductees")}>Suppliers</button>.</p>
  </>;
}

const RCM_LABEL = { rcmCgstIn: "Input CGST (RCM)", rcmSgstIn: "Input SGST (RCM)", rcmIgstIn: "Input IGST (RCM)", rcmCgstOut: "CGST payable (RCM)", rcmSgstOut: "SGST payable (RCM)", rcmIgstOut: "IGST payable (RCM)" };

function GstSetup() {
  const co = CO();
  return <>
    <GstSettings />
    <Card title="Reverse charge ledgers" note="Reverse charge entries debit the input side (unless the credit is blocked) and credit the payable side.">
      <div className="grid">{Object.keys(RCM_LEDGER_DEFAULTS).map((k) => (
        <label className="f" key={k}><span>{RCM_LABEL[k]}</span>
          <input type="text" value={rcmLedger(co, k)} onChange={(ev) => { coSetText("gst." + k, ev.target.value); FinComReact.redraw(); }} onBlur={() => coCommit("gst." + k)} /></label>))}
      </div>
    </Card>
    <Card title="Blocked credit, section 17(5)" note="Flag: suggest on matching bills, and you accept or reject. Always blocked: applied by itself (it can still be unticked on a bill). Credit allowed: never flagged — for example a car dealer buying motor vehicles.">
      <div className="tblwrap"><table className="data">
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
    <button className="btn danger" onClick={() => doAct("delCo")}>{S.arm === "delCo" ? "Click again to delete " + co.name : "Delete client"}</button>
  </Card>;
}

function clientGroups() {
  const co = CO(), accs = (co.bankAccounts || []).length, sup = Object.keys(D().parties || {}).length, supNew = pendingSuppliers().length;
  const label = Object.fromEntries(SETUP_TABS);
  const it = (id, about, status, danger) => ({ id, label: label[id], about, status, danger });
  return [
    { title: "The client", items: [
      it("settings", "Who the client is: name, GSTIN and PAN.", co.gstin || "no GSTIN yet"),
      it("cotally", "Which Tally company entries go into, how they are numbered, and the ledgers used in every entry.", "Tally: " + tallyStatus(co).label + (co.tallyName ? " · " + co.tallyName : "")),
    ] },
    { title: "Tax", items: [
      it("cotds", "Whether the client deducts TDS, and the ledgers each kind of payment uses.", co.mustDeduct === false ? "does not deduct" : "deducts TDS"),
      it("deductees", "Each supplier’s PAN and usual payment type, and amounts credited before FinCom, so yearly limits are right.", sup + " supplier" + (sup === 1 ? "" : "s") + (supNew ? " + " + supNew + " new, not yet approved" : "")),
      it("gstset", "GST registrations and how each is filed, reverse charge ledgers, and which purchases have blocked credit.", ""),
    ] },
    { title: "Bank", items: [
      it("bankset", "The client’s bank accounts and the Tally ledger of each.", accs + " account" + (accs === 1 ? "" : "s")),
      it("bankrules", "Rules that give bank lines their ledger by themselves, for this client or the whole firm.", ""),
    ] },
    { title: "Books", items: [
      it("coclosed", "Periods already closed or filed: FinCom warns before posting an entry dated in one.", ""),
      it("coremove", "Delete this client from FinCom.", "", true),
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
    coremove: () => <Remove />,
  }[tab] || (() => <Company />);
  return <Layout label="Client setup" groups={clientGroups()} current={isSetupTab(tab) ? tab : "settings"} pick={(id) => { goTab(id); window.scrollTo(0, 0); }}>{body()}</Layout>;
}
