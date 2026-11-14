"""python3 tests/run_speed_save.py - Books.save of large books by the engine's worker, when something else happens to the
store meanwhile (next-speed-worker, review of the full stack). Books of more than Engine.SMALL entries are written by the
worker (Engine.store, src/js/06; app/engine/worker.js storeMsg, boot.js storeTx); these are the ways that could go wrong:

  clear     another tab clears this browser's copy (clearLocalCopy): a save after it, on the page or in the worker even
            when the page's own check is passed by, never makes the database again, and writes nothing
  drop      a client removed (Books.drop) while its save of 30,000 entries is on its way: nothing of it is left, at
            several moments of the save (before, while its parts go, while the worker writes)
  tabs      two tabs saving one client's books at once, rounds of them: the records always one version, whole (bke, bkw
            and bkh of one s) and the books read the ones one of the tabs wrote
  close     the tab closed, or left, while a save of 30,000 entries goes: the books read after are whole; the newest when
            the tab was left (pagehide writes the save on its way), as before or the newest when it was closed

The React test build (app/dist-test, or TDSDESK_SITE) signed in to the stand-in cloud of tally_shapes.py, as
tests/run_speed_open.py serves it (SPEED_SAVE_PORT, default 8653). Made-up entries only."""
import os, sys, json, asyncio
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ["SPEED_PORT"] = os.environ.get("SPEED_SAVE_PORT") or "8653"
import run_speed_open as R
from playwright.async_api import async_playwright
TS = R.TS
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

# (the first tab of a context syncs with the cloud; a tab beside it is ready when its program is)
READY = "() => typeof S === 'object' && S && S.firm && typeof Books === 'object' && typeof Engine === 'object' && typeof IDBStore === 'object' && !document.querySelector('[data-boot-part]')"
SYNCED = "() => typeof Cloud === 'object' && Cloud.st && Cloud.st.lastSync > 0 && !document.querySelector('[data-boot-part]')"
NAMES = "() => indexedDB.databases().then((l) => l.map((d) => d.name))"
# made-up books of n entries (tag: told apart from another tab's), and the page's count of the worker's writes
HELP = """() => { if (window.Z) return; window.Z = {
  books(cid, n, tag){ const V = []; for (let i = 0; i < n; i++) V.push({id: 'v' + i, date: '2025' + String(4 + i % 9).padStart(2, '0') + '01', amt: i, tag, nar: 'made-up entry ' + i});
    return {cid, vouchers: V, meta: {tag}, audit: {tag}}; },
  sends: 0, skips: 0,
  db(){ return IDBStore.db ? IDBStore.db.name : LocalOwner.db('tdsdesk-work'); },
  // the records of a client as they are in the store, read without opening it at any version (nothing made)
  raw(name, cid){ return new Promise((done) => { let o; try { o = indexedDB.open(name); } catch (e) { done({err: e.name}); return; }
    o.onupgradeneeded = () => { o.transaction.abort(); };
    o.onerror = (e) => { e.preventDefault(); done({none: true}); };
    o.onsuccess = () => { const db = o.result; try { const st = db.transaction('docs').objectStore('docs'), out = {}; let n = 4;
      ['bke:', 'bkw:', 'bkh:', 'books:'].forEach((p) => { const q = st.get(p + cid); q.onsuccess = () => { const r = q.result; out[p.slice(0, -1)] = r ? {s: r.s, n: r.v ? r.v.length : undefined, tag: r.d ? r.d.meta && r.d.meta.tag : r.v ? r.v[0] && r.v[0].tag : undefined} : null; if (!--n){ db.close(); done(out); } }; });
    } catch (e){ db.close(); done({err: e.name}); } }; }); },
  wrap(){ if (Engine.__w) return; Engine.__w = 1; const p = Engine.post; Engine.post = function (m){ if (m && m.t === 'send') Z.sends++; const r = p.call(this, m); if (m && m.t === 'send' && Z.onSend){ const f = Z.onSend; Z.onSend = null; f(); } return r; };
    const g = Engine.got; Engine.got = function (m){ if (m && m.t === 'skip') Z.skips++; return g.call(this, m); }; },
}; }"""


