#!/usr/bin/env bash
# The checks before a FinCom Bridge installer is built (docs/RELEASE-CHECKLIST.md has the human steps around them).
# Run from bridge-go/ (it moves there itself). Stops at the first check that fails, with a non-zero exit; prints a
# plain summary of what passed. It builds nothing, publishes nothing, commits nothing and changes no file.
#
#   ./release-check.sh                 checks 1 to 6
#   ./release-check.sh --with-app      also the app tests (tests/ci/run_ci.sh); they need the builds first:
#                                      python3 build.py, and cd app && npm ci && npm run legacy && npm run build:test
#   FORCE_REBUILD=1 ./release-check.sh only for a version that already has a setup or tag but was never published
#   RELEASE_CHECK_OFFLINE=1            do not 'git fetch origin main' before looking at what is published
#
# The checks:
#   1 version     BridgeVersion (util.go) is new: no assets-test/bridge-go/FinComBridge-Setup-<v>.exe, no git tag
#                 naming it, no row for it in the release log. If one exists: allowed only with FORCE_REBUILD=1 and
#                 only if it was never published (assets-test/bridge-go/latest.json does not name it, and origin/main
#                 holds no FinComBridge*-<v>.exe and its review/assets/bridge-go/latest.json does not name it).
#   2 tests       go vet (Linux, Windows); the required tests exist (a missing one fails as "missing test X");
#                 go test ./... ; the size test and the allow-list tests each run and print "--- PASS" by name.
#   3 go.mod      go mod tidy -diff shows nothing (it changes no file).
#   4 allow-list  sha256 of docs/tally-allowlist.md equals the hash in the last release log row of
#                 docs/RELEASE-CHECKLIST.md; if it differs (or there is no earlier hash) the file must carry a line
#                 "re-measured on YYYY-MM-DD" dated on or after that last release.
#   5 reviews     docs/reviews/bridge-<v>-code-review.md and -security-review.md exist and each names the git range
#                 reviewed (Range: <from>..<to>); <to> is HEAD, or an ancestor of HEAD with only docs/ changed since;
#                 and nothing outside docs/ is changed but not committed.
#   6 test sheet  docs/bridge-<v>-test-sheet.txt exists and mentions <v>.
#   7 app tests   only with --with-app.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 2
WITH_APP=""
for a in "$@"; do
  case "$a" in
    --with-app) WITH_APP=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown option: $a" >&2; exit 2 ;;
  esac
done
export GOTOOLCHAIN="${GOTOOLCHAIN:-local}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "FAIL: not inside a git checkout" >&2; exit 1; }
CHECKLIST="$ROOT/docs/RELEASE-CHECKLIST.md"
ALLOWLIST="$ROOT/docs/tally-allowlist.md"
# the tests the release needs (prefixes of the Go test names; size_test.go and allowlist_test.go)
SIZE_TESTS="TestSize"
ALLOW_TESTS="TestAllowList TestNoComputedFigure TestEveryRequestOnList TestUnknownRequest"
DONE=()
LOG="$(mktemp)"; trap 'rm -f "$LOG"' EXIT

