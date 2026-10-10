#!/bin/bash
# Put the React LIVE build (live database) at the ROOT of the live site, replacing the old app at once (the owner's
# decision of 10-Oct-2026; docs/GO-LIVE.md 1.4). Written for the go-live; NOT run yet.
# The live site: GitHub Pages of caanshulgarg/tds-desk, branch main (fixed here, not a setting).
#
# What it does: builds app/dist (npm run build: legacy/live.js), checks it names live's database and not staging's and
# carries no Sentry; clones tds-desk; the FIRST time, keeps the old app: copies the root index.html to
# retired/build-199/index.html (the old app is that one page; the files it loads stay at the root, untouched); then copies
# dist on top of the root (index.html, legacy.js, assets/...), commits once, and pushes. It never deletes a file, and
# refuses to push if any file would be deleted, or changed other than: a file of dist, and retired/build-199/index.html
# when it is first made. CNAME and everything else (the bridge downloads under assets/connector, ...) stay as they are.
#
# PUT THE OLD APP BACK (a minute; in a clone of tds-desk, branch main):
#   cp retired/build-199/index.html index.html && git commit -am "Put back Build 199" && git push origin main
# (or: git revert <the "Live: React FinCom" commit> && git push origin main)
#
# Refuses to do anything unless LIVE_GO=1. With DRY=1 as well it builds and commits in a throwaway clone, shows what
# would change, and pushes nothing. Run from app/, on a clean checkout of the commit staging shows:
#   LIVE_GO=1 DRY=1 ./publish-live.sh          everything except the push
#   LIVE_GO=1 ./publish-live.sh                the real publish
#
# The settings come from a file the owner fills in, kept OUTSIDE the repository so it can never be committed:
#   ~/.fincom/live.env   (or the path in LIVE_CONFIG; refused if it is inside a git work tree and not ignored there)
# Its lines (shell syntax, no spaces around =):
#   LIVE_PROJECT_ID=...        live's Supabase project id (20 lower-case letters and digits); the build must name it
#   LIVE_SOURCE_COMMIT=...     optional: the commit to build from (e.g. staging's 601e57ad); refused if HEAD is another
set -e
cd "$(dirname "$0")"
STAGING_ID="qbocskaiewaxqcvaunzc"
LIVE_SITE_REPO="https://github.com/caanshulgarg/tds-desk.git"     # the live site: GitHub Pages of tds-desk
LIVE_SITE_BRANCH="main"                                           # the branch Pages publishes from
KEEP="retired/build-199"                                          # where the old app is kept
[ "$LIVE_GO" = "1" ] || { echo "Refused: this publishes to LIVE. Set LIVE_GO=1 (and DRY=1 to try it without pushing)."; exit 1; }

cfg="${LIVE_CONFIG:-$HOME/.fincom/live.env}"
[ -f "$cfg" ] || { echo "No live settings file at $cfg (see the top of this script)."; exit 1; }
cfgdir=$(cd "$(dirname "$cfg")" && pwd)
if git -C "$cfgdir" rev-parse --is-inside-work-tree >/dev/null 2>&1 && ! git -C "$cfgdir" check-ignore -q "$cfg"; then
  echo "Refused: $cfg is inside a git work tree and not ignored there; keep it outside the repository."; exit 1
fi
LIVE_PROJECT_ID=""; LIVE_SOURCE_COMMIT=""
site_repo="$LIVE_SITE_REPO"; site_branch="$LIVE_SITE_BRANCH"; keep="$KEEP"
# shellcheck disable=SC1090
. "$cfg"
[ "$LIVE_SITE_REPO" = "$site_repo" ] && [ "$LIVE_SITE_BRANCH" = "$site_branch" ] && [ "$KEEP" = "$keep" ] || { echo "The settings file may not change the live site ($site_repo, $site_branch, $keep): stopped."; exit 1; }
[[ "$LIVE_PROJECT_ID" =~ ^[a-z0-9]{20}$ ]] || { echo "LIVE_PROJECT_ID is not a Supabase project id."; exit 1; }
[ "$LIVE_PROJECT_ID" != "$STAGING_ID" ] || { echo "LIVE_PROJECT_ID is staging's: stopped."; exit 1; }

