"""python3 run_uploadpage_simple.py - the Tally data upload page, simpler (FinCom 2.4.0; the owner, 08-Oct-2026: "change
the data xml upload page.. it is too much crowded.. simplify it.. whatever is necessary should remain.. extra fields should
be removed"). Books -> From Tally is one short flow:
  1. one status line: "Books from Tally: FY 2025-26 · entries up to 31-Mar-2026 · N days need a Day Book";
  2. "Upload Tally data": one control (the top bar's Upload Tally data and the drop area on the page open the same file
     box, #tallyIn) that takes a Day Book XML, ledger masters XML or a trial balance XML, tells which by its content and
     the dates from the file itself; the progress line; the result in plain words;
  3. "Days that need a Day Book" (the shared classifier Rec.needKind, the gaps between the files), each with its Upload,
     which takes only that day from the file (the period guard);
  4. "How to export from Tally", folded, three steps.
The safeguards stay: an empty file, a file cut short, a file of no known kind, a file with no entries for the day asked
are refused and change nothing; a Day Book uploaded again replaces its days, nothing doubled.
The made-up client of uploadpage_setup.py, offline, the React test build (app/dist-test).
Run: TDSDESK_SITE=../app/dist-test python3 run_uploadpage_simple.py"""
import os, re, sys
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import uploadpage_setup as U
from books_data import OUT
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def write(name, data):
    p = os.path.join(OUT, name); open(p, "wb").write(data); return p
