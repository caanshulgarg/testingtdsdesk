# Security review: FinCom Bridge 2.5.17 (postings only into the linked Tally company by its GUID; the masters read's states and retries; the daily check by day; one own-Tally rule for reads)

Status: independently reviewed 19-20 Nov: several rounds on next-fix-linkedguid and next-fix-mastersread, the final
review, and the re-review of 0ee7c6eec; no blockers.

Range: b4770ee60..0e5b80ff0 (origin/staging-next at b4770ee60, which holds 2.5.16's signed commit 370f5479b; the whole
of next-fix-linkedguid, with next-fix-posttimeout and next-fix-mastersread merged into it, through the reviews' fixes up
to 0ee7c6eec; after it only 0e5b80ff0, the version: BridgeVersion 2.5.17, the tests' version checks, the allow-list's
wording and table hash, the beat and recorder fixtures and the test sheet)

Areas for the reviewer (no finding details are written here; the repository is public):
- Where a posting may go: the linked GUID named by FinCom's queue (migration 203) or by FinCom's page; nothing matched by
  name; the company list asked afresh before each request that posts or deletes, and the part confirmed after it; two
  open companies of one name; a link changed after the posting was made; a hand-out for another GUID.
- Whose Tally is this user's own on a shared computer: one rule (ownRule) for postings and every read, the light check
  and the other lists that lead to a request to Tally; a Tally whose owner Windows cannot tell; another Windows user's
  Tally never asked.
- What the beat and /status carry: linkGuid, openElsewhere {port, why} (never a GUID of a Tally a posting would not
  use), the masters read's progress and reasons (Tally's own words, its lists and quoted values left out of the retry
  reason); no secret.
- The masters retries and the daily catch-up: only the requests every read makes (no new request to Tally), bounded
  per company and day, the 2 s stop, the typing gate, postings first.
- The cloud side the bridge relies on: migration 203's gate, hold and grants (service_role for the bridge's functions,
  owners only for picking a company); tally-ingest's post_ok refusing a posting whose stamped GUID the link no longer
  has; the elsewhere words only from the posting's own bridge's beat.

The reviews (several rounds on next-fix-linkedguid and next-fix-mastersread, the final review, and the re-review of
0ee7c6eec) found no critical or high issue left open; every finding was fixed with a test that failed before, as the
code review lists. No blockers left.
