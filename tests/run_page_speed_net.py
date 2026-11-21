"""python3 tests/run_page_speed_net.py - next-fix-pagespeed (21-Nov-2026), the cloud side: what the pages ask FinCom's cloud,
on the React test build (app/dist-test, or TDSDESK_SITE) signed in to the stand-in cloud of tally_shapes.py (12 clients,
20 Tally companies), every answer WAIT ms late (default 250: about a round trip from the USA to Mumbai):

  E. Today's due list: each client's work (filed marks, challans, settings) brought in once a session (DueList.syncAll,
     src/js/68) was asked client after client, two or three round trips each, so the list waited 12 x 3 round trips
     (50 clients: 40 s on that line) before it was drawn with the figures. Now four clients at a time: the same asks, each
     client once, in about a quarter of the time.
  F. the Tally page: opening it read the whole page twice at once (TCloud.refreshPane, src/js/49: the page's own first
     read and the check every link runs), so each of its ~20 asks went twice. Now a read asked while one is going on
     waits for that one (a read that brings less, the page's few-minute look, never stands in for a full one); the page
     shows the same. A read asked by an action (Link, Revoke, Check again, a save: not the page's own look) never takes
     the answer of a read that began before it: it waits for one that begins after it (several such share it)."""
import os, sys, json, time, asyncio, functools, threading, http.server, urllib.parse, collections
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tally_shapes as TS
SITE = os.path.abspath(os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test")))
PORT = int(os.environ.get("PSN_PORT", "9581")); WAIT = int(os.environ.get("WAIT", "250"))
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
            if req.method != "OPTIONS": log.append((time.time(), req.method, u.path.split("/v1/")[-1], urllib.parse.unquote(u.query), req.post_data or ""))
            h = {"Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range", "Access-Control-Allow-Headers": "*"}; h.update(hd)
            if req.method == "OPTIONS": return await route.fulfill(status=204, headers=h)
            await route.fulfill(status=st, content_type="application/json", body=json.dumps(j), headers=h)
        await ctx.route("https://*.supabase.co/**", supa)
        await ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
        await ctx.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg = await ctx.new_page()
        await pg.goto("http://localhost:%d/#/clients" % PORT)
        await pg.wait_for_function("() => typeof S === 'object' && S && S.firm && typeof DueList === 'object' && typeof TCloud === 'object' && TCloud.on() && Object.keys(S.companies).length >= 10", timeout=90000)
        await asyncio.sleep(6)

        n = await pg.evaluate("() => Object.values(S.companies).filter((c) => c && !c.deleted && !(S.books && S.books.cid === c.id)).length")
        print("E. Today's due list: every client's work brought in, each answer %d ms late (%d clients)" % (WAIT, n))
        slow["on"] = True; del log[:]
        r = await pg.evaluate("async () => { DueList.synced = false; const t = performance.now(); const did = await DueList.syncAll(); return {ms: performance.now() - t, did, busy: DueList.busy}; }")
        slow["on"] = False
        asks = [x for x in log if x[2] == "client_book_items"]
        per = collections.Counter(x[3].split("client_id=eq.")[1].split("&")[0] for x in asks if "client_id=eq." in x[3])
        ok(r["did"] and not r["busy"], "brought in, and done (%r)" % r)
        ok(len(per) == n, "each client asked (%d of %d)" % (len(per), n))
        # one after another took (clients x round trips a client); four at a time about a quarter of that
        trips = len([x for x in log if x[1] in ("GET", "POST", "PATCH")])
        ok(r["ms"] < (trips / 4.0 + 3) * WAIT, "%d asks in %d ms: %.1f round trips one after another (at most %d; was %d, one client after another)" % (trips, r["ms"], r["ms"] / WAIT, trips / 4 + 3, trips))

        r = await pg.evaluate("""async () => { const on = typeof BookItems === 'object' && BookItems.on() ? BookItems : BookSync, f = on.pull; on.pull = () => { throw new Error('made-up'); };
          try { DueList.synced = false; await DueList.syncAll(); return [DueList.busy, 'done']; } catch (e) { return [DueList.busy, String(e.message)]; } finally { on.pull = f; } }""")
        ok(r == [0, "done"], "a client's pull that throws at once: the rest go on, and the list is not left busy (%r)" % r)
        print("F. the Tally page: its reads not made twice at once")
        await pg.evaluate("() => navHome('today')"); await asyncio.sleep(2)
        await pg.evaluate("() => { TCloud.pane.at = 0; TCloud.pane.onceAt = 0; TCloud.pane.devices = null; }")
        del log[:]
        await pg.evaluate("() => navHome('tally')"); await asyncio.sleep(6)
        dv = [x for x in log if x[2] == "tally_devices" and "main_bridge" in x[3]]
        dup = [k for k, v in collections.Counter((x[1], x[2], x[3]) for x in log if x[2] in ("tally_devices", "tally_companies", "tally_bridge_releases", "tally_selfchecks", "tally_read_stops", "tally_member_bridges")).items() if v > 1]
        ok(len(dv) == 1, "opened: the computers read once (%d)" % len(dv))
        ok(not dup, "no read of the page made twice (%s)" % dup[:4])
        ok(await pg.evaluate("() => !!(TCloud.pane.devices && TCloud.pane.devices.length) && !TCloud.pane.busy && !!document.querySelector('#app [data-tco-list], #app [data-pc-line], #app [data-tsm-rows]')"), "and the page shows the computers and companies, as before")
        # two reads asked together: one read; both callers see it done
        del log[:]
        r = await pg.evaluate("async () => { const a = TCloud.refreshPane(), b = TCloud.refreshPane(); await Promise.all([a, b]); return [!TCloud.pane.busy, (TCloud.pane.devices || []).length]; }")
        dv = [x for x in log if x[2] == "tally_devices" and "main_bridge" in x[3]]
        ok(len(dv) == 1 and r[0] and r[1] > 0, "two reads asked at once: one read, done for both (%d; %r)" % (len(dv), r))
        # the few-minute look going on, then Refresh pressed: the full read after it (a second read, the page's once-reads too)
        del log[:]
        r = await pg.evaluate("async () => { TCloud.pane.onceAt = Date.now(); const a = TCloud.refreshPane({auto: true}), b = TCloud.refreshPane(); await Promise.all([a, b]); return !TCloud.pane.busy; }")
        dv = [x for x in log if x[2] == "tally_devices" and "main_bridge" in x[3]]
        rel = [x for x in log if x[2] == "tally_bridge_releases"]
        ok(len(dv) == 1 and len(rel) == 1 and r, "Refresh pressed as the page's look is asked, before it begins: the one read, made in full (%d reads, releases %d)" % (len(dv), len(rel)))
        del log[:]
        r = await pg.evaluate("async () => { TCloud.pane.onceAt = Date.now(); const a = TCloud.refreshPane({auto: true}); await new Promise((r) => setTimeout(r, 0)); const b = TCloud.refreshPane(); await Promise.all([a, b]); return !TCloud.pane.busy; }")
        dv = [x for x in log if x[2] == "tally_devices" and "main_bridge" in x[3]]
        rel = [x for x in log if x[2] == "tally_bridge_releases"]
        ok(len(dv) == 2 and len(rel) == 1 and r, "the page's look begun, then Refresh pressed: Refresh reads in full after it (%d reads, releases %d)" % (len(dv), len(rel)))
        # a save while the first-link watcher's read goes on: the read asked after the save shows the save
        print("G. a read asked after a save shows the save, though another read was going on")
        cp = fx["tally_companies"][0]; was = cp.get("gstin"); mark = "07ZZZZZ9999Z1Z9"         # (a made-up GSTIN: the saved change)
        slow["on"] = True; del log[:]
        await pg.evaluate("() => { window.__soon = TCloud.refreshPane({soon: true}); }")
        for _ in range(200):
            if any(x[2] == "tally_companies" for x in log): break
            await asyncio.sleep(0.05)
        cp["gstin"] = mark                                       # the save, after that read asked for the companies
        r = await pg.evaluate("async (g) => { await TCloud.refreshPane(); return (TCloud.pane.companies || []).some((c) => c.gstin === g); }", mark)
        await pg.evaluate("() => window.__soon")
        slow["on"] = False
        ok(r, "a company saved while the first-link watcher's 5 s look was reading: the read asked after it shows the save")
        reads = len([x for x in log if x[2] == "tally_companies"])
        ok(reads == 2, "one more read for it, after the one going on (%d reads of the companies)" % reads)
        del log[:]
        r = await pg.evaluate("async () => { const a = TCloud.refreshPane({soon: true}); await new Promise((r) => setTimeout(r, 0)); const b = TCloud.refreshPane(), c = TCloud.refreshPane(); await Promise.all([a, b, c]); return !TCloud.pane.busy; }")
        reads = len([x for x in log if x[2] == "tally_companies"])
        ok(r and reads == 2, "two actions during a read: they share the one read after it (%d reads)" % reads)
        cp["gstin"] = was
        await br.close()
    srv.shutdown()
    print("\n" + ("%d FAILED" % len(fails) if fails else "all passed"))
    return 1 if fails else 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
