// Tally on this computer: the clicks behind the Tally page's one status card (28-Oct-2026, next-tally-oneclick; the owner:
// "Tally is not working at all … There should be a simple click to connect and get the company … just a clickable option
// to connect Tally easily"; next-tally-smart: ONE card, one action at a time, drawn by screens/Tally.jsx ThisComputer).
//   Connect this computer   this browser's FinCom Bridge gets a computer key of the signed-in firm now (replacing an old
//                           or refused one) and FinCom says Connected at once (lib/tallyConnect.js connectNow). Not
//                           connected to the bridge yet: the tray's "Connect FinCom on this computer…" (FinCom opens and
//                           connects by itself), or its 6 digits typed here. Shown only while it is needed.
//   Find Tally              the bridge looks for TallyPrime now: each Tally, its port, whose, its companies; none: one
//                           plain line, and a port to type only when asked (Set its port). Shown only while Tally is not found.
//   Refresh                 the computers and companies read again (the cloud's wake and this browser's bridge); the
//                           companies open now are the page's list, never a second list here
// Nothing new is asked of the bridge or Tally: /ping, /status, /diagnose, /cloudlink and the RPCs FinCom already uses.
import { useEffect, useState } from "react";
import { connectNow, findTally, getCompanies, usePort, keyRefused } from "../lib/tallyConnect.js";
import { FL } from "./TallyFirstLink.jsx";
import "./tallyOneClick.css";

// the card's state (module state, drawn with render())
export const OC = { c: null, f: null, g: null, busy: "", refused: false, checkedAt: 0, act: {}, port: false };
if (typeof window !== "undefined") window.FCOneClick = { OC, reset() { Object.assign(OC, { c: null, f: null, g: null, busy: "", refused: false, checkedAt: 0, act: {}, port: false }); } };
const redraw = () => { if (typeof render === "function") render(); };
const set = (p) => { Object.assign(OC, p); redraw(); };

export async function run(which, fn) {
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
export const doFind = () => run("f", findTally);
// Refresh: this browser's bridge asked again (its companies open), and the cloud's computers and companies read again
// (the wake the client pages already send); the page's list draws what came
export async function doRefresh(cloud) {
  await run("g", async () => {
    const local = typeof Bridge === "object" && Bridge.on() ? Promise.resolve(Bridge.refresh(true)).catch(() => null) : null;
    await Promise.all([local, Promise.resolve(cloud ? cloud() : null).catch(() => null)]);
    return { st: "ok", say: "" };
  });
}

// once per page open (and at most every 2 minutes): this browser's bridge holds a key FinCom refuses? Asks no Tally
export function useRefusedCheck() {
  useEffect(() => {
    if (Date.now() - OC.checkedAt < 120000) return;
    OC.checkedAt = Date.now();
    Promise.resolve(keyRefused()).then((x) => { if (x !== OC.refused) set({ refused: !!x }); }, () => {});
  }, []);
}

export const Line = ({ r, hook }) => r && r.say ? <p className={"oc-say " + (r.st === "ok" || r.st === "found" ? "ok" : r.st === "code" ? "wait" : "bad")} data-oc-say={hook} data-oc-st={r.st} role="status">{(r.st === "ok" || r.st === "found" ? "✓ " : "") + r.say}</p> : null;

export function PortBox() {
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

// what Find Tally found: each Tally, its port, whose; none: the one line, and the port box only when asked
export function Found({ f }) {
  if (!f) return null;
  const rows = [].concat(f.list || []).filter((x) => x.port);
  const pinned = Number((typeof Bridge === "object" && Bridge.cfg().port) || 0) > 0;
  return <>
    <Line r={f} hook="find" />
    {rows.length > 0 && <ul className="oc-list" data-oc-tallies="">{rows.map((x) => <li key={x.port} data-oc-tally={x.port}>
      <b>{"Port " + x.port}</b>{" · " + (!x.mine ? "another Windows user’s Tally (not used)" : x.ok ? (x.busy ? "Tally busy" : "Tally open") + " · " + (x.companies.length ? x.companies.join(", ") : "no company open") : "not answering" + (x.error ? ": " + x.error : ""))}</li>)}</ul>}
    {f.st === "none" && <>
      <p className="oc-say bad" data-oc-none="">Open TallyPrime and a company, then press Find Tally again.</p>
      {f.fix && <p className="note" data-oc-fix="">{f.fix}</p>}
      {!(OC.port || pinned) && <button className="linkbtn" data-oc-port-ask="" onClick={() => set({ port: true })}>Tally is open but not found? Set its port</button>}
      {(OC.port || pinned) && <PortBox />}</>}
  </>;
}
