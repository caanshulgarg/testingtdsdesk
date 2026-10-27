// deno test --allow-env --allow-net --allow-read server/gst-api/access_test.ts - who may do what in gst-api (security
// review F3, F4, F11), against a stubbed Supabase (auth, mfa_ok, members) and a stubbed FYN Gateway behind its relay.
// Nothing leaves the process: every fetch is answered here.
//   1. two-step sign-in is checked exactly as the gateway does (rpc mfa_ok must be true): refused when it is not
//   2. a look-only member may read (2B) but not send an OTP or sign in a taxpayer
//   3. the owner and staff may
//   4. the self-test needs a signed-in member, and does not give out the FYN or relay address
//   5. error replies are plain; the raw detail goes to the log only
//   6. F5: every call names a GSTIN of one of the caller's firm's clients; OTP requests are limited per firm (10 an
//      hour, counted in the database's auth_rate_hit, or in the running copy when that is not there); the plain relay
//      is gone (the app calls no relay path: nothing in app/src or src/js calls gst-api)
type Row = Record<string, any>;
function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }

const SB = "http://sb.test", FYN = "http://fyn.test/api", RELAY = "http://relay.test", G = "07AAACT1234A1Z5";
const G_OTHER = "09AAACB1234C1Z5", G_GONE = "27AAACT1234A1Z5", G_F3 = "29AAACT1234A1Z5", G_F4 = "33AAACT1234A1Z5";
const USERS: Record<string, { id: string; mfa: boolean }> = {
  "jwt-owner": { id: "u-owner", mfa: true }, "jwt-staff": { id: "u-staff", mfa: true }, "jwt-look": { id: "u-look", mfa: true },
  "jwt-owner-aal1": { id: "u-owner", mfa: false }, "jwt-owner2": { id: "u-owner2", mfa: true }, "jwt-owner3": { id: "u-owner3", mfa: true },
  "jwt-owner4": { id: "u-owner4", mfa: true },
};
const S = {
  members: [{ user_id: "u-owner", firm_id: "f-1", role: "owner", active: true }, { user_id: "u-staff", firm_id: "f-1", role: "staff", active: true },
    { user_id: "u-look", firm_id: "f-1", role: "readonly", active: true }, { user_id: "u-owner2", firm_id: "f-2", role: "owner", active: true },
    { user_id: "u-owner3", firm_id: "f-3", role: "owner", active: true }, { user_id: "u-owner4", firm_id: "f-4", role: "owner", active: true }] as Row[],
  clients: [{ id: "c1", firm_id: "f-1", gstin: G, deleted: false }, { id: "c2", firm_id: "f-2", gstin: G_OTHER, deleted: false },
    { id: "c3", firm_id: "f-1", gstin: G_GONE, deleted: true }, { id: "c4", firm_id: "f-3", gstin: G_F3, deleted: false },
    { id: "c5", firm_id: "f-4", gstin: G_F4, deleted: false }] as Row[],
  hits: {} as Record<string, number>, rateRpcGone: false, clientAsks: [] as string[],
  fynCalls: [] as string[], down: false,
};
const out = (code: number, j: unknown) => new Response(JSON.stringify(j), { status: code, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const rq = new Request(input, init), u = new URL(rq.url), method = rq.method.toUpperCase();
  const auth = (rq.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (u.origin === RELAY) {        // the relay: FYN's answer for the target it is given
    if (S.down) throw new TypeError("error sending request for url (" + RELAY + "/fwd): connection refused (os error 111) at 10.0.0.7");
    const target = new URL(rq.headers.get("x-target") || ""), p = target.pathname.replace("/api/", "");
    S.fynCalls.push((rq.headers.get("x-method") || "") + " " + p);
    if (p === "authenticate") return out(200, { status: 1, data: { accessToken: "fyn-token", expiresIn: 3600 } });
    if (p === "gst/requestOTP") return out(200, { status_cd: 1, app_key: "AK" });
    if (p === "gst/authtoken") return out(200, { status_cd: 1, auth_token: "AT", sek: "S", expiry: 360 });
    if (p.startsWith("gst/returns/gstr2b/")) return out(200, { status_cd: 1, data: { docdata: { b2b: [] } } });
    return out(200, { status_cd: 1, data: {} });
  }
  if (u.origin !== SB) throw new Error("no network in this test: " + rq.url);
  if (u.pathname === "/auth/v1/user") return USERS[auth] ? out(200, { id: USERS[auth].id, aud: "authenticated", role: "authenticated" }) : out(401, { message: "bad jwt" });
  if (u.pathname === "/rest/v1/rpc/mfa_ok") return out(200, USERS[auth]?.mfa === true);
  if (u.pathname === "/rest/v1/rpc/auth_rate_hit") {     // migration-112, service role only
    if (S.rateRpcGone) return out(404, { code: "PGRST202", message: "Could not find the function public.auth_rate_hit" });
    const b = JSON.parse(await rq.text()); if (auth !== "service-key") return out(403, { message: "permission denied" });
    const k = b.p_bucket + "|" + b.p_key; if ((S.hits[k] || 0) >= b.p_max) return out(200, false);
    S.hits[k] = (S.hits[k] || 0) + 1; return out(200, true);
  }
  if (u.pathname === "/rest/v1/clients" && method === "GET") {
    if (auth !== "service-key") return out(403, { message: "service role only in this test" });
    const v = (k: string) => (u.searchParams.get(k) || "").replace(/^eq\./, "");
    S.clientAsks.push(v("firm_id") + " " + v("gstin"));
    return out(200, S.clients.filter((c) => c.firm_id === v("firm_id") && c.gstin === v("gstin") && !(u.searchParams.get("deleted") === "not.is.true" && c.deleted === true)));
  }
  if (u.pathname === "/rest/v1/members" && method === "GET") {
    const id = (u.searchParams.get("user_id") || "").replace(/^eq\./, "");
    return out(200, S.members.filter((m) => m.user_id === id));
  }
  return out(404, { message: "not in this test: " + u.pathname });
}) as typeof fetch;

for (const [k, v] of Object.entries({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key", FYN_BASE_URL: FYN,
  FYN_CLIENT_ID: "cid", FYN_CLIENT_SECRET: "csec", FYN_RELAY_URL: RELAY, FYN_RELAY_KEY: "rkey" })) Deno.env.set(k, v);
let serve: ((r: Request) => Promise<Response>) | null = null;
(Deno as any).serve = (h: any) => { serve = h; return { finished: Promise.resolve(), shutdown: async () => {} }; };
await import("./index.ts");
assert(serve, "index.ts serves its handler");

async function call(jwt: string | null, body: Row | null, get = "") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) headers.Authorization = "Bearer " + jwt;
  const r = await serve!(new Request("http://fn.test/" + get, body ? { method: "POST", headers, body: JSON.stringify(body) } : { method: "GET", headers }));
  return { status: r.status, j: await r.json() };
}
// supabase-js starts its own timers per client; they are not this test's to clean up
const T = { sanitizeOps: false, sanitizeResources: false };
const reset = () => { S.fynCalls.length = 0; S.down = false; S.hits = {}; S.rateRpcGone = false; S.clientAsks.length = 0; };

