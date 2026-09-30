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
    # Tally: not connected (the three steps), the bridge down, connected with Tallys found, a clash, a Tally chosen that is
    # not running, the check of this server's Tally and the reading test; the books in the cloud; in Settings too
    pg.evaluate("""() => { window.__cfg = {url: 'http://127.0.0.1:9100', key: '', follow: true, port: 0}; Bridge.cfg = () => window.__cfg; Bridge.st = {state: 'off', sessions: [], open: [], at: Date.now(), error: ''};
      S.vrec = null; S.view = 'home'; S.homeTab = 'tally'; render(); }"""); grab("tally-off")
    pg.evaluate("() => { S.bridgeSha = 'ab12cd'; __cfg.key = 'k1'; Bridge.st = {state: 'down', sessions: [], open: [], at: Date.now(), error: 'The bridge did not answer.'}; render(); }"); grab("tally-down")
    pg.evaluate("""() => { const other = Object.values(S.companies)[0];
      Bridge.st = {state: 'ok', version: '1.14.3', at: Date.parse('2026-01-05T10:00:00Z'), mode: 'auto', user: 'OFFICE\\ravi', tallyUp: true, allowImport: false, clash: ['ACME LTD'],
        sessions: [{port: 9000, ok: true, mine: true, companies: [{name: other.name}, {name: 'ACME LTD'}]}, {port: 9001, ok: false, error: 'x', companies: []}, {port: 9002, skipped: true, companies: []}], open: []};
      Bridge.diag = null; S.readTest = null; render(); }"""); grab("tally-ok")
    pg.evaluate("""() => { __cfg.port = 9005; Bridge.st.mode = 'fallback'; Bridge.st.tallyUp = false; Bridge.diag = {user: 'ravi', mySession: 2, findings: [{level: 'ok', text: 'TallyPrime found'}, {level: 'warn', text: 'Port 9000 used twice', fix: 'Give each Tally its own port'}],
      tallies: [{user: 'ravi', session: 2, mine: true, ports: [9000], ini: {found: true, mode: 'Both', port: 9000}}, {session: 3, ports: [], ini: {found: false}}], freePort: 9003};
      S.readTest = {tests: [{name: 'Day book', ok: true, count: 120, optional: 2, ms: 340}, {name: 'Light list', ok: false, error: 'timed out', ms: 9000}], company: 'ACME LTD', port: 9000, from: '20260401', to: '20260430'}; render(); }"""); grab("tally-diag")
    pg.evaluate("() => { Bridge.diag = {error: 'Could not look.'}; S.readTest = {busy: true, error: 'Tally closed'}; render(); }"); grab("tally-diag-error")
    pg.evaluate("() => { S.homeTab = 'rules'; S.settingsTab = 'bridge'; render(); }"); grab("settings-bridge")
    pg.evaluate("() => { S.settingsTab = 'tcloud'; render(); }"); grab("settings-tcloud-off")
    pg.evaluate("""() => { TCloud.on = () => true; TCloud.autoErr = 'no bridge'; const c0 = Object.values(S.companies)[0];
      TCloud.pane = {devices: [{id: 'd1', name: 'Office PC', info: {computer: 'PC-1', user: 'ravi'}, last_seen: '2026-01-05T10:00:00Z', version: '1.14.3'}, {id: 'd2', name: 'Old', revoked: true}],
        companies: [{company: 'ACME LTD', gstin: '09AAACA1111A1Z1', client_id: c0.id, last_seen: '2026-01-05T10:00:00Z'}, {company: 'BETA', client_id: null}], err: 'Could not refresh', busy: ''}; render(); }"""); grab("settings-tcloud")
    br.close()
srv.shutdown()
json.dump({"pages": res, "errors": errors}, open(out, "w"), indent=0)
print(len(res), "pages;", len(errors), "errors")
