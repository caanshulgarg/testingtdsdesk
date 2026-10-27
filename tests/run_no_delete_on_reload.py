"""python3 run_no_delete_on_reload.py - the data loss of 01-Oct-2026 must not happen again: a browser reloaded with empty
local storage (or with its sync marks but none of its clients) sends nothing to the server, for clients, entries,
parties, bank, sales, the firm record or the book items. A removal the user asks for is still sent, as the deleted flag
only (the server keeps the data). The server is a stand-in that records every request.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_no_delete_on_reload.py"""
import json, os, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8199), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

CIDS = ["cmufksrrqjub2g", "cmugy1hlvpnba5", "cmupe4m7upncpy"]
# the sync marks a browser kept from earlier syncs: three clients, their bills and suppliers, bank, sales, the firm
MARKS = {"firm||firm": "h0"}
for c in CIDS:
    MARKS.update({"client|%s|%s" % (c, c): "h1", "entry|%s|e-%s" % (c, c): "h2", "party|%s|p-%s" % (c, c): "h3", "bank_meta|%s|%s" % (c, c): "h4",
                  "bank_stmt|%s|%s:s1" % (c, c): "h5", "bank_rows|%s|%s:s1:0" % (c, c): "h6", "sales|%s|%s:v1" % (c, c): "h7", "sales_cfg|%s|%s" % (c, c): "h8"})
# stand-ins: every call to the server is recorded, nothing is answered with data
STUB = """() => { window.__calls = []; S.account = S.account || {}; Cloud.st.firm = 'efe13a47-f0fa-43be-a18c-bf32caa448ca'; Cloud.on = () => true;
  Cloud.api = async (path, opts) => { window.__calls.push({path, method: (opts || {}).method || 'GET', body: (opts || {}).body}); return path.startsWith('rpc/save_book_items') ? {ok: true, items: []} : []; }; }"""

with sync_playwright() as p:
    br = p.chromium.launch()
    for label, keep_marks in [("empty local storage", False), ("sync marks kept, no clients in this browser (the incident)", True)]:
        ctx = br.new_context(viewport={"width": 1440, "height": 900})
        if keep_marks: ctx.add_init_script("try { localStorage.setItem('tdsdesk:cloudmarks', %s); } catch (e) {}" % json.dumps(json.dumps(MARKS)))
        pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:8199/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        pg.reload(); pg.wait_for_timeout(2500)
        if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
        pg.evaluate(STUB)
        ch = pg.evaluate("cloudChanges().changes.map(r => [r.kind, r.id, !!r.deleted, JSON.stringify(r.data).length])")
        dels = [c for c in ch if c[2]]
        ok(not dels, "%s: no deletion is worked out (%d changes, %d deletions)" % (label, len(ch), len(dels)))
        ok(not ch, "%s: nothing at all to send: no client, bill, supplier, bank, sales or empty firm record (%s)" % (label, ch))
        pg.evaluate("cloudPush()"); pg.wait_for_timeout(500)
        calls = pg.evaluate("window.__calls")
        bad = [c for c in calls if c["method"] in ("POST", "PATCH") and (("clients" in c["path"]) or any(isinstance(x, dict) and (x.get("deleted") or x.get("data") == {}) for x in (c["body"] if isinstance(c["body"], list) else [c["body"]])))]
        ok(not bad, "%s: nothing sent that changes a client or deletes or empties a record (%d calls)" % (label, len(calls)))
        # the book items: the server knew 40 items of a client's books; this browser has none of them
        bi = pg.evaluate("""async (cid) => { window.__calls = []; const s = await BookItems.state(cid); s.ready = true;
          for (let i = 0; i < 40; i++) s.base['map\\u0001.L' + i] = 'h' + i; s.base['challans\\u0001'] = 'hc';
          BookSync.localWork = async () => ({}); await BookItems.pushNow(cid);
          const a = window.__calls.filter(c => c.path === 'rpc/save_book_items').flatMap(c => c.body.p_items).filter(x => x.del).length;
          BookSync.localWork = async () => ({map: {L0: {n: 1}}}); window.__calls = []; await BookItems.pushNow(cid);
          const b = window.__calls.filter(c => c.path === 'rpc/save_book_items').flatMap(c => c.body.p_items).filter(x => x.del).length;
          return [a, b]; }""", CIDS[0])
        ok(bi == [0, 0], "%s: book items missing here are not removed on the server (none of 40; 39 of 40 missing: held) %s" % (label, bi))
        ctx.close()

    # a removal the user asks for is still sent: the deleted flag only, the server keeps the data
    ctx = br.new_context(); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:8199/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    pg.evaluate(STUB)
    pg.evaluate("""async () => { const c = newCompany({name: 'ZZ Remove Me'}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; window.__cid = c.id;
      const e = newEntry('a.pdf'); S.data[c.id].entries[e.id] = e; window.__eid = e.id; await cloudPush(); }""")
    pg.evaluate("async () => { window.__calls = []; await Store.deleteCompany(window.__cid); await cloudPush(); }"); pg.wait_for_timeout(300)
    calls = pg.evaluate("window.__calls")
    cl = [c for c in calls if c["path"].startswith("clients?") and c["method"] == "PATCH"]
    en = [c for c in calls if c["path"].startswith("records?") and "kind=eq.entry" in c["path"] and c["method"] == "PATCH"]
    ok(len(cl) == 1 and set(cl[0]["body"]) <= {"deleted", "delete_reason"} and cl[0]["body"]["deleted"] is True, "a client removed by the user: sent as the deleted flag and its reason only, no blank name or data (%s)" % [c["body"] for c in cl])
    ok(len(en) == 1 and set(en[0]["body"]) <= {"deleted", "delete_reason"} and en[0]["body"]["deleted"] is True, "its bill: the deleted flag only")
    ok(pg.evaluate("Object.keys(Cloud.dels()).length") == 0, "once sent, the removal list is empty")
    ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
    br.close()
srv.shutdown()
print("\nFAILED: %d" % len(fails) if fails else "\nall passed")
