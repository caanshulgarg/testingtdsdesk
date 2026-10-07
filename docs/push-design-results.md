# Push design: results of run 37488912899

This document reports what the "Push design" workflow run **37488912899** measured. The run used `push-design.yml` on branch `tally-versions`, at commit `d629567`. It finished with SUCCESS at 16:35Z on 6-Oct-2026. Every number below comes from that run, and the file it came from is named beside it. Where this run did not measure something, or the measurement failed, the document says so. No gap is filled with an estimate.

## Summary for the owner

1. **Only two of the five releases were tested.** This run covered TallyPrime 3.0 and 7.1. Releases 4.1, 5.1 and 6.2 were not in it.
2. **The run was an "explore" probe, not the full measurement.** Each voucher was saved once, and only on the small (light) company. Tally was never measured without the add-on. Nothing was posted through the bridge. As a result, the plain receipt and the 5- and 50-item invoices from (a), the heavy company, and (b) have no figures from this run.
3. **The 50-item sales invoice was measured.** It was spread across 2 godowns and 2 batches. On both 3.0 and 7.1, the full-entry add-on spent about **0.05–0.06 s** inside the save, and the heads-only add-on about 0.002 s. Both are well under the 0.25 s limit. This is an early sign only: it comes from one save, on the light company.
4. **The add-on can write the whole entry at save, with the final GUID, MasterID and AlterID, on both releases.** It reads the voucher back by its MasterID straight after Tally saves it. In every case, those values matched Tally's own export. The values held in the form itself are not reliable: on a new voucher the GUID is wrong, and the AlterID is always the old one.
5. **The hook fired on every voucher type that could be tested:** payroll, stock journal, manufacturing journal, delivery note, receipt note, physical stock, and sales with batches and godowns. It also fired on cancel and delete, but those events carry no GUID or AlterID.
6. **Today's hook covers only the Ledger master.** It misses Pay Head, Stock Item, Unit and Employee. Separate hooks for Pay Head and Stock Item worked. The Unit hook fired but the save was not confirmed. Godown could not be saved by the test at all. The Employee hook file has errors, so Tally ignored it.
7. **Nothing measured was above 0.25 s, so no split is needed on this evidence.** The full measurement should still be run before building: all five releases, the heavy company, and with and without the add-on.

## Where the data came from

- **Run:** 37488912899, jobs `build` 112356141961, `tally (3.0)` 112356596527, `tally (7.1)` 112356596937 and `collect` 112380451112. All four succeeded.
- **Artifacts:** `push-3.0-37488912899` (id 11427018645), `push-7.1-37488912899` (id 11427875967) and `bridge-dist`.
  - This session's GitHub client could not download them, nor the job logs. GitHub serves both from blob storage, and the client refuses that redirect.
  - The `collect` job commits the artifacts' contents to this branch (commit `3724024`), and that commit is the source used here.
- **Files cited:** under `spike-results/push-design/37488912899-<release>/`:
  - `push/a.csv`: voucher saves.
  - `push/m.csv`: master saves.
  - `push/summary.txt`: run log.
  - `push/proxy.jsonl`: bridge-to-Tally requests.
  - `push/captures/*`: lines written by the add-on, and Tally's exports.
  - `shots/*`: screenshots.
- **Run settings:** from `.github/tally-spike/push/run.txt` at `d629567`, which were `versions=7.1,3.0`, `reps=1`, `posts=1`, `heavy_led=300`, `heavy_item=300`, `heavy_vch=1000`, `mode=explore`. In explore mode the harness runs only the voucher-type and master-form probe, then stops (`summary.txt`, last line: "done (explore: the voucher-type probe only)").

### How the save time is split

The add-on writes a time stamp at each step of the save (stamps a–e in `FCPFull.tdl` and `FCPHeads.tdl`):

| Step | What it covers |
|---|---|
| a → b | The add-on's own work before Tally saves. Heads-only writes its log line here. |
| b → c | **Tally's own save.** Shown as "Tally save" below. |
| c → d | The add-on's work after the save: the full entry line (full-entry) or the log line (heads-only). |
| d → e | The read-back by MasterID that gets the final GUID and AlterID. Full-entry only. |

**Add-on time** below means total − Tally save, which is a→b + c→d + d→e. It includes the cost of writing the stamps, so it slightly overstates the add-on.

