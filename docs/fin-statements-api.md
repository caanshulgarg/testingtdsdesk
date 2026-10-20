# FinSt: the financial statements model (ROUND 99)

`src/js/88-fin-statements.js` (lazy: `app/src/lib/finGlobals.js` puts `window.FinSt`; not in legacy.js). Pure logic; the
screens, Excel and PDF are built on it. Test: `tests/run_fin_statements.js`.

Every figure `FinSt.build` returns is the value the Excel formula below gives, in the same rounding order, so the
screen and the workbook agree. Amounts in the trial balance are **rupees, a debit positive** (the workbooks' sign).

## API

| Call | Returns |
|---|---|
| `FinSt.CODES` | code -> `{code, note, group, label, side: "BS"/"PL", sign, sec: EQ/NCL/CL/NCA/CA, only: ""/"co"/"nc", ppe?: "gross"/"dep", cls?, blk?, msme?}` (123 codes) |
| `FinSt.codes(kind)` | the catalogue for `"co"` (Schedule III Div I, 118) or `"nc"` (firm/LLP/proprietor, ICAI, 121: 3P/3Q/3R capital, 15P/16P partners; no 3A/3B) |
| `FinSt.NOTES`, `PPE`, `INT`, `BLOCKS`, `UNITS` | the layout: notes and groups, PPE classes `[cls, label, gross, dep, block]`, tax blocks `[key, name, rate]`, units |
| `FinSt.suggest(ledger, groupPath?, balance, kind?)` | a code by rule: `FS.place` (its line), refined by name/group. `balance` debit positive |
| `FinSt.codeOf(ledger, balance)` | `{code, codeSrc}`: by hand (`b.fs.map`: a code, an old line name, or `"none"`), else suggested |
| `FinSt.tb(fy)` | `{fy, from, to, kind, entity, pySrc: "copy"/"typed"/"opening", src, adj, rows: [{ledger, group, py, cy, adj, final, code, codeSrc: "hand"/"suggested"/"none", side: "BS"/"PL"/"", synthetic?}]}` or `{error}` |
| `FinSt.build(fy, {unit, dec})` | `{fy, kind, entity, inputs, tb, notes, noteOf, bs, pl, cf, ppe, intang, plug, comp, checks}` or `{error}`; unit 1/1e3/1e5/1e7, dec 0/2 (default from inputs) |
| `FinSt.inputs(co?, firm?)` | `{name, cin, pan, address, holding, shares{number, face, authorised, holders[{name, n}]}, directors[{name, din, desig}], partners[], auditor{firm, frn, partner, mno, place}, place, date, udin, unit, dec, kind, entity, regime, unitLine}` |
| `FinSt.comp(d)` | (inside build) `{regime, ay, lines[{key, label, sec, v, calc, edited?, why?, codes?, rows?, items?}], itdep, checks}` |
| `FinSt.taxDep(fy)` | `{blocks[{key, name, rate, open, addA, addB, sale, dep, close}], total, typed, carried}` |
| `FinSt.RND(v, d)` | Excel's ROUND (half away from zero, binary noise cleared) |
| Changes (each saves the books; all kept in `b.fs`, synced) | `mapSet(l, code\|""\|"none")`, `migrate(b)` (old line names -> codes, returns count), `adjAdd(fy, {dr, cr, amt, narr})`, `adjSet(fy, i, {...})`, `adjDel(fy, i)`, `compEdit(fy, key, v\|null, why)`, `regimeSet("115BAA"\|"normal"\|"firm"\|"slab")`, `inputsSet({...})`, `taxDepSet(fy, block, wdv)`, `pyTbSet(fy, {ledger: amt}\|null)`, `ppeAdjSet(fy, grossCode, {sale, dep})` |

Storage in `b.fs`: `map` {ledger: code} (old FS line ids still read; `FS.cfg().lmap` gives FS/MIS the line of a code),
`adj` {fy: [...]}, `inputs`, `regime`, `taxDep` {fy: {block: opening WDV}} (typed once, carried forward), `taxBlock`
{ledger: block}, `compEdits` {fy: {key: {v, why}}}, `pyTb` {fy: {ledger: amount}}, `ppeAdj` {fy: {code: {sale, dep}}},
`stock` (FS's typed stock: synthetic rows 39A / 42A / 4A).

**TB rows.** CY = Tally closing negated; an income/expense ledger's CY is the year's movement. What the income and
expense ledgers carried in at the start of the year (last year's profit, Tally not closing years) is one synthetic 4A
row. PY: `b.fs.pyTb[fy]` if typed ("typed"), else the year before in FinCom's copy, with `b.fs.adj[fy-1]` applied
("copy"), else the opening balances only, balance sheet only ("opening"). Adj = adjustments (Dr +, Cr -). Final = CY + Adj.

## The workbook

Sheets: Inputs, Balance Sheet, Profit-Loss, CF, Notes, PPE (Note 8 / 34), Computation of Income, Trial Balance, JV.
Defined names (Inputs): `UNIT` = unit, `DEC` = decimals, `TOL` = `d.inputs.tol` (a value), `SHARES` = shares number.

**Trial Balance** (one row per `tb.rows`, from row 5): A Ledger, B Group, C PY (value), D CY (value), E Adj
`=SUMIF(JV!$B:$B,$A5,JV!$D:$D)-SUMIF(JV!$C:$C,$A5,JV!$D:$D)`, F Final `=D5+E5`, G Code, H `=F5/UNIT`, I `=C5/UNIT`,
J Side (`row.side`, a value). **JV**: A narration, B Dr ledger, C Cr ledger, D amount (`b.fs.adj[fy]`).

Below, `SC(x)` = `SUMIFS('Trial Balance'!$H:$H,'Trial Balance'!$G:$G,"x")`, `SP(x)` the same on `$I:$I`,
`RS(x)` = `SUMIFS('Trial Balance'!$F:$F,'Trial Balance'!$G:$G,"x")` (rupees).

### Notes (`d.notes[]`: `{no, key, title, groups{g: {head, sec, cy, py, lines}}, lines[], total}`)
- A line with a `code` (sign `s` = `CODES[code].sign`: -1 liabilities and income, +1 assets and expenses):
  CY `=ROUND(s*SC(code),DEC)`, PY `=ROUND(s*SP(code),DEC)`, e.g. `=ROUND(-SUMIFS(..,"3A"),DEC)`, `=ROUND(SUMIFS(..,"10A"),DEC)`.
- `head: true` lines are captions; `total: true` lines are `=SUM(` the group's lines `)`; the note total is the sum of
  its group totals. Lines with nil CY and PY are left out (they are 0 in every SUM).
- Note 4 (company), group `sur`: 4A `Balance at the beginning` (as above), `profit: true` line `='Profit-Loss'!<PAT>`,
  `Balance at the end` = the two added. Firm: Note 3 group `cap`: 3P, 3Q, 3R (drawings, a minus) and the `profit: true`
  line `= PAT`; 4A then reads "Balance in profit and loss account" with no profit line.
- Note 17, line 17J (rounding): `=ROUND(SC("17J"),DEC)+<plug>`. Keep the raw `ROUND(SC("17J"),DEC)` beside it (the
  workbook's J145). `<plug>` (`d.plug.cy`) =
  `=IF(ABS(r)<=TOL,r,0)` with `r = ROUND(PATpre - (assets - (EQpre + NCL + CL)),DEC)`, where PATpre is the P&L profit
  with the raw 17J, EQpre = Note 3 + Note 4 without this year's profit (company: 3 total + 4B..4D + 4A opening; firm:
  3P+3Q+3R + Note 4). The same for PY. The plug only ever absorbs rounding: a bigger difference stays on the balance sheet.

### PPE (Note 8, classes `FinSt.PPE`; Note 34 the same with `FinSt.INT`) — `d.ppe.cy.rows[{cls,label,g,a,D..M}]`, `total`
Per class row, gross code g, depreciation code a (land has none), `S = ROUND(b.fs.ppeAdj[fy][g].sale/UNIT,DEC)`
(0 if none):

| Col | Formula |
|---|---|
| D gross opening | `=ROUND(SP(g),DEC)` |
| E additions | `=ROUND(MAX(0,G-D)+S,DEC)` |
| F (sales) | `=ROUND(-(MAX(0,D-G)+S),DEC)` |
| G gross closing | `=ROUND(SC(g),DEC)` |
| H dep opening | `=ROUND(-SP(a),DEC)` |
| I charge | `=ROUND(K-H-J,DEC)` |
| J (sales) dep | `=-ROUND(ppeAdj.dep/UNIT,DEC)` |
| K dep closing | `=ROUND(-SC(a),DEC)` |
| L net opening | `=ROUND(D-H,DEC)` |
| M net closing | `=ROUND(G-K,DEC)` |

Total row `=SUM(...)`. A class with nil D, G, H and K is left out. PY grid (`d.ppe.py`): the year before's CY grid, as
values, when FinCom has it; else `partial: true` with only G `=ROUND(SP(g),DEC)`, K `=ROUND(-SP(a),DEC)`, M `=G-K`.
Balance sheet PPE = M total; intangibles = Note 34 M total.

### Balance Sheet (`d.bs.sections[EQ|NCL|CL|NCA|CA].lines[{id, label, note, no, cy, py}]`, `d.bs.total.eqL/assets`)
Each line = the sum of its note groups: sc = Note 3; rs = Note 4; ltb 30; dtl 31; oltl 32; ltp = 5 group lt; stb 33;
tpm = 6 group msme (6A); tpo = 6 group oth (6B); ocl 7; stp = 5 group st; ppe = Note 8 M; intang = Note 34 M; cwip =
35 cwip; iaud = 35 iaud; nci 36; dta 9; ltla = 38 la; onca = 38 onca; ci 37; inv 39; tr 10; cash 11; stla = 12 la;
oca = 12 oca. Section totals and TOTAL `=SUM`. EQ heading: Shareholders' / Partners' / Proprietor's / Owners' funds.

### Profit-Loss (`d.pl.lines[{key, label, no, cy, py}]`; also `d.pl[key]`)
rev = Note 13; oth = 14; inc = rev+oth; mat 40; pur 41; chg 42; emp 15; fin 16; dep = Note 8 I total + Note 34 I total
(PY without a schedule: `=ROUND(SP("8E"),DEC)+ROUND(SP("34D"),DEC)`); exp = Note 17 (with the plug); tot = sum;
pbe = inc - tot; exc 43; pbt = pbe - exc; cur `=ROUND(SC("22A"),DEC)`; prior 22B; def 22C; tax = sum; pat = pbt - tax.
EPS (company, rupees) `=ROUND(-SUMIFS('Trial Balance'!$F:$F,'Trial Balance'!$J:$J,"PL")/SHARES,2)` (PY on C).

### CF (indirect, AS 3) — `d.cf.lines[{key, label, cy, py}]`, `d.cf.cy` keyed; PY = the year before's CY as values
`D(n)` = Note n total CY - PY; `D(n,g)` a group; `DL(code)` a line's CY - PY.

| key | formula |
|---|---|
| pbt, dep, finc | P&L pbt, dep, Note 16 total |
| psale | `=-<14B line>+<17T line>` |
| intinc | `=-(<14A>+<14D>)` |
| opBefore | sum of the five |
| wc_tp | `D(6)` |
| wc_ocl | `D(7)-DL(7D)-DL(7F)` |
| wc_prov | `D(5)` |
| wc_oltl | `D(32)` |
| wc_la | `-(D(12,la)-DL(12B))-D(38,la)-D(38,onca)` |
| wc_tr, wc_inv | `-D(10)`, `-D(39)` |
| wc_oca | `-(D(12,oca)-DL(12E))` |
| cashGen | opBefore + the wc lines |
| taxPaid | `=-((cur+prior)-DL(7D)+DL(12B))` |
| op | cashGen + taxPaid |
| capex | `=-(Note8 E total+Note34 E total)-D(35)+DL(7F)` |
| sale | `=<14B>-<17T>-Note8 F-Note34 F+Note8 J+Note34 J` |
| obb | `-D(11,obb)` |
| invest | `-(D(36)+D(37))` |
| intRec | `=<14A>+<14D>-DL(12E)` |
| inv | sum of the five |
| equity | company `D(3)+D(4,res)`; firm `D(3)-PAT+D(4)` |
| surplus | company `=<4A opening CY>-<Note 4 sur PY>`; firm 0 |
| borrow | `D(30)+D(33)` |
| finPaid | `=-Note 16 total` |
| fin | sum of the four |
| net, open, close | op+inv+fin; Note 11 cce PY; open+net |
| perNote, diff | Note 11 cce CY; close-perNote |

### Checks (`d.checks[{key, label, value}]`, each must be 0; Inputs check block)
Each `=IF(ABS(x)<=t,0,x)`; t = TOL unless said.
- bsCy / bsPy: equity and liabilities - assets (t = half a unit of DEC)
- tbCy / tbPy: `ROUND(SUM(TB F),2)` / `ROUND(SUM(TB C),2)`, t = 0.011
- unmapped: `SUM` of |H| + |I| of rows with no code (t = half a unit of DEC)
- surplus (company): 4A opening CY - Note 4 sur PY (closing)
- ppeDep: (Note 8 I + Note 34 I) - (`ROUND(SC("8E"),DEC)+ROUND(SC("34D"),DEC)`)
- ppeNet: (Note 8 M + Note 34 M) - `ROUND(SUM of SC over every gross and dep code,DEC)`
- cfCy (and cfPy when there is a PY cash flow): CF diff
- deferredTax: P&L def - ((Note 31 CY-PY) - (Note 9 CY-PY))
- compPbt: from the computation (below); unit: 0 when UNIT is 1, 1000, 1e5 or 1e7

### Computation of Income (rupees; `d.comp.lines`, keys for `b.fs.compEdits`)
A line edited shows `v` with `why`, `calc` the worked-out figure; totals use `v`.

| key | formula / source |
|---|---|
| pbt | `=-SUMIFS(TB F,TB J,"PL")+RS("22A")+RS("22B")+RS("22C")` |
| add_dep | `=RS("8E")+RS("34D")` |
| add_40a7 | `=MAX(0,RS("15E"))` |
| add_43b_leave | `=-(RS("5B")+RS("5C"))` |
| add_43bh | MSME bills unpaid beyond the agreed days at the year end (`Audit.checks.msme43Bh`), a value |
| add_43b_stat | 0 (taken as paid by the due date); `items` lists the 7C PF/ESI/PT/GST ledgers to check |
| add_int_tds, add_gst_int, add_penalty | `=SUM(` the TB F cells of `rows` `)` (P&L ledgers by name) |
| add_csr, add_loss_sale | `RS("17R")`, `RS("17T")` |
| less_itdep | Annexure 1 total (`itdep.blocks`: open, additions to 30 Sep (addA) and after (addB, half rate), sales, dep, close), values |
| less_grat_paid | `=MAX(0,-(PY 5A+5E)+RS("15E")+(RS("5A")+RS("5E")))` (PY on column C) |
| less_43b_paid | `=-(PY 5B+5C)` + last year's 43B(h) + last year's edited add_43b_stat |
| less_profit_sale | `=-RS("14B")` |
| less_ifos, ifos | `=-(RS("14A")+RS("14D"))` |
| pgbp | pbt + adds - less |
| gti, ded, ti | pgbp + ifos; 0; `=MAX(0,ROUND(gti-ded,-1))` (288A) |
| tax, sur, cess | 115BAA: 22%, 10%, 4%. normal (company): 25% (30% if `inputs.small400===false`), 7% > 1 cr, 12% > 10 cr, marginal relief. firm: 30%, 12% > 1 cr, marginal relief. slab: 115BAC FY 2025-26 slabs, nil to Rs 12 lakh (87A), 10/15/25% surcharge (no marginal relief) |
| taxTotal | `=ROUND(tax+sur+cess,0)` |
| tds, adv | per 12B ledger named TDS/TCS, or advance/self-assessment tax: `=MAX(0,D-C)` (books CY - PY), summed |
| payable | `=ROUND(taxTotal-tds-adv,-1)` |

Checks: `pbt` = P&L PBT x UNIT - comp pbt (0 within 2 x TOL x UNIT); `provision` = `ROUND(RS("22A")-taxTotal,0)`
(0 once the provision is booked by an adjustment).

Note numbers: 1 and 2 are the corporate information and the accounting policies; numbered from 3 in the order the
balance sheet, then the P&L, refer to them, a note without a figure left out (`d.noteOf[key]` -> no).

Not derived from the workbooks (left to the Inputs or a value): the gratuity split current / non-current (the owner's
actuarial sheet: code 5E or 5A by hand), deferred tax working (the TB's 9A / 31A / 22C, checked), ageing schedules,
PY cash flow when FinCom has no year before (blank), interest u/s 234B/234C, MAT (115JB), 40(b) limits for a firm.

## Downloads (stage 2B): `FinXlsx`, `FinPdf`

`app/src/lib/finExport.js`, a lazy chunk (nothing in legacy.js). `app/src/main.jsx` puts `window.loadFinExport()` and small
stand-ins for `window.FinXlsx.download` / `window.FinPdf.open` that load the module and pass the call on (the PDF's window is
opened at once, so the pop-up is not blocked); once loaded, the module's own objects replace them. A screen may also
`import "../../lib/finExport.js"`. Test: `tests/run_fin_xlsx.py` (LibreOffice recalculation).

| Call | Does |
|---|---|
| `FinXlsx.download(fy, {unit, dec})` | saves "<client> Financial statements FY 2025-26.xlsx" (`saveFile`); returns the name |
| `FinXlsx.make(fy, {unit, dec})` | `{buffer, name, cells: [{sheet, addr, f, v, src}], sheets}`; `src` is the path of the FinSt.build figure a cell is |
| `FinPdf.open(fy, {unit, dec, includeTb}, win?)` | the print view (as `printView`, A4 portrait): Balance Sheet, P&L, Cash Flow, Notes (with the PPE schedules), Computation, each from a new page, signature blocks; the trial balance only with `includeTb` |
| `FinPdf.html(fy, opt)` | the same pages as HTML (`section.fs-page[data-fs-page=bs/pl/cf/notes/comp/tb]`) |
| `FinSt.ratios(d)` | companies: Schedule III ratios `{comps, list[{key, label, numL, denL, cy, py, variance}]}` on closing balances; 0 when the denominator is nil |

ExcelJS is not bundled: `assets/exceljs.min.js` (ExcelJS 4.4.0 from npm, the package's `dist/exceljs.min.js` unchanged,
sha256 `7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9`; MIT, `assets/exceljs-LICENSE.txt`), loaded by
`ensureExcelJs()` (through `loadScriptOnce`, as `ensureXlsx`) the first time a workbook is made.

The workbook follows "The workbook" above, with: every formula cell carrying its value (a viewer that does not recalculate
sees the figures); Cambria 11, bold totals with a top rule (statement totals and note totals double-ruled), the owner's
accounting number format at DEC decimals, A4 fit to width (PPE and Accounting Ratios landscape), print areas without the
helper columns; Trial Balance K "Code means"; Inputs E8 the unit, short; the year before's PPE schedule and cash flow as
`=ROUND(value*<the unit they were worked in>/UNIT,DEC)`, so a unit typed on Inputs!E4 carries every figure (the checks stay
0); the rounding Note 17 absorbs worked out on Profit-Loss J-L (not printed), the raw 17J beside Note 17 (Notes J-K); the
Computation in rupees with Annexure 1 down the page; Accounting Ratios (companies) linked to the statements.
