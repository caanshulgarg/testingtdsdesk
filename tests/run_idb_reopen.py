"""python3 tests/run_idb_reopen.py - this browser's database connection closed under the page (idb-closing,
FINCOM-APP-STAGING-N, staging 6-Nov-2026 on client/books: a save of the books failed with "InvalidStateError: Failed to
execute 'transaction' on 'IDBDatabase': The database connection is closing", saveBooks -> Books.save -> IDBStore.write).

IDBStore (src/js/00-core.js) and BankDB (src/js/20-bank-statements.js) kept the connection they opened for the whole
session; once it was closed (by the browser, or for another tab's upgrade or removal of the database) every read and write
failed (IDBStore) or was kept only in memory and lost at the next reload (BankDB) until the page was reloaded.

The React test build (app/dist-test, or TDSDESK_SITE) served at /review/, signed in to the stand-in cloud (tally_shapes.py):
  1. IDBStore: the connection closed under it: a write (Books.save) is kept in the database, a read and a prefix read answer
  2. IDBStore: the browser closes the connection (its site data cleared, CDP Storage.clearDataForOrigin): the next write
     is kept
  3. IDBStore: a database that keeps closing: the write fails once it was tried twice (no loop, opened again once)
  4. IDBStore: a connection this page closed itself (clearLocalCopy) is not opened again by a write that was under way
  5. BankDB: the connection closed under it: a save is kept in the database (not only in memory), a read answers from it
  6. BankDB: a database that keeps closing: the save answers false once it was tried twice (no loop)
  7. a write cut short (error, abort, then the close): IDBStore.write and BankDB.set answer with the second try's result
  8. (review) another tab clears this browser's copy (clearLocalCopy) while this page has it open: the clearing is not
     held, and this page's next writes do not make the copy again (it would be nobody's, for the next sign-in to take)
  9. the tab that cleared it, before its reload: its writes make nothing again either (database or localStorage)"""
import os, sys, json, time, asyncio
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("SPEED_PORT", os.environ.get("IDB_REOPEN_PORT", "9583"))
import run_speed_open as R
from playwright.async_api import async_playwright
TS = R.TS
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SYNCED = "() => typeof Cloud === 'object' && Cloud.st && Cloud.st.lastSync > 0 && !document.querySelector('[data-boot-part]')"
# a value read with a connection of its own (not the page's)
RAW = """([name, store, key]) => new Promise((done) => { const o = indexedDB.open(name); o.onerror = () => done('open failed');
  o.onsuccess = () => { const db = o.result; try { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => { db.close(); done(q.result === undefined ? null : q.result); }; q.onerror = () => { db.close(); done('read failed'); }; } catch (e) { db.close(); done(e.name); } }; })"""
# counts the openings of the databases from here on
COUNT = """() => { if (window.__opens) return; window.__opens = 0; const o = indexedDB.open.bind(indexedDB); indexedDB.open = function(){ window.__opens++; return o.apply(null, arguments); }; }"""
ERR = "(e) => ({failed: (e && e.name) || String(e), msg: String((e && e.message) || '').slice(0, 120)})"


