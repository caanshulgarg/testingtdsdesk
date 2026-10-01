// Only TDS Desk's own pages may call these functions from a browser.
const ALLOWED = [
  "https://caanshulgarg.github.io",
  "https://staging.fincom.live", "https://app.fincom.live", "https://fincom.live",   // FinCom's own sites (review, 01-Oct-2026: "Load failed" from staging)
  "null",                         // the standalone file opened from disk
  "http://localhost:8000", "http://127.0.0.1:8000",
];
export function corsFor(req: Request): Record<string, string> {
  const o = req.headers.get("Origin") || "";
  const extra = (Deno.env.get("ALLOWED_ORIGINS") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allow = [...ALLOWED, ...extra].includes(o) ? o : ALLOWED[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
