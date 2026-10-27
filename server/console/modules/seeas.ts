// "See as this firm" (console-plan.md 3.2 / 4.2): a READ-ONLY summary of one firm's main screens (plan, credit, clients,
// Tally status, team, recent activity), made on the server from that firm's data by console_seeas (migration 122). It
// never uses a firm user's session or sign-in. Clients are counts only, unless the firm's own consent row allows names
// (never books). Owner or Support, with a reason; in ONE transaction: the audit row, the view log row, and a notice in
// the firm's bell: "FinCom support viewed your account on <date>: <reason>".
import { type ListSpec, type Module } from "../core/types.ts";
import { uuid } from "../core/util.ts";

export const VIEWS_LIST: ListSpec = {
  columns: { at: "date", admin: "text", role: "select", firm: "text", reason: "text", client_data: "bool" },
  search: ["admin", "firm", "reason"],
  defaultSort: { col: "at", dir: "desc" },
};

export const module: Module = {
  name: "seeas",
  actions: {
    "seeas.open": {
      roles: ["owner", "support"], kind: "write", reason: true, audit: "self", target: (p) => ({ type: "firm", id: String(p.firm_id ?? "") }),
      run: async (ctx, p) => await ctx.deps.rpc("console_seeas", {
        p_by: ctx.caller.id, p_firm: uuid(p.firm_id, "firm"), p_reason: p.reason, p_ip: ctx.caller.ip || null, p_ua: ctx.caller.ua || null,
      }),
    },
    "seeas.views": {
      roles: ["owner", "support"], kind: "read", list: VIEWS_LIST, target: (p) => (p.firm_id ? { type: "firm", id: String(p.firm_id) } : null),
      run: async (ctx, p) => (await ctx.deps.rpc("console_view_list", { p_firm: p.firm_id ? uuid(p.firm_id, "firm") : null })) || [],
    },
  },
};
