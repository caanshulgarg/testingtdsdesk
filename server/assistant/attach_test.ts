// deno test server/assistant/attach_test.ts (run by tests/run_assistant_agent.py): Ask FinCom's attachment rules
// (server/_shared/attachrules.js, the same file the panel runs): 30 files a message, any type, the sizes, what the AI is
// given of each file (as it is, as its text, or by its name), the context budget, the stored type, and the prices the
// estimate uses being the bill's own (models.ts). All files made up.
import { ATTACH, attachInr, fitAttachments, INR_PER_USD, NAME_TOKENS, PAGE_TOKENS, PRICES, sniff, storeType, textTokens, tokensOf, ZIP, zipSizes, zipTooBig } from "../_shared/attachrules.js";
import { ATTACH_RATE, attachRateOk, capOver, firstPages } from "./index.ts";
import { classify } from "./failure.ts";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { costUsd, OPUS, PRICES as MODEL_PRICES, SONNET } from "./models.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
const MB = 1024 * 1024;

Deno.test("the limits: 30 files a message, 20 MB a file, 100 MB a message, 4 uploads at once; the zip's limits", () => {
  eq([ATTACH.files, ATTACH.fileBytes, ATTACH.totalBytes, ATTACH.upAtOnce], [30, 20 * MB, 100 * MB, 4], "the limits");
  assert(ATTACH.nativeBytes * 4 / 3 < 32 * MB, "the PDFs and pictures as base64 stay under the API's 32 MB a request");
  eq([ATTACH.nativePages, ATTACH.imageBytes], [100, 5 * MB], "the API's own limits for PDFs and pictures");
  assert(ZIP.entryBytes <= ATTACH.fileBytes && ZIP.totalBytes <= ATTACH.totalBytes && ZIP.ratio > 0 && ZIP.depth === 2 && ZIP.open <= ATTACH.files, "the zip limits: " + JSON.stringify(ZIP));
});

