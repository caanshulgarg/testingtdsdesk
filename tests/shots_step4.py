"""python3 shots_step4.py SITE OUTDIR PORT - Arc UI step 4 (10-Oct-2026): the last native date boxes (the trial balance's
"as on" in Books -> From Tally, a supplier's "Certificate valid to"), the firm's logo box (Settings -> Firm details) and
the confirm box (askConfirm, with a tick box; a removal that asks the client's name; "Save your changes?"), on
shots_ui_pass's made-up client, at desktop (1366) and phone (390) width, light and dark. Each page gets the checks of shots_round4.py (sideways scroll, cut-off text, WCAG contrast); writes
OUTDIR/<width>-<scheme>-<page>.png and prints one line a page."""
import os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.sync_api import sync_playwright
SITE, OUT, PORT = sys.argv[1], sys.argv[2], int(sys.argv[3])
os.makedirs(OUT, exist_ok=True)
src = lambda f: open(os.path.join(HERE, f)).read()
CHECK = re.search(r'CHECK = """(.*?)"""', src("shots_round4.py"), re.S).group(1).replace("\\\\n", "\\n")
SEED = re.search(r'SEED = """(.*?)"""', src("shots_ui_pass.py"), re.S).group(1)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
CO = "const c = Object.values(S.companies)[0]; S.coId = c.id; S.view = 'company';"
SHUT = "() => { const b = document.getElementById('confirmBox'); if (b && b.style.display === 'flex') b.querySelector('[data-cbx=no], [data-leave=stay]').click(); }"
PAGES = [
    ("tb-as-on", "() => { %s S.tbAsk = {cid: c.id, name: 'Trial balance.xml', on: '2026-03-31'}; goClient('books:import'); setTimeout(() => { const b = document.querySelector('[data-tb-ask]'); if (b) b.scrollIntoView({block: 'center'}); }, 300); }" % CO),
    ("party-valid-to", """() => { %s const P = D().parties; P['zz-ldc'] = {id: 'zz-ldc', name: 'Mehta Contractors', pan: 'AAAPM1234C', gstin: '', ledgerName: 'Mehta Contractors',
       natureDefault: '', expenseLedger: '', ldcRate: '1', ldcValidTo: '2027-03-31', ytd: {}}; S.step = null; S.tab = 'deductees'; S.partySel = 'zz-ldc'; render();
       setTimeout(() => { const b = document.querySelector('input[aria-label="Certificate valid to"]'); if (b) b.scrollIntoView({block: 'center'}); }, 300); }""" % CO),
    ("logo", "() => { goSettings(null); }"),
    ("confirm", """() => { askConfirm({title: 'Post 3 entries to Tally?', ok: 'Post 3 entries', check: 'Also mark them as checked',
       body: 'They go to <b>Testing AAD</b> in Tally now. Entries already in Tally are skipped.'}); }"""),
    ("confirm-typed", """() => { confirmTyped({title: 'Delete this statement?', ok: 'Delete statement',
       body: '<b>HDFC Bank</b>, 01-Apr-2026 to 30-Sep-2026 (statement.pdf, 214 rows).<br>It leaves the list; More \u2192 Restore a deleted statement puts it back.'}); }"""),
    ("leave-ask", "() => { Drafts.ask([{id: 'x', label: 'Firm details'}, {id: 'y', label: 'TDS rates'}]); }"),
]
bad = 0
with sync_playwright() as p:
    br = p.chromium.launch()
    for vw, vh, wn in [(1366, 768, "desk"), (390, 844, "phone")]:
        for sch in ["light", "dark"]:
            pg = br.new_page(viewport={"width": vw, "height": vh}, color_scheme=sch); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
            pg.evaluate(SEED, None); pg.wait_for_timeout(1200)
            pg.evaluate("() => { S.account = Object.assign(S.account || {}, {me: {role: 'owner', user_id: 'u-owner', name: 'Anshul'}}); render(); }")
            for name, js in PAGES:
                errs.clear(); pg.evaluate(SHUT); pg.wait_for_timeout(200)
                try: pg.evaluate(js); pg.wait_for_timeout(1500)
                except Exception as e: errs.append(str(e)[:160])
                if name in ("logo",): pg.evaluate("() => window.scrollTo(0, 0)")
                pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.wait_for_timeout(300)
                c = pg.evaluate(CHECK); notes = []
                if errs: notes.append("errors %s" % errs[:2])
                if c["scroll"] > 0 or c["wide"]: notes.append("sideways %dpx %s" % (c["scroll"], c["wide"][:3]))
                if c["cut"]: notes.append("cut-off %s" % c["cut"][:3])
                if c["nlow"]: notes.append("contrast %d below WCAG AA, worst %s" % (c["nlow"], c["low"][:3]))
                key = "%s-%s-%s" % (wn, sch, name)
                pg.screenshot(path=os.path.join(OUT, key + ".png"))
                bad += bool(notes); print(key, "; ".join(notes) if notes else "ok")
            pg.close()
    br.close()
print("pages with a finding:", bad)
