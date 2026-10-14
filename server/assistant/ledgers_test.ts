// deno test server/assistant/ledgers_test.ts (run by tests/run_ledger_confirm_server.py). The AI guess for TDS and GST
// ledgers (ledgers.ts) with Claude FAKED: one batch on Haiku, identifiers and parties masked and put back, each ledger's
// answer cached (a second ask costs nothing), the firm's cap taken first (no call over it), only the names asked kept,
// and the cost of 100 ledgers worked out from the size of the batch.
import { cleanIn, guessLedgers, LEDGER_GUESS_V, parseGuesses, SYSTEM_LEDGERS } from "./ledgers.ts";
import { costUsd, HAIKU } from "./models.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

// Claude, faked: answers every ledger it is sent from a table by name (masked names as they come)
class FakeClaude {
  calls: Record<string, unknown>[] = [];
  constructor(public answer: (names: string[]) => Record<string, unknown>[], public usage = (n: number) => ({ input_tokens: 700 + n * 150, output_tokens: n * 60 })) {}
  beta = { messages: { stream: (p: Record<string, unknown>) => {
    this.calls.push(p);
    const sent = JSON.parse(String((p.messages as any[])[0].content).replace(/^The ledgers:\n/, "")) as { name: string }[];
    const msg = { content: [{ type: "text", text: JSON.stringify({ ledgers: this.answer(sent.map((l) => l.name)) }) }], usage: this.usage(sent.length) };
    return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => msg };
  } } };
}
function store() {
  const rows: Record<string, any> = {};
  return { rows, cacheGet: async (keys: string[]) => Object.fromEntries(keys.filter((k) => rows[k]).map((k) => [k, rows[k]])),
    cachePut: async (put: { key: string, guess: any }[]) => { put.forEach((x) => { rows[x.key] = x.guess; }); } };
}
const L = (name: string, extra: Record<string, unknown> = {}) => ({ name, group: "Duties & Taxes", chain: ["Duties & Taxes", "Current Liabilities"], open: 0, taxType: "Others", nature: "", use: "3 entries", samples: [], ...extra });

Deno.test("one batch on Haiku; the guesses come back by name with their reasons", async () => {
  const c = new FakeClaude((names) => names.map((n) => ({ name: n, kind: /PAYABLE/.test(n) ? "tds_payable" : "gst_input", head: "", rate: null, section: /194C/.test(n) ? "194C" : "", confidence: "medium", reason: "read from the name " + n })));
  const st = store();
  const r = await guessLedgers({ client: c, capTake: async () => ({ ok: true }), ...st }, [L("TDS PAYABLE CONTRACTOR 194C"), L("Input Misc")], []);
  eq(c.calls.length, 1, "one call");
  eq((c.calls[0] as any).model, HAIKU, "the cheap model");
  eq((c.calls[0] as any).output_config, { effort: "low" }, "low effort");
  assert(String(((c.calls[0] as any).system || [])[0].text) === SYSTEM_LEDGERS, "the ledger system prompt");
  eq(((c.calls[0] as any).system || [])[0].cache_control, { type: "ephemeral", ttl: "1h" }, "the system prompt cached");
  eq(r.asked, 2, "two asked"); eq(r.cached, 0, "none cached");
  eq(r.guesses.map((g) => [g.name, g.kind, g.section]), [["TDS PAYABLE CONTRACTOR 194C", "tds_payable", "194C"], ["Input Misc", "gst_input", ""]], "the guesses");
  assert(r.usd > 0, "a cost");
});

Deno.test("identifiers and parties masked going out, put back coming in", async () => {
  const c = new FakeClaude((names) => names.map((n) => ({ name: n, kind: "not_tax", head: "", rate: null, section: "", confidence: "low", reason: "entries with PARTY_1 and GSTIN_1 only" })));
  const st = store();
  const r = await guessLedgers({ client: c, capTake: async () => ({ ok: true }), ...st },
    [L("GST 07AAACS1234K1Z5 Adj", { samples: ["20250405 Purchase Dr 1800 | Dr GST 07AAACS1234K1Z5 Adj 1800, Cr Sharma Traders 11800"] })], ["Sharma Traders"]);
  const sent = String((c.calls[0] as any).messages[0].content);
  assert(!sent.includes("07AAACS1234K1Z5"), "no GSTIN sent: " + sent);
  assert(!sent.includes("Sharma Traders"), "no party name sent: " + sent);
  assert(sent.includes("GSTIN_1") && sent.includes("PARTY_1"), "the tokens sent");
  eq(r.guesses[0].name, "GST 07AAACS1234K1Z5 Adj", "the real name back");
  eq(r.guesses[0].reason, "entries with Sharma Traders and 07AAACS1234K1Z5 only", "the reason unmasked");
});

