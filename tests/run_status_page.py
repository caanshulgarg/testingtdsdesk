"""python3 run_status_page.py - the status page (status/index.html, at staging.fincom.live/status/; reliability item 5)
and its links in the app. The page is served with a made-up status/status.json as the uptime watch writes it
(.github/scripts/uptime_check.py):
  - "FinCom app", "Cloud (database)", "Tally connection service", each All good or Problem (with what is wrong);
  - the last check's time in IST; a note when the watch's last check is old;
  - the last 30 days: a bar a day (an hour and 12 minutes down yesterday: 95.00% that day) and the 30 days' uptime
    (99.83%); days before the watch began show no data;
  - light and dark, phone width without sideways scrolling; it asks nothing of the database (works with Supabase down)
    and says so when status.json cannot be read;
  - in the app (app/dist-test): a Status link in Help and in "Your data".
A failure here fails CI (tests/ci/tests.txt). Run: TDSDESK_SITE=../app/dist-test python3 run_status_page.py"""
import os, re, json, shutil, tempfile, threading, functools, http.server, datetime
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "..", "status", "index.html")
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
if not os.path.isabs(SITE): SITE = os.path.join(HERE, SITE)
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self): self.send_header("Cache-Control", "no-store"); super().end_headers()

root = tempfile.mkdtemp(prefix="statuspage-")
os.makedirs(os.path.join(root, "status")); shutil.copy(PAGE, os.path.join(root, "status", "index.html"))
srv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(Quiet, directory=root)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/status/" % srv.server_address[1]
UTC, IST = datetime.timezone.utc, datetime.timezone(datetime.timedelta(hours=5, minutes=30))
iso = lambda t: t.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
now = datetime.datetime.now(UTC).replace(microsecond=0)
today_ist = now.astimezone(IST).replace(hour=0, minute=0, second=0, microsecond=0)
y10 = today_ist - datetime.timedelta(days=1) + datetime.timedelta(hours=10)   # yesterday 10:00 IST
def write(st): json.dump(st, open(os.path.join(root, "status", "status.json"), "w"))
def status(checked, cloud_ok=True, since_days=45):
    return {"checked": iso(checked), "every_minutes": 5, "watch_since": iso(now - datetime.timedelta(days=since_days)), "site": "https://staging.fincom.live", "fail_streak": 0 if cloud_ok else 3,
            "services": {"app": {"name": "FinCom app", "ok": True, "note": "", "since": iso(y10 + datetime.timedelta(minutes=72))},
                         "cloud": {"name": "Cloud (database)", "ok": cloud_ok, "note": "" if cloud_ok else "the database's health check answered 503", "since": iso(checked)},
                         "bridge": {"name": "Tally connection service", "ok": True, "note": "", "since": iso(now - datetime.timedelta(days=3))}},
            "incidents": [{"service": "app", "start": iso(y10), "end": iso(y10 + datetime.timedelta(minutes=72))}] +
                         ([] if cloud_ok else [{"service": "cloud", "start": iso(checked - datetime.timedelta(minutes=20)), "end": None}])}

