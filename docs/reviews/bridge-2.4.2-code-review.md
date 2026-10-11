# Code review: FinCom Bridge 2.4.2 (each entry's GST type)

One combined code and security review, as the owner asked for 2.4.2 (round 44 part B, the owner's approval of 11-Oct-2026):
an independent reviewer (a fresh agent session, read only, no access used beyond the repository) reviewed the bridge, the
cloud and the app together, then re-reviewed each round of fixes. The rounds' own notes, word for word:
docs/reviews/review-242-round1.md, review-242-round2.md, review-242-round3.md and review-242-round4.md (the app's last fixes).

Range: 176dcfb68d90a282d759d2227b559e907b981724..38cf7705aa1d3f1d7f6bea6a1abcf28f8b34454b

(next-gsttype: bridge-go/, server/tally-cloud/parse.js, index.ts, migration-72-gst-type.sql, tests, docs. The app part,
branch app-gsttype from arc-ui 26f6d152e, is reviewed in the same rounds: from 26f6d152e to ed074a726, the app's last commit, round 4's N6 comments.)

## What 2.4.2 changes

- The bridge keeps 18 more fields of Tally's whole-voucher answer to FinComVoucherObject (liveKeepGST242, fastvch.go): the
  party's GST registration type, country and the entry's reverse-charge mark; on each ledger line, item and the ledger
  line under an item the nature of the transaction, taxability, goods or services, the ineligible (17(5)) credit mark and
  the reverse-charge override. Kept by the strip only: the request is the same bytes (FinComVoucherObject ce0e72f74e72,
  FinComVoucherByNumber 2167477221dc); the allow-list table and its hash are unchanged.
- parse.js reads the type the same way from a Day Book export and from the bridge's body ("gst"); tally-ingest passes it;
  migration 72 (add-only) stores it with the AlterID it was read at and a mixed mark.
- The app takes the cloud copy's type for the bridge's entries (BookSrc.gstOf and put).

## Findings and what was done

| Round | Id | Severity | Finding | Fixed in | Re-review |
|---|---|---|---|---|---|
| 1 | H1 | High | the type had no AlterID: a later version stored without "gst" kept the old type as Tally's own | gst_alter_id (migration 72), gstOf / put (app) | round 2: fixed |
| 1 | M1 | Medium | a lazy back-referenced regular expression, quadratic on unclosed lists | cutOut, gstUnits (parse.js) | round 2: fixed |
| 1 | M2 | Medium | nature, taxability and supply from different lines; a mixed entry reduced to one value | the first GST line in document order, gst_mixed; the app takes no single kind for a mixed entry | rounds 2-3: partly; round 3 N4 fixed in cdd21a245 |
| 1 | M3 | Medium | item invoices not measured on real Tally | Tally's type stops the Day Book carry only with a nature; item tags proven present on 3.0-7.1 (fast234kinds); item invoices by XML refused in the test company (runs 38100635902, 38101756323, 38105667572) | round 2: lowered to Low, a release note |
| 1 | L1 | Low | write guard <= | = (the version just stored) | round 2: fixed |
| 1 | L2 | Low | the column fallback swallowed any error | only a missing column | round 2: fixed |
| 2 | N1 | Medium | a ledger line without GST details under a GST item counted as blocked | gstParts: each part on its own | round 3: fixed |
| 2 | N2 | Low | a newer stale type lost to an older held version | the newer of the two carried | round 3: fixed (opened N5) |
| 3 | N3 | Medium | the M3 fix carried an older version's blocked / RCM / country over Tally's own answer | Tally's own type carries only a blank nature and goods/services | round 4: fixed |
| 3 | N4 | Low | a mixed entry got the Day Book's single kind carried | none carried when mixed | round 4: fixed |
| 3 | N5 | Low | a blank nature not filled on the stale path | filled from the other version | round 4: fixed |
| 4 | N6 | Low | the comments described the old carry rule; gstRead set but never read | comments rewritten, gstRead dropped (ed074a726) | - |

Not counted (existing before 2.4.2, noted by round 2): openRe in parse.js is quadratic on a list opener followed by a
very long run of white space with no ">" (a crafted body from a holder of the bridge token); for a later release.

Security, checked in every round: no request to Tally added or changed; nothing kept beyond the 18 fields; migration 72
add-only, one transaction, safe twice, security definer with search_path public, pg_temp, granted to nobody; values
cast only after checks; no value rendered as HTML (XSS); DoS timings linear (the real 13.7 MB 500-item invoice 34 ms in
gstType; 20,000 unclosed lists under 1 s); an older bridge's body never blanks or overwrites. No AI.

## Result

Round 4 (the last): 0 High, 0 Medium, 1 Low (N6, fixed after it in ed074a726). Bridge, cloud and app: 0 High, 0 Medium open. Release notes: M3 (item invoices' GST type not measured on real Tally: the harness could not make one by XML), the existing openRe white-space cost.
