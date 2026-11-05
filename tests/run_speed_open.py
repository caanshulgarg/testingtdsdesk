"""python3 tests/run_speed_open.py - how long FinCom takes to open, and what it asks the cloud for (speed round, 04-Nov-2026;
the owner: "lightning fast like a professional app ... on every browser, every system, over Remote Desktop"; "like if I
want to launch it in the USA"). A measurement, not a pass/fail test, except the limits at the end.

The React test build (app/dist-test, or TDSDESK_SITE) served at /review/ with the response headers Cloudflare gives it
(cloudflare/_headers.main, applied by tests/cf_pages.py), signed in to a stand-in of the cloud with the made-up firm of
tally_shapes.py (12 clients, 20 Tally companies, 5,272 ledgers), at a 4x slower CPU (SPEED_CPU). Every answer of the
stand-in cloud waits SPEED_RTT milliseconds (a list, default "0,250": 0 is this computer, ~40 India to Mumbai, ~250 the
USA to Mumbai), so the time added by the wait, divided by the wait, is the number of round trips one after another
before the screen is usable.

For each wait and each screen (Today, Tally): a first open (nothing kept: no cache, no service worker) and a second open
(the files kept by the browser and the service worker): when the page is usable (the program ready and the frame drawn;
Today: the clients' rows; Tally: every client's row), the cloud requests made by then, the script time (Chrome's
ScriptDuration: parse, compile, run), and the bytes of the program files (as sent: gzip and brotli at Cloudflare's
levels). Then SPEED_IDLE_S seconds (default 120) on each screen at no wait: the cloud requests a minute, by endpoint.

  SPEED_JSON=file   also writes the numbers as JSON
  limits checked: the idle requests a minute on Today <= SPEED_MAX_IDLE (default: none)"""
import os, re, sys, json, time, asyncio, gzip, glob, threading, functools, http.server, subprocess, collections, tempfile, shutil, urllib.parse
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tally_shapes as TS
import cf_pages as CF
SITE = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
CPU = float(os.environ.get("SPEED_CPU", "4"))
RTTS = [int(x) for x in os.environ.get("SPEED_RTT", "0,250").split(",") if x.strip()]
IDLE = int(os.environ.get("SPEED_IDLE_S", "120"))
PORT = int(os.environ.get("SPEED_PORT", "9571"))
fails = []

READY = "() => typeof S === 'object' && S && S.firm && typeof render === 'function' && !document.querySelector('[data-boot-part]')"
USABLE = {
    "today": READY[:-1] + " && document.querySelectorAll('#app .today-co').length > 0)",
    "tally": READY[:-1] + " && !!document.querySelector('#app [data-tsm-rows=done]'))",
}


# after the page is usable: each full drawing of the page (render(), src/js/01) and each long task (over 50 ms), for 30 s
AFTER = """(() => { window.__long = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({type: 'longtask', buffered: true}); } catch (e) {}
  window.__renders = 0; window.__renderMs = 0;
  window.__wrapRender = () => { if (window.__wrapped || typeof window.render !== 'function') return; window.__wrapped = 1; const r = window.render; window.render = function () { const t = performance.now(); window.__renders++; try { return r.apply(this, arguments); } finally { window.__renderMs += performance.now() - t; } }; };
})()"""


def sizes():
    """the bytes of the files the first open needs: raw, gzip -6 (Cloudflare's gzip) and brotli -4 (its on-the-fly level)"""
    import re
    html = open(os.path.join(SITE, "index.html"), encoding="utf-8").read()
    names = ["index.html"] + [n.split("?")[0].lstrip("./") for n in re.findall(r'(?:src|href)="(\./[^"]+)"', html)]
    js = "const z=require('zlib'),fs=require('fs');for(const f of process.argv.slice(1)){const b=fs.readFileSync(f);console.log(JSON.stringify([f,b.length,z.gzipSync(b,{level:6}).length,z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:4}}).length,z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:11}}).length]))}"
    files = [os.path.join(SITE, n) for n in dict.fromkeys(names) if os.path.isfile(os.path.join(SITE, n))]
    out = subprocess.run(["node", "-e", js] + files, capture_output=True, text=True, check=True).stdout.split("\n")
    rows = [json.loads(l) for l in out if l.strip()]
    return [{"file": os.path.relpath(r[0], SITE), "raw": r[1], "gzip": r[2], "br4": r[3], "br11": r[4]} for r in rows]


def serve():
    root = tempfile.mkdtemp(prefix="speed-site-")
    os.symlink(SITE, os.path.join(root, "review"))
    open(os.path.join(root, "index.html"), "w").write("<!doctype html><title>root</title>")
    rules = CF.parse(open(os.path.join(HERE, "..", "cloudflare", "_headers.main"), encoding="utf-8").read())
    H = type("H", (CF.PagesHandler,), {"rules": rules})
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(H, directory=root))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, root


