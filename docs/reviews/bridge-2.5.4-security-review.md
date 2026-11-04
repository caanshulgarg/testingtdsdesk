# Security review: FinCom Bridge 2.5.4

Reviewers: the two independent review rounds (on f9f807b88 and 9c8546b75; findings and fixes in
bridge-2.5.4-code-review.md) and the build session's own pass.

Range: e7f2f1990..f1f856b5e

## The asking program's identity (/ping, /status)

- The TCP table is cached 1.5 s, but a connection is only ever looked up in a table taken AFTER that connection was
  accepted (http.Server.ConnContext records the accept time; snapCache.get(notBefore)). A row held from before can
  therefore never stand for another program that reuses the same client port (a program may bind a chosen port), so
  "yours" cannot be obtained by racing the cache. Rows without a process (closed connections) are never the peer.
- /ping gains claimRule ("user"); no key, no proof, no company names. A local program answering /ping as a bridge can
  still only make this bridge leave an owner-unknown Tally alone, as before.

## Another login's Tally

- The Tally's Windows user (token, else the Remote Desktop service) settles the owner before any tie-break: a Tally run
  as another person (S-1-5-21-, S-1-12-1-) is never asked, also when its session is unknown; service accounts count as
  nobody's (the service runs as SYSTEM). This narrows what 2.5.3 allowed (owner-unknown Tallys asked).

## Late answers

- A late answer is used only for the exact same request text on the same port, within 60 s, and only while the same
  program (pid) listens there; nothing new is sent to Tally and no request XML changed (TestAllowListUnchanged).

## tally.ini

- On a computer several people use, the connection settings are no longer written at all (2.5.3 changed a file every
  login reads). On one person's computer the 2.5.3 rules stand (backup first, no links or junctions, read back).

## Installer

- The setup / uninstall for all users end only processes of SYSTEM (and the person's own on uninstall), never other
  users' bridges. Files still in use are renamed / marked for removal at restart, never forced.

## Updates

- The signed list and SHA-256 checks are unchanged; requireSignature stays false (no code-signing key yet). The update
  is never put in place twice (so the kept previous version is the real one); no prompts; download timeouts.

## Cloud (tally-ingest)

- The new beat fields are cleaned like the others: fixed value lists (tallyWhy, connect), strings cut (200 / 300 / 40),
  a version pattern for `offered`, booleans only when true. Nothing new is written outside the device's info.beat.
