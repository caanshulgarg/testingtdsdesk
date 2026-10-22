// deno test server/assistant/mis_test.ts - "My MIS" described in words (ROUND 105, B4): Ask FinCom's build_mis tool. The
// model's replies are STUBBED (a fixed transcript: its tool call and its text) and so are the database's answers (the
// client's ledgers and groups, as asst_ledger_pick and asst_find_ledgers give them); no database, no network.
//   - which questions ask for an MIS (laid out by the model, never routed to a book tool by their words);
//   - a valid layout: checked against the schema and the client's books, shown as a result of kind "mis" with the
//     definition, the books' own spelling of each name;
//   - an unknown ledger: flagged with the closest names, still shown (the person corrects it in the builder);
//   - no figures: an amount or a budget the model wrote is taken out; nothing in the result is an amount;
//   - a layout that is not JSON goes back to the model, which writes it again.
import { checkMis, figuresIn, lookFromDb, misAsked } from "./mis.ts";
import { runTurn } from "./agent.ts";
import { claudeTools } from "./tools.ts";
import { normalizeDef } from "../_shared/misdef.js";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

// the client's books as the database answers (migration 88's pick: the same key, else the one name it starts or contains)
const LEDGERS: [string, string][] = [["Tamarind Urban Bank - CA 0042", "Bank Accounts"], ["Cash", "Cash-in-Hand"], ["Salaries", "Employee Benefit Expenses"], ["Office Rent", "Indirect Expenses"],
  ["Quillfeather Weddings LLP", "Sundry Debtors"], ["Nightjar Sound & Light Co", "Sundry Creditors"], ["Event Services", "Sales Accounts"]];
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const calls: string[] = [];
async function exec(fn: string, a: Record<string, unknown>): Promise<any> {
  calls.push(fn);
  if (fn === "asst_ledger_pick") {
    const k = key(String(a.p_text)), same = LEDGERS.filter(([l]) => key(l) === k), has = LEDGERS.filter(([l]) => key(l).includes(k));
    if (same.length === 1) return { ledger: same[0][0], how: "same", ask: false, choices: [] };
    if (has.length === 1) return { ledger: has[0][0], how: "contains", ask: false, choices: [] };
    return { ledger: null, ask: has.length > 1, choices: (has.length ? has : LEDGERS.filter(([l]) => l[0].toLowerCase() === String(a.p_text)[0]?.toLowerCase())).map(([l]) => l).slice(0, 5) };
  }
  if (fn === "asst_find_ledgers") {
    const g = String(a.p_group || "").toLowerCase();
    return { rows: LEDGERS.filter(([, gr]) => !g || gr.toLowerCase().includes(g)).map(([l, gr]) => ({ ledger: l, group: gr, balance: 0, side: "" })) };
  }
  throw new Error("no book tool may run for an MIS layout: " + fn);
}
const look = lookFromDb(exec, "larkspur");

Deno.test("which questions ask for an MIS: laid out by the model, never routed to a book tool by their words", () => {
  for (const q of ["Build my MIS: monthly P&L with last year, and top 10 customers in lakhs", "Make a director's one-pager for this client", "mujhe is client ka MIS bana do with GST summary",
    "Create a dashboard of sales by customer and expenses", "I want a monthly MIS with cash and bank", "my MIS should show receivables by age"]) assert(misAsked(q), "an MIS asked: " + q);
  for (const q of ["What is MIS?", "Show the entries of Office Rent for March", "Which suppliers crossed 30,000 under 194C?", "How much GST did we pay in May?"]) assert(!misAsked(q), "not an MIS request: " + q);
  assert(claudeTools(false).some((t) => t.name === "build_mis"), "build_mis is one of the model's tools");
});

