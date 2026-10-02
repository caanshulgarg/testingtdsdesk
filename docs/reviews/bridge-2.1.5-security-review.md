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

## Round 2 (a6bd835..0215ea4) reviewed 02-Oct-2026, read-only
- Medium (fixed in 0aaaf23): a misused bridge key could grow the never-deleted tables tally_ledger_rounds / tally_ledger_marks without bound (a fresh round id per call, one held mark per ledger per call). Fixed: at most 50 new rounds per book in 24 h, no per-ledger marks for an unknown round, one held mark per (book, round, ledger), 60 ledger_list calls a minute per computer (429).
- Low (fixed in 0aaaf23): the rename merge branch could move a GUID off a row the guard kept live; now refused.
- Found safe: book ids always come from the device's own firm (tally_book_for); new RPCs service-role only, owner functions check the owner; search_path = public, pg_temp on every definer; RLS select-only by firm on tally_ledger_rounds; a bridge faking allowlist.measured can at most let a FinCom-signed build go out early (release-check blocks unmeasured builds at source).
