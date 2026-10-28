// Tally on this computer: three clicks, each with a clear answer (28-Oct-2026, next-tally-oneclick; the owner: "Tally is
// not working at all … sometimes code screen, nothing goes green, nothing shows afterwards … There should be a simple
// click to connect and get the company … just a clickable option to connect Tally easily").
//   1. Connect this computer   this browser's FinCom Bridge gets a computer key of the signed-in firm now (replacing an old
//                              or refused one) and FinCom says Connected at once (lib/tallyConnect.js connectNow). Not
//                              connected to the bridge yet: the tray's "Connect FinCom on this computer…" (FinCom opens
//                              and connects by itself), or its 6 digits typed here.
//   2. Find Tally              the bridge looks for TallyPrime now: each Tally, its port, whose, its companies; none: one
//                              plain line and a port to type (Use this port: the page's own Tally pin)
//   3. Get companies           the companies open in that Tally, each Linked to <client> or with Link to client… (Task D)
// On opening the page (this browser connected to the bridge), a refused key is said plainly with the same button.
// Nothing new is asked of the bridge or Tally: /ping, /status, /diagnose, /cloudlink and the RPCs FinCom already uses.
// next-tally-linknow (28-Oct-2026): Link / Create client on a company FinCom's cloud has no row for yet is registered and
// linked at once (tally-ingest "link_now", lib/tallyConnect.js linkNow), never "done by itself within a minute"
import { useEffect, useState } from "react";
import { connectNow, findTally, getCompanies, usePort, keyRefused } from "../lib/tallyConnect.js";
import { CodeBox, FL } from "./TallyFirstLink.jsx";
import { companyRows, twinOf, yearOf, Pick } from "./TallyCompanies.jsx";
import { coKey } from "../lib/tallyState.js";
import "./tallyOneClick.css";

// the card's state (module state, drawn with render())
export const OC = { c: null, f: null, g: null, busy: "", refused: false, checkedAt: 0, act: {} };
if (typeof window !== "undefined") window.FCOneClick = { OC, reset() { Object.assign(OC, { c: null, f: null, g: null, busy: "", refused: false, checkedAt: 0, act: {} }); } };
const redraw = () => { if (typeof render === "function") render(); };
const set = (p) => { Object.assign(OC, p); redraw(); };

async function run(which, fn) {
  if (OC.busy) return;
  set({ busy: which });
  let r;
  try { r = await fn(); } catch (e) { r = { st: "error", say: String((e && e.message) || e) }; }
  set({ busy: "", [which]: Object.assign({ at: Date.now() }, r) });
  return r;
}
export async function doConnect(force) {
  const r = await run("c", () => connectNow({ force }));
  if (r && r.st === "ok") { OC.refused = false; FL.st = FL.st === "code" ? "linking" : FL.st; await run("f", findTally); if (OC.f && OC.f.st === "found") await run("g", getCompanies); }
}

// once per page open (and at most every 2 minutes): this browser's bridge holds a key FinCom refuses? Asks no Tally
function useRefusedCheck() {
  useEffect(() => {
    if (Date.now() - OC.checkedAt < 120000) return;
    OC.checkedAt = Date.now();
    Promise.resolve(keyRefused()).then((x) => { if (x !== OC.refused) set({ refused: !!x }); }, () => {});
  }, []);
}

const Line = ({ r, hook }) => r && r.say ? <p className={"oc-say " + (r.st === "ok" || r.st === "found" ? "ok" : r.st === "code" ? "wait" : "bad")} data-oc-say={hook} data-oc-st={r.st} role="status">{(r.st === "ok" || r.st === "found" ? "✓ " : "") + r.say}</p> : null;

function PortBox() {
  const [p, setP] = useState(String((typeof Bridge === "object" && Bridge.cfg().port) || ""));
  const go = () => { if (!usePort(p)) return; run("f", findTally); };
  return <div className="oc-port" data-oc-port="">
    <label htmlFor="ocPort">Tally’s port, if you know it (TallyPrime: F1 → Settings → Connectivity)</label>
    <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <input id="ocPort" data-oc-port-in="" inputMode="numeric" maxLength={5} placeholder="9000" value={p} onChange={(e) => setP(e.target.value.replace(/\D/g, "").slice(0, 5))} />
      <button className="btn small" data-oc-port-use="" disabled={!p || !!OC.busy} onClick={go}>Use this port</button>
      {Number((typeof Bridge === "object" && Bridge.cfg().port) || 0) > 0 && <button className="linkbtn" data-oc-port-auto="" onClick={() => { setP(""); usePort(0); run("f", findTally); }}>Find it by itself again</button>}
    </div></div>;
}

