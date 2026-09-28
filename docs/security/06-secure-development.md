# 6. Secure development and change

Owner: Anshul Garg · Version 0.1 draft, 27 Sep 2026

## 6.1 Environments (A.8.31)

| Environment | Web | Database | Data |
|---|---|---|---|
| Development | Local build (`python3 build.py`) and the test suite | Stand-ins in tests | Synthetic only |
| Test | caanshulgarg.github.io/testingtdsdesk, marked TEST | Supabase `tds-desk-staging` | Synthetic, or the ZZ TEST company in Tally |
| Live | caanshulgarg.github.io/tds-desk | Supabase `tds-desk` | Client data |

`build.py` stops the build if the test build names the live database, or if test storage names leak into the live source.

## 6.2 Security requirements for every change (A.8.26)
1. Anything from outside (files, Tally, the cloud, error messages) goes into HTML only through `esc()`. Ids from the cloud are cleaned by `cleanIds`.
2. No new outside script or style host. Libraries go into `assets/`, pinned, with their licence noted.
3. No inline event handlers (`onclick=`) and no `eval`. The CSP would block them in any case.
4. New tables get RLS, with `firm_id = my_firm()` in every policy. New functions are `security definer` with `set search_path`, and are granted to `authenticated` only.
5. Secrets never go into the code, the browser or the logs.
6. Every write to Tally or to people and money goes into the audit trail.

## 6.3 Checklist before a change goes to the test site
- [ ] Full test suite run; failures explained. `run_clearing.js` and `run_regress.js` have known data-dependent failures.
- [ ] Security tests pass: `run_libs_ui.py` (own-site libraries, CSP, no stored keys), `run_hostile_ui.py` (no injected markup), `run_twostep_ui.py`.
- [ ] Database change written as a migration file under `server/` and applied to staging first.
- [ ] Cross-firm test (`tests/rls_isolation.sql`) run on staging after any database change.
- [ ] `APP_VERSION` build number and note updated.

## 6.4 Release to live (A.8.32)
1. The change has been on the test site and has been tried there.
2. The owner approves in writing (a chat or email is enough, kept).
3. Migrations are applied to live in the same order as on staging.
4. The test build is published to the live repository with a signed commit.
5. Two-minute smoke check on live: sign in, open a client, read one bill.
6. Rollback: publish the previous commit. Database migrations are written to be additive, so the old app keeps working.

## 6.5 Vulnerability management (A.8.8)

| Severity (CVSS 3.1) | Fix within |
|---|---|
| Critical 9.0+ | 7 days, or take the feature offline |
| High 7.0–8.9 | 30 days |
| Medium 4.0–6.9 | 90 days |
| Low | Next planned release |

- Sources: Dependabot on both repositories, CERT-In advisories, and the VAPT report.
- Library review each quarter. The current versions are pdf.js 4.10.38, SheetJS CE 0.20.3 and Tesseract core 5.1.1.

## 6.6 Outsourced and AI-assisted development (A.8.30)

Code written by an AI assistant is treated like a contractor's:
- the owner reviews it,
- it passes the tests,
- it goes through the test site.

The assistant works without live database secrets. Live changes need the owner's approval.

## Evidence
- The git history (signed commits).
- Test outputs kept with each release.
- Migration files.
- The Dependabot page.
- VAPT and retest reports.
