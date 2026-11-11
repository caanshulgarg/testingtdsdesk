"""python3 tests/run_books_split.py - a client's books saved in two parts (split-save, 11-Nov-2026).

Every save of the books wrote the whole books to this browser's database (Books.save, one record "books:<cid>"): on a
51,758-entry client 0.4 s (about 1.5 s on an office PC) for a tick, a cloud item, an MIS or an audit run. Now the entries
are kept apart from the rest (the work) and written only when they changed: "bke:<cid>" {s, v: the entries},
"bkw:<cid>" {s, d: the rest}, "bkh:<cid>" {s}, all in one transaction; s the version of the entries the work goes with.

The React test build (app/dist-test, or TDSDESK_SITE) served at /review/, signed in to the stand-in cloud (tally_shapes.py):
  1. a save and a reload: the books read back the same; the entries are written once, not again for a change of the work
     only; again for any change to the entries
  2. books kept by a build before this one (the single record) open as they were and are written again as the two
     records (the single one removed in that transaction); (a) a tab still on the older build saves after this build's
     save: its single record is the newer and is what opens (none of its changes ignored); (b) this build saves after
     it: this build's books open, the single record gone
  3. a save cut short (its second write fails): nothing of it is kept and the books read back as saved before it; two
     records that do not go together (versions differ) are never put together: the single record, else nothing
  4. another tab wrote other entries since this page last saved (bkh): a save of the work alone writes the entries too
  5. every kind of change to the entries (an import over a period, an entry put in, one replaced, a sort, a filter, the
     cloud copy's TDS details on an entry held, names cleaned in place, the books removed and wiped) is saved: the saved
     books are the books in memory after each; an entry changed in place without a new array IS caught by that diff
     (the test's own check), and saved once the books are given a new array (Books.touch)
  6. the books removed (More > Remove) and restored (More > Restore) come back identical, also after a reload
  7. a client removed: its records are removed (both parts, the head and the record of before)
  8. this browser's copy cleared (sign-out "remove this browser's copy"): no record of the books is left"""
import os, sys, json, asyncio
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("SPEED_PORT", os.environ.get("BOOKS_SPLIT_PORT", "9587"))
import run_speed_open as R
from playwright.async_api import async_playwright
TS = R.TS
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

SYNCED = "() => typeof Cloud === 'object' && Cloud.st && Cloud.st.lastSync > 0 && !document.querySelector('[data-boot-part]')"
READY = "() => typeof S === 'object' && S && S.firm && typeof Books === 'object' && typeof Cloud === 'object' && Cloud.on() && !document.querySelector('[data-boot-part]')"
# records read with a connection of their own (not the page's): {key: value or null}; 'gone' when the store is not there
RAW = """([name, keys]) => new Promise((done) => { const o = indexedDB.open(name); o.onerror = () => done('open failed');
  o.onsuccess = () => { const db = o.result, out = {}; let n = keys.length; try { const st = db.transaction('docs').objectStore('docs');
    keys.forEach((k) => { const q = st.get(k); q.onsuccess = () => { out[k] = q.result === undefined ? null : q.result; if (!--n) { db.close(); done(out); } }; }); }
    catch (e) { db.close(); done('gone'); } }; })"""
# writes records with a connection of its own (null removes)
RAWPUT = """([name, pairs]) => new Promise((done) => { const o = indexedDB.open(name); o.onsuccess = () => { const db = o.result, tx = db.transaction('docs', 'readwrite'), st = tx.objectStore('docs');
  pairs.forEach(([k, v]) => v == null ? st.delete(k) : st.put(v, k)); tx.oncomplete = () => { db.close(); done(true); }; tx.onabort = () => { db.close(); done(false); }; }; })"""
