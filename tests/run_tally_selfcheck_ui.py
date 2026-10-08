"""python3 run_tally_selfcheck_ui.py - next release, item e (07-Oct-2026; docs/selfcheck-requests-for-approval.md, migration
65): the Tally page says each company's last nightly self-check in plain words, under its computer:
  - the latest row per company of tally_selfchecks (the firm's rows, as row security gives them), the words as the cloud
    wrote them; an older row of the same company is not shown;
  - ok / fetched: a green tag; missing / not checked / the copy not adding up: a red tag; the words name the days for a Day
    Book upload;
  - a last check more than two nights ago: "Not checked since <day>" first, an amber tag;
  - another computer's companies are not listed under this one;
  - a cloud without the table (migration 65 not run): no line, no error, the rest of the page as before;
  - plain words only: no field names; staff see the same as the owner; nothing to press.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_selfcheck_ui.py
RED (before the change): no [data-selfcheck] line on the page."""
import os, re, sys, threading, functools, http.server, datetime, copy
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
from alerts_seed import D1, dev, SETUP
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
D2 = "d0000000-0000-4000-8000-000000000002"
CO, CO2, CO3 = "GARG SHEKHAR & COMPANY", "ZZ TEST", "OTHER PC CO"
utc = datetime.datetime.utcnow()
def ago(h): return (utc - datetime.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")
W_OK = "Checked on the night of 06-Oct-2026 at 23:10 IST: every change Tally made since the night of 05-Oct-2026 is in FinCom (42 checked). FinCom's copy adds up."
W_MISS = "Checked on the night of 06-Oct-2026 at 23:12 IST: 3 entries missing from FinCom (entries are not fetched for this company now: Tally took 3.1 s for one entry): upload the Day Book for 03-Oct-2026, 05-Oct-2026. FinCom's copy adds up."
W_OLDER = "Checked on the night of 05-Oct-2026 at 23:10 IST: nothing changed in Tally since the last check. FinCom's copy adds up."
W_NOT = "Not checked on the night of 03-Oct-2026 (23:10 IST): Tally took longer than 2 s to list its changes. Upload the Day Book from 02-Oct-2026 to today to be sure nothing is missing."
def row(i, book, co, at, result, words, devid=D1, copy_ok=True):
    return {"id": i, "book_id": book, "device_id": devid, "company": co, "ran_at": at, "night": at[:10], "result": result, "words": words, "still_missing": 3 if result == "missing" else 0,
            "fetched": 0, "copy_ok": copy_ok}
ROWS = [row(1, "b1", CO, ago(30), "ok", W_OLDER), row(2, "b1", CO, ago(8), "ok", W_OK), row(3, "b2", CO2, ago(7), "missing", W_MISS),
        row(4, "b3", CO3, ago(9), "ok", W_OK.replace("42", "5"), devid=D2),
        dict(row(5, "b4", "ANOTHER USER CO", ago(5), "ok", W_OK.replace("42", "7")), bridge="go-9")]   # another Windows user's bridge on the same key
def devs():
    d = dev(recording=True); b = d["info"]["bridges"]["go-1"]; bt = d["info"]["beat"]
    b["open"] = [CO, CO2]; bt["open"] = [CO, CO2]; b["version"] = "2.3.2"
    return [d]
srv = http.server.ThreadingHTTPServer(("localhost", 8363), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1440, "height": 950}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8363/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    def scene(rows, role="owner", missing_table=False):
        E(SETUP, [{"devs": devs(), "alerts": [], "gap": None}, role])
        # the firm's nightly checks as the cloud gives them (tally_selfchecks), or a cloud without the table (42P01)
        E("""([rows, missing]) => { const api = Cloud.api; window.__w.sc = rows; window.__w.scMissing = missing;
          Cloud.api = async (p) => { if (/^tally_selfchecks/.test(p)){ window.__w.asked.push(p); if (window.__w.scMissing) throw new Error('relation "public.tally_selfchecks" does not exist (42P01)'); return JSON.parse(JSON.stringify(window.__w.sc)); } return api(p); };
          TCloud.restAll = async (u) => Cloud.api(u); }""", [rows, missing_table])
        E("() => navHome('tally')"); pg.wait_for_timeout(1200)
        E("() => TCloud.refreshPane()"); pg.wait_for_timeout(1200)
    lines = lambda devid=D1: E("""(d) => [...document.querySelectorAll('#app [data-computer="' + d + '"] [data-selfcheck]')].map(e => ({key: e.getAttribute('data-selfcheck'),
        result: e.getAttribute('data-selfcheck-result'), tag: (e.querySelector('.tag') || {className: ''}).className, co: (e.querySelector('.tag') || {innerText: ''}).innerText.trim(),
        words: (e.querySelector('[data-selfcheck-words]') || {innerText: ''}).innerText.trim(), buttons: e.querySelectorAll('button').length}))""", devid)
    # ---- 1. the owner: one line per company, the latest check, in the cloud's words
    scene(ROWS)
    ok(any(re.match(r"^tally_selfchecks\?select=.*order=ran_at\.desc", a) for a in E("() => window.__w.asked")), "the page asks the firm's nightly checks, the latest first")
    ls = lines()
    by = {l["co"]: l for l in ls}
    ok(len(ls) == 2 and set(by) == {CO, CO2}, "one line per company of this computer (%s)" % [l["co"] for l in ls])
    ok(by.get(CO, {}).get("words") == W_OK and "tag ok" in by.get(CO, {}).get("tag", "") and by.get(CO, {}).get("result") == "ok", "the latest check of a company, green (%s)" % by.get(CO))
    ok(W_OLDER not in pg.inner_text("#app"), "an older check of the same company is not shown")
    m = by.get(CO2, {})
    ok(m.get("words") == W_MISS and "tag bad" in m.get("tag", "") and "upload the Day Book for 03-Oct-2026, 05-Oct-2026" in m.get("words", ""), "entries still missing: red, the Day Book's days named (%s)" % m)
    ok(CO3 not in [l["co"] for l in ls] and W_OK.replace("42", "5") not in pg.inner_text('#app [data-computer="%s"]' % D1), "another computer's company is not listed here")
    ok("ANOTHER USER CO" not in [l["co"] for l in ls], "another Windows user's bridge's check is not on this bridge's line")
    ok(all(l["buttons"] == 0 for l in ls), "nothing to press")
    page = pg.inner_text("#app")
    ok(not re.search(r"still_missing|copy_ok|ran_at|tally_selfchecks|not_checked|book_id", page), "plain words: no field names on the page")
    # ---- 2. not checked for more than two nights; a not-checked night; the copy not adding up
    scene([row(5, "b1", CO, ago(80), "not_checked", W_NOT), row(6, "b2", CO2, ago(6), "ok", W_OK, copy_ok=False)])
    by = {l["co"]: l for l in lines()}
    w = by.get(CO, {}).get("words", "")
    ok(w.startswith("Not checked since the night of ") and W_NOT in w and "tag warn" in by.get(CO, {}).get("tag", ""), "a last check over two nights ago: 'Not checked since', amber (%s)" % w)
    ok("tag bad" in by.get(CO2, {}).get("tag", ""), "the copy not adding up: red (%s)" % by.get(CO2))
    # ---- 3. staff see the same
    scene(ROWS, role="member")
    ok({l["co"]: l["words"] for l in lines()} == {CO: W_OK, CO2: W_MISS}, "staff: the same lines")
    # ---- 4. a cloud without migration 65: nothing shown, no error, the computer's line as before
    scene(ROWS, missing_table=True)
    # release-240: 2.3.5's card says the computer's state in its one status line ([data-status-line]; plain reading has no
    # [data-read-text] of its own any more)
    ok(lines() == [] and pg.locator('#app [data-computer="%s"] [data-status-line]' % D1).count() == 1 and not pg.locator("#app [data-control-err]").count(),
       "no table: no line, the rest of the page as before")
    ok(not errors, "no page errors " + str(errors[:2]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
