// deno test --allow-read --allow-run server/assistant/tools/reports_test.ts
// The report tools through a mock Assistant context: the made-up company of tests/reports_fixtures.js served as the SQL of
// migration 79 would return it. The tools' figures equal FSX's in the app to the paisa; files come back; a missing
// assumption is refused, never filled in. Test data only.
import { TOOLS } from "./reports.ts";
const root = new URL("../../../", import.meta.url).pathname;
const out = new Deno.Command("node", { args: ["-e", `const F=require('./tests/reports_fixtures');const X=F.loadFSX();const c=F.company();const st=F.confirmed(X,c);
  const r=X.run(Object.assign({},c,{mapStore:st}));process.stdout.write(JSON.stringify({c,st,tas:r.model.nm.T_as_CY,pat:r.model.nm.T_pat_CY,failed:r.fails.length}));`], cwd: root, stdout: "piped" }).outputSync();
const fx = JSON.parse(new TextDecoder().decode(out.stdout));
const c = fx.c, det = Object.assign({}, c.det, { entity: c.entity, age: c.age });
const rows = c.tb.map((t: any) => ({ l: t.l, parent: t.g[0] || "", chain: t.g.slice(1), o: t.o, d: t.d, c: t.c, po: t.po, pd: t.pd, pc: t.pc }));
const uploaded: string[] = [];
const ctx: any = { clientId: "c1", clientName: c.entity.name, today: "2026-10-13", firm: { name: "Test firm", lines: [] },
  rpc: async (fn: string, a: any) => fn === "rpt_tb" ? (a.p_from === "2025-04-01" ? { ok: true, rows } : { ok: false, why: "not held" })
    : fn === "rpt_saved" ? { rx: { kind: "company", map: fx.st, det: { "2025": det } }, msme: { "Alder Components": "small" } }
    : fn === "rpt_cash_entries" ? c.vouchers.filter((v: any) => v.ent.some((e: any) => /^(Cash|Kite Bank Current A\/c|Kite Bank Fixed Deposit|Kite Bank Cash Credit)$/.test(e.l))) : null,
  book: async () => ({ rows: [] }), makeFile: async () => null, progress: () => {}, aiText: async () => "",
  uploadFile: async (b: Uint8Array, name: string, kind: string) => { uploaded.push(name); return { id: name, name, kind, path: "p/" + name, expires: "", bytes: b.length }; } };
const tool = (n: string) => TOOLS.find((t) => t.name === n)!;
const assert = (c: boolean, w: string) => { if (!c) throw new Error(w); console.log("  ok   " + w); };

Deno.test("the four tools, strict schemas", () => {
  assert(TOOLS.map((t) => t.name).join() === "fs_build,tax_audit_draft,cash_mis,dcf_model", "fs_build, tax_audit_draft, cash_mis, dcf_model");
  const strict = (s: any): boolean => s.type !== "object" || (s.additionalProperties === false && JSON.stringify(Object.keys(s.properties).sort()) === JSON.stringify([...s.required].sort()) && Object.values(s.properties).every(strict));
  assert(TOOLS.every((t) => strict(t.input_schema) && t.label === "books"), "every schema strict; label books");
});
// fs_build (owner, 29-Oct-2026): the statements of the Financial statements page, for any From-To, with the comparative and
// the notes; the figures are worked out by the page's own engine in the browser (the card, app/src/parts/AssistantFs.jsx),
// so the tool gives the card and never a figure (the old figures came from the Reports screen's engine, not the page's)
Deno.test("fs_build: the statements card for a period, the comparative and the notes; no figure, no file of another engine", async () => {
  const r = await tool("fs_build").run({ client: null, from: "2026-04-01", to: "2026-09-30", compare: null, notes: null }, ctx);
  assert(!r.error, "made: " + (r.error || ""));
  const card: any = (r.cards || [])[0];
  assert(card && card.t === "fs" && card.from === "2026-04-01" && card.to === "2026-09-30" && card.fy === "2026" && card.cmp === "same" && card.notes === true, "the card: " + JSON.stringify(card));
  assert(!(r.tables || []).length && !(r.files || []).length, "no table or file worked out here");
  assert(/never state a figure/i.test(r.forModel || "") && !/\d{1,3}(,\d{2,3})+/.test(r.forModel || ""), "the model is told: " + r.forModel);
  const y = await tool("fs_build").run({ client: null, from: null, to: "2026-03-31", compare: "fy", notes: false }, ctx);
  const c2: any = (y.cards || [])[0];
  assert(c2.from === "2025-04-01" && c2.to === "2026-03-31" && c2.cmp === "fy" && c2.notes === false, "To alone: the year's start to To: " + JSON.stringify(c2));
  const bad = await tool("fs_build").run({ client: null, from: "2026-09-30", to: "2026-04-01", compare: null, notes: null }, ctx);
  assert(!!bad.error, "From after To refused: " + bad.error);
});
Deno.test("cash_mis: receipts less payments = the cash and bank movement", async () => {
  const r = await tool("cash_mis").run({ client: null, period: { from: "2025-04-01", to: "2026-03-31" } }, ctx);
  assert(!r.error && r.tables![2].summary!.difference === 0 && /difference 0\)/.test(r.forModel!), "reconciled: " + r.forModel);
});
Deno.test("tax_audit_draft: a DRAFT with questions for the user", async () => {
  const r = await tool("tax_audit_draft").run({ client: null, year: "2025-26" }, ctx);
  assert(!r.error && r.tables![0].rows.length === 60 && r.tables![0].rows.some((x: any) => x.src === "for you") && r.files!.length === 2, r.forModel!);
});
Deno.test("dcf_model: refuses a missing assumption; values with them", async () => {
  const none = await tool("dcf_model").run({ client: null, assumptions: { years: 3 } }, ctx);
  assert(!!none.error && /never assumes/.test(none.error!), "refused: " + none.error!.slice(0, 80));
  const r = await tool("dcf_model").run({ client: null, assumptions: { years: 3, revGrowth: [10, 10, 10], ebitdaMargin: [15, 15, 15], depPct: 3, capexPct: 4, nwcPct: 18, taxRate: 25, tg: 5, shares: 120000, valuationDate: "2026-03-31", method: "FCFF", wacc: 14, netDebt: 900000 } }, ctx);
  assert(!r.error && (r.tables![0].rows.find((x: any) => x.item === "Value per share") as any).amount > 0 && r.files!.length === 2, r.forModel || r.error || "");
});
