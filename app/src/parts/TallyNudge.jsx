// Tally open: link it, wherever the person is (24-Oct-2026, next-tally-firstlink; the owner: "I could not find how to
// link.. what to do after installing bridge and opening Tally"). FinCom shows it by itself, at the top of every page
// (Main.jsx; the Tally page too), from what the computers' beats already say (TLight, every 30 s; nothing new is asked of
// the bridge or Tally):
//   - a company open in Tally that is no client's: "Tally is open on NWS144 with <company>. Link it:" [Add as new client]
//     [Link to existing client ▾] (a client of the same name or GSTIN: [Link to <client>] first) · Not now; more than one:
//     "+ 2 more open in Tally: see them on the Tally page";
//   - on a client's own pages while it is not linked: "<client> is not linked to Tally." with each company open now and
//     its Link (or, none open: what to do), and Choose on the Tally page;
//   - no Tally computer heard yet: "Tally is not connected yet" with what to do (Connect Tally: Download, Open it, Type
//     its code); a bridge heard, no company linked and none open: "Open your company in TallyPrime on NWS144".
// One click links (the same addAsClient / linkTo as the Tally page's list, which start the ledgers' first sync).
// "Not now" hides that company's line in this browser (localStorage), never the company itself.
import { useEffect, useState } from "react";
import { companyRows, addAsClient, linkTo, twinOf } from "./TallyCompanies.jsx";
import { tallyDevs, pcOf, pcLive, coKey } from "../lib/tallyState.js";
import "./tallyNudge.css";

const HIDE = "fc:tallyNudgeHide";
const hiddenSet = () => { try { return new Set(JSON.parse((typeof lsGet === "function" ? lsGet(HIDE) : localStorage.getItem(HIDE)) || "[]")); } catch (e) { return new Set(); } };
const hide = (k) => { const s = hiddenSet(); s.add(k); try { const v = JSON.stringify([...s].slice(-200)); if (typeof lsSet === "function") lsSet(HIDE, v); else localStorage.setItem(HIDE, v); } catch (e) { /* this browser only */ } render(); };
const shown = (n) => String(n || "").replace(/\s+/g, " ").trim();
const clients = () => Object.values(S.companies || {}).filter((c) => c && !c.deleted).sort((a, b) => String(a.name).localeCompare(String(b.name)));

function useFresh() {
  // the beats are read again every 30 s (TLight's own pace), and the line drawn again then
  useEffect(() => { const go = () => { if (typeof TLight === "object" && typeof TCloud === "object" && TCloud.on()) Promise.resolve(TLight.refresh()).then(() => render(), () => {}); };
    go(); const t = setInterval(go, 30000); return () => clearInterval(t); }, []);
}

function Box({ k, kind, children, onHide }) {
  return <div className="tnudge" data-tally-nudge={kind} data-tally-nudge-co={k || undefined} role="status">
    <span className="tnudge-icon" aria-hidden="true">T</span><div className="tnudge-body">{children}</div>
    {onHide && <button className="linkbtn tnudge-x" data-tally-nudge-hide="" onClick={onHide} aria-label="Not now">Not now</button>}</div>;
}

