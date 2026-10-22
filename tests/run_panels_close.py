"""python3 run_panels_close.py - every side panel closes, every way (next-fix-drawers; the owner, 22-Oct-2026: "While adding
deductee field, side bar is not getting close.. pls check everywhere in panel where side bar is not getting closed", then
"If I click on the main screen also.. it should close right away"). One shared panel does it (app/src/parts/DetailDrawer's
Panel on app/src/parts/dismiss.js); this opens each panel of the app and checks, at 1400 and on a phone (390):
  1. ✕, Esc, a click on the page outside it (a computer; on a phone the panel is the whole screen) and Back close it at
     once: never a "Discard?" ask, no see-through layer over the page catching the click, Esc never leaves the client,
     Back leaves the page where it was, and the panel does not come back when its step is opened again
  2. the owner's case: TDS → Deductees → a deductee's name: the name and the PAN typed, then closed each way; typed and not
     saved is kept as that deductee's draft ("Unsaved changes kept · Discard"); Save closes it, the row shows the new
     name, the draft is gone; a Save that fails stays open and says why; Add deduction the same
Runs on the React build: app/dist-test, or TDSDESK_SITE."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from tdsgst_snapshot import LOAD, CHALLANS
from books_data import CACHE
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("PANELS_PORT") or 8393)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

RET = "(t) => { S.view = 'company'; S.tab = 'books'; S.booksTab = 'tds'; S.tdsDee = ''; S.tdsAdd = null; tdsGo('2025-26', 'Q1', '26Q'); S.tdsTab = t; render(); }"
ROW = "(TDS.formRows('26Q').find(r => r.fy === '2025-26' && r.q === 'Q1') || {}).id"
CH = "(TDS.challans()[0] || {}).id"
# [name, selector of the panel, the step it opens on, how it opens (JS), its own words for Cancel or "", phone too]
PANELS = [
    ("Deductee details", '[data-drawer="deductee"]', "deductees", "() => tdsDeducteeOpen(TDSPanFix.list('26Q', '2025-26', 'Q1')[0].key)", "Cancel"),
    ("Add a deduction", '[data-drawer="add-deduction"]', "deductions", "() => { S.tdsAdd = {}; render(); }", "Cancel"),
    ("Deduction details", '[data-drawer="deduction"]', "deductions", "() => { S.tdsRowDet = " + ROW + "; render(); }", ""),
    ("Deductions register", '[data-drawer="dreg"]', "deductions", "() => { S.tdsDedView = ''; S.tdsDedReg = 'pending'; S.tdsDregSel = {}; render(); }", ""),
    ("Paste PANs", '[data-drawer="pan-paste"]', "deductees", "() => { S.tdsPanPaste = true; render(); }", ""),
    ("PAN book", '[data-drawer="pan-book"]', "deductees", "() => { S.tdsPanBook = true; render(); }", ""),
    ("Keys", '[data-drawer="keys"]', "deductions", "() => { S.tdsDedView = 'table'; S.tdsKeys = true; render(); }", ""),
    ("How a return is made", '[data-drawer="how"]', "deductees", "() => { S.tdsHow = true; render(); }", ""),
    ("The corrected Excel", '[data-drawer="import"]', "deductions", "() => { S.tdsImport = {name: 'x.xlsx', rows: 1, changes: [], refused: [], unmatched: [], notes: []}; render(); }", "Close"),
    ("Pick other challans", '[data-drawer="ch-pick"]', "challans", "() => { const m = document.querySelector('#app [data-cm-add=pick]'); if (m) m.click(); else { const s = document.querySelector('#app details.more:has([data-cm-add=pick]) > summary'); if (s) { s.click(); setTimeout(() => document.querySelector('#app [data-cm-add=pick]').click(), 100); } } }", ""),
    ("Move to a challan (dialog)", '[data-cm-move-dialog]', "deductions", "() => { S.tdsMove = {ids: [" + ROW + "]}; render(); }", "", "dialog"),
    ("Split the row (dialog)", '[data-cm-split-dialog]', "deductions", "() => { S.tdsSplit = {rowId: " + ROW + "}; render(); }", "", "dialog"),
    ("A challan's detail (register)", '[data-detail="challan"]', "@register", "() => openDetail('challan', " + CH + ")", ""),
]

try:
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
        J = lambda e, a=None: pg.evaluate(e, a); W = pg.wait_for_timeout
        pg.goto("http://localhost:%d/" % PORT); W(2500); pg.click('button[data-act="useOffline"]'); W(1200)
        J(LOAD, books); W(1000); J("S.books = window.__bk; render();"); W(500); J(CHALLANS); W(300)
        cid = J("S.coId")
        shown = lambda sel: pg.locator(sel).count() > 0 and pg.locator(sel).first.is_visible()
        asked = lambda: pg.locator("#confirmBox [data-cbx=yes]").is_visible() or pg.locator("#confirmBox [data-leave]").count() > 0
        def where(): return J("S.view + '/' + S.coId + '/' + (S.tdsView || '') + '/' + (S.tdsTab || '')")
        def go(step):
            if step == "@register": J("() => { S.view = 'company'; S.tab = 'books'; S.booksTab = 'tds'; S.tdsFy = '2025-26'; S.tdsView = 'register'; S.detail = null; render(); }")
            elif step: J(RET, step)
            W(600)
        def open_(sel, step, js):
            go(step); W(200); open_.hash = J("location.hash"); J(js); W(900)
            return shown(sel)
        def outside_point(sel):
            """a point on the page left of the panel (or below a dialog), over the page's own content"""
            b = pg.locator(sel).first.bounding_box()
            if b and b["x"] > 40: return (max(10, b["x"] / 2), 450)
            return (30, 880) if b else None

        for vw in (1400, 390):
            pg.set_viewport_size({"width": vw, "height": 900 if vw > 600 else 844}); W(400)
            phone = vw < 600
            print("\n== %d px" % vw)
            print("1. every panel: ✕, Esc, a click outside, Back")
            for name, sel, step, js, cancel, *kind in PANELS:
                if not open_(sel, step, js):
                    ok(False, "%d %s: opens (%s)" % (vw, name, where())); continue
                at = where()
                pg.locator(sel + " button[aria-label^=Close]").first.click(); W(700)
                ok(not shown(sel) and not asked(), "%d %s: ✕ closes it" % (vw, name))
                open_(sel, step, js); pg.keyboard.press("Escape"); W(700)
                ok(not shown(sel) and J("S.view") == "company" and J("S.coId") == cid and where() == at,
                   "%d %s: Esc closes it, the client and the page stay (%s)" % (vw, name, where()))
                if not phone:
                    open_(sel, step, js); pt = outside_point(sel)
                    hit = J("([x, y]) => { const e = document.elementFromPoint(x, y); return e ? (e.closest('[class*=overlay], [data-state=open][style*=fixed]') ? 'a layer: ' + e.className : 'page') : 'none'; }", list(pt))
                    if not kind: ok(hit == "page", "%d %s: nothing see-through lies over the page while it is open (%s)" % (vw, name, hit))
                    pg.mouse.click(*pt); W(700)
                    ok(not shown(sel) and not asked() and where() == at, "%d %s: one click on the page outside closes it at once, no ask (%s)" % (vw, name, where()))
                if cancel:
                    open_(sel, step, js); pg.locator(sel + ' button:text-is("%s")' % cancel).first.click(); W(700)
                    ok(not shown(sel), "%d %s: %s closes it" % (vw, name, cancel))
                open_(sel, step, js); h = open_.hash
                pg.go_back(); W(900)
                ok(not shown(sel) and J("S.view") == "company" and where() == at and J("location.hash") == h,
                   "%d %s: Back closes it, the page stays (%s %s)" % (vw, name, where(), J("location.hash")))
                go(step); W(300)
                ok(not shown(sel), "%d %s: closed, it does not come back when its step is opened again" % (vw, name))
            # the other overlays (ROUND 55's): Check before filing, the Tally panel
            for name, sel, js in [("Check before filing", '[data-overlay="prefile"]', "() => PreFile.open('tds', '26Q', '2025-26', 'Q1')"),
                                  ("The Tally panel", '[data-overlay="tallypanel"]', "() => { S.tallyPanel = true; render(); }")]:
                go("deductees"); J(js); W(1200)
                ok(shown(sel), "%d %s: opens" % (vw, name))
                pg.keyboard.press("Escape"); W(700)
                ok(not shown(sel) and J("S.view") == "company", "%d %s: Esc closes it, the client stays" % (vw, name))
                if not phone:
                    J(js); W(1000); pt = outside_point(sel) or (300, 450); pg.mouse.click(*pt); W(700)
                    ok(not shown(sel), "%d %s: a click outside closes it" % (vw, name))

            print("2. the owner's case: a deductee's name, its name and PAN typed")
            D = '[data-drawer="deductee"]'
            def dee():
                go("deductees"); pg.locator("#app [data-dee-open]").first.click(); W(800)
                return shown(D)
            def type_both(nm=" Edited", pan="AAAPN1234C"):
                pg.locator(D + ' input[aria-label="Name in the file"]').click(); pg.keyboard.press("End"); pg.keyboard.type(nm)
                pg.locator(D + " input[aria-label=PAN]").click(); pg.keyboard.press("Control+A"); pg.keyboard.type(pan); W(300)
            name0 = J("TDSPanFix.list('26Q', '2025-26', 'Q1')[0].name")
            ways = [("✕", lambda: pg.locator(D + " button[aria-label=Close]").click()), ("Esc", lambda: pg.keyboard.press("Escape")),
                    ("Cancel", lambda: pg.locator(D + ' button:text-is("Cancel")').click()), ("Back", lambda: pg.go_back())]
            if not phone: ways.insert(0, ("a click on the page", lambda: pg.mouse.click(*outside_point(D))))
            for wname, how in ways:
                ok(dee(), "%d the deductee's panel opens from its name" % vw)
                type_both(); how(); W(800)
                ok(not shown(D) and not asked() and J("S.view") == "company", "%d typed in both boxes, %s closes it at once, no ask" % (vw, wname))
                ok(dee() and pg.locator(D + " [data-draft-kept]").count() == 1 and pg.input_value(D + ' input[aria-label="Name in the file"]') == name0 + " Edited"
                   and pg.input_value(D + " input[aria-label=PAN]") == "AAAPN1234C", "%d after %s, opened again: what was typed is kept, with \"Unsaved changes kept · Discard\"" % (vw, wname))
                ok("Unsaved changes kept" in pg.locator(D + " [data-draft-kept]").inner_text(), "%d the line's words" % vw)
                pg.locator(D + " [data-draft-discard]").click(); W(400)
                ok(pg.locator(D + " [data-draft-kept]").count() == 0 and pg.input_value(D + ' input[aria-label="Name in the file"]') == name0, "%d Discard puts the saved values back" % vw)
                pg.keyboard.press("Escape"); W(500)
            ok(dee(), "%d open again" % vw)
            type_both(" Saved", "AAAPN1234C")
            pg.locator(D + " [data-dee-save]").click(); W(900)
            ok(not shown(D), "%d Save closes the panel" % vw)
            ok(J("TDSPanFix.list('26Q', '2025-26', 'Q1')[0].name") == name0 + " Saved" and (name0 + " Saved") in pg.locator("#app #tdsDeTable").inner_text(), "%d the row shows the new name" % vw)
            ok(dee() and pg.locator(D + " [data-draft-kept]").count() == 0 and pg.input_value(D + " input[aria-label=PAN]") == "AAAPN1234C", "%d opened again: no draft, the saved PAN" % vw)
            # a Save that fails (the return is filed, the PAN changed): it stays open and says why
            J("() => { window.__lk = TDSReg.locked; TDSReg.locked = () => true; }")
            pg.locator(D + ' input[aria-label=PAN]').fill("AAAPN9999C"); W(200)
            J("() => { const p = TDSPanFix.list('26Q', '2025-26', 'Q1')[0]; window.__r = tdsDeducteeSet(p.party, {pan: 'AAAPN9999C', name: p.name}); }")
            r = J("window.__r")
            J("() => { TDSReg.locked = window.__lk; }")
            ok(r and not r.get("ok"), "%d a PAN changed on a filed return is refused (%s)" % (vw, r))
            pg.keyboard.press("Escape"); W(500)
            # the panel's own Save on a refused PAN: a filed return's deductee (the lock is what TDSPanFix.set reads)
            J("() => { window.__lk = TDSReg.locked; TDSReg.locked = (fy, q, f) => !!window.__lkOn; }")
            ok(dee(), "%d open again" % vw)
            J("window.__lkOn = true"); pg.locator(D + ' input[aria-label=PAN]').fill("AAAPN8888C"); W(300)
            sv = pg.locator(D + " [data-dee-save]")
            if sv.count():
                sv.click(); W(800)
                ok(shown(D) and pg.locator(D + " [data-dee-err]").count() == 1, "%d a Save that fails leaves it open and says why (%s)" % (vw, pg.locator(D + " [data-dee-err]").all_inner_texts()))
            else:
                ok(shown(D), "%d a filed return: no Save, the panel stays" % vw)
            J("() => { window.__lkOn = false; TDSReg.locked = window.__lk; }")
            pg.keyboard.press("Escape"); W(500); J("() => { const p = TDSPanFix.list('26Q', '2025-26', 'Q1')[0]; tdsDeducteeSet(p.party, {pan: 'AAAPN1234C', name: p.party}); }"); W(300)

            print("3. Add deduction: typed, closed, kept; Save closes it; a refused Save stays")
            A = '[data-drawer="add-deduction"]'
            ok(open_(A, "deductions", "() => { S.tdsAdd = {}; render(); }"), "%d Add a deduction opens" % vw)
            pg.locator(A + ' input[aria-label="Deductee"]').click(); pg.keyboard.type("ZZ New Party")
            pg.locator(A + ' input[aria-label="Amount paid or credited"]').click(); pg.keyboard.type("50000"); W(300)
            (pg.mouse.click(*outside_point(A)) if not phone else pg.keyboard.press("Escape")); W(800)
            ok(not shown(A) and not asked(), "%d typed in the Deductee box, it closes at once" % vw)
            ok(open_(A, "deductions", "() => { S.tdsAdd = {}; render(); }") and pg.input_value(A + ' input[aria-label="Deductee"]') == "ZZ New Party"
               and pg.locator(A + " [data-draft-kept]").count() == 1, "%d opened again: the deductee typed is kept as a draft" % vw)
            pg.locator(A + " [data-add-save]").click(); W(700)
            ok(shown(A) and pg.locator(A + " [data-add-err]").count() == 1, "%d no section: Save is refused, the panel stays and says why (%s)" % (vw, pg.locator(A + " [data-add-err]").all_inner_texts()))
            pg.locator(A + ' select[aria-label="Section"]').select_option(index=1); W(300)
            pg.locator(A + " [data-add-save]").click(); W(900)
            ok(not shown(A), "%d Save closes it (%s)" % (vw, pg.locator(A + " [data-add-err]").all_inner_texts() if shown(A) else "added"))
            ok(open_(A, "deductions", "() => { S.tdsAdd = {}; render(); }") and pg.input_value(A + ' input[aria-label="Deductee"]') == "" and pg.locator(A + " [data-draft-kept]").count() == 0,
               "%d after a Save, a new one starts empty (the draft is gone)" % vw)
            pg.keyboard.press("Escape"); W(500)
            J("() => { Object.entries(TDSAdd.all()).filter(([k, x]) => !x.deleted && x.party === 'ZZ New Party').forEach(([k]) => TDSAdd.remove(k, 'test')); render(); }")
        ok(not [e for e in errors if "supabase" not in e.lower()], "no page errors (%s)" % errors[:3])
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("crashed: %s" % e)
finally:
    srv.shutdown()
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
