"""python3 run_certificates_ui.py - CA certificates in FinCom Assistant on the React build (app/dist-test), end to end except
Claude: the page -> the fincom-assistant function (tests/certificates_fnserve.ts, Claude MOCKED: the call to
certificate_prepare it would make, and a reply relaying the tool's questions) -> the Supabase stand-in (assistant_supa.py)
-> a throwaway PostgreSQL with migrations 77, 79 and 83 and the made-up books (assistant_stand.py).
The conversation, firm-wide: the user uploads two signed statements and a letterhead with the panel's Files button, asks
for turnover (2024-25, 2025-26) and net worth certificates for two clients; FinCom asks for the firm's details (once) and
for the year with no signed statement; the user answers (a typed figure, the books for one year); the figures are shown to
confirm; on "go ahead" the pack is made: Word and PDF per client and the summary Excel, the UDIN blank. Screenshots in
tests/out/certificates/ (and CERT_SHOTS when set). Made-up clients only.
Run under the lock: flock /tmp/fincom-app.lock python3 tests/run_certificates_ui.py"""
import os, sys, json, shutil, subprocess, threading, functools, http.server, time, io, zipfile, base64
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import assistant_stand as A, assistant_supa as SUPA
from playwright.sync_api import sync_playwright
from reportlab.pdfgen import canvas
DENO = os.environ.get("DENO") or shutil.which("deno") or ("/opt/deno/deno" if os.path.exists("/opt/deno/deno") else None)
if not DENO:
    print("  FAIL no Deno (CI must run this test)" if os.environ.get("GITHUB_ACTIONS") else "skipped: no deno (set DENO)"); raise SystemExit(1 if os.environ.get("GITHUB_ACTIONS") else 0)
ROOT = os.path.join(HERE, "..")
SITE = os.environ.get("TDSDESK_SITE", os.path.join(ROOT, "app", "dist-test"))
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "certificates"); os.makedirs(OUT, exist_ok=True)
PORT, SUPA_PORT, FN_PORT, PG_PORT = 8179, 9496, 9497, 55493
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
web = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=SITE)); threading.Thread(target=web.serve_forever, daemon=True).start()

# made-up signed statements (text PDFs, as an auditor's export) and a made-up letterhead
def signed(path, fy, cap, cur, rev):
    c = canvas.Canvas(path, pagesize=(595, 842)); y = 790
    for t, a in [("BIRCHWOOD TRADERS", ""), ("Balance Sheet as at 31st March, %d" % (fy + 1), ""), ("Partners' capital accounts   3", cap), ("Partners' current accounts   4", cur),
                 ("Statement of Profit and Loss for the year ended 31st March, %d" % (fy + 1), ""), ("Revenue from operations   12", rev), ("Other income   13", "45,000.00")]:
        c.drawString(50, y, t)
        if a: c.drawRightString(500, y, a)
        y -= 18
    c.save()
TMP = os.path.join(OUT, "in"); os.makedirs(TMP, exist_ok=True)
signed(os.path.join(TMP, "birchwood-signed-2024-25.pdf"), 2024, "16,00,000.00", "1,50,000.00", "1,32,50,250.75")
signed(os.path.join(TMP, "birchwood-signed-2025-26.pdf"), 2025, "18,00,000.00", "2,45,300.50", "1,52,30,400.00")

SETUP = """async ([me, firm, fn]) => {
  Cloud.cfg = () => ({url: fn, key: "anon-key", email: "owner@example.test"});
  Cloud.sess = () => ({access_token: "tok-" + me, refresh_token: "", at: Date.now(), expires_in: 3600, user_id: me, email: "owner@example.test"});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {}; Cloud.on = () => true;
  Cloud.st.firm = firm; Cloud.st.role = "owner"; Cloud.st.state = "ok"; Cloud.st.members = [{user_id: me, firm_id: firm, name: "Owner", role: "owner"}];
  S.account = Object.assign(S.account || {}, {me: Object.assign((S.account || {}).me || {}, {role: "owner"})});
  const real = Cloud.api.bind(Cloud);
  Cloud.api = async (p, o, r) => /^(rpc\\/asst_|assistant_)/.test(p) ? real(p, o, r) : [];
  try { if (typeof Live === "object") Live.stop(); } catch (e){}
  S.view = "home"; render();
}"""
def shot(pg, name, sel=".asst-panel"):
    p = os.path.join(OUT, name + ".png")
    try:
        loc = pg.locator(sel).first
        loc.screenshot(path=p) if loc.count() else pg.screenshot(path=p)
    except Exception:
        pg.screenshot(path=p)
    if os.environ.get("CERT_SHOTS"): os.makedirs(os.environ["CERT_SHOTS"], exist_ok=True); shutil.copy(p, os.environ["CERT_SHOTS"])
