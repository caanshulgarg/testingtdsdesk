# FinCom 2.4.1: release notes

For the owner. Plain words; times are IST. The steps to try it on NWS144 are in `docs/bridge-2.4.1-test-sheet.txt`.

Branch `next-241`, from `tax-accuracy` 7c13c777 (2.4.0 is published from 3bf7b6d9). The owner approved the plan on
09-Oct-2026 after the morning's mix-up: GARG SHEKHAR & COMPANY (one company GUID) was open in two Tallys with different
data folders, both add-ons wrote into the one recorder folder, and the owner's 2.4.0 bridge took the second copy's lines
(Sales 2026-27/GST/297 came with MasterID 25743, an older voucher in the owner's own Tally; it was held as "Tally's voucher
with that MasterID is not a change after the starting point", and Needs you sent the owner to the starting point).

| | |
|---|---|
| Setup file | FinComBridge-Setup-2.4.1.exe (NOT built yet) |
| Fingerprint | (written when it is built) |
| Published | NOT published |
| Replaces | 2.4.0 (kept on the computer, so the tray can roll back to it) |
| FinCom app | changed: the Tally page's card for a company open in two places, the Needs-you words, the bell |
| FinCom's cloud | migration 71 (add-only), NOT run on staging; tally-ingest changed (deploy it after 71) |
| Add-on | changed: every line also carries the company's data folder (`\|dp=`), `$Destination:Company:##SVCurrentCompany` as measured on TallyPrime 3.0-7.1 |
| Tally requests | none added, none changed: the allow-list table and its hash are unchanged (see "Tally requests") |

## 1. The add-on writes the company's data folder (`|dp=`)

Every line now carries `|dp=<the company's data folder>` right after `tw`, before `w=`
(`FCR1|ev=|t0=|tw=|dp=|w=|cguid=...`). The folder is `$Destination:Company:##SVCurrentCompany`, measured on real
TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (tally-versions runs 37920699057 and 37926156040): in all eight event contexts
(created and altered, pre and post; cancel and delete, pre and post) it gives the full company folder including its number
folder (e.g. `D:\a\_temp\TallyData\100000`), two data folders give different values, and it adds no measurable save time.
It is SET on its own into a String variable (`vDP`) and only then put into the line: never joined to text in the same
expression, because `$Method:Company:<name>` followed by `+ "..."` can be read as part of the company's name (the tested
form). (Until the measurement this was one placeholder formula, FCRDataPath; it is replaced by the measured form.) A line
with an empty `dp=`, or none, is read as an older add-on's (as in 2.4.0). A 2.4.0 bridge reads `dp=` as part of `tw` (a
time it needs only without `t0`); its `w=` stays whole. This is the add-on's own line, **not a request** to Tally.

## 2. The bridge: the data id, and a line of another data location never fetched or applied

