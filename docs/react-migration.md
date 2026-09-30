# FinCom in React: the rewrite, screen by screen

New to the code? Read `app/README.md` first.

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
- **Actions**: the buttons of the old screens ran through one big click handler; its `switch (act)` is now
  `doAct(name)` in `src/js/27-firm-account.js`, which React buttons call (`onClick={() => doAct("firmMenu")}`).
  Navigation has its own functions: `goClient`, `navHome`, `goTab`, `goStep`, `toggleSetup`, `goGstSettings`.
- **Guarded**: each React part is wrapped in `Guard`; one that fails shows a short note (or nothing, for the frame)
  and the error goes to the console, instead of the whole page going blank.
- **Pieces not yet moved** inside a React screen are shown with `<Legacy html={viewX()} />` (parts/Legacy.jsx);
  their buttons keep working through the old handlers until they move too.
- **Events**: a control drawn by React answers its own events. The old document-wide click/input/change handlers
  skip anything inside a React screen (`reactOwned` in src/js/27), except old pieces shown there (`data-legacy`).
- **Column filters** (the funnel buttons, the chips and the pop-up) are still old pieces, shared by the tables; a React
  table draws the funnel button inside `data-legacy`, and `render()` places the pop-up again after React has drawn.
- **Boxes that count when finished** (a figure on an uploaded invoice, a setting) are `parts/CommitBox.jsx`: saved when
  the box is left, not on every key. Lists of Tally ledgers to choose from are `parts/LedgerSelect.jsx`.
