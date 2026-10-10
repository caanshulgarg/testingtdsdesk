# Security review: FinCom Bridge 2.2.4 (Tally's answers read with or without TYPE attributes)

Reviewed: 05-Oct-2026, alongside the code review of the same range (bridge-2.2.4-code-review.md), which has the
details. One round (the owner's rule). The bridge sources are read with `git diff 97f6bd8 <to> -- bridge-go/
docs/tally-allowlist.md`.

## What 2.2.4 does

The bridge reads Tally's answers with or without TYPE attributes on their fields, and never takes CMPINFO's counters
as vouchers or ledgers (the branch fix-tally-attrs).

## What holds

- **No request shape changed.** The allow-list table is unchanged (TestAllowListUnchanged); only the decision line names
  2.2.4. No new request, no new id, no new route, no new host.
- **The acceptance rules are unchanged.** Reading a typed field gives the same value as before (trimmed); an entry is
  still taken only when Tally's own ids, the company GUID held, type, date, number and the starting point agree. A
  CMPINFO counter can no longer be mistaken for an entry, which closes a way a count could pass as a voucher.
- **Nothing new leaves the computer.** The log's answer head now drops CMPINFO (L1); it is the local log only.
- **Real Tally fixtures** (bridge-go/testdata/real-tally-7.1/) are test data only, not built into the program.

## Round 1 (97f6bd8..ff925e4)

No High. M1 (the typed CI test expectation) and L1 (answerHead drops CMPINFO) fixed in ff925e4. Lows L2 to L8 in the
code review, for the next build; none lets a wrong entry into the books or widens a request: L2 and L3 can at most
make a field or a count unread (the entry is then held, not taken), L4 and L5 keep the old literal match in two
places, L6 is memory, L7 and L8 are test and CI.

## After the round

1a0f488: the version, the pins and the decision line. No finding.

Range: 97f6bd8..1a0f488
