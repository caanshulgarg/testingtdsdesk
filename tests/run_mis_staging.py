"""python3 run_mis_staging.py - MIS on GARG SHEKHAR & COMPANY's books from the staging cloud copy (FY 2025-26, client
Testing AAD), review of 01-Oct-2026: the books' last entry date, what is owed and advanced on balance, ageing that adds
up to it, no negative days, and the profit and loss saying when the ledger groups are missing.
Needs tests/data/books-cache.json built from staging (kept out of git). Run on the React build:
TDSDESK_SITE=../app/dist-test python3 run_mis_staging.py"""
import os, json, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8166), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(os.environ.get("TDSDESK_CACHE", os.path.join(HERE, "data", "books-cache.json"))))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
amt = lambda t: float(re.sub(r"[^\d.\-]", "", t) or 0)
last = max(v["date"] for v in books["vouchers"] if not v.get("cancel"))
grouped = any(x.get("parent") for x in books.get("tb", {}).get("led", {}).values())
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8166/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    # the books as the cloud copy gives them: kept in step with Tally to 30-Sep-2026, the last entry earlier
    pg.evaluate("""(bk) => { const c = newCompany({name: "ZZ TEST (Testing AAD)", gstin: ""}); S.companies[c.id] = c; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
      S.books = Object.assign({loading: false, challans: [], alloc: {}}, bk, {cid: c.id}); S.books.meta = Object.assign({}, bk.meta, {to: "20260930", at: "2026-09-30T22:28:04"});
      TallyRead.balances(S.books, {ledgers: Object.entries(bk.tb.led).map(([name, x]) => ({name, parent: x.parent, open: String(x.open), close: ""}))}, "20250401", "20260930");
      S.books.map = Books.mapLedgers(bk.vouchers, {}); LedMaster.refresh(S.books); window.__bk = S.books; S.booksTab = "mis"; S.misRange = {from: "2025-04-01", to: "2026-03-31"}; render(); }""", books)
    pg.wait_for_timeout(1500); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(800)
    fresh = pg.inner_text("#app")
    want = "%s-%s-%s" % (last[6:], ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][int(last[4:6]) - 1], last[:4])
    ok(("Books up to " + want + " (the last entry)") in fresh and "checked with Tally to 30-Sep-2026" in fresh,
       "3a. the books' last entry date, not how far the copy was checked: " + (re.search(r"Books up to[^\n]*", fresh) or [""])[0])
    # FY 2025-26 run
    pg.click('section:has(> h3:text-is("MIS")) button:text-is("Run now")'); pg.wait_for_timeout(4000)
    r = pg.evaluate("""(() => { const r = S.books.mis && S.books.mis.last; if (!r) return null; const f = A => ({owe: A.sum.owe, adv: A.sum.advance, nb: A.sum.nb, und: A.sum.und,
        parties: A.rows.map(p => ({net: p.net, nb: p.nb, und: p.und, adv: p.advance}))}); return {from: r.from, to: r.to, pay: f(r.pay), recv: f(r.recv), dpo: r.dpo, dso: r.dso, sales: r.sales.total, pbt: r.pl.pbt.t}; })()""")
    ok(r and r["from"] == "20250401" and r["to"] == "20260331", "MIS run for FY 2025-26 (%s to %s)" % ((r or {}).get("from"), (r or {}).get("to")))
    r = r or {"pay": {"parties": [], "nb": [0], "und": 0, "owe": 0, "adv": 0}, "recv": {"parties": [], "nb": [0], "und": 0, "owe": 0, "adv": 0}}
    text = pg.inner_text("#app")
    owe_tile = re.search(r"You owe\n([^\n]+)\n([^\n]*)", text); recv_tile = re.search(r"Owed to you\n([^\n]+)\n([^\n]*)", text)
    ok(owe_tile and amt(owe_tile.group(1)) >= 0 and "-" not in owe_tile.group(1), "3c. You owe is never negative: " + (owe_tile.group(1) if owe_tile else "no tile"))
    ok(owe_tile and not re.search(r"-\d+ days", owe_tile.group(2)) and (r["dpo"] is None or r["dpo"] >= 0), "3c. no negative days of purchases (%s)" % r["dpo"])
    ok((r["pay"]["adv"] < 1) or ("advance to suppliers ₹" in owe_tile.group(2) and "-" not in re.search(r"advance to suppliers ₹[^ ·]+", owe_tile.group(2)).group(0)),
       "3c. suppliers with a debit balance show as an advance to suppliers, a positive figure (%s)" % ("₹{:,.2f}".format(r["pay"]["adv"])))
    if not r["pay"]["parties"] and not r["recv"]["parties"]:
        print("    note: these books carry no bill-wise details (the cloud tables keep none), so nothing is aged here; run_review_0110.py ages made-up bills")
    for side, A in (("payables", r["pay"]), ("receivables", r["recv"])):
        ages = round(sum(A["nb"]) + A["und"], 2)
        ok(abs(ages - A["owe"]) < 0.05, "3d. %s: the ages add up to what is owed (%.2f = %.2f)" % (side, ages, A["owe"]))
        ok(all(abs(sum(p["nb"]) + p["und"] - max(0, p["net"])) < 0.05 and p["adv"] >= 0 for p in A["parties"]), "3d. %s: and so for every party (%d)" % (side, len(A["parties"])))
    o90 = re.search(r"over 90 days ₹?(-?[\d,.]+)", owe_tile.group(2) if owe_tile else "")
    ok(o90 and amt(o90.group(1)) <= amt(owe_tile.group(1)) + 0.01, "3d. over 90 days (%s) is not more than what is owed (%s)" % (o90.group(1) if o90 else "?", owe_tile.group(1) if owe_tile else "?"))
    # the profit and loss: without Tally's groups it says so, and shows no profit
    if not grouped:
        ok("The ledgers’ groups are not in these books yet" in text and re.search(r"Profit before tax\n—", text), "3b. without the ledger groups, MIS says the profit and loss leaves out expenses, and shows no profit")
    else:
        ok(r["pbt"] < r["sales"], "3b. with the ledger groups, expenses come off: profit before tax %.2f below sales %.2f" % (r["pbt"], r["sales"]))
    # Sep-2026, as the review saw it: ageing still adds up and over 90 is within the total
    pg.evaluate("() => { S.misRange = {from: '2026-09-01', to: '2026-09-30'}; render(); }"); pg.wait_for_timeout(300)
    pg.click('section:has(> h3:text-is("MIS")) button:text-is("Run now")'); pg.wait_for_timeout(3000)
    s2 = pg.evaluate("(() => { const A = S.books.mis.last.pay, B = S.books.mis.last.recv; return [A.sum.owe, A.sum.nb[3] + A.sum.nb[4], B.sum.owe, B.sum.nb[3] + B.sum.nb[4]]; })()")
    ok(s2[1] <= s2[0] + 0.01 and s2[3] <= s2[2] + 0.01, "3d. Sep-2026: over 90 days is within the total (payables %.2f of %.2f, receivables %.2f of %.2f)" % (s2[1], s2[0], s2[3], s2[2]))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
