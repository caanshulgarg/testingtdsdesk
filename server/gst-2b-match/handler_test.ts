// deno test server/gst-2b-match/handler_test.ts (run by tests/run_2b_automatch_server.py). The gst-2b-match function's
// handler against a fake Supabase (an in-memory PostgREST, auth and the functions of migrations 77 and 95) and a fake
// Claude (never the real API):
//   1. the app's run: inputs kept, the rules and ONE AI call, the run kept with its line and cost; the same inputs again:
//      the last run answered, no new call; "Match again": a new run and a new call
//   2. AI off (the app's AI help off, or the firm's switch off): no call, the rules stand, said so
//   3. the trigger after a fetch: gst-taxpro's queued run (service key) runs with the 2B fetched on the server; anyone else
//      is refused
//   4. a person's accept: kept, the pair matched, no AI call; a look-only member cannot decide and gets the last run
//   5. a client of another firm is refused
import { handler } from "./handler.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

const FIRM = "f-1", OWNER = "u-1", VIEWER = "u-2", SERVICE = "service-key", G = "09AANFG3202D1ZR", S1 = "09AAACB1234C1Z5";
type Row = Record<string, any>;
function fakeSupabase() {
  const T: Record<string, Row[]> = { members: [{ user_id: OWNER, firm_id: FIRM, role: "owner", active: true }, { user_id: VIEWER, firm_id: FIRM, role: "viewer", active: true }],
    clients: [{ id: "c-1", firm: FIRM, deleted: false }, { id: "c-x", firm: "f-2", deleted: false }], assistant_settings: [], platform_secrets: [{ name: "claude_api_key", value: "sk-test" }],
    gst_returns: [], gst_2b_inputs: [], gst_2b_runs: [], gst_2b_decisions: [] };
  const PK: Record<string, string[]> = { gst_2b_inputs: ["firm_id", "gstin", "fy", "side", "period"], gst_2b_decisions: ["firm_id", "gstin", "fy", "pair_id"] };
  const users: Record<string, string> = { "jwt-owner": OWNER, "jwt-viewer": VIEWER };
  const calls: string[] = [];
  let seq = 0;
  const match = (r: Row, qs: URLSearchParams) => {
    for (const [k, v] of qs) {
      if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
      const [op, ...rest] = v.split("."); const val = rest.join(".");
      if (op === "eq" && String(r[k]) !== val) return false;
      if (op === "in" && !val.replace(/^\(|\)$/g, "").split(",").includes(String(r[k]))) return false;
    }
    return true;
  };
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(input)), method = (init.method || "GET").toUpperCase(), auth = String((init.headers as any)?.Authorization || "").replace("Bearer ", "");
    const out = (code: number, j: unknown) => new Response(JSON.stringify(j), { status: code });
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push(method + " " + u.pathname);
    if (u.pathname === "/auth/v1/user") return users[auth] ? out(200, { id: users[auth] }) : out(401, { message: "bad token" });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop()!;
      if (fn === "mfa_ok") return out(200, true);
      if (fn === "gst_cron_ok") return out(200, body.k === "cron-key");
      if (fn === "asst_cap_take") return out(200, { ok: true, cap_inr: 3000, spent_inr: 0, period: "month" });
      if (fn === "asst_cost_add") return out(200, { inr: Math.round(body.p_cost_usd * 85 * 10000) / 10000 });
      if (fn === "asst_log_add") { (T.assistant_log = T.assistant_log || []).push(body); return out(200, null); }
      if (fn === "gst2b_take") { const rs = T.gst_2b_runs.filter((r) => r.status === "queued").slice(0, body.p_n); rs.forEach((r) => { r.status = "running"; }); return out(200, rs); }
      return out(404, { message: "no function " + fn });
    }
    const table = u.pathname.replace("/rest/v1/", "");
    if (!T[table]) return out(404, { message: "no table " + table });
    if (table === "clients" && auth !== SERVICE) {        // row-level security: the user's own firm only
      const firmOf = T.members.find((m) => m.user_id === users[auth])?.firm_id;
      return out(200, T.clients.filter((c) => c.firm === firmOf && match(c, u.searchParams)));
    }
    if (["gst_2b_inputs", "gst_2b_runs", "gst_2b_decisions", "gst_returns", "platform_secrets", "assistant_settings", "members"].includes(table) && auth !== SERVICE) return out(403, { message: "permission denied" });
    if (method === "GET") {
      let rows = T[table].filter((r) => match(r, u.searchParams));
      if (u.searchParams.get("order") === "id.desc") rows = rows.slice().sort((a, c) => c.id - a.id);
      if (u.searchParams.get("limit")) rows = rows.slice(0, +u.searchParams.get("limit")!);
      return out(200, rows.map((r) => structuredClone(r)));
    }
    if (method === "POST") {
      const list = Array.isArray(body) ? body : [body], made: Row[] = [];
      for (const x of list) {
        const pk = PK[table];
        const had = pk && T[table].find((r) => pk.every((k) => r[k] === x[k]));
        if (had) Object.assign(had, x); else { const r = { ...(table === "gst_2b_runs" ? { id: ++seq, queued_at: new Date().toISOString() } : {}), ...x }; T[table].push(r); made.push(r); }
      }
      return out(201, made);
    }
    if (method === "PATCH") { const rows = T[table].filter((r) => match(r, u.searchParams)); rows.forEach((r) => Object.assign(r, body)); return out(200, rows); }
    return out(405, {});
  };
  return { T, fetch: fetch as typeof globalThis.fetch, calls };
}
class FakeClaude {
  calls: any[] = [];
  beta = { messages: { stream: (p: any) => {
    this.calls.push(p);
    const txt = String(p.messages[0].content), g = JSON.parse(txt.split("\n")[1]), b = JSON.parse(txt.split("\n")[3]);
    const pairs = g.map((x: any) => { const last = (n: string) => (String(n).match(/\d+/g) || []).pop();
      const y = b.find((z: any) => z.taxable === x.taxable && z.igst === x.igst) || b.find((z: any) => last(z.no) === last(x.no)); return y && { g: [x.id], b: [y.id], kind: "typo", reason: "number written differently", confidence: "high" }; }).filter(Boolean);
    const msg = { content: [{ type: "text", text: JSON.stringify({ pairs }) }], usage: { input_tokens: 3000, output_tokens: 600 }, stop_reason: "end_turn" };
    return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => msg };
  } } };
}
const doc = (key: string, no: string, date: string, taxable: number, igst: number) => ({ key, gstin: S1, party: "Bharat Steel", no, date, ym: date.slice(0, 6), dir: 1, taxable, igst, cgst: 0, sgst: 0, cess: 0 });
const ent = (id: string, no: string, date: string, taxable: number, igst: number) => ({ id, gstin: S1, party: "Bharat Steel", no, date, ym: date.slice(0, 6), voucher: "P-" + id, dir: 1, taxable, igst, cgst: 0, sgst: 0, cess: 0 });
const BOOKS = [ent("v1", "INV-1", "20260905", 10000, 1800), ent("v2", "77", "20260911", 7000, 1260), ent("v3", "95", "20260915", 2500, 450), ent("v4", "OCT-5", "20261005", 4000, 720)];
const TWOB = [{ period: "092026", rows: [doc("092026|b2b|k1", "INV/0001", "20260906", 10000, 1800), doc("092026|b2b|k2", "SB/2026/77", "20260910", 7000, 1260), doc("092026|b2b|k3", "INV-95", "20260915", 3000, 540)] }];

