"""python3 run_assistant_attach30.py - Ask FinCom takes 30 files a message, of any type (the owner's request of
13-Nov-2026: "attaching is limited to 3 files: make it 30, and accept Excel, CSV, PDF, XML, JSON, JPEG, PNG and anything
else"). The rules are server/_shared/attachrules.js (the same file fincom-assistant runs). On the React build
(app/dist-test); fincom-assistant and the storage upload stood in by the page, as in run_assistant_attach.py. All files
made up.
  1. 30 mixed files chosen at once (PDF, PNG, Excel with two sheets, CSV, JSON, XML, a web page, text, Word, a zip, an
     unknown binary, notes): 30 chips; at most 4 upload at a time, the rest "Waiting"; one progress bar for all of them
     ("Uploading 4 of 30 files"); a 31st is refused, said so
  2. what each is read as, said on its chip: an unknown binary "name and size only"; a long text "Shortened to fit";
     stored with a type that is never served as a page (a web page, an XML file: application/octet-stream)
  3. the cost said BEFORE sending: "about ₹X of AI credit", from the tokens of what was read
  4. Send: one message with the 30 files; each with the text FinCom read of it: the Excel's two sheets, the Word file's
     words, the JSON and XML, the PDF's text too (in case it cannot go as it is); the zip's list and the files read inside
     it; a zip in a zip opened, one deeper listed only; a file that unpacks to far more than its size (a zip bomb) not
     opened; the unknown binary with no text
  5. a 0-byte file and one over 20 MB: refused on their chips, with no Retry; files over 100 MB together: the one past it
     refused; Send still sends the others and says plainly which were not sent
Screenshots in tests/out/assistant-attach30/ (TDSDESK_OUT).
Run on app/dist-test: python3 tests/run_assistant_attach30.py"""
import os, sys, json, io, zipfile, struct, zlib, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
OUT = os.path.join(os.environ.get("TDSDESK_OUT", os.path.join(HERE, "out")), "assistant-attach30"); os.makedirs(OUT, exist_ok=True)
TMP = os.path.join(OUT, "files"); os.makedirs(TMP, exist_ok=True)
PORT = int(os.environ.get("ATTACH30_PORT") or 8433)
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
F = {}
def put(name, data):
    p = os.path.join(TMP, name); open(p, "wb").write(data if isinstance(data, bytes) else data.encode()); F[name] = p; return p
def png_bytes():
    raw = b"".join(b"\x00" + b"\xd9\x77\x06\xff" * 2 for _ in range(2))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
fs_pdf(os.path.join(TMP, "Example FS draft.pdf"), "draft"); F["Example FS draft.pdf"] = os.path.join(TMP, "Example FS draft.pdf")
put("photo.png", png_bytes())
import openpyxl
wb = openpyxl.Workbook(); ws = wb.active; ws.title = "Sales Made Up"; ws.append(["Invoice", "Party", "Amount"])
for i in range(1, 41): ws.append(["S-%d" % i, "Made-up Buyer %d" % i, 1000 + i])
ws2 = wb.create_sheet("Notes Sheet"); ws2.append(["Made-up note in the second sheet"])
xb = io.BytesIO(); wb.save(xb); put("sales.xlsx", xb.getvalue())
put("bank.csv", "Date,Narration,Amount\n01/04/2026,Made-up receipt,500.00\n02/04/2026,Made-up payment,-200.00\n")
put("data.json", json.dumps({"made_up": True, "items": [{"n": 1, "what": "a made-up line"}]}))
put("tally.xml", "<ENVELOPE><BODY><X>made-up xml value</X></BODY></ENVELOPE>")
put("page.html", "<html><body><script>alert('made up')</script>Made-up page text</body></html>")
put("big.txt", "Made-up ledger narration, nothing real in it at all. " * 8000)       # ~424,000 characters
def docx_bytes(text):
    b = io.BytesIO(); z = zipfile.ZipFile(b, "w", zipfile.ZIP_DEFLATED)
    z.writestr("[Content_Types].xml", "<Types/>")
    z.writestr("word/document.xml", '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>%s</w:t></w:r></w:p><w:p><w:r><w:t>Second made-up paragraph</w:t></w:r></w:p></w:body></w:document>' % text)
    z.close(); return b.getvalue()
