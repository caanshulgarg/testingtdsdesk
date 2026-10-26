// deno test server/video-calls/handler_test.ts (run by tests/run_video_calls_server.py). The fincom-call function with
// everything outside it STUBBED by one fake fetch: PostgREST (an in-memory table store that reads the filters the handler
// sends), Storage's signed addresses, Auth, fincom-transcribe, Anthropic, Resend and Cloudflare Realtime.
import { handler } from "./handler.ts";
import * as R from "../../app/src/calls/rules.js";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

const SUPA = "https://stand.test", FIRM = "11111111-1111-4111-8111-111111111111", FIRM2 = "22222222-2222-4222-8222-222222222222";
const OWNER = "aaaaaaaa-0000-4000-8000-000000000001", STAFF = "aaaaaaaa-0000-4000-8000-000000000002", LOOK = "aaaaaaaa-0000-4000-8000-000000000003",
  STAFF2 = "aaaaaaaa-0000-4000-8000-000000000004", STAFF3 = "aaaaaaaa-0000-4000-8000-000000000005", OTHER = "aaaaaaaa-0000-4000-8000-000000000009";
const USERS: Record<string, { id: string, email: string, firm: string, role: string, name: string }> = {
  "tok-owner": { id: OWNER, email: "owner@a.test", firm: FIRM, role: "owner", name: "Anshul" },
  "tok-staff": { id: STAFF, email: "staff@a.test", firm: FIRM, role: "staff", name: "Riya" },
  "tok-look": { id: LOOK, email: "look@a.test", firm: FIRM, role: "readonly", name: "Look" },
  "tok-staff2": { id: STAFF2, email: "s2@a.test", firm: FIRM, role: "staff", name: "S2" },
  "tok-staff3": { id: STAFF3, email: "s3@a.test", firm: FIRM, role: "staff", name: "S3" },
  "tok-other": { id: OTHER, email: "o@b.test", firm: FIRM2, role: "owner", name: "Other" },
};
let uuidN = 0;
const uuid = () => "eeeeeeee-0000-4000-8000-" + String(++uuidN).padStart(12, "0");
type Row = Record<string, any>;

function stand(o: { cf?: boolean, mail?: boolean, ai?: boolean, aiOff?: boolean, aiAnswer?: string, transcribe?: (n: number) => Response, look429?: boolean,
  groq?: boolean, stt?: (form: FormData, n: number) => Response, chat?: (body: any, n: number) => Response, noLobby?: boolean } = {}) {
  const T: Record<string, Row[]> = {
    members: Object.values(USERS).map((u) => ({ user_id: u.id, firm_id: u.firm, role: u.role, active: true, name: u.name, email: u.email })),
    firms: [{ id: FIRM, name: "Garg & Co" }, { id: FIRM2, name: "B" }],
    clients: [{ id: "c1", firm_id: FIRM, name: "Client One", deleted: false }, { id: "c2", firm_id: FIRM2, name: "Client Two", deleted: false }],
    platform_secrets: [{ name: "claude_api_key", value: o.ai === false ? "" : "sk-test" }, ...(o.groq === false ? [] : [{ name: "groq_api_key", value: "gsk-test" }]), ...(o.mail ? [{ name: "resend_api_key", value: "re-test" }] : []),
      ...(o.cf ? [{ name: "cf_realtime_app_id", value: "app1" }, { name: "cf_realtime_token", value: "cftok" }] : [])],
    assistant_settings: o.aiOff ? [{ firm_id: FIRM, enabled: false }] : [],
    app_settings: [{ name: "rustdesk", value: { id_server: "", relay: "", key: "" } }],
    call_batches: [], call_batch_members: [], call_rooms: [], call_participants: [], call_invites: [], call_messages: [], call_recordings: [], call_pieces: [],
    call_transcripts: [], call_consents: [], call_client_settings: [], call_remote_sessions: [], client_due_tasks: [],
    call_captions: [], assistant_log: [], call_watch: [], tally_books: [{ book_id: "bbbbbbbb-0000-4000-8000-000000000001", firm_id: FIRM, client_id: "c1" }],
    tally_ledgers: [{ book_id: "bbbbbbbb-0000-4000-8000-000000000001", firm_id: FIRM, name: "Sharma Traders", primary_group: "Sundry Creditors", open: 500000 }],
  };
  const tries: Record<string, number> = {};
  const DEF: Record<string, () => Row> = {
    call_rooms: () => ({ id: uuid(), status: "open", chan_key: R.randomToken(32), chan_epoch: 1, cowork_on: false, cowork_epoch: 1, created_at: new Date().toISOString(), invitees: [], client_id: null, batch_id: null }),
    call_participants: () => ({ id: uuid(), joined_at: new Date().toISOString(), verified: false, otp_tries: 0, state: "waiting", cf_session: null }),
    call_invites: () => ({ id: uuid(), uses: 0, max_uses: 10 }), call_messages: () => ({ id: T.call_messages.length + 1, at: new Date().toISOString() }),
    call_recordings: () => ({ id: uuid(), chunks: 0, bytes: 0, ended_at: null, deleted_at: null, started_at: new Date().toISOString() }),
    call_pieces: () => ({ id: T.call_pieces.length + 1, status: "new", tries: 0, text: "" }), call_batches: () => ({ id: uuid(), retention_days: 365, archived: false, created_at: new Date().toISOString() }),
    call_remote_sessions: () => ({ id: uuid(), ended_at: null }), call_transcripts: () => ({ tasks_added: [], summary: null }),
  };
  const log = { broadcast: [] as any[], mails: [] as any[], transcribe: [] as any[], ai: [] as any[], cf: [] as any[], rpc: [] as string[], userWrites: [] as any[], stt: [] as any[], chat: [] as any[] };
  const match = (row: Row, k: string, v: string) => {
    const [op, ...rest] = v.split("."); const val = rest.join(".");
    const x = row[k];
    if (op === "eq") return String(x) === val;
    if (op === "neq") return String(x) !== val;
    if (op === "not" && val === "is.null") return x != null;
    if (op === "is") return val === "null" ? x == null : val === "true" ? x === true : x === false || x == null;
    if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").includes(String(x));
    if (op === "gte") return String(x) >= val;
    if (op === "lt") return /^\d+(\.\d+)?$/.test(val) ? Number(x) < Number(val) : String(x) < val;
    throw new Error("filter " + v);
  };
  const filter = (rows: Row[], sp: URLSearchParams) => {
    let out = rows.filter((r) => [...sp.entries()].every(([k, v]) => ["select", "order", "limit", "on_conflict"].includes(k) || match(r, k, v)));
    const ord = sp.get("order"); if (ord) { const [k, d] = ord.split("."); out = out.slice().sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (d === "desc" ? -1 : 1)); }
    const lim = sp.get("limit"); if (lim) out = out.slice(0, Number(lim));
    return out;
  };
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  const fake = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = String(init.method || "GET"), h = new Headers(init.headers || {});
    const tok = (h.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const body = typeof init.body === "string" ? (init.body ? JSON.parse(init.body) : null) : init.body;
    if (url.origin === SUPA) {
      const p = url.pathname;
      if (p === "/auth/v1/user") return USERS[tok] ? J({ id: USERS[tok].id, email: USERS[tok].email }) : J({ msg: "bad" }, 401);
      if (p.startsWith("/rest/v1/rpc/")) {
        const fn = p.slice(13); log.rpc.push(fn);
        if (fn === "mfa_ok") return J(!!USERS[tok]);
        if (fn === "asst_cap_take") return J({ ok: true });
        if (fn === "asst_cost_add") return J({ inr: 1.5 });
        if (fn === "asst_log_add") return J(null);
        if (fn === "call_code_hit") { if (tok !== "service-key") return J({ message: "permission denied" }, 403); const add = body.p_add === 0 ? 0 : 1; tries[body.p_key] = (tries[body.p_key] || 0) + add; return J(tries[body.p_key] <= body.p_max - (add ? 0 : 1)); }
        if (fn === "call_client_setting_set") {
          const u = USERS[tok]; if (!u || u.role !== "owner") return J({ message: "Only the firm's owner can change a client's recording setting", code: "42501" }, 403);
          T.call_client_settings = T.call_client_settings.filter((x) => x.client_id !== body.p_client);
          T.call_client_settings.push({ firm_id: u.firm, client_id: body.p_client, allow_recording: body.p_allow, retention_days: body.p_days });
          return J({});
        }
        return J({ message: "no rpc " + fn }, 404);
      }
      if (p === "/realtime/v1/api/broadcast") { log.broadcast.push({ auth: tok, apikey: h.get("apikey"), body }); return new Response(null, { status: 202 }); }
      if (p.startsWith("/rest/v1/")) {
        const table = p.slice(9), sp = url.searchParams;
        // before migration 106: no heartbeat columns, no call_watch
        if (o.noLobby && (table === "call_watch" || /seen_at|left_why/.test(String(sp.get("select") || "") + JSON.stringify(body || {}) + url.search)))
          return J({ code: table === "call_watch" ? "42P01" : "42703", message: "column or relation does not exist" }, table === "call_watch" ? 404 : 400);
        if (!T[table]) return J({ message: "no table " + table }, 404);
        const service = tok === "service-key";
        // a member's own token: row-level security by firm (reads), the due list's rule (writes: owner or staff)
        const u = USERS[tok];
        const visible = (rows: Row[]) => service ? rows : rows.filter((r) => !("firm_id" in r) || r.firm_id === (u && u.firm));
        if (method === "GET") return J(filter(visible(T[table]), sp));
        if (method === "POST") {
          const rows = (Array.isArray(body) ? body : [body]) as Row[];
          if (!service) {
            log.userWrites.push({ table, tok, rows });
            if (!u || !(u.role === "owner" || u.role === "staff") || rows.some((r) => r.firm_id !== u.firm)) return J({ message: "new row violates row-level security policy", code: "42501" }, 403);
          }
          const oc = sp.get("on_conflict"), pref = h.get("Prefer") || "", made: Row[] = [];
          for (const r0 of rows) {
            const r = { ...(DEF[table] ? DEF[table]() : {}), ...r0 };
            if (table === "call_rooms" && r.code && T.call_rooms.some((x) => x.code === r.code)) return J({ message: "duplicate key value violates unique constraint", code: "23505" }, 409);
            const clash = oc ? T[table].find((x) => oc.split(",").every((k) => String(x[k]) === String(r[k]))) : null;
            if (clash) { if (/merge-duplicates/.test(pref)) Object.assign(clash, r0); made.push(clash); continue; }
            T[table].push(r); made.push(r);
          }
          return /return=minimal/.test(pref) ? new Response(null, { status: 201 }) : J(made, 201);
        }
        if (method === "PATCH") { const rows = filter(T[table], sp); rows.forEach((r) => Object.assign(r, body)); return J(rows); }
      }
      if (p.startsWith("/storage/v1/object/upload/sign/")) return J({ url: "/object/upload/sign/" + p.slice(31) + "?token=t" });
      if (p.startsWith("/storage/v1/object/sign/")) return J({ signedURL: "/object/sign/" + p.slice(24) + "?token=d" });
      if (p.startsWith("/storage/v1/object/call-recordings/")) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (p === "/functions/v1/fincom-transcribe") {
        log.transcribe.push({ url: String(input), auth: tok, type: h.get("Content-Type") });
        return o.transcribe ? o.transcribe(log.transcribe.length) : J({ ok: true, text: "words " + log.transcribe.length });
      }
    }
    if (String(input).startsWith("https://api.resend.com/")) { log.mails.push(body); return J({ id: "m1" }); }
    if (String(input) === "https://api.groq.com/openai/v1/audio/transcriptions") {
      const form = init.body as FormData; log.stt.push({ auth: tok, model: form.get("model"), format: form.get("response_format"), prompt: form.get("prompt"), language: form.get("language") });
      return o.stt ? o.stt(form, log.stt.length) : J({ text: "Sharma Traders க்கு ₹1,25,000 GSTR-3B க்கு அனுப்புங்கள்", language: "tamil" });
    }
    if (String(input) === "https://api.groq.com/openai/v1/chat/completions") {
      log.chat.push({ auth: tok, body });
      if (o.chat) return o.chat(body, log.chat.length);
      const sys = String(body.messages[0].content);
      const out = sys.includes("into Hindi") ? "Sharma Traders को ₹1,25,000 GSTR-3B के लिए भेजें" : "Send ₹1,25,000 to Sharma Traders for GSTR-3B";
      return J({ choices: [{ message: { content: out } }] });
    }
    if (String(input).startsWith("https://api.anthropic.com/")) {
      log.ai.push(body);
      return J({ content: [{ type: "text", text: o.aiAnswer ?? JSON.stringify({ summary: "They agreed the GST return.", decisions: ["File GSTR-3B by 20th"], actions: [{ title: "Send purchase bills", who: "Client", due: "2026-10-30" }] }) }], usage: { input_tokens: 100, output_tokens: 50 } });
    }
    if (String(input).startsWith("https://rtc.live.cloudflare.com/")) {
      log.cf.push({ url: String(input), method, body, auth: tok });
      if (String(input).endsWith("/sessions/new")) return J({ sessionId: "cf-" + log.cf.length });
      return J({ sessionDescription: { type: "answer", sdp: "v=0" }, tracks: (body && body.tracks) || [], requiresImmediateRenegotiation: false });
    }
    return J({ message: "not stubbed " + input }, 599);
  }) as typeof fetch;
  let clock = Date.parse("2026-10-23T05:00:00Z");
  const h = handler({ env: (k) => ({ SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k], fetch: fake, now: () => clock });
  const call = async (body: unknown, tok?: string, ip = "203.0.113.7") => {
    const res = await h(new Request("https://fn.test/fincom-call", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://staging.fincom.live", "x-forwarded-for": ip + ", 10.0.0.1", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) }));
    return { status: res.status, j: await res.json() as any };
  };
  return { T, log, call, tries, tick: (ms: number) => { clock += ms; } };
}

Deno.test("who may call: no token 401; a guest action without a link; a look-only member cannot host", async () => {
  const s = stand();
  eq((await s.call({ action: "start", kind: "client", client_id: "c1" })).status, 401, "no token");
  eq((await s.call({ action: "start", kind: "client", client_id: "c1" }, "anon-key")).status, 401, "the anon key is not a sign-in");
  eq((await s.call({ action: "guest_hello", token: "short" })).status, 404, "a made-up link");
  const look = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-look");
  eq([look.status, look.j.kind], [403, "role"], "look-only cannot start");
  eq((await s.call({ action: "start", kind: "client", client_id: "c2" }, "tok-staff")).status, 403, "another firm's client");
  eq((await s.call({ action: "start", kind: "party" }, "tok-staff")).status, 403, "an unknown kind");
});

Deno.test("a client call: peer to peer with free STUN, 4 at most; the same open room is joined, not made twice", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  eq([a.status, a.j.mode, a.j.max, a.j.me.role], [200, "p2p", 4, "host"], "the host's session");
  assert(/^call:[0-9a-f]{40}$/.test(a.j.topic), "a channel name from the key, never the key: " + a.j.topic);
  assert(!JSON.stringify(a.j).includes(s.T.call_rooms[0].chan_key), "the key itself never leaves");
  eq(a.j.ice, [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] }], "Cloudflare's STUN only (no TURN keys)");
  const b = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-owner");
  eq([b.j.room.id, b.j.topic, b.j.me.role], [a.j.room.id, a.j.topic, "member"], "a second start joins the open room");
  eq((await s.call({ action: "join", room_id: a.j.room.id }, "tok-look")).j.me.role, "member", "a look-only member joins");
  eq((await s.call({ action: "join", room_id: a.j.room.id }, "tok-staff2")).status, 200, "the fourth person");
  const full = await s.call({ action: "join", room_id: a.j.room.id }, "tok-staff3");
  eq([full.status, full.j.kind], [409, "full"], "the fifth: full while peer to peer");
  eq((await s.call({ action: "join", room_id: a.j.room.id }, "tok-other")).status, 404, "another firm cannot join");
});

