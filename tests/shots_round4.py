"""python3 shots_round4.py OUTDIR [page ...] - the round 4 UI walk (09-Oct-2026, the owner: "check complete ui and ux").
Every page of shots_ui_pass.py plus the sign-in page, the bell opened and the help page, at desktop (1366 x 768) and
phone (390 x 844) width, for an owner and for a staff member. Writes OUTDIR/<width>-<role>-<page>.png and prints, per
page, what a reader would want to know: console errors, sideways scroll, a time without IST, an ISO or slash date,
and whether there is a visible way back to the client. Offline, the made-up client "Testing AAD".
Run on the React build: TDSDESK_SITE=../app/dist-test python3 shots_round4.py OUTDIR
Arc UI step 2 (09-Oct-2026): SHOTS_SCHEME=light|dark|both (default light; with "both" the files are named
<width>-<scheme>-<role>-<page>.png), SHOTS_ROLES=owner,staff (default both), SHOTS_PORT (default 8244). Each page is also
checked for cut-off text (a box whose words are clipped by its own width, without an ellipsis) and for WCAG contrast:
every visible piece of text against the background behind it (4.5:1, or 3:1 for large text); the worst are listed."""
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
PORT = int(os.environ.get("SHOTS_PORT", "8244"))
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()

EXTRA = [("bell-open", "() => { S.view = 'company'; goClient('dash'); S.alertsOpen = true; render(); }")]
CHECK = """() => { const t = [document.getElementById('cobar'), document.getElementById('app'), document.getElementById('side')].map(e => e ? e.innerText : '').join('\\n');
  const W = window.innerWidth, wide = [];
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return true; } return false; };
  for (const el of document.querySelectorAll('#app *, #cobar *')) { if (!el.offsetParent) continue; const r = el.getBoundingClientRect(); if (r.width && r.right > W + 1 && !clipped(el)) wide.push((el.tagName + '.' + (el.className || '')).slice(0, 50) + ' ' + Math.round(r.right)); }
  // cut-off text: a box with words of its own whose content is wider (or taller) than the box and hidden, with no ellipsis
  const cut = [], low = [];
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', {willReadFrequently: true});
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = (el) => { const layers = []; for (let p = el; p; p = p.parentElement) { const cs = getComputedStyle(p); if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; const c = rgba(cs.backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
    let b = [255, 255, 255, 1]; if (layers.length && layers[layers.length - 1][3] < 1) b = rgba(getComputedStyle(document.body).backgroundColor); for (let i = layers.length - 1; i >= 0; i--) b = over(layers[i], b); return b; };
  for (const el of document.querySelectorAll('#app *, #cobar *, #side *, header.top *, #modal *')) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!r.width || !r.height || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && el.tagName !== 'SELECT')
      cut.push((el.tagName + '.' + (el.className || '')).slice(0, 40) + ' "' + el.textContent.trim().slice(0, 30) + '"');
    if (el.closest('[disabled], [aria-disabled="true"], .is-test-strip')) continue;
    let op = 1; for (let p = el; p; p = p.parentElement) op *= +getComputedStyle(p).opacity;
    if (op < 0.95) continue;
    const bg = bgOf(el); if (!bg) continue;
    const fg = over(rgba(cs.color), bg), L1 = lum(fg), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700, large = size >= 24 || (bold && size >= 18.66);
    if (ratio < (large ? 3 : 4.5)) low.push([Math.round(ratio * 100) / 100, (el.tagName + '.' + (el.className || '')).slice(0, 40) + ' "' + el.textContent.trim().slice(0, 30) + '"']);
  }
  low.sort((a, b) => a[0] - b[0]);
  return {text: t, scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, wide: wide.slice(0, 5), cut: cut.slice(0, 5), low: low.slice(0, 5), nlow: low.length}; }"""

def walk(pg, name, js, errs):
    errs.clear()
    try:
        pg.evaluate(js); pg.wait_for_timeout(1500); pg.evaluate("() => { if (typeof toastHide === 'function') toastHide(); }"); pg.wait_for_timeout(200)
    except Exception as e: errs.append("open: " + str(e)[:160])
    c = pg.evaluate(CHECK); t = c["text"]
    notes = []
    if errs: notes.append("console: " + " | ".join(e[:140] for e in errs[:3]))
    if c["scroll"] > 0 or c["wide"]: notes.append("sideways %dpx %s" % (c["scroll"], c["wide"][:3]))
    if c.get("cut"): notes.append("cut-off %s" % c["cut"][:3])
    if c.get("nlow"): notes.append("contrast %d below WCAG AA, worst %s" % (c["nlow"], c["low"][:3]))
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
        sch = os.environ.get("SHOTS_SCHEME", "light"); schemes = ["light", "dark"] if sch == "both" else [sch]
        roles = [r for r in os.environ.get("SHOTS_ROLES", "owner,staff").split(",") if r]
        for vw, vh, wn0 in [(1366, 768, "desk"), (390, 844, "phone")]:
          for scheme in schemes:
            wn = wn0 + ("-" + scheme if sch == "both" else "")
            for role in roles:
                pg = br.new_page(viewport={"width": vw, "height": vh}, color_scheme=scheme); errs = []
                pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
                pg.on("pageerror", lambda e: errs.append("pageerror " + str(e)))
                pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
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
