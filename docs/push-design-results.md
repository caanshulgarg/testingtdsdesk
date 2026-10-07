# Push design: measured results (runs 37464758500 and 37488912899)

This document brings together what two "Push design" workflow runs (`push-design.yml`, branch `tally-versions`) measured on TallyPrime. Every number is tagged with the run it came from:

- **[F]**: the full run, **37464758500**.
- **[P]**: the probe run, **37488912899**.

Every number also names the file it came from. Where neither run measured something, or the measurement failed, the document says so. No gap is filled with an estimate.

## What each run covered

| | [F] Full run 37464758500 | [P] Probe run 37488912899 |
|---|---|---|
| Commit, finished | `b9d54c1`; SUCCESS, 6-Oct-2026 14:19Z | `d629567`; SUCCESS, 6-Oct-2026 16:35Z |
| Releases | 3.0, 4.1, 5.1, 6.2, 7.1 | 3.0, 7.1 |
| Repeats | 5 saves per case (alter: 2), 5 postings per route (import: 2) | 1 save per case |
| Light company | 11 ledgers, 50 stock items, 4 vouchers | 16 ledgers, 100 stock items, 12 vouchers |
| Heavy company | 3011 ledgers, 3050 stock items, **30,004 vouchers** (every release) | 300-ledger version built; no save timed on it |
| Vouchers saved | Receipt; Sales with 5 items; Sales with 50 items (new and alter) | Payroll 50 and 200; stock journal 50; manufacturing journal; delivery note; receipt note; physical stock; Sales with 50 items across 2 godowns × 2 batches |
| Add-on setups | none · stamp-only · heads-only · full-entry | heads-only · full-entry |
| Postings through the bridge | Yes. Bridge **2.3.1**, `jobs` and `import` routes, with and without the add-on, and again with the bridge's pause `GentleMs` at 0 | No posting stage. Bridge 2.3.0 was running |
| Master forms and voucher-type hooks | No | Yes |

**Sources:**

- Per-release folders: `spike-results/push-design/<run>-<release>/` on this branch.
  - [F] files: `push/a.csv` (saves), `push/b.csv` (postings), `push/proxy.jsonl` (each request the bridge sent Tally, timed by a proxy), `push/summary.txt`, and `push/captures/`.
  - [P] files: `push/a.csv`, `push/m.csv` (masters), `push/summary.txt` and `push/captures/`.
- Commits by each run's `collect` job: `0e5769b` for [F] and `3724024` for [P]. The artifact zips and job logs could not be downloaded in this session, because GitHub serves them from blob storage and the session's GitHub client refuses that redirect. The `collect` job commits the artifacts' contents, and those commits are what this document uses.
- Medians and worsts were worked out with small scripts, kept outside the repository. They read the CSV files and stream `proxy.jsonl` line by line.

## Summary for the owner

1. **The light, quick part of the add-on passes everywhere.** It records only the voucher's header ("heads-only"). On every release (3.0, 4.1, 5.1, 6.2 and 7.1), and on both the small and the large (30,000-voucher) company, it adds at most about **0.06 s** to saving a 50-item invoice (median up to 0.03 s). That is well under the 0.25 s limit [F].
2. **The full-entry add-on passes on the small company only.** This version writes the whole entry and then re-reads the voucher's final GUID and AlterID from Tally.
   - On the small company it adds **0.05–0.08 s** (worst 0.09 s) on every release [F].
   - On the large company it **fails** on every release. Its re-read was still running 2.4 s after the user pressed save, on every save. The exact length was not captured [F].
3. **The cost on the large company is the re-read, not writing the entry.** Writing the whole 50-item entry took only about 0.01 s even there [F]. The re-read searches every voucher for the one with that MasterID.
4. **The bridge's own fetch of each saved voucher is also very slow on the large company.** It took about **4.4–5.3 s** (median, worst 13 s), against about 0.07 s on the small company [F]. During it, Tally's screen sometimes stayed frozen for 1.1–5.8 s at the start of a save.
5. **Posting through the bridge is not slowed by the add-on.** A posting takes about **0.9 s** by the bridge's job queue and **0.35 s** by direct import, on every release and both companies, with or without the add-on [F].
   - About 0.75 s of the 0.9 s is the bridge's own deliberate pause of 0.15 s before each of its 5 requests to Tally. With the pause set to 0, a posting took 0.12–0.19 s.
   - Tally's own work per `jobs` posting is 0.06–0.12 s.
   - The owner's slowdown from about 3.5 s to 6–7 s was **not reproduced** in these runs.
6. **The full entry with the final GUID, MasterID and AlterID can be captured at save on all five releases** [F][P]. On the small company it matched Tally's own records every time [P]. On the large company the lines arrive, but too slowly.
7. **The hook fires on every voucher type that could be tested** [P], on 3.0 and 7.1: payroll, stock journal, manufacturing journal, delivery note, receipt note, physical stock, and sales with batches and godowns. It also fires on cancel and delete, which carry no GUID. Today's hook catches only the **Ledger** master and **misses Pay Head, Stock Item, Unit and Employee**.
8. **A split is needed: record the heads at save, and fetch the detail afterwards.** But the "afterwards" lookup must not be today's by-MasterID search, which takes about 5 s on the large company. Nothing in either run has measured a faster lookup yet.

