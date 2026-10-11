"""python3 run_stability.py - a steady FinCom (stability batches, 11-Oct-2026; the owner: "as stable and strong as
Claude, anthropic.com, Microsoft"). Measured in the browser the way scratchpad/stab/probe.js measured it, on the React
build (app/dist-test, or TDSDESK_SITE), with a made-up firm kept in this browser:

  1. the sign-in page: decided before the first paint (no sidebar in the first frame), no layout shift (was 0.164);
  2. the frame before the program loads: with legacy.js held back, the sidebar with the FinCom mark, the top bar's three
     places (bell, Tally sign, firm) and the page's shape are on screen while the program has not run;
  3. the FinCom loader: on a first open that takes more than 300 ms it shows from about 300 ms after the first frame, for
     at most about a second, then the page's shape; never on a quick reopen of the same build; still under reduced motion;
  4. one loading state: no "Loading…" words during an open, no second kind of wait after the program takes over;
  5. every page change without a layout shift over 0.01 (Today, Overview, Purchase, TDS, GST, MIS, Bank, back to Today);
     the bell, the Tally sign and the firm in the same places, and the header the same height, on every page;
  6. the sidebar's date line in the same place on the firm's pages and a client's;
  7. the Overview drawn once, final: no opening motion, no count-up, "N of 6 done" the same from its first frame;
  8. page changes that take longer than 300 ms show a thin bar under the top bar (once batch 3 is in: data-nav-progress).
Screenshots to tests/out/stability/."""
import os, sys, json, time, threading, functools, http.server, re
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("STAB_PORT") or 8351)
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "stability"); os.makedirs(OUT, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the server: legacy.js can be held back (HOLD[0] seconds) to see what shows before the program runs
HOLD = [0.0]
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        # nothing kept by the browser between the opens: each open fetches legacy.js (held back or not) again
        self.send_header("Cache-Control", "no-store"); super().end_headers()
    def do_GET(self):
        if HOLD[0] and re.search(r"/legacy[^/]*\.js", self.path): time.sleep(HOLD[0])
        return super().do_GET()
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://localhost:%d/" % PORT
books = json.load(open(CACHE))

# watched from before the page's own scripts: layout shifts (with what moved), the first paint, and every frame: the
# FinCom loader's and the page shape's opacity, the loading words and waits on screen
PROBE = r"""(() => { if (window.__st) return; const M = window.__st = {shifts: [], fp: null, frames: [], kinds: [], words: [], t0: 0};
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => M.shifts.push({t: Math.round(e.startTime), v: e.value, input: e.hadRecentInput,
    src: (e.sources || []).map((s) => { const n = s.node; return n && n.nodeType === 1 ? (n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") + "." + String(n.className || "").split(" ").slice(0, 2).join(".")) : String(n && n.nodeName); })})))
    .observe({type: "layout-shift", buffered: true}); } catch (e) {}
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.name === "first-paint" && M.fp == null) M.fp = Math.round(e.startTime); })).observe({type: "paint", buffered: true}); } catch (e) {}
  const vis = (el) => { if (!el || !el.isConnected) return 0; const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") return 0; const r = el.getBoundingClientRect(); return r.width && r.height ? +cs.opacity : 0; };
  const WORDS = /\bLoading\b[^\n]{0,40}/;
  let k = 0;
  const tick = () => { const t = Math.round(performance.now());
    const f = {t, loader: vis(document.querySelector(".boot-loader")) || vis(document.querySelector(".open-loader")), skel: vis(document.querySelector(".boot-skel")), pg: vis(document.querySelector(".pg-skel")),
      lt: [...document.querySelectorAll("#app .lt-loading, #app [data-loading]")].some((e) => vis(e) > 0.5), app: !!document.querySelector("#app .react-host"),
      prog: vis(document.querySelector("[data-nav-progress]"))};
    M.frames.push(f);
    const kind = f.loader > 0.05 ? "loader" : f.skel > 0.5 ? "frame-shape" : f.pg > 0.5 ? "page-shape" : f.lt ? "lt-loading" : f.app ? "page" : "blank";
    if (M.kinds[M.kinds.length - 1] !== kind) M.kinds.push(kind);
    const app = document.getElementById("app"); const m = app && WORDS.exec(app.innerText || ""); if (m && !M.words.includes(m[0])) M.words.push(m[0]);
    if (++k < 2400) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  M.reset = () => { M.t0 = Math.round(performance.now()); return M.t0; };
})();"""

SEED = """(books) => { S.firm.firmName = "Garg Shekhar & Company";
  const c = newCompany({name: "Testing AAD", gstin: "09AANFG3202D1ZR"}); c.tan = "DELZ12345A"; S.companies[c.id] = c; c.stats = {};
  const d = S.data[c.id] = {parties: {}, entries: {}, loaded: true};
  const mk = (id, inv, vendor, total, st, extra) => { const e = newEntry(inv + ".pdf"); e.id = id;
    e.x = Object.assign(e.x || {}, {vendorName: vendor, invoiceNo: inv, invoiceDate: "2026-09-12", total, taxable: Math.round(total / 1.18)}); e.status = st; Object.assign(e, extra || {}); d.entries[id] = e; };
  mk("s1", "FA/2026-27/081", "FINGATE ADVISORY SERVICES PVT LTD", 23600, "draft");
  mk("s2", "INV-4412", "MASTERCAD SOLUTIONS", 125000, "draft");
  mk("s3", "CN-17", "SALESIFY TECHNOLOGIES", -5900, "draft");
  mk("s4", "B/2209", "LYALLPUR TRADERS", 47200, "approved", {approvedAt: "2026-09-15T05:00:00Z"});
  S.coId = c.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false;
  const b = Object.assign({loading: false, challans: [], alloc: {}}, books, {cid: c.id}); S.books = b; S.books.map = Books.mapLedgers(b.vouchers, {}); LedMaster.refresh(S.books);
  window.__bk = S.books; refreshStats(c.id);
  for (const [n, g] of [["Mehra Textiles LLP", "07AAAFM1234K1Z5"], ["Iyer Foods Private Limited", "29AAACI9876L1Z2"]]) { const o = newCompany({name: n, gstin: g}); S.companies[o.id] = o; o.stats = {}; S.data[o.id] = {parties: {}, entries: {}, loaded: true}; }
  Store.saveFirm(); Object.values(S.companies).forEach((x) => Store.saveCompany(x)); Object.entries(S.data).forEach(([cid, dd]) => Object.values(dd.entries || {}).forEach((e) => Store.saveEntry(cid, e)));
  if (typeof saveBooks === "function") saveBooks(); render(); return c.id; }"""

def cls(m, since=0):
    s = [x for x in m["shifts"] if x["t"] >= since]
    return round(sum(x["v"] for x in s), 4), sorted(s, key=lambda x: -x["v"])[:3]
def state(pg): return pg.evaluate("() => JSON.parse(JSON.stringify(window.__st))")

def setup(br, reduced=False):
    ctx = br.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce" if reduced else "no-preference")
    ctx.add_init_script(PROBE)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    return ctx, pg
def seed(pg):
    pg.goto(URL); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    cid = pg.evaluate(SEED, books); pg.wait_for_timeout(1500); return cid

try:
    with sync_playwright() as p:
        br = p.chromium.launch()

        print("1. the sign-in page: decided before the first paint, no shift")
        ctx, pg = setup(br)
        pg.goto(URL); pg.wait_for_timeout(3000)
        m = state(pg); c, worst = cls(m)
        ok(pg.locator('#app button[data-act="useOffline"]').count() == 1, "the sign-in page shows")
        ok(c <= 0.01, "sign-in page: layout shift %.4f <= 0.01 (was 0.164) %s" % (c, worst))
        pg.screenshot(path=os.path.join(OUT, "signin.png")); ctx.close()
        # held back: the sign-in card's place, no sidebar, from the first frame
        ctx, pg = setup(br); HOLD[0] = 2.5
        pg.goto(URL, wait_until="commit"); pg.wait_for_timeout(1200)
        early = pg.evaluate("() => ({boot: document.documentElement.getAttribute('data-boot'), side: getComputedStyle(document.getElementById('side')).display, card: !!document.querySelector('.boot-signin .signin-box') && document.querySelector('.boot-signin').getBoundingClientRect().height > 0, legacy: typeof S !== 'undefined'})")
        ok(early["boot"] == "signin" and early["side"] == "none" and early["card"] and not early["legacy"], "before the program runs: the sign-in frame, no sidebar (%s)" % early)
        pg.wait_for_timeout(3500); m = state(pg); c, worst = cls(m)
        ok(c <= 0.01, "sign-in page on a slow line: layout shift %.4f <= 0.01 %s" % (c, worst)); HOLD[0] = 0; ctx.close()

        print("2-4. the frame before the program, the FinCom loader, one loading state")
        ctx, pg = setup(br); cid = seed(pg)
        # a first open of this build, slow (legacy.js held back 3 s)
        pg.evaluate("() => localStorage.removeItem('fincom:opened')"); HOLD[0] = 3.0
        pg.goto(URL, wait_until="commit"); pg.wait_for_timeout(1500)
        shell = pg.evaluate("""() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
          return {legacy: typeof S !== 'undefined', brand: r('#side .side-brand .side-mark'), slots: [...document.querySelectorAll('#cobar .tb-slot')].filter((e) => e.getBoundingClientRect().width > 0).length,
            page: r('#app .boot-page'), co: document.documentElement.hasAttribute('data-boot-co'), words: (document.getElementById('app').innerText || '').trim().slice(0, 40)}; }""")
        ok(not shell["legacy"] and shell["brand"] and shell["slots"] == 3 and shell["page"], "with the program not yet run: the FinCom mark, the top bar's 3 places and the page's frame are on screen (%s)" % shell)
        ok(shell["co"], "the client open last time: the frame is a client's (data-boot-co)")
        pg.screenshot(path=os.path.join(OUT, "frame-before-program.png"))
        pg.wait_for_timeout(4500)
        m = state(pg); fp = m["fp"] or 0
        on = [f["t"] for f in m["frames"] if f["loader"] > 0.05]
        ok(bool(on), "a slow first open shows the FinCom loader")
        if on:
            ok(on[0] - fp >= 250, "the loader appears only after about 300 ms (%d ms after the first frame)" % (on[0] - fp))
            ok(on[-1] - on[0] <= 1150, "the loader is on screen for at most about a second (%d ms)" % (on[-1] - on[0]))
            after = [f for f in m["frames"] if f["t"] > on[-1] + 50 and not f["app"]]
            ok(any(f["skel"] > 0.5 for f in after), "after the loader, the page's shape until the program has drawn")
        ok(len(m["words"]) <= 1, "one line of 'Loading…' words at most during the open, with the page's shape (%s)" % m["words"])
        k = [x for x in m["kinds"] if x != "blank"]
        react_waits = [x for x in k[k.index("page-shape") if "page-shape" in k else len(k):] if x in ("page-shape", "lt-loading", "loader")]
        ok("lt-loading" not in k and len(set(react_waits)) <= 1, "one loading state: the frame's shape, at most one wait after the program (%s)" % k)
        c, worst = cls(m)
        ok(c <= 0.01, "the open: layout shift %.4f <= 0.01 %s" % (c, worst))
        HOLD[0] = 0
        # a quick reopen of the same build: no loader at all, even when slow
        HOLD[0] = 1.5; pg.goto(URL, wait_until="commit"); pg.wait_for_timeout(3500); HOLD[0] = 0
        m = state(pg)
        ok(pg.evaluate("localStorage.getItem('fincom:opened')") and not any(f["loader"] > 0.05 for f in m["frames"]), "a reopen of the same build never shows the loader")
        c, worst = cls(m); ok(c <= 0.01, "the reopen: layout shift %.4f <= 0.01 %s" % (c, worst))
        # quick, not held back: no loader
        pg.evaluate("() => localStorage.removeItem('fincom:opened')"); pg.goto(URL); pg.wait_for_timeout(2500)
        m = state(pg)
        app_at = next((f["t"] for f in m["frames"] if f["app"]), None)
        if app_at is not None and app_at - (m["fp"] or 0) < 250:
            ok(not any(f["loader"] > 0.05 for f in m["frames"]), "an open ready within 300 ms shows no loader")
        ctx.close()
        # reduced motion: the mark stands still
        ctx, pg = setup(br, reduced=True); HOLD[0] = 2.0
        pg.goto(URL, wait_until="commit"); pg.wait_for_timeout(900)
        an = pg.evaluate("() => { const m = document.querySelector('.boot-mark'); return m ? getComputedStyle(m).animationName : 'gone'; }")
        ok(an in ("none", "gone"), "reduced motion: the FinCom mark does not pulse (%s)" % an); HOLD[0] = 0; pg.wait_for_timeout(2500); ctx.close()

        print("5-6. page changes: no shift, the top bar's places and the header the same everywhere")
        ctx, pg = setup(br); cid = seed(pg)
        E, W = pg.evaluate, pg.wait_for_timeout
        SLOTS = """() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
          return {bell: r('#cobar .tb-bell'), tally: r('#cobar .tb-tally'), firm: r('#cobar .tb-firm'), header: r('header.top'), date: r('#side [data-side-date]')}; }"""
        CL = "S.view = 'company'; S.books = window.__bk; "
        PAGES = [("Today", "navHome('today');"), ("Overview", CL + "goClient('dash');"), ("Purchase", CL + "goClient('bills');"), ("TDS", CL + "goClient('books:tds');"),
                 ("GST", CL + "goClient('books:gst');"), ("MIS", CL + "goClient('books:mis');"), ("Bank", CL + "goClient('bank');"), ("Sales", CL + "goClient('sales');"),
                 ("Purchase again", CL + "goClient('bills');"), ("Clients", "navHome('clients');"), ("Today again", "navHome('today');")]
        spots, dates, firm_date, client_date = {}, set(), None, None
        for name, js in PAGES:
            E("() => { if (typeof toastHide === 'function') toastHide(); window.scrollTo(0, 0); }"); W(300)
            t0 = E("(js) => { const t = window.__st.reset(); new Function(js)(); return t; }", js); W(1600)
            m = state(pg); c, worst = cls(m, t0)
            ok(c <= 0.01, "%s: layout shift %.4f <= 0.01 %s" % (name, c, worst))
            s = E(SLOTS); spots[name] = s
            pg.screenshot(path=os.path.join(OUT, "page-%s.png" % name.replace(" ", "_")))
            if name.startswith("Today"): firm_date = s["date"]
            if name == "Overview": client_date = s["date"]
        base = spots["Today"]
        for k in ("bell", "tally", "firm", "header"):
            vals = {n: tuple(v[k] or ()) for n, v in spots.items()}
            ok(len(set(vals.values())) == 1, "the %s in the same place on every page (%s)" % (k, sorted(set(vals.values()))))
        ok(firm_date and client_date and firm_date[1] == client_date[1], "the sidebar's date line at the same height on a firm page and a client's (%s, %s)" % (firm_date, client_date))
        ok(pg.locator("#cobar nav.sbar").count() == 0, "no status tabs in the header (they are at the top of the page)")
        E(CL + "goClient('bills');"); W(900)
        ok(pg.locator("#app .sbar-band nav.sbar[aria-label=Status] [data-step=review]").count() == 1, "Purchase: the status tabs at the top of the page")

        print("7. the Overview: drawn once, final")
        E("""() => { window.__onb = []; const mo = new MutationObserver(() => { const n = document.querySelector('.dash .onb-h .note, .onb-fold > summary');
            if (n) { const t = n.textContent; if (window.__onb[window.__onb.length - 1] !== t) window.__onb.push(t); } });
            mo.observe(document.getElementById('app'), {subtree: true, childList: true, characterData: true}); window.__onbMo = mo; }""")
        E("() => { S.books = null; navHome('today'); }"); W(600)
        E("(cid) => { openCompany(cid).then(() => { goClient('dash'); }); }", cid); W(2500)
        onb = E("window.__onb")
        ok(len(onb) == 1, "'N of 6 done' is the same from its first frame (%s)" % onb)
        ok(pg.locator(".dash[data-intro]").count() == 0, "no opening motion on the Overview (no data-intro)")
        anims = E("() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.dash')).map((a) => a.animationName || a.constructor.name)")
        ok(not anims, "no figure counting up or step rising in on the Overview (%s)" % anims)
        ok(pg.locator(".dash .dtile b[data-count]").count() == 0 and "…" not in (pg.inner_text(".dash .dash-tiles") or ""), "the four figures final: no count-up, no '…'")

        print("8. the thin bar for a page change over 300 ms")
        if pg.locator("[data-nav-progress]").count() == 0 and not E("typeof window.FinComNav === 'object'"):
            print("  (not in this build yet: stability batch 3)")
        else:
            # a quick change: nothing; a slow one (a 700 ms change made by holding the main thread): the bar, then gone
            t0 = E("() => window.__st.reset()"); E("navHome('clients')"); W(900)
            m = state(pg); ok(not any(f["prog"] > 0.05 for f in m["frames"] if f["t"] >= t0), "a quick page change shows no bar")
            t0 = E("() => window.__st.reset()")
            E("() => { FinComNav.start(); setTimeout(() => { const e = performance.now() + 700; while (performance.now() < e) {} navHome('today'); FinComNav.done(); }, 0); }"); W(1800)
            m = state(pg); on = [f["t"] for f in m["frames"] if f["t"] >= t0 and f["prog"] > 0.05]
            ok(bool(on) and on[0] - t0 >= 250, "a slow page change shows the bar after about 300 ms (%s)" % (on[0] - t0 if on else None))
            ok(not E("document.querySelector('[data-nav-progress]') && getComputedStyle(document.querySelector('[data-nav-progress]')).opacity > 0.05 && document.querySelector('[data-nav-progress]').getAttribute('data-on') === '1'"), "the bar has gone once the page is drawn")
        ctx.close(); br.close()
finally:
    srv.shutdown()
ok(not errors, "no errors in the page (%s)" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
