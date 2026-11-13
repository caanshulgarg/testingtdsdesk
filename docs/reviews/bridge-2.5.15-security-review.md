# Security review: FinCom Bridge 2.5.15 (check before posting, unreadable days, safe writes, posted-ids guard, self-update fallback)

Reviewers: the coordinator's full security review of FinCom Bridge (13-Nov-2026: local server, Origin and Host checks,
pairing, key storage, Windows service and multi-user handling, self-update, command execution, paths, the Tally request
allow-list, cloud access, logs and Sentry), which read this branch's five items and found that they add no new finding;
then the second independent code review, which checked the security-relevant fixes (held files never read from an older
copy; 401/403 stop; SHA-256 checked on every download path including the fallback; FinCom's own copy trusted only through
the SHA; the old program kept). The coordinator signs.

Range: 61f76372f..2d1a6fc61 (origin/staging-next as 2.5.15 was rebased on it, to the last commit outside docs/)

What 2.5.15 changes, security-wise:
- post_ok (server) is read-only, scoped to the calling bridge's computer and bridge id, and costs one or two selects;
  update.failed fields in the beat are cleaned and capped.
- Self-update fallback: every path checks the list's SHA-256; the signature rule is unchanged; FinCom's own copy must be
  https (outside FINCOM_TEST=1).
- Safe writes: temp file, fsync, rename (MoveFileEx on Windows); no file is written outside the bridge's own folders.
- No new endpoint on the local server; no new Tally request; no tally.ini change.

Known findings that were already in 2.5.14 (1 critical, 2 high, 4 medium) are not made worse by 2.5.15 and are fixed in
2.5.16 under their own review. Their details are kept with the owner, not in this public repository, until fixed.
