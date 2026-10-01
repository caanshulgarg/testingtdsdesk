"""python3 run_open_timing.py - how long opening Testing AAD takes (review of 01-Oct-2026, branch server-books): a fresh
browser (nothing kept) and a second opening (the books kept in the browser as a cache). FinCom's cloud is a stand-in
here with the staging copy's books (tests/data/books-cache.json: 2,754 entries on 304 days) and every request held
for LATENCY_MS (default 150 ms, a round trip to Supabase), answered several at a time as the server does.
Prints the times; fails if the second opening takes 2 seconds or more. Skipped without the cache (local only).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_open_timing.py"""
import os, sys, json, gzip, asyncio, threading, functools, http.server, time
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
CACHE = os.environ.get("TDSDESK_CACHE", os.path.join(HERE, "data", "books-cache.json"))
if not os.path.exists(CACHE):
    print("skipped: no tests/data/books-cache.json (built from staging, kept out of git)"); raise SystemExit(0)
import cloud_books
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8169), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"; LAT = int(os.environ.get("LATENCY_MS", "150")) / 1000
books = json.load(open(CACHE)); by_day, LED, GRP = cloud_books.build(books); DAYS = sorted(by_day); AT = "2026-10-01T07:00:00+00:00"
GZ = {d: gzip.compress(("<ENVELOPE><BODY><DATA>" + "".join(by_day[d]) + "</DATA></BODY></ENVELOPE>").encode("utf-8")) for d in DAYS}
# the TDS and GST work as items (about the size of Testing AAD's: 35 ledgers confirmed among 366)
ITEMS = [{"key": "map", "item": "", "ord": None, "data": {"$t": "obj"}, "deleted": False, "seq": 1, "updated_at": AT, "updated_by": "u1"}] + \
        [{"key": "map", "item": "." + x["name"], "ord": None, "data": {"kind": "other", "ok": i < 35}, "deleted": False, "seq": 2 + i, "updated_at": AT, "updated_by": "u1"} for i, x in enumerate(LED)]
n = {"req": 0}
async def route(r):
    await asyncio.sleep(LAT); n["req"] += 1
    u = urlparse(r.request.url); path = u.path; q = parse_qs(u.query); off = int((q.get("offset") or ["0"])[0])
    j = lambda o: r.fulfill(status=200, content_type="application/json", body=json.dumps(o))
    if path.endswith("/rpc/tally_status"):
        return await j([{"book": "bk1", "company": "GARG SHEKHAR & COMPANY", "from": "2025-04-01", "openAsOn": "2025-03-31", "ledgersAt": "2026-10-01T06:00:00Z", "daysAt": AT,
                         "state": {"phase": "live"}, "days": len(DAYS), "entries": len(books["vouchers"]), "to": "2026-03-31"}])
    if path.endswith("/rpc/tally_days_list"): return await j([{"day": d, "n": 1, "at": AT} for d in DAYS][off:off + 1000])
    if "/tally-days/" in path: return await r.fulfill(status=200, content_type="application/gzip", body=GZ.get(path.rsplit("/", 1)[1][:8], b""))
    if path.endswith("/tally_ledgers"): return await j(LED[off:off + 1000])
    if path.endswith("/tally_groups"): return await j(GRP[off:off + 1000])
    if path.endswith("/client_book_items"):
        after = int(q.get("seq", ["gt.0"])[0][3:]); return await j([x for x in ITEMS if x["seq"] > after][:1000])
    if path.endswith("/members"): return await j([{"user_id": "u1", "firm_id": "f1", "name": "ZZ", "role": "staff", "active": True}])
    return await j({"ok": True, "items": []} if "save_book_items" in path else [])
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(); ctx = await br.new_context(viewport={"width": 1300, "height": 900}); pg = await ctx.new_page()
        await ctx.route(STAGE + "/**", route)
        async def until(js, t=180):
            s = time.time()
            while time.time() - s < t:
                try:
                    if await pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return time.time() - s
                except Exception: pass
                await asyncio.sleep(0.05)
            return None
        async def boot():
            await pg.goto("http://localhost:8169/"); await pg.wait_for_timeout(1500)
            if await pg.locator('button[data-act="useOffline"]').count(): await pg.click('button[data-act="useOffline"]'); await pg.wait_for_timeout(500)
            await pg.evaluate("""() => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: "u1"}); Cloud.st.firm = "f1"; Cloud.st.state = "ok";
              let c = S.companies.cmufksrrqjub2g; if (!c){ c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.id = "cmufksrrqjub2g"; c.tallyName = "GARG SHEKHAR & COMPANY"; S.companies[c.id] = c; Store.saveCompany(c); }
              S.data[c.id] = S.data[c.id] || {parties: {}, entries: {}, loaded: true}; }""")
        async def open_it(label):
            t0 = time.time()
            await pg.evaluate("() => { S.coId = 'cmufksrrqjub2g'; S.view = 'company'; S.tab = 'books'; S.booksTab = 'tds'; S.books = null; render(); }")
            await until("S.books && S.books.cid === 'cmufksrrqjub2g' && !S.books.loading"); shown = time.time() - t0
            await until("S.books && S.books.vouchers && S.books.vouchers.length === %d && S.books.meta && S.books.meta.cloud && !S.books.busy && !S.lkFr.busy" % len(books["vouchers"])); ready = time.time() - t0
            print("  %-34s the books on screen (the server's TDS/GST work first) %.2f s; every entry in, ready for TDS, GST and MIS %.2f s" % (label, shown, ready or -1))
            return shown, ready
        n["req"] = 0; await boot(); f = await open_it("fresh browser (nothing kept):")
        print("    requests: %d (304 day files among them)" % n["req"])
        n["req"] = 0; await pg.reload(); await boot(); s = await open_it("second opening (after a refresh):")
        print("    requests: %d" % n["req"])
        await ctx.unroute_all(behavior="ignoreErrors"); await br.close()
        return f, s
f, s = asyncio.run(main())
srv.shutdown()
print("  latency per request: %d ms" % (LAT * 1000))
ok = s[1] is not None and s[1] < 2
print(("  ok   " if ok else "  FAIL ") + "second opening ready in under 2 seconds (%.2f s)" % (s[1] or -1))
raise SystemExit(0 if ok else 1)