Deno.test("with Cloudflare's keys: the SFU; the person's own session only; tracks of this call only", async () => {
  const s = stand({ cf: true });
  const a = await s.call({ action: "start", kind: "help" }, "tok-staff");
  eq([a.j.mode, a.j.max], ["sfu", R.SFU_MAX], "the SFU and its limit");
  const sess = await s.call({ action: "cf", room_id: a.j.room.id, op: "session" }, "tok-staff");
  eq(sess.j.sessionId, "cf-1", "a session made");
  assert(s.log.cf[0].auth === "cftok" && s.log.cf[0].url.includes("/apps/app1/"), "the app's key used server-side");
  assert(!JSON.stringify(sess.j).includes("cftok"), "the key never answered");
  await s.call({ action: "cf", room_id: a.j.room.id, op: "push", sdp: { type: "offer", sdp: "v=0" }, tracks: [{ mid: "0", trackName: "cam" }] }, "tok-staff");
  eq(s.log.cf[1].body.tracks, [{ location: "local", mid: "0", trackName: "cam" }], "pushed as local tracks");
  const b = await s.call({ action: "join", room_id: a.j.room.id }, "tok-owner");
  await s.call({ action: "cf", room_id: b.j.room.id, op: "session" }, "tok-owner");
  const pull = await s.call({ action: "cf", room_id: a.j.room.id, op: "pull", tracks: [{ sessionId: "cf-3", trackName: "cam", rid: "h" }, { sessionId: "someone-else", trackName: "cam" }] }, "tok-owner");
  eq(pull.status, 400, "nothing to pull until the other's session is in this call");
  const pull2 = await s.call({ action: "cf", room_id: a.j.room.id, op: "pull", tracks: [{ sessionId: "cf-1", trackName: "cam", rid: "h" }, { sessionId: "someone-else", trackName: "cam" }] }, "tok-owner");
  eq(pull2.status, 200, "pulled");
  eq(s.log.cf[s.log.cf.length - 1].body.tracks, [{ location: "remote", sessionId: "cf-1", trackName: "cam", simulcast: { preferredRid: "h" } }], "only this call's track, with its layer");
});

