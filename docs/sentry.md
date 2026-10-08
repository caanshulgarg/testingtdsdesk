# Sentry error reports (staging only), from 2.4.0

FinCom sends error reports to Sentry (organisation garg-shekhar-company, US region) from three places, **on staging
only**: the React app's test build, the cloud function tally-ingest on the staging database, and the Go bridge when its
settings ask for it. Every report is rebuilt from an allow-list of fields and scrubbed before it leaves; the same rules
are tested on every CI run, and a test fails the build if any made-up business data could leave.

## The owner's conditions (approved 08-Oct-2026), quoted

> 1. NO business data leaves: no party/ledger/company/client names, amounts, GSTIN, PAN, narrations, bill numbers, Tally
>    answers/XML, form field values, file names of uploaded documents, request/response bodies, URLs' query strings or
>    hash parameters with ids, user emails/names. Only: error type and message (scrubbed), stack trace/code location,
>    release/version, environment "staging", page/route NAME (not params), browser/OS, a random per-install id.
> 2. No session replay, no screenshots, no user feedback widget, sendDefaultPii false, no request bodies, breadcrumbs
>    limited to navigation (route names only) and console errors (scrubbed) — no XHR/fetch URLs with ids, no UI-click text.
> 3. Staging only: environment "staging"; enabled only on the staging/review build (never on any production host).

## Where, and when it is on

| Part | Sentry project (DSN) | On when | Code |
|---|---|---|---|
| App (browser) | `…/4512221234724864` | a **test build** (`npm run build:test`, app/dist-test) opened on **staging.fincom.live** (the React preview and the review build). A live build (`npm run build`, app/dist) does not contain the Sentry code at all, and its page's CSP does not allow Sentry's address. | app/src/sentry.js, loaded by app/src/main.jsx |
| Cloud (tally-ingest) | `…/4512221235118080` | the function's `SUPABASE_URL` is the staging project (qbocskaiewaxqcvaunzc). Any other database: off. | server/_shared/sentry.ts, used by server/tally-cloud/index.ts |
| Bridge (Go) | `…/4512221235642368` | the bridge's settings say `"CrashReports": true` **and** its `CloudUrl` is the staging project's. Off by default; never for a bridge connected to another cloud. Read at the bridge's start. | bridge-go/crash.go |

DSNs are Sentry's public client keys; they are in the code.

## What an event can carry (the exact list)

Built by `scrubEvent` in server/_shared/sentry-scrub.js (app and cloud) and `crashScrub` in bridge-go/crash.go (bridge).
Any other field is dropped.

| Field | What is in it |
|---|---|
| `event_id`, `timestamp` | Sentry's random id of the event, and when |
| `platform`, `level` | `javascript` / `go`; `error` / `fatal` |
| `release` | `fincom-app-<git commit>`, `tally-ingest-2.4.0`, `fincom-bridge-<bridge version>` |
| `environment` | always `staging` |
| `exception.values[]` | `type`: an error class name (`TypeError`, `runtime.boundsError`, `panic`), else `Error`; `value`: the message, **scrubbed** (below); `mechanism`: `type` and `handled` (bridge: also Sentry's `exception_id` number); `stacktrace.frames[]`: `filename` (a script's address without query or hash, or a code file's name with at most one folder; never a user's folder), `function` (a name from the code), `module` (a Go package path), `lineno`, `colno`, `in_app` |
| `message` | the message of a message event, scrubbed (not used today) |
| `breadcrumbs[]` (app) | `navigation` with `data.from` / `data.to` page names (`client/invoices`, `home/tally`), and `console` errors with their words scrubbed (never their arguments); at most 30 |
| `tags` | `route` (app: the page's NAME, e.g. `client/export`); `guard` (app: the part of the page that failed, a fixed name such as `this screen`); `where` (cloud, bridge: a fixed name of the place in the code, e.g. `posting_window`, `heartbeat`); `kind` (cloud: the request's kind, e.g. `beat`); `firm` (cloud: a 12-character SHA-256 hash of the firm's id, never the id); `install` (allowed, not set today) |
| `user` | app: `id` only, a random 32-hex id made in this browser (localStorage `fincom.sentry.install`); bridge: always empty `{}` (sentry-go writes it); cloud: none |
| `request` (app) | `url`: the page's scheme, host and path only (ids in the path become `:id`); `headers`: `User-Agent` only (browser and OS) |
| `contexts` | cloud: `runtime` `{name: deno, version}`; bridge: `os` `{name: Windows, version: "Windows 11 Pro 23H2 (build 22631)"}`; app: none (Sentry reads the browser from the User-Agent) |
| `sdk` | `name`, `version`, and `settings.infer_ip = "never"` (Sentry is told not to work out an IP address) |

The envelope around an event carries Sentry's own header (`event_id`, `sent_at`, `dsn`, `sdk`, and in the browser the
trace context: `trace_id`, `public_key`, `environment`, `release`). Each envelope holds one item, of type `event`.

