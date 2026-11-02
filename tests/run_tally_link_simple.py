"""python3 run_tally_link_simple.py - one simple Link to Tally card for each client (round 39, 10-Oct-2026; the owner could
not tell whether a client is linked, when it will link, or whether he needs a port).
  1. The card shows exactly one status line, one of four: Not linked → Link / Waiting for Tally / Linked · reading / Needs you
     (ui-tidy, 13-Oct-2026: the words of every chip; were Not linked and Linked and reading).
  2. Not linked: the card points to the one place to link (15-Oct-2026: the Tally page's Connect Tally, step 4), which
     lists the companies FinCom has seen, the one with the client's GSTIN on top, with Link; Link calls tally_company_link
     once and sets the client's Tally name; while a step is not done the guide reads the cloud again by itself, so a
     company opened in Tally shows.
  3. Posting stays off until a person ticks "Post this client's entries into X" and confirms it (choiceConfirm postTo); a
     company FinCom found by itself is not ticked.
  4. More: Change company, Unlink, Name differs in Tally.
  5. No port words outside "Details (for support)" (the client's card, Client setup → Tally, the Tally page); the Tally
     page's guide has step 4 while a client is not linked; a computer's card only points to it ("Seen, not linked"); the
     Sessions table links nothing.
  6. Add client lands on the new client's card; Getting ready's Link to Tally opens Connect Tally's step 4, ticked only on
     a real link.
  7. The Clients list chip and the top bar's sign say the same four words.
24-Oct-2026 (next-tally-one-page): the same intent where it now lives: Client setup has ONE line (Not linked / Connected /
Disconnected, "Open in Tally page" / "Choose on Tally page"); linking, moving, unlinking, Sync now and "Post entries here"
are the Tally page's row (Companies in Tally); Change company and Name differs in Tally are gone (the cloud's link is the
one truth, the Tally name a hint cleared on unlink).
23-Oct-2026 (next-tally-suvit, Suvit's flow): the card's word is the one pill every place says (Not linked / Connected /
Disconnected, and Needs you when a person must act; lib/tallyState.js), with Sync now; not linked, the card itself lists
the companies in Tally it may be, each with Link (the same rows as the Tally page's Companies in Tally); Change company
opens the card's own choice; Getting ready's Link to Tally and Change company lead to those rows.
Options: --shots DIR  saves the card in its four states (desktop 1440 / phone 390, light and dark) and the Tally page.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_tally_link_simple.py"""
import json, os, re, sys, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = sys.argv[sys.argv.index("--shots") + 1] if "--shots" in sys.argv else ""
PORT = 8629
GSTIN = "09AANFG3202D1ZR"
# ui-tidy (13-Oct-2026): the same short words on every chip and card ("Not linked → Link" says what to do)
# next-link-record (26-Oct-2026, the owner's step 2): one word per client everywhere, from lib/linkStatus.js linkWord
WORDS = ["Not linked", "Waiting for Tally", "Linked", "Needs you"]
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
fails, errors = [], []
LAST, PAGE = [""], [None]
def ok(c, w):
    LAST[0] = w
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
# the firm's computers as tally_devices keeps them (made-up, as run_tally_ux.py): times are "ago:<minutes>"
def dev(n, comp, user, at="ago:0.5", tally="open", opened=("GARG SHEKHAR",), port=9005, beat=None):
    i = "d0000000-0000-4000-8000-00000000000%d" % n
    b = {"at": at, "version": "2.4.1", "computer": comp, "user": user, "mode": "main", "runMode": "user", "tally": tally == "open", "tallyState": tally,
         "open": list(opened), "tallyPort": port, "dataFolder": "C:\\Users\\Public\\TallyPrime\\Data",
         "reqs": {"day": "TODAY", "last": {"kind": "vouchers", "ms": 1234, "at": "ago:2"}, "over20": 0, "n": 41},
         "recorder": {co: {"seen": True, "lastAt": "ago:2"} for co in opened}}
    bt = {"at": at, "every": 30, "tally": tally == "open", "tallyState": tally, "open": list(opened), "paused": False}
    bt.update(beat or {}); b.update({k: v for k, v in (beat or {}).items() if k in ("readStopped", "paused")})
    info = {"computer": comp, "user": user, "beat": bt, "bridges": {"go-%d" % n: b}}
    return {"id": i, "name": comp, "revoked": False, "last_seen": at, "version": "2.4.1", "main_bridge": "go-%d" % n, "info": info, "created_at": "2026-09-01T00:00:00Z",
            "post_only": [], "post_batch_bills": 10, "post_batch_bank": 50, "trial_tools": False, "recorder_source": "addon"}
