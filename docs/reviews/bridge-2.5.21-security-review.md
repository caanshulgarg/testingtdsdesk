# Security review: FinCom Bridge 2.5.21 (an Optional or cancelled voucher carrying FinCom's mark is not "already posted" unless the entry itself is Optional)

Status: independently reviewed 24 Nov 2026 at 86c842d1a and again at e5a689f58. READY; no findings in the code.

Range: 972fd76fa..e5a689f58

The repository is public: findings, if any, are described in general terms only, and no specifics are written here.

## What was checked

- **The local HTTP server.** No route was added, changed or removed in the net range: server.go, jobs.go and
  accepted.go are byte-identical to 2.5.20. The /lookone route added in 711b14425 was removed in b10f38bf4, and no
  handler, builder or reference to it is left.
- **Requests to Tally.** No new or changed request XML, and no new read. The only look is the existing one-date
  FinComTag, under the same 2 s stop, one request in flight and the posting's priority. The allow-list has 2.5.20's 54
  requests. The table's hash change is wording in descriptions and the stock row's version word only. No pin changed.
- **Input handling.** The one new input read is the ISOPTIONAL field of the entry FinCom hands to the bridge, matched
  as Yes (any case). Changing it can only make the bridge treat an existing Optional voucher as the entry (nothing
  sent), or send again an entry that FinCom's release already lets go once. It cannot cause a second regular posting
  of an id without that release. Tally's answer is parsed by the existing readers, and only whole answers of the asked
  date are used.
- **File writes.** None new. The only added output is one log line (an entry id, a date and the kind of voucher), the
  same kind of data the log already carries. posted-ids.json is written as in 2.5.20.
- **Other users' Tally and tally.ini.** Untouched: no change to port finding, user checks or any shared file.
- **AI.** None in the bridge.
- **Builds and tests.** go vet passed for Linux and Windows. The full test binary ran at e5a689f58: 1,374 passed,
  2 skipped, 0 failed.
