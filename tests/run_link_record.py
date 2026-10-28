"""python3 run_link_record.py - ONE cloud link record per client <-> Tally company (next-link-record, 26-Oct-2026; migration 110,
public.tally_links; src/js/98-link-record.js, lib/linkStatus.js, parts/LinkStatus.jsx). A stand-in for FinCom's cloud
inside the page keeps the companies (tally_companies), the records (tally_links) and the clients' saved copies, and
answers the link functions as migration 110 does (run_migration110.py tests the SQL itself). Made-up records only.
  1. Link -> the record: the Tally page's Link calls the link function once; the record says linked, posting allowed; the
     client's chip and status line say so; the posting gate allows that company; clients.data postTo is written from the
     record (for older code paths) and the record is no part of the client's saved copy. A company whose GUID is linked to
     another client: "Could not link it: already linked to its easy" on its row, nothing changed.
  2. Renamed in Tally (the same GUID): still linked: one row, the new name ("renamed in Tally"), Linked, posting into
     the new name allowed; the new name is not offered as another company.
  3. A second browser cannot undo it: its older copy of the client (no postTo) saved over the cloud's leaves the record as
     it is and the gate still allows; its "Stop posting" from an out-of-date view is refused and read again.
  4. The posting gate reads the record: posting stopped in the record while clients.data still names the company ->
     refused in the record's words, nothing queued; the gate's one button allows it in the record; then the bill posts.
  5. One word per client (the owner's step 2): Linked (reading · posting allowed · last entry HH:MM) / Waiting for Tally
     (one plain line "Open <company> in TallyPrime on <PC>": Tally closed, the company not open, the computer offline) /
     Needs you (one line, one button: posting stopped, the bridge cannot reach Tally on its port) / Not linked (Link); a
     Tally on port 4125 the bridge reaches is fine; the same word on the header's Tally icon, the Clients list, the Tally
     page's row and Post to Tally. (next-tally-icon: the icon's popover says it in plain words, run_tally_icon.py)
  7. The same company in two places (a copied data folder keeps the GUID): ONLY two different real folders that each sent
     entries (migration 127; fourteen near misses never raise it); Needs you, Choose; the Tally page's card
     (① the place FinCom reads, ② the other, nothing of it applied); an owner's Use ② asks the cloud; staff see no choice.
  8. Check my Tally: the bridge's false "not accepting connections on port N" is left out while the bridge reaches Tally.
  6. Before migration 110 (no record at all): the old rules (tally_companies, clients.data postTo).
Options: --shots DIR (default: none) saves the screens.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_link_record.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = int(os.environ.get("LINK_PORT") or 8471)
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
ME, OTHER = "owner@firm.test", "ravi@firm.test"
D1 = "d0000000-0000-4000-8000-000000000001"
GA, GE = "aaaa0001-0000-0000-0000-00000000000a", "eeee0001-0000-0000-0000-00000000000e"
ALPHA, ALPHA2, ITS, ITS2 = "ALPHA TRADERS LTD", "ALPHA TRADERS PRIVATE LIMITED", "ITS EASY", "ITSEASY SOLUTIONS"
CA, CE, CS, CU = "cl-alpha", "cl-itseasy", "cl-itssol", "cl-nolink"
CLIENTS = [{"id": CA, "name": "Alpha Traders Ltd"}, {"id": CE, "name": "its easy"}, {"id": CS, "name": "ITSEasy Solutions Pvt Ltd"}, {"id": CU, "name": "Beta Works"}]
def dev(opened, cos, at="ago:0.5", tally="open", port=9005, bridges=None, ports=None, folder="C:\\Users\\anshul\\TallyPrime\\Data"):
    """NWS144: anshul's bridge (main); cos: [(name, guid)] the beat's companies; bridges: more {id: entry}"""
    me = {"at": at, "version": "2.4.7", "computer": "NWS144", "user": "anshul", "mode": "main", "runMode": "user", "tally": tally == "open", "tallyState": tally,
          "open": list(opened), "tallyPort": port, "dataFolder": folder, "recorder": {c: {"seen": True, "lastAt": "ago:3"} for c in opened}}
    beat = {"at": at, "every": 30, "tally": tally == "open", "tallyState": tally, "open": list(opened), "paused": False, "windowsUser": "anshul", "tallyPort": port,
            "lastRead": "ago:3", "ports": ports if ports is not None else [{"port": port, "ok": tally == "open", "skipped": False, "n": 1, "error": "", "state": tally}], "dataFolder": folder,
            "companies": [{"name": n, "guid": g, "open": n in opened, "at": "ago:3", "lastRead": "ago:3"} for n, g in cos]}
    b = {"go-1": me}; b.update(bridges or {})
    return {"id": D1, "name": "NWS144", "revoked": False, "last_seen": at, "version": "2.4.7", "main_bridge": "go-1", "created_at": "2026-09-01T00:00:00Z",
            "info": {"computer": "NWS144", "user": "anshul", "beat": beat, "bridges": b}, "post_only": [], "post_batch_bills": 10, "post_batch_bank": 50, "trial_tools": False, "recorder_source": "addon"}
row = lambda name, book, client=None, at="ago:2", linked=None: {"company": name, "book_id": book, "client_id": client, "device_id": D1, "gstin": None, "last_seen": at, "linked_at": linked, "linked_by": None}
rec = lambda name, book, client, guid, allowed=True, v=1: {"book_id": book, "client_id": client, "company_guid": guid, "company_name": name, "gstin": None, "device_id": D1, "computer": "NWS144",
                                                          "posting_allowed": allowed, "state": "linked", "linked_by": "u-1", "linked_at": "ago:600", "updated_by": "u-1", "updated_at": "ago:600", "version": v, "how": "backfill"}
OPEN = [ALPHA, ITS, ITS2]
BEAT = [(ALPHA, GA), (ITS, GE), (ITS2, GE)]
def store(links=None, cos=None, devs=None):
    return {"cos": cos or [row(ALPHA, "b-alpha"), row(ITS, "b-its", CE, linked="ago:600"), row(ITS2, "b-its2")],
            "links": [rec(ITS, "b-its", CE, GE)] if links is None else links, "devs": devs or [dev(OPEN, BEAT)]}
# the page's stand-in for the cloud: the companies, the records, the clients' saved copies; the link functions as 110
SETUP = """async ([st, role, email, clients]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.st.firm = 'f0000000-0000-0000-0000-00000000000f'; Cloud.st.email = email; Cloud.st.members = []; Cloud.on = () => true; TCloud.on = () => true;
  if (typeof LocalOwner === 'object') LocalOwner.mayPush = () => true;
  document.body.classList.add('is-test'); S.firm.firmName = 'Test Firm';
  S.account = Object.assign({}, S.account || {}, {me: Object.assign({}, (S.account || {}).me || {}, {role})});
  window.__devs = fix(st.devs); window.__cos = fix(st.cos); window.__links = fix(st.links); window.__places = fix(st.places || []); window.__rpc = window.__rpc || []; window.__cl = st.cl ? copy(st.cl) : (window.__cl || {});
  for (const c0 of clients){
    let c = S.companies[c0.id];
    if (!c){ c = newCompany({name: c0.name, gstin: ''}); c.id = c0.id; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c); }
    if (!window.__cl[c.id]){ const snap = cloudSnapshot().find(r => r.kind === 'client' && r.id === c.id); window.__cl[c.id] = copy(snap.data); }
  }
  for (const id of Object.keys(window.__cl)){ const m = Cloud.marks(); m['client|' + id + '|' + id] = fpHash(JSON.stringify(window.__cl[id])); Cloud.setMarks(m); await ClientBase.set(id, window.__cl[id]); }
  const idOf = (p) => { const m = /id=eq\\.([^&]+)/.exec(p); return m ? decodeURIComponent(m[1]) : ''; };
  Cloud.api = async (path, opts) => { const me = (opts || {}).method || 'GET';
    if (me !== 'GET'){ const body = copy((opts || {}).body || null), b = Array.isArray(body) ? body[0] : body;
      if (path.startsWith('clients') && b && b.data){ const id = b.id || idOf(path); if (id) window.__cl[id] = b.data; return [{data: b.data}]; } return null; }
    if (path.startsWith('clients?')){ const id = idOf(path); return id && window.__cl[id] ? [{id, data: copy(window.__cl[id]), updated_at: 'x', deleted: false}] : []; }
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_companies/.test(path)) return copy(window.__cos);
    if (/^tally_links/.test(path)) return copy(window.__links);
    if (/^tally_link_places/.test(path)) return copy(window.__places);
    if (/tally_post_jobs/.test(path)) return [{id: 'x', status: 'done', done: 1, n: 1, message: '1 of 1 in Tally', checking: false, company: '', results: null}];
    return []; };
  const nm = (s) => String(s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const guidOf = (name) => { for (const d of window.__devs) for (const c of (((d.info || {}).beat || {}).companies || [])) if (nm(c.name) === nm(name) && c.guid) return c.guid.toLowerCase(); return null; };
  TCloud.rpc = async (fn, a) => { window.__rpc.push([fn, copy(a || {})]);
    const L = window.__links, C = window.__cos;
    if (fn === 'tally_company_link' || fn === 'tally_link_set'){
      const r = C.find(x => x.company === a.p_company);
      if (!r) throw new Error('no computer has reported ' + a.p_company + ' yet; open it in Tally on a connected computer first');
      const g = guidOf(r.company), was = L.find(l => l.book_id === r.book_id);
      if (!a.p_client){ if (was && was.state === 'linked') Object.assign(was, {state: 'unlinked', client_id: null, posting_allowed: false, version: was.version + 1}); r.client_id = null; return null; }
      const other = g && L.find(l => l.state === 'linked' && l.company_guid === g && l.book_id !== r.book_id);
      if (other && other.client_id !== a.p_client) throw new Error('already linked to ' + ((S.companies[other.client_id] || {}).name || 'another client'));
      if (was && was.state === 'linked' && was.client_id === a.p_client) was.version++;
      else if (was) Object.assign(was, {state: 'linked', client_id: a.p_client, posting_allowed: true, version: was.version + 1, how: 'person'});
      else L.push({book_id: r.book_id, client_id: a.p_client, company_guid: g, company_name: r.company, gstin: null, device_id: r.device_id, computer: 'NWS144', posting_allowed: true, state: 'linked',
        linked_by: 'u-me', linked_at: new Date().toISOString(), updated_by: 'u-me', updated_at: new Date().toISOString(), version: 1, how: 'person'});
      r.client_id = a.p_client; return null; }
    if (fn === 'tally_link_posting'){
      const r = L.find(l => l.book_id === a.p_book);
      if (!r || r.state !== 'linked') throw new Error('this Tally company is not linked to a client');
      if (a.p_version != null && a.p_version !== r.version) throw new Error('changed by someone else since you looked; look again');
      if (r.posting_allowed !== !!a.p_allowed){ r.posting_allowed = !!a.p_allowed; r.version++; }
      return copy(r); }
    if (fn === 'tally_post_enqueue' || fn === 'tally_post_enqueue_to'){
      const r = L.find(l => l.state === 'linked' && l.client_id === a.p_client && l.posting_allowed);
      return r ? {ok: true, id: a.p_id, company: r.company_name} : {ok: false, notAllowed: true, error: 'Posting into Tally is stopped for this client.'}; }
    if (fn === 'tally_link_place_choose'){ window.__places.forEach(x => { if (x.book_id === a.p_book) x.state = x.data_loc === a.p_loc ? 'chosen' : 'not_used'; });
      const r = L.find(l => l.book_id === a.p_book); r.data_loc = a.p_loc; r.version++; return copy(r); }
    if (fn === 'tally_status') return (TCloud.st[a.p_client] || {}).books || [];
    return null; };
  Cloud.rpc = async (fn, a) => { window.__rpc.push([fn, copy(a || {})]); return null; };
  LinkRec.st = {rows: null, at: 0, p: null, missing: false, err: '', guid: {}, now: null};
  TCloud.pane = {devices: null, companies: null, busy: '', err: '', at: 0, stops: []};
  TLight.st.at = 0; TLight.st.busy = false; TLight.st.p = null; TLight.st.cos = []; TLight.st.devs = []; TLight.st.loaded = false;
  if (typeof Rec === 'object') Rec.act = {rows: [], at: Date.now()};
  S.tallyOld = false; S.tallyTab = 'computers'; S.tallyMore = {}; S.tallyFocus = ''; S.tallyGuide = {};
  await TLight.refresh();
  // the books FinCom's cloud keeps for each linked client (a posting goes through the cloud for a client it keeps)
  window.__links.filter(l => l.state === 'linked').forEach(l => { TCloud.st[l.client_id] = {at: Date.now(), books: [{from: '2025-04-01', book: l.book_id, company: l.company_name}]}; });
  // the Tally page's read too (the computers decide where a posting goes)
  TCloud.pane.devices = copy(window.__devs); TCloud.pane.companies = TLight.st.cos; TCloud.pane.at = Date.now();
  return true;
}"""
REFRESH = "async () => { LinkRec.st.at = 0; TLight.st.at = 0; TLight.st.busy = false; TLight.st.p = null; await TLight.refresh(); try { await TCloud.refreshPane(); } catch (e) {} render(); }"
STORE = "() => ({cos: window.__cos, links: window.__links, devs: window.__devs, cl: window.__cl})"
PT = "(cid) => { const c = S.companies[cid], ch = choiceGet(c, 'postTo') || {}; return {value: ch.value || '', state: ch.state || '', why: ch.why || '', postTo: c.postTo || ''}; }"
BILLS = """async () => {
  const c = CO(), now = new Date().toISOString();
  choiceConfirm(c, 'tds:professional', 'TDS Payable - Professional');
  const e = newEntry('Manual entry'); Object.assign(e.x, {vendorName: 'Alpha Consultants', vendorGstin: '', invoiceNo: 'A/1', invoiceDate: '2026-07-01', taxable: 100000, total: 100000});
  e.natureId = 'professional'; e.partyLedger = 'Alpha Consultants'; e.expenseLedger = 'Professional Charges'; S.data[c.id].entries[e.id] = e; approve(e);
  refreshStats(c.id); goStep('post', 'bills');
  await new Promise(r => setTimeout(r, 700));
  S.bank.loading = false;
  S.bank.ledgers = Object.assign({}, S.bank.ledgers, {importedAt: now, live: true, list: ['Alpha Consultants', 'Professional Charges', 'TDS Payable - Professional'].map(n => ({name: n, group: ''}))});
  window.ensureTallyCompany = async () => c.postTo || ''; window.syncLedgersFromTally = async () => true; window.tallyCall = async () => ({vouchers: []});
  render();
}"""

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def page(ctx=None, w=1440, h=900):
            pg = (ctx or br).new_page(viewport={"width": w, "height": h}) if ctx is None else ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
                body=json.dumps({"setup": {"version": "2.4.7", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.7.exe", "sha256": "ab" * 32}})))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            # the screens' files (with src/js/98-link-record.js) come once the first page is up
            pg.wait_for_function("() => typeof LinkRec === 'object' && typeof LinkWord === 'function'", timeout=30000)
            return pg
        def shot(pg, name, sel=None):
            if not SHOTS: return
            os.makedirs(SHOTS, exist_ok=True)
            if sel and pg.locator(sel).count():
                b = pg.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return {x: Math.max(0, r.left + scrollX - 8), y: Math.max(0, r.top + scrollY - 8), width: r.width + 16, height: r.height + 16}; }", sel)
                pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True, clip=b)
            else: pg.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=False)
        T = lambda pg, sel: re.sub(r"\s+", " ", pg.inner_text(sel)).strip() if pg.locator(sel).count() else ""
        R = lambda co: '#app [data-tco-list=firm] [data-tco-row="%s"]' % co
        def tally_page(pg):
            pg.evaluate("() => { S.coId = null; S.view = 'home'; navHome('tally'); }"); pg.wait_for_timeout(1500)
        def client_page(pg, cid):
            pg.evaluate("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", cid); pg.wait_for_timeout(1500)
        # next-tally-icon: the client's one word is the header's Tally icon; its popover says the line and the action
        KIND = {"Linked": "linked", "Waiting for Tally": "waiting", "Needs you": "needs", "Not linked": "unlinked"}
        def status(pg, keep=False):
            if not pg.locator("header.top [data-tally-icon]").count(): return None
            if not pg.locator("header.top [data-tally-pop]").count(): pg.click("header.top [data-tally-icon]")
            pg.wait_for_selector("header.top [data-tally-pop] [data-tally-pop-word]", timeout=15000); pg.wait_for_timeout(300)
            r = pg.evaluate("() => { const e = document.querySelector('header.top [data-tally-pop]'), i = document.querySelector('header.top [data-tally-icon]'); return {word: e.querySelector('[data-tally-pop-word]').innerText.trim(),"
                            " words: (e.querySelector('[data-tally-pop-line]') || {innerText: ''}).innerText.trim(), buttons: [...e.querySelectorAll('[data-tally-pop-act]')].map(b => b.getAttribute('data-tally-pop-act')), title: i.getAttribute('aria-label'), text: e.innerText}; }")
            r["state"] = KIND.get(r["word"], r["word"])
            if not keep: pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
            return r
        chip = lambda pg: pg.evaluate("() => { const b = document.querySelector('header.top [data-tally-icon]'); return b ? b.getAttribute('data-tally-pill') : null; }")
        word = lambda pg: re.sub(r"^Tally: ([^—]+?)( — .*)?$", r"\1", pg.get_attribute("header.top [data-tally-icon]", "aria-label") or "")
        # the client's line as lib/linkStatus.js says it (the Tally page's row; the icon says it in plain words)
        lw = lambda pg, cid: pg.evaluate("(c) => LinkWord(S.companies[c]).text", cid)
        rpc = lambda pg, fn: [r for r in pg.evaluate("window.__rpc") if r[0] == fn]
        # integ-link (27-Oct-2026): the top bar's Tally sign is about THIS computer; with no bridge here it never reads like a
        # problem of a client that is Linked or Waiting for Tally ("Tally not on this computer" beside "Linked")
        # (next-tally-icon: no words on the header at all; the icon says the client's word on hover and in its popover)
        def here_ok(pg, w):
            t = pg.inner_text("header.top")
            ok("This PC" not in t and "Tally not on this computer" not in t and w not in t, "%s: no Tally words in the header, the icon says it" % w)
        # integ-link: "Not saved: ..." stays one line (shortened, the whole of it in its tip) at 1366 and 1440 wide, beside the
        # title row's status line
        def save_one_line(pg):
            for w in (1366, 1440):
                pg.set_viewport_size({"width": w, "height": 900})
                pg.evaluate("() => { Live.sv = Object.assign({}, Live.sv, {state: 'error', err: 'records: 500 the server did not take the change (made-up)'}); render(); }"); pg.wait_for_timeout(400)
                m = pg.evaluate("() => { const e = document.querySelector('.tsave.bad'); if (!e) return null; const r = e.getBoundingClientRect(), lh = parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.3;"
                                " const tb = document.querySelector('header.top .headrow > .tbar'), f = document.querySelector('header.top .tb-page').firstElementChild.getBoundingClientRect();"
                                " return {h: r.height, w: r.width, lh, title: e.title, text: e.textContent, sw: document.documentElement.scrollWidth, iw: innerWidth, titleRight: tb.getBoundingClientRect().right, pageLeft: f.left}; }")
                ok(m and m["h"] <= m["lh"] * 1.5 and m["w"] >= 150 and m["text"].startswith("Not saved: ") and "the server did not take the change" in m["title"] and "500" in m["title"] and m["sw"] <= m["iw"] + 1
                   and m["titleRight"] <= m["pageLeft"] + 0.5,
                   "%d wide: 'Not saved: ...' on one line, at least 150 px, the whole of it in its tip (%s)" % (w, m))

        print("== 1. Link -> the record")
        pg = page(); E = lambda js, *a: pg.evaluate(js, *a)
        E(SETUP, [store(), "owner", ME, CLIENTS])
        tally_page(pg)
        ok(pg.locator(R(ALPHA) + " [data-tco-act=pick]").count() == 1 and E("(c) => tallyLinkOf(S.companies[c]).state", CA) == "unlinked", "before: Alpha Traders not linked, its row offers Link to client…")
        pg.click(R(ALPHA) + " [data-tco-act=pick]"); pg.wait_for_timeout(250); pg.click(R(ALPHA) + " [data-tco-relink]"); pg.wait_for_timeout(2500)
        lk = rpc(pg, "tally_company_link")
        ok(lk == [["tally_company_link", {"p_company": ALPHA, "p_client": CA}]], "Link calls the link function once, for this client (%s)" % lk)
        r = E("(b) => window.__links.find(l => l.book_id === b)", "b-alpha")
        ok(r and r["client_id"] == CA and r["posting_allowed"] is True and r["company_guid"] == GA and r["state"] == "linked", "the record: linked to Alpha Traders, keyed by its GUID, posting allowed (%s)" % r)
        ok(E("(c) => (LinkRec.forClient(c)[0] || {}).book_id", CA) == "b-alpha", "the page read the record again")
        ok(pg.get_attribute(R(ALPHA), "data-tco-linked") == CA, "its row: linked to Alpha Traders")
        ok(E("(c) => postToProblem(S.companies[c], %r)" % ALPHA, CA) == "", "the gate allows posting into %s" % ALPHA)
        pt = E(PT, CA)
        ok(pt["value"] == ALPHA and pt["state"] == "confirmed" and pt["why"] == "from the Tally link record", "clients.data postTo written from the record, for older code paths (%s)" % pt)
        snap = E("(c) => JSON.stringify(cloudSnapshot().find(r => r.kind === 'client' && r.id === c).data)", CA)
        ok("posting_allowed" not in snap and GA not in snap and "company_guid" not in snap, "the record is no part of the client's saved copy")
        client_page(pg, CA)
        st = status(pg)
        ok(chip(pg) == "connected" and word(pg) == "Linked" and st and st["state"] == "linked" and st["words"].startswith("Connected to Tally · last entry "),
           "the client's Tally icon: Linked, and its line '%s'" % (st or {}).get("words"))
        here_ok(pg, "Linked")
        shot(pg, "1-linked-title", "header.top")
        # the same company (its GUID) linked to another client: refused on its row
        tally_page(pg)
        pg.click(R(ITS2) + " [data-tco-act=pick]"); pg.wait_for_timeout(300)   # Task D: Link to client…
        pg.select_option(R(ITS2) + " [data-tco-relink-pick]", CS); pg.click(R(ITS2) + " [data-tco-relink]")
        try: pg.wait_for_selector(R(ITS2) + " [data-tco-err]", timeout=15000)
        except Exception: pass
        err = T(pg, R(ITS2) + " [data-tco-err]")
        ok(err == "Could not link it: already linked to its easy", "%s (the GUID of its easy's company): 'Could not link it: already linked to its easy' on its row (%s)" % (ITS2, err))
        ok(E("(b) => !window.__links.some(l => l.book_id === b)", "b-its2") and E("(c) => tallyLinkOf(S.companies[c]).state", CS) == "unlinked", "nothing changed: no record, ITSEasy Solutions not linked")
        shot(pg, "1-already-linked", R(ITS2))

        print("== 2. renamed in Tally (the same GUID): still linked")
        E("""([n, g]) => { const d = window.__devs[0]; d.info.beat.companies = d.info.beat.companies.filter(c => c.name !== 'ALPHA TRADERS LTD').concat([{name: n, guid: g, open: true}]);
            d.info.beat.open = d.info.beat.open.map(x => x === 'ALPHA TRADERS LTD' ? n : x); d.info.bridges['go-1'].open = d.info.beat.open.slice();
            window.__cos.push({company: n, book_id: 'b-alpha-new', client_id: null, device_id: d.id, gstin: null, last_seen: new Date().toISOString(), linked_at: null, linked_by: null}); }""", [ALPHA2, GA])
        E(REFRESH); pg.wait_for_timeout(800)
        tally_page(pg)
        k = E("(c) => { const k = tallyLinkOf(S.companies[c]); return [k.state, k.company]; }", CA)
        ok(k[0] != "unlinked", "Alpha Traders is still linked (%s)" % k)
        rows = E("() => [...document.querySelectorAll('#app [data-tco-list=firm] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), r.getAttribute('data-tco-linked'), r.querySelector('.tco-name').innerText, r.getAttribute('data-tco-state')])")
        alpha = [x for x in rows if x[0] in (ALPHA, ALPHA2)]
        ok(len(alpha) == 1 and alpha[0][1] == CA and alpha[0][2] == ALPHA2 and pg.get_attribute(R(ALPHA) + " [data-tco-word]", "data-tco-word") == "linked", "one row, linked to Alpha Traders, showing the new name, Linked (%s)" % alpha)
        ok(pg.locator(R(ALPHA) + " [data-tco-renamed]").count() == 1, "marked 'renamed in Tally'")
        ok(E("(c) => postToProblem(S.companies[c], %r)" % ALPHA2, CA) == "", "posting into the new name is allowed")
        rw = T(pg, R(ALPHA) + " .tco-pill")
        ok(rw.startswith("Linked reading · posting allowed"), "the row: %s" % rw)
        shot(pg, "2-renamed-row", R(ALPHA))
        client_page(pg, CA)
        st = status(pg)
        ok(chip(pg) == "connected" and st and st["state"] == "linked", "the client's Tally icon: Linked (%s, %s)" % (chip(pg), st))
        saved = E(STORE)
        pg.close()

        print("== 3. a second browser cannot undo it")
        ctx2 = br.new_context(viewport={"width": 1440, "height": 900}); q = page(ctx2); EQ = lambda js, *a: q.evaluate(js, *a)
        old = json.loads(json.dumps(saved["cl"])); oa = old[CA]; oa.pop("choices", None); oa["postTo"] = ""; oa.pop("tallyName", None); oa.pop("postToBy", None); oa.pop("postToAt", None)
        EQ(SETUP, [dict(saved, cl=old), "staff", OTHER, CLIENTS])
        EQ("(c) => { S.companies[c].postTo = ''; delete S.companies[c].choices; S.companies[c].roundOff = 'x9'; Store.saveCompany(S.companies[c]); }", CA)
        EQ("cloudPush()"); q.wait_for_timeout(1200)
        cl = EQ("(c) => window.__cl[c]", CA)
        ok(cl.get("roundOff") == "x9" and not cl.get("postTo"), "its older copy (no postTo) went to the cloud (roundOff x9, postTo %r)" % cl.get("postTo"))
        r = EQ("(b) => window.__links.find(l => l.book_id === b)", "b-alpha")
        ok(r["client_id"] == CA and r["posting_allowed"] is True, "the record is as it was: linked, posting allowed")
        ok(EQ("(c) => postToProblem(S.companies[c], '')", CA) == "", "and its gate still allows posting (the record, not the copy)")
        # its view of the record goes out of date: posting stopped and allowed again elsewhere (version + 2)
        EQ("() => { const r = window.__links.find(l => l.book_id === 'b-alpha'); r.posting_allowed = false; r.version++; r.posting_allowed = true; r.version++; }")
        v_seen = EQ("(c) => LinkRec.forClient(c)[0].version", CA)
        tally_page(q)
        q.click(R(ALPHA) + " [data-tco-more] summary"); q.wait_for_timeout(250)
        q.click(R(ALPHA) + " [data-tco-post-stop]"); q.wait_for_timeout(300)
        q.wait_for_selector('#confirmBox [data-cbx="yes"]', state="visible", timeout=10000); q.click('#confirmBox [data-cbx="yes"]'); q.wait_for_timeout(1800)
        tries = [x for x in rpc(q, "tally_link_posting")]
        r = EQ("(b) => window.__links.find(l => l.book_id === b)", "b-alpha")
        ok(tries and tries[-1][1].get("p_version") == v_seen and r["posting_allowed"] is True, "its Stop posting named the version it had read (%s): refused, posting stays allowed" % v_seen)
        ok(EQ("(c) => LinkRec.forClient(c)[0].version", CA) == r["version"], "and it read the record again (version %s)" % r["version"])
        q.close(); ctx2.close()

        print("== 4. the posting gate reads the record")
        pg = page(); E = lambda js, *a: pg.evaluate(js, *a)
        st4 = json.loads(json.dumps(saved)); [x.update(posting_allowed=False) for x in st4["links"] if x["book_id"] == "b-alpha"]
        E(SETUP, [st4, "owner", ME, CLIENTS])
        E("([c, n]) => choiceConfirm(S.companies[c], 'postTo', n, {by: 'ravi@firm.test'})", [CA, ALPHA2])
        why = E("(c) => postToProblem(S.companies[c], '')", CA)
        ok(why.startswith("Posting into Tally is stopped for Alpha Traders Ltd"), "stopped in the record, clients.data naming the company: refused in the record's words (%s)" % why)
        client_page(pg, CA)
        E(BILLS); pg.wait_for_timeout(900)
        E("() => { window.__rpc = []; postAllToTally(); }"); pg.wait_for_timeout(2000)
        ok(not rpc(pg, "tally_post_enqueue") and not rpc(pg, "tally_post_enqueue_to"), "Post: nothing queued")
        pt = E(PT, CA)
        ok(pt["value"] == "" and pt["state"] == "confirmed", "the old field follows the record: posting stopped (%s)" % pt)
        prob = T(pg, "#app [data-post-problem]")
        btns = E("() => [...document.querySelectorAll('#app [data-post-problem] button')].map(b => b.innerText.trim()).filter(b => b !== 'Dismiss')")
        ok(("Allow posting to %s?" % ALPHA2) in prob and btns == ["Allow posting"], "the gate asks 'Allow posting to %s?' with one button (%s / %s)" % (ALPHA2, prob, btns))
        shot(pg, "4-gate-stopped", "#app [data-post-problem]")
        pg.click("#app [data-post-problem] button:has-text('Allow posting')"); pg.wait_for_timeout(2000)
        al = rpc(pg, "tally_link_posting")
        ok(al and al[-1][1].get("p_allowed") is True and E("(b) => window.__links.find(l => l.book_id === b).posting_allowed", "b-alpha") is True, "one click allows it in the record (%s)" % al[-1:])
        ok(E("(c) => postToProblem(S.companies[c], '')", CA) == "" and E(PT, CA)["value"] == ALPHA2, "the gate allows it; postTo follows (%s)" % E(PT, CA))
        E("() => { window.__rpc = []; postAllToTally(); }"); pg.wait_for_timeout(1000)
        if pg.locator('#confirmBox [data-cbx="yes"]').is_visible(): pg.click('#confirmBox [data-cbx="yes"]')
        pg.wait_for_timeout(2500)
        enq = rpc(pg, "tally_post_enqueue") + rpc(pg, "tally_post_enqueue_to")
        ok(len(enq) == 1 and enq[0][1].get("p_client") == CA, "Post: the bill goes to the cloud's queue (%s)" % str(enq)[:160])
        pg.close()

        print("== 5. one word per client: Linked / Waiting for Tally / Needs you, one line, at most one button")
        pg = page(); E = lambda js, *a: pg.evaluate(js, *a)
        def scene(devs, links=None):
            s5 = store(links=links if links is not None else [rec(ALPHA, "b-alpha", CA, GA), rec(ITS, "b-its", CE, GE)], devs=devs)
            s5["cos"][0]["client_id"] = CA
            E(SETUP, [s5, "owner", ME, CLIENTS]); client_page(pg, CA)
            return status(pg)
        st = scene([dev(OPEN, BEAT)])
        ok(st["state"] == "linked" and re.fullmatch(r"Connected to Tally · last entry \d{1,2}:\d\d [ap]m", st["words"]) and st["buttons"] == ["update"], "Linked · %s (Update now)" % st["words"])
        ok(st["title"].startswith("Tally: Linked — " + st["words"]), "its whole line on hover: %r" % st["title"])
        ok(re.fullmatch(r"Linked — reading · posting allowed · last entry \d\d:\d\d", lw(pg, CA)), "the record's words (the Tally page): %r" % lw(pg, CA))
        OPENW = "Open %s in TallyPrime on NWS144" % ALPHA
        for label, devs in [("Tally closed", [dev([], BEAT, tally="closed")]), ("the company not open", [dev([ITS], BEAT)]), ("the computer offline", [dev(OPEN, BEAT, at="ago:30")])]:
            st = scene(devs)
            ok(st["state"] == "waiting" and st["words"] == "Open %s in Tally" % ALPHA and st["buttons"] == ["check"] and word(pg) == "Waiting for Tally" and lw(pg, CA) == "Waiting for Tally — " + OPENW,
               "%s: Waiting for Tally, one plain line 'Open %s in Tally', Check again (%s)" % (label, ALPHA, st))
            if label == "Tally closed":
                here_ok(pg, "Waiting for Tally")
                save_one_line(pg)
                shot(pg, "5-waiting-title", "header.top")
                pg.evaluate("() => { Live.sv = Object.assign({}, Live.sv, {state: '', err: ''}); render(); }")
        st = scene([dev(OPEN, BEAT)], [rec(ALPHA, "b-alpha", CA, GA, allowed=False), rec(ITS, "b-its", CE, GE)])
        ok(st["state"] == "needs" and st["words"] == "Posting to Tally is stopped for Alpha Traders Ltd." and st["buttons"] == ["allow"], "posting stopped: Needs you, one line, Allow posting (%s)" % st)
        status(pg, keep=True); pg.click("header.top [data-tally-pop-act=allow]"); pg.wait_for_timeout(1500)
        ok(E("(b) => window.__links.find(l => l.book_id === b).posting_allowed", "b-alpha") is True, "its button allows posting in the record")
        # a Tally on a port outside 9000-9999 that the bridge reaches: fine (the TallyPrime 7.2 proof: 2.4.7 connects on 4125)
        st = scene([dev(OPEN, BEAT, port=4125)])
        ok(st["state"] == "linked", "Tally on port 4125, the bridge connected: Linked, no port warning (%s)" % st["words"])
        # the bridge itself reports it cannot reach Tally on its port
        st = scene([dev([], BEAT, tally="closed", port=9005, ports=[{"port": 9005, "ok": False, "skipped": False, "n": 0, "error": "connection refused", "state": "closed"}])])
        m = re.fullmatch(r"FinCom Bridge cannot reach Tally on port 9005\. Use a port between 9000 and 9999 — (90\d\d) is free", lw(pg, CA).replace("Needs you — ", "", 1))
        ok(st["state"] == "needs" and m and st["buttons"] == ["check"] and "port" not in st["text"].lower() and "9005" not in st["text"], "the bridge cannot reach Tally on 9005: Needs you; the port only on the Tally page (%r, %r)" % (st["words"], lw(pg, CA)))
        shot(pg, "5-port-unreachable", "header.top")
        ravi = {"go-2": {"at": "ago:5", "version": "2.4.7", "computer": "NWS144", "user": "ravi", "mode": "main", "tallyState": "open", "open": ["RAVI CO"], "tallyPort": 9005}}
        st = scene([dev([], BEAT, tally="closed", port=9005, bridges=ravi, ports=[{"port": 9005, "ok": False, "skipped": False, "n": 0, "error": "taken", "state": "closed"}, {"port": 9005, "ok": False, "skipped": True, "n": 0, "error": "", "state": ""}])])
        ok(st["state"] == "needs" and "FinCom Bridge cannot reach Tally on port 9005 (ravi's Tally is on it)" in lw(pg, CA), "a clash with ravi's Tally: said on the Tally page's words (%s)" % lw(pg, CA))
        E(SETUP, [store(), "owner", ME, CLIENTS]); client_page(pg, CU)
        st = status(pg)
        ok(st["state"] == "unlinked" and st["buttons"] == ["link"] and chip(pg) == "unlinked" and word(pg) == "Not linked", "not linked: the icon says it, one button Link (%s)" % st)
        status(pg, keep=True); pg.click("header.top [data-tally-pop-page]"); pg.wait_for_timeout(1200)
        ok(E("() => S.homeTab") == "tally" and E("() => (S.tallyGuide || {}).cid") == CU, "Open Tally page opens the Tally page's list for Beta Works")
        # the same word in every place: the header's Tally icon, the Clients list, the Tally page's row, Post to Tally
        def everywhere():
            client_page(pg, CA); t = word(pg)
            E("() => { S.view = 'home'; navHome('clients'); }"); pg.wait_for_timeout(1000)
            c = E("(id) => { const b = [...document.querySelectorAll('#app [data-tally-chip-at=clients]')].find(x => (x.closest('tr') || {innerText: ''}).innerText.includes('Alpha Traders')); return b ? b.innerText.slice(2).trim() : null; }", CA)
            tally_page(pg); rw = T(pg, R(ALPHA) + " .tco-pill .tag")
            client_page(pg, CA); E("() => goStep('post', 'bills')"); pg.wait_for_timeout(1500)
            po = E("(id) => { const s = postStatusFor(S.companies[id]); return [s.where, s.problem ? s.problem.text : '']; }", CA)
            return t, c, rw, po
        scene([dev([], BEAT, tally="closed")])
        t, c, rw, po = everywhere()
        ok(t == c == rw == po[0] == "Waiting for Tally" and po[1] == OPENW + ".", "Waiting for Tally in all four places, and Post to Tally says %r (%s)" % (OPENW, [t, c, rw, po]))
        scene([dev(OPEN, BEAT)])
        t, c, rw, po = everywhere()
        ok(t == c == rw == po[0] == "Linked" and not po[1], "Linked in all four places (%s)" % [t, c, rw, po])
        # phone: the title and its line fit
        pg.set_viewport_size({"width": 390, "height": 844}); scene([dev([], BEAT, tally="closed")]); pg.wait_for_timeout(400)
        ok(E("() => document.documentElement.scrollWidth <= window.innerWidth + 1"), "phone 390: no sideways scroll with the status line (%s)" % E("() => [document.documentElement.scrollWidth, window.innerWidth]"))
        shot(pg, "5-phone-waiting", "header.top")
        pg.close()

        print("== 7. the same company in two places (a copied data folder keeps the GUID)")
        pg = page(); E = lambda js, *a: pg.evaluate(js, *a)
        lap = {"go-3": {"at": "ago:1", "version": "2.4.7", "computer": "LAPTOP", "user": "ravi", "mode": "main", "tallyState": "open", "open": [ALPHA], "tallyPort": 9001, "dataFolder": "D:\\Copy\\Data"}}
        s7 = store(links=[dict(rec(ALPHA, "b-alpha", CA, GA), data_loc="f-nws", data_folder="C:\\Users\\anshul\\TallyPrime\\Data"), rec(ITS, "b-its", CE, GE)], devs=[dev(OPEN, BEAT, bridges=lap)])
        s7["cos"][0]["client_id"] = CA
        s7["places"] = [{"book_id": "b-alpha", "data_loc": "f-nws", "data_folder": "C:\\Users\\anshul\\TallyPrime\\Data", "computer": "NWS144", "windows_user": "anshul", "tally_port": 9005, "state": "chosen", "last_seen": "ago:1", "entries_at": "ago:1", "last_entry": "2026-10-27"},
                        {"book_id": "b-alpha", "data_loc": "f-lap", "data_folder": "D:\\Copy\\Data", "computer": "LAPTOP", "windows_user": "ravi", "tally_port": 9001, "state": "waiting", "last_seen": "ago:2", "entries_at": "ago:2", "last_entry": "2026-10-20"}]
        # migration 127 (the owner: "I don't want false alarms at all, use a proper system"): near misses never raise it
        REAL = "C:\\Users\\anshul\\TallyPrime\\Data"
        P = lambda loc, folder, pc="NWS144", state="waiting", seen=True: dict({"book_id": "b-alpha", "data_loc": loc, "data_folder": folder, "computer": pc, "windows_user": "anshul", "tally_port": 9005, "state": state, "last_seen": "ago:1"}, **({"entries_at": "ago:1", "last_entry": "2026-10-27"} if seen else {}))
        chosen = P("f-nws", REAL, state="chosen")
        near = [("staging: 'Data:' and none", [P("f-x", "Data:", state="chosen"), P("d-x", None)]), ("blank folder", [chosen, P("f-1", "")]), ("'Data:'", [chosen, P("f-2", "Data:")]),
                ("no folder (a port only)", [chosen, P("p-3", None)]), ("a word", [chosen, P("f-4", "Data")]), ("a drive alone", [chosen, P("f-5", "D:")]), ("a relative path", [chosen, P("f-6", "TallyPrime\\Data")]),
                ("upper case", [chosen, P("f-7", REAL.upper())]), ("a trailing backslash", [chosen, P("f-8", REAL + "\\")]), ("forward slashes", [chosen, P("f-9", REAL.replace("\\", "/"))]),
                ("doubled backslashes", [chosen, P("f-10", REAL.replace("\\", "\\\\"))]), ("a real other folder, no entries seen from it", [chosen, P("f-11", "D:\\Copy\\Data", "LAPTOP", seen=False)]),
                ("the place FinCom reads has no entries yet", [P("f-nws", REAL, state="chosen", seen=False), P("f-12", "D:\\Copy\\Data", "LAPTOP")]), ("a half UNC '\\\\server'", [chosen, P("f-13", "\\\\server")])]
        for what, pl in near:
            s7n = dict(s7); s7n["places"] = pl
            E(SETUP, [s7n, "owner", ME, CLIENTS]); client_page(pg, CA)
            stn = status(pg)
            ok(stn["state"] != "needs" and "two places" not in stn["words"], "near miss, %s: no 'two places' (%s)" % (what, stn["words"][:80]))
        E(SETUP, [s7, "owner", ME, CLIENTS]); client_page(pg, CA)
        st = status(pg)
        ok(st["state"] == "needs" and st["words"] == ALPHA + " is open in two places with different data. Choose which one is the books." and st["buttons"] == ["place1", "place2"], "Needs you: the same company in two places, Use ① / Use ② (%s)" % st)
        status(pg, keep=True); pg.click("header.top [data-tally-pop-page]"); pg.wait_for_timeout(1500)
        card = T(pg, "#app [data-tco-two-places]")
        ok(E("() => S.homeTab") == "tally" and card.startswith(ALPHA + " is open in two places with different data:") and "① C:\\Users\\anshul\\TallyPrime\\Data · NWS144 · login anshul · last entry 27-Oct-2026 (FinCom reads this one)" in card
           and "② D:\\Copy\\Data · LAPTOP · login ravi · last entry 20-Oct-2026" in card and "nothing from the other is applied" in card, "Choose opens the Tally page's card: ① the place FinCom reads, ② the other, each with its full folder, computer, login and last entry (%s)" % card[:300])
        shot(pg, "7-two-places", "#app [data-tco-two-places]")
        pg.click("#app [data-tco-two-places] [data-tco-place-use='2']"); pg.wait_for_timeout(1500)
        ch = rpc(pg, "tally_link_place_choose")
        ok(ch and ch[-1][1] == {"p_book": "b-alpha", "p_loc": "f-lap"} and pg.locator("#app [data-tco-two-places]").count() == 0, "Use ② asks the cloud to read LAPTOP's data; the card goes (%s)" % ch[-1:])
        E(SETUP, [s7, "staff", OTHER, CLIENTS]); tally_page(pg)
        ok(pg.locator("#app [data-tco-place-use]").count() == 0 and "An owner of the firm chooses." in T(pg, "#app [data-tco-two-places]"), "staff: the card, no choice (an owner chooses)")
        pg.close()

        print("== 8. Check my Tally: no false 'not accepting connections' when the bridge reaches Tally")
        pg = page(); E = lambda js, *a: pg.evaluate(js, *a)
        E(SETUP, [store(), "owner", ME, CLIENTS]); tally_page(pg)
        E("""() => { Bridge.up = () => true; Bridge.on = () => true; Bridge.blocked = () => false; const c0 = Bridge.cfg(); Bridge.cfg = () => Object.assign({}, c0, {key: 'k'});
          Bridge.st = Object.assign(Bridge.st || {}, {state: 'ok', tallyUp: true, open: [{name: 'ALPHA TRADERS LTD'}], sessions: [{port: 4125, mine: true, ok: true, skipped: false, companies: []}], clash: [], version: '2.4.7', mode: 'auto'});
          Bridge.diag = {user: 'anshul', mySession: 2, findings: [{level: 'bad', text: 'Your TallyPrime is running but is not accepting connections on port 4125 yet.', fix: 'In TallyPrime: F1 Help > Settings > Connectivity'}, {level: 'ok', text: 'Bridge running.'}],
            tallies: [{user: 'anshul', session: 2, mine: true, ports: [], ini: {found: true, mode: 'Both', port: 4125}}], listeners: [], freePort: 9047, seeProcesses: true}; S.tallyMore = Object.assign({}, S.tallyMore, {page: true, bridgeSupport: true}); render(); }""")
        pg.wait_for_timeout(600)
        if pg.locator("#app [data-bridge-details]").count() and not pg.locator("#app .bdiag").count(): pg.click("#app [data-bridge-details]"); pg.wait_for_timeout(500)
        if pg.locator("#app [data-bridge-support]").count() and not pg.locator("#app .bdiag").count(): pg.click("#app [data-bridge-support]"); pg.wait_for_timeout(500)
        dg = T(pg, "#app .bdiag")
        ok(dg and "not accepting connections on port 4125" not in dg and "Bridge running." in dg and "port 4125" in dg, "the false finding is left out; the table says port 4125 (%s)" % dg[:300])
        E("() => { Bridge.st.sessions = []; Bridge.st.tallyUp = false; Bridge.st.tallyState = 'closed'; render(); }"); pg.wait_for_timeout(400)
        ok("not accepting connections on port 4125" in T(pg, "#app .bdiag"), "when the bridge does not reach Tally, the finding stays")
        pg.close()

        print("== 6. before migration 110 (no record): the old rules")
        pg = page(); E = lambda js, *a: pg.evaluate(js, *a)
        s6 = store(links=[]); s6["cos"][0]["client_id"] = CA
        E(SETUP, [s6, "owner", ME, CLIENTS])
        ok(not E("() => LinkRec.ready()") and E("(c) => tallyLinkOf(S.companies[c]).state", CA) != "unlinked", "no record at all: the old rules (tally_companies), Alpha Traders linked")
        E("(c) => choiceConfirm(S.companies[c], 'postTo', '', {by: 'x'})", CA)
        ok(E("(c) => postToProblem(S.companies[c], '')", CA).startswith("Choose the Tally company"), "and the old gate (clients.data postTo)")
        pg.close()
        br.close()
    srv.shutdown()
    errs = [e for e in errors if "ResizeObserver" not in e]
    ok(not errs, "no page errors (%s)" % errs[:3])
    print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)

if __name__ == "__main__":
    main()
