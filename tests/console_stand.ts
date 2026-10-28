// tests/console_stand.ts: a stand-in for Supabase for the console's screen tests (tests/run_console_ui.py). It serves
//   /auth/v1/*                     a small fake of Supabase Auth: password sign-in, TOTP enrol / challenge / verify
//                                  (the code 123456), refresh, logout, banned logins
//   /functions/v1/console-admin    the REAL router and modules (server/console), with in-memory services that keep the
//                                  database functions' rules (audit rows, roles, the last owner, statuses)
// No network, no real database. Run: deno run --allow-net --allow-env tests/console_stand.ts <port> <page origin>
import { makeHandler } from "../server/console/core/router.ts";
import { type Deps } from "../server/console/core/types.ts";
import { MODULES } from "../server/console/registry.ts";
import { billingFake } from "./console_billing_fake.ts";
import { couponsFake } from "./console_coupons_fake.ts";
import { aiRpc } from "./console_stand_ai.ts";
import { ENV, NOPE, OPS, opsFake, opsHttp } from "./console_ops_fake.ts";

const port = Number(Deno.args[0] || 8172);
const pageOrigin = Deno.args[1] || "http://localhost:8171";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Login = { id: string; email: string; password: string; factors: { id: string; factor_type: string; status: string; friendly_name?: string; created_at: string }[]; banned?: boolean; last?: string };
const now = () => new Date().toISOString();
const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const logins: Login[] = [
  { id: U(1), email: "owner@fincom.live", password: "Owner-pass-123", factors: [{ id: "f-owner", factor_type: "totp", status: "verified", created_at: ago(30) }] },
  { id: U(2), email: "billing@fincom.live", password: "Billing-pass-123", factors: [{ id: "f-bill", factor_type: "totp", status: "verified", created_at: ago(10) }] },
  { id: U(3), email: "support@fincom.live", password: "Support-pass-123", factors: [{ id: "f-sup", factor_type: "totp", status: "verified", created_at: ago(10) }] },
  { id: U(4), email: "viewer@fincom.live", password: "Viewer-pass-123", factors: [{ id: "f-view", factor_type: "totp", status: "verified", created_at: ago(10) }] },
  { id: U(5), email: "new@fincom.live", password: "Newbie-pass-123", factors: [] },
  { id: U(6), email: "stranger@fincom.live", password: "Stranger-pass-123", factors: [{ id: "f-str", factor_type: "totp", status: "verified", created_at: ago(3) }] },
  { id: U(11), email: "asha@abc.test", password: "x", factors: [{ id: "f-asha", factor_type: "totp", status: "verified", created_at: ago(40) }], last: ago(1) },
  { id: U(12), email: "ravi@abc.test", password: "x", factors: [], last: ago(9) },
  { id: U(13), email: "bina@gsc.test", password: "x", factors: [], last: ago(20) },
  { id: U(14), email: "off@zz.test", password: "Off-pass-123", factors: [], banned: true },
];
const admins = new Map<string, { role: string; active: boolean; added_at: string; added_by: string | null }>([
  [U(1), { role: "owner", active: true, added_at: ago(30), added_by: null }], [U(2), { role: "billing", active: true, added_at: ago(10), added_by: U(1) }],
  [U(3), { role: "support", active: true, added_at: ago(10), added_by: U(1) }], [U(4), { role: "viewer", active: true, added_at: ago(10), added_by: U(1) }],
  [U(5), { role: "owner", active: true, added_at: ago(1), added_by: U(1) }],
]);
const F1 = U(101), F2 = U(102), F3 = U(103);
const firms = [
  { id: F1, name: "ABC Associates", plan: "Pay as you go", status: "active", status_reason: null as string | null, status_at: null as string | null, status_by: null as string | null, balance: 4999.5, low_balance_warn: 500, created_at: ago(60), active: true },
  { id: F2, name: "Garg Shekhar & Co", plan: "Monthly, all included", status: "active", status_reason: null, status_at: null, status_by: null, balance: 175, low_balance_warn: 500, created_at: ago(5), active: true },
  { id: F3, name: "ZZ Test Firm", plan: "Per client", status: "suspended", status_reason: "Test firm, paused", status_at: ago(2), status_by: U(1), balance: 1000, low_balance_warn: 500, created_at: ago(40), active: true },
];
const members = [
  { user_id: U(11), firm_id: F1, name: "Asha Rao", role: "owner", active: true, off: false },
  { user_id: U(12), firm_id: F1, name: "Ravi Kumar", role: "staff", active: true, off: false },
  { user_id: U(13), firm_id: F2, name: "Bina Garg", role: "owner", active: true, off: false },
  { user_id: U(14), firm_id: F3, name: "Off Person", role: "readonly", active: false, off: true },
];
const companies = [
  { id: "c1", firm_id: F1, name: "Mehta Textiles", gstin: "27AAACM1234A1Z5", status: "active", status_reason: null as string | null, status_at: null as string | null, deleted: false },
  { id: "c2", firm_id: F1, name: "Shree Traders", gstin: "", status: "deactivated", status_reason: "Client left", status_at: ago(3), deleted: false },
  { id: "c3", firm_id: F2, name: "Bharat Steel", gstin: "24AAACB9999B1Z1", status: "active", status_reason: null, status_at: null, deleted: false },
];
for (let i = 0; i < 30; i++) firms.push({ id: U(200 + i), name: `Firm ${String(i).padStart(2, "0")}`, plan: i % 2 ? "Pay as you go" : "Per client", status: i % 7 === 0 ? "suspended" : "active", status_reason: i % 7 === 0 ? "unpaid" : null, status_at: null, status_by: null, balance: i * 100, low_balance_warn: 500, created_at: ago(100 - i), active: true });
const audit: any[] = [];
const emailOf = (id: string | null) => logins.find((l) => l.id === id)?.email || "";
const err = (code: string) => { throw new Error("console: " + code); };
const roleOf = (by: string) => { const a = admins.get(by); return a?.active ? a.role : ""; };
const need = (by: string, roles: string[]) => { if (!roles.includes(roleOf(by))) err("not_allowed"); return roleOf(by); };
const addAudit = (a: any, action: string, tt: string, tid: string, before: unknown, after: unknown) =>
  audit.push({ id: audit.length + 1, at: now(), who: a.p_by, role: roleOf(a.p_by), action, target_type: tt, target_id: tid, before, after, reason: a.p_reason, ip: a.p_ip, user_agent: a.p_ua });
