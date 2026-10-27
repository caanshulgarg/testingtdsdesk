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
    {FirmGate.billing() && <button type="button" className="linkbtn" data-gate-plan="" onClick={() => goSettings("plan")}>Plan and credit</button>}
    <button type="button" className="linkbtn" data-gate-contact="" onClick={() => navHome("help")}>Contact FinCom</button>
  </div>;
}

// billing has paused the firm (my_firm_status can_read false): the firm's work is not shown; Plan and credit (credit, a
// coupon) and Help still open
export function PausedPage() {
  return <div data-paused-page="" data-gate-ok="">
    <GateBanner />
    <div className="pane" style={{ maxWidth: 560 }}>
      <h2 style={{ margin: "0 0 8px" }}>Your firm’s work is hidden while the account is paused</h2>
      <p className="note" style={{ margin: "0 0 12px" }}>Nothing is lost. Add credit or enter a coupon and everything opens again.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn primary" data-paused-plan="" onClick={() => goSettings("plan")}>Plan and credit</button>
        <button type="button" className="btn" data-paused-help="" onClick={() => navHome("help")}>Contact FinCom</button>
      </div>
    </div>
  </div>;
}
