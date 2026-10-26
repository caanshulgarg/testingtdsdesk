// fincom-assistant: FinCom Assistant's function (the owner's approval of AI in the app, 13-Oct-2026; never called by the
// bridge or the Tally add-on). One POST per question; the answer streams back as server-sent events (agent.ts).
//   {action: "ask", question, client_id | null, history: [{role, content}], attachments: [{path, name, type}], firm: {name, lines},
//    lang: the voice language chosen ("en-IN", "hi-IN", "hinglish", "mr-IN", …: agent.ts LANGS), a hint for the reply's language}
//   {action: "report", client_id, question, note, tools, entries}      the "Wrong answer?" button
//   {action: "sheet_map", client_id, head, rows, side}                  a register's new format: its columns (sheetmap.ts)
//   {action: "ledger_guess", client_id, ledgers: [{name, group, chain, open, taxType, nature, use, samples}], parties}
//                                                                      the AI guess for ledgers the rules could not tell (ledgers.ts)
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
import { Ev, langOf, notEnglish, runTurn, TurnCtx, TurnTrace } from "./agent.ts";
import { classify } from "./failure.ts";
import { FREE_SOURCES } from "./citations.ts";
import { classifyUpload } from "./upload.ts";
import { DocSpec, makeFile, MIME, safeName } from "./files.ts";
import { isSheetName, readSheetFile, renderSheetFile, SheetFile } from "./filetable.ts";
import { PARTY_FIELDS, PARTY_SYSTEM, parseSheetMap, sheetPrompt, SHEET_SYSTEM } from "./sheetmap.ts";
import { guessLedgers, LEDGER_GUESS_V } from "./ledgers.ts";
import { capWords, costUsd as priceUsd, HAIKU } from "./models.ts";

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
    // a database error keeps PostgREST's code (Postgres's SQLSTATE, e.g. 42501) and is marked as the database's, so a failed
    // turn is never taken for the AI service's (a 403 here is not a refused Claude key)
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status, source: "db", code: j && typeof j.code === "string" ? j.code : undefined });
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
    // the AI guess for the TDS and GST ledgers FinCom's rules could not tell (ledgers.ts): one batch on the cheap model,
    // each ledger's answer cached for the firm and client; a guess only, never applied as confirmed
    if (action === "ledger_guess") {
      if (!clientId) return reply(400, { ok: false, error: "Open a client first." });
      let lkey = "";
      try { const k = (await rest("/rest/v1/platform_secrets?select=value&name=eq.claude_api_key", SERVICE)) as any[]; lkey = (k && k[0] && k[0].value) || ""; } catch { lkey = ""; }
      if (!lkey) return reply(503, { ok: false, kind: "bad_key", error: "No Claude key is set on the platform yet. Ask the administrator." });
      const where = "firm_id=eq." + firm + "&client_id=eq." + encodeURIComponent(clientId) + "&version=eq." + LEDGER_GUESS_V;
      try {
        const r = await guessLedgers({
          client: deps.anthropic ? deps.anthropic(lkey) : (new Anthropic({ apiKey: lkey, maxRetries: 1, timeout: 120_000 }) as unknown as TurnCtx["client"]),
          capTake: async () => { const c = await rpc("asst_cap_take", { p_firm: firm, p_n: 1 }, SERVICE); return { ok: !!c?.ok, why: String(c?.why || "") }; },
          costAdd: (feat, usd, u) => rpc("asst_cost_add", { p_firm: firm, p_feature: feat, p_cost_usd: usd, p_in: u.input_tokens || 0, p_out: u.output_tokens || 0, p_cache_read: u.cache_read_input_tokens || 0, p_cache_write: u.cache_creation_input_tokens || 0 }, SERVICE),
          cacheGet: async (keys) => {
            const out: Record<string, any> = {};
            for (let i = 0; i < keys.length; i += 50) {
              const rows = (await rest("/rest/v1/assistant_answers?select=key,events&" + where + "&expires_at=gt." + new Date().toISOString() + "&key=in.(" + keys.slice(i, i + 50).join(",") + ")", SERVICE)) as any[];
              for (const row of rows || []) { const g = Array.isArray(row.events) ? row.events[0] : null; if (g && g.t === "ledger_guess" && g.guess) out[row.key] = g.guess; }
            }
            return out;
          },
          cachePut: async (rows) => { await rest("/rest/v1/assistant_answers", SERVICE, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(rows.map((x) => ({
            firm_id: firm, client_id: clientId, key: x.key, version: LEDGER_GUESS_V, events: [{ t: "ledger_guess", guess: x.guess }], expires_at: new Date(Date.now() + 180 * 86400_000).toISOString() }))) }); },
        }, body.ledgers, body.parties);
        try { await rpc("asst_log_add", { p_firm: firm, p_user: user.id, p_client: clientId, p_question: "ledger guess: " + r.asked + " asked, " + r.cached + " cached", p_tools: [], p_in: r.usage.input_tokens || 0, p_out: r.usage.output_tokens || 0,
          p_calls: r.asked ? 1 : 0, p_ms: Date.now() - t0, p_feature: "ledger_guess", p_route: r.asked ? "haiku" : "cache", p_models: r.asked ? [HAIKU] : [], p_cache_read: r.usage.cache_read_input_tokens || 0, p_cache_write: r.usage.cache_creation_input_tokens || 0, p_cost_inr: 0, p_fell_through: false }, SERVICE); } catch { /* the guesses still stand */ }
        if ((r as any).capped) return reply(429, { ok: false, kind: "cap", error: ((r as any).capped === "balance" || (r as any).capped === "off" ? capWords((r as any).capped, 0, 0) + " The rules' guesses are shown." : (r as any).capped === "calls" ? "Your firm has used today's AI calls. The rules' guesses are shown; AI guesses start again at midnight (India time)."
          : "Your firm has used this month's limit for AI. The rules' guesses are shown; AI guesses start again on the 1st of next month (India time)."), guesses: r.guesses, cached: r.cached });
        return reply(200, { ok: true, guesses: r.guesses, cached: r.cached, asked: r.asked, usd: Math.round(r.usd * 1e6) / 1e6, model: HAIKU });
      } catch (e) {
        const status = (e as any)?.status;
        sentry.report("assistant_ledger_guess", { message: "ledger guess failed " + (status || "") }, { kind: "ledger_guess", firm });
        return reply(502, { ok: false, kind: status === 429 ? "rate_limit" : "other", error: "AI could not be asked just now; the rules' guesses are shown." });
      }
    }
    if (action !== "ask" && action !== "classify" && action !== "sheet_map") return reply(400, { ok: false, error: "Unknown request" });
    const question = action === "classify" ? "(what is this upload: " + String(body.name || "a file").slice(0, 120) + ")" : action === "sheet_map" ? "sheet_map" : String(body.question || "").trim().slice(0, 4000);
    if (!question) return reply(400, { ok: false, error: "Type a question." });

    // the platform's Claude key (the one bill reading uses)
    let key = "";
    try { const k = (await rest("/rest/v1/platform_secrets?select=value&name=eq.claude_api_key", SERVICE)) as any[]; key = (k && k[0] && k[0].value) || ""; } catch { key = ""; }
    if (!key) return reply(503, { ok: false, kind: "bad_key", error: "No Claude key is set on the platform yet. Ask the administrator." });

    // a register's new format (sheetmap.ts): the header and 10 masked rows to the cheap model, once per format; under the
    // firm's switch, consent and rupee cap like every call; the answer is a mapping the person confirms, never a figure
    if (action === "sheet_map") {
      const head = (Array.isArray(body.head) ? body.head : []).map((x: unknown) => String(x ?? "").slice(0, 60)).slice(0, 80);
      const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 10).map((r: unknown) => (Array.isArray(r) ? r : []).map((x: unknown) => String(x ?? "").slice(0, 40)).slice(0, 80));
      if (head.filter(Boolean).length < 2) return reply(400, { ok: false, error: "No header row was sent." });
      const party = body.side === "vendor" || body.side === "customer";
      const cap = await rpc("asst_cap_take", { p_firm: firm, p_n: 1 }, SERVICE).catch(() => null);
      if (!cap?.ok) return reply(429, { ok: false, kind: "cap", error: cap ? capWords(String(cap.why || ""), Number(cap.cap_inr || 0), Number(cap.cap || 0)) : "The firm's AI limit could not be checked; try again." });
      const client = deps.anthropic ? deps.anthropic(key) : (new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60_000 }) as unknown as TurnCtx["client"]);
      try {
        const msg: any = await (client as any).messages.create({ model: HAIKU, max_tokens: 1200,
          system: [{ type: "text", text: party ? PARTY_SYSTEM : SHEET_SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
          messages: [{ role: "user", content: sheetPrompt(head, rows, String(body.side || "purchase")) }] });
        const text = (msg?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
        const usd = priceUsd(HAIKU, msg?.usage || {});
        const added = await rpc("asst_cost_add", { p_firm: firm, p_feature: "sheet_map", p_cost_usd: usd, p_in: msg?.usage?.input_tokens || 0, p_out: msg?.usage?.output_tokens || 0,
          p_cache_read: msg?.usage?.cache_read_input_tokens || 0, p_cache_write: msg?.usage?.cache_creation_input_tokens || 0 }, SERVICE).catch(() => null);
        try { await rpc("asst_log_add", { p_firm: firm, p_user: user.id, p_client: clientId, p_question: "sheet format (" + head.length + " columns)", p_tools: [], p_in: msg?.usage?.input_tokens || 0,
          p_out: msg?.usage?.output_tokens || 0, p_calls: 1, p_ms: Date.now() - t0, p_feature: "sheet_map", p_route: "sheet_map", p_models: [HAIKU], p_cache_read: msg?.usage?.cache_read_input_tokens || 0,
          p_cache_write: msg?.usage?.cache_creation_input_tokens || 0, p_cost_inr: Number(added?.inr || 0), p_fell_through: false }, SERVICE); } catch { /* the mapping still stands */ }
        return reply(200, { ok: true, ...parseSheetMap(text, head, party ? PARTY_FIELDS : undefined), cost: { usd, inr: Number(added?.inr || 0), model: HAIKU } });
      } catch (e) {
        sentry.report("sheet_map", e, { kind: "sheet_map", firm });
        return reply(502, { ok: false, kind: "other", error: "FinCom's AI could not read the format just now. Map the columns yourself, or try again." });
      }
    }

    // a notice or another upload the user attached: read from the firm's private bucket with the user's own token
    const attachments: Record<string, unknown>[] = [];
    const sheets: SheetFile[] = [];
    let sf: SheetFile | null = null;
    let noticePath = "";
    // files uploaded in the chat for a tool to read (a signed balance sheet, a certificate format, a letterhead):
    // <firm>/<client or _firm>/uploads/...; never sent to the model as they are (the tool reads them)
    const uploads: { path: string, name: string, type: string }[] = [];
    const isUpload = (p: string) => p.startsWith(firm + "/") && !p.includes("..") && /^[^/]+\/[^/]+\/uploads\//.test(p);
    for (const a of [...(Array.isArray(body.uploads) ? body.uploads : []), ...(Array.isArray(body.attachments) ? body.attachments : [])].slice(0, 40)) {
      const path = String(a?.path || "");
      if (!/\/uploads\//.test(path)) continue;
      if (!isUpload(path)) return reply(403, { ok: false, kind: "file", error: "That file is not one of your firm's uploads." });
      if (!uploads.some((u) => u.path === path)) uploads.push({ path, name: String(a?.name || path.split("/").pop() || "file").slice(0, 160), type: String(a?.type || "").slice(0, 120) });
    }
    // a file from the Upload asked about (it says its kind) is read as an attachment too; the certificate tool's files are not
    for (const a of (Array.isArray(body.attachments) ? body.attachments : []).filter((a: any) => !/\/uploads\//.test(String(a?.path || "")) || typeof a?.kind === "string").slice(0, 3)) {
      const path = String(a?.path || "");
      // a notice (…/notices/) or any other upload (…/uploads/) of the firm, read with the user's own token
      if (!path.startsWith(firm + "/") || !/\/(notices|uploads)\//.test(path) || path.includes("..")) return reply(403, { ok: false, kind: "file", error: "That file is not one of your firm's uploads." });
      const r = await doFetch(URL_ + "/storage/v1/object/authenticated/" + BUCKET + "/" + path.split("/").map(encodeURIComponent).join("/"), { headers: { apikey: ANON, Authorization: "Bearer " + jwt } });
      if (!r.ok) { await r.body?.cancel(); return reply(403, { ok: false, kind: "file", error: "The notice could not be read (" + r.status + ")." }); }
      const buf = new Uint8Array(await r.arrayBuffer());
      noticePath = noticePath || path;
      if (buf.length > MAX_NOTICE) return reply(413, { ok: false, kind: "file", error: "The notice is larger than 20 MB." });
      const type = String(a?.type || r.headers.get("content-type") || "");
      const b64 = btoa(Array.from(buf, (c) => String.fromCharCode(c)).join(""));
      if (/pdf/i.test(type) || /\.pdf$/i.test(path)) attachments.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 }, title: String(a?.name || "notice").slice(0, 120) });
      else if (/^image\/(png|jpeg|webp|gif)$/.test(type)) attachments.push({ type: "image", source: { type: "base64", media_type: type, data: b64 } });
      // a sheet: FinCom reads it itself (the bytes; else the page's text) and shows it with row numbers and column letters,
      // so make_file can copy its cells (filetable.ts); masked by the agent like the question
      else if (isSheetName(String(a?.name || path), type) && (sf = await readSheetFile(sheets.length + 1, String(a?.name || path.split("/").pop() || "sheet").slice(0, 120), type, buf, typeof a?.text === "string" ? a.text : ""))) {
        sheets.push(sf);
        attachments.push({ type: "text", text: renderSheetFile(sf) });
      }
      // a Word file: the text FinCom took out of it on the page (masked by the agent like the question)
      else if (typeof a?.text === "string" && a.text.trim()) attachments.push({ type: "text", text: "[The file " + String(a?.name || "uploaded").slice(0, 120) + ", as FinCom read it]\n" + String(a.text).slice(0, 20000) });
      else if (action !== "classify") return reply(415, { ok: false, kind: "file", error: "That file can be asked about as a PDF, a picture (PNG, JPEG, WebP), a sheet or a Word file." });
    }

    // an upload FinCom's own rules could not tell: what it is, in one line (upload.ts); nothing else is done with it
    if (action === "classify") {
      const capTake = async () => { const r = await rpc("asst_cap_take", { p_firm: firm, p_n: 1 }, SERVICE); return { ok: !!r?.ok, cap_inr: Number(r?.cap_inr || 0), cap: Number(r?.cap || 0), why: String(r?.why || "") }; };
      const costAdd = (feat: string, usd: number, u: any) => rpc("asst_cost_add", { p_firm: firm, p_feature: feat, p_cost_usd: usd, p_in: u.input_tokens || 0, p_out: u.output_tokens || 0, p_cache_read: u.cache_read_input_tokens || 0, p_cache_write: u.cache_creation_input_tokens || 0 }, SERVICE);
      try {
        const r = await classifyUpload({ client: deps.anthropic ? deps.anthropic(key) : (new Anthropic({ apiKey: key, maxRetries: 1, timeout: 120_000 }) as unknown as TurnCtx["client"]),
          attachments, name: String(body.name || ""), excerpt: String(body.excerpt || "").slice(0, 20000), capTake, costAdd });
        const u: any = r.ok ? r.usage : {};
        try { await rpc("asst_log_add", { p_firm: firm, p_user: user.id, p_client: clientId, p_question: question, p_tools: ["classify_upload"], p_in: u.input_tokens || 0, p_out: u.output_tokens || 0, p_calls: r.ok ? 1 : 0, p_ms: Date.now() - t0,
          p_feature: "upload", p_route: "haiku", p_models: r.ok ? ["claude-haiku-5-5"] : [], p_cache_read: 0, p_cache_write: 0, p_cost_inr: 0, p_fell_through: false }, SERVICE); } catch { /* logged best effort */ }
        return r.ok ? reply(200, { ok: true, kind: r.kind, summary: r.summary }) : reply(r.kind === "cap" ? 429 : 502, { ok: false, kind: r.kind || "other", error: r.error });
      } catch (e) {
        const status = (e as any)?.status;
        return reply(502, { ok: false, kind: status === 429 ? "rate_limit" : "other", error: "The file's kind could not be worked out just now." });
      }
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
    if (!attachments.length && !uploads.length && !history.length && deps.levers?.answerCache !== false) {
      // letters of every script (a question in Hindi or Tamil is not all spaces); Hinglish or an Indian script keeps its own key
      const nq = question.toLowerCase().replace(/[^\p{L}\p{M}\p{N}₹%.,]+/gu, " ").replace(/\s+/g, " ").trim() + (notEnglish(question, langOf(body.lang)) ? "|" + (langOf(body.lang) || "native") : "");
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
    const trace: TurnTrace = { step: "turn" };          // where the turn is; read when it fails (failure.ts)
    // the certificates' store (migration 83): the firm's details for certificates, saved formats, the confirmed figures;
    // written here with the service role for the user's firm only (the tables' RLS lets the firm's members read them)
    const certStore = (firmId: string, uid: string) => ({
      settings: async () => ((await rest("/rest/v1/assistant_cert_settings?select=*&firm_id=eq." + firmId, SERVICE).catch(() => [])) as any[])[0] || null,
      saveSettings: async (x: Record<string, unknown>) => {
        const row: Record<string, unknown> = { firm_id: firmId, updated_by: uid, updated_at: new Date().toISOString() };
        for (const k of ["firm_name", "frn", "signatory", "designation", "membership_no", "place", "letterhead_path", "letterhead_footer_path", "default_format", "confirmed"]) if (x[k] !== undefined) row[k] = x[k];
        await rest("/rest/v1/assistant_cert_settings", SERVICE, { method: "POST", headers: { Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(row) });
      },
      formats: async () => ((await rest("/rest/v1/assistant_cert_formats?select=id,name,path,kind,fields&firm_id=eq." + firmId + "&order=made_at.desc", SERVICE).catch(() => [])) as any[]) || [],
      saveFormat: async (f: Record<string, unknown>) => {
        const r = (await rest("/rest/v1/assistant_cert_formats", SERVICE, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ firm_id: firmId, name: String(f.name).slice(0, 120), path: f.path, kind: f.kind, fields: f.fields, made_by: uid }) })) as any[];
        return (r && r[0] && r[0].id) || null;
      },
      figures: async (client: string, fy: string) => ((await rest("/rest/v1/assistant_cert_figures?select=figures,basis&firm_id=eq." + firmId + "&client_id=eq." + encodeURIComponent(client) + "&fy=eq." + encodeURIComponent(fy) + "&order=made_at.desc&limit=1", SERVICE).catch(() => [])) as any[])[0] || null,
      saveFigures: async (x: Record<string, unknown>) => { await rest("/rest/v1/assistant_cert_figures", SERVICE, { method: "POST", body: JSON.stringify({ firm_id: firmId, client_id: x.client, fy: x.fy, basis: x.basis, figures: x.figures, made_by: uid }) }); },
      // a copy kept in the firm's settings folder (a letterhead, a format), so it outlives the chat's uploads
      keep: async (path: string, name: string) => {
        if (!path.startsWith(firmId + "/")) return null;
        const to = firmId + "/_firm/settings/" + crypto.randomUUID().slice(0, 8) + "-" + safeName(name);
        const r = await doFetch(URL_ + "/storage/v1/object/copy", { method: "POST", headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, body: JSON.stringify({ bucketId: BUCKET, sourceKey: path, destinationKey: to }) });
        await r.text();
        return r.ok ? to : null;
      },
    });
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
          question, lang: langOf(body.lang), history: history.map((h: any) => ({ role: h.role, content: String(h.content || "") })),
          attachments, sheets, uploadKind: (Array.isArray(body.attachments) && body.attachments[0] && typeof body.attachments[0].kind === "string") ? String(body.attachments[0].kind).slice(0, 20) : undefined,
          noticePath: (Array.isArray(body.attachments) && body.attachments[0] && body.attachments[0].kind && body.attachments[0].kind !== "notice") ? "" : noticePath, clientId, clientName, firmWide: !clientId, today, books, anchor, chatEffort: String(env("ASSISTANT_CHAT_EFFORT") || "medium"), levers: deps.levers,
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
          uploads,
          // a file of the firm's private bucket, read as the user (row-level security on storage decides)
          readFile: async (path) => {
            if (!path.startsWith(firm + "/") || path.includes("..")) return null;
            const r = await doFetch(URL_ + "/storage/v1/object/authenticated/" + BUCKET + "/" + path.split("/").map(encodeURIComponent).join("/"), { headers: { apikey: ANON, Authorization: "Bearer " + jwt } });
            if (!r.ok) { await r.body?.cancel(); return null; }
            const b = new Uint8Array(await r.arrayBuffer());
            return b.length > MAX_NOTICE ? null : b;
          },
          clientInfo: async (id) => ((await rest("/rest/v1/clients?select=*&id=eq." + encodeURIComponent(id), jwt).catch(() => [])) as any[])[0] || null,
          // what was uploaded to the client before (<firm>/<client>/uploads/), newest first
          clientFiles: async (id) => {
            const r = (await rest("/storage/v1/object/list/" + BUCKET, jwt, { method: "POST", body: JSON.stringify({ prefix: firm + "/" + id.replace(/[^A-Za-z0-9_-]/g, "_") + "/uploads/", limit: 40, sortBy: { column: "created_at", order: "desc" } }) }).catch(() => [])) as any[];
            return (r || []).filter((o) => o && o.name && !o.name.endsWith("/")).map((o) => ({ path: firm + "/" + id.replace(/[^A-Za-z0-9_-]/g, "_") + "/uploads/" + o.name, name: String(o.name).replace(/^[a-z0-9]+-/, ""), type: String(o.metadata?.mimetype || "") }));
          },
          certStore: certStore(firm, user.id),
          firm: { name: String(body?.firm?.name || "").slice(0, 120), lines: (Array.isArray(body?.firm?.lines) ? body.firm.lines : []).map((l: unknown) => String(l).slice(0, 160)).slice(0, 4) },
          emit,
          trace,
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
          // what failed, in plain words for the user and in codes for Sentry (failure.ts); the event's exception is the
          // error's class and stack with fixed words; the API's own message goes in extra, scrubbed (scrubApiMessage)
          const f = classify(e, trace);
          emit({ t: "error", kind: f.kind, message: f.message });
          const rep = new Error("answer failed");
          rep.name = f.errorClass;
          if (typeof (e as Error)?.stack === "string") rep.stack = f.errorClass + ": answer failed\n" + String((e as Error).stack).split("\n").slice(1).join("\n");
          sentry.report("assistant_turn", rep, { kind: f.kind, firm, tags: f.tags, ...(f.apiMessage ? { extra: { api_message: f.apiMessage } } : {}) });
          console.log(JSON.stringify({ evt: "assistant_failed", kind: f.kind, ...f.tags, error: f.errorClass }));
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
