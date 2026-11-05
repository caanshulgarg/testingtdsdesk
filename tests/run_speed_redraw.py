"""python3 tests/run_speed_redraw.py - the redraw fix of next-speed-redraw (05-Nov-2026), against the speed audit
(tests/run_speed_open.py: the Tally page drew the whole app 22-37 times in the 30 s after it was usable, 0.5-0.95 s at a
4x slower CPU). What comes in the background (the cloud's answers, the firm's sync, a heartbeat, Realtime, a timer) is
drawn by soonRender (src/js/01): one drawing for all that came, never sooner than half a second after the last one.

The React test build (app/dist-test, or TDSDESK_SITE) served at /review/ as Cloudflare serves it (tests/cf_pages.py),
signed in to the stand-in cloud of tally_shapes.py (12 clients, 20 Tally companies), at a 4x slower CPU (SPEED_CPU):
at most REDRAW_MAX (default 12) full drawings (render(), src/js/01) in the 30 s after the Tally page is usable;
background asks come together (soonRender: 20 asks over a second are at most 3 drawings); a click still draws at once
(the filter pressed in the same moment), and render() is still one drawing at once."""
import os, re, sys, json, time, asyncio
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("SPEED_PORT", os.environ.get("REDRAW_PORT", "9573"))
import run_speed_open as R
from playwright.async_api import async_playwright
TS = R.TS
MAX = int(os.environ.get("REDRAW_MAX", "12"))
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)


async def main():
    srv, root = R.serve()
    base = "http://localhost:%d/review/" % R.PORT
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])

        async def context(sw):
            fx = TS.make(); cloud = TS.FakeCloud(fx)
            ctx = await br.new_context(viewport={"width": 1440, "height": 900})
            await ctx.add_init_script(TS.signin_script(fx, "localStorage.setItem('fincom.sw', 'on');" if sw else ""))
            await ctx.add_init_script(R.AFTER)
            async def supa(route):
                req = route.request
                try: st, j, hd = cloud.handle(req.method, req.url, req.post_data)
                except Exception as e: st, j, hd = 500, {"message": str(e)}, {}
                if req.method == "PATCH" and "/rest/v1/clients" in req.url:
                    try: j = [dict(json.loads(req.post_data or "{}"), updated_at=time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()))]
                    except Exception: pass
                h = {"Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range", "Access-Control-Allow-Headers": "*"}; h.update(hd)
                if req.method == "OPTIONS": return await route.fulfill(status=204, headers=h)
                await route.fulfill(status=st, content_type="application/json", body=json.dumps(j), headers=h)
            await ctx.route("https://*.supabase.co/**", supa)
            await ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
            await ctx.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
            return ctx, fx

        async def page(ctx, cpu=R.CPU):
            pg = await ctx.new_page()
            errs = []; pg.on("pageerror", lambda e: None if "Access is denied for this document" in str(e) else errs.append(str(e)[:200]))
            cdp = await ctx.new_cdp_session(pg)
            if cpu > 1: await cdp.send("Emulation.setCPUThrottlingRate", {"rate": cpu})
            return pg, cdp, errs

        print("1. the Tally page: fewer full drawings, clicks at once")
        ctx, fx = await context(False)
        pg, cdp, errs = await page(ctx)
        await pg.goto(base + "#/tally", wait_until="commit")
        await pg.wait_for_function(R.USABLE["tally"], timeout=120000, polling=50)
        await pg.evaluate("() => __wrapRender()")
        await asyncio.sleep(30)
        n = await pg.evaluate("() => ({n: __renders, ms: Math.round(__renderMs)})")
        ok(n["n"] <= MAX, "the 30 s after the Tally page is usable: %d full drawings (%d ms) <= %d (the speed audit: 22-37)" % (n["n"], n["ms"], MAX))
        await cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1})
        c = await pg.evaluate("""() => new Promise((done) => { const a = __renders; let i = 0; const t = setInterval(() => { soonRender(); if (++i >= 20) clearInterval(t); }, 50);
            setTimeout(() => done(__renders - a), 1700); })""")
        ok(1 <= c <= 3, "20 background asks over a second: %d drawings (1-3)" % c)
        d = await pg.evaluate("() => { const a = __renders; render(); return __renders - a; }")
        ok(d == 1, "render() still draws at once (%d)" % d)
        f = await pg.evaluate("""() => { const b = document.querySelector('#app [data-tsm-filter="need"]'); if (!b) return 'no filter'; const a = __renders; b.click();
            const now = document.querySelector('#app [data-tsm-filter="need"]'); return [__renders - a, now && now.getAttribute('aria-pressed')]; }""")
        ok(f == [1, "true"], "a click (the Need you filter) draws in the same moment: %s" % (f,))
        await pg.evaluate("""() => { const b = document.querySelector('#app [data-tsm-filter="all"]'); if (b) b.click(); }""")
        ok(not errs, "no page errors (%s)" % errs[:2])
        await ctx.close()

        await br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
