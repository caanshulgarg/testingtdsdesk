#!/bin/bash
# Put the React test build (staging database) at staging.fincom.live/<folder>/ for checking (see the "Checking the React
# FinCom" guide). Builds from the branch checked out here, copies app/dist-test into <folder>/ of main, and pushes main.
# Only <folder>/ changes on main: the push is refused if anything else would change. Run from app/:
#   ./publish-preview.sh                                   staging.fincom.live/react/ (the default)
#   ./publish-preview.sh next "REVIEW BUILD – Phase 1"     staging.fincom.live/next/: the trial address. The usual way
#                                                          (docs/RELEASE-FLOW.md): tried there, then ./promote-next.sh
#                                                          puts these same files at review/. Its strip says TRIAL at
#                                                          /next/, and the banner given here once it is at /review/
#   ./publish-preview.sh review "REVIEW BUILD – Phase 1"   staging.fincom.live/review/ straight away, with that banner
#                                                          (no trial: for an urgent fix only)
#   DRY=1 ./publish-preview.sh review …                    build and commit locally, show what would change, push nothing
# A publish to review/ writes review/last-good.json (the build it replaced), for ./rollback-review.sh, and keeps that build
# at review-prev/ for the page's own healer (docs/NEVER-BLANK.md).
# FINCOM_SKIP_BUILD=1: app/dist-test as it is, no new build (the release flow's own test, tests/run_release_flow.py).
set -e
cd "$(dirname "$0")"
. ./release-lib.sh
folder="${1:-react}"; banner="${2:-}"
case "$folder" in ""|.|..|*/*|assets|src|app|docs|tests|status|welcome|cloudflare|connector|server|bridge|build|retired) echo "Not a preview folder: $folder"; exit 1;; esac
if [ -z "${FINCOM_SKIP_BUILD:-}" ]; then
  ( cd .. && python3 build.py --react >/dev/null )
  FINCOM_BANNER="$banner" npm run build:test >/dev/null
fi
# FinCom Bridge 2.4.5 (ROUND 102): the retired PowerShell bridge is never published (build.py leaves it out; checked here too)
[ ! -e dist-test/assets/connector/TDSBridge.ps1 ] || { echo "dist-test still holds assets/connector/TDSBridge.ps1 (the retired PowerShell bridge): stopped."; exit 1; }
grep -q "qbocskaiewaxqcvaunzc" dist-test/legacy.js && ! grep -q "nrtczucrlgalvtojwoes" dist-test/legacy.js || { echo "The build does not point at the staging database: stopped."; exit 1; }
# the trial address (docs/RELEASE-FLOW.md): the build names no folder of its own (base "./"; the worker's scope and cache
# names come from the address it is served at), so the files tried at next/ can go to review/ unchanged
! grep -qE '(src|href)="/[^/]' dist-test/index.html || { echo "index.html asks for a file from the site's root instead of ./: stopped (the build would work in one folder only)."; exit 1; }
dist=$(pwd)/dist-test
branch=$(git rev-parse --abbrev-ref HEAD); sha=$(git rev-parse --short HEAD)
new=$(build_of "$dist/build.json")
main_checkout
cd "$tmp"
[ "$folder" != review ] || last_good_save "$new" "publish"
replace_folder "$dist" "$folder"
[ "$folder" != review ] || last_good_put
folders="$folder"; [ "$folder" != review ] || folders="review review-prev"
finish "$folders" "Preview: React FinCom from branch $branch ($sha) at $folder/ (build $new)" "Published; staging.fincom.live/$folder/ shows it in about a minute."
