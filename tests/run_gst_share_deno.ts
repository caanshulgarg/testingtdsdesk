// deno run --allow-all tests/run_gst_share_deno.ts - next-gst-share: gst-run's two new actions (server/gst-run/handler.ts:
// "share_sweep", "share_parity") on a fake Supabase that holds the made-up client tests/run_gst_share.js wrote
// (tests/out/gst-share-rows.json; run that first) and answers migration 164's functions in memory (pick: every entry
// due once, then those changed; put: the shares kept; gst_month_get: their month sums). Checks: only the service role or
// the timer's key; the first run makes the context and stops; the next runs take batches (limit) until nothing is due;
// the parity of every month is the engine's (calc_parity kept, same); an entry changed is the only one taken again;
// a ledger the context has not got: nothing kept, the context made again; the client's record read; the book's lease
// (a book busy skipped); the nightly parity of every month; over the run's time: a parity kept as not checked, a context
// rebuild backed off; a new engine deployed (migration 170): share_engine (and every share_* call) writes the engine,
// the book whose context the old engine made is due, the sweep makes it again and works every entry out again, then not
// due; without 170 the sweep goes on; a paused firm refused by both; the existing actions still answer.
// Part B (migration 171): the made-up client with the inward cases (tests/out/gst-itc-rows.json, written by
// tests/run_gst_share.js, with its 2Bs and gst-2b-match's run): the sweep keeps each entry's document and allocations
// (gst_share_put_itc); share_parity works each month's tables 4, 5 and 6 out by the month step on what the fake keeps
// (gst_itc_inputs, answered as migration 171 does) against today's engine on the whole book: every month the same, kept
// as calc 'gst-itc', the credit carried kept in order (gst_itc_month) and read back by the next month; the nightly run
// checks both; without 171 the sweep keeps the shares alone (itc false) and the parity checks part A alone.
// Migration 172 (next-gst-isd): the month step reads only the documents of the years whose 2B is here
// (gst_itc_inputs_2b, its months from the client's 2Bs); before 172 (404) gst_itc_inputs, the same figures.
// Made-up rows only; nothing real is called.
import { handler } from "../server/gst-run/handler.ts";
import { unpack, HEADS } from "../server/gst-run/data.ts";
// @ts-ignore plain JavaScript
import { ENGINE, REV } from "../server/gst-run/engine.js";

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
const T: any = { ctx: null, seen: new Map<string, string>(), due: new Set<string>(W.heads.map((h: any) => h.guid)), shares: new Map<string, any[]>(), parity: [] as any[], calls: [] as string[],
  docs: new Map<string, any>(), itcMonth: new Map<string, any>(), itcParity: [] as any[] };