## How the numbers were measured

### Save timing

The add-on writes time stamps around Tally's save (stamps a–e in `FCPStamp.tdl`, `FCPHeads.tdl` and `FCPFull.tdl`):

| Step | What it covers |
|---|---|
| a → b | The add-on's work before Tally saves. |
| b → c | **Tally's own save.** |
| c → d | The add-on's work after the save (the heads line, or the whole entry). |
| d → e | Full-entry only: the re-read of the final GUID and AlterID by MasterID. |

The four add-on setups:

- **"Stamp-only"** loads only the stamp writer (about 1 ms in total). It is the closest available timing of Tally's save without any FinCom logic.
- **"No add-on" (none)** has no stamps at all, so the save inside Tally cannot be timed there. Only the screen timer works.

**Added time = with add-on minus without.** It is measured two ways:

1. **Main measure.** Save time (stamp a to the last stamp) with the heads-only or full-entry add-on, minus the stamp-only median. In each cell, "worst" is the slowest save with the add-on minus the stamp-only median.
2. **Screen timer.** From Ctrl+A until the screen stayed still for 0.4 s, with each add-on setup compared against no add-on. This timer stops whenever Tally does not repaint for 0.4 s, so it misses a frozen Tally. Its readings jump about a lot: for example, 5.1 light with no add-on has a median of 1025 ms, against about 250 ms elsewhere. It is shown only for completeness.

**Accuracy.** Stamp times are file write times, so treat them as accurate to about ±10–20 ms. [F]'s clock check found two files written 2 ms apart showing 6–18.6 ms apart (`summary.txt`, line 3 of each release). Small negative "added" values are within this noise.

### ‡ The large company with the full-entry add-on [F]

In [F], the harness read the stamps 2 s after the screen had been still for 0.4 s. So each read came at least 2.4 s after Ctrl+A.

On the large company, on every release, the full-entry add-on's last stamp (e, after the re-read) had not been written by then, in 0 of 17 saves. Each late stamp was read with the next save, which is why `a.csv` has negative values there; they are not used in this document. By contrast, steps a→d with full-entry (Tally's save plus writing the whole entry) were complete and normal: the add-on part of a→d was 8–11 ms on the 50-item invoice.

The re-read did finish eventually. Each release's `push/captures/fullfile-heavy-full-*.txt` holds 17 `voucher_final` lines with the final GUID, MasterID and AlterID. It is a TDL collection of all vouchers, filtered by MasterID (`FCPFull.tdl`, collection `FCPByMid`).

The probe run [P] changed the harness to wait for the last stamp, but [P] timed no saves on the large company. **The re-read's exact length on the large company has not been measured.** It ran inside the save, and the save had not finished 2.4 s after the key press, against 0.3–0.5 s for stamp-only. So it is over the 0.25 s limit.

## The 50-item invoice: all releases, light and heavy [F]

Times in ms. Plain sales invoice with 50 items, new (Alt+2 duplicate, then save), 5 saves per cell. Source: `spike-results/push-design/37464758500-<rel>/push/a.csv`.

| Release | Company | Save, stamp-only (median / worst) | **Added by heads-only** (median / worst) | **Added by full-entry** (median / worst) | Full-entry: re-read d→e (median / worst) |
|---|---|---|---|---|---|
| 3.0 | light | 231 / 255 | 19.3 / 29.1 | **82.8 / 88.7** | 34.0 / 37.0 |
| 3.0 | heavy | 300 / 308 | −9.5 / 11.7 | **not captured; over 0.25 s ‡** | not finished 2.4 s after the key press |
| 4.1 | light | 235 / 242 | 11.2 / 15.1 | **47.4 / 69.1** | 30.0 / 32.5 |
| 4.1 | heavy | 276 / 294 | 13.2 / 17.2 | **not captured; over 0.25 s ‡** | not finished 2.4 s after the key press |
| 5.1 | light | 239 / 252 | −0.4 / 5.0 | **59.7 / 65.3** | 35.0 / 43.0 |
| 5.1 | heavy | 282 / 294 | 17.1 / 21.8 | **not captured; over 0.25 s ‡** | not finished 2.4 s after the key press |
| 6.2 | light | 258 / 270 | 5.9 / 19.9 | **49.0 / 64.0** | 31.1 / 35.1 |
| 6.2 | heavy | 316 / 335 | −2.9 / 1.0 | **not captured; over 0.25 s ‡** | not finished 2.4 s after the key press |
| 7.1 | light | 310 / 343 | 2.9 / 7.6 | **51.9 / 82.2** | 34.1 / 43.5 |
| 7.1 | heavy | 502 / 908 | 25.2 / 40.3 | **not captured; over 0.25 s ‡** | not finished 2.4 s after the key press |

