"""python3 run_assistant_attach.py - Ask FinCom's attachments work like Claude's (the owner, 31-Oct-2026: "when we attach
files in Ask FinCom, it remains in the chat section, rather it should work like Claude"), and two financial statements
attached are compared line by line (02-Nov-2026).
Checked on the React build (app/dist-test), fincom-assistant stood in by the page (each question's body kept, the reply a
stream the test feeds), the storage upload stood in by a fake XMLHttpRequest (its progress held and let go by the test):
  1. a chosen file is a chip INSIDE the question box (name, size, the upload's progress, ×): nothing in the conversation; Send
     waits for the upload; a picture shows a small thumbnail
  2. a chip taken off with × before sending; Send: ONE message, the question with its file chips under it; the box is empty;
     the files go to fincom-assistant with the question (attachments, with their kind); a sent chip opens the file
  3. a file alone, no words: Send still works ("Read this file")
  4. at most 3 files a message (the server reads the first 3): a fourth is refused with a line saying so
  5. an upload that fails says so on its chip with Retry; Retry uploads it; Send waits meanwhile
  6. files dragged over the panel: the "Drop files here" overlay; Esc takes it away; dropped, the file is a chip; pasted too
  7. the next steps of a file sent (Add to Bank for review) are buttons under the answer, not a card in the thread
  8. an old conversation (a question with a file attached the earlier way, and the earlier Upload's card) still shows
  9. two made-up financial statements (PDF) and "compare": FinCom's table of the differences, line by line, balance sheet
     and profit and loss, with amounts (and lines in one file only); the AI is given the same differences; the files alone
     are read (no client's books, so the books' own statements card does not answer instead)
 10. a phone (390 wide): the chips fit in the box, no sideways scrolling
Screenshots in tests/out/assistant-attach/ (TDSDESK_OUT).
Run on app/dist-test, under the lock: flock /tmp/fincom-app.lock python3 tests/run_assistant_attach.py"""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "assistant-attach"); os.makedirs(OUT, exist_ok=True)
TMP = os.path.join(OUT, "files"); os.makedirs(TMP, exist_ok=True)
PORT = 8431
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Q, directory=SITE)); threading.Thread(target=srv.serve_forever, daemon=True).start()
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w)
    if not c: fails.append(w)

# ---------- the files (all made up)
sys.path.insert(0, os.path.join(HERE, "fixtures", "assistant"))
from make_fs import fs_pdf
files = {}
files["notes.txt"] = os.path.join(TMP, "notes.txt"); open(files["notes.txt"], "w").write("Meeting notes (made up): send the GST working by Friday.\n")
# a small picture (a 2x2 PNG)
import base64, zlib, struct
def png(path):
    raw = b"".join(b"\x00" + b"\xd9\x77\x06\xff" * 2 for _ in range(2))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
files["receipt.png"] = os.path.join(TMP, "receipt.png"); png(files["receipt.png"])
for n in ("a.txt", "b.txt", "c.txt", "d.txt"):
    files[n] = os.path.join(TMP, n); open(files[n], "w").write("Made-up note " + n + "\n")
files["march.csv"] = os.path.join(TMP, "march.csv")
open(files["march.csv"], "w").write("Statement of Account\nHDFC Bank\nAccount No: 50100999988887\nIFSC: HDFC0001234\n\nDate,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n02/03/2026,NEFT CR MARIGOLD,N1,02/03/2026,,1000.00,2000.00\n03/03/2026,UPI DR ROSEWOOD,N2,03/03/2026,500.00,,1500.00\n")
files["fs-draft.pdf"] = os.path.join(TMP, "Example Lantern FS 2024-25 draft.pdf"); fs_pdf(files["fs-draft.pdf"], "draft")
files["fs-final.pdf"] = os.path.join(TMP, "Example Lantern FS 2024-25 final.pdf"); fs_pdf(files["fs-final.pdf"], "final")