# the source: committed, clean, and (when named) the commit staging shows
[ -z "$(git status --porcelain -- ..)" ] || { echo "The checkout has changes that are not committed: build from a clean commit."; exit 1; }
head=$(git rev-parse HEAD)
if [ -n "$LIVE_SOURCE_COMMIT" ]; then
  want=$(git rev-parse --verify -q "$LIVE_SOURCE_COMMIT^{commit}") || { echo "LIVE_SOURCE_COMMIT $LIVE_SOURCE_COMMIT is not here (git fetch?)."; exit 1; }
  [ "$want" = "$head" ] || { echo "HEAD is $head, not $LIVE_SOURCE_COMMIT: check out the commit staging shows first."; exit 1; }
fi

# the build (as publish-preview.sh, but the live one: dist/ from legacy/live.js)
( cd .. && python3 build.py --react >/dev/null )
npm run build >/dev/null
grep -q "$LIVE_PROJECT_ID" dist/legacy.js && ! grep -q "$STAGING_ID" dist/legacy.js || { echo "The build does not point at the live database (or names staging's): stopped."; exit 1; }
! grep -rqs "$STAGING_ID" dist/ || { echo "Something in dist/ names the staging database: stopped."; exit 1; }
! grep -rqs "ingest.us.sentry.io" dist/ || { echo "dist/ carries Sentry, which a live build must not: stopped."; exit 1; }
[ -f dist/index.html ] && [ ! -e dist/CNAME ] && [ ! -e "dist/retired" ] || { echo "dist/ has no index.html, or has a CNAME or retired/: stopped."; exit 1; }
distlist=$(cd dist && find . -type f | sed 's|^\./||' | sort)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q --depth 1 --branch "$LIVE_SITE_BRANCH" "$LIVE_SITE_REPO" "$tmp/site"
cd "$tmp/site"
base=$(git rev-parse HEAD)
kept=""
if [ ! -e "$KEEP/index.html" ]; then
  [ -f index.html ] || { echo "The live site has no root index.html to keep: stopped."; exit 1; }
  mkdir -p "$KEEP"; cp index.html "$KEEP/index.html"; kept="$KEEP/index.html"
  echo "The old app is kept at $KEEP/index.html."
fi
# the build may replace only index.html and legacy.js; any other file of the site it would overwrite with different
# content (e.g. the bridge downloads under assets/connector) stops it
clash=$(for f in $distlist; do case "$f" in index.html|legacy.js) ;; *) [ -e "$f" ] && ! cmp -s "$f" "$OLDPWD/dist/$f" && echo "$f";; esac; done)
[ -z "$clash" ] || { echo "The build would overwrite files the site already has: stopped."; echo "$clash"; exit 1; }
cp -r "$OLDPWD/dist/." ./
git add -A
if git diff --cached --quiet; then echo "The live site already has this build."; else
  git commit -qm "Live: React FinCom from $(git -C "$OLDPWD" rev-parse --abbrev-ref HEAD) (${head:0:8}) at the root${kept:+; the old app kept at $kept}"
  git diff --stat=120 "$base" HEAD
  deleted=$(git diff --diff-filter=D --name-only "$base" HEAD)
  other=$(git diff --name-only "$base" HEAD | grep -vxF -f <(printf '%s\n' $distlist $kept) || true)
  if [ -n "$deleted" ]; then echo "Files would be deleted: stopped."; echo "$deleted"; exit 1
  elif [ -n "$other" ]; then echo "Files other than the build (and the kept old app) would change: stopped."; echo "$other"; exit 1
  elif [ -n "$DRY" ]; then echo "DRY: nothing pushed."
  else git push -q origin "HEAD:$LIVE_SITE_BRANCH"
    echo "Published to $LIVE_SITE_REPO ($LIVE_SITE_BRANCH) at the root; app.fincom.live shows it in about a minute."
    echo "To put the old app back: cp $KEEP/index.html index.html && git commit -am \"Put back Build 199\" && git push origin main"
  fi
fi