put("letter.docx", docx_bytes("Made-up letter text in Word"))
def zbytes(entries, method=zipfile.ZIP_DEFLATED):
    b = io.BytesIO(); z = zipfile.ZipFile(b, "w", method)
    for n, d in entries: z.writestr(n, d)
    z.close(); return b.getvalue()
deep = zbytes([("deepest.txt", "Made-up deepest text")])
nested = zbytes([("nested-note.txt", "Made-up nested note"), ("deep.zip", deep)])
put("bundle.zip", zbytes([("inner/rows.csv", "Code,Name\nA1,Made-up inner row\n"), ("readme.txt", "Made-up readme in the zip"), ("photo-in-zip.png", png_bytes()),
                          ("nested.zip", nested), ("bomb.txt", b"\0" * (60 * 1024 * 1024)), ("tool.exe", b"MZ\x90\x00" + bytes(range(256)) * 4)]))
put("blob.bin", bytes((i * 37) % 256 for i in range(4096)))
while len(F) < 30: put("note-%02d.txt" % len(F), "Made-up note number %d" % len(F))
put("one-more.txt", "Made-up 31st file")
put("empty.txt", b"")
put("over.pdf", b"%PDF-1.4\n" + b"0" * (21 * 1024 * 1024))
put("small-a.txt", "Made-up small a"); put("small-b.txt", "Made-up small b")
THIRTY = [k for k in F if k not in ("one-more.txt", "empty.txt", "over.pdf", "small-a.txt", "small-b.txt")]
assert len(THIRTY) == 30, len(THIRTY)