Deno.test("cached: the same ledger again costs nothing; only a new one is asked", async () => {
  const c = new FakeClaude((names) => names.map((n) => ({ name: n, kind: "gst_output", head: "IGST", rate: 18, section: "", confidence: "high", reason: "credited on sales" })));
  const st = store(), d = { client: c, capTake: async () => ({ ok: true }), ...st };
  await guessLedgers(d, [L("Output Misc")], []);
  const r2 = await guessLedgers(d, [L("Output Misc")], []);
  eq(c.calls.length, 1, "no second call");
  eq([r2.asked, r2.cached, r2.usd], [0, 1, 0], "from the cache");
  eq(r2.guesses[0].head, "IGST", "the cached guess");
  const r3 = await guessLedgers(d, [L("Output Misc"), L("Output Two")], []);
  eq(c.calls.length, 2, "one call for the new one");
  const sent = JSON.parse(String((c.calls[1] as any).messages[0].content).replace(/^The ledgers:\n/, ""));
  eq(sent.map((x: any) => x.name), ["Output Two"], "only the new ledger sent");
  eq([r3.asked, r3.cached], [1, 1], "one asked, one cached");
  assert(Object.keys(st.rows).every((k) => /^lg:[0-9a-f]{64}$/.test(k)), "keys lg:<sha256>");
  assert(LEDGER_GUESS_V === "ledger-guess-v1", "versioned");
});

Deno.test("over the firm's cap: no call, no guesses from AI", async () => {
  const c = new FakeClaude(() => []);
  const r = await guessLedgers({ client: c, capTake: async () => ({ ok: false, why: "inr" }), ...store() }, [L("X GST")], []);
  eq(c.calls.length, 0, "no call");
  eq([r.guesses.length, (r as any).capped], [0, "inr"], "capped");
});

Deno.test("only the names asked, a kind not known is low not_tax, at most 100 a batch, no ledger twice", () => {
  const g = parseGuesses('here: {"ledgers": [{"name": "A", "kind": "gst_input", "confidence": "high", "reason": "x"}, {"name": "Z", "kind": "gst_input"}, {"name": "B", "kind": "weird", "confidence": "high"}, {"name": "A", "kind": "not_tax"}]}', new Set(["A", "B"]));
  eq(g.map((x) => [x.name, x.kind, x.confidence]), [["A", "gst_input", "high"], ["B", "not_tax", "low"]], "parsed");
  eq(parseGuesses("no json", new Set(["A"])), [], "nothing from bad text");
  const many = Array.from({ length: 130 }, (_, i) => L("L" + i)).concat([L("L1")]);
  eq(cleanIn(many).length, 100, "100 at most");
  eq(cleanIn([L("Dup"), L("dup")]).length, 1, "no ledger twice");
});

Deno.test("the cost of 100 ledgers (Haiku, the batch's real size)", async () => {
  // a realistic ledger: name, group chain, use, three sample entries
  const led = (i: number) => L("GST ADJUSTMENT ACCOUNT " + i, { use: "14 entries: 9 on purchases/expenses, 5 on set-off or tax-only entries; usually debit (12 Dr / 2 Cr); tax about 9% of the value",
    samples: ["20250512 Purchase Dr 1620.00 | Dr Office Supplies 9000, Dr GST ADJUSTMENT ACCOUNT " + i + " 1620, Cr PARTY 10620", "20250630 Journal Cr 4200.00 | Dr GST Payable 4200, Cr GST ADJUSTMENT ACCOUNT " + i + " 4200", "20250705 Purchase Dr 810.00 | Dr Repairs 4500, Dr GST ADJUSTMENT ACCOUNT " + i + " 810, Cr PARTY 5310"] });
  let sentChars = 0;
  const c = new FakeClaude((names) => names.map((n) => ({ name: n, kind: "gst_input", head: "IGST", rate: 18, section: "", confidence: "medium", reason: "debited on purchases beside the expense, like input tax" })));
  const real = c.beta.messages.stream;
  c.beta.messages.stream = (p) => { sentChars = SYSTEM_LEDGERS.length + String((p.messages as any[])[0].content).length; return real(p); };
  const r = await guessLedgers({ client: c, capTake: async () => ({ ok: true }), ...store() }, Array.from({ length: 100 }, (_, i) => led(i)), []);
  const outChars = JSON.stringify({ ledgers: r.guesses }).length;
  // about 4 characters a token (English and JSON); the reply as long as the guesses
  const usd = costUsd(HAIKU, { input_tokens: Math.ceil(sentChars / 4), output_tokens: Math.ceil(outChars / 4) });
  console.log("COST100 " + JSON.stringify({ inTokens: Math.ceil(sentChars / 4), outTokens: Math.ceil(outChars / 4), usd, inr: Math.round(usd * 88 * 100) / 100 }));
  assert(usd < 0.05, "under 5 US cents for 100 ledgers: " + usd);
});

