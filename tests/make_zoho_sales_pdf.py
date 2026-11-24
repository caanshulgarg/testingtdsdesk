"""python3 make_zoho_sales_pdf.py OUT.pdf [N] [FIRST] [--heavy] - a made-up PDF of N sales invoices (default 12) laid out the way
Zoho Books prints a B2C service invoice: two pages each (the invoice, then Notes and Terms), "Invoice# ..." at the top
right, the seller's GSTIN in its header, "Bill To" with a name but no GSTIN, "Place Of Supply: Karnataka (29)", SAC lines,
Sub Total, a Discount on some ("Discount(12.70%) (-) 292.00"), CGST9 (9%) and SGST9 (9%), an Adjustment and Rounding on
some, and the Total with the rupee sign.
--heavy puts a large picture on every page (as a scanned logo and seal do), so the file is big: about 100 KB a page.
The invoices are numbered down from ZZ-CW(FIRST + N). The committed fixture is
tests/fixtures/sales-zoho/zoho-sales-12.pdf (python3 make_zoho_sales_pdf.py fixtures/sales-zoho/zoho-sales-12.pdf 12 > fixtures/sales-zoho/zoho-sales-12.json).
Every name and number here is made up. Prints the expected figures as JSON on stdout (one row per invoice)."""
import sys, json, random, os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
pdfmetrics.registerFont(TTFont("ZSans", os.path.join(FONT_DIR, "DejaVuSans.ttf")))
pdfmetrics.registerFont(TTFont("ZSans-Bold", os.path.join(FONT_DIR, "DejaVuSans-Bold.ttf")))

def gstin(body):
    """the check character of a made-up GSTIN (the standard mod-36 rule)"""
    cs = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; s = 0
    for i, ch in enumerate(body):
        v = cs.index(ch) * (2 if i % 2 else 1); s += v // 36 + v % 36
    return body + cs[(36 - s % 36) % 36]

SELLER = "ZZ Sparkle Car Care Pvt Ltd"
SELLER_GSTIN = gstin("29AAZCZ9999Q1Z")
NAMES = ["Asha", "Ravi K", "Meera", "Arjun", "Kavya", "Nikhil", "Divya", "Sanjay", "Pooja", "Rahul", "Sneha", "Varun"]
CARS = ["Hatchback One", "Sedan Two", "SUV Three", "Compact Four"]
SERVICES = [("Foam Wash - Premium", 900.0), ("Interior Detailing", 1800.0), ("Coating Top-up", 1500.0), ("Ceramic Coating", 12000.0)]
NOTE = ("We clean the outside and the inside, vacuum the seats and the floor, and wipe every surface. "
        "A coating keeps the paint shining and makes water roll off.")

def money(a):
    s = "%.2f" % abs(a); whole, frac = s.split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2: parts.insert(0, head[-2:]); head = head[:-2]
        if head: parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return ("-" if a < 0 else "") + whole + "." + frac

