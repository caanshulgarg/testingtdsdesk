// signup v12 (26-Oct-2026): self-service sign-up with the email confirmed first, and the person's own firm with
// ₹10,000 made on their first sign-in (provision); invites and the administrator's path as in v11. The rules are in
// handler.ts (Deno tests: handler_test.ts). Deployed as uploaded files (index.ts, handler.ts), verify_jwt off: the
// public answer needs no sign-in, and provision and the administrator's path check the token themselves.
// Rollback: v11 (commit 209c0219b, invite only); before it v10 (its source is v10-deployed.ts.txt here).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { type AdminCaller, type AuthUser, type CreateFirm, type Db, makeHandler, RateLimiter, type SignUpForm } from "./handler.ts";

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
  // OWASP review 26-Oct-2026: is_superadmin() is a platform_admins row AND an aal2 token (the database's rule); mfa_ok()
  // is true for anyone with no second factor, so it let the administrator's path run on the password alone
  const { data: isSuper } = await asUser.rpc("is_superadmin");
  return isSuper === true ? { userId: user.id } : null;
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

// ---------- v12: sign-up through Supabase Auth, and the firm made on the first sign-in ----------
const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
async function authSignUp(f: SignUpForm): Promise<void> {
  // "Confirm email" is on: a new email gets an unconfirmed login and Supabase's confirmation email; an email with a
  // confirmed login gets nothing (Supabase answers with a stand-in user); an unconfirmed one gets the link again
  const anon = createClient(URL, ANON, { auth: noSession });
  await anon.auth.signUp({ email: f.email, password: f.password, options: { emailRedirectTo: f.redirect || APP, data: { name: f.name, firm: f.firm } } });
}

async function authUser(jwt: string): Promise<AuthUser | null> {
  const { data, error } = await admin.auth.getUser(jwt);
  const u: any = data?.user;
  if (error || !u?.id) return null;
  const um = u.user_metadata || {}, am = u.app_metadata || {};
  return {
    id: u.id, email: String(u.email || "").trim().toLowerCase(), confirmed: !!u.email_confirmed_at,
    name: String(um.name || um.full_name || "").trim(), firm: String(um.firm || "").trim(), provider: String(am.provider || "email"),
    signupFirm: typeof am.signup_firm === "string" ? am.signup_firm : null,
  };
}

const dup = (e: any) => !!e && e.code === "23505";
const must = (e: any) => { if (e) throw new Error(e.message || String(e)); };
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
async function signupPlan() {
  const { data: setting } = await admin.from("app_settings").select("value").eq("name", "signup").maybeSingle();
  const { data: plan } = await admin.from("plans").select("id, includes").eq("name", setting?.value?.plan || "Pay as you go").maybeSingle();
  return plan as { id: string; includes: any } | null;
}
const db: Db = {
  async memberOf(uid) {
    const { data, error } = await admin.from("members").select("firm_id").eq("user_id", uid).maybeSingle(); must(error);
    return data?.firm_id ?? null;
  },
  async memberEmailElsewhere(email, uid) {
    const { data, error } = await admin.from("members").select("user_id").ilike("email", likeExact(email)).neq("user_id", uid).limit(1); must(error);
    return (data || []).length > 0;
  },
  async isPlatformAdmin(uid) {
    const { data, error } = await admin.from("platform_admins").select("user_id").eq("user_id", uid).maybeSingle(); must(error);
    return !!data;
  },
  async firm(id) {
    const { data, error } = await admin.from("firms").select("created_at").eq("id", id).maybeSingle(); must(error);
    return data ? { createdAt: Date.parse(data.created_at) } : null;
  },
  async insertFirm(row) {
    const plan = await signupPlan();
    const { error } = await admin.from("firms").insert({ ...row, plan_id: plan?.id || null });
    if (dup(error)) return false;
    must(error); return true;
  },
  async deleteFirm(id) { const { error } = await admin.from("firms").delete().eq("id", id); must(error); },
  async insertMember(row) {
    const { error } = await admin.from("members").insert(row);
    if (dup(error)) return false;
    must(error); return true;
  },
  async hasOpeningCredit(firmId) {
    const { data, error } = await admin.from("wallet_entries").select("id").eq("firm_id", firmId).eq("kind", "credit").eq("ref", "signup").limit(1); must(error);
    return (data || []).length > 0;
  },
  async insertOpeningCredit(firmId, amount, byUser) {
    const { error } = await admin.from("wallet_entries").insert({ firm_id: firmId, kind: "credit", code: "wallet", qty: 1, amount, balance_after: amount, note: "Credit to start with", ref: "signup", by_user: byUser });
    must(error);
  },
  async afterCreate(firmId, userId, detail) {
    const plan = await signupPlan();
    const perClient = plan?.includes?.clients_price;
    if (perClient) await admin.from("firm_modules").upsert({ firm_id: firmId, code: "clients", enabled: true, price: perClient }, { onConflict: "firm_id,code", ignoreDuplicates: true });
    await admin.from("activity").insert({ firm_id: firmId, user_id: userId, client_id: "", what: "signup.firm", detail }).then(() => {}, () => {});
  },
  async markUser(u, firmId) {
    // app_metadata is written only by the server; Supabase merges the key into what is there
    const { error } = await admin.auth.admin.updateUserById(u.id, { app_metadata: { signup_firm: firmId } }); must(error);
  },
};

const handler = makeHandler({
  platformAdmin, invitePending, sendSetPasswordLink, createFirm, authSignUp, authUser, db,
  background: (p) => { try { (globalThis as any).EdgeRuntime?.waitUntil(p); } catch { /* the promise still runs */ } },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  random: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
  limits: {
    ip: new RateLimiter(10, 10 * 60_000),      // 10 tries per address per 10 minutes
    email: new RateLimiter(5, 60 * 60_000),    // 5 tries per email per hour
    link: new RateLimiter(1, 15 * 60_000),     // at most one set-password email per email per 15 minutes
    provision: new RateLimiter(30, 10 * 60_000),   // 30 provision calls per address per 10 minutes
  },
});

Deno.serve(handler);
