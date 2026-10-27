// gst-2b-match: GSTR-2B matched against the books by itself (round 72b). index.ts serves this handler with the official
// Anthropic SDK; the tests (handler_test.ts) give it a fake Supabase and a fake Claude.
//   POST, a signed-in member of the firm (two-step sign-in done), for one of the firm's clients:
//     {action: "run", client_id, gstin, fy, why, ai, books: [rows], twob: [{period, rows}]}
//         the app's purchases of the year (as GST2B reads them) and its 2B documents, kept (gst_2b_inputs); then the run:
//         nothing changed since the last run (same purchases, same 2B, a 2B fetched here read from gst_returns) and not
//         "match again": the last run is answered again (no new run, no AI cost). Look-only members get the last run.
//     {action: "latest", client_id, gstin, fy}                         the last run
//     {action: "decide", client_id, gstin, fy, pairs: [pair ids], decision: "accept" | "reject"}
//         a person's choice on probable pairs, kept (gst_2b_decisions); the result again with the AI's earlier pairs (no call)
//   POST from inside the platform (gst-taxpro after a 2B is fetched, with the service key; or the database's timer with
//   x-cron-key): {action: "queue"} runs the waiting runs (gst2b_take), each with what the app last sent and every 2B
//   fetched for the year.
// The AI: only when the firm's switch (assistant_settings, as Ask FinCom) is on AND the app said AI help is on for 2B
// (AIH, Settings › AI help; kept with the inputs for the timer's runs). Claude's key is the platform's (platform_secrets
// claude_api_key), read with the service role. The firm's rupee cap (asst_cap_take), the cost (asst_cost_add, feature
// "2b_match") and one log line (asst_log_add) as every Ask FinCom call.
// The AI control centre (console phase 4, 27-Oct-2026): before the AI, the console's switches for "2b_match" are asked
// (ai_allowed through ../_shared/ai_policy.ts); off -> the rules' result only, and ai.say gives FinCom's words. A model
// set there replaces Sonnet.
import { corsFor } from "../_shared/cors.ts";
import { m2bFrom2bJson, m2bRow2b, m2bRowBk } from "../_shared/match2b.js";
import { AiClient, matchRun, reapply, SONNET } from "./match.ts";
import { aiPolicy } from "../_shared/ai_policy.ts";

export type Deps = { env: (k: string) => string | undefined, fetch: typeof fetch, anthropic: (key: string) => AiClient };

const GSTIN = /^\d{2}[A-Z0-9]{13}$/, FY = /^20\d{2}-\d{2}$/, PERIOD = /^(0[1-9]|1[0-2])20\d{2}$/;
const WHY = ["fetched", "uploaded", "new entries", "opened", "match again"];
const MAX_ROWS = 20000;

