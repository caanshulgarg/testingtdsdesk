"""python3 run_corp_rules.py - Corporate's company-law dates (stage-2 fixes after the review of 30f70eea6), worked out by the
page's own code (window.FCCorpRules, the Corporate chunk) on made-up companies:
  H3  the AGM: the earlier of 30 September after the year and fifteen months after the last AGM (s.96(1));
  H4  the first AGM: nine months after the first financial year's end; incorporated in January to March, the first year
      may end on 31 March of the following year (s.2(41) proviso), and the year before has no AGM;
  M1  board meetings (s.173): 120 days and four a calendar year; a section 8 company one in every six months; a small
      private company, an OPC, a dormant company and a private start-up one in each half-year, not before 90 days; the
      small company tick not used for a public company;
  M2  DIR-3 KYC from the rules file's setting, three-yearly (the owner's decision): due in the third financial year after
      the last KYC, by 30 June after it; none recorded: due for the year;
      after its date the profile says Overdue;
  M3  the ROC from the CIN: one ROC where the state has one; Maharashtra, Tamil Nadu and Andhra Pradesh: the choices,
      "from CIN, check"; Ladakh; FTC / FLC / ULL classes;
  L1  the pasted master data: impossible dates refused, director rows split on tabs or two spaces;
  L2  an auditor's term that has ended: Overdue;
  s.173(5) proviso: an OPC with one director holds none; four a year out of reach: a warning; the year of incorporation
  counts from its month.
Run on the React build: TDSDESK_SITE=../app/dist-test python3 run_corp_rules.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("CORP_PORT") or 8727)
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
CASES = [
    ("H3 six months after the year", "R.agmLastDay({incorporated: '2015-05-01', agms: {'2024-25': '2025-09-28'}}, '2025-26')", "2026-09-30"),
    ("H3 fifteen months after the last AGM, when earlier", "R.agmLastDay({incorporated: '2015-05-01', agms: {'2024-25': '2025-05-20'}}, '2025-26')", "2026-08-20"),
    ("H4 first AGM: nine months after the first year (June incorporation)", "R.agmLastDay({incorporated: '2024-06-10'}, '2024-25')", "2025-12-31"),
    ("H4 February incorporation: no AGM for the short year", "R.agmLastDay({incorporated: '2024-02-15'}, '2023-24')", None),
    ("H4 February incorporation: the first year to 31-Mar-2025, AGM by 31-Dec-2025", "R.agmLastDay({incorporated: '2024-02-15'}, '2024-25')", "2025-12-31"),
    ("H4 February incorporation, the first year chosen to 31-Mar-2024", "R.agmLastDay({incorporated: '2024-02-15', firstFyEnd: '2024-03-31'}, '2023-24')", "2024-12-31"),
    ("M1 120 days", "R.nextBoard({cls: 'private', lastBoard: '2026-03-10'}).by", "2026-07-08"),
    ("M1 section 8: six months", "R.nextBoard({cls: 'section8', lastBoard: '2026-03-10'}).by", "2026-09-10"),
    ("M1 small tick ignored for a public company", "R.nextBoard({cls: 'public', small: true, lastBoard: '2026-03-10'}).by", "2026-07-08"),
    ("M1 small private: the next half-year, not before 90 days", "[R.nextBoard({cls: 'private', small: true, lastBoard: '2026-08-01'}).by, R.nextBoard({cls: 'private', small: true, lastBoard: '2026-08-01'}).from]", ["2027-06-30", "2026-10-30"]),
    ("M1 dormant (s.455)", "R.nextBoard({cls: 'public', status: 'Dormant (s.455)', lastBoard: '2026-03-10'}).by", "2026-12-31"),
    ("M1 private start-up", "R.nextBoard({cls: 'private', startup: true, lastBoard: '2026-03-10'}).by", "2026-12-31"),
    ("M1 public start-up: no relaxation", "R.nextBoard({cls: 'public', startup: true, lastBoard: '2026-03-10'}).by", "2026-07-08"),
    ("M1 four a calendar year", "R.health({cls: 'private', lastBoard: '2026-08-01'}, {on: '2026-11-07', boards: ['2026-02-01', '2026-05-01']}).items.filter(x => x.key === 'board4').map(x => x.when)", ["3 of 4"]),
    ("s.173(5) proviso: an OPC with one director needs no meeting", "R.health({cls: 'opc', lastBoard: '2026-03-10', directors: [{name: 'Sole Director (made-up)', din: '00000011'}]}, {on: '2026-11-07'}).items.filter(x => x.key === 'board').map(x => [x.when, x.tone])", [["Not needed", "ok"]]),
    ("s.173: four no longer reachable is a warning, not red", "R.health({cls: 'private', lastBoard: '2026-02-01'}, {on: '2026-11-07', boards: []}).items.filter(x => x.key === 'board4').map(x => [x.when, x.tone])", [["1 of 4", "warn"]]),
    ("s.173: the year of incorporation counts from its month", "R.health({cls: 'private', incorporated: '2026-07-01', lastBoard: '2026-07-20'}, {on: '2026-11-07', boards: ['2026-10-15']}).items.filter(x => x.key === 'board4').map(x => [x.when, x.tone])", [["2 of 2", "ok"]]),
    ("M1 earliest date shown", "R.nextBoard({cls: 'opc', lastBoard: '2026-08-01'}).rule.includes('not before 30-Oct-2026')", True),
    ("M2 DIR-3 KYC, three-yearly (the owner's decision): none recorded, due for the year by 30 June", "[R.kycFor({kyc: []}, '2025-26').done, R.kycFor({kyc: []}, '2025-26').due]", [False, "2026-06-30"]),
    ("M2 last done in FY 2023-24: nothing due in FY 2025-26, next in FY 2026-27 by 30-Jun-2027", "[R.kycFor({kyc: ['2023-24']}, '2025-26').done, R.kycFor({kyc: ['2023-24']}, '2025-26').due, R.kycFor({kyc: ['2023-24']}, '2025-26').next]", [True, "2027-06-30", "2026-27"]),
    ("M2 last done in FY 2022-23: due in FY 2025-26, by 30-Jun-2026", "[R.kycFor({kyc: ['2022-23']}, '2025-26').done, R.kycFor({kyc: ['2022-23']}, '2025-26').due]", [False, "2026-06-30"]),
    ("L2 auditor's term ended: Overdue", "R.health({auditor: 'Made-up & Co', auditorTill: '2023-24'}, {on: '2026-11-07'}).items.filter(x => x.key === 'auditor').map(x => [x.when, x.tone])", [["Overdue", "bad"]]),
    ("M3 one ROC", "R.cinInfo('U17299DL2019PTC000000').roc", "ROC Delhi"),
    ("M3 Maharashtra: choose", "[R.cinInfo('U17299MH2019PTC000000').roc, R.cinInfo('U17299MH2019PTC000000').rocs, R.cinInfo('U17299MH2019PTC000000').rocCheck]", ["", ["ROC Mumbai", "ROC Pune"], True]),
    ("M3 Tamil Nadu and Andhra Pradesh: choose", "[R.cinInfo('U17299TN2019PTC000000').rocs, R.cinInfo('U17299AP2019PTC000000').rocs]", [["ROC Chennai", "ROC Coimbatore"], ["ROC Vijayawada", "ROC Hyderabad"]]),
    ("M3 Ladakh", "R.cinInfo('U17299LA2021PTC000000').roc", "ROC Jammu"),
    ("M3 FTC, FLC, ULL", "[R.cinInfo('U17299DL2019FTC000000').cls, R.cinInfo('L17299DL2019FLC000000').cls, R.cinInfo('U17299DL2019ULL000000').cls]", ["private", "public", "unlimited"]),
    ("L1 impossible dates refused", "R.readMaster('Date of Incorporation\\t31/02/2026\\nCIN\\tU17299DL2019PTC000000').fields.incorporated || ''", ""),
    ("L1 rows split on tabs or two spaces", "R.readMaster('00000011    Asha Verma (made-up)   10/06/2019\\n00000022\\tRavi Menon (made-up)\\t01/04/2021').directors.map(d => [d.din, d.name, d.appointed])",
     [["00000011", "Asha Verma (made-up)", "2019-06-10"], ["00000022", "Ravi Menon (made-up)", "2021-04-01"]]),
]

with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={"width": 1440, "height": 1000}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    E, W = pg.evaluate, pg.wait_for_timeout
    pg.goto("http://localhost:%d/" % PORT); W(2500); E(OPEN); W(800)
    co = E(SETUP); W(800)
    E("(id) => openCompany(id).then(() => goClient('books:corp'))", co); W(1800)
    ok(E("typeof FCCorpRules === 'object'"), "the rules are loaded with the page")
    for name, expr, want in CASES:
        got = E("() => { const R = FCCorpRules; return %s; }" % expr)
        ok(got == want, "%s: %s" % (name, json.dumps(got)))
    print("M2 on the page: Overdue after the date")
    fy = E("(() => { const d = istToday(), y = +d.slice(0,4), m = +d.slice(4,6), a = (m < 4 ? y - 1 : y) - 1; return a + '-' + String(a + 1).slice(2); })()")
    E("(cid) => { FCCorp.saveProfile(cid, {directors: [{id: 'd1', name: 'Ravi Menon (made-up)', din: '00000022', desig: 'Director'}]}); render(); }", co); W(600)
    chip = E("(document.querySelector('#app [data-kyc-chip]') || {}).dataset")
    due = str(int(fy[:4]) + 1) + "-06-30"
    today = E("(() => { const d = istToday(); return d.slice(0,4) + '-' + d.slice(4,6) + '-' + d.slice(6); })()")
    ok(chip and chip.get("kycChip") == ("overdue" if today > due else "due"), "the KYC chip: %s (today %s, due %s)" % (chip, today, due))
    ctx.close(); br.close()

ok(not errors, "no page errors (%s)" % errors[:3])
print("\n" + ("all passed" if not fails else "FAILED: %d" % len(fails)))
sys.exit(1 if fails else 0)
