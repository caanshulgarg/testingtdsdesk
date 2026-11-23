# FinCom Bridge 2.5.19 and after: new Tally requests for the owner to approve

**Status (23-Nov-2026): B1, C1 to C8 and E are BUILT on branch `next-bridge-2519` as the owner decided below, each on the
allow-list as "NOT yet measured". Nothing has been sent to any real Tally yet, and nothing is released until each request
is timed on ZZ BIG TEST (the list at the end of this paper).** (The paper as first drafted, for the record:
DRAFT for the owner; nothing in it built, added to the allow-list or sent to any Tally.)
Each request below goes into the bridge only after the owner says yes to that exact request, and only after it has been
timed on the ZZ BIG TEST company under the 2-second rule. Written 23-Nov-2026 on branch `next-bridge-2519`.

## The owner's decisions (23-Nov-2026, given directly to the coordinator)

- B1 `FinComDayHeadsPart`: **approved**.
- C1 to C7 (`FinComBillOpenings`, `FinComVoucherTypes`, `FinComCostCentres`, `FinComCostCategories`, ISPOSTDATED on FinComVoucherObject/FinComVoucherBatch, `FinComGstRegistrations`, the added FinComLedgers fields): **approved**. A field name marked "to confirm" that changes after the ZZ TEST export goes back to the owner before it is built.
- C8 `FinComGroupClosing`: **approved, option (a)**: the daily tie-out may ask it in the background once a day (one request at a time, 2 s stop, typing gate).
- E (FinComTag before posting): **option (a)**: only for entries FinCom had handed out before (the job's released / resendOnly lists).
- Every request is still timed on ZZ BIG TEST under the 2-second rule before release; the stock reads (section D) are not decided.

---

## The one-page summary (plain English)

**Every request on this page only reads from Tally. None of them can create, change or delete anything in Tally.**
They are the same kind of question the bridge already asks every day ("send me this list"), never an Import. The usual
rules still apply to every one: one question at a time, each stopped at 2 seconds, postings first, and nothing asked
while someone is typing in Tally.

**Part B: very big days, read in the day in small pieces (for 2.5.19)**

| # | What it reads | Why | How it stays under 2 seconds |
|---|---|---|---|
| B1 | For a day too big to list in one go: the list of that day's entries (only their ID numbers and date, no amounts), a slice at a time | Tally is not open at night, so a very busy day has to be read in the day without freezing Tally | Each slice asks for one band of Tally's entry numbers, so it returns at most a few hundred to a few thousand short lines. The bridge makes the next slice smaller if the last one was slow |

What we found: today, when a day's list takes over 2 seconds, the bridge asks again one voucher type at a time. That
way of asking turns out to be slow: Tally looked at every entry of the day for each type (1.08 s for 503 entries on a
day of 2,216). On a day of about 4,000 entries or more, every type is over 2 seconds, so those days never get read. B1
uses the fast way of asking that the bridge already uses for groups of entries (measured on five Tally versions) and
lets the bridge read days of up to about 18,000 entries. Days bigger than that still go to "please upload the Day
Book", as today.

**Part C: what FinCom Books needs, accounts first (one later release)**

| # | What it reads | Why FinCom Books needs it |
|---|---|---|
| C1 | Opening bills of each bill-wise party (bill name, date, amount, credit days) | Receivables and payables ageing from the first day of the books |
| C2 | Voucher types (for example "Sales - Delhi" is a kind of Sales; how it is numbered) | Each entry is put under the right kind |
| C3 | All cost centres (names and where they sit) | Cost-centre reports; today only payroll employees are read |
| C4 | Cost categories | The same |
| C5 | One more Yes/No on each entry: "post-dated" | A post-dated cheque must stay out of the totals until its date |
| C6 | The company's GST registrations (TallyPrime 3.0 and later can hold several GSTINs in one company) | GST returns for each registration |
| C7 | More fields of each ledger: GST registration type, bill-by-bill on/off, credit days, MSME / Udyam, address | Party details for GST, ageing and MSME payments |
| C8 | Each main group's closing balance on a date (about 28 lines: Capital, Sundry Debtors ...) | The daily check that FinCom's books agree with Tally's |

C8 is the only one where Tally works out a figure (a balance). The rules forbid that today except the stock read on a
person's click, so C8 needs the owner's own decision: either (a) the daily tie-out may ask it in the background, once
a day, or (b) only when a person clicks "Check against Tally".

**Part E: look in Tally for FinCom's own mark before posting (a fix found by a review; no new request needed)**

Every entry FinCom posts carries its own mark in the narration ("TDSDesk:<id>"). Today the bridge does not look for that
mark in Tally before posting. The only guard against posting the same entry twice is this computer's own list of what
it has posted. So the same entry could go into Tally twice if a second computer posts it, or if FinCom hands out again
an entry that was let go after a stop. The fix: before posting, the bridge reads the entries already in Tally on that
date (only their numbers, type and narration, no amounts) and skips any entry whose mark is already there. **The
question it uses is already approved and on the list (FinComTag)**, but it has not been timed yet. It costs a little
posting time, so the owner is asked to choose: (a) look only for entries FinCom had handed out before (the cheap,
recommended way), or (b) look before every posting.

**Stock: a later release** (stock items and their openings, units, stock groups, godowns, batches, and the godown and
batch on each item line). Shown at the end so the owner can see what is coming; nothing to decide now.

**What the owner is asked to decide**
1. B1: yes or no to the exact request in section B.2.
2. C1 to C8: yes or no to each exact request in section C (the field names marked "to confirm" are checked on ZZ TEST
   first; if any name changes, the request is shown to the owner again before it is built).
3. C8: (a) or (b) above.
4. E: (a) or (b) above, and the timing of FinComTag on ZZ BIG TEST first (section E).

---

## Technical detail

All XML below is the exact request as the bridge's builders would make it (the bridge's `fcCollection` /
`formCollection` envelope), shown for the made-up company `SAMPLE CO`. In a real request only the values called
parameters change (company, date, MasterID bounds); everything else is fixed, byte for byte.

