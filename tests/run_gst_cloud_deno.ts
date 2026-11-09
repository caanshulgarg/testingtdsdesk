// deno run --allow-read --allow-env --allow-write tests/run_gst_cloud_deno.ts IN.json OUT.json - the gst-run function
// (server/gst-run/handler.ts) with a fake Supabase (REST as PostgREST reads it, the user check, gst_calc_version), on the
// made-up client tests/run_gst_cloud.js writes. Called by tests/run_gst_cloud.js; nothing of a real database.
import { handler } from "../server/gst-run/handler.ts";

const [inFile, outFile] = Deno.args;
const IN = JSON.parse(await Deno.readTextFile(inFile));
const rows = IN.rows, FIRM = IN.firm, OTHER = "f1530000-0000-4000-8000-000000000002";
const USER = "u1530000-0000-4000-8000-00000000000a", OUTSIDER = "u1530000-0000-4000-8000-00000000000b";
const T: Record<string, any[]> = {
  members: [{ user_id: USER, firm_id: FIRM, role: "viewer", active: true }],
  clients: [{ id: rows.client, firm_id: FIRM, data: rows.co, deleted: false }, { id: "cli-other", firm_id: OTHER, data: { name: "Another Firm's Client" }, deleted: false }],
  firms: [{ id: FIRM, status: "active" }], subscriptions: [],
  tally_books: [rows.book],
  tally_vouchers: rows.heads.map((h: any) => ({ ...h, book_id: rows.book.book_id })),
  tally_lines: rows.lines.map((l: any, i: number) => ({ ...l, id: i + 1, book_id: rows.book.book_id })),
  tally_bills: rows.bills.map((l: any, i: number) => ({ ...l, id: i + 1, book_id: rows.book.book_id })),
  tally_ledgers: rows.ledgers.map((l: any) => ({ ...l, book_id: rows.book.book_id, merged_into: null })),
  tally_groups: rows.groups.map((l: any) => ({ ...l, book_id: rows.book.book_id })),
  client_book_items: rows.items.map((r: any) => ({ ...r, firm_id: FIRM, client_id: rows.client })),
  records: rows.sales.map((d: any) => ({ firm_id: FIRM, client_id: rows.client, kind: "sales", id: rows.client + ":" + d.id, data: d, deleted: false })),
  gst_2b_runs: Object.entries(rows.runs).map(([k, r]: [string, any]) => ({ id: r.id, firm_id: FIRM, client_id: rows.client, gstin: k.split("|")[0], fy: k.split("|")[1], status: "done", done_at: r.at, queued_at: r.at, result: r.result })),
  gst_2b_decisions: [], tally_calc_results: [],
};
let reads = 0;
// PostgREST's filters as the function writes them
const pass = (row: any, k: string, v: string) => {
  const x = row[k];
  if (v.startsWith("eq.")) return String(x) === v.slice(3);
  if (v.startsWith("lte.")) return String(x) <= v.slice(4);
  if (v === "is.null") return x == null; if (v === "not.is.null") return x != null;
  if (v === "is.false") return x === false; if (v === "is.true") return x === true;
  if (v.startsWith("in.(")) return v.slice(4, -1).split(",").map((s) => s.replace(/^"|"$/g, "")).includes(String(x));
  throw new Error("filter " + k + "=" + v);
};
const version = () => { const s = JSON.stringify([T.tally_vouchers, T.tally_lines, T.tally_bills, T.tally_ledgers, T.client_book_items, T.clients, T.records, T.gst_2b_runs, T.gst_2b_decisions]); let h = 0; for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0; return "v" + (h >>> 0).toString(16) + ":" + s.length; };
const fake = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const u = new URL(String(input)), auth = String((init?.headers as any)?.Authorization || "");
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  if (u.pathname === "/auth/v1/user") { const t = auth.replace("Bearer ", ""); return t === "tok-member" ? json({ id: USER }) : t === "tok-outsider" ? json({ id: OUTSIDER }) : json({ msg: "bad jwt" }, 401); }
  if (auth !== "Bearer service-key") return json({ message: "service role only here" }, 401);
  if (u.pathname === "/rest/v1/rpc/gst_calc_version") return json(version());
  const table = u.pathname.replace("/rest/v1/", "");
  if (!T[table]) return json({ message: "relation " + table + " does not exist" }, 404);
  if ((init?.method || "GET") === "POST") {
    const add = JSON.parse(String(init!.body));
    add.forEach((r: any) => { const i = T[table].findIndex((x) => x.book_id === r.book_id && x.kind === r.kind && x.args === r.args); if (i >= 0) T[table][i] = r; else T[table].push(r); });
    return new Response(null, { status: 201 });
  }
  reads++;
  let out = T[table];
  const p = u.searchParams; let limit = Infinity, offset = 0, order = "";
  for (const [k, v] of p.entries()) {
    if (k === "select") continue; if (k === "limit") { limit = +v; continue; } if (k === "offset") { offset = +v; continue; } if (k === "order") { order = v; continue; }
    out = out.filter((r) => pass(r, k, v));
  }
  if (order) { const cols = order.split(",").map((c) => c.split(".")); out = out.slice().sort((a, b) => { for (const [c, d] of cols) { const x = a[c], y = b[c]; if (x === y) continue; const r = (x ?? "") < (y ?? "") ? -1 : 1; return d === "desc" ? -r : r; } return 0; }); }
  return json(out.slice(offset, offset + limit));
};
const env: Record<string, string> = { SUPABASE_URL: "https://fake.example", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" };
const h = handler({ env: (k) => env[k], fetch: fake as typeof fetch });
const call = async (body: unknown, tok = "tok-member") => { const r = await h(new Request("https://fake.example/functions/v1/gst-run", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: "https://staging.fincom.live" }, body: JSON.stringify(body) })); return { status: r.status, ...(await r.json()) }; };
const out: any = {};
if (IN.timing) {
  // best of three, each on a fresh cache (kept answers cleared)
  let best: any = null;
  for (let i = 0; i < 3; i++) {
    T.tally_calc_results = [];
    const t0 = performance.now(), r = await call({ action: "month", client_id: rows.client, reg: "07", ym: IN.asks[0].ym }), ms = Math.round(performance.now() - t0);
    if (!r.ok) throw new Error(JSON.stringify(r));
    const n = T.tally_calc_results.length;
    if (!best || ms < best.ms) best = { ms, engineMs: r.ms, months: n, perMonth: Math.round(ms / n), result: r.months[0].result };
  }
  // what the request spent on the books and the engine alone (no fake REST), for the record
  const { run } = await import("../server/gst-run/engine.js");
  const t1 = performance.now(), e = run(rows, [{ reg: "07", ym: IN.asks[0].ym }]);
  Object.assign(out, best, { booksMs: e.booksMs, engineOnlyMs: Math.round(performance.now() - t1) });
} else {
  out.calls = [];
  for (const a of IN.asks) out.calls.push({ ym: a.ym, ...(await call({ action: "month", client_id: rows.client, reg: a.reg, ym: a.ym })) });
  out.kept = T.tally_calc_results.map((k) => ({ args: k.args, result: k.result, version: k.version }));
  const r0 = reads; out.again = [];
  for (const a of IN.asks) out.again.push(await call({ action: "month", client_id: rows.client, reg: a.reg, ym: a.ym }));
  out.againReads = reads - r0;
  // a new entry in the books: the version moves, the month is worked out again
  T.tally_vouchers.push({ ...T.tally_vouchers[0], guid: "syn-new-1", alter_id: 999999, day: "2026-03-30" });
  out.changed = await call({ action: "month", client_id: rows.client, reg: "07", ym: "202603" });
  out.other = await call({ action: "month", client_id: "cli-other", reg: "07", ym: "202603" });
  out.noauth = await call({ action: "month", client_id: rows.client, reg: "07", ym: "202603" }, "");
  out.nomember = await call({ action: "month", client_id: rows.client, reg: "07", ym: "202603" }, "tok-outsider");
}
await Deno.writeTextFile(outFile, JSON.stringify(out));
