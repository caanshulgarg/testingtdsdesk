# Code review: FinCom Bridge 2.2.2 (every entry fetched from the bridge's own Tally)

Reviewed: 05-Oct-2026, by the reviewers in the Claude Code session, in two rounds and a last check. The bridge sources
are read with `git diff 4dc55ef <to> -- bridge-go/ docs/tally-allowlist.md` from clean worktrees. The app, server and
migration files in the same range (tally-ingest, migrations 51 and 52) are not part of this review; the migrations
have their own notes.

## What 2.2.2 does

One job: a new, altered, deleted or cancelled entry in a linked company reaches the books.

- **The add-on's GUID and AlterID are never trusted.** The owner's NWS144 findings of 05-Oct-2026: a voucher made with
  Duplicate carries the source entry's GUID and AlterID beside its own MasterID, type, number and date.
- **The entry is fetched from the bridge's own Tally**: by MasterID, else by type, number and date.
- **It is accepted only by the rules.** Tally's GUID is its own MASTERID in hex under the company GUID (or, for an entry
  that came by Tally synchronisation or an XML import, Tally's MASTERID is the one asked). Type, date and number match.
  The AlterID is above the starting point and not below the line's own. Tally's GUID, MasterID and AlterID are what is
  sent.
- **Otherwise the line is held, with plain words** (heldWhy), and flagged when its ids did not belong together
  (idsMismatch, lineGuid).
- **The cloud's held-lines list.** The beat's answer carries heldLines: lines FinCom holds without their entry (this
  computer's, 7 days, at most 200). Each joins the bridge's held list once and is asked like any other; the cloud's
  MasterID is only a key to ask by, and every acceptance rule is unchanged.
- **One log line per fetch decision.** Asking (by MasterID or by number), taken (with Tally's GUID and AlterID), held
  (with its words), not asked (FinCom's own posting, a posting going, the fetch off, no starting point, no date or
  MasterID, the same save). The same line and reason at most once in 10 minutes; one line per resolver turn and per
  beat's heldLines; the re-scan always said.
- **Kept because already built and reviewed:** a held line is asked again 20 times at most, then left held with plain
  words; a hard 2 s stop for the recorder's background reads only (never an import, a person's read or the light
  check), with a 30 s cool-down after a stop.

## Moved out of 2.2.2 to a later build

The owner's rule: one job per release. These wait for a later build:
- the company-folder check;
- the add-on per Windows user;
- the add-on writing nothing for companies that are not linked;
- changes to Source B, Source C and the Edit Log.

## Round 1 (4dc55ef..f3a28e2)

Findings (tests first in 0c9e32e, one test per finding, red before the fix; fixed in 09dea31, 7145170 and cbca321):
- **H1.** A voucher duplicated from one FinCom posted copies its narration ("TDSDesk:<id>"), so it took FinCom's
  exemption and was not fetched. Now a voucher saved in a form is always fetched, whatever FinCom id it carries; the
  copied id goes only as lineFid.
- **H2.** A duplicated voucher's pre line alone carried the source's own (agreeing) ids. Now the line's AlterID before
  the save is a lower bound for Tally's: if Tally's entry with that MasterID was not saved after the line, it is not
  taken. The line is asked by number when it has one (created), else held. The later post alone makes no second line.
- **M1.** A new voucher that went with its body was sent again by the next version's re-scan. Lines sent with a body
  are now never re-scanned.
- **M2.** A try was counted when Tally did not answer. It now counts only when Tally answered.
- **M3.** After the hard stop Tally is still working. The background reads now leave Tally alone for 30 s; a person's
  read is not held, and a stop is not Tally's silence nor a busy spell.
- **M4** (as the coordinator corrected it). Tally keeps an entry's original GUID when it came by synchronisation or an
  XML import. Such a GUID is taken when Tally's MASTERID is the one asked and type, date and number match. A GUID with
  the company's prefix must be its own MasterID.
- **L1, L2.** The 2 s limit now counts from the send, after the gentle wait.
- **L3.** A voucher line with no date, or an alteration with no MasterID, is held with plain words.
- **L4.** A pair whose pre line carries another entry's GUID is flagged, and its resolved line keeps the flag.
- **L5.** Fixed in cbca321 with the held-list bounds (tests in bridge-go/review222b_test.go).
- **L6.** recorderSeen counts a daily file only when it holds a valid line of that company GUID (name and GUID in any
  case); the folder is listed at most once in 10 s while unchanged.

## Round 2 (4dc55ef..cbca321)

No High or Medium. Four Lows fixed (tests first in d9abf2f):
- **L-A.** A background read already waiting for the Tally lock when a recorder read is stopped is no longer sent into
  the busy Tally (198b200).
- **L-B.** The light company check and the open-company list are not held by the cool-down (198b200).
- **L-C.** A FinCom id moved to lineFid, or an oversize line, goes without the narration's TDSDesk tag; an oversize
  line also without object_guid and fid (8c7fc09; the cloud's side in 8b783e6).
- **L-D.** The FinCom-import exemption only for a GUID Tally made for that MasterID (8c7fc09; test fixed in 621fff9).

Three Lows accepted, listed for the next build:
- **L-E.** The event's label can flip (created / altered) for a line.
- **L-F.** A line 2.2.1 already resolved can go once more as a duplicate ":resolved" line.
- **L-G.** Entries re-imported into the same company (its own GUIDs) are held, not taken.

## Last check (cbca321..ce4dbea)

The bridge-go/ changes after cbca321, read by the reviewer in the Claude Code session on 05-Oct-2026:
- 5afd9ca: the beat's heldLines. Rows are checked (line id characters and length, event created/altered/imported, a
  real date, the company GUID the one held), capped at 200, and join the held list once; the list's caps apply.
- The round 2 fixes above.
- 2f7b1a3: the decision log. It writes only to the local log; no new request to Tally and no new field to the cloud.
  Repeats are bounded (once in 10 minutes per line and reason; the memory of that kept to 5,000 keys).
- ce4dbea: BridgeVersion 2.2.2, the version pins in three tests, and the allow-list decision line.

No finding. The allow-list table is unchanged (TestAllowListUnchanged); only the decision line names 2.2.2.

After ce4dbea only tests and fixtures changed (06a415d, 4f00f10, 5321844: the version in two fixtures, GUIDs in one test); no bridge source changed.

Range: 4dc55ef..5321844
