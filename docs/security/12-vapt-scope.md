# 12. VAPT scope and readiness (for the testing firm)

Owner: Anshul Garg · Version 0.1, 27 Sep 2026

## 12.1 Choose the firm
- **CERT-In empanelled** auditor. Clients and banks ask for this, and the report is accepted for ISO 27001 A.8.8.
- Ask for:
  - OWASP ASVS L2 web testing,
  - an API test against the Supabase REST/RPC and edge functions,
  - a thick-client review of the Tally Bridge (PowerShell on Windows),
  - one free retest.
- Budget guide (2026): ₹60,000–1,50,000 for this scope. Get 3 quotes.

## 12.2 In scope

| Target | Address | Notes |
|---|---|---|
| Web app (test copy) | https://caanshulgarg.github.io/testingtdsdesk/ | Identical code to live, except for the TEST mark and storage names |
| API | https://qbocskaiewaxqcvaunzc.supabase.co (staging): `/auth/v1`, `/rest/v1` (tables and `rpc/*`), `/storage/v1`, `/functions/v1/{gateway, admin, signup, support-mail, gst-api}` | The publishable key is in the page, by design |
| Tally Bridge 1.12.7 | Setup-TDS-Bridge.bat from the app; runs on 127.0.0.1:9100 | Test on a Windows VM with TallyPrime Educational and a ZZ TEST company |

## 12.3 Out of scope
- The live site `caanshulgarg/tds-desk` and the live Supabase project `nrtczucrlgalvtojwoes`.
- Supabase's and GitHub's own infrastructure.
- Denial-of-service and volumetric testing.
- Social engineering.

## 12.4 Test accounts (made before the test, deleted after)

| Account | Firm | Role | Two-step |
|---|---|---|---|
| vapt-owner-a@… | VAPT Firm A | owner | Set up by the tester |
| vapt-staff-a@… | VAPT Firm A | staff | No |
| vapt-readonly-a@… | VAPT Firm A | readonly | No |
| vapt-owner-b@… | VAPT Firm B | owner | Set up by the tester (for cross-firm tests) |

Platform administrator access is **not** given. The tester checks that it cannot be obtained.

## 12.5 What the tester should know (design choices, to save time)
- The Supabase publishable key is public by design. Security rests on RLS and on function grants.
- Firm isolation: every firm table uses `firm_id = my_firm()`. `my_firm()` is empty until two-step sign-in is complete for users who need it.
- Only `signup_info`, `post_inbox` and `refresh_inbox_link` can be called without signing in. The last two need a drop key (stored hashed).
- The CSP is a meta tag, because GitHub Pages cannot send headers. `frame-ancestors` is therefore not available there, and a script guard is used instead. `_headers` is ready for a host that supports headers.
- The bridge accepts requests only from the allowed origins and with the paired key. It listens on loopback only.

## 12.6 Readiness checklist (done 27 Sep 2026 unless marked)
- [x] Libraries without known exploitable CVEs (pdf.js 4.10.38, SheetJS 0.20.3)
- [x] No third-party script hosts; CSP; no inline handlers
- [x] No API keys in the browser
- [x] Output escaping review; hostile-input test
- [x] Internal functions not callable by anon or authenticated users (staging; **live pending approval**)
- [x] Admin function: no account takeover through "add person"; roles checked
- [x] Two-step sign-in for owners and admins, enforced in the database (staging)
- [x] Append-only audit trail
- [x] Edge functions: CORS limited, input limits, two-step check
- [ ] Sign-up: add CAPTCHA (Supabase Auth → Bot protection, hCaptcha or Turnstile) and email confirmation
- [ ] Supabase Auth settings: minimum password length 10; leaked-password protection on
- [ ] Rotate the platform keys (doc 10.3)
- [ ] Code-sign the bridge

## 12.7 After the test
1. Fix the findings within the SLA (doc 6.5).
2. Get the retest and the final report.
3. Update the risk register.
4. Delete the test accounts; the deletion is recorded in the audit trail.
