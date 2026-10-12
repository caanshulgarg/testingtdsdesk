#!/bin/bash
# Put the reliability tooling on main (reliability items 1, 3 and 5), from the branch checked out here: the uptime watch
# and the rollback workflow (.github/workflows/uptime.yml, rollback-app.yml), their scripts (.github/scripts/), and the
# status page (status/index.html; status/status.json is the uptime watch's own and is never touched here).
# main is GitHub's default branch, so its .github/workflows/ is where scheduled and by-hand workflows run from;
# app/publish-preview.sh changes only <folder>/ on main, so these stay as they are across publishes.
# Only the files below change on main: the push is refused if anything else would. Run from app/:
#   ./publish-ops.sh            DRY=1 ./publish-ops.sh (commit locally, show what would change, push nothing)
# OPS_REMOTE (default origin) is where main is; the tests use a local copy.
set -e
cd "$(dirname "$0")/.."
remote="${OPS_REMOTE:-origin}"
FILES=(.github/workflows/uptime.yml .github/workflows/rollback-app.yml .github/scripts/rollback-app.sh .github/scripts/uptime_check.py status/index.html)
for f in "${FILES[@]}"; do [ -f "$f" ] || { echo "Missing $f: stopped."; exit 1; }; done
src="$PWD"
git fetch -q "$remote" main
base=$(git rev-parse FETCH_HEAD)
tmp=$(mktemp -d)
git worktree add -q --detach "$tmp" "$base"
trap 'cd "$src"; git worktree remove --force "$tmp" >/dev/null 2>&1 || true' EXIT
for f in "${FILES[@]}"; do mkdir -p "$tmp/$(dirname "$f")"; cp "$src/$f" "$tmp/$f"; done
cd "$tmp"
git add -- "${FILES[@]}"
if git diff --cached --quiet; then echo "main already has them."; exit 0; fi
git commit -qm "Reliability tooling: uptime watch, app rollback, status page (from $(git -C "$src" rev-parse --abbrev-ref HEAD) $(git -C "$src" rev-parse --short HEAD))"
git diff --stat=120 "$base" HEAD
outside=$(git diff --name-only "$base" HEAD | grep -vxF -f <(printf '%s\n' "${FILES[@]}") || true)
if [ -n "$outside" ]; then echo "Files other than the tooling would change: stopped."; echo "$outside"; exit 1; fi
if [ -n "$DRY" ]; then echo "DRY: nothing pushed."; exit 0; fi
git push -q "$remote" HEAD:main
echo "Pushed to main. The uptime watch starts on its next 5-minute mark; staging.fincom.live/status/ shows once it has written status.json."
