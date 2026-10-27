// deno test server/tds-challan-match/handler_test.ts (run by tests/run_tds_challan_match_server.py). The tds-challan-match
// function against a fake Supabase (auth, members, clients, the assistant's switch, cap, cost and log) and a fake Claude
// (never the real API):
//   1. ONE call with only the leftovers' agreed fields (the PAN masked, no other field); valid pairings come back; an
//      invalid one (an id not sent, a deduction twice) and one over a challan's balance are refused by the code; the cost
//      and one log line without names
//   2. AI off in the app, or the firm's switch off: no call, the rules stand, said so
//   3. over the month's rupee cap: no call, said so
//   4. a look-only member, another firm's client, no sign-in: refused
import { handler } from "./handler.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
const FIRM = "f-1", OWNER = "u-1", VIEWER = "u-2", SERVICE = "service-key";
type Row = Record<string, any>;
function fakeSupabase(opt: { cap?: boolean } = {}) {
  const T: Record<string, Row[]> = { members: [{ user_id: OWNER, firm_id: FIRM, role: "owner", active: true }, { user_id: VIEWER, firm_id: FIRM, role: "viewer", active: true }],
    clients: [{ id: "c-1", firm: FIRM, deleted: false }, { id: "c-x", firm: "f-2", deleted: false }], assistant_settings: [], platform_secrets: [{ name: "claude_api_key", value: "sk-test" }], log: [], cost: [] };
  const users: Record<string, string> = { "jwt-owner": OWNER, "jwt-viewer": VIEWER };
  const fetch = async (input: string | URL | Request, init: RequestInit = {}) => {
    const u = new URL(String(input)), auth = String((init.headers as any)?.Authorization || "").replace("Bearer ", "");
    const out = (code: number, j: unknown) => new Response(JSON.stringify(j), { status: code });
    const body = init.body ? JSON.parse(String(init.body)) : null;
    if (u.pathname === "/auth/v1/user") return users[auth] ? out(200, { id: users[auth] }) : out(401, { message: "bad token" });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = u.pathname.split("/").pop()!;
      if (fn === "mfa_ok") return out(200, true);
      if (fn === "asst_cap_take") return out(200, opt.cap ? { ok: false, why: "cap" } : { ok: true });
      if (fn === "asst_cost_add") { T.cost.push(body); return out(200, { inr: Math.round(body.p_cost_usd * 85 * 10000) / 10000 }); }
      if (fn === "asst_log_add") { T.log.push(body); return out(200, null); }
      return out(404, { message: "no function " + fn });
    }
    const table = u.pathname.replace("/rest/v1/", ""), want = (r: Row) => [...u.searchParams].every(([k, v]) => k === "select" || String(r[k]) === v.replace(/^eq\./, ""));
    if (table === "clients" && auth !== SERVICE) { const firmOf = T.members.find((m) => m.user_id === users[auth])?.firm_id; return out(200, T.clients.filter((c) => c.firm === firmOf && want(c))); }
    if (auth !== SERVICE) return out(403, { message: "permission denied" });
    return out(200, (T[table] || []).filter(want));
  };
  return { T, fetch: fetch as typeof globalThis.fetch };
}
// the fake Claude: pairs each deduction with the challan of the same section whose balance holds it; plus one pairing
// naming an id not sent, the first deduction a second time, and one over a challan's balance
class FakeClaude {
  calls: any[] = [];
  beta = { messages: { stream: (p: any) => {
    this.calls.push(p);
    const txt = String(p.messages[0].content), d = JSON.parse(txt.split("\n")[1]), c = JSON.parse(txt.split("\n")[3]);
    const left: Record<string, number> = {}; c.forEach((x: any) => { left[x.id] = Math.round(x.balance * 100); });
    const pairs: any[] = [];
    d.forEach((x: any) => { const y = c.find((z: any) => z.section.slice(0, 4) === x.section.slice(0, 4) && left[z.id] >= Math.round(x.tds * 100)); if (y) { left[y.id] -= Math.round(x.tds * 100); pairs.push({ challan: y.id, rows: [x.id], reason: "same month, the section written differently", confidence: "high" }); } });
    pairs.push({ challan: "C99", rows: [d[0].id], reason: "not sent", confidence: "high" }, { challan: c[0].id, rows: [d[0].id], reason: "twice", confidence: "high" });
    const big = d.find((x: any) => !pairs.some((p) => p.rows.includes(x.id)));
    if (big) pairs.push({ challan: c[0].id, rows: [big.id], reason: "over its balance", confidence: "low" });
    const msg = { content: [{ type: "text", text: JSON.stringify({ pairs, splits: [], interest: [] }) }], usage: { input_tokens: 2000, output_tokens: 400 }, stop_reason: "end_turn" };
    return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => msg };
  } } };
}
const ROWS = [{ id: "v1|TDS 194J", sec: "194JA", date: "20260610", tds: 3000, party: "Gamma Consultants", pan: "ABCPG1234G", fy: "2026-27", q: "Q1", secret: "x" },
  { id: "v2|TDS 194J", sec: "194JA", date: "20260612", tds: 2000, party: "Delta", pan: "ABCPD1234D", fy: "2026-27", q: "Q1" },
  { id: "v3|TDS 194C", sec: "194C", date: "20260615", tds: 9000, party: "Epsilon", pan: "ABCPE1234E", fy: "2026-27", q: "Q1" }];
const CHS = [{ id: "chJB", sec: "194JB", date: "20260707", minor: "200", bal: 5000, fy: "2026-27", bsr: "0240020", serial: "00011", narr: "TDS June professional fees" },
  { id: "chC", sec: "194C", date: "20260707", minor: "200", bal: 1000, fy: "2026-27", bsr: "0240020", serial: "00012", narr: "" }];
