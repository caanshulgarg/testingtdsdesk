# 9. Suppliers

Owner: Anshul Garg · Version 0.1 draft, 27 Sep 2026 · Review yearly

## 9.1 Register

| Supplier | Service | Data it sees | Where | Their assurance | Agreement to have | Status |
|---|---|---|---|---|---|---|
| Supabase Inc. | Database, auth, storage, edge functions | All firm data | AWS ap-south-1 (Mumbai) | SOC 2 Type II; HIPAA option | DPA (in the dashboard, under Legal documents) | **Sign DPA** |
| GitHub (Microsoft) | Code hosting, Pages (the web app) | Code only; no client data | Global CDN | SOC 2, ISO 27001 | GitHub Customer Agreement and DPA | Accepted by use; download a copy |
| Anthropic PBC | Claude API: reading bills that the free OCR cannot read | Bill images and text sent for reading | USA | SOC 2 Type II, ISO 27001, ISO 42001 | Commercial Terms and DPA; API data is not used for training | **Sign DPA / accept Commercial Terms** |
| Google Cloud | Vision OCR | Page images sent for reading | Global | ISO 27001/17/18, SOC 2 | Cloud Data Processing Addendum | **Accept CDPA in the console** |
| GST Suvidha Provider / GST API provider (per `server/gst-api`) | GST portal access | GSTIN and returns | India | GSP licence from GSTN | Contract with confidentiality | Check |
| FYN / Fynamics | Relay for the portal (FYN ticket M5MO5) | As relayed | India | To ask | NDA and DPA | **Ask for security details** |
| Email sender for support mail (if set up) | Ticket emails | Names, emails, ticket text | — | — | DPA | When set up |
| Code-signing certificate authority | Signing the bridge | None | — | CA/B Forum | Purchase terms | **To buy** |
| VAPT firm | Security testing | Staging only, test accounts | India | CERT-In empanelled | NDA, scope letter | **To choose** |

## 9.2 Rules
- A new supplier that will see client data is added here **before** use, with its assurance and an agreement.
- Only what the supplier needs is sent:
  - bill images go to Claude or Google only when the free OCR fails, or when the firm chooses them;
  - nothing is sent for training.
- The privacy notice to firms names these suppliers and the countries.
- Each year, download the current SOC 2 / ISO certificates and read the bridging letters and changes to terms. Record it.

## 9.3 Cloud settings to keep (A.5.23)
- Supabase:
  - two-step sign-in on the org,
  - leaked-password protection on,
  - minimum password length 10,
  - email change and password change need re-authentication,
  - PITR on live,
  - network restrictions for the database (allow only needed IPs for direct Postgres),
  - the Security Advisor has no errors.
- Google API key restricted to the Vision API and to use from the server only.
- Anthropic: a separate key per environment, with spend limits set.

## Evidence
- Signed DPAs.
- Certificates each year.
- Settings screenshots.
