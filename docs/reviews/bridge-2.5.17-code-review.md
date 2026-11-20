# Code review: FinCom Bridge 2.5.17 (postings only into the linked Tally company by its GUID; the masters read's states and retries; the daily check by day; one own-Tally rule for reads)

Status: independently reviewed 19-20 Nov: several rounds on next-fix-linkedguid and next-fix-mastersread, the final
review, and the re-review of 0ee7c6eec; no blockers.

Range: b4770ee60..0e5b80ff0 (origin/staging-next at b4770ee60, which holds 2.5.16's signed commit 370f5479b; the whole
of next-fix-linkedguid, with next-fix-posttimeout and next-fix-mastersread merged into it, through the reviews' fixes up
to 0ee7c6eec; after it only 0e5b80ff0, the version: BridgeVersion 2.5.17, the tests' version checks, the allow-list's
wording and table hash, the beat and recorder fixtures and the test sheet)

What the range holds (the bridge's part; the cloud's and the app's are named where the bridge relies on them):
1. Postings only into the linked company by its GUID (668fd741e, a8bb0a580, 408b28780, eabaf170d, ab26caa1a, 932fb868b,
   65aa69757, 9cdf100bc, 493784ad0; linkguid.go, jobs.go, post.go, server.go, cloud.go): every posting or deletion names
   the linked GUID (FinCom's queue: tally_post_jobs.company_guid, migration 203; a browser's /jobs, /import and /unpost:
   the link's company_guid); one that names none is never sent and never matched by name. Before each request that
   posts or deletes, the company list is asked afresh (the request the posting asked before each part anyway) and the
   request goes only when exactly one open company of this user's own Tally has the GUID and no other open company has
   its name; the next look confirms the part before it (else: sent, outcome not known, never sent again). /status says
   linkGuid; the beat names no GUID for a company open only in a Tally a posting would not use (openElsewhere {port,
   why}); a hand-out for another GUID than the one a posting started with is refused with the plain reason; one hand-out
   of a posting at a time; a request Tally created nothing of is failed in Tally's words, needs review only when created,
   altered, exceptions or ignored say so.
2. Parts sized by Tally's reply time (postpace.go, the owner's condition that posting is never slower): the next part's
   size from the time Tally took for the last, aiming at PostTargetMs (1350 ms), never more than doubled, at most 500,
   halved after no answer; PostPaceOff keeps the fixed sizes. The same entries in the same order, each request Tally's own
   import.
3. The masters read (54a938f6c, 6fe34ec02; ledgers.go, mastersretry.go): Tally's error in its own words (errTallySaid),
   never "no masters"; every read says its start; a failed first read asked again by the light check at most once in 10
   minutes, never beside another read or a posting, no more after 3 failures with the same reason or 6 tries a day; the
   "ledgers" wake of a company never read starts its first read. The Tally page's four Masters states are the app's
   (83f8c57b4, 91cfc937c).
4. The daily catch-up by day (54a938f6c, 6fe34ec02; daycatch.go): at the first quiet moment, for the linked companies
   open in this user's own Tally not read in full today; day-check.json, retried after 30 minutes, 4 a day; the night's
   slot unchanged.
5. One own-Tally rule for reads and postings (04d9230de, 0ee7c6eec; linkguid.go ownRule, ports.go, ledgers.go,
   startpoint.go, daycatch.go, keep.go, nocompany258.go, oldtest.go): the recorder's own-Tally record, the ledger, bank
   and masters reads' port, the daily catch-up, the kept-books run, the light check and the other lists that lead to a
   request to Tally take only ownRule's Tallies (an owner-unknown Tally counts only while Windows tells no owner); a read
   left out says the posting's words (readElsewhere).

The reviews and what was done (each finding fixed with a test that failed before; the commits name them):
- next-fix-linkedguid, rounds one to four: the fail-closed company check and own-Tally only (408b28780); no fallback by
  name for FinCom's queue (eabaf170d, the coordinator's decision of 19-Nov-2026); a hand-out taking FinCom's GUID when it
  had none (ab26caa1a); browser postings naming no GUID never sent, hand-backs compared with the GUID posted into
  (932fb868b, linkguid_review_test.go); /status linkGuid, the beat's open companies and the per-posting hand-out lock
  (9cdf100bc, linkguid_round3_test.go); openElsewhere and the lock forgotten when idle (493784ad0,
  linkguid_round4_test.go).
- next-fix-mastersread: S1-S7 and N1-N8 (6fe34ec02, mastersread_test.go): a failed read over held masters, a new round
  on retry, pressed and background runs kept apart, the retries' limits, a step that read nothing is not a read.
- The final review: one rule for reads and postings (04d9230de, ownrule_test.go).
- The re-review of 0ee7c6eec: the light check and the other own-Tally lists follow the rule (TestOwnRuleLightCheck,
  TestOwnRuleOtherLists). No blockers left.

The owner's rules, as the author kept them:
- Each Tally request 2 s at most (3 s a payroll entry), one in flight, postings and saves first, the typing gate kept.
- No new or changed Tally request XML: TestAllowListUnchanged, TestEveryRequestOnList, TestNoComputedFigure and
  TestUnknownRequestRefused green; docs/tally-allowlist.md changed in its wording only (allowed for 2.5.17 by the owner's
  standing decision of 2026-10-06).
- No shared tally.ini written; Tally never started.
- Cloud changes add-only: migration 203 (applied on staging, with tally-ingest at 0ee7c6eec, before this bridge).
- No real client names, keys or model ids in code, tests, logs or commits.

Tests run by the author: go vet (linux, windows); the full Go suite (TestPostShapesCurrent the one allowed failure, see
the release log row); the linked-GUID, masters-read and own-rule suites against the stand-in Tally (linkguid*_test.go,
mastersread_test.go, ownrule_test.go, postbench_test.go). What only Windows can check is marked in
docs/bridge-2.5.17-test-sheet.txt.
