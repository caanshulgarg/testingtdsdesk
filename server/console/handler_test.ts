// deno test server/console/handler_test.ts   (no network, no Supabase: every service is an in-memory fake that keeps
// the database functions' rules of migration 118: audit rows, the last owner, nobody changes their own role)
import { claims, makeHandler, sqlError } from "./core/router.ts";
import { type Deps, type Role } from "./core/types.ts";
import { MODULES } from "./registry.ts";
import { COUPON_IDS, couponsFake } from "../../tests/console_coupons_fake.ts";

function assert(c: unknown, msg = "assertion failed"): asserts c { if (!c) throw new Error(msg); }
function eq(a: unknown, b: unknown, msg = "") { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${msg} ${x} !== ${y}`); }

const ORIGIN = "https://console-staging.fincom.live";
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ID: Record<Role | "nobody" | "owner2", string> = { owner: U(1), billing: U(2), support: U(3), viewer: U(4), nobody: U(5), owner2: U(6) };
const FIRM = U(101), PERSON = U(11), PERSON2 = U(12);
const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const tok = (uid: string, aal = "aal2") => `${b64({ alg: "HS256" })}.${b64({ sub: uid, aal, exp: 9999999999 })}.sig`;

// the expected permission matrix, written from console-plan.md 2.4 (not read from the code)
const ALL: Role[] = ["owner", "billing", "support", "viewer"];
const EXPECT: Record<string, Role[]> = {
  "me": ALL, "dashboard": ALL, "firms.list": ALL, "firm.get": ALL, "companies.list": ALL, "company.get": ALL, "users.list": ALL, "user.get": ALL,
  "audit.list": ["owner", "billing", "support"],
  "user.reset_mfa": ["owner", "support"], "user.signout_all": ["owner", "support"], "user.deactivate": ["owner", "support"], "user.reactivate": ["owner", "support"],
  "company.deactivate": ["owner", "support"], "company.reactivate": ["owner", "support"],
  "firm.deactivate": ["owner"], "firm.reactivate": ["owner"],
  "admins.list": ["owner"], "admins.add": ["owner"], "admins.set_role": ["owner"], "admins.remove": ["owner"],
  "settings.get": ["owner"],
  // coupons (migration 120): everyone reads; Owner and Billing change (console-plan.md 2.4)
  "coupons.list": ALL, "coupon.get": ALL, "coupon.redemptions": ALL, "coupons.report": ALL, "coupon.plans": ALL,
  "coupon.create": ["owner", "billing"], "coupon.update": ["owner", "billing"], "coupon.pause": ["owner", "billing"], "coupon.resume": ["owner", "billing"],
  "coupon.end": ["owner", "billing"],
};
const R = "a good reason";
const PARAMS: Record<string, Record<string, unknown>> = {
  "firm.get": { firm_id: FIRM }, "company.get": { firm_id: FIRM, client_id: "c1" }, "user.get": { user_id: PERSON },
  "user.reset_mfa": { user_id: PERSON, reason: R }, "user.signout_all": { user_id: PERSON, reason: R },
  "user.deactivate": { user_id: PERSON, reason: R }, "user.reactivate": { user_id: PERSON, reason: R },
  "company.deactivate": { firm_id: FIRM, client_id: "c1", reason: R }, "company.reactivate": { firm_id: FIRM, client_id: "c2", reason: R },
  "firm.deactivate": { firm_id: FIRM, reason: R }, "firm.reactivate": { firm_id: U(102), reason: R },
  "admins.add": { email: "new@fincom.live", role: "viewer", reason: R }, "admins.set_role": { user_id: ID.viewer, role: "support", reason: R },
  "admins.remove": { user_id: ID.viewer, reason: R },
  "coupon.get": { coupon_id: COUPON_IDS.welcome }, "coupon.redemptions": { coupon_id: COUPON_IDS.welcome },
  "coupon.create": { code: "NEW100", kind: "credit", amount_inr: 100, reason: R },
  "coupon.update": { coupon_id: COUPON_IDS.welcome, code: "WELCOME10", kind: "percent", percent: 15, months: 3, reason: R },
  "coupon.pause": { coupon_id: COUPON_IDS.welcome, reason: R }, "coupon.resume": { coupon_id: COUPON_IDS.paused, reason: R },
  "coupon.end": { coupon_id: COUPON_IDS.welcome, reason: R },
};

function fake(opts: { failAudit?: boolean; failBan?: boolean; rate?: boolean } = {}) {
  const admins = new Map<string, { role: string; active: boolean }>([
    [ID.owner, { role: "owner", active: true }], [ID.billing, { role: "billing", active: true }],
    [ID.support, { role: "support", active: true }], [ID.viewer, { role: "viewer", active: true }],
  ]);
  const emails: Record<string, string> = { [ID.owner]: "anshul@fincom.live", [PERSON]: "asha@abc.test", [PERSON2]: "ravi@abc.test", "new@fincom.live": U(7) };
  const audit: any[] = [];
  const calls: string[] = [];
  const banned = new Set<string>();
  const firmStatus: Record<string, string> = { [FIRM]: "active", [U(102)]: "suspended" };
  const coStatus: Record<string, string> = { c1: "active", c2: "deactivated" };
  let factors = [{ id: "f1", factor_type: "totp", status: "verified" }];
  const err = (code: string) => { throw new Error("console: " + code); };
  const addAudit = (a: any, action: string, target_type: string, target_id: string, before: unknown, after: unknown) =>
    audit.push({ who: a.p_by, role: admins.get(a.p_by)?.role, action, target_type, target_id, before, after, reason: a.p_reason, ip: a.p_ip });
  const ownerCheck = (by: string) => { const r = admins.get(by); if (!r?.active || r.role !== "owner") err("not_owner"); };
  const roleCheck = (by: string, roles: string[]) => { const r = admins.get(by); if (!r?.active || !roles.includes(r.role)) err("not_allowed"); };
  const lastOwner = (uid: string) => { if (![...admins].some(([k, v]) => k !== uid && v.active && v.role === "owner")) err("last_owner"); };
  const coupons = couponsFake({ roleOf: (by) => (admins.get(by)?.active ? admins.get(by)!.role : ""), audit: addAudit, emailOf: (id) => (id && emails[id]) || "" });
  const rpc = async (fn: string, a: any): Promise<any> => {
    calls.push(fn);
    switch (fn) {
      case "console_audit_add":
        if (opts.failAudit) throw new Error("permission denied for table console_audit");
        audit.push({ who: a.p_who, role: a.p_role, action: a.p_action, target_type: a.p_target_type, target_id: a.p_target_id, before: a.p_before, after: a.p_after, reason: a.p_reason, ip: a.p_ip });
        return audit.length;
      case "console_dashboard": return { firms: 2, active_7d: 1 };
      case "console_firms": return { total: 3, rows: [
        { id: FIRM, name: "ABC Associates", owner_email: "asha@abc.test", plan: "Pay as you go", status: "active", balance: 1000, members: 2, clients: 5, created_at: "2026-09-01T10:00:00Z", active: true },
        { id: U(102), name: "Garg Shekhar & Co", owner_email: "bina@gsc.test", plan: "Monthly", status: "suspended", balance: 175, members: 1, clients: 2, created_at: "2026-10-20T10:00:00Z", active: true },
        { id: U(103), name: "Zed =cmd", owner_email: "z@z.test", plan: "Monthly", status: "active", balance: -5, members: 1, clients: 0, created_at: "2026-10-25T10:00:00Z", active: false },
      ] };
      case "console_firm": return a.p_firm === FIRM ? { id: FIRM, name: "ABC Associates", members: [{ email: "asha@abc.test", role: "owner" }] } : null;
      case "console_users": return { total: 2, rows: [{ user_id: PERSON, email: "asha@abc.test", name: "Asha", firm: "ABC", role: "owner", active: true, mfa: true }, { user_id: PERSON2, email: "ravi@abc.test", name: "Ravi", firm: "ABC", role: "staff", active: false, mfa: false }] };
      case "console_user": return a.p_user === PERSON || admins.has(a.p_user) ? { user_id: a.p_user, email: emails[a.p_user] || "x@y.z" } : null;
      case "console_companies": return { rows: [{ id: "c1", name: "Client One", firm: "ABC", status: "active" }] };
      case "console_company": return { id: a.p_client, name: "Client One", status: coStatus[a.p_client] };
      case "console_audit_list": return { rows: audit.filter((r) => !a.p_scope_role || r.who === a.p_scope_who || r.role === a.p_scope_role).map((r) => ({ ...r, who_email: emails[r.who] || "" })) };
      case "console_admins_list": return [...admins].map(([k, v]) => ({ user_id: k, email: emails[k] || k + "@fincom.live", ...v }));
      case "console_admin_add": {
        ownerCheck(a.p_by);
        const uid = emails[String(a.p_email).toLowerCase()]; if (!uid) err("no_login");
        if (admins.get(uid)?.active) err("already_admin");
        admins.set(uid, { role: a.p_role, active: true }); addAudit(a, "admins.add", "admin", uid, null, { role: a.p_role });
        return { user_id: uid };
      }
      case "console_admin_set_role": {
        ownerCheck(a.p_by); if (a.p_by === a.p_user) err("own_role");
        const r = admins.get(a.p_user); if (!r?.active) err("not_admin");
        if (r!.role === "owner" && a.p_role !== "owner") lastOwner(a.p_user);
        addAudit(a, "admins.set_role", "admin", a.p_user, { role: r!.role }, { role: a.p_role }); r!.role = a.p_role; return {};
      }
      case "console_admin_remove": {
        ownerCheck(a.p_by); if (a.p_by === a.p_user) err("own_role");
        const r = admins.get(a.p_user); if (!r?.active) err("not_admin");
        if (r!.role === "owner") lastOwner(a.p_user);
        r!.active = false; addAudit(a, "admins.remove", "admin", a.p_user, { active: true }, { active: false }); return {};
      }
      case "console_signout_all": return 2;
      case "console_user_set_active":
        roleCheck(a.p_by, ["owner", "support"]); addAudit(a, a.p_active ? "user.reactivate" : "user.deactivate", "user", a.p_user, null, { active: a.p_active }); return { active: a.p_active };
      case "console_firm_set_status":
        roleCheck(a.p_by, ["owner"]); if (firmStatus[a.p_firm] === a.p_status) err("same_status");
        addAudit(a, a.p_status === "active" ? "firm.reactivate" : "firm.deactivate", "firm", a.p_firm, { status: firmStatus[a.p_firm] }, { status: a.p_status });
        firmStatus[a.p_firm] = a.p_status; return { status: a.p_status };
      case "console_company_set_status":
        roleCheck(a.p_by, ["owner", "support"]); if (coStatus[a.p_client] === a.p_status) err("same_status");
        addAudit(a, a.p_status === "active" ? "company.reactivate" : "company.deactivate", "company", a.p_firm + "/" + a.p_client, null, { status: a.p_status });
        coStatus[a.p_client] = a.p_status; return {};
    }
    const c = coupons.rpc(fn, a);
    if (c !== undefined) return c;
    throw new Error("fake: no rpc " + fn);
  };
  const users = new Map(Object.entries(ID).map(([, v]) => [tok(v), { id: v, email: emails[v] || v + "@fincom.live" }]));
  for (const v of Object.values(ID)) users.set(tok(v, "aal1"), { id: v, email: "x" });
  const deps: Deps = {
    getUser: async (jwt) => users.get(jwt) || null,
    adminRow: async (uid) => admins.get(uid) || null,
    rpc,
    mfaFactors: async () => factors,
    mfaDelete: async (_u, id) => { factors = factors.filter((f) => f.id !== id); },
    authBan: async (uid, b) => { if (opts.failBan) throw new Error("auth down"); if (b) banned.add(uid); else banned.delete(uid); },
    rateHit: async () => !opts.rate,
    origins: [ORIGIN],
    log: () => {},
  };
  const h = makeHandler(deps, MODULES);
  const call = async (who: string, action: string, params: Record<string, unknown> = {}, o: { aal?: string; origin?: string; jwt?: string } = {}) => {
    const r = await h(new Request("https://x.supabase.co/functions/v1/console-admin", {
      method: "POST", body: JSON.stringify({ action, ...params }),
      headers: { Origin: o.origin ?? ORIGIN, Authorization: "Bearer " + (o.jwt ?? tok(who, o.aal || "aal2")), "Content-Type": "application/json", "User-Agent": "test" },
    }));
    return { status: r.status, body: await r.json() };
  };
  return { call, audit, admins, banned, calls, firmStatus, coStatus, get factors() { return factors; } };
}

Deno.test("every action is in the expected matrix, and the matrix covers every action", () => {
  const names = MODULES.flatMap((m) => Object.keys(m.actions)).sort();
  eq(names, Object.keys(EXPECT).sort(), "actions");
});

Deno.test("every role against every action: allowed ones run (and are audited), the others are refused (and the refusal is audited)", async () => {
  for (const [action, roles] of Object.entries(EXPECT)) {
    for (const role of ALL) {
      const f = fake();
      const n0 = f.audit.length;
      const r = await f.call(ID[role], action, PARAMS[action] || {});
      if (roles.includes(role)) {
        assert(r.status === 200 && r.body.ok, `${role} ${action}: expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(f.audit.length > n0, `${role} ${action}: no audit row`);
        assert(f.audit.some((x) => x.action.startsWith(action) && x.who === ID[role]), `${role} ${action}: audit row not for this action: ${JSON.stringify(f.audit)}`);
      } else {
        assert(r.status === 403 && r.body.reason === "role", `${role} ${action}: expected 403 role, got ${r.status} ${JSON.stringify(r.body)}`);
        eq(f.audit.map((x) => [x.action, x.after?.action]), [["access.denied", action]], `${role} ${action}: denial audit`);
      }
    }
  }
});

