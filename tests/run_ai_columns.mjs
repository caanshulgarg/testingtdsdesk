// node tests/run_ai_columns.mjs - the one-time AI column reading by default (the owner, 24-Nov-2026: "check everywhere
// if we require one-time AI; it should work by default"), on made-up sheets, with the AI stubbed (no network, no key):
//   1. a bank statement sheet whose headings FinCom does not know by name ("Txn On", "Money Out", "Running Total"): read
//      through the AI's mapping by readStatement itself (no button), the mapping kept for the client and that header
//      layout; the same layout again is read with no AI call; another client is asked again; a person's correction wins
//   2. the AI not available: the file is still said as not read, with the header kept so the person can choose columns
//   3. a sheet FinCom knows by name never calls the AI
//   4. the 24Q salary sheet with unknown headings ("Staff", "IT Deducted"): read through the AI (side "payroll"), kept;
//      the client's confirmed Payroll layout used first, with no AI
//   5. the server's half (server/assistant/sheetmap.ts): side "bank" has its own prompt and fields, the answer checked
// AICOL_ROOT runs it on another checkout (with TDSDESK_HTML its built page): the base, to see each check fail before.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.AICOL_ROOT || path.join(here, "..");
const { load, HTML } = require("./harness");

let fails = 0, n = 0;
const ok = (c, w) => { n++; console.log((c ? "  ok   " : "  FAIL ") + w); if (!c) fails++; };
const tryOk = async (f, w) => { let v = false; try { v = await f(); } catch (e) { console.log("       (" + String((e && (e.message || e.code)) || e).slice(0, 200) + ")"); } ok(v, w); };

const PAGE = fs.readFileSync(HTML, "utf8"), has = (x) => new RegExp("\\n(?:const|let|(?:async )?function) " + x.replace(/\$/g, "\\$") + "\\b").test(PAGE);
const want = ["num", "r2", "MONTHS", "toIsoDate", "cellText", "bankAmount", "bankDate", "BANK_HDR", "classifyHeader", "findHeader", "BANK_NAMES", "statementMeta", "rowsFromCells",
  "xlsxBook", "xlsxRows", "gridsFromSheet", "parseSheetStatement", "MONEY_TOKEN", "DATE_TOKEN", "parseByLines", "sheetAsPages", "checkBalances", "scoreParse", "isPdf", "isImage", "readStatement",
  "bankErr", "errText", "Market", "TDSCH", "TDS24Q", "registersLoad"].filter(has);
const h = load(HTML, want), C = h.ctx;
Object.keys(h.x).forEach((k) => { if (!(k in C)) C[k] = h.x[k]; });
C.window = C; C.ensureXlsx = async () => {}; C.googleAvailable = () => false;
vm.runInContext(fs.readFileSync(path.join(here, "..", "assets", "xlsx.js"), "utf8"), C);

// the page's client store and the stubbed AI (SheetAI.map's place)
const clients = { c1: { id: "c1", name: "ZZ Test Client" }, c2: { id: "c2", name: "ZZ Other Client" } }, saved = [];
C.S = Object.assign(C.S || {}, { coId: "c1", books: { cid: "c1" } });
C.CO = (id) => clients[id || C.S.coId];
C.Store = { saveCompany: (co) => saved.push(co.id) };
C.whoAmI = () => "tester@example.test";
const calls = [];
let aiOn = true, answer = null;   // answer: the review's probes (a wrong or nonsense mapping), when set
C.SheetAI = { map: async (req) => {
  calls.push(req);
  if (!aiOn) throw new Error("FinCom's AI is switched off here");
  if (answer) return typeof answer === "function" ? answer(req) : answer;
  if (req.side === "bank") return { ok: true, map: { date: "Txn On", narration: "Remarks", ref: "Chq", debit: "Money Out", credit: "Money In", balance: "Running Total" } };
  if (req.side === "payroll") return { ok: true, map: { name: "Staff", pan: "Tax No", month: "Pay Month", gross: "Total Pay", tds: "IT Deducted" }, earn: [], ded: [] };
  throw new Error("no answer for side " + req.side);
} };
// registersLoad: what the app's registers chunk puts on the page (registers.js: window.AiCols = forPage(window))
let AC = null;
try { AC = await import(pathToFileURL(path.join(ROOT, "app", "src", "lib", "aiColumns.js")).href); } catch (e) { console.log("  (no aiColumns.js here: " + String(e.message).slice(0, 80) + ")"); }
C.registersLoad = async () => { if (!AC) throw new Error("registers are read in the app only"); C.AiCols = AC.forPage(C); };
C.loadRegisters = C.registersLoad;

