"""The stand for the "My MIS" browser tests (run_my_mis_ui.py, run_mis_xlsx.py): the React build (app/dist-test, or
TDSDESK_SITE) served here, a made-up firm with the fixture books (tests/fixtures/books) in the page, and FinCom's cloud stood
in by the page: the books' items (save_book_items, client_book_items, kept by the test between reloads) and Ask FinCom's
answer fed as its stream (window.__answer). Made-up data only."""
import os, sys, json, base64, threading, functools, http.server
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE, FIXTURE_DIR
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.environ.get("TDSDESK_SHOTS", os.path.join(HERE, "out", "my-mis")); os.makedirs(OUT, exist_ok=True)
PORT = [8437]
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
def serve(port):
    PORT[0] = port
    srv = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv
BOOKS = json.load(open(CACHE)); MASTER = base64.b64encode(open(os.path.join(FIXTURE_DIR, "Master.xml"), "rb").read()).decode()

SETUP = """async (a) => {
  Cloud.cfg = () => ({url: "http://fn.test", key: "anon-key", email: "anshul@firm.test"});
  Cloud.sess = () => ({access_token: "tok-x", refresh_token: "", user_id: "u-1", email: "anshul@firm.test", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {}; Cloud.on = () => true;
  Cloud.st.firm = "f-1"; Cloud.st.role = "owner"; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: "u-1", name: "Anshul"}];
  S.account = Object.assign(S.account || {}, {me: {role: "owner", email: "anshul@firm.test", name: "Anshul", user_id: "u-1"}, firm: {name: "Test firm"}}); S.firm.firmName = "Test firm";
  try { Live.stop(); } catch (e) {}
  try { lsSet("tdsdesk:asst-notice", "1"); } catch (e) {}
  const c = newCompany({name: "Larkspur Fixture Events Private Limited", gstin: "07AAGCL4827M1Z3"});
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  // the books' items, kept by the test between reloads (a.items)
  window.__items = a.items || []; window.__api = [];
  Cloud.api = async (path, o) => { window.__api.push([path, o && o.body ? JSON.parse(JSON.stringify(o.body)) : null]);
    if (/^rpc\\/save_book_items/.test(path)){ (o.body.p_items || []).forEach(it => { window.__items = window.__items.filter(x => !(x.k === it.k && x.i === it.i)).concat([Object.assign(JSON.parse(JSON.stringify(it)), {by: "u-1"})]); }); return {ok: true, at: new Date().toISOString()}; }
    if (/^client_book_items/.test(path)){ const k = (path.match(/key=eq\\.([^&]+)/) || [])[1]; return window.__items.filter(x => x.k === k && !x.del).map(it => ({item: it.i, data: it.d, updated_at: new Date().toISOString(), updated_by: it.by, deleted: false})); }
    return []; };
  Cloud.rpc = async (fn) => fn === "asst_settings" ? {enabled: true, owner: true, default_on: true, consent: true} : {};
  window.__saved = []; window.saveFile = async (name, blob) => { const u8 = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); window.__saved.push({name, b64: btoa(s)}); return true; };
  // the assistant's answer, fed as its stream (window.__answer: the events)
  window.__bodies = []; const real = window.fetch;
  window.fetch = (u, o) => { if (String(u) !== ASST.url()) return real(u, o);
    window.__bodies.push(JSON.parse(String(o.body))); const en = new TextEncoder(), evs = window.__answer || [];
    const st = new ReadableStream({start(cc){ evs.forEach(x => cc.enqueue(en.encode('data: ' + JSON.stringify(x) + '\\n\\n'))); cc.close(); }});
    return Promise.resolve(new Response(st, {headers: {'content-type': 'text/event-stream'}})); };
  // the books
  const ms = await Books.importMasters(new Blob([Uint8Array.from(atob(a.master), (ch) => ch.charCodeAt(0))], {type: "text/xml"}));
  const b = Object.assign({loading: false, challans: [], alloc: {}}, a.books, {cid: c.id, misCfg: {freq: "off"}, auditCfg: {freq: "off"}, ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, states: ms.states, gstins: ms.gstins, pans: ms.pans});
  b.map = Books.mapLedgers(b.vouchers, {}); S.books = b; window.__bk = b; LedMaster.refresh(b);
  S.coId = c.id; S.view = "company"; S.tab = "books"; S.booksTab = "mis"; S.myMis = null; render();
  await ASST.loadSettings(true).catch(() => {});
  return c.id;
}"""
def W(pg, ms=300): pg.wait_for_timeout(ms)
def shot(pg, name, full=False):
    p = os.path.join(OUT, name + ".png"); pg.screenshot(path=p, full_page=full); return p
def start(pg, items=None):
    pg.goto("http://localhost:%d/" % PORT[0]); W(pg, 2500)
    if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); W(pg, 1200)
    cid = pg.evaluate(SETUP, {"books": BOOKS, "master": MASTER, "items": items or []}); W(pg, 600)
    return cid
def mymis(pg):
    pg.evaluate("goClient('books:mymis')")
    for _ in range(60):
        if pg.locator("[data-mymis]").count(): break
        W(pg, 100)
    W(pg, 400)
def cell(pg, block_sel, row, col="t"):
    loc = pg.locator(block_sel + ' [data-mm-cell="%s|%s"]' % (row, col))
    return loc.first.inner_text() if loc.count() else None
def noside(pg):
    return pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1 && document.body.scrollWidth <= window.innerWidth + 1")

