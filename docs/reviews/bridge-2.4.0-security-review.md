# Security review: FinCom Bridge 2.4.0 (2.3.4 and 2.3.5 with the 2.4.0 items, one release from 2.3.3)

Reviewed: 09-Oct-2026, alongside the code review of the same range (bridge-2.4.0-code-review.md): the security review
of release-240 against the published 2.3.3 (tax-accuracy), then the check of its fix by the independent reviewer.

## What 2.4.0 does

- The entry request FinComVoucherObject (2.3.4), stripped to the approved fields in the bridge; FinComVoucherByNumber
  asks the whole TDS list (the owner's decision of 2026-10-07); no other request added or changed.
- Each Windows user's own recorder file; held lines under FinCom's read stop; the outbox; renumbering; bank dates; the
  nightly self-check; clear notifications; the pages live (Realtime); Sentry on staging.
- Migrations 62 to 70 (69 not in this release) and tally-ingest's new kinds and beat fields.

## What holds

- **No new local HTTP route.** The bridge's local server has the routes of 2.3.3; the new work runs inside the bridge.
- **Fixed file names.** The bridge's new files (renumber.json, recorder-wait-starts.json, recorder-master-types.json,
  the per-user recorder files read by name pattern) are fixed names under its own folders; no name is taken from Tally
  or the cloud as a path.
- **Tally requests.** A MasterID is digits only, 1-18, no leading zero; the company is escaped; every request is checked
  byte for byte against the allow-list's builders; the entry requests go only right after Tally's company list names
  the company (Tally crashes on an object export naming a company that is not open).
- **New cloud fields validated.** Every new beat field (recorderWaitSince, recorderWaitStarts, renumberAlerts, the bank
  and stuck-line words) is checked in tally-ingest for type, set, length and count before it is kept; anything else is
  dropped.
- **SQL.** Every SECURITY DEFINER function sets search_path = public, pg_temp; the service functions are granted to the
  service role only; alert_dismiss / _undo / _list check the member and act only on the person's own rows.
- **RLS on new tables.** tally_book_changes, tally_selfchecks, tally_recorder_masters and app_alert_dismissals: RLS on,
  read by the firm (dismissals: the person's own), no write for authenticated (70 revokes INSERT on dismissals).
- **Realtime.** The publication gets tally_book_changes and three small tables, each with its firm read policy; no code
  removes their rows, and a delete by cascade (a book removed) sends only keys (S-L1).
- **Sentry.** Staging only (the host checked in the app, the cloud and the bridge; the bridge also needs CrashReports on);
  every event rebuilt from an allow-list; no request bodies, user, IP, cookies or query strings; only code identifiers
  kept from free text; the firm's id hashed. The DSNs are public by design (they only accept events).
- **No secrets** in the code, tests or fixtures; the dependencies pinned (@sentry/browser 10.75.1, sentry-go in go.sum).

## Findings

- **S-M1 (Medium), fixed in eed48720.** tally-ingest's "selfcheck" and "renumber_list" answered a computer for any
  linked company of its firm. They now answer only for a company the computer named in its own last heartbeat or has
  sent recorder lines for (deviceNamed), and database errors give fixed words (dbFail). Verified by the independent
  reviewer: the check is in place for both kinds before any read or record, and tests/run_company_scope_server.py
  covers both. A computer can still name any company of its own firm in its own heartbeat (it writes the beat with its
  own key): that gives it nothing it did not have, since the same key could already send recorder lines for any linked
  company of the firm. Low; for the next release: tie a company to a computer on the server's side (that also scopes
  recorder_lines).
- **S-M2 (Medium), covered here.** 2.3.4's late fixes and 2.3.5 were not published on their own and had no security
  review of their own; this review covers them in the range below.
- **S-L1.** Realtime sends a deleted row's keys to every subscriber; only a cascade (a book removed) deletes rows here.
- **S-L2.** The beat broadcast channel fincom-tally-<firm id> is public (private: false, since 2.1.x): it carries company
  names, and 2.4.0 adds recorderStuck (company, count, since, day). Anyone with the public anon key and a firm's id can
  listen. For the next release: private channels.
- **S-L3.** The new kinds have no load or rate limit of their own beyond the bridge's pacing.
- **S-L4.** Raw database errors in answers: fixed for selfcheck and renumber_list (eed48720); other kinds keep theirs.
- **S-L5.** alert_dismiss caps a call at 500 but a person's rows have no total cap.
- **S-L6.** Migration 66's grants are written differently from 65's (both minimal; 66 revokes explicitly).
- **S-L7.** The per-user recorder files sit in one folder every Windows user can write (unchanged from 2.3.x; the
  bridge takes a line only for its own user and its own open Tally).
- **S-L8.** A line FinCom keeps refusing is sent again every 30 minutes for ever (the owner's "nothing lost").
- **S-L9.** A camelCase word (a name written as rajeshKumarGupta) still passes the Sentry scrubber.

The other Lows (all but S-L4 for those two kinds) go to the next release.

Range: 2bf4011d..eed48720
