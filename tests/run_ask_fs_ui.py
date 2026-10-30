"""python3 run_ask_fs_ui.py - Ask FinCom and the financial statements (the owner's report of 29-Oct-2026: "I have asked for
provisional balance sheet … no previous memory … I had to ask every time but wrong answers were given or incomplete
answers"), on the React build (app/dist-test), end to end except Claude: the page -> fincom-assistant under Deno
(tests/assistant_fnserve.ts) -> the Supabase stand-in -> a throwaway PostgreSQL with the made-up books. A conversation of
four questions, as the owner's went:
  1. "Build my MIS: I want to make provisional balance sheet from 1st April 2025 to 30th September 2025." -> the statements
     card, not My MIS and no model; its figures are the Financial statements page's to the rupee (FinSt.build for the same
     period and comparative), with what is missing said and the buttons;
  2. last year's balance sheet uploaded on the panel, then "please prepare balance sheet … I am attaching last year
     balance sheet also": the card offers that file;
  3. "profit is different from tally.. I need fs till 30th September.. last year figures also.. I have attached final
     balance sheet in the earlier message": the question carries the conversation (turns 1-2, what each showed) and the
     file; the period is 30-Sep-2025's; the same file is offered again (the attachment reused), read with the page's own
     reader, what was read said (total assets, the profit), kept on "Yes"; the profit as Tally adds it beside the
     statements';
  4. "I need excel copy of this.": the statements of turn 3 with Download Excel first: the page's workbook downloads; "Open
     Financial statements: 01-Apr-2025 to 30-Sep-2025, compare with last year" opens the page with that Period and
     Compare with, its balance sheet total the card's.
Screenshots in tests/out/ask-fs/. Run under the lock: flock /tmp/fincom-app.lock python3 tests/run_ask_fs_ui.py
Needs Deno (DENO, else on the PATH or /opt/deno/deno); without it: skipped (fails on CI)."""
# The database is a throwaway PostgreSQL from tests/pg_stand.py (through assistant_stand.py): CI runs this as root.
import os, re, sys, json, shutil, subprocess, threading, functools, http.server, time
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
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "ask-fs"); os.makedirs(OUT, exist_ok=True)
PORT, SUPA_PORT, FN_PORT, PG_PORT = 8178, 9496, 9497, 55489   # the page at 8178: the function allows that origin (assistant_fnserve.ts)
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


def fnum(s):
    s = (s or "").strip()
    if s in ("", "-", "—"): return 0.0
    neg = s.startswith("(") and s.endswith(")")
    v = float(s.strip("()").replace(",", "").replace("₹", ""))
    return -v if neg else v

Q1 = "Build my MIS: I want to make provisional balance sheet from 1st April 2025 to 30th September 2025."
Q2 = "please prepare balance sheet for 1st April 2025 to 30th September 2025..you have daybook.. I am attaching last year balance sheet also"
Q3 = "profit is different from tally.. I need fs till 30th September.. last year figures also.. I have attached final balance sheet in the earlier message"
Q4 = "I need excel copy of this."
PYBS = json.load(open(os.path.join(HERE, "fixtures", "fin-statements", "py-bs-2025.json")))
import csv, io
buf = io.StringIO(); w = csv.writer(buf)
for r in [[PYBS["title"]], [PYBS["what"]], [PYBS["unit"]], PYBS["head"]] + PYBS["rows"]: w.writerow(r)
CSV = buf.getvalue()
CARD = ".asst-turn.latest [data-asst-fs]"

