# Security review: FinCom Bridge 2.4.7 (the pairing gap closed)

Reviewer: review sessions run with Claude Code's code-review recipe, each a fresh forked context with only the
repository. These are the same rounds as the code review (bridge-2.4.7-code-review.md), and every round covered
correctness and security together. Claude Code's security-review command could not run in this session, because it needs
origin/HEAD in the checkout, so its scope was given to those sessions.

Range: 3e00356f0..281635423

## What was closed (the 2.4.6 security review's "for the owner" items, the owner's "yes" of 24-Oct-2026)

1. **The pairing proof as an offline oracle.** Until 2.4.6, `/ping` gave `pairProof = HMAC(code, nonce‖id‖port)`. One
   proof was enough to find the 6-digit code among 10^6 candidates in about a second, and any page with an allowed
   Origin could get one. Now:
   - **The typed code:** SPAKE2 over RFC 3526 group 14, with M and N hashed into the group so that nobody knows their
     logarithms. Every element received is checked to be in the subgroup of order q, and refused elements use up no
     try.
   - **The transcript:** it binds the bridge's id, port, the window's salt, X, Y, Z and w. The confirmations are
     HMAC(k, "bridge") and HMAC(k, "page").
   - **No offline test:** an active page that knows x and the bridge's answer cannot test codes offline. Its answer
     verifies only the guess sent inside X (TestR247SpakeWrongCodeOnlineOnly).
   - **Five tries in all:** runs and wrong codes together, per window (TestR247FiveTriesInAllAndOriginOnly). Only the
     window's secret, or a finished run, pairs. The 6 digits alone are refused.
   - **Cross-checked:** the page's JavaScript and the bridge's Go agree on fixed vectors (tests/run_pair_spake.mjs).
2. **Default origins `null` and `http://localhost`.** They are gone from the defaults, and a settings file that still
   names them is not obeyed without `DevOrigins` (TestR247DevOriginsOffByDefault). `/pair` and `/pair2` need an allowed,
   non-empty Origin, so another site's image or link (no Origin) never uses up a try.
3. **The tray sending the key every 5 s to whatever answered on its port.** The tray (and the measuring tool) no longer
   send the key at all. Each call works like this:
   - The tray sends its own nonce. The program on the port must answer with the key's HMAC over it, bound to its id and
     that port, or nothing more is sent. It also hands out a one-use challenge of its own (30 s, at most 64 open, the
     oldest dropped first).
   - The request carries HMAC(key, challenge, method, path?query). That proof is good once, for that request only
     (TestR247TrayNeverSendsTheKey: a replay, another path, or a challenge never issued is refused).
   - The body is sealed with AES-256-GCM under HMAC(key, "fincom-tray-seal|" challenge), with the challenge as
     associated data. A body sealed under another challenge is refused.
   - The bridge MACs the reply over the challenge, the status and the body, and the tray takes no reply without it
     (TestR247TrayTakesOnlyTheBridgesReply).
   - So a program of another Windows user that takes the port between the proof and the request gets nothing usable,
     and cannot feed the tray a made-up answer.
   - `/ping` answers the key's proof and a challenge only to a program request: no Origin, no Sec-Fetch headers, and
     `X-FinCom-Tray: 1`, which no page can send there without the bridge's CORS leave (the empty-Origin rule of review
     M1 of 2.3.0 is kept).
4. **FinCom opened by the bridge** carries the window's 128-bit secret. A secret that no bridge proves is never sent, and
   an address never starts a SPAKE2 run by itself.

## Other checks

- A settings file with no key never lets a request through on an empty key. The key is compared in constant time.
- **Tally:** no request is added or changed, and nothing new is sent. The allow-list table hash is unchanged
  (b4df290484f5…; TestAllowListUnchanged, TestRelease247VersionAllowListUnchanged). The doc changed only its words: the
  decision line names 2.4.7 by the owner's standing decision of 2026-10-06, and a dated line says no request was measured
  again.
- **No AI** in the bridge. The browser is still opened only by the owner's tray, as in 2.4.6.

## Open (Low, recorded in the code review)

- **The page's own keyed requests.** FinCom's page still sends X-Bridge-Key on its requests after a proof made on an
  earlier request. A program of another Windows user that takes the port between the two could receive the key. This
  is review M2 of 2.3.0, accepted then and unchanged here. Closing it means moving the page to the tray's per-request
  proof, an app and bridge change for a later release.
- **A same-user program flooding the challenge pool** can make tray calls fail. It reads nothing, and a same-user program
  can stop the bridge anyway.
