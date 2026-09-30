"""python3 pages_misc.py SITE OUT.json [PORT] - pages outside TDS and GST, as text, for comparing two builds (see
pages_gst.py): the vendor reconciliation with a made-up result (agreeing, and not), and more as screens move.
Offline, a made-up client; no client data needed."""
import json, os, sys, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
site, out, port = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 8175
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=site); H.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", port), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
res, errors = {}, []
VR_RESULT = """(agree) => {
  const V = [{date: '2025-04-05', narr: 'Bill 101 to us', eff: 5000}, {date: '2025-05-02', narr: 'Payment received NEFT 88', eff: -3000}, {date: '2025-06-10', narr: 'Bill 117', eff: 1200}];
  const T = [{date: '2025-04-05', type: 'Purchase', number: '12', ref: '101', bills: [], other: 'Purchases', narr: '', eff: 5000},
             {date: '2025-06-10', type: 'Purchase', number: '19', ref: '117', bills: [], other: 'Purchases', narr: '', eff: 1000},
             {date: '2025-07-01', type: 'Journal', number: '4', ref: '', bills: ['JV-4'], other: 'Discount', narr: '', eff: -200}];
  const r = agree ? {pairs: [{v: 0, t: 0}], onlyV: [], onlyT: [], differ: [], timeline: [], openDiff: 0, vOpen: 0, tOpen: 0, vClose: 5000, tClose: 5000, dEff: 0, unexplained: 0}
    : {pairs: [{v: 0, t: 0}], onlyV: [1], onlyT: [2], differ: [{v: 2, t: 1}], dEff: 200, openDiff: 500, vOpen: 500, tOpen: 0, vClose: 3700, tClose: 5800, unexplained: -1600,
       timeline: [{date: '2025-05-02', diff: -2500, change: -3000, why: ['Payment received NEFT 88 not in Tally']}, {date: '2025-06-10', diff: -2300, change: 200, why: ['amount differs']}]};
  S.vrec = Object.assign(VR.def(), {ledger: 'Alpha Traders', from: '2025-04-01', to: '2025-12-31', fileName: 'alpha.csv',
    res: Object.assign({V, T, ledger: 'Alpha Traders', company: 'ZZ TEST', from: '2025-04-01', to: '2025-12-31', file: 'alpha.csv', sides: "the vendor's books"}, r)});
  S.view = 'company'; S.step = 'review'; S.reviewTable = false; S.tab = 'invoices'; render(); }"""
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1400, "height": 1000}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: errors.append("same key: " + m.text[:120]) if "same key" in m.text else None)
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500); pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1500)
    pg.evaluate("""() => { const c = newCompany({name: "ZZ TEST", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; S.coId = c.id; }""")
    pg.evaluate("(cid) => openCompany(S.coId).then(() => goStep('collect', 'bills'))", None); pg.wait_for_timeout(1200)
    def grab(name):
        pg.wait_for_timeout(300)
        res[name] = re.sub(r"\s+", " ", pg.evaluate("document.getElementById('app').innerText")).strip()
    pg.evaluate("() => { S.vrec = VR.def(); S.step = 'review'; S.reviewTable = false; S.tab = 'invoices'; render(); }"); grab("vr-empty")
    pg.evaluate(VR_RESULT, False); grab("vr-differs")
    pg.evaluate(VR_RESULT, True); grab("vr-agrees")
    pg.evaluate("() => { S.vrec.busy = 'Reading the vendor file'; render(); }"); grab("vr-busy")
    br.close()
srv.shutdown()
json.dump({"pages": res, "errors": errors}, open(out, "w"), indent=0)
print(len(res), "pages;", len(errors), "errors")
