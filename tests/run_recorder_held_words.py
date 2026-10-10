"""python3 run_recorder_held_words.py - (05-Oct-2026, the owner's blocker: Sync activity said a held line's state in the cloud's
bare words and never what it means for the books). The Tally page's Sync activity, each recorder line's ACTION and STATE in
the owner's words, exactly:
  action: "Created", "Altered", "Deleted", "Cancelled"; "Posted from FinCom" for FinCom's own entry (a created / imported line
    with a FinCom id: payload fid or a short line, read as fid / short with the lines; or the cloud's words "FinCom posting
    <id> matched" / "FinCom id <id> ..."); a later change in Tally to FinCom's entry is a person's: "Altered".
  state: applied -> "Entered in the books"; held -> "Received, not yet entered in the books: <reason>"; replaced ->
    "Replaced by a later line"; duplicate -> "Already in the books"; stale -> "An older change, not applied"; failed ->
    "Not entered: <reason>"; queued -> "Received, waiting in FinCom's queue"; received -> "Received, not yet entered in the
    books".
  Never "synced" anywhere on the page; "Entered in the books" only on an applied line; the strip of lines waiting says
  "not yet entered in the books" when it has no other reason; an owner's Apply now answers in the same words; a line coming
  in live (its whole row, payload included) the same.
  2.3.1 (the owner's rule after review, 06-Oct-2026): an applied line with notes for checking (payload checkNotes, read as
  checks) says "Entered in the books; to check: <notes>".
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_recorder_held_words.py
RED (before the change): the bare states ("applied", "held: ...") and actions ("created")."""
import json, os, re, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", 8507), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
D1 = "d0000000-0000-4000-8000-000000000001"
NOBODY = "waiting for the entry's details from FinCom Bridge (it asks Tally again on its next run); or upload this day's Day Book"
UNKNOWN = "the entry is not in FinCom's copy yet; it is applied by itself once a complete Day Book for 01-Oct-2026 is uploaded"
def dev(i, comp):
    b = {"at": "ago:0.3", "version": "2.2.0", "computer": comp, "user": "tally", "mode": "main", "runMode": "user", "tally": True, "tallyState": "open", "open": ["GARG SHEKHAR & COMPANY"]}
    bt = {"at": "ago:0.3", "every": 30, "tally": True, "tallyState": "open", "open": b["open"], "paused": False}
    return {"id": i, "name": comp, "revoked": False, "last_seen": "ago:0.3", "version": "2.2.0", "main_bridge": "go-" + i, "info": {"computer": comp, "user": "tally", "beat": bt, "bridges": {"go-" + i: b}}, "created_at": "2026-09-01T00:00:00Z"}
DEVS = [dev(D1, "NWS144")]
NOTE = "the GST worked out on the items (Rs 410.00) does not match the GST ledger lines (Rs 428.00)"
def line(i, event, state, rec, why=None, no="191", fid=None, short=None, checks=None):
    return {"checks": checks, "id": i, "client_id": "CID", "book_id": "b1", "device_id": D1, "pc": "NWS144", "company": "GARG SHEKHAR & COMPANY", "line_id": "L" + str(i), "event": event, "object_guid": "g-%d" % i, "alter_id": 54000 + i,
            "vch_type": "Receipt", "vch_no": no, "vch_date": "2026-10-05", "saved_at": rec, "received_at": rec, "applied_at": rec if state == "applied" else None, "state": state, "held_why": why, "ledgers": [],
            "fid": fid, "short": short}
LINES = [
    line(201, "created", "applied", "ago:1", no="201"),
    line(202, "altered", "held", "ago:10", why=NOBODY, no="191"),
    line(203, "deleted", "applied", "ago:11", no="189"),
    line(204, "cancelled", "held", "ago:12", why=UNKNOWN, no="190"),
    line(205, "altered", "replaced", "ago:13", why="replaced by line 210 (the entry's details arrived)", no="191"),
    line(206, "created", "duplicate", "ago:14", why="the same change already came as line 201 (applied)", no="201"),
    line(207, "altered", "stale", "ago:15", why="AlterID 5 is older than the 9 held", no="202"),
    line(208, "created", "failed", "ago:16", why="an internal error (code XX000)", no="203"),
    line(209, "created", "queued", "ago:17", no="204"),
    line(210, "created", "applied", "ago:18", no="205", fid="B-17", short="true"),
    line(211, "created", "applied", "ago:19", why="FinCom posting B-18 matched", no="206"),
    line(212, "altered", "held", "ago:20", why="FinCom posting B-19 matched; changed in Tally after posting: the next full line or Day Book upload applies it", no="207", fid="B-19"),
    line(213, "created", "received", "ago:21", no="208"),
    # the owner's rule after review (06-Oct-2026): a mismatch other than lines not totalling zero applies the entry with a note
    line(215, "created", "applied", "ago:22", no="210", checks=[NOTE])]
