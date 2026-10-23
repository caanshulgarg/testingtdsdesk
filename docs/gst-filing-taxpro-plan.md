# Filing IFF, GSTR-1 and GSTR-3B through TaxPro (EVC / OTP): plan only

Request of 02-Oct-2026, item 14. Nothing here is built. This is what filing from FinCom would take, and what TaxPro has to
give us first.

## What we have today

- TaxPro GSP read access on staging: the ASP login works, the taxpayer OTP session (1 to 30 days) works, and the GSTR-1 and
  GSTR-3B read APIs answer on v4.0 (self-test of 02-Oct-2026). The ASP ID and password are kept in Vault.
- FinCom already builds the portal's GSTR-1 JSON (`GSTR.json`) and GSTR-3B JSON (`GSTR.threeBJson`) for the offline
  upload. Filing through the API would send these same payloads, so filing adds no new working of the figures.

## What TaxPro needs to give us

1. **Filing (write) APIs on our ASP account.** Read-only GSP plans do not include them. We need the save, proceed-to-file,
   offset and file calls enabled, first on the sandbox and then in production.
2. **The exact paths and versions** they support for each step, because GSTN has moved these between versions:
   - GSTR-1 / IFF: save (RETSAVE), save status (RETSTATUS), summary (RETSUM), proceed to file (RETNEWPTF), file (RETFILE).
   - GSTR-3B: save (RETSAVE), offset liability (RETOFFSET), file (RETFILE).
   - The EVC OTP request, and the shape of the `sign` / `st: "EVC"` / `sid` (signatory PAN) body that RETFILE takes.
3. **Confirmation of the EVC flow through a GSP.** The OTP goes to the authorised signatory's registered mobile and e-mail.
   We need to know whether TaxPro's API relays it, or whether the signatory reads it on their phone and types it into
   FinCom.
4. **Sandbox taxpayers that can file:** test GSTINs with a QRMP and a monthly profile, so IFF, quarterly GSTR-1 and 3B can
   all be tried end to end.
5. **Limits:** how many returns a day per ASP, any IP allow-listing for our edge function, and their error codes for
   "already filed", "summary not generated" and "offset mismatch".

## What the taxpayer needs

- An authorised signatory with PAN, mobile and e-mail registered on the portal (for EVC).
- **Companies and LLPs must sign with DSC, not EVC.** EVC covers proprietors, partnership firms and others. Testing AAD
  (09AANFG3202D1ZR, a firm) can use EVC. DSC signing through a GSP needs a signer utility on the user's computer, which is
  a separate project.
- The same API access period (OTP session) that fetching already uses.

## How it would work in FinCom

1. **Preview:** the return as FinCom will send it, table by table. Every difference against 2B and the books
   (Filed vs books) must be cleared, or accepted with a reason.
2. **Save to the portal:** RETSAVE, then poll RETSTATUS until processed. Rows the portal rejects are shown.
3. **Check:** fetch the portal's summary (RETSUM) and compare it with the preview. Any difference stops the filing.
4. **3B only, offset:** the set-off FinCom works out (rule 88A order), and the cash balance needed in the electronic cash
   ledger.
5. **File:** request the EVC OTP, the signatory types it in, then RETFILE. The ARN and date are kept, the return is marked
   filed (as RETTRACK now does) and the payload and replies are kept.
6. **Who may file:** only an owner, never staff, and never automatically on a timer. Each filing is in the activity log
   with who, when and the ARN.

## Size

About 2 to 3 weeks once TaxPro gives sandbox write access and the paths: the edge function steps, the preview and confirm
screens, and tests against a stand-in TaxPro, as for fetching. Production filing comes only after a few real returns on
the sandbox.
