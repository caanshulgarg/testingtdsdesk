// deno test --allow-read --allow-run --allow-env --allow-net --allow-sys server/assistant/projection_test.ts
// "Prepare a projected balance sheet" (the owner, 13-Nov-2026: asked 4-5 times, never made; it kept asking what they had
// already answered). The model is a FAKE endpoint (a fixed transcript) and the database is the made-up company of
// tests/reports_fixtures.js served as migration 79's SQL would; no network, no keys. It checks:
//   - such a request reaches the model (never the statements card, the keyword router or Haiku), on Opus;
//   - the instructions sent carry the act-first rule and the projections rule;
//   - the whole conversation is sent: every recent turn in full, the older turns' user words in a note;
//   - projected_statements reads the client's own figures (the trial balance through FSX) and makes the statements at
//     once, with defaults it states: the balance sheet balances, the cash flow ends at the balance sheet's cash, and the
//     user's own assumption (from an earlier message) is used;
//   - an Excel file comes back, and the answer is labelled "projection".
// A live call to the real model runs only with ANTHROPIC_API_KEY set (else it is skipped).
import { boundHistory, HISTORY_TOTAL, runTurn, SYSTEM } from "./agent.ts";
import { fsAsked, projAsked } from "./fsask.ts";
import { route } from "./router.ts";
import { claudeTools } from "./tools.ts";
import { costOf, pbtOf, project, TOOLS } from "./tools/projection.ts";
import { OPUS } from "./models.ts";
import Anthropic from "npm:@anthropic-ai/sdk@0.133.0";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const near = (a: number, b: number, w: string, tol = 1) => assert(Math.abs(a - b) <= tol, w + ": " + a + " vs " + b);

// the made-up company's books (FY 2025-26, with FY 2024-25 as its previous year), as rpt_tb and rpt_saved return them
const root = new URL("../../", import.meta.url).pathname;
const out = new Deno.Command("node", { args: ["-e", `const F=require('./tests/reports_fixtures');const X=F.loadFSX();const c=F.company();const st=F.confirmed(X,c);process.stdout.write(JSON.stringify({c,st}));`], cwd: root, stdout: "piped" }).outputSync();
const fx = JSON.parse(new TextDecoder().decode(out.stdout));
const c = fx.c, det = Object.assign({}, c.det, { entity: c.entity, age: c.age });
const rows = c.tb.map((t: any) => ({ l: t.l, parent: t.g[0] || "", chain: t.g.slice(1), o: t.o, d: t.d, c: t.c, po: t.po, pd: t.pd, pc: t.pc }));
const rpcCalls: string[] = [];
async function exec(fn: string, a: Record<string, unknown>): Promise<any> {
  rpcCalls.push(fn);
  if (fn === "rpt_tb") return a.p_from === "2025-04-01" ? { ok: true, rows } : { ok: false, why: "not held" };
  if (fn === "rpt_saved") return { rx: { kind: "company", map: fx.st, det: { "2025": det } }, msme: {} };
  if (fn === "asst_find_ledgers") return { rows: [] };
  return null;
}

// the fake model endpoint: each call recorded; the script says what the model "writes"
type Block = Record<string, unknown>;
class FakeModel {
  calls: Record<string, any>[] = [];
  constructor(public script: Block[][]) {}
  beta = { messages: { stream: (p: Record<string, unknown>) => {
    const n = this.calls.length; this.calls.push({ ...p, messages: JSON.parse(JSON.stringify(p.messages)) });
    const content = (this.script[n] ?? [{ type: "text", text: "(no more script)" }]).map((b, i) => b.type === "tool_use" ? { id: "toolu_" + n + "_" + i, ...b } : b);
    const events = content.flatMap((b, i) => [{ type: "content_block_start", index: i, content_block: b.type === "text" ? { type: "text", text: "" } : b },
      ...(b.type === "text" ? [{ type: "content_block_delta", index: i, delta: { type: "text_delta", text: String(b.text) } }] : []), { type: "content_block_stop", index: i }]);
    const msg = { id: "msg_" + n, type: "message", role: "assistant", content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 1000, output_tokens: 100 } };
    return { async *[Symbol.asyncIterator]() { for (const e of events) yield e; }, finalMessage: async () => msg };
  } } };
}
const NULLS = { years: null, revenue_growth_pct: null, material_cost_pct: null, employee_cost_pct: null, other_expenses_pct: null, tax_rate_pct: null, capex: null, new_loans: null,
  loan_repayment: null, dividend_or_drawings: null, receivable_days: null, inventory_days: null, payable_days: null, other_assumptions: null };