On the light company, the whole-entry line for this invoice is 12,599 bytes (12,694 bytes after alteration) on every release.

## (a) Save time: receipt, 5-item and 50-item invoice, light and heavy [F]

Times in ms. Each cell is the save time, from stamp a to the last stamp, as median / worst. "Added" is with the add-on minus the stamp-only median.

- The alter rows have 2 saves of the same voucher. `summary.txt` reports "0 new, 1 altered (wanted 2)" because it counts distinct vouchers.
- Source: `spike-results/push-design/37464758500-<rel>/push/a.csv`.

| Release | Company | Voucher | n | Stamp-only (no FinCom logic): median / worst | Heads-only: median / worst | **Added, heads** (median / worst) | Full-entry: median / worst | **Added, full** (median / worst) |
|---|---|---|---|---|---|---|---|---|
| 3.0 | light | Receipt | 5 | 25.0 / 30.6 | 21.0 / 25.0 | **-4.0** / 0.0 | 51.0 / 52.3 | **26.0** / 27.3 |
| 3.0 | light | Sales, 5 items | 5 | 59.6 / 83.6 | 68.6 / 83.6 | **9.0** / 24.0 | 101 / 118 | **41.1** / 58.5 |
| 3.0 | light | Sales, 50 items | 5 | 231 / 255 | 250 / 260 | **19.3** / 29.1 | 314 / 320 | **82.8** / 88.7 |
| 3.0 | light | Sales, 50 items (alter) | 2 | 322 / 328 | 319 / 324 | **-3.9** / 1.4 | 363 / 382 | **40.2** / 60.0 |
| 3.0 | heavy | Receipt | 5 | 26.2 / 31.0 | 24.0 / 28.6 | **-2.2** / 2.4 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 3.0 | heavy | Sales, 5 items | 5 | 76.6 / 92.6 | 83.6 / 91.6 | **7.0** / 15.0 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 3.0 | heavy | Sales, 50 items | 5 | 300 / 308 | 290 / 312 | **-9.5** / 11.7 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 3.0 | heavy | Sales, 50 items (alter) | 2 | 365 / 379 | 395 / 406 | **29.4** / 40.9 | not finished 2.4 s after the key press (0 of 2) ‡ | **not captured; over 0.25 s** ‡ |
| 4.1 | light | Receipt | 5 | 27.5 / 29.1 | 21.0 / 24.0 | **-6.5** / -3.5 | 52.5 / 53.2 | **25.0** / 25.7 |
| 4.1 | light | Sales, 5 items | 5 | 59.1 / 76.7 | 70.9 / 86.6 | **11.8** / 27.5 | 98.4 / 128 | **39.3** / 68.7 |
| 4.1 | light | Sales, 50 items | 5 | 235 / 242 | 246 / 250 | **11.2** / 15.1 | 282 / 304 | **47.4** / 69.1 |
| 4.1 | light | Sales, 50 items (alter) | 2 | 330 / 332 | 314 / 330 | **-15.9** / 0.1 | 380 / 396 | **50.8** / 65.9 |
| 4.1 | heavy | Receipt | 5 | 28.0 / 33.0 | 23.5 / 27.2 | **-4.5** / -0.8 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 4.1 | heavy | Sales, 5 items | 5 | 74.6 / 90.6 | 77.3 / 89.6 | **2.7** / 15.0 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 4.1 | heavy | Sales, 50 items | 5 | 276 / 294 | 290 / 294 | **13.2** / 17.2 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 4.1 | heavy | Sales, 50 items (alter) | 2 | 379 / 385 | 375 / 385 | **-4.4** / 5.6 | not finished 2.4 s after the key press (0 of 2) ‡ | **not captured; over 0.25 s** ‡ |
| 5.1 | light | Receipt | 5 | 19.0 / 26.0 | 16.0 / 17.0 | **-3.0** / -2.0 | 41.2 / 45.7 | **22.2** / 26.7 |
| 5.1 | light | Sales, 5 items | 5 | 53.6 / 72.1 | 63.0 / 74.6 | **9.4** / 21.0 | 94.6 / 109 | **41.0** / 55.4 |
| 5.1 | light | Sales, 50 items | 5 | 239 / 252 | 238 / 244 | **-0.4** / 5.0 | 298 / 304 | **59.7** / 65.3 |
| 5.1 | light | Sales, 50 items (alter) | 2 | 327 / 331 | 312 / 313 | **-14.6** / -13.6 | 368 / 372 | **41.3** / 44.6 |
| 5.1 | heavy | Receipt | 5 | 23.5 / 26.5 | 21.7 / 24.0 | **-1.8** / 0.5 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 5.1 | heavy | Sales, 5 items | 5 | 73.1 / 87.5 | 77.0 / 102 | **3.9** / 28.4 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 5.1 | heavy | Sales, 50 items | 5 | 282 / 294 | 299 / 304 | **17.1** / 21.8 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 5.1 | heavy | Sales, 50 items (alter) | 2 | 373 / 377 | 382 / 384 | **9.2** / 11.2 | not finished 2.4 s after the key press (0 of 2) ‡ | **not captured; over 0.25 s** ‡ |
| 6.2 | light | Receipt | 5 | 24.0 / 30.2 | 21.0 / 22.5 | **-3.0** / -1.5 | 49.0 / 54.0 | **25.0** / 30.0 |
| 6.2 | light | Sales, 5 items | 5 | 62.6 / 82.7 | 71.2 / 93.4 | **8.6** / 30.8 | 99.2 / 115 | **36.6** / 52.6 |
| 6.2 | light | Sales, 50 items | 5 | 258 / 270 | 264 / 278 | **5.9** / 19.9 | 307 / 322 | **49.0** / 64.0 |
| 6.2 | light | Sales, 50 items (alter) | 2 | 357 / 367 | 366 / 368 | **9.8** / 11.2 | 412 / 412 | **55.2** / 55.6 |
| 6.2 | heavy | Receipt | 5 | 26.4 / 33.6 | 21.5 / 26.5 | **-4.9** / 0.1 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 6.2 | heavy | Sales, 5 items | 5 | 79.1 / 85.5 | 78.1 / 92.6 | **-1.0** / 13.5 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 6.2 | heavy | Sales, 50 items | 5 | 316 / 335 | 313 / 316 | **-2.9** / 1.0 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 6.2 | heavy | Sales, 50 items (alter) | 2 | 423 / 451 | 408 / 412 | **-15.2** / -11.4 | not finished 2.4 s after the key press (0 of 2) ‡ | **not captured; over 0.25 s** ‡ |
| 7.1 | light | Receipt | 5 | 31.4 / 35.0 | 27.0 / 29.5 | **-4.4** / -1.9 | 63.1 / 65.0 | **31.7** / 33.6 |
| 7.1 | light | Sales, 5 items | 5 | 77.4 / 102 | 82.2 / 109 | **4.8** / 31.8 | 121 / 146 | **43.8** / 68.8 |
| 7.1 | light | Sales, 50 items | 5 | 310 / 343 | 313 / 317 | **2.9** / 7.6 | 362 / 392 | **51.9** / 82.2 |
| 7.1 | light | Sales, 50 items (alter) | 2 | 402 / 405 | 394 / 401 | **-7.8** / -0.8 | 437 / 453 | **35.0** / 51.3 |
| 7.1 | heavy | Receipt | 5 | 67.2 / 73.0 | 75.1 / 82.0 | **7.9** / 14.8 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 7.1 | heavy | Sales, 5 items | 5 | 256 / 305 | 280 / 295 | **23.2** / 39.0 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 7.1 | heavy | Sales, 50 items | 5 | 502 / 908 | 528 / 543 | **25.2** / 40.3 | not finished 2.4 s after the key press (0 of 5) ‡ | **not captured; over 0.25 s** ‡ |
| 7.1 | heavy | Sales, 50 items (alter) | 2 | 431 / 436 | 481 / 488 | **50.6** / 57.4 | not finished 2.4 s after the key press (0 of 2) ‡ | **not captured; over 0.25 s** ‡ |

