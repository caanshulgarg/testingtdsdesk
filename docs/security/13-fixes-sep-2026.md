# 13. What was fixed in September 2026 (build 170, bridge 1.12.7)

This is the evidence record for the pre-VAPT hardening. Everything is on the **test site and staging**. Live follows after approval (doc 14).

## Critical and high

| # | Finding | Fix | Test |
|---|---|---|---|
| F1 | **Anyone with the public key could call `refund_charge`, `charge_for`, `run_monthly_core`, `take_backup`, `price_of`.** This allowed adding credit to any firm's wallet, charging another firm, or purging backups. | Execute rights removed from anon and authenticated; server only. `take_backup` on request only for the firm's own owner. Every other function taken away from anon except the 3 public ones. `server/security/migration-1-functions.sql` | `has_function_privilege` check on staging |
| F2 | **Account takeover through the admin function.** "Add person" with an existing email reset that login's password and returned it, and moved the login into the caller's firm. This worked even for another firm's owner or a platform administrator. | An existing login is never reset or moved. Roles are checked, the last owner is protected, and platform administrators are untouchable. First passwords are 16 random characters from a secure source (they were a word plus 4 digits). Two-step sign-in is required. Every action is recorded in the audit trail. `server/security/functions/admin` | Code review; deployed to staging (v7) |
| F3 | No second factor. | TOTP two-step sign-in, optional for firm users (owner's decision, 28 Sep 2026) and enforced by the database once turned on; always required for platform administration (`is_superadmin()` stays false without it). The last sign-in is shown at each sign-in. Owners can reset it for a lost phone. `migration-2-mfa-audit.sql`, `src/js/43-two-step.js` | `run_twostep_ui.py`; SQL test aal1 → 0 records, aal2 → all |
| F4 | pdf.js 3.11.174: CVE-2024-4367, script execution from a crafted PDF. Three of the four `getDocument` calls lacked `isEvalSupported:false`. | pdf.js 4.10.38 served from this site; every PDF is opened through `openPdfDoc` with eval off. | `run_libs_ui.py` |
| F5 | SheetJS 0.18.5: CVE-2023-30533, prototype pollution from a crafted file. | SheetJS CE 0.20.3 | `run_libs_ui.py` |
| F6 | Claude and Google API keys kept in localStorage; the browser called the providers directly. | Own-key paths removed; the gateway only; stored keys wiped at start-up. | `run_libs_ui.py` |
| F7 | Identifiers from the cloud (written by any firm member or by the inbox automation) went into HTML attributes unescaped (about 150 places); Tally GUIDs likewise. | Ids cleaned on the way in (`cleanIds`, `cloudRowOk`); GUIDs cleaned at parse; the remaining attribute and number spots escaped; `fmtDate` falls back safely. | `run_hostile_ui.py` (18 screens) |

## Medium and low

| # | Finding | Fix |
|---|---|---|
| F8 | No Content Security Policy; scripts from cdnjs and jsdelivr; OCR engine injected as inline text | CSP with script hashes built by `build.py`; all libraries self-hosted; the OCR engine loaded as a file; the build refuses to go ahead if a stray literal `<img` could be misread by the browser's preload scanner |
| F9 | Clickjacking | Framing guard; `frame-ancestors 'none'` and other headers in `_headers` for hosts that support them |
| F10 | Referrer leakage | `no-referrer` |
| F11 | Sign-out left the refresh token valid; no idle time-out; local data stayed | Server logout; idle sign-out (default 30 minutes); option to remove the firm's local copy |
| F12 | No audit trail of actions | `activity` is append-only (a trigger blocks update and delete), and the user is always the signed-in person. Sign-in, two-step, sign-out, Tally post and delete, and admin, people and wallet changes are recorded. |
| F13 | Gateway: any model, any size, any quantity; CORS `*`; refunds called a function that did not exist | Model allow-list, max_tokens capped at 16,000, quantity 1–20, request size limit, CORS limited to our origins, refunds through `refund_charge`, two-step check |
| F14 | `charge_usage` accepted zero or negative quantities | Refused |
| F15 | Bridge log could hold keys and codes; it grew without limit | Masking; rotation at 5 MB × 6 |
| F16 | Bridge setup file could not be checked | SHA-256 published and shown after download |
| F17 | Tally home view crashed with no client open | Fixed |
| F18 | No security contact | `.well-known/security.txt`, vulnerability disclosure policy |

## Still open (see doc 14)
- Apply F1–F3 and F12–F14 to **live**.
- Sign-up CAPTCHA and email confirmation.
- Rotate the platform keys.
- Code signing of the bridge.
- Signed supplier agreements.