KEYS = lambda cid: ["bke:" + cid, "bkw:" + cid, "bkh:" + cid, "books:" + cid]
# the books as saveBooks keeps them, as text with sorted keys
KEEP = "(b) => { const k = {cid: b.cid}; BOOKS_KEYS.forEach((x) => { k[x] = b[x]; }); return stableStr(JSON.parse(JSON.stringify(k))); }"
MEM = "() => (" + KEEP + ")(S.books)"
# the saved books read from this browser's database (not the copy in memory), as the same text
SAVED = "async (cid) => { const d = await Books.read(cid); return d ? stableStr(JSON.parse(JSON.stringify(d))) : null; }"
# which parts of the saved books differ from the books in memory
DIFF = """async ([cid, mem]) => { const d = await Books.read(cid) || {}, b = mem ? JSON.parse(mem) : S.books, out = []; ['cid'].concat(BOOKS_KEYS).forEach((k) => { const a = stableStr(JSON.parse(JSON.stringify(d[k] === undefined ? null : d[k]))), c = stableStr(JSON.parse(JSON.stringify(b[k] === undefined ? null : b[k]))); if (a !== c) out.push(k + ': ' + a.slice(0, 80) + ' / ' + c.slice(0, 80)); }); return out; }"""
# made-up books: n entries, work of every kind
MAKE = """([cid, n]) => { const v = []; for (let i = 0; i < n; i++) v.push({id: 'g' + i, date: '2026' + String(4 + (i % 6)).padStart(2, '0') + String(1 + (i % 27)).padStart(2, '0'),
    type: i % 3 ? 'Purchase' : 'Payment', no: String(i), ref: 'R' + i, narr: 'entry ' + i, party: 'PARTY ' + (i % 7), alt: 5, cancel: false, opt: false, hsn: [],
    ent: [{l: 'PARTY ' + (i % 7), a: 100 + i, r: null}, {l: 'EXPENSE ' + (i % 3), a: -(100 + i), r: null}]});
  return {cid, vouchers: v, meta: {from: '20260401', to: '20260930', src: 'test'}, map: {'EXPENSE 0': {what: 'exp'}}, challans: [{id: 'ch1', amt: 5000}], alloc: {a1: 'ch1'}, pans: {'PARTY 1': 'AAAPA1234A'},
    certs: [{id: 'c1', pan: 'AAAPA1234A'}], twoB: {'202604': {rows: [1, 2, 3]}}}; }"""
# puts made-up books in as the open client's and saves them
SEED = """async ([cid, bk]) => { await openCompany(cid); await openBooks(cid); for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise((r) => setTimeout(r, 50));
  Object.keys(bk).forEach((k) => { S.books[k] = bk[k]; }); await saveBooks(); return S.books.vouchers.length; }"""
# counts the writes of each record kind (the page's own puts) from here on
SPY = """() => { if (window.__puts) { window.__puts = {}; return; } window.__puts = {}; const p = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (v, k) { const c = String(k).split(':')[0]; window.__puts[c] = (window.__puts[c] || 0) + 1; return p.apply(this, arguments); }; }"""


