#!/bin/bash
# Roll the published app back to an earlier publish (reliability item 1). Puts the app's files of <folder>/ on main
# (staging.fincom.live/<folder>/) back to what an earlier publish of app/publish-preview.sh put there, and pushes main;
# GitHub Pages shows it in about a minute. Run from any clone of the repository (it works on origin/main in a folder of
# its own), or from GitHub: Actions -> "Roll back the app" -> Run workflow (.github/workflows/rollback-app.yml).
#
#   bash .github/scripts/rollback-app.sh                     the publish before the one now on the site
#   bash .github/scripts/rollback-app.sh --steps 2           two publishes back
#   bash .github/scripts/rollback-app.sh --to 44ef84bde      that publish (forward too: undo a rollback)
#   DRY=1 bash .github/scripts/rollback-app.sh               show what would go back, push nothing
#   options: --folder review (default) | --max 5 (refuse a build more than 5 publishes older than the newest)
#
# Never the bridge: review/assets/bridge-go/**, review/assets/connector/**, every latest.json and every bridge-setup*
# file stay exactly as they are (the computers' update list must never point back). Only <folder>/ changes on main:
# status/, .github/ and everything else stay. It refuses a target that is not a publish, one older than --max publishes,
# a published app that matches no publish (unless --to says where to go), and any change to a bridge file.
set -euo pipefail
folder=review; steps=1; to=""; max=5; remote="${ROLLBACK_REMOTE:-origin}"
while [ $# -gt 0 ]; do
  case "$1" in
    --folder) folder="$2"; shift 2;;
    --steps) steps="$2"; shift 2;;
    --to) to="$2"; shift 2;;
    --max) max="$2"; shift 2;;
    -h|--help) sed -n '2,17p' "$0"; exit 0;;
    *) echo "Unknown option: $1"; exit 2;;
  esac
done
case "$folder" in ""|.|..|*/*|assets|src|app|docs|tests|status|.github) echo "Not a preview folder: $folder"; exit 2;; esac
[[ "$steps" =~ ^[1-9][0-9]?$ ]] || { echo "--steps must be 1 or more"; exit 2; }
[[ "$max" =~ ^[0-9]{1,2}$ ]] || { echo "--max must be a number"; exit 2; }

# the bridge's files: never changed by a rollback (paths from the top of the repository)
BRIDGE_RE="^$folder/(assets/bridge-go/|assets/connector/|(.*/)?latest\.json|(.*/)?bridge-setup)"

