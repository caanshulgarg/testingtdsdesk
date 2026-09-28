# 4. Statement of Applicability (ISO/IEC 27001:2022, Annex A)

| | |
|---|---|
| Owner | Anshul Garg |
| Version | 0.1 draft, 27 Sep 2026 |
| Scope | As in doc 1 |

**How to read the table**
- **Applies:** Y (applies) or N (does not apply, with the reason).
- **Status:**
  - **In place**: working, with evidence.
  - **Built**: done in code or on staging, and live after approval.
  - **Partial**: part of the control is in place.
  - **To do**: an owner action or a process still to start.
- The reason for including a control is "R" (a risk in doc 3), "L" (legal or contract) or "B" (good practice).

## A.5 Organisational controls

| Control | Applies | Why | How it is met | Status |
|---|---|---|---|---|
| 5.1 Policies for information security | Y | B | Doc 2 and topic policies 5–11 | To do (approve) |
| 5.2 Roles and responsibilities | Y | B | Doc 2 §2.3 | To do (approve) |
| 5.3 Segregation of duties | Y | R22 | Compensating: tests, staging, signed commits, external VAPT (doc 2 §2.3) | Partial |
| 5.4 Management responsibilities | Y | B | ISMS owner signs policies and runs the management review | To do |
| 5.5 Contact with authorities | Y | L | CERT-In and DPB contacts (doc 2 §2.5, doc 7) | Built |
| 5.6 Contact with special interest groups | Y | B | CERT-In advisories, Supabase and GitHub advisories | Partial |
| 5.7 Threat intelligence | Y | R5, R6 | GitHub Dependabot alerts on the repositories; CERT-In feeds; quarterly library review | To do (switch on Dependabot) |
| 5.8 Security in project management | Y | B | Security checklist in each change (doc 6 §6.3) | Built |
| 5.9 Inventory of assets | Y | B | Doc 1 §1.4 | Built |
| 5.10 Acceptable use | Y | B | Doc 11 §11.3 | Draft |
| 5.11 Return of assets | Y | B | Doc 11 §11.4 leaver checklist | Draft |
| 5.12 Classification of information | Y | B | Doc 10 §10.1: Public, Internal, Client-Confidential | Draft |
| 5.13 Labelling of information | Y | B | Exports and reports carry the firm and client name; the test site is marked TEST | Partial |
| 5.14 Information transfer | Y | R4 | HTTPS only (HSTS on GitHub Pages); the bridge on loopback; no email of client data by the app | In place |
| 5.15 Access control | Y | R2, R3 | Doc 5; row-level security per firm; roles owner, staff, readonly | Built |
| 5.16 Identity management | Y | R2 | One login per person; no shared logins; the admin function cannot take over existing logins | Built |
| 5.17 Authentication information | Y | R3, R11 | Password rules; random 16-character first passwords; secrets only on the server | Built |
| 5.18 Access rights | Y | R3 | Quarterly access review of members and platform_admins (doc 5 §5.5) | To do (first review) |
| 5.19 Security in supplier relationships | Y | R17 | Doc 9 | Draft |
| 5.20 Security in supplier agreements | Y | R17 | DPAs with Supabase, Anthropic, Google Cloud, GitHub | To do (sign) |
| 5.21 ICT supply chain | Y | R8, R9 | Libraries self-hosted and pinned; the bridge file fingerprinted; code signing planned | Partial |
| 5.22 Supplier monitoring and change | Y | B | Yearly review of supplier SOC 2 / ISO certificates (doc 9) | To do |
| 5.23 Cloud services | Y | R12 | Doc 9 §9.3: Supabase settings (region Mumbai, PITR, MFA on the Supabase account) | Partial |
| 5.24 Incident management planning | Y | L | Doc 7 | Draft |
| 5.25 Assessing security events | Y | L | Doc 7 §7.2 severity table | Draft |
| 5.26 Response to incidents | Y | L | Doc 7 §7.3 | Draft |
| 5.27 Learning from incidents | Y | B | Doc 7 §7.5 post-incident review | Draft |
| 5.28 Collection of evidence | Y | L | Doc 7 §7.4; the audit trail cannot be changed | Built |
| 5.29 Security during disruption | Y | B | Doc 8 | Draft |
| 5.30 ICT readiness for continuity | Y | R12, R22 | Doc 8: backups, restore test, offline working copy | Partial |
| 5.31 Legal and contractual requirements | Y | L | Register in doc 10 §10.5 (DPDP, CERT-In, IT Act 43A, ICAI) | Draft |
| 5.32 Intellectual property | Y | L | Library licences kept (Apache 2.0 for pdf.js, SheetJS CE and Tesseract) | In place |
| 5.33 Protection of records | Y | L | Append-only audit trail; backups; retention schedule | Partial |
| 5.34 Privacy and PII | Y | L | Privacy notice, purpose limitation, deletion on exit, DPDP notices | To do (notice) |
| 5.35 Independent review | Y | B | Yearly external VAPT; an internal audit by an independent CA | To do |
| 5.36 Compliance with policies | Y | B | Quarterly self-check against this SoA | To do |
| 5.37 Documented operating procedures | Y | B | docs/setup.md, docs/testing.md, the release steps (doc 6 §6.4) | In place |