SETUP = """() => {
  Cloud.cfg = () => ({url: "http://fn.test", key: "anon-key", email: "me@firm.test"});
  Cloud.sess = () => ({access_token: "tok-x", refresh_token: "", user_id: "u1", email: "me@firm.test", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {};
  Cloud.st.firm = "f1"; Cloud.st.role = "owner"; Cloud.st.state = "ok";
  S.account = Object.assign(S.account || {}, {me: {role: "owner", email: "me@firm.test"}, firm: {name: "Test firm"}}); S.firm.firmName = "Test firm";
  Cloud.rpc = async (fn) => fn === "asst_settings" ? {enabled: true, owner: true, default_on: true, consent: true} : {};
  window.__rec = []; Cloud.api = async (p, o) => { window.__rec.push([p, o && o.method]); return []; }; try { Live.stop(); } catch (e) {}
  try { lsSet("tdsdesk:asst-notice", "1"); } catch (e) {}
  const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  S.coId = c.id; S.view = "company"; S.tab = "books"; render();
  // the storage upload, stood in: progress at 40% at once; the rest when window.__go() is called (or at once when not held);
  // window.__failNext makes the next upload fail (500)
  window.__held = []; window.__hold = false; window.__failNext = false; window.__stored = [];
  window.__go = () => { const h = window.__held.splice(0); h.forEach((f) => f()); };
  class FakeXhr {
    constructor(){ this.upload = {}; this.status = 0; this.h = {}; }
    open(m, u){ this.m = m; this.u = u; }
    setRequestHeader(k, v){ this.h[k] = v; }
    send(body){
      const fail = window.__failNext; window.__failNext = false;
      setTimeout(() => { if (this.upload.onprogress) this.upload.onprogress({lengthComputable: true, loaded: 40, total: 100}); }, 10);
      const end = () => setTimeout(() => { this.status = fail ? 500 : 200; if (!fail) window.__stored.push(this.u); if (this.onload) this.onload(); }, 20);
      if (window.__hold) window.__held.push(end); else setTimeout(end, 60);
    }
  }
  window.XMLHttpRequest = FakeXhr;
  // fincom-assistant, stood in: each question's body kept (window.__bodies); the reply a stream the test feeds; the
  // Upload's classify answered "other"
  window.__bodies = []; const real = window.fetch;
  window.fetch = (u, o) => { if (String(u) !== ASST.url()) return real(u, o);
    const b = JSON.parse(String(o.body));
    if (b.action === "classify") return Promise.resolve(new Response(JSON.stringify({ok: true, kind: "other", summary: "A made-up document."}), {headers: {"content-type": "application/json"}}));
    window.__bodies.push(b); let ctl; const st = new ReadableStream({start(c){ ctl = c; }}), en = new TextEncoder();
    window.__push = (x) => ctl.enqueue(en.encode('data: ' + JSON.stringify(x) + '\\n\\n')); window.__close = () => ctl.close();
    return Promise.resolve(new Response(st, {headers: {'content-type': 'text/event-stream'}})); };
  window.__toasts = []; const t0 = window.toast; window.toast = (m, ...r) => { window.__toasts.push(String(m)); try { return t0(m, ...r); } catch (e) {} };
  return ASST.loadSettings(true).then(() => c.id);
}"""
ANSWER = """(t) => { window.__push({t: 'text', d: t}); window.__push({t: 'done', text: t, labels: ['general']}); window.__close(); }"""
TURNS = "() => ASST.turns().length"
CHIPS = "() => Array.from(document.querySelectorAll('[data-asst-chips] [data-asst-chip]')).map((c) => ({name: c.dataset.name, state: c.dataset.asstChip, text: c.innerText.replace(/\\s+/g, ' ').trim(), thumb: !!c.querySelector('img.asst-chip-thumb'), bar: !!c.querySelector('.asst-chip-bar'), inBox: !!c.closest('form.asst-ask')}))"
def shot(pg, name, sel=".asst-panel"):
    p = os.path.join(OUT, name + ".png")
    try:
        loc = pg.locator(sel).first
        loc.screenshot(path=p) if loc.count() else pg.screenshot(path=p)
    except Exception:
        pg.screenshot(path=p)
    return p
