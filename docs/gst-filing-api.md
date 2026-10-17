# Filing GSTR-1, IFF and GSTR-3B through TaxPro's GSP API: the calls, their order, and what is still unknown

Written 17-Oct-2026 (branch `next-gst-file`) for the owner's decisions of 17-Oct-2026: **"Both, API first"** and
**"Prepare, you file"**. FinCom saves the return on the portal through the GSP; the final File with the authorised
signatory's EVC OTP is always a person's click in FinCom; a captcha or OTP is never automated or bypassed. Owner update of
the same day: the API route is **optional per client** (the taxpayer has to give an OTP about every 30 days); a client is
filed through it only when "File through: GST API" is chosen for it and its GSTIN has a live API session. Every other
client uses the browser helper (phase 2, branch `next-gst-browser`, another helper's work).

Read with `docs/gst-filing-taxpro-plan.md` (the plan of 02-Oct-2026) and `server/gst-taxpro/index.ts`.

## How this was researched, and how far to trust it

- From this session, TaxPro's own help site (gsthelp.charteredinfo.com), GSTN's developer portal
  (developer.gst.gov.in) and the other GSPs' developer sites could **not be opened** (the session's network refused
  them); only web-search extracts of those pages were readable. So the call names and payload fields below are taken from
  those extracts and from the GSP forums, and cross-checked against what FinCom's own TaxPro calls already do on the
  sandbox (`/taxpayerapi/dec/v1.0/authenticate`, `/taxpayerapi/dec/v4.0/returns/gstr1` RETSUM, `v4.0/returns/gstr3b`
  RETSUM, `v1.0/returns` RETTRACK, `v4.2/returns/gstr2b`, all answering on the sandbox since 02-Oct-2026).
- **Nothing here has been tried against TaxPro's sandbox yet** (write calls need TaxPro to enable them on our ASP id;
  see the questions). Every path is a setting in the function (`TAXPRO_*_PATH`), so a different version from TaxPro is
  a setting change, not a code change.
- Marked **[confirmed]** = seen working in FinCom's own calls; **[documented]** = in a source below; **[assumed]** = the
  GSTN pattern, to be confirmed with TaxPro (listed again under Questions).

## The two kinds of session

