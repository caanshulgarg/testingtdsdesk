# Security review: FinCom Bridge 2.1.5

Range: f21b29f..be5542f (bridge-go/, server/tally-cloud/index.ts, migration-35-bridge-control.sql)
Reviewed: 02-Oct-2026, by a read-only security review in the Claude Code session, then re-read after the hardening.

Result: no exploitable issue. Five hardening points, all applied test-first (commit a6bd835):
1. /tray/* routes refuse browser-originated requests (Origin / Sec-Fetch-*); the tray clears only a self stop, a FinCom stop is lifted in FinCom. TestTrayResumeKeepsFinComStop, TestTrayRoutesRefuseBrowserOrigin.
2. The allow-list's Import fast path matches only importEnvelope's header at the start of the request. TestImportPathAnchored.
3. safeName refuses '.', '..', leading dots and control characters. TestSafeNameNoTraversal.
4. Migration 35 security-definer functions: search_path = public, pg_temp (checked by run_migration35.py).
5. Device-sent text (reason, request kind) renders as React text nodes; run_tally_computers.py checks an <img onerror> payload shows as text.

## Found safe
Every local route but /ping and /pair needs X-Bridge-Key; foreign origins get 403. Updates: RSA-signed latest.json, https only, SHA-256, never older, fails closed without a release answer; a forged beat answer can only narrow the choice. Edge function: firm from the device key only; all migration-35 queries filter by firm; inputs cleaned. SQL: owner-only RPCs, RLS by my_firm(), writes revoked from anon/authenticated, deletes refused by trigger.

Not verified: Windows ACLs on the install folders; my_firm() from an earlier migration (assumed to return the caller's firm).

## Round 2 (a6bd835 to 0215ea4) reviewed 02-Oct-2026, read-only
- Medium (fixed in 0aaaf23): a misused bridge key could grow the never-deleted tables tally_ledger_rounds / tally_ledger_marks without bound (a fresh round id per call, one held mark per ledger per call). Fixed: at most 50 new rounds per book in 24 h, no per-ledger marks for an unknown round, one held mark per (book, round, ledger), 60 ledger_list calls a minute per computer (429).
- Low (fixed in 0aaaf23): the rename merge branch could move a GUID off a row the guard kept live; now refused.
- Found safe: book ids always come from the device's own firm (tally_book_for); new RPCs service-role only, owner functions check the owner; search_path = public, pg_temp on every definer; RLS select-only by firm on tally_ledger_rounds; a bridge faking allowlist.measured can at most let a FinCom-signed build go out early (release-check blocks unmeasured builds at source).

## Rounds 4 to 8 (be5542f to the range below) reviewed 03-Oct-2026, read-only; fixes test-first
- HIGH (fixed, round 7/8): the owner's "Not in Tally - release" could not take effect: the bridge's memory re-locked the id on every retry and the cloud cleared the release. Now posts_take carries the releases still in force, the bridge sends once per release, and tally_post_id_accept keeps an owner release not older than the first acceptance; a finished posting takes no bridge update; owner stamps merge per entry.
- MEDIUM (fixed): Retry refused for any posting with a verified entry (guard broader than its purpose): confirmed entries no longer block. MEDIUM (fixed): the cloud guard did not match the installed 2.1.5's own texts ("Tally replied 'created', but the entry cannot be found"): matched now, in SQL and in tally-ingest, so the installed build's postings are held too. MEDIUM (fixed): POST /measure wrote a report to a caller-chosen path as LocalSystem: the routes ignore "out"; the report always goes under the bridge's folder. MEDIUM (fixed): one RPC per entry per update: stamps only new ids.
- LOW (fixed): posted-ids.json read in full per item, unbounded, write errors silent: in memory, tmp+rename, loud failure that holds the entry, verified notes pruned after 180 days. LOW (fixed): Retry of a posting with released ids could put one bill live in two postings: refused by tally_post_enqueue. LOW (fixed): console measure ran beside a busy bridge after a 3 s ping timeout: only "connection refused" counts as no bridge; a timeout says busy; follow capped at 25 minutes. LOW (fixed): a wrong-company acceptance was worded "post again": held with the right words.
- INFO (fixed): (r->>'accepted')::boolean could abort the whole requeue minute: tally_post_bool; mark posted requires the voucher number; reason cap kept under 500.
- Found safe: owner-only functions check active members.role = 'owner' and my_firm(), security definer with search_path public, pg_temp, revoked from public/anon; service-role RPCs refuse other roles; tally_post_jobs has no direct write for authenticated and every status change passes the resend guard; tally_post_ids_sync (36b and 37 identical) never frees an accepted id; nothing in the round deletes durable rows (soft deletes; migration 36 rename is TB-checked in one transaction); posted-ids keys are letters and digits only at a fixed path; posts_update caps every field; measure routes need the bridge key and refuse any Origin or Sec-Fetch header; the allow-list gained only FinComByMaster (one MasterID, one month, heads and narration).
- Not verified: Windows ACLs on the bridge's folders; the tray's identity beyond the bridge key (a local process with the key can start a measure, which reads only and is capped).

Range: be5542f..5c10789 (bridge-go/, server/tally-cloud/index.ts, migrations 36, 36b, 37, src/js post and queue files, app/src Post and Tally screens)

## Rounds 9 to 11 (5c10789 to the range below) reviewed 03-Oct-2026, read-only; fixes test-first before the 2.1.6 build
- HIGH: none.
- MEDIUM (fixed): PostOnly was enforced only in the posting worker; the bridge's local /import and /unpost routes bypassed it: enforced in postingAllowedFor for every import path and in /unpost. MEDIUM (noted, owner decision): the service runs as LocalSystem but reads the installing user's settings file, so that user (or a process as them) can remove PostOnly; no web-page path exists; a server-side per-device allow list set by the owner is the durable fix (proposed for a later file). MEDIUM (fixed): the short-read guard of 38 was dead because tally-ingest passed its own parsed count as the bridge's: the bridge's per-day count is passed (bounded) and logged.
- LOW (fixed): an empty-day marking left no record: tally_days.empty_at and note, and a day with more than 25 entries is marked only on a second consecutive empty read. LOW (fixed): a PostOnly refusal naming a company such as "Created 1 Pvt Ltd" could read as an acceptance: refused+postOnly is never accepted, in tally-ingest and in SQL. LOW (fixed): the carry could revive a soft-deleted item under the new name: a clash instead. LOW (noted): clients.data choices are rewritten whole inside the rename (last writer wins against a concurrent app save).
- INFO (fixed): the ledgers page showed Confirm to a superadmin who is not an owner: owners only.
- Found safe: every SECURITY DEFINER function of 36, 38, 39, 40 and 41 sets search_path public, pg_temp; service-only functions check auth.role() and are revoked/granted explicitly; the owner functions (confirm, release from Posted) check active members.role = 'owner' and my_firm(); the carry writes only rows of the book's own firm and client with parameters, never built SQL; a rogue bridge cannot free an id Tally accepted (the accept guard wins over a fake refusal); the empty-day flag marks soft only and a later file un-marks; release-check.sh's new exception rules have no smuggling path; the installer never overwrites a hand-set PostOnly.
- Not verified: Windows ACLs on the settings file (see the MEDIUM noted above).

Range: be5542f..27aa360 (bridge-go/, server/tally-cloud/index.ts, migrations 36 to 41, src/js post, queue and ledger files, app/src Post, Tally and Ledgers screens)
