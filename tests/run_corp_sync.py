"""python3 run_corp_sync.py - Corporate and the firm's copy in the page (the store simplified after the review of
08b05e4c8: the server is the record; tests/run_corp_store.mjs covers the store itself, the review's four scenarios
included). On a stand-in of the cloud in the page (tests/corp_fake_cloud.py; made-up rows only):
  1. signed out: "Sign in to use Corporate" and nothing to change; a save does nothing;
  2. signed in: the firm's copy read; an edit saved as a conditional update of the profile only (no list untouched);
  3. the line down: the edit stays on the screen, "Not saved: ..." with Retry; Retry saves it; nothing of it is in this
     computer's read copy; leaving the page with an edit not saved asks first; a reload does not bring it back;
  4. two tabs: a save in one makes the other read the firm's copy again, and the other's edit not yet saved survives;
  5. Paste master data twice: directors matched by DIN (the appointment date taken), never added twice;
  6. a server without corp_filings: the profile saved, e-Forms said; without corp_profiles: said, nothing to change.
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
def txt(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); return e ? e.innerText.trim() : ''; }", sel)
def srvp(pg, cid): return pg.evaluate("(cid) => (__fake.rows.corp_profiles.find(r => r.client_id === cid) || {})", cid)
def email(pg, v):
    pg.fill("#app [data-corp-details] input[data-f=email]", v); pg.press("#app [data-corp-details] input[data-f=email]", "Tab"); pg.wait_for_timeout(1300)

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    pg.on("dialog", lambda d: d.accept())
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    E("() => localStorage.removeItem('__corp_fake_rows')")
    co = E(SETUP); W(800)
    E("(id) => openCompany(id).then(() => goClient('books:corp'))", co); W(1800)

    print("1. signed out")
    ok("Sign in to use Corporate" in txt(pg, "#app [data-corp-signin]"), "Sign in to use Corporate")
    ok(not E("!!document.querySelector('#app [data-corp-edit], #app [data-corp-paste], #app [data-corp-page]')"), "nothing to change")
    E("(cid) => FCCorp.saveProfile(cid, {phone: 'typed signed out'})", co); W(300)
    ok(not E("(cid) => FCCorp.corpOf(cid).profile.phone", co), "a save signed out does nothing")

    print("2. signed in")
    E(INSTALL); W(1500)
    ok(E("!!document.querySelector('#app [data-corp-page=profile]')") and "Saved to the firm account" in txt(pg, "#app [data-corp-cloud]"), "the profile, read from the firm's copy (%s)" % txt(pg, "#app [data-corp-cloud]"))
    pg.click("#app [data-corp-edit=details]"); W(300)
    email(pg, "secretarial@example.com")
    ok(srvp(pg, co).get("profile", {}).get("email") == "secretarial@example.com", "saved to the firm's copy")
    E("() => { __fake.log = []; }")
    email(pg, "office@example.com")
    pt = [c for c in E("() => __fake.log") if c["method"] == "PATCH"]
    ok(pt and "updated_at=eq." in pt[0]["path"] and sorted(pt[0]["body"]) == ["profile"], "a change: a conditional update of the profile only (%s)" % (pt and sorted(pt[0]["body"])))

    print("3. the line down")
    E("() => { __fake.fail = 'net'; }")
    email(pg, "kept-on-screen@example.com")
    note = txt(pg, "#app [data-corp-cloud]")
    ok(note.startswith("Not saved:") and E("!!document.querySelector('#app [data-corp-retry]')") and E("document.querySelector('#app [data-corp-details] input[data-f=email]').value") == "kept-on-screen@example.com",
       "Not saved, with Retry; the edit on the screen (%s)" % note)
    ok("kept-on-screen" not in (E("(cid) => localStorage.getItem(FCCorp.key() + cid) || ''", co) or ""), "not in this computer's read copy")
    ok(E("() => { const e = new Event('beforeunload', {cancelable: true}); window.dispatchEvent(e); return e.defaultPrevented; }"), "leaving with an edit not saved asks first")
    E("() => { __fake.fail = ''; }")
    pg.click("#app [data-corp-retry]"); W(1300)
    ok(srvp(pg, co)["profile"].get("email") == "kept-on-screen@example.com" and "Saved to the firm account" in txt(pg, "#app [data-corp-cloud]"), "Retry: saved")
    E("() => { __fake.fail = 'net'; }")
    email(pg, "lost-on-reload@example.com")
    E("() => { __fake.fail = ''; __fake.restore(); }")
    pg.reload(); W(3500); E(OPEN); W(800); E(INSTALL); W(1800)
    ok(E("(cid) => FCCorp.corpOf(cid).profile.email", co) == "kept-on-screen@example.com", "after a reload: the firm's copy; the edit not saved is not brought back")

    print("4. two tabs")
    pg2 = ctx.new_page(); pg2.on("pageerror", lambda e: errors.append(str(e)[:200])); pg2.on("dialog", lambda d: d.accept())
    pg2.goto("http://localhost:%d/" % PORT); pg2.wait_for_timeout(2500); pg2.evaluate(OPEN); pg2.wait_for_timeout(800); pg2.evaluate(INSTALL)
    pg2.evaluate("(id) => openCompany(id).then(() => goClient('books:corp'))", co); pg2.wait_for_timeout(2000)
    pg2.evaluate("() => { __fake.fail = 'write'; }")
    pg2.evaluate("(cid) => FCCorp.saveProfile(cid, {website: 'tab-two-unsaved.example.com'})", co); pg2.wait_for_timeout(1000)
    ok(pg2.evaluate("(cid) => Object.keys(FCCorp.corpOf(cid).pending)", co) == ["profile"], "the second tab has an edit not saved")
    E("(cid) => FCCorp.saveProfile(cid, {phone: '+91 11 2222 2222'})", co); W(2000)
    two = pg2.evaluate("(cid) => FCCorp.corpOf(cid).profile", co)
    ok(two.get("phone") == "+91 11 2222 2222", "the other tab read the firm's copy again after the save (%s)" % two.get("phone"))
    ok(two.get("website") == "tab-two-unsaved.example.com", "its own edit not yet saved survived the read")
    pg2.evaluate("() => { __fake.fail = ''; }"); pg2.evaluate("(cid) => FCCorp.retryNow(cid)", co); pg2.wait_for_timeout(1500)
    r = srvp(pg, co)["profile"]
    ok(r.get("website") == "tab-two-unsaved.example.com" and r.get("phone") == "+91 11 2222 2222", "both tabs' edits on the server in the end (%s)" % {k: r.get(k) for k in ("phone", "website")})
    pg2.close()

    print("5. Paste master data twice: nobody twice")
    E("(cid) => FCCorp.saveProfile(cid, {directors: [{id: 'd1', name: 'Asha Verma (made-up)', din: '00000011', desig: 'Director'}]})", co); W(1300)
    for i in range(2):
        pg.click("#app [data-corp-paste]"); W(300)
        pg.fill("#app [data-corp-paste-box] textarea", "CIN\tU17299DL2019PTC000000\n00000011\tAsha Verma (made-up)\t10/06/2019\n00000033\tKiran Rao (made-up)\t15/07/2020"); W(300)
        pg.click("#app [data-corp-paste-keep]"); W(1500)
    ds = srvp(pg, co).get("directors", [])
    ok(sorted(d.get("din") for d in ds) == ["00000011", "00000033"], "Asha matched by DIN, Kiran added once (%s)" % [d.get("din") for d in ds])
    ok(next(d for d in ds if d["din"] == "00000011").get("appointed") == "2019-06-10" and next(d for d in ds if d["din"] == "00000011").get("id") == "d1", "the matched director keeps her row and takes the date")

    print("6. tables not there")
    E("(cid) => { __fake.missing.corp_filings = true; FCCorp.forget(cid); render(); }", co); W(1500)
    note = txt(pg, "#app [data-corp-cloud]")
    ok("E-Forms" in note or "e-Forms" in note, "corp_filings not there: e-Forms said (%s)" % note)
    E("(cid) => FCCorp.saveProfile(cid, {nic: '13990'})", co); W(1300)
    ok(srvp(pg, co)["profile"].get("nic") == "13990", "the profile still saved")
    E("(cid) => { __fake.missing.corp_profiles = true; FCCorp.forget(cid); render(); }", co); W(1500)
    note = txt(pg, "#app [data-corp-cloud]")
    ok("not set up on FinCom’s server yet" in note and not E("!!document.querySelector('#app [data-corp-edit]')"), "corp_profiles not there: said, nothing to change (%s)" % note)
    E("() => __fake.restore()")
    ctx.close(); br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