Deno.test("guests: link, name and email, a code by email, the waiting room, admitted by the host; removed: the channel moves on", async () => {
  const s = stand({ mail: true });
  const a = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  const rid = a.j.room.id;
  const inv = await s.call({ action: "invite", room_id: rid, base: "https://evil.example/x" }, "tok-staff");
  assert(inv.j.url.startsWith("https://staging.fincom.live/#/join/") && R.codeOk(inv.j.code) && inv.j.url.endsWith(inv.j.code), "the room's code link, only on FinCom's own site: " + inv.j.url);
  assert(inv.j.link.startsWith("https://staging.fincom.live/#join="), "and the older guest link: " + inv.j.link);
  eq(s.T.call_invites[0].token_hash, await R.sha256Hex(inv.j.token), "only the token's hash kept");
  eq((await s.call({ action: "guest_hello", token: inv.j.token })).j.title, "Call with Client One", "the guest sees the call's name");
  eq((await s.call({ action: "guest_start", token: inv.j.token, name: "X", email: "ram@client.test" })).status, 400, "a name of 2 letters at least");
  const g = await s.call({ action: "guest_start", token: inv.j.token, name: "Ram Kumar", email: "Ram@Client.test" });
  eq([g.status, g.j.code_sent], [200, true], "the code emailed");
  const code = /code: (\d{6})/.exec(s.log.mails[0].subject)![1];
  eq(s.log.mails[0].to, ["ram@client.test"], "to the guest's address");
  assert(!s.T.call_participants.some((p) => JSON.stringify(p).includes(code)), "the code itself is never stored");
  const gt = g.j.gt;
  const poll = await s.call({ action: "guest_poll", gt });
  eq([poll.j.state, poll.j.topic], ["waiting", undefined], "waiting, no channel yet");
  eq((await s.call({ action: "topic", gt })).status, 403, "no channel before being let in");
  eq((await s.call({ action: "roster", room_id: rid, gt })).status, 403, "a guest cannot read the people list");
  eq((await s.call({ action: "start", kind: "help", gt })).status, 403, "nor start a call");
  eq((await s.call({ action: "guest_verify", gt, code: "000000" === code ? "111111" : "000000" })).j.kind, "otp", "a wrong code");
  eq((await s.call({ action: "guest_verify", gt, code })).j.verified, true, "the right code");
  const roster = await s.call({ action: "roster", room_id: rid }, "tok-staff");
  const guestRow = roster.j.people.find((p: any) => p.role === "guest");
  eq([guestRow.state, guestRow.verified, guestRow.email], ["waiting", true, "ram@client.test"], "the host sees them waiting, email checked");
  eq((await s.call({ action: "admit", room_id: rid, participant_id: guestRow.id }, "tok-owner")).status, 200, "the firm's owner may admit too");
  const in1 = await s.call({ action: "guest_poll", gt });
  eq([in1.j.state, in1.j.topic], ["admitted", a.j.topic], "admitted: the call's channel");
  const chat = await s.call({ action: "chat", gt, body: "Hello, see https://example.com/bill.pdf" });
  eq([chat.status, chat.j.message.author], [200, "Ram Kumar"], "the guest's chat line kept with their name");
  eq((await s.call({ action: "upload", gt, what: "chat", name: "big.pdf", size: R.FILE_MAX + 1 })).status, 413, "a file over 20 MB refused");
  const up = await s.call({ action: "upload", gt, what: "chat", name: "bill (1).pdf", size: 1000 });
  assert(up.j.path.startsWith(FIRM + "/client/" + rid + "/chat/") && up.j.url.startsWith("https://stand.test/storage/v1/object/upload/sign/call-files/"), "a signed address in the firm's folder: " + up.j.path);
  // security review 26-Oct-2026: a chat file's type is the sender's (an .html, an .svg): it is fetched as an attachment,
  // never opened as a page on the storage address
  const dl = await s.call({ action: "download", gt, path: up.j.path });
  assert(dl.status === 200 && /[?&]download(=|&|$)/.test(dl.j.url), "a chat file downloads as an attachment: " + dl.j.url);
  eq((await s.call({ action: "chat", gt, file: { path: FIRM + "/client/other-room/chat/x.pdf", name: "x", size: 10 } })).status, 400, "a file of another call refused");
  eq((await s.call({ action: "upload", gt, what: "rec", recording_id: "x", size: 10 })).status, 403, "a guest never uploads the recording");
  const rm = await s.call({ action: "remove", room_id: rid, participant_id: guestRow.id }, "tok-staff");
  assert(rm.j.rekey && rm.j.topic !== a.j.topic, "removed: a new channel name");
  eq((await s.call({ action: "topic", gt })).j.kind, "notin", "the removed guest gets no new name");
  eq((await s.call({ action: "topic", room_id: rid }, "tok-staff")).j.topic, rm.j.topic, "the others get it");
  eq((await s.call({ action: "remove", room_id: rid, participant_id: guestRow.id }, "tok-look")).status, 403, "only the host removes");
});

Deno.test("guests without mail set up: no code, the host decides in the waiting room; a run-out pass", async () => {
  const s = stand({ mail: false });
  const a = await s.call({ action: "start", kind: "help" }, "tok-staff");
  const inv = await s.call({ action: "invite", room_id: a.j.room.id }, "tok-staff");
  const g = await s.call({ action: "guest_start", token: inv.j.token, name: "Sita", email: "sita@x.test" });
  eq([g.j.code_sent, g.j.mail], [false, false], "no code without mail");
  eq((await s.call({ action: "guest_verify", gt: g.j.gt, code: "123456" })).j.kind, "nocode", "nothing to verify");
  s.tick((R.GUEST_SESSION_SECS + 5) * 1000);
  eq((await s.call({ action: "guest_poll", gt: g.j.gt })).status, 401, "the guest pass runs out");
  eq((await s.call({ action: "guest_poll", gt: g.j.gt.slice(0, -2) + "xx" })).status, 401, "a changed pass is refused");
});

Deno.test("a class: a batch member verified by email comes straight in; others wait", async () => {
  const s = stand({ mail: true });
  const b = await s.call({ action: "batch_save", name: "GST batch 1", emails: ["Student@x.test"] }, "tok-staff");
  eq(s.T.call_batch_members[0].email, "student@x.test", "emails kept in lower case");
  eq((await s.call({ action: "batch_save", name: "x", emails: [] }, "tok-look")).status, 403, "look-only cannot change a batch");
  const a = await s.call({ action: "start", kind: "class", batch_id: b.j.id }, "tok-staff");
  eq(a.j.room.kind, "class", "a class room");
  const inv = await s.call({ action: "invite", room_id: a.j.room.id }, "tok-staff");
  for (const [email, want] of [["student@x.test", "admitted"], ["visitor@x.test", "waiting"]]) {
    const g = await s.call({ action: "guest_start", token: inv.j.token, name: "Person", email });
    const code = /code: (\d{6})/.exec(s.log.mails[s.log.mails.length - 1].subject)![1];
    await s.call({ action: "guest_verify", gt: g.j.gt, code });
    eq((await s.call({ action: "guest_poll", gt: g.j.gt })).j.state, want, email);
  }
});

Deno.test("recording: off for a client until the owner turns it on; the notice; only the host's pieces", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  const rid = a.j.room.id;
  eq((await s.call({ action: "rec_start", room_id: rid }, "tok-staff")).j.kind, "recoff", "off by default for a client");
  eq((await s.call({ action: "settings", client_id: "c1", set: true, allow: true, days: 120 }, "tok-staff")).status, 403, "staff cannot turn it on");
  eq((await s.call({ action: "settings", client_id: "c1", set: true, allow: true, days: 120 }, "tok-owner")).j.setting.allow_recording, true, "the owner turns it on");
  const rec = await s.call({ action: "rec_start", room_id: rid }, "tok-staff");
  eq(rec.j.notice, "This call is being recorded", "the notice everyone sees");
  eq(s.T.call_recordings[0].retain_until, "2027-02-20", "kept for the client's 120 days");
  await s.call({ action: "join", room_id: rid }, "tok-look");
  eq((await s.call({ action: "rec_start", room_id: rid }, "tok-look")).status, 403, "only the host records");
  const up = await s.call({ action: "upload", room_id: rid, what: "rec", recording_id: rec.j.recording_id, seq: 3, size: 1000 }, "tok-staff");
  assert(up.j.path === FIRM + "/client/" + rid + "/rec/" + rec.j.recording_id + "/00003.part", "the piece's place: " + up.j.path);
  eq((await s.call({ action: "consent", room_id: rid, recording_id: rec.j.recording_id, event: "accepted" }, "tok-look")).status, 200, "consent logged");
  eq(s.T.call_consents.map((c) => c.event), ["accepted"], "the consent log");
  const poll = await s.call({ action: "join", room_id: rid }, "tok-owner");
  eq(poll.j.recording.notice, "This call is being recorded", "someone joining is told at once");
  await s.call({ action: "rec_stop", recording_id: rec.j.recording_id }, "tok-staff");
  assert(s.T.call_recordings[0].ended_at, "stopped");
  const cls = stand();
  const b = await cls.call({ action: "batch_save", name: "B1", emails: [] }, "tok-staff");
  const c = await cls.call({ action: "start", kind: "class", batch_id: b.j.id }, "tok-staff");
  await cls.call({ action: "rec_start", room_id: c.j.room.id }, "tok-staff");
  eq(cls.T.call_recordings[0].retain_until, "2027-10-23", "a class: a year");
  assert(cls.T.call_recordings[0].prefix.startsWith(FIRM + "/class/" + b.j.id + "/"), "a class's files in its batch's folder");
});

Deno.test("the transcript: each person's own pieces through fincom-transcribe with the caller's token; merged in order with names", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  const rid = a.j.room.id;
  const b = await s.call({ action: "join", room_id: rid }, "tok-owner");
  const mine = (p: any) => FIRM + "/client/" + rid + "/mic/" + p + "/";
  eq((await s.call({ action: "piece", room_id: rid, seq: 0, start_ms: 0, dur_ms: 9000, path: mine(b.j.me.id) + "00000.webm" }, "tok-staff")).status, 403, "another's piece refused");
  eq((await s.call({ action: "piece", room_id: rid, seq: 0, start_ms: 0, dur_ms: 61000, path: mine(a.j.me.id) + "00000.webm" }, "tok-staff")).status, 400, "over 60 s refused");
  await s.call({ action: "piece", room_id: rid, seq: 0, start_ms: 0, dur_ms: 9000, path: mine(a.j.me.id) + "00000.webm" }, "tok-staff");
  await s.call({ action: "piece", room_id: rid, seq: 0, start_ms: 9500, dur_ms: 12000, path: mine(b.j.me.id) + "00000.webm" }, "tok-owner");
  await s.call({ action: "piece", room_id: rid, seq: 1, start_ms: 30000, dur_ms: 8000, path: mine(a.j.me.id) + "00001.webm" }, "tok-staff");
  await s.call({ action: "piece", room_id: rid, seq: 1, start_ms: 30000, dur_ms: 8000, path: mine(a.j.me.id) + "00001.webm" }, "tok-staff");
  eq(s.T.call_pieces.length, 3, "a piece sent twice kept once");
  eq((await s.call({ action: "transcribe", room_id: rid }, "tok-look")).status, 403, "look-only cannot make it");
  const t = await s.call({ action: "transcribe", room_id: rid }, "tok-owner");
  eq(t.j.lines.map((l: any) => l.who + ":" + l.text), ["Riya:words 1", "Anshul:words 2", "Riya:words 3"], "in the order said, each with their name");
  assert(s.log.transcribe.every((x) => x.auth === "tok-owner") && s.log.transcribe[0].url.includes("client=c1") && s.log.transcribe[0].url.includes("secs=9"), "fincom-transcribe with the caller's own token, the client and the length");
  const s2 = stand({ transcribe: () => new Response(JSON.stringify({ ok: false, kind: "limit" }), { status: 429 }) });
  const a2 = await s2.call({ action: "start", kind: "help" }, "tok-staff");
  await s2.call({ action: "piece", room_id: a2.j.room.id, seq: 0, start_ms: 0, dur_ms: 9000, path: FIRM + "/help/" + a2.j.room.id + "/mic/" + a2.j.me.id + "/00000.webm" }, "tok-staff");
  const t2 = await s2.call({ action: "transcribe", room_id: a2.j.room.id }, "tok-staff");
  eq([t2.j.wait, t2.j.left], [60, 1], "Groq's limit: wait a minute, the piece kept for later");
});

