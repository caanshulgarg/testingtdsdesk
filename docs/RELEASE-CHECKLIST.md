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
2. **All tests pass.** `go vet` for Linux and Windows, then `go test -timeout 20m ./...` in `bridge-go/` (the full run takes about 10 minutes, so Go's
   default 10-minute limit is not enough: it cut a run at 588 s on 05-Oct-2026). The CI job `bridge-linux` runs the same
   tests on every push.
3. **The size test passes** (`go test -timeout 20m -run Size -v`). It uses a made-up company of 50,000 ledgers and 200,000
   vouchers and fails if any request to Tally would take over 20 seconds or ask for more than the allowed chunk. A
   missing size test counts as a failure.
4. **The allow-list tests pass** (`go test -timeout 20m -run 'AllowList|NoComputedFigure|EveryRequestOnList|UnknownRequest' -v`):
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
| 2.1.7 | 2026-10-03 | c04ae9ae9866bc5445f2274b592defdc0a39983d46bfb4231f272cd3b0f0f4d9 | docs/reviews/bridge-2.1.7-{code,security}-review.md, range 27aa360..81ce8da; built at 81ce8da (bridge sources), setup SHA-256 948426b56ae8d3a5f2a5027d65d6d2ce7306e5356cfd6dda8ab81c435679f5b6; allow-list not yet measured (the owner's decision of 2026-10-03: open for every computer); built with POSTONLY=any (the installer clears an installer-set PostOnly and writes none) | the owner's decision: any computer, no pilot | superseded by 2.1.8 (03-Oct, the posting without read-back) |
| 2.1.8 | 2026-10-03 | c803a44625adda7d | docs/reviews/bridge-2.1.8-{code,security}-review.md, range 7162400..6d1ba04; built at 6d1ba04 (bridge sources e383608), setup SHA-256 12b647ad5accdf8f35d93add17457e2dd4b19a356a86a631b6a92772e5f58605; allow-list not yet measured (the owner's decision of 2026-10-03: GO for 2.1.8, open for every computer); built with POSTONLY=any; posting by Tally's reply, no read-back, batches 10/50 settable from the Tally page; needs migration 43 for the per-computer settings and the reply ids (the bridge works without it) | the owner's decision: any computer, no pilot || superseded by 2.1.9 (04-Oct, reading prospective only) |
| 2.1.9 | 2026-10-04 | b3c198e2f43da77f | docs/reviews/bridge-2.1.9-{code,security}-review.md, range 416c335..9e390bf (three rounds: review, re-review, last fixes); built at beea51e (bridge sources 9e390bf), setup SHA-256 73bd1aa52f7078da3187da850fc3c98f307a862d66d5355b519cbc7ce8be630a; allow-list not yet measured (the owner's decision of 2026-10-04, phase 2 go-ahead); built with POSTONLY=any; reading prospective only (ReadDays off, no dated request to Tally unless a person starts it at the PC), starting point per company GUID, light check never during a posting, recorder trial tray items, protected recorder folders; works with tally-ingest v32 (migration 44) | the owner's decision: any computer, no pilot || superseded by 2.1.10 (04-Oct, trial tools for any company; the starting point while paused) |
| 2.1.10 | 2026-10-04 | cd2bdbc8aec86b35 | docs/reviews/bridge-2.1.10-{code,security}-review.md, range 9e390bf..32ef196 (review, fixes, review of the fixes); built at 2b11fde (bridge sources d42c3dc), setup SHA-256 11d279f07a5c76697212412d163deb31ea5f7b6783480dd10fb744128b742c96; allow-list not yet measured (the owner's decision of 2026-10-04; the table unchanged since 2.1.9, only the decision line); built with POSTONLY=any; the light check runs while paused and the beat carries every open company's change numbers (with tally-ingest v34); trial tools for any company behind the owner's switch per computer (migration 46), TRIAL tags, the add-on as FinComRecorderAnyCompany.tdl | the owner's decision: any computer, no pilot | superseded by 2.2.0 (04-Oct, the live recorder) |
| 2.2.0 | 2026-10-04 | 3c66067432ae6b0d | docs/reviews/bridge-2.2.0-{code,security}-review.md, range bdfe261..0bec498 (eight rounds: review, then a re-review of each round of fixes; no High or Medium open); built at c0ac9f5 (bridge sources 0bec498), setup SHA-256 45a1671b0bbc8d5bd35908f5427984465580129f095109477d211b4a5730dee0, program SHA-256 565475a6e069d0e7625370bdac90d28da504d9341cee21e3db2378a168c2875c; allow-list not yet measured on NWS144 (the owner's decision of 2026-10-04, re-measured on the stand 2026-10-04; new: FinComVoucherByMaster, FinComSlice, FinComCompanyNumbers, the read test's probes; every request pinned to its builder); built with POSTONLY=any; the live recorder (add-on lines, body fetch by MasterID, uploader, posting window, Source B with the owner's 2 s rule, Source C off by default), change numbers by NATIVEMETHOD or the two-field report, rollback to the kept previous version from the tray, 30-day logs | the owner's decision: any computer, no pilot | superseded by 2.2.1 (05-Oct, new entries as Created) |
| 2.2.1 | 2026-10-05 | 31b88d34e93e1a0a | docs/reviews/bridge-2.2.1-{code,security}-review.md, range 6fb6cc9..7046501 (review, the ledger GUID fix 2d9cc08 re-reviewed, no bridge-go change after it; no High or Medium open); built at f4aff46 (bridge sources 2d9cc08), setup SHA-256 90c35be9509370ea4474ca3ee11385384c4677776662e0a901ba6448478d602c, program SHA-256 45336710423b19bd780d385d74e0ca2a0c9fd2458801c304f5ae7f5274944147; allow-list not yet measured on NWS144 (the owner's decision of 2026-10-05, re-measured on the stand 2026-10-05; new: FinComVoucherByNumber, the third dated exception, one exact day, type and number); built with POSTONLY=any; the owner's BLOCKER from NWS144: a new entry (placeholder GUID '-00000000', MasterID 0 / AlterID 0) goes as Created with its real GUID, MasterID, AlterID and body (a voucher's GUID rebuilt from its MasterID, else found by type and number on its day; a new ledger's GUID never rebuilt); Receipts 191/192 resolved once on first run; Tally's minute as saved_at, the bridge's received_at | the owner's decision: any computer, no pilot || superseded by 2.2.2 (05-Oct, the add-on's ids never trusted) |
| 2.2.2 | 2026-10-05 | 51b2e0e32e9b124d | docs/reviews/bridge-2.2.2-{code,security}-review.md, range 4dc55ef..5321844 (round 1 code and security, fixes, round 2 with no High or Medium; Lows L-A..L-D fixed, L-E..L-G for the next build); built at 7aa4af7 (bridge sources 2f7b1a3), setup SHA-256 2f5667655c3555345e3c0454c580ca623b91ad9bb6f7350aa11254dcdc471dfa, program SHA-256 c6f3c2f001eed26740faea9cdfd3096147fc6430478dd940a0df70cce100e952; allow-list not yet measured on NWS144 (the owner's decision of 2026-10-05; table unchanged; FinComVoucherByMaster needs a starting point, FinComVoucherByNumber only for a waiting line within 3 days); built with POSTONLY=any; one job (owner's rule of 05-Oct): a new, altered, deleted or cancelled entry in a linked company reaches the books: the add-on's GUID and AlterID never trusted, the entry fetched from the bridge's own Tally by MasterID (else type, number and date) and taken only when Tally's own ids and the line agree, held with words otherwise; the cloud's held lines asked again (tally-ingest v39, migrations 51 and 52); one log line per fetch decision; held entries asked 20 times at most; a hard 2 s stop for background reads | the owner's decision: any computer, no pilot | superseded by 2.2.3 (05-Oct, the tray's Test fetching an entry) |
| 2.2.3 | 2026-10-05 | f0f0ec5d56fefead | docs/reviews/bridge-2.2.3-{code,security}-review.md, range b266f4f..4137429 (one round, the owner's rule; M1 fixed test-first in f6ce242/e23e03b, no High or Medium open; Lows L1..L4 for the next build); built at 170d96b (bridge sources 4137429), setup SHA-256 4d78e1f2dd5b8a9d678369f632fa16d727905b82b2b8b79912cd5e7cf0514cfa, program SHA-256 5519208a817cd0649c23c35904cdd0f4290530dfe09852bba5b04be29f62b415; allow-list not yet measured on NWS144 (the owner's decision of 2026-10-05: six test-only requests FinComFetchTestA..F, one voucher each, sent only when the owner presses the tray item 'Test fetching an entry'; table as in ba799d4); built with POSTONLY=any; only the tray item 'Test fetching an entry' behind the trial tools (ba799d4, c2621c1) and the live add-on files named <GUID>-d-Mon-yy.txt read and dated by their name (8bd8077) | the owner's decision: any computer, no pilot | superseded by 2.2.4 (05-Oct, Tally's typed fields read) |
| 2.2.4 | 2026-10-05 | cda7837b35af1c4f | docs/reviews/bridge-2.2.4-{code,security}-review.md, range 97f6bd8..1a0f488 (one round, the owner's rule; no High; M1 and L1 fixed in ff925e4; Lows L2..L8 for the next build); built at 91fb6a1 (bridge sources 1a0f488), setup SHA-256 51dde37da28f1117fcc6c0046039143deb5095acdbdc2e19496f4b04cd0311bb, program SHA-256 de71c1ee15bdad8ddcdb582b4cf8a5a5600520042c9a4e68dc8fc837015e2b60; allow-list not yet measured on NWS144 (the owner's decision of 2026-10-05; no request shape changed, only the decision line); built with POSTONLY=any; only the branch fix-tally-attrs (035c43e, ba32bcb, 468973e, ff925e4): Tally's answers read with or without TYPE attributes, CMPINFO's counters never taken as objects | the owner's decision: any computer, no pilot | superseded by 2.3.0 (06-Oct, one bridge per Windows user) |
| 2.3.0 | 2026-10-06 | f4418f5d05fd97e7 | docs/reviews/bridge-2.3.0-{code,security}-review.md, range 9076c77..c810774 (round 1 database/cloud and bridge/security, the owner's no-conditions audit, round 2 short review, the real-Tally finding 6e, the redated-entry path; all High and Medium fixed with tests; Lows for the next build); built at 848b1a4 (bridge sources c810774, the squash of per-user-bridge aefb5e7), setup SHA-256 d63311d10aeb9a830b0b36658637ef4a70afce7a121890a75521b47375ba9206, program SHA-256 5d399c61938cbe730151b01f7c1115a269b73c79b48742cd5d6a5e8ab1d3b90c; allow-list not yet measured on NWS144 (re-measured on the stand 2026-10-05; allowed for 2.3.0 by the owner's standing decision of 2026-10-06: no request on the list and no request shape changed); built with POSTONLY=any; one bridge per Windows user (ports 9100..9199, "Just for me", own user and own Tally only), Tally's own GUID for cancels and deletes, the bridge proves itself before any secret (older bridges not trusted after the app update), bridge ids bound to their computer (migration 54), no conditions on any bridge, the owner's decisions A-D (migration 55); the app and the bridge go out together (06-Oct-2026 05:25 IST) | the owner's decision: any computer, no pilot | withdrawn before publishing (06-Oct-2026): the cloud could not read Tally's typed entry details; rebuilt (files kept in assets-test/bridge-go-old/ as *-2.3.0-withdrawn-d63311d1*) |