with sync_playwright() as p:
    br = p.chromium.launch()
    def open_page(scheme="light", vp=(1280, 900)):
        ctx = br.new_context(viewport={"width": vp[0], "height": vp[1]}, color_scheme=scheme)
        asked = []
        ctx.route(re.compile(r"^https?://(?!localhost).*"), lambda r: (asked.append(r.request.url), r.abort()))
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(URL); pg.wait_for_timeout(1200)
        return ctx, pg, asked, errs
    # ---- all good, checked 3 minutes ago
    checked = now - datetime.timedelta(minutes=3)
    write(status(checked))
    ctx, pg, asked, errs = open_page()
    rows = pg.locator("[data-service]")
    ok(rows.count() == 3 and [rows.nth(i).locator("[data-name]").inner_text() for i in range(3)] == ["FinCom app", "Cloud (database)", "Tally connection service"], "the three services, in order")
    ok(all(rows.nth(i).locator("[data-state]").inner_text().strip() == "All good" for i in range(3)), "each All good")
    ok("All systems working" in pg.locator("[data-overall]").inner_text(), "the overall line: all working")
    want = checked.astimezone(IST).strftime("%d-%b-%Y, %I:%M %p IST").replace(", 0", ", ")
    lc = pg.locator("[data-last-check]").inner_text()
    ok(want in lc, "the last check in IST (%s in %r)" % (want, lc))
    ok(pg.locator("[data-stale]").count() == 0, "no 'old check' note")
    app = rows.nth(0)
    ok(app.locator("[data-day]").count() == 30, "30 days of bars (%d)" % app.locator("[data-day]").count())
    yday = app.locator("[data-day]").nth(28)
    ok(yday.get_attribute("data-up") == "95.00" and "1 h 12 min" in (yday.get_attribute("title") or ""), "yesterday: 95.00%% (down 1 h 12 min) (%s, %r)" % (yday.get_attribute("data-up"), yday.get_attribute("title")))
    ok(app.locator("[data-day]").nth(29).get_attribute("data-up") == "100.00", "today: 100.00%")
    ok("99.83%" in app.locator("[data-uptime]").inner_text(), "the app's 30 days: 99.83%% (%s)" % app.locator("[data-uptime]").inner_text())
    ok("100.00%" in rows.nth(1).locator("[data-uptime]").inner_text(), "the database's 30 days: 100.00%")
    ok(not asked, "the page asks nothing of any other address: no database, no font or script from elsewhere (%s)" % asked[:3])
    ok(not errs, "no page error (%s)" % errs[:2])
    light_bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
    title = pg.title()
    ok(title and "FinCom" in title and "status" in title.lower(), "the page's title: " + title)
    ctx.close()
    # ---- a problem now, and a watch that began 10 days ago
    write(status(checked, cloud_ok=False, since_days=10))
    ctx, pg, asked, errs = open_page()
    cloud = pg.locator("[data-service]").nth(1)
    ok(cloud.locator("[data-state]").inner_text().strip() == "Problem" and "503" in cloud.inner_text(), "Cloud (database): Problem, with what is wrong")
    ok("problem" in pg.locator("[data-overall]").inner_text().lower(), "the overall line says there is a problem")
    days = pg.locator("[data-service]").nth(0).locator("[data-day]")
    ok(days.nth(0).get_attribute("data-up") == "" and days.nth(25).get_attribute("data-up") == "100.00", "days before the watch began show no data")
    ok(cloud.locator("[data-day]").nth(29).get_attribute("data-up") not in ("100.00", ""), "today's bar of the database shows the time down so far")
    ctx.close()
    # ---- an old check: said so
    write(status(now - datetime.timedelta(hours=3)))
    ctx, pg, asked, errs = open_page()
    ok(pg.locator("[data-stale]").count() == 1, "the watch's last check over 2 hours ago: said so (%s)" % (pg.locator("[data-stale]").inner_text() if pg.locator("[data-stale]").count() else ""))
    ctx.close()
    # ---- dark, and phone width
    write(status(checked))
    ctx, pg, asked, errs = open_page(scheme="dark")
    dark_bg = pg.evaluate("getComputedStyle(document.body).backgroundColor")
    lum = lambda c: sum(map(int, re.findall(r"\d+", c)[:3])) / 3
    ok(lum(light_bg) > 200 and lum(dark_bg) < 60, "light and dark (%s / %s)" % (light_bg, dark_bg))
    ctx.close()
    ctx, pg, asked, errs = open_page(vp=(375, 812))
    ok(pg.evaluate("document.documentElement.scrollWidth <= 375") and pg.locator("[data-service]").nth(2).is_visible(), "phone width: no sideways scroll, every service shown")
    ctx.close()
    # ---- status.json not readable
    os.remove(os.path.join(root, "status", "status.json"))
    ctx, pg, asked, errs = open_page()
    ok("could not be read" in pg.locator("body").inner_text(), "status.json missing: the page says the status could not be read")
    ctx.close()
    src = open(PAGE).read()
    ok("supabase" not in src.lower() and "<script src" not in src and "@import" not in src, "the page's file: no database, no outside script or stylesheet")

    # ---- the links in the app
    if os.path.isdir(SITE):
        asrv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(Quiet, directory=SITE)); threading.Thread(target=asrv.serve_forever, daemon=True).start()
        ctx = br.new_context(viewport={"width": 1400, "height": 950})
        ctx.route(re.compile(r"^https://[^/]*(supabase\.co|sentry\.io)/.*"), lambda r: r.abort())
        pg = ctx.new_page()
        pg.goto("http://localhost:%d/" % asrv.server_address[1]); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
        pg.evaluate("navHome('help')"); pg.wait_for_timeout(2500)
        a = pg.locator("#app a[data-status-link]")
        ok(a.count() == 1 and a.inner_text().strip() == "Status" and a.get_attribute("href") == "https://staging.fincom.live/status/", "Help: a Status link to staging.fincom.live/status/")
        ok(a.count() == 1 and a.get_attribute("target") == "_blank" and "noopener" in (a.get_attribute("rel") or ""), "it opens in a new tab")
        pg.click("button[data-your-data]"); pg.wait_for_timeout(800)
        d = pg.locator("[role=dialog] a[data-status-link], .modal a[data-status-link], a[data-status-link]:visible")
        ok(d.count() >= 1 and d.first.get_attribute("href") == "https://staging.fincom.live/status/", "Your data: a Status link at its foot")
        ctx.close(); asrv.shutdown()
    else:
        ok(False, "app/dist-test is needed for the links' check")
    br.close()
srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
