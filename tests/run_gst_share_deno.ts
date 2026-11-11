// deno run --allow-all tests/run_gst_share_deno.ts - next-gst-share: gst-run's two new actions (server/gst-run/handler.ts:
// "share_sweep", "share_parity") on a fake Supabase that holds the made-up client tests/run_gst_share.js wrote
// (tests/out/gst-share-rows.json; run that first) and answers migration 164's functions in memory (pick: every entry
// due once, then those changed; put: the shares kept; gst_month_get: their month sums). Checks: only the service role or
// the timer's key; the first run makes the context and stops; the next runs take batches (limit) until nothing is due;
// the parity of every month is the engine's (calc_parity kept, same); an entry changed is the only one taken again;
// a ledger the context has not got: nothing kept, the context made again; the existing actions still answer.
// Made-up rows only; nothing real is called.
import { handler } from "../server/gst-run/handler.ts";
import { unpack, HEADS } from "../server/gst-run/data.ts";

const OUT = new URL("./out/", import.meta.url);
const W = JSON.parse(Deno.readTextFileSync(new URL("gst-share-rows.json", OUT)));
let fails = 0;
const ok = (c: boolean, w: string) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const SERVICE = "service-key-164", BOOK = W.book.book_id, FIRM = "f1640000-0000-4000-8000-000000000001", CLIENT = W.book.client_id;
const book = Object.assign({}, W.book, { firm_id: FIRM });
const COLS = HEADS.split(",");
// gst_calc_rows' compact form of some heads (unpack's inverse)
const pack = (heads: any[]) => {
  const L: string[] = [], ix = (n: string) => { let i = L.indexOf(n); if (i < 0) { L.push(n); i = L.length - 1; } return i; };
  return { ledgers: L, heads: heads.map((h) => COLS.map((c) => h[c] === undefined ? null : h[c]).concat([
    W.lines.filter((l: any) => l.guid === h.guid).map((l: any) => [ix(l.ledger), l.amount, l.hsn, l.rate]),
    W.bills.filter((b: any) => b.guid === h.guid).map((b: any) => [ix(b.ledger), b.name, b.type, b.amount, b.credit_days])])) };
};
// the fake cloud: migration 164's state
const T: any = { ctx: null, seen: new Map<string, string>(), due: new Set<string>(W.heads.map((h: any) => h.guid)), shares: new Map<string, any[]>(), parity: [] as any[], calls: [] as string[] };
const sig = (h: any) => JSON.stringify([h.alter_id, h.gst_alter_id, h.deleted_at, h.cancelled, h.optional]);
const monthRows = (ym: string) => {
  const m = new Map<string, any>();
  T.shares.forEach((l: any[]) => l.forEach((s) => { if (s.ym !== ym) return; const k = [s.reg, s.sec, s.k1, s.k2, s.k3].join("|");
    const x = m.get(k) || { reg: s.reg, sec: s.sec, k1: s.k1, k2: s.k2, k3: s.k3, n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0 };
    x.n += s.n; ["taxable", "igst", "cgst", "sgst", "cess", "qty"].forEach((f) => { x[f] = Math.round(x[f] * 100 + Number(s[f] || 0) * 100) / 100; }); m.set(k, x); }));
  return [...m.values()].concat([{ reg: "", sec: "*", k1: "", k2: "", k3: "", n: 0, status: T.due.size ? "stale" : "fresh" }]);
};
const RPC: Record<string, (a: any) => any> = {
  gst_share_ctx_version: () => "ctx-v1" + (T.ctxBump || ""),
  gst_share_ctx_get: () => T.ctx,
  gst_share_ctx_put: (a) => { T.ctx = { stamp: a.p_stamp, engine: a.p_engine, ctx: a.p_ctx }; T.ctxPuts = (T.ctxPuts || 0) + 1;
    const L = new Set(a.p_ledgers || []); W.heads.forEach((h: any) => { if (a.p_all || L.has(h.party) || W.lines.some((l: any) => l.guid === h.guid && L.has(l.ledger)) || (a.p_guids || []).includes(h.guid)) T.due.add(h.guid); });
    return { ok: true, due: T.due.size }; },
  gst_share_pick: (a) => { W.heads.forEach((h: any) => { if (T.seen.has(h.guid) && T.seen.get(h.guid) !== sig(h)) T.due.add(h.guid); });
    const all = [...T.due].sort(), g = all.slice(0, a.p_limit);
    return { ok: true, at: new Date().toISOString(), guids: g, due: all.length, more: all.length > a.p_limit,
      seen: g.map((x) => { const h = W.heads.find((z: any) => z.guid === x); return { guid: x, alter_id: h.alter_id, gst_alter_id: h.gst_alter_id, deleted: !!h.deleted_at, cancelled: !!h.cancelled, optional: !!h.optional, gone: false }; }) }; },
  gst_share_rows: (a) => pack(W.heads.filter((h: any) => a.p_guids.includes(h.guid))),
  gst_share_put: (a) => { a.p_seen.forEach((x: any) => { T.shares.delete(x.guid); T.due.delete(x.guid); T.seen.set(x.guid, sig(W.heads.find((h: any) => h.guid === x.guid))); });
    a.p_shares.forEach((s: any) => { const l = T.shares.get(s.guid) || []; l.push(s); T.shares.set(s.guid, l); });
    return { ok: true, months: [...new Set(a.p_shares.map((s: any) => s.ym))] }; },
  gst_month_get: (a) => monthRows(a.p_ym),
  gst_parity_put: (a) => { T.parity.push(a); return T.parity.length; },
  tally_calc_version: () => "bv1", gst_calc_prep_get: () => null, gst_calc_rows: () => pack(W.heads.filter((h: any) => !h.deleted_at || true)),
  gst_cron_ok: (a) => a.k === "cron-164",
};
const REST: [RegExp, () => any][] = [
  [/^\/rest\/v1\/tally_books\?/, () => [book]],
  [/^\/rest\/v1\/clients\?/, () => [{ id: CLIENT, data: W.co, deleted: false }]],
  [/^\/rest\/v1\/tally_ledgers\?/, () => W.ledgers], [/^\/rest\/v1\/tally_groups\?/, () => W.groups],
  [/^\/rest\/v1\/client_book_items\?/, () => W.items], [/^\/rest\/v1\/records\?/, () => []],
  [/^\/rest\/v1\/(firms|subscriptions)\?/, () => []],
];
const fake = async (input: any, init?: any) => {
  const u = new URL(String(input)), p = u.pathname + u.search;
  T.calls.push(u.pathname.replace("/rest/v1/", ""));
  const json = (x: any) => new Response(JSON.stringify(x), { status: 200, headers: { "Content-Type": "application/json" } });
  if (u.pathname.startsWith("/rest/v1/rpc/")) { const fn = u.pathname.slice(13), f = RPC[fn]; if (!f) return new Response(JSON.stringify({ message: "no " + fn }), { status: 404 }); return json(f(JSON.parse(init?.body || "{}"))); }
  if (/offset=(?!0\b)\d+/.test(u.search)) return json([]);
  const hit = REST.find(([re]) => re.test(p));
  return hit ? json(hit[1]()) : new Response(JSON.stringify({ message: "not here: " + u.pathname }), { status: 404 });
};
const h = handler({ env: (k) => ({ SUPABASE_URL: "http://fake.local", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon" } as any)[k], fetch: fake as any });
const call = async (body: any, key = SERVICE, extra: Record<string, string> = {}) => { const r = await h(new Request("http://fn.local/gst-run", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", ...extra }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };

console.log("== the new actions");
ok((await call({ action: "share_sweep", book_id: BOOK }, "someone")).status === 401, "share_sweep: refused without the service role or the timer's key");
ok((await call({ action: "share_parity", book_id: BOOK, ym: "202504" }, "anon")).status === 401, "share_parity: the same");
ok((await call({ action: "share_sweep", book_id: "nope" })).status === 400, "a book that is no book: refused");
let r = await call({ action: "share_sweep", book_id: BOOK }, "x", { "x-cron-key": "cron-164" });
ok(r.status === 200 && r.j.ok && r.j.ctx === true && r.j.all === true && r.j.more && T.shares.size === 0, "the first run (the timer's key): the context made from the whole book, kept, every entry due; nothing else");
let runs = 0;
for (; runs < 20; runs++) { r = await call({ action: "share_sweep", book_id: BOOK, limit: 40 }); if (!r.j.ok) break; if (!r.j.more) break; }
ok(r.j.ok && !r.j.more && T.due.size === 0 && runs >= 3, "then batches of 40 until nothing is due (" + (runs + 1) + " runs, " + T.shares.size + " entries with a share)");
let same = 0;
for (const ym of W.months) for (const reg of ["07", ""]) { const p = await call({ action: "share_parity", book_id: BOOK, ym, reg }); if (p.j.ok && p.j.same) same++; else console.log("   ", ym, reg, JSON.stringify(p.j).slice(0, 300)); }
ok(same === W.months.length * 2 && T.parity.length === same && T.parity.every((x: any) => x.p_ok && x.p_max === 0), "share_parity: every month (07 and all) the engine's, kept in calc_parity (" + same + ")");
// an entry changed in the copy: it alone is taken again
const e = W.heads.find((x: any) => x.vtype === "Sales" && !x.cancelled && !x.deleted_at && T.shares.has(x.guid));
e.alter_id += 5; W.lines.filter((l: any) => l.guid === e.guid).forEach((l: any) => { if (/^Sales/.test(l.ledger)) l.amount += 1000; else if (l.ledger === e.party) l.amount -= 1000; });
r = await call({ action: "share_sweep", book_id: BOOK });
ok(r.j.ok && r.j.entries === 1 && !r.j.more, "an entry altered: the next run takes it alone");
const ym = String(e.day).replace(/-/g, "").slice(0, 6), p = await call({ action: "share_parity", book_id: BOOK, ym, reg: "07" });
ok(p.j.same, "and its month is still the engine's (" + ym + ")");
// a ledger the context has not got: nothing kept, the context made again
const e2 = W.heads.find((x: any) => x.vtype === "Sales" && !x.cancelled && !x.deleted_at && x.guid !== e.guid && T.shares.has(x.guid));
e2.alter_id += 5; W.lines.filter((l: any) => l.guid === e2.guid && /^Sales/.test(l.ledger)).forEach((l: any) => { l.ledger = "Sales - New Line"; });
W.ledgers = W.ledgers.concat([{ name: "Sales - New Line", parent: "Sales Accounts", open: 0 }]);
const puts = T.ctxPuts;
r = await call({ action: "share_sweep", book_id: BOOK });
ok(r.j.ok && r.j.entries === 0 && (r.j.unknown || []).includes("Sales - New Line") && T.ctxPuts === puts + 1 && T.due.has(e2.guid), "an entry on a ledger the context has not got: nothing kept, the context marked to be made again");
r = await call({ action: "share_sweep", book_id: BOOK });
ok(r.j.ok && r.j.ctx === true && !r.j.all && r.j.ledgers >= 1, "the next run makes the context again (the new ledger named)");
r = await call({ action: "share_sweep", book_id: BOOK });
ok(r.j.ok && r.j.entries >= 1 && T.due.size === 0, "and the one after keeps the entry");
const p2 = await call({ action: "share_parity", book_id: BOOK, ym: String(e2.day).replace(/-/g, "").slice(0, 6), reg: "07" });
ok(p2.j.same, "its month the engine's");
ok((await call({ action: "nope" })).status === 400 && (await call({ action: "month", client_id: CLIENT, reg: "07", ym: "202504" }, "anon")).status === 401, "the existing actions answer as before");
console.log(fails ? fails + " FAILED" : "all ok");
Deno.exit(fails ? 1 : 0);