const file = (name, data) => { const u = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  return { name, type: "", size: u.length, arrayBuffer: async () => u.buffer.slice(u.byteOffset, u.byteOffset + u.length), text: async () => new TextDecoder().decode(u), slice: (a, b) => file(name, u.slice(a, b)) }; };
// a made-up statement whose headings no rule knows
const BANK = ["ZZ Sample Bank - account statement", "Account 000011112222", "",
  "Txn On,Remarks,Chq,Money Out,Money In,Running Total",
  "01/09/2026,Opening transfer,,,\"10,000.00\",\"10,000.00\"",
  "02/09/2026,UPI to ZZ Grocer,,250.00,,\"9,750.00\"",
  "05/09/2026,NEFT from ZZ Buyer,UTR0001,,\"1,250.50\",\"11,000.50\"",
  "07/09/2026,Cheque paid,000123,\"1,000.50\",,\"10,000.00\""].join("\n");
const BANK_SAME = BANK.replace("05/09/2026", "06/09/2026");
const KNOWN = ["Date,Narration,Withdrawal,Deposit,Balance", "01/09/2026,Opening,,100.00,100.00", "02/09/2026,UPI out,40.00,,60.00"].join("\n");

console.log("1. a bank sheet with unknown headings: the AI reads its columns once, by itself");
const read = (name, data) => C.readStatement(file(name, data), () => {});
let p1 = null;
await tryOk(async () => { p1 = await read("zz-stmt.csv", BANK); return p1.rows.length === 4; }, "readStatement reads the 4 lines (no button pressed)");
await tryOk(async () => p1.rows[1].debit === 250 && p1.rows[2].credit === 1250.5 && p1.rows[3].balance === 10000 && p1.rows[2].ref === "UTR0001" && p1.rows[0].date === "2026-09-01",
  "every figure read by FinCom's own reader through the mapping (Money Out 250, Money In 1,250.50, Running Total, Chq)");
ok(calls.length === 1 && calls[0].side === "bank", "the AI was asked once, side bank");
ok(calls.length === 1 && calls[0].rows.length <= 10 && !JSON.stringify(calls[0].rows).includes("Grocer") && !JSON.stringify(calls[0].rows).includes("000011112222"), "it saw the header and at most 10 rows, the words masked (no party name)");
ok(!!(p1 && p1.cols && p1.cols.how === "ai" && p1.cols.map.debit === "Money Out" && p1.cols.map.date === "Txn On"), "the statement says which column was read as what (cols, how ai)");
const keys = Object.keys(clients.c1.aiColumns || {});
ok(keys.length === 1 && /^bank:h/.test(keys[0]) && saved.includes("c1"), "kept for this client and this header layout (co.aiColumns bank:<hash>), saved");
ok(AC && keys[0] === "bank:" + AC.layoutKey(["Txn On", "Remarks", "Chq", "Money Out", "Money In", "Running Total"]), "the key is the hash of the header row");
await tryOk(async () => { const p = await read("zz-stmt-oct.csv", BANK_SAME); return p.rows.length === 4 && calls.length === 1 && p.cols.how === "ai"; }, "the same layout again: read with no AI call");
await tryOk(async () => { C.S.coId = "c2"; const p = await read("zz-stmt.csv", BANK); C.S.coId = "c1"; return p.rows.length === 4 && calls.length === 2; }, "another client's same layout: asked for that client");
await tryOk(async () => { AC.keep(clients.c1, "bank", ["Txn On", "Remarks", "Chq", "Money Out", "Money In", "Running Total"], { date: "Txn On", narr: "Remarks", debit: "Money In", credit: "Money Out", balance: "Running Total" }, "person", "tester");
  const p = await read("zz-stmt.csv", BANK); return calls.length === 2 && p.cols.how === "person" && p.rows[1].credit === 250; }, "a person's correction is used from then on (no AI)");
ok(AC && AC.saidCols({ map: { date: "Txn On", narr: "Remarks", debit: "Money Out" } }) === "Date ← “Txn On” · Narration ← “Remarks” · Withdrawal ← “Money Out”", "the Columns read as line, in plain words");

