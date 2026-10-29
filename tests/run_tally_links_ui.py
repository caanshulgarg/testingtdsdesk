"""python3 run_tally_links_ui.py - Clients linked to Tally (next-fix-tally-links, 29-Oct-2026; the owner: "in tally page, I am
not able to see and change the tally company.. the steps was hidden after connecting").
On the smart Tally page (next-tally-smart) a connected computer hides the steps, and a client's Tally company was only seen
while that company was open in Tally (or as one quiet line among the open companies), with no way to choose ANOTHER Tally
company for the client: "Link to another client" moves the company, it does not change the client's company.
Made-up computers and companies (run_tally_page_clean.py's stand-in cloud: a connected NWS144 with GB TEXCOAT and VMS
EVENTS open, GB TEXCOAT and ABC TRADERS linked, ABC TRADERS not open, OLD CO seen earlier), on the React build:
  1. under the companies open now, always: "Clients linked to Tally (2)", one row per linked client, the client on the left
     and its Tally company on the right, "open now" / "not open in Tally · last entry <date>", ⋯ with Change Tally company…
     and Unlink; no computer's name, no "Add as client"
  2. Change Tally company…: a picker of the companies FinCom has seen for the firm (open now first, then the others with
     when they were last seen); a free company is linked in ONE link call (the client's old company let go), Update now
     runs, the row shows the new company; a company linked to another client is asked once (No: nothing is sent)
  3. Unlink: asked, then the company is free (one unlink call) and the row goes
  4. the open companies' rows of a linked company: Change Tally company… beside Link to another client in ⋯
  5. the status card, connected: "Set up again / another computer" opens the steps (folded until then)
  6. Client setup › Tally: the company, Change and Unlink
  7. phone 390: no sideways page scroll (the picker open too)
Options: --shots DIR saves desktop 1440 light and dark and phone 390. Run on the React build:
TDSDESK_SITE=../app/dist-test python3 run_tally_links_ui.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = int(os.environ.get("LINKS_PORT") or 8497)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
ADD_ASK = re.compile(r"Add as client|Create client|Add client", re.I)
SEC = "#app [data-tlk]"
ROW = lambda name: SEC + ' [data-tlk-client-name="%s"]' % name

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    d6 = T.dev(7, "NWS144", "anshul", tally="open", opened=("GB TEXCOAT", "VMS EVENTS"), version="2.4.7")
    cos = T.companies(linked=("GB TEXCOAT", "ABC TRADERS"), seen=("VMS EVENTS",), d=d6["id"]) + [{"company": "OLD CO", "client_id": None, "device_id": d6["id"], "gstin": "", "last_seen": "ago:9000"}]
    with sync_playwright() as p:
        br = p.chromium.launch()
        def open_page(w, h, scheme="light"):
            pg = br.new_page(viewport={"width": w, "height": h}, color_scheme=scheme); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
                body=json.dumps({"setup": {"version": "2.4.7", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.7.exe", "sha256": "ab" * 32}})))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            pg.set_default_timeout(5000); return pg
        def scene(pg, books=T.HELD_ALL):
            ids = pg.evaluate(T.SETUP, [[d6], cos, [], "owner", T.CLIENTS, True, books])
            # the stand-in cloud keeps a link it took (as tally_companies does), so a read after it says the same
            pg.evaluate("""() => { const rpc = TCloud.rpc; TCloud.rpc = async (fn, a) => { const r = await rpc(fn, a);
              if (fn === 'tally_company_link') window.__companies.forEach(c => { if (c.company === a.p_company) c.client_id = a.p_client; }); return r; }; }""")
            pg.wait_for_timeout(1800); return ids
        def shot(pg, name):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)
        pg = open_page(1440, 900)
        E = lambda js, *a: pg.evaluate(js, *a)
        n = lambda sel: pg.locator(sel).count()
        txt = lambda sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        def confirm(yes=True):
            sel = '#confirmBox [data-cbx="%s"]' % ("yes" if yes else "no")
            pg.wait_for_selector(sel, state="visible", timeout=10000); pg.click(sel)
            pg.wait_for_selector(sel, state="hidden", timeout=10000); pg.wait_for_timeout(500)
        links = lambda: [c[1] for c in E("window.__calls") if c[0] == "tally_company_link"]
        ids = scene(pg)
        shot(pg, "desktop-1440-light")
        try:
            print("== 1. Clients linked to Tally: always there, both clients")
            ok(n(SEC) == 1 and txt(SEC + " [data-tlk-head]").startswith("Clients linked to Tally (2)"), "the section 'Clients linked to Tally (2)' (%s)" % txt(SEC + " [data-tlk-head]"))
            ok(sorted(E("(s) => [...document.querySelectorAll(s + ' [data-tlk-row]')].map(r => r.getAttribute('data-tlk-client-name'))", SEC)) == ["ABC TRADERS", "GB TEXCOAT"], "one row per linked client: GB TEXCOAT and ABC TRADERS (whose company is not open)")
            ok(E("() => { const o = document.querySelector('#app [data-tco-list=firm] .tco-rows'), s = document.querySelector('#app [data-tlk]'); return !!o && !!s && !!(o.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING); }"), "it comes under the companies open now")
            ab, gb = ROW("ABC TRADERS"), ROW("GB TEXCOAT")
            ok(txt(ab + " [data-tlk-side=client]").startswith("ABC TRADERS") and txt(ab + " [data-tlk-side=tally]") == "ABC TRADERS", "client on the left, its Tally company on the right (%s | %s)" % (txt(ab + " [data-tlk-side=client]"), txt(ab + " [data-tlk-side=tally]")))
            left = E("(s) => { const a = document.querySelector(s + ' [data-tlk-side=client]').getBoundingClientRect(), b = document.querySelector(s + ' [data-tlk-side=tally]').getBoundingClientRect(); return a.right <= b.left; }", ab)
            ok(left, "desktop: the client is left of the Tally company")
            st_ab, st_gb = txt(ab + " [data-tlk-state]"), txt(gb + " [data-tlk-state]")
            ok(st_gb.startswith("open now") and st_ab.startswith("not open in Tally") and re.search(r"last (entry|seen)", st_ab), "the small state: open now / not open in Tally · last entry (%s | %s)" % (st_gb, st_ab))
            ok("NWS144" not in txt(SEC) and "anshul" not in txt(SEC), "no computer's name in the rows (%s)" % txt(SEC)[:200])
            ok(not ADD_ASK.search(txt("#app")) and n("#app [data-tco-add]") == 0, "no 'Add as client' anywhere")
            ok(n("#app [data-connect-step]") == 0 and n("#app [data-connect-guide]") == 0, "connected: the steps stay folded")
            pg.click(ab + " [data-tlk-more] summary"); pg.wait_for_timeout(250)
            ok(n(ab + " [data-tlk-change]") == 1 and n(ab + " [data-tlk-unlink]") == 1 and "Change Tally company" in txt(ab + " [data-tlk-change]"), "⋯: Change Tally company… and Unlink")
            print("== 2. Change Tally company…: the picker")
            E("() => { window.__calls = []; }")
            pg.click(ab + " [data-tlk-change]"); pg.wait_for_timeout(400)
            ok(n(ab + " [data-tlk-pick]") == 1, "the picker opens under the row")
            opts = E("(s) => [...document.querySelectorAll(s + ' [data-tlk-pick] option')].filter(o => o.value).map(o => ({v: o.value, t: o.text, g: o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : ''}))", ab)
            vs = [o["v"] for o in opts]
            ok(vs[:2] == ["GB TEXCOAT", "VMS EVENTS"] or vs[:2] == ["VMS EVENTS", "GB TEXCOAT"], "open now first (%s)" % vs)
            ok("OLD CO" in vs and vs.index("OLD CO") >= 2 and re.search(r"last seen", [o["t"] for o in opts if o["v"] == "OLD CO"][0]) and "ABC TRADERS" not in vs, "then the others with when they were last seen; not its own company (%s)" % [o["t"] for o in opts])
            ok(any("GB TEXCOAT" == o["v"] and "linked to GB TEXCOAT" in o["t"] for o in opts), "a company linked to another client says so (%s)" % [o["t"] for o in opts])
            ok("NWS144" not in " ".join(o["t"] for o in opts), "no computer's name in the picker")
            shot(pg, "desktop-1440-light-picker")
            pg.select_option(ab + " [data-tlk-pick]", "VMS EVENTS"); pg.click(ab + " [data-tlk-go]"); pg.wait_for_timeout(1800)
            lk = links(); to = [x for x in lk if x.get("p_client") == ids["ABC TRADERS"]]
            ok(len(to) == 1 and to[0].get("p_company") == "VMS EVENTS", "a free company: ONE link call, VMS EVENTS → ABC TRADERS, nothing asked (%s)" % lk)
            ok({"p_company": "ABC TRADERS", "p_client": None} in lk, "its old company is let go (%s)" % lk)
            ok(n("#confirmBox [data-cbx=yes]:visible") == 0, "nothing asked for a free company")
            ok(any(c[0] == "tally_want_update" for c in E("window.__calls")), "Update now runs after linking (%s)" % sorted(set(c[0] for c in E("window.__calls"))))
            ok(txt(ab + " [data-tlk-side=tally]") == "VMS EVENTS" and txt(ab + " [data-tlk-state]").startswith("open now"), "the row shows the new company, open now (%s)" % txt(ab))
            # a company taken by another client: asked once; No sends nothing; Yes moves it
            pg.click(ab + " [data-tlk-more] summary"); pg.wait_for_timeout(250); pg.click(ab + " [data-tlk-change]"); pg.wait_for_timeout(400)
            E("() => { window.__calls = []; }")
            pg.select_option(ab + " [data-tlk-pick]", "GB TEXCOAT"); pg.click(ab + " [data-tlk-go]")
            ok("GB TEXCOAT" in txt("#confirmBox") and "linked to" in txt("#confirmBox").lower() if pg.wait_for_selector("#confirmBox [data-cbx=no]", state="visible", timeout=10000) else False, "a company linked to another client: asked once (%s)" % txt("#confirmBox")[:200])
            confirm(False)
            ok(links() == [], "No: nothing is sent (%s)" % links())
            pg.click(ab + " [data-tlk-go]"); confirm(True); pg.wait_for_timeout(1500)
            to = [x for x in links() if x.get("p_client") == ids["ABC TRADERS"]]
            ok(len(to) == 1 and to[0].get("p_company") == "GB TEXCOAT" and n("#confirmBox [data-cbx=yes]:visible") == 0, "Yes: ONE link call, asked only once (%s)" % links())
            ok(txt(ab + " [data-tlk-side=tally]") == "GB TEXCOAT" and n(ROW("GB TEXCOAT")) == 0, "ABC TRADERS shows GB TEXCOAT; GB TEXCOAT the client is no longer listed (%s)" % txt(SEC)[:200])
            print("== 3. Unlink: asked, then free")
            scene(pg); E("() => { window.__calls = []; }")
            pg.click(ab + " [data-tlk-more] summary"); pg.wait_for_timeout(250); pg.click(ab + " [data-tlk-unlink]")
            pg.wait_for_selector("#confirmBox [data-cbx=no]", state="visible", timeout=10000)
            ok("Unlink" in txt("#confirmBox"), "Unlink asks first (%s)" % txt("#confirmBox")[:120])
            confirm(True); pg.wait_for_timeout(1200)
            ok(links() == [{"p_company": "ABC TRADERS", "p_client": None}], "one unlink call (%s)" % links())
            ok(n(ab) == 0 and txt(SEC + " [data-tlk-head]").startswith("Clients linked to Tally (1)"), "the row goes; (1) (%s)" % txt(SEC + " [data-tlk-head]"))
            print("== 4. the open companies' rows: Change Tally company… too")
            scene(pg)
            orow = '#app [data-tco-list=firm] [data-tco-row="GB TEXCOAT"]'
            pg.click(orow + " [data-tco-more] summary"); pg.wait_for_timeout(250)
            ok(n(orow + " [data-tco-change]") == 1 and n(orow + " [data-tco-not-this]") == 1, "⋯ of an open linked company: Change Tally company… and Link to another client")
            pg.click(orow + " [data-tco-change]"); pg.wait_for_timeout(400)
            ok(n(orow + " [data-tlk-pick]") == 1, "its picker opens under the row")
            pg.keyboard.press("Escape")
            print("== 5. the status card: Set up again / another computer")
            scene(pg)
            ok(n("#app [data-status-card] [data-tsc-setup]") == 1 and "Set up again / another computer" in txt("#app [data-status-card] [data-tsc-setup]") and n("#app [data-connect-guide]") == 0, "connected: a small 'Set up again / another computer', the steps folded")
            pg.click("#app [data-status-card] [data-tsc-setup]"); pg.wait_for_timeout(800)
            ok(n("#app [data-connect-guide]") == 1 and n("#app [data-connect-step]") == 4, "it opens the steps")
            shot(pg, "desktop-1440-light-setup")
            print("== 6. Client setup › Tally: the link, Change, Unlink")
            # (no books in the cloud here: this stand's held books keep a client's pages busy, Tally page or not)
            scene(pg, {})
            E("(id) => { Promise.resolve((S.coId = id, S.view = 'company')).then(() => { S.step = null; S.tab = 'cotally'; render(); }); }", ids["ABC TRADERS"]); pg.wait_for_timeout(1500)
            one = "#app [data-tally-one]"
            ok(n(one) == 1 and "ABC TRADERS" in txt(one + " [data-tally-one-company]"), "the client's Tally company is shown (%s)" % txt(one))
            ok(n(one + " [data-tally-one-change]") == 1 and n(one + " [data-tally-one-unlink]") == 1, "Change and Unlink (%s)" % txt(one))
            if n(one + " [data-tally-one-change]"):
                pg.click(one + " [data-tally-one-change]"); pg.wait_for_timeout(1500)
                ok(E("S.homeTab") == "tally" and n(ROW("ABC TRADERS") + " [data-tlk-pick]") == 1, "Change opens the Tally page with its picker open")
            E("(id) => { Promise.resolve((S.coId = id, S.view = 'company')).then(() => { S.step = null; S.tab = 'cotally'; render(); }); }", ids["ABC TRADERS"]); pg.wait_for_timeout(1200)
            E("() => { window.__calls = []; }")
            if n(one + " [data-tally-one-unlink]"):
                pg.click(one + " [data-tally-one-unlink]"); confirm(True); pg.wait_for_timeout(1200)
                ok(links() == [{"p_company": "ABC TRADERS", "p_client": None}], "Unlink there: asked, then one unlink call (%s)" % links())
        except Exception as e:
            ok(False, "the steps ran through (%s)" % str(e).split("\n")[0])
        pg.close()
        print("== 7. dark, phone 390: no sideways scroll")
        for w, h, scheme in ((1440, 900, "dark"), (390, 844, "light"), (390, 844, "dark")):
            pg = open_page(w, h, scheme); E = lambda js, *a: pg.evaluate(js, *a); n = lambda sel: pg.locator(sel).count()
            scene(pg)
            ok(n(SEC) == 1, "%d %s: the section is there" % (w, scheme))
            ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "%d %s: no sideways page scroll (%s > %s)" % (w, scheme, E("document.documentElement.scrollWidth"), w))
            shot(pg, ("desktop-1440-" if w > 400 else "phone-390-") + scheme)
            if w == 390 and n(ROW("ABC TRADERS") + " [data-tlk-more]"):
                pg.click(ROW("ABC TRADERS") + " [data-tlk-more] summary"); pg.wait_for_timeout(250); pg.click(ROW("ABC TRADERS") + " [data-tlk-change]"); pg.wait_for_timeout(400)
                ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "390 %s: the picker open, still no sideways scroll" % scheme)
                if scheme == "light": shot(pg, "phone-390-light-picker")
            pg.close()
        br.close()
    srv.shutdown()
    ok(not [e for e in errors if "ResizeObserver" not in e], "no page errors (%s)" % errors[:3])
    print("\n%d failure(s)" % len(fails) if fails else "\nall ok")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
