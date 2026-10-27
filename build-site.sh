#!/bin/sh
# Makes site/: the only files the console Worker serves (wrangler.jsonc). Mirrors cloudflare/build-site.sh for the app.
#   - in a source checkout (console/ with src/): vite build -> site/, then _headers copied in
#   - on the `console` branch (console/publish.sh wrote site/ already, no src/): nothing is built, the checks still run
# Checks (the build stops on any): the page names the STAGING Supabase project and no other; no service key or other
# secret in any file; the CSP header is there; no file over Cloudflare's 25 MiB.
set -eu
cd "$(dirname "$0")"
STAGING=qbocskaiewaxqcvaunzc
if [ -d src ]; then
  [ -d node_modules ] || npm install --no-audit --no-fund
  rm -rf site
  CONSOLE_OUT=site npx vite build
  cp _headers site/_headers
fi
[ -f site/index.html ] && [ -f site/_headers ] || { echo "site/ is missing index.html or _headers"; exit 1; }
grep -q "Content-Security-Policy: default-src 'none'" site/_headers || { echo "the CSP header is missing"; exit 1; }
hosts=$(grep -rhoE '[a-z0-9]{20}\.supabase\.co' site | sort -u)
[ "$hosts" = "$STAGING.supabase.co" ] || { echo "the build must name only the staging project, found: $hosts"; exit 1; }
if grep -rlE 'service_role|SUPABASE_SERVICE|sb_secret_|sk-ant-|-----BEGIN [A-Z ]*PRIVATE KEY' site; then echo "a secret-looking string is in the build (files above): stopped"; exit 1; fi
big=$(find site -type f -size +25M)
[ -z "$big" ] || { echo "Over Cloudflare's 25 MiB per file: $big"; exit 1; }
echo "site: $(find site -type f | wc -l) files, $(du -sh site | cut -f1)"
