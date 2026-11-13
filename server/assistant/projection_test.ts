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
import { costOf, monthsIn, numOf, pbtOf, project, tablesOf, excelOf, TOOLS } from "./tools/projection.ts";
import { fyOf } from "./tools/reports.ts";
import { projFollow } from "./agent.ts";
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
// the books' first and last entry (asst_books) and the years rpt_tb holds; a test may change them
const BOOKS = { from: "2024-04-01", to: "2026-03-31", held: ["2025-04-01"] as string[] };
async function exec(fn: string, a: Record<string, unknown>): Promise<any> {
  rpcCalls.push(fn);
  if (fn === "asst_books") return { rows: [{ company: "Kestrel", from: BOOKS.from, to: BOOKS.to, entries: 100 }] };
  if (fn === "rpt_tb") return BOOKS.held.includes(String(a.p_from)) ? { ok: true, rows } : { ok: false, why: "not held" };
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
  const r = await tool.run({ base_year: null, assumptions: { ...NULLS } }, ctx);
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
    null, { fy: 2025, months: 12, kind: "company", warnings: [] }, 2026, { years: 1, revenue_growth_pct: ["20%"], new_loans: ["5 lakh"], capex: [400000] });
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
    [{ type: "tool_use", name: "projected_statements", input: { base_year: "2025-26", assumptions: { ...NULLS, revenue_growth_pct: [12] } } }],
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
  const m = new FakeModel([[{ type: "tool_use", name: "projected_statements", input: { base_year: null, assumptions: { ...NULLS, revenue_growth_pct: [15] } } }], [{ type: "text", text: "Redone at 15%." }]]);
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

// ---------------------------------------------------------------- the review of 8fe086c34 (made-up figures only)
const KEST: any = { clientId: "kestrel", clientName: "Kestrel Widgets Private Limited", today: "2026-11-13", firm: { name: "", lines: [] }, rpc: (fn: string, a: any) => exec(fn, { p_client: "kestrel", ...a }),
  uploadFile: async (b: Uint8Array, name: string, kind: string) => ({ id: name, name, kind, path: "p/" + name, expires: "", bytes: b.length }) };
const run = (input: Record<string, unknown>) => TOOLS[0].run({ base_year: null, assumptions: { ...NULLS }, ...input }, KEST);
const allFinite = (tables: any[]) => tables.every((t) => t.rows.every((r: any) => Object.entries(r).every(([k, v]) => !/^y\d$/.test(k) || v == null || v === "-" || (typeof v === "number" ? isFinite(v) : !/NaN|Infinity/.test(String(v))))));
const B0 = { rev: 0, mat: 300000, emp: 200000, exp: 100000, fin: 0, dep: 50000, tax: 0, ppe: 500000, share: 100000, reserves: 950000, tr: 200000, inv: 150000, cash: 300000, tp: 100000 } as any;

Deno.test("1. nil or tiny sales: costs, debtors, stock and creditors are last year's amounts grown, never 0; and said", () => {
  for (const rev of [0, 1000]) {
    const p = project({ ...B0, rev }, null, { fy: 2025, months: 12, kind: "company", warnings: [] }, 2026, { revenue_growth_pct: [10] });
    const y = p.years[0].l;
    near(y.mat, 330000, "materials grown 10% (sales " + rev + ")"); near(y.emp, 220000, "employee costs grown"); near(y.tr, 220000, "debtors grown"); near(y.inv, 165000, "stock grown"); near(y.tp, 110000, "creditors grown");
    assert(/were (nil|very small)/.test(p.assumptions.join(" ")), "said: " + p.assumptions.join(" ").slice(0, 300));
    assert(allFinite(tablesOf(p)), "no NaN in the tables");
  }
});