Deno.test("what a file is, by its bytes; stored with a type that is never served as a page", () => {
  const b = (s: string) => Array.from(new TextEncoder().encode(s));
  eq(sniff(b("%PDF-1.7"), "x.bin", ""), "application/pdf", "a PDF by its bytes, whatever its name");
  eq(sniff([0x89, 0x50, 0x4e, 0x47, 13, 10], "x.png", "image/png"), "image/png", "PNG");
  eq(sniff([0xff, 0xd8, 0xff, 0xe0], "x.jpg", ""), "image/jpeg", "JPEG");
  eq(sniff(b("RIFF....WEBPVP8 "), "x.webp", ""), "image/webp", "WebP");
  eq(sniff(b("PK\x03\x04"), "a.xlsx", ""), "xlsx", "an xlsx is a zip, told by its name");
  eq(sniff(b("PK\x03\x04"), "a.docx", ""), "docx", "a docx");
  eq(sniff(b("PK\x03\x04"), "bundle.zip", ""), "application/zip", "a zip");
  eq(sniff(b("<html><script>"), "page.png", "image/png"), "", "a page named .png is not a picture");
  for (const [n, t, want] of [["a.pdf", "application/pdf", "application/pdf"], ["a.png", "image/png", "image/png"], ["a.csv", "text/csv", "text/csv"], ["a.json", "application/json", "application/json"],
    ["a.txt", "text/plain;charset=utf-8", "text/plain"], ["a.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ["a.html", "text/html", "application/octet-stream"], ["a.svg", "image/svg+xml", "application/octet-stream"], ["a.xml", "text/xml", "application/octet-stream"], ["a.xml", "application/xml", "application/octet-stream"],
    ["a.xhtml", "application/xhtml+xml", "application/octet-stream"], ["a.js", "text/javascript", "application/octet-stream"], ["a.bin", "", "application/octet-stream"], ["a.zip", "application/zip", "application/zip"]]) {
    eq(storeType(n, t), want, "stored type of " + n + " (" + t + ")");
  }
});

Deno.test("30 mixed files: PDFs and pictures as they are, the rest as text sharing the budget fairly; never over the budget", () => {
  const items: Record<string, unknown>[] = [
    { name: "notice.pdf", size: 300_000, native: "pdf", pages: 3, chars: 4000 },
    { name: "receipt.png", size: 40_000, native: "image", chars: 0 },
    { name: "huge.txt", size: 2 * MB, native: "", chars: 200_000 },
    { name: "register.xlsx", size: 90_000, native: "", chars: 190_000 },
    { name: "blob.bin", size: 5000, native: "", chars: 0, read: false },
    ...Array.from({ length: 25 }, (_x, i) => ({ name: "note-" + i + ".txt", size: 400, native: "", chars: 400 })),
  ];
  eq(items.length, 30, "30 files");
  const { plan, tokens } = fitAttachments(items);
  eq([plan[0].mode, plan[1].mode], ["native", "native"], "the PDF and the picture go as they are");
  eq(plan[0].tokens, 3 * PAGE_TOKENS, "a PDF's tokens, by its pages");
  assert(plan.slice(5).every((p: any) => p.mode === "text" && !p.cut && p.chars === 400), "the short notes go whole");
  assert(plan[2].mode === "text" && plan[2].cut && plan[3].cut && /Shortened to fit/.test(plan[2].why), "the long files are shortened, and said so: " + plan[2].why);
  assert(Math.abs(plan[2].tokens - plan[3].tokens) <= 1, "the long files share the rest alike (" + plan[2].tokens + ", " + plan[3].tokens + ")");
  eq([plan[4].mode, plan[4].tokens], ["name", NAME_TOKENS], "a file FinCom cannot read: its name, type and size only");
  assert(/could not read/.test(plan[4].why), "said to the user: " + plan[4].why);
  assert(tokens <= ATTACH.tokens && tokens > ATTACH.tokens * 0.95, "all of it within the budget, the budget used (" + tokens + ")");
});

Deno.test("PDFs over the API's limits (100 pages, 18 MB, a locked one) and a big picture: read as their text, or said not read", () => {
  const pdf = (n: string, pages: number, size: number, chars = 30_000) => ({ name: n, size, native: "pdf", pages, chars });
  const { plan } = fitAttachments([pdf("a.pdf", 15, MB), pdf("b.pdf", 10, MB), pdf("c.pdf", 90, MB), pdf("d.pdf", 0, MB), { name: "big.jpg", size: 6 * MB, native: "image", chars: 0 }]);
  eq(plan.map((p: any) => p.mode), ["native", "native", "text", "text", "name"], "the pages a request takes: the third PDF (with text) as its text; a locked one as its text; a picture over 5 MB by its name");
  assert(/^Read as its text/.test(plan[2].why), plan[2].why);
  assert(/locked or damaged/.test(plan[3].why), plan[3].why);
  assert(/^Not read: a picture over 5 MB/.test(plan[4].why), plan[4].why);
  const many = Array.from({ length: 12 }, (_x, i) => pdf("p" + i + ".pdf", 1, 2 * MB, 100));
  const r = fitAttachments(many);
  eq(r.plan.filter((p: any) => p.mode === "native").length, 9, "PDFs together up to 18 MB as they are; the rest as their text");
  assert(r.plan.slice(9).every((p: any) => p.mode === "text" && /18 MB together/.test(p.why)), r.plan[9].why);
});

Deno.test("the estimate: the bill's own prices (models.ts takes them from here); about ₹ for the tokens", () => {
  eq(MODEL_PRICES, PRICES, "models.ts's prices are attachrules.js's");
  const sonnet = attachInr(100_000, false), opus = attachInr(100_000, true);
  const viaBill = costUsd(SONNET, { input_tokens: 100_000, output_tokens: 2000 }) * INR_PER_USD;
  assert(Math.abs(sonnet - viaBill) < 0.01, "the estimate is what costUsd bills (" + sonnet + " vs " + viaBill + ")");
  assert(Math.abs(opus - costUsd(OPUS, { input_tokens: 100_000, output_tokens: 2000 }) * INR_PER_USD) < 0.01, "a notice: Opus's prices");
  eq(tokensOf(3500), 1000, "about 3.5 characters a token");
  assert(attachInr(tokensOf(ATTACH.costWarnInr * 1e6 / INR_PER_USD / 2 * 3.5), false) > ATTACH.costWarnInr, "the warning's threshold is reachable");
});

Deno.test("review HIGH 1: a scanned PDF (no text) goes as it is up to most of the budget; a longer one as its first pages; one with text as its text", () => {
  const scan = (pages: number) => ({ name: "order-" + pages + ".pdf", size: pages * 150_000, native: "pdf", pages, chars: 0 });
  const r40 = fitAttachments([scan(40), { name: "note.txt", size: 100, native: "", chars: 100 }]);
  eq([r40.plan[0].mode, r40.plan[0].pages, r40.plan[0].cut, r40.plan[1].mode], ["native", 40, false, "text"], "a 40-page scanned order goes whole, as it is (it went by its name only in c9c0ad37f)");
  const r70 = fitAttachments([scan(70)]);
  assert(r70.plan[0].mode === "native" && r70.plan[0].cut && r70.plan[0].pages >= 45 && r70.plan[0].pages < 70 && /first \d+ of 70 pages/.test(r70.plan[0].why), "a 70-page scan: its first pages, said so: " + JSON.stringify(r70.plan[0]));
  assert(r70.tokens <= ATTACH.tokens, "within the budget");
  const dig = fitAttachments([{ name: "report.pdf", size: MB, native: "pdf", pages: 70, chars: 150_000 }]);
  eq(dig.plan[0].mode, "text", "a 70-page PDF with text goes as its text");
  const text = fitAttachments([scan(30), { name: "huge.txt", size: MB, native: "", chars: 200_000 }]);
  assert(text.plan[0].mode === "native" && text.plan[1].mode === "text" && text.plan[1].tokens >= ATTACH.tokens / 4 - 100 && text.tokens <= ATTACH.tokens, "the texts keep at least a quarter of the budget: " + JSON.stringify(text.plan.map((p: any) => [p.mode, p.tokens])));
});

Deno.test("review HIGH 2: tokens counted on the safe side for digits and Hindi; the budget and the estimate use them", () => {
  const eng = "Made-up ledger narration words. ".repeat(1000), nums = "12,34,567.89\t09-03-2026\t".repeat(1000), hindi = "यह एक बनावटी पत्र है ".repeat(1000);
  assert(textTokens(eng) >= eng.length / 3.5 && textTokens(eng) <= eng.length / 3, "English about 3.2 characters a token (" + textTokens(eng) + ")");
  assert(textTokens(nums) >= nums.length / 1.8, "a sheet of numbers: denser (" + textTokens(nums) + " for " + nums.length + " characters)");
  assert(textTokens(hindi) >= hindi.length / 1.5, "Hindi (with its spaces): far denser than English (" + textTokens(hindi) + " for " + hindi.length + ")");
  const h = "बनावटी ".repeat(30_000);       // 210,000 characters, mostly not ASCII
  const r = fitAttachments([{ name: "hindi.txt", size: MB, native: "", chars: h.length, tokens: textTokens(h) }]);
  assert(r.plan[0].cut && r.tokens <= ATTACH.tokens && r.plan[0].chars < 0.7 * h.length, "a long Hindi text (whole under 3.5 characters a token) is cut by its tokens, not its characters (" + r.plan[0].chars + " characters kept)");
  assert(attachInr(textTokens(nums), false) > attachInr(tokensOf(nums.length), false), "the ₹ estimate uses the same count");
  const f = classify(Object.assign(new Error("400"), { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 251234 tokens > 200000 maximum" } } }));
  eq(f.kind, "too_long", "the API's 'prompt is too long': its own kind");
  assert(/too long for the AI to read at once/.test(f.message) && /fewer files/.test(f.message), "said in plain words: " + f.message);
});

// a zip's central directory with one entry stated at usize (nothing in it is unpacked)
function zipWith(usize: number, csize: number): Uint8Array {
  const name = new TextEncoder().encode("xl/worksheets/sheet1.xml"), cd = new Uint8Array(46 + name.length), dv = new DataView(cd.buffer);
  dv.setUint32(0, 0x02014b50, true); dv.setUint32(20, csize, true); dv.setUint32(24, usize, true); dv.setUint16(28, name.length, true); cd.set(name, 46);
  const end = new Uint8Array(22), de = new DataView(end.buffer);
  de.setUint32(0, 0x06054b50, true); de.setUint16(8, 1, true); de.setUint16(10, 1, true); de.setUint32(12, cd.length, true); de.setUint32(16, 4, true);
  const out = new Uint8Array(4 + cd.length + 22); out.set([0x50, 0x4b, 0x03, 0x04]); out.set(cd, 4); out.set(end, 4 + cd.length); return out;
}
Deno.test("review MED 4: an .xlsx (a zip) is measured from its directory before ExcelJS opens it", () => {
  eq(zipSizes(zipWith(2000, 900)), { entries: 1, usize: 2000, csize: 900, big: false }, "the sizes, read without unpacking");
  assert(!zipTooBig(zipSizes(zipWith(2_000_000, 400_000))), "an ordinary workbook is opened");
  assert(zipTooBig(zipSizes(zipWith(60 * MB, 60_000))), "one that unpacks to 60 MB from 60 KB is not (a zip bomb)");
  assert(zipTooBig(zipSizes(zipWith(0xffffffff, 0xffffffff))), "one stating 4 GB is not");
  eq(zipSizes(new TextEncoder().encode("not a zip")), null, "not a zip");
});

Deno.test("review MED 5: asks with files are limited per user and per firm (the database's count, else this copy's); a firm at its limit is told before any download", async () => {
  const keys: string[] = [];
  const no = await attachRateOk(async (b, k) => { keys.push(b + " " + k); return b === "asst-attach-user" ? false : true; }, "user-1", "firm-1");
  assert(!no.ok && /last hour/.test(no.error || ""), "refused when the database says so: " + no.error);
  assert(keys.every((k) => !/user-1|firm-1/.test(k)), "the ids are hashed before they are sent");
  let last = { ok: true } as { ok: boolean };
  for (let i = 0; i <= ATTACH_RATE.user; i++) last = await attachRateOk(async () => { throw new Error("PGRST202"); }, "user-2", "firm-2");
  assert(!last.ok, "without the database's count: counted in this copy, the " + (ATTACH_RATE.user + 1) + "st refused");
  const now = new Date("2026-11-13T10:00:00Z");
  const get = (spent: number, calls: number) => async (q: string) => q.startsWith("assistant_caps") ? [{ daily_calls: 500, monthly_inr: 3000 }] : [{ day: "2026-11-02", calls: 3, cost_inr: spent / 2 }, { day: "2026-11-13", calls, cost_inr: spent / 2 }];
  eq(await capOver(get(3000, 10), "f", now), { why: "inr", cap_inr: 3000, cap: 500 }, "the month's rupees used up");
  eq(await capOver(get(100, 500), "f", now), { why: "calls", cap_inr: 3000, cap: 500 }, "today's calls used up");
  eq(await capOver(get(100, 10), "f", now), null, "room left");
  eq(await capOver(async () => null, "f", now), null, "not readable: the turn's own check decides");
});

Deno.test("a scanned PDF's first pages, as a PDF of their own", async () => {
  const d = await PDFDocument.create(); for (let i = 0; i < 5; i++) d.addPage();
  const two = await firstPages(await d.save(), 2);
  eq((await PDFDocument.load(two)).getPageCount(), 2, "the first 2 of 5 pages");
});
