// Console admins (Owner only). Each change and its audit row are one database transaction (migration 118); the
// database refuses removing or demoting the last owner, and anyone changing their own role.
import { type ListSpec, type Module } from "../core/types.ts";
import { text, uuid, who } from "../core/util.ts";

export const ADMINS_LIST: ListSpec = {
  columns: { email: "text", role: "select", active: "bool", mfa: "bool", last_sign_in_at: "date", added_at: "date" },
  search: ["email"],
  defaultSort: { col: "added_at", dir: "asc" },
};
const target = (p: any) => ({ type: "admin", id: String(p.user_id ?? p.email ?? "") });

export const module: Module = {
  name: "admins",
  actions: {
    "admins.list": { roles: ["owner"], kind: "read", list: ADMINS_LIST, run: async (ctx) => (await ctx.deps.rpc("console_admins_list", {})) || [] },
    "admins.add": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => await ctx.deps.rpc("console_admin_add", { ...who(ctx, p.reason), p_email: text(p.email, "email", 254), p_role: String(p.role || "") }),
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
