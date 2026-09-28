# 5. Access control and passwords

Owner: Anshul Garg · Version 0.1 draft, 27 Sep 2026

## 5.1 Principles
- **One person, one login.** Logins are never shared, including in a small office.
- **Least privilege.** Staff get the role they need; the owner role is kept to the fewest people.
- **The database decides.** Every table has row-level security, and the app's checks are only a convenience. Firm data is visible only through `my_firm()`.

## 5.2 Roles in TDS Desk

| Role | Can | Two-step sign-in |
|---|---|---|
| owner | Everything in the firm: people, drop keys, backups, settings, posting to Tally | Optional (required once turned on) |
| staff | Work on clients, post to Tally | Optional (required if set up) |
| readonly | See only | Optional |
| platform administrator (`platform_admins`) | Firms, plans, credit, platform secrets | **Required for administration** (`is_superadmin()` is false without it); their own firm work does not need it |

## 5.3 Passwords and two-step sign-in
- Passwords are at least 10 characters (set in Supabase Auth: minimum length, and leaked-password protection on).
- A first password made by the admin function is 16 random characters. It is shown once and changed by the person.
- Two-step sign-in uses an authenticator app (TOTP). It is optional for firm users (decision of 28 Sep 2026: a second step on every sign-in was judged too heavy for client firms). Compensating controls: passwords of 10+ characters with the leaked-password check, Supabase sign-in rate limits, the last sign-in shown at each sign-in, idle sign-out, server-side logout, and the audit trail. The risk is accepted in the register (R3). A lost phone is reset by the firm owner (or the platform administrator for owners) with **Reset two-step**, only after confirming the person by phone or in person. The reset goes into the audit trail.
- Sessions end:
  - after the idle time the person chooses (10 to 120 minutes, 30 by default),
  - on sign-out, which also ends the session on the server.
- On a shared computer, "Also remove this firm's work from this computer" is ticked at sign-out.

## 5.4 Supplier and admin consoles

| Console | Rule |
|---|---|
| Supabase dashboard | Two-step sign-in on; only the ISMS owner; the service role key never leaves Supabase |
| GitHub | Two-step sign-in; signed commits; branch protection on `caanshulgarg/tds-desk` (no force-push; changes through the test site first) |
| Google Cloud, Anthropic Console | Two-step sign-in; API keys restricted (Vision API only; one key per environment) |
| Domain / DNS (if a custom domain is added) | Two-step sign-in; registrar lock |

## 5.5 Access review (quarterly)
1. List `members` per firm and `platform_admins`, and check each against the people who should have them.
2. Switch off leavers. This is recorded as `person.update` in the audit trail.
3. Check the drop keys (`my_drop_keys`) and switch off unused ones.
4. Check who can open the Supabase, GitHub, Google and Anthropic consoles.
5. Record the review (date, reviewer, changes) in the ISMS log.

## Evidence
- Supabase Auth settings (screenshots).
- The quarterly review records.
- `mfa_status` for the owners.
- The audit trail entries.
