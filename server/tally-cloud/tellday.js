// next-tally-tell-ingest (the owner's decision of 24-Nov-2026: "There should be proper way to tell and auto import of tally
// days into fincom"; the plan tally-tell-autoday, A.4, A.5 and B.3). Plain JS (no Deno or Supabase API) so the rules are
// tested on their own (tellday_test.ts).
//   - cleanTell: what bridge 2.5.22 says of why it reads nothing (skip, numbersWhy, addonSilent), cleaned, and the
//     companies the cloud itself hands no day of for want of a starting point (unstarted), kept on info.bridges[id].tell.
//     Codes only: the words are FinCom's own (migration 221's tally_tell_of), never the bridge's.
//   - autoDaysFor / autoKept: a day FinCom queued by itself (held, delete, gap, future) goes only to a bridge of 2.5.16 or
//     later, and only by claim (tally_days_claim, which hands a day only to a bridge serving the book: tally_read_serves).
//   - due: migration 222's tally_autoday_queue at most once a book per 10 minutes.
//   - noUploadAsk: FinCom never asks for a Day Book upload; it brings the day from Tally by itself.
//   - beforeStartWhy: a line dated before the book's first day never promises the day is read by itself.
//   - pickupsToSay: the bridge's pick-up words for check days, each told once to 222's tally_autoday_pickup.
//   - cleanBands / bandsWhole: a day read in MasterID bands is whole only end to end with no hole (222's rule).
import { coName, coTrim } from "./linknow.js";

export const SKIP_CODES = ["ownerUnknown", "twoTallys", "otherLogin", "notOpen", "otherCopy", "slow"];
export const NUMBERS_CODES = ["ownerUnknown", "twoTallys", "lightFailed", "over2s", "notAsked"];
export const ADDON_REASONS = ["addonShared", "addonAdded", "noFile", "fileUnreadable"];
const MAX = 50;
const ISO_Z = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,9})?(Z|[+-]\d\d:\d\d)$/;
const plain = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const alter = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e15 ? Math.floor(v) : null;
// index.ts altOf: a change number as the beat says it (a number or its digits); 0 or less, a boolean, blank: none
const altOf = (v) => v === null || v === undefined || v === "" || typeof v === "boolean" ? null : alter(Number(v));

// {company: code} with known codes only, names trimmed and cut to 200, the first of a name kept, at most 50
function codesOf(x, known) {
  const out = {}, seen = new Set();
  for (const [k, v] of Object.entries(plain(x) ? x : {})) {
    if (Object.keys(out).length >= MAX) break;
    const name = coTrim(k);
    if (!name || typeof v !== "string" || !known.includes(v) || seen.has(coName(name))) continue;
    seen.add(coName(name)); out[name] = v;
  }
  return out;
}
function addonOf(x) {
  const out = [], seen = new Set();
  for (const a of Array.isArray(x) ? x : []) {
    if (out.length >= MAX) break;
    if (!plain(a)) continue;
    const company = coTrim(a.company);
    if (!company || seen.has(coName(company))) continue;
    seen.add(coName(company));
    const g = typeof a.guid === "string" ? a.guid.trim().toLowerCase() : "";
    out.push({ company, guid: /^[0-9a-z-]{1,100}$/.test(g) ? g : "", reason: ADDON_REASONS.includes(a.reason) ? a.reason : "",
      since: typeof a.since === "string" && ISO_Z.test(a.since) && !isNaN(Date.parse(a.since)) ? a.since : "",
      tallyAlter: alter(a.tallyAlter), lastLineAlter: alter(a.lastLineAlter) });
  }
  return out;
}

// the companies this beat says open that are handed no day for want of a starting point (index.ts periodDaysFor's rule):
// the bridge sends Tally's numbers for some company but none for this one and its startPoint lacks it (why noNumbers),
// or the bridge refused one of its days with noStart in the last 10 minutes (why noStart). Map coName -> {name, why}
export function unstartedOf(body, now = Date.now()) {
  const out = new Map();
  const sp = new Set(Object.keys(plain(body?.startPoint) ? body.startPoint : {}).map((k) => coName(coTrim(k))));
  const noStart = new Set();
  for (const x of (Array.isArray(body?.pickups) ? body.pickups : []).slice(0, 20)) {
    if (x?.state === "refused" && x?.code === "noStart" && now - Date.parse(String(x?.at || "")) < 600000) noStart.add(coName(coTrim(x?.company)));
  }
  const cos = (Array.isArray(body?.companies) ? body.companies : []).slice(0, 200);
  const sendsAlt = cos.some((c) => plain(c) && ("altvchid" in c || "altmstid" in c));
  // (review of fbaad9811: two open copies of one name, migration 203: left out only when NO open copy has the numbers)
  const hasNums = new Set();
  for (const c of cos) if (plain(c) && c.open === true && (altOf(c.altvchid) !== null || altOf(c.altmstid) !== null)) hasNums.add(coName(coTrim(c.name)));
  for (const c of cos) {
    if (!plain(c) || c.open !== true) continue;
    const name = coTrim(c.name), k = coName(name);
    if (!name || out.has(k)) continue;
    if (noStart.has(k)) out.set(k, { name, why: "noStart" });
    else if (sendsAlt && !hasNums.has(k) && !sp.has(k)) out.set(k, { name, why: "noNumbers" });
  }
  return out;
}

