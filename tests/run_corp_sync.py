"""python3 run_corp_sync.py - Corporate's store and the firm's copy (stage-2 fixes after the review of 30f70eea6), on a
stand-in of the cloud in the page (tests/corp_fake_cloud.py; made-up rows only):
  H1  an edit made while a save is on its way is sent too (the field's version), never lost;
  H2  two computers editing different fields of the profile: both kept (the conditional update fails for the second,
      it reads the row again, merges field by field and sends again); a computer's offline edit merged into the firm's
      newer row, not laid over it; nothing sent before the firm's copy was read; no clock of the computer compared;
  M6  this computer's copy is kept under the signed-in person's copy (LocalOwner.P + "corp:"); a copy under the first
      name ("fincom:corp:", a build never published) is not read;
  1   lists merged three ways by row id (a DIN changed here, a director added there: both); AGMs of two years both kept;
  3   a record removed and saved again while the removal is on its way: sent as new; a removal of a row changed
      elsewhere meanwhile: the row kept, and said;
  4   two tabs: each tab's edits reach the other and the copy kept, none dropped;
  5   a copy kept for another person is neither read nor written over;
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
    # the first name ("fincom:corp:") of a build never published: not read any more
    E("(cid) => { FCCorp.forget(); localStorage.setItem('fincom:corp:' + cid + 'b', JSON.stringify({profile: {cin: 'U17299DL2019PTC000000'}})); }", co)
    ok(E("(cid) => FCCorp.corpOf(cid + 'b').profile.cin || ''", co) == "", "a copy under the first name is not read")

    print("5. a copy kept for another person")
    E("(cid) => { localStorage.setItem(FCCorp.key() + cid + 'c', JSON.stringify({profile: {base: null, at: '', cur: {cin: 'L00000MH2000PLC000000'}, dirty: {}, gone: false}, filings: {}, docs: {}, ver: 1, owner: 'someone-else'})); FCCorp.forget(); }", co)
    other = E("(cid) => { const c = FCCorp.corpOf(cid + 'c'); FCCorp.saveProfile(cid + 'c', {nic: '1'}); return {cin: c.profile.cin || '', kept: JSON.parse(localStorage.getItem(FCCorp.key() + cid + 'c')).owner}; }", co)
    ok(other["cin"] == "" and other["kept"] == "someone-else", "not taken, and not written over by a save here (%s)" % other)

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

    print("1. lists merged three ways")
    E("(cid) => { const r = __fake.rows.corp_profiles.find(r => r.client_id === cid); r.directors = [{id: 'd1', name: 'Asha Verma (made-up)', din: '00000011'}, {id: 'd2', name: 'Ravi Menon (made-up)', din: '00000022'}]; r.profile = Object.assign({}, r.profile, {agms: {'2023-24': '2024-09-20'}}); r.updated_at = __fake.stamp(); FCCorp.forget(cid); FCCorp.corpOf(cid); }", co); E(WAIT, 1200)
    # B (the server) adds director 3 and the AGM of 2024-25; A (here, not knowing) changes director 1's DIN and adds the AGM of 2025-26
    E("(cid) => { const r = __fake.rows.corp_profiles.find(r => r.client_id === cid); r.directors = r.directors.concat([{id: 'd3', name: 'Meera Iyer (made-up)', din: '00000033'}]); r.profile = Object.assign({}, r.profile, {agms: Object.assign({}, r.profile.agms, {'2024-25': '2025-09-25'})}); r.updated_at = __fake.stamp(); }", co)
    E("(cid) => { const p = FCCorp.corpOf(cid).profile; FCCorp.saveProfile(cid, {directors: p.directors.map(d => d.id === 'd1' ? Object.assign({}, d, {din: '00000099'}) : d), agms: Object.assign({}, p.agms, {'2025-26': '2026-09-24'})}); }", co); E(WAIT, 1500)
    r = E("(cid) => __fake.rows.corp_profiles.find(r => r.client_id === cid)", co)
    ok([(d["id"], d["din"]) for d in r["directors"]] == [("d1", "00000099"), ("d2", "00000022"), ("d3", "00000033")], "A's DIN change and B's new director both kept (%s)" % [(d["id"], d["din"]) for d in r["directors"]])
    ok(r["profile"]["agms"] == {"2023-24": "2024-09-20", "2024-25": "2025-09-25", "2025-26": "2026-09-24"}, "two different AGM years both kept (%s)" % r["profile"]["agms"])
    E("(cid) => { const r = __fake.rows.corp_profiles.find(r => r.client_id === cid); r.directors = r.directors.filter(d => d.id !== 'd2'); r.updated_at = __fake.stamp(); }", co)
    E("(cid) => { const p = FCCorp.corpOf(cid).profile; FCCorp.saveProfile(cid, {directors: p.directors.map(d => d.id === 'd3' ? Object.assign({}, d, {desig: 'Additional Director'}) : d)}); }", co); E(WAIT, 1500)
    r = E("(cid) => __fake.rows.corp_profiles.find(r => r.client_id === cid)", co)
    ok([d["id"] for d in r["directors"]] == ["d1", "d3"] and r["directors"][1].get("desig") == "Additional Director", "a director removed there stays removed; the change here to another is kept (%s)" % r["directors"])

    print("3. removed, then saved while the removal is on its way; a removal of a row changed elsewhere")
    E("(cid) => { FCCorp.saveFiling(cid, {ref: 'annual:ADT-1:2025-26', form: 'ADT-1', kind: 'annual', period: '2025-26', status: 'in_progress', steps: 1}); }", co); E(WAIT, 1200)
    E("() => { __fake.delay = 700; }")
    E("(cid) => { FCCorp.dropFiling(cid, 'annual:ADT-1:2025-26'); }", co); E(WAIT, 700)
    E("(cid) => { FCCorp.saveFiling(cid, {ref: 'annual:ADT-1:2025-26', form: 'ADT-1', kind: 'annual', period: '2025-26', status: 'in_progress', steps: 3}); }", co); E(WAIT, 4000)
    E("() => { __fake.delay = 0; }")
    fr = E("(cid) => __fake.rows.corp_filings.find(r => r.ref === 'annual:ADT-1:2025-26') || null", co)
    ok(fr and fr["steps"] == 3 and E("(cid) => !!FCCorp.corpOf(cid).filings.find(f => f.ref === 'annual:ADT-1:2025-26')", co), "saved again during the removal: sent as new, kept here (%s)" % (fr and fr["steps"]))
    E("(cid) => { const r = __fake.rows.corp_filings.find(r => r.ref === 'annual:ADT-1:2025-26'); r.steps = 4; r.updated_at = __fake.stamp(); FCCorp.dropFiling(cid, 'annual:ADT-1:2025-26'); }", co); E(WAIT, 1500)
    fr = E("(cid) => __fake.rows.corp_filings.find(r => r.ref === 'annual:ADT-1:2025-26') || null", co)
    ok(fr and fr["steps"] == 4 and "changed on another computer" in E("(cid) => FCCorp.cloudNote(cid).text", co) and E("(cid) => !!FCCorp.corpOf(cid).filings.find(f => f.ref === 'annual:ADT-1:2025-26')", co),
       "a removal of a row changed elsewhere meanwhile: kept, and said (%s)" % E("(cid) => FCCorp.cloudNote(cid).text", co))

    print("M7. corp_profiles there, corp_filings not")
    E("(cid) => { __fake.missing.corp_filings = true; FCCorp.forget(cid); FCCorp.corpOf(cid); }", co); E(WAIT, 1000)
    note = E("(cid) => FCCorp.cloudNote(cid).text", co)
    ok("except e-Forms" in note and "Sharing with the firm starts" not in note, "the note names e-Forms only (%s)" % note)
    E("(cid) => { FCCorp.saveProfile(cid, {nic: '13991'}); FCCorp.saveFiling(cid, {ref: 'annual:DPT-3:2025-26', form: 'DPT-3', kind: 'annual', period: '2025-26', status: 'in_progress', steps: 1}); }", co); E(WAIT, 1500)
    ok(E("(cid) => __fake.rows.corp_profiles.find(r => r.client_id === cid).profile.nic", co) == "13991" and E("(cid) => Object.keys(FCCorp.corpOf(cid).pending)", co) == ["f:annual:DPT-3:2025-26"],
       "the profile still sent; the filing kept here, waiting (%s, %s)" % (E("(cid) => __fake.rows.corp_profiles.find(r => r.client_id === cid).profile.nic", co), E("(cid) => Object.keys(FCCorp.corpOf(cid).pending)", co)))
    E("() => __fake.restore()")

    print("4. two tabs")
    E("(cid) => { FCCorp.forget(); localStorage.removeItem(FCCorp.key() + cid); }", co)
    pg2 = ctx.new_page(); pg2.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg2.goto("http://localhost:%d/" % PORT); pg2.wait_for_timeout(2500); pg2.evaluate(OPEN); pg2.wait_for_timeout(800)
    pg2.evaluate("(id) => openCompany(id).then(() => goClient('books:corp'))", co); pg2.wait_for_timeout(2000)
    E("(cid) => FCCorp.corpOf(cid)", co); pg2.evaluate("(cid) => FCCorp.corpOf(cid)", co)
    E("(cid) => FCCorp.saveProfile(cid, {phone: '+91 11 1111 1111'})", co); W(400)
    pg2.evaluate("(cid) => FCCorp.saveProfile(cid, {website: 'tab-two.example.com'})", co); W(400)
    E("(cid) => FCCorp.saveProfile(cid, {email: 'tab-one@example.com'})", co); W(600)
    kept = E("(cid) => JSON.parse(localStorage.getItem(FCCorp.key() + cid)).profile.cur", co)
    one, two = E("(cid) => FCCorp.corpOf(cid).profile", co), pg2.evaluate("(cid) => FCCorp.corpOf(cid).profile", co)
    ok(kept.get("phone") == "+91 11 1111 1111" and kept.get("website") == "tab-two.example.com" and kept.get("email") == "tab-one@example.com", "the copy kept has both tabs' edits (%s)" % {k: kept.get(k) for k in ("phone", "website", "email")})
    ok(two.get("phone") == "+91 11 1111 1111" and two.get("email") == "tab-one@example.com" and one.get("website") == "tab-two.example.com", "each tab has the other's edits too")
    ok(sorted(E("(cid) => Object.keys(FCCorp.raw(cid).profile.dirty)", co)) == ["email", "phone", "website"], "and all three still to be sent")
    pg2.close()
    ctx.close(); br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