const sig = (h: any) => JSON.stringify([h.alter_id, h.gst_alter_id, h.deleted_at, h.cancelled, h.optional]);
const monthRows = (ym: string) => {
  const m = new Map<string, any>();
  T.shares.forEach((l: any[]) => l.forEach((s) => { if (s.ym !== ym) return; const k = [s.reg, s.sec, s.k1, s.k2, s.k3].join("|");
    const x = m.get(k) || { reg: s.reg, sec: s.sec, k1: s.k1, k2: s.k2, k3: s.k3, n: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0, qty: 0 };
    x.n += s.n; ["taxable", "igst", "cgst", "sgst", "cess", "qty"].forEach((f) => { x[f] = Math.round(x[f] * 100 + Number(s[f] || 0) * 100) / 100; }); m.set(k, x); }));
  return [...m.values()].concat([{ reg: "", sec: "*", k1: "", k2: "", k3: "", n: 0, status: T.due.size ? "stale" : "fresh" }]);
};
// gst_itc_inputs (migration 171) on the fake's rows: the book's months and GSTINs, the registration's month rows, the
// documents, the allocations of the bills rule 37 follows, those suppliers' movement, the credit kept on this version
const itcInputs = (reg: string, engine: string, version: string, yms?: string[] | null) => {
  const live = W.heads.filter((h: any) => !h.deleted_at), withL = new Set(W.lines.filter((l: any) => l.ledger).map((l: any) => l.guid));
  const dated = live.filter((h: any) => withL.has(h.guid) || (h.cancelled && h.vno)).map((h: any) => String(h.day).replace(/-/g, "").slice(0, 6)).sort();
  const months: any = {}, status: any = {};
  W.months.forEach((ym: string) => { const m = monthRows(ym).filter((r: any) => r.reg === reg && r.sec !== "*"); if (m.length) months[ym] = m; status[ym] = T.due.size ? "stale" : "fresh"; });
  const docs = [...T.docs.values()].filter((d: any) => d.doc && (d.doc_reg === reg || d.doc_reg === "") && (!yms || yms.includes(String(d.ym)))).map((d: any) => ({ guid: d.guid, doc: d.doc }))
    .sort((x: any, y: any) => String(x.doc.bookDate).localeCompare(String(y.doc.bookDate)) || (x.guid < y.guid ? -1 : 1));
  const nb = new Set<string>(); T.docs.forEach((d: any) => d.bills.forEach((b: any) => { if (b.nb && b.reg === reg) nb.add(b.l + "\u0001" + b.name); }));
  const bills: any[] = []; T.docs.forEach((d: any) => d.bills.forEach((b: any, i: number) => { if (nb.has(b.l + "\u0001" + b.name)) bills.push({ guid: d.guid, seq: i, rec: b }); }));
  bills.sort((x, y) => String(x.rec.date).localeCompare(String(y.rec.date)) || (x.guid < y.guid ? -1 : x.guid > y.guid ? 1 : 0) || x.seq - y.seq);
  const parties = new Set([...nb].map((k) => k.split("\u0001")[0])), on = new Map(live.filter((h: any) => !h.cancelled && !h.optional).map((h: any) => [h.guid, h])), mv: any = {};
  W.lines.forEach((l: any) => { const h: any = on.get(l.guid); if (!h || !parties.has(l.ledger)) return; const ym = String(h.day).replace(/-/g, "").slice(0, 6), m = mv[l.ledger] = mv[l.ledger] || {}; m[ym] = (m[ym] || 0) + Math.round(Number(l.amount) * 100); });
  const moves: any = {}; Object.keys(mv).forEach((l) => { moves[l] = Object.keys(mv[l]).sort().map((m) => [m, mv[l][m] / 100]); });
  const carry: any = {}, refs: any = {}; T.itcMonth.forEach((x: any, k: string) => { const [ym, g] = k.split("|"); if (g === reg && x.engine === engine && x.version === version && version) { carry[ym] = x.carry; if (x.ref) refs[ym] = x.ref; } });
  T.itcInputsN = (T.itcInputsN || 0) + 1;
  return { first: dated[0] || null, last: dated[dated.length - 1] || null, gstins: Array.from(new Set(live.filter((h: any) => h.cmp_gstin).map((h: any) => String(h.cmp_gstin).toUpperCase()))).sort(),
    months, status, docs, bills, moves, carry, refs };
};
const leaseOk = (a: any) => T.lease && T.lease.run === a.p_run && T.lease.until > Date.now();
const RPC: Record<string, (a: any) => any> = {
  gst_share_lease: (a) => { T.leases = (T.leases || 0) + 1; if (T.lease && T.lease.run !== a.p_run && T.lease.until > Date.now()) return false; T.lease = { run: a.p_run, until: Date.now() + a.p_secs * 1000 }; return true; },
  gst_share_unlease: (a) => { if (T.lease && T.lease.run === a.p_run) { T.lease = null; return true; } return false; },
  gst_share_backoff: (a) => { T.backoff = { what: a.p_what, why: a.p_why, until: new Date(Date.now() + 600000).toISOString() }; return T.backoff.until; },
  gst_share_backoff_clear: () => { T.backoff = null; return null; },
  gst_share_ctx_version: () => "ctx-v1" + (T.ctxBump || ""),
  gst_share_ctx_get: () => Object.assign({}, T.ctx || {}, { backoff: T.backoff && T.backoff.what === "ctx" ? T.backoff.until : null }),
  gst_share_ctx_put: (a) => { if (!leaseOk(a)) return { ok: false, error: "lease lost" }; T.ctx = { stamp: a.p_stamp, engine: a.p_engine, ctx: a.p_ctx }; T.ctxPuts = (T.ctxPuts || 0) + 1;
    const L = new Set(a.p_ledgers || []); W.heads.forEach((h: any) => { if (a.p_all || L.has(h.party) || W.lines.some((l: any) => l.guid === h.guid && L.has(l.ledger)) || (a.p_guids || []).includes(h.guid)) T.due.add(h.guid); });
    return { ok: true, due: T.due.size }; },
  gst_share_pick: (a) => { W.heads.forEach((h: any) => { if (T.seen.has(h.guid) && T.seen.get(h.guid) !== sig(h)) T.due.add(h.guid); });
    const all = [...T.due].sort(), g = all.slice(0, a.p_limit);
    return { ok: true, at: new Date().toISOString(), guids: g, due: all.length, more: all.length > a.p_limit,
      seen: g.map((x) => { const h = W.heads.find((z: any) => z.guid === x); return { guid: x, day: h.day, alter_id: h.alter_id, gst_alter_id: h.gst_alter_id, deleted: !!h.deleted_at, cancelled: !!h.cancelled, optional: !!h.optional, gone: false }; }) }; },
  gst_share_rows: (a) => pack(W.heads.filter((h: any) => a.p_guids.includes(h.guid))),
  gst_share_put: (a) => { if (!leaseOk(a)) return { ok: false, error: "lease lost" }; T.errors = (T.errors || []).concat(a.p_errors || []); T.coSeen = T.lastCo; a.p_seen.forEach((x: any) => { T.shares.delete(x.guid); T.due.delete(x.guid); T.seen.set(x.guid, sig(W.heads.find((h: any) => h.guid === x.guid))); });
    a.p_shares.forEach((s: any) => { const l = T.shares.get(s.guid) || []; l.push(s); T.shares.set(s.guid, l); });
    return { ok: true, months: [...new Set(a.p_shares.map((s: any) => s.ym))] }; },
  gst_month_get: (a) => monthRows(a.p_ym),
  gst_parity_put: (a) => { T.parity.push(a); return T.parity.length; },
  tally_calc_version: () => "bv1", gst_calc_prep_get: () => null, gst_calc_rows: () => Object.assign(pack(W.heads), T.padRows ? { pad: "x".repeat(30_000_000) } : {}),
  gst_cron_ok: (a) => a.k === "cron-164",
  // migration 171 (part B), as its SQL answers
  gst_itc_ready: () => true,
  gst_calc_gstins: () => Array.from(new Set(W.heads.filter((h: any) => h.cmp_gstin).map((h: any) => String(h.cmp_gstin).toUpperCase()))).sort(),
  gst_calc_version: () => "v-itc-" + (T.itcVer || 1),
  gst_share_put_itc: (a) => { if (!leaseOk(a)) return { ok: false, error: "lease lost" }; const seen = new Set(a.p_seen.map((x: any) => x.guid));
    if ((a.p_docs || []).some((d: any) => !seen.has(d.guid))) return { ok: false, error: "a document of an entry not seen" };
    const good = (a.p_docs || []).filter((d: any) => /^\d{6}$/.test(String(d.ym || ""))), bad = (a.p_docs || []).filter((d: any) => !good.includes(d)).map((d: any) => ({ guid: d.guid, error: "its document could not be kept" }));
    const r = RPC.gst_share_put(Object.assign({}, a, { p_errors: (a.p_errors || []).concat(bad) })); if (!r.ok) return r; T.docPuts = (T.docPuts || 0) + 1;
    seen.forEach((g: any) => T.docs.delete(g)); good.forEach((d: any) => T.docs.set(d.guid, d)); return Object.assign(r, { docs: good.length, docErrors: bad.length }); },
  gst_itc_book: () => !!T.itcMarked,
  gst_itc_mark: (a) => { if (!leaseOk(a)) return { ok: false, error: "lease lost" }; T.itcMarks = (T.itcMarks || 0) + 1; W.heads.forEach((h: any) => T.due.add(h.guid)); T.itcMarked = true; return { ok: true, due: T.due.size }; },
  gst_itc_unmark: () => { const was = !!T.itcMarked; T.itcMarked = false; T.unmarks = (T.unmarks || 0) + 1; return was; },
  gst_itc_inputs: (a) => itcInputs(a.p_reg, a.p_engine, a.p_version),
  // migration 172: only the documents of the months asked (the years whose 2B is here)
  gst_itc_inputs_2b: (a) => { T.itc2bN = (T.itc2bN || 0) + 1; T.itc2bYms = a.p_yms; return itcInputs(a.p_reg, a.p_engine, a.p_version, a.p_yms); },
  gst_itc_month_put: (a) => { T.itcMonth.set(a.p_ym + "|" + a.p_reg, { engine: a.p_engine, version: a.p_version, carry: a.p_carry, result: a.p_result, ref: a.p_ref }); return true; },
  gst_itc_parity_put: (a) => { T.itcParity.push(a); return T.itcParity.length; },
  // migration 170: the engine gst-run runs (one row; true when it moved)
  gst_share_engine_put: (a) => { T.enginePuts = (T.enginePuts || 0) + 1; const moved = T.engine !== a.p_engine || T.engineRev !== a.p_rev; T.engine = a.p_engine; T.engineRev = a.p_rev; return moved; },
};
const REST: [RegExp, () => any][] = [
  // calc_parity: the months already checked tonight (T.done; empty unless a test sets it)
  [/^\/rest\/v1\/calc_parity\?/, () => /calc=eq\.gst-itc/.test(T.lastUrl) ? T.itcParity.filter((x: any) => x.p_ok !== null && x.p_engine === ENGINE).map((x: any) => ({ ym: x.p_ym, reg: x.p_reg })) : (T.done || [])],
  [/^\/rest\/v1\/tally_books\?/, () => [book]],
  [/^\/rest\/v1\/clients\?select=id,data&/, () => { T.lastCo = true; return [{ id: CLIENT, data: W.co }]; }],
  [/^\/rest\/v1\/clients\?/, () => [{ id: CLIENT, data: W.co, deleted: false }]],
  [/^\/rest\/v1\/gst_month\?/, () => { const out: any[] = []; T.shares.forEach((l: any[]) => l.forEach((x) => out.push({ ym: x.ym, reg: x.reg }))); return out; }],
  [/^\/rest\/v1\/tally_ledgers\?/, () => W.ledgers], [/^\/rest\/v1\/tally_groups\?/, () => W.groups],
  [/^\/rest\/v1\/client_book_items\?/, () => W.items], [/^\/rest\/v1\/records\?/, () => []],
  // gst-2b-match's kept matching (part B's parity reads it, as warm does)
  [/^\/rest\/v1\/gst_2b_runs\?/, () => { const g = (T.lastUrl.match(/gstin=eq\.([^&]+)/) || [])[1], fy = (T.lastUrl.match(/fy=eq\.([^&]+)/) || [])[1], r = (W.runs || {})[decodeURIComponent(g || "") + "|" + decodeURIComponent(fy || "")];
    return r ? [{ id: r.id, status: r.status, done_at: r.at, queued_at: r.at, result: r.result }] : []; }],
  [/^\/rest\/v1\/gst_2b_decisions\?/, () => []],
  [/^\/rest\/v1\/firms\?/, () => T.paused ? [{ status: "paused", status_reason: "made-up pause" }] : []],
  [/^\/rest\/v1\/subscriptions\?/, () => []],
];
const fake = async (input: any, init?: any) => {
  const u = new URL(String(input)), p = u.pathname + u.search;
  T.calls.push(u.pathname.replace("/rest/v1/", "")); T.lastUrl = p;
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
ok(T.coSeen === true && T.lease === null && T.leases > 10, "each run read the client's record for its batch, took the book's lease and let it go");
// one run a book at a time: a book held by another run is skipped
T.lease = { run: "other-run", until: Date.now() + 60000 };
r = await call({ action: "share_sweep", book_id: BOOK });
const rp = await call({ action: "share_parity", book_id: BOOK, ym: "202504" });
ok(r.j.busy === true && rp.j.busy === true && T.lease.run === "other-run", "a book another run holds: share_sweep and share_parity skip it (busy), the other run's lease untouched");
T.lease = null;
// the nightly parity: every month the book has sums for, each registration and all
const before = T.parity.length;
r = await call({ action: "share_parity", book_id: BOOK });
ok(r.j.ok && r.j.checked === W.months.length * 2 && r.j.same && T.parity.length === before + r.j.checked, "share_parity with no month: every month, 07 and all (" + r.j.checked + " checks), the engine's");
// the night's next run goes on where the last stopped: months checked in the last 20 hours are not checked again
T.done = T.parity.filter((x: any) => x.p_ok !== null).slice(0, W.months.length).map((x: any) => ({ ym: x.p_ym, reg: x.p_reg }));
const nDone = new Set(T.done.map((d: any) => d.ym + "|" + d.reg)).size, before2 = T.parity.length;
r = await call({ action: "share_parity", book_id: BOOK });
ok(r.j.ok && r.j.checked === W.months.length * 2 - nDone && T.parity.length === before2 + r.j.checked, "share_parity, the night's next run: the " + nDone + " checked tonight skipped, the other " + r.j.checked + " checked");
T.done = [];
// over the run's time: kept as not checked, the rest left
const hs = handler({ env: (k) => ({ SUPABASE_URL: "http://fake.local", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon" } as any)[k], fetch: fake as any, total: 1 });
const callS = async (body: any) => { const x = await hs(new Request("http://fn.local/gst-run", { method: "POST", headers: { Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, body: JSON.stringify(body) })); return await x.json(); };
const pr = await callS({ action: "share_parity", book_id: BOOK });
const last = T.parity[T.parity.length - 1];
ok(pr.ok && pr.skipped && last.p_ok === null && last.p_notes.skipped && last.p_notes.left > 0, "a parity over the run's time: kept as not checked (ok null), the months left said (" + last.p_notes.left + ")");
// a context rebuild over the run's time: backs off, and is not tried again meanwhile
T.ctxBump = "-2"; T.padRows = true;    // (a large answer: its reading alone is over the run's time)
const c1 = await callS({ action: "share_sweep", book_id: BOOK });
const c2 = await callS({ action: "share_sweep", book_id: BOOK });
ok(c1.ok && c1.big && c1.backoff && T.backoff && T.backoff.what === "ctx" && c2.backoff && !c2.big, "a context rebuild over the run's time: backs off, the next run does not try it again");
T.backoff = null; T.padRows = false;
r = await call({ action: "share_sweep", book_id: BOOK });
ok(r.j.ok && r.j.ctx === true && !T.backoff, "once the back-off is over a run within its time makes it, and clears it");
await call({ action: "share_sweep", book_id: BOOK });
// a new engine deployed (migration 170): the book's context and gst-run's engine row both name the old one
console.log("== a new engine deployed");
T.ctx.engine = "e-made-up-old"; T.engine = "e-made-up-old"; T.due.clear();
// migration 170's gst_share_books_due for this one book (no days written here): entries due, or the context on another engine
const bookDue = () => T.due.size > 0 || (T.engine != null && !!T.ctx && T.ctx.engine !== T.engine);
ok(!bookDue(), "before gst-run says its engine: the book is not due (the staging case)");
ok((await call({ action: "share_engine" }, "someone")).status === 401, "share_engine: refused without the service role or the timer's key");
r = await call({ action: "share_engine" }, "x", { "x-cron-key": "cron-164" });
ok(r.status === 200 && r.j.ok && r.j.engine === ENGINE && r.j.moved === true && T.engine === ENGINE && T.engineRev === REV, "share_engine (the timer's key): the engine and REV gst-run runs written");
ok(bookDue(), "now the book whose context is on the old engine is due");
r = await call({ action: "share_engine" });
ok(r.j.ok && r.j.moved === false, "said again: nothing moved");
const sw: any[] = [];
for (let k = 0; k < 30; k++) { r = await call({ action: "share_sweep", book_id: BOOK, limit: 1000 }); sw.push(r.j); if (!r.j.ok || !r.j.more) break; }
ok(sw[0].ctx === true && sw[0].all === true && sw.at(-1).ok && !sw.at(-1).more && T.ctx.engine === ENGINE && T.due.size === 0 && !bookDue(),
   "the sweep: the context made again on the new engine, every entry worked out again (" + sw.length + " runs); then not due");
T.engine = "e-made-up-other";
await call({ action: "share_sweep", book_id: BOOK });
ok(T.engine === ENGINE, "share_sweep says the engine too");
const put0 = RPC.gst_share_engine_put; delete RPC.gst_share_engine_put;
r = await call({ action: "share_sweep", book_id: BOOK });
const se = await call({ action: "share_engine" });
ok(r.j.ok && se.status === 200 && se.j.ok === false, "without migration 170: share_sweep goes on; share_engine says it could not");
RPC.gst_share_engine_put = put0;
// the firm paused: both refused
T.paused = true;
const g1 = await call({ action: "share_sweep", book_id: BOOK }), g2 = await call({ action: "share_parity", book_id: BOOK, ym: "202504" });
ok(g1.j.kind === "gate" && g2.j.kind === "gate", "a paused firm: share_sweep and share_parity refused (the firm's switches)");
T.paused = false;
ok((await call({ action: "nope" })).status === 400 && (await call({ action: "month", client_id: CLIENT, reg: "07", ym: "202504" }, "anon")).status === 401, "the existing actions answer as before");
// part A's client: its months' part B checked too (no 2B: the books basis), every one the same
ok(T.itcParity.length > 0 && T.itcParity.filter((x: any) => x.p_ok !== null).every((x: any) => x.p_ok === true), "part A's client: share_parity checked tables 4, 5 and 6 of its registration's months too (" + T.itcParity.filter((x: any) => x.p_ok !== null).length + " checks), every one the same");

console.log("== part B: the input tax credit side (migration 171)");
{
  const B = JSON.parse(Deno.readTextFileSync(new URL("gst-itc-rows.json", OUT)));
  Object.assign(W, B); Object.assign(book, B.book, { firm_id: FIRM });
  Object.assign(T, { ctx: null, seen: new Map(), due: new Set(W.heads.map((x: any) => x.guid)), shares: new Map(), docs: new Map(), itcMonth: new Map(), itcParity: [], parity: [], done: [], lease: null, backoff: null, ctxBump: "-itc", docPuts: 0, itcMarked: false, itcMarks: 0 });
  const BK = B.book.book_id;
  r = await call({ action: "share_sweep", book_id: BK });
  ok(r.j.ok && r.j.ctx === true && r.j.all === true, "the first run makes the part B client's context");
  const sw2: any[] = [];
  for (let k = 0; k < 20; k++) { r = await call({ action: "share_sweep", book_id: BK, limit: 60 }); sw2.push(r.j); if (!r.j.ok || !r.j.more) break; }
  const withDoc = [...T.docs.values()].filter((d: any) => d.doc).length;
  ok(sw2[0].itcMark === true && T.itcMarks === 1 && sw2.slice(1).every((x) => x.ok && x.itc === true) && T.due.size === 0 && withDoc > 40 && T.docPuts === sw2.length - 1 && [...T.docs.values()].some((d: any) => d.bills.some((b: any) => b.nb)),
    "the sweep marks the book once (every entry due), then keeps each entry's document and allocations with its shares (gst_share_put_itc, " + (sw2.length - 1) + " runs): " + withDoc + " documents");
  const n0 = T.itcParity.length;
  let itcSame = 0;
  for (const ym of W.months) { const p = await call({ action: "share_parity", book_id: BK, ym, reg: "07" }); if (p.j.ok && p.j.same && p.j.itc && p.j.itc.same && p.j.itc.checked === 1) itcSame++; else console.log("   ", ym, JSON.stringify(p.j).slice(0, 600)); }
  const got = T.itcParity.slice(n0);
  ok(itcSame === W.months.length && got.length === W.months.length && got.every((x: any) => x.p_ok === true && x.p_max === 0 && x.p_reg === "07" && x.p_engine === ENGINE),
    "share_parity, month by month: tables 4, 5 and 6 by the month step the engine's (calc 'gst-itc' kept, " + itcSame + " months)");
  ok(T.itcMonth.size === W.months.length && got.slice(1).every((x: any) => x.p_notes.carryKept > 0) && [...T.itcMonth.values()].every((x: any) => x.version === "v-itc-1" && x.engine === ENGINE),
    "each month's carried credit kept in order (gst_itc_month, on the version) and read back by the months after (" + got.slice(1).map((x: any) => x.p_notes.carryKept).join(" ") + ")");
  ok(T.itc2bN >= W.months.length && Array.isArray(T.itc2bYms) && T.itc2bYms.length === 12 && T.itc2bYms[0] === "202504" && T.itc2bYms[11] === "202603",
    "migration 172: the month step asked for the documents of the years whose 2B is here only (gst_itc_inputs_2b, " + (T.itc2bYms || []).length + " months: 2025-26)");
  {
    const was2b = RPC.gst_itc_inputs_2b, nOld = T.itcInputsN || 0; delete RPC.gst_itc_inputs_2b;
    const p0 = await call({ action: "share_parity", book_id: BK, ym: "202510", reg: "07" });
    RPC.gst_itc_inputs_2b = was2b;
    ok(p0.j.ok && p0.j.itc && p0.j.itc.same && p0.j.itc.checked === 1 && (T.itcInputsN || 0) === nOld + 1, "before migration 172 (gst_itc_inputs_2b not there): gst_itc_inputs, every document, the same figures");
  }
  const carried = [...T.itcMonth.entries()].filter(([, x]: any) => ["igst", "cgst", "sgst"].some((h) => Number(x.carry[h]) > 0)).map(([k]: any) => k.slice(0, 6));
  ok(carried.length >= 3 && got.some((x: any) => x.p_ym === "202603"), "credit carried out of " + carried.length + " months; the QRMP quarter checked");
  // a new version (an entry or a decision changed): what was kept is not read, the months before are worked out from the sums
  T.itcVer = 2;
  const p2 = await call({ action: "share_parity", book_id: BK, ym: "202512", reg: "07" }), last = T.itcParity[T.itcParity.length - 1];
  ok(p2.j.itc && p2.j.itc.same && last.p_notes.carryKept === 0, "on a new version nothing kept is read (the months before December worked out from the sums): the same");
  // the nightly runs, from nothing kept checked tonight: part A for every month at once, part B a month a run, in order,
  // each from what the run before kept (today's engine's 3B and the carried credit of the month before), then nothing
  T.itcParity = []; T.itcMonth = new Map(); T.done = [];
  const nA = T.parity.length, nightly: any[] = [];
  for (let k = 0; k < W.months.length + 3; k++) { r = await call({ action: "share_parity", book_id: BK }); nightly.push(r.j); if (!r.j.itc || !r.j.itc.checked) break; T.done = W.months.flatMap((m: string) => [{ ym: m, reg: "" }, { ym: m, reg: "07" }]); }
  const ck = T.itcParity.filter((x: any) => x.p_ok !== null);
  ok(nightly[0].same && T.parity.length - nA === W.months.length * 2 && nightly.slice(0, -1).every((x) => x.itc.checked === 1 && x.itc.same) && ck.length === W.months.length
     && ck.map((x: any) => x.p_ym).join() === W.months.join() && ck.slice(1).every((x: any) => x.p_notes.refsKept > 0) && !(nightly.at(-1).itc || {}).checked,
    "the nightly share_parity: part A every month (07 and all); part B one month a run, in order, each from the month before kept (" + ck.length + " runs), then nothing left");
  // a run over its time, or a book with more documents than a run reads: part B kept as not checked, nothing worked out
  const hb = (o: any) => handler({ env: (k) => ({ SUPABASE_URL: "http://fake.local", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon" } as any)[k], fetch: fake as any, ...o });
  const callH = async (hh: any, body: any) => { const x = await hh(new Request("http://fn.local/gst-run", { method: "POST", headers: { Authorization: "Bearer " + SERVICE, "Content-Type": "application/json" }, body: JSON.stringify(body) })); return await x.json(); };
  const mBefore = T.itcMonth.size, pBefore = T.itcParity.length;
  const s1 = await callH(hb({ total: 1 }), { action: "share_parity", book_id: BK, ym: "202512", reg: "07" });
  const s2 = await callH(hb({ itcDocs: 5 }), { action: "share_parity", book_id: BK, ym: "202512", reg: "07" });
  const sk = T.itcParity.slice(pBefore);
  ok(!(s1.itc && s1.itc.checked) && /run's/.test(String(s1.skipped || (s1.itc && s1.itc.skipped))) && /run's/.test(sk[0].p_notes.skipped) && s2.itc && s2.itc.checked === 0 && sk.length === 2 && sk.every((x: any) => x.p_ok === null && x.p_notes.skipped) && /documents/.test(sk[1].p_notes.skipped) && T.itcMonth.size === mBefore,
    "part B over the run's time, or with more documents than a run reads: kept as not checked (" + sk.map((x: any) => x.p_notes.skipped.slice(0, 40)).join("; ") + "), nothing worked out");
  // an entry not worked out yet (its month stale): checked, but nothing kept for the months after to start from
  T.due.add(W.heads[0].guid); const kBefore = JSON.stringify([...T.itcMonth.entries()]);
  const st = await call({ action: "share_parity", book_id: BK, ym: "202601", reg: "07" }), lastSt = T.itcParity[T.itcParity.length - 1];
  ok(st.j.itc.checked === 1 && lastSt.p_notes.stale.length > 0 && lastSt.p_notes.kept === false && JSON.stringify([...T.itcMonth.entries()]) === kBefore, "a month checked while an entry is not worked out yet: its carried credit not kept (gst_itc_month as it was)");
  T.due.delete(W.heads[0].guid);
  // a document that cannot be kept (a month not of six digits): that entry's error, the rest of the batch kept
  {
    const e4 = W.heads.find((x: any) => x.vtype === "Purchase" && !x.deleted_at && T.docs.has(x.guid)), was = e4.day; e4.alter_id += 2; e4.cancelled = true; e4.vno = e4.vno || "P/odd";
    T.errors = [];
    const real = RPC.gst_share_rows; RPC.gst_share_rows = (a: any) => { const p = real(a); p.heads.forEach((h: any) => { if (h[0] === e4.guid) h[1] = null; }); return p; };
    r = await call({ action: "share_sweep", book_id: BK });
    RPC.gst_share_rows = real; e4.cancelled = false; e4.alter_id += 1; e4.day = was;
    ok(r.j.ok && r.j.entries >= 1 && T.errors.some((x: any) => x.guid === e4.guid && /document/.test(x.error)), "a cancelled entry with an odd date: its document is its error, the batch kept");
    await call({ action: "share_sweep", book_id: BK });
  }
  // deployed before migration 171: the shares alone, part A's parity alone; once 171 is there, every entry swept again
  // with its document; and a put of the documents not found after the mark (a stale schema cache): the mark taken away
  const keep = { put: RPC.gst_share_put_itc, ready: RPC.gst_itc_ready, book: RPC.gst_itc_book, mark: RPC.gst_itc_mark, unmark: RPC.gst_itc_unmark };
  delete RPC.gst_share_put_itc; delete RPC.gst_itc_ready; delete RPC.gst_itc_book; delete RPC.gst_itc_mark; delete RPC.gst_itc_unmark;
  T.docs = new Map(); T.itcMarked = false;
  const e3 = W.heads.find((x: any) => x.vtype === "Purchase" && !x.deleted_at && T.shares.has(x.guid)); e3.alter_id += 3;
  r = await call({ action: "share_sweep", book_id: BK });
  const p3 = await call({ action: "share_parity", book_id: BK, ym: "202504", reg: "07" });
  ok(r.j.ok && r.j.itc === false && r.j.entries === 1 && p3.j.ok && p3.j.same && p3.j.itc === null && T.docs.size === 0, "without migration 171: the sweep keeps the shares alone (itc false), the parity checks part A alone");
  Object.assign(RPC, { gst_share_put_itc: keep.put, gst_itc_ready: keep.ready, gst_itc_book: keep.book, gst_itc_mark: keep.mark, gst_itc_unmark: keep.unmark });
  const sw3: any[] = [];
  for (let k = 0; k < 20; k++) { r = await call({ action: "share_sweep", book_id: BK, limit: 1000 }); sw3.push(r.j); if (!r.j.ok || !r.j.more) break; }
  ok(sw3[0].itcMark === true && T.due.size === 0 && [...T.docs.values()].filter((d: any) => d.doc).length === withDoc, "171 there afterwards: the book marked, every entry swept again, every document kept (" + T.docs.size + ")");
  delete RPC.gst_share_put_itc; e3.alter_id += 1;
  r = await call({ action: "share_sweep", book_id: BK });
  ok(r.j.ok && r.j.itc === false && T.itcMarked === false, "the put of the documents not found though the book was marked (a stale schema cache): the shares kept, the mark taken away");
  RPC.gst_share_put_itc = keep.put;
  r = await call({ action: "share_sweep", book_id: BK });
  ok(r.j.itcMark === true && T.itcMarked === true, "and the next run marks it again (every entry due once more)");
}
console.log(fails ? fails + " FAILED" : "all ok");
Deno.exit(fails ? 1 : 0);
