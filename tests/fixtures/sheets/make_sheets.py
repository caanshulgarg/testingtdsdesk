"""python3 make_sheets.py - the made-up registers the sheet tests read (run_sheet_engine.js, run_sheet_import.py).
The client is in Uttar Pradesh (09); every figure is worked out by hand in EXPECTED below and checked to the paisa."""
import os, json
HERE = os.path.dirname(os.path.abspath(__file__))
w = lambda name, text: open(os.path.join(HERE, name), "w", newline="").write(text)

# 1. a CA's own purchase register: dates d/m/Y, Rs. and commas, a credit note in brackets, an invoice on two rows, a total row
REG = [["Inv Dt", "Bill No", "Supplier", "GSTIN", "Doc Type", "Taxable Amt", "IGST", "CGST", "SGST", "Total", "Remarks"],
       ["05/07/2026", "KIT/101", "Kashi IT Solutions", "09AAACK1234A1Z5", "Invoice", "Rs. 10,000.00", "0", "900.00", "900.00", "11,800.00", "laptops"],
       ["06/07/2026", "DL/77", "Delhi Legal LLP", "07AABFD5678B1Z2", "Invoice", "25,000.00", "4,500.00", "0", "0", "29,500.00", "retainer"],
       ["06/07/2026", "DL/77", "Delhi Legal LLP", "07AABFD5678B1Z2", "Invoice", "5,000.00", "900.00", "0", "0", "5,900.00", "out of pocket"],
       ["09/07/2026", "KIT/CN/4", "Kashi IT Solutions", "09AAACK1234A1Z5", "Credit Note", "(1,000.00)", "0", "(90.00)", "(90.00)", "(1,180.00)", "returned mouse"],
       ["12/07/2026", "NEW/9", "Nirmal Traders", "09AAFCN4321C1Z9", "Invoice", "2,500.50", "0", "225.05", "225.05", "2,950.60", "stationery"],
       ["", "", "Total", "", "", "41,500.50", "5,400.00", "1,035.05", "1,035.05", "48,970.60", ""]]
csv = lambda rows: "\n".join(",".join('"' + str(c) + '"' if ("," in str(c) or " " in str(c)) else str(c) for c in r) for r in rows) + "\n"
w("purchase_register.csv", csv(REG))
# 2. the same register a month later: a column added (Branch) and one not used renamed: the saved mapping still reads it
DRIFT = [r[:4] + ["Branch" if i == 0 else "Lucknow"] + r[4:10] + ["Notes" if i == 0 else r[10]] for i, r in enumerate(REG)]
w("purchase_register_drift.csv", csv(DRIFT))
# 3. a real change: the columns renamed: asked again
CHANGED = [["Date", "Voucher No", "Party Name", "Party GSTIN", "Type", "Assessable", "Integrated", "Central", "State", "Gross", "Narration"]] + REG[1:]
w("purchase_register_changed.csv", csv(CHANGED))

# 4. GSTR-2B Excel (the B2B sheet, header on the 6th row as the portal's)
try:
    import openpyxl
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "B2B"
    ws.append(["Goods and Services Tax - GSTR 2B"]); ws.append([]); ws.append(["Taxable inward supplies received from registered persons"]); ws.append([]); ws.append([])
    ws.append(["GSTIN of supplier", "Trade/Legal name", "Invoice number", "Invoice type", "Invoice Date", "Invoice Value(₹)", "Place of supply", "Supply Attract Reverse Charge",
               "Taxable Value (₹)", "Integrated Tax(₹)", "Central Tax(₹)", "State/UT Tax(₹)", "Cess(₹)", "GSTR-1/IFF/GSTR-5 Period", "GSTR-1/IFF/GSTR-5 Filing Date", "ITC Availability", "Reason", "Applicable % of Tax Rate", "Source", "IRN", "IRN Date"])
    ws.append(["09AAACK1234A1Z5", "KASHI IT SOLUTIONS", "KIT/101", "Regular", "05/07/2026", 11800, "Uttar Pradesh", "No", 10000, 0, 900, 900, 0, "Jul'26", "11/08/2026", "Yes", "", "", "", "", ""])
    ws.append(["07AABFD5678B1Z2", "DELHI LEGAL LLP", "DL/77", "Regular", "06/07/2026", 35400, "Uttar Pradesh", "No", 25000, 4500, 0, 0, 0, "Jul'26", "11/08/2026", "Yes", "", "", "", "", ""])
    ws.append(["07AABFD5678B1Z2", "DELHI LEGAL LLP", "DL/77", "Regular", "06/07/2026", 35400, "Uttar Pradesh", "No", 5000, 900, 0, 0, 0, "Jul'26", "11/08/2026", "Yes", "", "", "", "", ""])
    wb.save(os.path.join(HERE, "gstr2b_b2b.xlsx"))
