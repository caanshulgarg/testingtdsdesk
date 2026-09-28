# 3. Risk method and risk register

| | |
|---|---|
| Owner | Anshul Garg |
| Version | 0.1 draft, 27 Sep 2026 |
| Next review | Quarterly, and after every VAPT or incident |

## 3.1 Method (6.1.2)

Each risk is scored for **likelihood** (L) and **impact** (I) on a scale of 1 to 5. **Risk = L × I**.

| Score | Level | What happens |
|---|---|---|
| 15–25 | High | Must be treated before certification |
| 8–14 | Medium | Treat within the quarter, or accept with a reason |
| 1–7 | Low | May be accepted by the ISMS owner |

Impact is judged on the worst of:
- client data exposed,
- wrong figures filed or posted to Tally,
- service down near a due date,
- legal or regulatory breach.

Treatment is one of: reduce, avoid, transfer, or accept. The **residual** score is the score after the listed controls.

## 3.2 Register

| # | Risk | L | I | Score | Treatment and controls (Annex A) | Residual | Owner / status |
|---|---|---|---|---|---|---|---|
| R1 | Anyone with the public key calls internal money functions (credit or charge any firm's wallet, purge backups) | 4 | 5 | **20** | Reduce: execute rights removed from anon and authenticated; only the server calls them (A.8.3, 8.26) | 2 | Fixed on staging 27 Sep; **live awaiting approval** |
| R2 | A firm owner takes over another person's login via "add person" (it reset the password of any existing email) | 3 | 5 | **15** | Reduce: an existing login is never reset or moved; roles checked; the last owner is protected (A.5.15, 8.2) | 2 | Fixed on staging; live awaiting approval |
| R3 | A stolen password gives access to a whole firm's data | 3 | 5 | **15** | Reduce: optional two-step sign-in (enforced by the database once turned on); required for platform administration; 10+ character passwords with the leaked-password check; last sign-in shown at each sign-in; idle sign-out; server-side logout. Accept the rest: mandatory two-step for firms was judged too heavy (owner's decision, 28 Sep 2026) (A.5.17, 8.5) | 6 | Built; residual accepted by the owner |
| R4 | Cross-site scripting through data from files, Tally or other firm members | 3 | 5 | **15** | Reduce: everything escaped; cloud identifiers cleaned on the way in; a strict CSP blocks inline and outside scripts; hostile-input test (A.8.26, 8.28) | 3 | Built (build 170) |
| R5 | Malicious PDF runs script (pdf.js CVE-2024-4367) | 3 | 4 | **12** | Reduce: pdf.js 4.10.38; scripts in PDFs are never run (A.8.8) | 2 | Built |
| R6 | Malicious spreadsheet (SheetJS CVE-2023-30533, prototype pollution) | 3 | 4 | **12** | Reduce: SheetJS 0.20.3 (A.8.8) | 2 | Built |
| R7 | API keys stolen from the browser (Claude and Google keys used to be kept in localStorage) | 3 | 3 | **9** | Avoid: keys only on the server gateway; old stored keys wiped at start-up (A.8.24) | 1 | Built |
| R8 | Library served from an outside CDN is changed (supply chain) | 2 | 5 | **10** | Reduce: every library served from our own site; the CSP allows only 'self' for scripts (A.5.21, 8.28) | 2 | Built |
| R9 | The bridge setup file is tampered with between us and the client | 2 | 5 | **10** | Reduce: published SHA-256 fingerprint shown after download; **code signing** (needs a certificate) (A.8.24, 5.21) | 6 | Fingerprint built; signing is an owner action |
| R10 | The bridge log leaks keys or codes | 2 | 3 | 6 | Reduce: keys, tokens and codes masked; log rotated at 5 MB (A.8.15) | 2 | Built (bridge 1.12.7) |
| R11 | The platform secret (Claude, Google, GST or FYN key) is exposed; the relay key was once shown in a chat | 3 | 4 | **12** | Reduce: rotate the keys; secrets only in Supabase secrets; admin screen shows the last 4 characters only (A.5.17, 8.24) | 4 | **Owner action: rotate** |
| R12 | Supabase outage or data loss | 2 | 5 | **10** | Reduce: nightly backups (14 kept) and Supabase PITR; each browser keeps a working copy; restore test each quarter (A.8.13, 5.30) | 5 | Restore test to be done |
| R13 | Wrong entries posted to or deleted from Tally | 3 | 4 | **12** | Reduce: read-back check after each batch; balance reconciliation; every Tally write in the audit trail; test site uses a ZZ TEST company (A.8.32) | 4 | Built |
| R14 | No record of who did what (repudiation) | 3 | 3 | 9 | Reduce: append-only audit trail (`activity`); person and wallet changes recorded by the server (A.8.15) | 2 | Built on staging |
| R15 | Unlimited sign-ups to farm trial credit, or abuse of the gateway | 3 | 3 | 9 | Reduce: gateway limits (model list, max tokens, quantity); **add CAPTCHA and email verification to signup** (A.8.20) | 4 | Partly built |
| R16 | Personal data kept longer than needed (DPDP) | 3 | 3 | 9 | Reduce: retention schedule; firm-level delete on exit; option to remove the local copy at sign-out (A.5.33, 5.34) | 4 | Retention rules to be approved |
| R17 | Clients' data processed by an AI provider outside India | 2 | 3 | 6 | Accept with notice: the privacy notice names Anthropic and Google; no training on API data under their terms; DPAs signed (A.5.19, 5.34) | 4 | DPAs are an owner action |
| R18 | Developer's Mac lost or compromised | 2 | 5 | **10** | Reduce: FileVault, screen lock, signed commits, GitHub two-step, no client data on the Mac beyond synthetic test files (A.8.1, 7.9) | 4 | Owner to confirm |
| R19 | GitHub account compromised: malicious code published | 2 | 5 | **10** | Reduce: two-step sign-in on GitHub, branch protection on the live repository, signed commits (A.8.4, 8.32) | 4 | Owner to confirm |
| R20 | Clickjacking and framing of the app | 2 | 3 | 6 | Reduce: a framing guard; `frame-ancestors 'none'` where headers are possible (A.8.26) | 3 | Built; headers need a host that supports them |
| R21 | The bridge reachable from other computers | 1 | 5 | 5 | Reduce: listens on 127.0.0.1 only; a key paired by a 6-digit code; allowed origins only (A.8.20) | 2 | Built |
| R22 | Key person dependency (one developer) | 4 | 4 | **16** | Reduce: documented build and release (docs/), tests, and the repository kept with a partner; name a second developer or a support firm (A.5.30, 6.1) | 10 | Owner action |

## 3.3 Acceptance

The ISMS owner accepts the residual risks above, dated and signed: ____________________

## Evidence
- This register, versioned.
- Links to the fixes (doc 13).
- The VAPT report and the retest.
