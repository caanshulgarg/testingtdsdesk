// gst-run (next-cloud-gst, 09-Nov-2026): a client's GSTR-3B month by month, worked out in the cloud by the browser's own
// engine (server/_shared/gst3b.js through engine.js) and kept, so a page can read it instead of working it out on a large
// book. index.ts serves it; tests/run_gst_cloud_deno.ts gives it a fake Supabase.
// Review of 18ad47515: no request works out more than a month or two (about 1 s of CPU; an edge function has about 2 s).
//   POST {action: "month", client_id, reg: "07", ym: "202510"} from a signed-in member of the client's firm (any role):
//     the month kept, when it is current (the same as gst_calc_cached gives the page); else nothing is worked out here:
//     the client is queued (gst_calc_want) and a background run started, and the reply says pending. The page never
//     waits on it: on a miss it works the month out itself, as today.
//   POST {action: "warm"} from the service role or the database's timer (x-cron-key, gst_cron_ok; migration 153's pg_cron
//     job every minute): one queued client (gst_calc_take), its books newest first (each for the months gst_calc_book
//     gives it), the first registration with months not kept: at most 2 months, each from the credit the month before
//     carried (kept), within the run's own work budget (reading the answers and making the books over 1.1 s, or a month
//     that would end past 1.5 s: nothing stored, the client marked too big and left to the app). Kept in
//     tally_calc_results (migration 151) kind "gst-3b", args "<reg>|<ym>" (and "<reg>|all": the engine's months of the
//     book), with the version (gst_calc_version), the engine and the fingerprint of the inputs (result.fp). More to do:
//     the client waits its 20 seconds and the next run is started. A run that fails counts as an attempt; after 3 the
//     client is too big (gst_calc_take).
//   A paused firm or a switched-off client (the console's switches) is refused, by both.
//   Any failure: JSON {ok: false, error} with the CORS headers.
import { corsFor } from "../_shared/cors.ts";
import { firmGate, viaRest } from "../_shared/firmgate.ts";
// @ts-ignore plain JavaScript, shared with the Node test
import { step, ENGINE } from "./engine.js";
import { load, pickBook, fyOf } from "./data.ts";

