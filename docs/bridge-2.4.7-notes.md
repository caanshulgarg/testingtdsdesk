# FinCom Bridge 2.4.7 (branch next-247-pairsafe, from the published 2.4.6: staging-next 3e00356f0)

On 24-Oct-2026 the owner said "yes" to closing the pairing gap that the 2.4.6 security review found. 2.4.7 changes how
FinCom's page and the tray prove themselves to the bridge. Nothing new is asked of Tally. FinCom's page changes with it:
a 2.4.7 bridge pairs only with the app of this branch or later. The app still pairs with older bridges as before.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.7.exe |
| Fingerprint | SHA-256 `69aa6b742c74ec470c85b6f0b316580cf4741b0d54e81400418bfcd5c3448799` (FinComBridge-Setup-2.4.7.exe, built 25-Oct-2026 02:23 IST at the commit after be7c3a98a, bridge sources 61fb40fec, POSTONLY=any) |
| Program | FinComBridge-2.4.7.exe, SHA-256 `a6ea2ec52f45d2fcd4bbd8731b814f3f0b95f46680f6a83f69e3cab6c6e8b546` |
| Replaces | 2.4.6 (kept on the computer, so the tray can roll back to it) |
| Published | not published. assets-test/bridge-go/latest.json still names 2.4.6; the owner publishes 2.4.7 with this branch's app |

## What is in 2.4.7

1. **FinCom's pages only.** The defaults no longer allow "null" (any website's sandboxed frame) or http://localhost (any
   local web server) to talk to the bridge. If an older settings file still names them, they are ignored unless
   `"DevOrigins": true` is set, which is for tests and development only and is off by default.
2. **A typed code can no longer be worked out.** Until 2.4.6, the bridge answered FinCom's page with a proof made from
   the 6 digits, and one such proof gave the code away in about a second. Now FinCom and the bridge check a typed code
   together with SPAKE2, over the 2048-bit group of RFC 3526:
   - the 6 digits never leave the page;
   - each check tests one guess, online;
   - checks and wrong codes together are limited to five per window;
   - only FinCom's page, with its Origin, can check at all.
3. **FinCom opened by the bridge** (the tray, the installer's last page, the first start) carries the code and the
   window's 128-bit secret (`#pair=123456-<secret>`). FinCom pairs with the secret once the bridge has proved it holds
   it. An old or made-up address uses up no try, and the page says the link has run out.
4. **The tray never sends the bridge key.** Each request proves the key afresh with a one-use challenge from a bridge
   that first proved it holds the key. The request's body is sealed, and the bridge MACs its reply. A program of another
   Windows user on the bridge's port gets nothing it can use and cannot feed the tray an answer. The measuring tool does
   the same.
5. **The app's side:** src/js/24-pair-spake.js (new), src/js/24-tally-bridge.js, src/js/49-tally-cloud.js and
   app/src/parts/TallyFirstLink.jsx.

## Rules kept

- No new or changed Tally request. The allow-list table hash is unchanged (b4df290484f5…). The doc changed in words only:
  the decision line names 2.4.7 by the owner's standing decision of 2026-10-06. The file's sha256 is now c779ade2e603c9d6.
- Tally never hangs, there is one request in flight, and postings go first. Nothing here talks to Tally.
- No AI in the bridge. The browser is opened only by the owner's tray, as in 2.4.6.

## Gates

- Tests first: r247pair_test.go, tests/run_pair_spake.mjs (Go's SPAKE2 vectors against the page's JavaScript), and
  run_tally_firstlink.py checks 13 to 15.
- `go vet` Linux and Windows: clean. `go test ./...` passed.
- release_check_test.sh: all cases as expected. release-check.sh: PASSED for 2.4.7 at be7c3a98a, and again at d70b8c100
  (FORCE_REBUILD=1: the setup is committed and 2.4.7 was never published) after the app fix 281635423, which touched no
  bridge source.
- App tests: run_tally_firstlink, run_stability, run_ui_standards, run_safari_compat and run_boot_watch all passed, and
  run_pair_spake.mjs passed.
- Five review rounds (docs/reviews/bridge-2.4.7-{code,security}-review.md). 0 High and 0 Medium are open; the Lows are
  recorded there.
- CI run 40135517184 at d70b8c100: app, bridge-linux and bridge-linux-typed green, and tests shares 1-6 green. Shares
  7-10 failed on tests that fail the same way on staging-next without 2.4.7 (checked locally on 3e00356f0 and in
  staging-next's own CI 40118356855 at 87b640328 and 40122260794 at 3e00356f0): run_upload_pages "Bank: the same words";
  the top bar's Tally sign test; the M4 nil-deductions test; SupplierHealth.jsx missing; cloudClientView not defined.
  CI 40131853747 at 915592c42 had found two of 2.4.7's own (run_bridge_ports_ui 5, run_pair_ui), fixed in 281635423.
- Windows CI (FinCom Bridge on Windows: go-tests-windows, build, the committed setup installed on windows-2022 and
  windows-2025): run 40135512532 at d70b8c100, success. Run 40131853855 at 915592c42 also succeeded.
- Real Tally (tally-versions run 40131862793, modes quick and upg, upg_from=2.4.6; TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1;
  harness branch tally-versions e0016db59, results b54d1215c): 40 of 40 PASS with the committed setup (setup origin:
  COMMITTED assets-test/bridge-go/FinComBridge-Setup-2.4.7.exe SHA-256 69aa6b74...8799). On every release: c1, c2, u1
  "2.4.7 installed over 2.4.6: settings changed: none", u2, u3 "each asked once in all and ended: 50" and u4.