Deno.test("a valid layout: the schema and the client's real names; the books' spelling", async () => {
  const c = await checkMis({ definition_json: JSON.stringify({ name: "Monthly MIS", units: { unit: 100000, dec: 2 }, period: { kind: "ytd" }, blocks: [
    { type: "table", title: "P&L", rows: { by: "head" }, cols: { by: "month", compare: "ly", pct: ["change"] } },
    { type: "chart", title: "Bank", rows: { by: "ledger", items: ["tamarind urban bank - ca 0042"] }, measure: "close", cols: { by: "month" }, chart: { type: "line" } },
    { type: "table", title: "Expenses", rows: { by: "ledger", under: ["indirect expenses"], top: 5, others: true }, cols: { by: "year", pct: ["share"] } }] }), summary: "P&L, bank and expenses" }, look);
  assert(c.ok, "ok: " + JSON.stringify(c));
  eq(c.def.blocks.length, 3, "three blocks"); eq(c.def.units, { unit: 100000, dec: 2 }, "lakhs, 2 decimals");
  eq(c.def.blocks[1].rows.items, ["Tamarind Urban Bank - CA 0042"], "the ledger as the books spell it");
  eq(c.def.blocks[2].rows.under, ["Indirect Expenses"], "the group as the books spell it");
  eq(figuresIn(c.def), [], "no figure in it");
});

Deno.test("an unknown ledger: flagged with the closest names, still laid out; a wrong value replaced and said", async () => {
  const c = await checkMis({ definition_json: JSON.stringify({ name: "X", units: { unit: 7 }, blocks: [{ type: "table", rows: { by: "ledger", items: ["Salary Account", "Office Rent"] } }, { type: "radar", rows: { by: "customer", items: ["Quilfeather"] } }] }), summary: "" }, look);
  assert(!c.ok, "not ok");
  eq(c.unknown.map((u) => u.name), ["Salary Account", "Quilfeather"], "the two names not in the books");
  assert(c.unknown[0].choices.includes("Salaries"), "the closest names are offered: " + c.unknown[0].choices);
  eq(c.def.blocks[0].rows.items, ["Salary Account", "Office Rent"], "the unknown name stays, for the person to correct");
  assert(c.problems.some((p) => /unit/.test(p)) && c.problems.some((p) => /radar/.test(p)), "the unit and the block type said: " + c.problems.join("; "));
  eq(c.def.units.unit, 1, "rupees instead"); eq(c.def.blocks[1].type, "table", "a table instead");
});

Deno.test("no figures: a budget or an amount the model wrote is taken out", async () => {
  const c = await checkMis({ definition_json: JSON.stringify({ name: "Sales above ₹ 5,00,000", budget: { "head:rev": { "202504": 500000 } }, blocks: [{ type: "kpi", title: "Revenue (target 12,00,000)", rows: { by: "head", items: ["rev"] }, cols: { by: "year", compare: "budget" } }] }), summary: "" }, look);
  eq(c.def.budget, {}, "no budget");
  eq(figuresIn(c.def), [], "no amount anywhere: " + JSON.stringify(c.def));
  assert(!/5,00,000|12,00,000/.test(JSON.stringify(c.def)), "the amounts are gone from the words");
  const bad = await checkMis({ definition_json: "{blocks: [", summary: "" }, look);
  assert(!!bad.parseError, "a layout that is not JSON is refused");
});

// ---- the turn, with the model stubbed: its tool call, then its two lines
type Block = Record<string, unknown>;
class MockClaude {
  calls: Record<string, unknown>[] = [];
  constructor(public script: Block[][]) {}
  beta = { messages: { stream: (p: Record<string, unknown>) => {
    const n = this.calls.length; this.calls.push({ ...p, messages: [...(p.messages as unknown[])] });
    const content = (this.script[n] ?? [{ type: "text", text: "(no more script)" }]).map((b, i) => b.type === "tool_use" ? { id: "toolu_" + n + "_" + i, ...b } : b);
    const events: Record<string, unknown>[] = [];
    content.forEach((b, i) => {
      events.push({ type: "content_block_start", index: i, content_block: b.type === "text" ? { type: "text", text: "" } : b });
      if (b.type === "text") events.push({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: String(b.text) } });
      events.push({ type: "content_block_stop", index: i });
    });
    const msg = { id: "msg_" + n, type: "message", role: "assistant", content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 1000, output_tokens: 100 } };
    return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; }, finalMessage: async () => msg };
  } } };
}
async function turn(question: string, script: Block[][]) {
  const events: any[] = [], c = new MockClaude(script);
  calls.length = 0;
  const r = await runTurn({ client: c as never, question, history: [], attachments: [], clientId: "larkspur", clientName: "Larkspur Fixture Events Private Limited", firmWide: false, today: "2026-10-22", books: "",
    exec, capTake: async () => ({ ok: true, used: 1, cap: 100 }), makeFile: async () => null, recordMismatch: async () => null, firm: { name: "Test firm", lines: [] }, emit: (e) => events.push(e), strict: false });
  return { r, events, model: c };
}
const DEF = { name: "Monthly MIS", period: { kind: "ytd" }, units: { unit: 100000, dec: 2 }, blocks: [
  { type: "table", title: "Profit and loss", rows: { by: "head" }, cols: { by: "month", compare: "ly" } },
  { type: "table", title: "Top customers", rows: { by: "customer", top: 10, others: true }, cols: { by: "year", pct: ["share"] } },
  { type: "chart", title: "Salary", rows: { by: "ledger", items: ["Salary Account"] }, cols: { by: "month" }, chart: { type: "bar" } }] };

