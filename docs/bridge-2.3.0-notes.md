# FinCom Bridge 2.3.0: release notes

For the owner. Plain words; times are IST. The steps to try it on NWS144 are in `docs/bridge-2.3.0-test-sheet.txt`.

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.3.0.exe |
| Fingerprint | SHA-256 `8e8145693224edf5459836323ce187e87e8dbca6eeac0bde494cf64b2ca6a7b9` (FinComBridge-Setup-2.3.0.exe; compare with the .sha256 file next to the setup) |
| FinCom app update | goes live at 06-Oct-2026 06:59 IST, together with the bridge |
| Replaces | 2.2.4 (kept on the computer, so the tray can roll back to it) |
| Add-on | unchanged: keep `C:\ProgramData\FinCom\addon\FinComRecorder.tdl` loaded as it is |

## Read this first: the app and the bridge go out together

2.3.0 is the first bridge that proves to FinCom that it is really your FinCom Bridge before FinCom hands it anything
secret (see "Four security fixes" below). FinCom's app is updated at the same time to ask for that proof.

- **After the app update (06-Oct-2026 06:59 IST), FinCom no longer trusts a bridge older than 2.3.0.** It sends such a bridge no
  key, no pairing code and no posting. Where it would have talked to it, FinCom says:
  "The program answering at http://127.0.0.1:9100 did not prove it is your FinCom Bridge, so nothing was sent to it.
  Install FinCom Bridge 2.3.0 or later for your Windows user, then connect again (right-click the FinCom Bridge icon >
  Connect FinCom on this computer...)."
  Connecting a bridge older than 2.3.0 fails with: "...a bridge older than 2.3.0 must be updated first."
- **Every Windows user on NWS144 that runs a FinCom Bridge must install 2.3.0** (each in their own Windows sign-in,
  "Just for me"). One user's 2.3.0 does not cover another user.
- **Rolling the bridge back alone does not work any more.** If you roll a bridge back to 2.2.4 from the tray, the 2.3.0
  app refuses it with the words above. So a rollback means telling us first: we put the app back as well.

## What 2.3.0 contains

### 1. Everything in 2.2.4

Tally's typed answers are read correctly. Your TallyPrime 7.1 answers with typed fields (for example
`<MASTERID TYPE="Number">`) and a count of the company's vouchers and ledgers at the top of every answer. 2.2.4 reads
those answers with or without the typed fields and never takes the count as an entry, so an entry saved in Tally
reaches the books with its body (its lines, amounts and narration), not as an empty heading. 2.3.0 keeps all of that.

### 2. Deletes and cancels, by Tally's own GUID

When you delete or cancel an entry in Tally, the add-on's line now carries Tally's own GUID for that entry, and FinCom
uses it to find the entry in the books.

- **Cancel** (Alt+X in Tally): Sync activity shows **Cancelled** for that entry (its type, number and date), and the
  books show it as cancelled.
- **Delete** (Alt+D in Tally): Sync activity shows **Deleted** for that entry, and it is gone from the books.
- **When FinCom cannot tell which entry was deleted** (for example the GUID matches nothing in the books, or matches
  more than one), nothing is removed. The line is held with the words:
  "deleted in Tally; FinCom could not tell which entry: upload that day's Day Book to settle it".
  Upload that day's Day Book from Tally and FinCom settles it from the Day Book.

### 3. One bridge per Windows user

NWS144 is shared: several people sign in to Windows there and each runs their own TallyPrime. Before 2.3.0 only one
bridge could answer on the computer. Now each Windows user has their own.

- **Install "Just for me".** Each Windows user runs the setup in their own sign-in and chooses "Just for me" (no
  administrator needed). The program goes into that user's own folder and starts when that user signs in.
- **A port each, chosen by itself.** Each user's bridge takes the first free port of 9100 to 9199 and remembers it.
  Nobody has to set anything. If all hundred are taken, the bridge says so once (tray and log) and stops; it does not
  keep restarting.
- **Only its own Windows user.** A bridge answers only programs of its own Windows user; another user's program gets
  "not your FinCom Bridge". It reads and posts only to the Tally running in its own user's Windows session, never
  another user's Tally.
- **FinCom finds your own bridge.** FinCom looks on ports 9100 to 9199 for the bridge that belongs to you. If the one it
  finds belongs to another Windows user it says so plainly and asks you to install your own ("Just for me").
- **The Tally page shows one line per bridge**, headed `<PC> · <Windows user>` (for example "NWS144 · <your Windows user name>"), with the
  version, Tally's port, the companies open there and the data folder. Two users on NWS144 show as two lines.
- **No conditions on any bridge.** Every bridge, of any Windows user, owner or staff, reads Tally and posts into it as
  soon as it is installed and connected: no owner approval, no switch to turn on, no waiting. There is no limit by
  user, by company or by number of bridges or computers; anyone in the firm can link a company and work.
