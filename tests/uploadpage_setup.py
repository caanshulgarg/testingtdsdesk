"""The made-up client the Tally data upload page tests and screenshots use (tests/run_uploadpage_simple.py,
tests/shots_uploadpage.py). Works on the build before the simpler page too (it only sets data):
  - the fixture books (tests/fixtures/books) and their ledger masters (Master.xml), read as the masters upload does;
  - the day book brought in from two files with a month missing between them (the parts), opening balances from a trial
    balance file, and a check against Tally's trial balance with three ledgers that differ;
  - FinCom's cloud made up in the page: a Day Book on its way to Storage (the progress bar), the server's job for it
    ("Day Book 2026-27: 143 of 365 days read"), and lines Tally sent that only that day's Day Book settles (Needs you,
    the shared classifier Rec.needKind) on two days;
  - the role: "owner" or "staff".
open_page(pg, role, cloud=True, books=True) does all of it and opens Books -> From Tally.
month_file(ym) writes the fixture Day Book cut to one month (yyyymm), as Tally exports a month, and returns its path."""
import json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
from books_data import CACHE, DATA, GSTIN, COMPANY, OUT
BOOKS = json.load(open(CACHE))
MASTER = os.path.join(DATA, "Master.xml")
DAYBOOK = os.path.join(DATA, "DayBook.xml")
NEED_DAYS = ["2026-10-06", "2026-10-07"]
ENDED_WHY = "Tally did not give this entry when asked again; upload that day's Day Book to settle it"

def month_file(ym, name=None):
    return range_file(ym + "01", ym + "31", name or ("DayBook-%s.xml" % ym))

def range_file(from8, to8, name):
    raw = open(DAYBOOK, "rb").read()
    u16 = raw[:2] == b"\xff\xfe"
    text = raw.decode("utf-16le" if u16 else "utf-8").lstrip("﻿")
    head = text[:text.index("<TALLYMESSAGE")]
    msgs = re.findall(r"<TALLYMESSAGE[^>]*>\s*<VOUCHER [\s\S]*?</VOUCHER>\s*</TALLYMESSAGE>", text)
    keep = [m for m in msgs if from8 <= re.search(r"<DATE>(\d{8})</DATE>", m).group(1) <= to8]
    tail = text[text.rindex("</TALLYMESSAGE>") + len("</TALLYMESSAGE>"):]
    out = head + "\r\n".join(keep) + tail
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, name)
    open(p, "wb").write(b"\xff\xfe" + out.encode("utf-16le"))
    return p, len(keep)

CLIENT = """([bk, withBooks]) => {
  S.firm.firmName = S.firm.firmName || "Test Firm"; if (typeof closeModal === "function") try { closeModal(); } catch (e){}
  let c = Object.values(S.companies).find(x => x.name === "ZZ Test Client");
  if (!c){ c = newCompany({name: "ZZ Test Client", gstin: "@GSTIN@", tallyName: "@CO@"}); S.companies[c.id] = c; }
  S.data[c.id] = S.data[c.id] || {parties: {}, entries: {}, loaded: true};
  S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false; S.dbFrom = ""; S.dbTo = "";
  S.books = withBooks ? Object.assign({loading: false, challans: [], alloc: {}}, JSON.parse(JSON.stringify(bk)), {cid: c.id})
    : {loading: false, cid: c.id, vouchers: [], map: {}, meta: {}, alloc: {}, challans: [], misCfg: {freq: "off"}, auditCfg: {freq: "off"}};
  S.books.map = Books.mapLedgers(S.books.vouchers, {});
  window.__bk = S.books; S.booksTab = "import"; render();
  if (!document.getElementById("__mx")){ const i = document.createElement("input"); i.type = "file"; i.id = "__mx"; i.style.display = "none"; document.body.appendChild(i); }
  return c.id; }""".replace("@GSTIN@", GSTIN).replace("@CO@", COMPANY)
# as booksChange does for #mastersIn (src/js/23), without the company check's question
MASTERS = """async () => {
  const b = S.books = window.__bk, f = document.getElementById("__mx").files[0];
  const res = await Books.importMasters(f, () => {});
  b.pans = res.pans; b.gstins = res.gstins; b.under = res.under; b.states = res.states; b.groups = res.groups; b.groupInfo = res.groupInfo; TallyRead.yearOpen(b);
  b.ledInfo = res.info; b.ledInfoAt = new Date(Date.now() - 3 * 86400000).toISOString(); LedMaster.refresh(b);
  return Object.keys(b.ledInfo).length; }"""
