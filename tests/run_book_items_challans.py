"""python3 run_book_items_challans.py - round 89 (19-Oct-2026, "only one challan showing"): the client's challans kept item by
item (client_book_items) must never be hidden by a browser with an empty copy.
The incident: on 18-Oct a browser with no local copy saved the books with `challans: []`; BookItems.split sent the EMPTY
list as a plain [] over the list marker {"$t": "arr"}; the mass-delete guard kept the 10 challan rows, but join returned
the plain [] and ignored them. The owner's browser had those 10 rows marked as synced and never fetched them again, while
39 deductions still pointed at them.
  1. an empty browser saving first keeps the other browser's 10 challans: a fresh browser opening gets all 10;
  2. a browser in the stale state (rows marked synced, the marker a plain []) gets all 15 back on opening, and the
     server's marker is the list marker again;
  3. split / join round-trip every shape (empty list, list with ids, plain list, object, value) as before.
A stand-in server inside the page (client_book_items and save_book_items). Made-up challans only.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_book_items_challans.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = 8251
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# the stand-in server: rows {key, item, ord, data, deleted, seq, updated_at, updated_by}; ?seq=gt.N and ?key=eq.K honoured
STUB = """() => {
  const db = window.__db = new Map(); let seq = 0;
  window.__put = (k, i, o, d, del, by) => db.set(k + '\\u0001' + i, {key: k, item: i, ord: o == null ? null : o, data: del ? null : d, deleted: !!del, seq: ++seq, updated_at: new Date(Date.now() - 60000 + seq).toISOString(), updated_by: by || 'u-other'});
  window.__calls = [];
  Cloud.st.firm = 'f0000000-0000-0000-0000-00000000000f'; Cloud.on = () => true; BookSync.off = false; BookItems.off = false;
  Cloud.api = async (path, opts) => {
    window.__calls.push(path);
    if (path.startsWith('client_book_items?')) {
      const q = new URLSearchParams(path.split('?')[1]), after = +(q.get('seq') || 'gt.0').slice(3), key = q.get('key');
      return [...db.values()].filter(r => r.seq > after && (!key || r.key === key.slice(3))).sort((a, b) => a.seq - b.seq).slice(0, 1000);
    }
    if (path === 'rpc/save_book_items') { opts.body.p_items.forEach(x => window.__put(x.k, x.i || '', x.o, x.d, x.del, 'u-me')); return {ok: true, items: []}; }
    return [];
  };
}"""
# a browser: its own copy of the books and its own sync marks
BROWSER = """async ([cid, books, st]) => { await Books.save(cid, books); BookItems.st[cid] = Object.assign({seq: 0, base: {}, chain: Promise.resolve(), ready: true}, st || {}); }"""
CH = lambda n, pre: [{"id": "%s%02d" % (pre, i), "bsr": "0510308", "date": "202607%02d" % (i + 1), "serial": "%05d" % (i + 1), "tax": 1000 + i, "section": "194C"} for i in range(n)]

with sync_playwright() as p:
    br = p.chromium.launch()
    pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
    pg.evaluate(STUB)
    # ---------- 3. the shapes round-trip (nothing else changes for the other keys)
    rt = pg.evaluate("""() => { const shapes = {e: [], ids: [{id: 'a', v: 1}, {id: 'b', v: 2}], plain: ['x', 'y'], noid: [{v: 1}], obj: {k: 1}, eo: {}, val: 5, s: 'w'};
      return Object.keys(shapes).map(k => { const it = [...BookItems.split({[k]: shapes[k]}).values()]; return [k, stableStr(BookItems.join(it)) === stableStr(shapes[k])]; }); }""")
    ok(all(x[1] for x in rt), "3. split then join gives back every shape: empty list, list with ids, plain list, list without ids, object, empty object, values (%s)" % rt)
    mk = pg.evaluate("() => { const m = BookItems.split({challans: []}).get('challans\\u0001'); return m && m.d; }")
    ok(mk == {"$t": "arr"}, "an empty list of challans is sent as the list marker, never a plain [] (%s)" % mk)
    j = pg.evaluate("() => BookItems.join([{i: '', d: []}, {i: '#b', o: 1, d: {id: 'b'}}, {i: '#a', o: 0, d: {id: 'a'}}]).map(x => x.id)")
    ok(j == ["a", "b"], "join: a plain [] marker with live item rows gives the rows, in order (%s)" % j)

    # ---------- 1. browser A keeps 10 challans; browser B, empty, saves first; a fresh browser opens
    cid = "zzbi1"
    pg.evaluate(BROWSER, [cid, {"cid": cid, "challans": CH(10, "a"), "alloc": {"r1": "a00", "r2": "a05"}}, None])
    pg.evaluate("(cid) => BookItems.pushNow(cid)", cid)
    ok(pg.evaluate("[...window.__db.values()].filter(r => r.key === 'challans' && r.item[0] === '#').length") == 10, "browser A: its 10 challans on the server")
    pg.evaluate(BROWSER, [cid, {"cid": cid, "challans": [], "alloc": {}}, None])
    pg.evaluate("(cid) => BookItems.pushNow(cid)", cid)
    marker = pg.evaluate("() => (window.__db.get('challans\\u0001') || {}).data")
    ok(marker == {"$t": "arr"}, "browser B (empty copy) saves first: the server's marker is still the list marker (%s)" % marker)
    pg.evaluate(BROWSER, [cid, {"cid": cid}, None])
    pg.evaluate("(cid) => BookItems.pullNow(cid)", cid)
    n1 = pg.evaluate("async (cid) => ((await Books.load(cid)).challans || []).length", cid)
    ok(n1 == 10, "1. a browser opening afterwards has all 10 of A's challans (%d)" % n1)

    # ---------- 2. the stale state: the server's marker a plain [], 15 challan rows; this browser marked them all synced,
    # holds only today's 5, and its deductions point at the other 10
    cid = "zzbi2"
    old, new = CH(10, "o"), CH(5, "n")
    pg.evaluate("() => window.__db.clear()")     # the stand-in keeps one client at a time
    base = pg.evaluate("""([cid, old, nw]) => { const base = {};
      old.forEach((c, i) => { window.__put('challans', '#' + c.id, i, c); base['challans\\u0001#' + c.id] = BookItems.h(c, i); });
      window.__put('challans', '', null, []); base['challans\\u0001'] = BookItems.h([], null);
      nw.forEach((c, i) => { window.__put('challans', '#' + c.id, i, c, false, 'u-me'); base['challans\\u0001#' + c.id] = BookItems.h(c, i); });
      return base; }""", [cid, old, new])
    alloc = {"d%02d" % i: old[i % 10]["id"] for i in range(39)}
    alloc.update({"e%02d" % i: new[i]["id"] for i in range(5)})
    base["alloc\u0001"] = pg.evaluate("() => BookItems.h({$t: 'obj'}, null)")
    for k, v in alloc.items(): base["alloc\u0001." + k] = pg.evaluate("(v) => BookItems.h(v, null)", v)
    pg.evaluate("([a]) => { Object.entries(a).forEach(([k, v]) => window.__put('alloc', '.' + k, null, v, false, 'u-me')); window.__put('alloc', '', null, {$t: 'obj'}, false, 'u-me'); }", [alloc])
    top = pg.evaluate("() => Math.max(...[...window.__db.values()].map(r => r.seq))")
    pg.evaluate(BROWSER, [cid, {"cid": cid, "challans": new, "alloc": alloc}, {"seq": top, "base": base}])
    before = pg.evaluate("async (cid) => ((await Books.load(cid)).challans || []).length", cid)
    pg.evaluate("(cid) => BookItems.pullNow(cid)", cid)
    got = pg.evaluate("async (cid) => ((await Books.load(cid)).challans || []).map(c => c.id).sort()", cid)
    ok(before == 5 and len(got) == 15 and set(got) == set(c["id"] for c in old + new), "2. the stale browser (%d challans here) gets all 15 back on opening (%d)" % (before, len(got)))
    marker = pg.evaluate("() => (window.__db.get('challans\\u0001') || {}).data")
    ok(marker == {"$t": "arr"}, "and the server's marker is the list marker again (%s)" % marker)
    dels = pg.evaluate("() => [...window.__db.values()].filter(r => r.deleted).length")
    ok(dels == 0, "nothing removed on the server (%d)" % dels)
    again = pg.evaluate("async (cid) => { window.__calls = []; await BookItems.pullNow(cid); return window.__calls.filter(p => p.includes('key=eq.challans')).length; }", cid)
    ok(again == 0, "once all are here, opening again does not fetch the challans in full (%d)" % again)
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
