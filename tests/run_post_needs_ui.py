"""python3 run_post_needs_ui.py - entries not in Tally that need a person, first on the page (next-posting-never-stuck; the
owner, 23-Nov-2026: "If tally has not posted entry then user action should be treated on priority with the warning
message"). Offline, made-up clients, computers and Windows users; the postings of FinCom's cloud put in CloudJobs.list.
  1. classic look, Home: one warning box at the top, never behind a tab: "Needs you: N entries not in Tally · M clients",
     each client with its count, each line what happened and the one thing to do with its button; the most urgent first
     (not confirmed, held), then the oldest; the Needs you figure counts them;
  2. a posting waiting while its bridge says Tally is closed: "12 bank entries not in Tally: Tally is closed on PC-DEMO1
     (asha). Open Tally and Demo Builders Pvt Ltd on PC-DEMO1 (asha)", never "restart FinCom Bridge"; waiting 5 minutes:
     not yet on Home;
  3. its button opens the client's Post to Tally on the right tab; the client's pages show that client's lines at the top
     (the bank page too); the Post page's row says "Open Tally and ..." instead of the cloud's 2-hour words;
  4. it clears by itself once the entries are in Tally;
  5. the new look: the same box, above the firm's own Needs you;
  6. a phone (390 px): no sideways scroll.
Screenshots (desktop 1366x768 and phone 390, deviceScaleFactor 2) go to TDSDESK_SHOTS when set.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_post_needs_ui.py"""
import os, threading, functools, http.server, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
PORT = int(os.environ.get("PN_PORT") or 8947)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "dist-test")))
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
SHOTS = os.environ.get("TDSDESK_SHOTS", "")
if SHOTS: os.makedirs(SHOTS, exist_ok=True)
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
NL_ON = "try { localStorage.setItem('fincom:newlook:local', 'on'); } catch (e) {}"
RESTART = "No word from the FinCom Bridge on this posting for 2 hours, though the bridge is running: put back for the same bridge (it is never posted from another computer). If it stays so, restart FinCom Bridge on that computer."
SETUP = """(restart) => {
  const a = newCompany({name: "Demo Builders Pvt Ltd", gstin: "07AAACD1234E1Z5"}), b = newCompany({name: "Demo Retail LLP", gstin: "27AAAFD5678K1Z2"}), c = newCompany({name: "Sample Traders", gstin: "09AAACS4321M1Z8"});
  [a, b, c].forEach((x) => { S.companies[x.id] = x; });
  const ago = (m) => new Date(Date.now() - m * 60000).toISOString(), ids = (p, n) => Array.from({length: n}, (_, i) => p + i);
  const bank = ids("stmdemo1-", 12);
  window.__ids = {a: a.id, b: b.id, c: c.id};
  window.__jobs = {
    wait: {id: "11111111-1111-4111-8111-111111111111", client_id: a.id, company: "Demo Builders Pvt Ltd", status: "waiting", n: 12, done: 0, created_at: ago(45), updated_at: ago(3), target_bridge: "go-demo11", taken_by: "go-demo11", message: restart,
      entry_ids: bank, items: bank.map((id) => ({id, kind: "voucher", state: "waiting"})), results: []},
    ledger: {id: "22222222-2222-4222-8222-222222222222", client_id: b.id, company: "Demo Retail LLP", status: "failed", n: 3, created_at: ago(300), updated_at: ago(290), entry_ids: ["sv1", "sv2", "sv3"],
      results: ["sv1", "sv2", "sv3"].map((id) => ({id, ok: false, vchType: "Sales", message: "Ledger 'Demo Sales 18%' does not exist", sentAt: ago(290)})), items: ["sv1", "sv2", "sv3"].map((id) => ({id, state: "failed", reason: "Ledger 'Demo Sales 18%' does not exist"}))},
    review: {id: "33333333-3333-4333-8333-333333333333", client_id: c.id, company: "Sample Traders", status: "done", n: 1, created_at: ago(100), updated_at: ago(99), entry_ids: ["pv1"],
      results: [{id: "pv1", ok: false, accepted: true, lastVchId: "4400", vchType: "Purchase", message: "Tally replied 'created' (voucher id 4400) in job x but the entry was not found yet in 'Sample Traders' on 18-11-2026", sentAt: ago(99)}],
      items: [{id: "pv1", state: "unknown", reason: "Tally accepted it (voucher id 4400); being checked, not sent again", outcomeUnknown: true}]}};
  TLight.st.devs = [{id: "dev-demo", name: "PC-DEMO1 · DEMO\\\\asha", info: {computer: "PC-DEMO1", beat: {at: ago(0.2)}, bridges: {"go-demo11": {at: ago(0.2), computer: "PC-DEMO1", user: "DEMO\\\\asha", tallyState: "closed", tally: false, open: [], version: "2.5.19"}}}}];
  TLight.st.at = Date.now();
  CloudJobs.list = Object.values(window.__jobs); CloudJobs.at = Date.now();
  S.view = "home"; navHome("today"); render(); return window.__ids; }"""
