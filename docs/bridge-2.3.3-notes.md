# FinCom Bridge 2.3.3: release notes

For the owner. Plain words; times are IST. The steps to try it on NWS144 are in the test sheet below and in
`docs/bridge-2.3.3-test-sheet.txt`.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.3.3.exe |
| Fingerprint | SHA-256 (filled in when it is built) |
| FinCom app | unchanged: the app of 2.3.2 shows everything 2.3.3 says |
| FinCom's cloud | unchanged (no migration; tally-ingest keeps the held line and replaces it with its `:resolved` line as it already does) |
| Replaces | 2.3.2 (kept on the computer, so the tray can roll back to it) |
| Add-on | unchanged: keep `C:\ProgramData\FinCom\addon\FinComRecorder.tdl` loaded as it is |

## Why (a High in 2.3.2, seen live on NWS144 on 07-Oct-2026)

The owner's rule: "A save must always show on the Tally page, at least as held with a reason. Silence is not
acceptable."

In 2.3.2, with yesterday's held lines waiting to be asked again and Tally slow, a new entry saved in Tally sat unsent
for over 35 minutes, and nothing of it reached FinCom:

- each turn of the bridge first asked Tally again for one of the held lines, and so took the one try the retry schedule
  allows while Tally is slow;
- the new entry's own request then found the schedule waiting. That was "not counted as a try", so the new entry never
  reached its limit of 3 tries and was never sent held either;
- while it waited for its details it stayed at the head of the queue, and every other line, of every company, waited
  behind it;
- the "slow company" rule of 2.3.2 never marked GARG SHEKHAR (2.1 to 2.5 s for one entry, every time): it needs Tally to
  answer some other request in time around each stop, and only entry requests were going.

## What 2.3.3 changes

### 1. A save goes up within seconds, held with a reason

When the bridge cannot get an entry's details on its first attempt, for any reason (Tally slow, Tally busy, the retry
schedule waiting, reading stopped for a moment), the line is **sent to FinCom at once, held**, with words such as:

> waiting: Tally took longer than 2 s; FinCom asks again at 12:15

> waiting: Tally busy; FinCom asks again at 12:15

The time is when the bridge asks Tally again. The line joins the bridge's held list, due at that next try (not 10
minutes or an hour later). When Tally gives the entry, its details go as `<line id>:resolved`; FinCom then replaces the
held line and enters the entry once. A second `:resolved` of the same entry is a duplicate; nothing is entered twice
(checked against the cloud: `tests/run_recorder_server.py`, section 2.3.3, including a held line with no GUID).

A new entry without Tally's id on its line (found by its type and number) is asked a few seconds after the save as
before; if Tally has not shown it yet, it goes up held with "waiting: Tally has not shown this new entry yet; FinCom
asks again at ...".

