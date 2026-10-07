# Why one entry takes 2.2 s on NWS144: measured

The owner asked on 07-Oct-2026: GARG SHEKHAR & COMPANY has about 4,000 entries in FinCom, and one entry takes 2.2 s on NWS144. On the test machine a small company took 0.07 s. Why?

**Short answer.** The time depends on how many vouchers Tally holds in that company, across every year in it. The 4,000 entries FinCom has for its period don't set it.

- The bridge's request, `FinComVoucherByMaster`, checks every voucher in the company. On these runners it costs about **0.13 to 0.17 ms per voucher**.
- A company whose voucher MasterIDs reach about 25,700 has had about 25,700 vouchers created in it. On these runners that takes **3.5 to 4.2 s**.
- NWS144's 2.2 s is in the same range. The exact figure depends on the machine's CPU: the request runs entirely on Tally's CPU, and two GitHub runners differed by 1.6x on the same company.
- These made no difference: masters, the second company open in the same Tally, and the data folder on a share.
- The keyed lookup `ID:<MasterID>` takes **17 to 22 ms at every company size** measured, up to 40,000 vouchers.

## How it was measured

- **Runs.** All on TallyPrime 7.1 and 3.0 on GitHub `windows-latest` runners, branch `why22`, workflow `push-design.yml` in mode `why22` / `why22b`, script `.github/tally-spike/push/why22.ps1`. Results are in `spike-results/push-design/<run>-<release>/push/` (`why22.csv` has every request; `summary.txt`, `why22-sizes.csv`, `why22-drift.csv`).
  - **37618958546**: factors 1 to 4.
  - **37623963206**: repeats on one running Tally, and SMB again.
  - 37614517809 timed nothing because of a harness fault in finding the target. Its company sizes and MasterID data agree with 37618958546.
- **The request.** `bymaster` is the bridge's request byte for byte. It is `voucherByMasterRequest` from `bridge-go/recorder_live.go` on `origin/tax-accuracy` b1e5858, dumped by a Go test into `why22-bymaster.xml`, with only the company, date and MasterID substituted.
  - It is a Voucher collection with the one-day SVFROMDATE/SVTODATE, the 61-field FETCH, and the filter `$MasterID = <mid>`.
  - It is compared with `objid` (the object export with ID `ID:<mid>`, same fields) and `daybook` (the Day Book report for that one day).
- **Timing.**
  - Each request is the HTTP round trip from the runner to Tally on 127.0.0.1:9000, with no bridge and no proxy. Tally's own CPU time is recorded beside it.
  - For each case: Tally is restarted on the data, then one warm-up request (rep 0) and 5 timed reps, round-robin over the three forms. The tables give the median and worst of the 5 reps in ms.
- **The data.**
  - The target is a 3-item sales invoice dated 1-Oct-2026, imported last, so it is the newest voucher. The bulk vouchers are on April to September dates: 2 of 5 are sales invoices with 3 items, 2 of 5 are receipts and 1 of 5 is a journal.
  - Masters: 300 ledgers and 300 items, plus the light company's ~60.
  - The company was grown in place: 0 → 500 → 4,000 → 10,000 → 25,000 vouchers.
  - The second company, "VMS Big Co", was made on screen in its own folder and given 40,000 vouchers. For factor 2 its folder was copied in beside the 4,000 company under folder number 100001, and both were loaded. Tally listed both.

## 1. Company size (`bymaster`: the bridge's request)

| Vouchers in the company | 7.1 median / worst | 3.0 median / worst | Tally CPU (7.1 median) |
|---|---|---|---|
| 2 (masters only + target) | **40** / 48 | **44** / 51 | 47 |
| 500 | **94** / 101 | **127** / 137 | 94 |
| 4,000 | **512** / 538 | **477** / 517 | 516 |
| 10,000 | **1,262** / 1,359 | **1,167** / 1,250 | 1,266 |
| 25,000 | **3,531** / 3,804 | **4,201** / 4,473 | 3,531 |
| 40,000 (the second company, alone) | **5,885** / 14,883 (one rep; the others 5,082 to 6,212) | **5,417** / 5,710 | 5,875 |
| 4,000 + 20,000 extra masters (10,000 ledgers, 10,000 items) | **530** / 558 | **526** / 557 | 500 |

- **The time grows in a straight line with the vouchers.**
  - 7.1: 0.128 ms per voucher at 4,000, 0.126 at 10,000, 0.141 at 25,000, 0.147 at 40,000.
  - 3.0: 0.119 to 0.168 ms per voucher.
- **Masters don't count.** 20,000 more masters added 18 ms on 7.1 and 49 ms on 3.0 to a 512 ms / 477 ms request. That is +3 to +10%, inside the spread of the reps.
- **The request is CPU work.** Tally's CPU time equals the elapsed time at every size, so Tally isn't waiting on the disk.
- The answer is always just the one voucher: 20.6 kB on 7.1 and 81 kB on 3.0. The cost is the scan, not the reply.
- The small company: 40 to 127 ms here, against 0.07 s on the earlier test machine.