### How a message is scrubbed

Each word of an error message is kept only when it is a known word of error messages (a fixed list, the same in
sentry-scrub.js and crash.go, tested equal), a number of one or two digits, a known acronym or product name (JSON, HTTP,
GST, FinCom, Tally, …), an error class name, or a name from code (camelCase, snake_case, a.b.c). Every other word
(names, GSTINs, PANs, amounts, bill numbers, emails, addresses, ids, file names) becomes `…`; markup (Tally's XML) is
dropped whole; at most 300 characters. So `Ledger 'Zeta Supplies Ltd' does not exist` goes as `Ledger … does not exist`,
and `Cannot read properties of undefined (reading 'vendorName')` goes as it is.

## What is never sent

Party, ledger, company or client names; amounts; GSTINs, PANs; narrations; bill numbers; Tally's answers or XML; form
field values; uploaded files or their names; request or response bodies; addresses' query strings or hashes; a person's
email, name or IP address; the computer's name (`server_name` is dropped); folders on a disk; log lines; extra data or
other contexts; fingerprints; modules; screenshots, view hierarchies or attachments; session replays; user feedback;
performance traces; sessions; client reports. The app's Sentry has no default integrations: only global error handlers,
linked errors, dedupe, browser API error wrapping, and breadcrumbs with **console only** (no clicks or typing, no XHR or
fetch, no history). `sendDefaultPii` is false everywhere.

The cloud never hands the request (body, address, headers) to Sentry; a database error goes with its code and scrubbed
message only (never `details` or `hint`, which carry rows' values). The bridge reports only a panic it recovered: its
loops (heartbeat, light check, posting job, keeping in step, recorder, the main loop, switching to the main bridge) and
the bridge itself; never a log line, and no request to Tally is changed or added.

Floods are cut: cloud, the same error at most once a minute and at most 30 reports a minute per instance; bridge, the
same panic at most once an hour and at most 30 an hour.

## How to turn it off

- **One browser**: in the browser's console on the staging site, `localStorage.setItem("fincom.sentry", "off")`, then
  reload (`localStorage.removeItem("fincom.sentry")` to turn it back on).
- **A whole app build**: build it with `FINCOM_SENTRY=off npm run build:test` (the Sentry code is left out, and the page's
  CSP does not allow Sentry's address). A live build never has it.
- **tally-ingest**: set the function's secret `FINCOM_SENTRY=off` on the staging project (Supabase dashboard, Edge
  Functions, Secrets), or redeploy without it; on any other database it is off already.
- **The bridge**: leave `"CrashReports"` out of the settings file, or set it to `false` (the default), and restart the
  bridge.
- **Everything at once**: in Sentry, disable or delete the three DSNs (Project settings, Client Keys); nothing reaches
  Sentry after that, whatever the builds do.

Recommended in Sentry's project settings for the three projects (not done from here): Security & Privacy, "Prevent
Storing of IP Addresses" on, and "Data Scrubber" on with the defaults, as a second net.

## Deploying

- App: nothing more than the usual test build (`app/publish-preview.sh`); `@sentry/browser` 10.75.1 is in
  app/package.json (pinned) and bundled by Vite into its own chunk of the test build.
- tally-ingest: deploy with `../_shared/sentry.ts` and `../_shared/sentry-scrub.js` beside `../_shared/cors.ts` and
  `../_shared/names.js` (server/_shared/README.md).
- Bridge: `github.com/getsentry/sentry-go` v0.45.1 is in bridge-go/go.mod; nothing changes for a bridge whose settings
  do not ask for crash reports.

## Tests (each fails CI if business data could leave)

| Test | What it checks |
|---|---|
| tests/run_sentry_scrub.mjs | the shared scrubber: realistic events, breadcrumbs and stack frames carrying made-up GSTINs, PANs, amounts, names, narrations, Tally XML, emails, file names and ids in URLs (tests/fixtures/sentry-sensitive.json); none survives, only the allowed fields; the app and the cloud use it; the app has no replay, feedback, tracing or XHR/fetch/click/history breadcrumbs |
| tests/run_sentry_ui.py | the React test build in Chromium: errors forced on the Bills, Post to Tally and Tally pages of a made-up client; Sentry's ingest address routed to the test; no made-up data and no replay item in any envelope, only allowed fields; nothing sent off the staging host or with the switch off |
| tests/run_sentry_cloud.mjs | `deno test server/tally-cloud/sentry_test.ts` (the envelope tally-ingest would post: no business data, the firm as a hash, staging only, floods cut, unhandled errors) and `deno check` |
| bridge-go/crash_test.go | the envelope the real sentry-go transport posts to a stand-in Sentry: no business data, no log line, no folder, only allowed fields; off unless enabled and on staging; the word list equals the shared scrubber's |
