// push-send (deployed name; branch next-mobile, 27-Oct-2026; the mobile plan, mobile-plan.md): a push notification to the
// FinCom phone app. A STUB of the server part: it sends, but nothing calls it yet (the bell, due dates, posting results and
// call invites call it in the "push and server" phase of the plan).
//   who may call: the service role only (another function, or the database's timer through pg_net, with the service
//     role key). Anyone else is refused (401). verify_jwt off: the check is here.
//   body: {firm_id, user_ids?: [uuid], kind: "due" | "alert" | "posting" | "call" | "other", title, body, route?}
//     the phones in use (device_tokens, migration 124) of the firm, or of those members only, are sent one message each
//   how: Firebase Cloud Messaging, HTTP v1 (one request a phone; FCM hands the message to Apple's APNs for an iPhone). The
//     key is the Firebase service account's JSON, kept in platform_secrets as fcm_service_account (never in the app, never
//     in a reply). No key: the call is logged and answered {ok: true, sent: 0, skipped: "no_key"}, nothing is sent.
//   a phone FCM says is gone (UNREGISTERED, or the token not valid) is marked disabled (disabled_why), never deleted.
// What a message carries: the title and the words, the kind and the page to open (route, a FinCom hash such as #/today).
// Never a client's figures: a phone's lock screen shows it.
export type Env = (k: string) => string | undefined;
export type Deps = { env: Env, fetch: typeof fetch, now?: () => number, log?: (...a: unknown[]) => void };

export const OAUTH_URL = "https://oauth2.googleapis.com/token";
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
export const fcmUrl = (project: string) => "https://fcm.googleapis.com/v1/projects/" + encodeURIComponent(project) + "/messages:send";
export const KINDS = ["due", "alert", "posting", "call", "other"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PHONES = 500;

class Fail extends Error { constructor(public code: number, message: string) { super(message); } }
const fail = (code: number, msg: string): never => { throw new Fail(code, msg); };

const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = ""; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
function pemBytes(pem: string) {
  const body = String(pem).replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\\n/g, "").replace(/\s+/g, "");
  const raw = atob(body), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
// the service account's signed request for an access token (RS256, Google's OAuth 2.0 for server-to-server)
export async function signedAssertion(sa: { client_email: string, private_key: string, token_uri?: string }, nowMs: number) {
  const iat = Math.floor(nowMs / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: FCM_SCOPE, aud: sa.token_uri || OAUTH_URL, iat, exp: iat + 3600 }));
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(head + "." + claim));
  return head + "." + claim + "." + b64url(sig);
}
// a constant-time comparison of the caller's key with the service role's
function same(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const clip = (v: unknown, n: number) => String(v == null ? "" : v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch, now = deps.now || (() => Date.now()), log = deps.log || ((...a: unknown[]) => console.log(...a));
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || "");
  const svc = async (path: string, init: RequestInit = {}) => {
    const r = await doFetch(URL_ + path, { ...init, headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json", ...(init.headers || {}) } });
    const t = await r.text();
    let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    if (!r.ok) throw new Error((j && (j.message || j.error)) || ("HTTP " + r.status));
    return j;
  };
  let cached: { token: string, until: number, email: string } | null = null;
  const accessToken = async (sa: any) => {
    if (cached && cached.email === sa.client_email && cached.until > now() + 60_000) return cached.token;
    const r = await doFetch(sa.token_uri || OAUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=" + encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + (await signedAssertion(sa, now())) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) fail(502, "FCM sign-in refused (" + r.status + ")");
    cached = { token: j.access_token, until: now() + (Number(j.expires_in) || 3600) * 1000, email: sa.client_email };
    return cached.token;
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  return async (req: Request): Promise<Response> => {
    try {
      if (req.method !== "POST") fail(405, "POST only.");
      const jwt = String(req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!same(jwt, SERVICE)) fail(401, "The service role only.");
      let b: any = null; try { b = await req.json(); } catch { b = null; }
      if (!b || typeof b !== "object") fail(400, "A JSON body is needed.");
      if (!UUID.test(String(b.firm_id || ""))) fail(400, "firm_id is needed.");
      const users = b.user_ids == null ? null : (Array.isArray(b.user_ids) ? b.user_ids.map(String) : fail(400, "user_ids is a list."));
      if (users && (!users.length || users.length > 200 || users.some((u: string) => !UUID.test(u)))) fail(400, "user_ids: 1 to 200 ids.");
      const kind = KINDS.includes(b.kind) ? b.kind : fail(400, "kind: one of " + KINDS.join(", ") + ".");
      const title = clip(b.title, 120), words = clip(b.body, 400);
      if (!title) fail(400, "A title is needed.");
      const route = /^#\/[\w\-/=&.?%]{0,200}$/.test(String(b.route || "")) ? String(b.route) : "";

      let sa: any = null;
      try {
        const row = ((await svc("/rest/v1/platform_secrets?select=value&name=eq.fcm_service_account")) || [])[0];
        sa = row && row.value ? (typeof row.value === "string" ? JSON.parse(row.value) : row.value) : null;
      } catch { sa = null; }
      if (!sa || !sa.project_id || !sa.client_email || !sa.private_key) {
        log("push-send: no FCM key (platform_secrets fcm_service_account): nothing sent", { firm: b.firm_id, kind });
        return reply(200, { ok: true, sent: 0, skipped: "no_key" });
      }
      const phones: any[] = (await svc("/rest/v1/device_tokens?select=id,token,platform&disabled_at=is.null&firm_id=eq." + b.firm_id
        + (users ? "&user_id=in.(" + users.join(",") + ")" : "") + "&order=last_seen.desc&limit=" + MAX_PHONES)) || [];
      if (!phones.length) return reply(200, { ok: true, sent: 0 });
      const bearer = await accessToken(sa);
      let sent = 0, failed = 0, disabled = 0;
      for (const p of phones) {
        const message = {
          token: p.token,
          notification: { title, body: words },
          data: { kind, route },
          android: { priority: kind === "call" ? "HIGH" : "NORMAL", notification: { channel_id: kind === "call" ? "calls" : "general" } },
          apns: { headers: { "apns-priority": kind === "call" ? "10" : "5" }, payload: { aps: { sound: "default" } } },
        };
        const r = await doFetch(fcmUrl(sa.project_id), { method: "POST", headers: { Authorization: "Bearer " + bearer, "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
        if (r.ok) { sent++; await r.body?.cancel(); continue; }
        failed++;
        const e = await r.json().catch(() => ({}));
        const code = String((e && e.error && (e.error.status || "")) || ""), detail = JSON.stringify((e && e.error && e.error.details) || []);
        const why = r.status === 404 || code === "NOT_FOUND" || /UNREGISTERED/.test(detail) ? "unregistered" : (code === "INVALID_ARGUMENT" && /token/i.test(JSON.stringify(e)) ? "invalid" : "");
        if (why) {
          await svc("/rest/v1/device_tokens?id=eq." + p.id, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ disabled_at: new Date(now()).toISOString(), disabled_why: why }) }).catch(() => null);
          disabled++;
        } else log("push-send: FCM refused a message", r.status, code);
      }
      return reply(200, { ok: true, sent, failed, disabled });
    } catch (e) {
      if (e instanceof Fail) return reply(e.code, { ok: false, error: e.message });
      log("push-send: error", e instanceof Error ? e.message : String(e));
      return reply(500, { ok: false, error: "Push not sent." });
    }
  };
}