const uploaded: { name: string, bytes: number }[] = [];
async function turn(question: string, history: { role: "user" | "assistant", content: string }[], script: Block[][], client: any = null) {
  const events: any[] = [], m = client || new FakeModel(script);
  rpcCalls.length = 0;
  const r = await runTurn({ client: m as never, question, history, attachments: [], clientId: "kestrel", clientName: "Kestrel Widgets Private Limited", firmWide: false, today: "2026-11-13", books: "",
    exec, capTake: async () => ({ ok: true, used: 1, cap: 100 }), makeFile: async () => null, recordMismatch: async () => null, firm: { name: "Test firm", lines: [] }, emit: (e) => events.push(e), strict: false,
    uploadFile: async (b, name, kind) => { uploaded.push({ name, bytes: b.length }); return { id: name, name, kind, path: "p/" + name, expires: "" }; } });
  return { r, events, model: m };
}
const T = (evs: any[], t: string) => evs.filter((e) => e.t === t);
const bsTotals = (tb: any) => { const row = (s: string) => tb.rows.find((r: any) => r.item === s); return { L: row("Total equity and liabilities"), A: row("Total assets") }; };

Deno.test("the words: a projection is never the statements card or a book tool; the books' own statements still are", () => {
  for (const q of ["prepare a projected balance sheet", "Projected P&L for next year", "CMA data for the bank", "forecast the balance sheet for FY 2027-28", "balance sheet for the next two years",
    "estimated balance sheet as on 31 March 2027", "agle saal ka balance sheet bana do"]) {
    assert(projAsked(q), "a projection: " + q);
    assert(!fsAsked(q), "not the statements card: " + q);
    assert(route(q, "2026-10-31") === null, "not routed to a book tool: " + q);
  }
  for (const q of ["provisional balance sheet from 1st April 2026 to 30th September 2026", "balance sheet as on 31 March 2026 with notes"]) assert(fsAsked(q) && !projAsked(q), "the books' statements: " + q);
});

Deno.test("the conversation: every recent turn in full, the older turns' words kept in a note, bounded", () => {
  const h: { role: "user" | "assistant", content: string }[] = [];
  for (let i = 1; i <= 40; i++) h.push({ role: "user", content: "question " + i + (i === 1 ? ": growth 12%, no new loans" : "") }, { role: "assistant", content: "answer " + i + " " + "x".repeat(900) });
  const b = boundHistory(h);
  assert(b[0].role === "user" && b.every((m, i) => m.role === (i % 2 ? "assistant" : "user")), "starts with the user and alternates");
  assert(/Earlier in this conversation/.test(b[0].content) && /question 1: growth 12%, no new loans/.test(b[0].content), "the oldest answer is kept: " + b[0].content.slice(0, 160));
  assert(b.at(-1)!.content.startsWith("answer 40"), "the newest turn is there");
  assert(b.reduce((s, m) => s + m.content.length, 0) <= HISTORY_TOTAL + 4200, "bounded");
  const short = boundHistory(h.slice(0, 6));
  assert(short.length === 6 && short.every((m, i) => m.content === h[i].content.slice(0, 2000)), "a short chat goes as it is, every turn");
});

