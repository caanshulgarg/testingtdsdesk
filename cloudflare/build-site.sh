#!/bin/sh
# Builds cf-site/: the only files Cloudflare serves (docs/CLOUDFLARE.md). Run by `wrangler deploy` (wrangler.jsonc, build)
# on every push to main, from main's root. An allow-list: a file is public only when it is named here, so a new folder on
# main (sources, notes, keys) is never put on the web by accident.
#   index.html 404.html _headers _redirects   the root page (sends you to /review/), the not-found page, the header and
#                                             redirect rules (Cloudflare reads these two; they are not served)
#   .well-known/security.txt                  how to report a security problem
#   status/                                   the status page and status.json (the uptime job writes them to main)
#   assets/                                   what the installed 1.x bridges read: assets/connector/latest.json(.sig),
#                                             FinComConnector.exe, TDSBridge.ps1, bridge-setup.txt
#   welcome/                                  the public pages (what FinCom is, pricing, privacy, terms)
#   every top-level folder with legacy.js and guard.js: a build put there by app/publish-preview.sh (review/, react/),
#   without its source maps (*.map) and README.txt
# Never: connector/ (signing-key.enc), server/, src/, tests/, docs/, bridge/, build/, retired/, .github/, *.md, CNAME.
set -eu
cd "$(dirname "$0")/.."
out=cf-site
rm -rf "$out"; mkdir -p "$out"
for f in index.html 404.html _headers _redirects .well-known/security.txt; do
  [ -f "$f" ] && { mkdir -p "$out/$(dirname "$f")"; cp "$f" "$out/$f"; }
done
for d in status assets welcome; do [ -d "$d" ] && cp -R "$d" "$out/$d"; done
for d in */; do
  d=${d%/}
  [ -f "$d/legacy.js" ] && [ -f "$d/guard.js" ] || continue
  cp -R "$d" "$out/$d"
  find "$out/$d" \( -name '*.map' -o -name README.txt \) -type f -exec rm -f {} +
done
# Cloudflare refuses a file over 25 MiB: say which, instead of a failed deploy with no reason
big=$(find "$out" -type f -size +25M)
[ -z "$big" ] || { echo "Over Cloudflare's 25 MiB per file: $big"; exit 1; }
echo "cf-site: $(find "$out" -type f | wc -l) files, $(du -sh "$out" | cut -f1)"
