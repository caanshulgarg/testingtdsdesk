# Zoho Books in FinCom

The owner's decisions of 13-Oct-2026: Zoho first, then Busy; FinCom both reads and posts. A client who keeps the books in
Zoho Books is shown in FinCom exactly like a Tally client: TDS, GST, MIS, the due list and posting all work.

## What is built (branch zoho-books)

| Part | Where | What it does |
|---|---|---|
| Mapping | `server/zoho-books/map.js` | Zoho's documents into the same rows the Tally bridge writes (`tally_vouchers`, `tally_lines`, `tally_bills`, `tally_ledgers`, `tally_groups`), marked `source = 'zoho'`. Invoices are Sales, credit notes are Credit Notes, bills are Purchases, vendor credits are Debit Notes, customer payments are Receipts, vendor payments and cash or bank expenses are Payments, transfers are Contras, and manual journals are Journals. Each contact is a party ledger with its GSTIN, PAN and TDS section. GST goes to Output, Input and RCM Payable ledgers per head. TDS goes to "TDS Payable <section>". Zoho's own GST treatment, place of supply and reverse charge are kept in migration 72's columns. |
| Function | `server/zoho-books/index.ts` (`zoho-books`) | Signs in on Zoho's India data centre, then reads only what changed (`last_modified_time`) every few minutes, within 90 calls a minute and 95% of the plan's daily cap. It waits out Zoho's 429s and renews the access token. Once a day it compares ids to find deletions. It also posts. |
| Database | `server/zoho-books/migration-75-zoho-books.sql` (and 75b, staging's schedule) | Add-only. The tokens are kept in Vault, never in a table. Row-level security keeps each firm to its own rows. Posting has its records and a lock. |
| App | `src/js/74-zoho-books.js`, `app/src/screens/Integrations.jsx`, `app/src/parts/BooksSource.jsx` | `#/integrations` shows the Tally, Zoho Books and Busy cards. `#/integrations/zoho` connects, links, shows reads and errors, and disconnects. Client setup shows the "Books source" card. A Zoho client's Post sends its entries to Zoho. |

Posting has the same safeguards as posting to Tally:
- FinCom's id goes in the Zoho reference (`FC:<id>`) and the notes (`TDSDesk:<id>`).
- Zoho is checked for that reference before each entry.
- One posting runs at a time per organisation.
- Each entry ends as Posted, or as an Error in Zoho's own words.
- FinCom sends no PUT and no DELETE. It creates only bills, expenses, journals and parties.

## For the owner: setting it up (about 15 minutes)

### 1. Make FinCom's Zoho API client (once, for the firm)

1. Open **https://api-console.zoho.in** and sign in with the firm's own Zoho account (the India site, zoho.in).
2. Click **Get Started** (or **Add Client**), and choose **Server-based Applications**.
3. Fill in:
   - **Client Name:** `FinCom`
   - **Homepage URL:** `https://staging.fincom.live`
   - **Authorized Redirect URIs:** `https://qbocskaiewaxqcvaunzc.supabase.co/functions/v1/zoho-books` (exactly this, with nothing after it)
4. Click **Create**. Zoho shows the **Client ID**, and the **Client Secret** on the "Client Secret" tab.
5. Put the two into FinCom's staging project yourself. Never send them to anyone, Claude included.
   - Open **supabase.com/dashboard**, then the project **tds-desk-staging**.
   - Go to **Edge Functions**, then **Secrets**, then **Add new secret**.
   - Add `ZOHO_CLIENT_ID` with the Client ID, and `ZOHO_CLIENT_SECRET` with the Client Secret. Save.
6. Leave the client's **Settings** tab in Zoho's console as it is. "Multi-DC" is not needed: FinCom reads India only.

Until step 5 is done, FinCom's Integrations → Zoho Books page says **"FinCom's Zoho app set up: No"** and has no Connect
button.

### 2. A Zoho Books trial organisation with test data

1. Open **https://www.zoho.com/in/books/** and click **Free Trial**. Sign up with a test email and choose **India**. Give it a
   made-up company in Maharashtra, registered for GST, with a test GSTIN.
2. In the trial, enter a few documents of each kind. The list in `tests/fixtures/zoho/EXPECTED.md` is a good checklist:
   - a B2B invoice within the state and one to another state;
   - an invoice to an SEZ (with IGST), an export without tax, a B2C invoice above ₹1 lakh to another state, and a small B2C invoice;
   - a credit note;
   - a bill, a reverse-charge bill (an advocate), and a bill with TDS (194C);
   - a vendor credit, a customer payment, a vendor payment, a cash expense, a bank transfer and a journal.

### 3. Connect it in FinCom

1. Sign in to **staging.fincom.live** as the firm's owner.
2. Add a client with the trial organisation's GSTIN, or use an existing test client.
3. In the sidebar, open **Integrations**, then the **Zoho Books** card, and click **Connect Zoho Books**.
4. Zoho's own page lists what FinCom asks for. Click **Accept**.
5. Back in FinCom, choose the client next to the organisation and click **Link**. The first read starts at once. After
   that, FinCom reads every few minutes.
6. Optional: click **Webhook address** to have Zoho tell FinCom at once when something changes. In Zoho Books, go to
   **Settings → Automation → Workflow Rules**. Add a rule for Invoices, Bills and the other kinds, with a **Webhook**
   action that POSTs to the address shown.

### The permissions FinCom asks Zoho for (the fewest that work)

`ZohoBooks.settings.READ`, `ZohoBooks.accountants.READ`, `ZohoBooks.accountants.CREATE`, `ZohoBooks.contacts.READ`,
`ZohoBooks.contacts.CREATE`, `ZohoBooks.invoices.READ`, `ZohoBooks.creditnotes.READ`, `ZohoBooks.customerpayments.READ`,
`ZohoBooks.bills.READ`, `ZohoBooks.bills.CREATE`, `ZohoBooks.debitnotes.READ`, `ZohoBooks.vendorpayments.READ`,
`ZohoBooks.expenses.READ`, `ZohoBooks.expenses.CREATE`, `ZohoBooks.banking.READ`.

READ covers everything FinCom reads. CREATE is asked only for what FinCom posts: bills, expenses, journals (these are
under "accountants") and new parties (contacts). FinCom never asks for UPDATE, DELETE or ALL.

## What only a real Zoho organisation can prove

The sandbox could not reach zoho.com or zohoapis.in. So the shapes are taken from Zoho's published API reference and
recorded by hand (`tests/fixtures/zoho/org`), and every test runs against a stand-in Zoho (`tests/fake_zoho.py`). On the
trial organisation, check these:

1. **Sign-in.** The redirect comes back with `location=in`, and the token exchange and refresh work on accounts.zoho.in.
2. **Field names.** On a real invoice, bill, credit note, vendor credit, expense and journal, check the field names
   FinCom reads:
   - `gst_treatment` values, including `business_sez`, `overseas` and `deemed_export`;
   - `place_of_supply` codes;
   - `is_reverse_charge_applied`;
   - `line_items[].tax_id`, `hsn_or_sac`, `product_type` and `itc_eligibility`;
   - the exemption code on export and nil-rated lines;
   - on bills, `tds_tax_id` and `tds_amount`, and whether `total` is net of TDS (FinCom handles either);
   - on customer payments, `tax_amount_withheld`;
   - the TDS taxes from `settings/taxes?is_tds_request=true` (their section field);
   - `settings/openingbalances`.
3. **Lists.** Check that lists sort by `last_modified_time` (newest first) and include it in each row, that they include
   void documents, and that journals list both draft and published ones.
4. **Bank transactions.** Check the `transaction_type` values of transfers and owner's money, and that a categorised
   payment shows its type, so it is not counted twice.
5. **Limits.** Check Zoho's 429 bodies for the per-minute and daily limits, and the daily cap of the plan (Free 1,000,
   Standard 2,000, Professional 5,000, Premium 10,000).
6. **Posting.** Check that a bill is accepted with `tds_tax_id`, `gst_treatment`, `source_of_supply` and
   `destination_of_supply`, that the duplicate-number refusal comes with its words, that an expense is accepted with
   `paid_through_account_id`, and that a journal line to a party is accepted with `customer_id` on Accounts Payable.
7. **The figures.** Check GSTR-1, 3B and 26Q for the trial month against Zoho's own GST and TDS reports.
8. **Multiple GSTINs.** Organisations with more than one GSTIN (Zoho branches) are not handled yet. Every entry is
   booked to the organisation's one GSTIN.