1. **ASP credentials** (TaxPro's ASP id and password, in Vault `gsp:taxpro:aspid` / `gsp:taxpro:password`): on every call,
   as headers `aspid`, `password` with `txn`, `appver`. [confirmed]
2. **The taxpayer's GSTN session**: the per-client OTP login FinCom already has (`OTPREQUEST` → `AUTHTOKEN` with the
   taxpayer's OTP, renewed by `REFRESHTOKEN` for the API access period of 1 to 30 days). Every return call below sends it
   as `auth-token` with `gstin`, `username`, `state-cd`, `ip-usr`, `ret_period`. [confirmed for reads]
   **All the filing calls below need this session** (save, status, summary, proceed, offset, ledger balance, EVC OTP,
   file, track). FinCom's `liveSession()` gives it (renewed when under 15 minutes are left).
3. **The EVC OTP** is a third, separate OTP: it goes to the **authorised signatory's** registered mobile and e-mail
   (not the taxpayer login's), is asked for with the signatory's PAN, and is valid for a short time (about 10 minutes
   per a GSP's note). FinCom never reads, stores or re-uses it; the person types it and it is sent once with RETFILE.

TaxPro's "Decrypted API": the same GSTN calls with `/dec` in the path; TaxPro does GSTN's encryption, HMAC and the
base64 of `data` itself, so FinCom sends and receives plain JSON. [documented: TaxPro forum, "for Decrypted API add /Dec
to base url"; confirmed for reads]

Hosts: production `https://gstapi.charteredinfo.com`, sandbox `https://gstsandbox.charteredinfo.com`. [documented,
TaxPro help "Track Return"; confirmed]

## GSTR-1 (monthly) and IFF (QRMP months 1 and 2): the order

IFF is GSTR-1's API for the first two months of a QRMP quarter (same path, `ret_period` of that month, form type R1).
The quarter's GSTR-1 is the same calls with the quarter's last month.

| # | Step | Call | Body / query | Notes |
|---|---|---|---|---|
| 1 | Save | `PUT /taxpayerapi/dec/{v}/returns/gstr1`, `action=RETSAVE` | the GSTR-1 JSON as for the offline tool: `gstin`, `fp` (MMYYYY), the tables (`b2b`, `b2cl`, `b2cs`, `cdnr`, `cdnur`, `exp`, `at`, `txpd`, `nil`, `hsn`, `doc_issue`, amendments) | answers `{reference_id}` [documented: Vayana's GSTR-1 save page, PUT; GSTN pattern]. Save is asynchronous. |
| 2 | Save status | `GET …/returns`, `action=RETSTATUS`, `ref_id` | | `status_cd`: `P` processed, `PE` processed with errors (an `error_report` per table), `ER` error, `IP` in progress [documented, GSP forums "GSTR-1 RETSTATUS"] |
| 3 | Summary | `GET …/returns/gstr1`, `action=RETSUM` | `ret_period` | `sec_sum` per table: `sec_nm`, `ttl_rec`, `ttl_tax` (taxable value), `ttl_igst`, `ttl_cgst`, `ttl_sgst`, `ttl_cess` [confirmed: FinCom's fetch reads it] |
| 4 | **FinCom: a person compares** | — | | the portal's summary beside FinCom's, differences highlighted; the person confirms they match, or accepts the listed differences (kept with name and time). No step below runs without it. |
| 5 | Proceed to file | `POST …/returns/gstr1`, `action=RETNEWPTF` | `gstin`, `ret_period` (and `isnil` for a nil return) [assumed] | GSTR-1 v3.0 replaced Submit by Proceed to File; it generates the summary to file and can be repeated if more is saved [documented: TaxPro forum note on GSTR-1 v3.0]. Headers `rtn_typ`, `userrole`, `api_version` are mandatory for proceed to file [documented: GSTN developer portal, as quoted]. |
| 6 | EVC OTP | `GET /taxpayerapi/dec/v1.0/authenticate`, `action=EVCOTP` | `gstin`, `pan` (the authorised signatory's), `form_type=R1` | OTP to the signatory's mobile and e-mail. Errors seen: OTP0010 (PAN not a signatory of this GSTIN), OTP0018 (not allowed to file by EVC: companies and LLPs must use DSC) [documented: GSP forum threads] |
| 7 | **File (a person's click)** | `POST …/returns/gstr1`, `action=RETFILE` | `data` = the summary of step 3 (fetched again just before), `st=EVC`, `sid=PAN|OTP` | answers the ARN (`ack_num`) [documented: GSTN's request wrapper, `sid` = "PAN|OTP" for EVC]. How TaxPro's decrypted API wants `st`/`sid` (body or query) is a question. |
| 8 | Status / ARN | `GET /taxpayerapi/dec/v1.0/returns`, `action=RETTRACK`, `fy` (or `ret_period`, `type`) | | the filed list with `rtntype`, `ret_prd`, `arn`, `dof`, `status` [confirmed: FinCom's TRACK fetch] |

## GSTR-3B: the order

| # | Step | Call | Body / query | Notes |
|---|---|---|---|---|
| 1 | Save | `PUT /taxpayerapi/dec/{v}/returns/gstr3b`, `action=RETSAVE` | FinCom's 3B JSON (`GSTR.threeBJson`: `gstin`, `ret_period`, `sup_details`, `inter_sup`, `itc_elg`, `inward_sup`) | answers a `reference_id` [documented: GSP forum "save call succeeded and returned a reference ID"] |
| 2 | Save status | `RETSTATUS` with `ref_id` | | as GSTR-1 |
| 3 | Summary | `GET …/returns/gstr3b`, `action=RETSUM` | | the 3B as saved, and `tx_pmt` (the liability ledger lines: `liab_ldg_id`, `trans_typ`, tax / interest / fee per head) [confirmed for the 3B part; `tx_pmt` from the forums] |
| 4 | Ledger balances | `GET /taxpayerapi/dec/{v}/ledgers`, `action=BAL` | `gstin`, `ret_period` | cash ledger (per head: tax, interest, fee) and credit ledger (`igst_bal`, `cgst_bal`, `sgst_bal`, `cess_bal`) [assumed: path and field names] |
| 5 | **FinCom: a person compares** | — | | as GSTR-1, plus the set-off FinCom works out from the portal's liability and the ledgers (sections 49, 49A, rule 88A) and the cash still needed |
| 6 | Offset liability (proceed) | `PUT …/returns/gstr3b`, `action=RETOFFSET` | `pdcash`: one per liability line, `ipd`, `cpd`, `spd`, `cspd` and interest / late fee paid; `pditc`: `i_pdi`, `i_pdc`, `i_pds`, `c_pdi`, `c_pdc`, `s_pdi`, `s_pds`, `cs_pdcs` | [documented: GSP forum and a GSP's offset page]. Errors: RT-3BAS1070 partial/excess payment (the offset must equal the liability exactly), RT-3BAS1059 offset null (save first), insufficient cash balance. Once offset, the 3B cannot be changed. |
| 7 | EVC OTP | as GSTR-1, `form_type=R3B` | | |
| 8 | **File (a person's click)** | `POST …/returns/gstr3b`, `action=RETFILE` | the 3B summary, `st=EVC`, `sid=PAN|OTP` | ARN |
| 9 | Status / ARN | `RETTRACK` | | |

A GSP forum flow of 3B (older API): save → summary (gives the liability ids) → offset → file. Submit was dropped later.

## What FinCom builds on this (server/gst-taxpro, actions)

`save` → `summary` → `confirm` (the person) → `proceed` (PTF, or 3B offset) → `evc_otp` → `file` (the person) →
`track`; and `filing` (where a return stands). Owner and staff may do these (as posting); a viewer may not. Every call
is logged in `gst_filing_log` (who, when, GSTIN, period, form, action, result, ARN; never the OTP). The summary is read
again before proceeding and before filing; if it changed since it was confirmed, nothing is sent and the person compares
again. Differences under ₹1.00 are rounding (no reason needed). A DSC client stops after proceed to file and is
filed on the portal; the ARN is read back with `track`. Writes go to the sandbox: on the production host they are refused unless `TAXPRO_FILE_LIVE=yes` is set.

## DSC (companies and LLPs): what others do, and FinCom's way

The owner's answers of 17-Oct-2026: do not hide File for DSC clients; research how others file with DSC through an API;
until FinCom can sign, a DSC client's return goes Save → Compare → Proceed to file through the API, and is then filed
**with DSC on the portal** by the person; FinCom reads the ARN back (RETTRACK) and marks the month filed. EVC stays as built
for proprietors, firms and others. (Also answered: owner and staff file; ₹1 rounding tolerance; the person who confirms
may also file.)

Who must use DSC: companies and LLPs must sign GSTR-1 and 3B with a Class 2/3 PAN-based DSC registered on the portal;
others may use EVC [documented: GST portal guides, eMudhra, Quicko].

### How DSC signing works through the GSTN API
- The return's summary (RETSUM) is signed: a hash of the summary is signed with the DSC as a **CMS / PKCS#7 signature**,
  and RETFILE is sent with `st=DSC`, `sid=<PAN>` and the signature. GSTN's error list has RT_FIL_09 "Signed summary is not
  the latest one", RTN_FIL_30 "Signed summary data does not match with encoded hash summary" and RET13506 "Invalid DSC
  Signature" [documented: GST API error code list (MasterGST); GSTN GSP framework v3.0: "fetch GSTR1 summary … digital sign
  using DSC or e-Sign or EVC"].
- The signing must happen on the computer with the DSC token (a USB token with a PIN); it cannot happen on a server.

### What other software does
| Software | DSC filing | Source |
|---|---|---|
| **TaxPro (our GSP)** | Its own free browser extension **Signer.Digital** (Chrome / Firefox) signs from the token, the PFX or the Windows certificate store: `SignerDigital.signGstHash(hash, certThumbprint)` returns the CMS (PKCS#7) signature, which the software sends to the filing API. | taxpro.co.in "Digital Signing GST and ITR eReturns using Signer.Digital Browser Extension"; help.signer.digital; Chrome Web Store listing |
| **TallyPrime** | Files GSTR-1 and 3B itself: E for EVC (PAN + OTP) or D for DSC (choose the signatory, type the token's PIN), on the computer running Tally. | help.tallysolutions.com, "File GSTR-1" |
| **ClearTax** | GSTR-1 and 3B with DSC through its **desktop app** (on the PC with the token): "File with EVC" or "File with DSC". | docs.cleartax.in, "GSTR-3B on Desktop App" |
| **Zoho Books** | Files with EVC (PAN + OTP) only; for DSC the user files on the GST portal and then uses **Mark as Filed** in Zoho Books. | zoho.com/in/books/help/gst/gstr1-filing.html |
| **GST portal** | DSC through its own signer, **emSigner**, installed on the PC; the DSC registered on the portal first. | Quicko "GST emSigner", "Register or update DSC" |
| Masters India, IRIS | Their API pages advertise "EVC or DSC" filing; no public description of how the signature is made was found. | mastersindia.co blog (DSC errors); vendor pages |

### Recommendation for FinCom
1. **Now (built):** DSC clients file on the portal. FinCom does Save → Compare → Proceed to file through the API, then a
   "File with DSC on the portal" button opens the portal's Returns Dashboard; the person signs in, files with DSC there,
   and FinCom reads the ARN back (RETTRACK; by itself when the card is opened, or "I have filed it: read the ARN"). This is
   what Zoho Books does, and needs nothing installed.
2. **Next, recommended:** sign in FinCom with **TaxPro's Signer.Digital extension**, on whichever computer holds the
   token. It is our GSP's own, free, and made for exactly this call (sign the GST summary hash, return PKCS#7); FinCom
   would fetch the summary, ask the extension to sign it (the person picks the certificate and types the PIN), and send
   RETFILE with `st=DSC`. This avoids building a signer, and works away from the Tally computer (FinCom Bridge runs on the
   Tally computer, which is often not the one with the partner's token; a Bridge signer would also need its own Windows
   certificate-store code and testing).
   Needs from TaxPro first: the exact hash to sign (the base64 summary or its SHA-256), and the decrypted RETFILE body for
   DSC (`sign`, `st`, `sid`), on the sandbox with a test DSC.
3. Not recommended: the portal's emSigner (it only talks to the portal's own pages), or keeping the DSC on a server
   (the law and the token both need the signatory's own PIN on their own computer).

Sources (DSC):
- https://taxpro.co.in/digital-signing-gst-and-itr-ereturns-using-signer-digital-browser-extension
- https://help.signer.digital/digital_signing_gst_and_itr_ereturns_using_signer_digital_chrome_extension.htm
- https://gsthelp.charteredinfo.com/ucl/digital_signing_gst_and_itr_ereturns_using_signer_digital_chrome_extension.htm
- https://chromewebstore.google.com/detail/signerdigital-digital-sig/glghokcicpikglmflbbelbgeafpijkkf
- https://help.tallysolutions.com/tally-prime/file-gst-returns/india-gst-filing-gstr1-tally/
- https://docs.cleartax.in/product-help-and-support/for-tax-experts/clearpro-suite/clearpro-desktop-app/file-returns-on-desktop/gstr-3b-on-desktop-app
- https://www.zoho.com/in/books/help/gst/gstr1-filing.html
- https://learn.quicko.com/gst-emsigner , https://learn.quicko.com/register-update-dsc-gst-portal
- https://mastergst.com/static/pdfs/gst-api-error-codes.pdf
- https://gstn.org.in/assets/mainDashboard/Pdf/GSP_Implementation_Framework_V_3.0.pdf
- https://emudhradigital.com/kc/how-to-file-gst-with-adigital-signature

## Questions (for TaxPro, and for the owner)

For TaxPro:
1. Are RETSAVE, RETSTATUS, RETNEWPTF, RETOFFSET, RETFILE, EVCOTP and the ledger balance enabled on our ASP id, on the
   sandbox first? Which **versions** (v3.x / v4.0 for GSTR-1, v3.0/v4.0 for 3B, ledgers v?) and exact paths?
2. Decrypted API, RETSAVE: is the body the GSTR-1 JSON itself, or `{action, data}`? Must `version` / `hash` (offline
   tool fields) be left out?
3. Decrypted RETFILE: are `st=EVC` and `sid=PAN|OTP` sent in the body (with `data` = the summary) or as query
   parameters? FinCom sends them in the body so the OTP never sits in a URL or a log.
4. EVCOTP: is it `authenticate?action=EVCOTP&pan=&form_type=R1|R3B` on v1.0? Is the form type for IFF also R1?
5. RETNEWPTF body: `{gstin, ret_period}` only, or with `isnil`? Are the `rtn_typ` / `userrole` / `api_version` headers
   needed through the decrypted API?
6. GSTR-1 RETSUM: are credit notes (CDNR / CDNUR) in `ttl_tax` / `ttl_igst` net of debit notes (credit as negative), or
   the gross of both? FinCom compares net (debit + credit −); if the portal gives gross, every month with notes shows a
   difference until this is set right.
7. Ledger balance: path and field names for the cash ledger (per head tax / interest / fee) and the credit ledger.
8. RETOFFSET: confirm the field names of `pdcash` (interest `i_intrpd`… and late fee `c_lfeepd`, `s_lfeepd`) and `pditc`,
   and that `liab_ldg_id` / `trans_typ` come from 3B RETSUM `tx_pmt`.
9. Sandbox taxpayers that can file (one QRMP, one monthly), and the sandbox EVC OTP (575757 as for login?).
10. Daily limits per ASP, IP allow-listing for Supabase's function IPs, and the error codes for "already filed".

For the owner (answered 17-Oct-2026):
11. Owner and staff may file: kept.
12. Rounding: a figure off by less than ₹1.00 is shown in grey as "rounding (under ₹1)" and needs no reason; ₹1.00 or
    more must be corrected or accepted with a reason. A count of documents never rounds.
13. DSC: File is not hidden; see "DSC" above (filed on the portal for now, ARN read back).
14. The person who confirms may also file: kept.

## Sources

- TaxPro help, Track Return (hosts and RETTRACK): https://gsthelp.charteredinfo.com/ucl/track_return.htm
- TaxPro help, URL based APIs / GSTR API methods: https://gsthelp.charteredinfo.com/ucl/url_based_apis.htm,
  https://gsthelp.charteredinfo.com/ucl/gstr_api_methods.htm, https://gsthelp.charteredinfo.com/ucl/taxpro_gsp_api.htm
- TaxPro forum, GSTR-1 v3.0 (Submit replaced by Proceed to File): https://groups.google.com/g/taxpro-gsp/c/FRf8iov9ENk
- TaxPro forum, 3B RETOFFSET error (save → offset → submit; RT-3BAS1059): https://groups.google.com/g/taxpro-gsp/c/3U-V0xQ1McE
- TaxPro forum, Decrypted API (`/Dec` in the base URL): https://groups.google.com/g/taxpro-gsp/c/9XmDUgaD9Qg
- GSP discussion group: EVC OTP errors OTP0010 / OTP0018 (`evcotp`, `form_type=R1`, GSTIN, PAN):
  https://groups.google.com/g/gst-suvidha-provider-gsp-discussion-group/c/DfK_3qWMldc ,
  https://groups.google.com/g/gst-suvidha-provider-gsp-discussion-group/c/5fbbfeu31Zo/m/J5IElNSICwAJ
- GSP discussion group: 3B offset (pdcash and pditc; RT-3BAS1070):
  https://groups.google.com/g/gst-suvidha-provider-gsp-discussion-group/c/BEMHqJ4RTdg ,
  https://groups.google.com/g/gst-suvidha-provider-gsp-discussion-group/c/SNjjaKoqdPU
- GSP discussion group: GSTR-1 RETSTATUS: https://groups.google.com/g/gst-suvidha-provider-gsp-discussion-group/c/NbembYnasGw
- GSTN developer portal, returns (headers for proceed to file; `sid` = PAN|OTP for EVC):
  https://developer.gst.gov.in/apiportal/taxpayer/returns
- Vayana GSP, GSTR-1 save (PUT, `reference_id`): https://docs.gsp.vayana.com/GSTN/gstr1-B2B-save-api/
- Sandbox.co.in (another GSP), GSTR-3B file, EVC OTP, offset liability, new proceed to file:
  https://developer.sandbox.co.in/api-reference/gst/compliance/endpoints/taxpayer/gstr-3b/file ,
  https://developer.sandbox.co.in/reference/generate-evc-otp-api ,
  https://developer.sandbox.co.in/api-reference/gst/compliance/endpoints/taxpayer/gstr-3b/offset_liability ,
  https://developer.sandbox.co.in/api-reference/gst/compliance/endpoints/taxpayer/gstr-1/file/new_proceed
- GST portal user guide, 3B (offset then file; no change after offset):
  https://tutorial.gst.gov.in/userguide/returns/Create_and_Submit_GSTR3B.htm
