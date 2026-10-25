"""python3 run_books_speed.py - the owner, 24-Oct-2026 (Mac Safari, Leads Insurance with two years of Tally entries):
"Speed of the system is very slow.. every time it loads books.. why".
On staging that day the Mac downloaded all 560 day files of Leads again (6.2 MB, 10:14-10:16 UTC) and fetched every
client's TDS/GST work from the start (seq 0), right after it signed in again: this browser's copy was not used.
A stand-in cloud with a book shaped like Leads (tests/leads_stand.py: 4,414 entries on 560 days, 749 ledgers, 2,806 items
of work) on an office line (150 ms, 9 Mbit/s) with the CPU 4x slower (a Mac on an office line, roughly). Budgets:
  1. first opening (nothing kept; fast-firstopen, the owner 25-Oct-2026: "start faster first open"): the client usable
     (the TDS page with the server's figures or the entries, no page-wide loader) within FIRST_USABLE_MS (5 s); the latest
     year's entries on the TDS page within FIRST_FY_MS (15 s), the older year still coming in, said on one quiet line, the
     pages that need it waiting for it; every entry in and the books worked out within FIRST_ALL_MS (30 s). With FinCom's
     server answering a month of day files at once (tally-ingest month_days, after its deploy: 19 requests, not 560) and
     without it (today: the day files, sixteen at a time). 1z: the books end exactly as the load before fast-firstopen
     makes them (every kept part of the books, the TDS rows, GSTR-3B of every month, the trial balances);
  2. reopening after a reload: the TDS page usable from the copy here within REOPEN_MAX_MS (1,500 ms); no day file, no
     work fetched from the start, the cloud copy's entries never read in full;
  3. switching pages (TDS, GST, MIS, Reports, Bank, back to TDS): the books are never opened or read again, nothing is
     fetched from the cloud copy for it, each page drawn within SWITCH_MAX_MS (2,500 ms at 4x: MIS and Reports work out the year when first shown);
  4. client A -> B -> A: A usable again within REOPEN_MAX_MS, no day file, no work from the start, A's books not read from
     this browser's store again (kept in memory for the session);
  5. a publish (the worker and its caches cleared as the Safari self-heal does, a new build): the books copy kept;
  6. this browser's store slow to open (Safari: IndexedDB answering after 6 s): the copy is still used once it answers,
     never the whole book downloaded again;
  7. a change coming in live (a colleague's item, and this computer's own save coming back): the books are not opened or
     read again and not written whole;
  8. the firm's Today page with the due list: the other clients' books not read from the store again and again;
  9. a client's counts that depend on the computer (bills to check, ready, needing attention) are not sent to the firm
     account (two computers sent their own counts back and forth all day: 3,774 saves of one client on staging).
  Also: 2b a colleague's change made while this browser was closed comes in behind the page; 2c the entries are still
  checked in full every 6 hours.
  flock /tmp/fincom-app.lock python3 tests/run_books_speed.py   (TDSDESK_SITE defaults to ../app/dist-test)"""
import os, sys, json, asyncio, threading, functools, http.server, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.async_api import async_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import leads_stand as L
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("BOOKS_SPEED_PORT") or 8473)
CPU = float(os.environ.get("CPU_SLOWDOWN") or 4)
REOPEN = int(os.environ.get("REOPEN_MAX_MS") or 1500)
SWITCH = int(os.environ.get("SWITCH_MAX_MS") or 2500)
FIRST_USABLE = int(os.environ.get("FIRST_USABLE_MS") or 5000)
FIRST_FY = int(os.environ.get("FIRST_FY_MS") or 15000)
FIRST_ALL = int(os.environ.get("FIRST_ALL_MS") or 30000)
# the books as kept (every part saveBooks keeps) and what the pages work out of them, the times of things left out (and
# MIS's basis, a hash of the books' times: MIS.basis)
FINGER = r"""() => { const b = S.books, T = ['at', 'fullAt', 'openMs', 'readyMs', 'openAt', 'basis'];
  const j = (o) => JSON.stringify(o === undefined ? null : o, (k, v) => T.includes(k) ? undefined : v), out = {}, tryj = (f) => { try { return j(f()); } catch (e) { return 'error: ' + e.message; } };
  BOOKS_KEYS.forEach(k => { out['books.' + k] = j(b[k]); });
  out.tdsRows = tryj(() => TDS.rows().map(r => [r.id, r.fy, r.q, r.section, r.party, r.pan, r.paid, r.tds, r.date, r.challan || '']));
  out.gst3b = tryj(() => GSTR.months().map(ym => [ym, GSTR.threeBNow(ym)]));
  out.tb2526 = tryj(() => FC.tbBooks('20260331').rows); out.tbNow = tryj(() => FC.tbBooks(Audit.today()).rows);
  out.n = b.vouchers.length; return out; }"""
