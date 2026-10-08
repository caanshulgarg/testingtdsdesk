// Error reports to Sentry from a FinCom function (tally-ingest), on the STAGING database only (docs/sentry.md; the
// owner's conditions of 08-Oct-2026). No Sentry SDK: a report is one small event, built here and passed through the one
// scrubber the app uses too (./sentry-scrub.js), then posted as an envelope with fetch. Nothing else is ever added:
// never the request (its body, address or headers), never Tally's XML, never a firm's or client's id (a firm only as a
// 12-character hash), never a person.
//   const sentry = cloudReporter({ release: "tally-ingest-2.4.0" });
//   sentry.report("where in the code", error, { kind: body?.kind, firm });   // never throws, never waits
//   Deno.serve(sentry.wrap(async (req) => ...));                              // an unhandled error: reported, 500
// On when SUPABASE_URL is the staging project's, unless the function's secret FINCOM_SENTRY is "off".
// Plain module: Deno is only touched when it is there, so it can be tested with any env / fetch.
import { scrubEvent, scrubText, SENTRY_ENVIRONMENT } from "./sentry-scrub.js";

export const CLOUD_DSN = "https://b1bf9e2bf6722228683c21372db2bbc8@o4512221111320576.ingest.us.sentry.io/4512221235118080";
const STAGING_REF = "qbocskaiewaxqcvaunzc";
const PER_MINUTE = 30;

type Frame = { function: string, filename: string, lineno?: number, colno?: number, in_app?: boolean };
export type ReportCtx = { kind?: unknown, firm?: unknown };
type Opts = {
  release: string,
  dsn?: string,
  env?: (k: string) => string | undefined,
  fetch?: typeof fetch,
  waitUntil?: (p: Promise<unknown>) => void,
};

// V8's stack text into Sentry's frames, oldest first (what Sentry expects); the scrubber then keeps each file's last
// two parts only
export function parseStack(stack: unknown): Frame[] {
  if (typeof stack !== "string") return [];
  const out: Frame[] = [];
  for (const line of stack.split("\n").slice(1, 60)) {
    const m = line.match(/^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/);
    if (!m) continue;
    out.push({ function: m[1] || "<anonymous>", filename: m[2], lineno: Number(m[3]), colno: Number(m[4]), in_app: !/^(ext|node|internal):/.test(m[2]) });
  }
  return out.reverse();
}

async function hash12(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("fincom-sentry:" + s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}
const hex32 = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

function errorParts(err: unknown): { type: string, value: string, stack?: string } {
  if (err instanceof Error) return { type: err.name || "Error", value: err.message, stack: err.stack };
  if (typeof err === "string") return { type: "Error", value: err };
  // a database error ({code, message, details, hint}): its code and message only; details and hint carry rows' values
  const e = err as { code?: unknown, message?: unknown } | null;
  if (e && typeof e === "object" && typeof e.message === "string") return { type: "Error", value: (typeof e.code === "string" ? e.code + " " : "") + e.message };
  let v = "";
  try { v = String(err); } catch { v = ""; }
  return { type: "Error", value: v };
}

export function cloudReporter(o: Opts) {
  const deno = (globalThis as any).Deno;
  const env = o.env || ((k: string) => deno?.env?.get(k));
  const doFetch = o.fetch || ((...a: Parameters<typeof fetch>) => fetch(...a));
  const waitUntil = o.waitUntil || ((p: Promise<unknown>) => {
    const er = (globalThis as any).EdgeRuntime;
    if (er && typeof er.waitUntil === "function") er.waitUntil(p); else p.catch(() => {});
  });
  let host = "";
  try { host = new URL(String(env("SUPABASE_URL") || "")).hostname; } catch { host = ""; }
  const on = host === STAGING_REF + ".supabase.co" && String(env("FINCOM_SENTRY") || "").toLowerCase() !== "off";
  const dsn = new URL(o.dsn || CLOUD_DSN);
  const key = dsn.username, project = dsn.pathname.replace(/^\//, "");
  const ingest = dsn.protocol + "//" + dsn.host + "/api/" + project + "/envelope/";
  let minute = 0, sentThisMinute = 0;
  const lastSeen = new Map<string, number>();

  function report(where: string, err: unknown, ctx: ReportCtx = {}): void {
    if (!on) return;
    try {
      const now = Date.now(), m = Math.floor(now / 60000);
      if (m !== minute) { minute = m; sentThisMinute = 0; }
      const p = errorParts(err);
      const value = scrubText(p.value);
      // the same error (place and scrubbed words) at most once a minute; at most PER_MINUTE reports a minute
      const sig = where + "|" + p.type + "|" + value;
      if ((lastSeen.get(sig) || 0) > now - 60000 || sentThisMinute >= PER_MINUTE) return;
      lastSeen.set(sig, now);
      if (lastSeen.size > 500) lastSeen.clear();
      sentThisMinute++;
      waitUntil((async () => {
        const firm = typeof ctx.firm === "string" && /^[0-9a-f-]{36}$/.test(ctx.firm) ? await hash12(ctx.firm) : undefined;
        const raw = {
          event_id: hex32(), timestamp: now / 1000, platform: "javascript", level: "error", release: o.release, environment: SENTRY_ENVIRONMENT,
          exception: { values: [{ type: p.type, value: p.value, mechanism: { type: "generic", handled: where !== "unhandled" }, stacktrace: { frames: parseStack(p.stack) } }] },
          tags: { where, kind: typeof ctx.kind === "string" ? ctx.kind : undefined, firm },
          contexts: { runtime: { name: "deno", version: String(deno?.version?.deno || "") } },
          sdk: { name: "sentry.javascript.fincom-cloud", version: "1.0.0" },
        };
        const ev = scrubEvent(raw);
        if (!ev) return;
        const body = JSON.stringify({ event_id: ev.event_id, sent_at: new Date(now).toISOString(), dsn: o.dsn || CLOUD_DSN, sdk: { name: ev.sdk.name, version: ev.sdk.version } }) + "\n" +
          JSON.stringify({ type: "event" }) + "\n" + JSON.stringify(ev) + "\n";
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 5000);
        try {
          await doFetch(ingest, { method: "POST", body, signal: ctl.signal, headers: {
            "Content-Type": "application/x-sentry-envelope",
            "X-Sentry-Auth": "Sentry sentry_version=7, sentry_key=" + key + ", sentry_client=fincom-cloud/1.0.0",
          } });
        } finally { clearTimeout(t); }
      })().catch(() => { /* a report that cannot be sent is let go */ }));
    } catch { /* never in the way of the function */ }
  }

  // the function's handler: an error it did not catch is reported and answered 500 in plain words
  function wrap(h: (req: Request) => Promise<Response> | Response) {
    return async (req: Request): Promise<Response> => {
      try { return await h(req); } catch (e) {
        report("unhandled", e);
        console.error("tally-ingest unhandled", (e as Error)?.message);
        return new Response(JSON.stringify({ ok: false, error: "Something went wrong in FinCom's cloud; it was noted." }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    };
  }

  // errors no handler saw (a promise left to run on its own)
  function listen() {
    if (!on || typeof (globalThis as any).addEventListener !== "function") return;
    globalThis.addEventListener("unhandledrejection", (e: any) => report("unhandled rejection", e?.reason));
    globalThis.addEventListener("error", (e: any) => report("unhandled", e?.error ?? e?.message));
  }

  return { report, wrap, listen, on };
}
