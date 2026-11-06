"""python3 tests/run_hang_render.py - a "Page blocked" report says how the blocked frame's time was spent (hang-tally-sync,
FINCOM-APP-STAGING-G: staging 6-Nov-2026 06:59 UTC, the Tally page blocked 4,283 ms about 10 s after Try again
(tco-sync-again), where frame, and NO stack: the long frame named no script with a file, so the report could not say
whether the time was the page's code, a script without a file, or the browser laying out and painting the page; the same
click and the poll after it on the stand-in cloud (12 clients, 20 companies, 4x slower CPU) blocked nothing over 200 ms).

The React test build (app/dist-test, or TDSDESK_SITE), Sentry forced on (window.__fincomSentryForce), its envelopes caught:
  1. a block in a script (2.5 s in a timer): one warning, script_ms over 2,000, invoker TimerHandler:setTimeout, the
     script as its stack as before
  2. a block in the browser's layout (a large table shown by a one-line script, the CPU 6x slower): one warning, script_ms
     small, render_ms and other_ms most of the frame, no invoker (no script ran long): the shape of the staging event
  3. the tags pass the one scrubber (server/_shared/sentry-scrub.js): numbers and a code name only"""
import os, sys, json, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_RENDER_PORT", "9549"))
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def tags(body):
    for line in body.split("\n"):
        try: j = json.loads(line)
        except Exception: continue
        if isinstance(j, dict) and isinstance(j.get("tags"), dict) and j["tags"].get("kind") == "hang": return j
    return None
# a table of made-up rows, put in a few hundred rows at a time (no long task), hidden
BUILD = """(n) => new Promise((done) => { const t = document.createElement('table'); t.id = 'zz-big'; t.style.display = 'none'; document.body.appendChild(t);
  let i = 0; const step = () => { const f = document.createDocumentFragment();
    for (let k = 0; k < 400 && i < n; k++, i++) { const r = document.createElement('tr'); r.innerHTML = '<td>Made-up row ' + i + '</td><td style="padding:3px 9px">' + 'x y z '.repeat(1 + i % 5) + '</td><td>' + i * 7 + '</td>'; f.appendChild(r); }
    t.appendChild(f); if (i < n) setTimeout(step, 0); else done(i); }; step(); })"""


def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.add_init_script("(() => { window.__fincomSentryForce = true; })()")
        sent = []
        def onsentry(route):
            try: body = route.request.post_data or ""
            except Exception: body = ""
            sent.append(body); route.fulfill(status=200, body="{}", headers={"Access-Control-Allow-Origin": "*"})
        pg.context.route("https://*.ingest.us.sentry.io/**", onsentry)
        pg.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
        pg.wait_for_timeout(6000)
        ok(pg.evaluate("() => !!window.__fincomHangWatch"), "the watch runs once Sentry is up")
        again = lambda: pg.evaluate("() => { try { sessionStorage.removeItem('fincom.hang.at'); } catch (e) {} }")

        print("1. a block in a script")
        again(); n0 = len(sent)
        pg.evaluate("() => { function blockFor(ms){ const t = performance.now(); while (performance.now() - t < ms) {} } setTimeout(() => blockFor(2500), 10); }"); pg.wait_for_timeout(4000)
        evs = [tags(b) for b in sent[n0:] if tags(b)]
        t = evs[0]["tags"] if evs else {}
        print("      ", t)
        ok(len(evs) == 1 and t.get("where") == "frame", "one warning, where frame (%d)" % len(evs))
        ok(int(t.get("script_ms") or 0) >= 2000 and t.get("invoker") == "TimerHandler:setTimeout", "script_ms %s, invoker %s" % (t.get("script_ms"), t.get("invoker")))
        ok(int(t.get("style_ms") or 0) < 500, "style_ms small (%s)" % t.get("style_ms"))

        print("2. a block in the browser's layout")
        n = pg.evaluate(BUILD, int(os.environ.get("ROWS", "40000")))
        pg.wait_for_timeout(1500)
        cdp = pg.context.new_cdp_session(pg); cdp.send("Emulation.setCPUThrottlingRate", {"rate": float(os.environ.get("CPU", "6"))})
        again(); n0 = len(sent)
        t0 = time.time()
        pg.evaluate("() => { setTimeout(() => { document.getElementById('zz-big').style.display = ''; }, 10); }"); pg.wait_for_timeout(500)
        pg.evaluate("() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))")   # the page free again, the frame drawn
        took = time.time() - t0
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 1}); pg.wait_for_timeout(3000)   # the report sent after the frame
        print("       the table shown in %.1f s" % took)
        evs = [tags(b) for b in sent[n0:] if tags(b)]
        e = evs[0] if evs else {}; t = e.get("tags") or {}
        print("      ", n, "rows:", t)
        ms = int(t.get("ms") or 0)
        ok(len(evs) == 1 and t.get("where") == "frame", "one warning, where frame (%d)" % len(evs))
        rest = int(t.get("render_ms") or 0) + int(t.get("other_ms") or 0)
        ok(ms > 0 and int(t.get("script_ms") or 9e9) < ms * 0.2 and rest >= ms * 0.8 and "invoker" not in t,
           "the time is not a script's: script_ms %s, render_ms %s + other_ms %s of %d ms, no invoker" % (t.get("script_ms"), t.get("render_ms"), t.get("other_ms"), ms))

        print("3. the scrubber keeps them")
        ok(all(k in t for k in ("render_ms", "style_ms", "script_ms", "other_ms")), "render_ms, style_ms, script_ms and other_ms sent (after the scrubber)")
        ok(not errors, "no page errors (%s)" % errors[:2])
        br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