export type Deps = { env: (k: string) => string | undefined, fetch: typeof fetch, now?: () => Date, later?: (p: Promise<unknown>) => void, max?: number, ready?: number, total?: number };
const enc = encodeURIComponent;
const YM = /^20\d{2}(0[1-9]|1[0-2])$/, REG = /^\d{2}$/;
const istYm = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 7).replace("-", "");
const nextYm = (ym: string) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 12 ? (y + 1) + "01" : y + String(m + 1).padStart(2, "0"); };
const fysOf = (from: string, to: string) => { const out: string[] = []; let y = +fyOf(from).slice(0, 4); const e = +fyOf(to).slice(0, 4); while (y <= e) { out.push(y + "-" + String((y + 1) % 100).padStart(2, "0")); y++; } return out; };

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch, now = deps.now || (() => new Date()), later = deps.later || ((p: Promise<unknown>) => { p.catch(() => {}); });
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || ""), ANON = String(env("SUPABASE_ANON_KEY") || "");
  // the request's own work on the answers (JSON read): the run's budget counts it, never the wait for the database
  let spent = 0;
  const rest = async (path: string, token = SERVICE, init: RequestInit = {}) => {
    const r = await doFetch(URL_ + path, { ...init, headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const t = await r.text();
    const p0 = Date.now();
    let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    spent += Date.now() - p0;
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status });
    return j;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => rest("/rest/v1/rpc/" + fn, SERVICE, { method: "POST", body: JSON.stringify(args) });
  // the next background run, not waited on (EdgeRuntime.waitUntil in index.ts keeps it going)
  const kick = () => later(doFetch(URL_ + "/functions/v1/gst-run", { method: "POST", headers: { Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, body: JSON.stringify({ action: "warm" }) }));
  const keptOf = async (book: string, reg: string, version: string) => {
    const rows = (await rest("/rest/v1/tally_calc_results?select=args,version,result&book_id=eq." + enc(book) + "&kind=eq.gst-3b&args=like." + enc(reg + "|*"))) as any[];
    const k: Record<string, any> = {};
    (rows || []).forEach((r) => { if (r.version === version && r.result && r.result.engine === ENGINE) k[String(r.args).slice(3)] = r.result; });
    return k;
  };

  // the months a book is the month's book for (gst_calc_book): from its first month to the month before the next book
  // starts, up to this month; the client's books newest first
  const booksOf = async (firm: string, client: string, ym: string) => {
    const bs = ((await rest("/rest/v1/tally_books?select=book_id,firm_id,client_id,company,from_date,open_as_on,ledgers_at&firm_id=eq." + enc(firm) + "&client_id=eq." + enc(client) + "&from_date=not.is.null&open_as_on=not.is.null&order=from_date.desc")) || []) as any[];
    const out: { book: any, months: string[] }[] = [];
    for (const bk of bs) {
      const months: string[] = [];
      let m = String(bk.from_date).replace(/-/g, "").slice(0, 6);
      while (m <= ym && months.length < 240) { if ((await rpc("gst_calc_book", { p_firm: firm, p_client: client, p_ym: m })) === bk.book_id) months.push(m); else if (months.length) break; m = nextYm(m); }
      if (months.length) out.push({ book: bk, months });
    }
    return out;
  };
  // one background run: one client; its first book (newest first) and registration with months not kept, a month or two
  async function warm() {
    spent = 0;
    const job = ((await rpc("gst_calc_take", { p_n: 1 })) || [])[0];
    if (!job) return { ok: true, idle: true };
    const firm = String(job.firm_id), client = String(job.client_id);
    let more = false, okRun = false, big = false;
    try {
      const gate = await firmGate(viaRest(rest, SERVICE), firm, client);
      if (gate) { okRun = true; return { ok: false, kind: "gate", reason: gate.reason, error: gate.error, client }; }
      const cl = ((await rest("/rest/v1/clients?select=id,data,deleted&firm_id=eq." + enc(firm) + "&id=eq." + enc(client))) || [])[0];
      if (!cl || cl.deleted) { okRun = true; return { ok: true, client, gone: true }; }
      const ym = istYm(now()), list = await booksOf(firm, client, ym);
      for (let bi = 0; bi < list.length; bi++) {
        const { book, months: covers } = list[bi];
        const version = String(await rpc("gst_calc_version", { p_book: book.book_id, p_client: client }) || "");
        const gstins: string[] = (await rpc("gst_calc_gstins", { p_book: book.book_id, p_client: client })) || [];
        const regs = Array.from(new Set(gstins.map((g) => g.slice(0, 2)))).sort();
        // what is kept for the book, and its months as the engine has them (args "<reg>|all"), on this version
        const kept: Record<string, Record<string, any>> = {};
        for (const reg of regs) kept[reg] = await keptOf(book.book_id, reg, version);
        const left = (reg: string) => { const all = kept[reg].all ? kept[reg].all.months : null; return all ? covers.filter((m) => all.includes(m) && !kept[reg][m]) : covers.filter((m) => !kept[reg][m]); };
        const reg = regs.find((r) => left(r).length);
        if (!reg) continue;
        const rows = await load((p: string) => rest(p), rpc, firm, client, book, cl.data || {}, fysOf(covers[0], covers[covers.length - 1]), gstins);
        const t0 = Date.now();
        const months = Object.assign({}, kept[reg]); delete months.all;
        const r = step(rows, reg, months, { max: deps.max || 2, spent, ready: deps.ready, total: deps.total, only: covers });
        rows.heads = rows.lines = rows.bills = [];
        if (r.big) { big = true; okRun = true; return { ok: true, client, reg, book: book.book_id, big: true, spentMs: spent, readyMs: r.atReady }; }
        const per = Math.max(1, Math.round((Date.now() - t0) / Math.max(1, r.months.length)));
        const put = r.months.map((d: any) => ({ book_id: book.book_id, firm_id: firm, kind: "gst-3b", args: reg + "|" + d.ym, version, result: d.result, ms: per, at: new Date().toISOString() }));
        put.push({ book_id: book.book_id, firm_id: firm, kind: "gst-3b", args: reg + "|all", version, result: { months: r.all, engine: ENGINE }, ms: 0, at: new Date().toISOString() });
        await rest("/rest/v1/tally_calc_results?on_conflict=book_id,kind,args", SERVICE, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(put) });
        // more: this registration, another of this book, or an older book (looked at by the next run)
        more = r.more || regs.some((x) => x !== reg && left(x).length) || bi < list.length - 1;
        okRun = true;
        return { ok: true, client, reg, book: book.book_id, version, months: r.months.map((d: any) => d.ym), ms: Date.now() - t0, spentMs: spent, booksMs: r.booksMs, readyMs: r.atReady, more };
      }
      okRun = true;
      return { ok: true, client, more: false };
    } finally {
      await rpc("gst_calc_done", { p_firm: firm, p_client: client, p_more: more, p_ok: okRun, p_big: big }).catch(() => null);
      if (more && okRun && !big) kick();
    }
  }

  return async (req: Request): Promise<Response> => {
    const cors = corsFor(req);
    const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json" } });
    try {
      if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
      if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
      let body: any;
      try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
      const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const action = String(body?.action || "");
      if (action === "warm") {
        const ck = req.headers.get("x-cron-key") || "";
        const inside = (SERVICE && jwt === SERVICE) || (ck && (await rpc("gst_cron_ok", { k: ck }).catch(() => false)) === true);
        if (!inside) return reply(401, { ok: false, error: "Not allowed." });
        return reply(200, await warm());
      }
      if (action !== "month") return reply(400, { ok: false, error: "Unknown action." });
      const client = String(body.client_id || ""), reg = String(body.reg || ""), ym = String(body.ym || "");
      if (!client || client.length > 200 || !REG.test(reg) || !YM.test(ym)) return reply(400, { ok: false, error: "Say the client, the registration (its state code) and the month (YYYYMM)." });
      // the caller: a signed-in, active member of the client's firm
      if (!jwt || jwt === ANON || jwt === SERVICE) return reply(401, { ok: false, kind: "auth", error: "Sign in to the firm account first." });
      let user: any;
      try { user = await rest("/auth/v1/user", jwt); } catch { return reply(401, { ok: false, kind: "auth", error: "Sign in again." }); }
      if (!user?.id) return reply(401, { ok: false, kind: "auth", error: "Sign in again." });
      const mem = (await rest("/rest/v1/members?select=firm_id,role,active&user_id=eq." + enc(user.id)).catch(() => [])) as any[];
      const member = (mem || []).find((m) => m.active);
      if (!member) return reply(403, { ok: false, kind: "firm", error: "This account is not part of a firm." });
      const firm = String(member.firm_id);
      const cl = ((await rest("/rest/v1/clients?select=id,deleted&firm_id=eq." + enc(firm) + "&id=eq." + enc(client)).catch(() => [])) || [])[0];
      if (!cl || cl.deleted) return reply(404, { ok: false, kind: "client", error: "No such client in your firm." });
      const gate = await firmGate(viaRest(rest, SERVICE), firm, client);
      if (gate) return reply(gate.status, { ok: false, kind: "gate", reason: gate.reason, error: gate.error });
      const book = await pickBook(rest, rpc, firm, client, ym);
      if (!book) return reply(404, { ok: false, kind: "books", error: "FinCom's cloud has no books of this client for " + ym + "." });
      const version = String(await rpc("gst_calc_version", { p_book: book.book_id, p_client: client }) || "");
      const k = ((await rest("/rest/v1/tally_calc_results?select=args,version,result,at&book_id=eq." + enc(book.book_id) + "&kind=eq.gst-3b&args=eq." + enc(reg + "|" + ym))) || [])[0];
      if (k && k.version === version && k.result && k.result.engine === ENGINE) return reply(200, { ok: true, book: book.book_id, version, reg, ym, result: k.result, at: k.at, cached: true });
      // a miss: queued and a background run started (gst_calc_take keeps one client to a run each 20 seconds)
      const started = (await rpc("gst_calc_want", { p_firm: firm, p_client: client, p_why: "asked" })) === true;
      if (started) kick();
      return reply(200, { ok: true, book: book.book_id, version, reg, ym, result: null, pending: true, started });
    } catch (e) {
      return reply(500, { ok: false, error: String((e as Error)?.message || e).slice(0, 300) });
    }
  };
}
