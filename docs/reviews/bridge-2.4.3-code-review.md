# Code review: FinCom Bridge 2.4.3 (TDS challan details and TDS master settings from Tally)

One combined code and security review, as for 2.4.2 (the owner's approval of 11-Oct-2026): an independent reviewer (a
fresh agent session for each round, read only, no access used beyond the repository) reviewed the bridge, the cloud and
the app together, then re-reviewed each round of fixes. The rounds' own notes, word for word:
docs/reviews/review-243-round1.md to review-243-round6.md.

Range: bd80c0cbe3f5c7e4ba6ec90040772f4d9ffa28d5..f793ffc36d86516933654d4995d09a500a029d1c

(next-tdsfields: bridge-go/, server/tally-cloud/parse.js, index.ts, migration-73-tds-fields.sql, tests, docs; since
9f656e88f (the last head reviewed, round 6) only docs/ changed and the beat fixture tests/fixtures/beat-2.1.10.json, which the go test writes, took the new allow-list table hash (f793ffc36; no code). The app part, branch app-tdsfields from arc-ui, is reviewed in the same rounds: from
f4b15d9c5 to e0f3a4be0 and, after its merge of arc-ui 8c7da8f21, the diff against arc-ui; round 6's Low U1 fixed after it
in 16e3b2ccb.)

## What 2.4.3 changes

- FinComVoucherObject keeps 30 more fields of Tally's whole-voucher answer (liveKeepTDS243, fastvch.go): a TDS payment's
  Stat Payment duty and period, the challan (BSR code, number, date, cheque, bank, branch), the nature and section, each
  line's TYPEOFTAXPAYMENT and nature, and per nature (SUMMARYALLOCS) the period, return, status, amount paid and challan.
  Kept by the strip only: the request is the same bytes (ce0e72f74e72); a blank one is not kept.
- The ledger requests (FinComLedgers, FinComLedgerChanges, FinComLedgerByName) ask TDSRATENAME, the special rate and the
  lower-deduction certificates; a new request FinComTdsNatures reads Tally's TDSRate masters (section, rates, thresholds)
  in chunks of 5,000 MasterIDs inside the ledger round, never holding the ledger list. All four measured on real
  TallyPrime 3.0-7.1, ZZ BIG TEST's masters and 20,000 ledgers (runs 38164963591, 38187902681): worst 316 ms.
- parse.js reads "tdsx"; tally-ingest passes it, the ledger columns and the natures; migration 73 (add-only) stores them.
- The app (src/js/72-tds-tally.js) makes challans From Tally, tags deductions from Tally's links, takes sections from
  the nature, fills certificates and uses thresholds, never overwriting what a person entered.

## Findings and what was done

| Round | Id | Severity | Finding | Fixed in | Re-review |
|---|---|---|---|---|---|
| 1 | H1 | High | the allow-list doc had no 2.4.3 decision line; the four requests not measured | decision and dated lines, rows measured on 3.0-7.1 (a1a82b0f7, f9e5a4f87) | rounds 2-3: fixed |
| 1 | H2 | High | Tally's references joined by name alone | keyed by reference, party and duty ledger; one deduction only (726f2ac94) | round 2: partly (N2) |
| 1 | H3 | High | challans From Tally never followed Tally's corrections, could be doubled | follow when untouched, else kept and listed (726f2ac94) | round 2: fixed |
| 1 | H4 | High | thresholds across sections and on monthly limits | same section, year or bill only, stricter only (726f2ac94) | round 2: partly (N3) |
| 1 | M1 | Medium | tax 0 when only interest marked | tax = TDS paid less marked interest, fee, others (726f2ac94) | round 2: partly (N1) |
| 1 | M2 | Medium | a person's edits overwritten | tallyWas snapshot; never below what is tagged (726f2ac94) | round 2: fixed |
| 1 | M3 | Medium | multi-challan interest and fee lost; zero-tax challans | by nature; unknown share not made (726f2ac94) | round 2: fixed |
| 1 | L1-L6 | Low | BSR cut; GST stat payments; date forms; error regex; certificate edits; company switch | a1a82b0f7, 726f2ac94 | round 2: fixed |
| 2 | N1 | Medium | an interest-only payment read as tax | tax 0 with its interest (fba04bf76) | round 3: fixed |
| 2 | N2 | Medium | a deduction reached by two payments; no date / year guard | listed, not tagged (fba04bf76) | round 3: fixed |
| 2 | N3 | Medium | 194C's lone EXEMPTIONLIMIT read as a year's limit | both figures needed (fba04bf76) | round 3: fixed |
| 2 | N4-N6 | Low | bad challans not shown; corrected ones removed; FinComLedgerChanges not measured | fba04bf76, f9e5a4f87 | round 3: fixed |
| 3 | R1 | High | hand-made challans (from "tally") taken for the sync's and removed | only the sync's (madeBy) changed; hand ones the person's (from books) | round 4: fixed |
| 3 | R2 | Medium | "Make it a challan" dropped interest and fee | carried, shown | round 4: fixed |
| 3 | R3 | Low | a payment already a challan proposed again | by fromVoucher | round 4: fixed |
| 4 | S1 | Medium | the sync re-tagged a deduction a person untagged | "off" kept, listed (cb1d0dc2c) | round 5: partly (T1) |
| 4 | S2 | Low | From Tally mark on a person's tag or hand challan | cb1d0dc2c | round 5: fixed |
| 5 | T1 | Medium | the "off" mark not saved with the books | allocFrom in BOOKS_KEYS (e0f3a4be0) | round 6: fixed |
| 5 | T2 | Low | the auto-tag lost the "off" mark | e0f3a4be0 | round 6: fixed |
| 6 | U1 | Low | a hand tag dropped "off" | 16e3b2ccb (with a test) | - |

## Result

Round 6 (the last): 0 High, 0 Medium, 1 Low (U1, fixed after it in 16e3b2ccb with a test). Bridge, cloud and app: 0 High,
0 Medium open. No finding in the bridge's Go code or migration 73 after round 1's Lows. Release notes: the first real
Challan Reconciliation entry on NWS144 is the live confirmation that the TAX* tags carry it (the test machines run
Educational mode).
