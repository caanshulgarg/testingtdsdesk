"""python3 shots_group3.py SITE OUTDIR PORT - Arc UI step 3, group 3 (10-Oct-2026): Clients, the Tally page (its three
tabs), the firm's account (People, Plan and credit), Settings, Help, the client's parties (Client setup -> suppliers) and
the bill drawer with its date box, on shots_ui_pass's made-up client, at desktop (1366) and phone (390) width, light and
dark. Each page gets the checks of shots_round4.py (sideways scroll, cut-off text, WCAG contrast); writes
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
PAGES = [
    ("clients", "() => { navHome('clients'); }"),
    ("tally-computers", "() => { S.tallyTab = 'computers'; navHome('tally'); }"),
    ("tally-activity", "() => { S.tallyTab = 'activity'; navHome('tally'); }"),
    ("tally-sent", "() => { S.tallyTab = 'sent'; navHome('tally'); }"),
    ("people", "() => { goSettings('account'); }"),
    ("plan", "() => { goSettings('plan'); }"),
    ("settings", "() => { goSettings(null); }"),
    ("help", "() => { navHome('help'); }"),
    ("parties", "() => { const c = Object.values(S.companies)[0]; S.coId = c.id; S.view = 'company'; S.step = null; S.tab = 'deductees'; render(); }"),
    ("bill-date", """() => { const c = Object.values(S.companies)[0]; S.coId = c.id; S.view = 'company'; goStep('review', 'bills'); S.reviewTable = false;
       const e = Object.values(D().entries).find((x) => x.status === 'draft'); if (e) { S.selected = e.id; S.drawerOpen = true; } render();
       setTimeout(() => { const b = document.querySelector('[data-fk="x:invoiceDate"]'); if (b) b.scrollIntoView({block: 'center'}); }, 300); }"""),
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
                errs.clear()
                try: pg.evaluate(js); pg.wait_for_timeout(1500)
                except Exception as e: errs.append(str(e)[:160])
                if name != "bill-date": pg.evaluate("() => window.scrollTo(0, 0)")
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