Deno.test("aal1 (no authenticator code yet) is refused for every role, before anything is read", async () => {
  for (const role of ALL) {
    const f = fake();
    const r = await f.call(ID[role], "dashboard", {}, { aal: "aal1" });
    eq([r.status, r.body.reason], [403, "aal2"], role);
    eq(f.calls, [], "nothing read");
  }
});

Deno.test("no token, a bad token, a login that is not a console admin, a switched-off admin, another site: refused", async () => {
  let f = fake();
  eq((await f.call(ID.owner, "me", {}, { jwt: "" })).status, 401);
  eq((await f.call(ID.owner, "me", {}, { jwt: "a.b.c" })).status, 401);
  const r = await f.call(ID.nobody, "dashboard");
  eq([r.status, r.body.reason], [403, "not_admin"]);
  f.admins.get(ID.billing)!.active = false;
  eq((await f.call(ID.billing, "me")).body.reason, "not_admin");
  f = fake();
  eq((await f.call(ID.owner, "me", {}, { origin: "https://evil.example" })).status, 403);
  eq(f.audit.length, 0);
});

Deno.test("rate limit: refused with 429", async () => {
  const f = fake({ rate: true });
  eq((await f.call(ID.owner, "me")).status, 429);
});

Deno.test("a reason is required for every write", async () => {
  for (const [action, roles] of Object.entries(EXPECT)) {
    const p = PARAMS[action];
    if (!p || !("reason" in p)) continue;
    const f = fake();
    const r = await f.call(ID[roles[0]], action, { ...p, reason: "  " });
    eq([r.status, r.body.reason], [400, "reason"], action);
    eq(f.audit.length, 0, action + " no audit");
  }
});

