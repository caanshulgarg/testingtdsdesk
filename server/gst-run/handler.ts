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
//     the client waits its 20 seconds; the timer or a member's miss starts the next run (a run never starts another). A
//     run that fails counts as an attempt; after 3 the client is too big (gst_calc_take); so is one whose runs passed
//     their budget twice. At most 3 runs at once (gst_calc_take).
//   A large book (next-gst-big, 11-Nov-2026: 40,000 entries took 1.3-1.7 s to read and make, so every run was too big):
//     a run over budget on the book's own rows keeps the entries it made of them (gst_calc_prep_put, migration 162, on
//     the book's tally_calc_version and the engine) and stops there (more to do, not too big); the next runs read those
//     (gst_calc_prep_get) instead of the rows, and take the fingerprint from a month kept on the same version, so a month
//     fits. Too big as before only when a run is over budget even so. Without migration 162 nothing is kept: as before.
//   next-gst-share (part A, SHADOW: nothing reads what these keep; the page and the 3B above are as they were):
//   POST {action: "share_sweep", book_id, limit?} from the service role or the timer's key: each entry's GST share kept
//     (gst_share, migration 164), a batch a run. When the book's context (its ledger list, groups, GSTINs and places of
//     supply typed: gst_share_ctx_version) moved, or the engine changed, the run makes the context from the whole book
//     (as "warm" reads it: the entries kept by gst_calc_prep when current, else the rows) and keeps it
//     (gst_share_ctx_put: the entries on the ledgers whose part changed are due again) and stops there. Otherwise it
//     takes the due entries (gst_share_pick: days written since (tally_calc_dirty), entries altered, deleted, cancelled,
//     new or gone; at most
//     o.limit, 3000), reads them (gst_share_rows), works out their shares (engine.js shares, entryShares of gst3b.js) and
//     writes them (gst_share_put: the months touched summed again under the book's lock). An entry on a ledger the
//     context has not got: nothing kept, the context is made again on the next run. -> {ok, ctx | entries, more}
//   POST {action: "share_parity", book_id, ym, reg?}: the month by today's engine on the whole book against the sums
//     (gst_month_get), every figure to the paisa, kept in calc_parity (gst_parity_put); a context that differs from the
//     one kept with the same version (a guess that moved with the entries) marks its entries due. -> {ok, same, diffs}
//   A paused firm or a switched-off client (the console's switches) is refused, by both.
//   Any failure: JSON {ok: false, error} with the CORS headers.
import { corsFor } from "../_shared/cors.ts";
import { firmGate, viaRest } from "../_shared/firmgate.ts";
// @ts-ignore plain JavaScript, shared with the Node test
import { step, ENGINE, REV, contextOf, ctxOf, ctxDiff, shares, engineMonth, cloudSums, compare } from "./engine.js";
import { load, pickBook, fyOf, unpack } from "./data.ts";

export type Deps = { env: (k: string) => string | undefined, fetch: typeof fetch, now?: () => Date, later?: (p: Promise<unknown>) => void, max?: number, ready?: number, total?: number };
const enc = encodeURIComponent;
const YM = /^20\d{2}(0[1-9]|1[0-2])$/, REG = /^\d{2}$/;
const istYm = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 7).replace("-", "");
const nextYm = (ym: string) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return m === 12 ? (y + 1) + "01" : y + String(m + 1).padStart(2, "0"); };
const fysOf = (from: string, to: string) => { const out: string[] = []; let y = +fyOf(from).slice(0, 4); const e = +fyOf(to).slice(0, 4); while (y <= e) { out.push(y + "-" + String((y + 1) % 100).padStart(2, "0")); y++; } return out; };