except ImportError:
    pass

# 5. an Amazon-style tax report (sales): two lines of one invoice, a refund
AMZ = [["Seller Gstin", "Invoice Number", "Invoice Date", "Transaction Type", "Order Id", "Ship To State", "Tax Exclusive Gross", "Cgst Tax", "Sgst Tax", "Igst Tax", "Invoice Amount", "Hsn/sac", "Buyer Name"],
       ["09AANFG3202D1ZR", "AMZ-UP-1", "2026-07-03", "Shipment", "403-1", "UTTAR PRADESH", "1000", "90", "90", "0", "1180", "8471", "Asha Rao"],
       ["09AANFG3202D1ZR", "AMZ-UP-1", "2026-07-03", "Shipment", "403-1", "UTTAR PRADESH", "500", "45", "45", "0", "590", "8471", "Asha Rao"],
       ["09AANFG3202D1ZR", "AMZ-DL-2", "2026-07-04", "Shipment", "403-2", "DELHI", "2000", "0", "0", "360", "2360", "8471", "Vikram Shah"],
       ["09AANFG3202D1ZR", "AMZ-DL-2", "2026-07-08", "Refund", "403-2", "DELHI", "-2000", "0", "0", "-360", "-2360", "8471", "Vikram Shah"]]
w("amazon_tax_report.csv", csv(AMZ))

# 6. a PDF table (a supplier's register printed)
try:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.pdfgen import canvas
    c = canvas.Canvas(os.path.join(HERE, "purchase_table.pdf"), pagesize=landscape(A4)); c.setFont("Helvetica", 9)
    xs = [30, 100, 170, 300, 410, 470, 540, 610, 680, 750]
    rows = [["Inv Dt", "Bill No", "Supplier", "GSTIN", "Doc Type", "Taxable Amt", "IGST", "CGST", "SGST", "Total"]] + [r[:10] for r in REG[1:6]]
    y = 520
    for r in rows:
        for x, v in zip(xs, r): c.drawString(x, y, str(v))
        y -= 18
    c.save()
except ImportError:
    pass

