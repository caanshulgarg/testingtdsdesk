"""python3 run_bank_icici_detailed.py - owner, 31-Oct-2026: an ICICI "DETAILED STATEMENT" PDF (corporate net banking,
columns No. | Transaction ID | Value Date | Txn Posted Date | ChequeNo. | Description | Cr/Dr | Transaction Amount(INR) |
Available Balance(INR)) was only half read: 37 of 69 lines, the bank "State Bank of India" (an SBIN IFSC inside a
narration) and no account number.

A MADE-UP statement in the same layouts (built here with reportlab, nothing from a real statement):
  - the transaction id and value date on a line of their own ABOVE the row line, which holds the No., the posted date
    with its time, the Cr/Dr, the amount and the balance (the amount set a little higher, in a smaller type);
  - the transaction id, value date and posted date together above the row line (the No. and the money below);
  - a transaction id of 7 digits on the row line with the value date alone above it;
  - descriptions wrapping above, on and below the row line; a row with no description at all;
  - an IFSC of another bank in the narrations, including the first row's.
Checked on the page's own reader (readStatement, as an upload calls it):
  1. every row is read, in order, with the right Cr/Dr (credits and debits counted and totalled), the running balance
     fitting on every row, the opening and closing balances;
  2. the bank is ICICI Bank from the heading "Transactions List - -<COMPANY> (INR) - <account>", never the bank of an IFSC
     in a narration, and the account number is the heading's;
  3. the narration is in printed order (the lines above the row, the row, the lines below), without the transaction id,
     the dates, the time or the Cr/Dr.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_bank_icici_detailed.py"""
import os, io, base64, datetime, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
from reportlab.pdfgen import canvas
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8467
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

COMPANY, ACCT = "KESTREL LEARNING PRIVATE LIMITED", "123405067890"
PEOPLE = ["RaviKumarSi", "MeenaJoshi", "ArunPrakash", "SunitaRaoKa", "VikramSethi", "NehaGuptaPa", "KaranMalhot", "PoojaVermaD"]
WHAT = ["Reimbursement", "Centre payroll", "Centre advance", "Lab rent", "Vendor payment", "Transport expense", "Training fees"]
BANKS = ["SBIN0004321", "HDFC0001234", "BARB0KESTRL", "PUNB0123400", "IDIB000K042", "CNRB0001111"]
def inr(v):
    s = "%.2f" % v; whole, dec = s.split("."); neg = whole.startswith("-"); whole = whole.lstrip("-")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]; parts = []
        while len(head) > 2: parts.insert(0, head[-2:]); head = head[:-2]
        if head: parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return ("-" if neg else "") + whole + "." + dec

def build_rows(n=64):
    """The made-up transactions and the layout each one is printed in."""
    rows, bal, d = [], 0.0, datetime.date(2026, 9, 25)
    for i in range(n):
        credit = i == 0 or i % 9 == 4 or i == 31                       # the first row is a credit (no balance before it)
        amt = float([200000, 150000, 175000, 90000][i % 4]) if credit else float(400 + (i * 7919) % 98000)
        if not credit and amt >= bal: amt = round(bal / 3)              # never overdrawn
        bal = round(bal + amt if credit else bal - amt, 2)
        layout = "merged" if 18 <= i < 27 else "short" if i == 47 else "plain"
        if credit:
            above, on, below = [], "INF/INFT/0461%08d/to kestrel" % (i * 7331), ["skillin/" + COMPANY[:14]]
            if i == 0: on = "INF/INFT/046100000001/%s/to kes" % BANKS[0]  # an IFSC of another bank in the very first row
        else:
            ifsc = BANKS[i % len(BANKS)]
            above = ["INF/NEFT/IN4262%010d/%s/79" % (i * 104729, ifsc)]
            on, below = "%d /%s /%s" % (300000 + i * 11, WHAT[i % len(WHAT)], PEOPLE[i % len(PEOPLE)]), []
            if i % 11 == 6: below = ["/" + PEOPLE[(i + 3) % len(PEOPLE)].upper()]
        if i == 13: above, on, below = [], "", []                       # a row with no description at all
        rows.append({"no": i + 1, "id": ("S%07d" % (2500000 + i)) if layout == "short" else "S%08d" % (12000000 + i * 977), "date": d,
                     "cd": "CR" if credit else "DR", "amt": amt, "bal": bal, "above": above, "on": on, "below": below, "layout": layout})
        if i % 3 == 2: d += datetime.timedelta(days=1)
    return rows