async def main():
    srv, root = R.serve(); base = "http://localhost:%d/review/" % R.PORT
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])
        fx = TS.make(); cloud = TS.FakeCloud(fx)

        async def context():
            ctx = await br.new_context(); await ctx.add_init_script(TS.signin_script(fx))
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
            return ctx

        async def page(ctx):
            pg = await ctx.new_page(); pg.on("pageerror", lambda e: print("    (page error)", str(e)[:200]))
            first = not getattr(ctx, "_opened", False); ctx._opened = True
            await pg.goto(base + "#/clients"); await pg.wait_for_function(SYNCED if first else READY, timeout=90000, polling=100)
            if not first: await asyncio.sleep(3)
            await pg.evaluate(HELP); await pg.evaluate("() => Z.wrap()"); await pg.evaluate("() => IDBStore.ready()")
            return pg

        # ---- clear: another tab clears this browser's copy, then this one saves
        print("clear: another tab clears this browser's copy, then saves of 6,000 entries", flush=True)
        ctx = await context(); p1 = await page(ctx); name = await p1.evaluate("async () => (await IDBStore.ready()).name")
        p2 = await page(ctx)
        ok(name in await p2.evaluate(NAMES), "the copy there before (%s)" % name)
        r = await p2.evaluate("() => Promise.race([clearLocalCopy().then(() => 'cleared'), new Promise((r) => setTimeout(() => r('held'), 15000))])")
        ok(r == "cleared" and name not in await p2.evaluate(NAMES), "the other tab cleared the copy (%s)" % r)
        r = await p1.evaluate("""async () => { const d = Z.books('zz-clear', 6000, 'a'), can = Engine.canStore(d); let w = 'kept';
          try { await Books.save('zz-clear', d); } catch (e){ w = 'refused'; } await new Promise((r) => setTimeout(r, 400)); return [can, w, Z.sends]; }""")
        ok(r[0] is False and r[2] == 0, "this tab's save not given to the worker (%s)" % r)
        ok(name not in await p1.evaluate(NAMES), "the database not made again by the save")
        # the page's check passed by: the worker itself, told to write the books to the removed database
        r = await p1.evaluate("""async () => { const o = Engine.storeOk; Engine.storeOk = () => true; let r;
          try { r = await Engine.store('zz-clear', Z.books('zz-clear', 6000, 'b'), null); } finally { Engine.storeOk = o; }
          await new Promise((r) => setTimeout(r, 400)); return [r, Z.sends, Engine.st]; }""")
        ok(r[1] == 1 and not (r[0] or {}).get("s"), "the worker given the save wrote nothing (%s)" % json.dumps(r))
        ok(name not in await p1.evaluate(NAMES), "the database not made again by the worker")
        await ctx.close()

        # ---- drop: a client removed while its save goes
        print("drop: Books.drop while a save of 30,000 entries goes", flush=True)
        ctx = await context(); p1 = await page(ctx); name = await p1.evaluate("() => Z.db()")
        # (ms: after the save began; "send": the moment the worker is told to write, its transaction about to open)
        for i, ms in enumerate([0, 30, 30, 80, 200, 500, 1200, "send", "send", "send"]):
            cid = "zz-drop-%d" % i
            r = await p1.evaluate("""async ([cid, ms]) => { const s0 = Z.sends, d = Z.books(cid, 30000, 'x');
              if (!Engine.canStore(d)) return {can: false};
              let b = null; const a = Books.save(cid, d);
              if (ms === 'send') await new Promise((r) => { Z.onSend = () => { b = Books.drop(cid); r(); }; });
              else await new Promise((r) => setTimeout(r, ms));
              const sent = Z.sends - s0; if (!b) b = Books.drop(cid);
              await Promise.allSettled([a, b]); await Books.save(cid, Z.books(cid, 30000, 'y')).catch(() => {});
              await new Promise((r) => setTimeout(r, 1500)); return {can: true, sent, after: Z.sends - s0, rec: await Z.raw(Z.db(), cid), read: !!(await Books.read(cid))}; }""", [cid, ms])
            rec = r.get("rec") or {}
            ok(r.get("can") and not any(rec.get(k) for k in ("bke", "bkw", "bkh", "books")) and not r.get("read"),
               "dropped %s into the save (sent to the worker by then: %s): nothing left %s" % (ms if ms == "send" else "%d ms" % ms, r.get("sent"), json.dumps(rec)))
        r = await p1.evaluate("""async () => { const d = Z.books('zz-kept', 30000, 'k'); await Books.save('zz-kept', d); const b = await Books.read('zz-kept'); return [!!b && b.vouchers.length, Z.sends > 0]; }""")
        ok(r == [30000, True], "another client's save still written by the worker (%s)" % r)
        await ctx.close()

        # ---- tabs: one client's books saved by two tabs at once
        print("tabs: two tabs saving one client's books of 8,000 entries at once", flush=True)
        ctx = await context(); p1 = await page(ctx); p2 = await page(ctx)
        SAVE = """async ([cid, tag, n]) => { await Books.save(cid, Z.books(cid, n, tag)); return Z.sends; }"""
        for rnd in range(6):
            n1, n2 = 8000 + rnd * 7, 8000 + rnd * 11
            res = await asyncio.gather(p1.evaluate(SAVE, ["zz-tabs", "one%d" % rnd, n1]), p2.evaluate(SAVE, ["zz-tabs", "two%d" % rnd, n2]))
            rec = await p1.evaluate("() => Z.raw(Z.db(), 'zz-tabs')")
            b = await p2.evaluate("async () => { const b = await Books.read('zz-tabs'); return b && [b.vouchers.length, b.vouchers[0].tag, b.meta.tag]; }")
            whole = rec["bke"] and rec["bkw"] and rec["bkh"] and rec["bke"]["s"] == rec["bkw"]["s"] == rec["bkh"]["s"] and not rec["books"]
            ok(bool(whole) and b in ([n1, "one%d" % rnd, "one%d" % rnd], [n2, "two%d" % rnd, "two%d" % rnd]),
               "round %d (the worker's writes: %s): one version, whole, read as one tab wrote it %s" % (rnd + 1, res, b))
        # one tab's books changed again after the other wrote: its save writes its entries (not taken for written)
        await p1.evaluate(SAVE, ["zz-tabs", "one-last", 8100]); await p2.evaluate(SAVE, ["zz-tabs", "two-last", 8200])
        b = await p1.evaluate("async () => { const b = await Books.read('zz-tabs'); return b && [b.vouchers.length, b.vouchers[0].tag, b.meta.tag]; }")
        ok(b == [8200, "two-last", "two-last"], "the later tab's save is what is read (%s)" % b)
        await ctx.close()

        # ---- close: the tab closed or left while a save goes
        print("close: the tab closed, or left, while a save of 30,000 entries goes", flush=True)
        ctx = await context()
        for i, (how, ms) in enumerate([("close", 20), ("close", 150), ("close", 600), ("leave", 20), ("leave", 300)]):
            cid = "zz-close-%d" % i
            p1 = await page(ctx)
            await p1.evaluate("async (cid) => { await Books.save(cid, Z.books(cid, 30000, 'old')); }", cid)
            await p1.evaluate("([cid, ms]) => { window.__s0 = Z.sends; Books.save(cid, Z.books(cid, 30000, 'new')); return new Promise((r) => setTimeout(r, ms)); }", [cid, ms])
            sent = await p1.evaluate("() => Z.sends - window.__s0")
            if how == "close": await p1.close()
            else: await p1.goto("about:blank")
            await asyncio.sleep(1.0)
            p3 = await page(ctx)
            rec = await p3.evaluate("(cid) => Z.raw(Z.db(), cid)", cid)
            b = await p3.evaluate("async (cid) => { const b = await Books.read(cid); return b && [b.vouchers.length, b.vouchers[0].tag, b.meta.tag]; }", cid)
            whole = rec["bke"] and rec["bkw"] and rec["bke"]["s"] == rec["bkw"]["s"] == rec["bkh"]["s"]
            # (a tab closed: what its transactions had not finished is given up by the browser, the worker's and the
            # page's own (pagehide's) alike: the books as before or the newest, whole. A tab left: pagehide writes them)
            want = [[30000, "new", "new"]] + ([[30000, "old", "old"]] if how == "close" else [])
            ok(bool(whole) and b in want, "%s %d ms into the save (sent to the worker by then: %s): whole, %s %s" % ("closed" if how == "close" else "left", ms, sent, "as before or the newest" if how == "close" else "the newest", b))
            await p3.close()
            if how == "leave": await p1.close()
        await ctx.close(); await br.close()
    srv.shutdown()

asyncio.run(main())
print("all passed" if not fails else "%d FAILED" % len(fails))
sys.exit(1 if fails else 0)
