"""python3 tests/run_hang_post_counts.py - "Page blocked" opening a client from the Clients page (FINCOM-APP-STAGING-K,
staging 19-Nov-2026 09:15 UTC, build mwn2et3u-4e4e9c = 0837e135f: 2,053 ms of script in one click, React's click handler
A3 = dispatchDiscreteEvent, invoker DIV.onclick, route client/dash; the breadcrumbs: Clients, then the client's Overview).
The row's click (Clients.jsx: openCompany) draws the client's page in the click's own task. Every client page draws the
top bar's "N Tally errors" (TopBar.jsx TallyErrors: postTabCounts), and the Overview its "Ready to post" tile
(postCountFor, postAttentionFor, postBillsOpen): in one drawing the Post to Tally rows (postEntryRows) were worked out
5 times, the postings' states (postJobStates) 10 times and the stopped postings still needing a decision
(CloudJobs.needing) 5 times, each pass going through every posting's results for every entry of it (items.find,
results.find, CloudJobs.okIn made again for each entry): for a client with a few thousand bills posted through FinCom's
cloud, about the square of them in every drawing of a client's page (the top bar's count is on every one of them, which
fits the same event on Sales, Bank, Purchase and Client setup). After the click, the drafts' counts (refreshStatsSoon)
worked out every draft's duplicate check outside a drawing, so each check worked every bill's number, supplier and year
out again (dupKeys: perRender outside a drawing): 60 drafts a task, 400-850 ms a task here.
Now those figures are worked out once a drawing (perRender, postRev) and each pass is linear (CloudJobs.idx: each
posting's results and items by id, okIn kept; the bank lines and sales by id); the drafts' checks share one memo (memoJob).
Made-up books only (the fixture's large client copied 14 times, 51,758 entries, as run_hang_gst_year.py makes them),
DRAFTS (default 400) made-up drafts, JOBS x PER (default 6 x 400) made-up bills posted through made-up postings of the
cloud (the last one failed, half of its bills refused) and 300 more made-up clients. Checks:
  1. the client's row on the Clients page (the client open last, then another): the click's own task within CLICK_MS
     (default 150 at full speed; 220-790 ms before, 20-40 ms after), the client's Overview, its "Ready to post" the bills
     ready; the Post to Tally rows worked out once in that drawing (postStatus asked no more often than one working out
     of them asks it: 2,800; 5,600-14,000 before); the opening's later tasks (the drafts' counts) each within TASK_MS
     (default 250; 400-850 ms before, under 150 after) and the drafts' count the one refreshStats gives at once;
  2. the same counts and rows as the build before the fix (DIGEST): Post to Tally's tab counts, the Errors and Posted rows
     with their status, the bills by bucket, the postings needing a decision and what each has left to send, worked out
     inside a drawing and outside one.
Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE.
BIG_DIR=a folder with Master.xml and DayBook.xml from mis_big_books.py (made in a temporary folder when not given)."""
import os, sys, json, shutil, tempfile, threading, functools, subprocess, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_POST_PORT") or 8352)
CLICK_MS = int(os.environ.get("CLICK_MS") or 150)
TASK_MS = int(os.environ.get("TASK_MS") or 250)
DRAFTS = int(os.environ.get("DRAFTS") or 400)
JOBS = int(os.environ.get("JOBS") or 6)
PER = int(os.environ.get("PER") or 400)
DIGEST = os.environ.get("DIGEST") or "CBF3F067"   # the counts and rows as 0837e135f (before the fix) gives them
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

root = tempfile.mkdtemp(prefix="hangpost-")
os.symlink(os.path.abspath(SITE), os.path.join(root, "site"))
big = os.environ.get("BIG_DIR")
if not big or not os.path.exists(os.path.join(big, "DayBook.xml")):
    big = os.path.join(root, "bigxml")
    subprocess.run([sys.executable, os.path.join(HERE, "mis_big_books.py"), big], check=True, stdout=subprocess.DEVNULL)
