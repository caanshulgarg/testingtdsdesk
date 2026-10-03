# FinCom Bridge release checklist

Every new FinCom Bridge (the Windows program that reads and posts to Tally) goes through these steps in this order.
Do not skip a step. Which computers get a build is the owner's decision, made per build (03-Oct-2026).

`bridge-go/release-check.sh` checks steps 1 to 7 by itself. It stops at the first one that fails, and no installer
may be built until it passes. Its self-test is `bash bridge-go/release_check_test.sh`.

## Before the build

1. **A new version number.** Raise `BridgeVersion` in `bridge-go/util.go`, for example 2.1.4 to 2.1.5. A number that
   has ever had a setup in `assets-test/bridge-go/`, a git tag, or a row in the release log below is never used again.
   The only exception is a build that was never published (`FORCE_REBUILD=1`). The script checks the published
   lists to confirm it: `assets-test/bridge-go/latest.json`, and `review/assets/bridge-go/` on `main`.
2. **All tests pass.** `go vet` for Linux and Windows, then `go test ./...` in `bridge-go/`. The CI job
   `bridge-linux` runs the same tests on every push.
3. **The size test passes** (`go test -run Size -v`). It uses a made-up company of 50,000 ledgers and 200,000
   vouchers and fails if any request to Tally would take over 20 seconds or ask for more than the allowed chunk. A
   missing size test counts as a failure.
4. **The allow-list tests pass** (`go test -run 'AllowList|NoComputedFigure|EveryRequestOnList|UnknownRequest' -v`):
   - every request the bridge can send is on the list;
   - an unknown request is refused;
   - no request asks Tally to compute a figure;
   - the list matches `docs/tally-allowlist.md`.
5. **The allow-list is measured, and unchanged or re-measured.** Every row of the table in `docs/tally-allowlist.md`
   must have a worst case above 0; a "not yet measured" row fails the check. The exception is the owner's, per build:
   the line `First table: not yet measured; allowed for <version> only by the owner's decision of YYYY-MM-DD` above
   the table is accepted only when `<version>` is the `BridgeVersion` being built and the owner's decision words are
   there; the line is replaced per build. The bridge reports in every heartbeat whether its table is measured.
   The script also compares the SHA-256 of `docs/tally-allowlist.md` with the hash in the last row of the release
   log. If the file changed, measure the changed requests on ZZ BIG TEST first. Then add a line
   `re-measured on YYYY-MM-DD` to the file, dated on or after the last release.
6. **Code review done.** Put the note at `docs/reviews/bridge-<version>-code-review.md`. It must name the git range
   reviewed, as `Range: <from>..<to>`, and `<to>` must be the commit being built: either HEAD, or a commit after which
   only `docs/` changed. Commit everything outside `docs/` before the review. Uncommitted changes fail the check.
7. **Security review done.** It follows the same rules, in `docs/reviews/bridge-<version>-security-review.md`.
8. **The test sheet is ready**, at `docs/bridge-<version>-test-sheet.txt` and naming the version. It is the previous
   sheet with this version's new steps added.
9. **The app tests pass** (`./release-check.sh --with-app`, which runs `tests/ci/run_ci.sh`). They need the builds
   first: `python3 build.py`, and `cd app && npm ci && npm run legacy && npm run build:test`. CI runs them on every
   push as well.

## Build and pilot

10. **Build** with `bridge-go/build.sh` only after `release-check.sh` passes. Then add the row to the release log
    below. Use the allow-list hash the script printed, plus the review note names and the date.
11. **Publish to the review site only.** Run `FINCOM_SHIP_BRIDGE=1 app/publish-preview.sh review "<banner>"`.
12. **The owner decides per build which computers get it** (03-Oct-2026; the pilot rule of 2.1.5 and 2.1.6 is
    dropped). A pilot on one computer, with the test sheet and the acceptance record (`docs/bridge-<version>-acceptance.md`),
    is the owner's choice, not a rule. Write the decision in the release log row.
13. **FinCom's release rows** (Try version / Approve on the Tally page) stay as a mechanism for the bridge's own
    updater; a setup installed by hand needs neither. Write who approved it in FinCom, and when, when that is used.

## Never

- **Never auto-update.** A computer installs by itself only the version FinCom names for it in the release rows. The
  signed `latest.json` is still checked as well. A setup run by hand is the owner's decision.
- Never build a published version number again.
- Never hand out a setup that `release-check.sh` did not pass.

## Release log

The script reads this table. Keep the columns and give dates as YYYY-MM-DD. "Allow-list hash" is the first 16 (or
all 64) hex characters of `sha256sum docs/tally-allowlist.md` at the build. The last row is the one the next release
is compared with.

| Version | Date | Allow-list hash | Review notes | Pilot start | Approved (by, date) |
|---|---|---|---|---|---|
| 2.1.5 | 2026-10-02 | aef526b9297155888057da9fb06cd9ef8e043d8a586999a02d39249a426d8d1e | reviews now in docs/reviews/bridge-2.1.6-{code,security}-review.md (first section, range f21b29f to be5542f), built at e6e070b; allow-list not yet measured (first-build exception). Published 03-Oct 01:30 UTC, installed on NWS144, held back the same morning (two faults on real books, see the 2.1.6 notes); never approved | 2026-10-03 (installed by hand, no pilot row) | withdrawn |
| 2.1.6 | 2026-10-03 | 7e721e8d616a630a14ccf7b509bd029bbe37fa1f0a6e738190aa5d8c2471d5d3 | docs/reviews/bridge-2.1.6-{code,security}-review.md, range be5542f..27aa360 (rounds 4 to 11); built at 27aa360 (bridge sources), setup SHA-256 101d793d483ae972b697cd592f02a5b1670cb1f7329524bb6cef4516ceb17c68; allow-list not yet measured (exception for 2.1.6 only; no later build gets one); PostOnly ZZ TEST written by the installer (pilot). Installed on NWS144 03-Oct 20:18 IST; superseded by 2.1.7 the same night (the owner: open for every computer, no PostOnly) | 2026-10-03 (installed by hand) | superseded |
| 2.1.7 | 2026-10-03 | c04ae9ae9866bc5445f2274b592defdc0a39983d46bfb4231f272cd3b0f0f4d9 | docs/reviews/bridge-2.1.7-{code,security}-review.md, range 27aa360..81ce8da; built at 81ce8da (bridge sources), setup SHA-256 948426b56ae8d3a5f2a5027d65d6d2ce7306e5356cfd6dda8ab81c435679f5b6; allow-list not yet measured (the owner's decision of 2026-10-03: open for every computer); built with POSTONLY=any (the installer clears an installer-set PostOnly and writes none) | the owner's decision: any computer, no pilot | |
