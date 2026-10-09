"""The made-up client the GST and TDS ledger page tests and screenshots use (tests/run_ledpage_simple.py,
tests/shots_ledpage.py). Works on a build before the simpler page too (it only sets data):
  - the fixture books (tests/fixtures/books: 77 entries) and their ledger masters (Master.xml), read as the masters
    upload does;
  - three made-up party ledgers for the checks: two with the same GSTIN, one whose PAN is not the one in its GSTIN;
  - FinCom's cloud made up in the page: one book with its ledger list (2 minutes old), a ledger renamed in Tally whose
    saved choices were carried (migration 39), and two entries naming a ledger FinCom does not have (migration 56);
  - one ledger FinCom cannot tell (GST in its name, nothing else known);
  - the role: "owner" or "staff".
open_page(pg, role, cloud=True) does all of it and opens Books -> Tally ledgers."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
from books_data import CACHE, DATA, GSTIN, COMPANY
BOOKS = json.load(open(CACHE))
MASTER = os.path.join(DATA, "Master.xml")
SAME_GSTIN = "07AAAPS1234K1Z5"
PARTIES = {"Sharma Traders": {"group": "Sundry Creditors", "gstin": SAME_GSTIN, "pan": "AAAPS1234K"},
           "Sharma Traders (Old)": {"group": "Sundry Creditors", "gstin": SAME_GSTIN, "pan": "AAAPS1234K"},
           "Kumar Consultants": {"group": "Sundry Creditors", "gstin": "07ABCPK9999D1Z2", "pan": "ABCPK1234D"}}
RENAMED = "TDS ON CONTRACT 194C"
UNCLEAR = "GST Adjustment Misc"
UNKNOWN = [{"book_id": "bk-zz", "client_id": "CID", "guid": "g-2", "vtype": "Journal", "vno": "J-2", "day": "2026-09-02", "ledgers": ["New Party Pvt Ltd"]},
           {"book_id": "bk-zz", "client_id": "CID", "guid": "g-3", "vtype": "Payment", "vno": "P-7", "day": "2026-09-03", "ledgers": ["New Party Pvt Ltd"]}]
CLIENT = """(bk) => {
  S.firm.firmName = S.firm.firmName || "Test Firm"; if (typeof closeModal === "function") try { closeModal(); } catch (e){}
  let c = Object.values(S.companies).find(x => x.name === "ZZ Test Client");
  if (!c){ c = newCompany({name: "ZZ Test Client", gstin: "@GSTIN@", tallyName: "@CO@"}); S.companies[c.id] = c; }
  if (!Object.values(S.companies).some(x => x.name === "ZZ Other Client")){ const o = newCompany({name: "ZZ Other Client", gstin: ""}); S.companies[o.id] = o; }
  S.data[c.id] = S.data[c.id] || {parties: {}, entries: {}, loaded: true};
  S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  S.books = Object.assign({loading: false, challans: [], alloc: {}}, JSON.parse(JSON.stringify(bk)), {cid: c.id}); S.books.map = Books.mapLedgers(S.books.vouchers, {});
  window.__bk = S.books; S.booksTab = "import"; render();
  if (!document.getElementById("__mx")){ const i = document.createElement("input"); i.type = "file"; i.id = "__mx"; i.style.display = "none"; document.body.appendChild(i); }
  return c.id; }""".replace("@GSTIN@", GSTIN).replace("@CO@", COMPANY)
# as booksChange does for #mastersIn (src/js/23), without the company check's question
MASTERS = """async (parties) => {
  const b = S.books = window.__bk, f = document.getElementById("__mx").files[0];
  const res = await Books.importMasters(f, () => {});
  b.pans = res.pans; b.gstins = res.gstins; b.under = res.under; b.states = res.states; b.groups = res.groups; b.groupInfo = res.groupInfo; TallyRead.yearOpen(b);
  b.ledInfo = res.info; b.ledInfoAt = new Date(Date.now() - 3 * 86400000).toISOString();
  Object.entries(parties).forEach(([n, p]) => { b.ledInfo[n] = {group: p.group, gstin: p.gstin, pan: p.pan, taxType: ""}; b.gstins[n] = p.gstin; b.pans[n] = p.pan; (b.under = b.under || {})[n] = p.group; });
  LedMaster.refresh(b);
  // a ledger FinCom cannot tell: GST in the name, nothing else known
  b.map["GST Adjustment Misc"] = {n: 0, what: ""};
  if (typeof LedCheck === "object") LedCheck.run(b);
  return Object.keys(b.ledInfo).length; }"""
# FinCom's cloud made up in the page; role: owner | staff
CLOUD = """([role, renamed, unknown, cloud]) => {
  const b = S.books, cid = b.cid, now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  window.__rpc = []; window.__rest = [];
  const bk = {book: "bk-zz", from: "2025-04-01", to: "2026-03-31", ledgersAt: ago(2), company: "@CO@", ledgers: Object.keys(b.ledInfo || {}).length};
  if (cloud){ TCloud.st[cid] = {books: [bk], at: Date.now()}; } else { delete TCloud.st[cid]; }
  TCloud.status = async function(x){ return (this.st[x] || {}).books || []; };
  const rows = Object.entries(b.ledInfo || {}).map(([n, i]) => ({name: n, parent: i.group || "", gstin: i.gstin || "", pan: i.pan || "", needs_confirm: n === renamed,
    before_clean: n === renamed ? {renamed: [{from: n + " 2%", at: ago(60), confirm: true, carried: {items: 1, flow: 0, values: 0, clash: []}}]} : null}));
  window.__ledRows = rows;
  TCloud.restAll = async (p) => { window.__rest.push(p);
    if (/^tally_ledgers/.test(p)) return JSON.parse(JSON.stringify(window.__ledRows));
    if (/^tally_groups/.test(p)) return [];
    return []; };
  Cloud.api = async (p) => { window.__rest.push(p); return []; };
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === "tally_unknown_ledger_entries") return cloud ? JSON.parse(JSON.stringify(unknown)).map(r => Object.assign(r, {client_id: cid})) : [];
    if (fn === "tally_ledger_rename_confirm"){ window.__ledRows.filter(r => r.name === a.p_name).forEach(r => { r.needs_confirm = false; }); return {ok: true, cleared: 1}; }
    return {ok: true}; };
  if (typeof Rec === "object"){ Rec.unk = {}; }
  if (typeof Ledgers === "object"){ delete Ledgers.st[cid]; Ledgers.seen[cid] = Date.now(); }
  document.body.classList.add("is-test");
  return cid; }""".replace("@CO@", COMPANY)
# the cloud's ledger list read as the page does, then the ledgers tab
OPEN = """async ([cloud]) => {
  const cid = S.books.cid;
  if (cloud && typeof Ledgers === "object"){ await Ledgers.load(cid, {force: true}); Ledgers.seen[cid] = Date.now(); }
  if (typeof Rec === "object" && cloud){ const bks = Rec.unkBooks(cid); await Rec.unkLoad(bks.length ? bks : null); }
  S.lmView = ""; S.ledQ = ""; S.booksTab = "ledgers"; render(); }"""


# FinCom 2.4.1: one ledger confirmed by hand that FinCom's check reads otherwise (07 CGST OUTPUT confirmed as SGST; the
# check reads it as CGST, from Tally's duty head and its name), for the "Please check" section. Only data: works on any build
DIFFERS = "07 CGST OUTPUT"
SET_DIFFERS = """(n) => { const b = S.books, m = b.map[n]; m.tax = 'SGST'; m.byHand = true; m.ok = true; m.okBy = 'asha@firm.test';
  m.okAt = '2026-10-01T10:38:00.000Z'; b.mapV = (b.mapV || 0) + 1; if (typeof LedPage === 'object') LedPage.ensure(b); render(); }"""


def open_page(pg, role="owner", cloud=True):
    E = pg.evaluate
    cid = E(CLIENT, BOOKS); pg.wait_for_timeout(600)
    pg.set_input_files("#__mx", MASTER)
    n = E(MASTERS, PARTIES); pg.wait_for_timeout(300)
    E(CLOUD, [role, RENAMED, UNKNOWN, cloud])
    E(OPEN, [cloud]); pg.wait_for_timeout(900)
    E("() => { if (typeof toastHide === 'function') toastHide(); }")
    return cid, n


def start(p, port, site, width=1366, height=900, errors=None):
    import threading, functools, http.server
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Q, directory=site)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": width, "height": height})
    if errors is not None: pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    return srv, br, pg
