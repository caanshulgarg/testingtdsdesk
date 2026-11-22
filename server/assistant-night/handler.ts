// assistant-night (next-assistant, phase 1; docs/ASSISTANT-PHASE1.md): one client's night check. Called by the database's
// timer (migration-206-cron.sql: x-cron-key, checked with gst_cron_ok as gst-run does) or the service role, never by a
// browser. verify_jwt off: this handler checks the caller itself.
//   POST {action: "client", firm_id, client_id}
// It reads the client's books from FinCom's cloud with the service role (gst-run's own loader and engine: the same books
// the app opens), adds the bank statements, the Inbox, FinCom's bills and what earlier nights found, runs the checks and
// FinCom's own answers (server/_shared/nightchecks.js), and hands everything to night_apply in one call (idempotent:
// rule 4). Nothing is posted, sent or changed in the books (rule 3). No AI.
import { firmGate, viaRest } from "../_shared/firmgate.ts";
import { load } from "../gst-run/data.ts";
// @ts-ignore plain JavaScript, shared with the Node tests
import { booksOf, twobOnly, nightInput } from "./nightinput.js";
// @ts-ignore plain JavaScript, shared with the Node tests
import { run } from "../_shared/nightchecks.js";

export type Deps = { env: (k: string) => string | undefined; fetch: typeof fetch; now?: () => Date };
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const fyOf = (d: string) => { const y = +d.slice(0, 4), m = +d.slice(5, 7), s = m >= 4 ? y : y - 1; return s + "-" + String((s + 1) % 100).padStart(2, "0"); };

async function all(rest: (p: string) => Promise<any>, path: string, order: string): Promise<any[]> {
  const out: any[] = [];
  for (let off = 0; off < 2_000_000; off += 1000) {
    const rows = await rest(path + "&order=" + order + "&limit=1000&offset=" + off);
    if (!Array.isArray(rows)) throw new Error("the cloud copy could not be read");
    out.push(...rows); if (rows.length < 1000) break;
  }
  return out;
}

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch, now = deps.now || (() => new Date());
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || "");
  const reply = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { "Content-Type": "application/json" } });
  const rest = async (path: string, _t = SERVICE, init: RequestInit = {}) => {
    const r = await doFetch(URL_ + path, { ...init, headers: { apikey: SERVICE, Authorization: "Bearer " + SERVICE, "Content-Type": "application/json", ...(init.headers || {}) } });
    const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = t; }
    if (!r.ok) throw Object.assign(new Error((j && (j.message || j.error)) || ("HTTP " + r.status)), { status: r.status });
    return j;
  };
  const rpc = (fn: string, args: Record<string, unknown>) => rest("/rest/v1/rpc/" + fn, SERVICE, { method: "POST", body: JSON.stringify(args) });

  async function client(firm: string, cid: string) {
    const night = istDay(now()), ym = night.slice(0, 7).replace("-", "");
    const fail = (status: string, why: string) => rpc("night_fail", { p_firm: firm, p_client: cid, p_night: night, p_status: status, p_why: why }).catch(() => null);
    const gate = await firmGate(viaRest(rest, SERVICE), firm, cid).catch(() => null);
    if (gate) { await fail("skipped", gate.reason); return { ok: true, skipped: gate.reason }; }
    const co = ((await rest("/rest/v1/clients?select=*&firm_id=eq." + enc(firm) + "&id=eq." + enc(cid))) || [])[0];
    if (!co || co.deleted) { await fail("skipped", "no such client"); return { ok: true, skipped: "client" }; }
    const bookId = await rpc("gst_calc_book", { p_firm: firm, p_client: cid, p_ym: ym }).catch(() => null);
    const book = bookId ? ((await rest("/rest/v1/tally_books?select=book_id,firm_id,client_id,company,from_date,open_as_on,ledgers_at&book_id=eq." + enc(String(bookId)))) || [])[0] : null;
    if (!book) { await fail("skipped", "no books in the cloud"); return { ok: true, skipped: "books" }; }
    const gstins: string[] = await rpc("gst_calc_gstins", { p_book: book.book_id, p_client: cid }).catch(() => []) || [];
    const fys = Array.from(new Set([fyOf(night), fyOf(new Date(now().getTime() - 400 * 86400_000).toISOString().slice(0, 10))]));
    const rows = await load((p: string) => rest(p), rpc, firm, cid, book, co, fys, gstins);
    const w = "firm_id=eq." + enc(firm) + "&client_id=eq." + enc(cid);
    const [bankRecs, inboxRecs, entryRecs, prior] = await Promise.all([
      all((p) => rest(p), "/rest/v1/records?select=kind,id,data,deleted&" + w + "&kind=in.(bank_stmt,bank_rows,bank_meta)&deleted=not.is.true", "id"),
      all((p) => rest(p), "/rest/v1/records?select=id,data,deleted&" + w + "&kind=eq.inbox&deleted=not.is.true", "id"),
      all((p) => rest(p), "/rest/v1/records?select=id,data,deleted&" + w + "&kind=eq.entry&deleted=not.is.true", "id"),
      all((p) => rest(p), "/rest/v1/night_findings?select=kind,key,state,evidence,undone_at&" + w, "key"),
    ]);
    const b = booksOf(rows);
    const twob = twobOnly(b, rows);
    const today = night.replace(/-/g, "");
    const inp = nightInput(rows, b, { today, bankRecs, inboxRecs, entryRecs, twob, prior: prior.map((p: any) => ({ kind: p.kind, key: p.key, state: p.state, evidence: p.evidence, undone: !!p.undone_at })) });
    const res = run(inp);
    const version = String(book.book_id) + ":" + (b.vouchers || []).length + ":" + (book.ledgers_at || "");
    const counts = await rpc("night_apply", { p_firm: firm, p_client: cid, p_night: night, p_version: version, p_findings: res.findings, p_entries: res.entries, p_complete: true, p_why: "" });
    return { ok: true, night, counts };
  }

  return async (req: Request) => {
    if (req.method !== "POST") return reply(405, { ok: false, error: "POST only" });
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), ck = req.headers.get("x-cron-key") || "";
    const inside = (SERVICE && jwt === SERVICE) || (ck && (await rpc("gst_cron_ok", { k: ck }).catch(() => false)) === true);
    if (!inside) return reply(401, { ok: false, error: "Only FinCom's own timer runs the night check." });
    let body: any = {};
    try { body = await req.json(); } catch { return reply(400, { ok: false, error: "Bad request" }); }
    if (body.action !== "client" || !UUID.test(String(body.firm_id || "")) || !/^[\w.:-]{1,80}$/.test(String(body.client_id || ""))) return reply(400, { ok: false, error: "Say which client." });
    try { return reply(200, await client(String(body.firm_id), String(body.client_id))); }
    catch (e) {
      const why = String((e as Error)?.message || e).slice(0, 300);
      await rpc("night_fail", { p_firm: body.firm_id, p_client: body.client_id, p_night: istDay(now()), p_status: "failed", p_why: why }).catch(() => null);
      return reply(500, { ok: false, error: why });
    }
  };
}
