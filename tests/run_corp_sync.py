"""python3 run_corp_sync.py - Corporate's store and the firm's copy (stage-2 fixes after the review of 30f70eea6), on a
stand-in of the cloud in the page (tests/corp_fake_cloud.py; made-up rows only):
  H1  an edit made while a save is on its way is sent too (the field's version), never lost;
  H2  two computers editing different fields of the profile: both kept (the conditional update fails for the second,
      it reads the row again, merges field by field and sends again); a computer's offline edit merged into the firm's
      newer row, not laid over it; nothing sent before the firm's copy was read; no clock of the computer compared;
  M6  this computer's copy is kept under the signed-in person's copy (LocalOwner.P + "corp:"); a copy under the first
      name ("fincom:corp:") is moved once, for the same owner only;
  M7  a firm whose server has corp_profiles but not corp_filings: the profile is shared, and the page says only e-Forms
      stay on this computer.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_corp_sync.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from corp_fake_cloud import INSTALL
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("CORP_PORT") or 8726)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
SETUP = """() => {
  const a = newCompany({name: "Kestrel Textiles Private Limited (made-up)", gstin: "07AABCK1234F1Z5"}); a.pan = "AABCK1234F";
  S.companies[a.id] = a; Store.saveCompany(a); S.coId = a.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false; render(); return a.id; }"""
WAIT = "(ms) => new Promise((r) => setTimeout(r, ms))"

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    co = E(SETUP); W(800)
    E("(id) => openCompany(id).then(() => goClient('books:corp'))", co); W(1800)
    ok(E("typeof FCCorp === 'object'"), "the Corporate chunk is loaded")

    print("M6. kept under the person's copy")
    E("(cid) => { FCCorp.saveProfile(cid, {nic: '13990'}); }", co); W(300)
    key = E("() => FCCorp.key()")
    ok(key == E("() => LocalOwner.P") + "corp:" and E("(k) => !!localStorage.getItem(k)", key + co) and not E("(cid) => !!localStorage.getItem('fincom:corp:' + cid)", co), "kept as %s<client> (LocalOwner.P), not the first name" % key)
    ok(E("() => LocalOwner.firmKey(FCCorp.key() + 'x')"), "a key LocalOwner puts aside with the person's copy")
    old = {"profile": {"cin": "U17299DL2019PTC000000", "name": "Old copy (made-up)"}, "filings": [{"ref": "annual:DPT-3:2025-26", "form": "DPT-3", "status": "in_progress", "steps": 1}], "docs": [], "pending": {"profile": 1}}
    E("([cid, o]) => { FCCorp.forget(); localStorage.removeItem(FCCorp.key() + cid + 'b'); localStorage.setItem('fincom:corp:' + cid + 'b', JSON.stringify(o)); }", [co, old])
    moved = E("(cid) => { const c = FCCorp.corpOf(cid + 'b'); return {cin: c.profile.cin, f: c.filings.map(x => x.ref), oldGone: !localStorage.getItem('fincom:corp:' + cid + 'b'), newKept: !!localStorage.getItem(FCCorp.key() + cid + 'b')}; }", co)
    ok(moved["cin"] == "U17299DL2019PTC000000" and moved["f"] == ["annual:DPT-3:2025-26"] and moved["oldGone"] and moved["newKept"], "a copy under the first name: moved once, its fields kept (%s)" % moved)
    E("([cid, o]) => { o.owner = 'someone-else'; localStorage.setItem('fincom:corp:' + cid + 'c', JSON.stringify(o)); }", [co, old])
    other = E("(cid) => { const c = FCCorp.corpOf(cid + 'c'); return {cin: c.profile.cin || '', left: !!localStorage.getItem('fincom:corp:' + cid + 'c')}; }", co)
    ok(other["cin"] == "" and other["left"], "one kept for another person: not moved (%s)" % other)

    print("H2. two computers, different fields")
    E(INSTALL)
    # the firm's row as another computer left it: the CIN and the email
    E("(cid) => { __fake.rows.corp_profiles.push({client_id: cid, profile: {cin: 'U17299DL2019PTC000000', email: 'firm@example.com'}, directors: [], shareholders: [], charges: [], letterhead: {}, updated_at: __fake.stamp()}); }", co)
    # this computer, offline before: a change of the NIC (kept, not sent); now signed in: read first, merged, then sent
    E("(cid) => { FCCorp.forget(cid); }", co)
    E("(cid) => FCCorp.corpOf(cid)", co); E(WAIT, 1200)
    order = [ (c["method"], c["path"].split("?")[0]) for c in E("() => __fake.log") ]
    ok(order and order[0][0] == "GET" and ("PATCH", "corp_profiles") in order and order.index(("GET", "corp_profiles")) < order.index(("PATCH", "corp_profiles")), "the firm's copy read before anything is sent (%s)" % order[:5])
    row = E("(cid) => __fake.rows.corp_profiles.find(r => r.client_id === cid).profile", co)
    ok(row.get("nic") == "13990" and row.get("email") == "firm@example.com" and row.get("cin") == "U17299DL2019PTC000000", "the offline edit merged into the firm's row, the firm's fields kept (%s)" % row)
    # another computer changes the email; this one, not knowing, changes the phone: the conditional update fails, then both
    E("(cid) => { const r = __fake.rows.corp_profiles.find(r => r.client_id === cid); r.profile = Object.assign({}, r.profile, {email: 'other@example.com'}); r.updated_at = __fake.stamp(); }", co)
    E("(cid) => { FCCorp.saveProfile(cid, {phone: '+91 11 0000 0001'}); }", co); E(WAIT, 1500)
    row = E("(cid) => __fake.rows.corp_profiles.find(r => r.client_id === cid).profile", co)
    patches = [c for c in E("() => __fake.log") if c["method"] == "PATCH"]
    ok(row.get("email") == "other@example.com" and row.get("phone") == "+91 11 0000 0001" and row.get("nic") == "13990", "both computers' fields survive (%s)" % row)
    ok(all("updated_at=eq." in c["path"] for c in patches), "every change a conditional update on the updated_at last seen")
    ok(E("(cid) => FCCorp.corpOf(cid).profile.email", co) == "other@example.com", "this computer now shows the other's email too")

    print("H1. an edit while a save is on its way")
    E("() => { __fake.delay = 600; __fake.log = []; }")
    E("(cid) => { FCCorp.saveProfile(cid, {website: 'one.example.com'}); }", co); E(WAIT, 700)
    E("(cid) => { FCCorp.saveProfile(cid, {website: 'two.example.com'}); }", co); E(WAIT, 3500)
    row = E("(cid) => __fake.rows.corp_profiles.find(r => r.client_id === cid).profile", co)
    pend = E("(cid) => Object.keys(FCCorp.corpOf(cid).pending)", co)
    ok(row.get("website") == "two.example.com" and pend == [], "the later edit is sent too, nothing left pending (%s, %s)" % (row.get("website"), pend))
    E("() => { __fake.delay = 0; }")

    print("H2. filings: a conditional update; a removal")
    E("(cid) => { FCCorp.saveFiling(cid, {ref: 'annual:MGT-7:2025-26', form: 'MGT-7', kind: 'annual', period: '2025-26', status: 'in_progress', steps: 1}); }", co); E(WAIT, 1200)
    E("(cid) => { const r = __fake.rows.corp_filings.find(r => r.ref === 'annual:MGT-7:2025-26'); r.reason = ''; r.steps = 1; r.data = {note: 'from the other computer'}; r.updated_at = __fake.stamp(); }", co)
    E("(cid) => { FCCorp.saveFiling(cid, {ref: 'annual:MGT-7:2025-26', steps: 2}); }", co); E(WAIT, 1500)
    fr = E("(cid) => __fake.rows.corp_filings.find(r => r.ref === 'annual:MGT-7:2025-26')", co)
    ok(fr["steps"] == 2 and fr["data"].get("note") == "from the other computer", "a filing: this computer's step and the other's note both kept (%s)" % {k: fr[k] for k in ("steps", "data")})
    E("(cid) => { FCCorp.dropFiling(cid, 'annual:MGT-7:2025-26'); }", co); E(WAIT, 1200)
    ok(not E("(cid) => __fake.rows.corp_filings.some(r => r.ref === 'annual:MGT-7:2025-26')", co), "a removal reaches the firm's copy")

    print("M7. corp_profiles there, corp_filings not")
    E("(cid) => { __fake.missing.corp_filings = true; FCCorp.forget(cid); FCCorp.corpOf(cid); }", co); E(WAIT, 1000)
    note = E("(cid) => FCCorp.cloudNote(cid).text", co)
    ok("except e-Forms" in note and "Sharing with the firm starts" not in note, "the note names e-Forms only (%s)" % note)
    E("(cid) => { FCCorp.saveProfile(cid, {nic: '13991'}); FCCorp.saveFiling(cid, {ref: 'annual:DPT-3:2025-26', form: 'DPT-3', kind: 'annual', period: '2025-26', status: 'in_progress', steps: 1}); }", co); E(WAIT, 1500)
    ok(E("(cid) => __fake.rows.corp_profiles.find(r => r.client_id === cid).profile.nic", co) == "13991" and E("(cid) => Object.keys(FCCorp.corpOf(cid).pending)", co) == ["f:annual:DPT-3:2025-26"],
       "the profile still sent; the filing kept here, waiting")
    E("() => __fake.restore()")
    ctx.close(); br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
