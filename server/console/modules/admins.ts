// Console admins (Owner only). Each change and its audit row are one database transaction (migration 118); the
// database refuses removing or demoting the last owner, and anyone changing their own role.
// Add by an email with no FinCom login yet (the owner's ask of 28-Oct-2026): Supabase Auth invites them (an email whose
// link brings them to the console's own site to choose a password, then the authenticator), then the role row is added
// as for any login. Console only: no member row, no firm. The invite's row in the change history ("admins.invite",
// "invited and added as <role>") is written before the email goes; a failure after it adds "admins.invite.failed".
import { ConsoleError, type Ctx, type ListSpec, type Module, ROLES, type Role } from "../core/types.ts";
import { text, uuid, who } from "../core/util.ts";

export const ADMINS_LIST: ListSpec = {
  columns: { email: "text", role: "select", active: "bool", mfa: "bool", last_sign_in_at: "date", added_at: "date" },
  search: ["email"],
  defaultSort: { col: "added_at", dir: "asc" },
};
const target = (p: any) => ({ type: "admin", id: String(p.user_id ?? p.email ?? "") });
const EMAIL = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[^\s@,;<>()"']+$/;

// Supabase Auth's refusals of an invite, in plain words
function inviteError(e: unknown): ConsoleError {
  const status = Number((e as any)?.status) || 0, code = String((e as any)?.code || ""), m = String((e as any)?.message || "");
  if (status === 429 || /rate.?limit/i.test(code + " " + m))
    return new ConsoleError(429, "Too many invitation emails were sent in the last hour. Wait an hour and try again.", "invite_rate");
  if (code === "email_exists" || /already (been )?registered/i.test(m))
    return new ConsoleError(409, "That email got a FinCom login just now. Add them again: it will work this time.", "invite_exists");
  if (status === 400 || status === 422) return new ConsoleError(400, "Supabase did not accept that email address. Check it and try again.", "bad_email");
  return new ConsoleError(502, "The invitation email could not be sent. Nothing was changed. Try again later.", "invite");
}

async function invite(ctx: Ctx, email: string, role: string, reason: string, args: Record<string, unknown>) {
  const t = { type: "admin", id: email };
  try { await ctx.audit("admins.invite", t, null, { email, role, note: `invited and added as ${role}` }, reason); }
  catch (e) { ctx.deps.log("audit invite", e); throw new ConsoleError(500, "Could not record this in the change history, so it was not done.", "audit"); }
  const failed = async (step: string, e: unknown) => {
    ctx.deps.log("invite " + step, e);
    try { await ctx.audit("admins.invite.failed", t, null, { email, role, step }, reason); } catch (x) { ctx.deps.log("audit invite failed", x); }
  };
  let user: { id: string };
  try { user = await ctx.deps.authInvite!(email, ctx.caller.origin + "/", { console_invite: true }); }
  catch (e) { await failed("invite", e); throw inviteError(e); }
  try { return { ...(await ctx.deps.rpc("console_admin_add", args)), user_id: user.id, email, role, invited: true }; }
  catch (e) { await failed("role", e); throw e; }
}

export const module: Module = {
  name: "admins",
  actions: {
    "admins.list": { roles: ["owner"], kind: "read", list: ADMINS_LIST, run: async (ctx) => (await ctx.deps.rpc("console_admins_list", {})) || [] },
    "admins.add": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => {
        const email = text(p.email, "email", 254).toLowerCase();
        if (!EMAIL.test(email)) throw new ConsoleError(400, "That is not an email address. Check it and try again.", "bad_email");
        const role = String(p.role || "");
        if (!ROLES.includes(role as Role)) throw new ConsoleError(400, "Choose one of: owner, billing, support, viewer.", "bad_role");
        const args = { ...who(ctx, p.reason), p_email: email, p_role: role };
        // a login with this email: as before. None (and only then): invited, then added
        try { return await ctx.deps.rpc("console_admin_add", args); }
        catch (e) { if (!ctx.deps.authInvite || !/console: no_login\b/.test(String((e as any)?.message || e))) throw e; }
        return await invite(ctx, email, role, p.reason, args);
      },
    },
    "admins.set_role": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => await ctx.deps.rpc("console_admin_set_role", { ...who(ctx, p.reason), p_user: uuid(p.user_id, "admin"), p_role: String(p.role || "") }),
    },
    "admins.remove": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => await ctx.deps.rpc("console_admin_remove", { ...who(ctx, p.reason), p_user: uuid(p.user_id, "admin") }),
    },
  },
};
