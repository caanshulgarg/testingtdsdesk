"""python3 run_tcloud_ui.py - FinCom on a computer without the bridge, with the copy of the books in FinCom's cloud (a
stand-in for the cloud answers here): the books come in from the cloud, only changed days are fetched again, a large
company is answered from the cloud's ready totals, and Settings shows the computers and links companies."""
import json, os, re, sys, gzip, html, threading, functools, http.server
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_tally, books_data
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8146), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
STAGE = "https://qbocskaiewaxqcvaunzc.supabase.co"
CO = fake_tally.COMPANY
DAYS = ["202603%02d" % d for d in range(1, 32)]
by_day = {d: "".join(p for dd, p in fake_tally.V if dd == d) for d in DAYS}
AT = {d: "2026-09-28T10:00:00+00:00" for d in DAYS}
mv0 = fake_tally.amounts_until("20260228")
LED = [{"name": html.unescape(n), "parent": html.unescape(p), "open": round(ob + mv0.get(n.replace("&amp;", "&"), mv0.get(n, 0)), 2)} for n, p, ob in fake_tally.L]
ST = {"entries": 1094}
calls = {"storage": [], "link": [], "tb": 0, "balances": 0, "ledger": 0, "create": 0}
def status():
    return [{"book": "b1", "company": CO, "from": "2026-03-01", "openAsOn": "2026-02-28", "ledgersAt": "2026-09-28T09:00:00Z", "daysAt": "2026-09-28T10:00:00Z",
             "state": {"phase": "live", "seen": "2026-09-28T15:40:00", "computer": "OFFICE-PC", "skipped": ["20260318"], "queue": 0}, "days": 31, "entries": ST["entries"], "to": "2026-03-31"}]
def tb(as_on):
    mv = fake_tally.amounts_until(as_on)
    return [{"ledger": l["name"], "parent": l["parent"], "open": l["open"], "movement": 0, "closing": round(ob + mv.get(n.replace("&amp;", "&"), mv.get(n, 0)), 2)} for (n, p, ob), l in zip(fake_tally.L, LED)]
