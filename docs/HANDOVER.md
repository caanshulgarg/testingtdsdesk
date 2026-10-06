# FinCom bridge work: handover note

Read this first after a restart or a compaction. Update it at each milestone. Times are IST.

Last updated: 06-Oct-2026, 10:35.

## The owner's standing rules

- **Staging only.** Supabase project qbocskaiewaxqcvaunzc. Never the live site or the live database. A hook blocks the live project's id; never write it.
- **Database changes are add-only.** Nothing is deleted or dropped. Removals are soft. No "delete from" in a migration.
- **No AI inside the bridge or the add-on.**
- **Financial accuracy first.** Tally must never hang, and the 2-second rule holds for every request.
- **Prospective only.** The bridge never reads earlier vouchers.
- **NWS144.** The owner can only run an installer, use Tally's menus and use the tray there.
- **One complete release at a time.** No split releases unless the owner agrees. The blank-value guard was an agreed split.
- **Each bridge works only on its own Windows user's Tally.** No line from another user's session enters a client's books.
- **Standing approvals (06-Oct):**
  1. Add the line "allowed for <version> by the owner's standing decision of 2026-10-06: no request on the list and no request shape changed" yourself, when no Tally request was added or changed. If one was added or changed, ask the owner. For 2.3.1 the owner approved the two request changes: the entry request, and masters by counter.
  2. Run migrations on staging yourself, in md5-checked pieces, each file as one transaction, when all of these hold:
     - it is the staging project;
     - it is add-only, with no "delete from" and nothing dropped;
     - the joined text's md5 equals the file's md5;
     - it passes when run twice on the test database.
  3. Publish to staging when:
     - the review is clean of High and Medium;
     - CI and Windows CI are green;
     - the real-Tally run passes;
     - the migrations have run.
- **Always ask the owner first:**
  - anything live;
  - anything that deletes or drops;
  - a new or changed Tally request;
  - AI in the bridge or add-on;
  - any change to how entries reach the books that the owner has not already agreed.
- **Tables are created only by migrations, never from the Supabase dashboard** (owner, 06-Oct).
- **The live database is never connected to by any tool or helper** (hard guard). For a live check, give the owner read-only SQL to paste himself.
- **Status lines the owner wants at each point:** guard live, A done, B done, review clean, real-Tally run passed, published.

## What is live on staging

- **Bridge 2.3.0**, published from tax-accuracy e628ae0.
  - Setup sha256: 8e8145693224edf5459836323ce187e87e8dbca6eeac0bde494cf64b2ca6a7b9.
  - Program sha256: c00f3956a56f8450e2b42fd3b6ebe865df1650431ca5e4331bc8f1275e7ffec1.
  - Installed on NWS144 on 06-Oct at about 08:05.