These stamp times are file write times from the disk (NTFS), so treat each figure as accurate to about ±10–15 ms. In the same run, two files written 2 ms apart showed write times 9.5 ms apart on 3.0 and 13.5 ms apart on 7.1 (`summary.txt`, line 3).

**"With add-on minus without" was not measured in this run.** Every save ran with an add-on loaded, so the add-on time here is measured from inside the save, not by comparing with Tally on its own.

## (a) Save time: receipt, 5-item and 50-item invoice, light and heavy company

**Not measured in this run.**

- **Light company:** the receipt (`rc`), 5-item (`s5`) and 50-item (`s50`) templates were imported, but the explore mode never saved them by hand (`summary.txt`, "templates:" line).
- **Heavy company:** it was built, but no save was timed on it.
  - On 7.1 it held 316 ledgers, 400 stock items and 612 vouchers (`push/sizes.json`).
  - On 3.0 the voucher import failed with *Godown '' does not exist!*, so it held only 12 vouchers (`summary.txt` 3.0, 15:43:34).

The closest measured case is the 50-item sales invoice across batches and godowns, shown under (d).

| Release | Receipt | 5-item invoice | 50-item invoice | Light company | Heavy company |
|---|---|---|---|---|---|
| 3.0 | not measured | not measured | see (d), sales batch | not measured (except d) | not measured |
| 4.1 | not in this run | not in this run | not in this run | not in this run | not in this run |
| 5.1 | not in this run | not in this run | not in this run | not in this run | not in this run |
| 6.2 | not in this run | not in this run | not in this run | not in this run | not in this run |
| 7.1 | not measured | not measured | see (d), sales batch | not measured (except d) | not measured |

## (b) Posting time with and without the FinCom add-on

**Not measured in this run.** The run has no `b.csv`, because explore mode skips the posting stage.

The bridge (version 2.3.0) was installed and running. The timing proxy recorded only its background requests to Tally (`push/proxy.jsonl`). These are not postings, so they cannot answer (b):

| Release | FinComVoucherByMaster (15 requests) | TDSDeskCompanies | Other |
|---|---|---|---|
| 3.0 | 33–75 ms | 11 requests, 11–29 ms | FinComCompany ×3 12–13 ms; TDSDeskCompanyInfo 12 ms |
| 7.1 | 42–72 ms | 10 requests, 3–29 ms, one 4467 ms | FinComCompany ×2 12 ms; TDSDeskCompanyInfo 13 ms; FinComLedgers 16 ms |
| 4.1, 5.1, 6.2 | not in this run | | |

## (d) Large vouchers, with the add-on loaded (light company, one save each)

The table below gives, for each save:

- **Tally save:** stamp b→c.
- **Add-on:** total − Tally save.
- **Screen:** the screen timer, from Ctrl+A until the screen settled. It covers the whole form closing, so it is not the add-on's cost.
- **Line:** the size of the full-entry line written (UTF-8 bytes).

All times are in ms. "dup" is a new voucher (Alt+2 duplicate, then save). "alter" is an existing voucher reopened and saved.

Source: `spike-results/push-design/37488912899-<rel>/push/a.csv`. Whether Tally saved the voucher comes from the "Tally: n new, n altered" lines in `summary.txt`.

### TallyPrime 3.0

| Voucher | Mode | Heads-only: Tally save | Heads-only: add-on | Full-entry: Tally save | Full-entry: add-on | Full-entry: screen | Line (B) |
|---|---|---|---|---|---|---|---|
| **Sales, 50 items, 2 godowns × 2 batches** | dup | 253.4 | 2.0 | 235.9 | **62.1** | 1990.9 | 22,578 |
| **Sales, 50 items, 2 godowns × 2 batches** | alter | 338.1 | 2.0 | 308.9 | **54.1** | 2038.1 | 22,578 |
| Stock journal, 50 items (50 out + 50 in, with batches and godowns) | dup | 69.5 | 1.5 | 72.1 | 28.0 | 2861.2 | 32,931 |
| Stock journal, 50 items | alter | 128.6 | 2.0 | 124.1 | 28.5 | 2504.6 | 32,930 |
| Payroll, 50 employees | dup | 30.5 | 4.9 | failed | failed | — | — |
| Payroll, 50 employees | alter | failed | failed | failed | failed | — | — |
| Payroll, 200 employees | dup | 47.0 | 1.6 | 57.1 | 54.6 | 61.2 | 32,626 |
| Payroll, 200 employees | alter | failed | failed | failed | failed | — | — |
| Manufacturing journal, 5 items | dup / alter | 34.1 / 42.0 | 1.6 / 2.0 | 39.0 / 45.6 | 17.2 / 17.5 | 675 / 658 | 3,482 / 3,425 |
| Delivery note, 5 items | dup / alter | 80.1 / 74.1 | 2.0 / 2.0 | 68.6 / 77.6 | 20.9 / 18.5 | 901 / 977 | 2,537 / 2,536 |
| Receipt note, 5 items | dup / alter | 50.0 / 73.0 | 2.0 / 2.0 | 58.3 / 68.7 | 22.0 / 21.0 | 856 / 980 | 2,539 / 2,539 |
| Physical stock, 5 items | dup / alter | 20.0 / 52.6 | 2.0 / 2.0 | 24.0 / 33.7 | 19.0 / 17.0 | 435 / 436 | 567 / 567 |

