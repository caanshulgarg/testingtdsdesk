// deno test server/tds-challan-match/match_test.ts: the AI step alone, with a fake Claude: nothing left, no key, a call that
// fails, an answer not JSON, a split that adds up and one that does not, interest within what is left
import { matchRun } from "./match.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
function client(answer: (d: any[], c: any[]) => unknown, fail = false) {
  const f: any = { calls: 0 };
  f.beta = { messages: { stream: (p: any) => {
    f.calls++;
    if (fail) throw new Error("down");
    const txt = String(p.messages[0].content), d = JSON.parse(txt.split("\n")[1]), c = JSON.parse(txt.split("\n")[3]);
    const a = answer(d, c), msg = { content: [{ type: "text", text: typeof a === "string" ? a : JSON.stringify(a) }], usage: { input_tokens: 100, output_tokens: 10 }, stop_reason: "end_turn" };
    return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => msg };
  } } };
  return f;
}
const deps = (cl: any) => ({ client: cl, aiAllowed: true, capTake: async () => ({ ok: true }), costAdd: async () => ({ inr: 0.5 }), log: async () => null });
const R = [{ id: "r1", sec: "194C", date: "20260510", tds: 1500, party: "A", pan: "******234A", fy: "2026-27", q: "Q1" }];
const C = [{ id: "c1", sec: "194C", date: "20260607", minor: "200", bal: 1000, interestLeft: 50, fy: "2026-27" }, { id: "c2", sec: "194C", date: "20260607", minor: "200", bal: 800, fy: "2026-27" }];
const opt = { fy: "2026-27", q: "Q1" };

Deno.test("nothing left, no key, a failed call, an answer not JSON: no pairing, the rules stand", async () => {
  eq((await matchRun([], C, opt, deps(client(() => ({}))))).ai.state, "nothing", "nothing left");
  eq((await matchRun(R, C, opt, deps(null))).ai.state, "failed", "no key");
  eq((await matchRun(R, C, opt, deps(client(() => ({}), true)))).ai.state, "failed", "the call failed");
  const r = await matchRun(R, C, opt, deps(client(() => "not json")));
  eq([r.ai.state, r.pairs.length], ["invalid", 0], "not JSON: refused whole");
});

Deno.test("a split that adds up is kept, one that does not is refused; interest within what is left", async () => {
  const good = await matchRun(R, C, opt, deps(client((d, c) => ({ pairs: [], splits: [{ row: d[0].id, parts: [{ challan: c[0].id, amount: 1000 }, { challan: c[1].id, amount: 500 }], reason: "no one challan holds it", confidence: "high" }],
    interest: [{ challan: c[0].id, amount: 50, reason: "paid late", confidence: "medium" }] }))));
  eq(good.splits.map((s: any) => [s.rowId, s.parts]), [["r1", [{ chId: "c1", paise: 100000 }, { chId: "c2", paise: 50000 }]]], "the split kept");
  eq(good.interest.map((s: any) => [s.chId, s.paise]), [["c1", 5000]], "interest ₹50 kept");
  const bad = await matchRun(R, C, opt, deps(client((d, c) => ({ pairs: [], splits: [{ row: d[0].id, parts: [{ challan: c[0].id, amount: 1000 }, { challan: c[1].id, amount: 400 }], reason: "x", confidence: "high" }],
    interest: [{ challan: c[0].id, amount: 80, reason: "too much", confidence: "high" }] }))));
  eq([bad.splits.length, bad.interest.length, bad.ai.dropped], [0, 0, 2], "a split short of the deduction and interest over what is left: refused");
});
