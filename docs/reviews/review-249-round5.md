# Review 249, round 5: the build and the staging release of 2.4.9

Reviewer: an independent Claude session (did not write this code or these docs)
Date: 2026-10-29
Branch reviewed: next-bridge-249 at 29986936c
Range: e16baaf86..29986936c (the docs after the code review e3f7dcb8f, the build 8e6208992, the gate notes 5dfe22053,
the staging release 29986936c)
Earlier round: review-249-round4 (docs/reviews/review-249-round4.md)

High: 0, Medium: 1, Low: 2

No code was changed. Nothing was published; nothing touched production.

## 1. Nothing outside docs/ and assets-test/ changed after the reviewed code: PASS

`git diff --name-status e16baaf86 29986936c`: the three 2.4.8 files renamed (R100) from assets-test/bridge-go to
assets-test/bridge-go-old; added assets-test/bridge-go-old/latest-2.4.8.json, assets-test/bridge-go/FinComBridge-2.4.9.exe,
FinComBridge-Setup-2.4.9.exe, FinComBridge-Setup-2.4.9.exe.sha256; modified assets-test/bridge-go/latest.json,
docs/RELEASE-CHECKLIST.md, docs/bridge-2.4.9-notes.md, docs/bridge-2.4.9-test-sheet.txt; added
docs/reviews/bridge-2.4.9-{code,security}-review.md and docs/reviews/review-249-round{2,3,4}.md. No file in bridge-go/
(or anywhere else) changed.

## 2. The program is the code reviewed: PASS (byte for byte)

In a detached worktree of 29986936c (scratch directory, not the repository's own bridge-go, so no dist/ written), under
`flock /tmp/fincom-app.lock`: `cd bridge-go && python3 icons/make_icons.py >/dev/null && GOOS=windows GOARCH=amd64
CGO_ENABLED=0 GOTOOLCHAIN=local go build -trimpath -ldflags "-s -w -H windowsgui" -o /tmp/fcb.exe .` (the same
command as build.sh line 21, output path aside).

- Rebuilt /tmp/fcb.exe: `6e501239f252b5dd8eb1dce7724fb4049af8a65766284e8b6091c09dcf2ccb4f`
- assets-test/bridge-go/FinComBridge-2.4.9.exe at 29986936c: `6e501239f252b5dd8eb1dce7724fb4049af8a65766284e8b6091c09dcf2ccb4f`

Identical. Toolchain: go.mod `go 1.24.7`, `go version` go1.24.7 linux/amd64. /tmp/fcb.exe and the worktree deleted after.

## 3. Hashes, latest.json, and 2.4.8 kept: PASS

- FinComBridge-Setup-2.4.9.exe SHA-256 `161adb967539a60e329b84765db926bb6c31acd9bcb52c205693eedc80642fc0`; equal to its
  .sha256 file, latest.json `setup.sha256`, the notes' fingerprint, the test sheet's fingerprint and the release log row.
- latest.json `bridge.sha256` = `6e501239...cb4f` = the program (and the rebuild); version 2.4.9 in both entries;
  `requireSignature: false` as in 2.4.8's.
- URLs: `https://staging.fincom.live/review/assets/bridge-go/FinComBridge-2.4.9.exe` and
  `.../FinComBridge-Setup-2.4.9.exe`: staging, no production host.
- Release log row 2.4.9: allow-list hash `403ab8a6f0689057` = the first 16 hex of `sha256sum docs/tally-allowlist.md` at
  e3f7dcb8f, e16baaf86 and 29986936c (unchanged since the code review).
- 2.4.8 in bridge-go-old, blob hashes against a9cbec7f8's assets-test/bridge-go/:
  FinComBridge-2.4.8.exe d4cee175... = d4cee175...; FinComBridge-Setup-2.4.8.exe 8d4e7b72... = 8d4e7b72...;
  .sha256 cefd960a... = cefd960a...; latest-2.4.8.json 97c116f0... = a9cbec7f8's latest.json 97c116f0... All
  unchanged bytes.

## 4. The docs' claims against the code and the cited runs: one Medium, two Low

Checked against origin/tally-batch249 spike-results/versions/<run>-*-summary.txt and bridge-go at 29986936c.

Matches:
- Code: notes point 8 and test sheet R3 (on 3.0 .. 6.2 a line with a GST nature or taxability and no type of supply is
  never taken from a group) match batch249.go `batchTOSLines` (GSTOVRDNTAXABILITY / GSTOVRDNNATURE non-empty and
  GSTOVRDNTYPEOFSUPPLY empty); TestR249R1GateAnswersAsObject exists (r249round1_test.go:376) and reads
  testdata/batch249/gate-<rel>.zip from run 40815068422, as the notes say.
- bdiff 40834628041: all five releases PASS c1, c2, d0, d1, d2; d1 "142 identical ... 0 differ, 0 missing" on 7.1 and
  "86 identical ... 0 differ, 0 missing" on 3.0, 4.1, 5.1, 6.2, as the notes and the release log row say. The data
  includes TDS, payroll, stock journals, cost centres, optional and cancelled entries (d0 / d1 lines).
- g245 40838981120: 7.1 every check PASS; 3.0, 4.1, 5.1, 6.2 every check PASS but g3 FAIL; g4 PASS on all five. The
  night pace (g10 MEASURE): 3.0 647, 4.1 624, 5.1 628, 6.2 610, 7.1 2,801 entries a minute; 1,00,000 in about 155-164
  min (2.6-2.7 h) and 36 min on 7.1: as the notes say. The g3 FAILs carry "days not held in full or not as Tally: none"
  and "all sent True"; what failed is only the asked-twice count.
- upg 40838981120 on 3.0: PASS c1, c2, u1-u4 (2.4.8 on port 9100 -> 2.4.9, settings changed none).

### M1 (Medium): upg on all five releases is claimed but only 3.0 was run

docs/bridge-2.4.9-notes.md, "The real-Tally gate of this build (run 40838981120 ...)": "upg (2.4.9 over the published
2.4.8 ...): PASS c1, c2, u1-u4 on 3.0, 4.1, 5.1, 6.2, 7.1." On tally-batch249 run 40838981120 has an upg result for
3.0 only (results commit 2626626b9, spike-results/versions/40838981120-3.0-upg-summary.txt); there is no
40838981120-{4.1,5.1,6.2,7.1}-upg summary or directory, and no results commit for them. The test sheet names the gate
as "TallyPrime 3.0, 4.1, 5.1, 6.2 and 7.1 (a new request shape), with the upgrade from 2.4.8", and the release log row
points to the notes for the gate. The upgrade from 2.4.8 (settings, recorder state, held lines carried) is therefore
evidenced on 3.0 only. Before publishing: run upg on 4.1, 5.1, 6.2 and 7.1 with the committed setup, or correct the
notes to "3.0" and record the owner's decision on the narrower upgrade gate (as 2.4.8's row does for its 3.0 + 7.1 gate).

