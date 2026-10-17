// deno test server/gst-2b-match/match_test.ts (run by tests/run_2b_automatch_server.py). The AI step of the 2B matching
// (match.ts) with Claude FAKED, never the real API: one call per run on claude-sonnet-5-5 with only the left-over documents
// and only their GSTIN, name, number, date and amounts; structured JSON asked; auto-accept against suggest; an answer that
// is not JSON refused (the rules stand); the cap reached, AI off, no key or a failed call: the rules stand and say so;
// nothing left: no call; the cost of the run worked out and logged; the AI's amounts never used.
import { matchRun, SONNET } from "./match.ts";
import { m2bPairId } from "../_shared/match2b.js";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

// Claude, faked: answers with what the test says, from the ids it was sent
class FakeClaude {
  calls: any[] = [];
  constructor(public answer: (sent: { g: any[], b: any[] }) => string, public usage = { input_tokens: 4000, output_tokens: 900 }, public stop = "end_turn", public fail = false) {}
  beta = { messages: { stream: (p: any) => {
    this.calls.push(p);
    if (this.fail) throw Object.assign(new Error("overloaded"), { status: 529 });
    const txt = String(p.messages[0].content);
    const g = JSON.parse(txt.split("\n")[1]), b = JSON.parse(txt.split("\n")[3]);
    const msg = { content: [{ type: "thinking", thinking: "" }, { type: "text", text: this.answer({ g, b }) }], usage: this.usage, stop_reason: this.stop };
    return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => msg };
  } } };
}
const G = "09AAACB1234C1Z5", G_OTHER = "07AAACB1234C1Z9";
const g2 = (key: string, no: string, date: string, taxable: number, igst: number, x: Record<string, unknown> = {}) => ({ key, gstin: G, party: "Bharat Steel", no, date, ym: date.slice(0, 6), dir: 1, taxable, igst, cgst: 0, sgst: 0, cess: 0, ...x });
const bk = (id: string, no: string, date: string, taxable: number, igst: number, x: Record<string, unknown> = {}) => ({ id, gstin: G, party: "Bharat Steel Pvt Ltd", no, date, ym: date.slice(0, 6), voucher: "P" + id, dir: 1, taxable, igst, cgst: 0, sgst: 0, cess: 0, narr: "secret narration", ...x });
const TWOB = [g2("k1", "INV-1", "20260905", 10000, 1800), g2("k2", "SB/2026/77", "20260910", 7000, 1260), g2("k3", "INV-90", "20260912", 5000, 900, { gstin: G_OTHER }), g2("k4", "INV-95", "20260915", 3000, 540)];
const BOOKS = [bk("b1", "INV/0001", "20260906", 10000, 1800), bk("b2", "77", "20260911", 7000, 1260), bk("b3", "INV-90", "20260912", 5000, 900), bk("b4", "95", "20260915", 2500, 450)];
// the AI pairs every left-over 2B document with the books entry of the same position, as a model might
const pairAll = (sent: { g: any[], b: any[] }) => JSON.stringify({ pairs: sent.g.map((x, i) => ({ g: [x.id], b: [sent.b[i].id], kind: "typo", reason: "number written differently", confidence: "high", taxable: 1 })) });
const deps = (client: FakeClaude | null, extra: Record<string, unknown> = {}) => {
  const log: any[] = [], cost: any[] = [];
  return { log, cost, d: { client, aiAllowed: true, capTake: async () => ({ ok: true }), costAdd: async (usd: number) => { cost.push(usd); return { inr: Math.round(usd * 85 * 10000) / 10000 }; },
    log: async (x: any) => { log.push(x); }, ...extra } as any };
};

Deno.test("rules first; ONE call on Sonnet with only what is left, asking for JSON of the agreed shape", async () => {
  const c = new FakeClaude(pairAll), x = deps(c);
  const r = await matchRun(TWOB, BOOKS, {}, x.d);
  eq(c.calls.length, 1, "one call");
  const p = c.calls[0];
  eq(p.model, SONNET, "Sonnet 5.5"); eq(SONNET, "claude-sonnet-5-5", "the model id");
  eq(p.output_config.format.type, "json_schema", "structured JSON output asked");
  eq(p.thinking, { type: "adaptive" }, "adaptive thinking");
  const sent = String(p.messages[0].content);
  assert(sent.includes("SB/2026/77") && sent.includes("INV-95") && !sent.includes("\"INV-1\""), "only the left-over documents are sent (INV-1 matched by the rules)");
  assert(!sent.includes("secret narration") && !sent.includes("Pb1") && !sent.includes("voucher"), "no narration, no voucher: only GSTIN, name, number, date and amounts");
  eq(r.result.counts.byRules, 1, "one by the rules");
  eq(r.ai.state, "used", "AI used");
});

Deno.test("auto-accept only same GSTIN (or PAN) and equal amounts; anything else is a probable match for a person", async () => {
  const c = new FakeClaude(pairAll), x = deps(c);
  const r = await matchRun(TWOB, BOOKS, {}, x.d);
  const row = (k: string) => r.result.rows.find((z: any) => z.g.includes(k));
  eq(row("k2").st, "matched-ai", "SB/2026/77 = 77, same GSTIN, same amounts: matched by AI");
  eq(row("k2").why, ["AI: number written differently"], "with its reason");
  eq(row("k3").st, "matched-ai", "another GSTIN of the same PAN, same amounts: matched by AI");
  eq(row("k4").st, "probable", "other amounts: probable");
  assert(row("k4").why.some((w: string) => w.includes("₹3,000.00 in 2B, ₹2,500.00 in books")), "the difference from the documents' own figures: " + row("k4").why.join("; "));
  eq(r.result.line, "3 matched (1 by rules, 2 by AI) · 1 to look at · 0 in books only · 0 in 2B only", "the line");
});