console.log("2. the AI not available: said plainly, the header kept for the person to choose");
await tryOk(async () => { aiOn = false; C.S.coId = "c3"; clients.c3 = { id: "c3", name: "ZZ Third" };
  try { await read("zz-stmt.csv", BANK); return false; } catch (e) { return e.code === "bank_unreadable" && e.diag && Array.isArray(e.diag.head) && e.diag.head[3] === "Money Out"; } finally { aiOn = true; C.S.coId = "c1"; } },
  "bank_unreadable as before, with the header row in diag.head");

const NOBAL = BANK.split("\n").map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).slice(0, 5).join(",")).join("\n");
await tryOk(async () => { aiOn = false; C.S.coId = "c3";
  try { await read("zz-nobal.csv", NOBAL); return false; } catch (e) { return e.code === "bank_unreadable" && e.diag.head.length === 5; } finally { aiOn = true; C.S.coId = "c1"; } },
  "a sheet with no balance column and the AI not available: not read (for the person to choose)");

console.log("3. a sheet FinCom knows by name: no AI");
await tryOk(async () => { const was = calls.length, p = await read("zz-known.csv", KNOWN); return p.rows.length === 2 && calls.length === was && !p.cols; }, "Date / Narration / Withdrawal / Deposit / Balance: read by the rules, the AI never asked");

console.log("4. the 24Q salary sheet with unknown headings");
const SAL = ["Staff,Tax No,Pay Month,Total Pay,IT Deducted", "ZZ Person One,AAAPZ1234A,Sep-2026,\"50,000\",\"2,500\"", "ZZ Person Two,AAAPZ5678B,Sep-2026,\"40,000\",\"1,000\""].join("\n");
let r4 = null;
await tryOk(async () => { r4 = await C.TDS24Q.fromFile(file("zz-salary.csv", SAL)); return !r4.error && r4.rows.length === 2 && r4.rows[0].tds === 2500 && r4.rows[1].gross === 40000 && r4.rows[0].pan === "AAAPZ1234A" && r4.rows[0].date === "2026-09-30"; },
  "read through the AI's mapping: 2 rows, TDS 2,500, gross 40,000, the PAN, the month's last day");
ok(calls.filter((c) => c.side === "payroll").length === 1 && calls.filter((c) => c.side === "payroll")[0].rows.length <= 3, "the AI asked once (side payroll, 3 rows at most)");
ok(!!(r4 && r4.cols && r4.cols.how === "ai" && r4.cols.map.tds === "IT Deducted"), "the columns read are said (cols)");
await tryOk(async () => { const r = await C.TDS24Q.fromFile(file("zz-salary.csv", SAL)); return r.rows.length === 2 && calls.filter((c) => c.side === "payroll").length === 1; }, "the same layout again: no AI call");
await tryOk(async () => { clients.c2.payrollFormats = [{ fp: "x", map: {}, deleted: false }]; C.S.books.cid = "c2"; C.S.coId = "c2";
  const PS = await import(pathToFileURL(path.join(ROOT, "app", "src", "lib", "payrollSheet.js")).href), head = ["Staff", "Tax No", "Pay Month", "Total Pay", "IT Deducted"];
  clients.c2.payrollFormats = [PS.makeRule(head, "", { map: { name: "staff", pan: "taxno", month: "paymonth", gross: "totalpay", tds: "itdeducted" }, earn: [], ded: [] }, { by: "t" })];
  const was = calls.length, r = await C.TDS24Q.fromFile(file("zz-salary.csv", SAL)); C.S.books.cid = "c1"; C.S.coId = "c1";
  return r.rows.length === 2 && calls.length === was && r.cols.how === "saved"; }, "the client's confirmed Payroll layout is used first: no AI");
await tryOk(async () => { const r = await C.TDS24Q.fromFile(file("zz-salary2.csv", "Employee Name,PAN,TDS\nZZ A,AAAPZ1234A,100\n")); return r.rows.length === 1 && !r.cols; }, "a sheet known by name: read by the rules, no AI");

