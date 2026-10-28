// FinCom Console: the one door (console-plan.md 5.1). Every call to console-admin passes these checks, in order:
//   1. origin: only the console's own sites (CONSOLE_ORIGINS adds more, e.g. a local test address)
//   2. POST, a JSON body {action, ...params} of at most 32 KB
//   3. sign-in: the Supabase token, checked by Supabase Auth (getUser)
//   4. two-step: the token's aal must be aal2 (strict here, even though the user app does not force it)
//   5. rate limit: 120 calls a minute per admin; writes 30 an hour; exports 10 a day (migration 112's auth_rate_hit)
//   6. an ACTIVE console_admins row (migration 118)
//   7. the action exists, and the admin's role is in its roles (a refusal is itself written to the change history)
//   8. a reason, where the action requires one
//   9. the audit row: written by the router before run() (if it cannot be written, nothing runs), or by the action's
//      own database function in the same transaction as the change (audit: "self")
//  10. run(); a list action's rows are filtered, sorted and paged here (core/listquery.ts), or exported as CSV
// Answers are {ok:true, data} or {ok:false, error, reason} with a plain sentence; database text never reaches the screen.
import { applyQuery, parseQuery, toCsv } from "./listquery.ts";
import { type ActionDef, type Caller, ConsoleError, type Ctx, type Deps, type Module, ROLES, type Role, type Target } from "./types.ts";

export const DEFAULT_ORIGINS = ["https://console.fincom.live", "https://console-staging.fincom.live"];
const LIMITS = { call: [120, 60], write: [30, 3600], export: [10, 86400] } as const;
const MAX_BODY = 32 * 1024;

// the plain words for the database functions' refusals ("console: <code>")
const SQL_WORDS: Record<string, [number, string]> = {
  last_owner: [409, "There must always be one active owner. Add another owner first."],
  not_owner: [403, "Only an owner can do that."],
  own_role: [403, "You cannot change or remove your own admin access. Ask another owner."],
  no_login: [404, "There is no FinCom login with that email. The person must sign up (or be invited) first."],   // only without Deps.authInvite
  already_admin: [409, "That login is already a console admin."],
  not_admin: [404, "That login is not an active console admin."],
  bad_role: [400, "Choose one of: owner, billing, support, viewer."],
  not_allowed: [403, "Your role cannot do that."],
  admin_target: [403, "Only an owner can do this to a console admin's login."],
  no_user: [404, "That person was not found."],
  no_firm: [404, "That firm was not found."],
  no_company: [404, "That company was not found."],
  same_status: [409, "It is already in that state."],
  bad_status: [400, "That status is not one of the choices."],
  bad_key: [400, "That is not a key the console knows."],
  bad_value: [400, "That value is not valid. Check it and try again."],
  same_value: [409, "That is already the saved value. Nothing was changed."],
  no_store: [409, "The place this key is kept is not set up on this database."],
  no_ticket: [404, "That ticket was not found."],
  no_announcement: [404, "That announcement was not found."],
  no_flag: [404, "That feature flag was not found."],
  no_rule: [404, "That rule was not found."],
  no_plan: [404, "That plan was not found."],
};
export function sqlError(e: unknown): ConsoleError {
  const m = String((e as any)?.message || e || "");
  const code = (m.match(/console: ([a-z_]+)/) || [])[1];
  if (code && SQL_WORDS[code]) return new ConsoleError(SQL_WORDS[code][0], SQL_WORDS[code][1], code);
  return new ConsoleError(500, "Something went wrong on the server. Nothing was changed.", "server");
}

export function claims(jwt: string): Record<string, any> {
  try {
    const p = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(p + "=".repeat((4 - p.length % 4) % 4)), (c) => c.charCodeAt(0))));
  } catch { return {}; }
}
export async function sha256hex(s: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildActions(modules: Module[]): Record<string, ActionDef> {
  const all: Record<string, ActionDef> = {};
  for (const m of modules) for (const [name, def] of Object.entries(m.actions)) {
    if (all[name]) throw new Error(`console: action ${name} defined twice (module ${m.name})`);
    if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/.test(name)) throw new Error(`console: bad action name ${name}`);
    if (!def.roles.length || def.roles.some((r) => !ROLES.includes(r))) throw new Error(`console: bad roles on ${name}`);
    all[name] = def;
  }
  return all;
}

