"""python3 tests/run_hang_books_cloud.py - "Page blocked" for ~10 s in a timer on a large linked client (FINCOM-APP-STAGING-H,
events ce588860 and 22cc28f2, staging 12-Nov-2026 09:58 and 10:17 UTC, the owner's PC: 9,965 and 10,047 ms in
TimerHandler:setTimeout, route client/books, GST › What to fix 47 s before; the same ~9.5 s on client/bank and home/tally on
other days). Sentry's timer wrapper hid the function (app/src/sentry.js now leaves the timers alone).
What runs after the cloud copy brings new entries, reproduced on made-up books: the fixture's large client copied 14 times
(51,758 entries, as run_hang_gst_year.py makes them) on GST › Year, FinCom's cloud answered by this test's own server
(the app's own Cloud.api and TCloud.load, each answer a real request), Live's "the book changed" timer (LK.cloudFresh).
Measured at full speed here (an office PC is about 4x slower):
  - BookItems.pushNow, the 300 ms timer after every save (the "setTimeout" of the reports, on any page of the client): the
    whole work part as JSON (10 MB), parsed back, cut into its 14,446 items and every item hashed again whenever any part
    changed: 0.4-0.6 s here. Now each part's JSON is compared with the last pass that left nothing to send, and only the
    parts that changed are cut and hashed (the same items sent, the same removals);
  - a background redraw (toast {background}, Live's Saving…/Saved: renderTop) right after a save drew the whole page with
    every figure worked out again (GST › Year's 12 months of checks, the TDS rows), and the drawing that follows did it once
    more (the day's first audit run on its own: 2.1 s of the rework's 5 s). A background redraw on books changed since the last drawing is now asked for the next
    drawing (soonRender), one drawing for both;
  - TDSTally.sync worked out every TDS row (TDS.challanUse, TDSCH.rowsAll: 1.7 s) before knowing whether Tally gave any
    challan or tag; now only when one is there to compare or tag (the same result).
Checks:
  1. the new entries come in (5 more entries), and the screen shows them: the GST grid as a fresh drawing draws it;
  2. no frame of the whole run (LoAF) over PIPE_MS (default 1200 here; it was 1,947: the load's tail with TDSTally.sync;
     now 700-800, the drawings of GST › Year after the save), GST › Year's 12 months worked out at most twice in the run;
  3. pushNow after the change: its work before the first item is sent within PUSH_MS (default 200; it was 430, 14,449
     items hashed; now about 120, 2,497: the ledger map), and what the server holds afterwards (s.base) is, item for item, the hash a full pass gives of the books' work now; a change in place to one item sends that item
     alone, a removed item is sent as removed, nothing changed sends nothing;
  4. TDSTally.sync on books with no challan or tag from Tally: within SYNC_MS (default 200; it was 1,700), the same result
     as before (no challan, no tag, no disagreement).
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_BOOKS_PORT") or 8335)
PIPE_MS = int(os.environ.get("PIPE_MS") or 1200)
PUSH_MS = int(os.environ.get("PUSH_MS") or 200)
SYNC_MS = int(os.environ.get("SYNC_MS") or 200)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangbooks-")
os.symlink(os.path.abspath(SITE), os.path.join(root, "site"))
big = os.environ.get("BIG_DIR")
if not big or not os.path.exists(os.path.join(big, "DayBook.xml")):
    big = os.path.join(root, "bigxml")
    subprocess.run([sys.executable, os.path.join(HERE, "mis_big_books.py"), big], check=True, stdout=subprocess.DEVNULL)
os.symlink(os.path.abspath(big), os.path.join(root, "__big"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    # FinCom's cloud: the page hands this server the answer it computed, and gets it back over the network
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = self.rfile.read(n)
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=root)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
SEED = open(os.path.join(HERE, "run_hang_gst_year.py")).read().split('SEED = """', 1)[1].split('"""', 1)[0].replace("\\\\", "\\")

# the cloud copy of these books (the same entries, each day kept), 5 new entries the bridge sent; FinCom's cloud answered
# from it, over a real request (the app's own Cloud.api: its wait, its stream); every item sent kept in window.__sent
CLOUD = r"""(NEW) => {
  const b = S.books;
  b.vouchers.forEach((v) => { if (v.alt == null || v.alt === "") v.alt = 100; });
  const days = {}; b.vouchers.forEach(v => { days[v.date] = "A1"; });
  const iso = d => d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6, 8), now = new Date().toISOString();
  b.meta.cloud = {book: "zzbook", company: "ZZ BIG GST", ledgersAt: "L1", days, at: now};
  b.meta.copy = {book: "zzbook", seen: "S0", at: now, daysAt: "D1", fullAt: now};
  // the audit ran today (it is not due again): what repeats with each new entry, not the day's first audit
  const a = Audit.defaultRange(b); Audit.run(a.from, a.to, "by hand");
  const src = b.vouchers.slice(-400).filter(v => (v.ent || []).length >= 2 && Books.isSale(v)).slice(0, NEW);
  const heads = src.map((v, k) => ({guid: "zznew-" + k, day: iso(v.date), alter_id: 900 + k, vtype: v.type, vno: "ZN" + k, party: v.party, narration: "zz new", cancelled: false, optional: false, deleted_at: null,
    gstin: v.gstin || "", pos: v.pos || "", ref: "", ref_date: null, cmp_gstin: "", irn: "", irn_ack_date: null, tds_tally: null, tds_tally_alter_id: null}));
  const lines = []; src.forEach((v, k) => v.ent.forEach(e => lines.push({guid: "zznew-" + k, ledger: e.l, amount: e.a, hsn: e.h || null, rate: e.gr == null ? null : e.gr})));
  const thin = b.vouchers.map(v => ({guid: v.id, alter_id: v.alt, deleted_at: null, tds_tally_alter_id: null})).concat(heads.map(h => ({guid: h.guid, alter_id: h.alter_id, deleted_at: null, tds_tally_alter_id: null})));
  thin.sort((x, y) => x.guid < y.guid ? -1 : 1);
  window.__calls = []; window.__sent = [];
  const page = (rows, path) => { const m = /limit=(\d+)&offset=(\d+)/.exec(path); return m ? rows.slice(+m[2], +m[2] + +m[1]) : rows; };
  const want = (path) => { const g = /guid=in\.\(([^)]*)\)/.exec(decodeURIComponent(path)); return g ? new Set(g[1].split(",").map(s => s.replace(/"/g, ""))) : null; };
  const answer = (path, o) => {
    if (/^rpc\/tally_status/.test(path)) return [{book: "zzbook", from: iso(b.meta.from), entries: b.vouchers.length, ledgersAt: "L1", company: "ZZ BIG GST", daysAt: "D2"}];
    if (/^rpc\/tally_days_list/.test(path)) return page(Object.keys(days).sort().map(d => ({day: d, at: "A1"})), path);
    if (/^rpc\/save_book_items/.test(path)){ window.__sendAt = window.__sendAt || performance.now(); const body = JSON.parse(o.body); window.__sent.push(...body.p_items); return {ok: true, items: []}; }
    if (/^rpc\//.test(path)) return [];
    if (/^tally_recorder_lines\?select=applied_at/.test(path)) return [{applied_at: "S1"}];
    if (/^tally_recorder_lines\?select=object_guid/.test(path)) return page(heads.map(h => ({object_guid: h.guid})), path);
    if (/^tally_vouchers\?select=guid,alter_id,deleted_at/.test(path)) return page(thin, path);
    if (/^tally_vouchers\?select=/.test(path)){ const w = want(path); return page(heads.filter(h => !w || w.has(h.guid)), path); }
    if (/^tally_lines\?/.test(path)){ const w = want(path); return page(lines.filter(l => !w || w.has(l.guid)), path); }
    return [];
  };
  Cloud.on = () => true; Cloud.st.firm = "zzfirm"; Cloud.st.state = "ok"; Cloud.sess = () => ({user_id: "zzu", access_token: "zzt", email: "zz@zz.in"}); Cloud.fresh = async () => {};
  const cfg0 = Cloud.cfg.bind(Cloud); Cloud.cfg = () => Object.assign({}, cfg0(), {url: location.origin + "/__cloud", key: "zz", auto: false});
  const f0 = window.fetch;
  window.fetch = function (u, o) { const m = /\/__cloud\/rest\/v1\/(.*)$/.exec(String(u)); if (!m) return f0.apply(this, arguments);
    window.__calls.push(m[1].slice(0, 60)); return f0.call(this, "/__echo", {method: "POST", body: JSON.stringify(answer(m[1], o)), signal: o && o.signal}); };
  try { Live.start = () => {}; } catch (e) {}
  return {heads: heads.length, thin: thin.length};
}"""
INSTR = """() => { window.__ck = 0; const f = GSTR.checks; GSTR.checks = function(){ window.__ck++; return f.apply(this, arguments); };
  window.__push = []; const p = BookItems.pushNow; BookItems.pushNow = async function(cid){ const t0 = performance.now(); let h = 0; const hh = BookItems.h; BookItems.h = function(){ h++; return hh.apply(this, arguments); };
    window.__sendAt = 0; try { return await p.apply(this, arguments); } finally { BookItems.h = hh; window.__push.push({ms: Math.round((window.__sendAt || performance.now()) - t0), hashed: h}); } };
  window.__lf = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.duration > 100) window.__lf.push([Math.round(e.duration), ((e.scripts || []).slice().sort((a, c) => c.duration - a.duration)[0] || {}).invoker || '']); })).observe({type: 'long-animation-frame'}); }"""
GRID = "() => Array.from(document.querySelectorAll('#app [data-gst-grid] [data-cell]')).map(c => [c.dataset.cell, (c.querySelector('.rp-s') || {}).innerText || ''])"
# what the server holds (s.base) against a full pass over the books' work now: every item's hash, and no item missing
FULL = """() => { const cid = S.books.cid, s = BookItems.st[cid], w = JSON.parse(BookSync.workStr(S.books)), m = BookItems.split(w); let bad = [], n = 0;
  m.forEach((x, key) => { n++; if (s.base[key] !== BookItems.h(x.d, x.o)) bad.push(key); });
  const extra = Object.keys(s.base).filter(k => s.base[k] !== 'gone' && !m.has(k));
  return {n, bad: bad.slice(0, 5), nbad: bad.length, extra: extra.slice(0, 5)}; }"""
# one push, timed, with what it sent
PUSH = """async () => { window.__sent = []; window.__push = []; const cid = S.books.cid; await BookItems.push(cid); return {push: window.__push[0] || null, sent: window.__sent.map(x => [x.k, x.i, !!x.del])}; }"""

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        ok(seed["n"] > 50000, "large made-up books: %d entries" % seed["n"])
        # 4. TDSTally.sync on books with nothing of Tally's TDS (no challan, no tag)
        r4 = pg.evaluate("""() => { const t0 = performance.now(), r = TDSTally.sync(S.books); return {ms: Math.round(performance.now() - t0), challans: r.challans, tagged: r.tagged, updated: r.updated, disagree: r.disagree.length, conflicts: r.conflicts.length, bad: r.bad.length}; }""")
        ok(r4["ms"] <= SYNC_MS and r4["challans"] == 0 and r4["tagged"] == 0 and r4["disagree"] == 0, "4. TDSTally.sync with no challan or tag from Tally: %d ms (at most %d), %s" % (r4["ms"], SYNC_MS, r4))
        pg.evaluate("() => { S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = '202603'; render(); }"); pg.wait_for_timeout(2500)
        print("  ", pg.evaluate(CLOUD, 5))
        pg.evaluate("() => saveBooks()"); pg.wait_for_timeout(1500)
        # the server holds what the books hold: a first push (everything new to it) sent, then settled
        pg.evaluate(INSTR)
        pg.evaluate("async () => { await BookItems.push(S.books.cid); await BookItems.push(S.books.cid); }"); pg.wait_for_timeout(500)
        f0 = pg.evaluate(FULL)
        ok(f0["n"] > 10000 and not f0["nbad"] and not f0["extra"], "the server holds every item of the books' work (%s)" % f0)
        pg.evaluate("() => { render(); window.__ck = 0; window.__lf = []; window.__push = []; window.__n0 = S.books.vouchers.length; }"); pg.wait_for_timeout(1500)
        # 1-2. Live's timer for "the book changed": the new entries come in
        pg.evaluate("() => { window.__lf = []; window.__ck = 0; setTimeout(() => { const cid = S.coId; if (TCloud.st[cid]) TCloud.st[cid].at = 0; const f = LK.fr(); f.cat = 0; LK.cloudFresh(true, true); }, 1500); }")
        pg.wait_for_function("() => S.books.vouchers.length > window.__n0 && !LK.fr().busy", timeout=120000, polling=500); pg.wait_for_timeout(12000)
        m = pg.evaluate("() => ({n: S.books.vouchers.length - window.__n0, ck: window.__ck, lf: window.__lf.slice(), push: window.__push.slice()})")
        grid = pg.evaluate(GRID); pg.evaluate("() => render()"); pg.wait_for_timeout(500)
        ok(m["n"] == 5 and grid and grid == pg.evaluate(GRID), "1. the 5 new entries came in, the GST grid shown is the one a fresh drawing draws (%d cells)" % len(grid))
        longest = max([x[0] for x in m["lf"]] or [0])
        ok(longest <= PIPE_MS and m["ck"] <= 24, "2. the longest frame %d ms (at most %d), GST › Year's months worked out %d times (at most 24, one year twice); frames %s" % (longest, PIPE_MS, m["ck"], m["lf"]))
        pu = [x for x in m["push"] if x["hashed"] or x["ms"] > 20]
        ok(pu and max(x["ms"] for x in pu) <= PUSH_MS, "3. pushNow after the new entries: %s (at most %d ms)" % (m["push"], PUSH_MS))
        f1 = pg.evaluate(FULL)
        ok(not f1["nbad"] and not f1["extra"], "   and the server holds, item for item, what a full pass gives (%s)" % f1)
        # 3. one item changed in place, one removed, nothing changed
        a = pg.evaluate("""async () => { const b = S.books; const k = Object.keys(b.map).find(x => b.map[x] && typeof b.map[x] === 'object'); b.map[k] = Object.assign({}, b.map[k], {zz: 1}); window.__k = k; return k; }""")
        r = pg.evaluate(PUSH)
        ok(r["sent"] == [["map", "." + a, False]] and r["push"]["ms"] <= PUSH_MS, "3. one ledger's mapping changed in place: that item alone sent (%s), %d ms" % (r["sent"][:4], r["push"]["ms"]))
        pg.evaluate("() => { delete S.books.map[window.__k]; }")
        r = pg.evaluate(PUSH)
        ok(r["sent"] == [["map", "." + a, True]], "   then removed: sent as removed (%s)" % r["sent"][:4])
        r = pg.evaluate(PUSH)
        ok(r["sent"] == [] and r["push"]["hashed"] == 0, "   nothing changed: nothing sent, nothing hashed (%s)" % r)
        pg.evaluate("() => { S.books.alloc = Object.assign({}, S.books.alloc, {'zz-row|TDS': 'zz-ch'}); }")
        r = pg.evaluate(PUSH)
        ok(r["sent"] == [["alloc", ".zz-row|TDS", False]], "   a new allocation: sent (%s)" % r["sent"][:4])
        f2 = pg.evaluate(FULL)
        ok(not f2["nbad"] and not f2["extra"], "   the server holds what a full pass gives (%s)" % f2)
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
