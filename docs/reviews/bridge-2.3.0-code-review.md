# Code review: FinCom Bridge 2.3.0 (one bridge per Windows user; Tally's own GUID for cancels and deletes)

Reviewed: 05-Oct-2026, by the reviewers in the Claude Code session: round 1 (database and cloud; bridge and security),
the owner's no-conditions audit, round 2 (a short review of the fixes), the real-Tally finding 6e and the redated-entry
path. High and Medium fixed, each with tests; Lows to the next build. The sources are read with
`git diff 9076c77 <to> -- bridge-go/ server/ app/ tests/ docs/tally-allowlist.md .github/workflows/`.

## What 2.3.0 does

The branch per-user-bridge (up to aefb5e7), squash-merged into tax-accuracy as c810774:
- **One bridge per Windows user.** Each user's bridge takes the first free port of 9100..9199 (remembered); the local
  web server answers only programs of its own Windows user (TCP table, process, token user); it reads and posts only
  to the Tally in its own Windows session; the beat names the Windows user, bridge port, Tally port and data folder.
- **Tally's own GUID for cancels and deletes**, proven in the bridge's own Tally; an uncertain delete is held, never
  guessed.
- **The security fixes**: the bridge proves itself (/ping?n=, HMAC of its key, nonce, id and port) before FinCom sends
  any secret; bridge ids bound to their computer per firm (migration 54), the owner's release of an identity, one bell
  alert per (id, computer).
- **No conditions on any bridge** (the owner's rule of 05-Oct-2026) and **the owner's decisions A-D** (a posting goes
  to the poster's own bridge; any member settles an uncertain posting after the bridge's one-entry check; a posting goes
  ahead of another bridge's reading; migration 55).
- No new request: the allow-list table unchanged; the line for 2.3.0 by the owner's standing decision of 2026-10-06.

## Round 1

Database and cloud:
- **M-A** (fixed, 3772312, test first). Bridge ids bound per firm (tally_bridge_ids, tally_bridge_bind), so a copied id
  from another firm or computer is refused.
- **M-B** (fixed, 3772312, f8c4460). No posting stranded: a new posting only gets a target and computer; queueing
  again or Retry never moves one; with no target, the newest computer that may post with the company open, else
  refused in plain words.
- Lows 3 to 6: for the next build.

Bridge and security:
- **H1** (fixed, 130f1c5, test first). A cancel or delete is taken only when proven in this bridge's own Tally; held
  otherwise (and asked again by itself, 700adc6).
- **M1** (fixed, 45a1bbb, 130f1c5). The Host header is checked and the pairing proof is bound (nonce, id, port).
- **M2** (fixed, 130f1c5, 3891029). The proof is asked before every secret request (bridge key, pairing code, computer
  key, postings), per address and again after a new search.
- **M3** (fixed, 130f1c5). One bridge per settings file (instance lock).
- Lows L1 to L4: for the next build (L1, the stray binaries, also taken out in 0199e80).

## The owner's no-conditions audit

The owner's rule of 05-Oct-2026 (bb85a71, test first; migration 54 amended, it had run nowhere): every bridge, of any
Windows user, reads and posts once installed and connected. Nine removals: no owner approval, no switch to turn on, no
wait, and no limit by user, company, number of bridges or computers. Changes only stays an optional owner's switch per
bridge, off by default.

## Round 2 (a short review of the fixes)

- **H1** (fixed, da936d3, b9b1049). A renumbered entry (automatic numbering): an empty answer by number is never
  "not found".
- **M1** (fixed, da936d3). Only the bridge that took the posting (taken_by) gets the checks and the re-send, and the
  re-send names only the released entry (resend_only).
- **M2** (fixed, da936d3). Mark posted supersedes a waiting check; a newer posted mark blocks release; withdraw by the
  asker or an owner.
- **M3** (fixed, da936d3). A member's self-link only to a computer key the member made; the move to its own key
  (own_key) by the bridge's own call.
- **M4** (fixed, da936d3). Checks given up after 10 tries or 24 hours, fair order, at most 5 per turn, none during a
  posting.
- **L1, L2**: for the next build (L2 fixed by M1).

## The real-Tally finding 6e

Fixed (424c0b9, test first): a bridge sends a recorder line only for a company open in its own Tally when the line was
written.

## The redated-entry path

Closed (bec31de, b9b1049, test first): FinComVoucherByMaster asks one day only; every empty answer from Tally (by
number or by id) is "notseen", never "not found"; tally_post_check_report never releases; release and a re-send only
after a member's "I looked in Tally: not there - post again" (a reason, name and time kept), so a duplicate entry is
never possible from that button.

## After the rounds

8795bdc and aefb5e7: BridgeVersion 2.3.0, the version pins in the tests and fixtures, the allow-list line for 2.3.0 by
the owner's standing decision of 2026-10-06, and the release check accepting that wording. c810774 is the squash of
per-user-bridge aefb5e7 into tax-accuracy (its tree is aefb5e7's). No finding.

Range: 9076c77..c810774
