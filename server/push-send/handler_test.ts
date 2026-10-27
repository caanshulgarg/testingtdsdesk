// deno test --allow-all server/push-send/handler_test.ts - the push-send stub (branch next-mobile) with a fake Supabase
// (platform_secrets, device_tokens) and a fake Google (the OAuth token and FCM HTTP v1). Nothing leaves this computer.
//   - the service role only: no key, the anon key, a member's token: 401; GET: 405
//   - no FCM key in platform_secrets: logged, {sent: 0, skipped: "no_key"}, no call to Google
//   - with a key: one signed OAuth request (RS256, verified here with the key's public half; scope firebase.messaging),
//     then one FCM request a phone in use of the firm (or of the members named), the title, the words, the kind and the
//     page to open; the access token kept for the next call
//   - a phone FCM says is gone (404 UNREGISTERED) is marked disabled ('unregistered'), never deleted; others still sent
//   - a bad body: 400 (firm_id, kind, title, user_ids)
import { handler, OAUTH_URL, FCM_SCOPE, fcmUrl } from "./handler.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
const SB = "https://stand.supabase.test", SERVICE = "service-role-key-for-tests-only", ANON = "anon-key";
const FIRM = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
const U1 = "aaaaaaaa-0000-4000-8000-000000000001", U2 = "aaaaaaaa-0000-4000-8000-000000000002";

const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(String.fromCharCode(...pkcs8)).replace(/(.{64})/g, "$1\n") + "\n-----END PRIVATE KEY-----\n";
const SA = { type: "service_account", project_id: "fincom-test", client_email: "push@fincom-test.iam.gserviceaccount.com", private_key: pem, token_uri: OAUTH_URL };
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

