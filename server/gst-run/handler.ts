// gst-run (next-cloud-gst, 09-Nov-2026): a client's GSTR-3B for a month, worked out in the cloud by the browser's own engine
// (server/_shared/gst3b.js through engine.js), so the page never works it out itself on a large book. index.ts serves it;
// handler_test.ts gives it a fake Supabase.
//   POST {action: "month", client_id, reg: "07", ym: "202510"}   (or months: ["202510", ...] for several of one registration)
//     from a signed-in member of the client's firm (any role: it only reads the books and keeps the answer). Another firm's
//     client, a paused firm or a switched-off client (the console's switches) is refused.
//   The answer kept: tally_calc_results (migration 151) kind "gst-3b", args "<reg>|<ym>", for every month up to the one
//     asked (each month's credit carried in and carried out with it), with the version of everything it was worked out
//     from (gst_calc_version, migration 153). While that version and the engine are the same, the kept answer is given
//     back and nothing is read or worked out.
//   Reply: {ok, book, version, months: [{reg, ym, result, cached, ms}]}
import { corsFor } from "../_shared/cors.ts";
import { firmGate, viaRest } from "../_shared/firmgate.ts";
// @ts-ignore plain JavaScript, shared with the Node test
import { run as runEngine, ENGINE } from "./engine.js";
import { load, pickBook, fyOf } from "./data.ts";

export type Deps = { env: (k: string) => string | undefined, fetch: typeof fetch, now?: () => Date };
const enc = encodeURIComponent;
const YM = /^20\d{2}(0[1-9]|1[0-2])$/, REG = /^\d{2}$/;
const lastDay = (ym: string) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0"); };

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch;
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || ""), ANON = String(env("SUPABASE_ANON_KEY") || "");
  const rest = async (path: string, token = SERVICE, init: RequestInit = {}) => {
    const r = await doFetch(URL_ + path, { ...init, headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const t = await r.text();
    let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status });
    return j;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => rest("/rest/v1/rpc/" + fn, SERVICE, { method: "POST", body: JSON.stringify(args) });

  return async (req: Request): Promise<Response> => {
    const cors = corsFor(req);
    const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    let body: any;
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    if (String(body?.action || "") !== "month") return reply(400, { ok: false, error: "Unknown action." });
    const client = String(body.client_id || ""), reg = String(body.reg || "");
    const months = (Array.isArray(body.months) ? body.months : [body.ym]).map((x: unknown) => String(x || "")).filter((x: string) => YM.test(x)).sort();
    if (!client || client.length > 200 || !REG.test(reg) || !months.length || months.length > 24) return reply(400, { ok: false, error: "Say the client, the registration (its state code) and the month (YYYYMM)." });
    // the caller: a signed-in, active member of a firm
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt || jwt === ANON || jwt === SERVICE) return reply(401, { ok: false, kind: "auth", error: "Sign in to the firm account first." });
    let user: any;
    try { user = await rest("/auth/v1/user", jwt); } catch { return reply(401, { ok: false, kind: "auth", error: "Sign in again." }); }
    if (!user?.id) return reply(401, { ok: false, kind: "auth", error: "Sign in again." });
    const mem = (await rest("/rest/v1/members?select=firm_id,role,active&user_id=eq." + enc(user.id)).catch(() => [])) as any[];
    const member = (mem || []).find((m) => m.active);
    if (!member) return reply(403, { ok: false, kind: "firm", error: "This account is not part of a firm." });
    const firm = String(member.firm_id);
    // the client must be the member's own firm's
    const cl = ((await rest("/rest/v1/clients?select=id,data,deleted&firm_id=eq." + enc(firm) + "&id=eq." + enc(client)).catch(() => [])) || [])[0];
    if (!cl || cl.deleted) return reply(404, { ok: false, kind: "client", error: "No such client in your firm." });
    const gate = await firmGate(viaRest(rest, SERVICE), firm, client);
    if (gate) return reply(403, { ok: false, kind: "gate", reason: gate.reason, error: gate.error });
    const last = months[months.length - 1], book = await pickBook(rest, firm, client, lastDay(last));
    if (!book) return reply(404, { ok: false, kind: "books", error: "FinCom's cloud has no books of this client for " + last + "." });
    const version = String(await rpc("gst_calc_version", { p_book: book.book_id, p_client: client }) || "");
    if (!version) return reply(500, { ok: false, error: "The books' version could not be read." });
    // what is kept and still current
    const args = months.map((m: string) => reg + "|" + m);
    const kept = (await rest("/rest/v1/tally_calc_results?select=args,version,result,ms,at&book_id=eq." + enc(book.book_id) + "&kind=eq.gst-3b&args=in.(" + args.map((a: string) => '"' + a + '"').join(",") + ")").catch(() => [])) as any[];
    const cur = new Map((kept || []).filter((k) => k.version === version && k.result && k.result.engine === ENGINE).map((k) => [k.args, k]));
    if (months.every((m: string) => cur.has(reg + "|" + m)))
      return reply(200, { ok: true, book: book.book_id, version, months: months.map((m: string) => ({ reg, ym: m, result: cur.get(reg + "|" + m)!.result, cached: true, ms: cur.get(reg + "|" + m)!.ms })) });
    // read and work out: every month up to the last one asked (the credit carried month by month)
    const rows = await load((p: string) => rest(p), firm, client, book, cl.data || {}, Array.from(new Set(months.map(fyOf))));
    const t0 = Date.now();
    const res = runEngine(rows, [{ reg, ym: last }]);
    const ms = Date.now() - t0, done = res.out[0].months as any[];
    const per = Math.max(1, Math.round(ms / Math.max(1, done.length)));
    // kept: every month worked out (the ones before the months asked carry the credit into them)
    const put = done.map((d) => ({ book_id: book.book_id, firm_id: firm, kind: "gst-3b", args: reg + "|" + d.ym, version, result: d.result, ms: per, at: new Date().toISOString() }));
    for (let i = 0; i < put.length; i += 50)
      await rest("/rest/v1/tally_calc_results?on_conflict=book_id,kind,args", SERVICE, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(put.slice(i, i + 50)) });
    const by = new Map(done.map((d) => [d.ym, d.result]));
    return reply(200, { ok: true, book: book.book_id, version, ms, months: months.map((m: string) => ({ reg, ym: m, result: by.get(m) || null, cached: false, ms: per })) });
  };
}
