"""python3 run_session.py - staying signed in (review, Phase 2 check): a page left idle must not land on the sign-in page.
The firm account is stood in for by a fake server that behaves like Supabase Auth: a refresh token works once, and a
second refresh with the same token fails with "Refresh Token Not Found" (what staging's auth log showed, 3-5 refreshes
in the same second). Offline, no client data needed.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_session.py"""
import os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
H = functools.partial(H, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
srv = http.server.ThreadingHTTPServer(("localhost", 8173), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
FAKE = """(expired) => {
  window.__srv = {valid: 'A1', refresh: 'R1', n: 0, refreshes: 0, rejected: 0};
  Cloud.setSess({access_token: 'A1', refresh_token: 'R1', at: expired ? Date.now() - 2 * 3600e3 : Date.now(), expires_in: 3600, email: 'a@b.in', user_id: 'u'});
  window.fetch = async (u, o) => { u = String(u); const h = (o && o.headers) || {}, bearer = String(h.Authorization || '').replace('Bearer ', '');
    if (/auth\\/v1\\/token\\?grant_type=refresh_token/.test(u)){
      window.__srv.refreshes++;
      const sent = JSON.parse(o.body).refresh_token;
      await new Promise(r => setTimeout(r, 150));
      if (sent !== window.__srv.refresh){ window.__srv.rejected++; return new Response(JSON.stringify({error_description: 'Invalid Refresh Token: Refresh Token Not Found'}), {status: 400}); }
      window.__srv.n++; window.__srv.valid = 'A' + (window.__srv.n + 1); window.__srv.refresh = 'R' + (window.__srv.n + 1);
      return new Response(JSON.stringify({access_token: window.__srv.valid, refresh_token: window.__srv.refresh, expires_in: 3600}), {status: 200}); }
    if (/rest\\/v1|functions\\/v1|storage\\/v1|auth\\/v1\\/user/.test(u)){
      if (expired && bearer === 'A1') return new Response('{"message":"JWT expired"}', {status: 401});
      if (bearer !== window.__srv.valid) return new Response('{"message":"JWT expired"}', {status: 401});
      return new Response('[]', {status: 200}); }
    return new Response('{}', {status: 200}); };
  return true; }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 900}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8173/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    # 1. the token ran out while the page sat idle: five requests at once (opening a bill while the sync runs)
    pg.evaluate(FAKE, True)
    r = pg.evaluate("""async () => { const out = await Promise.all([Cloud.api('records?a'), Cloud.api('records?b'), Cloud.rpc('my_account'), Cloud.fn('admin', {action: 'x'}).catch(e => 'fn:' + e.message), CloudDocs.fetchFile('f/c/x-a.pdf', 'a.pdf').then(() => 'doc', e => 'doc:' + (e.message || e.code))]);
      return {ok: out.filter(x => Array.isArray(x)).length, srv: window.__srv, signedIn: Cloud.on(), token: Cloud.sess().access_token}; }""")
    ok(r["srv"]["refreshes"] == 1 and r["srv"]["rejected"] == 0, "an expired token is refreshed once, before the requests go out (refreshes: %d, refused: %d)" % (r["srv"]["refreshes"], r["srv"]["rejected"]))
    ok(r["signedIn"] and r["token"] == "A2" and r["ok"] >= 3, "all requests go through on the new token and the session stays (" + str(r["ok"]) + " answered)")
    # 2. the server says 401 although the clock thought the token was good: still one refresh for all of them
    pg.evaluate(FAKE, False)
    pg.evaluate("() => { window.__srv.valid = 'NEWER-ON-SERVER'; }")
    r = pg.evaluate("""async () => { const t0 = window.fetch; window.fetch = async (u, o) => { const res = await t0(u, o); return res; };
      window.__srv.valid = 'A1-rejected'; const out = await Promise.allSettled([Cloud.api('records?a'), Cloud.api('records?b'), Cloud.api('records?c'), Cloud.api('records?d')]);
      return {srv: window.__srv, signedIn: Cloud.on()}; }""")
    ok(r["srv"]["refreshes"] == 1 and r["srv"]["rejected"] == 0 and r["signedIn"], "four requests refused at once: one refresh between them, never a second with the used token (%d refreshes, %d refused)" % (r["srv"]["refreshes"], r["srv"]["rejected"]))
    # 3. another tab refreshed first: this tab uses that token and does not refresh with the old one
    pg.evaluate(FAKE, False)
    r = pg.evaluate("""async () => { const s = Cloud.sess(); window.__srv.valid = 'B9'; window.__srv.refresh = 'RB9';
      Cloud.setSess(Object.assign({}, s, {access_token: 'B9', refresh_token: 'RB9', at: Date.now()}));
      await Cloud.refreshToken('A1'); return {srv: window.__srv, token: Cloud.sess().access_token}; }""")
    ok(r["srv"]["refreshes"] == 0 and r["token"] == "B9", "a token another tab refreshed is used as it is (no second refresh)")
    # 4. idle sign-out (Settings: sign out after N minutes): the page says why, and signing in again returns to the bill
    cid = pg.evaluate("""() => { const c = newCompany({name: 'ZZ Session Co', gstin: ''}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
      const e = newEntry('a.pdf'); Object.assign(e.x, {vendorName: 'Alpha', invoiceNo: '1', invoiceDate: '2026-09-19', taxable: 100, total: 100}); S.data[c.id].entries[e.id] = e;
      Store.saveCompany(c); Store.saveEntry(c.id, e); return [c.id, e.id]; }""")
    pg.evaluate("(a) => openCompany(a[0]).then(() => { S.tab = 'invoices'; S.reviewTable = false; S.selected = a[1]; render(); })", cid); pg.wait_for_timeout(700)
    bill = pg.evaluate("location.hash")
    pg.evaluate("() => idleSet(5)")
    pg.evaluate("() => { Cloud.on = () => !!Cloud.sess(); }")
    pg.evaluate("() => { const t = Date.now; Date.now = () => t() + 6 * 60000; }"); pg.wait_for_timeout(31500)
    ok("minutes without use" in pg.inner_text("#app") and "carry on where you were" in pg.inner_text("#app"), "idle sign-out: the sign-in page says why (it is the setting, not an error)")
    ok(pg.evaluate("Route.pending") == bill, "and remembers the open bill (" + str(pg.evaluate("Route.pending")) + ")")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
