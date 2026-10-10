// The GST and TDS ledger check (request of 02-Oct-2026): every tax-like ledger with FinCom's suggestion and the evidence
// and where it came from (Tally master, day book, your firm, the name, AI). Nothing counts in a return until it is
// confirmed. FinCom 2.4.0: the check is no longer a second list with tick boxes above the ledgers. It is worked out by
// itself (LedPage.ensure, src/js/57); its evidence is under each row's Why, and its suggestion is the row's answer
// (Ledgers.jsx) when the ledger master has none; where they differ, Why says what the check reads. This part draws a
// row's evidence under "Why". The working is LedCheck (src/js/57-ledger-check.js).
const SRCC = { master: "ok", usage: "", firm: "", name: "", ai: "warn" };

// the evidence for one answer, each piece with its source ("Tally master", "Day book", ...)
export function Evidence({ r }) {
  const ev = (r.p && r.p.ev) || [];
  if (!ev.length && !r.why && !r.alt) return null;
  return <details className="led-why" data-led-why="">
    <summary>Why</summary>
    {r.why && !r.fromCheck && <div className="note" data-led-master-why="">{r.why}</div>}
    {ev.map((e, i) => <div key={i} className="note"><span className={"tag " + (SRCC[e.src] || "")}>{LedCheck.SRC[e.src]}</span> {e.say}</div>)}
    {r.alt && <div className="note" data-led-alt="">{"FinCom’s ledger check reads it as " + r.alt + ". If that is right, use Change."}</div>}
    {r.p && r.p.fromAi && <div className="note">AI’s answer: the rules could not settle it. Check it before you confirm.</div>}
    {r.ok && r.m && r.m.okAt && <div className="note ok">{"Confirmed " + fmtDate(String(r.m.okAt).slice(0, 10))}</div>}
  </details>;
}
