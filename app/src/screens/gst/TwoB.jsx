// 2B reconciliation (next-itc-simple, 24-Oct-2026; the owner: "2B & ITC page is not clear.. simple clear page required"):
// the 2B brought in (from the portal or its JSON) for the GSTIN, and one table of the
// month's lines with a Decision on each (ItcReco.jsx; the old ITC follow-up's letters are its "Write to suppliers").
// "See the 2B as the portal shows it" keeps the portal's view (TwoBPortal). Was this file's three views (Reconciliation,
// GSTR-2B, Workbench: tiles, tabs and linking by hand; the links are on the lines now). The automatic matching (M2B,
// src/js/85: rules, then AI) runs by itself and shows nowhere but in each line's status (its AI pairs are GST2B.run's, an
// "AI" tag on the line); the owner, 24-Oct-2026: "this should not even show every time and every month in 2B .. why
// confuse the user". Match again is under ⋯; what the AI costs is under Settings, AI usage.
// The matching is GST2B (src/js/11); the decisions ITCDec (app/src/lib/itcSync.js); the credit ITCF (app/src/lib/itcFinal.js).
import GstApiCard from "../GstApiCard.jsx";
import CommitBox from "../../parts/CommitBox.jsx";
import TwoBPortal from "./TwoBPortal.jsx";
import More from "../../parts/More.jsx";
import ItcReco from "./ItcReco.jsx";

// nothing brought in yet: how to get 2B from the portal
function Empty({ b, apiCard }) {
  return <>
    {apiCard && <GstApiCard />}
    <section className="dash-card" style={{ maxWidth: 760 }}><h3>GSTR-2B reconciliation</h3>
      <p className="note">On the portal: Returns Dashboard → the month → GSTR-2B → View → Download → <b>Generate JSON</b>. Bring in one month, a quarter, or the whole year at once — select all the files together.</p>
      <p className="note">Every document in Tally that takes input tax is compared: purchases, and expenses booked in journals or payments. Invoices are matched on the supplier’s GSTIN and invoice number, then on the number written differently, then on the amount; anything less than certain is put to you to confirm.</p>
      {b.twoB && <p className="note" style={{ color: "var(--warn)" }}>A 2B brought in before this build was read the old way. Bring it in again.</p>}
      <button className="btn small primary" onClick={() => doAct("twoBPick")}>Bring in 2B JSON</button>
    </section>
  </>;
}

export default function TwoB({ b }) {
  const loadedAll = GST2B.all2b(""), apiCard = !!viewGstApiCard(b);
  if (!loadedAll.length) return <Empty b={b} apiCard={apiCard} />;
  const reg = r2Reg(b), set = GST2B.settings(), regs = GSTR.gstins(b) || [];
  if (!reg && regs.length > 1) return <p className="note">Choose a registration above.</p>;
  const mine = GST2B.all2b(reg), wrong = loadedAll.filter((t) => regs.length && !regs.includes(t.gstin));
  const fyM = S.gstYm ? GSTRev.fyMonths(S.gstYm) : [], have = new Set(mine.map((t) => t.ym)), sk = GST2B.skipped || {};
  const portal = S.r2View === "portal";
  return <>
    {apiCard && <GstApiCard />}
    <section className="dash-card ic-card">
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn small primary" onClick={() => doAct("twoBPick")}>Bring in 2B JSON</button>
        <span className="note">2B here for {regs.length > 1 ? reg + ": " : ""}</span>
        {fyM.map((m) => <span key={m} className={"tag" + (have.has(m) ? "" : " warn")} title={have.has(m) ? "brought in" : "not brought in yet"}>{GSTR.label(m).replace(/[-\s]\d{4}$/, "")}</span>)}
        <span className="note" style={{ marginLeft: "auto" }}>Allow a difference of ₹</span>
        <CommitBox type="number" min="0" step="1" aria-label="Allow a difference of" value={set.tol} style={{ width: 64 }} onCommit={(v) => r2SetTol(v)} />
        {portal && <button type="button" className="linkbtn" data-r2-view="reco" onClick={() => { S.r2View = ""; render(); }}>Back to the reconciliation</button>}
        <More label="⋯" ariaLabel="More: 2B" data-r2-more="" items={[["See the 2B as the portal shows it", () => { S.r2View = "portal"; render(); }, { "data-r2-view": "portal" }],
          typeof m2bAgain === "function" && ["Match again", () => m2bAgain(reg), { "data-m2b-again": "" }]]} />
      </div>
      {wrong.length > 0 && <p className="note" style={{ color: "var(--warn)" }}>{wrong.length + " 2B file" + (wrong.length === 1 ? " is" : "s are") + " for " + Array.from(new Set(wrong.map((t) => t.gstin))).join(", ") + ", not this client’s registration."}</p>}
      {(sk.setOff || sk.taxOnly) ? <p className="note" style={{ margin: "4px 0 0" }}>{"Left out of Tally’s side: " + [sk.setOff ? sk.setOff + " set-off entr" + (sk.setOff === 1 ? "y" : "ies") + " (output tax against credit)" : "", sk.taxOnly ? sk.taxOnly + " tax-only entr" + (sk.taxOnly === 1 ? "y" : "ies") + " with no supplier GSTIN or value (rounding, reversals)" : ""].filter(Boolean).join(" and ") + "."}</p> : null}
    </section>
    {portal ? (() => { const sc0 = r2Scope(); return <TwoBPortal reg={reg} months={sc0.months} label={sc0.label} />; })() : <ItcReco reg={reg} />}
  </>;
}
