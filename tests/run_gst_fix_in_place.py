"""python3 run_gst_fix_in_place.py - GST › What to fix: an entry corrected where it is shown (the owner, 23-Nov-2026: "any
error should be rectified there only.. option of open in entry should pop up a new window there only...and that change
should be made to tally and fincom books also"; the forms approved the same day, decisions 1, 2, 4-7).

  1. "Open the entry" opens a window on the same page (not Look up): the entry from FinCom Books, and only the box its
     kind of error needs: the invoice number (too long), the party's GSTIN (not valid: on the party ledger only);
  2. Save in Tally sends the one change to FinCom Bridge (/fix) with the entry's Tally id, its change number (AlterID),
     type and date; the entry Tally gives back replaces FinCom's, the list is worked out again and the row leaves it;
     the change is in Changes made here, with Undo (which sends the earlier value with the new change number);
  3. changed in Tally since: nothing is said to be saved; the window says so in plain words and FinCom takes Tally's entry;
  4. Tally closed (no bridge here): the change is kept with the client's books (b.fixq, waiting) and sent once Tally is open;
FinCom Bridge is stood in (Bridge.call): what it is sent is checked, what it answers is the test's. Made-up books only
(tests/fixtures/books). Screenshots (deviceScaleFactor 2) of the window go to FIX_SHOTS when set: classic and New look,
light and dark, and a phone. Runs on the React build: app/dist-test (cd app && npm run legacy && npm run build:test)."""
import os, sys, json, threading, functools, http.server
os.environ.setdefault("PLAYWRIGHT_BROWSERS_PATH", "/opt/pw-browsers")
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from books_data import CACHE
from tdsgst_snapshot import LOAD
from playwright.sync_api import sync_playwright
SITE = os.environ.get("TDSDESK_SITE", os.path.join(HERE, "..", "app", "dist-test"))
PORT = int(os.environ.get("FIXIP_PORT") or 8341)
SHOTS = os.environ.get("FIX_SHOTS", "")
fails, errors = [], []
def ok(c, w):
    print(("  ok   " if c else "  FAIL ") + w, flush=True)
    if not c: fails.append(w)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("localhost", PORT), functools.partial(Quiet, directory=os.path.abspath(SITE))); srv.handle_error = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
books = json.load(open(CACHE))

SALE = "(a) => S.books.vouchers.find(v => (v.no || v.ref) === a)"
# an entry changed as a new read of the books changes it: a new object in its place, the books saved
PLANT = "(a) => { const vs = S.books.vouchers, i = vs.findIndex(v => v.id === a[0]); vs[i] = Object.assign({}, vs[i], {no: a[1], alt: a[2]}); BOOKS_REV++; render(); }"
LONG, SHORT, BADG = "LFE/2025-26/000006", "LFE/25-26/006", "07AAJFQ3158R1ZJ"
# FinCom Bridge stood in: the Tally company found and linked, every call kept, the answer the test's (window.__fix)
STUB = """() => { window.__calls = []; window.__live = true; window.bridgeLive = () => window.__live; window.ensureTallyCompany = async () => 'ZZ Fix Co';
  window.linkGuid = async () => ({guid: 'co-guid-fix'});
  Bridge.call = async (path, body) => { window.__calls.push([path, JSON.parse(JSON.stringify(body))]); return window.__fix(body); }; }"""
# Tally's entry as the bridge reads it back: FinCom's own entry with the number and change number given
XML = """(a) => { const v = S.books.vouchers.find(x => x.id === a[0]), e = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return '<VOUCHER VCHTYPE="' + e(v.type) + '"><GUID>' + e(v.id) + '</GUID><ALTERID>' + a[2] + '</ALTERID><DATE>' + v.date + '</DATE><VOUCHERTYPENAME>' + e(v.type) +
    '</VOUCHERTYPENAME><VOUCHERNUMBER>' + e(a[1]) + '</VOUCHERNUMBER><PARTYLEDGERNAME>' + e(v.party) + '</PARTYLEDGERNAME><PARTYGSTIN>' + e(v.gstin) +
    '</PARTYGSTIN><PLACEOFSUPPLY>' + e(v.pos) + '</PLACEOFSUPPLY>' + (v.ent || []).map(l => '<ALLLEDGERENTRIES.LIST><LEDGERNAME>' + e(l.l) + '</LEDGERNAME><ISDEEMEDPOSITIVE>' +
    (l.a < 0 ? 'Yes' : 'No') + '</ISDEEMEDPOSITIVE><AMOUNT>' + l.a + '</AMOUNT></ALLLEDGERENTRIES.LIST>').join('') + '</VOUCHER>'; }"""