function setup(opt: { cap?: boolean } = {}) {
  const sb = fakeSupabase(opt), ai = new FakeClaude();
  const h = handler({ env: (k) => ({ SUPABASE_URL: "http://sb", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon" } as Record<string, string>)[k], fetch: sb.fetch, anthropic: () => ai });
  const call = async (body: unknown, token = "jwt-owner") => {
    const r = await h(new Request("http://fn/", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
    return { status: r.status, j: await r.json() };
  };
  return { sb, ai, call };
}
const ASK = (x: Record<string, unknown> = {}) => ({ action: "suggest", client_id: "c-1", form: "26Q", fy: "2026-27", q: "Q1", ai: true, rows: ROWS, challans: CHS, ...x });

Deno.test("1. one call, only the agreed fields; valid pairings back, invalid and over-use refused; cost and a log without names", async () => {
  const { sb, ai, call } = setup();
  const r = await call(ASK());
  eq(r.status, 200, "ok"); assert(r.j.ok, JSON.stringify(r.j));
  eq(ai.calls.length, 1, "one AI call");
  eq(ai.calls[0].model, "claude-sonnet-5-5", "Sonnet");
  const sent = String(ai.calls[0].messages[0].content);
  assert(!sent.includes("ABCPG1234G") && sent.includes("******234G") && !sent.includes("secret") && !sent.includes("v1|TDS"), "the PAN masked, only the agreed fields, no ids of the books: " + sent.slice(0, 300));
  eq(r.j.pairs.map((p: any) => [p.chId, p.ids]), [["chJB", ["v1|TDS 194J"]], ["chJB", ["v2|TDS 194J"]]], "the valid pairings (194JA on the 194JB challan)");
  assert(r.j.ai.state === "used" && r.j.ai.bad === 2 && r.j.ai.dropped === 1, "an id not sent and a deduction twice dropped (2), the one over the balance refused (1): " + JSON.stringify(r.j.ai));
  assert(/2 suggested/.test(r.j.ai.say) && /3 of its pairings refused/.test(r.j.ai.say), r.j.ai.say);
  eq(sb.T.cost.map((x) => x.p_feature), ["tds_match"], "the cost as feature tds_match");
  eq(sb.T.log.length, 1, "one log line");
  assert(!JSON.stringify(sb.T.log).includes("Gamma") && !JSON.stringify(sb.T.log).includes("3000"), "the log keeps no name or figure of the books");
});

Deno.test("2. AI off in the app, or the firm's switch off: no call, the rules stand", async () => {
  const a = setup();
  const r = await a.call(ASK({ ai: false }));
  eq([a.ai.calls.length, r.j.ai.state, r.j.pairs.length], [0, "off", 0], "AI help off: no call");
  const b = setup(); b.sb.T.assistant_settings.push({ firm_id: FIRM, enabled: false });
  const r2 = await b.call(ASK());
  eq([b.ai.calls.length, r2.j.ai.state], [0, "off"], "the firm's switch off: no call");
  assert(/rules' suggestions stand/.test(r2.j.ai.say), r2.j.ai.say);
});

Deno.test("3. over the month's rupee cap: no call, said so", async () => {
  const { ai, call } = setup({ cap: true });
  const r = await call(ASK());
  eq([ai.calls.length, r.j.ai.state], [0, "cap"], "no call");
  assert(/budget for this month is used up/.test(r.j.ai.say), r.j.ai.say);
});

// next-tds-match-fast (27-Oct-2026: 7 to 11 s a call on staging): the checks before the AI go in waves, not one by one
Deno.test("5. the checks before the AI in at most 4 waves (were 7 one after another); 9 round trips in all became 6", async () => {
  const { sb } = setup();
  let inflight = 0, waves = 0, most = 0, aiAt = -1;
  const slow = sb.fetch;
  const h = handler({ env: (k) => ({ SUPABASE_URL: "http://sb", SUPABASE_SERVICE_ROLE_KEY: SERVICE, SUPABASE_ANON_KEY: "anon" } as Record<string, string>)[k],
    fetch: (async (i: any, o: any) => { if (!inflight) waves++; inflight++; most = Math.max(most, inflight); await new Promise((r) => setTimeout(r, 15)); try { return await slow(i, o); } finally { inflight--; } }) as typeof fetch,
    anthropic: () => { const f = new FakeClaude(); const s = f.beta.messages.stream; f.beta.messages.stream = (p: any) => { aiAt = waves; return s(p); }; return f; } });
  const r = await h(new Request("http://fn/", { method: "POST", headers: { Authorization: "Bearer jwt-owner" }, body: JSON.stringify(ASK()) }));
  const j = await r.json();
  assert(j.ok && j.ai.state === "used", JSON.stringify(j).slice(0, 300));
  assert(aiAt >= 1 && aiAt <= 4, "the checks and the cap before the AI in at most 4 waves (were 7): " + aiAt);
  assert(waves <= 6 && most >= 3, "waves " + waves + ", most at once " + most);
  // the refusals are as before
  const s2 = setup();
  eq((await s2.call(ASK(), "jwt-viewer")).status, 403, "look-only still refused");
  eq((await s2.call(ASK({ action: "x" }))).status, 400, "unknown request");
  eq((await s2.call(ASK({ fy: "26" }))).status, 400, "no year");
  eq(s2.ai.calls.length, 0, "no AI call on a refusal");
});

Deno.test("4. a look-only member, another firm's client, no sign-in: refused", async () => {
  const { ai, call } = setup();
  eq((await call(ASK(), "jwt-viewer")).status, 403, "look-only");
  eq((await call(ASK({ client_id: "c-x" }))).status, 403, "another firm's client");
  eq((await call(ASK(), "")).status, 401, "not signed in");
  eq(ai.calls.length, 0, "no call");
});
