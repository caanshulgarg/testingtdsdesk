// TDS Desk help desk emails: after a ticket is raised or answered, the app calls this with the ticket's id.
// The rules are in handler.ts (Deno tests: handler_test.ts); this wires the real services.
// Mail goes through Resend. Secrets: RESEND_API_KEY, SUPPORT_MAIL_TO, SUPPORT_MAIL_FROM (a sender on a domain
// verified in Resend), APP_URL. Until RESEND_API_KEY and SUPPORT_MAIL_TO are set it answers {sent:false} and
// the ticket itself is unaffected. Deployed as uploaded files: index.ts, handler.ts, ../_shared/cors.ts, ../_shared/errors.ts
// (publicError: what a caller is told when something fails inside).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsFor } from "../_shared/cors.ts";   // the one list of headers for every function (server/_shared/cors.ts)
import { makeHandler } from "./handler.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
// the service role, for the shared counts only (migration 112): a message is emailed once, a ticket a few a day.
// Without migration 112 the email is still sent and the missing count is logged
const admin = createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false, autoRefreshToken: false } });
const must = <T>(r: { data: T; error: any }) => { if (r.error) throw new Error(r.error.message || String(r.error)); return r.data; };
// "*": every call carries the person's sign-in token, and the ticket is read as them
const cors = corsFor(null, { any: true, methods: "POST, OPTIONS" });
const asUser = (jwt: string) => createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });

Deno.serve(makeHandler({
  cors,
  key: Deno.env.get("RESEND_API_KEY") || "", to: Deno.env.get("SUPPORT_MAIL_TO") || "",
  from: Deno.env.get("SUPPORT_MAIL_FROM") || "TDS Desk Support <onboarding@resend.dev>",
  app: Deno.env.get("APP_URL") || "https://caanshulgarg.github.io/testingtdsdesk/",
  mfaOk: async (jwt) => (await asUser(jwt).rpc("mfa_ok")).data === true,
  ticket: async (jwt, id) => { const { data, error } = await asUser(jwt).rpc("support_get", { p_ticket: id }); return { t: data || null, error: error ? error.message : null }; },
  send: async (m) => {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + (Deno.env.get("RESEND_API_KEY") || ""), "Content-Type": "application/json" }, body: JSON.stringify(m) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, message: j.message };
  },
  count: async (bucket, key, windowS) => Number(must(await admin.rpc("auth_rate_count", { p_bucket: bucket, p_key: key, p_window_s: windowS }))) || 0,
  add: async (bucket, key) => { must(await admin.rpc("auth_rate_add", { p_bucket: bucket, p_key: key })); },
  hit: async (bucket, key, max, windowS) => must(await admin.rpc("auth_rate_hit", { p_bucket: bucket, p_key: key, p_max: max, p_window_s: windowS })) === true,
}));
