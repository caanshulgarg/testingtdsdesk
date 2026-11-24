// Why a posting of FinCom's cloud still waits, for the Post page's words (src/js/62-post-reasons postStatus codes 4 and 5;
// next-posting-never-stuck). Read from what the posting's own bridge said in its last beat (tally_devices.info.bridges, as
// TLight and the Tally page read them): Tally closed, the company not open in its Tally, the Tally computer off (the bridge
// not heard from for three of its own beats, as devState says offline) or Tally busy. "" when the beat explains nothing: the posting's own words then. The owner
// (23-Nov-2026): "warnings say just 'Tally is closed'", plain and short, no computer and no Windows user named, and no new
// warnings in posting (an old bridge is allowed and not said). The cloud's 2-hour "restart FinCom Bridge" is never shown while
// the bridge says Tally is closed. Its own file, with the Post page's (nothing of it in legacy.js).
import { tallyDevs } from "./tallyState.js";

const norm = (x) => String(x || "").trim().replace(/\s+/g, " ").toLowerCase();

// the posting's bridge as its computer last told the cloud: {online, tally, open} or null
function bridgeOf(job, devs, now) {
  const id = (job && (job.taken_by || job.target_bridge)) || "";
  if (!id) return null;
  for (const d of devs) {
    const b = (((d && d.info) || {}).bridges || {})[id];
    if (!b) continue;
    // (as src/js/49 devState: the bridge's own beat interval, 10 s to 10 minutes, 60 s when not said; its time from the
    // cloud's clock, corrected for this computer's (TallyClock); off after three beats missed and 30 s more)
    const at = Date.parse(b.at || "") || 0, every = Math.max(10, Math.min(600, Number(b.every || ((d.info || {}).beat || {}).every) || 60));
    const skew = typeof TallyClock === "object" && TallyClock && TallyClock.skew ? TallyClock.skew() : 0, seen = Math.min(now, at + skew);
    return { online: !!at && now - seen <= (3 * every + 30) * 1000, tally: b.tallyState || (b.tally ? "open" : "closed"), open: [].concat(b.open || []) };
  }
  return null;
}
export function postWaitWhy(job, devs, now = Date.now()) {
  if (!job || !["waiting", "taken", "running"].includes(job.status)) return "";
  const b = bridgeOf(job, devs || tallyDevs(), now), co = String(job.company || "the company").trim();
  if (!b) return "";
  if (!b.online) return "The Tally computer is off. Turn it on, then open Tally and " + co + ".";
  if (b.tally === "closed") return "Tally is closed. Open Tally and " + co + ".";
  if (b.tally === "busy") return "Tally is busy. Close any report or pop-up in Tally.";
  if (job.company && !b.open.some((o) => norm(o) === norm(job.company))) return co + " is not open in Tally. Open Tally and " + co + ".";
  return "";
}
// The posting's own words, for when its beat explains nothing (review of 76d6c030e): never a computer or Windows user named
// in them. The cloud writes those in through tally_bridge_words (migration 174's 4a "Still waiting after 6 hours (since …)
// for <computer · user>, which started it …", "Started on <…>", "Moved to <…>", "Held: <…> was posting this"); those are
// put in plain words with no names, and any other words naming a computer, a Windows user or a computer key's name the
// app knows (tally_devices) are left out: "" (the page's own words then)
const NAMED = [
  [/^Still waiting after 6 hours \(since ([^)]*)\) for .+?, which started it .*?Open (.+) in Tally there\.?$/s, (m) => "Still waiting after 6 hours (since " + m[1] + ") for the Tally computer that started it. Open " + m[2] + " in Tally there"],
  [/^Started on .+?, and that FinCom Bridge can no longer post/s, () => "The FinCom Bridge that started it can no longer post. Check in Tally: Mark posted what is there, then post the rest again"],
  [/^Moved to .+? \(the same Windows user, the same computer\)/s, () => "Moved to another FinCom Bridge on the same computer: the bridge it was for can no longer post"],
  [/^Queued: posts by itself when (.+) is opened in Tally on .+? with FinCom Bridge\.?$/s, (m) => "Queued: posts by itself when " + m[1] + " is opened in Tally on a computer with FinCom Bridge"],
  [/^Held: .+? was posting this and can no longer post/s, () => "Held: the FinCom Bridge that was posting this can no longer post; how far it got is not known. Check in Tally: Mark posted what is there, release the rest (Not in Tally)"],
];
export function postWaitMsg(job, devs) {
  const m = String((job && job.message) || "");
  for (const [re, f] of NAMED) { const x = m.match(re); if (x) return f(x); }
  // (any other words: the names left out, the rest kept: src/js/62 postNameScrub, which every page loads; the company's
  // own name never cut, even when a computer key is called so; review of bb00ebcee)
  return postNameScrub(m, [job && job.company], devs || tallyDevs());
}
if (typeof window === "object") window.postWaitMsg = (job) => { try { return postWaitMsg(job); } catch (e) { return ""; } };
if (typeof window === "object") window.postWaitWhy = (job) => { try { return postWaitWhy(job); } catch (e) { return ""; } };
