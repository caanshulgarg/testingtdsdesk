# FinCom on TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1

Harness: `.github/workflows/tally-versions.yml` on branch `tally-versions` (matrix over the five releases, fail-fast off).
Each release is installed in Educational mode on a GitHub-hosted Windows runner and driven by keys. The steps come from `flow.ps1` and `flow4.ps1`, and `flowv.ps1` runs the checks.
The bridge is the published **2.3.0**: bridge_ref `tax-accuracy` (eeb163e), and its committed setup `assets-test/bridge-go/FinComBridge-Setup-2.3.0.exe` is the one installed, checked against its SHA-256. FinCom's cloud is replaced by a local stub (`stubv.py`).

Runs (06-Oct-2026):

| run | mode | what it shows |
|---|---|---|
| 37417184448 | quick | 7.1 installs, and c1 and c2 PASS. 3.0, 4.1, 5.1 and 6.2 got 403 from the URL pattern `Rel.<x>_gold`: Tally's folders are named differently for those releases (see below). |
| 37417702347 | quick | All five releases download, install, open the company and answer on the port: c1 and c2 PASS on all five. Only 6.2's files were committed, because four jobs raced to push. The other four results are in the run's annotations. The collect job now fixes this. |
| 37418469212 | full | Every check on all five releases. Results and screenshots are in `spike-results/versions/37418469212-<release>/`, and captures are in `bridge-go/testdata/real-tally-<release>/`. |

## Installers (Tally's own download centre only)

The URL pattern `…/download_centre/Rel.<x>_gold/TP/Full/setup.exe` works for **7.1 only**. Tally's download page lists every release's setup in `files_json` in `tallysolutions.com/utility/js/DownloadUtility-india.js`, under its own folder name. The harness reads that list and downloads from the folder it names. The folder names are case sensitive: `Rel.3.0_gold` returns 403, but `Rel.3.0_Gold` works.

| release | URL used (tallymirror.tallysolutions.com/download_centre/…) | size | SHA-256 | Authenticode |
|---|---|---|---|---|
| 3.0 | `Rel.3.0_Gold/TP/Full/setup.exe` | 43,440,848 | AF4172465A987F1F… | Valid, Tally Solutions Pvt Ltd |
| 4.1 | `Rel.4.1/TP/Full/setup.exe` | 44,673,232 | 8520B7C0A97BA364… | Valid, Tally Solutions Pvt Ltd |
| 5.1 | `Rel.5.1/TP/Full/setup.exe` | 45,651,144 | 05EF11D4542CF420… | Valid, Tally Solutions Pvt Ltd |
| 6.2 | `Rel6.2/TP/Full/setup.exe` (no dot after Rel) | 47,408,904 | 41D25C157D20F979… | Valid, Tally Solutions Pvt Ltd |
| 7.1 | `Rel.7.1_gold/TP/Full/setup.exe` | 72,090,376 | B849B1FB5A93D03C… | Valid, Tally Solutions Pvt Ltd |

The same list also offers 3.0 (non-gold), 3.0.1, 4.0, 5.0, 6.0, 6.1 and 7.0, and all of them answered. The full hashes are in each run's `installer.txt`. No unofficial mirror was used.

## Results (run 37418469212)

PASS / FAIL / HARNESS. HARNESS would mean the harness could not do the step, such as a timeout or keys that made no entry. No check ended as HARNESS, and none was unreachable.

| check | 3.0 | 4.1 | 5.1 | 6.2 | 7.1 |
|---|---|---|---|---|---|
| c1 install and open the company | PASS | PASS | PASS | PASS | PASS |
| c2 port answers, company list | PASS | PASS | PASS | PASS | PASS |
| c3 posting from the bridge (/import, 1 Journal) | PASS | PASS | PASS | PASS | PASS |
| c4a create by keys → recorder line | PASS | PASS | PASS | PASS | PASS |
| c4b alter by keys → recorder line | PASS | PASS | PASS | PASS | PASS |
| c4c cancel by keys (Alt+X) → recorder line | PASS | PASS | PASS | PASS | PASS |
| c4d delete by keys (Alt+D) → recorder line | PASS | PASS | PASS | PASS | PASS |
| c5 Alt+2 duplicate → new line, none for the source | PASS | PASS | PASS | PASS | PASS |
| c6 entry request (fetch test A–F), answer captured | PASS | PASS | PASS | PASS | PASS |
| c7 Tally version string the bridge reads | PASS | PASS | PASS | PASS | **FAIL** |