Deno.test("the summary: one call within the AI switch and cap; checked; action items to the due list as the person", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  const rid = a.j.room.id;
  eq((await s.call({ action: "summarise", room_id: rid }, "tok-staff")).j.kind, "notranscript", "no transcript yet");
  await s.call({ action: "piece", room_id: rid, seq: 0, start_ms: 0, dur_ms: 9000, path: FIRM + "/client/" + rid + "/mic/" + a.j.me.id + "/00000.webm" }, "tok-staff");
  await s.call({ action: "transcribe", room_id: rid }, "tok-staff");
  const sm = await s.call({ action: "summarise", room_id: rid }, "tok-staff");
  eq([sm.status, sm.j.summary.actions[0].title], [200, "Send purchase bills"], "the summary");
  eq(s.log.ai.length, 1, "one AI call");
  assert(["asst_cap_take", "asst_cost_add", "asst_log_add"].every((f) => s.log.rpc.includes(f)), "the cap, the cost and the log as every AI call");
  eq((await s.call({ action: "tasks", room_id: rid, items: [{ title: "Send purchase bills", due: "2026-10-30" }] }, "tok-staff")).j.added, 1, "added as tasks");
  const w = s.log.userWrites.find((x) => x.table === "client_due_tasks");
  eq([w.tok, w.rows[0].source, w.rows[0].ref, w.rows[0].created_by], ["tok-staff", "call", rid, STAFF], "with the person's own token, marked from the call");
  await s.call({ action: "join", room_id: rid }, "tok-look");
  eq((await s.call({ action: "tasks", room_id: rid, items: [{ title: "x" }] }, "tok-look")).j.kind, "role", "a look-only member cannot add tasks");
  const off = stand({ aiOff: true });
  const a2 = await off.call({ action: "start", kind: "help" }, "tok-staff");
  off.T.call_transcripts.push({ room_id: a2.j.room.id, firm_id: FIRM, lines: [{ who: "A", start_ms: 0, text: "hi" }] });
  eq((await off.call({ action: "summarise", room_id: a2.j.room.id }, "tok-staff")).j.kind, "off", "AI switched off by the owner");
  const bad = stand({ aiAnswer: "Sure! Here is a summary." });
  const a3 = await bad.call({ action: "start", kind: "help" }, "tok-staff");
  bad.T.call_transcripts.push({ room_id: a3.j.room.id, firm_id: FIRM, lines: [{ who: "A", start_ms: 0, text: "hi" }] });
  eq((await bad.call({ action: "summarise", room_id: a3.j.room.id }, "tok-staff")).j.kind, "ai", "an answer not in the shape is refused");
});

Deno.test("working together: only the host starts it; members who can read the client follow; a guest never; ends with the call", async () => {
  const s = stand({ mail: false });
  const a = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  const rid = a.j.room.id;
  await s.call({ action: "join", room_id: rid }, "tok-look");
  eq((await s.call({ action: "cowork", room_id: rid, on: true }, "tok-look")).j.kind, "host", "only the host starts it");
  eq((await s.call({ action: "cowork_join", room_id: rid }, "tok-look")).j.kind, "cowork", "nothing to join before it starts");
  const on = await s.call({ action: "cowork", room_id: rid, on: true }, "tok-staff");
  assert(/^cowork:[0-9a-f]{40}$/.test(on.j.topic) && on.j.topic !== a.j.topic, "its own channel");
  eq((await s.call({ action: "cowork_join", room_id: rid }, "tok-look")).j.topic, on.j.topic, "a look-only member follows (their own rights stay look-only)");
  const inv = await s.call({ action: "invite", room_id: rid }, "tok-staff");
  const g = await s.call({ action: "guest_start", token: inv.j.token, name: "Client Person", email: "c@x.test" });
  const gid = s.T.call_participants.find((p) => p.role === "guest")!.id;
  await s.call({ action: "admit", room_id: rid, participant_id: gid }, "tok-staff");
  const gj = await s.call({ action: "cowork_join", room_id: rid, gt: g.j.gt });
  eq([gj.status, gj.j.kind], [403, "guest"], "a guest gets no working-together channel");
  assert(!JSON.stringify((await s.call({ action: "guest_poll", gt: g.j.gt })).j).includes(on.j.topic.slice(7)), "nor its name in the guest's session");
  await s.call({ action: "end", room_id: rid }, "tok-staff");
  eq([s.T.call_rooms[0].status, s.T.call_rooms[0].cowork_on], ["ended", false], "the call's end ends it");
  eq((await s.call({ action: "cowork_join", room_id: rid }, "tok-look")).status, 403, "nothing to follow after the end");
  eq((await s.call({ action: "guest_poll", gt: g.j.gt })).j.state, "ended", "the guest is told");
});

Deno.test("remote help (stage 2): owner or staff only; the reason logged; ended with the call", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  const rid = a.j.room.id;
  await s.call({ action: "join", room_id: rid }, "tok-look");
  eq((await s.call({ action: "remote", room_id: rid, op: "start", reason: "fix Tally" }, "tok-look")).j.kind, "role", "look-only refused");
  eq((await s.call({ action: "remote", room_id: rid, op: "start", reason: "x" }, "tok-staff")).status, 400, "a reason is needed");
  const st = await s.call({ action: "remote", room_id: rid, op: "start", reason: "Fix the Tally company path", peer_name: "Client" }, "tok-staff");
  eq(s.T.call_remote_sessions[0].reason, "Fix the Tally company path", "the log row with the reason");
  eq([s.T.call_remote_sessions[0].client_id, s.T.call_remote_sessions[0].host_user], ["c1", STAFF], "who and which client");
  eq(st.j.server, { id_server: "", relay: "", key: "" }, "the configurable RustDesk server (empty: RustDesk's public servers)");
  assert(!JSON.stringify(s.T.call_remote_sessions).toLowerCase().includes("password"), "no password anywhere");
  eq((await s.call({ action: "remote", room_id: rid, op: "end", id: st.j.id }, "tok-staff")).j.ended, true, "ended");
  const st2 = await s.call({ action: "remote", room_id: rid, op: "start", reason: "Second look" }, "tok-staff");
  await s.call({ action: "end", room_id: rid }, "tok-staff");
  assert(s.T.call_remote_sessions.find((x) => x.id === st2.j.id)!.ended_at, "the call's end closes the log row");
});

Deno.test("schedule a meeting: the .ics, the invite by email when mail is set up, else the text to copy", async () => {
  const s = stand({ mail: true });
  const r = await s.call({ action: "schedule", title: "Year-end review", at: "2026-10-25T05:30:00Z", minutes: 45, emails: ["a@x.test", "B@x.test"], client_id: "c1", base: "https://staging.fincom.live/review/" }, "tok-staff");
  eq([r.status, r.j.emailed], [200, 2], "emailed to both");
  assert(r.j.ics.includes("DTSTART:20261025T053000Z") && r.j.ics.includes("DTEND:20261025T061500Z") && r.j.ics.includes("SUMMARY:Year-end review"), "the calendar invite");
  assert(r.j.url === "https://staging.fincom.live/review/#/join/" + r.j.code && R.codeOk(r.j.code), "the code link on the page it was made from: " + r.j.url);
  assert(s.log.mails[0].text.includes("Meeting code: " + r.j.code) && s.log.mails[0].subject.startsWith("Invitation: Year-end review · 25-Oct-2026 11:00 IST"), "the email: link, code and time in IST");
  eq(s.log.mails[0].attachments[0].filename, "invite.ics", "the .ics attached");
  eq((await s.call({ action: "schedule", title: "x", at: "2026-10-25T05:30:00Z", emails: ["nope"] }, "tok-staff")).status, 400, "a wrong address refused");
  const m = stand({ mail: false });
  const r2 = await m.call({ action: "schedule", title: "Review", at: "2026-10-25T05:30:00Z", emails: ["a@x.test"] }, "tok-staff");
  eq([r2.j.emailed, r2.j.mail, r2.j.text.includes("Join:")], [0, false, true], "no mail: the invite text to copy");
  const j = await m.call({ action: "join", room_id: r2.j.room_id }, "tok-staff");
  eq(j.j.room.status, "open", "joining a scheduled meeting opens it");
});

