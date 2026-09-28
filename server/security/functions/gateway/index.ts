// TDS Desk gateway: firms use Claude and Google Vision through this, never holding the keys.
// It checks who is asking (and their two-step sign-in), what their plan allows and their balance, charges,
// then calls the provider. Hardened Sep 2026: allowed origins, two-step check, request limits, real refunds.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsFor } from "./cors.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const MODEL_OK = /^claude-(sonnet|opus|haiku|fable)-[\w.-]+$/;
const MAX_TOKENS = 16000;
const MAX_BODY = 25 * 1024 * 1024;

async function secret(admin: any, name: string): Promise<string> {
  const { data } = await admin.from("platform_secrets").select("value").eq("name", name).maybeSingle();
  return data?.value || "";
}

Deno.serve(async (req) => {
  const cors = corsFor(req);
  const reply = (code: number, body: unknown) =>
    new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY) return reply(413, { ok: false, error: "The request is too large." });

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return reply(401, { ok: false, error: "Sign in to the firm account first." });

  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
  const admin = createClient(URL, SERVICE);

  const { data: who } = await asUser.auth.getUser();
  const user = who?.user;
  if (!user) return reply(401, { ok: false, error: "Sign in again." });
  const { data: mfaOk } = await asUser.rpc("mfa_ok");
  if (mfaOk !== true) return reply(403, { ok: false, reason: "mfa", error: "Finish the two-step sign-in first." });

  const { data: member } = await admin.from("members").select("firm_id, role, active").eq("user_id", user.id).maybeSingle();
  if (!member || !member.active) return reply(403, { ok: false, error: "This account is not part of a firm." });

  let body: any = {};
  try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
  const what = String(body.what || "");
  const code = what === "vision" ? "vision" : what === "claude" ? "claude" : "";
  if (!code) return reply(400, { ok: false, error: "Unknown request" });
  const qty = Math.floor(Number(body.qty || 1));
  if (!(qty >= 1 && qty <= 20)) return reply(400, { ok: false, error: "Bad quantity" });
  const ref = String(body.ref || "").slice(0, 120);

  // only what TDS Desk sends is passed on
  let payload: any;
  if (code === "claude") {
    const p = body.payload || {};
    if (!MODEL_OK.test(String(p.model || "")) || !Array.isArray(p.messages) || !p.messages.length) return reply(400, { ok: false, error: "Bad request" });
    payload = { model: p.model, max_tokens: Math.min(MAX_TOKENS, Math.max(1, Number(p.max_tokens) || 4000)), messages: p.messages };
    if (typeof p.system === "string") payload.system = p.system.slice(0, 20000);
  } else {
    const rq = (body.payload || {}).requests;
    if (!Array.isArray(rq) || !rq.length || rq.length > 16) return reply(400, { ok: false, error: "Bad request" });
    payload = { requests: rq };
  }

  // plan and balance decide before anything is sent to the provider
  const { data: charge, error: chargeErr } = await admin.rpc("charge_for", {
    p_firm: member.firm_id, p_user: user.id, p_code: code, p_qty: qty, p_ref: ref, p_note: String(body.note || "").slice(0, 200),
  });
  if (chargeErr) return reply(500, { ok: false, error: "The charge could not be made." });
  if (!charge?.ok) {
    const why = charge?.reason;
    const msg = why === "low_balance"
      ? `Not enough credit: ${charge.needed} needed, ${charge.balance} left. Ask the administrator to add credit.`
      : why === "module_off" ? "This part is switched off for your firm."
      : why === "firm_off" ? "This firm's account is switched off."
      : "This request was not allowed.";
    return reply(402, { ok: false, reason: why, error: msg, balance: charge?.balance });
  }
  const refund = async () => {
    if (!(charge.amount > 0)) return;
    try { await admin.rpc("refund_charge", { p_firm: member.firm_id, p_amount: charge.amount, p_code: code, p_ref: ref, p_user: user.id }); } catch { /* logged by the wallet */ }
  };

  try {
    if (code === "vision") {
      const key = await secret(admin, "google_vision_key");
      if (!key) { await refund(); return reply(503, { ok: false, error: "No Google Vision key is set on the platform yet." }); }
      const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) { await refund(); return reply(r.status, { ok: false, error: j?.error?.message || "Google refused the request." }); }
      return reply(200, { ok: true, charged: charge.amount, balance: charge.balance, data: j });
    }
    const key = await secret(admin, "claude_api_key");
    if (!key) { await refund(); return reply(503, { ok: false, error: "No Claude key is set on the platform yet." }); }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) { await refund(); return reply(r.status, { ok: false, error: j?.error?.message || "Claude refused the request." }); }
    return reply(200, { ok: true, charged: charge.amount, balance: charge.balance, data: j });
  } catch (_e) {
    await refund();
    return reply(502, { ok: false, error: "The provider could not be reached." });
  }
});
