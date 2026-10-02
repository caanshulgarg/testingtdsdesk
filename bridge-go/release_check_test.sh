#!/usr/bin/env bash
# Self-test of release-check.sh: builds a throwaway git repo (in a temp folder) holding a tiny Go module with the
# required tests, the docs the check reads and its own commits, then runs release-check.sh there:
#   green    everything present                                   -> passes
#   red 1    the security review note removed                     -> fails "5 security review ... is missing"
#   red 2    TestUnknownRequestRefused removed                    -> fails "missing test TestUnknownRequest"
#   red 3    TestSize present but skipped (t.Skip)                -> fails "2 size test"
#   red 4    the review range ends before a bridge-go/ change     -> fails "files outside docs/ changed after it"
#   red 5    the allow-list changed with no "re-measured on" line -> fails "4 allow-list"
#   red 6    the version already has a setup in assets-test       -> fails "1 version"
#   green 2  a "not yet measured" row, and the line "allowed for 9.9.9 only" (this version) -> passes
#   red 7    the same line naming another version (9.9.8)        -> fails "4 allow-list" (not yet measured)
#   red 8    a "not yet measured" row and no "allowed for" line  -> fails "4 allow-list" (not yet measured)
# Nothing outside the temp folder is touched. Run: bash bridge-go/release_check_test.sh
# (RELEASE_CHECK_SCRIPT=<file> tests another copy of the script, e.g. one that always passes, to see this test fail.)
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export GOTOOLCHAIN=local GOFLAGS=-mod=mod GOPROXY=off RELEASE_CHECK_OFFLINE=1
unset FORCE_REBUILD
FAILS=0
g() { git -C "$R" -c user.name=t -c user.email=t@t -c commit.gpgsign=false "$@" >/dev/null; }

setup() {
  R="$(mktemp -d)"
  mkdir -p "$R/bridge-go" "$R/docs/reviews" "$R/assets-test/bridge-go"
  cp "${RELEASE_CHECK_SCRIPT:-$HERE/release-check.sh}" "$R/bridge-go/release-check.sh"
  printf 'module fake\n\ngo 1.24\n' >"$R/bridge-go/go.mod"
  printf 'package main\n\nvar BridgeVersion = "9.9.9"\n\nfunc main() {}\n' >"$R/bridge-go/util.go"
  cat >"$R/bridge-go/size_test.go" <<'E'
package main

import "testing"

func TestSizeFiftyThousandLedgers(t *testing.T) {}
E
  cat >"$R/bridge-go/allowlist_test.go" <<'E'
package main

import "testing"

func TestEveryRequestOnList(t *testing.T)    {}
func TestUnknownRequestRefused(t *testing.T) {}
func TestNoComputedFigure(t *testing.T)      {}
func TestAllowListUnchanged(t *testing.T)    {}
E
  printf '# Tally allow-list\n\n| id | purpose | worst s | measured |\n|---|---|---|---|\n| ledgers | ledger list | 4 | 2026-09-30 |\n' >"$R/docs/tally-allowlist.md"
  local h; h="$(sha256sum "$R/docs/tally-allowlist.md" | cut -c1-16)"
  printf '# Release checklist\n\n## Release log\n\n| Version | Date | Allow-list sha256 | Review notes | Pilot start | Approved |\n|---|---|---|---|---|---|\n| 9.9.8 | 2026-09-30 | %s | x | x | x |\n' "$h" >"$R/docs/RELEASE-CHECKLIST.md"
  printf 'FINCOM BRIDGE 9.9.9 TEST SHEET\n' >"$R/docs/bridge-9.9.9-test-sheet.txt"
  g init -q -b main; g add -A; g commit -qm code
  BASE="$(git -C "$R" rev-parse --short HEAD)"
  for k in code security; do printf '# %s review\n\nRange: %s..%s\n' "$k" "$BASE" "$BASE" >"$R/docs/reviews/bridge-9.9.9-$k-review.md"; done
  g add -A; g commit -qm "review notes (docs only after the range)"
}
# the allow-list with one row not yet measured, and the line given above the table ("" for none)
unmeasured() {
  printf '# Tally allow-list\n\n%s\n| id | purpose | worst case (s) | measured on |\n|---|---|---|---|\n| ledgers | ledger list | 4 | 2026-09-30 |\n| daybook | the day book | not yet measured | - |\n' "$1" >"$R/docs/tally-allowlist.md"
  g add -A; g commit -qm "allow-list unmeasured"
}
run() { (cd "$R/bridge-go" && ./release-check.sh) >"$R.out" 2>&1; echo $?; }
expect() { # $1 name, $2 expected exit (0 or 1), $3 text the output must contain
  local code; code="$(run)"
  if { [ "$2" = 0 ] && [ "$code" = 0 ]; } || { [ "$2" != 0 ] && [ "$code" != 0 ]; }; then
    if grep -qF -- "$3" "$R.out"; then echo "PASS  $1 (exit $code)"; else echo "FAIL  $1: exit $code but no '$3' in:"; sed 's/^/      /' "$R.out"; FAILS=$((FAILS+1)); fi
  else echo "FAIL  $1: exit $code, wanted $2:"; sed 's/^/      /' "$R.out"; FAILS=$((FAILS+1)); fi
  echo "----- $1 output:"; sed 's/^/      /' "$R.out"
  rm -rf "$R" "$R.out"
}