os.symlink(os.path.abspath(big), os.path.join(root, "__big"))
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=root)); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))
SEED = open(os.path.join(HERE, "run_hang_gst_year.py")).read().split('SEED = """', 1)[1].split('"""', 1)[0].replace("\\\\", "\\")
MORE = """() => { for (let i = 0; i < 300; i++){ const o = newCompany({name: "ZZ Made Up Client " + String(i).padStart(3, "0") + (i % 3 ? " Traders" : " Pvt Ltd"), gstin: ""}); S.companies[o.id] = o; D(o.id).loaded = true;
  o.stats = {drafts: i % 5, check: i % 7, records: 10}; } render(); return Object.keys(S.companies).length; }"""
# made-up drafts on the large client (run_hang_bill_drafts.py's)
DRAFT = """(nd) => { const cid = S.books.cid, d = S.data[cid] = S.data[cid] || {parties: {}, entries: {}}; d.loaded = true; d.entries = d.entries || {}; d.parties = d.parties || {};
  const bk = S.books, withG = Object.keys(bk.gstins || {}).filter(n => gstinValid(bk.gstins[n])).sort(), all = Object.keys(bk.ledInfo).sort();
  const mkG = (i) => { const b = '07AAZPQ' + String(1000 + i % 9000) + 'K1Z'; return b + gstinCheckChar(b + '0'); };
  const words = ['printer repair and courier charges', 'office rent for the month', 'electricity bill', 'internet broadband', 'legal consultancy fees', 'freight and cartage'];
  for (let i = 0; i < nd; i++){ const e = newEntry('zz-bill-' + i + '.pdf'); e.id = 'zzd' + i; const total = 1000 + (i * 37) % 90000, k = i % 3, nm = k === 0 && withG.length ? withG[i % withG.length] : all[(i * 13) % all.length];
    e.x = Object.assign(e.x || {}, {vendorName: k === 2 ? 'Made Up Vendor ' + i : nm, vendorGstin: k === 0 && withG.length ? bk.gstins[nm] : k === 1 ? mkG(i) : '', vendorPan: '', invoiceNo: 'ZZ-' + i,
      invoiceDate: '2026-0' + (1 + i % 9) + '-1' + (i % 9), total, taxable: Math.round(total / 1.18), description: words[i % words.length]});
    e.status = 'draft'; d.entries[e.id] = e; }
  return {gst: withG.length, ledgers: all.length}; }"""
# made-up bills approved and posted through made-up postings of FinCom's cloud: JOBS postings of PER bills each, the last
# one failed with every other bill of it refused (a posting that needs a decision), one bill of it put in by a later try
POSTED = """([nj, per]) => { const cid = S.books.cid, d = D(cid), list = [], t0 = Date.parse('2026-10-01T10:00:00Z'); let k = 0;
  for (let j = 0; j < nj; j++){ const ids = [], items = [], results = [], at = new Date(t0 + j * 3600e3).toISOString(), last = j === nj - 1;
    for (let i = 0; i < per; i++, k++){ const e = newEntry('zz-post-' + k + '.pdf'); e.id = 'zzp' + k; e.status = 'approved'; e.approvedAt = '2026-09-01T10:00:00Z';
      e.x = Object.assign(e.x || {}, {vendorName: 'Made Up Vendor ' + (k % 300), invoiceNo: 'ZP-' + k, invoiceDate: '2026-08-1' + (k % 9), total: 1000 + k % 9000, taxable: 900});
      const no = last && i % 2 === 1; if (!no){ e.exportedAt = at; e.postVerified = true; }
      d.entries[e.id] = e; ids.push(e.id); items.push({id: e.id, state: no ? 'failed' : 'in_tally', reason: no ? 'Made-up refusal' : ''}); results.push({id: e.id, ok: !no, message: no ? 'Made-up refusal' : 'Created'}); }
    list.push({id: 'zzjob' + j, client_id: cid, company: 'Made Up Co', status: last ? 'failed' : 'done', done: per, n: per, message: '', results, items, entry_ids: ids, created_at: at, updated_at: at, created_by: 'zz'}); }
  const once = list[nj - 1].entry_ids[1], at = new Date(t0 + nj * 3600e3).toISOString();
  list.push({id: 'zzjob' + nj, client_id: cid, company: 'Made Up Co', status: 'done', done: 1, n: 1, message: '', results: [{id: once, ok: true, message: 'Created'}], items: [{id: once, state: 'in_tally'}], entry_ids: [once], created_at: at, updated_at: at, created_by: 'zz'});
  d.entries[once].exportedAt = at; d.entries[once].postVerified = true;
  CloudJobs.list = list.reverse(); CloudJobs.at = Date.now(); return k; }"""