# 7. GSTR-1 JSON (the portal's): b2b (one invoice, two rates), b2cs (two rates), cdnr (a credit note), cdnur, exp, hsn and doc (summaries: not posted)
G1 = {"gstin": "09AANFG3202D1ZR", "fp": "072026", "version": "GST3.2", "hash": "hash",
  "b2b": [{"ctin": "09AAACK1234A1Z5", "inv": [{"inum": "S/101", "idt": "05-07-2026", "val": 17400, "pos": "09", "rchrg": "N", "inv_typ": "R",
    "itms": [{"num": 1801, "itm_det": {"rt": 18, "txval": 10000, "camt": 900, "samt": 900, "csamt": 0}}, {"num": 1201, "itm_det": {"rt": 12, "txval": 5000, "camt": 300, "samt": 300, "csamt": 0}}]}]}],
  "b2cs": [{"sply_ty": "INTRA", "pos": "09", "typ": "OE", "rt": 18, "txval": 20000, "camt": 1800, "samt": 1800, "csamt": 0},
           {"sply_ty": "INTRA", "pos": "09", "typ": "OE", "rt": 18, "txval": 1000.50, "camt": 90.05, "samt": 90.05, "csamt": 0},
           {"sply_ty": "INTER", "pos": "07", "typ": "OE", "rt": 5, "txval": 4000, "iamt": 200, "csamt": 0}],
  "cdnr": [{"ctin": "09AAACK1234A1Z5", "nt": [{"ntty": "C", "nt_num": "CN/7", "nt_dt": "20-07-2026", "val": 1180, "pos": "09", "rchrg": "N", "inv_typ": "R",
    "itms": [{"num": 1801, "itm_det": {"rt": 18, "txval": 1000, "camt": 90, "samt": 90, "csamt": 0}}]}]}],
  "cdnur": [{"ntty": "C", "nt_num": "CNU/2", "nt_dt": "22-07-2026", "val": 1050, "typ": "B2CL", "pos": "27",
    "itms": [{"num": 501, "itm_det": {"rt": 5, "txval": 1000, "iamt": 50, "csamt": 0}}]}],
  "exp": [{"exp_typ": "WOPAY", "inv": [{"inum": "EXP/1", "idt": "25-07-2026", "val": 50000, "sbpcode": "INNSA1", "sbnum": "123", "sbdt": "26-07-2026",
    "itms": [{"txval": 50000, "rt": 0, "iamt": 0, "csamt": 0}]}]}],
  "hsn": {"data": [{"num": 1, "hsn_sc": "8471", "uqc": "NOS", "qty": 10, "txval": 15000, "iamt": 0, "camt": 1200, "samt": 1200, "csamt": 0}]},
  "doc_issue": {"doc_det": [{"doc_num": 1, "docs": [{"num": 1, "from": "S/101", "to": "S/101", "totnum": 1, "cancel": 0, "net_issue": 1}]}]}}
w("gstr1.json", json.dumps(G1, indent=1))

# 8. GSTR-2B JSON (the portal's): b2b, a credit note (cdnr), a b2b row with ITC not available (itcavl N, rsn P), impg
G2 = {"chksum": "x", "data": {"gstin": "09AANFG3202D1ZR", "rtnprd": "072026", "version": "1.0", "gendt": "14-08-2026",
  "itcsumm": {}, "docdata": {
    "b2b": [{"ctin": "09AAACK1234A1Z5", "trdnm": "KASHI IT SOLUTIONS", "supfildt": "11-08-2026", "supprd": "072026",
             "inv": [{"inum": "KIT/101", "typ": "R", "dt": "05-07-2026", "val": 11800, "pos": "09", "rev": "N", "itcavl": "Y", "rsn": "", "diffprcnt": 1, "srctyp": "", "irn": "", "irngendate": "",
                      "items": [{"num": 1, "rt": 18, "txval": 10000, "igst": 0, "cgst": 900, "sgst": 900, "cess": 0}], "txval": 10000, "igst": 0, "cgst": 900, "sgst": 900, "cess": 0}]},
            {"ctin": "27AADCM9999M1Z1", "trdnm": "MUMBAI MOVERS PVT LTD", "supfildt": "11-08-2026", "supprd": "072026",
             "inv": [{"inum": "MM/55", "typ": "R", "dt": "10-07-2026", "val": 5900, "pos": "27", "rev": "N", "itcavl": "N", "rsn": "P", "diffprcnt": 1,
                      "txval": 5000, "igst": 0, "cgst": 450, "sgst": 450, "cess": 0}]}],
    "cdnr": [{"ctin": "09AAACK1234A1Z5", "trdnm": "KASHI IT SOLUTIONS", "supfildt": "11-08-2026", "supprd": "072026",
              "nt": [{"ntnum": "KIT/CN/4", "typ": "C", "suptyp": "R", "dt": "09-07-2026", "val": 1180, "pos": "09", "rev": "N", "itcavl": "Y", "rsn": "", "diffprcnt": 1,
                      "txval": 1000, "igst": 0, "cgst": 90, "sgst": 90, "cess": 0}]}],
    "impg": [{"refdt": "15-07-2026", "portcode": "INNSA1", "boenum": "7654321", "boedt": "15-07-2026", "isamd": "N", "txval": 100000, "igst": 18000, "cess": 0}]}}}
