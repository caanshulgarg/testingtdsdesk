// Small helpers the modules share. Plain module.
import { ConsoleError, type Ctx } from "./types.ts";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(v: unknown, what = "id"): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new ConsoleError(400, `That ${what} is not valid.`, "bad_id");
  return v.toLowerCase();
}
export function text(v: unknown, what: string, max = 200): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new ConsoleError(400, `Give the ${what}.`, "bad_param");
  return v.trim();
}
// a Viewer sees emails partly hidden (plan 2.4): "an***@fincom.live"
export function maskEmail(e: unknown): unknown {
  if (typeof e !== "string" || !e.includes("@")) return e;
  const [u, d] = e.split("@");
  return u.slice(0, 2) + "***@" + d;
}
export function maskRows<T extends Record<string, unknown>>(ctx: Ctx, rows: T[], keys = ["email", "owner_email", "who_email"]): T[] {
  if (ctx.caller.role !== "viewer") return rows;
  return rows.map((r) => { const x: Record<string, unknown> = { ...r }; for (const k of keys) if (k in x) x[k] = maskEmail(x[k]); return x as T; });
}
export const notFound = (what: string) => new ConsoleError(404, `That ${what} was not found.`, "not_found");
// the audit fields every self-audited SQL function takes
export const who = (ctx: Ctx, reason: string) => ({ p_by: ctx.caller.id, p_reason: reason, p_ip: ctx.caller.ip || null, p_ua: ctx.caller.ua || null });
