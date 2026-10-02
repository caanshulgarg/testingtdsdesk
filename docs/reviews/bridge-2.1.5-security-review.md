# Security review: FinCom Bridge 2.1.5

Range: f21b29f..a6bd835 (bridge-go/, server/tally-cloud/index.ts, migration-35-bridge-control.sql)
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