### The same, by the screen timer: 50-item invoice, with minus without (no add-on) [F]

Times in ms, median / worst over 5 saves, from Ctrl+A until the screen was still for 0.4 s. This timer is unreliable (see "How the numbers were measured"). It is shown because it is the only measure that includes the "no add-on" setup.

| Release | Company | No add-on | Stamp-only | Heads-only | Full-entry | Added, heads | Added, full |
|---|---|---|---|---|---|---|---|
| 3.0 | light | 270 / 286 | 237 / 254 | 237 / 254 | 253 / 879 | -32.3 | -16.2 |
| 3.0 | heavy | 483 / 495 | 494 / 543 | 542 / 5244 | 2986 / 5621 | 59.5 | 2503 |
| 4.1 | light | 288 / 461 | 236 / 252 | 240 / 253 | 238 / 252 | -48.3 | -50.7 |
| 4.1 | heavy | 109 / 508 | 493 / 510 | 499 / 2487 | 3681 / 5539 | 390 | 3571 |
| 5.1 | light | 1025 / 1089 | 219 / 235 | 235 / 655 | 220 / 644 | -789 | -804 |
| 5.1 | heavy | 476 / 494 | 446 / 478 | 497 / 4909 | 444 / 460 | 20.5 | -32.3 |
| 6.2 | light | 270 / 379 | 252 / 273 | 254 / 269 | 252 / 253 | -16.8 | -18.3 |
| 6.2 | heavy | 81.3 / 510 | 92.6 / 511 | 497 / 5100 | 547 / 4825 | 416 | 466 |
| 7.1 | light | 317 / 350 | 269 / 301 | 269 / 286 | 254 / 269 | -48.2 | -63.2 |
| 7.1 | heavy | 79.2 / 542 | 496 / 511 | 512 / 5155 | 2669 / 5788 | 432 | 2590 |

