// deno test --allow-read --allow-run --allow-env server/assistant/tools/depreciation_test.ts
// The Assistant's depreciation_schedule through a mock context: the register worked by hand in tests/run_depreciation.js
// (part 3; tests/dep_fixtures.js handRegister), served as migration 81's asst_dep_register returns it. With DEP_RPC (set
// by tests/run_dep_tool.py) the register is what asst_dep_register returned on pg_stand, as this firm's member and as a
// member of another firm. Every figure is checked to the paisa against the answer worked by hand. Test data only.
import { TOOLS } from "./depreciation.ts";
import { TOOLS as REPORTS } from "./reports.ts";
import { EXT_TOOLS } from "./index.ts";
const root = new URL("../../../", import.meta.url).pathname;
const viaSql = Deno.env.get("DEP_RPC");
const rpcData = viaSql ? JSON.parse(Deno.readTextFileSync(viaSql)) : (() => {
  const out = new Deno.Command("node", { args: ["-e", "process.stdout.write(JSON.stringify(require('./tests/dep_fixtures').handRegister()))"], cwd: root, stdout: "piped" }).outputSync();
  const reg = JSON.parse(new TextDecoder().decode(out.stdout));
  return { me: { reg, prev: null, years: ["2025"] }, stranger: { reg: null, prev: null, years: [] } };
})();
const uploaded: string[] = [];
const mk = (who: "me" | "stranger") => ({ clientId: "larkspur", clientName: "Kestrel Widgets", today: "2026-10-14", firm: { name: "Test firm", lines: [] },
  rpc: async (fn: string, a: any) => fn === "asst_dep_register" ? (a.p_fy === "2025" ? rpcData[who] : { reg: null, prev: null, years: rpcData[who].years }) : fn === "rpt_saved" ? { rx: { kind: "company" } } : null,
  book: async () => ({ rows: [] }), makeFile: async () => null, progress: () => {}, aiText: async () => "",
  uploadFile: async (b: Uint8Array, name: string, kind: string) => { uploaded.push(name); return { id: name, name, kind, path: "p/" + name, expires: "", bytes: b.length }; } }) as any;
const tool = TOOLS[0];
const assert = (c: boolean, w: string) => { if (!c) throw new Error(w); console.log("  ok   " + w); };
const P = (v: unknown) => Math.round(Number(v) * 100);
const row = (t: any, first: string) => t.rows.find((r: any) => String(r.c0).startsWith(first));

Deno.test("the tool: one, strict, label books, after the reports", () => {
  const strict = (s: any): boolean => s.type !== "object" || (s.additionalProperties === false && JSON.stringify(Object.keys(s.properties).sort()) === JSON.stringify([...s.required].sort()) && Object.values(s.properties).every(strict));
  assert(TOOLS.length === 1 && tool.name === "depreciation_schedule" && strict(tool.input_schema) && tool.label === "books", "depreciation_schedule: strict schema, label books");
  const names = EXT_TOOLS.map((t) => t.name);
  assert(names.indexOf("depreciation_schedule") === names.indexOf("dcf_model") + 1 && new Set(names).size === names.length, "registered once, after the reports (" + names.join(", ") + ")");
});
Deno.test("both: the Companies Act and income-tax schedules to the paisa", async () => {
  const r = await tool.run({ client: null, year: "2025-26", basis: "both" }, mk("me"));
  assert(!r.error, "ran: " + (r.error || ""));
  const [cls, assets, blocks, dt, je] = r.tables! as any[];
  // Edge Binding Machine 20,454.55 + 3,435.62 = 23,890.17; HP Laptop 12,726.58 to its sale; AC nil: 36,616.75
  assert(P(row(cls, "Plant and machinery").c6) === 2389017 && P(row(cls, "Computers: end user").c7) === 3272658 && P(row(cls, "Office equipment").c9) === 225000, "by class: 23,890.17; 32,726.58 taken off; 2,250 left");
  assert(P(cls.summary!.companies_act_depreciation) === 3661675, "Companies Act depreciation 36,616.75");
  assert(P(row(assets, "HP Laptop").c11) === -127342 && P(row(assets, "Edge Binding Machine").c8) === 2389017, "asset by asset: the laptop's loss (1,273.42), the machine's 23,890.17");
  // 15%: 2,10,000 x 15% + 1,50,000 x 7.5% = 42,750, closing 3,17,250; 40%: emptied, STCL 7,000
  const b15 = row(blocks, "Plant and machinery, general"), b40 = row(blocks, "Computers including");
  assert(P(b15.c7) === 4275000 && P(b15.c9) === 31725000 && P(b15.c4) === 15000000 && P(b40.c6) === 700000 && P(b40.c9) === 0, "blocks: 42,750 and closing 3,17,250; STCL 7,000");
  // deferred tax 51,109.83 x 25.168% = 12,863.32 less 39,250 x 25.168% = 9,878.44: 2,984.88
  assert(P(dt.rows[3].c2) === 1286332 && P(dt.rows[4].c2) === 298488, "deferred tax 12,863.32, movement 2,984.88");
  assert(P(je.rows[0].c1) === 3661675 && P(je.rows.find((x: any) => /Provision for Dep/.test(x.c0)).c2) === 2389017 && /nothing is posted/.test(je.title), "the suggested journal: Dr 36,616.75, Cr 23,890.17 to the block's provision; not posted");
  assert(r.files!.length === 1 && uploaded.some((n) => n.endsWith("depreciation-2025-26.xlsx")), "the Excel");
  assert(/36616\.75/.test(r.forModel!) && /42750/.test(r.forModel!) && /nothing is posted/.test(r.forModel!), "for the model: " + r.forModel);
});
Deno.test("basis: one Act at a time", async () => {
  const it = await tool.run({ client: null, year: "2025-26", basis: "income_tax" }, mk("me"));
  assert(it.tables!.length === 1 && /Income-tax/.test(it.tables![0].title) && !/36616/.test(it.forModel!), "income_tax: the blocks only");
  const ca = await tool.run({ client: null, year: "2025-26", basis: "companies_act" }, mk("me"));
  assert(ca.tables!.length === 3 && ca.tables!.every((t) => !/Income-tax/.test(t.title)), "companies_act: classes, assets, the journal");
});
Deno.test("no register, another firm: said, never made up", async () => {
  const none = await tool.run({ client: null, year: "2024-25", basis: null }, mk("me"));
  assert(!!none.error && /No fixed asset register/.test(none.error!) && /2025-26/.test(none.error!), "a year with no register: " + none.error);
  // a member of another firm: asst_dep_register gives only that firm's own client of the same id (with DEP_RPC), or nothing
  const st = await tool.run({ client: null, year: "2025-26", basis: null }, mk("stranger"));
  assert(!JSON.stringify(st).includes("Edge Binding Machine") && !JSON.stringify(st).includes("36616.75"), "a member of another firm: never this firm's register (" + (st.error || st.tables!.length + " tables of its own") .slice(0, 60) + ")");
});
Deno.test("tax_audit_draft: clause 18 from the register", async () => {
  const r = await REPORTS.find((t) => t.name === "tax_audit_draft")!.run({ client: null, year: "2025-26" }, mk("me"));
  const c18 = r.tables![0].rows.find((x: any) => x.no === "18") as any;
  assert(c18.src === "books" && c18.rows === 2, "clause 18: the register's two blocks, from the books");
});
