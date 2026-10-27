// Change history. Owner: every row. Billing and Support: their own rows and their role's (plan 2.4). Viewer: none.
import { type ListSpec, type Module } from "../core/types.ts";
import { maskRows } from "../core/util.ts";

export const AUDIT_LIST: ListSpec = {
  columns: { at: "date", who_email: "text", role: "select", action: "text", target_type: "select", target_id: "text", reason: "text" },
  search: ["who_email", "action", "target_id", "reason"],
  defaultSort: { col: "at", dir: "desc" },
};

export const module: Module = {
  name: "audit",
  actions: {
    "audit.list": {
      roles: ["owner", "billing", "support"], kind: "read", list: AUDIT_LIST,
      run: async (ctx, p) => {
        // the date range goes to the database (the newest 5000 rows within it are filtered here)
        const at = p.query?.filters?.at;
        const day = (d: unknown, add = 0) => d ? new Date(Date.parse(d + "T00:00:00+05:30") + add).toISOString() : null;
        const scoped = ctx.caller.role !== "owner";
        const r = await ctx.deps.rpc("console_audit_list", {
          p_scope_who: scoped ? ctx.caller.id : null, p_scope_role: scoped ? ctx.caller.role : null, p_action: null, p_who: null, p_target: null,
          p_from: day(at?.from), p_to: day(at?.to, 86400000), p_limit: 5000, p_offset: 0,
        });
        return maskRows(ctx, (r || {}).rows || []);
      },
    },
  },
};
