// node run_sentry_cloud.mjs - tally-ingest's reports to Sentry (docs/sentry.md): runs the Deno test
// server/tally-cloud/sentry_test.ts (no business data in what would be posted, staging only, a flood cut) and
// `deno check` of tally-ingest with its Sentry module. Needs Deno (DENO, else on the PATH); on CI (GITHUB_ACTIONS) a
// missing Deno FAILS, so the check can never pass by being skipped there.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const which = spawnSync("sh", ["-c", "command -v deno"], { encoding: "utf8" }).stdout.trim();
const deno = process.env.DENO || which;
if (!deno) {
  console.log(process.env.GITHUB_ACTIONS ? "  FAIL Deno is not installed (CI must run this test)" : "  skipped: no Deno here (set DENO=/path/to/deno)");
  process.exit(process.env.GITHUB_ACTIONS ? 1 : 0);
}
let fails = 0;
const run = (args, what) => {
  const r = spawnSync(deno, args, { cwd: ROOT, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  const out = (r.stdout || "") + (r.stderr || "");
  console.log(out.split("\n").filter((l) => /ok|FAIL|error|passed|failed|Check/i.test(l)).slice(-40).join("\n"));
  console.log((r.status === 0 ? "  ok   " : "  FAIL ") + what);
  if (r.status !== 0) { fails++; console.log(out.slice(-4000)); }
};
run(["test", "--allow-read", "server/tally-cloud/sentry_test.ts"], "deno test server/tally-cloud/sentry_test.ts");
run(["check", "server/tally-cloud/index.ts", "server/_shared/sentry.ts"], "deno check tally-ingest and its Sentry module");
console.log(fails ? "\nFAILED: " + fails : "\nall passed");
process.exit(fails ? 1 : 0);
