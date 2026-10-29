"""python3 run_daybook_json.py - the owner, 28-Oct-2026: "Build JSON also: anyone can upload XML or JSON; the system understands
it and updates it." Books > From Tally (the one Upload Tally data, #tallyIn), on the React test build:
  - a Day Book exported from TallyPrime as JSON (Tally's object schema, as TallyPrime 7.1 writes it: tests/fixtures/
    real-tally-7.1-json; made here from the made-up books by tally_xml_to_json.mjs), UTF-8, UTF-8 with the BOM, UTF-16LE:
    read into the same entries as the same month's XML; told by its content, whatever its name;
  - a zip of three months (JSON and XML mixed): each month read as if chosen on its own;
  - the same month uploaded once as XML and once as JSON: no entry twice (the same GUIDs), the books as after the XML;
  - the ledger masters as JSON: read as the masters XML;
  - what goes to FinCom's cloud and the bridge's copy is Tally's XML (the readers there unchanged);
  - an Excel Day Book, a report as shown, a JSON not Tally's: said in plain words, nothing changed;
  - the JSON reader is its own file, loaded only when such a file is chosen (window.loadTallyJson).
Run: TDSDESK_SITE=../app/dist-test python3 run_daybook_json.py"""
import io, os, re, sys, json, zipfile, subprocess
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
def to_json(xml_path, name, enc="utf8"):
    p = os.path.join(OUT, name)
    r = subprocess.run(["node", os.path.join(HERE, "tally_xml_to_json.mjs"), xml_path, p, enc], capture_output=True, text=True, check=True)
    return p, json.loads(r.stdout)
def write(name, data):
    p = os.path.join(OUT, name); open(p, "wb").write(data); return p

JUL, JUL_N = U.month_file("202507"); AUG, AUG_N = U.month_file("202508"); SEP, SEP_N = U.month_file("202509")
JUL_J, jj = to_json(JUL, "DayBook-202507.json")
JUL_J16, _ = to_json(JUL, "DayBook-202507-utf16.json", "utf16")
JUL_JBOM, _ = to_json(JUL, "daybook july.txt", "utf8bom")          # a JSON named .txt: told by its content
AUG_J, _ = to_json(AUG, "DayBook-202508.json")
MASTERS_J, mj = to_json(U.MASTER, "Masters.json")
ok(jj["vouchers"] == JUL_N, "fixture: July as JSON, %d vouchers (the XML has %d)" % (jj["vouchers"], JUL_N))
z = io.BytesIO()
with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zz:
    zz.write(JUL_J, "2025-26/DayBook-202507.json"); zz.write(AUG_J, "2025-26/DayBook-202508.json"); zz.write(SEP, "2025-26/DayBook-202509.xml")
ZIP3 = write("DayBooks-Q2.zip", z.getvalue())
xl = io.BytesIO()
with zipfile.ZipFile(xl, "w", zipfile.ZIP_DEFLATED) as zz:
    zz.writestr("[Content_Types].xml", "<Types/>"); zz.writestr("xl/workbook.xml", "<workbook/>"); zz.writestr("xl/worksheets/sheet1.xml", "<worksheet/>")
XLSX = write("DayBook.xlsx", xl.getvalue())
REPORT = write("DayBook-report.json", json.dumps({"dspvchdate": ["1-Jul-25"], "dspvchledaccount": ["Cash"], "dspvchdramt": ["100.00"]}).encode())
OTHER = write("settings.json", b'{"theme": "dark"}')
EXCEL_WORDS = "DayBook.xlsx: This is an Excel export. Export the Day Book as XML or JSON instead: Day Book → F2 period → E (Export) → Format: XML or JSON."

