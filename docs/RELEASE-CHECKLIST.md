# FinCom Bridge release checklist

Every new FinCom Bridge (the Windows program that reads and posts to Tally) goes through these steps in this order.
Do not skip a step, and do not hand the setup to any computer before the owner approves it in FinCom.

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
5. **The allow-list is unchanged, or it has been re-measured.** The script compares the SHA-256 of
   `docs/tally-allowlist.md` with the hash in the last row of the release log. If the file changed, measure the
   changed requests on ZZ BIG TEST first. Then add a line `re-measured on YYYY-MM-DD` to the file, dated on or after
   the last release.
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
12. **Pilot on NWS144 for one full working day.** Mark NWS144 as the pilot computer for this version in FinCom (All
    clients, then Tally), then work through the test sheet on it. For a whole working day, watch:
    - the longest request;
    - any self-stop;
    - posting while reading.
    Write the pilot start date in the release log and fill in the acceptance record
    (`docs/bridge-<version>-acceptance.md`).
13. **The owner approves it in FinCom before any other computer gets it.** Approval needs at least one working day on
    the pilot. No other computer gets the new version until then. Write who approved it, and when, in the release log.

## Never

- **Never auto-update.** A computer installs only the version FinCom names for it, and only after it is approved
  (the pilot computer gets it once it is marked for pilot). The signed `latest.json` is still checked as well.
- Never build a published version number again.
- Never hand out a setup that `release-check.sh` did not pass.

## Release log

The script reads this table. Keep the columns and give dates as YYYY-MM-DD. "Allow-list hash" is the first 16 (or
all 64) hex characters of `sha256sum docs/tally-allowlist.md` at the build. The last row is the one the next release
is compared with.

| Version | Date | Allow-list hash | Review notes | Pilot start | Approved (by, date) |
|---|---|---|---|---|---|
