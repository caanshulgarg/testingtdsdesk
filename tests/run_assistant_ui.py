"""python3 run_assistant_ui.py - FinCom Assistant on the React build (app/dist-test), end to end except Claude:
  the page -> the fincom-assistant function (server/assistant/index.ts under Deno, tests/assistant_fnserve.ts, Claude MOCKED
  by fixed transcripts) -> the Supabase stand-in (assistant_supa.py) -> a throwaway PostgreSQL with migration 77 and the
  made-up books of tests/fixtures/books (assistant_stand.py). The figures shown come from the book tools on the database.
Checked, with a screenshot of each in tests/out/assistant/:
  off by default (no launcher; Ctrl+J says it is off); the owner switches it on and records consent in Settings › AI help;
  the launcher and Ctrl+J; the panel's suggestions and privacy note; a green answer (194C, Ashvattha 40,000, amounts right
  aligned, a date that opens the entry); an amber answer with a made-up voucher removed and a wrong figure corrected
  (AI 4,000 struck out, FinCom 3,600) and its row on the owner's Mismatches list; a blue answer with its web source; a
  notice (PDF) read with the DRAFT reply and "Add to due list" (only on the click); an Excel file made by the function;
  a request to post refused with a link to the screen; "check my Q4 26Q" giving FinCom's checklist; Ctrl+K's last line
  asking the Assistant; "Check before filing" on the TDS return page; "Wrong answer?".
Run under the lock: flock /tmp/fincom-app.lock python3 tests/run_assistant_ui.py
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it: skipped (fails on CI)."""
# The database is a throwaway PostgreSQL from tests/pg_stand.py (through assistant_stand.py): CI runs this as root.
import os, sys, json, shutil, subprocess, threading, functools, http.server, time
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import assistant_stand as A, assistant_supa as SUPA
from books_data import CACHE, FIXTURE
from playwright.sync_api import sync_playwright
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno (CI must run this test)" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno (set DENO)"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
ROOT = os.path.join(HERE, "..")
SITE = os.environ.get("TDSDESK_SITE", os.path.join(ROOT, "app", "dist-test"))
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "assistant"); os.makedirs(OUT, exist_ok=True)
PORT, SUPA_PORT, FN_PORT, PG_PORT = 8178, 9486, 9487, 55479
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
web = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=web.serve_forever, daemon=True).start()
if not FIXTURE: raise SystemExit("run_assistant_ui.py needs the made-up books (tests/fixtures/books): unset TDSDESK_DATA")
books = json.load(open(CACHE))
import base64
master = base64.b64encode(open(os.path.join(HERE, "fixtures", "books", "Master.xml"), "rb").read()).decode()
twobs = [json.load(open(os.path.join(HERE, "fixtures", "books", f))) for f in sorted(os.listdir(os.path.join(HERE, "fixtures", "books"))) if f.startswith("returns_R2B_")]

# the page: offline mode with the fixture's client (id "larkspur", as in the stand's database), signed in as the firm's owner
SETUP = """async ([bk, master, twobs, me, firm, fn]) => {
  const c = newCompany({name: "Larkspur Fixture Events Private Limited", gstin: "07AAGCL4827M1Z3"}); delete S.companies[c.id]; c.id = "larkspur"; c.tan = "DELL12345A";
  S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; S.coId = c.id; S.view = "company"; S.tab = "books"; S.loadingCo = false;
  const ms = await Books.importMasters(new File([Uint8Array.from(atob(master), (ch) => ch.charCodeAt(0))], "Master.xml", {type: "text/xml"}));
  const b = Object.assign({loading: false, challans: [], alloc: {}}, bk, {ledInfo: ms.info, under: ms.under, groups: ms.groups, groupInfo: ms.groupInfo, gstins: ms.gstins, pans: ms.pans, states: ms.states, cid: c.id});
  b.map = Books.mapLedgers(b.vouchers, {}); S.books = b; LedMaster.refresh(b);
  b.twoBs = {}; twobs.forEach((j) => { const t = GST2B.fromJson(j); b.twoBs[t.gstin + "|" + t.period] = t; });
  window.__bk = b;
  // the firm account: the function's address (it passes everything else on to the stand-in), the owner's session
  window.__api = [];
  Cloud.cfg = () => ({url: fn, key: "anon-key", email: "owner@example.test"});
  Cloud.sess = () => ({access_token: "tok-" + me, refresh_token: "", at: Date.now(), expires_in: 3600, user_id: me, email: "owner@example.test"});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {};
  Cloud.st.firm = firm; Cloud.st.role = "owner"; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: me, firm_id: firm, name: "Owner", role: "owner"}];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner"})});
  S.firm.firmName = "Garg Shekhar & Company (test)"; S.firm.firmAddress = "Chartered Accountants, New Delhi";
  // only the Assistant's own calls reach the stand-in; the rest of the app's cloud traffic (sync, alerts) answers empty here
  const real = Cloud.api.bind(Cloud);
  Cloud.api = async (p, o, r) => { window.__api.push(p); return /^(rpc\\/asst_|client_due_tasks|assistant_)/.test(p) ? real(p, o, r) : []; };
  try { if (typeof Live === "object") Live.stop(); } catch (e){}
  render();
}"""
ASK = """async (q) => { await ASST.ask(q); }"""
LAST = "() => { const t = ASST.turns(); return t[t.length - 1]; }"

