// What the firm's Needs you says, read in one place: Settings' Needs you (screens/Settings.jsx firmSignals) and, in the
// new look, the firm Home's (newlook/HomeNeeds.jsx).
//   tallyOffline: this person's own bridge's computer (FCOwn.bridge), heard with Tally open within the week and not now,
//     as TLight last read the firm's computers (within 3 minutes, a beat every 30 s; each beat's age told as of that read,
//     devState at TL.at, not as of now); never while their bridge answers this browser (the top bar says Connected)
//   gstSignals: the GST API links that lapsed (a client's GSTIN that once had a session, connected, ended or failed, and
//     is not live now; a GSTIN only looked up is not counted) and those whose access ends soon
import { tallyDevs, pcLive, seenWords, openOn } from "./tallyState.js";

const WEEK = 7 * 864e5;
export function tallyOffline() {
  const beatOf = (d) => (((d && d.info) || {}).beat || {}), beatAt = (d) => Date.parse(beatOf(d).at || (d && d.last_seen) || "") || 0;
  const TL = typeof TLight === "object" ? TLight.st || {} : {};
  const fresh = !!TL.at && Date.now() - TL.at < 180000 && !(typeof TStale === "object" && TStale.now(["light"]));
  let own = null, answers = false;
  try { own = window.FCOwn && window.FCOwn.bridge ? window.FCOwn.bridge() : null; answers = !!(window.FCOwn && window.FCOwn.state && (window.FCOwn.state() || {}).state === "ok"); } catch (e) { own = null; }
  const liveAtRead = (d) => { try { const b = typeof devState === "function" ? devState(d, TL.at).bridge : ""; return b === "online" || b === "reconnecting"; } catch (e) { return pcLive(d); } };
  const dev = own && own.dev && tallyDevs().find((d) => d.id === own.dev.id);
  const hadTally = (d) => { const b = beatOf(d); return !!b.tally || b.tallyState === "open" || b.tallyState === "busy" || openOn(d).length > 0; };
  const off = fresh && !answers && dev && beatAt(dev) && TL.at - beatAt(dev) < WEEK && hadTally(dev) && !liveAtRead(dev) ? [dev] : [];
  return { off, offSince: off.length ? seenWords(new Date(beatAt(off[0])).toISOString()) : "" };
}
export function gstSignals() {
  const G = typeof GSTAPI === "object" ? GSTAPI : null;
  if (!G) return { notLinked: 0, soon: 0 };
  const gstins = Array.from(new Set(Object.values(S.companies || {}).filter((c) => c && !c.deleted).map((c) => String(c.gstin || "").toUpperCase()).filter((g) => /^\d{2}[A-Z0-9]{13}$/.test(g))));
  const notLinked = gstins.filter((g) => { const x = (G.sess || {})[g]; return !!x && !!(x.connectedAt || x.endedAt || x.error) && !G.live(g); }).length;
  const soon = gstins.filter((g) => { const x = G.live(g) && G.accessLeft ? G.accessLeft(g) : null; return x && x.soon && !x.over; }).length;
  return { notLinked, soon };
}

// the firm's own Needs you items, as Settings' Needs you had them (the same words and order): [key, words]. The new look's
// Home lists them (newlook/HomeNeeds.jsx) and counts them in its Needs you figure (screens/Today.jsx): one count
const plural = (n, one) => n + " " + (n === 1 ? one : one + "s");
export function firmNeedItems() {
  // (GST portal links need the firm account, as in Settings; the Tally warning, as in Settings, does not)
  const cloud = typeof Cloud === "object" && Cloud.on();
  const sig = Object.assign({}, tallyOffline(), cloud ? gstSignals() : { notLinked: 0, soon: 0 }), items = [];
  if (sig.off.length) items.push(["tally", "Your computer with Tally is offline" + (sig.offSince ? " since " + sig.offSince : "")]);
  if (sig.notLinked) items.push(["gstapi", "GST API not linked for " + plural(sig.notLinked, "client")]);
  if (sig.soon) items.push(["gstapi", "GST API link ends soon for " + plural(sig.soon, "client")]);
  return items;
}
