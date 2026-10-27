# Deploying an edge function as uploaded files from one commit

From 26-Oct-2026 (security audit M1) no edge function is deployed as a one-line
`import "https://raw.githubusercontent.com/caanshulgarg/testingtdsdesk/<sha>/server/…/index.ts"`.
Once the repository is private, that import gets a 404 at deploy time. New versions and rollbacks would then fail.
The running versions keep working because Supabase bundled the fetched modules when they were deployed.

Each function is deployed with its files uploaded, taken from one commit. The commit, the entry module and `verify_jwt`
for each function are in `tools/fn-files.json`. `tools/fn-files.js` follows every relative import from the entry module,
including `server/_shared/*`, `app/src/calls/rules.js`, `app/src/lib/mis*.js` and `src/js/78-reports.js`.
It reads the files from the git objects of the commit, not from the working tree, so local edits never go out.

Each deploy has:

- `index.ts` at the top. It is a two-line wrapper: `import "./server/<fn>/index.ts";`, or
  `import { main } from "./server/<fn>/index.ts"; main();` for modules that serve only when they are the main module
  (`import.meta.main`). This keeps the behaviour of the old one-line import.
- every file it reaches, under its path in the repository (`server/…`, `app/…`, `src/…`). The relative imports
  therefore resolve exactly as they do in the repository.
- remote imports (`npm:`, `jsr:`), which Supabase still fetches and bundles at deploy, as before.

## Steps (staging first)

```sh
node tools/fn-files.js list tally-ingest                 # files, git blob, sha256, remote imports
# 1. note the version now serving (the rollback): Supabase MCP list_edge_functions, or the dashboard
# 2. deploy, by either route:
SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=qbocskaiewaxqcvaunzc node tools/fn-files.js deploy tally-ingest
#    or: node tools/fn-files.js payload tally-ingest --out /tmp/p.json, and pass its name / entrypoint_path /
#    verify_jwt / files to the MCP deploy_edge_function call (practical only for small functions: every byte goes
#    through the call)
# 3. read it back (MCP get_edge_function, saved as JSON) and compare every file with git:
node tools/fn-files.js verify tally-ingest /tmp/readback.json   # "ok" per file, no EXTRA, no RAW-IMPORT
# 4. probe without a sign-in: the function's own refusal (401/403/400), never 5xx, e.g. from SQL:
#    select net.http_post('https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/tally-ingest', '{}'::jsonb);
#    select status_code, content from net._http_response where id = <that id>;
# 5. if the probe fails: deploy the previous version again (rollback), and stop
```

To move a function to a newer commit, change its `sha` in `tools/fn-files.json` in the same change, and write the old
sha and version in the commit message as its rollback.
With the Supabase CLI the same files can be deployed from a checkout of that commit, by copying the tree under
`supabase/functions/<fn>/` with the wrapper as `index.ts`.

## Functions

| Function | Entry | Files beside the wrapper (at the commit in fn-files.json) |
|---|---|---|
| fincom-call | server/video-calls/index.ts | video-calls/handler.ts, fincom-transcribe/{index,names}.ts, assistant/{models,router,entries,mask}.ts, _shared/{cors.ts,assistant-labels.js}, app/src/calls/rules.js |
| tally-ingest | server/tally-cloud/index.ts | tally-cloud/{parse,monthpack}.js, _shared/{names.js,cors.ts,sentry.ts,sentry-scrub.js,tallyname.js} |
| gst-2b-match | server/gst-2b-match/index.ts | gst-2b-match/{match,handler}.ts, assistant/{models,router,entries}.ts, _shared/{match2b.js,assistant-labels.js,cors.ts} |
| fincom-assistant | server/assistant/index.ts | 25 files of server/assistant (and tools/), _shared/{cors.ts,sentry.ts,sentry-scrub.js,misdef.js,assistant-labels.js}, src/js/78-reports.js, src/js/80-assets.js |
| tds-challan-match | server/tds-challan-match/index.ts | tds-challan-match/{match,handler}.ts, assistant/{models,router,entries}.ts, _shared/{tdsmatch.js,assistant-labels.js,cors.ts} |
| fincom-transcribe | server/fincom-transcribe/index.ts | fincom-transcribe/names.ts, assistant/{models,router,entries,mask}.ts, _shared/{cors.ts,assistant-labels.js}, app/src/calls/rules.js |
| mis-run | server/mis-run/index.ts | mis-run/{handler,data,pdf}.ts, _shared/{cors.ts,misdef.js,misledger.js,misageing.js}, app/src/lib/{misCustom,misXlsx}.js |
| zoho-books | server/zoho-books/index.ts | zoho-books/map.js, _shared/{cors.ts,names.js} |
| gst-taxpro | server/gst-taxpro/index.ts | gst-taxpro/{automatch,filing}.ts, _shared/cors.ts |
| signup | server/signup/index.ts (deployed as index.ts + handler.ts) | handler.ts; Deno tests: `deno test server/signup/handler_test.ts` |

`node tools/fn-files.js list <fn>` gives the exact list. It is the authority; this table is a guide.
