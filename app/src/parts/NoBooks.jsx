// The card on Reports, Look up and Letters when no books are read yet. Was FC.noBooks (src/js/44).
export default function NoBooks({ what }) {
  const live = typeof bridgeLive === "function" && bridgeLive(CO());
  return <div className="fc-empty"><div className="fc-empty-ic" aria-hidden="true">▤</div><h3>{what} needs the books</h3><p className="note">Read the day book and balances from Tally first. It takes a minute a month through FinCom Bridge.</p>
    <div className="row" style={{ justifyContent: "center", gap: 8 }}><button className="btn primary" onClick={() => FC.go("import")}>Read the books from Tally</button>{!live && <button className="btn" onClick={() => doAct("tallyGuide")}>Set up FinCom Bridge</button>}</div></div>;
}
