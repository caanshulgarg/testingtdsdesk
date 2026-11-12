// Sentry FINCOM-CLOUD-STAGING-7 (11-Nov-2026): a ledger rename refused by tally_ledger_rename's own guard is an expected
// answer, not a fault. The guard (migrations 36, 39, 41) rolls the rename back and raises (P0001) when the trial balance
// would change or would not tie, when the book's trial balance does not tie to begin with, or when the old row is kept
// live by the guard; nothing is changed, tally-ingest says so in the round's notes and the log, and the next round asks
// again. Those are left out of Sentry; any other error of a rename (a timeout, a missing function, a key clash) is still
// reported. Tested by renamerefusal_test.mjs (node, no Deno needed).
const REFUSED = [
  /^the trial balance would (change with|not tie after) the rename .*; nothing was changed$/s,
  /^the trial balance of this book does not tie \(.*\); .* cannot be renamed until it does$/s,
  /^rename .* -> .*: the old row is kept live by the guard \(.*\); the merge was rolled back$/s,
];
export function renameRefused(err) {
  const msg = typeof err === "string" ? err : err && typeof err === "object" && typeof err.message === "string" ? err.message : "";
  const code = err && typeof err === "object" && typeof err.code === "string" ? err.code : "";
  if (!msg || (code && code !== "P0001")) return false;
  return REFUSED.some((re) => re.test(msg.trim()));
}
