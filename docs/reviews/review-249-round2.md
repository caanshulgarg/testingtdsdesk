# Review 249, round 2: FinComVoucherBatch, what a group gives otherwise

Reviewer: an independent Claude session (did not write this code)
Date: 2026-10-29
Branch reviewed: next-bridge-249 at f447764ca
Not covered here: a9cbec7f8..86dc851b9 (round 1, reviewed separately on review-249-round1)

High: 1, Medium: 3, Low: 4

What was run: `cd bridge-go && flock /tmp/fincom-app.lock go test -count=1 -run 'R249' .` passed (ok, 34.7 s). No code was changed.

## Code review

Range: 86dc851b9..f447764ca

Files: bridge-go/batch249.go (batchTOSLines, batchTOS, batchTOSTake, batchTOSProbe, batchTOSProbing, batchTOSLearn,
fetchVoucherBatch, pullBatchStep), bridge-go/daypull.go (pullFetchStep), bridge-go/r249batch_test.go,
testdata/batch249/3.0-bdiff, docs/bridge-2.4.9-notes.md.

What holds:
- The "On Account" rule (batch249.go:209) errs toward one-by-one reads. A genuine On Account allocation (also unnamed)
  is read one by one too. That costs speed and loses no data.
- An entry is taken from a group only when every flagged key is known to be empty in FinComVoucherObject's answer.
  An unknown key, or one known to have a type, sends the entry one by one or asks for it again (batch249.go:434-447).
  Learn concatenates the type of supply over every line with the same key (batch249.go:309). So one line with a type
  marks the ledger "has a type", which is the safe side.
- The inexact checks now count `again` entries (batch249.go:419, 455). A duplicate of an `again` entry is still
  rejected.
- Progress: each group that parses makes at least one entry final. The first entry with a given unknown set becomes
  a probe (single), and singles are excluded from later groups. A probe whose read fails gets 5 tries and then
  pullDrop. A probe that is gone or moved is removed from `want`, so the check at batch249.go:480 stops blocking groups.
  There is no infinite loop. (The cost bound is a separate issue: see M2.)
- There is no new request shape. Probes use the existing FinComVoucherObject request (fetchVouchersByMasterListed).
  Entries asked again use fetchVoucherBatch, which still builds only the b4-range / b4-list forms.

### H1. A learned "no type of supply" is never invalidated, and it assumes the type depends only on the ledger. An entry can be taken from a group with GSTOVRDNTYPEOFSUPPLY differing from FinComVoucherObject's

batch249.go:234-240 (batchTOS.known), batch249.go:320, batch249.go:244-257 (batchTOSTake)

`batchTOS.known` lives for the whole process. No company save, AlterID or master-counter change, period or day
boundary, Tally restart or version change clears it. Sequence on TallyPrime 3.0-6.2:
1. Ledger "Sales X" holds no type of supply. A probe learns `known[co|ALLLEDGERENTRIES|sales x] = true`.
2. The operator sets "Sales X" to Goods. This is a common GST-return clean-up, and exactly the ZZ BIG TEST case
   ("ledgers that hold none").
3. Later older-day entries on "Sales X": the group still gives `""` on 3.0-6.2, and FinComVoucherObject now gives
   "Goods". batchTOSTake returns ok, so the entry is taken from the group with an empty type of supply. That breaks the
   delta's own rule, "never taken from it", and FinCom's tax data gets a wrong field.

A second path rests on an unproven assumption. The comment and notes say the object export gives the type the ledger
holds. The data only shows one ledger with one value (obj-2 and obj-39, both "Goods"). The field is a voucher-line
override (GSTOVRDN*). If Tally stores it per entry (a value captured when the entry was made, or set in the voucher),
two entries on the same ledger can differ. The learning would then carry entry A's empty value to entry B.

Suggested fix: limit learned values to one pullWork / day, or tie them to the company's master AlterID (the bridge
already re-checks a "master counter" for employees: pullEmpKey). Or check the assumption at the gate before relying on
it.

Suggested tests:
- `TestR249TOSLearnForgottenOnMasterChange`: learn "none" for a ledger, move the company's master counter or AlterID
  in the fake Tally, give the ledger "Goods" in the object answer. Assert the next entry is read one by one, and that
  `batchTOSTake` is not ok after the change.