def wait_idle(pg, ms=300):
    pg.wait_for_timeout(ms)
    try: pg.wait_for_function("() => !document.querySelector('#app .pg-skel, #app [data-page-skeleton], #app [data-loading], #app [data-rx-preparing]')", timeout=60000, polling=100)
    except Exception: pass

def month(pg, ym):
    pg.evaluate("(m) => { S.tab = 'books'; S.booksTab = 'gst'; S.gstView = 'year'; S.gstReg = '07'; S.gstYm = m; render(); }", ym); wait_idle(pg, 500)
    pg.click('#app [data-cell="GSTR-1|%s"]' % ym); wait_idle(pg, 400)

def group(pg, what):
    pg.evaluate("(w) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === w); if (g && !g.querySelector('[data-fix-row]')) g.querySelector('[data-fix-toggle]').click(); }", what); wait_idle(pg, 150)
    return pg.evaluate("(w) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === w); return g ? Array.from(g.querySelectorAll('[data-fix-row]')).map(r => r.dataset.id) : null; }", what)

def open_entry(pg, what, vid):
    pg.evaluate("(a) => { const g = Array.from(document.querySelectorAll('#app [data-fix-group]')).find(x => x.dataset.fixGroup === a[0]); Array.from(g.querySelectorAll('[data-fix-row]')).find(r => r.dataset.id === a[1]).querySelector('[data-fix-open]').click(); }", [what, vid])
    pg.wait_for_selector("[data-fix-entry]", timeout=10000); pg.wait_for_timeout(250)
    return pg.evaluate("""() => { const w = document.querySelector('[data-fix-entry]'); const i = w.querySelector('[data-fix-input]');
      return {kind: w.dataset.fixKind, id: w.dataset.fixEntry, input: i ? [i.dataset.fixInput, i.value] : null, save: !!w.querySelector('[data-fix-save]'), lookup: !!w.querySelector('[data-fix-lookup]'),
        text: w.innerText.replace(/\\s+/g, ' '), tab: S.booksTab, warn: w.querySelectorAll('.warn, .bad, [role=alert]').length}; }""")

def typein(pg, v):
    pg.fill("[data-fix-entry] [data-fix-input]", v); pg.wait_for_timeout(150)

def state(pg):
    return pg.evaluate("() => { const s = document.querySelector('[data-fix-entry] [data-fix-state]'); return s ? [s.dataset.fixState, s.innerText] : null; }")

