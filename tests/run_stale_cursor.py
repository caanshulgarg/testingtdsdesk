"""python3 tests/run_stale_cursor.py - a browser that lost its databases and kept localStorage (next-noclients, 05-Nov-2026:
the owner, "FinCom is showing no client" while the cloud had the firm's clients and answered 200).

The pull's cursor (Cloud.cfg().lastPull) is kept in localStorage, what it brought in IndexedDB (tdsdesk-work: the clients,
bills and parties; tdsdesk-bank: bank and sales). With the databases gone and the cursor kept, the page asked only for
what changed since the cursor (none), and showed no client, for good. Now each database keeps a mark of the pull, and
the first pull of a page with a cursor and a database without its mark pulls everything again (cloudPull, src/js/27).

The React test build (app/dist-test, or TDSDESK_SITE) served at /review/ (tests/cf_pages.py), signed in to the stand-in
cloud of tally_shapes.py (the made-up firm: 10 live clients, 2 removed, bank statements):
  1. both databases gone, the cursor kept: every client shown again, the bank statements back (a pull from the start)
  2. only tdsdesk-bank gone: the bank statements back
  3. nothing gone: the page opened again pulls from its cursor (no pull from the start)
  4. a copy from before the marks (its clients here, no mark): no pull from the start, and the marks set
  5. a short copy from before the marks (1 client of 10 here, no mark: the owner's "1 client of 9"): every client back
  6. a short copy with its marks (1 client of 10 here): every client back
  7. a client added on another computer after the cursor: it comes with the pull from the cursor (no pull from the start)
  8. a client removed here in a paused firm (its removal waits here, the cloud still has it): it is not brought back"""
import os, sys, json, time, asyncio
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("SPEED_PORT", os.environ.get("STALE_PORT", "9577"))
import run_speed_open as R
from playwright.async_api import async_playwright
TS = R.TS
fails = []
CTX = {}
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SHOWN = """(names) => { const t = (document.querySelector('#app') || {}).innerText || ''; return names.filter((n) => t.includes(n)).length; }"""
STMTS = """() => Promise.all(Object.keys(S.companies).map((c) => BankDB.get('stmts:' + c))).then((l) => l.reduce((a, x) => a + ((x || []).length), 0))"""
SYNCED = "() => typeof Cloud === 'object' && Cloud.st && Cloud.st.lastSync > 0 && !document.querySelector('[data-boot-part]')"
# which databases: 'work', 'bank'; what: 'db' (the database removed), 'mark' (only its mark), 'short' (every client but
# one removed, and the mark), 'shortkeep' (every client but one removed, the mark kept)
WIPE = """([which, what]) => indexedDB.databases().then((l) => Promise.all(l.filter((d) => which.some((w) => (d.name || '').startsWith('tdsdesk-' + w))).map((d) => new Promise((done) => {
  if (what === 'db') { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => done(d.name); return; }
  const o = indexedDB.open(d.name); o.onerror = () => done('');
  o.onsuccess = () => { const db = o.result, st = db.objectStoreNames.contains('docs') ? 'docs' : 'kv', tx = db.transaction(st, 'readwrite'); const os = tx.objectStore(st);
    if (what !== 'shortkeep') os.delete('cloud:pulled');
    if (what.startsWith('short') && st === 'docs') { let kept = 0; os.openCursor(IDBKeyRange.bound('companies/', 'companies/\uffff')).onsuccess = (e) => { const c = e.target.result; if (!c) return; if (String(c.key).split('/').length === 2 && kept++) c.delete(); c.continue(); }; }
    tx.oncomplete = () => { db.close(); done(d.name); }; tx.onerror = () => { db.close(); done(''); }; };
}))))"""
MARKS = """() => Promise.all([IDBStore.get('cloud:pulled'), BankDB.get('cloud:pulled')])"""