- **Changes only** (an optional owner's switch, per bridge, on the Tally page; OFF by default): a bridge set to Changes
  only keeps sending Tally's changes to FinCom but is never given a posting. Its line shows "Changes only: never
  posts"; "Allow posting" turns it back.
- **Which bridge a posting goes to: the poster's own.** The Post screen's confirm step says which bridge will post:
  "Through `<PC> · <Windows user> · <company> · <data folder>`". A posting goes through the bridge of the person who
  posts: the bridge they are linked to ("Posts for: ..." on the Tally page; FinCom links you to your own bridge by itself
  when you connect it, and you can link yourself there with "Post through this bridge (mine)"), else their own bridge
  that has the company open. An entry lands only in its own company's books and in the poster's own Tally, never in
  another person's Tally. If you have no bridge of your own with the company open, nothing is queued and FinCom says so,
  naming the company and what to do (install and connect your FinCom Bridge, or open the company in your Tally). If
  your bridge has not been heard from for 3 minutes, the posting is queued all the same and says "waits for your
  FinCom Bridge on `<PC> · <Windows user>`"; it is posted as soon as that bridge is back. An owner may still pick
  another bridge in "Post through another bridge". Queueing a posting again, or Retry, never moves it to another bridge.
- **A computer key shared by several Windows users** (settings carried over from the old 1.15.0 bridge): the "main
  bridge" choice now holds only among the bridges of the same Windows user, so another user's main bridge never stops
  yours, and a waiting posting is never moved to another Windows user's bridge. When you connect, FinCom gives your
  bridge a computer key of its own.
- **Your own cancel or delete when your Tally cannot be asked.** If you cancel or delete an entry in Tally and FinCom
  cannot ask your Tally about it at that moment, the line is held, not guessed. Uploading that day's Day Book settles
  it; any member of the firm can do that upload.
- **New bridge versions install by themselves** on every computer, with no pilot and no approval. The owner can hold a
  version ("Hold version X" on the Tally page, with a reason), let it go again, roll every bridge back to an earlier
  version ("Roll back to an earlier version", until cleared), or withdraw a version. The tray's own "Roll back to the
  previous version" stays as it is.
- **Apply now** on a held line in Sync activity: any member who may make changes can press it; the same checks run,
  and a line that fails one stays held with its reason.

### 4. Four security fixes

1. **The bridge proves itself before FinCom sends any key.** Before the bridge key, a pairing code, a computer key or a
   posting goes to a bridge, FinCom sends it a fresh random number and the bridge must answer with a proof made from
   its own key (challenge and response). A program that cannot prove itself (another user's program, or a bridge older
   than 2.3.0) is sent nothing. An old proof cannot be replayed.
2. **A bridge's id is bound to one computer.** Each bridge has its own id ("go-" and 12 letters/digits). FinCom now ties
   each id to the first computer key that reported it, and refuses the same id from any other computer key (for
   example, an id copied from another user's settings). The database update (migration 54) binds every id reported
   today to its computer, including **go-6b1ba45fbb1d to "Office computer"**.
   - **Release this bridge's identity** (owners only, on the bridge's line on the Tally page): frees the id so the next
     computer that reports it gets it. FinCom asks why, and keeps who released it, when and why.
   - **One bell alert** for the owners when a computer key is refused an id: "`<PC> · <Windows user>` tried to use bridge
     `<id>`, which belongs to another computer; FinCom refused it." with what to do (install the bridge again for that
     user, or release the identity). One alert per id and computer, not one per minute. "Mark read" clears it.
3. **Refusal words name the company and the action.** When a bridge is refused, its tray and its line on the Tally page
   say: "This computer key cannot use bridge `<id>`: it belongs to `<PC> · <Windows user>`. Ask the firm's owner."
   When you cannot post into a company, FinCom names the company and what to do, for example: "Nobody can post into
   GARG SHEKHAR from your sign-in just now: your FinCom Bridge (NWS144 · `<your Windows user>`) does not have GARG
   SHEKHAR open in Tally. Open GARG SHEKHAR in Tally there, then post again."
4. **Dates confirmed.** Where these words give a time (for example "your FinCom Bridge (...) has not been heard from
   since 05-Oct-2026 14:32 IST"), it is the date and time in IST.

## Rollback

From the tray: right-click the FinCom icon > "Roll back to the previous version" > Yes. The bridge goes back to 2.2.4.
**But the 2.3.0 app does not trust a 2.2.4 bridge**, so after a bridge rollback FinCom stops sending to it (the "did not
prove it is your FinCom Bridge" words above). Rolling back therefore means: **tell us first**, with the time and what
went wrong; we roll back the app and the bridge together. A Windows user who installed a bridge for the first time with
2.3.0 has no earlier version to roll back to: tell us.

## What we need from you if something fails

The check number, the time (IST), what FinCom shows (a picture is fine), and from the tray: right-click the FinCom icon
> Show log, the lines named in that check of the test sheet.