def wait(pg, js, ms=8000):
    for _ in range(ms // 100):
        if pg.evaluate(js): return True
        pg.wait_for_timeout(100)
    return False
def thread_count(pg): return pg.locator("[data-asst-thread] [data-asst-turn]").count()

with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    pg.evaluate(SETUP); pg.wait_for_timeout(500)
    pg.evaluate("ASST.open()"); pg.wait_for_timeout(1200)
    ok(pg.locator("[data-asst-panel]").count() == 1, "the panel opens")

    # ---------- 1. chosen: chips in the box, uploading; nothing in the conversation
    pg.evaluate("window.__hold = true")
    pg.set_input_files("[data-asst-upload-input]", [files["notes.txt"], files["receipt.png"]])
    wait(pg, "() => document.querySelectorAll('[data-asst-chips] [data-asst-chip]').length === 2 && /40%/.test(document.querySelector('[data-asst-chips]').innerText)", 5000)
    ch = pg.evaluate(CHIPS)
    ok(len(ch) == 2 and all(c["inBox"] and c["state"] == "uploading" and "40%" in c["text"] and c["bar"] for c in ch), "1: two chips INSIDE the question box, each with its upload's progress (%s)" % ch)
    ok(pg.evaluate(TURNS) == 0 and thread_count(pg) == 0 and pg.locator("[data-asst-uploads]").count() == 0, "1: nothing in the conversation while the files upload")
    send = pg.locator(".asst-send")
    ok(send.is_disabled() and "upload" in (send.get_attribute("title") or "").lower(), "1: Send waits for the uploads (%r)" % send.get_attribute("title"))
    shot(pg, "01-uploading", "form.asst-ask")
    pg.evaluate("window.__hold = false; window.__go()")
    wait(pg, "() => Array.from(document.querySelectorAll('[data-asst-chips] [data-asst-chip]')).every((c) => c.dataset.asstChip === 'ready')")
    ch = pg.evaluate(CHIPS)
    ok(all(c["state"] == "ready" and not c["bar"] for c in ch) and any(c["name"] == "receipt.png" and c["thumb"] for c in ch) and any("TXT" in c["text"] and " B" not in c["text"] for c in ch), "1: uploaded: name and size; the picture shows a small thumbnail (%s)" % ch)
    ok(pg.evaluate(TURNS) == 0 and thread_count(pg) == 0, "1: still nothing in the conversation")
    shot(pg, "02-chips-ready", "form.asst-ask")

    # ---------- 2. one taken off; Send: one message with its chips
    pg.click('[data-asst-chip][data-name="notes.txt"] [data-asst-chip-x]'); pg.wait_for_timeout(200)
    ch = pg.evaluate(CHIPS)
    ok([c["name"] for c in ch] == ["receipt.png"], "2: × takes a file off before sending (%s)" % [c["name"] for c in ch])
    pg.fill("#asstQ", "What is this receipt for?"); pg.keyboard.press("Enter")
    wait(pg, "() => window.__bodies.length === 1")
    pg.wait_for_timeout(200)
    ok(pg.evaluate(TURNS) == 1 and thread_count(pg) == 1, "2: Send makes ONE message (%d)" % thread_count(pg))
    turn = pg.locator("[data-asst-turn]").first
    ok(turn.locator("[data-asst-q]").inner_text().strip() == "What is this receipt for?" and turn.locator("[data-asst-sent-chip]").count() == 1 and turn.locator('[data-asst-sent-chip="receipt.png"] img.asst-chip-thumb').count() == 1,
       "2: the message shows the question with the file's chip under it")
    ok(pg.locator("[data-asst-chips] [data-asst-chip]").count() == 0 and pg.input_value("#asstQ") == "", "2: the box is empty again (no chips, no words)")
    b = pg.evaluate("() => window.__bodies[0]")
    att = b.get("attachments") or []
    ok(b["question"] == "What is this receipt for?" and len(att) == 1 and att[0]["name"] == "receipt.png" and att[0]["kind"] and "/uploads/" in att[0]["path"] and att[0]["path"].startswith("f1/"),
       "2: the file goes to fincom-assistant with the question (attachments, with its kind, from the firm's folder) %s" % att)
    pg.evaluate(ANSWER, "A made-up receipt for printing."); pg.wait_for_timeout(500)
    with pg.expect_download() as dl:
        turn.locator('[data-asst-sent-chip="receipt.png"]').click()
    ok(dl.value.suggested_filename == "receipt.png", "2: a sent chip opens (downloads) the file")
    shot(pg, "03-one-message")

    # ---------- 3. a file alone, no words
    pg.set_input_files("[data-asst-upload-input]", [files["notes.txt"]])
    wait(pg, "() => Array.from(document.querySelectorAll('[data-asst-chips] [data-asst-chip]')).some((c) => c.dataset.asstChip === 'ready')")
    ok(not pg.locator(".asst-send").is_disabled(), "3: with a file and no words, Send is enabled")
    pg.click(".asst-send")
    wait(pg, "() => window.__bodies.length === 2")
    b = pg.evaluate("() => window.__bodies[1]")
    ok(b["question"] == "Read this file" and len(b["attachments"]) == 1 and pg.evaluate(TURNS) == 2 and pg.locator("[data-asst-turn]").nth(1).locator("[data-asst-q]").inner_text().strip() == "Read this file",
       "3: the file alone is sent: the question is 'Read this file' (%r)" % b["question"])
    pg.evaluate(ANSWER, "Notes about the GST working."); pg.wait_for_timeout(400)

    # ---------- 4. three a message
    pg.set_input_files("[data-asst-upload-input]", [files["a.txt"], files["b.txt"], files["c.txt"], files["d.txt"]])
    wait(pg, "() => document.querySelectorAll('[data-asst-chips] [data-asst-chip=\"ready\"]').length === 3")
    pg.wait_for_timeout(300)
    ok(pg.locator("[data-asst-chips] [data-asst-chip]").count() == 3 and any("Up to 3 files" in t for t in pg.evaluate("window.__toasts")), "4: at most 3 files a message, said so (%s)" % pg.evaluate("window.__toasts"))
    ok(pg.locator("[data-asst-upload-btn]").is_disabled(), "4: Attach is greyed with 3 in the box")
    for _ in range(3): pg.locator("[data-asst-chips] [data-asst-chip-x]").first.click(); pg.wait_for_timeout(100)
    ok(pg.locator("[data-asst-chips] [data-asst-chip]").count() == 0 and pg.evaluate(TURNS) == 2, "4: all taken off: nothing was sent")

    # ---------- 5. an upload fails: said on the chip, with Retry
    pg.evaluate("window.__failNext = true")
    pg.set_input_files("[data-asst-upload-input]", [files["a.txt"]])
    wait(pg, "() => !!document.querySelector('[data-asst-chip=\"failed\"]')")
    ok(pg.locator('[data-asst-chip="failed"]').count() == 1 and "Not uploaded" in pg.inner_text('[data-asst-chip="failed"]') and pg.locator('[data-asst-chip="failed"] [data-asst-chip-retry]').count() == 1, "5: a failed upload says so on its chip, with Retry")
    pg.fill("#asstQ", "and this?")
    ok(pg.locator(".asst-send").is_disabled(), "5: Send waits while a file is not uploaded")
    shot(pg, "04-failed-retry", "form.asst-ask")
    pg.click('[data-asst-chip="failed"] [data-asst-chip-retry]')
    ok(wait(pg, "() => !!document.querySelector('[data-asst-chips] [data-asst-chip=\"ready\"]')"), "5: Retry uploads it")
    pg.locator("[data-asst-chips] [data-asst-chip-x]").first.click(); pg.fill("#asstQ", ""); pg.wait_for_timeout(200)

    # ---------- 6. dragged over the panel: the overlay; Esc; dropped; pasted
    DRAG = """(kind) => { const dt = new DataTransfer(); dt.items.add(new File(["Made-up dropped note"], "dropped.txt", {type: "text/plain"}));
      const el = document.querySelector("[data-asst-thread]"); el.dispatchEvent(new DragEvent(kind, {bubbles: true, cancelable: true, dataTransfer: dt})); }"""
    pg.evaluate(DRAG, "dragover"); pg.wait_for_timeout(250)
    ok(pg.locator("[data-asst-dropzone]").count() == 1 and "Drop files here" in pg.inner_text("[data-asst-dropzone]"), "6: files dragged over the panel: 'Drop files here'")
    shot(pg, "05-drop-overlay")
    pg.evaluate("() => document.querySelector('[data-asst-panel]').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))"); pg.wait_for_timeout(250)
    ok(pg.locator("[data-asst-dropzone]").count() == 0 and pg.locator("[data-asst-panel]").count() == 1, "6: Esc takes the overlay away")
    pg.evaluate(DRAG, "dragover"); pg.evaluate(DRAG, "drop")
    wait(pg, "() => !!document.querySelector('[data-asst-chips] [data-name=\"dropped.txt\"]')")
    ok(pg.locator("[data-asst-dropzone]").count() == 0 and pg.locator('[data-asst-chips] [data-name="dropped.txt"]').count() == 1 and pg.evaluate(TURNS) == 2, "6: dropped: a chip in the box, nothing in the conversation")
    pg.evaluate("""() => { const dt = new DataTransfer(); dt.items.add(new File(["Made-up pasted note"], "pasted.txt", {type: "text/plain"}));
      document.getElementById("asstQ").dispatchEvent(new ClipboardEvent("paste", {bubbles: true, cancelable: true, clipboardData: dt})); }""")
    ok(wait(pg, "() => !!document.querySelector('[data-asst-chips] [data-name=\"pasted.txt\"]')"), "6: a file pasted into the box is a chip too")
    for _ in range(2): pg.locator("[data-asst-chips] [data-asst-chip-x]").first.click(); pg.wait_for_timeout(100)

    # ---------- 7. the next steps of a file sent: buttons under the answer
    pg.set_input_files("[data-asst-upload-input]", [files["march.csv"]])
    wait(pg, "() => !!document.querySelector('[data-asst-chips] [data-asst-chip=\"ready\"]')")
    pg.fill("#asstQ", "What is in this statement?"); pg.keyboard.press("Enter")
    wait(pg, "() => window.__bodies.length === 3")
    pg.evaluate(ANSWER, "An HDFC Bank statement for March 2026 (made up)."); pg.wait_for_timeout(700)
    last = pg.locator(".asst-turn.latest")
    ok(last.locator('[data-asst-fileacts] [data-name="march.csv"] [data-asst-act="bank"]').count() == 1 and pg.locator("[data-asst-uploads]").count() == 0,
       "7: 'Add to Bank for review' is a button under the answer (no card of its own in the thread)")
    ok(pg.evaluate("() => (window.__bodies[2].attachments || [])[0].kind") == "bank", "7: the statement goes as a bank statement (FinCom's rules)")
    shot(pg, "06-acts-under-answer", ".asst-turn.latest")

    # ---------- 8. an old conversation: a question with a file attached the earlier way, and the earlier Upload's card
    pg.evaluate("""() => { const a = ASST.st(), k = ASST.key();
      ASST.turns().unshift({id: 'old1', q: 'Read this notice and draft a reply', at: '2026-10-20T06:30:00Z', cid: ASST.cid(), live: '', text: 'The notice asks about February.', done: true, labels: ['notice'], results: [], files: [], drafts: [],
        screens: [], verdicts: [], links: [], unchecked: [], citations: {ok: [], dropped: []}, tools: [], slices: [], attach: {path: 'f1/x/notices/old-asmt10.pdf', name: 'old-asmt10.pdf'}});
      AUpload.st().uploads.push({id: 'uold', key: k, cid: ASST.cid(), name: 'old-bill.pdf', size: 1000, type: 'application/pdf', state: 'ready', kind: 'bill', by: 'rules', summary: 'A tax invoice (made up).', acts: [{id: 'ask', label: 'Ask about it'}], done: {}});
      ASST.draw(); }""")
    pg.wait_for_timeout(500)
    old = pg.locator('[data-asst-turn="old1"]')
    ok(old.count() == 1 and old.locator('[data-asst-sent-chip="old-asmt10.pdf"]').count() == 1 and "February" in old.inner_text(), "8: an old question with its file attached the earlier way still shows (the file as a chip)")
    ok(pg.locator('[data-asst-uploads] [data-name="old-bill.pdf"]').count() == 1, "8: the earlier Upload's card still shows")
    pg.evaluate("() => { ASST.turns().shift(); AUpload.st().uploads = AUpload.st().uploads.filter((u) => u.id !== 'uold'); ASST.draw(); }")

    # ---------- 9. two financial statements compared line by line
    pg.set_input_files("[data-asst-upload-input]", [files["fs-draft.pdf"], files["fs-final.pdf"]])
    wait(pg, "() => document.querySelectorAll('[data-asst-chips] [data-asst-chip=\"ready\"]').length === 2", 15000)
    pg.fill("#asstQ", "Compare these two financial statements"); pg.keyboard.press("Enter")
    wait(pg, "() => window.__bodies.length === 4", 20000)
    b = pg.evaluate("() => window.__bodies[3]")
    ok(b.get("client_id") is None and len(b.get("attachments") or []) == 2 and all(x["type"] == "application/pdf" for x in b["attachments"]), "9: both PDFs go to the AI; the files alone are read, not the client's books (client_id %r)" % b.get("client_id"))
    qs = b.get("question") or ""
    ok(qs.startswith("Compare these two financial statements") and "compared them line by line" in qs and "Trade receivables" in qs and "+1,50,000.00" in qs and len(qs) <= 4000,
       "9: the AI is given FinCom's differences with the question (%d chars): %s" % (len(qs), qs[40:400].replace("\n", " | ")))
    pg.evaluate(ANSWER, "The final statements carry ₹1,50,000.00 more of trade receivables and a new short-term borrowing of ₹2,00,000.00 (made up)."); pg.wait_for_timeout(800)
    t = pg.evaluate("() => ASST.turns().slice(-1)[0]")
    r = [x for x in (t.get("results") or []) if x.get("tool") == "compare_statements"]
    rows = {(x["st"], x["line"]): x for x in (r[0]["rows"] if r else [])}
    print("    " + json.dumps([[x["st"], x["line"], x["a"], x["b"], x["d"], x["why"]] for x in (r[0]["rows"] if r else [])]))
    want = {("Balance sheet", "Reserves and surplus"): (2450000, 2366000, -84000), ("Balance sheet", "Trade receivables"): (1200000, 1350000, 150000),
            ("Balance sheet", "Inventories"): (980000, 920000, -60000), ("Balance sheet", "Cash and cash equivalents"): (770000, 796000, 26000),
            ("P&L", "Changes in inventories of stock-in-trade"): (-150000, -90000, 60000), ("P&L", "Other expenses"): (910000, 970000, 60000),
            ("P&L", "Profit before tax"): (900000, 780000, -120000), ("P&L", "Profit for the year"): (630000, 546000, -84000)}
    for k, (a_, b_, d_) in want.items():
        x = rows.get(k) or {}
        ok(x.get("a") == a_ and x.get("b") == b_ and abs((x.get("d") or 0) - d_) < 0.005, "9: %s / %s: %s and %s, a difference of %s (%s)" % (k[0], k[1], a_, b_, d_, x))
    sb = rows.get(("Balance sheet", "Short-term borrowings")) or {}
    ok(sb.get("a") is None and sb.get("b") == 200000 and sb.get("why") == "only in the second", "9: a line in the second file only: Short-term borrowings 2,00,000 (%s)" % sb)
    tot = [x for x in (r[0]["rows"] if r else []) if x["line"].startswith("Total (")]
    ok([x["line"] for x in tot] == ["Total (Equity and liabilities)", "Total (Assets)"] and all(x["d"] == 116000 for x in tot), "9: each balance sheet total says which side it closes (%s)" % [x["line"] for x in tot])
    ok(not any("Share capital" in k[1] or "Revenue from operations" in k[1] or "Trade payables" in k[1] for k in rows), "9: lines that agree are not listed as differences")
    ok(not any("99,99,999" in str(x) or x.get("a") == 9999999 for x in rows.values()), "9: the notes page is not compared")
    card = pg.locator('.asst-turn.latest [data-asst-result="compare_statements"]')
    ok(card.count() == 1 and "compared line by line" in card.inner_text() and "1,50,000.00" in card.inner_text() and card.locator("tbody tr").count() == len(r[0]["rows"] if r else []), "9: the differences shown as a table under the answer (%d rows)" % card.locator("tbody tr").count())
    ok("lines compared" in card.inner_text(), "9: how many lines were compared, and how many agree")
    shot(pg, "07-compare-fs", ".asst-turn.latest")

    # ---------- 10. a phone: the chips fit in the box
    pg.set_input_files("[data-asst-upload-input]", [files["receipt.png"], files["fs-final.pdf"], files["notes.txt"]])
    wait(pg, "() => document.querySelectorAll('[data-asst-chips] [data-asst-chip=\"ready\"]').length === 3", 15000)
    for scheme in ("light", "dark"):
        pg.emulate_media(color_scheme=scheme); pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
        ph = pg.evaluate("""() => { const f = document.querySelector('form.asst-ask').getBoundingClientRect(), s = document.querySelector('[data-asst-scroll]');
          const cs = Array.from(document.querySelectorAll('[data-asst-chips] [data-asst-chip]')).map((c) => c.getBoundingClientRect());
          return {fit: cs.every((r) => r.left >= f.left - 1 && r.right <= f.right + 1), side: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth - innerWidth}; }""")
        ok(ph["fit"] and ph["side"] <= 1 and ph["page"] <= 1, "10: phone (390 wide, %s): the chips fit in the box, no sideways scrolling (%s)" % (scheme, ph))
        shot(pg, "08-phone-" + scheme, "body")
    pg.emulate_media(color_scheme="light"); pg.set_viewport_size({"width": 1280, "height": 900}); pg.wait_for_timeout(300)
    shot(pg, "09-desktop-chips", "body")
    br.close()

ok(not errors, "no page errors %s" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
