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
if (typeof window === "object") window.postWaitWhy = (job) => { try { return postWaitWhy(job); } catch (e) { return ""; } };