fail() {
  echo
  echo "RELEASE CHECK FAILED at: $1"
  shift
  for l in "$@"; do echo "  $l"; done
  if [ ${#DONE[@]} -gt 0 ]; then echo "Passed before it:"; for d in "${DONE[@]}"; do echo "  ok  $d"; done; fi
  echo "No installer may be built."
  exit 1
}
pass() { DONE+=("$1"); echo "ok  $1"; }
# the rows of the release log: table lines after "## Release log" whose first cell starts with a digit
log_rows() { [ -f "$CHECKLIST" ] && awk '/^## Release log/{on=1;next} /^## /{on=0} on && /^\|[ ]*[0-9]/' "$CHECKLIST"; }
cell() { awk -F'|' -v n="$1" '{gsub(/^[ \t`]+|[ \t`]+$/, "", $(n+1)); print $(n+1)}'; }

# --- 1. version -------------------------------------------------------------------------------------------------------
V="$(grep -oP 'var BridgeVersion = "\K[0-9.]+' util.go 2>/dev/null)"
[ -n "$V" ] || fail "1 version" "no 'var BridgeVersion = \"x.y.z\"' in bridge-go/util.go"
VRE="${V//./\\.}"
used=()
[ -e "$ROOT/assets-test/bridge-go/FinComBridge-Setup-$V.exe" ] && used+=("assets-test/bridge-go/FinComBridge-Setup-$V.exe exists")
tags="$(git tag -l | grep -E "(^|[^0-9.])$VRE\$" || true)"
[ -n "$tags" ] && used+=("git tag: $(echo $tags)")
log_rows | cell 1 | grep -qx "$V" && used+=("the release log in docs/RELEASE-CHECKLIST.md already has $V")
if [ ${#used[@]} -gt 0 ]; then
  [ "${FORCE_REBUILD:-}" = "1" ] || fail "1 version" "BridgeVersion $V is not new:" "${used[@]}" \
    "Raise BridgeVersion in bridge-go/util.go. (FORCE_REBUILD=1 is only for a $V that was never published.)"
  pub=()
  lj="$ROOT/assets-test/bridge-go/latest.json"
  [ -f "$lj" ] && grep -qE "\"version\": *\"$VRE\"|-$VRE\.exe" "$lj" && pub+=("assets-test/bridge-go/latest.json names $V (it ships with the next review publish)")
  if [ -z "${RELEASE_CHECK_OFFLINE:-}" ] && git remote get-url origin >/dev/null 2>&1; then
    timeout 60 git fetch -q origin main 2>/dev/null || echo "    (git fetch origin main failed; using the origin/main already here)"
  fi
  if git rev-parse -q --verify origin/main^{commit} >/dev/null; then
    onmain="$(git ls-tree -r --name-only origin/main | grep -E "(^|/)FinComBridge(-Setup)?-$VRE\.exe$" || true)"
    [ -n "$onmain" ] && pub+=("published on main: $(echo $onmain)")
    git show origin/main:review/assets/bridge-go/latest.json 2>/dev/null | grep -qE "\"version\": *\"$VRE\"|-$VRE\.exe" \
      && pub+=("the published review/assets/bridge-go/latest.json names $V")
  else
    pub+=("cannot see origin/main, so cannot show $V was never published")
  fi
  [ ${#pub[@]} -eq 0 ] || fail "1 version" "FORCE_REBUILD=1, but $V was published (or cannot be shown not to be):" "${pub[@]}" \
    "A published version is never built again under the same number: raise BridgeVersion."
  pass "1 version $V (FORCE_REBUILD=1: ${used[*]}; never published)"
else
  pass "1 version $V is new (no setup in assets-test, no tag, not in the release log)"
fi

# --- 2. vet and tests -------------------------------------------------------------------------------------------------
go vet ./... >"$LOG" 2>&1 || fail "2 go vet (Linux)" "$(tail -20 "$LOG")"
GOOS=windows go vet ./... >"$LOG" 2>&1 || fail "2 go vet (Windows)" "$(tail -20 "$LOG")"
for t in $SIZE_TESTS $ALLOW_TESTS; do
  grep -qE "^func $t[A-Za-z0-9_]*\(t \*testing\.T\)" ./*_test.go 2>/dev/null \
    || fail "2 required tests" "missing test $t (no 'func $t...(t *testing.T)' in bridge-go/*_test.go)"
done
go test -count=1 ./... >"$LOG" 2>&1 || fail "2 go test ./..." "$(grep -E '^(--- FAIL|FAIL|panic)' "$LOG" | head -20)" "$(tail -10 "$LOG")"
run_named() { # $1: label, $2: -run pattern, rest: test-name prefixes that must each PASS
  local label="$1" pat="$2"; shift 2
  go test -count=1 -run "$pat" -v ./... >"$LOG" 2>&1 || fail "$label" "$(grep -E '^(--- FAIL|FAIL|panic)' "$LOG" | head -20)" "$(tail -10 "$LOG")"
  for t in "$@"; do
    grep -qE "^--- PASS: $t" "$LOG" || fail "$label" "missing test $t (go test -run '$pat' ran no passing $t)"
  done
  grep -E "^--- SKIP" "$LOG" | grep -qE "$pat" && fail "$label" "a required test was skipped:" "$(grep -E '^--- SKIP' "$LOG")"
  return 0
}
run_named "2 size test" "Size" $SIZE_TESTS
run_named "2 allow-list tests" "AllowList|NoComputedFigure|EveryRequestOnList|UnknownRequest" $ALLOW_TESTS
pass "2 go vet (Linux, Windows), go test ./..., size test, allow-list tests"

# --- 3. go.mod --------------------------------------------------------------------------------------------------------
go mod tidy -diff >"$LOG" 2>&1 || fail "3 go mod tidy -diff" "go.mod/go.sum differ from what 'go mod tidy' makes:" "$(head -30 "$LOG")"
pass "3 go.mod and go.sum as go mod tidy leaves them"

# --- 4. allow-list ----------------------------------------------------------------------------------------------------
[ -f "$ALLOWLIST" ] || fail "4 allow-list" "docs/tally-allowlist.md is missing (the measured table of Tally requests)"
HASH="$(sha256sum "$ALLOWLIST" | cut -d' ' -f1)"
last="$(log_rows | tail -1)"
lastv="$(echo "$last" | cell 1)"; lastdate="$(echo "$last" | cell 2)"; lasthash="$(echo "$last" | cell 3)"
if [ -n "$lasthash" ] && echo "$lasthash" | grep -qE '^[0-9a-f]{12,64}$' && [ "${HASH#"$lasthash"}" != "$HASH" ]; then
  pass "4 allow-list unchanged since $lastv (sha256 ${HASH:0:16})"
else
  m="$(grep -oiE 're-measured on [0-9]{4}-[0-9]{2}-[0-9]{2}' "$ALLOWLIST" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | sort | tail -1)"
  [ -n "$m" ] || fail "4 allow-list" "docs/tally-allowlist.md changed since the last release (${lastv:-none}: ${lasthash:-no hash}; now ${HASH:0:16})" \
    "and has no 're-measured on YYYY-MM-DD' line: measure the changed requests on ZZ BIG TEST and date it"
  if echo "$lastdate" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' && [[ "$m" < "$lastdate" ]]; then
    fail "4 allow-list" "docs/tally-allowlist.md changed, but its newest 're-measured on' ($m) is before the last release ($lastv, $lastdate)"
  fi
  pass "4 allow-list changed (sha256 ${HASH:0:16}) and re-measured on $m"
fi

# --- 5. reviews -------------------------------------------------------------------------------------------------------
HEAD="$(git rev-parse HEAD)"
for kind in code security; do
  f="docs/reviews/bridge-$V-$kind-review.md"
  [ -f "$ROOT/$f" ] || fail "5 $kind review" "$f is missing (the $kind review of this version, naming the git range reviewed)"
  range="$(grep -oE '[0-9a-f]{7,40}\.\.\.?[0-9a-f]{7,40}' "$ROOT/$f" | tail -1)"
  [ -n "$range" ] || fail "5 $kind review" "$f names no git range (write e.g. 'Range: abc1234..def5678')"
  to="${range##*.}"
  tofull="$(git rev-parse -q --verify "$to^{commit}" 2>/dev/null)" || fail "5 $kind review" "$f: $to (in $range) is not a commit here"
  if [ "$tofull" != "$HEAD" ]; then
    git merge-base --is-ancestor "$tofull" HEAD || fail "5 $kind review" "$f: $range does not end at HEAD or an ancestor of it"
    other="$(git diff --name-only "$tofull" HEAD | grep -v '^docs/' || true)"
    [ -z "$other" ] || fail "5 $kind review" "$f reviewed up to ${to}; files outside docs/ changed after it:" $other \
      "Review those changes and write the new range."
  fi
  pass "5 $kind review: $f ($range)"
done
dirty="$(git -C "$ROOT" status --porcelain | cut -c4- | grep -v '^docs/' || true)"
[ -z "$dirty" ] || fail "5 reviews" "changes outside docs/ are not committed, so no review covers them:" $dirty

# --- 6. test sheet ----------------------------------------------------------------------------------------------------
sheet="docs/bridge-$V-test-sheet.txt"
[ -f "$ROOT/$sheet" ] || fail "6 test sheet" "$sheet is missing"
grep -qF "$V" "$ROOT/$sheet" || fail "6 test sheet" "$sheet does not mention $V"
pass "6 test sheet $sheet"

# --- 7. app tests -----------------------------------------------------------------------------------------------------
if [ -n "$WITH_APP" ]; then
  [ -d "$ROOT/site-test" ] && [ -d "$ROOT/app/dist-test" ] || fail "7 app tests" "the builds are missing:" \
    "python3 build.py; cd app && npm ci && npm run legacy && npm run build:test"
  "$ROOT/tests/ci/run_ci.sh" || fail "7 app tests" "tests/ci/run_ci.sh failed (logs in tests/out/ci-logs/)"
  pass "7 app tests (tests/ci/run_ci.sh)"
fi

echo
echo "RELEASE CHECK PASSED for FinCom Bridge $V at ${HEAD:0:12}:"
for d in "${DONE[@]}"; do echo "  ok  $d"; done
[ -n "$WITH_APP" ] || echo "  (app tests not run; add --with-app)"
echo "Next (docs/RELEASE-CHECKLIST.md): build, release log row with allow-list sha256 ${HASH:0:16}, pilot on NWS144."