def make_pdf(rows):
    buf = io.BytesIO(); W, H = 920, 1320
    c = canvas.Canvas(buf, pagesize=(W, H)); c.setTitle("Detailed statement")
    def txt(x, y, s, size=12): c.setFont("Helvetica", size); c.drawString(x, y, s)
    def rtxt(xr, y, s, size=12): c.setFont("Helvetica", size); c.drawRightString(xr, y, s)
    def head():
        c.setFont("Helvetica-Bold", 15); c.drawString(366, 1200, "DETAILED STATEMENT")
        txt(205, 1094, "Transactions List -"); txt(313, 1094, "-%s (INR) - %s" % (COMPANY, ACCT))
        for x, s in [(8, "No."), (38, "Transactio"), (106, "Value Date"), (199, "Txn Posted Date"), (337, "ChequeNo."), (518, "Description"), (695, "Cr/Dr"), (745, "Transaction"), (842, "Available")]: txt(x, 1073, s)
        for x, s in [(58, "n ID"), (739, "Amount(INR)"), (822, "Balance(INR")]: txt(x, 1058, s)
        txt(895, 1043, ")")
    head(); Y = 1003
    for r in rows:
        if Y < 90: c.showPage(); Y = 1282
        dt, posted = r["date"].strftime("%d/%m/%Y"), r["date"].strftime("%d/%m/%Y") + " 06:%02d:%02d PM" % (r["no"] % 60, (r["no"] * 7) % 60)
        for k, s in enumerate(r["above"]): txt(417, Y + 14 + 7 * k, s)
        if r["layout"] == "merged":                      # id, value date and posted date above; the No. and the money below
            txt(40, Y + 7, r["id"]); txt(109, Y + 7, dt); txt(184, Y + 7, posted)
        elif r["layout"] == "short":                     # the value date alone above; a 7-digit id on the row line
            txt(109, Y + 7, dt); txt(40, Y, r["id"]); txt(184, Y, posted)
        else:
            txt(40, Y + 7, r["id"]); txt(109, Y + 7, dt); txt(184, Y, posted)
        if r["on"] and r["cd"] == "CR": txt(417, Y + 7, r["on"])    # a credit's description starts on the id's line
        elif r["on"]: txt(417, Y, r["on"])
        rtxt(22 if r["no"] < 10 else 25, Y, str(r["no"])); txt(369.5, Y, "-")
        txt(704, Y + 0.7, r["cd"], 10); rtxt(819, Y + 0.7, inr(r["amt"]), 10); rtxt(899, Y, inr(r["bal"]))
        for k, s in enumerate(r["below"]): txt(417, Y - 7 - 7 * k, s)
        Y -= 55 + 7 * max(0, len(r["below"]) - 1)
    c.save(); return buf.getvalue()

