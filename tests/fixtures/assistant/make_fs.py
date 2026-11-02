"""Two made-up financial statements as PDFs (a draft and the final of one year), for comparing them in Ask FinCom
(tests/run_assistant_attach.py, tests/run_assistant_ui.py). A made-up company; no real client's figures."""

def fs_pdf(path, version):
    """A made-up company's balance sheet and statement of profit and loss (and a page of notes, which is not compared)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    a = version == "draft"
    bs = [("EQUITY AND LIABILITIES", None, None, None), ("Shareholders' funds", None, None, None),
          ("(a) Share capital", "1", "10,00,000", "10,00,000"), ("(b) Reserves and surplus", "2", "24,50,000" if a else "23,66,000", "18,20,000"),
          ("Current liabilities", None, None, None)]
    if not a: bs.append(("(a) Short-term borrowings", "3", "2,00,000", "-"))
    bs += [("(b) Trade payables", "4", "8,40,000", "7,10,000"), ("(c) Other current liabilities", "5", "1,60,000", "1,25,000"),
           ("TOTAL", None, "44,50,000" if a else "45,66,000", "36,55,000"),
           ("ASSETS", None, None, None), ("Non-current assets", None, None, None), ("(a) Property, plant and equipment", "6", "15,00,000", "12,40,000"),
           ("Current assets", None, None, None), ("(a) Inventories", "7", "9,80,000" if a else "9,20,000", "8,30,000"),
           ("(b) Trade receivables", "8", "12,00,000" if a else "13,50,000", "10,15,000"), ("(c) Cash and cash equivalents", "9", "7,70,000" if a else "7,96,000", "5,70,000"),
           ("TOTAL", None, "44,50,000" if a else "45,66,000", "36,55,000")]
    pl = [("Revenue from operations", "10", "96,00,000", "81,00,000"), ("Other income", "11", "40,000", "25,000"), ("Total income", None, "96,40,000", "81,25,000"),
          ("Expenses", None, None, None), ("Purchases of stock-in-trade", "12", "70,20,000", "60,10,000"),
          ("Changes in inventories of stock-in-trade", "13", "(1,50,000)" if a else "(90,000)", "(40,000)"), ("Employee benefits expense", "14", "9,60,000", "8,40,000"),
          ("Other expenses", "15", "9,10,000" if a else "9,70,000", "8,05,000"), ("Total expenses", None, "87,40,000" if a else "88,60,000", "76,15,000"),
          ("Profit before tax", None, "9,00,000" if a else "7,80,000", "5,10,000"), ("Tax expense", None, "2,70,000" if a else "2,34,000", "1,53,000"),
          ("Profit for the year", None, "6,30,000" if a else "5,46,000", "3,57,000")]
    c = canvas.Canvas(path, pagesize=A4)
    def page(title, rows):
        y = 800
        c.setFont("Helvetica-Bold", 13); c.drawString(60, y, "Example Lantern Traders Private Limited"); y -= 20
        c.setFont("Helvetica-Bold", 12); c.drawString(60, y, title); y -= 16
        c.setFont("Helvetica", 9); c.drawString(60, y, "(All amounts in Rupees)"); y -= 22
        c.setFont("Helvetica-Bold", 10); c.drawString(60, y, "Particulars"); c.drawString(330, y, "Note"); c.drawRightString(450, y, "31-03-2025"); c.drawRightString(540, y, "31-03-2024"); y -= 18
        for label, note, cy, py in rows:
            c.setFont("Helvetica-Bold" if cy is None or label == "TOTAL" else "Helvetica", 10)
            c.drawString(60, y, label)
            if note: c.drawString(335, y, note)
            if cy: c.drawRightString(450, y, cy)
            if py: c.drawRightString(540, y, py)
            y -= 17
        c.showPage()
    page("Balance Sheet as at 31 March 2025", bs)
    page("Statement of Profit and Loss for the year ended 31 March 2025", pl)
    c.setFont("Helvetica-Bold", 12); c.drawString(60, 800, "Notes forming part of the financial statements")
    c.setFont("Helvetica", 10); c.drawString(60, 770, "1 Share capital"); c.drawRightString(450, 770, "99,99,999" if a else "11,11,111"); c.showPage()
    c.save()