# the click's own task: from the window's capture listener (before React's root listener) to its bubbling one (after it),
# and the long tasks seen after it (the later drawing); postStatus counted (once a row a drawing)
INSTR = """() => { window.__ck = null; window.__lt = []; window.__ps = 0;
  const ps = window.postStatus; window.postStatus = function(){ window.__ps++; return ps.apply(this, arguments); };
  window.__n = {}; const count = (o, k, as) => { const f = o[k]; o[k] = function(){ window.__n[as] = (window.__n[as] || 0) + 1; return f.apply(this, arguments); }; };
  count(window, 'postEntryRows', 'postEntryRows'); count(window, 'postJobStates', 'postJobStates'); count(CloudJobs, 'needing', 'needing');
  window.addEventListener('click', () => { window.__ck = {t0: performance.now(), ps: window.__ps}; window.__n = {}; }, true);
  window.addEventListener('click', () => { if (!window.__ck) return; window.__ck.ms = Math.round(performance.now() - window.__ck.t0); window.__ck.ps = window.__ps - window.__ck.ps; window.__ck.calls = JSON.stringify(window.__n);
    window.__ck.view = S.view + '/' + S.tab; }, false);
  new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({type: 'longtask'}); }"""
WHERE = "() => ({open: S.view === 'home' ? 'home/' + S.homeTab : S.view + '/' + S.tab, co: S.coId, hash: location.hash})"
HASH = "(s) => { let h = 2166136261; for (const c of s){ h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h.toString(16).toUpperCase(); }"
# what Post to Tally counts and lists, as text
FIGS = """(inside) => { const cid = S.coId, go = () => { const t = postTabCounts(cid), rows = (tab) => postTabRows(cid, tab).shown.map(x => x.key + ':' + x.st.code).sort(), b = postBills(cid);
    const need = CloudJobs.needing(cid);
    return JSON.stringify([t, postCounts(cid), rows('errors'), rows('posted'), rows('topost'), ['ready', 'attention', 'sending', 'unknown', 'refused', 'review'].map(k => [k, b[k].map(e => e.id)]),
      b.jobs.map(j => j.id), need.map(j => [j.id, CloudJobs.leftToSend(j), !!CloudJobs.absorber(j)]), [...postJobStates(cid)].map(([id, v]) => id + ':' + v.st + ':' + v.job.id).sort()]); };
  return inside ? memoScope(go) : go(); }"""

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=8192"]); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/site/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        seed = pg.evaluate(SEED); pg.wait_for_timeout(1500)
        n = pg.evaluate(MORE); pg.wait_for_timeout(1000)
        info = pg.evaluate(DRAFT, DRAFTS)
        posted = pg.evaluate(POSTED, [JOBS, PER]); pg.evaluate("() => { refreshStats(S.books.cid); render(); }"); pg.wait_for_timeout(1500)
        ok(seed["n"] > 50000 and n > 300 and posted == JOBS * PER, "large made-up books: %d entries, %d ledgers, %d made-up drafts, %d made-up bills posted in %d made-up postings, %d made-up clients"
           % (seed["n"], info["ledgers"], DRAFTS, posted, JOBS + 1, n))
        cid = seed["cid"]; name = pg.evaluate("(c) => CO(c).name", cid)
        pg.evaluate(INSTR)
        print("\n1. The client's row on the Clients page")
        worst = []
        for run in range(2):
            pg.evaluate("(c) => Route.apply('#/c/' + c + '/dash')", cid); pg.wait_for_timeout(3000)
            if run:   # another client open last: the click opens a client not open now
                other = pg.evaluate("(c) => Object.keys(S.companies).find((k) => k !== c)", cid)
                pg.evaluate("(o) => Route.apply('#/c/' + o + '/dash')", other); pg.wait_for_timeout(2500)
            pg.evaluate("() => FinComNav.go(() => navHome('clients'))"); pg.wait_for_timeout(2500)
            firm = pg.evaluate(WHERE)
            pg.evaluate("() => { window.__ck = null; window.__lt = []; }")
            pg.locator("#app tr.rowlink", has_text=name).first.locator("td").first.click()
            pg.wait_for_timeout(5000)
            m = pg.evaluate("() => ({ck: window.__ck, lt: window.__lt.slice()})")
            ck = m["ck"] or {}; t0 = ck.get("t0", 0)
            task = max([ck.get("ms", 99999)] + [d for (s, d) in m["lt"] if s <= t0 + 1 and s + d >= t0 - 1])
            later = [d for (s, d) in m["lt"] if s > t0 + 1]
            worst.append(task)
            want = pg.evaluate("(c) => [postCountFor(c), Object.values(D(c).entries).filter((e) => e.status === 'approved' && postBucket(e, {jobs: postJobStates(c)}) === 'ready').length]", cid)
            # one working out of the rows, outside a drawing (the calls of postStatus it makes: one a bill or bank line)
            one = pg.evaluate("(c) => { const n0 = window.__ps; postEntryRows(c); return window.__ps - n0; }", cid)
            tile = pg.evaluate("() => { const t = document.querySelector('#app .dtile[data-tone=indigo] b'); return t ? t.innerText : ''; }")
            ok(task <= CLICK_MS and ck.get("view") == "company/dash" and pg.evaluate(WHERE)["open"] == "company/dash" and tile == str(want[0]) and want[0] == want[1],
               "   from %s%s: the click's own task %d ms (at most %d; its handler %d ms), the client's Overview, Ready to post %s (%s)"
               % (firm["open"], " (another client open last)" if run else "", task, CLICK_MS, ck.get("ms", -1), tile, want))
            ok(0 < ck.get("ps", 0) <= one, "   postStatus %d times in the click (at most one working out of the Post to Tally rows: %d); asked in the click %s" % (ck.get("ps", 0), one, ck.get("calls")))
            ok(max(later or [0]) <= TASK_MS, "   the opening's later tasks each within %d ms: %s" % (TASK_MS, later[:10]))
            st = pg.evaluate("(c) => { const was = clone(CO(c).stats || {}); refreshStats(c); return [was.check, (CO(c).stats || {}).check, was.drafts]; }", cid)
            ok(st[0] == st[1] and st[2] == DRAFTS, "   the drafts' counts after the opening the same as refreshStats at once (to check %s, %s; drafts %s)" % (st[0], st[1], st[2]))
        print("\n2. The same counts and rows as before the fix")
        a = pg.evaluate(FIGS, True); b = pg.evaluate(FIGS, False)
        ha = pg.evaluate(HASH, a)
        ok(a == b, "inside a drawing and outside one the same (%d characters)" % len(a))
        ok(ha == DIGEST, "the same as the build before the fix: %s (%s)" % (ha, DIGEST))
        c = json.loads(a)
        ok(c[0]["topost"] == 0 and c[0]["errors"] > 0 and len(c[2]) > 0 and len(c[3]) >= (JOBS - 1) * PER and len(c[7]) == 1 and c[7][0][1] == PER // 2 - 1,
           "   tab counts %s, %d Errors rows, %d Posted rows, the failed posting needing a decision with %s left to send" % (c[0], len(c[2]), len(c[3]), c[7][0][1] if c[7] else None))
        br.close()
finally:
    srv.shutdown(); shutil.rmtree(root, ignore_errors=True)
errs = [e for e in errors if "supabase" not in e.lower()]
ok(not errs, "no page errors %s" % errs[:3])
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
