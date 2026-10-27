// People across firms: list and detail; Support's actions (reset two-step, sign out everywhere, switch off and on).
// A console admin's own login can be acted on only by an Owner; nobody acts on their own login here.
import { ALL, ConsoleError, type Ctx, type ListSpec, type Module } from "../core/types.ts";
import { maskRows, notFound, uuid, who } from "../core/util.ts";

export const USERS_LIST: ListSpec = {
  columns: { name: "text", email: "text", firm: "text", role: "select", active: "bool", switched_off: "bool", mfa: "bool",
             last_sign_in_at: "date", firm_status: "select" },
  search: ["name", "email", "firm"],
  defaultSort: { col: "last_sign_in_at", dir: "desc" },
};
const target = (p: any) => ({ type: "user", id: String(p.user_id) });

async function guardTarget(ctx: Ctx, userId: string) {
  if (userId === ctx.caller.id) throw new ConsoleError(403, "You cannot do this to your own login here.", "own_role");
  const a = await ctx.deps.adminRow(userId);
  if (a?.active && ctx.caller.role !== "owner") throw new ConsoleError(403, "Only an owner can do this to a console admin's login.", "admin_target");
}

export const module: Module = {
  name: "users",
  actions: {
    "users.list": {
      roles: ALL, kind: "read", list: USERS_LIST,
      run: async (ctx, p) => maskRows(ctx, ((await ctx.deps.rpc("console_users", {
        p_q: null, p_firm: p.firm_id ? uuid(p.firm_id, "firm") : null, p_role: null, p_mfa: null, p_active: null, p_limit: 5000, p_offset: 0,
      })) || {}).rows || []),
    },
    "user.get": {
      roles: ALL, kind: "read", target,
      run: async (ctx, p) => {
        const u = await ctx.deps.rpc("console_user", { p_user: uuid(p.user_id, "person") });
        if (!u) throw notFound("person");
        return maskRows(ctx, [u])[0];
      },
    },
    // removes every authenticator (TOTP) factor; the person enrols again at their next sign-in
    "user.reset_mfa": {
      roles: ["owner", "support"], kind: "write", reason: true, target,
      run: async (ctx, p) => {
        const id = uuid(p.user_id, "person");
        await guardTarget(ctx, id);
        const factors = await ctx.deps.mfaFactors(id);
        const before = factors.map((f) => ({ type: f.factor_type, status: f.status }));
        let removed = 0;
        try { for (const f of factors) { await ctx.deps.mfaDelete(id, f.id); removed++; } }
        catch (e) {
          ctx.deps.log("mfaDelete", e);
          await ctx.audit("user.reset_mfa.failed", { type: "user", id }, { factors: before }, { removed }, p.reason).catch(() => {});
          throw new ConsoleError(502, `Removed ${removed} of ${factors.length} two-step methods; the rest failed. Try again.`, "partial");
        }
        return { removed };
      },
      summary: () => ({ factors: "all removed" }),
    },
    "user.signout_all": {
      roles: ["owner", "support"], kind: "write", reason: true, target,
      run: async (ctx, p) => {
        const id = uuid(p.user_id, "person");
        await guardTarget(ctx, id);
        return { sessions_ended: await ctx.deps.rpc("console_signout_all", { p_user: id }) };
      },
    },
    // off: every firm's member row off, signed out everywhere (SQL, audited there), then banned in Supabase Auth
    "user.deactivate": {
      roles: ["owner", "support"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => {
        const id = uuid(p.user_id, "person");
        await guardTarget(ctx, id);
        const r = await ctx.deps.rpc("console_user_set_active", { ...who(ctx, p.reason), p_user: id, p_active: false });
        try { await ctx.deps.authBan(id, true); }
        catch (e) {
          ctx.deps.log("authBan", e);
          await ctx.audit("user.deactivate.ban_failed", { type: "user", id }, null, null, p.reason).catch(() => {});
          throw new ConsoleError(502, "The person is switched off in every firm and signed out, but blocking their sign-in failed. Try again.", "partial");
        }
        return r;
      },
    },
    "user.reactivate": {
      roles: ["owner", "support"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => {
        const id = uuid(p.user_id, "person");
        await guardTarget(ctx, id);
        await ctx.deps.authBan(id, false);
        return await ctx.deps.rpc("console_user_set_active", { ...who(ctx, p.reason), p_user: id, p_active: true });
      },
    },
  },
};
