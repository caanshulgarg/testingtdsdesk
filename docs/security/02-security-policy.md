# 2. Information security policy and roles

| | |
|---|---|
| Document owner | Anshul Garg (ISMS owner) |
| Version | 0.1 draft, 27 Sep 2026 |
| Approved by | Board of directors of Yuvnav Services Private Limited, on: — |
| Review | Every 12 months, and after any major incident or change |

## 2.1 Policy statement (5.2)

Yuvnav Services Private Limited protects the confidentiality, integrity and availability of the information that its clients entrust to FinCom. We:

1. Treat every client's data as confidential. It is used only to give the service the client asked for.
2. Keep one firm's data separate from every other firm's, enforced by the database itself and not only by the app.
3. Give people only the access their work needs, and require two-step sign-in for anyone who can administer.
4. Keep the service available around return due dates, and be able to restore data within one working day.
5. Build security into every change, and test before anything reaches the live site.
6. Report and learn from incidents, and meet CERT-In and DPDP timelines.
7. Meet legal, regulatory and contractual requirements, and improve the ISMS continually.

## 2.2 Objectives (6.2), measured each quarter

| Objective | Measure | Target |
|---|---|---|
| No cross-firm data exposure | Cross-firm isolation test (`tests/rls_isolation.sql`) run each release | 100 % pass |
| Admins protected | Owners and administrators with two-step sign-in | 100 % |
| Vulnerabilities fixed on time | Critical fixed within 7 days, high within 30, medium within 90 | 100 % |
| Backups restorable | Restore test each quarter | Pass, under 4 hours |
| Staff awareness | Security briefing completed | 100 % yearly |
| Dependencies current | Libraries with known exploitable CVEs in the live site | 0 |

## 2.3 Roles (5.3)

| Role | Held by | Responsible for |
|---|---|---|
| ISMS owner / top management | Anshul Garg | Approves policies, accepts risks, provides resources, chairs the management review |
| Security lead | Anshul Garg (until a second person joins) | Risk register, incidents, access reviews, supplier reviews, VAPT follow-up |
| Developer | Anshul Garg; AI coding assistant under his review | Secure development (doc 6); no change goes live without his review |
| Platform administrator | Named people only (listed in `platform_admins`) | Firm set-up, credit, secrets; two-step sign-in required |
| Firm owner (client side) | Each client firm's owner | Their users' accounts and roles, and their own computers |
| Internal auditor | An independent CA or consultant (to be appointed) | The internal audit before certification |

The developer and the approver are the same person. So **segregation of duties** (A.5.3) is compensated by:
- automated tests that must pass,
- a change record for every release (the git history, signed commits),
- the separate test site and staging database,
- the yearly external VAPT.

## 2.4 Topic policies (A.5.1)

This policy is supported by documents 5 to 11 in this pack. Where they conflict, the stricter rule applies.

## 2.5 Contact with authorities and groups (A.5.5, A.5.6)

- CERT-In: incident@cert-in.org.in, +91-1800-11-4949. Reporting within 6 hours (see doc 7).
- Data Protection Board of India: as notified under the DPDP Rules.
- Special interest: CERT-In advisories, Supabase and GitHub security advisories, and ICAI Digital Accounting and Assurance Board updates.

## Evidence
- The signed policy.
- The objectives tracker.
- The role list.
- Minutes of the management review (9.3), held yearly.
