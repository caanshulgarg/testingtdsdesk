"""python3 run_cloud_post_ui.py - build 199: posting from a computer without Tally goes through the cloud queue.
  - the Post button shows when the client's books are in the cloud;
  - Bridge.post queues the entries (tally_post_enqueue), follows the queue row, and answers as the bridge does;
  - the checks before posting read the cloud copy (/ledgers, /ledgerlines, /vouchers).
Runs on the one-file test build (site-test, the default) and on the React build: TDSDESK_SITE=app/dist-test."""
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
    pg.goto("http://localhost:8151/"); pg.wait_for_timeout(2500); pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    pg.evaluate("""() => { const c = newCompany({name: "ZZ QUEUE"}); S.companies[c.id] = c; S.coId = c.id;
      // review 21c (02-Oct-2026): posting uses the confirmed choice of the Tally company only
      choiceConfirm(c, "postTo", "ZZ QUEUE LTD");
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
    ok(any("Waiting for ZZ QUEUE LTD to be opened in Tally on the Tally computer" in (m or "") for m in pg.evaluate("window.__prog")), "while waiting it says what it waits for: " + str(pg.evaluate("window.__prog")[-1:]))
    pg.evaluate("""() => Object.assign(window.__row, {status: "running", done: 1, message: "Posting 1 to 2 of 2"})"""); pg.wait_for_timeout(3500)
    pg.evaluate("""() => Object.assign(window.__row, {status: "done", done: 2, message: "1 of 2 in Tally", results: [{id: "v1", ok: true, verified: true, guid: "g-1", vchNumber: "11"}, {id: "v2", ok: false, verified: null, message: "Ledger 'Nope' does not exist!"}]})"""); pg.wait_for_timeout(4000)
    d = pg.evaluate("window.__done")
    ok(d and d.get("viaCloud") and [r["ok"] for r in d["results"]] == [True, False] and d["results"][0]["guid"] == "g-1", "the answer is the bridge's: each entry's result")
    ok(d and "does not exist" in d["results"][1]["message"], "with Tally's own words for the one refused")
    ok(not errs, "no page errors " + " ".join(errs[:2]))
    # 02-Oct-2026: only into the company chosen for the client; nothing posted when none or another is chosen
    g = pg.evaluate("""async () => { const c = CO(), keep = c.postTo; window.__calls = [];
      c.postTo = ""; if (c.choices) delete c.choices.postTo; const a = await Bridge.post({company: "ZZ QUEUE LTD", client: c.id, masters: [], vouchers: [{id: "g1", xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250601</DATE></VOUCHER>"}]});
      choiceConfirm(c, "postTo", "GARG SHEKHAR & COMPANY"); const b = await Bridge.post({company: "ZZ QUEUE LTD", client: c.id, masters: [], vouchers: [{id: "g2", xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250601</DATE></VOUCHER>"}]});
      choiceConfirm(c, "postTo", keep); return {a: a.results[0].message, b: b.results[0].message, queued: window.__calls.filter(x => x[0] === "tally_post_enqueue").length}; }""")
    ok("Choose the Tally company" in g["a"] and "may post only to GARG SHEKHAR & COMPANY" in g["b"] and g["queued"] == 0, "posting only into the client's chosen company: none chosen or another company, nothing queued (%s)" % g)
    # item C (migration 184): entries an earlier posting holds are followed in the posting that holds each of them
    h = pg.evaluate("""async () => { window.__calls = []; window.__marks = [];
      const mark0 = postMarkNew; postMarkNew = (cid, ids, job) => { window.__marks.push([ids.slice(), job]); return mark0(cid, ids, job); };
      const jobs = window.__jobs = {"live-1": {status: "done", done: 1, n: 1, message: "1 of 1 in Tally", results: [{id: "d1", ok: true, verified: true, guid: "g-d1"}]},
        "live-2": {status: "waiting", done: 0, n: 1, message: "", results: null}, "live-3": {status: "done", done: 1, n: 1, message: "", results: []}, "live-4": {status: "failed", message: "Not posted: posting into Tally was stopped.", results: null}};
      Cloud.api = async (path) => { window.__calls.push(["api", path]); const m = /id=eq\\.([\\w-]+)/.exec(path); const J = window.__jobs, j = m && (J[m[1]] || (J.own && Object.assign({}, J.own))); return j ? [Object.assign({id: m[1], company: "ZZ QUEUE LTD"}, j)] : []; };
      TCloud.rpc = async (fn, a) => { window.__calls.push([fn, a]);
        const ids = a.p_payload.vouchers.map(v => v.id);
        if (ids[0] === "d1") return {ok: false, none: true, error: "These entries are already waiting to be posted in an earlier posting, which goes on by itself. Nothing was queued again.",
          dupes: [{id: "d1", job: "live-1", status: "taken"}, {id: "d2", job: "live-2", status: "waiting"}, {id: "d3", job: "live-3", status: "done"}, {id: "d4", job: "live-4", status: "waiting"}]};
        return {ok: true, id: a.p_id, company: "ZZ QUEUE LTD", dupes: [{id: "p1", job: "live-2", status: "waiting"}]}; };
      const V = id => ({id, xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250601</DATE></VOUCHER>"});
      const D0 = Date.now; let a, b;
      setTimeout(() => { Date.now = () => D0() + 31 * 60000; }, 3000);          // 31 minutes later
      try { a = await Bridge.post({company: "ZZ QUEUE LTD", client: S.coId, masters: [{id: "led:M", xml: "<LEDGER/>"}], vouchers: [V("d1"), V("d2"), V("d3"), V("d4")]}); } catch (e){ a = {error: e.message}; }
      Date.now = D0;
      const apiA = window.__calls.filter(c => c[0] === "api").map(c => c[1]), marksA = window.__marks.slice(); window.__calls = []; window.__marks = [];
      jobs.own = {status: "done", done: 1, n: 1, message: "1 of 1 in Tally", results: [{id: "p2", ok: true, verified: true, guid: "g-p2"}]};
      setTimeout(() => { Date.now = () => D0() + 31 * 60000; }, 3000);
      try { b = await Bridge.post({company: "ZZ QUEUE LTD", client: S.coId, masters: [], vouchers: [V("p1"), V("p2")]}); } catch (e){ b = {error: e.message}; }
      Date.now = D0;
      const enq = window.__calls.find(c => c[0] === "tally_post_enqueue"), apiB = window.__calls.filter(c => c[0] === "api").map(c => c[1]);
      postMarkNew = mark0;
      return {a, b, apiA, apiB, marksA, marksB: window.__marks, idB: enq && enq[1].p_id}; }""")
    a, b = h["a"], h["b"]; ra = {r["id"]: r for r in a.get("results", [])}; rb = {r["id"]: r for r in b.get("results", [])}
    ok(not a.get("error") and a.get("viaCloud") and all(any(("id=eq.live-%d" % n) in x for x in h["apiA"]) for n in (1, 2, 3, 4)), "wholly held: no error, EVERY posting that holds an entry is followed (%s)" % a.get("error"))
    ok(h["marksA"] == [[["d1"], "live-1"], [["d2"], "live-2"], [["d3"], "live-3"], [["d4"], "live-4"]] and sorted(ra) == ["d1", "d2", "d3", "d4"], "each entry marked with its own posting; no result made up for the master (%s)" % h["marksA"])
    ok(ra.get("d1", {}).get("ok") is True and ra["d1"].get("guid") == "g-d1", "held by a posting that finished: that posting's result (%s)" % ra.get("d1"))
    ok(ra.get("d2", {}).get("held") is True and ra["d2"]["ok"] is False and ra["d2"]["job"] == "live-2" and ra["d2"]["status"] == "waiting" and "stays queued" in ra["d2"]["message"] and "Waiting for ZZ QUEUE LTD to be opened in Tally on" in ra["d2"]["message"],
       "held by a posting still waiting after 30 minutes: held (not failed), the words say what it waits for (%s)" % ra.get("d2"))
    ok(ra.get("d3", {}).get("held") is True and "Already posted in an earlier posting" in ra["d3"]["message"], "held by a posting done that says nothing of it: held, \"Already posted\" (%s)" % ra.get("d3"))
    ok(ra.get("d4", {}).get("ok") is False and not ra["d4"].get("held") and "stopped" in ra["d4"]["message"], "its posting failed: not held, that posting's reason (it can be posted again) (%s)" % ra.get("d4"))
    ok(not b.get("error") and any(("id=eq." + str(h["idB"])) in x for x in h["apiB"]) and any("id=eq.live-2" in x for x in h["apiB"]) and h["marksB"] == [[["p1"], "live-2"], [["p2"], h["idB"]]], "partly held: the new posting and the holder are both followed (%s)" % h["marksB"])
    ok(rb.get("p2", {}).get("ok") is True and rb.get("p1", {}).get("held") is True and rb["p1"]["job"] == "live-2" and "Not posted" not in rb["p1"]["message"], "the new entry's result; the held one held, never \"Not posted.\" (%s)" % rb.get("p1"))
    # item A: a posting of its own still waiting after 30 minutes: never failed here
    w = pg.evaluate("""async () => { const D0 = Date.now; window.__prog = [];
      window.__jobs = {}; window.__jobs.own = {status: "waiting", done: 0, n: 1, message: "", results: null};
      TCloud.rpc = async (fn, a) => ({ok: true, id: a.p_id, company: "ZZ QUEUE LTD"});
      setTimeout(() => { Date.now = () => D0() + 31 * 60000; }, 3000);
      const j = await Bridge.post({company: "ZZ QUEUE LTD", client: S.coId, masters: [], vouchers: [{id: "w1", xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250601</DATE></VOUCHER>"}]}, pj => window.__prog.push(pj.message));
      Date.now = D0; return {j, prog: window.__prog}; }""")
    r0 = (w["j"].get("results") or [{}])[0]
    ok(w["j"]["job"]["status"] == "waiting" and r0.get("held") is True and r0.get("ok") is False and "stays queued" in r0.get("message", "") and "failed" not in json.dumps(w["j"]).lower(), "waiting 30 minutes: the posting stays waiting, its entry held, nothing failed (%s)" % r0)
    ok(any("Waiting for ZZ QUEUE LTD to be opened in Tally on the Tally computer" in (m or "") for m in w["prog"]), "while it waits: \"Waiting for <company> to be opened in Tally on <computer>\" (%s)" % w["prog"][-1:])
    # item D (migration 185): queued for no computer: the cloud's own words while it waits; held after a minute
    u = pg.evaluate("""async () => { window.__prog = []; const D0 = Date.now;
      const W = "Queued: posts by itself when ZZ QUEUE LTD is opened in Tally on SRV9 (C:\\\\Data) with FinCom Bridge";
      window.__jobs = {}; window.__jobs.own = {status: "waiting", done: 0, n: 1, message: W, results: null};
      TCloud.rpc = async (fn, a) => ({ok: true, id: a.p_id, company: "ZZ QUEUE LTD", unrouted: true, note: W});
      setTimeout(() => { Date.now = () => D0() + 61000; }, 3000);
      const j = await Bridge.post({company: "ZZ QUEUE LTD", client: S.coId, masters: [], vouchers: [{id: "u1", xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250601</DATE></VOUCHER>"}]}, pj => window.__prog.push(pj.message));
      Date.now = D0; return {prog: window.__prog, r: j.results[0], W}; }""")
    ok(u["prog"] and all(m == u["W"] for m in u["prog"]) and u["r"].get("held") is True and u["r"]["message"].startswith(u["W"]) and "stays queued" in u["r"]["message"],
       "queued for no computer: the cloud's words while it waits; after a minute the entry is held, the page free (%s)" % u["r"])
    # auto-posting's rule for "queued" (src/js/90, loaded with its screen on the React build: its pattern then read here)
    aq = pg.evaluate("""(msgs) => { const Q = typeof AutoPost === "object" ? AutoPost.QUEUED : /stays queued|queued for the Tally computer|Still waiting for the Tally computer/i; return msgs.every(m => Q.test(m)); }""",
                     [ra.get("d2", {}).get("message", ""), ra.get("d3", {}).get("message", ""), rb.get("p1", {}).get("message", ""), r0.get("message", ""), u["r"].get("message", "")])
    ok(aq is True, "auto-posting reads every held entry as queued, not failed (waiting, being posted, already posted, queued for no computer)")
    # L-3: taken (or running) for 30 minutes: the page stops waiting, the entry held; nothing sent again
    k = pg.evaluate("""async () => { const D0 = Date.now; window.__calls = [];
      window.__jobs = {}; window.__jobs.own = {status: "taken", done: 0, n: 1, message: "Taken by the Tally computer", results: null};
      TCloud.rpc = async (fn, a) => { window.__calls.push([fn, a]); return {ok: true, id: a.p_id, company: "ZZ QUEUE LTD"}; };
      setTimeout(() => { Date.now = () => D0() + 31 * 60000; }, 3000);
      const j = await Bridge.post({company: "ZZ QUEUE LTD", client: S.coId, masters: [], vouchers: [{id: "k1", xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250601</DATE></VOUCHER>"}]});
      Date.now = D0; return {r: j.results[0], enq: window.__calls.filter(c => /^tally_post_enqueue/.test(c[0])).length}; }""")
    n = pg.evaluate("""async () => { const D0 = Date.now; window.__jobs = {};
      TCloud.rpc = async (fn, a) => ({ok: true, id: a.p_id, company: "ZZ QUEUE LTD"});
      setTimeout(() => { Date.now = () => D0() + 31 * 60000; }, 3000);
      const j = await Bridge.post({company: "ZZ QUEUE LTD", client: S.coId, masters: [], vouchers: [{id: "n1", xml: "<VOUCHER VCHTYPE=\\"Payment\\"><DATE>20250601</DATE></VOUCHER>"}]});
      Date.now = D0; return j.results[0]; }""")
    ok(n.get("held") is True and n.get("message", "").startswith("Not heard from the cloud for 30 minutes") and "stays queued" in n["message"], "the posting never read back for 30 minutes: held, \"Not heard from the cloud for 30 minutes\" (%s)" % n)
    ok(k["r"].get("held") is True and k["r"].get("status") == "taken" and "Being posted on the Tally computer" in k["r"]["message"] and k["enq"] == 1, "taken for 30 minutes: the page stops waiting, the entry held, queued once only (%s)" % k)
    ok(not errs, "no page errors " + " ".join(errs[:2]))
    br.close()
print("all passed" if not fails else str(len(fails)) + " FAILED"); sys.exit(1 if fails else 0)
