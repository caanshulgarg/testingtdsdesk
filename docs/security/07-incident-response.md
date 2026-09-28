# 7. Incident response

Owner: Anshul Garg (security lead) · Version 0.1 draft, 27 Sep 2026

## 7.1 Reporting (A.6.8)

Anyone who sees something wrong reports it **at once** to the security lead, by phone first and then in writing. Examples:
- a strange sign-in,
- data of another firm on screen,
- a lost laptop or phone,
- a key pasted somewhere it should not be,
- entries in Tally nobody made.

Do not investigate alone, and do not delete anything.

Outsiders report through `.well-known/security.txt` (see the [vulnerability disclosure](vulnerability-disclosure.md) document).

## 7.2 Severity (A.5.25)

| Level | Examples | Start within |
|---|---|---|
| S1 Critical | One firm's data seen by another; a key or secret exposed; live site defaced or changed; ransomware on a team laptop | 1 hour |
| S2 High | An account taken over; a Tally company wrongly posted to at scale; service down near a due date | 4 hours |
| S3 Medium | A single account locked out by attacks; a failed backup; a vulnerability reported without exploitation | 1 working day |
| S4 Low | A phishing email received and not clicked | Log only |

## 7.3 Steps (A.5.26)

1. **Contain**
   - Switch off the affected login (the admin function `set_person active=false`, or ban it in Supabase Auth).
   - Rotate any exposed secret. The order and places are in doc 10 §10.3.
   - If the web app is affected, publish the previous commit.
   - If the database is affected, pause the edge functions or switch off sign-up in `app_settings`.
2. **Preserve evidence** (§7.4) before changing more.
3. **Assess**
   - Which firms and which data (PAN, bank, salary)?
   - How many people are affected?
   - From when to when?
4. **Notify within the legal time limits** (§7.6).
5. **Recover.** Restore from backup if needed (doc 8), then confirm with the affected firms.
6. **Close.** Hold the post-incident review (§7.5).

## 7.4 Evidence (A.5.28)
- Export and keep, with a SHA-256 of each file:
  - the `activity` rows for the period (this table cannot be changed),
  - Supabase auth, API and edge-function logs (Dashboard → Logs, CSV),
  - the git log,
  - the bridge log from the client's computer if relevant.
- Keep everything for at least 180 days (CERT-In).
- Record in the incident log who collected what, and when.

## 7.5 Learning (A.5.27)

Within 10 working days of closing, write down:
- the timeline,
- the root cause,
- what worked and what did not,
- the actions, each with an owner and a date.

Then update the risk register (doc 3).

## 7.6 Legal time limits (A.5.31)

| To whom | When | How |
|---|---|---|
| **CERT-In** (CERT-In Directions, 28 Apr 2022: data breach, unauthorised access, website compromise and similar) | **Within 6 hours** of noticing | incident@cert-in.org.in, in the CERT-In incident form |
| **Client firms affected.** TDS Desk usually processes data for the firm, so each firm has its own duty to its data principals. | Without delay, and within 24 hours | Email plus a phone call to the firm owner |
| **Data Protection Board and affected people**, where the firm is itself the Data Fiduciary (DPDP Act 2023, s.8(6), and the DPDP Rules) | Intimation without delay; the detailed report within the time the Rules set (72 hours in the Rules as published; confirm the current text) | As the Board prescribes |
| Insurer (if cyber cover is bought) | As the policy says | — |

## 7.7 Contacts

| | |
|---|---|
| Security lead | Anshul Garg, [phone] |
| Supabase support | Dashboard → Support (Pro plan or higher for a priority response) |
| GitHub | support.github.com; security@github.com for a platform issue |
| CERT-In | incident@cert-in.org.in, +91-1800-11-4949 |

## 7.8 Practice

A tabletop exercise is held once a year. The scenario is "the relay key was pasted into a chat; what now?", worked through to the end.

## Evidence
- The incident log.
- The exercise record.
- Notification copies.