setup; expect "green: everything present" 0 "RELEASE CHECK PASSED for FinCom Bridge 9.9.9"

setup; rm "$R/docs/reviews/bridge-9.9.9-security-review.md"; g add -A; g commit -qm "drop note"
expect "red 1: security review note missing" 1 "docs/reviews/bridge-9.9.9-security-review.md is missing"

setup; sed -i '/TestUnknownRequestRefused/d' "$R/bridge-go/allowlist_test.go"; g add -A; g commit -qm "drop test"
expect "red 2: allow-list test missing" 1 "missing test TestUnknownRequest"

setup; sed -i 's/func TestSizeFiftyThousandLedgers(t \*testing.T) {}/func TestSizeFiftyThousandLedgers(t *testing.T) { t.Skip("later") }/' "$R/bridge-go/size_test.go"; g add -A; g commit -qm "skip"
expect "red 3: size test skipped" 1 "2 size test"

setup; printf '\n// changed after review\n' >>"$R/bridge-go/util.go"; g add -A; g commit -qm "unreviewed change"
expect "red 4: code changed after the reviewed range" 1 "files outside docs/ changed after it"

setup; printf '| extra | new request | 3 | 2026-10-01 |\n' >>"$R/docs/tally-allowlist.md"; g add -A; g commit -qm "allow-list change"
expect "red 5: allow-list changed, not re-measured" 1 "has no 're-measured on YYYY-MM-DD' line"

setup; : >"$R/assets-test/bridge-go/FinComBridge-Setup-9.9.9.exe"; g add -A; g commit -qm "setup exists"
expect "red 6: version already has a setup" 1 "BridgeVersion 9.9.9 is not new"

setup; unmeasured "First table: not yet measured; allowed for 9.9.9 only; re-measured on 2026-10-02 (no times)"
expect "green 2: unmeasured row allowed for this version" 0 "allowed for 9.9.9"

setup; unmeasured "First table: not yet measured; allowed for 9.9.8 only; re-measured on 2026-10-02 (no times)"
expect "red 7: the exception names another version" 1 "not yet measured"

setup; unmeasured "re-measured on 2026-10-02"
expect "red 8: unmeasured row, no exception for this version" 1 "not yet measured"

echo
if [ "$FAILS" = 0 ]; then echo "release_check_test: all cases as expected"; else echo "release_check_test: $FAILS case(s) wrong"; exit 1; fi
