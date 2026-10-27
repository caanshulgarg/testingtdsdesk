// tests/console_stand_ai.ts: the AI control centre's part of the console stand (tests/console_stand.ts calls aiRpc
// first): in-memory ai_features, the kill switch, plan allowances, firm overrides and 60 days of usage rows, keeping
// migration 121's rules (roles checked by the "database", one audit row with each change, a model must be allowed, a
// billing item's price is not set here). Used by tests/run_console_ai_ui.py.
type Add = (a: any, action: string, tt: string, tid: string, before: unknown, after: unknown) => void;
export type AiStand = { roleOf: (by: string) => string; addAudit: Add; firms: { id: string; name: string; plan: string }[] };

const FEATURES: any[] = [
  ["bill_read", "Bill reading", "anthropic", true, "per_use", 300, "claude", 425, false, "claude-sonnet-5 (claude-opus-5 for the careful re-read)", ["claude-sonnet-5", "claude-sonnet-4-6", "claude-opus-5"]],
  ["bill_ocr", "Page OCR", "google", false, "per_use", 100, "vision", 13, false, "Google Vision text detection", []],
  ["assistant", "Ask FinCom", "anthropic", false, "included", 0, null, 0, true, "Haiku 5.5 routes, Sonnet 5.5 answers, Opus 5.5 for heavy work", []],
  ["notice", "Notice reading and reply", "anthropic", false, "included", 0, null, 0, true, "claude-opus-5-5", []],
  ["voice", "Voice typing", "groq", false, "included", 0, null, 0, true, "whisper-large-v3 (turbo for a long clip)", []],
  ["call_captions", "Call captions", "groq", false, "included", 0, null, 0, true, "whisper-large-v3-turbo", []],
  ["call_summary", "Call summary", "anthropic", true, "included", 0, null, 0, true, "claude-sonnet-5-5", ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]],
  ["2b_match", "2B match", "anthropic", true, "included", 0, null, 0, true, "claude-sonnet-5-5", ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]],
  ["tds_match", "TDS challan match", "anthropic", true, "included", 0, null, 0, true, "claude-sonnet-5-5", ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]],
  ["mis_describe", "My MIS described", "anthropic", false, "included", 0, null, 0, true, "claude-sonnet-5-5", []],
  ["ledger_check", "GST and TDS ledger check", "anthropic", false, "included", 0, null, 0, true, "claude-haiku-5-5", []],
].map(([code, name, provider, settable, price_mode, price, item, cost, counts, model_default, allowed]) => ({
  code, name, provider, model: null, model_settable: settable, models_allowed: allowed, model_default, enabled: true, price_mode, price_per_use_paise: price,
  price_in_mtok_paise: 0, price_out_mtok_paise: 0, billing_item: item, cost_per_use_paise: cost, counts_against_allowance: counts,
  description: name + ": what it does", where_in_code: "server/" + code, log_labels: [code], updated_at: new Date(Date.now() - 86400000).toISOString(), updated_by: null,
}));
const settings = { kill: false, kill_reason: null as string | null, updated_at: new Date().toISOString(), updated_by: null as string | null, updated_by_email: null as string | null };
const plans: Record<string, any> = {};
const over: Record<string, any> = {};
let rows: any[] | null = null;
const MODELS: Record<string, string> = { assistant: "claude-sonnet-5-5", notice: "claude-opus-5-5", voice: "whisper-large-v3", call_captions: "whisper-large-v3-turbo",
  call_summary: "claude-sonnet-5-5", "2b_match": "claude-sonnet-5-5", tds_match: "claude-sonnet-5-5", bill_read: "", bill_ocr: "", ledger_check: "claude-haiku-5-5" };
const err = (c: string) => { throw new Error("console: " + c); };
const istDay = (ms: number) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);

function makeRows(s: AiStand) {
  // 60 days, 6 firms, several features: a made-up but steady pattern (no randomness: screenshots stay the same)
  const out: any[] = [];
  const firms = s.firms.slice(0, 6);
  for (let d = 0; d < 60; d++) {
    const day = istDay(Date.now() - d * 86400000);
    firms.forEach((f, fi) => {
      for (const [k, code] of ["assistant", "bill_read", "voice", "tds_match", "2b_match", "notice"].entries()) {
        if ((d + fi + k) % (k + 2) !== 0) continue;
        const calls = 1 + ((d * 7 + fi * 3 + k) % 9);
        const ft = FEATURES.find((x) => x.code === code)!;
        const cost = code === "bill_read" ? calls * 425 : code === "voice" ? 0 : calls * (code === "notice" ? 1800 : 140 + ((d + fi) % 5) * 30);
        const charged = code === "bill_read" ? calls * 300 : 0;
        out.push({ id: [day, f.id, code, MODELS[code]].join("|"), day, firm_id: f.id, firm: f.name, feature: code, feature_name: ft.name, model: MODELS[code],
          calls, tokens_in: code === "voice" || code === "bill_read" ? 0 : calls * 2400, tokens_out: code === "voice" || code === "bill_read" ? 0 : calls * 380,
          seconds: code === "voice" ? calls * 25 : 0, cost_paise: cost, charged_paise: charged, margin_paise: charged - cost });
      }
    });
  }
  return out;
}

