"""python3 run_tally_link_simple.py - one simple Link to Tally card for each client (round 39, 10-Oct-2026; the owner could
not tell whether a client is linked, when it will link, or whether he needs a port).
  1. The card shows exactly one status line, one of four: Not linked / Waiting for Tally / Linked and reading / Needs you.
  2. Not linked: the companies FinCom has seen, the one with the client's GSTIN on top ("Same GSTIN"), each with Link;
     Link calls tally_company_link once and sets the client's Tally name; while not linked the card reads the cloud again
     by itself, so a company opened in Tally shows.
  3. Posting stays off until a person ticks "Post this client's entries into X" and confirms it (choiceConfirm postTo); a
     company FinCom found by itself is not ticked.
  4. More: Change company, Unlink, Name differs in Tally.
  5. No port words outside "Details (for support)" (the client's card, Client setup → Tally, the Tally page); the Tally
     page's guide stays while a client is not linked; a computer card offers Link… for a company seen, not linked; the
     Sessions table links nothing.
  6. Add client lands on the new client's card; Getting ready's Link to Tally opens it, ticked only on a real link.
  7. The Clients list chip and the top bar's sign say the same four words.
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
WORDS = ["Not linked", "Waiting for Tally", "Linked and reading", "Needs you"]
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
  S.tallyOld = false; S.tallyTab = "computers"; S.tallyMore = {};
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
            pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
            cid = pg.evaluate("""(g) => { const c = newCompany({name: 'Link Co', gstin: g}); c.tallyName = 'Link Co'; S.companies[c.id] = c;
                S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; Store.saveCompany(c); return c.id; }""", GSTIN)
            return pg, cid
        pg, cid = open_page(1440, 900); PAGE[0] = pg
        E = lambda js, *a: pg.evaluate(js, *a)
        txt = lambda sel: pg.inner_text(sel).strip() if pg.locator(sel).count() else ""
        card = "#app [data-tally-link]"
        calls = lambda fn: [c for c in E("window.__calls || []") if c[0] == fn]
        def scene(companies, devs=DEVS, stops=(), lines=(), role="owner"):
            E(SETUP, [devs, list(stops), companies, role, list(lines)]); pg.wait_for_timeout(300)
            E("(c) => { if (S.coId !== c) openCompany(c); S.tab = 'cotally'; render(); }", cid); pg.wait_for_timeout(900)
        def status():
            return E("() => [...document.querySelectorAll('#app [data-tally-link] [data-tally-link-status]')].map(e => [e.getAttribute('data-tally-link-status'), e.querySelector('[data-tally-link-state]').innerText.trim(), e.innerText.replace(/\\s+/g, ' ').trim()])")
        def one_line(want, label):
            st, body = status(), txt(card)
            words = [w for w in WORDS if w in body]
            ok(len(st) == 1 and st[0][1] == want and words == [want], "%s: exactly one status line, %r (%s; words in the card %s)" % (label, want, st, words))
            return st[0][2] if st else ""
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

        # ---- 1. Not linked: the companies seen, same GSTIN on top, Link
        scene(SEEN)
        line = one_line("Not linked", "1. not linked")
        ok("Choose this client" in line, "1. not linked: 'Choose this client's company in Tally' (%s)" % line)
        opts = E("() => [...document.querySelectorAll('#app [data-tally-link] [data-tally-link-option]')].map(e => [e.getAttribute('data-tally-link-option'), e.hasAttribute('data-same-gstin'), e.innerText.replace(/\\s+/g, ' ').trim()])")
        ok([o[0] for o in opts] == ["ABC LTD", "GARG SHEKHAR"] and opts[0][1] and "Same GSTIN" in opts[0][2], "1. the companies seen, the same GSTIN on top (%s)" % opts)
        ok(len(opts) == 2 and "LAPTOP" in opts[0][2] and "NWS144" in opts[1][2], "1. each with its computer (%s)" % [o[2] for o in opts])
        ok("appears here within a minute" in txt(card + " [data-tally-link-hint]"), "1. a company not in the list: open it in TallyPrime; it appears within a minute (%s)" % txt(card + " [data-tally-link-hint]"))
        ok(pg.locator(card + " [data-tally-link-post]").count() == 0, "1. no posting tick before the client is linked")
        no_port("1. the card, not linked")
        shot(pg, "card-1-not-linked-desktop-light")
        # Link: tally_company_link once, the Tally name set
        n0 = len(calls("tally_company_link"))
        pg.click(card + ' [data-tally-link-to="ABC LTD"]'); pg.wait_for_timeout(1200)
        lk = calls("tally_company_link")[n0:]
        ok(lk == [["tally_company_link", {"p_company": "ABC LTD", "p_client": cid}]], "2. Link -> tally_company_link once, for this client (%s)" % lk)
        ok(E("(c) => S.companies[c].tallyName", cid) == "ABC LTD", "2. Link sets the client's Tally name (%s)" % E("(c) => S.companies[c].tallyName", cid))
        ok(E("document.querySelector('#app [data-tally-link]').getAttribute('data-tally-link')") != "unlinked", "2. the card is linked at once (%s)" % status())
        ok(E("(c) => choiceState(S.companies[c], 'postTo')", cid) != "confirmed" and not E("(c) => S.companies[c].postTo || ''", cid), "2. linking does not allow posting")

        # ---- 2b. not linked, nothing seen yet: the card reads the cloud again by itself
        E("(c) => { S.companies[c].tallyName = 'NEW CO'; }", cid)
        scene([])
        ok("Open NEW CO in TallyPrime" in txt(card + " [data-tally-link-hint]"), "2b. nothing seen: open NEW CO in TallyPrime (%s)" % txt(card + " [data-tally-link-hint]"))
        E("() => { window.__companies.push({company: 'NEW CO', client_id: null, device_id: '%s', gstin: '', last_seen: new Date().toISOString()}); }" % D1)
        pg.wait_for_timeout(22500)
        ok(pg.locator(card + ' [data-tally-link-option="NEW CO"]').count() == 1, "2b. a company opened in Tally shows by itself (no click)")

        # ---- 3. Waiting for Tally: linked, the computer has Tally closed
        scene(LINKED(D3))
        line = one_line("Waiting for Tally", "3. waiting")
        ok("Linked to GARG SHEKHAR. Open GARG SHEKHAR in TallyPrime on FRONTDESK" in line, "3. waiting: open it in TallyPrime on the computer (%s)" % line)
        shot(pg, "card-2-waiting-desktop-light")

        # ---- 4. Linked and reading
        scene(LINKED(D1))
        line = one_line("Linked and reading", "4. reading")
        ok(re.search(r"Linked to GARG SHEKHAR on NWS144 \u00b7 last entry \d\d:\d\d", line) is not None and pg.locator(card + " [data-update-now]").count() == 1, "4. reading: computer and last entry, Update now (%s)" % line)
        no_port("4. Client setup → Tally")
        ok(pg.locator('#app input[aria-label="Company name in Tally"]').count() == 0 and "Posting allowed to company" not in txt("#app"), "4. Client setup → Tally: no separate name box, no 'Posting allowed to' card")
        shot(pg, "card-3-reading-desktop-light")

        # ---- 5. posting: off until the tick is confirmed
        tick = card + " [data-tally-link-post-tick]"
        ok(pg.locator(tick).count() == 1 and not pg.is_checked(tick) and "Post this client" in txt(card + " [data-tally-link-post]"), "5. 'Post this client's entries into GARG SHEKHAR', not ticked")
        ok(E("(c) => postToProblem ? !!postToProblem(S.companies[c]) : true", cid), "5. posting is refused while not ticked (postToProblem)")
        pg.click(tick); confirm(False)
        ok(not pg.is_checked(tick) and E("(c) => choiceState(S.companies[c], 'postTo')", cid) != "confirmed", "5. tick, then No: still off")
        pg.click(tick); pg.wait_for_selector('#confirmBox [data-cbx="yes"]', state="visible", timeout=10000)
        ok("Post Link Co\u2019s entries into GARG SHEKHAR?" in (txt("#confirmBox") or ""), "5. it asks first: \u201cPost Link Co's entries into GARG SHEKHAR?\u201d (%s)" % txt("#confirmBox")[:80])
        confirm(True)
        c5 = E("(c) => [S.companies[c].postTo, choiceState(S.companies[c], 'postTo')]", cid)
        ok(c5 == ["GARG SHEKHAR", "confirmed"] and pg.is_checked(tick), "5. confirmed: posting into GARG SHEKHAR (%s)" % c5)
        ok(not E("(c) => postToProblem(S.companies[c])", cid), "5. posting allowed once confirmed")
        # found by FinCom (guessed): not ticked
        E("(c) => { const co = S.companies[c]; co.choices = Object.assign({}, co.choices, {postTo: {value: 'GARG SHEKHAR', state: 'guessed'}}); co.postTo = 'GARG SHEKHAR'; render(); }", cid); pg.wait_for_timeout(400)
        ok(not pg.is_checked(tick) and "Found by FinCom" in txt(card + " [data-tally-link-post]"), "5. found by FinCom, not chosen: not ticked, said so")
        E("(c) => { const co = S.companies[c]; delete co.choices.postTo; co.postTo = ''; render(); }", cid)

        # ---- 6. More: Change company, Unlink, Name differs in Tally
        pg.click(card + " [data-tally-link-more] summary"); pg.wait_for_timeout(300)
        items = E("() => [...document.querySelectorAll('#app [data-tally-link-more] .bk-menu-list button')].map(b => b.firstChild.textContent.trim())")
        ok(items == ["Change company", "Unlink", "Name differs in Tally", "Tally page"], "6. More: %s" % items)
        pg.click(card + " [data-tally-link-change]"); pg.wait_for_timeout(400)
        ok(pg.locator(card + ' [data-tally-link-changebox] [data-tally-link-option="ABC LTD"]').count() == 1, "6. Change company lists the other companies seen")
        n0 = len(calls("tally_company_link"))
        pg.click(card + " [data-tally-link-more] summary"); pg.wait_for_timeout(200); pg.click(card + " [data-tally-link-unlink]"); confirm(True); pg.wait_for_timeout(600)
        ok(calls("tally_company_link")[n0:] == [["tally_company_link", {"p_company": "GARG SHEKHAR", "p_client": None}]], "6. Unlink -> tally_company_link with no client (%s)" % calls("tally_company_link")[n0:])
        scene(LINKED(D1))
        pg.click(card + " [data-tally-link-more] summary"); pg.wait_for_timeout(200); pg.click(card + " [data-tally-link-name]"); pg.wait_for_timeout(300)
        ok(pg.locator(card + ' [data-tally-link-namebox] input[aria-label="Company name in Tally"]').count() == 1, "6. Name differs in Tally: the name box, under More")

        # ---- 7. Needs you: one line, one button
        scene(LINKED(D1), lines=HELD)
        E("() => { Rec.act.at = 0; if (Rec.actLoad) Rec.actLoad(); AlertHub.refresh(true); }"); pg.wait_for_timeout(2000); E("() => render()"); pg.wait_for_timeout(500)
        line = one_line("Needs you", "7. needs you")
        ok("held" in line and pg.locator(card + " [data-tally-link-status] [data-tally-need-held]").count() == 1, "7. needs you: the held entry, with See them (%s)" % line)
        shot(pg, "card-4-needs-you-desktop-light")
        stop = [{"id": 8, "device_id": D1, "action": "stop", "reason": "Tally slow", "stopped_at": "ago:5", "cleared_at": None, "stopped_by": None}]
        scene(LINKED(D1), stops=stop); E("() => render()"); pg.wait_for_timeout(500)
        line = one_line("Needs you", "7. stopped")
        ok("Tally slow" in line and pg.locator(card + " [data-read-resume-line]").count() == 1, "7. stopped: said, with Resume (%s)" % line)

        # ---- 8. the chip and the top bar say the same words
        scene(LINKED(D3))
        E("() => { Rec.act.at = 0; if (Rec.actLoad) Rec.actLoad(); AlertHub.refresh(true); }"); pg.wait_for_timeout(1500); E("() => render()"); pg.wait_for_timeout(400)
        sign = E("() => { const b = document.querySelector('[data-tally-sign]'); return b ? [b.getAttribute('data-tally-link-sign'), b.title] : null; }")
        ok(sign and sign[0] == "waiting" and "link: Waiting for Tally" in sign[1], "8. the top bar's sign: 'link: Waiting for Tally' (%s %s)" % (sign, E("JSON.stringify(tallyLinkOf(CO()).needs)")))
        E("() => navHome('clients')"); pg.wait_for_timeout(900)
        chip = E("(c) => { const r = [...document.querySelectorAll('#app [data-tally-link-chip]')].map(e => e.innerText.trim()); return r; }", cid)
        ok(any(c.endswith("Waiting for Tally") for c in chip) and all(any(c.endswith(w) for w in WORDS) for c in chip), "8. the Clients chip: the four words (%s)" % chip)

        # ---- 9. the Tally page: guide while a client is not linked; Link… on a computer card; no port outside Details
        E("() => { const o = newCompany({name: 'ZZ Other', gstin: ''}); S.companies[o.id] = o; S.data[o.id] = {parties: {}, entries: {}, loaded: true}; o.stats = {}; }")
        scene(LINKED(D1)); E("() => { S.tallyFocus = ''; navHome('tally'); }"); pg.wait_for_timeout(1800)
        g = txt("#app [data-tally-guide]")
        ok(pg.locator("#app [data-tally-guide]").count() == 1 and "ZZ Other is not linked yet" in g and pg.locator("#app [data-tally-guide] [data-guide-link]").count() == 1,
           "9. the guide stays while a client is not linked, with Link ZZ Other (%s)" % g[-160:])
        ok(pg.locator('#app [data-computer="%s"] [data-card-link="ABC LTD"]' % D2).count() == 1, "9. LAPTOP's card: ABC LTD seen, not linked, with Link…")
        no_port("9. the Tally page")
        shot(pg, "tally-page-desktop-light")
        # Link… on the card
        n0 = len(calls("tally_company_link"))
        pg.select_option('#app [data-computer="%s"] [data-card-link="ABC LTD"]' % D2, cid); pg.wait_for_timeout(900)
        ok(calls("tally_company_link")[n0:] == [["tally_company_link", {"p_company": "ABC LTD", "p_client": cid}]], "9. Link… -> tally_company_link once (%s)" % calls("tally_company_link")[n0:])
        # every client linked: the guide folds
        E("() => { const ids = Object.values(S.companies).filter(x => !x.deleted).map(x => x.id); window.__companies = ids.map((id, i) => ({company: 'CO ' + i, client_id: id, device_id: '%s', gstin: ''})); TLight.st.cos = window.__companies; TCloud.pane.companies = window.__companies; render(); }" % D1)
        pg.wait_for_timeout(600)
        ok(pg.locator("#app [data-tally-guide]").count() == 0 and pg.locator("#app [data-guide-again]").count() == 1, "9. every client linked: the guide folds to 'Connect another computer'")
        # this computer's Tallys (Details): no linking there
        E("""() => { Bridge.cfg = () => ({url: 'http://localhost:1', key: 'k', follow: false, port: 0}); Bridge.blocked = () => false; Bridge.on = () => true; Bridge.up = () => true;
              Object.assign(Bridge.st, {state: 'ok', version: '2.4.1', mode: 'auto', user: 'anshul', tallyUp: true, at: Date.now(), open: [{name: 'QQ ELSEWHERE'}],
              sessions: [{port: 9000, ok: true, mine: true, companies: [{name: 'QQ ELSEWHERE'}]}, {port: 9001, skipped: true, ok: false, companies: []}]}); S.tallyMore = {page: true}; render(); }""")
        pg.wait_for_timeout(700)
        ok("Use this Tally" in txt("#app [data-bridge-more]") and "Link to a client" not in txt("#app"), "9. Details: the Tallys with Use this Tally; no 'Link to a client…'")
        # no bridge on this computer again (it would follow the company open in Tally to another client)
        E("() => { Bridge.on = () => false; Bridge.up = () => false; S.tallyMore = {}; render(); }"); pg.wait_for_timeout(300)

        # ---- 10. Add client lands on the card
        E("() => doAct('addCo')"); pg.wait_for_timeout(500)
        pg.fill("#ncName", "ZZ New Client"); pg.click('#app button:has-text("Add and open")'); pg.wait_for_timeout(1200)
        ok(E("[S.view, S.tab, CO() && CO().name]") == ["company", "cotally", "ZZ New Client"] and E("document.querySelector('#app [data-tally-link]') && document.querySelector('#app [data-tally-link]').getAttribute('data-tally-link')") == "unlinked",
           "10. Add client: the new client opens on its Link to Tally card, not linked (%s)" % E("[S.view, S.tab]"))

        # ---- 11. Getting ready: one step, Link to Tally, opens the card; ticked only on a real link
        scene(SEEN)
        E("(c) => { S.companies[c].onbHide = false; S.companies[c].tallyName = 'GARG SHEKHAR'; goClient('dash'); }", cid); pg.wait_for_timeout(900)
        st = E("ONB.steps(CO()).map(s => [s.id, s.done])")
        ok([s[0] for s in st if s[0] in ("tally", "bridge", "link")] == ["link"] and dict(st)["link"] is False, "11. one step, Link to Tally; a Tally name alone does not tick it (%s)" % st)
        pg.click('#app [data-onb-step="link"] button'); pg.wait_for_timeout(800)
        ok(E("S.tab") == "cotally" and pg.locator("#app [data-tally-link]").count() == 1, "11. Link to Tally opens the client's card (%s)" % E("S.tab"))
        scene(LINKED(D3))
        ok(E("ONB.steps(CO()).find(s => s.id === 'link').done") is True, "11. linked in the cloud (its computer off): ticked")

        # ---- 12. the shots: the card in its four states, desktop 1440 and phone 390, light and dark; the Tally page
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
                    for n, (nm, comp, lines) in enumerate([("not-linked", SEEN, ()), ("waiting", LINKED(D3), ()), ("reading", LINKED(D1), ()), ("needs-you", LINKED(D1), HELD)], 1):
                        qs(comp, lines)
                        if lines: q.evaluate("() => { Rec.act.at = 0; if (Rec.actLoad) Rec.actLoad(); AlertHub.refresh(true); }"); q.wait_for_timeout(1800); q.evaluate("() => render()"); q.wait_for_timeout(400)
                        wide("card " + nm)
                        el = q.locator("#app [data-tally-link]")
                        if el.count(): el.screenshot(path=os.path.join(SHOTS, "card-%d-%s-%s-%s.png" % (n, nm, tag, scheme)))
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
