// The Messages API request shape FinCom sends, checked against what the API documents for the three models it uses
// (platform.claude.com, as of 14-Oct-2026: Messages, structured outputs, refusal fallbacks, server tools, prompt caching).
// Used by the tests: the mocked Claude refuses a request the real API would refuse with a 400, so a request the real API
// rejects can no longer pass the tests (Sentry FINCOM-CLOUD-STAGING-1/-2: every call was refused for 35-52 strict tools).
// Returns the problems found, in the API's terms; [] when the request is valid. Plain module: no Deno, no imports.
import { STRICT_LIMITS, strictLoad } from "./tools.ts";

const MODELS = new Set(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
const TOP = new Set(["model", "max_tokens", "messages", "system", "tools", "tool_choice", "thinking", "output_config", "cache_control", "betas", "fallbacks", "metadata", "stop_sequences", "stream"]);
const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "uniqueItems", "patternProperties"];
const WEB_TOOLS = new Set(["web_search_20260209", "web_fetch_20260209"]);   // dynamic filtering: Opus 5.5 and Sonnet 5.5, not Haiku

export function apiShape(p: Record<string, any>): string[] {
  const bad: string[] = [];
  const model = String(p.model || "");
  const haiku = model === "claude-haiku-5-5";
  if (!MODELS.has(model)) bad.push("model: " + model + " is not one FinCom uses");
  for (const k of Object.keys(p)) if (!TOP.has(k)) bad.push(k + ": Extra inputs are not permitted");
  if (!Number.isInteger(p.max_tokens) || p.max_tokens < 1 || p.max_tokens > 128000) bad.push("max_tokens: 1 to 128000");
  // thinking: adaptive (or left out); disabled and a budget are refused on the 5.5 models
  if (p.thinking !== undefined && !(p.thinking && p.thinking.type === "adaptive" && Object.keys(p.thinking).every((k) => k === "type" || k === "display"))) bad.push("thinking: only {type: adaptive} on " + model);
  if (p.output_config !== undefined) {
    for (const k of Object.keys(p.output_config || {})) if (!["effort", "format", "task_budget"].includes(k)) bad.push("output_config." + k + ": Extra inputs are not permitted");
    if (p.output_config?.effort !== undefined && !EFFORTS.has(p.output_config.effort)) bad.push("output_config.effort: " + p.output_config.effort);
  }
  for (const k of ["temperature", "top_p", "top_k"]) if (k in p) bad.push(k + ": not supported on " + model);
  // refusal fallbacks: the "default" form with its own beta; none on Haiku
  const betas: string[] = Array.isArray(p.betas) ? p.betas : [];
  if (p.fallbacks !== undefined) {
    if (haiku) bad.push("fallbacks: Haiku 5.5 has no server-side fallback");
    else if (p.fallbacks === "default" && !betas.includes("server-side-fallback-2026-07-01")) bad.push("fallbacks: \"default\" needs the server-side-fallback-2026-07-01 beta");
    else if (Array.isArray(p.fallbacks) && (!betas.includes("server-side-fallback-2026-06-01") || model === "claude-sonnet-5-5")) bad.push("fallbacks: the array form needs server-side-fallback-2026-06-01 and is not for Sonnet 5.5");
    else if (p.fallbacks !== "default" && !Array.isArray(p.fallbacks)) bad.push("fallbacks: \"default\" or a list");
  } else if (betas.some((b) => b.startsWith("server-side-fallback-"))) bad.push("betas: a fallback beta without fallbacks");
  // forced tool use is refused on the 5.5 models
  if (p.tool_choice && ["any", "tool"].includes(p.tool_choice.type)) bad.push("tool_choice: type " + p.tool_choice.type + " is not supported for this model");
  // messages: start with the user, no prefill
  const msgs: any[] = Array.isArray(p.messages) ? p.messages : [];
  if (!msgs.length || msgs[0].role !== "user") bad.push("messages: the first message must be the user's");
  if (msgs.length && msgs[msgs.length - 1].role === "assistant") bad.push("messages: an assistant prefill is not supported");
  // tools
  const tools: any[] = Array.isArray(p.tools) ? p.tools : [];
  const names = new Set<string>();
  for (const [i, t] of tools.entries()) {
    if (names.has(t.name)) bad.push("tools." + i + ": tool names must be unique (" + t.name + ")");
    names.add(t.name);
    if (t.type) {
      if (!WEB_TOOLS.has(t.type)) bad.push("tools." + i + ": unknown tool type " + t.type);
      else if (haiku) bad.push("tools." + i + ": " + t.type + " is not supported on Haiku 5.5");
      if (t.allowed_domains && t.blocked_domains) bad.push("tools." + i + ": allowed_domains or blocked_domains, not both");
      if ("strict" in t || "eager_input_streaming" in t || "input_schema" in t) bad.push("tools." + i + ": a server tool takes no strict, eager_input_streaming or input_schema");
      continue;
    }
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(String(t.name || ""))) bad.push("tools." + i + ".name");
    if (!t.input_schema || t.input_schema.type !== "object") bad.push("tools." + i + ".input_schema: an object schema");
    if (t.strict === true) {
      const walk = (s: any, path: string) => {
        if (!s || typeof s !== "object") return;
        if ((s.type === "object" || s.properties) && s.additionalProperties !== false) bad.push(path + ": additionalProperties must be false for strict");
        for (const kw of UNSUPPORTED) if (kw in s) bad.push(path + ": " + kw + " is not supported for strict");
        if ("minItems" in s && s.minItems > 1) bad.push(path + ": minItems above 1 is not supported for strict");
        for (const [k, v] of Object.entries<any>(s.properties || {})) walk(v, path + "." + k);
        if (s.items) walk(s.items, path + "[]");
        for (const a of s.anyOf || []) walk(a, path + "|");
      };
      walk(t.input_schema, "tools." + i + ".custom.input_schema");
    }
  }
  const n = strictLoad(tools);
  if (n.tools > STRICT_LIMITS.tools) bad.push("tools: " + n.tools + " strict tools; at most " + STRICT_LIMITS.tools);
  if (n.optional > STRICT_LIMITS.optional) bad.push("tools: " + n.optional + " optional parameters in strict schemas; at most " + STRICT_LIMITS.optional);
  if (n.unions > STRICT_LIMITS.unions) bad.push("tools: " + n.unions + " parameters with union types in strict schemas; at most " + STRICT_LIMITS.unions);
  // prompt caching: at most 4 breakpoints; a 1-hour entry may not come after a 5-minute one
  const marks: string[] = [];
  const mark = (c: any) => { if (c && c.type === "ephemeral") marks.push(c.ttl === "1h" ? "1h" : "5m"); else if (c) bad.push("cache_control: type ephemeral"); };
  for (const t of tools) mark(t.cache_control);
  for (const b of Array.isArray(p.system) ? p.system : []) mark(b.cache_control);
  for (const m of msgs) for (const b of Array.isArray(m.content) ? m.content : []) mark(b && b.cache_control);
  if (p.cache_control) mark(p.cache_control);
  if (marks.length > 4) bad.push("cache_control: at most 4 breakpoints (" + marks.length + ")");
  if (marks.indexOf("5m") >= 0 && marks.lastIndexOf("1h") > marks.indexOf("5m")) bad.push("cache_control: a 1-hour entry after a 5-minute one");
  return bad;
}