Deno.test("the turn: build_mis shows a layout (kind mis) with the unknown name flagged; no book tool, no figure, not cached", async () => {
  const { r, events, model } = await turn("Build my MIS: monthly P&L with last year, top 10 customers in lakhs, and salary by month", [
    [{ type: "tool_use", name: "build_mis", input: { definition_json: JSON.stringify(DEF), summary: "Monthly P&L, top customers and salary" } }],
    [{ type: "text", text: "I laid out your MIS: the profit and loss by month against last year, the top 10 customers and salary by month. Salary Account is not a ledger in the books: pick Salaries in the builder." }]]);
  const res = events.filter((e) => e.t === "result");
  eq(res.length, 1, "one result"); eq(res[0].kind, "mis", "of kind mis"); eq(res[0].tool, "build_mis", "from build_mis");
  eq(res[0].definition.blocks.length, 3, "the three blocks");
  eq(res[0].unknown.map((u: any) => [u.name, u.choices.includes("Salaries")]), [["Salary Account", true]], "Salary Account flagged, Salaries offered");
  eq(figuresIn(res[0].definition), [], "no figure in the layout");
  eq(calls.filter((f) => !["asst_ledger_pick", "asst_find_ledgers"].includes(f)), [], "no book tool ran (only the names were looked up)");
  assert(r.labels.includes("mis"), "the answer's source is the MIS label: " + r.labels);
  eq(r.cacheable, false, "never answered again from the cache");
  const sys = JSON.stringify((model.calls[0] as any).system);
  assert(/build_mis/.test(sys) && /Never write a figure/.test(sys), "the system prompt says how to lay out an MIS, and never a figure");
  const back = JSON.parse(String(((model.calls[1] as any).messages.at(-1).content as any[]).find((b: any) => b.type === "tool_result").content));
  assert(back.shown && /Never state a figure/.test(back.say) && back.not_in_books[0].typed === "Salary Account", "the model is told what was shown, what is not in the books, and never to state a figure");
  eq(normalizeDef(res[0].definition).problems, [], "the layout shown is one the builder takes as it is");
});

Deno.test("the turn: a layout that is not JSON goes back to the model; the second is shown", async () => {
  const { events, model } = await turn("make a director's one-pager MIS", [
    [{ type: "tool_use", name: "build_mis", input: { definition_json: "{name: one pager", summary: "" } }],
    [{ type: "tool_use", name: "build_mis", input: { definition_json: JSON.stringify({ name: "One-pager", blocks: [{ type: "kpi", rows: { by: "head", items: ["rev"] } }] }), summary: "Revenue" } }],
    [{ type: "text", text: "Laid out." }]]);
  eq(model.calls.length, 3, "three model calls");
  const first = ((model.calls[1] as any).messages.at(-1).content as any[]).find((b: any) => b.type === "tool_result");
  assert(first.is_error && /not valid JSON/.test(first.content), "the first came back as not JSON");
  eq(events.filter((e) => e.t === "result" && e.kind === "mis").length, 1, "the second layout shown");
});
