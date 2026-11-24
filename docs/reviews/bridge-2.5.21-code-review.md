# Code review: FinCom Bridge 2.5.21 (an Optional or cancelled voucher carrying FinCom's mark is not "already posted" unless the entry itself is Optional)

Status: independently reviewed 24 Nov 2026 in two rounds: the first at 86c842d1a (two blockers on the release paper,
none in the code), the second at e5a689f58 (both fixed). READY; no blockers.

Range: 972fd76fa..e5a689f58

2.5.20's bridge sources are 972fd76fa (the last bridge-go commit before the 2.5.20 release commit 9824ec700, which
changes no file under bridge-go). The range is next-bridge-reupload (711b14425, b10f38bf4, 0b04fd600), the 2.5.21
version and paper (86c842d1a), and the paper fixes after the first round (e5a689f58).

## What changed

- resent2519.go resentLookFirst (the look for FinCom's mark before an entry is sent again): a voucher carrying the mark
  that is cancelled, or Optional while the entry FinCom sends is not Optional, is not taken for the entry; the entry
  is sent again. A regular voucher carrying the mark is "Already in Tally" as before. An Optional entry (the client's
  setting) is "Already in Tally" by its Optional voucher (entryOptional). The same rule applies to a mark found on
  another date when the look fails.
- post.go readBackTags (2.5.20 P2's read back of a part Tally made only partly) follows the same rule. Only vouchers
  changed after the part was sent are counted, as before.
- /lookone, lookFirst and reupload.go, added in 711b14425, were removed in b10f38bf4. server.go, jobs.go and
  accepted.go are byte-identical to 2.5.20.
- The version is 2.5.21 (util.go), and test version words changed.
- Paper and wording only (e5a689f58): the decision line cites the owner's standing decision of 2026-10-06. 2.5.19's
  and 2.5.20's rows and dated line say "as allowed in <v>", so the decision line names one version. The test sheet's
  steps 1-3 now match what FinCom's copy decides (migration 219).

## The bridge's rules, checked

- No AI in the bridge.
- Each Tally request is stopped at 2 s, one is in flight, postings go first, and the typing gate is kept: invokeTally,
  resentLook and the gates are unchanged.
- Only the user's own Tally: no change touches port finding or tally.ini.
- No new or changed Tally request XML. The four non-test files changed are allowlist.go, post.go, resent2519.go and
  util.go, plus requests2519.go's description text in e5a689f58. The allow-list holds the same 54 requests as 2.5.20.
  The table equals 2.5.20's except for the stock row's version word and "allowed for 2.5.19" reading "as allowed in
  2.5.19" in seven descriptions. No pin, field or request builder changed. So the table hash (86bfeef4...) changes
  by wording only.
- Never posted twice. An ordinary repost of an id this computer sent is still refused on its own record. Only FinCom's
  release lets it go, once. A Tally that drops FinCom's mark from the narration gets no duplicate from an ordinary
  repost. On a released re-send the look behaves as in 2.5.20 when no mark is found.
- No Tally read beyond the existing one-date FinComTag look.

## Tests

- go build and go vet passed for Linux and Windows. go mod tidy -diff shows nothing.
- The full test binary was run in file-order thirds in parallel (-test.timeout 40m) at 86c842d1a and again at
  e5a689f58: 1,376 tests, 1,374 passed, 2 skipped, 0 failed.
- New: reupload_test.go (TestReupResentOptionalNotAlready, TestReupHandedBackAfterCopyRelease,
  TestReupOptionalBySettingIsAlready, TestReupReadBackOptionalBySetting) and r2521version_test.go.

## Notes for the owner (not blockers)

- An entry built without an ISOPTIONAL field (the payroll and audit journals) into a voucher type that Tally makes
  Optional by default would, on an owner's release, be sent again as another Optional voucher. It would not be a
  second regular entry.
- When several cancelled or Optional vouchers carry the mark, the log line names only the last kind seen.
