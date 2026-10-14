// deno test --allow-read --allow-run --allow-env --allow-sys --allow-net server/assistant/tools/certificates_test.ts
// (tests/run_certificates.py). The certificates through the Assistant's turn (agent.ts runTurn) with Claude MOCKED: a
// conversation of four turns for three clients (an ambiguous name, a year with no signed statements answered by a typed
// figure, signed statements uploaded as text PDFs and read by FinCom, books used only when the user says so), the firm's
// details asked once, the figures confirmed before anything is made, then Word, PDF and the summary Excel in one pack with
// the right figures and the UDIN blank; "same certificates for more clients" asks nothing of the firm again; an uploaded
// Word format with placeholders is filled. Every company, person and figure here is made up.
import { runTurn, TurnCtx } from "../agent.ts";
import { prepare } from "./certificates.ts";
import { docxText, inr, netWorth, unzip, zip } from "./certlib.ts";
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import * as pdfjs from "npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs";
import ExcelJS from "npm:exceljs@4.4.0";

const ok = (c: unknown, w: string) => { if (!c) throw new Error(w); console.log("  ok   " + w); };
const eq = (a: unknown, b: unknown, w: string) => ok(JSON.stringify(a) === JSON.stringify(b), w + (JSON.stringify(a) === JSON.stringify(b) ? "" : ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b)));

// ---- the made-up company's books (tests/reports_fixtures.js, FY 2025-26), as migration 79's rpt_tb gives them
const root = new URL("../../../", import.meta.url).pathname;
const fxo = new Deno.Command("node", { args: ["-e", `const F=require('./tests/reports_fixtures');const X=F.loadFSX();const c=F.company();const st=F.confirmed(X,c);
  const r=X.run(Object.assign({},c,{mapStore:st}));const n=r.model.nm;process.stdout.write(JSON.stringify({c,st,rev:n.L_rev_CY,share:n.L_share_CY,res:n.L_reserves_CY}));`], cwd: root, stdout: "piped" }).outputSync();
const fx = JSON.parse(new TextDecoder().decode(fxo.stdout));
const tbRows = fx.c.tb.map((t: any) => ({ l: t.l, parent: t.g[0] || "", chain: t.g.slice(1), o: t.o, d: t.d, c: t.c }));
const BOOKS = { turnover: fx.rev / 100, share: fx.share / 100, reserves: fx.res / 100 };

// ---- Claude, mocked (as assistant_test.ts)
type B = Record<string, unknown>;
class MockClaude {
  calls: any[] = [];
  constructor(public script: (B[] | ((p: any) => B[]))[]) {}
  beta = { messages: { stream: (p: any) => {
    const n = this.calls.length; this.calls.push({ ...p, messages: [...p.messages] });
    const st = this.script[n] ?? [{ type: "text", text: "(end)" }];
    const content = (typeof st === "function" ? st(p) : st).map((b, i) => b.type === "tool_use" ? { id: "toolu_" + n + "_" + i, ...b } : b);
    const evs: any[] = []; content.forEach((b: any, i: number) => { evs.push({ type: "content_block_start", index: i, content_block: b.type === "text" ? { type: "text", text: "" } : b }); if (b.type === "text") evs.push({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } }); evs.push({ type: "content_block_stop", index: i }); });
    const msg = { content, stop_reason: content.some((b: any) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { input_tokens: 9000, output_tokens: 400, cache_read_input_tokens: 0 } };
    return { async *[Symbol.asyncIterator]() { for (const e of evs) yield e; }, finalMessage: async () => msg };
  } } };
}
const tool = (input: B): B => ({ type: "tool_use", name: "certificate_prepare", input });
const text = (t: string): B => ({ type: "text", text: t });
// the tool's answer to the model, from the call after it
const toolResult = (c: MockClaude, n = 1) => { const m = c.calls[n].messages; const last = m[m.length - 1]; return String((last.content || []).find((b: any) => b.type === "tool_result")?.content || ""); };

