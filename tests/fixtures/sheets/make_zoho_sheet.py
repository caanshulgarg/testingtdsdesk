"""python3 make_zoho_sheet.py - a made-up Zoho Books "Invoice" export (sales_zoho_invoice.xlsx and .csv, the same rows),
in Zoho's own column layout: 201 columns, one row per invoice line, the invoice's figures (SubTotal, Total) repeated on
each of its lines, the line's taxable value in "Item Total" (there is no "Taxable value" column), the tax in CGST / SGST /
IGST far to the right (past column 80), the customer's GSTIN in "GST Identification Number (GSTIN)", the place of supply
as a state code (DL), and an "Invoice Status" (Draft and Void rows are not issued invoices).
Every name, GSTIN and figure is made up. The client is in Uttar Pradesh (09AANFG3202D1ZR, as in make_sheets.py).
Issued: INV-000101 (2 lines, IGST), INV-000102 (CGST + SGST), INV-000106 (SEZ, nil tax, a line discount), INV-000107
(3 lines at 5% and 18%): taxable 28,500.00, tax 3,560.00, total 32,060.00. Left out: INV-000103 and INV-000104 (Draft,
the second on two lines), INV-000105 (Void)."""
import os, csv
HERE = os.path.dirname(os.path.abspath(__file__))
HEAD = ["Invoice Date", "Invoice ID", "Invoice Number", "Issued Date", "Invoice Status", "Customer ID", "Customer Name", "Place of Supply", "Place of Supply(With State Code)", "GST Treatment",
  "Is Inclusive Tax", "Is Export Without LUT/Bond", "Tax Collected From Customer", "Due Date", "PurchaseOrder", "Currency Code", "Exchange Rate", "Discount Type", "Is Discount Before Tax", "Template Name",
  "Entity Discount Percent", "TCS Tax Name", "TCS Percentage", "TDS Calculation Type", "TDS Name", "TDS Percentage", "TDS Section Code", "TDS Section", "TDS Amount", "SubTotal", "Total",
  "TotalRetentionAmountFCY", "TotalRetentionAmountBCY", "Balance", "Adjustment", "Adjustment Description", "Expected Payment Date", "Last Payment Date", "Payment Terms", "Payment Terms Label", "Notes",
  "Terms & Conditions", "e-Invoice Status", "e-Invoice Reference Number", "E-WayBill Number", "E-WayBill Generated Time", "E-WayBill Status", "E-WayBill Cancelled Time", "E-WayBill Expired Time",
  "Transporter Name", "Transporter ID", "Dispatch Attention", "Dispatch Address", "Dispatch Street2", "Dispatch City", "Dispatch State", "Dispatch Country", "Dispatch Code", "Dispatch Phone",
  "Shipping Party GSTIN", "Shipping Party Trader Name", "Shipping Party Legal Name", "TCS Amount", "Invoice Type", "Entity Discount Amount", "Branch ID", "Branch Name", "Shipping Charge",
  "Shipping Charge Tax ID", "Shipping Charge Tax Amount", "Shipping Charge SAC Code", "Shipping Charge Tax Name", "Shipping Charge Tax %", "Shipping Charge Tax Type", "Shipping Charge Tax Exemption Code",
  "Item Name", "Item Desc", "Quantity", "Discount", "Discount Amount", "Item Total", "Usage unit", "Item Price", "Product ID", "Brand", "Sales Order Number", "Expense Reference ID", "Recurrence Name",
  "PayPal", "Authorize.Net", "Google Checkout", "Payflow Pro", "Stripe", "Paytm", "2Checkout", "Braintree", "Forte", "WorldPay", "Payments Pro", "Square", "WePay", "Razorpay", "ICICI EazyPay",
  "GoCardless", "Partial Payments", "Billing Attention", "Billing Address", "Billing Street2", "Billing City", "Billing State", "Billing Country", "Billing Code", "Billing Phone", "Billing Fax",
  "Shipping Attention", "Shipping Address", "Shipping Street2", "Shipping City", "Shipping State", "Shipping Country", "Shipping Code", "Shipping Fax", "Shipping Phone Number", "e-Invoice QRJson",
  "e-Invoice QR Raw Data", "e-Invoice Ack Number", "e-Invoice Ack Date", "e-Invoice Cancel Remark", "e-Invoice Cancel Reason", "e-Invoice Failure Reason", "Supplier Org Name",
  "Supplier GST Registration Number", "Supplier Street Address", "Supplier City", "Supplier State", "Supplier Country", "Supplier ZipCode", "Supplier Phone", "Supplier E-Mail", "CGST Rate %",
  "SGST Rate %", "IGST Rate %", "CESS Rate %", "CGST(FCY)", "SGST(FCY)", "IGST(FCY)", "CESS(FCY)", "CGST", "SGST", "IGST", "CESS", "Reverse Charge Tax Name", "Reverse Charge Tax Rate",
  "Reverse Charge Tax Type", "Item TDS Name", "Item TDS Percentage", "Item TDS Amount", "Item TDS Section Code", "Item TDS Section", "GST Identification Number (GSTIN)", "Nature Of Collection",
  "Project ID", "Project Name", "HSN/SAC", "Round Off", "Sales person", "Primary Contact EmailID", "Primary Contact Mobile", "Primary Contact Phone", "Estimate Number", "Item Type", "Payment Via",
  "Custom Charges", "Shipping Bill#", "Shipping Bill Date", "Shipping Bill Total", "PortCode", "Reference Invoice#", "Reference Invoice Date", "Reference Invoice Type",
  "GST Registration Number(Reference Invoice)", "Reason for issuing Debit Note", "E-Commerce Operator Name", "E-Commerce Operator GSTIN", "Account", "Account Code", "Supply Type", "Tax ID", "Item Tax",
  "Item Tax %", "Item Tax Amount", "Item Tax Type", "Item Tax Exemption Reason", "Kit Combo Item Name", "Item.CF.Batch", "Item.CF.Colour", "CF.PO Ref", "CF.Region", "CF.Contract No",
  "CF.Contract Date", "CF.Contract Expiry"]
