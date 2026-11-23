import "./newlook.css";
// The firm Home's Needs you in the new look (the owner, 23-Nov-2026): the warnings Settings' Needs you held about Tally
// ("Your computer with Tally is offline", a link to the Tally page) and the GST API
// ("GST API not linked for N clients", "ends soon"), now that GST portal links are on the firm's GST page; each is a link
// to Due dates › GST portal links. The same reading as Settings' (firmSignals: the clients' GSTINs, GSTAPI's sessions).
import { tallyOffline, gstSignals } from "../lib/firmNeeds.js";
const plural = (n, one) => n + " " + (n === 1 ? one : one + "s");
export default function HomeNeeds() {
  // (GST portal links need the firm account, as in Settings; the Tally warning, as in Settings, does not)
  const cloud = typeof Cloud === "object" && Cloud.on();
  const sig = Object.assign({}, tallyOffline(), cloud ? gstSignals() : { notLinked: 0, soon: 0 }), items = [];
  const gst = () => { S.nlDueTab = "gstapi"; navHome("compliance"); }, tally = () => { S.tallyFocus = ""; S.tallyTab = "computers"; navHome("tally"); };
  // the same words and order as Settings' Needs you had
  if (sig.off.length) items.push(["tally", "Your computer with Tally is offline" + (sig.offSince ? " since " + sig.offSince : ""), tally]);
  if (sig.notLinked) items.push(["gstapi", "GST API not linked for " + plural(sig.notLinked, "client"), gst]);
  if (sig.soon) items.push(["gstapi", "GST API link ends soon for " + plural(sig.soon, "client"), gst]);
  if (!items.length) return null;
  return <div className="nl-needs" role="region" aria-label="Needs you" data-nl-home-needs="">
    <b>{"Needs you (" + items.length + ")"}</b>
    {items.map(([k, t, go]) => <button key={t} type="button" className="linkbtn" data-nl-needs-go={k} onClick={go}>{t}</button>)}
  </div>;
}
