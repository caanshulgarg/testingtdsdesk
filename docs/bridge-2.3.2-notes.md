# FinCom Bridge 2.3.2: release notes

For the owner. Plain words; times are IST. The steps to try it on NWS144 are in the test sheet below and in
`docs/bridge-2.3.2-test-sheet.txt`.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.3.2.exe |
| Fingerprint | SHA-256 `605cbc4a7c93a308ecc29d2de0bbbfd787821f53d9fae761d76698a77c66c168` (FinComBridge-Setup-2.3.2.exe, built 07-Oct-2026 08:25 IST; compare with the .sha256 file next to the setup) |
| FinCom app update | the one that goes with 2.3.2 shows the new line on the Tally page (below); the app of 2.3.1 still works with 2.3.2 (it shows nothing for it) |
| FinCom's cloud | unchanged (tally-ingest keeps the line as it already does; no migration) |
| Replaces | 2.3.1 (kept on the computer, so the tray can roll back to it) |
| Add-on | unchanged: keep `C:\ProgramData\FinCom\addon\FinComRecorder.tdl` loaded as it is |

**Published 07-Oct-2026 15:48 IST.** Real-Tally run 37602225971 (TallyPrime 7.1, this setup 605cbc4a…): all bridge checks PASS; the one FAIL was the harness's wait (the small company's entry arrived with its body at 10:03:35). Rerun 37606418898: every check PASS (a 30,000-entry company, its lookup 2.5-2.9 s, marked after 3 stops on 2 occasions; no entry request for it after the mark; its lines held with the words and its earlier held line ended with them; a small company's entries arrived with their bodies before and after; Tally never held after the mark, the bridge's slowest request 40 ms).

## Why

On a large company Tally takes about 5 seconds (13 at worst) to find one entry. The bridge stops waiting after
2 seconds, but Tally keeps working on the request for its full time. In 2.3.1:

- a new entry was asked 3 times, then sent to FinCom as a held line;
- the held line was asked again at every retry (15 s, 30 s, 1 min, 2 min, then every 5 min), because a request stopped
  at 2 seconds was "not counted as a try", so the limit of 20 tries never came;
- so the bridge kept asking for 7 days, and every ask cost Tally about 5 seconds.

On staging, the bridge go-c5b73700e65a (Windows user NW144\Ranjeet, Tally user durgesh) holds 9 lines of IX DESIGNS
PRIVATE LIMITED this way.

## What 2.3.2 changes

Two things, the owner's requirements of 07-Oct-2026. Nothing else.

### 1. A held line whose ask timed out waits hours, then ends

A held line whose entry Tally did not give in time (stopped at 2 seconds, not answered, or Tally busy) is asked again
**after 1 h**, then **after 4 h** more. If that one also times out, it ends. That is 3 timed-out tries in all; the first
fetch of the entry (its 3 stops) counts as one of them.

When it ends, FinCom is told, and the line shows held with the words: "Tally did not answer in time for this entry 3
times; upload that day's Day Book to settle it". The bridge never asks Tally for it again. It no longer goes on for
7 days.

A held line that Tally does answer (for example "no such entry yet") is spaced as before: every 10 minutes, at most 20
tries.

### 2. A company whose entries take Tally over 2 seconds is no longer asked

The bridge now measures, per company, how long Tally takes to find one entry: the time when Tally answers, and "over
2 s" when the bridge stops waiting.

When one company's entry request is stopped at 2 seconds on **2 separate occasions**, while Tally answered the bridge's
other requests in time around each of them, the bridge marks that company "entry fetch stopped: over 2 s". A Tally that
froze as a whole (nothing answered in time) does not count against a company. Neither do several stops in a row with
nothing else answered in between: that is one occasion. An answer in time to the company's own entry request clears
what was counted.

Once a company is marked:

- the bridge sends **no entry request for it** at all (not by Tally's id, not by type and number);
- its new entries go up to FinCom held at once, with the words: "FinCom does not ask Tally for this company's entries:
  finding one entry took Tally longer than 2 s. Upload that day's Day Book to settle it."
- its lines already held end with the same words, and nothing is asked of Tally for them;
- every other company works exactly as before.

The mark is kept on the computer, so a restart keeps it. It lifts by itself only when a newer FinCom Bridge is installed
(one whose request may be faster). There is nothing to resume by hand.

The bridge's log says it once: "<company>: entry fetch stopped: over 2 s (...)". Its heartbeat carries it per company
(the company, since when, how many stops, the last time Tally answered in time if it ever did, and why).

### The Tally page

On the computer's card, one line per company marked:

> IX DESIGNS PRIVATE LIMITED: FinCom has stopped asking Tally for this company's entries, because finding one entry took
> Tally longer than 2 seconds (since 07-Oct 10:05). New entries wait as held lines; upload that day's Day Book to settle
> them. This lifts when a faster FinCom Bridge is installed.

The time is the bridge's own (its computer's clock). There is nothing to press. An older bridge's "switched off" note
(2.2.x) is still never shown.

## What does not change

- The 2-second stop on every background request.
- The retry schedule after a stop (15 s, 30 s, 1 min, 2 min, then every 5 min).
- Postings go first; one request at a time.
- No Tally request was added or changed. The allow-list table and its hash are the same as in 2.3.1; only its decision
  line now reads "allowed for 2.3.2 by the owner's standing decision of 2026-10-06: no request on the list and no
  request shape changed".
- A small company (one entry found in under 2 seconds) behaves exactly as in 2.3.1.
- The next-release change "re-ask a held entry the moment Tally answers again" (branch next-reask) is not in 2.3.2.

## Known limits

- A company can be marked by mistake only if Tally freezes twice, each time just while that company's entry is being
  asked, with the bridge seeing other requests answered in time just before and just after each freeze. If that
  happens, its entries wait as held lines until the next bridge version; the Day Book upload settles them.
- FinCom's cloud keeps showing a line that ended as held (that is the point: the Day Book settles it). It also keeps
  listing it to the bridge for 7 days; the bridge ignores it.
- FinCom keeps the company, the time and the reason from the heartbeat. The number of stops and the last answered time
  are in the bridge's log and in `sync\recorder-slow.json` on the computer.

## How to roll back

From the tray: "Roll back to the previous version" (2.3.1 is kept on the computer). Or, from FinCom, an owner presses
"Roll back to an earlier version" on the Tally page. 2.3.1 ignores the mark (`sync\recorder-slow.json` stays on disk,
unused) and asks for every company's entries again as before, including the held lines' 7-day asking.

## Test sheet

The same steps are in `docs/bridge-2.3.2-test-sheet.txt`.

1. Install `FinComBridge-Setup-2.3.2.exe` on NWS144 and check its fingerprint. The tray says FinCom Bridge 2.3.2.
2. Small company (GARG SHEKHAR & COMPANY): save a journal in Tally. It reaches FinCom with its details within a minute,
   as in 2.3.1. No line appears under the computer on the Tally page.
3. Large company (IX DESIGNS PRIVATE LIMITED): save an entry in Tally. Within a few minutes the Tally page shows, on
   NWS144's card, "IX DESIGNS PRIVATE LIMITED: FinCom has stopped asking Tally for this company's entries, because
   finding one entry took Tally longer than 2 seconds (since <date time>). New entries wait as held lines; upload that
   day's Day Book to settle them. This lifts when a faster FinCom Bridge is installed."
4. Save another entry in IX DESIGNS. It shows in FinCom at once as held, with the words "FinCom does not ask Tally for
   this company's entries ... Upload that day's Day Book to settle it." Tally does not pause for it.
5. The 9 IX DESIGNS lines held under 2.3.1 end with the same words within a few minutes, without Tally pausing.
6. Upload IX DESIGNS' Day Book for that day in FinCom. The held lines settle.
7. Restart the computer (or the bridge from the tray). The line on the Tally page stays.
8. Optional, a timed-out line of a small company: if Tally freezes while an entry is asked (a large report open, say),
   the line is held; it is asked again after 1 h and after 4 h more; if Tally still does not answer in time, it ends
   with "Tally did not answer in time for this entry 3 times; upload that day's Day Book to settle it".
9. Roll back from the tray once, check 2.3.1 starts, then install 2.3.2 again.
