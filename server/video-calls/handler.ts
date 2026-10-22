// fincom-call (deployed name): calls inside FinCom, stage 1 (the owner's approval of 23-Oct-2026), "Work together"
// (option A) and the remote-help log (option B, RustDesk). One function, one POST body {action, ...}:
//   members (the signed-in user's token, their two-step sign-in, an active member of a firm):
//     start, join, schedule, invite, roster, admit, deny, remove, end, leave, topic, chat, upload, download, rec_start,
//     rec_part, rec_stop, consent, piece, transcribe, summarise, tasks, cf, cowork, cowork_join, remote, settings,
//     batch_list, batch_save, history
//   guests (no FinCom sign-in): guest_hello and guest_start with the link's token; then a signed guest token (gt) for
//     guest_verify, guest_poll, topic, chat, upload, download, consent, piece, cf, leave
// Media: Cloudflare Realtime (SFU) when platform_secrets cf_realtime_app_id and cf_realtime_token are set (read here only,
// never sent to a browser; the browser's session calls come through `cf`); otherwise peer to peer with Cloudflare's free
// STUN and at most 4 people. TURN (cf_turn_key_id, cf_turn_key_token) is added to the ICE servers when set.
// Mail (the guest's code, the meeting invite): Resend, only when platform_secrets resend_api_key is set (sender
// resend_from, else "FinCom <calls@fincom.live>"), as mis-run sends; without it the link is copied by the host.
// The transcript: each person's own microphone pieces (≤ 55 s) are sent, a few per call, to fincom-transcribe with the
// caller's own token (its Whisper, the client's ledger names and its usage row); the summary is one call to the model
// FinCom Assistant routes a short book answer to, within the firm's AI switch and monthly cap.
import { corsFor, allowedOrigins } from "../_shared/cors.ts";
import * as R from "../../app/src/calls/rules.js";
import { costUsd, plan } from "../assistant/models.ts";

export type Env = (k: string) => string | undefined;
export type Deps = { env: Env, fetch: typeof fetch, now?: () => number };

export const CF_API = "https://rtc.live.cloudflare.com/v1";
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const RESEND_URL = "https://api.resend.com/emails";
const TRANSCRIBE_BATCH = 4;

export const SUMMARY_SYSTEM = "You summarise a call held by an Indian chartered accountant's firm (with a client, staff or a class). " +
  "Answer with JSON only, no other words: {\"summary\": \"five to eight plain sentences\", \"decisions\": [\"...\"], \"actions\": [{\"title\": \"...\", \"who\": \"name or empty\", \"due\": \"YYYY-MM-DD or empty\"}]}. " +
  "Use only what was said in the transcript; never invent amounts, dates or names; keep numbers exactly as said. An action is a task someone agreed to do.";

