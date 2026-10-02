"""python3 run_cloud_post_ui.py - build 199: posting from a computer without Tally goes through the cloud queue.
  - the Post button shows when the client's books are in the cloud;
  - Bridge.post queues the entries (tally_post_enqueue), follows the queue row, and answers as the bridge does;
  - the checks before posting read the cloud copy (/ledgers, /ledgerlines, /vouchers)."""
import os, sys, threading, functools, http.server, json
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "site-test"))); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", 8151), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails = []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://localhost:8151/"); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
    pg.evaluate("""() => { const c = newCompany({name: "ZZ QUEUE"}); c.postTo = "ZZ QUEUE LTD"; S.companies[c.id] = c; S.coId = c.id;
      window.__calls = []; window.__row = {status: "waiting", done: 0, n: 2, message: "", results: null, checking: false, company: "ZZ QUEUE LTD"};
      Bridge.on = () => false; Bridge.up = () => false;
      TCloud.on = () => true; TCloud.st[c.id] = {at: Date.now(), books: [{from: "2025-04-01", book: "bk1", company: "ZZ QUEUE LTD"}]};
      TCloud.rpc = async (fn, a) => { window.__calls.push([fn, a]);
        if (fn === "tally_post_enqueue") return {ok: true, id: a.p_id, company: "ZZ QUEUE LTD"};
        if (fn === "tally_vouchers_in") return [{date: "20250601", type: "Payment", number: "7", party: "X", narration: "rent | TDSDesk:abc", guid: "g1", optional: "No", cancelled: "No", entries: [{ledger: "HDFC", amount: "500.00"}, {ledger: "Rent", amount: "-500.00"}]}];
        return null; };
      TCloud.restAll = async (path) => { window.__calls.push(["rest", path]); return [{name: "HDFC", parent: "Bank Accounts"}, {name: "Rent", parent: "Indirect Expenses"}]; };
      Cloud.api = async (path) => { window.__calls.push(["api", path]); if (/tally_post_jobs/.test(path)) return [Object.assign({id: "x"}, window.__row)]; return []; }; }""")
    co = pg.evaluate("S.coId")
    ok(pg.evaluate("tallyVia(CO())") == "cloud" and pg.evaluate("canPostTally(CO())"), "no Tally here, the books in the cloud: posting goes through the cloud queue")
    ok(pg.evaluate("tallyCoName(CO())") == "ZZ QUEUE LTD", "the Tally company is the one linked in the cloud")
    led = pg.evaluate("tallyCall(CO(), '/ledgers?company=x').then(j => j.ledgers.map(l => l.name + '/' + l.group))")
    ok(led == ["HDFC/Bank Accounts", "Rent/Indirect Expenses"], "the ledgers before posting come from the cloud copy: " + str(led))
    lv = pg.evaluate("tallyCall(CO(), ledgerLinesUrl('ZZ QUEUE LTD', 'HDFC', '2025-06-01', '2025-06-30')).then(j => j.vouchers.length + ':' + j.vouchers[0].entries[0].amount)")
    last = pg.evaluate("window.__calls.filter(c => c[0] === 'tally_vouchers_in').pop()[1]")
    ok(lv == "1:500.00" and last["p_ledger"] == "HDFC" and last["p_from"] == "2025-06-01", "a bank ledger's entries before posting, from the cloud: " + json.dumps(last))
    # the posting itself
    pg.evaluate("""() => { window.__prog = []; window.__done = null;
      Bridge.post({company: "ZZ QUEUE LTD", client: S.coId, masters: [], vouchers: [{id: "v1", xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250601</DATE></VOUCHER>"}, {id: "v2", xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250602</DATE></VOUCHER>"}]},
        pj => window.__prog.push(pj.message)).then(j => window.__done = j, e => window.__done = {error: e.message}); }""")
    pg.wait_for_timeout(4000)
    enq = pg.evaluate("window.__calls.find(c => c[0] === 'tally_post_enqueue')")
    ok(enq and enq[1]["p_client"] == co and len(enq[1]["p_payload"]["vouchers"]) == 2, "the entries were queued in the cloud for this client")
    ok(any("Queued for the Tally computer" in (m or "") for m in pg.evaluate("window.__prog")), "while waiting it says so: " + str(pg.evaluate("window.__prog")[-1:]))
    pg.evaluate("""() => Object.assign(window.__row, {status: "running", done: 1, message: "Posting 1 to 2 of 2"})"""); pg.wait_for_timeout(3500)
    pg.evaluate("""() => Object.assign(window.__row, {status: "done", done: 2, message: "1 of 2 in Tally", results: [{id: "v1", ok: true, verified: true, guid: "g-1", vchNumber: "11"}, {id: "v2", ok: false, verified: null, message: "Ledger 'Nope' does not exist!"}]})"""); pg.wait_for_timeout(4000)
    d = pg.evaluate("window.__done")
    ok(d and d.get("viaCloud") and [r["ok"] for r in d["results"]] == [True, False] and d["results"][0]["guid"] == "g-1", "the answer is the bridge's: each entry's result")
    ok(d and "does not exist" in d["results"][1]["message"], "with Tally's own words for the one refused")
    ok(not errs, "no page errors " + " ".join(errs[:2]))
    # 02-Oct-2026: only into the company chosen for the client; nothing posted when none or another is chosen
    g = pg.evaluate("""async () => { const c = CO(), keep = c.postTo; window.__calls = [];
      c.postTo = ""; const a = await Bridge.post({company: "ZZ QUEUE LTD", client: c.id, masters: [], vouchers: [{id: "g1", xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250601</DATE></VOUCHER>"}]});
      c.postTo = "GARG SHEKHAR & COMPANY"; const b = await Bridge.post({company: "ZZ QUEUE LTD", client: c.id, masters: [], vouchers: [{id: "g2", xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250601</DATE></VOUCHER>"}]});
      c.postTo = keep; return {a: a.results[0].message, b: b.results[0].message, queued: window.__calls.filter(x => x[0] === "tally_post_enqueue").length}; }""")
    ok("Choose the Tally company" in g["a"] and "may post only to GARG SHEKHAR & COMPANY" in g["b"] and g["queued"] == 0, "posting only into the client's chosen company: none chosen or another company, nothing queued (%s)" % g)
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED"); sys.exit(1 if fails else 0)
