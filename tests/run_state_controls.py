"""python3 run_state_controls.py - every control that holds a state changes it, and keeps it (next-fix-toggles, 27-Oct-2026;
the owner: "when I click ineligible ITC to eligible ITC, it did not convert into that.. check these type of bug everywhere
in the system").
The idea of run_tally_clicks.py (click every control), for the controls that hold a choice: on every page reachable with
the fixtures (the pages of run_ui_standards.py / shots_ui_pass.py, run_excel_buttons.py's TDS and GST pages, and 2B & ITC
on itc_books.py), every tick box, radio, choice box (select), switch, and aria-pressed / aria-checked control (segmented
switches: By bill / By party, Eligible / Ineligible, Yes / No; status choices; "Mark as" toggles) is, one at a time, from
a fresh page:
  - changed (a tick ticked or unticked, another option chosen, the unpressed side of a switch pressed);
  - the visible state must change (the box's tick, the select's value, the pressed side). A control that snaps back, or
    does nothing, fails and is named, with its page and words. A question asked first (Are you sure?) counts as an answer:
    it is cancelled, and the state must not have changed;
  - where the change was kept (something was saved: saveBooks, the client, a bill), the page is reloaded and the control
    must show the new state; then it is changed back and must show the old one again.
A greyed-out control is never clicked: it must look disabled (the disabled attribute or aria-disabled) and say why (its
title, or a note beside it).
Skipped (never touched): anything that would send something outside (post to Tally, file, e-mail, WhatsApp, sign in),
and the sign-in and sign-up screens (their own tests); every control skipped is listed with why.
Offline (this browser only), the React test build (app/dist-test) or TDSDESK_SITE. --part N runs one scene."""
import os, re, sys, json, threading, functools, http.server, subprocess
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
BASE_PORT = int(os.environ.get("STATE_PORT") or 8571)
PART = int(sys.argv[sys.argv.index("--part") + 1]) if "--part" in sys.argv else -1
ONLY = sys.argv[sys.argv.index("--page") + 1] if "--page" in sys.argv else ""
fails, errors, skipped = [], [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

# a control that would send something outside, or leave the page for a sign-in: never touched
OUTSIDE = re.compile(r"\b(post|posting|file|filing|e-?mail|whatsapp|send|sign ?(in|out|up)|submit|upload|delete|remove|pay|otp|portal|live sync|auto[- ]?post)\b", re.I)

# the controls of the page: each with a stable name (its tag, its first data- attribute, its words) and its kind
LIST = r"""() => {
  const root = document.querySelector('#app'); if (!root) return [];
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const sel = 'input[type=checkbox], input[type=radio], select, [role=switch], [role=radio], [role=checkbox], [aria-pressed], [aria-checked]';
  const els = [...root.querySelectorAll(sel)].filter(e => !e.closest('#confirmBox, [role=dialog], .modal'))
    .filter(e => vis(e) || (e.matches('input') && e.closest('label') && vis(e.closest('label'))));
  const words = (e) => { const lab = e.closest('label'); let t = e.getAttribute('aria-label') || (lab ? lab.textContent : '') || e.getAttribute('title') || '';
    if (!t && e.tagName !== 'SELECT' && e.tagName !== 'INPUT') t = e.innerText || '';
    if (!t && e.id) { const l = document.querySelector('label[for="' + e.id + '"]'); if (l) t = l.textContent; }
    return t.replace(/\s+/g, ' ').trim().slice(0, 50); };
  const name = (e) => { const d = [...e.attributes].map(a => a.name).filter(n => n.startsWith('data-') && !['data-state', 'data-level', 'data-arc', 'data-sc-me', 'data-fk'].includes(n));
    return e.tagName.toLowerCase() + (e.type && e.tagName === 'INPUT' ? ':' + e.type : '') + (d.length ? '[' + d[0] + (e.getAttribute(d[0]) ? '=' + e.getAttribute(d[0]).slice(0, 40) : '') + ']' : '') + ' ' + JSON.stringify(words(e)); };
  const kind = (e) => e.tagName === 'SELECT' ? 'select' : e.matches('input[type=checkbox], [role=switch], [role=checkbox], [aria-checked]:not([role=radio])') ? 'tick'
    : e.matches('input[type=radio], [role=radio]') ? 'radio' : 'pressed';
  const seen = {};
  return els.map(e => { const n = name(e); seen[n] = (seen[n] || 0) + 1;
    const dis = !!e.disabled || e.getAttribute('aria-disabled') === 'true' || !!e.closest('fieldset[disabled]');
    const group = e.matches('[aria-pressed]') ? [...(e.parentElement ? e.parentElement.children : [])].filter(x => x !== e && x.hasAttribute('aria-pressed')).length : 0;
    const lab = e.closest('label');
    let why = (e.getAttribute('title') || (lab && lab.getAttribute('title')) || '').trim();
    // the reason: its title (or its label's), else a note marked as the reason beside it (.why-note, [data-why]), as
    // run_ui_standards.py asks of a greyed-out button; any nearby text is not a reason
    if (!why && dis) { for (let q = e.parentElement, k = 0; q && k < 2 && !why; q = q.parentElement, k++) { const w = q.querySelector('.why-note, [data-why]'); if (w && w.innerText.trim()) why = w.innerText.trim().slice(0, 80); } }
    const cs = getComputedStyle(e), looks = dis ? (parseFloat(cs.opacity) < 0.95 || cs.cursor === 'not-allowed' || cs.cursor === 'default' || e.matches(':disabled')) : true;
    return {name: n, nth: seen[n] - 1, kind: kind(e), disabled: dis, why, looks, group, words: words(e),
      options: e.tagName === 'SELECT' ? [...e.options].filter(o => !o.disabled).map(o => o.value) : [], value: e.tagName === 'SELECT' ? e.value : null}; }); }"""
FIND = r"""([name, nth]) => {
  const root = document.querySelector('#app'); if (!root) return false;
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const sel = 'input[type=checkbox], input[type=radio], select, [role=switch], [role=radio], [role=checkbox], [aria-pressed], [aria-checked]';
  // a control in a fold the redraw closed (a column picker) is still there: the fold is opened as a person does
  const els = [...root.querySelectorAll(sel)].filter(e => !e.closest('#confirmBox, [role=dialog], .modal'))
    .filter(e => vis(e) || (e.matches('input') && e.closest('label') && vis(e.closest('label'))) || !!e.closest('details:not([open])'));
  const words = (e) => { const lab = e.closest('label'); let t = e.getAttribute('aria-label') || (lab ? lab.textContent : '') || e.getAttribute('title') || '';
    if (!t && e.tagName !== 'SELECT' && e.tagName !== 'INPUT') t = e.innerText || '';
    if (!t && e.id) { const l = document.querySelector('label[for="' + e.id + '"]'); if (l) t = l.textContent; }
    return t.replace(/\s+/g, ' ').trim().slice(0, 50); };
  const nm = (e) => { const d = [...e.attributes].map(a => a.name).filter(n => n.startsWith('data-') && !['data-state', 'data-level', 'data-arc', 'data-sc-me', 'data-fk'].includes(n));
    return e.tagName.toLowerCase() + (e.type && e.tagName === 'INPUT' ? ':' + e.type : '') + (d.length ? '[' + d[0] + (e.getAttribute(d[0]) ? '=' + e.getAttribute(d[0]).slice(0, 40) : '') + ']' : '') + ' ' + JSON.stringify(words(e)); };
  let hits = els.filter(e => nm(e) === name);
  // a control whose words follow its state (Ticked / Not ticked, a select's label): found again by its data- hook
  if (!hits[nth] && /\[/.test(name)) { const hook = name.split(' ')[0]; hits = els.filter(e => nm(e).split(' ')[0] === hook); }
  const e = hits[nth]; if (!e) return false;
  if (e.tagName !== 'SUMMARY') { let d = e.closest('details'); while (d) { d.open = true; d = d.parentElement && d.parentElement.closest('details'); } }
  document.querySelectorAll('[data-sc-me]').forEach(x => x.removeAttribute('data-sc-me')); e.setAttribute('data-sc-me', '1'); return true; }"""
# the state the person sees
STATE = r"""() => { const e = document.querySelector('[data-sc-me]'); if (!e) return null;
  if (e.tagName === 'SELECT') return 'value=' + e.value;
  if (e.matches('input[type=checkbox], input[type=radio]')) return 'checked=' + e.checked;
  if (e.hasAttribute('aria-checked')) return 'aria-checked=' + e.getAttribute('aria-checked');
  return 'aria-pressed=' + e.getAttribute('aria-pressed'); }"""
# what was saved since: the books, the client, a bill, the firm (the spies count the calls)
SPY = r"""() => { window.__saves = window.__saves || [];
  const wrap = (o, k, tag) => { if (!o || typeof o[k] !== 'function' || o[k].__sc) return; const f = o[k]; const g = function (...a) { window.__saves.push(tag); return f.apply(this, a); }; g.__sc = 1; o[k] = g; };
  wrap(window, 'saveBooks', 'books'); if (typeof Store === 'object') Object.keys(Store).filter(k => /^save/.test(k)).forEach(k => wrap(Store, k, 'Store.' + k));
  if (typeof Books === 'object') wrap(Books, 'save', 'Books.save');
  window.__asked = 0; if (typeof askConfirm === 'function' && !askConfirm.__sc) { const f = askConfirm; window.askConfirm = function (...a) { window.__asked++; return f.apply(this, a); }; window.askConfirm.__sc = 1; } }"""
# the page's view state (filters, ticks, open folds; not the books, the clients or the bills), kept when the page is opened
# and put back before each control, so each starts from the page as it first came up
SNAP = r"""() => { const big = ['books', 'companies', 'data', 'firm', 'files']; const keep = {};
  for (const k of Object.keys(S)) { if (big.includes(k)) continue; const v = S[k];
    try { if (v instanceof Set) { keep[k] = 'SET:' + JSON.stringify([...v]); continue; } const s = JSON.stringify(v); if (s === undefined || s.length > 20000) continue; keep[k] = s; } catch (e) {} }
  window.__snapS = keep; }"""
RESTORE = r"""() => { const keep = window.__snapS || {}, big = ['books', 'companies', 'data', 'firm', 'files'];
  for (const k of Object.keys(S)) { if (k in keep || big.includes(k)) continue; const v = S[k];
    if (v && typeof v === 'object' && !(v instanceof Set)) { try { const s = JSON.stringify(v); if (!s || s.length > 20000) continue; } catch (e) { continue; } }
    if (typeof v === 'function') continue; delete S[k]; }
  for (const [k, s] of Object.entries(keep)) S[k] = s.startsWith('SET:') ? new Set(JSON.parse(s.slice(4))) : JSON.parse(s);
  if (typeof toastHide === 'function') toastHide(); }"""
WHERE = "() => [location.hash, S.view, S.tab, S.step || '', S.homeTab || '', S.gstPart || '', S.tdsView || '', S.selected || '', String(S.sel || '')].join('|')"
CONFIRM = "() => { const b = document.querySelector('#confirmBox'); return !!(b && b.offsetParent !== null && getComputedStyle(b).display !== 'none'); }"

def goto(pg, port):
    # a reload: a page that asks before it is left (a draft not saved) is left; tried again once if the browser refused
    for i in range(2):
        try: pg.goto("http://localhost:%d/" % port); break
        except Exception: pg.wait_for_timeout(800)
    pg.wait_for_timeout(2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)

def serve(port):
    srv = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Quiet, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start(); return srv

# ---------------------------------------------------------------- the scenes and their pages
def scene_itc():
    """2B & ITC on itc_books.py (Eligible? on the input register and the 2B lines, the decisions, GSTR-3B)"""
    import itc_books as IB
    def setup(pg, port): IB.setup(pg, port)
    def reopen(pg, port):
        goto(pg, port)
        if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
        if pg.locator("button:has-text('Later')").count(): pg.click("button:has-text('Later')"); pg.wait_for_timeout(300)
    def part(p, sub=""):
        def go(pg):
            IB.open_part(pg, p)
            if sub: pg.evaluate("(s) => { S.gstSub = s; render(); }", sub); pg.wait_for_timeout(500)
        return go
    pages = [("itc: input register", part("inreg")), ("itc: 2B reconciliation", part("r2b")), ("itc: final credit for 3B", part("itcfinal")),
             ("itc: GSTR-3B details", part("r3b", "details")),
             # a filter that shows no line: a "select every line" box with nothing to select must say so, not look live
             ("itc: 2B reconciliation, a chip with no line", lambda pg: (part("r2b")(pg), pg.evaluate("() => { S.icF = {chip: 'ims'}; render(); }"), pg.wait_for_timeout(400)))]
    return setup, reopen, pages

def scene_tdsgst():
    """the TDS and GST pages of run_excel_buttons.py, on the fixture books"""
    from books_data import CACHE
    from tdsgst_snapshot import LOAD, CHALLANS
    books = json.load(open(CACHE))
    # the 2B of run_gst_portal.py and the pages of run_excel_buttons.py, read from their files (they run on import)
    src, ns = open(os.path.join(HERE, "run_gst_portal.py")).read(), {"G07": "07AAGCL4827M1Z3"}
    exec(src[src.index("def inv("):src.index("# GSTR-1: each portal table")], ns)
    xs, xn = open(os.path.join(HERE, "run_excel_buttons.py")).read(), {}
    exec(xs[xs.index('T, G = "/books/tds'):xs.index("# the other imports keep")], xn)
    class XP: TWOB_JS, TWO_B, PAGES = ns["TWOB_JS"], ns["TWO_B"], [(n, h, js) for n, h, js, *_ in xn["PAGES"]]
    st = {}
    def setup(pg, port):
        pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
        pg.evaluate("window.__dueToday = '2026-10-11'")
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500); pg.evaluate(CHALLANS); pg.wait_for_timeout(300)
        pg.evaluate(XP.TWOB_JS, XP.TWO_B); pg.wait_for_timeout(400)
        # kept in this browser's store, so a reload opens the same client
        st["cid"] = pg.evaluate("async () => { Store.saveCompany(S.companies[S.coId]); await saveBooks(); return S.coId; }")
    def reopen(pg, port):
        goto(pg, port)
        if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    def at(h, js=None):
        def go(pg):
            pg.evaluate("(h) => { location.hash = h; }", "#/c/%s%s" % (st["cid"], h)); pg.wait_for_timeout(1300)
            t = 0
            while t < 40 and not pg.evaluate("() => !!(S.books && !S.books.loading)"): pg.wait_for_timeout(250); t += 1
            if js: pg.evaluate(js); pg.wait_for_timeout(500)
        return go
    pages = [("tdsgst: " + n, at(h, js)) for n, h, js in XP.PAGES]
    return setup, reopen, pages

