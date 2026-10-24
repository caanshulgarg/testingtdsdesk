# Code review: FinCom Bridge 2.4.7 (the pairing gap closed)

Reviewer: review sessions run with Claude Code's code-review recipe, each one a fresh forked context with access only to
the repository. Every round reviewed correctness and security together: rounds 1 and 2 at high effort, rounds 3 to 5 at
medium as short re-reviews of each set of fixes. Rounds continued until no High or Medium was left open. The security
summary is in bridge-2.4.7-security-review.md.

Range: 3e00356f0..61fb40fec

(next-247-pairsafe starts at 3e00356f0, the head of the published 2.4.6 on staging-next.)

## What 2.4.7 changes (the owner's "yes" of 24-Oct-2026)

- **FinCom's pages only.** "null" and "http://localhost" are no longer default allowed origins. If an older settings file
  still names them, they are ignored unless `DevOrigins` is on; that switch is for tests and development and is off by
  default (server.go `devOrigin`, config.go).
- **No offline oracle for the typed code.** `/ping` no longer gives `pairProof = HMAC(code, …)`. A typed code is now
  checked by SPAKE2, in the shape of RFC 9382, over the 2048-bit MODP group of RFC 3526 (pairspake.go): `/pair2` carries
  X and answers Y and the bridge's confirmation, then `/pair?X=&confirm=` carries the page's confirmation and returns
  the key. Each run tests one guess, online. Runs and wrong codes together are limited to five per window. `/pair` and
  `/pair2` answer only an allowed, non-empty Origin. The 6 digits alone are no longer taken.
- **FinCom opened by the bridge** carries `#pair=<code>-<the window's 128-bit secret>`. `/ping` gives `pairProofS` over
  the secret to FinCom's page, and `/pair?code=<secret>` takes the secret once. An address never starts a SPAKE2 run by
  itself.
- **The tray and the measuring tool never send the bridge key** (pairopen.go `trayRequest`). Each call works like this:
  - `/ping` with a fresh nonce and `X-FinCom-Tray: 1` proves that the program on the port holds the key, and the bridge
    hands out a one-use challenge (30 s).
  - The request carries `X-Bridge-Auth: <challenge>.<HMAC(key, challenge, method, path?query)>`.
  - The request body is sealed with AES-256-GCM, under a key made from the bridge key and the challenge.
  - The reply is MACed by the bridge (`X-Bridge-Reply-MAC`). The tray refuses a reply without it.
- **A tray of a different version** from the bridge (for example after a rollback) restarts from the program on disk
  when that program is the bridge's version. A program on the port cannot cause that restart.
- **The app's side**, required for 2.4.7 bridges; older bridges pair as before:
  - src/js/24-pair-spake.js: the page's SPAKE2, checked against the bridge's own vectors in
    bridge-go/testdata/r247/spake-vectors.json (tests/run_pair_spake.mjs).
  - src/js/24-tally-bridge.js: probe, find, and pair with one SPAKE2 run per typed code.
  - src/js/49-tally-cloud.js: reads `#pair` with the secret.
  - app/src/parts/TallyFirstLink.jsx: the window state, and the words for a wrong code and for a closed window.
- **Nothing new is sent to Tally.** The allow-list's table and its hash are unchanged (b4df290484f5…); the doc's decision
  line now names 2.4.7.

## Rounds

| Round | Range reviewed | Found | Fixed in |
|---|---|---|---|
| 1 | 3e00356f0..87c3c5427 | 8. A sixth guess through the plain-digit /pair. Tries could be used up by another site's no-Origin image requests. Opening an address started SPAKE2 runs by itself. A time-of-check gap between the tray's proof and its keyed request. With several bridges, the wrong one was picked. Wrong-code and closed-window words were mixed up. Double 2048-bit work before the window check. An extra /ping per tray call. | 094e2153c |
| 2 | 87c3c5427..094e2153c | 9. **High:** round 1's single-connection client could not work, because the bridge closes every connection. No positive test caught it. An impostor on many ports got one guess per port. No run-out words for a stale address. The 5th wrong /pair did not say "closed". A 20 s proof wait. A rescan on every typed code. The page's own keyed requests have the same gap (pre-existing, below). Dead code. | cc92f5072 (the tray never sends the key: a per-request proof) |
| 3 | 094e2153c..cc92f5072 | 1 Medium: the tray's body (the cloud key it hands over) could go in clear to a program that took the port between the two connections. Lows: random eviction of challenges, a non-constant-time key compare, the auto-pair toast words, the skipped rescan, the proof timeout, extra connections, no tray fallback across versions, stale docs. | 84baf5eac (sealed bodies, eviction oldest first, constant time, version restart, 15 s proof) |
| 4 | cc92f5072..84baf5eac | 1 Medium: replies to the tray were not authenticated. Lows: candidate order, a flood of challenges by a same-user program, an empty key, the measure tool across versions, a weak test check, connections per poll. | 61fb40fec (reply MAC, empty key refused, candidate order, the test) |
| 5 | 84baf5eac..61fb40fec | 0 High, 0 Medium. 3 Low: a signed empty 200 on a panic (read as nothing); keyGiven could be reused; a filter condition. | - |

Tests were written before the code: r247pair_test.go failed to build (undefined: spakeP), tests/run_pair_spake.mjs had no
file to load, and run_tally_firstlink.py's checks 13 to 15 failed against the old app. Each round's fixes came with their
tests in the same commit.

## Not changed (Low, recorded)

- L1: **The page's own keyed requests** (Bridge.call: `ensureProven`, then a fetch carrying X-Bridge-Key) keep the gap
  that review M2 of 2.3.0 accepted: a program that takes the port between the two requests could receive the key. The
  tray's requests no longer carry it. Moving the page to the same per-request proof is an app and bridge change for a
  later release.
- L2: Each tray call makes two loopback round trips (proof, then request), so the poll makes 4 connections every 5 s.
- L3: A program of the same Windows user can flood the challenge pool and make tray calls fail. It cannot read anything,
  and a same-user program can stop the bridge anyway.
- L4: A measuring tool of a different version from the running bridge reads Tally itself, because it cannot prove itself
  to an older bridge.
- L5: On a route panic, the tray gets a signed empty 200, which it reads as no answer.
- L6: An impostor on the port gets one SPAKE2 guess per typed code. It learns nothing offline, and the chance of a hit
  is one in 10^6 per run.

## Tests

- New: bridge-go/r247pair_test.go (r246pair_windows_test.go unchanged), the vectors
  bridge-go/testdata/r247/spake-vectors.json, tests/run_pair_spake.mjs (in CI's tests.txt), and run_tally_firstlink.py
  checks 13 to 15.
- Changed: review230_test.go and review230m1_test.go (pairProofS replaces pairProof), security_test.go (the tray sends
  X-Bridge-Auth, not the key), r246pair_test.go (the address's secret), the version pins, and the fixtures' version.
