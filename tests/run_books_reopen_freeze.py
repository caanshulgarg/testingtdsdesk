"""python3 run_books_reopen_freeze.py - the owner, 25-Oct-2026 23:45 IST (Mac, Safari and Chrome, Leads Insurance): the
pages that need the books (TDS, GST, MIS) "crashing", then "now it worked.. but took too long". No error reached Sentry.
On the Leads stand (tests/leads_stand.py, CPU 4x) FinCom opened again on its own address (#/c/<client>/books/tds/2026-27,
a reload or a new tab) held the main thread in ONE task of 17-20 s (old builds: 99 s): the TDS page drawn by React on its
own (the Books screen's file arriving: a render React schedules itself, not through drawReact's memoScope) ran with
IN_RENDER = 0, so every TDS.rows / nrRows / salaryRows / quarters asked for TDS.allRowsNow over all 4,414 entries again,
and Books.lines worked out every entry's lines again each time (perRender and lines() keep nothing outside a drawing).
The browser said the page was not answering; on a slow Mac it looked crashed.
Budgets (CPU 4x): the reopening's longest task <= LONGEST_MS (3,000), all its long tasks <= TOTAL_MS (8,000), and
TDS.allRowsNow worked out at most ALLROWS_MAX (12; 105 before) times while the page opens.
  flock /tmp/fincom-app.lock python3 tests/run_books_reopen_freeze.py   (TDSDESK_SITE defaults to ../app/dist-test)"""
import os, sys, json, asyncio, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import leads_stand as L
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("REOPEN_FREEZE_PORT") or 8476)
CPU = float(os.environ.get("CPU_SLOWDOWN") or 4)
LONGEST = int(os.environ.get("LONGEST_MS") or 3000)
TOTAL = int(os.environ.get("TOTAL_MS") or 8000)
ALLROWS_MAX = int(os.environ.get("ALLROWS_MAX") or 12)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# long tasks from the page's start; TDS.allRowsNow counted from the moment legacy.js defines TDS (before React draws)
INIT = r"""(() => {
  window.__lt = 0; window.__ltMax = 0; window.__rows = 0;
  try { new PerformanceObserver(l => { l.getEntries().forEach(e => { window.__lt += e.duration; window.__ltMax = Math.max(window.__ltMax, e.duration); }); }).observe({entryTypes: ['longtask']}); } catch (e) {}
  const hook = () => { try { if (typeof TDS === 'object' && TDS.allRowsNow && !TDS.allRowsNow.__zz){ const f = TDS.allRowsNow; TDS.allRowsNow = function(){ window.__rows++; return f.apply(this, arguments); }; TDS.allRowsNow.__zz = 1; return; } } catch (e) {} setTimeout(hook, 0); };
  document.addEventListener('DOMContentLoaded', hook);
})()"""
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(); ctx = await br.new_context(viewport={"width": 1366, "height": 900})
        await ctx.add_init_script(INIT); pg = await ctx.new_page()
        errors = []; crashed = []
        pg.on("pageerror", lambda e: errors.append(str(e))); pg.on("crash", lambda *_: crashed.append(1))
        await ctx.route(L.STAGE + "/**", L.route)
        cdp = await ctx.new_cdp_session(pg); await cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU})
        async def until(js, t=180):
            s = time.time()
            while time.time() - s < t:
                try:
                    if await pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return time.time() - s
                except Exception: pass
                await asyncio.sleep(0.1)
            return None
        async def signin():
            if await pg.locator('button[data-act="useOffline"]').count(): await pg.click('button[data-act="useOffline"]'); await pg.wait_for_timeout(300)
            await until("typeof Store === 'object' && S.storeKind && S.storeKind !== 'memory'", 30)
            await pg.evaluate("""([a, firm]) => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: "u1"}); Cloud.st.firm = firm; Cloud.st.state = "ok";
              let c = S.companies[a]; if (!c){ c = newCompany({name: "ZZ Leads-like Brokers Pvt Ltd", gstin: ""}); c.id = a; c.tan = "DELZ01234Z"; c.pan = "AAACZ1234Z"; S.companies[c.id] = c; Store.saveCompany(c); }
              S.data[c.id] = S.data[c.id] || {parties: {}, entries: {}, loaded: true}; }""", [L.CID, L.FIRM])
        full = "S.books && S.books.cid === '%s' && S.books.vouchers.length >= %d && !S.books.loading && !S.books.busy && S.books.meta && S.books.meta.cloud" % (L.CID, len(L.VOUCHERS))
        # the books brought in once (the first opening), the TDS page of 2026-27 shown
        await pg.goto("http://localhost:%d/" % PORT); await pg.wait_for_timeout(1200); await signin()
        await pg.evaluate("(cid) => { S.coId = cid; S.view = 'company'; S.tab = 'books'; S.booksTab = 'tds'; S.tdsView = 'year'; S.tdsFy = '2026-27'; S.books = null; render(); }", L.CID)
        t = await until(full, 240); ok(t is not None, "the books brought in the first time (%s s)" % (round(t, 1) if t else "-"))
        await pg.wait_for_timeout(3000)
        hash_ = await pg.evaluate("() => location.hash"); print("  the page's address:", hash_)
        # FinCom opened again on that address: the client and its TDS page come back by themselves from the copy here
        await pg.reload(); t0 = time.time()
        await pg.wait_for_timeout(1200); await signin()
        t = await until(full + " && document.querySelector('#app [data-tds-page]') && !document.querySelector('#app [data-loading]')", 180)
        await pg.wait_for_timeout(4000)
        m = await pg.evaluate("() => ({lt: Math.round(window.__lt), max: Math.round(window.__ltMax), rows: window.__rows})")
        print("  reopened on its address: TDS page in %s s; long tasks %s" % (round(t, 1) if t else "-", json.dumps(m)))
        ok(t is not None, "the TDS page shown again from the copy here")
        ok(m["max"] <= LONGEST, "no task holds the page longer than %d ms (longest %d ms)" % (LONGEST, m["max"]))
        ok(m["lt"] <= TOTAL, "the reopening's long tasks add up to at most %d ms (%d ms)" % (TOTAL, m["lt"]))
        ok(m["rows"] <= ALLROWS_MAX, "the TDS rows worked out at most %d times while the page opens (%d)" % (ALLROWS_MAX, m["rows"]))
        ok(not crashed and not errors, "no crash, no page errors (%s)" % (errors[:3],))
        await br.close()
asyncio.run(main())
print("\nFAILED: %d" % len(fails) if fails else "\nALL OK"); sys.exit(1 if fails else 0)
