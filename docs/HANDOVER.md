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
- **A new point raised while a release is in its final checks goes into the NEXT release**, unless it is a High in the release itself. Ask the owner if unsure (owner, 06-Oct).
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
| 61 | cec075a148f26144fd1808c94b841684 | 2 pieces, run at 13:43 by Claude (privileges: no TRUNCATE/anon writes anywhere; authenticated writes only listed columns of clients, records, activity; members closed). Restore lines in its header. Branch perms-61. |
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
  - a-231 at 56bcbc6: migration 57 (md5 e5e40d9a…, items-231 3eebfb1).
  - b-231 at b4a3f18: no migration.
  - c-231 at 8e834a5: migration 58 (db5b4295…) and migration 60 (adbec225…).
  - All three are being merged into items-231 now.
- **Owner's decisions of 06-Oct:**
  - **Blanks from full entries.** A 2.3.1 full entry passes blanks through for the fields it fetches ("full": true). The guard stays only for older bridges' lines.
  - **Same ledger, same amount, different HSN.** Keep the rule as built: by amount, else blank on a changed ledger. Do not blank the same-amount case.
  - **A renamed ledger fetched for an unknown name** (same Tally GUID as a ledger FinCom holds): apply the entry under FinCom's ledger and note the new name. This goes in 2.3.1, with migration 59 (md5 882de3e6…).
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

## Admin second step (owner, 06-Oct)
Require the platform admin's second sign-in step in the admin edge function (server/security/functions/admin/index.ts:66). Do NOT switch on until the owner says his second step works. Staging's only platform admin is test@test.com, with no second step enrolled (13:45).

## Live
server/tally-cloud/live-members-fix.sql (md5 fd84f633…) is for the owner to run himself. Never connect to live.

## 2.3.1 build (06-Oct 17:23 IST)
tax-accuracy 09b1b23; setup 7d4a37a93a52dbc55ab9992c7148c7d607485d567fd34e1bde7d607288a216be; program 89668be15577e580f4febad894c234a2c54d1bf104495ccdf8e3b3485c09a829. Review clean (round 3). CI 37459575969 and Windows CI 37459575962 green. To publish: the final real-Tally run on this build passes; then migrations 57 (8aa48ece…), 59 (882de3e6…), 60 (adbec225…) on staging; tally-ingest deploy with a byte check; publish with FINCOM_SHIP_BRIDGE=1. The owner decided: publish this build as it is; the 'one request in flight, really' change (branch next-inflight) goes in the next release with the push design.
After install: watch NWS144 for a working day (timeouts, retries, longest wait for an entry, any pile-up).

## 07-Oct evening
- 2.3.2 had a High (new saves stuck unsent behind re-asks of old held lines). 2.3.3 fixes it; published 07-Oct 21:37 IST, setup 8280206b…e5e5. Install by hand on NWS144: owner (go-6b1ba45fbb1d) first, then Ranjeet (go-c5b73700e65a).
- Bridges never auto-update on staging: no latest.json.sig is published. Holds on 2.3.1 exist for firms ABC and Garg Shekhar & Company (harmless).
- Owner rule (07-Oct): no field or request is added to anything sent to Tally without his approval, even read-only. 13 fields in 2.3.1/2.3.2 await his decision (see the audit message); BANKALLOCATIONS.NAME approved.
- Owner rules for held lines (2.3.3): asked again at most once; slow-company lines never asked; every save in FinCom within 10 s; one request in flight per Tally.
- Next priority: full entry at save (branch next-push). Pending owner decision: the fast request "voucher object by MasterID" (17-22 ms at any size, run why22).

## 09-Oct: 2.4.0 published (15:00 IST)
- One combined release (2.3.3 -> 2.4.0). Published to staging review 09-Oct 15:00 IST: main b53d0a41 from tax-accuracy 3bf7b6d9; setup 00ab8042…16dc, program 7bc063e7…c2a9. CI 37904634974 and Windows CI 37904634951 green; real-Tally gate 37904664319 (32/32), 37904667057 (25/25), 37904670015 (20/20) on the committed setup.
- Migrations 62, 63, 64, 65, 66, 67 run on staging in that order (md5 in the test sheet), functions read back and matched.
- tally-ingest version 42: index.ts deployed with whole-line `//` comments stripped (repo e65d5107…6383fb5, deployed 2f254a42…b99f3250; details in docs/bridge-2.4.0-notes.md); the other files exact. Rollback copy: v41.
- Publish needs `npm ci` in the publish worktree: app/package.json now has @sentry/browser, which the shared /home/user/testingtdsdesk/app/node_modules lacks.
- Install by hand on NWS144 as for 2.3.3 (owner first, then Ranjeet); steps in docs/bridge-2.4.0-test-sheet.txt.
