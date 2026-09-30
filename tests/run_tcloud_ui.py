"""python3 run_tcloud_ui.py - FinCom on a computer without the bridge, with the copy of the books in FinCom's cloud (a
stand-in for the cloud answers here): the books come in from the cloud, only changed days are fetched again, a large
company is answered from the cloud's ready totals, and Settings shows the computers and links companies."""
import json, os, re, sys, gzip, html, threading, functools, http.server
from urllib.parse import urlparse, parse_qs
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import fake_tally
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
calls = {"storage": [], "link": [], "tb": 0, "ledger": 0, "create": 0}
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
    if path.endswith("/tally_ledgers"):
        q = parse_qs(u.query); off = int((q.get("offset") or ["0"])[0]); return j(LED[off:off + 1000])
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
    if path.endswith("/tally_devices"): return j([{"id": "d1", "name": "OFFICE-PC", "created_at": "2026-09-28T09:00:00Z", "last_seen": "2026-09-28T10:05:00Z", "version": "1.13.0", "info": {"computer": "OFFICE-PC", "user": "accounts"}, "revoked": False}])
    if path.endswith("/tally_companies"): return j([{"company": CO, "client_id": None, "gstin": "07AADCV3366N1ZU", "last_seen": "2026-09-28T10:05:00Z", "linked_at": None}, {"company": "SOMEONE ELSE PVT LTD", "client_id": None, "gstin": "", "last_seen": None, "linked_at": None}])
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
    pg.evaluate("""(name) => { Cloud.setSess({access_token: "t", refresh_token: "r", at: Date.now(), expires_in: 3600}); Cloud.st.firm = "f1"; Cloud.st.state = "on";
      const c = newCompany({name, gstin: "07AADCV3366N1ZU"}); c.id = "c_vms"; c.tallyName = name; S.companies[c.id] = c; S.coId = c.id; S.view = "company";
      S.data[c.id] = {parties: {}, entries: {}, loaded: true};
      S.books = {cid: c.id, loading: false, vouchers: [], meta: {}, map: {}, challans: [], alloc: {}}; S.tab = "books"; S.booksTab = "lookup"; render(); }""", CO)
    pg.evaluate("LK.autoFresh(true)")
    ok(wait_for(pg, "S.books.meta.cloud && S.books.vouchers.length > 0 && !S.lkFr.busy", 90), "with no bridge on this computer, the books come in from FinCom's cloud")
    got = pg.evaluate("S.books.vouchers.filter(v => v.date.startsWith('202603')).length")
    own = pg.evaluate("async (x) => (await Books.importDayBook(new Blob([x], {type: 'text/xml'}))).vouchers.length", "<ENVELOPE>" + "".join(by_day[d] for d in DAYS) + "</ENVELOPE>")
    ok(got == own and got > 1000, "every March entry, as FinCom reads them: %d of %d" % (got, own))
    ok(len(calls["storage"]) == 31, "each day fetched once: %d" % len(calls["storage"]))
    bar = pg.inner_text(".lk-fresh")
    ok("The books" in bar and "cloud" not in bar.lower() and "OFFICE-PC" not in bar and "not read yet" in bar, "the page says how up to date the books are (no talk of the cloud), and a day not read yet: " + bar[:180].replace("\n", " "))
    # ---------- a day changed: only that day is fetched again
    AT["20260310"] = "2026-09-28T11:00:00+00:00"; n0 = len(calls["storage"])
    pg.evaluate("TCloud.st = {}; LK.fr().cat = 0; LK.autoFresh(true)"); wait_for(pg, "!S.lkFr.busy && S.books.meta.cloud.days['20260310'] === '2026-09-28T11:00:00+00:00'", 60)
    ok(calls["storage"][n0:] == ["20260310"], "a day that changed is the only one fetched again: " + ", ".join(calls["storage"][n0:]))
    ok(pg.evaluate("S.books.vouchers.filter(v => v.date.startsWith('202603')).length") == own, "and nothing is lost or doubled")
    # ---------- the trial balance from the loaded copy: Tally is not asked
    pg.fill("#lkAsk", "trial balance as on 31/03/2026"); pg.keyboard.press("Enter")
    wait_for(pg, "S.lk.res && S.lk.res.kind === 'tb' && !S.lk.busy")
    ok(pg.evaluate("S.lk.res.src") == "books" and calls["tb"] == 0, "the trial balance comes from the books brought in (the cloud's totals are not needed)")
    # ---------- a large company: not loaded; its trial balance and ledger come from the cloud's ready totals
    ST["entries"] = 250000; n1 = len(calls["storage"])
    pg.evaluate("S.books = {cid: 'c_vms', loading: false, vouchers: [], meta: {}, map: {}, challans: [], alloc: {}}; TCloud.st = {}; LK.fr().cat = 0; S.lk = null; render(); LK.autoFresh(true)")
    wait_for(pg, "TCloud.big('c_vms') && !S.lkFr.busy", 30)
    ok(len(calls["storage"]) == n1 and pg.evaluate("S.books.vouchers.length") == 0, "a company of 2.5 lakh entries is not downloaded to this computer")
    pg.fill("#lkAsk", "trial balance as on 31/03/2026"); pg.keyboard.press("Enter")
    wait_for(pg, "S.lk.res && S.lk.res.kind === 'tb' && !S.lk.busy")
    r = pg.evaluate("({src: S.lk.res.src, n: S.lk.res.rows.length})")
    ok(r["src"] == "cloud" and r["n"] > 500 and calls["tb"] >= 1, "its trial balance comes from the cloud's ready totals, all %d ledgers (more than one page of answers)" % r["n"])
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
    pg.select_option('select[data-tclink="' + CO + '"]', "c_vms"); pg.wait_for_timeout(1200)
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
