"""make_uploads.make(dir) - MADE-UP files of each kind for the Assistant's Upload (the owner's request of 14-Oct-2026),
written at test time (nothing binary kept in the repository). Nothing in them is real: the company is the made-up one of
tests/fixtures/books (Larkspur Fixture Events, GSTIN 07AAGCL4827M1Z3); the others are made-up names and numbers.
  bill.pdf             a tax invoice made out to the company (a purchase)          -> bill, by FinCom's rules
  sales-register.xlsx  a sheet of invoices (number, date, party, GSTIN, amounts)   -> register, by the rules
  bank-statement.csv   a bank statement (HDFC headings)                            -> bank, by the rules
  26as.txt             Form 26AS as TRACES exports it as text                      -> 26AS, by the rules
  certificate-format.docx  a net worth certificate with blanks                     -> certificate, by the rules
  agreement.docx       a rent agreement (no rule knows it)                         -> the AI is asked
  photo.png            a picture (no text FinCom reads)                            -> the AI is asked
  gstr2b-032026.json   GSTR-2B as the GST portal gives it (JSON)                   -> register, by the rules
  notice-copy.pdf      the made-up ASMT-10 notice again, in the same batch          -> notice, by the rules"""
import os, json, shutil, zipfile, struct, zlib
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
import openpyxl

def bill(path):
    c = canvas.Canvas(path, pagesize=A4, invariant=1); y = 800
    for t in ["MADE-UP TEST DOCUMENT", "TAX INVOICE", "Ashvattha Tent House (made-up)", "GSTIN: 07AAAPA1234B1Z5",
              "Invoice No: ATH/25-26/0142", "Invoice Date: 12-02-2026", "Bill To: Larkspur Fixture Events Private Limited", "GSTIN: 07AAGCL4827M1Z3",
              "Tent and lighting hire, February 2026      Taxable value 40,000.00", "CGST 9% 3,600.00   SGST 9% 3,600.00", "Total 47,200.00"]:
        c.drawString(50, y, t); y -= 18
    c.save()

def register(path):
    wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Sales"
    ws.append(["Made-up sales register (test)"]); ws.append([])
    ws.append(["Invoice No", "Invoice Date", "Party Name", "GSTIN", "Taxable Value", "IGST", "Total"])
    for i, (p, g, v) in enumerate([("Quillfeather Weddings LLP", "09AACCQ1111A1Z1", 100000), ("Marigold Expo Services", "07AACCM2222B1Z2", 50000),
                                    ("Brindle Corporate Travels", "06AACCB3333C1Z3", 25000), ("Orchid Lane Hospitality Pvt Ltd", "09AACCO6624H1ZC", 75000)]):
        ws.append(["LFE/25-26/%03d" % (i + 20), "1%d-02-2026" % i, p, g, v, round(v * 0.18, 2), round(v * 1.18, 2)])
    wb.save(path)

def bank(path):
    open(path, "w").write("Statement of Account (made-up)\nHDFC Bank\nAccount No: 50100123456789\nIFSC: HDFC0001234\nStatement From: 01/02/2026 To: 28/02/2026\n\n"
        "Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n"
        "01/02/2026,NEFT CR QUILLFEATHER WEDDINGS,N0123,01/02/2026,,50000.00,150000.00\n"
        "05/02/2026,NEFT DR ASHVATTHA TENT HOUSE,N0124,05/02/2026,47200.00,,102800.00\n"
        "10/02/2026,CHQ PAID RUKMINI S,000123,10/02/2026,20000.00,,82800.00\n")

def as26(path):
    open(path, "w").write("Annual Tax Statement under Section 203AA of the Income Tax Act, 1961 (made-up test file)^\n"
        "Permanent Account Number (PAN)^Current Status of PAN^Financial Year^Assessment Year^Name of Assessee\n"
        "AAGCL4827M^Active^2025-26^2026-27^LARKSPUR FIXTURE EVENTS PRIVATE LIMITED\n"
        "PART-I - Details of Tax Deducted at Source^\n"
        "Sr. No.^Name of Deductor^TAN of Deductor^^^Total Amount Paid / Credited^Total Tax Deducted^Total TDS Deposited\n"
        "1^QUILLFEATHER WEDDINGS LLP^DELQ12345A^^^100000.00^2000.00^2000.00\n"
        "^Sr. No.^Section^Transaction Date^Status of Booking^Date of Booking^Remarks^Amount Paid / Credited^Tax Deducted^TDS Deposited\n"
        "^1^194C^15-Feb-2026^F^31-May-2026^-^100000.00^2000.00^2000.00\n")

def docx(path, paras):
    body = "".join("<w:p><w:r><w:t xml:space=\"preserve\">%s</w:t></w:r></w:p>" % p.replace("&", "&amp;").replace("<", "&lt;") for p in paras)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + "</w:body></w:document>")

def png(path):
    w, h = 40, 30
    raw = b"".join(b"\x00" + bytes([200, 220, 240]) * w for _ in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))

def gstr2b(path):
    open(path, "w").write(json.dumps({"chksum": "made-up", "data": {"gstin": "07AAGCL4827M1Z3", "rtnprd": "032026", "version": "1.0", "gendt": "14-04-2026", "docdata": {"b2b": [
        {"ctin": "07AAAPA1234B1Z5", "trdnm": "ASHVATTHA TENT HOUSE (MADE-UP)", "inv": [{"inum": "ATH/25-26/0150", "dt": "05-03-2026", "val": 47200, "txval": 40000, "cgst": 3600, "sgst": 3600}]},
        {"ctin": "09AACCO6624H1ZC", "trdnm": "ORCHID LANE (MADE-UP)", "inv": [{"inum": "OL/88", "dt": "10-03-2026", "val": 11800, "txval": 10000, "igst": 1800},
                                                                              {"inum": "OL/91", "dt": "20-03-2026", "val": 5900, "txval": 5000, "igst": 900}]}]}}}))

def make(d):
    os.makedirs(d, exist_ok=True)
    out = {k: os.path.join(d, k) for k in ["bill.pdf", "sales-register.xlsx", "bank-statement.csv", "26as.txt", "certificate-format.docx", "agreement.docx", "photo.png"]}
    bill(out["bill.pdf"]); register(out["sales-register.xlsx"]); bank(out["bank-statement.csv"]); as26(out["26as.txt"])
    docx(out["certificate-format.docx"], ["NET WORTH CERTIFICATE (format, made-up test document)", "This is to certify that M/s ____________ having PAN [PAN] has a net worth of Rs. ____________ as on [Date].",
                                         "For [Firm name], Chartered Accountants", "UDIN: ____________"])
    docx(out["agreement.docx"], ["RENT AGREEMENT (made-up test document)", "This agreement is made at New Delhi between Rukmini Sethuraman (the owner) and Larkspur Fixture Events Private Limited (the tenant).",
                                 "The godown at Plot 7 (made-up) is let for eleven months at a rent of Rs. 20,000 a month."])
    png(out["photo.png"])
    out["gstr2b-032026.json"] = os.path.join(d, "gstr2b-032026.json"); gstr2b(out["gstr2b-032026.json"])
    out["notice-copy.pdf"] = os.path.join(d, "notice-copy.pdf"); shutil.copyfile(os.path.join(os.path.dirname(os.path.abspath(__file__)), "asmt10-notice.pdf"), out["notice-copy.pdf"])
    return out

if __name__ == "__main__":
    import sys; print(make(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "out", "uploads")))
