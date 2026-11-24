# FinCom Bridge 2.5.21 – notes (branch next-bridge-2521-rel: next-bridge-reupload, from 2.5.20 at 9824ec700)

The version is 2.5.21 (util.go). **No new request to Tally**: the allow-list holds the same 54 requests as 2.5.20; only
the stock row's version word ("unchanged in 2.5.21") and the decision and dated lines name 2.5.21, so the table hash is
now 86bfeef4... (docs/tally-allowlist.md; the beat fixture with it; 2.5.19's and 2.5.20's rows and dated line now say "as allowed in", so the decision line names one version, release-check.sh step 4). The same rules as before: a request at most 2 s, one in flight, postings
first, the typing gate. Use a test company with made-up entries only.

## What changes

1. **An Optional or cancelled voucher is not "already posted" (the owner's rule of 24-Nov-2026: an entry that is not
   really in the books never counts as posted).** When FinCom hands an entry back to be sent again (a release with the
   posting; since migration 219 also when FinCom's own copy of Tally shows the earlier voucher deleted in Tally; a copy
   with only an Optional or a cancelled voucher of an entry Tally accepted is "unsure" there and nothing is handed back), the bridge looks for FinCom's mark on that date first (2.5.19's look: FinComTag, already approved).
   Up to 2.5.20 an Optional voucher carrying the mark made the entry "Already in Tally", so it was never sent again.
   Now an Optional or cancelled voucher does not count, and the entry goes. (resent2519.go resentLookFirst.)
2. **Except for a client that posts Optional vouchers by its setting.** When the entry FinCom sends is itself Optional
   (ISOPTIONAL Yes: Client setup, "Post purchase bills and sales invoices as Optional vouchers"), its Optional voucher
   in Tally IS that entry: "Already in Tally", never sent twice. A cancelled voucher never counts. The read back of a
   part Tally made only partly (2.5.20 P2, post.go readBackTags) follows the same rule. (entryOptional.)
3. An ordinary new posting of an id this computer sent before is still refused on its own record (posted-ids.json,
   round 15): only FinCom's release, handed with the earlier posting, lets it go once. A Tally that drops FinCom's mark
   from the narration (03-Oct-2026) gets no duplicate from an ordinary repost.

## Tests

reupload_test.go (TestReupResentOptionalNotAlready, TestReupHandedBackAfterCopyRelease,
TestReupOptionalBySettingIsAlready, TestReupReadBackOptionalBySetting); r2521version_test.go. The paper test sheet:
docs/bridge-2.5.21-test-sheet.txt.
