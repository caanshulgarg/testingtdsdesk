#!/bin/bash
# Put the React LIVE build (live database) on the live site. Written for the go-live (docs/GO-LIVE.md 1.4); NOT run yet.
# The live counterpart of publish-preview.sh: builds app/dist (npm run build: legacy/live.js), checks it names live's
# database and not staging's, copies it into <folder>/ of the live site's repository (GitHub Pages of
# caanshulgarg/tds-desk, branch main: the owner's answer of 10-Oct-2026; fixed here, not a setting), and pushes. Only <folder>/ changes
# in that repository: the push is refused if anything else would change.
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
#   LIVE_FOLDER=app            the folder of that repository the build goes into (not the root: see GO-LIVE.md 1.4)
#   LIVE_SOURCE_COMMIT=...     optional: the commit to build from (e.g. staging's 601e57ad); refused if HEAD is another
#   LIVE_URL=...               optional: the address the folder is served at, only printed at the end
set -e
cd "$(dirname "$0")"
STAGING_ID="qbocskaiewaxqcvaunzc"
LIVE_SITE_REPO="https://github.com/caanshulgarg/tds-desk.git"     # the live site: GitHub Pages of tds-desk
LIVE_SITE_BRANCH="main"                                           # the branch Pages publishes from
[ "$LIVE_GO" = "1" ] || { echo "Refused: this publishes to LIVE. Set LIVE_GO=1 (and DRY=1 to try it without pushing)."; exit 1; }

cfg="${LIVE_CONFIG:-$HOME/.fincom/live.env}"
[ -f "$cfg" ] || { echo "No live settings file at $cfg (see the top of this script)."; exit 1; }
cfgdir=$(cd "$(dirname "$cfg")" && pwd)
if git -C "$cfgdir" rev-parse --is-inside-work-tree >/dev/null 2>&1 && ! git -C "$cfgdir" check-ignore -q "$cfg"; then
  echo "Refused: $cfg is inside a git work tree and not ignored there; keep it outside the repository."; exit 1
fi
LIVE_PROJECT_ID=""; LIVE_FOLDER=""; LIVE_SOURCE_COMMIT=""; LIVE_URL=""
site_repo="$LIVE_SITE_REPO"; site_branch="$LIVE_SITE_BRANCH"
# shellcheck disable=SC1090
. "$cfg"
[ "$LIVE_SITE_REPO" = "$site_repo" ] && [ "$LIVE_SITE_BRANCH" = "$site_branch" ] || { echo "The settings file may not change the live site ($site_repo, $site_branch): stopped."; exit 1; }
[[ "$LIVE_PROJECT_ID" =~ ^[a-z0-9]{20}$ ]] || { echo "LIVE_PROJECT_ID is not a Supabase project id."; exit 1; }
[ "$LIVE_PROJECT_ID" != "$STAGING_ID" ] || { echo "LIVE_PROJECT_ID is staging's: stopped."; exit 1; }
folder="$LIVE_FOLDER"
case "$folder" in ""|.|..|*/*|assets|src|app|docs|tests|.git|.github) echo "Not a folder for the live build: '$folder'"; exit 1;; esac

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

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q --depth 1 --branch "$LIVE_SITE_BRANCH" "$LIVE_SITE_REPO" "$tmp/site"
cd "$tmp/site"
base=$(git rev-parse HEAD)
find "$folder" -mindepth 1 ! -name README.txt -delete 2>/dev/null || mkdir -p "$folder"
cp -r "$OLDPWD/dist/." "$folder/"
git add -A -- "$folder"
if git diff --cached --quiet; then echo "The live site already has this build."; else
  git commit -qm "Live: React FinCom from $(git -C "$OLDPWD" rev-parse --abbrev-ref HEAD) (${head:0:8}) at $folder/"
  git diff --stat=120 "$base" HEAD
  outside=$(git diff --name-only "$base" HEAD | grep -v "^$folder/" || true)
  if [ -n "$outside" ]; then echo "Files outside $folder/ would change: stopped."; echo "$outside"; exit 1
  elif [ -n "$DRY" ]; then echo "DRY: nothing pushed."
  else git push -q origin "HEAD:$LIVE_SITE_BRANCH"; echo "Published to $LIVE_SITE_REPO ($LIVE_SITE_BRANCH) at $folder/${LIVE_URL:+; it shows at $LIVE_URL in about a minute}."; fi
fi
