"""python3 run_corp_eforms.py - Corporate › e-Forms, phase 1 stage 3 (07-Nov-2026; the design "2 · Client › Corporate ›
e-Forms"). Offline, a made-up company only. The due dates are checked against the rules (app/src/screens/corp/rules.js):
  AOC-4 30 days from the AGM (an OPC: 180 days from the year's end), MGT-7 / MGT-7A 60 days from the AGM (7A for a small
  company or an OPC), ADT-1 15 days from the AGM when the auditor's term ends there, DIR-3 KYC (three-yearly) by 30 June per director,
  DPT-3 30 June, MSME-1 31 October and 30 April; with no AGM date, from 30 September (s.96(1)).
  0. rules.js: every form names its section or rule, and the file says a Company Secretary can check it;
  1. FY 2025-26 (AGM 25-Sep-2026): each annual form and its due date; MGT-7A not needed for a company that is not small,
     ADT-1 not needed while the auditor's term runs; one DIR-3 KYC a director (the one ticked in the profile: Done);
  2. small company: MGT-7 not needed, MGT-7A due; no AGM date: the dates run from 30-Sep-2026, and the page says so; an OPC:
     AOC-4 by 27-Sep-2026, MGT-7A by 29-Nov-2026; the year before (‹): its own dates;
  3. a form's four steps: In progress (2 of 4), then Ready to file; Mark as filed needs a proper SRN and a date: Filed · SRN ·
     date, listed under Filed & SRNs, and the profile's "Last balance sheet filed"; Not needed needs a reason; Needed after
     all; DIR-3 KYC filed here ticks the director's KYC in the profile;
  4. something happened: Director appointed or resigned on 02-Nov-2026 -> DIR-12 tracked, due 02-Dec-2026, in Event-based
     and in the profile's Compliance health; removed again;
  5. All forms: every rule with its law; the e-Forms tab's count of forms due;
  6. kept after a reload; the firm's copy: a filing is an upsert on (firm_id, client_id, ref) with the fields of
     migration 144; a removal is a DELETE of that ref;
  7. a phone (390 wide): the page is no wider than the screen.
RED before stage 3: no e-Forms page. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_corp_eforms.py"""
import os, re, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from corp_fake_cloud import INSTALL
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = os.environ.get("TDSDESK_SHOTS", os.path.join(HERE, "out", "corp-shots")); os.makedirs(SHOTS, exist_ok=True)
PORT = int(os.environ.get("CORP_PORT") or 8723)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

print("0. the rules file")
RULES = open(os.path.join(HERE, "..", "app", "src", "screens", "corp", "rules.js")).read()
ok("Company Secretary can" in RULES and "check" in RULES, "rules.js says a Company Secretary can check it")
for form, law in (("AOC-4", "s.137"), ("MGT-7", "s.92(4)"), ("MGT-7A", "rule 11(1)"), ("ADT-1", "rule 4(2)"), ("DIR-3 KYC", "Rule 12A"), ("DPT-3", "Rule 16"), ("MSME-1", "s.405"),
                  ("DIR-12", "s.168"), ("INC-22", "s.12(4)"), ("PAS-3", "s.39(4)"), ("SH-7", "s.64(1)"), ("MGT-14", "s.117"), ("CHG-1", "s.77"), ("ADT-3", "rule 8"), ("INC-20A", "s.10A")):
    m = re.search(r'form: "%s",[^\n]*\n?[^\n]*\n?\s*law: "([^"]+)"' % re.escape(form), RULES) or re.search(r'form: "%s"[^}]*?law: "([^"]+)"' % re.escape(form), RULES, re.S)
    ok(m is not None and law in m.group(1), "%s cites %s (%s)" % (form, law, (m.group(1)[:80] if m else "none")))

OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
SETUP = """() => {
  const a = newCompany({name: "Kestrel Textiles Private Limited (made-up)", gstin: "07AABCK1234F1Z5"}); a.pan = "AABCK1234F";
  S.companies[a.id] = a; Store.saveCompany(a); S.coId = a.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false; render(); return a.id; }"""
PROFILE = {"cin": "U17299DL2019PTC000000", "cls": "private", "small": False, "incorporated": "2019-06-10", "office": "14 Sample Lane, New Delhi 110005",
           "agms": {"2025-26": "2026-09-25", "2024-25": "2025-09-27"}, "lastBoard": "2026-08-01", "auditor": "Made-up & Associates", "auditorTill": "2028-29",
           "directors": [{"name": "Asha Verma (made-up)", "din": "00000011", "desig": "Director", "kyc": ["2025-26"]}, {"name": "Ravi Menon (made-up)", "din": "00000022", "desig": "Director"}]}
