"""python3 run_corp_docs.py - Corporate › Resolutions & minutes, phase 1 stage 4 (07-Nov-2026; the designs "ROC documents":
the list, the board resolution with With letterhead / Plain paper, the minutes in SS-1's layout). Offline, a made-up company:
  0. the templates are data files (app/src/screens/corp/templates): ten and the minutes, each with {{fields}}, a fields
     schema and the header comment "Wording to be checked by a Company Secretary before use";
  1. the list: the templates (search, groups), the company's strip (CIN, class, directors), the letterhead card;
  2. Opening of bank account: the live A4 preview on the letterhead (the company's name, CIN, the address and phone at
     the foot); what is not filled in yet is marked and counted; filled: "RESOLVED THAT pursuant to ... section 179", the
     signatories with their DINs, certified by a director; Plain paper drops the letterhead; the quorum check (s.174);
  3. Word: a real .docx (the resolution's words in the document, the letterhead in its header); PDF: the print view, the
     same A4 pages; an uploaded logo goes on the letterhead;
  4. kept per client: the list shows it as Draft; Mark as final (its fields locked, no Delete), Back to draft;
  5. every template makes a document with no page error;
  6. Minutes: attendance and the quorum (one on leave: no quorum with two directors; both: met); business added from the
     templates; the minutes book's header and the Chairman's initials box on EVERY page, "Continued on page 2"; Word with
     the page number in the header; "Add to minutes" from a resolution puts it in that meeting's minutes; the notice of a
     board meeting (s.173(3)) from Plan a board meeting;
  7. kept after a reload, from the firm's copy (a stand-in: tests/corp_fake_cloud.py): a row on id with migration 145's
     columns; a removal: a conditional DELETE of its id;
  8. a phone (390 wide): no wider than the screen.
RED before stage 4. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_corp_docs.py"""
import os, re, io, sys, glob, json, base64, zipfile, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from corp_fake_cloud import INSTALL
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = os.environ.get("TDSDESK_SHOTS", os.path.join(HERE, "out", "corp-shots")); os.makedirs(SHOTS, exist_ok=True)
PORT = int(os.environ.get("CORP_PORT") or 8724)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

print("0. the templates")
TDIR = os.path.join(HERE, "..", "app", "src", "screens", "corp", "templates")
files = sorted(f for f in glob.glob(os.path.join(TDIR, "*.js")) if not f.endswith("index.js"))
ok(len(files) == 11, "ten templates and the minutes (%d files)" % len(files))
for f in files:
    t = open(f).read(); head = t[:t.index("*/")] if "*/" in t else ""
    ok("Wording to be checked by a Company Secretary before use" in head and "fields:" in t and ("{{" in t), "%s: the CS note in its header, fields and {{fields}}" % os.path.basename(f))

OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
SETUP = """() => {
  const a = newCompany({name: "Kestrel Textiles Private Limited (made-up)", gstin: "07AABCK1234F1Z5"}); a.pan = "AABCK1234F";
  S.companies[a.id] = a; Store.saveCompany(a); S.coId = a.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false; render(); return a.id; }"""
PROFILE = {"cin": "U17299DL2019PTC000000", "cls": "private", "office": "14 Sample Lane, New Delhi 110005", "phone": "+91 11 0000 0000", "email": "secretarial@example.com",
           "lastBoard": "2026-08-01", "directors": [{"name": "Asha Verma (made-up)", "din": "00000011", "desig": "Director"}, {"name": "Ravi Menon (made-up)", "din": "00000022", "desig": "Director"}]}
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGNgaGBgwIUYh6YEAMNBBEFq1hqQAAAAAElFTkSuQmCC")
def preview(pg): return pg.evaluate("(document.querySelector('#app [data-corp-preview]') || {}).innerText || ''")
def pages(pg): return pg.evaluate("document.querySelectorAll('#app [data-corp-preview] .corp-a4[data-page]').length")
def setf(pg, k, v):
    sel = "#app [data-corp-editor] [data-field='%s']" % k
    tag = pg.evaluate("(s) => { const e = document.querySelector(s); return e ? e.tagName : ''; }", sel)
    if tag == "SELECT": pg.select_option(sel, v)
    else:
        pg.fill(sel, v)
        if pg.evaluate("(s) => document.querySelector(s).type", sel) != "date": pg.press(sel, "Tab")
    pg.wait_for_timeout(350)
