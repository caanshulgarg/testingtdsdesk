"""python3 run_items_own_seq.py - a client opened again after a reload fetches only what changed since (speed, 11-Nov-2026:
a linked client opened again fetched 3.8 MB of its work items, every one this computer's own saves of the first opening,
each then found known and left). A stand-in server inside the page (client_book_items, save_book_items giving each item's
seq as the server does; select=seq honoured); made-up work only:
  1. this computer saves its work (300 items); after a reload (the sync marks read back from this browser's store) the
     opening asks the server by seq only: no item fetched in full, the books as they were;
  2. a colleague changes 2 items meanwhile: opened again, only theirs are fetched in full, their change is in the books,
     and the books are exactly what a browser fetching everything from the start has;
  3. this computer saves again, then a colleague changes an item: fetched.
RED on the build before this change: 1 (all 300 fetched again in full).
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_items_own_seq.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("OWNSEQ_PORT", "8252"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

# rows {key, item, ord, data, deleted, seq, updated_at, updated_by}; one seq for every client (as book_item_seq); other
# clients' saves move it too
STUB = """() => {
  const db = window.__db = new Map(); let seq = 100;
  window.__put = (k, i, o, d, del, by) => { const r = {key: k, item: i, ord: o == null ? null : o, data: del ? null : d, deleted: !!del, seq: ++seq, updated_at: new Date(Date.now() - 60000 + seq).toISOString(), updated_by: by || 'u-other'}; db.set(k + '\\u0001' + i, r); return r.seq; };
  window.__other = () => { seq += 7; };       // another client's saves
  window.__calls = []; window.__full = 0;
  Cloud.st.firm = 'f0000000-0000-0000-0000-00000000000f'; Cloud.on = () => true; BookSync.off = false; BookItems.off = false;
  Cloud.api = async (path, opts) => {
    window.__calls.push(path);
    if (path.startsWith('client_book_items?')) {
      const q = new URLSearchParams(path.split('?')[1]), after = +(q.get('seq') || 'gt.0').slice(3), key = q.get('key'), sel = q.get('select');
      const rows = [...db.values()].filter(r => r.seq > after && (!key || r.key === key.slice(3))).sort((a, b) => a.seq - b.seq).slice(0, 1000);
      if (sel === 'seq') return rows.map(r => ({seq: r.seq}));
      window.__full += rows.length; return rows.map(r => JSON.parse(JSON.stringify(r)));
    }
    if (path === 'rpc/save_book_items') { return {ok: true, items: opts.body.p_items.map(x => ({k: x.k, i: x.i || '', seq: window.__put(x.k, x.i || '', x.o, x.d, x.del, 'u-me')}))}; }
    return [];
  };
}"""
WORK = lambda: {"cid": "zzown1", "challans": [{"id": "ch%02d" % i, "bsr": "0510308", "date": "202607%02d" % (i % 28 + 1), "serial": "%05d" % (i + 1), "tax": 1000 + i, "section": "194C"} for i in range(40)],
                "alloc": {"v%03d|TDS Payable" % i: "ch%02d" % (i % 40) for i in range(259)}}
RELOAD = "(cid) => { delete BookItems.st[cid]; window.__calls = []; window.__full = 0; }"
SNAP = "async (cid) => { const b = await Books.load(cid) || {}; return stableStr({challans: b.challans || null, alloc: b.alloc || null}); }"

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(); pg = br.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
        E = lambda js, *a: pg.evaluate(js, *a)
        E(STUB); cid = "zzown1"
        # the first opening: the server has a colleague's marker items; this computer fetches them, then saves its work
        E("() => { window.__put('challans', '', null, {$t: 'arr'}); window.__put('alloc', '', null, {$t: 'obj'}); window.__other(); }")
        E("async ([cid, w]) => { await Books.save(cid, {cid}); BookItems.st[cid] = undefined; delete BookItems.st[cid]; await BookItems.pullNow(cid); const b = await Books.load(cid); Object.assign(b, w); await Books.save(cid, b); await BookItems.pushNow(cid); }", [cid, WORK()])
        n = E("() => window.__db.size")
        before = E(SNAP, cid)
        print("== 1. opened again after a reload, nothing changed elsewhere (%d items on the server)" % n)
        E(RELOAD, cid); E("(cid) => BookItems.pullNow(cid)", cid)
        full, calls = E("() => window.__full"), E("() => window.__calls.filter(u => u.startsWith('client_book_items')).length")
        ok(full == 0, "1. no item fetched in full (%d; %d calls by seq)" % (full, calls))
        ok(E(SNAP, cid) == before, "1. the books as they were")
        print("== 2. a colleague changed 2 items meanwhile")
        E("() => { window.__other(); window.__put('challans', '#ch03', 3, {id: 'ch03', bsr: '0510308', date: '20260704', serial: '09999', tax: 77, section: '194J'}); window.__put('alloc', '.v007|TDS Payable', null, 'ch05'); }")
        E(RELOAD, cid); E("(cid) => BookItems.pullNow(cid)", cid)
        full = E("() => window.__full"); got = E(SNAP, cid)
        ok(full == 2, "2. only the colleague's 2 items fetched in full (%d)" % full)
        ok('"serial":"09999"' in got and '"v007|TDS Payable":"ch05"' in got, "2. their change is in the books")
        fresh = E("async (cid) => { const c2 = cid + 'x'; await Books.save(c2, {cid: c2}); delete BookItems.st[c2]; const n0 = window.__db.size; await BookItems.pullNow(c2); const b = await Books.load(c2) || {}; return stableStr({challans: b.challans || null, alloc: b.alloc || null}); }", cid)
        ok(fresh == got, "2. exactly what a browser fetching everything from the start has")
        print("== 3. this computer saves again, then a colleague changes an item")
        E("async (cid) => { const b = await Books.load(cid); b.alloc['v001|TDS Payable'] = 'ch09'; await Books.save(cid, b); await BookItems.pushNow(cid); window.__other(); window.__put('challans', '#ch04', 4, {id: 'ch04', bsr: '0510308', date: '20260705', serial: '08888', tax: 66, section: '194J'}); }", cid)
        E(RELOAD, cid); E("(cid) => BookItems.pullNow(cid)", cid)
        ok('"serial":"08888"' in E(SNAP, cid), "3. the colleague's change after this computer's save is fetched (%d in full)" % E("() => window.__full"))
        ok(not errors, "no page errors (%s)" % errors[:3])
        br.close()
    print("\n%s: %d" % ("FAILED" if fails else "PASSED", len(fails)) + ("" if fails else " failures"))
    raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