// the coupons module's functions (migration 120), in memory with their rules
const coupons = couponsFake({ roleOf, audit: addAudit, emailOf });
const memberRow = (m: typeof members[0]) => {
  const l = logins.find((x) => x.id === m.user_id)!, f = firms.find((x) => x.id === m.firm_id)!;
  return { user_id: m.user_id, name: m.name, email: l.email, firm_id: m.firm_id, firm: f.name, role: m.role, active: m.active, last_sign_in_at: l.last || null,
           mfa: l.factors.some((x) => x.status === "verified"), switched_off: m.off, firm_status: f.status };
};

// the billing module's functions (migration 119), in memory: the first three firms plus a few more
const bill = billingFake([...firms.slice(0, 8), { id: U(150), name: "Big Test Credit", balance: 499999610 }] as any, { roleOf, audit: (a, action, tt, tid, before, after) => addAudit(a, action, tt, tid, before, after) });
// phase 5 (keys, announcements, flags, support, health, exports, see as this firm): tests/console_ops_fake.ts
const ops = opsFake({ audit: (r) => audit.push({ id: audit.length + 1, at: now(), ...r, user_agent: null }), auditRows: () => audit, roleOf: (id) => roleOf(id) || undefined,
  emailOf: (id) => emailOf(id), firms: firms.map((f) => ({ id: f.id, name: f.name, plan_id: f.plan === "Monthly, all included" ? OPS.P2 : OPS.P1, balance: f.balance })) });
