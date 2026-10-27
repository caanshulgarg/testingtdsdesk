// deno test --allow-env --allow-net --allow-read server/gst-taxpro/access_test.ts - who may do what in gst-taxpro
// (security review F3, F4, F11), against a stubbed Supabase (auth, mfa_ok, members, Vault, tables) and a stubbed TaxPro.
// Nothing leaves the process: every fetch is answered here.
//   1. two-step sign-in is checked exactly as the gateway does (rpc mfa_ok must be true): refused when it is not
//   2. a look-only member may read (status, returns, return, einv-status, einvoices) and nothing else
//   3. the owner and staff may do the rest
//   4. the self-test needs a signed-in member
//   5. error replies are plain; the raw detail goes to the log only
type Row = Record<string, any>;
function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }

const SB = "http://sb.test", TP = "http://taxpro.test", FIRM = "f-1", G = "07AAACT1234A1Z5";
// token → user; mfa: what mfa_ok answers for that token (the database decides: aal2, or two-step not required)
const USERS: Record<string, { id: string; mfa: boolean }> = {
  "jwt-owner": { id: "u-owner", mfa: true }, "jwt-staff": { id: "u-staff", mfa: true }, "jwt-look": { id: "u-look", mfa: true },
  "jwt-owner-aal1": { id: "u-owner", mfa: false }, "jwt-look-aal1": { id: "u-look", mfa: false },
};
const S = {
  members: [{ user_id: "u-owner", firm_id: FIRM, role: "owner", active: true }, { user_id: "u-staff", firm_id: FIRM, role: "staff", active: true },
    { user_id: "u-look", firm_id: FIRM, role: "readonly", active: true }] as Row[],
  tpCalls: [] as string[], writes: [] as string[], failTable: "" as string,
};
const out = (code: number, j: unknown) => new Response(JSON.stringify(j), { status: code, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const rq = new Request(input, init), u = new URL(rq.url), method = rq.method.toUpperCase();
  const auth = (rq.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const text = method === "GET" ? "" : await rq.text();
  const body = text ? JSON.parse(text) : null;
  if (u.origin === TP || u.origin === "https://gstsandbox.charteredinfo.com") {        // TaxPro, GST and e-invoice: always a good answer, every call recorded
    S.tpCalls.push(u.pathname + " " + (u.searchParams.get("action") || ""));
    return out(200, { status_cd: "1", Status: 1, auth_token: "TOK", expiry: 360, Data: { AuthToken: "E", TokenExpiry: "2099-01-01 10:00:00" } });
  }
  if (u.origin !== SB) throw new Error("no network in this test: " + rq.url);
  if (u.pathname === "/auth/v1/user") return USERS[auth] ? out(200, { id: USERS[auth].id, aud: "authenticated", role: "authenticated" }) : out(401, { message: "bad jwt" });
  if (u.pathname.startsWith("/rest/v1/rpc/")) {
    const fn = u.pathname.split("/").pop()!;
    if (fn === "mfa_ok") return out(200, USERS[auth]?.mfa === true);
    if (fn === "gsp_secret_get") return out(200, body.p_name.startsWith("gsp:taxpro:") ? "asp-secret" : "");
    if (fn === "gsp_secret_put") { S.writes.push("vault " + body.p_name); return out(200, "sid-1"); }
    if (fn === "gst_cron_ok") return out(200, false);
    return out(404, { message: "no function " + fn });
  }
  const table = u.pathname.replace("/rest/v1/", "");
  if (method !== "GET") {
    S.writes.push(method + " " + table);
    if (table === S.failTable) return out(400, { code: "23505", message: "duplicate key value violates unique constraint \"gst_secret_pkey\"", details: "Key (firm_id)=(f-1) internal" });
    return out(201, []);
  }
  if (table === "members") {
    const id = (u.searchParams.get("user_id") || "").replace(/^eq\./, "");
    return out(200, S.members.filter((m) => m.user_id === id));
  }
  if (table === "gst_einv_accounts") return out(200, [{ firm_id: FIRM, gstin: G, username: "irp", token_until: null }]);
  if (table === "gst_einvoices") return out(200, [{ firm_id: FIRM, gstin: G, doc_key: "d1", irn: "IRN1", irn_status: "active", ack_dt: new Date().toISOString() }]);
  return out(200, []);
}) as typeof fetch;

for (const [k, v] of Object.entries({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key", TAXPRO_BASE_URL: TP, TAXPRO_EINV_URL: TP,
  TAXPRO_FILE_LIVE: "", TAXPRO_EINV_TEST_GSTIN: "", RESEND_API_KEY: "" })) Deno.env.set(k, v);
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
const reset = () => { S.tpCalls.length = 0; S.writes.length = 0; S.failTable = ""; };

// every action that writes, spends a TaxPro call or sends an OTP
const WRITES: Row[] = [
  { action: "einv-login", gstin: G, username: "irp", password: "irp-pass" },
  { action: "irn", gstin: G, docKey: "d2", inv: { SellerDtls: { Gstin: G }, DocDtls: { Typ: "INV", No: "S1", Dt: "01/10/2026" } } },
  { action: "irn-cancel", gstin: G, docKey: "d1", reason: "2", remark: "x" },
  { action: "ewb", gstin: G, docKey: "d1", trans: { distance: 10 } },
  { action: "otp", gstin: G, username: "user1" },
  { action: "auth", gstin: G, username: "user1", otp: "575757" },
  { action: "2b", gstin: G, username: "user1", period: "092026" },
  { action: "fetch", gstin: G, form: "2B", period: "092026" },
  ...["filing", "save", "summary", "confirm", "proceed", "evc_otp", "file", "track"].map((a) => ({ action: a, gstin: G, form: "R1", period: "092026" })),
  { action: "no-such-action", gstin: G },
];
const READS: Row[] = [
  { action: "status", gstins: [G] }, { action: "returns", gstins: [G] }, { action: "return", gstin: G, form: "R1", period: "092026" },
  { action: "einv-status", gstins: [G] }, { action: "einvoices", gstin: G },
];

Deno.test("F4: a token without the two-step sign-in (mfa_ok not true) is refused, as the gateway refuses it", T, async () => {
  for (const b of [...READS, ...WRITES.slice(0, 5)]) {
    reset();
    const r = await call("jwt-owner-aal1", b);
    assert(r.status === 403 && r.j.error === "Finish the two-step sign-in first.", b.action + ": got " + JSON.stringify(r));
    assert(!S.tpCalls.length && !S.writes.length, b.action + ": nothing done before the check");
  }
  let r = await call("jwt-look-aal1", { action: "status", gstins: [G] });
  assert(r.status === 403 && r.j.error === "Finish the two-step sign-in first.", "look member without two-step: " + JSON.stringify(r));
  // the same user, when mfa_ok is true (two-step done, or not required while testing): passes, as at the gateway
  r = await call("jwt-owner", { action: "status", gstins: [G] });
  assert(r.status === 200 && r.j.ok === true, "owner with mfa_ok true: " + JSON.stringify(r));
});

Deno.test("F3: a look-only member is refused on every write action, and nothing is sent or kept", T, async () => {
  for (const b of WRITES) {
    reset();
    const r = await call("jwt-look", b);
    assert(r.status === 403 && r.j.error === "Only the firm's owner or staff can do this.", b.action + ": got " + JSON.stringify(r));
    assert(!S.tpCalls.length && !S.writes.length, b.action + ": nothing sent to TaxPro or kept (" + S.tpCalls.concat(S.writes).join(", ") + ")");
  }
});

Deno.test("F3: a look-only member may read, and only read", T, async () => {
  for (const b of READS) {
    reset();
    const r = await call("jwt-look", b);
    assert(r.status === 200 && r.j.ok === true, b.action + ": got " + JSON.stringify(r));
    assert(!S.tpCalls.length && !S.writes.length, b.action + ": a read sends and keeps nothing");
  }
  const r = await call("jwt-look", { action: "otp", gstin: G, username: "user1" });
  assert(r.status === 403, "but not send an OTP: " + JSON.stringify(r));
});

Deno.test("F3: the owner and staff may write where a look-only member may not", T, async () => {
  for (const b of WRITES.slice(0, 5)) assert((await call("jwt-look", b)).status === 403, "look-only member refused " + b.action);
  for (const jwt of ["jwt-owner", "jwt-staff"]) {
    reset();
    let r = await call(jwt, { action: "otp", gstin: G, username: "user1" });
    assert(r.status === 200 && r.j.ok === true && S.tpCalls.some((c) => c.endsWith("OTPREQUEST")), jwt + " otp: " + JSON.stringify(r));
    reset();
    r = await call(jwt, { action: "einv-login", gstin: G, username: "irp", password: "irp-pass" });
    assert(r.status === 200 && r.j.ok === true && S.writes.includes("vault gsp:einv:" + FIRM + ":" + G + ":pass"), jwt + " einv-login: " + JSON.stringify(r));
    for (const b of READS) { const x = await call(jwt, b); assert(x.status === 200 && x.j.ok === true, jwt + " " + b.action); }
  }
});

Deno.test("F11: the self-test needs a signed-in member with the two-step sign-in", T, async () => {
  reset();
  let r = await call(null, null, "?selftest=1");
  assert(r.status === 401 && !S.tpCalls.length, "no token: " + JSON.stringify(r));
  r = await call("jwt-nobody", null, "?selftest=1");
  assert(r.status === 401 && !S.tpCalls.length, "unknown token: " + JSON.stringify(r));
  r = await call("jwt-owner-aal1", null, "?selftest=1");
  assert(r.status === 403 && !S.tpCalls.length, "no two-step: " + JSON.stringify(r));
  r = await call("jwt-staff", null, "?selftest=1");
  assert(r.status === 200 && S.tpCalls.length > 0, "a member: it runs: " + JSON.stringify(r));
  assert(!JSON.stringify(r.j).includes(TP), "the hosts in use are not given out: " + JSON.stringify(r.j));
});

Deno.test("F11: error replies are plain; the database's own words go to the log only", T, async () => {
  const logged: string[] = [], orig = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")); };
  try {
    reset(); S.failTable = "gst_einv_accounts";
    const r = await call("jwt-owner", { action: "einv-login", gstin: G, username: "irp", password: "irp-pass" });
    const said = JSON.stringify(r.j);
    assert(r.j.ok === false && typeof r.j.error === "string" && r.j.error.length > 0, "a failure is said: " + said);
    assert(!/duplicate key|constraint|gst_secret_pkey|23505|internal/i.test(said), "no raw database text in the reply: " + said);
    assert(logged.some((l) => l.includes("duplicate key")), "the raw detail is in the log: " + logged.join(" | "));
  } finally { console.error = orig; }
});