async def main():
    srv, root = serve()
    base = "http://localhost:%d/review/" % PORT
    res = {"cpu": CPU, "files": sizes(), "opens": [], "idle": {}}
    print("The first open's files (bytes: raw / gzip / brotli 4 / brotli 11):")
    for f in res["files"]: print("  %-44s %9d %9d %9d %9d" % (f["file"], f["raw"], f["gzip"], f["br4"], f["br11"]))
    t = {k: sum(f[k] for f in res["files"]) for k in ("raw", "gzip", "br4", "br11")}
    print("  %-44s %9d %9d %9d %9d" % ("total", t["raw"], t["gzip"], t["br4"], t["br11"]))
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])

        async def context(rtt, log):
            fx = TS.make(); cloud = TS.FakeCloud(fx)
            ctx = await br.new_context(viewport={"width": 1440, "height": 900})
            # the service worker as on staging (on localhost it is off unless asked: app/src/main.jsx)
            await ctx.add_init_script(TS.signin_script(fx, "localStorage.setItem('fincom.sw', 'on');"))
            await ctx.add_init_script(AFTER)

            async def supa(route):
                req = route.request; t0 = time.time()
                if rtt: await asyncio.sleep(rtt / 1000.0)
                try: st, j, hd = cloud.handle(req.method, req.url, req.post_data)
                except Exception as e: st, j, hd = 500, {"message": str(e)}, {}
                # a client's setup saved: PostgREST answers the row (the stand-in answers nothing, and the page would read and save again)
                if req.method == "PATCH" and "/rest/v1/clients" in req.url:
                    try: j = [dict(json.loads(req.post_data or "{}"), updated_at=time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()))]
                    except Exception: pass
                h = {"Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range", "Access-Control-Allow-Headers": "*"}; h.update(hd)
                u = urllib.parse.urlparse(req.url).path.split("/v1/")[-1]
                log.append({"at": t0, "m": req.method, "u": u.split("?")[0], "q": u})
                if req.method == "OPTIONS": return await route.fulfill(status=204, headers=h)
                await route.fulfill(status=st, content_type="application/json", body=json.dumps(j), headers=h)
            await ctx.route("https://*.supabase.co/**", supa)
            await ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
            await ctx.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
            # Realtime, answered as Supabase does (joins and heartbeats ok, no changes): the page's live line is up, as on staging
            def ws_route(ws):
                def on_msg(m):
                    try: x = json.loads(m)
                    except Exception: return
                    if x.get("event") == "phx_join": ws.send(json.dumps({"topic": x["topic"], "event": "phx_reply", "ref": x.get("ref"), "payload": {"status": "ok", "response": {"postgres_changes": [{"id": 1}]}}}))
                    elif x.get("event") in ("heartbeat", "access_token"): ws.send(json.dumps({"topic": x.get("topic"), "event": "phx_reply", "ref": x.get("ref"), "payload": {"status": "ok", "response": {}}}))
                ws.on_message(on_msg)
            await ctx.route_web_socket(re.compile(r"wss://[a-z0-9]+\.supabase\.co/realtime/.*"), ws_route)
            return ctx

        async def open_(ctx, screen, log, label, rtt):
            pg = ctx.pages[0] if ctx.pages else await ctx.new_page()
            errs = []; pg.on("pageerror", lambda e: None if "Access is denied for this document" in str(e) else errs.append(str(e)[:200]))
            cdp = await ctx.new_cdp_session(pg)
            await cdp.send("Performance.enable")
            if CPU > 1: await cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU})
            await pg.goto("about:blank")
            del log[:]
            t0 = time.time()
            await pg.goto(base + "#/" + screen, wait_until="commit", timeout=120000)
            try: await pg.wait_for_function(USABLE[screen], timeout=120000, polling=50)
            except Exception as e: fails.append("%s: not usable in 120 s" % label); print("  FAIL", label, str(e)[:200]); return None
            ms = (time.time() - t0) * 1000
            n_usable = sum(1 for x in log if x["m"] != "OPTIONS")
            t_usable = await pg.evaluate("() => { __wrapRender(); return performance.now(); }")
            # the firm's data brought up to date from the cloud (the first sync of this open done)
            try: await pg.wait_for_function("() => typeof Cloud === 'object' && Cloud.st && !!Cloud.st.lastSync && !Cloud.st.busy", timeout=120000, polling=50); synced = round((time.time() - t0) * 1000)
            except Exception: synced = -1
            m = {x["name"]: x["value"] for x in (await cdp.send("Performance.getMetrics"))["metrics"]}
            await asyncio.sleep(max(0, 30 - (time.time() - t0) + ms / 1000.0))
            aft = await pg.evaluate("(t) => { const l = __long.filter((x) => x[0] >= t); return {renders: __renders, render_ms: Math.round(__renderMs), long_n: l.length, long_ms: l.reduce((a, x) => a + x[1], 0), long_max: l.reduce((a, x) => Math.max(a, x[1]), 0), long_before: __long.filter((x) => x[0] < t).reduce((a, x) => a + x[1], 0)}; }", t_usable)
            nav = await pg.evaluate("() => { const n = performance.getEntriesByType('navigation')[0] || {}; return {dcl: Math.round(n.domContentLoadedEventEnd || 0), load: Math.round(n.loadEventEnd || 0)}; }")
            files = await pg.evaluate("() => performance.getEntriesByType('resource').filter((e) => e.name.startsWith(location.origin)).map((e) => ({n: e.name.replace(location.origin, ''), t: e.transferSize, d: Math.round(e.duration), s: e.startTime}))")
            if os.environ.get("SPEED_FILES"):
                for f in files: print("      %8d %5d ms %s" % (f["t"], f["d"], f["n"][:110]))
            sent = [x for x in log if x["m"] != "OPTIONS"]
            row = {"label": label, "screen": screen, "rtt": rtt, "usable_ms": round(ms), "dcl_ms": nav["dcl"], "script_ms": round(m.get("ScriptDuration", 0) * 1000), "task_ms": round(m.get("TaskDuration", 0) * 1000),
                   "after": aft, "cloud_requests": n_usable, "synced_ms": synced, "cloud_requests_by_synced": len(sent), "preflights": len(log) - len(sent), "files_from_network": sum(1 for f in files if f["t"] > 0), "file_bytes_from_network": sum(f["t"] for f in files),
                   "file_bytes_after_usable": sum(f["t"] for f in files if f["s"] >= t_usable), "errors": errs[:3]}
            print("  %-34s usable %6d ms (cloud requests %2d)  synced %6d ms (cloud requests %3d)  page read %5d ms  script %5d ms  files from the network %3d (%d bytes)" % (
                label, row["usable_ms"], row["cloud_requests"], row["synced_ms"], row["cloud_requests_by_synced"], row["dcl_ms"], row["script_ms"], row["files_from_network"], row["file_bytes_from_network"]))
            print("     the 30 s after usable: %(renders)d full drawings (%(render_ms)d ms), %(long_n)d long tasks (%(long_ms)d ms, longest %(long_max)d ms); long tasks before usable: %(long_before)d ms" % aft
                  + "; files from the network after usable: %d bytes" % row["file_bytes_after_usable"])
            if errs: print("     page errors:", errs[:3])
            res["opens"].append(row)
            await cdp.detach()
            return pg

        print("\nOpening, at a %gx slower CPU (first: nothing kept; second: the files kept by the browser and its service worker):" % CPU)
        for rtt in RTTS:
            for screen in ("today", "tally"):
                log = []; ctx = await context(rtt, log)
                await open_(ctx, screen, log, "%s, wait %d ms, first" % (screen, rtt), rtt)
                await asyncio.sleep(3)
                await open_(ctx, screen, log, "%s, wait %d ms, second" % (screen, rtt), rtt)
                await ctx.close()
        base_rows = {(r["screen"], r["label"].rsplit(", ", 1)[1]): r for r in res["opens"] if r["rtt"] == 0}
        for r in res["opens"]:
            if r["rtt"]:
                b = base_rows.get((r["screen"], r["label"].rsplit(", ", 1)[1]))
                if b and r["synced_ms"] > 0 and b["synced_ms"] > 0:
                    r["round_trips_in_a_row"] = round((r["synced_ms"] - b["synced_ms"]) / r["rtt"], 1)
                    print("  %-34s about %.1f round trips one after another before synced (usable: %+d ms against no wait)" % (r["label"], r["round_trips_in_a_row"], r["usable_ms"] - b["usable_ms"]))

        if IDLE:
            print("\nLeft open %d s on each screen (wait 0): the cloud requests a minute" % IDLE)
            for screen in ("today", "tally"):
                log = []; ctx = await context(0, log)
                pg = await open_(ctx, screen, log, "%s, idle" % screen, 0)
                await asyncio.sleep(10); del log[:]; t0 = time.time()
                await asyncio.sleep(IDLE)
                mins = (time.time() - t0) / 60.0
                c = collections.Counter(x["u"] for x in log if x["m"] != "OPTIONS")
                per = {k: round(v / mins, 1) for k, v in c.most_common()}
                tot = round(sum(c.values()) / mins, 1)
                res["idle"][screen] = {"per_min": tot, "by_endpoint": per, "preflights_per_min": round(sum(1 for x in log if x["m"] == "OPTIONS") / mins, 1)}
                print("  %s: %.1f a minute (+%.1f preflights)" % (screen, tot, res["idle"][screen]["preflights_per_min"]))
                for k, v in per.items(): print("      %5.1f  %s" % (v, k))
                if os.environ.get("SPEED_FILES"):
                    for k, v in collections.Counter(x["q"][:150] for x in log if x["m"] != "OPTIONS").most_common(25): print("        %3d  %s" % (v, k))
                await ctx.close()
        await br.close()
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
    lim = os.environ.get("SPEED_MAX_IDLE")
    if lim and "today" in res["idle"] and res["idle"]["today"]["per_min"] > float(lim): fails.append("Today idle: %.1f requests a minute > %s" % (res["idle"]["today"]["per_min"], lim))
    if os.environ.get("SPEED_JSON"): json.dump(res, open(os.environ["SPEED_JSON"], "w"), indent=1)
    print("\n" + ("FAIL: " + "; ".join(fails) if fails else "done"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