// ---------------------------------------------------------------- next-calls-meet (23-Oct-2026): codes, Meetings, subtitles
Deno.test("meeting codes: every room has one; an instant meeting, a meeting for later; a member joins by code, another firm's member as a guest", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "meeting", title: "Quick sync" }, "tok-staff");
  eq([a.status, a.j.room.kind, a.j.room.title, a.j.me.role], [200, "meeting", "Quick sync", "host"], "an instant meeting, the starter hosts");
  assert(R.codeOk(a.j.room.code), "its code: " + a.j.room.code);
  const a2 = await s.call({ action: "start", kind: "meeting" }, "tok-staff");
  assert(a2.j.room.id !== a.j.room.id && a2.j.room.code !== a.j.room.code, "a new room and code every time");
  eq((await s.call({ action: "start", kind: "meeting", client_id: "c2" }, "tok-staff")).status, 403, "another firm's client refused");
  const c = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  assert(R.codeOk(c.j.room.code), "a client call has a code too");
  const later = await s.call({ action: "create", title: "GST review", base: "https://staging.fincom.live/review/?v=3#/meetings" }, "tok-owner");
  eq([later.status, s.T.call_rooms.find((r) => r.id === later.j.room_id)!.status], [200, "scheduled"], "a meeting for later: made, nobody in it yet");
  eq(later.j.url, "https://staging.fincom.live/review/#/join/" + later.j.code, "its one link");
  assert(later.j.text.includes("Meeting code: " + later.j.code), "the words to share carry the code");
  eq((await s.call({ action: "create", title: "x" }, "tok-look")).status, 403, "look-only cannot create one");
  // an old room (made before codes) gets one when joined
  s.T.call_rooms.push({ id: "eeeeeeee-0000-4000-8000-0000000000ff", firm_id: FIRM, kind: "help", title: "Old", status: "open", chan_key: "k".repeat(40), chan_epoch: 1, cowork_epoch: 1, created_at: new Date().toISOString() });
  const old = await s.call({ action: "join", room_id: "eeeeeeee-0000-4000-8000-0000000000ff" }, "tok-staff");
  assert(R.codeOk(old.j.room.code) && s.T.call_rooms.find((r) => r.id === "eeeeeeee-0000-4000-8000-0000000000ff")!.code === old.j.room.code, "an older room is given its code");
  const byCode = await s.call({ action: "join_code", code: later.j.code.toUpperCase().replace(/-/g, " ") }, "tok-staff");
  eq([byCode.status, byCode.j.room.id, byCode.j.room.status, byCode.j.me.role], [200, later.j.room_id, "open", "member"], "a member joins by the code, typed any way: straight in");
  eq((await s.call({ action: "join_code", code: "https://staging.fincom.live/review/#/join/" + a.j.room.code }, "tok-look")).j.me.role, "member", "or with the whole link");
  const other = await s.call({ action: "join_code", code: a.j.room.code }, "tok-other");
  eq([other.status, other.j.kind], [404, "otherfirm"], "another firm's member is told to join as a guest");
  eq((await s.call({ action: "join_code", code: "abc-defg-hjk" }, "tok-staff")).j.kind, "nocode", "a code of no room");
});

Deno.test("codes cannot be guessed: wrong codes counted per address, asks to join per room; a guest by code waits for the host", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "meeting" }, "tok-staff");
  const wrong = [];
  for (let i = 0; i < R.CODE_TRIES.ipMax + 2; i++) wrong.push((await s.call({ action: "guest_hello", code: "bcd-efgh-jkm" }, undefined, "198.51.100.9")).j.kind);
  eq(wrong.slice(0, R.CODE_TRIES.ipMax), Array(R.CODE_TRIES.ipMax).fill("nocode"), "ten wrong codes: no meeting has this code");
  eq(wrong.slice(R.CODE_TRIES.ipMax), ["tries", "tries"], "then: too many wrong codes from here");
  assert(Object.keys(s.tries).every((k) => /^ip:[0-9a-f]{32}$/.test(k) && !k.includes("198.51")), "the address kept only as a hash: " + Object.keys(s.tries));
  eq((await s.call({ action: "guest_hello", code: a.j.room.code }, undefined, "198.51.100.9")).j.kind, "tries", "even a right code from that address waits out the window");
  const hello = await s.call({ action: "guest_hello", code: a.j.room.code }, undefined, "192.0.2.1");
  eq([hello.status, hello.j.title, hello.j.firm, hello.j.code], [200, "Meeting", "Garg & Co", a.j.room.code], "another address: the meeting's name and the firm");
  eq((await s.call({ action: "guest_hello", code: "not a code" }, undefined, "192.0.2.1")).j.kind, "nocode", "not a code at all");
  const g = await s.call({ action: "guest_start", code: a.j.room.code, name: "Ram Kumar", email: "ram@client.test" }, undefined, "192.0.2.1");
  eq([g.status, g.j.code_sent], [200, false], "asked to join (no email set up: the host decides)");
  const ro = await s.call({ action: "roster", room_id: a.j.room.id }, "tok-staff");
  const row = ro.j.people.find((p: any) => p.role === "guest");
  eq([row.name, row.state, s.T.call_participants.find((p) => p.id === row.id)!.invite_id], ["Ram Kumar", "waiting", null], "in the waiting room, by code (no link token)");
  await s.call({ action: "admit", room_id: a.j.room.id, participant_id: row.id }, "tok-staff");
  eq((await s.call({ action: "guest_poll", gt: g.j.gt })).j.state, "admitted", "admitted");
  for (let i = 0; i < R.CODE_TRIES.roomMax - 1; i++) await s.call({ action: "guest_start", code: a.j.room.code, name: "Person " + i, email: "p" + i + "@x.test" }, undefined, "192.0.2." + (i + 2));
  const flood = await s.call({ action: "guest_start", code: a.j.room.code, name: "One more", email: "m@x.test" }, undefined, "192.0.2.200");
  eq([flood.status, flood.j.kind], [429, "tries"], "30 asks to join a room in an hour, then refused");
  s.tick(R.CODE_TRIES.roomSecs * 1000);
  // (the stub's counter has no windows; the database's call_code_hit has: run_migration103.py)
});

Deno.test("guests by code with email set up: the code by email checks the address; the meeting ended: refused", async () => {
  const s = stand({ mail: true });
  const a = await s.call({ action: "start", kind: "meeting" }, "tok-staff");
  const g = await s.call({ action: "guest_start", code: a.j.room.code, name: "Sita Devi", email: "sita@x.test" });
  eq(g.j.code_sent, true, "a code sent");
  const otp = /code: (\d{6})/.exec(s.log.mails[0].subject)![1];
  eq((await s.call({ action: "guest_verify", gt: g.j.gt, code: otp })).j.verified, true, "checked");
  await s.call({ action: "end", room_id: a.j.room.id }, "tok-staff");
  eq((await s.call({ action: "guest_hello", code: a.j.room.code })).j.kind, "ended", "the host ended it: the code says so");
});

Deno.test("a meeting's code works again after everyone left; the host's End ends it for good", async () => {
  const s = stand();
  const later = await s.call({ action: "create", title: "Weekly" }, "tok-staff");
  const j1 = await s.call({ action: "join_code", code: later.j.code }, "tok-staff");
  const topic1 = j1.j.topic;
  await s.call({ action: "leave", room_id: later.j.room_id }, "tok-staff");
  eq(s.T.call_rooms.find((r) => r.id === later.j.room_id)!.status, "scheduled", "the last one out: the meeting waits for its code again");
  const j2 = await s.call({ action: "join_code", code: later.j.code }, "tok-owner");
  eq([j2.status, j2.j.room.status], [200, "open"], "joined again the next day by the same code");
  assert(j2.j.topic !== topic1, "a new channel name");
  const help = await s.call({ action: "start", kind: "help" }, "tok-staff");
  await s.call({ action: "leave", room_id: help.j.room.id }, "tok-staff");
  eq(s.T.call_rooms.find((r) => r.id === help.j.room.id)!.status, "ended", "a help call ends when the last one leaves, as before");
  await s.call({ action: "end", room_id: later.j.room_id }, "tok-owner");
  eq((await s.call({ action: "join_code", code: later.j.code }, "tok-staff")).j.kind, "ended", "ended by the host: for good");
});

Deno.test("Meetings: Upcoming (mine: host or invited by email) and Recent with recording and transcript; Add people by email or the mail app", async () => {
  const s = stand({ mail: false });
  const sch = await s.call({ action: "schedule", title: "Year-end", at: "2026-10-25T05:30:00Z", minutes: 45, emails: ["s2@a.test", "client@x.test"], base: "https://staging.fincom.live/review/" }, "tok-staff");
  eq([sch.j.emailed, sch.j.mail], [0, false], "no email set up: nothing sent, the app opens the person's mail app");
  assert(sch.j.subject === "Invitation: Year-end · 25-Oct-2026 11:00 IST" && sch.j.text.includes(sch.j.url) && sch.j.ics.includes("BEGIN:VEVENT"), "the subject, the words and the .ics for it");
  await s.call({ action: "create", title: "Later one" }, "tok-owner");
  const past = await s.call({ action: "start", kind: "meeting", title: "Done one" }, "tok-staff");
  await s.call({ action: "rec_start", room_id: past.j.room.id }, "tok-staff");
  s.T.call_transcripts.push({ room_id: past.j.room.id, firm_id: FIRM, lines: [] });
  await s.call({ action: "end", room_id: past.j.room.id }, "tok-staff");
  const m2 = await s.call({ action: "meetings" }, "tok-staff2");
  const titles = m2.j.upcoming.map((r: any) => r.title + (r.mine ? "*" : ""));
  eq(titles.sort(), ["Later one", "Year-end*"], "upcoming: the invited member's own marked (" + titles + ")");
  eq(m2.j.recent.map((r: any) => [r.title, r.recording, r.transcript]), [["Done one", true, true]], "recent: with its recording and transcript");
  eq((await s.call({ action: "meetings" }, "tok-other")).j.upcoming.length, 0, "another firm sees none");
  const inv = await s.call({ action: "invite", room_id: sch.j.room_id, emails: ["new@x.test"], base: "https://staging.fincom.live/review/" }, "tok-staff");
  eq([inv.j.emailed, inv.j.url, !!inv.j.ics], [false, sch.j.url, true], "Add people: the same link, the .ics (the mail app sends it)");
  assert(s.T.call_rooms.find((r) => r.id === sch.j.room_id)!.invitees.includes("new@x.test"), "kept with the meeting's invitees");
  const sm = stand({ mail: true });
  const a = await sm.call({ action: "start", kind: "meeting" }, "tok-staff");
  const inv2 = await sm.call({ action: "invite", room_id: a.j.room.id, emails: ["x@y.test", "z@y.test"] }, "tok-staff");
  eq([inv2.j.emailed, sm.log.mails[0].to], [true, ["x@y.test", "z@y.test"]], "with Resend: emailed");
  eq((await sm.call({ action: "invite", room_id: a.j.room.id, emails: ["bad"] }, "tok-staff")).status, 400, "a wrong address refused");
});