console.log("4b. wide sheets and empty answers (the 80-column cut, the answer that maps nothing: never silent)");
{
  const PS = await import(pathToFileURL(path.join(ROOT, "app", "src", "lib", "payrollSheet.js")).href);
  const wide = Array.from({ length: 120 }, (_, i) => "Head " + (i + 1)); wide[5] = "Staff"; wide[100] = "IT Deducted"; wide[110] = "Total Pay";
  const rows = [wide.map((h, i) => (i === 5 ? "ZZ Person" : i === 100 ? "2500" : i === 110 ? "50000" : i % 7 === 0 ? "1" : ""))];
  let sent = null;
  await tryOk(async () => { await PS.propose(wide, rows, async (req) => { sent = req; return { map: { name: "Staff", tds: "IT Deducted", gross: "Total Pay" } }; }); return sent.head.length <= 80 && sent.head.includes("IT Deducted") && sent.head.includes("Total Pay") && sent.rows[0].length === sent.head.length; },
    "a 120-column salary sheet: at most 80 columns sent, those with values first (IT Deducted at column 101 is sent)");
  await tryOk(async () => { try { await PS.propose(["Staff", "IT Deducted", "Total Pay"], [["A", "1", "2"]], async () => ({ map: {} })); return false; } catch (e) { return /no columns/i.test(e.message); } },
    "an answer that maps no column is said (an error), never an empty mapping shown as the AI's");
  const bwide = Array.from({ length: 100 }, (_, i) => "Col " + (i + 1)); bwide[90] = "Txn On"; bwide[91] = "Remarks"; bwide[92] = "Money Out"; bwide[93] = "Money In"; bwide[94] = "Running Total";
  const bs = AC.bankSample(bwide, [bwide.map((h, i) => (i === 90 ? "01/09/2026" : i === 91 ? "ZZ" : i === 92 ? "250.00" : i === 94 ? "9750.00" : ""))]);
  ok(bs.head.length <= 80 && bs.head.includes("Money Out") && bs.head.includes("Running Total") && bs.rows[0].length === bs.head.length, "a 100-column bank sheet: at most 80 columns sent, those with values first");
}