- The **data id** of a data folder: sha256 of its case-folded, trimmed path (spaces and trailing backslashes trimmed, so
  `D:\x\100000` and `D:\X\100000\` are one location; `...\TallyData\100000` and `...\TallyData2\100000` are two), the
  first 16 hex characters. The path itself is kept for display only.
- The bridge learns its **own** Tally's data id per company (company GUID) from its own add-on lines: lines whose `w=` is
  this Windows user, for a company open in its own Tally, the most recent `dp`. Kept in `sync\recorder-data.json`.
- A line whose data id differs from the own data id for that company GUID (or from the one FinCom chose, item 3) is
  **not fetched from Tally**, **never sent as an entry**, and goes as kind `other_source` with the company, its GUID, the
  data id, the path, `w=`, the computer, the line's date, type and number, its received_at, and **no body** (no GUID,
  MasterID, AlterID, narration or ledgers).
- FinCom's heartbeat answer says, per company, which data id it reads (`dataSources`). A bridge whose own data id is not
  the chosen one **stops reading that company**: every line of it goes as `other_source`, and nothing of it is asked of
  Tally (the held list, the re-scan, bank dates, renumbering and the nightly check pass it by).
- Every line the bridge reads from its own Tally carries `data_id`, so FinCom holds anything from a location it does not
  read. Lines without `dp=` (an older add-on) behave as in 2.4.0.

## 3. FinCom's cloud: migration 71 and tally-ingest

Migration 71 (`server/tally-cloud/migration-71-company-sources.sql`, add-only, one transaction, safe to run twice, RLS on,
every function SECURITY DEFINER with `search_path = public, pg_temp`, minimal grants). **NOT run** on staging.

- `tally_company_sources` (id, firm_id, book_id, company_guid, data_id, path, device_id, win_user, computer, first_seen,
  last_seen, last_line_at, choice 'chosen' | 'other' | 'pending', chosen_by, chosen_at; unique (book_id, data_id)). The
  firm reads its own rows; nobody writes them directly.
- The first data id a bridge says is its own for a linked book becomes **'chosen'** by itself, so today's setups stay as
  they are. A different data id for the same book becomes **'pending'** and raises **ONE alert** (`tally_alerts`, the
  existing kind 'summary' marked `data.reason = 'source'`, once per problem; nothing of `tally_alerts` is changed: the
  migration drops nothing, not even a CHECK).
- Owner-only `tally_company_source_choose(book, data_id)`: that one 'chosen', the others 'other', who and when recorded;
  the book's starting point cleared as `tally_baseline_clear` clears it, so the next beat from the chosen location records
  it afresh. It writes nothing else.
- `tally_company_source_lines`: lines of a location FinCom does not read are kept **held**, event 'other_source', with no
  GUID, MasterID, AlterID or body, so nothing ever applies them (an owner's release fails them as "unknown event"; the Day
  Book release never runs them), with the words "saved in another data location of <company> (②, <computer>); FinCom
  reads ①. Choose on the Tally page."

tally-ingest:
- accepts `other_source` lines and upserts the sources; a line whose `data_id` is not the chosen location's is held as
  another data location's and never applied;
- the beat's `dataSources` (at most 50, only for companies the beat itself names) are noted and answered per company
  (chosen or not); a computer whose location is not chosen gets no starting point call and no gap check;
- keeps the bridge's own `received_at` in the line and its payload (it dropped it before);
- validates everything: a data id 16 hex, a path at most 260 characters, at most 50 sources a call;
- ties these kinds to companies the computer named (the **S-M1** pattern of eed48720): a computer that never named the
  company in its heartbeat cannot send `other_source` lines or data ids for it.

Deploy order: run 71, then deploy tally-ingest. Without 71, tally-ingest answers `other_source` lines 'failed' with words
and does everything else as before.

## 4. The app: the Tally page and the bell

- One **owner-only** card per book with more than one location: "<company> is open in two places with different data:
  ① <computer> · <user> · <path> (last entry <time>) ② … Which one is your books? FinCom reads only that one." Buttons:
  **Use ①**, **Use ②**, **Decide later**. Use ② asks once first: "FinCom will read <company> from ② (<computer> ·
  <path>) from now on. Entries from ① will be held, not used. You'll need to upload ②'s Day Book for the year. Continue?"
- After a change: "FinCom now reads ②. Upload ②'s Day Book for the year (one month per file) so the history matches.",
  with the link to the upload page; who chose and when. Staff see the words without the buttons.
- Needs you for those lines: "saved in another data location of <company> (②, <computer>); FinCom reads ①. Choose on the
  Tally page.", with Open the Tally page. The bell lists the 'source' alert until it is read.
- `61-recorder.js`: 'baseline' now means only "starting point not recorded" (the 09-Oct words no longer send the owner to
  the baselines).

## 5. The fallback by number (reverses 2.3.4's L5 for this case only)

A created or altered line whose MasterID answer is an older entry ("not a change after the starting point"), no entry at
all, or an entry of another type, date or number is asked **FinComVoucherByNumber ONCE** (its type, its number and its
date, which must be from the starting day to today, as `voucherByNumberExact` already allows), on its first fetch only.
The answer is taken only when exactly one voucher comes back and it passes `liveVoucherWrong` with the MasterID cleared
(AlterID above the starting point, Tally's own GUID, the same type, date and number). Two matches, a wrong type or date,
or nothing: held with true words ("the voucher with that MasterID in this Tally is an older entry, not this save; asked by
its type and number: 2 entries with that type and number on that date"). The older entry itself is never named (security
M1). Skipped entirely for lines from another data id. The request is exactly as built; its shape is unchanged.

## 6. The log's words

When FinComVoucherByNumber is refused before it goes, the log says its own rule: "the date is before the company's
starting day (<d>)" or "older than 3 days and not just asked", instead of "reading old entries is off (ReadDays)".

## 7. The reviews of next-241 (0f436f6c): 5 High, 8 Medium and four Lows fixed

- **H1, two copies never mix.** Whether a line is another location's is decided before anything is learned from it. The
  bridge learns its own data id only from a line that proved itself: this Windows user's line whose entry came from its
  own Tally by its MasterID under the line's own GUID, with an AlterID above the line's. A known own id is never replaced
  without FinCom's choice. A line of a folder not proven the bridge's own is never asked by its number. ':resolved' lines
  and the bridge's own reads carry the proven id only.
- **H2, a line without dp=.** The bridge sends it as another location's when it stopped reading the company; FinCom holds
  a line without a data id from a computer that is not a chosen location's: "Restart Tally so the 2.4.1 add-on loads".
- **H3, the company by its GUID.** A location is noted only for the book's own company GUID; another GUID is another
  company, never chosen by itself.
- **H4, section suffixes.** After a space or a dash only a real suffix counts: "TDS 192 ON SALARY" is 192 (not 192ON).
  run_ledger_pending still shows 0 differences.
- **H5, one data folder under two paths** (D:\TallyData on the server, \\SERVER\TallyData or Z:\ on a client). A third
  answer on the card, "These are the same data (both computers read it)"; FinCom keeps a set of chosen locations; until a
  person chooses, a pending location's bridge is not stopped and its lines are held WITH their entry: "same data" applies
  them, "Use ①" leaves them held for good.
- **M1** the number fallback only for an older entry or no entry (another type, date or number: 2.4.0's hold); the
  narration is Tally's. **M2** chosen by itself only as the location of the computer the starting point came from; every
  other location pending, with the alert. **M3** the location FinCom reads already: its Use disabled; choosing it again
  stamps who and when only. **M4** ledger and master lines of another location are never fetched. **M5** the ledger page's
  "agree" compares the rate and the registration too. **M6** Change on "Other ledgers (not tax)" asks first for a
  confirmed ledger used in entries. **SR-M2** at most 20 locations a book, marks once a call, the card's read bounded.
- **SR-L1** control characters and bidi marks stripped from the path, the Windows user and the computer, on both sides,
  lengths in characters. **L2** the "older entry" words: Needs you, the Day Book. **L4** the chosen location re-checked
  where a line is applied (tally_recorder_send_sourced, under the lock the owner's choice takes). **L8** the bell's line
  for held lines without "..", its action the Tally page. **L9** the dated "re-measured on 2026-10-09" line in
  docs/tally-allowlist.md (rows, shapes and hash unchanged).

- The coordinator's follow-ups: **the drain** (a burst of more than 50 full lines queued) sorts the lines out again where
  it applies them, under the same lock as the owner's choice (71 replaces 47's `tally_recorder_settle` with that one
  step): a line of a location no longer chosen, or one without data id from a computer not chosen, is held as the send
  holds it. **Use ② while ② was pending**: once ②'s starting point is recorded afresh after the choice, its held lines
  saved above that starting point (AlterID) are applied, once; the older ones stay held with words for the Day Book.

Left for the next release (as the coordinator decided): the reviews' L1, L3, L5, L6, L7 and SR-L2 to SR-L5.

The owner's decision of 09-Oct-2026: staff may see the data folder path and the Windows user; only the owner chooses.

## Tally requests

Nothing added, nothing changed: the allow-list table and its hash are unchanged (9637918f31ad…; TestAllowListUnchanged).
The decision line reads "allowed for 2.4.1 by the owner's standing decision of 2026-10-06: no request on the list and no
request shape changed" (the add-on line change is not a request), with 2.4.0's decision kept as history.

## Not in 2.4.1

- Migration 71 is not run on staging; nothing is deployed or published.

No AI in the bridge or the add-on.
