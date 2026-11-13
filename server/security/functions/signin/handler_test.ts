// deno test server/security/functions/signin/handler_test.ts   (no network, no Supabase: the services are fakes)
import { BOT_FAILED, BOT_MISSING, type Deps, IP_BLOCKED, makeHandler, MAX_IP_FAILS, SWITCHED_OFF } from "./handler.ts";
import { waitWords } from "./handler.ts";

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
// migration 183 in memory (auth_signin_begin / _fail / _ok): one email from one address; the same waits as the SQL
const WAITS = (n: number) => (n < 5 ? 0 : n === 5 ? 30 : n === 6 ? 60 : n === 7 ? 120 : n === 8 ? 300 : 900);
function attemptStore() {
  const fails: { pair: string; at: number }[] = [], passes = new Set<string>(), calls: string[] = [];
  let now = 1_000_000_000;
  const recent = (pair: string) => fails.filter((f) => f.pair === pair && f.at > now - 900_000);
  return {
    fails, passes, calls, tick: (ms: number) => { now += ms; },
    begin: async (email: string, ip: string) => {
      const pair = email + "|" + ip, list = recent(pair), w = WAITS(list.length), last = Math.max(0, ...list.map((f) => f.at));
      calls.push("begin");
      if (w > 0 && last + w * 1000 > now) return { allowed: false, fails: list.length, wait_s: Math.ceil((last + w * 1000 - now) / 1000), until: new Date(last + w * 1000).toISOString() };
      passes.add(pair); return { allowed: true, fails: list.length };
    },
    fail: async (email: string, ip: string) => {
      const pair = email + "|" + ip; passes.delete(pair); fails.push({ pair, at: now }); calls.push("fail");
      const n = recent(pair).length, w = WAITS(n);
      return { fails: n, wait_s: w, until: w ? new Date(now + w * 1000).toISOString() : null };
    },
    ok: async (email: string, ip: string) => { const pair = email + "|" + ip; passes.delete(pair); calls.push("ok"); for (let i = fails.length - 1; i >= 0; i--) if (fails[i].pair === pair) fails.splice(i, 1); },
  };
}
function fake(opts: { captchaRequired?: boolean; store?: ReturnType<typeof sharedStore>; auth?: (e: string, p: string, c: string) => { status: number; body: any }; rateDown?: boolean;
  attempts?: ReturnType<typeof attemptStore>; attemptsDown?: boolean } = {}) {
  const store = opts.store || sharedStore();
  const att = opts.attempts || attemptStore();
  const down = () => { if (opts.attemptsDown) throw new Error("function public.auth_signin_begin does not exist"); };
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
    signinBegin: async (e, k) => { down(); return att.begin(e, k); },
    signinFail: async (e, k) => { down(); return att.fail(e, k); },
    signinOk: async (e, k) => { down(); return att.ok(e, k); },
  };
  return { handler: makeHandler(d), log, store, att };
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