DEVS = [dev(1, "NWS144", "anshul"), dev(2, "LAPTOP", "ravi", opened=("ABC LTD",)), dev(3, "FRONTDESK", "tally", tally="closed", opened=())]
D1, D2, D3 = [d["id"] for d in DEVS]
SETUP = """([devs, stops, companies, role, lines]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v === "TODAY" ? new Date().toISOString().slice(0, 10) : v);
  const c = Object.values(S.companies).find(x => x.name === "Link Co");
  window.__devs = fix(devs); window.__stops = fix(stops); window.__calls = window.__calls || [];
  window.__companies = fix(companies).map(x => Object.assign(x, {client_id: x.client_id === "ME" ? c.id : x.client_id}));
  window.__lines = fix(lines || []).map(l => Object.assign(l, {client_id: c.id}));
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [];
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_read_stops/.test(path)) return copy(window.__stops);
    if (/^tally_companies/.test(path)) return copy(window.__companies);
    if (/^tally_recorder_lines/.test(path)) return copy(window.__lines);
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]);
    if (fn === "tally_company_link") window.__companies.forEach(r => { if (r.company === a.p_company) r.client_id = a.p_client || null; });
    return {ok: true}; };
  Cloud.rpc = async (fn, a) => { window.__calls.push([fn, JSON.parse(JSON.stringify(a || {}))]); return {ok: true}; };
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.pane.devices = null; TCloud.pane.companies = null; TCloud.pane.stops = window.__stops; TCloud.pane.at = 0; TCloud.pane.err = "";
  TLight.st.at = 0; TLight.st.devs = window.__devs.filter(d => !d.revoked); TLight.st.cos = window.__companies; TLight.st.stops = window.__stops;
  Rec.act = {};
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  S.tallyOld = false; S.tallyTab = "computers"; S.tallyMore = {}; S.tallyGuide = {};
  return c.id;
}"""
def rline(i, day, why):
    return {"id": i, "client_id": "CID", "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": "GARG SHEKHAR", "line_id": "L%d" % i, "event": "created", "object_guid": "g-%d" % i,
            "alter_id": 900 + i, "vch_type": "Sales", "vch_no": str(i), "vch_date": day, "saved_at": "ago:600", "received_at": "ago:600", "applied_at": None, "state": "held", "held_why": why, "ledgers": []}
HELD = [rline(1, "2026-10-06", "month locked: 2026-04")]
SEEN = [{"company": "GARG SHEKHAR", "client_id": None, "device_id": D1, "gstin": "", "last_seen": "ago:1"},
        # unlinked by a person once (linked_at, no client): FinCom's own same-GSTIN link leaves it to a person
        {"company": "ABC LTD", "client_id": None, "device_id": D2, "gstin": GSTIN, "last_seen": "ago:3", "linked_at": "ago:300"}]
LINKED = lambda d=D1: [{"company": "GARG SHEKHAR", "client_id": "ME", "device_id": d, "gstin": "", "last_seen": "ago:1"},
                       {"company": "ABC LTD", "client_id": None, "device_id": D2, "gstin": "", "last_seen": "ago:3"}]
PORT_RE = re.compile(r"\bports?\b|\b9005\b|\bsession\b", re.I)

