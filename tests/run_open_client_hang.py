"""python3 tests/run_open_client_hang.py - a client opened from Today held the page (hang-invoices, FINCOM-APP-STAGING-K,
staging 6-Nov-2026: 2,372 ms in one click, React's click handler l3 of the app's first file; the page went from Today to
the client's Purchase → To review in that one task).

The click (openAt: openCompany, then goStep review) draws the page several times; each drawing asked draftRows() several
times (the review table, its bar, the top bar, the column filters), each worked out compute() for every draft, and each
compute looked for the draft's duplicate by working out every other bill's number, supplier and year again (normInv,
norm, fyOf). 60 drafts and 400 approved bills: 4,260 computes, about 1 s in the click at full speed.

The React test build (app/dist-test, or TDSDESK_SITE) served at /review/, signed in to the stand-in cloud (tally_shapes.py),
a made-up client given DRAFTS drafts and APPROVED approved bills (some of them duplicates: the same number from the same
PAN, the same number from the same name without a PAN, the same supplier, date and total):
  1. the click on the client's name on Today: its task (the long animation frame of the click) within CLICK_MS (default
     500) at full speed, and compute() at most once per draft for each drawing of the opening (was about 5 times)
  2. the same duplicates found as before: every draft's findDuplicate inside a drawing equals the one outside a drawing
     (the old way), the review table's duplicate notes the same
  3. a draft changed after the opening (a bill number typed): its duplicate is looked for afresh
  4. (review) a colleague's change to a bill coming in, then a drawing with the last drawing's figures (memoKeep, the top
     bar's own news): the bill's duplicate shows at once (ENTRY_REV, moved by every save of a bill or a supplier)"""
import os, sys, json, time, asyncio
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
os.environ.setdefault("SPEED_PORT", os.environ.get("OPEN_HANG_PORT", "9587"))
import run_speed_open as R
from playwright.async_api import async_playwright
TS = R.TS
ND = int(os.environ.get("DRAFTS", "60")); NA = int(os.environ.get("APPROVED", "400")); CLICK = int(os.environ.get("CLICK_MS", "500"))
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# made-up bills; every 7th draft repeats an approved bill's number and PAN, every 11th one's number and name (no PAN),
# every 13th one's supplier, date and total
SEED = """([nd, na]) => { const cid = sortedCompanies()[0].id, d = S.data[cid] = S.data[cid] || {parties: {}, entries: {}}; d.loaded = true; d.entries = d.entries || {}; d.parties = d.parties || {};
  const V = ['ALPHA TRADERS', 'BETA SERVICES PVT LTD', 'GAMMA LOGISTICS', 'DELTA SUPPLIES', 'EPSILON INFRA LLP'];
  const pan = (i) => 'AAAPZ' + String(1000 + i % 40) + 'K';
  const mk = (i, st, o) => { const e = newEntry('bill-' + i + '.pdf'); e.id = 'zz' + i; const total = 1000 + (i * 37) % 90000;
    e.x = Object.assign(e.x || {}, {vendorName: V[i % V.length] + ' ' + (i % 40), vendorPan: i % 3 ? pan(i) : '', invoiceNo: 'INV-' + i, invoiceDate: '2026-0' + (1 + i % 9) + '-1' + (i % 9), total, taxable: Math.round(total / 1.18)}, o || {});
    e.status = st; if (st === 'approved') e.approvedAt = '2026-09-15T05:00:00Z'; d.entries[e.id] = e; return e; };
  for (let i = nd; i < nd + na; i++) mk(i, 'approved');
  for (let i = 0; i < nd; i++) { const a = d.entries['zz' + (nd + i * 3)];
    const o = !a ? null : i % 7 === 0 ? {vendorName: a.x.vendorName, vendorPan: a.x.vendorPan || pan(nd + i * 3 + 1), invoiceNo: a.x.invoiceNo.replace('INV-', 'inv/0'), invoiceDate: a.x.invoiceDate}
      : i % 11 === 0 ? {vendorName: 'M/s ' + a.x.vendorName, vendorPan: '', invoiceNo: a.x.invoiceNo, invoiceDate: a.x.invoiceDate}
      : i % 13 === 0 ? {vendorName: a.x.vendorName, vendorPan: a.x.vendorPan, invoiceNo: 'OTHER-' + i, invoiceDate: a.x.invoiceDate, total: a.x.total} : null;
    mk(i, 'draft', o); }
  refreshStats(cid); return cid; }"""
# compute() counted, and the long animation frames
INSTR = r"""() => { window.__n = 0; window.__r = 0; const f = window.compute; window.compute = function(){ window.__n++; return f.apply(this, arguments); };
  const r = window.render; window.render = function(){ window.__r++; return r.apply(this, arguments); };
  window.__lf = []; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lf.push({d: Math.round(e.duration), scripts: (e.scripts || []).map((s) => [s.invoker, (s.sourceURL || '').split('/').pop().split('?')[0], s.sourceFunctionName, Math.round(s.duration)])}))).observe({type: 'long-animation-frame'}); } catch (e) {} }"""
