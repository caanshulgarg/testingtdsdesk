// Tally open: link it, on the Tally icon (24-Oct-2026, next-tally-firstlink; the owner: "I could not find how to link..
// what to do after installing bridge and opening Tally", then "I do not want 'Tally is open and link' on every page.. it
// should be above, on the Tally icon"). The top bar's Tally sign (TopBar.jsx) carries a badge with the number of companies
// open in Tally that are no client's (lib/tallyState.js unlinkedOpen); a click opens its panel, which starts with this:
//   "Tally is open on NWS144 with <company>." [Add as new client] [Link to existing client ▾]
//   (a client of the same name or GSTIN: [Link to <client>] first; on a client's own page not linked yet: [Link to <it>])
//   up to three companies, then "+ N more open in Tally: see them on the Tally page".
// Only for people who may link (owner, staff: the cloud's can_write); the panel draws it only for them, the badge too.
// One click uses the Tally page's own addAsClient / linkTo (tally_company_link once, then the ledgers' first sync).
import { useState } from "react";
import { companyRows, addAsClient, linkTo, twinOf } from "./TallyCompanies.jsx";
import { tallyDevs, pcOf, mayLink } from "../lib/tallyState.js";
import "./tallyOffer.css";

const shown = (n) => String(n || "").replace(/\s+/g, " ").trim();
const clients = () => Object.values(S.companies || {}).filter((c) => c && !c.deleted).sort((a, b) => String(a.name).localeCompare(String(b.name)));
const after = () => { if (typeof TLight === "object") { TLight.st.at = 0; Promise.resolve(TLight.refresh()).then(() => render(), () => render()); } else render(); };

function OpenCompany({ r, here }) {
  const [busy, setBusy] = useState("");
  const d = tallyDevs().find((x) => x.id === r.device), pc = d ? pcOf(d) : "this computer", tw = twinOf(r);
  const add = async () => { setBusy("add"); const id = await addAsClient(r); setBusy("");
    if (id && S.companies[id]) toast(S.companies[id].name + " is added and linked to " + shown(r.company) + ". Its ledgers are coming in now."); after(); };
  const link = async (co) => { if (!co) return; setBusy("link"); const ok = await linkTo(r, co); setBusy("");
    if (ok) toast(shown(r.company) + " is linked to " + co.name + ". Its ledgers are coming in now."); after(); };
  const first = here || tw;
  return <div className="toffer" data-tally-offer={r.company}>
    <p className="toffer-say"><b>{"Tally is open on " + pc + " with " + shown(r.company) + "."}</b></p>
    <div className="toffer-acts">
      {first ? <button className="btn small primary" data-tally-offer-link-to={first.id} disabled={!!busy} onClick={() => link(first)}>{busy === "link" ? "Linking…" : "Link to " + first.name}</button>
        : <button className="btn small primary" data-tally-offer-add="" disabled={!!busy} onClick={add}>{busy === "add" ? "Adding…" : "Add as new client"}</button>}
      {first && <button className="btn small" data-tally-offer-add="" disabled={!!busy} onClick={add}>{busy === "add" ? "Adding…" : "Add as new client"}</button>}
      <select data-tally-offer-link="" aria-label="Link to existing client" disabled={!!busy} value="" onChange={(e) => link(S.companies[e.target.value])}>
        <option value="">{"Link to existing client ▾"}</option>
        {clients().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
    </div></div>;
}

export default function TallyOffer() {
  if (!mayLink() || typeof TCloud !== "object" || !TCloud.on()) return null;
  const open = companyRows().filter((r) => r.open && !r.client);
  if (!open.length) return null;
  const co = S.view === "company" && typeof CO === "function" ? CO() : null;
  const here = co && typeof tallyLinkOf === "function" && (tallyLinkOf(co) || {}).state === "unlinked" ? co : null;
  const more = open.length - 3;
  return <section className="toffers" data-tally-offers={open.length} aria-label="Companies open in Tally, not linked">
    {open.slice(0, 3).map((r) => <OpenCompany key={r.company} r={r} here={here} />)}
    {more > 0 && <button className="linkbtn" data-tally-offer-more={more} onClick={() => { doAct("tallyPanelClose"); S.tallyGuide = {}; S.tallyTab = "computers"; navHome("tally"); }}>{"+ " + more + " more open in Tally: see them on the Tally page"}</button>}
  </section>;
}
