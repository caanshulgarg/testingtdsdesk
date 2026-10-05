# Security review: FinCom Bridge 2.2.1 (new entries from the real NWS144 Tally)

Reviewed: 05-Oct-2026. I read git diff 6fb6cc9 8185245 -- bridge-go/ docs/tally-allowlist.md from a clean worktree of
8185245, alongside the code review of the same range (bridge-2.2.1-code-review.md), which has the details.

Checks:
- go vet (Linux, Windows): clean.
- go test -count=1 ./...: ok. The tree stayed clean.
- A throwaway test confirmed S1 and the guard's bounds. It was deleted and the worktree removed.

## What holds

- **The third dated exception (FinComVoucherByNumber) cannot be widened.**
  - It is pinned byte-exact to its builder, checked by id whatever ReadDays says, and limited to one day. That day lies
    between the starting point's day and today, and within 3 days or on a day the bridge itself just asked.
  - Type and number go in exactly, joined by AND. A quote, a line break, any control character, an empty value or more
    than 100 characters is refused before anything is built.
  - It cannot list a day's vouchers: a changed `AND`, a second day, an older or a future day are all refused.
- **Prospective only.** An answer at or below the starting point, of another company, or without a real GUID is not
  used.
- **Availability.** It never runs during a posting or an import. The 2 s rule switches it off per company. Retries are
  bounded (3 per line; the resolver 10 per turn, every 10 minutes, for 7 days).
- **The re-scan.** It is read only (shared reads), once per sync folder, over the last 7 days, and skips failed.txt.
- **Placeholders.** A placeholder GUID never leaves the computer.
- **Exactly once.** Each resolved line goes once across restarts (the held list and the 7-day sent ids).
- **Nothing new leaves the computer** beyond received_at (the bridge's clock); no new host.

## Findings

- S1 (MEDIUM, integrity; code review 1). A new ledger's GUID is rebuilt from its MasterID
  (`<company GUID>-%08x`), a form proven for vouchers only. It is sent whenever the ledger body fetch fails, as
  confirmed with a throwaway test (`ledger_created`, object_guid `<co>-000001f4`, no body). A wrong GUID would tie the
  line to the wrong master, or to none, in FinCom.
  - Fix: no rebuild for ledgers; the GUID stays empty until Tally gives it.
- S2 (LOW; code review 4). The guard's 2-minute "asked" window widens the day to any day from the starting point's,
  for one exact type and number. Only the bridge's own fetch opens it, right before asking.
- Code review 2 (an empty GUID now means "created") and 3 (a resolver that never gives up within 7 days, waits
  settable to 0) are Low with no security edge.

Verdict:
- No High.
- S1 is Medium, reachable in today's code, and blocks the build.
- The new exception holds.


## Round 2 (8185245..2d9cc08)

The Medium is fixed in 2d9cc08: in liveEmit a placeholder GUID is rebuilt from the MasterID only when the line is not a ledger (`!c.isLedger()`); a new ledger's GUID stays empty until its body fetch gives Tally's own. Test TestPlaceholderGUIDRebuiltForVouchersOnly (bridge-go/review221_test.go): red on 8185245 (the ledger went as `<co>-000001f4`), green after; the voucher case still rebuilds `-000066c8`. Reviewed by Claude: the change is one condition; no other code changed. The Lows stay as written (the resolver's retries are bounded to 7 days; to be capped at about 20 tries in a later version).

Range: 6fb6cc9..2d9cc08