const AUDIO = btoa(String.fromCharCode(...new Array(3000).fill(0).map((_, i) => i % 251)));
Deno.test("subtitles: the words and their language from Whisper, one translation per language switched on, never into the speaker's own", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  const r = await s.call({ action: "caption", room_id: a.j.room.id, audio: AUDIO, mime: "audio/webm", secs: 5, start_ms: 4000, targets: ["hi", "en", "ta", "xx"] }, "tok-staff");
  eq([r.status, r.j.lang, r.j.paused], [200, "ta", false], "Tamil found by Whisper");
  eq(r.j.tr, { hi: "Sharma Traders को ₹1,25,000 GSTR-3B के लिए भेजें", en: "Send ₹1,25,000 to Sharma Traders for GSTR-3B" }, "into Hindi and English; not into Tamil (the speaker's own); an unknown language dropped");
  eq([s.log.stt[0].format, s.log.stt[0].auth, s.log.stt[0].model], ["verbose_json", "gsk-test", "whisper-large-v3-turbo"], "Whisper with the language found (verbose_json), the platform's Groq key");
  assert(String(s.log.stt[0].prompt).includes("Sharma Traders"), "the client's ledger names in Whisper's words prompt");
  eq(s.log.chat.length, 2, "one translation call per language");
  const sys = s.log.chat[0].body.messages[0].content;
  assert(s.log.chat[0].body.model === "llama-3.1-8b-instant" && sys.includes("Sharma Traders") && sys.includes("194J") && sys.includes("amount"), "Groq's Llama, told to keep names, amounts and tax terms");
  const used = s.T.assistant_log.at(-1)!;
  eq([used.feature, used.question, used.tools[0], used.calls], ["call_subs", "", "ok", 3], "one usage row: counts only");
  assert(!JSON.stringify(s.T.assistant_log).includes("Sharma") && !JSON.stringify(s.T.assistant_log).includes(AUDIO.slice(0, 20)), "never the words or the audio in the log");
  eq(s.T.call_captions.length, 0, "not recorded: nothing kept, the subtitles only shown");
  const none = await s.call({ action: "caption", room_id: a.j.room.id, audio: AUDIO, secs: 5, targets: ["ta"] }, "tok-staff");
  eq([none.j.tr, s.log.chat.length], [{}, 2], "only the speaker's own language on: no translation call");
  const g = stand();
  const b = await g.call({ action: "start", kind: "help" }, "tok-staff");
  eq((await g.call({ action: "caption", room_id: b.j.room.id, audio: "%%%", targets: ["hi"] }, "tok-staff")).j.kind, "size", "not audio: refused");
  eq((await g.call({ action: "caption", room_id: b.j.room.id, audio: AUDIO, targets: ["hi"] }, "tok-owner")).j.kind, "notin", "only someone in the call");
});

Deno.test("subtitles: Groq's 429 shows the words as said with translation paused; a translation that lost an amount or name is not used; recorded calls keep them", async () => {
  const s = stand({ chat: (body, n) => n === 1 ? new Response("{}", { status: 429 }) : new Response(JSON.stringify({ choices: [{ message: { content: "x" } }] })) });
  const a = await s.call({ action: "start", kind: "help" }, "tok-staff");
  const r = await s.call({ action: "caption", room_id: a.j.room.id, audio: AUDIO, secs: 5, targets: ["hi", "en"] }, "tok-staff");
  eq([r.status, r.j.paused, r.j.tr, r.j.text.length > 0], [200, true, { hi: null, en: null }, true], "429: the words as said, translation paused, the call goes on");
  eq(s.log.chat.length, 1, "no more calls once paused for this piece");
  assert(s.T.assistant_log.at(-1)!.tools.includes("paused"), "logged as paused");
  const lost = stand({ chat: () => new Response(JSON.stringify({ choices: [{ message: { content: "शर्मा ट्रेडर्स को एक लाख भेजें" } }] })) });
  const b = await lost.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  eq((await lost.call({ action: "caption", room_id: b.j.room.id, audio: AUDIO, secs: 5, targets: ["hi"] }, "tok-staff")).j.tr, { hi: null }, "names and the amount changed: not used (the words as said are shown)");
  const sttLimit = stand({ stt: () => new Response("{}", { status: 429 }) });
  const c = await sttLimit.call({ action: "start", kind: "help" }, "tok-staff");
  const lim = await sttLimit.call({ action: "caption", room_id: c.j.room.id, audio: AUDIO, secs: 5, targets: ["hi"] }, "tok-staff");
  eq([lim.status, lim.j.kind, sttLimit.log.stt.map((x: any) => x.model)], [429, "limit", ["whisper-large-v3-turbo", "whisper-large-v3"]], "Whisper's limit: the other model tried, then paused");
  const nokey = stand({ groq: false });
  const d = await nokey.call({ action: "start", kind: "help" }, "tok-staff");
  eq((await nokey.call({ action: "caption", room_id: d.j.room.id, audio: AUDIO, targets: ["hi"] }, "tok-staff")).j.kind, "nokey", "no Groq key: said so");
  // recorded: kept with the call, for those who stayed after the notice
  const k = stand();
  const e = await k.call({ action: "start", kind: "help" }, "tok-staff");
  await k.call({ action: "join", room_id: e.j.room.id }, "tok-staff2");
  const rec = await k.call({ action: "rec_start", room_id: e.j.room.id }, "tok-staff");
  await k.call({ action: "caption", room_id: e.j.room.id, audio: AUDIO, secs: 5, start_ms: 1000, targets: ["hi"] }, "tok-staff2");
  eq(k.T.call_captions.length, 0, "a person who has not accepted the notice: not kept");
  await k.call({ action: "consent", room_id: e.j.room.id, recording_id: rec.j.recording_id, event: "accepted" }, "tok-staff2");
  await k.call({ action: "caption", room_id: e.j.room.id, audio: AUDIO, secs: 5, start_ms: 7000, targets: ["hi"] }, "tok-staff2");
  eq(k.T.call_captions.map((x) => [x.who, x.lang, x.start_ms, !!x.tr.hi]), [["S2", "ta", 7000, true]], "accepted: kept with the language found and the translation made");
});

Deno.test("the summary in the language asked for (default English)", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "client", client_id: "c1" }, "tok-staff");
  s.T.call_transcripts.push({ room_id: a.j.room.id, firm_id: FIRM, lines: [{ who: "Riya", start_ms: 0, text: "File GSTR-3B by 20th" }], tasks_added: [] });
  await s.call({ action: "summarise", room_id: a.j.room.id }, "tok-staff");
  assert(!s.log.ai[0].system.includes("Write the summary"), "English: as before");
  const h = await s.call({ action: "summarise", room_id: a.j.room.id, lang: "hi" }, "tok-staff");
  assert(s.log.ai[1].system.includes("in Hindi (its own script)") && s.log.ai[1].system.includes("GSTR-3B"), "Hindi asked: said to the model, terms kept");
  eq(h.j.summary.lang, "hi", "the summary says its language");
});

Deno.test("subtitles in Hinglish: Hindi taken for Urdu is heard again as Hindi, then in English letters; a real Urdu speaker read in Urdu keeps Urdu", async () => {
  const URDU = "شرما ٹریڈرز کو ایک لاکھ روپے بھیجو", HINDI = "शर्मा ट्रेडर्स को एक लाख रुपये भेजो";
  const stt = (form: FormData) => new Response(JSON.stringify(form.get("language") === "hi" ? { text: HINDI, language: "hindi" } : { text: URDU, language: "urdu" }));
  const s = stand({ stt });
  const a = await s.call({ action: "start", kind: "help" }, "tok-staff");
  const r = await s.call({ action: "caption", room_id: a.j.room.id, audio: AUDIO, secs: 5, targets: ["hinglish", "ur"] }, "tok-staff");
  eq([r.j.lang, r.j.text], ["ur", URDU], "Whisper's first answer kept as said (Urdu found)");
  eq(s.log.stt.map((x: any) => x.language), [null, "hi"], "heard again as Hindi for the Hinglish reader");
  assert(typeof r.j.tr.hinglish === "string" && /^[\x00-\x7F]+$/.test(r.j.tr.hinglish) && /lakh|lakha|laakh/i.test(r.j.tr.hinglish), "Hinglish in English letters: " + r.j.tr.hinglish);
  assert(!("ur" in r.j.tr), "the Urdu reader: the words as said, no translation");
  eq(s.log.chat.length, 0, "no translation call for either");
  assert(s.T.assistant_log.at(-1)!.tools.includes("urdu:hi"), "logged urdu:hi");
  const u = stand({ stt });
  const b = await u.call({ action: "start", kind: "help" }, "tok-staff");
  const r2 = await u.call({ action: "caption", room_id: b.j.room.id, audio: AUDIO, secs: 5, targets: ["ur"] }, "tok-staff");
  eq([r2.j.lang, r2.j.tr, u.log.stt.length], ["ur", {}, 1], "a genuine Urdu speaker, Urdu reader: Urdu kept, not heard again");
  const h = stand({ stt: () => new Response(JSON.stringify({ text: HINDI, language: "hindi" })) });
  const c = await h.call({ action: "start", kind: "help" }, "tok-staff");
  const r3 = await h.call({ action: "caption", room_id: c.j.room.id, audio: AUDIO, secs: 5, targets: ["hinglish"] }, "tok-staff");
  assert(/^[\x00-\x7F]+$/.test(r3.j.tr.hinglish) && h.log.chat.length === 0, "Hindi in Devanagari to Hinglish: English letters, no call: " + r3.j.tr.hinglish);
});

