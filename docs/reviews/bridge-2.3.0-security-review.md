# Security review: FinCom Bridge 2.3.0 (one bridge per Windows user; Tally's own GUID for cancels and deletes)

Reviewed: 05-Oct-2026, alongside the code review of the same range (bridge-2.3.0-code-review.md), which has the
details and the commits. The sources are read with `git diff 9076c77 <to> -- bridge-go/ server/ app/
docs/tally-allowlist.md`.

## What 2.3.0 does

One bridge per Windows user (its own port of 9100..9199, its own Windows user's programs only, its own Tally only);
Tally's own GUID for cancels and deletes; the bridge proves itself before FinCom sends any secret; bridge ids bound to
their computer; no conditions on any bridge; the owner's decisions A-D.

## What holds

- **No request shape changed.** The allow-list table is unchanged; the line for 2.3.0 is by the owner's standing
  decision of 2026-10-06. No new request, no new host.
- **Nothing secret goes to an unproven listener.** The bridge key, a pairing code, a computer key and postings go only
  after /ping?n=<fresh nonce> is answered with HMAC-SHA256(bridge key, nonce || bridge id || port); a replayed proof
  fails; a bridge older than 2.3.0 is sent nothing.
- **Another Windows user is refused.** The local server answers only its own Windows user's programs (403 "not your
  FinCom Bridge"); a taken port is this user's own bridge only when Windows says the listening process is this user's.
- **A copied bridge id is refused** (bound per firm to the first computer key; release by an owner only, kept as
  history).

## Round 1

- **H1** (fixed): a cancel or delete needs its own Tally's proof; otherwise held, not guessed.
- **M1** (fixed): the Host check, and the pairing proof bound to nonce, id and port.
- **M2** (fixed): the proof before every secret request.
- **M3** (fixed): one bridge per settings file.
- Database and cloud: **M-A** (fixed) bridge ids bound per firm; **M-B** (fixed) no stranded postings; Lows 3 to 6
  for the next build.
- Lows L1 to L4: for the next build.

## The owner's no-conditions audit

Nine removals (the owner's rule of 05-Oct-2026). The checks that keep the books right stay: the proof, the id binding,
the own-user and own-Tally rules, the poster's own bridge as target, the one-entry check.

## Round 2

- **H1** (fixed): a renumbered entry is never "not found" by its number.
- **M1** (fixed): only the taking bridge gets the checks and the re-send, and only of the released entry.
- **M2** (fixed): Mark posted supersedes a check.
- **M3** (fixed): self-link only to a key the member made; own_key moved by the bridge's own call.
- **M4** (fixed): checks given up after 10 tries or 24 hours, at most 5 per turn.
- **L1, L2**: for the next build (L2 fixed by M1).

## The real-Tally finding 6e and the redated-entry path

6e fixed: a bridge sends lines only for a company open in its own Tally when the line was written. The redated-entry
path closed: empty answers from Tally are "notseen", never "not found"; only a member's confirmation (reason, name,
time) releases and sends again, so no entry is posted twice.

All High and Medium findings are fixed, each with tests. No High or Medium open.

## After the rounds

8795bdc, aefb5e7 (the version, the pins, the allow-list line by the owner's standing decision) and c810774 (the squash
into tax-accuracy). No finding.

Range: 9076c77..c810774