- A gate run (bdiff) on two entries of one ledger, entered before and after the ledger's type of supply was changed.
  Compare the object answers.

### M1. Learning is keyed by company name only, not the company GUID

batch249.go:240 (`batchTOSKey` → `companyKey(company)`), also :262, :268, :277

Every other per-company state in the day pull uses `companyKey(it.Company) + "|" + it.CGUID` (daypull.go:126,
pullEmpKey, slowMarked(it.Company, it.CGUID)). batchTOS uses only the lower-cased, space-folded name. Two companies
with the same name (another data folder or Tally on another port, a split / new-FY copy, a restored backup, or names
that differ only in case or spacing) share what was learned. A "none" learned in A then lets B's entries be taken from
groups while B's ledger holds "Goods". That is the same wrong field as in H1. pullItem carries CGUID, so the fix is
cheap: pass it into batchTOSTake / Probe / Learn.

Suggested test: `TestR249TOSLearnPerCompanyGUID`. Two companies with the same name and different CGUIDs. Learn "none"
in one, then assert `batchTOSTake` for the other returns unknown.

### M2. When a probe does not settle its key, every entry naming it is asked again in every group: quadratic Tally load

batch249.go:313-321 (`if !seen { continue }`), batch249.go:436-443, daypull.go:834-838

A probe settles a key only if FinComVoucherObject's kept answer has an element with the same `<list>|<name>`. It stays
unsettled in these cases:
- the probe's read finds it gone (`x == ""`) or moved / another GUID. batchTOSLearn is not called, and the probe
  entry is left in `batchTOS.probe`;
- the names differ after normalising. The group side trims `"\x04 \t\r\n"` (batch249.go:205); the learn side uses
  `TrimSpace` (batch249.go:298) and does not trim \x04;
- the list names differ, for example a nested list kept under another name by the strip. Only
  ALLLEDGERENTRIES→LEDGERENTRIES is mapped (batch249.go:306-308). The inventory and ACCOUNTINGALLOCATIONS paths have
  no real-answer test (the bdiff ALLINVENTORYENTRIES lists are empty).

Then the next group finds the key still unknown. It probes one more entry and marks the rest `again`. N entries on that
ledger need N groups, about N²/2 entries asked: 100 entries cost about 5 050 instead of about 101. Each group is a full
FinComVoucherBatch under the 2 s stop. The loop ends, but it adds the Tally load 2.4.9 is meant to remove, and it raises
the chance of the 2 s stop or window hold. That stop halves the group size and then goes one by one, and the window
hold stops the company.

Suggested fix: when a probe comes back without settling its keys, mark those keys "has a type" (known=false), so the
entries go one by one as in 2.4.8. Or make every entry with those keys single after one failed probe.

Suggested test: `TestR249PullProbeUnsettledNoQuadratic`. 10 entries share a ledger. The fake object answer drops the
line, or its LEDGERNAME differs by a leading `&#4;`. Assert at most 2 groups and 10 sent.

### M3. The detection depends on the exact shape the gate saw: an empty tag present, plus a nature or taxability

batch249.go:213

An entry gets a key only when the group's line has `GSTOVRDNTYPEOFSUPPLY` present and empty AND `GSTOVRDNTAXABILITY`
or `GSTOVRDNNATURE` filled. The entry is taken from the group with no check in two cases:
- 3.0-6.2 leaves out the tag for some voucher type or line;
- the ledger's taxability or nature is empty in the group while the object gives a type of supply (for example a
  ledger set "Use GST Classification", whose fields Tally may resolve only in the object export).

This matches the gate (2 test companies plus ZZ BIG TEST), but the gate does not prove it. A narrower rule would close
it: on 3.0-6.2, flag any line whose group type of supply is empty or missing, whatever the nature. Unknown means a probe,
and a ledger that holds no type is learned as "none" after one probe anyway, so the cost is small.

Suggested test: a converter test with a group line that has the tag and an empty nature, where the object gives
"Services". Assert the entry is not taken.

### L1. Probe entries left behind in `batchTOS.probe`

batch249.go:439 and daypull.go:834-838

