# Security review: FinCom Bridge 2.5.18 (the payroll import FinComPayrollImport; the company's own posting pace; the audit fixes)

Status: independently reviewed 22 Nov (read-only; targeted tests and throwaway checks outside the repository): the first
round at 7db75b73c, then the re-review of the fixes a22dba2e7 and the rebuild 41e561420; no blockers.

Range: 579f1d90c..41e561420 (origin/staging-next at 579f1d90c, which carries 2.5.17; next-bridge-2518 through the
first 2.5.18 build 7db75b73c, the review fixes a22dba2e7 and the rebuild 41e561420)

Areas for the reviewer (no finding details are written here; the repository is public):
- The new allow-listed request FinComPayrollImport: how it is told apart from the plain Import, its pin (the body held
  to the spec's one-voucher shape and the request rebuilt and compared byte for byte), what a cloud job's text may
  carry inside it, its figures, its limits, and that a payroll-marked body is never let through as the plain Import.
- The posting queue: a payroll voucher sent alone; its time kept out of the bills' pace.
- The per-company posting pace (sync\post-pace.json): where it lives, what its keys and values can do.
- The own-Tally rule now also in the company search for reads; the typing gate per tray session; the update list.

## What was checked

- Routing. Every Import Data request whose markup carries a payroll marker (the employee, pay-head or category lists, or
  the payslip view in the voucher's attribute; any letter case, spacing or quote) is given the payroll id; the plain
  Import pin refuses any body with such a marker as well. Since a22dba2e7 the marker is looked for in the tags and
  their attributes only (hasPayrollMark / prMarkup), so a plain voucher whose narration merely names the view stays a
  plain Import. Every '<' starts a markup segment that runs whole to its closing '>' (quotes tracked), so no list tag
  can fall into the text part; a '>' in text, a '<' inside a tag, an open tag or quote, a comment, CDATA, declaration
  or processing instruction makes the split uncertain and the whole text is searched as before (fails closed). A
  randomised check of 200,000 mutated payroll bodies (markup characters, quotes, comments, CDATA inserted) found no
  list tag hidden from it and no payroll list let through as a plain Import. A body cannot be routed to any other id: the id is decided
  by the fixed Import prefix before anything else.
- The payroll pin. The envelope is rebuilt from the company alone (unescaped, re-escaped, compared byte for byte, so
  only the canonical form passes); the body must be one TALLYMESSAGE holding exactly one VOUCHER matched by anchored
  patterns from its opening tag to its end, line by line, with no other element or attribute. ACTION is fixed to
  Create; no REMOTEID, GUID, ALTER or DELETE can appear. Texts exclude markup characters and allow only the five
  named entities, so a comment, CDATA, a nested tag, a processing instruction or a numeric character reference is
  refused (checked). The request markup list (reImportNever) and the posting rule (cannotSend) are applied on top.
  Go's regular expressions are linear-time, so no input can make the check slow.
- Figures. Amounts are at most ten digits of rupees and two decimals, so the paise sums cannot overflow (100 x 50
  allocations); signs follow ISDEEMEDPOSITIVE; each employee's amount is the sum of their pay heads and below zero;
  the payable line is the positive net; duplicate employees and pay heads are caught after entity-unescape and case
  and space folding; dates are real calendar dates and the effective date equals the date.
- Payroll never shares a request: alone in planImports and in the posting job's queue. Since a22dba2e7 a payroll item
  is never a bank line (isBankItem, the only bank classifier, answers no for it whatever its mark or type), so L1 is
  closed; checked with a bank-marked, payment-typed payroll voucher beside a bank line.
- Texts (since a22dba2e7): the voucher type, narration, category, employee, pay head, ledger and company must be valid
  UTF-8 of printable characters after unescaping (no control character, NUL, tab, line break, format or bidi
  character), names at most 200 characters, the narration 2,000, the request 1 MB; checked.
- Sending path. FinComPayrollImport has every place the plain Import had (request class, the read-stop exemption, the
  import time in the self-watch, the pin error's wording); it goes only through the posting job, so the linked GUID,
  the own-Tally rule, the record before the send and one request in flight apply unchanged. No master is created.
- post-pace.json: one fixed file name in the sync folder; company names and GUIDs are JSON keys only, never part of a
  path, so no traversal. Values read back are bounded: non-positive averages reset, a part size is capped by
  PostBatchBills / PostBatchBank and maxBatch, a huge time gives one voucher a part. A changed file can only change
  part sizes within those caps. Written with the same helper and folder as day-pace.json (no new exposure).
- Own Tally. The company search for reads (findCompanyWith) now uses the postings' ownRule, so another Windows user's
  Tally, or one whose owner Windows cannot tell, is not read or taken; no change reads a shared tally.ini.
- Update. latest.json names 2.5.18 with no latest.json.sig in the commit; the bridge refuses a list without a good
  signature, so no bridge updates itself from it. The list is now also bound to the bridge's own entry and program
  name (bridgeManifestRefuses), so another product's signed list is never taken.
- Logging. The payroll code writes no log line of its own; the self-watch line gives a count only; refusal lines carry
  the bridge's own words, not the voucher's names or amounts. No secret logged.

## Findings

- L1 (low, fails closed; FIXED in a22dba2e7): a payroll voucher classed as a bank line (a payment, receipt or contra
  type, or marked bank) went to the bank queue, where it was not kept alone (at 7db75b73c: post.go:192, postpace.go:63
  and :174); the payroll pin then refused the whole part, so nothing wrong reached Tally but the other bank lines in
  that part were refused with it. Fixed by deciding payroll before bank in isBankItem; test TestPayrollNeverBank;
  re-checked.
- L2 (low; FIXED in a22dba2e7 for the payroll request): the payroll texts accepted control characters, a NUL, invalid
  UTF-8 and any length (at 7db75b73c: payrollimport.go:38). They could not form markup, but were not valid XML. Fixed by
  prTextOK (printable UTF-8, length caps) on every text and the company, and a 1 MB cap on the request; test
  TestPayrollTextPrintable; re-checked. The plain Import's same gap is existing and outside this range.
- I1 (info, unchanged): the payslip-view marker is matched as literal text; the plain Import (existing, the wider envelope) does
  not refuse numeric character references in attributes, so a voucher naming that view in an encoded form, but with
  none of the payroll lists, is routed as a plain Import. Every such voucher was already sendable before 2.5.18, so
  this does not widen anything. Optional: refuse character references in the plain Import's attributes.
- I2 (info, unchanged): the payroll voucher type is any name (it only has to equal VCHTYPE); Tally decides whether it is a payroll
  type. Optional: FinCom names only the company's payroll voucher types.
- I3 (info, unchanged): /tray/idle takes the session number from the tray's body (behind the tray's own proof). A tray can only
  make the typing gate hold more, or report its own session; not a security boundary.
- I4 (info, new in a22dba2e7): the printable rule refuses a no-break space and other non-ASCII spacing, which can come
  from a spreadsheet, and the 1 MB cap is below the largest voucher the 100 x 50 and 200-character limits allow. Both
  fail closed (the voucher is refused and FinCom says why); FinCom's builder should normalise spacing and split by size.

## Tests run

`go test -count=1 -run 'TestPayroll|AllowList|Pinned|R2518' ./...` passed at 7db75b73c and again at
41e561420. Throwaway checks (outside the repository, removed): case, spacing and quote variants of the markers; REMOTEID, Alter, comments, CDATA, numeric entities, CRLF
and extra elements refused; control characters and a 100 KB narration accepted (L2); a bank-classed payroll voucher
batched with a bank line (L1); a company name with markup characters round-trips through the pin. At 41e561420: the
randomised marker check above; control, format and bidi characters, a tab and an over-long name refused; a payroll
voucher marked bank sent alone as a bill.

## Verdict

No critical, high or medium finding over the whole range. L1 and L2 are fixed in a22dba2e7 and the fixes hold; the
marker split fails closed on anything it cannot tell apart. FinComPayrollImport is no wider than the plain Import and
narrower in every respect; a payroll-marked body does not reach Tally by any other id. Not to be handed out until the
release check's other conditions (signed list, the 100-employee timing) are met, as the build commit says.

Coordinator addendum (22-Nov-2026): the bridge sources reviewed are those of a22dba2e7; the commits after it until the rebuild only move built files and change docs (git diff a22dba2e7 -- bridge-go is empty). Release-check range for this note:
Range: 579f1d90c..1fd504ff7
