// deno test server/signup/handler_test.ts   (no network, no Supabase: the services are fakes)
import {
  type AuthUser, CHECK_EMAIL, type Db, type Deps, JITTER_MS, makeHandler, MIN_MS, NEUTRAL, ownFirmId, RateLimiter,
  SIGNUP_CREDIT, TOO_MANY,
} from "./handler.ts";

function assert(c: unknown, msg = "assertion failed"): asserts c { if (!c) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} ${x} !== ${y}`); }

const ADMIN_JWT = "admin-token", OTHER_JWT = "someone-else";
const EXISTING = "owner@firm.test", INVITED = "new.staff@firm.test";

// the firm account in memory: the same unique keys as the real tables (firms.id, members.user_id)
function memDb(now: () => number) {
  const t = {
    firms: new Map<string, { id: string; name: string; balance: number; note: string; createdAt: number }>(),
    members: new Map<string, { user_id: string; firm_id: string; name: string; email: string; role: string; active: boolean }>(),
    credits: [] as { firm_id: string; amount: number; by: string }[],
    marks: new Map<string, string>(),
    admins: new Set<string>(["admin-1"]),
    after: [] as string[],
    failCredit: 0,                       // the next n credit writes fail (a crash part-way)
  };
  // every call gives way once, as a network round trip does, so calls made together interleave
  const hop = () => new Promise((r) => setTimeout(r, 0));
  const db: Db = {
    memberOf: async (uid) => { await hop(); return t.members.get(uid)?.firm_id ?? null; },
    memberEmailElsewhere: async (email, uid) => { await hop(); return [...t.members.values()].some((m) => m.email === email && m.user_id !== uid); },
    isPlatformAdmin: async (uid) => { await hop(); return t.admins.has(uid); },
    firm: async (id) => { await hop(); const f = t.firms.get(id); return f ? { createdAt: f.createdAt } : null; },
    insertFirm: async (row) => { await hop(); if (t.firms.has(row.id)) return false; t.firms.set(row.id, { ...row, createdAt: now() }); return true; },
    deleteFirm: async (id) => { await hop(); t.firms.delete(id); },
    insertMember: async (row) => { await hop(); if (t.members.has(row.user_id)) return false; t.members.set(row.user_id, { ...row }); return true; },
    hasOpeningCredit: async (firmId) => { await hop(); return t.credits.some((c) => c.firm_id === firmId); },
    insertOpeningCredit: async (firmId, amount, by) => { await hop(); if (t.failCredit > 0) { t.failCredit--; throw new Error("network"); } t.credits.push({ firm_id: firmId, amount, by }); },
    afterCreate: async (firmId) => { await hop(); t.after.push(firmId); },
    markUser: async (u, firmId) => { await hop(); t.marks.set(u.id, firmId); },
  };
  return { t, db };
}

// the signed-in people of the provision tests, by token
const people: Record<string, AuthUser> = {
  "tok-new": { id: "u-new", email: "asha@new.test", confirmed: true, name: "Asha Rao", firm: "Rao & Co", provider: "email", signupFirm: null },
  "tok-unconf": { id: "u-unconf", email: "late@new.test", confirmed: false, name: "Late", firm: "Late & Co", provider: "email", signupFirm: null },
  "tok-google": { id: "u-g", email: "ravi@gmail.test", confirmed: true, name: "Ravi Kumar", firm: "", provider: "google", signupFirm: null },
  "tok-azure-noname": { id: "u-az", email: "meera@outlook.test", confirmed: true, name: "", firm: "", provider: "azure", signupFirm: null },
  "tok-invited": { id: "u-inv", email: INVITED, confirmed: true, name: "New Staff", firm: "", provider: "google", signupFirm: null },
  "tok-invited-other-login": { id: "u-inv-2", email: INVITED, confirmed: true, name: "New Staff", firm: "", provider: "azure", signupFirm: null },
  "tok-admin": { id: "admin-1", email: "admin@fincom.test", confirmed: true, name: "Admin", firm: "", provider: "email", signupFirm: null },
};

function fake(over: Partial<Deps> = {}) {
  let clock = 1_000_000;
  const log = { created: [] as any[], links: [] as string[], signups: [] as any[], slept: 0, bg: [] as Promise<unknown>[] };
  const mem = memDb(() => clock);
  // INVITED has an active member row in firm-x whose login (u-inv) was never used
  mem.t.firms.set("firm-x", { id: "firm-x", name: "X & Co", balance: 0, note: "", createdAt: 0 });
  mem.t.members.set("u-inv", { user_id: "u-inv", firm_id: "firm-x", name: "New Staff", email: INVITED, role: "staff", active: true });
  const d: Deps = {
    platformAdmin: async (jwt) => (jwt === ADMIN_JWT ? { userId: "admin-1" } : null),
    // EXISTING has a login that has been used; INVITED was invited and never signed in
    invitePending: async (email) => email === INVITED,
    sendSetPasswordLink: async (email) => { log.links.push(email); },
    createFirm: async (_by, f) => { log.created.push(f); return { status: 200, body: { ok: true, firm_id: "f1", email: f.email } }; },
    authSignUp: async (f) => { log.signups.push(f); },
    authUser: async (jwt) => people[jwt] ? { ...people[jwt], signupFirm: mem.t.marks.get(people[jwt].id) ?? null } : null,
    db: mem.db,
    background: (p) => { log.bg.push(p); },
    sleep: async (ms) => { log.slept += ms; clock += ms; },
    now: () => clock,
    random: () => 0.5,
    limits: {
      ip: new RateLimiter(10, 600_000, () => clock), email: new RateLimiter(5, 3_600_000, () => clock),
      link: new RateLimiter(1, 900_000, () => clock), provision: new RateLimiter(30, 600_000, () => clock),
    },
    ...over,
  };
  return { d, log, t: mem.t, handler: makeHandler(d), tick: (ms: number) => { clock += ms; } };
}

const post = (body: unknown, opts: { jwt?: string; ip?: string } = {}) =>
  new Request("https://x.test/functions/v1/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": opts.ip || "203.0.113.7", ...(opts.jwt ? { Authorization: "Bearer " + opts.jwt } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const form = (email: string) => ({ firm: "Some Firm", name: "A Person", email, password: "a-long-password-1" });
const read = async (r: Response) => ({ status: r.status, body: await r.json() });
const OK = { status: 200, body: { ok: true, reason: "check_email", message: CHECK_EMAIL } };
const provision = (jwt?: string, ip?: string) => post({ action: "provision" }, { jwt, ip });
const firmCount = (t: ReturnType<typeof memDb>["t"]) => t.firms.size - 1;   // less firm-x

// ---------- the public form: email + password, confirmed by Supabase's link before anything is made ----------

Deno.test("a new email gets 'check your email'; Supabase is asked to sign it up (after the answer); nothing else is made", async () => {
  const { handler, log, t } = fake();
  eq(NEUTRAL, CHECK_EMAIL);
  const r = await read(await handler(post({ ...form(" Nobody@Example.test "), redirect: "https://staging.fincom.live/review/" })));
  eq(r, OK);
  await Promise.all(log.bg);
  eq(log.signups, [{ email: "nobody@example.test", password: "a-long-password-1", name: "A Person", firm: "Some Firm", redirect: "https://staging.fincom.live/review/" }]);
  eq(firmCount(t), 0, "no firm"); eq(t.credits.length, 0, "no credit"); eq(log.created.length, 0); eq(log.links.length, 0);
});

Deno.test("existing, invited and new emails get byte-identical answers (no account enumeration, no 409)", async () => {
  const outs: string[] = [];
  for (const email of ["nobody@example.test", EXISTING, INVITED, "late@new.test"]) {
    const { handler } = fake();
    const r = await handler(post(form(email)));
    outs.push(r.status + " " + await r.text() + " " + JSON.stringify([...r.headers]));
  }
  assert(outs.every((o) => o === outs[0]), "answers differ:\n" + outs.join("\n"));
  assert(outs[0].startsWith("200 "), outs[0]);
});

Deno.test("every public answer waits for the time floor, however fast the lookups were (bad input too)", async () => {
  for (const body of [form("nobody@example.test"), form(EXISTING), form(INVITED), form("NOT AN EMAIL"), { ...form("a@b.test"), password: "x" }]) {
    const { handler, log } = fake();
    await handler(post(body));
    eq(log.slept, MIN_MS + Math.floor(0.5 * JITTER_MS), JSON.stringify(body));
  }
  // a slow lookup is not padded further (the floor is a minimum, from the start of the request)
  const slow = fake();
  const s = makeHandler({ ...slow.d, invitePending: async () => { slow.tick(MIN_MS + 500); return false; } });
  await s(post(form(EXISTING)));
  eq(slow.log.slept, 0);
});

Deno.test("Supabase's sign-up runs after the answer: a slow or failing Auth does not change the answer", async () => {
  const { d, log } = fake();
  const h = makeHandler({ ...d, authSignUp: async () => { throw new Error("User already registered"); } });
  eq(await read(await h(post(form(EXISTING)))), OK);
  await Promise.all(log.bg);    // the failure is swallowed
});

Deno.test("the form's own checks: email, password (10+, letters and digits), firm name; nothing is asked of Supabase", async () => {
  const { handler, log } = fake();
  const bad = [form("bad"), { ...form("a@b.test"), password: "short1" }, { ...form("a@b.test"), password: "onlyletterslong" },
    { ...form("a@b.test"), firm: "x" }, { ...form("a@b.test"), firm: "" }];
  for (const b of bad) { const r = await read(await handler(post(b))); eq(r.status, 400, JSON.stringify(b)); assert(r.body.ok === false && r.body.error); }
  await Promise.all(log.bg);
  eq(log.signups.length, 0); eq(log.links.length, 0);
});

Deno.test("an invited email that never signed in gets a set-password link, not a Supabase sign-up; at most one per window", async () => {
  const { handler, log, t } = fake();
  eq(await read(await handler(post(form(INVITED)))), OK);
  await Promise.all(log.bg);
  eq(log.links, [INVITED]); eq(log.signups.length, 0, "the invite's login is left as the invite made it");
  await read(await handler(post(form(INVITED))));
  await Promise.all(log.bg);
  eq(log.links, [INVITED], "second link inside 15 minutes");
  eq(log.created.length, 0); eq(firmCount(t), 0, "an invite never makes a firm here");
});

Deno.test("an existing (used) login: the same answer, no link, no firm (Supabase sends nothing for a confirmed email)", async () => {
  const { handler, log, t } = fake();
  eq(await read(await handler(post(form(EXISTING)))), OK);
  await Promise.all(log.bg);
  eq(log.links.length, 0); eq(log.created.length, 0); eq(firmCount(t), 0);
});

Deno.test("sign-up never makes a firm or credit, even with credit and plan in the body", async () => {
  const { handler, log, t } = fake();
  const r = await read(await handler(post({ ...form("x@example.test"), credit: 5000, plan: "Gold" })));
  eq(r, OK);
  await Promise.all(log.bg);
  eq(log.created.length, 0); eq(firmCount(t), 0); eq(t.credits.length, 0);
  assert(!("credit" in log.signups[0]) && !("plan" in log.signups[0]), "only email, password, name, firm, redirect go to Auth");
});

Deno.test("a signed-in non-administrator is treated as anyone else", async () => {
  const { handler, log } = fake();
  eq(await read(await handler(post(form("x@example.test"), { jwt: OTHER_JWT }))), OK);
  eq(log.created.length, 0);
});

// ---------- the platform administrator: as in v11 ----------

Deno.test("the platform administrator can create a firm (credit only as given, default 0)", async () => {
  const { handler, log } = fake();
  const r = await read(await handler(post({ firm: "Admin Made", name: "Owner", email: " Owner@New.test ", password: "" }, { jwt: ADMIN_JWT })));
  eq(r, { status: 200, body: { ok: true, firm_id: "f1", email: "owner@new.test" } });
  eq(log.created[0].credit, 0); eq(log.created[0].email, "owner@new.test");
  await handler(post({ firm: "Admin Made 2", email: "o2@new.test", credit: 300 }, { jwt: ADMIN_JWT }));
  eq(log.created[1].credit, 300);
  eq(log.signups.length, 0);
});

Deno.test("the administrator's path checks its inputs", async () => {
  const { handler, log } = fake();
  eq((await handler(post({ firm: "F", email: "bad" }, { jwt: ADMIN_JWT }))).status, 400);
  eq((await handler(post({ firm: "x", email: "a@b.test" }, { jwt: ADMIN_JWT }))).status, 400);
  eq((await handler(post({ firm: "Firm", email: "a@b.test", password: "short" }, { jwt: ADMIN_JWT }))).status, 400);
  eq(log.created.length, 0);
});

Deno.test("an administrator check that throws falls back to the public path", async () => {
  const { d, log } = fake();
  const h = makeHandler({ ...d, platformAdmin: async () => { throw new Error("auth down"); } });
  eq(await read(await h(post(form("x@example.test"), { jwt: ADMIN_JWT }))), OK);
  eq(log.created.length, 0);
});

// ---------- rate limits ----------

Deno.test("rate limit by address: the 11th try in 10 minutes is refused, for any email", async () => {
  const { handler, tick } = fake();
  for (let i = 0; i < 10; i++) eq((await handler(post(form(`n${i}@example.test`)))).status, 200);
  const r = await read(await handler(post(form(EXISTING))));
  eq(r, { status: 429, body: { ok: false, reason: "rate_limited", error: TOO_MANY } });
  eq((await handler(post(form("z@example.test"), { ip: "198.51.100.1" }))).status, 200, "another address");
  tick(10 * 60_000 + 1);
  eq((await handler(post(form("z@example.test")))).status, 200, "after the window");
});

Deno.test("rate limit by email: the 6th try in an hour is refused, from any address; Auth is asked at most 5 times", async () => {
  const { handler, log } = fake();
  for (let i = 0; i < 5; i++) eq((await handler(post(form("same@example.test"), { ip: `192.0.2.${i}` }))).status, 200);
  eq((await handler(post(form("same@example.test"), { ip: "192.0.2.99" }))).status, 429);
  await Promise.all(log.bg);
  eq(log.signups.length, 5);
});

Deno.test("method and body checks", async () => {
  const { handler } = fake();
  eq((await handler(new Request("https://x.test/", { method: "OPTIONS" }))).status, 200);
  eq((await handler(new Request("https://x.test/", { method: "GET" }))).status, 405);
  eq((await handler(post("{not json"))).status, 400);
});

// ---------- provision: the firm and the credit, once the email is confirmed, on the first sign-in ----------

Deno.test("provision without a valid sign-in: 401, nothing made", async () => {
  const { handler, t } = fake();
  eq((await read(await handler(provision()))).status, 401);
  eq((await read(await handler(provision("not-a-token")))).status, 401);
  eq(firmCount(t), 0);
});

Deno.test("an unconfirmed email: provision makes nothing (no firm, no credit, no member row)", async () => {
  const { handler, t } = fake();
  const r = await read(await handler(provision("tok-unconf")));
  eq(r.status, 403); eq(r.body.reason, "not_confirmed");
  eq(firmCount(t), 0); eq(t.credits.length, 0); assert(!t.members.has("u-unconf")); assert(!t.marks.has("u-unconf"));
});

Deno.test("a confirmed user's first provision: exactly one firm, its own, with ₹10,000 credit, the person its owner", async () => {
  const { handler, t } = fake();
  const id = await ownFirmId("u-new");
  const r = await read(await handler(provision("tok-new")));
  eq(r, { status: 200, body: { ok: true, created: true, firm_id: id } });
  eq(SIGNUP_CREDIT, 10000);
  const f = t.firms.get(id)!;
  eq([f.name, f.balance], ["Rao & Co", 10000]);
  eq(t.credits, [{ firm_id: id, amount: 10000, by: "u-new" }]);
  eq(t.members.get("u-new"), { user_id: "u-new", firm_id: id, name: "Asha Rao", email: "asha@new.test", role: "owner", active: true });
  eq(t.marks.get("u-new"), id); eq(t.after, [id]);
});

Deno.test("provision again (and again): nothing more, the same firm", async () => {
  const { handler, t, tick } = fake();
  const first = await read(await handler(provision("tok-new")));
  for (let i = 0; i < 3; i++) {
    tick(10 * 60_000);
    eq(await read(await handler(provision("tok-new"))), { status: 200, body: { ok: true, created: false, firm_id: first.body.firm_id } });
  }
  eq(firmCount(t), 1); eq(t.credits.length, 1); eq(t.firms.get(first.body.firm_id)!.balance, 10000);
});

Deno.test("provisions sent together (two tabs, a retry): still one firm and one credit", async () => {
  const { handler, t } = fake();
  const rs = await Promise.all([1, 2, 3, 4].map(() => handler(provision("tok-new")).then(read)));
  const id = await ownFirmId("u-new");
  eq(rs.filter((r) => r.body.created).length, 1);
  // the others: the same firm, or "try again" while its maker is still writing it
  assert(rs.every((r) => (r.status === 200 && r.body.firm_id === id) || (r.status === 503 && r.body.reason === "retry")), JSON.stringify(rs));
  eq((await read(await handler(provision("tok-new")))).body, { ok: true, created: false, firm_id: id });
  eq(firmCount(t), 1); eq(t.credits.length, 1); eq(t.members.size, 2);
});

Deno.test("a provision cut off after the firm was made: the retry finishes it, still one credit line", async () => {
  const { handler, t, tick } = fake();
  const id = await ownFirmId("u-new");
  t.failCredit = 1;
  eq((await handler(provision("tok-new"))).status, 500);
  eq(firmCount(t), 1); eq(t.credits.length, 0); assert(!t.members.has("u-new"), "no member row yet: the app asks again");
  eq(t.firms.get(id)!.balance, 10000, "the credit is on the firm from its first moment");
  eq((await read(await handler(provision("tok-new")))).status, 503, "within two minutes: its maker may still be writing it");
  eq(t.credits.length, 0); assert(!t.members.has("u-new"));
  tick(3 * 60_000);
  eq((await read(await handler(provision("tok-new")))).body, { ok: true, created: false, firm_id: id });
  await handler(provision("tok-new"));
  eq(t.credits.length, 1); eq(firmCount(t), 1); eq(t.members.get("u-new")!.role, "owner");
});

Deno.test("a firm made by sign-up and later closed is never made again for that login", async () => {
  const { handler, t } = fake();
  const id = (await read(await handler(provision("tok-new")))).body.firm_id;
  t.firms.delete(id); t.members.delete("u-new"); t.credits.length = 0;     // the administrator removed it
  const r = await read(await handler(provision("tok-new")));
  eq(r.status, 403); eq(firmCount(t), 0); eq(t.credits.length, 0);
});

Deno.test("Google: a verified email with no firm gets one, named \"<name>'s firm\", with ₹10,000, once", async () => {
  const { handler, t } = fake();
  const r = await read(await handler(provision("tok-google")));
  eq(r.body.created, true);
  eq(t.firms.get(r.body.firm_id)!.name, "Ravi Kumar's firm"); eq(t.firms.get(r.body.firm_id)!.balance, 10000);
  eq((await read(await handler(provision("tok-google")))).body.created, false);
  eq(firmCount(t), 1); eq(t.credits.length, 1);
});

Deno.test("Microsoft with no name given: the firm is named after the email", async () => {
  const { handler, t } = fake();
  const r = await read(await handler(provision("tok-azure-noname")));
  eq(t.firms.get(r.body.firm_id)!.name, "meera's firm");
});

Deno.test("an invited member signing in with Google (the same login, linked by email) lands in that firm; nothing is made", async () => {
  const { handler, t } = fake();
  eq(await read(await handler(provision("tok-invited"))), { status: 200, body: { ok: true, created: false, firm_id: "firm-x" } });
  eq(firmCount(t), 0); eq(t.credits.length, 0); eq(t.members.get("u-inv")!.role, "staff");
});

Deno.test("a second login for an invited member's email (not linked): no firm of its own is made", async () => {
  const { handler, t } = fake();
  const r = await read(await handler(provision("tok-invited-other-login")));
  eq(r.status, 403); eq(r.body.reason, "member_elsewhere");
  eq(firmCount(t), 0); eq(t.credits.length, 0); assert(!t.members.has("u-inv-2"));
});

Deno.test("the platform administrator's own login is not given a firm by provision", async () => {
  const { handler, t } = fake();
  eq((await handler(provision("tok-admin"))).status, 403);
  eq(firmCount(t), 0);
});

Deno.test("provision is rate limited by address", async () => {
  const { handler } = fake();
  for (let i = 0; i < 30; i++) eq((await handler(provision("tok-new"))).status, 200);
  eq((await handler(provision("tok-new"))).status, 429);
});

Deno.test("the firm's id comes from the login: the same each time, a uuid, different per login", async () => {
  const a = await ownFirmId("u-new"), b = await ownFirmId("u-new"), c = await ownFirmId("u-g");
  eq(a, b); assert(a !== c);
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(a), a);
});
