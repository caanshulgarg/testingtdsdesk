"""python3 run_tally_smart.py - the smart Tally page (next-tally-smart, 28-Oct-2026; the owner: "show only currently opened
Tally; remove earlier Tally opened but not opened currently; make the complete page smart"; "no suggestion to add clients";
"I need visibility of which client a company is linked to"; "no false alarms at all"). Made-up computers and companies
(run_tally_page_clean.py's stand-in cloud), on the React build:
  1. ONE status card on top, no computer's name (next-fix-tally-links2): "FinCom Bridge 2.4.7 · Connected", "Tally open: 2
     companies"; no step wizard once a computer is connected (the four steps only when no computer is heard)
  2. the list is the companies OPEN in Tally now, the client on the LEFT and the Tally company on the RIGHT under the two
     headings; a company not linked has the picker itself ("Choose client", existing clients only, "+ New client with
     this name" small inside it) and never an "Add as client" suggestion; a linked one says "Linked to client: <name>"
  3. a company seen earlier, not open and not linked: NOT on the page (only under Help & support › Every company seen)
  4. every linked client, its company open or not: one quiet row under "Your clients and their Tally company (N)" (every client;
     open now / not open in Tally now · last entry), nothing to fix; ⋯ Change Tally company… and Unlink
     (next-fix-tally-links, run_tally_links_ui.py)
  5. one computer or two: one plain state, never a row or a name per computer (next-fix-tally-links2)
  6. a problem is one plain line with one action (Tally not open; reading paused; offline), never an alert for nothing
  7. no element overlaps, no sideways scroll, at 1366, 1440 and 390, light and dark
Options: --shots DIR saves the scenes. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_smart.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = int(os.environ.get("SMART_PORT") or 8493)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
OVERLAP = """(sel) => { const root = document.querySelector(sel); if (!root) return {missing: true};
  const R = root.getBoundingClientRect(), out = [], hits = [];
  const els = [...root.querySelectorAll('button, a, b, .note, .tag, summary, select, h3, p')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!e.checkVisibility || e.checkVisibility({opacityProperty: true, visibilityProperty: true})) && !e.closest('details:not([open]) > :not(summary)'); });
  const leaf = els.filter(e => !els.some(o => o !== e && e.contains(o)));
  for (const e of leaf){ const r = e.getBoundingClientRect(); if (r.right > R.right + 1 || r.left < R.left - 1) out.push(e.tagName + '[' + e.innerText.slice(0, 20) + '] ' + Math.round(r.left) + '-' + Math.round(r.right)); }
  for (let i = 0; i < leaf.length; i++) for (let j = i + 1; j < leaf.length; j++){ const a = leaf[i].getBoundingClientRect(), b = leaf[j].getBoundingClientRect();
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 1 && h > 1 && !leaf[i].contains(leaf[j]) && !leaf[j].contains(leaf[i])) hits.push(leaf[i].tagName + '[' + leaf[i].innerText.slice(0, 20) + '] x ' + leaf[j].tagName + '[' + leaf[j].innerText.slice(0, 20) + ']'); }
  return {n: leaf.length, out, hits, sw: document.documentElement.scrollWidth, iw: innerWidth}; }"""
ADD_ASK = re.compile(r"Add as client|Create client|Add client", re.I)

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def open_page(w, h, scheme="light"):
            pg = br.new_page(viewport={"width": w, "height": h}, color_scheme=scheme); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
                body=json.dumps({"setup": {"version": "2.4.7", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.7.exe", "sha256": "ab" * 32}})))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            return pg
        pg = open_page(1440, 900)
        E = lambda js, *a: pg.evaluate(js, *a)
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        n = lambda sel: pg.locator(sel).count()
        body = lambda: E("() => { const a = document.querySelector('#app').cloneNode(true); a.querySelectorAll('[data-advanced]').forEach(e => e.remove()); return a.innerText.replace(/\\s+/g, ' '); }")
        def scene(devs, cos, role="owner", books=None):
            ids = E(T.SETUP, [devs, cos, [], role, T.CLIENTS, True, books or {}]); pg.wait_for_timeout(1800); return ids
        def shot(name):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)
        rows = lambda sel="[data-tco-list=firm]": E("(s) => [...document.querySelectorAll('#app ' + s + ' [data-tco-row]')].map(r => ({co: r.getAttribute('data-tco-row'), linked: r.getAttribute('data-tco-linked'), open: r.hasAttribute('data-tco-open'), linked_row: r.hasAttribute('data-linked-row'), text: r.innerText.replace(/\\s+/g, ' ').trim(), act: (r.querySelector('[data-tco-act]') || {}).getAttribute ? (r.querySelector('[data-tco-act]') || {getAttribute: () => ''}).getAttribute('data-tco-act') : ''}))", sel)
        # the owner's scene: NWS144 online, Tally open with GB TEXCOAT (linked) and VMS EVENTS (not linked); ABC TRADERS linked but
        # not open; OLD CO seen last week, not linked, not open
        d6 = T.dev(7, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT", "VMS EVENTS"), version="2.4.7")
        cos = T.companies(linked=("GB TEXCOAT", "ABC TRADERS"), seen=("VMS EVENTS",), d=d6["id"]) + [{"company": "OLD CO", "client_id": None, "device_id": d6["id"], "gstin": "", "last_seen": "ago:9000"}]
        print("== 1. one status card, no wizard")
        ids = scene([d6], cos, books=T.HELD_ALL)
        card = txt("#app [data-status-card]")
        ok(n("#app [data-status-card]") == 1 and card.startswith("FinCom Bridge 2.4.7 Connected") and "NWS144" not in card and "anshul" not in card, "one status card: version, Connected, no computer's name (%s)" % card[:90])
        ok("Tally open: 2 companies" in card, "the card says Tally open: 2 companies (%s)" % card[:120])
        ok(n("#app [data-connect-step]") == 0 and n("#app [data-connect-guide]") == 0, "connected: no step wizard")
        ok(n("#app [data-oc-connect]") == 0 and n("#app [data-oc-find]") == 0 and n("#app [data-tsc-refresh]") == 1, "connected: no Connect / Find Tally button, only Refresh")
        ok(n("#app [data-scope-pick]") == 0 and "All computers" not in body(), "one computer: nothing about other computers, no switch")
        print("== 2. the list: open companies only, client left, Tally company right")
        rs = [r for r in rows() if not r["linked_row"]]; names = [r["co"] for r in rs]
        ok(sorted(names) == ["GB TEXCOAT", "VMS EVENTS"] and all(r["open"] for r in rs), "the list is the companies open in Tally now (%s)" % names)
        ok(n("#app [data-tco-list=firm] [data-tco-cols]") == 1 and txt("#app [data-tco-list=firm] [data-tco-cols]").lower() == "client tally company", "the two headings: Client · Tally company (%s)" % txt("#app [data-tco-list=firm] [data-tco-cols]"))
        gb = '#app [data-tco-list=firm] [data-tco-row="GB TEXCOAT"]'
        ok(txt(gb + ' [data-tco-side="client"]').startswith("Linked to client: GB TEXCOAT") and txt(gb + ' [data-tco-side="tally"]') == "GB TEXCOAT" and n(gb + " [data-tco-client]") == 1,
           "a linked row: 'Linked to client: GB TEXCOAT' on the left (the name opens the client), the Tally company on the right (%s | %s)" % (txt(gb + ' [data-tco-side="client"]'), txt(gb + ' [data-tco-side="tally"]')))
        left = E("(s) => { const a = document.querySelector(s + ' [data-tco-side=client]').getBoundingClientRect(), b = document.querySelector(s + ' [data-tco-side=tally]').getBoundingClientRect(); return a.right <= b.left; }", gb)
        ok(left, "desktop: the client is left of the Tally company")
        ok(n(gb + " [data-tco-sync-now]") == 1 and n(gb + " [data-tco-more]") == 1 and n(gb + " [data-tco-sync=held]") == 1 and "NWS144" not in txt(gb), "a linked row: Sync now, ⋯, the ledgers and entries FinCom holds; no computer's name on the row (%s)" % txt(gb))
        vm = '#app [data-tco-list=firm] [data-tco-row="VMS EVENTS"]'
        ok(n(vm + " select[data-tco-act=pick]") == 1 and txt(vm + " select[data-tco-act=pick] option:first-child") == "Choose client" and n(vm + " [data-tco-relink]") == 1 and n(vm + " [data-tco-add-new]") == 1,
           "a company not linked: the picker itself on the left ('Choose client', Link, '+ New client with this name' inside)")
        opts = E("(s) => [...document.querySelectorAll(s + ' [data-tco-relink-pick] option')].map(o => o.text).filter(Boolean)", vm)
        ok(sorted(opts) == sorted(["Choose client"] + T.CLIENTS), "the picker lists the existing clients only (%s)" % opts)
        ok(not ADD_ASK.search(body()) and n("#app [data-tco-add]") == 0, "no 'Add as client' suggestion anywhere on the page")
        ok(txt(vm + ' [data-tco-side="tally"]') == "VMS EVENTS" and n(vm + " [data-tco-more]") == 0, "the Tally company on the right; nothing else on the row")
        shot("1-owner-1440")
        print("== 3. closed + not linked: hidden; linked: Clients linked to Tally")
        ok("OLD CO" not in body(), "a company seen earlier, not open, not linked: not on the page")
        lc = "#app [data-tco-list=firm]"
        ok(n(lc + " [data-tlk]") == 1 and txt(lc + " [data-tlk-head]") == "Your clients and their Tally company (3)" and n(lc + " [data-tlk-row]") == 3 and n(lc + ' [data-linked-row="ABC TRADERS"]') == 1 and n(lc + " [data-linked-row]") == 1,
           "Your clients and their Tally company (3): GB TEXCOAT (open), ABC TRADERS (not open), garg shekhar (not linked), after the open ones (%s)" % txt(lc + " [data-tlk-head]"))
        lt = txt(lc + ' [data-linked-row="ABC TRADERS"]')
        ok(txt(lc + ' [data-linked-row="ABC TRADERS"] [data-tlk-side="client"]') == "ABC TRADERS" and txt(lc + ' [data-linked-row="ABC TRADERS"] [data-tlk-side="tally"]') == "ABC TRADERS" and "not open in Tally now" in txt(lc + ' [data-linked-row="ABC TRADERS"] [data-linked-meta]'), "its one line: client · company · not open in Tally now (%s)" % lt)
        ok(n(lc + " [data-linked-row] [data-tco-fix]") == 0 and "Open ABC TRADERS in TallyPrime" not in body() and n("#app [data-needs-you]") == 0 and "NWS144" not in lt, "nothing to fix for a company simply not open (no false alarm), no computer's name")
        ok(n(lc + " [data-linked-row] [data-tco-more]") == 1, "its ⋯ (Change Tally company…, Unlink)")
        pg.click(lc + ' [data-linked-row="ABC TRADERS"] [data-tco-more] summary'); pg.wait_for_timeout(300)
        ok(n(lc + " [data-linked-row] [data-tco-unlink]") == 1 and n(lc + " [data-linked-row] [data-tlk-change]") == 1, "⋯ holds Change Tally company… and Unlink")
        pg.keyboard.press("Escape")
        # Help & support holds every company seen (OLD CO, to link or remove)
        pg.click("#app [data-advanced] [data-bridge-details]"); pg.wait_for_timeout(700)
        ok(n('#app [data-advanced] [data-tco-list=all] [data-tco-row="OLD CO"]') == 1 and n('#app [data-advanced] [data-tco-list=all] [data-tco-row="OLD CO"] [data-tco-hide]') == 1, "Help & support: every company seen, OLD CO with Remove company")
        pg.click("#app [data-advanced] [data-bridge-details]"); pg.wait_for_timeout(400)
        print("== 4. the picker links; one click")
        E("() => { window.__calls = []; }")
        pg.select_option(vm + " [data-tco-relink-pick]", ids["garg shekhar & company"]); pg.click(vm + " [data-tco-relink]"); pg.wait_for_timeout(1500)
        lk = [c for c in E("window.__calls") if c[0] == "tally_company_link"]
        ok(lk and lk[-1][1].get("p_company") == "VMS EVENTS" and lk[-1][1].get("p_client") == ids["garg shekhar & company"], "Choose client → Link: tally_company_link (%s)" % lk)
        print("== 5. two computers: the switch")
        lap = T.dev(8, "LAPTOP", "ravi", tally="closed", opened=(), version="2.4.7")
        scene([d6, lap], cos, books=T.HELD_ALL)
        ok(n("#app [data-status-card]") == 1 and "All computers" not in txt("#app [data-status-card]") and "Connected" in txt("#app [data-status-card]"), "two computers, this browser on neither: one plain state, Connected (%s)" % txt("#app [data-status-card]")[:100])
        ok(n("#app .tpc-one, #app [data-scope-pick]") == 0 and "LAPTOP" not in body() and "NWS144" not in body(), "no line, name or switch per computer")
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "no sideways scroll")
        print("== 6. problems: one line, one action")
        scene([T.dev(9, "NWS144", "anshul", tally="closed", opened=(), version="2.4.7")], cos, books=T.HELD_ALL)
        card = txt("#app [data-status-card]")
        ok("Tally not open" in card and n("#app [data-tsc-need=tally]") == 1 and n("#app [data-status-card] .btn.primary") <= 1, "Tally not open: the one line, one primary action at most (%d primary: %s)" % (n("#app [data-status-card] .btn.primary"), card[:160]))
        # (the owner's port step, 26-Oct-2026, is on the card while his Tally is not answering: not a wizard)
        ok(n("#app [data-connect-step]:not([data-port-step])") == 0 and n("#app [data-connect-guide]") == 0 and "FinCom Bridge on NWS144 is offline" not in card, "still no wizard; no false offline")
        scene([T.PAUSED], T.companies(), books=T.HELD_ALL)
        card = txt("#app [data-status-card]")
        ok("Paused" in card and "Resume background reading" in card and n("#app [data-tsc-need=paused]") == 1, "reading paused: said once with how to resume (%s)" % card[:160])
        ok(n("#app [data-tco-none-open]") == 1 and n("#app [data-tco-list=firm] [data-linked-row]") == 2 and "VMS EVENTS" not in body(), "no company open: the list says so; the two linked clients under Your linked clients; VMS EVENTS (seen, not linked) not on the page")
        shot("2-paused-1440")
        scene([T.dev(2, "NWS144", "anshul", at="ago:90", tally="closed", opened=())], cos, books=T.HELD_ALL)
        card = txt("#app [data-status-card]")
        ok("Offline" in card and n("#app [data-tsc-need=offline]") == 1, "offline: said on the card (%s)" % card[:120])
        scene([], [])
        ok(n("#app [data-connect-step]") == 4 and n("#app [data-firstlink]") == 1 and "Not connected" in txt("#app [data-status-card]"), "no computer ever connected: the four steps and the connect panel")
        shot("3-nothing-1440")
        pg.close()
        print("== 7. no overlap, no sideways scroll (1366, 1440, 390; light and dark)")
        for w, h, scheme in ((1366, 768, "light"), (1440, 900, "dark"), (390, 844, "light"), (390, 844, "dark")):
            pg = open_page(w, h, scheme); E = lambda js, *a: pg.evaluate(js, *a); n = lambda sel: pg.locator(sel).count()
            E(T.SETUP, [[d6], cos, [], "owner", T.CLIENTS, True, T.HELD_ALL]); pg.wait_for_timeout(1800)
            for sel in ("[data-status-card]", "[data-tco-list=firm]"):
                o = E(OVERLAP, "#app " + sel)
                ok(not o.get("missing") and not o["hits"] and not o["out"] and o["sw"] <= o["iw"], "%d %s %s: %d boxes, none intersect, none outside (%s)" % (w, scheme, sel, o.get("n", 0), {k: o[k] for k in ("hits", "out") if o.get(k)}))
            if w == 390:
                over = E("() => { const r = document.querySelector('#app [data-tco-list=firm] [data-tco-row]'); const a = r.querySelector('[data-tco-side=client]').getBoundingClientRect(), b = r.querySelector('[data-tco-side=tally]').getBoundingClientRect(); return a.bottom <= b.top + 1; }")
                ok(over, "phone: the client stacks over the Tally company")
            if SHOTS: pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.screenshot(path=os.path.join(SHOTS, "7-%d-%s.png" % (w, scheme)), full_page=True)
            pg.close()
        br.close()
    srv.shutdown()
    ok(not [e for e in errors if "ResizeObserver" not in e], "no page errors (%s)" % errors[:3])
    print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
