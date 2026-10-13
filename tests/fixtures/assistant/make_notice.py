"""python3 make_notice.py - a MADE-UP GST notice (Form GST ASMT-10) to the made-up company of tests/fixtures/books, for the
FinCom Assistant tests: asmt10-notice.pdf. Nothing in it is real. The officer says the input tax in GSTR-3B for February
2026 (11,000) is more than GSTR-2B (5,400) by 5,600; the books show the 5,600 is reverse-charge credit (freight 2,000 and
godown rent 3,600), which is never in 2B. The expected fields are in notice-expected.json."""
import os, json
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
HERE = os.path.dirname(os.path.abspath(__file__))
c = canvas.Canvas(os.path.join(HERE, "asmt10-notice.pdf"), pagesize=A4, invariant=1)
c.setTitle("FORM GST ASMT-10 (made-up test notice)")
y = 800
def line(t, size=10, bold=False, dy=15):
    global y
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size); c.drawString(50, y, t); y -= dy
line("MADE-UP TEST DOCUMENT - NOT A REAL NOTICE", 8, dy=18)
line("FORM GST ASMT-10", 14, True, 20)
line("[See rule 99]", 9, dy=18)
line("Notice for intimating discrepancies in the return after scrutiny", 11, True, 20)
line("Reference No.: ZD0711260123456 (test)                         Date: 20-Oct-2026")
line("To: Larkspur Fixture Events Private Limited")
line("GSTIN: 07AAGCL4827M1Z3")
line("Tax period: February 2026      Financial year: 2025-26", dy=22)
line("Subject: Scrutiny of returns under section 61 of the CGST Act, 2017 read with rule 99", 10, True, 20)
line("1. Your return GSTR-3B for February 2026 has been scrutinised with reference to the information available.")
line("2. Input tax credit availed in GSTR-3B, table 4(A): Rs. 11,000.00 (CGST 5,500.00 + SGST 5,500.00).")
line("3. Input tax credit available as per GSTR-2B for the same period: Rs. 5,400.00 (CGST 2,700.00 + SGST 2,700.00).")
line("4. Excess input tax credit availed: Rs. 5,600.00, together with interest under section 50.", dy=22)
line("You are hereby directed to explain the reasons for the aforesaid discrepancy by 15-Nov-2026.")
line("If no explanation is received by the said date, it will be presumed that you have nothing to say and")
line("proceedings under section 73 may be initiated without further reference to you.", dy=26)
line("Proper Officer, Ward 7 (test), Delhi")
c.showPage(); c.save()
json.dump({"form": "ASMT-10", "law": "GST", "section": "61", "rule": "99", "amount": 5600, "reply_by": "2026-11-15", "periods": ["2026-02"], "gstin": "07AAGCL4827M1Z3",
           "check": {"tool": "itc_vs_2b", "from": "2026-02-01", "to": "2026-02-28", "books": 5400, "twob": 5400, "rcm_credit": 5600}},
          open(os.path.join(HERE, "notice-expected.json"), "w"), indent=1)

# a MADE-UP intimation of a proposed adjustment under section 143(1)(a) for a TDS-credit mismatch: the ITR for AY 2026-27
# claimed TDS of 15,000; Form 26AS shows 13,000; 2,000 is proposed to be disallowed. The books (assistant_stand.add_notice_data)
# show the 2,000 was deducted by Vellichor Learning Foundation, which is not in the client's 26AS.
c = canvas.Canvas(os.path.join(HERE, "it-143-1a-notice.pdf"), pagesize=A4, invariant=1)
c.setTitle("Intimation u/s 143(1)(a) (made-up test notice)")
y = 800
line("MADE-UP TEST DOCUMENT - NOT A REAL NOTICE", 8, dy=18)
line("INCOME TAX DEPARTMENT - CENTRALIZED PROCESSING CENTRE (TEST)", 12, True, 20)
line("Communication u/s 143(1)(a) of the Income-tax Act, 1961: proposed adjustment", 11, True, 20)
line("PAN: AAGCL4827M        Assessment Year: 2026-27        Communication reference: CPC/2627/A1/123456789")
line("Document Identification Number (DIN): CPC/2627/G22/9876543210        Date: 05-Oct-2026")
line("Name: Larkspur Fixture Events Private Limited", dy=22)
line("1. Your return of income for AY 2026-27 has been processed with reference to the information available.")
line("2. Credit for tax deducted at source claimed in the return: Rs. 15,000.")
line("3. Credit as per Form 26AS / TDS statements: Rs. 13,000.")
line("4. It is proposed to allow credit of Rs. 2,000 less than claimed (mismatch in TDS credit).", dy=22)
line("You may respond online within 30 days of this communication, i.e. by 04-Nov-2026, agreeing or disagreeing")
line("with the proposed adjustment. If no response is received, the return will be processed with the adjustment.", dy=26)
line("Centralized Processing Centre (test), Bengaluru")
c.showPage(); c.save()
json.dump({"form": "143(1)(a)", "law": "Income tax", "kind": "it_143_1a", "pan": "AAGCL4827M", "ay": "2026-27", "fy": "2025-26", "din": "CPC/2627/G22/9876543210",
           "reference": "CPC/2627/A1/123456789", "amount": 2000, "reply_by": "2026-11-04", "notice_date": "2026-10-05",
           "check": {"tool": "tds_vs_26as", "books": 15000, "in26as": 13000, "diff": -2000, "missing_party": "Vellichor Learning Foundation"}},
          open(os.path.join(HERE, "notice-143-expected.json"), "w"), indent=1)
print("made asmt10-notice.pdf and it-143-1a-notice.pdf")