JUL, JUL_N = U.month_file("202507")
EMPTY = write("empty.xml", b"")
NOTALLY = write("notes.xml", b"<?xml version='1.0'?><notes><note>hello</note></notes>")
raw = open(JUL, "rb").read(); CUT = write("DayBook-cut.xml", raw[: (len(raw) * 2 // 3) // 2 * 2])
TB = write("TB.xml", ("<ENVELOPE><DSPACCNAME><DSPDISPNAME>Capital Account</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA></DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA>500.00</DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO>"
                      "<DSPACCNAME><DSPDISPNAME>Cash</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA>-1000.00</DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA></DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO></ENVELOPE>").encode())
with sync_playwright() as p:
    srv, br, pg = U.start(p, 8399, SITE, errors=errors)
    E = pg.evaluate
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    def idle(sec=60):
        for _ in range(sec * 4):
            pg.wait_for_timeout(250)
            if E("!S.books.busy && !(S.tallyUp && S.tallyUp.busy)"): break
        pg.wait_for_timeout(300)
    def up(path):
        E("() => { S.tallyUp = null; }"); pg.set_input_files("#tallyIn", path); pg.wait_for_timeout(500); idle()
        return txt("#app [data-up-result]")

    # ---------------------------------------------------------------- 1. the page: one status line, four parts
    cid = U.open_page(pg, "owner")
    st = txt("#app [data-up-status]")
    ok(st.startswith("Books from Tally: FY 2025-26 · entries up to 31-Mar-2026 · ") and re.search(r"· 33 days need a Day Book$", st), "1. one status line (%s)" % st)
    ok(pg.locator("#app [data-up-status]").count() == 1, "1. exactly one status line")
    heads = E("() => [...document.querySelectorAll('#app [data-upload-page] h3')].map(h => h.innerText.trim())")
    ok(heads[:2] == ["Upload Tally data", "Days that need a Day Book"], "the parts in order: Upload Tally data, Days that need a Day Book (%s)" % heads)
    ok(txt("#app details[data-howto] summary") == "How to export from Tally" and pg.locator("#app details[data-howto] li").count() == 3
       and not E("document.querySelector('#app details[data-howto]').open"), "How to export from Tally: folded, three steps")
    t = txt("#app")
    gone = ["Setting up", "Or bring in files", "Registrations in the file", "Part brought in", "Bridge’s copy", "Balances as on", "Choose the ledger masters XML", "Choose the trial balance XML", "Read on"]
    ok(not [g for g in gone if g in t], "the extra fields are gone (%s)" % [g for g in gone if g in t])
    ok(pg.locator('#app input[type="date"]').count() == 0 and pg.locator('#app input[type="time"]:visible').count() == 0, "no date or time boxes on the page (the dates come from the file)")
    ok(pg.locator("#app [data-books-held], #app .bk-warn, #app [data-alert-line]").count() == 0, "no second yellow box or alert line repeating the days")
    ok("3 ledgers differ from Tally’s trial balance as on 31-Mar-2026" in txt("#app [data-tieout]"), "the tie-out result kept, in one line (%s)" % txt("#app [data-tieout]"))
    ok(pg.locator('#app [data-more="books"]').count() == 1, "the removals and Restore stay under one More")

    # ---------------------------------------------------------------- 2. one control, the progress line
    top = pg.locator("#cobar [data-upload]")
    ok(top.count() == 1 and top.inner_text().strip() == "Upload Tally data" and top.get_attribute("data-upload") == "daybook", "the top bar's one Upload: Upload Tally data")
    for sel in ["#cobar [data-upload]", "#app [data-up-drop]"]:
        E("() => { window.__clicked = ''; const el = document.getElementById('tallyIn'); el.click = () => { window.__clicked = 'tallyIn'; }; }")
        pg.click(sel); pg.wait_for_timeout(200)
        ok(E("window.__clicked") == "tallyIn", "%s opens the one file box (#tallyIn)" % sel)
    E("() => { delete document.getElementById('tallyIn').click; }")
    ok(E("document.getElementById('tallyIn').accept") == ".xml" and E("document.getElementById('tallyIn').multiple"), "the file box takes XML, one file or more")
    pr = txt("#app [data-up-card] [data-up-progress]")
    ok("DayBook-2026-27.xml" in pr and "42%" in pr and pg.locator("#app [data-up-card] [data-upload-bar]").count() == 1, "the progress line and bar inside the upload part (%s)" % pr)
    ok("Day Book 2026-27: 143 of 365 days read" in pr, "the server's job line: Day Book 2026-27: 143 of 365 days read")
    ok("MB" not in pr, "no technical counters in the line (MB only on hover)")

    # ---------------------------------------------------------------- 3. a Day Book month, detected; uploaded again: nothing doubled
    n0 = E("S.books.vouchers.length")
    dates = E("() => S.books.vouchers.filter(v => v.date.startsWith('202507')).map(v => v.date).sort()")
    E("() => { S.dbFrom = ''; S.dbTo = ''; }")
    res = up(JUL)
    f, l = (E("(d) => fmtDate(tallyDate(d))", dates[0]), E("(d) => fmtDate(tallyDate(d))", dates[-1])) if dates else ("", "")
    ok(re.search(r"^Read %d entr(y|ies) for %s to %s; \d+ days? updated" % (JUL_N, re.escape(f), re.escape(l)), res) is not None, "a Day Book month: the result in plain words (%s)" % res)
    ok(E("S.tallyUp.lines[0].kind") == "daybook", "detected as a Day Book by its content")
    ok(E("S.books.vouchers.length") == n0, "the month uploaded again replaces its days: nothing doubled (%d -> %d)" % (n0, E("S.books.vouchers.length")))
    ok(E("S.books.meta.parts.some(p => p.file === 'DayBook-202507.xml')"), "the file's own dates kept as the part brought in")
    # ---------------------------------------------------------------- 4. the ledger masters, detected
    E("() => { S.books.ledInfoAt = null; S.books.ledInfo = {}; }")
    res = up(U.MASTER)
    ok(re.search(r"^Read the ledger masters: \d+ ledgers", res) is not None and E("S.tallyUp.lines[0].kind") == "masters" and E("!!S.books.ledInfoAt"), "a Master XML: detected and read (%s)" % res)
    # ---------------------------------------------------------------- 5. the safeguards
    for path, words, what in [(EMPTY, "is empty", "an empty file"), (NOTALLY, "is not a Tally", "a file of no known kind"), (CUT, "cut short", "a Day Book cut short")]:
        n1 = E("S.books.vouchers.length"); res = up(path)
        ok(words in res and E("S.tallyUp.lines[0].ok") is False and E("S.books.vouchers.length") == n1, "%s is refused, nothing changed (%s)" % (what, res))
    # a trial balance: its date is not in the file, so it is asked (with the books' own default)
    res = up(TB)
    ok(pg.locator("#app [data-tb-ask]").count() == 1 and pg.input_value("#app [data-tb-ask] input[type=date]") == "2026-03-31", "a trial balance: asked only its date, the books' last date offered")
    pg.fill("#app [data-tb-ask] input[type=date]", "2025-03-31"); pg.click("#app [data-tb-ask] button:has-text('Use as opening balances')"); pg.wait_for_timeout(1500)
    ok("TB.xml" in E("S.books.tb.source || ''") and E("S.books.tb.openAsOn") == "20250331" and pg.locator("#app [data-tb-ask]").count() == 0, "used as opening balances as on 31-Mar-2025")

    # ---------------------------------------------------------------- 6. Days that need a Day Book
    U.open_page(pg, "owner")
    rows = E("() => [...document.querySelectorAll('#app [data-need-day]')].map(r => [r.getAttribute('data-need-day'), r.innerText.replace(/\\s+/g, ' ').trim()])")
    keys = [r[0] for r in rows]
    ok("2026-10-06" in keys and "2026-10-07" in keys and "2025-08-01" in keys, "each day (the shared classifier) and the month between the files (%s)" % keys)
    d7 = [r[1] for r in rows if r[0] == "2026-10-07"]
    ok(d7 and "07-Oct-2026" in d7[0] and "2 entries" in d7[0] and d7[0].endswith("Upload"), "a day: its date, what waits, its Upload (%s)" % d7)
    E("() => { window.__clicked = ''; const el = document.getElementById('tallyIn'); el.click = () => { window.__clicked = 'tallyIn'; }; }")
    pg.click('#app [data-need-day="2026-10-07"] button'); pg.wait_for_timeout(300)
    ok(E("window.__clicked") == "tallyIn" and E("[S.dbFrom, S.dbTo]") == ["2026-10-07", "2026-10-07"], "its Upload opens the one file box for that day only")
    ok("07-Oct-2026" in txt("#app [data-up-limit]"), "the upload part says only that day is taken (%s)" % txt("#app [data-up-limit]"))
    E("() => { delete document.getElementById('tallyIn').click; }")
    n1 = E("S.books.vouchers.length"); pg.set_input_files("#tallyIn", JUL); pg.wait_for_timeout(500); idle(); res = txt("#app [data-up-result]")
    ok("no entries for 07-Oct-2026" in res and E("S.books.vouchers.length") == n1, "the period guard: a file without that day is refused, nothing replaced (%s)" % res)
    # a range from the gap rows: only those dates, never days the file does not cover
    E("() => { S.dbFrom = '2025-07-10'; S.dbTo = '2025-07-31'; render(); }")
    n1 = E("S.books.vouchers.length"); pg.set_input_files("#tallyIn", JUL); pg.wait_for_timeout(500); idle(); res = txt("#app [data-up-result]")
    inside = [d for d in dates if d >= "20250710"]
    part = E("S.books.meta.parts.find(p => p.file === 'DayBook-202507.xml')") or {}
    ok(part.get("from") == (inside[0] if inside else "") and part.get("to") == dates[-1] and E("S.books.vouchers.length") == n1, "a range: only its dates the file covers are replaced (%s)" % part)
    ok(E("[S.dbFrom, S.dbTo]") == ["", ""] and pg.locator("#app [data-up-limit]").count() == 0, "the day limit is cleared once used")
    # the month between the files, with a file that runs past both its ends: taken for exactly those dates; the row goes
    n1 = E("S.books.vouchers.length")
    pg.click('#app [data-need-day="2025-08-01"] button'); pg.wait_for_timeout(200)
    pg.set_input_files("#tallyIn", U.DAYBOOK); pg.wait_for_timeout(500); idle(); res = txt("#app [data-up-result]")
    ok(res.startswith("Read ") and "01-Aug-2025 to 31-Aug-2025; 31 days updated" in res and E("S.books.vouchers.length") == n1, "the gap's Upload with the year's file: only August replaced (%s)" % res)
    ok(pg.locator('#app [data-need-day="2025-08-01"]').count() == 0, "the month between the files no longer needs a Day Book")

    # ---------------------------------------------------------------- 7. phone width: no sideways scroll
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(800)
    sw = E("() => [document.documentElement.scrollWidth, window.innerWidth]")
    ok(sw[0] <= sw[1], "phone width: no sideways scroll (%s)" % sw)
    ok(pg.locator("#app [data-up-drop]").is_visible() and pg.locator("#app [data-need-day] button").first.is_visible(), "phone: the drop area and each day's Upload are on screen")
    pg.set_viewport_size({"width": 1366, "height": 900})

    # ---------------------------------------------------------------- 8. staff: the same page, the same controls
    def controls():
        return E("() => [...document.querySelectorAll('#app [data-upload-page] button, #app [data-upload-page] [role=button], #cobar [data-upload]')].map(b => (b.innerText || '').trim()).filter(Boolean).sort()")
    U.open_page(pg, "owner"); own = controls()
    U.open_page(pg, "staff"); stf = controls()
    ok(own == stf and "Upload" in stf, "staff see the same upload, days and More as an owner (%s)" % stf)
    ok(txt("#app [data-up-status]").startswith("Books from Tally: FY 2025-26"), "staff: the status line")
    ok(E("window.__rpc.length") == 0, "nothing asked of Tally by the page (%s)" % E("window.__rpc"))

    # ---------------------------------------------------------------- 9. a new client
    U.open_page(pg, "owner", cloud=False, books=False)
    st = txt("#app [data-up-status]")
    ok(st.startswith("Books from Tally: nothing yet"), "a new client: the status line says nothing yet (%s)" % st)
    ok(pg.locator("#app [data-need-days]").count() == 0 and pg.locator("#app [data-up-drop]").count() == 1, "no days list; the one drop area")
    res = up(JUL)
    ok(E("S.books.vouchers.length") == JUL_N and res.startswith("Read %d entr" % JUL_N), "a first Day Book month on a new client (%s)" % res)
    ok(txt("#app [data-up-status]").startswith("Books from Tally: FY 2025-26 · entries up to "), "the status line follows (%s)" % txt("#app [data-up-status]"))
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close(); srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
