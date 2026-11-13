// deno test server/assistant/attach_test.ts (run by tests/run_assistant_agent.py): Ask FinCom's attachment rules
// (server/_shared/attachrules.js, the same file the panel runs): 30 files a message, any type, the sizes, what the AI is
// given of each file (as it is, as its text, or by its name), the context budget, the stored type, and the prices the
// estimate uses being the bill's own (models.ts). All files made up.
import { ATTACH, attachInr, fitAttachments, INR_PER_USD, NAME_TOKENS, PAGE_TOKENS, PRICES, sniff, storeType, tokensOf, ZIP } from "../_shared/attachrules.js";
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
  eq(plan.map((p: any) => p.mode), ["native", "native", "text", "text", "name"], "the pages a request takes: the third PDF as its text; a locked one as its text; a picture over 5 MB by its name");
  assert(/100 pages|too long/.test(plan[2].why) && /^Read as its text/.test(plan[2].why), plan[2].why);
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
