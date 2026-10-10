# server/_shared: one CORS list for every function

`cors.ts` holds the sites allowed to call FinCom's functions from a browser (`ALLOWED_ORIGINS`, plus each function's
`ALLOWED_ORIGINS` secret) and the request headers they accept (`ALLOW_HEADERS`: authorization, x-client-info, apikey,
content-type, x-fincom-device). Every function imports it as `../_shared/cors.ts`, so a site is added once.
(02-Oct-2026: admin and signin had staging.fincom.live from 01-Oct; the gateway's own copy did not, and bill reading
failed on staging.)

`server/security/functions/_shared` is a link to this folder, so `../_shared/cors.ts` resolves the same way from
`server/<fn>/` and from `server/security/functions/<fn>/`.

## What each deploy must include

Supabase deploys each function's files on their own. Send `server/_shared/cors.ts` with every one, named
`../_shared/cors.ts` (with the Supabase CLI: copy it to `supabase/functions/_shared/cors.ts`; the CLI bundles it).

| Function (deployed name) | Source folder | Files to deploy | Origin |
|---|---|---|---|
| gateway | server/security/functions/gateway | index.ts, cors.ts, classify.ts, ../_shared/cors.ts | the list |
| admin | server/security/functions/admin | index.ts, cors.ts, ../_shared/cors.ts | the list |
| signin | server/security/functions/signin | index.ts, cors.ts, ../_shared/cors.ts | the list |
| tally-ingest | server/tally-cloud | index.ts, parse.js, ../_shared/cors.ts, ../_shared/names.js, ../_shared/sentry.ts, ../_shared/sentry-scrub.js | `*` |
| gst-api | server/gst-api | index.ts, gstcrypto.ts, ../_shared/cors.ts | `*` |
| gst-taxpro | server/gst-taxpro | index.ts, ../_shared/cors.ts | `*` |
| support-mail | server/support-mail | index.ts, ../_shared/cors.ts | `*` |

The `*` functions take only the header list from here: each call carries a sign-in token or a device key (no cookies),
and tally-ingest and gst-taxpro are also called by the Tally bridge and the database's timer.
`signup` is called by the app but its source is not in this repository; fyn-relay is a Node server called only by
gst-api, not by a browser.

## Check after deploy (staging)

```sh
F=https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1   # staging (the test build's database); live: nrtczucrlgalvtojwoes
for fn in gateway admin signin; do
  for o in https://staging.fincom.live https://app.fincom.live https://fincom.live https://evil.example; do
    printf '%-8s %-28s ' "$fn" "$o"
    curl -s -o /dev/null -D - -X OPTIONS "$F/$fn" \
      -H "Origin: $o" -H "Access-Control-Request-Method: POST" \
      -H "Access-Control-Request-Headers: apikey, authorization, content-type, x-client-info" \
      | tr -d '\r' | grep -i '^access-control-allow-\(origin\|headers\)' | tr '\n' ' '; echo
  done
done
# expected: each FinCom site echoed back; https://evil.example answered with https://caanshulgarg.github.io
curl -s -o /dev/null -D - -X OPTIONS "$F/tally-ingest" -H "Origin: https://staging.fincom.live" \
  -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: x-fincom-device, content-type" \
  | grep -i '^access-control-allow'
```

Locally: `node tests/run_cors_preflight.js`.

## names.js: one rule for Tally names

`names.js` cleans a Tally ledger, group or party name (`namesClean`: entities decoded, line breaks one space, ends
trimmed, inner spaces kept as Tally has them) and gives its matching key (`namesKey`: also white space collapsed and
lower case). It is plain JavaScript with no imports. The cloud reader imports it (`server/tally-cloud/parse.js`, so
tally-ingest must be deployed with `../_shared/names.js`); `build.py` puts it, without its export line, at the head of
the app, where `ledClean` / `ledKey` / `ledNm` / `ledEnt` (src/js/00-core.js) and `Books.unesc` (src/js/04) call it.
`node tests/run_names_shared.js` checks both give the same names and keys.

## sentry-scrub.js and sentry.ts: error reports to Sentry, staging only (2.4.0)

`sentry-scrub.js` is the one scrubber for every report to Sentry: the app's `beforeSend` / `beforeBreadcrumb`
(app/src/sentry.js) and tally-ingest's reports (`sentry.ts`, which builds and posts the envelope itself, without an SDK,
only when `SUPABASE_URL` is the staging project and the secret `FINCOM_SENTRY` is not `off`). Plain JavaScript with no
imports. What may be sent, and how to turn it off: docs/sentry.md. Tests: `node tests/run_sentry_scrub.mjs`,
`node tests/run_sentry_cloud.mjs`.
