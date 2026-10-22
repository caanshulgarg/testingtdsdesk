// FinCom calls (stage 1, the owner's approval of 23-Oct-2026: "Yes, start building… I don't want initial costing"): the
// rules both sides keep. Plain JavaScript with no imports, used by the app (app/src/calls/*), by the fincom-call function
// (server/video-calls/handler.ts imports this file) and by the unit tests (tests/run_call_rules.mjs).
//
// Kinds of room (nobody creates one by hand: each is opened by a button where the work is):
//   client   a client's page, "Call client": the firm's members and the client's people by a guest link
//   meeting  "Schedule meeting": a time, people, an .ics invite; tied to a client when made from a client's page
//   class    an Academy batch, "Start class": the batch's members join directly
//   help     Help, "Start help call": a one-time room
export const KINDS = ["client", "meeting", "class", "help"];

// media: Cloudflare Realtime (SFU + TURN) once its keys are in platform_secrets; until then peer to peer with Cloudflare's
// free STUN, at most 4 people (each sends to every other: 3 uploads of video is what a phone or an office line carries)
export const P2P_MAX = 4;
export const SFU_MAX = 25;
export const STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] }];
export const mediaMode = (cf) => (cf ? "sfu" : "p2p");
export const maxPeople = (mode) => (mode === "sfu" ? SFU_MAX : P2P_MAX);

// who may open a room of a kind: an owner or staff member (a look-only member joins, never hosts)
export function canHost(kind, role) {
  if (!KINDS.includes(kind)) return false;
  return role === "owner" || role === "staff";
}
// who may come straight in (no waiting room): the firm's own members; for a class also a batch member (by the email they
// signed in or verified with). Everyone else waits for the host
export function directEntry(kind, who) {
  if (who.member) return true;
  if (kind === "class" && who.batchMember && who.verified) return true;
  return false;
}
// the room is full: the host sees "the call is full" before admitting more
export const roomFull = (mode, inCall) => inCall >= maxPeople(mode);

// ---------------------------------------------------------------- recording and consent
// recording: off for a client's call unless the firm's owner turned it on for that client; a class is recorded when the
// host asks (the batch is told when it joins); a help call or a meeting without a client likewise
export function recordingAllowed(kind, clientSetting) {
  if (kind === "client" || (kind === "meeting" && clientSetting && clientSetting.client)) return !!(clientSetting && clientSetting.allow_recording === true);
  return KINDS.includes(kind);
}
// days a recording is kept: 90 for a client's call (or the client's own setting, 7 to 3650), a year for a class
export const RETAIN_DEFAULT = { client: 90, meeting: 90, help: 90, class: 365 };
export function retainDays(kind, setting) {
  const d = Number(setting && setting.retention_days);
  if (Number.isFinite(d) && d >= 7 && d <= 3650) return Math.round(d);
  return RETAIN_DEFAULT[kind] || 90;
}
export function retainUntil(kind, setting, startedAt) {
  const t = new Date(startedAt || Date.now());
  t.setUTCDate(t.getUTCDate() + retainDays(kind, setting));
  return t.toISOString().slice(0, 10);
}
export const CONSENT_TEXT = "This call is being recorded";
// a person may send their microphone and camera while a recording runs only after the notice was shown to them and they
// stayed (accepted); before that their sending is held. Without a recording nothing is held
export function mayPublish(recording, acked) {
  if (!recording) return true;
  return !!acked;
}
// the host may start recording only when everyone in the call can be shown the notice (all present have the app's
// recording notice; an older app that cannot show it blocks the start)
export function mayStartRecording(people) {
  return (people || []).every((p) => p.notice !== false);
}

// ---------------------------------------------------------------- tokens
// a guest link carries 32 random bytes (base64url); the database keeps only its sha256. The guest's session after that is
// a signed token: v1.<room>.<participant>.<expiry seconds>.<HMAC-SHA256 base64url>, checked by the function only
export const GUEST_LINK_DAYS = 7;
export const GUEST_SESSION_SECS = 6 * 3600;
export const OTP_MINUTES = 10, OTP_TRIES = 5;
const b64u = (bytes) => {
  let s = ""; const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export function randomToken(n = 32) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64u(a); }
