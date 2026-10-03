#!/usr/bin/env bash
# Runs the tests listed in tests/ci/tests.txt (or the list given), each with a time limit, prints a pass/fail table and
# exits non-zero when any test fails. Used by .github/workflows/ci.yml; runs the same on a developer's machine.
#
#   tests/ci/run_ci.sh                       # every test in tests/ci/tests.txt
#   tests/ci/run_ci.sh --shard 2/6           # the 2nd of 6 shares of about equal length (CI runs them in parallel)
#   tests/ci/run_ci.sh --list other.txt run_x.py ...   # another list, or tests named on the command line
#   tests/ci/run_ci.sh --shard 2/6 --dry-run # only print what would run (test, limit, settings)
#
# A line of the list: the test's file name in tests/, then optionally its time limit in seconds (default
# CI_TIMEOUT, 300; '-' for the default), then optionally VAR=value settings for that test only (paths relative to
# tests/). '#' starts a comment. .js/.mjs run with node, .py with python3, from inside tests/.
# Needs: site-test/ (python3 build.py) and app/dist-test/ (cd app && npm ci && npm run legacy && npm run build:test).
# A test that uses pg_stand.py (a throwaway PostgreSQL 16) runs as root (via sudo when this script is not root).
# Each test's output goes to tests/out/ci-logs/<test>.log; the last lines of a failing test's output are printed.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS="$(cd "$HERE/.." && pwd)"
LIST="$HERE/tests.txt"
SHARD=""
DRY=""
NAMES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --shard) SHARD="$2"; shift 2 ;;
    --list) LIST="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) NAMES+=("$1"); shift ;;
  esac
done
DEFAULT_TIMEOUT="${CI_TIMEOUT:-300}"
LOGS="${TDSDESK_OUT:-$TESTS/out}/ci-logs"
mkdir -p "$LOGS"

# the tests and their time limits
declare -a T L E
if [ ${#NAMES[@]} -gt 0 ]; then
  for n in "${NAMES[@]}"; do T+=("$(basename "$n")"); L+=("$DEFAULT_TIMEOUT"); E+=(""); done
else
  while read -r name limit envs; do
    case "$name" in ''|'#'*) continue ;; esac
    envs="${envs%%#*}"; [ "$limit" = "-" ] && limit=""
    T+=("$name"); L+=("${limit:-$DEFAULT_TIMEOUT}"); E+=("$envs")
  done < "$LIST"
fi
if [ -n "$SHARD" ]; then
  k="${SHARD%/*}"; n="${SHARD#*/}"
  # the longest first (by time limit), dealt out back and forth (1..n, n..1, ...) so the shares take about as long
  declare -a T2 L2 E2
  j=0
  for i in $(for i in "${!T[@]}"; do echo "${L[$i]} $i"; done | sort -s -k1,1nr | awk '{print $2}'); do
    r=$(( j / n )); p=$(( j % n )); [ $(( r % 2 )) -eq 1 ] && p=$(( n - 1 - p ))
    if [ $p -eq $(( k - 1 )) ]; then T2+=("${T[$i]}"); L2+=("${L[$i]}"); E2+=("${E[$i]}"); fi
    j=$(( j + 1 ))
  done
  T=("${T2[@]}"); L=("${L2[@]}"); E=("${E2[@]}")
fi
[ ${#T[@]} -gt 0 ] || { echo "no tests to run"; exit 1; }
if [ -n "$DRY" ]; then for i in "${!T[@]}"; do echo "${T[$i]} ${L[$i]} ${E[$i]}"; done; exit 0; fi

# the made-up books' cache, made once here rather than by several tests at the same moment
if [ ! -e "$TESTS/data/Master.xml" ] && [ -z "${TDSDESK_DATA:-}" ]; then
  node "$TESTS/fixture_cache.js" "${TDSDESK_OUT:-$TESTS/out}/fixture-books-cache.json" >"$LOGS/_fixture_cache.log" 2>&1 \
    || { echo "fixture_cache.js failed:"; tail -20 "$LOGS/_fixture_cache.log"; exit 1; }
fi

SUDO=()
[ "$(id -u)" -eq 0 ] || SUDO=(sudo -E env "PATH=$PATH" "HOME=$HOME")

declare -a R S
fails=0
start_all=$(date +%s)
cd "$TESTS"
for i in "${!T[@]}"; do
  t="${T[$i]}"; lim="${L[$i]}"; log="$LOGS/$t.log"
  if [ ! -f "$TESTS/$t" ]; then R+=("MISSING"); S+=(0); fails=$((fails+1)); echo "MISSING $t"; continue; fi
  case "$t" in
    *.js|*.mjs) cmd=(node "$t") ;;
    *.py) cmd=(python3 "$t") ;;
    *) R+=("UNKNOWN"); S+=(0); fails=$((fails+1)); echo "UNKNOWN $t"; continue ;;
  esac
  pre=()
  grep -q "pg_stand" "$t" && pre=("${SUDO[@]}")
  echo "::group::$t"
  s0=$(date +%s)
  read -r -a envs <<<"${E[$i]}"
  "${pre[@]}" env "${envs[@]}" timeout -k 10 "$lim" "${cmd[@]}" >"$log" 2>&1 </dev/null
  rc=$?
  # files a test run as root left behind are handed back, so the next tests can write over them
  [ ${#pre[@]} -gt 0 ] && sudo chown -R "$(id -u):$(id -g)" "${TDSDESK_OUT:-$TESTS/out}" "$TESTS" 2>/dev/null
  secs=$(( $(date +%s) - s0 ))
  if [ $rc -eq 0 ]; then res="pass"
  elif [ $rc -eq 124 ] || [ $rc -eq 137 ]; then res="TIMEOUT"; fails=$((fails+1))
  else res="FAIL($rc)"; fails=$((fails+1)); fi
  tail -n 3 "$log"
  echo "::endgroup::"
  printf '%-8s %4ss  %s\n' "$res" "$secs" "$t"
  if [ "$res" != "pass" ]; then
    echo "---- last lines of $t ----"; tail -n 40 "$log"; echo "----"
    # on GitHub, also as a check annotation (readable through the API when the job log is not): the FAIL lines, else the tail
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
      msg="$( { grep -a "FAIL\|Traceback\|Error" "$log" | head -n 12; echo "-- tail:"; tail -n 8 "$log"; } | cut -c1-300 | tr -d '\r' | sed ':a;N;$!ba;s/\n/%0A/g' | cut -c1-3800)"
      echo "::error file=tests/$t,title=$res $t::$msg"
    fi
  fi
  R+=("$res"); S+=("$secs")
done

total=$(( $(date +%s) - start_all ))
table() {
  printf '| %-40s | %-10s | %6s |\n' "test" "result" "secs"
  printf '|%s|%s|%s|\n' "------------------------------------------" "------------" "--------"
  for i in "${!T[@]}"; do printf '| %-40s | %-10s | %6s |\n' "${T[$i]}" "${R[$i]}" "${S[$i]}"; done
}
echo
table
echo
echo "${#T[@]} tests, $(( ${#T[@]} - fails )) passed, $fails failed, ${total}s${SHARD:+ (shard $SHARD)}"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  { echo "### Tests${SHARD:+ (shard $SHARD)}: $(( ${#T[@]} - fails ))/${#T[@]} passed in ${total}s"; echo; table; } >> "$GITHUB_STEP_SUMMARY"
fi
[ $fails -eq 0 ]