function setup() {
  const sb = fakeSupabase(), ai = new FakeClaude();
  const h = handler({ env: (k) => ({ SUPABASE_URL: "http://sb", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon" } as Record<string, string>)[k], fetch: sb.fetch, anthropic: () => ai });
  const call = async (body: unknown, token = "jwt-owner", headers: Record<string, string> = {}) => {
    const r = await h(new Request("http://fn/", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }));
    return { status: r.status, j: await r.json() };
  };
  return { sb, ai, call };
}
const RUN = (x: Record<string, unknown> = {}) => ({ action: "run", client_id: "c-1", gstin: G, fy: "2026-27", why: "uploaded", ai: true, books: BOOKS, twob: TWOB, ...x });

Deno.test("1. the app's run: inputs kept, rules then ONE AI call, the run kept; the same again: no new call; Match again: a new one", async () => {
  const { sb, ai, call } = setup();
  const r = await call(RUN());
  eq(r.status, 200, "ok"); assert(r.j.ok, JSON.stringify(r.j));
  eq(sb.T.gst_2b_inputs.map((x) => x.side + ":" + x.period + ":" + x.n), ["books::4", "2b:092026:3"], "the purchases and the 2B kept");
  eq(ai.calls.length, 1, "one AI call");
  eq(r.j.run.line, "2 matched (1 by rules, 1 by AI) · 1 to look at · 1 in books only · 0 in 2B only", "the line");
  eq(r.j.run.ai.state, "used", "AI used"); assert(/cost ₹1\.02/.test(r.j.run.ai.say), "the cost in the run line: " + r.j.run.ai.say);
  eq(sb.T.gst_2b_runs[0].why, "uploaded", "why it ran"); eq(sb.T.gst_2b_runs[0].status, "done", "done");
  assert(!JSON.stringify(sb.T.assistant_log).includes("Bharat"), "the log keeps no supplier");
  const again = await call(RUN({ why: "new entries" }));
  eq([again.j.same, ai.calls.length, sb.T.gst_2b_runs.length], [true, 1, 1], "nothing changed: the last run, no new call");
  const more = await call(RUN({ why: "match again" }));
  eq([more.j.same, ai.calls.length, sb.T.gst_2b_runs.length], [false, 2, 2], "Match again: a new run, one more call");
});

Deno.test("2. AI off in the app, or the firm's switch off: no call, the rules stand and say so", async () => {
  const a = setup();
  const r = await a.call(RUN({ ai: false }));
  eq([a.ai.calls.length, r.j.run.ai.state, r.j.run.counts.byRules], [0, "off", 1], "AI help off: rules only");
  const b = setup(); b.sb.T.assistant_settings.push({ firm_id: FIRM, enabled: false });
  const r2 = await b.call(RUN());
  eq([b.ai.calls.length, r2.j.run.ai.state], [0, "off"], "the firm's switch off: rules only");
  assert(/rules' result stands/.test(r2.j.run.ai.say), r2.j.run.ai.say);
});

Deno.test("3. after a 2B is fetched: the queued run (gst-taxpro, service key) runs with the 2B fetched on the server", async () => {
  const { sb, ai, call } = setup();
  await call(RUN());
  // October's 2B fetched on the server (the portal's JSON in gst_returns) and a run queued by gst2b_enqueue
  sb.T.gst_returns.push({ firm_id: FIRM, gstin: G, form: "2B", period: "102026", status: "ok", data: { gstin: G, rtnprd: "102026", docdata: { b2b: [{ ctin: S1, trdnm: "Bharat Steel", inv: [{ inum: "OCT/0005", dt: "05-10-2026", txval: 4000, igst: 720 }] }] } } });
  sb.T.gst_2b_runs.push({ id: 99, firm_id: FIRM, client_id: "c-1", gstin: G, fy: "2026-27", why: "fetched", status: "queued" });
  const no = await call({ action: "queue" }, "jwt-owner");
  eq(no.status, 401, "a member cannot run the queue");
  const r = await call({ action: "queue" }, SERVICE);
  eq([r.status, r.j.done], [200, 1], "the queued run done");
  const run = sb.T.gst_2b_runs.find((x) => x.id === 99)!;
  eq(run.status, "done", "kept as done");
  assert(run.result.portal.includes("102026") && run.result.rows.some((x: any) => x.st === "matched-rules" && x.b.includes("v4")), "OCT/0005 fetched on the server matched with OCT-5 by the rules");
  eq(ai.calls.length, 2, "one AI call for that run");
  const t = await call({ action: "queue" }, "", { "x-cron-key": "cron-key" });
  eq([t.status, t.j.done], [200, 0], "the timer's key is taken too (nothing waiting)");
});

Deno.test("4. accept: kept, matched, no AI call; a look-only member cannot decide and gets the last run", async () => {
  const { sb, ai, call } = setup();
  const r = await call(RUN());
  const p = r.j.run.result.rows.find((x: any) => x.st === "probable");
  assert(p, "a probable pair");
  const v = await call({ action: "decide", client_id: "c-1", gstin: G, fy: "2026-27", pairs: [p.id], decision: "accept" }, "jwt-viewer");
  eq(v.status, 403, "a look-only member cannot decide");
  const d = await call({ action: "decide", client_id: "c-1", gstin: G, fy: "2026-27", pairs: [p.id], decision: "accept" });
  eq(sb.T.gst_2b_decisions.map((x) => x.decision), ["accept"], "kept");
  const row = d.j.run.result.rows.find((x: any) => x.id === p.id);
  eq([row.st, row.accepted, ai.calls.length, d.j.run.why], ["matched-ai", true, 1, "decided"], "matched, no new AI call");
  eq(d.j.run.line, "3 matched (1 by rules, 2 by AI) · 0 to look at · 1 in books only · 0 in 2B only", "the line after accepting");
  const lv = await call(RUN(), "jwt-viewer");
  eq([lv.j.run.id, sb.T.gst_2b_runs.length, ai.calls.length], [d.j.run.id, 2, 1], "a look-only member's run: the last run, nothing run");
});

Deno.test("5. a client of another firm is refused", async () => {
  const { call } = setup();
  const r = await call(RUN({ client_id: "c-x" }));
  eq(r.status, 403, "refused");
});