Deno.test("when the audit row cannot be written, the action does not run", async () => {
  const f = fake({ failAudit: true });
  const r = await f.call(ID.support, "user.reset_mfa", PARAMS["user.reset_mfa"]);
  eq([r.status, r.body.reason], [500, "audit"]);
  eq(f.factors.length, 1, "factor kept");
  eq((await f.call(ID.owner, "dashboard")).status, 500);
});

Deno.test("the last owner cannot be removed or demoted; nobody changes their own role", async () => {
  const f = fake();
  let r = await f.call(ID.owner, "admins.remove", { user_id: ID.owner, reason: R });
  eq([r.status, r.body.reason], [403, "own_role"]);
  r = await f.call(ID.owner, "admins.set_role", { user_id: ID.owner, role: "viewer", reason: R });
  eq(r.body.reason, "own_role");
  f.admins.set(ID.owner2, { role: "owner", active: true });
  // owner2 removes owner: allowed (two owners); then owner2 is the last one
  eq((await f.call(ID.owner2, "admins.remove", { user_id: ID.owner, reason: R })).status, 200);
  f.admins.set(ID.billing, { role: "owner", active: true });
  eq((await f.call(ID.billing, "admins.set_role", { user_id: ID.owner2, role: "viewer", reason: R })).status, 200);
  // billing (now the only owner) cannot be removed by anyone: there is no other owner left to try, and own is refused
  r = await f.call(ID.billing, "admins.remove", { user_id: ID.billing, reason: R });
  eq(r.status, 403);
  assert(!f.audit.some((x) => x.action === "admins.remove" && x.target_id === ID.billing), "no audit for a refused removal");
  assert([...f.admins.values()].some((v) => v.active && v.role === "owner"), "an owner remains");
});

