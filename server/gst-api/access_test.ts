// deno test --allow-env --allow-net --allow-read server/gst-api/access_test.ts - who may do what in gst-api (security
// review F3, F4, F11), against a stubbed Supabase (auth, mfa_ok, members) and a stubbed FYN Gateway behind its relay.
// Nothing leaves the process: every fetch is answered here.
//   1. two-step sign-in is checked exactly as the gateway does (rpc mfa_ok must be true): refused when it is not
//   2. a look-only member may read (2B, a relayed GET) but not send an OTP, sign in a taxpayer or relay a write
//   3. the owner and staff may
//   4. the self-test needs a signed-in member, and does not give out the FYN or relay address
//   5. error replies are plain; the raw detail goes to the log only
type Row = Record<string, any>;
function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }

const SB = "http://sb.test", FYN = "http://fyn.test/api", RELAY = "http://relay.test", G = "07AAACT1234A1Z5";
const USERS: Record<string, { id: string; mfa: boolean }> = {
  "jwt-owner": { id: "u-owner", mfa: true }, "jwt-staff": { id: "u-staff", mfa: true }, "jwt-look": { id: "u-look", mfa: true },
  "jwt-owner-aal1": { id: "u-owner", mfa: false },
};
const S = {
  members: [{ user_id: "u-owner", firm_id: "f-1", role: "owner", active: true }, { user_id: "u-staff", firm_id: "f-1", role: "staff", active: true },
    { user_id: "u-look", firm_id: "f-1", role: "readonly", active: true }] as Row[],
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
const reset = () => { S.fynCalls.length = 0; S.down = false; };

const WRITES: Row[] = [
  { action: "otp", gstin: G, username: "user1" },
  { action: "auth", gstin: G, username: "user1", otp: "575757" },
  { action: "", path: "gst/returns/gstr1", method: "PUT", body: { a: 1 } },
  { action: "", path: "gst/returns/gstr1", method: "POST", body: { a: 1 } },
];
const READS: Row[] = [
  { action: "2b", gstin: G, username: "user1", period: "092026", auth_token: "AT", app_key: "AK", sek: "S" },
  { action: "", path: "gst/returns/gstr1", method: "GET", query: { gstin: G } },
];
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

Deno.test("F3: a look-only member cannot send an OTP, sign in a taxpayer or relay a write", T, async () => {
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
