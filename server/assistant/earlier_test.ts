// deno test server/assistant/earlier_test.ts (run by tests/run_assistant_agent.py; needs nothing else): the files attached
// earlier in a chat, read again for a question that refers back to them (earlier.ts). Which questions refer back (English,
// Hinglish, Hindi), which files are picked and in what order, the firm's, client's and user's rules, and the limits.
// All names and paths made up.
import { allowedPath, EARLIER, EarlierFile, earlierNote, ownedBy, pickEarlier, refersBack, rereadable, usingLine, withinBudget } from "./earlier.ts";
import { pyFileOf } from "./fsask.ts";
import { KINDS } from "./upload.ts";

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));

const FIRM = "11111111-1111-4111-8111-111111111111", OTHER_FIRM = "22222222-2222-4222-8222-222222222222", CLIENT = "larkspur";
const ME = "aaaaaaaa-0000-4000-8000-000000000001", STAFF = "aaaaaaaa-0000-4000-8000-000000000002";
const up = (n: string, firm = FIRM, client = CLIENT) => firm + "/" + client + "/uploads/m1-" + n;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const CMA: EarlierFile = { path: up("earlier-CMA.xlsx"), name: "earlier CMA (FY24-25).xlsx", type: XLSX, kind: "cma", summary: "CMA data (2024-25): 4 of its forms (operating statement, balance sheet analysis, MPBF …)." };
const BS: EarlierFile = { path: up("BS-FY25-26.xlsx"), name: "BS FY25-26.xlsx", type: XLSX, kind: "balance_sheet", summary: "A balance sheet / financial statements as at 31-Mar-2026 (25-26)." };
const BANK: EarlierFile = { path: up("bank.pdf"), name: "made-up bank statement.pdf", type: "application/pdf", kind: "bank", summary: "A bank statement: Made-up Bank, account ending 0001." };
const NOTICE: EarlierFile = { path: FIRM + "/" + CLIENT + "/notices/m1-n.pdf", name: "notice.pdf", type: "application/pdf", kind: "notice", summary: "A notice." };
const THREAD = [CMA, BS];                         // the CMA first, then last year's balance sheet: the balance sheet is the latest
const opt = { firm: FIRM, clientId: CLIENT };
const row = (f: EarlierFile, o: Record<string, unknown> = {}) => ({ path: f.path, client_id: CLIENT, created_by: ME, size: 40_000, kind: f.kind, ...o });

Deno.test("a question that refers back to the files: English, Hinglish and Hindi; a question that does not", () => {
  for (const q of ["pls prepare cma data on this basis", "use the same file", "the balance sheet I gave", "from the earlier CMA", "make it like the attached sheet", "based on these",
    "as per this", "is basis pe cma bana do", "isi file se banao", "jo maine bheji thi uske hisaab se", "pichhli wali sheet dekho", "इसके आधार पर सीएमए बनाओ", "जो मैंने दी थी उससे बनाओ"]) {
    assert(refersBack(q), "refers back: " + q);
  }
  for (const q of ["What is the TDS rate on commission?", "what is basis of depreciation under the act?", "sales of this year", "with this client open, show the cash balance", "what is the due date of GSTR-3B?"]) {
    assert(!refersBack(q), "does not refer back: " + q);
  }
});

Deno.test("the owner's follow-up, 'pls prepare cma data on this basis': both files read again, the latest first, then the one its kind matches", () => {
  eq(pickEarlier("pls prepare cma data on this basis", THREAD, opt).map((f) => f.name), [BS.name, CMA.name], "the balance sheet (the latest) and the earlier CMA");
  eq(pickEarlier("prepare cma data for FY 2026-27", THREAD, opt).map((f) => f.name), [CMA.name, BS.name], "no back-reference: the work (a CMA) needs the CMA and the balance sheet, the CMA first");
  eq(pickEarlier("pls prepare cma data on this basis", [...THREAD, BANK], opt).map((f) => f.name), [BANK.name, CMA.name, BS.name], "the latest (a bank statement) first, then the CMA and the balance sheet; the order is by relevance");
  eq(pickEarlier("on this basis", [...THREAD, BANK], opt).map((f) => f.name), [BANK.name], "'this' alone: the latest file");
  eq(pickEarlier("compare these", [...THREAD, BANK], opt).map((f) => f.name), [BANK.name, BS.name, CMA.name], "'these': every file, newest first");
  eq(pickEarlier("the balance sheet I gave, read it", [BS, BANK], opt).map((f) => f.name), [BANK.name, BS.name], "the latest and the balance sheet it names");
  eq(pickEarlier("What is the TDS rate on commission?", THREAD, opt), [], "a question that needs no file: nothing read again");
  eq(pickEarlier("on this basis", [NOTICE], opt), [], "a notice keeps its own flow: never read again here");
  eq(pickEarlier("on this basis", [{ ...CMA, name: "letter.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", path: up("letter.docx") }], opt), [], "a Word file is not read again by the server (its summary stays)");
  eq(pickEarlier("on this basis", THREAD, { ...opt, exclude: [BS.path] }).map((f) => f.name), [CMA.name], "a file sent again with the question is not read twice");
});

