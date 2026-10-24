# FinCom Bridge 2.4.6 (branch next-246-pairopen, from the published 2.4.5: next-245 69de7a79d)

The owner approved this on 24-Oct-2026. Asked "the bridge opens FinCom with the code already filled in, so after
installing you'd only press Add as client", he answered "yes". Nothing new is asked of Tally. The cloud and the app are
unchanged: FinCom already takes `#pair=<code>` off its address and pairs (src/js/49-tally-cloud.js).

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.6.exe |
| Fingerprint | SHA-256 `a64a93cf596a1c644ee352ed69ca75b7ff53d689e481d224f654abd9f4a55917` (FinComBridge-Setup-2.4.6.exe, built 24-Oct-2026 22:12 IST at 716568447, bridge sources 3f5575332, POSTONLY=any; compare with the .sha256 file next to the setup) |
| Program | FinComBridge-2.4.6.exe, SHA-256 `d7b5a613130b3d479037105a26c987180f8a8b7550648658aea6cf88eb5ceecf` |
| Replaces | 2.4.5 (kept on the computer, so the tray can roll back to it) |
| Published | not published. assets-test/bridge-go/latest.json still names 2.4.5; the owner publishes after the gates |

## What is in 2.4.6

1. **The tray item opens FinCom with the code filled in.** Right-click the FinCom icon > "Connect FinCom on this
   computer...". As before, this opens a new 10-minute connect window. It now also opens FinCom's own address with
   `#pair=<code>`, and FinCom connects by itself. The message box says: "FinCom is opening in your browser and connects
   this computer by itself. If it doesn't, open <FinCom's address> on this computer, go to the Tally page and type this
   code: 123456 (until 14:05)". The old words "Settings > Tally Bridge > Connect" are gone.
2. **The installer's last page** has a ticked "Open FinCom to connect" (it was "Open FinCom"). After Finish, FinCom
   opens with the code filled in. The bridge's own tray opens it, in this Windows user's session; the setup opens no
   browser itself. Unticked, FinCom does not open by itself.
3. **The first start after the install.** If the last page was left open, or the computer restarted before Finish,
   FinCom opens once by itself after 2 minutes. This happens only for the Windows user the bridge works for, in that
   user's own signed-in session, never from the Windows service, within a day of the install, and not on a computer
   that was connected to FinCom before (an upgrade). A silent install (`/S`) never opens FinCom.
4. **Safety.** Only FinCom's own https sites are opened: app.fincom.live, staging.fincom.live, fincom.live and
   caanshulgarg.github.io, the same list the bridge already trusts, with the address's path only. The address carries
   only the 6-digit code, never the bridge's key. The code works as before: once, for 10 minutes. The install's request
   is kept in the install's own record in the registry, not in a file the user's folder could redirect. The tray acts
   only when the program on the bridge's port is this install's bridge.

How it works: bridge-go/pairopen.go (the address, the decision, the take, `connect --first|--skip`),
pairstore_windows.go (the registry record), win_tray.go (the tray item, the first start, the checks of the session, the
owner's SID and the port), installer/FinComBridge.nsi (Open FinCom to connect, FinishLeave, `--pairopen` unless
silent), win_service.go / win_user.go (the request cleared at the install's start and written at its end, only when the
bridge answers).

## Rules kept

- No new or changed Tally request. The allow-list's table hash is unchanged (b4df290484f5...): TestAllowListUnchanged,
  TestRelease246VersionAllowListUnchanged. docs/tally-allowlist.md changed in words only: its decision line names
  2.4.6 by the owner's standing decision of 2026-10-06, as 2.4.1's did. The file's hash moves from 6bf9d43c248e097c to
  03784caabea64a2d.
- Tally never hangs, there is one request in flight, and postings go first. Nothing here talks to Tally: the tests
  check that no request reaches the stand-in Tally during either trigger.
- No AI in the bridge.
- The bridge never opens a browser for a Windows service, for session 0, or for a different user.

## Gates (RELEASE-CHECKLIST)

- Go tests first: r246pair_test.go failed to build before pairopen.go existed. 19 Linux tests and 2 Windows tests cover
  both triggers, not the service / session 0 / another user, once per install, one tray, the origin allow-list, the
  Finish page, the connect command, the port and owner checks, the clock and the day limit.
- `go vet` Linux and Windows: clean. `go test -timeout 40m ./...`: passed (inside the final release-check.sh run).
  TestPay244EmployeesOnCounter, a payroll test this change does not touch, failed once inside an earlier release-check
  run under load. It passed alone three times, and in the final run.
- `bash bridge-go/release_check_test.sh`: all cases as expected.
- `bridge-go/release-check.sh`: RELEASE CHECK PASSED for 2.4.6 at 716568447 (1 version new; 2 vet, tests, size test,
  allow-list tests; 3 go.mod; 4 allow-list sha256 03784caabea64a2d, re-measured line of 2026-10-24; 5 code and
  security reviews; 6 test sheet).
- Build: `POSTONLY=any bridge-go/build.sh`. The setup, its .sha256 and the program are in assets-test/bridge-go/.
  latest.json is not changed.
- Reviews: docs/reviews/bridge-2.4.6-code-review.md and -security-review.md (8 rounds; 0 High and 0 Medium open).
- CI and real Tally: @CI@

## For the owner

- The known pairing-proof risk (docs/reviews/bridge-2.4.6-security-review.md, "For the owner" 1) is wider than "only
  FinCom's page", because the default AllowedOrigins include `null` and `http://localhost`. It is in 2.4.5 as
  published, and 2.4.6 does not widen it in kind. A fix changes existing behaviour, so it waits for the owner's word.
- The release log's allow-list column gets the new file hash. The words changed, not the requests.