def route(r):
    u = urlparse(r.request.url); path = u.path
    body = r.request.post_data or ""
    j = lambda o, code=200: r.fulfill(status=code, content_type="application/json", body=json.dumps(o))
    if path.endswith("/rpc/tally_status"): return j(status())
    if path.endswith("/rpc/tally_days_list"): return j([{"day": d, "n": len(re.findall(r"<VOUCHER\b", by_day[d])), "at": AT[d]} for d in DAYS])
    if "/storage/v1/object/authenticated/tally-days/" in path:
        d = path.rsplit("/", 1)[1][:8]; calls["storage"].append(d)
        return r.fulfill(status=200, content_type="application/gzip", body=gzip.compress(by_day[d].encode("utf-8")))
    if path.endswith("/tally_balances"):
        # the view tally_balances (migration-32): each ledger's opening on the book's first day and its closing after the
        # last day the copy holds (Tally's signs), read by the app for every balance from FinCom's copy since d995185
        calls["balances"] += 1; q = parse_qs(u.query); off = int((q.get("offset") or ["0"])[0]); lim = int((q.get("limit") or ["1000"])[0])
        last = status()[0]["to"]; rows = [{"ledger": r["ledger"], "parent": r["parent"], "open": r["open"], "closing": r["closing"], "last_day": last} for r in tb(last.replace("-", ""))]
        return j(rows[off:off + lim])
    if path.endswith("/tally_ledgers"):
        # migration-32: no ledger here is deleted in Tally (deleted_at=not.is.null asks for those)
        q = parse_qs(u.query); off = int((q.get("offset") or ["0"])[0])
        if (q.get("deleted_at") or [""])[0] == "not.is.null": return j([])
        return j(LED[off:off + 1000])
    if path.endswith("/rpc/tally_tb"):
        calls["tb"] += 1; q = parse_qs(u.query); off = int((q.get("offset") or ["0"])[0])
        return j(tb(json.loads(body)["p_as_on"].replace("-", ""))[off:off + 1000])
    if path.endswith("/rpc/tally_ledger"):
        calls["ledger"] += 1; a = json.loads(body); led = a["p_ledger"]; f = a["p_from"].replace("-", ""); t = a["p_to"].replace("-", "")
        mv = fake_tally.amounts_until(str(int(f) - 1)); ob = [l["open"] for l in LED if l["name"] == led][0]
        # opening at the day before: the open on 28 Feb plus March's movement before the period
        raw = [n for n, p, o in fake_tally.L if html.unescape(n) == led][0]
        mv28 = fake_tally.amounts_until("20260228")
        opn = round(ob + mv.get(raw.replace("&amp;", "&"), mv.get(raw, 0)) - mv28.get(raw.replace("&amp;", "&"), mv28.get(raw, 0)), 2)
        lines = []
        for d, pc in fake_tally.V:
            if not (f <= d <= t): continue
            for m in re.finditer(r"<LEDGERNAME>([^<]*)</LEDGERNAME>.*?<AMOUNT>(-?[\d.]+)</AMOUNT>", pc, re.S):
                if html.unescape(m.group(1)) == led: lines.append([d, "Journal", "", "", "", float(m.group(2)), re.search(r"<GUID>([^<]*)</GUID>", pc).group(1)])
        return j({"open": opn, "lines": lines, "from": "2026-03-01", "company": CO})
    if path.endswith("/rpc/tally_period"):
        a = json.loads(body); f = a["p_from"].replace("-", ""); t = a["p_to"].replace("-", ""); calls["period"] = calls.get("period", 0) + 1
        before = fake_tally.amounts_until(str(int(f) - 1)); mv28 = fake_tally.amounts_until("20260228"); drcr = {}
        for d, pc in fake_tally.V:
            if f <= d <= t:
                for m in re.finditer(r"<LEDGERNAME>([^<]*)</LEDGERNAME>.*?<AMOUNT>(-?[\d.]+)</AMOUNT>", pc, re.S):
                    n = html.unescape(m.group(1)); x = drcr.setdefault(n, [0.0, 0.0]); v = float(m.group(2))
                    if v < 0: x[0] += -v
                    else: x[1] += v
        out = []
        for (n, par, ob), l in zip(fake_tally.L, LED):
            k = n.replace("&amp;", "&"); o = l["open"] + before.get(k, before.get(n, 0)) - mv28.get(k, mv28.get(n, 0))
            dc = drcr.get(html.unescape(n), [0, 0]); out.append({"ledger": l["name"], "parent": l["parent"], "open": -round(o, 2), "dr": round(dc[0], 2), "cr": round(dc[1], 2)})
        q = parse_qs(u.query); off = int((q.get("offset") or ["0"])[0]); return j(out[off:off + 1000])
    if path.endswith("/rpc/tally_monthly"):
        a = json.loads(body); f = a["p_from"].replace("-", ""); t = a["p_to"].replace("-", ""); m = {}
        for d, pc in fake_tally.V:
            if f <= d <= t:
                for g in re.finditer(r"<LEDGERNAME>([^<]*)</LEDGERNAME>.*?<AMOUNT>(-?[\d.]+)</AMOUNT>", pc, re.S):
                    k = (html.unescape(g.group(1)), d[:6]); x = m.setdefault(k, [0.0, 0.0]); v = float(g.group(2))
                    if v < 0: x[0] += -v
                    else: x[1] += v
        out = [{"ledger": k[0], "ym": k[1], "amount": round(v[1] - v[0], 2), "dr": round(v[0], 2), "cr": round(v[1], 2)} for k, v in sorted(m.items())]
        q = parse_qs(u.query); off = int((q.get("offset") or ["0"])[0]); return j(out[off:off + 1000])
    if path.endswith("/rpc/tally_find"):
        a = json.loads(body); f = a["p_from"].replace("-", ""); t = a["p_to"].replace("-", ""); w = (a["p_q"] or "").lower().split(); calls["find"] = calls.get("find", 0) + 1
        hits = []
        for d, pc in fake_tally.V:
            hay = " ".join(html.unescape(m) for m in re.findall(r"<(?:LEDGERNAME|NARRATION|PARTYLEDGERNAME|PARTYNAME|VOUCHERNUMBER|REFERENCE)>([^<]*)<", pc)).lower() + " " + (re.search(r'VCHTYPE="([^"]*)"', pc) or [0, ""])[1].lower()
            if not (f <= d <= t) or not all(x in hay for x in w): continue
            ent = [[html.unescape(m.group(1)), float(m.group(2))] for m in re.finditer(r"<LEDGERNAME>([^<]*)</LEDGERNAME>.*?<AMOUNT>(-?[\d.]+)</AMOUNT>", pc, re.S)]
            hits.append([d, "Journal", "", "", "", round(sum(v for l, v in ent if v > 0), 2), re.search(r"<GUID>([^<]*)</GUID>", pc).group(1), ent])
        off = a["p_offset"] or 0
        return j({"n": len(hits), "total": round(sum(h[5] for h in hits), 2), "rows": hits[off:off + a["p_limit"]]})
    if path.endswith("/tally_devices"): return j([{"id": "d1", "name": "OFFICE-PC", "created_at": "2026-09-28T09:00:00Z", "last_seen": "2026-09-28T10:05:00Z", "version": "1.13.0", "info": {"computer": "OFFICE-PC", "user": "accounts"}, "revoked": False}])
    if path.endswith("/tally_companies"): return j([{"company": CO, "client_id": None, "gstin": books_data.GSTIN, "last_seen": "2026-09-28T10:05:00Z", "linked_at": None}, {"company": "SOMEONE ELSE PVT LTD", "client_id": None, "gstin": "", "last_seen": None, "linked_at": None}])
    if path.endswith("/rpc/tally_company_link"): calls["link"].append(json.loads(body)); return r.fulfill(status=204, body="")
    if path.endswith("/rpc/tally_device_create"): calls["create"] += 1; return j({"id": "d2", "key": "fcd_" + "b" * 48})
    return j([])
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
def wait_for(pg, js, t=60):
    import time; s = time.time()
    while time.time() - s < t:
        try:
            if pg.evaluate("() => { try { return !!(" + js + "); } catch (e) { return false; } }"): return True
        except Exception: pass
        time.sleep(0.3)
    return False
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000})
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route(STAGE + "/**", route)
    pg.goto("http://localhost:8146/"); pg.wait_for_timeout(2000)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate("""([name, gstin]) => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600}); Cloud.st.firm = "f1"; Cloud.st.state = "on";
      const c = newCompany({name, gstin}); c.id = "c_vms"; c.tallyName = name; S.companies[c.id] = c; S.coId = c.id; S.view = "company";
      S.data[c.id] = {parties: {}, entries: {}, loaded: true};
      S.books = {cid: c.id, loading: false, vouchers: [], meta: {}, map: {}, challans: [], alloc: {}}; S.tab = "books"; S.booksTab = "lookup"; render(); }""", [CO, books_data.GSTIN])
    pg.evaluate("LK.autoFresh(true)")
    ok(wait_for(pg, "S.books.meta.cloud && S.books.vouchers.length > 0 && !S.lkFr.busy", 90), "with no bridge on this computer, the books come in from FinCom's cloud")
    got = pg.evaluate("S.books.vouchers.filter(v => v.date.startsWith('202603')).length")
    own = pg.evaluate("async (x) => (await Books.importDayBook(new Blob([x], {type: 'text/xml'}))).vouchers.length", "<ENVELOPE>" + "".join(by_day[d] for d in DAYS) + "</ENVELOPE>")
    raw = sum(len(re.findall(r"<VOUCHER\b", by_day[d])) for d in DAYS)
    ok(got == own and own > 0 and (own == raw if books_data.FIXTURE else got > 1000), "every March entry, as FinCom reads them: %d of %d" % (got, own) + " (%d in the day files)" % raw)
    ok(len(calls["storage"]) == 31, "each day fetched once: %d" % len(calls["storage"]))
    bar = pg.inner_text(".lk-fresh")
    ok("Books" in bar and "cloud" not in bar.lower() and "OFFICE-PC" not in bar and "1 day not read from Tally yet (18-Mar-2026)" in bar, "the page says how up to date the books are (no talk of the cloud), and a day not read yet: " + bar[:180].replace("\n", " "))
    # ---------- a day changed: only that day is fetched again
    AT["20260310"] = "2026-09-28T11:00:00+00:00"; n0 = len(calls["storage"])
    pg.evaluate("TCloud.st = {}; LK.fr().cat = 0; LK.autoFresh(true)"); wait_for(pg, "!S.lkFr.busy && S.books.meta.cloud.days['20260310'] === '2026-09-28T11:00:00+00:00'", 60)
    ok(calls["storage"][n0:] == ["20260310"], "a day that changed is the only one fetched again: " + ", ".join(calls["storage"][n0:]))
    ok(pg.evaluate("S.books.vouchers.filter(v => v.date.startsWith('202603')).length") == own, "and nothing is lost or doubled")
    # ---------- the trial balance from the loaded copy: Tally is not asked
    pg.fill("#lkAsk", "trial balance as on 31/03/2026"); pg.keyboard.press("Enter")
    wait_for(pg, "S.lk.res && S.lk.res.kind === 'tb' && !S.lk.busy")
    ok(pg.evaluate("S.lk.res.src") == "cloud" and calls["balances"] >= 1, "build 192: the trial balance is worked out by the cloud (its view tally_balances), even with the books here")
    tb_cloud = pg.evaluate("[S.lk.res.dr, S.lk.res.cr]")
    pg.evaluate("LK.run('books')"); wait_for(pg, "S.lk.res && S.lk.res.src === 'books' && !S.lk.busy")
    tb_books = pg.evaluate("[S.lk.res.dr, S.lk.res.cr]")
    ok(tb_books[0] > 0, "the books here can still be asked for it (%s)" % (tb_books,))
    ok(all(abs((tb_cloud[i] or 0) - tb_books[i]) < 1 for i in (0, 1)), "and the cloud's trial balance is the same as the books' here: %s against %s" % (tb_cloud, tb_books))
    # a group, month by month, and found entries: from the cloud, the same as from the books here
    # the group of the ledger most used in March (one with entries in the period, so the totals compared are not all 0)
    from collections import Counter
    subs = pg.evaluate("S.lk.res.groups.map(g => g.rows).flat().map(r => r.sub).filter(Boolean)")
    use0 = Counter(html.unescape(n) for d in DAYS for n in re.findall(r"<LEDGERNAME>([^<]*)</LEDGERNAME>", by_day[d]))
    grp = next((l["parent"] for n, c in use0.most_common() for l in LED if l["name"] == n and l["parent"] in subs), subs[0])
    for kind, setup in [("group", "x.kind = 'group'; x.grp = %s;" % json.dumps(grp)), ("monthly", "x.kind = 'monthly'; x.grp = %s; x.led = '';" % json.dumps(grp)), ("find", "x.kind = 'find'; x.q = 'bank';")]:
        pg.evaluate("() => { const x = LK.st(); " + setup + " x.from = '20260301'; x.to = '20260331'; x.res = null; LK.run(); }")
        wait_for(pg, "S.lk.res && S.lk.res.kind === '%s' && !S.lk.busy" % kind)
        c = pg.evaluate("({src: S.lk.res.src, n: S.lk.res.n || S.lk.res.rows.length, dr: S.lk.res.dr, cr: S.lk.res.cr, total: S.lk.res.total})")
        pg.evaluate("LK.run('books')"); wait_for(pg, "S.lk.res && S.lk.res.src === 'books' && !S.lk.busy")
        bk = pg.evaluate("({src: S.lk.res.src, n: S.lk.res.rows.length, dr: S.lk.res.dr, cr: S.lk.res.cr, total: S.lk.res.total})")
        # (the stand-in cloud reads the entries more roughly than FinCom does, so for found entries only the count is compared)
        same = c["n"] == bk["n"] and all(abs((c[k] or 0) - (bk[k] or 0)) < 1 for k in (("dr", "cr") if kind != "find" else ()))
        ok(c["src"] == "cloud" and same, "%s: from the cloud, and the same as from the books here: %s against %s" % (kind, json.dumps(c), json.dumps(bk)))
    # ---------- a large company: not loaded; its trial balance and ledger come from the cloud's ready totals
    ST["entries"] = 250000; n1 = len(calls["storage"]); nb = calls["balances"]
    pg.evaluate("S.books = {cid: 'c_vms', loading: false, vouchers: [], meta: {}, map: {}, challans: [], alloc: {}}; TCloud.st = {}; LK.fr().cat = 0; S.lk = null; render(); LK.autoFresh(true)")
    wait_for(pg, "TCloud.big('c_vms') && !S.lkFr.busy", 30)
    ok(len(calls["storage"]) == n1 and pg.evaluate("S.books.vouchers.length") == 0, "a company of 2.5 lakh entries is not downloaded to this computer")
    pg.fill("#lkAsk", "trial balance as on 31/03/2026"); pg.keyboard.press("Enter")
    wait_for(pg, "S.lk.res && S.lk.res.kind === 'tb' && !S.lk.busy")
    r = pg.evaluate("({src: S.lk.res.src, n: S.lk.res.rows.length})")
    # every ledger with a balance on the day (the real client's books: more than 500 of them)
    want = len([x for x in tb("20260331") if abs(x["closing"]) >= 0.005])
    ok(r["src"] == "cloud" and r["n"] == want and (books_data.FIXTURE or r["n"] > 500) and calls["balances"] > nb, "its trial balance comes from the cloud's ready totals, all %d ledgers with a balance (%d)" % (r["n"], want))
    from collections import Counter
    use = Counter(html.unescape(n) for d in DAYS for n in re.findall(r"<LEDGERNAME>([^<]*)</LEDGERNAME>", by_day[d]))
    led = [n for n, c in use.most_common() if "&" not in n][0]
    pg.evaluate("(l) => { const x = LK.st(); x.kind = 'ledger'; x.led = l; x.from = '20260301'; x.to = '20260331'; LK.run(); }", led)
    wait_for(pg, "S.lk.res && S.lk.res.kind === 'ledger' && !S.lk.busy")
    r = pg.evaluate("({src: S.lk.res.src, n: S.lk.res.rows.length, open: S.lk.res.open})")
    ok(r["src"] == "cloud" and r["n"] > 0 and calls["ledger"] == 1, "and a ledger for any dates, from the cloud: %s, %d lines" % (led, r["n"]))
    # ---------- Settings: the computers, and linking a company to a client
    pg.evaluate("S.view = 'home'; S.homeTab = 'rules'; S.settingsTab = 'tcloud'; render();")
    wait_for(pg, "TCloud.pane.devices && TCloud.pane.companies", 20); pg.evaluate("render()"); pg.wait_for_timeout(300)
    t = pg.inner_text("#app")
    ok("OFFICE-PC" in t and CO in t and "Nothing to press" in t and "Connect this computer" not in t, "Settings shows the computers that send and the companies seen; no button to connect")
    calls["link"].clear(); pg.select_option('select[aria-label="Client for ' + CO + '"]', "c_vms"); pg.wait_for_timeout(1200)
    ok(calls["link"] and calls["link"][-1] == {"p_company": CO, "p_client": "c_vms"}, "a company is linked to the client chosen: " + json.dumps(calls["link"][-1:]))
    # ---------- the computer with Tally connects itself, and links the open client's company, with nothing pressed
    calls["link"].clear()
    r = pg.evaluate("""async (co) => { const got = []; let linked = false;
      Object.assign(Bridge, {on: () => true, up: () => true, openFor: () => ({name: co}), call: async (path, body) => { got.push([path, body]); if (body) linked = true; return {ok: true, connected: linked, url: linked ? TCloud.ingestUrl() : ""}; }});
      Bridge.st.computer = "ACCOUNTS-PC"; TCloud.autoAt = 0; await TCloud.auto(); TCloud.autoAt = 0; await TCloud.auto(); return got; }""", CO)
    posts = [b for pth, b in r if b]
    ok(calls["create"] == 1 and len(posts) == 1 and posts[0]["key"].startswith("fcd_") and posts[0]["url"].endswith("/functions/v1/tally-ingest"), "the computer is connected by itself, once (%d keys made)" % calls["create"])
    ok(calls["link"] and calls["link"][0] == {"p_company": CO, "p_client": "c_vms"}, "and the open client's Tally company is linked to it: " + json.dumps(calls["link"][:1]))
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0][:300]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED")
sys.exit(1 if fails else 0)