const outbound: { url: string }[] = [];
async function rpc(fn: string, a: any): Promise<any> {
  const o = await ops.rpc(fn, a);
  if (o !== NOPE) return o;
  switch (fn) {
    case "console_audit_add":
      audit.push({ id: audit.length + 1, at: now(), who: a.p_who, role: a.p_role, action: a.p_action, target_type: a.p_target_type, target_id: a.p_target_id, before: a.p_before, after: a.p_after, reason: a.p_reason, ip: a.p_ip, user_agent: a.p_ua });
      return audit.length;
    case "console_dashboard": return {
      firms: firms.length, firms_active: firms.length, people: members.filter((m) => m.active).length, active_7d: 1, active_30d: 3, signups_7d: 1, credit_held: firms.reduce((s, f) => s + f.balance, 0),
      low_balance: 3, by_plan: [{ plan: "Pay as you go", n: 16 }, { plan: "Per client", n: 16 }, { plan: "Monthly, all included", n: 1 }],
      recent: [...firms].sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, 5).map((f) => ({ id: f.id, name: f.name, created_at: f.created_at, plan: f.plan })),
      bridges_online: 1, bridges: 2, failed_jobs_today: 1, ai_calls_today: 9, as_of: now() };
    case "console_firms": return { rows: firms.map((f) => ({ ...f, owner_email: emailOf(members.find((m) => m.firm_id === f.id && m.role === "owner")?.user_id || null) || null,
      members: members.filter((m) => m.firm_id === f.id && m.active).length, clients: companies.filter((c) => c.firm_id === f.id).length, last_activity: f.id === F1 ? ago(0.1) : null })) };
    case "console_firm": {
      const f = firms.find((x) => x.id === a.p_firm); if (!f) return null;
      return { ...f, status_by: emailOf(f.status_by), period_start: "2026-10-01", clients: companies.filter((c) => c.firm_id === f.id).length,
               clients_off: companies.filter((c) => c.firm_id === f.id && c.status !== "active").length, bridges: 1,
               members: members.filter((m) => m.firm_id === f.id).map(memberRow), recent: [{ at: ago(0.1), what: "post.voucher", user_id: U(11) }] };
    }
    case "console_users": return { rows: members.filter((m) => !a.p_firm || m.firm_id === a.p_firm).map(memberRow) };
    case "console_user": {
      const l = logins.find((x) => x.id === a.p_user); if (!l) return null;
      const m = members.find((x) => x.user_id === l.id);
      return { user_id: l.id, email: l.email, created_at: ago(90), last_sign_in_at: l.last || null, email_confirmed: true, provider: "email", banned_until: l.banned ? "2126-01-01T00:00:00Z" : null,
               switched_off: !!m?.off, name: m?.name, firm_id: m?.firm_id, firm: firms.find((f) => f.id === m?.firm_id)?.name, role: m?.role, active: m?.active,
               console_role: roleOf(l.id) || null, sessions: 2, factors: l.factors.map((f) => ({ id: f.id, type: f.factor_type, status: f.status, name: f.friendly_name || null, created_at: f.created_at })),
               recent: [{ at: ago(0.2), what: "signin" }] };
    }
    case "console_companies": return { rows: companies.filter((c) => !a.p_firm || c.firm_id === a.p_firm).map((c) => ({ ...c, firm: firms.find((f) => f.id === c.firm_id)!.name })) };
    case "console_company": {
      const c = companies.find((x) => x.firm_id === a.p_firm && x.id === a.p_client); if (!c) return null;
      const f = firms.find((x) => x.id === c.firm_id)!;
      return { ...c, firm: f.name, firm_status: f.status, status_by: "support@fincom.live", postings_waiting: 0 };
    }
    case "console_audit_list": return { rows: audit.filter((r) => !a.p_scope_role || r.who === a.p_scope_who || r.role === a.p_scope_role)
      .filter((r) => (!a.p_from || r.at >= a.p_from) && (!a.p_to || r.at < a.p_to)).map((r) => ({ ...r, who_email: emailOf(r.who) })).reverse() };
    case "console_admins_list": return [...admins].map(([k, v]) => ({ user_id: k, email: emailOf(k), ...v, added_by_email: emailOf(v.added_by), mfa: !!logins.find((l) => l.id === k)?.factors.length, last_sign_in_at: ago(1) }));
    case "console_admin_add": {
      need(a.p_by, ["owner"]);
      const l = logins.find((x) => x.email === String(a.p_email).toLowerCase()); if (!l) err("no_login");
      if (admins.get(l!.id)?.active) err("already_admin");
      if (!["owner", "billing", "support", "viewer"].includes(a.p_role)) err("bad_role");
      admins.set(l!.id, { role: a.p_role, active: true, added_at: now(), added_by: a.p_by }); addAudit(a, "admins.add", "admin", l!.id, null, { role: a.p_role }); return { user_id: l!.id };
    }
    case "console_admin_set_role": {
      need(a.p_by, ["owner"]); if (a.p_by === a.p_user) err("own_role");
      const r = admins.get(a.p_user); if (!r?.active) err("not_admin");
      addAudit(a, "admins.set_role", "admin", a.p_user, { role: r!.role }, { role: a.p_role }); r!.role = a.p_role; return {};
    }
    case "console_admin_remove": {
      need(a.p_by, ["owner"]); if (a.p_by === a.p_user) err("own_role");
      const r = admins.get(a.p_user); if (!r?.active) err("not_admin");
      if (r!.role === "owner" && ![...admins].some(([k, v]) => k !== a.p_user && v.active && v.role === "owner")) err("last_owner");
      r!.active = false; addAudit(a, "admins.remove", "admin", a.p_user, { active: true }, { active: false }); return {};
    }
    case "console_signout_all": return 2;
    case "console_user_set_active": {
      need(a.p_by, ["owner", "support"]);
      for (const m of members.filter((x) => x.user_id === a.p_user)) { if (a.p_active && m.off) { m.active = true; m.off = false; } else if (!a.p_active && m.active) { m.active = false; m.off = true; } }
      addAudit(a, a.p_active ? "user.reactivate" : "user.deactivate", "user", a.p_user, null, { active: a.p_active }); return { active: a.p_active };
    }
    case "console_firm_set_status": {
      need(a.p_by, ["owner"]);
      const f = firms.find((x) => x.id === a.p_firm); if (!f) err("no_firm");
      if (f!.status === a.p_status) err("same_status");
      addAudit(a, a.p_status === "active" ? "firm.reactivate" : "firm.deactivate", "firm", a.p_firm, { status: f!.status }, { status: a.p_status });
      Object.assign(f!, { status: a.p_status, status_reason: a.p_reason, status_at: now(), status_by: a.p_by }); return {};
    }
    case "console_company_set_status": {
      need(a.p_by, ["owner", "support"]);
      const c = companies.find((x) => x.firm_id === a.p_firm && x.id === a.p_client); if (!c) err("no_company");
      if (c!.status === a.p_status) err("same_status");
      addAudit(a, a.p_status === "active" ? "company.reactivate" : "company.deactivate", "company", a.p_firm + "/" + a.p_client, { status: c!.status }, { status: a.p_status });
      Object.assign(c!, { status: a.p_status, status_reason: a.p_reason, status_at: now() }); return {};
    }
  }
  const b = await bill(fn, a);
  if (b !== undefined) return b;
  const c = coupons.rpc(fn, a);
  if (c !== undefined) return c;
  const ai = aiRpc(fn, a, { roleOf, addAudit, firms });      // the AI control centre (console_stand_ai.ts)
  if (ai !== undefined) return ai;
  throw new Error("stand: no rpc " + fn);
}

