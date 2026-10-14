# Fixed assets and depreciation

Books → Accounts → Fixed assets & depreciation (`app/src/screens/books/FixedAssets.jsx`); the rules are FAR,
`src/js/80-assets.js`; the Assistant's `depreciation_schedule` (`server/assistant/tools/depreciation.ts`) reads the
register through migration 81 (`asst_dep_register`). Built on branch `depreciation` (owner's approval of 14-Oct-2026).

## The rules and defaults: approved by the owner on 14-Oct-2026 ("ok for depreciation")

1. Schedule II, Part C useful lives (as amended in 2014), as tabled in `FAR.SCH2`. Intangible assets have no default life;
   it is typed (AS 26 / Ind AS 38).
2. Residual value 5% of cost by default; nil for intangible assets.
3. Written down value by default for the client; straight line for intangible assets.
4. Assets held at the start: the carrying amount less the residual over the remaining life (for WDV the rate is worked
   again over the remaining life). The remaining life counts whole months plus the days left ÷ 365; when not known, the
   full life is assumed and asked about in the Confirm list.
5. Days are counted from the date put to use, and up to the date of sale, both days included.
6. Accumulated depreciation kept per block is spread over the block's assets in proportion to cost; with no
   accumulated-depreciation ledger, the opening is taken as cost.
7. A sale takes the whole asset unless the cost of the part sold is given.
8. Income tax: the sale value first reduces the full-rate part; depreciation is rounded to the rupee; a block whose
   assets are all sold, scrapped or transferred out is emptied (a short-term capital loss if value is left); transfers
   stay out of the blocks.
9. Additional depreciation (section 32(1)(iia)) is off by default: 20%, by default only on general plant and
   machinery, editable per addition; the unused half is carried to the next year; none when the block has a capital gain
   or loss.
10. Deferred tax at 25.168% for a company and 31.2% for others until a rate is given; a block's opening is last year's
    closing in FinCom when kept, else typed (taken as 0 and asked for).

## By entity type (decided on 14-Oct-2026, after the owner's question)

The owner asked: "If the organisation is a firm or proprietor, why is the system calculating depreciation as per the
Companies Act, and why deferred tax?" Decided the same day:

- The entity is the one the statements use: the layout chosen there, else Client setup's entity or the PAN's fourth
  letter (`FAR.entityOf`).
- **A company:** unchanged. Schedule II in the books, the income-tax blocks for tax, deferred tax under AS 22.
- **A firm, LLP, proprietor, trust, HUF or AOP:** no Schedule II. **The books default to depreciation at the Income-tax
  rates** (written down value, block by block, half the rate under 180 days). That is one schedule for the books and
  for tax, so there is no timing difference and **no deferred tax**. The statements' fixed-asset note is then the block
  schedule (the ICAI format for non-corporate entities). In the register each block's charge is shared among the assets
  still held, in proportion to what the rate works on. A sold asset's sale value comes off the block, as the block
  method has it, so no profit or loss is booked on it.
- The client can choose its own book policy instead (Fixed assets & depreciation, The client's defaults, The books):
  straight line or WDV over the useful lives the firm sets, without Schedule II wording. Only then do the books and
  tax differ.
- **To confirm by owner:** deferred tax for a non-corporate entity is shown only when its own policy differs from tax
  AND its ICAI level applies AS 22. Levels I to III apply AS 22; Level IV accounts for current tax only, so it gets no
  deferred tax. The level is the statements' "ICAI Level IV entity" switch for the year.
- Switching the entity changes only the defaults. What was typed (lives, overrides, reasons) stays in the register
  and applies again under a company's basis.
- Form 3CD clause 18 (the income-tax blocks) is the same for every entity.

## The screen (overhauled 14-Oct-2026: "There should be export also. Need proper overhaul of fixed assets ledger.")

The answer comes first: four figures (gross block, accumulated depreciation, net block, depreciation for the year). Then
the Confirm list, shown only when there are points to confirm. Then the fixed asset register: one row per asset, grouped
by class (by block where the books follow the Income-tax rates), with subtotals and a grand total. The register is tied
to the books, meaning the asset and accumulated-depreciation ledgers at the year end; a difference shows as one red
line with Show difference.

The schedules are under tabs: Register · Books schedule · IT blocks · Deferred tax (where it applies) · Journal.

An asset opens a drawer with its ledger (every entry, the running balance, Look up), its depreciation by year and its
details. Each change to the details needs a reason, and the reason is kept with who made the change and when.

Export holds the register, the books schedule, the income-tax block schedule and the deferred tax working (each as
Excel with formulas, PDF and Word), plus everything as one workbook. "Carry forward to next year" starts the next
year's register from this one.