Deno.test("2. a partial year: the months found; annualised and said when no complete year; the running or a future year refused as a base", async () => {
  eq3(monthsIn(2025, "2024-04-01", "2026-03-31"), 12, "a complete year"); eq3(monthsIn(2025, "2025-04-01", "2025-12-31"), 9, "nine months"); eq3(monthsIn(2026, "2024-04-01", "2026-09-30"), 6, "six months of the running year");
  Object.assign(BOOKS, { from: "2025-04-01", to: "2025-12-31", held: ["2025-04-01"] });
  try {
    const r = await run({});
    assert(!r.error, "made: " + r.error);
    assert(/2025-26 \(actual, 9 months annualised\)/.test(r.tables![0].columns[1].label), "the base column says it: " + r.tables![0].columns[1].label);
    near((r.tables![0].rows[0] as any).y0, 6300000 * 12 / 9, "the revenue annualised x 12/9");
    assert(/9 months of books, its profit and loss annualised/.test(r.tables![4].rows.map((x: any) => x.item).join(" ")), "the annualising is said");
    for (const by of ["2026-27", "2027-28", "31 March 2027"]) { const x = await run({ base_year: by }); assert(!!x.error && /not a completed year/.test(x.error!), "refused as a base: " + by + " -> " + x.error); }
    // this year's books to date set the estimated year's growth (low)
    Object.assign(BOOKS, { from: "2024-04-01", to: "2026-09-30", held: ["2025-04-01", "2026-04-01"] });
    const y = await run({});
    assert(/from this year's books to date \(6 months/.test(y.tables![4].rows.map((x: any) => x.item).join(" ")), "the running year's books used for its estimate");
  } finally { Object.assign(BOOKS, { from: "2024-04-01", to: "2026-03-31", held: ["2025-04-01"] }); }
});
const eq3 = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": " + JSON.stringify(a));

Deno.test("3. the base year read as a CA writes it", () => {
  for (const [s, fy] of [["31 March 2026", "2025"], ["31-03-2026", "2025"], ["2026-03-31", "2025"], ["March 31, 2026", "2025"], ["2025-26", "2025"], ["FY 2025-26", "2025"], ["2025-2026", "2025"], ["FY25-26", "2025"], ["FY26", "2025"], ["2025", "2025"], ["30 September 2025", "2025"]])
    eq3(fyOf(s, "2026-11-13"), fy, s);
});

Deno.test("4. a trial balance that does not balance: said first, kept as its own line, never in reserves or cash", () => {
  const off = { ...B0, rev: 1000000, reserves: 950000 + 77777 };          // liabilities 77,777 more than assets
  const p = project(off, null, { fy: 2025, months: 12, kind: "company", warnings: ["3 ledgers are not placed in the statements (A, B, C): place them on the Reports screen; the figures may be off."] }, 2026, {});
  assert(/do not balance by ₹77,777/.test(p.warnings[0]) && /not placed/.test(p.warnings.join(" ")), "said: " + p.warnings);
  const [, bs, , , as] = tablesOf(p), d = bs.rows.find((x: any) => /Difference in the books/.test(x.item)) as any;
  assert(d && d.y0 === 77777 && d.y1 === 77777 && d.y2 === 77777, "its own line, unchanged: " + JSON.stringify(d));
  const t = (s: string) => bs.rows.find((x: any) => x.item === s) as any;
  near(t("Total assets").y1, t("Total equity and liabilities").y1, "the balance sheet still balances");
  near(p.years[0].l.cash + 77777, sum0(p.years[0].l), "cash not inflated by the difference", 2);
  assert(/^Check: The books do not balance/.test(String(as.rows[0].item)), "first in the assumptions table");
  const x = new TextDecoder().decode(excelOf(p, "Made-up Co"));
  assert(x.length > 0, "the Excel is made");
});
const sum0 = (l: any) => ["share", "capital", "current", "reserves", "ltb", "dtl", "oltl", "ltp", "stb", "tp", "ocl", "stp"].reduce((s, k) => s + (l[k] || 0), 0) - ["ppe", "intang", "cwip", "nci", "dta", "ltla", "onca", "ci", "inv", "tr", "stla", "oca"].reduce((s, k) => s + (l[k] || 0), 0);

