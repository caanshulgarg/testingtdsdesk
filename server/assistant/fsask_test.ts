// deno test server/assistant/fsask_test.ts - a request for the financial statements (fsask.ts), no database: which
// questions are the statements (the owner's sentences of 29-Oct-2026, typed and by voice), the period each names, the
// comparative, the notes, a file asked for, the period carried from the earlier question ("this", "the earlier message"),
// a voice slip (3rd for 30th September), last year's balance sheet among the conversation's files, and FinCom's own line.
import { fsAsked, fsLine, fsPeriod, fsRequest, pyFileOf } from "./fsask.ts";
// the owner's sentences of 29-Oct-2026, as in router_test.ts (which checks that none goes to the keyword router)
const OWNER_FS = [
  "Build my MIS: I want to make provisional balance sheet from 1st April 2026 to 30th September 2026.",
  "please prepare balance sheet for 1st April 2026 to 30th September 2026..you have daybook.. I am attaching last year balance sheet also",
  "I need proper schedule 3 balance sheet",
  "profit is different from tally.. I need fs till 30th September.. last year figures also.. I have attached final balance sheet in the earlier message",
  "1st April 2026 to 3rd September 2026, give me Provencial Balance Sheet with P&L and notes and give me last year's figure as well.",
  "I want the financial statement with Schedule 3.",
  "give me interim balance sheet", "P&L with BS for H1", "provisional P&L and balance sheet", "Provisional P&L with notes", "last year figures also",
  "Schedule III financial statements for 2025-26", "notes to accounts for September",
];

function assert(c: unknown, w: string): asserts c { if (!c) throw new Error(w); }
const eq = (a: unknown, b: unknown, w: string) => assert(JSON.stringify(a) === JSON.stringify(b), w + ": got " + JSON.stringify(a) + ", expected " + JSON.stringify(b));
const ANCHOR = "2026-10-26", TODAY = "2026-10-29";   // Impetus: the last Day Book held, and the day of the owner's report
const [S1, S2, S3, S4, S5, S6] = OWNER_FS;
const H1 = { from: "2026-04-01", to: "2026-09-30", cmp: "same", notes: true };

Deno.test("the statements: each of the owner's requests; not a question about the law, not a plain P&L", () => {
  for (const q of OWNER_FS) assert(fsAsked(q), "the statements: " + q);
  for (const q of ["what is Schedule III?", "explain the format of a balance sheet", "profit and loss for 2025-26", "cash payments in September", "TDS last year figures",
    "Build my MIS: a monthly P&L with last year beside it", "I need excel copy of this."]) assert(!fsAsked(q), "not the statements: " + q);
  assert(fsAsked("I need excel copy of this.", { fs: H1 }), "a follow-up to the statements: 'excel copy of this'");
});

Deno.test("the period: From-To as typed or spoken, 'till <date>', H1, a quarter, a year, 'as on'", () => {
  const p = (q: string) => { const x = fsPeriod(q, ANCHOR); return [x.from, x.to]; };
  eq(p(S1), ["2026-04-01", "2026-09-30"], "1st April 2026 to 30th September 2026");
  eq(p(S4), ["2026-04-01", "2026-09-30"], "'fs till 30th September': the year's start to that date");
  eq(p(S5), ["2026-04-01", "2026-09-03"], "the voice question as heard: 3rd September");
  eq(p("balance sheet from 1/4/2026 to 30/9/2026"), ["2026-04-01", "2026-09-30"], "day-first numbers");
  eq(p("balance sheet April 1, 2026 to September 30, 2026"), ["2026-04-01", "2026-09-30"], "month first");
  eq(p("balance sheet 1st April to 30th September"), ["2026-04-01", "2026-09-30"], "no years: the latest such period held");
  eq(p("balance sheet from 1st October 2025 to 31st March"), ["2025-10-01", "2026-03-31"], "To's year from From's");
  eq(p("Financial statements from 01-Apr-2026 to 30-Sep-2026, compared with the last full year"), ["2026-04-01", "2026-09-30"], "FinCom's own date format (the choice buttons ask in it)");
  eq(p("balance sheet 1-apr-26 to 30-sept-26"), ["2026-04-01", "2026-09-30"], "short years and Sept");
  eq(p("balance sheet as on 31-03-2026"), ["2025-04-01", "2026-03-31"], "as on 31 March: the full year");
  eq(p("H1 balance sheet"), ["2026-04-01", "2026-09-30"], "H1 of the year held");
  eq(p("Q2 financial statements"), ["2026-07-01", "2026-09-30"], "a quarter");
  eq(p("balance sheet for FY 2025-26"), ["2025-04-01", "2026-03-31"], "a financial year");
  eq(p("balance sheet 30th Feb 2026"), ["2025-04-01", "2026-02-28"], "a day past the month's end: its last day");
  eq(p("I need proper schedule 3 balance sheet"), [null, null], "no period named");
});

