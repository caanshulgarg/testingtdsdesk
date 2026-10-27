# Shared by publish-preview.sh, promote-next.sh and rollback-review.sh (sourced from app/, never run on its own).
# The release flow (docs/RELEASE-FLOW.md): a build goes to next/ on main (staging.fincom.live/next/, the trial address),
# is tried there, then promote-next.sh copies those exact files to review/; rollback-review.sh puts the previous review/
# back. Each changes one folder of main, in one commit, and pushes main (DRY=1: commits locally, pushes nothing).

die() { echo "$*" >&2; exit 1; }

# a build's id and stamp (build.json, written by vite.config.js: {"build": "<base36 ms>-<hex>", "stamp": "React · …"})
json_field() { python3 -c 'import json,sys
try: print(json.load(open(sys.argv[1])).get(sys.argv[2]) or "")
except Exception: print("")' "$1" "$2"; }
build_of() { json_field "$1" build; }
stamp_of() { json_field "$1" stamp; }
# when a build was made, in ms (the first part of its id)
built_ms() { python3 -c 'import sys
try: print(int(sys.argv[1].split("-")[0], 36))
except Exception: print(0)' "$1"; }

# a temporary checkout of origin/main in $tmp (removed when the script ends, whatever happens)
main_checkout() {
  here_dir=$(pwd)
  git fetch -q origin main
  tmp=$(mktemp -d)
  trap 'cd "$here_dir" && { git worktree remove --force "$tmp" 2>/dev/null || rm -rf "$tmp"; git worktree prune; }' EXIT
  git worktree add -q --detach "$tmp" origin/main
}

# review/last-good.json: before review/ is replaced, the build it holds now (the one people have been using) and the
# commit of main that holds it, which rollback-review.sh restores. Called in $tmp before review/ is emptied, with the
# new build's id and how it came (publish / promote); last_good_put writes it once the new files are in place.
last_good_save() {
  lg=$(mktemp)
  local cur; cur=$(build_of review/build.json)
  if [ -z "$cur" ]; then rm -f "$lg"; lg=""; return 0; fi
  # the same build put there again: the pointer stays as it was
  if [ "$cur" = "$1" ]; then if [ -f review/last-good.json ]; then cp review/last-good.json "$lg"; else rm -f "$lg"; lg=""; fi; return 0; fi
  python3 - review/build.json "$(git rev-parse HEAD)" "$1" "$2" > "$lg" <<'EOF'
import json, sys, datetime
b = json.load(open(sys.argv[1]))
print(json.dumps({
    "build": b.get("build", ""), "stamp": b.get("stamp", ""), "commit": sys.argv[2],
    "replacedBy": sys.argv[3], "how": sys.argv[4],
    "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "note": "the build review/ held before; app/rollback-review.sh puts review/ back as it is at commit"}, indent=1))
EOF
}
last_good_put() { if [ -n "${lg:-}" ]; then cp "$lg" review/last-good.json; rm -f "$lg"; fi; return 0; }

# a folder's files replaced by another's (README.txt, a note kept by hand on main, stays)
replace_folder() {  # $1 from (a directory), $2 the folder of main
  mkdir -p "$2"
  find "$2" -mindepth 1 ! -name README.txt -delete
  tar -C "$1" --exclude=./README.txt -cf - . | tar -C "$2" -xf -
}

# commit $1/ only, refuse anything outside it, push main (or not, DRY=1)
finish() {  # $1 folder, $2 commit message, $3 what to say once pushed
  git add -A "$1"
  if git diff --cached --quiet; then echo "Nothing to change: $1/ on main already is this."; return 0; fi
  git commit -qm "$2"
  git diff --stat=120 origin/main HEAD
  local outside; outside=$(git diff --name-only origin/main HEAD | grep -v "^$1/" || true)
  if [ -n "$outside" ]; then echo "Files outside $1/ would change: stopped."; echo "$outside"; return 1
  elif [ -n "${DRY:-}" ]; then echo "DRY: nothing pushed."
  else git push -q origin HEAD:main; echo "$3"; fi
}
