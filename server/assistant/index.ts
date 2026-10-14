// fincom-assistant: FinCom Assistant's function (the owner's approval of AI in the app, 13-Oct-2026; never called by the
// bridge or the Tally add-on). One POST per question; the answer streams back as server-sent events (agent.ts).
//   {action: "ask", question, client_id | null, history: [{role, content}], attachments: [{path, name, type}], firm: {name, lines}}
//   {action: "report", client_id, question, note, tools, entries}      the "Wrong answer?" button
// Who: the signed-in user's token, their two-step sign-in, an active member of a firm whose owner has not switched the
// assistant off (assistant_settings; on by default: the owner's decision of 14-Oct-2026); a client must be one of that firm's
// (read with the user's own token: row-level security decides). The book tools run with the user's token too. Claude's key
// is the platform's (platform_secrets "claude_api_key", the one bill reading uses), read with the service role, never sent
// anywhere but Anthropic. Before each AI call the firm's rupee cap is checked (asst_cap_take); after it, its cost is added
// (asst_cost_add). The same first question on the same books is answered from the answer cache (assistant_answers) at no
// cost. One log line per question: its text, the tools, how it was answered, the tokens, the cost and the time
// (asst_log_add); never an answer or a figure of the books.
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";
import { corsFor } from "../_shared/cors.ts";
import { cloudReporter } from "../_shared/sentry.ts";
import { Ev, runTurn, TurnCtx } from "./agent.ts";
import { FREE_SOURCES } from "./citations.ts";
import { DocSpec, makeFile, MIME, safeName } from "./files.ts";

export type Env = (k: string) => string | undefined;
export type Deps = { env: Env, fetch: typeof fetch, anthropic?: (key: string) => TurnCtx["client"], sentry?: ReturnType<typeof cloudReporter>, now?: () => Date,
  levers?: TurnCtx["levers"] & { answerCache?: boolean } };   // levers: only for measuring them (tests/assistant_cost.ts)

