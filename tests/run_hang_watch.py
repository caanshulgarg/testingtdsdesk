"""python3 run_hang_watch.py - next-hang-watch (04-Nov-2026; the owner: "still it is not working.. showing page irresponsive"
and "while tally is open still system is not recognising the tally"). Made-up firm, ledgers, computers and bridges only.
  1. A client with 2,500 ledgers (staging's largest has 2,455): opening it matches the default ledgers (autoMapCompanyLedgers)
     with each ledger checked once, not once per GST head and TDS section (about 80,000 checks blocked the page about a second
     on a fast computer, several on the shared server); the same choices as before; a ledger's group chain no longer merges
     the groups and builds their index again at each call (Ledgers.parentsOf: the same object while nothing changed).
  2. The Tally page, by what this browser finds on 127.0.0.1 (the look of bridge 2.5.3):
     a. this login's 2.5.3 bridge (sameSession true), a company open there that no client has: at the top "Open in your
        Tally now: “<company>”, not linked yet" with Link to a client; the bridge is remembered in this browser;
     b. this login's bridge is 2.5.1 (it says it is this Windows user's, nothing of the session): the row and the top box
        "Your FinCom Bridge is old (2.5.1). Install 2.5.4 to connect this login’s Tally." and Download FinCom Bridge;
     c. only other logins' bridges answer (2.5.3 saying false, older ones not this user's): "FinCom Bridge is not running in
        this Windows login: start it, or install it.";
     d. nothing answers at all (the browser may not let the page reach this computer): the same, and choose Allow;
     e. nothing answers, the bridge was found here before: its beat from FinCom's cloud, said so, the company still shown;
     f. a linked client whose Tally runs in another Windows login (the beat: "Tally of <user>", another user): "<client>’s
        Tally is open in another Windows login (<user>), not in this login’s. …"; never a silent "Not open".
  3. The hang reporter (src/hangWatch.js, in the Sentry chunk): a 2.5 s block sends one warning "Page blocked" (kind hang,
     where frame, the page's name, the build, the long frame's script); a second block within 10 minutes sends nothing;
     a page stuck 9 s is reported by the worker while it is stuck (where stall).
  4. (next-tally-table) a hidden page stuck 9 s (a tab in the background: its timers held back) sends nothing; seen again,
     a 2.5 s block sends one warning with vis seen, the last click's code name and the seconds since.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_hang_watch.py"""