function stand(o: { key?: boolean, gone?: string[] } = {}) {
  const st: any = { oauth: 0, sent: [] as any[], patches: [] as any[], reads: [] as string[], logs: [] as any[], badSig: 0 };
  const tokens = [
    { id: "t1", token: "tok-android-1", platform: "android", firm_id: FIRM, user_id: U1, disabled_at: null },
    { id: "t2", token: "tok-ios-2", platform: "ios", firm_id: FIRM, user_id: U2, disabled_at: null },
    { id: "t3", token: "tok-other-firm", platform: "android", firm_id: OTHER, user_id: U2, disabled_at: null },
    { id: "t4", token: "tok-disabled", platform: "android", firm_id: FIRM, user_id: U1, disabled_at: "2026-10-01T00:00:00Z" },
  ];
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  const f = async (input: any, init: any = {}) => {
    const url = String(input), u = new URL(url), h = init.headers || {};
    if (url.startsWith(SB)) {
      assert(h.Authorization === "Bearer " + SERVICE && h.apikey === SERVICE, "Supabase is called with the service role");
      st.reads.push(u.pathname + u.search);
      if (u.pathname === "/rest/v1/platform_secrets") return json(o.key === false ? [] : [{ value: JSON.stringify(SA) }]);
      if (u.pathname === "/rest/v1/device_tokens" && (init.method || "GET") === "GET") {
        const firm = (u.searchParams.get("firm_id") || "").replace(/^eq\./, ""), users = (u.searchParams.get("user_id") || "").replace(/^in\.\(|\)$/g, "");
        assert(u.searchParams.get("disabled_at") === "is.null", "only phones in use");
        return json(tokens.filter((t) => t.firm_id === firm && !t.disabled_at && (!users || users.split(",").includes(t.user_id))).map(({ id, token, platform }) => ({ id, token, platform })));
      }
      if (u.pathname === "/rest/v1/device_tokens" && init.method === "PATCH") { st.patches.push({ q: u.search, body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
      if (init.method === "DELETE") throw new Error("nothing is deleted");
      return json({ message: "not in the stand: " + u.pathname }, 404);
    }
    if (url === OAUTH_URL) {
      st.oauth++;
      const p = new URLSearchParams(init.body), jwt = String(p.get("assertion") || "").split(".");
      eq(p.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer", "the JWT bearer grant");
      const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pair.publicKey, unb64(jwt[2]), new TextEncoder().encode(jwt[0] + "." + jwt[1]));
      const claim = JSON.parse(new TextDecoder().decode(unb64(jwt[1])));
      if (!good || claim.iss !== SA.client_email || claim.scope !== FCM_SCOPE || claim.aud !== OAUTH_URL || claim.exp - claim.iat !== 3600) { st.badSig++; return json({ error: "invalid_grant" }, 400); }
      return json({ access_token: "ya29.fake-" + st.oauth, expires_in: 3599, token_type: "Bearer" });
    }
    if (url === fcmUrl("fincom-test")) {
      assert(String(h.Authorization).startsWith("Bearer ya29.fake-"), "FCM is called with the OAuth access token");
      const m = JSON.parse(init.body).message;
      st.sent.push(m);
      if ((o.gone || []).includes(m.token)) return json({ error: { code: 404, status: "NOT_FOUND", message: "Requested entity was not found.", details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }] } }, 404);
      return json({ name: "projects/fincom-test/messages/" + st.sent.length });
    }
    throw new Error("no network in the test: " + url);
  };
  const env = (k: string) => ({ SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: ANON } as Record<string, string>)[k];
  const h = handler({ env, fetch: f as typeof fetch, now: () => Date.parse("2026-10-27T10:00:00Z"), log: (...a: unknown[]) => st.logs.push(a) });
  const call = async (body: unknown, auth = SERVICE, method = "POST") => {
    const r = await h(new Request("https://fn.test/push-send", { method, headers: { Authorization: "Bearer " + auth, "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined }));
    return { status: r.status, body: await r.json() };
  };
  return { st, call };
}
const MSG = { firm_id: FIRM, kind: "due", title: "TDS payment due on 7-Nov", body: "3 clients have TDS to pay this week.", route: "#/compliance" };

Deno.test("the service role only", async () => {
  const { st, call } = stand();
  for (const who of ["", ANON, "eyJhbGciOiJIUzI1NiJ9.member.token", SERVICE + "x"]) eq((await call(MSG, who)).status, 401, "refused: " + (who || "no key").slice(0, 12));
  eq((await call(MSG, SERVICE, "GET")).status, 405, "GET refused");
  eq(st.sent.length + st.oauth, 0, "nothing sent, no call to Google");
});

Deno.test("no FCM key: logged and skipped", async () => {
  const { st, call } = stand({ key: false });
  const r = await call(MSG);
  eq([r.status, r.body], [200, { ok: true, sent: 0, skipped: "no_key" }], "the answer");
  eq(st.oauth + st.sent.length, 0, "no call to Google");
  assert(st.logs.some((l: any[]) => /no FCM key/.test(String(l[0]))), "logged");
  assert(!st.reads.some((p: string) => p.startsWith("/rest/v1/device_tokens")), "the phones not even read");
});

Deno.test("sends to the firm's phones in use, through FCM HTTP v1", async () => {
  const { st, call } = stand();
  const r = await call(MSG);
  eq([r.status, r.body], [200, { ok: true, sent: 2, failed: 0, disabled: 0 }], "the answer");
  eq(st.badSig, 0, "the OAuth request is signed with the service account's key (RS256), scope firebase.messaging");
  eq(st.sent.map((m: any) => m.token).sort(), ["tok-android-1", "tok-ios-2"], "the firm's two phones in use (not the other firm's, not the disabled one)");
  const m = st.sent[0];
  eq([m.notification, m.data], [{ title: MSG.title, body: MSG.body }, { kind: "due", route: "#/compliance" }], "the title, the words, the kind and the page");
  eq([m.android.notification.channel_id, m.apns.payload.aps.sound], ["general", "default"], "Android's channel and the iPhone's sound");
  await call({ ...MSG, kind: "call", title: "Asha is calling", user_ids: [U2], route: "#/meetings" });
  eq(st.oauth, 1, "the access token is kept for the next call");
  const c = st.sent[2];
  eq([st.sent.length, c.token, c.android.priority, c.android.notification.channel_id, c.apns.headers["apns-priority"]], [3, "tok-ios-2", "HIGH", "calls", "10"], "a call: the member named only, at once");
});

Deno.test("a phone that is gone is marked, never deleted", async () => {
  const { st, call } = stand({ gone: ["tok-android-1"] });
  const r = await call(MSG);
  eq(r.body, { ok: true, sent: 1, failed: 1, disabled: 1 }, "one sent, one gone");
  eq(st.patches.length, 1, "one row marked");
  eq([st.patches[0].q, st.patches[0].body.disabled_why, typeof st.patches[0].body.disabled_at], ["?id=eq.t1", "unregistered", "string"], "t1 disabled as 'unregistered'");
});

Deno.test("a bad body is refused", async () => {
  const { st, call } = stand();
  for (const [b, w] of [[{ ...MSG, firm_id: "x" }, "firm_id"], [{ ...MSG, kind: "spam" }, "kind"], [{ ...MSG, title: "  " }, "title"], [{ ...MSG, user_ids: ["nope"] }, "user_ids"], [{ ...MSG, user_ids: "U1" }, "user_ids list"]] as [unknown, string][])
    eq((await call(b)).status, 400, "refused: " + w);
  const r = await call({ ...MSG, route: "javascript:alert(1)" });
  eq([r.status, st.sent[0].data.route], [200, ""], "a route that is not a FinCom page is dropped");
});
