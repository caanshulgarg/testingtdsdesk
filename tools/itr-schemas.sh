#!/bin/sh
# tools/itr-schemas.sh [dir] - fetch the official CBDT ITR JSON schemas for AY 2026-27 (ITR-3, 4, 5, 6) from
# incometax.gov.in (Downloads > Income Tax Returns > "Schema" of each form) into dir (default app/public/itr-schema,
# git-ignored; Vite copies it into the build, so the page validates against the same files). Each file is checked
# against the SHA-256 pinned here: a file the site has changed is refused (a new schema version is a change to
# app/src/lib/itr/forms.js and these pins, made on purpose). The schemas are the department's ("All Rights Reserved"):
# they are not kept in the repository.
set -eu
DIR="${1:-$(dirname "$0")/../app/public/itr-schema}"
B="https://www.incometax.gov.in/iec/foportal/sites/default/files"
mkdir -p "$DIR"
fetch() { # url name sha
  if [ -f "$DIR/$2" ] && [ "$(sha256sum "$DIR/$2" | cut -d' ' -f1)" = "$3" ]; then echo "ok   $2 (already here)"; return 0; fi
  curl -fsSL --retry 2 --max-time 120 "$1" -o "$DIR/$2.part"
  got="$(sha256sum "$DIR/$2.part" | cut -d' ' -f1)"
  if [ "$got" != "$3" ]; then rm -f "$DIR/$2.part"; echo "FAIL $2: the site's file has changed (sha256 $got); not used" >&2; return 1; fi
  mv "$DIR/$2.part" "$DIR/$2"; echo "ok   $2"
}
fetch "$B/2026-07/ITR-3_2026_Main_V1.1.json" ITR-3_2026_Main_V1.1.json 66f4bd705e0e0788fdacb37eb297ace56749d791b84f2f170f4da84236c25e8b
fetch "$B/2026-07/ITR-4_2026_Main_V1.1.json" ITR-4_2026_Main_V1.1.json 5e9af50083ad92faa684a02ae51693189b43df16b92c1da5a184026fc5cdc2ac
fetch "$B/2026-08/ITR-5_2026_Main_V1.1.json" ITR-5_2026_Main_V1.1.json 3bb5f158f63556c3b91706de2901dba7e4c71039e12ec7a181c4dfc96fead6a9
fetch "$B/2026-08/ITR-6_2026_Main_V1.0.json" ITR-6_2026_Main_V1.0.json 15fb24266820944b0ca69b16f35459eea75bdb21f653e5e07e3400d16ed83e6a