SETUP = """async ([role, devs, lines]) => {
  const now = Date.now(), ago = m => new Date(now - m * 60000).toISOString();
  const fix = (o) => JSON.parse(JSON.stringify(o), (k, v) => typeof v === "string" && v.startsWith("ago:") ? ago(Number(v.slice(4))) : v);
  let c = Object.values(S.companies).find(x => x.name === "GARG SHEKHAR & COMPANY");
  if (!c){ c = newCompany({name: "GARG SHEKHAR & COMPANY", gstin: ""}); c.tallyName = "GARG SHEKHAR & COMPANY"; S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {}; }
  window.__devs = fix(devs); window.__lines = fix(lines).map(l => Object.assign(l, {client_id: l.client_id === "CID" ? c.id : l.client_id})); window.__calls = []; window.__asked = [];
  Cloud.on = () => true; Cloud.st.firm = "f-1"; Cloud.st.members = [{user_id: "u-anshul", name: "Anshul"}];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role})});
  TCloud.on = () => true;
  const copy = (o) => JSON.parse(JSON.stringify(o));
  Cloud.api = async (path) => {
    window.__asked.push(path);
    if (/^tally_devices/.test(path)) return copy(window.__devs);
    if (/^tally_recorder_lines/.test(path)) return copy(window.__lines);
    return [];
  };
  TCloud.restAll = async (u) => Cloud.api(u);
  TCloud.rpc = async (fn, a) => { window.__calls.push([fn, copy(a || {})]);
    if (fn === "tally_recorder_release_held") return {ok: true, line_id: "L" + a.p_line, state: "applied", why: null};
    return {ok: true}; };
  TLight.refresh = function(){ return Promise.resolve(); }; TLight.st = {at: Date.now(), busy: false, by: {}, devs: copy(window.__devs), cos: [{company: "GARG SHEKHAR & COMPANY", client_id: c.id, device_id: devs[0].id}]};
  TCloud.pane.devices = null; TCloud.pane.at = 0; TCloud.pane.err = "";
  if (typeof Rec === "object"){ Rec.act = {}; Rec.silent = {}; }
  document.body.classList.add("is-test"); S.firm.firmName = S.firm.firmName || "Test Firm";
  S.tallyOld = false; S.tallyTab = ""; S.syncClient = "";
  return c.id;
}"""
WANT = {201: ("Created", "Entered in the books"), 202: ("Altered", "Received, not yet entered in the books: " + NOBODY), 203: ("Deleted", "Entered in the books"),
        204: ("Cancelled", "Received, not yet entered in the books: " + UNKNOWN), 205: ("Altered", "Replaced by a later line"), 206: ("Created", "Already in the books"),
        207: ("Altered", "An older change, not applied"), 208: ("Created", "Not entered: an internal error (code XX000)"), 209: ("Created", "Received, waiting in FinCom's queue"),
        210: ("Posted from FinCom", "Entered in the books"), 211: ("Posted from FinCom", "Entered in the books"),
        212: ("Altered", "Received, not yet entered in the books: FinCom posting B-19 matched; changed in Tally after posting: the next full line or Day Book upload applies it"),
        213: ("Created", "Received, not yet entered in the books"), 215: ("Created", "Entered in the books; to check: " + NOTE)}