def shot(pg, name, sel=".asst-panel"):
    p = os.path.join(OUT, name + ".png")
    try:
        loc = pg.locator(sel).first
        loc.screenshot(path=p) if loc.count() else pg.screenshot(path=p)
    except Exception:
        pg.screenshot(path=p)
    return p

def ask(pg, q):
    pg.fill("#asstQ", q); pg.keyboard.press("Enter")
    t0 = time.time()
    while time.time() - t0 < 60:
        if pg.evaluate("() => { const t = ASST.turns(); const l = t[t.length - 1]; return !!(l && l.done && l.q === %s); }" % json.dumps(q)): break
        pg.wait_for_timeout(200)
    pg.wait_for_timeout(400)
    t = pg.evaluate(LAST)
    try: json.dump(t, open(os.path.join(OUT, "turn-%s.json" % "".join(ch for ch in q[:24] if ch.isalnum())), "w"), indent=1, default=str)
    except Exception: pass
    return t

db = A.start(PG_PORT); fn = None
try:
    A.migrate(db); A.load_fixture(db); A.add_notice_data(db)
    SUPA.start(db, SUPA_PORT)
    env = dict(os.environ, STAND_URL="http://127.0.0.1:%d" % SUPA_PORT, NO_COLOR="1")
    if os.path.exists("/root/.ccr/ca-bundle.crt"): env.setdefault("DENO_CERT", "/root/.ccr/ca-bundle.crt")
    # the function's npm packages are fetched first (on a fresh CI machine this takes a while), then it is started
    pre = subprocess.run([DENO, "cache", "tests/assistant_fnserve.ts"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=600)
    if pre.returncode: print(pre.stdout[-2000:] + pre.stderr[-2000:])
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-read", "--allow-env", "tests/assistant_fnserve.ts", str(FN_PORT)], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    t0, line, seen = time.time(), "", []
    while time.time() - t0 < 300:
        line = fn.stdout.readline()
        if not line and fn.poll() is not None: break
        seen.append(line)
        if "listening" in line: break
    ok("listening" in line, "the function is served (Deno) in front of the stand-in" + ("" if "listening" in line else ": " + "".join(seen[-20:])[-1500:]))
    if "listening" not in line: raise SystemExit(1)
    threading.Thread(target=lambda: [None for _ in fn.stdout], daemon=True).start()
    FNURL = "http://127.0.0.1:%d" % FN_PORT
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(SETUP, [books, master, twobs, A.ME, A.FIRM, FNURL]); pg.wait_for_timeout(1200)
        pg.evaluate("S.books = window.__bk; ASST.loadSettings(true)"); pg.wait_for_timeout(800)

        # ---------- off by default
        ok(pg.evaluate("!ASST.on()") and pg.locator("[data-asst-launch]").count() == 0, "off by default: no Assistant button")
        pg.keyboard.press("Control+j"); pg.wait_for_timeout(800)
        ok(pg.locator("[data-asst-panel]").count() == 0 and "switched off" in pg.inner_text("body"), "Ctrl+J says it is switched off for the firm")
        # ---------- the owner switches it on, then records the clients' consent
        pg.evaluate("S.view = 'home'; S.settingsTab = 'ai'; S.homeTab = 'rules'; render()"); pg.wait_for_timeout(500)
        if pg.locator("[data-asst-switch]").count() == 0:
            pg.evaluate("goHome && goHome('settings')") if pg.evaluate("typeof goHome === 'function'") else None; pg.wait_for_timeout(500)
        ok(pg.locator("[data-asst-switch]").count() == 1, "Settings › AI help has the Assistant's switch")
        boxes = pg.locator("[data-asst-switch] input[type=checkbox]")
        boxes.nth(0).click(); pg.wait_for_timeout(1200)
        ok(pg.evaluate("ASST.st().settings.enabled && !ASST.on()"), "switched on, but not used until consent is recorded")
        pg.locator("[data-asst-switch] input[type=checkbox]").nth(1).click(); pg.wait_for_timeout(1200)
        ok(pg.evaluate("ASST.on()") and db.one("select enabled and consent from assistant_settings where firm_id = '%s'" % A.FIRM) == "t", "consent recorded: on (assistant_settings in the database)")
        shot(pg, "08-settings-switch", "[data-asst-settings]")
        # ---------- the client's books: the launcher, Ctrl+J, the panel
        pg.evaluate("S.view = 'company'; S.coId = 'larkspur'; S.tab = 'books'; S.books = window.__bk; S.booksTab = 'tds'; render()"); pg.wait_for_timeout(700)
        ok(pg.locator("[data-asst-launch]").count() == 1 and "Larkspur" in pg.inner_text("[data-asst-launch]"), "the launcher: Ask about the open client")
        pg.keyboard.press("Control+j"); pg.wait_for_timeout(700)
        ok(pg.locator("[data-asst-panel]").count() == 1, "Ctrl+J opens the panel")
        ok(pg.locator("[data-asst-suggest] button").count() >= 5 and "identifiers are masked" in pg.inner_text("[data-asst-privacy]"), "suggested questions, and the privacy note")
        shot(pg, "01-panel")
        # ---------- green: a book tool
        t = ask(pg, "Which suppliers crossed 30,000 under 194C without TDS this year?")
        ok("books" in t["labels"] and pg.locator('[data-asst-label="books"]').count() >= 1 and "Checked against the books" in pg.inner_text(".asst-turn.latest"), "green: Checked against the books ✓")
        r = (t["results"] or [{}])[0]
        rows = r.get("rows") or []
        ok(r.get("tool") == "tds_missed" and any("Ashvattha" in json.dumps(x) for x in rows) and any(abs(float(x.get(k) or 0) - 40000) < 0.005 for x in rows for k in x if isinstance(x.get(k), (int, float))), "the table: Ashvattha Transport Co, 40,000.00 (from the database)")
        al = pg.evaluate("() => { const td = [...document.querySelectorAll('.asst-turn.latest .asst-table td.n')]; return td.length ? getComputedStyle(td[0]).textAlign : ''; }")
        ok(al in ("right", "end"), "amounts right aligned (%s)" % al)
        shot(pg, "02-green")
        ask(pg, "Bank payments in September 2025")
        ok(pg.locator(".asst-turn.latest .asst-table button.linkbtn").count() >= 1, "dates are links to the entry (bank payments, September 2025)")
        # ---------- amber: the Day Book slice, a made-up voucher removed, a wrong figure corrected
        t = ask(pg, "What did we pay Rukmini in March and what was the reverse charge?")
        ok("ai" in t["labels"] and "AI answer, not checked against the books" in pg.inner_text(".asst-turn.latest"), "amber: AI answer, not checked against the books")
        ok([c.get("no") for c in t["citations"]["dropped"]] == ["301"] and pg.locator("[data-asst-dropped]").count() == 1, "the made-up voucher 301 is removed and said so")
        v = {x["name"]: x for x in t["verdicts"]}
        bad = v.get("reverse charge on March's rent") or {}
        ok(abs(float(bad.get("fincom") or 0) - 3600) < 0.005 and not bad.get("ok"), "the wrong figure: AI 4,000, FinCom 3,600")
        txt = pg.inner_text(".asst-turn.latest")
        ok("FinCom's figure is used" in txt and pg.locator(".asst-turn.latest .asst-fig.fix s").count() >= 1, "shown with the AI's figure struck out and FinCom's used")
        ok(pg.locator(".asst-turn.latest .asst-fig.ok").count() >= 1 and "matches FinCom" in txt, "the matching figure: ✓ matches FinCom")
        shot(pg, "03-amber-corrected")
        # ---------- "Wrong answer?"
        pg.click(".asst-turn.latest [data-asst-wrong]"); pg.fill(".asst-turn.latest .asst-rep input", "the rent was 20,000 a month"); pg.keyboard.press("Enter"); pg.wait_for_timeout(1200)
        ok(db.one("select count(*) from assistant_mismatches where kind = 'user_report' and firm_id = '%s'" % A.FIRM) == "1", "Wrong answer? writes a user_report row")
        # ---------- blue: general guidance with the web
        pg.evaluate("ASST.setScope('firm')"); pg.wait_for_timeout(300)
        t = ask(pg, "TDS rate on rent for a company?")
        ok("general" in t["labels"] and "General guidance" in pg.inner_text(".asst-turn.latest") and pg.locator(".asst-turn.latest .asst-links a").count() == 1, "blue: General guidance, with the web source linked")
        ok("393" in t["text"] and "194-I" in t["text"], "both Acts' sections cited")
        shot(pg, "04-blue")
        pg.evaluate("ASST.setScope('client')"); pg.wait_for_timeout(300)
        # ---------- a notice
        pg.set_input_files(".asst-askbar input[type=file]", os.path.join(HERE, "fixtures", "assistant", "asmt10-notice.pdf")); pg.wait_for_timeout(1500)
        ok(pg.evaluate("!!(ASST.st().attach && /notices\\//.test(ASST.st().attach.path))"), "the notice is stored in the firm's private folder (…/notices/)")
        tasks0 = db.one("select count(*) from client_due_tasks")
        t = ask(pg, "Please read this notice and draft a reply")
        n = t.get("notice") or {}
        ok(n.get("form") == "ASMT-10" and abs(float(n.get("amount") or 0) - 5600) < 0.005 and n.get("reply_by") == "2026-11-15", "notice: ASMT-10, 5,600.00, reply by 15-Nov-2026")
        ok(pg.locator("[data-asst-draft]").count() == 1 and "DRAFT" in pg.inner_text("[data-asst-draft]"), "the reply is a DRAFT, with Word and PDF")
        items = pg.evaluate("() => { const t = ASST.turns().slice(-1)[0]; return (t.checklist || []).map(i => [i.id, i.status, i.annex || null]); }")
        ok(["itc_recon", "ready", 1] in items and ["invoices", "attach", None] in items and len([i for i in items if i[1] == "ready"]) == 5, "the documents: 5 ready from FinCom as Annexures 1-5, the rest to attach (%d)" % len(items))
        ok(pg.locator("[data-asst-checklist] li").count() == len(items), "the checklist is shown")
        ok(pg.locator("[data-asst-cases] [data-case-ok]").count() == 1 and "Verify before filing" in pg.inner_text("[data-asst-cases]") and "indiankanoon.org" in pg.inner_text("[data-asst-cases]"), "the verified case, with its link and 'Verify before filing'")
        ok(pg.locator('[data-asst-file="zip"]').count() == 1 and "Download reply pack" in pg.inner_text('[data-asst-file="zip"]'), "Download reply pack")
        with pg.expect_download() as dl:
            pg.click('[data-asst-file="zip"] button')
        zp = os.path.join(OUT, "reply-pack.zip"); dl.value.save_as(zp)
        import zipfile
        names = sorted(zipfile.ZipFile(zp).namelist())
        ok(names[:3] == ["00-Index.xlsx", "01-Reply-DRAFT.docx", "01-Reply-DRAFT.pdf"] and len([n for n in names if n.startswith("Annexure-")]) == 6, "the pack opens: index, reply, 5 annexures and the citations (%s)" % names)
        ok(db.one("select count(*) from client_due_tasks") == tasks0, "nothing on the due list until clicked")
        shot(pg, "05-notice")
        pg.click('[data-asst-checklist] li[data-item="invoices"] input'); pg.wait_for_timeout(900)
        ok(db.one("select (select x->>'done' from jsonb_array_elements(checklist) x where x->>'id' = 'invoices') from assistant_notices order by created_at desc limit 1") == "true", "a document ticked as attached is kept on the notice")
        pg.click('[data-asst-notice] button:has-text("Add to due list")'); pg.wait_for_timeout(1200)
        ok(db.one("select count(*) from client_due_tasks where client_id = 'larkspur' and due = '2026-11-15'") == "1", "Add to due list: the task is added on the click")
        pg.fill(".asst-filed input", "AA0711260045678"); pg.click('.asst-filed button'); pg.wait_for_timeout(900)
        ok(db.one("select status || ' ' || ack_no from assistant_notices order by created_at desc limit 1") == "filed AA0711260045678", "marked filed with the acknowledgement (FinCom filed nothing)")
        shot(pg, "05b-notice-filed", "[data-asst-notice]")
        # ---------- a file
        t = ask(pg, "An Excel of TDS by deductee with PANs")
        ok(len(t["files"]) == 1 and t["files"][0]["kind"] == "xlsx" and pg.locator('[data-asst-file="xlsx"]').count() == 1, "the Excel file is listed in the chat")
        with pg.expect_download() as dl:
            pg.click('[data-asst-file="xlsx"] button')
        d = dl.value; fp = os.path.join(OUT, "deductees.xlsx"); d.save_as(fp)
        ok(open(fp, "rb").read(2) == b"PK", "it downloads (a real .xlsx)")
        shot(pg, "06-file")
        # ---------- a request to change the books
        t = ask(pg, "Post these purchase bills to Tally")
        ok(pg.locator('[data-asst-screen]').count() >= 1 and "can't post" in t["text"], "a request to post: refused, with a button to the screen")
        # ---------- check before filing, from the chat
        t = ask(pg, "check my Q4 26Q")
        pg.wait_for_timeout(500)
        res = pg.evaluate("() => { const t = ASST.turns().slice(-1)[0]; return t.prefileRes ? t.prefileRes.lines.map(l => [l.id, l.status, l.count || 0]) : (t.prefileErr || null); }")
        ok(isinstance(res, list) and ["missed", "fix", 1] in res and any(x[0] == "late" and x[1] == "fix" for x in res), "check my Q4 26Q: FinCom's checklist (missed 1, late payments) %s" % res)
        ok(pg.locator("[data-asst-prefile] [data-prefile-line]").count() >= 5, "the checklist in the chat")
        shot(pg, "07-prefile")
        # ---------- the owner's Mismatches list
        pg.evaluate("ASST.close()"); pg.wait_for_timeout(300)
        pg.evaluate("S.view = 'home'; S.settingsTab = 'ai'; ASST.st().usage = undefined; render()"); pg.wait_for_timeout(1500)
        mm = pg.inner_text("[data-asst-mismatches]") if pg.locator("[data-asst-mismatches]").count() else ""
        ok("reverse charge on March's rent" in mm and "3,600.00" in mm and "4,000.00" in mm and "reported wrong" in mm, "Mismatches: the corrected figure and the report, with their status")
        sp = pg.inner_text("[data-asst-spend]") if pg.locator("[data-asst-spend]").count() else ""
        ok("₹" in sp and "150.00" in sp, "Settings: today's AI spend against the ₹150 cap (%s)" % sp[:80])
        ok(pg.locator("[data-asst-features] tr").count() >= 2, "which features use the money")
        shot(pg, "09-mismatches", "[data-asst-settings]")
        # ---------- Ctrl+K: the switcher's last line
        pg.evaluate("S.view = 'company'; S.coId = 'larkspur'; S.books = window.__bk; render()"); pg.wait_for_timeout(500)
        pg.keyboard.press("Control+k"); pg.wait_for_timeout(500); pg.keyboard.type("Top 10 customers by sales"); pg.wait_for_timeout(500)
        has = pg.locator("text=Ask FinCom Assistant").count()
        ok(has >= 1, "Ctrl+K: a line to ask FinCom Assistant")
        shot(pg, "10-ctrlk", "body")
        pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        # ---------- Check before filing on the TDS return page
        pg.evaluate("S.booksTab = 'tds'; S.tdsFy = '2025-26'; S.tdsQ = 'Q4'; S.tdsForm = '26Q'; S.tdsView = 'return'; S.tdsTab = 'deductions'; render()"); pg.wait_for_timeout(800)
        ok(pg.locator('[data-prefile-btn="tds"]').count() >= 1, "TDS return page: Check before filing")
        if pg.locator('[data-prefile-btn="tds"]').count():
            pg.locator('[data-prefile-btn="tds"]').first.click(); pg.wait_for_timeout(800)
            ok(pg.locator("[data-prefile] [data-prefile-line]").count() >= 5, "it opens the checklist")
            shot(pg, "11-prefile-tds", "body")
        # ---------- nothing of the answers in the log
        logs = db.one("select coalesce(string_agg(question || ' ' || coalesce(array_to_string(tools, ','), ''), ' | '), '') from assistant_log")
        ok("Ashvattha" not in logs and "40,000" not in logs and "3,600" not in logs, "the log holds questions and tools, no figures or names from the answers")
        ok(not errors, "no page errors" + ("" if not errors else ": " + errors[0]))
        br.close()
finally:
    if fn:
        fn.terminate()
        try: fn.wait(10)
        except Exception: fn.kill()
    db.stop()
print("\n" + ("FAILED: %d" % len(fails) if fails else "all passed") + " · screenshots in " + OUT)
sys.exit(1 if fails else 0)
