// Why a posting of FinCom's cloud still waits, for the Post page's words (src/js/62-post-reasons postStatus codes 4 and 5;
// next-posting-never-stuck). Read from what the posting's own bridge said in its last beat (tally_devices.info.bridges, as
// TLight and the Tally page read them): Tally closed, the company not open in its Tally, the Tally computer off (the bridge
// not heard from for 3 minutes) or Tally busy. "" when the beat explains nothing: the posting's own words then. The owner
// (23-Nov-2026): "warnings say just 'Tally is closed'", plain and short, no computer and no Windows user named, and no new
// warnings in posting (an old bridge is allowed and not said). The cloud's 2-hour "restart FinCom Bridge" is never shown while
// the bridge says Tally is closed. Its own file, with the Post page's (nothing of it in legacy.js).
import { tallyDevs } from "./tallyState.js";

const BEAT_MS = 3 * 60000;
const norm = (x) => String(x || "").trim().replace(/\s+/g, " ").toLowerCase();

// the posting's bridge as its computer last told the cloud: {online, tally, open} or null
function bridgeOf(job, devs, now) {
  const id = (job && (job.taken_by || job.target_bridge)) || "";
  if (!id) return null;
  for (const d of devs) {
    const b = (((d && d.info) || {}).bridges || {})[id];
    if (!b) continue;
    const at = Date.parse(b.at || "") || 0;
    return { online: !!at && now - at < BEAT_MS, tally: b.tallyState || (b.tally ? "open" : "closed"), open: [].concat(b.open || []) };
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
  [/^Held: .+? was posting this and can no longer post/s, () => "Held: the FinCom Bridge that was posting this can no longer post; how far it got is not known. Check in Tally: Mark posted what is there, release the rest (Not in Tally)"],
];
function namesOf(devs) {
  const out = new Set(), add = (x) => { const t = String(x || "").trim(); if (t.length >= 3) out.add(t.toLowerCase()); };
  for (const d of devs || []) {
    add(d && d.name); const i = (d && d.info) || {}; add(i.computer); add(i.user);
    for (const b of Object.values(i.bridges || {})) { add(b && b.computer); add(b && b.user); }
  }
  return out;
}
export function postWaitMsg(job, devs) {
  const m = String((job && job.message) || "");
  for (const [re, f] of NAMED) { const x = m.match(re); if (x) return f(x); }
  const lc = m.toLowerCase();
  for (const n of namesOf(devs || tallyDevs())) if (lc.includes(n)) return "";
  return m;
}
if (typeof window === "object") window.postWaitMsg = (job) => { try { return postWaitMsg(job); } catch (e) { return ""; } };
if (typeof window === "object") window.postWaitWhy = (job) => { try { return postWaitWhy(job); } catch (e) { return ""; } };