Deno.test("migration 183 not run yet: wrong passwords are counted as before (5 → locked)", async () => {
  const { handler } = fake({ attemptsDown: true });
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

// ---------- 13-Nov-2026 (security review, M4): the wait is the address's own, grows, and ends by itself ----------
Deno.test("M4: four wrong passwords cost nothing; from the 5th the address waits for that email (30 s, 1, 2, 5, 15 minutes at most)", async () => {
  const { handler, log, att } = fake();
  let r: any;
  for (let i = 0; i < 4; i++) { r = await read(await handler(post({ email: "a@b.in", password: "wrong" }))); eq(r.status, 400, "try " + (i + 1)); }
  eq(r.body.error, "Wrong email or password. After 1 more wrong password this network must wait before trying this email again.");
  const waits: number[] = [];
  for (let i = 0; i < 5; i++) {
    r = await read(await handler(post({ email: "a@b.in", password: "wrong" })));
    eq([r.status, r.body.ok, r.body.reason], [423, false, "wait"], "wrong password " + (5 + i));
    assert(typeof r.body.locked_until === "string" && r.body.error === "Too many wrong passwords. Try again in " + waitWords(r.body.retry_after_s) + ", or ask the firm's owner to unlock you.", r.body.error);
    waits.push(r.body.retry_after_s);
    att.tick(r.body.retry_after_s * 1000 + 1);
  }
  eq(waits.slice(0, 5), [30, 60, 120, 300, 900]); assert(waits.every((w) => w <= 900), "never more than 15 minutes");
  eq(log.fails.length, 0, "the account-wide lock of before is not set by anyone's wrong passwords");
  eq(waitWords(30), "30 seconds"); eq(waitWords(60), "1 minute"); eq(waitWords(61), "2 minutes"); eq(waitWords(900), "15 minutes");
});

Deno.test("M4: a try during the wait is refused before Auth is asked, and is not counted (the wait is not made longer)", async () => {
  const { handler, log, att, store } = fake();
  for (let i = 0; i < 5; i++) await handler(post({ email: "a@b.in", password: "wrong" }));
  const asked = log.auth.length, counted = att.fails.length, ipRows = store.rows.length;
  att.tick(10_000);
  for (const pw of ["wrong", GOOD]) {
    const r = await read(await handler(post({ email: "a@b.in", password: pw })));
    eq([r.status, r.body.reason, r.body.retry_after_s], [423, "wait", 20]);
  }
  eq([log.auth.length, att.fails.length, store.rows.length], [asked, counted, ipRows]);
  att.tick(20_001);
  eq((await handler(post({ email: "a@b.in", password: GOOD }))).status, 200, "the wait over: the right password signs in");
});

Deno.test("M4: wrong passwords from one address do not keep the person out: the right password from another address signs in at once", async () => {
  const { handler, att } = fake();
  for (let i = 0; i < 12; i++) await handler(post({ email: "owner@firm.in", password: "guess" + i }, "198.51.100.66"));
  eq((await handler(post({ email: "owner@firm.in", password: "guess" }, "198.51.100.66"))).status, 423, "the guessing address waits");
  const r = await read(await handler(post({ email: " Owner@Firm.in ", password: GOOD })));
  eq(r.status, 200); eq(r.body.access_token, "T");
});

Deno.test("M4: each try is announced before Auth is asked and closed after it (the pass of migration 183); a right password ends the pair's count", async () => {
  const { handler, att } = fake();
  await handler(post({ email: "a@b.in", password: "wrong" }));
  eq(att.calls, ["begin", "fail"]); eq(att.passes.size, 0, "a wrong password leaves no pass");
  await handler(post({ email: "a@b.in", password: GOOD }));
  eq(att.calls, ["begin", "fail", "begin", "ok"]); eq(att.passes.size, 0); eq(att.fails.length, 0, "the count ends with a right password");
});

Deno.test("M4: the address is sent to the database only as a SHA-256, and differs from the per-address count's key", async () => {
  const seen: string[] = [];
  const att = attemptStore();
  const f = fake({ attempts: { ...att, begin: async (e: string, k: string) => { seen.push(k); return att.begin(e, k); } } as any });
  await f.handler(post({ email: "a@b.in", password: "wrong" }));
  assert(/^[0-9a-f]{64}$/.test(seen[0]), seen[0]); assert(!f.store.rows.some((r) => r.key === seen[0]), "its own key");
});

Deno.test("M4: Auth's own refusal of a right password (the account's count, from its hook) is passed on in plain words, not counted", async () => {
  const { handler, att, store } = fake({ auth: () => ({ status: 403, body: { code: 403, error_code: "hook_reject", msg: "Too many wrong passwords for this account. Sign in from FinCom's own sign-in page, or try again in 15 minutes." } }) });
  const r = await read(await handler(post({ email: "a@b.in", password: GOOD })));
  eq(r.status, 403); assert(/Too many wrong passwords/.test(r.body.error));
  eq(att.fails.length, 0); eq(store.rows.length, 0);
});