### TallyPrime 7.1

| Voucher | Mode | Heads-only: Tally save | Heads-only: add-on | Full-entry: Tally save | Full-entry: add-on | Full-entry: screen | Line (B) |
|---|---|---|---|---|---|---|---|
| **Sales, 50 items, 2 godowns × 2 batches** | dup | 263.7 | 2.0 | 246.7 | **63.7** | 1840.4 | 22,578 |
| **Sales, 50 items, 2 godowns × 2 batches** | alter | 328.4 | 1.6 | 321.4 | **63.7** | 1911.8 | 22,578 |
| Stock journal, 50 items | dup | 80.1 | 2.0 | 75.1 | 27.6 | 2745.9 | 32,931 |
| Stock journal, 50 items | alter | 112.7 | 1.4 | 120.3 | 27.7 | 2668.1 | 32,930 |
| Payroll, 50 employees | dup | 26.0 | 209.5 † | failed | failed | — | — |
| Payroll, 50 employees | alter | failed | failed | failed | failed | — | — |
| Payroll, 200 employees | dup | 47.0 | 1.0 | 53.1 | 30.7 | 76.8 | 32,626 |
| Payroll, 200 employees | alter | failed | failed | failed | failed | — | — |
| Manufacturing journal, 5 items | dup / alter | 30.0 / 43.6 | 2.0 / 2.0 | 32.0 / 42.1 | 14.0 / 17.0 | 640 / 621 | 3,482 / 3,425 |
| Delivery note, 5 items | dup / alter | 82.7 / 74.1 | 1.6 / 3.0 | 72.6 / 76.1 | 21.3 / 17.5 | 464 / 913 | 2,537 / 2,536 |
| Receipt note, 5 items | dup / alter | 51.6 / 69.9 | 1.4 / 1.0 | 56.3 / 72.1 | 20.0 / 20.0 | 752 / 901 | 2,539 / 2,539 |
| Physical stock, 5 items | dup / alter | 21.7 / 40.5 | 0.6 / 1.7 | 26.6 / 33.5 | 20.0 / 15.7 | 386 / 401 | 567 / 567 |

† This figure is almost all in the a→b step (208.5 ms). It was the first save after Tally started with the heads-only add-on, and there is only one sample, so this run cannot say whether it repeats.

**Why some cells say "failed":** in each of these cases, Tally recorded 0 new or 0 altered vouchers (`summary.txt`).

- **Payroll, 50 employees, full-entry:** the duplicated form opened with an empty credit line, and Tally showed "Oops! Nothing selected" (`shots/p-light-types-full-payroll50-saved.png`, 7.1).
- **Payroll alter, all cases:** these failed in both add-on setups and on both releases. Each waited about 140 s with nothing saved.

These are problems with the test harness and the payroll template. They are not measurements of the add-on.

The payroll template that Tally accepted was "form 5" (`summary.txt`, import lines). In that form the pay heads are entered as ledger lines, allocated to each employee as cost centres. The employee-sheet layout (forms 1–4) was refused on both releases.

## (c) Can the add-on write the full entry, with GUID, MasterID and AlterID, at save?

The full-entry add-on writes two lines for each voucher:

1. **`voucher_saved`:** the whole entry, taken from the form just after Tally's save.
2. **`voucher_final`:** the GUID, MasterID and AlterID read back from Tally's database by MasterID.

