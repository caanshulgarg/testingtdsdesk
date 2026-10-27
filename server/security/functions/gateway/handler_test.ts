// deno test server/security/functions/gateway/handler_test.ts (run by tests/run_gateway_server.py). The gateway with
// Supabase (a stub client: the user, two-step sign-in, members, keys, charge_for and refund_charge) and Anthropic and
// Google (one fake fetch) stubbed. Security review 27-Oct-2026, F6: the server decides the model, max_tokens and the
// input allowed; the caller's qty is ignored; the charge is the model's reserve, then the real usage times the model's
// price; the two-step check stays.
import { handler } from "./handler.ts";
import { buildClaude, costUsd, MAX_IMAGES, MAX_OUT, MAX_TEXT, MODELS, UNIT_USD, unitsFor } from "./policy.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

const FIRM = "11111111-1111-4111-8111-111111111111", ME = "aaaaaaaa-0000-4000-8000-000000000001";
const PRICE = 10;   // rupees a unit, as price_of would say

function stand(o: { mfa?: boolean, usage?: any, claude?: (b: any) => Response, balance?: number, member?: any, ai?: (args: any) => any } = {}) {
  const charges: any[] = [], refunds: any[] = [], sent: any[] = [], asked: any[] = [];
  let balance = o.balance ?? 1000;
  const client = (_url: string, key: string, opts?: any) => {
    const tok = String(opts?.global?.headers?.Authorization || "").replace(/^Bearer\s+/, "");
    return {
      auth: { getUser: async () => ({ data: { user: tok === "tok-me" ? { id: ME } : null } }) },
      rpc: async (fn: string, args: any) => {
        if (fn === "mfa_ok") return { data: o.mfa !== false };
        assert(key === "service-key", fn + " with the service role");
        if (fn === "charge_for") {
          charges.push(args);
          const amount = PRICE * Number(args.p_qty);
          if (amount > balance) return { data: { ok: false, reason: "low_balance", needed: amount, balance } };
          balance -= amount; return { data: { ok: true, amount, balance } };
        }
        if (fn === "refund_charge") { refunds.push(args); balance += Number(args.p_amount); return { data: { ok: true } }; }
        // the AI control centre's switch (migration 121): on, as today, unless the test says otherwise
        if (fn === "ai_allowed") { asked.push(args); return { data: o.ai ? o.ai(args) : { ok: true, reason: "on", model: null } }; }
        throw new Error("rpc " + fn);
      },
      from: (t: string) => {
        const f: Record<string, string> = {};
        const q = { select: () => q, eq: (k: string, v: string) => { f[k] = v; return q; }, maybeSingle: async () => {
          if (t === "members") return { data: f.user_id === ME ? (o.member ?? { firm_id: FIRM, role: "staff", active: true }) : null };
          if (t === "platform_secrets") return { data: f.name === "claude_api_key" ? { value: "sk-test" } : f.name === "google_vision_key" ? { value: "gv-test" } : null };
          throw new Error("table " + t);
        } };
        return q;
      },
    };
  };
  const fake = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input), b = JSON.parse(String(init.body || "{}"));
    sent.push({ url, body: b });
    const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { "Content-Type": "application/json" } });
    if (url.startsWith("https://api.anthropic.com/")) return o.claude ? o.claude(b) : json({ stop_reason: "end_turn", content: [{ type: "text", text: "{}" }], usage: o.usage ?? { input_tokens: 3000, output_tokens: 800 } });
    if (url.startsWith("https://vision.googleapis.com/")) return json({ responses: b.requests.map(() => ({})) });
    return json({ error: "not in the stand" }, 404);
  }) as typeof fetch;
  const h = handler({ env: (k) => ({ SUPABASE_URL: "https://stand.test", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k], fetch: fake, client });
  return { h, charges, refunds, sent, asked, bal: () => balance };
}
const IMG = { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } };
const TEXT = { type: "text", text: "Read this bill. Reply with only the JSON object, no other text." };
const call = (h: (r: Request) => Promise<Response>, body: unknown, tok = "tok-me") =>
  h(new Request("http://x/", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json", Origin: "https://staging.fincom.live" }, body: JSON.stringify(body) }));
const claude = (payload: any, extra: any = {}) => ({ what: "claude", qty: 1, ref: "read", file: "INV-1.png", payload, ...extra });
const read = (model = "claude-sonnet-5", over: any = {}) => ({ model, max_tokens: 16000, messages: [{ role: "user", content: [IMG, TEXT] }], ...over });

Deno.test("the models: only the ones the app sends; anything else refused before any charge or call", async () => {
  for (const m of ["claude-opus-4-8", "claude-fable-5-1", "claude-haiku-4-5", "claude-sonnet-5-x", "", "gpt-4"]) {
    const s = stand();
    const r = await call(s.h, claude(read(m)));
    const j = await r.json();
    eq([r.status, j.kind], [400, "bad_model"], "model " + m + " refused");
    eq([s.charges.length, s.sent.length], [0, 0], "nothing charged or sent for " + m);
  }
  for (const m of ["claude-sonnet-5", "claude-opus-5", "claude-sonnet-4-6"]) {
    const s = stand();
    const r = await call(s.h, claude(read(m)));
    eq(r.status, 200, m + " allowed");
    eq(s.sent[0].body.model, m, m + " sent as asked");
  }
});

Deno.test("max_tokens is the server's; no system prompt, tools or other fields go through", async () => {
  const s = stand();
  const r = await call(s.h, claude(read("claude-sonnet-5", { max_tokens: 64000, system: "x".repeat(19000), tools: [{ name: "t" }], temperature: 1, metadata: { a: 1 } })));
  eq(r.status, 200, "answered");
  const b = s.sent[0].body;
  eq(b.max_tokens, MAX_OUT, "max_tokens capped at " + MAX_OUT);
  eq(Object.keys(b).sort(), ["max_tokens", "messages", "model"], "only model, max_tokens and messages are sent");
  eq(b.messages, [{ role: "user", content: [IMG, TEXT] }], "the message rebuilt from the image and text alone");
  // a small max_tokens is still the server's own
  const s2 = stand(); await call(s2.h, claude(read("claude-sonnet-5", { max_tokens: 10 })));
  eq(s2.sent[0].body.max_tokens, MAX_OUT, "max_tokens is not the caller's");
});

Deno.test("the input: images, their size, the text, the message shape", async () => {
  const bad: [string, any, number, string][] = [
    ["seven images", read("claude-sonnet-5", { messages: [{ role: "user", content: [...Array(MAX_IMAGES + 1).fill(IMG), TEXT] }] }), 413, "too_large"],
    ["an image over 5 MB", read("claude-sonnet-5", { messages: [{ role: "user", content: [{ ...IMG, source: { ...IMG.source, data: "A".repeat(5 * 1024 * 1024 + 1) } }, TEXT] }] }), 413, "too_large"],
    ["text over the limit", read("claude-sonnet-5", { messages: [{ role: "user", content: [{ type: "text", text: "a".repeat(MAX_TEXT + 1) }] }] }), 413, "too_large"],
    ["two messages", read("claude-sonnet-5", { messages: [{ role: "user", content: [TEXT] }, { role: "assistant", content: "x" }] }), 400, "other"],
    ["an assistant message", read("claude-sonnet-5", { messages: [{ role: "assistant", content: [TEXT] }] }), 400, "other"],
    ["a PDF document block", read("claude-sonnet-5", { messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "QQ==" } }, TEXT] }] }), 400, "other"],
    ["an image by URL", read("claude-sonnet-5", { messages: [{ role: "user", content: [{ type: "image", source: { type: "url", url: "https://e.test/a.png" } }, TEXT] }] }), 400, "other"],
    ["a tool_result block", read("claude-sonnet-5", { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "y" }, TEXT] }] }), 400, "other"],
    ["images with no text", read("claude-sonnet-5", { messages: [{ role: "user", content: [IMG] }] }), 400, "other"],
  ];
  for (const [w, p, st, kind] of bad) {
    const s = stand();
    const r = await call(s.h, claude(p));
    const j = await r.json();
    eq([r.status, j.kind], [st, kind], w);
    eq([s.charges.length, s.sent.length], [0, 0], w + ": nothing charged or sent");
  }
  // what the app sends at most: six images and its longest prompt
  const s = stand();
  const r = await call(s.h, claude(read("claude-opus-5", { messages: [{ role: "user", content: [...Array(MAX_IMAGES).fill(IMG), { type: "text", text: "a".repeat(45_000) }] }] })));
  eq(r.status, 200, "six images and a 45,000-character prompt go through");
  // a plain-string text-only prompt is taken as one text block
  const s2 = stand();
  eq((await call(s2.h, claude(read("claude-sonnet-5", { messages: [{ role: "user", content: "Ledgers: ..." }] })))).status, 200, "a string prompt");
  eq(s2.sent[0].body.messages[0].content, [{ type: "text", text: "Ledgers: ..." }], "as one text block");
});