# the parts, the balances, the check; FinCom's cloud made up in the page
STATE = """([role, cloud, books, needDays, why]) => {
  const b = S.books, cid = b.cid, now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  if (books){
    const m = b.meta = b.meta || {}, at = ago(60 * 26);
    m.file = "day book files from Tally"; m.at = at;
    m.parts = [{from: m.from, to: "20250731", n: 31, file: "DayBook-Apr-Jul.xml", at, bridge: "not connected on this computer", cloud: "with FinCom’s server (122 days), read in by the server"},
               {from: "20250901", to: m.to, n: 40, file: "DayBook-Sep-Mar.xml", at, bridge: "not connected on this computer", cloud: "with FinCom’s server (212 days), read in by the server"}];
    const led = {}; Object.keys(b.map).slice(0, 12).forEach((l, i) => { led[l] = {parent: "", open: String((i % 2 ? 1 : -1) * 1000 * (i + 1)), close: ""}; });
    b.tb = {from: m.from, to: m.to, led, source: "the trial balance file TB-31-03-2025.xml", openAsOn: "20250331"};
    const ls = Object.keys(b.map).slice(0, 3);
    b.tbCheck = {at: ago(60), on: m.to, file: "TB-31-03-2026.xml", ok: false, n: 3, ledgers: 64, list: ls.map((l, i) => [l, -10000 * (i + 1), -10000 * (i + 1) + 500 * (i + 1), 500 * (i + 1)])};
  }
  window.__rpc = []; window.__api = []; window.__keep = [];
  if (cloud){
    Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
    TCloud.on = () => true;
    Cloud.api = async (p) => { window.__api.push(p); return []; };
    TCloud.restAll = async (p) => { window.__api.push(p); return []; };
    TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
    TCloud.jobsLoad = async () => {};
    TCloud.jobs[cid] = [{id: "job-1", client_id: cid, kind: "upload", status: "running", total: 365, done: 143, sealed: true, bad: [], message: "DayBook.xml", created_at: ago(20), updated_at: ago(1)}];
    TCloudUp.periods["job-1"] = "2026-27";
    TCloudUp.prog[cid] = {name: "DayBook-2026-27.xml", sent: 41 * 1048576, size: 96 * 1048576};
    let id = 900;
    const rows = []; needDays.forEach((d, k) => { for (let i = 0; i <= k; i++) rows.push({id: ++id, client_id: cid, book_id: "bk-zz", device_id: "d-1", pc: "NWS144", company: "@CO@", event: "created", object_guid: "g-" + id,
      alter_id: id, state: "held", held_why: why, received_at: ago(30), vch_type: "Sales", vch_no: String(id), vch_date: d, ledgers: []}); });
    AlertHub.held = {rows, at: now, busy: false, none: false};
    if (Rec.gaps) Object.assign(Rec.gaps, {at: now, busy: false, byClient: {}});
    if (Rec.alerts) Object.assign(Rec.alerts, {at: now, busy: false});
  } else {
    TCloud.on = () => false; delete TCloud.jobs[cid]; delete TCloudUp.prog[cid]; AlertHub.held = {rows: [], at: now, busy: false, none: true};
  }
  document.body.classList.add("is-test");
  S.booksTab = "import"; render(); return cid; }""".replace("@CO@", COMPANY)


def open_page(pg, role="owner", cloud=True, books=True):
    E = pg.evaluate
    cid = E(CLIENT, [BOOKS, books]); pg.wait_for_timeout(500)
    if books:
        pg.set_input_files("#__mx", MASTER)
        E(MASTERS); pg.wait_for_timeout(300)
    E(STATE, [role, cloud, books, NEED_DAYS, ENDED_WHY]); pg.wait_for_timeout(900)
    E("() => { if (typeof toastHide === 'function') toastHide(); }")
    return cid


def start(p, port, site, width=1366, height=900, errors=None):
    import threading, functools, http.server
    class Q(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    srv = http.server.ThreadingHTTPServer(("localhost", port), functools.partial(Q, directory=site)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": width, "height": height})
    if errors is not None: pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json", body="{}"))
    pg.goto("http://localhost:%d/" % port); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1000)
    return srv, br, pg
