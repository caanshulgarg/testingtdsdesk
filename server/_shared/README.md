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
| fincom-assistant | server/assistant | a one-line index.ts importing server/assistant/index.ts from GitHub at a pinned commit and calling main() (its own imports: ./agent.ts, ./tools.ts, ./tools/*, ./checks.ts, ./files.ts, ./mask.ts, ./models.ts, ./router.ts, ./citations.ts, ./notices.ts, ./entries.ts, ./mis.ts, ../_shared/misdef.js (My MIS's definition, shared with the app), ../_shared/cors.ts, ../_shared/sentry.ts, ../_shared/sentry-scrub.js); verify_jwt off (it checks the user's token itself) | the list |
| fincom-transcribe | server/fincom-transcribe | a one-line index.ts importing server/fincom-transcribe/index.ts from GitHub at a pinned commit and calling main() (its own import: ../_shared/cors.ts); verify_jwt off (it checks the user's token itself, as fincom-assistant); key platform_secrets groq_api_key; usage rows in assistant_log (feature voice) | the list |
| mis-run | server/mis-run | a one-line index.ts importing server/mis-run/index.ts from GitHub at a pinned commit and calling main() (its own imports: ./handler.ts, ./data.ts, ./pdf.ts, ../_shared/cors.ts, ../_shared/misdef.js, ../_shared/misledger.js, ../_shared/misageing.js, ../../app/src/lib/misCustom.js, ../../app/src/lib/misXlsx.js; ExcelJS and pdf-lib from npm); verify_jwt off (it checks the user's token, or the timer's x-cron-key with gst_cron_ok); email through Resend only when platform_secrets resend_api_key is set (sender platform_secrets resend_from, else FinCom MIS <mis@fincom.live>) | the list |
| tally-ingest | server/tally-cloud | index.ts, parse.js, ../_shared/cors.ts, ../_shared/names.js, ../_shared/sentry.ts, ../_shared/sentry-scrub.js | `*` |
| gst-api | server/gst-api | index.ts, gstcrypto.ts, ../_shared/cors.ts | `*` |
| gst-taxpro | server/gst-taxpro | index.ts, filing.ts, automatch.ts, ../_shared/cors.ts | `*` |
| gst-2b-match | server/gst-2b-match | index.ts, handler.ts, match.ts, ../_shared/cors.ts, ../_shared/match2b.js, ../assistant/models.ts, ../assistant/router.ts (models.ts imports it); verify_jwt off (it checks the user's token, the service key or the cron key itself) | the list |
| tds-challan-match | server/tds-challan-match | index.ts, handler.ts, match.ts, ../_shared/cors.ts, ../_shared/tdsmatch.js, ../assistant/models.ts, ../assistant/router.ts (models.ts imports it); verify_jwt off (it checks the user's token itself); no table of its own (the assistant's switch, cap, cost and log) | the list |
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

## match2b.js: one set of rules for matching 2B against the books

`match2b.js` is the 2B matching of round 72b: the invoice number written the same way (`m2bNormNo`), the rules
(`m2bRules`: same GSTIN, number, dates within 3 days, amounts within Rs 1.00), what goes to Claude for the left-overs and
how its answer is checked and decided (`m2bAiInput`, `m2bAiParse`, `m2bAiApply`), the line shown, and the reading of a 2B
JSON (`m2bFrom2bJson`, which `GST2B.fromJson` calls). Plain JavaScript with no imports. The gst-2b-match function imports it;
`build.py` puts it, without its export line, at the head of the app after names.js (`SHARED_JS`).
`node tests/run_2b_automatch.js` checks the app and the module give the same answers.

## tdsmatch.js: one matcher for TDS challans

`tdsmatch.js` says which challan pays which TDS deduction (next-challan-match, 17-Oct-2026): the rules a to f
(`tmRules`: From Tally; same section, same month, exact; same section, whole quarter, exact; same section, same month,
filled; several sections in one challan; an earlier challan's balance; a split offered), the reason and next step for
anything left (`tmReasons`), and what goes to Claude for the left-overs and how each pairing is checked (`tmAiInput`,
`tmAiParse`, `tmAiCheck`). Plain JavaScript with no imports. The tds-challan-match function imports it; `build.py` puts it,
without its export line, at the head of the app after match2b.js (`SHARED_JS`), where `TDSMatch` (src/js/86) calls it.
`node tests/run_tds_match.js` checks the rules one by one; `python3 tests/run_tds_challan_match_server.py` the function.
