#!/usr/bin/env bash
# apt-get on GitHub's runners with a bound on each try (.github/workflows/ci.yml). 22-Oct-2026: CI runs 39806847444 and
# 39809609372 lost their 30 minutes inside apt-get, not in a test: `apt-get update` (run by `playwright install
# --with-deps`, and by the LibreOffice step) hung on archive.ubuntu.com after the Azure mirror answered nothing (Ign),
# 29 minutes with no line printed. apt's own timeouts end a stalled connection; each try is also cut at a time limit and
# tried again, up to three times, so a stalled mirror costs minutes, not the job.
#
#   tests/ci/apt_install.sh [--archives DIR] package...
#
# --archives DIR: the downloaded .deb files are kept in DIR (ci.yml caches it) and, when DIR already holds them (a cache
# hit, the same runner image), they are installed from there with dpkg, with no download and no `apt-get update`; apt
# installs them as before if dpkg cannot.
set -u
ARCH=""
[ "${1:-}" = "--archives" ] && { ARCH="$2"; shift 2; }
[ $# -gt 0 ] || { echo "apt_install.sh: no packages"; exit 2; }
SUDO=(); [ "$(id -u)" -eq 0 ] || SUDO=(sudo)
OPTS=(-q -o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o DPkg::Lock::Timeout=120)
[ -n "$ARCH" ] && { mkdir -p "$ARCH/partial"; OPTS+=(-o "Dir::Cache::archives=$ARCH" -o APT::Keep-Downloaded-Packages=true); }
export DEBIAN_FRONTEND=noninteractive

if [ -n "$ARCH" ] && compgen -G "$ARCH/*.deb" >/dev/null; then
  echo "apt_install.sh: installing $(ls "$ARCH"/*.deb | wc -l) cached packages from $ARCH"
  if timeout 600 "${SUDO[@]}" dpkg -i --skip-same-version "$ARCH"/*.deb; then exit 0; fi
  echo "apt_install.sh: dpkg could not install the cached packages; apt-get installs them"
fi
for try in 1 2 3; do
  echo "apt_install.sh: try $try: apt-get update, then install $*"
  if timeout 300 "${SUDO[@]}" apt-get "${OPTS[@]}" update && timeout 900 "${SUDO[@]}" apt-get "${OPTS[@]}" install -y --no-install-recommends "$@"; then
    [ -n "$ARCH" ] && "${SUDO[@]}" chown -R "$(id -u):$(id -g)" "$ARCH"
    exit 0
  fi
  echo "apt_install.sh: try $try failed or timed out"
  "${SUDO[@]}" dpkg --configure -a || true
done
echo "::error::apt-get could not install $* in three tries"
exit 1