import os, sys, json, time, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import run_tally_page_clean as T
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_WATCH_PORT", "9547"))   # (another run may hold 9547)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
LATEST = {"setup": {"version": "2.5.3", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.5.3.exe", "sha256": "ab" * 32}}
# made-up ledgers: the taxes of a client, and 2,500 others under 14 groups
LEDGERS = """(n) => {
  const groups = ['Sundry Creditors', 'Sundry Debtors', 'Bank Accounts', 'Indirect Expenses', 'Direct Expenses', 'Sales Accounts', 'Purchase Accounts', 'Current Liabilities', 'Fixed Assets', 'Provisions'];
  const list = [], parents = {'Duties & Taxes': 'Current Liabilities'};
  for (let i = 0; i < 90; i++) { parents['Group ' + i] = groups[i % groups.length]; }
  groups.forEach((g) => { parents[g] = 'Primary'; });
  [['Input CGST', 'Duties & Taxes'], ['Input SGST', 'Duties & Taxes'], ['Input IGST', 'Duties & Taxes'], ['TDS on Rent 194I', 'Duties & Taxes'], ['TDS on Contract 194C', 'Duties & Taxes'],
   ['TDS on Professional Fees 194J', 'Duties & Taxes'], ['Round Off', 'Indirect Expenses']].forEach(([name, group]) => list.push({name, group}));
  for (let i = 0; i < n; i++) list.push({name: 'Made-up Ledger ' + i + (i % 7 ? ' Traders' : ' Services'), group: i % 3 ? 'Group ' + (i % 90) : groups[i % groups.length]});
  return {list, parents};
}"""
def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(T.Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def page(init=None):
            pg = br.new_page(viewport={"width": 1440, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
            if init: pg.add_init_script(init)
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
            pg.route("http://127.0.0.1:*/**", lambda r: r.abort("connectionrefused"))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })")
            pg.wait_for_timeout(800)
            return pg

        print("1. a client with 2,500 ledgers: the default ledgers matched with each ledger checked once")
        pg = page()
        r = pg.evaluate("""(mk) => {
          const L = (new Function('return ' + mk))()(2500);
          const co = newCompany({name: 'Made-up Big Client', gstin: ''}); S.companies[co.id] = co; S.data[co.id] = {parties: {}, entries: {}, loaded: true}; co.stats = {};
          S.coId = co.id; S.view = 'company'; S.tab = 'dash';
          Ledgers.st[co.id] = {list: L.list, parents: L.parents, at: new Date().toISOString(), src: 'cloud'}; Ledgers.ver++;
          const n = {gst: 0, tds: 0}, g0 = window.gstLedgerCheck, t0 = window.tdsLedgerCheck;
          window.gstLedgerCheck = function(){ n.gst++; return g0.apply(this, arguments); };
          window.tdsLedgerCheck = function(){ n.tds++; return t0.apply(this, arguments); };
          const a = performance.now(), changes = autoMapCompanyLedgers(co), ms = performance.now() - a;
          window.gstLedgerCheck = g0; window.tdsLedgerCheck = t0;
          const once = {}; ['Input CGST', 'Made-up Ledger 5 Traders', 'Made-up Ledger 6 Services'].forEach((x) => { once[x] = Ledgers.chain(co.id, x).join(' > '); });
          const same = typeof Ledgers.parentsOf === 'function' && Ledgers.parentsOf(co.id, L.parents, null, null) === Ledgers.parentsOf(co.id, L.parents, null, null);
          const c0 = performance.now(); L.list.forEach((l) => Ledgers.cls(co.id, l.name)); const clsMs = performance.now() - c0;
          return {ms: Math.round(ms), n, changes: changes.map((c) => c.role + ':' + c.to).sort(), once, same, clsMs: Math.round(clsMs)};
        }""", LEDGERS)
        print("     ", json.dumps(r)[:600])
        ok(r["n"]["tds"] <= 40, "TDS: each section's ledger found from one pass (tdsLedgerCheck %d times; was about 2 per rule per ledger)" % r["n"]["tds"])
        ok(r["n"]["gst"] <= 200, "GST: only the ledgers with GST in them checked per head (gstLedgerCheck %d times; was 9 or more per ledger)" % r["n"]["gst"])
        # (what afd9ce616 / 827a77255 chose for these ledgers, worked out the slow way: the same)
        want = ["tds:TDS on Contract 194C", "tds:TDS on Professional Fees 194J", "tds:TDS on Professional Fees 194J", "tds:TDS on Professional Fees 194J", "tds:TDS on Rent 194I", "tds:TDS on Rent 194I"]
        ok(r["changes"] == want, "the same choices as before: each TDS section's own ledger (%s)" % r["changes"])
        ok(r["once"]["Input CGST"].startswith("Duties & Taxes > Current Liabilities") and "Group 5" in r["once"]["Made-up Ledger 5 Traders"], "group chains as before (%s)" % r["once"])
        ok(r["same"], "the groups' parents merged once while nothing changed (Ledgers.parentsOf: the same object)")
        ok(r["ms"] < 600, "opening the client's matching under 600 ms here (%d ms); every ledger's class %d ms" % (r["ms"], r["clsMs"]))
        pg.close()

        if os.environ.get("ONLY") == "1": br.close(); print("FAILED" if fails else "PASSED"); return
        print("2. the Tally page by what this browser finds on 127.0.0.1")
        pg = page()
        E = lambda js, *a: pg.evaluate(js, *a)
        UOWN, UOTHER = "PC1\\usera", "PC1\\epsilonx"
        OPEN = "ALPHAPAY MADE-UP PRIVATE LIMITED"
        ports = [{"port": 1318, "ok": True, "skipped": False, "n": 1, "error": "", "reason": "open"},
                 {"port": 601, "ok": False, "skipped": True, "n": 0, "error": "Tally of epsilonx", "reason": "another user"}]
        da = T.dev(1, "PC1", UOWN, opened=(OPEN,), version="2.5.3", beat={"bridgePort": 9103, "windowsUser": UOWN, "ports": ports}, rec=(OPEN,), ports=ports)
        clients = ["GB TEXCOAT", "EPSILON X DESIGNS"]
        cos = [{"company": "GB TEXCOAT", "client_id": "NAME:GB TEXCOAT", "device_id": da["id"], "gstin": "", "last_seen": "ago:1"},
               {"company": "EPSILON X DESIGNS - (from 1-Apr-25)", "client_id": "NAME:EPSILON X DESIGNS", "device_id": da["id"], "gstin": "", "last_seen": "ago:900"},
               {"company": OPEN, "client_id": None, "device_id": da["id"], "gstin": "", "last_seen": "ago:1"}]
        E(T.SETUP, [[da], cos, [], "owner", clients, True, {}]); pg.wait_for_timeout(1500)
        def look(list_):
            E("""(list) => { const L = FCTallySimple.LOCALB; Object.assign(L, {list, busy: false, n: L.n + 1, sig: 'x' + Date.now()}); render(); }""", list_); pg.wait_for_timeout(900)
        # next-tally-page-redesign: the steps are folded while connected (a laptop: "Connect Tally on this computer"), a row's
        # "Open in Tally right now?" is in its Details: first what shows folded, then the steps and every row's details opened
        def folded():
            return E("""(co) => { const q = (s) => document.querySelector(s); S.tsm = {filter: 'all', q: '', open: false, again: 0, check: 0}; S.tallyGuide = {}; render();
              return new Promise((r) => setTimeout(() => r({guide: document.querySelectorAll('#app [data-tsm-guide]').length, link: (q('#app [data-tsm-steps-link]') || {}).getAttribute ? q('#app [data-tsm-steps-link]').getAttribute('data-tsm-steps-link') : null,
                coMain: ((q('#app [data-tsm-row="' + co + '"] [data-tpt-main]') || {}).innerText || '').trim()}), 700)); }""", OPEN)
        def words():
            E("() => { S.tsm = {filter: 'all', q: '', open: true, again: 0, check: 0, details: 'all'}; render(); }"); pg.wait_for_timeout(900)
            return E("""() => { const t = (s) => [...document.querySelectorAll(s)].map(e => e.innerText.replace(/\\s+/g, ' ').trim());
              const row = (n) => { const r = document.querySelector('#app [data-tsm-row="' + n + '"] [data-tsm-col=o]'); return r ? r.innerText.replace(/\\s+/g, ' ').trim() : ''; };
              const tsm = document.querySelector('#app [data-tally-simple]') || {dataset: {}};
              return {own: tsm.dataset.tsmOwn || '', how: tsm.dataset.tsmOwnHow || '', strip: t('#app [data-tsm-strip]').join(' | '), say: [(t('#app [data-tsm-now]').join(' | ') || t('#app [data-tsm-laptop-here]').join(' | ').replace(/^If TallyPrime runs on this computer, F/, 'F')).replace(/^Step \\d: /, ''), t('#app [data-tsm-bridge-say]').join(' | ')].filter(Boolean).join(' | '),
                gb: row('GB TEXCOAT'), eps: row('EPSILON X DESIGNS'), dl: document.querySelectorAll('#app [data-tsm-o-say] a[download], #app [data-tsm-guide] .tsm-now-act a[download]').length,
                step5: (document.querySelector('#app [data-tsm-guide="5"] [data-tsm-now]') || {innerText: ''}).innerText}; }""")
        mine = {"ok": True, "bridge": "FinCom Tally Bridge", "version": "2.5.3", "impl": "go", "yours": True, "windowsUser": UOWN, "bridgePort": 9103, "port": 9103, "bridgeId": "go-1", "sameSession": True}
        other253 = {"ok": True, "bridge": "FinCom Tally Bridge", "version": "2.5.3", "impl": "go", "yours": False, "windowsUser": "PC1\\userb", "bridgePort": 9100, "sameSession": False}
        other251 = {"ok": True, "bridge": "FinCom Tally Bridge", "version": "2.5.1", "impl": "go", "yours": False, "port": 9101}
        own251 = {"ok": True, "bridge": "FinCom Tally Bridge", "version": "2.5.1", "impl": "go", "yours": True, "bridgeId": "go-9", "port": 9104}
        E("() => { try { localStorage.removeItem(LocalOwner.P + 'ownbridge'); } catch (e) {} }")
        look([mine, other253, other251]); f = folded(); w = words(); print("      a.", f, w)
        ok(f["guide"] == 0 and f["link"] == "" and f["coMain"] == "Link", "a. connected: the steps folded behind See the 6 steps; the company no client has, its row's Link (%s)" % f)
        ok(w["own"] == "ok" and w["how"] == "found", "a. this login's 2.5.3 bridge found (sameSession true)")
        # next-tally-connect-steps: the first company to link is Connect Tally's step 5 (the strip is for the ones after it)
        # (nothing linked yet: the company is Connect Tally's step 5, the strip only for the ones after it)
        ok(w["step5"].startswith("Step 5: “%s” is open in your Tally." % OPEN) and not w["strip"],
           "a. the steps opened: Connect Tally's step 5, “…” is open in your Tally, Link (%s | %s)" % (w["strip"], w["step5"]))
        ok(E("() => !!FCTallySimple.rememberedOwn()"), "a. this login's bridge remembered in this browser")
        ok(w["eps"].startswith("No EPSILON X DESIGNS’s Tally is open in another Windows login (epsilonx), not in this login’s. Open it in this login, or install FinCom Bridge in the epsilonx login."),
           "f. a linked client whose Tally runs in another login: said so, by that login's name (%s)" % w["eps"][:160])
        E("() => { try { localStorage.removeItem(LocalOwner.P + 'ownbridge'); } catch (e) {} }")
        look([own251, other253]); f = folded(); w = words(); print("      b.", f, w)
        OLD = "Your FinCom Bridge is old (2.5.1). Install 2.5.4 to connect this login’s Tally."
        ok(w["own"] == "none" and w["gb"].startswith("— " + OLD) and w["say"].startswith(OLD) and w["dl"] >= 2, "b. an old bridge of this login: the row and the top box say so, with the download (%s)" % w["gb"][:120])
        look([other253, other251]); f = folded(); w = words(); print("      c.", f, w)
        NOTRUN = "FinCom Bridge is not running in this Windows login: start it, or install it."
        ok(w["own"] == "none" and w["gb"].startswith("— " + NOTRUN) and w["say"].startswith(NOTRUN), "c. only other logins' bridges: not running in this Windows login")
        look([]); f = folded(); w = words(); print("      d.", f, w)
        ok(f["guide"] == 0 and f["link"] == "laptop", "d. nothing answers, the office's bridge online: the steps folded as Connect Tally on this computer (%s)" % f)
        ok(w["gb"].startswith("— " + NOTRUN) and "choose Allow" in w["say"], "d. nothing answers: not running, and Allow when the browser asks")
        ok("not set up" not in json.dumps(w) and w["gb"] != "—", "b-d. never a blank or “not set up” while a reason is known")
        E("() => localStorage.setItem(LocalOwner.P + 'ownbridge', JSON.stringify({id: 'go-1', port: 9103, user: 'PC1\\\\usera'}))")
        look([]); w = words(); print("      e.", w)
        ok(w["own"] == "ok" and w["how"] == "remembered" and w["strip"].startswith("Open in your Tally now: “%s”" % OPEN) and "Shown: what that bridge last sent to FinCom’s cloud" in w["say"],
           "e. nothing answers, found here before: the beat from FinCom's cloud, said so, the company still shown")
        pg.close()

        print("3. the hang reporter")
        INIT = """(() => { window.__fincomSentryForce = true; window.__sent = []; })()"""
        pg = page(INIT)
        sent, sentAt = [], []
        def onsentry(route):
            try: body = route.request.post_data or ""
            except Exception: body = ""
            sent.append(body); sentAt.append(time.time()); route.fulfill(status=200, body="{}", headers={"Access-Control-Allow-Origin": "*"})
        pg.context.route("https://*.ingest.us.sentry.io/**", onsentry)
        pg.wait_for_timeout(5000)
        ok(pg.evaluate("() => !!window.__fincomHangWatch"), "the watch runs once Sentry is up")
        E("() => { navHome('clients'); }"); pg.wait_for_timeout(600)
        n0 = len(sent)
        E("() => { function blockFor(ms){ const t = performance.now(); while (performance.now() - t < ms) {} } setTimeout(() => blockFor(2500), 10); }"); pg.wait_for_timeout(4000)
        evs = [b for b in sent[n0:] if '"kind":"hang"' in b]
        print("      ", [b[-600:] for b in evs][:2])
        ok(len(evs) == 1, "a 2.5 s block: one warning (%d)" % len(evs))
        ev = evs[0] if evs else ""
        ok('"level":"warning"' in ev and '"where":"frame"' in ev and '"route":"home/' in ev and '"build":"' in ev and '"ms":"25' in ev, "kind hang, where frame, the page's name, the build, ms")
        ok('"filename":"http://localhost:%d/' % PORT in ev or '"filename":"http' in ev, "the long frame's script as its frame")
        n1 = len(sent)
        E("() => { function blockFor(ms){ const t = performance.now(); while (performance.now() - t < ms) {} } setTimeout(() => blockFor(2500), 10); }"); pg.wait_for_timeout(4000)
        ok(not [b for b in sent[n1:] if '"kind":"hang"' in b], "a second block within 10 minutes: nothing more")
        pg.close()
        pg = page(INIT); sent.clear(); sentAt.clear(); pg.context.route("https://*.ingest.us.sentry.io/**", onsentry); pg.wait_for_timeout(5000)
        E("() => { function blockFor(ms){ const t = performance.now(); while (performance.now() - t < ms) {} } setTimeout(() => blockFor(9000), 10); }"); t0 = time.time()
        pg.wait_for_timeout(12000)
        during = [b for b, at in zip(sent, sentAt) if '"where":"stall"' in b and at - t0 < 9.0]
        ok(len(during) == 1, "stuck 9 s: the worker reported it while stuck (where stall): %d" % len(during))
        ok(len([b for b in sent if '"kind":"hang"' in b]) <= 2, "one incident: the worker's report and the page's own after it, no more (%d)" % len([b for b in sent if '"kind":"hang"' in b]))
        pg.close()
        # next-tally-table (04-Nov-2026; FINCOM-APP-STAGING-G's first 16 events: a tab in the background, a computer asleep):
        # a page not seen is never reported; a seen one says what was clicked last and that it was seen
        print("4. the hang reporter: a hidden page is not reported; a seen one says what ran and what was clicked last")
        pg = page(INIT); sent.clear(); sentAt.clear(); pg.context.route("https://*.ingest.us.sentry.io/**", onsentry); pg.wait_for_timeout(5000)
        HIDE = """(h) => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => h ? 'hidden' : 'visible'});
          Object.defineProperty(document, 'hidden', {configurable: true, get: () => h}); document.dispatchEvent(new Event('visibilitychange')); }"""
        E(HIDE, True); pg.wait_for_timeout(1500)
        E("() => { function blockFor(ms){ const t = performance.now(); while (performance.now() - t < ms) {} } setTimeout(() => blockFor(9000), 10); }")
        pg.wait_for_timeout(13000)
        ok(not [b for b in sent if '"kind":"hang"' in b], "hidden (a tab in the background, a minimised remote desktop), stuck 9 s: nothing sent (%d)" % len([b for b in sent if '"kind":"hang"' in b]))
        E(HIDE, False); pg.wait_for_timeout(1500)
        E("() => { const b = document.createElement('button'); b.setAttribute('data-made-up-step', ''); b.textContent = 'ALPHA MADE-UP TRADERS'; document.body.appendChild(b); b.click(); b.remove(); }")
        E("() => { function blockFor(ms){ const t = performance.now(); while (performance.now() - t < ms) {} } setTimeout(() => blockFor(2500), 10); }"); pg.wait_for_timeout(4500)
        evs = [b for b in sent if '"kind":"hang"' in b]
        print("      ", [b[-500:] for b in evs][:2])
        ok(len(evs) == 1 and '"vis":"seen"' in evs[0], "seen again, a 2.5 s block: one warning, vis seen (%d)" % len(evs))
        ok(evs and '"last_ui":"made-up-step"' in evs[0] and '"ui_s":"' in evs[0] and "ALPHA MADE-UP" not in evs[0], "the last click by its code name only, and the seconds since (never its words)")
        pg.close()
        br.close()
    print("errors", errors[:5])
    print("PASSED" if not fails and not errors else "FAILED: %d" % (len(fails) + len(errors)))
    sys.exit(1 if fails or errors else 0)
main()