async def main():
    srv, root = R.serve()
    base = "http://localhost:%d/review/" % R.PORT
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])

        async def context():
            fx = TS.make(); cloud = TS.FakeCloud(fx); pulls = []
            ctx = await br.new_context(viewport={"width": 1440, "height": 900})
            await ctx.add_init_script(TS.signin_script(fx))
            async def supa(route):
                req = route.request
                try: st, j, hd = cloud.handle(req.method, req.url, req.post_data)
                except Exception as e: st, j, hd = 500, {"message": str(e)}, {}
                # a paused firm: the cloud refuses its writes (case 8)
                if CTX.get("readonly") and req.method in ("POST", "PATCH", "DELETE") and "/rest/v1/" in req.url and "/rpc/" not in req.url:
                    st, j, hd = 403, {"message": "made-up: the firm is read-only"}, {}
                if req.method == "PATCH" and "/rest/v1/clients" in req.url:
                    try: j = [dict(json.loads(req.post_data or "{}"), updated_at=time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()))]
                    except Exception: pass
                if req.method == "GET" and "updated_at=gt." in req.url and ("/rest/v1/clients?" in req.url or "/rest/v1/records?" in req.url): pulls.append(req.url)
                h = {"Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Content-Range", "Access-Control-Allow-Headers": "*"}; h.update(hd)
                if req.method == "OPTIONS": return await route.fulfill(status=204, headers=h)
                await route.fulfill(status=st, content_type="application/json", body=json.dumps(j), headers=h)
            await ctx.route("https://*.supabase.co/**", supa)
            await ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
            await ctx.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
            names = [c["name"] for c in fx["clients"] if not c["deleted"]]
            CTX["fx"] = fx
            return ctx, names, pulls

        async def opened(pg, names, timeout=30000):
            await pg.goto(base + "#/clients")
            await pg.wait_for_function(SYNCED, timeout=60000, polling=100)
            try: await pg.wait_for_function("(names) => (" + SHOWN + ")(names) >= names.length", arg=names, timeout=timeout, polling=200)
            except Exception: pass
            await asyncio.sleep(1.5)   # the bank's records written (BankDB) after the pull
            return await pg.evaluate(SHOWN, names), await pg.evaluate(STMTS)

        async def away(pg, which, what):
            await pg.goto(base + "nothing-here.txt")   # the app closed (its databases free), the same origin
            return await pg.evaluate(WIPE, [which, what])

        full = lambda pulls: sum(1 for u in pulls if "gt.1970-01-01" in u)

        for label, which, what, want_full in (("1. both databases gone, the cursor kept", ["work", "bank"], "db", True),
                                              ("2. only tdsdesk-bank gone, the cursor kept", ["bank"], "db", True),
                                              ("3. nothing gone, opened again", [], "db", False),
                                              ("4. a copy from before the marks", ["work", "bank"], "mark", False),
                                              ("5. a short copy from before the marks (1 client of 10 here)", ["work", "bank"], "short", True),
                                              ("6. a short copy with its marks (1 client of 10 here)", ["work"], "shortkeep", True)):
            print(label)
            ctx, names, pulls = await context()
            pg = await ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
            n0, s0 = await opened(pg, names)
            ok(n0 == len(names) and s0 > 0, "the first open: %d of %d clients, %d bank statements" % (n0, len(names), s0))
            cur = await pg.evaluate("() => Cloud.cfg().lastPull")
            gone = await away(pg, which, what)
            left = await pg.evaluate("() => { const k = Object.keys(localStorage).find((x) => /^tdsdesk(-test)?:cloud$/.test(x)); return k ? JSON.parse(localStorage.getItem(k)).lastPull : null; }")
            ok(bool(cur) and left == cur, "the cursor kept in localStorage (%s), databases touched: %s" % (left, gone))
            del pulls[:]
            n1, s1 = await opened(pg, names, 30000 if want_full else 8000)
            ok(n1 == len(names), "opened again: %d of %d clients shown" % (n1, len(names)))
            ok(s1 == s0, "opened again: %d bank statements (were %d)" % (s1, s0))
            f = full(pulls)
            ok((f > 0) == want_full, "a pull from the start: %s (%d of %d pulls)" % ("wanted" if want_full else "not wanted", f, len(pulls)))
            if what != "db":
                m = await pg.evaluate(MARKS)
                ok(m == [1, 1], "the marks set after the pull: %s" % (m,))
            ok(not errs, "no page errors (%s)" % errs[:2])
            await ctx.close()

        print("7. a client added on another computer after the cursor")
        ctx, names, pulls = await context(); fx = CTX["fx"]
        pg = await ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        n0, s0 = await opened(pg, names)
        await away(pg, [], "db")
        c = json.loads(json.dumps(fx["clients"][0])); now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(time.time() + 5))
        c.update(id="cmadeupnew7", name="Made-up Added Elsewhere", tally_name="Made-up Added Elsewhere", deleted=False, updated_at=now)
        c["data"] = dict(c.get("data") or {}, id="cmadeupnew7", name="Made-up Added Elsewhere")
        fx["clients"].append(c); names.append(c["name"])
        del pulls[:]
        n1, s1 = await opened(pg, names, 15000)
        ok(n1 == len(names), "opened again: %d of %d clients shown (the new one too)" % (n1, len(names)))
        ok(full(pulls) == 0, "no pull from the start (%d of %d pulls)" % (full(pulls), len(pulls)))
        ok(not errs, "no page errors (%s)" % errs[:2])
        await ctx.close()

        print("8. a client removed here in a paused firm")
        ctx, names, pulls = await context(); fx = CTX["fx"]
        pg = await ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        n0, s0 = await opened(pg, names)
        fx["_rpc"]["my_firm_status"] = {"status": "suspended", "reason": "made-up test", "at": now}
        CTX["readonly"] = True
        gone = fx["clients"][[i for i, x in enumerate(fx["clients"]) if not x["deleted"]][0]]
        del pulls[:]
        r = await pg.evaluate("""async (id) => { FirmGate.st = {status: 'suspended', reason: 'made-up test'};
            await Store.deleteCompany(id, 'made-up test removal'); await new Promise((r) => setTimeout(r, 300));
            while (cloudBusy) await new Promise((r) => setTimeout(r, 100)); cloudPull.marked = 0; await cloudSync(false); await new Promise((r) => setTimeout(r, 1500));
            const k = 'client|' + id + '|' + id; return {here: !!S.companies[id], pending: k in Cloud.dels()}; }""", gone["id"])
        ok(r == {"here": False, "pending": True}, "the removed client stays removed, its removal still waiting to be sent: %s" % (r,))
        ok(full(pulls) == 0, "no pull from the start (%d of %d pulls)" % (full(pulls), len(pulls)))
        ok(not errs, "no page errors (%s)" % errs[:2])
        await ctx.close(); CTX["readonly"] = False

        await br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