SETUP = """() => {
  Cloud.cfg = () => ({url: "http://fn.test", key: "anon-key", email: "me@firm.test"});
  Cloud.sess = () => ({access_token: "tok-x", refresh_token: "", user_id: "u1", email: "me@firm.test", at: Date.now(), expires_in: 3600});
  Cloud.fresh = async () => {}; Cloud.refreshToken = async () => {};
  Cloud.st.firm = "f1"; Cloud.st.role = "owner"; Cloud.st.state = "ok";
  S.account = Object.assign(S.account || {}, {me: {role: "owner", email: "me@firm.test"}, firm: {name: "Test firm"}}); S.firm.firmName = "Test firm";
  Cloud.rpc = async (fn) => fn === "asst_settings" ? {enabled: true, owner: true, default_on: true, consent: true} : {};
  Cloud.api = async () => []; try { Live.stop(); } catch (e) {}
  try { lsSet("tdsdesk:asst-notice", "1"); } catch (e) {}
  const c = newCompany({name: "ZZ Zeta Exports", gstin: "09AANFG3202D1ZR"}); S.companies[c.id] = c; S.data[c.id] = {parties: {}, entries: {}, loaded: true}; c.stats = {};
  S.coId = c.id; S.view = "company"; S.tab = "books"; render();
  // the storage upload, stood in: in flight counted (at most 4 at once); held while window.__hold, let go by __go()
  window.__held = []; window.__hold = false; window.__stored = []; window.__inflight = 0; window.__maxInflight = 0;
  window.__go = () => { const h = window.__held.splice(0); h.forEach((f) => f()); };
  class FakeXhr {
    constructor(){ this.upload = {}; this.status = 0; this.h = {}; }
    open(m, u){ this.m = m; this.u = u; }
    setRequestHeader(k, v){ this.h[k] = v; }
    send(body){
      window.__inflight++; window.__maxInflight = Math.max(window.__maxInflight, window.__inflight);
      setTimeout(() => { if (this.upload.onprogress) this.upload.onprogress({lengthComputable: true, loaded: 40, total: 100}); }, 10);
      const end = () => setTimeout(() => { window.__inflight--; this.status = 200; window.__stored.push({url: this.u, type: this.h["Content-Type"], size: body && body.size}); if (this.onload) this.onload(); }, 20);
      if (window.__hold) window.__held.push(end); else setTimeout(end, 30);
    }
  }
  window.XMLHttpRequest = FakeXhr;
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
CHIPS = "() => Array.from(document.querySelectorAll('[data-asst-chips] [data-asst-chip]')).map((c) => ({name: c.dataset.name, state: c.dataset.asstChip, text: c.innerText.replace(/\\s+/g, ' ').trim(), retry: !!c.querySelector('[data-asst-chip-retry]'), note: (c.querySelector('[data-asst-chip-note]') || {}).textContent || ''}))"
def shot(pg, name, sel=".asst-panel"):
    p = os.path.join(OUT, name + ".png")
    try:
        loc = pg.locator(sel).first
        loc.screenshot(path=p) if loc.count() else pg.screenshot(path=p)
    except Exception:
        pg.screenshot(path=p)
def wait(pg, js, ms=15000):
    for _ in range(ms // 100):
        if pg.evaluate(js): return True
        pg.wait_for_timeout(100)
    return False
def chips(pg): return {c["name"]: c for c in pg.evaluate(CHIPS)}
def clear_box(pg):
    pg.evaluate("() => { AUpload.pending().forEach((u) => AUpload.drop(u)); }"); pg.wait_for_timeout(200)

with sync_playwright() as p:
    br = p.chromium.launch(); ctx = br.new_context(viewport={"width": 1280, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
    if pg.evaluate("() => typeof signInNeeded === 'function' && typeof S === 'object' && !!S && !!S.firm && signInNeeded()"): pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
    pg.evaluate(SETUP); pg.wait_for_timeout(500)
    pg.evaluate("ASST.open()"); pg.wait_for_timeout(1200)
    ok(pg.locator("[data-asst-panel]").count() == 1, "the panel opens")
    acc = pg.get_attribute("[data-asst-upload-input]", "accept")
    ok(not acc, "the file box takes any type (accept %r)" % acc)

    # ---------- 1. 30 at once: 4 at a time, one progress bar; a 31st refused
    pg.evaluate("window.__hold = true")
    pg.set_input_files("[data-asst-upload-input]", [F[n] for n in THIRTY])
    wait(pg, "() => window.__inflight === 4", 20000); pg.wait_for_timeout(300)
    ch = chips(pg)
    states = [c["state"] for c in ch.values()]
    ok(len(ch) == 30, "1: 30 chips in the box (%d)" % len(ch))
    ok(states.count("uploading") <= 4 and states.count("queued") >= 26 - states.count("ready") and pg.evaluate("window.__inflight") == 4, "1: at most 4 upload at a time, the rest wait (%s)" % {s: states.count(s) for s in set(states)})
    ok(any("Waiting" in c["text"] for c in ch.values() if c["state"] == "queued"), "1: a waiting chip says so")
    bar = pg.locator("[data-asst-upbar]")
    ok(bar.count() == 1 and "of 30 files" in bar.inner_text() and bar.locator(".asst-upbar-fill").count() == 1, "1: one progress bar for all of them (%r)" % (bar.inner_text() if bar.count() else None))
    shot(pg, "01-thirty-uploading", "form.asst-ask")
    for _ in range(200):
        pg.evaluate("window.__go()"); pg.wait_for_timeout(120)
        if pg.evaluate("() => AUpload.pending().every((u) => u.state === 'ready' || u.state === 'failed')"): break
    pg.evaluate("window.__hold = false")
    ok(pg.evaluate("window.__maxInflight") <= 4, "1: never more than 4 uploads in flight (%d)" % pg.evaluate("window.__maxInflight"))
    wait(pg, "() => document.querySelectorAll('[data-asst-chips] [data-asst-chip=\"ready\"]').length === 30", 30000)
    ch = chips(pg)
    ok(sum(1 for c in ch.values() if c["state"] == "ready") == 30, "1: all 30 uploaded (%s)" % [c["name"] + ":" + c["state"] for c in ch.values() if c["state"] != "ready"])
    ok(pg.locator("[data-asst-upbar]").count() == 0, "1: the progress bar goes when they are all up")
    pg.set_input_files("[data-asst-upload-input]", [F["one-more.txt"]]); pg.wait_for_timeout(400)
    ok(len(chips(pg)) == 30 and any("Up to 30 files" in t for t in pg.evaluate("window.__toasts")), "1: a 31st is refused, said so (%s)" % pg.evaluate("window.__toasts")[-1:])
    ok(pg.locator("[data-asst-upload-btn]").is_disabled(), "1: Attach is greyed with 30 in the box")

    # ---------- 2. what each is read as, on its chip; stored safely
    ok("name and size only" in ch["blob.bin"]["note"].lower(), "2: an unknown binary: 'name and size only' (%r)" % ch["blob.bin"]["note"])
    ok("shortened" in ch["big.txt"]["note"].lower(), "2: a long text: shortened to fit, said (%r)" % ch["big.txt"]["note"])
    ok(not ch["note-12.txt"]["note"] and not ch["photo.png"]["note"], "2: a file read whole says nothing more")
    st = {s["url"].rsplit("/", 1)[-1].split("-", 1)[-1]: s["type"] for s in pg.evaluate("window.__stored")}
    ok(st.get("page.html") == "application/octet-stream" and st.get("tally.xml") == "application/octet-stream" and st.get("blob.bin") == "application/octet-stream", "2: a web page, an XML file and an unknown file are stored as application/octet-stream (%s)" % {k: st.get(k) for k in ("page.html", "tally.xml", "blob.bin")})
    ok(st.get("photo.png") == "image/png" and st.get("Example-FS-draft.pdf") == "application/pdf", "2: a picture and a PDF keep their type (%s)" % {k: v for k, v in st.items() if k.endswith((".png", ".pdf"))})

    # ---------- 3. the cost, before sending
    cost = pg.locator("[data-asst-cost]")
    ct = cost.inner_text() if cost.count() else ""
    ok(cost.count() == 1 and "about ₹" in ct and "AI credit" in ct, "3: the cost said before sending (%r)" % ct)
    shot(pg, "02-thirty-ready-cost", "form.asst-ask")

    # ---------- 4. Send: one message with the 30 files and what FinCom read of each
    pg.fill("#asstQ", "What do these made-up files say?"); pg.keyboard.press("Enter")
    ok(wait(pg, "() => window.__bodies.length === 1"), "4: sent")
    b = pg.evaluate("() => window.__bodies[0]")
    att = {a["name"]: a for a in (b.get("attachments") or [])}
    ok(len(b.get("attachments") or []) == 30, "4: one message with the 30 files (%d)" % len(b.get("attachments") or []))
    tx = lambda n: (att.get(n) or {}).get("text") or ""
    ok("Made-up Buyer 40" in tx("sales.xlsx") and "Made-up note in the second sheet" in tx("sales.xlsx"), "4: the Excel's two sheets as text")
    ok("Made-up letter text in Word" in tx("letter.docx") and "Second made-up paragraph" in tx("letter.docx"), "4: the Word file's words")
    ok('"made_up"' in tx("data.json") and "made-up xml value" in tx("tally.xml") and "Made-up page text" in tx("page.html"), "4: JSON, XML and a web page as text")
    ok(att.get("Example FS draft.pdf", {}).get("type") == "application/pdf" and len(tx("Example FS draft.pdf")) > 50, "4: the PDF as itself, with its text in case it cannot go as it is")
    z = tx("bundle.zip")
    print("    zip: " + z[:700].replace("\n", " | "))
    ok(all(n in z for n in ("inner/rows.csv", "readme.txt", "photo-in-zip.png", "nested.zip", "bomb.txt", "tool.exe")), "4: the zip's list of files")
    ok("Made-up inner row" in z and "Made-up readme in the zip" in z, "4: the files read inside the zip")
    ok("Made-up nested note" in z and "deep.zip" in z and "Made-up deepest text" not in z, "4: a zip in the zip opened; one deeper listed only")
    ok("\0" not in z and "zip bomb" in z.lower(), "4: a file that unpacks to far more than its size is not opened, said so")
    ok(not tx("blob.bin") and att.get("blob.bin", {}).get("size") == 4096, "4: the unknown binary goes with its name and size, no text")
    ok(len(tx("big.txt")) <= 200000, "4: a file's text kept to 200,000 characters (%d)" % len(tx("big.txt")))
    pg.evaluate(ANSWER, "The made-up files are read."); pg.wait_for_timeout(600)
    ok(pg.locator(".asst-turn.latest [data-asst-sent-chip]").count() == 30, "4: the message shows its 30 files")
    shot(pg, "03-thirty-sent")

    # ---------- 5. 0 bytes, over 20 MB, over 100 MB together; the others still go
    pg.set_input_files("[data-asst-upload-input]", [F["empty.txt"], F["over.pdf"], F["small-a.txt"], F["small-b.txt"]])
    wait(pg, "() => AUpload.pending().length === 4 && AUpload.pending().every((u) => u.state === 'ready' || u.state === 'failed')")
    ch = chips(pg)
    ok(ch["empty.txt"]["state"] == "failed" and "empty" in ch["empty.txt"]["text"] and not ch["empty.txt"]["retry"], "5: a 0-byte file refused on its chip, no Retry (%r)" % ch["empty.txt"]["text"])
    ok(ch["over.pdf"]["state"] == "failed" and "20 MB" in ch["over.pdf"]["text"] and not ch["over.pdf"]["retry"], "5: a file over 20 MB refused on its chip (%r)" % ch["over.pdf"]["text"])
    ok(not pg.locator(".asst-send").is_disabled(), "5: Send is not held up by the files refused")
    shot(pg, "04-refused", "form.asst-ask")
    pg.fill("#asstQ", "And these?"); pg.keyboard.press("Enter")
    ok(wait(pg, "() => window.__bodies.length === 2"), "5: sent")
    b = pg.evaluate("() => window.__bodies[1]")
    ok(sorted(a["name"] for a in b["attachments"]) == ["small-a.txt", "small-b.txt"], "5: the others still go (%s)" % [a["name"] for a in b["attachments"]])
    last = pg.evaluate("window.__toasts")[-1:]
    ok(last and "not sent" in last[0] and "empty.txt" in last[0] and "over.pdf" in last[0], "5: said plainly which were not sent (%s)" % last)
    pg.evaluate(ANSWER, "Two made-up notes."); pg.wait_for_timeout(400)
    clear_box(pg)
    pg.evaluate("""() => ASST.upload(Array.from({length: 6}, (_x, i) => new File([new Uint8Array(19 * 1024 * 1024)], "part" + i + ".dat", {type: "application/octet-stream"})))""")
    wait(pg, "() => AUpload.pending().length === 6 && AUpload.pending().every((u) => u.state === 'ready' || u.state === 'failed')", 30000)
    ch = chips(pg)
    bad = [n for n, c in ch.items() if c["state"] == "failed"]
    ok(bad == ["part5.dat"] and "100 MB" in ch["part5.dat"]["text"], "5: over 100 MB together: the file past it refused (%s)" % {n: c["text"] for n, c in ch.items() if c["state"] == "failed"})
    clear_box(pg)
    # a phone: 30 chips fit, the box scrolls, no sideways scrolling
    pg.set_input_files("[data-asst-upload-input]", [F[n] for n in THIRTY])
    wait(pg, "() => document.querySelectorAll('[data-asst-chips] [data-asst-chip=\"ready\"]').length === 30", 30000)
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
    ph = pg.evaluate("""() => { const f = document.querySelector('form.asst-ask').getBoundingClientRect(), c = document.querySelector('[data-asst-chips]');
      return {formH: f.height, chipsH: c.getBoundingClientRect().height, scrolls: c.scrollHeight > c.clientHeight, page: document.documentElement.scrollWidth - innerWidth}; }""")
    ok(ph["chipsH"] <= 240 and ph["scrolls"] and ph["page"] <= 1, "5: a phone (390 wide): 30 chips in a box that scrolls, no sideways scrolling (%s)" % ph)
    shot(pg, "05-phone-thirty", "body")
    br.close()

ok(not errors, "no page errors %s" % errors[:3])
print("\n%d failed" % len(fails) if fails else "\nall passed")
sys.exit(1 if fails else 0)