Deno.test("the engine: the client's figures carried forward on stated assumptions; the balance sheet balances; the cash flow ends at its cash", async () => {
  const tool = TOOLS[0];
  const ctx: any = { clientId: "kestrel", clientName: "Kestrel Widgets Private Limited", today: "2026-11-13", firm: { name: "", lines: [] }, rpc: (fn: string, a: any) => exec(fn, { p_client: "kestrel", ...a }),
    uploadFile: async (b: Uint8Array, name: string, kind: string) => ({ id: name, name, kind, path: "p/" + name, expires: "", bytes: b.length }) };
  const r = await tool.run({ client: null, base_year: null, assumptions: { ...NULLS } }, ctx);
  assert(!r.error, "made: " + r.error);
  const [pl, bs, cf, , as] = r.tables!;
  assert(pl.columns.map((x) => x.label).join("|") === "Particulars|2025-26 (actual)|2026-27 (estimated)|2027-28 (projected)", "actual, the running year estimated, next year projected: " + pl.columns.map((x) => x.label));
  const rev = pl.rows.find((x: any) => x.item === "Revenue from operations") as any;
  assert(rev.y0 === 6300000, "the actual revenue is the books' (63,00,000): " + rev.y0);
  near(rev.y1, 6300000 * 630 / 540, "revenue grows at last year's growth (16.7%, within the 25% cap)", 2);
  for (const i of [0, 1, 2]) { const t = bsTotals(bs); near(t.L["y" + i], t.A["y" + i], "the balance sheet balances, column " + i, 2); }
  const close = cf.rows.find((x: any) => x.item === "Closing cash and bank") as any, cash = bs.rows.find((x: any) => x.item === "Cash and Bank Balances") as any;
  near(close.y1, cash.y1, "the cash flow ends at the balance sheet's cash (year 1)"); near(close.y2, cash.y2, "and year 2");
  const said = as.rows.map((x: any) => x.item).join(" ");
  assert(/last year's growth was 16\.7%/.test(said) && /No new loans/.test(said) && /No new fixed assets/.test(said) && /Tax at/.test(said), "every default is said: " + said);
  assert(/change and I'll redo it/.test(as.title), "it invites changes: " + as.title);
  assert(rpcCalls.includes("rpt_tb"), "the client's trial balance was read");
  assert(r.files!.length === 1 && /projected-2026-27-to-2027-28\.xlsx$/.test(r.files![0].name), "the Excel file: " + JSON.stringify(r.files));
  // the user's own assumptions replace the defaults
  const p = project({ rev: 1000000, mat: 600000, emp: 100000, exp: 100000, fin: 10000, dep: 20000, tax: 40000, ppe: 200000, share: 100000, reserves: 250000, ltb: 100000, tr: 200000, inv: 100000, cash: 50000, tp: 100000 } as any,
    null, 2025, 2026, "company", { years: 1, revenue_growth_pct: [20], new_loans: [500000], capex: [400000] });
  const y = p.years[0].l;
  near(y.rev, 1200000, "growth 20% as said"); near(y.ltb, 600000, "the new loan as said"); near(y.mat, 720000, "materials keep 60% of revenue");
  near(pbtOf(y), y.rev - costOf(y) - y.emp - y.fin - y.dep - y.exp, "the profit adds up");
  assert(/as you said/.test(p.assumptions.join(" ")), "said as the user's");
});

Deno.test("the turn: 'prepare a projected balance sheet' acts at once with the whole conversation and the act-first rule", async () => {
  uploaded.length = 0;
  const history: { role: "user" | "assistant", content: string }[] = [];
  history.push({ role: "user", content: "I need projections for the bank. Take revenue growth of 12% and no new loans." }, { role: "assistant", content: "Which year should I start from?" });
  for (let i = 0; i < 24; i++) history.push({ role: "user", content: "follow-up " + i }, { role: "assistant", content: "reply " + i });
  history.push({ role: "user", content: "start from 2025-26, the last audited year" }, { role: "assistant", content: "What growth should I take?" });
  const m = new FakeModel([
    [{ type: "tool_use", name: "projected_statements", input: { client: null, base_year: "2025-26", assumptions: { ...NULLS, revenue_growth_pct: [12] } } }],
    [{ type: "text", text: "I prepared the projected statements for 2026-27 and 2027-28 from the 2025-26 books.\n- Revenue grows 12% a year.\n- No new loans.\nTell me any assumption to change and I'll redo it." }]]);
  const { r, events } = await turn("prepare a projected balance sheet", history, [], m);
  assert(!T(events, "fs").length, "not the statements card");
  assert(m.calls.length === 2 && m.calls[0].model === OPUS, "the model was called, on Opus: " + m.calls.map((x) => x.model));
  const sys = JSON.stringify(m.calls[0].system);
  assert(sys.includes("Act first") && sys.includes("Never ask for assumptions first") && sys.includes("Never ask for something the user already said"), "the act-first rule is in the instructions");
  assert(SYSTEM.includes("projected_statements") && m.calls[0].tools.some((t: any) => t.name === "projected_statements"), "the tool is offered");
  assert(claudeTools(false).some((t) => t.name === "projected_statements"), "and in the model's tool list");
  const sent = m.calls[0].messages as any[], all = JSON.stringify(sent);
  assert(all.includes("Take revenue growth of 12% and no new loans") && all.includes("start from 2025-26, the last audited year") && all.includes("follow-up 0") && all.includes("follow-up 23"), "every earlier turn (the owner's answers too) reaches the model");
  assert(sent.length === 41 && /Earlier in this conversation/.test(sent[0].content), "the last 40 messages as they are, the 12 older ones' words in a note: " + sent.length);
  const res = T(events, "result"), bs = res.find((x) => x.title === "Projected balance sheet (as at 31 March)");
  assert(bs && bs.label === "projection" && res.length === 5, "the five tables shown: " + res.map((x) => x.title));
  const rev = res[0].rows.find((x: any) => x.item === "Revenue from operations");
  near(rev.y1, 6300000 * 1.12, "the user's 12% from the earlier message is used");
  const back = JSON.parse(String(m.calls[1].messages.at(-1).content.find((b: any) => b.type === "tool_result").content));
  assert(/2025-26 \(actual, from the books\)/.test(back.base_year) && back.assumptions.length >= 8 && /redo it/.test(back.say), "the model reads the base year and the assumptions back");
  assert(T(events, "file").length === 1 && uploaded.length === 1, "the Excel file is given");
  assert(r.labels.includes("projection") && !r.labels.includes("general"), "labelled projection: " + r.labels);
  assert(!r.cacheable, "never served again from the answer cache");
});

Deno.test("a change right after: 'make growth 15% and redo' goes back to the projection, not to a book tool", async () => {
  const m = new FakeModel([[{ type: "tool_use", name: "projected_statements", input: { client: null, base_year: null, assumptions: { ...NULLS, revenue_growth_pct: [15] } } }], [{ type: "text", text: "Redone at 15%." }]]);
  const { events } = await turn("make growth 15% and redo", [{ role: "user", content: "prepare a projected balance sheet" }, { role: "assistant", content: "Prepared. [Shown: table Projected balance sheet (as at 31 March) [projected_statements {}]]" }], [], m);
  assert(m.calls.length === 2 && m.calls[0].model === OPUS && !T(events, "fs").length, "the model with the projection tool");
  near(T(events, "result")[0].rows.find((x: any) => x.item === "Revenue from operations").y1, 6300000 * 1.15, "redone at 15%");
});

// the real model: only with a key (never in CI without one)
Deno.test({ name: "live: the real model calls projected_statements first, without asking", ignore: !Deno.env.get("ANTHROPIC_API_KEY"), fn: async () => {
  const { events, r } = await turn("prepare a projected balance sheet for next year", [{ role: "user", content: "growth 10%, no new loans" }, { role: "assistant", content: "Noted." }], [], new Anthropic());
  assert(r.tools[0] === "projected_statements" || r.tools.includes("projected_statements"), "called projected_statements: " + r.tools);
  assert(T(events, "result").length >= 2, "the statements shown");
} });