export async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(d)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s) => UUID.test(String(s || ""));
export const linkTokenOk = (t) => /^[A-Za-z0-9_-]{43}$/.test(String(t || ""));
async function hmac(secret, text) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)));
}
export async function signGuest(secret, room, participant, nowSecs, secs = GUEST_SESSION_SECS) {
  if (!secret || secret.length < 32) throw new Error("no signing secret");
  if (!isUuid(room) || !isUuid(participant)) throw new Error("bad ids");
  const body = "v1." + room + "." + participant + "." + Math.floor(nowSecs + secs);
  return body + "." + await hmac(secret, body);
}
// -> {room, participant, exp} or null (bad form, bad signature, expired)
export async function verifyGuest(secret, token, nowSecs) {
  const m = /^v1\.([0-9a-f-]{36})\.([0-9a-f-]{36})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ""));
  if (!m || !secret) return null;
  const want = await hmac(secret, "v1." + m[1] + "." + m[2] + "." + m[3]);
  // compared in full whatever differs first
  let diff = want.length ^ m[4].length;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ (m[4].charCodeAt(i) || 0);
  if (diff) return null;
  const exp = Number(m[3]);
  if (!(exp > nowSecs)) return null;
  return { room: m[1], participant: m[2], exp };
}
export function otpCode() { const a = new Uint32Array(1); crypto.getRandomValues(a); return String(a[0] % 1000000).padStart(6, "0"); }
export const emailOk = (e) => /^[^@\s,;<>]+@[^@\s,;<>]+\.[a-z]{2,}$/i.test(String(e || "")) && String(e).length <= 200;
export const nameOk = (n) => { const s = String(n || "").trim(); return s.length >= 2 && s.length <= 60 && !/[<>]/.test(s); };

// the channel (Supabase Realtime broadcast) a room talks on: never stored, worked out from the room's secret key and its
// epoch; the epoch moves on when someone is removed or the call ends, so an old name hears nothing more
export async function topicFor(key, epoch, part = "call") { return part + ":" + (await sha256Hex(key + ":" + part + ":" + epoch)).slice(0, 40); }

// ---------------------------------------------------------------- chat
export const CHAT_MAX = 4000;
export const FILE_MAX = 20 * 1024 * 1024;
export const chatOk = (b) => typeof b === "string" && b.trim().length > 0 && b.length <= CHAT_MAX;
// links in a chat line: http(s) only, shown as links; everything else as text
export function chatParts(text) {
  const out = [], re = /\bhttps?:\/\/[^\s<>"']+/gi;
  let at = 0, m;
  const s = String(text || "");
  while ((m = re.exec(s))) {
    if (m.index > at) out.push({ text: s.slice(at, m.index) });
    const url = m[0].replace(/[.,;:!?)]+$/, "");
    out.push({ link: url });
    at = m.index + url.length;
    re.lastIndex = at;
  }
  if (at < s.length) out.push({ text: s.slice(at) });
  return out;
}
export const safeFileName = (n) => String(n || "file").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 100) || "file";

// ---------------------------------------------------------------- the transcript
// each person's own microphone is recorded on their own device, in pieces: a piece ends at the first pause of 1.2 s after
// 8 s of speech, and never runs past 55 s (fincom-transcribe takes at most 60 s); a piece with no speech is not sent
export const PIECE_MAX_MS = 55000, PIECE_MIN_MS = 8000, PAUSE_MS = 1200;
export function pieceEnds(ms, silentMs) { return ms >= PIECE_MAX_MS || (ms >= PIECE_MIN_MS && silentMs >= PAUSE_MS); }
// the transcript in the order things were said: each piece {who, start_ms, text}; consecutive pieces of one person joined
export function mergeTranscript(pieces) {
  const list = (pieces || []).filter((p) => p && String(p.text || "").trim()).slice().sort((a, b) => (a.start_ms - b.start_ms) || String(a.who).localeCompare(String(b.who)));
  const out = [];
  for (const p of list) {
    const last = out[out.length - 1];
    if (last && last.who === p.who) last.text += " " + String(p.text).trim();
    else out.push({ who: p.who, start_ms: p.start_ms, text: String(p.text).trim() });
  }
  return out;
}
export const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
export const transcriptText = (lines) => (lines || []).map((l) => "[" + clock(l.start_ms) + "] " + l.who + ": " + l.text).join("\n");

// the summary as the AI must answer it; anything else is refused
export function summaryOk(j) {
  if (!j || typeof j !== "object") return false;
  if (typeof j.summary !== "string" || !j.summary.trim() || j.summary.length > 4000) return false;
  if (!Array.isArray(j.decisions) || !Array.isArray(j.actions) || j.decisions.length > 30 || j.actions.length > 30) return false;
  if (!j.decisions.every((d) => typeof d === "string" && d.length <= 500)) return false;
  return j.actions.every((a) => a && typeof a.title === "string" && a.title.trim() && a.title.length <= 300
    && (a.who == null || typeof a.who === "string") && (a.due == null || a.due === "" || /^\d{4}-\d{2}-\d{2}$/.test(a.due)));
}

