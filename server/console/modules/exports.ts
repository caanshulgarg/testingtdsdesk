// Data exports (console-plan.md 3.15). Every list's own "Export CSV" (the DataTable; audited as "<list>.export") covers
// firms, users and the change history. Here: the all-firms credit ledger as a list (Owner and Billing; its export the
// same way), and the Owner's "Export everything": firms, users, the ledger and the change history as CSV files in one
// go, with a reason, audited before (the router's "exports.all") and after with the row counts ("exports.all.done").
// At most 5,000 firms or users and 50,000 ledger or history rows a file; a file that hit its limit says so ("truncated").
import { ConsoleError, type Ctx, type ListSpec, type Module } from "../core/types.ts";
import { toCsv } from "../core/listquery.ts";
import { FIRMS_LIST } from "./firms.ts";
import { USERS_LIST } from "./users.ts";
import { AUDIT_LIST } from "./audit.ts";

export const LEDGER_LIST: ListSpec = {
  columns: { at: "date", firm: "text", kind: "select", code: "text", qty: "number", amount: "number", amount_paise: "number", balance_after: "number", note: "text", ref: "text" },
  search: ["firm", "code", "note", "ref"],
  defaultSort: { col: "at", dir: "desc" },
};
const day = (d: unknown, add = 0) => (d ? new Date(Date.parse(d + "T00:00:00+05:30") + add).toISOString() : null);
const BIG = 50000;

async function ledger(ctx: Ctx, from: string | null, to: string | null, limit: number) {
  const r = (await ctx.deps.rpc("console_ledger", { p_from: from, p_to: to, p_limit: limit })) || {};
  return { total: Number(r.total || 0), rows: (r.rows || []) as Record<string, unknown>[] };
}

export const module: Module = {
  name: "exports",
  actions: {
    "exports.ledger": {
      roles: ["owner", "billing"], kind: "read", list: LEDGER_LIST,
      run: async (ctx, p) => {
        const at = p.query?.filters?.at;            // the date range goes to the database
        return (await ledger(ctx, day(at?.from), day(at?.to, 86400000), 5000)).rows;
      },
    },
    "exports.all": {
      roles: ["owner"], kind: "read", reason: true, summary: () => ({ files: ["firms", "users", "ledger", "audit"] }),
      run: async (ctx, p) => {
        if (!(await ctx.deps.rateHit("console-export-all", ctx.caller.id, 5, 86400).catch(() => false))) {
          throw new ConsoleError(429, "Export everything is limited to 5 a day. Try again tomorrow.", "rate");
        }
        const [f, u, l, a] = await Promise.all([
          ctx.deps.rpc("console_firms", { p_q: null, p_limit: 5000, p_offset: 0 }),
          ctx.deps.rpc("console_users", { p_q: null, p_firm: null, p_role: null, p_mfa: null, p_active: null, p_limit: 5000, p_offset: 0 }),
          ledger(ctx, null, null, BIG),
          ctx.deps.rpc("console_export_audit", { p_limit: BIG }),
        ]);
        const file = (name: string, cols: string[], x: { total?: number; rows?: unknown[] } | null) => {
          const rows = ((x?.rows || []) as Record<string, unknown>[]);
          const total = Number(x?.total ?? rows.length);
          return { name, rows: rows.length, total, truncated: total > rows.length, csv: toCsv(rows, cols) };
        };
        const files = [
          file("firms.csv", ["id", ...Object.keys(FIRMS_LIST.columns)], f),
          file("users.csv", ["user_id", "firm_id", ...Object.keys(USERS_LIST.columns)], u),
          file("ledger.csv", ["id", "firm_id", ...Object.keys(LEDGER_LIST.columns)], l),
          file("audit.csv", ["id", ...Object.keys(AUDIT_LIST.columns), "ip", "before", "after"], a),
        ];
        await ctx.audit("exports.all.done", null, null, { files: files.map(({ name, rows, total, truncated }) => ({ name, rows, total, truncated })) }, p.reason);
        return { at: new Date().toISOString(), files };
      },
    },
  },
};