On the heavy company, the long readings with heads-only and full-entry are saves where the screen did not change at all for 1.1–5.8 s after Ctrl+A (38 of the 170 heavy-company saves with those two setups). This never happened with no add-on or stamp-only, whose first screen change on the heavy company was always within 97 ms (`a.csv`, `ui_first_ms`).

These freezes overlap a time when the bridge was fetching saved vouchers from Tally (see (b)). That fits the bridge's fetch causing them, but these runs do not prove it.

## (b) Posting time through the bridge, with and without the add-on [F]

Times in ms, median / worst, per posting. Bridge 2.3.1. All postings succeeded (`ok True`).

- **`jobs`:** POST `/jobs`, then the result is checked every 50 ms until done.
- **`import`:** POST `/import`, which waits for the answer.
- **"GentleMs 0":** the same postings after setting the bridge's `GentleMs` to 0 in its config file. The bridge itself was not changed.
- **"not run":** that stage was not part of the run. On 3.0 and 4.1, the no-add-on run with GentleMs 0 is absent; on all releases, heavy with GentleMs 0 is absent.
- Source: `spike-results/push-design/37464758500-<rel>/push/b.csv`.

| Release | Company | Route | No add-on | Heads-only | Full-entry | Added, heads | Added, full | GentleMs 0: no add-on | GentleMs 0: heads-only |
|---|---|---|---|---|---|---|---|---|---|
| 3.0 | light | jobs (n=5) | 935 / 1080 | 935 / 940 | 934 / 946 | -0.7 | -1.0 | not run | 123 / 191 |
| 3.0 | light | import (n=2) | 345 / 350 | 350 / 350 | 348 / 349 | 5.3 | 3.8 | not run | 42.5 / 47.8 |
| 3.0 | heavy | jobs (n=5) | 886 / 935 | 874 / 938 | 935 / 944 | -12.4 | 49.1 | not run | not run |
| 3.0 | heavy | import (n=2) | 350 / 350 | 346 / 355 | 351 / 351 | -3.1 | 1.3 | not run | not run |
| 4.1 | light | jobs (n=5) | 886 / 1130 | 934 / 944 | 906 / 944 | 47.3 | 19.2 | not run | 132 / 185 |
| 4.1 | light | import (n=2) | 345 / 351 | 350 / 352 | 343 / 349 | 5.6 | -1.9 | not run | 48.1 / 49.5 |
| 4.1 | heavy | jobs (n=5) | 936 / 938 | 934 / 936 | 935 / 946 | -2.3 | -1.1 | not run | not run |
| 4.1 | heavy | import (n=2) | 345 / 349 | 352 / 354 | 350 / 352 | 7.3 | 5.2 | not run | not run |
| 5.1 | light | jobs (n=5) | 936 / 1082 | 935 / 948 | 934 / 936 | -1.1 | -2.3 | 122 / 199 | 122 / 194 |
| 5.1 | light | import (n=2) | 344 / 347 | 348 / 350 | 347 / 348 | 4.4 | 3.6 | 45.6 / 48.3 | 44.0 / 44.4 |
| 5.1 | heavy | jobs (n=5) | 885 / 935 | 935 / 938 | 936 / 946 | 50.2 | 50.9 | not run | not run |
| 5.1 | heavy | import (n=2) | 353 / 353 | 350 / 352 | 346 / 349 | -2.7 | -7.3 | not run | not run |
| 6.2 | light | jobs (n=5) | 888 / 1075 | 936 / 946 | 935 / 946 | 47.5 | 46.4 | 185 / 194 | 182 / 197 |
| 6.2 | light | import (n=2) | 351 / 353 | 349 / 350 | 350 / 351 | -2.6 | -1.2 | 47.8 / 49.7 | 46.6 / 46.7 |
| 6.2 | heavy | jobs (n=5) | 934 / 937 | 934 / 943 | 937 / 949 | 0.3 | 3.0 | not run | not run |
| 6.2 | heavy | import (n=2) | 340 / 341 | 352 / 352 | 352 / 353 | 11.5 | 12.1 | not run | not run |
| 7.1 | light | jobs (n=5) | 951 / 1141 | 936 / 950 | 936 / 949 | -15.3 | -15.0 | 185 / 200 | 187 / 195 |
| 7.1 | light | import (n=2) | 354 / 354 | 359 / 361 | 350 / 355 | 5.2 | -3.6 | 64.1 / 73.3 | 55.0 / 56.6 |
| 7.1 | heavy | jobs (n=5) | 936 / 1003 | 936 / 945 | 936 / 1002 | -1.0 | -0.2 | not run | not run |
| 7.1 | heavy | import (n=2) | 388 / 391 | 388 / 389 | 392 / 396 | 0.7 | 4.5 | not run | not run |