// ---------------------------------------------------------------- the calendar invite
const icsEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
const icsTime = (d) => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
// lines folded at 75 octets as RFC 5545 asks
const fold = (l) => { const out = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); };
export function icsFor({ uid, title, start, minutes, url, organizer, description }) {
  const end = new Date(new Date(start).getTime() + (Number(minutes) || 30) * 60000);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//FinCom//Calls//EN", "METHOD:PUBLISH", "BEGIN:VEVENT",
    "UID:" + uid + "@fincom.live", "DTSTAMP:" + icsTime(Date.now()), "DTSTART:" + icsTime(start), "DTEND:" + icsTime(end),
    "SUMMARY:" + icsEsc(title), "DESCRIPTION:" + icsEsc((description ? description + "\n\n" : "") + "Join: " + url), "URL:" + url,
    ...(organizer ? ["ORGANIZER;CN=" + icsEsc(organizer.name || organizer.email) + ":mailto:" + organizer.email] : []),
    "END:VEVENT", "END:VCALENDAR"].map(fold).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- the device
// a light device (4 cores or fewer, or 4 GB or less): blur only is suggested, the touch-up and lighting fix say they may
// make the picture stutter
export const weakDevice = (nav) => (Number(nav && nav.hardwareConcurrency) || 8) <= 4 || (Number(nav && nav.deviceMemory) || 8) <= 4;
export const EFFECTS_OFF = { bg: "none", image: "", light: false, touch: 0 };
export function effectsClean(e) {
  const x = Object.assign({}, EFFECTS_OFF, e || {});
  return { bg: ["none", "blur", "image"].includes(x.bg) ? x.bg : "none", image: typeof x.image === "string" ? x.image.slice(0, 300000) : "",
    light: !!x.light, touch: Math.max(0, Math.min(1, Number(x.touch) || 0)) };
}

// ---------------------------------------------------------------- network
// what to send on a weak line: the picture made smaller, then audio only. In: the outgoing bitrate the browser measures
// (bits a second, 0 if unknown) and the share of packets lost (0..1)
export function sendLevel(bps, loss) {
  if ((bps && bps < 150000) || loss > 0.15) return "audio";
  if ((bps && bps < 400000) || loss > 0.06) return "low";
  if ((bps && bps < 900000) || loss > 0.02) return "mid";
  return "high";
}
export const LEVELS = { high: { scale: 1, bitrate: 1200000 }, mid: { scale: 2, bitrate: 500000 }, low: { scale: 4, bitrate: 150000 }, audio: { scale: 4, bitrate: 0 } };
// the simulcast layer to pull from the SFU for a tile of a given width (px), or "q" on a weak line
export function layerFor(width, weak) { if (weak) return "q"; return width >= 640 ? "f" : width >= 320 ? "h" : "q"; }

// ---------------------------------------------------------------- working together (option A, 23-Oct-2026)
// only signed-in members of the room's firm who can read the client follow the host's FinCom screen; a guest never joins
// it (they see the host's screen share only)
export function mayCowork(p, clientReadable) { return !!(p && p.member && !p.guest && clientReadable); }
export const POINTER_MS = 50;          // about 20 pointer updates a second
export function throttle(fn, ms, now = () => Date.now()) {
  let last = 0, timer = null, pending = null;
  return (...a) => {
    const t = now();
    if (t - last >= ms) { last = t; fn(...a); return; }
    pending = a;
    if (!timer) timer = setTimeout(() => { timer = null; last = now(); fn(...pending); }, ms - (t - last));
  };
}
// the route a follower takes: only these keys of FinCom's state, never data
export const ROUTE_KEYS = ["view", "coId", "tab", "step", "homeTab", "booksTab", "gstTab", "tdsTab", "filter"];
export function routeOf(S) { const r = {}; for (const k of ROUTE_KEYS) if (S && S[k] != null && typeof S[k] !== "object") r[k] = S[k]; return r; }
export function routeClean(r) {
  const out = {};
  for (const k of ROUTE_KEYS) { const v = r && r[k]; if (v == null) continue; if (typeof v === "string" && v.length <= 120) out[k] = v; else if (typeof v === "boolean" || typeof v === "number") out[k] = v; }
  return out;
}

// ---------------------------------------------------------------- remote help (stage 2, option B: RustDesk)
// only an owner or staff member starts it; RustDesk's own accept dialog on the other side is the consent; FinCom never
// asks for, keeps or passes a RustDesk password, and never sets up unattended access
export const mayRemote = (role) => role === "owner" || role === "staff";
export const rustdeskIdOk = (id) => /^[0-9]{9,10}$/.test(String(id || "").replace(/\s+/g, "")) || /^[a-z0-9][a-z0-9_-]{5,30}$/i.test(String(id || "").trim());
export const rustdeskId = (id) => String(id || "").replace(/\s+/g, "").trim();
// RustDesk's own link (its documented URL scheme): rustdesk://connection/new/<id>; never with a password
export const rustdeskUri = (id) => (rustdeskIdOk(id) ? "rustdesk://connection/new/" + encodeURIComponent(rustdeskId(id)) : "");
export const REMOTE_REASON_MAX = 300;
