import "./newlook.css";
// The firm Home's Needs you in the new look (the owner, 23-Nov-2026): the warnings Settings' Needs you held about Tally
// ("Your computer with Tally is offline", a link to the Tally page) and the GST API
// ("GST API not linked for N clients", "ends soon"), now that GST portal links are on the firm's GST page; each is a link
// to Due dates › GST portal links. The same reading as Settings' (firmSignals: the clients' GSTINs, GSTAPI's sessions).
import { firmNeedItems } from "../lib/firmNeeds.js";
// (one Needs you on Home, the re-review of 23-Nov-2026: the figure in Home's Needs you tile counts these too, so this strip
// carries no count of its own that could say otherwise)
// Home's Needs you tile counts these too (screens/Today.jsx reads it through window, so the first file stays as it was);
// drawn again once this file has come, so the tile's figure includes them from the start
if (typeof window === "object") { window.__nlFirmNeeds = () => firmNeedItems().length; if (typeof render === "function") setTimeout(render, 0); }
export default function HomeNeeds() {
  const items = firmNeedItems();
  if (!items.length) return null;
  const go = { gstapi: () => { S.nlDueTab = "gstapi"; navHome("compliance"); }, tally: () => { S.tallyFocus = ""; S.tallyTab = "computers"; navHome("tally"); } };
  return <div className="nl-needs" role="region" aria-label="Needs you" data-nl-home-needs="">
    <b>Needs you</b>
    {items.map(([k, t]) => <button key={t} type="button" className="linkbtn" data-nl-needs-go={k} onClick={go[k]}>{t}</button>)}
  </div>;
}