export function handler(deps: Deps) {
  const env = deps.env, doFetch = deps.fetch, now = deps.now || (() => new Date()), later = deps.later || ((p: Promise<unknown>) => { p.catch(() => {}); });
  const URL_ = String(env("SUPABASE_URL") || "").replace(/\/+$/, ""), SERVICE = String(env("SUPABASE_SERVICE_ROLE_KEY") || ""), ANON = String(env("SUPABASE_ANON_KEY") || "");
  // everything a request uses, made for each request
  const per = () => {
  // the request's own work on the answers (their text and JSON read, the rows unpacked): the run's budget counts it,
  // never the wait for the database's answer to begin. One counter per request (two requests in one isolate never share it)
  let spent = 0;
  const rest = async (path: string, token = SERVICE, init: RequestInit = {}) => {
    const r = await doFetch(URL_ + path, { ...init, headers: { apikey: token === SERVICE ? SERVICE : ANON, Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) } });
    const p0 = Date.now();
    const t = await r.text();
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

  // the client's books, newest first, each with the months gst_calc_book gives it up to this month (one call:
  // gst_calc_book_months, migration 153)
  const booksOf = async (firm: string, client: string, ym: string) => {
    const bm = ((await rpc("gst_calc_book_months", { p_firm: firm, p_client: client, p_to: ym })) || []) as any[];
    if (!bm.length) return [];
    const bs = ((await rest("/rest/v1/tally_books?select=book_id,firm_id,client_id,company,from_date,open_as_on,ledgers_at&book_id=in.(" + bm.map((x) => enc(String(x.book_id))).join(",") + ")")) || []) as any[];
    return bm.map((x) => ({ book: bs.find((b) => b.book_id === x.book_id), months: ((x.months || []) as any[]).map(String).sort() as string[] })).filter((x) => x.book && x.months.length)
      .sort((p, q) => q.months[0].localeCompare(p.months[0]));
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
        const left = (reg: string) => { const all = kept[reg].all ? kept[reg].all.months : null; return all ? covers.filter((m: string) => all.includes(m) && !kept[reg][m]) : covers.filter((m: string) => !kept[reg][m]); };
        const reg = regs.find((r) => left(r).length);
        if (!reg) continue;
        // a large book's entries as an earlier run made them (gst_calc_prep, migration 162), when kept on the book's
        // version (tally_calc_version) and this engine: the book's rows are then not read again
        const bver = String(await rpc("tally_calc_version", { p_book: book.book_id }).catch(() => "") || "");
        const prep = bver ? await rpc("gst_calc_prep_get", { p_book: book.book_id, p_version: bver, p_engine: ENGINE }).catch(() => null) : null;
        const rows = await load((p: string) => rest(p), rpc, firm, client, book, cl.data || {}, fysOf(covers[0], covers[covers.length - 1]), gstins, Array.isArray(prep) ? prep : undefined);
        spent += rows.unpackMs || 0;
        const t0 = Date.now();
        const months = Object.assign({}, kept[reg]); delete months.all;
        // the fingerprint of the inputs, as a month kept on this version and engine has it (the same inputs: the version
        // counts every one of them), so it is not made again; the first run of a version makes it
        const fpKept = regs.map((x) => Object.keys(kept[x]).filter((m) => m !== "all").map((m) => kept[x][m].fp).find(Boolean)).find(Boolean);
        const r = step(rows, reg, months, { max: deps.max || 2, spent, ready: deps.ready, total: deps.total, only: covers, keep: !!bver, fp: fpKept ? Object.assign({}, fpKept, { run: "" }) : undefined });
        const fromPrep = rows.fromPrep;
        rows.heads = rows.lines = rows.bills = []; rows.made = null;
        if (r.big) {
          // over budget on the book's own rows: the entries made of them kept for the next run (no month worked out
          // here, the client not marked too big); over budget from those too, or nothing kept: too big, as before
          if (r.made && !fromPrep) {
            const put = await rpc("gst_calc_prep_put", { p_book: book.book_id, p_version: bver, p_engine: ENGINE, p_vouchers: r.made }).catch(() => false);
            r.made = undefined;
            if (put === true) { more = true; okRun = true; return { ok: true, client, reg, book: book.book_id, prep: true, more: true, spentMs: spent, readyMs: r.atReady, booksMs: r.booksMs }; }
          }
          big = true; okRun = true; return { ok: true, client, reg, book: book.book_id, big: true, fromPrep, spentMs: spent, readyMs: r.atReady };
        }
        const per = Math.max(1, Math.round((Date.now() - t0) / Math.max(1, r.months.length)));
        const put = r.months.map((d: any) => ({ book_id: book.book_id, firm_id: firm, kind: "gst-3b", args: reg + "|" + d.ym, version, result: d.result, ms: per, at: new Date().toISOString() }));
        put.push({ book_id: book.book_id, firm_id: firm, kind: "gst-3b", args: reg + "|all", version, result: { months: r.all, engine: ENGINE }, ms: 0, at: new Date().toISOString() });
        await rest("/rest/v1/tally_calc_results?on_conflict=book_id,kind,args", SERVICE, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(put) });
        // more: this registration, another of this book, or an older book (looked at by the next run)
        more = r.more || regs.some((x) => x !== reg && left(x).length) || bi < list.length - 1;
        okRun = true;
        return { ok: true, client, reg, book: book.book_id, version, months: r.months.map((d: any) => d.ym), ms: Date.now() - t0, spentMs: spent, booksMs: r.booksMs, readyMs: r.atReady, fromPrep, more };
      }
      okRun = true;
      return { ok: true, client, more: false };
    } finally {
      // no next run started from here: the timer (every minute) and the members' misses take the client again
      await rpc("gst_calc_done", { p_firm: firm, p_client: client, p_more: more, p_ok: okRun, p_big: big, p_rev: REV }).catch(() => null);
    }
  }

  // next-gst-share: the book, its client's record and the whole book's rows as "warm" reads them (no 2B: the shares
  // read none), with the entries gst_calc_prep keeps when current
  const wholeBook = async (book: any) => {
    const firm = String(book.firm_id), client = String(book.client_id);
    const cl = ((await rest("/rest/v1/clients?select=id,data,deleted&firm_id=eq." + enc(firm) + "&id=eq." + enc(client))) || [])[0];
    const bver = String(await rpc("tally_calc_version", { p_book: book.book_id }).catch(() => "") || "");
    const prep = bver ? await rpc("gst_calc_prep_get", { p_book: book.book_id, p_version: bver, p_engine: ENGINE }).catch(() => null) : null;
    const rows = await load((p: string) => rest(p), rpc, firm, client, book, (cl && cl.data) || {}, [], [], Array.isArray(prep) ? prep : undefined);
    return { rows, cl };
  };
  const bookOf = async (id: string) => ((await rest("/rest/v1/tally_books?select=book_id,firm_id,client_id,company,from_date,open_as_on,ledgers_at&book_id=eq." + enc(id))) || [])[0] || null;
  async function shareSweep(id: string, limit: number) {
    spent = 0;
    const book = await bookOf(id);
    if (!book || !book.client_id) return { ok: false, error: "no such book" };
    const gate = await firmGate(viaRest(rest, SERVICE), String(book.firm_id), String(book.client_id));
    if (gate) return { ok: false, kind: "gate", reason: gate.reason, error: gate.error };
    const stamp = String(await rpc("gst_share_ctx_version", { p_book: book.book_id }) || "");
    const kept = (await rpc("gst_share_ctx_get", { p_book: book.book_id })) || null;
    if (!kept || kept.stamp !== stamp || kept.engine !== ENGINE || !kept.ctx) {
      // the context made from the whole book, and the entries it moves due
      const { rows } = await wholeBook(book);
      const t0 = Date.now(), ctx = contextOf(rows);
      rows.heads = rows.lines = rows.bills = []; rows.made = null;
      const d = kept && kept.ctx && kept.engine === ENGINE ? ctxDiff(kept.ctx, ctx) : { all: true, ledgers: [], guids: [] };
      const put = await rpc("gst_share_ctx_put", { p_book: book.book_id, p_stamp: stamp, p_engine: ENGINE, p_ctx: ctx, p_ledgers: d.ledgers, p_guids: d.guids, p_all: d.all });
      return { ok: !!(put && put.ok), book: book.book_id, ctx: true, all: d.all, ledgers: d.ledgers.length, guids: d.guids.length, due: put && put.due, ms: Date.now() - t0, spentMs: spent, more: true };
    }
    const pick = await rpc("gst_share_pick", { p_book: book.book_id, p_limit: limit });
    if (!pick || !pick.ok) return { ok: false, error: (pick && pick.error) || "the pick failed" };
    const guids: string[] = pick.guids || [];
    if (!guids.length) return { ok: true, book: book.book_id, entries: 0, more: false };
    const packed = await rpc("gst_share_rows", { p_book: book.book_id, p_guids: guids });
    const t0 = Date.now(), { heads, lines, bills } = unpack(packed);
    const r = shares({ client: String(book.client_id), heads, lines, bills }, kept.ctx);
    // what is kept as seen: the copy at the pick (an entry changed since is picked again); gone from the copy: forgotten
    const seen = Array.isArray(pick.seen) ? pick.seen : [];
    if (r.unknown.length) {
      // a ledger the context has not got: the context made again first (nothing kept of this batch)
      await rpc("gst_share_ctx_put", { p_book: book.book_id, p_stamp: "stale:" + stamp, p_engine: ENGINE, p_ctx: kept.ctx, p_ledgers: [], p_guids: [], p_all: false });
      return { ok: true, book: book.book_id, entries: 0, unknown: r.unknown.slice(0, 20), more: true };
    }
    const ms = Date.now() - t0;
    const put = await rpc("gst_share_put", { p_book: book.book_id, p_at: pick.at, p_shares: r.shares, p_seen: seen });
    return { ok: !!(put && put.ok), book: book.book_id, entries: seen.length, shares: r.shares.length, months: put && put.months, ms, spentMs: spent, more: !!pick.more };
  }
  async function shareParity(id: string, ym: string, reg: string) {
    spent = 0;
    const book = await bookOf(id);
    if (!book || !book.client_id) return { ok: false, error: "no such book" };
    const { rows } = await wholeBook(book);
    const t0 = Date.now(), e = engineMonth(rows, ym, reg);
    const month = ((await rpc("gst_month_get", { p_book: book.book_id, p_ym: ym })) || []) as any[];
    const c = compare(e.sums, cloudSums(month, reg));
    const head = month.find((m) => m.sec === "*");
    // the context the shares were made on against the whole book's now (the same version: a guess moved with the entries)
    const kept = (await rpc("gst_share_ctx_get", { p_book: book.book_id })) || null;
    let drift: any = null;
    if (kept && kept.ctx && kept.engine === ENGINE) {
      const now = ctxOf(e.books), d = ctxDiff(kept.ctx, now);
      if (d.all || d.ledgers.length || d.guids.length) {
        drift = { all: d.all, ledgers: d.ledgers.slice(0, 50), guids: d.guids.slice(0, 50) };
        await rpc("gst_share_ctx_put", { p_book: book.book_id, p_stamp: kept.stamp, p_engine: ENGINE, p_ctx: now, p_ledgers: d.ledgers, p_guids: d.guids, p_all: d.all });
      }
    }
    const notes = { status: head ? head.status : "none", market: e.market, drift, ms: Date.now() - t0 };
    const pid = await rpc("gst_parity_put", { p_book: book.book_id, p_ym: ym, p_reg: reg, p_engine: ENGINE, p_ok: c.ok, p_max: c.max, p_diffs: c.diffs.slice(0, 500), p_notes: notes });
    return { ok: true, book: book.book_id, ym, reg, same: c.ok, max: c.max, diffs: c.diffs.length, first: c.diffs.slice(0, 5), notes, id: pid };
  }

    return { rest, rpc, kick, warm, shareSweep, shareParity };
  };

  return async (req: Request): Promise<Response> => {
    const cors = corsFor(req);
    const { rest, rpc, kick, warm, shareSweep, shareParity } = per();
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
      if (action === "share_sweep" || action === "share_parity") {
        const ck = req.headers.get("x-cron-key") || "";
        const inside = (SERVICE && jwt === SERVICE) || (ck && (await rpc("gst_cron_ok", { k: ck }).catch(() => false)) === true);
        if (!inside) return reply(401, { ok: false, error: "Not allowed." });
        const id = String(body.book_id || "");
        if (!/^[0-9a-f-]{36}$/i.test(id)) return reply(400, { ok: false, error: "Say the book (book_id)." });
        if (action === "share_sweep") return reply(200, await shareSweep(id, Math.max(1, Math.min(5000, Number(body.limit) || 3000))));
        const ym = String(body.ym || ""), reg = String(body.reg || "");
        if (!YM.test(ym) || (reg && !REG.test(reg))) return reply(400, { ok: false, error: "Say the month (YYYYMM) and, if one, the registration (its state code)." });
        return reply(200, await shareParity(id, ym, reg));
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
      const started = (await rpc("gst_calc_want", { p_firm: firm, p_client: client, p_why: "asked", p_rev: REV })) === true;
      if (started) kick();
      return reply(200, { ok: true, book: book.book_id, version, reg, ym, result: null, pending: true, started });
    } catch (e) {
      return reply(500, { ok: false, error: String((e as Error)?.message || e).slice(0, 300) });
    }
  };
}