const WRITES: Row[] = [
  { action: "otp", gstin: G, username: "user1" },
  { action: "auth", gstin: G, username: "user1", otp: "575757" },
];
const READS: Row[] = [
  { action: "2b", gstin: G, username: "user1", period: "092026", auth_token: "AT", app_key: "AK", sek: "S" },
];
const RELAYED: Row[] = ["GET", "POST", "PUT"].map((m) => ({ action: "", path: "gst/returns/gstr1", method: m, headers: { gstin: G }, query: { gstin: G } }));
const name = (b: Row) => b.action || "relay " + b.method;

Deno.test("F4: a token without the two-step sign-in (mfa_ok not true) is refused, as the gateway refuses it", T, async () => {
  for (const b of [...READS, ...WRITES]) {
    reset();
    const r = await call("jwt-owner-aal1", b);
    assert(r.status === 403 && r.j.error === "Finish the two-step sign-in first.", name(b) + ": got " + JSON.stringify(r));
    assert(!S.fynCalls.length, name(b) + ": nothing sent before the check");
  }
  const r = await call("jwt-owner", READS[0]);   // the same user with mfa_ok true passes
  assert(r.status === 200 && r.j.ok === true, "owner with mfa_ok true: " + JSON.stringify(r));
});

Deno.test("F3: a look-only member cannot send an OTP or sign in a taxpayer", T, async () => {
  for (const b of WRITES) {
    reset();
    const r = await call("jwt-look", b);
    assert(r.status === 403 && r.j.error === "Only the firm's owner or staff can do this.", name(b) + ": got " + JSON.stringify(r));
    assert(!S.fynCalls.length, name(b) + ": nothing sent to FYN (" + S.fynCalls.join(", ") + ")");
  }
});

Deno.test("F3: a look-only member may read, and only read", T, async () => {
  for (const b of READS) {
    reset();
    const r = await call("jwt-look", b);
    assert(r.status === 200 && r.j.ok === true, name(b) + ": got " + JSON.stringify(r));
  }
  assert((await call("jwt-look", WRITES[0])).status === 403, "but not send an OTP");
});

Deno.test("F3: the owner and staff may do what a look-only member may not", T, async () => {
  for (const jwt of ["jwt-owner", "jwt-staff"]) {
    for (const b of [...WRITES, ...READS]) {
      reset();
      const r = await call(jwt, b);
      assert(r.status === 200 && r.j.ok === true && S.fynCalls.length > 0, jwt + " " + name(b) + ": " + JSON.stringify(r));
      if (WRITES.includes(b)) assert((await call("jwt-look", b)).status === 403, "look-only refused " + name(b));
    }
  }
});