def words(n):
    ones = "Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen".split()
    tens = "_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety".split()
    def two(x): return ones[x] if x < 20 else tens[x // 10] + ("" if x % 10 == 0 else " " + ones[x % 10])
    def three(x): return (ones[x // 100] + " Hundred" + (" " + two(x % 100) if x % 100 else "")) if x >= 100 else two(x)
    out = []
    for size, name in ((10000000, "Crore"), (100000, "Lakh"), (1000, "Thousand")):
        if n >= size: out.append(three(n // size) + " " + name); n %= size
    if n: out.append(three(n))
    return " ".join(out) or "Zero"

def noise_image(seed):
    """a made-up picture that does not compress (random pixels): about 100 KB in the PDF"""
    from PIL import Image
    from reportlab.lib.utils import ImageReader
    rnd = random.Random(seed)
    img = Image.new("RGB", (170, 170))
    img.putdata([(rnd.randrange(256), rnd.randrange(256), rnd.randrange(256)) for _ in range(170 * 170)])
    return ImageReader(img)

def make(out, n=12, heavy=False, first=900):
    c = canvas.Canvas(out, pagesize=A4); W, H = A4
    pic = lambda seed: c.drawImage(noise_image(seed), 40, H - 150, width=130, height=100) if heavy else None   # a picture of its own on each page
    rows = []
    for i in range(n):
        no = "ZZ-CW%06d" % (first + n - i)                      # Zoho lists the newest first
        day = 28 - (i % 20)
        date = "%02d/10/2026" % day
        cust = NAMES[i % len(NAMES)]
        svc = [SERVICES[i % len(SERVICES)], ("Pickup and Return", 500.0)] if i % 3 != 2 else [SERVICES[i % len(SERVICES)]]
        sub = round(sum(a for _, a in svc), 2)
        disc = round(sub * [0, 0.127, 0.05, 0.0833][i % 4], 0)   # a discount on three in four, as Zoho prints it
        taxable = round(sub - disc, 2)
        cg = round(taxable * 0.09, 2); sg = cg
        adj = [0.0, 0.0, -5.0, 3.0, 0.0, -2.5][i % 6] if disc else 0.0   # Zoho's "Adjustment", added or taken off after the GST
        raw = round(taxable + cg + sg + adj, 2)
        total = float(round(raw)); rounding = round(total - raw, 2)
        rows.append({"number": no, "date": "2026-10-%02d" % day, "customer": cust, "pos": "29", "taxable": taxable, "cgst": cg, "sgst": sg,
                     "adjustment": adj, "rounding": rounding, "total": total})
        # page 1: the invoice
        R = W - 40
        pic(2 * i + 1)
        c.setFont("ZSans-Bold", 20); c.drawRightString(R, H - 60, "INVOICE")
        c.setFont("ZSans", 9); c.drawRightString(R, H - 76, "Invoice# " + no)
        c.drawRightString(R, H - 100, "Balance Due"); c.setFont("ZSans-Bold", 11); c.drawRightString(R, H - 114, "₹0.00")
        c.setFont("ZSans-Bold", 10); c.drawString(40, H - 170, SELLER)
        c.setFont("ZSans", 8)
        for k, t in enumerate([SELLER, "No. 1 Made Up Road, Test Layout, Bengaluru", "90000 00000, 90000 00001", "hello@example.invalid www.example.invalid", "Gst - " + SELLER_GSTIN]):
            c.drawString(40, H - 182 - 11 * k, t)
        y = H - 260
        c.drawRightString(R - 110, y, "Invoice Date :"); c.drawRightString(R, y, date)
        c.setFont("ZSans", 9); c.drawString(40, y - 12, "Bill To")
        c.setFont("ZSans-Bold", 9); c.drawString(40, y - 24, cust)
        c.setFont("ZSans", 8); c.drawRightString(R - 110, y - 24, "Terms :"); c.drawRightString(R, y - 24, "Due on Receipt")
        c.drawString(40, y - 35, ",")
        c.drawString(40, y - 46, "Contact Number - 90000 0%04d" % (i + 11)); c.drawRightString(R - 110, y - 46, "Due Date :"); c.drawRightString(R, y - 46, date)
        c.drawString(40, y - 57, "Vehicle Model - " + CARS[i % len(CARS)])
        c.drawString(40, y - 68, "Vehicle Number - ZZ00AA%04d" % (i + 1)); c.drawRightString(R - 110, y - 68, "P.O.# :"); c.drawRightString(R, y - 68, "SO-%05d" % (100 + i))
        c.drawString(40, y - 92, "Place Of Supply: Karnataka (29)")
        y -= 120
        c.setFont("ZSans-Bold", 8); c.drawString(44, y, "#"); c.drawString(70, y, "Service & Description"); c.drawRightString(R, y, "Amount")
        c.setFont("ZSans", 8)
        for k, (d, a) in enumerate(svc):
            y -= 16; c.drawString(44, y, str(k + 1)); c.drawString(70, y, d); c.drawRightString(R, y, money(a))
            if k == 0:
                for part in (NOTE[:NOTE.index(" A coating")], NOTE[NOTE.index(" A coating") + 1:]):
                    y -= 11; c.drawString(70, y, part)
            y -= 16; c.drawString(70, y, "SAC: 998539")
        y -= 26
        tot = [("Sub Total", money(sub))]
        if disc: tot.append(("Discount(%.2f%%)" % (disc / sub * 100) if i % 4 != 2 else "Discount", "(-) " + money(disc)))   # with its rate, mostly
        tot += [("CGST9 (9%)", money(cg)), ("SGST9 (9%)", money(sg))]
        if adj: tot.append(("Adjustment", ("(-) " if adj < 0 else "") + money(abs(adj))))
        if rounding: tot.append(("Rounding", money(rounding)))
        for lab, a in tot:
            c.drawRightString(R - 110, y, lab); c.drawRightString(R, y, a); y -= 18
        c.setFont("ZSans-Bold", 9); c.drawRightString(R - 110, y, "Total"); c.drawRightString(R, y, "₹" + money(total)); y -= 18
        c.setFont("ZSans", 8); c.drawRightString(R - 110, y, "Payment Made"); c.drawRightString(R, y, "(-) " + money(total)); y -= 22
        c.setFont("ZSans-Bold", 8); c.drawRightString(R - 110, y, "Balance Due"); c.drawRightString(R, y, "₹0.00"); y -= 30
        c.setFont("ZSans", 8); c.drawRightString(R, y, "Total In Words: Indian Rupee " + words(int(total)) + " Only")
        c.drawRightString(W - 20, 30, "1")
        c.showPage()
        # page 2: notes and terms
        pic(2 * i + 2)
        c.setFont("ZSans", 9); c.drawString(40, H - 190, "Notes")
        c.setFont("ZSans", 8); c.drawString(40, H - 204, "Thank you.")
        c.setFont("ZSans", 9); c.drawString(40, H - 240, "Terms & Conditions")
        c.setFont("ZSans", 8)
        for k, t in enumerate(["-Made-up terms for a test.", "-Payment is due on receipt.",
                               "-Nothing here is a real business."]):
            c.drawString(40, H - 254 - 11 * k, t)
        c.drawRightString(W - 20, 30, "2")
        c.showPage()
    c.save()
    return rows

if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    rows = make(a[0], int(a[1]) if len(a) > 1 else 12, "--heavy" in sys.argv, int(a[2]) if len(a) > 2 else 900)
    print(json.dumps(rows, indent=1))
