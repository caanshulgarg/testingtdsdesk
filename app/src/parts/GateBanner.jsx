// One calm line at the top of the page while FinCom's console has the firm paused, or the open company switched off
// (console phase 1b; the state and its words are FirmGate's, src/js/99-firm-gate.js). The work can still be read; the
// buttons that write are held back with the same words (FirmGate.mark), and Contact FinCom opens Help (its tickets).
export default function GateBanner() {
  const why = FirmGate.why();
  if (!why) return null;
  const paused = FirmGate.paused();
  return <div role="status" data-gate-banner={paused ? "paused" : "company-off"} data-gate-ok=""
    style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "0 0 12px", padding: "10px 14px", borderRadius: 10,
      border: "1px solid var(--line, rgba(127,127,127,.3))", borderLeft: "4px solid var(--warn, #b7791f)", background: "var(--paper, transparent)" }}>
    <span style={{ flex: "1 1 320px" }}>{why}</span>
    <button type="button" className="linkbtn" data-gate-contact="" onClick={() => navHome("help")}>Contact FinCom</button>
  </div>;
}
