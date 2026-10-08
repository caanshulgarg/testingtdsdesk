# FinCom Bridge: its own Windows notifications (2.3.5)

Owner's request (08-Oct-2026): notifications must be clearable everywhere, and a notification cleared once never
appears again. This page covers the bridge's own Windows notifications only: the tray icon's balloons, which Windows 10
and 11 show as toasts. FinCom's web app (the bell and the page lines) is done separately (branch `next-alerts-clear`).

The bridge's only notification call is `Shell_NotifyIconW` with `NIF_INFO` in `bridge-go/win_tray.go` (`tray.balloon`).
The service never shows a notification itself: it has no desktop; the tray icon, running as the signed-in Windows
user, asks it for its state every 5 seconds and shows them. Since 2.3.5 every balloon goes through one gate
(`bridge-go/notices.go`): `Check` for a problem, `Reply` for the answer to a menu click. A test reads `win_tray.go` and
fails if any balloon is shown another way.

Message boxes (Status, Test connection, Connect FinCom, the trial tools' results and the like) are windows the person
opens from the tray menu and closes with OK. They are not notifications, are not listed here, and are not changed.

## Inventory

### Problems: the bridge shows these on its own

| Kind (id prefix) | Title | Text | When | How often (2.3.4) | How often (2.3.5) |
|---|---|---|---|---|---|
| `nostart` | FinCom Bridge could not start | the bridge's own words, e.g. no free port in 9100-9199, or another FinCom Bridge already runs on the same settings | the bridge stopped at start and left its start-failed file; shown at once | once per start of the icon | once per problem (day, computer) |
| `down` | FinCom Bridge is not running | The bridge on this computer has stopped. Windows starts it again by itself (per-user install: FinCom Bridge starts it again by itself while you are signed in); if this stays, choose Restart from this icon. | the bridge has not answered for 30 s, the icon running for over 30 s | again each time the bridge came back and stopped again | once per problem (day, computer) |
| `idrefused` | FinCom Bridge | FinCom's words refusing this computer key the bridge's id | FinCom refused the id (Fix 2c); at once | again each time the refusal cleared and came back | once per problem (day, computer) |
| `offline` | Bridge offline | This computer cannot reach FinCom. Changes from Tally wait here and go as soon as FinCom can be reached. | connected to FinCom, not online for 2 min, reading not paused | again after every recovery: a flaky network gave one per drop | once per problem (day, computer) |
| `tally` | Tally not open | Open TallyPrime with your company, so FinCom stays up to date and postings reach Tally. | Tally not open for 3 min, the icon up over 2 min, reading not paused, and Tally seen open before or office hours | again every time Tally was closed for 3 min, so several a day | once per problem (day, computer) |

None of these problems is about one company, so their fingerprint's company is empty. The gate takes a company for any
later notification that is about one company.

### Answers to the person's own clicks in the tray menu

Each one is shown once for each click and never repeated by the bridge. They are not recorded as problems: when the
person asks again, the answer comes again. Closing or clicking one does not dismiss a problem.

| Menu item | Title | Text |
|---|---|---|
| Pause background reading | Background reading paused | Opening a client in FinCom and the nightly catch-up do not read Tally until you choose Resume. Postings and Update now still work. |
| Resume background reading | FinCom Bridge | Background reading resumed. |
| Reading stopped from FinCom (greyed; older menus) | FinCom Bridge | Reading from Tally resumed. |
| Restart (the bridge not answering, per-user install) | FinCom Bridge | Starting the bridge; it is back in a few seconds. |
| Restart | FinCom Bridge | Starting again; it is back in a few seconds. |
| Check for updates | FinCom Bridge | Checking for updates... |
| Check for updates (no answer) | FinCom Bridge | The bridge is not answering. (warning) |
| Check for updates (answer) | FinCom Bridge updates | the update check's message |
| Test connection | FinCom Bridge | Testing the connection: the bridge, Tally and FinCom (up to half a minute)... |
| Measure Tally | FinCom Bridge | Measuring <company> for FinCom support: ... The report opens when it is done. |
| Test reading from Tally (trial tools) | FinCom Bridge | Testing reading from Tally: <company>, <day>: three requests ... |
| Test fetching an entry (trial tools) | FinCom Bridge | Test fetching an entry: <company>, <type> <no>: four requests ... |
| Recorder trial: time saving (trial tools) | FinCom Bridge | Time saving on <company>: 100 TRIAL journals ... |
| Switch to main bridge | FinCom Bridge | Becoming the main bridge: bridge 1.15.0 is stopped ... The icon is back in about a minute. |
| Roll back to the previous version | FinCom Bridge | Rolling back to <version>; the bridge is back in a few seconds. |

### Not notifications

The icon's colour (green or red) and its tooltip ("Main bridge: reading and posting", "Tally not open", ...) always
show the current state. Clearing notifications never changes them.

## The rules (2.3.5)

1. **A problem's id** is its kind plus a fingerprint: SHA-256 of kind, company, day (the local date when the
   notification is due) and computer name, 16 hex digits, e.g. `tally:b71cf62b69311b5e`. It never holds times or counts.
