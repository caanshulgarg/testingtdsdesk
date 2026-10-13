// go-bridge (review of 01-Oct-2026): the Tally connection in three separate parts, so a busy Tally never reads as a lost
// connection: Bridge (online / reconnecting / offline), Tally (open / busy / not open), Company (linked / not linked).
// The parts come from tallyStatus() in src/js/49-tally-cloud.js; the history from tallyHistory() (24 hours, kept by the
// cloud from each computer's heartbeats).
import ListTable from "./ListTable.jsx";
const BRIDGE = { online: ["ok", "● Connected"], reconnecting: ["warn", "◐ Reconnecting…"], offline: ["bad", "○ Offline"], none: ["bad", "○ Not set up"] };
const TALLY = { open: ["ok", "● Open"], busy: ["warn", "◐ Busy"], closed: ["bad", "○ Not open"] };
const COMPANY = { linked: ["ok", "● Linked"], unlinked: ["warn", "○ Not linked"] };
const SAY = {
  bridge: { online: "FinCom Bridge answers: its heartbeat comes about every minute.", reconnecting: "A heartbeat is late. Nothing is lost; FinCom shows Offline only after three missed heartbeats (about two minutes).", offline: "Three heartbeats missed: the Tally computer or its bridge is off, or it has no internet.", none: "FinCom Bridge is not set up. Install FinCom Bridge from the Tally page." },
  tally: { open: "TallyPrime is open and answering.", busy: "TallyPrime is open but answering slowly (a long report, or a message box in Tally). The bridge asks again by itself; the connection is fine.", closed: "TallyPrime is not open on the Tally computer." },
  company: { linked: "A Tally company is linked to this client.", unlinked: "No Tally company is linked to this client yet (Client setup → Tally)." },
};

export function TallyStates({ co }) {
  const t = tallyStatus(co || null), p = t.parts || {};
  const chip = (what, map, v) => {
    const [lv, txt] = map[v] || ["bad", v];
    return <span className={"tag " + lv} data-part={what} data-state={v} title={(SAY[what] || {})[v] || ""}>{txt}</span>;
  };
  return <div className="row tstates" style={{ gap: 14, flexWrap: "wrap", alignItems: "center" }}>
    <span><b>Bridge</b> {chip("bridge", BRIDGE, p.bridge || "none")}</span>
    <span><b>Tally</b> {chip("tally", TALLY, p.tally || "closed")}{p.tally === "busy" && p.busySince ? <span className="note"> since {fmtDateTime(Date.parse(p.busySince))}</span> : null}</span>
    {co && <span><b>Company</b> {chip("company", COMPANY, p.company || "unlinked")}</span>}
  </div>;
}

const hm = (iso) => fmtTime(iso);   // IST, the one formatter (src/js/01)
const span = (a, b) => { const m = Math.round((Date.parse(b) - Date.parse(a)) / 60000); return m < 60 ? m + " min" : Math.floor(m / 60) + " h " + (m % 60) + " min"; };
function words(e) {
  if (e.kind === "bridge" && e.state === "offline") return e.now ? ["bad", "Bridge offline since " + hm(e.at) + " (" + span(e.at, new Date().toISOString()) + " so far)"] : ["bad", "Bridge offline " + hm(e.at) + " – " + hm(e.to) + " (" + span(e.at, e.to) + ")"];
  if (e.kind === "bridge") return ["ok", "Bridge connected"];
  if (e.kind === "tally") return [{ open: "ok", busy: "warn", closed: "bad" }[e.state] || "warn", { open: "Tally open", busy: "Tally busy (open, answering slowly)", closed: "Tally closed" }[e.state] || "Tally " + e.state];
  if (e.kind === "company") return ["ok", (e.state === "open" ? "Opened in Tally: " : "Closed in Tally: ") + e.name];
  return ["note", e.kind + " " + e.state];
}

// Settings → FinCom Bridge: the last 24 hours of each Tally computer's connection
export function TallyHistory() {
  const rows = typeof tallyHistory === "function" ? tallyHistory() : [];
  const devs = (TLight.st.devs || []).length;
  const offline = rows.filter((e) => e.kind === "bridge" && e.state === "offline");
  return <div className="pane" data-pane="tally-history"><h2>Connection history <span className="note" style={{ fontWeight: 400 }}>last 24 hours</span></h2>
    {!TCloud.on() ? <p className="note">The history comes from the Tally computers' heartbeats to FinCom's cloud: connect a computer to the cloud (Books in FinCom's cloud, below) to see it.</p>
      : !devs ? <p className="note">No Tally computer sends to FinCom's cloud yet.</p>
      : !rows.length ? <p className="note">Nothing to show: every heartbeat in the last 24 hours came on time.</p>
      : <>
        <p className="note" style={{ margin: "0 0 8px" }}>{offline.length ? "Offline " + offline.length + " time" + (offline.length === 1 ? "" : "s") + " (three heartbeats or more missed). " : "Never offline. "}A busy Tally is listed, but it is not a lost connection.</p>
        <ListTable name="tallyHistory" className="data" rows={rows} rowKey={(e, i) => e.at + ":" + i} unit={["change", "changes"]} limit={200} rowProps={(e) => ({ "data-kind": e.kind, "data-state": e.state })}
          cols={[
            { k: "at", role: "date", label: "When", v: (e) => e.at || "", cell: (e) => fmtDateTime(Date.parse(e.at)) },
            { k: "pc", role: "party", label: "Computer", v: (e) => e.device || "", cell: (e) => e.device },
            { k: "what", role: "status", label: "What", v: (e) => words(e)[1], cell: (e) => { const [lv, txt] = words(e); return <span className={"tag " + lv}>{txt}</span>; } },
          ]} />
      </>}
  </div>;
}
