// deno test --allow-read --allow-env --allow-net --allow-sys server/assistant/cmaask_test.ts
// CMA words (cmaask.ts) go to cma_data and nowhere else: never the statements card, the keyword router, Haiku or the
// projected statements, and no chat model at all (a turn with files from earlier in the chat, the model forbidden). What
// the user said is read by FinCom's rules: the loan, its tenure and moratorium, Method I, the years, the margins.
import { cmaAsked, cmaFollow, cmaInput, cmaWanted } from "./cmaask.ts";
import { fsAsked } from "./fsask.ts";
import { route } from "./router.ts";
import { runTurn } from "./agent.ts";
import { bsXlsx, cmaXlsx } from "./tools/cma_fixtures.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }

Deno.test("router: CMA words, with or without files, are cma_data's", () => {
  for (const q of ["Prepare CMA data", "pls prepare cma data on this basis", "CMA for the bank for 2 years", "calculate MPBF by Tandon method", "credit monitoring arrangement data for SBI renewal",
    "bank ke liye projections bana do", "loan ke liye projected balance sheet chahiye", "projections for the bank loan", "MPBF from the audited balance sheet", "working capital assessment for cc limit", "सीएमए डेटा बनाओ"]) {
    assert(cmaAsked(q), "CMA: " + q);
    assert(route(q, "2026-10-31") === null, "never a book tool: " + q);
  }
  // the statements card keeps the books' own statements; a CMA with "balance sheet" in it is not the card's when routed
  assert(fsAsked("provisional balance sheet till 30 September") && !cmaAsked("provisional balance sheet till 30 September"), "the books' statements stay the card's");
  for (const q of ["what is the TDS rate on rent?", "projected balance sheet for next year", "cash payments over 10000"]) assert(!cmaAsked(q), "not CMA: " + q);
  const shown = [{ role: "user", content: "prepare cma" }, { role: "assistant", content: "CMA data in the standard bank format for K: …" }];
  for (const q of ["use method I", "term loan 50 lakh for 5 years", "cc limit 40 lakh", "redo with 6 months moratorium"]) assert(cmaFollow(q) && cmaWanted(q, shown), "a change to the CMA: " + q);
  assert(!cmaWanted("what is the GST on this?", shown), "another question after a CMA is not one");
  assert(!cmaWanted("use method I", []), "a change with no CMA shown is not one");
});

Deno.test("router: what the user said is read", () => {
  const i = cmaInput("make it method 1, cc limit of 40 lakh and a term loan of 1.2 crore repayable in 5 years with 6 months moratorium, for 2 years projections", [{ role: "user", content: "prepare CMA data" }]) as any;
  assert(i.method === "I" && i.loan_type === "both" && i.working_capital_limit === 4000000 && i.term_loan_amount === 12000000, "loan: " + JSON.stringify(i));
  assert(i.term_loan_years === 5 && i.moratorium_months === 6 && i.years === 2, "schedule and years: " + JSON.stringify(i));
  const j = cmaInput("stock margin 30% and debtors margin 40%, sales growth 12%", [{ role: "user", content: "CMA data please, CC 25 lakh" }]) as any;
  assert(j.loan_type === "working_capital" && j.working_capital_limit === 2500000 && j.method === null, "earlier words kept: " + JSON.stringify(j));
  assert(j.stock_margin_pct === 30 && j.receivable_margin_pct === 40 && j.assumptions.revenue_growth_pct[0] === 12, "margins and growth: " + JSON.stringify(j));
  const k = cmaInput("term loan of 50 lakh for 5 years", [{ role: "user", content: "cma" }]) as any;
  assert(k.term_loan_years === 5 && k.years === null, "a tenure is not the years to project: " + JSON.stringify(k));
});

Deno.test("a turn: CMA with earlier files goes to cma_data, no model, no statements card", async () => {
  const files: Record<string, Uint8Array> = { "firm1/kestrel/uploads/a-cma.xlsx": await cmaXlsx(), "firm1/kestrel/uploads/b-bs.xlsx": await bsXlsx() };
  const events: any[] = [];
  let called = 0;
  const claude = { beta: { messages: { stream: () => { called++; throw new Error("no model for a CMA"); } } } };
  const r = await runTurn({ client: claude as never, question: "pls prepare cma data on this basis, cc limit 20 lakh", history: [{ role: "user", content: "here are last year's papers" }, { role: "assistant", content: "Noted." }],
    thread: { fs: null, files: [{ path: "firm1/kestrel/uploads/a-cma.xlsx", name: "Old CMA.xlsx", type: "", kind: "cma", summary: "CMA data" }, { path: "firm1/kestrel/uploads/b-bs.xlsx", name: "BS FY25.xlsx", type: "", kind: "balance_sheet", summary: "" }] },
    attachments: [], clientId: "kestrel", clientName: "Kestrel Widgets Private Limited", firmWide: false, today: "2026-11-14", books: "",
    exec: async (fn: string) => (fn === "asst_books" ? { none: true } : null), capTake: async () => ({ ok: true, used: 1, cap: 100 }), makeFile: async () => null, recordMismatch: async () => null,
    firm: { name: "Test firm", lines: [] }, emit: (e) => events.push(e), strict: false, readFile: async (p: string) => files[p] || null,
    uploadFile: async (_b, name, kind) => ({ id: "1", name, kind, path: "p/" + name, expires: "" }) });
  assert(called === 0, "no model call");
  assert(r.route === "cma" && r.tools.includes("cma_data"), "routed to cma_data: " + r.route + " " + r.tools);
  assert(!events.some((e) => e.t === "fs"), "no statements card");
  assert(events.filter((e) => e.t === "result" && e.tool === "cma_data").length >= 8, "the forms shown");
  assert(events.some((e) => e.t === "file" && /CMA/.test(e.name)), "the Excel");
  assert(/CMA data in the standard bank format/.test(r.text) && r.labels.includes("cma"), "FinCom's line, labelled cma: " + r.text);
  assert(!r.cacheable, "never cached");
});
