"""python3 shots_round4.py OUTDIR [page ...] - the round 4 UI walk (09-Oct-2026, the owner: "check complete ui and ux").
Every page of shots_ui_pass.py plus the sign-in page, the bell opened and the help page, at desktop (1366 x 768) and
phone (390 x 844) width, for an owner and for a staff member. Writes OUTDIR/<width>-<role>-<page>.png and prints, per
page, what a reader would want to know: console errors, sideways scroll, a time without IST, an ISO or slash date,
and whether there is a visible way back to the client. Offline, the made-up client "Testing AAD".
Run on the React build: TDSDESK_SITE=../app/dist-test python3 shots_round4.py OUTDIR"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
# shots_ui_pass's made-up client and pages, read from its source (importing it would start its own web server on a fixed port)
import re, types, ast
_src = open(os.path.join(HERE, "shots_ui_pass.py")).read()
U = types.SimpleNamespace(SEED=re.search(r'SEED = """(.*?)"""', _src, re.S).group(1))
_ns = {}; exec(re.search(r"(HOME = .*?\n\])\n", _src, re.S).group(1), _ns); U.PAGES = _ns["PAGES"]
def _books():
    try:
        import gstfix; return list(gstfix.load())
    except Exception: return None
U.books = _books
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/shots4"
os.makedirs(OUT, exist_ok=True)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8244), H); threading.Thread(target=srv.serve_forever, daemon=True).start()

EXTRA = [("bell-open", "() => { S.view = 'company'; goClient('dash'); S.alertsOpen = true; render(); }")]
CHECK = """() => { const t = [document.getElementById('cobar'), document.getElementById('app'), document.getElementById('side')].map(e => e ? e.innerText : '').join('\\n');
  const W = window.innerWidth, wide = [];
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  for (const el of document.querySelectorAll('#app *, #cobar *')) { if (!el.offsetParent) continue; const r = el.getBoundingClientRect(); if (r.width && r.right > W + 1 && !clipped(el)) wide.push((el.tagName + '.' + (el.className || '')).slice(0, 50) + ' ' + Math.round(r.right)); }
  return {text: t, scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, wide: wide.slice(0, 5)}; }"""

def walk(pg, name, js, errs):
    errs.clear()
    try:
        pg.evaluate(js); pg.wait_for_timeout(1500); pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.wait_for_timeout(200)
    except Exception as e: errs.append("open: " + str(e)[:160])
    c = pg.evaluate(CHECK); t = c["text"]
    notes = []
    if errs: notes.append("console: " + " | ".join(e[:140] for e in errs[:3]))
    if c["scroll"] > 0 or c["wide"]: notes.append("sideways %dpx %s" % (c["scroll"], c["wide"][:3]))
    for m in re.findall(r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}/\d{1,2}/\d{2,4}\b", t)[:3]: notes.append("date " + m)
    for m in re.findall(r"\b\d{1,2}:\d{2}(?::\d{2})?\b(?! ?IST)(?! ?(?:am|pm))", t)[:3]: notes.append("time " + m)
    for w in ["undefined", "NaN", "null", "[object Object]", "TDSDesk", "Error:", "TypeError"]:
        if re.search(r"\b" + re.escape(w) + r"\b", t): notes.append("word " + w)
    return notes, t

if __name__ == "__main__":
    only = sys.argv[2:]
    report = {}
    with sync_playwright() as p:
        br = p.chromium.launch()
        for vw, vh, wn in [(1366, 768, "desk"), (390, 844, "phone")]:
            for role in ["owner", "staff"]:
                pg = br.new_page(viewport={"width": vw, "height": vh}); errs = []
                pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
                pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
                pg.goto("http://localhost:8244/"); pg.wait_for_timeout(2500)
                if not only or "sign-in" in only:
                    f = os.path.join(OUT, "%s-%s-sign-in.png" % (wn, role)); pg.screenshot(path=f)
                    report["%s-%s-sign-in" % (wn, role)] = walk(pg, "sign-in", "() => {}", errs)[0]
                pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
                pg.evaluate(U.SEED, U.books()); pg.wait_for_timeout(1200)
                pg.evaluate("(r) => { S.account = Object.assign(S.account || {}, {me: {role: r, user_id: 'u-' + r, name: r === 'owner' ? 'Anshul' : 'Ravi'}}); render(); }", role)
                for name, js in U.PAGES + EXTRA:
                    if only and name not in only: continue
                    notes, t = walk(pg, name, js, errs)
                    key = "%s-%s-%s" % (wn, role, name)
                    pg.screenshot(path=os.path.join(OUT, key + ".png")); report[key] = notes
                    with open(os.path.join(OUT, key + ".txt"), "w") as fh: fh.write(t)
                    print(key, "; ".join(notes) if notes else "ok")
                pg.close()
        br.close()
    with open(os.path.join(OUT, "walk.json"), "w") as fh: json.dump(report, fh, indent=1)
