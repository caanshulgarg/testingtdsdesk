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