Source: `push/a.csv` (column `final`) and `push/captures/line-light-types-full-*.txt`. These were checked against Tally's own export after each step (`push/captures/tally-type-*-after-full.xml`).

| Release | Whole entry written at save | Final GUID | Final MasterID | Final AlterID | Matches Tally's export |
|---|---|---|---|---|---|
| 3.0 | **Yes**: 13 of 13 saved vouchers, every line ends `end=1` | **Yes**, by read-back | **Yes** | **Yes**, by read-back | **Yes**, all 13 |
| 4.1 | not in this run | | | | |
| 5.1 | not in this run | | | | |
| 6.2 | not in this run | | | | |
| 7.1 | **Yes**: 13 of 13, every line ends `end=1` | **Yes**, by read-back | **Yes** | **Yes**, by read-back | **Yes**, all 13 |

On both releases, the form alone is not enough:

- **GUID:** on a new (duplicated) voucher, the form still holds the GUID of the voucher it was copied from. For example, payroll 200 on 7.1 shows form GUID `…-0000000e` but database GUID `…-00000016`.
- **AlterID:** the form always holds the old AlterID. For example, stock journal alter on 7.1 shows form 16 but database 32.
- **MasterID:** the form's MasterID was right in every case.

So the read-back by MasterID is needed, and it is what makes the answer "yes".

Other limits:

- **Cancel and delete:** the events fire, but their lines carry only the MasterID. GUID and AlterID are empty (`push/captures/types-full-cancel-delete-lines.txt`).
- **Masters:** only alterations of existing masters were tested. Their lines carry the GUID and MasterID, but the AlterID is the one before the save, and masters have no read-back. For example, the ledger line on 3.0 shows AlterID 549, while Tally moved to 554 (`push/m.csv`, `push/captures/master-full-*.txt`).

## (e) Which voucher types and masters the save hook fires on

The two add-on setups were:

- **"Today's hook" (heads-only, `FCPHeads.tdl`):** it hooks the Voucher form, the Ledger form, and the cancel, delete and import events.
- **Full-entry (`FCPFull.tdl`), with one extra file per master form:** `FCPM_PayHead`, `FCPM_StockItem`, `FCPM_Unit`, `FCPM_Godown` + `FCPM_Location`, and `FCPM_Employee` + `FCPM_CostCentre`.

Sources: `push/a.csv` (`rec_events`, stamps), `push/m.csv` and `summary.txt`. Results were the same on 3.0 and 7.1 unless a cell says otherwise.

| Voucher type or event | Today's hook (heads-only) | Full-entry hook | Notes |
|---|---|---|---|
| Sales (50 items, batches and godowns): create / alter | fires / fires | fires / fires | |
| Stock Journal: create / alter | fires / fires | fires / fires | |
| Manufacturing Journal: create / alter | fires / fires | fires / fires | |
| Delivery Note: create / alter | fires / fires | fires / fires | |
| Receipt Note: create / alter | fires / fires | fires / fires | |
| Physical Stock: create / alter | fires / fires | fires / fires | |
| Payroll: create | fires (50 and 200) | fires (200); 50 not saved | Alter was not tested: the save itself failed (harness) |
| Attendance | not tested | not tested | No template. On 7.1 the import gave *Unit 'Days' does not exist!*; on 3.0, *No Entries in Voucher!* |
| Sales Order, Purchase Order | not tested | not tested | Every template form gave *Bad Order Number in Voucher!* |
| Cancel voucher | fires (before and after) | fires (before and after) | MasterID only; no GUID or AlterID |
| Delete voucher | fires (before and after) | fires (before and after) | MasterID only; no GUID or AlterID |
| Import with the add-on loaded | not tested | not tested | Templates were imported before the add-on was loaded |
| Receipt, Payment, Contra, Journal, Purchase, Credit Note, Debit Note, Memorandum, Reversing Journal, Job Work, Material In/Out, Rejections | not tested in this run | not tested in this run | |

