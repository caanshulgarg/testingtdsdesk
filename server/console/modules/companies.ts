// Companies (a firm's clients): list and detail (name, GSTIN, status; never the books), switching one off and on
import { ALL, type ListSpec, type Module } from "../core/types.ts";
import { notFound, text, uuid, who } from "../core/util.ts";

export const COMPANIES_LIST: ListSpec = {
  columns: { name: "text", gstin: "text", firm: "text", status: "select", status_at: "date", deleted: "bool" },
  search: ["name", "gstin", "firm"],
  defaultSort: { col: "name", dir: "asc" },
};
const target = (p: any) => ({ type: "company", id: String(p.firm_id) + "/" + String(p.client_id) });
const set = (status: string) => async (ctx: any, p: any) =>
  await ctx.deps.rpc("console_company_set_status", { ...who(ctx, p.reason), p_firm: uuid(p.firm_id, "firm"), p_client: text(p.client_id, "company"), p_status: status });

export const module: Module = {
  name: "companies",
  actions: {
    "companies.list": {
      roles: ALL, kind: "read", list: COMPANIES_LIST, target: (p) => p.firm_id ? { type: "firm", id: String(p.firm_id) } : null,
      run: async (ctx, p) => ((await ctx.deps.rpc("console_companies", { p_q: null, p_firm: p.firm_id ? uuid(p.firm_id, "firm") : null, p_limit: 5000, p_offset: 0 })) || {}).rows || [],
    },
    "company.get": {
      roles: ALL, kind: "read", target,
      run: async (ctx, p) => {
        const c = await ctx.deps.rpc("console_company", { p_firm: uuid(p.firm_id, "firm"), p_client: text(p.client_id, "company") });
        if (!c) throw notFound("company");
        return c;
      },
    },
    "company.deactivate": { roles: ["owner", "support"], kind: "write", reason: true, audit: "self", target, run: set("deactivated") },
    "company.reactivate": { roles: ["owner", "support"], kind: "write", reason: true, audit: "self", target, run: set("active") },
  },
};
