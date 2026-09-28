# Hostile text arriving from the cloud (another firm member, the inbox automation) or a file must never become page markup.
import os, threading, functools, http.server
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site-test"))
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8162), functools.partial(H, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def check(c, m):
    print(("ok  " if c else "FAIL ") + m)
    if not c: fails.append(m)
X = '"><b data-pwn="1">x</b><img src=x onerror="window.__pwn=1">\''
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.add_init_script("window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective));")
    pg.goto("http://localhost:8162/"); pg.wait_for_timeout(2000)
    b0 = pg.locator('button[data-act="useOffline"]')
    if b0.count(): b0.first.click(); pg.wait_for_timeout(800)
    r = pg.evaluate("""async (X) => {
      const co = newCompany({name: "Co " + X, gstin: "27AAACB1234C1Z5"}); co.id = "c_hostile";
      const e = newEntry("bill " + X + ".pdf"); e.id = "e_ok";
      e.status = "draft"; e.x = Object.assign(e.x || {}, {vendorName: "Vendor " + X, invoiceNo: X, invoiceDate: X, totalAmount: 100, taxable: 100});
      const e2 = JSON.parse(JSON.stringify(e)); e2.id = 'e2"><b data-pwn=1>';
      const rows = [
        {kind: "client", id: co.id, data: co},
        {kind: "entry", id: "e_ok", client_id: co.id, data: e},
        {kind: "entry", id: 'bad"><b data-pwn=1>', client_id: co.id, data: e2},
        {kind: "inbox", id: "q1", client_id: co.id, data: {id: 'q1" data-pwn="1', fileName: X, status: "new", from: X}},
      ];
      await cloudApply(rows);
      return {bad: !!(S.data[co.id] && Object.keys(S.data[co.id].entries).some(k => /[<>"]/.test(k))), cls: Object.keys(S.data[co.id] ? S.data[co.id].entries : {})};
    }""", X)
    check(not r["bad"], "a cloud record with a hostile id is refused " + str(r))
    seen = []
    views = [("home", None, t) for t in ["today", "inbox", "rules", "tally", "help"]] + [("company", t, None) for t in ["invoices", "dash", "txn", "books", "bank", "sales", "export", "done", "settings", "gstset", "bankset", "bankrules", "deductees"]]
    for v, tab, home in views:
        out = pg.evaluate("""async ([v, tab, home]) => {
          try {
            if (v === "home"){ S.view = "home"; S.homeTab = home; render(); }
            else { await openCompany("c_hostile"); S.view = "company"; S.tab = tab; render(); }
          } catch (e){ return {err: String(e && (e.message || e.code) || e)}; }
          await new Promise(r => setTimeout(r, 150));
          return {pwn: !!document.querySelector("[data-pwn]") || !!window.__pwn, err: ""};
        }""", [v, tab, home])
        seen.append((v, tab or home, out))
        check(not out.get("pwn"), "no injected markup on " + v + " / " + (tab or home) + (" (" + out["err"] + ")" if out.get("err") else ""))
    check(not errs, "no page errors " + str(errs[:3]))
    b.close()
print(("%d failed" % len(fails)) if fails else "all passed")