| Master (an existing one, altered) | Today's hook (heads-only) | Per-form hook (full-entry) |
|---|---|---|
| Ledger | **fires** (pre and post lines) | **fires** (`ledger_saved`) |
| Pay Head | **misses**: saved, no line | **fires** (`payhead_saved`) |
| Stock Item | **misses**: saved, no line | **fires** (`stockitem_saved`) |
| Unit | **misses**: saved, no line | hook fired twice (`unit_saved`), but Tally's AlterID did not change in 3 tries, so the save is **not confirmed** |
| Godown (named "Location" in TallyPrime) | unknown: the test could not save it (AlterID unchanged, 3 tries) | Tally warned that a TDL had errors; `godown_saved` written but the save **not confirmed**. Unknown overall |
| Employee | **misses**: saved, no line | **misses**: Tally ignored the hook files because of TDL errors (warning shown); saved, no line |
| Creating a new master (any) | not tested | not tested |

**Gaps in today's hook:**

- **Masters missed today:** Pay Head, Stock Item, Unit and Employee.
- **Untested here:** Godown, Attendance, the order vouchers, import, and the common accounting vouchers.
- **Dedicated hooks:** Pay Head and Stock Item work with their own hooks. Unit, Godown and Employee still need a hook that both loads cleanly and lets the save complete.

## The 0.25 s verdict

The owner's limit is that the save gains no more than about 0.25 s on a 50-item invoice.

| Release | 50-item sales invoice (batches and godowns), full-entry add-on time | Heads-only add-on time | Within 0.25 s? |
|---|---|---|---|
| 3.0 | 62.1 ms (new), 54.1 ms (alter) | 2.0 / 2.0 ms | **Yes**, light company, 1 save each |
| 4.1 | not in this run | | not measured |
| 5.1 | not in this run | | not measured |
| 6.2 | not in this run | | not measured |
| 7.1 | 63.7 ms (new), 63.7 ms (alter) | 2.0 / 1.6 ms | **Yes**, light company, 1 save each |

- **Highest add-on time recorded in the run:** 209.5 ms, for the first heads-only save on 7.1 (payroll 50, marked † above).
- **Highest full-entry add-on time:** 63.7 ms.
- **Nothing measured exceeded 0.25 s.**
- **Not a sign-off:** this verdict comes from one save per case, on the light company, on 3.0 and 7.1 only. It is measured inside the save, not as with-minus-without. The plain 50-item invoice, the heavy company, and releases 4.1, 5.1 and 6.2 are still open.

## Proposed split

**Not needed on this evidence.** No large voucher came near 0.25 s.

The largest lines were about 33 KB (stock journal and payroll 200), and they took 28–55 ms of add-on time. The 50-item sales invoice line was about 23 KB and took 54–64 ms.

If the full measurement later shows the heavy company or another release going over, the fallback is a split:

1. **At save:** write only the heads, which costs about 2 ms in this run. Include the MasterID, and the final GUID and AlterID from the read-back (about 9–19 ms).
2. **After the save:** the bridge fetches the item, batch and employee detail from Tally by MasterID.

## Not measured, or failed, in this run

- **Releases 4.1, 5.1 and 6.2:** not part of this run (`versions=7.1,3.0`).
- **(a) Save time:** receipt, 5-item invoice and 50-item invoice (plain), on the light and the heavy company. Not measured (explore mode).
- **Heavy company:** no save was timed on it. On 3.0 its voucher import also failed (*Godown '' does not exist!*, 12 vouchers only).
- **(b) Posting time through the bridge, with and without the add-on:** not measured. There is no posting stage in explore mode.
- **"Without the add-on" baseline:** not measured for any voucher, so "with minus without" cannot be given. Add-on time is measured from inside the save instead.
- **Repeat saves:** only 1 save per case (`reps=1`), so there is no median or worst case.
- **Failed saves:**
  - Payroll 50 with the full-entry add-on, on both releases.
  - Payroll alter, in every case.
  - Godown master, in both setups.
  - Unit master with its hook: the save was not confirmed.
- **Not tested:**
  - Attendance, Sales Order and Purchase Order, because no template could be imported.
  - Import events with the add-on loaded.
  - Creating new masters.
  - The common accounting vouchers (receipt, payment, journal and so on) in the hook-coverage probe.
- **Employee hook:** the files `FCPM_Employee` and `FCPM_CostCentre` have TDL errors. One of `FCPM_Godown` and `FCPM_Location` also has errors.
- **The job logs and artifact zips** could not be downloaded in this session. The figures come from the copy that the `collect` job committed (`3724024`).

An earlier run, 37464758500, has result folders for all five releases (reps 5, heavy company of 3000 ledgers and 3000 items) under `spike-results/push-design/37464758500-*`. It was outside the scope of this report and none of its numbers are used here.
