// TDS Desk gateway: firms use Claude and Google Vision through this, never holding the keys.
// It checks who is asking (and their two-step sign-in), what their plan allows and their balance, charges,
// then calls the provider. Hardened Sep 2026: allowed origins, two-step check, request limits, real refunds.
// Oct 2026 (bill reading failed on staging with only "The Claude API refused the request"): every failure is one
// `kind` (classify.ts), answered as {ok:false, kind, error, status, file?}, refunded, and logged as one line.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsFor } from "./cors.ts";
import { classify, declined, errorText, replyStatus } from "./classify.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const MODEL_OK = /^claude-(sonnet|opus|haiku|fable)-[\w.-]+$/;
const MAX_TOKENS = 16000;
const MAX_BODY = 25 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

async function secret(admin: any, name: string): Promise<string> {
  const { data } = await admin.from("platform_secrets").select("value").eq("name", name).maybeSingle();
  return data?.value || "";
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const reply = (code: number, body: unknown, headers?: Record<string, string>) =>
    new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json", ...(headers || {}) } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });

  // one line in the function's log for every failure: who, what, which kind, the provider's own type and request id.
  // Never the bill, the prompt or a key.
  const t0 = Date.now();
  const log = { firm: null as string | null, user: null as string | null, what: "", model: "", file: "", bytes: Number(req.headers.get("content-length") || 0) };
  const fail = (code: number, kind: string, error: string, extra?: Record<string, unknown>, more?: { type?: string, request_id?: string, upstream?: number, headers?: Record<string, string> }) => {
    const m = more || {};
    console.log(JSON.stringify({
      evt: "gateway_fail", at: new Date().toISOString(), firm: log.firm, user: log.user, what: log.what, kind,
      status: m.upstream ?? code, type: m.type || null, request_id: m.request_id || null, model: log.model || null,
      ms: Date.now() - t0, bytes: log.bytes, file: log.file || null,
    }));
    return reply(code, { ok: false, kind, error, status: m.upstream ?? code, ...(log.file ? { file: log.file } : {}), ...(extra || {}) }, m.headers);
  };

  if (log.bytes > MAX_BODY) return fail(413, "too_large", errorText("too_large", { limitMb: MAX_BODY / 1024 / 1024 }));

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return fail(401, "other", "Sign in to the firm account first.");

  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const admin = createClient(URL, SERVICE);

  const { data: who } = await asUser.auth.getUser();
  const user = who?.user;
  if (!user) return fail(401, "other", "Sign in again.");
  log.user = user.id;
  const { data: mfaOk } = await asUser.rpc("mfa_ok");
  if (mfaOk !== true) return fail(403, "other", "Finish the two-step sign-in first.", { reason: "mfa" });

  const { data: member } = await admin.from("members").select("firm_id, role, active").eq("user_id", user.id).maybeSingle();
  if (!member || !member.active) return fail(403, "other", "This account is not part of a firm.");
  log.firm = member.firm_id;

  let body: any = {};
  try { body = await req.json(); } catch { return fail(400, "other", "Bad request"); }
  const what = String(body.what || "");
  log.what = what.slice(0, 20);
  // the file's name only (the app sends it so a failure can be traced to a bill); never its contents
  log.file = String(body.file || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200);
  const code = what === "vision" ? "vision" : what === "claude" ? "claude" : "";
  if (!code) return fail(400, "other", "Unknown request");
  const qty = Math.floor(Number(body.qty || 1));
  if (!(qty >= 1 && qty <= 20)) return fail(400, "other", "Bad quantity");
  const ref = String(body.ref || "").slice(0, 120);

  // only what TDS Desk sends is passed on
  let payload: any;
  if (code === "claude") {
    const p = body.payload || {};
    log.model = String(p.model || "").slice(0, 80);
    if (!MODEL_OK.test(String(p.model || ""))) return fail(400, "bad_model", errorText("bad_model", { model: log.model }));
    if (!Array.isArray(p.messages) || !p.messages.length) return fail(400, "other", "Bad request");
    payload = { model: p.model, max_tokens: Math.min(MAX_TOKENS, Math.max(1, Number(p.max_tokens) || 4000)), messages: p.messages };
    if (typeof p.system === "string") payload.system = p.system.slice(0, 20000);
  } else {
    const rq = (body.payload || {}).requests;
    if (!Array.isArray(rq) || !rq.length || rq.length > 16) return fail(400, "other", "Bad request");
    payload = { requests: rq };
  }

  // plan and balance decide before anything is sent to the provider
  const { data: charge, error: chargeErr } = await admin.rpc("charge_for", {
    p_firm: member.firm_id, p_user: user.id, p_code: code, p_qty: qty, p_ref: ref, p_note: String(body.note || "").slice(0, 200),
  });
  if (chargeErr) return fail(500, "other", "The charge could not be made.");
  if (!charge?.ok) {
    const why = charge?.reason;
    const msg = why === "low_balance"
      ? `Not enough credit: ${charge.needed} needed, ${charge.balance} left. Ask the administrator to add credit.`
      : why === "module_off" ? "This part is switched off for your firm."
      : why === "firm_off" ? "This firm's account is switched off."
      : "This request was not allowed.";
    return fail(402, why === "low_balance" ? "no_credit" : "other", msg, { reason: why, balance: charge?.balance });
  }
  const refund = async () => {
    if (!(charge.amount > 0)) return;
    try { await admin.rpc("refund_charge", { p_firm: member.firm_id, p_amount: charge.amount, p_code: code, p_ref: ref, p_user: user.id }); } catch { /* logged by the wallet */ }
  };
  // the provider's answer as JSON, or {} when it sent none (a 529 or a proxy page)
  const readJson = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return {}; } };

  if (code === "vision") {
    try {
      const key = await secret(admin, "google_vision_key");
      if (!key) { await refund(); return fail(503, "bad_key", "No Google Vision key is set on the platform yet."); }
      const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const j = await readJson(r);
      if (!r.ok) {
        await refund();
        const msg = j?.error?.message || "", kind = classify(r.status, j?.error?.status, msg);
        return fail(replyStatus(kind, r.status), kind, msg || errorText(kind), {}, { type: j?.error?.status, upstream: r.status });
      }
      return reply(200, { ok: true, charged: charge.amount, balance: charge.balance, data: j });
    } catch (e) {
      await refund();
      const kind = (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError" ? "timed_out" : "not_reached";
      return fail(replyStatus(kind, 0), kind, errorText(kind));
    }
  }

  let key = "";
  try { key = await secret(admin, "claude_api_key"); } catch { /* answered below */ }
  if (!key) { await refund(); return fail(503, "bad_key", "No Claude key is set on the platform yet. Ask the administrator."); }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
  } catch (_e) {
    clearTimeout(timer);
    await refund();
    const kind = ctl.signal.aborted ? "timed_out" : "not_reached";
    return fail(replyStatus(kind, 0), kind, errorText(kind));
  }
  let j: any;
  try { j = await readJson(r); }
  catch (_e) {
    clearTimeout(timer);
    await refund();
    const kind = ctl.signal.aborted ? "timed_out" : "not_reached";
    return fail(replyStatus(kind, 0), kind, errorText(kind), {}, { upstream: r.status, request_id: r.headers.get("request-id") || undefined });
  }
  clearTimeout(timer);
  const request_id = r.headers.get("request-id") || j?.request_id || undefined;
  if (!r.ok) {
    await refund();
    const type = j?.error?.type, detail = j?.error?.message || "";
    const kind = classify(r.status, type, detail);
    const extra: Record<string, unknown> = {};
    const headers: Record<string, string> = {};
    const ra = r.headers.get("retry-after");
    if (kind === "rate_limit" && ra) { extra.retry_after = Number(ra) || ra; headers["Retry-After"] = ra; }
    if (detail) extra.detail = String(detail).slice(0, 300);
    if (kind === "bad_model") extra.model = log.model;
    return fail(replyStatus(kind, r.status), kind, errorText(kind, { model: log.model, detail, limitMb: MAX_BODY / 1024 / 1024 }), extra, { type, request_id, upstream: r.status, headers });
  }
  const no = declined(j);
  if (no) {
    await refund();
    return fail(replyStatus("declined", 200), "declined", errorText("declined", { category: no.category }), { category: no.category || null }, { type: "refusal", request_id, upstream: 200 });
  }
  return reply(200, { ok: true, charged: charge.amount, balance: charge.balance, data: j });
});