### What one posting does in Tally (proxy breakdown) [F]

Source: `push/proxy.jsonl`, taking the requests that began within each posting's time window.

| Release | `jobs`: requests to Tally per posting | `jobs`: Tally's total time per posting (median, light / heavy) | `import`: requests per posting | `import`: Tally's total time (median, light / heavy) |
|---|---|---|---|---|
| 3.0 | 5: TDSDeskCompanies ×2, FinComCompany ×2, Import Data ×1 | 69–77 / 67–78 | 2: FinComCompany, Import Data | 32–38 / 36–40 |
| 4.1 | 5 (same) | 64–78 / 75–80 | 2 | 33–40 / 34–42 |
| 5.1 | 5 (same) | 66–76 / 64–77 | 2 | 32–37 / 34–41 |
| 6.2 | 5 (same) | 74–77 / 78–81 | 2 | 38–40 / 30–42 |
| 7.1 | 5 (same) | 83–86 / 110–119 | 2 | 40–47 / 77–81 |

Each range runs across the three setups: none, heads-only and full-entry. In 1 of the 5 no-add-on `jobs` postings on the light company, there was a sixth request (TDSDeskCompanyInfo).

**Where a posting's time goes:**

- **The bridge's pause.** `GentleMs` defaults to 150 ms (`bridge-go/config.go` on this branch), and the bridge waits that long before every request it sends Tally (`bridge-go/tally.go`, `tallyRaw`). At 5 requests, that is about 0.75 s of a `jobs` posting's ~0.93 s. With the pause at 0, `jobs` took 122–187 ms and `import` 42–64 ms.
- **Tally's own share.** Tally's work per posting is 64–119 ms by `jobs` (median), and 30–81 ms by `import`.
- **The add-on.** Loading the add-on made no measurable difference to postings on any release or company.
- **The owner's slowdown.** The owner saw postings go from about 3.5 s to 6–7 s. These runs did not reproduce that: no posting took longer than 1.15 s. The cause is not established by these measurements.

**The bridge's body fetch on the heavy company.** After a save with the heads-only or full-entry add-on loaded, the bridge fetches the saved voucher from Tally (`FinComVoucherByMaster`, an export by MasterID). Times from `push/proxy.jsonl`, sorted into stages by the "Tally started (…)" times in `summary.txt`:

| Release | Light company, heads-only (n, median, worst ms) | Heavy company, heads-only | Heavy company, full-entry |
|---|---|---|---|
| 3.0 | 16, 69, 128 | 17, 4936, 5286 | 14, 5031, 10567 |
| 4.1 | 16, 66, 120 | 14, 4729, 5492 | 16, 4938, 13190 |
| 5.1 | 16, 70, 117 | 16, 4441, 8657 | 14, 4380, 9337 |
| 6.2 | 16, 72, 149 | 14, 4820, 8622 | 12, 4960, 10048 |
| 7.1 | 16, 79, 102 | 14, 5264, 9291 | 14, 5266, 10826 |

For the light company, [P] recorded the same request at 33–75 ms on 3.0 and 42–72 ms on 7.1, with bridge 2.3.0 (`push/proxy.jsonl`).

## (c) Can the add-on write the full entry, with GUID, MasterID and AlterID, at save?

| Release | Light company [F] | Light company: values match Tally's own export [P] | Heavy company [F] |
|---|---|---|---|
| 3.0 | **Yes**: 17 of 17 saves have a `voucher_final` line with the final GUID, MasterID and AlterID (`a.csv`, column `final`) | **Yes**: 13 of 13 (payroll, journals, notes, physical stock, batch sales) | Lines written, 17 of 17, with all three values (`captures/fullfile-heavy-full-*.txt`), but **too slowly**, after more than 2.4 s ‡ |
| 4.1 | **Yes**, 17 of 17 | not checked ([P] did not run 4.1) | Same as 3.0: 17 of 17, too slowly |
| 5.1 | **Yes**, 17 of 17 | not checked | Same: 17 of 17, too slowly |
| 6.2 | **Yes**, 17 of 17 | not checked | Same: 17 of 17, too slowly |
| 7.1 | **Yes**, 17 of 17 | **Yes**, 13 of 13 | Same: 17 of 17, too slowly |

On both 3.0 and 7.1 [P], the form alone is not enough:

- **GUID:** on a new voucher, the form still holds the GUID of the voucher it was copied from.
- **AlterID:** the form always holds the old AlterID.
- **MasterID:** the form's MasterID was right in every case.

Hence the re-read. In every line in both runs, the final GUID equals the company GUID followed by the MasterID in hexadecimal. For example, MasterID 30071 has GUID `…-00007577` [F, heavy]. This is only an observation from these test companies, not something Tally guarantees.

Cancel and delete lines carry only the MasterID [P]. Master lines carry the AlterID from before the save [P].