async def main():
    srv, root = R.serve()
    base = "http://localhost:%d/review/" % R.PORT
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])
        fx = TS.make(); cloud = TS.FakeCloud(fx)
        ctx = await br.new_context(viewport={"width": 1440, "height": 900})
        await ctx.add_init_script(TS.signin_script(fx))
        async def supa(route):
            req = route.request
            try: st, j, hd = cloud.handle(req.method, req.url, req.post_data)
            except Exception as e: st, j, hd = 500, {"message": str(e)}, {}
            h = {"Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range", "Access-Control-Allow-Headers": "*"}; h.update(hd)
            if req.method == "OPTIONS": return await route.fulfill(status=204, headers=h)
            await route.fulfill(status=st, content_type="application/json", body=json.dumps(j), headers=h)
        await ctx.route("https://*.supabase.co/**", supa)
        await ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
        await ctx.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
        pg = await ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        await pg.goto(base + "#/clients")
        await pg.wait_for_function(SYNCED, timeout=60000, polling=100)
        await asyncio.sleep(1.5)
        # the databases' names as the page opens them (the test build's own names)
        W, BK = await pg.evaluate("async () => [(await IDBStore.ready()).name, (await BankDB.open()).name]")
        await pg.evaluate(COUNT)

        print("1. IDBStore: the connection closed under it")
        r = await pg.evaluate("""async () => { const d = await IDBStore.ready(); d.close();
            try { await Books.save('zz-made-up', {cid: 'zz-made-up', vouchers: [{id: 'v1'}]}); return 'kept'; } catch (e) { return (%s)(e); } }""" % ERR)
        ok(r == "kept", "Books.save after the connection closed: %s" % (r,))
        v = await pg.evaluate(RAW, [W, "docs", "bkw:zz-made-up"])     # (split-save: the books' work part, src/js/04)
        ok(isinstance(v, dict) and (v.get("d") or {}).get("cid") == "zz-made-up", "the books are in the database (read with a connection of its own): %s" % (json.dumps(v)[:80],))
        r = await pg.evaluate("""async () => { (await IDBStore.ready()).close(); try { const a = await Books.read('zz-made-up');
            (await IDBStore.ready()).close(); const b = await IDBStore.prefix('bkw:zz-made'); return [a && a.cid, b.length]; } catch (e) { return (%s)(e); } }""" % ERR)
        ok(r == ["zz-made-up", 1], "a read and a prefix read after the connection closed: %s" % (r,))

        print("2. IDBStore: the browser closes the connection")
        await pg.evaluate("() => IDBStore.ready()")
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send("Storage.clearDataForOrigin", {"origin": "http://localhost:%d" % R.PORT, "storageTypes": "indexeddb"})
        await asyncio.sleep(0.5)
        r = await pg.evaluate("""async () => { try { await IDBStore.write([['zz:after-clear', {v: 3}]]); return 'kept'; } catch (e) { return (%s)(e); } }""" % ERR)
        v = await pg.evaluate(RAW, [W, "docs", "zz:after-clear"])
        ok(r == "kept" and v == {"v": 3}, "the next write is kept: %s, %s" % (r, v))

        print("3. IDBStore: a database that keeps closing")
        r = await pg.evaluate("""async () => { const real = IDBStore.ready, keep = IDBStore.db; let n = 0;
            const bad = {transaction(){ throw new DOMException('The database connection is closing.', 'InvalidStateError'); }};
            IDBStore.db = bad; IDBStore.ready = async function(){ n++; IDBStore.db = IDBStore.db || bad; return bad; };
            let out; try { await IDBStore.write([['zz:never', {v: 4}]]); out = 'kept?'; } catch (e) { out = e.name; }
            IDBStore.ready = real; IDBStore.db = null; IDBStore.dbp = null; return [out, n]; }""")
        ok(r == ["InvalidStateError", 2], "the write fails after two tries, not a loop: %s" % (r,))

        print("4. IDBStore: a connection this page closed itself")
        r = await pg.evaluate("""async () => { await IDBStore.ready(); const n0 = window.__opens;
            const w = IDBStore.write([['zz:after-own-close', {v: 5}]]);
            const d = IDBStore.db; d.close(); IDBStore.dbp = null; IDBStore.db = null;
            let out; try { await w; out = 'kept'; } catch (e) { out = e.name; } return [out, window.__opens - n0]; }""")
        ok(r == ["InvalidStateError", 0], "the write under way fails, the database is not opened again for it: %s" % (r,))

        print("5. BankDB: the connection closed under it")
        r = await pg.evaluate("""async () => { const d = await BankDB.open(); if (!d) return 'no database'; d.close();
            const s = await BankDB.set('zz:bank', {v: 6}); return s; }""")
        v = await pg.evaluate(RAW, [BK, "kv", "zz:bank"])
        ok(r is True and v == {"v": 6}, "BankDB.set after the connection closed is kept in the database: %s, %s" % (r, v))
        r = await pg.evaluate("""async () => { (await BankDB.open()).close(); delete BankDB.mem['zz:bank']; const g = await BankDB.get('zz:bank'); return g; }""")
        ok(r == {"v": 6}, "BankDB.get after the connection closed reads the database: %s" % (r,))
        r = await pg.evaluate("""async () => { (await BankDB.open()).close(); const s = await BankDB.del('zz:bank'); return s; }""")
        v = await pg.evaluate(RAW, [BK, "kv", "zz:bank"])
        ok(r is True and v is None, "BankDB.del after the connection closed is done in the database: %s, %s" % (r, v))

        print("6. BankDB: a database that keeps closing")
        r = await pg.evaluate("""async () => { const real = BankDB.open; let n = 0;
            const bad = {transaction(){ throw new DOMException('The database connection is closing.', 'InvalidStateError'); }};
            BankDB.db = bad; BankDB.open = async function(){ n++; BankDB.db = BankDB.db || bad; return bad; };
            const s = await BankDB.set('zz:never', {v: 7}); BankDB.open = real; BankDB.db = null; BankDB.dbp = null; return [s, n]; }""")
        ok(r == [False, 2], "the save answers false after two tries, not a loop: %s" % (r,))

        print("7. a write cut short by the browser's closing (its error, then the abort, then the close): the second try's answer")
        r = await pg.evaluate("""async () => {
            // a transaction that fails as one cut short does: error, abort, and the connection's close a moment after
            const cut = (o) => ({transaction(){ const tx = {objectStore: () => ({put(){}, delete(){}})}; setTimeout(() => { const e = new DOMException('cut short', 'UnknownError'); tx.error = e;
              setTimeout(() => idbDrop(o, this), 0); if (tx.onerror) tx.onerror(); if (tx.onabort) tx.onabort(); }, 0); return tx; }});
            const realI = IDBStore.ready, realB = BankDB.open; let ni = 0, nb = 0;
            const fi = cut(IDBStore); IDBStore.db = fi; IDBStore.ready = function(){ return ni++ ? realI.call(IDBStore) : Promise.resolve(fi); };
            let w; try { await IDBStore.write([['zz:cut', {v: 7}]]); w = 'kept'; } catch (e) { w = e.name; }
            IDBStore.ready = realI;
            const fb = cut(BankDB); BankDB.db = fb; BankDB.dbp = Promise.resolve(fb); BankDB.open = function(){ return nb++ ? (BankDB.open = realB, realB.call(BankDB)) : Promise.resolve(fb); };
            const s = await BankDB.set('zz:cutbank', {v: 7}); BankDB.open = realB;
            return [w, s, ni, nb]; }""")
        v1 = await pg.evaluate(RAW, [W, "docs", "zz:cut"]); v2 = await pg.evaluate(RAW, [BK, "kv", "zz:cutbank"])
        ok(r[:2] == ["kept", True] and v1 == {"v": 7} and v2 == {"v": 7}, "IDBStore.write kept, BankDB.set true, both in the database: %s, %s, %s" % (r, v1, v2))

        ok(not errs, "no page errors up to here (%s)" % errs[:2])   # (after a clearing, a save may fail: that is the point)
        print("8. another tab clears this browser's copy (clearLocalCopy) while this page has it open")
        await pg.evaluate("async () => { await IDBStore.ready(); await BankDB.open(); }")
        p2 = await ctx.new_page(); errs2 = []; p2.on("pageerror", lambda e: errs2.append(str(e)[:200]))
        await p2.goto(base + "#/clients")
        await p2.wait_for_function(SYNCED, timeout=60000, polling=100)
        await asyncio.sleep(1.5)
        r = await p2.evaluate("() => Promise.race([clearLocalCopy().then(() => 'cleared'), new Promise((r) => setTimeout(() => r('held'), 15000))])")
        ok(r == "cleared", "the clearing in the other tab is not held by this page: %s" % r)
        names = "() => indexedDB.databases().then((l) => l.map((d) => d.name))"
        gone0 = await p2.evaluate(names)
        ok(W not in gone0 and BK not in gone0, "both databases removed (%s)" % gone0)
        r = await pg.evaluate("""async () => { let w; try { await IDBStore.write([['zz:after-clear-other', {v: 8}]]); w = 'kept'; } catch (e) { w = 'failed'; }
            const s = await BankDB.set('zz:after-clear-other', {v: 8}); await new Promise((r) => setTimeout(r, 300)); return [w, s]; }""")
        left = await p2.evaluate(names)
        ok(r == ["failed", False] and W not in left and BK not in left, "this page's next writes do not make the copy again: %s, databases now %s" % (r, left))

        print("9. the tab that cleared it, before its reload")
        r = await p2.evaluate("""async () => { let w; try { await IDBStore.write([['zz:after-clear-own', {v: 9}]]); w = 'kept'; } catch (e) { w = 'failed'; }
            const s = await BankDB.set('zz:after-clear-own', {v: 9}); return [w, s, Object.keys(localStorage).filter((k) => /^tdsdesk(-test)?:bank:zz/.test(k)).length]; }""")
        left = await p2.evaluate(names)
        ok(r == ["failed", False, 0] and W not in left and BK not in left, "its writes make nothing again either (not in the database, not in localStorage): %s, %s" % (r, left))
        await p2.close()
        await ctx.close(); await br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
