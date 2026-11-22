// node tests/run_itr_imports.mjs - the Income Tax Return's file imports (app/src/lib/itr/imports.js, store.js) on the
// made-up files in tests/fixtures/itr: each kind detected with its PAN and AY (or wage month), what was read as counts
// and totals, a file of another PAN or year refused saying which, the same file again changing nothing, another file
// of the same kind replacing the first (its stored copy removed), the file stored only in the firm's private storage
// and never when signed out, and nothing of a file written to the console.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { read, detect, belongs } from "../app/src/lib/itr/imports.js";
import { makeStore } from "../app/src/lib/itr/store.js";

const HERE = dirname(fileURLToPath(import.meta.url)), FX = join(HERE, "fixtures", "itr");
let fails = 0;
const ok = (c, w) => { console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const txt = (f) => readFileSync(join(FX, f), "utf8");
const sec = (r, name) => (r.read.sections.find((s) => s.name === name) || {});

// 1. each kind, detected and read
const ais = read("ais-demo.json", txt("ais-demo.json"));
ok(ais.kind === "ais" && ais.pan === "ZZZPX9999Z" && ais.ay === "2026" && ais.fy === "2025", "AIS JSON: kind, PAN and AY 2026-27 read");
ok(sec(ais, "TDS / TCS").count === 4 && sec(ais, "TDS / TCS").total === 1052000, "AIS: 4 TDS lines, 10,52,000 paid");
ok(sec(ais, "Interest").count === 2 && sec(ais, "Interest").total === 60400, "AIS: interest (194A 52,000 + savings 8,400)");
ok(sec(ais, "Dividend").total === 3500 && sec(ais, "GST turnover").total === 4850000 && sec(ais, "Taxes paid").total === 40000, "AIS: dividend, GST turnover and advance tax read");
ok(ais.data.rows.filter((r) => r.sec === "194J").reduce((s, r) => s + r.tax, 0) === 50000 && ais.data.rows.find((r) => r.sec === "194J").srcId === "DELS00001A", "AIS: TDS by deductor (TAN) and section");
ok(ais.assumed === true, "AIS: the layout is marked assumed until a real file is checked");

const tis = read("tis-demo.json", txt("tis-demo.json"));
ok(tis.kind === "tis" && tis.pan === "ZZZPX9999Z" && tis.ay === "2026" && tis.read.sections.length === 5, "TIS JSON: kind, PAN, AY and 5 categories");
ok(tis.data.rows.find((r) => r.cat === "gst").amount === 4850000, "TIS: GST turnover category");

const as26 = read("26as-demo.txt", txt("26as-demo.txt"));
ok(as26.kind === "as26" && as26.pan === "ZZZPX9999Z" && as26.ay === "2026", "26AS text: kind, PAN and AY");
ok(sec(as26, "TDS").count === 4 && sec(as26, "TDS").total === 60200, "26AS: 4 TDS lines, 60,200 deducted");
ok(sec(as26, "TCS").count === 1 && sec(as26, "TCS").total === 12000, "26AS: TCS 12,000 (206CL)");
ok(sec(as26, "Advance tax").total === 40000 && sec(as26, "Self-assessment tax").total === 15000, "26AS: advance tax (minor head 100) and self-assessment tax (300) by challan");
ok(as26.read.selfCheckOk === true, "26AS: the lines add up to each deductor's totals in the file");
ok(as26.data.paid.find((p) => p.kind === "self").date === "20260720" && as26.data.paid[0].bsr === "0000001", "26AS: challan date and BSR code");

const pre = read("prefill-demo.json", txt("prefill-demo.json"));
ok(pre.kind === "prefill" && pre.pan === "ZZZPX9999Z" && pre.ay === "2026", "Pre-filled JSON: kind, PAN and AY");
ok(pre.data.dob === "19800510" && pre.data.addr && pre.data.addr.pin === "110001" && pre.data.bank.length === 1 && pre.data.tds.length === 2, "Pre-filled: date of birth, address, bank and 2 TDS lines");

const ecr = read("ECR-04-2025.txt", txt("ECR-04-2025.txt"));
ok(ecr.kind === "ecr" && ecr.wageMonth === "202504" && ecr.ay === "2026" && ecr.key === "ecr|202504", "ECR text: kind and wage month April 2025 (from the file name) in AY 2026-27");
ok(ecr.data.rows === 3 && ecr.data.ee === 5040 && ecr.data.eps + ecr.data.er === 5040, "ECR: 3 members, employee share 5,040, employer 5,040");

const pf = read("pf-challan-04-2025.txt", txt("pf-challan-04-2025.txt"));
ok(pf.kind === "pfchallan" && pf.wageMonth === "202504" && pf.trrn === "1112025000001" && pf.paidOn === "20250522" && pf.estCode === "DLCPM0000001000", "PF challan: TRRN, wage month, establishment and date of credit 22-05-2025");
ok(pf.data.total === 12094 && pf.data.ee === 5040 && pf.data.acc["01"] === 8130, "PF challan: total and the A/c 01 amount");

const esi = read("esic-challan-04-2025.txt", txt("esic-challan-04-2025.txt"));
ok(esi.kind === "esic" && esi.wageMonth === "202504" && esi.paidOn === "20250512" && esi.challan === "2025000000001" && esi.data.ee === 375 && esi.data.total === 2000, "ESI challan: period, number, paid date, employee share and total");

// 2. the PDF route: the same readers on a PDF's text lines (two or more spaces between fields)
const pdf26 = { lines: txt("26as-demo.txt").split("\n").map((l) => l.replace(/\^/g, "  ").replace(/\s{3,}/g, "  ")) };
pdf26.lines[1] = "Permanent Account Number (PAN)  ZZZPX9999Z  Assessment Year  2026-27";
const p26 = read("26AS.pdf", pdf26);
ok(p26.kind === "as26" && p26.pan === "ZZZPX9999Z" && p26.ay === "2026" && sec(p26, "TDS").total === 60200, "26AS PDF text: PAN, AY and TDS read the same");
const esiPdf = read("challan.pdf", { lines: txt("esic-challan-04-2025.txt").split("\n") });
ok(esiPdf.kind === "esic" && esiPdf.data.total === 2000, "ESI challan PDF text read");

// 3. refusals
ok(read("x.txt", "hello world").error.code === "unknown", "A file that is none of these is refused (what to bring instead)");
ok(read("x.json", "{bad json").error.code === "bad_json", "Broken JSON refused");
ok(read("x.json", JSON.stringify({ encData: "abc" })).error.code === "encrypted", "A locked AIS JSON is refused with what to do");
ok(detect("x.json", { ITR: { ITR3: {} } }) === "itrjson" && read("x.json", JSON.stringify({ ITR: { ITR3: {} } })).error.code === "itr", "An ITR JSON is sent to the right place");
const clients = [{ id: "c1", name: "Demo Proprietor", pan: "ZZZPX9999Z" }, { id: "c2", name: "Other Demo Client", pan: "ZZZPY8888Y" }];
const wrongPan = read("ais.json", txt("ais-demo.json").replace(/ZZZPX9999Z/g, "ZZZPY8888Y"));
const b1 = belongs(wrongPan, clients[0], clients, "2026");
ok(!b1.ok && b1.code === "pan" && /ZZZPY8888Y/.test(b1.text) && /Other Demo Client/.test(b1.text) && /ZZZPX9999Z/.test(b1.text), "Another client's PAN refused, naming the PAN and whose it is: " + b1.text);
const b1b = belongs(read("ais.json", txt("ais-demo.json").replace(/ZZZPX9999Z/g, "ZZZPQ7777Q")), clients[0], clients, "2026");
ok(!b1b.ok && b1b.code === "pan" && /ZZZPQ7777Q/.test(b1b.text), "An unknown PAN refused, naming it");
const wrongAy = read("26as.txt", txt("26as-demo.txt").replace("2025-26^2026-27", "2024-25^2025-26"));
const b2 = belongs(wrongAy, clients[0], clients, "2026");
ok(!b2.ok && b2.code === "ay" && /2025-26/.test(b2.text) && /2026-27/.test(b2.text), "Another year's 26AS refused, saying which: " + b2.text);
const ecrOld = read("ECR-03-2025.txt", txt("ECR-04-2025.txt"));
const b3 = belongs(ecrOld, clients[0], clients, "2026");
ok(!b3.ok && b3.code === "ay" && /03-2025/.test(b3.text), "An ECR for March 2025 (last year's) refused: " + b3.text);
const ecrNoMonth = read("ecr.txt", txt("ECR-04-2025.txt"));
ok(!belongs(ecrNoMonth, clients[0], clients, "2026").ok && belongs(ecrNoMonth, clients[0], clients, "2026").code === "no_ay", "An ECR whose month cannot be read is not guessed (Needs you)");
const pfOther = belongs(pf, Object.assign({}, clients[0], { pfCode: "DLCPM0000009000" }), clients, "2026");
ok(!pfOther.ok && pfOther.code === "est", "A PF challan of another establishment refused");
const pfAsk = belongs(pf, clients[0], clients, "2026");
ok(pfAsk.ok && pfAsk.ask && pfAsk.ask.value === "DLCPM0000001000", "A PF code not yet known is asked, not assumed");
ok(!belongs(ais, { id: "c1", name: "No PAN yet", pan: "" }, clients, "2026").ok, "A client with no PAN in Client setup: the import says so");

// 4. the store: stored only in the firm's storage; the same file again; replacing; signed out
const books = { cid: "c1" }, uploads = [], removed = [];
let firm = "firm-1", saves = 0, failUpload = false;
const deps = {
  books: () => books, save: async () => { saves++; }, clients: () => clients, open: () => clients[0], firm: () => firm, user: () => "Owner", now: () => "2026-11-22T10:00:00Z",
  sha: async (b) => createHash("sha256").update(b).digest("hex"),
  upload: async (path, bytes, type) => { if (failUpload) throw new Error("offline"); uploads.push({ path, n: bytes.length, type }); return { ok: true, path }; },
  remove: async (path) => { removed.push(path); },
};
const st = makeStore(deps);
const file = (name, s) => ({ name, bytes: new TextEncoder().encode(s), text: s, type: name.endsWith(".json") ? "application/json" : "text/plain" });
const logs = []; const keep = { log: console.log, error: console.error, warn: console.warn, info: console.info };
const quiet = () => { ["log", "error", "warn", "info"].forEach((k) => { console[k] = (...a) => logs.push(a.join(" ")); }); };
const loud = () => Object.assign(console, keep);
quiet();
const r1 = await st.bring(file("ais-demo.json", txt("ais-demo.json")));
const r2 = await st.bring(file("ais-demo.json", txt("ais-demo.json"))); const upAfter2 = uploads.length;
const changed = txt("ais-demo.json").replace('"AmountPaid": 500000', '"AmountPaid": 600000');
const r3 = await st.bring(file("AIS_2026-27.json", changed));
const rWrong = await st.bring(file("ais.json", txt("ais-demo.json").replace(/ZZZPX9999Z/g, "ZZZPY8888Y")));
const e1 = await st.bring(file("ECR-04-2025.txt", txt("ECR-04-2025.txt")));
const e2 = await st.bring(file("ECR-05-2025.txt", txt("ECR-04-2025.txt").replace("20000", "21000")));
loud();
ok(r1.ok && !r1.replaced && uploads.length >= 1 && uploads[0].path === "firm-1/c1/itr2026-ais-ais-demo.json", "First AIS: stored in the firm's storage under <firm>/<client>/itr2026-ais-…");
ok(books.itr["2026|ais"] && books.itr["2026|ais"].pan === "ZZZPX9999Z" && books.itr["2026|ais"].stored === true, "Kept as one item of the client's books (2026|ais)");
ok(r2.ok && r2.same === true && upAfter2 === 1, "The same file again: nothing changed, not stored twice");
ok(r3.ok && r3.replaced === true && Object.keys(books.itr).filter((k) => k.startsWith("2026|ais")).length === 1, "Another AIS for the year replaces the first (one item, no duplicate)");
ok(removed.includes("firm-1/c1/itr2026-ais-ais-demo.json") && books.itr["2026|ais"].docPath === "firm-1/c1/itr2026-ais-AIS_2026-27.json", "The replaced file's stored copy is removed");
ok(!rWrong.ok && rWrong.refused && rWrong.code === "pan" && !Object.values(books.itr).some((v) => v.pan === "ZZZPY8888Y"), "A refused file is neither kept nor stored");
ok(e1.ok && e2.ok && books.itr["2026|ecr|202504"] && books.itr["2026|ecr|202505"], "ECRs are kept month by month");
ok(logs.length === 0, "Nothing of the files went to the console (" + logs.length + " lines)");
firm = "";
const up0 = uploads.length;
quiet(); const s1 = await st.bring(file("26as-demo.txt", txt("26as-demo.txt"))); loud();
ok(s1.ok && uploads.length === up0 && books.itr["2026|as26"].stored === false && /Signed out/.test(s1.text), "Signed out: what the file holds is kept, the file itself is not stored anywhere");
firm = "firm-1"; failUpload = true;
quiet(); const s2 = await st.bring(file("tis-demo.json", txt("tis-demo.json"))); loud();
ok(s2.ok && books.itr["2026|tis"].stored === false && /could not be stored/.test(s2.text), "Storage failing: said, and the file is not kept on this computer instead");
failUpload = false;
ok(JSON.stringify(books.itr).indexOf("#~#") < 0 && JSON.stringify(books.itr).indexOf("DEMO WORKER") < 0, "Only what was read is kept in the books, not the file's raw lines or members' names");
const acc0 = st.accept("ais:tds:DELS00001A", "");
ok(!acc0.ok && st.accept("ais:tds:DELS00001A", "Booked in April; deductor's quarter differs").ok && st.state().accepted["ais:tds:DELS00001A"].note.length > 3, "A difference is accepted only with a note");
await st.drop("2026|ecr|202505");
ok(!books.itr["2026|ecr|202505"], "A file can be removed");

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