def forms(pg):
    return pg.evaluate("[...document.querySelectorAll('#app [data-forms-table] tbody tr[data-form-ref]')].map(r => ({ref: r.dataset.formRef, form: r.dataset.form, status: r.dataset.status, due: r.dataset.due, text: r.innerText.replace(/\\s+/g, ' ').trim()}))")
def row(pg, ref): return next((r for r in forms(pg) if r["ref"] == ref), None)
def prof(pg, cid, patch):
    pg.evaluate("([cid, p]) => { FCCorp.saveProfile(cid, p); render(); }", [cid, patch]); pg.wait_for_timeout(500)

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200])); pg.on("dialog", lambda d: d.accept())
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    E("() => localStorage.removeItem('__corp_fake_rows')"); E(INSTALL)   # Corporate needs the firm account (a stand-in)
    co = E(SETUP); W(800)
    E("(id) => openCompany(id).then(() => goClient('books:corp-forms'))", co); W(1800)
    ok(E("!!document.querySelector('#app [data-corp-page=forms]')"), "the e-Forms page")
    prof(pg, co, PROFILE)
    E("() => { S.corpFy = '2025-26'; render(); }"); W(500)

    print("1. FY 2025-26, AGM 25-Sep-2026")
    rs = {r["ref"]: r for r in forms(pg)}
    def due_of(ref):
        r = rs.get(ref)
        if not r or not r["due"]: return None
        y, m, d = r["due"].split("-"); return d + "-" + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][int(m) - 1] + "-" + y
    ok(due_of("annual:AOC-4:2025-26") == "25-Oct-2026", "AOC-4: 30 days from the AGM, 25-Oct-2026 (%s)" % (rs.get("annual:AOC-4:2025-26") or {}).get("text"))
    ok(due_of("annual:MGT-7:2025-26") == "24-Nov-2026", "MGT-7: 60 days from the AGM, 24-Nov-2026")
    ok((rs.get("annual:MGT-7A:2025-26") or {}).get("status") == "not_needed" and "only small companies and OPCs" in rs["annual:MGT-7A:2025-26"]["text"], "MGT-7A: not needed, and why")
    ok((rs.get("annual:ADT-1:2025-26") or {}).get("status") == "not_needed" and "till the AGM of FY 2028-29" in rs["annual:ADT-1:2025-26"]["text"], "ADT-1: not needed while the auditor's term runs")
    ok((rs.get("annual:DIR-3 KYC:2025-26:00000011") or {}).get("status") == "filed" and "Done" in rs["annual:DIR-3 KYC:2025-26:00000011"]["text"], "DIR-3 KYC: the director ticked in the profile is Done")
    ok(due_of("annual:DIR-3 KYC:2025-26:00000022") == "30-Jun-2026" and "Ravi Menon" in rs["annual:DIR-3 KYC:2025-26:00000022"]["text"], "DIR-3 KYC of the other director (none recorded; three-yearly): 30-Jun-2026")
    ok(due_of("annual:DPT-3:2025-26") == "30-Jun-2026", "DPT-3: 30-Jun-2026")
    # a KYC done in an earlier year, not due again yet (three-yearly): Not needed, next due
    prof(pg, co, {"directors": [PROFILE["directors"][0], dict(PROFILE["directors"][1], kyc=["2024-25"])]})
    k2 = row(pg, "annual:DIR-3 KYC:2025-26:00000022") or {}
    ok(k2.get("status") == "not_needed" and "Not needed, next due 30-Jun-2028" in k2.get("text", ""), "DIR-3 KYC done in FY 2024-25: Not needed, next due 30-Jun-2028 (%s)" % k2.get("text"))
    prof(pg, co, {"directors": PROFILE["directors"]})
    ok(due_of("annual:MSME-1:2025-26:H1") == "31-Oct-2025" and due_of("annual:MSME-1:2025-26:H2") == "30-Apr-2026", "MSME-1: 31-Oct-2025 (Apr–Sep) and 30-Apr-2026 (Oct–Mar)")
    prof(pg, co, {"auditorTill": "2025-26"})
    adt = row(pg, "annual:ADT-1:2025-26") or {"text": "", "status": ""}
    ok(adt["status"] == "not_started" and "10-Oct-2026" in adt["text"], "ADT-1 when the term ends at this AGM: 15 days, 10-Oct-2026 (%s)" % adt["text"])

    print("2. small company, no AGM date, an OPC, the year before")
    prof(pg, co, {"small": True})
    ok(row(pg, "annual:MGT-7:2025-26")["status"] == "not_needed" and row(pg, "annual:MGT-7A:2025-26")["status"] == "not_started" and "24-Nov-2026" in row(pg, "annual:MGT-7A:2025-26")["text"], "small: MGT-7 not needed, MGT-7A due 24-Nov-2026")
    prof(pg, co, {"agms": {"2024-25": "2025-09-27"}})
    ok("30-Oct-2026" in row(pg, "annual:AOC-4:2025-26")["text"] and "the last day for the AGM" in (E("document.querySelector('#app [data-forms-agm]').innerText") or ""), "no AGM date: from 30-Sep-2026 (AOC-4 30-Oct-2026), and the page says why")
    prof(pg, co, {"cls": "opc"})
    ok("27-Sep-2026" in row(pg, "annual:AOC-4:2025-26")["text"] and "29-Nov-2026" in row(pg, "annual:MGT-7A:2025-26")["text"], "an OPC: AOC-4 27-Sep-2026, MGT-7A 29-Nov-2026 (%s | %s)" % (row(pg, "annual:AOC-4:2025-26")["text"], row(pg, "annual:MGT-7A:2025-26")["text"]))
    prof(pg, co, {"cls": "private", "small": False, "agms": PROFILE["agms"], "auditorTill": "2028-29"})
    pg.click("#app button[aria-label='Year before']"); W(500)
    ok(E("document.querySelector('#app [data-forms-fy]').innerText") == "FY 2024-25" and "27-Oct-2025" in row(pg, "annual:AOC-4:2024-25")["text"] and "30-Jun-2025" in row(pg, "annual:DPT-3:2024-25")["text"], "the year before: its own dates")
    pg.click("#app button[aria-label='Year after']"); W(500)
    # this year so far: the year after goes on to the current one, its half-year over (MSME-1 H1) shown
    cur = E("(() => { const d = istToday(), y = +d.slice(0,4), m = +d.slice(4,6), a = m < 4 ? y - 1 : y; return a + '-' + String(a + 1).slice(2); })()")
    if cur != "2025-26":
        pg.click("#app button[aria-label='Year after']"); W(500)
        ok(E("document.querySelector('#app [data-forms-fy]').innerText") == "FY " + cur and E("!!document.querySelector('#app [data-forms-current]')") and row(pg, "annual:MSME-1:%s:H1" % cur) is not None, "this year so far: FY %s, its MSME-1 H1" % cur)
        ok(E("document.querySelector(\"#app button[aria-label='Year after']\").disabled"), "no year after this one")
    # a new company (incorporated 01-Feb-2026, made-up): its first year ends 31-Mar-2027 (s.2(41)); it opens on it
    E("() => { S.corpFy = ''; }"); prof(pg, co, {"incorporated": "2026-02-01"}); W(300)
    ok(E("document.querySelector('#app [data-forms-fy]').innerText") == "FY 2026-27" and E("document.querySelector(\"#app button[aria-label='Year before']\").disabled"), "a new company: opens on its first FY 2026-27, no year before")
    E("() => { S.corpFy = '2025-26'; render(); }"); W(400)
    ok("Before the first financial year ends (31-Mar-2027): only event forms, e.g. INC-20A." in (E("(document.querySelector('#app [data-forms-before]') || {}).innerText") or "") and not errors, "a year before it: only event forms, no page error")
    prof(pg, co, {"incorporated": PROFILE.get("incorporated", "2019-06-10")}); E("() => { S.corpFy = '2025-26'; render(); }"); W(400)
    # a blank auditor's term: asked, never late
    prof(pg, co, {"auditorTill": ""})
    adt0 = row(pg, "annual:ADT-1:2025-26") or {}
    ok("Enter the auditor's term" in adt0.get("text", "") and "late" not in adt0.get("text", "") and not adt0.get("due"), "ADT-1, no term entered: asked, not late (%s)" % adt0.get("text"))
    prof(pg, co, {"auditorTill": "2028-29"})

    print("3. steps, filed, not needed")
    pg.click("#app [data-form-open='annual:MGT-7:2025-26']"); W(400)
    pg.check("#app [data-form-detail] input[data-form-step='0']"); W(300); pg.check("#app [data-form-detail] input[data-form-step='1']"); W(300)
    ok("In progress (2 of 4)" in row(pg, "annual:MGT-7:2025-26")["text"], "two steps: In progress (2 of 4)")
    pg.check("#app [data-form-detail] input[data-form-step='3']"); W(300)
    ok("Ready to file" in row(pg, "annual:MGT-7:2025-26")["text"] and row(pg, "annual:MGT-7:2025-26")["status"] == "ready", "the fourth: Ready to file")
    pg.click("#app [data-form-open='annual:AOC-4:2025-26']"); W(400)
    pg.fill("#app [data-form-detail] input[data-form-srn]", "AB1234567"); W(200)
    ok(E("document.querySelector('#app [data-form-detail] [data-form-filed]').disabled") and E("!!document.querySelector('#app [data-form-filed-wait]')"), "AOC-4 not Ready in its builder: Mark as filed waits (its figures are kept at Ready)")
    # the builder's Ready for MCA, as it keeps it (its figures saved)
    E("(cid) => { FCCorp.saveFiling(cid, {ref: 'annual:AOC-4:2025-26', form: 'AOC-4', kind: 'annual', period: '2025-26', status: 'ready', steps: 4, data: {figures: {sc: 100000}, pyFigures: {sc: 100000}}}); render(); }", co); W(800)
    pg.click("#app [data-form-open='annual:AOC-4:2025-26']"); W(300)
    if not E("!!document.querySelector('#app [data-form-detail]')"): pg.click("#app [data-form-open='annual:AOC-4:2025-26']"); W(300)
    pg.fill("#app [data-form-detail] input[data-form-srn]", "12-34"); W(200)
    ok(E("document.querySelector('#app [data-form-detail] [data-form-filed]').disabled"), "a wrong SRN: Mark as filed stays off")
    pg.fill("#app [data-form-detail] input[data-form-srn]", "ab1234567"); pg.fill("#app [data-form-detail] input[data-form-filed-on]", "2026-11-05"); W(200)
    pg.click("#app [data-form-detail] [data-form-filed]"); W(500)
    ok("Filed · SRN AB1234567 · 05-Nov-2026" in row(pg, "annual:AOC-4:2025-26")["text"], "AOC-4: Filed · SRN AB1234567 · 05-Nov-2026 (%s)" % row(pg, "annual:AOC-4:2025-26")["text"])
    pg.click("#app [data-forms-tab=filed]"); W(400)
    ok("AB1234567" in (E("(document.querySelector('#app [data-forms-table=filed]') || {}).innerText") or ""), "listed under Filed & SRNs")
    pg.click("#app [data-forms-tab=annual]"); W(300)
    pg.click("#app [data-form-open='annual:DPT-3:2025-26']"); W(400)
    ok(E("document.querySelector('#app [data-form-detail] [data-form-not-needed]').disabled"), "Not needed needs a reason")
    pg.fill("#app [data-form-detail] input[data-form-why]", "no deposits or loans outstanding on 31 March"); W(150)
    pg.click("#app [data-form-detail] [data-form-not-needed]"); W(400)
    ok(row(pg, "annual:DPT-3:2025-26")["status"] == "not_needed" and "no deposits or loans" in row(pg, "annual:DPT-3:2025-26")["text"], "DPT-3: Not needed, with the reason")
    pg.click("#app [data-form-open='annual:DPT-3:2025-26']"); W(300); pg.click("#app [data-form-detail] [data-form-needed]"); W(400)
    ok(row(pg, "annual:DPT-3:2025-26")["status"] == "not_started", "Needed after all: Not started again")
    pg.click("#app [data-form-open='annual:DIR-3 KYC:2025-26:00000022']"); W(300)
    pg.fill("#app [data-form-detail] input[data-form-srn]", "AB7654321"); pg.fill("#app [data-form-detail] input[data-form-filed-on]", "2026-09-20"); pg.click("#app [data-form-detail] [data-form-filed]"); W(500)
    ok(E("(cid) => (FCCorp.corpOf(cid).profile.directors[1].kyc || []).includes('2025-26')", co), "DIR-3 KYC filed here: the director's KYC is ticked in the profile")
    pg.click("#app [data-corp-tab=profile]"); W(800)
    ok(E("document.querySelector('#app [data-kpi=filed]').innerText") == "FY 2025-26", "the profile: Last balance sheet filed FY 2025-26")
    pg.click("#app [data-corp-tab=forms]"); W(800)

    print("4. an event")
    pg.click("#app [data-event='DIR-12']"); W(300)
    pg.fill("#app [data-event-start] input[data-event-date]", "2026-11-02"); pg.fill("#app [data-event-start] input[data-event-note]", "a made-up director appointed"); pg.click("#app [data-event-start] [data-event-go]"); W(500)
    ev = [r for r in forms(pg) if r["form"] == "DIR-12"]
    ok(E("document.querySelector('#app [data-forms-tab=event]').getAttribute('aria-selected')") == "true" and len(ev) == 1 and "02-Dec-2026" in ev[0]["text"] and "event of 02-Nov-2026" in ev[0]["text"], "DIR-12 tracked: due 02-Dec-2026 (%s)" % ev)
    pg.click("#app [data-corp-tab=profile]"); W(800)
    ok(E("!![...document.querySelectorAll('#app [data-health]')].find(e => e.dataset.health.startsWith('form:event:DIR-12'))"), "and in the profile's Compliance health")
    pg.click("#app [data-corp-tab=forms]"); W(800); pg.click("#app [data-forms-tab=event]"); W(300)
    pg.click("#app [data-form-open^='event:DIR-12']"); W(300); pg.click("#app [data-form-detail] [data-form-drop]"); W(400)
    ok(not [r for r in forms(pg) if r["form"] == "DIR-12"], "removed again")

    print("5. All forms; the tab's count")
    pg.click("#app [data-forms-prepare]"); W(400)
    rules = E("[...document.querySelectorAll('#app [data-forms-table=rules] tr[data-rule]')].map(r => r.dataset.rule)")
    ok(len(rules) == 7 + 9 and "INC-20A" in rules and "s.137(1)" in E("document.querySelector('#app [data-forms-table=rules]').innerText"), "every rule with its law (%d)" % len(rules))
    tabtxt = E("document.querySelector('#app [data-corp-tab=forms]').innerText")
    ok(re.search(r"e-Forms\s+\d+", tabtxt) is not None, "the e-Forms tab shows the count of forms due (%s)" % tabtxt)
    pg.screenshot(path=os.path.join(SHOTS, "eforms-1440.png"), full_page=True)

    print("6. kept in the firm's copy")
    W(1200)
    pend = E("(cid) => Object.keys(FCCorp.corpOf(cid).pending)", co)
    ok(not pend and "Saved to the firm account" in E("document.querySelector('#app [data-corp-cloud]').innerText"), "everything saved (%s)" % pend)
    E("() => __fake.restore()")
    pg.reload(); W(3500); E(OPEN); W(800); E(INSTALL); W(1500)
    pg.wait_for_selector("#app [data-corp-page=forms]", timeout=15000)
    pg.click("#app [data-forms-tab=annual]"); W(300)   # the tab is kept in the address (All forms, from section 5)
    E("() => { S.corpFy = '2025-26'; render(); }"); W(800)
    ok("AB1234567" in (row(pg, "annual:AOC-4:2025-26") or {}).get("text", "") and (row(pg, "annual:MGT-7:2025-26") or {}).get("status") == "ready", "after a reload: filed and ready, from the firm's copy (%s / %s)" % ((row(pg, "annual:AOC-4:2025-26") or {}).get("text", "")[:80], row(pg, "annual:MGT-7:2025-26")))
    aoc = E("(cid) => __fake.rows.corp_filings.find(r => r.client_id === cid && r.ref === 'annual:AOC-4:2025-26')", co)
    ok(aoc and aoc["status"] == "filed" and aoc["srn"] == "AB1234567" and aoc["filed_on"] == "2026-11-05" and aoc["due_on"] == "2026-10-25"
       and set(aoc) == {"id", "client_id", "ref", "form", "kind", "period", "director", "status", "steps", "due_on", "event_on", "srn", "filed_on", "reason", "data", "updated_at"},
       "the row has 144's columns (%s)" % json.dumps(aoc)[:300])
    E("(cid) => { __fake.log = []; FCCorp.dropFiling(cid, 'annual:MGT-7:2025-26'); }", co); W(1200)
    dl = next((c for c in E("() => __fake.log") if c["method"] == "DELETE"), None)
    ok(dl and dl["path"].startswith("corp_filings?client_id=eq.%s&ref=eq.annual%%3AMGT-7%%3A2025-26&updated_at=eq." % co) and not E("(cid) => __fake.rows.corp_filings.some(r => r.ref === 'annual:MGT-7:2025-26')", co),
       "a removal: a conditional DELETE of its ref (%s)" % (dl and dl["path"]))
    E("() => __fake.restore()")
    ctx.close()

    print("7. a phone")
    ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    E(INSTALL); co = E(SETUP); W(800); E("(id) => openCompany(id).then(() => goClient('books:corp-forms'))", co); W(1800)
    wide = E("document.documentElement.scrollWidth")
    ok(E("!!document.querySelector('#app [data-corp-page=forms]')") and wide <= 392, "e-Forms on a phone, no wider than the screen (%s)" % wide)
    ctx.close(); br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
