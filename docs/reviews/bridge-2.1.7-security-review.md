# Security review: FinCom Bridge 2.1.7

Reviewed: 03-Oct-2026 (night), the diff 27aa360..HEAD read hunk by hunk (bridge-go, release-check.sh, docs/tally-allowlist.md,
server/tally-cloud/migration-42), then re-read after the code-review fixes.

Threat focus: a new local HTTP route reachable from a web page; a new request shape to Tally outside the allow-list;
figures or names leaking into the log; a write path hidden in a "read-only" tool; an installer flag weakening a setting
the owner set by hand; the release check accepting an unmeasured build it should not; the cloud emptying a book from a
read fault.

## Findings
- None high or medium.
- L1 (informational): runReadTest raises the `measuring` counter while it runs, which is also the window in which the
  allow-list's measure-only rows are not refused. Nothing else sends those rows (the measure tool is the only sender and
  is person-started), and the read test sends three fixed requests; noted, no change.
- L2 (informational): the read test's log line carries the answer's first 200 characters as tags only (answerHead:
  attributes and every value removed). A tag name is Tally's schema, not a figure or a name. Tested (no digit, no name).

## Found safe
- /tray/readtest: the generic /tray/ gate and the route both refuse any request carrying Origin or a Sec-Fetch header
  (403); the X-Bridge-Key is required as for every local route; POST starts, GET reads state; nothing in the body is used
  but an optional company name, which goes through findCompanyPort (an unknown company is an error, not a request).
- No new request shape: dayBookRequestDMY keeps REPORTNAME "Day Book" (the allow-list id) and only renders the dates
  differently; FinComTag is the existing read-back request; both go through invokeTally (allow-list, read stop, probe
  hold, one request at a time). TestNoComputedFigure and TestEveryRequestOnList unchanged and green.
- The read test writes nothing: no file, no keep state, no cloud call (asserted by TestReadTestThreeRequestsLogged on the
  day file bytes, the .full marks, cloud-out.txt and the fake cloud's call counts).
- Round-12 guard: fails closed (an untrusted answer is kept nowhere and sent nowhere); the FinComTag confirmation on the
  third try only lowers the guard when a second, independent request kind agrees the day is empty; the cloud's
  second-read rule and 24-hour cap (migration 42) still stand behind it.
- Installer POSTONLY="any": only an installer-marked list is cleared; the result is marked the owner's so a later
  installer cannot re-impose a list; a hand-set list is never touched. The owner's decision for 2.1.7 is "post to any
  company": PostOnly is a per-computer policy, not a security boundary (the cloud's own checks on a posting are
  unchanged: the device key, the firm, the company linked to one of the firm's clients, the FinCom-id uniqueness).
- Release check: the exception line must name this BridgeVersion and carry the owner's decision words; it cannot be
  satisfied by a stale line (another version) or by text without the decision.
- Migration 42: security definer with search_path public, pg_temp; service_role only; add-only; the cap is a refusal,
  never a write; nothing deleted.

## Not verified here
- Tally's behaviour on NWS144 (why the Day Book export lists nothing): the read test exists to gather that evidence.
- The Windows installer on a locked-down computer (no PowerShell, no Run): Windows CI installs the setup on
  windows-2022 and windows-2025 runners, not on a restricted account.