Deno.test("the AI never touches an amount: figures in its answer are ignored", async () => {
  const c = new FakeClaude((s) => JSON.stringify({ pairs: [{ g: [s.g[2].id], b: [s.b[2].id], kind: "typo", reason: "same bill", confidence: "high", taxable: 3000, igst: 540, amount: 3000 }] }));
  const r = await matchRun(TWOB, BOOKS, {}, deps(c).d);
  const row = r.result.rows.find((z: any) => z.g.includes("k4"));
  eq(row.st, "probable", "still probable: the books say 2,500, whatever the AI says");
  assert(!JSON.stringify(r.result).includes("\"amount\""), "no amount of the AI kept");
});

Deno.test("an answer that is not JSON of the agreed shape is refused: the rules' result stands and says so", async () => {
  for (const bad of ["Here you go: pairs below", "{\"pairs\": \"none\"}", ""]) {
    const r = await matchRun(TWOB, BOOKS, {}, deps(new FakeClaude(() => bad)).d);
    eq(r.ai.state, "invalid", "refused: " + JSON.stringify(bad));
    assert(/rules' result stands/.test(r.ai.say), r.ai.say);
    eq(r.result.counts.byAi, 0, "nothing by AI");
    eq(r.result.counts.byRules, 1, "the rules' match stands");
  }
});

Deno.test("the cap reached, AI off, no key, a failed call: no AI, the rules stand, the screen says why", async () => {
  const c1 = new FakeClaude(pairAll);
  const capped = await matchRun(TWOB, BOOKS, {}, deps(c1, { capTake: async () => ({ ok: false, why: "inr" }) }).d);
  eq([capped.ai.state, c1.calls.length], ["cap", 0], "over the cap: no call");
  assert(/budget/.test(capped.ai.say) && /this month/.test(capped.ai.say) && !/today/.test(capped.ai.say) && /rules' result stands/.test(capped.ai.say), capped.ai.say);
  const calls = await matchRun(TWOB, BOOKS, {}, deps(new FakeClaude(pairAll), { capTake: async () => ({ ok: false, why: "calls" }) }).d);
  assert(calls.ai.state === "cap" && /calls for today/.test(calls.ai.say) && /rules' result stands/.test(calls.ai.say), "the day's count of calls: " + calls.ai.say);
  const c2 = new FakeClaude(pairAll);
  const off = await matchRun(TWOB, BOOKS, {}, deps(c2, { aiAllowed: false }).d);
  eq([off.ai.state, c2.calls.length], ["off", 0], "AI off: no call");
  assert(/AI is off/.test(off.ai.say), off.ai.say);
  const nokey = await matchRun(TWOB, BOOKS, {}, deps(null).d);
  eq(nokey.ai.state, "failed", "no key: failed, rules stand");
  const failed = await matchRun(TWOB, BOOKS, {}, deps(new FakeClaude(pairAll, undefined, "end_turn", true)).d);
  eq(failed.ai.state, "failed", "the call failed");
  const refused = await matchRun(TWOB, BOOKS, {}, deps(new FakeClaude(pairAll, undefined, "refusal")).d);
  eq(refused.ai.state, "failed", "a refusal: failed");
  for (const r of [capped, off, nokey, failed, refused]) {
    eq(r.result.counts.byRules, 1, "the rules' result in every case"); eq(r.result.counts.byAi, 0, "nothing by AI");
    eq(r.result.counts.twobOnly, 3, "the rest left as it was");
  }
});

Deno.test("nothing left over: no call, no cost", async () => {
  const c = new FakeClaude(pairAll);
  const r = await matchRun([TWOB[0]], [BOOKS[0]], {}, deps(c).d);
  eq([c.calls.length, r.ai.state, r.ai.inr], [0, "nothing", 0], "no call");
});

Deno.test("the cost of the run: from the usage at Sonnet's price, added to the firm's day, logged once", async () => {
  const c = new FakeClaude(pairAll, { input_tokens: 5000, output_tokens: 1500 }), x = deps(c);
  const r = await matchRun(TWOB, BOOKS, {}, x.d);
  eq(r.ai.usd, 0.025, "5,000 in at $2/M + 1,500 out at $10/M = $0.025");
  eq(r.ai.inr, 2.125, "at Rs 85 to the dollar");
  eq(x.cost.length, 1, "added once"); eq(x.log.length, 1, "logged once");
  eq(x.log[0].route, "sonnet", "the log names the route");
  assert(!JSON.stringify(x.log[0]).includes("Bharat"), "the log keeps no supplier or figure");
});

Deno.test("a person's decisions: a rejected pair is not suggested again; an accepted one stays matched with no AI", async () => {
  const pid = m2bPairId(["k4"], ["b4"]);
  const r1 = await matchRun(TWOB, BOOKS, { [pid]: "reject" }, deps(new FakeClaude(pairAll)).d);
  assert(!r1.result.rows.some((z: any) => z.id === pid), "rejected: not suggested");
  const c = new FakeClaude(pairAll);
  const r2 = await matchRun(TWOB, BOOKS, { [pid]: "accept" }, deps(c, { aiAllowed: false }).d);
  const row = r2.result.rows.find((z: any) => z.id === pid);
  eq([row.st, row.accepted], ["matched-ai", true], "accepted: matched");
});