Deno.test("F11: the self-test needs a signed-in member and does not give out FYN's or the relay's address", T, async () => {
  reset();
  let r = await call(null, null, "?selftest=1");
  assert(r.status === 401 && !S.fynCalls.length, "no token: " + JSON.stringify(r));
  r = await call("jwt-owner-aal1", null, "?selftest=1");
  assert(r.status === 403 && !S.fynCalls.length, "no two-step: " + JSON.stringify(r));
  r = await call("jwt-look", null, "?selftest=1");
  assert(r.status === 200 && r.j.signedIn === true, "a member: it runs: " + JSON.stringify(r));
  const said = JSON.stringify(r.j);
  assert(!said.includes("relay.test") && !said.includes("fyn.test"), "no addresses: " + said);
});

Deno.test("F11: error replies are plain; the raw detail goes to the log only", T, async () => {
  const logged: string[] = [], orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try {
    reset(); S.down = true;
    const r = await call("jwt-owner", READS[0]);
    const said = JSON.stringify(r.j);
    assert(r.j.ok === false && typeof r.j.error === "string" && r.j.error.length > 0, "a failure is said: " + said);
    assert(!/relay\.test|fyn\.test|os error|10\.0\.0\.7|error sending/i.test(said), "no raw detail in the reply: " + said);
    assert(logged.some((l) => l.includes("os error 111")), "the raw detail is in the log: " + logged.join(" | "));
  } finally { console.error = orig; S.down = false; }
});

Deno.test("F5: every call names a GSTIN of one of the firm's clients, checked with the service role", T, async () => {
  for (const g of [G_OTHER, G_GONE, "24AAACZ9999Z1Z9"]) {           // another firm's client, a deleted client, nobody's
    for (const b of [...WRITES, ...READS]) {
      reset();
      const r = await call("jwt-owner", { ...b, gstin: g });
      assert(r.status === 403 && r.j.error === "That GSTIN is not one of your firm's clients.", b.action + " " + g + ": got " + JSON.stringify(r));
      assert(!S.fynCalls.length, b.action + " " + g + ": nothing sent to FYN");
    }
  }
  reset();
  const r = await call("jwt-owner", { action: "otp", gstin: G.toLowerCase(), username: "user1" });
  assert(r.status === 200 && r.j.ok === true && S.clientAsks.includes("f-1 " + G), "the firm's own client (any case): asked with the caller's firm: " + JSON.stringify(r) + " " + S.clientAsks.join(","));
  reset();
  const r2 = await call("jwt-owner2", { action: "otp", gstin: G_OTHER, username: "user1" });
  assert(r2.status === 200 && r2.j.ok === true, "the other firm, its own client: " + JSON.stringify(r2));
});

Deno.test("F5: the plain relay is gone, for everyone", T, async () => {
  for (const jwt of ["jwt-owner", "jwt-staff", "jwt-look"]) {
    for (const b of RELAYED) {
      reset();
      const r = await call(jwt, b);
      assert(r.status === 400 && r.j.ok === false && !S.fynCalls.length, jwt + " relay " + b.method + ": " + JSON.stringify(r));
    }
  }
});

Deno.test("F5: OTP requests are limited to 10 an hour per firm (429), counted in the database", T, async () => {
  reset();
  for (let i = 1; i <= 10; i++) {
    const r = await call(i % 2 ? "jwt-owner" : "jwt-staff", WRITES[0]);
    assert(r.status === 200 && r.j.ok === true, "OTP " + i + ": " + JSON.stringify(r));
  }
  const n = S.fynCalls.filter((c) => c.endsWith("requestOTP")).length;
  let r = await call("jwt-staff", WRITES[0]);
  assert(r.status === 429 && r.j.ok === false && typeof r.j.error === "string", "the 11th: " + JSON.stringify(r));
  assert(S.fynCalls.filter((c) => c.endsWith("requestOTP")).length === n && n === 10, "the 11th is not sent to FYN");
  assert(Object.keys(S.hits).length === 1 && /^gst-otp-firm\|[0-9a-f]{64}$/.test(Object.keys(S.hits)[0]), "one counter, for the firm, hashed: " + Object.keys(S.hits));
  r = await call("jwt-owner", READS[0]);
  assert(r.status === 200 && r.j.ok === true, "2B is not limited: " + JSON.stringify(r));
  r = await call("jwt-owner2", { action: "otp", gstin: G_OTHER, username: "user1" });
  assert(r.status === 200 && r.j.ok === true, "another firm has its own count: " + JSON.stringify(r));
});

Deno.test("F5: without the database's counter (migration-112 not applied) the running copy still limits", T, async () => {
  reset(); S.rateRpcGone = true;
  const orig = console.error; console.error = () => {};
  try {
    for (let i = 1; i <= 10; i++) assert((await call("jwt-owner3", { action: "otp", gstin: G_F3, username: "u" })).status === 200, "OTP " + i);
    const r = await call("jwt-owner3", { action: "otp", gstin: G_F3, username: "u" });
    assert(r.status === 429, "the 11th: " + JSON.stringify(r));
    assert((await call("jwt-owner4", { action: "otp", gstin: G_F4, username: "u" })).status === 200, "another firm has its own count");
  } finally { console.error = orig; }
});
