#!/bin/bash
# Put the React test build (staging database) at staging.fincom.live/<folder>/ for checking (see the "Checking the React
# FinCom" guide). Builds from the branch checked out here, copies app/dist-test into <folder>/ of main, and pushes main.
# Only <folder>/ changes on main: the push is refused if anything else would change. Run from app/:
#   ./publish-preview.sh                                   staging.fincom.live/react/ (the default)
#   ./publish-preview.sh review "REVIEW BUILD – Phase 1"   staging.fincom.live/review/, with that banner
#   DRY=1 ./publish-preview.sh review …                    build and commit locally, show what would change, push nothing
set -e
cd "$(dirname "$0")"
folder="${1:-react}"; banner="${2:-}"
case "$folder" in ""|.|..|*/*|assets|src|app|docs|tests) echo "Not a preview folder: $folder"; exit 1;; esac
( cd .. && python3 build.py --react >/dev/null )
FINCOM_BANNER="$banner" npm run build:test >/dev/null
grep -q "qbocskaiewaxqcvaunzc" dist-test/legacy.js && ! grep -q "nrtczucrlgalvtojwoes" dist-test/legacy.js || { echo "The build does not point at the staging database: stopped."; exit 1; }
tmp=$(mktemp -d)
git fetch -q origin main
git worktree add -q "$tmp" origin/main
find "$tmp/$folder" -mindepth 1 ! -name README.txt -delete 2>/dev/null || mkdir -p "$tmp/$folder"
cp -r dist-test/. "$tmp/$folder/"
cd "$tmp"
git add -A "$folder"
if git diff --cached --quiet; then echo "Preview already up to date."; else
  git commit -qm "Preview: React FinCom from branch $(git -C "$OLDPWD" rev-parse --abbrev-ref HEAD) ($(git -C "$OLDPWD" rev-parse --short HEAD)) at $folder/"
  git diff --stat=120 origin/main HEAD
  outside=$(git diff --name-only origin/main HEAD | grep -v "^$folder/" || true)
  if [ -n "$outside" ]; then echo "Files outside $folder/ would change: stopped."; echo "$outside"
  elif [ -n "$DRY" ]; then echo "DRY: nothing pushed."
  else git push -q origin HEAD:main; echo "Published; staging.fincom.live/$folder/ shows it in about a minute."; fi
fi
cd - >/dev/null; git worktree remove --force "$tmp"
