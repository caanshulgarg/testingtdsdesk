"""The GST browser helper's test stand: Chromium with the extension in extension/gst-helper loaded (unpacked, as the owner
loads it), every https://*.gst.gov.in address answered by the look-alike pages in tests/fixtures/gst-portal-fake (nothing
reaches the real portal), and https://staging.fincom.live answered by a local folder (the stand-in page, or app/dist-test).
Used by run_gst_browser_helper.py and run_gst_helper_app_ui.py.
    ctx, ext_id = start(p, fincom_dir=None, two_b=lambda period: {...})"""
import json, os, re, time, mimetypes
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
FAKE = os.path.join(HERE, "fixtures", "gst-portal-fake")
EXT = os.path.abspath(os.path.join(HERE, "..", "extension", "gst-helper"))
EXT_ID = "okajonmmjoidmaapknhpphpojodaocmg"     # fixed by the manifest's "key"
# Supabase Vault stood in as Supabase has it (vault.secrets, vault.decrypted_secrets, create_secret, update_secret;
# nothing of it granted to signed-in users), for run_migration93.py and run_gst_helper_app_ui.py
VAULT = """create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text default '', secret text not null, created_at timestamptz default now());
create or replace view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $$
  insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null) returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description) where id = secret_id $$;
revoke all on schema vault from public; revoke all on all tables in schema vault from public; revoke all on all functions in schema vault from public;"""
ROUTES = {k: v for k, v in json.load(open(os.path.join(FAKE, "ROUTES.json"))).items() if not k.startswith("_")}


def _portal(two_b, seen):
    def handle(route):
        url = route.request.url
        seen.append(url)
        path = url.split("?")[0]
        if "/__fake/" in path:
            f = os.path.join(FAKE, path.split("/__fake/")[1])
            return route.fulfill(status=200, path=f, content_type=mimetypes.guess_type(f)[0] or "text/plain")
        if path.startswith("https://gstr2b.gst.gov.in/gstr2b/auth/download"):
            period = re.search(r"period=(\d{6})", url).group(1)
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(two_b(period)))
        for k, f in ROUTES.items():
            if path == k or path.rstrip("/") == k.rstrip("/"):
                return route.fulfill(status=200, path=os.path.join(FAKE, f), content_type="text/html")
        return route.fulfill(status=404, content_type="text/html", body="<h1>Not in the look-alike</h1>")
    return handle


def _site(root, prefix):
    def handle(route):
        path = route.request.url.split("?")[0].split("#")[0]
        rel = path[len(prefix):] if path.startswith(prefix) else ""
        f = os.path.join(root, rel) if rel else os.path.join(root, "index.html")
        if os.path.isdir(f): f = os.path.join(f, "index.html")
        if not os.path.exists(f): f = os.path.join(root, "index.html")     # the app's own routes
        return route.fulfill(status=200, path=f, content_type=mimetypes.guess_type(f)[0] or "text/html")
    return handle


def start(p, fincom_dir=None, two_b=None, extra_routes=()):
    """fincom_dir: a folder served as https://staging.fincom.live/review/ (default: the stand-in page only)."""
    seen = []
    # the portal's and FinCom's addresses never resolve in this browser: every page the tests use is served by the routes
    # below, and a load that comes before them (fresh, below) fails here as it does on a machine without internet. On
    # GitHub's runners, which have internet, that first load of the tab the helper opens reached the real
    # services.gst.gov.in, came back as a page (not chrome-error://), was not loaded again, and the tests waited 30 s for
    # the look-alike's #username (CI shard 1, runs 39026690733 to 39055619436: Page.fill / Page.input_value timeouts)
    rules = "MAP *.gst.gov.in ~NOTFOUND, MAP gst.gov.in ~NOTFOUND, MAP staging.fincom.live ~NOTFOUND"
    ctx = p.chromium.launch_persistent_context("", channel="chromium", headless=True, viewport={"width": 1300, "height": 900},
                                               args=["--headless=new", "--disable-extensions-except=" + EXT, "--load-extension=" + EXT,
                                                     "--host-resolver-rules=" + rules])
    ctx.route(re.compile(r"^https://[a-z0-9.-]*gst\.gov\.in/"), _portal(two_b or (lambda period: {}), seen))
    for pat, fn in extra_routes: ctx.route(pat, fn)
    if fincom_dir: ctx.route(re.compile(r"^https://staging\.fincom\.live/review/"), _site(fincom_dir, "https://staging.fincom.live/review/"))
    ctx.route("https://staging.fincom.live/stub.html", lambda r: r.fulfill(status=200, path=os.path.join(FAKE, "fincom-stub.html"), content_type="text/html"))
    # a tab the extension opens (chrome.tabs.create) starts loading before Playwright's routes reach it, so its first load
    # goes to the network, which the stand has none of; that one load is made again once the routes are in place
    def fresh(pg):
        try:
            pg.wait_for_load_state("domcontentloaded", timeout=10000)
            if pg.url.startswith("chrome-error://"): pg.reload()
        except Exception: pass
    ctx.on("page", fresh)
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=20000)
    ext_id = sw.url.split("/")[2]
    ctx.portal_seen = seen
    return ctx, ext_id


def portal_tab(ctx):
    for pg in reversed(ctx.pages):
        if "gst.gov.in" in pg.url: return pg
    return None


def wait(pg, fn, ms=60000, step=250):
    """fn() until it is true (or ms pass), letting the browser's events run in between"""
    end = time.time() + ms / 1000.0
    while True:
        v = fn()
        if v or time.time() > end: return v
        pg.wait_for_timeout(step)