export function makeHandler(deps: Deps, modules: Module[]) {
  const actions = buildActions(modules);
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("Origin") || "";
    const okOrigin = deps.origins.includes(origin);
    const cors: Record<string, string> = {
      "Access-Control-Allow-Origin": okOrigin ? origin : deps.origins[0], Vary: "Origin",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "600",
    };
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    const fail = (e: ConsoleError) => reply(e.status, { ok: false, error: e.message, reason: e.reason });
    if (req.method === "OPTIONS") return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    if (!okOrigin) return fail(new ConsoleError(403, "This address may not use the console.", "origin"));
    if (req.method !== "POST") return fail(new ConsoleError(405, "POST only.", "method"));

    let body: any;
    try {
      const text = await req.text();
      if (text.length > MAX_BODY) return fail(new ConsoleError(413, "That request is too large.", "size"));
      body = JSON.parse(text || "{}");
      if (!body || typeof body !== "object" || Array.isArray(body)) throw 0;
    } catch { return fail(new ConsoleError(400, "Bad request.", "body")); }

    // 3-4. sign-in and two-step
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt || jwt.split(".").length !== 3) return fail(new ConsoleError(401, "Sign in first.", "signin"));
    let user: { id: string; email: string } | null = null;
    try { user = await deps.getUser(jwt); } catch (e) { deps.log("getUser", e); }
    if (!user) return fail(new ConsoleError(401, "Your sign-in has ended. Sign in again.", "signin"));
    if (claims(jwt).aal !== "aal2") return fail(new ConsoleError(403, "Enter the code from your authenticator app first.", "aal2"));

    // 5. rate limit (every call)
    const key = await sha256hex("console:" + user.id);
    const limit = async (kind: keyof typeof LIMITS) => {
      let ok = false;
      try { ok = await deps.rateHit("console-" + kind, key, LIMITS[kind][0], LIMITS[kind][1]); } catch (e) { deps.log("rateHit", e); }
      if (!ok) throw new ConsoleError(429, "Too many requests. Wait a minute and try again.", "rate");
    };
    try { await limit("call"); } catch (e) { return fail(e as ConsoleError); }

    // 6. an active console admin
    let row: { role: string; active: boolean } | null = null;
    try { row = await deps.adminRow(user.id); } catch (e) { deps.log("adminRow", e); return fail(new ConsoleError(500, "Could not check your access. Try again.", "server")); }
    if (!row || !row.active || !ROLES.includes(row.role as Role)) return fail(new ConsoleError(403, "This login is not a console admin.", "not_admin"));
    const ip = (req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0] || "").trim().slice(0, 64);
    const caller: Caller = { id: user.id, email: user.email, role: row.role as Role, ip, ua: (req.headers.get("User-Agent") || "").slice(0, 300), origin };
    const allowed = Object.keys(actions).filter((a) => actions[a].roles.includes(caller.role)).sort();
    const audit = async (action: string, target: Target, before: unknown, after: unknown, reason?: string | null) => {
      await deps.rpc("console_audit_add", {
        p_who: caller.id, p_role: caller.role, p_action: action, p_target_type: target?.type ?? null, p_target_id: target?.id ?? null,
        p_before: before ?? null, p_after: after ?? null, p_reason: reason ?? null, p_ip: caller.ip || null, p_ua: caller.ua || null,
      });
    };
    const ctx: Ctx = { caller, deps, allowed, audit };

    // 7. the action and the role
    const name = String(body.action || "");
    const def = Object.prototype.hasOwnProperty.call(actions, name) ? actions[name] : null;
    if (!def) return fail(new ConsoleError(400, "Unknown action.", "action"));
    let target: Target = null;
    try { target = def.target ? def.target(body) : null; } catch { target = null; }
    if (!def.roles.includes(caller.role)) {
      try { await audit("access.denied", target, null, { action: name }, null); } catch (e) { deps.log("audit denied", e); }
      return fail(new ConsoleError(403, "Your role cannot do that.", "role"));
    }
    try {
      // 8. reason
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (def.reason && (reason.length < 5 || reason.length > 1000)) throw new ConsoleError(400, "Give a reason (at least 5 characters).", "reason");
      if (def.kind === "write") await limit("write");
      // list query (validated before anything is recorded)
      const lq = def.list ? parseQuery(body, def.list) : null;
      if (lq?.export) await limit("export");
      // 9. audit (router-written rows)
      if ((def.audit ?? "router") === "router") {
        const after = lq ? { q: lq.q || undefined, filters: Object.keys(lq.filters).length ? lq.filters : undefined, sort: lq.sort, page: lq.page }
                         : def.summary ? def.summary(body) : null;
        try { await audit(lq?.export ? name + ".export" : name, target, null, after, reason || null); }
        catch (e) { deps.log("audit", e); throw new ConsoleError(500, "Could not record this in the change history, so it was not done.", "audit"); }
      }
      // 10. run
      let data: any;
      try { data = await def.run(ctx, { ...body, reason, query: lq }); }
      catch (e) { if (e instanceof ConsoleError) throw e; deps.log("run " + name, e); throw sqlError(e); }
      if (lq && def.list) {
        const res = applyQuery(Array.isArray(data) ? data : [], lq, def.list);
        if (lq.export) return reply(200, { ok: true, data: { total: res.total, csv: toCsv(res.rows, Object.keys(def.list.columns)) } });
        return reply(200, { ok: true, data: { total: res.total, page: lq.page, size: lq.size, rows: res.rows } });
      }
      return reply(200, { ok: true, data });
    } catch (e) {
      if (e instanceof ConsoleError) return fail(e);
      deps.log("router", e);
      return fail(new ConsoleError(500, "Something went wrong on the server. Nothing was changed.", "server"));
    }
  };
}