function OpenCompany({ r, more }) {
  const [busy, setBusy] = useState("");
  const d = tallyDevs().find((x) => x.id === r.device), pc = d ? pcOf(d) : "this computer", tw = twinOf(r);
  const add = async () => { setBusy("add"); const id = await addAsClient(r); setBusy("");
    if (id && S.companies[id]) toast(S.companies[id].name + " is added and linked to " + shown(r.company) + ". Its ledgers are coming in now."); if (typeof TLight === "object") TLight.st.at = 0; render(); };
  const link = async (co) => { if (!co) return; setBusy("link"); const ok = await linkTo(r, co); setBusy("");
    if (ok) toast(shown(r.company) + " is linked to " + co.name + ". Its ledgers are coming in now."); if (typeof TLight === "object") TLight.st.at = 0; render(); };
  return <Box k={r.company} kind="open" onHide={() => hide(coKey(r.company))}>
    <p className="tnudge-say"><b>{"Tally is open on " + pc + " with " + shown(r.company) + "."}</b>{" Link it:"}</p>
    <div className="tnudge-acts">
      {tw ? <button className="btn small primary" data-tally-nudge-twin={tw.id} disabled={!!busy} onClick={() => link(tw)}>{busy === "link" ? "Linking…" : "Link to " + tw.name}</button>
        : <button className="btn small primary" data-tally-nudge-add="" disabled={!!busy} onClick={add}>{busy === "add" ? "Adding…" : "Add as new client"}</button>}
      <label className="tnudge-pick">
        <select data-tally-nudge-link="" aria-label="Link to existing client" disabled={!!busy} value="" onChange={(e) => link(S.companies[e.target.value])}>
          <option value="">{"Link to existing client ▾"}</option>
          {clients().map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      {more > 0 && <button className="linkbtn" data-tally-nudge-more={more} onClick={() => { S.tallyGuide = {}; S.tallyTab = "computers"; navHome("tally"); }}>{"+ " + more + " more open in Tally: see them on the Tally page"}</button>}
    </div></Box>;
}

function ClientLine({ co, open }) {
  const [busy, setBusy] = useState(false);
  const link = async (r) => { setBusy(true); const ok = await linkTo(r, co); setBusy(false); if (ok) toast(shown(r.company) + " is linked to " + co.name + ". Its ledgers are coming in now."); if (typeof TLight === "object") TLight.st.at = 0; render(); };
  return <Box kind="client">
    <p className="tnudge-say"><b>{co.name + " is not linked to Tally."}</b>{open.length ? " Open in Tally now:" : " Open its company in TallyPrime on the Tally computer: it shows here to link."}</p>
    <div className="tnudge-acts">
      {open.slice(0, 4).map((r, i) => <button key={r.company} className={"btn small" + (i === 0 ? " primary" : "")} data-tally-nudge-client-link={r.company} disabled={busy} onClick={() => link(r)}>{"Link " + shown(r.company)}</button>)}
      <button className="linkbtn" data-tally-nudge-choose="" onClick={() => (typeof openConnectTally === "function" ? openConnectTally(4, co.id) : navHome("tally"))}>Choose on the Tally page</button>
    </div></Box>;
}

export default function TallyNudge() {
  useFresh();
  if (typeof TCloud !== "object" || !TCloud.on() || !S.firm || typeof TLight !== "object" || !TLight.st.loaded) return null;
  const rows = companyRows(), hid = hiddenSet();
  const open = rows.filter((r) => r.open && !r.client);
  const co = S.view === "company" && typeof CO === "function" ? CO() : null;
  if (co) {
    const l = typeof tallyLinkOf === "function" ? tallyLinkOf(co) : null;
    if (!l || l.state !== "unlinked") return null;
    // the likeliest company first (its name or GSTIN: suggestFor, as the Tally page's list for a client)
    const sc = new Map((typeof suggestFor === "function" ? suggestFor(co, open.map((r) => Object.assign({}, r, { client: "" }))) : []).map((x) => [x.company, x.score || 0]));
    return <ClientLine co={co} open={open.slice().sort((a, b) => (sc.get(b.company) || 0) - (sc.get(a.company) || 0))} />;
  }
  const show = open.filter((r) => !hid.has(coKey(r.company)));
  if (show.length) return <OpenCompany r={show[0]} more={show.length - 1} />;
  if (open.length) return null;   // every one "Not now"
  const devs = tallyDevs(), onTally = S.view === "home" && S.homeTab === "tally";
  if (!devs.length) {
    if (onTally || hid.has("#connect")) return null;   // the Tally page says it in its steps
    return <Box kind="connect" onHide={() => hide("#connect")}>
      <p className="tnudge-say"><b>Tally is not connected yet.</b>{" On the computer where TallyPrime runs: download FinCom Bridge, open it, then type the code it shows. FinCom walks you through it."}</p>
      <div className="tnudge-acts"><button className="btn small" data-tally-nudge-connect="" onClick={() => { S.tallyGuide = {}; S.tallyTab = "computers"; navHome("tally"); }}>Connect Tally</button></div></Box>;
  }
  const linked = rows.some((r) => r.client);
  const live = devs.filter(pcLive);
  if (!linked && live.length && !hid.has("#open")) return <Box kind="openit" onHide={() => hide("#open")}>
    <p className="tnudge-say"><b>{"FinCom Bridge on " + pcOf(live[0]) + " is connected."}</b>{" Open your company in TallyPrime there: it shows here to link, within a minute."}</p></Box>;
  return null;
}