def docx_text(path):
    z = zipfile.ZipFile(path); names = z.namelist()
    doc = z.read("word/document.xml").decode("utf-8")
    heads = "".join(z.read(n).decode("utf-8") for n in names if re.match(r"word/header\d*\.xml", n))
    feet = "".join(z.read(n).decode("utf-8") for n in names if re.match(r"word/footer\d*\.xml", n))
    strip = lambda x: re.sub(r"<[^>]+>", "", x)
    return strip(doc), strip(heads), strip(feet), heads, names

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200])); pg.on("dialog", lambda d: d.accept())
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    E("() => localStorage.removeItem('__corp_fake_rows')"); E(INSTALL)   # Corporate needs the firm account (a stand-in)
    E("() => { Cloud.st.role = 'owner'; }")   # the firm's owner (Back to draft is the owner's)
    co = E(SETUP); W(800)
    E("(id) => openCompany(id).then(() => goClient('books:corp-docs'))", co); W(1800)
    E("([cid, p]) => { FCCorp.saveProfile(cid, p); render(); }", [co, PROFILE]); W(600)

    print("1. the list")
    tiles = E("[...document.querySelectorAll('#app [data-templates] [data-template]')].map(e => e.dataset.template)")
    ok(len(tiles) == 11 and "bank-open" in tiles and "minutes" in tiles and "board-notice" in tiles, "the templates (%s)" % tiles)
    pg.fill("#app [data-doc-search]", "auditor"); W(300)
    ok(sorted(E("[...document.querySelectorAll('#app [data-templates] [data-template]')].map(e => e.dataset.template)")) == ["casual-vacancy", "first-auditor"], "search: auditor -> the two auditor templates")
    pg.fill("#app [data-doc-search]", ""); W(200)
    pg.click("#app button[aria-pressed]:has-text('Banking')"); W(300)
    ok(sorted(E("[...document.querySelectorAll('#app [data-templates] [data-template]')].map(e => e.dataset.template)")) == ["bank-open", "bank-signatories", "borrowing"], "the Banking group")
    pg.click("#app button[aria-pressed]:has-text('All')"); W(300)
    app = E("document.querySelector('#app').innerText")
    ok("U17299DL2019PTC000000" in app and "Private, limited by shares" in app and "2 · KMP: none" in app and E("!!document.querySelector('#app [data-letterhead-card]')"), "the company's strip and the letterhead card")

    print("2. Opening of bank account")
    pg.click("#app [data-template='bank-open']"); W(1200)
    ok(E("document.querySelector('#app [data-corp-editor]').dataset.template") == "bank-open", "the editor opens")
    ok(E("!!document.querySelector('#app [data-corp-preview] [data-letterhead]')") and "KESTREL TEXTILES PRIVATE LIMITED" in preview(pg) and "CIN U17299DL2019PTC000000" in preview(pg)
       and "Regd. Office: 14 Sample Lane" in preview(pg) and "+91 11 0000 0000" in preview(pg), "on the letterhead: name, CIN, office and phone")
    miss0 = int(E("(document.querySelector('#app [data-doc-missing]') || {dataset: {docMissing: 0}}).dataset.docMissing"))
    ok(miss0 >= 4 and "[Bank]" in preview(pg) and "[Date of the meeting]" in preview(pg), "what is not filled in is marked and counted (%d: %s)" % (miss0, re.findall(r"\[[^\]]{2,40}\]", preview(pg))))
    setf(pg, "meetingDate", "2026-10-12"); setf(pg, "bank", "Made-up Bank Limited"); setf(pg, "branch", "Karol Bagh"); setf(pg, "place", "New Delhi")
    pg.select_option("#app [data-corp-editor] [data-field='signer']", index=1); W(400)
    t = preview(pg)
    ok(not E("!!document.querySelector('#app [data-doc-missing]')") and "[" not in t.replace("[Bank]", "X"), "all filled: nothing marked (%s)" % E("(document.querySelector('#app [data-doc-missing]') || {}).innerText"))
    ok("CERTIFIED TRUE COPY OF THE RESOLUTION PASSED BY THE BOARD OF DIRECTORS OF KESTREL TEXTILES PRIVATE LIMITED (MADE-UP) AT ITS MEETING HELD ON 12TH OCTOBER, 2026 AT 11:00 A.M." in t
       and "RESOLVED THAT pursuant to the provisions of section 179 of the Companies Act, 2013" in t and "Made-up Bank Limited, Karol Bagh branch" in t, "the resolution's words")
    ok("Asha Verma (made-up)" in t and "DIN 00000011" in t and "DIN 00000022" in t and "Certified to be true" in t and "Place: New Delhi" in t, "the signatories with their DINs, certified by a director")
    ok("Quorum: 2 of 2 directors, 2 needed" in E("document.querySelector('#app [data-doc-checks]').innerText") and "Company Secretary before use" in E("document.querySelector('#app [data-doc-checks]').innerText"), "the checks: quorum (s.174), the CS note")
    pg.click("#app [data-paper=plain]"); W(600)
    ok(not E("!!document.querySelector('#app [data-corp-preview] [data-letterhead]')") and "RESOLVED THAT" in preview(pg), "Plain paper: no letterhead")
    pg.click("#app [data-paper=letterhead]"); W(600)
    pg.screenshot(path=os.path.join(SHOTS, "resolution-1440.png"), full_page=True)

    print("3. Word, PDF, the logo")
    with pg.expect_download(timeout=30000) as dl:
        pg.click("#app [data-doc-word]")
    path = os.path.join(SHOTS, "resolution.docx"); dl.value.save_as(path)
    body, head, foot, headx, names = docx_text(path)
    ok(dl.value.suggested_filename.endswith(".docx") and "RESOLVED THAT" in body and "Made-up Bank Limited" in body and "DIN 00000022" in body, "Word: the resolution's words (%s)" % dl.value.suggested_filename)
    ok("KESTREL TEXTILES PRIVATE LIMITED" in head and "U17299DL2019PTC000000" in head and "14 Sample Lane" in foot, "Word: the letterhead in the header and footer")
    with ctx.expect_page(timeout=15000) as pop:
        pg.click("#app [data-doc-pdf]")
    pw = pop.value; pw.wait_for_load_state(); W(500)
    ok(pw.evaluate("document.querySelectorAll('.corp-a4').length") == pages(pg) and "RESOLVED THAT" in pw.evaluate("document.body.innerText") and pw.evaluate("!!document.querySelector('[data-letterhead]')"),
       "PDF: the print view, the same %d A4 page(s), on the letterhead" % pages(pg))
    ok("size:A4" in pw.evaluate("[...document.querySelectorAll('style')].map(s => s.textContent).join('')").replace(" ", ""), "the print view is A4")
    pw.close()
    pg.click("#app [data-doc-back]"); W(800)
    pg.set_input_files("#app [data-logo-input]", files=[{"name": "logo.png", "mimeType": "image/png", "buffer": PNG}]); W(800)
    ok(E("!!document.querySelector('#app [data-logo-shown]')"), "the logo is kept")

    print("4. kept per client; final")
    rows = E("[...document.querySelectorAll('#app [data-docs-list] [data-doc-row]')].map(r => r.innerText.replace(/\\s+/g, ' '))")
    ok(len(rows) == 1 and "Opening of bank account" in rows[0] and "12-Oct-2026" in rows[0] and "Draft" in rows[0], "the list: the document, its meeting, Draft (%s)" % rows)
    pg.click("#app [data-doc-open]"); W(1000)
    ok(E("!!document.querySelector('#app [data-corp-preview] .lh-logo.img img')"), "the uploaded logo on the letterhead")
    ok(E("(cid) => FCCorp.corpOf(cid).profile.directors.every(d => d.id && !/^n\\d+$/.test(d.id))", co), "every director row given a stable id")
    pg.click("#app [data-doc-final]"); W(800)
    ok(E("document.querySelector('#app [data-doc-status]').dataset.docStatus") == "final", "Mark as final")
    ctl = E("[...document.querySelectorAll('#app [data-corp-editor] .corp-doc-form input, #app [data-corp-editor] .corp-doc-form select, #app [data-corp-editor] .corp-doc-form textarea')].map(e => [e.tagName + ':' + (e.type || '') + ':' + (e.dataset.field || e.getAttribute('aria-label') || ''), e.disabled])")
    kinds = sorted(set(c[0].split(":")[0] + ":" + c[0].split(":")[1] for c in ctl))
    ok(ctl and all(c[1] for c in ctl) and "SELECT:select-one" in kinds and "INPUT:date" in kinds and "INPUT:text" in kinds and "INPUT:checkbox" in kinds, "final: every field locked, of every kind (%s; open: %s)" % (kinds, [c[0] for c in ctl if not c[1]]))
    ok(E("[...document.querySelectorAll('#app [data-paper]')].every(e => e.disabled)") and not E("!!document.querySelector('#app [data-doc-delete]')"), "final: the paper switch locked, no Delete")
    fin = E("(cid) => FCCorp.corpOf(cid).docs.find(d => d.template === 'bank-open')", co)
    ok(fin["fields"].get("snapshot", {}).get("name") == "Kestrel Textiles Private Limited (made-up)" and len(fin["fields"]["snapshot"].get("directors", [])) == 2, "final: the company's details kept with it (%s)" % fin["fields"].get("snapshot", {}).get("name"))
    E("([cid, id]) => { FCCorp.saveDoc(cid, {id, title: 'changed', fields: {}}); FCCorp.saveProfile(cid, {name: 'Renamed Later (made-up)'}); }", [co, fin["id"]]); W(1200)
    fin2 = E("(cid) => FCCorp.corpOf(cid).docs.find(d => d.template === 'bank-open')", co)
    ok(fin2["title"] == fin["title"] and fin2["fields"] == fin["fields"] and "KESTREL TEXTILES PRIVATE LIMITED" in preview(pg) and "RENAMED LATER" not in preview(pg).upper(), "final: no change taken; drawn from its snapshot after the profile changed")
    E("(cid) => { FCCorp.saveProfile(cid, {name: 'Kestrel Textiles Private Limited (made-up)'}); }", co)
    E("() => { Cloud.st.role = 'staff'; render(); }"); W(400)
    ok(not E("!!document.querySelector('#app [data-doc-draft]')") and E("!!document.querySelector('#app [data-doc-final-note]')"), "staff: no Back to draft (the owner's)")
    E("() => { Cloud.st.role = 'owner'; render(); }"); W(400)
    pg.click("#app [data-doc-draft]"); W(800)
    ok(E("document.querySelector('#app [data-doc-status]').dataset.docStatus") == "draft", "the owner: Back to draft")

    print("5. every template")
    for k in ["bank-signatories", "additional-director", "director-resignation", "accounts-approval", "first-auditor", "casual-vacancy", "office-shift", "borrowing", "board-notice"]:
        pg.click("#app [data-doc-back]"); W(600)
        n0 = len(errors)
        pg.click("#app [data-template='%s']" % k); W(1000)
        t = preview(pg)
        ok(E("document.querySelector('#app [data-corp-editor]').dataset.template") == k and len(t) > 300 and len(errors) == n0 and pages(pg) >= 1, "%s: a document (%d characters, %d page(s))" % (k, len(t), pages(pg)))
    ok("NOTICE is hereby given" in preview(pg) and "To confirm the minutes of the previous meeting" in preview(pg), "the notice of a board meeting with its agenda")

    print("6. Minutes")
    pg.click("#app [data-doc-back]"); W(600); pg.click("#app [data-new-minutes]"); W(1200)
    setf(pg, "serial", "3/2026-27"); setf(pg, "meetingDate", "2026-10-12"); setf(pg, "place", "New Delhi")
    rid2 = E("(cid) => FCCorp.corpOf(cid).profile.directors.find(d => d.din === '00000022').id", co)
    pg.select_option("#app [data-attend='%s'] select" % rid2, "Leave of absence"); W(400)
    ok("No quorum" in E("document.querySelector('#app [data-quorum-chip]').innerText") and "Ravi Menon (made-up)" in preview(pg) and "stood adjourned under section 174(4)" in preview(pg), "one on leave: no quorum with two directors; his leave in the attendance; the meeting adjourned (s.174(4))")
    ok(E("document.querySelector('#app [data-doc-final]').disabled") and "Quorum not present" in E("(document.querySelector('#app [data-doc-final-block]') || {}).innerText || ''") and "quorum required under section 174" in preview(pg) and "requisite quorum being present" not in preview(pg),
       "no quorum: minuted as not present, and it cannot be marked Final")
    pg.select_option("#app [data-attend='%s'] select" % rid2, "In person"); W(400)
    ok("Quorum met · 2 of 2" in E("document.querySelector('#app [data-quorum-chip]').innerText"), "both present: quorum met")
    for k in ["bank-open", "additional-director", "accounts-approval", "borrowing", "first-auditor"]:
        pg.click("#app [data-add-business-open]"); W(300); pg.click("#app [data-add-business] [data-add-template='%s']" % k); W(500)
    t = preview(pg); n = pages(pg)
    ok("MINUTES OF THE 3RD MEETING (2026-27) OF THE BOARD OF DIRECTORS OF KESTREL TEXTILES PRIVATE LIMITED (MADE-UP) HELD ON MONDAY, 12TH OCTOBER, 2026" in t and "Asha Verma (made-up), Director, in the Chair (in person)" in t,
       "the minutes' heading and attendance")
    ok("5. Opening of bank account" in t and "9. Appointment of first auditor" in t and "10. Vote of thanks" in t, "the business from the templates, numbered after the standard items")
    heads = E("document.querySelectorAll('#app [data-corp-preview] [data-minutes-head]').length"); inits = E("document.querySelectorAll('#app [data-corp-preview] [data-initials]').length")
    ok(n >= 2 and heads == n and inits == n and "Continued on page 2" in t and re.search(r"page no\. 2", t, re.I), "on every one of the %d pages: the minutes book's header and the Chairman's initials box (%d, %d; %s)" % (n, heads, inits, re.findall(r"(?:Continued on page|Page No\.|page No\.) ?\d+", t)))
    with pg.expect_download(timeout=30000) as dl:
        pg.click("#app [data-doc-word]")
    path = os.path.join(SHOTS, "minutes.docx"); dl.value.save_as(path)
    body, head, foot, headx, names = docx_text(path)
    ok("MINUTES OF THE 3RD MEETING" in body and "Opening of bank account" in body and "MINUTES BOOK OF BOARD MEETINGS" in head and "PAGE" in headx and "Chairman’s initials" in foot, "Word: the minutes, the page number in the header, the initials box in the footer")
    pg.screenshot(path=os.path.join(SHOTS, "minutes-1440.png"), full_page=True)
    pg.click("#app [data-doc-back]"); W(600)
    rid = E("(cid) => FCCorp.corpOf(cid).docs.find(d => d.template === 'bank-open').id", co)
    pg.click("#app [data-doc-open='%s']" % rid); W(1000)
    setf(pg, "meetingDate", "2026-12-14"); pg.click("#app [data-doc-add-minutes]"); W(1200)
    ok(E("document.querySelector('#app [data-corp-editor]').dataset.template") == "minutes" and "14TH DECEMBER, 2026" in preview(pg) and "5. Opening of bank account" in preview(pg), "Add to minutes: that meeting's minutes, with the resolution")
    pg.click("#app [data-doc-back]"); W(600); pg.click("#app [data-plan-meeting]"); W(1000)
    ok(E("document.querySelector('#app [data-corp-editor]').dataset.template") == "board-notice", "Plan a board meeting: the notice")

    print("7. kept; the firm's copy")
    W(1500)
    pend = E("(cid) => Object.keys(FCCorp.corpOf(cid).pending)", co)
    ok(not pend, "everything saved (%s)" % pend)
    E("() => __fake.restore()")
    pg.reload(); W(3500); E(OPEN); W(800); E(INSTALL); W(1800)
    n_docs = E("document.querySelectorAll('#app [data-docs-list] [data-doc-row]').length")
    ok(n_docs >= 12, "after a reload, from the firm's copy: the documents (%d)" % n_docs)
    up = E("(cid) => __fake.rows.corp_documents.find(r => r.client_id === cid && r.template === 'bank-open')", co)
    ok(up and set(up) == {"id", "client_id", "template", "title", "kind", "status", "fields", "meeting_on", "letterhead", "updated_at"} and up["meeting_on"] == "2026-12-14" and up["status"] == "draft",
       "a document: a row on its id with 145's columns (%s)" % (up and [sorted(up), up.get("meeting_on"), up.get("status")]))
    nid = E("(cid) => { const id = FCCorp.corpOf(cid).docs.find(d => d.template === 'board-notice').id; __fake.log = []; FCCorp.dropDoc(cid, id); return id; }", co); W(1200)
    dl = next((c for c in E("() => __fake.log") if c["method"] == "DELETE"), None)
    ok(dl and re.match(r"corp_documents\?id=eq\.[0-9a-f-]{36}&updated_at=eq\.", dl["path"]) and not E("(id) => __fake.rows.corp_documents.some(r => r.id === id)", nid),
       "a removal: a conditional DELETE of its id (%s)" % (dl and dl["path"]))
    E("() => __fake.restore()")
    ctx.close()

    print("8. a phone")
    ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    E(INSTALL); E("() => { Cloud.st.role = 'owner'; }"); co = E(SETUP); W(800); E("(id) => openCompany(id).then(() => goClient('books:corp-docs'))", co); W(1800)
    E("([cid, p]) => { FCCorp.saveProfile(cid, p); render(); }", [co, PROFILE]); W(500)
    pg.click("#app [data-template='bank-open']"); W(1200)
    wide = E("document.documentElement.scrollWidth")
    ok(E("!!document.querySelector('#app [data-corp-preview] .corp-a4')") and wide <= 392, "the editor and its preview on a phone, no wider than the screen (%s)" % wide)
    pg.screenshot(path=os.path.join(SHOTS, "resolution-390.png"), full_page=True)
    ctx.close(); br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