async def main():
    srv, root = R.serve()
    base = "http://localhost:%d/review/" % R.PORT
    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])
        fx = TS.make(); cloud = TS.FakeCloud(fx)
        cid = fx["clients"][0]["id"]
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
        async def boot():
            await pg.goto(base + "#/clients")
            await pg.wait_for_function(SYNCED, timeout=60000, polling=100)
            await asyncio.sleep(1.0)
        async def reload():
            await pg.evaluate("() => { location.hash = '#/clients'; }"); await asyncio.sleep(0.3)
            await pg.reload()
            try: await pg.wait_for_function(READY, timeout=60000, polling=100)
            except Exception:
                print("  (not synced after the reload: %s; errors %s)" % (await pg.evaluate("() => [location.hash, typeof Cloud === 'object' && Cloud.st && Cloud.st.lastSync, !!document.querySelector('[data-boot-part]'), document.body.innerText.slice(0, 200)]"), errs[:3])); raise
            await asyncio.sleep(1.0)
        await boot()
        W = await pg.evaluate("async () => (await IDBStore.ready()).name")
        raw = lambda c=cid: pg.evaluate(RAW, [W, KEYS(c)])
        E = pg.evaluate

        print("1. a save and a reload")
        bk = await E(MAKE, [cid, 300])
        n = await E(SEED, [cid, bk])
        await asyncio.sleep(2.0)     # (what the page does after opening the books, saved too)
        mem = await E(MEM)
        r = await raw()
        ok(n == 300 and isinstance(r, dict) and r["bke:" + cid] and r["bkw:" + cid] and r["bkh:" + cid] and r["books:" + cid] is None,
           "saved as the two records and the head, no single record: %s" % ({k: (v is not None) for k, v in r.items()} if isinstance(r, dict) else r))
        s = r["bke:" + cid]["s"]
        ok(r["bkw:" + cid]["s"] == s and r["bkh:" + cid]["s"] == s and len(r["bke:" + cid]["v"]) == 300 and "vouchers" not in r["bkw:" + cid]["d"],
           "the three carry the same version; the entries in their own record, not in the work's")
        await reload()
        back = await E(SAVED, cid)
        ok(back == mem, "after a reload the books read back the same (%d chars)%s" % (len(mem or ""), "" if back == mem else " DIFF %s" % (await E(DIFF, [cid, mem]))))
        await E("async (cid) => { await openCompany(cid); await openBooks(cid); for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise((r) => setTimeout(r, 50)); }", cid)
        ok(await E("() => S.books.vouchers.length") == 300 and await E("() => S.books.challans[0].id") == "ch1", "the client opens with its 300 entries and its work")
        await E(SPY)
        await E("async () => { S.books.challans = S.books.challans.concat([{id: 'ch2', amt: 1}]); await saveBooks(); }")
        r = await raw(); puts = await E("() => window.__puts")
        ok(r["bke:" + cid]["s"] == s and r["bkw:" + cid]["s"] == s and puts.get("bke", 0) == 0 and puts.get("bkw", 0) == 1,
           "a change of the work only: the work written, the entries not (writes %s, version kept)" % puts)
        await E(SPY)
        await E("async () => { S.books.vouchers.push({id: 'gx', date: '20260930', type: 'Journal', ent: []}); await saveBooks(); }")
        r = await raw(); puts = await E("() => window.__puts")
        s2 = r["bke:" + cid]["s"]
        ok(s2 != s and r["bkw:" + cid]["s"] == s2 and r["bkh:" + cid]["s"] == s2 and len(r["bke:" + cid]["v"]) == 301 and puts.get("bke", 0) == 1,
           "an entry put in: the entries written again with a new version on all three (writes %s)" % puts)

        print("2. books kept by a build before this one")
        old = await E(MAKE, [cid, 120])
        await E(RAWPUT, [W, [["bke:" + cid, None], ["bkw:" + cid, None], ["bkh:" + cid, None], ["books:" + cid, old]]])
        await reload()
        back = await E(SAVED, cid)
        ob = await E("(b) => stableStr(JSON.parse(JSON.stringify(b)))", old)
        ok(back == ob, "the single record of before is read as it was%s" % ("" if back == ob else " GOT %s / %s" % ((back or "")[:200], ob[:200])))
        await E("async (cid) => { await openCompany(cid); await openBooks(cid); for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise((r) => setTimeout(r, 50)); }", cid)
        ok(await E("() => S.books.vouchers.length") == 120, "the client opens with those books (120 entries)")
        await asyncio.sleep(0.5)
        r = await raw()
        ok(r["bke:" + cid] and r["bkw:" + cid] and r["books:" + cid] is None and len(r["bke:" + cid]["v"]) == 120,
           "written again as the two records, the single record removed: %s" % {k: (v or {}).get("s", bool(v)) for k, v in r.items()})
        print("2a. split saved here, then a tab on the older build saves later")
        await E("async () => { S.books.challans = [{id: 'ch9', amt: 9}]; await saveBooks(); }")
        later = await E(MAKE, [cid, 130]); later["challans"] = [{"id": "old-tab", "amt": 1}]
        await E(RAWPUT, [W, [["books:" + cid, later]]])
        await reload()
        back = await E(SAVED, cid)
        ob = await E("(b) => stableStr(JSON.parse(JSON.stringify(b)))", later)
        ok(back == ob, "a new tab opens the older tab's later save (130 entries, its challan), not the split records")
        await asyncio.sleep(0.5)
        r = await raw()
        ok(r["books:" + cid] is None and len(r["bke:" + cid]["v"]) == 130 and r["bkw:" + cid]["d"]["challans"][0]["id"] == "old-tab",
           "and writes it again as the two records")
        await E("async (cid) => { await openCompany(cid); await openBooks(cid); for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise((r) => setTimeout(r, 50)); }", cid)
        ok(await E("() => S.books.vouchers.length") == 130 and await E("() => S.books.challans[0].id") == "old-tab", "the client opens with the older tab's books")
        print("2b. the single record older than this build's save")
        await E(RAWPUT, [W, [["books:" + cid, old]]])
        await E("async () => { S.books.challans = [{id: 'ch10', amt: 10}]; await saveBooks(); }")
        await asyncio.sleep(2.0); await E("() => saveBooks()")
        mem = await E(MEM)
        r = await raw()
        ok(r["books:" + cid] is None, "this build's later save removes the older single record in its transaction")
        await reload()
        ok(await E(SAVED, cid) == mem, "the split records win: the books as this build saved them")

        print("3. a save cut short")
        await E("async (cid) => { await openCompany(cid); await openBooks(cid); for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise((r) => setTimeout(r, 50)); }", cid)
        before = await E(SAVED, cid)
        FAILPUT = """async (what) => { const p = IDBObjectStore.prototype.put; let n = 0;
          IDBObjectStore.prototype.put = function (v, k) { if (/^bk/.test(String(k)) && ++n === 2) throw new DOMException('disk full (made up)', 'QuotaExceededError'); return p.apply(this, arguments); };
          let out; try { new Function(what)(); await saveBooks(); out = 'saved'; } catch (e) { out = e.name; } finally { IDBObjectStore.prototype.put = p; } return [out, n]; }"""
        res = await E(FAILPUT, "S.books.vouchers = S.books.vouchers.concat([{id: 'gy', date: '20260930', type: 'Journal', ent: []}]); S.books.challans = [{id: 'chZ'}];")
        after = await E(SAVED, cid)
        ok(res[0] == "QuotaExceededError" and after == before, "entries and work changed, the second write fails: the save fails and nothing of it is kept (%s)" % res)
        res = await E(FAILPUT, "S.books.challans = [{id: 'chW'}];")
        after2 = await E(SAVED, cid)
        ok(after2 == before, "the save after it (work only, as far as this page knows) fails the same way: still the books as before (%s)" % res)
        await E("async () => { await saveBooks(); }")
        mem = await E(MEM)
        await reload()
        ok(await E(SAVED, cid) == mem, "the next save that goes through keeps everything (the entry and the work of the failed saves too), after a reload")
        r = await raw()
        await E(RAWPUT, [W, [["bkw:" + cid, dict(r["bkw:" + cid], s="other")]]])
        ok(await E(SAVED, cid) is None, "two records whose versions differ (and no single record): nothing, never the two put together")
        await E(RAWPUT, [W, [["books:" + cid, old]]])
        ok(await E(SAVED, cid) == await E("(b) => stableStr(JSON.parse(JSON.stringify(b)))", old), "... and with a single record there: that record")
        await asyncio.sleep(0.5); await E("() => saveBooks()")     # (this page's books saved again, as they were)

        print("4. another tab wrote other entries")
        await reload()
        await E("async (cid) => { await openCompany(cid); await openBooks(cid); for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise((r) => setTimeout(r, 50)); }", cid)
        r = await raw()
        other = dict(r["bke:" + cid], s="tab2", v=r["bke:" + cid]["v"][:5])
        await E(RAWPUT, [W, [["bke:" + cid, other], ["bkw:" + cid, dict(r["bkw:" + cid], s="tab2")], ["bkh:" + cid, {"s": "tab2"}]]])
        await E("async () => { S.books.challans = [{id: 'chT'}]; await saveBooks(); }")
        mem = await E(MEM)
        r = await raw()
        ok(await E(SAVED, cid) == mem and r["bke:" + cid]["s"] != "tab2" and len(r["bke:" + cid]["v"]) == await E("() => S.books.vouchers.length") > 5,
           "a save of the work only writes this page's entries too: the books saved are this page's, whole (%s, %d entries) %s" % (r["bke:" + cid]["s"], len(r["bke:" + cid]["v"]), await E(DIFF, [cid, None])))

        print("5. every kind of change to the entries is saved")
        heads = [{"guid": "g3", "alter_id": 5, "day": "2026-07-04", "tds_tally": {"sec": "194C", "amt": 10}, "tds_tally_alter_id": 5}]
        newer = [{"guid": "g4", "alter_id": 9, "day": "2026-08-05", "vtype": "Purchase", "vno": "4b", "party": "PARTY 4"}]
        kinds = [
            ("the work only", "S.books.alloc = Object.assign({}, S.books.alloc, {a2: 'ch1'});"),
            ("an entry put in (push)", "S.books.vouchers.push({id: 'gp', date: '20260601', type: 'Journal', ent: [{l: 'X', a: 1}]});"),
            ("an entry replaced in its place (a later version from the cloud copy)", "BookSrc.apply(S.books, %s, [], []);" % json.dumps(newer)),
            ("the entries sorted in place", "S.books.vouchers.sort((a, c) => String(c.no).localeCompare(String(a.no)));"),
            ("the cloud copy's TDS details put on an entry held (in place)", "BookSrc.apply(S.books, %s, [], []);" % json.dumps(heads)),
            ("names cleaned in place", "S.books.vouchers[7].party = 'PARTY &amp; SONS\\r\\n'; S.books.vouchers[7].ent[0].l = ' LEDGER&#13;&#10;'; Books.touch(S.books); return saveBooks().then(() => TallyRead.cleanNames(S.books));"),
            ("entries dropped (deleted in Tally)", "BookSrc.drop(S.books, [{guid: 'g5', deleted_at: '2026-11-01', alter_id: 99}]);"),
            ("a period read again", "S.books.vouchers = S.books.vouchers.filter((v) => v.date < '20260601').concat([{id: 'gn', date: '20260615', type: 'Sales', ent: []}]);"),
            ("an entry spliced out", "S.books.vouchers.splice(2, 1);"),
            ("an entry replaced by index", "S.books.vouchers[3] = Object.assign({}, S.books.vouchers[3], {narr: 'changed'});"),
            ("the books wiped", "booksWipe(S.books);"),
        ]
        await E(SEED, [cid, await E(MAKE, [cid, 50])])
        for name, js in kinds:
            res = await E("async (js) => { try { const r = new Function(js)(); if (r && r.then) await r; await saveBooks(); return 'ok'; } catch (e) { return String(e); } }", js)
            mem = await E(MEM)
            ok(res == "ok" and await E(SAVED, cid) == mem, "%s: the saved books are the books in memory (%s)" % (name, res))
        ok(await E("() => S.books.vouchers.length") == 0, "(the last change emptied the entries)")
        await E(SEED, [cid, await E(MAKE, [cid, 50])])
        await E("async () => { S.books.vouchers[1].narr = 'changed in place, no new array'; await saveBooks(); }")
        mem = await E(MEM)
        await E("(cid) => Books.forget(cid)", cid)
        ok(await E(SAVED, cid) != mem, "an entry changed in place without a new array: the diff of saved and in memory catches it (the test's own check)")
        await E("async () => { Books.touch(S.books); await saveBooks(); }")
        ok(await E(SAVED, cid) == mem, "... saved once the books are given a new array (Books.touch)")

        print("6. the books removed and restored")
        await E(SEED, [cid, await E(MAKE, [cid, 80])])
        orig = await E("() => stableStr(JSON.parse(JSON.stringify({v: S.books.vouchers, m: S.books.meta, r: S.books.reco || null})))")
        await E("() => { Trash.off = true; }")     # (the stand-in has no client_trash: this browser's copy, as a firm without it)
        await E("""async () => { window.__ct = confirmTyped; confirmTyped = () => Promise.resolve({reason: 'test'}); doAct('booksClear');
          for (let i = 0; i < 100 && S.books.vouchers.length; i++) await new Promise((r) => setTimeout(r, 50)); await saveBooks(); confirmTyped = window.__ct; }""")
        await reload()
        await E("async (cid) => { await openCompany(cid); await openBooks(cid); for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise((r) => setTimeout(r, 50)); }", cid)
        ok(await E("() => S.books.vouchers.length") == 0, "removed: no entries after a reload")
        await E("() => { Trash.off = true; }")
        await E("async () => { doAct('trashRestore'); for (let i = 0; i < 100 && !S.books.vouchers.length; i++) await new Promise((r) => setTimeout(r, 50)); await saveBooks(); }")
        await reload()
        await E("async (cid) => { await openCompany(cid); await openBooks(cid); for (let i = 0; i < 100 && (!S.books || S.books.loading); i++) await new Promise((r) => setTimeout(r, 50)); }", cid)
        got = await E("() => stableStr(JSON.parse(JSON.stringify({v: S.books.vouchers, m: S.books.meta, r: S.books.reco || null})))")
        ok(got == orig, "restored: the entries, the period and the reconciliation identical after a reload (%d chars)%s" % (len(orig), "" if got == orig else " GOT %s" % got[:300]))

        print("7. a client removed")
        c2 = fx["clients"][5]["id"]
        await E("async ([cid, bk]) => { await Books.save(cid, bk); }", [c2, await E(MAKE, [c2, 10])])
        await E(RAWPUT, [W, [["books:" + c2, {"cid": c2, "vouchers": []}]]])
        r0 = await raw(c2)
        await E("async (cid) => { await Store.deleteCompany(cid, 'test'); await new Promise((r) => setTimeout(r, 300)); }", c2)
        r = await raw(c2)
        ok(all(r0.values()) and not any(r.values()), "before: %s; after: %s" % ([k for k, v in r0.items() if v], [k for k, v in r.items() if v]))

        ok(not [e for e in errs if "made up" not in e], "no page errors up to here (%s)" % errs[:3])   # (after the clearing a save may fail: that is the point)
        print("8. this browser's copy cleared")
        r0 = await raw()
        await E("async () => { await clearLocalCopy(); }")
        r = await raw()
        ok(r0["bke:" + cid] and (r == "gone" or not any(r.values())), "no record of the books is left: %s" % (r if r == "gone" else [k for k, v in r.items() if v]))
        await br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

asyncio.run(main())
