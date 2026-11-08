# Security review: FinCom Bridge 2.5.10

Reviewers: the session that built it (self-review), then an independent review at c936bdcf5 (seven items, fixed in
d144a3663: bridge-2.5.10-code-review.md); the fixes are the building session's self-review only.

Range: 1400f77d6..fd11cff34 (released 2.5.9 to the review's fixes, d144a3663, and the first build's withdrawal, fd11cff34: build files moved only)

## Requests to Tally

- None added and none changed; the table's rows are 2.5.9's (allowed for 2.5.10 by the owner's standing decision of
  2026-10-06). The acknowledgement's reasons are the older-entries loop's own conditions; Stop posting's reasons and the
  self-healing code ask Tally nothing.

## Data and the cloud

- The beat's pickups: a book's company name and GUID (as the beat already sends them), the kind, times, the first day,
  a reason code (the words are FinCom's own for it; the bridge's text is never kept), matched to its book by the cloud, the bridge's Windows login without its computer or domain (the owner asked for "on
  <login>'s Tally"; the page already names the login in its connection words). The cloud keeps only those fields, cut,
  markup stripped, at most 20 (run_pickups_ingest.py).
- lastStop: times, a reason code, an exit code, the kind of the last log line (one of eleven words); never the line, a
  company's or a person's name (TestR2510WatchdogStallRestarts). The network fingerprint stays on the computer.
- earlier-hold.json (the bridge's own folder): ports, request names and times only.
- Migration 149: one security-definer function with a fixed search_path, not executable by anon or authenticated; reads
  tally_devices, writes tally_alerts (no computer's name in the words); add-only (run_migration149.py). Not applied yet.

## The local server

- /jobs/cancel: the same checks before it as every address (Host, the owner's Windows user, Origin, the key); its
  refusals carry fixed words only. /ping adds one number (beatSec), as loopSec.

## Processes, tasks, the installer

- The keep-alive task runs as the signed-in user only (InteractiveToken as the user's SID, least privilege), with no
  stored password and no raised rights; it is made from a task file written in the bridge's own folder (0600, removed
  after), its paths XML-escaped and refused when they hold a quote; it starts the bridge at normal priority, never while
  a setup is between its stop and its install; it starts the bridge only when this user's
  supervisor is not running and no setup is stopping it. The per-user uninstall removes it. The installer itself is
  unchanged. Updates and signatures: not touched.

## Verdict

Ship, as far as security goes (subject to the independent review).