NOFO = "Object.defineProperty(window, 'loadFirstOpen', {get(){ return undefined; }, set(v){}})"
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the long tasks on the main thread, and (phase 6) IndexedDB answering late
INIT = r"""(() => {
  window.__lt = 0;
  try { new PerformanceObserver(l => { l.getEntries().forEach(e => { window.__lt += e.duration; }); }).observe({entryTypes: ['longtask']}); } catch (e) {}
  let slow = 0; try { slow = Number(sessionStorage.getItem('zz-idb-slow') || 0); sessionStorage.removeItem('zz-idb-slow'); } catch (e) {}
  if (slow && window.indexedDB){
    const open = indexedDB.open.bind(indexedDB), t0 = Date.now();
    indexedDB.open = function(){
      const r = open.apply(null, arguments);
      // the request's answer held until `slow` ms after the page began (Safari right after a publish / a fresh sign-in)
      const fake = {result: undefined, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, readyState: 'pending'};
      r.onupgradeneeded = (ev) => { if (fake.onupgradeneeded){ fake.result = r.result; fake.onupgradeneeded(ev); } };
      r.onsuccess = () => setTimeout(() => { fake.result = r.result; fake.readyState = 'done'; if (fake.onsuccess) fake.onsuccess({target: fake}); }, Math.max(0, slow - (Date.now() - t0)));
      r.onerror = () => { fake.error = r.error; if (fake.onerror) fake.onerror({target: fake}); };
      r.onblocked = () => { if (fake.onblocked) fake.onblocked({target: fake}); };
      return fake;
    };
  }
})()"""
# counters on the app's own functions (installed once per page)
WRAP = r"""() => {
  if (window.__m) return;
  const m = window.__m = {booksLoad: 0, booksLoadMs: 0, booksSave: 0, booksSaveMs: 0, opens: 0, tcloud: 0, renders: 0, storeReads: 0};
  const g = IDBStore.get; IDBStore.get = function(k){ if (/^books:/.test(k)) m.storeReads++; return g.apply(this, arguments); };
  const wrapA = (o, k, n, ms) => { const f = o[k]; o[k] = async function(){ const t = performance.now(); m[n]++; try { return await f.apply(this, arguments); } finally { if (ms) m[ms] += performance.now() - t; } }; };
  wrapA(Books, 'load', 'booksLoad', 'booksLoadMs'); wrapA(Books, 'save', 'booksSave', 'booksSaveMs'); wrapA(TCloud, 'load', 'tcloud');
  const ob = window.openBooksNow; window.openBooksNow = function(){ m.opens++; return ob.apply(this, arguments); };
  const r = window.render; window.render = function(){ m.renders++; return r.apply(this, arguments); };
}"""
READY = "S.books && S.books.cid === '%s' && !S.books.loading && (S.books.vouchers || []).length >= %d && document.querySelector('#app %s') && !document.querySelector('#app [data-loading]')"

# tally-ingest's month_days answer, read back with the browser's rule (server/tally-cloud/monthpack_test.ts, under Deno:
# DENO, else on the PATH; on CI it must run)
def deno_monthpack():
    import shutil, subprocess
    deno = os.environ.get("DENO") or shutil.which("deno")
    if not deno:
        print("  FAIL Deno is not installed (CI must run monthpack_test.ts)" if os.environ.get("GITHUB_ACTIONS") else "  skipped: monthpack_test.ts (no Deno here; set DENO=/path/to/deno)")
        if os.environ.get("GITHUB_ACTIONS"): fails.append("deno")
        return
    r = subprocess.run([deno, "test", "server/tally-cloud/monthpack_test.ts"], cwd=os.path.join(HERE, ".."), capture_output=True, text=True, env=dict(os.environ, NO_COLOR="1"))
    ok(r.returncode == 0, "deno test server/tally-cloud/monthpack_test.ts" + ("" if r.returncode == 0 else ": " + (r.stdout + r.stderr)[-400:]))