console.log("6. the review of aead82472: a wrong AI mapping is put right or not used, never posted the wrong way");
{
  const M = (m) => ({ ok: true, map: m });
  let k = 0;
  const fresh = () => { const id = "r" + (++k); clients[id] = { id, name: "ZZ Review " + k }; C.S.coId = id; return clients[id]; };
  const back = () => { C.S.coId = "c1"; answer = null; };
  const dirs = (p) => p.rows.map((r) => r.debit + "/" + r.credit).join(" ");
  const RIGHT = "0/10000 250/0 0/1250.5 1000.5/0";
  // 1. the blocker: Withdrawal and Deposit swapped, a balance column: the running balance turns the mapping round, kept so
  await tryOk(async () => { const co = fresh(); answer = M({ date: "Txn On", narration: "Remarks", debit: "Money In", credit: "Money Out", balance: "Running Total" });
    const p = await read("zz.csv", BANK), kept = Object.values(co.aiColumns || {})[0]; back();
    return dirs(p) === RIGHT && kept && kept.map.debit === "Money Out" && kept.map.credit === "Money In" && C.checkBalances(p.rows, p.meta).od === false; },
    "debit and credit swapped by the AI, with a running balance: turned round by the balance, the right way kept (no overdraft)");
  const NOBAL = BANK.split("\n").map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).slice(0, 5).join(",")).join("\n");
  await tryOk(async () => { const co = fresh(); answer = M({ date: "Txn On", narration: "Remarks", debit: "Money In", credit: "Money Out" });
    const p = await read("zz.csv", NOBAL), kept = Object.values(co.aiColumns || {})[0]; back();
    return dirs(p) === RIGHT && kept.map.debit === "Money Out"; }, "swapped, no balance, both headings say so (Money In as debit, Money Out as credit): turned round by the headings");
  const NEUTRAL = NOBAL.replace("Money Out,Money In", "Amt 1,Amt 2");
  await tryOk(async () => { const co = fresh(); answer = M({ date: "Txn On", narration: "Remarks", debit: "Amt 2", credit: "Amt 1" });
    try { await read("zz.csv", NEUTRAL); return false; } catch (e) { return e.code === "bank_unreadable" && e.diag.head.includes("Amt 1") && !co.aiColumns; } finally { back(); } },
    "no balance and headings that do not say which way: the AI's mapping not used (Choose the columns), not kept");
  await tryOk(async () => { const co = fresh(); answer = M({ date: "Txn On", narration: "Remarks", debit: "Money In", credit: "Remarks" });
    try { await read("zz.csv", NOBAL); return false; } catch (e) { return e.code === "bank_unreadable" && !co.aiColumns; } finally { back(); } },
    "a debit heading that reads as money in, with no balance to settle it: not used");
  // 2. nonsense mappings
  const AMT = ["Txn On,Remarks,Amt,Type,Running Total", '01/09/2026,Opening,"10,000.00",C,"10,000.00"', "02/09/2026,UPI out,250.00,D,\"9,750.00\"", '05/09/2026,NEFT in,"1,250.50",C,"11,000.50"', '07/09/2026,Chq,"1,000.50",D,"10,000.00"'].join("\n");
  await tryOk(async () => { const co = fresh(); answer = M({ date: "Txn On", narration: "Remarks", debit: "Amt", credit: "Running Total" });
    try { await read("zz.csv", AMT); return false; } catch (e) { return e.code === "bank_unreadable" && !co.aiColumns; } finally { back(); } }, "lines with both a debit and a credit: not used");
  await tryOk(async () => { const co = fresh(); answer = M({ date: "Txn On", narration: "Remarks", amount: "Amt", balance: "Running Total" });
    const p = await read("zz.csv", AMT), kept = Object.values(co.aiColumns || {})[0]; back();
    return dirs(p) === RIGHT && kept.map.drcr === "Type"; }, "one Amount with no Dr / Cr while a column holds only C and D: that column filled in as Dr / Cr");
  await tryOk(async () => { const co = fresh(); answer = M({ date: "Txn On", narration: "Remarks", amount: "Running Total", drcr: "Type", balance: "Amt" });
    try { await read("zz.csv", AMT); return false; } catch (e) { return e.code === "bank_unreadable" && !co.aiColumns; } finally { back(); } }, "the amount and the balance taken for each other: the running balance does not fit, not used, not kept");
  // 8. a kept mapping is for this very header
  ok(AC.kept({ aiColumns: { ["bank:" + AC.layoutKey(["A", "B", "C"])]: { head: ["X", "Y", "Z"], map: { date: "A" } } } }, "bank", ["A", "B", "C"]) === null, "a kept mapping whose stored header is not this one is not used");
  // 9. a workbook: after the AI is off (or the cap reached) on one sheet, it is not asked for the next
  await tryOk(async () => { fresh(); aiOn = false; const was = calls.length;
    const wb = C.XLSX.utils.book_new(), rows = NOBAL.split("\n").map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((x) => x.replace(/"/g, "")));
    C.XLSX.utils.book_append_sheet(wb, C.XLSX.utils.aoa_to_sheet(rows), "One"); C.XLSX.utils.book_append_sheet(wb, C.XLSX.utils.aoa_to_sheet(rows), "Two");
    const buf = C.XLSX.write(wb, { type: "array", bookType: "xlsx" });
    try { await read("zz.xlsx", new Uint8Array(buf)); } catch (e) { /* not read */ } finally { aiOn = true; back(); }
    return calls.length - was === 1; }, "a two-sheet workbook with the AI off: asked once, not again for the second sheet");
  // 5. the person's choices carried to the lines read again
  const old = [{ id: "s1-0", date: "2026-09-02", narr: "UPI to ZZ Grocer", debit: 0, credit: 250, state: "ready", ledger: "ZZ Grocer", userSet: true },
    { id: "s1-1", date: "2026-09-07", narr: "Cheque paid", debit: 0, credit: 1000.5, state: "sent", ledger: "ZZ Rent", tally: { guid: "g1" } },
    { id: "s1-2", date: "2026-09-09", narr: "Gone line", debit: 5, credit: 0, state: "ready", ledger: "X", userSet: true }];
  const nw = [{ id: "s2-0", date: "2026-09-02", narr: "UPI to ZZ Grocer", debit: 250, credit: 0, state: "attention", ledger: "" },
    { id: "s2-1", date: "2026-09-07", narr: "Cheque paid", debit: 1000.5, credit: 0, state: "attention", ledger: "" },
    { id: "s2-2", date: "2026-09-05", narr: "NEFT from ZZ Buyer", debit: 0, credit: 1250.5, state: "attention", ledger: "" }];
  await tryOk(async () => { const c = AC.carry(old, nw), g = c.rows.find((r) => r.narr === "UPI to ZZ Grocer"), q = c.rows.find((r) => r.narr === "Cheque paid");
    return g.ledger === "ZZ Grocer" && g.userSet && g.debit === 250 && g.state === "suggested" && q.id === "s1-1" && q.state === "sent" && q.credit === 1000.5 && c.rows.length === 3 && c.lost === 1 && c.carried === 1 && c.kept === 1; },
    "carry: a ledger chosen goes with its line (to check again when its direction changed), a line in Tally stays as it is, a line not read again stays in Restore");
  // 4. a line being posted: nothing read again
  ok(AC.inFlight({ state: "ready", postJob: "j1" }) && AC.inFlight({ state: "sent", checking: true }) && AC.inFlight({ state: "ready" }, () => ({ status: "waiting" })) && !AC.inFlight({ state: "ready" }) && !AC.inFlight({ state: "sent" }),
    "a line queued for Tally, or held for checking, counts as being posted");
  // 6. billing on a re-read: only the lines more than were paid for
  ok(AC.extraLines(4, 4) === 0 && AC.extraLines(4, 6) === 2 && AC.extraLines(5, 3) === 0, "read again: charged only for lines more than the first read (max(0, new - paid))");
  // 7. 24Q: a Date of Joining is no pay date for the AI either; Cess and Regime filled by names; TDS above gross not used
  const SAL2 = ["Staff,Tax No,Date of Joining,Pay Month,Total Pay,IT Deducted,Cess,Regime", 'ZZ One,AAAPZ1234A,15/06/2019,Sep-2026,"50,000","2,500",100,New', 'ZZ Two,AAAPZ5678B,01/02/2021,Sep-2026,"40,000","1,000",40,New'].join("\n");
  await tryOk(async () => { fresh(); C.S.books.cid = C.S.coId; answer = (req) => req.side === "payroll" ? { ok: true, map: { name: "Staff", pan: "Tax No", date: "Date of Joining", month: "Pay Month", gross: "Total Pay", tds: "IT Deducted" }, earn: [], ded: [] } : null;
    const r = await C.TDS24Q.fromFile(file("zz-sal2.csv", SAL2)); C.S.books.cid = "c1"; back();
    return r.rows.length === 2 && r.rows[0].date === "2026-09-30" && r.rows[0].cess === 100 && r.rows[0].regime === "N" && r.rows[1].tds === 1000; }, "24Q: the Date of Joining dropped (the month's last day), Cess and Regime read by their names");
  await tryOk(async () => { const co = fresh(); C.S.books.cid = C.S.coId; answer = (req) => ({ ok: true, map: { name: "Staff", pan: "Tax No", month: "Pay Month", gross: "IT Deducted", tds: "Total Pay" }, earn: [], ded: [] });
    const r = await C.TDS24Q.fromFile(file("zz-sal2.csv", SAL2)); C.S.books.cid = "c1"; back();
    return !!r.error && !co.aiColumns; }, "24Q: a mapping with TDS above the gross is not used, not kept");
}

console.log("5. the server's half (sheetmap.ts): side bank");
let SM = null;
try { SM = await import(pathToFileURL(path.join(ROOT, "server", "assistant", "sheetmap.ts")).href); } catch (e) { console.log("  (skipped: " + String(e.message).slice(0, 60) + ")"); }
if (SM) {
  ok(Array.isArray(SM.BANK_FIELDS) && SM.BANK_FIELDS.includes("narration") && SM.BANK_FIELDS.includes("balance") && typeof SM.BANK_SYSTEM === "string" && /bank statement/i.test(SM.BANK_SYSTEM), "a bank statement prompt and its fields");
  ok(/bank statement/i.test(SM.sheetPrompt(["A"], [], "bank")), "the user message says it is a bank statement");
  ok(SM.mapFor && SM.mapFor("bank").fields === SM.BANK_FIELDS && SM.mapFor("bank").system === SM.BANK_SYSTEM && SM.mapFor("vendor").fields === SM.PARTY_FIELDS && SM.mapFor("purchase").system === SM.SHEET_SYSTEM, "side -> its prompt and fields (bank, a party, a register)");
  const m = SM.parseSheetMap('{"map":{"date":"Txn On","narration":"Remarks","debit":"Money Out","credit":"Money In","balance":"Running Total","party":"Remarks"}}', ["Txn On", "Remarks", "Money Out", "Money In", "Running Total"], SM.BANK_FIELDS);
  ok(m.map.debit === "Money Out" && m.map.narration === "Remarks" && !m.map.party, "the answer checked against the bank fields");
}
console.log(fails ? "\n" + fails + " of " + n + " FAILED" : "\nall " + n + " passed");
process.exit(fails ? 1 : 0);