Deno.test("the database's refusals reach the screen as plain words, never database text", () => {
  const e = sqlError(new Error('P0001: console: last_owner CONTEXT: PL/pgSQL function console_admins_guard()'));
  eq([e.status, e.message], [409, "There must always be one active owner. Add another owner first."]);
  const x = sqlError(new Error('relation "public.firms" does not exist'));
  eq([x.status, x.reason], [500, "server"]);
  assert(!x.message.includes("relation"), "no database text");
});

Deno.test("Support cannot reset, sign out or switch off a console admin's login; an Owner can; nobody their own", async () => {
  let f = fake();
  for (const a of ["user.reset_mfa", "user.signout_all", "user.deactivate"]) {
    const r = await f.call(ID.support, a, { user_id: ID.billing, reason: R });
    eq([r.status, r.body.reason], [403, "admin_target"], a);
    const s = await f.call(ID.support, a, { user_id: ID.support, reason: R });
    eq([s.status, s.body.reason], [403, "own_role"], a + " own");
  }
  f = fake();
  eq((await f.call(ID.owner, "user.reset_mfa", { user_id: ID.support, reason: R })).status, 200);
});

Deno.test("reset two-step removes every factor and is audited with the reason", async () => {
  const f = fake();
  const r = await f.call(ID.support, "user.reset_mfa", { user_id: PERSON, reason: "lost phone, ticket 12" });
  eq([r.status, r.body.data], [200, { removed: 1 }]);
  eq(f.factors.length, 0);
  const a = f.audit.find((x) => x.action === "user.reset_mfa")!;
  eq([a.who, a.role, a.target_type, a.target_id, a.reason], [ID.support, "support", "user", PERSON, "lost phone, ticket 12"]);
});