### How every new request is pinned (all of B and C)

As for every request today (`bridge-go/pinned.go`, round 5): each new id gets one builder, and `checkAllowed` lets a
request go only when it is byte-identical to what that builder makes from the request's own parameters, read back out
of the request (`pinCo` for the company, `pinDates` for the period, a strict regular expression for the MasterID
bounds). Another TYPE, FETCH field, filter or one character more is refused before anything is sent. Each id also gets a
row in `docs/tally-allowlist.md` and `bridge-go/allowlist.go` (`TestAllowListUnchanged`) with its measured worst case,
and its sample in `allowListSamples`. Numbers are digits only (no leading zero, 18 digits at most, as
`batchMidOK`); names are escaped by `esc` as the existing requests are. Nothing is sent "undated" where the period
matters (C1, C7 carry FinComLedgers' books' first year, as 2.5.0 decided).

### The 2-second plan common to all

The bridge's existing rules, unchanged: one request in flight per Tally (`tally.go`), the 2 s hard stop on every request,
Tally's window watched (held 2 s: that read stops for the company), postings and saves first, the six conditions before
every request, the typing gate (heavy tier: only after 60 s with no key in Tally, `daypace2516.go`). Every new request
is a heavy-tier, background, idle-only read unless said otherwise. A request stopped at 2 s is not asked again by itself
that day.

Pace data used for the estimates (all from `bridge-go/allowlist.go`, real TallyPrime 3.0 to 7.1 on ZZ BIG TEST):