with sync_playwright() as p:
    br = p.chromium.launch(); pg = br.new_page(viewport={"width": 1600, "height": 1100}); pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/assets/bridge-go/latest.json", lambda r: r.fulfill(status=200, content_type="application/json",
        body=json.dumps({"setup": {"version": "2.2.0", "url": "https://x/assets/bridge-go/FinComBridge-Setup-2.2.0.exe", "sha256": "ab" * 32}})))
    pg.goto("http://localhost:8507/"); pg.wait_for_timeout(2500)
    pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(800)
    E = lambda js, *a: pg.evaluate(js, *a)
    txt = lambda sel: pg.inner_text(sel).replace("\n", " ").strip() if pg.locator(sel).count() else ""
    tc = lambda sel: (pg.text_content(sel) or "").replace("\n", " ").strip() if pg.locator(sel).count() else ""   # 2.3.5: the lines under "Which entries" are folded
    cid = E(SETUP, ["owner", DEVS, LINES]); pg.wait_for_timeout(300)
    E("() => { navHome('tally'); S.tallyTab = 'activity'; render(); }"); pg.wait_for_timeout(1500)
    asked = [a for a in E("window.__asked") if a.startswith("tally_recorder_lines")]
    ok(asked and "fid:payload->>fid" in asked[-1] and "short:payload->>short" in asked[-1] and "checks:payload->checkNotes" in asked[-1], "the lines are read with their FinCom id, short mark and notes for checking (%s)" % (asked[-1:] or ""))
    rows = pg.locator("#app [data-sync-line]")
    ok(rows.count() == len(LINES), "every line shown (%d)" % rows.count())
    for i, (act, st) in WANT.items():
        s = txt('#app [data-sync-line="%d"] [data-sync-state]' % i)
        a = txt('#app [data-sync-line="%d"] [data-sync-act]' % i)
        ok(s == st and a == act, "line %d: action %r, state %r (got %r, %r)" % (i, act, st, a, s))
    entered = [i for i in WANT if txt('#app [data-sync-line="%d"] [data-sync-state]' % i) == "Entered in the books"]
    ok(sorted(entered) == [201, 203, 210, 211], "'Entered in the books' only on the applied lines (%s)" % entered)
    page = txt("#app [data-sync-activity]")
    ok(not re.search(r"(?i)synced", page), "never 'synced' on the page")
    ok(not re.search(r"(?i)day read", page), "never 'day read' on the page")
    ok(pg.locator('#app [data-sync-line="205"] [data-sync-state].tag.no').count() == 1, "a replaced line greyed as a duplicate is")
    # the strip: a received line with no reason of its own (the PC online, Tally open) says what it means
    w = tc('#app [data-sync-fetching-line="213"]')   # 2.3.5: a received line is "being fetched" (quiet)
    ok("not yet entered in the books" in w and "applied" not in w, "being fetched: 'not yet entered in the books' when there is no other reason (%s)" % w)
    # an owner's Apply now answers in the same words
    pg.click('#app [data-sync-line="202"] [data-sync-release]'); pg.wait_for_timeout(800)
    m = txt("#app [data-sync-msg]")
    ok("Entered in the books" in m and "applied" not in m, "Apply now answers 'Entered in the books' (%s)" % m)
    # live: the whole row (payload included) of a FinCom posting coming back
    E("""() => { Live.recorderTopic = 'realtime:fincom-recorder-f-1'; Live.got({topic: 'realtime:fincom-recorder-f-1', event: 'postgres_changes', payload: {data: {type: 'INSERT', table: 'tally_recorder_lines', record: {id: 214, client_id: Object.values(S.companies).find(x => x.name === 'GARG SHEKHAR & COMPANY').id, book_id: 'b1', device_id: '%s', pc: 'NWS144', company: 'GARG SHEKHAR & COMPANY', event: 'created', vch_type: 'Receipt', vch_no: '209', vch_date: '2026-10-05', saved_at: new Date().toISOString(), received_at: new Date().toISOString(), state: 'held', held_why: %s, ledgers: [], payload: {fid: 'B-20', short: true}}}}}); }""" % (D1, json.dumps(NOBODY)))
    pg.wait_for_timeout(500)
    ok(txt('#app [data-sync-line="214"] [data-sync-act]') == "Posted from FinCom" and txt('#app [data-sync-line="214"] [data-sync-state]') == "Received, not yet entered in the books: " + NOBODY,
       "a line coming in live: Posted from FinCom, received, not yet entered (%s / %s)" % (txt('#app [data-sync-line="214"] [data-sync-act]'), txt('#app [data-sync-line="214"] [data-sync-state]')))
    E("""() => { Live.got({topic: 'realtime:fincom-recorder-f-1', event: 'postgres_changes', payload: {data: {type: 'INSERT', table: 'tally_recorder_lines', record: {id: 216, client_id: Object.values(S.companies).find(x => x.name === 'GARG SHEKHAR & COMPANY').id, book_id: 'b1', device_id: '%s', pc: 'NWS144', company: 'GARG SHEKHAR & COMPANY', event: 'created', vch_type: 'Sales', vch_no: '211', vch_date: '2026-10-05', saved_at: new Date().toISOString(), received_at: new Date().toISOString(), state: 'applied', held_why: null, ledgers: [], payload: {checkNotes: [%s]}}}}}); }""" % (D1, json.dumps(NOTE)))
    pg.wait_for_timeout(500)
    ok(txt('#app [data-sync-line="216"] [data-sync-state]') == "Entered in the books; to check: " + NOTE, "a line coming in live with notes: entered, with what to check (%s)" % txt('#app [data-sync-line="216"] [data-sync-state]'))
    ok(not errors, "no page errors %s" % errors[:2])
    br.close()
srv.shutdown()
print("\nall passed" if not fails else "\nFAILED: %d" % len(fails)); raise SystemExit(1 if fails else 0)
