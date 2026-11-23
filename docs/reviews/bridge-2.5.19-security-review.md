# Security review: FinCom Bridge 2.5.19 (heavy days in MasterID bands; the FinCom Books masters reads; the added ledger and entry fields; the daily tie-out; the look for FinCom's mark before a re-sent entry; the tray icon started again after Quit)

Status: independently reviewed 23 Nov (read-only; targeted tests and throwaway checks outside the repository) at
edad89a1c; no blockers.

Range: b64a6d398..edad89a1c (next-bridge-2519: 7ad1de38c A, f36e21443 / 2b8ccdcec / a7174e47e the drafts and the owner's
decisions, 30213f864 B1, C1-C8 and E, 07db5d1b4 the cloud's "bands", edad89a1c E on a job handed back again)

Areas for the reviewer (no finding details are written here; the repository is public):
- The seven new allow-listed reads: FinComDayHeadsPart (one day, a MasterID band), FinComBillOpenings,
  FinComVoucherTypes, FinComCostCentres, FinComCostCategories, FinComGstRegistrations, FinComGroupClosing; their pins,
  their request classes and the dated gate's exceptions for them.
- The changed shapes: FinComLedgers, FinComLedgerChanges and FinComLedgerByName (fields added at the end of the FETCH,
  two lists behind a switch) and FinComVoucherBatch (ISPOSTDATED at the end; the fast window keeps 2.5.18's FETCH).
- E: FinComTag let through while ReadDays is off, for exactly the look before a re-sent entry's first part.
- The tray icon started again by the service 10 minutes after Quit (win_service.go, trayquit2519.go).
- New files and data: tieout.json, the "books" object in the ledger outbox, the 19th ledger column; the cloud's
  period_heads "via".

## What was checked

- Pins. Each new id has one builder and is rebuilt from the request's own parameters (company, the one day or the
  financial-year start and day, the MasterID range) and compared byte for byte (pinnedToBuilder), after checkAllowed's
  id, collection and report checks. Company names are unescaped then re-escaped, so only the canonical form passes and
  markup in a name stays text. The band and range numbers are re-formatted from parsed values: leading zeros, signs,
  values past int64 and values past float precision all rebuild differently and are refused (fail closed); the band
  pattern caps each bound at 18 digits and refuses a band whose upper end is below its lower one. A randomised check
  of about 47,000 mutated requests over the seven new ids and the changed ledger and batch shapes (case changes,
  spaces and line breaks, comments, CDATA, numeric and named entities, an extra attribute, an extra FETCH field, an
  extra SYSTEM formula, Export changed to Import, a second envelope, huge and negative bounds, a widened filter) let
  nothing through except a different company name. Go's regular expressions are linear-time.
- Read only. All seven are Export / Collection requests with ISMODIFY="No"; none carries an Import, an ACTION or a
  TDL function beyond the fixed filters (MasterID comparisons, $IsBillWiseOn, $Parent = ""). FinComGroupClosing asks
  Tally for a computed figure (CLOSINGBALANCE) of the primary groups only; its rows are dropped again by the bridge
  if they carry a parent, whatever the filter did.
- Who can send them. Every builder takes its parameters from the bridge's own state (the keep run's company, the
  company check's span, the ledger read's MasterID cursor, the books-from); no cloud job carries request text, and the
  cloud's settings route can set none of the Confirmed2519* switches (config.go sets a fixed list). FinComDayHeadsPart
  passes the dated gate only as the band of the day being read in bands now, under the 2 s stop; FinComGroupClosing
  only as today's tie-out request while it is being asked (a 5 s limit, another day or another company refused,
  checked); FinComBillOpenings only with the books' first year, as the ledger requests; the four master reads are
  undated (checked: no period in any spelling).
- E. FinComTag passes with ReadDays off only for a TC built by resentLook and only while that exact request is
  registered (checked: the same request from any other TC, or the look's TC with another request, is refused). The
  date comes from the job's own voucher, which FinCom could already post; only rows of that date are used, nothing of
  the day's other entries is stored, sent or logged; what goes back is the head of an entry carrying the job's own
  FinCom mark. It runs after the job's company check (own Tally, GUID) and lease. It cannot read another kind of data;
  it can read one date's heads per distinct date in the job, once per job. See L1 for the copy.
- Tray restart. Unchanged mechanism: only active sessions whose user is the owner (sameUser), the session's own token
  (WTSQueryUserToken), the bridge's own executable path quoted, the default desktop. Quit now delays the start by 10
  minutes instead of until sign-out; a signed-out session forgets its Quit. The session number in /tray/quit and
  /tray/idle still comes from the tray's body behind the tray's one-use proof (I3 of 2.5.18), so a tray can only delay
  or hasten the owner's own icon. No privilege change; builds for windows.
- Own Tally, tally.ini. No change reads tally.ini or a shared folder; the new reads use the keep run's port (own rule
  unchanged) and the look the job's checked port.