## 2. A second company open in the same Tally

| Case | 7.1 `bymaster` median / worst | 3.0 `bymaster` median / worst | `objid` (7.1 / 3.0 median) |
|---|---|---|---|
| The 4,000 company alone | **515** / 546 | **504** / 558 | 17 / 17 |
| The 4,000 company, with the 40,000 company also loaded | **498** / 534 | **495** / 540 | 17 / 17 |
| The 40,000 company, with the 4,000 company also loaded | 5,780 / 6,073 | 5,354 / 5,743 | 18 / 18 |
| (the 40,000 company alone, from table 1) | 5,885 / 14,883 | 5,417 / 5,710 | 18 / 17 |

**A second company makes no difference.** The request for the small company stays at the small company's time with a 40,000-voucher company loaded beside it (−3% and −2%, inside the spread). The request is filtered within `SVCURRENTCOMPANY`, so only that company's vouchers are scanned.

## 3. The data folder on an SMB share

A share on `\\localhost` is **not a real network**. The SMB client and server are on the same machine, with no wire latency, no bandwidth limit and no other machine. These rows show the SMB layer's own overhead only.

| Case (the 4,000 company) | 7.1 `bymaster` | 3.0 `bymaster` | 7.1 `objid` | 3.0 `objid` | 7.1 `daybook` | 3.0 `daybook` |
|---|---|---|---|---|---|---|
| Local folder (run 37618958546) | **515** / 546 | **504** / 558 | 17 / 18 | 17 / 17 | 59 / 61 | 54 / 54 |
| `\\localhost\why22` (New-SmbShare) | **600** / 657 | **585** / 627 | 32 / 33 | 26 / 27 | 87 / 89 | 74 / 88 |
| Drive letter mapped to it (`net use W:`) | **603** / 650 | **579** / 628 | 31 / 32 | 26 / 28 | 87 / 91 | 73 / 75 |
| Local folder (run 37623963206, another runner) | 559 / 615 | 312 / 341 | 19 / 27 | 11 / 11 | 23 / 25 | 13 / 13 |
| `\\localhost\why22` (run 37623963206) | 655 / 707 | 382 / 386 | 36 / 45 | 17 / 19 | 54 / 58 | 23 / 25 |
| `\\localhost\why22` with another process holding every company file open read-write through the share | **no answer in 300 s, every request, both releases** | | | | | |

- **The share's own cost is +15 to +22%** on the bridge's request (+85 to +96 ms on 7.1, +70 to +81 ms on 3.0), and +6 to +17 ms on `objid`. A UNC path and a mapped drive letter cost the same.
- The request is CPU-bound (section 1), so the SMB overhead is a fraction of the scan, not a multiple of it. On a real network each read the scan makes would also carry the wire's latency. **That is not measured here.**
- **The "second opener" row is not a model of a second Tally user.** A plain process opened the 27 (7.1) or 16 (3.0) company files read-write with read-write sharing, after Tally had opened the company. From then on Tally answered nothing for 300 s per request. That shows an outside handle on the files can stall Tally completely. It does **not** show what a second TallyPrime opening the same data over the network does, because Tally's own multi-user locking was not exercised. Not measured.
- Runner speed varies. The same 4,000 company on 3.0 took 504 ms on one runner and 312 ms on another (run 37623963206). The CPU decides the scale.

## 4. The request itself

| Vouchers in the company | `bymaster` (the bridge) 7.1 / 3.0 | `ID:<MasterID>` 7.1 / 3.0 | One-day Day Book 7.1 / 3.0 (vouchers on that day) |
|---|---|---|---|
| 2 | 40 / 44 | **17 / 19** | 21 / 23 (1) |
| 500 | 94 / 127 | **17 / 19** | 46 / 48 (3) |
| 4,000 | 512 / 477 | **17 / 17** | 59 / 54 (4) |
| 10,000 | 1,262 / 1,167 | **17 / 17** | 72 / 65 (5) |
| 25,000 | 3,531 / 4,201 | **18 / 22** | 87 / 94 (6) |
| 40,000 | 5,885 / 5,417 | **18 / 17** | 23 / 20 (1) |

(Medians in ms; worst values are in `why22.csv`.)

- **`ID:<MasterID>` doesn't depend on the company's size.** It returned the target with its ledger lines and items every time (`has_target` true in every row). Its answer is larger (146 kB on 7.1, 128 kB on 3.0) because the object export carries more of the voucher.
- **The Day Book depends on how many vouchers are on that day, not on the company.**
  - Here the day held 1 to 6 vouchers: 21 ms with 1 voucher on the 2-voucher company and 23 ms with 1 on the 40,000 company.
  - The rise in the table comes from the extra targets on that day, not from the company's size.
  - On a real company the day holds that day's real entries, so its cost depends on the day.
- These agree with run 37591395905 (`ID:<mid>` 121 to 170 ms on the 30,000 company, with a 1.3 MB answer from a 50-item invoice; here the target has 3 items).

## 5. Many requests on one running Tally (run 37623963206)