Deno.test("switch a person off: member rows (SQL, audited), signed out, banned; on again lifts the ban", async () => {
  const f = fake();
  eq((await f.call(ID.support, "user.deactivate", { user_id: PERSON, reason: R })).status, 200);
  assert(f.banned.has(PERSON), "banned");
  assert(f.audit.some((x) => x.action === "user.deactivate" && x.target_id === PERSON), "audited");
  eq((await f.call(ID.support, "user.reactivate", { user_id: PERSON, reason: R })).status, 200);
  assert(!f.banned.has(PERSON), "ban lifted");
  const g = fake({ failBan: true });
  const r = await g.call(ID.support, "user.deactivate", { user_id: PERSON, reason: R });
  eq([r.status, r.body.reason], [502, "partial"]);
  assert(g.audit.some((x) => x.action === "user.deactivate.ban_failed"), "the failed ban is in the history");
});

Deno.test("firm and company: switched off and on, the same state twice refused in plain words", async () => {
  const f = fake();
  eq((await f.call(ID.owner, "firm.deactivate", { firm_id: FIRM, reason: R, status: "closed" })).status, 200);
  eq(f.firmStatus[FIRM], "closed");
  const r = await f.call(ID.owner, "firm.deactivate", { firm_id: FIRM, reason: R, status: "closed" });
  eq([r.status, r.body.error], [409, "It is already in that state."]);
  eq((await f.call(ID.owner, "firm.deactivate", { firm_id: FIRM, reason: R, status: "gone" })).status, 400);
  eq((await f.call(ID.support, "company.deactivate", { firm_id: FIRM, client_id: "c1", reason: R })).status, 200);
  eq(f.coStatus.c1, "deactivated");
  assert(f.audit.some((x) => x.action === "company.deactivate" && x.target_id === FIRM + "/c1"), "audited");
});

