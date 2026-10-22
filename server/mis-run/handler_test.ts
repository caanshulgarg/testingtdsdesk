// deno test --allow-all server/mis-run/handler_test.ts - My MIS on a schedule (ROUND 105 B6): the mis-run function with a
// fake Supabase (REST, RPC, Storage, the user check) and a fake Resend; made-up books in the cloud copy's shape.
//   - the timer's call (x-cron-key) runs what mis_take gives; a wrong key is refused;
//   - a run: the report's Excel (a sheet per block, the names UNIT and DEC, the figures as formulas, the books' figures) and
//     PDF (opens, A4) kept in mis-reports under the firm's folder; the bell row; the run logged (mis_runs, ok, the files)
//   - email: sent once through Resend with both files to the members chosen and the addresses typed, when the key is
//     there; without it "not set up" and no call to Resend
//   - a failure (the cloud copy unreadable) is tried once more, then logged as failed and the bell says why
//   - a person: owner or staff runs a schedule of their firm now; a look-only member and another firm's schedule are refused
import { handler } from "./handler.ts";
import { cloudData } from "./data.ts";
import { run } from "../../app/src/lib/misCustom.js";
import { normalizeDef } from "../_shared/misdef.js";
import ExcelJS from "npm:exceljs@4.4.0";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
const FIRM = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222", OWNER = "aaaaaaaa-0000-4000-8000-000000000001", LOOK = "aaaaaaaa-0000-4000-8000-000000000003";
const BOOK = "bbbbbbbb-0000-4000-8000-000000000001";

// made-up books: sales to two customers (one with bills), salaries, rent, a bank; April to September 2026
const LEDGERS = [["Sales - Services", ["Sales Accounts"], 0], ["Rent", ["Indirect Expenses"], 0], ["Salaries", ["Indirect Expenses"], 0], ["Kaveri Bank", ["Bank Accounts", "Current Assets"], -500000],
  ["Orchid Lane", ["Sundry Debtors", "Current Assets"], 0], ["Quill LLP", ["Sundry Debtors", "Current Assets"], -20000], ["Nightjar Co", ["Sundry Creditors", "Current Liabilities"], 30000], ["Capital", ["Capital Account"], 490000]].map(([name, chain, open]) => ({ name, parent: (chain as string[])[0], chain, open, primary_group: (chain as string[]).at(-1) }));
const V: any[] = [], L: any[] = [], BL: any[] = [];
let n = 0;
const vch = (day: string, vtype: string, party: string, lines: [string, number, any[]?][]) => {
  const guid = "g" + (++n); V.push({ guid, day, vtype, vno: String(n), party, narration: vtype + " " + n });
  lines.forEach(([l, a, b]) => { L.push({ guid, ledger: l, amount: a, day }); (b || []).forEach((x: any) => BL.push({ guid, ledger: l, name: x[0], type: x[1], amount: x[2], credit_days: x[3] || 0, day })); });
};
for (const [m, amt] of [["04", 100000], ["05", 150000], ["06", 120000], ["07", 90000], ["08", 200000], ["09", 160000]] as [string, number][]) {
  vch("2026-" + m + "-05", "Sales", "Orchid Lane", [["Orchid Lane", -amt, [["OL/" + m, "New Ref", -amt, 30]]], ["Sales - Services", amt]]);
  vch("2026-" + m + "-10", "Sales", "Quill LLP", [["Quill LLP", -amt / 2], ["Sales - Services", amt / 2]]);
  vch("2026-" + m + "-28", "Payment", "", [["Salaries", -40000], ["Kaveri Bank", 40000]]);
  vch("2026-" + m + "-01", "Journal", "Nightjar Co", [["Rent", -25000], ["Nightjar Co", 25000, [["NJ/" + m, "New Ref", 25000, 0]]]]);
}
vch("2026-08-20", "Receipt", "Orchid Lane", [["Kaveri Bank", -250000], ["Orchid Lane", 250000, [["OL/04", "Agst Ref", 100000], ["OL/05", "Agst Ref", 150000]]]]);
const DEF = { id: "m1", name: "Monthly MIS", period: { kind: "ytd" }, units: { unit: 1000, dec: 0 }, blocks: [
  { id: "b1", type: "table", title: "Profit and loss", rows: { by: "head" }, cols: { by: "month" } },
  { id: "b2", type: "chart", title: "Sales by customer", rows: { by: "customer", top: 5, others: true }, cols: { by: "month" }, chart: { type: "stacked" } },
  { id: "b3", type: "table", title: "Owed to you", rows: { by: "ageing", side: "r" } },
  { id: "b4", type: "kpi", title: "Cash and bank", rows: { by: "ledger", under: ["Bank Accounts", "Cash-in-Hand"] }, measure: "close", cols: { by: "year" } }] };