### Measured times

| measure | 3.0 | 4.1 | 5.1 | 6.2 | 7.1 |
|---|---|---|---|---|---|
| port 9000 up after start | 10.1 s | 10.1 s | 10.1 s | 10.1 s | 11.1 s |
| first GET on the port | 18 ms | 15 ms | 18 ms | 18 ms | 1022 ms* |
| company list request | 7 ms | 6 ms | 7 ms | 6 ms | 6 ms |
| /import of one voucher (round trip) | 512 ms | 499 ms | 503 ms | 504 ms | 500 ms |
| Tally's import reply (bridge log) | 0.2 s | 0.2 s | 0.2 s | 0.2 s | 0.2 s |
| entry request A, FinComVoucherByNumber | 171 ms | 170 ms | 174 ms | 172 ms | 176 ms |
| entry request C, FinComVoucherByMaster | 172 ms | 171 ms | 171 ms | 171 ms | 177 ms |
| recorder line after Ctrl+A, create / alter / Alt+2 | 7.1 / 5.1 / 5.1 s | same | same | same | same |
| recorder line after cancel / delete | 4.1 / 6.1 s | same | same | same | same |
| recorder body (created Receipt) | 12,073 chars | 12,073 | 12,073 | 12,073 | 2,434 |

\* 7.1's first GET took about 1 s in both quick runs as well. It is a one-off at start, not a slow port: the company list right after it took 6 ms.

The line delays are measured by a 2-second poll of the stub, so they are accurate to about 2 s. Forms B, D, E and F of the entry request each took 170–177 ms on every release and found exactly one voucher.

### What the captures show

- **The bodies differ, but the cloud reads them the same way.** On 3.0–6.2 Tally's answer to the bridge's body fetch carries every empty list tag (`VATSTATUTORYDETAILS.LIST`, `TDSEXPENSEALLOCATIONS.LIST` and so on), so it is about five times larger than 7.1's. All 15 created and altered bodies were read with the cloud's `server/tally-cloud/parse.js` at `tax-accuracy`, using `parsecheck.mjs`. Every one gave exactly one voucher with the line's GUID and the right ledger lines: Spike Income 700/800/900 against Cash.
- **Cancel and delete lines carry no body on any release.** This is the same as the 7.1 baseline in tally-real-spike.
- **Tally's own release** is in the header of its answers on every release: `PRODMAJORREL 3 / PRODMINORREL 0` … `7 / 1`. The bridge does not read it.

## What fails, and why

**c7 on 7.1.** The only "version" the bridge reads is the read test's `Tally program: <exe>, <size>, <date>` (`recorder_probes.go` `tallyProgram`). It takes the first running process under Program Files whose name starts with "tally" (`ports.go` `reTally = (?i)^tally`). TallyPrime 7.1 also runs `tallyscheduler.exe` from its install folder, so on 7.1 the bridge reported `tallyscheduler.exe, 5574336 bytes` instead of tally.exe. Releases 3.0–6.2 have no such process, so the bridge reported tally.exe correctly there.

This affects only that diagnostic line in the read test and the per-program key of the saved date forms. Posting, recording and the entry fetch are not affected. It is not caused by older releases. The bridge was not changed here: the fix is for the bridge owner to decide.

Nothing else failed on any release.

## Recommended supported floor

**TallyPrime 3.0.** Every bridge 2.3.0 check passed on 3.0, 4.1, 5.1, 6.2 and 7.1. Releases before 3.0 (1.x, 2.0, 2.1) are still on Tally's download list but were not tested. Do not claim support for them until they are run through this harness. The installers are there, and adding `'2.1'` to the matrix is enough.

Captures per release are in `bridge-go/testdata/real-tally-<release>/`:
- the stub's requests and recorder lines, with bodies;
- the created body;
- the /import answer;
- the fetch-test answer and its log;
- the read-test answer;
- Tally's answer header and company list;
- the add-on's recorder file;
- Tally's vouchers at the end;
- results.txt.
