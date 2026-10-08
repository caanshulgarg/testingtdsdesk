# FinCom 2.3.5: release notes

For the owner. Plain words; times are IST. The steps to try it on NWS144 are in `docs/bridge-2.3.5-test-sheet.txt`.
Built on 2.3.4 (branch `release-235`, from `next-fastfetch`), with the branches `next-heldfix`, `next-notify`,
`next-tallypage` and `next-alerts-clear` merged in. `next-connect` (paused) and `next-renumber` (a later release) are
not in it.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.3.5.exe |
| Fingerprint | (filled in when the setup is built) |
| FinCom app | changed: the simpler Tally pages and Clear notifications (below) |
| FinCom's cloud | migration 68 (`server/tally-cloud/migration-68-alert-dismissals.sql`, add-only; already run on staging) and migration 70 (`migration-70-alert-dismissals-tighten.sql`, after 68, add-only: the table written only through `alert_dismiss`, length checks; the owner runs it). Until 68 runs, the app keeps cleared notifications in each browser, with no error shown. tally-ingest unchanged from 2.3.4 |
| Replaces | 2.3.4 (kept on the computer, so the tray can roll back to it) |
| Add-on | unchanged: keep `C:\ProgramData\FinCom\addon\FinComRecorder.tdl` loaded as it is |
| Tally requests | none added, none changed (allow-list table and its hash as in 2.3.4; TestAllowListUnchanged) |

## What changes

### 1. The Tally pages are simpler (FinCom app only)

The owner: "tally option is so confusing that i am also not able to connect properly", and "Entire tally sync and
everything page related tally should be simple to understand.. in tally sync there is a yellow field coming all the
time.. there should be clear flow".

- **The Tally page**: one card per computer and Windows user, with ONE plain status line ("Connected · Tally open:
  GARG SHEKHAR (port 9005) · last entry 2 min ago"). When something is wrong the line names the problem and the one
  thing that fixes it (Resume reading, Make this the main bridge, Download FinCom Bridge).
- **Three steps until the first company is linked**: Install bridge, Connect, Link company, each ticked from the data.
- **Nothing removed**: everything else (requests, stop reading, posting settings, members, recorder, slow companies,
  versions, roll back, every bridge, connection history, install help) is under the card's or the page's **More**. The
  owner-only rules are unchanged.
- **Sync activity has one clear flow**: the permanent yellow "N lines waiting over 2 minutes" box is gone. "Needs you"
  (yellow, the only yellow) lists only lines nothing settles until a person acts, one sentence per company and day with
  ONE action, by what will actually happen to the line: Upload the Day Book for that day; a FinCom id on another Tally
  entry (check for a double posting, then the Day Book); Resume reading (owner); Open the Tally page; Open From Tally;
  Open Tie-out; or Apply now. Lines FinCom or the bridge is still fetching (and that settle by themselves) show quietly
  as "being fetched". Nothing waiting shows nothing. The page and the bell use the same classifier, so they never
  disagree.
- **One vocabulary** on every Tally page, the Books held banner, the bell and the Post page ("Connected", "Tally not
  open on ...", "Reading paused on ...", "Reading stopped from FinCom").

### 2. Clear notifications, everywhere

The owner: "There should be option to clear notifications everywhere.. and **if one time any notification is cleared
then that notification should not appear**".

- **In the app** (bell and page lines): Clear on every bell item, Clear all, and Clear on every page line, with Undo.
  A notification is known by its key and a fingerprint of what it says, so a cleared one does not come back; a new
  problem (other words, or another occurrence) shows. Kept per person in FinCom's cloud (migrations 68 and 70:
  `app_alert_dismissals`), so it holds on
  every device; before migration 68 runs, in this browser. Clearing only hides: it never changes the data it speaks of.
  On a phone (360 and 390 px) the line's words have a full-width line, the buttons a row below, no sideways scroll.
- **In the bridge's tray** (the Windows balloons / toasts): every balloon goes through one gate (`bridge-go/notices.go`).
  Each problem (kind, company, day, computer) is shown at most once; clicked or closed, it is never shown again, also
  after a restart; a new problem still shows once. The tray menu has **Clear notifications**: every current one that
  was shown is cleared and the balloon taken away (a problem still waiting its 2-3 minutes was never seen and still
  shows once when due). The record is per Windows user
  (`%LOCALAPPDATA%\FinCom Bridge\notifications-cleared.json`, 90 days). The icon's colour and tooltip still always show
  the bridge's state. Answers to the person's own menu clicks still come once per click. Details:
  `docs/bridge-notifications.md`.

### 3. Three fixes to held lines under FinCom's read stop (bridge)

Approved by the owner on 08-Oct-2026 with these conditions: "**the delete fix must keep the entry id and never create a
line without it, and the refused-request change must not hide a real Tally failure from the try count**".

1. **A held delete keeps its entry id.** A delete held because this bridge's Tally could not be asked (FinCom's read
   stop, no answer, no starting point) keeps the line's own GUID through the hold, also over a restart. Proven gone
   later, it goes with that GUID, as one proven at once does. A held delete never goes without its GUID: still in this
   Tally, it is held for good and nothing is sent as a delete; a GUID nobody knows is held with the Day Book words; an
   ended or 7-day-old held delete never goes bare (tested: `hs235NoBareDelete`).
2. **Plain words while reading is stopped.** A line held because FinCom's read stop refused its fetch says "waiting:
   reading from Tally is stopped from FinCom; asked again when it is resumed" (by MasterID, by type and number, and a
   delete). The lines sent after the resume carry none of it. Such a line is asked at the first turn after the resume
   (one at a time, after postings and live saves), and while the stop is on a held line is kept past its 7 days (said in
   the log), never dropped silently.
3. **A refused request is not a try, and only that.** Only the stop's own refusal with nothing of the ask sent to Tally
   is not counted. A 2 s stop, a closed connection, an empty answer, or a by-number refusal after its MasterID ask
   reached Tally still count as tries (tested), so a real Tally failure is never hidden from the try count.

2.3.4's rule (the owner's answer B of 08-Oct-2026, "one more ask") is unchanged: a fast request for one entry stopped at
2 s holds the line ("FinCom asks once more at HH:MM"), it is asked ONE more time 5 minutes later, and a second stop ends
it with the Day Book words. That stopped ask counts as one of its two asks (a real Tally failure, never hidden).

## Tally requests

No request to Tally is added or changed. The allow-list table (docs/tally-allowlist.md) and its hash are as in 2.3.4
(TestAllowListUnchanged); only the decision line names 2.3.5, under the owner's standing decision of 2026-10-06 ("no
request on the list and no request shape changed"). The read-stop fix sends the same requests (fewer while reading is
stopped); the notifications are the tray's own and ask Tally nothing.

## Tested

- Bridge: go vet (Linux and Windows); the full go test in both modes; the release check's own test
  (`bridge-go/release_check_test.sh`); the Windows job (`bridge-windows.yml`, including `notices_windows_test.go`).
- Cloud: the cloud tests; migrations 68 and 70 twice and in both orders (`tests/run_migration68.py`, `run_migration70.py`,
  `run_migration_order.py`).
- App: `run_tally_page_simple.py`, `run_alerts_clear.py`, the alerts, Tally, sync-activity and Post-page tests,
  `run_ui_standards.py`, `run_regress.js`. Screenshots before / after in `docs/ui-pass/tallypage/` and
  `docs/ui-pass/alerts-clear/`.

## Not published

Not built and not published. Before the build: the code and security reviews of 2.3.5
(`docs/reviews/bridge-2.3.5-{code,security}-review.md`), then `bridge-go/release-check.sh`.
