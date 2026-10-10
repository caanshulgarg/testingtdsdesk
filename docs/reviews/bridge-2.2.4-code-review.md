# Code review: FinCom Bridge 2.2.4 (Tally's answers read with or without TYPE attributes)

Reviewed: 05-Oct-2026, by the reviewers in the Claude Code session, in one round (the owner's rule: one round; High
and Medium fixed, Lows to the next build). The bridge sources are read with `git diff 97f6bd8 <to> -- bridge-go/
docs/tally-allowlist.md .github/workflows/ci.yml`.

## What 2.2.4 does

Only the branch fix-tally-attrs (035c43e, ba32bcb, 468973e, ff925e4), merged into tax-accuracy as a fast-forward:
- **Tally's answers read with or without attributes.** Real TallyPrime 7.1 answers typed fields
  (`<MASTERID TYPE="Number"> 2</MASTERID>`, `<DATE TYPE="Date">`, ...). The bridge's field reads (tallyxml.go, and its
  callers in held.go, keep.go, post.go, recorder_live.go, recorder_resolve.go, recorder_probes.go, safety.go,
  measure.go, readtest.go, fetchtest.go, dupcheck.go, trial.go, tally.go) now take a field whatever its attributes and
  trim its value, so the entry fetch by MasterID or by number finds the voucher Tally sent.
- **CMPINFO's counters are never objects.** A real Tally's answer carries `<CMPINFO>` with `<VOUCHER>n</VOUCHER>`,
  `<LEDGER>n</LEDGER>` counters; they are no longer counted or taken as vouchers or ledgers.
- **Tests first** (035c43e): real TallyPrime 7.1 answers as fixtures (bridge-go/testdata/real-tally-7.1/), the stand
  Tally able to answer typed (STAND_TALLY_TYPED=1), and a CI job running the bridge's tests with the typed stand
  (bridge-linux-typed, go test -timeout 14m).
- No request shape changed: the allow-list table is unchanged (TestAllowListUnchanged); only the decision line names
  2.2.4.

## Round 1 (97f6bd8..ff925e4)

No High.

- **M1** (fixed in ff925e4). The typed CI run's test expectation: the read test's log check expected the stand's own
  answer head, which a real (typed) Tally's HEADER does not match. The check now takes a real Tally's HEADER.
- **L1** (fixed in ff925e4). answerHead's 200 characters were filled by CMPINFO's counters on a real Tally, so the log
  showed nothing of the answer. The head now drops CMPINFO.

Lows accepted, listed for the next build:
- **L2.** A `>` inside an attribute value breaks the `[^>]*` patterns (Tally does not write one today).
- **L3.** An empty or self-closed `<VOUCHER/>` is counted differently by countVouchers and vchNodes.
- **L4.** keep.go:712, 718: useKeepPosted still matches a literal `<GUID>` (no attributes).
- **L5.** measure.go:377, 384: literal closing tags, and the split on TALLYMESSAGE.
- **L6.** renameKeepLedger: its regex cache grows with each ledger name.
- **L7.** The typed stand is not fully faithful to a real Tally (the Day Book prologue, empty BILLALLOCATIONS, the
  cnReport answer untyped).
- **L8.** CI: the bridge-linux job's timeout (15 min) is close to go test's own (14 min).

## After the round

1a0f488: BridgeVersion 2.2.4, the version pins in three tests and two fixtures, the allow-list decision line. No other
bridge source changed.

Range: 97f6bd8..1a0f488
