// Feature flags (console-plan.md 3.12): a key, what it does, and its default; a plan's or a firm's own value, with an
// optional end date. A firm's rule beats its plan's, which beats the default. The user app reads every flag for its
// firm once through flags_for_me() (migration 123) and keeps it. Owner changes them (with a reason; audited in the
// same transaction); everyone may look, and see for any firm what each flag is and why.
import { ALL, ConsoleError, type ListSpec, type Module } from "../core/types.ts";
import { notFound, uuid } from "../core/util.ts";

export const FLAGS_LIST: ListSpec = {
  columns: { key: "text", description: "text", default_on: "bool", rules: "number", firms_on: "number", updated_at: "date", updated_by_email: "text" },
  search: ["key", "description"],
  defaultSort: { col: "key", dir: "asc" },
};
export const RULES_LIST: ListSpec = {
  columns: { scope: "select", target: "text", value: "bool", until: "date", ended: "bool", note: "text", updated_at: "date", updated_by_email: "text" },
  search: ["target", "note"],
  defaultSort: { col: "updated_at", dir: "desc" },
};
export const FIRM_FLAGS_LIST: ListSpec = {
  columns: { key: "text", value: "bool", why: "select", until: "date" },
  search: ["key"],
  defaultSort: { col: "key", dir: "asc" },
};
const KEY = /^[a-z][a-z0-9_.]{1,60}$/;
const key = (v: unknown) => { if (typeof v !== "string" || !KEY.test(v)) throw new ConsoleError(400, "A flag's key is lower-case letters, digits, _ and . (2 to 61).", "bad_key"); return v; };
const target = (p: any) => ({ type: "flag", id: String(p.key ?? "") });
const who = (ctx: any, p: any) => ({ p_by: ctx.caller.id, p_reason: p.reason, p_ip: ctx.caller.ip || null, p_ua: ctx.caller.ua || null });
const one = async (ctx: any, k: string) => {
  const f = ((await ctx.deps.rpc("console_flags_list", {})) || []).find((x: any) => x.key === k);
  if (!f) throw notFound("feature flag");
  return f;
};

export const module: Module = {
  name: "flags",
  actions: {
    "flags.list": { roles: ALL, kind: "read", list: FLAGS_LIST, run: async (ctx) => (await ctx.deps.rpc("console_flags_list", {})) || [] },
    "flag.get": { roles: ALL, kind: "read", target, run: async (ctx, p) => { const f = await one(ctx, key(p.key)); delete f.rule_list; return f; } },
    "flags.rules": { roles: ALL, kind: "read", list: RULES_LIST, target, run: async (ctx, p) => (await one(ctx, key(p.key))).rule_list || [] },
    "flags.for_firm": {
      roles: ALL, kind: "read", list: FIRM_FLAGS_LIST, target: (p) => ({ type: "firm", id: String(p.firm_id ?? "") }),
      run: async (ctx, p) => {
        const r = await ctx.deps.rpc("console_flags_for_firm", { p_firm: uuid(p.firm_id, "firm") });
        if (r === null || r === undefined) throw notFound("firm");
        return r;
      },
    },
    "flags.save": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => {
        if (typeof p.default_on !== "boolean") throw new ConsoleError(400, "Choose on or off as the default.", "bad_value");
        return await ctx.deps.rpc("console_flag_save", { ...who(ctx, p), p_key: key(p.key), p_description: typeof p.description === "string" ? p.description.trim().slice(0, 500) : "", p_default_on: p.default_on });
      },
    },
    "flags.rule_set": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => {
        if (!["plan", "firm"].includes(p.scope)) throw new ConsoleError(400, "Choose a plan or a firm.", "bad_value");
        if (typeof p.value !== "boolean") throw new ConsoleError(400, "Choose on or off.", "bad_value");
        const until = p.until ? String(p.until) : null;
        if (until && (isNaN(Date.parse(until)) || Date.parse(until) <= Date.now())) throw new ConsoleError(400, "The end date must be in the future.", "bad_value");
        return await ctx.deps.rpc("console_flag_rule_set", {
          ...who(ctx, p), p_key: key(p.key), p_scope: p.scope, p_target: uuid(p.target_id, p.scope), p_value: p.value, p_until: until,
          p_note: typeof p.note === "string" ? p.note.trim().slice(0, 500) : "",
        });
      },
    },
    "flags.rule_remove": {
      roles: ["owner"], kind: "write", reason: true, audit: "self", target,
      run: async (ctx, p) => {
        const id = Number(p.rule_id);
        if (!Number.isInteger(id) || id <= 0) throw new ConsoleError(400, "That rule is not valid.", "bad_id");
        return await ctx.deps.rpc("console_flag_rule_remove", { ...who(ctx, p), p_rule: id });
      },
    },
  },
};