def main():
    srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch()
        def open_page(w, h, scheme="light"):
            pg = br.new_page(viewport={"width": w, "height": h}, color_scheme=scheme); pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
                body=json.dumps({"setup": {"version": "2.4.1", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.4.1.exe", "sha256": "ab" * 32}})))
            pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
            pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(800)
            cid = pg.evaluate("""(g) => { const c = newCompany({name: 'Link Co', gstin: g}); c.tallyName = 'Link Co'; S.companies[c.id] = c;
                S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c); return c.id; }""", GSTIN)
            return pg, cid
        pg, cid = open_page(1440, 900); PAGE[0] = pg
        E = lambda js, *a: pg.evaluate(js, *a)
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        one = "#app [data-tally-one]"
        R = lambda co: '#app [data-tco-list=firm] [data-tco-row="%s"]' % co
        calls = lambda fn: [c for c in E("window.__calls || []") if c[0] == fn]
        def scene(companies, devs=DEVS, stops=(), lines=(), role="owner"):
            E(SETUP, [devs, list(stops), companies, role, list(lines)]); pg.wait_for_timeout(300)
            E("(c) => { if (S.coId !== c) openCompany(c); S.view = 'company'; S.tab = 'cotally'; render(); }", cid); pg.wait_for_timeout(900)
        def one_line(want, label):
            tags = E("() => [...document.querySelectorAll('#app [data-tally-one] .tag')].map(e => e.innerText.replace(/^[●◐○] /, '').trim())")
            ok(pg.locator(one).count() == 1 and tags == [want] and pg.locator("#app [data-tally-link]").count() == 0, "%s: exactly one Tally line, %r, no card (%s)" % (label, want, tags))
            return re.sub(r"\s+", " ", txt(one))
        def to_row():
            pg.click("#app [data-tally-one-go]"); pg.wait_for_timeout(1300)
        def menu_open(co):
            pg.click(R(co) + " [data-tco-more] summary"); pg.wait_for_timeout(250)
        def confirm(yes=True):
            # the question is asked first (askConfirm): wait for it, answer, and wait for it to close
            sel = '#confirmBox [data-cbx="%s"]' % ("yes" if yes else "no")
            pg.wait_for_selector(sel, state="visible", timeout=10000); pg.click(sel)
            pg.wait_for_selector(sel, state="hidden", timeout=10000); pg.wait_for_timeout(400)
        def no_port(where):
            # what shows outside Details (for support): the open Details are taken out of the words
            t = E("""() => { const a = document.querySelector('#app').cloneNode(true);
                a.querySelectorAll('[data-card-more], [data-bridge-more], [data-bridge-support-more], .tsign-pop').forEach(e => e.remove()); return a.innerText; }""")
            hits = sorted(set(m.group(0) for m in PORT_RE.finditer(t)))
            ok(not hits, "%s: no port or session words outside Details (for support) (%s)" % (where, hits))
        def shot(page, name):
            if SHOTS: os.makedirs(SHOTS, exist_ok=True); page.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=True)

        # next-tally-one-page (24-Oct-2026): the client's Tally is ONE line in Client setup; everything else is the Tally page's
        # row (Companies in Tally): the same intent, checked there.
        # ---- 1. Not linked: one line; Choose on Tally page lists the companies, the same GSTIN on top, with Link to <client>
        scene(SEEN); pg.wait_for_timeout(600)
        line = one_line("Not linked", "1. not linked")
        # 31-Oct-2026: "Choose Tally company…" opens the Tally page's picker on Client setup (closed until clicked)
        ok(line == "Tally: ◐ Not linked · Choose Tally company… · Choose on Tally page" and pg.locator("#app [data-tally-one] select, #app [data-tally-one] input, #app [data-tlk-pick]").count() == 0,
           "1. not linked: said; no box to type or pick in until Choose Tally company… (%s)" % line)
        ok(pg.locator("#app [data-tally-link-post], #app [data-tco-post-here]").count() == 0, "1. no posting choice before the client is linked")
        no_port("1. Client setup, not linked")
        shot(pg, "card-1-not-linked-desktop-light")
        to_row()
        opts = E("() => [...document.querySelectorAll('#app [data-tco-list=firm] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), r.innerText.replace(/\\s+/g, ' ')])")
        ok([o[0] for o in opts] == ["ABC LTD", "GARG SHEKHAR"] and "same GSTIN" in opts[0][1], "1. the companies seen, the same GSTIN on top (%s)" % opts)
        ok("LAPTOP" not in opts[0][1] and "NWS144" not in opts[1][1], "1. no computer's name on a row (next-tally-smart, the owner's rule) (%s)" % [o[1] for o in opts])
        n0 = len(calls("tally_company_link"))
        pg.click(R("ABC LTD") + " [data-tco-act=link]"); pg.wait_for_timeout(1200)
        lk = calls("tally_company_link")[n0:]
        ok(lk == [["tally_company_link", {"p_company": "ABC LTD", "p_client": cid}]], "2. Link -> tally_company_link once, for this client (%s)" % lk)
        ok(E("(c) => S.companies[c].tallyName", cid) == "ABC LTD", "2. Link sets the client's Tally name hint (%s)" % E("(c) => S.companies[c].tallyName", cid))
        ok(E("(c) => tallyLinkOf(S.companies[c]).state", cid) != "unlinked", "2. the client is linked at once (%s)" % E("(c) => tallyLinkOf(S.companies[c]).state", cid))
        # owner decision of 26-Oct-2026: linking a client to its Tally company also allows posting to it
        ok(E("(c) => [S.companies[c].postTo, choiceState(S.companies[c], 'postTo'), choiceGet(S.companies[c], 'postTo').why]", cid) == ["ABC LTD", "confirmed", "confirmed when linked to Tally"],
           "2. linking allows posting into the linked company (%s)" % E("(c) => choiceGet(S.companies[c], 'postTo')", cid))
        E("(c) => { const co = S.companies[c]; delete co.choices.postTo; co.postTo = ''; }", cid)

        # ---- 2b. not linked, nothing seen yet: Companies in Tally reads the cloud again by itself
        E("(c) => { S.companies[c].tallyName = 'NEW CO'; }", cid)
        scene([], devs=[dev(1, "NWS144", "anshul", opened=()), dev(2, "LAPTOP", "ravi", opened=())])
        E("(c) => openConnectTally(4, c)", cid); pg.wait_for_timeout(1500)
        ok("No company seen in Tally yet" in txt("#app [data-tco-list=firm]"), "2b. nothing seen: open your company in TallyPrime (%s)" % txt("#app [data-tco-list=firm]"))
        E("""() => { window.__companies.push({company: 'NEW CO', client_id: null, device_id: '%s', gstin: '', last_seen: new Date().toISOString()});
            const d = window.__devs.find(x => x.id === '%s'); d.info.beat.open.push('NEW CO'); Object.values(d.info.bridges).forEach(b => b.open.push('NEW CO')); }""" % (D1, D1))
        # speed round (27-Oct-2026): the computers' beats are read every 30 s (they were, with the whole page, every 20 s)
        pg.wait_for_timeout(32000)
        ok(pg.locator('#app [data-tco-list=firm] [data-tco-row="NEW CO"]').count() == 1, "2b. a company opened in Tally shows by itself within 30 s (no click)")

        # ---- 3. Disconnected: linked, the computer has Tally closed (FRONTDESK keeps it; no other computer has it open)
        scene(LINKED(D3), devs=[dev(1, "NWS144", "anshul", opened=()), DEVS[1], DEVS[2]])
        line = one_line("Waiting for Tally", "3. waiting")
        ok("— Open GARG SHEKHAR in TallyPrime on FRONTDESK" in line and line.endswith("Open in Tally page · Change · Unlink"), "3. the line: Waiting for Tally — Open GARG SHEKHAR in TallyPrime on FRONTDESK (%s)" % line)
        to_row()
        # next-tally-smart: a linked company not open now is one quiet line under Your linked clients (no false alarm)
        LR = R("GARG SHEKHAR") + "[data-linked-row]"
        ok(pg.locator(LR).count() == 1 and txt(LR + " .tco-pill") == "Waiting for Tally" and "not open in Tally now" in txt(LR + " [data-linked-meta]") and pg.locator(LR + " [data-tco-more]").count() == 1 and "FRONTDESK" not in txt(LR),
           "3. not open: under Your linked clients, Waiting for Tally, 'not open in Tally now', with ⋯, no computer's name (%s)" % txt(LR))
        shot(pg, "card-2-waiting-desktop-light")

        # ---- 4. Connected
        scene(LINKED(D1))
        line = one_line("Linked", "4. reading")
        ok(line == "Tally: GARG SHEKHAR ● Linked · Open in Tally page · Change Tally company… · Unlink", "4. Linked: the company, Open in Tally page, Change and Unlink (next-fix-tally-links) (%s)" % line)
        no_port("4. Client setup → Tally")
        ok(pg.locator('#app input[aria-label="Company name in Tally"]').count() == 0 and "Posting allowed to company" not in txt("#app"), "4. Client setup → Tally: no name box, no 'Posting allowed to' card")
        to_row()
        rt = re.sub(r"\s+", " ", txt(R("GARG SHEKHAR")))
        ok(re.search(r"last entry (today |yesterday )?\d\d:\d\d", rt) is not None and "Sync now" in rt and "NWS144" not in rt, "4. the row: the last entry, Sync now, no computer's name (%s)" % rt)
        shot(pg, "card-3-reading-desktop-light")

        # ---- 5. posting: the one linked company is confirmed from the link by itself (26-Oct-2026); Stop posting here and
        # Post entries here (the row's ⋯) change it, asked first
        ok(E("(c) => choiceState(S.companies[c], 'postTo')", cid) != "confirmed", "5. linked, the client not opened since: nothing confirmed yet")
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'cotally'; render(); }", cid); pg.wait_for_timeout(1500); to_row()
        c5 = E("(c) => [S.companies[c].postTo, choiceState(S.companies[c], 'postTo'), (choiceGet(S.companies[c], 'postTo') || {}).why]", cid)
        ok(c5 == ["GARG SHEKHAR", "confirmed", "confirmed from the Tally link"] and not E("(c) => postToProblem(S.companies[c])", cid), "5. linked before, none confirmed: confirmed from the Tally link on opening (%s)" % c5)
        menu_open("GARG SHEKHAR"); pg.click(R("GARG SHEKHAR") + " [data-tco-post-stop]"); confirm(True)
        ok(E("(c) => postToProblem ? !!postToProblem(S.companies[c]) : true", cid), "5. Stop posting here: posting is refused (postToProblem)")
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'cotally'; render(); }", cid); pg.wait_for_timeout(1500); to_row()
        ok(E("(c) => S.companies[c].postTo || ''", cid) == "", "5. a person's stop is not undone by opening the client")
        menu_open("GARG SHEKHAR"); pg.click(R("GARG SHEKHAR") + " [data-tco-post-here]"); confirm(False)
        ok(E("(c) => !!postToProblem(S.companies[c]) && !S.companies[c].postTo", cid), "5. Post entries here, then No: still off")
        menu_open("GARG SHEKHAR"); pg.click(R("GARG SHEKHAR") + " [data-tco-post-here]"); pg.wait_for_selector('#confirmBox [data-cbx="yes"]', state="visible", timeout=10000)
        ok("Post Link Co\u2019s entries into GARG SHEKHAR?" in (txt("#confirmBox") or ""), "5. it asks first: \u201cPost Link Co's entries into GARG SHEKHAR?\u201d (%s)" % txt("#confirmBox")[:80])
        confirm(True)
        c5 = E("(c) => [S.companies[c].postTo, choiceState(S.companies[c], 'postTo')]", cid)
        ok(c5 == ["GARG SHEKHAR", "confirmed"], "5. confirmed: posting into GARG SHEKHAR (%s)" % c5)
        ok(not E("(c) => postToProblem(S.companies[c])", cid), "5. posting allowed once confirmed")
        menu_open("GARG SHEKHAR")
        ok(pg.locator(R("GARG SHEKHAR") + " [data-tco-post-stop]").count() == 1, "5. then ⋯ says Stop posting here")
        E("() => document.querySelectorAll('#app details[open]').forEach(d => d.open = false)")
        # found by FinCom (guessed): not chosen
        E("(c) => { const co = S.companies[c]; co.choices = Object.assign({}, co.choices, {postTo: {value: 'GARG SHEKHAR', state: 'guessed'}}); co.postTo = 'GARG SHEKHAR'; render(); }", cid); pg.wait_for_timeout(400)
        menu_open("GARG SHEKHAR")
        ok(pg.locator(R("GARG SHEKHAR") + " [data-tco-post-here]").count() == 1, "5. found by FinCom, not chosen: ⋯ still offers Post entries here")
        E("(c) => { const co = S.companies[c]; delete co.choices.postTo; co.postTo = ''; document.querySelectorAll('#app details[open]').forEach(d => d.open = false); render(); }", cid)

        # ---- 6. ⋯: Link to another client, Unlink (Change company / Name differs are gone: the row moves it)
        menu_open("GARG SHEKHAR")
        items = E("() => [...document.querySelectorAll('#app [data-tco-row=\"GARG SHEKHAR\"] .bk-menu-list button')].map(b => b.firstChild.textContent.trim())")
        ok("Link to another client" in items and "Unlink" in items and "Name differs in Tally" not in items, "6. ⋯: %s" % items)
        n0 = len(calls("tally_company_link"))
        pg.click(R("GARG SHEKHAR") + " [data-tco-unlink]"); confirm(True); pg.wait_for_timeout(600)
        ok(calls("tally_company_link")[n0:] == [["tally_company_link", {"p_company": "GARG SHEKHAR", "p_client": None}]], "6. Unlink -> tally_company_link with no client (%s)" % calls("tally_company_link")[n0:])
        ok(txt(R("GARG SHEKHAR") + " [data-tco-pill]").startswith("Not linked") and E("(c) => S.companies[c].tallyName", cid) == "", "6. it stays listed (Not linked); the client's Tally name is cleared")

        # ---- 7. a held entry or a stop: Needs you (the owner's step 2, 26-Oct-2026), the same everywhere
        scene(LINKED(D1), lines=HELD)
        E("() => { Rec.act.at = 0; if (Rec.actLoad) Rec.actLoad(); AlertHub.refresh(true); }"); pg.wait_for_timeout(2000); E("() => render()"); pg.wait_for_timeout(500)
        one_line("Needs you", "7. a held entry")
        shot(pg, "card-4-needs-you-desktop-light")

        # ---- 8. the chip and the header's Tally icon say the same word
        scene(LINKED(D3), devs=[dev(1, "NWS144", "anshul", opened=()), DEVS[1], DEVS[2]])
        words = re.sub(r"\s+", " ", txt(one))
        # next-tally-icon: the header's one Tally icon on the client's page says the same word, in plain words (no computer)
        E("(c) => { openCompany(c); S.view = 'company'; S.tab = 'dash'; render(); }", cid); pg.wait_for_timeout(1200)
        sign = E("() => { const b = document.querySelector('header.top [data-tally-icon]'); return b ? [b.getAttribute('data-tally-icon'), b.getAttribute('aria-label')] : null; }")
        ok(sign and sign[0] == "waiting" and sign[1].startswith("Tally: Waiting for Tally — Open GARG SHEKHAR in Tally") and "FRONTDESK" not in sign[1] and "Open GARG SHEKHAR in TallyPrime on FRONTDESK" in words,
           "8. the header's Tally icon says the word, plainly: 'Waiting for Tally — Open GARG SHEKHAR in Tally'; the Tally page names the computer (%s)" % (sign,))
        E("() => navHome('clients')"); pg.wait_for_timeout(900)
        chip = E("(c) => { const r = [...document.querySelectorAll('#app [data-tally-link-chip]')].map(e => e.innerText.trim()); return r; }", cid)
        ok(any(c.endswith("Waiting for Tally") for c in chip) and all(any(c.endswith(w) for w in WORDS) for c in chip), "8. the Clients chip: the same words (%s)" % chip)

        # ---- 9. the Tally page: Companies in Tally, each company with its client or Add as client; a client not linked: the
        # list for it with "Link to <client>"; a computer's card names no client; no port outside Details
        E("() => { const o = newCompany({name: 'ZZ Other', gstin: ''}); S.companies[o.id] = o; S.data[o.id] = {parties: {}, entries: {}, loaded: true}; o.stats = {}; window.__zz = o.id; }")
        scene(LINKED(D1)); E("() => { S.tallyFocus = ''; S.tallyGuide = {}; navHome('tally'); }"); pg.wait_for_timeout(1800)
        rows = E("() => Object.fromEntries([...document.querySelectorAll('#app [data-tco-list=firm] [data-tco-row]')].map(r => [r.getAttribute('data-tco-row'), [r.getAttribute('data-tco-state'), r.getAttribute('data-tco-linked'), r.innerText.replace(/\\s+/g, ' ')]]))")
        ok(rows.get("GARG SHEKHAR", [""])[0] == "connected" and rows["GARG SHEKHAR"][1] == cid and "Link Co" in rows["GARG SHEKHAR"][2] and "Sync now" in rows["GARG SHEKHAR"][2],
           "9. Companies in Tally: GARG SHEKHAR, Connected, its client Link Co, Sync now (%s)" % rows.get("GARG SHEKHAR"))
        ok("Choose client" in rows.get("ABC LTD", ["", "", ""])[2] and pg.locator(R("ABC LTD") + " select[data-tco-act=pick]").count() == 1 and "Add as client" not in rows.get("ABC LTD", ["", "", ""])[2], "9. ABC LTD (open on LAPTOP, no client): the client picker, no Add as client (Task D) (%s)" % rows.get("ABC LTD"))
        zz = E("window.__zz")
        E("(z) => openConnectTally(4, z)", zz); pg.wait_for_timeout(900)
        ok(pg.locator('#app [data-tco-for="%s"]' % zz).count() == 1 and txt(R("ABC LTD") + " [data-tco-act]") == "Link to ZZ Other" and txt(R("GARG SHEKHAR") + " [data-tco-act]") == "Move here",
           "9. a client not linked (ZZ Other): 'Link to ZZ Other', and GARG SHEKHAR (Link Co's) 'Move here' (%s)" % txt("#app [data-tco-list=firm]")[:200])
        E("() => { S.tallyGuide = {}; S.tallyMore = {page: true}; render(); }"); pg.wait_for_timeout(600)
        ok(pg.locator("#app [data-card-seen]").count() == 0 and pg.locator("#app [data-tally-clients]").count() == 0, "9. Help & support: no 'Seen, not linked', no clients' table")
        no_port("9. the Tally page")
        E("() => { S.tallyMore = {}; render(); }"); pg.wait_for_timeout(400)
        shot(pg, "tally-page-desktop-light")
        # a change of company from the list: ABC LTD ⋯ Link to a client… → Link Co (asked: it moves from GARG SHEKHAR)
        n0 = len(calls("tally_company_link"))
        pg.click(R("ABC LTD") + " [data-tco-act=pick]"); pg.wait_for_timeout(300)   # Task D: Link to client… (no ⋯ while open)
        pg.select_option(R("ABC LTD") + " [data-tco-relink-pick]", cid); pg.click(R("ABC LTD") + " [data-tco-relink]"); confirm(True); pg.wait_for_timeout(900)
        ok(calls("tally_company_link")[n0:] == [["tally_company_link", {"p_company": "ABC LTD", "p_client": cid}], ["tally_company_link", {"p_company": "GARG SHEKHAR", "p_client": None}]],
           "9. ABC LTD linked to Link Co, GARG SHEKHAR unlinked (%s)" % calls("tally_company_link")[n0:])
        # every client linked: the steps fold to the computers' line
        E("() => { const ids = Object.values(S.companies).filter(x => !x.deleted).map(x => x.id); window.__companies = ids.map((id, i) => ({company: 'CO ' + i, client_id: id, device_id: '%s', gstin: ''})); TLight.st.cos = window.__companies; TCloud.pane.companies = window.__companies; render(); }" % D1)
        pg.wait_for_timeout(1500)
        ok(pg.locator("#app [data-connect-step]").count() == 0 and pg.locator("#app [data-status-card]").count() == 1, "9. linked: no steps, the one status card")
        # this computer's Tallys (Details): no linking there
        E("""() => { Bridge.cfg = () => ({url: 'http://localhost:1', key: 'k', follow: false, port: 0}); Bridge.blocked = () => false; Bridge.on = () => true; Bridge.up = () => true;
              Object.assign(Bridge.st, {state: 'ok', version: '2.4.1', mode: 'auto', user: 'anshul', tallyUp: true, at: Date.now(), open: [{name: 'QQ ELSEWHERE'}],
              sessions: [{port: 9000, ok: true, mine: true, companies: [{name: 'QQ ELSEWHERE'}]}, {port: 9001, skipped: true, ok: false, companies: []}]}); S.tallyMore = {page: true}; render(); }""")
        pg.wait_for_timeout(700)
        ok("Use this Tally" in txt("#app [data-bridge-more]"), "9. Details: the Tallys with Use this Tally")

        # ---- 10. Add client lands on the client, its one line Not linked (a fresh page: no bridge stubs left over)
        pg.close(); pg, cid = open_page(1440, 900); PAGE[0] = pg
        scene(SEEN)
        E("() => doAct('addCo')"); pg.wait_for_timeout(500)
        pg.fill("#ncName", "ZZ New Client"); pg.click('#app button:has-text("Add and open")'); pg.wait_for_timeout(1200)
        E("() => { S.tab = 'cotally'; render(); }"); pg.wait_for_timeout(600)
        ok(E("CO() && CO().name") == "ZZ New Client" and E("document.querySelector('#app [data-tally-one]') && document.querySelector('#app [data-tally-one]').getAttribute('data-tally-one')") == "unlinked",
           "10. Add client: the new client, its Tally line Not linked (%s)" % E("[S.view, S.tab]"))

        # ---- 11. Getting ready: one step, Link to Tally, opens the Tally page's list for the client; ticked only on a real link
        scene(SEEN)
        E("(c) => { S.companies[c].onbHide = false; S.companies[c].tallyName = 'GARG SHEKHAR'; goClient('dash'); }", cid); pg.wait_for_timeout(900)
        st = E("ONB.steps(CO()).map(s => [s.id, s.done])")
        ok([s[0] for s in st if s[0] in ("tally", "bridge", "link")] == ["link"] and dict(st)["link"] is False, "11. one step, Link to Tally; a Tally name alone does not tick it (%s)" % st)
        pg.click('#app [data-onb-step="link"] button'); pg.wait_for_timeout(800)
        ok(E("[S.homeTab, (S.tallyGuide || {}).step, (S.tallyGuide || {}).cid]") == ["tally", 4, cid] and pg.locator('#app [data-tco-for="%s"]' % cid).count() == 1 and pg.locator("#app [data-tco-list=firm] [data-tco-act=link]").count() >= 1,
           "11. Link to Tally opens Companies in Tally for this client, each company with Link (%s)" % E("S.tallyGuide"))
        scene(LINKED(D3))
        ok(E("ONB.steps(CO()).find(s => s.id === 'link').done") is True, "11. linked in the cloud (its computer off): ticked")

        # ---- 12. the shots: the line in its states, desktop 1440 and phone 390, light and dark; the Tally page
        if SHOTS:
            for scheme in ("light", "dark"):
                for w, h, tag in ((1440, 900, "desktop"), (390, 844, "phone")):
                    q, qid = open_page(w, h, scheme)
                    def qs(companies, lines=(), stops=()):
                        q.evaluate(SETUP, [DEVS, list(stops), companies, "owner", list(lines)]); q.wait_for_timeout(300)
                        q.evaluate("(c) => { openCompany(c); S.tab = 'cotally'; render(); }", qid); q.wait_for_timeout(1000)
                    def wide(where):
                        x = q.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
                        ok(x <= 1, "12. %s %s %s: no sideways scroll (%d px)" % (tag, scheme, where, x))
                    for n, (nm, comp) in enumerate([("not-linked", SEEN), ("waiting", LINKED(D3)), ("reading", LINKED(D1))], 1):
                        qs(comp); wide("line " + nm)
                        el = q.locator("#app [data-books-source]")
                        if el.count(): el.screenshot(path=os.path.join(SHOTS, "line-%d-%s-%s-%s.png" % (n, nm, tag, scheme)))
                    q.evaluate("() => { S.tallyFocus = ''; navHome('tally'); }"); q.wait_for_timeout(1800)
                    wide("Tally page")
                    q.screenshot(path=os.path.join(SHOTS, "tally-page-%s-%s.png" % (tag, scheme)), full_page=True)
                    q.close()
        br.close()
    srv.shutdown()
    print("page errors:", errors[:3]) if errors else None
    ok(not errors, "no page errors (%d)" % len(errors))
    print("\n%d failed" % len(fails) if fails else "\nall passed")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        # what stopped it, said last (a CI log shows only the end): the check before, and a question left open
        box = ""
        try: box = PAGE[0].inner_text("#confirmBox") if PAGE[0] and PAGE[0].locator("#confirmBox").is_visible() else ""
        except Exception: pass
        print("STOPPED after %r: %s; question open: %r" % (LAST[0][:120], str(ex).split("\n")[0][:160], box[:200]))
        sys.exit(1)