const SCHED = (o: any = {}) => ({ id: "s-1", firm_id: FIRM, client_id: "c-1", report_id: "m1", report_name: "Monthly MIS", rule: { freq: "monthly", day: "1", time: "08:45" }, period: "lastMonth",
  recipients: { members: [OWNER], emails: ["director@client.example"] }, enabled: true, created_by: OWNER, ...o });

function stand(o: { resend?: boolean, failReads?: number, due?: any[], member?: string } = {}) {
  const st: any = { uploads: [] as any[], alerts: [] as any[], runs: [] as any[], resend: [] as any[], takes: 0, reads: 0 };
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
  const f = async (input: any, init: any = {}) => {
    const u = new URL(String(input)), p = u.pathname + u.search, auth = String((init.headers || {}).Authorization || "");
    if (u.host === "api.resend.com") { st.resend.push(JSON.parse(init.body)); return json({ id: "re_1" }); }
    if (p.startsWith("/storage/v1/object/mis-reports/")) { st.uploads.push({ path: decodeURIComponent(u.pathname.slice("/storage/v1/object/mis-reports/".length)), type: init.headers["Content-Type"], bytes: init.body }); return json({ Key: "x" }); }
    if (p === "/auth/v1/user") return auth === "Bearer tok-owner" ? json({ id: OWNER }) : auth === "Bearer tok-look" ? json({ id: LOOK }) : json({ msg: "bad" }, 401);
    if (p.startsWith("/rest/v1/rpc/gst_cron_ok")) return json(JSON.parse(init.body).k === "k-123");
    if (p.startsWith("/rest/v1/rpc/mis_take")) { st.takes++; return json(st.takes === 1 ? (o.due || [SCHED()]) : []); }
    if (p.startsWith("/rest/v1/rpc/mis_cloud_gst")) return json({ months: [] });
    if (p.startsWith("/rest/v1/platform_secrets")) return json(o.resend && /resend_api_key/.test(p) ? [{ value: "re_key" }] : []);
    if (p.startsWith("/rest/v1/members")) return json(/user_id=eq\./.test(p) ? [{ firm_id: FIRM, role: decodeURIComponent(p).includes(LOOK) ? "readonly" : "owner", active: true }] : [{ user_id: OWNER, email: "anshul@firm.example" }]);
    if (p.startsWith("/rest/v1/mis_schedules")) return json(decodeURIComponent(p).includes("firm_id=eq." + FIRM) && p.includes("id=eq.s-1") ? [SCHED()] : []);
    if (p.startsWith("/rest/v1/client_book_items")) return json([{ data: { id: "m1", name: "Monthly MIS", def: DEF } }]);
    if (p.startsWith("/rest/v1/clients")) return json([{ name: "Larkspur Made-up Events" }]);
    if (p.startsWith("/rest/v1/tally_books")) { st.reads++; if (st.reads <= (o.failReads || 0)) return json({ message: "the cloud copy is busy" }, 503); return json([{ book_id: BOOK, client_id: "c-1", company: "LARKSPUR", from_date: "2026-04-01", open_as_on: "2026-04-01" }]); }
    if (p.startsWith("/rest/v1/tally_ledgers")) return json(/offset=0/.test(p) ? LEDGERS : []);
    if (p.startsWith("/rest/v1/tally_vouchers")) { const to = (p.match(/day=lte\.([\d-]+)/) || [])[1]; return json(/offset=0/.test(p) ? V.filter((v) => v.day <= to) : []); }
    if (p.startsWith("/rest/v1/tally_lines")) { const to = (p.match(/day=lte\.([\d-]+)/) || [])[1]; return json(/offset=0/.test(p) ? L.filter((v) => v.day <= to) : []); }
    if (p.startsWith("/rest/v1/tally_bills")) { const to = (p.match(/day=lte\.([\d-]+)/) || [])[1]; return json(/offset=0/.test(p) ? BL.filter((v) => v.day <= to) : []); }
    if (p.startsWith("/rest/v1/tally_alerts")) { st.alerts.push(JSON.parse(init.body)); return json([{ id: st.alerts.length }]); }
    if (p.startsWith("/rest/v1/mis_runs")) { const r = { id: st.runs.length + 1, ...JSON.parse(init.body) }; st.runs.push(r); return json([r]); }
    return json({ message: "not stood in: " + p }, 404);
  };
  const h = handler({ env: (k) => ({ SUPABASE_URL: "http://sb.test", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon-key" } as Record<string, string>)[k],
    fetch: f as typeof fetch, now: () => new Date("2026-10-01T03:15:00Z"), excel: async () => ExcelJS });
  const call = (body: unknown, headers: Record<string, string> = {}) => h(new Request("http://x/", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://staging.fincom.live", ...headers }, body: JSON.stringify(body) }));
  return { st, call };
}

Deno.test("the timer: a wrong key is refused; the right one runs what is due: the Excel and PDF kept, the bell, the run logged; email not set up", async () => {
  const { st, call } = stand();
  eq((await call({ action: "due" }, { "x-cron-key": "wrong" })).status, 401, "a wrong cron key");
  const r = await call({ action: "due" }, { "x-cron-key": "k-123" }), j = await r.json();
  eq([r.status, j.runs], [200, [{ schedule: "s-1", ok: true }]], "one schedule run");
  eq(st.uploads.map((u: any) => [u.path.split("/").slice(0, 2).join("/"), u.path.split(".").pop(), u.type.split("/")[1].slice(0, 5)]), [[FIRM + "/c-1", "xlsx", "vnd.o"], [FIRM + "/c-1", "pdf", "pdf"]], "both files under the firm's own folder");
  const run = st.runs[0];
  eq([run.status, run.email, run.by_whom, run.attempt, run.files.length], ["ok", "not set up", "timer", 1, 2], "the run logged: ok, email not set up");
  eq(run.period, { from: "20260901", to: "20260930" }, "last month, in IST (run on 1 October)");
  assert(st.alerts.length === 1 && st.alerts[0].kind === "summary" && /Monthly MIS for Larkspur Made-up Events is ready/.test(st.alerts[0].words) && /email is not set up/.test(st.alerts[0].words) && st.alerts[0].data.what === "mis", "the bell row: " + JSON.stringify(st.alerts[0]));
  eq(st.resend.length, 0, "no call to Resend without its key");
  // the files open, with the books' figures
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(st.uploads[0].bytes);
  eq(wb.worksheets.map((w: any) => w.name), ["Inputs", "Profit and loss", "Sales by customer", "Owed to you", "Cash and bank"], "Inputs and a sheet per block");
  assert(wb.definedNames.getRanges("UNIT").ranges.length === 1 && wb.definedNames.getRanges("DEC").ranges.length === 1, "the names UNIT and DEC");
  const pl: any = wb.getWorksheet("Profit and loss"), rev = (() => { let r = 0; pl.eachRow((row: any, i: number) => { if (row.getCell(1).value === "Revenue from operations") r = i; }); return r; })();
  const cell: any = pl.getRow(rev).getCell(2);
  assert(typeof cell.value === "object" && /ROUND\(.*\/UNIT,DEC\)/.test(cell.value.formula) && cell.value.result === 240, "September's revenue: a formula, 2,40,000 in thousands = 240 (" + JSON.stringify(cell.value) + ")");
  const pdf = await PDFDocument.load(st.uploads[1].bytes);
  // samples for a person to look at (MISRUN_SAMPLES=<dir>)
  const dir = Deno.env.get("MISRUN_SAMPLES"); if (dir) { await Deno.writeFile(dir + "/mis-run-sample.xlsx", st.uploads[0].bytes); await Deno.writeFile(dir + "/mis-run-sample.pdf", st.uploads[1].bytes); }
  assert(pdf.getPageCount() >= 1 && Math.round(pdf.getPage(0).getWidth()) === 595, "the PDF opens, A4");
});

Deno.test("email: sent once through Resend with both files, to the member chosen and the address typed", async () => {
  const { st, call } = stand({ resend: true });
  await call({ action: "due" }, { "x-cron-key": "k-123" });
  eq(st.resend.length, 1, "one email");
  const m = st.resend[0];
  eq(m.to, ["anshul@firm.example", "director@client.example"], "to the member and the director");
  eq(m.attachments.map((a: any) => a.filename.split(".").pop()), ["xlsx", "pdf"], "both files attached");
  assert(/^FinCom MIS <mis@fincom\.live>$/.test(m.from) && /Monthly MIS for Larkspur Made-up Events is ready/.test(m.subject), "from FinCom MIS, the subject says what it is");
  eq([st.runs[0].email, st.runs[0].sent_to.length], ["sent", 2], "the run says sent, to two");
});

Deno.test("a failure is tried once more, then logged as failed and the bell says why", async () => {
  const s1 = stand({ failReads: 1 });
  await s1.call({ action: "due" }, { "x-cron-key": "k-123" });
  eq([s1.st.runs.length, s1.st.runs[0].status, s1.st.runs[0].attempt], [1, "ok", 2], "a first failure, then it worked on the second try");
  const s2 = stand({ failReads: 5 });
  const j = await (await s2.call({ action: "due" }, { "x-cron-key": "k-123" })).json();
  eq(j.runs, [{ schedule: "s-1", ok: false }], "failed twice");
  eq([s2.st.runs.length, s2.st.runs[0].status, s2.st.runs[0].attempt, s2.st.uploads.length], [1, "failed", 2, 0], "logged once as failed after two tries; no file kept");
  assert(/could not be prepared: the cloud copy is busy/.test(s2.st.alerts[0].words), "the bell says why: " + s2.st.alerts[0].words);
});

Deno.test("a person: owner or staff run their firm's schedule now; look-only and another firm's are refused", async () => {
  const { st, call } = stand();
  eq((await call({ action: "run", schedule_id: "s-1" })).status, 401, "not signed in");
  eq((await call({ action: "run", schedule_id: "s-1" }, { Authorization: "Bearer tok-look" })).status, 403, "look-only");
  eq((await call({ action: "run", schedule_id: "s-9" }, { Authorization: "Bearer tok-owner" })).status, 404, "not one of the firm's");
  const r = await call({ action: "run", schedule_id: "s-1" }, { Authorization: "Bearer tok-owner" });
  eq([r.status, st.runs[0].by_whom, st.takes], [200, "person", 0], "run now by the owner (the timer's queue untouched)");
});

Deno.test("the cloud copy made into the engine's input: the same figures as the books", () => {
  const data = cloudData({ book: { from_date: "2026-04-01", company: "LARKSPUR" }, ledgers: LEDGERS, vouchers: V, lines: L, bills: BL }, DEF, "20261001");
  const res: any = run(normalizeDef({ ...DEF, period: { kind: "range", from: "20260401", to: "20260930" } }).def, data, { today: "20261001" });
  const pl = res.blocks[0], row = (k: string) => pl.rows.find((r: any) => r.key === k).cells.t;
  eq([row("head:rev"), row("head:emp"), row("head:exp"), row("head:pbt")], [1230000, 240000, 150000, 840000], "revenue 12,30,000; salaries 2,40,000; rent 1,50,000; profit 8,40,000");
  eq(res.blocks[1].total.cells.t, 1230000, "sales by customer add to the revenue");
  eq(res.blocks[2].total.cells.t, 1000000, "owed to you on 30-Sep: Orchid 8,20,000 - 2,50,000 + Quill 20,000 + 4,10,000 (its opening and half the sales) = 10,00,000");
  eq(res.blocks[3].kpi.value, 500000 - 240000 + 250000, "cash and bank on 30-Sep: 5,00,000 less salaries plus the receipt");
});
