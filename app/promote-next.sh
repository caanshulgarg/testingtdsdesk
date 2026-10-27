#!/bin/bash
# Puts the build being tried at staging.fincom.live/next/ live at staging.fincom.live/review/ (docs/RELEASE-FLOW.md):
# the files of next/ on main copied to review/ as they are, byte for byte, with no new build, so what was tried is what
# goes live. Nothing needs rewriting: the build asks for its files by ./ addresses (Vite's base "./"), and its service
# worker takes its scope and its cache names (fincom-shell:/review/:<build>, fincom-files:/review/) from the address it
# is served at; only the TRIAL strip depends on the address, and index.html decides that when the page opens.
# Writes review/last-good.json (the build review/ held until now, for ./rollback-review.sh) and keeps that build at
# review-prev/ (the page's own healer opens it: docs/NEVER-BLANK.md). Only review/ and review-prev/ change on main.
# Refuses when next/ holds no complete build, when it is review/'s build already, or when it is older than review/'s.
#   ./promote-next.sh            DRY=1 ./promote-next.sh   (commit locally, show what would change, push nothing)
set -e
cd "$(dirname "$0")"
. ./release-lib.sh
main_checkout
cd "$tmp"
for f in index.html build.json legacy.js guard.js sw.js; do
  [ -f "next/$f" ] || die "next/ on main holds no complete build (no next/$f): publish one first, ./publish-preview.sh next \"<banner>\"."
done
nb=$(build_of next/build.json); rb=$(build_of review/build.json)
[ -n "$nb" ] || die "next/build.json names no build: stopped."
[ "$nb" != "$rb" ] || die "review/ already holds the build of next/ ($nb, $(stamp_of next/build.json)): nothing to promote."
if [ -n "$rb" ] && [ "$(built_ms "$nb")" -le "$(built_ms "$rb")" ]; then
  die "next/ holds an older build than review/: refused. next/ $nb ($(stamp_of next/build.json)), review/ $rb ($(stamp_of review/build.json)). Publish a new build to next/ first."
fi
! grep -qE '(src|href)="/[^/]' next/index.html || die "next/index.html asks for a file from the site's root instead of ./: it cannot be served from review/ unchanged. Stopped."
last_good_save "$nb" "promote"
replace_folder next review
last_good_put
# what goes live is exactly what was tried
diff -rq -x README.txt -x last-good.json next review >/dev/null || { diff -rq -x README.txt -x last-good.json next review | head; die "review/ is not an exact copy of next/: stopped."; }
finish "review review-prev" "Promote: the build tried at next/ ($nb, $(stamp_of next/build.json)) to review/ (was ${rb:-none})" \
  "Promoted; staging.fincom.live/review/ shows build $nb in about a minute. If it is wrong: ./rollback-review.sh"
