// node tests/run_call_private_channel.mjs - the calls' small Realtime client (app/src/calls/realtime.js) on a private
// channel (the database review of 13-Nov-2026, M5; migration 186), against a made-up WebSocket that keeps every frame:
//   1. a public channel joins as before: private false, no sign-in sent, nothing asked of getToken
//   2. a private channel asks for the sign-in first and joins with private true and that sign-in
//   3. the sign-in is asked again every few minutes and sent on (an access_token frame) only when it changed
//   4. a private channel refused closes the line and tries again with a new sign-in, five times at most; a public one
//      refused stays as it was
//   5. the line dropped: joined again with the newest sign-in; close() stops the asking
//   6. the app's parts pass what fincom-call says: the call screen, working together and the lobby listener (read from
//      their source), and the function gives private wherever it gives a channel's name
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const tick = () => new Promise((r) => setImmediate(r));

// the stand: a WebSocket that opens at once and keeps what is sent; timers kept by hand
const socks = [];
class FakeWS {
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; socks.push(this); setImmediate(() => { if (this.readyState === 0) { this.readyState = 1; this.onopen && this.onopen(); } }); }
  send(s) { this.sent.push(JSON.parse(s)); }
  close(code, why) { if (this.readyState === 3) return; this.readyState = 3; this.closed = [code, why]; setImmediate(() => this.onclose && this.onclose()); }
  reply(status) { const j = this.sent.find((m) => m.event === "phx_join"); this.onmessage({ data: JSON.stringify({ topic: j.topic, event: "phx_reply", ref: j.ref, payload: { status } }) }); }
}
globalThis.WebSocket = FakeWS;
const intervals = [], timeouts = [];
const realSetInterval = globalThis.setInterval, realSetTimeout = globalThis.setTimeout;
globalThis.setInterval = (f, ms) => { const t = { f, ms, on: true }; intervals.push(t); return t; };
globalThis.clearInterval = (t) => { if (t && typeof t === "object" && "on" in t) t.on = false; };
globalThis.setTimeout = (f, ms) => { const t = { f, ms, on: true }; timeouts.push(t); return t; };
globalThis.clearTimeout = (t) => { if (t && typeof t === "object" && "on" in t) t.on = false; };
const runTimeouts = async () => { const due = timeouts.splice(0).filter((t) => t.on); for (const t of due) t.f(); await tick(); await tick(); };
const every = (ms) => intervals.filter((t) => t.on && t.ms === ms);

const { channel, TOKEN_EVERY_MS } = await import(path.join(ROOT, "app", "src", "calls", "realtime.js"));
const join = (ws) => ws.sent.find((m) => m.event === "phx_join");

console.log("== 1. a public channel");
let asked = 0;
let ch = channel({ url: "https://stand.test", key: "public-key", topic: "call:abc", presenceKey: "p1" });
await tick(); await tick();
let ws = socks.at(-1), j = join(ws);
ok(ws.url === "wss://stand.test/realtime/v1/websocket?apikey=public-key&vsn=1.0.0" && j.topic === "realtime:call:abc", "the same address and channel name as before");
ok(j.payload.config.private === false && !("access_token" in j.payload) && j.payload.config.presence.key === "p1", "joined public, no sign-in sent");
ok(every(TOKEN_EVERY_MS).length === 0, "nothing asked again later");
ws.reply("error"); await tick();
ok(ws.readyState === 1 && !ws.closed, "refused: left as it was (as before)");
ch.close();

console.log("== 2. a private channel");
let token = "sign-in-1";
const states = [];
ch = channel({ url: "https://stand.test", key: "public-key", topic: "call:def", presenceKey: "p1", private: true, getToken: async () => { asked++; await tick(); return token; }, onStatus: (s) => states.push(s) });
await tick();
ws = socks.at(-1);
ok(!join(ws) && asked === 1, "the sign-in is asked for before joining");
await tick(); await tick(); await tick();
j = join(ws);
ok(j && j.payload.config.private === true && j.payload.access_token === "sign-in-1", "joined private with the sign-in");
ch.send("rtc", { x: 1 });
ok(!ws.sent.some((m) => m.event === "broadcast"), "nothing is said before the join is answered");
ws.reply("ok"); await tick();
ok(ch.joined && states.at(-1) === "joined" && ws.sent.filter((m) => m.event === "broadcast").length === 1, "answered: joined, and what waited is sent");

