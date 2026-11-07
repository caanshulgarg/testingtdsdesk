"""python3 run_corp_profile.py - Corporate › Company profile, phase 1 stage 2 (07-Nov-2026; the design "1 · Client ›
Corporate: know the company"). Offline, made-up companies only (no real client):
  1. what FinCom holds is there at once: the client's name, PAN, TAN and GSTIN in the record, marked "from FinCom";
  2. Edit details: a CIN fills the class (Private company) and the ROC (from its state code) by itself; the date of
     incorporation, registered office, capital, auditor and term, email, last board meeting, the AGM for a year and small
     company are kept; the header shows them (Authorised / Paid-up capital, Last AGM);
  3. Directors & KMP: two directors added with their DINs and appointment dates; DIR-3 KYC ticked for one: "Done", the other
     "Due by 30-Sep"; a KMP (Company Secretary) shows no KYC; shareholders 6,000 / 4,000: 60% / 40%, and a warning when the
     shares do not make the paid-up capital; a charge: the header's Open charges;
  4. Compliance health is worked out from the profile: the KYC not done is listed (late after 30 September), the next board
     meeting from the last one (s.173), the AGM held; ticking the KYC makes it Done and the count goes down;
  5. kept: a reload brings every value back;
  6. Paste MCA master data: the pasted page's CIN, name, class, capital, dates, email and a director are found, shown and
     kept (FinCom does not connect to MCA);
  7. the firm's copy: signed in (Cloud.api watched), the profile is read from corp_profiles for this client and a change is
     sent as an upsert on (firm_id, client_id) with the lists; a server without the table (migration 143 not run): the work
     stays on this computer and the page says sharing starts once the server is updated;
  8. a phone (390 wide): the page is no wider than the screen.
RED before stage 2: no profile page. Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_corp_profile.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
SHOTS = os.environ.get("TDSDESK_SHOTS", os.path.join(HERE, "out", "corp-shots")); os.makedirs(SHOTS, exist_ok=True)
PORT = int(os.environ.get("CORP_PORT") or 8722)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=SITE)
H.func.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(("localhost", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

OPEN = "() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"
SETUP = """() => {
  const a = newCompany({name: "Kestrel Textiles Private Limited", gstin: "07AABCK1234F1Z5"}); a.pan = "AABCK1234F"; a.tan = "DELK12345E"; a.address = "12 Sample Road, New Delhi 110001";
  const b = newCompany({name: "Heron Looms Private Limited", gstin: "29AABCH5678G1Z9"}); b.pan = "AABCH5678G";
  [a, b].forEach((c) => { S.companies[c.id] = c; Store.saveCompany(c); });
  S.coId = a.id; S.view = "company"; S.tab = "dash"; S.loadingCo = false; render(); return [a.id, b.id]; }"""
def go_profile(pg, cid):
    pg.evaluate("(id) => openCompany(id).then(() => { goClient('books:corp'); })", cid); pg.wait_for_timeout(1500)
def txt(pg, sel): return pg.evaluate("(s) => { const e = document.querySelector(s); return e ? e.innerText.trim() : null; }", sel)
def fill(pg, sel, v):
    pg.fill(sel, v); pg.press(sel, "Tab"); pg.wait_for_timeout(250)

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    co, co2 = E(SETUP); W(800)
    go_profile(pg, co)

    print("1. what FinCom holds")
    ok(E("!!document.querySelector('#app [data-corp-page=profile]')"), "the profile page")
    ok(txt(pg, "#app [data-corp-name]") == "Kestrel Textiles Private Limited", "the name (%s)" % txt(pg, "#app [data-corp-name]"))
    ok(txt(pg, "#app [data-rec=pan]") == "AABCK1234F · DELK12345E" and txt(pg, "#app [data-rec=gstin]") == "07AABCK1234F1Z5", "PAN · TAN and GSTIN from the client (%s, %s)" % (txt(pg, "#app [data-rec=pan]"), txt(pg, "#app [data-rec=gstin]")))
    ok(E("!!document.querySelector('#app [data-corp-health]')") and E("!!document.querySelector('#app [data-corp-directors]')") and E("!!document.querySelector('#app [data-corp-shares]')") and E("!!document.querySelector('#app [data-corp-charges]')"),
       "the parts: health, directors, shareholding, charges")

    print("2. Edit details")
    pg.click("#app [data-corp-edit=details]"); W(500)
    ok(E("!!document.querySelector('#app [data-corp-details] [data-from-fincom]')"), "values from FinCom are marked so")
    fill(pg, "#app [data-corp-details] input[data-f=cin]", "u17299dl2019ptc000000")
    ok(E("document.querySelector('#app [data-corp-details] input[data-f=roc]').value") == "ROC Delhi" and E("document.querySelector('#app [data-corp-details] select[data-f=cls]').value") == "private",
       "the CIN fills the ROC and the class (%s, %s)" % (E("document.querySelector('#app [data-corp-details] input[data-f=roc]').value"), E("document.querySelector('#app [data-corp-details] select[data-f=cls]').value")))
    fill(pg, "#app [data-corp-details] input[data-f=incorporated]", "2019-06-10")
    fill(pg, "#app [data-corp-details] textarea[data-f=office]", "14 Sample Lane, New Delhi 110005")
    fill(pg, "#app [data-corp-details] input[data-f=authorised]", "1000000")
    fill(pg, "#app [data-corp-details] input[data-f=paidup]", "100000")
    fill(pg, "#app [data-corp-details] input[data-f=auditor]", "Made-up & Associates")
    pg.select_option("#app [data-corp-details] select[data-f=auditorTill]", "2028-29"); W(250)
    fill(pg, "#app [data-corp-details] input[data-f=email]", "secretarial@example.com")
    fill(pg, "#app [data-corp-details] input[data-f=lastBoard]", "2026-08-01")
    pg.fill("#app [data-corp-details] input[data-f=agm]", "2026-09-25"); W(300)
    pg.check("#app [data-corp-details] input[data-f=small]"); W(300)
    pg.click("#app [data-corp-details] button:has-text('Done')"); W(400)
    hero = txt(pg, "#app [data-corp-hero]") or ""
    ok("CIN U17299DL2019PTC000000" in hero and "Incorporated 10-Jun-2019" in hero and "14 Sample Lane" in hero, "the header: CIN, incorporated, office (%s)" % hero[:300].replace("\n", " | "))
    ok("Private company" in hero and "Small company" in hero and "ROC Delhi" in hero, "the header's chips: class, small company, ROC")
    ok(txt(pg, "#app [data-kpi=authorised]") == "₹10,00,000" and txt(pg, "#app [data-kpi=paidup]") == "₹1,00,000" and txt(pg, "#app [data-kpi=agm]") == "25-Sep-2026",
       "capital and the last AGM (%s, %s, %s)" % (txt(pg, "#app [data-kpi=authorised]"), txt(pg, "#app [data-kpi=paidup]"), txt(pg, "#app [data-kpi=agm]")))
    ok("Made-up & Associates · till AGM of FY 2028-29" == txt(pg, "#app [data-rec=auditor]") and txt(pg, "#app [data-rec=email]") == "secretarial@example.com", "the record: auditor and term, email (%s)" % txt(pg, "#app [data-rec=auditor]"))

    print("3. Directors, shareholders, charges")
    pg.click("#app [data-corp-edit=directors]"); W(300)
    for i, (n, din, d) in enumerate((("Asha Verma (made-up)", "00000011", "2019-06-10"), ("Ravi Menon (made-up)", "00000022", "2021-04-01"), ("Meera Iyer (made-up)", "", ""))):
        pg.click("#app [data-corp-add=director]"); W(300)
        row = "#app [data-director-row='%d']" % i
        fill(pg, row + " input[aria-label=\"Director's name\"]", n)
        if din: fill(pg, row + " input[aria-label=DIN]", din)
        if d: pg.fill(row + " input[aria-label='Appointed on']", d); W(200)
    pg.select_option("#app [data-director-row='2'] select[aria-label=Designation]", "Company Secretary"); W(300)
    pg.check("#app [data-director-row='0'] input[data-kyc]"); W(300)
    pg.click("#app [data-corp-edit=directors]"); W(400)
    rows = E("[...document.querySelectorAll('#app [data-corp-directors] tbody tr')].map(r => r.innerText.replace(/\\s+/g, ' ').trim())")
    ok(len(rows) == 3 and "Asha Verma (made-up) 00000011 Director 10-Jun-2019 Done" == rows[0] and rows[1].endswith("Due by 30-Sep") and "Not needed (no DIN)" in rows[2], "the directors and their KYC (%s)" % rows)
    pg.click("#app [data-corp-edit=shares]"); W(300)
    for n, s in (("Asha Verma (made-up)", "6000"), ("Ravi Menon (made-up)", "4000")):
        pg.click("#app [data-corp-add=holder]"); W(250)
        fill(pg, "#app [data-corp-shares] tbody tr:last-child input[aria-label=\"Shareholder's name\"]", n)
        fill(pg, "#app [data-corp-shares] tbody tr:last-child input[aria-label=Shares]", s)
    pg.click("#app [data-corp-edit=shares]"); W(400)
    hold = E("[...document.querySelectorAll('#app [data-holder]')].map(e => e.innerText)")
    ok(hold == ["Asha Verma (made-up) · 6,000 shares · 60%", "Ravi Menon (made-up) · 4,000 shares · 40%"], "shareholders with their %% (%s)" % hold)
    pg.click("#app [data-corp-edit=details]"); W(300)
    fill(pg, "#app [data-corp-details] input[aria-label='Face value of a share (₹)']", "5")
    ok(E("!!document.querySelector('#app [data-corp-warn=paidup]')"), "10,000 shares of ₹5 do not make the paid-up ₹1,00,000: said")
    fill(pg, "#app [data-corp-details] input[aria-label='Face value of a share (₹)']", "10")
    pg.click("#app [data-corp-details] button:has-text('Done')"); W(300)
    ok(not E("!!document.querySelector('#app [data-corp-warn=paidup]')") and "10,000 equity shares of ₹10 each" in (txt(pg, "#app [data-corp-shares]") or ""), "10,000 shares of ₹10 make the paid-up ₹1,00,000: no warning")
    pg.click("#app [data-corp-edit=charges]"); W(300); pg.click("#app [data-corp-add=charge]"); W(300)
    fill(pg, "#app [data-corp-charges] input[aria-label='Charge holder']", "Made-up Bank Limited")
    fill(pg, "#app [data-corp-charges] input[aria-label=Amount]", "500000")
    pg.click("#app [data-corp-edit=charges]"); W(400)
    ok(txt(pg, "#app [data-kpi=charges]") == "1 · ₹5,00,000", "the header's open charges (%s)" % txt(pg, "#app [data-kpi=charges]"))

    print("4. Compliance health")
    hk = E("[...document.querySelectorAll('#app [data-health]')].map(e => [e.dataset.health, e.dataset.tone, e.innerText.replace(/\\s+/g, ' ')])")
    keys = {k: (t, w) for k, t, w in hk}
    due0 = int(E("document.querySelector('#app [data-health-due]').dataset.healthDue"))
    today = E("(() => { const d = istToday(); return d.slice(0,4) + '-' + d.slice(4,6) + '-' + d.slice(6); })()")
    fy = E("(() => { const d = istToday(), y = +d.slice(0,4), m = +d.slice(4,6), a = (m < 4 ? y - 1 : y) - 1; return a + '-' + String(a + 1).slice(2); })()")
    ok("kyc:00000022" in keys and "kyc:00000011" in keys and keys["kyc:00000011"][0] == "ok", "the KYC of each director with a DIN: one done, one not (%s)" % hk)
    late = today > str(int(fy[:4]) + 1) + "-09-30"
    ok(keys.get("kyc:00000022", ("", ""))[0] == ("bad" if late else keys.get("kyc:00000022", ("", ""))[0]), "the KYC not done is late after 30 September (%s, today %s)" % (keys.get("kyc:00000022"), today))
    ok("board" in keys and "120 days" not in keys["board"][1] and "s.173(5)" in keys["board"][1], "the next board meeting: a small company's rule, s.173(5) (%s)" % (keys.get("board"),))
    ok(fy != "2025-26" or keys.get("agm", ("", ""))[0] == "ok", "the AGM of FY 2025-26: held (%s)" % (keys.get("agm"),))
    pg.click("#app [data-corp-edit=directors]"); W(300); pg.check("#app [data-director-row='1'] input[data-kyc]"); W(300); pg.click("#app [data-corp-edit=directors]"); W(400)
    due1 = int(E("document.querySelector('#app [data-health-due]').dataset.healthDue"))
    ok(E("document.querySelector('#app [data-health=\"kyc:00000022\"]').dataset.tone") == "ok" and due1 == due0 - 1, "the KYC ticked: Done, one less due (%d -> %d)" % (due0, due1))
    pg.screenshot(path=os.path.join(SHOTS, "profile-1440.png"), full_page=True)

    print("5. kept")
    pg.reload(); W(3500); E(OPEN); W(1500)
    ok(E("!!document.querySelector('#app [data-corp-page=profile]')") and txt(pg, "#app [data-kpi=paidup]") == "₹1,00,000" and len(E("[...document.querySelectorAll('#app [data-corp-directors] tbody tr')]")) == 3
       and txt(pg, "#app [data-kpi=charges]") == "1 · ₹5,00,000", "after a reload: capital, directors, charges")

    print("6. Paste MCA master data")
    go_profile(pg, co2)
    pg.click("#app [data-corp-paste]"); W(300)
    MASTER = "\n".join(["CIN\tU13990KA2020PTC000002", "Company Name\tHeron Looms Private Limited", "ROC Code\tRoC-Bangalore", "Class of Company\tPrivate", "Company SubCategory\tNon-govt company",
                        "Authorised Capital(Rs)\t5,00,000", "Paid up Capital(Rs)\t1,00,000", "Date of Incorporation\t15/07/2020", "Registered Address\t3 Made-up Street, Bengaluru 560001",
                        "Email Id\toffice@example.com", "Date of last AGM\t28/09/2025", "Company Status(for efiling)\tActive", "", "DIN/PAN\tName\tBegin Date", "00000033\tKiran Rao (made-up)\t15/07/2020"])
    pg.fill("#app [data-corp-paste-box] textarea", MASTER); W(400)
    found = int(E("document.querySelector('#app [data-paste-found]').dataset.pasteFound"))
    ok(found >= 10, "the pasted page's fields found (%d)" % found)
    pg.click("#app [data-corp-paste-keep]"); W(500)
    hero = txt(pg, "#app [data-corp-hero]") or ""
    ok("CIN U13990KA2020PTC000002" in hero and "Incorporated 15-Jul-2020" in hero and txt(pg, "#app [data-kpi=authorised]") == "₹5,00,000" and txt(pg, "#app [data-kpi=agm]") == "28-Sep-2025",
       "kept: CIN, incorporation, capital, last AGM (%s)" % hero[:200].replace("\n", " | "))
    ok("Kiran Rao (made-up)" in (txt(pg, "#app [data-corp-directors]") or ""), "the director from the master data")

    print("7. the firm's copy")
    calls = E("""(cid) => new Promise(async (done) => {
      const log = [], realOn = Cloud.on, realApi = Cloud.api;
      Cloud.on = () => true;
      Cloud.api = async (path, opts) => { log.push({path, method: (opts && opts.method) || 'GET', prefer: opts && opts.headers && opts.headers.Prefer, body: opts && opts.body});
        if (/^corp_profiles\\?select/.test(path)) return [{client_id: cid, profile: {cin: 'U17299DL2019PTC000000', nic: '13990 · weaving (from the firm)'}, directors: [{name: 'Firm Director (made-up)', din: '00000099', desig: 'Director'}], shareholders: [], charges: [], letterhead: {}, updated_at: '2099-01-01T00:00:00Z'}];
        return []; };
      try {
        // this computer's edits already sent (nothing pending): the firm's newer copy wins
        const k = 'fincom:corp:' + cid, kept = JSON.parse(localStorage.getItem(k)); kept.pending = {}; localStorage.setItem(k, JSON.stringify(kept));
        FCCorp.forget(cid); FCCorp.corpOf(cid);
        await new Promise((r) => setTimeout(r, 800));
        const nic = (FCCorp.corpOf(cid).profile || {}).nic + ' / ' + ((FCCorp.corpOf(cid).profile.directors || [])[0] || {}).name;
        await FCCorp.flush(cid);
        done({log, nic});
      } finally { Cloud.on = realOn; Cloud.api = realApi; }
    })""", co)
    reads = [c["path"] for c in calls["log"] if c["method"] == "GET"]
    ok(any(r.startswith("corp_profiles?select=*&client_id=eq.") for r in reads) and any(r.startswith("corp_filings?") for r in reads) and any(r.startswith("corp_documents?") for r in reads),
       "signed in: the three tables are read for this client (%s)" % reads)
    ok(calls["nic"] == "13990 · weaving (from the firm) / Firm Director (made-up)", "the firm's newer copy is taken, its lists too (%s)" % calls["nic"])
    sent = E("""(cid) => new Promise(async (done) => {
      const log = [], realOn = Cloud.on, realApi = Cloud.api;
      Cloud.on = () => true;
      Cloud.api = async (path, opts) => { log.push({path, method: (opts && opts.method) || 'GET', prefer: opts && opts.headers && opts.headers.Prefer, body: opts && opts.body}); return []; };
      try {
        FCCorp.corpOf(cid).pending.profile = 1; await FCCorp.flush(cid);
        done(log);
      } finally { Cloud.on = realOn; Cloud.api = realApi; }
    })""", co)
    post = [c for c in sent if c["method"] == "POST"]
    ok(post and post[0]["path"] == "corp_profiles?on_conflict=firm_id,client_id" and "resolution=merge-duplicates" in (post[0]["prefer"] or "") and post[0]["body"]["client_id"] == co
       and [d["din"] for d in post[0]["body"]["directors"]] == ["00000099"] and "directors" not in post[0]["body"]["profile"] and post[0]["body"]["profile"].get("nic", "").startswith("13990"),
       "a change is an upsert on (firm_id, client_id), the lists beside the profile (%s)" % json.dumps(post[:1])[:300])
    note = E("""(cid) => new Promise(async (done) => {
      const realOn = Cloud.on, realApi = Cloud.api;
      Cloud.on = () => true;
      Cloud.api = async () => { throw new Error("Could not find the table 'public.corp_profiles' in the schema cache"); };
      try { FCCorp.forget(cid); FCCorp.corpOf(cid); await new Promise((r) => setTimeout(r, 500)); FCCorp.corpOf(cid).pending.profile = 1; await FCCorp.flush(cid); render(); await new Promise((r) => setTimeout(r, 400));
        done({text: (document.querySelector('#app [data-corp-cloud]') || {}).innerText || '', pending: Object.keys(FCCorp.corpOf(cid).pending)}); }
      finally { Cloud.on = realOn; Cloud.api = realApi; }
    })""", co2)
    ok("Sharing with the firm starts once" in note["text"] and "profile" in note["pending"], "no table on the server: kept here, waiting, and said (%s)" % note)
    E("() => { FCCorp.forget(); render(); }"); W(500)
    ok("Kiran Rao (made-up)" in (txt(pg, "#app [data-corp-directors]") or ""), "this computer's copy is still there afterwards")
    ctx.close()

    print("8. a phone")
    ctx = br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    co, co2 = E(SETUP); W(800); go_profile(pg, co)
    wide = E("document.documentElement.scrollWidth")
    ok(E("!!document.querySelector('#app [data-corp-page=profile]')") and wide <= 392, "the profile on a phone, no wider than the screen (%s)" % wide)
    pg.screenshot(path=os.path.join(SHOTS, "profile-390.png"), full_page=True)
    ctx.close(); br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