w("gstr2b.json", json.dumps(G2, indent=1))

# 9. another portal's own JSON (not the GST portal's): records under data.invoices, with nested amounts
OTHER = {"source": "ShopERP", "data": {"invoices": [
  {"invoice": {"no": "SE-1", "date": "2026-07-11"}, "buyer": {"name": "Ravi Stores", "gstin": "09AAAFR1111R1Z1"}, "amounts": {"net": 8000, "cgst": 720, "sgst": 720, "gross": 9440}},
  {"invoice": {"no": "SE-2", "date": "2026-07-12"}, "buyer": {"name": "Ravi Stores", "gstin": "09AAAFR1111R1Z1"}, "amounts": {"net": 1200.25, "cgst": 108.02, "sgst": 108.02, "gross": 1416.29}}]}}
w("other_portal.json", json.dumps(OTHER, indent=1))

# 10. a vendor's statement of the client's account (their books), in two formats, and a customer's (reconciliation)
VA = [["Kashi IT Solutions", "GSTIN 09AAACK1234A1Z5", "", "", "", ""], ["Statement of account: Testing AAD (GSTIN 09AANFG3202D1ZR)", "", "", "", "", ""], [],
      ["Date", "Vch No", "Particulars", "Debit", "Credit", "GST"],
      ["01/07/2026", "", "Opening Balance", "5,000.00", "", ""],
      ["05/07/2026", "KIT/101", "Sales: laptops", "11,800.00", "", "1,818.00"],
      ["06/07/2026", "DL/77", "Sales: retainer", "35,400.00", "", ""],
      ["09/07/2026", "KIT/CN/4", "Credit note: returned mouse", "", "1,180.00", ""],
      ["12/07/2026", "NEW/9", "Sales: stationery", "2,950.60", "", ""],
      ["15/07/2026", "LF/3", "Late payment fee", "590.00", "", ""],
      ["25/07/2026", "NEFT-UTR77", "Payment received", "", "20,000.00", ""],
      ["26/07/2026", "INV/88", "Sales: repairs", "4,130.00", "", ""],
      ["31/07/2026", "TDS/Q2", "TDS deducted by you", "", "1,000.00", ""],
      ["", "", "Total", "59,870.60", "22,180.00", ""]]
w("vendor_stmt_a.csv", csv(VA))
def bal(x): return "{:,.2f} {}".format(abs(x), "Dr" if x >= 0 else "Cr")
VB = [["Txn Date", "Ref No", "Description", "Amount", "Dr/Cr", "Balance"], ["01-07-2026", "", "Opening Balance", "", "", bal(5000)]]
run = 5000.0
for r in VA[5:13]:
    d = float(r[3].replace(",", "") or 0); c = float(r[4].replace(",", "") or 0); run = round(run + d - c, 2)
    VB.append([r[0].replace("/", "-"), r[1], r[2], "{:,.2f}".format(d or c), "Dr" if d else "Cr", bal(run)])
w("vendor_stmt_b.csv", csv(VB))
CU = [["Date", "Bill No", "Narration", "Dr", "Cr", "Balance"], ["01/07/2026", "", "Opening balance", "", "", "10,000.00 Cr"],
      ["03/07/2026", "S/101", "Purchase", "", "17,400.00", "27,400.00 Cr"], ["19/07/2026", "", "Paid by NEFT", "15,000.00", "", "12,400.00 Cr"]]
w("customer_stmt.csv", csv(CU))
print("made", sorted(os.listdir(HERE)))