// next-calls-complete (25-Oct-2026): a Hindi reader got a Llama "translation" of Hindi that Whisper took for Urdu; and an
// iPhone's pieces (cut by time while Safari's audio context was asleep) can be silence, over which Whisper says "Thank you."
Deno.test("subtitles: Hindi taken for Urdu reaches a Hindi reader as heard in Hindi; what Whisper finds no speech in is not shown", async () => {
  const URDU = "شرما ٹریڈرز کو ایک لاکھ روپے بھیجو", HINDI = "शर्मा ट्रेडर्स को एक लाख रुपये भेजो";
  const s = stand({ stt: (form: FormData) => new Response(JSON.stringify(form.get("language") === "hi" ? { text: HINDI, language: "hindi" } : { text: URDU, language: "urdu" })) });
  const a = await s.call({ action: "start", kind: "help" }, "tok-staff");
  const r = await s.call({ action: "caption", room_id: a.j.room.id, audio: AUDIO, secs: 5, targets: ["hi", "en"] }, "tok-staff");
  eq([r.j.lang, r.j.tr.hi], ["ur", HINDI], "the Hindi reader: the words heard again as Hindi, in Devanagari");
  eq([s.log.stt.map((x: any) => x.language), s.log.chat.length], [[null, "hi"], 1], "heard again once; only English translated");
  const q = stand({ stt: () => new Response(JSON.stringify({ text: " Thank you.", language: "english", segments: [{ text: " Thank you.", no_speech_prob: 0.92, avg_logprob: -1.1 }] })) });
  const b = await q.call({ action: "start", kind: "help" }, "tok-staff");
  const r2 = await q.call({ action: "caption", room_id: b.j.room.id, audio: AUDIO, secs: 5, targets: ["hi"] }, "tok-staff");
  eq([r2.status, r2.j.text, q.log.chat.length], [200, "", 0], "silence: nothing shown, nothing translated");
  const said = stand({ stt: () => new Response(JSON.stringify({ text: "GSTR-3B file karna hai. Thank you.", language: "english", segments: [{ text: "GSTR-3B file karna hai.", no_speech_prob: 0.02, avg_logprob: -0.3 }, { text: " Thank you.", no_speech_prob: 0.8, avg_logprob: -1.0 }] })) });
  const c = await said.call({ action: "start", kind: "help" }, "tok-staff");
  eq((await said.call({ action: "caption", room_id: c.j.room.id, audio: AUDIO, secs: 5, targets: [] }, "tok-staff")).j.text, "GSTR-3B file karna hai.", "the spoken part kept, the silent tail dropped");
  eq(R.spokenText({ text: "Thank you.", segments: [{ text: "Thank you.", no_speech_prob: 0.03, avg_logprob: -0.2 }] }), "Thank you.", "a real Thank you is kept");
});

// ---------------------------------------------------------------- next-calls-lobby (25-Oct-2026)
// The owner's room ff2c4c7c of 25-Oct: he started the meeting on his Mac (17:03), the guest was admitted (17:04), he
// joined again by code on his iPhone (17:10:15) and on the Mac (17:10:29), the Mac left (17:10:51). One row a person: the
// Mac's leave closed the iPhone's place too, and the iPhone's people list was refused (403 "You are not in this call.")
// every 3 s, silently, from 17:10:53 and again from 17:25:16 when the phone came back; the guest's new request (17:25:54)
// never showed.
Deno.test("the owner's 25-Oct room: his Mac's leave does not leave his iPhone stuck; the refusal says so and joining again works", async () => {
  const s = stand({ cf: true });
  const made = await s.call({ action: "create", title: "Meeting" }, "tok-owner");
  const mac = await s.call({ action: "join_code", code: made.j.code }, "tok-owner");
  const g = await s.call({ action: "guest_start", code: made.j.code, name: "Dr. Anu Tyagi Garg", email: "anu@x.test" });
  const gid = s.T.call_participants.find((p) => p.role === "guest")!.id;
  await s.call({ action: "admit", room_id: mac.j.room.id, participant_id: gid }, "tok-owner");
  const phone = await s.call({ action: "join_code", code: made.j.code }, "tok-owner");
  eq([phone.status, phone.j.me.id], [200, mac.j.me.id], "the iPhone joins on the same row (one a person)");
  await s.call({ action: "leave", room_id: mac.j.room.id }, "tok-owner");
  const ro = await s.call({ action: "roster", room_id: mac.j.room.id }, "tok-owner");
  eq([ro.status, ro.j.kind], [403, "left"], "the iPhone's people list: refused as 'left', not the guest's 'notin'");
  assert(/another device|joined again|Rejoin/i.test(ro.j.error), "in plain words: " + ro.j.error);
  const back = await s.call({ action: "join", room_id: mac.j.room.id }, "tok-owner");
  eq([back.status, back.j.me.state], [200, "admitted"], "Rejoin on the iPhone: straight back in");
  eq((await s.call({ action: "roster", room_id: mac.j.room.id }, "tok-owner")).status, 200, "the people list again");
  eq((await s.call({ action: "roster", room_id: mac.j.room.id, gt: g.j.gt })).status, 403, "a guest still never reads it");
});

Deno.test("someone asking to join reaches the host anywhere in FinCom (lobby), with a realtime ping that names no one", async () => {
  const s = stand();
  const made = await s.call({ action: "create", title: "Meeting with Anu" }, "tok-owner");
  const w0 = await s.call({ action: "lobby" }, "tok-owner");
  assert(w0.status === 200 && /^lobby:[0-9a-f]{40}$/.test(w0.j.topic) && w0.j.knocks.length === 0 && w0.j.every === R.LOBBY.watchSecs, "the firm's lobby channel (a name from a server secret), nobody waiting: " + JSON.stringify(w0.j));
  eq((await s.call({ action: "lobby" }, "tok-other")).j.topic === w0.j.topic, false, "another firm: another channel");
  const g = await s.call({ action: "guest_start", code: made.j.code, name: "Dr. Anu Tyagi Garg", email: "anu@x.test" });
  const b = s.log.broadcast.at(-1)!;
  assert(b && b.auth === "service-key" && b.body.messages.some((m: any) => m.topic === w0.j.topic && m.event === "knock"), "a ping on the firm's lobby channel: " + JSON.stringify(b && b.body));
  assert(!JSON.stringify(b.body).includes("Anu") && !JSON.stringify(b.body).includes("anu@"), "the ping names no one (only the room)");
  const w1 = await s.call({ action: "lobby" }, "tok-owner");
  eq(w1.j.knocks.map((k: any) => [k.name, k.title, k.mine, k.room_id]), [["Dr. Anu Tyagi Garg", "Meeting with Anu", true, made.j.room_id]], "the host (not in the meeting) sees who is asking, and where");
  eq((await s.call({ action: "lobby" }, "tok-staff")).j.knocks.length, 0, "staff: not while the host is online");
  eq((await s.call({ action: "lobby" }, "tok-look")).j.knocks.length, 0, "look-only: never");
  const p1 = await s.call({ action: "guest_poll", gt: g.j.gt });
  eq([p1.j.state, p1.j.host_name, p1.j.host_online], ["waiting", "Anshul", true], "the guest: waiting for Anshul (online)");
  const notYet = await s.call({ action: "admit", room_id: made.j.room_id, participant_id: w1.j.knocks[0].id }, "tok-staff");
  eq([notYet.status, notYet.j.kind], [403, "host"], "staff cannot admit while the host is online");
  // the host's phone goes quiet (no lobby for 100 s); the guest keeps asking
  s.tick(50000); await s.call({ action: "guest_poll", gt: g.j.gt }); s.tick(50000); await s.call({ action: "guest_poll", gt: g.j.gt });
  const p2 = await s.call({ action: "guest_poll", gt: g.j.gt });
  eq([p2.j.state, p2.j.host_online], ["waiting", false], "the host away: the guest is told so");
  const ws = await s.call({ action: "lobby" }, "tok-staff");
  eq(ws.j.knocks.map((k: any) => [k.name, k.mine, k.host_online]), [["Dr. Anu Tyagi Garg", false, false]], "the host away: staff are asked");
  const adm = await s.call({ action: "admit", room_id: made.j.room_id, participant_id: ws.j.knocks[0].id }, "tok-staff");
  eq(adm.status, 200, "staff admit while the host is away (from the pop-up, without opening the call)");
  assert(s.log.broadcast.length >= 2, "admitting pings again (the others' pop-ups go)");
  eq((await s.call({ action: "guest_poll", gt: g.j.gt })).j.state, "admitted", "the guest is in");
  eq((await s.call({ action: "lobby" }, "tok-owner")).j.knocks.length, 0, "nobody waiting any more");
  eq(s.T.call_watch.map((x) => x.user_id).sort(), [OWNER, STAFF, LOOK, OTHER].sort(), "who has FinCom open, one row each");
});

Deno.test("the host denies from the pop-up; Ask again after a long wait pings once more", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "meeting", title: "Review" }, "tok-staff");
  await s.call({ action: "leave", room_id: a.j.room.id }, "tok-staff");
  const g = await s.call({ action: "guest_start", code: a.j.room.code, name: "Ram Kumar", email: "ram@x.test" });
  const n = s.log.broadcast.length;
  await s.call({ action: "guest_poll", gt: g.j.gt, knock: true });
  eq(s.log.broadcast.length, n + 1, "Ask again: one more ping");
  const k = (await s.call({ action: "lobby" }, "tok-staff")).j.knocks[0];
  eq([k.name, k.mine], ["Ram Kumar", true], "the host's pop-up");
  eq((await s.call({ action: "deny", room_id: a.j.room.id, participant_id: k.id }, "tok-staff")).status, 200, "Deny");
  eq((await s.call({ action: "guest_poll", gt: g.j.gt })).j.state, "denied", "the guest is told");
  eq((await s.call({ action: "admit", room_id: a.j.room.id, participant_id: k.id }, "tok-staff")).j.kind, "gone", "an answer to someone no longer waiting is refused in words");
});

