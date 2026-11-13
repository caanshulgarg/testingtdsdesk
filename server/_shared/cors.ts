// The one list of sites and headers for every FinCom function a browser calls (review of 02-Oct-2026: admin and signin
// got staging.fincom.live on 01-Oct, the gateway's own copy of the list did not, and bill reading failed on staging).
// Imported as "../_shared/cors.ts" by every function; see README.md here for what each deploy must include.
// Plain module: no imports, and Deno is only touched when it is there, so tests/run_cors_preflight.js loads it in Node.

// Only TDS Desk's own pages may call the functions that check the origin.
// The fixed list is FinCom's own https sites. "null" (a file opened from disk) and a developer's own machine
// (http://localhost:8000, http://127.0.0.1:8000) are allowed only where a function's ALLOWED_ORIGINS secret lists them
// (staging, a developer's project).
export const ALLOWED_ORIGINS = [
  "https://caanshulgarg.github.io",
  "https://staging.fincom.live", "https://app.fincom.live", "https://fincom.live",   // FinCom's own sites
];
// the FinCom Console's two sites (the same two as server/console/core/router.ts DEFAULT_ORIGINS). Only the signin
// function adds them (its cors.ts): the console signs its people in there
export const CONSOLE_ORIGINS = ["https://console.fincom.live", "https://console-staging.fincom.live"];
// every header the app (and the Tally bridge, x-fincom-device) sends
export const ALLOW_HEADERS = "authorization, x-client-info, apikey, content-type, x-fincom-device";

// the fixed list, plus any set in the function's ALLOWED_ORIGINS secret (comma separated)
export function allowedOrigins(): string[] {
  const env = (globalThis as any).Deno?.env;
  const extra = String((env && env.get("ALLOWED_ORIGINS")) || "").split(",").map((s) => s.trim()).filter(Boolean);
  return [...ALLOWED_ORIGINS, ...extra];
}

// where a link FinCom makes, or a redirect it sends, may point (an emailed meeting link, the way back from Zoho):
// https sites of the list only, whatever the secret adds; never "null", a plain http address or a machine's own name
export function linkOrigins(): string[] {
  return allowedOrigins().filter((o) => {
    try { const u = new URL(o); return u.protocol === "https:" && u.origin === o && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) && !/\.(local|localhost|internal)$/.test(u.hostname); } catch { return false; }
  });
}

// the CORS headers for a request. any: answer "*" (functions that authenticate every call by a token or a device key
// and keep "*"); methods: what the function answers to
// also: more sites for this function alone
export function corsFor(req: Request | null, opts?: { any?: boolean, methods?: string, also?: string[] }): Record<string, string> {
  const o = opts || {};
  const methods = o.methods || "POST, OPTIONS";
  if (o.any) return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": ALLOW_HEADERS, "Access-Control-Allow-Methods": methods };
  const origin = (req && req.headers.get("Origin")) || "";
  const allow = allowedOrigins().includes(origin) || (o.also || []).includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
    "Access-Control-Allow-Methods": methods,
  };
}