class Fail extends Error { constructor(public code: number, message: string, public kind = "other") { super(message); } }
const fail = (code: number, msg: string, kind = "other"): never => { throw new Fail(code, msg, kind); };

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch, now = deps.now || (() => Date.now());
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || ""), ANON = String(env("SUPABASE_ANON_KEY") || "");
  const q = (v: string) => encodeURIComponent(v);
  const rest = async (path: string, token: string, init: RequestInit = {}) => {
    const r = await doFetch(URL_ + path, { ...init, headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const t = await r.text();
    let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status, code: j && j.code });
    return j;
  };
  const svc = (path: string, init: RequestInit = {}) => rest(path, SERVICE, init);
  const one = async (path: string) => ((await svc(path)) as any[] || [])[0] || null;
  const insert = async (table: string, row: unknown) => ((await svc("/rest/v1/" + table, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) })) as any[])[0];
  const patch = async (table: string, filter: string, row: unknown) => (await svc("/rest/v1/" + table + "?" + filter, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) })) as any[];
  const rpc = (fn: string, args: Record<string, unknown>, token = SERVICE) => rest("/rest/v1/rpc/" + fn, token, { method: "POST", body: JSON.stringify(args) });
  const secretCache: Record<string, string> = {};
  const secret = async (name: string) => {
    if (name in secretCache) return secretCache[name];
    try { const k = await one("/rest/v1/platform_secrets?select=value&name=eq." + name); return (secretCache[name] = String((k && k.value) || "")); } catch { return ""; }
  };
  // the guests' signing secret: made once, kept in platform_secrets (never leaves the server)
  const guestSecret = async () => {
    let s = await secret("call_guest_secret");
    if (s.length >= 32) return s;
    await svc("/rest/v1/platform_secrets?on_conflict=name", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify({ name: "call_guest_secret", value: R.randomToken(48) }) }).catch(() => null);
    delete secretCache.call_guest_secret;
    s = await secret("call_guest_secret");
    if (s.length < 32) fail(503, "Guest links are not ready on the server; try again in a moment.");
    return s;
  };
  const cfKeys = async () => { const app = await secret("cf_realtime_app_id"), tok = await secret("cf_realtime_token"); return app && tok ? { app, tok } : null; };
  const mailKey = () => secret("resend_api_key");
  const sendMail = async (to: string[], subject: string, text: string, attachments?: { filename: string, content: string }[]) => {
    const key = await mailKey();
    if (!key || !to.length) return false;
    const from = (await secret("resend_from")) || "FinCom <calls@fincom.live>";
    try {
      const r = await doFetch(RESEND_URL, { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject, text, ...(attachments ? { attachments } : {}) }) });
      await r.body?.cancel();
      return r.ok;
    } catch { return false; }
  };
  const iceServers = async (): Promise<any[]> => {
    const ice: any[] = R.STUN.map((x: any) => ({ ...x }));
    const id = await secret("cf_turn_key_id"), tok = await secret("cf_turn_key_token");
    if (id && tok) {
      try {
        const r = await doFetch(CF_API + "/turn/keys/" + q(id) + "/credentials/generate-ice-servers", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: 21600 }) });
        const j: any = await r.json().catch(() => null);
        const got = j && j.iceServers;
        if (r.ok && got) for (const s of (Array.isArray(got) ? got : [got])) if (s && s.urls && s.username) ice.push(s);
      } catch { /* STUN alone */ }
    }
    return ice;
  };

  // ---------------------------------------------------------------- who is calling
  type Member = { kind: "member", jwt: string, user: string, email: string, firm: string, role: string, name: string };
  type Guest = { kind: "guest", room: string, participant: any };
  const asMember = async (jwt: string): Promise<Member> => {
    if (!jwt || jwt === ANON || jwt === SERVICE) fail(401, "Sign in to the firm account first.", "auth");
    let user: any;
    try { user = await rest("/auth/v1/user", jwt); } catch { fail(401, "Sign in again.", "auth"); }
    if (!user?.id) fail(401, "Sign in again.", "auth");
    let mfa = false;
    try { mfa = (await rpc("mfa_ok", {}, jwt)) === true; } catch { mfa = false; }
    if (!mfa) fail(403, "Finish the two-step sign-in first.", "mfa");
    const mem = (await svc("/rest/v1/members?select=firm_id,role,active,name,email&user_id=eq." + q(user.id)).catch(() => [])) as any[];
    const m = (mem || []).find((x) => x.active);
    if (!m) fail(403, "This account is not part of a firm.", "firm");
    return { kind: "member", jwt, user: user.id, email: String(user.email || m.email || "").toLowerCase(), firm: String(m.firm_id), role: String(m.role), name: String(m.name || user.email || "Member") };
  };
  const asGuest = async (gt: string): Promise<Guest> => {
    const v = await R.verifyGuest(await guestSecret(), gt, Math.floor(now() / 1000));
    if (!v) fail(401, "This guest pass has run out. Open the link again.", "guest");
    const p = await one("/rest/v1/call_participants?select=*&id=eq." + q(v!.participant) + "&room_id=eq." + q(v!.room));
    if (!p || p.role !== "guest") fail(401, "This guest pass is not known.", "guest");
    return { kind: "guest", room: v!.room, participant: p };
  };
  const room = async (id: string, firm?: string) => {
    if (!R.isUuid(id)) fail(400, "Say which call.");
    const r = await one("/rest/v1/call_rooms?select=*&id=eq." + q(id));
    if (!r || (firm && r.firm_id !== firm)) fail(404, "This call is not one of your firm's.", "room");
    return r;
  };
  const meIn = async (r: any, who: Member | Guest) => who.kind === "guest" ? who.participant
    : await one("/rest/v1/call_participants?select=*&room_id=eq." + q(r.id) + "&user_id=eq." + q(who.user));
  const admittedIn = async (r: any, who: Member | Guest) => {
    const p = await meIn(r, who);
    if (!p || p.state !== "admitted") fail(403, p && p.state === "removed" ? "The host removed you from this call." : "You are not in this call.", "notin");
    if (r.status === "ended") fail(410, "This call has ended.", "ended");
    return p;
  };
  const isHost = (r: any, who: Member | Guest) => who.kind === "member" && (r.host_user === who.user || (who.role === "owner" && r.firm_id === who.firm));
  const clientReadable = async (jwt: string, client: string | null) => {
    if (!client) return true;
    const c = (await rest("/rest/v1/clients?select=id,deleted&id=eq." + q(client), jwt).catch(() => [])) as any[];
    return !!(c && c.length && !c[0].deleted);
  };
  const clientSetting = async (firm: string, client: string | null) => client ? (await one("/rest/v1/call_client_settings?select=*&firm_id=eq." + firm + "&client_id=eq." + q(client))) || { client } : null;
  const inCall = async (roomId: string) => ((await svc("/rest/v1/call_participants?select=id&state=eq.admitted&room_id=eq." + q(roomId))) as any[] || []).length;
  const folder = (r: any) => r.kind === "class" ? r.firm_id + "/class/" + r.batch_id + "/" + r.id + "/" : r.firm_id + "/" + r.kind + "/" + r.id + "/";
  const activeRec = async (roomId: string) => await one("/rest/v1/call_recordings?select=id,started_at&room_id=eq." + q(roomId) + "&ended_at=is.null&deleted_at=is.null&order=started_at.desc&limit=1");
  const session = async (r: any, p: any, extra: Record<string, unknown> = {}) => {
    const mode = r.media_mode;
    const rec = await activeRec(r.id);
    return {
      ok: true, room: { id: r.id, kind: r.kind, title: r.title, client_id: r.client_id, batch_id: r.batch_id, status: r.status, host_user: r.host_user, cowork_on: r.cowork_on, started_at: r.started_at },
      me: { id: p.id, role: p.role, name: p.name, state: p.state }, topic: await R.topicFor(r.chan_key, r.chan_epoch), ice: await iceServers(), mode, max: R.maxPeople(mode),
      recording: rec ? { id: rec.id, started_at: rec.started_at, notice: R.CONSENT_TEXT } : null, ...extra,
    };
  };
  const newLink = async (r: any, by: string | null, email = "", days = R.GUEST_LINK_DAYS, max = 10) => {
    const token = R.randomToken(32);
    await insert("call_invites", { room_id: r.id, firm_id: r.firm_id, token_hash: await R.sha256Hex(token), email, max_uses: max, expires_at: new Date(now() + days * 86400000).toISOString(), created_by: by });
    return token;
  };
  const linkUrl = (base: unknown, token: string) => {
    const b = String(base || "");
    let origin = "";
    try { origin = new URL(b).origin; } catch { /* below */ }
    const okBase = origin && allowedOrigins().includes(origin) ? b.split("#")[0] : "https://staging.fincom.live/";
    return okBase + "#join=" + token;
  };
  const firmName = async (firm: string) => String(((await one("/rest/v1/firms?select=name&id=eq." + firm)) || {}).name || "the firm");

  // ---------------------------------------------------------------- the actions
  const member: Record<string, (m: Member, b: any) => Promise<unknown>> = {
    // a room for the work at hand: a client's open call is joined, not made twice
    async start(m, b) {
      const kind = String(b.kind || "");
      if (!R.canHost(kind, m.role)) fail(403, m.role === "readonly" ? "A look-only member can join a call but not start one." : "This kind of call cannot be started here.", "role");
      if (kind === "meeting") fail(400, "A meeting is scheduled (Schedule meeting).");
      const client = kind === "client" ? String(b.client_id || "").slice(0, 120) : null;
      if (kind === "client" && !(await clientReadable(m.jwt, client))) fail(403, "This client is not one of your firm's.", "client");
      let batch: any = null;
      if (kind === "class") {
        batch = R.isUuid(b.batch_id) ? await one("/rest/v1/call_batches?select=*&id=eq." + q(b.batch_id) + "&firm_id=eq." + m.firm) : null;
        if (!batch) fail(404, "This batch is not one of your firm's.");
      }
      let r = kind === "client" ? await one("/rest/v1/call_rooms?select=*&status=eq.open&kind=eq.client&firm_id=eq." + m.firm + "&client_id=eq." + q(client!) + "&created_at=gte." + q(new Date(now() - 12 * 3600000).toISOString()) + "&order=created_at.desc&limit=1")
        : kind === "class" ? await one("/rest/v1/call_rooms?select=*&status=eq.open&kind=eq.class&batch_id=eq." + q(batch.id) + "&order=created_at.desc&limit=1") : null;
      if (!r) {
        const cname = client ? String(((await one("/rest/v1/clients?select=name&id=eq." + q(client))) || {}).name || "") : "";
        const title = String(b.title || (kind === "client" ? "Call with " + cname : kind === "class" ? batch.name + " · class" : "Help call")).slice(0, 200);
        r = await insert("call_rooms", { firm_id: m.firm, kind, client_id: client, batch_id: batch ? batch.id : null, title, status: "open", media_mode: R.mediaMode(!!(await cfKeys())),
          host_user: m.user, created_by: m.user, started_at: new Date(now()).toISOString() });
      }
      const p = await joinAs(r, m, r.host_user === m.user ? "host" : "member");
      return session(r, p);
    },
    async join(m, b) {
      const r = await room(b.room_id, m.firm);
      if (r.status === "ended") fail(410, "This call has ended.", "ended");
      if (r.kind === "client" && !(await clientReadable(m.jwt, r.client_id))) fail(403, "This client is not one of your firm's.", "client");
      if (r.status === "scheduled") { await patch("call_rooms", "id=eq." + r.id, { status: "open", started_at: new Date(now()).toISOString(), host_user: r.host_user || m.user }); r.status = "open"; }
      const p = await joinAs(r, m, r.host_user === m.user ? "host" : "member");
      return session(r, p);
    },
    async schedule(m, b) {
      if (!R.canHost("meeting", m.role)) fail(403, "Only the owner or staff can schedule a meeting.", "role");
      const at = Date.parse(String(b.at || ""));
      if (!Number.isFinite(at) || at < now() - 3600000 || at > now() + 366 * 86400000) fail(400, "Give the meeting's date and time.");
      const minutes = Math.max(5, Math.min(600, Number(b.minutes) || 30));
      const emails = [...new Set(((Array.isArray(b.emails) ? b.emails : []) as unknown[]).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
      if (emails.length > 50 || emails.some((e) => !R.emailOk(e))) fail(400, "One of the email addresses is not one.");
      const client = b.client_id ? String(b.client_id).slice(0, 120) : null;
      if (client && !(await clientReadable(m.jwt, client))) fail(403, "This client is not one of your firm's.", "client");
      const title = String(b.title || "Meeting").trim().slice(0, 200) || "Meeting";
      const r = await insert("call_rooms", { firm_id: m.firm, kind: "meeting", client_id: client, title, status: "scheduled", scheduled_at: new Date(at).toISOString(), minutes,
        invitees: emails, media_mode: R.mediaMode(!!(await cfKeys())), host_user: m.user, created_by: m.user });
      const token = await newLink(r, m.user, "", Math.max(R.GUEST_LINK_DAYS, Math.ceil((at - now()) / 86400000) + 2), 50);
      const url = linkUrl(b.base, token);
      const ics = R.icsFor({ uid: r.id, title, start: at, minutes, url, organizer: { email: m.email, name: m.name }, description: "A FinCom call. Open the link at the time; you will be asked your name." });
      const when = new Date(at + 330 * 60000).toISOString().replace("T", " ").slice(0, 16) + " IST";
      const text = m.name + " invites you to \"" + title + "\" on " + when + " (" + minutes + " minutes).\n\nJoin: " + url + "\n\nYou will be asked your name and a code sent to your email. The calendar invite is attached.";
      const sent = emails.length ? await sendMail(emails, "Invitation: " + title + " · " + when, text, [{ filename: "invite.ics", content: btoa(ics) }]) : false;
      return { ok: true, room_id: r.id, token, url, ics, text, emailed: sent ? emails.length : 0, mail: !!(await mailKey()) };
    },
    async invite(m, b) {
      const r = await room(b.room_id, m.firm);
      if (!R.canHost(r.kind, m.role)) fail(403, "Only the owner or staff can invite a guest.", "role");
      if (r.status === "ended") fail(410, "This call has ended.", "ended");
      const email = String(b.email || "").trim().toLowerCase();
      if (email && !R.emailOk(email)) fail(400, "That email address is not one.");
      const token = await newLink(r, m.user, email);
      const url = linkUrl(b.base, token);
      const text = m.name + " (" + await firmName(m.firm) + ") invites you to a FinCom call: " + r.title + "\nJoin: " + url;
      const sent = email ? await sendMail([email], "Join the call: " + r.title, text) : false;
      return { ok: true, token, url, text, emailed: sent, mail: !!(await mailKey()) };
    },
    async roster(m, b) {
      const r = await room(b.room_id, m.firm);
      await admittedIn(r, m);
      const ps = (await svc("/rest/v1/call_participants?select=id,user_id,name,email,role,state,verified,joined_at&room_id=eq." + q(r.id) + "&state=in.(waiting,admitted)&order=joined_at")) as any[];
      const host = isHost(r, m);
      return { ok: true, people: ps.filter((p) => host || p.state === "admitted").map((p) => ({ ...p, email: host ? p.email : "" })), host, recording: await activeRec(r.id), cowork_on: r.cowork_on, status: r.status, mode: r.media_mode, max: R.maxPeople(r.media_mode) };
    },
    async admit(m, b) { return hostSet(m, b, "admitted"); },
    async deny(m, b) { return hostSet(m, b, "denied"); },
    async remove(m, b) { return hostSet(m, b, "removed"); },
    async end(m, b) {
      const r = await room(b.room_id, m.firm);
      if (!isHost(r, m)) fail(403, "Only the host can end the call for everyone.", "host");
      await endRoom(r);
      return { ok: true };
    },
    async cowork(m, b) {
      const r = await room(b.room_id, m.firm);
      if (!isHost(r, m)) fail(403, "Only the host can start or stop working together.", "host");
      await admittedIn(r, m);
      const on = b.on === true;
      const [x] = await patch("call_rooms", "id=eq." + r.id, { cowork_on: on, cowork_at: on ? new Date(now()).toISOString() : r.cowork_at, cowork_epoch: Number(r.cowork_epoch || 1) + 1 });
      return { ok: true, on, topic: on ? await R.topicFor(x.chan_key, x.cowork_epoch, "cowork") : null };
    },
    // a signed-in member of the firm who can read the client follows; never a guest (they have no member token)
    async cowork_join(m, b) {
      const r = await room(b.room_id, m.firm);
      const p = await admittedIn(r, m);
      if (!r.cowork_on) fail(409, "The host has not started working together.", "cowork");
      if (!R.mayCowork({ member: true, guest: p.role === "guest" }, await clientReadable(m.jwt, r.client_id))) fail(403, "You cannot open this client, so you cannot work together on it.", "client");
      return { ok: true, topic: await R.topicFor(r.chan_key, r.cowork_epoch, "cowork"), host_user: r.host_user, client_id: r.client_id };
    },
    async rec_start(m, b) {
      const r = await room(b.room_id, m.firm);
      if (!isHost(r, m)) fail(403, "Only the host can record.", "host");
      await admittedIn(r, m);
      const cs = await clientSetting(m.firm, r.client_id);
      if (!R.recordingAllowed(r.kind, cs)) fail(403, "Recording is off for this client. The firm's owner can turn it on in the client's call settings.", "recoff");
      const live = await activeRec(r.id);
      if (live) return { ok: true, recording_id: live.id, notice: R.CONSENT_TEXT };
      const batch = r.kind === "class" ? await one("/rest/v1/call_batches?select=retention_days&id=eq." + q(r.batch_id)) : null;
      const rec = await insert("call_recordings", { room_id: r.id, firm_id: r.firm_id, batch_id: r.batch_id, started_by: m.user, prefix: folder(r) + "rec/",
        mime: String(b.mime || "video/webm").slice(0, 80), retain_until: R.retainUntil(r.kind, batch || cs, now()) });
      return { ok: true, recording_id: rec.id, notice: R.CONSENT_TEXT };
    },
    async rec_part(m, b) {
      const rec = await one("/rest/v1/call_recordings?select=*&id=eq." + q(String(b.recording_id || "")) + "&firm_id=eq." + m.firm);
      if (!rec || rec.started_by !== m.user) fail(404, "Not your recording.");
      await patch("call_recordings", "id=eq." + rec.id, { chunks: Math.max(rec.chunks, Number(b.seq) + 1 || 0), bytes: Number(rec.bytes) + Math.max(0, Number(b.bytes) || 0) });
      return { ok: true };
    },
    async rec_stop(m, b) {
      const rec = await one("/rest/v1/call_recordings?select=*&id=eq." + q(String(b.recording_id || "")) + "&firm_id=eq." + m.firm);
      if (!rec) fail(404, "Not your firm's recording.");
      const r = await room(rec.room_id, m.firm);
      if (!isHost(r, m)) fail(403, "Only the host can stop the recording.", "host");
      if (!rec.ended_at) await patch("call_recordings", "id=eq." + rec.id, { ended_at: new Date(now()).toISOString() });
      return { ok: true };
    },
    async transcribe(m, b) {
      const r = await room(b.room_id, m.firm);
      if (!(m.role === "owner" || m.role === "staff")) fail(403, "Only the owner or staff can make the transcript.", "role");
      const todo = (await svc("/rest/v1/call_pieces?select=*&room_id=eq." + q(r.id) + "&status=eq.new&tries=lt.3&order=start_ms&limit=" + TRANSCRIBE_BATCH)) as any[];
      let wait = 0;
      for (const p of todo) {
        const file = await doFetch(URL_ + "/storage/v1/object/call-recordings/" + p.path.split("/").map(q).join("/"), { headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE } });
        if (!file.ok) { await file.body?.cancel(); await patch("call_pieces", "id=eq." + p.id, { status: "failed", tries: p.tries + 1 }); continue; }
        const audio = new Uint8Array(await file.arrayBuffer());
        const u = URL_ + "/functions/v1/fincom-transcribe?lang=auto&latin=1&secs=" + Math.ceil(p.dur_ms / 1000) + (r.client_id ? "&client=" + q(r.client_id) : "");
        let res: Response | null = null;
        try { res = await doFetch(u, { method: "POST", headers: { Authorization: "Bearer " + m.jwt, apikey: ANON, "Content-Type": p.mime || "audio/webm" }, body: audio }); } catch { res = null; }
        const j: any = res ? await res.json().catch(() => null) : null;
        if (res && res.status === 429) { wait = 60; break; }
        if (res && res.ok && j && j.ok && typeof j.text === "string") await patch("call_pieces", "id=eq." + p.id, { status: "done", text: j.text.slice(0, 20000), tries: p.tries + 1 });
        else if (j && (j.kind === "nokey" || j.kind === "off" || j.kind === "mfa")) fail(503, String(j.error || "Clearer listening is not set up."), j.kind);
        else await patch("call_pieces", "id=eq." + p.id, { status: p.tries + 1 >= 3 ? "failed" : "new", tries: p.tries + 1 });
      }
      const t = await buildTranscript(r);
      return { ok: true, ...t, wait };
    },
    async summarise(m, b) {
      const r = await room(b.room_id, m.firm);
      if (!(m.role === "owner" || m.role === "staff")) fail(403, "Only the owner or staff can ask for the summary.", "role");
      const t = await one("/rest/v1/call_transcripts?select=*&room_id=eq." + q(r.id));
      const lines = (t && t.lines) || [];
      if (!lines.length) fail(409, "There is no transcript yet.", "notranscript");
      const set = await one("/rest/v1/assistant_settings?select=enabled&firm_id=eq." + m.firm).catch(() => null);
      if (set && set.enabled === false) fail(403, "AI help is switched off for your firm.", "off");
      const key = await secret("claude_api_key");
      if (!key) fail(503, "AI help is not set up on this server.", "nokey");
      const cap = await rpc("asst_cap_take", { p_firm: m.firm, p_n: 1 }).catch(() => null);
      if (!cap?.ok) fail(429, "The firm's AI limit for this month is reached.", "cap");
      const pl = plan("book", "low", true);
      const text = R.transcriptText(lines).slice(-60000);
      const t0 = now();
      let msg: any = null, okCall = false;
      try {
        const res = await doFetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model: pl.model, max_tokens: 2000, system: SUMMARY_SYSTEM, messages: [{ role: "user", content: "Call: " + r.title + "\n\nTranscript:\n" + text }] }) });
        msg = await res.json().catch(() => null); okCall = res.ok && !!msg;
      } catch { okCall = false; }
      const u = (msg && msg.usage) || {};
      const added = await rpc("asst_cost_add", { p_firm: m.firm, p_feature: "call_summary", p_cost_usd: costUsd(pl.model, u), p_in: u.input_tokens || 0, p_out: u.output_tokens || 0,
        p_cache_read: u.cache_read_input_tokens || 0, p_cache_write: u.cache_creation_input_tokens || 0 }).catch(() => null);
      await rpc("asst_log_add", { p_firm: m.firm, p_user: m.user, p_client: r.client_id, p_question: "", p_tools: [okCall ? "ok" : "error"], p_in: u.input_tokens || 0, p_out: u.output_tokens || 0,
        p_calls: 1, p_ms: now() - t0, p_feature: "call_summary", p_route: r.kind, p_models: [pl.model], p_cache_read: 0, p_cache_write: 0, p_cost_inr: Number(added?.inr || 0), p_fell_through: false }).catch(() => null);
      if (!okCall) fail(502, "The summary could not be made just now; try again.", "ai");
      const out = String((msg.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("")).trim().replace(/^```(json)?\s*|\s*```$/g, "");
      let j: any = null; try { j = JSON.parse(out); } catch { j = null; }
      if (!R.summaryOk(j)) fail(502, "The summary did not come back in the expected shape; try again.", "ai");
      const summary = { summary: j.summary, decisions: j.decisions, actions: j.actions.map((a: any) => ({ title: a.title, who: a.who || "", due: a.due || "" })), model: pl.model, at: new Date(now()).toISOString() };
      await patch("call_transcripts", "room_id=eq." + r.id, { summary, updated_at: new Date(now()).toISOString() });
      return { ok: true, summary };
    },
    // action items to the client's due list, as the person (their own rights: a look-only member is refused there)
    async tasks(m, b) {
      const r = await room(b.room_id, m.firm);
      if (!r.client_id) fail(400, "This call is not tied to a client; copy the action items instead.", "noclient");
      const items = ((Array.isArray(b.items) ? b.items : []) as any[]).slice(0, 30).map((a) => ({ title: String(a.title || "").trim().slice(0, 300), due: /^\d{4}-\d{2}-\d{2}$/.test(String(a.due || "")) ? a.due : null })).filter((a) => a.title);
      if (!items.length) fail(400, "Pick the action items to add.");
      try {
        await rest("/rest/v1/client_due_tasks", m.jwt, { method: "POST", headers: { Prefer: "return=minimal" },
          body: JSON.stringify(items.map((a) => ({ firm_id: m.firm, client_id: r.client_id, title: a.title, due: a.due || new Date(now() + 7 * 86400000).toISOString().slice(0, 10), source: "call", ref: r.id, created_by: m.user }))) });
      } catch (e) { if (/row-level|42501|permission/i.test(String((e as Error).message))) fail(403, "Your role cannot add tasks (look only).", "role"); throw e; }
      const t = await one("/rest/v1/call_transcripts?select=tasks_added&room_id=eq." + q(r.id));
      if (t) await patch("call_transcripts", "room_id=eq." + r.id, { tasks_added: [...(t.tasks_added || []), ...items.map((a) => ({ ...a, by: m.user, at: new Date(now()).toISOString() }))] });
      return { ok: true, added: items.length };
    },
    async remote(m, b) {
      if (!R.mayRemote(m.role)) fail(403, "Only the owner or staff can start remote help.", "role");
      const r = await room(b.room_id, m.firm);
      if (b.op === "start") {
        await admittedIn(r, m);
        const reason = String(b.reason || "").trim();
        if (reason.length < 3 || reason.length > R.REMOTE_REASON_MAX) fail(400, "Say in a few words why you need to control their computer.");
        const row = await insert("call_remote_sessions", { room_id: r.id, firm_id: m.firm, client_id: r.client_id, host_user: m.user, peer_name: String(b.peer_name || "").slice(0, 120), reason });
        const rs = await one("/rest/v1/app_settings?select=value&name=eq.rustdesk").catch(() => null);
        return { ok: true, id: row.id, server: (rs && rs.value) || {} };
      }
      if (b.op === "end") {
        const [row] = await patch("call_remote_sessions", "id=eq." + q(String(b.id || "")) + "&firm_id=eq." + m.firm + "&ended_at=is.null", { ended_at: new Date(now()).toISOString() });
        return { ok: true, ended: !!row };
      }
      fail(400, "Unknown remote-help step.");
    },
    async settings(m, b) {
      const client = String(b.client_id || "").slice(0, 120);
      if (b.set) {
        try { await rpc("call_client_setting_set", { p_client: client, p_allow: b.allow === true, p_days: Number(b.days) || 90 }, m.jwt); }
        catch (e) { fail(403, String((e as Error).message || "Not allowed"), "role"); }
      }
      return { ok: true, setting: (await clientSetting(m.firm, client)) || { allow_recording: false, retention_days: 90 }, owner: m.role === "owner" };
    },
    async batch_list(m) {
      const bs = (await svc("/rest/v1/call_batches?select=id,name,retention_days,archived&firm_id=eq." + m.firm + "&archived=is.false&order=created_at")) as any[];
      const ms = (await svc("/rest/v1/call_batch_members?select=batch_id,email,name&firm_id=eq." + m.firm)) as any[];
      return { ok: true, batches: bs.map((x) => ({ ...x, members: ms.filter((y) => y.batch_id === x.id) })) };
    },
    async batch_save(m, b) {
      if (!(m.role === "owner" || m.role === "staff")) fail(403, "Only the owner or staff can change a batch.", "role");
      const name = String(b.name || "").trim();
      if (name.length < 2 || name.length > 120) fail(400, "Give the batch a name.");
      const emails = [...new Set(((Array.isArray(b.emails) ? b.emails : []) as unknown[]).map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
      if (emails.length > 500 || emails.some((e) => !R.emailOk(e))) fail(400, "One of the email addresses is not one.");
      let batch: any;
      if (b.id) { batch = await one("/rest/v1/call_batches?select=*&id=eq." + q(String(b.id)) + "&firm_id=eq." + m.firm); if (!batch) fail(404, "No such batch."); await patch("call_batches", "id=eq." + batch.id, { name }); }
      else batch = await insert("call_batches", { firm_id: m.firm, name, created_by: m.user });
      if (emails.length) await svc("/rest/v1/call_batch_members?on_conflict=batch_id,email", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(emails.map((e) => ({ batch_id: batch.id, firm_id: m.firm, email: e, added_by: m.user }))) });
      return { ok: true, id: batch.id };
    },
    // what stays attached to a client, batch or meeting: its calls with recording, transcript and chat counts
    async history(m, b) {
      const f = b.client_id ? "&client_id=eq." + q(String(b.client_id)) : b.batch_id ? "&batch_id=eq." + q(String(b.batch_id)) : "";
      if (b.client_id && !(await clientReadable(m.jwt, String(b.client_id)))) fail(403, "This client is not one of your firm's.", "client");
      const rooms = (await rest("/rest/v1/call_rooms?select=id,kind,title,status,client_id,batch_id,scheduled_at,started_at,ended_at&order=created_at.desc&limit=30" + f, m.jwt)) as any[];
      return { ok: true, rooms };
    },
  };
  // a member in a room: one row per person (a second tab rejoins the same row)
  async function joinAs(r: any, m: Member, role: string) {
    let p = await one("/rest/v1/call_participants?select=*&room_id=eq." + q(r.id) + "&user_id=eq." + q(m.user));
    if (p && p.state === "removed") fail(403, "The host removed you from this call.", "removed");
    if (!(p && p.state === "admitted") && R.roomFull(r.media_mode, await inCall(r.id))) fail(409, "The call is full (" + R.maxPeople(r.media_mode) + " people" + (r.media_mode === "p2p" ? " until the call service is set up" : "") + ").", "full");
    const row = { name: m.name, email: m.email, role, state: "admitted", admitted_at: new Date(now()).toISOString(), left_at: null };
    if (p) [p] = await patch("call_participants", "id=eq." + p.id, row);
    else p = await insert("call_participants", { room_id: r.id, firm_id: r.firm_id, user_id: m.user, verified: true, ...row });
    return p;
  }
  async function hostSet(m: Member, b: any, state: string) {
    const r = await room(b.room_id, m.firm);
    if (!isHost(r, m)) fail(403, "Only the host can do that.", "host");
    const p = await one("/rest/v1/call_participants?select=*&id=eq." + q(String(b.participant_id || "")) + "&room_id=eq." + q(r.id));
    if (!p) fail(404, "That person is not in this call.");
    if (p.user_id === r.host_user) fail(400, "The host cannot remove themselves; end the call instead.");
    if (state === "admitted" && R.roomFull(r.media_mode, await inCall(r.id))) fail(409, "The call is full.", "full");
    await patch("call_participants", "id=eq." + p.id, { state, ...(state === "admitted" ? { admitted_at: new Date(now()).toISOString() } : { left_at: new Date(now()).toISOString() }) });
    // someone removed: the channel's name moves on, so they hear nothing more; the others ask for the new name
    if (state === "removed") {
      const [x] = await patch("call_rooms", "id=eq." + r.id, { chan_epoch: Number(r.chan_epoch) + 1, cowork_epoch: Number(r.cowork_epoch || 1) + 1 });
      return { ok: true, rekey: true, topic: await R.topicFor(x.chan_key, x.chan_epoch) };
    }
    return { ok: true };
  }
  async function endRoom(r: any) {
    const at = new Date(now()).toISOString();
    await patch("call_rooms", "id=eq." + r.id, { status: "ended", ended_at: at, chan_epoch: Number(r.chan_epoch) + 1, cowork_on: false, cowork_epoch: Number(r.cowork_epoch || 1) + 1 });
    await patch("call_participants", "room_id=eq." + r.id + "&state=in.(waiting,admitted)", { state: "left", left_at: at });
    await patch("call_recordings", "room_id=eq." + r.id + "&ended_at=is.null", { ended_at: at });
    await patch("call_remote_sessions", "room_id=eq." + r.id + "&ended_at=is.null", { ended_at: at });
  }
  async function buildTranscript(r: any) {
    const ps = (await svc("/rest/v1/call_pieces?select=participant_id,start_ms,status,text&room_id=eq." + q(r.id) + "&order=start_ms")) as any[];
    const people = (await svc("/rest/v1/call_participants?select=id,name&room_id=eq." + q(r.id))) as any[];
    const nameOf = (id: string) => String((people.find((p) => p.id === id) || {}).name || "Someone");
    const lines = R.mergeTranscript(ps.filter((p) => p.status === "done").map((p) => ({ who: nameOf(p.participant_id), start_ms: Number(p.start_ms), text: p.text })));
    const row = { room_id: r.id, firm_id: r.firm_id, batch_id: r.batch_id, lines, pieces_done: ps.filter((p) => p.status !== "new").length, pieces_all: ps.length, updated_at: new Date(now()).toISOString() };
    await svc("/rest/v1/call_transcripts?on_conflict=room_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row) });
    return { lines, done: row.pieces_done, all: row.pieces_all, left: ps.filter((p) => p.status === "new").length };
  }

  // actions open to anyone in the call, member or guest
  const shared: Record<string, (w: Member | Guest, b: any) => Promise<unknown>> = {
    async topic(w, b) {
      const r = await room(w.kind === "guest" ? w.room : b.room_id, w.kind === "member" ? w.firm : undefined);
      await admittedIn(r, w);
      return { ok: true, topic: await R.topicFor(r.chan_key, r.chan_epoch), status: r.status };
    },
    async leave(w, b) {
      const r = await room(w.kind === "guest" ? w.room : b.room_id, w.kind === "member" ? w.firm : undefined);
      const p = await meIn(r, w);
      if (p && (p.state === "admitted" || p.state === "waiting")) await patch("call_participants", "id=eq." + p.id, { state: "left", left_at: new Date(now()).toISOString() });
      // the last one out closes the room
      if (r.status === "open" && (await inCall(r.id)) === 0) await endRoom(r);
      return { ok: true };
    },
    async chat(w, b) {
      const r = await room(w.kind === "guest" ? w.room : b.room_id, w.kind === "member" ? w.firm : undefined);
      const p = await admittedIn(r, w);
      const body = String(b.body || "");
      let file: any = null;
      if (b.file) {
        const f = b.file, path = String(f.path || "");
        if (!path.startsWith(folder(r) + "chat/") || path.includes("..") || !(Number(f.size) > 0 && Number(f.size) <= R.FILE_MAX)) fail(400, "That file is not this call's.");
        file = { path, name: R.safeFileName(f.name), size: Number(f.size), type: String(f.type || "").slice(0, 100) };
      }
      if (!file && !R.chatOk(body)) fail(400, "Write something first (at most " + R.CHAT_MAX + " letters).");
      if (body.length > R.CHAT_MAX) fail(400, "At most " + R.CHAT_MAX + " letters.");
      const msg = await insert("call_messages", { room_id: r.id, firm_id: r.firm_id, participant_id: p.id, author: p.name, body, file });
      return { ok: true, message: msg };
    },
    async history_chat(w, b) {
      const r = await room(w.kind === "guest" ? w.room : b.room_id, w.kind === "member" ? w.firm : undefined);
      await admittedIn(r, w);
      return { ok: true, messages: await svc("/rest/v1/call_messages?select=id,participant_id,author,body,file,at&room_id=eq." + q(r.id) + "&order=id&limit=500") };
    },
    // a signed address to put one file: a chat file (20 MB), the host's recording piece, a person's own microphone piece
    async upload(w, b) {
      const r = await room(w.kind === "guest" ? w.room : b.room_id, w.kind === "member" ? w.firm : undefined);
      const p = await admittedIn(r, w);
      const what = String(b.what || ""), size = Number(b.size) || 0;
      let bucket = "call-recordings", path = "";
      if (what === "chat") {
        if (!(size > 0 && size <= R.FILE_MAX)) fail(413, "A file may be at most 20 MB.", "size");
        bucket = "call-files"; path = folder(r) + "chat/" + R.randomToken(9) + "-" + R.safeFileName(b.name);
      } else if (what === "rec") {
        if (w.kind !== "member" || !isHost(r, w)) fail(403, "Only the host records.", "host");
        const rec = await one("/rest/v1/call_recordings?select=id,prefix,ended_at&id=eq." + q(String(b.recording_id || "")) + "&room_id=eq." + q(r.id));
        if (!rec || rec.ended_at) fail(409, "That recording is not running.");
        if (!(size > 0 && size <= 50 * 1024 * 1024)) fail(413, "A piece is too big.", "size");
        path = rec.prefix + rec.id + "/" + String(Math.max(0, Math.min(99999, Number(b.seq) || 0))).padStart(5, "0") + ".part";
      } else if (what === "mic") {
        if (!(size > 0 && size <= 5 * 1024 * 1024)) fail(413, "A piece is too big.", "size");
        const ext = /mp4|m4a|aac/.test(String(b.type || "")) ? "m4a" : "webm";
        path = folder(r) + "mic/" + p.id + "/" + String(Math.max(0, Math.min(99999, Number(b.seq) || 0))).padStart(5, "0") + "." + ext;
      } else fail(400, "Unknown upload.");
      const j: any = await svc("/storage/v1/object/upload/sign/" + bucket + "/" + path.split("/").map(q).join("/"), { method: "POST", body: "{}" });
      const url = String((j && (j.url || j.signedURL)) || "");
      if (!url) fail(502, "Storage did not give an address.");
      return { ok: true, bucket, path, url: URL_ + "/storage/v1" + (url.startsWith("/") ? url : "/" + url) };
    },
    async download(w, b) {
      const r = await room(w.kind === "guest" ? w.room : b.room_id, w.kind === "member" ? w.firm : undefined);
      await admittedIn(r, w);
      const path = String(b.path || "");
      if (!path.startsWith(folder(r) + "chat/") || path.includes("..")) fail(403, "That file is not this call's.");
      const j: any = await svc("/storage/v1/object/sign/call-files/" + path.split("/").map(q).join("/"), { method: "POST", body: JSON.stringify({ expiresIn: 600 }) });
      const url = String((j && (j.signedURL || j.signedUrl)) || "");
      return { ok: true, url: URL_ + "/storage/v1" + (url.startsWith("/") ? url : "/" + url) };
    },
    async consent(w, b) {
      const r = await room(w.kind === "guest" ? w.room : b.room_id, w.kind === "member" ? w.firm : undefined);
      const p = await meIn(r, w);
      if (!p) fail(403, "You are not in this call.");
      const ev = String(b.event || "");
      if (!["shown", "accepted", "left"].includes(ev)) fail(400, "Unknown consent step.");
      const rec = R.isUuid(b.recording_id) ? await one("/rest/v1/call_recordings?select=id&id=eq." + q(b.recording_id) + "&room_id=eq." + q(r.id)) : null;
      await insert("call_consents", { room_id: r.id, firm_id: r.firm_id, participant_id: p.id, recording_id: rec ? rec.id : null, event: ev });
      if (ev === "left" && p.state === "admitted") await patch("call_participants", "id=eq." + p.id, { state: "left", left_at: new Date(now()).toISOString() });
      return { ok: true };
    },
    async piece(w, b) {
      const r = await room(w.kind === "guest" ? w.room : b.room_id, w.kind === "member" ? w.firm : undefined);
      const p = await meIn(r, w);
      if (!p || !(p.state === "admitted" || p.state === "left")) fail(403, "You are not in this call.");
      const path = String(b.path || "");
      if (!path.startsWith(folder(r) + "mic/" + p.id + "/") || path.includes("..")) fail(403, "That piece is not yours.");
      const seq = Math.floor(Number(b.seq)), start = Math.floor(Number(b.start_ms)), dur = Math.floor(Number(b.dur_ms));
      if (!(seq >= 0 && start >= 0 && dur > 0 && dur <= 60000)) fail(400, "A piece of at most 60 s.");
      await svc("/rest/v1/call_pieces?on_conflict=participant_id,seq", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ room_id: r.id, firm_id: r.firm_id, participant_id: p.id, seq, start_ms: start, dur_ms: dur, path, mime: String(b.mime || "audio/webm").slice(0, 60) }) });
      return { ok: true };
    },
    // Cloudflare Realtime, the person's own session only; the app's keys never leave here
    async cf(w, b) {
      const r = await room(w.kind === "guest" ? w.room : b.room_id, w.kind === "member" ? w.firm : undefined);
      const p = await admittedIn(r, w);
      const keys = await cfKeys();
      if (!keys || r.media_mode !== "sfu") fail(409, "This call runs peer to peer.", "p2p");
      const call = async (method: string, path: string, body?: unknown) => {
        const res = await doFetch(CF_API + "/apps/" + q(keys!.app) + path, { method, headers: { Authorization: "Bearer " + keys!.tok, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
        const j: any = await res.json().catch(() => null);
        if (!res.ok || !j || j.errorCode) fail(502, "The call service answered: " + String((j && (j.errorDescription || j.errorCode)) || res.status), "cf");
        return j;
      };
      let sid = String(p.cf_session || "");
      const op = String(b.op || "");
      if (op === "session") {
        const j = await call("POST", "/sessions/new");
        sid = String(j.sessionId || "");
        await patch("call_participants", "id=eq." + p.id, { cf_session: sid });
        return { ok: true, sessionId: sid };
      }
      if (!sid) fail(409, "Open the call session first.", "cf");
      const desc = (d: any) => d && (d.type === "offer" || d.type === "answer") && typeof d.sdp === "string" && d.sdp.length < 200000 ? { type: d.type, sdp: d.sdp } : null;
      if (op === "push") {
        const tracks = ((b.tracks || []) as any[]).slice(0, 4).map((t) => ({ location: "local", mid: String(t.mid), trackName: String(t.trackName).slice(0, 64) }));
        return { ok: true, ...(await call("POST", "/sessions/" + q(sid) + "/tracks/new", { sessionDescription: desc(b.sdp), tracks })) };
      }
      if (op === "pull") {
        // only tracks of people admitted to this same call
        const others = (await svc("/rest/v1/call_participants?select=cf_session&state=eq.admitted&room_id=eq." + q(r.id))) as any[];
        const okSess = new Set(others.map((x) => x.cf_session).filter(Boolean));
        const tracks = ((b.tracks || []) as any[]).slice(0, 48).filter((t) => okSess.has(String(t.sessionId)) && String(t.sessionId) !== sid)
          .map((t) => ({ location: "remote", sessionId: String(t.sessionId), trackName: String(t.trackName).slice(0, 64), ...(t.rid ? { simulcast: { preferredRid: String(t.rid).slice(0, 4) } } : {}) }));
        if (!tracks.length) fail(400, "No track of this call to receive.");
        return { ok: true, ...(await call("POST", "/sessions/" + q(sid) + "/tracks/new", { tracks })) };
      }
      if (op === "renegotiate") return { ok: true, ...(await call("PUT", "/sessions/" + q(sid) + "/renegotiate", { sessionDescription: desc(b.sdp) })) };
      if (op === "close") return { ok: true, ...(await call("PUT", "/sessions/" + q(sid) + "/tracks/close", { tracks: ((b.mids || []) as any[]).slice(0, 48).map((m) => ({ mid: String(m) })), force: true, ...(b.sdp ? { sessionDescription: desc(b.sdp) } : {}) })) };
      if (op === "layer") return { ok: true, ...(await call("PUT", "/sessions/" + q(sid) + "/tracks/update", { tracks: ((b.tracks || []) as any[]).slice(0, 48).map((t) => ({ mid: String(t.mid), simulcast: { preferredRid: String(t.rid || "h").slice(0, 4) } })) })) };
      fail(400, "Unknown call-service step.");
    },
  };

  // guests: the link, their name and email, the code, the waiting room
  const linkOf = async (token: string) => {
    if (!R.linkTokenOk(token)) fail(404, "This link is not a FinCom call link.", "link");
    const inv = await one("/rest/v1/call_invites?select=*&token_hash=eq." + (await R.sha256Hex(token)));
    if (!inv || Date.parse(inv.expires_at) < now()) fail(410, "This link has run out. Ask for a new one.", "link");
    const r = await one("/rest/v1/call_rooms?select=*&id=eq." + q(inv.room_id));
    if (!r || r.status === "ended") fail(410, "This call has ended.", "ended");
    return { inv, r };
  };
  const guest: Record<string, (b: any) => Promise<unknown>> = {
    async guest_hello(b) {
      const { r } = await linkOf(String(b.token || ""));
      return { ok: true, title: r.title, firm: await firmName(r.firm_id), kind: r.kind, scheduled_at: r.scheduled_at, status: r.status, mail: !!(await mailKey()) };
    },
    async guest_start(b) {
      const { inv, r } = await linkOf(String(b.token || ""));
      const name = String(b.name || "").trim(), email = String(b.email || "").trim().toLowerCase();
      if (!R.nameOk(name)) fail(400, "Write your name (2 to 60 letters).");
      if (!R.emailOk(email)) fail(400, "Write your email address; a code is sent to it.");
      if (inv.uses >= inv.max_uses) fail(429, "This link has been used too many times. Ask for a new one.", "link");
      await patch("call_invites", "id=eq." + inv.id, { uses: inv.uses + 1 });
      const code = R.otpCode(), mail = !!(await mailKey());
      const p = await insert("call_participants", { room_id: r.id, firm_id: r.firm_id, name, email, role: "guest", state: "waiting", invite_id: inv.id,
        otp_hash: mail ? await R.sha256Hex(code + ":" + inv.id) : null, otp_until: mail ? new Date(now() + R.OTP_MINUTES * 60000).toISOString() : null });
      const sent = mail ? await sendMail([email], "Your FinCom call code: " + code, "Your code to join \"" + r.title + "\" is " + code + ". It works for " + R.OTP_MINUTES + " minutes.\nIf you did not ask for it, ignore this email.") : false;
      const gt = await R.signGuest(await guestSecret(), r.id, p.id, Math.floor(now() / 1000));
      return { ok: true, gt, code_sent: sent, mail };
    },
    async guest_verify(b) {
      const g = await asGuest(String(b.gt || ""));
      const p = g.participant;
      if (p.verified) return { ok: true, verified: true };
      if (!p.otp_hash) fail(409, "No code was sent; the host will let you in.", "nocode");
      if (p.otp_tries >= R.OTP_TRIES || Date.parse(p.otp_until) < now()) fail(429, "The code has run out. Open the link again for a new one.", "otp");
      const good = (await R.sha256Hex(String(b.code || "").trim() + ":" + p.invite_id)) === p.otp_hash;
      await patch("call_participants", "id=eq." + p.id, { otp_tries: p.otp_tries + 1, ...(good ? { verified: true, otp_hash: null } : {}) });
      if (!good) fail(400, "That code is not right.", "otp");
      // a class's own student (their verified email is on the batch) comes straight in
      const r = await one("/rest/v1/call_rooms?select=*&id=eq." + q(g.room));
      if (r && r.kind === "class") {
        const bm = await one("/rest/v1/call_batch_members?select=email&batch_id=eq." + q(r.batch_id) + "&email=eq." + q(p.email));
        if (R.directEntry("class", { batchMember: !!bm, verified: true }) && !R.roomFull(r.media_mode, await inCall(r.id))) await patch("call_participants", "id=eq." + p.id, { state: "admitted", admitted_at: new Date(now()).toISOString() });
      }
      return { ok: true, verified: true };
    },
    async guest_poll(b) {
      const g = await asGuest(String(b.gt || ""));
      const r = await one("/rest/v1/call_rooms?select=*&id=eq." + q(g.room));
      if (!r || r.status === "ended") return { ok: true, state: "ended" };
      const p = g.participant;
      if (p.state !== "admitted") return { ok: true, state: p.state, verified: p.verified };
      return { ...(await session(r, p)), state: "admitted" };
    },
  };

  return async (req: Request): Promise<Response> => {
    const cors = corsFor(req);
    const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    let body: any;
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    const action = String((body && body.action) || "");
    try {
      if (guest[action]) return reply(200, await guest[action](body));
      if (body.gt) {
        if (!shared[action]) return reply(403, { ok: false, kind: "guest", error: "A guest cannot do that." });
        return reply(200, await shared[action](await asGuest(String(body.gt)), body));
      }
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const m = await asMember(jwt);
      if (member[action]) return reply(200, await member[action](m, body));
      if (shared[action]) return reply(200, await shared[action](m, body));
      return reply(400, { ok: false, error: "Unknown request" });
    } catch (e) {
      if (e instanceof Fail) return reply(e.code, { ok: false, kind: e.kind, error: e.message });
      return reply(500, { ok: false, kind: "other", error: String((e as Error).message || e).slice(0, 300) });
    }
  };
}
