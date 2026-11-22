// assistant-send (next-assistant, phase 1; docs/ASSISTANT-PHASE1.md): the firm's owner sends a client's ticked questions
// by email. Follows server/support-mail: the person's own token, everything read AS that person (row-level security and
// the owner check in ask_send_prepare decide), mail through Resend.
//   POST {client_id, ask_ids: [uuid]}  ->  {ok, sent, test, to, marked} | {ok: false, error}
// The message is built only from questions still needed from the client (ask_send_prepare returns only those; a resolved
// finding or a closed question can never get in: acceptance rule 6) by server/_shared/asks.js, the words the page shows.
// The test-mode guard (server/_shared/sendguard.js): a real client address only when the firm's owner turned real sending
// on AND the secret ASSISTANT_MAIL_LIVE is "yes"; else ONLY the firm's own address, marked TEST. Every try is logged
// (ask_send_begin / ask_send_finish, service role only -> ask_sends, assistant_log). Secrets: RESEND_API_KEY (the one support-mail uses), ASSISTANT_MAIL_FROM
// (a sender on the firm's own domain, verified in Resend), ASSISTANT_MAIL_LIVE (not set on staging). Replies go to the firm.
import { corsFor } from "../_shared/cors.ts";
// @ts-ignore plain JavaScript, shared with the Node tests
import { message } from "../_shared/asks.js";
// @ts-ignore plain JavaScript, shared with the Node tests
import { plan, mail } from "../_shared/sendguard.js";

export type Deps = { env: (k: string) => string | undefined; fetch: typeof fetch };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const monday = (d = new Date()) => { const t = new Date(d.getTime() + 5.5 * 3600_000); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.getUTCDate() + "-" + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][t.getUTCMonth()] + "-" + t.getUTCFullYear(); };

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch;
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), ANON = String(env("SUPABASE_ANON_KEY") || ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || "");
  const KEY = String(env("RESEND_API_KEY") || ""), FROM = String(env("ASSISTANT_MAIL_FROM") || ""), LIVE = String(env("ASSISTANT_MAIL_LIVE") || "");
  const cors = corsFor(null, { any: true, methods: "POST, OPTIONS" });
  const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
  return async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt || jwt === ANON) return reply(401, { ok: false, error: "Sign in first." });
    let body: any = {};
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    const cid = String(body.client_id || ""), ids = (Array.isArray(body.ask_ids) ? body.ask_ids : []).map(String).filter((x: string) => UUID.test(x)).slice(0, 50);
    if (!/^[\w.:-]{1,80}$/.test(cid) || !ids.length) return reply(400, { ok: false, error: "Tick at least one question." });
    const asUser = async (path: string, init: RequestInit = {}) => {
      const r = await doFetch(URL_ + path, { ...init, headers: { apikey: ANON, Authorization: "Bearer " + jwt, "Content-Type": "application/json", ...(init.headers || {}) } });
      const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
      if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status });
      return j;
    };
    const rpc = (fn: string, a: Record<string, unknown>) => asUser("/rest/v1/rpc/" + fn, { method: "POST", body: JSON.stringify(a) });
    // the send log: claimed and finished by this function only (service role), never writable from the page
    const svc = async (fn: string, a: Record<string, unknown>) => {
      const r = await doFetch(URL_ + "/rest/v1/rpc/" + fn, { method: "POST", headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, body: JSON.stringify(a) });
      const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
      if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status });
      return j;
    };
    let prep: any;
    try { prep = await rpc("ask_send_prepare", { p_client: cid, p_ids: ids, p_channel: "email" }); }
    catch (e) { return reply((e as any).status === 401 ? 401 : 403, { ok: false, error: String((e as Error).message || "Not allowed.") }); }
    const me = await asUser("/auth/v1/user").catch(() => null);
    const p = plan({ contacts: prep.contacts || [], realSend: prep.real_send === true, live: LIVE, testTo: prep.test_to, ownerEmail: me && me.email });
    const qs = (prep.questions || []).map((q: any) => ({ state: "ask", ask: { id: q.id, text: q.text, state: q.state } }));
    if (!qs.length) return reply(200, { ok: false, error: "Nothing to send: these questions are answered, closed or resolved." });
    if ((p as any).refused) return reply(200, { ok: false, error: (p as any).refused });
    if (!KEY || !FROM || !SERVICE) return reply(200, { ok: false, error: "Email is not set up yet." });
    // the claim: the owner checked again, the day's limits counted with the claim itself (one at a time per firm)
    let sendId: number;
    try { sendId = await svc("ask_send_begin", { p_firm: prep.firm_id, p_by: prep.by, p_client: cid, p_ids: qs.map((q: any) => q.ask.id), p_channel: "email", p_meant: (p as any).meant || [], p_sent_to: p.to, p_test: p.test }); }
    catch (e) { return reply(200, { ok: false, error: String((e as Error).message || "Not sent.") }); }
    const finish = (st: string, provider: string, why: string) => svc("ask_send_finish", { p_send: sendId, p_status: st, p_provider: provider || null, p_why: why }).catch(() => null);
    const m = message({ name: prep.client || "your company" }, qs, { firm: prep.firm || "", week: monday() });
    const replyTo = prep.test_to || (me && me.email) || "";
    const payload = mail({ from: FROM, replyTo, plan: p, subject: m.subject, text: m.text });
    const r = await doFetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) { await finish("failed", "", String(j.message || r.status).slice(0, 200)); return reply(200, { ok: false, error: "The email could not be sent. Try again later." }); }
    const d: any = await finish("sent", String(j.id || ""), "");
    return reply(200, { ok: true, sent: true, test: p.test, to: payload.to, marked: (d && d.marked) || 0 });
  };
}