deno_monthpack()

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(); ctx = await br.new_context(viewport={"width": 1366, "height": 900})
        await ctx.add_init_script(INIT); pg = await ctx.new_page()
        errors = []; pg.on("pageerror", lambda e: errors.append(str(e)))
        await ctx.route(L.STAGE + "/**", L.route)
        cdp = await ctx.new_cdp_session(pg); await cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU})
        async def until(js, t=240):
            s = time.time()
            while time.time() - s < t:
                try:
                    if await pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return time.time() - s
                except Exception: pass
                await asyncio.sleep(0.03)
            return None
        async def quiet(sec=2.5, t=240):
            s = time.time()
            while time.time() - s < t:
                if time.time() - (L.LOG[-1][0] if L.LOG else 0) > sec: return
                await asyncio.sleep(0.2)
        async def boot():
            await pg.goto("http://localhost:%d/" % PORT); await pg.wait_for_timeout(1200)
            if await pg.locator('button[data-act="useOffline"]').count(): await pg.click('button[data-act="useOffline"]'); await pg.wait_for_timeout(300)
            await until("typeof Store === 'object' && S.storeKind && S.storeKind !== 'memory'", 30)
            await pg.evaluate("""([a, b, firm]) => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600, user_id: "u1"}); Cloud.st.firm = firm; Cloud.st.state = "ok";
              [[a, "ZZ Leads-like Brokers Pvt Ltd"], [b, "ZZ Small Traders"]].forEach(([cid, name]) => {
                let c = S.companies[cid]; if (!c){ c = newCompany({name, gstin: ""}); c.id = cid; c.tan = "DELZ01234Z"; c.pan = "AAACZ1234Z"; S.companies[c.id] = c; Store.saveCompany(c); }
                S.data[c.id] = S.data[c.id] || {parties: {}, entries: {}, loaded: true}; }); }""", [L.CID, L.CID_B, L.FIRM])
            await pg.evaluate(WRAP)
        async def m(): return await pg.evaluate("() => Object.assign({lt: Math.round(window.__lt)}, window.__m)")
        def delta(a, b): return {k: round(b[k] - a[k]) for k in b if isinstance(b[k], (int, float))}
        async def open_client(cid, label, sel="[data-tds-page]", n=1, fresh=False):
            # fresh: the books not in this page yet (as when the client is opened in a new page), else a switch of client
            await pg.evaluate("([cid, fresh]) => { S.coId = cid; S.view = 'company'; S.tab = 'books'; S.booksTab = 'tds'; S.tdsView = 'year'; S.tdsFy = '2026-27'; if (fresh) S.books = null; render(); }", [cid, fresh])
            t = await until(READY % (cid, n, sel))
            om = await pg.evaluate("() => S.books && S.books.openMs")
            print("  %-34s usable in %s ms (books open %s ms)" % (label, int(t * 1000) if t is not None else "-", om))
            return t
        # ---------- 1. a fresh browser (fast-firstopen)
        async def first_open(label):
            """the first opening on this page's browser: (marks in s, the stand's counts)"""
            await boot(); await quiet(1.5); t0 = time.time(); a = await m()
            # the marks taken in the page (every 50 ms, from the moment the client is opened), not by asking it from here
            await pg.evaluate("""([cid, n]) => { const t0 = performance.now(), mk = window.__fo = {}, app = (q) => document.querySelector('#app ' + q);
              const probes = {usable: () => app('[data-srv-tds], [data-tds-page]') && !app('[data-loading]'),
                fy: () => S.books && S.books.cid === cid && (S.books.vouchers || []).some(v => String(v.date) >= '20260401') && app('[data-tds-page]') && !app('[data-loading]'),
                all: () => S.books && S.books.cid === cid && S.books.vouchers.length === n && S.books.meta && S.books.meta.cloud && !S.books.busy && S.books.readyMs > 0};
              const tick = () => { Object.entries(probes).forEach(([k, f]) => { if (!(k in mk)) { let hit = false; try { hit = !!f(); } catch (e) {} if (hit) mk[k] = performance.now() - t0; } }); if (Object.keys(mk).length < 3) setTimeout(tick, 50); };
              S.coId = cid; S.view = 'company'; S.tab = 'books'; S.booksTab = 'tds'; S.tdsView = 'year'; S.tdsFy = '2026-27'; S.books = null; render(); tick(); }""", [L.CID, len(L.VOUCHERS)])
            partial = None
            while time.time() - t0 < 240:
                mk = await pg.evaluate("() => window.__fo")
                if "fy" in mk and "all" not in mk and partial is None:
                    # while the older year comes in: the quiet line, and a page that needs every year waits for it
                    partial = await pg.evaluate("""() => { const r = {line: (document.querySelector('#app [data-first-open]') || {}).textContent || '', older: (S.books.vouchers || []).filter(v => String(v.date) < '20260401').length};
                      S.booksTab = 'reports'; render(); r.reports = !!document.querySelector('#app [data-first-open-wait]') && !!(S.books.firstOpen) && !(S.books.meta || {}).cloud;
                      S.booksTab = 'tds'; S.tdsFy = '2025-26'; render(); r.oldTds = !!document.querySelector('#app [data-first-open-wait]') || !S.books.firstOpen;
                      S.tdsFy = '2026-27'; render(); return r; }""")
                if len(mk) == 3: break
                await asyncio.sleep(0.25)
            marks = {k: v / 1000 for k, v in mk.items()}
            await quiet(); c = L.cat(t0); b = await m()
            print("  %-26s usable %s ms, 2026-27 entries %s ms, every entry in and worked out %s ms; %s; main thread %s" % (label,
                  *[int(marks[k] * 1000) if k in marks else "-" for k in ("usable", "fy", "all")], json.dumps(c), json.dumps(delta(a, b))))
            if partial: print("     while the older year came in: %s" % json.dumps(partial))
            return marks, c, partial
        print("== 1. first opening, nothing kept (%d entries on %d days, %d KB of day files, %d items of work); CPU %gx, line %d ms / %g Mbit/s"
              % (len(L.VOUCHERS), len(L.DAYS), sum(len(v) for v in L.GZ.values()) // 1024, len(L.ITEMS), CPU, L.LINE["rtt"] * 1000, L.LINE["down"] * 8 / 1e6))
        fm, c1, part = await first_open("a month at once:")
        ms = lambda k: int(fm[k] * 1000) if k in fm else None
        ok(fm.get("usable") is not None and ms("usable") <= FIRST_USABLE, "the client usable in %s ms (<= %d): the TDS page with the server's figures, no page-wide loader" % (ms("usable"), FIRST_USABLE))
        ok(fm.get("fy") is not None and ms("fy") <= FIRST_FY, "2026-27's entries on the TDS page in %s ms (<= %d)" % (ms("fy"), FIRST_FY))
        ok(fm.get("all") is not None and ms("all") <= FIRST_ALL, "every entry in and the books worked out in %s ms (<= %d)" % (ms("all"), FIRST_ALL))
        ok(c1["months"] == len({d[:6] for d in L.DAYS}) and c1["dayfiles"] == 0, "one request a month of day files (%d months, %d day files)" % (c1["months"], c1["dayfiles"]))
        ok(c1["heads_kb"] < 600, "the cloud copy's entries checked in brief, not read in full (%d KB of entry heads; 2.8 MB before)" % c1["heads_kb"])
        ok(bool(part) and "2026-27 ready" in part["line"] and "2025-26" in part["line"] and part["older"] == 0, "while 2025-26 comes in, the books say so on one line and hold 2026-27 only (%s)" % json.dumps(part))
        ok(bool(part) and part["reports"] and part["oldTds"], "the pages that need 2025-26 wait for it (Reports, 2025-26's TDS) (%s)" % json.dumps(part))
        fp_new = await pg.evaluate(FINGER)
        # ---------- 2. reopen after a reload
        print("== 2. the client opened again after a reload (nothing changed in the cloud)")
        # timings: the better of two tries (the stand-in shares one machine with the browser at 4x)
        u2s = []
        for k in range(2):
            await pg.reload(); await boot(); await quiet(1.5); t0 = time.time(); a = await m()
            u2s.append(await open_client(L.CID, "reopening (try %d):" % (k + 1), n=len(L.VOUCHERS), fresh=True))
            await quiet(); c2 = L.cat(t0); b = await m()
        u2 = min([x for x in u2s if x is not None] or [None])
        print("     %s; %s" % (json.dumps(c2), json.dumps(delta(a, b))))
        ok(u2 is not None and u2 * 1000 <= REOPEN, "the TDS page usable from the copy here in %s ms (<= %d)" % (int(u2 * 1000) if u2 else "-", REOPEN))
        ok(c2["dayfiles"] == 0 and c2["months"] == 0 and c2["items_from0"] == 0, "no day file and no work fetched from the start (%d, %d, %d)" % (c2["dayfiles"], c2["months"], c2["items_from0"]))
        ok(c2["heads_kb"] < 64, "the cloud copy's entries are not read in full on a reopening (%d KB of entry heads)" % c2["heads_kb"])
        # ---------- 2b. the stale-copy guard: a colleague changed an item while this browser was closed
        print("== 2b. a colleague's change made while this browser was closed")
        L.SEQ[0] += 1
        L.ITEMS.append({"cid": L.CID, "key": "map", "item": ".ZZ Party 005", "ord": None, "data": {"kind": "other", "ok": True, "what": "zz-colleague"}, "deleted": False,
                        "seq": L.SEQ[0], "updated_at": "2026-10-24T10:00:00+00:00", "updated_by": "u-other"})
        await pg.reload(); await boot(); await quiet(1.5); t0 = time.time()
        await open_client(L.CID, "reopening:", n=len(L.VOUCHERS), fresh=True)
        got = await until("S.books.map['ZZ Party 005'] && S.books.map['ZZ Party 005'].what === 'zz-colleague'", 20)
        await quiet(); c2b = L.cat(t0)
        ok(got is not None and c2b["items_from0"] == 0, "the change comes in behind the page shown from the copy, fetched since this computer last looked (%s s, %s)" % (round(got, 1) if got else "-", json.dumps(c2b)))
        # ---------- 2c. the entries are still checked in full now and then (FULL_EVERY, 6 hours)
        print("== 2c. the last full check of the entries 7 hours ago")
        await pg.evaluate("() => { const c = S.books.meta.copy; c.fullAt = new Date(Date.now() - 7 * 3600000).toISOString(); return saveBooks({fromCloud: true}); }")
        await quiet(1.5); await pg.reload(); await boot(); await quiet(1.5); t0 = time.time()
        await open_client(L.CID, "reopening:", n=len(L.VOUCHERS), fresh=True)
        await quiet(); c2c = L.cat(t0)
        fresh_at = await pg.evaluate("() => Date.now() - Date.parse(S.books.meta.copy.fullAt || 0)")
        ok(c2c["heads_kb"] > 0 and fresh_at < 120000, "the entries are checked in full again after 6 hours (%d KB, checked %d s ago)" % (c2c["heads_kb"], fresh_at // 1000))
        # ---------- 3. switching pages
        print("== 3. switching pages in the open client")
        a = await m(); t0 = time.time(); slow = []
        for label, js, sel in (("GST", "S.tab = 'books'; S.booksTab = 'gst'; S.gstView = '';", ".page, main, section"),
                               ("MIS", "S.tab = 'books'; S.booksTab = 'mis';", ".page, main, section"),
                               ("Reports", "S.tab = 'books'; S.booksTab = 'reports';", ".page, main, section"),
                               ("Bank", "S.tab = 'bank';", ".page, main, section"),
                               ("Bills", "S.tab = 'invoices';", ".page, main, section"),
                               ("TDS", "S.tab = 'books'; S.booksTab = 'tds'; S.tdsView = 'year';", "[data-tds-page]")):
            s = time.time()
            await pg.evaluate("() => { " + js + " render(); }")
            t = await until("!document.querySelector('#app [data-loading]') && document.querySelector('#app " + sel + "') && !(S.books && S.books.loading)", 30)
            await pg.evaluate("() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))")
            ms = int((time.time() - s) * 1000); print("     %-8s drawn in %d ms" % (label, ms))
            if t is None or ms > SWITCH: slow.append("%s %d ms" % (label, ms))
        await quiet(1.5); c3 = L.cat(t0); b = await m(); d3 = delta(a, b)
        print("     %s; %s" % (json.dumps(c3), json.dumps(d3)))
        ok(not slow, "each page drawn within %d ms (%s)" % (SWITCH, slow))
        ok(d3["opens"] == 0 and d3["booksLoad"] == 0 and d3["tcloud"] == 0, "the books are not opened, read from the store or brought in again (%s)" % json.dumps(d3))
        ok(c3["dayfiles"] == 0 and c3["items_from0"] == 0 and c3["heads_kb"] == 0, "no day file, no work from the start and no entries fetched for a page switch (%s)" % json.dumps(c3))
        # ---------- 3b. the top bar's own news on the TDS page (Saving..., Saved 14:05, offline, back online), and a
        # colleague's change to ANOTHER client's setup (the client list in the sidebar): the TDS figures not worked out again
        print("== 3b. status news and a change to another client, on the TDS page")
        ms = await pg.evaluate("""() => { const out = [], t = (f) => { const s = performance.now(); f(); out.push(Math.round(performance.now() - s)); };
          t(() => Live.saving()); t(() => { Live.sv.state = ''; Live.saved(); }); t(() => Live.fail(new Error('Failed to fetch'))); t(() => Live.ok()); return out; }""")
        print("     top bar redraws: %s ms" % ms)
        ok(max(ms) <= 220 * CPU / 4, "the top bar's news redraws in at most %d ms each, the figures not worked out again (%s; 460-820 ms before)" % (220 * CPU / 4, ms))
        tries = []
        for k in range(2):
            await quiet(1.5); a = await m()
            await pg.evaluate("""([b, k]) => Live.rec('clients', {id: b, data: Object.assign({}, S.companies[b], {stats: {drafts: 7 + k, at: Date.now()}}), deleted: false, updated_at: new Date().toISOString(), updated_by: 'u-other'})""", [L.CID_B, k])
            await pg.wait_for_timeout(1500); b = await m(); tries.append(delta(a, b))
        d3b = min(tries, key=lambda d: d["lt"])
        print("     another client's setup changed: %s" % json.dumps(d3b))
        ok(d3b["renders"] == 0 and d3b["lt"] <= 400 * CPU / 4, "another client's setup coming in draws no full page and costs at most %d ms of long tasks (%d, %d full drawings)" % (400 * CPU / 4, d3b["lt"], d3b["renders"]))
        # ---------- 4. client A -> B -> A
        print("== 4. client A -> B -> A")
        await open_client(L.CID_B, "client B:", "*", 0); await quiet(1.5)
        a = await m(); t0 = time.time()
        u4 = await open_client(L.CID, "back to client A:", n=len(L.VOUCHERS))
        await quiet(); c4 = L.cat(t0); b = await m(); d4 = delta(a, b)
        print("     %s; %s" % (json.dumps(c4), json.dumps(d4)))
        ok(u4 is not None and u4 * 1000 <= REOPEN, "client A usable again in %s ms (<= %d)" % (int(u4 * 1000) if u4 else "-", REOPEN))
        ok(c4["dayfiles"] == 0 and c4["items_from0"] == 0 and c4["heads_kb"] < 64, "no day file, no work from the start, no full read of the entries (%s)" % json.dumps(c4))
        ok(d4["storeReads"] == 0, "client A's books not read from this browser's store again in the same session (%d reads, %d ms)" % (d4["storeReads"], d4["booksLoadMs"]))
        # ---------- 5. a publish: the worker and its caches cleared (the Safari self-heal), a new build
        print("== 5. a publish (FinCom's worker and caches cleared, as oldcheck.js / staleChunk do)")
        await pg.evaluate("""async () => { try { const rs = await navigator.serviceWorker.getRegistrations(); await Promise.all(rs.map(r => r.unregister())); } catch (e) {}
          try { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } catch (e) {} }""")
        await pg.reload(); await boot(); await quiet(1.5); t0 = time.time()
        u5 = await open_client(L.CID, "after the publish:", n=len(L.VOUCHERS), fresh=True)
        await quiet(); c5 = L.cat(t0)
        if u5 is None or u5 * 1000 > REOPEN:
            await pg.reload(); await boot(); await quiet(1.5)
            u5 = min(u5 or 99, await open_client(L.CID, "after the publish (try 2):", n=len(L.VOUCHERS), fresh=True) or 99); await quiet()
        print("     %s" % json.dumps(c5))
        ok(u5 is not None and u5 * 1000 <= REOPEN and c5["dayfiles"] == 0 and c5["items_from0"] == 0, "the books copy is kept across a publish: usable in %s ms, %d day files, %d fetches from the start" % (int(u5 * 1000) if u5 else "-", c5["dayfiles"], c5["items_from0"]))
        # ---------- 6. this browser's store slow to open (Safari)
        print("== 6. this browser's store answering only after 6 s (Safari after a publish or a fresh sign-in)")
        await pg.evaluate("() => sessionStorage.setItem('zz-idb-slow', '6000')")
        t0 = time.time(); await boot()
        kind = await pg.evaluate("S.storeKind")
        u6 = await open_client(L.CID, "with the store slow:", n=len(L.VOUCHERS), fresh=True)
        await quiet(); c6 = L.cat(t0)
        print("     store kind %s; %s" % (kind, json.dumps(c6)))
        ok(c6["dayfiles"] == 0 and c6["items_from0"] == 0, "the copy here is used once the store answers: no day file, no work from the start (%d, %d)" % (c6["dayfiles"], c6["items_from0"]))
        ok(kind == "idb", "this browser's store is still used for the client's work (store kind: %s)" % kind)
        await pg.reload(); await boot()
        # ---------- 7. a change coming in live
        print("== 7. changes coming in live (Realtime)")
        await open_client(L.CID, "open:", n=len(L.VOUCHERS), fresh=True); await quiet(1.5)
        a = await m(); t0 = time.time()
        await pg.evaluate("""([cid]) => { const at = new Date().toISOString();
          Live.change({table: 'client_book_items', record: {client_id: cid, key: 'map', item: '.ZZ Party 001', ord: null, data: {kind: 'other', ok: true, what: ''}, deleted: false, seq: 999001, updated_at: at, updated_by: 'u-other'}});
          Live.change({table: 'client_book_items', record: {client_id: cid, key: 'map', item: '.ZZ Party 002', ord: null, data: {kind: 'other', ok: false, what: ''}, deleted: false, seq: 999002, updated_at: at, updated_by: 'u-other'}}); }""", [L.CID])
        got = await until("S.books.map['ZZ Party 001'] && S.books.map['ZZ Party 001'].ok === true", 20)
        await quiet(1.5); b = await m(); d7 = delta(a, b); c7 = L.cat(t0)
        print("     applied in %s ms; %s; %s" % (int(got * 1000) if got else "-", json.dumps(c7), json.dumps(d7)))
        ok(got is not None, "a colleague's change is applied")
        ok(d7["opens"] == 0 and d7["booksLoad"] == 0 and d7["tcloud"] == 0 and c7["dayfiles"] == 0, "the books are not opened, read or brought in again for it (%s)" % json.dumps(d7))
        ok(d7["booksSave"] <= 2, "at most one write of the books per change coming in (%d writes)" % d7["booksSave"])
        # ---------- 8. the firm's Today page
        print("== 8. the firm's Today page (the due list over every client)")
        a = await m(); t0 = time.time()
        await pg.evaluate("() => { S.view = 'home'; S.coId = null; render(); }")
        await until("document.querySelector('#app [data-due-line], #app [data-due-list]')", 30); await quiet(2)
        for _ in range(3):
            await pg.evaluate("() => { S.view = 'company'; S.coId = '%s'; S.tab = 'books'; render(); }" % L.CID); await pg.wait_for_timeout(300)
            await pg.evaluate("() => { S.view = 'home'; S.coId = null; render(); }"); await pg.wait_for_timeout(600)
        await quiet(2); b = await m(); d8 = delta(a, b); c8 = L.cat(t0)
        print("     %s; %s" % (json.dumps(c8), json.dumps(d8)))
        ok(d8["storeReads"] <= 1, "the other clients' books are read from the store at most once each, not on every visit (%d reads, %d ms)" % (d8["storeReads"], d8["booksLoadMs"]))
        ok(c8["dayfiles"] == 0 and c8["items_from0"] == 0, "nothing downloaded again from the start (%s)" % json.dumps(c8))
        # ---------- 9. a client's counts that depend on this computer are not sent (they went back and forth between two computers)
        print("== 9. this computer's own counts on a client")
        r9 = await pg.evaluate("""([b]) => { const snap = () => JSON.stringify((cloudSnapshot().find(r => r.kind === 'client' && r.id === b) || {}).data);
          const c = S.companies[b]; c.stats = Object.assign({}, c.stats, {drafts: 1, check: 0, ready: 0, attention: 0}); const a = snap();
          c.stats.check = 5; c.stats.ready = 3; c.stats.attention = 2; const same = snap() === a;
          c.stats.drafts = 2; const moved = snap() !== a; return {same, moved}; }""", [L.CID_B])
        ok(r9["same"], "the counts of bills to check, ready and needing attention (this computer's own) are not sent to the firm account")
        ok(r9["moved"], "a count from the bills themselves (drafts) is sent")
        ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
        await ctx.unroute_all(behavior="ignoreErrors"); await ctx.close()
        # ---------- 1b / 1z. the first opening without the month answers (the server as today), and the load before
        # fast-firstopen (no FirstOpen, no month answers): the books must end exactly as each other
        async def fresh(no_fo, pack):
            nonlocal ctx, pg, cdp
            ctx = await br.new_context(viewport={"width": 1366, "height": 900}); await ctx.add_init_script(INIT)
            if no_fo: await ctx.add_init_script(NOFO)
            pg = await ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e))); await ctx.route(L.STAGE + "/**", L.route)
            cdp = await ctx.new_cdp_session(pg); await cdp.send("Emulation.setCPUThrottlingRate", {"rate": CPU}); L.PACK[0] = pack
        print("== 1b. first opening with the day files one by one (FinCom's server without month_days, as today)")
        await fresh(False, False)
        fb, cb, partb = await first_open("the day files:")
        msb = lambda k: int(fb[k] * 1000) if k in fb else None
        ok(fb.get("usable") is not None and msb("usable") <= FIRST_USABLE and fb.get("fy") is not None and msb("fy") <= FIRST_FY and fb.get("all") is not None and msb("all") <= FIRST_ALL,
           "without month answers: usable in %s ms, 2026-27 in %s ms, everything in %s ms (<= %d / %d / %d)" % (msb("usable"), msb("fy"), msb("all"), FIRST_USABLE, FIRST_FY, FIRST_ALL))
        ok(cb["dayfiles"] == len(L.DAYS), "every day file fetched once (%d of %d)" % (cb["dayfiles"], len(L.DAYS)))
        fp_days = await pg.evaluate(FINGER); await ctx.unroute_all(behavior="ignoreErrors"); await ctx.close()
        print("== 1z. the books as the load before fast-firstopen makes them")
        await fresh(True, False)
        fz, cz, _ = await first_open("before fast-firstopen:")
        fp_old = await pg.evaluate(FINGER); await ctx.unroute_all(behavior="ignoreErrors"); await ctx.close(); L.PACK[0] = True
        for label, fp in (("with month answers", fp_new), ("with the day files", fp_days)):
            diff = sorted(k for k in set(fp_old) | set(fp) if fp_old.get(k) != fp.get(k))
            ok(not diff and fp_old["n"] == len(L.VOUCHERS), "the books end exactly as before fast-firstopen, %s (%d entries; %s)" % (label, fp["n"], ("differ: " + ", ".join(diff[:8])) if diff else "every part the same"))
        ok(not errors, "no page errors in 1b and 1z" + ("" if not errors else ": " + errors[0]))
        await br.close()
asyncio.run(main())
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
