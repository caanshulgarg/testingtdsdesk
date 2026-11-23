"""python3 tests/run_hang_link_names.py - "Page blocked" on the Clients and Tally pages (staging 23-Nov-2026, build 407e4c821):
  FINCOM-APP-STAGING-K: Today -> Clients (the sidebar's Clients): 2,305 ms in the timer of FinComNav.go (navHome -> render);
  FINCOM-APP-STAGING-Z: on the Tally page after Link: 2,683 ms in soonGo (soonRender's timer -> render).
Both drawings spent their time in the link record's names (src/js/98-link-record.js): every LinkRec.nameOf worked out
learnNow's key of every computer's beat (each company it reports, name and GUID) again, and ofName asks nameOf of every
link, so each name compared on the page (LinkRec.same, from the chips, the rows and tallyServe) cost links x companies.
With GUIDs in the beats (bridge 2.4.5 and later) it grows with the square of the links: a firm of 15 clients and 21 links
on an office PC; here 70 more made-up linked clients do the same at full speed.
Signed in to a stand-in of FinCom's cloud with the made-up firm of tally_shapes.py, every company its made-up GUID, and
N (default 70) more made-up clients, each linked to its own made-up company on one of the computers, and M (default
60) made-up companies the computers report that no client has. Checks:
  1. Today, then the sidebar's Clients: the longest task after the click within LONG_MS (default 400; 1.4-3 s before);
     every client listed, each with one of the four link words;
  2. the Tally page, then soonRender (as after Link): the longest task of the drawing within LONG_MS (0.6-1.6 s before);
  3. the words follow the beats at once: a beat merged in place (TLight.beatIn, the cloud's broadcast) that reports a
     linked company's GUID under a new name, then render() in the same task: the page shows the new name (renamed in
     Tally); and the client's chip words are the same before and after a fresh drawing;
  4. the link record's answers (nameOf, ofName, isName, same) the same as its code before this change gives, worked out
     afresh over the same records and beats, for every name reported or held and other spellings of them (before and
     after the renamed beat).
Run on the React build: app/dist-test (cd app && npm run legacy && npm run build:test), or TDSDESK_SITE."""
import os, sys, json, copy, hashlib, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import tally_shapes as TS
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("HANG_LINK_PORT") or 9587)
N = int(os.environ.get("N") or 70)
M = int(os.environ.get("M") or 60)
LONG_MS = int(os.environ.get("LONG_MS") or 400)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
LATEST = {"setup": {"version": "2.5.3", "url": "https://x.example/assets/bridge-go/FinComBridge-Setup-2.5.3.exe", "sha256": "ab" * 32}}
READY = "() => typeof S === 'object' && S && S.firm && typeof Cloud === 'object' && Cloud.st && !!Cloud.st.lastSync && typeof render === 'function'"
GUID = lambda s: hashlib.md5(s.strip().lower().encode()).hexdigest()