BOX = "() => { const b = document.querySelector('[data-post-needs]'); if (!b) return null; const r = b.getBoundingClientRect(); return {kind: b.dataset.postNeeds, text: b.innerText, top: Math.round(r.top), lines: [...b.querySelectorAll('[data-post-needs-line]')].map((e) => e.dataset.postNeedsLine), clients: [...b.querySelectorAll('[data-post-needs-client]')].map((e) => e.dataset.postNeedsClient)}; }"
FIRST = "() => { const all = [...document.querySelectorAll('#app section.today > *, #app section.today .metrics')]; const b = document.querySelector('[data-post-needs]'), m = document.querySelector('#app .metrics'); return !!b && !!m && (b.compareDocumentPosition(m) & 4) > 0; }"
TILE = "() => { const m = [...document.querySelectorAll('.metrics .metric')].find((e) => /Needs you/.test(e.textContent)); return m ? Number(m.querySelector('b').textContent) : null; }"

def page(br, w=1366, h=768, nl=False, phone=False):
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=phone, has_touch=phone)
    if nl: ctx.add_init_script(NL_ON)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500); pg.evaluate(OPEN); pg.wait_for_timeout(800)
    ids = pg.evaluate(SETUP, RESTART); pg.wait_for_timeout(1800); pg.evaluate("render()"); pg.wait_for_timeout(600)
    return ctx, pg, ids
def shot(pg, name):
    if SHOTS: pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=False)