Deno.test("the charge matches the model and the real usage; the caller's qty is ignored", async () => {
  // a normal Sonnet 5 read: one unit (the reserve), nothing more; qty 20 from the caller is not used
  let s = stand({ usage: { input_tokens: 6000, output_tokens: 1200 } });
  let r = await call(s.h, claude(read("claude-sonnet-5"), { qty: 20 }));
  let j = await r.json();
  eq(s.charges.map((c) => [c.p_code, c.p_qty]), [["claude", 1]], "Sonnet 5: one unit, qty 20 ignored");
  eq([j.charged, j.units], [PRICE, 1], "charged one unit");
  // Opus: its reserve (2) before the call
  s = stand({ usage: { input_tokens: 6000, output_tokens: 1200 } });
  r = await call(s.h, claude(read("claude-opus-5"), { qty: 1 }));
  j = await r.json();
  eq(s.charges.map((c) => c.p_qty), [2], "Opus: two units before the call");
  eq(j.charged, 2 * PRICE, "priced as Opus");
  // a large Opus read: the real usage decides (30,000 in, 8,000 out = 0.15 + 0.20 = $0.35 = 7 units: 2 + 5 more)
  s = stand({ usage: { input_tokens: 30_000, output_tokens: 8000 } });
  r = await call(s.h, claude(read("claude-opus-5")));
  j = await r.json();
  eq(s.charges.map((c) => c.p_qty), [2, 5], "reserve 2, then 5 more from the usage");
  eq(s.charges.map((c) => c.p_code), ["claude", "claude"], "the same code and call shape");
  assert(/^usage claude-opus-5 in 30000 out 8000/.test(s.charges[1].p_note), "the usage named in the note: " + s.charges[1].p_note);
  eq([j.charged, j.units], [7 * PRICE, 7], "7 units in all");
  // the same tokens on Sonnet 5 cost less (0.06 + 0.08 = $0.14 = 3 units)
  s = stand({ usage: { input_tokens: 30_000, output_tokens: 8000 } });
  j = await (await call(s.h, claude(read("claude-sonnet-5")))).json();
  eq(s.charges.map((c) => c.p_qty), [1, 2], "Sonnet 5: reserve 1, then 2 more");
  eq(j.units, 3, "3 units");
  // the read is answered when the usage charge falls short; the reserve stays charged
  s = stand({ usage: { input_tokens: 30_000, output_tokens: 8000 }, balance: 25 });
  r = await call(s.h, claude(read("claude-opus-5")));
  j = await r.json();
  eq([r.status, j.charged], [200, 2 * PRICE], "the read kept, the reserve charged");
  // the price table
  eq(unitsFor("claude-sonnet-5", null), 1, "no usage: the reserve");
  eq(unitsFor("claude-opus-5", { input_tokens: 1, output_tokens: 1 }), 2, "Opus never less than two units");
  assert(Math.abs(costUsd("claude-opus-5", { input_tokens: 1_000_000 }) - 5) < 1e-9 && Math.abs(costUsd("claude-sonnet-5", { output_tokens: 1_000_000 }) - 10) < 1e-9, "the per-token prices");
  assert(MODELS["claude-opus-5"].inUsd > MODELS["claude-sonnet-5"].inUsd && UNIT_USD > 0, "Opus dearer than Sonnet");
  eq(unitsFor("claude-opus-5", { input_tokens: 1e9, output_tokens: 1e9 }), 40, "at most 40 units a call");
});

