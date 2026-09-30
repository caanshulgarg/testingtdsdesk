# FinCom in React: the rewrite, screen by screen

Branch `react`. The site on `main` keeps running unchanged until every screen below is done; then `main` switches.

## How the React app is put together

```
app/                      the React app (Vite)
  index.html              the page frame (same ids as src/shell.html: #side, #cobar, #app, #modal, ...)
  src/store.js            render(): old screens redraw, then React; <div data-react="Name"> places a React screen
  src/App.jsx             React's part of the page
  src/Side.jsx            the sidebar
  src/screens/*.jsx       screens already in React, listed in src/screens/index.js
  legacy/                 built, not kept: the business logic from src/js (python3 build.py --react)
```

- **The business logic stays as it is** (Tally, GST, TDS, bank parsing, the firm account, `S`, `GSTAPI`, ...). It is
  built from `src/js` as before and loaded as `legacy.js`, before React. React screens use its globals directly.
- **A screen moves to React** like this:
  1. Write `app/src/screens/Name.jsx` from the old `viewName()`; buttons call functions (`onClick`), not `data-*`
     markers caught by a document-wide click handler.
  2. Any click logic that was inside the big click handler becomes a named function in `src/js` (as `goClient`,
     `navHome`, `toggleSetup`, `goGstSettings`), called by both React and whatever old screen still uses it.
  3. In `src/js`, the old `viewName()` returns `<div data-react="Name"></div>`, and its handlers are deleted.
  4. List it in `app/src/screens/index.js`; update its test to find things by what they say, not by `data-*`.
  5. `python3 build.py --react && cd app && npm run build:test`, then its test with `TDSDESK_SITE=../app/dist-test`.
- **State** is still the one object `S`, and every change still ends in `render()`. A React screen's own passing
  state (a half-typed OTP) can live in the component: its host element is kept through redraws.
- **The last step** (after every screen): `render()` and the string screens go, and the logic files become ES
  modules imported by the screens instead of globals.

## Build and run

```
python3 build.py --react     # business logic, CSS and assets for app/
cd app && npm install
npm run dev                  # local, live database settings
npm run build:test           # dist-test/: the testing site (staging database, TEST strip)
npm run build                # dist/: live
```

## Known gaps on this branch

- `python3 build.py` (the one-file site) is no longer the one to deploy from here: the screens already moved are
  only placeholders in it. Deploy `app/dist-test` / `app/dist` from this branch.
- "Download standalone app" (one HTML file for offline use) does not work with the React build yet; to be redone
  once the screens are done (or dropped).

## Screens

Status: **done** (in React, test passing) · **next** · blank = not started. About 150 screen functions in all.

| Area | Old functions (src/js file) | Status |
|---|---|---|
| **Frame** | sidebar `renderSide` (02) | **done** |
| | top bar `renderTop`, `clientHeader`, `topRight` (18) · client switcher `renderSwitcher` (27) | next |
| | page frame `render` (01): banners, `actionBar`, `drawerHtml`, `colPopHtml`, `tallyPanelHtml`, `firmMenuHtml` | next |
| | modal, toast, confirm dialogs | next |
| **Sign in** | `viewSignIn`, `viewSignUp`, two-step `viewTwoStep` (27, 43) | |
| **Home** | `viewClients`, `viewToday`, `viewInboxAll`, `viewTallyHome` (18) | |
| | Help and support: `viewHelp`, `viewSup*` (40) | |
| **Client: Collect / Post / Done** | `viewCollect`, `viewPostStep`, `viewDoneStep`, `bankReportHtml` (02) · `viewJobs`, busy cards (01) | |
| **Purchase bills** | `viewInvoices`, `viewDetail`, `docWarnHtml`, `viewParties`, `docqPanel` (19) · `viewReviewTable`, `reviewBar`, `drawerHtml` (18) · `itemsHtml`, `partyHistHtml` (01) | |
| **Bank** | `viewBank`, `viewSuggestions`, `viewRulesPanel` (22) · `bankRowHtml`, `viewBankGroups`, `bankBar`, `colPopHtml`, `colChipBar` (23) · `viewBankSetup` (02) · recon, balance, duplicates (24) · `fixBanner` (21) | |
| **Sales** | `viewSales`, `viewSalesCreate`, invoice and print, settings, `postReportHtml` (26) | |
| **Transactions** | `viewTransactions` (03) | |
| **Dashboard** | `viewClientDash` (18) | |
| **TDS** | `viewBooksTds`, `viewTdsYears`, `viewTdsYearPage`, `viewTdsReturn26`, `viewTdsReturn24`, `viewTdsCerts` (18) | |
| **GST** | `viewBooksGst`, `viewBooks2B`, `viewGstr1`, `viewGstr3b`, `viewGstChecks`, `viewGstAmend`, `viewGstAdv`, `viewGstRev`, `viewInputRegister`, `viewGst9`, `viewGst9c` (18) · filing (35) · settings and registrations (36) · QRMP, CMP-08, GSTR-4 (37) · returns filed (38) · ITC follow-up (32) · customer IMS (33) · vendor recon (42) | |
| | 2B from the portal `viewGstApiCard` (39) | **done** |
| **Books** | `viewBooks`, `viewBooksImport`, `viewBooksLedgers`, `viewLedPosting`, `viewTallyRead`, `viewSetupList` (18) · accounts (30) | |
| **Audit and MIS** | `viewBooksAudit`, `viewAuditRel`, `viewAudit3cd`, `viewBooksMis`, `misPackHtml` (18) | |
| **Reports, Look up, Letters** | `viewBooksReports` (45) · `viewBooksLookup` (44) · `viewBooksLetters` (46) | |
| **Tally** | `viewBridgeSettings`, `viewBridgeDiagnosis`, `viewReadTest` (24) · `viewPostLog`, `viewReading` (18) | |
| **Settings** | `viewRules`, `viewRates` (18) · `viewCompanySettings`, `viewExport`, `viewGst` (27) · `viewDocsSettings`, `viewDropKeys` (19) · `viewSelfTest` (01) | |
| **Firm account** | `viewAccount`, `viewCloudSettings`, `walletHtml`, `viewPeople`, `viewBackups`, `viewSuperadmin`, `creditBanner` (27) | |
| **Last step** | `render()` and string screens removed; `src/js` as ES modules | |
