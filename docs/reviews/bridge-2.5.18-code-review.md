# Code review: FinCom Bridge 2.5.18 (the bridge audit fixes, each company's own posting pace, and the payroll import FinComPayrollImport)

Status: independent code review, 22-Nov-2026, in two rounds. Both were read-only reviews of the branch next-bridge-2518:
- the first round covered 579f1d90c..7db75b73c;
- the re-review covered the fixes and the rebuild, 7db75b73c..41e561420.

No blockers. The first round's M1, L1, L2 and L4 are fixed in a22dba2e7.

Range: 579f1d90c..41e561420

The base is origin/staging-next at 579f1d90c, which carries 2.5.17. The range holds:
- the audit fixes 26962eb0f, 5940e577d and 1f9e4284b, merged in db186ef39;
- the payroll import 7253f5afd, 0c42de1e3 and 62ee6403e;
- the version eaf02b72b;
- the first build 7db75b73c;
- the review fixes a22dba2e7;
- the rebuild 41e561420.

## What was reviewed

1. The audit fixes. These were reviewed once before with no blockers. I checked them again briefly:
   - Typing gate, per session (mode.go, win_platform.go, keep.go). When a tray does not report, the bridge treats it as someone working in Tally. The gate fails closed.
   - One worker per posting job (jobs.go startJob, resumePostJob under jobLock). A second start or resume returns the running job's view and never writes over its progress.
   - The record is checked again under postGate before each part (recheckRefusals, sentSinceCheck). Only the entries refused now are taken off the queue (postQueue.drop).
   - The 2 s rule: the small check is capped at 2 s (probeSec). The company check under a background 2 s TC is capped too (safety.go). keepRun.checkTC is always ledgerTC.
   - Own-Tally only in findCompanyWith (ports.go, through ownRule and readElsewhere).

   I found nothing new in these fixes.
2. The per-company posting pace (postpace.go):
   - The pace is kept in sync\post-pace.json, format 2. A missing, unreadable or other-format file starts empty, at 2 vouchers a part.
   - Bills and bank lines are kept apart.
   - The larger of the time per voucher and the time per KB decides the part size. The size grows at most double per part. A job's first part is capped at PostBatchBills / PostBatchBank and at the company's last whole part.
   - A timeout is never learned; the next part is halved.
   - The file is saved at most every 30 s and flushed at the end of each job (deferred in jobWorker). Access is under postPace.mu.
   - A queue with no company keeps its pace in memory only.

   I found no format or locking fault. A damaged file can only make posting start slower (2 a part), never larger.
3. FinComPayrollImport (payrollimport.go, allowlist.go, pinned.go, selfwatch.go, tally.go, post.go, postpace.go):
   - Routing: tallyRequestID sends any Import carrying a payroll marker (any case, spacing or quote) to the payroll id. The plain Import pin refuses a body with a payroll marker.
   - The payroll pin requires the exact Vouchers envelope with one TALLYMESSAGE. Inside it there must be exactly one VOUCHER, ACTION="Create", with no REMOTEID. Every line is anchored by regex. The checks are:
     - the dates are real and equal to each other;
     - VOUCHERTYPENAME equals VCHTYPE;
     - each employee appears once (case-folded), with 100 employees at most;
     - each employee has 1 to 50 pay heads, each pay head once;
     - signs follow ISDEEMEDPOSITIVE;
     - each employee's amount is the sum of their pay heads, and their net pay is above zero;
     - the salary payable line equals the net;
     - amounts have at most 10 digits of rupees, so the int64 sums cannot overflow.
   - The outer envelope is rebuilt (importEnvelope with pinCo) and compared byte for byte.
   - requestClass is "import", readStopExempt is true, and selfwatch treats the payroll request as import time.
   - planImports and postQueue.next send a payroll bill alone. postQueue.done does not learn a payroll bill's time.
4. Version and assets:
   - BridgeVersion is 2.5.18 (util.go:21). The version tests are updated. No 2.5.17 string is left in the live code; the two left are history comments in daypace2516.go and daystop2516.go.
   - The rebuild at 41e561420 (from a22dba2e7) has setup f145006a...495e and program d490e081...78c6. I recomputed both hashes from the files. They match the setup .sha256 file, latest.json, the single RELEASE-CHECKLIST.md 2.5.18 row and the test sheet's fingerprint. The first build's d113c6fc / 69e0b563 no longer appear in any of these.
   - latest.json names 2.5.18 for both files, with requireSignature false and no .sig.

Tests run: `go test -count=1 -run 'TestPayroll|Pace|AllowList|R2518' ./...`, once at 7db75b73c and again at 41e561420. At 41e561420 I added `PostShapes` to the pattern. Both runs passed, including the new tests TestPayrollNeverBank, TestPayrollTextPrintable and TestPayrollMarkInTextOnly, and TestAllowListUnchanged. I did not build the exe.