def scene_client():
    """the home pages and a client's pages of shots_ui_pass.py (Testing AAD, a few bills, no books)"""
    import shots_ui_pass as U
    def setup(pg, port):
        pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
        pg.evaluate(U.SEED, None); pg.wait_for_timeout(1500)
        pg.evaluate("() => { const c = S.companies[S.coId]; Store.saveCompany(c); Object.values(S.data[c.id].entries).forEach(e => Store.saveEntry(c.id, e)); }"); pg.wait_for_timeout(400)
    def reopen(pg, port):
        goto(pg, port)
        if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    def at(js):
        def go(pg):
            pg.evaluate("() => { const c = Object.values(S.companies || {}).find(x => x && x.name === 'Testing AAD'); if (c) { S.coId = c.id; } }")
            pg.evaluate(js); pg.wait_for_timeout(1500)
        return go
    BILL = "() => { S.view = 'company'; S.step = null; S.tab = 'invoices'; S.reviewTable = false; S.filter = 'draft'; const c = S.companies[S.coId]; const e = Object.values((S.data[c.id] || {}).entries || {}).find(x => x.status === 'draft' && x.x.total > 100000) || Object.values((S.data[c.id] || {}).entries || {}).find(x => x.status === 'draft'); S.selected = e ? e.id : null; render(); }"
    # every section of Settings and of Client setup (the switches, choices and ticks live there)
    SETS = [("settings: " + k, "() => { goSettings('%s'); }" % k) for k in ("firm", "plan", "rates", "reading", "ai", "autopost", "moves", "platform", "gstapi", "tcloud")]
    SETUP = [("client setup: " + k, "() => { S.view = 'company'; S.step = null; goTab('%s'); }" % k) for k in ("settings", "cotally", "cotds", "gstset", "bankset", "bankrules", "coclosed", "cosheets")]
    pages = [(n, at(js)) for n, js in U.PAGES + SETS + SETUP] + [("a draft bill (its GST: reverse charge, blocked credit)", at(BILL)),
        ("purchase-review, a filter that shows no bill", at("() => { S.view = 'company'; goClient('bills'); S.revQuery = 'zzzz no such bill'; render(); }"))]
    return setup, reopen, pages