- **Ledger boxes** (a Tally ledger typed, with the list that drops down) are `parts/LedgerBox.jsx`: the choice is
  made when the box is left or a ledger is picked (the browser's change event), not on every key.
- **Redraws and the mouse.** `render()` takes the React screens out of the page for a moment; a click whose button
  left the page is dropped by the browser. So while the mouse button is held (a box being left because a button was
  pressed), `render()` only redraws React, and the full redraw follows the click (store.js).
- **The cursor** in a box inside a React screen is given back after a redraw: the same box, or the one with the same
  `data-fk`. Old pieces (`<Legacy>`) are drawn again from their HTML every time, as the old screens were.
- **Checking a move against the live site.** With a client's books in `tests/data`, `tests/pages_tds.py` writes the
  text of every TDS page from a build; run it on the live build and the React build and compare (docs in the file).
- **Column filters on old tables** (`GridF`, the funnels on every `table.bk-table`) run after React has drawn, so old
  pieces inside React screens keep them; tables drawn by React are left alone (their pages have their own filters).
- **React screens inside old pieces** (the GST API card inside the 2B page) are put in place and drawn in the same
  redraw (store.js `drawReact`, `Legacy` calls `adopt`).
- **"How this tab works"** is `parts/HelpButton.jsx` wherever the bar it sits on is drawn by React.
- **Editing a bill** goes through `billSetX`, `billSetText`, `billSetChoice`, `billBookTds`, `billGst`,
  `billUseExpense`, `billFixLedger` (src/js/27), for React and the old handlers alike.
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
| | top bar `renderTop`, `clientHeader`, `topRight` (18), Tally panel, firm menu (02) · client switcher `renderSwitcher` (27) | **done** |
| | page frame `render` (01): banners, `colPopHtml` (column filters, shared with Bank, Sales, Transactions) | |
| | modal, toast, confirm dialogs | kept as they are (drawn outside the screens) |
| **Sign in** | `viewSignIn`, `viewSignUp`, two-step `viewTwoStep` (27, 43) | |
| **Home** | `viewClients`, `addCompanyForm`, `viewToday`, `viewInboxAll`, `viewInbox` (18) | **done** |
| | `viewTallyHome` (18) | with Tally |
| | Help and support: `viewHelp`, `viewSup*` (40) | |
| **Client: Collect** | `viewCollect` (02) · `viewJobs`, `readingCheck`, `uploadOptions`, busy cards (01) · `docqPanel`, `uploadBlock` (19) | **done** |
| **Client: Post / Done** | `viewPostStep`, `viewDoneStep` (02) · `viewExport` (27) · `viewPostLog` (18) | **done** |
| **Purchase bills** | `viewInvoices`, `viewDetail`, `field`, `docWarnHtml` (19) · `itemsHtml`, `partyHistHtml`, `ytdSourceHtml`, `rereadButtons` (01) · `viewGst` (27) | **done** |
| | review table `viewReviewTable`, `reviewBar`, `drawerHtml` (18), the bill's bar in `actionBar` (27) · `viewParties` (19) | **done** |
| **Bank** | the screen `viewBank` (22) · `bankTable`, `bankRowHtml`, `viewBankGroups`, `bankBar` (23) | **done** |
| | still old, shown inside it: `viewSuggestions`, `viewRulesPanel` (22) · `bankSettingsHtml`, `colPopHtml`, `colChipBar` (23) · recon, balance, duplicates, focus (24) · `fixBanner` (21) · `viewBankSetup` (02) | next |
| **Sales** | `viewSales`, `viewSalesCreate`, `salesRowHtml`, `salesDetailHtml`, `salesSettingsHtml`, `salesBar` (26); the printed invoice `invoiceHtml` stays a page of its own | **done** |
| **Transactions** | `viewTransactions` (03) | **done** |
| **Dashboard** | `viewClientDash` (18); the first-steps card `ONB.card` (48) still old | **done** |
| **Books** (shell) | `viewBooks` (18): the tabs, sync note, busy card | **done** |
| **TDS** | years and year `viewTdsYears`, `viewTdsYearPage`, `tdsCrumbs` (18) | **done** |
| | the returns `viewTdsReturn26`, `viewTdsReturn24`, `viewTdsCerts` (18): same text as the live site on all 92 TDS pages of the sample books (`tests/pages_tds.py`) | **done** |
| | notices (`AIH.viewNotices`, 50) | |
| **GST** | the tab `viewBooksGst` (18): parts, month, GSTIN, downloads; same text as the live site on 56 GST pages (`tests/pages_gst.py`) | **done** |
| | GSTR-1 and GSTR-3B with the checks before filing (`viewGstr1`, `viewGstr3b`, `viewGstChecks`) → `gst/Returns.jsx`; same text as live on 58 GST pages, a customer opened and a filter included; `run_react_gst.py` | **done** |
| | the input register (`viewInputRegister`) → `gst/InputRegister.jsx`; same text as live for the month, the year, a kind and a 2B status (61 GST pages) | **done** |
| | column funnels (`GridF`, 31) now work on React tables too: the funnel is added to the heading, not redrawn over it; they were off on React tables before (GSTR-1/3B, the TDS returns) | **done** |
| | 2B reconciliation (`viewBooks2B`) → `gst/TwoB.jsx`: every tab, a supplier opened, the year, a filter; checked on a 2B made from the books with faults planted (`tests/make2b.js`); 71 GST pages match live | **done** |
| | amendments, advances (11A/11B) and reversal (rules 42, 43) (`viewGstAmend`, `viewGstAdv`, `viewGstRev`) → `gst/Workings.jsx`; checked with a filed copy changed, a capital good, the busiest month for advances; 75 GST pages match live | **done** |
| | GSTR-9 and 9C (`viewGst9`, `viewGst9c`) → `gst/Annual.jsx`; the 9C PDF is printed from the React screen (`FinComReact.markup`); both PDFs' text and 79 GST pages match live. GSTR-9's tables (`GST9.html`) are still the print template, shown as an old piece | **done** |
| | ITC follow-up (`viewItcFollow`) → `gst/ItcFollow.jsx`; 84 GST pages match live. Row keys made unique in every GST list and in the TDS filters: a development build (React warns about repeated keys) now shows none on any GST or TDS page | **done** |
| | returns filed (38) → `gst/ReturnsFiled.jsx`; QRMP, CMP-08, GSTR-4 (37) → `gst/Periodic.jsx`; filing and GSTR-1A (35) → `gst/Filing.jsx`; 91 GST pages match live, including a quarterly and a composition GSTIN | **done** |
| | customers' IMS rejections (33) → `gst/CustIms.jsx`; 94 GST pages match live. Every GST part worked out from the books is now React | **done** |
| | GST settings and registrations (36) → `gst/GstSettings.jsx`, in Client setup; the page matches live (the blocked-credit sentence aside, added in the Client setup redesign); `run_gstregs_ui.py` passes in full. Fixed: the GST tab settles the month and GSTIN before working out the filing type, so a quarterly GSTIN is not shown as monthly on the first view | **done** |
| | still old: notices (50) | |
| **Books** | From Tally (`viewBooksImport`, `viewSetupList`, `viewBookParts`) → `books/FromTally.jsx`; the same text as main on its pages (`tests/pages_books.py`), with build 195’s step 5 (the check against Tally’s trial balance: Ready or Mismatch). Build 195’s day books for several clients (`MultiUp.view`, 23) is an old piece on Clients | **done** |
| | Tally ledgers (`viewBooksLedgers`, `viewLedPosting`, `ledChangedBanner`) → `books/Ledgers.jsx` (lmSet, lmConfirmToggle, lmViewGo, lmPost); every list the same as main; `run_react_booktabs.py` | **done** |
| | 2B from the portal `viewGstApiCard` (39) | **done** |
| | Audit (`viewBooksAudit`, `auditTabs`, `viewAuditRel`, `viewAudit3cd`) → `books/Audit.jsx` (auditRangeSet, auditFreqSet, auditFindingSet, relAdd, relSet, relRemove); the default export is `Audit_`, imported as `AuditTab`, so the global `Audit` is not shadowed; the 3CD draft stays an old piece; 17 book pages match main; `run_react_booktabs.py` runs it, opens a finding, adds a related party | **done** |
| | MIS (`viewBooksMis`, `misP2Html`) → `books/Mis.jsx` (misRangeSet, misQuickGo, misTabGo, misFreqSet, misMsmeSet, misBudSet); all twelve tabs, rows opened, filters, a budget, two registrations and cost centres: 45 book pages match main; `run_react_booktabs.py` runs it and works each tab. The printed pack is still `misPackHtml` | **done** |
| | Accounts (`viewBooksAccounts`, 30) → `books/Accounts.jsx` (fsKindSet, fsFyGo, fsStockSet, fsSet, fsMapSet, fsUnmap); the statements are `FS.html`, the same pages as the PDF, shown as an old piece; 53 book pages match main; `run_react_booktabs.py` runs it both ways and places a ledger by hand. Every Books tab is now React | **done** |
| **Reports, Look up, Letters** | `viewBooksReports` (45) · `viewBooksLookup` (44) · `viewBooksLetters` (46) | |
| **Tally** | `viewBridgeSettings`, `viewBridgeDiagnosis`, `viewReadTest` (24) · `viewPostLog`, `viewReading` (18) | |
| **Settings** | Settings for the firm and Client setup: one layout, sections listed on the left (`screens/Settings.jsx`); in React: firm details, company, Tally, TDS, reverse charge and blocked credit, remove client | **done** |
| | still old, shown inside it: sign-in and people, plan, Tally Bridge, books in the cloud, rates, reading, AI help (27, 18, 24) · bank accounts and rules · closed periods (47) | |
| **Firm account** | `viewAccount`, `viewCloudSettings`, `walletHtml`, `viewPeople`, `viewBackups`, `viewSuperadmin`, `creditBanner` (27) | |
| **Last step** | `render()` and string screens removed; `src/js` as ES modules | |


## Vendor reconciliation

`viewVendorRecon` (42) → `screens/VendorRecon.jsx` (vrOpen, vrClose, vrSet, vrFile, vrExcel). Same text as live for an empty form, agreeing and differing results and the busy card (`tests/pages_misc.py`). Its “Reconcile a vendor ledger” button on the React bills page called an action nothing handled; it now opens the page.

## Dates in India

`addDays` (24) read a local midnight back in UTC, a day early east of London: the bank reconciliation's “opening balance as on the day before” was two days before, and fetches “from the day after” fetched the same day again. The marketplace sales import read Excel dates a day early for the same reason. Both fixed; `TZ=Asia/Kolkata node tests/run_dates.js` checks addDays. The live site (main) still has these; they move with the switch unless taken there first.


## Keeping up with main

`main` goes on changing while the rewrite runs (builds 188–194 on 30 Sep 2026). Merge it into `react` before each part is compared, and carry changes to old views that are already React into their screens by hand: after the 30 Sep merge, the From Tally tab lost “Straight from Tally” and gained the daily update time (`keepAtSet`), every Books tab has the “Books up to … · Update now” line (`FreshLine` in Books.jsx), and the clients list has the Tally light (`TallyLight` in Clients.jsx). React drawing runs inside `memoScope` (src/js/01) so figures from the whole books are worked out once per drawing, as main's old screens do. Compare against a fresh build of `main` (`python3 build.py` in a worktree of origin/main), not an old one. The react/ folder on main (the preview) is kept out of this branch (.gitignore).