- Files. tieout.json is one fixed name in the sync folder, written with the same helper; company names are JSON keys
  only; only "day" is read back (a changed file can at most skip or repeat a day's tie-out). The books object and the
  19th ledger column go to the outbox file as before.
- Logging. The new lines give counts, days, MasterIDs and the bridge's own words; a refusal or Tally error quotes at
  most 120 to 160 characters of Tally's answer, as the existing reads do; E's line names the found entry's type,
  number, date and GUID, as the duplicate check's does. No secret is logged; addresses, pin codes and GSTINs are not
  logged.
- Cloud (server/tally-cloud/index.ts). periodHeadsVia maps anything but "split" to "day", as before; "bands" adds no
  new trust in the bridge (a bridge could always say "day"). The bands are contiguous with an open-ended last band and
  every row is checked against its day and band before the day counts as whole. The cloud does not yet read "books" or
  tieout_groups in this range.

## Findings

- L1 (low, integrity of this computer's copy; not a leak, nothing reaches Tally): when E finds the job's FinCom mark
  in Tally, confirmedInTally (resent2519.go:118, safety.go:525-531) puts the job's own voucher XML into the copy
  (posted-in.jsonl, then the day file) under the found entry's GUID and current AlterID. The "FinCom id" path has no
  content check (only the "voucher id" path calls headMatchesXML). A re-sent entry may differ from what Tally holds
  (FinCom changed it before handing it out again, or the person edited it in Tally after the first post), and an entry
  carrying the mark may not be the one sent; the copy then shows FinCom's version at Tally's AlterID, so the keeper
  does not read it again until the next edit. Before 2.5.19 confirmedInTally had no caller; the duplicate check's own
  tag hit writes nothing to the copy. Suggest: on a hit, record only the posted-ids entry and leave the copy to the
  keeper (or mark that day to be read), or add the XML only when headMatchesXML holds.
- I1 (info): E lets a job cause one FinComTag read per distinct date among its re-sent entries while ReadDays is off;
  each is under the 2 s stop with the posting's priority and its rows are filtered to that date. Bounded by the job's
  size; FinCom could already post on those dates. Optional: cap the dates looked at per job.
- I2 (info): FinComCostCentres fetches every cost centre, employees included, and drops FORPAYROLL rows in the bridge.
  If a Tally version does not answer FORPAYROLL as Yes for an employee, employee names would go to FinCom on this path
  (FinComEmployees already sends them with payroll on). Worth one look on ZZ TEST alongside the confirmations.
- I3 (info): the ledger rows now carry party addresses, pin codes and countries to FinCom (the owner's decision C7);
  privacy wording, not a code issue.
- I4 (info): Quit now brings the icon (and background reading) back after 10 minutes; a person who wants it away for
  longer must pause reading instead. The owner's decision; the tray's words should say so.

## Tests run

`go test -count=1 -run 'TestR2519|AllowList|Pinned' .` passed at edad89a1c; `GOOS=windows go build` and `go vet`
clean. Throwaway checks (in a temporary test file in the review's own worktree, removed): the randomised pin mutation
above; band and range bounds of 2^53+1, 2^63-1, 2^63, 2^64 and 10^23 refused; the gates with ReadDays off:
FinComDayHeadsPart with no day in bands refused, FinComGroupClosing outside the tie-out, with a 5 s limit or for
another day refused, FinComTag from an ordinary TC or an unregistered look refused, the registered look let through,
the master reads let through.

## Verdict

No critical, high or medium finding. The seven new reads and the four changed shapes are pinned byte for byte, read
only, built from the bridge's own state and reachable by no cloud content; the gate exceptions are each tied to the
one request in flight. E's exception reads nothing but one date's marks for the job's own entries. L1 should be fixed
(or accepted by the owner) before the build is handed out; it does not block on security grounds. The requests remain
"NOT yet measured" and the switched names unconfirmed, as the build commit says.

## Fixes after the review (in 315b08c78, bridge-go only; to be re-reviewed)

Range of the fixes: edad89a1c..315b08c78

- L1: FIXED. When the look finds the mark, only this computer's record (posted-ids.json, noteVerified) is written;
  the entry goes into the local copy only when headMatchesXML holds (type, date and party), else the keeper reads it.
- I1: FIXED. At most 7 distinct dates are looked at for one posting; the entries of further dates are held for a
  person (TestR2519ResentDatesCapped).
- I2: FIXED. Besides FORPAYROLL rows, the bridge drops employee groups (ISEMPLOYEEGROUP) and every centre under one, at
  any depth, before anything is kept, logged or sent. Not by cost category: payroll often uses the Primary Cost
  Category, which every other centre shares, so that would drop every centre. A ZZ TEST check is in the test sheet
  (item 4) and the timing list (C3).
- I3: unchanged (the owner's decision C7; privacy wording).
- I4: FIXED. The tray item reads "Hide this icon (reading continues; the icon comes back in 10 minutes)"
  (TestR2519TrayQuitWords).
