# Tally page: one simple page (proposal for the owner)

Audit of 22-Nov-2026, track sync-speed-tally. This round fixed the wrong statuses and words only. The pages were not
redesigned. This note is the proposal for that redesign, for the owner to decide.

## What is wrong today

Tally appears in **5 places**, with **5 step lists** that number their steps differently:

| Place | What it has |
|---|---|
| Sidebar › Tally | Top card, "Connect Tally" (6 steps), clients table, Needs you. Under "Advanced (for support)": a second status card (This computer), a second company list, cards for each bridge, Versions, a third connect box (FinCom Bridge on this computer), "Every company seen" |
| Settings › Books in the cloud | Computers, with Remove |
| Client setup › Tally | Choose / Change / Unlink |
| Books › From Tally | Bring in from Tally, Update from Tally |
| Top-bar Tally icon | Popover, and the link offer |

The step lists are: Connect Tally (6 steps), Connect this computer (3), "Connect this browser to FinCom Bridge" (2),
DownHelp (4 checks) and "Bridge 1.15.0 fallback" (3).

The pages also use support words a CA's staff does not need: computer key, main bridge, Changes only, fresh baseline,
Release this bridge's identity, recorder, port.

## Proposal: one Tally page, three sections

**A. Connect.** One list of 6 numbered steps, always the same. Each step has one sentence and one button. When all 6
are done, the list folds to one line of ticks.

1. Install FinCom Bridge in your Windows login (**Download**)
2. Connect this browser (the **6-digit code** box sits here)
3. Open TallyPrime
4. Turn on Tally's connection, port N (**Copy N**)
5. Open the company and link it to a client
6. Reading: up to date

On a laptop the page says: "Do steps 1 to 4 on the Tally computer", with the same list. There is no separate Connect
this computer box, no Connect this browser box and no BridgeSettings box.

**B. Clients and their Tally company.** One table, and it is the only place where Link, Change and Unlink happen. Client
setup and the top-bar icon show only the status word and an "Open on the Tally page" link.

**C. Help & support** (closed by default). It holds each bridge's owner settings, versions, the log, the diagnosis and
install help. The computer list moves here from Settings › Books in the cloud, and that Settings page is removed.

## One set of words

These five words would be used everywhere: the chips, the cards, the icon and the rows.

| Word | When |
|---|---|
| **Connected** | your own Tally, with the company open, and FinCom's cloud hears the bridge |
| **Waiting for Tally** | a step is not done, and the step is named |
| **Needs you** | one line and one button (for example: key not accepted, choose between two places) |
| **Not linked** | the client has no Tally company yet |
| **Not on this computer** | grey; never another login's Tally |

The Tally menu path and the Day Book export keys are each written once, in the code, and used by every page:
`TALLY_CONN` in `app/src/lib/tallyPort.js`; the Day Book keys as in `app/src/lib/tallyJson.js` HOW.

## Already fixed in this round (no redesign)

- A bridge whose key FinCom's cloud refuses, or whose heartbeat has not reached FinCom for 3 minutes, no longer shows
  green "Connected". It shows step 1 with **Connect this computer**.
- A bridge that is running but not yet connected to this browser now says "type its code". Before, it said "not running".
- A computer card where Tally is open but no company is open says **Needs you**, not "Connected".
- Chips no longer change from Connected/Disconnected to Linked/Waiting when the Tally page is opened.
- Another login's company is not offered for linking from the top bar.
- The bridge key is shown masked and cannot be typed over.
- The Post page and the Stop reading confirmation no longer show a computer name or Windows login.
- "Longest today" uses India's day, not the UTC day.
- The Day Book upload says exactly which days it replaces.

## Decisions for the owner

1. Approve the three-section page (A, B, C) and the removal of Settings › Books in the cloud.
2. Approve the five words above for every Tally place.
3. Approve that Link, Change and Unlink are done only in section B. Client setup would show the word and a link.
