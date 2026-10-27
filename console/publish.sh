#!/bin/sh
# Builds the console and commits it to the `console` branch: built files only (site/, wrangler.jsonc, build-site.sh,
# README.md), the same pattern as main for the user app. The Worker fincom-console-staging deploys from that branch.
# Never touches main, staging-next or review/. Pushes only with --push.
#   sh console/publish.sh            build and commit locally
#   sh console/publish.sh --push     ... and push the console branch
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/.." && git rev-parse --show-toplevel)
src=$(cd "$repo" && git rev-parse --short HEAD)
sh "$here/build-site.sh"
wt=$(mktemp -d "${TMPDIR:-/tmp}/console-pub.XXXXXX")
cd "$repo"
git fetch -q origin console 2>/dev/null || true
if git rev-parse -q --verify origin/console >/dev/null; then
  git worktree add -q -B console "$wt" origin/console
else
  git worktree add -q --detach "$wt" && (cd "$wt" && git checkout -q --orphan console && git rm -rqf . >/dev/null 2>&1 || true)
fi
trap 'cd "$repo"; git worktree remove --force "$wt" 2>/dev/null || true' EXIT
find "$wt" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$here/site" "$wt/site"
cp "$here/wrangler.jsonc" "$here/build-site.sh" "$wt/"
printf '# FinCom Console: built files only\n\nMade by console/publish.sh from %s. Do not edit here: change console/ on a source branch and publish again.\nServed by the Worker fincom-console-staging (docs/CONSOLE-SETUP.md).\n' "$src" > "$wt/README.md"
cd "$wt"
git add -A
if git diff --cached --quiet; then echo "console branch already has this build"; exit 0; fi
git commit -q -m "Console build from $src"
echo "committed $(git rev-parse --short HEAD) on branch console"
[ "${1:-}" = "--push" ] && git push -u origin console || echo "not pushed (add --push)"