| Request | Measured |
|---|---|
| FinComDayHeads, one day of 2,216 entries (heads only) | 376 ms worst |
| FinComDayHeads by type (d-MMM-yyyy and a date formula), 503 Purchase entries of that day | 1,080 ms worst |
| FinComVoucherBatch, 100 whole entries of a day of 2,216 / 7,601 entries (day as yyyymmdd TYPE=Date, MasterID filter) | 945 / 1,405 ms worst |
| FinComLedgers, a chunk of 2,000 MasterIDs at 20,000 ledgers | 278 ms worst (316 ms with 2.4.3's fields) |
| FinComEmployees (Cost Centre masters), a chunk of 2,000 MasterIDs, 1.55 MB | 163 ms worst |
| FinComTdsNatures (5,000 MasterIDs) | 5.6 ms worst |
| FinComStockInHand (one group's computed opening and closing, 32,000 entries) | 1.37 s worst; 2.37 s the first ask after Tally started |

---

## B. Heavy days read in the day, in pieces

### B.1 What the bridge sends today for a day, and why big days fail

1. **F1** `FinComDayHeads`, the whole day (the 2.4.5 approved form):

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComDayHeads</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20260401</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComDayHeads" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

2. **F2**, after F1 is stopped at 2 s (2.5.16): the same id, one voucher type at a time, the period in d-MMM-yyyy and a
   date formula in the filter:

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComDayHeads</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">1-Apr-2026</SVFROMDATE><SVTODATE TYPE="Date">1-Apr-2026</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComDayHeads" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE</FETCH><FILTERS>FinComDayHeadsOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComDayHeadsOnly">($Date &gt;= $$Date:&#34;1-Apr-2026&#34; AND $Date &lt;= $$Date:&#34;1-Apr-2026&#34;) AND $VoucherTypeName = &#34;Sales&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

3. Each type over 2 s: the day stops for 24 hours (`daystop2516.go`); on the 3rd failed day FinCom asks the person to
   upload that day's Day Book.

A simple cost model from the measurements: F1 costs about **0.17 ms per entry of the day** (376 ms / 2,216), so it
passes 2 s at about **11,700 entries** (1.35 s, the bridge's target, at about 7,900). F2 costs about **0.49 ms per entry
of the day for each type** (1,080 ms on a day of 2,216 entries, whatever the type's own count): the date formula is
worked out for every entry of the day. So every F2 request is over 2 s from about **4,100 entries a day**, well below
the point where F1 fails. **F2 therefore never rescues a day F1 could not read**; it only helps days that F1 found slow
because Tally was busy at that moment.

### B.2 What TallyPrime's collection requests allow for "a piece"

From TallyPrime's TDL collection attributes as the bridge uses them (and as far as we know, to be confirmed by the
measurement in B.5): a collection request has TYPE, CHILDOF / BELONGSTO, FETCH, FILTERS (formulae) and the period
(SVFROMDATE / SVTODATE). **There is no row limit, no "first N", no offset or paging.** The period cannot be narrower than
one day. So "a bounded number of vouchers" can only be made with a filter on a stored number that only grows:

- **MasterID** (chosen): given once when the entry is created and never changed by an alteration. A band of MasterIDs
  therefore holds the same entries from one piece to the next even while people edit in Tally; nothing moves between
  bands, so nothing is missed or read twice.
- AlterID (not chosen): changes on every alteration, so an entry altered between two pieces could move into a band
  already read (missed) or one still to come (read twice).
- One voucher type at a time in the fast date form (considered; see B.6): bounded by type, not by count. One type can
  be most of the day (a retailer's Sales), so it does not bound the piece.

The bridge already sends exactly this filter shape: `FinComVoucherBatch` (2.4.9) asks a day as
`yyyymmdd TYPE="Date"` with `$MasterID >= a AND $MasterID <= b`, measured on TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1
(6,280 requests, exactly the entries asked). Its two measurements give the cost of that filter: (1,405 − 945) ms over
(7,601 − 2,216) entries = **about 0.085 ms per entry of the day**, a fifth of F2's.

### B.3 The proposed request: B1 `FinComDayHeadsPart`

The heads of ONE day (F1's period form and F1's four fields, unchanged), only the entries whose MasterID is in a band.
A new id, so F1's measured row and its shape stay exactly as they are.

Parameters: company, day (yyyymmdd), a (≥ 1), b (≥ a; or no upper end for the last band).

A band with an upper end:

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComDayHeadsPart</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20260401</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComDayHeadsPart" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE</FETCH><FILTERS>FinComDayHeadsPartOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComDayHeadsPartOnly">$MasterID &gt;= 1 AND $MasterID &lt;= 4000</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

The last band (no upper end, so an entry created while the day is being read is not missed):

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComDayHeadsPart</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20260401</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComDayHeadsPart" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE</FETCH><FILTERS>FinComDayHeadsPartOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComDayHeadsPartOnly">$MasterID &gt;= 96001</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

Read-only: an Export of a Voucher collection, four stored fields, no figure Tally computes (`TestNoComputedFigure` needs
no exception: no $$ function, no balance, no CHILDOF).

**When it is sent.** Only for a day whose F1 was stopped at 2 s (or Tally's window held 1 s or more on it), instead of
F2, in the heavy tier (60 s with no key in Tally), in the day, one piece at a time with the usual gap, postings first.

**How the bands are chosen.**
1. The span is 1 to the company's highest voucher AlterID that the company check already gives (`FinComCompany`,
   AltVchId: a voucher's MasterID is never above it; confirmed in B.5 step 3). The last band has no upper end.
2. The first band is one sixteenth of the span. After each piece the bridge knows k (rows returned) and t (ms). It
   estimates the day's fixed cost w = t − 0.085·k (Tally looking through the day) and sizes the next band so that
   w + 0.085·k' ≈ 1,350 ms (the bridge's posting target), with k' at most 5,000 rows and the band at most doubled or
   halved from one piece to the next (the density of the last band says how many MasterIDs give k' rows).
3. A piece stopped at 2 s: that band is asked again in halves (as FinComVoucherBatch's groups are). A band of 200
   MasterIDs or fewer still stopped, or w alone over 1,700 ms (a piece of 300 rows would then pass about 1.73 s): the day is beyond pieces; it stops for 24 hours exactly
   as today (`pullStopDay`), and on the 3rd failed day the person is asked to upload it.
4. Every row is checked before use: its DATE is the day asked (round 18) and its MASTERID is inside the band. One row
   outside: the answer is dropped, the day is not read (as F1's date check does today).
5. The bands cover 1 to infinity once, end to end, without gaps or overlap; only then is the day's list complete. The
   heads then go to FinCom exactly as F1's list does, and the entries are fetched by the existing FinComVoucherBatch /
   FinComVoucherObject. (FinCom's cloud, tally-ingest, must accept a list made of bands as a whole day, unlike F2's
   type-by-type list, which it never closes a day on. That is a cloud change, drafted with the bridge change.)

**Size and time per piece (estimate).** Rows are about 120 bytes each (four short fields). With w = 0.085 ms × entries of
the day:

| Entries that day | F1 (one go) | w (each piece) | Rows a piece at 1.35 s | Pieces for the day | Bytes a piece |
|---|---|---|---|---|---|
| 8,000 | 1.36 s (F1 passes) | 0.68 s | about 5,000 (cap) | 2 | ≤ 600 KB |
| 12,000 | 2.0 s, stopped | 1.02 s | about 3,900 | 4 | ≤ 470 KB |
| 15,000 | 2.6 s, stopped | 1.28 s | about 900 | 17 | ≤ 110 KB |
| 18,000 | 3.1 s, stopped | 1.53 s | 300 (1.35 s cannot be met; each piece about 1.56 s, under the stop) | 60 | ≤ 36 KB |
| 21,000 or more | stopped | 1.8 s or more | none | — | upload, as today |

So B1 lifts the biggest day the bridge can read in the day from about 11,700 entries to about 18,000, and every piece
is aimed at 1.35 s and stopped at 2 s like every other request. The pieces of an 18,000-entry day take about 100 s of
Tally time in all, spread over the day's idle minutes.

**Pinned.** Rebuilt from its parameters: `pinCo`, the day from `pinDates` (SVFROMDATE = SVTODATE, `yyyymmdd TYPE="Date"`
only), a and b from `\$MasterID &gt;= (\d+)(?: AND \$MasterID &lt;= (\d+))?</SYSTEM>`, then
`dayHeadsPartRequest(co, day, a, b)` must give the same bytes. a < 1, b < a, a leading zero, more than 18 digits, a
second filter or any other field: refused before sending. Only the day pull calls it.

### B.4 The bridge change that goes with B1 (not written yet)

In `pullHeadsStep`: after F1 is stopped, B1's bands instead of F2 (F2 kept only for a day FinCom names types for and
that F1 found slow but under 4,000 entries, if the owner wants it kept at all; otherwise F2 is no longer sent). A new
pace form `part` (always heavy). The "split" stop words stay for a day finished in bands only if the cloud is older.
Test-first on the stand-in Tally: a 15,000-entry made-up day whose F1 is slow, read in bands; every band under the stop;
the union equals the day; an entry created between pieces appears in the last band; a row outside its band drops the
answer.

### B.5 Test plan on ZZ BIG TEST (before the owner's final yes is turned into a build)

On NWS144 and on the tally-versions runners (TallyPrime 3.0, 4.1, 5.1, 6.2, 7.1), ZZ BIG TEST re-dated as for 2.4.5:
1. Make days of 2,216, 7,601, 12,000, 15,000 and 18,000 made-up entries (`tests/fixtures/big/make_big_company.py`).
2. For each day: F1 once; then B1 with bands of 500, 1,000, 2,000 and 5,000 rows. Record t, rows, bytes and Tally's
   window hold for each piece. Pass: every piece the bridge would send is under 2 s (aim 1.35 s) and the window is never
   held 2 s.
3. Check the span rule: on each release, the highest MasterID of any voucher is not above the company's AltVchId, and
   write down by how much AltVchId is above it (as built, the first band is cut to a sixteenth of the highest entry
   number the bridge has seen when that is lower).
4. Check exactness: the union of a day's bands equals F1's list for the 2,216 and 7,601 days (same GUIDs, MasterIDs,
   AlterIDs), on every release; no row of another date; no row outside its band.
5. Check the fixed cost: for the same day, a band returning 10 rows and one returning 5,000; the difference gives the
   per-row cost and confirms w (0.085 ms an entry) on each release. Put the worst case and date in the new row.
6. While a piece is at Tally, type in Tally on NWS144: Tally stays usable (window hold under 1 s).

### B.6 Considered and not proposed

- **One voucher type at a time, fast form** (F1's period plus `$VoucherTypeName = "Sales"`): the same fixed cost as B1,
  but no bound on rows; a day that is mostly one type fails just as F1 does.
- **CHILDOF a voucher type** (`Vouchers : VoucherType`): might let Tally look only at that type's entries, but CHILDOF
  is barred by the computed-figure rule (written for ledgers), it is unmeasured, and it still does not bound the count.
  Could be measured later in the measuring tool only, if days over 18,000 entries turn out to be common.
- **AlterID bands**: see B.2 (an entry edited between pieces can be missed).

---

## C. FinCom Books: accounts reads (first release)

Each is an Export of a collection of stored master fields (C8 excepted, see there). Each is asked once at Connect Tally
and again only when Tally's master counter (AltMstId, already read by the company check) moves, as the ledger list
is today. Heavy tier, background, idle only. Field names marked **(to confirm)** are checked first on ZZ TEST by a person
exporting one made-up master from TallyPrime 3.0 and 7.1 (Export, XML); a name that differs changes the request, which is
then shown to the owner again.

### C1 `FinComBillOpenings`: opening bills of bill-wise ledgers

Parameters: company, the books' first day (as FinComLedgers: SVFROMDATE = BOOKSFROM, SVTODATE a year on less a day),
MasterID chunk (after, upto]. Chunks of 500 MasterIDs (a quarter of the ledger chunk: a party can hold many bills).

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComBillOpenings</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20250401</SVFROMDATE><SVTODATE TYPE="Date">20260331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComBillOpenings" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, ISBILLWISEON, BILLALLOCATIONS.NAME, BILLALLOCATIONS.BILLDATE, BILLALLOCATIONS.OPENINGBALANCE, BILLALLOCATIONS.BILLCREDITPERIOD, BILLALLOCATIONS.ISADVANCE</FETCH><FILTERS>FinComBillOpeningsOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComBillOpeningsOnly">$IsBillWiseOn AND $MasterID &gt; 0 AND $MasterID &lt;= 500</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- Reads: the opening bills stored on the ledger master (Tally's "bill-wise details" of the opening balance). Stored, not
  worked out; the period is there only so the opening is as at the books' beginning, as FinComLedgers (2.5.0). The
  computed-figure test's books'-year exception (`booksYearLedgerRead`) is widened to this exact request.
- Size: ZZ BIG TEST has 20,000 ledgers; with (say) 5,000 bill-wise parties of 10 opening bills each, a chunk of 500
  MasterIDs holds about 125 parties and 1,250 bills, about 300 KB.
- 2 s: the ledger chunk of 2,000 took 278 ms worst; a chunk of 500 with bills is estimated at 0.15 to 0.4 s. Halved on a
  stop, down to 50 MasterIDs; a chunk of 50 still stopped: that company's bill openings are not read (FinCom says so).
- Pinned: rebuilt from `pinCo`, `pinLedgerFrom` and `pinMasterRange`, as FinComLedgers.

### C2 `FinComVoucherTypes`: voucher-type masters

Parameters: company, MasterID chunk of 2,000 (a company has 20 to 200 types, so one request in practice).

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComVoucherTypes</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComVoucherTypes" ISMODIFY="No"><TYPE>VoucherType</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, PARENT, NUMBERINGMETHOD, ISACTIVE, AFFECTSSTOCK, ISOPTIONAL, ISDEEMEDPOSITIVE, GSTREGISTRATION</FETCH><FILTERS>FinComVoucherTypesOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComVoucherTypesOnly">$MasterID &gt; 0 AND $MasterID &lt;= 2000</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- Reads: each type's name, its base type (PARENT: "Sales - Delhi" under Sales), numbering method, active, affects stock,
  optional by default, and (TallyPrime 3.0+) the GST registration it posts under: `GSTREGISTRATION` **(to confirm)**.
- Size: 200 types × about 400 bytes = 80 KB at most. Time: like FinComTdsNatures (5.6 ms for its masters); under 0.1 s.
- Pinned: `pinCo` and `pinMasterRange`.

### C3 `FinComCostCentres`: every cost centre

The employees read (FinComEmployees) already walks the Cost Centre masters but keeps payroll rows only. A separate id
for all centres, **without** the employee fields (PAN, joining date, designation are not asked), so the payroll read and
its rule (other centres dropped) stay as they are.

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComCostCentres</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComCostCentres" ISMODIFY="No"><TYPE>CostCentre</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, PARENT, CATEGORY, FORPAYROLL, ISEMPLOYEEGROUP</FETCH><FILTERS>FinComCostCentresOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComCostCentresOnly">$MasterID &gt; 0 AND $MasterID &lt;= 2000</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- Size: about 150 bytes a centre; 2,000 centres 300 KB. Time: FinComEmployees' chunk of 2,000 with more fields, 1.55 MB,
  was 163 ms worst; this one is estimated under 0.15 s.
- Employee rows (FORPAYROLL Yes) are dropped here before anything is logged, stored or sent; they come from
  FinComEmployees as now.
- Pinned: `pinCo` and `pinMasterRange`.

### C4 `FinComCostCategories`: cost categories

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComCostCategories</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComCostCategories" ISMODIFY="No"><TYPE>CostCategory</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, ALLOCATEREVENUE, ALLOCATENONREVENUE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- A company has a handful (Tally's "Primary Cost Category" and a few more): under 10 KB, under 0.05 s. One request.
- Pinned: `pinCo` only (no other parameter).

### C5 The post-dated flag on entries (a changed request, not a new id)

`ISPOSTDATED` (Tally's stored Yes/No on a voucher) added at the end of the fields of the two entry requests, which
FinCom's copy of each entry comes from:

- `FinComVoucherObject`: **as built (23-Nov-2026), its request is NOT changed**: Tally sends the whole voucher for this
  request whatever its FETCHLIST says, so only `ISPOSTDATED` was added to the fields its strip keeps
  (`TestR2519PostDatedMark`). No new shape; the time check (item 6 of the list at the end) is kept anyway. The paper
  first proposed this request (not built):

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Object</TYPE><SUBTYPE>Voucher</SUBTYPE><ID TYPE="Name">ID:1</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><FETCHLIST><FETCH>GUID</FETCH> ... <FETCH>ISPOSTDATED</FETCH></FETCHLIST></DESC></BODY></ENVELOPE>
```

- `FinComVoucherBatch`: `, ISPOSTDATED` appended to its frozen FETCH (its `batchFetchSHA` changes with it, the one
  change), so a group's entries and a single entry's are kept alike (`TestR2512GroupRequestAs2511`'s rule).
- Not changed: the Day Book report (a report's fields cannot be added), the heads lists, the posting read-backs.
- Size and time: one short field per entry: under 1% more bytes; time as measured (2.2 s worst a 500-employee payroll
  entry under its 3 s stop, 1.41 s worst a group of 100). Re-measured on ZZ BIG TEST with the field, both rows' times
  replaced.
- Pinned: as now (the builders change; the rebuild compares against the new builders).
- Use: FinCom keeps a post-dated entry out of the totals until its date (FULL-BOOKS-PLAN 3.4).

### C6 `FinComGstRegistrations`: the company's GST registrations

TallyPrime 3.0 and later keep each GST registration of a company as its own master ("GST Registration"; the internal
collection type is `TaxUnit` **(to confirm)**). Today `TDSDeskCompanyInfo` reads the company's GSTREGISTRATIONDETAILS
and the bridge keeps the first GSTIN only (`ports.go`). For earlier releases (2.x) that stays the source.

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComGstRegistrations</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComGstRegistrations" ISMODIFY="No"><TYPE>TaxUnit</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, GSTREGNUMBER, STATENAME, GSTREGISTRATIONTYPE, APPLICABLEFROM, ISACTIVE</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- Fields: the registration's name, GSTIN, state, registration type (regular / composition ...), from when, active.
  `TaxUnit`, `GSTREGNUMBER`, `STATENAME`, `GSTREGISTRATIONTYPE`, `APPLICABLEFROM`, `ISACTIVE` all **(to confirm)** on
  TallyPrime 3.0 and 7.1. On a release that has no such masters Tally answers an empty list (to confirm on 2.1): then
  the bridge keeps using TDSDeskCompanyInfo.
- Size: 1 to 30 registrations, under 10 KB; under 0.05 s. Once at Connect Tally and when AltMstId moves.
- Pinned: `pinCo` only.

### C7 More ledger fields (a changed request: the ledger list's FETCH grows)

FinComLedgers, FinComLedgerChanges and FinComLedgerByName share one FETCH (`ledgers.go`); the new fields are appended
to it, at the end, in this order. The rest of the three requests is unchanged (period, chunks of 2,000 MasterIDs or 200
AlterIDs, filters). FinComLedgers with the new fields:

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComLedgers</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20250401</SVFROMDATE><SVTODATE TYPE="Date">20260331</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComLedgers" ISMODIFY="No"><TYPE>Ledger</TYPE><FETCH>GUID, MASTERID, ALTERID, NAME, PARENT, OPENINGBALANCE, PARTYGSTIN, INCOMETAXNUMBER, LEDGSTREGDETAILS.LIST, LEDSTATENAME, TDSDEDUCTEETYPE, TDSRATENAME, TDSDEDUCTEEISSPECIALRATE, TDSDEDUCTEESPECIALRATE, LOWERDEDUCTION.NATUREOFPAYMENT, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.FROMDATE, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.TODATE, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.SECTIONNO, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.CERTIFICATENO, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.TDSITRATE, LOWERDEDUCTION.LOWERDEDUCTIONDETAILS.LOWERDEDUCTIONLIMIT, PAYTYPE, PAYSTATTYPE, ITCOMPONENT, FORPAYROLL, GSTREGISTRATIONTYPE, ISBILLWISEON, BILLCREDITPERIOD, ISCOSTCENTRESON, LEDMAILINGDETAILS.LIST, ADDRESS.LIST, PINCODE, COUNTRYNAME, LEDMSMEREGDETAILS.LIST</FETCH><FILTERS>FinComLedgersOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComLedgersOnly">$MasterID &gt; 0 AND $MasterID &lt;= 2000</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- New: `GSTREGISTRATIONTYPE` (regular, composition, unregistered, consumer ...; older releases; TallyPrime 3+ has it
  inside LEDGSTREGDETAILS.LIST, already fetched), `ISBILLWISEON`, `BILLCREDITPERIOD`, `ISCOSTCENTRESON`,
  `LEDMAILINGDETAILS.LIST` (TallyPrime 3+: address, state, pincode, country), `ADDRESS.LIST`, `PINCODE`, `COUNTRYNAME`
  (older releases), `LEDMSMEREGDETAILS.LIST` (MSME / Udyam type and number) **(the last two list names to confirm)**.
- Size: addresses add about 150 to 300 bytes a ledger: a 2,000 chunk grows by about 0.3 to 0.6 MB, an estimated 30 to 40%
  more time: about 0.4 s worst (278 ms today). If it measures over 1 s, the chunk becomes 1,000 MasterIDs (a builder
  constant; the shape is the same).
- Pinned: as now; the three rows' shapes change, so the three are measured again.

### C8 `FinComGroupClosing`: closing balances of the main groups at a date (the daily tie-out)

**A figure Tally works out.** The rules (`TestNoComputedFigure`) allow that today only for FinComStockInHand on a
person's click. C8 needs the owner's decision: (a) the daily tie-out may ask it in the background, at most once a day per
company, or (b) only when a person clicks "Check against Tally" in FinCom (as the stock read).

Parameters: company, the date D (yyyymmdd); SVFROMDATE is the first day of D's financial year in that company
(from TDSDeskCompanies' STARTINGFROM), SVTODATE = D.

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComGroupClosing</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE TYPE="Date">20260401</SVFROMDATE><SVTODATE TYPE="Date">20261122</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComGroupClosing" ISMODIFY="No"><TYPE>Group</TYPE><FETCH>GUID, NAME, PARENT, CLOSINGBALANCE</FETCH><FILTERS>FinComGroupClosingOnly</FILTERS></COLLECTION><SYSTEM TYPE="Formulae" NAME="FinComGroupClosingOnly">$Parent = &#34;&#34;</SYSTEM></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- Reads: the primary groups (their PARENT is empty; **to confirm** on 3.0 and 7.1 that `$Parent = ""` picks exactly
  them; if not, the filter is dropped and the bridge keeps only rows with an empty PARENT before anything is logged,
  stored or sent, and the request is shown again) with each one's closing balance at D. About 28 rows, under 5 KB.
- Opening balances are not asked (FinCom has them from FinComLedgers).
- 2 s: FinComStockInHand, one computed group, took 1.37 s worst at 32,000 entries and 2.37 s on the first ask after
  Tally started (stock valuation is much heavier than ledger balances, which Tally keeps as it posts). Plan: asked only
  after the company's other reads of the day have answered (Tally warm), never as the first request after Tally starts;
  stopped at 2 s; a stop or a window held 2 s: not asked again that day, and FinCom shows "Tie-out: Tally was slow,
  tried tomorrow". If ZZ BIG TEST at 100,021 entries measures it over 1 s, it becomes one primary group a request
  (filter `$Name = "<group>"`, about 28 requests, each under the stop).
- Pinned: `pinCo`, `pinDates` (SVFROMDATE must be the financial year start for D, SVTODATE = D, `yyyymmdd TYPE="Date"`),
  the filter fixed; a widened exception in `computedFigure` for exactly this request as built (as `stockClickRead`).
- Not proposed now: ledger-by-ledger closing for a group that differs (FULL-BOOKS-PLAN 3.5); a later paper if needed.

### C. Test plan (each request) on ZZ BIG TEST

1. A person exports one made-up master of each kind (bill-wise party, voucher type, cost centre, category, GST
   registration, ledger with address and MSME details) from TallyPrime 3.0 and 7.1 on ZZ TEST and checks every field
   name marked "to confirm". Any change: the request is shown to the owner again.
2. ZZ BIG TEST at 20,000 ledgers (5,000 bill-wise, 10 opening bills each), 200 voucher types, 2,000 cost centres, 5 GST
   registrations, 100,021 entries, on TallyPrime 3.0, 4.1, 5.1, 6.2, 7.1: each request and each chunk timed and Tally's
   window watched. Pass: under 2 s worst on every release (aim 1.35 s), window never held 2 s.
3. Exactness: C1's bills against Tally's own "Bills Receivable / Payable" as at the books' start; C2 to C4 counts against
   Tally's lists; C5 a made-up post-dated entry reads Yes, an ordinary one No; C7 the new fields against the ledger's
   screen; C8 against Tally's own Trial Balance at D (each primary group, to the paisa).
4. Background behaviour: with someone typing in Tally on NWS144, none of these goes; with Tally left alone 60 s, they go
   one at a time after any posting.
5. The rows' worst times and dates go into `docs/tally-allowlist.md` and `allowlist.go` before any build.

---

## E. Looking for FinCom's mark in Tally before posting (the coordinator's review item of 23-Nov-2026)

### E.1 What the review found (checked on this branch)

- `findPostedTags` (`bridge-go/post.go`, about line 724) and `dupCheck` / `dupCheckWith` (`bridge-go/dupcheck.go:239`)
  exist but **nothing outside the tests calls them** (checked with a search of every non-test file). The posting path's
  only duplicate guard is this computer's own record (`posted-ids.json`, accepted.go). Entries posted by a second
  computer, or a job FinCom released and handed out again, are not looked for in Tally before they are sent.
- `tagsOnDate` (the read both use) is called today only after a posting (`findAccepted`, the read-back: by Tally's
  voucher id, then by the mark on the date) and by the night's empty-day check (`keep.go`).

### E.2 The request is already on the list: no new XML

`findPostedTags` → `tagHeadsOn` → `tagsOnDate` sends exactly `tagCheckRequest(company, date)`, id **FinComTag**:

```xml
<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>FinComTag</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>SAMPLE CO</SVCURRENTCOMPANY><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20260401</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="FinComTag" ISMODIFY="No"><TYPE>Voucher</TYPE><FETCH>GUID, MASTERID, ALTERID, DATE, VOUCHERTYPENAME, VOUCHERNUMBER, NARRATION, ISOPTIONAL, ISCANCELLED</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>
```

- On the allow-list: row "FinComTag | the FinCom id check: one date's entries, heads and narration only | c6adb1e0d825 |
  **not yet measured** | - | bridge" (`docs/tally-allowlist.md`); pinned to its builder (`pinned.go`: rebuilt from
  `pinCo` and the date); classed as a posting's read (`isPostingRequest`, `tally.go`), so it goes before any other
  request waiting for that Tally; one in flight as every request.
- **Not measured.** Two things must be measured before it is wired in:
  1. **Time.** Estimate from F1 (0.17 ms per entry of the day for four fields; this has nine, the narration the longest):
     about 0.25 ms per entry of the date, so about 0.55 s for a date of 2,216 entries, 1.35 s at about 5,400, 2 s at
     about 8,000. Posting dates are usually far smaller (tens to a few hundred entries: under 0.1 s).
  2. **The date form.** It carries the period as plain `yyyymmdd` (no `TYPE="Date"`), the form round 18 found answered
     for Tally's current period on NWS144. The answer's rows must therefore be checked to be of the date asked (as
     every day read is); if the measurement shows the plain form is not applied on a release, the request must change to
     `yyyymmdd TYPE="Date"` (F1's form): that is a changed request and comes back to the owner as exact XML first.

### E.3 Proposed wiring (bridge change only, once measured)

1. **When.** Before the first part of a posting job that holds an entry for a date, one FinComTag for that date (one
   request per distinct date of the job, not per part). Option (a), recommended: only for the job's entries FinCom marks
   as handed out before (the job's `released` / `resendOnly` lists, `cloud.go`, `jobs.go`) and for any entry this
   computer has no record of sending but FinCom says was sent before. Option (b): every date of every job.
2. **Why once per job is enough.** Postings to a company already serialize across computers through FinCom's lease
   (`safety.go`, decision D, 05-Oct-2026: "a posting never yields; two postings serialize"), so no other computer posts
   to that company while this job holds the lease. What the check must catch is an entry that went in before this job
   started. The read is kept for the job only (as `dupCheckWith`'s cache) and never used after the lease is let go.
3. **What happens to the answer.** An entry whose mark `TDSDesk:<id>` is in a narration of that date (and the entry is
   not cancelled): not sent; reported to FinCom as posted already, with Tally's GUID and MasterID (as the read-back does),
   and written to `posted-ids.json`. Any row of another date: the answer is not used.
4. **The 2 s rule and one in flight.** Sent with the posting's own priority, under the 2 s hard stop (a `TC` with
   `limitMs` 2000; the posting `fin` has none today). Stopped, not answered or not usable: nothing of that date is
   guessed. Option (a): the entries that needed the check wait ("Not posted yet: Tally was busy while FinCom checked
   for a copy; tried again shortly"), the rest of the job goes. A date stopped twice: those entries are held for a
   person (Check Tally), never sent unchecked.
5. **Cost against "posting never slower than before".** Option (a): no cost for an ordinary job (no entry handed out
   before); a released job pays one read per date of its released entries. Option (b): a 40-bill job over 20 dates
   pays 20 reads of about 0.05 to 0.5 s each, against about 20 parts of 1.35 s: up to about a third slower in the worst
   case, which breaks the owner's condition. Hence (a) is recommended.
6. **Test-first** on the stand-in Tally: a released job whose entry is already in Tally with its mark is not sent and is
   reported posted; an entry not there is sent; a stopped check sends nothing of that date; a mark in a cancelled entry
   does not count; another computer's posting of the same entry before the job (two stand-in bridges, one stand-in
   Tally) is not posted twice; posting time of an ordinary 40-bill job unchanged.

### E.4 Test plan on ZZ BIG TEST

On TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (and NWS144): FinComTag for dates of 50, 500, 2,216 and 7,601 entries, timed
and Tally's window watched; every row of the date asked (the plain date form applied); a made-up entry with its mark
found. Pass: under 2 s for the dates postings use (aim 1.35 s); the worst case and date go into the FinComTag row of
`docs/tally-allowlist.md` and `allowlist.go`. If the plain date form is not applied on any release: stop and show the
owner the changed request (E.2).

---

## D. Stock reads: a later release (short; nothing to decide now)

Each will be shown to the owner as exact XML in its own paper before it is built. Outline:

| Id (planned) | Collection | Fields (stored) | Chunks | Note |
|---|---|---|---|---|
| FinComStockItems | StockItem | GUID, MASTERID, ALTERID, NAME, PARENT, CATEGORY, BASEUNITS, GSTDETAILS.LIST (HSN, rate), OPENINGBALANCE, OPENINGVALUE, OPENINGRATE, BATCHALLOCATIONS.LIST (opening by godown and batch) | 2,000 MasterIDs | the openings carry the books' first year, as FinComLedgers |
| FinComStockGroups | StockGroup | GUID, MASTERID, ALTERID, NAME, PARENT | one | |
| FinComStockCategories | StockCategory | GUID, MASTERID, ALTERID, NAME, PARENT | one | |
| FinComUnits | Unit | GUID, MASTERID, ALTERID, NAME, ISSIMPLEUNIT, BASEUNITS, ADDITIONALUNITS, CONVERSION | one | |
| FinComGodowns | Godown | GUID, MASTERID, ALTERID, NAME, PARENT | one | |
| (changed) FinComVoucherObject / FinComVoucherBatch | Voucher | add ALLINVENTORYENTRIES.BATCHALLOCATIONS.GODOWNNAME, .BATCHNAME, .BILLEDQTY, .AMOUNT | as now | godown and batch on each item line |

The 2.5.2 measurement company (4,000 items with godowns and batches) is the test bed. Item counts are larger than
ledger counts in some trades, so the chunk may be 1,000.

---

## Built (23-Nov-2026, branch `next-bridge-2519`): what the owner still has to check

### Names still "to confirm" (switched off until a person's ZZ TEST export confirms them)

Each switch is a setting, off by default. With it off the request is built without the name (or, for C6 and C8, not
sent at all). It is turned on only after one made-up master of that kind, exported (Export, XML) from TallyPrime 3.0
and 7.1 on ZZ TEST, shows exactly these names. A name that differs goes back to the owner as exact XML first.

| Switch | Request | Names to confirm | While off |
|---|---|---|---|
| `Confirmed2519VchTypeGst` | C2 FinComVoucherTypes | `GSTREGISTRATION` on a voucher type | asked without it |
| `Confirmed2519GstRegs` | C6 FinComGstRegistrations | the collection `TaxUnit`; `GSTREGNUMBER`, `STATENAME`, `GSTREGISTRATIONTYPE`, `APPLICABLEFROM`, `ISACTIVE`; an empty list on TallyPrime 2.1 | never sent (the first GSTIN from TDSDeskCompanyInfo, as today) |
| `Confirmed2519LedgerLists` | C7 the ledger list's fields | `LEDMAILINGDETAILS.LIST` (and inside it ADDRESS, STATE, PINCODE, COUNTRY), `LEDMSMEREGDETAILS.LIST` (MSMEENTERPRISETYPE, UDYAMREGNUMBER) | the ledger requests asked without the two lists |
| `Confirmed2519GroupClosing` | C8 FinComGroupClosing | `$Parent = ""` picks exactly the primary groups | never sent (no tie-out) |

### The manual ZZ BIG TEST timing list (before release; every request under 2 s worst, aim 1.35 s, Tally's window never held 2 s)

On TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (and NWS144), ZZ BIG TEST as in B.5 and C (20,000 ledgers, 5,000 bill-wise with
10 opening bills each, 200 voucher types, 2,000 cost centres, 5 GST registrations, 100,021 entries):

1. B1 FinComDayHeadsPart: days of 2,216, 7,601, 12,000, 15,000 and 18,000 entries; bands of 500, 1,000, 2,000 and 5,000
   rows; t, rows, bytes and window hold for each band; the union of the bands equals F1's list (2,216 and 7,601 days);
   the highest voucher MasterID is not above AltVchId (write down AltVchId and the highest MasterID: by how much it is
   above); a 10-row band against a 5,000-row band (the per-row cost, 0.085 ms
   an entry expected); typing in Tally while a band is at Tally (window hold under 1 s).
2. C1 FinComBillOpenings: every chunk of 500 MasterIDs at 5,000 bill-wise parties (estimate 0.15 to 0.4 s); the bills
   against Tally's own Bills Receivable / Payable at the books' start. As built it is read at most once a day.
3. C2 FinComVoucherTypes: the one request at 200 types (estimate under 0.1 s); with `GSTREGISTRATION` once confirmed.
4. C3 FinComCostCentres: each chunk of 2,000 at 2,000 centres (estimate under 0.15 s). Also on ZZ TEST with payroll on
   (TallyPrime 3.0 and 7.1): export an employee and check it answers FORPAYROLL Yes; then check that no employee name
   and no employee group reaches FinCom by this read (the bridge drops FORPAYROLL rows, employee groups and every centre
   under one, the security review's I2).
5. C4 FinComCostCategories: the one request (estimate under 0.05 s).
6. C5 ISPOSTDATED: FinComVoucherBatch, a group of 100 entries of the 2,216 and 7,601 days (was 945 / 1,405 ms worst);
   FinComVoucherObject a 500-employee payroll entry (was 2.2 s worst under its 3 s stop) and an ordinary entry; a made-up
   post-dated entry reads Yes, an ordinary one No.
7. C6 FinComGstRegistrations: the one request at 5 registrations (estimate under 0.05 s); on TallyPrime 2.1 an empty list.
8. C7 FinComLedgers (chunk of 2,000 MasterIDs at 20,000 ledgers with addresses: was 278 ms, estimate about 0.4 s; over 1 s:
   the chunk becomes 1,000), FinComLedgerChanges (a window of 200 AlterIDs), FinComLedgerByName (one ledger); then again
   with `LEDMAILINGDETAILS.LIST` and `LEDMSMEREGDETAILS.LIST` once confirmed.
9. C8 FinComGroupClosing: the one request at 100,021 entries, after the company's other reads (Tally warm) and also as
   the first request after Tally starts (for the record; the bridge never sends it first); against Tally's Trial Balance
   at the day, each primary group to the paisa. Over 1 s: one primary group a request instead (shown to the owner first).
10. E FinComTag (already on the list, never measured): dates of 50, 500, 2,216 and 7,601 entries; every row of the date
    asked (the plain yyyymmdd period applied on every release; if not, the request must change and comes back to the
    owner); a made-up entry with its mark found.
11. Background behaviour: with someone typing in Tally on NWS144 none of B1, C1 to C4, C6 or C8 goes; with Tally left
    alone 60 s they go one at a time after any posting.

The worst time and date of each go into its row in `docs/tally-allowlist.md` and `bridge-go/allowlist.go` before release.

### The review fixes of 23-Nov-2026 (code review B1, B2, N1 to N8; security review L1, I1, I2, I4)

- E is looked for again whenever it could be stale: the look is the worker run's own (a job resumed after a stop or
  handed back looks again), and again before the next part whenever FinCom's lease had to be taken anew (B1).
- A look is used only when Tally's answer is whole and every entry in it is of the date asked; one entry of another
  date or an answer cut short: the look failed, nothing of that date is sent (B2).
- Held for a person with plain words, never sent unchecked: a re-sent entry with no FinCom mark or no date (N1); the
  entries of a date whose look failed twice (E.3.4, N2); entries beyond the first 7 dates of one posting (I1). The look
  keeps its 2 s stop whatever RecorderLimitMs says, and matches the ids as a release does (N1).
- On a mark found, only this computer's record is written; the local copy takes the entry only when Tally's entry is
  the one sent by type, date and party, else the keeper reads it (L1).
- B1's first band is cut to a sixteenth of the highest entry number seen when that is below AltVchId (N4); C1 at most
  once a day (N7); cost centres also drop employee groups and every centre under one (I2); the tray's Quit reads "Hide
  this icon (reading continues; the icon comes back in 10 minutes)" (I4).
