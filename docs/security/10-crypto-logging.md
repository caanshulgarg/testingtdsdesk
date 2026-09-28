# 10. Classification, keys, encryption and logging

Owner: Anshul Garg · Version 0.1 draft, 27 Sep 2026

## 10.1 Classification (A.5.12)

| Class | Examples | Rules |
|---|---|---|
| Public | The web app code, the help pages, security.txt | May be published |
| Internal | Risk register, this pack, the architecture | Staff and auditors only |
| Client-Confidential | Bills, bank statements, PAN, GSTIN, salaries, Tally data, backups, the audit trail | Only in FinCom, Supabase or the client's own systems. Never in email, chat or personal drives. Never in test data. |
| Secret | API keys, the service role key, bridge keys, drop keys, two-step recovery codes | Only in Supabase secrets or a password manager. Rotate if ever seen elsewhere. |

## 10.2 Encryption (A.8.24)
- **In transit:**
  - HTTPS with TLS 1.2 or higher: GitHub Pages enforces HTTPS, and Supabase has TLS only.
  - The bridge uses plain HTTP, but only on 127.0.0.1 (the same computer), so it never crosses a network.
- **At rest:**
  - Supabase: AES-256 disk encryption.
  - Backups: encrypted by Supabase.
  - Laptops: FileVault or BitLocker.
- **Integrity:**
  - The bridge setup file's SHA-256 is published in `assets/bridge-setup.sha256` and shown in the app after download.
  - Commits are signed.
  - Code signing of the bridge is planned.
- **Passwords** are hashed by Supabase Auth (bcrypt) and never stored by the app.

## 10.3 Key management

| Key | Where it lives | Rotate |
|---|---|---|
| Supabase service role key | Supabase (edge function secrets) only | If ever exposed; yearly |
| Supabase publishable (anon) key | In the web app, public by design | Only if abused; rights are limited by RLS and by function grants |
| Claude API key | `platform_secrets` (gateway) | Yearly, or on exposure. Set a spend limit. |
| Google Vision key | `platform_secrets` | Yearly; restricted to the Vision API |
| GST API and FYN relay keys | Supabase secrets / relay server | **The relay key was shown in a chat: rotate now**; then yearly |
| Bridge key (per computer) | The bridge config file on the Tally computer, and that browser | Re-pair to change; never typed into chat |
| Drop keys (office automation) | Stored hashed (SHA-256) in `drop_keys` | Switch off when unused; yearly |

**How to rotate a platform key**
1. Make a new key at the provider.
2. Put it in using the admin screen's secret field.
3. Test: "Test Claude" / "Test Google" in Settings.
4. Revoke the old key at the provider.
5. Note the date in the ISMS log.

## 10.4 Logging (A.8.15–8.17)

| Log | What | Kept | Protected by |
|---|---|---|---|
| `activity` (audit trail) | Sign-ins, two-step sign-ins, sign-outs, every write to Tally (post, delete), people changes, wallet credits and refunds, admin actions | At least 180 days (CERT-In); planned 3 years | Append-only trigger: no update or delete, not even by the service role |
| Supabase auth, API and function logs | Requests and errors | As the Supabase plan allows; export monthly to meet 180 days | Supabase |
| Bridge log (`tds-bridge.log`) | Bridge actions on that computer | 5 MB × 6 files | Keys, codes and tokens masked |
| Git history | Every code change | Forever | Signed commits |

**Review.** Each week, look at failed sign-ins, new people, wallet credits and Tally deletes. Anything unexpected is treated as an incident (doc 7).

## 10.5 Legal register (A.5.31)

| Law / rule | What it asks | Where met |
|---|---|---|
| DPDP Act 2023 and Rules | Notice, purpose, security safeguards, breach notification, erasure, processor contracts | Docs 7, 9; privacy notice (to do) |
| CERT-In Directions 2022 | 6-hour incident reporting; 180-day logs; NTP-synchronised clocks; a point of contact | Docs 7, 10.4 |
| IT Act 2000 s.43A and the SPDI Rules 2011 | Reasonable security practices (ISO 27001 is recognised) | This ISMS |
| ICAI Code of Ethics | Confidentiality of client information | Doc 2 |
| Income-tax Act / GST law record keeping | Keeping books and returns | Client's duty; the app keeps its data while the firm is active |