The bridge's request was sent 40 times in a row on the 4,000 company without restarting Tally, then Tally was restarted.

| | 7.1 | 3.0 |
|---|---|---|
| Requests 1, 2, 5 (ms) | 555, 512, 572 | 276, 290, 332 |
| Requests 10, 20, 40 | 614, 676, 649 | 364, 368, 377 |
| Steady level after about 10 requests | **~630 to 660 (+20% over the first)** | **~365 to 380 (+35%)** |
| Tally private memory, request 1 → 40 | 480 → 485 MB | 404 → 412 MB |
| `ID:<mid>` after the 40 (10 times) | 47 then 19 to 23 | 23 then 8 to 10 |
| Tally restarted: the request 5 times | 477, 463, 478, 553, 532 | 239, 329, 281, 315, 312 |

- The request gets **20 to 35% slower over the first ~10 requests, then levels off.** It does not keep growing, memory stays flat, and a restart brings it back down.
- A Tally that has been open all day sits at this level. The 5-rep medians in sections 1 to 4 are taken during that rise, so they understate the level a long-running Tally reaches by up to this much.

## MasterIDs: how many vouchers a company with MasterIDs up to 25,700 holds

Measured on both releases (`why22-sizes.csv`, `why22-mid.txt`).

**Vouchers and masters have separate MasterID counters. They are not shared.**

| Company | Voucher MasterIDs | Ledger MasterIDs | Item MasterIDs | Group / voucher type MasterIDs |
|---|---|---|---|---|
| 600 masters, 2 vouchers (7.1) | 1 to 2 | 30 to 567 | 218 to 867 | 1 to 28 / 32 to 88 |
| 25,000 vouchers (7.1) | **1 to 25,007** (25,007 vouchers) | 30 to 868 | 218 to 867 | same |
| 4,000 vouchers + 20,000 extra masters (7.1) | **1 to 4,005** (4,005 vouchers) | 30 to 10,868 | 218 to 20,868 | same |
| 40,000 vouchers (the second company, 7.1) | **1 to 40,001** | 30 to 564 | 215 to 864 | same |

- A ledger created after 500 vouchers got MasterID **868** on 7.1 and **866** on 3.0, the next master number. The next voucher got **504**, the next voucher number.
- With 20,000 extra masters the vouchers still run 1 to 4,005.
- Within a company, voucher MasterIDs run 1, 2, 3, ... with no gaps, so the highest voucher MasterID equals the number of vouchers created.
- **So a company whose voucher MasterIDs reach 25,700 has had about 25,700 vouchers created in it.** That is the number Tally holds, minus any deleted since.
  - Whether a deleted voucher's MasterID is reused was not measured: the XML delete was refused ("Voucher does not exist!") on both forms tried.
  - If the 25,700 the owner saw is a master's MasterID rather than a voucher's, this doesn't apply. The bridge's single-entry request carries a voucher MasterID.
- FinCom's 4,000 entries are its own period. The bridge's request scans every voucher in the Tally company, so all ~25,700 count.

## Conclusion: what explains 2.2 s on GARG SHEKHAR

1. **The number of vouchers in the Tally company explains it.**
   - The bridge's `FinComVoucherByMaster` reads every voucher in the company. Section 1: straight-line growth, about 0.13 to 0.17 ms per voucher, all of it Tally CPU.
   - GARG SHEKHAR's voucher MasterIDs reach ~25,700, so Tally holds up to ~25,700 vouchers, several times FinCom's 4,000.
   - On these runners 25,000 vouchers took 3.5 s (7.1) and 4.2 s (3.0). 2.2 s on NWS144 is the same size of cost, scaled by NWS144's CPU. Runner-to-runner speed alone varied 1.6x, and a long-open Tally adds 20 to 35% (section 5).
   - The earlier 0.07 s was a company with almost no vouchers: 40 to 127 ms here at 2 to 500 vouchers.
2. **The second company doesn't explain it.** VMS EVENTS loaded beside it changes nothing (section 2: 515 → 498 ms on 7.1, 504 → 495 ms on 3.0). VMS EVENTS' own requests would take ~5.4 to 5.9 s each at 40,000 vouchers on these runners.
3. **Masters don't explain it.** 20,000 extra masters: +3 to +10%.
4. **The network share adds to it but doesn't explain it.** A localhost share costs +15 to +22% (section 3). A real network's latency is not measured. Because the request is CPU-bound, the share can't turn a fast request into a 2.2 s one, but it can add to a scan that is already slow.
5. **The fix is the request.** `ID:<MasterID>` returns the same voucher in 17 to 22 ms at 2, 4,000, 25,000 and 40,000 vouchers (section 4), on both releases.

## Not measured

- A real network: another machine, the wire's latency, a second TallyPrime using the same data.
- NWS144's CPU, and GARG SHEKHAR's real voucher count. The count is inferred from the MasterIDs, under the rule above.
- Whether deleted vouchers' MasterIDs are reused.
- Vouchers with many more lines than 3 items. The cost per voucher may grow with lines.
