// Compliance (the TDS & GST makeover, round 46, 11-Oct-2026): the firm's page for what is due across every client, one
// row per return or payment, one click into it. It was the list at the foot of Today; Today keeps a one-line count.
import DueAll from "../parts/DueList.jsx";
import "../parts/returns.css";

export default function Compliance() {
  if (!sortedCompanies().length) return <div className="tg-empty" data-list-empty="">No clients yet. Each client’s GST and TDS returns appear here once it is added.
    <div><button className="btn small primary" onClick={() => doAct("addCo")}>Add client</button></div></div>;
  return <section className="compliance" data-compliance=""><DueAll /></section>;
}
