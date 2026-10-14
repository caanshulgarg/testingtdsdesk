"""python3 run_assistant_ui.py - FinCom Assistant on the React build (app/dist-test), end to end except Claude:
  the page -> the fincom-assistant function (server/assistant/index.ts under Deno, tests/assistant_fnserve.ts, Claude MOCKED
  by fixed transcripts) -> the Supabase stand-in (assistant_supa.py) -> a throwaway PostgreSQL with migration 77 and the
  made-up books of tests/fixtures/books (assistant_stand.py). The figures shown come from the book tools on the database.
Checked, with a screenshot of each in tests/out/assistant/:
  on by default (the owner's decision of 14-Oct-2026); the owner switches it off and on in Settings › AI help;
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
sys.path.insert(0, os.path.join(HERE, "fixtures", "assistant"))
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
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-read", "--allow-env", "--allow-sys", "tests/assistant_fnserve.ts", str(FN_PORT)], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
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

        # ---------- on by default (the owner's decision of 14-Oct-2026): the launcher is there; the owner can switch it off
        ok(pg.evaluate("ASST.on()"), "on by default: no setting row for the firm, the assistant is on")
        pg.evaluate("S.view = 'home'; S.settingsTab = 'ai'; S.homeTab = 'rules'; render()"); pg.wait_for_timeout(800)
        ok(pg.locator("[data-asst-switch]").count() == 1, "Settings › AI help has the Assistant's switch")
        box = pg.locator("[data-asst-switch] input[type=checkbox]")
        ok(box.count() == 1 and box.is_checked(), "the switch shows it on; no consent tick")
        box.click(); pg.wait_for_timeout(1200)
        ok(not pg.evaluate("ASST.on()") and db.one("select enabled from assistant_settings where firm_id = '%s'" % A.FIRM) == "f", "the owner switches it off (kept in assistant_settings)")
        pg.keyboard.press("Control+j"); pg.wait_for_timeout(800)
        ok(pg.locator("[data-asst-panel]").count() == 0 and "switched off" in pg.inner_text("body"), "switched off: Ctrl+J says so")
        pg.locator("[data-asst-switch] input[type=checkbox]").click(); pg.wait_for_timeout(1200)
        ok(pg.evaluate("ASST.on()") and db.one("select enabled from assistant_settings where firm_id = '%s'" % A.FIRM) == "t", "and on again")
        shot(pg, "08-settings-switch", "[data-asst-settings]")
        # ---------- the client's books: the launcher, Ctrl+J, the panel
        pg.evaluate("S.view = 'company'; S.coId = 'larkspur'; S.tab = 'books'; S.books = window.__bk; S.booksTab = 'tds'; render()"); pg.wait_for_timeout(700)
        ok(pg.locator("[data-asst-launch]").count() == 1 and "Larkspur" in pg.inner_text("[data-asst-launch]"), "the launcher: Ask about the open client")
        pg.keyboard.press("Control+j"); pg.wait_for_timeout(700)
        ok(pg.locator("[data-asst-panel]").count() == 1, "Ctrl+J opens the panel")
        ok(pg.locator("[data-asst-first-notice]").count() == 1, "first use: the notice (questions may be processed by an AI provider; identifiers are masked)")
        pg.locator("[data-asst-first-notice] button").click(); pg.wait_for_timeout(300)
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
        # the owner's report of 14-Oct-2026: no raw keys; the one label map (server/_shared/assistant-labels.js)
        latest = pg.inner_text(".asst-turn.latest")
        ok("disallowance30pct" in json.dumps(r.get("summary") or {}) and "Disallowance u/s 40(a)(ia) – 30%" in latest and "disallowance30pct" not in latest and "disallowance30pct" not in t["text"],
           "the summary's fields in words: Disallowance u/s 40(a)(ia) – 30%, no raw key")
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
        # ---------- one Upload (the owner's request of 14-Oct-2026): several files of every kind at once, each told by
        # FinCom's rules (the AI only for the two the rules cannot tell), with its next steps; nothing done by itself
        import make_uploads
        fx = make_uploads.make(os.path.join(OUT, "uploads"))
        ok(pg.locator("[data-asst-upload-btn]").count() == 1 and "Upload" in pg.inner_text("[data-asst-upload-btn]") and pg.locator("text=Notice").filter(has=pg.locator("svg")).count() == 0, "the panel has Upload (no Notice button)")
        rows0, stmts0, jobs0 = db.one("select count(*) from assistant_uploads"), pg.evaluate("(S.bank && S.bank.stmts || []).length"), pg.evaluate("(S.jobs || []).length")
        pg.set_input_files("[data-asst-upload-input]", list(fx.values()))
        for _ in range(120):
            if pg.evaluate("AUpload.list().filter(u => u.state === 'ready' || u.state === 'failed').length") >= 10: break
            pg.wait_for_timeout(250)
        ups = {u["name"]: u for u in pg.evaluate("AUpload.list().map(u => ({name: u.name, state: u.state, kind: u.kind, by: u.by, side: u.side || '', summary: u.summary, path: u.path || '', acts: u.acts.map(a => a.id + (a.disabled ? '!' : ''))}))")}
        print("    " + json.dumps({k: [v["kind"], v["by"], v["acts"]] for k, v in ups.items()}))
        want = {"bill.pdf": ("bill", "rules", ["purchase", "ask"]), "sales-register.xlsx": ("register", "rules", ["importP", "importS", "ask"]), "bank-statement.csv": ("bank", "rules", ["bank"]),
                "26as.txt": ("as26", "rules", ["as26"]), "certificate-format.docx": ("certificate", "rules", ["keep", "ask"]), "agreement.docx": ("other", "ai", ["ask"]), "photo.png": ("bill", "ai", ["purchase", "sales", "ask"]),
                "gstr2b-032026.json": ("register", "rules", ["importP", "ask"]), "notice-copy.pdf": ("notice", "rules", ["notice"])}
        for name, (kind, by, acts) in want.items():
            u = ups.get(name) or {}
            ok(u.get("state") == "ready" and u.get("kind") == kind and u.get("by") == by and u.get("acts") == acts, "%s: %s, told by %s, offered %s (%s)" % (name, kind, "FinCom's rules" if by == "rules" else "the AI", acts, [u.get("kind"), u.get("by"), u.get("acts"), u.get("summary")]))
        ok("ATH/25-26/0142" in ups["bill.pdf"]["summary"] and "purchase" in ups["bill.pdf"]["summary"], "the bill's line: its number, and that it is a purchase (%s)" % ups["bill.pdf"]["summary"])
        ok("HDFC Bank" in ups["bank-statement.csv"]["summary"] and "6789" in ups["bank-statement.csv"]["summary"], "the statement's line: the bank and the account's last digits (%s)" % ups["bank-statement.csv"]["summary"])
        ok("4 rows" in ups["sales-register.xlsx"]["summary"] and "2025-26" in ups["26as.txt"]["summary"] and "blank" in ups["certificate-format.docx"]["summary"], "the register, 26AS and certificate lines %s" % [ups["sales-register.xlsx"]["summary"], ups["26as.txt"]["summary"], ups["certificate-format.docx"]["summary"]])
        ok("GSTR-2B" in ups["gstr2b-032026.json"]["summary"] and "3 invoices" in ups["gstr2b-032026.json"]["summary"] and "03-2026" in ups["gstr2b-032026.json"]["summary"], "the GSTR-2B file: a register to import (%s)" % ups["gstr2b-032026.json"]["summary"])
        ok(pg.locator('[data-name="gstr2b-032026.json"] [data-asst-act="importP"]').count() == 1, "GSTR-2B: Import in Purchase (the upload pages' import), offered, not done")
        ok("ASMT-10" in ups["notice-copy.pdf"]["summary"] and "/notices/" in ups["notice-copy.pdf"]["path"], "the notice in the batch: the notice flow (stored with the notices; Read the notice and draft a reply)")
        ok(pg.evaluate("ASST.st().attach == null || !/notice-copy/.test(ASST.st().attach.name || '')"), "in a batch, the notice is not attached by itself")
        ok(all("/uploads/" in u["path"] for n, u in ups.items() if u["kind"] != "notice"), "the others are stored in the firm's private folder (…/uploads/)")
        seen = json.load(__import__("urllib.request").request.urlopen(FNURL + "/__seen"))
        cl = [x for x in seen if x["kind"] == "classify"]
        ok(len(cl) == 2 and sum(1 for x in cl if x["image"]) == 1 and any("RENT AGREEMENT" in x["text"] for x in cl), "the AI was asked about 2 files only: the picture as it is, the Word file as its text")
        ok(db.one("select count(*) from assistant_uploads") == str(int(rows0) + 9) and db.one("select count(*) from assistant_uploads where action is not null") == "0", "each upload is recorded; no step taken")
        ok(pg.evaluate("(S.bank && S.bank.stmts || []).length") == stmts0 and pg.evaluate("(S.jobs || []).length") == jobs0, "nothing was added to Bank or Purchase by itself")
        ok(pg.locator("[data-asst-uploads] [data-asst-kind]").count() >= 9, "each file shows its kind, its line and its buttons")
        shot(pg, "05c-uploads")
        # a step, on the click: the certificate format kept; the statement added to Bank for review
        pg.click('[data-name="certificate-format.docx"] [data-asst-act="keep"]'); pg.wait_for_timeout(600)
        ok(db.one("select action from assistant_uploads where name = 'certificate-format.docx'") == "keep", "Use for a certificate: on the click, recorded")
        ok(pg.evaluate("ASST.ups().some(x => /certificate-format/.test(x.name)) && !ASST.ups().some(x => /notice/.test(x.name))"), "the certificate format (and the other files, not the notices) go to the certificate tool with the next question (ASST.ups)")
        # the stand-in has no credit ledger (charge_usage): the reading is not charged here; on staging it is, as on Bank
        pg.evaluate("() => { window.charge = async () => true; }")
        pg.evaluate("() => { window.__toasts = []; const t0 = window.toast; window.toast = (m, ...r) => { window.__toasts.push(String(m)); return t0(m, ...r); }; }")
        pg.click('[data-name="bank-statement.csv"] [data-asst-act="bank"]')
        for _ in range(60):
            if pg.locator('[data-name="bank-statement.csv"] [data-asst-done="bank"]').count(): break
            pg.wait_for_timeout(250)
        ok(pg.evaluate("(S.bank && S.bank.stmts || []).length") == stmts0 + 1 and pg.locator('[data-name="bank-statement.csv"] [data-asst-done="bank"]').count() == 1, "Add to Bank for review: the statement is in Bank, for review (%s)" % [stmts0, pg.evaluate("(S.bank && S.bank.stmts || []).length"), pg.inner_text('[data-name="bank-statement.csv"]')[:300], pg.evaluate("window.__toasts || []"), pg.evaluate("[S.view, S.coId, S.bank && S.bank.cid, S.bank && S.bank.busy, S.bank && S.bank.lastFail, S.bank && S.bank.moved, S.creditStop || null]")])
        pg.evaluate("ASST.open()"); pg.wait_for_timeout(400)
        # Ask about it: the Word file's text goes with the question (masked), to the file model, not the notice one
        pg.click('[data-name="agreement.docx"] [data-asst-act="ask"]'); pg.wait_for_timeout(300)
        ok(pg.evaluate("ASST.st().attach && ASST.st().attach.kind === 'other' && /RENT AGREEMENT/.test(ASST.st().attach.text || '')"), "Ask about it: the file is attached to the next question")
        t = ask(pg, "What is in agreement.docx? Summarise it.")
        seen = json.load(__import__("urllib.request").request.urlopen(FNURL + "/__seen"))
        last = [x for x in seen if x["kind"] == "ask"][-1:]
        ok("20,000" in t["text"] and last and "RENT AGREEMENT" in last[0]["fileText"] and last[0]["model"] == "claude-sonnet-5-5", "the answer about the file (the model had its text; Sonnet, not the notice model) %s" % [t["text"][:200], last])
        ok(not t.get("notice"), "it is not read as a notice")
        # dropped on the panel: the same as Upload
        n0 = pg.evaluate("AUpload.list().length")
        pg.evaluate("""() => { const dt = new DataTransfer(); dt.items.add(new File(["Statement of Account\\nHDFC Bank\\nAccount No: 50100999988887\\nIFSC: HDFC0001234\\n\\nDate,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\\n02/03/2026,NEFT CR MARIGOLD,N1,02/03/2026,,1000.00,2000.00\\n"], "march.csv", {type: "text/csv"}));
          const el = document.querySelector("[data-asst-panel]"); el.dispatchEvent(new DragEvent("dragover", {bubbles: true, cancelable: true, dataTransfer: dt})); el.dispatchEvent(new DragEvent("drop", {bubbles: true, cancelable: true, dataTransfer: dt})); }""")
        for _ in range(60):
            if pg.evaluate("AUpload.list().length") > n0 and pg.evaluate("AUpload.list().slice(-1)[0].state") == "ready": break
            pg.wait_for_timeout(250)
        ok(pg.evaluate("AUpload.list().slice(-1)[0].name") == "march.csv" and pg.evaluate("AUpload.list().slice(-1)[0].kind") == "bank", "a file dropped on the panel is uploaded and told (a bank statement)")
        shot(pg, "05d-dropped")
        # Import in Sales: the sales register opens in the Sales page's own import (upload pages), for review; nothing posted
        pg.evaluate("ASST.open()"); pg.wait_for_timeout(400)
        pg.click('[data-name="sales-register.xlsx"] [data-asst-act="importS"]')
        for _ in range(60):
            if pg.locator('[data-name="sales-register.xlsx"] [data-asst-done="importS"]').count(): break
            pg.wait_for_timeout(250)
        ok(pg.locator('[data-name="sales-register.xlsx"] [data-asst-done="importS"]').count() == 1 and pg.evaluate("typeof SheetImport === 'object' && S.view === 'company'"), "Import in Sales: the register goes to the Sales page's import, for review")
        pg.evaluate("ASST.open()"); pg.wait_for_timeout(400)
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