// tokens: header.payload.sig with the payload readable (aal); the stand keeps which login each one is
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const tokens = new Map<string, { id: string; aal: string }>();
let n = 0;
function session(l: Login, aal: string) {
  const access = `${b64({ alg: "HS256" })}.${b64({ sub: l.id, aal, n: ++n, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  const refresh = "r" + n;
  tokens.set(access, { id: l.id, aal }); tokens.set(refresh, { id: l.id, aal });
  return { access_token: access, refresh_token: refresh, expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: l.id, email: l.email } };
}
const deps: Deps = {
  getUser: async (jwt) => { const t = tokens.get(jwt); const l = t && logins.find((x) => x.id === t.id); return l ? { id: l.id, email: l.email } : null; },
  adminRow: async (id) => admins.get(id) || null,
  rpc,
  mfaFactors: async (id) => logins.find((l) => l.id === id)?.factors || [],
  mfaDelete: async (id, fid) => { const l = logins.find((x) => x.id === id)!; l.factors = l.factors.filter((f) => f.id !== fid); },
  authBan: async (id, b) => { const l = logins.find((x) => x.id === id); if (l) l.banned = b; },
  rateHit: async () => true,
  origins: [pageOrigin],
  log: (m, e) => console.error("stand:", m, e instanceof Error ? e.message : e ?? ""),
  http: opsHttp(outbound),
  env: (k) => ENV[k],
};
const fn = makeHandler(deps, MODULES);
const CORS = { "Access-Control-Allow-Origin": pageOrigin, "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve({ port, hostname: "127.0.0.1", onListen: () => console.log("stand ready " + port) }, async (req) => {
  const u = new URL(req.url);
  if (u.pathname === "/functions/v1/console-admin") return await fn(req);
  if (u.pathname === "/__audit") return json(200, audit);
  if (u.pathname === "/__ops") return json(200, { bell: ops.bell, views: ops.views, meta: ops.meta, outbound: outbound.map((x) => x.url), tickets: ops.tickets.map((t) => ({ id: t.id, status: t.status, assignee: t.assignee, n: t.thread.length })) });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer /, "");
  const who = tokens.get(bearer);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  if (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "password") {
    const l = logins.find((x) => x.email === String(body.email || "").toLowerCase() && x.password === body.password);
    if (!l) return json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
    if (l.banned) return json(400, { code: 400, error_code: "user_banned", msg: "User is banned" });
    return json(200, session(l, "aal1"));
  }
  if (u.pathname === "/auth/v1/token" && u.searchParams.get("grant_type") === "refresh_token") {
    const t = tokens.get(body.refresh_token); const l = t && logins.find((x) => x.id === t.id);
    return l ? json(200, session(l, t!.aal)) : json(400, { error_code: "refresh_token_not_found" });
  }
  if (!who) return json(401, { code: 401, msg: "invalid JWT" });
  const l = logins.find((x) => x.id === who.id)!;
  if (u.pathname === "/auth/v1/user") return json(200, { id: l.id, email: l.email, factors: l.factors });
  if (u.pathname === "/auth/v1/factors" && req.method === "POST") {
    const f = { id: "f-new-" + (++n), factor_type: "totp", status: "unverified", friendly_name: body.friendly_name, created_at: now() };
    l.factors.push(f);
    // as GoTrue really sends it (28-Oct: the owner saw no QR): raw, un-encoded SVG markup with '#' colours
    const svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="#fff"/><rect x="1" y="1" width="7" height="7"/><rect x="13" y="1" width="7" height="7"/><rect x="1" y="13" width="7" height="7"/><rect x="10" y="10" width="3" height="3"/></svg>');
    return json(200, { id: f.id, type: "totp", totp: { qr_code: "data:image/svg+xml;utf-8," + svg, secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/FinCom" } });
  }
  let m = u.pathname.match(/^\/auth\/v1\/factors\/([^/]+)\/challenge$/);
  if (m) return json(200, { id: "ch-" + m[1], expires_at: Math.floor(Date.now() / 1000) + 300 });
  m = u.pathname.match(/^\/auth\/v1\/factors\/([^/]+)\/verify$/);
  if (m) {
    const f = l.factors.find((x) => x.id === m![1]);
    if (!f || body.code !== "123456") return json(422, { code: 422, error_code: "mfa_verification_failed", msg: "Invalid TOTP code entered" });
    f.status = "verified";
    return json(200, session(l, "aal2"));
  }
  if (u.pathname === "/auth/v1/logout") { tokens.delete(bearer); return new Response(null, { status: 204, headers: CORS }); }
  return json(404, { msg: "stand: not here" });
});
