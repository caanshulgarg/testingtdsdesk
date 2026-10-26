// signup v11 (26-Oct-2026, audit H3): by invitation only; the rules are in handler.ts (Deno tests: handler_test.ts).
// Deployed as uploaded files (index.ts, handler.ts), verify_jwt off: the public answer needs no sign-in, and the
// administrator's path checks the token itself. Rollback: v10 (its source is v10-deployed.ts.txt here).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type AdminCaller, type CreateFirm, makeHandler, RateLimiter } from "./handler.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
// set-password links go through Resend when it is set up (as the admin function's invites), else Supabase Auth's mailer
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const FROM = Deno.env.get("INVITE_MAIL_FROM") || "FinCom <no-reply@fincom.live>";
const APP = Deno.env.get("APP_URL") || "https://staging.fincom.live/";

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

async function platformAdmin(jwt: string): Promise<AdminCaller | null> {
  const asUser = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
  const { data: who } = await asUser.auth.getUser();
  const user = who?.user;
  if (!user) return null;
  const { data: row } = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!row) return null;
  const { data: mfaOk } = await asUser.rpc("mfa_ok");
  return mfaOk === true ? { userId: user.id } : null;
}

async function invitePending(email: string): Promise<boolean> {
  const { data: m } = await admin.from("members").select("user_id, active").eq("email", email).eq("active", true).limit(1).maybeSingle();
  if (!m?.user_id) return false;
  const { data } = await admin.auth.admin.getUserById(m.user_id);
  const u = data?.user;
  return !!u && (u.email || "").toLowerCase() === email && !u.last_sign_in_at;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
async function sendSetPasswordLink(email: string): Promise<void> {
  if (RESEND) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo: APP } });
    if (error) return;
    const link = data.properties?.action_link || "";
    await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + RESEND, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [email], subject: "Set your FinCom password",
        html: "<p>You have been invited to your firm's FinCom account. Choose your password here (the link works once):</p><p><a href=\"" + esc(link) + "\">Set my password</a></p>" }),
    });
    return;
  }
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  await anon.auth.resetPasswordForEmail(email, { redirectTo: APP });
}

async function findUser(mail: string) {
  for (let page = 1; page <= 50; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const users = data?.users || [];
    const u = users.find((x: any) => (x.email || "").toLowerCase() === mail);
    if (u) return u;
    if (users.length < 200) return null;
  }
  return null;
}

function madeUpPassword(): string {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  for (const x of crypto.getRandomValues(new Uint8Array(16))) s += abc[x % abc.length];
  return s.slice(0, 4) + "-" + s.slice(4, 8) + "-" + s.slice(8, 12) + "-" + s.slice(12);
}

async function createFirm(by: AdminCaller, f: CreateFirm) {
  let target: any = await findUser(f.email);
  if (target) {
    const { data: theirs } = await admin.from("members").select("firm_id").eq("user_id", target.id).maybeSingle();
    if (theirs) return { status: 409, body: { ok: false, error: "This email already belongs to a firm's login." } };
  }
  const { data: setting } = await admin.from("app_settings").select("value").eq("name", "signup").maybeSingle();
  const planName = f.plan || setting?.value?.plan || "Pay as you go";
  const { data: plan } = await admin.from("plans").select("id, includes").eq("name", planName).maybeSingle();
  const { data: firm, error: fErr } = await admin.from("firms")
    .insert({ name: f.firm, plan_id: plan?.id || null, balance: f.credit, note: "Made by the administrator (signup)" })
    .select("id").single();
  if (fErr) return { status: 400, body: { ok: false, error: fErr.message } };
  let password: string | null = null;
  if (!target) {
    password = f.password || madeUpPassword();
    const { data, error } = await admin.auth.admin.createUser({ email: f.email, password, email_confirm: true, user_metadata: { name: f.name } });
    if (error) { await admin.from("firms").delete().eq("id", firm.id); return { status: 400, body: { ok: false, error: error.message } }; }
    target = data.user;
  }
  await admin.from("members").upsert({ user_id: target.id, firm_id: firm.id, name: f.name, email: f.email, role: "owner", active: true });
  if (f.credit > 0) {
    await admin.from("wallet_entries").insert({ firm_id: firm.id, kind: "credit", code: "wallet", qty: 1, amount: f.credit, balance_after: f.credit, note: "Opening credit", by_user: by.userId });
  }
  const perClient = plan?.includes?.clients_price;
  if (perClient) await admin.from("firm_modules").insert({ firm_id: firm.id, code: "clients", enabled: true, price: perClient });
  await admin.from("activity").insert({ firm_id: firm.id, user_id: by.userId, client_id: "", what: "admin.create_firm", detail: (f.firm + " owner " + f.email + " (signup)").slice(0, 500) }).then(() => {}, () => {});
  return { status: 200, body: password && !f.password ? { ok: true, firm_id: firm.id, email: f.email, password } : { ok: true, firm_id: firm.id, email: f.email } };
}

const handler = makeHandler({
  platformAdmin, invitePending, sendSetPasswordLink, createFirm,
  background: (p) => { try { (globalThis as any).EdgeRuntime?.waitUntil(p); } catch { /* the promise still runs */ } },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  random: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
  limits: {
    ip: new RateLimiter(10, 10 * 60_000),      // 10 tries per address per 10 minutes
    email: new RateLimiter(5, 60 * 60_000),    // 5 tries per email per hour
    link: new RateLimiter(1, 15 * 60_000),     // at most one set-password email per email per 15 minutes
  },
});

Deno.serve(handler);
