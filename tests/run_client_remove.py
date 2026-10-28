"""python3 run_client_remove.py - a removed client keeps no Tally company (next-fix-clientremove, 28-Oct-2026). Staging that
day: the owner removed "Salesify Marketing LLP 2026-27" and made a new client of the same name; the Tally page said
"Salesify Marketing LLP 2026-27 · Connected · Linked to a client not on this computer" with no Link to client…, and the
new client's Tally popover offered only VMS EVENTS PRIVATE LIMITED (2024-25). Made-up records in run_link_record.py's
stand-in cloud (migration 128 itself: run_migration128.py).
  1. A company still linked (in the cloud) to a removed client is Not linked, with Link to client…: never "Linked to a
     client not on this computer"; Link to client… lists every live client of the firm and never the removed one
  2. The new client of the same name: its Tally popover offers the company first; one click links it
  3. A linked row says "Linked to client: <name>" (the name opens the client); the popover says "Tally company: <company>
     on <computer>"
  4. Removing a linked client (Remove client) unlinks its company through the link function; the company is free at once;
     the removed client is in no list: Clients, the switcher, Link to client…
  5. No overlap: no two element boxes of the popover's link card intersect, nothing outside it, at 1366, 1440 and 390;
     the Tally page's linked row neither
Options: --shots DIR saves the screens. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_client_remove.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_link_record import SETUP, store, dev, row, rec, ME, Q
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = int(os.environ.get("CLRM_PORT") or 8479)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
OLD, NEW, CAR, LLP = "cmvs4ulr5lmpto", "cmvsazte0oqc1w", "cmvrz045t4u37c", "cmvs1dwlgv1y6u"
SAL, VMS = "Salesify Marketing LLP 2026-27", "VMS EVENTS PRIVATE LIMITED (2024-25)"
GS, GV = "5a1e0001-0000-0000-0000-000000000128", "0e550001-0000-0000-0000-000000000128"
CLIENTS = [{"id": CAR, "name": "Car Laundry Retail Private Limited"}, {"id": LLP, "name": "Salesify Marketing LLP"}, {"id": NEW, "name": SAL}]
POP = "header.top [data-tally-pop]"
# the client removed on another computer: gone from this browser, its sync mark "gone" (cloudApplyNow)
GONE = "(id) => { delete S.companies[id]; const m = Cloud.marks(); m['client|' + id + '|' + id] = 'gone'; Cloud.setMarks(m); }"
OVERLAP = """(sel) => { const root = document.querySelector(sel); if (!root) return {missing: true};
  const R = root.getBoundingClientRect(), out = [], hits = [];
  const els = [...root.querySelectorAll('label, select, button, a, b, .note, p > span')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!e.checkVisibility || e.checkVisibility({opacityProperty: true, visibilityProperty: true})) && !e.closest('details:not([open]) > :not(summary)'); });
  const leaf = els.filter(e => !els.some(o => o !== e && e.contains(o)));
  for (const e of leaf){ const r = e.getBoundingClientRect(); if (r.left < R.left - 1 || r.right > R.right + 1 || r.right > innerWidth || r.left < 0) out.push((e.getAttribute('data-tally-pop-act') || e.tagName) + ' ' + Math.round(r.left) + '-' + Math.round(r.right)); }
  for (let i = 0; i < leaf.length; i++) for (let j = i + 1; j < leaf.length; j++){ const a = leaf[i].getBoundingClientRect(), b = leaf[j].getBoundingClientRect();
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 1 && h > 1 && !leaf[i].contains(leaf[j]) && !leaf[j].contains(leaf[i])) hits.push(leaf[i].tagName + '[' + leaf[i].innerText.slice(0, 20) + '] x ' + leaf[j].tagName + '[' + leaf[j].innerText.slice(0, 20) + ']'); }
  return {n: leaf.length, out, hits, w: Math.round(R.width), sw: document.documentElement.scrollWidth, iw: innerWidth}; }"""

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def page(w=1440, h=900):
            pg = br.new_page(viewport={"width": w, "height": h})
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            pg.wait_for_function("() => typeof LinkRec === 'object' && typeof LinkWord === 'function'", timeout=30000)
            return pg
        def shot(pg, name, sel=None, pad=8):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True)
            if sel and pg.locator(sel).count():
                b = pg.evaluate("([s, p]) => { const r = document.querySelector(s).getBoundingClientRect(); return {x: Math.max(0, r.left - p), y: Math.max(0, r.top - p), width: Math.min(innerWidth - Math.max(0, r.left - p), r.width + 2 * p), height: r.height + 2 * p}; }", [sel, pad])
                pg.screenshot(path=os.path.join(SHOTS, name + ".png"), clip=b)
            else: pg.screenshot(path=os.path.join(SHOTS, name + ".png"))
        def scene(pg, sal_client=OLD, links=None):
            devs = [dev([SAL, VMS], [(SAL, GS), (VMS, GV)])]
            s = store(cos=[row(SAL, "b-sal", sal_client, linked="ago:300" if sal_client else None), row(VMS, "b-vms")],
                      links=links if links is not None else ([rec(SAL, "b-sal", sal_client, GS)] if sal_client else []), devs=devs)
            pg.evaluate(SETUP, [s, "owner", ME, CLIENTS])
            pg.evaluate(GONE, OLD)
            pg.evaluate("() => { TCloud.refreshPane = async () => {}; }")
        def tally_page(pg):
            pg.evaluate("() => { S.coId = null; S.view = 'home'; navHome('tally'); }"); pg.wait_for_timeout(1500)
        def client_page(pg, cid):
            pg.evaluate("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", cid); pg.wait_for_timeout(1500)
        def pop(pg):
            if not pg.locator(POP).count(): pg.click("header.top [data-tally-icon]")
            pg.wait_for_selector(POP + " [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(400)
            return pg.inner_text(POP)
        R = lambda co: '#app [data-tco-list=firm] [data-tco-row="%s"]' % co
        rpc = lambda pg, fn: [r for r in pg.evaluate("window.__rpc") if r[0] == fn]

        try:
            print("== 1. a company held by a removed client is Not linked, with Link to client…")
            pg = page(1440, 900); scene(pg); tally_page(pg)
            t = pg.inner_text(R(SAL)) if pg.locator(R(SAL)).count() else ""
            ok(t and "not on this computer" not in t and pg.locator(R(SAL) + " [data-tco-elsewhere]").count() == 0, "no 'Linked to a client not on this computer' (%r)" % t[:160])
            ok(pg.locator(R(SAL) + " [data-tco-act=pick]").count() == 1, "Link to client… on its row")
            shot(pg, "tally-row-free-1440", R(SAL))
            pg.click(R(SAL) + " [data-tco-act=pick]", timeout=3000); pg.wait_for_timeout(400)
            opts = pg.evaluate("(s) => [...document.querySelectorAll(s + ' [data-tco-relink-pick] option')].map(o => [o.value, o.text]).filter(o => o[0])", R(SAL))
            ok(sorted(o[0] for o in opts) == sorted([CAR, LLP, NEW]), "Link to client… lists every live client and not the removed one (%s)" % opts)
            shot(pg, "tally-pick-1440", R(SAL))

            print("== 2. the new client of the same name: offered first, one click")
            client_page(pg, NEW); t = pop(pg)
            sel = pg.evaluate("(s) => { const e = document.querySelector(s + ' [data-tally-pop-pick]'); return e ? {v: e.value, o: [...e.options].map(o => o.value)} : null; }", POP)
            ok(sel and sel["v"] == SAL and VMS in sel["o"], "the popover offers %s first (%s)" % (SAL, sel))
            shot(pg, "client-pop-1440", POP)
            n0 = len(rpc(pg, "tally_company_link"))
            pg.click(POP + " [data-tally-pop-act=link]"); pg.wait_for_timeout(1800)
            calls = rpc(pg, "tally_company_link")[n0:]
            ok(any(c[1].get("p_company") == SAL and c[1].get("p_client") == NEW for c in calls), "one click: tally_company_link(%s, the new client) (%s)" % (SAL, calls))
            pg.evaluate("async () => { await TLight.refresh(); render(); }"); pg.wait_for_timeout(800)

            print("== 3. the link said plainly")
            tally_page(pg); t = re.sub(r"\s+", " ", pg.inner_text(R(SAL)))
            ok("Linked to client: " + SAL in t and pg.locator(R(SAL) + " [data-tco-linked-label=%s] [data-tco-client]" % NEW).count() == 1, "the row: 'Linked to client: %s' (%r)" % (SAL, t[:200]))
            ok(not re.search(re.escape(SAL) + r" ›", t), "no bare '<name> ›'")
            shot(pg, "tally-row-linked-1440", R(SAL))
            client_page(pg, NEW); t = pop(pg)
            ok("Tally company: " + SAL + " on NWS144" in re.sub(r"\s+", " ", t), "the popover: 'Tally company: %s on NWS144' (%r)" % (SAL, t[:200]))
            shot(pg, "client-pop-linked-1440", POP)
            pg.keyboard.press("Escape"); pg.wait_for_timeout(200)

            print("== 4. Remove client releases its company; the removed client is in no list")
            n0 = len(rpc(pg, "tally_company_link"))
            pg.evaluate("() => { window.confirmTyped = () => Promise.resolve({name: CO().name, reason: 'test removal'}); }")
            pg.evaluate("() => doAct('delCo')"); pg.wait_for_timeout(2000)
            calls = rpc(pg, "tally_company_link")[n0:]
            ok(any(c[1].get("p_company") == SAL and c[1].get("p_client") is None for c in calls), "its company unlinked through the link function (%s)" % calls)
            ok(pg.evaluate("(id) => !S.companies[id] && clientRemoved(id)", NEW), "the client is gone here and counts as removed")
            ok(pg.evaluate("(id) => !sortedCompanies().some(c => c.id === id)", NEW), "not in the switcher's list (sortedCompanies)")
            pg.evaluate("() => { S.coId = null; S.view = 'home'; navHome('clients'); }"); pg.wait_for_timeout(800)
            names = pg.evaluate("() => [...document.querySelectorAll('#app table tbody tr td:first-child b')].map(b => b.innerText.trim())")
            ok(SAL not in names and "Car Laundry Retail Private Limited" in names and "Salesify Marketing LLP" in names, "the Clients list: the live clients only (%s)" % names)
            tally_page(pg)
            ok(pg.locator(R(SAL) + " [data-tco-act=pick]").count() == 1 and pg.locator(R(SAL) + " [data-tco-linked-label]").count() == 0, "its company is free at once (Link to client…)")
            pg.click(R(SAL) + " [data-tco-act=pick]"); pg.wait_for_timeout(300)
            opts = pg.evaluate("(s) => [...document.querySelectorAll(s + ' [data-tco-relink-pick] option')].map(o => o.value).filter(Boolean)", R(SAL))
            ok(sorted(opts) == sorted([CAR, LLP]), "Link to client…: the two live clients only (%s)" % opts)
            pg.close()
        except Exception as e:
            ok(False, "sections 1-4 stopped: %s" % str(e).splitlines()[0])
        print("== 5. no overlap (1366, 1440, 390)")
        for w, h in ((1366, 768), (1440, 900), (390, 844)):
            pg = page(w, h); scene(pg); client_page(pg, NEW); pop(pg)
            o = pg.evaluate(OVERLAP, POP)
            ok(not o.get("missing") and not o["hits"] and not o["out"] and o["sw"] <= o["iw"], "%d: the popover's link card: %d boxes, none intersect, none outside (%s)" % (w, o.get("n", 0), o))
            gap = pg.evaluate("(s) => { const a = document.querySelector(s + ' [data-tally-pop-pick]'), b = document.querySelector(s + ' [data-tally-pop-act=link]'), f = document.querySelector(s + ' [data-tally-pop-page]');"
                              " if (!a || !b || !f) return null; const A = a.getBoundingClientRect(), B = b.getBoundingClientRect(), F = f.getBoundingClientRect(); return {selLink: Math.round(B.top - A.bottom), linkFoot: Math.round(F.top - B.bottom)}; }", POP)
            ok(gap and gap["selLink"] >= 6 and gap["linkFoot"] >= 8, "%d: room between the list and Link (its focus ring never over the button) and before Open Tally page (%s)" % (w, gap))
            shot(pg, "client-pop-%d" % w, POP)
            pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
            # linked: the Tally page's row
            pg.evaluate("(c) => tallyLinkClient(%s, c)" % json.dumps(SAL), NEW); pg.wait_for_timeout(1200)
            tally_page(pg)
            o = pg.evaluate(OVERLAP.replace("label, select, button, a, b, .note, p > span", "button, a, b, .note, .tag, summary"), R(SAL))
            ok(not o.get("missing") and not o["hits"] and o["sw"] <= o["iw"], "%d: the Tally page's linked row: none intersect (%s)" % (w, o))
            shot(pg, "tally-row-linked-%d" % w, R(SAL))
            pg.close()
        br.close()
    srv.shutdown()
    ok(not [e for e in errors if "ResizeObserver" not in e], "no page errors (%s)" % errors[:3])
    print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