// ---- the function end to end (index.ts, action "ledger_guess") with Supabase faked: who, the firm's switch, the cache rows
import { handler } from "./index.ts";
function fakeSupa(o: { enabled: boolean, consent?: boolean }) {
  const answers: Record<string, any>[] = [], log: string[] = [];
  const j = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "Content-Type": "application/json" } });
  const f = (async (u: string | URL, init: RequestInit = {}) => {
    const url = String(u), path = url.replace(/^https?:\/\/[^/]+/, ""), body = init.body ? JSON.parse(String(init.body)) : null;
    log.push((init.method || "GET") + " " + path.split("?")[0]);
    if (path.startsWith("/auth/v1/user")) return j({ id: "u-1" });
    if (path.startsWith("/rest/v1/rpc/mfa_ok")) return j(true);
    if (path.startsWith("/rest/v1/members")) return j([{ firm_id: "f-1", role: "owner", active: true }]);
    if (path.startsWith("/rest/v1/assistant_settings")) return j([{ enabled: o.enabled, consent: o.consent !== false }]);
    if (path.startsWith("/rest/v1/clients")) return j([{ id: "c-1", name: "ZZ Client", deleted: false }]);
    if (path.startsWith("/rest/v1/platform_secrets")) return j([{ value: "sk-test" }]);
    if (path.startsWith("/rest/v1/rpc/asst_cap_take")) return j({ ok: true });
    if (path.startsWith("/rest/v1/rpc/")) return j({});
    if (path.startsWith("/rest/v1/assistant_answers") && (init.method || "GET") === "GET") {
      const keys = decodeURIComponent((path.match(/key=in\.\(([^)]*)\)/) || [])[1] || "").split(",");
      return j(answers.filter((a) => keys.includes(a.key) && a.version === LEDGER_GUESS_V && a.client_id === "c-1").map((a) => ({ key: a.key, events: a.events })));
    }
    if (path.startsWith("/rest/v1/assistant_answers")) { (body as any[]).forEach((r) => { const i = answers.findIndex((a) => a.key === r.key); if (i >= 0) answers[i] = r; else answers.push(r); }); return j([]); }
    return j({ message: "not faked: " + path }, 404);
  }) as unknown as typeof fetch;
  return { f, answers, log };
}
async function post(h: (r: Request) => Promise<Response>, body: Record<string, unknown>) {
  const res = await h(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json", Origin: "https://staging.fincom.live" }, body: JSON.stringify(body) }));
  return { status: res.status, j: await res.json() };
}
const env = (k: string) => ({ SUPABASE_URL: "http://stand", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k];
const quiet = { report() {}, mismatch() {}, listen() {}, wrap: (x: unknown) => x } as never;

Deno.test("the function: guesses for the client's ledgers, cached in assistant_answers; the second ask makes no call", async () => {
  const s = fakeSupa({ enabled: true }), c = new FakeClaude((names) => names.map((n) => ({ name: n, kind: "tds_payable", head: "", rate: 2, section: "194C", confidence: "medium", reason: "credited beside contract payments" })));
  const h = handler({ env, fetch: s.f, anthropic: () => c as never, sentry: quiet });
  const a = await post(h, { action: "ledger_guess", client_id: "c-1", ledgers: [L("TDS Misc")], parties: [] });
  eq(a.status, 200, "200"); eq(a.j.guesses.map((g: any) => [g.name, g.kind, g.section]), [["TDS Misc", "tds_payable", "194C"]], "the guess");
  eq([a.j.asked, a.j.cached, a.j.model], [1, 0, HAIKU], "asked on Haiku");
  eq(s.answers.length, 1, "one cache row"); eq(s.answers[0].version, LEDGER_GUESS_V, "its version"); eq(s.answers[0].client_id, "c-1", "the client");
  const b = await post(h, { action: "ledger_guess", client_id: "c-1", ledgers: [L("TDS Misc")], parties: [] });
  eq([b.status, b.j.asked, b.j.cached, c.calls.length], [200, 0, 1, 1], "from the cache, no second call");
  assert(s.log.some((x) => x === "POST /rest/v1/rpc/asst_cost_add"), "the cost added to the firm's day");
});

Deno.test("the function: AI switched off for the firm, or no client: no call", async () => {
  const s = fakeSupa({ enabled: false }), c = new FakeClaude(() => []);
  const h = handler({ env, fetch: s.f, anthropic: () => c as never, sentry: quiet });
  const a = await post(h, { action: "ledger_guess", client_id: "c-1", ledgers: [L("TDS Misc")] });
  eq([a.status, a.j.kind, c.calls.length], [403, "off", 0], "off: 403, no call");
  const s2 = fakeSupa({ enabled: true }), h2 = handler({ env, fetch: s2.f, anthropic: () => c as never, sentry: quiet });
  const b = await post(h2, { action: "ledger_guess", ledgers: [L("TDS Misc")] });
  eq([b.status, c.calls.length], [400, 0], "no client: 400, no call");
});