with sync_playwright() as p:
    srv, br, pg = U.start(p, 8491, SITE, errors=errors)
    E = pg.evaluate
    lazy = []
    pg.on("request", lambda r: lazy.append(r.url) if re.search(r"/assets/tallyJson-[\w-]+\.js", r.url) else None)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    def idle(sec=90):
        for _ in range(sec * 4):
            pg.wait_for_timeout(250)
            if E("!S.books.busy && !(S.tallyUp && S.tallyUp.busy)"): break
        pg.wait_for_timeout(300)
    def up(paths):
        E("() => { S.tallyUp = null; S.dbFrom = ''; S.dbTo = ''; }"); pg.set_input_files("#tallyIn", paths); pg.wait_for_timeout(500); idle()
        return E("S.tallyUp ? S.tallyUp.lines.map(l => [l.kind, l.ok, l.text]) : []")
    U.open_page(pg, "owner")
    ok(not lazy and E("typeof TallyJson") == "undefined", "the JSON reader is not loaded with the app (its own file)")
    month = lambda ym: E("(ym) => S.books.vouchers.filter(v => v.date.startsWith(ym)).map(v => JSON.stringify(v)).sort()", ym)
    ids = lambda: E("S.books.vouchers.map(v => v.id)")
    # the cloud and the bridge: what they would be given (the readers there take Tally's XML)
    E("""() => { window.__sent = []; TCloudUp.on = () => true; TCloudUp.handOver = async (f, range) => { window.__sent.push({to: 'cloud', name: f.name, head: (await f.slice(0, 400).text()), n: ((await f.text()).match(/<VOUCHER /g) || []).length, range}); return {days: 1, job: 'j'}; };
      Bridge.on = () => true; BridgeSeed.send = async (f) => { window.__sent.push({to: 'bridge', name: f.name, n: ((await f.text()).match(/<VOUCHER /g) || []).length}); return {entries: 1}; }; }""")

    print("== a JSON Day Book: read as the same month's XML")
    before = month("202507"); n0 = len(ids())
    lines = up(JUL)
    after_xml = month("202507")
    ok(lines and lines[0][1] and lines[0][0] == "daybook", "July as XML read (%s)" % lines)
    for path, what in [(JUL_J, "UTF-8"), (JUL_J16, "UTF-16LE with the BOM"), (JUL_JBOM, "UTF-8 with the BOM, named .txt")]:
        E("() => { window.__sent = []; }")
        lines = up(path)
        ok(len(lines) == 1 and lines[0][0] == "daybook" and lines[0][1] is True and re.match(r"^Read %d entr(y|ies) for 01-Jul-2025 to 31-Jul-2025" % JUL_N, lines[0][2]),
           "July as JSON (%s): read, %d entries, the month's dates (%s)" % (what, JUL_N, lines[0][2] if lines else lines))
        ok(month("202507") == after_xml, "July as JSON (%s): the books' July is exactly as after the XML (same entries, field for field)" % what)
        ids_now = ids()
        ok(len(ids_now) == len(set(ids_now)) and len(ids_now) == len(set(ids_now)), "July as JSON (%s): no entry twice (%d entries, %d ids)" % (what, len(ids_now), len(set(ids_now))))
        pg.wait_for_timeout(800)
        sent = E("window.__sent")
        cl = [s for s in sent if s["to"] == "cloud"]; brd = [s for s in sent if s["to"] == "bridge"]
        ok(cl and cl[0]["head"].startswith("<ENVELOPE>") and cl[0]["n"] == JUL_N and brd and brd[0]["n"] == JUL_N,
           "July as JSON (%s): FinCom's cloud and the bridge's copy are given Tally's XML of the %d entries (%s)" % (what, JUL_N, [(s["to"], s["n"], (s.get("head") or "")[:40]) for s in sent]))
    ok(lazy, "the JSON reader loaded when a JSON file was chosen (%s)" % (lazy[:1],))
    ok(len(ids()) == n0, "after XML, JSON, JSON and JSON of the same month: the same number of entries as before (%d)" % n0)

    print("== a zip of three months, JSON and XML mixed")
    want = {ym: month(ym) for ym in ("202507", "202508", "202509")}
    lines = up(ZIP3)
    ok(len(lines) == 3 and all(l[0] == "daybook" and l[1] for l in lines), "the zip: three Day Books read, one line each (%s)" % [l[2][:60] for l in lines])
    ok(all(any(re.search(r"for \d\d-%s-2025 to \d\d-%s-2025;" % (m, m), l[2]) for l in lines) for m in ("Jul", "Aug", "Sep")),
       "each file its own month's dates (%s)" % [re.sub(r";.*", "", l[2]) for l in lines])
    ok(all(month(ym) == want[ym] for ym in want) and len(ids()) == n0 and len(set(ids())) == n0, "the three months as they were: nothing twice, nothing lost (%d entries)" % len(ids()))

    print("== the masters as JSON")
    lines = up(MASTERS_J)
    ok(len(lines) == 1 and lines[0][0] == "masters" and lines[0][1] is True and lines[0][2].startswith("Read the ledger masters:"), "Masters.json: read as the ledger masters (%s)" % (lines[0][2] if lines else lines))
    mj_pans = E("Object.keys(S.books.pans || {}).length")
    up(U.MASTER)
    ok(E("Object.keys(S.books.pans || {}).length") == mj_pans and mj_pans > 0, "the same PANs as from the masters XML (%d)" % mj_pans)

    print("== said plainly, nothing changed")
    n1 = len(ids())
    lines = up(XLSX)
    ok(len(lines) == 1 and lines[0][1] is False and lines[0][2] == EXCEL_WORDS, "an Excel Day Book: %s" % (lines[0][2] if lines else lines))
    lines = up(REPORT)
    ok(len(lines) == 1 and lines[0][1] is False and "as Tally shows it on the screen" in lines[0][2] and "JSON (Data Exchange)" in lines[0][2], "a JSON of the report as shown: %s" % (lines[0][2] if lines else lines))
    lines = up(OTHER)
    ok(len(lines) == 1 and lines[0][1] is False and "holds no Tally entries or masters" in lines[0][2], "a JSON not Tally's: %s" % (lines[0][2] if lines else lines))
    lines = up([JUL_J, XLSX])
    ok(len(lines) == 2 and sum(1 for l in lines if l[1]) == 1 and any(l[2] == EXCEL_WORDS for l in lines), "a JSON Day Book and an Excel file together: the one read, the other said (%s)" % [l[2][:50] for l in lines])
    ok(len(ids()) == n1, "the books unchanged by the refused files (%d entries)" % n1)
    t = pg.inner_text("#app")
    ok("XML, JSON or a zip of them" in t, "From Tally says XML, JSON or a zip are taken")
    ok(E("document.getElementById('tallyIn').accept").split(",")[:3] == [".xml", ".json", ".zip"], "the file box takes .xml, .json and .zip (%s)" % E("document.getElementById('tallyIn').accept"))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close(); srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
