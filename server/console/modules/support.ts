// Support desk (console-plan.md 3.11): every firm's tickets (support_tickets, support_messages: server/support), the
// thread with internal notes, replies and notes as FinCom support, status / priority / assignee. Each change and its
// audit row are one transaction (migration 122: console_support_reply, console_support_set). A reply to the firm is
// also emailed to the person who raised the ticket, as the support-mail function does (Resend; skipped when no key).
import { ALL, ConsoleError, type Ctx, type ListSpec, type Module } from "../core/types.ts";
import { maskRows, notFound, uuid } from "../core/util.ts";

export const TICKETS_LIST: ListSpec = {
  columns: { code: "text", subject: "text", firm: "text", module: "text", category: "select", priority: "select", status: "select", sla: "select",
             assignee: "text", replies: "number", notes: "number", created_email: "text", created_at: "date", updated_at: "date", last_by: "select" },
  search: ["code", "subject", "firm", "created_email", "assignee", "created_name"],
  defaultSort: { col: "updated_at", dir: "desc" },
};
const target = (p: any) => ({ type: "ticket", id: String(p.ticket_id ?? "") });
const optReason = (p: any) => (typeof p.reason === "string" && p.reason.trim() ? p.reason.trim().slice(0, 1000) : null);

async function mailFirm(ctx: Ctx, t: any, body: string): Promise<"sent" | "not set up" | "failed" | "no address"> {
  const key = (ctx.deps.env?.("RESEND_API_KEY") || "").trim();
  if (!key || !ctx.deps.http) return "not set up";
  if (!t?.created_email) return "no address";
  const from = ctx.deps.env?.("SUPPORT_MAIL_FROM") || "FinCom Support <onboarding@resend.dev>";
  const app = ctx.deps.env?.("APP_URL") || "https://staging.fincom.live/";
  const text = ["FinCom support replied to your ticket.", "", "Ticket: " + t.code + " · " + t.subject, "", body.slice(0, 4000), "", "Open it in FinCom → Help: " + app].join("\n");
  try {
    const r = await ctx.deps.http("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [t.created_email], subject: "Support replied: " + t.code + " · " + t.subject, text }),
    });
    return r.ok ? "sent" : "failed";
  } catch { return "failed"; }
}

export const module: Module = {
  name: "support",
  actions: {
    "support.list": {
      roles: ALL, kind: "read", list: TICKETS_LIST,
      run: async (ctx, p) => {
        const rows = ((await ctx.deps.rpc("console_support_list", {})) || []) as any[];
        const firm = p.firm_id ? uuid(p.firm_id, "firm") : null;
        return maskRows(ctx, firm ? rows.filter((r) => r.firm_id === firm) : rows, ["created_email", "assignee"]);
      },
    },
    "support.get": {
      roles: ALL, kind: "read", target,
      run: async (ctx, p) => {
        const t = await ctx.deps.rpc("console_support_get", { p_ticket: uuid(p.ticket_id, "ticket") });
        if (!t) throw notFound("ticket");
        return maskRows(ctx, [t], ["created_email", "assignee"])[0];
      },
    },
    "support.assignees": { roles: ["owner", "support"], kind: "read", run: async (ctx) => (await ctx.deps.rpc("console_support_assignees", {})) || [] },
    // a reply to the firm (emailed to the person who raised it) or an internal note (internal: true; the firm never sees it)
    "support.reply": {
      roles: ["owner", "support"], kind: "write", audit: "self", target,
      run: async (ctx, p) => {
        const id = uuid(p.ticket_id, "ticket");
        const body = typeof p.body === "string" ? p.body.trim() : "";
        if (!body || body.length > 10000) throw new ConsoleError(400, "Write the reply (up to 10,000 characters).", "bad_value");
        const internal = p.internal === true;
        const t = await ctx.deps.rpc("console_support_reply", { p_by: ctx.caller.id, p_ticket: id, p_body: body, p_internal: internal, p_reason: optReason(p), p_ip: ctx.caller.ip || null, p_ua: ctx.caller.ua || null });
        const emailed = internal ? "internal note" : await mailFirm(ctx, t, body);
        return { ...t, emailed };
      },
    },
    "support.set": {
      roles: ["owner", "support"], kind: "write", audit: "self", target,
      run: async (ctx, p) => {
        const pick = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
        if (pick(p.status) === null && pick(p.priority) === null && typeof p.assignee !== "string") throw new ConsoleError(400, "Choose a status, a priority or an assignee.", "bad_value");
        return await ctx.deps.rpc("console_support_set", {
          p_by: ctx.caller.id, p_ticket: uuid(p.ticket_id, "ticket"), p_status: pick(p.status), p_priority: pick(p.priority),
          p_assignee: typeof p.assignee === "string" ? p.assignee.trim().slice(0, 254) : null, p_reason: optReason(p), p_ip: ctx.caller.ip || null, p_ua: ctx.caller.ua || null,
        });
      },
    },
  },
};