ROWS = build_rows()
PDF = make_pdf(ROWS)
CR = [r for r in ROWS if r["cd"] == "CR"]
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
    res = pg.evaluate("""async (b64) => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const r = await readStatement(new File([bin], 'detailed-statement.pdf', {type: 'application/pdf'}));
      const rows = r.rows.map(x => Object.assign({}, x)), meta = Object.assign({}, r.meta), chk = checkBalances(rows, meta);
      return {method: r.method, meta, chk, rows: rows.map(x => ({date: x.date, debit: x.debit, credit: x.credit, balance: x.balance, ok: x.balOk, narr: x.narr}))}; }""",
      base64.b64encode(PDF).decode())
    got, meta, chk = res["rows"], res["meta"], res["chk"]
    print("read by: %s; %d rows; meta %s" % (res["method"], len(got), meta))
    print("1. every row, Cr/Dr and the running balance")
    ok(len(got) == len(ROWS), "every row is read: %d of %d" % (len(got), len(ROWS)))
    ok(chk["bad"] == 0 and all(g["ok"] for g in got), "the running balance fits on every row (%d do not)" % chk["bad"])
    same = [i for i, (g, r) in enumerate(zip(got, ROWS)) if g["date"] == r["date"].isoformat() and abs(g["balance"] - r["bal"]) < 0.01 and abs((g["credit"] if r["cd"] == "CR" else g["debit"]) - r["amt"]) < 0.01]
    ok(len(same) == len(ROWS), "each row's date, Cr/Dr, amount and balance as printed (%d of %d; first wrong: %s)" % (len(same), len(ROWS), next((i + 1 for i in range(len(ROWS)) if i not in same), None)))
    gcr = [g for g in got if g["credit"]]
    ok(len(gcr) == len(CR) and abs(sum(g["credit"] for g in gcr) - sum(r["amt"] for r in CR)) < 0.01,
       "%d credits totalling %s (printed: %d, %s)" % (len(gcr), inr(sum(g["credit"] for g in gcr)), len(CR), inr(sum(r["amt"] for r in CR))))
    ok(got and got[0]["credit"] == ROWS[0]["amt"] and not got[0]["debit"], "the first row, with no balance before it, is a credit by its Cr/Dr")
    ok(meta.get("opening") == 0 and abs(meta.get("closing", -1) - ROWS[-1]["bal"]) < 0.01 and chk["summaryOk"], "opening 0.00, closing %s, the totals agree" % inr(ROWS[-1]["bal"]))
    ok(got and got[0]["date"] == "2026-09-25" and got[-1]["date"] == ROWS[-1]["date"].isoformat(), "from 25-Sep-2026 to %s" % ROWS[-1]["date"])
    print("2. the bank and the account from the heading")
    ok(meta.get("bank") == "ICICI Bank", "the bank is ICICI Bank, from the heading (%s)" % meta.get("bank"))
    ok(meta.get("acct") == ACCT, "the account number is the heading's (%s)" % meta.get("acct"))
    ok(not meta.get("ifsc") or meta["ifsc"].startswith("ICIC"), "no IFSC of another bank taken from a narration (%s)" % meta.get("ifsc"))
    print("3. the narration")
    n2, r2 = got[1]["narr"] if len(got) > 1 else "", ROWS[1]
    ok(n2 == " ".join(r2["above"] + [r2["on"]]), "lines above, then the row: %r" % n2)
    n1 = got[0]["narr"] if got else ""
    ok(n1 == ROWS[0]["on"] + " " + ROWS[0]["below"][0], "a credit: the id's line, then the line below: %r" % n1)
    ok(not any(("S%08d" % (12000000 + i * 977)) in g["narr"] or "/2026" in g["narr"] or " PM" in g["narr"] or g["narr"].endswith((" DR", " CR")) for i, g in enumerate(got)),
       "no transaction id, date, time or Cr/Dr in a narration")
    ok(len(got) > 13 and got[13]["narr"] == "" and got[13]["credit" if ROWS[13]["cd"] == "CR" else "debit"] == ROWS[13]["amt"], "the row with no description is read (%r)" % (got[13] if len(got) > 13 else None))
    sh = got[47] if len(got) > 47 else {}
    ok(sh.get("narr") == " ".join(ROWS[47]["above"] + [ROWS[47]["on"]]) and "S2500047" not in sh.get("narr", ""), "the 7-digit transaction id row: %r" % sh.get("narr"))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