git fetch -q "$remote" main
main="$remote/main"
# the app's files of <folder>/ at a commit, as one fingerprint (the bridge's left out)
app_list() { git ls-tree -r "$1" -- "$folder/" | awk -F'\t' '{print $2"\t"$1}' | grep -Ev "$BRIDGE_RE" || true; }
app_print() { app_list "$1" | git hash-object --stdin; }
# the publishes of <folder>/, newest first (app/publish-preview.sh's commit: "Preview: React FinCom from branch ... at <folder>/")
mapfile -t pubs < <(git log --format=%H --grep="^Preview: .* at $folder/\$" "$main" -- "$folder")
[ ${#pubs[@]} -gt 0 ] || { echo "No publish of $folder/ found on main: stopped."; exit 1; }

now=$(app_print "$main"); cur=-1
for i in "${!pubs[@]}"; do [ "$(app_print "${pubs[$i]}")" = "$now" ] && { cur=$i; break; }; done
if [ -n "$to" ]; then
  full=$(git rev-parse -q --verify "$to^{commit}" 2>/dev/null || true)
  tgt=-1; for i in "${!pubs[@]}"; do [ "${pubs[$i]}" = "$full" ] && tgt=$i; done
  [ "$tgt" -ge 0 ] || { echo "$to is not a publish of $folder/ on main: stopped."; exit 1; }
else
  [ "$cur" -ge 0 ] || { echo "The app now at $folder/ matches no publish (changed by hand?): stopped. Name one with --to."; exit 1; }
  tgt=$((cur + steps))
  [ "$tgt" -lt ${#pubs[@]} ] || { echo "There is no publish $steps back (only ${#pubs[@]} on main): stopped."; exit 1; }
fi
[ "$tgt" -le "$max" ] || { echo "That build is $tgt publishes older than the newest: older than $max publishes, refused (--max)."; exit 1; }
target=${pubs[$tgt]}
[ "$cur" != "$tgt" ] || { echo "The site already shows that build: nothing to do."; exit 0; }

build_of() { git show "$1:$folder/build.json" 2>/dev/null | sed -n 's/.*"build" *: *"\([^"]*\)".*/\1/p' || true; }
tmp=$(mktemp -d); trap 'git worktree remove --force "$tmp" >/dev/null 2>&1 || rm -rf "$tmp"' EXIT
git worktree add -q --detach "$tmp" "$main"
(
  cd "$tmp"
  # the app's files as the target publish had them: the present ones out, the target's in; the bridge's not touched
  old=$(git ls-tree -r --name-only "$main" -- "$folder/" | grep -Ev "$BRIDGE_RE" || true)
  new=$(git ls-tree -r --name-only "$target" -- "$folder/" | grep -Ev "$BRIDGE_RE" || true)
  [ -z "$old" ] || printf '%s\n' "$old" | git rm -q --pathspec-from-file=-
  [ -n "$new" ] || { echo "The publish $target has no app files in $folder/: stopped."; exit 1; }
  printf '%s\n' "$new" | git checkout -q "$target" --pathspec-from-file=-
  if [ -n "${FINCOM_ROLLBACK_SELFTEST_TOUCH_BRIDGE:-}" ]; then   # the test's proof that the guard below stops it
    f=$(git ls-files -- "$folder" | grep -E "$BRIDGE_RE" | head -1); echo "self-test" >> "$f"; git add -- "$f"
  fi
  changed=$(git diff --cached --name-only "$main")
  outside=$(printf '%s\n' "$changed" | grep -v "^$folder/" | grep -v '^$' || true)
  bridge=$(printf '%s\n' "$changed" | grep -E "$BRIDGE_RE" || true)
  [ -z "$outside" ] || { echo "Files outside $folder/ would change: stopped."; echo "$outside"; exit 1; }
  [ -z "$bridge" ] || { echo "A bridge file (bridge-go, latest.json, a setup) would change: stopped."; echo "$bridge"; exit 1; }
  [ -n "$changed" ] || { echo "Nothing would change: stopped."; exit 1; }
  from_b=$(build_of "$main"); to_b=$(build_of "$target")
  subj=$(git log -1 --format=%s "$target")
  git commit -qm "Rollback: $folder/ back to the app of $(git rev-parse --short "$target") (build ${to_b:-?})" \
    -m "From build ${from_b:-?} to build ${to_b:-?}, $tgt publish(es) older than the newest: $subj
The bridge's files (assets/bridge-go, latest.json, setups) are unchanged. Made by .github/scripts/rollback-app.sh."
  echo "What went back on staging.fincom.live/$folder/:"
  echo "  build ${from_b:-?} (now) -> build ${to_b:-?}, the publish $target of $(git log -1 --format=%cd --date=format:'%d-%b-%Y %H:%M UTC' "$target")"
  echo "  $subj"
  git diff --stat=120 "$main" HEAD | sed 's/^/  /'
  echo "  The bridge's files did not change."
  if [ -n "${DRY:-}" ]; then echo "DRY: nothing pushed."
  else
    if ! git push -q "$remote" HEAD:main 2>/dev/null; then
      # main moved meanwhile (the uptime watch's status/ commit): on top of it, unless review/ itself changed
      before=$(git rev-parse "$main"); git fetch -q "$remote" main
      if ! git diff --quiet "$before" "$main" -- "$folder"; then echo "A new publish of $folder/ arrived meanwhile: stopped, nothing pushed. Run it again."; exit 1; fi
      git rebase -q "$main"; git push -q "$remote" HEAD:main
    fi
    echo "Pushed. staging.fincom.live/$folder/ shows it in about a minute (reload the page)."; fi
)
