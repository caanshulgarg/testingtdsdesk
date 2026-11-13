// deno test server/support-mail/handler_test.ts   (no network, no Supabase: the services are fakes)
import { type Deps, makeHandler } from "./handler.ts";

function eq(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} ${x} !== ${y}`); }
function assert(c: unknown, msg = "assertion failed"): asserts c { if (!c) throw new Error(msg); }

const TICKET = (o: any = {}) => ({ id: "t-1", code: "TD-0007", subject: "Bill not read", module: "TDS", priority: "high", status: "open", firm_name: "Made-up & Co", created_name: "Asha", created_email: "asha@firm.test",
  thread: [{ id: "m-1", body: "The bill of 3 March is not read.", author_name: "Asha", from_support: false, internal: false, at: "2026-11-13T05:00:00Z" }], ...o });
function fake(o: { mfa?: boolean | "down"; ticket?: any; ticketError?: string; setUp?: boolean; resend?: { ok: boolean; status: number; message?: string }; rate?: { bucket: string; key: string }[]; rateDown?: boolean } = {}) {
  const log = { sent: [] as any[], asked: [] as string[] };
  const rate = o.rate || [];
  const down = () => { if (o.rateDown) throw new Error("relation public.auth_rate_hits does not exist"); };
  const d: Deps = {
    cors: { "Access-Control-Allow-Origin": "*" },
    key: o.setUp === false ? "" : "re_test", to: "support@fincom.test, second@fincom.test", from: "FinCom Support <support@fincom.test>", app: "https://app.fincom.live/",
    mfaOk: async (jwt) => { if (o.mfa === "down") throw new Error("no function mfa_ok"); return jwt === "tok-member" && o.mfa !== false; },
    ticket: async (jwt, id) => { log.asked.push(jwt + " " + id); return o.ticketError ? { t: null, error: o.ticketError } : { t: "ticket" in o ? o.ticket : TICKET(), error: null }; },
    send: async (m) => { log.sent.push(m); return o.resend || { ok: true, status: 200 }; },
    // the shared counts of migration 112, in memory
    count: async (bucket, key) => { down(); return rate.filter((r) => r.bucket === bucket && r.key === key).length; },
    add: async (bucket, key) => { down(); rate.push({ bucket, key }); },
    hit: async (bucket, key, max) => { down(); if (rate.filter((r) => r.bucket === bucket && r.key === key).length >= max) return false; rate.push({ bucket, key }); return true; },
  };
  return { handler: makeHandler(d), log, rate };
}
const post = (body: unknown, jwt = "tok-member") => new Request("http://x/support-mail", { method: "POST", headers: { "Content-Type": "application/json", ...(jwt ? { Authorization: "Bearer " + jwt } : {}) }, body: JSON.stringify(body) });
const read = async (r: Response) => ({ status: r.status, body: await r.json() });

Deno.test("a new ticket is emailed to support, with the person's address to reply to; support's reply goes to the person", async () => {
  const a = fake();
  const r = await read(await a.handler(post({ ticket: "t-1", event: "new" })));
  eq(r, { status: 200, body: { ok: true, sent: true, to: "support" } });
  eq([a.log.sent[0].to, a.log.sent[0].reply_to, a.log.sent[0].subject], [["support@fincom.test", "second@fincom.test"], "asha@firm.test", "New ticket TD-0007 · Bill not read"]);
  const t = TICKET(); t.thread.push({ id: "m-2", body: "Please upload it again.", author_name: "FinCom", from_support: true, internal: false, at: "2026-11-13T06:00:00Z" });
  const b = fake({ ticket: t });
  eq((await read(await b.handler(post({ ticket: "t-1" })))).body, { ok: true, sent: true, to: "raiser" });
  eq([b.log.sent[0].to, b.log.sent[0].subject], [["asha@firm.test"], "Support replied: TD-0007 · Bill not read"]);
  t.thread.push({ id: "m-3", body: "note to self", from_support: true, internal: true });
  const c = fake({ ticket: t });
  eq((await read(await c.handler(post({ ticket: "t-1" })))).body.sent, false, "an internal note is emailed to nobody");
  eq(c.log.sent.length, 0);
});

Deno.test("method, sign-in and set-up checks, as before", async () => {
  const a = fake();
  eq((await a.handler(new Request("http://x/", { method: "GET" }))).status, 405);
  eq((await a.handler(new Request("http://x/", { method: "OPTIONS" }))).status, 200);
  eq((await a.handler(post({ ticket: "t-1" }, ""))).status, 401);
  eq((await a.handler(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer tok-member" }, body: "{" }))).status, 400);
  const off = fake({ setUp: false });
  const r = await read(await off.handler(post({ ticket: "t-1" })));
  eq([r.status, r.body.ok, r.body.sent], [200, true, false]); eq(off.log.sent.length, 0);
  const none = fake({ ticket: null });
  eq((await none.handler(post({ ticket: "t-9" }))).status, 403, "a ticket the person cannot see");
});

// ---------- 13-Nov-2026 (security review, L1): two-step sign-in ----------
Deno.test("L1: the two-step sign-in must be finished: a password-only session reads no ticket and sends nothing", async () => {
  for (const mfa of [false, "down"] as const) {
    const a = fake({ mfa });
    const r = await read(await a.handler(post({ ticket: "t-1", event: "new" })));
    eq([r.status, r.body.ok, r.body.reason, r.body.error], [403, false, "mfa", "Finish the two-step sign-in first."], String(mfa));
    eq([a.log.asked.length, a.log.sent.length], [0, 0], "no ticket read, no email");
  }
});

// ---------- 13-Nov-2026 (security review, L3) ----------
Deno.test("L3: the database's and the email service's own words are not passed on to the caller", async () => {
  const a = fake({ ticketError: 'permission denied for function support_get' });
  const r = await read(await a.handler(post({ ticket: "t-1" })));
  eq(r.status, 403); assert(!/permission|support_get/.test(JSON.stringify(r.body)) && /give support this number: [0-9a-f]{8}$/.test(r.body.error), r.body.error);
  const b = fake({ resend: { ok: false, status: 422, message: "The fincom.test domain is not verified (https://resend.example/domains)" } });
  const x = await read(await b.handler(post({ ticket: "t-1" })));
  eq([x.status, x.body.ok, x.body.sent], [200, false, false]); assert(!/domain|https?:|resend/i.test(JSON.stringify(x.body)), JSON.stringify(x.body));
});

// ---------- 13-Nov-2026 (security review, L9) ----------
import { TICKET_DAY_MAX } from "./handler.ts";
Deno.test("L9: a message is emailed once: asking again for the same message sends nothing; the next message is emailed", async () => {
  const rate: { bucket: string; key: string }[] = [];
  const a = fake({ rate });
  eq((await read(await a.handler(post({ ticket: "t-1", event: "new" })))).body.sent, true, "the first time");
  for (let i = 0; i < 5; i++) {
    const r = await read(await fake({ rate }).handler(post({ ticket: "t-1", event: "new" })));   // another running copy, the same table
    eq([r.status, r.body.ok, r.body.sent, r.body.reason], [200, true, false, "already sent"], "again " + i);
  }
  eq(a.log.sent.length, 1, "one email");
  assert(rate.every((r) => /^[0-9a-f]{64}$/.test(r.key)), "kept as hashes: no ticket id or address");
  const t = TICKET(); t.thread.push({ id: "m-2", body: "Please upload it again.", author_name: "FinCom", from_support: true, internal: false, at: "2026-11-13T06:00:00Z" });
  const b = fake({ rate, ticket: t });
  eq((await read(await b.handler(post({ ticket: "t-1" })))).body, { ok: true, sent: true, to: "raiser" }, "the reply is a new message");
  eq((await read(await b.handler(post({ ticket: "t-1" })))).body.sent, false, "and is emailed once");
});

Deno.test("L9: an email that did not go is not marked as sent; a ticket's emails in a day are limited; without the count nothing is sent", async () => {
  const rate: { bucket: string; key: string }[] = [];
  const bad = fake({ rate, resend: { ok: false, status: 500 } });
  eq((await read(await bad.handler(post({ ticket: "t-1" })))).body.sent, false);
  const good = fake({ rate });
  eq((await read(await good.handler(post({ ticket: "t-1" })))).body.sent, true, "the next try sends it");
  // many messages on one ticket in a day
  const many: { bucket: string; key: string }[] = [];
  let sent = 0;
  for (let i = 0; i < TICKET_DAY_MAX + 3; i++) {
    const t = TICKET(); for (let k = 0; k <= i; k++) t.thread.push({ id: "x-" + k, body: "more", from_support: false, internal: false, at: "2026-11-13T07:00:" + String(k).padStart(2, "0") + "Z" });
    const f = fake({ rate: many, ticket: t });
    if ((await read(await f.handler(post({ ticket: "t-1" })))).body.sent) sent++;
  }
  eq(sent, TICKET_DAY_MAX, "the day's count for one ticket");
  const down = fake({ rateDown: true });
  const r = await read(await down.handler(post({ ticket: "t-1" })));
  eq([r.status, r.body.ok, r.body.sent], [200, true, false], "the ticket is unaffected"); eq(down.log.sent.length, 0, "nothing sent");
});
