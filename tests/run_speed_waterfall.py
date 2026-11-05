"""python3 tests/run_speed_waterfall.py - two speed-round fixes (05-Nov-2026, branch next-speed), on the React test build
(app/dist-test, or TDSDESK_SITE) signed in to the stand-in cloud of tally_shapes.py, every cloud answer waiting WAIT ms
(default 300: about a round trip from the USA to Mumbai plus the function's own time):
  1. a client's unknown-ledger line (Rec.unkLoad, src/js/61-recorder.js) asks its books together: three books take about
     one wait, not three (was: one after another);
  2. a client's setup that meets another computer's save every time (cloudPushClient, src/js/27-firm-account.js) is read
     again after a growing pause (about 0.2, 0.4, 0.8, 1.6 s), not five reads and saves in a row; it still gives up after
     five tries with the same words, and is saved at the next sync.
RED on a build of 184036690 (mw2grghc-c48ebb): 1. 935 ms for three waits of 300; 2. the five tries within 71 ms. Green: 317 ms; 2.8 s."""
import os, sys, json, time, asyncio, functools, threading, http.server, urllib.parse
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tally_shapes as TS
SITE = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
PORT = int(os.environ.get("WATERFALL_PORT", "9573")); WAIT = int(os.environ.get("WAIT", "300"))
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

async def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    fx = TS.make(); cloud = TS.FakeCloud(fx); log = []; slow = {"on": False}
    async with async_playwright() as p:
        br = await p.chromium.launch()
        ctx = await br.new_context(service_workers="block"); await ctx.add_init_script(TS.signin_script(fx))
        async def supa(route):
            req = route.request; u = urllib.parse.urlparse(req.url)
            if slow["on"] and req.method != "OPTIONS": await asyncio.sleep(WAIT / 1000.0)
            st, j, hd = cloud.handle(req.method, req.url, req.post_data)
            log.append((time.time(), req.method, u.path.split("/v1/")[-1], u.query))
            h = {"Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range", "Access-Control-Allow-Headers": "*"}; h.update(hd)
            if req.method == "OPTIONS": return await route.fulfill(status=204, headers=h)
            await route.fulfill(status=st, content_type="application/json", body=json.dumps(j), headers=h)
        await ctx.route("https://*.supabase.co/**", supa)
        await ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
        await ctx.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg = await ctx.new_page()
        await pg.goto("http://localhost:%d/#/today" % PORT)
        await pg.wait_for_function("() => typeof S === 'object' && S && S.firm && typeof Rec === 'object' && typeof cloudPushClient === 'function' && typeof TCloud === 'object' && TCloud.on()", timeout=90000)
        await asyncio.sleep(4)

        print("1. a client's three books' unknown ledgers, each answer %d ms late" % WAIT)
        books = [b["book_id"] for b in fx["tally_books"]][:3]
        slow["on"] = True; del log[:]
        ms = await pg.evaluate("async (books) => { const t = performance.now(); await Rec.unkLoad(books); return performance.now() - t; }", books)
        asks = [x for x in log if x[2] == "rpc/tally_unknown_ledger_entries"]
        ok(len(asks) == 3, "one ask a book (%d)" % len(asks))
        ok(ms < 2 * WAIT, "the three asked together: %d ms (one wait is %d ms; one after another would be %d+)" % (ms, WAIT, 3 * WAIT))
        slow["on"] = False

        print("2. a client's setup that meets another computer's save at every try")
        c = fx["clients"][0]
        del log[:]
        r = await pg.evaluate("""async (c) => { const d = Object.assign({}, c.data || {}, {name: (c.data && c.data.name || c.name) + ' (changed here)'}); const t = performance.now();
          try { await cloudPushClient({id: c.id, data: d, hash: 'x'}, async () => {}); return {ms: performance.now() - t, err: ''}; } catch (e) { return {ms: performance.now() - t, err: String(e.message)}; } }""", c)
        reads = [x for x in log if x[1] == "GET" and x[2] == "clients" and "id=eq." in x[3]]
        saves = [x for x in log if x[1] == "PATCH" and x[2] == "clients"]
        ok(len(reads) == 5 and len(saves) == 5, "five tries, as before: %d reads, %d saves" % (len(reads), len(saves)))
        ok("kept changing on another computer" in r["err"], "then the same words: %s" % r["err"][:100])
        gaps = [round((b[0] - a[0]) * 1000) for a, b in zip(reads, reads[1:])]
        ok(r["ms"] >= 2000 and all(g >= 120 for g in gaps) and gaps == sorted(gaps) or (r["ms"] >= 2000 and gaps[-1] >= 1000),
           "a growing pause between the tries: %s ms, %d ms in all (was: all within a second)" % (gaps, r["ms"]))
        await br.close()
    srv.shutdown()
    print("\n" + ("FAIL: " + "; ".join(fails) if fails else "all ok"))
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