## (d) Large vouchers, with the add-on loaded [P] (3.0 and 7.1 only, light company, 1 save each)

[P] has no "no add-on" or stamp-only setup, so "added" here means the add-on's own time inside the save: total minus Tally's save. All times in ms. Source: `spike-results/push-design/37488912899-<rel>/push/a.csv`.

| Voucher | Mode | 3.0: Tally save (heads / full) | 3.0: add-on (heads / full) | 7.1: Tally save (heads / full) | 7.1: add-on (heads / full) | Line (bytes) |
|---|---|---|---|---|---|---|
| **Sales, 50 items, 2 godowns × 2 batches** | new | 253 / 236 | 2.0 / **62.1** | 264 / 247 | 2.0 / **63.7** | 22,578 |
| **Sales, 50 items, 2 godowns × 2 batches** | alter | 338 / 309 | 2.0 / **54.1** | 328 / 321 | 1.6 / **63.7** | 22,578 |
| Stock journal, 50 items (50 out + 50 in, batches and godowns) | new | 69.5 / 72.1 | 1.5 / 28.0 | 80.1 / 75.1 | 2.0 / 27.6 | 32,931 |
| Stock journal, 50 items | alter | 129 / 124 | 2.0 / 28.5 | 113 / 120 | 1.4 / 27.7 | 32,930 |
| Payroll, 50 employees | new | 30.5 / failed | 4.9 / failed | 26.0 / failed | 209.5 † / failed | — |
| Payroll, 200 employees | new | 47.0 / 57.1 | 1.6 / 54.6 | 47.0 / 53.1 | 1.0 / 30.7 | 32,626 |
| Payroll, 50 or 200 employees | alter | failed | failed | failed | failed | — |
| Manufacturing journal, 5 items | new / alter | 34 / 39, 42 / 46 | 1.6 / 17.2, 2.0 / 17.5 | 30 / 32, 44 / 42 | 2.0 / 14.0, 2.0 / 17.0 | 3,482 / 3,425 |
| Delivery note, 5 items | new / alter | 80 / 69, 74 / 78 | 2.0 / 20.9, 2.0 / 18.5 | 83 / 73, 74 / 76 | 1.6 / 21.3, 3.0 / 17.5 | 2,537 / 2,536 |
| Receipt note, 5 items | new / alter | 50 / 58, 73 / 69 | 2.0 / 22.0, 2.0 / 21.0 | 52 / 56, 70 / 72 | 1.4 / 20.0, 1.0 / 20.0 | 2,539 |
| Physical stock, 5 items | new / alter | 20 / 24, 53 / 34 | 2.0 / 19.0, 2.0 / 17.0 | 22 / 27, 41 / 34 | 0.6 / 20.0, 1.7 / 15.7 | 567 |

† This value was the first save after Tally started with the heads-only add-on. Almost all of it is in step a→b, and there is only one sample.

**Why some cells say "failed":** Tally recorded 0 new or 0 altered vouchers in each of them (`summary.txt`).

- **Payroll, 50 employees, full-entry:** the copied form opened with an empty credit line, and Tally showed "Oops! Nothing selected" (`shots/p-light-types-full-payroll50-saved.png`, 7.1).
- **Payroll alter:** failed in every setup, after waiting about 140 s each time.

These are problems with the test harness or the test template. They are not measurements of the add-on.

The payroll template that Tally accepted puts the pay heads on ledger lines, allocated to each employee as cost centres ("form 5" in `data.ps1`).

**Not measured in either run:** any of these large vouchers on a large company, and the stamp-only or no-add-on baseline for them.

## (e) Which voucher types and masters the save hook fires on [P] (3.0 and 7.1)

- **Today's hook** is `FCPHeads.tdl`. It hooks the Voucher form, the Ledger form, and the cancel, delete and import events.
- **Full-entry** is `FCPFull.tdl` plus one file for each master form: `FCPM_PayHead`, `FCPM_StockItem`, `FCPM_Unit`, `FCPM_Godown` + `FCPM_Location`, and `FCPM_Employee` + `FCPM_CostCentre`.
- Sources: `push/a.csv`, `push/m.csv` and `push/summary.txt`. Results were the same on 3.0 and 7.1.

| Voucher type or event | Today's hook | Full-entry hook | Notes |
|---|---|---|---|
| Sales (50 items, batches and godowns): create / alter | fires / fires | fires / fires | Plain Sales and Receipt were also hooked on all five releases in [F] |
| Stock Journal, Manufacturing Journal, Delivery Note, Receipt Note, Physical Stock: create / alter | fires / fires | fires / fires | |
| Payroll: create | fires (50 and 200 employees) | fires (200); 50 did not save | Alter not tested: the save itself failed in the harness |
| Attendance | not tested | not tested | No template. 7.1 import: *Unit 'Days' does not exist!*; 3.0: *No Entries in Voucher!* |
| Sales Order, Purchase Order | not tested | not tested | Every template form gave *Bad Order Number in Voucher!* |
| Cancel and delete | fire (before and after) | fire (before and after) | MasterID only; no GUID or AlterID |
| Import with the add-on loaded | not tested | not tested | |
| Payment, Contra, Journal, Purchase, Credit Note, Debit Note, Memorandum, Reversing Journal, Job Work, Material In/Out, Rejections | not tested | not tested | |