// info.bridges[id].tell: {skip, numbersWhy, addonSilent} when the bridge sends any of them (2.5.22), {unstarted: {name:
// {why, since}}} when the cloud hands a company no day for want of a starting point (since: when first seen so, kept from
// the bridge's tell before), and at. {} when there is nothing to keep (an older bridge with every company started)
export function cleanTell(body, prev, now = Date.now()) {
  const sent = plain(body?.skip) || plain(body?.numbersWhy) || Array.isArray(body?.addonSilent);
  const at = new Date(now).toISOString();
  const before = plain(prev?.unstarted) ? prev.unstarted : {};
  const unstarted = {};
  for (const { name, why } of unstartedOf(body, now).values()) {
    const was = before[name];
    unstarted[name] = { why, since: plain(was) && typeof was.since === "string" && ISO_Z.test(was.since) ? was.since : at };
  }
  const has = Object.keys(unstarted).length > 0;
  if (!sent && !has) return {};
  return { tell: { ...(sent ? { skip: codesOf(body.skip, SKIP_CODES), numbersWhy: codesOf(body.numbersWhy, NUMBERS_CODES), addonSilent: addonOf(body.addonSilent) } : {}),
    ...(has ? { unstarted } : {}), at } };
}

// a bridge of 2.5.16 or later (the typing clock lastKeySec and dayRetry, which the days FinCom queues by itself rely on)
export function autoDaysFor(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? "").trim());
  if (!m) return false;
  const [a, b, c] = [+m[1], +m[2], +m[3]];
  return a !== 2 ? a > 2 : b !== 5 ? b > 5 : c >= 16;
}

// the sources of tally_check_days a person asked for (Upload, Check for changes, Bring missing days); any other (held,
// delete, gap, future, or not known) is FinCom's own
// (review of fbaad9811: only 222's NEW sources are gated; 196's held days and 160's gap days stay as older bridges read them)
export const AUTO_SOURCES = new Set(["delete", "future"]);
const PERSON_SOURCES = new Set(["upload", "check", "fill", "held", "gap"]);
// whether a check day may go to this bridge in this answer. autoOn: the cloud has migration 222 (else as before);
// newBridge: autoDaysFor; claimed: it came by tally_days_claim (the bridge serves the book)
export function autoKept(source, { autoOn, newBridge, claimed }) {
  if (!autoOn || PERSON_SOURCES.has(source)) return true;
  return !!newBridge && !!claimed;
}

export const AUTO_EVERY_MS = 600000;
// true (and noted) when key was not noted in the last `every` ms
export function due(memo, key, now = Date.now(), every = AUTO_EVERY_MS) {
  const last = memo.get(key);
  if (last !== undefined && now - last < every) return false;
  if (memo.size >= 5000) memo.clear();
  memo.set(key, now);
  return true;
}

export const BRING_WORDS = "FinCom brings this day from Tally by itself.";
// words with any ask for an upload taken out: a sentence that asks is dropped, or cut at its colon when what comes
// before says what happened; FinCom's own words (tail) then end it. Words that ask nothing: as they are
// 222's words for a day given up (tally_period_days.upload_words): no promise to read it again
export const GIVEN_UP_WORDS = "FinCom could not read this day from Tally by itself.";
// tail "": the ask only taken out, nothing promised (GIVEN_UP_WORDS when nothing is left)
export function noUploadAsk(words, tail = BRING_WORDS) {
  const w = typeof words === "string" ? words.trim() : "";
  if (!w || !/upload/i.test(w)) return w;
  const kept = [];
  for (const s of w.split(/(?<=[.!?])\s+/)) {
    const i = s.search(/upload/i);
    if (i < 0) { kept.push(s); continue; }
    const head = s.slice(0, s.lastIndexOf(":", i) + 1 || 0).replace(/[\s:;,]+$/, "");
    if (s.lastIndexOf(":", i) >= 0 && head) kept.push(head + ".");
  }
  if (!tail) return kept.length ? kept.join(" ") : GIVEN_UP_WORDS;
  return kept.length ? kept.join(" ") + " " + tail : tail;
}