def firm(n):
    fx = TS.make()
    devs = [d for d in fx["tally_devices"] if d.get("info")]
    base = fx["clients"][0]
    for i in range(n):
        cid = "cz%08d" % i; nm = "MADE UP CLIENT %03d PRIVATE LIMITED" % i; co = nm + " 2026-27"; d = devs[i % len(devs)]; at = d["info"]["beat"]["at"]; bk = "bk-z-%d" % i
        c = copy.deepcopy(base); c.update({"id": cid, "name": nm, "tally_name": co, "deleted": False}); c["data"] = dict(c["data"], id=cid, name=nm, tallyName=co, bankAccounts=[]); fx["clients"].append(c)
        fx["tally_companies"].append({"book_id": bk, "company": co, "client_id": cid, "device_id": d["id"], "firm_id": fx["firm"], "gstin": "", "first_seen": at, "last_seen": at, "linked_at": at, "linked_by": fx["uid"]})
        fx["tally_links"].append({"book_id": bk, "client_id": cid, "firm_id": fx["firm"], "company_name": co, "state": "linked", "device_id": d["id"], "computer": TS.PC,
                                  "linked_at": at, "linked_by": fx["uid"], "how": "picked", "posting_allowed": True, "updated_at": at, "version": 1})
        d["info"]["beat"]["companies"].append({"name": co, "open": i % 4 == 0, "phase": "live", "waiting": 0, "at": at})
        if i % 4 == 0: d["info"]["beat"]["open"].append(co)
    # more companies the computers report that no client has (staging: 57 in the beats, 21 link records)
    for i in range(M):
        d = devs[i % len(devs)]; nm = "MADE UP OTHER COMPANY %03d" % i; bk = "bk-o-%d" % i
        fx["tally_companies"].append({"book_id": bk, "company": nm, "client_id": None, "device_id": d["id"], "firm_id": fx["firm"], "gstin": "", "first_seen": None, "last_seen": None, "linked_at": None, "linked_by": None})
        fx["tally_links"].append({"book_id": bk, "client_id": None, "firm_id": fx["firm"], "company_name": nm, "state": "unlinked", "device_id": d["id"], "computer": TS.PC,
                                  "linked_at": None, "linked_by": None, "how": "picked", "posting_allowed": False, "updated_at": None, "version": 1})
        d["info"]["beat"]["companies"].append({"name": nm, "open": False, "phase": "live", "waiting": 0, "at": d["info"]["beat"]["at"]})
    # every company its GUID (bridge 2.4.5 and later report one), the same in its link record
    for d in devs:
        for c in d["info"]["beat"]["companies"]: c["guid"] = GUID(c["name"])
    for l in fx["tally_links"]: l["company_guid"] = GUID(l["company_name"])
    return fx

LT = "() => { window.__lt = []; if (!window.__lto) { window.__lto = new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(Math.round(e.duration)))); window.__lto.observe({type: 'longtask'}); } }"
# 4. the link record's answers against its code as it was before next-fix-hangs (worked out afresh every call, no keys
# kept), over the same records and beats: every name the computers report or a record holds, in other spellings too
SAME = r"""() => {
  const R = { st: {rows: LinkRec.st.rows, guid: {}, now: null},
    key(n){ return (typeof ledNm === "function" ? ledNm(String(n || "")) : String(n || "")).replace(/\s+/g, " ").trim().toLowerCase(); },
    learn(devs){ const now = {};
      [].concat(devs || []).forEach(d => { const cs = (((d || {}).info || {}).beat || {}).companies;
        if (Array.isArray(cs)) cs.forEach(c => { const g = c && typeof c.guid === "string" ? c.guid.trim().toLowerCase() : "";
          if (c && c.name && /^[0-9a-z-]{1,100}$/.test(g)){ this.st.guid[this.key(c.name)] = g; const l = now[g] = now[g] || []; if (!l.some(n => this.key(n) === this.key(c.name))) l.push(String(c.name)); } }); });
      if (Object.keys(now).length) this.st.now = now; },
    learnNow(){ const devs = [].concat((typeof TLight === "object" && TLight.st.devs) || [], (typeof TCloud === "object" && TCloud.pane && TCloud.pane.devices) || []);
      const k = devs.map(d => { const b = (((d || {}).info || {}).beat) || {}; return (d && d.id) + "@" + (b.at || "") + ":" + [].concat(b.companies || []).map(c => c && c.name + "=" + c.guid).join(","); }).join("|");
      if (k !== this.st.devsKey){ this.st.devsKey = k; this.learn(devs); } return this.st.now; },
    live(){ return (this.st.rows || []).filter(r => r.state === "linked" && r.client_id); },
    nameOf(r){ if (!r) return ""; const all = this.learnNow(), now = r.company_guid && all ? all[r.company_guid] : null;
      if (!now || !now.length || now.some(n => this.key(n) === this.key(r.company_name))) return r.company_name || ""; return now.length === 1 ? now[0] : r.company_name || ""; },
    ofName(name){ const k = this.key(name), L = this.live(); return L.find(r => this.key(r.company_name) === k) || L.find(r => r.company_guid && this.key(this.nameOf(r)) === k) || null; },
    isName(r, name){ const k = this.key(name); return !!r && !!k && (this.key(r.company_name) === k || this.key(this.nameOf(r)) === k); },
    same(a, b){ if (this.key(a) === this.key(b)) return true; const r = this.ofName(a) || this.ofName(b); return !!r && this.isName(r, a) && this.isName(r, b); } };
  const devs = [].concat(TLight.st.devs || [], (TCloud.pane && TCloud.pane.devices) || []);
  const names = [...new Set([].concat(...devs.map(d => ((((d || {}).info || {}).beat || {}).companies || []).map(c => c && c.name)), (LinkRec.st.rows || []).map(r => r.company_name)).filter(Boolean))];
  const all = names.concat(names.slice(0, 20).map(n => " " + n.toLowerCase() + "  "), names.slice(0, 20).map(n => n + "\r\n"), ["", null, "MADE UP NOBODY"]);
  let n = 0, bad = [];
  const cmp = (what, x, y) => { n++; if (x !== y && bad.length < 5) bad.push(what + ": " + x + " / " + y); };
  (LinkRec.st.rows || []).forEach(r => cmp("nameOf " + r.company_name, LinkRec.nameOf(r), R.nameOf(r)));
  all.forEach(a => { cmp("ofName " + a, LinkRec.ofName(a), R.ofName(a)); (LinkRec.st.rows || []).slice(0, 25).forEach(r => cmp("isName", LinkRec.isName(r, a), R.isName(r, a))); });
  for (let i = 0; i < all.length; i++) for (let j = i; j < all.length; j += 7) cmp("same " + all[i] + " | " + all[j], LinkRec.same(all[i], all[j]), R.same(all[i], all[j]));
  return {n, bad, names: names.length}; }"""
