#!/bin/bash
# Put the React test build at staging.fincom.live/react/ for checking (see the "Checking the React FinCom" guide).
# Builds from this branch, copies app/dist-test into the react/ folder of main, and pushes main. Only react/ changes on
# main; the site at the top of the repository is not touched. Run from app/: ./publish-preview.sh
set -e
cd "$(dirname "$0")"
( cd .. && python3 build.py --react >/dev/null )
npm run build:test >/dev/null
tmp=$(mktemp -d)
git fetch -q origin main
git worktree add -q "$tmp" origin/main
find "$tmp/react" -mindepth 1 ! -name README.txt -delete 2>/dev/null || mkdir -p "$tmp/react"
cp -r dist-test/. "$tmp/react/"
cd "$tmp"
git add -A react
if git diff --cached --quiet; then echo "Preview already up to date."; else
  git commit -qm "Preview: React FinCom from branch react ($(git -C "$OLDPWD" rev-parse --short HEAD))"
  git push -q origin HEAD:main
  echo "Published; staging.fincom.live/react/ shows it in about a minute."
fi
cd - >/dev/null; git worktree remove --force "$tmp"