const BUCKET = "assistant-files";
const MAX_NOTICE = 20 * 1024 * 1024;
const enc = new TextEncoder();

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch;
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || ""), ANON = String(env("SUPABASE_ANON_KEY") || "");
  const sentry = deps.sentry || cloudReporter({ release: "fincom-assistant-1.0.0", env, fetch: doFetch });

  // PostgREST and Storage with a token: the user's (row-level security) or the service role's
  const rest = async (path: string, token: string, init: RequestInit = {}) => {
    const r = await doFetch(URL_ + path, { ...init, headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const t = await r.text();
    let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status });
    return j;
  };
  const rpc = (fn: string, args: Record<string, unknown>, token: string) => rest("/rest/v1/rpc/" + fn, token, { method: "POST", body: JSON.stringify(args) });

  return async (req: Request): Promise<Response> => {
    const cors = corsFor(req);
    const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    const t0 = Date.now();
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt || jwt === ANON) return reply(401, { ok: false, kind: "auth", error: "Sign in to the firm account first." });
    let user: any;
    try { user = await rest("/auth/v1/user", jwt); } catch { return reply(401, { ok: false, kind: "auth", error: "Sign in again." }); }
    if (!user?.id) return reply(401, { ok: false, kind: "auth", error: "Sign in again." });
    try { if ((await rpc("mfa_ok", {}, jwt)) !== true) return reply(403, { ok: false, kind: "mfa", error: "Finish the two-step sign-in first." }); }
    catch { return reply(403, { ok: false, kind: "mfa", error: "Finish the two-step sign-in first." }); }
    const mem = (await rest("/rest/v1/members?select=firm_id,role,active&user_id=eq." + encodeURIComponent(user.id), SERVICE).catch(() => [])) as any[];
    const member = (mem || []).find((m) => m.active);
    if (!member) return reply(403, { ok: false, kind: "firm", error: "This account is not part of a firm." });
    const firm = String(member.firm_id);

    // the firm's switch (assistant_settings). The owner's decision of 14-Oct-2026: ON for every firm unless its owner
    // switches it off (a firm with no row is on), and no clients'-consent tick (the app shows the notice on first use)
    const setRows = await rest("/rest/v1/assistant_settings?select=enabled&firm_id=eq." + firm, SERVICE).catch(() => null) as any[] | null;
    if (setRows === null) return reply(503, { ok: false, kind: "other", error: "The firm's setting could not be read; try again in a moment." });
    const set = setRows[0] || { enabled: true };
    if (set.enabled === false) return reply(403, { ok: false, kind: "off", error: "FinCom Assistant is switched off for your firm. The firm's owner can switch it on in Settings › AI help." });

    let body: any;
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    const action = String(body?.action || "ask");
    const clientId = body?.client_id ? String(body.client_id).slice(0, 120) : null;
    // the client must be one the user's firm has (read as the user: row-level security)
    let clientName = "";
    if (clientId) {
      const c = (await rest("/rest/v1/clients?select=id,name,gstin,deleted&id=eq." + encodeURIComponent(clientId), jwt).catch(() => [])) as any[];
      if (!c || !c.length || c[0].deleted) return reply(403, { ok: false, kind: "client", error: "This client is not one of your firm's." });
      clientName = String(c[0].name || clientId);
    }

    // the "Wrong answer?" button: a row the owner sees, and one event to Sentry (the note stays in the database)
    if (action === "report") {
      const tools = (Array.isArray(body.tools) ? body.tools : []).map((x: unknown) => String(x).slice(0, 40)).filter((x: string) => /^[a-z_0-9]+$/.test(x)).slice(0, 20);
      const entries = (Array.isArray(body.entries) ? body.entries : []).map((x: unknown) => String(x).slice(0, 80)).slice(0, 50);
      const row = (await rest("/rest/v1/assistant_mismatches", SERVICE, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
        firm_id: firm, client_id: clientId, user_id: user.id, kind: "user_report", question: String(body.question || "").slice(0, 2000), figure: "answer reported wrong",
        figure_key: "user_report", tool: tools[0] || "", params: { tools }, entry_ids: entries, note: String(body.note || "").slice(0, 300) }) })) as any[];
      const id = row && row[0] && row[0].id;
      if (id) sentry.mismatch("user-report", { figureKey: "user_report", tool: tools[0] || "none", id, entries, firm, client: clientId || "" });
      return reply(200, { ok: true, id });
    }
    if (action !== "ask") return reply(400, { ok: false, error: "Unknown request" });
    const question = String(body.question || "").trim().slice(0, 4000);
    if (!question) return reply(400, { ok: false, error: "Type a question." });

    // the platform's Claude key (the one bill reading uses)
    let key = "";
    try { const k = (await rest("/rest/v1/platform_secrets?select=value&name=eq.claude_api_key", SERVICE)) as any[]; key = (k && k[0] && k[0].value) || ""; } catch { key = ""; }
    if (!key) return reply(503, { ok: false, kind: "bad_key", error: "No Claude key is set on the platform yet. Ask the administrator." });

    // a notice the user attached: read from the firm's private bucket with the user's own token
    const attachments: Record<string, unknown>[] = [];
    let noticePath = "";
    for (const a of (Array.isArray(body.attachments) ? body.attachments : []).slice(0, 3)) {
      const path = String(a?.path || "");
      if (!path.startsWith(firm + "/") || !/\/notices\//.test(path) || path.includes("..")) return reply(403, { ok: false, kind: "file", error: "That file is not one of your firm's notices." });
      const r = await doFetch(URL_ + "/storage/v1/object/authenticated/" + BUCKET + "/" + path.split("/").map(encodeURIComponent).join("/"), { headers: { apikey: ANON, Authorization: "Bearer " + jwt } });
      if (!r.ok) { await r.body?.cancel(); return reply(403, { ok: false, kind: "file", error: "The notice could not be read (" + r.status + ")." }); }
      const buf = new Uint8Array(await r.arrayBuffer());
      noticePath = noticePath || path;
      if (buf.length > MAX_NOTICE) return reply(413, { ok: false, kind: "file", error: "The notice is larger than 20 MB." });
      const type = String(a?.type || r.headers.get("content-type") || "");
      const b64 = btoa(Array.from(buf, (c) => String.fromCharCode(c)).join(""));
      if (/pdf/i.test(type) || /\.pdf$/i.test(path)) attachments.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 }, title: String(a?.name || "notice").slice(0, 120) });
      else if (/^image\/(png|jpeg|webp|gif)$/.test(type)) attachments.push({ type: "image", source: { type: "base64", media_type: type, data: b64 } });
      else return reply(415, { ok: false, kind: "file", error: "A notice must be a PDF or a picture (PNG, JPEG, WebP)." });
    }

    // the books held (for the prompt's context) and the last entry held (periods are read against it)
    let books = "", anchor = "";
    if (clientId) {
      try {
        const b = await rpc("asst_books", { p_client: clientId }, jwt);
        books = b && !b.none ? "Books held: " + (b.rows || []).map((r: any) => r.company + " from " + r.from + " to " + r.to + " (" + r.entries + " entries)").join("; ") + "." : "FinCom holds no books for this client yet.";
        anchor = ((b && b.rows) || []).map((r: any) => String(r.to || "")).filter((x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().pop() || "";
      } catch { books = ""; }
    }
    const today = (deps.now ? deps.now() : new Date()).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const tools: string[] = [];
    let usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, calls = 0, route = "", models: string[] = [], costUsd = 0, costInr = 0, feature = "", fellThrough = false;

    // files the firm's assistant made that are past their 30 days: removed from the bucket (their rows stay, unseen)
    (async () => {
      try {
        const old = (await rest("/rest/v1/assistant_files?select=path&firm_id=eq." + firm + "&expires_at=lt." + new Date().toISOString() + "&limit=100", SERVICE)) as any[];
        if (old && old.length) await (await doFetch(URL_ + "/storage/v1/object/" + BUCKET, { method: "DELETE", headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: old.map((x) => x.path) }) })).text();
      } catch { /* next time */ }
    })();

    // the answer cache: the first question of a conversation, no notice; keyed by the question (and today, when it names a
    // relative period), the client and the version of the client's books. General questions keep 7 days, a client's 30.
    const history = (Array.isArray(body.history) ? body.history : []).filter((h: any) => h && (h.role === "user" || h.role === "assistant"));
    let cacheKey = "", cacheVersion = "";
    if (!attachments.length && !history.length && deps.levers?.answerCache !== false) {
      const nq = question.toLowerCase().replace(/[^a-z0-9₹%.,]+/g, " ").replace(/\s+/g, " ").trim();
      const rel = /\b(this|last|current|previous|today|yesterday|ytd|so far|to date|recent|latest|now)\b/.test(nq) ? "|" + today : "";
      cacheKey = await sha256(nq + rel + "|" + (clientId ? "client" : "firm"));
      try { cacheVersion = clientId ? String(await rpc("asst_data_version", { p_client: clientId }, jwt) || "") : "general"; } catch { cacheVersion = ""; }
      if (cacheVersion) {
        const hit = ((await rest("/rest/v1/assistant_answers?select=events,made_at&firm_id=eq." + firm + "&client_id=eq." + encodeURIComponent(clientId || "") + "&key=eq." + cacheKey +
          "&version=eq." + encodeURIComponent(cacheVersion) + "&expires_at=gt." + new Date().toISOString() + "&limit=1", SERVICE).catch(() => [])) as any[])[0];
        if (hit && Array.isArray(hit.events)) {
          const evs = hit.events as Ev[];
          const done = evs.find((e) => e.t === "done") as any;
          try { await rpc("asst_log_add", { p_firm: firm, p_user: user.id, p_client: clientId, p_question: question, p_tools: (done && done.tools) || [], p_in: 0, p_out: 0, p_calls: 0, p_ms: Date.now() - t0,
            p_feature: "cache", p_route: "cache", p_models: [], p_cache_read: 0, p_cache_write: 0, p_cost_inr: 0, p_fell_through: false }, SERVICE); } catch { /* the answer still stands */ }
          const out = [{ t: "start", client: clientId, clientName, cached: true }, ...evs.map((e) => e.t === "done" ? { ...e, cached: String(hit.made_at || ""), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 } } : e)];
          return new Response(out.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""), { headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" } });
        }
      }
    }
    const kept: Ev[] = [];
    const upload = async (bytes: Uint8Array, fileName: string, kind: string) => {
      const id = crypto.randomUUID(), name = safeName(fileName).replace(/\.(xlsx|docx|pdf|zip)$/i, "") + "." + kind;
      const path = firm + "/" + (clientId ? clientId.replace(/[^A-Za-z0-9_-]/g, "_") : "_firm") + "/files/" + id + "." + kind;
      const up = await doFetch(URL_ + "/storage/v1/object/" + BUCKET + "/" + path, { method: "POST", headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": MIME[kind] || "application/octet-stream", "x-upsert": "true" }, body: bytes as unknown as BodyInit });
      await up.text();
      if (!up.ok) return null;
      const row = (await rest("/rest/v1/assistant_files", SERVICE, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ id, firm_id: firm, client_id: clientId, path, name, kind, bytes: bytes.length, made_by: user.id }) })) as any[];
      return { id, name, kind, path, expires: String(row?.[0]?.expires_at || ""), bytes: bytes.length };
    };

    const stream = new ReadableStream({
      async start(ctl) {
        const emit = (e: Record<string, unknown>) => {
          if (e.t !== "text" && e.t !== "tool") kept.push(e as Ev);
          try { ctl.enqueue(enc.encode("data: " + JSON.stringify(e) + "\n\n")); } catch { /* the browser went away */ }
        };
        const ctx: TurnCtx = {
          client: deps.anthropic ? deps.anthropic(key) : (new Anthropic({ apiKey: key, maxRetries: 1, timeout: 170_000 }) as unknown as TurnCtx["client"]),
          question, history: history.map((h: any) => ({ role: h.role, content: String(h.content || "") })),
          attachments, noticePath, clientId, clientName, firmWide: !clientId, today, books, anchor, chatEffort: String(env("ASSISTANT_CHAT_EFFORT") || "medium"), levers: deps.levers,
          exec: (fn, args) => rpc(fn, args, jwt),
          capTake: async () => { const r = await rpc("asst_cap_take", { p_firm: firm, p_n: 1 }, SERVICE); return { ok: !!r?.ok, used: Number(r?.used || 0), cap: Number(r?.cap || 0), spent_inr: Number(r?.spent_inr || 0), cap_inr: Number(r?.cap_inr || 0), warn: !!r?.warn, why: String(r?.why || "") }; },
          costAdd: async (feat, usd, u) => {
            const r = await rpc("asst_cost_add", { p_firm: firm, p_feature: feat, p_cost_usd: usd, p_in: u.input_tokens || 0, p_out: u.output_tokens || 0, p_cache_read: u.cache_read_input_tokens || 0, p_cache_write: u.cache_creation_input_tokens || 0 }, SERVICE);
            costInr += Number(r?.inr || 0);
            return r ? { spent_inr: Number(r.spent_inr || 0), cap_inr: Number(r.cap_inr || 0), warn: !!r.warn, over: !!r.over } : null;
          },
          makeFile: async (spec: DocSpec, fileName: string) => upload(await makeFile(spec, { fetch: doFetch }), fileName, spec.format),
          uploadFile: upload,
          saveNotice: async (row) => {
            const r = (await rest("/rest/v1/assistant_notices", SERVICE, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ...row, firm_id: firm, created_by: user.id }) })) as any[];
            return (r && r[0] && r[0].id) || null;
          },
          updateNotice: async (id, patch) => { await rest("/rest/v1/assistant_notices?id=eq." + id + "&firm_id=eq." + firm, SERVICE, { method: "PATCH", body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) }); },
          fetchPage: async (url) => {
            if (!FREE_SOURCES.test(url)) return null;
            try {
              const r = await doFetch(url, { headers: { "User-Agent": "FinCom-citation-check/1.0", Accept: "text/html,text/plain" }, signal: AbortSignal.timeout(8000), redirect: "follow" });
              if (!r.ok || !/text\/(html|plain)/i.test(r.headers.get("content-type") || "")) { await r.body?.cancel(); return null; }
              return (await r.text()).slice(0, 3_000_000);
            } catch { return null; }
          },
          recordMismatch: async (m) => {
            try {
              const row = (await rest("/rest/v1/assistant_mismatches", SERVICE, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
                firm_id: firm, client_id: clientId, user_id: user.id, kind: "auto", question, ...m }) })) as any[];
              const id = row && row[0] && row[0].id;
              if (id) sentry.mismatch("assistant-mismatch", { figureKey: m.figure_key, tool: m.tool, id, entries: m.entry_ids, firm, client: clientId || "" });
              return id || null;
            } catch { return null; }
          },
          firm: { name: String(body?.firm?.name || "").slice(0, 120), lines: (Array.isArray(body?.firm?.lines) ? body.firm.lines : []).map((l: unknown) => String(l).slice(0, 160)).slice(0, 4) },
          emit,
        };
        try {
          emit({ t: "start", client: clientId, clientName });
          const r = await runTurn(ctx);
          tools.push(...r.tools); usage = r.usage; calls = r.calls; route = r.route; models = r.models; costUsd = r.costUsd; feature = r.feature; fellThrough = r.fellThrough;
          // kept for the next time the same question is asked on the same books (only answers that cost something)
          if (cacheKey && cacheVersion && r.cacheable && r.route !== "keyword") {
            const done = kept.find((e) => e.t === "done");
            if (done) (done as any).tools = r.tools;
            await rest("/rest/v1/assistant_answers", SERVICE, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ firm_id: firm, client_id: clientId || "", key: cacheKey, version: cacheVersion, events: kept,
              expires_at: new Date(Date.now() + (clientId ? 30 : 7) * 86400_000).toISOString() }) }).catch(() => {});
          }
        } catch (e) {
          const status = (e as any)?.status;
          const kind = status === 429 ? "rate_limit" : status === 401 || status === 403 ? "bad_key" : status >= 500 ? "overloaded" : "other";
          emit({ t: "error", kind, message: kind === "rate_limit" ? "Claude is busy; try again in a minute." : kind === "bad_key" ? "The platform's Claude key was refused. Ask the administrator." : "The assistant could not answer just now; try again." });
          sentry.report("assistant_turn", { message: "turn failed " + kind }, { kind: "ask", firm });
        }
        // one line: the question, the tools, the tokens and the time (never the answer or a figure)
        try { await rpc("asst_log_add", { p_firm: firm, p_user: user.id, p_client: clientId, p_question: question, p_tools: tools, p_in: usage.input, p_out: usage.output, p_calls: calls, p_ms: Date.now() - t0,
          p_feature: feature, p_route: route, p_models: models, p_cache_read: usage.cacheRead, p_cache_write: usage.cacheWrite, p_cost_inr: costInr, p_fell_through: fellThrough }, SERVICE); } catch { /* the answer still stands */ }
        console.log(JSON.stringify({ evt: "assistant", route, calls, tools: tools.length, in: usage.input, out: usage.output, cache_read: usage.cacheRead, usd: Math.round(costUsd * 1e4) / 1e4, ms: Date.now() - t0 }));
        try { ctl.close(); } catch { /* closed */ }
      },
    });
    return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" } });
  };
}

// deployed: a one-line index.ts imports this file from the repository at a pinned commit and calls main() (the pinned
// GitHub import of docs/bridge-2.4.4-notes.md); run directly, it serves too
export function main() {
  const sentry = cloudReporter({ release: "fincom-assistant-1.0.0" });
  sentry.listen();
  Deno.serve(sentry.wrap(handler({ env: (k) => Deno.env.get(k), fetch: (...a) => fetch(...a), sentry })));
}
if (import.meta.main) main();

async function sha256(s: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}