Deno.test("the request: comparative, notes, a file, the earlier question's period, the voice slip, Tally, last year's file", () => {
  const r1 = fsRequest(S1, { anchor: ANCHOR, today: TODAY })!;
  eq([r1.from, r1.to, r1.fy, r1.cmp, r1.notes, r1.want, r1.carried, r1.label], ["2026-04-01", "2026-09-30", "2026", "same", true, null, false, "01-Apr-2026 to 30-Sep-2026"], "provisional BS, 1-Apr to 30-Sep-2026");
  const r3 = fsRequest(S3, { anchor: ANCHOR, thread: { fs: H1 } })!;
  eq([r3.from, r3.to, r3.carried], ["2026-04-01", "2026-09-30", true], "'proper schedule 3 balance sheet': the earlier question's period");
  const r4 = fsRequest(S4, { anchor: ANCHOR, thread: { fs: H1 } })!;
  eq([r4.from, r4.to, r4.tallyDiff, r4.pyAsked, r4.cmp], ["2026-04-01", "2026-09-30", true, true, "same"], "'profit is different from tally': the period, Tally, last year's figures");
  // a date without its year follows the conversation's own period, even when the books held end earlier
  const ry = fsRequest(S4, { anchor: "2026-03-31", thread: { fs: H1 } })!;
  eq([ry.from, ry.to], ["2026-04-01", "2026-09-30"], "'till 30th September' after the 2026 statements, books held to 31-Mar-2026");
  eq(fsRequest(S4, { anchor: "2026-03-31", history: [{ role: "user", content: S1 }] })!.to, "2026-09-30", "... or after a question naming 2026");
  eq(fsRequest(S4, { anchor: "2026-03-31" })!.to, "2025-09-30", "with nothing earlier: the latest 30 September held");
  const hist = [{ role: "user", content: S2 }, { role: "assistant", content: "…" }, { role: "user", content: S4 }];
  const r5 = fsRequest(S5, { anchor: ANCHOR, history: hist, thread: { fs: H1 } })!;
  eq([r5.from, r5.to, r5.alt, r5.notes, r5.pyAsked], ["2026-04-01", "2026-09-03", { from: "2026-04-01", to: "2026-09-30" }, true, true], "the voice slip: 3rd September, with 30th as the choice");
  eq(fsRequest(S5, { anchor: ANCHOR })!.alt, null, "no earlier 30th: no choice offered");
  const x = fsRequest("I need excel copy of this.", { anchor: ANCHOR, thread: { fs: H1 } })!;
  eq([x.from, x.to, x.want, x.carried], ["2026-04-01", "2026-09-30", "xlsx", true], "'excel copy of this': the statements of the earlier question, in Excel");
  eq(fsRequest("I need excel copy of this.", { anchor: ANCHOR }), null, "with no statements earlier, 'this' is not the statements");
  const r6 = fsRequest(S6, { anchor: ANCHOR, thread: { fs: { ...H1, cmp: "fy" } } })!;
  eq([r6.from, r6.cmp], ["2026-04-01", "fy"], "the earlier comparative is kept");
  eq(fsRequest("balance sheet for Q2 without notes, compare with last full year", { anchor: ANCHOR })!.notes, false, "notes off");
  eq(fsRequest("balance sheet for Q2 without notes, compare with last full year", { anchor: ANCHOR })!.cmp, "fy", "the last full year");
  eq(fsRequest("balance sheet till 30 sept in pdf", { anchor: ANCHOR })!.want, "pdf", "a PDF");
  const files = [{ path: "f/c/uploads/a-notice.pdf", name: "ASMT-10.pdf", kind: "notice", summary: "A notice" },
    { path: "f/c/uploads/mvtbgrjq-Impetus-Balance-Sheet-F.y.-2025-26.pdf", name: "Impetus Balance Sheet F.y. 2025-26.pdf", type: "application/pdf", kind: "other", summary: "Audited financial statements of the company for FY 2025-26" }];
  eq(pyFileOf(files)?.name, "Impetus Balance Sheet F.y. 2025-26.pdf", "last year's balance sheet among the conversation's files");
  eq(pyFileOf([files[0]]), null, "a notice is not last year's balance sheet");
});

Deno.test("FinCom's own line: the period, the comparative's dates, what the card asks; never a figure", () => {
  const r = fsRequest(S4, { anchor: ANCHOR, thread: { fs: H1 } })!;
  const t = fsLine(r, { name: "Impetus Balance Sheet F.y. 2025-26.pdf" });
  for (const w of ["01-Apr-2026 to 30-Sep-2026", "as on 30-Sep-2026", "same period last year (01-Apr-2025 to 30-Sep-2025)", "with the notes", "Impetus Balance Sheet F.y. 2025-26.pdf", "Tally"])
    assert(t.includes(w), "says " + w + ": " + t);
  assert(!/₹|\d{1,3}(,\d{2,3})+(\.\d+)?/.test(t), "no figure: " + t);
  const v = fsLine(fsRequest(S5, { anchor: ANCHOR, history: [{ role: "user", content: S1 }] })!, null);
  assert(v.includes("You said 03-Sep-2026; earlier you said 30-Sep-2026") && v.includes("No last year's balance sheet is attached"), "the voice slip and no file: " + v);
  const fy = fsLine(fsRequest("balance sheet for Q2 compare with last full year", { anchor: ANCHOR })!, null);
  assert(fy.includes("the last full year (2025-26; its balance sheet as at 31-Mar-2026)"), "the last full year named: " + fy);
});