## A.6 People controls

| Control | Applies | Why | How it is met | Status |
|---|---|---|---|---|
| 6.1 Screening | Y | B | Reference and ID check before access (doc 11) | Draft |
| 6.2 Terms of employment | Y | B | Confidentiality clause in appointment letters | Draft |
| 6.3 Awareness and training | Y | B | Yearly briefing plus a phishing refresher | To do |
| 6.4 Disciplinary process | Y | B | Firm's HR policy refers to breaches of this ISMS | Draft |
| 6.5 After termination | Y | B | Doc 11 §11.4 | Draft |
| 6.6 Confidentiality agreements | Y | L | NDA for staff, contractors and the VAPT firm | To do |
| 6.7 Remote working | Y | B | Doc 11 §11.3 | Draft |
| 6.8 Event reporting | Y | L | Doc 7 §7.1: anyone reports to the security lead at once | Draft |

## A.7 Physical controls

The service runs in suppliers' data centres (covered by their certifications). The firm's office and laptops are in scope for the people who work on it.

| Control | Applies | Why | How it is met | Status |
|---|---|---|---|---|
| 7.1 Physical perimeters | Y | B | Office locked outside hours | Owner to confirm |
| 7.2 Physical entry | Y | B | Keys held by partners | Owner to confirm |
| 7.3 Securing offices | Y | B | No client papers at open desks | Owner to confirm |
| 7.4 Physical security monitoring | N | — | A small office with no servers; the data centres are the suppliers' | — |
| 7.5 Physical and environmental threats | Y | B | Nothing critical is on premises; cloud providers cover this | In place |
| 7.6 Working in secure areas | N | — | No secure areas on premises | — |
| 7.7 Clear desk and clear screen | Y | B | Screen lock after 5 minutes; the app signs out when idle | Built |
| 7.8 Equipment siting | Y | B | Laptops only | In place |
| 7.9 Assets off-premises | Y | R18 | Full-disk encryption, screen lock | Owner to confirm |
| 7.10 Storage media | Y | B | No client data on USB; encrypted if unavoidable | Draft |
| 7.11 Supporting utilities | N | — | No on-premises processing | — |
| 7.12 Cabling security | N | — | No on-premises processing | — |
| 7.13 Equipment maintenance | Y | B | OS updates automatic | Owner to confirm |
| 7.14 Secure disposal | Y | B | Wipe laptops before disposal; keep a record | Draft |

## A.8 Technological controls

