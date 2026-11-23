// The firm's GST page in the new look (the owner, 23-Nov-2026: "move GST portal links out of Settings into the GST firm
// page"): the firm menu's Due dates (screens/Compliance.jsx, what is due across every client) with a row of two tabs,
// Due dates · GST portal links (screens/GstApiAll.jsx, every client's GST portal link, as it was in Settings). GST
// portal links need the firm account (as in Settings); signed out, only Due dates.
import Compliance from "../screens/Compliance.jsx";
import GstApiAll from "../screens/GstApiAll.jsx";
import "./newlook.css";

const TABS = [["due", "Due dates"], ["gstapi", "GST portal links"]];
export default function NLDue() {
  const cloud = typeof Cloud === "object" && Cloud.on();
  const tab = cloud && S.nlDueTab === "gstapi" ? "gstapi" : "due";
  const go = (k) => () => { S.nlDueTab = k; render(); window.scrollTo(0, 0); };
  return <div data-nl-due={tab}>
    {cloud && <nav className="nl-tabs" aria-label="GST and due dates">{TABS.map(([k, w]) => <button key={k} type="button" className="nl-tab" data-nl-duetab={k} aria-current={k === tab ? "page" : undefined} onClick={go(k)}>{w}</button>)}</nav>}
    {tab === "gstapi" ? <GstApiAll /> : <Compliance />}
  </div>;
}