Deno.test("lists: server-side search, filters, sort, paging; bad filters refused; export is CSV and audited", async () => {
  const f = fake();
  let r = await f.call(ID.owner, "firms.list", { q: "garg" });
  eq([r.body.data.total, r.body.data.rows.map((x: any) => x.name)], [1, ["Garg Shekhar & Co"]]);
  r = await f.call(ID.owner, "firms.list", { filters: { status: { op: "in", values: ["active"] } }, sort: { col: "balance", dir: "asc" } });
  eq(r.body.data.rows.map((x: any) => x.balance), [-5, 1000]);
  r = await f.call(ID.owner, "firms.list", { filters: { created_at: { op: "range", from: "2026-10-01", to: "2026-10-20" }, active: { op: "is", value: true } } });
  eq(r.body.data.rows.map((x: any) => x.name), ["Garg Shekhar & Co"]);
  r = await f.call(ID.owner, "firms.list", { filters: { balance: { op: "range", from: 0, to: 500 } } });
  eq(r.body.data.total, 1);
  r = await f.call(ID.owner, "firms.list", { size: 1, page: 1 });
  eq([r.body.data.total, r.body.data.rows.length, r.body.data.page], [3, 1, 1]);
  r = await f.call(ID.owner, "firms.list", { filters: { secret: { op: "contains", value: "x" } } });
  eq([r.status, r.body.reason], [400, "bad_query"]);
  r = await f.call(ID.owner, "firms.list", { filters: { balance: { op: "contains", value: "x" } } });
  eq(r.status, 400);
  r = await f.call(ID.owner, "firms.list", { export: "csv", filters: { name: { op: "contains", value: "zed" } } });
  eq(r.status, 200);
  const csv: string = r.body.data.csv;
  assert(csv.startsWith("name,owner_email,plan,status,balance") && csv.includes("'Zed =cmd") === false && csv.includes("Zed =cmd") && csv.split("\r\n").length === 3, csv);
  assert(f.audit.some((x) => x.action === "firms.list.export"), "export audited");
  // a formula at the start of a cell is made plain text
  r = await f.call(ID.owner, "users.list", { export: "csv" });
  assert(r.body.data.csv.includes("asha@abc.test"), "users csv");
});

Deno.test("CSV: a cell that starts like a formula is made plain text", async () => {
  const { toCsv } = await import("./core/listquery.ts");
  eq(toCsv([{ a: "=HYPERLINK(1)", b: -5, c: 'x,"y"' }], ["a", "b", "c"]), "a,b,c\r\n'=HYPERLINK(1),-5,\"x,\"\"y\"\"\"\r\n");
});

Deno.test("a Viewer sees emails partly hidden", async () => {
  const f = fake();
  const r = await f.call(ID.viewer, "users.list");
  eq(r.body.data.rows.map((x: any) => x.email), ["as***@abc.test", "ra***@abc.test"]);
  const o = await f.call(ID.owner, "users.list");
  eq(o.body.data.rows[0].email, "asha@abc.test");
});

Deno.test("audit list: Billing and Support see their own and their role's rows only", async () => {
  const f = fake();
  await f.call(ID.owner, "dashboard");
  await f.call(ID.support, "dashboard");
  const r = await f.call(ID.billing, "audit.list");
  assert(r.body.data.rows.every((x: any) => x.who === ID.billing || x.role === "billing"), JSON.stringify(r.body.data.rows));
  const o = await f.call(ID.owner, "audit.list");
  assert(o.body.data.rows.some((x: any) => x.who === ID.support), "owner sees all");
});

Deno.test("me: role and the allowed actions", async () => {
  const f = fake();
  const r = await f.call(ID.support, "me");
  eq(r.body.data.role, "support");
  eq(r.body.data.actions, Object.entries(EXPECT).filter(([, v]) => v.includes("support")).map(([k]) => k).sort());
});

Deno.test("claims decodes a token's payload", () => {
  eq(claims(tok(ID.owner)).aal, "aal2");
  eq(claims("nonsense"), {});
});