def ask(pg, q):
    pg.fill("#asstQ", q); pg.keyboard.press("Enter")
    t0 = time.time()
    while time.time() - t0 < 90:
        if pg.evaluate("() => { const t = ASST.turns(); const l = t[t.length - 1]; return !!(l && l.done && l.q === %s); }" % json.dumps(q)): break
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(500)
    return pg.evaluate("() => { const t = ASST.turns(); return t[t.length - 1]; }")

db = A.start(PG_PORT); fn = None
try:
    A.migrate(db); A.load_fixture(db)
    db.sql(open(os.path.join(ROOT, "server", "assistant", "migration-79-reports.sql")).read())
    db.sql(open(os.path.join(ROOT, "server", "assistant", "migration-83-certificates.sql")).read())
    db.sql("insert into assistant_settings (firm_id, enabled, consent) values ('%s', true, true);" % A.FIRM +
           "insert into clients (id, firm_id, name, gstin, pan) values ('birchwood', '%s', 'Birchwood Traders', '', 'AAAFB3333C');" % A.FIRM)
    SUPA.start(db, SUPA_PORT)
    env = dict(os.environ, STAND_URL="http://127.0.0.1:%d" % SUPA_PORT, NO_COLOR="1")
    if os.path.exists("/root/.ccr/ca-bundle.crt"): env.setdefault("DENO_CERT", "/root/.ccr/ca-bundle.crt")
    pre = subprocess.run([DENO, "cache", "tests/certificates_fnserve.ts"], cwd=ROOT, env=env, capture_output=True, text=True, timeout=600)
    if pre.returncode: print(pre.stdout[-2000:] + pre.stderr[-2000:])
    fn = subprocess.Popen([DENO, "run", "--allow-net", "--allow-read", "--allow-env", "--allow-sys", "tests/certificates_fnserve.ts", str(FN_PORT)], cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    t0, line, seen = time.time(), "", []
    while time.time() - t0 < 300:
        line = fn.stdout.readline()
        if not line and fn.poll() is not None: break
        seen.append(line)
        if "listening" in line: break
    ok("listening" in line, "the function is served (Deno) in front of the stand-in" + ("" if "listening" in line else ": " + "".join(seen[-20:])[-1500:]))
    if "listening" not in line: raise SystemExit(1)
    logs = []
    threading.Thread(target=lambda: [logs.append(l) for l in fn.stdout], daemon=True).start()
    with sync_playwright() as p:
        br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1440, "height": 1000}, accept_downloads=True); pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        # a made-up letterhead, drawn on the page and kept as a picture
        pg.set_content('<div id="lh" style="width:900px;padding:18px;font-family:Georgia;text-align:center;border-bottom:3px solid #222;background:#fff"><div style="font-size:34px;font-weight:bold">Example &amp; Associates</div><div style="font-size:18px">Chartered Accountants</div></div>')
        pg.locator("#lh").screenshot(path=os.path.join(TMP, "letterhead.png"))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        if pg.locator('button[data-act="useOffline"]').count(): pg.click('button[data-act="useOffline"]'); pg.wait_for_timeout(1200)
        pg.evaluate(SETUP, [A.ME, A.FIRM, "http://127.0.0.1:%d" % FN_PORT]); pg.wait_for_timeout(800)
        pg.evaluate("ASST.loadSettings(true)"); pg.wait_for_timeout(800)
        pg.evaluate("ASST.open()"); pg.wait_for_timeout(800)
        ok(pg.locator("[data-asst-panel]").count() == 1 and pg.locator("[data-asst-upload]").count() == 1, "the panel, firm-wide, with its Files button")
        ok(any("certificate" in s.lower() for s in pg.evaluate("ASST.SUGGEST.firm")), "a suggested certificate question for the whole firm")
        pg.locator(".asst-askbar input[type=file][multiple]").set_input_files([os.path.join(TMP, f) for f in ("birchwood-signed-2024-25.pdf", "birchwood-signed-2025-26.pdf", "letterhead.png")])
        t0 = time.time()
        while time.time() - t0 < 20 and pg.evaluate("ASST.ups().length") < 3: pg.wait_for_timeout(200)
        ok(pg.evaluate("ASST.ups().length") == 3 and pg.locator("[data-asst-ups] .chip").count() == 3, "three files uploaded to <firm>/_firm/uploads/ and listed under the question box")
        shot(pg, "cert-01-uploaded")

        q1 = "Turnover certificate for 2024-25 and 2025-26 and net worth as on 31-Mar-2026 for Larkspur and Birchwood Traders"
        t = ask(pg, q1)
        txt = t.get("text") or ""
        ok("the firm's details once" in txt and "Please upload the signed balance sheet and profit and loss of FY 2024-25 for Larkspur" in txt, "FinCom asks for the firm's details and Larkspur's 2024-25 (no signed statement): " + txt[:300])
        ok("from books, not audited" in txt and "Birchwood Traders, or type" not in txt, "the books' figure offered only as a reference; Birchwood read from its signed PDFs")
        birch = [r for r in t["results"] if r.get("title", "").startswith("Birchwood")]
        ok(birch and [r["amount"] for r in birch[0]["rows"] if "Turnover" in r["item"]] == [13250250.75, 15230400], "Birchwood's turnover from the signed PDFs, to the paisa, each with its page and line")
        ok(not t.get("files"), "nothing made yet")
        shot(pg, "cert-02-questions")

        q2 = "Example & Associates, FRN 000000X, A. Example (Partner), M.No 123456, Faketown; the letterhead is uploaded. Larkspur 2024-25 turnover 14,25,000; use the books for 2025-26."
        t = ask(pg, q2)
        txt = t.get("text") or ""
        ok("the firm's details once" not in txt and db.one("select signatory || '|' || membership_no from assistant_cert_settings where firm_id = '%s'" % A.FIRM) == "A. Example|123456", "the firm's details saved once in the firm's settings (assistant_cert_settings)")
        ok("from the books, not audited" in txt, "the year from the books is flagged in one line")
        shot(pg, "cert-03-figures-to-confirm")

        q3 = "Figures confirmed, go ahead. Addressed to the Branch Manager, Example Bank, for renewal of the CC limit."
        t = ask(pg, q3)
        txt = t.get("text") or ""
        ok(len(t.get("files") or []) == 2 and "UDIN is left blank" in txt, "the pack and the summary Excel offered for download; the UDIN said to be blank")
        z = [f for f in t["files"] if f["name"].endswith(".zip")]
        b = None
        if z:
            path = z[0]["path"]
            b = pg.evaluate("async (p) => { const r = await fetch(Cloud.cfg().url + '/storage/v1/object/authenticated/assistant-files/' + p.split('/').map(encodeURIComponent).join('/'), {headers: {apikey: 'anon-key', Authorization: 'Bearer ' + Cloud.sess().access_token}}); const a = new Uint8Array(await r.arrayBuffer()); let s = ''; a.forEach((c) => s += String.fromCharCode(c)); return btoa(s); }", path)
        names = zipfile.ZipFile(io.BytesIO(base64.b64decode(b))).namelist() if b else []
        ok(len([n for n in names if n.endswith(".docx")]) == 2 and len([n for n in names if n.endswith(".pdf")]) == 2 and "Certificates-summary.xlsx" in names, "the pack: Word and PDF for each client and the summary Excel: " + ", ".join(names))
        if b:
            zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(b)))
            for n in names:
                if n.endswith(".pdf") or n.endswith(".docx"): open(os.path.join(OUT, n.replace("/", "_")), "wb").write(zf.read(n))
            doc = zf.read([n for n in names if n.startswith("Birchwood") and n.endswith(".docx")][0])
            x = zipfile.ZipFile(io.BytesIO(doc)).read("word/document.xml").decode()
            ok("1,52,30,400.00" in x and "UDIN: ____" in x and "Example &amp; Associates" in x, "Birchwood's Word certificate: the signed turnover, the firm, the UDIN blank")
        shot(pg, "cert-04-pack-ready")
        # the PDF of the certificate, as a picture
        pdfs = [n for n in os.listdir(OUT) if n.endswith(".pdf") and n.startswith("Birchwood")]
        if pdfs:
            pg2 = ctx.new_page(); pg2.set_viewport_size({"width": 900, "height": 1200})
            try:
                pg2.goto("file://" + os.path.abspath(os.path.join(OUT, pdfs[0]))); pg2.wait_for_timeout(2500); pg2.screenshot(path=os.path.join(OUT, "cert-05-certificate-pdf.png"))
                if os.environ.get("CERT_SHOTS"): shutil.copy(os.path.join(OUT, "cert-05-certificate-pdf.png"), os.environ["CERT_SHOTS"])
            except Exception as e: print("  (the PDF could not be shown in the browser: %s)" % str(e)[:100])
            pg2.close()
        ok(not [e for e in errors if "ResizeObserver" not in e], "no page errors: " + "; ".join(errors[:3]))
        br.close()
finally:
    if fn: fn.terminate()
    db.stop()
print("FAILED: %d" % len(fails) if fails else "all passed")
sys.exit(1 if fails else 0)
