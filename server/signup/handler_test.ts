// deno test server/signup/handler_test.ts   (no network, no Supabase: the services are fakes)
import { type Deps, JITTER_MS, makeHandler, MIN_MS, NEUTRAL, RateLimiter, TOO_MANY } from "./handler.ts";

function assert(c: unknown, msg = "assertion failed"): asserts c { if (!c) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} ${x} !== ${y}`); }

const ADMIN_JWT = "admin-token", OTHER_JWT = "someone-else";
const EXISTING = "owner@firm.test", INVITED = "new.staff@firm.test";

function fake(over: Partial<Deps> = {}) {
  let clock = 1_000_000;
  const log = { created: [] as any[], links: [] as string[], slept: 0, bg: [] as Promise<unknown>[] };
  const d: Deps = {
    platformAdmin: async (jwt) => (jwt === ADMIN_JWT ? { userId: "admin-1" } : null),
    // EXISTING has a login that has been used; INVITED was invited and never signed in
    invitePending: async (email) => email === INVITED,
    sendSetPasswordLink: async (email) => { log.links.push(email); },
    createFirm: async (_by, f) => { log.created.push(f); return { status: 200, body: { ok: true, firm_id: "f1", email: f.email } }; },
    background: (p) => { log.bg.push(p); },
    sleep: async (ms) => { log.slept += ms; clock += ms; },
    now: () => clock,
    random: () => 0.5,
    limits: { ip: new RateLimiter(10, 600_000, () => clock), email: new RateLimiter(5, 3_600_000, () => clock), link: new RateLimiter(1, 900_000, () => clock) },
    ...over,
  };
  return { d, log, handler: makeHandler(d), tick: (ms: number) => { clock += ms; } };
}

const post = (body: unknown, opts: { jwt?: string; ip?: string } = {}) =>
  new Request("https://x.test/functions/v1/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": opts.ip || "203.0.113.7", ...(opts.jwt ? { Authorization: "Bearer " + opts.jwt } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const form = (email: string) => ({ firm: "Some Firm", name: "A Person", email, password: "a-long-password-1" });
const read = async (r: Response) => ({ status: r.status, body: await r.json() });

Deno.test("a new email gets the neutral message and nothing is made", async () => {
  const { handler, log } = fake();
  const r = await read(await handler(post(form("nobody@example.test"))));
  eq(r, { status: 403, body: { ok: false, reason: "invite_only", error: NEUTRAL } });
  eq(log.created.length, 0); eq(log.links.length, 0);
});

Deno.test("existing, invited and new emails get byte-identical answers (no account enumeration)", async () => {
  const outs: string[] = [];
  for (const email of ["nobody@example.test", EXISTING, INVITED, "NOT AN EMAIL", ""]) {
    const { handler } = fake();
    const r = await handler(post(form(email)));
    outs.push(r.status + " " + await r.text() + " " + JSON.stringify([...r.headers]));
  }
  assert(outs.every((o) => o === outs[0]), "answers differ:\n" + outs.join("\n"));
});

Deno.test("every public answer waits for the time floor, however fast the lookups were", async () => {
  for (const email of ["nobody@example.test", EXISTING, INVITED]) {
    const { handler, log } = fake();
    await handler(post(form(email)));
    eq(log.slept, MIN_MS + Math.floor(0.5 * JITTER_MS), email);
  }
  // a slow lookup is not padded further (the floor is a minimum, from the start of the request)
  const slow = fake();
  const s = makeHandler({ ...slow.d, invitePending: async () => { slow.tick(MIN_MS + 500); return false; } });
  await s(post(form(EXISTING)));
  eq(slow.log.slept, 0);
});

Deno.test("an invited email that never signed in gets a set-password link, sent after the answer; at most one per window", async () => {
  const { handler, log } = fake();
  await read(await handler(post(form(INVITED))));
  await Promise.all(log.bg);
  eq(log.links, [INVITED]);
  await read(await handler(post(form(INVITED))));
  await Promise.all(log.bg);
  eq(log.links, [INVITED], "second link inside 15 minutes");
  eq(log.created.length, 0, "an invite never makes a firm here");
});

Deno.test("an existing (used) login gets no email and no firm", async () => {
  const { handler, log } = fake();
  await handler(post(form(EXISTING)));
  await Promise.all(log.bg);
  eq(log.links.length, 0); eq(log.created.length, 0);
});

Deno.test("self-service never creates a firm or trial credit, even with a firm name and credit in the body", async () => {
  const { handler, log } = fake();
  const r = await read(await handler(post({ ...form("x@example.test"), credit: 5000, plan: "Gold" })));
  eq(r.status, 403); eq(log.created.length, 0);
});

Deno.test("a signed-in non-administrator is treated as anyone else", async () => {
  const { handler, log } = fake();
  const r = await read(await handler(post(form("x@example.test"), { jwt: OTHER_JWT })));
  eq(r.body.error, NEUTRAL); eq(log.created.length, 0);
});

Deno.test("the platform administrator can create a firm (credit only as given, default 0)", async () => {
  const { handler, log } = fake();
  const r = await read(await handler(post({ firm: "Admin Made", name: "Owner", email: " Owner@New.test ", password: "" }, { jwt: ADMIN_JWT })));
  eq(r, { status: 200, body: { ok: true, firm_id: "f1", email: "owner@new.test" } });
  eq(log.created[0].credit, 0); eq(log.created[0].email, "owner@new.test");
  await handler(post({ firm: "Admin Made 2", email: "o2@new.test", credit: 300 }, { jwt: ADMIN_JWT }));
  eq(log.created[1].credit, 300);
});

Deno.test("the administrator's path checks its inputs", async () => {
  const { handler, log } = fake();
  eq((await handler(post({ firm: "F", email: "bad" }, { jwt: ADMIN_JWT }))).status, 400);
  eq((await handler(post({ firm: "x", email: "a@b.test" }, { jwt: ADMIN_JWT }))).status, 400);
  eq((await handler(post({ firm: "Firm", email: "a@b.test", password: "short" }, { jwt: ADMIN_JWT }))).status, 400);
  eq(log.created.length, 0);
});

Deno.test("an administrator check that throws falls back to the neutral answer", async () => {
  const { d, log } = fake();
  const h = makeHandler({ ...d, platformAdmin: async () => { throw new Error("auth down"); } });
  eq((await read(await h(post(form("x@example.test"), { jwt: ADMIN_JWT })))).body.error, NEUTRAL);
  eq(log.created.length, 0);
});

Deno.test("rate limit by address: the 11th try in 10 minutes is refused, for any email", async () => {
  const { handler, tick } = fake();
  for (let i = 0; i < 10; i++) eq((await handler(post(form(`n${i}@example.test`)))).status, 403);
  const r = await read(await handler(post(form(EXISTING))));
  eq(r, { status: 429, body: { ok: false, reason: "rate_limited", error: TOO_MANY } });
  eq((await handler(post(form("z@example.test"), { ip: "198.51.100.1" }))).status, 403, "another address");
  tick(10 * 60_000 + 1);
  eq((await handler(post(form("z@example.test")))).status, 403, "after the window");
});

Deno.test("rate limit by email: the 6th try in an hour is refused, from any address", async () => {
  const { handler } = fake();
  for (let i = 0; i < 5; i++) eq((await handler(post(form(INVITED), { ip: `192.0.2.${i}` }))).status, 403);
  eq((await handler(post(form(INVITED), { ip: "192.0.2.99" }))).status, 429);
});

Deno.test("method and body checks", async () => {
  const { handler } = fake();
  eq((await handler(new Request("https://x.test/", { method: "OPTIONS" }))).status, 200);
  eq((await handler(new Request("https://x.test/", { method: "GET" }))).status, 405);
  eq((await handler(post("{not json"))).status, 400);
});