CHIPS = "() => Array.from(document.querySelectorAll('#app [data-tally-chip-at=\"clients\"]')).map(b => b.innerText.replace(/^\\W+/, '').trim())"

def main():
    fx = firm(N); cloud = TS.FakeCloud(fx)
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://localhost:%d/" % PORT
    try:
        with sync_playwright() as p:
            br = p.chromium.launch(args=["--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights"])
            ctx = br.new_context(viewport={"width": 1440, "height": 900}, service_workers="block")
            pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
            pg.add_init_script(TS.signin_script(fx))
            ctx.route("https://*.supabase.co/**", cloud.route)
            ctx.route("https://*.sentry.io/**", lambda r: r.fulfill(status=200, body="{}"))
            ctx.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(LATEST)))
            ctx.route("http://127.0.0.1:*/**", TS.bridges("own253"))
            pg.goto(base + "#/today", wait_until="domcontentloaded", timeout=120000)
            pg.wait_for_function(READY, timeout=90000)
            pg.wait_for_function("() => typeof LinkRec === 'object' && LinkRec.ready() && typeof TLight === 'object' && (TLight.st.devs || []).length > 0 && !!globalThis.LinkWord", timeout=60000)
            pg.wait_for_timeout(6000)
            pg.evaluate("() => FinComNav.go(() => navHome('today'))"); pg.wait_for_timeout(2500)
            pg.evaluate(LT)
            # 1. the sidebar's Clients, from Today
            pg.click("#side button.side-link[data-bar][title='Clients']")
            pg.wait_for_timeout(3500)
            lt = pg.evaluate("window.__lt.slice()")
            where = pg.evaluate("S.view + '/' + S.homeTab")
            chips = pg.evaluate(CHIPS); t1 = pg.evaluate("document.querySelector('#app').innerText")
            n = pg.evaluate("Object.values(S.companies).filter(c => c && !c.deleted).length")
            ok(where == "home/clients" and max(lt or [0]) <= LONG_MS, "1. Today -> Clients: the longest task %d ms (at most %d; tasks %s), on %s" % (max(lt or [0]), LONG_MS, lt[:6], where))
            ok(n >= N + 10 and len(chips) == n and all(w in ("Linked", "Waiting for Tally", "Needs you", "Not linked") for w in chips),
               "   every client listed (%d of %d), each with one of the four words (%s)" % (len(chips), n, sorted(set(chips))))
            # 2. the Tally page, then soonRender (soonGo's drawing, as after Link)
            pg.evaluate("() => FinComNav.go(() => navHome('tally'))"); pg.wait_for_timeout(3500)
            pg.evaluate(LT)
            pg.evaluate("() => soonRender()"); pg.wait_for_timeout(2500)
            lt = pg.evaluate("window.__lt.slice()")
            rows = pg.evaluate("document.querySelectorAll('#app tr').length"); t2 = pg.evaluate("document.querySelector('#app').innerText")
            ok(max(lt or [0]) <= LONG_MS and rows > N, "2. the Tally page, soonRender: the longest task %d ms (at most %d; tasks %s), %d rows" % (max(lt or [0]), LONG_MS, lt[:6], rows))
            r = pg.evaluate(SAME)
            ok(r["n"] > 5000 and not r["bad"], "4. the link record's answers as before (worked out afresh, nothing kept): %d compared over %d names, different: %s" % (r["n"], r["names"], r["bad"]))
            # 3. a beat merged in place (beatIn) naming a linked company's GUID under a new name, drawn in the same task
            old = "MADE UP CLIENT 001 PRIVATE LIMITED 2026-27"; new = "MADE UP CLIENT 001 PVT LTD (RENAMED)"
            r = pg.evaluate("""([old, nu, g]) => {
              const rec = LinkRec.live().find(x => x.company_name === old), before = LinkRec.nameOf(rec), d = (TLight.st.devs || []).find(x => x.id === rec.device_id);
              const cos = (((d.info || {}).beat || {}).companies || []).map(c => c.name === old ? Object.assign({}, c, {name: nu}) : c);
              TLight.beatIn({device: d.id, beat: {companies: cos, at: new Date().toISOString()}});
              render();
              return {before, after: LinkRec.nameOf(rec), same: LinkRec.same(old, nu), of: LinkRec.ofName(nu) === rec, renamed: LinkRec.renamedOf(nu) === rec}; }""", [old, new, GUID(old)])
            ok(r["before"] == old and r["after"] == new and r["same"] and r["of"] and r["renamed"], "3. a beat with the GUID under a new name, drawn in the same task: named %r (was %r), the same company %s, its record %s" % (r["after"], r["before"], r["same"], r["of"] and r["renamed"]))
            r = pg.evaluate(SAME)
            ok(r["n"] > 5000 and not r["bad"], "4. and after the renamed beat: %d compared, different: %s" % (r["n"], r["bad"]))
            pg.evaluate("() => FinComNav.go(() => navHome('clients'))"); pg.wait_for_timeout(2500)
            a = pg.evaluate(CHIPS); pg.evaluate("() => render()"); pg.wait_for_timeout(800); b = pg.evaluate(CHIPS)
            ok(a == b and len(a) == n, "   the chips the same in a fresh drawing (%d)" % len(a))
            json.dump({"chips": a, "clients": t1, "tally": t2}, open(os.environ["HANG_LINK_DUMP"], "w")) if os.environ.get("HANG_LINK_DUMP") else None
            br.close()
    finally:
        srv.shutdown()
    errs = [e for e in errors if "supabase" not in e.lower()]
    ok(not errs, "no page errors %s" % errs[:3])
    print("all passed" if not fails else "%d FAILED" % len(fails))
    sys.exit(1 if fails else 0)
main()
