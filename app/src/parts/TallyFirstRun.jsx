// "Start with Tally" on the first screens of a firm with no clients (Clients, Today), next-tally-firstlink: one button to
// the Tally page, where Connect Tally walks through it (parts/TallyFirstLink.jsx). Its own small file: these screens are
// in the app's first file, which has a size budget (tests/run_stability.py).
// the first screen of a firm with no clients (Clients, Today): one start
export function FirstRunTally() {
  if (typeof navHome !== "function") return null;
  return <div className="fl-first" data-fl-first="" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px", margin: "10px 0 0", padding: "10px 12px", border: "1px dashed var(--border-strong, var(--border))", borderRadius: "var(--radius-panel, 10px)" }}>
    <b>Start with Tally</b>
    <span className="note" style={{ flex: "1 1 260px", minWidth: 0 }}>Connect Tally once and link each company open in it to its client on the Tally page (<b>Link to client…</b>): its books come in by themselves.</span>
    <button className="btn small" data-fl-start="" onClick={() => { S.tallyGuide = {}; S.tallyFocus = ""; S.tallyTab = "computers"; navHome("tally"); }}>Connect Tally</button>
  </div>;
}
