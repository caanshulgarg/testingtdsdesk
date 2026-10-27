// Announcements to firms (console-plan.md 3.10): a title, a text, a severity, an audience (all firms, the firms on chosen
// plans, chosen firms), a start and an optional end, dismissible or not; draft, live, ended. The user app shows the live
// ones for the person's firm as one dismissible bar (announcements_active(), migration 123). Owner or Support make and
// end them, with a reason; each change and its audit row are one transaction.
import { ALL, ConsoleError, type ListSpec, type Module } from "../core/types.ts";
import { notFound, uuid } from "../core/util.ts";

export const ANNOUNCEMENTS_LIST: ListSpec = {
  columns: { title: "text", severity: "select", audience: "select", state: "select", starts_at: "date", ends_at: "date", dismissible: "bool",
             dismissed: "number", firms_reached: "number", created_by_email: "text", updated_at: "date" },
  search: ["title", "body", "created_by_email"],
  defaultSort: { col: "starts_at", dir: "desc" },
};
const target = (p: any) => ({ type: "announcement", id: String(p.id ?? "new") });
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

// the form's fields, checked here before the database checks them again
export function fields(p: any) {
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const f: Record<string, unknown> = {
    title: s(p.title, 120), body: s(p.body, 1000), severity: p.severity || "info", audience: p.audience || "all",
    plan_ids: Array.isArray(p.plan_ids) ? p.plan_ids.map((x: unknown) => uuid(x, "plan")) : [],
    firm_ids: Array.isArray(p.firm_ids) ? p.firm_ids.map((x: unknown) => uuid(x, "firm")) : [],
    dismissible: p.dismissible !== false, status: p.status === "live" ? "live" : "draft",
  };
  if ((f.title as string).length < 3) throw new ConsoleError(400, "Give the announcement a title (3 to 120 characters).", "bad_value");
  if (!["info", "warning", "urgent"].includes(f.severity as string)) throw new ConsoleError(400, "Choose info, warning or urgent.", "bad_value");
  if (!["all", "plans", "firms"].includes(f.audience as string)) throw new ConsoleError(400, "Choose all firms, plans or firms.", "bad_value");
  if (f.audience === "plans" && !(f.plan_ids as string[]).length) throw new ConsoleError(400, "Choose at least one plan.", "bad_value");
  if (f.audience === "firms" && !(f.firm_ids as string[]).length) throw new ConsoleError(400, "Choose at least one firm.", "bad_value");
  for (const k of ["starts_at", "ends_at"]) {
    if (p[k] === undefined || p[k] === null || p[k] === "") continue;
    if (typeof p[k] !== "string" || !ISO.test(p[k])) throw new ConsoleError(400, "Give the start and end as dates and times.", "bad_value");
    f[k] = p[k];
  }
  if (f.starts_at && f.ends_at && Date.parse(f.ends_at as string) <= Date.parse(f.starts_at as string)) throw new ConsoleError(400, "The end must be after the start.", "bad_value");
  return f;
}

export const module: Module = {
  name: "announcements",
  actions: {
    "announcements.list": { roles: ALL, kind: "read", list: ANNOUNCEMENTS_LIST, run: async (ctx) => (await ctx.deps.rpc("console_announcements_list", {})) || [] },
    "announcement.get": {
      roles: ALL, kind: "read", target,
      run: async (ctx, p) => {
        const id = uuid(p.id, "announcement");
        const a = ((await ctx.deps.rpc("console_announcements_list", {})) || []).find((x: any) => x.id === id);
        if (!a) throw notFound("announcement");
        return a;
      },
    },
    "announcements.choices": { roles: ["owner", "support"], kind: "read", run: async (ctx) => (await ctx.deps.rpc("console_notice_choices", {})) || { plans: [], firms: [] } },
    "announcements.save": {
      roles: ["owner", "support"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => await ctx.deps.rpc("console_announcement_save", {
        p_by: ctx.caller.id, p_id: p.id ? uuid(p.id, "announcement") : null, p: fields(p), p_reason: p.reason, p_ip: ctx.caller.ip || null, p_ua: ctx.caller.ua || null,
      }),
    },
    "announcements.end": {
      roles: ["owner", "support"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => await ctx.deps.rpc("console_announcement_end", { p_by: ctx.caller.id, p_id: uuid(p.id, "announcement"), p_reason: p.reason, p_ip: ctx.caller.ip || null, p_ua: ctx.caller.ua || null }),
    },
  },
};