Deno.test("5. every input coerced and bounded; never NaN in the tables or the Excel", async () => {
  eq3([numOf("25%"), numOf("1,00,000"), numOf("₹5 lakh"), numOf("2 crore"), numOf("abc"), numOf(NaN), numOf(Infinity)], [25, 100000, 500000, 20000000, null, null, null], "numbers as written");
  const r = await run({ assumptions: { ...NULLS, years: "9", revenue_growth_pct: ["500%", "abc"], tax_rate_pct: 95, receivable_days: -4, inventory_days: "1000", material_cost_pct: "lots", capex: ["NaN"] } });
  assert(!r.error, "made: " + r.error);
  const said = r.tables![4].rows.map((x: any) => x.item).join(" ");
  assert(r.tables![0].columns.length === 7, "years capped at 5: " + r.tables![0].columns.length);
  for (const w of ["Years to project: 9 is outside 1 to 5; 5 is used", "Revenue growth %: 500 is outside -50 to 200; 200 is used", "“abc” is not a number", "Tax rate %: 95 is outside 0 to 60; 60 is used",
    "Debtors' days: -4 is outside 0 to 730; 0 is used", "Stock days: 1000 is outside 0 to 730; 730 is used", "Cost of materials %: “lots” is not a number"]) assert(said.includes(w), "said: " + w);
  assert(allFinite(r.tables!), "no NaN in the tables");
  const strict = (sc: any): boolean => sc.type !== "object" || (sc.additionalProperties === false && JSON.stringify(Object.keys(sc.properties).sort()) === JSON.stringify([...sc.required].sort()) && Object.values(sc.properties).every(strict));
  assert(strict(TOOLS[0].input_schema) && !("client" in (TOOLS[0].input_schema as any).properties), "a strict schema, no unused client field");
});

Deno.test("6-7. act-first never covers posting, filing or confirming; the follow-up rule is narrow", () => {
  assert(/never applies to posting, filing, deleting, sending or confirming anything/.test(SYSTEM) && /explicit yes in this turn/.test(SYSTEM), "the scope of act-first");
  for (const q of ["change growth to 15%", "redo with 20% growth", "make it 3 years", "take a new loan of 50 lakh", "no capex", "assume debtors at 60 days", "redo it without dividend", "change the assumptions"]) assert(projFollow(q), "a follow-up: " + q);
  for (const q of ["what is the tax due this year?", "how many days to file GSTR-3B?", "show the loans ledger", "TDS on interest under 194A for 2025-26?", "show expenses over 50000 in March", "post these entries to tally", "confirm the certificate figures", "how much interest did we pay in 2 months"])
    assert(!projFollow(q), "not a follow-up: " + q);
});

Deno.test("8. more projection wordings: a future year or date, Hinglish, Devanagari, typos", () => {
  for (const q of ["balance sheet for FY 2027-28", "balance sheet as on 31 March 2028", "P&L for FY28", "future balance sheet", "aane wale saal ka balance sheet", "agle varsh ki balance sheet", "projeted balance sheet", "forcast P&L",
    "अगले वर्ष की बैलेंस शीट", "अनुमानित लाभ हानि खाता", "प्रोजेक्टेड बैलेंस शीट"]) {
    assert(projAsked(q, "2026-11-13"), "a projection: " + q);
    assert(!fsAsked(q, null, "2026-11-13"), "not the card: " + q);
  }
  for (const q of ["balance sheet as on 31 March 2026", "provisional balance sheet till 30 September 2026", "balance sheet for FY 2025-26"]) assert(!projAsked(q, "2026-11-13") && fsAsked(q, null, "2026-11-13"), "the books' statements: " + q);
});

Deno.test("the DCF acts first: every missing assumption a stated default, bounded; the valuation made at once", async () => {
  const { TOOLS: R } = await import("./tools/reports.ts");
  const dcf = R.find((t) => t.name === "dcf_model")!;
  const ctx = { ...KEST, today: "2026-10-13", book: async () => ({ rows: [] }), makeFile: async () => null, progress: () => {}, aiText: async () => "" };
  const r = await dcf.run({ client: null, assumptions: { years: null, tg: "15%", wacc: "12" } }, ctx);
  assert(!r.error, "made, nothing asked: " + r.error);
  const as = r.tables!.find((t) => /Assumptions/.test(t.title))!, said = as.rows.map((x: any) => x.item).join(" ");
  assert(/redo it/.test(as.title) && /Forecast of 5 years/.test(said) && /WACC 12% \(as you said\)/.test(said) && /Terminal growth %: 15 is outside -5 to 10; 10 is used/.test(said), "the defaults and bounds said: " + said);
  assert(/Net debt/.test(said) && /Equity shares/.test(said) && /Tax rate: 25\.17%/.test(said), "net debt, shares and tax from the books or the entity");
  assert(r.files!.length === 2 && /Tell me any assumption to change/.test(r.forModel!), "the Excel and the Word draft; the model invites changes");
});
