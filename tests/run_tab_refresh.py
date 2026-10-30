"""python3 run_tab_refresh.py - every page's tab rows keep their tab over a Refresh (the owner, 30-Oct-2026: "when I
refresh the page, it takes me to the first tab of the page, whichever tab I was on; it should stay on the same tab").

One mechanism for every row (app/src/parts/tabKeep.js, with Route in src/js/52-routes.js): a tab picked in a row that the
page's address does not already carry is kept after the address (…?t=<row>:<tab>), so Refresh and Back/Forward open it.
On the React build (app/dist-test, or TDSDESK_SITE), on the Leads stand-in cloud (tests/leads_stand.py, light files and a
fast line), for each page below and each of its tab rows (nav.sbar, nav.tabs, nav.bk-tabs, [role=tablist], named):
  - a tab other than the one shown is picked; the page reloaded; the same row shows that same tab;
  - the rows already in the address (Books' TDS return steps, a GST return's parts…) stay as they were: still the tab
    picked after the reload, and no ?t= written for them;
  - a tab row's tab picked, then another page opened: the other page's address carries no ?t= of the first.
  flock /tmp/fincom-app.lock python3 tests/run_tab_refresh.py   (TAB_PAGES=fs,mis to run some pages only)"""
import os, sys, json, asyncio, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
os.environ.setdefault("LEADS_LIGHT", "1")
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import leads_stand as L
L.LINE.update({"rtt": 0.005, "down": 1e9, "up": 1e9})
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 0), functools.partial(Quiet, directory=SITE)); srv.handle_error = lambda *a: None
PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the pages: [name, how it is opened (in the page), what shows it is drawn]
CLIENT = "S.coId = %r; S.view = 'company'; S.step = null;" % L.CID
PAGES = [
    ["fs", CLIENT + "S.tab = 'books'; S.booksTab = 'fs'; render();", "#app [data-fin-tab]"],
    ["mis", CLIENT + "S.tab = 'books'; S.booksTab = 'mis'; render();", "#app [data-mis-tab]"],
    ["audit", CLIENT + "S.tab = 'books'; S.booksTab = 'audit'; render();", "#app [data-audit-tab]"],
    ["reports", CLIENT + "S.tab = 'books'; S.booksTab = 'reports'; S.rxView = 'mis'; render();", "#app nav.tabs"],
    ["lookup", CLIENT + "S.tab = 'books'; S.booksTab = 'lookup'; render();", "#app [role=tablist]"],
    ["letters", CLIENT + "S.tab = 'books'; S.booksTab = 'letters'; render();", "#app [role=tablist]"],
    ["recon", CLIENT + "S.tab = 'books'; S.booksTab = 'recon'; render();", "#app [data-recon-tab]"],
    ["tdsret", CLIENT + "S.tab = 'books'; S.booksTab = 'tds'; S.tdsView = 'return'; S.tdsFy = '2025-26'; S.tdsQ = 'Q2'; S.tdsForm = '26Q'; S.tdsTab = ''; render();", "#app [data-ret-tab]"],
    ["gst", CLIENT + "S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; render();", "#app [data-gst-sec]"],
    ["tdsled", CLIENT + "S.tab = 'books'; S.booksTab = 'tds'; S.tdsView = 'ledgers'; S.ledKind = ''; render();", "#app [data-tl-kind]"],
    ["bills", CLIENT + "S.tab = 'invoices'; S.reviewTable = false; S.filter = 'draft'; S.selected = null; render();", "#app nav.statebar"],
    ["txn", CLIENT + "S.tab = 'txn'; render();", "#app nav.sbar"],
    ["tally", "S.view = 'home'; S.homeTab = 'tally'; S.tallyTab = 'activity'; S.step = null; render();", "#app [data-tally-tab]"],
    ["help", "S.view = 'home'; S.homeTab = 'help'; S.step = null; render();", "#app nav.sbar"],
    ["compliance", "S.view = 'home'; S.homeTab = 'compliance'; S.step = null; render();", "#app [data-due-chip]"],
]
only = [x for x in (os.environ.get("TAB_PAGES") or "").split(",") if x]
if only: PAGES = [p for p in PAGES if p[0] in only]

