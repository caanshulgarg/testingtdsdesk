"""python3 run_multi_ui.py - build 195, step 2 of the Tally plan:
  - day books for several clients at once: each file's company read from the file and matched to a client (GSTIN, else
    the Tally name); unmatched files wait; files taken one at a time;
  - a file from another Tally company is never taken into a client's books (the company part of the GUIDs);
  - a trial balance of another company is refused;
  - the check against Tally's trial balance: Ready when every ledger agrees, else the ledgers that differ."""
import os, sys, threading, functools, http.server, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")); os.makedirs(OUT, exist_ok=True)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8148), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
PARTIES = ["PARTY %02d" % i for i in range(12)]
def daybook(company, gstin, gp, days, amt=1000):
    vs = []
    for i, d in enumerate(days):
        p = PARTIES[i % 12]; g = "%s-%08x" % (gp, i + 1)
        vs.append('<TALLYMESSAGE><VOUCHER REMOTEID="%s" VCHTYPE="Sales" ACTION="Create"><DATE>%s</DATE><GUID>%s</GUID><ALTERID>%d</ALTERID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><CMPGSTIN>%s</CMPGSTIN><VOUCHERNUMBER>%d</VOUCHERNUMBER><PARTYLEDGERNAME>%s</PARTYLEDGERNAME>'
                  '<ALLLEDGERENTRIES.LIST><LEDGERNAME>%s</LEDGERNAME><AMOUNT>-%d.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Sales Account</LEDGERNAME><AMOUNT>%d.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></TALLYMESSAGE>'
                  % (g, d, g, i + 1, gstin, i + 1, p, p, amt + i, amt + i))
    return ('<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>%s</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>%s</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>' % (company.replace("&", "&amp;"), "".join(vs)))
def tb(values):
    rows = []
    for n, v in values.items():
        dr, cr = ("%.2f" % -v, "") if v < 0 else ("", "%.2f" % v)
        rows.append("<DSPACCNAME><DSPDISPNAME>%s</DSPDISPNAME></DSPACCNAME><DSPACCINFO><DSPCLDRAMT><DSPCLDRAMTA>%s</DSPCLDRAMTA></DSPCLDRAMT><DSPCLCRAMT><DSPCLCRAMTA>%s</DSPCLCRAMTA></DSPCLCRAMT></DSPACCINFO>" % (n, dr, cr))
    return "<ENVELOPE>" + "".join(rows) + "</ENVELOPE>"