- **App:** tax-accuracy 24f9a35. It adds the blank-value guard (keep-fields-230) and the unknown-ledger list. Published at 09:26 as main commit 059f5ec.
- **tally-ingest:** v40.
- **Migrations run, with their file md5s:**

  | Migration | md5 | How it was run |
  |---|---|---|
  | 54 | 96318bf965a63180e6f22cb19e4281bd | 8 pieces, by Claude |
  | 55 | 68711988926cd6cfae121cdade5d81bc | Pasted by the owner into the SQL editor, after piece 2 timed out in the tool. The holding table keeps only pieces 1–2 (13,144 characters, md5 1824d2ca…), which is why it looks partial. All 14 function bodies match the file. |
  | 58 | db5b429519308c9768f6e6e6befee08a | 1 piece, run at 12:05 by Claude (permissions on 54/55's seven tables) |
| 56 | 0f8456c18349c961d3d296d9da7819e5 | 8 pieces, run at 09:08 by Claude. All 11 function md5s match. Dry run: 0 affected entries, including Payment 938. |

- **Earlier versions of 56 that must never run:** 3e976269… (27de563) and e234d68c… (02d81c4). They are superseded; 0f8456c1… (7f2366f) is the final file.
- **Book f79e4bc3-871d-4482-874d-71c5fb2a1b33** (GARG SHEKHAR & COMPANY) at 10:31: 4,020 live entries, total 0.00, 10,120 lines.

## Bridge 2.3.1, in progress

- **Owner's scope:** see their message "Build 2.3.1 now…".
  - A: the full entry request, one entry per request.
  - B: masters by counter, and an unknown ledger fetched first.
  - C: the deferred Lows.
  - The two 08:05 items: TDSDeskCompanies, and "nothing to remove".
- **Branches on origin:**
  - a-231 at 56bcbc6: migration 57 (md5 b630a27f…).
  - b-231 at b4a3f18: no migration.
  - c-231 at 8e834a5: migration 58 (db5b4295…) and migration 60 (adbec225…).
  - All three are being merged into items-231 now.
- **Owner's decisions of 06-Oct:**
  - **Blanks from full entries.** A 2.3.1 full entry passes blanks through for the fields it fetches ("full": true). The guard stays only for older bridges' lines.
  - **Same ledger, same amount, different HSN.** Keep the rule as built: by amount, else blank on a changed ledger. Do not blank the same-amount case.
  - **A renamed ledger fetched for an unknown name** (same Tally GUID as a ledger FinCom holds): apply the entry under FinCom's ledger and note the new name. This goes in 2.3.1, with migration 59 if storage is needed.
- **Real-Tally checks required before publishing:**
  1. a sales invoice with two items at two GST rates;
  2. a purchase invoice with items;
  3. a credit note with items;
  4. a receipt against a bill;
  5. a payment with TDS;
  6. a journal with cost centres;
  7. a bank payment with a UTR;
  8. a new party used straight away;
  9. a GSTIN altered;
  10. a 50-item invoice. Report its size and time; if it is over 2 s, tell the owner before publishing.
  
  The harness is branch tally-real-spike, workflow tally-real.yml, input bridge_ref.
- **Still to verify on a real Tally:**
  - the tag names IRN, IRNACKNO, EWAYBILL, UNIQUEREFERENCENUMBER, TDSDEDUCTEESECTIONNUMBER and TDSDEDUCTEETYPE;
  - the 50-item time.
- **Steps left:**
  1. integrate;
  2. one review round;
  3. release-check and build;
  4. CI, Windows CI and the real-Tally run on the build;
  5. migrations 57, 58, (59) and 60 on staging;
  6. deploy tally-ingest and check it byte for byte;
  7. publish with FINCOM_SHIP_BRIDGE=1.

## Other open items

- **TallyPrime version tests** (3.0, 4.1, 5.1, 6.2, 7.1): were due at 09:00 on 06-Oct. Started late, on branch tally-versions, workflow tally-versions.yml.
- **Receipt 192:** the owner is checking its bill allocation in Tally.

## How to apply a migration on staging

1. Run `python3 chunk2.py <file> <NN-md5prefix> <dir> 12000 12000` (in the scratchpad; the copy here is tests/tools/chunk_migration.py).
2. Insert each piece into public.fincom_migration_text (file, n, chunk) with dollar tag `$fcm7Qz$`.
3. Check `md5(string_agg(chunk,'' order by n))` against the file's md5.
4. Run:

   ```sql
   do $run$ declare t text; begin
     select string_agg(chunk,'' order by n) into t from public.fincom_migration_text where file='<key>';
     if md5(t) <> '<md5>' then raise exception 'md5 mismatch'; end if;
     t := regexp_replace(t,'^begin;$','','n');
     t := regexp_replace(t,'^commit;$','','n');
     execute t;
   end $run$;
   ```

5. Read back md5(prosrc) for each function the file creates or replaces, and compare with the test database.

Never remove rows from fincom_migration_text.

## Helpers

- Never pkill.
- Each helper uses its own worktree, its own pg port and its own branch.
- A helper's transcript is in the session tasks folder, as `<agentId>.output`. Its first line is the helper's brief.
