// deno run --allow-all (for /proc/self/stat, the CPU) tests/run_gst_cloud_deno.ts IN.json OUT.json - the gst-run function
// (server/gst-run/handler.ts) with a fake Supabase (REST as PostgREST reads it, the user check, and migration 153's
// functions as the database would answer them), on the made-up client tests/run_gst_cloud.js writes. Called by
// tests/run_gst_cloud.js; nothing of a real database. Each background run's CPU is measured without the fake's own.
import { handler } from "../server/gst-run/handler.ts";
import { load } from "../server/gst-run/data.ts";
// @ts-ignore plain JavaScript
import { step } from "../server/gst-run/engine.js";

const [inFile, outFile] = Deno.args;
const IN = JSON.parse(await Deno.readTextFile(inFile));
const rows = IN.rows, old = IN.old || null, FIRM = IN.firm, OTHER = "f1530000-0000-4000-8000-000000000002";
const USER = "u1530000-0000-4000-8000-00000000000a", OUTSIDER = "u1530000-0000-4000-8000-00000000000b";
const BK = rows.book.book_id;
const T: Record<string, any[]> = {
  members: [{ user_id: USER, firm_id: FIRM, role: "viewer", active: true }],
  clients: [{ id: rows.client, firm_id: FIRM, data: rows.co, deleted: false, status: "active" }, { id: "cli-other", firm_id: OTHER, data: { name: "Another Firm's Client" }, deleted: false }],
  firms: [{ id: FIRM, status: "active" }], subscriptions: [],
  tally_books: [Object.assign({ open_as_on: "2025-04-01" }, rows.book, { open_as_on: rows.book.open_as_on || "2025-04-01" })].concat(old ? [Object.assign({}, old.book, { firm_id: FIRM, client_id: rows.client })] : []),
  tally_vouchers: rows.heads.map((h: any) => ({ ...h, book_id: BK })).concat(old ? old.heads.map((h: any) => ({ ...h, book_id: old.book.book_id })) : []),
  tally_lines: rows.lines.map((l: any, i: number) => ({ ...l, id: i + 1, book_id: BK })).concat(old ? old.lines.map((l: any, i: number) => ({ ...l, id: 900000 + i, book_id: old.book.book_id })) : []),
  tally_bills: rows.bills.map((l: any, i: number) => ({ ...l, id: i + 1, book_id: BK })).concat(old ? old.bills.map((l: any, i: number) => ({ ...l, id: 900000 + i, book_id: old.book.book_id })) : []),
  tally_ledgers: rows.ledgers.map((l: any) => ({ ...l, book_id: BK, merged_into: null, deleted_at: null })).concat(old ? rows.ledgers.map((l: any) => ({ ...l, book_id: old.book.book_id, merged_into: null, deleted_at: null })) : []),
  tally_groups: rows.groups.map((l: any) => ({ ...l, book_id: BK })).concat(old ? rows.groups.map((l: any) => ({ ...l, book_id: old.book.book_id })) : []),
  client_book_items: rows.items.map((r: any) => ({ ...r, firm_id: FIRM, client_id: rows.client })),
  records: rows.sales.map((d: any) => ({ firm_id: FIRM, client_id: rows.client, kind: "sales", id: rows.client + ":" + d.id, data: d, deleted: null })),
  gst_2b_runs: Object.entries(rows.runs).map(([k, r]: [string, any]) => ({ id: r.id, firm_id: FIRM, client_id: rows.client, gstin: k.split("|")[0], fy: k.split("|")[1], status: "done", done_at: r.at, queued_at: r.at, result: r.result })),
  gst_2b_decisions: [], tally_calc_results: [], gst_calc_queue: [],
  gst_calc_prep: [],     // migration 162: a book's entries made once for gst-run ({book_id, firm_id, version, engine, vouchers: text})
};
// the fake's answers for the books' tables, kept between writes (only the tests write to them, and clear these)
const pages = new Map<string, string>(), sorted = new Map<string, any[]>();
let clock = Date.parse("2026-11-09T10:00:00Z"), reads = 0, fakeCpu = 0, failOn = "", prepPuts = 0, prepGets = 0;
const HELD = new Set<number>();     // tally_recorder's messages not applied yet (gst_calc_held)
// the CPU of the thread JavaScript runs on (user and system; not V8's helper threads) from /proc, in ms (10 ms steps)
const cpu = () => { const f = Deno.readTextFileSync("/proc/thread-self/stat"), x = f.slice(f.lastIndexOf(")") + 2).split(" "); return (+x[11] + +x[12]) * 10; };
const pass = (row: any, k: string, v: string) => {
  const x = row[k];
  if (v.startsWith("eq.")) return String(x) === v.slice(3);
  if (v.startsWith("like.")) { const p = v.slice(5); return p.endsWith("*") ? String(x).startsWith(p.slice(0, -1)) : String(x) === p; }
  if (v === "is.null") return x == null; if (v === "not.is.null") return x != null;
  if (v === "is.false") return x === false; if (v === "is.true") return x === true; if (v === "not.is.true") return x !== true;
  if (v.startsWith("in.(")) return v.slice(4, -1).split(",").map((s) => s.replace(/^"|"$/g, "")).includes(String(x));
  throw new Error("filter " + k + "=" + v);
};
const s32 = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); };
const lastDay = (ym: string) => { const y = +ym.slice(0, 4), m = +ym.slice(4, 6); return ym.slice(0, 4) + "-" + ym.slice(4, 6) + "-" + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0"); };
// migration 153's functions, as the database answers them
const RPC: Record<string, (a: any) => any> = {
  gst_calc_book: (a) => { const d = lastDay(a.p_ym); return (T.tally_books.filter((b) => b.client_id === a.p_client && b.firm_id === a.p_firm && b.from_date && b.open_as_on && b.open_as_on <= d)
    .sort((x, y) => (Number(y.from_date <= d) - Number(x.from_date <= d)) || String(y.from_date).localeCompare(String(x.from_date)))[0] || {}).book_id || null; },
  gst_calc_gstins: (a) => Array.from(new Set(T.tally_vouchers.filter((v) => v.book_id === a.p_book && v.cmp_gstin).map((v) => String(v.cmp_gstin).toUpperCase())
    .concat(T.clients.filter((c) => c.id === a.p_client && c.data && c.data.gstin).map((c) => String(c.data.gstin).toUpperCase())))).filter((g) => /^\d{2}[A-Z0-9]{13}$/.test(g)).sort(),
  // migration 152's version of a book (here: everything of the book's own rows)
  tally_calc_version: (a) => "b" + s32(JSON.stringify([T.tally_vouchers.filter((v) => v.book_id === a.p_book), T.tally_lines.filter((v) => v.book_id === a.p_book), T.tally_bills.filter((v) => v.book_id === a.p_book), T.tally_ledgers.filter((v) => v.book_id === a.p_book)])),
  // migration 162: the book's entries as gst-run made them, kept on the book's version and the engine
  gst_calc_prep_put: (a) => { const bk = T.tally_books.find((b) => b.book_id === a.p_book); if (!bk || !String(a.p_vouchers || "").startsWith("[")) return false;
    const row = { book_id: a.p_book, firm_id: bk.firm_id, version: a.p_version, engine: a.p_engine, vouchers: String(a.p_vouchers), n: 0, at: clock }, i = T.gst_calc_prep.findIndex((x) => x.book_id === a.p_book);
    if (i >= 0) T.gst_calc_prep[i] = row; else T.gst_calc_prep.push(row); prepPuts++; return true; },
  gst_calc_version: (a) => "v" + s32(JSON.stringify([T.tally_vouchers, T.tally_lines, T.tally_bills, T.tally_ledgers, T.client_book_items, T.clients.filter((c) => c.id === a.p_client), T.records, T.gst_2b_runs, T.gst_2b_decisions])),
  // migration 153's queue, as the database answers it
  gst_calc_want: (a) => { const af = a.p_after ?? null; const q = T.gst_calc_queue.find((x) => x.client_id === a.p_client && x.firm_id === a.p_firm);
    if (!q) { T.gst_calc_queue.push({ firm_id: a.p_firm, client_id: a.p_client, why: a.p_why, wanted_at: clock, first_wanted: clock, asked_at: clock, after_msg: af, taken_at: null, ran_at: null, attempts: 0, too_big: false, big_n: 0, rev: null }); return af == null; }
    if (q.too_big && (q.ran_at == null || q.ran_at < clock - 86400000 || (a.p_rev != null && a.p_rev !== q.rev))) Object.assign(q, { too_big: false, attempts: 0, big_n: 0 });
    const was = { ...q }; q.wanted_at = Math.min(q.wanted_at ?? clock, clock); q.asked_at = clock; q.why = a.p_why || q.why; if (af != null) q.after_msg = Math.max(q.after_msg || 0, af);
    return !was.too_big && af == null && !HELD.has(was.after_msg) && (was.taken_at == null || was.taken_at < clock - 120000); },
  gst_calc_take: (a) => {
    T.gst_calc_queue.forEach((x) => { if (!x.too_big && x.attempts >= 3 && (x.taken_at == null || x.taken_at < clock - 120000)) { x.too_big = true; x.taken_at = null; x.ran_at = clock; } });
    const going = T.gst_calc_queue.filter((x) => x.taken_at != null && x.taken_at >= clock - 120000).length;
    if (going >= 3) return [];
    return T.gst_calc_queue.filter((x) => !x.too_big && x.attempts < 3 && x.wanted_at <= clock && !HELD.has(x.after_msg) && (x.taken_at == null || x.taken_at < clock - 120000) && (x.ran_at == null || x.ran_at < clock - 20000))
      .sort((p, q) => (p.first_wanted - q.first_wanted) || (p.wanted_at - q.wanted_at)).slice(0, Math.max(1, Math.min(a.p_n || 1, 5, 3 - going))).map((q) => { q.taken_at = clock; q.attempts++; return { firm_id: q.firm_id, client_id: q.client_id, why: q.why }; }); },
  gst_calc_done: (a) => { const q = T.gst_calc_queue.find((x) => x.client_id === a.p_client && x.firm_id === a.p_firm); if (!q) return null;
    if (a.p_big) Object.assign(q, { big_n: q.big_n + 1, too_big: q.big_n + 1 >= 2, rev: a.p_rev, taken_at: null, ran_at: clock });
    else if (!a.p_ok) Object.assign(q, { taken_at: null, ran_at: clock, rev: a.p_rev });
    else if (!a.p_more && q.taken_at != null && (q.asked_at ?? q.wanted_at) <= q.taken_at) T.gst_calc_queue.splice(T.gst_calc_queue.indexOf(q), 1);
    else Object.assign(q, { taken_at: null, ran_at: clock, attempts: 0, rev: a.p_rev });
    return null; },
  gst_calc_book_months: (a) => { const bs = T.tally_books.filter((b) => b.firm_id === a.p_firm && b.client_id === a.p_client && b.from_date && b.open_as_on); if (!bs.length) return [];
    let m = bs.map((b) => String(b.from_date).replace(/-/g, "").slice(0, 6)).sort()[0]; const by = new Map<string, string[]>();
    while (m <= a.p_to) { const bk = RPC.gst_calc_book({ p_firm: a.p_firm, p_client: a.p_client, p_ym: m }); if (bk) (by.get(bk) || by.set(bk, []).get(bk))!.push(m); const y = +m.slice(0, 4), mo = +m.slice(4, 6); m = mo === 12 ? (y + 1) + "01" : y + String(mo + 1).padStart(2, "0"); }
    return [...by].map(([book_id, months]) => ({ book_id, months })); },
  gst_cron_ok: (a) => a.k === "cron-key",
  gst_calc_rows: (a) => rowsCache.get(a.p_book) || (rowsCache.set(a.p_book, rowsOf(a)), rowsCache.get(a.p_book)),
};
const rowsCache = new Map<string, any>();
function rowsOf(a: any) { return (() => {
    const cols = "guid,day,alter_id,vtype,vno,party,narration,cancelled,optional,deleted_at,gstin,pos,ref,ref_date,cmp_gstin,irn,irn_ack_date,gst_reg_type,gst_country,gst_rcm,gst_nature,gst_taxability,gst_supply,gst_ineligible,gst_mixed,gst_alter_id".split(",");
    const ls = T.tally_lines.filter((l) => l.book_id === a.p_book), bs = T.tally_bills.filter((b) => b.book_id === a.p_book);
    const names = Array.from(new Set(ls.map((l) => l.ledger).concat(bs.map((b) => b.ledger)).filter((x) => x != null))).sort(), at = new Map(names.map((n, i) => [n, i]));
    const L = new Map<string, any[]>(), B = new Map<string, any[]>();
    ls.slice().sort((x, y) => x.id - y.id).forEach((l) => { (L.get(l.guid) || L.set(l.guid, []).get(l.guid))!.push([at.get(l.ledger), l.amount, l.hsn ?? null, l.rate ?? null]); });
    bs.slice().sort((x, y) => x.id - y.id).forEach((b) => { (B.get(b.guid) || B.set(b.guid, []).get(b.guid))!.push([at.get(b.ledger), b.name ?? null, b.type ?? null, b.amount, b.credit_days ?? null]); });
    const hs = T.tally_vouchers.filter((v) => v.book_id === a.p_book).slice().sort((x, y) => x.day < y.day ? -1 : x.day > y.day ? 1 : x.guid < y.guid ? -1 : x.guid > y.guid ? 1 : 0);
    return { ledgers: names, heads: hs.map((v) => cols.map((c) => v[c] ?? null).concat([L.get(v.guid) || [], B.get(v.guid) || []])) };
  })(); }
const RPC_DUMMY: Record<string, unknown> = {
};
const kicks: any[] = [];
const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const c0 = cpu();
  try {
    const u = new URL(String(input)), auth = String((init?.headers as any)?.Authorization || "");
    const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (u.pathname === "/functions/v1/gst-run") { kicks.push(JSON.parse(String(init!.body))); return json({ ok: true }); }
    if (u.pathname === "/auth/v1/user") { const t = auth.replace("Bearer ", ""); return t === "tok-member" ? json({ id: USER }) : t === "tok-outsider" ? json({ id: OUTSIDER }) : json({ msg: "bad jwt" }, 401); }
    if (auth !== "Bearer service-key") return json({ message: "service role only here" }, 401);
    // gst_calc_prep_get returns the kept text as it is (the column's text cast to json: PostgREST sends it unchanged)
    if (u.pathname === "/rest/v1/rpc/gst_calc_prep_get") { const a = JSON.parse(String(init!.body || "{}")), p = T.gst_calc_prep.find((x) => x.book_id === a.p_book && x.version === a.p_version && x.engine === a.p_engine);
      if (p) prepGets++; return new Response(p ? p.vouchers : "null", { status: 200, headers: { "Content-Type": "application/json" } }); }
    if (u.pathname.startsWith("/rest/v1/rpc/")) { const fn = u.pathname.slice(13); if (!RPC[fn]) return json({ message: "no function " + fn }, 404); return json(RPC[fn](JSON.parse(String(init!.body || "{}")))); }
    const table = u.pathname.replace("/rest/v1/", "");
    if (failOn && table === failOn) return json({ message: "the database is down" }, 503);
    if (!T[table]) return json({ message: "relation " + table + " does not exist" }, 404);
    if ((init?.method || "GET") === "POST") {
      JSON.parse(String(init!.body)).forEach((r: any) => { const i = T[table].findIndex((x) => x.book_id === r.book_id && x.kind === r.kind && x.args === r.args); if (i >= 0) T[table][i] = r; else T[table].push(r); });
      return new Response(null, { status: 201 });
    }
    reads++;
    const hit = pages.get(u.pathname + u.search);
    if (hit) return new Response(hit, { status: 200, headers: { "Content-Type": "application/json" } });
    let out = T[table]; let limit = Infinity, offset = 0, order = "";
    for (const [k, v] of u.searchParams.entries()) {
      if (k === "select") continue; if (k === "limit") { limit = +v; continue; } if (k === "offset") { offset = +v; continue; } if (k === "order") { order = v; continue; }
      out = out.filter((r) => pass(r, k, v));
    }
    if (order) { const ck = table + "|" + u.searchParams.toString().replace(/&?(limit|offset)=\d+/g, ""), was = sorted.get(ck);
      if (was) out = was; else { const cols = order.split(",").map((c) => c.split(".")); out = out.slice().sort((a, b) => { for (const [c, d] of cols) { const x = a[c], y = b[c]; if (x === y) continue; const r = (x ?? "") < (y ?? "") ? -1 : 1; return d === "desc" ? -r : r; } return 0; }); sorted.set(ck, out); } }
    const text = JSON.stringify(out.slice(offset, offset + limit));
    if (["tally_vouchers", "tally_lines", "tally_bills", "tally_ledgers", "tally_groups", "client_book_items", "records"].includes(table)) pages.set(u.pathname + u.search, text);
    return new Response(text, { status: 200, headers: { "Content-Type": "application/json" } });
  } finally { fakeCpu += cpu() - c0; }
};
const env: Record<string, string> = { SUPABASE_URL: "https://fake.example", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" };
// GST_READY_MS / GST_TOTAL_MS: a slower machine's budget, to check the figures there (the function's own is 1.1 s / 1.5 s)
const envMs = (k: string) => Number(Deno.env.get(k) || 0) || undefined;
const h = handler({ env: (k) => env[k], fetch: fake as typeof fetch, now: () => new Date(Date.parse(IN.today || "2026-04-20T06:00:00Z")), later: (p) => { p.catch(() => {}); }, ready: envMs("GST_READY_MS"), total: envMs("GST_TOTAL_MS") });
const call = async (body: unknown, tok = "tok-member", extra: Record<string, string> = {}) => {
  const r = await h(new Request("https://fake.example/functions/v1/gst-run", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: "https://staging.fincom.live", ...extra }, body: JSON.stringify(body) }));
  return { status: r.status, cors: r.headers.get("Access-Control-Allow-Origin") || "", ...(await r.json()) };
};
// one background run, its CPU (the fake's own taken out) and the memory at its end
const runs: any[] = []; let rss = 0;
// memory: the heap the run itself held, sampled while it runs (each await) and at its end, over the heap after a
// collection before it (the fake's tables and its kept answers are in that base)
const gc = (globalThis as any).gc;
const warm = async (tok = "service-key", extra: Record<string, string> = {}) => {
  if (gc) gc();
  const base = Deno.memoryUsage().heapUsed; let peak = base;
  const tick = setInterval(() => { peak = Math.max(peak, Deno.memoryUsage().heapUsed); }, 1);
  const f0 = fakeCpu, c0 = cpu(), t0 = performance.now();
  const r = await call({ action: "warm" }, tok, extra);
  clearInterval(tick); peak = Math.max(peak, Deno.memoryUsage().heapUsed);
  const c = cpu() - c0 - (fakeCpu - f0), m = Deno.memoryUsage().rss; rss = Math.max(rss, m);
  const all = (() => { const f = Deno.readTextFileSync("/proc/self/stat"), y = f.slice(f.lastIndexOf(")") + 2).split(" "); return (+y[11] + +y[12]) * 10; })();
  const x = { ...r, procCpu: all, cpu: Math.round(c), wall: Math.round(performance.now() - t0), rss: Math.round(m / 1048576), heap: Math.round((peak - base) / 1048576) }; runs.push(x); return x;
};
const out: any = {};
// gst-run's reading, as a run does it (for the memory and the made-entries checks)
const svc = async (p: string) => { const r = await fake("https://fake.example" + p, { headers: { Authorization: "Bearer service-key" } }); return r.json(); };
const rpcF = async (fn: string, a: any) => { const r = await fake("https://fake.example/rest/v1/rpc/" + fn, { method: "POST", headers: { Authorization: "Bearer service-key" }, body: JSON.stringify(a) }); return r.json(); };
const month = (ym: string, tok = "tok-member") => call({ action: "month", client_id: rows.client, reg: "07", ym }, tok);
// a miss: nothing worked out, queued, a background run started
out.miss = await month(IN.asks[IN.asks.length - 1].ym);
out.kicked = kicks.length; out.keptAtMiss = T.tally_calc_results.length;
out.missAgain = await month(IN.asks[IN.asks.length - 1].ym);   // still waiting, not taken: may start a run
out.kickedAgain = kicks.length;
// the background runs, one after another (each run waits its 20 seconds before the client is taken again)
out.limited = null; const k0 = kicks.length;
for (let i = 0; i < 80; i++) {
  const r = await warm();
  if (i === 0) { const again = await call({ action: "warm" }, "service-key"); out.limited = again; }
  if (r.idle || !r.more) break;
  clock += 21000;
}
out.runs = runs.map((r) => ({ months: r.months, book: r.book, cpu: r.cpu, wall: r.wall, rss: r.rss, heap: r.heap, ok: r.ok, more: r.more, big: r.big, prep: r.prep, fromPrep: r.fromPrep, error: r.error, spentMs: r.spentMs, readyMs: r.readyMs, booksMs: r.booksMs, ms: r.ms }));
out.prepPuts = prepPuts; out.prepGets = prepGets; out.prepBytes = T.gst_calc_prep.map((p) => p.vouchers.length);
out.kept = T.tally_calc_results.map((k) => ({ book: k.book_id, args: k.args, result: k.result, version: k.version }));
out.queueLeft = T.gst_calc_queue.length; out.kicksDuringRuns = kicks.length - k0;
out.peakRss = Math.round(rss / 1048576);
// what a run holds alive at its fullest (after a collection): the rows read and the books made from them, one month
// worked out (gst-run's reading and the engine, as a run does them; the fake's tables are in the base)
if (gc) {
  gc(); const h0 = Deno.memoryUsage().heapUsed;
  const lr = await load(svc, rpcF, FIRM, rows.client, T.tally_books[0], rows.co, ["2025-26"], RPC.gst_calc_gstins({ p_book: BK, p_client: rows.client }));
  gc(); const h1 = Deno.memoryUsage().heapUsed;
  const st = step(lr, "07", {}, { max: 1, budget: 1 });
  gc(); const h2 = Deno.memoryUsage().heapUsed;
  out.live = { rows: Math.round((h1 - h0) / 1048576), rowsAndBooks: Math.round((h2 - h0) / 1048576), months: st.months.length, base: Math.round(h0 / 1048576) };
}
if (!IN.timing) {
  out.hits = []; for (const a of IN.asks) out.hits.push(await month(a.ym));
  // a new entry: the version moves, a miss again (and only a queued run, nothing worked out in the request)
  T.tally_vouchers.push({ ...T.tally_vouchers[0], guid: "syn-new-1", alter_id: 999999, day: "2026-03-30" }); pages.clear(); sorted.clear(); rowsCache.clear();
  out.changed = await month("202603");
  out.other = await month("202603").then(() => call({ action: "month", client_id: "cli-other", reg: "07", ym: "202603" }));
  out.noauth = await month("202603", "");
  out.nomember = await month("202603", "tok-outsider");
  out.warmNoKey = await call({ action: "warm" }, "tok-member");
  out.warmCron = await call({ action: "warm" }, "anon-key", { "x-cron-key": "cron-key" });
  // the console's switches: a switched-off client, a paused firm (the member's request and the background run)
  T.clients[0].status = "off"; out.clientOff = await month("202603"); clock += 21000; T.gst_calc_queue = [{ firm_id: FIRM, client_id: rows.client, why: "t", wanted_at: 0, taken_at: null, ran_at: null, attempts: 0, too_big: false }]; out.clientOffWarm = await call({ action: "warm" }, "service-key"); T.clients[0].status = "active";
  T.firms[0].status = "paused"; out.firmPaused = await month("202603"); T.firms[0].status = "active";
  // a failure inside: JSON with the CORS headers, not a crash
  failOn = "tally_calc_results"; out.failure = await month("202603"); failOn = "";
  // the queue (migration 153's rules): a change while a run holds the client is kept for the next run; a run taken and
  // never finished three times leaves the client to the app; at most 3 runs at once; first wanted, first taken; a delay
  const Q = (id: string) => T.gst_calc_queue.find((x) => x.client_id === id);
  const W = (id: string, o: any = {}) => RPC.gst_calc_want({ p_firm: FIRM, p_client: id, p_why: "t", ...o });
  T.gst_calc_queue = []; clock += 600000;
  W("cli-q");
  const tk = RPC.gst_calc_take({ p_n: 1 }); clock += 1000;
  out.q = { taken: tk.length, wantWhileTaken: W("cli-q"), takenAgainWithin2min: RPC.gst_calc_take({ p_n: 1 }).length };
  RPC.gst_calc_done({ p_firm: FIRM, p_client: "cli-q", p_more: false, p_ok: true }); out.q.keptAfterDone = !!Q("cli-q");
  clock += 21000; RPC.gst_calc_take({ p_n: 1 }); RPC.gst_calc_done({ p_firm: FIRM, p_client: "cli-q", p_more: false, p_ok: true }); out.q.goneWhenNothingNew = !Q("cli-q");
  T.gst_calc_queue = []; W("cli-k");
  for (let i = 0; i < 3; i++) { RPC.gst_calc_take({ p_n: 1 }); clock += 121000; }
  out.q.afterThreeKilled = { taken: RPC.gst_calc_take({ p_n: 1 }).length, tooBig: Q("cli-k").too_big, want: W("cli-k") };
  clock += 86400000 + 1000; out.q.afterADay = { want: W("cli-k"), tooBig: Q("cli-k").too_big };
  T.gst_calc_queue = []; ["c-a", "c-b", "c-c", "c-d", "c-e"].forEach((c, i) => { clock += 10; W(c); });
  const first3 = RPC.gst_calc_take({ p_n: 5 }).map((x: any) => x.client_id);
  out.q.cap = { first3, more: RPC.gst_calc_take({ p_n: 5 }).length };
  // lines queued for the drain (its message 77 waiting): not taken until the drain has applied them; a want never puts
  // off one already due; a run taken and dead (2 minutes) is started again by a miss
  T.gst_calc_queue = []; HELD.add(77); out.q.held = { start: W("c-late", { p_after: 77 }), now: RPC.gst_calc_take({ p_n: 1 }).length };
  clock += 300000; out.q.held.stillHeld = RPC.gst_calc_take({ p_n: 1 }).length; HELD.delete(77); out.q.held.applied = RPC.gst_calc_take({ p_n: 1 }).length;
  T.gst_calc_queue = []; W("c-due"); const due0 = Q("c-due").wanted_at; clock += 5000; W("c-due"); out.q.dueKept = Q("c-due").wanted_at === due0;
  RPC.gst_calc_take({ p_n: 1 }); clock += 1000; out.q.dead = { within: W("c-due") }; clock += 121000; out.q.dead.after = W("c-due");
  // a run whose reading and books take longer than its budget (here 1 ms): nothing stored, the client too big
  T.gst_calc_queue = []; clock += 600000; const n0 = T.tally_calc_results.length;
  W(rows.client); T.client_book_items.push({ ...T.client_book_items[0], key: "gst3b", item: ".07|209901", data: { rev2: { igst: 1 } }, deleted: false }); pages.clear(); sorted.clear();
  const h2 = handler({ env: (k) => env[k], fetch: fake as typeof fetch, now: () => new Date(Date.parse(IN.today || "2026-04-20T06:00:00Z")), later: () => {}, ready: 1 });
  const r2 = await h2(new Request("https://fake.example/functions/v1/gst-run", { method: "POST", headers: { Authorization: "Bearer service-key", "Content-Type": "application/json" }, body: JSON.stringify({ action: "warm" }) }));
  out.tooBigRun = { prepRun: await r2.json() }; out.tooBigRun.prepStored = T.gst_calc_prep.some((p) => p.book_id === BK); out.tooBigRun.afterPrep = { ...Q(rows.client) };
  clock += 21000;
  const r2b = await h2(new Request("https://fake.example/functions/v1/gst-run", { method: "POST", headers: { Authorization: "Bearer service-key", "Content-Type": "application/json" }, body: JSON.stringify({ action: "warm" }) }));
  Object.assign(out.tooBigRun, await r2b.json()); out.tooBigRun.stored = T.tally_calc_results.length - n0; out.tooBigRun.afterOne = { ...Q(rows.client) };
  clock += 21000;
  const r3 = await h2(new Request("https://fake.example/functions/v1/gst-run", { method: "POST", headers: { Authorization: "Bearer service-key", "Content-Type": "application/json" }, body: JSON.stringify({ action: "warm" }) }));
  out.tooBigRun.second = await r3.json(); out.tooBigRun.stored = T.tally_calc_results.length - n0; out.tooBigRun.queued = { ...Q(rows.client) };
  out.tooBigRun.backOnNewEngine = W(rows.client, { p_rev: "another-engine" }) === true && Q(rows.client).too_big === false;
  // two runs at once in one isolate: each has its own budget (two clients, both taken, both run)
  T.gst_calc_queue = []; clock += 600000; T.clients.push({ id: "cli-two", firm_id: FIRM, data: rows.co, deleted: false, status: "active" });
  W(rows.client); W("cli-two");
  const both = await Promise.all([1, 2].map(() => h(new Request("https://fake.example/functions/v1/gst-run", { method: "POST", headers: { Authorization: "Bearer service-key", "Content-Type": "application/json" }, body: JSON.stringify({ action: "warm" }) })).then((r) => r.json())));
  // the entries kept for the book (gst_calc_prep, made by the too-big run above) give every month as the book's own rows do
  { const pr = T.gst_calc_prep.find((p) => p.book_id === BK && p.version === RPC.tally_calc_version({ p_book: BK }));
    out.prepSame = null;
    if (pr) {
      const g = RPC.gst_calc_gstins({ p_book: BK, p_client: rows.client });
      const a = await load(svc, rpcF, FIRM, rows.client, T.tally_books[0], rows.co, ["2025-26"], g), b = await load(svc, rpcF, FIRM, rows.client, T.tally_books[0], rows.co, ["2025-26"], g, JSON.parse(pr.vouchers));
      const sa = step(a, "07", {}, { max: 12, ready: 1e9, total: 1e9 }), sb = step(b, "07", {}, { max: 12, ready: 1e9, total: 1e9 });
      out.prepSame = { n: sa.months.length, noRows: !b.heads.length && !b.lines.length, same: JSON.stringify(sa.months) === JSON.stringify(sb.months) && JSON.stringify(sa.all) === JSON.stringify(sb.all), fp: JSON.stringify(sa.fp) === JSON.stringify(sb.fp) };
    } }
  out.twoAtOnce = both.map((x: any) => ({ ok: x.ok, client: x.client, big: !!x.big, spentMs: x.spentMs }));
}
await Deno.writeTextFile(outFile, JSON.stringify(out));