// the owner's answer of 24-Nov-2026: a year before the book's first day is never added or read by itself (the page says
// it once and offers "Add 2025-26"). A line's words for a day before the book's first day (day, from: yyyy-mm-dd) say so
// instead of FinCom's promise to bring the day; other words, or a day on or after it, or either not known: as they are
export const BEFORE_START_WORDS = "It is dated before this book's first day in FinCom.";
const READS_AGAIN = "FinCom reads this day from Tally again by itself to settle it";
export function beforeStartWhy(words, day, from) {
  const w = typeof words === "string" ? words : "";
  if (!w || !day || !from || String(day) >= String(from)) return w;
  return w.split(BRING_WORDS).join(BEFORE_START_WORDS).split(READS_AGAIN).join("it is dated before this book's first day in FinCom");
}

// migration 222's tally_autoday_pickup(book, day, code): what to tell it from a beat's pickups (index.ts pickupsOf, each
// with its book): this bridge's words for check days (kind check or fill: the days of tally_check_days), "started" or the
// refusal's code, each word once (not one said in the beat before: the same book, day, kind, state, code and hand-out
// time); the day as yyyy-mm-dd; at most 20
export function pickupsToSay(now, before, bridge) {
  const key = (e) => [e.bridge, e.book, e.day, e.kind, e.state, e.code || "", e.takenAt].join("|");
  const was = new Set((Array.isArray(before) ? before : []).filter(plain).map(key));
  const out = [];
  for (const e of Array.isArray(now) ? now : []) {
    if (out.length >= 20) break;
    if (!plain(e) || e.bridge !== bridge || !e.book || !/^\d{8}$/.test(String(e.day || "")) || !["check", "fill"].includes(e.kind) || was.has(key(e))) continue;
    const code = e.state === "started" ? "started" : e.state === "refused" && typeof e.code === "string" && e.code ? e.code : "";
    if (!code) continue;
    out.push({ book: String(e.book), day: e.day.slice(0, 4) + "-" + e.day.slice(4, 6) + "-" + e.day.slice(6, 8), code });
  }
  return out;
}

// a heavy day read in MasterID bands (FinComDayHeadsPart, bridge 2.5.22 sends them with the list): [[from, to], ...], each
// a whole number (from 1, to at least from, or null for the last, open-ended one), at most 2000; anything else: null
const mid = (v) => typeof v === "number" ? (Number.isInteger(v) && v >= 1 && v < 1e18 ? v : null) : typeof v === "string" && /^[1-9]\d{0,17}$/.test(v) ? Number(v) : null;
export function cleanBands(x) {
  if (!Array.isArray(x) || !x.length || x.length > 2000) return null;
  const out = [];
  for (const b of x) {
    if (!Array.isArray(b) || b.length < 1 || b.length > 2) return null;
    const a = mid(b[0]), z = b.length < 2 || b[1] === null ? null : mid(b[1]);
    if (a === null || (b.length === 2 && b[1] !== null && z === null)) return null;
    out.push([a, z]);
  }
  return out;
}
// 222's tally_autoday_bands_whole, mirrored (the cloud asks the held deletes and the period's count only of a whole list):
// the bands start at 1, each next one right after the one before, the last open-ended, every head's MasterID in a band
export function bandsWhole(bands, heads) {
  const b = cleanBands(bands);
  if (!b || !Array.isArray(heads)) return false;
  const s = [...b].sort((x, y) => x[0] - y[0]);
  for (let i = 0; i < s.length; i++) {
    const [a, z] = s[i];
    if (i === 0 && a !== 1) return false;
    if (i > 0 && (s[i - 1][1] === null || a !== s[i - 1][1] + 1)) return false;
    if (z !== null && z < a) return false;
    if (i === s.length - 1 && z !== null) return false;
  }
  return heads.every((h) => Array.isArray(h) && /^\d{1,18}$/.test(String(h[1] ?? "")) && Number(h[1]) > 0 && s.some(([a, z]) => Number(h[1]) >= a && (z === null || Number(h[1]) <= z)));
}

// how a day's list is taken (the SQL builder's second round of 222): {via, bands} - via "day" (whole) or "split" (partial)
// for the held deletes and the period's count; bands: the cleaned ranges for 222's 5-argument tally_check_heads, or null
// (then the 4-argument call with via). A bands list with its ranges: whole only end to end with no hole; one without
// them (bridges 2.5.19-2.5.21): today's mapping, a whole day; "split": partial; anything else: a whole day
// (review of fbaad9811: ranges SENT but not readable - [], too many, malformed - are partial, never a whole day; sent: the
// body has the key with a value other than null)
export function headsVia(via, bands, heads, sent = bands !== undefined && bands !== null) {
  const b = via === "bands" ? cleanBands(bands) : null;
  if (b) return { via: bandsWhole(b, heads) ? "day" : "split", bands: b };
  if (via === "bands" && sent && bands !== null && bands !== undefined) return { via: "split", bands: null };
  return { via: via === "split" ? "split" : "day", bands: null };
}