batchTOSProbe is called inside fetchVoucherBatch before the answer is accepted. A later entry can make the answer
inexact (batch249.go:455), or pullBatchStep can stop after the parse (window hold `holdMs >= limit`, slow company).
Either way the probe registration stays, and so does a probe whose one-by-one read ends gone or moved. These entries
are removed only by a later read of the same MasterID. The amount is small but grows over a long run. Suggested test:
an inexact answer after an unknown entry; assert `batchTOS.probe` is empty, or cleared at pullDrop / pullStopCompany.

### L2. `batchTOS.known` has no size limit

It grows with the distinct ledgers / stock items × companies seen in the process. In practice it is limited by the
number of masters (about 100 B per key, so a few MB for a 50 000-item company), and never shrinks. Clearing it per day
or per company GUID (see H1 / M1) also fixes this.

### L3. The probing de-dupe is keyed on the whole unknown set

batch249.go:436-438

Entries with unknown {A} and {A,B} both become probes in one group, where one probe on {A,B} would settle both. This
only adds one-by-one reads, nothing wrong. Similarly, lines with no LEDGERNAME or STOCKITEMNAME share the key
`<list>|` across unrelated lines (that is the safe side).

### L4. The tests do not cover the failure paths

- TestR249GroupLeavesWhatItGivesOtherwise (r249batch_test.go:515) checks detection and Take/Learn on real 3.0
  answers, and that the ZZ BIG TEST entries taken equal the object answer. It calls Probe/Learn directly. It does not
  cover:
  - fetchVoucherBatch's `again` / `probing` path, or the inexact count with `again`;
  - company isolation (M1) or staleness (H1);
  - item invoices (LEDGERENTRIES→ALLLEDGERENTRIES), or ALLINVENTORYENTRIES / ACCOUNTINGALLOCATIONS keys on real data.

  The bound `learned > 5` is loose and does not pin the number of probes.
- TestR249PullProbeThenGroup (r249batch_test.go:608) covers only the "none" path, with synthetic data. It does not
  cover:
  - the "Goods" path in the pull loop (expected: 1 group, then 9 one by one, never another group);
  - a probe that fails (error, 2 s stop → pullStopCompany, gone);
  - two different unknown ledgers in one group, or the 2 s halving on the re-asked group.

  It also checks counts, not that the 9 entries taken equal FinComVoucherObject's answer.
- The 3.0-bdiff converter data has 5 entries from 2 companies, and no item invoice with a filled inventory line.

Suggested tests: the ones in H1, M1, M2 and M3, plus `TestR249PullProbeGoodsNoMoreGroups`.

## Security review

Range: 86dc851b9..f447764ca

- **Request shapes:** the delta adds no request builder and changes none. Probes use FinComVoucherObject. Re-asked
  `again` entries go through the existing fetchVoucherBatch, which builds only the testdata/batch249/b4-range.xml
  form (contiguous MasterIDs) or the b4-list.xml form. Ledger names read from Tally are used only as map keys, never put
  into a request or a log line. Nothing new is written to logs; existing lines keep company and MasterID only. No
  secrets are touched.
- **Poisoning:** what is learned comes only from the local Tally's FinComVoucherObject answers. A Tally operator can
  "poison" it only by changing masters, which is the staleness in H1. A remote party cannot reach it. Collisions
  across companies with the same name (M1) are the main way one company's learning can be applied to another.
- **Concurrency:** every read and write of `batchTOS.known` and `batchTOS.probe` holds `batchTOS.mu`. No lock order
  with `pull.mu` can deadlock: batchTOS functions never take `pull.mu` while holding `batchTOS.mu`. Take and Learn are
  separate lock sections, so a Learn between a Take and its use only makes the Take out of date. That leads to a
  one-by-one read or a re-ask (the safe side), or the H1 staleness, which does not depend on the race.
- **Availability:** M2 (quadratic re-asks when a probe does not settle) is the denial-of-service risk to Tally. It is
  limited by the 2 s stop and the window hold, but those then stop the company's period. L1 and L2 are small, slowly
  growing memory.
- **Integrity of tax data:** H1 (and M1, M3 to a lesser degree) is where an entry can reach FinCom with
  GSTOVRDNTYPEOFSUPPLY empty while FinComVoucherObject gives "Goods" / "Services". Data stays in the approved fields;
  the risk is a wrong value, not a leak.

Security findings above, by severity: High 1 (H1, integrity), Medium 2 (M1 integrity, M2 availability), Low 2 (L1,
L2). They are the same items as the code review and are not counted twice in the verdict.