Deno.test("another firm's, another client's or a made-up path is refused; another member's file is not read", () => {
  assert(allowedPath(CMA.path, FIRM, CLIENT), "the firm's own upload for the client open");
  for (const [p, why] of [[up("x.xlsx", OTHER_FIRM), "another firm's"], [up("x.xlsx", FIRM, "zz-other-client"), "another client's"], [FIRM + "/" + CLIENT + "/files/x.xlsx", "a file the assistant made"],
    [FIRM + "/" + CLIENT + "/notices/x.pdf", "a notice"], [FIRM + "/" + CLIENT + "/uploads/../../" + OTHER_FIRM + "/x.xlsx", "climbing out of the folder"], [FIRM + "/" + CLIENT + "/uploads/a/b.xlsx", "a deeper path"],
    [FIRM + "x/" + CLIENT + "/uploads/x.xlsx", "a firm id that only starts the same"], ["", "nothing"]] as const) {
    assert(!allowedPath(p, FIRM, CLIENT), "refused: " + why + " (" + p + ")");
  }
  assert(!allowedPath(CMA.path, FIRM, null) && allowedPath(up("x.pdf", FIRM, "_firm"), FIRM, null), "no client open: only the firm-wide folder");
  const theirs = [{ ...CMA, path: up("cma.xlsx", OTHER_FIRM) }, { ...BS, path: up("bs.xlsx", FIRM, "zz-other-client") }];
  eq(pickEarlier("pls prepare cma data on this basis", theirs, opt), [], "the thread naming another firm's or client's file: nothing picked");
  const picked = pickEarlier("pls prepare cma data on this basis", THREAD, opt);
  const b = withinBudget(picked, [row(BS, { created_by: STAFF }), null], { user: ME, clientId: CLIENT, files: 30, bytes: 100 * 1048576 });
  eq([b.take, b.refused], [[], [BS.path, CMA.path]], "another member's upload, and a file with no upload record of the firm (RLS shows none): not read");
  assert(!ownedBy(row(CMA, { client_id: "zz-other-client" }), { path: CMA.path, user: ME, clientId: CLIENT }), "a record of another client: refused");
  assert(!ownedBy(row(CMA, { path: BS.path }), { path: CMA.path, user: ME, clientId: CLIENT }), "a record of another path: refused");
  assert(!ownedBy(row(CMA), { path: CMA.path, user: "", clientId: CLIENT }), "no user: refused");
  assert(ownedBy(row(CMA), { path: CMA.path, user: ME, clientId: CLIENT }), "the same firm, client and user: read");
});

Deno.test("the limits: at most 4 files and 30 MB read again, within what the message leaves; what is left out is said", () => {
  const many = Array.from({ length: 7 }, (_x, i) => ({ ...BS, path: up("bs" + i + ".xlsx"), name: "BS " + i + ".xlsx" }));
  const p = pickEarlier("compare all these balance sheets", many, opt);
  eq(p.length, EARLIER.files, "at most " + EARLIER.files + " files picked");
  eq(p[0].name, "BS 6.xlsx", "the newest first");
  const rows = p.map((f) => row(f, { size: 12 * 1048576 }));
  const b = withinBudget(p, rows, { user: ME, clientId: CLIENT, files: 30, bytes: 100 * 1048576 });
  eq([b.take.length, b.left.length], [2, 2], "12 MB each: two within 30 MB, the other two left out");
  assert(b.take.reduce((t, f) => t + f.size, 0) <= EARLIER.bytes, "never over " + EARLIER.bytes + " bytes");
  const tight = withinBudget(p, p.map((f) => row(f)), { user: ME, clientId: CLIENT, files: 1, bytes: 100 * 1048576 });
  eq([tight.take.map((f) => f.name), tight.left.length], [["BS 6.xlsx"], 3], "the message has room for one more file: the newest only");
  const noRoom = withinBudget(p, p.map((f) => row(f)), { user: ME, clientId: CLIENT, files: 0, bytes: 100 * 1048576 });
  eq(noRoom.take, [], "30 files sent with the question: none read again");
  const bytes = withinBudget(p, p.map((f) => row(f, { size: 2 * 1048576 })), { user: ME, clientId: CLIENT, files: 30, bytes: 3 * 1048576 });
  eq(bytes.take.length, 1, "the bytes the message's own files leave: one of 2 MB in 3 MB");
  eq(withinBudget([CMA], [row(CMA, { kind: "other" })], { user: ME, clientId: CLIENT, files: 30, bytes: EARLIER.bytes }).take[0].kind, "cma", "a record kept as 'other' (before migration 198) keeps the panel's kind");
});

Deno.test("which files were used is said: the model's note and the answer's first line", () => {
  eq(usingLine([CMA.name, BS.name]), "Using: earlier CMA (FY24-25).xlsx, BS FY25-26.xlsx", "the line");
  const n = earlierNote([CMA.name, BS.name]);
  assert(n.includes("1. earlier CMA (FY24-25).xlsx; 2. BS FY25-26.xlsx") && n.includes("\"Using: earlier CMA (FY24-25).xlsx, BS FY25-26.xlsx\""), n);
});

Deno.test("the kinds: balance_sheet and cma are the classifier's own (never 'other'); last year's balance sheet is never a CMA", () => {
  assert(KINDS.includes("balance_sheet") && KINDS.includes("cma"), "the classifier's kinds: " + KINDS.join(", "));
  assert(rereadable(CMA) && rereadable(BANK) && !rereadable({ name: "x.docx", type: "" }), "Excel and PDF are read again; Word is not");
  eq(pyFileOf([CMA, { ...BS, name: "last year.xlsx", summary: "" }])?.name, "last year.xlsx", "a balance sheet by its kind alone; the CMA (it analyses a balance sheet) is not last year's statements");
});