console.log("== 3. the sign-in kept fresh");
const again = every(TOKEN_EVERY_MS);
ok(again.length === 1 && TOKEN_EVERY_MS === 4 * 60 * 1000, "asked again every 4 minutes");
await again[0].f(); await tick();
ok(!ws.sent.some((m) => m.event === "access_token"), "the same sign-in: nothing sent");
token = "sign-in-2";
await again[0].f(); await tick();
const at = ws.sent.filter((m) => m.event === "access_token");
ok(at.length === 1 && at[0].topic === "realtime:call:def" && at[0].payload.access_token === "sign-in-2" && at[0].join_ref === j.ref, "a new one: sent on the channel once");

console.log("== 4. refused");
const s0 = socks.length;
ws.onmessage({ data: JSON.stringify({ topic: "realtime:call:def", event: "phx_close", payload: {} }) }); await tick(); await tick();
ok(ws.readyState === 3 && states.at(-1) === "reconnecting", "the channel closed by the server: the line is dropped and opened again");
let n = 0;
for (let i = 0; i < 8; i++) {
  token = "sign-in-r" + i;
  await runTimeouts(); await tick(); await tick(); await tick(); await tick();
  const w = socks.at(-1);
  if (w.readyState !== 1 || !join(w) || w.refusedOnce) break;
  n++; w.refusedOnce = true;
  if (join(w).payload.access_token !== token) { ok(false, "try " + n + " used the newest sign-in"); break; }
  w.reply("error"); await tick(); await tick();
}
ok(n === 6 && socks.length === s0 + 6, "refused: five more tries, each with a new sign-in, then it stays refused (" + n + " joins)");
ok(states.at(-1) === "refused" && socks.at(-1).readyState === 1, "and says so");
ch.close();

console.log("== 5. the line dropped; closed");
token = "sign-in-a";
ch = channel({ url: "https://stand.test", key: "public-key", topic: "lobby:xyz", presenceKey: "", private: true, getToken: async () => token });
await tick(); await tick(); await tick();
ws = socks.at(-1); ws.reply("ok"); await tick();
token = "sign-in-b";
ws.close(1006, "dropped"); await tick(); await tick();
await runTimeouts(); await tick(); await tick(); await tick();
const ws2 = socks.at(-1);
ok(ws2 !== ws && join(ws2) && join(ws2).payload.access_token === "sign-in-b" && join(ws2).payload.config.private === true, "joined again, private, with the newest sign-in");
const t5 = every(TOKEN_EVERY_MS).length;
ch.close();
ok(t5 === 1 && every(TOKEN_EVERY_MS).length === 0, "close() stops the asking");

console.log("== 6. the app's parts and the function");
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const cs = src("app/src/calls/CallScreen.jsx"), cw = src("app/src/calls/cowork.js"), kn = src("app/src/calls/knock.jsx"), api = src("app/src/calls/api.js"), h = src("server/video-calls/handler.ts");
ok(/private: !!t\.private, getToken: t\.private \? \(guest \? guestPass : memberToken\) : null/.test(cs) && !/openChannel\(\w+\.topic\)/.test(cs) && (cs.match(/openChannel\(/g) || []).length === 4,
   "the call screen: private as fincom-call says, a member's sign-in or a guest's pass; every place that opens a channel passes the whole answer");
ok((cs.match(/private: !!j\.private, getToken: memberToken/g) || []).length === 2 && /private: !!priv, getToken: priv \? getToken : null/.test(cw), "working together: the same, members only");
ok(/private: !!priv, getToken: priv \? memberToken : null/.test(kn) && /listen\(j\.topic, j\.private\)/.test(kn), "the lobby listener: the same, and joined again when private changes");
ok(/export async function memberToken\(\)/.test(api) && /Cloud\.fresh\(\)/.test(api.split("memberToken")[1]), "a member's sign-in is refreshed first (Cloud.fresh)");
const topics = (h.match(/topic: [^,}]*(topicFor|lobbyTopic)\([^)]*\)[^,}]*/g) || []);
const lines = h.split("\n").filter((l) => /topic: (on \? )?await (R\.topicFor|lobbyTopic)\(/.test(l));
ok(lines.length === 8 && lines.every((l) => /private: PRIVATE/.test(l)) && !/private: false/.test(h), "fincom-call: all " + lines.length + " places that give a channel's name say private (" + topics.length + " names)");
ok(/const CHAN_SECRET = String\(env\("CALLS_CHANNEL_JWT_SECRET"\) \|\| ""\), PRIVATE = CHAN_SECRET\.length >= 32;/.test(h), "private only once the function holds a secret of 32 characters or more");

globalThis.setInterval = realSetInterval; globalThis.setTimeout = realSetTimeout;
console.log(fails ? "\nFAILED: " + fails : "\nall passed");
process.exit(fails ? 1 : 0);