db = A.start(PG_PORT); fn = None
try:
    A.migrate(db); A.load_fixture(db); A.add_notice_data(db)
    db.sql("insert into assistant_settings (firm_id, enabled, consent) values ('%s', true, true);" % A.FIRM)
    SUPA.start(db, SUPA_PORT)
    env = dict(os.environ, STAND_URL="http://127.0.0.1:%d" % SUPA_PORT, NO_COLOR="1")
    if os.path.exists("/root/.ccr/ca-bundle.crt"): env.setdefault("DENO_CERT", "/root/.ccr/ca-bundle.crt")
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
        if os.environ.get("TDSDESK_DEBUG"): pg.on("framenavigated", lambda f: print("  nav", f.url) if f == pg.main_frame else None); pg.on("console", lambda m: print("  console", m.type, m.text[:300])); pg.on("crash", lambda *_: print("  CRASH")); pg.on("load", lambda *_: print("  load"))
        sent = []
        pg.on("request", lambda r: sent.append(r.post_data) if r.url.startswith(FNURL) and r.method == "POST" and r.post_data and '"action":"ask"' in r.post_data else None)
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        # the setup is started and then waited for (its render moves the page's hash while it runs; an evaluate waiting
        # on it can be told its context went away)
        pg.evaluate("(a) => { window.__setup = 'running'; (" + SETUP + ")(a).then(() => { window.__setup = 'done'; }, (e) => { window.__setup = 'failed: ' + e; }); }", [books, master, twobs, A.ME, A.FIRM, FNURL])
        for _ in range(240):
            try:
                st = pg.evaluate("() => window.__setup")
            except Exception:
                st = "running"
            if st != "running": break
            pg.wait_for_timeout(250)
        ok(st == "done", "the page is set up with the made-up books (%s)" % st)
        pg.wait_for_timeout(1200)
        pg.evaluate("S.books = window.__bk; ASST.loadSettings(true)"); pg.wait_for_timeout(800)
        pg.evaluate("S.view = 'company'; S.coId = 'larkspur'; S.tab = 'books'; S.books = window.__bk; S.booksTab = 'tds'; render()"); pg.wait_for_timeout(700)
        pg.keyboard.press("Control+j"); pg.wait_for_timeout(700)
        if pg.locator("[data-asst-first-notice] button").count(): pg.locator("[data-asst-first-notice] button").click(); pg.wait_for_timeout(300)
        # the page's own figures for 01-Apr-2025 to 30-Sep-2025, compared with the same period last year
        PAGE = """() => { const per = FinSt.periodOf('2025', {preset: 'custom', from: '20250401', to: '20250930', cmp: 'same'}), inp = FinSt.inputs(), d = FinSt.build('2025', {unit: inp.unit, dec: inp.dec, period: per});
          const rev = d.tb.rows.filter((r) => !r.synthetic && FS.nature(r.ledger).rev);
          return {assets: d.bs.total.assets.cy, eqL: d.bs.total.eqL.cy, pbt: d.pl.pbt.cy, pat: d.pl.pat.cy, rev: d.pl.rev.cy, unit: inp.unit, tallyWay: Math.round(-rev.reduce((s, r) => s + r.cy, 0) * 100) / 100, pySrc: d.tb.pySrc}; }"""
        want = pg.evaluate(PAGE)

        # ---------- 1. the provisional balance sheet: the statements card, no model, the page's figures
        t = ask(pg, Q1)
        ok(t.get("fs") and t["fs"].get("from") == "2025-04-01" and t["fs"].get("to") == "2025-09-30" and t.get("route") == "fs" and (t.get("usage") or {}).get("calls") == 0,
           "1: the statements card for 01-Apr-2025 to 30-Sep-2025, FinCom's own answer, no model (route %s, %s)" % (t.get("route"), t.get("usage")))
        ok(not any(r.get("kind") == "mis" for r in t.get("results") or []), "1: not My MIS")
        pg.wait_for_selector(CARD + " [data-asst-fs-table]", timeout=20000)
        cell = lambda label, col=0: pg.locator(CARD + ' [data-asst-fs-row="%s"] td.n' % label).nth(col).inner_text()
        ok(abs(fnum(cell("Total assets")) - want["assets"]) < 0.005 and abs(fnum(cell("Profit before tax")) - want["pbt"]) < 0.005 and abs(fnum(cell("Profit for the period")) - want["pat"]) < 0.005,
           "1: the card's figures are FinSt.build's for the period, to the rupee (total assets %s, PBT %s, profit %s)" % (cell("Total assets"), cell("Profit before tax"), cell("Profit for the period")))
        ok(pg.locator(CARD + " [data-asst-fs-open]").inner_text().strip() == "Open Financial statements: 01-Apr-2025 to 30-Sep-2025, compare with last year", "1: the button: %r" % pg.locator(CARD + " [data-asst-fs-open]").inner_text())
        ok(pg.locator(CARD + " [data-asst-fs-dl=xlsx]").count() == 1 and pg.locator(CARD + " [data-asst-fs-dl=pdf]").count() == 1, "1: Download Excel and Download PDF")
        miss = pg.inner_text(CARD)
        ok(want["pySrc"] != "none" or "not in FinCom's copy" in miss, "1: what is missing said plainly (the same period last year not in the copy: %s)" % want["pySrc"])
        ok(not re.search(r"₹\s?\d", t.get("text") or ""), "1: FinCom's line has no figure: " + (t.get("text") or "")[:160])
        shot(pg, "01-provisional-bs")

        # ---------- 2. last year's balance sheet uploaded on the panel, then the request naming it
        pg.evaluate("(csv) => AUpload.add([new File([csv], 'Larkspur Balance Sheet 2024-25.csv', {type: 'text/csv'})])", CSV)
        for _ in range(60):
            if pg.evaluate("() => AUpload.list().some((u) => u.state === 'ready' || u.state === 'failed')"): break
            pg.wait_for_timeout(250)
        up = pg.evaluate("() => AUpload.list().map((u) => ({path: u.path, state: u.state, kind: u.kind, summary: u.summary}))")
        ok(up and up[-1]["state"] == "ready" and "/uploads/" in (up[-1]["path"] or ""), "2: the upload is kept in the firm's folder (%s)" % up)
        t = ask(pg, Q2)
        ok(t.get("fs") and (t["fs"].get("py") or {}).get("path") == up[-1]["path"], "2: the card offers the balance sheet just attached (%s)" % (t.get("fs") or {}).get("py"))
        ok(pg.locator(CARD + " [data-asst-fs-pyread]").count() == 1, "2: 'Read it as last year's figures'")
        shot(pg, "02-attached")

        # ---------- 3. "profit is different from tally … the earlier message": the memory, the file reused, Tally
        t = ask(pg, Q3)
        body = json.loads(sent[-1]) if sent else {}
        hist, th = body.get("history") or [], body.get("thread") or {}
        ok(len(hist) == 4 and hist[0]["content"].startswith("Build my MIS") and hist[2]["content"].startswith("please prepare balance sheet") and "[Shown: the statements card, 01-Apr-2025 to 30-Sep-2025" in hist[1]["content"],
           "3: the question carries the conversation: both earlier questions and what each showed (%s)" % [h["content"][:60] for h in hist])
        ok((th.get("fs") or {}).get("to") == "2025-09-30" and any(f.get("path") == up[-1]["path"] for f in th.get("files") or []), "3: and the statements shown and the file attached earlier (%s)" % th)
        ok(t.get("fs") and t["fs"].get("from") == "2025-04-01" and t["fs"].get("to") == "2025-09-30" and t["fs"].get("tallyDiff") and (t["fs"].get("py") or {}).get("path") == up[-1]["path"],
           "3: 'fs till 30th September' is 30-Sep-2025; Tally; the file of the earlier message (%s)" % {k: (t.get("fs") or {}).get(k) for k in ("from", "to", "tallyDiff", "py")})
        pg.wait_for_selector(CARD + " [data-asst-fs-tally]", timeout=20000)
        tw = pg.locator(CARD + " [data-asst-fs-tallyway]").inner_text()
        ok(abs(fnum(tw) - want["tallyWay"]) < 0.005, "3: the profit as Tally adds it: %s (the income and expense ledgers' entries of the period: %s)" % (tw, want["tallyWay"]))
        pg.locator(CARD + " [data-asst-fs-pyread]").click()
        pg.wait_for_selector(CARD + " [data-asst-fs-pyread-sum]", timeout=20000)
        said = pg.inner_text(CARD + " [data-asst-fs-pyread-sum]")
        ok("total assets ₹" in said and ("they tie" in said or "differ by" in said), "3: what was read is said, to confirm: " + said)
        pg.locator(CARD + " [data-asst-fs-pykeep]").click(); pg.wait_for_timeout(500)
        kept = pg.evaluate("() => { const v = FinPyBs.latest('2025'); return v && {v: v.v, file: v.file, used: v.lines.filter((z) => z.use).length}; }")
        try: pg.wait_for_selector(CARD + " [data-asst-fs-table]", timeout=15000); again = pg.locator(CARD + " [data-asst-fs-wait]").count() == 0
        except Exception: again = False
        ok(again, "3: once kept, the card works the statements out again (not left 'working them out')")
        ok(kept and kept["v"] == 1 and kept["file"] == "Larkspur Balance Sheet 2024-25.csv" and kept["used"] > 0, "3: kept as the page keeps it (FinPyBs version %s)" % kept)
        shot(pg, "03-tally-and-last-year")

        # ---------- 4. "excel copy of this": the same statements, Excel first; the page opens with the period and comparative
        t = ask(pg, Q4)
        ok(t.get("fs") and t["fs"].get("want") == "xlsx" and t["fs"].get("carried") and t["fs"].get("to") == "2025-09-30" and (t.get("usage") or {}).get("calls") == 0,
           "4: 'excel copy of this' is the statements just shown, in Excel, with no model (%s)" % {k: (t.get("fs") or {}).get(k) for k in ("want", "carried", "to")})
        pg.wait_for_selector(CARD + " [data-asst-fs-table]", timeout=20000)
        ok("primary" in (pg.locator(CARD + " [data-asst-fs-dl=xlsx]").get_attribute("class") or ""), "4: Download Excel first")
        card_assets = cell("Total assets")
        try:
            with pg.expect_download(timeout=60000) as dl:
                pg.locator(CARD + " [data-asst-fs-dl=xlsx]").click()
            name = dl.value.suggested_filename
        except Exception as e:
            name = "(no download: %s)" % e
        ok("Financial statements 01-Apr-2025 to 30-Sep-2025" in name and name.endswith(".xlsx"), "4: the page's workbook downloads: " + name)
        shot(pg, "04-excel")
        pg.locator(CARD + " [data-asst-fs-open]").click(); pg.wait_for_timeout(2500)
        pg.wait_for_selector("[data-fin]", timeout=30000)
        at = pg.evaluate("() => { const f = document.querySelector('[data-fin]'), c = document.querySelector('[data-fin-cmp]'), p = document.querySelector('[data-fin-period]'); return {from: f && f.getAttribute('data-fin-from'), to: f && f.getAttribute('data-fin-to'), cmp: c && c.value, preset: p && p.getAttribute('data-fin-period')}; }")
        ok(at == {"from": "20250401", "to": "20250930", "cmp": "same", "preset": "custom"}, "4: the page opens on Period 01-Apr-2025 to 30-Sep-2025, Compare with the same period last year (%s)" % at)
        page_assets = pg.locator('[data-fin-total="II"] td.n').first.inner_text()
        ok(fnum(page_assets) == fnum(card_assets), "4: the page's balance sheet total is the card's: %s = %s" % (page_assets, card_assets))
        shot(pg, "05-page", "body")
        logs = db.one("select string_agg(route || ':' || cost_inr::text, ',' order by id) from assistant_log where question in (%s)" % ",".join("'" + q.replace("'", "''") + "'" for q in (Q1, Q2, Q3, Q4)))
        ok(logs and all(x.startswith("fs:") and float(x.split(":")[1]) == 0 for x in logs.split(",")) and len(logs.split(",")) == 4, "the four answers logged as the statements, ₹0 each (%s)" % logs)
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
