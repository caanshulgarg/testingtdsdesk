"""python3 make_org.py - writes the known Zoho Books test organisation (org/*.json): TEST DATA ONLY, a made-up company.

The shapes are Zoho Books API v3 (India edition) as its published reference describes them (www.zoho.com/books/api/v3:
organizations, chartofaccounts, contacts, settings/taxes, invoices, creditnotes, bills, vendorcredits, customerpayments,
vendorpayments, expenses, journals, banktransactions, settings/openingbalances). This sandbox cannot reach zoho.com or
zohoapis.in, so the field names are as documented, written by hand; every field the mapping reads is listed in
FIELDS.md with what a real trial organisation must confirm. The answer key (expected.json, EXPECTED.md) is worked out by
hand from these documents, not by FinCom's code.

The organisation: FinCom Zoho Test Pvt Ltd, Maharashtra, GSTIN 27AAACZ1234Z1ZG, FY 2026-27. Documents in April and May
2026: B2B intra and inter-state invoices, an SEZ invoice with IGST, an export under LUT, a B2C large and a B2C small
invoice, a draft (not in the books), a void invoice, a credit note, a purchase bill, a reverse-charge bill, a bill with
TDS 194C, a bill with TDS 194J, a vendor credit, a customer payment with TDS withheld, a vendor payment, an expense paid
in cash, a bank transfer, a journal to a supplier, and a bank line booked by its own payment (skipped)."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "org"); os.makedirs(OUT, exist_ok=True)
C = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
def gstin(b):
    s = 0
    for i, ch in enumerate(b):
        p = C.index(ch) * (2 if i % 2 else 1); s += p // 36 + p % 36
    return b + C[(36 - s % 36) % 36]
ORG_ID = "60012345678"
ORG_GSTIN = gstin("27AAACZ1234Z1Z")
def mod(day, hh="10:00:00"): return "%sT%s+0530" % (day, hh)
n = [460000000010000]
def nid(): n[0] += 1; return str(n[0])

org = {"organization_id": ORG_ID, "name": "FinCom Zoho Test Pvt Ltd", "contact_name": "Test", "email": "test@fincom.invalid", "is_default_org": True,
       "plan_type": 0, "plan_name": "Free", "currency_code": "INR", "fiscal_year_start_month": 3, "country": "India", "state": "Maharashtra",
       "gst_no": ORG_GSTIN, "tax_reg_no": ORG_GSTIN, "is_org_active": True, "version": "india"}
second = {"organization_id": "60099999999", "name": "Another Org of the same user", "is_default_org": False, "currency_code": "INR", "country": "India", "version": "india"}

A = {}
def acc(name, typ, **kw):
    i = nid(); A[name] = i
    return dict({"account_id": i, "account_name": name, "account_type": typ, "is_active": True, "account_code": "", "last_modified_time": mod("2026-03-31")}, **kw)
accounts = [acc("Sales", "income"), acc("Sales - Services", "income"), acc("Purchases", "cost_of_goods_sold"), acc("Professional Fees", "expense"),
            acc("Contract Charges", "expense"), acc("Rent", "expense"), acc("Legal Fees", "expense"), acc("Office Expenses", "expense"),
            acc("HDFC Bank", "bank"), acc("ICICI Bank", "bank"), acc("Petty Cash", "cash"), acc("Accounts Receivable", "accounts_receivable"),
            acc("Accounts Payable", "accounts_payable"), acc("Output CGST", "other_current_liability"), acc("Output SGST", "other_current_liability"),
            acc("Output IGST", "other_current_liability"), acc("Input CGST", "other_current_asset"), acc("Input SGST", "other_current_asset"),
            acc("Input IGST", "other_current_asset"), acc("TDS Receivable", "other_current_asset"), acc("Owner's Capital", "equity")]

T = {}
def tax(name, pct, kind, **kw):
    i = nid(); T[name] = i
    return dict({"tax_id": i, "tax_name": name, "tax_percentage": pct, "tax_type": "tax", "tax_specific_type": kind, "is_value_added": False}, **kw)
taxes = [tax("CGST9", 9, "cgst"), tax("SGST9", 9, "sgst"), tax("IGST18", 18, "igst"), tax("CGST2.5", 2.5, "cgst"), tax("SGST2.5", 2.5, "sgst"), tax("IGST5", 5, "igst")]
def group(name, pct, kids):
    i = nid(); T[name] = i
    return {"tax_id": i, "tax_name": name, "tax_percentage": pct, "tax_type": "tax_group", "taxes": [{"tax_id": T[k], "tax_name": k} for k in kids]}
taxes += [group("GST18", 18, ["CGST9", "SGST9"]), group("GST5", 5, ["CGST2.5", "SGST2.5"])]
tds = []
def tdst(name, pct, sec):
    i = nid(); T[name] = i
    tds.append({"tax_id": i, "tax_name": name, "tax_percentage": pct, "tax_type": "tax", "tax_specific_type": "tds", "tds_section": sec})
tdst("Payment to Contractors (Others)", 2, "Section 194C"); tdst("Professional Fees", 10, "Section 194J"); tdst("Rent on Land and Building", 10, "Section 194I")

K = {}
def con(name, typ, treat, gst="", pan="", pos="MH", **kw):
    i = nid(); K[name] = i
    d = {"contact_id": i, "contact_name": name, "company_name": name, "contact_type": typ, "gst_treatment": treat, "gst_no": gst, "pan_no": pan,
         "place_of_contact": pos, "status": "active", "last_modified_time": mod("2026-04-01")}
    d.update(kw); return d
contacts = [
    con("Alpha Traders Mumbai", "customer", "business_gst", gstin("27AAAFA1111A1Z")),
    con("Beta Industries Delhi", "customer", "business_gst", gstin("07AAACB2222B1Z"), pos="DL"),
    con("Gamma SEZ Unit", "customer", "business_sez", gstin("27AAACG3333G1Z")),
    con("Euro Imports GmbH", "customer", "overseas", "", pos="", country="Germany"),
    con("Retail Customer Gujarat", "customer", "consumer", "", pos="GJ"),
    con("Walkin Pune", "customer", "consumer", ""),
    con("Kappa Suppliers Pune", "vendor", "business_gst", gstin("27AAACK4444K1Z")),
    con("Mu Advocates", "vendor", "business_none", "", "AAAFM8888M"),
    con("Omicron Contractors", "vendor", "business_gst", gstin("27AAACO5555O1Z"), tds_tax_id=T["Payment to Contractors (Others)"]),
    con("Pi Consultants", "vendor", "business_none", "", "AAAPP7777P", tds_tax_id=T["Professional Fees"]),
    con("Sigma Landlord", "vendor", "business_none", "", "AAAPS6666S"),
]
CB = {c["contact_name"]: c for c in contacts}

def li(account, amount, taxname=None, hsn="", ptype="goods", **kw):
    t = [x for x in taxes if x["tax_name"] == taxname]
    d = {"line_item_id": nid(), "account_id": A[account], "account_name": account, "name": account, "rate": amount, "quantity": 1, "item_total": amount,
         "tax_id": T[taxname] if taxname else "", "tax_name": taxname or "", "tax_percentage": t[0]["tax_percentage"] if t else 0, "hsn_or_sac": hsn, "product_type": ptype}
    d.update(kw); return d
def tx(**heads):
    out = []
    for name, amt in heads.items(): out.append({"tax_id": T[name], "tax_name": name, "tax_amount": amt})
    return out

def invoice(no, day, cust, lines, taxes_, total, status="sent", treat=None, pos=None, **kw):
    c = CB[cust]
    d = {"invoice_id": nid(), "invoice_number": no, "date": day, "due_date": day[:8] + "%02d" % min(28, int(day[8:]) + 15), "status": status,
         "customer_id": c["contact_id"], "customer_name": cust, "gst_treatment": treat or c["gst_treatment"], "gst_no": c["gst_no"],
         "place_of_supply": pos if pos is not None else c["place_of_contact"], "is_reverse_charge_applied": False, "line_items": lines, "taxes": taxes_,
         "sub_total": sum(x["item_total"] for x in lines), "tax_total": sum(x["tax_amount"] for x in taxes_), "total": total, "reference_number": "",
         "is_discount_before_tax": True, "discount_amount": 0, "adjustment": 0, "last_modified_time": mod(day), "created_time": mod(day, "09:00:00")}
    d.update(kw); return d
invoices = [
    invoice("INV-001", "2026-05-02", "Alpha Traders Mumbai", [li("Sales", 100000, "GST18", "8471")], tx(CGST9=9000, SGST9=9000), 118000),
    invoice("INV-002", "2026-05-03", "Beta Industries Delhi", [li("Sales", 200000, "IGST18", "8471")], tx(IGST18=36000), 236000),
    invoice("INV-003", "2026-05-05", "Gamma SEZ Unit", [li("Sales", 150000, "IGST18", "8471")], tx(IGST18=27000), 177000),
    invoice("INV-004", "2026-05-06", "Euro Imports GmbH", [li("Sales - Services", 250000, None, "998314", "service", tax_exemption_code="export")], [], 250000,
            billing_address={"country": "Germany"}),
    invoice("INV-005", "2026-05-07", "Retail Customer Gujarat", [li("Sales", 150000, "IGST18", "8471")], tx(IGST18=27000), 177000),
    invoice("INV-006", "2026-05-08", "Walkin Pune", [li("Sales", 40000, "GST18", "8471"), li("Sales", 10000, "GST5", "1006")],
            tx(CGST9=3600, SGST9=3600, **{"CGST2.5": 250, "SGST2.5": 250}), 57700),
    invoice("INV-007", "2026-05-09", "Alpha Traders Mumbai", [li("Sales", 5000, "GST18", "8471")], tx(CGST9=450, SGST9=450), 5900, status="draft"),
    invoice("INV-008", "2026-05-10", "Alpha Traders Mumbai", [li("Sales", 7000, "GST18", "8471")], tx(CGST9=630, SGST9=630), 8260, status="void"),
]
inv_by = {x["invoice_number"]: x for x in invoices}
creditnotes = [{"creditnote_id": nid(), "creditnote_number": "CN-001", "date": "2026-05-15", "status": "closed", "customer_id": K["Alpha Traders Mumbai"],
    "customer_name": "Alpha Traders Mumbai", "gst_treatment": "business_gst", "gst_no": CB["Alpha Traders Mumbai"]["gst_no"], "place_of_supply": "MH",
    "line_items": [li("Sales", 10000, "GST18", "8471")], "taxes": tx(CGST9=900, SGST9=900), "sub_total": 10000, "total": 11800, "reference_number": "INV-001",
    "invoices": [{"invoice_id": inv_by["INV-001"]["invoice_id"], "invoice_number": "INV-001", "amount_applied": 11800}], "reason": "goods returned",
    "last_modified_time": mod("2026-05-15")}]

def bill(no, day, vend, lines, taxes_, total, rcm=False, tds=None, tds_amount=0, **kw):
    c = CB[vend]
    d = {"bill_id": nid(), "bill_number": no, "date": day, "due_date": day[:8] + "%02d" % min(28, int(day[8:]) + 20), "status": "open", "vendor_id": c["contact_id"],
         "vendor_name": vend, "gst_treatment": c["gst_treatment"], "gst_no": c["gst_no"], "source_of_supply": "MH", "destination_of_supply": "MH",
         "place_of_supply": "MH", "is_reverse_charge_applied": rcm, "line_items": lines, "taxes": taxes_, "sub_total": sum(x["item_total"] for x in lines),
         "tax_total": sum(x["tax_amount"] for x in taxes_), "total": total, "reference_number": "", "adjustment": 0,
         "tds_tax_id": T[tds] if tds else "", "tds_amount": tds_amount, "last_modified_time": mod(day)}
    d.update(kw); return d
bills = [
    bill("KS/101", "2026-05-04", "Kappa Suppliers Pune", [li("Purchases", 50000, "GST18", "8471")], tx(CGST9=4500, SGST9=4500), 59000),
    bill("MU/7", "2026-05-05", "Mu Advocates", [li("Legal Fees", 50000, "GST18", "998212", "service")], tx(CGST9=4500, SGST9=4500), 50000, rcm=True),
    bill("OC/55", "2026-05-06", "Omicron Contractors", [li("Contract Charges", 100000, "GST18", "995411", "service")], tx(CGST9=9000, SGST9=9000), 116000,
         tds="Payment to Contractors (Others)", tds_amount=2000),
    bill("PC/9", "2026-04-20", "Pi Consultants", [li("Professional Fees", 60000, None, "998222", "service")], [], 54000, tds="Professional Fees", tds_amount=6000),
]
bill_by = {x["bill_number"]: x for x in bills}
vendorcredits = [{"vendor_credit_id": nid(), "vendor_credit_number": "VC-001", "date": "2026-05-20", "status": "closed", "vendor_id": K["Kappa Suppliers Pune"],
    "vendor_name": "Kappa Suppliers Pune", "gst_treatment": "business_gst", "gst_no": CB["Kappa Suppliers Pune"]["gst_no"], "source_of_supply": "MH",
    "destination_of_supply": "MH", "line_items": [li("Purchases", 5000, "GST18", "8471")], "taxes": tx(CGST9=450, SGST9=450), "sub_total": 5000, "total": 5900,
    "reference_number": "KS/101", "bills": [{"bill_id": bill_by["KS/101"]["bill_id"], "bill_number": "KS/101", "amount_applied": 5900}], "last_modified_time": mod("2026-05-20")}]
customerpayments = [{"payment_id": nid(), "payment_number": "RCPT-1", "date": "2026-05-25", "customer_id": K["Alpha Traders Mumbai"], "customer_name": "Alpha Traders Mumbai",
    "amount": 104200, "bank_charges": 0, "tax_amount_withheld": 2000, "account_id": A["HDFC Bank"], "account_name": "HDFC Bank", "payment_mode": "banktransfer",
    "reference_number": "UTR123", "invoices": [{"invoice_id": inv_by["INV-001"]["invoice_id"], "invoice_number": "INV-001", "amount_applied": 104200, "tax_amount_withheld": 2000}],
    "last_modified_time": mod("2026-05-25")}]
vendorpayments = [{"payment_id": nid(), "payment_number": "PAY-1", "date": "2026-05-26", "vendor_id": K["Kappa Suppliers Pune"], "vendor_name": "Kappa Suppliers Pune",
    "amount": 53100, "paid_through_account_id": A["HDFC Bank"], "paid_through_account_name": "HDFC Bank", "reference_number": "UTR456",
    "bills": [{"bill_id": bill_by["KS/101"]["bill_id"], "bill_number": "KS/101", "amount_applied": 53100}], "last_modified_time": mod("2026-05-26")}]
expenses = [{"expense_id": nid(), "date": "2026-05-12", "account_id": A["Office Expenses"], "account_name": "Office Expenses", "paid_through_account_id": A["Petty Cash"],
    "paid_through_account_name": "Petty Cash", "vendor_id": K["Kappa Suppliers Pune"], "vendor_name": "Kappa Suppliers Pune", "gst_treatment": "business_gst",
    "gst_no": CB["Kappa Suppliers Pune"]["gst_no"], "source_of_supply": "MH", "destination_of_supply": "MH", "place_of_supply": "MH", "reference_number": "KS/C-12",
    "description": "stationery", "tax_id": T["GST18"], "tax_percentage": 18, "tax_amount": 180, "sub_total": 1000, "total": 1180, "amount": 1180, "is_inclusive_tax": False,
    "hsn_or_sac": "4820", "product_type": "goods", "is_reverse_charge_applied": False, "status": "nonbillable", "last_modified_time": mod("2026-05-12")}]
journals = [{"journal_id": nid(), "entry_number": "JV-1", "journal_date": "2026-05-31", "reference_number": "", "notes": "May rent payable", "status": "published",
    "line_items": [{"line_id": nid(), "account_id": A["Rent"], "account_name": "Rent", "debit_or_credit": "debit", "amount": 75000},
                   {"line_id": nid(), "account_id": A["Accounts Payable"], "account_name": "Accounts Payable", "debit_or_credit": "credit", "amount": 75000,
                    "customer_id": K["Sigma Landlord"], "customer_name": "Sigma Landlord"}],
    "total": 75000, "last_modified_time": mod("2026-05-31")}]
banktransactions = [
    {"transaction_id": nid(), "transaction_type": "transfer_fund", "date": "2026-05-28", "amount": 50000, "from_account_id": A["HDFC Bank"], "from_account_name": "HDFC Bank",
     "to_account_id": A["ICICI Bank"], "to_account_name": "ICICI Bank", "reference_number": "TRF-1", "description": "to ICICI", "status": "categorized", "last_modified_time": mod("2026-05-28")},
    {"transaction_id": nid(), "transaction_type": "vendor_payment", "date": "2026-05-26", "amount": 53100, "from_account_id": A["HDFC Bank"], "from_account_name": "HDFC Bank",
     "reference_number": "UTR456", "status": "categorized", "last_modified_time": mod("2026-05-26")},
]
opening = {"opening_balance": {"date": "2026-04-01", "accounts": [
    {"account_id": A["HDFC Bank"], "account_name": "HDFC Bank", "debit_or_credit": "debit", "bcy_amount": 500000},
    {"account_id": A["Owner's Capital"], "account_name": "Owner's Capital", "debit_or_credit": "credit", "bcy_amount": 500000}]}}

def w(name, obj): json.dump(obj, open(os.path.join(OUT, name + ".json"), "w"), indent=1, ensure_ascii=False)
w("organizations", [org, second]); w("chartofaccounts", accounts); w("taxes", taxes); w("tdstaxes", tds); w("contacts", contacts)
for k, v in (("invoices", invoices), ("creditnotes", creditnotes), ("bills", bills), ("vendorcredits", vendorcredits), ("customerpayments", customerpayments),
             ("vendorpayments", vendorpayments), ("expenses", expenses), ("journals", journals), ("banktransactions", banktransactions)): w(k, v)
w("openingbalances", opening)
print("written", OUT, ORG_GSTIN)