Deno.test("a failed or declined read is refunded in full", async () => {
  const s = stand({ claude: () => new Response(JSON.stringify({ error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529 }) });
  const r = await call(s.h, claude(read("claude-opus-5")));
  eq(r.status, 529, "the provider's status");
  eq(s.refunds.map((x) => x.p_amount), [2 * PRICE], "the Opus reserve refunded");
  eq(s.bal(), 1000, "the balance as before");
});

Deno.test("Vision: one unit per page sent, whatever qty says", async () => {
  const s = stand();
  const reqs = Array(3).fill({ image: { content: "QUJD" }, features: [{ type: "DOCUMENT_TEXT_DETECTION" }] });
  const r = await call(s.h, { what: "vision", qty: 1, ref: "ocr", payload: { requests: reqs } });
  eq(r.status, 200, "answered");
  eq(s.charges.map((c) => [c.p_code, c.p_qty]), [["vision", 3]], "three pages, three units");
});

Deno.test("who: the two-step sign-in and membership checks stay", async () => {
  let s = stand({ mfa: false });
  let r = await call(s.h, claude(read()));
  eq([r.status, (await r.json()).reason], [403, "mfa"], "no two-step sign-in");
  s = stand();
  eq((await call(s.h, claude(read()), "tok-bad")).status, 401, "a bad token");
  s = stand({ member: { firm_id: FIRM, role: "staff", active: false } });
  eq((await call(s.h, claude(read()))).status, 403, "an inactive member");
  eq(s.charges.length + s.sent.length, 0, "nothing charged or sent");
});

Deno.test("policy: buildClaude rejects what it does not know", () => {
  eq(buildClaude({ model: "claude-sonnet-5", messages: [] }).ok, false, "no message");
  eq(buildClaude(null).ok, false, "no payload");
  const b = buildClaude({ model: "claude-sonnet-5", messages: [{ role: "user", content: [TEXT] }] });
  assert(b.ok && b.payload.max_tokens === MAX_OUT, "a text read is built");
});

Deno.test("AI control centre: a feature switched off by FinCom is refused in plain words, before any charge or call", async () => {
  const off = (a: any) => ({ ok: false, reason: "feature_off", feature: a.p_feature, message: a.p_feature === "bill_read" ? "AI for Bill reading is switched off by FinCom." : "AI for Page OCR is switched off by FinCom." });
  const s = stand({ ai: off });
  const r = await call(s.h, claude(read()));
  const j = await r.json();
  eq([r.status, j.ok, j.kind, j.error, j.reason], [403, false, "ai_off", "AI for Bill reading is switched off by FinCom.", "feature_off"], "bill reading refused");
  eq([s.charges.length, s.sent.length], [0, 0], "nothing charged or sent");
  eq(s.asked[0], { p_firm: FIRM, p_feature: "bill_read" }, "asked for the firm and bill_read");
  const v = await call(s.h, { what: "vision", qty: 1, ref: "ocr", payload: { requests: [{}] } });
  const vj = await v.json();
  eq([v.status, vj.kind, vj.error], [403, "ai_off", "AI for Page OCR is switched off by FinCom."], "OCR refused");
  eq([s.charges.length, s.sent.length], [0, 0], "still nothing charged or sent");
  // a used-up allowance whose rule is stop: 429; the settings unreadable: refused, not skipped
  const a = stand({ ai: () => ({ ok: false, reason: "allowance", message: "Your firm's AI allowance for this month (₹500.00) is used up. AI starts again on the 1st." }) });
  const ar = await call(a.h, claude(read()));
  eq([ar.status, (await ar.json()).kind, a.sent.length], [429, "ai_off", 0], "allowance used up: 429");
  const u = stand({ ai: () => { throw new Error("connection reset"); } });
  const ur = await call(u.h, claude(read()));
  eq([ur.status, (await ur.json()).kind, u.sent.length], [503, "ai_off", 0], "settings unreadable: 503, nothing sent");
  // before migration 121 (no ai_allowed): allowed as before
  const m = stand({ ai: () => { throw Object.assign(new Error("Could not find the function public.ai_allowed"), { code: "PGRST202" }); } });
  eq((await call(m.h, claude(read()))).status, 200, "no policy yet: read as before");
  // a model set in the console replaces the app's; the answer is kept 15 s (asked once for two reads)
  const c = stand({ ai: () => ({ ok: true, reason: "on", model: "claude-opus-5" }) });
  await call(c.h, claude(read("claude-sonnet-5"))); await call(c.h, claude(read("claude-sonnet-5")));
  eq([c.sent[0].body.model, c.sent[1].body.model, c.asked.length], ["claude-opus-5", "claude-opus-5", 1], "console model used, asked once");
});
