// Ask FinCom's card for an MIS laid out from the person's words (build_mis, server/assistant/mis.ts; ROUND 105, B4): the
// report's name and blocks, the names it uses that are not in the client's books (flagged, with the closest names), and
// "Open in My MIS", which opens the layout in the builder (books:mymis) to adjust, save and share. No figure is here:
// the builder works every figure out from the books.
import Button from "./Button.jsx";
import { normalizeDef, newId } from "../../../server/_shared/misdef.js";

const TYPE = { table: "Table", chart: "Chart", kpi: "KPI tile" };
export default function AssistantMis({ r }) {
  const n = normalizeDef(r.definition || {}), d = n.def, unknown = r.unknown || [];
  const open = () => {
    const def = Object.assign({}, d, { id: newId("m") });
    S.myMis = { cid: r.client, def, sel: def.blocks[0] ? def.blocks[0].id : "", saved: "", dirty: true, unknown: unknown.map((u) => Object.assign({}, u)), msg: "Laid out by Ask FinCom from your words: check it, then Save." };
    if (r.client && S.coId !== r.client && typeof openCompany === "function") { try { openCompany(r.client); } catch (e) { /* the builder opens on the client open */ } }
    try { ASST.close(); } catch (e) { /* the panel stays */ }
    goClient("books:mymis");
  };
  return <section className="asst-card mis" data-asst-mis="">
    <header><span className="asst-src neutral">Layout only · figures from the books</span><b>{d.name}</b></header>
    {r.summary ? <p className="note">{r.summary}</p> : null}
    <ol className="asst-mis-blocks">{d.blocks.map((b) => <li key={b.id}>{b.title} <span className="note">({TYPE[b.type]})</span></li>)}</ol>
    {unknown.length > 0 && <p className="asst-mis-unknown" data-asst-mis-unknown="">{"Not in the books: " + unknown.map((u) => u.name + (u.choices && u.choices.length ? " (closest: " + u.choices.slice(0, 3).join(", ") + ")" : "")).join("; ") + ". Pick the right names in the builder."}</p>}
    {(r.problems || []).length > 0 && <p className="note">{"Changed: " + r.problems.slice(0, 4).join("; ") + "."}</p>}
    <Button className="btn small primary" data-asst-mis-open="" onClick={open}>Open in My MIS</Button>
  </section>;
}
