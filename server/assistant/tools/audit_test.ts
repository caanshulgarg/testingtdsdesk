// deno test --allow-read --allow-env server/assistant/tools/audit_test.ts - the Assistant's audit tools (tools/audit.ts) on
// what asst_audit_wp (migration-78-audit.sql) returned on the stand for the fixture's kept run (tests/run_audit_wp_tool.py
// writes AUDIT_WP_RPC and AUDIT_WP_ITEMS, then runs this). Checks: the strict schemas; audit_run's table equals the
// browser's run to the paisa, in rank order, with the reviewer's status and remark; the label; what the model reads;
// commentary only on request and given only figures in the table; audit_check's entries with their voucher ids; the
// latest period when none is named; the errors (not run, another client, a period not understood); the period words
// read as AuditWP.parsePeriod reads them.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { TOOLS, periodKey, CHECKS } from "./audit.ts";
import { EXT_TOOLS } from "./index.ts";
import type { ExtCtx } from "./types.ts";

const RPC = JSON.parse(Deno.readTextFileSync(Deno.env.get("AUDIT_WP_RPC") || "tests/out/audit-wp-rpc.json"));
const IT = JSON.parse(Deno.readTextFileSync(Deno.env.get("AUDIT_WP_ITEMS") || "tests/out/audit-wp-items.json"));
const run = TOOLS.find((t) => t.name === "audit_run")!, check = TOOLS.find((t) => t.name === "audit_check")!;

function ctx(o: Partial<ExtCtx> = {}, who = "me") {
  const calls: Record<string, unknown>[] = [], ai: string[] = [];
  const c: ExtCtx = { clientId: "larkspur", clientName: "Larkspur Audit Fixture Private Limited", today: "2026-10-13", firm: { name: "Garg Test Firm", lines: [] },
    rpc: (fn, args) => { calls.push({ fn, ...args }); return Promise.resolve(RPC[who][String(args.p_period ?? "null")] ?? null); },
    book: () => Promise.reject(new Error("no book tool is used")), makeFile: () => Promise.resolve(null), uploadFile: () => Promise.resolve(null),
    progress: () => {}, aiText: (p) => { ai.push(p); return Promise.resolve("AI note"); }, ...o };
  return { c, calls, ai };
}

Deno.test("schemas are strict, the tools are registered, the order is fixed", () => {
  for (const t of TOOLS) {
    const s = t.input_schema as any;
    assertEquals(s.additionalProperties, false);
    assertEquals([...s.required].sort(), Object.keys(s.properties).sort());
    assert(!/minimum|maximum|maxLength|minLength|format/.test(JSON.stringify(s)), "no minimum, maxLength or format");
    assertEquals(t.label, "books");
  }
  assertEquals(EXT_TOOLS.filter((t) => t.name.startsWith("audit_")).map((t) => t.name), ["audit_run", "audit_check"]);
  assertEquals(CHECKS.map(([id]) => id), IT.run.checks.map((c: any) => c.id));
  assert(run.words.test("audit the books for 2025-26") && run.words.test("show the working papers") && !run.words.test("what is the TDS rate on rent"));
});

Deno.test("audit_run: FinCom's figures to the paisa, in rank order, with the review", async () => {
  const { c, calls, ai } = ctx();
  const out = await run.run({ client: null, period: "2025-26", commentary: null }, c);
  assertEquals(out.error, undefined);
  assertEquals(calls, [{ fn: "asst_audit_wp", p_period: IT.period }]);
  const t = out.tables![0], want = IT.run.checks.slice().sort((a: any, b: any) => (a.rank ?? 99) - (b.rank ?? 99) || b.score - a.score || a.id.localeCompare(b.id));
  assertEquals(t.rows.map((r) => [r.id, r.entries, r.amount, r.score, r.rank]), want.map((x: any) => [x.id, x.count, x.amount, x.score, x.rank]));
  const fl = IT.run.checks.filter((x: any) => x.status === "flag");
  assertEquals(t.summary!.flagged, fl.length);
  assertEquals(t.summary!.amount, Math.round(fl.reduce((s: number, x: any) => s + x.amount, 0) * 100) / 100);
  assertEquals(t.summary!.code, IT.run.code);
  const r269 = t.rows.find((r) => r.id === "cash269ST")!;
  assertEquals([r269.review, r269.remark], ["Issue", "Receipts to be explained by the client"]);
  assertEquals(t.rows.find((r) => r.id === "round")!.review, "Reviewed");
  assertEquals(t.rows.find((r) => r.id === "benford")!.result, "OK");
  assertEquals(t.period, { from: "2025-04-01", to: "2026-03-31" });
  assert(/no AI/.test(t.basis || "") && t.basis!.includes(IT.run.code));
  for (const x of fl) assert(out.forModel!.includes(x.id + ": " + x.count + " entries, ₹" + x.amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })), "the model reads " + x.id);
  assertEquals(out.aiText, undefined); assertEquals(ai.length, 0);
});

