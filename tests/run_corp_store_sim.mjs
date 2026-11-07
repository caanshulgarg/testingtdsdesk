// node tests/run_corp_store_sim.mjs - Corporate's store (app/src/screens/corp/store.js) after the review of 263c13939: each
// scenario of tests/corp_store_sim/ in its own process (a fresh store), on a stand-in of the server (made-up rows only).
//   a_selfping  1  no read of its own ping; an edit after the save saved
//   a_reread    1  a read again: not "loading", editable, an edit during it kept and saved; a failed read again: editable
//   a_early     1  an edit before the first read is in: kept, saved once it is in
//   b_lay       3  removed on another computer with an edit here: kept, "Removed on another computer...", Restore / Discard
//   c_dropnew   5  a removal while the first POST is on its way: waits, one conditional DELETE
//   d_order     4  a read older than a save is never laid over it
//   e_exhaust      another computer saving on every try: said, saved on the back-off
//   f_tabs      1  two tabs; typing every 500 ms: nothing lost
//   g_none      2  a table not there: edits refused, no loop; 7 Retry with nothing to send: nothing sent, no ping
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const dir = join(dirname(fileURLToPath(import.meta.url)), "corp_store_sim");
let bad = 0;
for (const s of ["a_selfping", "a_reread", "a_early", "b_lay", "c_dropnew", "d_order", "e_exhaust", "f_tabs", "g_none"]) {
  console.log(s);
  const r = spawnSync(process.execPath, [join(dir, s + ".mjs")], { cwd: dir, encoding: "utf8", timeout: 30000 });
  process.stdout.write(r.stdout || ""); if (r.stderr) process.stdout.write(r.stderr);
  if (r.status !== 0) { bad++; console.log("  FAIL " + s + " (exit " + r.status + ")"); }
}
console.log("\n" + (bad ? "FAILED: " + bad : "all passed"));
process.exit(bad ? 1 : 0);