| Control | Applies | Why | How it is met | Status |
|---|---|---|---|---|
| 8.1 User endpoint devices | Y | R18 | FileVault, OS updates, the browser's own profile per firm user | Partial |
| 8.2 Privileged access | Y | R1, R2 | Platform administration needs two-step sign-in (`is_superadmin()` needs aal2); admin actions logged | Built |
| 8.3 Information access restriction | Y | R1 | RLS on every table; functions revoked from anon; cross-firm test | Built |
| 8.4 Access to source code | Y | R19 | GitHub two-step; the live repository protected | Owner to confirm |
| 8.5 Secure authentication | Y | R3 | Optional two-step sign-in (TOTP), required for platform administration; strong passwords with leaked-password check; last sign-in shown; server logout; idle sign-out; Supabase rate limits | Built |
| 8.6 Capacity management | Y | B | Supabase usage alerts; the bridge posts in chunks of 25 | Partial |
| 8.7 Protection against malware | Y | B | Defender or XProtect on laptops; uploads parsed, never executed; PDF scripts off | Partial |
| 8.8 Technical vulnerabilities | Y | R5, R6 | Libraries upgraded; Dependabot; yearly VAPT; fix within SLA | Built / To do |
| 8.9 Configuration management | Y | B | All config in git (build.py, migrations in server/); secrets outside git | In place |
| 8.10 Information deletion | Y | R16 | Remove the local copy at sign-out; firm deletion on request; backups age out after 14 | Partial |
| 8.11 Data masking | Y | B | Secrets shown as the last 4 characters; the bridge log masks keys | Built |
| 8.12 Data leakage prevention | Y | R4, R7 | CSP limits where data can go (connect-src); no-referrer | Built |
| 8.13 Information backup | Y | R12 | Nightly backup job plus Supabase PITR; restore test | Partial |
| 8.14 Redundancy | Y | R12 | Supabase managed; the browser's working copy lets work go on offline | Partial |
| 8.15 Logging | Y | R14, L | Append-only `activity`; Supabase auth and API logs; bridge log | Built |
| 8.16 Monitoring | Y | B | Weekly look at the Supabase security advisor and the auth logs | To do |
| 8.17 Clock synchronisation | Y | B | Cloud providers use NTP; logs in UTC with time zone | In place |
| 8.18 Privileged utility programs | Y | B | The service role key is only in edge functions; SQL access only through the Supabase dashboard with two-step sign-in | Partial |
| 8.19 Software on operational systems | Y | R9 | The bridge installs per user, no admin rights; fingerprint; code signing planned | Partial |
| 8.20 Networks security | Y | R21 | The bridge on loopback; HTTPS everywhere | In place |
| 8.21 Security of network services | Y | B | Supplier TLS; CORS limited to our origins on edge functions | Built |
| 8.22 Segregation of networks | N | — | No own network; cloud tenancy separation by the supplier | — |
| 8.23 Web filtering | N | — | No managed office network; endpoint browsers only | — |
| 8.24 Use of cryptography | Y | R7, R11 | TLS 1.2+, AES at rest (Supabase), SHA-256 fingerprints, key rotation (doc 10) | Partial |
| 8.25 Secure development life cycle | Y | B | Doc 6 | Built |
| 8.26 Application security requirements | Y | R4 | Doc 6 §6.2 requirements list | Built |
| 8.27 Secure architecture | Y | B | The database enforces tenancy; the gateway holds the keys; least privilege | Built |
| 8.28 Secure coding | Y | R4 | `esc()` everywhere; CSP; build refuses duplicate names and inline `<img>` | Built |
| 8.29 Security testing | Y | B | Hostile-input, CSP, library and cross-firm tests in the suite; VAPT yearly | Built |
| 8.30 Outsourced development | Y | B | An AI coding assistant works under the owner's review; the VAPT firm under NDA | Partial |
| 8.31 Separation of environments | Y | B | Test site and staging database separate from live; the build forbids the test build from naming live | In place |
| 8.32 Change management | Y | R13, R19 | Test first, then approval, then publish to live; signed commits; release notes in APP_VERSION | In place |
| 8.33 Test information | Y | R16 | Test data synthetic or ZZ TEST; no live client data on staging | Partial |
| 8.34 Protection during audit testing | Y | B | VAPT on staging with test accounts; no destructive tests on live | Draft (doc 12) |

**Controls excluded:** 7.4, 7.6, 7.11, 7.12, 8.22, 8.23. All other 87 apply.

Approved by the ISMS owner: ____________________  Date: ________