Deno.test("stale rows: no heartbeat for 60 s is left; a seat freed for the next; a phone back from the background comes back in", async () => {
  const s = stand();
  const a = await s.call({ action: "start", kind: "help" }, "tok-staff");
  const rid = a.j.room.id;
  await s.call({ action: "join", room_id: rid }, "tok-owner");
  await s.call({ action: "join", room_id: rid }, "tok-look");
  const inv = await s.call({ action: "invite", room_id: rid }, "tok-staff");
  const g = await s.call({ action: "guest_start", token: inv.j.token, name: "Sita Devi", email: "sita@x.test" });
  const gid = s.T.call_participants.find((p) => p.role === "guest")!.id;
  await s.call({ action: "admit", room_id: rid, participant_id: gid }, "tok-staff");
  eq((await s.call({ action: "join", room_id: rid }, "tok-staff2")).j.kind, "full", "four in a peer-to-peer call: full");
  // 70 s: the members' people lists keep them fresh; the guest's phone sleeps (no beat)
  for (let i = 0; i < 2; i++) { s.tick(35000); for (const t of ["tok-staff", "tok-owner", "tok-look"]) await s.call({ action: "roster", room_id: rid }, t); }
  const gr = s.T.call_participants.find((p) => p.id === gid)!;
  eq([gr.state, gr.left_why], ["left", "stale"], "the sleeping guest's row: left (stale), by the people list's check");
  eq((await s.call({ action: "roster", room_id: rid }, "tok-staff")).j.people.length, 3, "not counted among the people");
  eq((await s.call({ action: "join", room_id: rid }, "tok-staff2")).status, 200, "the seat is free for the next");
  await s.call({ action: "leave", room_id: rid }, "tok-staff2");
  const bk = await s.call({ action: "beat", gt: g.j.gt });
  eq([bk.status, bk.j.state, gr.state], [200, "admitted", "admitted"], "the guest's phone wakes: its beat brings it back in");
  eq((await s.call({ action: "topic", gt: g.j.gt })).status, 200, "and its call goes on");
  await s.call({ action: "remove", room_id: rid, participant_id: gid }, "tok-staff");
  eq((await s.call({ action: "beat", gt: g.j.gt })).j.state, "removed", "removed by the host: never brought back");
  // a waiting guest who went quiet and comes back is waiting again (the host asked again)
  const g2 = await s.call({ action: "guest_start", token: inv.j.token, name: "Mohan Lal", email: "m@x.test" });
  s.tick(61000); await s.call({ action: "roster", room_id: rid }, "tok-staff");
  eq(s.T.call_participants.find((p) => p.name === "Mohan Lal")!.state, "left", "a quiet waiting row: left");
  const n = s.log.broadcast.length;
  eq((await s.call({ action: "guest_poll", gt: g2.j.gt })).j.state, "waiting", "back: waiting again");
  eq(s.log.broadcast.length, n + 1, "and the host is pinged again");
});

Deno.test("the old admitted row (17:04, never closed) no longer keeps the room open when the host leaves", async () => {
  const s = stand();
  const made = await s.call({ action: "create", title: "Meeting" }, "tok-owner");
  const j = await s.call({ action: "join_code", code: made.j.code }, "tok-owner");
  await s.call({ action: "guest_start", code: made.j.code, name: "Dr. Anu Tyagi Garg", email: "anu@x.test" });
  const gid = s.T.call_participants.find((p) => p.role === "guest")!.id;
  await s.call({ action: "admit", room_id: j.j.room.id, participant_id: gid }, "tok-owner");
  s.tick(6 * 60000); await s.call({ action: "roster", room_id: j.j.room.id }, "tok-owner");
  await s.call({ action: "leave", room_id: j.j.room.id }, "tok-owner");
  eq(s.T.call_rooms[0].status, "scheduled", "the host out, the guest's row stale: the meeting waits for its code again");
  eq(s.T.call_participants.find((p) => p.id === gid)!.state, "left", "the old row closed");
});

Deno.test("before migration 106 (no heartbeat columns, no call_watch): everything works as before, the lobby by time asked", async () => {
  const s = stand({ noLobby: true });
  const made = await s.call({ action: "create", title: "Meeting" }, "tok-owner");
  const j = await s.call({ action: "join_code", code: made.j.code }, "tok-owner");
  eq(j.status, 200, "join");
  const g = await s.call({ action: "guest_start", code: made.j.code, name: "Ram Kumar", email: "ram@x.test" });
  eq(g.status, 200, "ask to join");
  const gp = await s.call({ action: "guest_poll", gt: g.j.gt });
  eq(gp.j.state, "waiting", "poll " + JSON.stringify(gp.j));
  eq((await s.call({ action: "roster", room_id: j.j.room.id }, "tok-owner")).j.people.length, 2, "the people list");
  const w = await s.call({ action: "lobby" }, "tok-owner");
  eq([w.status, w.j.knocks.length], [200, 1], "the lobby");
  assert(!s.T.call_participants.some((p) => "seen_at" in p || "left_why" in p), "no heartbeat written without its column");
});

// ---------------------------------------------------------------- meeting notes (next-calls-complete, 25-Oct-2026)
Deno.test("notes: Take notes tells everyone and keeps each person's words only after they stay; the firm's members read them; the AI gets the title, names and words only", async () => {
  const s = stand({ aiAnswer: JSON.stringify({ summary: "They agreed the GST return for September.", points: ["GSTR-3B for September"], decisions: ["File GSTR-3B by 20th"], actions: [{ title: "Send purchase bills", who: "S2", due: "2026-10-30" }] }) });
  const a = await s.call({ action: "start", kind: "meeting", title: "Sharma Traders review" }, "tok-staff");
  const rid = a.j.room.id;
  const on = await s.call({ action: "rec_start", room_id: rid, notes: true }, "tok-staff");
  eq([on.status, on.j.notes, on.j.notice], [200, true, R.NOTES_TEXT], "Take notes: the notes' notice");
  eq(s.T.call_recordings.map((x) => x.mime), [R.NOTES_MIME], "kept as a recording of words only");
  const j2 = await s.call({ action: "join", room_id: rid }, "tok-staff2");
  eq([j2.j.recording.notes, j2.j.recording.notice], [true, R.NOTES_TEXT], "someone joining is told the notes are being taken");
  await s.call({ action: "caption", room_id: rid, audio: AUDIO, secs: 5, start_ms: 1000, targets: [] }, "tok-staff2");
  eq(s.T.call_captions.length, 0, "before choosing to stay: their words not kept");
  await s.call({ action: "consent", room_id: rid, recording_id: on.j.recording_id, event: "accepted" }, "tok-staff2");
  await s.call({ action: "caption", room_id: rid, audio: AUDIO, secs: 5, start_ms: 6000, targets: [] }, "tok-staff2");
  await s.call({ action: "caption", room_id: rid, audio: AUDIO, secs: 5, start_ms: 12000, targets: [] }, "tok-staff");
  eq(s.T.call_captions.map((x) => [x.who, x.start_ms]), [["S2", 6000], ["Riya", 12000]], "after staying (and the host's own): kept");
  const look = await s.call({ action: "notes_get", room_id: rid }, "tok-look");
  eq([look.status, look.j.lines.length, look.j.source, look.j.taking, look.j.can_edit, look.j.can_make], [200, 2, "captions", true, false, false], "a look-only member of the firm reads the words; cannot edit or make");
  eq(look.j.people.sort(), ["Riya", "S2"], "the people in it");
  eq((await s.call({ action: "notes_get", room_id: rid }, "tok-other")).status, 404, "another firm: not found");
  eq((await s.call({ action: "notes_make", room_id: rid }, "tok-look")).j.kind, "role", "look-only: cannot make the notes");
  const made = await s.call({ action: "notes_make", room_id: rid, lang: "en" }, "tok-staff2");
  eq([made.status, made.j.notes.points, made.j.notes.actions[0].who, made.j.notes.source], [200, ["GSTR-3B for September"], "S2", "captions"], "made: key points, decisions, action items with who and when");
  const sent = s.log.ai.at(-1)!, content = String(sent.messages[0].content);
  assert(content.startsWith("Call: Sharma Traders review\nPeople: ") && content.includes("Transcript:\n[00:06] S2: ") && sent.messages.length === 1, "only the title, the people and the words go to the model: " + content.slice(0, 120));
  assert(!content.includes("Client One") && !content.includes("Garg"), "nothing else of the firm");
  eq(s.T.call_transcripts.find((x) => x.room_id === rid)!.summary.summary, "They agreed the GST return for September.", "kept with the meeting");
  eq((await s.call({ action: "notes_save", room_id: rid, notes: { summary: "x" } }, "tok-staff2")).j.kind, "host", "only the host edits");
  const ed = await s.call({ action: "notes_save", room_id: rid, notes: { summary: "Edited by the host.", points: [" one ", ""], decisions: [], actions: [{ title: "Call the bank", who: "Riya", due: "30-10-2026" }] } }, "tok-staff");
  eq([ed.status, ed.j.notes.summary, ed.j.notes.points, ed.j.notes.actions[0].due, !!ed.j.notes.edited_at, ed.j.notes.edited_name], [200, "Edited by the host.", ["one"], "", true, "Riya"], "the host's edit, cleaned (a wrong date dropped)");
  eq((await s.call({ action: "notes_save", room_id: rid, notes: { summary: "" } }, "tok-staff")).status, 400, "empty notes refused");
  eq((await s.call({ action: "notes_make", room_id: rid }, "tok-staff2")).j.kind, "edited", "an edit is not replaced unless asked");
  eq((await s.call({ action: "notes_make", room_id: rid, replace: true }, "tok-staff")).status, 200, "asked: made again");
  // a recording asked while notes run takes their place (its own notice)
  const v = await s.call({ action: "rec_start", room_id: rid }, "tok-staff");
  eq([v.j.notes, v.j.notice, s.T.call_recordings.map((x) => [x.mime, !!x.ended_at])], [false, R.CONSENT_TEXT, [[R.NOTES_MIME, true], ["video/webm", false]]], "notes ended, the recording started");
  await s.call({ action: "end", room_id: rid }, "tok-staff");
  const recent = (await s.call({ action: "meetings" }, "tok-staff2")).j.recent.find((r: any) => r.id === rid);
  eq([recent.recording, recent.notes], [true, true], "Recent: the recording and the notes");
  const n2 = stand();
  const b = await n2.call({ action: "start", kind: "meeting" }, "tok-staff");
  eq((await n2.call({ action: "notes_make", room_id: b.j.room.id }, "tok-staff")).j.kind, "nolines", "nothing kept (no notes, no recording): no notes, said why");
  const n3 = stand();
  const c = await n3.call({ action: "start", kind: "meeting" }, "tok-staff");
  await n3.call({ action: "rec_start", room_id: c.j.room.id, notes: true }, "tok-staff");
  await n3.call({ action: "end", room_id: c.j.room.id }, "tok-staff");
  eq((await n3.call({ action: "meetings" }, "tok-staff")).j.recent[0].recording, false, "notes alone are not called a recording");
});