assert len(HEAD) == 201
OWN = "09AANFG3202D1ZR"
CUST = {"Dhruv Office Supplies": ("07AABCD1111E1Z1", "DL", "07-Delhi", "business_gst"), "Ujala Lamps": ("09AABCU2222F1Z2", "UP", "09-Uttar Pradesh", "business_gst"),
        "Kaveri SEZ Units": ("29AABCK3333G1Z3", "KA", "29-Karnataka", "business_sez")}
# (invoice no, date, status, customer, [(item, qty, price, discount, rate)])
INV = [("INV-000101", "2026-10-03", "Open", "Dhruv Office Supplies", [("Desk", 2, 5000, 0, 18), ("Chair", 1, 5000, 0, 18)]),
       ("INV-000102", "2026-10-05", "Closed", "Ujala Lamps", [("Training", 1, 2000, 0, 18)]),
       ("INV-000103", "2026-10-07", "Draft", "Dhruv Office Supplies", [("Cabinet", 5, 10000, 0, 18)]),
       ("INV-000104", "2026-10-08", "Draft", "Ujala Lamps", [("Lamp", 10, 300, 0, 18), ("Bulb", 20, 50, 0, 5)]),
       ("INV-000105", "2026-10-09", "Void", "Ujala Lamps", [("Lamp", 1, 300, 0, 18)]),
       ("INV-000106", "2026-10-12", "Overdue", "Kaveri SEZ Units", [("Server rack", 2, 4500, 1000, 18)]),
       ("INV-000107", "2026-10-14", "Open", "Dhruv Office Supplies", [("Tea", 10, 100, 0, 5), ("Printer", 1, 2000, 0, 18), ("Toner", 1, 500, 0, 18)])]