// the 12 return periods (MMYYYY) of a financial year "2026-27"
export function fyPeriods(fy: string): string[] {
  const y = +fy.slice(0, 4), out: string[] = [];
  for (let m = 4; m <= 15; m++) out.push(String(m <= 12 ? m : m - 12).padStart(2, "0") + String(m <= 12 ? y : y + 1));
  return out;
}
async function sha256(s: string) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch;
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || ""), ANON = String(env("SUPABASE_ANON_KEY") || "");
  const rest = async (path: string, token: string, init: RequestInit = {}) => {
    const r = await doFetch(URL_ + path, { ...init, headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const t = await r.text();
    let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status });
    return j;
  };
  const rpc = (fn: string, args: Record<string, unknown>, token = SERVICE) => rest("/rest/v1/rpc/" + fn, token, { method: "POST", body: JSON.stringify(args) });
  const q = (v: string) => encodeURIComponent(v);
  const where = (firm: string, gstin: string, fy: string) => "firm_id=eq." + q(firm) + "&gstin=eq." + q(gstin) + "&fy=eq." + q(fy);

  const lastDone = async (firm: string, gstin: string, fy: string) =>
    ((await rest("/rest/v1/gst_2b_runs?select=*&" + where(firm, gstin, fy) + "&status=eq.done&order=id.desc&limit=1", SERVICE)) as any[])[0] || null;
  const decisionsOf = async (firm: string, gstin: string, fy: string) => {
    const rows = (await rest("/rest/v1/gst_2b_decisions?select=pair_id,decision&" + where(firm, gstin, fy), SERVICE)) as any[];
    return Object.fromEntries((rows || []).map((r) => [r.pair_id, r.decision]));
  };
  // what a run reads: the app's purchases, its 2B documents, and every 2B fetched on the server for the year (which
  // wins over the app's copy of the same period: it is the portal's own)
  const inputsOf = async (firm: string, gstin: string, fy: string) => {
    const rows = (await rest("/rest/v1/gst_2b_inputs?select=side,period,rows,ai_allowed,client_id&" + where(firm, gstin, fy), SERVICE)) as any[];
    const bk = (rows || []).find((r) => r.side === "books");
    const per: Record<string, any[]> = {};
    (rows || []).filter((r) => r.side === "2b").forEach((r) => { per[r.period] = r.rows || []; });
    const fetched = (await rest("/rest/v1/gst_returns?select=period,data&firm_id=eq." + q(firm) + "&gstin=eq." + q(gstin) + "&form=eq.2B&status=eq.ok&period=in.(" + fyPeriods(fy).join(",") + ")", SERVICE)) as any[];
    const portal: string[] = [];
    (fetched || []).forEach((r) => { if (!r.data) return; per[r.period] = m2bFrom2bJson({ data: r.data }).rows.filter((x: any) => !x.rej).map(m2bRow2b); portal.push(r.period); });
    const periods = Object.keys(per).sort();
    return { books: bk ? (bk.rows || []) : null, twob: periods.flatMap((p) => per[p]), periods, portal, aiAllowed: !!(bk && bk.ai_allowed), client: bk ? bk.client_id : "" };
  };
  const firmAiOn = async (firm: string) => {
    const s = await rest("/rest/v1/assistant_settings?select=enabled&firm_id=eq." + q(firm), SERVICE).catch(() => null) as any[] | null;
    return s !== null && (s[0] || { enabled: true }).enabled !== false;       // on unless the owner switched it off (14-Oct-2026)
  };
  const policy = aiPolicy((fn, args) => rpc(fn, args));
  const keyOf = async () => {
    try { const k = (await rest("/rest/v1/platform_secrets?select=value&name=eq.claude_api_key", SERVICE)) as any[]; return (k && k[0] && k[0].value) || ""; } catch { return ""; }
  };
  // what a run read, as one hash: the same purchases and the same 2B documents give the same answer
  const hashOf = (inp: { books: any[] | null, twob: any[] }) => sha256(JSON.stringify([(inp.books || []).map(m2bRowBk).sort((a: any, c: any) => a.id < c.id ? -1 : 1),
    inp.twob.map(m2bRow2b).sort((a: any, c: any) => a.key < c.key ? -1 : 1)]));
  const shown = (run: any, decisions?: Record<string, string>) => run && ({ id: run.id, why: run.why, status: run.status, at: run.done_at || run.queued_at, line: run.line, counts: run.counts, result: run.result,
    ai: run.ai ? { ...run.ai, pairs: undefined } : null, periods: (run.result && run.result.periods) || [], decisions: decisions || undefined });

  // one run: the inputs, the rules, the AI (once), kept as a new row of gst_2b_runs (or the queued row it was)
  async function doRun(firm: string, gstin: string, fy: string, why: string, user: string | null, queuedId: number | null) {
    const inp = await inputsOf(firm, gstin, fy);
    if (!inp.books) throw new Error("The app has not sent the purchases of " + fy + " yet: open the client's 2B page once.");
    const decisions = await decisionsOf(firm, gstin, fy);
    const hash = await hashOf(inp);
    const last = await lastDone(firm, gstin, fy);
    if (last && last.inputs_hash === hash && why !== "match again") {
      if (queuedId) await rest("/rest/v1/gst_2b_runs?id=eq." + queuedId, SERVICE, { method: "PATCH", body: JSON.stringify({ status: "done", done_at: new Date().toISOString(), inputs_hash: hash, error: "nothing changed since run " + last.id }) });
      return { run: last, decisions, same: true };
    }
    let id = queuedId;
    if (!id) {
      const row = (await rest("/rest/v1/gst_2b_runs", SERVICE, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
        firm_id: firm, client_id: inp.client, gstin, fy, why, status: "running", by_user: user, started_at: new Date().toISOString() }) })) as any[];
      id = row[0].id;
    }
    try {
      // the console's switches (AI control centre): off -> the rules' result, with FinCom's words in ai.say
      const [pol, on] = inp.aiAllowed ? await Promise.all([policy.aiAllowed(firm, "2b_match"), firmAiOn(firm)]) : [null, false];
      const allowed = inp.aiAllowed && !!pol?.ok && on;
      const key = allowed ? await keyOf() : "";
      const model = (pol && pol.ok && pol.model) || SONNET;
      const out = await matchRun(inp.twob, inp.books, decisions, {
        client: key ? deps.anthropic(key) : null, aiAllowed: allowed, offSay: pol && !pol.ok ? pol.message : undefined, model,
        capTake: async () => { const c = await rpc("asst_cap_take", { p_firm: firm, p_n: 1 }); return { ok: !!c?.ok, why: String(c?.why || "") }; },
        costAdd: (usd, u) => rpc("asst_cost_add", { p_firm: firm, p_feature: "2b_match", p_cost_usd: usd, p_in: u.input_tokens || 0, p_out: u.output_tokens || 0, p_cache_read: u.cache_read_input_tokens || 0, p_cache_write: u.cache_creation_input_tokens || 0 }),
        log: (x) => rpc("asst_log_add", { p_firm: firm, p_user: user, p_client: inp.client, p_question: x.question, p_tools: [], p_in: x.input, p_out: x.output, p_calls: x.calls, p_ms: x.ms,
          p_feature: "2b_match", p_route: x.route, p_models: [model], p_cache_read: x.cacheRead, p_cache_write: x.cacheWrite, p_cost_inr: x.inr, p_fell_through: false }),
      });
      const result = { ...out.result, periods: inp.periods, portal: inp.portal };
      const patch = { status: "done", done_at: new Date().toISOString(), inputs_hash: hash, counts: out.result.counts, line: out.result.line, result, ai: out.ai };
      const done = (await rest("/rest/v1/gst_2b_runs?id=eq." + id, SERVICE, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) })) as any[];
      return { run: done[0], decisions };
    } catch (e) {
      await rest("/rest/v1/gst_2b_runs?id=eq." + id, SERVICE, { method: "PATCH", body: JSON.stringify({ status: "failed", done_at: new Date().toISOString(), error: String((e as Error).message || e).slice(0, 500) }) }).catch(() => {});
      throw e;
    }
  }

  return async (req: Request): Promise<Response> => {
    const cors = corsFor(req);
    const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    let body: any;
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const action = String(body?.action || "");

    // the platform's own callers: gst-taxpro (service key) and the database's timer (x-cron-key)
    if (action === "queue") {
      const ck = req.headers.get("x-cron-key") || "";
      const inside = (SERVICE && jwt === SERVICE) || (ck && (await rpc("gst_cron_ok", { k: ck }).catch(() => false)) === true);
      if (!inside) return reply(401, { ok: false, error: "Not allowed." });
      const until = Date.now() + 100_000;
      let done = 0, failed = 0;
      while (Date.now() < until) {
        const runs = (await rpc("gst2b_take", { p_n: 3 })) as any[];
        if (!runs || !runs.length) break;
        for (const r of runs) {
          try { await doRun(r.firm_id, r.gstin, r.fy, r.why, null, r.id); done++; } catch { failed++; }
        }
      }
      return reply(200, { ok: true, done, failed });
    }

    if (!jwt || jwt === ANON || jwt === SERVICE) return reply(401, { ok: false, kind: "auth", error: "Sign in to the firm account first." });
    let user: any;
    try { user = await rest("/auth/v1/user", jwt); } catch { return reply(401, { ok: false, kind: "auth", error: "Sign in again." }); }
    if (!user?.id) return reply(401, { ok: false, kind: "auth", error: "Sign in again." });
    try { if ((await rpc("mfa_ok", {}, jwt)) !== true) return reply(403, { ok: false, kind: "mfa", error: "Finish the two-step sign-in first." }); }
    catch { return reply(403, { ok: false, kind: "mfa", error: "Finish the two-step sign-in first." }); }
    const mem = (await rest("/rest/v1/members?select=firm_id,role,active&user_id=eq." + q(user.id), SERVICE).catch(() => [])) as any[];
    const member = (mem || []).find((m) => m.active);
    if (!member) return reply(403, { ok: false, kind: "firm", error: "This account is not part of a firm." });
    const firm = String(member.firm_id), writer = member.role === "owner" || member.role === "staff";
    const clientId = String(body.client_id || "").slice(0, 120), gstin = String(body.gstin || "").toUpperCase(), fy = String(body.fy || "");
    if (!clientId || !GSTIN.test(gstin) || !FY.test(fy)) return reply(400, { ok: false, error: "Say the client, the GSTIN and the year (2026-27)." });
    // the client must be one of the firm's (read as the user: row-level security decides)
    const c = (await rest("/rest/v1/clients?select=id,deleted&id=eq." + q(clientId), jwt).catch(() => [])) as any[];
    if (!c || !c.length || c[0].deleted) return reply(403, { ok: false, kind: "client", error: "This client is not one of your firm's." });

    try {
      if (action === "latest" || (action === "run" && !writer)) {
        return reply(200, { ok: true, run: shown(await lastDone(firm, gstin, fy), await decisionsOf(firm, gstin, fy)) });
      }
      if (action === "run") {
        const why = WHY.includes(body.why) ? body.why : "opened";
        const books = (Array.isArray(body.books) ? body.books : []).slice(0, MAX_ROWS).map(m2bRowBk);
        const now = new Date().toISOString();
        const rows: any[] = [{ firm_id: firm, gstin, fy, side: "books", period: "", client_id: clientId, rows: books, n: books.length, ai_allowed: body.ai === true, by_user: user.id, at: now }];
        const per = fyPeriods(fy);
        for (const t of (Array.isArray(body.twob) ? body.twob : []).slice(0, 12)) {
          const p = String(t?.period || "");
          if (!PERIOD.test(p) || !per.includes(p)) continue;
          const r2 = (Array.isArray(t.rows) ? t.rows : []).slice(0, MAX_ROWS).map(m2bRow2b);
          rows.push({ firm_id: firm, gstin, fy, side: "2b", period: p, client_id: clientId, rows: r2, n: r2.length, ai_allowed: body.ai === true, by_user: user.id, at: now });
        }
        await rest("/rest/v1/gst_2b_inputs?on_conflict=firm_id,gstin,fy,side,period", SERVICE, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
        const r = await doRun(firm, gstin, fy, why, user.id, null);
        return reply(200, { ok: true, same: !!r.same, run: shown(r.run, r.decisions) });
      }
      if (action === "decide") {
        if (!writer) return reply(403, { ok: false, kind: "role", error: "Only the owner or staff can accept or reject." });
        const decision = body.decision === "accept" ? "accept" : body.decision === "reject" ? "reject" : "";
        const pairs = (Array.isArray(body.pairs) ? body.pairs : []).map((x: unknown) => String(x)).filter((x: string) => x.length >= 3 && x.length <= 4000 && x.indexOf(">") > 0).slice(0, 500);
        if (!decision || !pairs.length) return reply(400, { ok: false, error: "Say which pairs, and accept or reject." });
        const last = await lastDone(firm, gstin, fy);
        if (!last) return reply(409, { ok: false, error: "Nothing has been matched yet." });
        await rest("/rest/v1/gst_2b_decisions?on_conflict=firm_id,gstin,fy,pair_id", SERVICE, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(pairs.map((p: string) => ({ firm_id: firm, gstin, fy, pair_id: p, decision, by_user: user.id, at: new Date().toISOString() }))) });
        const inp = await inputsOf(firm, gstin, fy), decisions = await decisionsOf(firm, gstin, fy);
        const out = reapply(inp.twob, inp.books || [], decisions, last.ai);
        const row = (await rest("/rest/v1/gst_2b_runs", SERVICE, { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({
          firm_id: firm, client_id: clientId, gstin, fy, why: "decided", status: "done", by_user: user.id, started_at: new Date().toISOString(), done_at: new Date().toISOString(),
          inputs_hash: await hashOf(inp), counts: out.result.counts, line: out.result.line, result: { ...out.result, periods: inp.periods, portal: inp.portal }, ai: out.ai }) })) as any[];
        return reply(200, { ok: true, run: shown(row[0], decisions) });
      }
      return reply(400, { ok: false, error: "Unknown request" });
    } catch (e) {
      return reply(500, { ok: false, kind: "other", error: String((e as Error).message || e).slice(0, 300) });
    }
  };
}
