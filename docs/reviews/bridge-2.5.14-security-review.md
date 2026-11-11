# Security review: FinCom Bridge 2.5.14 (reliability fixes: head-of-line, pickups, empty masters, linked read, progress, busy cloud)

Reviewers: the session that built it (a self-review against the owner's rules), then the coordinator's independent
review of 9d546dcb1 (no posting loss, duplicate or reorder; no typing-gate or two-in-flight issue; five points, all
addressed with tests in 63c1300b2). The coordinator signs.

Range: bdad990b5..545170626 (origin/staging-next as 2.5.13 was released on it, to this build: the 2.5.14 commits 9d546dcb1 and
63c1300b2, and the merge of origin/staging-next ac5e8baf8, which changed nothing under bridge-go/)

(bridge-go/: daypull.go (pullGiveWay, pull.aside, pullBegin; a day not begun and no longer listed let go), pickack.go
(pickRefused: a company's own reason for its own hand-outs only), ledgers.go (errNoMasters: no group, or a full round
naming none of the ledgers held; ledger_progress for every read), cloud.go (linkedWake; the 503 busy wait, one step a
wait, the heartbeat never held, beatBusyPause; cloudNames), ports.go (tallyCo, noteTallyNames), posting_status.go
(coClean, coTrim: the cloud's rule; companyKey), selfcheck.go (the night's check tried again after a busy 503, six
times; notReady as before), the request builders (tallyCo only), allowlist.go (the stock row's version word), util.go
(2.5.14); r2514_test.go; tests/fixtures/cotrim-cases.json. No server or app change.)

The owner's rules, as kept:
- No AI in the bridge. Each request to Tally 2 s at most, one in flight, postings first, the typing gate: unchanged.
- No new or changed Tally request XML: every row's shape is 2.5.13's (TestAllowListUnchanged); a request names its
  company exactly as Tally's own company list gave it (tallyCo), so a name Tally gives is sent byte for byte as before.
  Names to FinCom's cloud are cleaned with the cloud's own rule (coTrim, cases shared with the cloud's function).
- A 503 from tally-ingest is "busy" only when it says so (or has no body): never "the key is not valid", never an
  unpair; notReady keeps each caller's own rule. Nothing is lost: every caller keeps what it had to send.
- A day is begun under pull.mu before its first request: the heartbeat never lets go of a day whose request is at
  Tally (go test -race on r2514_test.go: clean).
- No secret, key or real client name in code, tests, logs or commits; made-up names only.

Independent review points and what was done (63c1300b2):
1. began set under the lock before the send (pullBegin); TestR2514BeginBeforeSend, TestR2514BeatAndLoopSideBySide (-race).
2. Names to Tally raw (tallyCo), to the cloud cleaned (cloudNames); the allow-list's cleaning clause withdrawn.
3. 503 notReady is not busy; the nightly check stops for the night on it as before.
4. One back-off step per wait; the heartbeat never held, again within 30 s while busy.
5. coTrim matches the cloud's rule (JavaScript's \s, 200 UTF-16 units); shared cases, run on the cloud's own function.

Open for the owner (not in 2.5.14): a company FinCom links before the bridge keeps it has no masters read until its
first keep run; a started day left after a minute of its company closed is read again from its list.