| Master (an existing one, altered) | Today's hook | Separate per-form hook |
|---|---|---|
| Ledger | **fires** | **fires** |
| Pay Head | **misses** | **fires** |
| Stock Item | **misses** | **fires** |
| Unit | **misses** | the hook fired, but Tally's AlterID did not change in 3 tries, so the save is **not confirmed** |
| Godown ("Location") | unknown: the harness could not save it | Tally warned that a TDL had errors; the line was written, but the save **not confirmed** |
| Employee | **misses** | **misses**: Tally ignored the hook files because of TDL errors |
| Creating a new master | not tested | not tested |

## The 0.25 s verdict

The limit: the save may gain no more than about 0.25 s on a 50-item invoice.

| Release | Light company: heads-only | Light company: full-entry | Heavy company: heads-only | Heavy company: full-entry (with re-read) |
|---|---|---|---|---|
| 3.0 | **Pass** (19 / 29 ms) | **Pass** (83 / 89 ms) | **Pass** (−10 / 12 ms) | **FAIL**: not finished 2.4 s after the key press |
| 4.1 | **Pass** (11 / 15) | **Pass** (47 / 69) | **Pass** (13 / 17) | **FAIL** |
| 5.1 | **Pass** (0 / 5) | **Pass** (60 / 65) | **Pass** (17 / 22) | **FAIL** |
| 6.2 | **Pass** (6 / 20) | **Pass** (49 / 64) | **Pass** (−3 / 1) | **FAIL** |
| 7.1 | **Pass** (3 / 8) | **Pass** (52 / 82) | **Pass** (25 / 40) | **FAIL** |

The figures are added time in ms, median / worst, from the plain 50-item invoice table [F].

- **Heads-only passes on every release and on both companies.** Its worst addition anywhere in [F] was 57.4 ms (7.1 heavy, 50-item alter). The highest figure in [P] was 209.5 ms, a single first save after Tally started.
- **Full-entry fails on the heavy company on all five releases.** The cause is the in-save re-read of the final GUID and AlterID by MasterID. Without the re-read, full-entry's work on the heavy company was 8–11 ms.
- **The heavy-company freeze matters too.** On the heavy company, saves made with heads-only and full-entry sometimes froze Tally's screen for 1.1–5.8 s, and the bridge's 4–5 s fetch of each voucher ran at around the same time. The user would feel this even though the add-on's own time is small. [F] does not prove the link.

## Proposed split

1. **At save:** write the heads, about 2 ms [F]. The whole entry could also be written without the re-read, which took 8–11 ms on the heavy company's 50-item invoice [F]. The line includes the MasterID, which is correct in the form [P].
2. **After the save:** get the final AlterID, the GUID, and any detail not written at save, outside Tally's save.
   - Today's after-save lookup (the bridge's `FinComVoucherByMaster`) and the add-on's re-read both look a voucher up by MasterID through a filtered collection. On the 30,000-voucher company that took 4.4–5.3 s per voucher [F].
   - The split therefore needs a cheaper after-save lookup, or a batched one. **Neither run has measured one.**
   - The pattern that the GUID equals the company GUID plus the hexadecimal MasterID [F][P] might remove the need to look up the GUID, but it has not been confirmed as a rule.

## Still not measured, or failed

- **Large vouchers on a large company:** payroll 50 and 200, stock journal 50, and 50-item sales across batches and godowns ([P] ran only on the light company, on 3.0 and 7.1). They were not run on 4.1, 5.1 or 6.2 either.
- **The re-read on the heavy company:** its exact length ([F] stopped waiting at 2.4 s; [P] did not time the heavy company).
- **A cheaper after-save lookup** than by-MasterID: not tried.
- **The owner's slowdown from about 3.5 s to 6–7 s:** not reproduced. No posting in [F] took longer than 1.15 s.
- **Postings with GentleMs 0:** not run on the heavy company, and not run with no add-on on 3.0 and 4.1.
- **Failed in [P]:**
  - Payroll 50 with the full-entry add-on.
  - Every payroll alter.
  - The Godown master save.
  - The Unit master save with its hook: not confirmed.
- **Not tested:**
  - Attendance, Sales Order and Purchase Order (their templates were refused).
  - Import events with the add-on loaded.
  - Creating new masters.
  - The common accounting vouchers in the hook probe.
  - Masters on 4.1, 5.1 and 6.2.
- **Employee hook files:** these have TDL errors, as does one of the Godown and Location files.
- **The job logs and artifact zips** could not be downloaded in this session. The figures come from the `collect` commits `0e5769b` [F] and `3724024` [P].
