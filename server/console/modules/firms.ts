// Firms: list and detail (account data only), and switching a firm off and on (Owner; a reason; read-only while off)
import { ALL, ConsoleError, type ListSpec, type Module } from "../core/types.ts";
import { maskRows, notFound, uuid, who } from "../core/util.ts";

export const FIRMS_LIST: ListSpec = {
  columns: { name: "text", owner_email: "text", plan: "select", status: "select", balance: "number", members: "number", clients: "number",
             created_at: "date", last_activity: "date", active: "bool" },
  search: ["name", "owner_email"],
  defaultSort: { col: "created_at", dir: "desc" },
};

const setStatus = (ctx: any, p: any, status: "active" | "suspended" | "closed") =>
  ctx.deps.rpc("console_firm_set_status", { ...who(ctx, p.reason), p_firm: uuid(p.firm_id, "firm"), p_status: status });

export const module: Module = {
  name: "firms",
  actions: {
    "firms.list": {
      roles: ALL, kind: "read", list: FIRMS_LIST,
      run: async (ctx) => maskRows(ctx, ((await ctx.deps.rpc("console_firms", { p_q: null, p_limit: 5000, p_offset: 0 })) || {}).rows || []),
    },
    "firm.get": {
      roles: ALL, kind: "read", target: (p) => ({ type: "firm", id: String(p.firm_id) }),
      run: async (ctx, p) => {
        const f = await ctx.deps.rpc("console_firm", { p_firm: uuid(p.firm_id, "firm") });
        if (!f) throw notFound("firm");
        return { ...f, members: maskRows(ctx, f.members || []) };
      },
    },
    // status: "suspended" (default) or "closed". Members keep reading; nothing can be changed or posted
    "firm.deactivate": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target: (p) => ({ type: "firm", id: String(p.firm_id) }),
      run: async (ctx, p) => {
        if (p.status !== undefined && !["suspended", "closed"].includes(p.status)) throw new ConsoleError(400, "Choose suspended or closed.", "bad_status");
        return await setStatus(ctx, p, p.status === "closed" ? "closed" : "suspended");
      },
    },
    "firm.reactivate": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target: (p) => ({ type: "firm", id: String(p.firm_id) }),
      run: (ctx, p) => setStatus(ctx, p, "active"),
    },
  },
};