f2 = lambda x: "%.2f" % x
rows = []
for k, (no, dt, status, cust, lines) in enumerate(INV):
    g, code, pos2, treat = CUST[cust]
    inter, sez = code != "UP", treat == "business_sez"
    calc = []
    for item, qty, price, disc, rate in lines:
        it = qty * price - disc
        tax = 0 if sez else round(it * rate / 100, 2)
        calc.append((item, qty, price, disc, rate, it, tax))
    sub = sum(c[5] for c in calc); tot = sub + sum(c[6] for c in calc)
    for item, qty, price, disc, rate, it, tax in calc:
        r = dict.fromkeys(HEAD, "")
        r.update({"Invoice Date": dt, "Invoice ID": str(5000 + k), "Invoice Number": no, "Issued Date": dt if status != "Draft" else "", "Invoice Status": status, "Customer ID": str(900 + k),
            "Customer Name": cust, "Place of Supply": code, "Place of Supply(With State Code)": pos2, "GST Treatment": treat, "Is Inclusive Tax": "false", "Currency Code": "INR", "Exchange Rate": "1.00",
            "Discount Type": "item_level", "Is Discount Before Tax": "true", "Entity Discount Percent": "0.00", "Entity Discount Amount": "0.000", "SubTotal": f2(sub), "Total": f2(tot), "Balance": f2(tot),
            "Adjustment": "0.00", "Item Name": item, "Quantity": f2(qty), "Discount": f2(disc), "Discount Amount": f2(disc), "Item Total": f2(it), "Item Price": f2(price), "Usage unit": "pcs",
            "Supplier Org Name": "ZZ Up Client", "Supplier GST Registration Number": OWN, "Supplier State": "Uttar Pradesh", "Supplier Country": "India",
            "CGST Rate %": "" if inter else f2(rate / 2), "SGST Rate %": "" if inter else f2(rate / 2), "IGST Rate %": f2(rate) if inter else "",
            "CGST": "0.00" if inter else f2(tax / 2), "SGST": "0.00" if inter else f2(tax / 2), "IGST": f2(tax) if inter else "0.00", "CESS": "0.00",
            "GST Identification Number (GSTIN)": g, "HSN/SAC": "9403" if item != "Training" else "999293", "Round Off": "0.00", "Item Type": "goods", "Account": "Sales", "Supply Type": "Taxable",
            "Item Tax": ("IGST" if inter else "GST") + str(rate), "Item Tax %": f2(rate), "Item Tax Amount": f2(tax), "Item Tax Type": "ItemAmount",
            "Billing City": "Made-up City", "Billing State": pos2.split("-", 1)[1], "Billing Country": "India", "Primary Contact EmailID": "accounts@example.com"})
        rows.append([r[h] for h in HEAD])
with open(os.path.join(HERE, "sales_zoho_invoice.csv"), "w", newline="") as f: csv.writer(f).writerows([HEAD] + rows)
try:
    import openpyxl, datetime
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Invoice"; ws.append(HEAD)
    for r in rows:
        r = list(r); r[0] = datetime.datetime.strptime(r[0], "%Y-%m-%d"); ws.append(r)
    wb.save(os.path.join(HERE, "sales_zoho_invoice.xlsx"))
except ImportError: pass
print(len(rows), "rows")

