# FinCom Assistant: adding a tool module (audit, reports)

Branch `ask-fincom`. This is the contract for `server/assistant/tools/audit.ts` (branch `assistant-audit`) and
`server/assistant/tools/reports.ts` (branch `assistant-reports`). The types are in `server/assistant/tools/types.ts`; read
them, they are the source of truth.

## The module

```ts
// server/assistant/tools/audit.ts
import type { ExtTool } from "./types.ts";
export const TOOLS: ExtTool[] = [{
  name: "audit_books",                       // snake_case, unique; audit_* or report_*
  description: "Audit the client's books for a period: ...",   // what the model reads to decide to call it
  input_schema: { type: "object", additionalProperties: false, required: ["from", "to"],
    properties: { from: { type: ["string", "null"] }, to: { type: ["string", "null"] } } },
  task: "heavy",                             // the turn runs on Opus 5.5 at high effort
  label: "books",                            // your tables are FinCom's computations: green
  words: /\b(audit the books|working papers?)\b/i,   // question words that make the turn "heavy" (Opus)
  run: async (input, ctx) => ({ tables: [...], files: [...], forModel: "totals only", aiText: "..." }),
}];
```

Then register it in `server/assistant/tools/index.ts` (one import, one spread; keep the order fixed).

## Rules (the owner's, unchanged)

- `input_schema` is a **strict** schema: every object `additionalProperties: false`, every property listed in `required`
  (use `["string", "null"]` for optional ones), no `minimum`/`maxLength`/`format`. The API enforces it; FinCom still checks.
- **Figures come only from your computations** (SQL through `ctx.rpc`, the book tools through `ctx.book`, or your own
  JS over their results). Never from the model. Return them as `tables` (green when `label: "books"`).
- **The AI writes words only** (commentary, risk ranking, narrative) through `ctx.aiText(prompt)`. It is masked (PANs,
  GSTINs, unnamed parties become tokens), runs on Opus at high effort, is counted against the firm's rupee cap, and the
  answer is labelled amber. Return it as `aiText` (shown as "AI-drafted, review before use"). Pass it totals, not rows.
- **Nothing writes to the books, returns or postings.** `ctx.rpc` runs SQL functions as the signed-in user under RLS:
  only `SECURITY INVOKER` and `STABLE` functions. A table of your own (working papers, the Schedule III mapping, the
  "details for you" form) goes in your own add-only migration with RLS `firm_id = my_firm()` and writes through
  `can_write()`; its number: 77 is the Assistant's (76 is db-speed's, already on staging); take **78 for the audit and 79 for the reports**.
- Files: `ctx.makeFile(spec, name)` (xlsx with formulas and ₹ format, docx with letterhead, pdf on A4: `files.ts`), or
  `ctx.uploadFile(bytes, name, kind)` for your own bytes. Kept 30 days, private to the firm, listed in the chat.
- Long work: call `ctx.progress("Benford: done")` as each check finishes (the panel shows it). The checks are SQL/JS and
  should take seconds; only `aiText` waits on the model. Target 1-2 minutes end to end, immediate by default. The Batch
  API (half price) is only for "Run for all clients overnight" or a user's "Run in background (half price)" choice.
- `forModel`: a short text the model reads back (totals, counts). FinCom masks it. Never more than a few KB.
- `error`: a sentence the model passes to the user when the tool cannot run (no books for the period, missing details).

## What FinCom does with your result

| You return | The panel shows | Label |
|---|---|---|
| `tables` | each as a table under the answer: amounts right-aligned, dates open the entry, Copy, Excel | green "Checked against the books ✓" (label `books`) |
| `files` | a download line per file (kept 30 days) | - |
| `aiText` | a DRAFT card "AI-drafted, review before use" | amber "AI answer, not checked against the books" |
| `forModel` | nothing (the model reads it) | - |

A `ToolTable`: `{ tool, title, columns: [{k, label, t}], rows, summary, basis, period }`; `t` is `text`, `amount`, `int`,
`date` (`YYYY-MM-DD`) or `pct`. Put a `guid` on a row to make its date open the entry.

## Model routing

The model is chosen per turn (`server/assistant/models.ts`): Haiku 5.5 only picks a book tool; Sonnet 5.5 (effort medium)
for chat, general tax and files; Opus 5.5 (effort high) for notices and for any question your `words` match (`task:
"heavy"`). Thinking is adaptive; no forced `tool_choice`; refusals fall back server-side (`fallbacks: "default"`);
the system prompt and the tool list are cached for an hour (so the tool list must be deterministic).

## Your app screen

`src/js/77-audit.js` / `src/js/78-reports.js` (add to `src/js/ORDER.json` after `76-prefiling.js`) and your React screen.
Call your own builder directly from the screen; the chat calls it through your tool. Both must give the same figures.

## Tests

Your own runner (`tests/run_audit*.py|js`, `tests/run_reports*.py|js`) on the made-up fixtures, added to
`tests/ci/tests.txt`. For the chat path, a Deno test like `server/assistant/assistant_test.ts` (MockClaude, the stand in
`tests/assistant_stand.py` / `tests/assistant_supa.py`): your tool's tables to the paisa, the label, and that `aiText`
never carries a figure that is not in your tables.

## The depreciation tool (14-Oct-2026, branch `depreciation`)

`server/assistant/tools/depreciation.ts`: `depreciation_schedule` (client, year, basis: `companies_act` | `income_tax` | `both`),
registered after the reports. Every figure is FAR's (`src/js/80-assets.js`), the same code as the app's Books, Accounts,
Fixed assets & depreciation tab, run over the register the app keeps for the year (and the year before, whose closing is
this year's opening), read by migration 81's `asst_dep_register` (SECURITY INVOKER, STABLE, row-level security). Tables:
by Schedule II class, asset by asset, by income-tax block, the deferred tax working and the suggested journal entry (never
posted); the Excel with live formulas. Without a register for the year it says so and points to the screen. The reports'
`fs_build` and `tax_audit_draft` take the register's classes and blocks the same way (det.far, det.itBlocks, clause 18).
Tests: `server/assistant/tools/depreciation_test.ts` (to the paisa), `tests/run_dep_tool.py` (migration 81 on pg_stand, then
the Deno test on what the function returned).
## Certificates (`tools/certificates.ts`, branch `certificates`)

`certificate_prepare` is the first **firm-wide** tool (`firmWide: true`): it runs with no client open and names its clients
(`ctx.clients`, `ctx.rpcFor`), reads the files uploaded in the chat (`ctx.uploads`, `ctx.readFile`; the panel's Files button,
`<firm>/<client or _firm>/uploads/`, never sent to the model as they are), a client's kept uploads (`ctx.clientFiles`), and keeps
the firm's certificate details, formats and confirmed figures in migration 83's tables (`ctx.store`, written by the function
with the service role). Its questions (`firmWide` tools' words) skip the keyword router and Haiku and run on Sonnet (task
`file`, no web); its answers are never cached. The AI only reads a statement FinCom cannot read (`ctx.aiRead`: Sonnet, low
effort, counted against the cap; a scanned copy is sent as it is, as a notice is), and those figures are labelled "read by
the AI" and checked on their line where the copy has text. Wording: `tools/certificate-templates.json` (one file, every
paragraph "to confirm by the owner"); the arithmetic and reading: `tools/certlib.ts`. Tests: `tests/run_certificates.py`,
`tests/run_migration83.py`, `tests/run_certificates_ui.py`.