As a safety net, no line waits unsent longer than 4 seconds for its details: if it still has none (a posting going on,
or the entries saved just before it still being read, one request each), it goes up held with the words ("waiting: Tally
busy (reading the entries saved before it); FinCom asks again at ..."). While new lines wait, the held lines are not
asked: the bridge finishes the one request already at Tally, then the new lines go first.

### 2. A held line is asked again once, then it ends

The owner's rule of 07-Oct-2026 replaces 2.3.2's 1 h / 4 h ladder: a held line (one held before, from FinCom's list, or
held because its fetch timed out) is asked of Tally again **at most once**, with one request. If Tally gives the entry,
it goes as `:resolved`. If that one ask stops at 2 seconds, FinCom shows the line held with "Tally did not answer in time
for this entry when asked again; upload that day's Day Book to settle it". If Tally answers without the entry, the words
are "Tally did not give this entry when asked again; upload that day's Day Book to settle it". Either way the bridge never
asks for it again. A new save sent held before Tally was asked at all gets its first fetch and then the one ask again.
So with 50 old held lines, Tally gets at most 50 requests for them, one each.

### 3. Nothing is sent to a Tally still working on an earlier request

Tally always finishes a request after the bridge stops waiting for it (the real-Tally run 37606559317, sections B1-B3),
and anything sent meanwhile queues behind it. So after a 2 s stop the bridge keeps the connection open, reads Tally's
late answer and discards it, and sends nothing else to that Tally until it has come (10 minutes at most; then Tally is
taken as not answering, one log line, and the small check goes first). When Tally finishes within 20 s, the next request
goes at once instead of waiting for the retry schedule. A posting waits for it too (10 minutes at most; in practice the
second or so Tally still needs): the posting's status says "Waiting for Tally to finish an earlier request; this posting
follows by itself", and the Tally page says "Tally is still finishing an earlier request (sent at ...)". This is the
"one request in flight" part of the next-release branch next-inflight, brought in as it was tested there; its 20 s wait
for a single entry is not (every background request keeps the 2-second stop).

### 4. The held lines can no longer starve the new ones

- The held list asks the newest lines first: today's saves before yesterday's backlog.
- While live lines wait for their details, the held lines get at most every other try of the retry schedule.
- A line waiting at the head of the queue never holds back the lines of other companies, nor its own company's for
  more than a few seconds.

### 5. A slow company is marked even when only its entries are being asked

With 2.3.3, the beat's small check (the light company check, and the company list) that finds the retry schedule waiting now gets
the next try, so the bridge sees Tally answer something else in time between two stopped entry requests. A company like
GARG SHEKHAR, at 2.1 to 2.5 s every time, is now marked after 2 such occasions (about 20 minutes) instead of paying 2 s
on every try for ever. A Tally that freezes as a whole still never marks a company (in a freeze the small check is not
answered in time either). The window around a stop is now 15 minutes (it was 10), because the small check comes every
10 minutes a company.

### 6. The heartbeat says what waits

Per company: the lines waiting to go to FinCom, the oldest of them, and the held lines being asked of Tally again. When
lines have waited 30 seconds or more, one line goes with the computer's other waiting words and shows on the Tally page,
for example:

> 2 changes of GARG SHEKHAR & COMPANY waiting to go to FinCom (oldest since 12:14); 40 held entries being asked of Tally
> again

## What does not change

- No Tally request was added or changed. The allow-list table and its hash are the same as in 2.3.2; only its decision
  line now reads "allowed for 2.3.3 by the owner's standing decision of 2026-10-06: no request on the list and no
  request shape changed". The same requests go; only their order changes (the small check gets the try after an entry
  stop; the newest held line is asked first).
- The 2-second stop on every background request; the retry schedule (15 s, 30 s, 1 min, 2 min, then every 5 min), except
  that it is lifted when Tally finishes the stopped request within 20 s (above).
- Postings go first; one request at a time.
- 2.3.2's slow-company mark: once a company is marked, none of its lines, old or new, is asked again; they all go up
  held at once, and its held lines end with the slow words.

## Known limits

- The words on a held line say when the bridge asks next. If that ask is also slow, the line ends with the Day Book
  words (a `:resolved` line FinCom shows held); the Day Book upload settles it.
- A held line's one ask is by Tally's id when the line has it, else by type and number; it is never asked the other way
  as well (one request), so a line whose id points at another entry ends with the words instead of being found by its
  number.
- A line held at once costs one more line in FinCom's Sync activity: the held line, then its `:resolved` line that
  replaces it.
- After a small check answers in time, the retry schedule starts again from 15 s (as in 2.3.1), so a slow company is
  asked a few more times before it is marked.
- An entry read by a source other than the add-on (sources B and C, not used since 2.3.1) that goes up held is not asked
  again by the held list; the Day Book upload settles it.

## How to roll back

From the tray: "Roll back to the previous version" (2.3.2 is kept on the computer). Or, from FinCom, an owner presses
"Roll back to an earlier version" on the Tally page. 2.3.2 reads the held list as it is (it ignores the new fields) and
behaves as before: it asks held lines again on its 10-minute and 1 h / 4 h spacing, and it closes a stopped request at
once (so the next request can queue behind it in Tally).

## Test sheet

The same steps are in `docs/bridge-2.3.3-test-sheet.txt`.

1. Install `FinComBridge-Setup-2.3.3.exe` on NWS144 and check its fingerprint. The tray says FinCom Bridge 2.3.3.
2. A fast company: save a journal in Tally. It reaches FinCom with its details within a minute, as before.
3. GARG SHEKHAR (about 2.2 s for one entry), with held lines from earlier: save a journal. Within a few seconds FinCom's
   Sync activity shows it held, "waiting: Tally took longer than 2 s; FinCom asks again at <time>" (or "Tally busy").
   Never nothing.
4. Within about 20 minutes, NWS144's card on the Tally page says GARG SHEKHAR is no longer asked (2.3.2's line), and
   its new entries go up held with the Day Book words.
5. On a company Tally answers in time, a line held with "waiting: ..." is replaced by its entry once Tally answers
   (Sync activity: "Replaced by a later line", and the entry in the books once).
6. Roll back from the tray once, check 2.3.2 starts, then install 2.3.3 again.
