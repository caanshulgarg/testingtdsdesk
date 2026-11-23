# Third-party notices

FinCom includes portions of the following open-source software. Each ported FinCom file starts with the line
`Portions ported from Independent Books (MIT, (c) 2026 Independent Books Contributors), see THIRD_PARTY_NOTICES.md`,
and each ported test names the original test it was rewritten from. No name, logo or branding of these projects appears in
FinCom's product.

## Independent Books

- Source: <https://github.com/PrimeSteelIndia/independent-books>
- Commit used: `2a7f9fe83cf8d9957e4d996e451e2cf4aaf26ef7` (1-Nov-2026)
- Licence: MIT (below)
- What was ported (the logic rewritten in JavaScript for FinCom; nothing copied as it stands, nothing of theirs is run):

| FinCom file | Ported from (Independent Books) |
|---|---|
| `app/src/lib/fbooks/rules.js` | `books.py`: `decimal` (amount parsing), `gst_components` and `calculate_item_gst` (the CGST / SGST half split, blank state = IGST, an item's GST rate never its price), `_bill_id`, `_due_date`, `_bill_rows`, `_normalize_bill_allocations`, `_validate_bill_allocations`, `ageing` (bill-wise references and ageing) |
| `tests/run_fbooks_rules.mjs` | `tests/test_phase2_bills.py`, `tests/test_item_gst_engine.py` (`test_calculate_item_gst_pure_python`), `tests/test_voucher_rules.py` (`test_local_gst_splits_into_cgst_and_sgst`), `tests/test_audit_fixes.py` (`test_blank_state_defaults_to_igst_not_local`, `test_decimal_rejects_junk_and_handles_spaces_without_truncating`, `test_calculate_item_gst_does_not_use_unit_rate_as_tax_percentage`, `test_settle_invoice_without_bill_details_works`) |
| `server/fincom-books/migration-220-fincom-books.sql` (`fb_seed_groups`) | Tally's 28 reserved groups, cross-checked against `GROUP_PARENTS` in `books.py` (Tally's public structure; no code taken) |

What FinCom deliberately does differently (docs/FULL-BOOKS-PLAN.md section 11.4): the place of supply is the invoice's,
never the party ledger's; tax lines are known by their tax kind, never by a ledger's name; money is whole paise; bill ids are
plain keys; storage, numbering, history and deletion are FinCom's own (Postgres, versions, a database-written edit log).

```
MIT License

Copyright (c) 2026 Independent Books Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
