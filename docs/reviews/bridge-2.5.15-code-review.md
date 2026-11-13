# Code review: FinCom Bridge 2.5.15 (check before posting, unreadable days, safe writes, posted-ids guard, self-update fallback)

Reviewers: the session that built it (a self-review against the owner's rules), then two independent reviews run by the
coordinator: the first over the five items (two medium, seven low findings), the second over the fixes for them (nothing
blocking; two low findings noted for 2.5.16). The coordinator signs.

Range: 61f76372f..57ae94a5a (origin/staging-next as 2.5.15 was rebased on it, to the allow-list wording fix 57ae94a5a: the 2.5.14 line reads "2.5.14 allowed by", r2514_test.go pattern and a TestR2515Version check to match; the coordinator read that diff: wording and tests only, no request or code path changed)

(bridge-go/: safefile.go and jobfile.go (temp, fsync, rename, one .bak; a held file retried then posting paused, never
read from its older copy), accepted.go (posted-ids.json unreadable: posting paused, the file never overwritten), keep.go
and cloud.go (a day not written is never marked read; a missing or unreadable day file goes as readFailed, never
empty:true), jobs.go (post_ok asked before each part of a queued posting; no answer in 3 s: go ahead, asked again after
15 s; 401/403 or stop: nothing more sent), update.go (second download path, FinCom's copy, the old program always kept);
server/tally-cloud/index.ts (post_ok, a read-only kind; posts_update honours taken_by; the beat keeps postedRecord and
update.failed); util.go (2.5.15); r2515*_test.go; tests/run_post_ok_ingest.py, tests/run_beat2515_ingest.py.)

The owner's rules, as kept:
- No AI in the bridge. Each request to Tally 2 s at most, one in flight, postings first, the typing gate: unchanged
  (the cloud check runs only between parts, never while Tally is answering).
- No new or changed Tally request XML (TestAllowListUnchanged; only the version wording in docs/tally-allowlist.md).
- No double posting: acceptances are stamped before every early answer; a stopped posting with anything sent is held
  for checking, never freed; posted-ids.json still guards every send.
- No lost entries: an unreadable or unwritten day is never sent as empty; the cloud acts only on empty:true.
- Offline: the bridge goes ahead with what is on the computer (owner's decision); 401/403 (revoked key, test mode) stop.
- No secret, key or real client name in code, tests, logs or commits.

Independent review findings and what was done:
1. M1 a held main file could be replaced by an older .bak: never read from .bak while held; pause instead (8cda4c753).
2. M2 a day file whose write failed could be sent as empty: never marked read; sent as readFailed (5c517bcbb).
3. L1 postedRecord kept with the beat, with what to do (f68d8cff2). L2 post_ok stops a posting held for checking
   (d9b9f5508). L3 posts_update honours taken_by (fbb37e00a). L5/L7 401/403 stop; check state pruned (85708a3c6).
   L6 the computer is never left without FinComBridge.exe (bb414ad92).
Tests: full go test ./... passed; the four cloud ingest scripts passed; go vet clean for Linux and Windows.

Open for 2.5.16 (not made worse by 2.5.15): progress.json held more than 2 s drops a posting from cloud-posts.txt
(recovered by the queue's timer and posted-ids.json); a test-mode refusal of posts_update before stamping acceptances.