// ---- signed statements as text PDFs (as an auditor's PDF export has them)
async function signedPdf(name: string, fy: number, lines: [string, string, string?][]): Promise<Uint8Array> {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([595, 842]); let y = 790;
  const put = (s: string, x: number) => p.drawText(s, { x, y, size: 10, font: f });
  put(name.toUpperCase(), 50); y -= 18; put("Balance Sheet as at 31st March, " + (fy + 1), 50); y -= 18; put("Particulars    Note    31.03." + (fy + 1) + "    31.03." + fy, 50); y -= 18;
  for (const [l, a, b] of lines) { put(l, 50); put(a, 330); if (b) put(b, 450); y -= 16; if (l === "TOTAL") { y -= 10; put("Statement of Profit and Loss for the year ended 31st March, " + (fy + 1), 50); y -= 18; } }
  return await d.save();
}
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
async function pdfText(b: Uint8Array): Promise<string> {
  const doc = await (pdfjs as any).getDocument({ data: b.slice(), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise; let t = "";
  for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ") + "\n";
  return t;
}

// ---- the firm: three clients (and a fourth whose name is like the first), files, the store of migration 83
const CLIENTS = [{ client: "c-alder", name: "Alder Bright Castings Pvt Ltd", gstin: "09AAACA1111A1Z5", pan: "AAACA1111A" }, { client: "c-alder-x", name: "Alder Bright Exports Pvt Ltd", gstin: "09AAACA2222B1Z5", pan: "AAACA2222B" },
  { client: "c-birch", name: "Birchwood Traders", gstin: "09AAAFB3333C1Z5", pan: "AAAFB3333C", address: "12 Lantern Street, Faketown 100001" }, { client: "c-cedar", name: "Cedar & Co LLP", gstin: "", pan: "AAAFC4444D" },
  { client: "c-dove", name: "Dovetail Prints Pvt Ltd", gstin: "", pan: "AAACD5555E" }];
const files = new Map<string, Uint8Array>();
const settings: Record<string, unknown>[] = [], formats: any[] = [], figrows: any[] = [], made: Record<string, Uint8Array> = {};
const store = {
  settings: async () => settings.length ? { ...settings[settings.length - 1] } : null,
  saveSettings: async (s: any) => { settings.push({ ...s }); },
  formats: async () => formats, saveFormat: async (f: any) => { formats.push({ id: "f" + formats.length, ...f }); return "f" + (formats.length - 1); },
  figures: async (c: string, fy: string) => [...figrows].reverse().find((r) => r.client === c && r.fy === fy) || null,
  saveFigures: async (r: any) => { figrows.push(r); },
  keep: async (path: string, name: string) => { const to = "F/_firm/settings/" + name; files.set(to, files.get(path)!); return to; },
};
const cap = { ok: true, used: 0, cap: 500 };
function turn(c: MockClaude, question: string, history: { role: "user" | "assistant", content: string }[], uploads: string[], over: Partial<TurnCtx> = {}) {
  const events: any[] = [];
  const ctx: TurnCtx = { client: c as any, question, history, attachments: [], clientId: null, clientName: "", firmWide: true, today: "2026-10-14", books: "",
    exec: async (fn, a: any) => fn === "asst_clients" ? { rows: CLIENTS.filter((x) => !a.p_text || x.name.toLowerCase().includes(String(a.p_text).toLowerCase())) }
      : fn === "rpt_tb" ? (a.p_client === "c-alder" && a.p_from === "2025-04-01" ? { ok: true, rows: tbRows } : { ok: false, why: "not held" })
      : fn === "rpt_saved" ? (a.p_client === "c-alder" ? { rx: { kind: "company", map: fx.st, det: { "2025": Object.assign({}, fx.c.det, { entity: fx.c.entity }) } }, msme: {} } : { rx: {} })
      : { rows: [] },
    capTake: async () => cap, makeFile: async () => null, recordMismatch: async () => null, firm: { name: "", lines: [] }, emit: (e) => events.push(e), noFont: true, strict: true,
    uploads: uploads.map((p) => ({ path: p, name: p.split("/").pop()!, type: p.endsWith(".pdf") ? "application/pdf" : p.endsWith(".png") ? "image/png" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })),
    readFile: async (p) => files.get(p) || null, clientInfo: async (id) => CLIENTS.find((x) => x.client === id) || null, clientFiles: async (id) => id === "c-birch" ? [{ path: "F/c-birch/uploads/birchwood-signed-2025-26.pdf", name: "birchwood-signed-2025-26.pdf", type: "application/pdf" }] : [],
    certStore: store, uploadFile: async (b, name) => { made[name] = b; return { id: name, name, kind: name.split(".").pop()!, path: "F/_firm/files/" + name, expires: "" }; }, ...over };
  return { ctx, events };
}

async function setup() {
  if (files.size) return;
  // Birchwood's signed statements: 2023-24 and 2024-25 uploaded in the chat, 2025-26 kept with the client in FinCom
  const birch = (fy: number, cap: string, cur: string, rev: string) => signedPdf("Birchwood Traders", fy, [["Partners' capital accounts   3", cap], ["Partners' current accounts   4", cur], ["TOTAL", "99,99,999.00"], ["Revenue from operations   12", rev], ["Other income   13", "45,000.00"]]);
  files.set("F/_firm/uploads/birchwood-signed-2023-24.pdf", await birch(2023, "15,00,000.00", "1,00,000.00", "1,10,00,000.00"));
  files.set("F/_firm/uploads/birchwood-signed-2024-25.pdf", await birch(2024, "16,00,000.00", "1,50,000.00", "1,32,50,250.75"));
  files.set("F/c-birch/uploads/birchwood-signed-2025-26.pdf", await birch(2025, "18,00,000.00", "2,45,300.50", "1,52,30,400.00"));
  files.set("F/_firm/uploads/letterhead.png", PNG);
}
Deno.test("certificates in the chat: three clients, the questions, typed and signed figures, the books only when asked, confirmed, then the pack", async () => {
  await setup();
  const ask0 = { clients: ["Alder Bright", "Birchwood Traders", "Cedar & Co"], types: ["turnover", "net_worth"], years: null, last_years: 3, as_on: "2026-03-31", basis: null, format: null, format_name: null, addressee: null, purpose: null, date: null,
    figures: null, use_books: null, answers: null, firm: null, confirm: null };

  // ---- turn 1: the request in plain words
  const q1 = "Turnover certificate for last 3 years and net worth as on 31-Mar-2026 for Alder Bright, Birchwood Traders and Cedar & Co.";
  const c1 = new MockClaude([[tool(ask0)], [text("A few things first (listed below).")]]);
  const t1 = turn(c1, q1, [], ["F/_firm/uploads/birchwood-signed-2023-24.pdf", "F/_firm/uploads/birchwood-signed-2024-25.pdf"]);
  const r1 = await runTurn(t1.ctx);
  const res1 = toolResult(c1);
  eq(r1.route, "model", "not the keyword router (the word 'turnover' does not route to the turnover tool)");
  ok(r1.models.every((m) => /sonnet/.test(m)), "Sonnet, not Opus: " + r1.models.join());
  ok(/the firm's details once/.test(res1) && /FRN/.test(res1), "the firm's details are asked (once)");
  ok(/Which client is "Alder Bright": Alder Bright Castings Pvt Ltd .*Alder Bright Exports Pvt Ltd/.test(res1), "an ambiguous name is asked back with the candidates");
  ok(/Please upload the signed balance sheet and profit and loss of FY 2023-24 for Cedar & Co LLP, or type/.test(res1), "Cedar has no signed statements: upload or type");
  ok(!/Birchwood Traders, or type/.test(res1), "Birchwood asks nothing: its three years are read from the signed PDFs (two in the chat, one kept with the client)");
  const birchT = t1.events.find((e) => e.t === "result" && /^Birchwood/.test(e.title));
  eq(birchT.rows.filter((r: any) => /Turnover/.test(r.item)).map((r: any) => r.amount), [11000000, 13250250.75, 15230400], "Birchwood's turnover read from the signed PDFs, to the paisa");
  ok(birchT.rows.find((r: any) => /Turnover/.test(r.item)).source.includes("birchwood-signed-2023-24.pdf p.1 line"), "each figure shows the page and line it came from");
  eq(birchT.rows.find((r: any) => r.item === "Net worth").amount, 1800000 + 245300.5, "Birchwood's net worth: capital 18,00,000 + current 2,45,300.50 = 20,45,300.50");
  ok(!t1.events.some((e) => e.t === "file") && !Object.keys(made).length, "nothing made before the figures are confirmed");

  // ---- turn 2: the answers; Alder 2023-24 and 2024-25 typed; 2025-26 turnover typed, its net worth from the books (asked for)
  const ask2 = { ...ask0, answers: [{ client: "Alder Bright", field: "which", value: "Alder Bright Castings Pvt Ltd" }, { client: "Cedar & Co", field: "kind", value: "LLP" }],
    firm: { firm_name: "Example & Associates", frn: "000000X", signatory: "A. Example", designation: "Partner", membership_no: "123456", place: "Faketown", letterhead_file: "letterhead.png", default_format: null, use_these: null },
    figures: [{ client: "Alder Bright", year: "2023-24", item: "turnover", value: 4500000 }, { client: "Alder Bright", year: "2024-25", item: "turnover", value: 5100000 }, { client: "Alder Bright", year: "2025-26", item: "turnover", value: 10000000 },
      { client: "Cedar & Co", year: "2024-25", item: "turnover", value: 2200000 }, { client: "Cedar & Co", year: "2025-26", item: "turnover", value: 2650000 },
      { client: "Cedar & Co", year: "2025-26", item: "partners_capital", value: 1200000 }, { client: "Cedar & Co", year: "2025-26", item: "partners_current", value: 345678.9 }],
    use_books: [{ client: "Alder Bright", year: "2025-26" }] };
  const h1 = [{ role: "user" as const, content: q1 }, { role: "assistant" as const, content: "For the certificates FinCom needs: the firm's details; which Alder Bright; Cedar's figures." }];
  const c2 = new MockClaude([[tool(ask2)], [text("Still one year for Cedar.")]]);
  const t2 = turn(c2, "Example & Associates, FRN 000000X, A. Example partner M.No 123456, Faketown; letterhead attached. Alder Bright Castings. Alder's turnover 45,00,000 / 51,00,000 / 1,00,00,000; use the books for its net worth. Cedar is an LLP: ...", h1,
    ["F/_firm/uploads/birchwood-signed-2023-24.pdf", "F/_firm/uploads/birchwood-signed-2024-25.pdf", "F/_firm/uploads/letterhead.png"]);
  await runTurn(t2.ctx);
  const res2 = toolResult(c2);
  ok(!/firm's details once/.test(res2) && !/Use this letterhead/.test(res2) && settings.length === 1 && (settings[0] as any).letterhead_path, "the firm's details saved once, with the letterhead kept in the firm's settings");
  ok(/Please upload the signed balance sheet and profit and loss of FY 2023-24 for Cedar & Co LLP, or type the revenue from operations \(turnover\) as per it\. FinCom holds no books/.test(res2) && !/2024-25 for Cedar/.test(res2), "only Cedar's 2023-24 is still asked");
  ok(/Alder Bright Castings Pvt Ltd 2025-26: Revenue from operations \(turnover\) signed ₹1,00,00,000\.00 vs books ₹[\d,.]+ \([\d.]+% apart\)/.test(res2), "a books / signed difference above 1% is flagged in one line");
  ok(/Alder Bright Castings Pvt Ltd: FY 2025-26 is from the books, not audited/.test(res2), "the year from the books is flagged");
  const alder = t2.events.find((e) => e.t === "result" && /^Alder/.test(e.title));
  const nwB = netWorth({ share_capital: BOOKS.share, reserves: BOOKS.reserves }, "company").total;
  eq(alder.rows.find((r: any) => r.item === "Net worth").amount, nwB, "Alder's net worth from the books = capital + reserves of the books (FSX): " + inr(nwB));
  ok(alder.rows.filter((r: any) => r.year === "as on 31-03-2026" && r.amount).every((r: any) => r.item === "Net worth" || r.source === "from books, not audited"), "each books figure labelled 'from books, not audited'");

  // ---- turn 3: Cedar's 2023-24 typed; the user confirms; addressee and purpose given; the documents
  const ask3 = { ...ask2, firm: null, figures: [...ask2.figures, { client: "Cedar & Co", year: "2023-24", item: "turnover", value: 1875000.5 }], addressee: "The Branch Manager, Example Bank, Faketown", purpose: "renewal of the cash credit limit",
    answers: [...ask2.answers, { client: "Alder Bright", field: "address", value: "Plot 7, Industrial Area, Faketown" }, { client: "Cedar & Co", field: "address", value: "3 Pine Road, Faketown" }], confirm: true };
  const c3 = new MockClaude([[tool(ask3)], [text("The certificates are ready; the UDIN is left blank.")]]);
  const t3 = turn(c3, "Cedar 2023-24 turnover 18,75,000.50. Figures are fine, go ahead. Addressed to the Branch Manager, Example Bank, for renewal of the CC limit.", [...h1, { role: "user", content: "..." }, { role: "assistant", content: "Still one year for Cedar's certificate." }], ["F/_firm/uploads/birchwood-signed-2023-24.pdf", "F/_firm/uploads/birchwood-signed-2024-25.pdf"]);
  const r3 = await runTurn(t3.ctx);
  const res3 = toolResult(c3);
  ok(/UDIN is left blank/.test(res3) && /nothing was filed or sent/.test(res3), "the model is told: UDIN blank, nothing filed or sent");
  const zipName = Object.keys(made).find((n) => n.endsWith(".zip"))!;
  const z = await unzip(made[zipName]);
  const names = Array.from(z.keys()).sort();
  eq(names.filter((n) => /\.(docx|pdf)$/.test(n)).length, 6, "a Word and a PDF for each of the three clients: " + names.join(", "));
  ok(names.includes("Certificates-summary.xlsx") && t3.events.filter((e) => e.t === "file").length === 2, "the summary Excel in the pack, and the pack and the Excel listed in the chat");
  const word = (who: string) => docxText(z.get(names.find((n) => n.startsWith(who) && n.endsWith(".docx"))!)!);
  const pdfOf = (who: string) => pdfText(z.get(names.find((n) => n.startsWith(who) && n.endsWith(".pdf"))!)!);
  const wb = await word("Birchwood"), pb = await pdfOf("Birchwood");
  for (const v of ["1,10,00,000.00", "1,32,50,250.75", "1,52,30,400.00", "20,45,300.50"]) ok(wb.includes(v) && pb.replace(/\s+/g, " ").includes(v), "Birchwood's Word and PDF carry " + v);
  ok(/INDEPENDENT PRACTITIONER'S CERTIFICATE ON TURNOVER AND NET WORTH/.test(wb) && /The Branch Manager, Example Bank/.test(wb) && /Restriction on Use/.test(wb), "the ICAI format by default: title, addressee, restriction on use");
  ok(/UDIN: _{10,}/.test(wb) && /UDIN: _{10,}/.test(pb), "the UDIN is blank in Word and PDF");
  ok(/FRN: 000000X/.test(wb) && /M\. No\. 123456/.test(wb) && /Place: Faketown/.test(wb) && /Date: 14-10-2026/.test(wb), "the signature block from the firm's settings");
  const wa = await word("Alder");
  ok(/2025-26 \(as per books, not audited\)/.test(wa) && /books of account of the Company for the financial year 2025-26 \(not audited/.test(wa), "Alder's certificate states the books basis for 2025-26");
  ok(wa.includes("1,00,00,000.00") && wa.includes(inr(nwB, true)), "Alder: the typed turnover and the books' net worth");
  const wc = await word("Cedar");
  ok(wc.includes("18,75,000.50") && wc.includes("15,45,678.90") && /Partners' capital accounts/.test(wc), "Cedar (LLP): turnover 18,75,000.50; net worth 12,00,000 + 3,45,678.90 = 15,45,678.90");
  const docxZip = await unzip(z.get(names.find((n) => n.startsWith("Birchwood") && n.endsWith(".docx"))!)!);
  ok(docxZip.has("word/media/lh-head.png"), "the letterhead picture is in the Word file's header");
  const x = new ExcelJS.Workbook(); await x.xlsx.load(z.get("Certificates-summary.xlsx")!.buffer as ArrayBuffer);
  const vals: unknown[] = []; x.worksheets[0].eachRow((r) => vals.push(...(r.values as unknown[])));
  ok(vals.includes(15230400) && vals.includes(1545678.9), "the summary Excel has every client's figures as numbers");
  ok(figrows.some((r) => r.client === "c-birch" && r.fy === "2025" && r.figures.turnover.value === 15230400), "the confirmed figures are kept for next time");
  ok(r3.costUsd > 0 && r3.calls === 2, "two model calls, counted against the cap");

  // ---- turn 4: "same certificates for 2 more clients": the firm is not asked again; only what is missing
  const c4 = new MockClaude([[tool({ ...ask0, clients: ["Dovetail Prints"], addressee: ask3.addressee, purpose: ask3.purpose })], [text("Dovetail needs its signed statements.")]]);
  const t4 = turn(c4, "Same certificates for Dovetail Prints", [{ role: "user", content: q1 }, { role: "assistant", content: "The certificates are ready." }], []);
  await runTurn(t4.ctx);
  const res4 = toolResult(c4);
  ok(!/firm's details/.test(res4) && !/Use this letterhead/.test(res4) && /Dovetail Prints Pvt Ltd/.test(res4) && /FY 2023-24/.test(res4), "the repeat asks only Dovetail's figures, not the firm's details");
});

Deno.test("an uploaded Word format with placeholders: fields filled, the missing one asked, saved by name for reuse", async () => {
  if (!settings.length) settings.push({ firm_name: "Example & Associates", frn: "000000X", signatory: "A. Example", designation: "Partner", membership_no: "123456", place: "Faketown", confirmed: true });
  await setup();
  const P = (t: string) => '<w:p><w:r><w:t xml:space="preserve">' + t + "</w:t></w:r></w:p>";
  const cell = (t: string) => "<w:tc><w:p>" + (t ? "<w:r><w:t>" + t + "</w:t></w:r>" : "") + "</w:p></w:tc>";
  const doc = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + P("TO WHOMSOEVER IT MAY CONCERN") + P("This is to certify that {{Name of the Company}} having PAN [PAN] has the following turnover:") +
    "<w:tbl><w:tr>" + cell("Financial Year") + cell("Turnover (Rs.)") + "</w:tr><w:tr>" + cell("2024-25") + cell("") + "</w:tr><w:tr>" + cell("2025-26") + cell("") + "</w:tr></w:tbl>" +
    P("Tender No.: ________") + P("For {{Firm Name}} (FRN {{FRN}})") + P("UDIN: __________") + "</w:body></w:document>";
  files.set("F/_firm/uploads/tender-format.docx", zip([["word/document.xml", doc], ["[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>']]));
  const ask = { clients: ["Birchwood Traders"], types: ["turnover"], years: ["2024-25", "2025-26"], last_years: null, as_on: null, basis: null, format: "tender-format.docx", format_name: "Tender format A", addressee: null, purpose: null, date: null,
    figures: null, use_books: null, answers: null, firm: null, confirm: true };
  const { ctx } = turn(new MockClaude([]), "", [], ["F/_firm/uploads/birchwood-signed-2024-25.pdf", "F/_firm/uploads/tender-format.docx"]);
  const ectx: any = { clientId: null, clientName: "", today: "2026-10-14", firm: ctx.firm, rpc: () => null, book: () => null, makeFile: async () => null, uploadFile: ctx.uploadFile, progress: () => {}, aiText: async () => "",
    clients: async () => CLIENTS, clientInfo: ctx.clientInfo, clientFiles: ctx.clientFiles, rpcFor: () => null, uploads: ctx.uploads, readFile: ctx.readFile, store, noFont: true };
  const r1 = await prepare(ask as any, ectx);
  ok(/the format needs: Tender No\./.test(r1.forModel!) && !/Name of the Company|PAN|Firm Name/.test(r1.forModel!.split("format needs:")[1] || ""), "only the tender no. is asked: FinCom has the name, the PAN and the firm's details: " + r1.forModel);
  for (const k of Object.keys(made)) delete made[k];
  const r2 = await prepare({ ...ask, answers: [{ client: null, field: "tender_no", value: "TN/2026/0042" }] } as any, ectx);
  ok(!r2.error && r2.files!.length === 2, "made: " + (r2.forModel || r2.error));
  const z = await unzip(made[Object.keys(made).find((n) => n.endsWith(".zip"))!]);
  const t = await docxText(z.get(Array.from(z.keys()).find((n) => n.endsWith(".docx"))!)!);
  ok(/This is to certify that Birchwood Traders having PAN AAAFB3333C has the following turnover:/.test(t), "the placeholders filled from FinCom: " + t);
  ok(t.includes("1,32,50,250.75") && t.includes("1,52,30,400.00"), "the table's blank cells take each year's signed turnover (2025-26 from the statement kept with the client)");
  ok(/Tender No\.: TN\/2026\/0042/.test(t) && /For Example & Associates \(FRN 000000X\)/.test(t), "the tender no. answered, the firm's details from the settings");
  ok(/UDIN: _{10,}/.test(t), "the UDIN left blank");
  ok(formats.some((f) => f.name === "Tender format A" && f.kind === "docx" && f.path.includes("_firm/settings/")), "the format saved by name, in the firm's settings folder");
  // reused by name next time, with no upload
  const { ctx: c2 } = turn(new MockClaude([]), "", [], ["F/_firm/uploads/birchwood-signed-2024-25.pdf"]);
  const r3 = await prepare({ ...ask, format: "Tender format A", answers: [{ client: null, field: "tender_no", value: "TN/2026/0043" }] } as any, { ...ectx, uploads: c2.uploads });
  ok(!r3.error && /Made: 1 certificate/.test(r3.forModel!), "the saved format is used by its name");
});

Deno.test("a default letterhead and signatory put in the settings (not confirmed) is offered once: 'Use this letterhead and signatory?'; 'use our usual format' sets the firm default", async () => {
  await setup();
  settings.length = 0;
  settings.push({ firm_name: "Example & Associates", frn: "000000X", signatory: "A. Example", designation: "Partner", membership_no: "123456", place: "Faketown", letterhead_path: "F/_firm/uploads/letterhead.png", confirmed: false });
  const { ctx } = turn(new MockClaude([]), "", [], ["F/_firm/uploads/birchwood-signed-2024-25.pdf"]);
  const ectx: any = { clientId: null, clientName: "", today: "2026-10-14", firm: ctx.firm, rpc: () => null, book: () => null, makeFile: async () => null, uploadFile: ctx.uploadFile, progress: () => {}, aiText: async () => "",
    clients: async () => CLIENTS, clientInfo: ctx.clientInfo, clientFiles: ctx.clientFiles, rpcFor: () => null, uploads: ctx.uploads, readFile: ctx.readFile, store, noFont: true };
  const ask = { clients: ["Birchwood Traders"], types: ["turnover"], years: ["2024-25"], last_years: null, as_on: null, basis: null, format: null, format_name: null, addressee: null, purpose: null, date: null, figures: null, use_books: null, answers: null, firm: null, confirm: true };
  const r1 = await prepare(ask as any, ectx);
  ok(/Use this letterhead and signatory\? Example & Associates, FRN 000000X; A\. Example \(Partner\), M\. No\. 123456; place Faketown; letterhead on file/.test(r1.forModel!) && !r1.files, "the default letterhead and signatory are offered for confirmation; nothing made before");
  const r2 = await prepare({ ...ask, firm: { firm_name: null, frn: null, signatory: null, designation: null, membership_no: null, place: null, letterhead_file: null, default_format: "firm", use_these: true } } as any, ectx);
  ok((settings[settings.length - 1] as any).confirmed === true && (settings[settings.length - 1] as any).default_format === "firm" && r2.files!.length === 2, "confirmed once, and the firm's usual format chosen as the default");
  const z = await unzip(made[Object.keys(made).filter((n) => n.endsWith(".zip")).pop()!]);
  const t = await docxText(z.get(Array.from(z.keys()).find((n) => n.endsWith(".docx"))!)!);
  ok(/^Turnover Certificate/m.test(t) && /We have verified the Audited Statement of Accounts/.test(t) && /2024-25 \(Audited\)/.test(t), "the firm's usual format (from its own certificates) is used");
  const r3 = await prepare(ask as any, ectx);
  ok(!/Use this letterhead/.test(r3.forModel!), "not asked again");
});