SCENES = [("itc", scene_itc), ("tdsgst", scene_tdsgst), ("client", scene_client)]

def run(idx):
    name, mk = SCENES[idx]
    port = BASE_PORT + idx
    srv = serve(port)
    setup, reopen, pages = mk()
    total = bad = 0
    with sync_playwright() as p:
        br = p.chromium.launch()
        ctx = br.new_context(viewport={"width": 1440, "height": 950}); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
        def dlg(d):
            # leaving the page (a reload) is allowed; any other question of the browser's is answered No
            try: d.accept() if d.type == "beforeunload" else d.dismiss()
            except Exception: pass
        pg.on("dialog", dlg)
        # nothing leaves this browser: the stand fakes answer, and anything else outside is refused
        pg.route(re.compile(r"^https?://(?!localhost)"), lambda r: r.abort())
        setup(pg, port)
        print("\n== scene %s" % name, flush=True)
        for page, go in pages:
            if ONLY and ONLY not in page: continue
            go(pg); pg.evaluate(SPY); pg.evaluate(SNAP)
            ctrls = pg.evaluate(LIST)
            def fresh():
                # the page as it first came up: its view state put back, and every part of it drawn again from nothing
                pg.evaluate(RESTORE); pg.evaluate("() => { S.view = 'home'; S.homeTab = 'help'; render(); }"); pg.wait_for_timeout(250)
                pg.evaluate(RESTORE); go(pg); pg.evaluate(SPY)
            if not ctrls: print("  -    %s: no control that holds a choice" % page); continue
            for c in ctrls:
                where = "%s: %s" % (page, c["name"])
                if c["disabled"]:
                    # and the why is a reason, not an invitation to press it ("tick to deduct anyway" on a greyed-out box)
                    good = bool(c["why"]) and c["looks"] and not re.search(r"\b(tick|click|press|choose|select) (it )?to\b", c["why"], re.I)
                    ok(good, "%s is greyed out: looks disabled and says why (%r)" % (where, c["why"][:80])); continue
                if OUTSIDE.search(c["words"] or "") and not re.search(r"show|filter|period|month|view", c["words"] or "", re.I):
                    skipped.append("%s (would send or file: %s)" % (where, c["words"])); continue
                if c["kind"] == "select" and len([o for o in c["options"] if o != c["value"]]) == 0:
                    continue
                fresh()
                if not pg.evaluate(FIND, [c["name"], c["nth"]]):
                    if c["nth"] > 0: continue
                    ok(False, "%s could not be found again on a fresh page" % where); continue
                b = pg.evaluate(STATE)
                if c["kind"] == "pressed" and b == "aria-pressed=true" and c["group"]: continue   # the pressed side of a switch: its other side is tried
                if c["kind"] == "radio" and b == "checked=true": continue
                total += 1
                pg.evaluate("() => { window.__saves = []; window.__asked = 0; }"); w0 = pg.evaluate(WHERE)
                el = pg.locator("[data-sc-me]")
                target = None
                try:
                    if c["kind"] == "select":
                        opts = [o for o in c["options"] if o != c["value"]]
                        target = next((o for o in opts if o), opts[0])
                        el.select_option(target, timeout=4000)
                    else:
                        el.click(timeout=4000)
                except Exception:
                    try: el.dispatch_event("click") if c["kind"] != "select" else None
                    except Exception: pass
                pg.wait_for_timeout(700)
                asked = pg.evaluate(CONFIRM) or pg.evaluate("window.__asked || 0") > 0
                if asked:
                    if pg.locator('#confirmBox [data-cbx="no"]').count(): pg.click('#confirmBox [data-cbx="no"]'); pg.wait_for_timeout(400)
                    ok(True, "%s -> asks first (cancelled)" % where); continue
                found = pg.evaluate(FIND, [c["name"], c["nth"]])
                a = pg.evaluate(STATE) if found else None
                if not found:
                    moved = pg.evaluate(WHERE) != w0
                    if not moved: bad += 1
                    ok(moved, "%s -> %s" % (where, "the page moved on (it opened something else)" if moved else "the control VANISHED, the page stayed")); continue
                changed = a != b
                saves = pg.evaluate("window.__saves || []")
                if not changed:
                    bad += 1
                    ok(False, "%s -> NOTHING: still %s after the change (%s)" % (where, a, "saved " + ",".join(sorted(set(saves))) if saves else "nothing saved"))
                    continue
                line = "%s -> %s to %s" % (where, b, a)
                # a settings section keeps a change as a draft until Save (parts/Confirm.jsx): saved as a person does
                drafted = pg.locator('#app [data-cfm="save"]:not([disabled])')
                if drafted.count():
                    drafted.first.click(); pg.wait_for_timeout(600); line += ", held until Save, saved"; saves = saves or ["draft"]
                if saves:
                    # kept: a reload shows it, and it changes back
                    reopen(pg, port); go(pg); pg.evaluate(SPY); pg.evaluate(SNAP)
                    if pg.evaluate(FIND, [c["name"], c["nth"]]):
                        r = pg.evaluate(STATE)
                        if r != a: bad += 1
                        ok(r == a, line + ", saved; after a reload " + r)
                        el = pg.locator("[data-sc-me]")
                        try:
                            if c["kind"] == "select": el.select_option(c["value"], timeout=4000)
                            elif c["kind"] in ("tick",) : el.click(timeout=4000)
                            elif c["kind"] == "pressed" and not c["group"]: el.click(timeout=4000)
                        except Exception: pass
                        pg.wait_for_timeout(700)
                        if pg.locator('#app [data-cfm="save"]:not([disabled])').count(): pg.locator('#app [data-cfm="save"]:not([disabled])').first.click(); pg.wait_for_timeout(600)
                        if c["kind"] in ("select", "tick") or (c["kind"] == "pressed" and not c["group"]):
                            pg.evaluate(FIND, [c["name"], c["nth"]]); back = pg.evaluate(STATE)
                            if back != b and not pg.evaluate(CONFIRM): bad += 1
                            ok(back == b or pg.evaluate(CONFIRM), "%s -> changed back: %s" % (where, back))
                            if pg.evaluate(CONFIRM) and pg.locator('#confirmBox [data-cbx="yes"]').count(): pg.click('#confirmBox [data-cbx="yes"]'); pg.wait_for_timeout(400)
                    else:
                        ok(True, line + ", saved; after a reload the control is not on the page (its state moved it)")
                else:
                    ok(True, line + " (a view choice, not kept)")
        br.close()
    srv.shutdown()
    print("\nscene %s: %d controls changed, %d failed" % (name, total, bad))
    if skipped: print("skipped (would send or file):\n  " + "\n  ".join(skipped))
    ok(total > 3, "scene %s: controls were tried (%d)" % (name, total))
    ok(not [e for e in errors if "Failed to fetch" not in e and "supabase" not in e.lower()], "no page errors %s" % errors[:3])
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

def all_parts():
    procs = [subprocess.Popen([sys.executable, os.path.abspath(__file__), "--part", str(i)] + (["--page", ONLY] if ONLY else []), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True) for i in range(len(SCENES))]
    outs = [pr.communicate()[0] for pr in procs]
    bad = 0
    for out, pr in zip(outs, procs): print(out.rstrip()); bad += pr.returncode != 0
    print("\nall passed" if not bad else "\nFAILED: %d scenes" % bad); raise SystemExit(1 if bad else 0)

if __name__ == "__main__":
    run(PART) if PART >= 0 else all_parts()
