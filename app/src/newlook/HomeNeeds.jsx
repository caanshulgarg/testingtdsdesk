import "./newlook.css";
// The firm Home's Needs you in the new look (the owner, 23-Nov-2026): the GST API warnings that Settings' Needs you held
// ("GST API not linked for N clients", "ends soon"), now that GST portal links are on the firm's GST page; each is a link
// to Due dates › GST portal links. The same reading as Settings' (firmSignals: the clients' GSTINs, GSTAPI's sessions).
const plural = (n, one) => n + " " + (n === 1 ? one : one + "s");
export function gstSignals() {
  const G = typeof GSTAPI === "object" ? GSTAPI : null;
  if (!G) return { notLinked: 0, soon: 0 };
  const gstins = Array.from(new Set(Object.values(S.companies || {}).filter((c) => c && !c.deleted).map((c) => String(c.gstin || "").toUpperCase()).filter((g) => /^\d{2}[A-Z0-9]{13}$/.test(g))));
  const notLinked = gstins.filter((g) => { const x = (G.sess || {})[g]; return !!x && !!(x.connectedAt || x.endedAt || x.error) && !G.live(g); }).length;
  const soon = gstins.filter((g) => { const x = G.live(g) && G.accessLeft ? G.accessLeft(g) : null; return x && x.soon && !x.over; }).length;
  return { notLinked, soon };
}
export default function HomeNeeds() {
  if (typeof Cloud !== "object" || !Cloud.on()) return null;
  const sig = gstSignals(), items = [];
  if (sig.notLinked) items.push("GST API not linked for " + plural(sig.notLinked, "client"));
  if (sig.soon) items.push("GST API link ends soon for " + plural(sig.soon, "client"));
  if (!items.length) return null;
  const go = () => { S.nlDueTab = "gstapi"; navHome("compliance"); };
  return <div className="nl-needs" role="region" aria-label="Needs you" data-nl-home-needs="">
    <b>{"Needs you (" + items.length + ")"}</b>
    {items.map((t) => <button key={t} type="button" className="linkbtn" data-nl-needs-go="gstapi" onClick={go}>{t}</button>)}
  </div>;
}