days = ["202504%02d" % d for d in range(1, 25)]
files = {
    "vms.xml": daybook("VMS EVENTS PRIVATE LIMITED (2024-25)", "07AADCV3366N1ZU", "aaaaaaaa-1111-2222-3333-444444444444", days),
    "other.xml": daybook("ZZ OTHER LTD", "09AAACZ1111A1Z5", "bbbbbbbb-1111-2222-3333-444444444444", days, 500),
    "stranger.xml": daybook("SOMEONE ELSE PVT LTD", "27AAAAA0000A1Z5", "cccccccc-1111-2222-3333-444444444444", days),
    "vms-lookalike.xml": daybook("VMS EVENTS PRIVATE LIMITED (2024-25)", "07AADCV3366N1ZU", "dddddddd-1111-2222-3333-444444444444", ["20250425"]),
}
paths = {}
for n, t in files.items():
    paths[n] = os.path.join(OUT, n); open(paths[n], "w").write(t)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1100})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8148/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    ids = pg.evaluate("""() => { const add = (n, g, t) => { const c = newCompany({name: n, gstin: g}); if (t) c.tallyName = t; S.companies[c.id] = c; Store.saveCompany(c); return c.id; };
      const a = add("ZZ TEST VMS EVENTS", "07AADCV3366N1ZU", "VMS EVENTS PRIVATE LIMITED (2024-25)"), b = add("ZZ TEST OTHER", "09AAACZ1111A1Z5", "ZZ OTHER LTD");
      S.view = "home"; S.homeTab = "clients"; render(); return [a, b]; }""")
    pg.wait_for_timeout(800)
    ok(pg.locator('button:text-is("Choose day book files")').count() == 1, "the clients list offers day books for several clients at once")
    pg.set_input_files("#multiBooksIn", [paths[n] for n in ["vms.xml", "other.xml", "stranger.xml", "vms-lookalike.xml"]])
    for i in range(40):
        pg.wait_for_timeout(250)
        if pg.evaluate("S.multiUp && !S.multiUp.reading && S.multiUp.rows.length === 4"): break
    m = pg.evaluate("S.multiUp.rows.map(r => [r.f.name, r.name, r.cid])")
    ok(m[0][2] == ids[0] and m[1][2] == ids[1] and m[2][2] == "" and m[3][2] == ids[0], "each file matched to its client by GSTIN; the stranger's file matched to nobody: " + json.dumps([[x[0], x[2] == ids[0] and "VMS" or x[2] == ids[1] and "OTHER" or "-"] for x in m]))
    pg.click('button:text-is("Bring them in")')
    for i in range(120):
        pg.wait_for_timeout(500)
        if pg.evaluate("!S.multiUp.busy && S.multiUp.rows.filter(r => r.status !== 'waiting').length >= 3"): break
    st = pg.evaluate("S.multiUp.rows.map(r => r.status)")
    print("   statuses:", st)
    ok(st[0].startswith("done: 24 entries") and st[1].startswith("done: 24 entries"), "the two clients' files were brought in, one after the other")
    ok(st[2] == "waiting", "the file matched to nobody waits (nothing guessed)")
    ok(st[3].startswith("not taken") and "another" not in st[3] or "Tally company" in st[3], "a file from another Tally company with the same name is not taken into VMS: " + st[3][:120])
    both = pg.evaluate("(async (ids) => { const out = []; for (const id of ids){ const b = await Books.load(id); out.push([(b.vouchers || []).length, (b.tallyCo || {}).name, (b.vouchers || []).reduce((s, v) => s + v.ent.filter(e => e.l === 'Sales Account').reduce((x, e) => x + e.a, 0), 0)]); } return out; })", ids)
    ok(both[0][0] == 24 and both[1][0] == 24 and both[0][1] == "VMS EVENTS PRIVATE LIMITED (2024-25)" and both[1][1] == "ZZ OTHER LTD" and round(both[0][2]) != round(both[1][2]),
       "each client's books have only their own entries, and remember their Tally company: " + json.dumps(both))
    pg.screenshot(path=os.path.join(OUT, "multi.png"), full_page=True)
    # the VMS client: one file at a time from the From Tally page, the same checks
    pg.evaluate("(id) => { S.coId = id; S.view = 'company'; S.tab = 'books'; S.booksTab = 'import'; S.books = null; render(); }", ids[0])
    for i in range(40):
        pg.wait_for_timeout(250)
        if pg.evaluate("S.books && !S.books.loading && (S.books.vouchers || []).length === 24"): break
    pg.set_input_files("#booksIn", paths["other.xml"]); pg.wait_for_timeout(2500)
    ok("another Tally company" in pg.inner_text("body") and pg.evaluate("S.books.vouchers.length") == 24, "the other client's file chosen here by mistake is refused, and nothing changes")
    pg.evaluate("() => { const b = document.querySelector('#confirmBox button'); if (b) b.click(); }"); pg.wait_for_timeout(300)
    # opening balances (31 March), then the check against Tally's trial balance on 24 April
    opening = {n: -100.0 * (i + 1) for i, n in enumerate(PARTIES)}; opening["Capital Account X"] = sum(-v for v in opening.values())
    fo = os.path.join(OUT, "tb-open.xml"); open(fo, "w").write(tb(opening))
    pg.fill('input[aria-label="Balances as on"]', "2025-03-31"); pg.wait_for_timeout(200)
    pg.set_input_files("#tbIn", fo); pg.wait_for_timeout(2000)
    ok(pg.evaluate("Object.keys(S.books.tb.led).length") == 13, "opening balances taken")
    moves = {}
    for i, d in enumerate(days):
        p0 = PARTIES[i % 12]; moves[p0] = moves.get(p0, 0) - (1000 + i); moves["Sales Account"] = moves.get("Sales Account", 0) + (1000 + i)
    closing = {n: opening.get(n, 0) + moves.get(n, 0) for n in set(opening) | set(moves)}
    good = os.path.join(OUT, "tb-close.xml"); open(good, "w").write(tb(closing))
    bad = dict(closing); bad["PARTY 03"] -= 777; fb = os.path.join(OUT, "tb-close-bad.xml"); open(fb, "w").write(tb(bad))
    pg.evaluate("S.booksTab = 'import'; render()"); pg.wait_for_timeout(300)
    pg.set_input_files("#tbCheckIn", fb); pg.wait_for_timeout(1500)
    ck = pg.evaluate("S.books.tbCheck")
    ok(not ck["ok"] and ck["n"] == 1 and ck["list"][0][0] == "PARTY 03" and abs(ck["list"][0][3] - 777) < 0.01, "a trial balance that differs: Mismatch, with the ledger and the difference: " + json.dumps(ck["list"][:1]))
    ok("5. Mismatch" in pg.inner_text("#app") and "PARTY 03" in pg.inner_text("#app"), "the setup list shows Mismatch and the ledger")
    pg.set_input_files("#tbCheckIn", good); pg.wait_for_timeout(1500)
    ok(pg.evaluate("S.books.tbCheck.ok") and "5. Ready" in pg.inner_text("#app"), "the right trial balance: Ready, every ledger agrees")
    # a trial balance of another company's ledgers
    alien = os.path.join(OUT, "tb-alien.xml"); open(alien, "w").write(tb({"ALIEN %02d" % i: -10.0 for i in range(15)}))
    pg.set_input_files("#tbCheckIn", alien); pg.wait_for_timeout(1200)
    ok("does not look like this client" in pg.inner_text("body") and pg.evaluate("S.books.tbCheck.ok"), "a trial balance of another company's ledgers is refused")
    pg.screenshot(path=os.path.join(OUT, "tbcheck.png"), full_page=True)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:300]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
