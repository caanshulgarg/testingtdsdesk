// deno test server/security/functions/signin/handler_test.ts   (no network, no Supabase: the services are fakes)
import { BOT_FAILED, BOT_MISSING, type Deps, IP_BLOCKED, makeHandler, MAX_IP_FAILS, SWITCHED_OFF } from "./handler.ts";

function eq(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} ${x} !== ${y}`); }
function assert(c: unknown, msg = "assertion failed"): asserts c { if (!c) throw new Error(msg); }

const GOOD = "right-password-1";
// the shared table (migration 112) in memory: one store, any number of running copies of the function
function sharedStore() {
  const rows: { bucket: string; key: string; at: number }[] = [];
  let now = 0;
  return {
    rows, tick: (ms: number) => { now += ms; },
    count: async (bucket: string, key: string, w: number) => rows.filter((r) => r.bucket === bucket && r.key === key && r.at > now - w * 1000).length,
    add: async (bucket: string, key: string) => { rows.push({ bucket, key, at: now }); },
  };
}
function fake(opts: { captchaRequired?: boolean; store?: ReturnType<typeof sharedStore>; auth?: (e: string, p: string, c: string) => { status: number; body: any }; rateDown?: boolean } = {}) {
  const store = opts.store || sharedStore();
  const log = { auth: [] as { email: string; captcha: string }[], fails: [] as string[], cleared: [] as string[] };
  const fails = new Map<string, number>();
  const d: Deps = {
    cors: () => ({ "Access-Control-Allow-Origin": "*" }),
    captchaRequired: !!opts.captchaRequired,
    lockoutUntil: async () => null,
    lockoutClear: async (e) => { log.cleared.push(e); },
    lockoutFail: async (e) => { log.fails.push(e); const n = (fails.get(e) || 0) + 1; fails.set(e, n); return { fails: n, locked_until: n >= 5 ? "2026-10-26T12:00:00Z" : null }; },
    authToken: async (email, password, captcha) => {
      log.auth.push({ email, captcha });
      if (opts.auth) return opts.auth(email, password, captcha);
      return password === GOOD ? { status: 200, body: { access_token: "T", refresh_token: "R", user: { id: "u1", email } } }
        : { status: 400, body: { error_code: "invalid_credentials", msg: "Invalid login credentials" } };
    },
    rateCount: async (b, k, w) => { if (opts.rateDown) throw new Error("relation does not exist"); return store.count(b, k, w); },
    rateAdd: async (b, k) => { if (opts.rateDown) throw new Error("relation does not exist"); return store.add(b, k); },
  };
  return { handler: makeHandler(d), log, store };
}
const post = (body: unknown, ip = "203.0.113.7") => new Request("http://x/signin", { method: "POST", headers: { "Content-Type": "application/json", "x-forwarded-for": ip + ", 10.0.0.1" }, body: JSON.stringify(body) });
const read = async (r: Response) => ({ status: r.status, body: await r.json() });

Deno.test("a right password signs in, as before; no token needed while the bot check is off", async () => {
  const { handler, log } = fake();
  const r = await read(await handler(post({ email: " A@B.in ", password: GOOD })));
  eq(r.status, 200); eq(r.body.access_token, "T"); eq(log.auth, [{ email: "a@b.in", captcha: "" }]); eq(log.cleared, ["a@b.in"]);
});

Deno.test("the page's bot-check token is passed through to Supabase Auth", async () => {
  const { handler, log } = fake();
  eq((await handler(post({ email: "a@b.in", password: GOOD, captcha_token: "XXXX.turnstile-token" }))).status, 200);
  eq(log.auth[0].captcha, "XXXX.turnstile-token");
});

Deno.test("bot check required (CAPTCHA_REQUIRED=1): no token, refused here; Auth not asked; nothing counted", async () => {
  const { handler, log, store } = fake({ captchaRequired: true });
  const r = await read(await handler(post({ email: "a@b.in", password: "wrong-1" })));
  eq(r.status, 400); eq(r.body.reason, "captcha"); eq(r.body.error, BOT_MISSING);
  eq(log.auth.length, 0); eq(log.fails.length, 0); eq(store.rows.length, 0);
  eq((await handler(post({ email: "a@b.in", password: GOOD, captcha_token: "tok" }))).status, 200, "with a token: signed in");
});

Deno.test("Auth refusing the token (its bot protection on) is said so, and never counted as a wrong password", async () => {
  const { handler, log, store } = fake({ auth: () => ({ status: 400, body: { error_code: "captcha_failed", msg: "captcha protection: request disallowed (invalid captcha)" } }) });
  for (let i = 0; i < 7; i++) {
    const r = await read(await handler(post({ email: "a@b.in", password: "x", captcha_token: i ? "bad" : "" })));
    eq(r.status, 400); eq(r.body.error, i ? BOT_FAILED : BOT_MISSING);
  }
  eq(log.fails.length, 0, "no lockout failure"); eq(store.rows.length, 0, "no address failure");
});

Deno.test("wrong passwords: the per-email lockout as before (5 → locked)", async () => {
  const { handler } = fake();
  let r: any;
  for (let i = 0; i < 5; i++) r = await read(await handler(post({ email: "a@b.in", password: "wrong" })));
  eq(r.status, 423); assert(/Too many wrong passwords/.test(r.body.error));
});

Deno.test("failures per address are shared by every running copy: the 21st try from one address is refused, any email", async () => {
  const store = sharedStore();
  const one = fake({ store }), two = fake({ store });     // two copies of the function, one table
  for (let i = 0; i < MAX_IP_FAILS; i++) {
    const h = i % 2 ? one.handler : two.handler;
    eq((await h(post({ email: "victim" + i + "@b.in", password: "guess" }))).status, 400);
  }
  eq(store.rows.length, MAX_IP_FAILS);
  const r = await read(await one.handler(post({ email: "new@b.in", password: GOOD })));
  eq(r.status, 429); eq(r.body.error, IP_BLOCKED);
  eq(one.log.auth.length + two.log.auth.length, MAX_IP_FAILS, "Auth not asked once the address is over");
  eq((await two.handler(post({ email: "new@b.in", password: GOOD }, "198.51.100.9"))).status, 200, "another address: unaffected");
  store.tick(15 * 60 * 1000 + 1);
  eq((await one.handler(post({ email: "new@b.in", password: GOOD }))).status, 200, "after 15 minutes: allowed again");
  assert(store.rows.every((r) => /^[0-9a-f]{64}$/.test(r.key)), "the address kept only as a SHA-256");
});

Deno.test("the shared table not there yet (migration 112 not run): sign-in works as before", async () => {
  const { handler } = fake({ rateDown: true });
  eq((await handler(post({ email: "a@b.in", password: "wrong" }))).status, 400);
  eq((await handler(post({ email: "a@b.in", password: GOOD }))).status, 200);
});

Deno.test("bad requests", async () => {
  const { handler } = fake();
  eq((await handler(new Request("http://x/signin", { method: "GET" }))).status, 405);
  eq((await handler(new Request("http://x/signin", { method: "POST", body: "{" }))).status, 400);
  eq((await handler(post({ email: "a@b.in" }))).status, 400);
});

Deno.test("console phase 1b: a login FinCom switched off (banned in Auth) is said so, never counted as a wrong password", async () => {
  const { handler, log, store } = fake({ auth: () => ({ status: 400, body: { error_code: "user_banned", msg: "User is banned" } }) });
  const r = await read(await handler(post({ email: "a@b.in", password: GOOD })));
  eq(r.status, 403); eq(r.body.reason, "user_off"); eq(r.body.error, SWITCHED_OFF);
  eq(SWITCHED_OFF, "This account is switched off. Contact FinCom support.");
  eq(log.fails.length, 0, "no lockout failure"); eq(store.rows.length, 0, "no address failure");
});
