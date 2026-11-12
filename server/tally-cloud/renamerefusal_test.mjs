// node server/tally-cloud/renamerefusal_test.mjs (no Deno needed): Sentry FINCOM-CLOUD-STAGING-7 (11-Nov-2026). A ledger
// rename that tally_ledger_rename refuses by its own guard (migration 36 / 41: the trial balance would change; the old row
// kept live by the guard, the merge rolled back) is an expected answer: nothing was changed, the round says so and the next
// round asks again. It is not reported to Sentry as an error; any other fault of a rename still is. Made-up names only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renameRefused } from "./renamerefusal.js";

// the guard's words, as migration 41's tally_ledger_rename raises them (P0001)
const tb = { code: "P0001", message: "the trial balance would change with the rename Made-up Rent -> MADE-UP RENT: before -100.00, after -340.00; nothing was changed" };
const kept = { code: "P0001", message: "rename Made-up A -> Made-up B: the old row is kept live by the guard (it has entries); the merge was rolled back" };
assert.equal(renameRefused(tb), true, "the trial balance guard is a refusal");
assert.equal(renameRefused({ code: "P0001", message: "the trial balance would not tie after the rename Made-up A -> Made-up B: before 0.00, after 5.00; nothing was changed" }), true, "36's words (would not tie after)");
assert.equal(renameRefused({ code: "P0001", message: "the trial balance of this book does not tie (the closing balances add up to 5.00, not 0); Made-up A cannot be renamed until it does" }), true, "36's words (a book that does not tie)");
assert.equal(renameRefused(kept), true, "the old row kept by the guard is a refusal");
assert.equal(renameRefused(tb.message), true, "the words alone (a string) too");
assert.equal(renameRefused({ message: "the trial balance would change with the rename X -> Y: before 1, after 2; nothing was changed" }), true, "without the code (an older PostgREST)");
// real faults: reported as before
for (const e of [
  { code: "57014", message: "canceling statement due to statement timeout" },
  { code: "23505", message: "duplicate key value violates unique constraint \"tally_ledgers_pkey\"" },
  { code: "PGRST202", message: "Could not find the function public.tally_ledger_rename" },
  { code: "42501", message: "not allowed" },
  { code: "P0001", message: "no such book" },
  null, undefined, "", {},
]) assert.equal(renameRefused(e), false, "a fault, reported: " + JSON.stringify(e));

// tally-ingest: both places that report a rename's failure (the ledger list's rename, the ledger changes' rename as in
// Tally) leave the refusal out of Sentry and still say it (the notes, the log)
const src = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
assert.match(src, /import \{ renameRefused \} from "\.\/renamerefusal\.js";/, "index.ts imports renameRefused");
const sites = [...src.matchAll(/fail\("ledger_rename", (\w+)\)/g)];
assert.equal(sites.length, 2, "two places report ledger_rename");
for (const m of sites) {
  const line = src.slice(src.lastIndexOf("\n", m.index) + 1, src.indexOf("\n", m.index));
  assert.ok(line.includes("!renameRefused(" + m[1] + ")) fail(\"ledger_rename\", " + m[1] + ")"), "reported only when not a refusal: " + line.trim().slice(0, 160));
}
assert.match(src, /notes\.push\(\("rename " \+ from \+ " -> " \+ to \+ " not made: "/, "the ledger list still says the rename was not made");
console.log("renamerefusal: all passed");