# each draft's duplicate: inside a drawing (memoScope: the keys worked out once) and outside one
DUPS = """(cid) => { const ds = Object.values(S.data[cid].entries).filter((e) => e.status === 'draft'); const j = (r) => r ? [r.entryId, r.strong] : null;
  const out = ds.map((e) => j(findDuplicate(e, cid))); const ins = memoScope(() => ds.map((e) => j(findDuplicate(e, cid)))); return {out, ins, n: out.filter(Boolean).length}; }"""


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
        await pg.goto(base + "#/today")
        await pg.wait_for_function(R.USABLE["today"], timeout=60000, polling=200)
        await asyncio.sleep(3)
        cid = await pg.evaluate(SEED, [ND, NA])
        await pg.evaluate("() => navHome('today')"); await asyncio.sleep(2)
        await pg.evaluate(INSTR)
        name = await pg.evaluate("(cid) => S.companies[cid].name", cid)

        print("1. the client opened from Today (%d drafts, %d approved bills)" % (ND, NA))
        t0 = time.time()
        await pg.locator("#app .today-co button", has_text=name).first.click(no_wait_after=True, timeout=120000)
        await pg.wait_for_function("() => S.view === 'company' && S.tab === 'invoices' && S.reviewTable", timeout=120000)
        el = time.time() - t0
        await asyncio.sleep(2)
        n, nr, lf = await pg.evaluate("() => [window.__n, window.__r, window.__lf]")
        click = max([f["d"] for f in lf if any(s[0].endswith("onclick") for s in f["scripts"])] or [0])
        ok(click <= CLICK, "the click's task %d ms <= %d (to the review table %.2f s; long frames: %s)" % (click, CLICK, el, [f["d"] for f in lf if f["d"] > 150]))
        ok(n <= ND * (nr + 1), "compute() %d times for the opening <= %d (once per draft per drawing: %d drawings)" % (n, ND * (nr + 1), nr))
        rows = await pg.locator("#app [data-rev-row], #app table tbody tr").count()
        ok(rows >= ND, "the review table shows the drafts (%d rows)" % rows)

        print("2. the same duplicates")
        d = await pg.evaluate(DUPS, cid)
        ok(d["ins"] == d["out"] and d["n"] >= 8, "each draft's duplicate inside a drawing = outside one (%d of %d drafts have one)" % (d["n"], ND))

        print("3. a draft changed after the opening")
        r = await pg.evaluate("""(cid) => { const ds = Object.values(S.data[cid].entries).filter((e) => e.status === 'draft' && !findDuplicate(e, cid)); const e = ds[0];
            const a = Object.values(S.data[cid].entries).find((o) => o.status === 'approved' && o.x.vendorPan);
            e.x.vendorPan = a.x.vendorPan; e.x.vendorName = a.x.vendorName; e.x.invoiceNo = a.x.invoiceNo; e.x.invoiceDate = a.x.invoiceDate; render();
            const row = draftRows().find((x) => x.e.id === e.id); const f = findDuplicate(e, cid);
            return [f && f.entryId === a.id, !!(row && row.c && row.c.dup && row.c.dup.entryId === a.id)]; }""", cid)
        ok(r == [True, True], "its duplicate is found afresh, and its row says so: %s" % (r,))
        print("4. a colleague's change coming in, drawn with the last drawing's figures (memoKeep: the top bar's news)")
        r = await pg.evaluate("""(cid) => { render();
            const d = Object.values(S.data[cid].entries).find((e) => e.status === 'draft' && !findDuplicate(e, cid));
            const a = Object.values(S.data[cid].entries).find((o) => o.status === 'approved' && o.x.vendorPan && o.x.invoiceNo !== d.x.invoiceNo);
            const before = memoKeep(() => { const row = draftRows().find((x) => x.e.id === d.id); return !!(row && row.c.dup); });
            // as cloudApply puts a colleague's copy of the bill in place: the same object, its fields replaced, then saved here
            Object.assign(d.x, {vendorPan: a.x.vendorPan, vendorName: a.x.vendorName, invoiceNo: a.x.invoiceNo, invoiceDate: a.x.invoiceDate}); Store.saveEntry(cid, d);
            const after = memoKeep(() => { const row = draftRows().find((x) => x.e.id === d.id); return row && row.c.dup ? row.c.dup.entryId === a.id : false; });
            return [before, after]; }""", cid)
        ok(r == [False, True], "the bill is a duplicate in the very next drawing, not only after a full one: %s" % (r,))
        ok(not errs, "no page errors (%s)" % errs[:2])
        await ctx.close(); await br.close()
    srv.shutdown()
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