def shot(pg, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); pg.screenshot(path=os.path.join(SHOTS, name + ".png"))

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--js-flags=--max-old-space-size=4096"])
        ctx = br.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=2); pg = ctx.new_page(); pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.goto("http://localhost:%d/" % PORT); pg.wait_for_timeout(2500)
        pg.evaluate("() => new Promise((r) => { const go = () => (typeof doAct === 'function' && typeof signInNeeded === 'function' && typeof S === 'object' && S && S.firm) ? (() => { try { if (signInNeeded()) doAct('useOffline'); } finally { r(); } })() : setTimeout(go, 50); go(); })"); pg.wait_for_timeout(1200)
        pg.evaluate(LOAD, books); pg.wait_for_timeout(1000); pg.evaluate("S.books = window.__bk; render();"); pg.wait_for_timeout(500)
        pg.evaluate("(a) => { const v = (" + SALE + ")(a[0]); v.no = a[1]; if (v.alt == null) v.alt = 57; }", [SHORT, LONG])
        pg.evaluate("(a) => { const v = (" + SALE + ")(a[0]); v.gstin = a[1]; S.books.gstins = S.books.gstins || {}; S.books.gstins[v.party] = a[1]; }", ["LFE/25-26/001", BADG])
        vid = pg.evaluate("(a) => (" + SALE + ")(a).id", LONG)
        pg.evaluate(STUB)

        # 1. the window on the page, the number's box only
        month(pg, "202507")
        what = "Invoice numbers longer than 16 characters"
        rows = group(pg, what)
        ok(rows and vid in rows, "Jul-2025: the long number's row in What to fix (%s)" % rows)
        w = open_entry(pg, what, vid)
        ok(w["kind"] == "number" and w["input"] == ["number", LONG] and w["save"] and w["lookup"] and w["tab"] == "gst",
           "Open the entry: a window on the same page, the invoice number in its box, Save in Tally, Open in Look up (%s)" % {k: w[k] for k in ("kind", "input", "save", "tab")})
        ok("The portal takes at most 16 characters in an invoice number." in w["text"] and w["warn"] == 0, "the reason in plain words, nothing shown as a warning (%r)" % w["text"][:200])
        ok(pg.evaluate("() => document.querySelector('[data-fix-save]').disabled"), "Save waits until the number fits")
        typein(pg, "LFE/25-26/0006 X")
        ok(pg.evaluate("() => document.querySelector('[data-fix-save]').disabled"), "a space is not taken (the portal's characters only)")
        typein(pg, SHORT)
        ok(not pg.evaluate("() => document.querySelector('[data-fix-save]').disabled") and "13 of 16" in pg.evaluate("() => document.querySelector('[data-fix-count]').innerText"), "13 of 16: Save is offered")
        shot(pg, "1-classic-light-number")

        # 2. saved: the one change sent, Tally's entry back into FinCom Books, the row gone
        pg.evaluate("(x) => { window.__fix = (b) => ({ok: true, message: 'Saved in Tally.', before: {number: b.fields.number}, after: {number: b.fields.number, alterId: '58'}, alterAfter: '58', xml: window.__xml}); }", None)
        pg.evaluate("(a) => { window.__xml = (" + XML + ")(a); }", [vid, SHORT, 58])
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(600)
        calls = pg.evaluate("window.__calls")
        body = calls[-1][1] if calls else {}
        ok(len(calls) == 1 and calls[0][0] == "/fix" and body.get("target") == "voucher" and body.get("guid") == vid and body.get("fields") == {"number": SHORT}
           and body.get("companyGuid") == "co-guid-fix" and body.get("company") == "ZZ Fix Co" and body.get("alterId") and body.get("vchDate") and body.get("vchType"),
           "Save sends one change to the bridge: the entry's Tally id, change number, type, date and the new number only (%s)" % body)
        st = state(pg)
        ok(st and st[0] == "done" and st[1] == "Saved in Tally and FinCom Books.", "the window says Saved in Tally and FinCom Books. (%s)" % st)
        shot(pg, "2-classic-light-saved")
        pg.wait_for_timeout(1500)
        v = pg.evaluate("(id) => { const v = S.books.vouchers.find(x => x.id === id); return v && {no: v.no, alt: v.alt}; }", vid)
        ok(v and v["no"] == SHORT and v["alt"] == 58, "FinCom Books hold Tally's entry read back (%s)" % v)
        ok(not pg.evaluate("() => !!document.querySelector('[data-fix-entry]')"), "the window closes by itself")
        rows = group(pg, what)
        ok(not rows or vid not in rows, "the row has left What to fix (%s)" % rows)
        h = pg.evaluate("() => { const h = document.querySelector('#app [data-fix-history]'); return h ? [h.dataset.fixHistory, h.textContent.replace(/\\s+/g, ' ')] : null; }")
        ok(h and h[0] == "1" and LONG in h[1] and SHORT in h[1], "Changes made here (1), the old and new number (%s)" % h)
        kept = pg.evaluate("() => (S.books.fixq || []).map(x => [x.state, x.was, x.to])")
        ok(kept == [["done", LONG, SHORT]], "kept with the client's books (b.fixq) (%s)" % kept)
        undo = pg.evaluate("() => !!document.querySelector('#app [data-fix-undo]')")
        ok(not undo, "no Undo back to a number the portal refuses (the approved form takes 16 of A-Z 0-9 / - only)")

        # 3. changed in Tally since: nothing saved, Tally's entry taken
        pg.evaluate(PLANT, [vid, LONG, 60])
        pg.evaluate("(a) => { window.__xml = (" + XML + ")(a); window.__fix = (b) => ({ok: false, changed: true, now: {number: 'LFE/25-26/0106', alterId: '61'}, alterNow: '61', xml: window.__xml}); }", [vid, "LFE/2025-26/000106", 61])
        month(pg, "202507"); group(pg, what); open_entry(pg, what, vid); typein(pg, SHORT)
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(800)
        st = state(pg)
        ok(st and st[0] == "changed" and st[1] == "Changed in Tally since it was opened here. This is how it is now.", "changed since: said plainly, nothing saved (%s)" % st)
        v = pg.evaluate("(id) => { const v = S.books.vouchers.find(x => x.id === id); return v && {no: v.no, alt: v.alt}; }", vid)
        ok(v == {"no": "LFE/2025-26/000106", "alt": 61}, "FinCom takes the entry as Tally has it now (%s)" % v)
        shot(pg, "3-classic-light-changed")
        pg.click("[data-fix-entry] [data-fix-cancel]"); pg.wait_for_timeout(300)

        # 4. Tally closed: kept, then sent when Tally is open
        pg.evaluate("() => { window.__live = false; window.__calls = []; }")
        pg.evaluate("(a) => { window.__xml = (" + XML + ")(a); window.__fix = (b) => ({ok: true, after: {number: b.fields.number, alterId: '62'}, xml: window.__xml}); }", [vid, SHORT, 62])
        month(pg, "202507"); group(pg, what); open_entry(pg, what, vid); typein(pg, SHORT)
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(500)
        st = state(pg)
        ok(st and st[0] == "waiting" and st[1] == "Waiting for Tally." and pg.evaluate("window.__calls.length") == 0, "Tally closed: kept, Waiting for Tally., nothing sent (%s)" % st)
        shot(pg, "4-classic-light-waiting")
        pg.click("[data-fix-entry] [data-fix-cancel]"); pg.wait_for_timeout(200)
        pg.evaluate("() => { window.__live = true; }")
        # the list's next drawing sends what waits
        pg.evaluate("() => render()"); pg.wait_for_timeout(1200)
        calls = pg.evaluate("window.__calls")
        kept = pg.evaluate("() => (S.books.fixq || []).map(x => x.state)")
        ok(len(calls) == 1 and calls[0][1].get("fields") == {"number": SHORT} and kept[-1] == "done", "Tally open again: the kept change is sent and saved (%s, %s)" % (len(calls), kept))

        # GSTIN not valid: the party ledger's GSTIN, the earlier one shown, Undo offered
        month(pg, "202504")
        what2 = "Buyer GSTINs that are not valid"
        rows = group(pg, what2)
        gid = rows[0] if rows else ""
        w = open_entry(pg, what2, gid)
        ok(w["kind"] == "gstin" and w["input"] == ["gstin", BADG] and "Changed on the party ledger in Tally." in w["text"], "GSTIN not valid: the party ledger's GSTIN in its box (%s)" % {k: w[k] for k in ("kind", "input")})
        good = pg.evaluate("() => { for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (gstinValid('07AAJFQ3158R1Z' + c)) return '07AAJFQ3158R1Z' + c; }")
        typein(pg, good)
        shot(pg, "5-classic-light-gstin")
        pg.evaluate("() => { window.__calls = []; window.__fix = (b) => ({ok: true, after: {gstin: b.fields.gstin, pan: '', alterId: '12'}, before: {gstin: b.was.gstin}}); }")
        pg.click("[data-fix-entry] [data-fix-save]"); pg.wait_for_timeout(700)
        calls = pg.evaluate("window.__calls"); b = calls[0][1] if calls else {}
        ok(b.get("target") == "ledger" and b.get("fields") == {"gstin": good} and b.get("was") == {"gstin": BADG} and b.get("ledger"), "the ledger's GSTIN is sent, with the one FinCom showed (%s)" % b)
        ok(pg.evaluate("(l) => S.books.gstins[l]", b.get("ledger", "")) == good, "FinCom Books take the ledger's GSTIN read back")

        pg.evaluate("() => { const w = document.querySelector('[data-fix-entry] [data-fix-cancel]'); if (w) w.click(); }"); pg.wait_for_timeout(300)

        # the looks
        pg.evaluate(PLANT, [vid, LONG, 70])
        pg.evaluate("() => { window.FCNewLook.set(true); }"); pg.wait_for_timeout(800)
        month(pg, "202507"); group(pg, what); w = open_entry(pg, what, vid)
        ok(w["kind"] == "number", "New look: the same window")
        shot(pg, "6-newlook-light-number")
        pg.emulate_media(color_scheme="dark"); pg.wait_for_timeout(400); shot(pg, "7-newlook-dark-number")
        pg.click("[data-fix-entry] [data-fix-cancel]"); pg.evaluate("() => { window.FCNewLook.set(false); }"); pg.wait_for_timeout(500)
        month(pg, "202507"); group(pg, what); open_entry(pg, what, vid); shot(pg, "8-classic-dark-number")
        pg.click("[data-fix-entry] [data-fix-cancel]"); pg.emulate_media(color_scheme="light")
        pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(400)
        month(pg, "202507"); group(pg, what); open_entry(pg, what, vid)
        wide = pg.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth + 1")
        ok(wide, "phone width: no sideways scroll")
        shot(pg, "9-phone-number")
        br.close()
except Exception as e:
    import traceback; traceback.print_exc(); fails.append("exception: %s" % e)
finally:
    srv.shutdown()
ok(not errors, "no page errors (%s)" % errors[:3])
print("FAILED: %d" % len(fails) if fails else "ALL PASSED")
sys.exit(1 if fails else 0)