with sync_playwright() as p:
    br = p.chromium.launch()
    print("1-2. classic look, Home")
    ctx, pg, ids = page(br)
    b = pg.evaluate(BOX)
    ok(b and b["kind"] == "home", "Home: the warning box is there (%s)" % (b and b["kind"]))
    t = (b or {}).get("text", "")
    ok("Needs you: 16 entries not in Tally · 3 clients" in t, "its head: 16 entries, 3 clients (%r)" % t[:80])
    ok(pg.evaluate(FIRST), "it comes before the figures (first on Home)")
    ok("12 bank entries not in Tally: Tally is closed on PC-DEMO1 (asha). Open Tally and Demo Builders Pvt Ltd on PC-DEMO1 (asha)" in t, "Tally closed: the computer and Windows user, what to open")
    ok("restart FinCom Bridge" not in t, "never 'restart FinCom Bridge'")
    ok("3 sales invoices not in Tally: the ledger “Demo Sales 18%” is not in Tally. Create the ledger" in t, "a ledger missing: 3 sales invoices, what to create")
    ok("1 entry not confirmed in Tally. Look in Tally's Day Book" in t, "not confirmed: look in the Day Book")
    ok(b and b["lines"] == ["review", "ledger", "wait"], "the most urgent first: not confirmed, then not posted, then waiting (%s)" % (b and b["lines"]))
    ok(b and b["clients"] == [ids["c"], ids["b"], ids["a"]], "a count per client, in that order")
    ok("Demo Builders Pvt Ltd 12 entries" in t.replace("\n", " "), "Demo Builders: 12 entries")
    tile = pg.evaluate(TILE)
    ok(tile is not None and tile >= 16, "Home's Needs you figure counts them (%s)" % tile)
    shot(pg, "desktop-1-home-classic")
    # waiting 5 minutes only: not on Home yet
    pg.evaluate("() => { const j = window.__jobs.wait; CloudJobs.list = [Object.assign({}, j, {created_at: new Date(Date.now() - 5 * 60000).toISOString()})]; render(); }"); pg.wait_for_timeout(600)
    ok(pg.evaluate(BOX) is None, "a posting waiting 5 minutes: not on Home yet")
    pg.evaluate("() => { CloudJobs.list = Object.values(window.__jobs); render(); }"); pg.wait_for_timeout(600)

    print("3. the button, the client's pages, the Post page")
    pg.locator('[data-post-needs-line="wait"] [data-post-needs-go]').click(); pg.wait_for_timeout(1800)
    ok(pg.evaluate("S.view") == "company" and pg.evaluate("S.coId") == ids["a"] and pg.evaluate("S.tab") == "export" and pg.evaluate("(S.postTabs || {})[S.coId]") == "topost",
       "the button opens Demo Builders' Post to Tally, Waiting to post (%s)" % pg.evaluate("[S.view, S.tab, (S.postTabs || {})[S.coId]]"))
    b = pg.evaluate(BOX)
    ok(b and b["kind"] == "client" and b["clients"] == [ids["a"]] and "Needs you: 12 entries not in Tally" in b["text"], "the client's page: its own line at the top (%s)" % (b and b["text"][:90]))
    app = pg.evaluate("document.querySelector('#app').innerText")
    ok("Number 1 in the queue: Tally is closed on PC-DEMO1 (asha). Open Tally and Demo Builders Pvt Ltd on PC-DEMO1 (asha)" in app, "the Post page's waiting rows: what to open, on which computer and Windows user")
    ok("restart FinCom Bridge" not in app, "the Post page: never 'restart FinCom Bridge' while Tally is closed there")
    shot(pg, "desktop-2-client-post")
    pg.evaluate("() => { S.tab = 'bank'; render(); }"); pg.wait_for_timeout(1200)
    b = pg.evaluate(BOX)
    ok(b and b["kind"] == "client", "the bank page: the same line at the top")
    shot(pg, "desktop-3-client-bank")
    pg.evaluate("(cid) => { openCompany(cid); render(); }", ids["b"]); pg.wait_for_timeout(1200)
    b = pg.evaluate(BOX)
    ok(b and "3 sales invoices" in b["text"] and "Demo Builders" not in b["text"], "another client: only its own lines")
    if pg.locator('[data-post-needs-go]').count(): pg.locator('[data-post-needs-go]').first.click(); pg.wait_for_timeout(1200)
    ok(pg.evaluate("(S.postTabs || {})[S.coId]") == "errors" and pg.evaluate("S.tab") == "export", "its button opens Post to Tally › Errors")

    print("4. clears by itself")
    pg.evaluate("() => { const j = window.__jobs.wait; window.__jobs.wait = Object.assign({}, j, {status: 'done', results: j.entry_ids.map((id) => ({id, ok: true, vchType: 'Payment'})), items: j.entry_ids.map((id) => ({id, state: 'posted'}))}); CloudJobs.list = Object.values(window.__jobs); navHome('today'); render(); }"); pg.wait_for_timeout(1200)
    b = pg.evaluate(BOX)
    ok(b and "Demo Builders" not in b["text"] and "bank entries" not in b["text"], "the bank posting done: its line is gone, the others stay")
    pg.evaluate("() => { CloudJobs.list = [window.__jobs.wait]; render(); }"); pg.wait_for_timeout(800)
    ok(pg.evaluate(BOX) is None, "everything in Tally: no box at all")
    ctx.close()

    print("5. the new look")
    ctx, pg, ids = page(br, nl=True)
    b = pg.evaluate(BOX)
    ok(b and "Open Tally and Demo Builders Pvt Ltd on PC-DEMO1 (asha)" in b["text"], "the new look's Home: the same box")
    ok(pg.evaluate(FIRST), "first, before the figures")
    shot(pg, "desktop-4-home-newlook")
    ctx.close()

    print("6. a phone")
    for nl in (False, True):
        ctx, pg, ids = page(br, 390, 844, nl=nl, phone=True)
        b = pg.evaluate(BOX)
        ok(b is not None, "phone%s: the box on Home" % (" (new look)" if nl else ""))
        ok(pg.evaluate("document.scrollingElement.scrollWidth - innerWidth") <= 1, "phone%s: no sideways scroll" % (" (new look)" if nl else ""))
        shot(pg, "phone-%s-home" % ("newlook" if nl else "classic"))
        pg.locator('[data-post-needs-line="wait"] [data-post-needs-go]').click(); pg.wait_for_timeout(1500)
        ok(pg.evaluate("document.scrollingElement.scrollWidth - innerWidth") <= 1, "phone%s: the client's Post page, no sideways scroll" % (" (new look)" if nl else ""))
        shot(pg, "phone-%s-client" % ("newlook" if nl else "classic"))
        ctx.close()
    br.close()
ok(not errors, "no page errors (%s)" % errors[:3])
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