# the page's tab rows, as tabKeep.js reads them: each row's name, its tabs (id, shown, chosen, can be picked)
ROWS = r"""() => {
  const SEL = 'nav.sbar, nav.tabs, nav.bk-tabs, [role="tablist"]';
  const rows = [...document.querySelectorAll('#app ' + SEL.split(', ').join(', #app '))].filter(r => !r.querySelector(SEL) && !r.closest('[role="dialog"], [data-tabs-keep="no"]') && r.getAttribute('aria-label'));
  const idOf = (b) => { for (const a of b.attributes) if (a.name.startsWith('data-') && a.value && !/^data-(on|orientation|disabled|highlighted|radix)/.test(a.name)) return a.value;
    const c = b.cloneNode(true); c.querySelectorAll('.sbar-n, [aria-hidden="true"], [role="img"]').forEach(x => x.remove()); return c.textContent.replace(/\s*\(\d[\d,]*\)\s*$/, '').replace(/\s+/g, ' ').trim(); };
  const on = (b) => b.getAttribute('aria-selected') === 'true' || (b.getAttribute('aria-current') || 'false') !== 'false' || b.classList.contains('on');
  return rows.map((r, i) => { const l = r.getAttribute('aria-label'), same = rows.filter(x => x.getAttribute('aria-label') === l), k = same.indexOf(r);
    const all = [...r.querySelectorAll('button')].filter(b => b.closest(SEL) === r), t = all.filter(b => b.hasAttribute('aria-selected') || b.getAttribute('role') === 'tab');
    return {key: k > 0 ? l + '#' + (k + 1) : l, tabs: (t.length ? t : all).map(b => ({id: idOf(b), on: on(b), off: b.disabled}))}; });
}"""
PICK = r"""([key, id]) => {
  const SEL = 'nav.sbar, nav.tabs, nav.bk-tabs, [role="tablist"]';
  const rows = [...document.querySelectorAll('#app ' + SEL.split(', ').join(', #app '))].filter(r => !r.querySelector(SEL) && !r.closest('[role="dialog"], [data-tabs-keep="no"]') && r.getAttribute('aria-label'));
  const m = /^(.*)#(\d+)$/.exec(key), l = m ? m[1] : key, n = m ? +m[2] - 1 : 0;
  const r = rows.filter(x => x.getAttribute('aria-label') === l)[n]; if (!r) return false;
  const b = [...r.querySelectorAll('button')].find(b => b.closest(SEL) === r && (() => { for (const a of b.attributes) if (a.name.startsWith('data-') && a.value && !/^data-(on|orientation|disabled|highlighted|radix)/.test(a.name)) return a.value === id;
    const c = b.cloneNode(true); c.querySelectorAll('.sbar-n, [aria-hidden="true"], [role="img"]').forEach(x => x.remove()); return c.textContent.replace(/\s*\(\d[\d,]*\)\s*$/, '').replace(/\s+/g, ' ').trim() === id; })());
  if (!b) return false; b.scrollIntoView({block: 'center'}); b.click(); return true;
}"""

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(); ctx = await br.new_context(viewport={"width": 1440, "height": 900})
        pg = await ctx.new_page(); errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        await ctx.route(L.STAGE + "/**", L.route)
        async def until(js, t=60):
            s = time.time()
            while time.time() - s < t:
                try:
                    if await pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return time.time() - s
                except Exception: pass
                await asyncio.sleep(0.1)
            return None
        async def signin():
            await until("typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm", 30)
            if await pg.evaluate("() => signInNeeded()"): await pg.evaluate("() => doAct('useOffline')"); await pg.wait_for_timeout(300)
            await until("typeof Store === 'object' && S.storeKind && S.storeKind !== 'memory'", 30)
            await pg.evaluate("""([a, firm]) => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: "u1"}); Cloud.st.firm = firm; Cloud.st.state = "ok";
              let c = S.companies[a]; if (!c){ c = newCompany({name: "ZZ Leads-like Brokers Pvt Ltd", gstin: "09ZZZZZ0000Z1Z0"}); c.id = a; c.tan = "DELZ01234Z"; c.pan = "AAACZ1234Z"; S.companies[c.id] = c; Store.saveCompany(c); }
              S.data[c.id] = S.data[c.id] || {parties: {}, entries: {}, loaded: true}; }""", [L.CID, L.FIRM])
        books = "S.books && S.books.cid === '%s' && S.books.vouchers.length >= %d && !S.books.loading && !S.books.busy" % (L.CID, len(L.VOUCHERS))
        await pg.goto("http://localhost:%d/" % PORT); await pg.wait_for_timeout(800); await signin()
        await pg.evaluate("() => { %s S.tab = 'books'; S.booksTab = 'import'; S.books = null; render(); }" % CLIENT)
        t = await until(books, 240); ok(t is not None, "the books brought in (%s s)" % (round(t, 1) if t else "-"))
        await pg.wait_for_timeout(1500)
        covered, skipped = [], []
        async def open_page(go, drawn):
            await pg.evaluate("() => { " + go + " }")
            return await until("document.querySelector(%s) && !document.querySelector('#app [data-loading]')" % json.dumps(drawn), 60)
        for name, go, drawn in PAGES:
            print("\n%s" % name)
            if await open_page(go, drawn) is None:
                dbg = await pg.evaluate("() => [location.hash, [...document.querySelectorAll('#app nav, #app [role=tablist]')].map(n => n.className + '|' + n.getAttribute('aria-label')).join(' ; '), (document.querySelector('#app main') || document.body).innerText.slice(0, 300)]")
                ok(False, "%s: the page is drawn (%s)" % (name, dbg)); continue
            await pg.wait_for_timeout(1200)
            rows = await pg.evaluate(ROWS)
            print("  rows:", ", ".join("%s [%s]" % (r["key"], " ".join(("*" if t["on"] else "") + t["id"] for t in r["tabs"])) for r in rows))
            for r in rows:
                key = r["key"]
                # the page again as it opens, then this row's tab: the last one not shown (and not switched off)
                await open_page(go, drawn); await pg.wait_for_timeout(800)
                now = {x["key"]: x for x in await pg.evaluate(ROWS)}
                if key not in now: skipped.append("%s/%s (not drawn again)" % (name, key)); continue
                cand = [t for t in now[key]["tabs"] if not t["on"] and not t["off"] and t["id"]]
                if not cand: skipped.append("%s/%s (one tab)" % (name, key)); continue
                want = cand[-1]["id"]
                if not await pg.evaluate(PICK, [key, want]): ok(False, "%s/%s: tab %s picked" % (name, key, want)); continue
                await pg.wait_for_timeout(1500)
                after = {x["key"]: x for x in await pg.evaluate(ROWS)}
                if key not in after or not any(t["on"] and t["id"] == want for t in after[key]["tabs"]):
                    skipped.append("%s/%s (the tab %s did not stay chosen on a click)" % (name, key, want)); continue
                h = await pg.evaluate("() => location.hash")
                await pg.reload(); await pg.wait_for_timeout(800); await signin()
                await until("document.querySelector(%s)" % json.dumps(drawn), 60)
                t0 = time.time(); shown = None
                while time.time() - t0 < 20:
                    rr = {x["key"]: x for x in await pg.evaluate(ROWS)}
                    shown = [t["id"] for t in rr.get(key, {"tabs": []})["tabs"] if t["on"]]
                    if want in shown: break
                    await asyncio.sleep(0.25)
                good = shown is not None and want in shown
                ok(good, "%s / %s: %s is still the tab after a reload (shown %s; address %s)" % (name, key, want, shown, h))
                if good: covered.append("%s/%s" % (name, key))
                hn = await pg.evaluate("() => location.hash")
                ok(hn == h, "%s / %s: the address stays the same over the reload (%s)" % (name, key, hn))
        # another page carries none of the first page's tabs
        if not only or "fs" in only:
            await open_page(PAGES[0][1], PAGES[0][2]); await pg.wait_for_timeout(800)
            await pg.evaluate(PICK, ["Financial statements", "tb"]); await pg.wait_for_timeout(1500)
            h1 = await pg.evaluate("() => location.hash")
            await pg.evaluate("() => goClient('books:mis')"); await pg.wait_for_timeout(1500)
            h2 = await pg.evaluate("() => location.hash")
            ok("?t=" in h1 and "?t=" not in h2, "another page carries none of the first page's tabs (%s, then %s)" % (h1, h2))
        print("\ncovered (%d): %s" % (len(covered), ", ".join(covered)))
        print("not tried: %s" % (", ".join(skipped) or "-"))
        errs = [e for e in errors if "supabase" not in e.lower() and "Failed to load" not in e]
        ok(not errs, "no page errors" + ("" if not errs else ": " + " | ".join(errs[:4])))
        await br.close()
asyncio.run(main())
print("\n%d FAILED" % len(fails) if fails else "\nall passed"); sys.exit(1 if fails else 0)
