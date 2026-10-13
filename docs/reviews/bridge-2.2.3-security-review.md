# Security review: FinCom Bridge 2.2.3 (the tray's "Test fetching an entry"; live files named d-Mon-yy)

Reviewed: 05-Oct-2026, alongside the code review of the same range (bridge-2.2.3-code-review.md), which has the
details. One round (the owner's rule). The bridge sources are read with `git diff b266f4f <to> -- bridge-go/
docs/tally-allowlist.md`.

## What 2.2.3 does

- "Test fetching an entry": a tray item, behind the owner's "Trial tools on this computer" switch, that sends six
  test-only requests (FinComFetchTestA..F) for one voucher the person names, one at a time, and logs Tally's answers
  locally.
- Live add-on files named `<GUID>-d-Mon-yy.txt` are read and dated by their name.

## What holds

- **Started by a person only.** /tray/fetchtest refuses a request carrying Origin or any Sec-Fetch header (any web
  page, FinCom's own included), and needs the trial tools on; the bridge never starts the test by itself.
- **New requests are narrow and test-only.** FinComFetchTestA..F are measure-only (refused unless the test is sending),
  pinned to their builder (a request that is not exactly as built is refused) and classified, so the dated ones go only
  as a person's. Each asks one voucher by type and number, or by one MasterID; no day's list, nothing computed (the
  fields are the body fetch's). The bridge's own exception ids are not widened.
- **Inputs cannot change the request's shape.** Type and number refuse quote marks and control characters and are
  escaped; the date must be a real day; a MasterID is digits only.
- **Availability.** One request at a time through the Tally lock, 25 s cap each, never started during a posting and
  stopped before the next form when one starts; one test at a time.
- **Nothing leaves the computer.** The answers go to the local log only (400 characters of each, ids of 5 vouchers at
  most); nothing to the cloud, nothing kept.
- **File names.** The new date form only dates a file; a line is still taken only when its company GUID starts the
  name and the recorder folder passes its check.

## Round 1 (b266f4f..99e75eb)

- **M1** (code M1). The measuring flag stayed raised while the test waited up to 10 minutes for the person's MasterID:
  the measure-only gate was open for any caller and the self-watch's stop (a request over the limit, Tally silent) was
  suspended for the recorder's background reads. Fixed test-first (f6ce242 red, e23e03b): measuring is raised around
  each form's send only.

No High. Lows L1 to L4 in the code review, none with a security effect; for the next build.

## After the round

4137429: the version, the pins and the allow-list decision line (the owner's decision of 2026-10-05 for 2.2.3). No
finding.

Range: b266f4f..4137429
