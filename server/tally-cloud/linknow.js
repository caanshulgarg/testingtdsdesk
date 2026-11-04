// next-tally-linknow (28-Oct-2026; the owner: "FinCom should not deny. If I click, it should link it."). tally_companies
// was written only by the bridge's "companies" message (bridge-go cloud.go updateCloudLinks, every CloudLinksSec = 300 s),
// so a company opened in Tally waited up to 5 minutes before it could be linked, although the bridge's 30-second beat
// already named it open (staging: "Salesify Marketing LLP 2026-27" open in the beat from 13:10:54 UTC, refused by
// tally_company_link five times 13:11:03-13:12:05, its row only at 13:16:08). Now:
//   - the beat registers the companies it says open that the firm's list lacks (beatNewOpen; no link, nothing else changed)
//   - a person's click (tally-ingest's user kind "link_now") registers the company for the device that runs the
//     browser's own bridge (linkDevice) and links it in the same call
// Plain JS (no Deno or Supabase API) so the rules are tested on their own (linknow_test.ts).

// a company's name as compared across the beat and the list (spaces collapsed, case off): index.ts coName
export const coName = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// next-tally-connectfix (04-Nov-2026): a Tally company's name as a beat says it: trimmed of spaces, tabs and CR/LF at
// either end (staging: a name came with "\r\n\r\n" at its end), at most 200 characters; "" when not a string
export const coTrim = (v) => typeof v === "string" ? v.replace(/^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g, "").slice(0, 200) : "";

// the company's name as the bridge returned it: trimmed; empty when not a name (control characters, longer than 200 —
// never cut, a cut name could be another company's)
export function cleanCompany(v) {
  if (typeof v !== "string") return "";
  const s = v.trim();
  if (!s || s.length > 200 || /[\u0000-\u001f\u007f]/.test(s)) return "";
  return s;
}

const BRIDGE_ID = /^go-[0-9a-f]{6,32}$/;
function openOn(d) {
  const out = new Set(), info = d && d.info && typeof d.info === "object" ? d.info : {};
  const add = (list) => { for (const o of Array.isArray(list) ? list : []) out.add(coName(o)); };
  add(info.beat && info.beat.open);
  for (const b of Object.values(info.bridges && typeof info.bridges === "object" ? info.bridges : {})) add(b && b.open);
  return out;
}
// devs: the caller's firm's tally_devices rows only. The device that runs the browser's own bridge (its proven id: the
// /ping proof the page checked), else one whose latest beat has the company open; a removed device never
export function linkDevice(devs, bridgeId, company) {
  const live = (Array.isArray(devs) ? devs : []).filter((d) => d && d.id && !d.revoked);
  const bid = String(bridgeId || "");
  if (BRIDGE_ID.test(bid)) {
    const own = live.find((d) => d.info && d.info.bridges && typeof d.info.bridges === "object" && Object.prototype.hasOwnProperty.call(d.info.bridges, bid));
    if (own) return own;
  }
  const k = coName(company);
  if (!k) return null;
  return live.find((d) => openOn(d).has(k)) || null;
}

// the companies a beat says open (its open list and companies[] with open: true) that `have` (the firm's tally_companies
// names, exact) lacks; at most 50 a beat
export function beatNewOpen(beat, have) {
  const b = beat && typeof beat === "object" ? beat : {}, out = [], seen = new Set();
  const add = (n) => { const s = cleanCompany(n); if (s && !seen.has(s) && !(have && have.has(s))) { seen.add(s); out.push(s); } };
  for (const n of Array.isArray(b.open) ? b.open : []) add(n);
  for (const c of Array.isArray(b.companies) ? b.companies : []) if (c && c.open === true) add(c.name);
  return out.slice(0, 50);
}

// migration 127 (the owner: "I don't want false alarms at all"): a data place counts only once entries came from it. The
// latest day of a days call that has an entry (<VOUCHER), read latest first (one day read in the usual case); "" when none.
// decode(day) gives the day's text (tally-ingest: b64 or gzip); a day that cannot be read is passed over
const DAY = /^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
export async function latestEntryDay(days, decode) {
  const list = (Array.isArray(days) ? days : []).slice(0, 62).filter((d) => d && typeof d.day === "string" && DAY.test(d.day))
    .sort((x, y) => y.day.localeCompare(x.day));
  for (const d of list) {
    let text = "";
    try { text = String(await decode(d)); } catch (_) { continue; }
    if (/<VOUCHER[\s>]/i.test(text)) return d.day;
  }
  return "";
}

// next-tally-connectfix (04-Nov-2026; staging: only 3 of 7 tally_links had windows_user and tally_port): where a company
// linked at a click is, from its device's beat: the bridge the browser named (its id in info.bridges), else the bridge
// whose beat has the company open, else the device's own beat. {user, port}; "" / 0 when not known
export function linkPlace(dev, bridgeId, company) {
  const info = dev && dev.info && typeof dev.info === "object" ? dev.info : {}, beat = info.beat && typeof info.beat === "object" ? info.beat : {};
  const br = info.bridges && typeof info.bridges === "object" ? info.bridges : {}, k = coName(company);
  const has = (b) => Array.isArray(b && b.open) && b.open.some((o) => coName(o) === k);
  const bid = String(bridgeId || "");
  const b = (BRIDGE_ID.test(bid) && br[bid]) || Object.values(br).find((x) => x && has(x)) || null;
  const port = (v) => { const n = Math.floor(Number(v)); return n > 0 && n <= 65535 ? n : 0; };
  const user = String((b && b.user) || beat.windowsUser || "").trim().slice(0, 60);
  return { user, port: port(b && b.tallyPort) || port(beat.tallyPort) };
}