# sales_zoho_more.csv (next-zoho-sheet-followups): the invoice-level figures Zoho repeats on every line of an invoice,
# made up the same way. Each case: (no, customer, [(item, qty, price, rate)], invoice fields, line fields)
#  Z-201 shipping 500 with its tax 90 (no tax type: by the place of supply, UP = the client's state: CGST + SGST), 2 lines
#  Z-202 shipping 200 at 18% (only the rate), Delhi: IGST 36
#  Z-203 shipping 300 with tax 54, its tax type IGST (the type wins over the place of supply, UP)
#  Z-204 shipping 100 with no tax amount or rate: not added, left to the sum check (does not add up by 100)
#  Z-205 an invoice discount of 500 before tax, 2 lines (3,000 + 2,000 at 18%, IGST on 4,500)
#  Z-206 an invoice discount of 100 after tax: taxable not cut (left to the sum check)
#  Z-207 tax-inclusive: Item Total 1,050 at 5% and 1,180 at 18%: taxable 1,000 + 1,000
#  Z-208 Adjustment 25 on 2 lines: Total 1,205 (1,000 + 180 + 25): round off 25
#  Z-209 Adjustment -10.50: Total 1,169.50: round off -10.50
#  Z-210 Adjustment 25 but Total 1,230: not explained, no round off
# (made-up GSTINs whose check character is right, so the invoices can go all the way to Ready and post)
CUST_MORE = {"Dhruv Office Supplies": ("07AAACD4444H1ZV", "DL", "07-Delhi", "business_gst"), "Ujala Lamps": ("09AAACU5555J1ZZ", "UP", "09-Uttar Pradesh", "business_gst")}
def more_rows():
    out = []
    MORE = [("Z-201", "Ujala Lamps", [("Lamp", 1, 600, 18), ("Shade", 1, 400, 18)], {"Shipping Charge": "500.00", "Shipping Charge Tax Amount": "90.00", "Shipping Charge Tax %": "18.00"}),
            ("Z-202", "Dhruv Office Supplies", [("Desk", 1, 2000, 18)], {"Shipping Charge": "200.00", "Shipping Charge Tax %": "18.00"}),
            ("Z-203", "Ujala Lamps", [("Lamp", 1, 1000, 18)], {"Shipping Charge": "300.00", "Shipping Charge Tax Amount": "54.00", "Shipping Charge Tax Type": "IGST"}),
            ("Z-204", "Ujala Lamps", [("Lamp", 1, 1000, 18)], {"Shipping Charge": "100.00"}),
            ("Z-205", "Dhruv Office Supplies", [("Desk", 1, 3000, 18), ("Chair", 1, 2000, 18)], {"Entity Discount Amount": "500.00", "Is Discount Before Tax": "true", "Discount Type": "entity_level"}),
            ("Z-206", "Dhruv Office Supplies", [("Desk", 1, 1000, 18)], {"Entity Discount Amount": "100.00", "Is Discount Before Tax": "false", "Discount Type": "entity_level"}),
            ("Z-207", "Ujala Lamps", [("Tea", 1, 1050, 5), ("Lamp", 1, 1180, 18)], {"Is Inclusive Tax": "true"}),
            ("Z-208", "Ujala Lamps", [("Lamp", 1, 600, 18), ("Shade", 1, 400, 18)], {"Adjustment": "25.00"}),
            ("Z-209", "Ujala Lamps", [("Lamp", 1, 1000, 18)], {"Adjustment": "-10.50"}),
            ("Z-210", "Ujala Lamps", [("Lamp", 1, 1000, 18)], {"Adjustment": "25.00", "_total": 1230})]
    for k, (no, cust, lines, inv) in enumerate(MORE):
        g, code, pos2, treat = CUST_MORE[cust]
        inter, incl = code != "UP", inv.get("Is Inclusive Tax") == "true"
        disc = float(inv.get("Entity Discount Amount", 0)) if inv.get("Is Discount Before Tax") == "true" else 0
        gross = sum(q * p for _, q, p, _ in lines)
        calc = []
        for item, qty, price, rate in lines:
            it = qty * price
            base = round(it / (1 + rate / 100), 2) if incl else it - round(disc * it / gross, 2)
            calc.append((item, qty, price, rate, it, round(base * rate / 100, 2)))
        ship = float(inv.get("Shipping Charge", 0)); st = inv.get("Shipping Charge Tax Amount")
        st = float(st) if st else (round(ship * float(inv["Shipping Charge Tax %"]) / 100, 2) if inv.get("Shipping Charge Tax %") else 0)
        tax = sum(c[5] for c in calc)
        sub = sum(c[4] for c in calc)
        tot = inv.get("_total") or ((sub if incl else sub - disc) + (0 if incl else tax) + ship + st + float(inv.get("Adjustment", 0))
                                    - (float(inv.get("Entity Discount Amount", 0)) if inv.get("Is Discount Before Tax") == "false" else 0))
        for item, qty, price, rate, it, t in calc:
            r = dict.fromkeys(HEAD, "")
            r.update({"Invoice Date": "2026-10-20", "Invoice ID": str(6000 + k), "Invoice Number": no, "Issued Date": "2026-10-20", "Invoice Status": "Open", "Customer ID": str(950 + k),
                "Customer Name": cust, "Place of Supply": code, "Place of Supply(With State Code)": pos2, "GST Treatment": treat, "Is Inclusive Tax": "false", "Currency Code": "INR", "Exchange Rate": "1.00",
                "Discount Type": "item_level", "Is Discount Before Tax": "true", "Entity Discount Percent": "0.00", "Entity Discount Amount": "0.000", "SubTotal": f2(sub), "Total": f2(tot), "Balance": f2(tot),
                "Adjustment": "0.00", "Shipping Charge": "0.00", "Item Name": item, "Quantity": f2(qty), "Discount": "0.00", "Discount Amount": "0.00", "Item Total": f2(it), "Item Price": f2(price),
                "Supplier Org Name": "ZZ Up Client", "Supplier GST Registration Number": OWN, "CGST Rate %": "" if inter else f2(rate / 2), "SGST Rate %": "" if inter else f2(rate / 2),
                "IGST Rate %": f2(rate) if inter else "", "CGST": "0.00" if inter else f2(t / 2), "SGST": "0.00" if inter else f2(t / 2), "IGST": f2(t) if inter else "0.00", "CESS": "0.00",
                "GST Identification Number (GSTIN)": g, "HSN/SAC": "9405", "Round Off": "0.00", "Item Tax %": f2(rate), "Item Tax Amount": f2(t)})
            r.update({h: v for h, v in inv.items() if not h.startswith("_")})
            out.append([r[h] for h in HEAD])
    return out
more = more_rows()
with open(os.path.join(HERE, "sales_zoho_more.csv"), "w", newline="") as f: csv.writer(f).writerows([HEAD] + more)
print(len(more), "rows (sales_zoho_more.csv)")