function Found({ f }) {
  if (!f) return null;
  const rows = [].concat(f.list || []).filter((x) => x.port);
  return <>
    <Line r={f} hook="find" />
    {rows.length > 0 && <ul className="oc-list" data-oc-tallies="">{rows.map((x) => <li key={x.port} data-oc-tally={x.port}>
      <b>{"Port " + x.port}</b>{" · " + (!x.mine ? "another Windows user’s Tally (not used)" : x.ok ? (x.busy ? "Tally busy" : "Tally open") + " · " + (x.companies.length ? x.companies.join(", ") : "no company open") : "not answering" + (x.error ? ": " + x.error : ""))}</li>)}</ul>}
    {f.st === "none" && <>
      <p className="oc-say bad" data-oc-none="">Open TallyPrime and a company, then press Find Tally again.</p>
      {f.fix && <p className="note" data-oc-fix="">{f.fix}</p>}
      <PortBox /></>}
  </>;
}

// Task D (the owner, 28-Oct-2026: "No suggestion to add clients. In Get companies, all open companies should come"): each
// company open in Tally now, linked ("Linked to <client>") or with ONE "Link to client…": the clients already in FinCom
// (the likeliest chosen), a new client only from the small "+ New client with this name" inside it
function CompanyLine({ x }) {
  const k = coKey(x.company), row = companyRows({ hidden: true }).find((r) => coKey(r.company) === k) || { company: x.company, gstin: x.gstin, client: "", open: true };
  const r = Object.assign({}, row, { gstin: row.gstin || x.gstin || "", open: true }), linked = r.client && S.companies && S.companies[r.client];
  const twin = !linked ? twinOf(r) || yearOf(r) : null, open = !!OC.act[k], err = !linked && (S.tcoErr || {})[k];
  const toggle = () => { OC.act[k] = !OC.act[k]; redraw(); };
  return <li data-oc-co={x.company}><span className="oc-co">{x.company}</span>
    {linked ? <span className="tag ok" data-oc-linked="">{"Linked to " + linked.name}</span>
      : <button className="btn small" data-oc-pick="" data-oc-pre={(twin && twin.id) || ""} onClick={toggle}>Link to client…</button>}
    {!linked && open && <div className="oc-pickbox" data-oc-pickbox=""><Pick r={r} co={null} pre={(twin && twin.id) || ""} onClose={() => { OC.act[k] = false; redraw(); }} /></div>}
    {err && <span className="note bad" data-oc-act-fail="">{"Not linked: " + err + "."}</span>}
  </li>;
}

export default function TallyOneClick({ download = null, codeBelow = false }) {
  useRefusedCheck();
  const c = OC.c, f = OC.f, g = OC.g, b = OC.busy, connected = !!(c && c.st === "ok");
  const local = typeof Bridge === "object" && Bridge.on();
  // the code typed (here or below) connected this browser to the bridge: the firm's key at once
  useEffect(() => { if (c && c.st === "code" && local && !b) doConnect(false); }, [c && c.st, local]);
  return <section className="pane oc" data-oneclick="" aria-label="Tally on this computer">
    <div className="oc-top"><h3>Tally on this computer</h3>
      <span className="note">For the computer where TallyPrime and FinCom Bridge run.</span></div>
    {OC.refused && !connected && <p className="oc-say bad" data-oc-refused="">FinCom Bridge on this computer has a key FinCom does not accept any more (it was connected to a firm that is gone, or its key was removed), so Tally is not reaching FinCom. Press Connect this computer: it gets a new key for {((S.firm && S.firm.firmName) || "your firm")} at once.</p>}
    <div className="oc-acts">
      <button className="btn primary oc-big" data-oc-connect="" disabled={!!b} onClick={() => doConnect(false)}>{b === "c" ? "Connecting…" : connected ? "Connect again" : "Connect this computer"}</button>
      <button className="btn" data-oc-find="" disabled={!!b || !local} onClick={() => run("f", findTally)}>{b === "f" ? "Looking for Tally…" : "Find Tally"}</button>
      <button className="btn" data-oc-get="" disabled={!!b || !local} onClick={() => run("g", getCompanies)}>{b === "g" ? "Asking Tally…" : "Get companies"}</button>
    </div>
    {!local && !c && <p className="note" data-oc-hint="">Find Tally and Get companies work once this computer is connected.</p>}
    <Line r={c} hook="connect" />
    {c && c.st === "code" && (codeBelow ? <p className="note" data-oc-code-below="">Or type the 6 digits in Connect this computer below.</p> : <div className="oc-code"><CodeBox /></div>)}
    {c && (c.st === "none" || c.st === "old") && download && <div className="oc-dl">{download}</div>}
    <Found f={f} />
    {g && <><Line r={g} hook="get" />
      {(g.list || []).length > 0 && <ul className="oc-list oc-cos" data-oc-cos="">{g.list.map((x) => <CompanyLine key={x.company} x={x} />)}</ul>}</>}
  </section>;
}
