# FinCom GST helper (browser helper for GST returns)

Branch `next-gst-browser`, 17-Oct-2026. Staging only (staging.fincom.live/review/).

## What it does

The FinCom GST helper is a small Chrome / Edge extension. It works in **your own browser, in your own logged-in GST portal
tab**, and does the typing for you from FinCom's figures:

| Return | What the helper does | Where it stops |
|---|---|---|
| **GSTR-1** (monthly, and the quarter's GSTR-1 for QRMP) | Chooses the period on the returns dashboard. Then either **uploads FinCom's own GSTR-1 JSON** through the portal's offline upload (default: every table at once, the portal checks it) or **types each table** into the portal's forms: 4A/4B/6B/6C B2B, 5 B2CL, 6A exports, 7 B2CS, 8 nil/exempt/non-GST, 9B CDNR and CDNUR, 9A/9C/10/11 amendments, 11A/11B advances, 12 HSN (B2B and B2C), 13 documents. Presses GENERATE SUMMARY, reads the summary back and compares every table with FinCom (records, value, taxable value, IGST, CGST, SGST, cess). Then opens the portal's **File page**. | On the File page. **You** tick the declaration, choose the signatory and press **FILE WITH DSC** (companies and LLPs) or FILE WITH EVC. |
| **IFF** (QRMP, months 1 and 2) | The same, with the IFF tables (B2B, CDNR and their amendments). | On the File page. |
| **GSTR-3B** | Types 3.1 (a)–(e), 3.2 (a row per place of supply), 4 A(1)–(5), B(1)–(2), D(1)–(2) and 5, reads every box back to the paisa. Reads what the portal works out itself: 4(C) net ITC (compared with FinCom), 3.1.1 (FinCom does not work these out; shown if not nil) and 5.1 interest and late fee (sent to FinCom as the portal's figures). Saves the 3B (a draft), presses PROCEED TO PAYMENT and compares the portal's tax payable, credit used and cash with FinCom's set-off. | Before **Make payment / Post credit to ledger**. **You** press it, then FILE GSTR-3B WITH DSC (companies and LLPs) or EVC. |
| **2B** | Opens GSTR-2B for the month, fetches the portal's JSON in your tab and hands it to FinCom's 2B import. | — |
| **Ledgers** | Reads the cash and credit ledger balances and sends them to FinCom. | — |
| **Return status** | Reads the return's ARN from Track Return Status and sends it to FinCom. | — |

After you file, the portal shows the ARN; the helper reads it and FinCom marks the return **Filed** with that ARN (and,
for 3B, keeps the filed copy as "Mark this 3B as filed" does).

**Differences:** under ₹1.00 is shown grey as rounding (no reason needed); ₹1.00 or more is highlighted. A count that
differs, or a box the portal does not show, is always a difference. When "Run all steps" finds a difference of ₹1.00 or
more in GSTR-1, it does not go on to the File page by itself; press **Run** on that step after you have looked.

Every run is logged: who, when, GSTIN, period, each step and its result, the differences, the ARN — on the firm's
server (`gst_helper_runs`) and with the client's books.

## Using it

1. In FinCom open the client → GST → GSTR-1 (or GSTR-3B) → the month → **Files** tab. The card **Browser helper** says
   whether the helper is installed.
2. Press **Open the portal for this return**. The portal opens in a new tab; click the helper's icon (top right of
   Chrome) to open its side panel if it did not open by itself. The panel shows FinCom's figures for that client and
   month.
3. Log in to the portal. With a login saved in GST settings, press **Log in to GST portal** in FinCom: the helper types
   the user id and password; **you type the captcha** (and the OTP if the portal asks). Otherwise log in yourself.
4. In the panel press **Run all steps** (or **Run** on one step). Each step shows done / stopped and why.
5. Check the comparison. Then do the last step yourself (sign / pay and file).

## Install (the owner, once per computer)

1. Get the folder `extension/gst-helper` (from the repository, or unzip `fincom-gst-helper-0.1.0.zip` into a folder you
   keep, e.g. `Documents\FinCom GST helper`). Do not delete the folder afterwards: Chrome runs the helper from it.
2. In Chrome go to `chrome://extensions` (Edge: `edge://extensions`).
3. Switch on **Developer mode** (top right).
4. Press **Load unpacked** and choose the folder (the one with `manifest.json` in it).
5. "FinCom GST helper" appears. Click the puzzle icon and pin it.
6. Open staging.fincom.live/review/ (signed in) → GST → Files: the card says "installed".

To update: replace the folder's files with the new ones and press the reload arrow on the helper in
`chrome://extensions`. The helper's id is fixed (`okajonmmjoidmaapknhpphpojodaocmg`), so FinCom finds it after an update.

## Permissions, and why

| Permission | Why |
|---|---|
| Read and change data on `*.gst.gov.in` | To type into the portal's fields, read its figures back, and read the ARN. On no other site. |
| Talk to `https://staging.fincom.live` (externally_connectable) | FinCom's tab sends the return's figures and receives the results. No other site can talk to it. |
| Side panel | To show the figures, the steps and the comparison beside the portal. |
| Storage (this session only) | Keeps the return being worked on while the browser is open (`chrome.storage.session`, in memory). Nothing on disk. |

It has no permission to read other sites, your history, downloads or other tabs. It talks to no server: all figures come
from your FinCom tab and go back to it.

## What it never does

- Type, read or solve the **captcha** or any **OTP**.
- Press **FILE WITH DSC**, **FILE WITH EVC**, **Submit**, **Make payment / Post credit to ledger**, or anything that
  signs, pays or files. (The rules refuse these buttons by their words even if the page were changed.)
- Keep your **portal password**: FinCom gives it to the helper only when you press "Log in to GST portal"; it is typed
  into the login box and dropped. It is not stored in the extension, in FinCom's books, in this browser or in any log.
- **Guess a field**: before each step it checks that every field it needs is on the page; if one is not, it stops and
  says which step and which field, and types nothing more.
- Add records to a GSTR-1 table that already has records on the portal (they would be entered twice).
- Use AI: everything is plain rules.

## GST portal login (GST settings)

Per GSTIN: user id and password. Only the firm's **owner** saves, changes or deletes it and picks which **staff** may use
it. The password goes straight to the firm's server and is kept in **Supabase Vault** (migration 93); after saving FinCom
only says "password saved · change". It is read back only on an explicit "Log in to GST portal" click by the owner or an
allowed staff member; every read and every refused read is logged (who, when, GSTIN — never the password). Deleting
removes the password from Vault.

## When the portal changes

Everything the helper knows about the portal's pages is in **one file**: `extension/gst-helper/selectors.js`
(`version` at the top). When the portal changes a page:

1. The helper stops at that step with a message like: *Step "Type 4. Eligible ITC": the field "4(A)(5) All other ITC ·
   Central tax" was not found on this portal page.* Nothing more is typed.
2. Send that message (and a screenshot of the portal page) to support.
3. The fix is made in `selectors.js` only, the `version` raised, the look-alike portal in
   `tests/fixtures/gst-portal-fake` changed the same way, and `tests/run_gst_browser_helper.py` run.
4. Replace the helper's folder and press reload in `chrome://extensions`.

**Not yet checked on the live portal (version 2026.10.17-1).** The selectors were written from the portal's public user
manuals and screenshots and tested on the look-alike only. The first run on the real portal will probably stop at one or
more fields — by design — and each stop names the field to correct.

## For developers

- `extension/gst-helper/`: `manifest.json` (MV3; content scripts only on `https://*.gst.gov.in/*`), `sw.js` (the port
  to FinCom, session storage, opens tabs), `content.js` (one command per step, in the portal tab), `panel.*` (the side
  panel: runs the steps, compares), `lib/rules.js` (totals per table, 3B boxes, compare with the ₹1.00 rounding rule,
  ARN, the buttons never pressed), `selectors.js`.
- FinCom: `src/js/84-gst-browser.js` (GSTB: the port, the job, results, logs, the login read),
  `app/src/screens/gst/BrowserHelper.jsx` (the card on GSTR-1 / IFF / GSTR-3B), `app/src/screens/gst/GstPortalLogin.jsx`
  (GST settings). The card is hidden when `gstFileRoute()` (branch next-gst-file) says the client files through the API.
- Server: `server/gst-browser/migration-93-gst-portal-login.sql` (NOT run on staging): `gst_portal_logins`,
  `gst_portal_login_events`, `gst_helper_runs`, `gst_portal_login_save / _list / _read / _delete`, `gst_helper_run_add`.
- Tests: `tests/run_gst_helper_rules.js`, `tests/run_gst_browser_helper.py` (the extension against the look-alike),
  `tests/run_gst_helper_app_ui.py` (FinCom's card and settings, with migration 93 on pg_stand), `tests/run_migration93.py`.
- The zip: `cd extension && zip -r fincom-gst-helper-<version>.zip gst-helper`.
