# 1. ISMS scope and context

| | |
|---|---|
| Document owner | Anshul Garg (ISMS owner) |
| Version | 0.1 draft, 27 Sep 2026 |
| Approved | — |

## 1.1 The organisation (4.1)

Yuvnav Services Private Limited, Noida, builds and runs **FinCom** (finance and compliance). FinCom is a web application for accounting firms and businesses. It:
- reads purchase bills and bank statements,
- works out TDS and GST,
- posts entries to TallyPrime through a small program on the client's computer (the Tally Bridge),
- reconciles ledgers and produces MIS and audit findings.

**Internal issues**
- The team is small, with one developer-owner.
- The data handled is financial and personal: PAN, GSTIN, bank transactions, salaries and vendor details.
- The firm depends on cloud suppliers.

**External issues**
- The Digital Personal Data Protection Act 2023 (DPDP) and its Rules.
- The CERT-In Directions of 28 April 2022, which require incidents to be reported within 6 hours and logs to be kept for 180 days.
- The IT Act 2000, section 43A.
- ICAI confidentiality rules.
- Client demand for VAPT reports.

## 1.2 Interested parties (4.2)

| Party | What they need from us |
|---|---|
| Client firms and their staff | Their data kept confidential and correct; the service available at return due dates |
| Businesses whose books are processed (data principals' employers, vendors) | Their PAN, bank and salary data used only for the purpose it was given for |
| Regulators: CERT-In, Data Protection Board, ICAI | Incident reports, logs, lawful processing |
| Suppliers (see doc 9) | Use within their terms |
| The company's directors and shareholders | Revenue, reputation, no liability |

## 1.3 Scope statement (4.3)

> The information security management system covers the design, development, operation and support of the FinCom software service. This includes:
> - the web application (the GitHub repository and GitHub Pages sites),
> - the Supabase cloud back end (database, authentication, storage and edge functions, Mumbai region),
> - the Tally Bridge program as distributed,
> - the people and computers of Yuvnav Services Private Limited who develop and support it,
>
> from the office at [address to be filled in] and remote work.

**Out of scope**
- Clients' own computers, networks and TallyPrime installations. The client is responsible for these, and the service agreement says so.
- The audit and tax practice of any associated CA firm, which is not the software service.
- Suppliers' internal controls. These are covered by their own certifications (see doc 9).

## 1.4 What is in the scope

| Asset | Where | Holds |
|---|---|---|
| Web app (index.html and assets) | GitHub Pages: live `caanshulgarg/tds-desk`, test `caanshulgarg/testingtdsdesk` | Code only; no client data |
| Browser storage (IndexedDB, localStorage) | Each user's computer | A working copy of the firm's data. It is removed on request at sign-out (build 170). |
| Supabase project `tds-desk` (live) and `tds-desk-staging` | ap-south-1 (Mumbai) | Firms, members, clients, records, bank rows, sales, books, backups, wallet, documents (storage bucket) |
| Edge functions | Supabase | gateway (Claude, Google Vision), admin, signup, support-mail, gst-api |
| Platform secrets | Supabase table `platform_secrets` and function secrets | Claude API key, Google Vision key, GST API keys, FYN relay key |
| Tally Bridge | The client's Tally computer, listening on 127.0.0.1 only | Pairing key, log file, optional nightly copy of the day book |
| FYN relay | Server described in `server/fyn-relay` | Relay key |
| Source code | GitHub, the owner's Mac | Code, tests, test data (must be synthetic) |

## Evidence
- This document, approved.
- An architecture diagram: `docs/architecture.md`.
- An asset list: section 1.4, reviewed each quarter.