## Findings

### M1 (medium): FIXED in a22dba2e7. A payroll voucher marked as a bank line is batched, and its time is learned into the pace
Files: post.go:110-124 (isBankItem), post.go:189-213 (planImports), postpace.go:57-68 (newPostQueueFor), postpace.go:174 and 186-190 (postQueue.next and done, the bank branch).

The "posted alone" split only looks at the bills list. Vouchers are split into bills and bank lines first, by isBankItem. A payroll voucher goes to the bank list in two cases:
- FinCom marks the item `bank` (jobs.go:312, or the browser's /import); or
- its voucher type is named Payment, Receipt or Contra. The payroll shape accepts any type name, as long as VCHTYPE and VOUCHERTYPENAME match.

Then:
- planImports chunks the payroll voucher together with the bank lines, and postQueue.next's default branch does the same. That request is routed to FinComPayrollImport, and its pin refuses it because it holds more than one VOUCHER. Nothing reaches Tally, so the pin holds. But every bank line in that part is refused with it.
- When the payroll voucher ends up alone in a bank part (a part of 1, or the last one), it is posted. done() then takes the bank branch, which has no payroll check, so the payroll time is learned into the company's bank pace (time per voucher, time per KB, and Part). This breaks the rule that a payroll voucher's time is never learned into the pace.

Suggested fix (first round): decide "payroll" before "bank", and add a test with `bank: true` and with VCHTYPE "Payment".

Re-review: isBankItem (post.go:112) now returns false for any payroll item before it looks at `bank` or the voucher type. It is the only place that decides "bank": planImports (post.go:197) and newPostQueueFor (postpace.go:63) both call it. The `bank` flag that jobs.go and /import carry is only read through it. So a payroll voucher is always a bill, which means:
- planImports and postQueue.next send it alone;
- postQueue.done returns early for it, so its time is never learned into either pace.

TestPayrollNeverBank covers:
- a payroll item marked `bank: true`;
- a payroll voucher whose type is named Payment;
- both next to bank lines, with a known pace;
- in planImports and in the job queue;
- for each outcome: answered, timed out and refused by the pin.

The test takes a snapshot of both paces around each payroll part only, so it does not check itself. Closed.

### L1 (low): FIXED in a22dba2e7 (capped and printable-only). The pin passes the validated body through as sent; it does not rebuild it from the parsed fields
File: payrollimport.go:191-211.

payrollImportRebuild rebuilds the envelope but passes the TALLYMESSAGE body through unchanged after validating it. The only freedom left is white space around the voucher. Because every line is anchored, this is in effect as strict as a rebuild.

However, the text fields (prText `[^<>&]`) accept any other character, including control characters that are not valid XML 1.0 (for example U+0000-U+0008). Suggestions:
- refuse control characters other than tab in prText; or
- rebuild the voucher from the captured fields, so the pin is a true rebuild as the hard rules ask.

Re-review: prTextOK now checks every payroll text: the voucher type, narration, category, each employee, each pay head, the payable ledger and the company (pinCo). Each text, after unescaping entities, must be:
- valid UTF-8;
- printable only (unicode.IsPrint, so no control character, tab, line break, C1, format or bidi character);
- at most 200 characters for a name and 2,000 for the narration.

The whole request is capped at 1 MiB. TestPayrollTextPrintable covers each field: it accepts non-ASCII letters, `&amp;` and text at the exact length limit, and refuses each bad character and limit + 1. It also covers the company, and confirms that 100 x 50 fits under 1 MiB while long names go over it.

The body still passes through as validated rather than being rebuilt. Every line is anchored and every text is now printable, so this is equivalent to a rebuild. I accept it.

### L2 (low): FIXED in a22dba2e7. A false positive in routing, which fails closed
File: payrollimport.go:42 and 51.

rePayrollMarks is matched against the whole envelope, company name included. It also accepts a single quote. An apostrophe needs no escaping in XML text, so a plain voucher whose narration literally contains `OBJVIEW='PaySlip Voucher View'` would be:
- routed to the payroll id;
- sent alone by planImports and postQueue.next;
- refused by the payroll pin.

Nothing wrong reaches Tally; the person only gets a refusal they cannot explain. You could match the attribute only inside the VOUCHER start tag, but this is optional.

Re-review: hasPayrollMark now looks for the marker only in prMarkup(x). prMarkup keeps every tag whole, with its attributes and quoted values (those are kept too, never dropped), and leaves out only the text between tags.

It fails closed: prMarkup reports "not certain" in any of these cases, and then the whole text is searched as in 7db75b73c:
- a tag or quote left open;
- a '<' inside a tag;
- a '>' in the text;
- `<!` or `<?` (a comment, CDATA, declaration or processing instruction).

The same function decides the routing (isPayrollImport), the plain Import pin (pinned.go:181) and the queue's split (isPayrollItem).

What the plain Import now accepts beyond 7db75b73c:
- The tag markers (EMPLOYEEENTRIES.LIST, PAYHEADALLOCATIONS.LIST, CATEGORYENTRY.LIST) need a literal '<'. Outside a comment or CDATA (which are not-certain cases anyway), a '<' always starts markup. So these markers can never hide in text.
- The only newly accepted form is therefore the OBJVIEW=...PaySlip Voucher View wording written as text between tags, for example in a narration. That is 2.5.17's behaviour, and Tally reads it as text.
- A marker in an attribute, even in a quoted value, is still found.
- An entity-escaped marker in text is text to Tally as well.

So nothing beyond 2.5.17's behaviour is accepted. TestPayrollMarkInTextOnly covers both sides: four narration mentions are plain Imports and are batched, and 14 cases that are markup or not certain go to the payroll id and are refused by both pins.

### L3 (info): the markers do not cover every payroll-like form
File: payrollimport.go:42.

A voucher with `<PERSISTEDVIEW>PaySlip Voucher View</PERSISTEDVIEW>` and no OBJVIEW is still a plain Import. So is one with an entity-escaped OBJVIEW (for example `&#32;` for the space). The plain Import already accepted such vouchers before 2.5.18, so this is not a new way past the pin. Employee or pay-head allocations cannot be sent without the literal tags, and those tags are always caught.

### L4 (low, test gap): FIXED in a22dba2e7
File: payroll2518_test.go:110-150.

TestPayrollPostsAlone only covers bills that are not bank lines. It does not check that the pace is left unchanged after a payroll part, whether answered, timed out or refused. M1's test should cover this.

Re-review: TestPayrollPostsAlone now checks that both paces are unchanged after the payroll part, for each outcome: answered, timed out and refused by the pin. TestPayrollNeverBank checks the same with a known pace.

### N1 (new, low, fails closed): one part's routing can differ from its entries' own check
File: payrollimport.go hasPayrollMark, used on each item (isPayrollItem) and on the whole envelope (tallyRequestID).

Suppose two plain bills end up in the same part:
- bill A has a raw '>' in its text, which is legal XML;
- bill B's narration mentions the payslip view.

Each bill on its own is plain, so the two are batched. In the envelope, though, A's '>' makes prMarkup not certain, so the whole text is searched. It finds B's mention, routes the part to FinComPayrollImport, and the pin refuses the whole part because it holds two vouchers. Nothing reaches Tally. The cost is a refused part that is hard to explain. It is rare, because FinCom escapes '>' and a narration that mentions the view is unusual.

Optional fix: decide the routing from the items' own hasPayrollMark (any item a payroll one), or in planImports put any item that is not certain into a part of its own.

### N2 (new, info): legitimate names with a no-break space are refused
File: payrollimport.go prTextOK.

unicode.IsPrint does not count U+00A0 (no-break space) or other non-ASCII spaces as printable. An employee or pay-head name pasted from a spreadsheet with a no-break space is therefore refused by the pin. This fails closed, and the person sees the pin's message. FinCom's builder could normalise these spaces to ordinary ones first, but there is nothing to change in the bridge.

### Nothing found
- No race in the job queue beyond the audit fixes already reviewed.
- No routing slip between "Import" and FinComPayrollImport. Every comparison goes through isImportID, requestClass and readStopExempt.
- No REMOTEID, Alter, second voucher, duplicate employee or duplicate pay head, overflow, CDATA, comment or extra element passes the payroll pin. I checked these by reading the code and with the tests' cases.
- No AI in the bridge.
- No shared tally.ini written, and no other Windows user's Tally used.
- No test checks itself. The fixture is read from tests/fixtures, and the bad cases are mutations of it.

## Verdict
No blockers. M1, L1, L2 and L4 are fixed and tested in a22dba2e7. L3 is info and stays as it was. N1 (low) and N2 (info) are new. Both fail closed and are optional.

The code is ready as far as this review goes: 579f1d90c..41e561420, with the 41e561420 build's hashes consistent across the .sha256 file, latest.json (2.5.18, unsigned), the release log and the test sheet.

The release stays held for the reasons the release log already gives: the review notes, release-check.sh, and FinComPayrollImport not yet timed against the 2 s rule at 100 employees.

Coordinator addendum (22-Nov-2026): the bridge sources reviewed are those of a22dba2e7; the commits after it until the rebuild only move built files and change docs (git diff a22dba2e7 -- bridge-go is empty). Release-check range for this note:
Range: 579f1d90c..1fd504ff7