export function aiRpc(fn: string, a: any, s: AiStand): any {
  const need = (roles: string[]) => { if (!roles.includes(s.roleOf(a.p_by))) err("not_allowed"); };
  const planOf = (name: string) => Object.values(plans).find((p: any) => p.plan === name);
  switch (fn) {
    case "console_ai_overview": {
      for (const name of new Set(s.firms.map((f) => f.plan))) if (!planOf(name)) { const id = "00000000-0000-4000-8000-0000000003" + String(Object.keys(plans).length).padStart(2, "0"); plans[id] = { plan_id: id, plan: name, allowance_paise: null, after_allowance: "charge", set: false, updated_at: null }; }
      for (const p of Object.values(plans) as any[]) p.firms = s.firms.filter((f) => f.plan === p.plan).length;
      return { settings: { ...settings }, features: FEATURES.map((f) => ({ ...f })), plans: Object.values(plans).map((p) => ({ ...p })), firm_overrides: Object.keys(over).length,
               month: new Date().toISOString().slice(0, 7) };
    }
    case "console_ai_firms": {
      rows = rows || makeRows(s);
      const m0 = istDay(Date.now()).slice(0, 7);
      return s.firms.map((f) => {
        const o = over[f.id], p: any = planOf(f.plan);
        const spent = rows!.filter((r) => r.firm_id === f.id && r.day.startsWith(m0)).reduce((x, r) => x + r.cost_paise, 0);
        const allowance = o?.allowance_paise ?? p?.allowance_paise ?? null;
        return { firm_id: f.id, firm: f.name, plan: f.plan, plan_id: p?.plan_id, ai_off: !!o?.ai_off, features_off: o?.features_off || [], firm_allowance_paise: o?.allowance_paise ?? null,
          firm_after: o?.after_allowance ?? null, plan_allowance_paise: p?.allowance_paise ?? null, plan_after: p?.after_allowance || "charge", allowance_paise: allowance,
          after_allowance: o?.after_allowance ?? p?.after_allowance ?? "charge", allowance_from: o?.allowance_paise != null ? "firm" : p?.allowance_paise != null ? "plan" : "none",
          spent_paise: spent, calls: rows!.filter((r) => r.firm_id === f.id && r.day.startsWith(m0)).reduce((x, r) => x + r.calls, 0), owner_switch: true, owner_cap_paise: null, updated_at: o?.updated_at || null };
      });
    }
    case "console_ai_usage": {
      rows = rows || makeRows(s);
      const to = a.p_to || istDay(Date.now()), from = a.p_from || istDay(Date.parse(to + "T00:00:00Z") - 29 * 86400000);
      if (from > to) err("ai_bad_range");
      const r = rows.filter((x) => x.day >= from && x.day <= to);
      return { rows: r.map((x) => ({ ...x })), total: r.length, truncated: false };
    }
    case "console_ai_feature_set": {
      need(["owner"]);
      const f = FEATURES.find((x) => x.code === a.p_code); if (!f) err("ai_no_feature");
      const p = a.p_patch || {};
      if ("model" in p && p.model !== null && !(f.model_settable && f.models_allowed.includes(p.model))) err("ai_bad_model");
      if (f.billing_item && ["price_mode", "price_per_use_paise", "price_in_mtok_paise", "price_out_mtok_paise"].some((k) => k in p)) err("ai_bad_value");
      const before = { enabled: f.enabled, model: f.model, price_mode: f.price_mode, price_per_use_paise: f.price_per_use_paise };
      Object.assign(f, p, { updated_at: new Date().toISOString(), updated_by: a.p_by });
      s.addAudit(a, "ai.feature.set", "ai_feature", f.code, before, p);
      return { code: f.code, enabled: f.enabled, model: f.model };
    }
    case "console_ai_kill": {
      need(["owner"]);
      if (settings.kill === a.p_on) err("same_status");
      settings.kill = a.p_on; settings.kill_reason = a.p_on ? a.p_reason : null; settings.updated_at = new Date().toISOString(); settings.updated_by = a.p_by;
      s.addAudit(a, a.p_on ? "ai.kill" : "ai.unkill", "ai_settings", "global", null, { kill: a.p_on });
      return { kill: a.p_on };
    }
    case "console_ai_plan_set": {
      need(["owner", "billing"]);
      const p = plans[a.p_plan]; if (!p) err("ai_no_plan");
      s.addAudit(a, "ai.plan.set", "plan", a.p_plan, { allowance_paise: p.allowance_paise }, { allowance_paise: a.p_allowance_paise, after_allowance: a.p_after });
      Object.assign(p, { allowance_paise: a.p_allowance_paise, after_allowance: a.p_after, set: true, updated_at: new Date().toISOString() });
      return { plan_id: a.p_plan };
    }
    case "console_ai_firm_set": {
      need(["owner", "billing"]);
      if (!s.firms.some((f) => f.id === a.p_firm)) err("no_firm");
      if ((a.p_features_off || []).some((c: string) => !FEATURES.some((f) => f.code === c))) err("ai_no_feature");
      over[a.p_firm] = { ai_off: a.p_ai_off, allowance_paise: a.p_allowance_paise, after_allowance: a.p_after, features_off: [...new Set(a.p_features_off as string[])].sort(), updated_at: new Date().toISOString() };
      s.addAudit(a, "ai.firm.set", "firm", a.p_firm, null, over[a.p_firm]);
      return { firm_id: a.p_firm };
    }
  }
  return undefined;
}
