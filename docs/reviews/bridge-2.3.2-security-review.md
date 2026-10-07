# Security review: FinCom Bridge 2.3.2 (issue 232: a large company's entry fetch over 2 s)

Reviewed: 07-Oct-2026, alongside the code review of the same range (bridge-2.3.2-code-review.md), an adversarial
self-review by the author from the diff.

Range: 4163822..38acd92

Read with `git diff 4163822 38acd92 -- bridge-go/ app/ src/ tests/ server/ docs/tally-allowlist.md`.

## What 2.3.2 does

The bridge measures each company's single-entry fetch and stops asking Tally for a company whose entry takes over 2 s
(on 2 separate occasions, a whole-Tally freeze not counting); its lines go up held with plain words. A held line whose
ask timed out waits 1 h, then 4 h, then ends with the Day Book words. The heartbeat and the Tally page say it.

## What holds

- **No Tally request added or changed.** The allow-list table and its hash are unchanged (`TestAllowListUnchanged`);
  only the decision line moved to 2.3.2 under the owner's standing decision. The change only removes requests (a marked
  company's entry fetch, held lines' re-asks); it adds none. Nothing asks Tally to compute a figure. No new host.
- **The 2-second rule, postings first, one request at a time** unchanged (`invokeTally` only observes the outcome).
- **Each bridge on its own Windows user's Tally only.** Unchanged; the mark is per company of this bridge's own Tally and
  is read from this bridge's own sync folder.
- **The books stay right.** Nothing is applied without Tally's own entry: a marked company's lines and ended lines go
  up held, with no body and no GUID, so the cloud never applies or matches them by themselves (a cancel / delete goes
  with guidHeld, never resolved from FinCom's record). The Day Book upload settles them as before.
- **No cloud change.** tally-ingest already keeps recorderBodyFetch as recorderOff.bodies with bounded fields
  (`cleanOffs`: 50 companies, names up to 200, why up to 300, at up to 30, seconds 0..3600). The bridge sends at most one
  entry per company it has marked. A ":resolved" line without a body was already a shape the cloud takes (held).
- **The page shows only text**, built from the cloud's bounded fields; React escapes it; nothing to press.
- **Local state.** `sync\recorder-slow.json` and `recorder-sent\*.ended.txt` sit in the bridge's own sync folder with
  the other recorder state (same owner and permissions); a person able to edit them can already edit the held list and
  the sent ids. A tampered file can only stop asking (lines go up held for a Day Book) or lift a mark (asking as in 2.3.1).
  Values read back are bounded by use (names compared by key, counts as numbers); the file is written atomically like the
  others.
- **Logs** name the company and the times, as the recorder's lines already do; no key or body.

## Findings

No High. No Medium.

- **S-L1 (Low)** A local process able to slow Tally for this bridge's requests (or a Tally freezing twice at the wrong
  moments) could get a company marked, which stops its entries reaching FinCom automatically until the next version.
  Nothing wrong reaches the books (the lines are held with words to upload the Day Book). By the owner's design (no
  manual resume).
- **S-L2 (Low)** The ended lines stay listed by the cloud for 7 days (heldLines, refetch); harmless to the bridge, noise
  in FinCom. See the code review L2.

## Tests

`bridge-go/slow232_test.go` (counts the stand Tally's requests over days of turns; FinCom's lists fed back), the full Go
suite, `tests/run_tally_slow_company.py`.
