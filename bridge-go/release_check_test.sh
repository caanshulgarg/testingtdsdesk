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
#   green 2  a "not yet measured" row, and the line "allowed for 2.1.6 only by the owner's decision of <date>" (this version) -> passes
#   red 7    the same line naming another version (2.1.5)        -> fails "4 allow-list" (not yet measured)
#   red 8    a "not yet measured" row and no "allowed for" line  -> fails "4 allow-list" (not yet measured)
#   red 9    the allow-list table has a header but no row the check can parse (rows without the leading pipe)
#                                                                 -> fails "4 allow-list" (no rows parsed)
#   green 3  BridgeVersion 2.1.7 with the owner's decision line naming 2.1.7 (round 13) -> passes check 4
#   red 10   BridgeVersion 2.1.7 with an "allowed for 2.1.7 only" line WITHOUT the owner's decision words -> fails "owner's decision"
#   red 11   an exception line naming two versions                    -> fails "names more than one version"
#   pin      every 'go test' line in release-check.sh carries -timeout 20m (Go's default 10 minutes cut a full run at 588 s
#            on 05-Oct-2026)
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
# the fixture under another BridgeVersion (its test sheet and review notes renamed with it)
withver() {
  sed -i "s/var BridgeVersion = \"9.9.9\"/var BridgeVersion = \"$1\"/" "$R/bridge-go/util.go"
  printf 'FINCOM BRIDGE %s TEST SHEET\n' "$1" >"$R/docs/bridge-$1-test-sheet.txt"; rm -f "$R/docs/bridge-9.9.9-test-sheet.txt"
  rm -f "$R/docs/reviews/bridge-9.9.9-code-review.md" "$R/docs/reviews/bridge-9.9.9-security-review.md"
  g add -A; g commit -qm "version $1"
  local h; h="$(git -C "$R" rev-parse --short HEAD)"
  for k in code security; do printf '# %s review\n\nRange: %s..%s\n' "$k" "$h" "$h" >"$R/docs/reviews/bridge-$1-$k-review.md"; done
  g add -A; g commit -qm "review notes for $1 (docs only after the range)"
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

setup; withver 2.1.6; unmeasured "First table: not yet measured; allowed for 2.1.6 only by the owner's decision of 2026-10-03; re-measured on 2026-10-02 (no times)"
expect "green 2: unmeasured row allowed for this version by the owner's decision" 0 "allowed for 2.1.6"

setup; withver 2.1.6; unmeasured "First table: not yet measured; allowed for 2.1.5 only by the owner's decision of 2026-10-03; re-measured on 2026-10-02 (no times)"
expect "red 7: the exception names another version" 1 "not yet measured"

setup; unmeasured "re-measured on 2026-10-02"
expect "red 8: unmeasured row, no exception for this version" 1 "not yet measured"

# round 13: the exception may name exactly one version, this one, and must carry the owner's decision words
LINE="First table: not yet measured; allowed for VER only by the owner's decision of 2026-10-03 (open for every computer); this line is replaced per build by the owner's decision, and removed once the table carries times."
setup; withver 2.1.7; unmeasured "$(echo "$LINE" | sed 's/VER/2.1.7/g')
re-measured on 2026-10-02 (no times)"
expect "green 3: 2.1.7 with the owner's decision line passes check 4" 0 "allowed for 2.1.7"

setup; withver 2.1.7; unmeasured "First table: not yet measured; allowed for 2.1.7 only; pilot on NWS144 only; no build after 2.1.6 gets an exception.
re-measured on 2026-10-02 (no times)"
expect "red 10: 2.1.7 with a line without the owner's decision words" 1 "owner's decision"

setup; withver 2.1.6; unmeasured "First table: not yet measured; allowed for 2.1.6 only; allowed for 2.1.5 only; re-measured on 2026-10-02 (no times)"
expect "red 11: an exception naming two versions" 1 "names more than one version"

setup; printf '# Tally allow-list\n\nre-measured on 2026-10-02\n| id | purpose | worst case (s) | measured on |\n|---|---|---|---|\nledgers | ledger list | 4 | 2026-09-30\n' >"$R/docs/tally-allowlist.md"; g add -A; g commit -qm "no rows"
expect "red 9: no row of the allow-list table can be parsed" 1 "no rows parsed"

# pin: every go test command in the script carries the explicit 20-minute limit (GO_TEST_TIMEOUT=20m, used on each line)
S="${RELEASE_CHECK_SCRIPT:-$HERE/release-check.sh}"
nt="$(grep -cE '^[[:space:]]*go test ' "$S")"; nl="$(grep -E '^[[:space:]]*go test ' "$S" | grep -cF -- '-timeout "$GO_TEST_TIMEOUT"')"
if [ "$nt" -ge 2 ] && [ "$nt" = "$nl" ] && grep -qx 'GO_TEST_TIMEOUT=20m' "$S"; then echo "PASS  pin: all $nt go test lines run with -timeout 20m"
else echo "FAIL  pin: $nl of $nt go test lines carry -timeout \$GO_TEST_TIMEOUT, or GO_TEST_TIMEOUT=20m is missing"; FAILS=$((FAILS+1)); fi

echo
if [ "$FAILS" = 0 ]; then echo "release_check_test: all cases as expected"; else echo "release_check_test: $FAILS case(s) wrong"; exit 1; fi