2. **Shown at most once per problem, dismissed or not.** The id is recorded when the notification is shown, before it
   is shown, so a problem that comes and goes all day, or an icon that starts again, does not show it again. The
   next day, another company or another kind is a new problem and shows once.
3. **Dismissed is never shown again.** Windows tells the icon's window when the person clicks the balloon
   (`NIN_BALLOONUSERCLICK`, recorded as `clicked`) or closes it (`NIN_BALLOONTIMEOUT`, recorded as `closed`). Windows
   sends that same message when a balloon times out unread, so the two cannot be told apart. Rule 2 already covers that
   case. A balloon taken away by the program (`NIN_BALLOONHIDE`) is not a dismissal.
4. **Clear notifications** (tray menu) marks every current one cleared (`cleared`): every problem there now, whether
   shown or still waiting its 2-3 minutes, and the balloon on screen. It takes the balloon off the screen and says how
   many were cleared ("2 notifications cleared: they are not shown again for the same problems. A new problem still
   shows once. The icon keeps showing the bridge's state."). The list Windows keeps in its notification centre belongs
   to Windows. The person clears it there.
5. **The file** is per Windows user: `%LOCALAPPDATA%\FinCom Bridge\notifications-cleared.json`. The icon runs as the
   signed-in user, so each user has their own. It is written whole, like the bridge's other state files (`saveFile`: a
   temporary file, then one rename, tried again a few times). Entries older than 90 days are left out on reading and
   writing. An unreadable or half-written file is started again empty and said in the log. Nothing is hidden, and at
   worst a problem shows once more. A bad entry beside good ones is skipped, and the good ones are kept. If the file
   cannot be written, the gate remembers in memory until the icon starts again, and says so once in the log.
6. Each notification shown and each clearing is a line in the bridge's log ("Notification shown: ...",
   "Notifications cleared from the tray menu: n (...)").

Entry example:

```json
{
 "tally:b71cf62b69311b5e": {"kind": "tally", "shown": "2026-10-08T11:03:00+05:30", "dismissed": "2026-10-08T11:03:20+05:30", "how": "clicked"}
}
```

## Tests

`bridge-go/notices_test.go` covers the following. A dismissal survives a restart, and closed with X counts too. A new
fingerprint shows, whether another kind, company, day or computer. The 90-day expiry. A corrupt file (garbage, half
written, an array, bad entries beside good, empty, a BOM, a folder in its place) gives the safe default without a
crash. Once per problem with no nagging, across 50 on/off cycles and a restart. Each of the five problems goes from
`trayProblems` through the gate. Clear notifications counts and words. Replies are one per click and not recorded. The
source check that every balloon goes through the gate. `bridge-go/notices_windows_test.go`, run in the Windows job of
`bridge-windows.yml`, covers Windows' click, close and hide messages through the real window procedure, and checks that
the file is under this user's `%LOCALAPPDATA%`.
