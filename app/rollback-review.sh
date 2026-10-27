#!/bin/bash
# Puts the previous build back at staging.fincom.live/review/, in one command (docs/RELEASE-FLOW.md). review/last-good.json
# (written by every publish to review/ and every promote) names the build review/ held before and the commit of main that
# holds it; review/ is restored exactly as it is in that commit, last-good.json included, so a second rollback goes one
# build further back. Only review/ changes on main; next/ is left as it is.
#   ./rollback-review.sh               the build named by review/last-good.json
#   ./rollback-review.sh <commit>      review/ as it is in that commit of main (when there is no last-good.json)
#   DRY=1 ./rollback-review.sh         commit locally, show what would change, push nothing
set -e
cd "$(dirname "$0")"
. ./release-lib.sh
main_checkout
cd "$tmp"
want=""
if [ -n "${1:-}" ]; then to=$(git rev-parse --verify -q "$1^{commit}") || die "No commit $1 on main."
elif [ -f review/last-good.json ]; then
  to=$(json_field review/last-good.json commit); want=$(json_field review/last-good.json build)
  [ -n "$to" ] && git cat-file -e "$to^{commit}" 2>/dev/null || die "review/last-good.json names commit '$to', which main does not have: stopped."
else
  echo "review/ has no last-good.json (published before it existed). The recent builds of review/ on main:" >&2
  git log -6 --format='  %h %cd %s' --date=format:'%d-%b-%Y %H:%M' -- review/build.json >&2
  die "Give the one to go back to: ./rollback-review.sh <commit>"
fi
git cat-file -e "$to:review/build.json" 2>/dev/null || die "Commit $to has no build in review/: stopped."
got=$(git show "$to:review/build.json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("build") or "")')
[ -z "$want" ] || [ "$got" = "$want" ] || die "review/last-good.json names build $want, but commit $to holds $got: stopped."
cur=$(build_of review/build.json)
[ "$got" != "$cur" ] || die "review/ already holds build $got: nothing to roll back."
git rm -rq --ignore-unmatch review
git checkout "$to" -- review
finish review "Rollback review/ to build $got ($(git show "$to:review/build.json" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("stamp") or "")')) as at $(git rev-parse --short "$to") (was ${cur:-none})" \
  "Rolled back; staging.fincom.live/review/ shows build $got in about a minute."