### L1 (Low): the rerun 40850921512 did run, and the notes say it could not start

The notes say the g245 rerun after the harness fix afafc3a0a "could not start (GitHub: ... spending limit ...)". Run
40850921512 did run, g245 only, on 3.0, 4.1, 5.1 and 6.2 (results commits e12e2ab68, 497b35e78, 6c66e157d, ff8a2f964;
bridge 5dfe22053, the same bridge sources e16baaf86 and the same committed setup): 3.0, 4.1 and 5.1 every check PASS
(g3: asked twice 0, left by a group and read alone 4,768); 6.2 every check PASS but g3 FAIL (asked twice 55, asked again
after a cut for the posting 45, left by a group 4,713). The harness was then changed again (02f2bc53d: "g3 sets aside the
ask cut for a posting before counting a group-then-alone pair (run 40850921512, 6.2: 55 entries cut, asked again,
left)") and no run after that change is on the branch. None of the notes, test sheet or release log cite 40850921512.
The notes were written before that run (5dfe22053 is the run's own commit), so this is stale rather than wrong when
written, but a reader of the release docs gets neither the passing 3.0/4.1/5.1 g3 nor the 6.2 g3 FAIL. Add the run and
its 6.2 g3 line (or a rerun of 6.2 after 02f2bc53d) to the notes.

### L2 (Low): the notes' own recount of g3 is not reproducible from the summaries

The notes say, counted from the run's proxy logs, "3.0 and 5.1: 4,768 group-then-alone, 0 else; 4.1 and 6.2: one group
of 100 asked again after a cut for a posting". The 40838981120 summaries count "asked again after a cut for the
posting" 443 (3.0), 363 (4.1) and 341 (6.2), and in the rerun 40850921512 4.1 shows 0 and 6.2 shows 45 plus 55 asked
twice. The 3.0 / 5.1 figure of 4,768 matches the rerun's own count; the "one group of 100" on 4.1 and 6.2 is not what
either run's harness reports, and I did not recount proxy.jsonl. Also "4,770 of 7,852" go one by one in the speed
paragraph against 4,768 in the rerun's g3. Say which count the notes use and how it was taken (e.g. the script or the
proxy.jsonl query), or quote the harness's figures.

## Verdict

The program in assets-test/bridge-go is exactly the reviewed bridge sources (rebuild identical), the setup's
fingerprint is consistent everywhere, latest.json names 2.4.9 on staging only, and 2.4.8 is kept byte for byte. The one
Medium is a gate claim in the notes (upg on all five) that the cited run does not support; resolve it before publishing.

High: 0, Medium: 1, Low: 2