Deno.test("commentary: only on request, given only the table's figures", async () => {
  const { c, ai } = ctx();
  const out = await run.run({ client: "Larkspur Audit Fixture Private Limited", period: "20250401-20260331", commentary: true }, c);
  assertEquals(out.aiText, "AI note");
  assertEquals(ai.length, 1);
  const t = out.tables![0], allowed = new Set<string>();
  t.rows.forEach((r) => [r.entries, r.amount, r.rank, r.score].forEach((v) => v != null && allowed.add(String(v))));
  // every number in the prompt is a rank, a count or an amount of the table; the checks' names and sections are taken out first
  let p = ai[0]; t.rows.forEach((r) => { p = p.split(String(r.law)).join(" ").split(String(r.check)).join(" "); });
  p = p.replace("at most 200 words", "").replace("Form 3CD", "");
  const nums = (p.replace(/₹([\d,]+\.\d{2})/g, (_m, a) => " " + a.replace(/,/g, "") + " ").match(/\b\d[\d.]*\b/g) || []).map((n) => String(Number(n)));
  assert(nums.length >= 3, "the prompt carries the figures");
  for (const n of nums) assert(allowed.has(n), "a figure not in the table: " + n);
});

Deno.test("audit_check: the entries with their voucher ids", async () => {
  const { c } = ctx();
  const out = await check.run({ client: null, period: "2025-26", check: "cash269ST" }, c);
  const t = out.tables![0], w = IT.run.checks.find((x: any) => x.id === "cash269ST");
  assertEquals(t.summary!.count, w.count); assertEquals(t.summary!.amount, w.amount);
  assertEquals(t.rows.map((r) => r.guid), w.vids);
  assertEquals(t.rows.map((r) => r.amount), [200500.5, 210000.5]);
  assertEquals(t.rows.map((r) => r.date), ["2025-07-03", "2025-07-04"]);
  const b = await check.run({ client: null, period: "2025-26", check: "benford" }, c);
  assertEquals(b.tables![0].summary!.pass, true);
  assertEquals((await check.run({ client: null, period: "2025-26", check: "nope" }, c)).error?.startsWith("check must be"), true);
});

Deno.test("no period: the latest run; errors said plainly", async () => {
  const { c, calls } = ctx();
  const out = await run.run({ client: null, period: null, commentary: null }, c);
  assertEquals(calls.map((x) => x.p_period), [null, IT.period]);
  assertEquals(out.tables![0].summary!.code, IT.run.code);
  assert(/has not been run/.test((await run.run({ client: null, period: "Q2 2025-26", commentary: null }, c)).error || ""), "a period not run");
  assert(/client open in FinCom/.test((await run.run({ client: "Someone Else Ltd", period: "2025-26", commentary: null }, c)).error || ""), "another client");
  assert(/Say the period/.test((await run.run({ client: null, period: "last year", commentary: null }, c)).error || ""), "a period not understood");
  // another firm's member: only that firm's own client of the same id (row-level security), never this firm's run
  const s = ctx({}, "stranger");
  const o = await run.run({ client: null, period: "2025-26", commentary: null }, s.c);
  assertEquals(o.tables![0].summary!.code, "OTHERFIRM");
  assert(o.tables![0].rows.every((r) => r.review === "Not reviewed" && r.remark === ""), "and none of this firm's papers");
});

Deno.test("periods read as the browser reads them (AuditWP.parsePeriod)", () => {
  for (const [s, p] of IT.periods as [string, { from: string, to: string } | null][]) assertEquals(periodKey(s), p ? p.from + "-" + p.to : null, s);
});
