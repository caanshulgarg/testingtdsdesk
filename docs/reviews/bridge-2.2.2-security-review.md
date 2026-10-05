# Security review: FinCom Bridge 2.2.2 (every entry fetched from the bridge's own Tally)

Reviewed: 05-Oct-2026, alongside the code review of the same range (bridge-2.2.2-code-review.md), which has the
details. The bridge sources are read with `git diff 4dc55ef <to> -- bridge-go/ docs/tally-allowlist.md` from clean
worktrees.

## What 2.2.2 does

One job: a new, altered, deleted or cancelled entry in a linked company reaches the books.
- The add-on's GUID and AlterID are never trusted. The entry is fetched from the bridge's own Tally by MasterID, else
  by type, number and date.
- It is accepted only by the rules (Tally's own GUID for that MasterID under the company GUID held for the company,
  type, date and number matching, the AlterID above the starting point). Otherwise the line is held, with plain words.
- The cloud's held-lines list (heldLines in the beat's answer) joins the bridge's held list; the cloud's MasterID is
  only a key to ask Tally by, and the cloud's GUID and AlterID are not read.
- One log line per fetch decision, in the local log only.
- Kept because already built and reviewed: 20 tries at most per held line, and the hard 2 s stop for the recorder's
  background reads.

Moved out of 2.2.2 to a later build (the owner's rule of one job per release): the company-folder check, the add-on
per Windows user, the add-on writing nothing for companies that are not linked, and changes to Source B, Source C and
the Edit Log.

## What holds

- **No request shape changed.** The allow-list table is unchanged (TestAllowListUnchanged). Only the decision line
  names 2.2.2.
- **Prospective only.** A request by MasterID needs a recorded starting point, and an answer at or below it is refused
  with generic words that name nothing of the entry.
- **The by-number request stays tied to a real line.** It is sent only for a line queued or held, within 3 days.
- **Another company's entry is never taken.** Tally's voucher is taken only under the company GUID held for the
  company. Lines from another Windows user's Tally (the live books, with the same company GUID) are held with a reason
  and never enter this client's books.
- **Availability.** It never runs during a posting or an import. The hard 2 s stop and the 30 s cool-down keep the
  background reads off a busy Tally. The held list is bounded (500 a company, 2,000 in all; 20 tries; 20 s a turn).
- **Sizes.** heldWhy, lineGuid, type, number and user are capped; an oversize line goes marked and cut.
- **Nothing new leaves the computer** beyond idsMismatch, lineGuid, lineFid and heldWhy; no new host.

## Round 1 (4dc55ef..f3a28e2)

Findings (tests first in 0c9e32e; fixed in 09dea31, 7145170 and cbca321):
- **M1** (heldWhy leak). The words for a voucher below the starting point named the entry Tally gave, so they told
  the cloud about an entry from before the starting point. Now the words are generic, and that check comes first.
- **L2.** The sizes were not capped (heldWhy, lineGuid, type, number, user). Now they are; an oversize line goes marked.
- **L3.** The held list had no cap. Now it is capped. The resolver does not ask by number when the MasterID gave
  another real voucher, and Tally is asked outside the held list's lock.
- **L4** (code M3). After the hard stop, the background reads hold back.
- **L5.** The by-number guard's "a line the bridge is asking for" now means a real line queued or held; a request for
  an old day not tied to one is refused.
- **L6.** No starting point recorded: nothing of the company's entries is asked or taken.
- **L7.** Tally's voucher is taken only under the company GUID held for the company; recorderSeen counts a daily file
  only with a valid line of that company GUID.

## Round 2 (4dc55ef..cbca321)

No High or Medium. The Lows L-A to L-D are fixed (198b200, 8c7fc09, 8b783e6, 621fff9; see the code review). L-C
matters here: a FinCom id moved to lineFid, or an oversize line, no longer goes in the narration's TDSDesk tag, so the
cloud cannot take a copied id from there.

Accepted, listed for the next build: L-E (the event's label can flip), L-F (one duplicate ":resolved" line for lines
2.2.1 already resolved), L-G (entries re-imported into the same company held). None lets a wrong entry into the books.

## Last check (cbca321..ce4dbea)

- heldLines (5afd9ca): rows from the cloud are checked and capped before they join the held list; they only say what
  to ask Tally, and what is taken is decided by Tally's answer alone.
- The decision log (2f7b1a3): local log only. It names the line's own type, number, date and MasterID, as the log did
  before; nothing that Tally gave for an entry below the starting point.
- ce4dbea: the version and the decision line.

No finding.

Range: 4dc55ef..ce4dbea
